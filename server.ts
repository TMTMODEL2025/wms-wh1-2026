import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "realtime_space_state.json");

interface UpdatedAtMap {
  inbound?: string;
  outbound?: string;
  pickLists?: string;
  sap?: string;
  spaceConfig?: string;
  machineStaging?: string;
}

interface PersistedServerState {
  warehouseSpaceConfig: Record<string, unknown> | null;
  machineStagingConfig: Record<string, unknown> | null;
  inboundRecords: Record<string, unknown>[];
  outboundRecords: Record<string, unknown>[];
  pickLists: Record<string, unknown>[];
  sapItems: Record<string, unknown>[];
  updatedAtMap: UpdatedAtMap;
}

function sanitizeKey(id: string): string {
  return String(id || "").replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 128);
}

function sortRecordsNewestFirst(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...records].sort((a, b) =>
    String(b.scanTimestamp || "").localeCompare(String(a.scanTimestamp || ""))
  );
}

function sortPickListsNewestFirst(orders: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...orders].sort((a, b) => {
    const timeA = `${String(a.createdDate || "")} ${String(a.createdAt || "")}`;
    const timeB = `${String(b.createdDate || "")} ${String(b.createdAt || "")}`;
    return timeB.localeCompare(timeA);
  });
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
          inboundRecords: Array.isArray(parsed.inboundRecords)
            ? sortRecordsNewestFirst(parsed.inboundRecords)
            : [],
          outboundRecords: Array.isArray(parsed.outboundRecords)
            ? sortRecordsNewestFirst(parsed.outboundRecords)
            : [],
          pickLists: Array.isArray(parsed.pickLists)
            ? sortPickListsNewestFirst(parsed.pickLists)
            : [],
          sapItems: Array.isArray(parsed.sapItems) ? parsed.sapItems : [],
          updatedAtMap:
            parsed.updatedAtMap && typeof parsed.updatedAtMap === "object"
              ? parsed.updatedAtMap
              : {},
        };
      }
    }
  } catch (err) {
    console.error("Failed to load realtime_space_state.json:", err);
  }
  return {
    warehouseSpaceConfig: null,
    machineStagingConfig: null,
    inboundRecords: [],
    outboundRecords: [],
    pickLists: [],
    sapItems: [],
    updatedAtMap: {},
  };
}

let writeQueueTimer: ReturnType<typeof setTimeout> | null = null;

function saveServerState(state: PersistedServerState, immediate = false): void {
  ensureDataDir();
  const writeNow = () => {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to write realtime_space_state.json:", err);
    }
  };

  if (immediate) {
    if (writeQueueTimer) {
      clearTimeout(writeQueueTimer);
      writeQueueTimer = null;
    }
    writeNow();
    return;
  }

  if (writeQueueTimer) {
    clearTimeout(writeQueueTimer);
  }
  writeQueueTimer = setTimeout(() => {
    writeQueueTimer = null;
    writeNow();
  }, 150);
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
  app.use(express.json({ limit: "25mb" }));

  // Get current warehouse space & machine staging state
  app.get("/api/space-config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.json({
      warehouseSpaceConfig: serverState.warehouseSpaceConfig,
      machineStagingConfig: serverState.machineStagingConfig,
    });
  });

  // Get current operational Slit WMS state (Inbound, Outbound, PickLists, Space, Machine Staging)
  app.get("/api/slit-state", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const includeSap = req.query.includeSap === "1";
    res.json({
      inboundRecords: serverState.inboundRecords,
      outboundRecords: serverState.outboundRecords,
      pickLists: serverState.pickLists,
      warehouseSpaceConfig: serverState.warehouseSpaceConfig,
      machineStagingConfig: serverState.machineStagingConfig,
      sapItemCount: serverState.sapItems.length,
      ...(includeSap ? { sapItems: serverState.sapItems } : {}),
      updatedAtMap: serverState.updatedAtMap,
    });
  });

  // Get SAP Master items
  app.get("/api/slit-sap", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.json({
      items: serverState.sapItems,
      chunkCount: serverState.sapItems.length === 0 ? 0 : Math.ceil(serverState.sapItems.length / 800),
      updatedAt: serverState.updatedAtMap.sap || "",
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
    if (serverState.updatedAtMap.inbound || serverState.inboundRecords.length > 0) {
      res.write(
        `event: slit_inbound\ndata: ${JSON.stringify({
          records: serverState.inboundRecords,
          updatedAt: serverState.updatedAtMap.inbound || new Date().toISOString(),
        })}\n\n`
      );
    }
    if (serverState.updatedAtMap.outbound || serverState.outboundRecords.length > 0) {
      res.write(
        `event: slit_outbound\ndata: ${JSON.stringify({
          records: serverState.outboundRecords,
          updatedAt: serverState.updatedAtMap.outbound || new Date().toISOString(),
        })}\n\n`
      );
    }
    if (serverState.updatedAtMap.pickLists || serverState.pickLists.length > 0) {
      res.write(
        `event: slit_picklists\ndata: ${JSON.stringify({
          orders: serverState.pickLists,
          updatedAt: serverState.updatedAtMap.pickLists || new Date().toISOString(),
        })}\n\n`
      );
    }
    if (serverState.updatedAtMap.sap || serverState.sapItems.length > 0) {
      res.write(
        `event: slit_sap_updated\ndata: ${JSON.stringify({
          itemCount: serverState.sapItems.length,
          updatedAt: serverState.updatedAtMap.sap || new Date().toISOString(),
        })}\n\n`
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

  // Upsert Inbound records (Single or Batch)
  app.post("/api/slit-inbound", (req, res) => {
    const { records, seedOnly } = req.body || {};
    if (!Array.isArray(records)) {
      res.status(400).json({ error: "records array required" });
      return;
    }

    if (seedOnly === true && (serverState.updatedAtMap.inbound || serverState.inboundRecords.length > 0)) {
      res.json({
        records: serverState.inboundRecords,
        updatedAt: serverState.updatedAtMap.inbound || "",
      });
      return;
    }

    const map = new Map<string, Record<string, unknown>>();
    for (const r of serverState.inboundRecords) {
      const key = sanitizeKey(String(r.id || r.batch || ""));
      if (key) map.set(key, r);
    }
    for (const incoming of records) {
      if (!incoming || typeof incoming !== "object") continue;
      const rec = incoming as Record<string, unknown>;
      const key = sanitizeKey(String(rec.id || rec.batch || ""));
      if (key) {
        map.set(key, { ...(map.get(key) || {}), ...rec, id: key });
      }
    }

    const nowIso = new Date().toISOString();
    serverState.inboundRecords = sortRecordsNewestFirst(Array.from(map.values()));
    serverState.updatedAtMap.inbound = nowIso;
    saveServerState(serverState);

    const payload = { records: serverState.inboundRecords, updatedAt: nowIso };
    broadcastSseEvent("slit_inbound", payload);
    res.json(payload);
  });

  // Delete Inbound records by id or batches
  app.delete("/api/slit-inbound", (req, res) => {
    const { id, batches } = req.body || {};
    const targetId = id ? sanitizeKey(String(id)) : "";
    const batchSet = new Set<string>(
      Array.isArray(batches)
        ? batches.map((b: unknown) => String(b || "").trim().toUpperCase()).filter(Boolean)
        : []
    );

    const nowIso = new Date().toISOString();
    serverState.inboundRecords = serverState.inboundRecords.filter((r) => {
      const rId = sanitizeKey(String(r.id || ""));
      const rBatch = String(r.batch || "").trim().toUpperCase();
      if (targetId && rId === targetId) return false;
      if (rBatch && batchSet.has(rBatch)) return false;
      return true;
    });
    serverState.updatedAtMap.inbound = nowIso;
    saveServerState(serverState);

    const payload = { records: serverState.inboundRecords, updatedAt: nowIso };
    broadcastSseEvent("slit_inbound", payload);
    res.json(payload);
  });

  // Upsert Outbound records (Single or Batch)
  app.post("/api/slit-outbound", (req, res) => {
    const { records, seedOnly } = req.body || {};
    if (!Array.isArray(records)) {
      res.status(400).json({ error: "records array required" });
      return;
    }

    if (seedOnly === true && (serverState.updatedAtMap.outbound || serverState.outboundRecords.length > 0)) {
      res.json({
        records: serverState.outboundRecords,
        updatedAt: serverState.updatedAtMap.outbound || "",
      });
      return;
    }

    const map = new Map<string, Record<string, unknown>>();
    for (const r of serverState.outboundRecords) {
      const key = sanitizeKey(String(r.id || r.batch || ""));
      if (key) map.set(key, r);
    }
    for (const incoming of records) {
      if (!incoming || typeof incoming !== "object") continue;
      const rec = incoming as Record<string, unknown>;
      const key = sanitizeKey(String(rec.id || rec.batch || ""));
      if (key) {
        map.set(key, { ...(map.get(key) || {}), ...rec, id: key });
      }
    }

    const nowIso = new Date().toISOString();
    serverState.outboundRecords = sortRecordsNewestFirst(Array.from(map.values()));
    serverState.updatedAtMap.outbound = nowIso;
    saveServerState(serverState);

    const payload = { records: serverState.outboundRecords, updatedAt: nowIso };
    broadcastSseEvent("slit_outbound", payload);
    res.json(payload);
  });

  // Delete Outbound records by id, orderNo, or batches
  app.delete("/api/slit-outbound", (req, res) => {
    const { id, orderNo, batches } = req.body || {};
    const targetId = id ? sanitizeKey(String(id)) : "";
    const cleanOrderNo = orderNo ? String(orderNo).trim().toUpperCase() : "";
    const batchSet = new Set<string>(
      Array.isArray(batches)
        ? batches.map((b: unknown) => String(b || "").trim().toUpperCase()).filter(Boolean)
        : []
    );

    const nowIso = new Date().toISOString();
    serverState.outboundRecords = serverState.outboundRecords.filter((r) => {
      const rId = sanitizeKey(String(r.id || ""));
      const rOrderNo = String(r.orderNo || "").trim().toUpperCase();
      const rBatch = String(r.batch || "").trim().toUpperCase();
      if (targetId && rId === targetId) return false;
      if (cleanOrderNo && rOrderNo === cleanOrderNo) return false;
      if (rBatch && batchSet.has(rBatch)) return false;
      return true;
    });
    serverState.updatedAtMap.outbound = nowIso;
    saveServerState(serverState);

    const payload = { records: serverState.outboundRecords, updatedAt: nowIso };
    broadcastSseEvent("slit_outbound", payload);
    res.json(payload);
  });

  // Upsert PickLists (Single or Batch)
  app.post("/api/slit-picklists", (req, res) => {
    const { orders, seedOnly } = req.body || {};
    if (!Array.isArray(orders)) {
      res.status(400).json({ error: "orders array required" });
      return;
    }

    if (seedOnly === true && (serverState.updatedAtMap.pickLists || serverState.pickLists.length > 0)) {
      res.json({
        orders: serverState.pickLists,
        updatedAt: serverState.updatedAtMap.pickLists || "",
      });
      return;
    }

    const map = new Map<string, Record<string, unknown>>();
    for (const o of serverState.pickLists) {
      const key = sanitizeKey(String(o.id || `ORD-${o.orderNo || ""}`));
      if (key) map.set(key, o);
    }
    for (const incoming of orders) {
      if (!incoming || typeof incoming !== "object") continue;
      const ord = incoming as Record<string, unknown>;
      const key = sanitizeKey(String(ord.id || `ORD-${ord.orderNo || ""}`));
      if (key) {
        map.set(key, { ...(map.get(key) || {}), ...ord, id: key });
      }
    }

    const nowIso = new Date().toISOString();
    serverState.pickLists = sortPickListsNewestFirst(Array.from(map.values()));
    serverState.updatedAtMap.pickLists = nowIso;
    saveServerState(serverState);

    const payload = { orders: serverState.pickLists, updatedAt: nowIso };
    broadcastSseEvent("slit_picklists", payload);
    res.json(payload);
  });

  // Delete PickList by orderIdOrNo
  app.delete("/api/slit-picklists", (req, res) => {
    const { orderIdOrNo } = req.body || {};
    const trimmed = String(orderIdOrNo || "").trim();
    const rawOrderNo = (trimmed.startsWith("ORD-") ? trimmed.slice(4) : trimmed).toUpperCase();
    const primaryDocId = sanitizeKey(trimmed.startsWith("ORD-") ? trimmed : `ORD-${trimmed}`);
    const altDocId = sanitizeKey(trimmed);

    const nowIso = new Date().toISOString();
    serverState.pickLists = serverState.pickLists.filter((o) => {
      const oId = sanitizeKey(String(o.id || ""));
      const oOrderNo = String(o.orderNo || "").trim().toUpperCase();
      if (oId === primaryDocId || oId === altDocId) return false;
      if (rawOrderNo && oOrderNo === rawOrderNo) return false;
      return true;
    });
    serverState.updatedAtMap.pickLists = nowIso;
    saveServerState(serverState);

    const payload = { orders: serverState.pickLists, updatedAt: nowIso };
    broadcastSseEvent("slit_picklists", payload);
    res.json(payload);
  });

  // Save SAP Master Data items
  app.post("/api/slit-sap", (req, res) => {
    const { items, seedOnly } = req.body || {};
    if (!Array.isArray(items)) {
      res.status(400).json({ error: "items array required" });
      return;
    }

    if (seedOnly === true && (serverState.updatedAtMap.sap || serverState.sapItems.length > 0)) {
      res.json({
        itemCount: serverState.sapItems.length,
        chunkCount: serverState.sapItems.length === 0 ? 0 : Math.ceil(serverState.sapItems.length / 800),
        updatedAt: serverState.updatedAtMap.sap || "",
      });
      return;
    }

    const dedupMap = new Map<string, Record<string, unknown>>();
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const batch = String(item.batch || "").trim().toUpperCase();
      if (batch) {
        dedupMap.set(batch, { ...item, batch });
      }
    }

    const nowIso = new Date().toISOString();
    serverState.sapItems = Array.from(dedupMap.values());
    serverState.updatedAtMap.sap = nowIso;
    saveServerState(serverState);

    const chunkCount =
      serverState.sapItems.length === 0 ? 0 : Math.ceil(serverState.sapItems.length / 800);
    broadcastSseEvent("slit_sap_updated", {
      itemCount: serverState.sapItems.length,
      chunkCount,
      updatedAt: nowIso,
    });
    res.json({
      itemCount: serverState.sapItems.length,
      chunkCount,
      updatedAt: nowIso,
    });
  });

  // Clear SAP Master Data items
  app.delete("/api/slit-sap", (_req, res) => {
    const nowIso = new Date().toISOString();
    serverState.sapItems = [];
    serverState.updatedAtMap.sap = nowIso;
    saveServerState(serverState);

    broadcastSseEvent("slit_sap_updated", {
      itemCount: 0,
      chunkCount: 0,
      updatedAt: nowIso,
    });
    res.json({ ok: true, updatedAt: nowIso });
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
    const existingMs = existingUpdatedAt ? Date.parse(existingUpdatedAt) || 0 : 0;
    const nowMs = Date.now();
    const monotonicServerIso = new Date(Math.max(nowMs, existingMs + 1)).toISOString();

    const incomingUpdatedAt =
      incoming.seedOnly === true && typeof incoming.updatedAt === "string" && incoming.updatedAt
        ? incoming.updatedAt
        : monotonicServerIso;

    // If incoming is explicitly a seed-only request and server already has state, keep server state
    if (
      incoming.seedOnly === true &&
      existingUpdatedAt &&
      (existingUpdatedAt >= incomingUpdatedAt || Boolean(existing.buildingMaxCapacityTons))
    ) {
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

    const effectiveUpdatedAt =
      incoming.seedOnly === true
        ? incomingUpdatedAt >= existingUpdatedAt
          ? incomingUpdatedAt
          : monotonicServerIso
        : monotonicServerIso;

    const merged: Record<string, unknown> = {
      ...existing,
      ...cleanIncoming,
      id: "warehouse_space_state",
      ...(mergedBuildingCap ? { buildingMaxCapacityTons: mergedBuildingCap } : {}),
      updatedAt: effectiveUpdatedAt,
    };

    serverState.warehouseSpaceConfig = merged;
    serverState.updatedAtMap.spaceConfig = effectiveUpdatedAt;
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
    const effectiveUpdatedAt =
      incomingUpdatedAt >= existingUpdatedAt ? incomingUpdatedAt : new Date().toISOString();

    const merged: Record<string, unknown> = {
      ...existing,
      ...cleanIncoming,
      id: "machine_staging_state",
      updatedAt: effectiveUpdatedAt,
    };

    serverState.machineStagingConfig = merged;
    serverState.updatedAtMap.machineStaging = effectiveUpdatedAt;
    saveServerState(serverState);
    broadcastSseEvent("machine_staging_state", merged);

    res.json({ machineStagingConfig: merged });
  });

  // Reset server state when full cloud reset is triggered
  app.delete("/api/space-config", (_req, res) => {
    const nowIso = new Date().toISOString();
    serverState.warehouseSpaceConfig = null;
    serverState.machineStagingConfig = null;
    serverState.inboundRecords = [];
    serverState.outboundRecords = [];
    serverState.pickLists = [];
    serverState.sapItems = [];
    serverState.updatedAtMap = {
      inbound: nowIso,
      outbound: nowIso,
      pickLists: nowIso,
      sap: nowIso,
      spaceConfig: nowIso,
      machineStaging: nowIso,
    };
    saveServerState(serverState, true);

    broadcastSseEvent("warehouse_space_reset", {});
    broadcastSseEvent("slit_inbound", { records: [], updatedAt: nowIso });
    broadcastSseEvent("slit_outbound", { records: [], updatedAt: nowIso });
    broadcastSseEvent("slit_picklists", { orders: [], updatedAt: nowIso });
    broadcastSseEvent("slit_sap_updated", { itemCount: 0, chunkCount: 0, updatedAt: nowIso });
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
