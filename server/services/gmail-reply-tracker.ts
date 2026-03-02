/**
 * Gmail Reply Tracker Service
 * Uses Gmail API to detect replies to campaign emails.
 * 
 * How it works:
 * 1. Campaign emails are sent with custom headers (X-Mailflow-Tracking, Message-ID)
 * 2. This service polls Gmail via REST API for messages that are replies (In-Reply-To header)
 * 3. Matches replies to campaign messages by searching for references to our Message-IDs
 * 4. Updates campaign stats and tracking events when replies are detected
 */

import { OAuth2Client } from 'google-auth-library';
import { storage } from '../storage';

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string; size?: number };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string; size?: number };
    }>;
  };
  internalDate: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface ReplyCheckResult {
  checked: number;
  newReplies: number;
  errors: string[];
  replies: Array<{
    from: string;
    subject: string;
    snippet: string;
    campaignName: string;
    contactEmail: string;
    receivedAt: string;
  }>;
}

export class GmailReplyTracker {
  private checkInterval: NodeJS.Timeout | null = null;
  private isChecking = false;

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<string | null> {
    try {
      const oauth2Client = new OAuth2Client(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      if (credentials.access_token) {
        // Store the new access token
        const orgId = '550e8400-e29b-41d4-a716-446655440001';
        await storage.setApiSetting(orgId, 'gmail_access_token', credentials.access_token);
        if (credentials.expiry_date) {
          await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
        }
        return credentials.access_token;
      }
      return null;
    } catch (error) {
      console.error('[GmailReplyTracker] Token refresh failed:', error);
      return null;
    }
  }

  /**
   * Get a valid access token (refresh if expired)
   */
  private async getValidAccessToken(orgId: string): Promise<string | null> {
    const settings = await storage.getApiSettings(orgId);
    let accessToken = settings.gmail_access_token;
    const refreshToken = settings.gmail_refresh_token;
    const tokenExpiry = settings.gmail_token_expiry;
    const clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET;

    if (!accessToken && !refreshToken) {
      return null;
    }

    // Check if token is expired (with 5-minute buffer)
    if (tokenExpiry) {
      const expiryTime = parseInt(tokenExpiry);
      if (Date.now() > expiryTime - 300000) {
        // Token is expired or about to expire, refresh it
        if (refreshToken && clientId && clientSecret) {
          accessToken = await this.refreshAccessToken(refreshToken, clientId, clientSecret) || accessToken;
        }
      }
    }

    return accessToken || null;
  }

  /**
   * Call Gmail API with proper error handling
   */
  private async gmailFetch(accessToken: string, endpoint: string): Promise<any> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gmail API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Search Gmail for recent replies to campaign emails
   * Uses the In-Reply-To header to match replies to our sent messages
   */
  async checkForReplies(orgId: string, lookbackMinutes: number = 60): Promise<ReplyCheckResult> {
    const result: ReplyCheckResult = { checked: 0, newReplies: 0, errors: [], replies: [] };

    try {
      const accessToken = await this.getValidAccessToken(orgId);
      if (!accessToken) {
        result.errors.push('No Gmail access token available. Please re-authenticate with Google.');
        return result;
      }

      // Search for inbox messages from the last N minutes
      // We look for messages in INBOX that contain our tracking references
      const afterTimestamp = Math.floor((Date.now() - lookbackMinutes * 60 * 1000) / 1000);
      const query = `in:inbox after:${afterTimestamp} -from:me`;

      const listData: GmailListResponse = await this.gmailFetch(
        accessToken,
        `messages?q=${encodeURIComponent(query)}&maxResults=50`
      );

      if (!listData.messages || listData.messages.length === 0) {
        return result;
      }

      result.checked = listData.messages.length;

      // Get all sent campaign messages that haven't been replied to yet
      // We'll use a batch approach - get message details and check headers
      for (const msgRef of listData.messages) {
        try {
          const msg: GmailMessage = await this.gmailFetch(
            accessToken,
            `messages/${msgRef.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=In-Reply-To&metadataHeaders=References&metadataHeaders=Date&metadataHeaders=To`
          );

          const headers = msg.payload?.headers || [];
          const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

          const inReplyTo = getHeader('In-Reply-To');
          const references = getHeader('References');
          const from = getHeader('From');
          const subject = getHeader('Subject');
          const date = getHeader('Date');

          // Check if this is a reply to one of our campaign messages
          // Our Message-IDs look like: <trackingId@domain.com>
          const allRefs = `${inReplyTo} ${references}`;
          
          // Extract tracking IDs from references
          const trackingIds = this.extractTrackingIds(allRefs);

          for (const trackingId of trackingIds) {
            // Look up the campaign message by tracking ID
            const campaignMessage = await storage.getCampaignMessageByTracking(trackingId);
            if (!campaignMessage) continue;
            if (campaignMessage.repliedAt) continue; // Already tracked

            // This is a new reply to a campaign message!
            const campaign = await storage.getCampaign(campaignMessage.campaignId);
            const contact = campaignMessage.contactId
              ? await storage.getContact(campaignMessage.contactId)
              : null;

            // Update the message
            await storage.updateCampaignMessage(campaignMessage.id, {
              repliedAt: new Date(date || Date.now()).toISOString(),
            });

            // Update campaign stats
            if (campaign) {
              await storage.updateCampaign(campaignMessage.campaignId, {
                repliedCount: (campaign.repliedCount || 0) + 1,
              });
            }

            // Update contact status
            if (campaignMessage.contactId) {
              try {
                await storage.updateContact(campaignMessage.contactId, { status: 'replied' });
              } catch (e) { /* ignore */ }
            }

            // Create tracking event
            await storage.createTrackingEvent({
              type: 'reply',
              campaignId: campaignMessage.campaignId,
              messageId: campaignMessage.id,
              contactId: campaignMessage.contactId,
              trackingId,
              metadata: {
                gmailMessageId: msg.id,
                gmailThreadId: msg.threadId,
                fromEmail: from,
                subject,
                snippet: msg.snippet,
                detectedVia: 'gmail-api',
              },
            });

            result.newReplies++;
            result.replies.push({
              from,
              subject,
              snippet: msg.snippet || '',
              campaignName: campaign?.name || 'Unknown Campaign',
              contactEmail: contact?.email || from,
              receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
            });

            console.log(`[GmailReplyTracker] New reply detected from ${from} for campaign "${campaign?.name}" (tracking: ${trackingId})`);
          }
        } catch (msgError) {
          // Skip individual message errors
          console.error('[GmailReplyTracker] Error processing message:', msgError);
        }
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(msg);
      console.error('[GmailReplyTracker] Check failed:', msg);
      return result;
    }
  }

  /**
   * Extract Mailflow tracking IDs from In-Reply-To and References headers
   * Our Message-IDs look like: <uuid@domain.com>
   */
  private extractTrackingIds(headerValue: string): string[] {
    if (!headerValue) return [];
    
    // Match UUIDs or our tracking ID pattern from Message-ID references
    const messageIdRegex = /<([a-f0-9-]{36,})@[^>]+>/gi;
    const ids: string[] = [];
    let match;

    while ((match = messageIdRegex.exec(headerValue)) !== null) {
      ids.push(match[1]);
    }

    return ids;
  }

  /**
   * Start automatic polling for replies
   */
  startAutoCheck(orgId: string, intervalMinutes: number = 5): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    console.log(`[GmailReplyTracker] Starting auto-check every ${intervalMinutes} minutes`);

    // Run immediately
    this.runCheck(orgId);

    // Then schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.runCheck(orgId);
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop automatic polling
   */
  stopAutoCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[GmailReplyTracker] Auto-check stopped');
    }
  }

  /**
   * Run a single check (with lock to prevent overlapping)
   */
  private async runCheck(orgId: string): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const result = await this.checkForReplies(orgId, 120); // Check last 2 hours
      if (result.newReplies > 0) {
        console.log(`[GmailReplyTracker] Auto-check found ${result.newReplies} new replies`);
      }
    } catch (error) {
      console.error('[GmailReplyTracker] Auto-check error:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Get reply tracking status (is polling active, last check time, etc.)
   */
  getStatus(): { active: boolean; checking: boolean } {
    return {
      active: this.checkInterval !== null,
      checking: this.isChecking,
    };
  }
}

export const gmailReplyTracker = new GmailReplyTracker();
