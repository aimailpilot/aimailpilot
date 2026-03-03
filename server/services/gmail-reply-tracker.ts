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

      // Pre-load unreplied campaign messages for thread-based matching
      const unrepliedMessages = await storage.getUnrepliedCampaignMessages(orgId);
      const threadIdToMessage = new Map<string, any>();
      for (const um of unrepliedMessages) {
        if (um.providerMessageId) {
          threadIdToMessage.set(um.providerMessageId, um);
        }
      }

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

          // Skip bounce/delivery notifications - these are not real replies
          const fromLower = from.toLowerCase();
          if (fromLower.includes('mailer-daemon') || 
              fromLower.includes('postmaster') ||
              fromLower.includes('mail delivery') ||
              subject.toLowerCase().includes('delivery status notification') ||
              subject.toLowerCase().includes('undeliverable') ||
              subject.toLowerCase().includes('mail delivery failed')) {
            continue;
          }

          // Check if this is a reply to one of our campaign messages
          // Method 1: Match via In-Reply-To / References headers (Message-ID matching)
          const allRefs = `${inReplyTo} ${references}`;
          const trackingIds = this.extractTrackingIds(allRefs);

          // Method 2: Match via Gmail thread ID (if this message's threadId matches a sent campaign message)
          let threadMatchedMessage: any = null;
          if (trackingIds.length === 0 && msgRef.threadId) {
            threadMatchedMessage = threadIdToMessage.get(msgRef.threadId);
            if (threadMatchedMessage && !threadMatchedMessage.repliedAt) {
              // Thread-based match found — treat it like a tracking ID match
              trackingIds.push(threadMatchedMessage.trackingId);
              console.log(`[GmailReplyTracker] Thread-based reply match: threadId=${msgRef.threadId} -> trackingId=${threadMatchedMessage.trackingId}`);
            }
          }

          for (const trackingId of trackingIds) {
            // Look up the campaign message by tracking ID
            const campaignMessage = threadMatchedMessage || await storage.getCampaignMessageByTracking(trackingId);
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

            // Also store in unified_inbox for the Unified Inbox feature
            const existingInbox = await storage.getInboxMessageByGmailId(msg.id);
            if (!existingInbox) {
              // Fetch full message body for unified inbox
              let body = msg.snippet || '';
              let bodyHtml = '';
              try {
                const fullMsg: GmailMessage = await this.gmailFetch(accessToken, `messages/${msg.id}?format=full`);
                const parts = fullMsg.payload?.parts || [];
                for (const part of parts) {
                  if (part.mimeType === 'text/html' && part.body?.data) {
                    bodyHtml = Buffer.from(part.body.data, 'base64url').toString('utf-8');
                  } else if (part.mimeType === 'text/plain' && part.body?.data) {
                    body = Buffer.from(part.body.data, 'base64url').toString('utf-8');
                  }
                }
                // Single-part message
                if (!bodyHtml && !body && fullMsg.payload?.body?.data) {
                  body = Buffer.from(fullMsg.payload.body.data, 'base64url').toString('utf-8');
                }
              } catch (e) { /* fallback to snippet */ }

              const settings = await storage.getApiSettings(orgId);
              await storage.createInboxMessage({
                organizationId: orgId,
                emailAccountId: null,
                campaignId: campaignMessage.campaignId,
                messageId: campaignMessage.id,
                contactId: campaignMessage.contactId,
                gmailMessageId: msg.id,
                gmailThreadId: msg.threadId,
                fromEmail: from,
                fromName: from.replace(/<.*>/, '').trim(),
                toEmail: settings.gmail_email || '',
                subject,
                snippet: msg.snippet || '',
                body,
                bodyHtml,
                status: 'unread',
                provider: 'gmail',
                receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
              });
              console.log(`[GmailReplyTracker] Stored reply in unified inbox from ${from}`);
            }

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
   * Our Message-IDs look like: <campaignId_contactId_timestamp@domain.com>
   * e.g. <394bf3f5-2086-41fa-bbad-3f66fde2f292_956a6436-89e0-42d6-b654-2484fea8c874_1772551404099@aegis.edu.in>
   */
  private extractTrackingIds(headerValue: string): string[] {
    if (!headerValue) return [];
    
    // Match our tracking ID pattern: uuid_uuid_timestamp (contains hex, hyphens, underscores, digits)
    const messageIdRegex = /<([a-f0-9][a-f0-9_-]{35,})@[^>]+>/gi;
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
      const result = await this.checkForReplies(orgId, 1440); // Check last 24 hours
      if (result.newReplies > 0) {
        console.log(`[GmailReplyTracker] Auto-check found ${result.newReplies} new replies`);
      }
      // Also check for opens via Gmail API (sent messages thread activity)
      await this.checkForOpensViaApi(orgId);
    } catch (error) {
      console.error('[GmailReplyTracker] Auto-check error:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check for email opens via Gmail API
   * Gmail doesn't provide read receipts, but we can detect opens by:
   * 1. Querying sent messages that match our campaign Message-IDs
   * 2. Checking if the thread has any interaction (label changes, replies)
   * 3. For sent messages in threads - if the thread has INBOX label removed from
   *    the sent message, it means the recipient's mail server processed it
   * 
   * This supplements pixel tracking since Gmail's image proxy caches pixels.
   */
  private async checkForOpensViaApi(orgId: string): Promise<void> {
    try {
      const accessToken = await this.getValidAccessToken(orgId);
      if (!accessToken) return;

      // Find recent campaign messages (last 24h) that haven't been marked as opened
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const unopenedMessages = await storage.getUnopenedCampaignMessages(orgId, cutoff);
      
      if (unopenedMessages.length === 0) return;

      // For each unopened message, check the Gmail thread for read activity
      let opensDetected = 0;
      for (const msg of unopenedMessages) {
        try {
          if (!msg.providerMessageId) continue;

          // Get the thread for our sent message
          // Gmail providerMessageId is the Gmail message ID
          const gmailMsg = await this.gmailFetch(
            accessToken,
            `messages/${msg.providerMessageId}?format=metadata&metadataHeaders=From&metadataHeaders=To`
          );

          if (!gmailMsg || !gmailMsg.threadId) continue;

          // Check the thread - if it has multiple messages, recipient replied (handled by checkForReplies)
          // But we can also check if the sent message labels changed - Gmail removes UNREAD for read threads
          const thread = await this.gmailFetch(
            accessToken,
            `threads/${gmailMsg.threadId}?format=metadata`
          );

          if (!thread || !thread.messages) continue;

          // A thread with >1 message means someone replied - that counts as an open
          // Also check if any message in the thread was read (UNREAD label removed from thread)
          const hasReply = thread.messages.length > 1;
          const threadLabels = thread.messages.flatMap((m: any) => m.labelIds || []);
          const hasUnread = threadLabels.includes('UNREAD');
          
          // If thread has a reply OR the thread is no longer unread, count as opened
          if (hasReply || !hasUnread) {
            // Mark as opened
            await storage.updateCampaignMessage(msg.id, { openedAt: new Date().toISOString() });
            
            const campaign = await storage.getCampaign(msg.campaignId);
            if (campaign) {
              await storage.updateCampaign(msg.campaignId, {
                openedCount: (campaign.openedCount || 0) + 1,
              });
            }

            // Create tracking event
            await storage.createTrackingEvent({
              type: 'open',
              campaignId: msg.campaignId,
              messageId: msg.id,
              contactId: msg.contactId,
              trackingId: msg.trackingId,
              metadata: JSON.stringify({ detectedVia: 'gmail-api-thread', threadId: gmailMsg.threadId, reason: hasReply ? 'thread_reply' : 'thread_read' }),
            });

            opensDetected++;
          }
        } catch (e) {
          // Skip individual message errors silently
        }
      }

      if (opensDetected > 0) {
        console.log(`[GmailReplyTracker] Detected ${opensDetected} opens via Gmail API thread analysis`);
      }
    } catch (error) {
      // Don't let open detection errors affect reply checking
      console.error('[GmailReplyTracker] Open detection error:', error instanceof Error ? error.message : error);
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
