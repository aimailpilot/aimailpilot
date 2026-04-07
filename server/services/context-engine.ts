/**
 * Context Engine — Assembles organizational knowledge for AI-powered actions
 *
 * Pulls context from:
 * - org_documents (uploaded files, Google Docs, case studies, proposals)
 * - email_history (past email conversations with a contact)
 * - lead_opportunities (AI classification from lead intelligence scan)
 * - contacts (pipeline stage, engagement stats, activity notes)
 * - campaign_messages (campaign engagement: opens, clicks, replies)
 * - contact_activities (call logs, meeting notes, remarks)
 *
 * Powers:
 * - Smart email reply drafting with full org context
 * - Proposal generation with relevant case studies
 * - Campaign lead finding with scoring signals
 */

import { storage } from '../storage.js';

// ============ TYPES ============

interface ContactContext {
  contact: any;
  emailHistory: any[];
  leadOpportunity: any | null;
  campaignEngagement: { totalSent: number; totalOpened: number; totalClicked: number; totalReplied: number; totalBounced: number };
  activities: any[];
  lastRemark: string;
}

interface OrgContext {
  documents: any[];
  totalDocs: number;
}

interface FullContext {
  contact: ContactContext | null;
  org: OrgContext;
  relevantDocs: any[];
}

// ============ CONTEXT ASSEMBLY ============

/**
 * Build full context for a contact — everything we know about them
 */
export async function getContactContext(orgId: string, contactId?: string, contactEmail?: string): Promise<ContactContext | null> {
  let contact: any = null;
  if (contactId) {
    contact = await storage.getContact(contactId);
  }
  if (!contact && contactEmail) {
    contact = await storage.getContactByEmail(orgId, contactEmail);
  }
  if (!contact) return null;

  const email = contact.email?.toLowerCase();

  // Email history with this contact (last 20 emails)
  let emailHistory: any[] = [];
  try {
    emailHistory = await storage.rawAll(`
      SELECT subject, snippet, direction, receivedAt, fromEmail, toEmail
      FROM email_history
      WHERE organizationId = ? AND (LOWER(fromEmail) = ? OR LOWER(toEmail) = ?)
      ORDER BY receivedAt DESC LIMIT 20
    `, orgId, email, email);
  } catch { /* email_history table may not exist */ }

  // Lead intelligence classification
  let leadOpportunity: any = null;
  try {
    leadOpportunity = await storage.rawGet(`
      SELECT bucket, confidence, aiReasoning, suggestedAction, lastEmailDate, totalEmails, totalReceived
      FROM lead_opportunities
      WHERE organizationId = ? AND LOWER(contactEmail) = ?
      ORDER BY confidence DESC LIMIT 1
    `, orgId, email);
  } catch { /* lead_opportunities table may not exist */ }

  // Campaign engagement stats
  let campaignEngagement = { totalSent: 0, totalOpened: 0, totalClicked: 0, totalReplied: 0, totalBounced: 0 };
  try {
    const stats = await storage.rawGet(`
      SELECT
        COUNT(*) as totalSent,
        SUM(CASE WHEN openedAt IS NOT NULL THEN 1 ELSE 0 END) as totalOpened,
        SUM(CASE WHEN clickedAt IS NOT NULL THEN 1 ELSE 0 END) as totalClicked,
        SUM(CASE WHEN repliedAt IS NOT NULL THEN 1 ELSE 0 END) as totalReplied,
        SUM(CASE WHEN bouncedAt IS NOT NULL THEN 1 ELSE 0 END) as totalBounced
      FROM messages WHERE contactId = ? AND status = 'sent'
    `, contact.id) as any;
    if (stats) campaignEngagement = stats;
  } catch {}

  // Activity notes (last 10)
  let activities: any[] = [];
  try {
    activities = await storage.rawAll(`
      SELECT type, outcome, notes, createdAt FROM contact_activities
      WHERE contactId = ? ORDER BY createdAt DESC LIMIT 10
    `, contact.id);
  } catch {
    try {
      activities = await storage.rawAll(`
        SELECT type, outcome, notes, createdAt FROM contact_activity
        WHERE contactId = ? ORDER BY createdAt DESC LIMIT 10
      `, contact.id);
    } catch {}
  }

  // Last remark
  let lastRemark = '';
  try {
    const remark = await storage.rawGet(`SELECT notes FROM contact_activities WHERE contactId = ? ORDER BY id DESC LIMIT 1`, contact.id) as any;
    lastRemark = remark?.notes || '';
  } catch {}

  return {
    contact,
    emailHistory,
    leadOpportunity,
    campaignEngagement,
    activities,
    lastRemark,
  };
}

/**
 * Get relevant org documents — search by tags, doc type, or free text
 */
export async function getRelevantDocuments(orgId: string, query: string, docTypes?: string[], limit = 10): Promise<any[]> {
  // Try full-text search first
  let docs = await storage.searchOrgDocuments(orgId, query, limit);

  // If FTS returned nothing, try tag-based matching
  if (docs.length === 0 && docTypes && docTypes.length > 0) {
    const allDocs = await storage.getOrgDocuments(orgId, {}, 100, 0) as any[];
    docs = allDocs.filter((d: any) => {
      if (docTypes.includes(d.docType)) return true;
      const tags = typeof d.tags === 'string' ? JSON.parse(d.tags) : (d.tags || []);
      return tags.some((t: string) => query.toLowerCase().includes(t.toLowerCase()));
    }).slice(0, limit);
  }

  return docs;
}

/**
 * Assemble full context for an AI action
 */
export async function assembleContext(
  orgId: string,
  options: {
    contactId?: string;
    contactEmail?: string;
    query?: string; // For document search relevance
    docTypes?: string[]; // Filter doc types: 'case_study', 'proposal', 'brochure', etc.
    maxDocTokens?: number; // Approx token limit for doc content
  }
): Promise<FullContext> {
  const maxDocTokens = options.maxDocTokens || 8000; // ~8K tokens for docs

  // 1. Contact context
  const contactCtx = await getContactContext(orgId, options.contactId, options.contactEmail);

  // 2. Relevant documents
  const searchQuery = options.query ||
    (contactCtx?.contact?.company || '') + ' ' +
    (contactCtx?.contact?.industry || '') + ' ' +
    (contactCtx?.leadOpportunity?.bucket || '');

  let relevantDocs: any[] = [];
  if (searchQuery.trim()) {
    relevantDocs = await getRelevantDocuments(orgId, searchQuery.trim(), options.docTypes, 10);
  } else {
    // No search context — get most recent docs
    relevantDocs = await storage.getOrgDocuments(orgId, {}, 10, 0) as any[];
  }

  // Trim doc content to stay within token budget (rough: 4 chars ≈ 1 token)
  const maxChars = maxDocTokens * 4;
  let totalChars = 0;
  const trimmedDocs = [];
  for (const doc of relevantDocs) {
    const content = doc.content || '';
    const remaining = maxChars - totalChars;
    if (remaining <= 0) break;
    trimmedDocs.push({
      ...doc,
      content: content.substring(0, remaining),
      truncated: content.length > remaining,
    });
    totalChars += Math.min(content.length, remaining);
  }

  // 3. Org document summary
  const totalDocs = await storage.getOrgDocumentsCount(orgId);

  return {
    contact: contactCtx,
    org: { documents: trimmedDocs, totalDocs },
    relevantDocs: trimmedDocs,
  };
}

// ============ PROMPT BUILDERS ============

/**
 * Build a context block to inject into any LLM prompt
 */
export function buildContextPrompt(ctx: FullContext): string {
  const parts: string[] = [];

  // Contact section
  if (ctx.contact) {
    const c = ctx.contact.contact;
    parts.push(`=== CONTACT INFORMATION ===`);
    parts.push(`Name: ${c.firstName || ''} ${c.lastName || ''}`);
    parts.push(`Email: ${c.email}`);
    if (c.company) parts.push(`Company: ${c.company}`);
    if (c.jobTitle) parts.push(`Role: ${c.jobTitle}`);
    if (c.industry) parts.push(`Industry: ${c.industry}`);
    if (c.city || c.country) parts.push(`Location: ${[c.city, c.country].filter(Boolean).join(', ')}`);
    if (c.pipelineStage) parts.push(`Pipeline Stage: ${c.pipelineStage}`);

    // AI classification
    if (ctx.contact.leadOpportunity) {
      const lo = ctx.contact.leadOpportunity;
      parts.push(`\nAI Lead Classification: ${lo.bucket} (${lo.confidence}% confidence)`);
      if (lo.aiReasoning) parts.push(`AI Reasoning: ${lo.aiReasoning}`);
      if (lo.suggestedAction) parts.push(`Suggested Action: ${lo.suggestedAction}`);
    }

    // Engagement stats
    const eng = ctx.contact.campaignEngagement;
    if (eng.totalSent > 0) {
      parts.push(`\nCampaign Engagement: ${eng.totalSent} emails sent, ${eng.totalOpened} opened, ${eng.totalClicked} clicked, ${eng.totalReplied} replied`);
    }

    // Email history
    if (ctx.contact.emailHistory.length > 0) {
      parts.push(`\n=== RECENT EMAIL HISTORY (${ctx.contact.emailHistory.length} emails) ===`);
      for (const email of ctx.contact.emailHistory.slice(0, 10)) {
        const dir = email.direction === 'received' ? '← Received' : '→ Sent';
        parts.push(`[${dir}] ${email.receivedAt} — Subject: ${email.subject || '(no subject)'}`);
        if (email.snippet) parts.push(`  ${email.snippet.substring(0, 200)}`);
      }
    }

    // Activity notes
    if (ctx.contact.activities.length > 0) {
      parts.push(`\n=== ACTIVITY LOG ===`);
      for (const act of ctx.contact.activities.slice(0, 5)) {
        parts.push(`[${act.type}] ${act.createdAt} — ${act.outcome || ''} ${act.notes || ''}`);
      }
    }
  }

  // Organization documents
  if (ctx.relevantDocs.length > 0) {
    parts.push(`\n=== RELEVANT ORGANIZATION DOCUMENTS ===`);
    for (const doc of ctx.relevantDocs) {
      parts.push(`\n--- ${doc.name} (${doc.docType}) ---`);
      if (doc.summary) parts.push(`Summary: ${doc.summary}`);
      if (doc.content) {
        parts.push(doc.content);
        if (doc.truncated) parts.push('... [content truncated]');
      }
    }
  }

  return parts.join('\n');
}

/**
 * Build a complete system prompt for drafting a reply with context
 */
export function buildReplyDraftPrompt(ctx: FullContext, tone: string = 'professional'): string {
  const toneMap: Record<string, string> = {
    professional: 'Write in a professional, business-appropriate tone.',
    friendly: 'Write in a warm, friendly, and approachable tone.',
    concise: 'Be very brief and concise. Get straight to the point.',
    formal: 'Use formal business language appropriate for executives.',
    persuasive: 'Write persuasively, highlighting value propositions and benefits.',
  };

  return `You are an expert email assistant with full access to the organization's knowledge base and contact history.

${toneMap[tone] || toneMap.professional}

IMPORTANT RULES:
- Use the provided context to personalize the reply (mention specific details, past interactions, relevant case studies).
- If you have information about the contact's company, role, or past engagement, reference it naturally.
- If relevant org documents contain case studies or testimonials, weave them in as social proof.
- Do NOT make up facts. Only reference information from the provided context.
- Keep the reply concise (2-4 paragraphs max).
- Do NOT include a subject line, only the body.
- Do NOT use markdown — write in plain text or simple HTML.
- Use proper greeting and sign-off.

${buildContextPrompt(ctx)}`;
}

/**
 * Build a system prompt for proposal generation
 */
export function buildProposalPrompt(ctx: FullContext): string {
  return `You are an expert business proposal writer with full access to the organization's knowledge base, case studies, and contact history.

IMPORTANT RULES:
- Create a compelling, personalized proposal tailored to the contact's specific needs.
- Reference relevant case studies, past wins, and testimonials from the provided org documents.
- Address the contact's known pain points based on email history and AI classification.
- Structure the proposal clearly: Executive Summary, Understanding of Needs, Our Solution, Case Studies/Social Proof, Pricing Framework, Next Steps.
- Use professional language and be specific — avoid generic filler.
- Do NOT make up facts. Only reference information from the provided context.

${buildContextPrompt(ctx)}`;
}

/**
 * Build a prompt for finding similar leads for campaigns
 */
export function buildLeadFinderPrompt(ctx: FullContext, criteria: string): string {
  return `You are a sales intelligence analyst. Based on the provided organization context and lead data, identify and score potential leads.

CRITERIA: ${criteria}

RULES:
- Analyze the contact data, email history, and AI classifications to identify the best matches.
- Score each lead 0-100 based on fit to the criteria.
- Explain WHY each lead is a good match using specific data points.
- Prioritize leads with: recent engagement, matching industry/role, warm AI classification.
- Do NOT make up data. Only use information from the provided context.

${buildContextPrompt(ctx)}`;
}

// ============ DOCUMENT TEXT EXTRACTION ============

/**
 * Extract plain text from various file formats
 * For Phase 1: handles plain text, CSV, HTML
 * PDF/DOCX will need npm packages (pdf-parse, mammoth) in a future phase
 */
export function extractText(content: string, mimeType: string): string {
  if (!content) return '';

  // Plain text / CSV / Markdown
  if (mimeType.includes('text/') || mimeType.includes('csv') || mimeType.includes('markdown')) {
    return content;
  }

  // HTML — strip tags
  if (mimeType.includes('html')) {
    return content
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // JSON — pretty print
  if (mimeType.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }

  // Default: return as-is (PDF/DOCX binary will need special handling)
  return content;
}

/**
 * Generate a summary of document content using Azure OpenAI
 */
export async function generateDocumentSummary(orgId: string, content: string, docName: string): Promise<string> {
  const settings = await storage.getApiSettingsWithAzureFallback(orgId);
  const endpoint = settings.azure_openai_endpoint;
  const apiKey = settings.azure_openai_api_key;
  const deploymentName = settings.azure_openai_deployment;
  const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

  if (!endpoint || !apiKey || !deploymentName) {
    // No AI available — generate a simple summary
    const preview = content.substring(0, 500).replace(/\s+/g, ' ').trim();
    return preview ? `${preview}...` : '';
  }

  try {
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a concise document summarizer. Create a 2-3 sentence summary of the document that captures the key points, value propositions, and any specific results/numbers mentioned. The summary will be used to match this document to relevant sales contexts.' },
          { role: 'user', content: `Document: "${docName}"\n\nContent:\n${content.substring(0, 6000)}` }
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
    });

    if (response.ok) {
      const data = await response.json() as any;
      return data.choices?.[0]?.message?.content || '';
    }
  } catch (e) {
    console.error('[ContextEngine] Summary generation error:', e);
  }

  // Fallback
  return content.substring(0, 300).replace(/\s+/g, ' ').trim() + '...';
}
