import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startFollowupEngine } from "./services/followup-engine";
import { startWarmupEngine } from "./services/warmup-engine";
import { startHotLeadsRefiner } from "./services/hot-leads-refiner";
import { startInboxNudgeEngine } from "./services/inbox-nudge-engine";
import { startWarmupInboxPurge } from "./services/warmup-inbox-purge";
import { startWarmupInboxCleanup } from "./services/warmup-inbox-cleanup";
import { startApolloSyncResumer } from "./services/apollo-sync-engine";
import { startOutboundReplySweeper } from "./services/outbound-reply-sweeper";
import { startStaleJobsSweeper } from "./services/stale-jobs-sweeper";
import { campaignEngine } from "./services/campaign-engine";
import { classifyReply, classifyReplyWithAI } from "./services/reply-classifier";
import { storage, initStorage } from "./storage";

// Global error handling to prevent silent crashes on Azure
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

console.log(`[Startup] Node ${process.version}, env=${process.env.NODE_ENV || 'development'}, port=${process.env.PORT || '3000'}`);

const app = express();

// Gzip compression for all responses (~70% smaller payloads)
app.use(compression());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // Initialize storage (runs PostgreSQL schema init when DATABASE_URL is set)
  await initStorage();

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`AImailPilot serving on port ${port}`);
    // Start the follow-up engine after server is ready
    startFollowupEngine();
    // Start the warmup engine (self-warmup between connected accounts)
    startWarmupEngine();
    // Refine Hot Leads — AI classify positive replies without a lead_opportunities row
    startHotLeadsRefiner();
    // Detect suggested Won / suggested Meeting signals in new inbox replies
    startInboxNudgeEngine();
    // Purge warmup-only emails from unified_inbox older than 5 days
    startWarmupInboxPurge();
    // Remove INBOX label from already-tagged warmup messages that leaked through
    startWarmupInboxCleanup();
    // Detect outbound replies sent from native Gmail/Outlook clients (outside AImailPilot)
    // and mark the corresponding inbox message replied so it stops appearing in "Need Reply"
    startOutboundReplySweeper();
    // Auto-fail stale background jobs (lead-intel, bulk-template-analyze) whose
    // workers crashed or were interrupted. Without this, "running" rows hang in
    // api_settings forever and block new jobs of the same type from starting.
    startStaleJobsSweeper();
    // Auto-resume Apollo sync jobs that were paused due to rate limiting
    startApolloSyncResumer();
    
    // Auto-resume active campaigns that were interrupted by server restart
    // Delay by 10 seconds to let the server fully initialize (OAuth, DB, etc.)
    setTimeout(async () => {
      try {
        await campaignEngine.resumeActiveCampaigns();
      } catch (e) {
        console.error('[Startup] Failed to resume active campaigns:', e);
      }
    }, 10000);

    // Recover scheduled campaigns whose start time has passed during server downtime.
    // In-memory setTimeout is lost on restart — this re-fires them at boot.
    // Runs 15s after startup (after resumeActiveCampaigns, before reclassify).
    setTimeout(async () => {
      try {
        const now = new Date().toISOString();
        const overdueScheduled = await storage.rawAll(
          `SELECT id, name, "sendingConfig" FROM campaigns WHERE status = 'scheduled' AND "scheduledAt" IS NOT NULL AND "scheduledAt" <= $1`,
          now
        ) as any[];
        if (overdueScheduled.length > 0) {
          console.log(`[Startup] Found ${overdueScheduled.length} overdue scheduled campaign(s) — starting now`);
          for (const row of overdueScheduled) {
            try {
              let sendingConfig: any = undefined;
              if (row.sendingConfig) {
                try { sendingConfig = typeof row.sendingConfig === 'string' ? JSON.parse(row.sendingConfig) : row.sendingConfig; } catch {}
              }
              console.log(`[Startup] Starting overdue scheduled campaign: ${row.name} (${row.id})`);
              await campaignEngine.startCampaign({ campaignId: row.id, sendingConfig: sendingConfig || undefined });
              // Stagger to avoid simultaneous contact loading (same pattern as resumeActiveCampaigns)
              await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
              console.error(`[Startup] Failed to start overdue scheduled campaign ${row.id}:`, err);
            }
          }
        }
      } catch (e) {
        console.error('[Startup] Failed to recover overdue scheduled campaigns:', e);
      }
    }, 15000);

    // One-time reclassification of unclassified + general inbox messages on boot
    // Runs 30s after startup to not block initial load
    setTimeout(async () => {
      try {
        log('[Reclassify] Starting boot reclassification of inbox messages...');
        // Get all orgs that have unclassified or general messages
        const orgs = await storage.rawAll(`
          SELECT DISTINCT "organizationId" FROM unified_inbox
          WHERE ("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')
          AND ("sentByUs" IS NULL OR "sentByUs" = 0)
          LIMIT 20
        `) as any[];
        let totalReclassified = 0;

        for (const org of orgs) {
          const orgId = org.organizationId;
          // Get ALL unclassified messages (NULL, empty, or general)
          const unclassifiedMsgs = await storage.rawAll(`
            SELECT id, subject, body, snippet, "fromEmail", "fromName", "replyType"
            FROM unified_inbox
            WHERE "organizationId" = ?
            AND ("replyType" IS NULL OR "replyType" = '' OR "replyType" = 'general')
            AND ("sentByUs" IS NULL OR "sentByUs" = 0)
            LIMIT 2000
          `, orgId) as any[];

          let orgReclassified = 0;
          for (const msg of unclassifiedMsgs) {
            // Re-run strengthened rule engine on ALL unclassified
            const ruleResult = classifyReply(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, msg.fromName);
            if (ruleResult.replyType !== 'general') {
              try {
                await storage.rawRun(`UPDATE unified_inbox SET "replyType" = ? WHERE id = ?`, ruleResult.replyType, msg.id);
                orgReclassified++;
              } catch { }
            }
          }

          totalReclassified += orgReclassified;
          if (orgReclassified > 0) {
            log(`[Reclassify] Org ${orgId}: rule-engine reclassified ${orgReclassified}/${unclassifiedMsgs.length} messages`);
          }
        }
        log(`[Reclassify] Boot done. Total reclassified by rules: ${totalReclassified}`);
      } catch (e) {
        console.error('[Reclassify] Boot reclassification error:', e);
      }
    }, 30000);

    // Auto-score new human-reply inbox messages with Azure OpenAI
    // Runs every 15 minutes; skips messages that already have a score
    setTimeout(() => {
      const runScorer = async () => {
        try {
          const { batchScoreOrgReplies } = await import('./services/reply-quality-engine');
          const orgs = await storage.rawAll(`
            SELECT DISTINCT "organizationId" FROM unified_inbox
            WHERE "replyType" IN ('positive','negative','general')
              AND "replyQualityScore" IS NULL
            LIMIT 50
          `) as any[];
          for (const org of orgs) {
            try {
              await batchScoreOrgReplies(org.organizationId, 50);
            } catch (e) {
              console.error(`[ReplyQualityAuto] Org ${org.organizationId} failed:`, e instanceof Error ? e.message : e);
            }
          }
        } catch (e) {
          console.error('[ReplyQualityAuto] sweep error:', e instanceof Error ? e.message : e);
        }
      };
      runScorer();
      setInterval(runScorer, 15 * 60 * 1000);
      log('[ReplyQualityAuto] Scheduled: first run now, then every 15 minutes');
    }, 90 * 1000);

    // One-time boot sweep: reconcile messages.status='bounced' with contacts.status='bounced'
    // Covers the gap where a campaign/tracker wrote a bounced message row but contact flip was
    // missed (crash, partial failure, or contact lookup failed at the time).
    setTimeout(async () => {
      try {
        const connectedRows = await storage.rawAll(`
          SELECT LOWER(email) as email FROM email_accounts
          UNION
          SELECT LOWER(email) as email FROM warmup_accounts
        `) as any[];
        const protectedEmails = new Set<string>(connectedRows.map((r: any) => r.email).filter(Boolean));

        const orphans = await storage.rawAll(`
          SELECT DISTINCT c.id, c.email, c."organizationId"
          FROM messages m
          JOIN contacts c ON c.id = m."contactId"
          WHERE m.status = 'bounced'
            AND c.status != 'bounced'
            AND c.status != 'unsubscribed'
          LIMIT 5000
        `) as any[];

        let reconciled = 0;
        for (const c of orphans) {
          const emailLower = (c.email || '').toLowerCase();
          if (!emailLower || protectedEmails.has(emailLower)) continue;
          try {
            await storage.markContactBounced(c.id, 'hard');
            reconciled++;
          } catch (e) { /* non-critical */ }
        }
        if (orphans.length > 0) {
          log(`[BounceReconcile] Boot sweep: ${orphans.length} orphan bounced messages found, ${reconciled} contacts reconciled`);
        }
      } catch (e) {
        console.error('[BounceReconcile] Boot sweep error:', e);
      }
    }, 60 * 1000);

    // One-time boot sweep: flip contacts to 'unsubscribed' when inbox reply was classified
    // as unsubscribe but contact row was never updated (historical gap — classifier wrote
    // replyType='unsubscribe' but no caller invoked markContactUnsubscribed).
    setTimeout(async () => {
      try {
        const connectedRows = await storage.rawAll(`
          SELECT LOWER(email) as email FROM email_accounts
          UNION
          SELECT LOWER(email) as email FROM warmup_accounts
        `) as any[];
        const protectedEmails = new Set<string>(connectedRows.map((r: any) => r.email).filter(Boolean));

        const candidates = await storage.rawAll(`
          SELECT DISTINCT c.id, c.email, c."organizationId", ui.id as "msgId", ui."campaignId"
          FROM unified_inbox ui
          JOIN contacts c ON LOWER(c.email) = LOWER(ui."fromEmail")
              AND c."organizationId" = ui."organizationId"
          WHERE ui."replyType" = 'unsubscribe'
            AND (c.unsubscribed IS NULL OR c.unsubscribed = 0)
            AND c.status != 'bounced'
          LIMIT 5000
        `) as any[];

        let flipped = 0;
        for (const c of candidates) {
          const emailLower = (c.email || '').toLowerCase();
          if (!emailLower || protectedEmails.has(emailLower)) continue;
          try {
            await storage.markContactUnsubscribed(c.id, c.campaignId || undefined);
            flipped++;
          } catch (e) { /* non-critical */ }
        }
        if (candidates.length > 0) {
          log(`[UnsubReconcile] Boot sweep: ${candidates.length} inbox unsubscribe replies matched to contacts, ${flipped} flipped`);
        }
      } catch (e) {
        console.error('[UnsubReconcile] Boot sweep error:', e);
      }
    }, 75 * 1000);

    // Recurring: every 15 min, auto-flip contacts to 'unsubscribed' when a new inbox reply
    // has been classified as unsubscribe. Same guard set (own accounts, not-already-bounced).
    setTimeout(() => {
      const runUnsubFlip = async () => {
        try {
          const connectedRows = await storage.rawAll(`
            SELECT LOWER(email) as email FROM email_accounts
            UNION
            SELECT LOWER(email) as email FROM warmup_accounts
          `) as any[];
          const protectedEmails = new Set<string>(connectedRows.map((r: any) => r.email).filter(Boolean));

          const candidates = await storage.rawAll(`
            SELECT DISTINCT c.id, c.email, c."organizationId", ui."campaignId"
            FROM unified_inbox ui
            JOIN contacts c ON LOWER(c.email) = LOWER(ui."fromEmail")
                AND c."organizationId" = ui."organizationId"
            WHERE ui."replyType" = 'unsubscribe'
              AND (c.unsubscribed IS NULL OR c.unsubscribed = 0)
              AND c.status != 'bounced'
            LIMIT 500
          `) as any[];

          let flipped = 0;
          for (const c of candidates) {
            const emailLower = (c.email || '').toLowerCase();
            if (!emailLower || protectedEmails.has(emailLower)) continue;
            try {
              await storage.markContactUnsubscribed(c.id, c.campaignId || undefined);
              flipped++;
            } catch (e) { /* non-critical */ }
          }
          if (flipped > 0) log(`[UnsubAuto] Flipped ${flipped}/${candidates.length} contacts to unsubscribed`);
        } catch (e) {
          console.error('[UnsubAuto] sweep error:', e instanceof Error ? e.message : e);
        }
      };
      runUnsubFlip();
      setInterval(runUnsubFlip, 6 * 60 * 60 * 1000);
      log('[UnsubAuto] Scheduled: first run now, then every 6 hours');
    }, 120 * 1000);

    // [ContactStatusNormalize] Cleanup of non-canonical status values leaked from CSV `stage` column.
    // Idempotent: WHERE clause excludes already-canonical rows, so re-running is a no-op.
    // Maps 'clicked' → 'hot', 'active' → 'cold', everything else → 'cold'. Preserves canonical values.
    setTimeout(async () => {
      try {
        const before = await storage.rawGet(
          `SELECT COUNT(*)::int AS n FROM contacts
           WHERE status IS NOT NULL AND status NOT IN ('cold','warm','hot','replied','bounced','unsubscribed')`
        ) as any;
        const count = before?.n || 0;
        if (count === 0) return;
        await storage.rawRun(
          `UPDATE contacts SET status = CASE LOWER(TRIM(status))
              WHEN 'clicked' THEN 'hot'
              WHEN 'active' THEN 'cold'
              ELSE 'cold'
            END
            WHERE status IS NOT NULL AND status NOT IN ('cold','warm','hot','replied','bounced','unsubscribed')`
        );
        log(`[ContactStatusNormalize] Normalized ${count} non-canonical status values`);
      } catch (e) {
        console.error('[ContactStatusNormalize] Error:', e instanceof Error ? e.message : e);
      }
    }, 45 * 1000);

    // [ContactStatusRecalc] Keep contacts.status (cold/warm/hot/replied) in sync with messages activity.
    // Tracking endpoints update messages.openedAt/clickedAt/repliedAt in real-time; this sweep flips
    // contacts.status + counters so Warm/Hot filter chips populate. Does NOT touch tracking hot path.
    // Boot sweep at 90s: backfill contacts with activity in last 90 days (cap 10000).
    // Recurring every 6h: delta contacts since last sweep (cap 2000).
    setTimeout(async () => {
      try {
        const cutoff90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const rows = await storage.rawAll(`
          SELECT DISTINCT "contactId" FROM messages
          WHERE "contactId" IS NOT NULL
            AND ("openedAt" IS NOT NULL OR "clickedAt" IS NOT NULL OR "repliedAt" IS NOT NULL)
            AND COALESCE("sentAt", "createdAt") >= ?
          LIMIT 10000
        `, cutoff90d) as any[];
        let recalced = 0;
        for (const r of rows) {
          if (!r.contactId) continue;
          try { await storage.recalculateContactStatus(r.contactId); recalced++; } catch {}
        }
        if (rows.length > 0) log(`[ContactStatusRecalc] Boot sweep: ${rows.length} candidates, ${recalced} contacts recalculated`);
      } catch (e) {
        console.error('[ContactStatusRecalc] Boot sweep error:', e instanceof Error ? e.message : e);
      }

      let lastRecalcAt = new Date().toISOString();
      const runStatusRecalc = async () => {
        try {
          const cutoff = lastRecalcAt;
          const rows = await storage.rawAll(`
            SELECT DISTINCT "contactId" FROM messages
            WHERE "contactId" IS NOT NULL
              AND (("openedAt" IS NOT NULL AND "openedAt" > ?)
                OR ("clickedAt" IS NOT NULL AND "clickedAt" > ?)
                OR ("repliedAt" IS NOT NULL AND "repliedAt" > ?))
            LIMIT 2000
          `, cutoff, cutoff, cutoff) as any[];
          let recalced = 0;
          for (const r of rows) {
            if (!r.contactId) continue;
            try { await storage.recalculateContactStatus(r.contactId); recalced++; } catch {}
          }
          lastRecalcAt = new Date().toISOString();
          if (rows.length > 0) log(`[ContactStatusRecalc] Delta sweep: ${rows.length} candidates, ${recalced} contacts recalculated`);
        } catch (e) {
          console.error('[ContactStatusRecalc] Delta sweep error:', e instanceof Error ? e.message : e);
        }
      };
      setInterval(runStatusRecalc, 6 * 60 * 60 * 1000);
      log('[ContactStatusRecalc] Scheduled: boot sweep complete, delta sweep every 6 hours');

      // [InboxReplyStatusFlip] Flip contacts to 'replied' if they have unified_inbox replies or
      // email_history received entries, but status is still cold/warm/hot. Never touches bounced/
      // unsubscribed/replied. Only upgrades — safe to re-run.
      const runInboxReplyFlip = async () => {
        try {
          const rows = await storage.rawAll(`
            SELECT DISTINCT c.id
            FROM contacts c
            WHERE c.status IN ('cold','warm','hot')
              AND (
                EXISTS (
                  SELECT 1 FROM unified_inbox ui
                  WHERE ui."contactId" = c.id
                    AND (ui.status = 'replied' OR ui."repliedAt" IS NOT NULL
                      OR ui."replyType" IN ('positive','negative','general'))
                )
                OR EXISTS (
                  SELECT 1 FROM email_history eh
                  WHERE eh."organizationId" = c."organizationId"
                    AND LOWER(eh."fromEmail") = LOWER(c.email)
                    AND eh.direction = 'received'
                )
              )
            LIMIT 5000
          `) as any[];
          let flipped = 0;
          for (const r of rows) {
            if (!r.id) continue;
            try {
              await storage.rawRun(
                `UPDATE contacts SET status = 'replied', "updatedAt" = ? WHERE id = ? AND status IN ('cold','warm','hot')`,
                new Date().toISOString(), r.id
              );
              flipped++;
            } catch {}
          }
          if (rows.length > 0) log(`[InboxReplyStatusFlip] ${rows.length} candidates, ${flipped} contacts upgraded to 'replied' from inbox/history signals`);
        } catch (e) {
          console.error('[InboxReplyStatusFlip] sweep error:', e instanceof Error ? e.message : e);
        }
      };
      runInboxReplyFlip();
      setInterval(runInboxReplyFlip, 6 * 60 * 60 * 1000);
      log('[InboxReplyStatusFlip] Scheduled: boot sweep complete, delta sweep every 6 hours');
    }, 90 * 1000);

    // Daily reset of email account send counters (check every hour, reset at midnight UTC)
    let lastResetDay = new Date().getUTCDate();
    setInterval(async () => {
      const today = new Date().getUTCDate();
      if (today !== lastResetDay) {
        lastResetDay = today;
        try {
          await storage.resetDailySentAll();
          log('[DailyReset] Email account daily send counters reset');
          // Immediately resume any campaigns that were auto-paused due to daily limit
          await resumeDailyLimitPausedCampaigns('midnight-reset');
        } catch (e) {
          console.error('[DailyReset] Failed:', e);
        }
      }
    }, 60 * 60 * 1000); // Check every hour

    // Poll every 15 minutes: resume campaigns that were auto-paused due to daily limit
    // but now have email accounts with remaining capacity (e.g. after manual limit increase,
    // or after midnight reset was detected on a different cycle).
    setInterval(async () => {
      await resumeDailyLimitPausedCampaigns('poll');
    }, 15 * 60 * 1000);

    // Campaign Intelligence: live monitor every 5 hours for active campaigns.
    // Runs a degradation check; caches result in api_settings. Only logs if
    // degradation is detected so logs stay clean.
    setInterval(async () => {
      try {
        const activeCampaigns = await storage.rawAll(
          `SELECT DISTINCT c.id, c.name, c."organizationId"
           FROM campaigns c
           WHERE c.status = 'active' AND c."sentCount" >= 10`
        ) as any[];
        if (activeCampaigns.length === 0) return;
        log(`[CampaignIntelligence] Live monitor: checking ${activeCampaigns.length} active campaign(s)`);
        const { runCampaignReviewAgent, saveCachedReview } = await import('./services/campaign-review-agent.js');
        for (const c of activeCampaigns) {
          try {
            const review = await runCampaignReviewAgent(c.organizationId, c.id, 'live');
            await saveCachedReview(c.organizationId, c.id, review);
            if (review.degradation?.detected) {
              log(`[CampaignIntelligence] Degradation detected in "${c.name}" — ${review.degradation.details}`);
            }
          } catch (err) {
            // Non-fatal: skip this campaign if Claude API key not set or network error
          }
        }
      } catch (e) {
        console.error('[CampaignIntelligence] Live monitor error:', e);
      }
    }, 5 * 60 * 60 * 1000); // Every 5 hours

    async function resumeDailyLimitPausedCampaigns(trigger: string) {
      try {
        // Find campaigns auto-paused by the system that have at least one email account
        // in their org with remaining send capacity.
        const candidates = await storage.rawAll(`
          SELECT DISTINCT c.id, c.name, c."sendingConfig"
          FROM campaigns c
          WHERE c.status = 'paused'
            AND c."autoPaused" = true
            AND EXISTS (
              SELECT 1 FROM email_accounts ea
              WHERE ea."organizationId" = c."organizationId"
                AND ea."dailySent" < ea."dailyLimit"
            )
        `) as any[];

        if (candidates.length === 0) return;

        log(`[DailyLimitResume][${trigger}] Found ${candidates.length} auto-paused campaign(s) with available capacity — resuming`);
        for (const row of candidates) {
          try {
            let sendingConfig: any = undefined;
            if (row.sendingConfig) {
              try { sendingConfig = typeof row.sendingConfig === 'string' ? JSON.parse(row.sendingConfig) : row.sendingConfig; } catch {}
            }
            log(`[DailyLimitResume] Resuming campaign: ${row.name} (${row.id})`);
            const result = await campaignEngine.startCampaign({ campaignId: row.id, sendingConfig: sendingConfig || undefined }) as any;
            // If contacts are permanently gone (deleted/re-imported), clear autoPaused so this
            // campaign stops being picked up every 15 min. Does not change the abort logic in startCampaign.
            if (result && result.success === false && result.error && result.error.includes('0 contacts')) {
              console.warn(`[DailyLimitResume] Campaign ${row.id} (${row.name}) has 0 resolvable contacts — clearing autoPaused to stop retry loop`);
              await storage.rawRun(`UPDATE campaigns SET "autoPaused" = false WHERE id = ?`, row.id);
            }
            await new Promise(r => setTimeout(r, 2000));
          } catch (err) {
            console.error(`[DailyLimitResume] Failed to resume campaign ${row.id}:`, err);
          }
        }
      } catch (e) {
        console.error(`[DailyLimitResume][${trigger}] Query failed:`, e);
      }
    }
  });
})();
