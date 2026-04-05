import { storage } from "../storage";
import { OAuth2Client } from 'google-auth-library';

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
  orgId: string, emailAccountId: string, accountEmail: string, token: string, monthsBack: number = 6
): Promise<HistoryScanResult> {
  const result: HistoryScanResult = { emailAccountId, accountEmail, provider: 'gmail', emailsFetched: 0, errors: [] };

  try {
    const sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - monthsBack);
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
  orgId: string, emailAccountId: string, accountEmail: string, token: string, monthsBack: number = 6
): Promise<HistoryScanResult> {
  const result: HistoryScanResult = { emailAccountId, accountEmail, provider: 'outlook', emailsFetched: 0, errors: [] };

  try {
    const sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - monthsBack);
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

export async function scanOrgEmailHistory(orgId: string, monthsBack: number = 6, emailAccountIds?: string[]): Promise<ScanResult> {
  const scanResult: ScanResult = { orgId, accountsScanned: 0, totalEmailsFetched: 0, results: [], errors: [] };

  try {
    let emailAccounts = await storage.getEmailAccounts(orgId);

    // Filter to selected accounts if specified
    if (emailAccountIds && emailAccountIds.length > 0) {
      emailAccounts = emailAccounts.filter((a: any) => emailAccountIds.includes(String(a.id)));
    }

    for (const account of emailAccounts) {
      const email = (account as any).email;
      const provider = ((account as any).provider || '').toLowerCase();
      const accountId = (account as any).id;

      if (!email) continue;

      const isGmail = provider === 'gmail' || provider === 'google';
      const isOutlook = provider === 'outlook' || provider === 'microsoft';

      let token: string | null = null;
      let result: HistoryScanResult | null = null;

      if (isGmail) {
        token = await getGmailAccessToken(orgId, email);
        if (token) {
          result = await scanGmailHistory(orgId, accountId, email, token, monthsBack);
        }
      } else if (isOutlook) {
        token = await getOutlookAccessToken(orgId, email);
        if (token) {
          result = await scanOutlookHistory(orgId, accountId, email, token, monthsBack);
        }
      } else {
        // Try Gmail first, then Outlook
        token = await getGmailAccessToken(orgId, email);
        if (token) {
          result = await scanGmailHistory(orgId, accountId, email, token, monthsBack);
        } else {
          token = await getOutlookAccessToken(orgId, email);
          if (token) {
            result = await scanOutlookHistory(orgId, accountId, email, token, monthsBack);
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

interface ContactConversationSummary {
  contactEmail: string;
  contactName: string;
  totalEmails: number;
  totalSent: number;
  totalReceived: number;
  lastEmailDate: string;
  subjects: string[];
  snippets: string[];
}

async function buildContactSummaries(orgId: string): Promise<ContactConversationSummary[]> {
  const db = (storage as any).db;
  const summaries: ContactConversationSummary[] = [];

  // 1. From email_history (historical scan)
  try {
    // Debug: check email_history count for this org
    const countCheck = db.prepare(`SELECT COUNT(*) as cnt FROM email_history WHERE organizationId = ?`).get(orgId) as any;
    console.log(`[LeadIntel] buildContactSummaries: email_history has ${countCheck?.cnt || 0} rows for org ${orgId}`);

    // Also check a sample row to verify data shape
    const sampleRow = db.prepare(`SELECT direction, fromEmail, toEmail FROM email_history WHERE organizationId = ? LIMIT 1`).get(orgId) as any;
    console.log(`[LeadIntel] Sample row:`, JSON.stringify(sampleRow));

    const rows = db.prepare(`
      SELECT
        CASE WHEN direction = 'sent' THEN toEmail ELSE fromEmail END as contactEmail,
        CASE WHEN direction = 'sent' THEN '' ELSE fromName END as contactName,
        COUNT(*) as totalEmails,
        SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as totalSent,
        SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as totalReceived,
        MAX(receivedAt) as lastEmailDate,
        GROUP_CONCAT(DISTINCT subject, '|||') as subjects,
        GROUP_CONCAT(snippet, '|||') as snippets
      FROM email_history
      WHERE organizationId = ?
        AND CASE WHEN direction = 'sent' THEN toEmail ELSE fromEmail END != ''
      GROUP BY contactEmail
      HAVING totalEmails >= 1
      ORDER BY lastEmailDate DESC
      LIMIT 1000
    `).all(orgId) as any[];

    console.log(`[LeadIntel] Query returned ${rows.length} contact rows`);

    // Get org account emails once (to skip internal emails)
    const orgAccounts = await storage.getEmailAccounts(orgId);
    const orgEmails = new Set((orgAccounts as any[]).map((a: any) => a.email?.toLowerCase()));
    const orgDomains = new Set((orgAccounts as any[]).map((a: any) => (a.email || '').split('@')[1]?.toLowerCase()).filter(Boolean));

    for (const row of rows) {
      // Skip internal org emails (exact match with linked accounts)
      if (orgEmails.has(row.contactEmail?.toLowerCase())) continue;

      const subjects = (row.subjects || '').split('|||').filter(Boolean).slice(0, 5);
      const snippets = (row.snippets || '').split('|||').filter(Boolean).slice(0, 3);

      summaries.push({
        contactEmail: row.contactEmail,
        contactName: row.contactName || '',
        totalEmails: row.totalEmails,
        totalSent: row.totalSent,
        totalReceived: row.totalReceived,
        lastEmailDate: row.lastEmailDate,
        subjects,
        snippets: snippets.map((s: string) => s.substring(0, 200)),
      });
    }
    console.log(`[LeadIntel] After filtering org emails: ${summaries.length} external contacts (filtered ${rows.length - summaries.length} internal)`);
  } catch (e) {
    console.error('[LeadIntel] Error building history summaries:', e instanceof Error ? e.message : e);
  }

  // 2. From unified_inbox + campaign data (existing campaign contacts)
  try {
    const campaignRows = db.prepare(`
      SELECT
        ui.fromEmail as contactEmail,
        ui.fromName as contactName,
        COUNT(*) as totalReplies,
        MAX(ui.receivedAt) as lastReplyDate,
        GROUP_CONCAT(DISTINCT ui.subject, '|||') as subjects,
        GROUP_CONCAT(ui.snippet, '|||') as snippets
      FROM unified_inbox ui
      WHERE ui.organizationId = ? AND ui.status != 'sent'
      GROUP BY ui.fromEmail
      ORDER BY lastReplyDate DESC
      LIMIT 200
    `).all(orgId) as any[];

    for (const row of campaignRows) {
      // Skip if already in summaries (merge)
      const existing = summaries.find(s => s.contactEmail === row.contactEmail);
      if (existing) {
        // Merge campaign data
        existing.totalReceived += row.totalReplies;
        existing.totalEmails += row.totalReplies;
        if (row.lastReplyDate > existing.lastEmailDate) existing.lastEmailDate = row.lastReplyDate;
        const newSubjects = (row.subjects || '').split('|||').filter(Boolean);
        existing.subjects = [...new Set([...existing.subjects, ...newSubjects])].slice(0, 5);
        const newSnippets = (row.snippets || '').split('|||').filter(Boolean);
        existing.snippets = [...existing.snippets, ...newSnippets.map((s: string) => s.substring(0, 200))].slice(0, 5);
      } else {
        const subjects = (row.subjects || '').split('|||').filter(Boolean).slice(0, 5);
        const snippets = (row.snippets || '').split('|||').filter(Boolean).slice(0, 3);
        summaries.push({
          contactEmail: row.contactEmail,
          contactName: row.contactName || '',
          totalEmails: row.totalReplies,
          totalSent: 0,
          totalReceived: row.totalReplies,
          lastEmailDate: row.lastReplyDate,
          subjects,
          snippets: snippets.map((s: string) => s.substring(0, 200)),
        });
      }
    }
  } catch (e) {
    console.error('[LeadIntel] Error building campaign summaries:', e instanceof Error ? e.message : e);
  }

  // 3. Also check contacts with engagement data but no replies in unified_inbox
  try {
    const contactRows = db.prepare(`
      SELECT email, firstName, lastName, company,
        totalSent, totalOpened, totalClicked, totalReplied,
        lastOpenedAt, lastClickedAt, lastRepliedAt, leadStatus, status
      FROM contacts
      WHERE organizationId = ? AND totalSent > 0
      ORDER BY totalSent DESC
      LIMIT 500
    `).all(orgId) as any[];

    for (const c of contactRows) {
      if (!c.email) continue;
      const existing = summaries.find(s => s.contactEmail === c.email.toLowerCase());
      if (existing) {
        // Enrich with contact data
        if (!existing.contactName && (c.firstName || c.lastName)) {
          existing.contactName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
        }
        existing.totalSent = Math.max(existing.totalSent, c.totalSent || 0);
      } else {
        // Add as no-reply contact
        summaries.push({
          contactEmail: c.email.toLowerCase(),
          contactName: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
          totalEmails: (c.totalSent || 0) + (c.totalReplied || 0),
          totalSent: c.totalSent || 0,
          totalReceived: c.totalReplied || 0,
          lastEmailDate: c.lastRepliedAt || c.lastOpenedAt || c.lastClickedAt || '',
          subjects: [],
          snippets: [],
        });
      }
    }
  } catch (e) {
    console.error('[LeadIntel] Error building contact summaries:', e instanceof Error ? e.message : e);
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

  // Get Azure OpenAI settings
  const settings = await storage.getApiSettingsWithAzureFallback(orgId);
  const endpoint = settings.azure_openai_endpoint;
  const apiKey = settings.azure_openai_api_key;
  const deploymentName = settings.azure_openai_deployment;
  const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

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

    const prompt = `You are a sales intelligence analyst. Classify each contact into exactly ONE bucket based on their email history.

BUCKETS:
- past_customer: Evidence of completed business (invoices, orders, payments, "thank you for your business")
- hot_lead: Recently replied positively, asked about pricing/demo/meeting, strong buying intent
- warm_lead: Some engagement (opened, clicked, brief replies), mild interest
- interested_stalled: Showed interest initially but conversation stopped (replied 1-2 times then nothing)
- almost_closed: Pricing/proposal was discussed, "let me think about it", negotiation phase
- meeting_no_deal: Meeting or call happened (calendar refs, "nice meeting you") but no deal closed
- went_silent: Was actively conversing (3+ exchanges) then suddenly stopped responding
- not_interested: Explicitly declined, "not interested", "please remove me", negative sentiment
- no_response: Emails sent but zero replies or engagement
- referral_potential: Very positive relationship, happy customer who might refer others
- converted: Deal clearly closed, ongoing customer relationship

CONTACTS TO CLASSIFY:
${contactDescriptions}

For each contact, respond with a JSON array of objects:
[{"email": "...", "bucket": "...", "confidence": <0-100>, "reasoning": "<1 sentence>", "action": "<suggested next step>"}]

Respond ONLY with the JSON array, no other text.`;

    try {
      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a sales intelligence analyst. Classify leads accurately based on email conversation history. Respond only with valid JSON arrays.' },
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
  const positiveSignals = ['interested', 'pricing', 'demo', 'meeting', 'schedule', 'call', 'proposal', 'budget', 'timeline', 'purchase'];
  const negativeSignals = ['not interested', 'unsubscribe', 'remove me', 'stop', 'no thanks', 'not right now'];
  const customerSignals = ['invoice', 'payment', 'order', 'receipt', 'thank you for your business', 'renewal'];

  const hasPositive = positiveSignals.some(s => snippetText.includes(s));
  const hasNegative = negativeSignals.some(s => snippetText.includes(s));
  const hasCustomer = customerSignals.some(s => snippetText.includes(s));

  const daysSinceLastEmail = lastEmailDate ? Math.floor((Date.now() - new Date(lastEmailDate).getTime()) / (1000 * 60 * 60 * 24)) : 999;

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
}

export async function analyzeOrgLeads(orgId: string): Promise<AnalysisResult> {
  const result: AnalysisResult = { orgId, contactsAnalyzed: 0, opportunitiesCreated: 0, bucketCounts: {}, errors: [] };

  try {
    console.log(`[LeadIntel] Starting lead analysis for org ${orgId}...`);

    // 1. Build contact conversation summaries
    const summaries = await buildContactSummaries(orgId);
    result.contactsAnalyzed = summaries.length;
    console.log(`[LeadIntel] Built ${summaries.length} contact summaries`);

    if (summaries.length === 0) {
      result.errors.push('No contacts with email history found. Run email history scan first.');
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
        const db = (storage as any).db;
        const contact = db.prepare('SELECT company FROM contacts WHERE organizationId = ? AND LOWER(email) = ? LIMIT 1').get(orgId, cls.contactEmail.toLowerCase()) as any;
        if (contact?.company) company = contact.company;
      } catch (e) { /* ignore */ }

      await storage.addLeadOpportunity({
        organizationId: orgId,
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

// ── Full Pipeline: Scan + Analyze ──────────────────────────────────────

export async function runFullLeadIntelligence(orgId: string, monthsBack: number = 6, emailAccountIds?: string[]): Promise<{ scan: ScanResult; analysis: AnalysisResult }> {
  console.log(`[LeadIntel] Starting full pipeline for org ${orgId} (${monthsBack} months back)...`);

  // Step 1: Scan email history
  const scan = await scanOrgEmailHistory(orgId, monthsBack, emailAccountIds);

  // Step 2: Analyze and classify
  const analysis = await analyzeOrgLeads(orgId);

  return { scan, analysis };
}
