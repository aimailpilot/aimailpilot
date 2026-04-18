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
  // Support multiple orgs — each org gets its own interval
  private checkIntervals: Map<string, NodeJS.Timeout> = new Map();
  // Per-org lock: prevents overlapping checks for the SAME org while allowing different orgs to check in parallel
  private checkingOrgs: Set<string> = new Set();
  private lastCheckedAt: Map<string, string> = new Map();
  // Keep backward compat for getStatus()
  private get isChecking(): boolean { return this.checkingOrgs.size > 0; }

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
   * Can get token for a specific sender email or the org-level default
   */
  private async getValidAccessToken(orgId: string, senderEmail?: string): Promise<string | null> {
    const settings = await storage.getApiSettings(orgId);
    
    // Try per-sender tokens first if senderEmail specified
    const senderPrefix = senderEmail ? `gmail_sender_${senderEmail}_` : '';
    let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
    let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
    let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;
    let isPerSender = !!(accessToken || refreshToken);
    
    // Fall back to org-level tokens ONLY if no per-sender tokens exist at all
    // CRITICAL: Don't mix refresh tokens from different accounts!
    if (!accessToken && !refreshToken) {
      accessToken = settings.gmail_access_token;
      refreshToken = settings.gmail_refresh_token;
      tokenExpiry = settings.gmail_token_expiry;
      isPerSender = false;
    }

    let clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID;
    let clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET;

    // Fallback: try superadmin's org for OAuth credentials
    if (!clientId || !clientSecret) {
      try {
        const superAdminOrgId = await storage.getSuperAdminOrgId();
        if (superAdminOrgId && superAdminOrgId !== orgId) {
          const superSettings = await storage.getApiSettings(superAdminOrgId);
          if (superSettings.google_oauth_client_id) {
            clientId = superSettings.google_oauth_client_id;
            clientSecret = superSettings.google_oauth_client_secret || '';
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (!clientId) clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientSecret) clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!accessToken && !refreshToken) {
      return null;
    }

    // Check if token is expired (with 5-minute buffer)
    if (tokenExpiry) {
      const expiryTime = parseInt(tokenExpiry);
      if (Date.now() > expiryTime - 300000) {
        // Token is expired or about to expire, refresh it
        if (refreshToken && clientId && clientSecret) {
          try {
            const oauth2Client = new OAuth2Client(clientId, clientSecret);
            oauth2Client.setCredentials({ refresh_token: refreshToken });
            const { credentials } = await oauth2Client.refreshAccessToken();
            if (credentials.access_token) {
              // Store refreshed token back to the CORRECT location
              if (isPerSender && senderEmail) {
                await storage.setApiSetting(orgId, `${senderPrefix}access_token`, credentials.access_token);
                if (credentials.expiry_date) await storage.setApiSetting(orgId, `${senderPrefix}token_expiry`, String(credentials.expiry_date));
              } else {
                // Org-level token
                await storage.setApiSetting(orgId, 'gmail_access_token', credentials.access_token);
                if (credentials.expiry_date) await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
              }
              accessToken = credentials.access_token;
            }
          } catch (e) {
            console.error(`[GmailReplyTracker] Token refresh failed for ${senderEmail || 'org-default'}:`, e);
          }
        }
      }
    }

    return accessToken || null;
  }

  /**
   * Get ALL Gmail accounts for an organization that have OAuth tokens.
   * Returns array of { email, accessToken } for each connected account.
   */
  private async getAllGmailTokens(orgId: string): Promise<Array<{ email: string; accessToken: string }>> {
    const tokens: Array<{ email: string; accessToken: string }> = [];
    const settings = await storage.getApiSettings(orgId);
    const seenEmails = new Set<string>();

    // 1. Collect per-sender tokens from API settings
    //    Keys like: gmail_sender_bharatai5@aegis.edu.in_access_token
    for (const key of Object.keys(settings)) {
      const match = key.match(/^gmail_sender_(.+?)_(?:access_token|refresh_token)$/);
      if (match) {
        const email = match[1];
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);
        const token = await this.getValidAccessToken(orgId, email);
        if (token) {
          tokens.push({ email, accessToken: token });
        }
      }
    }

    // 2. Add org-level default token (if not already found via per-sender)
    const orgEmail = settings.gmail_user_email || '';
    if (!seenEmails.has(orgEmail.toLowerCase())) {
      const token = await this.getValidAccessToken(orgId);
      if (token) {
        tokens.push({ email: orgEmail || 'org-default', accessToken: token });
        if (orgEmail) seenEmails.add(orgEmail.toLowerCase());
      }
    }

    // 3. Check email_accounts table for additional Gmail accounts with OAuth
    try {
      const emailAccounts = await storage.getEmailAccounts(orgId);
      for (const acct of emailAccounts as any[]) {
        if (!acct.email || seenEmails.has(acct.email.toLowerCase())) continue;
        if (acct.provider !== 'gmail' && acct.provider !== 'google') continue;
        // Try to get a token for this sender
        const token = await this.getValidAccessToken(orgId, acct.email);
        if (token) {
          tokens.push({ email: acct.email, accessToken: token });
          seenEmails.add(acct.email.toLowerCase());
        }
      }
    } catch (e) { /* ignore */ }

    return tokens;
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

        if (response.status === 404) {
          // Message was deleted/moved between list and get — benign race condition, skip silently
          return null;
        }

        if (response.status === 400) {
          // Invalid message/thread ID (deleted, expired, or malformed) — skip silently, no retry
          return null;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gmail API error (${response.status}): ${errorText}`);
        }

        return response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Don't retry on 401 — token won't un-expire in 2s. Bubble up immediately so
        // caller skips this account's cycle (saves ~6s of wasted retries per bad token).
        if (lastError.message.includes('401')) {
          throw lastError;
        }
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
      // Get ALL Gmail accounts for this org (multi-account support)
      const allTokens = await this.getAllGmailTokens(orgId);
      if (allTokens.length === 0) {
        // Fallback to org-level token
        const orgToken = await this.getValidAccessToken(orgId);
        if (!orgToken) {
          result.errors.push('No Gmail access token available. Please re-authenticate with Google.');
          return result;
        }
        allTokens.push({ email: 'org-default', accessToken: orgToken });
      }

      console.log(`[GmailReplyTracker] Checking ${allTokens.length} Gmail account(s): ${allTokens.map(t => t.email).join(', ')}`);

      // Pre-load campaign messages ONCE for matching (shared across all accounts)
      const allCampaignMessages = await storage.getAllRecentCampaignMessages(orgId);
      const providerIdToMessage = new Map<string, any>();
      const contactEmailToMessages = new Map<string, any[]>();
      const contactCampaignToMessages = new Map<string, any[]>();
      
      console.log(`[GmailReplyTracker] Loaded ${allCampaignMessages.length} campaign messages for matching`);
      
      for (const um of allCampaignMessages) {
        if (um.providerMessageId) {
          providerIdToMessage.set(um.providerMessageId, um);
        }
        if (um.contactEmail) {
          const emailLower = um.contactEmail.toLowerCase();
          const emailMsgs = contactEmailToMessages.get(emailLower) || [];
          emailMsgs.push(um);
          contactEmailToMessages.set(emailLower, emailMsgs);
        }
        const key = `${um.contactId}_${um.campaignId}`;
        const existing = contactCampaignToMessages.get(key) || [];
        existing.push(um);
        contactCampaignToMessages.set(key, existing);
      }
      
      console.log(`[GmailReplyTracker] Maps built: ${providerIdToMessage.size} by providerId, ${contactEmailToMessages.size} by email, ${contactCampaignToMessages.size} by contact+campaign`);

      // Build set of org's own sender emails (email_accounts + warmup_accounts) to skip warmup/internal mail
      const ownEmailsSet = new Set<string>();
      try {
        const orgAccounts = await storage.getEmailAccounts(orgId);
        for (const a of orgAccounts) if (a.email) ownEmailsSet.add(a.email.toLowerCase());
        const warmupRows = await storage.rawAll(
          `SELECT ea.email FROM warmup_accounts wa
           JOIN email_accounts ea ON ea.id = wa."emailAccountId"
           WHERE wa."organizationId" = ? AND ea.email IS NOT NULL`, orgId
        ) as any[];
        for (const r of warmupRows) if (r.email) ownEmailsSet.add(r.email.toLowerCase());
      } catch (e) { /* non-fatal — if this fails, process all messages as before */ }

      // Track already-seen Gmail message IDs to avoid duplicate processing across accounts
      const processedGmailIds = new Set<string>();

      // Check EACH Gmail account — with 1-5s jitter between accounts to prevent
      // thundering herd on PG pool and Gmail API rate limits
      for (let idx = 0; idx < allTokens.length; idx++) {
        const { email: accountEmail, accessToken } = allTokens[idx];
        if (idx > 0) {
          const jitterMs = 1000 + Math.floor(Math.random() * 4000);
          await new Promise(r => setTimeout(r, jitterMs));
        }
        try {
          await this.checkAccountForReplies(
            orgId, accountEmail, accessToken, lookbackMinutes,
            providerIdToMessage, contactEmailToMessages, contactCampaignToMessages,
            processedGmailIds, ownEmailsSet, result
          );
        } catch (acctError) {
          const msg = acctError instanceof Error ? acctError.message : String(acctError);
          console.error(`[GmailReplyTracker] Error checking account ${accountEmail}:`, msg);
          result.errors.push(`${accountEmail}: ${msg}`);
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
   * Check a single Gmail account for replies and bounces
   */
  private async checkAccountForReplies(
    orgId: string,
    accountEmail: string,
    accessToken: string,
    lookbackMinutes: number,
    providerIdToMessage: Map<string, any>,
    contactEmailToMessages: Map<string, any[]>,
    contactCampaignToMessages: Map<string, any[]>,
    processedGmailIds: Set<string>,
    ownEmailsSet: Set<string>,
    result: ReplyCheckResult
  ): Promise<void> {

      // Search for ALL received messages from the last N minutes
      // CRITICAL: Do NOT use "in:inbox" — it misses replies that have been:
      //   - Read and archived (removed from inbox)
      //   - Moved to a label/folder
      //   - In Gmail tabs (Promotions, Updates, Social) if auto-archived
      // Instead use broad search: -from:me -in:sent -in:drafts -in:chats
      // This catches replies anywhere: inbox, archive, categories, spam
      const afterTimestamp = Math.floor((Date.now() - lookbackMinutes * 60 * 1000) / 1000);
      const query = `after:${afterTimestamp} -from:me -in:sent -in:drafts -in:chats`;

      const listData: GmailListResponse = await this.gmailFetch(
        accessToken,
        `messages?q=${encodeURIComponent(query)}&maxResults=200`
      );

      if (!listData.messages || listData.messages.length === 0) {
        return;
      }

      result.checked += listData.messages.length;
      console.log(`[GmailReplyTracker] [${accountEmail}] Found ${listData.messages.length} messages (lookback: ${lookbackMinutes}m)`);

      // Get all sent campaign messages that haven't been replied to yet
      // Get all sent campaign messages that haven't been replied to yet
      // We'll use a batch approach - get message details and check headers
      for (const msgRef of listData.messages) {
        // Skip if already processed by another account
        if (processedGmailIds.has(msgRef.id)) continue;
        processedGmailIds.add(msgRef.id);

        try {
          const msg: GmailMessage = await this.gmailFetch(
            accessToken,
            `messages/${msgRef.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=In-Reply-To&metadataHeaders=References&metadataHeaders=Date&metadataHeaders=To`
          );

          if (!msg) continue; // message deleted between list and get

          const headers = msg.payload?.headers || [];
          const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

          const inReplyTo = getHeader('In-Reply-To');
          const references = getHeader('References');
          const from = getHeader('From');
          const subject = getHeader('Subject');
          const date = getHeader('Date');
          const fromLower = from.toLowerCase();
          const subjectLower = subject.toLowerCase();

          // ===== SKIP OWN ORG ACCOUNTS (warmup/internal mail) =====
          const fromEmail = fromLower.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] || '';
          if (fromEmail && ownEmailsSet.has(fromEmail)) continue;

          // ===== SKIP DMARC / Automated Reports =====
          // These are NOT bounces or replies — they are aggregate reports from email providers
          const isDMARCReport = (
            fromLower.includes('dmarcreport') ||
            fromLower.includes('dmarc_report') ||
            fromLower.includes('dmark_feedback') ||
            fromLower.includes('dmarc-report') ||
            fromLower.includes('noreply-dmarc') ||
            subjectLower.includes('report domain:') ||
            subjectLower.includes('dmarc aggregate')
          );
          if (isDMARCReport) continue;

          // ===== BOUNCE DETECTION =====
          // Detect bounce/delivery failure notifications and mark contacts as bounced
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
                if (!fullMsg) throw new Error('message deleted');
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
                    status: 'bounced',
                    errorMessage: `Bounce detected: ${subject}`,
                    bouncedAt: new Date().toISOString(),
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
                // Narrow bounce extraction: only add emails found in explicit NDR recipient
                // markers, and exclude sender accounts + internal routing IDs to prevent the
                // blocklist from being poisoned by quoted From: headers and message envelope IDs.
                const orgAccounts = await storage.getEmailAccounts(orgId);
                const orgSenderEmails = new Set(
                  (orgAccounts || []).map((a: any) => (a.email || '').toLowerCase()).filter(Boolean)
                );

                const ndrPatterns: RegExp[] = [
                  /Final-Recipient:\s*rfc822;\s*([^\s>]+@[^\s>]+)/gi,
                  /Original-Recipient:\s*rfc822;\s*([^\s>]+@[^\s>]+)/gi,
                  /Diagnostic-Code:[^\n]*<([^>]+@[^>]+)>/gi,
                  /<([^>\s]+@[^>\s]+)>:\s*(?:host |[45]\d\d |Recipient )/gi,
                  /Your message (?:to|couldn't be delivered to|wasn't delivered to)\s*[<\s]*([^\s>,]+@[^\s>,]+)/gi,
                  /5\.[01]\.[12]\s*<?([^\s>]+@[^\s>]+)>?/gi,
                ];

                const candidates = new Set<string>();
                for (const re of ndrPatterns) {
                  let m;
                  while ((m = re.exec(bounceBody)) !== null) {
                    if (m[1]) candidates.add(m[1].toLowerCase().replace(/[<>]/g, ''));
                  }
                }

                const isSuppressionCandidate = (email: string): boolean => {
                  if (!email || !email.includes('@')) return false;
                  if (email.includes('mailer-daemon') || email.includes('postmaster') || email.includes('noreply')) return false;
                  if (orgSenderEmails.has(email)) return false;
                  // Exchange/Outlook internal message routing IDs are not real mailboxes
                  if (/@[a-z0-9]*mb\d+\.[a-z0-9]+\.prod\.outlook\.com$/i.test(email)) return false;
                  if (/@.*\.prod\.outlook\.com$/i.test(email)) return false;
                  return true;
                };

                let added = 0;
                const candidateList = Array.from(candidates);
                for (const email of candidateList) {
                  if (!isSuppressionCandidate(email)) continue;
                  try {
                    await storage.addToSuppressionList(orgId, email, 'bounce', {
                      bounceType: 'hard',
                      source: 'auto-detected',
                      notes: `Auto-blocked: bounce notification received (${subject.slice(0, 100)})`,
                    });
                    console.log(`[GmailReplyTracker] Bounce: Auto-added ${email} to suppression/blocklist`);
                    added++;
                  } catch (e) { /* ignore duplicate */ }
                }
                if (added === 0) {
                  console.log(`[GmailReplyTracker] Bounce: no valid recipient found in NDR body (subject: ${subject.slice(0, 80)})`);
                }
              }
            } catch (bounceError) {
              console.error('[GmailReplyTracker] Error processing bounce notification:', bounceError);
            }
            continue; // Don't process bounce as a reply
          }

          // Extract sender email from "Name <email>" format
          const senderEmail = (from.match(/<([^>]+)>/) || [, from.split('@').length === 2 ? from.trim() : ''])[1]?.toLowerCase() || '';

          // DEBUG: Log every non-bounce message for troubleshooting
          console.log(`[GmailReplyTracker] Processing msg id=${msgRef.id} threadId=${msgRef.threadId} from="${senderEmail}" subject="${subject.slice(0, 60)}" inReplyTo="${inReplyTo.slice(0, 80)}" refs="${references.slice(0, 80)}"`);

          // Check if this is a reply to one of our campaign messages
          // Method 1: Match via In-Reply-To / References headers (Message-ID matching)
          const allRefs = `${inReplyTo} ${references}`;
          const trackingIds = this.extractTrackingIds(allRefs);
          if (trackingIds.length > 0) {
            console.log(`[GmailReplyTracker] Method 1 HIT: extracted trackingIds=${JSON.stringify(trackingIds)} from headers`);
          }

          // Method 2: Match via Gmail thread ID (if this message's threadId matches a sent campaign message)
          let threadMatchedMessage: any = null;
          if (trackingIds.length === 0 && msgRef.threadId) {
            const step0Match = providerIdToMessage.get(msgRef.threadId);
            if (!step0Match) {
              console.log(`[GmailReplyTracker] Method 2 MISS: threadId=${msgRef.threadId} not found in providerIdToMessage map (${providerIdToMessage.size} entries)`);
            }
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

          // Method 3: Match by sender email + subject pattern
          // Also try matching ANY reply from a known contact (not just "Re:" prefix)
          if (trackingIds.length === 0 && senderEmail) {
            const isReply = subject.toLowerCase().startsWith('re:') || !!inReplyTo;
            if (!isReply) {
              console.log(`[GmailReplyTracker] Method 3 SKIP: from=${senderEmail} subject doesn't start with Re: and no In-Reply-To header`);
            }
            // Check if this sender email matches any contact we sent campaigns to
            // First try contactEmailToMessages map (fast O(1) lookup)
            const senderMsgs = contactEmailToMessages.get(senderEmail);
            if (senderMsgs && senderMsgs.length > 0 && isReply) {
              // Sort by sentAt DESC - prefer unreplied
              const sorted = [...senderMsgs].sort((a: any, b: any) => {
                const aTime = new Date(a.sentAt || 0).getTime();
                const bTime = new Date(b.sentAt || 0).getTime();
                return bTime - aTime;
              });
              threadMatchedMessage = sorted.find((m: any) => !m.repliedAt) || sorted[0];
              trackingIds.push(threadMatchedMessage.trackingId);
              console.log(`[GmailReplyTracker] Method 3 HIT (email-map): ${senderEmail} -> campaign=${threadMatchedMessage.campaignId}, step=${threadMatchedMessage.stepNumber || 0}, alreadyReplied=${!!threadMatchedMessage.repliedAt}`);
            } else if (!senderMsgs) {
              console.log(`[GmailReplyTracker] Method 3 MISS: ${senderEmail} not found in contactEmailToMessages map`);
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

            // Determine emailAccountId from campaign message or by matching account email
            let emailAccountId = matchedCampaignMessage?.emailAccountId || null;
            if (!emailAccountId && accountEmail) {
              // We KNOW which Gmail account received this message — use it
              try {
                const orgAccounts = await storage.getEmailAccounts(orgId);
                const matchedByAccountEmail = orgAccounts.find((a: any) => a.email?.toLowerCase() === accountEmail.toLowerCase());
                if (matchedByAccountEmail) emailAccountId = matchedByAccountEmail.id;
              } catch (e) { /* ignore */ }
            }
            if (!emailAccountId) {
              // Fallback: match To header
              try {
                const orgAccounts = await storage.getEmailAccounts(orgId);
                const toHeader = (msg.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'to')?.value || '';
                const toEmailAddr = (toHeader.match(/<([^>]+)>/) || [, toHeader.trim()])[1]?.toLowerCase() || '';
                const matchedAccount = orgAccounts.find((a: any) => a.email?.toLowerCase() === toEmailAddr);
                if (matchedAccount) emailAccountId = matchedAccount.id;
              } catch (e) { /* ignore */ }
            }

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
              toEmail: accountEmail || '',
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

          if (trackingIds.length === 0) {
            console.log(`[GmailReplyTracker] NO MATCH for msg id=${msgRef.id} from=${senderEmail} subject="${subject.slice(0, 60)}"`);
          }

          // Now process as new reply only if not already tracked
          for (const trackingId of trackingIds) {
            const campaignMessage = threadMatchedMessage || await storage.getCampaignMessageByTracking(trackingId);
            if (!campaignMessage) {
              console.log(`[GmailReplyTracker] WARNING: trackingId=${trackingId} found but no campaign message in DB`);
              continue;
            }
            if (campaignMessage.repliedAt) {
              console.log(`[GmailReplyTracker] Reply already tracked: trackingId=${trackingId}, repliedAt=${campaignMessage.repliedAt}`);
              continue;
            }

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
    // Clear existing interval for THIS org only (don't kill other orgs' timers)
    const existingInterval = this.checkIntervals.get(orgId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    console.log(`[GmailReplyTracker] Starting auto-check for org ${orgId} every ${intervalMinutes} minutes (total orgs tracked: ${this.checkIntervals.size + 1})`);

    // Run immediately
    this.runCheck(orgId);

    // Then schedule periodic checks
    const interval = setInterval(() => {
      this.runCheck(orgId);
    }, intervalMinutes * 60 * 1000);
    this.checkIntervals.set(orgId, interval);
  }

  /**
   * Stop automatic polling
   */
  stopAutoCheck(orgId?: string): void {
    if (orgId) {
      const interval = this.checkIntervals.get(orgId);
      if (interval) {
        clearInterval(interval);
        this.checkIntervals.delete(orgId);
        console.log(`[GmailReplyTracker] Auto-check stopped for org ${orgId}`);
      }
    } else {
      // Stop all
      for (const [oid, interval] of this.checkIntervals) {
        clearInterval(interval);
        console.log(`[GmailReplyTracker] Auto-check stopped for org ${oid}`);
      }
      this.checkIntervals.clear();
    }
  }

  /**
   * Run a single check (with lock to prevent overlapping)
   */
  private async runCheck(orgId: string): Promise<void> {
    // Per-org lock: skip only if THIS org is already being checked, not other orgs
    if (this.checkingOrgs.has(orgId)) {
      console.log(`[GmailReplyTracker] Skipping org ${orgId.substring(0, 8)} — previous check still running`);
      return;
    }
    this.checkingOrgs.add(orgId);

    try {
      const result = await this.checkForReplies(orgId, 15); // Check last 15 min (3× overlap with 5-min cycle — safe, ~100× lighter than 24h)
      this.lastCheckedAt.set(orgId, new Date().toISOString());
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
      this.checkingOrgs.delete(orgId);
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
      // Get ALL Gmail accounts (multi-account) — needed to check threads across all sending accounts
      const allTokens = await this.getAllGmailTokens(orgId);
      if (allTokens.length === 0) return;

      // Build a set of ALL our email addresses (to exclude our own messages from "external reply" check)
      const ourEmails = new Set<string>();
      for (const t of allTokens) {
        if (t.email) ourEmails.add(t.email.toLowerCase());
      }
      // Also add from API settings
      try {
        const settings = await storage.getApiSettings(orgId);
        if (settings.gmail_user_email) ourEmails.add(settings.gmail_user_email.toLowerCase());
      } catch (e) {}
      // Add all email accounts
      try {
        const emailAccounts = await storage.getEmailAccounts(orgId);
        for (const acct of emailAccounts as any[]) {
          if (acct.email) ourEmails.add(acct.email.toLowerCase());
        }
      } catch (e) {}

      // Find recent campaign messages (last 24h) that haven't been marked as opened
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const unopenedMessages = await storage.getUnopenedCampaignMessages(orgId, cutoff);
      
      if (unopenedMessages.length === 0) return;

      // Build token map by email for quick lookup
      const tokenByEmail = new Map<string, string>();
      for (const t of allTokens) {
        tokenByEmail.set(t.email.toLowerCase(), t.accessToken);
      }

      // For each unopened message, check the Gmail thread for reply activity
      let opensDetected = 0;
      for (const msg of unopenedMessages) {
        try {
          if (!msg.providerMessageId) continue;

          // Try to find the right access token for the account that sent this message
          let accessToken: string | null = null;
          if (msg.emailAccountId) {
            try {
              const acct = await storage.getEmailAccount(msg.emailAccountId);
              if (acct?.email) {
                accessToken = tokenByEmail.get(acct.email.toLowerCase()) || null;
              }
            } catch (e) {}
          }
          // Fallback: use first available token
          if (!accessToken) accessToken = allTokens[0].accessToken;

          // Get the thread for our sent message
          const thread = await this.gmailFetch(
            accessToken,
            `threads/${msg.providerMessageId}?format=metadata&metadataHeaders=From`
          );

          if (!thread || !thread.messages) continue;

          // Only count as opened if there's a reply from someone other than us
          // A thread with >1 message means someone replied - that counts as an open
          if (thread.messages.length > 1) {
            // Verify at least one message is NOT from any of our accounts
            const hasExternalReply = thread.messages.some((m: any) => {
              const from = (m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
              const fromEmail = (from.match(/<([^>]+)>/) || [, from])[1]?.toLowerCase() || from.toLowerCase();
              return !Array.from(ourEmails).some(our => fromEmail.includes(our));
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
  getStatus(): { active: boolean; checking: boolean; trackedOrgs: number; lastCheckedAt?: Record<string, string> } {
    const lastChecked: Record<string, string> = {};
    for (const [orgId, ts] of this.lastCheckedAt) {
      lastChecked[orgId.substring(0, 8)] = ts;
    }
    return {
      active: this.checkIntervals.size > 0,
      checking: this.isChecking,
      trackedOrgs: this.checkIntervals.size,
      lastCheckedAt: Object.keys(lastChecked).length > 0 ? lastChecked : undefined,
    };
  }
}

export const gmailReplyTracker = new GmailReplyTracker();
