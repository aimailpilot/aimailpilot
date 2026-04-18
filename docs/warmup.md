# Warmup Engine — Reference Guide

## Overview

The warmup engine sends emails between connected org accounts to build sender reputation with Gmail and Outlook. It applies engagement signals (open, star, mark important, reply) to train mailbox providers that your senders are trustworthy.

**File**: `server/services/warmup-engine.ts`
**Started by**: `startWarmupEngine()` in `server/index.ts`
**Interval**: every 30 minutes

---

## How It Works

1. Org has 2+ connected accounts registered in `warmup_accounts` table
2. Engine picks sender/recipient pairs from active accounts
3. Sender sends an email using a random template
4. Recipient account auto-engages: open, star, mark important, auto-reply (~30% chance)
5. Volume ramps by warmup phase (day count since start date)

---

## Gmail Engagement Flow

1. Search INBOX for warmup emails from sender (`from:${fromEmail} newer_than:3d in:inbox`)
2. Search SPAM for warmup emails from sender (`from:${fromEmail} newer_than:1d in:spam`)
3. **Spam → Inbox rescue**: removes `SPAM` label, adds `INBOX` + warmup label
4. **Inbox processing**: adds `STARRED`, `IMPORTANT`, warmup label; removes `UNREAD`, `INBOX`
   - Email lives only under the warmup label — NOT in Gmail inbox view
5. Auto-reply sent ~30% of the time

**Gmail Label**: `AImailPilot-Warmup` (created automatically if missing)

### Why Emails Still Appear in Gmail Inbox (known issue)

The `removeLabelIds: ['INBOX']` step only runs on `is:unread` + `newer_than:1d` messages. Emails that are:
- Read before engage runs, OR
- Older than 1d when engine was down

...never get `INBOX` removed. **Fix applied (2026-04-18)**:
- Widened search to `newer_than:3d` and dropped `is:unread` filter
- Added `warmup-inbox-cleanup.ts` periodic service to backfill-remove INBOX from already-tagged warmup messages

---

## Outlook Engagement Flow

1. Search Inbox for warmup emails from sender (unread only)
2. Search JunkEmail for warmup emails from sender
3. **Junk → Warmup folder move**: trains Outlook sender is safe
4. **Inbox → Warmup folder move**: marks read, flags message, moves out of inbox

**Outlook Folder**: `AImailPilot-Warmup` (created automatically if missing)
Outlook's move is atomic — no INBOX-leak problem.

---

## Warmup Inbox Cleanup Service

**File**: `server/services/warmup-inbox-cleanup.ts`
**Purpose**: Backfill-remove `INBOX` label from Gmail messages already tagged `AImailPilot-Warmup`
**Runs**: 5 min after boot, then every 2 h
**Scope**: Only Gmail accounts with a `warmup_accounts` row
**Safety**: Only touches messages carrying the warmup label — real client mail is never affected

---

## App DB Purge Service

**File**: `server/services/warmup-inbox-purge.ts`
**Purpose**: Delete warmup-only rows from `unified_inbox` older than 5 days
**Runs**: 10 min after boot, then every 6 h
**Retention**: 5 days

### Delete Safety Filter (all conditions must match to delete)
1. `receivedAt` older than 5 days
2. `replyType NOT IN ('positive','negative','general')` — never deletes real human replies
3. `fromEmail` is an org-connected mailbox (email_accounts ∪ warmup_accounts)
4. `toEmail` is an org-connected mailbox (same set)

A real client email **cannot** match conditions 3+4 — their address is not in your org's email_accounts table.

---

## Warmup Exclusion in Inbox Queries

**File**: `server/pg-storage.ts` — `getInboxMessagesEnhanced`, `getInboxMessageCountEnhanced`, `getInboxStats`

Warmup detection = sender email ∈ (email_accounts ∪ warmup_accounts) for the org.
All non-warmup inbox views exclude messages where `fromEmail` is an org-owned mailbox.
Warmup tab (`status='warmup'`) requires BOTH sender AND recipient to be org-owned.

The `fromEmail` column stores `"Name <email>"` format — SQL extracts the email part:
```sql
LOWER(CASE WHEN "fromEmail" LIKE '%<%>%'
           THEN substring("fromEmail" from '<([^>]+)>')
           ELSE "fromEmail" END)
```

---

## Replied Tab Filter (Overridden 2026-04-18)

**Previous**: `status = 'replied' OR "repliedAt" IS NOT NULL` — showed only 1 message
**Current**: `"replyType" IN ('positive','negative','general')` — shows all real incoming replies across all accounts

This override was explicitly approved to fix the Replied tab showing near-zero counts despite thousands of real replies.

---

## Warmup Metrics

Stored in `warmup_accounts` table:
- `inboxRate` — % of warmup emails landing in inbox (vs spam). Weighted 60% history / 40% today
- `spamRate` — % landing in spam
- `reputationScore` — composite: `inboxRate×0.7 + (replied?20:0) + min(10, engaged×2)`
- `totalSent`, `totalReceived`, `currentDaily`
- Logged daily to `warmup_logs` table

Zero spam rate = good outcome — means Gmail/Outlook learned your senders are safe.

---

## Spam Rescue — Does It Work?

Yes. Code at lines ~322-340 (`gmailEngage`) and ~394-408 (`outlookEngage`) actively searches spam/junk and moves warmup emails out. If you see `spamCount=0` in logs:
- Normal after warmup has run for weeks — providers have learned to inbox your senders
- If you suspect it's not running, check logs for `[Warmup] ${email}: N inbox, N spam`

Logging is conditional (`if (totalSpam > 0) console.log(...)`) — absence of log line means no spam detected, not that rescue isn't running.

---

## Protected Rules (DO NOT CHANGE)

- **No changes to `warmup-engine.ts`** (CLAUDE.md protected) except the approved 2026-04-18 patch widening the inbox search window
- **No changes to `ownEmailsSet` warmup filter** in `gmail-reply-tracker.ts` and `outlook-reply-tracker.ts` — must union `email_accounts` (direct) AND `warmup_accounts` JOIN `email_accounts` via `emailAccountId`. `warmup_accounts` has NO `email` column — `SELECT email FROM warmup_accounts` returns nothing. Always use the JOIN form. Variable must be named `fromEmail` not `senderEmail` (duplicate declaration compile error)
- **Warmup emails must never reach unified_inbox as real replies** — the `ownEmailsSet` skip in reply tracker prevents this
- **Do not delete warmup rows with `replyType IN ('positive','negative','general')`** — safety net in purge service

---

## Adding New Warmup Accounts

1. Connect email account via Gmail/Outlook OAuth (adds row to `email_accounts`)
2. Register in warmup-monitoring page — creates `warmup_accounts` row linking to `email_accounts`
3. Need minimum 2 active warmup accounts for engine to send (pairs required)

---

## Files Reference

| File | Purpose |
|------|---------|
| `server/services/warmup-engine.ts` | Core engine — send, engage, label, spam rescue |
| `server/services/warmup-inbox-cleanup.ts` | Periodic Gmail INBOX label backfill removal |
| `server/services/warmup-inbox-purge.ts` | Periodic DB purge of old warmup rows from unified_inbox |
| `server/pg-storage.ts` | Warmup exclusion in inbox queries (getInboxMessagesEnhanced etc.) |
| `client/src/pages/warmup-monitoring.tsx` | UI — warmup account management + metrics |
| `server/routes.ts:9545+` | Warmup API routes |
