# DATABASE-RECOVERY.md

## Production Database Details

- **Database**: SQLite via `better-sqlite3`
- **Production path**: `/home/data/aimailpilot.db` (Azure App Service)
- **Backup location**: `/home/data/backups/` (automatic timestamped backups, keeps last 5)
- **App name on Azure**: `ailmailpilot`

---

## How to Restore the Database

### Step 1: Access Kudu SSH

1. Go to **Azure Portal** > App Service (`ailmailpilot`) > **Advanced Tools (Kudu)** > **Go**
2. Click **SSH** from the top menu

### Step 2: Check Available Backups

```bash
ls -la /home/data/backups/
```

Look for the **newest, largest file** (should be ~95-100MB for full data).

### Step 3: Verify Backup Has Data

```bash
sqlite3 /home/data/backups/aimailpilot-YYYY-MM-DDTHH-MM-SS.db "SELECT COUNT(*) FROM contacts; SELECT COUNT(*) FROM campaigns; SELECT COUNT(*) FROM email_accounts;"
```

Expected: ~7000 contacts, ~40+ campaigns, ~17 email accounts.

### Step 4: Restore

```bash
cp /home/data/backups/aimailpilot-YYYY-MM-DDTHH-MM-SS.db /home/data/aimailpilot.db
```

### Step 5: Restart the App

- **Option A**: Azure Portal > App Service > **Restart** button
- **Option B**: In Kudu SSH: `pkill -f node`

### Step 6: Verify

Go to `aimailpilot.com` and log in. All data should be restored.

---

## What Causes Data Loss

### Root Cause (Fixed 2026-03-31)

A "corruption handler" in `server/storage.ts` ran `integrity_check` on startup. On Azure, the CIFS/SMB file system causes **transient lock failures** during deployments. The handler mistakenly treated these as corruption, renamed the database to `.corrupt.{timestamp}`, and created a fresh empty database.

### Fix Applied

- Removed the `integrity_check` gate entirely
- Removed all `fs.renameSync` / `fs.unlinkSync` calls on the DB path
- Database open now retries on failure instead of deleting
- `resetCorruptDatabase()` method has been disabled (returns error, does nothing)
- Only creates a new DB if the file literally does not exist

---

## Safety Rules (NEVER BREAK THESE)

1. **NEVER** delete, rename, move, or overwrite the database file in code
2. **NEVER** add `integrity_check` as a startup gate
3. **NEVER** auto-create a fresh DB if the existing one fails to open — crash instead
4. **NEVER** add a "reset database" API endpoint that actually deletes the file
5. If the DB can't open: **retry with delay**, then **crash** (do NOT recreate)
6. Only create a new DB if `!fs.existsSync(DB_PATH)` (file truly doesn't exist)
7. Backups are handled by the existing automatic backup mechanism — do not modify it

---

## Incident History

### 2026-03-31: Production data wiped during deployment

- **Trigger**: Code deployment caused Azure App Service restart
- **Bug**: `integrity_check` pragma failed due to CIFS lock, corruption handler renamed DB
- **Impact**: 6,999 contacts, 42 campaigns, 17 email accounts temporarily lost
- **Recovery**: Restored from `/home/data/backups/aimailpilot-2026-03-31T09-33-00.db` (100MB) via Kudu SSH
- **Fix**: Removed corruption handler, added retry logic, disabled resetCorruptDatabase()
