import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startFollowupEngine } from "./services/followup-engine";
import { startWarmupEngine } from "./services/warmup-engine";
import { startNudgeEmailEngine } from "./services/nudge-email-engine";
import { campaignEngine } from "./services/campaign-engine";
import { storage } from "./storage";

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
    // Start the nudge email engine (daily nudge digests at 10 AM & 2:30 PM IST)
    try { startNudgeEmailEngine(); } catch (e) { console.error('[Startup] Nudge email engine failed to start:', e); }
    
    // Auto-resume active campaigns that were interrupted by server restart
    // Delay by 10 seconds to let the server fully initialize (OAuth, DB, etc.)
    setTimeout(async () => {
      try {
        await campaignEngine.resumeActiveCampaigns();
      } catch (e) {
        console.error('[Startup] Failed to resume active campaigns:', e);
      }
      // Also check for scheduled campaigns whose scheduledAt has passed (lost on server restart)
      try {
        const db = (storage as any).db;
        const overdue = db.prepare(`
          SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduledAt IS NOT NULL AND scheduledAt <= ?
        `).all(new Date().toISOString()) as any[];
        for (const raw of overdue) {
          try {
            let sendingConfig = raw.sendingConfig;
            if (typeof sendingConfig === 'string') { try { sendingConfig = JSON.parse(sendingConfig); } catch { sendingConfig = null; } }
            log(`[Startup] Starting overdue scheduled campaign "${raw.name}" (${raw.id}) — was scheduled for ${raw.scheduledAt}`);
            await campaignEngine.startCampaign({
              campaignId: raw.id,
              delayBetweenEmails: sendingConfig?.delayBetweenEmails || 2000,
              batchSize: sendingConfig?.batchSize || 10,
              sendingConfig: sendingConfig || undefined,
            });
          } catch (e) {
            console.error(`[Startup] Failed to start scheduled campaign ${raw.id}:`, e);
          }
        }
        if (overdue.length > 0) log(`[Startup] Started ${overdue.length} overdue scheduled campaign(s)`);
      } catch (e) {
        console.error('[Startup] Failed to check scheduled campaigns:', e);
      }
    }, 10000);
    
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

    // ── Auto-resume paused/stuck campaigns when their sending window opens ──
    // This poller handles:
    //   1. Paused campaigns whose sending window has re-opened (auto-resume)
    //   2. Active campaigns that lost their in-memory send loop (crash recovery)
    //   3. Server restarts while campaign was sleeping between windows
    // Checks every 5 minutes.
    setInterval(async () => {
      try {
        const db = (storage as any).db;
        // Find paused AND active campaigns with sending config
        // Active campaigns that aren't in activeCampaigns are stuck (sendBatched crashed)
        const campaigns = db.prepare(`
          SELECT * FROM campaigns WHERE status IN ('paused', 'active') AND sendingConfig IS NOT NULL AND sendingConfig != '{}'
        `).all() as any[];

        for (const raw of campaigns) {
          try {
            // Skip if campaign engine already has it in memory and is running
            const inMemory = (campaignEngine as any).activeCampaigns?.has(raw.id);
            if (inMemory) {
              // Check for dead campaigns: in activeCampaigns but stuck (0 sent for 10+ min)
              if (raw.status === 'active' && (raw.sentCount || 0) === 0) {
                const updatedAt = new Date(raw.updatedAt || raw.createdAt).getTime();
                if (Date.now() - updatedAt > 10 * 60 * 1000) {
                  log(`[AutoResume] Campaign "${raw.name}" (${raw.id}) stuck — active with 0 sent for 10+ min. Cleaning up for restart.`);
                  (campaignEngine as any).activeCampaigns?.delete(raw.id);
                  // Fall through to restart below
                } else {
                  continue; // Recently started, give it time
                }
              } else {
                continue; // Running normally
              }
            }

            let sendingConfig = raw.sendingConfig;
            if (typeof sendingConfig === 'string') {
              try { sendingConfig = JSON.parse(sendingConfig); } catch { continue; }
            }

            // For campaigns without autopilot: if status is 'active' but not in memory, restart them
            if (!sendingConfig?.autopilot?.enabled) {
              if (raw.status === 'active') {
                log(`[AutoResume] Campaign "${raw.name}" (${raw.id}) is active but not in memory — restarting`);
                campaignEngine.startCampaign({
                  campaignId: raw.id,
                  delayBetweenEmails: sendingConfig?.delayBetweenEmails || 2000,
                  batchSize: sendingConfig?.batchSize || 10,
                  sendingConfig: sendingConfig || undefined,
                }).then(result => {
                  if (result.success) log(`[AutoResume] Recovered stuck campaign "${raw.name}" (${raw.id})`);
                  else log(`[AutoResume] Failed to recover campaign "${raw.name}": ${result.error}`);
                }).catch(e => console.error(`[AutoResume] Error recovering campaign ${raw.id}:`, e));
              }
              continue;
            }

            // Autopilot-enabled campaigns: check if we're inside the sending window
            const autopilot = sendingConfig.autopilot;

            // Get user local time using campaign's timezone
            let userLocal: Date;
            if (sendingConfig.timezone) {
              try {
                const localStr = new Date().toLocaleString('en-US', { timeZone: sendingConfig.timezone });
                userLocal = new Date(localStr);
              } catch {
                const now = new Date();
                const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
                userLocal = new Date(utcMs - (sendingConfig.timezoneOffset || 0) * 60000);
              }
            } else {
              const now = new Date();
              const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
              userLocal = new Date(utcMs - (sendingConfig.timezoneOffset || 0) * 60000);
            }

            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayName = dayNames[userLocal.getDay()];
            const dayConfig = autopilot.days?.[dayName];

            if (!dayConfig?.enabled) continue; // Not a sending day

            const currentHH = String(userLocal.getHours()).padStart(2, '0');
            const currentMM = String(userLocal.getMinutes()).padStart(2, '0');
            const currentTime = `${currentHH}:${currentMM}`;

            if (dayConfig.startTime && currentTime < dayConfig.startTime) continue; // Before window
            if (dayConfig.endTime && currentTime >= dayConfig.endTime) continue; // After window

            // We're inside the sending window — auto-resume this campaign
            log(`[AutoResume] Campaign "${raw.name}" (${raw.id}) status=${raw.status} inside sending window (${dayConfig.startTime}-${dayConfig.endTime} ${dayName}) — auto-resuming`);

            const delayBetweenEmails = sendingConfig.delayBetweenEmails || 2000;
            campaignEngine.startCampaign({
              campaignId: raw.id,
              delayBetweenEmails,
              batchSize: sendingConfig.batchSize || 10,
              sendingConfig,
            }).then(result => {
              if (result.success) {
                log(`[AutoResume] Successfully resumed campaign "${raw.name}" (${raw.id})`);
              } else {
                log(`[AutoResume] Failed to resume campaign "${raw.name}": ${result.error}`);
              }
            }).catch(e => {
              console.error(`[AutoResume] Error resuming campaign ${raw.id}:`, e);
            });
          } catch (e) {
            // Skip individual campaign errors
          }
        }
      } catch (e) {
        console.error('[AutoResume] Poller error:', e);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    // Run first auto-resume check 30 seconds after startup (don't wait 5 minutes for first poll)
    setTimeout(async () => {
      try {
        const db = (storage as any).db;
        const stuckActive = db.prepare(`
          SELECT id, name FROM campaigns WHERE status = 'active' AND sendingConfig IS NOT NULL
        `).all() as any[];
        for (const raw of stuckActive) {
          if (!(campaignEngine as any).activeCampaigns?.has(raw.id)) {
            log(`[Startup] Campaign "${raw.name}" (${raw.id}) is active in DB but not in memory — will be recovered by auto-resume poller`);
          }
        }
      } catch (e) { /* diagnostic only */ }
    }, 30000);
  });
})();
