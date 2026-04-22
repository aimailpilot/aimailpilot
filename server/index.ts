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

    // Daily reset of email account send counters (check every hour, reset at midnight UTC)
    let lastResetDay = new Date().getUTCDate();
    setInterval(async () => {
      const today = new Date().getUTCDate();
      if (today !== lastResetDay) {
        lastResetDay = today;
        try {
          await storage.resetDailySentAll();
          log('[DailyReset] Email account daily send counters reset');
        } catch (e) {
          console.error('[DailyReset] Failed:', e);
        }
      }
    }, 60 * 60 * 1000); // Check every hour
  });
})();
