import { storage } from "../storage";
import { OAuth2Client } from 'google-auth-library';
import { classifyReply } from "./reply-classifier";

const SYSTEM_EMAIL_FRAGMENTS = ['mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'bounce', 'googlemail', 'amazonses'];

async function getOrgProtectedEmails(orgId: string): Promise<Set<string>> {
  const connected = new Set<string>();
  try {
    const accounts = await storage.rawAll(`SELECT email FROM email_accounts WHERE "organizationId" = ?`, orgId) as any[];
    for (const a of accounts) if (a.email) connected.add(a.email.toLowerCase());
    const warmup = await storage.rawAll(`SELECT email FROM warmup_accounts WHERE "organizationId" = ?`, orgId) as any[];
    for (const w of warmup) if (w.email) connected.add(w.email.toLowerCase());
  } catch (e) { /* non-critical */ }
  return connected;
}

function isSafeEmailToSuppress(email: string, connected: Set<string>): boolean {
  const lower = (email || '').toLowerCase();
  if (!lower || !lower.includes('@')) return false;
  if (connected.has(lower)) return false;
  return !SYSTEM_EMAIL_FRAGMENTS.some(f => lower.includes(f));
}

/**
 * Scan historical email_history for bounce/unsubscribe/negative signals and
 * push them to suppression_list + flip contact status. Only flags when the
 * rule classifier reports high-confidence bounce/unsubscribe — mirrors the
 * guardrails used by bounce-sync-engine. Additive only (won't un-suppress).
 */
export async function sweepSuppressionSignalsFromHistory(orgId: string): Promise<{
  scanned: number; suppressed: number; contactsBounced: number; contactsUnsubscribed: number;
}> {
  const out = { scanned: 0, suppressed: 0, contactsBounced: 0, contactsUnsubscribed: 0 };
  const connected = await getOrgProtectedEmails(orgId);

  let rows: any[] = [];
  try {
    rows = await storage.rawAll(`
      SELECT "fromEmail", "fromName", subject, snippet
      FROM email_history
      WHERE "organizationId" = ? AND direction = 'received'
        AND "fromEmail" IS NOT NULL AND "fromEmail" != ''
      ORDER BY "receivedAt" DESC
      LIMIT 5000
    `, orgId) as any[];
  } catch (e) {
    console.error('[LeadIntel] sweepSuppressionSignals query failed:', e instanceof Error ? e.message : e);
    return out;
  }

  // Already-suppressed lookup (avoid dupes)
  const existing = new Set<string>();
  try {
    const supp = await storage.rawAll(`SELECT email FROM suppression_list WHERE "organizationId" = ?`, orgId) as any[];
    for (const s of supp) if (s.email) existing.add(s.email.toLowerCase());
  } catch { /* non-critical */ }

  for (const r of rows) {
    out.scanned++;
    const email = (r.fromEmail || '').toLowerCase().trim();
    if (!isSafeEmailToSuppress(email, connected)) continue;
    if (existing.has(email)) continue;

    const cls = classifyReply(r.subject || '', r.snippet || '', r.fromEmail || '', r.fromName || '');
    let reason: 'bounce' | 'unsubscribe' | null = null;
    if (cls.replyType === 'bounce' && cls.confidence >= 0.9) reason = 'bounce';
    else if (cls.replyType === 'unsubscribe' && cls.confidence >= 0.85) reason = 'unsubscribe';
    if (!reason) continue;

    try {
      await storage.addToSuppressionList(orgId, email, reason, {
        bounceType: reason === 'bounce' ? (cls.bounceType || 'hard') : undefined,
        source: 'lead-intel-sweep',
        notes: cls.reason,
      });
      existing.add(email);
      out.suppressed++;

      // Flip contact status if a matching contact row exists
      try {
        const contact = await storage.rawGet(
          `SELECT id FROM contacts WHERE "organizationId" = ? AND LOWER(email) = ? LIMIT 1`,
          orgId, email
        ) as any;
        if (contact?.id) {
          if (reason === 'bounce') {
            await storage.markContactBounced(contact.id, cls.bounceType || 'hard');
            out.contactsBounced++;
          } else {
            await storage.markContactUnsubscribed(contact.id);
            out.contactsUnsubscribed++;
          }
        }
      } catch (e) { /* non-critical */ }
    } catch (e) { /* non-critical */ }
  }

  console.log(`[LeadIntel] Suppression sweep org=${orgId}: scanned=${out.scanned} suppressed=${out.suppressed} bounced=${out.contactsBounced} unsubscribed=${out.contactsUnsubscribed}`);
  return out;
}

/**
 * Lead Intelligence Engine
 *
 * 1. Deep-scans linked Gmail/Outlook accounts for 6-12 months of email history
 * 2. Groups conversations by contact (thread analysis)
 * 3. Uses Azure OpenAI to classify each contact into opportunity buckets:
 *    - past_customer: Gave business before (invoices, orders, thank-you)
 *    - hot_lead: Replied positively, asked for pricing/demo/meeting
 *    - warm_lead: Opened multiple times, clicked links, short replies
 *    - interested_stalled: Replied once then went silent
 *    - almost_closed: Pricing discussed, proposal sent, "let me think"
 *    - meeting_no_deal: Meeting happened but no deal closed
 *    - went_silent: Active conversation that suddenly stopped
 *    - not_interested: Replied negatively, unsubscribed
 *    - no_response: Never opened or replied
 *    - referral_potential: Happy customer, positive feedback
 * 4. Stores classifications in lead_opportunities table
 * 5. Also analyzes existing campaign contacts from unified_inbox
 */

// ── Token Helpers (same pattern as warmup-engine) ─────────────────────

async function getGmailAccessToken(orgId: string, senderEmail: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);
  const prefix = `gmail_sender_${senderEmail}_`;
  let accessToken = settings[`${prefix}access_token`] || null;
  let refreshToken = settings[`${prefix}refresh_token`] || null;
  let tokenExpiry = settings[`${prefix}token_expiry`] || null;

  if (!accessToken && !refreshToken) {
    accessToken = settings.gmail_access_token || null;
    refreshToken = settings.gmail_refresh_token || null;
    tokenExpiry = settings.gmail_token_expiry || null;
  }
  if (!accessToken && !refreshToken) return null;

  let clientId = settings.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = settings.google_oauth_client_secret || process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    try {
      const superAdminOrgId = await storage.getSuperAdminOrgId();
      if (superAdminOrgId && superAdminOrgId !== orgId) {
        const ss = await storage.getApiSettings(superAdminOrgId);
        if (ss.google_oauth_client_id) { clientId = ss.google_oauth_client_id; clientSecret = ss.google_oauth_client_secret || ''; }
      }
    } catch (e) { /* ignore */ }
  }

  const expiry = parseInt(tokenExpiry || '0');
  if (!tokenExpiry || Date.now() > expiry - 300000) {
    if (refreshToken && clientId && clientSecret) {
      try {
        const oauth2 = new OAuth2Client(clientId, clientSecret);
        oauth2.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await oauth2.refreshAccessToken();
        if (credentials.access_token) {
          accessToken = credentials.access_token;
          if (settings[`${prefix}refresh_token`]) {
            await storage.setApiSetting(orgId, `${prefix}access_token`, accessToken);
            if (credentials.expiry_date) await storage.setApiSetting(orgId, `${prefix}token_expiry`, String(credentials.expiry_date));
          } else {
            await storage.setApiSetting(orgId, 'gmail_access_token', accessToken);
            if (credentials.expiry_date) await storage.setApiSetting(orgId, 'gmail_token_expiry', String(credentials.expiry_date));
          }
        }
      } catch (e) {
        console.error(`[LeadIntel] Gmail token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return accessToken;
}

async function getOutlookAccessToken(orgId: string, senderEmail: string): Promise<string | null> {
  const settings = await storage.getApiSettings(orgId);
  const prefix = `outlook_sender_${senderEmail}_`;
  let accessToken = settings[`${prefix}access_token`] || null;
  let refreshToken = settings[`${prefix}refresh_token`] || null;
  let tokenExpiry = settings[`${prefix}token_expiry`] || null;

  if (!accessToken && !refreshToken) {
    accessToken = settings.microsoft_access_token || null;
    refreshToken = settings.microsoft_refresh_token || null;
    tokenExpiry = settings.microsoft_token_expiry || null;
  }
  if (!accessToken && !refreshToken) return null;

  const expiry = parseInt(tokenExpiry || '0');
  if (!accessToken || Date.now() > expiry - 300000) {
    if (refreshToken) {
      let clientId = settings.microsoft_oauth_client_id || '';
      let clientSecret = settings.microsoft_oauth_client_secret || '';
      if (!clientId || !clientSecret) {
        try {
          const superAdminOrgId = await storage.getSuperAdminOrgId();
          if (superAdminOrgId && superAdminOrgId !== orgId) {
            const ss = await storage.getApiSettings(superAdminOrgId);
            if (ss.microsoft_oauth_client_id) { clientId = ss.microsoft_oauth_client_id; clientSecret = ss.microsoft_oauth_client_secret || ''; }
          }
        } catch (e) { /* ignore */ }
      }
      if (!clientId) clientId = process.env.MICROSOFT_CLIENT_ID || '';
      if (!clientSecret) clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';

      if (clientId && clientSecret) {
        try {
          const body = new URLSearchParams({
            client_id: clientId, client_secret: clientSecret,
            refresh_token: refreshToken, grant_type: 'refresh_token',
            scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/SMTP.Send',
          });
          const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
          });
          if (resp.ok) {
            const tokens = await resp.json() as any;
            if (tokens.access_token) {
              accessToken = tokens.access_token;
              const exp = Date.now() + (tokens.expires_in || 3600) * 1000;
              if (settings[`${prefix}refresh_token`]) {
                await storage.setApiSetting(orgId, `${prefix}access_token`, accessToken);
                if (tokens.refresh_token) await storage.setApiSetting(orgId, `${prefix}refresh_token`, tokens.refresh_token);
                await storage.setApiSetting(orgId, `${prefix}token_expiry`, String(exp));
              } else {
                await storage.setApiSetting(orgId, 'microsoft_access_token', accessToken);
                if (tokens.refresh_token) await storage.setApiSetting(orgId, 'microsoft_refresh_token', tokens.refresh_token);
                await storage.setApiSetting(orgId, 'microsoft_token_expiry', String(exp));
              }
            }
          }
        } catch (e) {
          console.error(`[LeadIntel] Outlook token refresh failed for ${senderEmail}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }
  return accessToken;
}

// ── Gmail History Scan ─────────────────────────────────────────────────

interface HistoryScanResult {
  emailAccountId: string;
  accountEmail: string;
  provider: string;
  emailsFetched: number;
  errors: string[];
}

async function scanGmailHistory(
  orgId: string, emailAccountId: string, accountEmail: string, token: string, sinceDate: Date
): Promise<HistoryScanResult> {
  const result: HistoryScanResult = { emailAccountId, accountEmail, provider: 'gmail', emailsFetched: 0, errors: [] };

  try {
    const afterEpoch = Math.floor(sinceDate.getTime() / 1000);

    let pageToken: string | null = null;
    let totalFetched = 0;
    const maxEmails = 2000; // cap per account

    do {
      // Fetch message list (sent + received)
      let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=after:${afterEpoch}`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      const listResp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!listResp.ok) {
        if (listResp.status === 429) {
          console.log(`[LeadIntel] Gmail rate limit for ${accountEmail}, pausing...`);
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
        result.errors.push(`Gmail list API ${listResp.status}`);
        break;
      }

      const listData = await listResp.json() as any;
      const messages = listData.messages || [];
      pageToken = listData.nextPageToken || null;

      if (messages.length === 0) break;

      // Fetch each message's metadata (batch approach — get headers only)
      for (const msg of messages) {
        if (totalFetched >= maxEmails) break;

        // Skip if already synced
        const exists = await storage.emailHistoryExists(`gmail:${msg.id}`);
        if (exists) { totalFetched++; continue; }

        try {
          const detailResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          if (!detailResp.ok) {
            if (detailResp.status === 429) {
              await new Promise(r => setTimeout(r, 5000));
              continue;
            }
            continue;
          }

          const detail = await detailResp.json() as any;
          const headers = detail.payload?.headers || [];
          const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

          const fromRaw = getHeader('From');
          const toRaw = getHeader('To');
          const subject = getHeader('Subject');
          const dateStr = getHeader('Date');
          const snippet = detail.snippet || '';
          const threadId = detail.threadId || '';

          // Parse from email
          const fromMatch = fromRaw.match(/<([^>]+)>/) || [null, fromRaw];
          const fromEmail = (fromMatch[1] || fromRaw).trim().toLowerCase();
          const fromName = fromRaw.replace(/<[^>]+>/, '').replace(/"/g, '').trim();

          // Parse to email
          const toMatch = toRaw.match(/<([^>]+)>/) || [null, toRaw];
          const toEmail = (toMatch[1] || toRaw).trim().toLowerCase();

          // Determine direction
          const direction = fromEmail === accountEmail.toLowerCase() ? 'sent' : 'received';

          // Parse date
          let receivedAt: string;
          try {
            receivedAt = new Date(dateStr || detail.internalDate ? parseInt(detail.internalDate) : Date.now()).toISOString();
          } catch (e) {
            receivedAt = new Date(parseInt(detail.internalDate || '0')).toISOString();
          }

          await storage.addEmailHistory({
            organizationId: orgId,
            emailAccountId,
            accountEmail,
            provider: 'gmail',
            externalId: `gmail:${msg.id}`,
            threadId: `gmail:${threadId}`,
            fromEmail,
            fromName: fromName || undefined,
            toEmail,
            subject: subject || undefined,
            snippet: snippet.substring(0, 300) || undefined,
            direction,
            receivedAt,
          });

          totalFetched++;
          result.emailsFetched++;

          // Small delay to respect rate limits
          if (totalFetched % 50 === 0) {
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (e) {
          // Non-critical — skip this message
        }
      }

      if (totalFetched >= maxEmails) break;

    } while (pageToken);

    console.log(`[LeadIntel] Gmail scan for ${accountEmail}: ${result.emailsFetched} emails fetched`);
  } catch (e) {
    console.error(`[LeadIntel] Gmail scan error for ${accountEmail}:`, e instanceof Error ? e.message : e);
    result.errors.push(e instanceof Error ? e.message : String(e));
  }

  return result;
}

// ── Outlook History Scan ───────────────────────────────────────────────

async function scanOutlookHistory(
  orgId: string, emailAccountId: string, accountEmail: string, token: string, sinceDate: Date
): Promise<HistoryScanResult> {
  const result: HistoryScanResult = { emailAccountId, accountEmail, provider: 'outlook', emailsFetched: 0, errors: [] };

  try {
    const sinceISO = sinceDate.toISOString();

    let nextLink: string | null = null;
    let totalFetched = 0;
    const maxEmails = 2000;

    // Scan both inbox and sentitems
    const folders = ['inbox', 'sentitems'];

    for (const folder of folders) {
      nextLink = null;

      do {
        const url = nextLink || `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$filter=receivedDateTime ge ${sinceISO}&$select=id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime&$top=100&$orderby=receivedDateTime desc`;

        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) {
          if (resp.status === 429) {
            const retryAfter = parseInt(resp.headers.get('Retry-After') || '10');
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
          }
          result.errors.push(`Outlook ${folder} API ${resp.status}`);
          break;
        }

        const data = await resp.json() as any;
        const messages = data.value || [];
        nextLink = data['@odata.nextLink'] || null;

        if (messages.length === 0) break;

        for (const msg of messages) {
          if (totalFetched >= maxEmails) break;

          const externalId = `outlook:${msg.id}`;
          const exists = await storage.emailHistoryExists(externalId);
          if (exists) { totalFetched++; continue; }

          const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() || '';
          const fromName = msg.from?.emailAddress?.name || '';
          const toEmail = msg.toRecipients?.[0]?.emailAddress?.address?.toLowerCase() || '';
          const subject = msg.subject || '';
          const snippet = msg.bodyPreview?.substring(0, 300) || '';
          const threadId = msg.conversationId ? `outlook:${msg.conversationId}` : '';
          const receivedAt = msg.receivedDateTime || new Date().toISOString();

          const direction = folder === 'sentitems' ? 'sent' : (fromEmail === accountEmail.toLowerCase() ? 'sent' : 'received');

          await storage.addEmailHistory({
            organizationId: orgId,
            emailAccountId,
            accountEmail,
            provider: 'outlook',
            externalId,
            threadId,
            fromEmail,
            fromName: fromName || undefined,
            toEmail,
            subject: subject || undefined,
            snippet: snippet || undefined,
            direction,
            receivedAt,
          });

          totalFetched++;
          result.emailsFetched++;

          if (totalFetched % 50 === 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        }

        if (totalFetched >= maxEmails) break;

      } while (nextLink);

      if (totalFetched >= maxEmails) break;
    }

    console.log(`[LeadIntel] Outlook scan for ${accountEmail}: ${result.emailsFetched} emails fetched`);
  } catch (e) {
    console.error(`[LeadIntel] Outlook scan error for ${accountEmail}:`, e instanceof Error ? e.message : e);
    result.errors.push(e instanceof Error ? e.message : String(e));
  }

  return result;
}

// ── Scan All Accounts for an Org ───────────────────────────────────────

export interface ScanResult {
  orgId: string;
  accountsScanned: number;
  totalEmailsFetched: number;
  results: HistoryScanResult[];
  errors: string[];
}

export async function scanOrgEmailHistory(orgId: string, monthsBack: number = 6, emailAccountIds?: string[], force: boolean = false): Promise<ScanResult> {
  const scanResult: ScanResult = { orgId, accountsScanned: 0, totalEmailsFetched: 0, results: [], errors: [] };

  try {
    // Lead intel sees both regular send-capable accounts AND scan-only accounts. Falls back
    // to getEmailAccounts if the new method isn't present (older storage backend).
    let emailAccounts = (storage as any).getEmailAccountsForLeadIntel
      ? await (storage as any).getEmailAccountsForLeadIntel(orgId)
      : await storage.getEmailAccounts(orgId);

    // Filter to selected accounts if specified
    if (emailAccountIds && emailAccountIds.length > 0) {
      emailAccounts = emailAccounts.filter((a: any) => emailAccountIds.includes(String(a.id)));
    }

    // Buffer applied to lastScanAt to handle clock skew between server and Gmail/Outlook —
    // safe because emailHistoryExists dedup will skip any re-fetched messages by externalId.
    const RESCAN_BUFFER_MS = 60 * 60 * 1000; // 1 hour

    for (const account of emailAccounts) {
      const email = (account as any).email;
      const provider = ((account as any).provider || '').toLowerCase();
      const accountId = (account as any).id;
      const lastScanAtRaw = (account as any).leadIntelLastScanAt as string | null | undefined;

      if (!email) continue;

      // Compute the effective since-date for this account:
      //   - monthsBack window (e.g. 6 months ago) is the floor
      //   - if not force AND we have a previous successful scan, use it (with buffer) when later
      //   - this means subsequent scans only fetch emails newer than the last successful scan
      const monthsBackDate = new Date();
      monthsBackDate.setMonth(monthsBackDate.getMonth() - monthsBack);
      let sinceDate = monthsBackDate;
      let usedIncremental = false;
      if (!force && lastScanAtRaw) {
        const lastScan = new Date(lastScanAtRaw);
        if (!isNaN(lastScan.getTime())) {
          const lastScanWithBuffer = new Date(lastScan.getTime() - RESCAN_BUFFER_MS);
          if (lastScanWithBuffer > sinceDate) {
            sinceDate = lastScanWithBuffer;
            usedIncremental = true;
          }
        }
      }

      const isGmail = provider === 'gmail' || provider === 'google';
      const isOutlook = provider === 'outlook' || provider === 'microsoft';

      let token: string | null = null;
      let result: HistoryScanResult | null = null;

      if (isGmail) {
        token = await getGmailAccessToken(orgId, email);
        if (token) {
          result = await scanGmailHistory(orgId, accountId, email, token, sinceDate);
        }
      } else if (isOutlook) {
        token = await getOutlookAccessToken(orgId, email);
        if (token) {
          result = await scanOutlookHistory(orgId, accountId, email, token, sinceDate);
        }
      } else {
        // Try Gmail first, then Outlook
        token = await getGmailAccessToken(orgId, email);
        if (token) {
          result = await scanGmailHistory(orgId, accountId, email, token, sinceDate);
        } else {
          token = await getOutlookAccessToken(orgId, email);
          if (token) {
            result = await scanOutlookHistory(orgId, accountId, email, token, sinceDate);
          }
        }
      }

      if (!token) {
        scanResult.errors.push(`No OAuth token for ${email}`);
        continue;
      }

      if (result) {
        scanResult.accountsScanned++;
        scanResult.totalEmailsFetched += result.emailsFetched;
        scanResult.results.push(result);
        console.log(`[LeadIntel] ${email} scan: mode=${usedIncremental ? 'incremental' : (force ? 'force-full' : 'first-full')}, since=${sinceDate.toISOString()}, fetched=${result.emailsFetched}, errors=${result.errors.length}`);

        // Update lastScanAt only on a clean scan (no errors). On error we leave it
        // alone so the next attempt re-scans the same window.
        if (result.errors.length === 0) {
          try {
            await storage.rawRun(
              `UPDATE email_accounts SET "leadIntelLastScanAt" = ? WHERE id = ?`,
              new Date().toISOString(), accountId
            );
          } catch (e) {
            console.error(`[LeadIntel] Failed to update leadIntelLastScanAt for ${email}:`, e instanceof Error ? e.message : e);
          }
        }
      }
    }

    console.log(`[LeadIntel] Org ${orgId} scan complete: ${scanResult.accountsScanned} accounts, ${scanResult.totalEmailsFetched} emails`);
  } catch (e) {
    console.error(`[LeadIntel] Org scan error:`, e instanceof Error ? e.message : e);
    scanResult.errors.push(e instanceof Error ? e.message : String(e));
  }

  return scanResult;
}

// ── AI Classification ──────────────────────────────────────────────────

const BUCKET_LABELS: Record<string, string> = {
  past_customer: 'Past Customer',
  hot_lead: 'Hot Lead',
  warm_lead: 'Warm Lead',
  interested_stalled: 'Interested but Stalled',
  almost_closed: 'Almost Closed',
  meeting_no_deal: 'Meeting — No Deal',
  went_silent: 'Went Silent',
  not_interested: 'Not Interested',
  no_response: 'No Response',
  referral_potential: 'Referral Potential',
  converted: 'Converted',
  unknown: 'Unknown',
};

export { BUCKET_LABELS };

export const DEFAULT_LEAD_PROMPT = `You are a B2B sales intelligence analyst. Classify each contact based on their email conversation history with our team.

IMPORTANT CONTEXT:
- "Sent to them" = our outreach emails (cold emails, follow-ups, proposals)
- "Received from them" = they replied or initiated contact with us — this is the key signal
- All contacts listed here have at least 1 inbound email from them
- Focus on the CONTENT of subjects/snippets to determine intent and relationship stage
- Auto-replies, bounces, out-of-office, and unsubscribe requests are NOT real engagement
- Newsletter signups, marketing emails, and automated notifications are NOT leads

BUCKETS (choose exactly ONE per contact):
- past_customer: Clear evidence of completed business — invoices, orders, payments, delivery confirmations, "thank you for your business", contract references
- hot_lead: Recent positive reply with buying signals — asked about pricing, requested demo/meeting, wants proposal, "let's discuss", "send me details"
- almost_closed: Negotiation phase — pricing/proposal discussed, "let me think about it", "need approval from management", back-and-forth on terms
- warm_lead: Positive but non-committal — polite interest, asked general questions, "sounds interesting", forwarded to colleague, but no concrete next step
- interested_stalled: Initially showed interest (1-2 positive replies) then went quiet — no response to follow-ups for 2+ weeks
- meeting_no_deal: Meeting/call clearly happened (calendar invite, "nice meeting you", "per our discussion") but no deal resulted
- went_silent: Had active back-and-forth conversation (3+ exchanges) then abruptly stopped responding
- not_interested: Explicitly declined — "not interested", "not the right time", "please remove me", "do not contact", negative sentiment
- referral_potential: Very positive relationship, expressed satisfaction, may refer others — "happy with your service", "I'll recommend you"
- converted: Deal clearly closed — active ongoing customer, regular orders, support emails, account management

DO NOT classify as hot_lead or almost_closed unless there is CLEAR evidence of buying intent in the subjects/snippets. When in doubt between warm_lead and interested_stalled, prefer interested_stalled if the last email is older than 2 weeks.`;

interface ContactConversationSummary {
  contactEmail: string;
  contactName: string;
  accountEmail: string;
  emailAccountId: string;
  totalEmails: number;
  totalSent: number;
  totalReceived: number;
  lastEmailDate: string;
  subjects: string[];
  snippets: string[];
}

async function buildContactSummaries(orgId: string, emailAccountIds?: string[]): Promise<ContactConversationSummary[]> {
  const summaries: ContactConversationSummary[] = [];

  // Get org account emails once (to skip internal emails). Includes scan-only accounts
  // since their emails are also "us" — replies to them are still external contacts, but
  // emails from those addresses to other people inside the org should be excluded.
  const orgAccounts = (storage as any).getEmailAccountsForLeadIntel
    ? await (storage as any).getEmailAccountsForLeadIntel(orgId)
    : await storage.getEmailAccounts(orgId);
  const orgEmails = new Set((orgAccounts as any[]).map((a: any) => (a.email || '').toLowerCase()).filter(Boolean));
  console.log(`[LeadIntel] Org emails to exclude: ${Array.from(orgEmails).join(', ')}`);

  // 1. From email_history (historical scan)
  try {
    // Build account filter clause
    const hasAccountFilter = emailAccountIds && emailAccountIds.length > 0;
    const accountFilterSQL = hasAccountFilter ? ` AND "emailAccountId" IN (${emailAccountIds!.map(() => '?').join(',')})` : '';
    const accountFilterParams = hasAccountFilter ? emailAccountIds! : [];

    const countCheck = await storage.rawGet(`SELECT COUNT(*) as cnt FROM email_history WHERE "organizationId" = ?${accountFilterSQL}`, orgId, ...accountFilterParams) as any;
    console.log(`[LeadIntel] email_history has ${countCheck?.cnt || 0} rows for org ${orgId}${hasAccountFilter ? ` (filtered to ${emailAccountIds!.length} accounts)` : ''}`);

    if ((countCheck?.cnt || 0) === 0) {
      console.log(`[LeadIntel] No email_history rows — skipping history-based summaries`);
    } else {
      // Step 1: Get contacts who have REPLIED or INITIATED contact (at least 1 received email)
      // Sent-only contacts are just outreach recipients — not leads
      const contactRows = await storage.rawAll(`
        SELECT
          LOWER("fromEmail") as "contactEmail",
          MAX("fromName") as "contactName",
          MAX("accountEmail") as "accountEmail",
          MAX("emailAccountId") as "emailAccountId",
          COUNT(*) as "totalReceived",
          MAX("receivedAt") as "lastEmailDate"
        FROM email_history
        WHERE "organizationId" = ? AND direction = 'received'
          AND "fromEmail" IS NOT NULL AND "fromEmail" != ''
          ${accountFilterSQL}
        GROUP BY "contactEmail"
        ORDER BY "lastEmailDate" DESC
        LIMIT 1000
      `, orgId, ...accountFilterParams) as any[];

      console.log(`[LeadIntel] Contacts with incoming emails: ${contactRows.length}`);

      // Also get sent counts per contact (for context: how many times we reached out)
      const sentCounts: Record<string, number> = {};
      try {
        const sentRows = await storage.rawAll(`
          SELECT LOWER("toEmail") as "contactEmail", COUNT(*) as cnt
          FROM email_history
          WHERE "organizationId" = ? AND direction = 'sent'
            AND "toEmail" IS NOT NULL AND "toEmail" != ''
            ${accountFilterSQL}
          GROUP BY "contactEmail"
        `, orgId, ...accountFilterParams) as any[];
        for (const r of sentRows) {
          sentCounts[(r.contactEmail || '').toLowerCase()] = r.cnt;
        }
      } catch (e) { /* non-critical */ }

      // Step 2: Filter out internal org emails
      let skippedInternal = 0;
      for (const row of contactRows) {
        const email = (row.contactEmail || '').toLowerCase().trim();
        if (!email || orgEmails.has(email)) { skippedInternal++; continue; }

        // Fetch up to 5 recent subjects + snippets for this contact
        let subjects: string[] = [];
        let snippets: string[] = [];
        try {
          const samples = await storage.rawAll(`
            SELECT subject, snippet FROM email_history
            WHERE "organizationId" = ? AND (LOWER("fromEmail") = ? OR LOWER("toEmail") = ?)
            ORDER BY "receivedAt" DESC LIMIT 5
          `, orgId, email, email) as any[];
          subjects = samples.map((s: any) => s.subject).filter(Boolean);
          snippets = samples.map((s: any) => (s.snippet || '').substring(0, 200)).filter(Boolean);
        } catch (e) { /* non-critical */ }

        const totalSent = sentCounts[email] || 0;
        summaries.push({
          contactEmail: email,
          contactName: row.contactName || '',
          accountEmail: row.accountEmail || '',
          emailAccountId: row.emailAccountId || '',
          totalEmails: row.totalReceived + totalSent,
          totalSent,
          totalReceived: row.totalReceived,
          lastEmailDate: row.lastEmailDate,
          subjects,
          snippets,
        });
      }
      console.log(`[LeadIntel] After filtering: ${summaries.length} external contacts, ${skippedInternal} internal skipped`);
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[LeadIntel] ERROR building history summaries:', errMsg);
    console.error('[LeadIntel] Stack:', e instanceof Error ? e.stack : '');
  }

  // 2. From unified_inbox + campaign data (existing campaign contacts)
  // Uses JS-side aggregation instead of GROUP_CONCAT for cross-DB compatibility
  try {
    const inboxRows = await storage.rawAll(`
      SELECT "fromEmail" as "contactEmail", "fromName" as "contactName",
        subject, snippet, "receivedAt"
      FROM unified_inbox
      WHERE "organizationId" = ? AND status != 'sent'
      ORDER BY "receivedAt" DESC
      LIMIT 2000
    `, orgId) as any[];

    // Aggregate in JS (works for both SQLite and PostgreSQL)
    const inboxMap: Record<string, any> = {};
    for (const row of inboxRows) {
      const key = (row.contactEmail || '').toLowerCase();
      if (!key) continue;
      if (!inboxMap[key]) {
        inboxMap[key] = { contactEmail: key, contactName: row.contactName || '', totalReplies: 0, lastReplyDate: '', subjects: [], snippets: [] };
      }
      inboxMap[key].totalReplies++;
      if (!inboxMap[key].lastReplyDate || row.receivedAt > inboxMap[key].lastReplyDate) inboxMap[key].lastReplyDate = row.receivedAt;
      if (row.subject && inboxMap[key].subjects.length < 5) inboxMap[key].subjects.push(row.subject);
      if (row.snippet && inboxMap[key].snippets.length < 5) inboxMap[key].snippets.push((row.snippet || '').substring(0, 200));
    }

    for (const row of Object.values(inboxMap)) {
      const existing = summaries.find(s => s.contactEmail === row.contactEmail);
      if (existing) {
        existing.totalReceived += row.totalReplies;
        existing.totalEmails += row.totalReplies;
        if (row.lastReplyDate > existing.lastEmailDate) existing.lastEmailDate = row.lastReplyDate;
        existing.subjects = [...existing.subjects, ...row.subjects].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
        existing.snippets = [...existing.snippets, ...row.snippets].slice(0, 5);
      } else {
        summaries.push({
          contactEmail: row.contactEmail,
          contactName: row.contactName,
          accountEmail: '',
          emailAccountId: '',
          totalEmails: row.totalReplies,
          totalSent: 0,
          totalReceived: row.totalReplies,
          lastEmailDate: row.lastReplyDate,
          subjects: row.subjects.slice(0, 5),
          snippets: row.snippets.slice(0, 5),
        });
      }
    }
  } catch (e) {
    console.error('[LeadIntel] Error building campaign summaries:', e instanceof Error ? e.message : e);
  }

  // 3. Enrich existing summaries with contact table data (name, company, engagement stats)
  // Only enriches — does NOT add sent-only contacts (those are outreach noise, not leads)
  try {
    const contactRows = await storage.rawAll(`
      SELECT email, "firstName", "lastName", company,
        "totalSent", "totalOpened", "totalClicked", "totalReplied",
        "lastOpenedAt", "lastClickedAt", "lastRepliedAt", "leadStatus", status
      FROM contacts
      WHERE "organizationId" = ? AND "totalSent" > 0
      ORDER BY "totalSent" DESC
      LIMIT 500
    `, orgId) as any[];

    for (const c of contactRows) {
      if (!c.email) continue;
      const existing = summaries.find(s => s.contactEmail === c.email.toLowerCase());
      if (existing) {
        // Enrich with contact data (name, sent count)
        if (!existing.contactName && (c.firstName || c.lastName)) {
          existing.contactName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
        }
        existing.totalSent = Math.max(existing.totalSent, c.totalSent || 0);
        existing.totalEmails = existing.totalSent + existing.totalReceived;
      }
      // Contacts who only received outreach but never replied are NOT added
    }
  } catch (e) {
    console.error('[LeadIntel] Error enriching contact summaries:', e instanceof Error ? e.message : e);
  }

  return summaries;
}

// ── Azure OpenAI Batch Classification ──────────────────────────────────

interface ClassificationResult {
  contactEmail: string;
  bucket: string;
  confidence: number;
  reasoning: string;
  suggestedAction: string;
}

async function classifyContactsWithAI(
  orgId: string,
  contacts: ContactConversationSummary[]
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];

  // Get Azure OpenAI settings and custom prompt
  const settings = await storage.getApiSettingsWithAzureFallback(orgId);
  const endpoint = settings.azure_openai_endpoint;
  const apiKey = settings.azure_openai_api_key;
  const deploymentName = settings.azure_openai_deployment;
  const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';
  const customPrompt = (settings as any).lead_intelligence_prompt || '';

  if (!endpoint || !apiKey || !deploymentName) {
    console.log('[LeadIntel] Azure OpenAI not configured — using rule-based classification');
    // Fallback to rule-based classification
    for (const contact of contacts) {
      results.push(classifyByRules(contact));
    }
    return results;
  }

  // Process in batches of 10 contacts per API call to reduce costs
  const batchSize = 10;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);

    const contactDescriptions = batch.map((c, idx) => {
      const snippetText = c.snippets.length > 0 ? `\nRecent snippets: ${c.snippets.slice(0, 2).join(' | ')}` : '';
      const subjectText = c.subjects.length > 0 ? `\nSubjects: ${c.subjects.slice(0, 3).join(', ')}` : '';
      return `Contact ${idx + 1}: ${c.contactEmail}${c.contactName ? ` (${c.contactName})` : ''}
Emails: ${c.totalEmails} total (${c.totalSent} sent to them, ${c.totalReceived} received from them)
Last email: ${c.lastEmailDate || 'unknown'}${subjectText}${snippetText}`;
    }).join('\n\n');

    const contactSuffix = `\n\nCONTACTS TO CLASSIFY:\n${contactDescriptions}\n\nRespond with a JSON array. Each object must have: email, bucket, confidence (0-100), reasoning (1 sentence explaining WHY this bucket), action (1 specific suggested next step).\n[{"email": "...", "bucket": "...", "confidence": <0-100>, "reasoning": "...", "action": "..."}]\n\nRespond ONLY with the JSON array.`;
    const defaultPromptInstructions = DEFAULT_LEAD_PROMPT + contactSuffix;

    // Use custom prompt if admin has set one, otherwise use default
    const prompt = customPrompt
      ? `${customPrompt}\n\nCONTACTS TO CLASSIFY:\n${contactDescriptions}\n\nRespond with a JSON array. Each object must have: email, bucket, confidence (0-100), reasoning (1 sentence), action (suggested next step).\n[{"email": "...", "bucket": "...", "confidence": <0-100>, "reasoning": "...", "action": "..."}]\n\nRespond ONLY with the JSON array.`
      : defaultPromptInstructions;

    try {
      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a B2B sales intelligence analyst. Classify leads accurately based on email conversation history. Be conservative — only assign high-confidence buckets (hot_lead, almost_closed, past_customer) when there is clear evidence in the email content. When snippets are vague or generic, use lower confidence scores. Respond only with valid JSON arrays.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        console.error(`[LeadIntel] Azure OpenAI error: ${response.status}`);
        // Fallback to rules for this batch
        for (const contact of batch) {
          results.push(classifyByRules(contact));
        }
        continue;
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '';

      // Parse JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const classifications = JSON.parse(jsonMatch[0]);
        for (const cls of classifications) {
          results.push({
            contactEmail: cls.email,
            bucket: cls.bucket || 'unknown',
            confidence: Math.min(100, Math.max(0, cls.confidence || 50)),
            reasoning: cls.reasoning || '',
            suggestedAction: cls.action || '',
          });
        }
      } else {
        // Parse failed — use rules
        for (const contact of batch) {
          results.push(classifyByRules(contact));
        }
      }

      // Small delay between batches
      if (i + batchSize < contacts.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error('[LeadIntel] AI classification error:', e instanceof Error ? e.message : e);
      for (const contact of batch) {
        results.push(classifyByRules(contact));
      }
    }
  }

  return results;
}

// ── Rule-Based Fallback Classification ─────────────────────────────────

function classifyByRules(contact: ContactConversationSummary): ClassificationResult {
  const { contactEmail, totalSent, totalReceived, lastEmailDate, snippets } = contact;
  const snippetText = snippets.join(' ').toLowerCase();

  // Check snippets for signals
  const positiveSignals = ['interested', 'pricing', 'demo', 'meeting', 'schedule', 'call', 'proposal', 'budget', 'timeline', 'purchase', 'let\'s discuss', 'send me details', 'would like to know'];
  const negativeSignals = ['not interested', 'unsubscribe', 'remove me', 'stop', 'no thanks', 'not right now', 'do not contact', 'opt out', 'wrong person'];
  const customerSignals = ['invoice', 'payment', 'order', 'receipt', 'thank you for your business', 'renewal', 'contract', 'delivery', 'shipped'];
  const autoReplySignals = ['out of office', 'auto-reply', 'automatic reply', 'vacation', 'i am currently out', 'will be out of office', 'mailer-daemon', 'postmaster', 'undeliverable', 'delivery failed'];

  const hasPositive = positiveSignals.some(s => snippetText.includes(s));
  const hasNegative = negativeSignals.some(s => snippetText.includes(s));
  const hasCustomer = customerSignals.some(s => snippetText.includes(s));
  const hasAutoReply = autoReplySignals.some(s => snippetText.includes(s));

  const daysSinceLastEmail = lastEmailDate ? Math.floor((Date.now() - new Date(lastEmailDate).getTime()) / (1000 * 60 * 60 * 24)) : 999;

  // Skip auto-replies/bounces — they're not real engagement
  if (hasAutoReply && totalReceived <= 1 && !hasPositive && !hasCustomer) {
    return { contactEmail, bucket: 'no_response', confidence: 80, reasoning: 'Only received auto-reply or bounce notification — no real engagement', suggestedAction: 'Retry with different email or channel' };
  }

  if (hasCustomer) {
    return { contactEmail, bucket: 'past_customer', confidence: 70, reasoning: 'Email content suggests previous business relationship', suggestedAction: 'Re-engage for upsell or referral' };
  }
  if (hasNegative) {
    return { contactEmail, bucket: 'not_interested', confidence: 75, reasoning: 'Negative or opt-out signals detected in replies', suggestedAction: 'Archive — do not contact' };
  }
  if (hasPositive && totalReceived > 0 && daysSinceLastEmail < 14) {
    return { contactEmail, bucket: 'hot_lead', confidence: 70, reasoning: 'Recent positive engagement with buying signals', suggestedAction: 'Follow up immediately with proposal or meeting invite' };
  }
  if (hasPositive && totalReceived > 0) {
    return { contactEmail, bucket: 'warm_lead', confidence: 60, reasoning: 'Positive signals in conversation but not recent', suggestedAction: 'Re-engage with updated offer or check-in' };
  }
  if (totalReceived >= 1 && totalSent >= 3 && daysSinceLastEmail > 30) {
    return { contactEmail, bucket: 'went_silent', confidence: 60, reasoning: 'Active conversation that suddenly stopped', suggestedAction: 'Send a check-in or different angle' };
  }
  if (totalReceived === 1 && totalSent >= 2 && daysSinceLastEmail > 14) {
    return { contactEmail, bucket: 'interested_stalled', confidence: 55, reasoning: 'Replied once then went silent', suggestedAction: 'Send re-engagement email with new value proposition' };
  }
  if (totalReceived > 0 && daysSinceLastEmail < 30) {
    return { contactEmail, bucket: 'warm_lead', confidence: 50, reasoning: 'Some engagement in recent conversation', suggestedAction: 'Continue nurturing with relevant content' };
  }
  if (totalSent > 0 && totalReceived === 0) {
    return { contactEmail, bucket: 'no_response', confidence: 65, reasoning: 'Emails sent but no replies received', suggestedAction: 'Try different subject line or channel' };
  }

  return { contactEmail, bucket: 'unknown', confidence: 30, reasoning: 'Insufficient data to classify', suggestedAction: 'Review manually' };
}

// ── Main Analysis Pipeline ─────────────────────────────────────────────

export interface AnalysisResult {
  orgId: string;
  contactsAnalyzed: number;
  opportunitiesCreated: number;
  bucketCounts: Record<string, number>;
  errors: string[];
  debug?: any;
}

export async function analyzeOrgLeads(orgId: string, emailAccountIds?: string[]): Promise<AnalysisResult> {
  const result: AnalysisResult = { orgId, contactsAnalyzed: 0, opportunitiesCreated: 0, bucketCounts: {}, errors: [], debug: {} };

  try {
    console.log(`[LeadIntel] Starting lead analysis for org ${orgId}...`);

    // Quick DB check before building summaries
    try {
      const cnt = await storage.rawGet(`SELECT COUNT(*) as cnt FROM email_history WHERE "organizationId" = ?`, orgId) as any;
      result.debug.emailHistoryCount = cnt?.cnt || 0;
      result.debug.dbOk = true;
    } catch (dbErr) {
      result.debug.dbError = dbErr instanceof Error ? dbErr.message : String(dbErr);
    }

    // 1. Build contact conversation summaries
    const summaries = await buildContactSummaries(orgId, emailAccountIds);
    result.contactsAnalyzed = summaries.length;
    result.debug.summariesBuilt = summaries.length;
    result.debug.sampleContacts = summaries.slice(0, 3).map(s => ({ email: s.contactEmail, emails: s.totalEmails }));
    console.log(`[LeadIntel] Built ${summaries.length} contact summaries`);

    if (summaries.length === 0) {
      result.errors.push(`No contacts found. DB has ${result.debug.emailHistoryCount} email_history rows. Check buildContactSummaries.`);
      return result;
    }

    // 2. Classify with AI (or rules)
    const classifications = await classifyContactsWithAI(orgId, summaries);
    console.log(`[LeadIntel] Classified ${classifications.length} contacts`);

    // 3. Clear old opportunities and store new ones
    await storage.deleteLeadOpportunitiesByOrg(orgId);

    for (const cls of classifications) {
      const summary = summaries.find(s => s.contactEmail === cls.contactEmail);
      if (!summary) continue;

      // Look up existing contact for company info
      let company = '';
      try {
        const contact = await storage.rawGet('SELECT company FROM contacts WHERE "organizationId" = ? AND LOWER(email) = ? LIMIT 1', orgId, cls.contactEmail.toLowerCase()) as any;
        if (contact?.company) company = contact.company;
      } catch (e) { /* ignore */ }

      await storage.addLeadOpportunity({
        organizationId: orgId,
        emailAccountId: summary.emailAccountId || undefined,
        accountEmail: summary.accountEmail || undefined,
        contactEmail: cls.contactEmail,
        contactName: summary.contactName,
        company,
        bucket: cls.bucket,
        confidence: cls.confidence,
        aiReasoning: cls.reasoning,
        suggestedAction: cls.suggestedAction,
        lastEmailDate: summary.lastEmailDate,
        totalEmails: summary.totalEmails,
        totalSent: summary.totalSent,
        totalReceived: summary.totalReceived,
        sampleSubjects: summary.subjects,
        sampleSnippets: summary.snippets,
      });

      result.opportunitiesCreated++;
      result.bucketCounts[cls.bucket] = (result.bucketCounts[cls.bucket] || 0) + 1;
    }

    console.log(`[LeadIntel] Org ${orgId} analysis complete: ${result.opportunitiesCreated} opportunities`);
    console.log(`[LeadIntel] Buckets:`, result.bucketCounts);
  } catch (e) {
    console.error('[LeadIntel] Analysis error:', e instanceof Error ? e.message : e);
    result.errors.push(e instanceof Error ? e.message : String(e));
  }

  return result;
}

// ── Incremental Analysis ───────────────────────────────────────────────
// Like analyzeOrgLeads but only classifies contacts that don't already have a
// lead_opportunity row. Saves Azure OpenAI tokens by skipping previously-analyzed
// contacts. Does NOT delete any existing lead_opportunities.
//
// Use this when the user clicks "Analyse" repeatedly — first run classifies everyone,
// subsequent runs only process newly-discovered contacts (e.g. those who emailed since
// the last scan).
//
// To force a full re-classification (e.g. after the AI prompt is changed), use the
// existing analyzeOrgLeads which deletes-and-rebuilds.
export async function analyzeOrgLeadsIncremental(orgId: string, emailAccountIds?: string[]): Promise<AnalysisResult> {
  const result: AnalysisResult = {
    orgId,
    contactsAnalyzed: 0,
    opportunitiesCreated: 0,
    bucketCounts: {},
    errors: [],
    debug: { mode: 'incremental' } as any,
  };

  try {
    console.log(`[LeadIntel] Starting INCREMENTAL lead analysis for org ${orgId}...`);

    // 1. Build all summaries (same buildContactSummaries used by analyzeOrgLeads)
    const summaries = await buildContactSummaries(orgId, emailAccountIds);
    (result.debug as any).totalSummaries = summaries.length;

    if (summaries.length === 0) {
      result.errors.push(`No contacts found in email_history for this org (or selected accounts).`);
      return result;
    }

    // 2. Get already-classified contact emails for this org
    let alreadyClassified = new Set<string>();
    try {
      const existing = await storage.rawAll(
        `SELECT LOWER("contactEmail") as "contactEmail" FROM lead_opportunities WHERE "organizationId" = ?`,
        orgId
      ) as any[];
      alreadyClassified = new Set(existing.map((r: any) => (r.contactEmail || '').toLowerCase()).filter(Boolean));
    } catch (e) {
      console.error('[LeadIntel] Incremental: failed to load existing opportunities:', e instanceof Error ? e.message : e);
      result.errors.push('Failed to read existing classifications');
      return result;
    }
    (result.debug as any).alreadyClassified = alreadyClassified.size;

    // 3. Filter to contacts NOT yet classified
    const newContacts = summaries.filter(s => !alreadyClassified.has((s.contactEmail || '').toLowerCase()));
    result.contactsAnalyzed = newContacts.length;
    (result.debug as any).newContacts = newContacts.length;

    console.log(`[LeadIntel] Incremental: ${summaries.length} total contacts, ${alreadyClassified.size} already classified, ${newContacts.length} new to classify`);

    if (newContacts.length === 0) {
      console.log('[LeadIntel] Incremental: nothing new to classify — exiting cleanly');
      return result;
    }

    // 4. Classify only the new contacts
    const classifications = await classifyContactsWithAI(orgId, newContacts);
    console.log(`[LeadIntel] Incremental: classified ${classifications.length} new contacts`);

    // 5. ADD new lead_opportunities — does NOT delete existing
    for (const cls of classifications) {
      const summary = newContacts.find(s => s.contactEmail === cls.contactEmail);
      if (!summary) continue;

      let company = '';
      try {
        const contact = await storage.rawGet('SELECT company FROM contacts WHERE "organizationId" = ? AND LOWER(email) = ? LIMIT 1', orgId, cls.contactEmail.toLowerCase()) as any;
        if (contact?.company) company = contact.company;
      } catch (e) { /* ignore */ }

      await storage.addLeadOpportunity({
        organizationId: orgId,
        emailAccountId: summary.emailAccountId || undefined,
        accountEmail: summary.accountEmail || undefined,
        contactEmail: cls.contactEmail,
        contactName: summary.contactName,
        company,
        bucket: cls.bucket,
        confidence: cls.confidence,
        aiReasoning: cls.reasoning,
        suggestedAction: cls.suggestedAction,
        lastEmailDate: summary.lastEmailDate,
        totalEmails: summary.totalEmails,
        totalSent: summary.totalSent,
        totalReceived: summary.totalReceived,
        sampleSubjects: summary.subjects,
        sampleSnippets: summary.snippets,
      });

      result.opportunitiesCreated++;
      result.bucketCounts[cls.bucket] = (result.bucketCounts[cls.bucket] || 0) + 1;
    }

    console.log(`[LeadIntel] Incremental complete: ${result.opportunitiesCreated} new opportunities added (existing preserved)`);
  } catch (e) {
    console.error('[LeadIntel] Incremental analysis error:', e instanceof Error ? e.message : e);
    result.errors.push(e instanceof Error ? e.message : String(e));
  }

  return result;
}

// ── Full Pipeline: Scan + Analyze ──────────────────────────────────────

export async function runFullLeadIntelligence(orgId: string, monthsBack: number = 6, emailAccountIds?: string[], force: boolean = false): Promise<{ scan: ScanResult; analysis: AnalysisResult }> {
  console.log(`[LeadIntel] Starting full pipeline for org ${orgId} (${monthsBack} months back, mode=${force ? 'force-full' : 'incremental'})...`);

  // Step 1: Scan email history (incremental by default — only fetches messages newer
  // than each account's last successful scan. force=true rescans the full monthsBack window.)
  const scan = await scanOrgEmailHistory(orgId, monthsBack, emailAccountIds, force);

  // Step 1b: Sweep historical bounce/unsubscribe signals → suppression_list + contact status
  try {
    await sweepSuppressionSignalsFromHistory(orgId);
  } catch (e) {
    console.error('[LeadIntel] Suppression sweep failed:', e instanceof Error ? e.message : e);
  }

  // Step 2: Analyze and classify. force=true triggers delete-and-rebuild via analyzeOrgLeads;
  // otherwise use the incremental path that skips already-classified contacts.
  const analysis = force
    ? await analyzeOrgLeads(orgId, emailAccountIds)
    : await analyzeOrgLeadsIncremental(orgId, emailAccountIds);

  return { scan, analysis };
}
