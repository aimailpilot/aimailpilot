/**
 * Reply Classification Engine
 * Auto-classifies incoming replies into: positive, negative, ooo, auto_reply, general, bounce, unsubscribe
 */

// Keywords/patterns for classification
const OOO_PATTERNS = [
  /out of (the )?office/i,
  /on vacation/i,
  /on (annual |sick |parental |maternity |paternity )?leave/i,
  /away from (my |the )?desk/i,
  /currently unavailable/i,
  /auto.?reply/i,
  /automatische antwort/i, // German
  /absence du bureau/i, // French
  /fuera de la oficina/i, // Spanish
  /limited access to (my )?email/i,
  /will be back/i,
  /return(ing)? on/i,
  /away until/i,
  /not in the office/i,
  /i('m| am) (out|away|travelling|traveling|on holiday)/i,
  /currently out/i,
  /back on/i,
  /will respond (when|upon|once|after)/i,
  /thank you for (your )?email.*will (get back|respond|reply)/i,
  /i will be (out|away|unavailable)/i,
  /out of office until/i,
  /on a business trip/i,
  /attending.*conference/i,
  /limited email access/i,
];

const AUTO_REPLY_PATTERNS = [
  /this is an auto(matic|mated)?\s?(reply|response|message)/i,
  /auto.?generated/i,
  /do not reply to this (email|message|address)/i,
  /this mailbox is not monitored/i,
  /noreply@/i,
  /no-reply@/i,
  /donotreply@/i,
  /automated notification/i,
  /this is a system (message|generated|notification)/i,
  /automatic(ally)? (reply|generated|sent)/i,
  /this email was sent (automatically|by an automated)/i,
  /please do not respond (to|directly)/i,
  /sent from (a |an )?(automated|unmonitored|no-reply)/i,
  /ticketing system/i,
  /support ticket (has been|was) (created|opened|received)/i,
  /your (request|inquiry|ticket) (has been|was) received/i,
  /we('ve| have) received your (email|message|inquiry|request)/i,
  /our team will (get back|respond|reply|be in touch)/i,
  /thank you for contacting us.*we will/i,
  /this is an automated (confirmation|acknowledgement|response)/i,
  /helpdesk|help desk/i,
  /crm (notification|alert)/i,
  /notification@|alerts@|system@|support@.*auto/i,
];

const POSITIVE_PATTERNS = [
  /interested/i,
  /love to (learn|hear|know|chat|discuss|talk|meet|connect|explore|see)/i,
  /would like to (learn|hear|know|chat|discuss|talk|meet|connect|schedule|explore)/i,
  /sounds (great|good|interesting|perfect|like a plan)/i,
  /tell me more/i,
  /let'?s (schedule|set up|book|arrange|plan|connect|talk|meet|chat)/i,
  /can we (meet|talk|chat|schedule|connect|hop on|jump on|get on)/i,
  /when are you (free|available)/i,
  /send (me |us )?(more )?(info|details|information|brochure|proposal)/i,
  /looking forward/i,
  /yes,? (please|i'?d|that|we|let|sure|absolutely|definitely)/i,
  /absolutely/i,
  /great,? (let'?s|when|sounds|i'?d)/i,
  /perfect,? (let'?s|when|sounds)/i,
  /count me in/i,
  /sign me up/i,
  /i'?m in/i,
  /how (much|does it cost|do we get started|do i|can we)/i,
  /can you (send|share|provide|give|email)/i,
  /what'?s the (next step|pricing|cost|price|fee)/i,
  /free (for|on|this|next) (a call|monday|tuesday|wednesday|thursday|friday|week|afternoon|morning)/i,
  /happy to (chat|connect|discuss|meet|talk|explore|learn)/i,
  /open to (discussing|exploring|learning|a call|meeting)/i,
  /this (looks|sounds|seems) (good|great|interesting|promising|relevant)/i,
  /would love (to|a)/i,
  /i'd (love|like) to/i,
  /definitely (interested|want|would)/i,
  /please (share|send|provide|tell me)/i,
  /book (a call|a demo|a meeting|time)/i,
  /schedule (a call|a demo|a meeting|time)/i,
  /demo|trial|pilot/i,
  /what (is|are) (your|the) (price|pricing|cost|rate|fee)/i,
];

const NEGATIVE_PATTERNS = [
  /not interested/i,
  /no thank(s| you)/i,
  /please (remove|unsubscribe|stop|don'?t)/i,
  /remove (me|my email|us) from/i,
  /take me off/i,
  /don'?t (contact|email|send|reach out|message)/i,
  /stop (emailing|sending|contacting|messaging)/i,
  /not (the right|a good) (fit|time|person|match)/i,
  /we'?re not (looking|interested|in the market)/i,
  /wrong person/i,
  /not relevant/i,
  /not for (us|me)/i,
  /unsubscribe/i,
  /opt.?out/i,
  /leave me alone/i,
  /go away/i,
  /spam/i,
  /reported as spam/i,
  /this is (spam|unsolicited)/i,
  /not (currently |at the moment |at this time )?(looking|interested|in need)/i,
  /already (have|using|working with) (a|an|our|another)/i,
  /budget (is|has been) (cut|frozen|reduced|eliminated)/i,
  /no (budget|capacity|need|requirement)/i,
  /not a priority/i,
  /cannot (afford|proceed|continue)/i,
];

const BOUNCE_PATTERNS = [
  /delivery (status notification|failure|failed)/i,
  /undeliverable/i,
  /undelivered mail/i,
  /mail delivery (failed|subsystem)/i,
  /failure notice/i,
  /returned mail/i,
  /message not delivered/i,
  /could not be delivered/i,
  /address rejected/i,
  /mailbox (not found|unavailable|full|quota exceeded)/i,
  /user unknown/i,
  /no such user/i,
  /account (disabled|suspended|deactivated)/i,
  /recipient rejected/i,
  /550 /i, // SMTP bounce codes
  /551 /i,
  /552 /i,
  /553 /i,
  /554 /i,
];

const UNSUBSCRIBE_PATTERNS = [
  /unsubscribe/i,
  /opt.?out/i,
  /remove (me|my email) from/i,
  /stop (sending|emailing)/i,
  /don'?t (send|email|contact)/i,
];

const BOUNCE_SENDER_PATTERNS = [
  /mailer-daemon/i,
  /postmaster/i,
  /mail-daemon/i,
  /MAILER-DAEMON/,
];

export interface ClassificationResult {
  replyType: 'positive' | 'negative' | 'ooo' | 'auto_reply' | 'general' | 'bounce' | 'unsubscribe';
  bounceType?: 'hard' | 'soft' | 'blocked' | 'mailbox_full';
  confidence: number;
  reason: string;
}

export function classifyReply(subject: string, body: string, fromEmail: string, fromName?: string): ClassificationResult {
  const fullText = `${subject || ''} ${body || ''}`.toLowerCase();
  const senderFull = `${fromName || ''} ${fromEmail || ''}`.toLowerCase();
  const subjectLower = (subject || '').toLowerCase();

  // 1. Check bounce first (highest priority - system messages)
  const isBounceAddress = BOUNCE_SENDER_PATTERNS.some(p => p.test(senderFull));
  const hasBounceContent = BOUNCE_PATTERNS.some(p => p.test(fullText));

  if (isBounceAddress) {
    let bounceType: 'hard' | 'soft' | 'blocked' | 'mailbox_full' = 'hard';
    if (/mailbox (full|quota|exceeded|over)/i.test(fullText)) bounceType = 'mailbox_full';
    else if (/blocked|rejected|spam|blacklist|policy/i.test(fullText)) bounceType = 'blocked';
    else if (/temporary|try again|transient|4\d\d /i.test(fullText)) bounceType = 'soft';
    return { replyType: 'bounce', bounceType, confidence: 0.95, reason: 'System bounce message detected' };
  }

  if (hasBounceContent && !isBounceAddress) {
    const hasSmtpCodes = /5\d\d |4\d\d /.test(fullText);
    const bounceKeywordCount = (fullText.match(/undeliverable|delivery failed|could not be delivered|address rejected|user unknown|no such user|account disabled|recipient rejected|mailbox.*full|mailbox.*quota/gi) || []).length;
    const isDsnSubject = /delivery status notification|failure notice|returned mail|mail delivery|bounce/i.test(subjectLower);

    if ((isDsnSubject && hasBounceContent) || (hasSmtpCodes && bounceKeywordCount >= 1) || (bounceKeywordCount >= 3)) {
      let bounceType: 'hard' | 'soft' | 'blocked' | 'mailbox_full' = 'hard';
      if (/mailbox (full|quota|exceeded|over)/i.test(fullText)) bounceType = 'mailbox_full';
      else if (/blocked|rejected|spam|blacklist|policy/i.test(fullText)) bounceType = 'blocked';
      else if (/temporary|try again|transient|4\d\d /i.test(fullText)) bounceType = 'soft';
      return { replyType: 'bounce', bounceType, confidence: 0.80, reason: 'Bounce message detected' };
    }
  }

  // 2. Check OOO (before auto_reply so OOO is more specific)
  const oooMatches = OOO_PATTERNS.filter(p => p.test(fullText)).length;
  if (oooMatches >= 1) {
    return { replyType: 'ooo', confidence: 0.9, reason: `Out of office pattern matched (${oooMatches} indicators)` };
  }

  // 3. Check auto-reply
  const autoMatches = AUTO_REPLY_PATTERNS.filter(p => p.test(fullText)).length;
  if (autoMatches >= 1) {
    return { replyType: 'auto_reply', confidence: 0.9, reason: `Automated reply detected (${autoMatches} indicators)` };
  }

  // 4. Check unsubscribe intent
  const unsubMatches = UNSUBSCRIBE_PATTERNS.filter(p => p.test(fullText)).length;
  if (unsubMatches >= 2 || (unsubMatches >= 1 && fullText.length < 200)) {
    return { replyType: 'unsubscribe', confidence: 0.85, reason: 'Unsubscribe intent detected' };
  }

  // 5. Check negative
  const negMatches = NEGATIVE_PATTERNS.filter(p => p.test(fullText)).length;
  if (negMatches >= 2 || (negMatches >= 1 && fullText.length < 300)) {
    return { replyType: 'negative', confidence: 0.7 + (negMatches * 0.05), reason: `Negative patterns: ${negMatches}` };
  }

  // 6. Check positive
  const posMatches = POSITIVE_PATTERNS.filter(p => p.test(fullText)).length;
  if (posMatches >= 1) {
    if (negMatches > 0 && negMatches >= posMatches) {
      return { replyType: 'negative', confidence: 0.6, reason: 'Mixed signals - leaning negative' };
    }
    return { replyType: 'positive', confidence: 0.7 + (posMatches * 0.05), reason: `Positive patterns: ${posMatches}` };
  }

  // 7. Default to general (will be sent to AI for reclassification)
  return { replyType: 'general', confidence: 0.5, reason: 'No specific pattern matched' };
}

/**
 * Returns true if this reply type is a real human reply that needs action.
 * Excludes automated/system messages.
 */
export function isHumanReply(replyType: string): boolean {
  return replyType === 'positive' || replyType === 'negative' || replyType === 'general' || replyType === 'unsubscribe';
}

/**
 * AI-powered reply classification using Azure OpenAI.
 * Used for 'general' classified replies to determine if they're real human replies
 * or auto-replies/OOO that the rule engine missed.
 */
export async function classifyReplyWithAI(
  subject: string,
  body: string,
  fromEmail: string,
  orgId: string,
  storage: any
): Promise<ClassificationResult> {
  try {
    const settings = await storage.getApiSettingsWithAzureFallback(orgId);
    const endpoint = settings.azure_openai_endpoint;
    const apiKey = settings.azure_openai_api_key;
    const deploymentName = settings.azure_openai_deployment;
    const apiVersion = settings.azure_openai_api_version || '2024-08-01-preview';

    if (!endpoint || !apiKey || !deploymentName) {
      // No AI configured — return general as-is
      return { replyType: 'general', confidence: 0.5, reason: 'AI not configured' };
    }

    const bodyPreview = (body || '').slice(0, 800);
    const prompt = `Classify this email reply from a sales outreach campaign. Return ONLY a JSON object.

From: ${fromEmail}
Subject: ${subject || '(no subject)'}
Body: ${bodyPreview}

Classify as exactly one of:
- "positive": Human replied with genuine interest, questions, wants to meet/talk/learn more, asks for pricing/demo
- "negative": Human explicitly declined, said not interested, asked to stop emailing, unsubscribe
- "ooo": Out of office auto-reply, person is on leave/vacation/travel
- "auto_reply": Automated system reply (ticketing, CRM, helpdesk, support ticket created, "we received your email" confirmations)
- "general": Human replied but intent is neutral/unclear (asks a question, provides info, short acknowledgement)
- "unsubscribe": Explicitly wants to unsubscribe or be removed from list

Rules:
- If the body reads like a form letter from a system (ticketing, CRM, "your request has been received"), classify as auto_reply
- If the person says they're traveling/on leave/back on date, classify as ooo
- Only classify as positive if there is clear genuine human interest
- When uncertain between auto_reply and general, prefer auto_reply

Respond ONLY with: {"type": "positive|negative|ooo|auto_reply|general|unsubscribe", "confidence": 0-100, "reason": "one sentence"}`;

    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an email classification expert. Classify email replies accurately. Auto-replies and OOO messages should never be counted as real human replies. Be conservative — only mark as positive when there is clear human intent to engage.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      console.error(`[ReplyClassifier] Azure OpenAI error: ${response.status}`);
      return { replyType: 'general', confidence: 0.5, reason: 'AI classification failed' };
    }

    const data = await response.json() as any;
    const content = (data.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validTypes = ['positive', 'negative', 'ooo', 'auto_reply', 'general', 'unsubscribe'];
      const replyType = validTypes.includes(parsed.type) ? parsed.type : 'general';
      return {
        replyType: replyType as ClassificationResult['replyType'],
        confidence: Math.min(1, Math.max(0, (parsed.confidence || 50) / 100)),
        reason: `AI: ${parsed.reason || replyType}`,
      };
    }
  } catch (e: any) {
    console.error('[ReplyClassifier] AI error:', e.message);
  }

  return { replyType: 'general', confidence: 0.5, reason: 'AI parse failed' };
}

/**
 * Classify bounce type from error message
 */
export function classifyBounce(errorMessage: string): 'hard' | 'soft' | 'blocked' | 'mailbox_full' {
  const msg = (errorMessage || '').toLowerCase();
  if (/mailbox (full|quota|exceeded|over)/i.test(msg)) return 'mailbox_full';
  if (/blocked|rejected|spam|blacklist|policy/i.test(msg)) return 'blocked';
  if (/temporary|try again|transient|timeout|4\d\d /i.test(msg)) return 'soft';
  return 'hard';
}
