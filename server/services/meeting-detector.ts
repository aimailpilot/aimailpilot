// Regex-based meeting detection for inbox messages. No AI.
// Detects Google Meet, Microsoft Teams, Zoom, Webex, GoToMeeting links
// and ICS calendar invite signals in email bodies/subjects.

export interface MeetingDetection {
  detected: boolean;
  platform: string | null;   // 'google_meet' | 'teams' | 'zoom' | 'webex' | 'gotomeeting' | 'calendar_invite'
  url: string | null;
  meetingAt: string | null;  // ISO string if ICS DTSTART found, else null
}

const PATTERNS: Array<{ platform: string; regex: RegExp }> = [
  { platform: 'google_meet', regex: /https?:\/\/meet\.google\.com\/[a-z0-9\-?=&%_\/]+/i },
  { platform: 'teams',       regex: /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+/i },
  { platform: 'teams',       regex: /https?:\/\/teams\.live\.com\/meet\/[^\s"'<>]+/i },
  { platform: 'zoom',        regex: /https?:\/\/[a-z0-9-]*\.?zoom\.us\/(j|my|w)\/[^\s"'<>]+/i },
  { platform: 'webex',       regex: /https?:\/\/[a-z0-9-]+\.webex\.com\/(meet|join|wbxmjs)\/[^\s"'<>]+/i },
  { platform: 'gotomeeting', regex: /https?:\/\/(www\.)?gotomeet(ing)?\.(me|com)\/[^\s"'<>]+/i },
];

const ICS_HINTS = /(BEGIN:VCALENDAR|BEGIN:VEVENT|METHOD:REQUEST|DTSTART[;:])/i;
const ICS_DTSTART = /DTSTART(?:;[^:]*)?:([0-9]{8}T[0-9]{6}Z?)/i;

function parseIcsDate(s: string): string | null {
  // 20260420T140000Z or 20260420T140000 → ISO
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] === 'Z' ? 'Z' : ''}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function detectMeeting(subject: string | null | undefined, body: string | null | undefined, bodyHtml?: string | null | undefined): MeetingDetection {
  const text = [subject || '', body || '', bodyHtml || ''].join('\n');
  if (!text.trim()) return { detected: false, platform: null, url: null, meetingAt: null };

  for (const { platform, regex } of PATTERNS) {
    const m = regex.exec(text);
    if (m) {
      return { detected: true, platform, url: m[0], meetingAt: extractIcsStart(text) };
    }
  }

  if (ICS_HINTS.test(text)) {
    return { detected: true, platform: 'calendar_invite', url: null, meetingAt: extractIcsStart(text) };
  }

  return { detected: false, platform: null, url: null, meetingAt: null };
}

function extractIcsStart(text: string): string | null {
  const m = ICS_DTSTART.exec(text);
  if (!m) return null;
  return parseIcsDate(m[1]);
}
