/**
 * Campaign Intelligence Agent
 *
 * Uses Claude API (direct HTTP) to review campaigns across three modes:
 *   pre_launch  — predict performance, rate content, infer objective before sending
 *   live        — compare actual vs expected, detect degradation, suggest mid-flight tweaks
 *   post_mortem — deep analysis of a completed campaign to inform future campaigns
 *
 * Review results are cached in api_settings as campaign_review_{campaignId}.
 */

import { storage } from '../storage.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReviewMode = 'pre_launch' | 'live' | 'post_mortem';

export interface StepReview {
  stepNumber: number;
  subject: string;
  scores: {
    subjectLine: number;    // 1-10 (always 10 for follow-up steps — no subject expected)
    bodyContent: number;
    cta: number;
    personalization: number;
    timing: number;
  };
  stepScore: number;        // average of above
  suggestedSubject?: string; // only for stepNumber === 0
  issues: string[];
  suggestions: string[];
  actualStats?: {
    sent: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
    bounceRate: number;
  };
  performance?: 'above_average' | 'average' | 'below_average';
}

export interface CampaignReview {
  mode: ReviewMode;
  generatedAt: string;
  overallScore: number;     // 1-10
  overallGrade: string;     // A / B / C / D / F
  objective: {
    text: string;
    defined: boolean;
    likelihood: 'High' | 'Medium' | 'Low';
  };
  steps: StepReview[];
  predictions?: {
    openRate: string;
    clickRate: string;
    replyRate: string;
    confidence: 'High' | 'Medium' | 'Low';
    notes: string;
  };
  degradation?: {
    detected: boolean;
    details: string;
    recommendation: string;
  };
  recommendations: string[];
  postMortem?: {
    whatWorked: string[];
    whatDidntWork: string[];
    improvementsForNext: string[];
    audienceFitAssessment: string;
    bestStepNumber: number;
  };
}

interface ToolResult {
  tool_use_id: string;
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getClaudeApiKey(organizationId: string): Promise<string | null> {
  const settings = await storage.getApiSettings(organizationId);
  const superSettings = await storage.getApiSettings('superadmin');
  return (settings?.claude_api_key || superSettings?.claude_api_key || process.env.CLAUDE_API_KEY) as string | null;
}

async function callClaude(apiKey: string, messages: any[], tools: any[], system?: string): Promise<any> {
  const body: any = {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    tools,
    messages,
  };
  if (system) body.system = system;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }
  return response.json();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max = 800): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

// ─── Tool Implementations ──────────────────────────────────────────────────────

async function toolGetCampaignOverview(organizationId: string, campaignId: string): Promise<string> {
  const campaign = await storage.rawGet(
    `SELECT c.id, c.name, c.description, c.status, c."totalRecipients", c."sentCount",
            c."openedCount", c."clickedCount", c."repliedCount", c."bouncedCount",
            c.subject, c."createdAt", c."updatedAt",
            ea.email as "senderEmail", ea."senderName", ea."dailyLimit"
     FROM campaigns c
     LEFT JOIN email_accounts ea ON ea.id = c."emailAccountId"
     WHERE c.id = $1 AND c."organizationId" = $2`,
    campaignId, organizationId
  ) as any;

  if (!campaign) return JSON.stringify({ error: 'Campaign not found' });

  // Count follow-up steps
  const stepsRow = await storage.rawGet(
    `SELECT COUNT(*) as cnt
     FROM campaign_followups cf
     JOIN followup_steps fs ON fs."sequenceId" = cf."sequenceId"
     WHERE cf."campaignId" = $1 AND cf."isActive" = 1`,
    campaignId
  ) as any;

  return JSON.stringify({
    id: campaign.id,
    name: campaign.name,
    description: campaign.description || '',
    status: campaign.status,
    totalRecipients: campaign.totalRecipients || 0,
    sentCount: campaign.sentCount || 0,
    openedCount: campaign.openedCount || 0,
    clickedCount: campaign.clickedCount || 0,
    repliedCount: campaign.repliedCount || 0,
    bouncedCount: campaign.bouncedCount || 0,
    subject: campaign.subject || '',
    senderEmail: campaign.senderEmail || '',
    senderName: campaign.senderName || '',
    dailyLimit: campaign.dailyLimit || 500,
    followupStepCount: parseInt(stepsRow?.cnt || '0'),
    createdAt: campaign.createdAt,
  });
}

async function toolGetCampaignSteps(organizationId: string, campaignId: string): Promise<string> {
  // Step 0 (main email)
  const campaign = await storage.rawGet(
    `SELECT subject, content FROM campaigns WHERE id = $1 AND "organizationId" = $2`,
    campaignId, organizationId
  ) as any;

  const steps: any[] = [];

  if (campaign) {
    steps.push({
      stepNumber: 0,
      subject: campaign.subject || '',
      bodyText: truncate(stripHtml(campaign.content || '')),
      delayDays: 0,
      trigger: 'initial',
    });
  }

  // Follow-up steps
  const followupSteps = await storage.rawAll(
    `SELECT fs."stepNumber", fs.subject, fs.content, fs."delayDays", fs."delayHours", fs.trigger
     FROM campaign_followups cf
     JOIN followup_steps fs ON fs."sequenceId" = cf."sequenceId"
     WHERE cf."campaignId" = $1 AND cf."isActive" = 1
     ORDER BY fs."stepNumber" ASC`,
    campaignId
  ) as any[];

  for (const step of followupSteps) {
    steps.push({
      stepNumber: step.stepNumber,
      subject: step.subject || '',
      bodyText: truncate(stripHtml(step.content || '')),
      delayDays: step.delayDays || 0,
      delayHours: step.delayHours || 0,
      trigger: step.trigger || 'no_reply',
    });
  }

  return JSON.stringify(steps);
}

async function toolGetPerformanceStats(organizationId: string, campaignId: string): Promise<string> {
  // Per-step stats
  const stepStats = await storage.rawAll(
    `SELECT
       COALESCE("stepNumber", 0) as "stepNumber",
       COUNT(*) as total,
       SUM(CASE WHEN status IN ('sent','sending') THEN 1 ELSE 0 END) as sent,
       SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced,
       SUM(CASE WHEN "openedAt" IS NOT NULL THEN 1 ELSE 0 END) as opened,
       SUM(CASE WHEN "clickedAt" IS NOT NULL THEN 1 ELSE 0 END) as clicked,
       SUM(CASE WHEN "repliedAt" IS NOT NULL THEN 1 ELSE 0 END) as replied
     FROM messages
     WHERE "campaignId" = $1
     GROUP BY COALESCE("stepNumber", 0)
     ORDER BY "stepNumber" ASC`,
    campaignId
  ) as any[];

  const enriched = stepStats.map((r: any) => {
    const sent = parseInt(r.sent) || 0;
    const opened = parseInt(r.opened) || 0;
    const clicked = parseInt(r.clicked) || 0;
    const replied = parseInt(r.replied) || 0;
    const bounced = parseInt(r.bounced) || 0;
    return {
      stepNumber: parseInt(r.stepNumber),
      sent,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
      clickRate: sent > 0 ? Math.round((clicked / sent) * 100) : 0,
      replyRate: sent > 0 ? Math.round((replied / sent) * 100) : 0,
      bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
    };
  });

  return JSON.stringify(enriched);
}

async function toolGetOrgBenchmarks(organizationId: string): Promise<string> {
  const completed = await storage.rawAll(
    `SELECT name, "sentCount", "openedCount", "clickedCount", "repliedCount", "bouncedCount"
     FROM campaigns
     WHERE "organizationId" = $1 AND status = 'completed' AND "sentCount" > 10
     ORDER BY "updatedAt" DESC LIMIT 15`,
    organizationId
  ) as any[];

  if (completed.length === 0) {
    return JSON.stringify({
      campaignCount: 0,
      avgOpenRate: null,
      avgClickRate: null,
      avgReplyRate: null,
      avgBounceRate: null,
      note: 'No completed campaigns yet — using cold-email industry benchmarks (open: 20-25%, click: 2-4%, reply: 2-5%)',
    });
  }

  let totalSent = 0, totalOpened = 0, totalClicked = 0, totalReplied = 0, totalBounced = 0;
  for (const c of completed) {
    const sent = c.sentCount || 0;
    totalSent += sent;
    totalOpened += c.openedCount || 0;
    totalClicked += c.clickedCount || 0;
    totalReplied += c.repliedCount || 0;
    totalBounced += c.bouncedCount || 0;
  }

  return JSON.stringify({
    campaignCount: completed.length,
    avgOpenRate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0,
    avgClickRate: totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0,
    avgReplyRate: totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0,
    avgBounceRate: totalSent > 0 ? Math.round((totalBounced / totalSent) * 100) : 0,
    sampleCampaigns: completed.slice(0, 3).map((c: any) => ({ name: c.name, sent: c.sentCount })),
  });
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_campaign_overview',
    description: 'Get high-level campaign info: name, status, audience size, sent/open/click/reply counts, sender, and follow-up step count. Call this first.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_campaign_steps',
    description: 'Get all email steps: Step 0 (initial email) and follow-up steps with subjects, body text, timing, and trigger conditions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_performance_stats',
    description: 'Get actual per-step performance stats (open rate, click rate, reply rate, bounce rate). Returns empty if no emails sent yet.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_org_benchmarks',
    description: 'Get this organization\'s historical average open/click/reply rates from past completed campaigns for comparison.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

// ─── JSON Extraction ──────────────────────────────────────────────────────────

function extractReview(text: string): CampaignReview | null {
  if (!text.includes('{')) return null;

  const fenceIdx = text.indexOf('```');
  if (fenceIdx !== -1) {
    const afterFence = text.indexOf('{', fenceIdx);
    const closeFence = text.lastIndexOf('```');
    if (afterFence !== -1 && closeFence > afterFence) {
      const candidate = text.slice(afterFence, text.lastIndexOf('}', closeFence) + 1);
      const parsed = tryParseReview(candidate);
      if (parsed) return parsed;
    }
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const parsed = tryParseReview(text.slice(start, end + 1));
    if (parsed) return parsed;
  }

  return null;
}

function tryParseReview(jsonStr: string): CampaignReview | null {
  try {
    const r = JSON.parse(jsonStr) as CampaignReview;
    if (!r || typeof r !== 'object') return null;
    if (typeof r.overallScore !== 'number') return null;
    if (!Array.isArray(r.steps)) r.steps = [];
    if (!Array.isArray(r.recommendations)) r.recommendations = [];
    r.generatedAt = new Date().toISOString();
    return r;
  } catch {
    return null;
  }
}

// ─── System Prompts ───────────────────────────────────────────────────────────

function buildSystemPrompt(mode: ReviewMode): string {
  const base = `You are a B2B email campaign intelligence analyst for AImailPilot.
Your job is to review campaigns and provide actionable, specific feedback.

MANDATORY tool call sequence:
1. get_campaign_overview — understand the campaign basics
2. get_campaign_steps — read all email content
3. get_performance_stats — check actual metrics (may be empty for pre_launch)
4. get_org_benchmarks — compare against org history

EMAIL THREADING — CRITICAL:
- Step 0 (initial email) is the ONLY step with a subject line.
- Steps 1, 2, 3... are follow-up replies. They intentionally have NO subject — they automatically thread as "Re: {step0 subject}" in Gmail and Outlook.
- NEVER recommend adding a subject line to follow-up steps (stepNumber >= 1). That would break threading and create separate email chains.
- For follow-up steps, set subjectLine score to 10 (no subject = correct behavior) and do NOT include subject in issues or suggestions.
- Only evaluate and suggest a new subject for Step 0.

SCORING RULES:
- Score each step's subjectLine, bodyContent, cta, personalization, timing on 1-10
- subjectLine: only scored for stepNumber=0. clarity, curiosity, length (<60 chars ideal), no spam words. Follow-up steps always score 10 here.
- bodyContent: relevance, brevity, professional tone, value proposition clarity
- cta: single clear ask, specific action, not vague ("let me know" scores 3)
- personalization: use of {{firstName}}/{{company}}, contextual relevance
- timing: appropriate delay between steps (2-5 days ideal for most B2B)
- overallScore = weighted average of all step scores + campaign-level factors
- overallGrade: 9-10=A, 7-8=B, 5-6=C, 3-4=D, 1-2=F
- suggestedSubject: for stepNumber=0 ONLY — if the subject scores < 8, provide a concise improved alternative (under 55 chars). Otherwise omit.

OBJECTIVE INFERENCE RULES:
- Look at campaign name, subject lines, body CTA, and audience description
- Infer the most likely business goal (meetings, nominations, registrations, deals, awareness, etc.)
- "defined" = true only if user explicitly stated objective in campaign name or description

CRITICAL OUTPUT RULE:
After all 4 tool calls, output ONLY a raw JSON object. No markdown, no explanation. Start with { end with }.`;

  if (mode === 'pre_launch') {
    return base + `

MODE: pre_launch — Campaign not yet sent (draft or scheduled).
Focus: content quality, predictions, risks before sending.

PREDICTIONS must be specific ranges based on:
- Content quality scores
- Org benchmarks (or industry defaults if no history)
- Audience size and targeting

JSON schema (fill every field):
{
  "mode": "pre_launch",
  "generatedAt": "",
  "overallScore": 7,
  "overallGrade": "B",
  "objective": { "text": "...", "defined": false, "likelihood": "High" },
  "steps": [
    {
      "stepNumber": 0,
      "subject": "...",
      "scores": { "subjectLine": 7, "bodyContent": 6, "cta": 5, "personalization": 8, "timing": 9 },
      "stepScore": 7,
      "suggestedSubject": "Shorter alternative subject under 55 chars",
      "issues": ["..."],
      "suggestions": ["..."]
    }
  ],
  "predictions": {
    "openRate": "18-24%",
    "clickRate": "1-3%",
    "replyRate": "2-4%",
    "confidence": "Medium",
    "notes": "..."
  },
  "recommendations": ["...", "..."],
  "degradation": null,
  "postMortem": null
}`;
  }

  if (mode === 'live') {
    return base + `

MODE: live — Campaign is currently active or paused.
Focus: compare actual vs expected, flag degradation, mid-flight recommendations.

DEGRADATION detection rules:
- Open rate < 50% of org benchmark → degradation detected
- Reply rate = 0 after 30+ sends → degradation detected
- Bounce rate > 8% → degradation detected
- If degradation detected, provide specific recommendation (pause? rewrite subject? check sender reputation?)

Include actualStats in each step that has performance data. Compare to benchmarks.
performance field: "above_average" if actual > 110% of benchmark, "below_average" if < 70%, else "average"

JSON schema:
{
  "mode": "live",
  "generatedAt": "",
  "overallScore": 7,
  "overallGrade": "B",
  "objective": { "text": "...", "defined": false, "likelihood": "High" },
  "steps": [
    {
      "stepNumber": 0,
      "subject": "...",
      "scores": { "subjectLine": 7, "bodyContent": 6, "cta": 5, "personalization": 8, "timing": 9 },
      "stepScore": 7,
      "issues": ["..."],
      "suggestions": ["..."],
      "actualStats": { "sent": 100, "openRate": 22, "clickRate": 2, "replyRate": 3, "bounceRate": 1 },
      "performance": "average"
    }
  ],
  "degradation": {
    "detected": false,
    "details": "...",
    "recommendation": "..."
  },
  "recommendations": ["...", "..."],
  "predictions": null,
  "postMortem": null
}`;
  }

  // post_mortem
  return base + `

MODE: post_mortem — Campaign is completed.
Focus: full analysis of what worked and what didn't, design-better-next recommendations.

bestStepNumber = the step with the highest reply rate (or open rate if no replies).
audienceFitAssessment: assess if the email content matched the likely audience based on subject/body tone.

JSON schema:
{
  "mode": "post_mortem",
  "generatedAt": "",
  "overallScore": 7,
  "overallGrade": "B",
  "objective": { "text": "...", "defined": false, "likelihood": "High" },
  "steps": [
    {
      "stepNumber": 0,
      "subject": "...",
      "scores": { "subjectLine": 7, "bodyContent": 6, "cta": 5, "personalization": 8, "timing": 9 },
      "stepScore": 7,
      "issues": ["..."],
      "suggestions": ["..."],
      "actualStats": { "sent": 100, "openRate": 22, "clickRate": 2, "replyRate": 3, "bounceRate": 1 },
      "performance": "average"
    }
  ],
  "postMortem": {
    "whatWorked": ["...", "..."],
    "whatDidntWork": ["...", "..."],
    "improvementsForNext": ["...", "..."],
    "audienceFitAssessment": "...",
    "bestStepNumber": 0
  },
  "recommendations": ["...", "..."],
  "degradation": null,
  "predictions": null
}`;
}

// ─── Main Agent Function ───────────────────────────────────────────────────────

export async function runCampaignReviewAgent(
  organizationId: string,
  campaignId: string,
  mode: ReviewMode
): Promise<CampaignReview> {
  const apiKey = await getClaudeApiKey(organizationId);
  if (!apiKey) {
    throw new Error('Claude API key not configured. Add it in Advanced Settings → Claude API Key.');
  }

  const systemPrompt = buildSystemPrompt(mode);

  const messages: any[] = [
    {
      role: 'user',
      content: `Review campaign ID: ${campaignId}. Mode: ${mode}. Call all 4 tools in sequence then output the JSON review.`,
    },
  ];

  let toolCallsMade = 0;

  for (let iteration = 0; iteration < 10; iteration++) {
    const response = await callClaude(apiKey, messages, TOOLS, systemPrompt);
    console.log(`[CampaignReviewAgent] iter=${iteration} stop=${response.stop_reason} mode=${mode}`);

    const toolUses = (response.content || []).filter((b: any) => b.type === 'tool_use');
    const textBlocks = (response.content || []).filter((b: any) => b.type === 'text');

    if (toolUses.length === 0) {
      const text = textBlocks.map((b: any) => b.text).join('').trim();
      console.log(`[CampaignReviewAgent] Final text (first 300): ${text.slice(0, 300)}`);

      if (!text.includes('{') && toolCallsMade > 0) {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: 'Output ONLY the JSON review object now. Start with { and end with }. No other text.',
        });
        continue;
      }

      const review = extractReview(text);
      if (review) {
        review.mode = mode;
        review.generatedAt = new Date().toISOString();
        return review;
      }

      console.error('[CampaignReviewAgent] Could not extract review JSON:', text.slice(0, 400));
      throw new Error('Agent did not return a valid review. Please try again.');
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: ToolResult[] = [];
    for (const toolUse of toolUses) {
      let result = '';
      console.log(`[CampaignReviewAgent] Tool: ${toolUse.name}`);
      try {
        if (toolUse.name === 'get_campaign_overview') {
          result = await toolGetCampaignOverview(organizationId, campaignId);
        } else if (toolUse.name === 'get_campaign_steps') {
          result = await toolGetCampaignSteps(organizationId, campaignId);
        } else if (toolUse.name === 'get_performance_stats') {
          result = await toolGetPerformanceStats(organizationId, campaignId);
        } else if (toolUse.name === 'get_org_benchmarks') {
          result = await toolGetOrgBenchmarks(organizationId);
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${toolUse.name}` });
        }
      } catch (err) {
        result = JSON.stringify({ error: (err as Error).message });
        console.error(`[CampaignReviewAgent] Tool ${toolUse.name} error:`, (err as Error).message);
      }
      toolResults.push({ tool_use_id: toolUse.id, content: result });
      toolCallsMade++;
    }

    messages.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
      })),
    });
  }

  throw new Error('Campaign review agent did not complete. Try again.');
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

export async function getCachedReview(organizationId: string, campaignId: string): Promise<CampaignReview | null> {
  try {
    const settings = await storage.getApiSettings(organizationId);
    const raw = settings?.[`campaign_review_${campaignId}`];
    if (!raw) return null;
    return JSON.parse(raw) as CampaignReview;
  } catch {
    return null;
  }
}

export async function saveCachedReview(organizationId: string, campaignId: string, review: CampaignReview): Promise<void> {
  await storage.setApiSetting(organizationId, `campaign_review_${campaignId}`, JSON.stringify(review));
}
