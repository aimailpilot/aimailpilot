import { storage } from "../storage";

/**
 * Email Rating Engine
 * Calculates a 0-100 engagement rating for each contact based on:
 * - Email delivery & open behavior
 * - Click engagement
 * - Reply frequency & quality (AI-scored if Azure OpenAI configured)
 * - Bounce/unsubscribe penalties
 * - Recency bonus
 */

interface RatingDetails {
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  sentScore: number;
  openScore: number;
  clickScore: number;
  replyScore: number;
  replyQualityScore: number;
  replyQualityLabel: string;
  bouncePenalty: number;
  unsubPenalty: number;
  recencyBonus: number;
  totalScore: number;
  grade: string;
  lastActivity: string | null;
}

function calculateGrade(score: number): string {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B+';
  if (score >= 55) return 'B';
  if (score >= 45) return 'C+';
  if (score >= 35) return 'C';
  if (score >= 25) return 'D';
  if (score >= 10) return 'E';
  return 'F';
}

export async function calculateContactRating(
  contactId: string,
  options?: { useAI?: boolean; organizationId?: string }
): Promise<{ rating: number; grade: string; details: RatingDetails }> {
  const contact = await storage.getContact(contactId);
  if (!contact) throw new Error('Contact not found');

  const stats = await storage.getContactEngagementStats(contactId);

  // Base scoring
  const totalSent = stats.totalSent || 0;
  const totalOpened = stats.totalOpened || 0;
  const totalClicked = stats.totalClicked || 0;
  const totalReplied = stats.totalReplied || 0;

  const openRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0;
  const clickRate = totalSent > 0 ? (totalClicked / totalSent) * 100 : 0;
  const replyRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;

  // Scoring weights (max 100)
  // Sent score: 0-10 (shows the contact is being engaged)
  const sentScore = totalSent > 0 ? Math.min(10, Math.round(totalSent * 2)) : 0;

  // Open score: 0-25 (based on open rate)
  const openScore = totalSent > 0 ? Math.min(25, Math.round(openRate * 0.25)) : 0;

  // Click score: 0-25 (based on click rate - clicks are high value)
  const clickScore = totalSent > 0 ? Math.min(25, Math.round(clickRate * 0.5)) : 0;

  // Reply score: 0-30 (based on reply count and rate)
  const replyScore = totalReplied > 0 
    ? Math.min(30, Math.round(totalReplied * 10 + replyRate * 0.2))
    : 0;

  // AI reply quality scoring
  let replyQualityScore = 0;
  let replyQualityLabel = 'N/A';

  if (options?.useAI && totalReplied > 0 && options.organizationId) {
    try {
      const aiResult = await scoreReplyQualityWithAI(contactId, options.organizationId);
      replyQualityScore = aiResult.score;
      replyQualityLabel = aiResult.label;
    } catch (e) {
      console.error('[EmailRating] AI scoring failed:', e);
      replyQualityLabel = 'AI Error';
    }
  }

  // Penalties
  const bouncePenalty = (contact as any).status === 'bounced' ? -30 : 0;
  const unsubPenalty = (contact as any).status === 'unsubscribed' ? -50 : 0;

  // Recency bonus: +10 if any activity in last 7 days
  let recencyBonus = 0;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const lastActivity = stats.lastRepliedAt || stats.lastClickedAt || stats.lastOpenedAt || stats.lastSentAt;
  if (lastActivity && lastActivity > sevenDaysAgo) {
    recencyBonus = 10;
  }

  // Total score capped at 0-100
  const rawTotal = sentScore + openScore + clickScore + replyScore + replyQualityScore + bouncePenalty + unsubPenalty + recencyBonus;
  const totalScore = Math.max(0, Math.min(100, rawTotal));
  const grade = calculateGrade(totalScore);

  const details: RatingDetails = {
    totalSent, totalOpened, totalClicked, totalReplied,
    openRate: Math.round(openRate * 10) / 10,
    clickRate: Math.round(clickRate * 10) / 10,
    replyRate: Math.round(replyRate * 10) / 10,
    sentScore, openScore, clickScore, replyScore,
    replyQualityScore, replyQualityLabel,
    bouncePenalty, unsubPenalty, recencyBonus,
    totalScore, grade,
    lastActivity,
  };

  // Save to database
  await storage.updateContactEmailRating(contactId, totalScore, grade, details);

  return { rating: totalScore, grade, details };
}

async function scoreReplyQualityWithAI(
  contactId: string,
  organizationId: string
): Promise<{ score: number; label: string }> {
  const settings = await storage.getApiSettingsWithAzureFallback(organizationId);
  const endpoint = settings.azure_openai_endpoint;
  const apiKey = settings.azure_openai_api_key;
  const deploymentName = settings.azure_openai_deployment;
  const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

  if (!endpoint || !apiKey || !deploymentName) {
    return { score: 0, label: 'Not configured' };
  }

  // Get reply content
  const { replies, replyEvents } = await storage.getContactReplyContent(contactId);

  // Build content for AI analysis
  let replyTexts: string[] = [];
  for (const r of replies) {
    const text = r.snippet || r.body?.substring(0, 500) || '';
    if (text.trim()) replyTexts.push(`Subject: ${r.subject || 'N/A'}\nContent: ${text}`);
  }
  for (const evt of replyEvents) {
    const meta = evt.metadata;
    if (meta?.replyContent) replyTexts.push(`Reply: ${meta.replyContent}`);
    if (meta?.snippet) replyTexts.push(`Reply snippet: ${meta.snippet}`);
  }

  if (replyTexts.length === 0) {
    return { score: 5, label: 'Replied (no content)' };
  }

  const prompt = `Analyze the quality of these email reply(s) from a lead/prospect. Rate the engagement quality.

Replies:
${replyTexts.slice(0, 5).join('\n\n---\n')}

Score the reply quality from 0-10 based on:
- Positive intent (interested, wants to learn more, accepts invitation) = 8-10
- Neutral/informational (asks questions, requests details) = 5-7
- Polite decline / not interested = 2-4
- Negative / spam / unsubscribe request = 0-1
- Auto-reply / out of office = 1-2

Respond with ONLY a JSON object: {"score": <0-10>, "label": "<one word: Excellent|Good|Interested|Neutral|Lukewarm|Declined|Negative>"}`;

  try {
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an email engagement analyst. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      console.error('[EmailRating] Azure OpenAI error:', response.status);
      return { score: 5, label: 'AI Error' };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const aiScore = Math.min(10, Math.max(0, parseInt(result.score) || 0));
      return { score: aiScore, label: result.label || 'Scored' };
    }
  } catch (e) {
    console.error('[EmailRating] AI scoring error:', e);
  }

  return { score: 5, label: 'AI Error' };
}

/**
 * Batch recalculate ratings for all contacts in an organization
 */
export async function batchRecalculateRatings(
  organizationId: string,
  options?: { useAI?: boolean }
): Promise<{ processed: number; errors: number }> {
  const contacts = await storage.getContacts(organizationId, 10000);
  let processed = 0;
  let errors = 0;

  for (const contact of contacts) {
    try {
      await calculateContactRating(contact.id, { 
        useAI: options?.useAI, 
        organizationId 
      });
      processed++;
    } catch (e) {
      errors++;
      console.error(`[EmailRating] Failed for ${contact.email}:`, e);
    }
  }

  return { processed, errors };
}
