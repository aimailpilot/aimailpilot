/**
 * AI Lead Agent — result normalization + Apollo enrichment merge.
 *
 * Pure functions, no I/O, no SDK calls. Easy to unit-test (covered by
 * tests/unit/lead-agent-merge.test.ts).
 *
 * Two responsibilities:
 *   1. Normalize whatever shape the LLM returned into the canonical Lead
 *      shape, dropping malformed entries instead of crashing the job.
 *   2. Merge in Apollo enrichment results (when the agent surfaced a lead
 *      with no email, the service layer asks Apollo for a match — this file
 *      decides which fields to overwrite vs keep).
 */

export interface Lead {
  name: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company: string;
  companyUrl?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  industry?: string;
  department?: string;
  seniority?: string;
  signal?: string;
  sourceUrl?: string;
  outreachHook?: string;
  /** Tag indicating where the email came from. Set by enrichment. */
  emailSource?: 'agent' | 'apollo';
  /** Apollo person id, if enrichment matched. */
  apolloId?: string;
}

export interface ApolloEnrichment {
  /** Email Apollo returned, if any. */
  email?: string;
  /** Apollo internal id. */
  apolloId?: string;
  /** Optional fields Apollo can fill in. */
  title?: string;
  linkedinUrl?: string;
  location?: string;
}

/**
 * Take whatever the LLM returned and produce a clean Lead[] — dropping items
 * that don't have at least a name + company. Trims strings, deduplicates by
 * name+company (case-insensitive).
 */
export function normalizeLeads(raw: unknown): Lead[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as any).leads;
  if (!Array.isArray(arr)) return [];

  const seen = new Set<string>();
  const out: Lead[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const name = strOrEmpty(item.name).trim();
    const company = strOrEmpty(item.company).trim();
    if (!name || !company) continue;

    const dedupKey = `${name.toLowerCase()}__${company.toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const email = emailOrUndef(item.email);
    out.push({
      name,
      company,
      firstName:    strOrUndef(item.firstName),
      lastName:     strOrUndef(item.lastName),
      title:        strOrUndef(item.title),
      companyUrl:   strOrUndef(item.companyUrl),
      linkedinUrl:  strOrUndef(item.linkedinUrl),
      email,
      phone:        strOrUndef(item.phone),
      mobilePhone:  strOrUndef(item.mobilePhone),
      location:     strOrUndef(item.location),
      city:         strOrUndef(item.city),
      state:        strOrUndef(item.state),
      country:      strOrUndef(item.country),
      industry:     strOrUndef(item.industry),
      department:   strOrUndef(item.department),
      seniority:    strOrUndef(item.seniority),
      signal:       strOrUndef(item.signal),
      sourceUrl:    strOrUndef(item.sourceUrl),
      outreachHook: strOrUndef(item.outreachHook),
      emailSource:  email ? 'agent' : undefined,
    });
  }
  return out;
}

/**
 * Merge Apollo enrichment into a Lead. Used after the service calls Apollo
 * /v1/people/match for a lead that was missing an email.
 *
 * Fill rules:
 *   - email: only fills when missing (we trust the agent's email if it had one)
 *   - title, linkedinUrl, location: fills when missing OR when current value is empty
 *   - apolloId, emailSource: always set when Apollo matched
 */
export function applyApolloEnrichment(lead: Lead, enrichment: ApolloEnrichment): Lead {
  const out: Lead = { ...lead };
  if (!lead.email && enrichment.email) {
    out.email = enrichment.email;
    out.emailSource = 'apollo';
  }
  if (!lead.title && enrichment.title) out.title = enrichment.title;
  if (!lead.linkedinUrl && enrichment.linkedinUrl) out.linkedinUrl = enrichment.linkedinUrl;
  if (!lead.location && enrichment.location) out.location = enrichment.location;
  if (enrichment.apolloId) out.apolloId = enrichment.apolloId;
  return out;
}

/**
 * Decide which leads need Apollo enrichment. Keep it explicit instead of
 * inferring from "no email" alone — caller might enable enrichment as a
 * deliberate flag.
 */
export function leadsNeedingEnrichment(leads: Lead[]): Lead[] {
  return leads.filter(l => !l.email && (l.name && l.company));
}

/**
 * Map a Lead to the field shape the contacts table accepts. Splits `name`
 * into firstName / lastName when those weren't provided by the LLM.
 *
 * Agent-specific metadata (signal, outreach hook, source URL, agent mode)
 * is stored on the contact's customFields JSONB column so it survives normal
 * contact reads and is visible on the contact-detail card.
 *
 * Pure — used by the /api/lead-agent/save route to insert rows.
 */
export interface ContactInsert {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  jobTitle: string | null;
  company: string | null;
  website: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  industry: string | null;
  department: string | null;
  seniority: string | null;
  source: string;
  customFields: Record<string, string>;
}

export function leadToContactInsert(lead: Lead, agentMode?: string): ContactInsert {
  // Prefer LLM-provided firstName/lastName, otherwise split `name`.
  let firstName = lead.firstName?.trim() || '';
  let lastName = lead.lastName?.trim() || '';
  if (!firstName && !lastName && lead.name) {
    const parts = lead.name.trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  // Stash agent metadata on customFields — visible on contact card, queryable.
  const customFields: Record<string, string> = {};
  if (lead.signal)        customFields.lead_agent_signal = lead.signal;
  if (lead.outreachHook)  customFields.lead_agent_hook = lead.outreachHook;
  if (lead.sourceUrl)     customFields.lead_agent_source = lead.sourceUrl;
  if (lead.emailSource)   customFields.lead_agent_email_source = lead.emailSource;
  if (agentMode)          customFields.lead_agent_mode = agentMode;

  return {
    firstName: firstName || '(unknown)',
    lastName: lastName || '',
    email: lead.email || null,
    phone: lead.phone || null,
    mobilePhone: lead.mobilePhone || null,
    jobTitle: lead.title || null,
    company: lead.company || null,
    website: lead.companyUrl || null,
    linkedinUrl: lead.linkedinUrl || null,
    city: lead.city || null,
    state: lead.state || null,
    country: lead.country || null,
    industry: lead.industry || null,
    department: lead.department || null,
    seniority: lead.seniority || null,
    source: 'lead_agent',
    customFields,
  };
}

// ===== helpers =====
function strOrEmpty(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v);
}
function strOrUndef(v: any): string | undefined {
  const s = strOrEmpty(v).trim();
  return s ? s : undefined;
}
function emailOrUndef(v: any): string | undefined {
  const s = strOrEmpty(v).trim().toLowerCase();
  if (!s) return undefined;
  // Only accept if it looks like an email — drops "TBD", "n/a", etc. that
  // some LLMs return for missing emails.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined;
  return s;
}
