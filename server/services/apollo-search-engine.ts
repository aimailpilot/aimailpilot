/**
 * Apollo Search Engine — Phase 2
 *
 * People search (keyword/title/industry/location/company) with:
 *   - saved-first pass (free) against the org's existing Apollo-synced lists
 *   - dedup overlay against aimailpilot contacts (shows who's already imported
 *     and their last engagement status inline in search results)
 *   - per-contact `/v1/people/match` reveal on import (1 credit each,
 *     skipped for contacts already in aimailpilot with email present)
 *   - optional "save as Apollo list" round-trip
 *
 * Shares apolloRequest/reconcileContact/apolloToContact with apollo-sync-engine.ts.
 */
import { storage } from '../storage';
import crypto from 'crypto';
import {
  apolloRequest,
  getApolloApiKey,
  getOverwriteMode,
  getPrimaryEmail,
  reconcileContact,
} from './apollo-sync-engine';

function genId() {
  return crypto.randomUUID();
}
function nowIso() {
  return new Date().toISOString();
}

// --- Filter shape ---
export interface ApolloSearchFilters {
  keywords?: string;
  titles?: string[];
  industries?: string[];
  locations?: string[];        // free-text city/state/country
  companyNames?: string[];
  companyDomains?: string[];
  seniorities?: string[];      // c_suite, vp, director, manager, etc.
  employeeRanges?: string[];   // "1,10" | "11,50" | "51,200" | ...
  page?: number;
  perPage?: number;
}

function buildSearchBody(filters: ApolloSearchFilters, extra: Record<string, any> = {}) {
  const body: Record<string, any> = {
    page: filters.page || 1,
    per_page: Math.min(filters.perPage || 25, 100),
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };
  if (filters.keywords?.trim()) body.q_keywords = filters.keywords.trim();
  if (filters.titles?.length) body.person_titles = filters.titles;
  if (filters.seniorities?.length) body.person_seniorities = filters.seniorities;
  if (filters.industries?.length) body.organization_industry_tag_ids = filters.industries;
  if (filters.locations?.length) body.person_locations = filters.locations;
  if (filters.companyNames?.length) body.q_organization_name = filters.companyNames.join(' OR ');
  if (filters.companyDomains?.length) body.q_organization_domains = filters.companyDomains.join('\n');
  if (filters.employeeRanges?.length) body.organization_num_employees_ranges = filters.employeeRanges;
  return { ...body, ...extra };
}

// --- Dedup overlay: check which matches already exist in aimailpilot ---
async function buildDedupOverlay(
  organizationId: string,
  emails: string[],
): Promise<Record<string, { inSystem: true; contactId: string; lastReplyType: string | null; lastActivityAt: string | null; status: string } | { inSystem: false }>> {
  const overlay: Record<string, any> = {};
  for (const e of emails) overlay[e] = { inSystem: false };
  if (!emails.length) return overlay;

  const placeholders = emails.map(() => '?').join(',');
  const rows = await storage.rawAll(
    `SELECT c.id, c.email, c.status,
            (SELECT m."replyType" FROM messages m
             WHERE m."contactId" = c.id AND m."replyType" IS NOT NULL
             ORDER BY m."repliedAt" DESC NULLS LAST LIMIT 1) as "lastReplyType",
            (SELECT MAX(m."sentAt") FROM messages m WHERE m."contactId" = c.id) as "lastActivityAt"
     FROM contacts c
     WHERE c."organizationId" = ? AND LOWER(c.email) IN (${placeholders})`,
    organizationId,
    ...emails.map((e) => e.toLowerCase()),
  );
  for (const r of rows) {
    overlay[r.email.toLowerCase()] = {
      inSystem: true,
      contactId: r.id,
      lastReplyType: r.lastReplyType || null,
      lastActivityAt: r.lastActivityAt || null,
      status: r.status || 'unknown',
    };
  }
  return overlay;
}

// --- Saved-first pass: which matches already exist in the org's Apollo-synced lists ---
async function buildSavedLabelOverlay(
  organizationId: string,
  peopleIds: string[],
): Promise<Set<string>> {
  // A contact is "in saved data" if we have them locally with an apolloContactId.
  // This is a pragmatic definition: once synced, they're free to use.
  const saved = new Set<string>();
  if (!peopleIds.length) return saved;
  const placeholders = peopleIds.map(() => '?').join(',');
  const rows = await storage.rawAll(
    `SELECT "apolloContactId" FROM contacts
     WHERE "organizationId" = ? AND "apolloContactId" IN (${placeholders})`,
    organizationId,
    ...peopleIds,
  );
  for (const r of rows) if (r.apolloContactId) saved.add(r.apolloContactId);
  return saved;
}

// --- Preview: search Apollo, attach dedup + saved overlay, NO credits spent ---
export async function previewSearch(
  organizationId: string,
  filters: ApolloSearchFilters,
): Promise<{
  total: number;
  page: number;
  perPage: number;
  people: any[];
  summary: {
    alreadyInSystem: number;
    inSavedApolloData: number;
    newProspects: number;
    estimatedRevealCredits: number;
  };
}> {
  const apiKey = await getApolloApiKey(organizationId);
  if (!apiKey) throw new Error('Apollo API key not configured');

  const body = buildSearchBody(filters);
  const data = await apolloRequest(apiKey, '/v1/mixed_people/api_search', 'POST', body);
  const people: any[] = data?.people || data?.contacts || [];
  const pg = data?.pagination || {};
  const total = Number(
    pg.total_entries ?? pg.total ?? pg.total_people ?? data?.total_entries ?? people.length,
  );

  const emails = people.map(getPrimaryEmail).filter(Boolean);
  const ids = people.map((p) => String(p.id || p._id || '')).filter(Boolean);
  const [dedup, savedIds] = await Promise.all([
    buildDedupOverlay(organizationId, emails),
    buildSavedLabelOverlay(organizationId, ids),
  ]);

  let alreadyInSystem = 0;
  let inSavedApolloData = 0;
  let newProspects = 0;

  const enriched = people.map((p) => {
    const email = getPrimaryEmail(p);
    const id = String(p.id || p._id || '');
    const d = dedup[email] || { inSystem: false };
    const savedInApollo = savedIds.has(id);
    if (d.inSystem) alreadyInSystem++;
    else if (savedInApollo) inSavedApolloData++;
    else newProspects++;
    return {
      id,
      firstName: p.first_name || '',
      lastName: p.last_name || '',
      title: p.title || '',
      company: p.organization?.name || '',
      industry: p.organization?.industry || '',
      city: p.city || '',
      state: p.state || '',
      country: p.country || '',
      linkedinUrl: p.linkedin_url || '',
      emailMasked: p.email || p.email_status || '',
      hasEmail: Boolean(email),
      inSystem: d.inSystem || false,
      inSystemStatus: d.inSystem ? d.status : null,
      inSystemLastReply: d.inSystem ? d.lastReplyType : null,
      inSystemLastActivity: d.inSystem ? d.lastActivityAt : null,
      inSavedApolloData: savedInApollo,
    };
  });

  return {
    total,
    page: filters.page || 1,
    perPage: Math.min(filters.perPage || 25, 100),
    people: enriched,
    summary: {
      alreadyInSystem,
      inSavedApolloData,
      newProspects,
      // Revealing new prospects costs ~1 credit each via /v1/people/match.
      // Contacts in saved data are free. Already-in-system are skipped entirely.
      estimatedRevealCredits: newProspects,
    },
  };
}

// --- Import search results: saved-first (free) + optional reveal for new (1 credit each) ---
export interface ImportJobProgress {
  totalSelected: number;
  processed: number;
  imported: number;
  enriched: number;
  skipped: number;
  revealFailed: number;
  creditsSpent: number;
}

const importProgress = new Map<string, ImportJobProgress & { status: string; startedAt: string; completedAt?: string; errorMessage?: string }>();

export function getImportProgress(jobId: string) {
  return importProgress.get(jobId) || null;
}

export async function startImportJob(params: {
  organizationId: string;
  triggeredBy: string;
  peopleIds: string[];                  // Apollo person IDs to import
  allowReveal: boolean;                 // if false, ONLY imports contacts whose email is already visible
  revealBudgetCredits: number;          // hard cap
  targetListId: string | null;          // aimailpilot list to attach contacts to
  saveToApolloListName?: string | null; // optional: create this Apollo list + add matched people
}): Promise<string> {
  const jobId = genId();
  importProgress.set(jobId, {
    totalSelected: params.peopleIds.length,
    processed: 0,
    imported: 0,
    enriched: 0,
    skipped: 0,
    revealFailed: 0,
    creditsSpent: 0,
    status: 'queued',
    startedAt: nowIso(),
  });
  setImmediate(() => runImportJob(jobId, params).catch((e) => {
    const p = importProgress.get(jobId);
    if (p) {
      p.status = 'failed';
      p.errorMessage = e?.message || String(e);
      p.completedAt = nowIso();
    }
    console.error('[apollo-search] import job crashed', jobId, e);
  }));
  return jobId;
}

async function runImportJob(jobId: string, params: Parameters<typeof startImportJob>[0]) {
  const p = importProgress.get(jobId)!;
  p.status = 'running';

  const apiKey = await getApolloApiKey(params.organizationId);
  if (!apiKey) throw new Error('Apollo API key not configured');
  const overwriteMode = await getOverwriteMode(params.organizationId);

  // Optional: create Apollo list up front so we can add people to it as we reveal.
  let apolloListId: string | null = null;
  if (params.saveToApolloListName?.trim()) {
    try {
      const r = await apolloRequest(apiKey, '/v1/labels', 'POST', { name: params.saveToApolloListName.trim() });
      apolloListId = String(r?.label?.id || r?.id || '');
    } catch (e) {
      console.warn('[apollo-search] failed to create Apollo label, continuing without:', e);
    }
  }

  for (const personId of params.peopleIds) {
    p.processed++;
    if (p.creditsSpent >= params.revealBudgetCredits && params.allowReveal) {
      p.skipped++;
      continue;
    }

    try {
      // Check if we already have this person by apolloContactId — free path.
      const existing = await storage.rawGet(
        `SELECT id, email FROM contacts WHERE "organizationId" = ? AND "apolloContactId" = ? LIMIT 1`,
        params.organizationId,
        personId,
      );

      let person: any = null;
      if (existing?.email) {
        // Already in saved data — reconcile without reveal.
        // Re-fetch person metadata from /v1/people/{id} is ALSO billable on some plans;
        // safer to just re-run reconcile using what we already have.
        p.skipped++;
        continue;
      }

      if (!params.allowReveal) {
        p.skipped++;
        continue;
      }

      // Reveal: per-contact match (1 credit).
      const matchRes = await apolloRequest(apiKey, '/v1/people/match', 'POST', {
        id: personId,
        reveal_personal_emails: true,
      });
      person = matchRes?.person || matchRes;
      p.creditsSpent++;

      const email = getPrimaryEmail(person);
      if (!email) {
        p.revealFailed++;
        continue;
      }

      const result = await reconcileContact({
        organizationId: params.organizationId,
        email,
        apolloPerson: person,
        targetListId: params.targetListId,
        overwriteMode,
      });
      if (result === 'imported') p.imported++;
      else if (result === 'enriched') p.enriched++;
      else p.skipped++;

      // Best-effort: add the revealed person to the Apollo list we created.
      if (apolloListId && person?.id) {
        try {
          await apolloRequest(apiKey, `/v1/labels/${apolloListId}/contacts`, 'POST', { contact_ids: [person.id] });
        } catch (_e) { /* non-fatal */ }
      }
    } catch (e) {
      p.revealFailed++;
      console.error('[apollo-search] reveal/reconcile error for', personId, e);
    }
  }

  p.status = 'completed';
  p.completedAt = nowIso();

  // Usage log.
  try {
    await storage.rawRun(
      `INSERT INTO apollo_usage_log (id, "organizationId", "userId", action, "creditsUsed", "contactsAffected", metadata, "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      genId(),
      params.organizationId,
      params.triggeredBy,
      'search_import',
      p.creditsSpent,
      p.imported + p.enriched,
      JSON.stringify({ totalSelected: p.totalSelected, targetListId: params.targetListId, apolloListId }),
      nowIso(),
    );
  } catch (_e) { /* ignore */ }
}

// --- Saved searches CRUD ---
export async function listSavedSearches(organizationId: string) {
  return storage.rawAll(
    `SELECT * FROM apollo_saved_searches WHERE "organizationId" = ? ORDER BY "updatedAt" DESC`,
    organizationId,
  );
}

export async function createSavedSearch(params: {
  organizationId: string;
  userId: string;
  name: string;
  filters: ApolloSearchFilters;
}) {
  const id = genId();
  const ts = nowIso();
  await storage.rawRun(
    `INSERT INTO apollo_saved_searches (id, "organizationId", "createdBy", name, filters, "lastRunAt", "lastSeenIds", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, NULL, '[]', ?, ?)`,
    id,
    params.organizationId,
    params.userId,
    params.name,
    JSON.stringify(params.filters),
    ts,
    ts,
  );
  return id;
}

export async function deleteSavedSearch(organizationId: string, id: string) {
  await storage.rawRun(
    `DELETE FROM apollo_saved_searches WHERE id = ? AND "organizationId" = ?`,
    id,
    organizationId,
  );
}

export async function runSavedSearch(organizationId: string, id: string) {
  const row = await storage.rawGet(
    `SELECT * FROM apollo_saved_searches WHERE id = ? AND "organizationId" = ?`,
    id,
    organizationId,
  );
  if (!row) throw new Error('Saved search not found');

  const filters: ApolloSearchFilters = typeof row.filters === 'string' ? JSON.parse(row.filters) : row.filters;
  const preview = await previewSearch(organizationId, { ...filters, page: 1, perPage: 100 });

  const lastSeen: string[] = typeof row.lastSeenIds === 'string' ? JSON.parse(row.lastSeenIds || '[]') : (row.lastSeenIds || []);
  const lastSeenSet = new Set(lastSeen);
  const newOnly = preview.people.filter((p) => !lastSeenSet.has(p.id));

  // Update lastSeenIds with union (capped to last 5000 to keep row small).
  const updatedSeen = Array.from(new Set([...lastSeen, ...preview.people.map((p) => p.id)])).slice(-5000);
  await storage.rawRun(
    `UPDATE apollo_saved_searches SET "lastRunAt" = ?, "lastSeenIds" = ?, "updatedAt" = ? WHERE id = ?`,
    nowIso(),
    JSON.stringify(updatedSeen),
    nowIso(),
    id,
  );

  return {
    ...preview,
    newSinceLastRun: newOnly.length,
    newPeople: newOnly,
  };
}
