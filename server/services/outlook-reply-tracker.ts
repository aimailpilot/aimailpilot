/**
 * Outlook Reply Tracker Service
 * Uses Microsoft Graph API to detect replies to campaign emails and store them in unified_inbox.
 *
 * Supports per-sender OAuth tokens (like GmailReplyTracker):
 *   - outlook_sender_{email}_access_token / refresh_token / token_expiry
 *   - Falls back to org-level microsoft_access_token / refresh_token only if no per-sender tokens
 *
 * Flow:
 * 1. Gathers all Outlook accounts with OAuth tokens (per-sender + org-level)
 * 2. Refreshes access token if expired using refresh_token
 * 3. Polls Microsoft Graph /me/mailFolders/inbox/messages for recent messages per account
 * 4. Matches replies to campaign messages via In-Reply-To / References / internetMessageId
 * 5. Stores new replies in unified_inbox and updates campaign stats
 */

import { storage } from '../storage';
import { recordAuthFailure, recordAuthSuccess } from './auth-health';

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

const OUTLOOK_SCOPES = 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send';

export class OutlookReplyTracker {
  private checkIntervals: Map<string, NodeJS.Timeout> = new Map();
  // Per-org lock: prevents overlapping checks for the SAME org while allowing different orgs to check in parallel
  private checkingOrgs: Set<string> = new Set();
  private lastCheckedAt: Map<string, string> = new Map();
  private get isChecking(): boolean { return this.checkingOrgs.size > 0; }

  /** Get OAuth client credentials for Microsoft */
  private async getOAuthCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null> {
    const settings = await storage.getApiSettings(orgId);
    let clientId = settings.microsoft_oauth_client_id || process.env.MICROSOFT_CLIENT_ID || '';
    let clientSecret = settings.microsoft_oauth_client_secret || process.env.MICROSOFT_CLIENT_SECRET || '';

    // Fallback: try superadmin's org for OAuth credentials
    if (!clientId || !clientSecret) {
      try {
        const superAdminOrgId = await storage.getSuperAdminOrgId();
        if (superAdminOrgId && superAdminOrgId !== orgId) {
          const superSettings = await storage.getApiSettings(superAdminOrgId);
          if (superSettings.microsoft_oauth_client_id) {
            clientId = superSettings.microsoft_oauth_client_id;
            clientSecret = superSettings.microsoft_oauth_client_secret || '';
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  /** Refresh Microsoft access token for a specific sender or org-level */
  private async refreshAccessToken(
    orgId: string,
    refreshToken: string,
    senderEmail?: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
    try {
      const creds = await this.getOAuthCredentials(orgId);
      if (!creds) return null;

      const body = new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: OUTLOOK_SCOPES,
      });

      const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[OutlookReplyTracker] Token refresh failed for ${senderEmail || 'org-default'}:`, errText);
        if (senderEmail) recordAuthFailure(orgId, senderEmail, errText).catch(() => {});
        return null;
      }

      const tokens = await resp.json() as any;
      if (!tokens.access_token) return null;

      const expiresIn = tokens.expires_in || 3600;
      const expiryDate = String(Date.now() + expiresIn * 1000);

      // Store refreshed tokens to the CORRECT location (per-sender or org-level)
      if (senderEmail) {
        const prefix = `outlook_sender_${senderEmail}_`;
        await storage.setApiSetting(orgId, `${prefix}access_token`, tokens.access_token);
        if (tokens.refresh_token) await storage.setApiSetting(orgId, `${prefix}refresh_token`, tokens.refresh_token);
        await storage.setApiSetting(orgId, `${prefix}token_expiry`, expiryDate);
      } else {
        await storage.setApiSetting(orgId, 'microsoft_access_token', tokens.access_token);
        if (tokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
        await storage.setApiSetting(orgId, 'microsoft_token_expiry', expiryDate);
      }

      if (senderEmail) recordAuthSuccess(orgId, senderEmail).catch(() => {});

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn,
      };
    } catch (err) {
      console.error(`[OutlookReplyTracker] Token refresh error for ${senderEmail || 'org-default'}:`, err);
      return null;
    }
  }

  /**
   * Get a valid access token (refresh if expired).
   * Supports per-sender tokens: outlook_sender_{email}_access_token
   * Falls back to org-level: microsoft_access_token
   */
  private async getValidAccessToken(orgId: string, senderEmail?: string): Promise<string | null> {
    const settings = await storage.getApiSettings(orgId);

    // Try per-sender tokens first if senderEmail specified
    const senderPrefix = senderEmail ? `outlook_sender_${senderEmail}_` : '';
    let accessToken = senderEmail ? settings[`${senderPrefix}access_token`] : null;
    let refreshToken = senderEmail ? settings[`${senderPrefix}refresh_token`] : null;
    let tokenExpiry = senderEmail ? settings[`${senderPrefix}token_expiry`] : null;
    let isPerSender = !!(accessToken || refreshToken);

    // Fall back to org-level tokens ONLY if no per-sender tokens exist
    // CRITICAL: Don't mix refresh tokens from different accounts!
    if (!accessToken && !refreshToken) {
      accessToken = settings.microsoft_access_token;
      refreshToken = settings.microsoft_refresh_token;
      tokenExpiry = settings.microsoft_token_expiry;
      isPerSender = false;
    }

    if (!accessToken && !refreshToken) return null;

    // Check if token is expired (with 5-minute buffer)
    if (tokenExpiry) {
      const exp = parseInt(tokenExpiry);
      if (Date.now() > exp - 300000) {
        // Token expired or about to expire, refresh it
        if (refreshToken) {
          const result = await this.refreshAccessToken(orgId, refreshToken, isPerSender ? senderEmail : undefined);
          if (result) {
            accessToken = result.accessToken;
          }
        }
      }
    }

    return accessToken || null;
  }

  /**
   * Get ALL Outlook accounts for an organization that have OAuth tokens.
   * Returns array of { email, accessToken } for each connected account.
   */
  private async getAllOutlookTokens(orgId: string): Promise<Array<{ email: string; accessToken: string }>> {
    const tokens: Array<{ email: string; accessToken: string }> = [];
    const settings = await storage.getApiSettings(orgId);
    const seenEmails = new Set<string>();

    // 1. Collect per-sender tokens from API settings
    //    Keys like: outlook_sender_bd@bellaward.com_access_token
    for (const key of Object.keys(settings)) {
      const match = key.match(/^outlook_sender_(.+?)_(?:access_token|refresh_token)$/);
      if (match) {
        const email = match[1];
        if (seenEmails.has(email.toLowerCase())) continue;
        seenEmails.add(email.toLowerCase());
        const token = await this.getValidAccessToken(orgId, email);
        if (token) {
          tokens.push({ email, accessToken: token });
        }
      }
    }

    // 2. Add org-level default token (if not already found via per-sender)
    const orgEmail = settings.microsoft_user_email || '';
    if (orgEmail && !seenEmails.has(orgEmail.toLowerCase())) {
      const token = await this.getValidAccessToken(orgId);
      if (token) {
        tokens.push({ email: orgEmail, accessToken: token });
        seenEmails.add(orgEmail.toLowerCase());
      }
    } else if (!orgEmail) {
      // No org email set but might have org-level tokens
      const token = await this.getValidAccessToken(orgId);
      if (token) {
        tokens.push({ email: 'org-default', accessToken: token });
      }
    }

    // 3. Check email_accounts table for additional Outlook accounts with OAuth
    try {
      const emailAccounts = await storage.getEmailAccounts(orgId);
      for (const acct of emailAccounts as any[]) {
        if (!acct.email || seenEmails.has(acct.email.toLowerCase())) continue;
        if (acct.provider !== 'outlook' && acct.provider !== 'microsoft') continue;
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

  /** Call Microsoft Graph API */
  private async graphFetch(accessToken: string, endpoint: string): Promise<any> {
    const url = endpoint.startsWith('http') ? endpoint : `https://graph.microsoft.com/v1.0${endpoint}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      throw new Error(`Graph API error (${resp.status}): ${await resp.text()}`);
    }
    return resp.json();
  }

  /** Check for new replies across ALL Outlook accounts in the org */
  async checkForReplies(orgId: string, lookbackMinutes: number = 120) {
    const result = { checked: 0, newReplies: 0, errors: [] as string[], replies: [] as any[] };

    try {
      const outlookAccounts = await this.getAllOutlookTokens(orgId);
      if (outlookAccounts.length === 0) {
        result.errors.push('No Outlook access tokens available. Please re-authenticate with Microsoft.');
        return result;
      }

      console.log(`[OutlookReplyTracker] Checking ${outlookAccounts.length} Outlook account(s) for org ${orgId.substring(0, 8)}`);

      // 1-5s jitter between accounts to prevent thundering herd on PG pool and
      // Microsoft Graph API rate limits (token refresh timeouts were the symptom)
      for (let idx = 0; idx < outlookAccounts.length; idx++) {
        const account = outlookAccounts[idx];
        if (idx > 0) {
          const jitterMs = 1000 + Math.floor(Math.random() * 4000);
          await new Promise(r => setTimeout(r, jitterMs));
        }
        try {
          const accountResult = await this.checkAccountForReplies(orgId, account.email, account.accessToken, lookbackMinutes);
          result.checked += accountResult.checked;
          result.newReplies += accountResult.newReplies;
          result.replies.push(...accountResult.replies);
          if (accountResult.errors.length > 0) result.errors.push(...accountResult.errors);
        } catch (acctErr) {
          const errMsg = acctErr instanceof Error ? acctErr.message : String(acctErr);
          result.errors.push(`Account ${account.email}: ${errMsg}`);
          console.error(`[OutlookReplyTracker] Error checking account ${account.email}:`, errMsg);
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

  /** Check a single Outlook account for replies */
  private async checkAccountForReplies(
    orgId: string,
    accountEmail: string,
    accessToken: string,
    lookbackMinutes: number
  ) {
    const result = { checked: 0, newReplies: 0, errors: [] as string[], replies: [] as any[] };

    // Fetch recent inbox messages
    // NOTE: internetMessageHeaders is NOT available in list queries — must fetch per-message
    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
    const filter = `receivedDateTime ge ${since}`;
    const select = 'id,conversationId,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime';
    const endpoint = `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=50&$orderby=receivedDateTime desc`;

    const listData: GraphListResponse = await this.graphFetch(accessToken, endpoint);
    if (!listData.value || listData.value.length === 0) {
      console.log(`[OutlookReplyTracker] No messages in inbox for ${accountEmail} (lookback: ${lookbackMinutes}min)`);
      return result;
    }

    result.checked = listData.value.length;
    console.log(`[OutlookReplyTracker] Found ${listData.value.length} inbox messages for ${accountEmail}`);

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

    for (const msg of listData.value) {
      try {
        // Skip messages sent from our own org accounts (warmup/internal mail noise)
        const senderEmail = (msg.from?.emailAddress?.address || '').toLowerCase();
        if (senderEmail && ownEmailsSet.has(senderEmail)) continue;

        // Skip if already in inbox AND already matched to a campaign
        // Re-check messages that were stored without campaign matching (from older broken code)
        const existing = await storage.getInboxMessageByOutlookId(msg.id);
        if (existing && existing.campaignId) continue;

        // Fetch individual message headers (Graph API only returns them on single-message GET)
        // Lazy-load: only fetch if needed (skip for bounce detection which uses subject/sender)
        let _headers: Array<{ name: string; value: string }> | null = null;
        const getHeaders = async () => {
          if (_headers !== null) return _headers;
          try {
            const singleMsg = await this.graphFetch(accessToken, `/me/messages/${msg.id}?$select=internetMessageHeaders`);
            _headers = singleMsg?.internetMessageHeaders || [];
          } catch (e) {
            console.error(`[OutlookReplyTracker] Failed to fetch headers for message ${msg.id}:`, e);
            _headers = [];
          }
          return _headers;
        };
        const getHeader = async (name: string) => {
          const hdrs = await getHeaders();
          return hdrs.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        };

        // ===== BOUNCE DETECTION for Outlook =====
        const senderAddr = (msg.from?.emailAddress?.address || '').toLowerCase();
        const subjectLower = (msg.subject || '').toLowerCase();
        const isBounce = (
          senderAddr.includes('mailer-daemon') ||
          senderAddr.includes('postmaster') ||
          subjectLower.includes('undeliverable') ||
          subjectLower.includes('delivery has failed') ||
          subjectLower.includes('delivery status notification') ||
          subjectLower.includes('failure notice') ||
          subjectLower.includes('mail delivery failed')
        );
        
        if (isBounce) {
          try {
            const bodyText = msg.body?.content || msg.bodyPreview || '';
            const emailPattern = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
            const foundEmails = bodyText.match(emailPattern) || [];

            // Fetch headers for bounce tracking ID extraction
            const bounceInReplyTo = await getHeader('In-Reply-To');
            const bounceReferences = await getHeader('References');
            const bounceAllRefs = `${bounceInReplyTo} ${bounceReferences}`;
            const trackingIds = this.extractTrackingIds(bounceAllRefs);
            let bouncedMsg: any = null;
            
            for (const tid of trackingIds) {
              const cm = await storage.getCampaignMessageByTracking(tid);
              if (cm) { bouncedMsg = cm; break; }
            }
            
            if (!bouncedMsg && foundEmails.length > 0) {
              for (const email of foundEmails) {
                const emailLower = email.toLowerCase();
                if (emailLower.includes('mailer-daemon') || emailLower.includes('postmaster') || emailLower.includes('noreply')) continue;
                
                try {
                  const contact = await storage.getContactByEmail(orgId, emailLower);
                  if (contact && (contact as any).status !== 'bounced') {
                    await storage.updateContact((contact as any).id, { status: 'bounced' });
                    console.log(`[OutlookReplyTracker] BOUNCE DETECTED (${accountEmail}): ${email} (subject: ${msg.subject})`);
                    
                    try {
                      const allMsgs = await storage.getAllRecentCampaignMessages(orgId);
                      const contactMsg = allMsgs.find((m: any) => m.contactId === (contact as any).id);
                      if (contactMsg) bouncedMsg = contactMsg;
                    } catch (e) {}
                  }
                } catch (e) {
                  console.error(`[OutlookReplyTracker] Error looking up contact ${email}:`, e);
                }
                if (bouncedMsg) break;
              }
            }
            
            if (bouncedMsg) {
              await storage.updateCampaignMessage(bouncedMsg.id, { status: 'bounced', bouncedAt: new Date().toISOString(), errorMessage: `Bounce: ${msg.subject}` });
              const contact = await storage.getContact(bouncedMsg.contactId);
              if (contact && (contact as any).status !== 'bounced') {
                await storage.updateContact(bouncedMsg.contactId, { status: 'bounced' });
                console.log(`[OutlookReplyTracker] BOUNCE DETECTED via tracking (${accountEmail}): ${(contact as any).email}`);
              }
              const campaign = await storage.getCampaign(bouncedMsg.campaignId);
              if (campaign) {
                await storage.updateCampaign(bouncedMsg.campaignId, {
                  bouncedCount: (campaign.bouncedCount || 0) + 1,
                });
              }
              // Create bounce tracking event
              await storage.createTrackingEvent({
                type: 'bounce',
                campaignId: bouncedMsg.campaignId,
                messageId: bouncedMsg.id,
                contactId: bouncedMsg.contactId,
                trackingId: bouncedMsg.trackingId || '',
                stepNumber: bouncedMsg.stepNumber || 0,
                metadata: {
                  outlookMessageId: msg.id,
                  bounceSubject: msg.subject,
                  bounceSender: senderAddr,
                  accountEmail,
                  detectedVia: 'outlook-api',
                },
              });
            } else {
              // No matching contact — narrow bounce extraction.
              // Only add emails found in explicit NDR recipient markers, and exclude
              // sender accounts + Exchange internal routing IDs to prevent the blocklist
              // from being poisoned by quoted From: headers and message envelope IDs.
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

              const decodeHtml = (s: string) => s
                .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
                .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
                .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
              const decodedBody = decodeHtml(bodyText);

              const candidates = new Set<string>();
              for (const re of ndrPatterns) {
                let m;
                while ((m = re.exec(decodedBody)) !== null) {
                  if (m[1]) candidates.add(m[1].toLowerCase().replace(/[<>]/g, '').replace(/[.,;:]+$/, ''));
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
                    notes: `Auto-blocked: bounce notification received (${(msg.subject || '').slice(0, 100)})`,
                  });
                  console.log(`[OutlookReplyTracker] Bounce: Auto-added ${email} to suppression/blocklist`);
                  added++;
                } catch (e) { /* ignore duplicate */ }
              }
              if (added === 0) {
                console.log(`[OutlookReplyTracker] Bounce: no valid recipient found in NDR body (subject: ${(msg.subject || '').slice(0, 80)})`);
              }
            }
          } catch (e) {
            console.error('[OutlookReplyTracker] Bounce processing error:', e);
          }
          continue; // Don't process as reply
        }

        // Try to match to a campaign message using multiple methods
        let campaignId: string | null = null;
        let messageId: string | null = null;
        let contactId: string | null = null;
        let emailAccountId: string | null = null;
        let campaignName = '';
        let isNewReply = false;
        let matchedTrackingId = '';
        let matchMethod = 'tracking-id';

        // Method 1 (fastest): Match by sender email + subject — no extra API call needed
        // Microsoft Graph overrides custom Message-ID headers, so subject+sender
        // is the most reliable method for Outlook-sent campaigns
        {
          const fromEmail = msg.from?.emailAddress?.address;
          const subject = msg.subject || '';
          const cleanSubject = subject.replace(/^(re:\s*|fw:\s*|fwd:\s*)+/i, '').trim();
          console.log(`[OutlookReplyTracker] Trying subject+sender match: from="${fromEmail}" subject="${subject}" cleanSubject="${cleanSubject}"`);
          if (fromEmail && cleanSubject) {
            const subjectMatch = await storage.getCampaignMessageByContactEmailAndSubject(fromEmail, cleanSubject);
            if (subjectMatch) {
              matchMethod = 'subject-sender';
              matchedTrackingId = subjectMatch.trackingId || '';
              campaignId = subjectMatch.campaignId;
              messageId = subjectMatch.id;
              contactId = subjectMatch.contactId;
              emailAccountId = subjectMatch.emailAccountId || null;
              console.log(`[OutlookReplyTracker] MATCHED via subject+sender: ${fromEmail} / "${cleanSubject}" → campaign ${campaignId}`);
            } else {
              console.log(`[OutlookReplyTracker] No subject+sender match for ${fromEmail} / "${cleanSubject}"`);
            }
          }
        }

        // Method 1: Match via tracking ID in In-Reply-To / References headers
        // Only fetch headers if subject+sender didn't match (avoids extra API call)
        if (!campaignId) {
          const inReplyTo = await getHeader('In-Reply-To');
          const references = await getHeader('References');
          const allRefs = `${inReplyTo} ${references}`;
          const trackingIds = this.extractTrackingIds(allRefs);

          for (const trackingId of trackingIds) {
            const campaignMessage = await storage.getCampaignMessageByTracking(trackingId);
            if (campaignMessage) {
              matchMethod = 'tracking-id';
              matchedTrackingId = trackingId;
              campaignId = campaignMessage.campaignId;
              messageId = campaignMessage.id;
              contactId = campaignMessage.contactId;
              emailAccountId = campaignMessage.emailAccountId || null;
              break;
            }
          }

          // Method 2: Match via providerMessageId (Microsoft's actual internetMessageId)
          if (!campaignId && inReplyTo) {
            const replyToMatch = inReplyTo.match(/<([^>]+)>/);
            if (replyToMatch) {
              const providerMsg = await storage.getCampaignMessageByProviderMessageId(replyToMatch[1]);
              if (providerMsg) {
                matchMethod = 'provider-message-id';
                matchedTrackingId = providerMsg.trackingId || '';
                campaignId = providerMsg.campaignId;
                messageId = providerMsg.id;
                contactId = providerMsg.contactId;
                emailAccountId = providerMsg.emailAccountId || null;
                console.log(`[OutlookReplyTracker] Matched reply via providerMessageId: ${replyToMatch[1]}`);
              }
            }
          }
        }

        // Process campaign match (if found by any method)
        if (campaignId) {
          const campaignMessage = messageId ? await storage.getCampaignMessage(messageId) : null;
          const campaign = await storage.getCampaign(campaignId);
          if (campaign) campaignName = campaign.name || '';

          if (campaignMessage && !campaignMessage.repliedAt) {
            isNewReply = true;
            await storage.updateCampaignMessage(campaignMessage.id, {
              repliedAt: new Date(msg.receivedDateTime).toISOString(),
            });

            if (campaign) {
              await storage.updateCampaign(campaignId, {
                repliedCount: (campaign.repliedCount || 0) + 1,
              });
            }

            if (campaignMessage.contactId) {
              try {
                await storage.updateContact(campaignMessage.contactId, { status: 'replied' });
              } catch (e) { /* ignore */ }
              try {
                await storage.cancelPendingFollowupsForContact(campaignMessage.contactId, campaignId);
                console.log(`[OutlookReplyTracker] Cancelled pending follow-ups for contact ${campaignMessage.contactId}`);
              } catch (e) { /* ignore */ }
            }

            await storage.createTrackingEvent({
              type: 'reply',
              campaignId,
              messageId: campaignMessage.id,
              contactId: campaignMessage.contactId,
              trackingId: matchedTrackingId,
              stepNumber: campaignMessage.stepNumber || 0,
              metadata: {
                outlookMessageId: msg.id,
                outlookConversationId: msg.conversationId,
                fromEmail: msg.from?.emailAddress?.address,
                subject: msg.subject,
                snippet: msg.bodyPreview,
                accountEmail,
                detectedVia: 'outlook-api',
                matchMethod,
              },
            });
          }
        }

        // Resolve emailAccountId by matching toEmail if not found from campaign
        if (!emailAccountId) {
          try {
            const orgAccounts = await storage.getEmailAccounts(orgId);
            const toAddr = msg.toRecipients?.[0]?.emailAddress?.address?.toLowerCase() || '';
            const matchedAccount = orgAccounts.find((a: any) => a.email?.toLowerCase() === toAddr);
            if (matchedAccount) emailAccountId = matchedAccount.id;
          } catch (e) { /* ignore */ }
        }

        // Store in unified_inbox (or update if re-checking an unmatched message)
        const existingOutlookInbox = await storage.getInboxMessageByOutlookId(msg.id);
        if (!existingOutlookInbox) {
          await storage.createInboxMessage({
            organizationId: orgId,
            emailAccountId,
            campaignId,
            messageId,
            contactId,
            outlookMessageId: msg.id,
            outlookConversationId: msg.conversationId,
            fromEmail: msg.from?.emailAddress?.address || '',
            fromName: msg.from?.emailAddress?.name || '',
            toEmail: accountEmail !== 'org-default' ? accountEmail : (msg.toRecipients?.[0]?.emailAddress?.address || ''),
            subject: msg.subject || '',
            snippet: msg.bodyPreview || '',
            body: msg.body?.contentType === 'text' ? msg.body.content : msg.bodyPreview || '',
            bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : '',
            status: 'unread',
            provider: 'outlook',
            receivedAt: msg.receivedDateTime,
          });
          console.log(`[OutlookReplyTracker] Stored message in unified inbox from ${msg.from?.emailAddress?.address} to ${accountEmail} (campaign match: ${!!campaignId})`);
        } else if (!existingOutlookInbox.campaignId && campaignId) {
          // Re-check: message was stored before without campaign match — update it now
          try {
            await storage.updateInboxMessage(existingOutlookInbox.id, { campaignId, messageId, contactId, emailAccountId });
            console.log(`[OutlookReplyTracker] Updated inbox message ${existingOutlookInbox.id} with campaign match (method: ${matchMethod})`);
          } catch (e) { /* ignore if updateInboxMessage doesn't exist */ }
        }

        if (isNewReply) {
          result.newReplies++;
        }
        result.replies.push({
          from: `${msg.from?.emailAddress?.name} <${msg.from?.emailAddress?.address}>`,
          subject: msg.subject,
          snippet: msg.bodyPreview,
          campaignName: campaignName || 'Direct Message',
          contactEmail: msg.from?.emailAddress?.address || '',
          receivedAt: msg.receivedDateTime,
        });

        console.log(`[OutlookReplyTracker] New message from ${msg.from?.emailAddress?.address} to ${accountEmail}: "${msg.subject}"`);
      } catch (msgErr) {
        console.error('[OutlookReplyTracker] Error processing message:', msgErr);
      }
    }

    return result;
  }

  /** Extract AImailPilot tracking IDs from message references */
  private extractTrackingIds(headerValue: string): string[] {
    if (!headerValue) return [];
    const regex = /<([a-f0-9][a-f0-9_-]{35,})@[^>]+>/gi;
    const ids: string[] = [];
    let match;
    while ((match = regex.exec(headerValue)) !== null) {
      ids.push(match[1]);
    }
    return ids;
  }

  /** Start automatic polling */
  startAutoCheck(orgId: string, intervalMinutes: number = 5): void {
    const existing = this.checkIntervals.get(orgId);
    if (existing) clearInterval(existing);
    console.log(`[OutlookReplyTracker] Starting auto-check for org ${orgId.substring(0, 8)} every ${intervalMinutes} minutes (total orgs: ${this.checkIntervals.size + 1})`);
    this.runCheck(orgId);
    const interval = setInterval(() => this.runCheck(orgId), intervalMinutes * 60 * 1000);
    this.checkIntervals.set(orgId, interval);
  }

  /** Stop automatic polling */
  stopAutoCheck(orgId?: string): void {
    if (orgId) {
      const interval = this.checkIntervals.get(orgId);
      if (interval) {
        clearInterval(interval);
        this.checkIntervals.delete(orgId);
        console.log(`[OutlookReplyTracker] Auto-check stopped for org ${orgId.substring(0, 8)}`);
      }
    } else {
      for (const [oid, interval] of this.checkIntervals) {
        clearInterval(interval);
      }
      this.checkIntervals.clear();
      console.log('[OutlookReplyTracker] All auto-checks stopped');
    }
  }

  private async runCheck(orgId: string): Promise<void> {
    // Per-org lock: skip only if THIS org is already being checked
    if (this.checkingOrgs.has(orgId)) {
      console.log(`[OutlookReplyTracker] Skipping org ${orgId.substring(0, 8)} — previous check still running`);
      return;
    }
    this.checkingOrgs.add(orgId);
    try {
      const result = await this.checkForReplies(orgId, 15); // Check last 15 min (3× overlap with 5-min cycle — safe, ~100× lighter than 24h)
      this.lastCheckedAt.set(orgId, new Date().toISOString());
      if (result.newReplies > 0) {
        console.log(`[OutlookReplyTracker] Auto-check found ${result.newReplies} new messages for org ${orgId.substring(0, 8)}`);
      }
    } catch (error) {
      console.error('[OutlookReplyTracker] Auto-check error:', error);
    } finally {
      this.checkingOrgs.delete(orgId);
    }
  }

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

export const outlookReplyTracker = new OutlookReplyTracker();
