import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startFollowupEngine } from "./services/followup-engine";
import { startWarmupEngine } from "./services/warmup-engine";
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
    
    // Auto-resume active campaigns that were interrupted by server restart
    // Delay by 10 seconds to let the server fully initialize (OAuth, DB, etc.)
    setTimeout(async () => {
      try {
        await campaignEngine.resumeActiveCampaigns();
      } catch (e) {
        console.error('[Startup] Failed to resume active campaigns:', e);
      }
    }, 10000);
    
    // One-time reclassification of 'general' inbox messages on boot
    // Runs 30s after startup to not block initial load
    setTimeout(async () => {
      try {
        log('[Reclassify] Starting one-time reclassification of general inbox messages...');
        // Get all orgs that have messages
        const orgs = await storage.rawAll(`SELECT DISTINCT "organizationId" FROM unified_inbox WHERE "replyType" = 'general' LIMIT 20`) as any[];
        let totalReclassified = 0;

        for (const org of orgs) {
          const orgId = org.organizationId;
          // Get general-classified messages for this org
          const generalMsgs = await storage.rawAll(`
            SELECT id, subject, body, snippet, "fromEmail", "fromName"
            FROM unified_inbox
            WHERE "organizationId" = ? AND "replyType" = 'general'
            AND ("sentByUs" IS NULL OR "sentByUs" = 0)
            LIMIT 1000
          `, orgId) as any[];

          let orgReclassified = 0;
          for (const msg of generalMsgs) {
            // Re-run strengthened rule engine
            const ruleResult = classifyReply(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, msg.fromName);
            if (ruleResult.replyType !== 'general') {
              try {
                await storage.rawRun(`UPDATE unified_inbox SET "replyType" = ? WHERE id = ?`, ruleResult.replyType, msg.id);
                orgReclassified++;
              } catch { }
            }
          }

          // AI reclassification for remaining general messages (batch of 100 max)
          if (orgReclassified < generalMsgs.length) {
            const remaining = await storage.rawAll(`
              SELECT id, subject, body, snippet, "fromEmail"
              FROM unified_inbox
              WHERE "organizationId" = ? AND "replyType" = 'general'
              AND ("sentByUs" IS NULL OR "sentByUs" = 0)
              LIMIT 100
            `, orgId) as any[];

            for (const msg of remaining) {
              try {
                const aiResult = await classifyReplyWithAI(msg.subject || '', msg.body || msg.snippet || '', msg.fromEmail, orgId, storage);
                if (aiResult.confidence >= 0.7 && aiResult.replyType !== 'general') {
                  await storage.rawRun(`UPDATE unified_inbox SET "replyType" = ? WHERE id = ?`, aiResult.replyType, msg.id);
                  orgReclassified++;
                }
              } catch { /* skip individual AI failures */ }
            }
          }

          totalReclassified += orgReclassified;
          if (orgReclassified > 0) {
            log(`[Reclassify] Org ${orgId}: reclassified ${orgReclassified}/${generalMsgs.length} messages`);
          }
        }
        log(`[Reclassify] Done. Total reclassified: ${totalReclassified}`);
      } catch (e) {
        console.error('[Reclassify] Boot reclassification error:', e);
      }
    }, 30000);

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
