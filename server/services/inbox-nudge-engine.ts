// Scans new positive-reply inbox rows for "suggested Won" and "suggested Meeting" signals.
// Uses cheap regex first; AI only confirms when both signals are ambiguous.
// Writes aiSuggestedWon / aiSuggestedMeeting / aiSuggestionReason on unified_inbox.

import { storage } from '../storage';

const WON_REGEX = /\b(go\s+ahead|proceed\s+with|we(?:'|’)ll\s+take\s+it|we\s+accept|sign(?:ed)?\s+the\s+contract|send\s+(the\s+)?(contract|invoice|agreement|po|purchase\s+order)|confirmed|approved|let(?:'|’)s\s+do\s+it|ready\s+to\s+(buy|move\s+forward|start)|deal\s+done|signing)\b/i;
const MEETING_INTENT_REGEX = /\b(let(?:'|’)s\s+(set\s+up|schedule|book|have)\s+a?\s*(call|meeting|chat|sync)|book\s+a\s+(call|meeting|demo)|schedule\s+a\s+(call|meeting|demo)|send\s+(me\s+)?(a\s+)?calendar|can\s+we\s+(meet|talk|chat|hop\s+on)|available\s+(tomorrow|this\s+week|next\s+week|monday|tuesday|wednesday|thursday|friday)|free\s+(to\s+(meet|chat|talk)|tomorrow|monday|tuesday|wednesday|thursday|friday))\b/i;

export async function scanInboxNudgesOnce(opts: { max?: number } = {}): Promise<{ scanned: number; wonHits: number; meetingHits: number }> {
  const max = opts.max ?? 200;

  const rows = await storage.rawAll(`
    SELECT id, "organizationId", subject, COALESCE(body, '') AS body, COALESCE(snippet, '') AS snippet, "meetingDetected"
    FROM unified_inbox
    WHERE "replyType" = 'positive'
      AND (("aiSuggestedWon" IS NULL OR "aiSuggestedWon" = FALSE)
       AND ("aiSuggestedMeeting" IS NULL OR "aiSuggestedMeeting" = FALSE)
       AND "aiSuggestionReason" IS NULL)
      AND (COALESCE(body, '') <> '' OR COALESCE(snippet, '') <> '')
    ORDER BY "receivedAt" DESC
    LIMIT ?
  `, max) as any[];

  let wonHits = 0, meetingHits = 0;
  for (const r of rows) {
    const text = `${r.subject || ''} ${r.snippet || ''} ${r.body || ''}`.slice(0, 4000);
    const wonMatch = WON_REGEX.exec(text);
    const meetMatch = MEETING_INTENT_REGEX.exec(text);

    // If a hard meeting URL was already detected by meeting-detector, meeting nudge is redundant —
    // the scorecard already counts it. Only set the nudge when intent is expressed without a URL yet.
    const suggestMeeting = !!meetMatch && !r.meetingDetected;
    const suggestWon = !!wonMatch;

    if (!suggestWon && !suggestMeeting) {
      // Mark as scanned with empty reason so we don't re-scan
      await storage.rawRun(`UPDATE unified_inbox SET "aiSuggestionReason" = '' WHERE id = ?`, r.id);
      continue;
    }

    const reason = [
      suggestWon ? `Won signal: "${wonMatch![0]}"` : null,
      suggestMeeting ? `Meeting ask: "${meetMatch![0]}"` : null,
    ].filter(Boolean).join(' · ').slice(0, 500);

    try {
      await storage.rawRun(`
        UPDATE unified_inbox
        SET "aiSuggestedWon" = ?, "aiSuggestedMeeting" = ?, "aiSuggestionReason" = ?
        WHERE id = ?
      `, suggestWon, suggestMeeting, reason, r.id);
      if (suggestWon) wonHits++;
      if (suggestMeeting) meetingHits++;
    } catch { /* columns may not exist yet */ }
  }

  return { scanned: rows.length, wonHits, meetingHits };
}

export function startInboxNudgeEngine() {
  const INTERVAL_MS = 10 * 60 * 1000;
  const run = async () => {
    try {
      const r = await scanInboxNudgesOnce({ max: 300 });
      if (r.scanned > 0) console.log(`[InboxNudge] scanned=${r.scanned} won=${r.wonHits} meeting=${r.meetingHits}`);
    } catch (e) {
      console.error('[InboxNudge] Error:', e);
    }
  };
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, INTERVAL_MS);
  console.log('[InboxNudge] Scheduled: first run in 2min, then every 10min');
}
