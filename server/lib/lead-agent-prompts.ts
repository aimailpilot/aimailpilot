/**
 * AI Lead Agent — prompt builders + structured output schema.
 *
 * Pure functions, no I/O, no SDK calls. Easy to unit-test (covered by
 * tests/unit/lead-agent-prompts.test.ts).
 *
 * Each search mode produces a system prompt + user message + JSON schema. The
 * service layer (server/services/lead-agent.ts) feeds these into runLlm() and
 * receives the structured output via response.parsed.
 *
 * The funded / cxo_changes / academics modes are designed to use Claude's
 * built-in web search (webSearch=true, forceProvider='anthropic'). The custom
 * mode accepts arbitrary instructions and may run on either provider.
 */

export type LeadAgentMode = 'funded' | 'cxo_changes' | 'academics' | 'custom';

export interface LeadAgentSearchParams {
  /** Region/country filter, free text. Default: 'India'. */
  region?: string;
  /** How many days back to look. Default: 30. */
  daysBack?: number;
  /** Industry filter, free text. */
  industry?: string;
  /** Roles/titles of interest (mainly for cxo_changes). */
  titles?: string[];
  /** Max number of leads to return. Default: 25. */
  maxResults?: number;
  /** For custom mode — user-supplied instructions. Required if mode='custom'. */
  customPrompt?: string;
  /** For custom mode — disable web search if the user just wants pure reasoning. */
  customWebSearch?: boolean;
}

export interface ResolvedSearchParams {
  region: string;
  daysBack: number;
  industry: string;
  titles: string[];
  maxResults: number;
  customPrompt: string;
  customWebSearch: boolean;
}

export function resolveSearchParams(params: LeadAgentSearchParams = {}): ResolvedSearchParams {
  return {
    region: (params.region || 'India').trim(),
    daysBack: clampInt(params.daysBack, 7, 365, 30),
    industry: (params.industry || '').trim(),
    titles: (params.titles || []).map(t => String(t).trim()).filter(Boolean).slice(0, 20),
    maxResults: clampInt(params.maxResults, 1, 100, 25),
    customPrompt: (params.customPrompt || '').trim(),
    customWebSearch: params.customWebSearch !== false, // default true
  };
}

function clampInt(v: any, min: number, max: number, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.round(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/**
 * Result schema returned by every mode. The LLM is constrained to this shape
 * via Anthropic's output_config.format and Azure's response_format.json_schema.
 *
 * Field naming mirrors the `contacts` table schema in shared/schema.ts so the
 * /save route can map straight through with no translation layer.
 *
 * We validate at the resolver level (lead-agent-merge.ts) rather than relying
 * solely on the schema enforcement — providers can occasionally return
 * malformed JSON and we want a single normalization point.
 */
export const LEAD_RESULT_SCHEMA = {
  type: 'object',
  required: ['leads'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    leads: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'company'],
        additionalProperties: false,
        properties: {
          /** Full name — split into firstName/lastName at save time. */
          name:        { type: 'string' },
          firstName:   { type: 'string' },
          lastName:    { type: 'string' },
          /** Job title — maps to contacts.jobTitle. */
          title:       { type: 'string' },
          /** Company / institution name — maps to contacts.company. */
          company:     { type: 'string' },
          /** Company website — maps to contacts.website. */
          companyUrl:  { type: 'string' },
          linkedinUrl: { type: 'string' },
          email:       { type: 'string' },
          phone:       { type: 'string' },
          mobilePhone: { type: 'string' },
          /** Free-form location — maps to contacts.city/state/country at save time. */
          location:    { type: 'string' },
          city:        { type: 'string' },
          state:       { type: 'string' },
          country:     { type: 'string' },
          industry:    { type: 'string' },
          department:  { type: 'string' },
          seniority:   { type: 'string' },
          /** What triggered surfacing this lead (e.g. "raised $5M Series A on 2026-04-12"). */
          signal:      { type: 'string' },
          /** Source URL the agent cited (web-search-backed). */
          sourceUrl:   { type: 'string' },
          /** Recommended first-touch angle. */
          outreachHook: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * Per-mode prompt builders. Each returns the pieces the service layer needs
 * to assemble an LlmRequest.
 */
export function buildPromptForMode(
  mode: LeadAgentMode,
  params: ResolvedSearchParams,
): { systemPrompt: string; userMessage: string; needsWebSearch: boolean } {
  switch (mode) {
    case 'funded':       return buildFundedPrompt(params);
    case 'cxo_changes':  return buildCxoChangesPrompt(params);
    case 'academics':    return buildAcademicsPrompt(params);
    case 'custom':       return buildCustomPrompt(params);
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown lead-agent mode: ${_exhaustive}`);
    }
  }
}

const COMMON_RULES = `
Return STRICTLY structured JSON matching the provided schema. Do not include any prose outside the JSON. Do not invent leads — only include people you can verify with a citation. If you cannot find any leads matching the criteria, return an empty leads array and say so in summary. Each lead MUST include a sourceUrl (URL of the article, press release, university page, LinkedIn post, etc. that supports the signal). Prefer leads with explicit business email or LinkedIn profile when possible — never fabricate emails.`.trim();

function buildFundedPrompt(p: ResolvedSearchParams) {
  const industryClause = p.industry ? ` in the ${p.industry} sector` : '';
  return {
    systemPrompt: `You are a B2B sales intelligence agent. You find founders and senior executives at companies that recently raised funding so a salesperson can reach out with relevant timing-based outreach. Each result is a PERSON (not a company), with their name, title, and the funding signal that triggered surfacing them. ${COMMON_RULES}`,
    userMessage:
      `Find up to ${p.maxResults} founders and key executives (Founder, Co-Founder, CEO, CFO, COO, CTO, VP Engineering, Head of Sales/Marketing/Growth) at companies${industryClause} based in ${p.region} that announced a funding round in the last ${p.daysBack} days. ` +
      `Return ONE LEAD PER PERSON — if a company has 3 founders, return 3 separate leads. ` +
      `For each lead include: their full name, title, company name, company website (companyUrl), LinkedIn URL if findable, business email if publicly disclosed, the funding signal (round size + date + lead investor if known), a citation URL (TechCrunch, YourStory, Inc42, Crunchbase News, official press release, etc.), and a 1-sentence outreachHook tied to what they likely need post-funding (hiring, scaling, GTM, infra). ` +
      `Skip companies that only got "in talks" rumors — must be confirmed announcements. If you cannot find a public business email for a person, leave email empty (we'll enrich via Apollo afterwards).`,
    needsWebSearch: true,
  };
}

function buildCxoChangesPrompt(p: ResolvedSearchParams) {
  const titlesClause = p.titles.length
    ? p.titles.join(', ')
    : 'CEO, CFO, COO, CTO, CMO, CHRO, Chief Revenue Officer, VP Sales, VP Marketing, VP Engineering';
  const industryClause = p.industry ? ` in the ${p.industry} industry` : '';
  return {
    systemPrompt: `You are a B2B sales intelligence agent. You surface executives who recently joined or moved to a new company so salespeople can engage them in their first 90 days when they are actively evaluating new vendors. ${COMMON_RULES}`,
    userMessage:
      `Find up to ${p.maxResults} executives who recently took a new role (${titlesClause}) at companies${industryClause} based in ${p.region}, within the last ${p.daysBack} days. ` +
      `Sources: LinkedIn announcements, company press releases, BusinessLine / Economic Times / Mint / TechCrunch / Forbes appointment news. ` +
      `For each lead include: their name, new title, company, signal (what they did, when, and where they came from), citation URL, and a 1-sentence outreachHook tied to common 90-day priorities for that role.`,
    needsWebSearch: true,
  };
}

function buildAcademicsPrompt(p: ResolvedSearchParams) {
  const fieldClause = p.industry
    ? ` Focus on faculty in ${p.industry}.`
    : ` Any department is fine — prefer business, engineering, computer science, and applied sciences.`;
  return {
    systemPrompt: `You are an academic outreach intelligence agent. You find professors, lecturers, deans, department heads, and program directors at universities and colleges whose contact details are PUBLICLY LISTED on the institution's own website (faculty pages, department directories, "people" pages). You DO NOT scrape, you DO NOT guess emails — you only return names + emails + phones that you can cite from a public university page. ${COMMON_RULES}`,
    userMessage:
      `Find up to ${p.maxResults} academics at universities or colleges in ${p.region}.${fieldClause} ` +
      `For each lead, the email and (when listed) phone MUST come from a publicly visible university/college page — typically a faculty profile page (e.g. iitb.ac.in/staff/...), a department "Our Faculty" listing, or a public directory. ` +
      `For each lead include: their full name, current title (Professor, Associate Professor, Dean, etc.), department, university/college (in the company field), university website (companyUrl), email AS LISTED on the public page, phone AS LISTED on the public page (leave empty if not listed), location/city, and the citation URL (the exact university page where you read the email — not a Google Scholar page). ` +
      `Set the outreachHook to a 1-sentence reference to one of their visible interests, courses taught, or recent papers shown on their faculty page. ` +
      `Skip if no public email is shown — DO NOT GUESS firstname@uni.edu patterns.`,
    needsWebSearch: true,
  };
}

function buildCustomPrompt(p: ResolvedSearchParams) {
  if (!p.customPrompt) {
    throw new Error('customPrompt is required for mode=custom');
  }
  return {
    systemPrompt: `You are a B2B sales intelligence agent. The user has supplied custom criteria. Follow them exactly. ${COMMON_RULES}`,
    userMessage:
      `Find up to ${p.maxResults} leads matching these criteria. Region preference: ${p.region}.\n\n` +
      `Criteria:\n${p.customPrompt}\n\n` +
      `Return each as a structured lead with name, company, title, signal, citation URL, and outreachHook.`,
    needsWebSearch: p.customWebSearch,
  };
}
