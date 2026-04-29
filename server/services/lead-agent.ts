/**
 * AI Lead Agent — service layer.
 *
 * Calls the LLM abstraction (server/lib/llm) with mode-specific prompts and
 * an output schema, then enriches missing emails via Apollo's /v1/people/match.
 *
 * Pure-prompt logic + result normalization live in:
 *   - server/lib/lead-agent-prompts.ts
 *   - server/lib/lead-agent-merge.ts
 *
 * Background-job orchestration (api_settings rows keyed `lead_agent_job_*`)
 * lives in server/routes.ts, mirroring the lead-intel and bulk-analyze patterns.
 *
 * Provider rules (enforced in runOneSearch):
 *   - funded / cxo_changes / academics → forceProvider='anthropic' + webSearch=true
 *   - custom → no force; respects user's customWebSearch flag (Anthropic only if true)
 */

import { runLlm } from '../lib/llm';
import {
  buildPromptForMode,
  resolveSearchParams,
  LEAD_RESULT_SCHEMA,
  type LeadAgentMode,
  type LeadAgentSearchParams,
} from '../lib/lead-agent-prompts';
import {
  normalizeLeads,
  applyApolloEnrichment,
  leadsNeedingEnrichment,
  type Lead,
  type ApolloEnrichment,
} from '../lib/lead-agent-merge';
import { storage } from '../storage';

export interface RunSearchOptions {
  orgId: string;
  mode: LeadAgentMode;
  params: LeadAgentSearchParams;
  /** Whether to attempt Apollo enrichment for leads without an email. */
  enrichWithApollo?: boolean;
  /** Cap on Apollo /v1/people/match calls (1 credit each). Default 10. */
  maxApolloMatches?: number;
}

export interface RunSearchResult {
  mode: LeadAgentMode;
  /** LLM-side cost telemetry. */
  llmUsage: {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    estCostUsd: number;
  };
  /** Apollo telemetry. */
  apollo: {
    matchesAttempted: number;
    matchesSucceeded: number;
    creditsSpent: number;
  };
  /** Optional summary returned by the LLM. */
  summary?: string;
  /** Final, enriched, deduplicated leads. */
  leads: Lead[];
  /** When the LLM returned malformed JSON (rare with schema enforcement). */
  parseFailed?: boolean;
  rawResponse?: string;
}

/**
 * Run a single lead-agent search end-to-end.
 *
 * Caller (routes.ts background job runner) is responsible for:
 *   - Persisting RunSearchResult to api_settings job row
 *   - Heartbeating
 *   - Surfacing errors to the user
 */
export async function runOneSearch(opts: RunSearchOptions): Promise<RunSearchResult> {
  const params = resolveSearchParams(opts.params);
  const { systemPrompt, userMessage, needsWebSearch } = buildPromptForMode(opts.mode, params);

  // Provider selection: funded/cxo/academics need web search → Anthropic only.
  // Custom mode follows the user's customWebSearch flag — we only force
  // Anthropic when web search is actually requested.
  const forceProvider = needsWebSearch ? 'anthropic' as const : undefined;

  const llmResp = await runLlm({
    orgId: opts.orgId,
    feature: 'lead_agent',
    forceProvider,
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    jsonSchema: LEAD_RESULT_SCHEMA as any,
    webSearch: needsWebSearch,
    thinking: true,
    maxTokens: 16000,
  });

  // Parse — schema enforcement usually guarantees valid JSON, but providers
  // can rarely return malformed output. We surface this state instead of
  // throwing because the user has already paid for the call.
  let parsed: unknown = llmResp.parsed;
  let parseFailed = false;
  if (parsed === undefined) {
    try {
      parsed = JSON.parse(llmResp.content);
    } catch {
      parseFailed = true;
    }
  }

  let leads = normalizeLeads(parsed);
  const summary = (parsed as any)?.summary;

  // Apollo enrichment for leads that came back without an email
  const apolloStats = { matchesAttempted: 0, matchesSucceeded: 0, creditsSpent: 0 };
  if (opts.enrichWithApollo !== false) {
    const cap = Math.max(0, Math.min(opts.maxApolloMatches ?? 10, 100));
    const need = leadsNeedingEnrichment(leads);
    if (cap > 0 && need.length > 0) {
      const enriched = await enrichLeadsWithApollo(opts.orgId, need.slice(0, cap), apolloStats);
      // Merge back into leads — preserve order, replace where enriched
      const enrichedByKey = new Map<string, Lead>();
      for (const e of enriched) enrichedByKey.set(`${e.name}__${e.company}`.toLowerCase(), e);
      leads = leads.map(l => {
        const key = `${l.name}__${l.company}`.toLowerCase();
        return enrichedByKey.get(key) || l;
      });
    }
  }

  return {
    mode: opts.mode,
    llmUsage: {
      provider: llmResp.provider,
      model: llmResp.model,
      promptTokens: llmResp.usage.promptTokens,
      completionTokens: llmResp.usage.completionTokens,
      estCostUsd: llmResp.usage.estCostUsd,
    },
    apollo: apolloStats,
    summary: typeof summary === 'string' ? summary : undefined,
    leads,
    parseFailed,
    rawResponse: parseFailed ? llmResp.content.slice(0, 4000) : undefined,
  };
}

/**
 * Apollo enrichment pass. Calls /v1/people/match (1 credit each) for each lead
 * the agent surfaced without an email. Best-effort — failures don't break the
 * larger search.
 *
 * Imported lazily because not every install has Apollo configured, and we want
 * the agent to work even when the Apollo module isn't initialized.
 */
async function enrichLeadsWithApollo(
  orgId: string,
  leads: Lead[],
  stats: { matchesAttempted: number; matchesSucceeded: number; creditsSpent: number },
): Promise<Lead[]> {
  let apolloRequest: any, getApolloApiKey: any;
  try {
    const mod = await import('./apollo-sync-engine');
    apolloRequest = mod.apolloRequest;
    getApolloApiKey = mod.getApolloApiKey;
  } catch (e: any) {
    console.warn('[LeadAgent] Apollo module not available, skipping enrichment:', e?.message || e);
    return leads;
  }

  let apiKey: string | undefined;
  try {
    apiKey = await getApolloApiKey(orgId);
  } catch { /* fall through */ }
  if (!apiKey) {
    console.log(`[LeadAgent] No Apollo API key configured for org ${orgId} — skipping enrichment`);
    return leads;
  }

  const out: Lead[] = [];
  for (const lead of leads) {
    stats.matchesAttempted++;
    try {
      // /v1/people/match accepts name + organization_name (or domain). We pass
      // both for best match probability. Reveal personal email is OFF — we
      // only want public/business emails Apollo already has cached.
      const matchBody: any = {
        name: lead.name,
        organization_name: lead.company,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      };
      if (lead.companyUrl) {
        try {
          const u = new URL(lead.companyUrl);
          matchBody.domain = u.hostname.replace(/^www\./, '');
        } catch { /* invalid url, skip domain */ }
      }
      const res = await apolloRequest(apiKey, '/v1/people/match', 'POST', matchBody);
      const person = res?.person || res;
      if (!person) {
        out.push(lead);
        continue;
      }
      stats.creditsSpent++;
      const apolloEmail = pickEmail(person);
      const enrichment: ApolloEnrichment = {
        email: apolloEmail,
        apolloId: String(person.id || ''),
        title: person.title || undefined,
        linkedinUrl: person.linkedin_url || undefined,
        location: composeLocation(person),
      };
      if (apolloEmail) stats.matchesSucceeded++;
      out.push(applyApolloEnrichment(lead, enrichment));
    } catch (e: any) {
      // Best-effort — log and keep the original lead
      console.warn(`[LeadAgent] Apollo match failed for ${lead.name} @ ${lead.company}:`, e?.message || e);
      out.push(lead);
    }
  }
  return out;
}

function pickEmail(person: any): string | undefined {
  if (!person) return undefined;
  const candidates: any[] = [];
  if (person.email) candidates.push(person.email);
  if (Array.isArray(person.contact_emails)) candidates.push(...person.contact_emails.map((c: any) => c?.email));
  if (Array.isArray(person.personal_emails)) candidates.push(...person.personal_emails);
  for (const c of candidates) {
    if (typeof c === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && !/email_not_unlocked/i.test(c)) {
      return c.toLowerCase();
    }
  }
  return undefined;
}

function composeLocation(person: any): string | undefined {
  if (!person) return undefined;
  const parts = [person.city, person.state, person.country].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

// Storage marker so an unused-import lint doesn't complain when the file is
// extended with helpers that need it (Phase 2.x). Removed if not used.
void storage;
