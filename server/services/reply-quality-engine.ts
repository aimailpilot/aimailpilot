// Reply Quality Engine
// Scores unified_inbox messages that have human replies (positive/negative/general)
// using Azure OpenAI. Score 0-10 stored as replyQualityScore; label stored as replyQualityLabel.
// Results surface in the "Need Reply" inbox tab and scorecard priority ranking.

import { storage } from '../storage';

export interface ReplyQualityResult {
  score: number;      // 0–10
  label: string;      // Hot | Warm | Neutral | Declined | Negative
}

// Label thresholds
export function qualityLabelFromScore(score: number): string {
  if (score >= 8) return 'Hot';
  if (score >= 6) return 'Warm';
  if (score >= 4) return 'Neutral';
  if (score >= 2) return 'Declined';
  return 'Negative';
}

async function getAzureSettings(organizationId: string) {
  const settings = await storage.getApiSettingsWithAzureFallback(organizationId);
  return {
    endpoint: settings.azure_openai_endpoint as string | undefined,
    apiKey: settings.azure_openai_api_key as string | undefined,
    deployment: settings.azure_openai_deployment as string | undefined,
    apiVersion: (settings.azure_openai_api_version as string | undefined) || '2024-08-01-preview',
  };
}

async function scoreWithAzure(
  subject: string,
  snippet: string,
  body: string,
  azure: Awaited<ReturnType<typeof getAzureSettings>>
): Promise<ReplyQualityResult> {
  const { endpoint, apiKey, deployment, apiVersion } = azure;
  if (!endpoint || !apiKey || !deployment) {
    // Rule-based fallback when Azure not configured
    return ruleBased(snippet || body);
  }

  const text = (snippet || body || '').slice(0, 800);
  if (!text.trim()) return { score: 5, label: 'Neutral' };

  const prompt = `You are an email sales analyst. Rate the quality of this prospect reply for a sales rep who needs to prioritize follow-ups.

Subject: ${subject || 'N/A'}
Reply: ${text}

Score 0-10:
- 9-10: Strong positive intent (wants meeting, ready to buy, asks pricing/next steps)
- 7-8: Positive interest (wants more info, open to discussion)
- 5-6: Neutral / informational question
- 3-4: Polite decline or lukewarm
- 1-2: Firm no or unsubscribe
- 0: Spam / auto-reply

Respond ONLY with JSON: {"score": <integer 0-10>, "label": "<Hot|Warm|Neutral|Declined|Negative>"}`;

  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an email engagement analyst. Respond only with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 60,
      }),
      signal: ac.signal,
    });
    if (!resp.ok) {
      console.error(`[ReplyQuality] Azure error ${resp.status}`);
      return ruleBased(text);
    }
    const data = await resp.json() as any;
    const content: string = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const score = Math.min(10, Math.max(0, parseInt(parsed.score) || 5));
      const label = parsed.label || qualityLabelFromScore(score);
      return { score, label };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ReplyQuality] Scoring error: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
  return ruleBased(snippet || body);
}

function ruleBased(text: string): ReplyQualityResult {
  const t = (text || '').toLowerCase();
  if (/interested|meeting|call|demo|pricing|next step|sounds good|let.s connect|great|love to/i.test(t))
    return { score: 8, label: 'Hot' };
  if (/tell me more|more info|question|could you|would like|please share/i.test(t))
    return { score: 6, label: 'Warm' };
  if (/not interested|unsubscribe|remove me|stop|don.t contact/i.test(t))
    return { score: 1, label: 'Negative' };
  if (/no thank|not right now|maybe later|not at this time/i.test(t))
    return { score: 3, label: 'Declined' };
  return { score: 5, label: 'Neutral' };
}

// Score a single inbox message and persist the result
export async function scoreInboxMessage(
  messageId: string,
  organizationId: string
): Promise<ReplyQualityResult | null> {
  try {
    const msg = await storage.getInboxMessage(messageId) as any;
    if (!msg) return null;
    if (!['positive', 'negative', 'general'].includes(msg.replyType || '')) return null;

    const azure = await getAzureSettings(organizationId);
    const result = await scoreWithAzure(msg.subject || '', msg.snippet || '', msg.body || '', azure);

    await storage.rawRun(
      `UPDATE unified_inbox SET "replyQualityScore"=$1, "replyQualityLabel"=$2 WHERE id=$3`,
      [result.score, result.label, messageId]
    );
    return result;
  } catch (e) {
    console.error(`[ReplyQuality] scoreInboxMessage error for ${messageId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// Batch score all unscored human-reply messages for an org (fire-and-forget safe)
export async function batchScoreOrgReplies(
  organizationId: string,
  limit = 100
): Promise<{ scored: number; errors: number }> {
  const rows = await storage.rawAll(
    `SELECT id FROM unified_inbox
     WHERE "organizationId" = $1
       AND "replyType" IN ('positive','negative','general')
       AND "replyQualityScore" IS NULL
     ORDER BY "receivedAt" DESC
     LIMIT $2`,
    [organizationId, limit]
  ) as any[];

  let scored = 0;
  let errors = 0;
  const azure = await getAzureSettings(organizationId);

  for (const row of rows) {
    try {
      const msg = await storage.getInboxMessage(row.id) as any;
      if (!msg) { errors++; continue; }
      const result = await scoreWithAzure(msg.subject || '', msg.snippet || '', msg.body || '', azure);
      await storage.rawRun(
        `UPDATE unified_inbox SET "replyQualityScore"=$1, "replyQualityLabel"=$2 WHERE id=$3`,
        [result.score, result.label, row.id]
      );
      scored++;
    } catch (e) {
      errors++;
      console.error(`[ReplyQuality] batch error for ${row.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[ReplyQuality] Batch complete for org ${organizationId}: scored=${scored} errors=${errors}`);
  return { scored, errors };
}
