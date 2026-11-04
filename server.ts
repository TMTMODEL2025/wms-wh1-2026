import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "realtime_space_state.json");

interface PersistedServerState {
  warehouseSpaceConfig: Record<string, unknown> | null;
  machineStagingConfig: Record<string, unknown> | null;
}

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("Failed to create .data directory:", err);
  }
}

function loadServerState(): PersistedServerState {
  ensureDataDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          warehouseSpaceConfig: parsed.warehouseSpaceConfig || null,
          machineStagingConfig: parsed.machineStagingConfig || null,
        };
      }
    }
  } catch (err) {
    console.error("Failed to load realtime_space_state.json:", err);
  }
  return {
    warehouseSpaceConfig: null,
    machineStagingConfig: null,
  };
}

function saveServerState(state: PersistedServerState): void {
  ensureDataDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write realtime_space_state.json:", err);
  }
}

const serverState: PersistedServerState = loadServerState();
const sseClients = new Set<express.Response>();

function broadcastSseEvent(eventName: string, data: unknown): void {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  // Get current warehouse space & machine staging state
  app.get("/api/space-config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.json({
      warehouseSpaceConfig: serverState.warehouseSpaceConfig,
      machineStagingConfig: serverState.machineStagingConfig,
    });
  });

  // Real-time Server-Sent Events (SSE) stream for instant cross-browser / shared-link updates
  app.get("/api/space-config/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    sseClients.add(res);

    // Immediately send current state upon connection
    if (serverState.warehouseSpaceConfig) {
      res.write(
        `event: warehouse_space_state\ndata: ${JSON.stringify(serverState.warehouseSpaceConfig)}\n\n`
      );
    }
    if (serverState.machineStagingConfig) {
      res.write(
        `event: machine_staging_state\ndata: ${JSON.stringify(serverState.machineStagingConfig)}\n\n`
      );
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Merge & persist warehouse space configuration (buildingMaxCapacityTons, masterLayout, statusOverrides, summarySnapshot)
  app.post("/api/space-config", (req, res) => {
    const incoming = req.body;
    if (!incoming || typeof incoming !== "object") {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    const existing = (serverState.warehouseSpaceConfig || {}) as Record<string, unknown>;
    const existingUpdatedAt = typeof existing.updatedAt === "string" ? existing.updatedAt : "";
    const incomingUpdatedAt =
      typeof incoming.updatedAt === "string" && incoming.updatedAt
        ? incoming.updatedAt
        : new Date().toISOString();

    // If incoming is explicitly a seed-only request and server already has newer state, keep server state
    if (incoming.seedOnly === true && existingUpdatedAt && existingUpdatedAt >= incomingUpdatedAt) {
      res.json({ warehouseSpaceConfig: serverState.warehouseSpaceConfig });
      return;
    }

    const { seedOnly: _seedOnly, ...cleanIncoming } = incoming as Record<string, unknown>;

    const mergedBuildingCap =
      cleanIncoming.buildingMaxCapacityTons && typeof cleanIncoming.buildingMaxCapacityTons === "object"
        ? {
            ...((existing.buildingMaxCapacityTons as Record<string, unknown>) || {}),
            ...(cleanIncoming.buildingMaxCapacityTons as Record<string, unknown>),
          }
        : existing.buildingMaxCapacityTons;

    const merged: Record<string, unknown> = {
      ...existing,
      ...cleanIncoming,
      id: "warehouse_space_state",
      ...(mergedBuildingCap ? { buildingMaxCapacityTons: mergedBuildingCap } : {}),
      updatedAt: incomingUpdatedAt >= existingUpdatedAt ? incomingUpdatedAt : new Date().toISOString(),
    };

    serverState.warehouseSpaceConfig = merged;
    saveServerState(serverState);
    broadcastSseEvent("warehouse_space_state", merged);

    res.json({ warehouseSpaceConfig: merged });
  });

  // Merge & persist machine staging configuration
  app.post("/api/machine-staging", (req, res) => {
    const incoming = req.body;
    if (!incoming || typeof incoming !== "object") {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    const existing = (serverState.machineStagingConfig || {}) as Record<string, unknown>;
    const existingUpdatedAt = typeof existing.updatedAt === "string" ? existing.updatedAt : "";
    const incomingUpdatedAt =
      typeof incoming.updatedAt === "string" && incoming.updatedAt
        ? incoming.updatedAt
        : new Date().toISOString();

    if (incoming.seedOnly === true && existingUpdatedAt && existingUpdatedAt >= incomingUpdatedAt) {
      res.json({ machineStagingConfig: serverState.machineStagingConfig });
      return;
    }

    const { seedOnly: _seedOnly, ...cleanIncoming } = incoming as Record<string, unknown>;

    const merged: Record<string, unknown> = {
      ...existing,
      ...cleanIncoming,
      id: "machine_staging_state",
      updatedAt: incomingUpdatedAt >= existingUpdatedAt ? incomingUpdatedAt : new Date().toISOString(),
    };

    serverState.machineStagingConfig = merged;
    saveServerState(serverState);
    broadcastSseEvent("machine_staging_state", merged);

    res.json({ machineStagingConfig: merged });
  });

  // Reset server state when full cloud reset is triggered
  app.delete("/api/space-config", (_req, res) => {
    serverState.warehouseSpaceConfig = null;
    serverState.machineStagingConfig = null;
    saveServerState(serverState);
    broadcastSseEvent("warehouse_space_reset", {});
    res.json({ ok: true });
  });

  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.npm_lifecycle_event === "start" ||
    (fs.existsSync(path.join(process.cwd(), "dist", "index.html")) &&
      process.env.npm_lifecycle_event !== "dev");

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
