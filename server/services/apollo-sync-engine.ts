/**
 * Apollo Sync Engine
 *
 * Self-contained service for syncing Apollo.io saved lists + saved-data
 * enrichment into aimailpilot contacts. Uses only Apollo endpoints that do
 * NOT consume credits by default (saved labels + people search filtered
 * by label). No credit-spending reveals in Phase 1.
 *
 * Pattern follows warmup-engine / lead-intelligence-engine: own helpers,
 * independent of campaign-engine / followup-engine protected code.
 */
import { storage } from '../storage';
import crypto from 'crypto';

const APOLLO_BASE = 'https://api.apollo.io';
const DEFAULT_PAGE_SIZE = 100;
// Conservative throttle — Apollo plans start around 60 req/min. Stay below that.
// Apollo api_search on lower tiers limits to 50 req/min. 1300ms = ~46 req/min, safe headroom.
const MIN_MS_BETWEEN_CALLS = 1300;

// --- Job lifecycle state (in-memory cancel flags) ---
const cancelFlags = new Set<string>();

export function cancelJob(jobId: string) {
  cancelFlags.add(jobId);
}

function isCancelled(jobId: string) {
  return cancelFlags.has(jobId);
}

function genId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

// --- API key helpers ---
export async function getApolloApiKey(organizationId: string): Promise<string | null> {
  const settings = await storage.getApiSettings(organizationId);
  const key = settings.apollo_api_key;
  return key && key.trim() ? key.trim() : null;
}

export async function getOverwriteMode(organizationId: string): Promise<'fill_blanks_only' | 'apollo_wins'> {
  const settings = await storage.getApiSettings(organizationId);
  const mode = settings.apollo_sync_overwrite_mode;
  return mode === 'apollo_wins' ? 'apollo_wins' : 'fill_blanks_only';
}

// --- Throttled fetch wrapper ---
let lastCallAt = 0;
async function throttledFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < MIN_MS_BETWEEN_CALLS) {
    await new Promise((r) => setTimeout(r, MIN_MS_BETWEEN_CALLS - elapsed));
  }
  lastCallAt = Date.now();
  return fetch(url, opts);
}

export async function apolloRequest(
  apiKey: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: any,
): Promise<any> {
  const url = `${APOLLO_BASE}${path}`;
  const headers: Record<string, string> = {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  };
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);

  // Auto-retry on 429 with exponential backoff (up to 3 attempts).
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await throttledFetch(url, init);
    if (res.status === 429 && attempt < 2) {
      const retryAfterHdr = res.headers.get('retry-after');
      const waitMs = retryAfterHdr ? Math.min(parseInt(retryAfterHdr) * 1000, 60000) : (attempt + 1) * 15000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Apollo ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error(`Apollo ${method} ${path} failed: rate limit exceeded after retries`);
}

// --- Public API used by routes ---

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string; credits?: any }> {
  try {
    const data = await apolloRequest(apiKey, '/v1/auth/health', 'GET');
    return { valid: true, credits: data };
  } catch (e: any) {
    return { valid: false, error: e?.message || 'Unknown error' };
  }
}

export async function fetchCreditBalance(organizationId: string): Promise<any> {
  const apiKey = await getApolloApiKey(organizationId);
  if (!apiKey) throw new Error('Apollo API key not configured');
  return apolloRequest(apiKey, '/v1/auth/health', 'GET');
}

export interface ApolloList {
  id: string;
  name: string;
  count: number;
}

export async function fetchSavedLists(organizationId: string): Promise<ApolloList[]> {
  const apiKey = await getApolloApiKey(organizationId);
  if (!apiKey) throw new Error('Apollo API key not configured');

  const data = await apolloRequest(apiKey, '/v1/labels', 'GET');
  // Apollo returns { labels: [{id, name, cached_count, ...}] } — be defensive.
  const labels: any[] = data?.labels || data || [];
  return labels.map((l) => ({
    id: String(l.id || l._id || ''),
    name: String(l.name || l.label || 'Untitled'),
    count: Number(l.cached_count ?? l.count ?? l.num_contacts ?? 0),
  })).filter((l) => l.id);
}

// Search for people in specific labels (saved lists) — no credits consumed.
async function searchPeopleInLabels(
  apiKey: string,
  labelIds: string[],
  page: number,
  perPage: number,
): Promise<{ people: any[]; total: number }> {
  const body = {
    label_ids: labelIds,
    page,
    per_page: perPage,
    // Explicitly disable reveals so nothing unexpected gets charged.
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };
  const data = await apolloRequest(apiKey, '/v1/mixed_people/api_search', 'POST', body);
  const people: any[] = data?.people || data?.contacts || [];
  // Apollo's new api_search returns pagination under several possible shapes.
  const pg = data?.pagination || {};
  const total: number = Number(
    pg.total_entries ?? pg.total ?? pg.total_people ?? data?.total_entries ?? people.length,
  );
  return { people, total };
}

export interface SyncPreview {
  totalFound: number;
  samples: {
    wouldImport: Array<{ email: string; name: string; company: string }>;
    wouldEnrich: Array<{ email: string; name: string; fieldsToFill: string[] }>;
    alreadyCurrent: number;
  };
}

export async function previewSync(
  organizationId: string,
  listIds: string[],
): Promise<SyncPreview> {
  const apiKey = await getApolloApiKey(organizationId);
  if (!apiKey) throw new Error('Apollo API key not configured');

  // Just fetch first page to show totals + samples.
  const { people, total } = await searchPeopleInLabels(apiKey, listIds, 1, 25);

  const wouldImport: SyncPreview['samples']['wouldImport'] = [];
  const wouldEnrich: SyncPreview['samples']['wouldEnrich'] = [];
  let alreadyCurrent = 0;

  for (const p of people) {
    const email = getPrimaryEmail(p);
    if (!email) continue;
    const existing = await storage.getContactByEmail(organizationId, email);
    if (!existing) {
      if (wouldImport.length < 5) {
        wouldImport.push({
          email,
          name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          company: p.organization?.name || p.organization_name || '',
        });
      }
    } else {
      const fieldsToFill = diffFields(existing, p);
      if (fieldsToFill.length === 0) {
        alreadyCurrent++;
      } else if (wouldEnrich.length < 5) {
        wouldEnrich.push({
          email,
          name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          fieldsToFill,
        });
      }
    }
  }

  return { totalFound: total, samples: { wouldImport, wouldEnrich, alreadyCurrent } };
}

export function getPrimaryEmail(p: any): string {
  return String(p.email || p.primary_email || p.emails?.[0]?.email || '').toLowerCase().trim();
}

// Map Apollo person → aimailpilot contact columns.
function apolloToContact(p: any): Record<string, any> {
  const org = p.organization || {};
  return {
    firstName: p.first_name || '',
    lastName: p.last_name || '',
    jobTitle: p.title || '',
    seniority: p.seniority || '',
    department: (p.departments || [])[0] || '',
    linkedinUrl: p.linkedin_url || '',
    phone: p.phone_numbers?.[0]?.sanitized_number || p.phone || '',
    mobilePhone: p.mobile_phone || '',
    city: p.city || '',
    state: p.state || '',
    country: p.country || '',
    company: org.name || p.organization_name || '',
    website: org.website_url || '',
    industry: org.industry || '',
    employeeCount: org.estimated_num_employees ? String(org.estimated_num_employees) : '',
    annualRevenue: org.annual_revenue_printed || '',
    companyLinkedinUrl: org.linkedin_url || '',
    companyCity: org.city || '',
    companyState: org.state || '',
    companyCountry: org.country || '',
    companyPhone: org.phone || '',
  };
}

// Returns the list of aimailpilot columns that are blank on the contact
// but populated on the Apollo record. Used for preview + fill-blanks-only mode.
function diffFields(existing: any, apolloPerson: any): string[] {
  const mapped = apolloToContact(apolloPerson);
  const filled: string[] = [];
  for (const [k, v] of Object.entries(mapped)) {
    if (!v) continue;
    const current = existing[k];
    if (!current || String(current).trim() === '') {
      filled.push(k);
    }
  }
  return filled;
}

// --- Sync job creation + background runner ---

export async function createSyncJob(params: {
  organizationId: string;
  triggeredBy: string;
  listIds: string[];
  listNames: string[];
  targetListId: string | null;
  overwriteMode: 'fill_blanks_only' | 'apollo_wins';
}): Promise<string> {
  const id = genId();
  await storage.rawRun(
    `INSERT INTO apollo_sync_jobs (id, "organizationId", "triggeredBy", "listIds", "listNames", "targetListId", "overwriteMode", status, "createdAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    id,
    params.organizationId,
    params.triggeredBy,
    JSON.stringify(params.listIds),
    JSON.stringify(params.listNames),
    params.targetListId,
    params.overwriteMode,
    nowIso(),
  );
  // Fire and forget — background worker.
  setImmediate(() => runSyncJob(id).catch((e) => {
    console.error('[apollo-sync] job crashed:', id, e);
  }));
  return id;
}

export async function getJob(jobId: string): Promise<any> {
  return storage.rawGet(`SELECT * FROM apollo_sync_jobs WHERE id = ?`, jobId);
}

export async function listJobs(organizationId: string, limit = 20): Promise<any[]> {
  return storage.rawAll(
    `SELECT * FROM apollo_sync_jobs WHERE "organizationId" = ? ORDER BY "createdAt" DESC LIMIT ?`,
    organizationId,
    limit,
  );
}

async function updateJob(jobId: string, fields: Record<string, any>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setSql = keys.map((k, i) => `"${k}" = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  await storage.rawRun(`UPDATE apollo_sync_jobs SET ${setSql} WHERE id = ?`, ...values, jobId);
}

async function logUsage(params: {
  organizationId: string;
  userId: string;
  action: string;
  creditsUsed: number;
  contactsAffected: number;
  metadata?: any;
}) {
  await storage.rawRun(
    `INSERT INTO apollo_usage_log (id, "organizationId", "userId", action, "creditsUsed", "contactsAffected", metadata, "createdAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    genId(),
    params.organizationId,
    params.userId,
    params.action,
    params.creditsUsed,
    params.contactsAffected,
    JSON.stringify(params.metadata || {}),
    nowIso(),
  );
}

// Apollo api_search pagination cap — Apollo itself maxes at 50k per search
// across any pagination. Beyond that, results are inaccessible.
const MAX_PAGES = 500;
// Per-batch cap to stay under Apollo's 200 req/hour hard limit.
// 100 pages × ~1.3s throttle ≈ 130s, leaves headroom within the hour bucket.
const PAGES_PER_BATCH = 100;
// Cooldown after hitting an hourly 429 before the resumer will retry.
const HOURLY_COOLDOWN_MS = 65 * 60 * 1000;

function isRateLimitError(msg: string): { isHourly: boolean; isMinute: boolean } {
  const m = (msg || '').toLowerCase();
  const isRate = m.includes('429');
  return {
    isHourly: isRate && m.includes('per hour'),
    isMinute: isRate && m.includes('per minute'),
  };
}

async function runSyncJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job) return;

  const organizationId = job.organizationId;
  const listIds: string[] = typeof job.listIds === 'string' ? JSON.parse(job.listIds || '[]') : (job.listIds || []);
  const targetListId: string | null = job.targetListId || null;
  const overwriteMode: 'fill_blanks_only' | 'apollo_wins' = job.overwriteMode || 'fill_blanks_only';

  const apiKey = await getApolloApiKey(organizationId);
  if (!apiKey) {
    await updateJob(jobId, {
      status: 'failed',
      errorMessage: 'Apollo API key not configured',
      completedAt: nowIso(),
    });
    return;
  }

  // Resume from checkpoint if present.
  let processed = Number(job.processed || 0);
  let alreadyCurrent = Number(job.alreadyCurrent || 0);
  let enriched = Number(job.enriched || 0);
  let imported = Number(job.imported || 0);
  let totalFound = Number(job.totalFound || 0);
  let page = Math.max(1, Number(job.nextPage || 1));

  await updateJob(jobId, { status: 'running', startedAt: job.startedAt || nowIso(), errorMessage: null });

  let pagesThisBatch = 0;

  try {
    while (true) {
      if (page > MAX_PAGES) {
        console.warn('[apollo-sync] hit MAX_PAGES cap', { jobId, page });
        break;
      }
      if (isCancelled(jobId)) {
        await updateJob(jobId, {
          status: 'cancelled',
          completedAt: nowIso(),
          processed, alreadyCurrent, enriched, imported, totalFound,
          nextPage: page,
        });
        cancelFlags.delete(jobId);
        return;
      }

      // Batch guard: don't burn the full hourly budget in one run. Let the
      // resumer pick us up after a short pause so other orgs' jobs can run too,
      // and so we don't sail into an hourly 429 mid-page.
      if (pagesThisBatch >= PAGES_PER_BATCH) {
        const resumeAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await updateJob(jobId, {
          status: 'paused_rate_limited',
          processed, alreadyCurrent, enriched, imported, totalFound,
          nextPage: page,
          resumeAfter: resumeAt,
          errorMessage: `Batched — ${pagesThisBatch} pages processed, resuming automatically`,
        });
        console.log('[apollo-sync] batched, will resume', { jobId, nextPage: page, resumeAt });
        return;
      }

      let people: any[]; let total: number;
      try {
        const res = await searchPeopleInLabels(apiKey, listIds, page, DEFAULT_PAGE_SIZE);
        people = res.people; total = res.total;
      } catch (e: any) {
        const { isHourly, isMinute } = isRateLimitError(e?.message || '');
        if (isHourly || isMinute) {
          // Pause and let the resumer retry after the appropriate cooldown.
          const cooldownMs = isHourly ? HOURLY_COOLDOWN_MS : 2 * 60 * 1000;
          const resumeAt = new Date(Date.now() + cooldownMs).toISOString();
          await updateJob(jobId, {
            status: 'paused_rate_limited',
            processed, alreadyCurrent, enriched, imported, totalFound,
            nextPage: page,
            resumeAfter: resumeAt,
            errorMessage: `Apollo rate limit — will auto-resume after ${new Date(resumeAt).toLocaleString()}`,
          });
          console.log('[apollo-sync] rate-limited, pausing', { jobId, nextPage: page, resumeAt });
          return;
        }
        throw e;
      }

      pagesThisBatch++;

      if (page === 1) {
        // Guard against bogus total from Apollo api_search (seen values like 241M).
        // Saved lists cannot realistically exceed 1M; beyond that, treat as unknown.
        totalFound = total > 1_000_000 ? 0 : total;
        await updateJob(jobId, { totalFound });
      }
      if (!people.length) break;

      for (const p of people) {
        const email = getPrimaryEmail(p);
        if (!email) { processed++; continue; }
        try {
          const result = await reconcileContact({
            organizationId, email, apolloPerson: p, targetListId, overwriteMode,
          });
          if (result === 'skipped') alreadyCurrent++;
          else if (result === 'enriched') enriched++;
          else if (result === 'imported') imported++;
        } catch (e) {
          console.error('[apollo-sync] reconcile error for', email, e);
        }
        processed++;
      }

      await updateJob(jobId, { processed, alreadyCurrent, enriched, imported, nextPage: page + 1 });

      // Stop conditions (only trust totalFound if we kept a reasonable value).
      if (totalFound > 0 && processed >= totalFound) break;
      if (people.length < DEFAULT_PAGE_SIZE) break;
      page++;
    }

    await updateJob(jobId, {
      status: 'completed',
      completedAt: nowIso(),
      processed, alreadyCurrent, enriched, imported, totalFound,
      nextPage: page,
      errorMessage: null,
    });

    await logUsage({
      organizationId,
      userId: job.triggeredBy,
      action: 'sync',
      creditsUsed: 0,
      contactsAffected: enriched + imported,
      metadata: { listIds, alreadyCurrent, enriched, imported, totalFound },
    });
  } catch (e: any) {
    await updateJob(jobId, {
      status: 'failed',
      errorMessage: (e?.message || 'Unknown error').slice(0, 500),
      completedAt: nowIso(),
      processed, alreadyCurrent, enriched, imported, totalFound,
      nextPage: page,
    });
  }
}

// --- Auto-resumer for paused_rate_limited jobs ---
let resumerStarted = false;
export function startApolloSyncResumer() {
  if (resumerStarted) return;
  resumerStarted = true;
  const TICK_MS = 2 * 60 * 1000; // check every 2 minutes
  const tick = async () => {
    try {
      const due = await storage.rawAll(
        `SELECT id FROM apollo_sync_jobs
         WHERE status = 'paused_rate_limited'
           AND ("resumeAfter" IS NULL OR "resumeAfter" <= ?)
         ORDER BY "createdAt" ASC
         LIMIT 5`,
        nowIso(),
      );
      for (const row of due) {
        console.log('[apollo-sync] resuming job', row.id);
        setImmediate(() => runSyncJob(row.id).catch((e) => {
          console.error('[apollo-sync] resume crash', row.id, e);
        }));
      }
    } catch (e) {
      console.error('[apollo-sync] resumer tick error', e);
    }
  };
  setInterval(tick, TICK_MS);
  // Kick once shortly after boot to pick up anything that got paused pre-restart.
  setTimeout(tick, 30_000);
}

export async function reconcileContact(params: {
  organizationId: string;
  email: string;
  apolloPerson: any;
  targetListId: string | null;
  overwriteMode: 'fill_blanks_only' | 'apollo_wins';
}): Promise<'skipped' | 'enriched' | 'imported'> {
  const { organizationId, email, apolloPerson, targetListId, overwriteMode } = params;
  const apolloFields = apolloToContact(apolloPerson);
  const apolloId = String(apolloPerson.id || apolloPerson._id || '');

  const existing = await storage.getContactByEmail(organizationId, email);

  if (!existing) {
    // Import new contact via raw SQL (so we can set Apollo tracking columns).
    const id = genId();
    const ts = nowIso();
    await storage.rawRun(
      `INSERT INTO contacts (id, "organizationId", email, "firstName", "lastName", company, "jobTitle",
        phone, "mobilePhone", "linkedinUrl", seniority, department, city, state, country, website, industry,
        "employeeCount", "annualRevenue", "companyLinkedinUrl", "companyCity", "companyState", "companyCountry",
        "companyPhone", status, score, tags, "customFields", source, "listId", "assignedTo",
        "apolloContactId", "apolloLastSyncedAt", "apolloListIds", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      organizationId,
      email,
      apolloFields.firstName,
      apolloFields.lastName,
      apolloFields.company,
      apolloFields.jobTitle,
      apolloFields.phone,
      apolloFields.mobilePhone,
      apolloFields.linkedinUrl,
      apolloFields.seniority,
      apolloFields.department,
      apolloFields.city,
      apolloFields.state,
      apolloFields.country,
      apolloFields.website,
      apolloFields.industry,
      apolloFields.employeeCount,
      apolloFields.annualRevenue,
      apolloFields.companyLinkedinUrl,
      apolloFields.companyCity,
      apolloFields.companyState,
      apolloFields.companyCountry,
      apolloFields.companyPhone,
      'cold',
      0,
      JSON.stringify([]),
      JSON.stringify({}),
      'apollo',
      targetListId,
      null,
      apolloId || null,
      nowIso(),
      JSON.stringify(
        (apolloPerson.label_ids || apolloPerson.labels || []).map((l: any) =>
          typeof l === 'string' ? l : l.id,
        ),
      ),
      ts,
      ts,
    );
    return 'imported';
  }

  // Existing contact — decide what to update.
  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(apolloFields)) {
    if (!v) continue;
    const current = existing[k];
    const isBlank = !current || String(current).trim() === '';
    if (overwriteMode === 'apollo_wins' || isBlank) {
      if (String(current || '') !== String(v)) {
        updates[k] = v;
      }
    }
  }

  // Always refresh apollo tracking columns.
  if (apolloId && existing.apolloContactId !== apolloId) {
    updates.apolloContactId = apolloId;
  }

  if (Object.keys(updates).length === 0) {
    // Still bump lastSyncedAt so user sees it was reviewed.
    await storage.rawRun(
      `UPDATE contacts SET "apolloLastSyncedAt" = ? WHERE id = ?`,
      nowIso(),
      existing.id,
    );
    return 'skipped';
  }

  const keys = Object.keys(updates);
  const quotedKeys = keys.map((k) => `"${k}" = ?`).join(', ');
  const values = keys.map((k) => updates[k]);
  await storage.rawRun(
    `UPDATE contacts SET ${quotedKeys}, "apolloLastSyncedAt" = ?, "updatedAt" = ? WHERE id = ?`,
    ...values,
    nowIso(),
    nowIso(),
    existing.id,
  );
  return 'enriched';
}
