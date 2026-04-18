// Refine Hot Leads — AI pass over unified_inbox rows with replyType='positive'
// that don't yet have a lead_opportunities classification.
// Writes to lead_opportunities using the same 11-bucket taxonomy.
// Runs opportunistically on a background schedule, rate-limited to avoid cost spikes.

import { storage } from '../storage';

const BUCKETS = [
  'past_customer', 'hot_lead', 'almost_closed', 'warm_lead',
  'interested_stalled', 'engaged', 'cold', 'never_contacted',
  'churned', 'unqualified', 'unknown',
];

const SYSTEM_PROMPT = `You are a B2B sales intelligence analyst. Classify a single reply into one of these buckets:
- hot_lead: buying signals (asked pricing/demo/meeting, "send proposal", "let's discuss")
- warm_lead: positive tone but no clear ask yet, asking general questions
- interested_stalled: interested previously, no recent action
- engaged: polite ack ("thanks", "got it", "noted") — no real intent
- past_customer: mentions previous purchase/relationship
- almost_closed: agreed to buy, finalizing details
- cold: curt decline, dismissive
- unqualified: spam/wrong person/not fit
- unknown: not enough info
Return JSON only: {"bucket":"...","confidence":0-100,"reasoning":"1 sentence","action":"1 specific next step"}.`;

interface RefineRow {
  inboxId: string;
  orgId: string;
  emailAccountId: string | null;
  contactEmail: string;
  contactName: string | null;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export async function refineHotLeadsOnce(opts: { maxContacts?: number } = {}): Promise<{ scanned: number; classified: number; skipped: number }> {
  const max = opts.maxContacts ?? 30;

  const candidates = await storage.rawAll(`
    SELECT DISTINCT ON (LOWER(ui."fromEmail"))
      ui.id AS "inboxId",
      ui."organizationId" AS "orgId",
      ui."emailAccountId",
      LOWER(ui."fromEmail") AS "contactEmail",
      ui."fromName" AS "contactName",
      COALESCE(ui.subject, '') AS subject,
      COALESCE(ui.snippet, LEFT(COALESCE(ui.body, ''), 400)) AS snippet,
      ui."receivedAt"
    FROM unified_inbox ui
    LEFT JOIN lead_opportunities lo
      ON LOWER(lo."contactEmail") = LOWER(ui."fromEmail")
      AND lo."organizationId" = ui."organizationId"
    WHERE ui."replyType" = 'positive'
      AND (ui."sentByUs" IS NULL OR ui."sentByUs" = 0)
      AND lo.id IS NULL
      AND LOWER(TRIM(ui."fromEmail")) NOT IN (SELECT LOWER(TRIM(email)) FROM email_accounts WHERE email IS NOT NULL)
    ORDER BY LOWER(ui."fromEmail"), ui."receivedAt" DESC
    LIMIT ?
  `, max) as RefineRow[];

  if (!candidates.length) return { scanned: 0, classified: 0, skipped: 0 };

  // Group by org so we can fetch AI settings once per org
  const byOrg: Record<string, RefineRow[]> = {};
  for (const r of candidates) (byOrg[r.orgId] ||= []).push(r);

  let classified = 0, skipped = 0;
  for (const [orgId, rows] of Object.entries(byOrg)) {
    const settings = await storage.getApiSettingsWithAzureFallback(orgId);
    const endpoint = (settings as any).azure_openai_endpoint;
    const apiKey = (settings as any).azure_openai_api_key;
    const deployment = (settings as any).azure_openai_deployment;
    const apiVersion = (settings as any).azure_openai_api_version || '2024-08-01-preview';

    for (const row of rows) {
      let result: { bucket: string; confidence: number; reasoning: string; action: string } | null = null;

      if (endpoint && apiKey && deployment) {
        try {
          const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
          const userMsg = `Contact: ${row.contactEmail}${row.contactName ? ` (${row.contactName})` : ''}
Subject: ${row.subject}
Reply snippet: ${row.snippet}

Classify this reply. Respond with JSON only.`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMsg },
              ],
              temperature: 0.1,
              max_tokens: 300,
            }),
          });
          if (resp.ok) {
            const data: any = await resp.json();
            const content = data.choices?.[0]?.message?.content || '';
            const m = content.match(/\{[\s\S]*\}/);
            if (m) {
              const parsed = JSON.parse(m[0]);
              const bucket = BUCKETS.includes(parsed.bucket) ? parsed.bucket : 'unknown';
              result = {
                bucket,
                confidence: Math.min(100, Math.max(0, parseInt(parsed.confidence) || 50)),
                reasoning: String(parsed.reasoning || '').slice(0, 500),
                action: String(parsed.action || '').slice(0, 300),
              };
            }
          }
        } catch { /* network/API error — fall through to rule-based */ }
      }

      // Rule-based fallback
      if (!result) {
        const text = `${row.subject} ${row.snippet}`.toLowerCase();
        if (/\b(pricing|quote|proposal|demo|book a (call|meeting)|schedule a (call|meeting)|send me (details|more|info)|how much|cost)\b/.test(text)) {
          result = { bucket: 'hot_lead', confidence: 70, reasoning: 'Buying-intent keyword detected in reply', action: 'Send proposal or book a meeting' };
        } else if (/\b(thanks|thank you|got it|noted|received|acknowledged)\b/.test(text) && text.length < 300) {
          result = { bucket: 'engaged', confidence: 60, reasoning: 'Short polite acknowledgment, no buying signals', action: 'Follow up with value-add message' };
        } else {
          result = { bucket: 'warm_lead', confidence: 50, reasoning: 'Positive reply, intent unclear', action: 'Ask a qualifying question' };
        }
      }

      try {
        await (storage as any).createLeadOpportunity({
          organizationId: row.orgId,
          emailAccountId: row.emailAccountId,
          accountEmail: null,
          contactEmail: row.contactEmail,
          contactName: row.contactName,
          company: null,
          bucket: result.bucket,
          confidence: result.confidence,
          aiReasoning: result.reasoning,
          suggestedAction: result.action,
          lastEmailDate: row.receivedAt,
          totalEmails: 1,
          totalSent: 0,
          totalReceived: 1,
          sampleSubjects: [row.subject],
          sampleSnippets: [row.snippet.slice(0, 300)],
        });
        classified++;
      } catch {
        skipped++;
      }

      // Throttle: 1.5s between AI calls to stay under typical 120 RPM quotas
      if (endpoint) await new Promise(r => setTimeout(r, 1500));
    }
  }

  return { scanned: candidates.length, classified, skipped };
}

let refinerRunning = false;
export function startHotLeadsRefiner() {
  const INTERVAL_MS = 15 * 60 * 1000; // every 15 min
  const BATCH = 30;
  const run = async () => {
    if (refinerRunning) return;
    refinerRunning = true;
    try {
      const result = await refineHotLeadsOnce({ maxContacts: BATCH });
      if (result.scanned > 0) {
        console.log(`[HotLeadsRefiner] scanned=${result.scanned} classified=${result.classified} skipped=${result.skipped}`);
      }
    } catch (e) {
      console.error('[HotLeadsRefiner] Error:', e);
    } finally {
      refinerRunning = false;
    }
  };
  // First run after 5 min, then every 15 min
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, INTERVAL_MS);
  console.log('[HotLeadsRefiner] Scheduled: first run in 5min, then every 15min');
}
