/**
 * Reply Classification Engine
 * Auto-classifies incoming replies into: positive, negative, ooo, auto_reply, general, bounce, unsubscribe
 */

// Keywords/patterns for classification
const OOO_PATTERNS = [
  /out of (the )?office/i,
  /on vacation/i,
  /on leave/i,
  /away from (my )?desk/i,
  /currently unavailable/i,
  /auto.?reply/i,
  /automatische antwort/i, // German
  /absence du bureau/i, // French
  /fuera de la oficina/i, // Spanish
  /limited access to email/i,
  /will be back/i,
  /return(ing)? on/i,
  /away until/i,
  /not in the office/i,
];

const AUTO_REPLY_PATTERNS = [
  /this is an auto(matic|mated)?\s?(reply|response|message)/i,
  /auto.?generated/i,
  /do not reply to this email/i,
  /this mailbox is not monitored/i,
  /noreply/i,
  /no-reply/i,
  /automated notification/i,
  /this is a system message/i,
  /automatic reply/i,
];

const POSITIVE_PATTERNS = [
  /interested/i,
  /love to (learn|hear|know|chat|discuss|talk|meet|connect|explore|see)/i,
  /would like to (learn|hear|know|chat|discuss|talk|meet|connect|schedule|explore)/i,
  /sounds great/i,
  /sounds interesting/i,
  /tell me more/i,
  /let'?s (schedule|set up|book|arrange|plan|connect)/i,
  /can we (meet|talk|chat|schedule|connect|hop on)/i,
  /when are you (free|available)/i,
  /send (me |us )?(more )?info/i,
  /looking forward/i,
  /yes,? (please|i'?d|that|we|let)/i,
  /absolutely/i,
  /great,? (let'?s|when|sounds|i'?d)/i,
  /perfect,? (let'?s|when|sounds)/i,
  /count me in/i,
  /sign me up/i,
  /i'?m in/i,
  /how (much|does it cost|do we get started)/i,
  /can you (send|share|provide)/i,
  /what'?s the (next step|pricing|cost)/i,
  /free (for|on|this|next)/i,
  /happy to (chat|connect|discuss|meet|talk)/i,
];

const NEGATIVE_PATTERNS = [
  /not interested/i,
  /no thank(s| you)/i,
  /please (remove|unsubscribe|stop|don'?t)/i,
  /remove (me|my email|us) from/i,
  /take me off/i,
  /don'?t (contact|email|send|reach out)/i,
  /stop (emailing|sending|contacting)/i,
  /not (the right|a good) (fit|time|person)/i,
  /we'?re not (looking|interested)/i,
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

  // 1. Check bounce first (highest priority - system messages)
  const isBounceAddress = BOUNCE_SENDER_PATTERNS.some(p => p.test(senderFull));
  const hasBounceContent = BOUNCE_PATTERNS.some(p => p.test(fullText));
  
  if (isBounceAddress || hasBounceContent) {
    let bounceType: 'hard' | 'soft' | 'blocked' | 'mailbox_full' = 'hard';
    if (/mailbox (full|quota|exceeded|over)/i.test(fullText)) bounceType = 'mailbox_full';
    else if (/blocked|rejected|spam|blacklist/i.test(fullText)) bounceType = 'blocked';
    else if (/temporary|try again|transient|4\d\d /i.test(fullText)) bounceType = 'soft';
    
    return { replyType: 'bounce', bounceType, confidence: isBounceAddress ? 0.95 : 0.85, reason: 'Bounce message detected' };
  }

  // 2. Check OOO
  if (OOO_PATTERNS.some(p => p.test(fullText))) {
    return { replyType: 'ooo', confidence: 0.9, reason: 'Out of office pattern matched' };
  }

  // 3. Check auto-reply
  if (AUTO_REPLY_PATTERNS.some(p => p.test(fullText))) {
    return { replyType: 'auto_reply', confidence: 0.9, reason: 'Automated reply detected' };
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
    // If there's both positive and negative, check which has more
    if (negMatches > 0 && negMatches >= posMatches) {
      return { replyType: 'negative', confidence: 0.6, reason: 'Mixed signals - leaning negative' };
    }
    return { replyType: 'positive', confidence: 0.7 + (posMatches * 0.05), reason: `Positive patterns: ${posMatches}` };
  }

  // 7. Default to general
  return { replyType: 'general', confidence: 0.5, reason: 'No specific pattern matched' };
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
