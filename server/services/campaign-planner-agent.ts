/**
 * Campaign Planner Agent
 *
 * Uses Claude API (direct HTTP) to turn a natural-language campaign brief into a
 * structured plan object. The plan is returned to the frontend for user review;
 * nothing is written to the DB until the user clicks "Launch Campaign".
 *
 * Flow:
 *   1. User describes campaign in plain English
 *   2. Agent calls internal tools (search_contacts, check_quota, get_org_context)
 *   3. Claude produces a CampaignPlan — target contacts, sender, subject+body, follow-ups, risks
 *   4. Frontend populates campaign-creator fields from the plan
 */

import { storage } from '../storage.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CampaignPlan {
  campaignName: string;
  target: {
    description: string;
    contactIds: string[];
    contactCount: number;
    sampleContacts: Array<{ name: string; email: string; company?: string; jobTitle?: string }>;
    suppressedCount: number;
  };
  sender: {
    emailAccountId: string;
    email: string;
    name: string;
    dailyLimit: number;
    dailySent: number;
    dailyRemaining: number;
  };
  content: {
    subject: string;
    body: string;
    followups: Array<{
      subject: string;
      body: string;
      delayValue: number;
      delayUnit: 'hours' | 'days';
      condition: 'if_no_reply' | 'if_no_open' | 'no_matter_what';
    }>;
  };
  risks: string[];
  estimatedDays: number;
  reasoning: string;
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

// ─── Tool Implementations ──────────────────────────────────────────────────────

async function toolSearchContacts(
  organizationId: string,
  args: { jobTitle?: string; company?: string; status?: string; leadBucket?: string; limit?: number }
): Promise<string> {
  const limit = Math.min(args.limit || 200, 500);
  const conditions: string[] = ['"organizationId" = ?'];
  const params: any[] = [organizationId];

  // Exclude bounced / unsubscribed
  conditions.push("status NOT IN ('bounced','unsubscribed')");

  if (args.status && args.status !== 'any') {
    conditions.push('status = ?');
    params.push(args.status);
  }
  if (args.jobTitle) {
    conditions.push('"jobTitle" ILIKE ?');
    params.push(`%${args.jobTitle}%`);
  }
  if (args.company) {
    conditions.push('company ILIKE ?');
    params.push(`%${args.company}%`);
  }

  let sql = `SELECT id, email, "firstName", "lastName", company, "jobTitle", status
             FROM contacts
             WHERE ${conditions.join(' AND ')}
             LIMIT ?`;
  params.push(limit);

  const contacts = await storage.rawAll(sql, ...params) as any[];

  // If leadBucket filter requested, cross-reference lead_opportunities
  let filtered = contacts;
  if (args.leadBucket && contacts.length > 0) {
    const emails = contacts.map((c: any) => c.email?.toLowerCase()).filter(Boolean);
    if (emails.length > 0) {
      try {
        const placeholders = emails.map(() => '?').join(',');
        const opps = await storage.rawAll(
          `SELECT LOWER("contactEmail") as ce FROM lead_opportunities
           WHERE "organizationId" = ? AND bucket = ? AND LOWER("contactEmail") IN (${placeholders})`,
          organizationId, args.leadBucket, ...emails
        ) as any[];
        const matchSet = new Set(opps.map((o: any) => o.ce));
        filtered = contacts.filter((c: any) => matchSet.has(c.email?.toLowerCase()));
      } catch {
        // lead_opportunities may not exist yet — skip filter
      }
    }
  }

  // Count suppressed
  let suppressedCount = 0;
  if (filtered.length > 0) {
    try {
      const emails = filtered.slice(0, 100).map((c: any) => c.email?.toLowerCase()).filter(Boolean);
      if (emails.length > 0) {
        const placeholders = emails.map(() => '?').join(',');
        const suppressed = await storage.rawAll(
          `SELECT email FROM suppression_list WHERE "organizationId" = ? AND LOWER(email) IN (${placeholders})`,
          organizationId, ...emails
        ) as any[];
        suppressedCount = suppressed.length;
      }
    } catch { /* suppression_list may not exist */ }
  }

  const sample = filtered.slice(0, 5).map((c: any) => ({
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
    email: c.email,
    company: c.company,
    jobTitle: c.jobTitle,
  }));

  return JSON.stringify({
    totalFound: filtered.length,
    suppressedCount,
    contactIds: filtered.map((c: any) => c.id),
    sample,
  });
}

async function toolCheckSenderQuota(
  organizationId: string,
  args: { emailAccountId?: string }
): Promise<string> {
  let accounts: any[];
  if (args.emailAccountId) {
    const acc = await storage.rawGet(
      `SELECT id, email, "senderName", "dailyLimit", "dailySent", "isActive"
       FROM email_accounts WHERE id = ? AND "organizationId" = ?`,
      args.emailAccountId, organizationId
    );
    accounts = acc ? [acc] : [];
  } else {
    accounts = await storage.rawAll(
      `SELECT id, email, "senderName", "dailyLimit", "dailySent", "isActive"
       FROM email_accounts WHERE "organizationId" = ? AND "isActive" = 1
       ORDER BY "dailySent" ASC LIMIT 10`,
      organizationId
    ) as any[];
  }

  const result = accounts.map((a: any) => ({
    id: a.id,
    email: a.email,
    name: a.senderName || a.email,
    dailyLimit: a.dailyLimit || 500,
    dailySent: a.dailySent || 0,
    dailyRemaining: Math.max(0, (a.dailyLimit || 500) - (a.dailySent || 0)),
  }));

  return JSON.stringify(result);
}

async function toolGetOrgContext(organizationId: string): Promise<string> {
  // Pull a lightweight org summary for content generation
  let orgName = '';
  let docSummaries: string[] = [];

  try {
    const orgRow = await storage.rawGet(
      `SELECT name FROM organizations WHERE id = ?`, organizationId
    ) as any;
    orgName = orgRow?.name || '';
  } catch { /* ok */ }

  try {
    const docs = await storage.rawAll(
      `SELECT title, summary FROM org_documents WHERE "organizationId" = ? AND summary IS NOT NULL LIMIT 5`,
      organizationId
    ) as any[];
    docSummaries = docs.map((d: any) => `${d.title}: ${d.summary}`);
  } catch { /* org_documents may not exist */ }

  return JSON.stringify({ orgName, docSummaries });
}

// ─── Tool Definitions (Claude tool_use format) ───────────────────────────────

const TOOLS = [
  {
    name: 'search_contacts',
    description: 'Search the organization\'s contact database with optional filters. Returns matching contact IDs, count, suppressed count, and a sample. Always call this first to find the target audience.',
    input_schema: {
      type: 'object',
      properties: {
        jobTitle: { type: 'string', description: 'Filter by job title substring (e.g. "CEO", "CTO", "Manager")' },
        company: { type: 'string', description: 'Filter by company name substring' },
        status: { type: 'string', enum: ['cold', 'warm', 'hot', 'any'], description: 'Contact pipeline status' },
        leadBucket: { type: 'string', enum: ['hot_lead', 'warm_lead', 'past_customer', 'engaged', 'cold', 'never_contacted'], description: 'AI lead classification bucket from lead_opportunities' },
        limit: { type: 'number', description: 'Max contacts to return (default 200, max 500)' },
      },
      required: [],
    },
  },
  {
    name: 'check_sender_quota',
    description: 'Check daily sending quota for email accounts. Returns remaining capacity. Call this to recommend the best sender account.',
    input_schema: {
      type: 'object',
      properties: {
        emailAccountId: { type: 'string', description: 'Specific account ID to check. Omit to list all active accounts.' },
      },
      required: [],
    },
  },
  {
    name: 'get_org_context',
    description: 'Get organization name and knowledge base summaries to inform email content generation.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ─── JSON Extraction Helper ───────────────────────────────────────────────────

function extractPlan(text: string): CampaignPlan | null {
  if (!text.includes('{')) return null;

  // Try markdown fence first (greedy inner match via lastIndexOf)
  const fenceIdx = text.indexOf('```');
  if (fenceIdx !== -1) {
    const afterFence = text.indexOf('{', fenceIdx);
    const closeFence = text.lastIndexOf('```');
    if (afterFence !== -1 && closeFence > afterFence) {
      const candidate = text.slice(afterFence, text.lastIndexOf('}', closeFence) + 1);
      const parsed = tryParse(candidate);
      if (parsed) return parsed;
    }
  }

  // Fallback: outermost { ... } by position
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed) return parsed;
  }

  return null;
}

function tryParse(jsonStr: string): CampaignPlan | null {
  try {
    const plan = JSON.parse(jsonStr) as CampaignPlan;
    if (!plan || typeof plan !== 'object') return null;
    if (!plan.content?.subject) return null;
    if (!plan.target) return null;
    if (!Array.isArray(plan.target.contactIds)) plan.target.contactIds = [];
    return plan;
  } catch {
    return null;
  }
}

// ─── Main Agent Function ───────────────────────────────────────────────────────

export async function runCampaignPlannerAgent(
  organizationId: string,
  userBrief: string
): Promise<CampaignPlan> {
  const apiKey = await getClaudeApiKey(organizationId);
  if (!apiKey) {
    throw new Error('Claude API key not configured. Add it in Advanced Settings → Claude API Key.');
  }

  const systemPrompt = `You are a campaign planning assistant for AImailPilot, a B2B email outreach platform.

Your job: turn a user's campaign brief into a complete campaign plan using the available tools.

MANDATORY sequence — do NOT skip any step:
1. Call get_org_context first to understand the organization name and knowledge base
2. Call search_contacts to find the target audience (use jobTitle filter based on the brief)
3. Call check_sender_quota to find the best available sender account
4. Output the final plan as a JSON object

CONTENT RULES:
- campaignName: concise and specific (e.g. "AGBA Nominations 2026 — AI Leaders")
- subject: under 60 chars, no spam words
- body: professional HTML with {{firstName}}, {{company}} variables, 3-4 short paragraphs
- followups: always include exactly 2 follow-up steps, delayValue 3-5, delayUnit "days", condition "if_no_reply"
- risks: 2-3 specific risk strings (mention actual numbers from tool results)
- estimatedDays: Math.ceil(contactCount / dailyRemaining) — compute this
- reasoning: 2 sentences on why you chose these contacts and this content angle

CRITICAL OUTPUT RULE:
After calling all three tools, output ONLY a raw JSON object — no markdown fences, no explanation text before or after, no \`\`\`json wrapper. Start your response with { and end with }.

JSON schema (fill every field):
{"campaignName":"...","target":{"description":"...","contactIds":[...],"contactCount":0,"sampleContacts":[{"name":"...","email":"...","company":"...","jobTitle":"..."}],"suppressedCount":0},"sender":{"emailAccountId":"...","email":"...","name":"...","dailyLimit":0,"dailySent":0,"dailyRemaining":0},"content":{"subject":"...","body":"<p>...</p>","followups":[{"subject":"...","body":"<p>...</p>","delayValue":3,"delayUnit":"days","condition":"if_no_reply"}]},"risks":["..."],"estimatedDays":1,"reasoning":"..."}`;

  const messages: any[] = [
    { role: 'user', content: userBrief }
  ];

  let toolCallsMade = 0;

  // Agentic tool-use loop (max 8 iterations)
  for (let iteration = 0; iteration < 8; iteration++) {
    const response = await callClaude(apiKey, messages, TOOLS, systemPrompt);
    console.log(`[CampaignPlannerAgent] iteration=${iteration} stop_reason=${response.stop_reason} content_types=${(response.content||[]).map((b:any)=>b.type).join(',')}`);

    const toolUses = (response.content || []).filter((b: any) => b.type === 'tool_use');
    const textBlocks = (response.content || []).filter((b: any) => b.type === 'text');

    // Claude finished calling tools — try to extract JSON from text
    if (toolUses.length === 0) {
      const text = textBlocks.map((b: any) => b.text).join('').trim();
      console.log(`[CampaignPlannerAgent] Final text (first 300 chars): ${text.slice(0, 300)}`);

      // If no JSON yet but tools were called, force one more turn asking for JSON only
      if (!text.includes('{') && toolCallsMade > 0) {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: 'You have gathered all necessary data. Now output ONLY the JSON plan object. Start your response with { and end with }. Do not include any other text.',
        });
        continue;
      }

      const plan = extractPlan(text);
      if (plan) return plan;

      console.error('[CampaignPlannerAgent] Could not extract JSON from:', text.slice(0, 600));
      throw new Error('Agent did not return a valid plan. Please try again with a more specific brief.');
    }

    // Add assistant turn with tool_use blocks
    messages.push({ role: 'assistant', content: response.content });

    // Execute each tool
    const toolResults: ToolResult[] = [];
    for (const toolUse of toolUses) {
      let result = '';
      console.log(`[CampaignPlannerAgent] Calling tool: ${toolUse.name}`, JSON.stringify(toolUse.input || {}).slice(0, 200));
      try {
        if (toolUse.name === 'search_contacts') {
          result = await toolSearchContacts(organizationId, toolUse.input || {});
        } else if (toolUse.name === 'check_sender_quota') {
          result = await toolCheckSenderQuota(organizationId, toolUse.input || {});
        } else if (toolUse.name === 'get_org_context') {
          result = await toolGetOrgContext(organizationId);
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${toolUse.name}` });
        }
      } catch (err) {
        result = JSON.stringify({ error: (err as Error).message });
        console.error(`[CampaignPlannerAgent] Tool ${toolUse.name} threw:`, (err as Error).message);
      }
      console.log(`[CampaignPlannerAgent] Tool ${toolUse.name} result (first 200): ${result.slice(0, 200)}`);
      toolResults.push({ tool_use_id: toolUse.id, content: result });
      toolCallsMade++;
    }

    // Add tool results as user turn
    messages.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
      })),
    });
  }

  throw new Error('Agent did not complete within the expected steps. Try a more specific brief.');
}
