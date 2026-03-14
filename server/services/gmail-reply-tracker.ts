/**
 * Gmail Reply Tracker Service
 * Uses Gmail API to detect replies to campaign emails.
 * 
 * How it works:
 * 1. Campaign emails are sent with custom headers (X-AImailPilot-Tracking, Message-ID)
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
    clientSecret: string,
    orgId?: string
  ): Promise<string | null> {
    try {
      const oauth2Client = new OAuth2Client(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      if (credentials.access_token) {
        // Store the new access token in the org's settings
        if (orgId) {
          await storage.setApiSetting(orgId, 'gmail_access_token', credentials.access_token);
          if (credentials.expiry_date) {
            await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
          }
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
          accessToken = await this.refreshAccessToken(refreshToken, clientId, clientSecret, orgId) || accessToken;
        }
      }
    }

    return accessToken || null;
  }

  /**
   * Call Gmail API with proper error handling and retry logic
   */
  private async gmailFetch(accessToken: string, endpoint: string, retries: number = 2): Promise<any> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (response.status === 429) {
          // Rate limited — wait and retry
          const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
          console.warn(`[GmailReplyTracker] Rate limited, waiting ${retryAfter}s (attempt ${attempt + 1}/${retries + 1})`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        if (response.status === 401) {
          // Token expired during this check cycle
          throw new Error(`Gmail API auth error (401): Token may have expired`);
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gmail API error (${response.status}): ${errorText}`);
        }

        return response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          const delay = (attempt + 1) * 2000; // 2s, 4s backoff
          console.warn(`[GmailReplyTracker] Gmail API call failed (attempt ${attempt + 1}), retrying in ${delay}ms:`, lastError.message);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error('Gmail API call failed after retries');
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
      // Use broader search: include inbox messages AND bounce notifications (which may land in spam or categories)
      // Search for both regular replies and bounce notifications from MAILER-DAEMON/postmaster
      const query = `after:${afterTimestamp} -from:me (in:inbox OR from:mailer-daemon OR from:postmaster OR subject:"delivery status notification" OR subject:"undeliverable" OR subject:"mail delivery failed")`;

      const listData: GmailListResponse = await this.gmailFetch(
        accessToken,
        `messages?q=${encodeURIComponent(query)}&maxResults=100`
      );

      if (!listData.messages || listData.messages.length === 0) {
        return result;
      }

      result.checked = listData.messages.length;
      console.log(`[GmailReplyTracker] Found ${listData.messages.length} messages in inbox (lookback: ${lookbackMinutes}m)`);

      // Pre-load campaign messages for matching
      // Use ALL recent messages (including already-replied) for inbox context matching
      // Use unreplied messages separately for new reply detection
      const allCampaignMessages = await storage.getAllRecentCampaignMessages(orgId);
      const providerIdToMessage = new Map<string, any>();
      const contactEmailToMessages = new Map<string, any[]>();
      const contactCampaignToMessages = new Map<string, any[]>();
      
      console.log(`[GmailReplyTracker] Loaded ${allCampaignMessages.length} campaign messages for matching`);
      
      for (const um of allCampaignMessages) {
        if (um.providerMessageId) {
          providerIdToMessage.set(um.providerMessageId, um);
        }
        // Build email -> messages map for bounce matching
        if (um.contactEmail) {
          const emailLower = um.contactEmail.toLowerCase();
          const emailMsgs = contactEmailToMessages.get(emailLower) || [];
          emailMsgs.push(um);
          contactEmailToMessages.set(emailLower, emailMsgs);
        }
        // Group by contactId_campaignId for step attribution
        const key = `${um.contactId}_${um.campaignId}`;
        const existing = contactCampaignToMessages.get(key) || [];
        existing.push(um);
        contactCampaignToMessages.set(key, existing);
      }
      
      console.log(`[GmailReplyTracker] Maps built: ${providerIdToMessage.size} by providerId, ${contactEmailToMessages.size} by email, ${contactCampaignToMessages.size} by contact+campaign`);

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

          // ===== BOUNCE DETECTION =====
          // Detect bounce/delivery failure notifications and mark contacts as bounced
          const fromLower = from.toLowerCase();
          const subjectLower = subject.toLowerCase();
          const isBounceNotification = (
            fromLower.includes('mailer-daemon') || 
            fromLower.includes('postmaster') ||
            fromLower.includes('mail delivery') ||
            subjectLower.includes('delivery status notification') ||
            subjectLower.includes('undeliverable') ||
            subjectLower.includes('mail delivery failed') ||
            subjectLower.includes('returned mail') ||
            subjectLower.includes('failure notice') ||
            subjectLower.includes('delivery failure')
          );
          
          // Skip auto-replies (out of office, etc.) - these are NOT bounces
          const isAutoReply = (
            subjectLower.includes('out of office') ||
            subjectLower.includes('automatic reply') ||
            subjectLower.includes('auto-reply') ||
            subjectLower.includes('autoreply') ||
            (fromLower.includes('noreply') && !isBounceNotification) ||
            (fromLower.includes('no-reply') && !isBounceNotification)
          );
          
          if (isAutoReply) {
            continue;
          }
          
          if (isBounceNotification) {
            console.log(`[GmailReplyTracker] Bounce notification detected: from="${from}", subject="${subject}", msgId=${msgRef.id}`);
            // Extract bounced email from the bounce notification
            // Bounces typically reference the original email in In-Reply-To / References headers
            // or contain the failed recipient email in the body/snippet
            try {
              // Try to get the full message body for bounce details
              let bounceBody = msg.snippet || '';
              try {
                const fullMsg = await this.gmailFetch(accessToken, `messages/${msgRef.id}?format=full`);
                const bodyData = fullMsg.payload?.body?.data || '';
                const parts = fullMsg.payload?.parts || [];
                if (bodyData) {
                  bounceBody = Buffer.from(bodyData, 'base64').toString('utf-8');
                } else if (parts.length > 0) {
                  for (const part of parts) {
                    if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
                      bounceBody += Buffer.from(part.body.data, 'base64').toString('utf-8');
                    }
                  }
                }
              } catch (e) {
                // Fall back to snippet
              }
              
              // Extract bounced email address from body
              // Common patterns: "550 5.1.1 <user@example.com>", "user@example.com: No such user"
              const emailPattern = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
              const foundEmails = bounceBody.match(emailPattern) || [];
              console.log(`[GmailReplyTracker] Bounce body extracted ${foundEmails.length} emails: ${foundEmails.slice(0, 5).join(', ')}`);
              
              // Also check In-Reply-To/References for the original tracking ID
              const allRefs = `${inReplyTo} ${references}`;
              const trackingIds = this.extractTrackingIds(allRefs);
              console.log(`[GmailReplyTracker] Bounce tracking IDs from headers: ${trackingIds.length > 0 ? trackingIds.join(', ') : 'none'}`);
              
              // Find the bounced contact
              let bouncedContact: any = null;
              let bouncedMessage: any = null;
              
              // Method 1: Match via tracking IDs in In-Reply-To/References headers
              if (trackingIds.length > 0) {
                console.log(`[GmailReplyTracker] Bounce Method 1: Trying ${trackingIds.length} tracking IDs`);
                for (const tid of trackingIds) {
                  const match = providerIdToMessage.get(tid);
                  if (match) {
                    console.log(`[GmailReplyTracker] Bounce Method 1 HIT: trackingId=${tid}, contactId=${match.contactId}`);
                    bouncedMessage = match;
                    try {
                      const contact = await storage.getContact(match.contactId);
                      if (contact) bouncedContact = contact;
                    } catch (e) {}
                    break;
                  }
                }
              }
              
              // Method 2: Match bounced email from body/snippet against campaign contacts
              // This is the most reliable method - extract email from bounce notification body
              if (!bouncedContact && foundEmails.length > 0) {
                console.log(`[GmailReplyTracker] Bounce Method 2: Trying ${foundEmails.length} extracted emails`);
                for (const email of foundEmails) {
                  const emailLower = email.toLowerCase();
                  // Skip system addresses
                  if (emailLower.includes('mailer-daemon') || emailLower.includes('postmaster') || emailLower.includes('noreply')) continue;
                  console.log(`[GmailReplyTracker] Bounce Method 2: Checking email ${emailLower}`);
                  
                  // Use the contactEmail map (built from JOIN with contacts table)
                  const matchedMsgs = contactEmailToMessages.get(emailLower);
                  if (matchedMsgs && matchedMsgs.length > 0) {
                    console.log(`[GmailReplyTracker] Bounce Method 2 HIT via contactEmailMap: ${emailLower} -> contactId=${matchedMsgs[0].contactId}`);
                    bouncedMessage = matchedMsgs[0];
                    try {
                      const contact = await storage.getContact(bouncedMessage.contactId);
                      if (contact) bouncedContact = contact;
                    } catch (e) {}
                    break;
                  }
                  
                  // Fallback: search ALL org contacts (not just unreplied messages)
                  if (!bouncedContact) {
                    try {
                      const contact = await storage.getContactByEmail(orgId, emailLower);
                      if (contact) {
                        console.log(`[GmailReplyTracker] Bounce Fallback HIT: Found contact ${(contact as any).email} (id=${(contact as any).id}) in org contacts`);
                        bouncedContact = contact;
                        // Try to find associated campaign message
                        for (const [, msgs] of contactCampaignToMessages) {
                          for (const m of msgs) {
                            if (m.contactId === (contact as any).id) {
                              bouncedMessage = m;
                              break;
                            }
                          }
                          if (bouncedMessage) break;
                        }
                      }
                    } catch (e) {}
                  }
                  if (bouncedContact) break;
                }
              }
              
              // Process the bounce
              if (bouncedContact && (bouncedContact as any).status !== 'bounced') {
                const contactEmail = (bouncedContact as any).email || 'unknown';
                console.log(`[GmailReplyTracker] BOUNCE DETECTED: ${contactEmail} (from: ${from}, subject: ${subject})`);
                console.log(`[GmailReplyTracker] Marking contact ${(bouncedContact as any).id} as bounced (was: ${(bouncedContact as any).status})`);
                
                // Mark contact as bounced
                await storage.updateContact(bouncedContact.id, { status: 'bounced' });
                
                // Update campaign message status to failed/bounced
                if (bouncedMessage) {
                  await storage.updateCampaignMessage(bouncedMessage.id, {
                    status: 'failed',
                    errorMessage: `Bounce detected: ${subject}`,
                  });
                  
                  // Create bounce tracking event
                  try {
                    await storage.createTrackingEvent({
                      type: 'bounce',
                      campaignId: bouncedMessage.campaignId,
                      messageId: bouncedMessage.id,
                      contactId: bouncedContact.id,
                      trackingId: bouncedMessage.trackingId || `bounce-${bouncedContact.id}`,
                      metadata: JSON.stringify({ reason: subject, from, detectedAt: new Date().toISOString() }),
                    });
                  } catch (e) {}
                  
                  // Update campaign bounce count
                  try {
                    const campaign = await storage.getCampaign(bouncedMessage.campaignId);
                    if (campaign) {
                      await storage.updateCampaign(bouncedMessage.campaignId, {
                        bouncedCount: (campaign.bouncedCount || 0) + 1,
                        sentCount: Math.max(0, (campaign.sentCount || 0) - 1),
                      });
                    }
                  } catch (e) {}
                }
                
                result.newReplies++; // Count as an event detected
                result.replies.push({
                  from,
                  subject,
                  snippet: `BOUNCE: ${contactEmail} - ${msg.snippet?.slice(0, 100) || subject}`,
                  campaignName: bouncedMessage?.campaignName || 'Unknown',
                  contactEmail,
                  receivedAt: date || new Date().toISOString(),
                });
              } else if (bouncedContact) {
                console.log(`[GmailReplyTracker] Bounce skipped: contact ${(bouncedContact as any).email} already status=${(bouncedContact as any).status}`);
              } else {
                console.log(`[GmailReplyTracker] Bounce: No matching contact found for bounce notification (from: ${from}, subject: ${subject})`);
              }
            } catch (bounceError) {
              console.error('[GmailReplyTracker] Error processing bounce notification:', bounceError);
            }
            continue; // Don't process bounce as a reply
          }

          // Extract sender email from "Name <email>" format
          const senderEmail = (from.match(/<([^>]+)>/) || [, from.split('@').length === 2 ? from.trim() : ''])[1]?.toLowerCase() || '';

          // Check if this is a reply to one of our campaign messages
          // Method 1: Match via In-Reply-To / References headers (Message-ID matching)
          const allRefs = `${inReplyTo} ${references}`;
          const trackingIds = this.extractTrackingIds(allRefs);

          // Method 2: Match via Gmail thread ID (if this message's threadId matches a sent campaign message)
          let threadMatchedMessage: any = null;
          if (trackingIds.length === 0 && msgRef.threadId) {
            const step0Match = providerIdToMessage.get(msgRef.threadId);
            if (step0Match) {
              // Found the step-0 message via thread ID
              // Find the MOST RECENT message for this contact+campaign (prefer unreplied)
              const key = `${step0Match.contactId}_${step0Match.campaignId}`;
              const allContactMsgs = contactCampaignToMessages.get(key) || [step0Match];
              
              const sorted = [...allContactMsgs].sort((a: any, b: any) => {
                const aTime = new Date(a.sentAt || 0).getTime();
                const bTime = new Date(b.sentAt || 0).getTime();
                return bTime - aTime;
              });
              
              // Pick the most recent unreplied message, or fallback to most recent
              threadMatchedMessage = sorted.find((m: any) => !m.repliedAt) || sorted[0] || step0Match;
              
              trackingIds.push(threadMatchedMessage.trackingId);
              console.log(`[GmailReplyTracker] Thread-based match: threadId=${msgRef.threadId} -> step=${threadMatchedMessage.stepNumber || 0}, trackingId=${threadMatchedMessage.trackingId}, alreadyReplied=${!!threadMatchedMessage.repliedAt}`);
            }
          }

          // Method 3: Match by sender email address + "Re:" subject pattern
          // If no header/thread match, check if the sender email matches any contact
          // we sent a campaign to AND the subject starts with "Re:" (indicating a reply)
          if (trackingIds.length === 0 && senderEmail && subject.toLowerCase().startsWith('re:')) {
            for (const [key, msgs] of contactCampaignToMessages.entries()) {
              // Sort by sentAt DESC - prefer unreplied but allow already-replied for context
              const sorted = [...msgs].sort((a: any, b: any) => {
                const aTime = new Date(a.sentAt || 0).getTime();
                const bTime = new Date(b.sentAt || 0).getTime();
                return bTime - aTime;
              });
              for (const um of sorted) {
                const contact = um.contactId ? await storage.getContact(um.contactId) : null;
                if (contact && contact.email?.toLowerCase() === senderEmail) {
                  threadMatchedMessage = um;
                  trackingIds.push(um.trackingId);
                  console.log(`[GmailReplyTracker] Email-based match: ${senderEmail} -> campaign=${um.campaignId}, step=${um.stepNumber || 0}, alreadyReplied=${!!um.repliedAt}`);
                  break;
                }
              }
              if (trackingIds.length > 0) break;
            }
          }

          // First: resolve the best matching campaign message (even if already replied)
          let matchedCampaignMessage: any = null;
          for (const trackingId of trackingIds) {
            matchedCampaignMessage = threadMatchedMessage || await storage.getCampaignMessageByTracking(trackingId);
            if (matchedCampaignMessage) break;
          }

          // ALWAYS store in unified_inbox regardless of whether reply was already tracked
          // This ensures the inbox shows all received messages
          const existingInbox = await storage.getInboxMessageByGmailId(msg.id);
          if (!existingInbox) {
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
              if (!bodyHtml && !body && fullMsg.payload?.body?.data) {
                body = Buffer.from(fullMsg.payload.body.data, 'base64url').toString('utf-8');
              }
            } catch (e) { /* fallback to snippet */ }

            // Determine emailAccountId from campaign message or by matching toEmail to email accounts
            let emailAccountId = matchedCampaignMessage?.emailAccountId || null;
            if (!emailAccountId) {
              try {
                const orgAccounts = await storage.getEmailAccounts(orgId);
                const toHeader = (msg.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'to')?.value || '';
                const toEmailAddr = (toHeader.match(/<([^>]+)>/) || [, toHeader.trim()])[1]?.toLowerCase() || '';
                const matchedAccount = orgAccounts.find((a: any) => a.email?.toLowerCase() === toEmailAddr);
                if (matchedAccount) emailAccountId = matchedAccount.id;
              } catch (e) { /* ignore */ }
            }

            const settings = await storage.getApiSettings(orgId);
            await storage.createInboxMessage({
              organizationId: orgId,
              emailAccountId,
              campaignId: matchedCampaignMessage?.campaignId || null,
              messageId: matchedCampaignMessage?.id || null,
              contactId: matchedCampaignMessage?.contactId || null,
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromEmail: from,
              fromName: from.replace(/<.*>/, '').trim(),
              toEmail: settings.gmail_user_email || '',
              subject,
              snippet: msg.snippet || '',
              body,
              bodyHtml,
              status: 'unread',
              provider: 'gmail',
              receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
            });
            console.log(`[GmailReplyTracker] Stored message in unified inbox from ${from} (campaign match: ${!!matchedCampaignMessage})`);
          }

          // Now process as new reply only if not already tracked
          for (const trackingId of trackingIds) {
            const campaignMessage = threadMatchedMessage || await storage.getCampaignMessageByTracking(trackingId);
            if (!campaignMessage) continue;
            if (campaignMessage.repliedAt) continue; // Already tracked

            // This is a new reply to a campaign message!
            const campaign = await storage.getCampaign(campaignMessage.campaignId);
            const contact = campaignMessage.contactId
              ? await storage.getContact(campaignMessage.contactId)
              : null;

            await storage.updateCampaignMessage(campaignMessage.id, {
              repliedAt: new Date(date || Date.now()).toISOString(),
            });

            if (campaign) {
              await storage.updateCampaign(campaignMessage.campaignId, {
                repliedCount: (campaign.repliedCount || 0) + 1,
              });
            }

            if (campaignMessage.contactId) {
              try {
                await storage.updateContact(campaignMessage.contactId, { status: 'replied' });
              } catch (e) { /* ignore */ }
              try {
                await storage.cancelPendingFollowupsForContact(campaignMessage.contactId, campaignMessage.campaignId);
                console.log(`[GmailReplyTracker] Cancelled pending follow-ups for contact ${campaignMessage.contactId} in campaign ${campaignMessage.campaignId}`);
              } catch (e) { /* ignore */ }
            }

            await storage.createTrackingEvent({
              type: 'reply',
              campaignId: campaignMessage.campaignId,
              messageId: campaignMessage.id,
              contactId: campaignMessage.contactId,
              trackingId,
              stepNumber: campaignMessage.stepNumber || 0,
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
   * Extract AImailPilot tracking IDs from In-Reply-To and References headers
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
      if (result.errors.length > 0) {
        console.warn(`[GmailReplyTracker] Auto-check completed with ${result.errors.length} error(s):`, result.errors[0]);
      }
      // Also check for opens via Gmail API (sent messages thread activity)
      await this.checkForOpensViaApi(orgId);
    } catch (error) {
      // CRITICAL: Never let an error stop the auto-checker — it must keep running
      console.error('[GmailReplyTracker] Auto-check error (will retry next cycle):', error instanceof Error ? error.message : error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check for email opens via Gmail API
   * Gmail doesn't provide direct read receipts. We can only reliably detect opens when:
   * 1. The thread has a reply from someone other than us (if they replied, they opened it)
   * 2. A prefetch event arrives >90 seconds after send (heuristic from pixel tracking)
   * 
   * NOTE: Checking UNREAD labels is unreliable because sent-only threads never have
   * UNREAD labels from the sender's perspective, causing false positives.
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

      // For each unopened message, check the Gmail thread for reply activity
      let opensDetected = 0;
      for (const msg of unopenedMessages) {
        try {
          if (!msg.providerMessageId) continue;

          // Get the thread for our sent message
          const thread = await this.gmailFetch(
            accessToken,
            `threads/${msg.providerMessageId}?format=metadata&metadataHeaders=From`
          );

          if (!thread || !thread.messages) continue;

          // Only count as opened if there's a reply from someone other than the sender
          // A thread with >1 message means someone replied - that counts as an open
          if (thread.messages.length > 1) {
            // Verify at least one message is NOT from us (not just our own followup)
            const settings = await storage.getApiSettings(orgId);
            const ourEmail = (settings.gmail_user_email || '').toLowerCase();
            const hasExternalReply = thread.messages.some((m: any) => {
              const from = (m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
              return !from.toLowerCase().includes(ourEmail);
            });

            if (hasExternalReply) {
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
                metadata: JSON.stringify({ detectedVia: 'gmail-api-thread', threadId: msg.providerMessageId, reason: 'thread_reply' }),
              });

              opensDetected++;
            }
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
