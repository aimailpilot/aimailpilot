import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${Date.now()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // When running from source (tsx), dist/public is relative to project root
  // When running from built dist/index.js, public/ is adjacent
  let distPath = path.resolve(import.meta.dirname, "public");
  
  if (!fs.existsSync(distPath)) {
    // Fallback: try from project root (when running with tsx from source)
    distPath = path.resolve(import.meta.dirname, "..", "dist", "public");
  }

  if (!fs.existsSync(distPath)) {
    // Fallback: try from current working directory (Azure deployment)
    distPath = path.resolve(process.cwd(), "dist", "public");
  }

  if (!fs.existsSync(distPath)) {
    console.error(`[Static] Could not find build directory. Tried:
      - ${path.resolve(import.meta.dirname, "public")}
      - ${path.resolve(import.meta.dirname, "..", "dist", "public")}
      - ${path.resolve(process.cwd(), "dist", "public")}
    `);
    // Don't crash - serve a basic error page instead
    app.use("*", (_req, res) => {
      res.status(503).send("Application is starting up. Build artifacts not found.");
    });
    return;
  }

  console.log(`[Static] Serving static files from: ${distPath}`);
  app.use(express.static(distPath));

  // Return 404 for unmatched API routes (don't serve SPA for API endpoints)
  app.use("/api/*", (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // SPA fallback: serve index.html for all other routes (client-side routing)
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
