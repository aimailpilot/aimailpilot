/**
 * Outlook Reply Tracker Service
 * Uses Microsoft Graph API to detect replies to campaign emails and store them in unified_inbox.
 *
 * Flow:
 * 1. Reads stored Microsoft OAuth tokens from api_settings
 * 2. Refreshes access token if expired using refresh_token
 * 3. Polls Microsoft Graph /me/mailFolders/inbox/messages for recent messages
 * 4. Matches replies to campaign messages via In-Reply-To / References / internetMessageId
 * 5. Stores new replies in unified_inbox and updates campaign stats
 */

import { storage } from '../storage';

interface GraphMessage {
  id: string;
  conversationId: string;
  internetMessageId: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  receivedDateTime: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
}

interface GraphListResponse {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
}

export class OutlookReplyTracker {
  private checkInterval: NodeJS.Timeout | null = null;
  private isChecking = false;

  /** Refresh Microsoft access token */
  private async refreshAccessToken(orgId: string): Promise<string | null> {
    try {
      const settings = await storage.getApiSettings(orgId);
      const refreshToken = settings.microsoft_refresh_token;
      const clientId = settings.microsoft_oauth_client_id || process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = settings.microsoft_oauth_client_secret || process.env.MICROSOFT_CLIENT_SECRET;

      if (!refreshToken || !clientId || !clientSecret) return null;

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'openid profile email offline_access User.Read Mail.Read Mail.Send',
      });

      const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!resp.ok) {
        console.error('[OutlookReplyTracker] Token refresh failed:', await resp.text());
        return null;
      }

      const tokens = await resp.json() as any;
      if (tokens.access_token) {
        await storage.setApiSetting(orgId, 'microsoft_access_token', tokens.access_token);
        if (tokens.refresh_token) {
          await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
        }
        const expiry = Date.now() + (tokens.expires_in || 3600) * 1000;
        await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(expiry));
        return tokens.access_token;
      }
      return null;
    } catch (err) {
      console.error('[OutlookReplyTracker] Token refresh error:', err);
      return null;
    }
  }

  /** Get a valid access token, refreshing if needed */
  private async getValidAccessToken(orgId: string): Promise<string | null> {
    const settings = await storage.getApiSettings(orgId);
    let accessToken = settings.microsoft_access_token;
    const tokenExpiry = settings.microsoft_token_expiry;

    if (!accessToken && !settings.microsoft_refresh_token) return null;

    if (tokenExpiry) {
      const exp = parseInt(tokenExpiry);
      if (Date.now() > exp - 300000) {
        accessToken = await this.refreshAccessToken(orgId) || accessToken;
      }
    }
    return accessToken || null;
  }

  /** Call Microsoft Graph API */
  private async graphFetch(accessToken: string, endpoint: string): Promise<any> {
    const url = endpoint.startsWith('http') ? endpoint : `https://graph.microsoft.com/v1.0${endpoint}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      throw new Error(`Graph API error (${resp.status}): ${await resp.text()}`);
    }
    return resp.json();
  }

  /** Check for new replies across Outlook inbox */
  async checkForReplies(orgId: string, lookbackMinutes: number = 120) {
    const result = { checked: 0, newReplies: 0, errors: [] as string[], replies: [] as any[] };

    try {
      const accessToken = await this.getValidAccessToken(orgId);
      if (!accessToken) {
        result.errors.push('No Outlook access token available. Please re-authenticate with Microsoft.');
        return result;
      }

      // Fetch recent inbox messages
      const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
      const filter = `receivedDateTime ge ${since}`;
      const select = 'id,conversationId,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime';
      const endpoint = `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=50&$orderby=receivedDateTime desc&$expand=internetMessageHeaders`;

      const listData: GraphListResponse = await this.graphFetch(accessToken, endpoint);
      if (!listData.value || listData.value.length === 0) return result;

      result.checked = listData.value.length;

      for (const msg of listData.value) {
        try {
          // Skip if already in inbox
          const existing = await storage.getInboxMessageByOutlookId(msg.id);
          if (existing) continue;

          // Check headers for In-Reply-To / References
          const headers = msg.internetMessageHeaders || [];
          const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
          const inReplyTo = getHeader('In-Reply-To');
          const references = getHeader('References');
          const allRefs = `${inReplyTo} ${references}`;

          // Try to match to a campaign message
          const trackingIds = this.extractTrackingIds(allRefs);
          let campaignId: string | null = null;
          let messageId: string | null = null;
          let contactId: string | null = null;
          let campaignName = '';

          for (const trackingId of trackingIds) {
            const campaignMessage = await storage.getCampaignMessageByTracking(trackingId);
            if (campaignMessage && !campaignMessage.repliedAt) {
              campaignId = campaignMessage.campaignId;
              messageId = campaignMessage.id;
              contactId = campaignMessage.contactId;

              // Update campaign message
              await storage.updateCampaignMessage(campaignMessage.id, {
                repliedAt: new Date(msg.receivedDateTime).toISOString(),
              });

              // Update campaign stats
              const campaign = await storage.getCampaign(campaignMessage.campaignId);
              if (campaign) {
                await storage.updateCampaign(campaignMessage.campaignId, {
                  repliedCount: (campaign.repliedCount || 0) + 1,
                });
                campaignName = campaign.name || '';
              }

              // Update contact status
              if (campaignMessage.contactId) {
                try {
                  await storage.updateContact(campaignMessage.contactId, { status: 'replied' });
                } catch (e) { /* ignore */ }
                
                // Cancel pending follow-ups for this contact
                try {
                  await storage.cancelPendingFollowupsForContact(campaignMessage.contactId, campaignMessage.campaignId);
                  console.log(`[OutlookReplyTracker] Cancelled pending follow-ups for contact ${campaignMessage.contactId}`);
                } catch (e) { /* ignore */ }
              }

              // Create tracking event
              await storage.createTrackingEvent({
                type: 'reply',
                campaignId: campaignMessage.campaignId,
                messageId: campaignMessage.id,
                contactId: campaignMessage.contactId,
                trackingId,
                stepNumber: campaignMessage.stepNumber || 0,
                metadata: {
                  outlookMessageId: msg.id,
                  outlookConversationId: msg.conversationId,
                  fromEmail: msg.from?.emailAddress?.address,
                  subject: msg.subject,
                  snippet: msg.bodyPreview,
                  detectedVia: 'outlook-api',
                },
              });

              break; // matched one is enough
            }
          }

          const settings = await storage.getApiSettings(orgId);

          // Store in unified_inbox regardless of campaign match
          await storage.createInboxMessage({
            organizationId: orgId,
            emailAccountId: null,
            campaignId,
            messageId,
            contactId,
            outlookMessageId: msg.id,
            outlookConversationId: msg.conversationId,
            fromEmail: msg.from?.emailAddress?.address || '',
            fromName: msg.from?.emailAddress?.name || '',
            toEmail: settings.microsoft_user_email || msg.toRecipients?.[0]?.emailAddress?.address || '',
            subject: msg.subject || '',
            snippet: msg.bodyPreview || '',
            body: msg.body?.contentType === 'text' ? msg.body.content : msg.bodyPreview || '',
            bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : '',
            status: 'unread',
            provider: 'outlook',
            receivedAt: msg.receivedDateTime,
          });

          result.newReplies++;
          result.replies.push({
            from: `${msg.from?.emailAddress?.name} <${msg.from?.emailAddress?.address}>`,
            subject: msg.subject,
            snippet: msg.bodyPreview,
            campaignName: campaignName || 'Direct Message',
            contactEmail: msg.from?.emailAddress?.address || '',
            receivedAt: msg.receivedDateTime,
          });

          console.log(`[OutlookReplyTracker] New message from ${msg.from?.emailAddress?.address}: "${msg.subject}"`);
        } catch (msgErr) {
          console.error('[OutlookReplyTracker] Error processing message:', msgErr);
        }
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(msg);
      console.error('[OutlookReplyTracker] Check failed:', msg);
      return result;
    }
  }

  /** Extract AImailPilot tracking IDs from message references */
  private extractTrackingIds(headerValue: string): string[] {
    if (!headerValue) return [];
    const regex = /<([a-f0-9-]{36,})@[^>]+>/gi;
    const ids: string[] = [];
    let match;
    while ((match = regex.exec(headerValue)) !== null) {
      ids.push(match[1]);
    }
    return ids;
  }

  /** Start automatic polling */
  startAutoCheck(orgId: string, intervalMinutes: number = 5): void {
    if (this.checkInterval) clearInterval(this.checkInterval);
    console.log(`[OutlookReplyTracker] Starting auto-check every ${intervalMinutes} minutes`);
    this.runCheck(orgId);
    this.checkInterval = setInterval(() => this.runCheck(orgId), intervalMinutes * 60 * 1000);
  }

  /** Stop automatic polling */
  stopAutoCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[OutlookReplyTracker] Auto-check stopped');
    }
  }

  private async runCheck(orgId: string): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      const result = await this.checkForReplies(orgId, 120);
      if (result.newReplies > 0) {
        console.log(`[OutlookReplyTracker] Auto-check found ${result.newReplies} new messages`);
      }
    } catch (error) {
      console.error('[OutlookReplyTracker] Auto-check error:', error);
    } finally {
      this.isChecking = false;
    }
  }

  getStatus(): { active: boolean; checking: boolean } {
    return { active: this.checkInterval !== null, checking: this.isChecking };
  }
}

export const outlookReplyTracker = new OutlookReplyTracker();
