import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDocs,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import type { SlitBarcodeRecord, PickListOrder, SapMasterItem } from "../components/SlitFilmManagement";
import type { MasterBuildingLayout } from "../data/masterBasketStorage";
import type { MachineStagingConfig } from "../data/machineStagingStorage";

const INBOUND_COLLECTION = "slit_inbound";
const OUTBOUND_COLLECTION = "slit_outbound";
const PICKLIST_COLLECTION = "slit_picklists";
export const SAP_CHUNKS_COLLECTION = "slit_sap_chunks";
export const SAP_CHUNK_SIZE = 800;
export const SPACE_CONFIG_COLLECTION = "slit_space_config";
export const SPACE_CONFIG_DOC_ID = "warehouse_space_state";
export const MACHINE_STAGING_DOC_ID = "machine_staging_state";

function sanitizeDocId(id: string): string {
  return String(id || "").replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 128);
}

function stripUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (obj !== null && typeof obj === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        cleaned[key] = stripUndefinedDeep(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

// ============================================================================
// Firestore Write Circuit Breaker & Bundler (Hybrid Real-Time Architecture)
// ============================================================================
let firestoreQuotaExhaustedUntil = 0;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown when quota is full

function isFirestoreWritePaused(): boolean {
  return Date.now() < firestoreQuotaExhaustedUntil;
}

function markFirestoreWriteExhausted(): void {
  firestoreQuotaExhaustedUntil = Date.now() + QUOTA_COOLDOWN_MS;
}

async function runFirestoreWriteWithQuotaGuard(
  writeFn: () => Promise<void>,
  opType: OperationType,
  path: string
): Promise<boolean> {
  if (isFirestoreWritePaused()) {
    return false;
  }
  try {
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 2500)
    );
    const result = await Promise.race([
      writeFn().then(() => "ok" as const),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      markFirestoreWriteExhausted();
      return false;
    }
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (
      errMsg.includes("resource-exhausted") ||
      errMsg.includes("RESOURCE_EXHAUSTED") ||
      errMsg.includes("Quota limit exceeded")
    ) {
      markFirestoreWriteExhausted();
    }
    handleFirestoreError(error, opType, path);
    return false;
  }
}

// ============================================================================
// Shared Single-Connection SSE & Real-Time State Multiplexer
// ============================================================================
type SseEventName =
  | "warehouse_space_state"
  | "machine_staging_state"
  | "slit_inbound"
  | "slit_outbound"
  | "slit_picklists"
  | "slit_sap_updated"
  | "warehouse_space_reset";

const sseListeners: Record<SseEventName, Set<(payload: any) => void>> = {
  warehouse_space_state: new Set(),
  machine_staging_state: new Set(),
  slit_inbound: new Set(),
  slit_outbound: new Set(),
  slit_picklists: new Set(),
  slit_sap_updated: new Set(),
  warehouse_space_reset: new Set(),
};

const latestSsePayloads: Partial<Record<SseEventName, any>> = {};
let sharedEventSource: EventSource | null = null;
let sharedPollInterval: ReturnType<typeof setInterval> | null = null;
let initialStateFetchPromise: Promise<any> | null = null;

function emitSharedEvent(eventName: SseEventName, payload: any): void {
  if (eventName !== "warehouse_space_reset") {
    latestSsePayloads[eventName] = payload;
  }
  const listeners = sseListeners[eventName];
  if (listeners) {
    listeners.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        // ignore listener error
      }
    });
  }
}

function fetchInitialSlitStateOnce(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!initialStateFetchPromise) {
    initialStateFetchPromise = fetch("/api/slit-state", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data === "object") {
          const updatedAtMap = data.updatedAtMap || {};
          if (data.warehouseSpaceConfig) {
            emitSharedEvent("warehouse_space_state", data.warehouseSpaceConfig);
          }
          if (data.machineStagingConfig) {
            emitSharedEvent("machine_staging_state", data.machineStagingConfig);
          }
          if (Array.isArray(data.inboundRecords) && (updatedAtMap.inbound || data.inboundRecords.length > 0)) {
            emitSharedEvent("slit_inbound", {
              records: data.inboundRecords,
              updatedAt: updatedAtMap.inbound || new Date().toISOString(),
            });
          }
          if (Array.isArray(data.outboundRecords) && (updatedAtMap.outbound || data.outboundRecords.length > 0)) {
            emitSharedEvent("slit_outbound", {
              records: data.outboundRecords,
              updatedAt: updatedAtMap.outbound || new Date().toISOString(),
            });
          }
          if (Array.isArray(data.pickLists) && (updatedAtMap.pickLists || data.pickLists.length > 0)) {
            emitSharedEvent("slit_picklists", {
              orders: data.pickLists,
              updatedAt: updatedAtMap.pickLists || new Date().toISOString(),
            });
          }
          if (typeof data.sapItemCount === "number" && (updatedAtMap.sap || data.sapItemCount > 0)) {
            emitSharedEvent("slit_sap_updated", {
              itemCount: data.sapItemCount,
              updatedAt: updatedAtMap.sap || new Date().toISOString(),
            });
          }
        }
        return data;
      })
      .catch(() => null);
  }
  return initialStateFetchPromise;
}

function ensureSharedRealtimeStream(): void {
  if (typeof window === "undefined") return;

  fetchInitialSlitStateOnce();

  if (!sharedEventSource && typeof EventSource !== "undefined") {
    try {
      sharedEventSource = new EventSource("/api/space-config/stream");
      const events: SseEventName[] = [
        "warehouse_space_state",
        "machine_staging_state",
        "slit_inbound",
        "slit_outbound",
        "slit_picklists",
        "slit_sap_updated",
        "warehouse_space_reset",
      ];
      for (const evtName of events) {
        sharedEventSource.addEventListener(evtName, (evt: MessageEvent) => {
          try {
            const parsed = evt.data ? JSON.parse(evt.data) : {};
            emitSharedEvent(evtName, parsed);
          } catch {
            // ignore malformed JSON
          }
        });
      }
    } catch {
      // ignore EventSource init error
    }
  }

  if (!sharedPollInterval) {
    sharedPollInterval = setInterval(() => {
      fetch("/api/slit-state", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data || typeof data !== "object") return;
          const updatedAtMap = data.updatedAtMap || {};
          if (data.warehouseSpaceConfig) {
            emitSharedEvent("warehouse_space_state", data.warehouseSpaceConfig);
          }
          if (data.machineStagingConfig) {
            emitSharedEvent("machine_staging_state", data.machineStagingConfig);
          }
          if (Array.isArray(data.inboundRecords) && (updatedAtMap.inbound || data.inboundRecords.length > 0)) {
            emitSharedEvent("slit_inbound", {
              records: data.inboundRecords,
              updatedAt: updatedAtMap.inbound || "",
            });
          }
          if (Array.isArray(data.outboundRecords) && (updatedAtMap.outbound || data.outboundRecords.length > 0)) {
            emitSharedEvent("slit_outbound", {
              records: data.outboundRecords,
              updatedAt: updatedAtMap.outbound || "",
            });
          }
          if (Array.isArray(data.pickLists) && (updatedAtMap.pickLists || data.pickLists.length > 0)) {
            emitSharedEvent("slit_picklists", {
              orders: data.pickLists,
              updatedAt: updatedAtMap.pickLists || "",
            });
          }
          if (typeof data.sapItemCount === "number" && (updatedAtMap.sap || data.sapItemCount > 0)) {
            emitSharedEvent("slit_sap_updated", {
              itemCount: data.sapItemCount,
              updatedAt: updatedAtMap.sap || "",
            });
          }
        })
        .catch(() => {});
    }, 5000);
  }
}

function subscribeSharedSse(
  eventName: SseEventName,
  cb: (payload: any) => void
): () => void {
  ensureSharedRealtimeStream();
  sseListeners[eventName].add(cb);
  if (latestSsePayloads[eventName] !== undefined) {
    try {
      cb(latestSsePayloads[eventName]);
    } catch {
      // ignore
    }
  }
  return () => {
    sseListeners[eventName].delete(cb);
  };
}

// Convert Firestore document or raw record to clean SlitBarcodeRecord
function sanitizeRecordPayload(r: SlitBarcodeRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: String(r.id || `REC-${Date.now()}`),
    mode: r.mode || "inbound",
    scanTimestamp: r.scanTimestamp || new Date().toISOString(),
    batch: String(r.batch || "").trim().toUpperCase().slice(0, 32),
    machine: String(r.machine || "SM01").slice(0, 32),
    location: String(r.location || "WH1").slice(0, 64),
    weightKg: typeof r.weightKg === "number" && !isNaN(r.weightKg) ? r.weightKg : 0,
    hasSapData: Boolean(r.hasSapData),
    updatedAt: new Date().toISOString(),
  };

  payload.previousLocation = r.previousLocation ? String(r.previousLocation).slice(0, 64) : "";
  payload.orderNo = r.orderNo ? String(r.orderNo).slice(0, 64) : "";
  if (r.certThickness) payload.certThickness = String(r.certThickness).slice(0, 32);
  if (r.width) payload.width = String(r.width).slice(0, 32);
  if (r.unrestricted) payload.unrestricted = String(r.unrestricted).slice(0, 64);
  if (r.grade) payload.grade = String(r.grade).slice(0, 64);
  if (r.manufacturer) payload.manufacturer = String(r.manufacturer).slice(0, 64);
  if (r.storageLocation) payload.storageLocation = String(r.storageLocation).slice(0, 64);
  if (r.salesDoc) payload.salesDoc = String(r.salesDoc).slice(0, 64);
  if (r.materialNo) payload.materialNo = String(r.materialNo).slice(0, 64);
  if (r.targetThickness) payload.targetThickness = String(r.targetThickness).slice(0, 32);
  if (r.qualityClass) payload.qualityClass = String(r.qualityClass).slice(0, 32);
  if (r.description) payload.description = String(r.description).slice(0, 256);
  if (r.coilNo) payload.coilNo = String(r.coilNo).slice(0, 64);
  payload.conditionText = r.conditionText ? String(r.conditionText).slice(0, 128) : "";

  return stripUndefinedDeep(payload);
}

const LEGACY_SLIT_LOCAL_STORAGE_KEYS = [
  "tmt_wms_slit_inbound_records",
  "tmt_wms_slit_outbound_records",
  "tmt_wms_slit_pick_lists",
  "tmt_wms_space_management_data_v1",
  "tmt_wms_synced_picklist_orders_v1",
  "tmt_wms_cloud_picklists_init_v1",
  "tmt_wms_cloud_outbound_init_v1",
  "tmt_wms_cloud_inbound_init_v1",
  "tmt_wms_slit_deleted_return_batches",
];

/**
 * Clear all legacy localStorage keys for Slit Film Management so only Hybrid Cloud/Server is used.
 */
export function clearLegacySlitLocalStorage(): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      for (const key of LEGACY_SLIT_LOCAL_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Real-time listener for Slit Inbound records (Hybrid Real-Time SSE + Cloud Firestore)
 */
export function subscribeToSlitInbound(
  onData: (records: SlitBarcodeRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  let hasServerState = false;
  let lastSerialized = "";

  const emitSorted = (rawRecords: SlitBarcodeRecord[]) => {
    const sorted = [...rawRecords].sort((a, b) =>
      (b.scanTimestamp || "").localeCompare(a.scanTimestamp || "")
    );
    const serialized = JSON.stringify(sorted);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      onData(sorted);
    }
  };

  const unsubSse = subscribeSharedSse("slit_inbound", (payload) => {
    if (payload && Array.isArray(payload.records)) {
      hasServerState = true;
      emitSorted(payload.records as SlitBarcodeRecord[]);
    }
  });

  const colRef = collection(db, INBOUND_COLLECTION);
  const unsubFirestore = onSnapshot(
    colRef,
    (snapshot) => {
      const records: SlitBarcodeRecord[] = [];
      snapshot.forEach((d) => {
        records.push(d.data() as SlitBarcodeRecord);
      });
      if (records.length > 0 && typeof window !== "undefined") {
        fetch("/api/slit-inbound", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records, seedOnly: true }),
        }).catch(() => {});
      }
      if (!hasServerState) {
        emitSorted(records);
      }
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, INBOUND_COLLECTION);
    }
  );

  return () => {
    unsubSse();
    unsubFirestore();
  };
}

/**
 * Real-time listener for Slit Outbound records (Hybrid Real-Time SSE + Cloud Firestore)
 */
export function subscribeToSlitOutbound(
  onData: (records: SlitBarcodeRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  let hasServerState = false;
  let lastSerialized = "";

  const emitSorted = (rawRecords: SlitBarcodeRecord[]) => {
    const sorted = [...rawRecords].sort((a, b) =>
      (b.scanTimestamp || "").localeCompare(a.scanTimestamp || "")
    );
    const serialized = JSON.stringify(sorted);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      onData(sorted);
    }
  };

  const unsubSse = subscribeSharedSse("slit_outbound", (payload) => {
    if (payload && Array.isArray(payload.records)) {
      hasServerState = true;
      emitSorted(payload.records as SlitBarcodeRecord[]);
    }
  });

  const colRef = collection(db, OUTBOUND_COLLECTION);
  const unsubFirestore = onSnapshot(
    colRef,
    (snapshot) => {
      const records: SlitBarcodeRecord[] = [];
      snapshot.forEach((d) => {
        records.push(d.data() as SlitBarcodeRecord);
      });
      if (records.length > 0 && typeof window !== "undefined") {
        fetch("/api/slit-outbound", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records, seedOnly: true }),
        }).catch(() => {});
      }
      if (!hasServerState) {
        emitSorted(records);
      }
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, OUTBOUND_COLLECTION);
    }
  );

  return () => {
    unsubSse();
    unsubFirestore();
  };
}

/**
 * Real-time listener for Slit Pick Lists (Hybrid Real-Time SSE + Cloud Firestore)
 */
export function subscribeToSlitPickLists(
  onData: (orders: PickListOrder[]) => void,
  onError?: (err: unknown) => void
): () => void {
  let hasServerState = false;
  let lastSerialized = "";

  const emitSorted = (rawOrders: PickListOrder[]) => {
    const sorted = [...rawOrders].sort((a, b) => {
      const timeA = `${a.createdDate || ""} ${a.createdAt || ""}`;
      const timeB = `${b.createdDate || ""} ${b.createdAt || ""}`;
      return timeB.localeCompare(timeA);
    });
    const serialized = JSON.stringify(sorted);
    if (serialized !== lastSerialized) {
      lastSerialized = serialized;
      onData(sorted);
    }
  };

  const unsubSse = subscribeSharedSse("slit_picklists", (payload) => {
    if (payload && Array.isArray(payload.orders)) {
      hasServerState = true;
      emitSorted(payload.orders as PickListOrder[]);
    }
  });

  const colRef = collection(db, PICKLIST_COLLECTION);
  const unsubFirestore = onSnapshot(
    colRef,
    (snapshot) => {
      const orders: PickListOrder[] = [];
      snapshot.forEach((d) => {
        orders.push(d.data() as PickListOrder);
      });
      if (orders.length > 0 && typeof window !== "undefined") {
        fetch("/api/slit-picklists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orders, seedOnly: true }),
        }).catch(() => {});
      }
      if (!hasServerState) {
        emitSorted(orders);
      }
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, PICKLIST_COLLECTION);
    }
  );

  return () => {
    unsubSse();
    unsubFirestore();
  };
}

/**
 * Save single inbound record to Server API + Firestore
 */
export async function saveInboundRecordToCloud(record: SlitBarcodeRecord): Promise<void> {
  const docId = sanitizeDocId(record.id || `IN-${record.batch}-${Date.now()}`);
  const payload = sanitizeRecordPayload({ ...record, id: docId });

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [payload] }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.records) emitSharedEvent("slit_inbound", data);
      }
    } catch {
      // ignore server API error
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    () => setDoc(doc(db, INBOUND_COLLECTION, docId), payload, { merge: true }),
    OperationType.WRITE,
    `${INBOUND_COLLECTION}/${docId}`
  );
}

/**
 * Save single outbound record to Server API + Firestore
 */
export async function saveOutboundRecordToCloud(record: SlitBarcodeRecord): Promise<void> {
  const docId = sanitizeDocId(record.id || `OUT-${record.batch}-${Date.now()}`);
  const payload = sanitizeRecordPayload({ ...record, id: docId, mode: "outbound" });

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [payload] }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.records) emitSharedEvent("slit_outbound", data);
      }
    } catch {
      // ignore server API error
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    () => setDoc(doc(db, OUTBOUND_COLLECTION, docId), payload, { merge: true }),
    OperationType.WRITE,
    `${OUTBOUND_COLLECTION}/${docId}`
  );
}

/**
 * Batch save multiple inbound records to Server API + Firestore
 */
export async function batchSaveInboundToCloud(records: SlitBarcodeRecord[]): Promise<void> {
  if (records.length === 0) return;
  const payloads = records.map((r) => {
    const docId = sanitizeDocId(r.id || `IN-${r.batch}-${Date.now()}`);
    return sanitizeRecordPayload({ ...r, id: docId });
  });

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: payloads }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.records) emitSharedEvent("slit_inbound", data);
      }
    } catch {
      // ignore server API error
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const batch = writeBatch(db);
      for (const payload of payloads) {
        const docId = String(payload.id);
        batch.set(doc(db, INBOUND_COLLECTION, docId), payload, { merge: true });
      }
      await batch.commit();
    },
    OperationType.WRITE,
    INBOUND_COLLECTION
  );
}

/**
 * Batch save multiple outbound records to Server API + Firestore
 */
export async function batchSaveOutboundToCloud(records: SlitBarcodeRecord[]): Promise<void> {
  if (records.length === 0) return;
  const payloads = records.map((r) => {
    const docId = sanitizeDocId(r.id || `OUT-${r.batch}-${Date.now()}`);
    return sanitizeRecordPayload({ ...r, id: docId, mode: "outbound" });
  });

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: payloads }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.records) emitSharedEvent("slit_outbound", data);
      }
    } catch {
      // ignore server API error
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const batch = writeBatch(db);
      for (const payload of payloads) {
        const docId = String(payload.id);
        batch.set(doc(db, OUTBOUND_COLLECTION, docId), payload, { merge: true });
      }
      await batch.commit();
    },
    OperationType.WRITE,
    OUTBOUND_COLLECTION
  );
}

/**
 * Delete a record from Server API + Firestore
 */
export async function deleteRecordFromCloud(
  collectionName: "slit_inbound" | "slit_outbound",
  id: string
): Promise<void> {
  const docId = sanitizeDocId(id);
  const endpoint = collectionName === "slit_inbound" ? "/api/slit-inbound" : "/api/slit-outbound";
  const eventName = collectionName === "slit_inbound" ? "slit_inbound" : "slit_outbound";

  if (typeof window !== "undefined") {
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: docId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.records) emitSharedEvent(eventName, data);
      }
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    () => deleteDoc(doc(db, collectionName, docId)),
    OperationType.DELETE,
    `${collectionName}/${docId}`
  );
}

function sanitizePickListOrderPayload(order: PickListOrder): Record<string, unknown> {
  const docId = sanitizeDocId(order.id || `ORD-${order.orderNo}`);
  const rawItems = Array.isArray(order.items) ? order.items : [];
  const cleanItems = rawItems.map((item, idx) => {
    const cleanItem: Record<string, unknown> = {
      id: String(item.id || `PLI-${docId}-${idx}`),
      bomItem: String(item.bomItem || ""),
      material: String(item.material || ""),
      description: String(item.description || ""),
      reqQty: typeof item.reqQty === "number" && !isNaN(item.reqQty) ? item.reqQty : 0,
      unit: String(item.unit || "KG"),
      itemCategory: String(item.itemCategory || ""),
      operation: String(item.operation || ""),
      sequence: String(item.sequence || ""),
      plant: String(item.plant || ""),
      storageLocation: String(item.storageLocation || ""),
      batch: String(item.batch || "").trim().toUpperCase(),
      status: item.status === "verified" ? "verified" : "pending",
      machineIssued: Boolean(item.machineIssued),
    };
    if (item.scannedAt) {
      cleanItem.scannedAt = String(item.scannedAt);
    }
    if (item.machineIssuedAt) {
      cleanItem.machineIssuedAt = String(item.machineIssuedAt);
    }
    return stripUndefinedDeep(cleanItem);
  });

  const validCheckPool = cleanItems.filter((i) =>
    Boolean(i.batch && /^[A-Za-z0-9]{10}$/.test(String(i.batch).trim()))
  );
  const pool = validCheckPool.length > 0 ? validCheckPool : cleanItems;
  const allVerified = pool.length > 0 && pool.every((i) => i.status === "verified");
  const someVerified = pool.some((i) => i.status === "verified");

  const resolvedStatus =
    order.status === "completed" || allVerified
      ? "completed"
      : order.status === "in_progress" || someVerified
      ? "in_progress"
      : "pending";

  const payload: Record<string, unknown> = {
    id: docId,
    orderNo: String(order.orderNo || "").trim(),
    machineId: String(order.machineId || "TM01").trim(),
    machineType: order.machineType || "pipe",
    createdAt: String(order.createdAt || ""),
    createdDate: String(order.createdDate || ""),
    status: resolvedStatus,
    items: cleanItems,
    operatorDismissed: Boolean(order.operatorDismissed),
    updatedAt: new Date().toISOString(),
  };

  return stripUndefinedDeep(payload);
}

/**
 * Save pick list order to Server API + Firestore
 */
export async function savePickListToCloud(order: PickListOrder): Promise<void> {
  const docId = sanitizeDocId(order.id || `ORD-${order.orderNo}`);
  const payload = sanitizePickListOrderPayload(order);

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-picklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: [payload] }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.orders) emitSharedEvent("slit_picklists", data);
      }
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    () => setDoc(doc(db, PICKLIST_COLLECTION, docId), payload, { merge: true }),
    OperationType.WRITE,
    `${PICKLIST_COLLECTION}/${docId}`
  );
}

/**
 * Batch save multiple pick list orders to Server API + Firestore
 */
export async function batchSavePickListsToCloud(orders: PickListOrder[]): Promise<void> {
  if (orders.length === 0) return;
  const payloads = orders.map((o) => sanitizePickListOrderPayload(o));

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-picklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: payloads }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.orders) emitSharedEvent("slit_picklists", data);
      }
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const batch = writeBatch(db);
      for (const payload of payloads) {
        const docId = String(payload.id);
        batch.set(doc(db, PICKLIST_COLLECTION, docId), payload, { merge: true });
      }
      await batch.commit();
    },
    OperationType.WRITE,
    PICKLIST_COLLECTION
  );
}

/**
 * Delete pick list order from Server API + Firestore (removes by docId and any matching orderNo document)
 */
export async function deletePickListFromCloud(orderIdOrNo: string): Promise<void> {
  const trimmed = orderIdOrNo.trim();
  const rawOrderNo = trimmed.startsWith("ORD-") ? trimmed.slice(4) : trimmed;
  const primaryDocId = sanitizeDocId(trimmed.startsWith("ORD-") ? trimmed : `ORD-${trimmed}`);

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-picklists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIdOrNo: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.orders) emitSharedEvent("slit_picklists", data);
      }
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      await deleteDoc(doc(db, PICKLIST_COLLECTION, primaryDocId));
      const snap = await getDocs(collection(db, PICKLIST_COLLECTION));
      const batch = writeBatch(db);
      let hasExtra = false;
      snap.forEach((d) => {
        const data = d.data() as PickListOrder;
        const docOrderNo = (data?.orderNo || "").trim().toUpperCase();
        if (
          d.id === sanitizeDocId(trimmed) ||
          docOrderNo === rawOrderNo.toUpperCase()
        ) {
          batch.delete(d.ref);
          hasExtra = true;
        }
      });
      if (hasExtra) {
        await batch.commit();
      }
    },
    OperationType.DELETE,
    `${PICKLIST_COLLECTION}/${primaryDocId}`
  );
}

/**
 * Delete outbound records linked to a deleted Pick List Order (by orderNo or batch list)
 */
export async function deleteOutboundByOrderOrBatchesFromCloud(
  orderNo: string,
  batches: string[]
): Promise<void> {
  const cleanOrderNo = orderNo.trim().toUpperCase();
  const cleanBatches = batches.map((b) => b.trim().toUpperCase()).filter(Boolean);
  const batchSet = new Set(cleanBatches);
  if (!cleanOrderNo && batchSet.size === 0) return;

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-outbound", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: cleanOrderNo, batches: cleanBatches }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.records) emitSharedEvent("slit_outbound", data);
      }
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const snap = await getDocs(collection(db, OUTBOUND_COLLECTION));
      const batch = writeBatch(db);
      let hasDeletes = false;
      snap.forEach((d) => {
        const data = d.data() as SlitBarcodeRecord;
        const recOrderNo = (data?.orderNo || "").trim().toUpperCase();
        const recBatch = (data?.batch || "").trim().toUpperCase();
        if (
          (cleanOrderNo && recOrderNo === cleanOrderNo) ||
          (recBatch && batchSet.has(recBatch))
        ) {
          batch.delete(d.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await batch.commit();
      }
    },
    OperationType.DELETE,
    OUTBOUND_COLLECTION
  );
}

/**
 * Delete inbound records by batch list from Server API + Firestore
 */
export async function deleteInboundByBatchesFromCloud(batches: string[]): Promise<void> {
  const cleanBatches = batches.map((b) => b.trim().toUpperCase()).filter(Boolean);
  const batchSet = new Set(cleanBatches);
  if (batchSet.size === 0) return;

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/slit-inbound", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batches: cleanBatches }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.records) emitSharedEvent("slit_inbound", data);
      }
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const snap = await getDocs(collection(db, INBOUND_COLLECTION));
      const batch = writeBatch(db);
      let hasDeletes = false;
      snap.forEach((d) => {
        const data = d.data() as SlitBarcodeRecord;
        const recBatch = (data?.batch || "").trim().toUpperCase();
        if (recBatch && batchSet.has(recBatch)) {
          batch.delete(d.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await batch.commit();
      }
    },
    OperationType.DELETE,
    INBOUND_COLLECTION
  );
}

/**
 * Sanitize a single SAP Master Item so it is compact and safe for Firestore storage
 */
function sanitizeSapMasterItem(item: SapMasterItem): SapMasterItem {
  const safeWeight =
    typeof item.weightKg === "number" && !isNaN(item.weightKg) && item.weightKg >= 0 && item.weightKg <= 100000
      ? item.weightKg
      : 0;
  return {
    batch: String(item.batch || "").trim().toUpperCase().slice(0, 32),
    salesDoc: String(item.salesDoc || "").trim().slice(0, 64),
    materialNo: String(item.materialNo || "").trim().slice(0, 64),
    certThickness: String(item.certThickness || "").trim().slice(0, 32),
    storageLocation: String(item.storageLocation || "").trim().slice(0, 64),
    targetThickness: String(item.targetThickness || "").trim().slice(0, 32),
    width: String(item.width || "").trim().slice(0, 32),
    weightKg: safeWeight,
    unrestricted: String(item.unrestricted || `${safeWeight.toLocaleString()} kg`).trim().slice(0, 64),
    qualityClass: String(item.qualityClass || "").trim().slice(0, 32),
    grade: String(item.grade || "").trim().slice(0, 64),
    manufacturer: String(item.manufacturer || "").trim().slice(0, 64),
    description: String(item.description || "").trim().slice(0, 256),
    coilNo: String(item.coilNo || "").trim().slice(0, 64),
    conditionText: String(item.conditionText || "").trim().slice(0, 128),
  };
}

export interface SlitSapChunkDoc {
  id: string;
  chunkIndex: number;
  totalChunks: number;
  totalItems: number;
  itemCount: number;
  items: SapMasterItem[];
  updatedAt: string;
}

/**
 * Real-time listener for bundled SAP Master Data chunks (800 items per document)
 * Uses Hybrid Real-Time SSE (/api/slit-sap) + Cloud Firestore
 */
export function subscribeToSlitSapMaster(
  onData: (items: SapMasterItem[], chunkCount: number) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  let hasServerSap = false;
  let lastSapUpdatedAt = "";

  const fetchServerSap = () => {
    if (typeof window === "undefined" || isDisposed) return;
    fetch("/api/slit-sap", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isDisposed || !data || !Array.isArray(data.items)) return;
        if (data.updatedAt || data.items.length > 0) {
          hasServerSap = true;
          lastSapUpdatedAt = data.updatedAt || lastSapUpdatedAt;
          const count =
            typeof data.chunkCount === "number"
              ? data.chunkCount
              : data.items.length === 0
              ? 0
              : Math.ceil(data.items.length / SAP_CHUNK_SIZE);
          onData(data.items as SapMasterItem[], count);
        }
      })
      .catch(() => {});
  };

  fetchServerSap();

  const unsubSse = subscribeSharedSse("slit_sap_updated", (payload) => {
    if (!payload) return;
    if (payload.updatedAt && payload.updatedAt !== lastSapUpdatedAt) {
      fetchServerSap();
    }
  });

  const colRef = collection(db, SAP_CHUNKS_COLLECTION);
  const unsubFirestore = onSnapshot(
    colRef,
    (snapshot) => {
      const chunks: SlitSapChunkDoc[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as SlitSapChunkDoc;
        if (data && Array.isArray(data.items)) {
          chunks.push(data);
        }
      });
      chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
      const allItems: SapMasterItem[] = [];
      for (const ch of chunks) {
        for (const itm of ch.items) {
          if (itm && itm.batch) {
            allItems.push(itm);
          }
        }
      }
      if (allItems.length > 0 && typeof window !== "undefined") {
        fetch("/api/slit-sap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: allItems, seedOnly: true }),
        }).catch(() => {});
      }
      if (!hasServerSap) {
        onData(allItems, chunks.length);
      }
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, SAP_CHUNKS_COLLECTION);
    }
  );

  return () => {
    isDisposed = true;
    unsubSse();
    unsubFirestore();
  };
}

/**
 * Bundle SAP Master Data into chunks of 800 items per document and commit to Server API + Firestore.
 */
export async function saveSapMasterChunksToCloud(
  items: SapMasterItem[]
): Promise<{ chunkCount: number; itemCount: number }> {
  const dedupMap = new Map<string, SapMasterItem>();
  for (const raw of items) {
    if (!raw || !raw.batch) continue;
    const cleaned = sanitizeSapMasterItem(raw);
    if (cleaned.batch) {
      dedupMap.set(cleaned.batch, cleaned);
    }
  }
  const cleanItems = Array.from(dedupMap.values());
  const totalItems = cleanItems.length;
  const totalChunks = totalItems === 0 ? 0 : Math.ceil(totalItems / SAP_CHUNK_SIZE);
  const nowIso = new Date().toISOString();

  if (typeof window !== "undefined") {
    try {
      await fetch("/api/slit-sap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cleanItems }),
      });
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const existingSnap = await getDocs(collection(db, SAP_CHUNKS_COLLECTION));
      const newChunkIds = new Set<string>();
      const batch = writeBatch(db);

      for (let idx = 0; idx < totalChunks; idx++) {
        const slice = cleanItems.slice(idx * SAP_CHUNK_SIZE, (idx + 1) * SAP_CHUNK_SIZE);
        const docId = `SAP_CHUNK_${String(idx + 1).padStart(4, "0")}`;
        newChunkIds.add(docId);

        const chunkPayload: SlitSapChunkDoc = {
          id: docId,
          chunkIndex: idx,
          totalChunks,
          totalItems,
          itemCount: slice.length,
          items: slice,
          updatedAt: nowIso,
        };
        batch.set(doc(db, SAP_CHUNKS_COLLECTION, docId), stripUndefinedDeep(chunkPayload));
      }

      existingSnap.forEach((d) => {
        if (!newChunkIds.has(d.id)) {
          batch.delete(d.ref);
        }
      });

      await batch.commit();
    },
    OperationType.WRITE,
    SAP_CHUNKS_COLLECTION
  );

  return { chunkCount: totalChunks, itemCount: totalItems };
}

/**
 * Clear all SAP Master Data chunks from Server API + Cloud Firestore
 */
export async function clearSapMasterChunksFromCloud(): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      await fetch("/api/slit-sap", { method: "DELETE" });
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const snap = await getDocs(collection(db, SAP_CHUNKS_COLLECTION));
      if (snap.empty) return;
      const batch = writeBatch(db);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    },
    OperationType.DELETE,
    SAP_CHUNKS_COLLECTION
  );
}

export interface SlitWarehouseSpaceSummaryBuilding {
  buildingId: "H" | "F" | "E9" | "E10" | "I";
  buildingNameTh: string;
  maxCapacityTons: number;
  usedSpaceTons: number;
  remainingSpaceTons: number;
  totalBaskets: number;
  usedBaskets: number;
  totalCoils: number;
  percent: number;
  spaceUsagePercent: number;
}

export interface SlitWarehouseSpaceSummarySnapshot {
  totalMaxCapacityTons: number;
  totalUsedSpaceTons: number;
  totalRemainingSpaceTons: number;
  totalBaskets: number;
  totalUsedBaskets: number;
  totalCoils: number;
  basketPercent: number;
  spacePercent: number;
  buildings: SlitWarehouseSpaceSummaryBuilding[];
}

export interface SlitWarehouseSpaceCloudDoc {
  id: string;
  buildingMaxCapacityTons?: Record<"H" | "F" | "E9" | "E10" | "I", number>;
  masterLayout?: MasterBuildingLayout[];
  statusOverrides?: Record<string, { status: string; notes?: string; lastUpdated?: string }>;
  summarySnapshot?: SlitWarehouseSpaceSummarySnapshot;
  updatedAt: string;
}

const LOCAL_CAP_STORAGE_KEY = "tmt_wms_building_max_capacity_tons_v1";
const LOCAL_CAP_UPDATED_AT_KEY = "tmt_wms_building_max_capacity_updated_at_v1";

/**
 * Real-time listener for Slit Warehouse Space Configuration & Summary Metrics
 * (buildingMaxCapacityTons, masterLayout, statusOverrides, summarySnapshot)
 * Combines Express real-time API/SSE (/api/space-config) + Cloud Firestore with timestamp conflict resolution
 */
export function subscribeToSlitSpaceConfig(
  onData: (config: SlitWarehouseSpaceCloudDoc | null) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  let latestUpdatedAt = "";
  let latestDoc: SlitWarehouseSpaceCloudDoc | null = null;
  let apiResponded = false;
  let firestoreResponded = false;

  const mergeWithNewerLocalCapacity = (
    docData: SlitWarehouseSpaceCloudDoc
  ): { mergedDoc: SlitWarehouseSpaceCloudDoc; localWasNewer: boolean } => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const localCapUpdatedAt = window.localStorage.getItem(LOCAL_CAP_UPDATED_AT_KEY) || "";
        const localCapRaw = window.localStorage.getItem(LOCAL_CAP_STORAGE_KEY);
        const docUpdatedAt = docData.updatedAt || "";

        if (localCapRaw && localCapUpdatedAt && localCapUpdatedAt > docUpdatedAt) {
          const parsedLocalCap = JSON.parse(localCapRaw);
          if (parsedLocalCap && typeof parsedLocalCap === "object") {
            return {
              mergedDoc: {
                ...docData,
                buildingMaxCapacityTons: {
                  ...(docData.buildingMaxCapacityTons || {}),
                  ...parsedLocalCap,
                },
                updatedAt: localCapUpdatedAt,
              },
              localWasNewer: true,
            };
          }
        }
      }
    } catch {
      // ignore localStorage read error
    }
    return { mergedDoc: docData, localWasNewer: false };
  };

  const handleIncomingDoc = (
    rawDoc: SlitWarehouseSpaceCloudDoc | null,
    source: "api" | "firestore"
  ) => {
    if (isDisposed) return;

    if (source === "api") apiResponded = true;
    if (source === "firestore") firestoreResponded = true;

    if (!rawDoc) {
      if (latestDoc === null && apiResponded && firestoreResponded) {
        onData(null);
      }
      return;
    }

    // If server API has already responded with live state, ignore older Firestore snapshots
    // (since Firestore daily write quota may be exhausted while Server API has the newest cross-device state)
    if (source === "firestore" && apiResponded && latestDoc) {
      const fsTs = rawDoc.updatedAt || "";
      if (!fsTs || (latestUpdatedAt && fsTs <= latestUpdatedAt)) {
        return;
      }
    }

    let mergedDoc = rawDoc;
    let localWasNewer = false;

    if (source === "firestore" && !apiResponded) {
      const res = mergeWithNewerLocalCapacity(rawDoc);
      mergedDoc = res.mergedDoc;
      localWasNewer = res.localWasNewer;
    }

    const incomingTs = mergedDoc.updatedAt || "";

    if (source === "firestore") {
      fetch("/api/space-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...mergedDoc,
          seedOnly: !localWasNewer,
        }),
      }).catch(() => {});
    }

    if (source === "firestore" && latestDoc && latestUpdatedAt && incomingTs && incomingTs < latestUpdatedAt) {
      return;
    }

    latestDoc = {
      ...(latestDoc || {}),
      ...mergedDoc,
      buildingMaxCapacityTons: {
        ...(latestDoc?.buildingMaxCapacityTons || {}),
        ...(mergedDoc.buildingMaxCapacityTons || {}),
      },
    };
    if (incomingTs > latestUpdatedAt || source === "api") {
      latestUpdatedAt = incomingTs || new Date().toISOString();
    }

    onData(latestDoc);
  };

  const unsubSse = subscribeSharedSse("warehouse_space_state", (payload) => {
    handleIncomingDoc(payload as SlitWarehouseSpaceCloudDoc, "api");
  });

  if (typeof window !== "undefined") {
    fetch("/api/space-config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.warehouseSpaceConfig) {
          handleIncomingDoc(json.warehouseSpaceConfig as SlitWarehouseSpaceCloudDoc, "api");
        } else {
          handleIncomingDoc(null, "api");
        }
      })
      .catch(() => {
        apiResponded = true;
      });
  }

  const docRef = doc(db, SPACE_CONFIG_COLLECTION, SPACE_CONFIG_DOC_ID);
  const unsubFirestore = onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        if (snapshot.metadata.fromCache) {
          return;
        }
        handleIncomingDoc(null, "firestore");
        return;
      }
      handleIncomingDoc(snapshot.data() as SlitWarehouseSpaceCloudDoc, "firestore");
    },
    (error) => {
      firestoreResponded = true;
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, `${SPACE_CONFIG_COLLECTION}/${SPACE_CONFIG_DOC_ID}`);
    }
  );

  return () => {
    isDisposed = true;
    unsubSse();
    unsubFirestore();
  };
}

let pendingSpaceFirestorePayload: Record<string, unknown> | null = null;
let spaceFirestoreDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Save or merge Slit Warehouse Space Configuration & Summary Metrics to Server API + Cloud Firestore (Bundled)
 */
export async function saveSlitSpaceConfigToCloud(
  partial: Partial<Omit<SlitWarehouseSpaceCloudDoc, "id" | "updatedAt">>
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload = stripUndefinedDeep({
    id: SPACE_CONFIG_DOC_ID,
    ...partial,
    updatedAt: nowIso,
  });

  if (partial.buildingMaxCapacityTons && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_CAP_UPDATED_AT_KEY, nowIso);
    } catch {
      // ignore
    }
  }

  // 1. Always persist immediately to backend /api/space-config (instant SSE broadcast)
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/space-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.warehouseSpaceConfig) {
          emitSharedEvent("warehouse_space_state", data.warehouseSpaceConfig);
        }
      }
    } catch (err) {
      console.warn("Failed to post space-config to server API:", err);
    }
  }

  // 2. Bundle / debounce Firestore writes to save daily write quota
  if (isFirestoreWritePaused()) {
    return;
  }

  pendingSpaceFirestorePayload = {
    ...(pendingSpaceFirestorePayload || {}),
    ...payload,
    ...(partial.buildingMaxCapacityTons
      ? {
          buildingMaxCapacityTons: {
            ...((pendingSpaceFirestorePayload?.buildingMaxCapacityTons as Record<string, unknown>) || {}),
            ...partial.buildingMaxCapacityTons,
          },
        }
      : {}),
    updatedAt: nowIso,
  };

  if (spaceFirestoreDebounceTimer) {
    clearTimeout(spaceFirestoreDebounceTimer);
  }

  spaceFirestoreDebounceTimer = setTimeout(() => {
    spaceFirestoreDebounceTimer = null;
    const toWrite = pendingSpaceFirestorePayload;
    pendingSpaceFirestorePayload = null;
    if (!toWrite) return;

    runFirestoreWriteWithQuotaGuard(
      () =>
        setDoc(doc(db, SPACE_CONFIG_COLLECTION, SPACE_CONFIG_DOC_ID), toWrite, {
          merge: true,
        }),
      OperationType.WRITE,
      `${SPACE_CONFIG_COLLECTION}/${SPACE_CONFIG_DOC_ID}`
    ).catch(() => {});
  }, 1200);
}

export interface SlitMachineStagingGroupSummary {
  totalMachines: number;
  totalRacks: number;
  totalCapacityMeters: number;
  totalCapacityTons: number;
  usedRacks: number;
  occupiedRacks: number;
  fullRacks: number;
  usedMeters: number;
  usedTons: number;
  availableRacks: number;
  availableMeters: number;
  availableTons: number;
  maintenanceRacks: number;
  maintenanceMeters: number;
  maintenanceTons: number;
  usagePercent: number;
}

export interface SlitMachineStagingSummarySnapshot {
  all: SlitMachineStagingGroupSummary;
  tm: SlitMachineStagingGroupSummary;
  cf: SlitMachineStagingGroupSummary;
}

export interface SlitMachineStagingCloudDoc {
  id: string;
  machines: MachineStagingConfig[];
  summarySnapshot?: SlitMachineStagingSummarySnapshot;
  productionStatus?: Record<
    string,
    {
      waitingMoveInActive: boolean;
      waitingMoveInCoils: number;
      waitingSlitActive: boolean;
      waitingSlitCoils: number;
    }
  >;
  updatedAt: string;
}

/**
 * Real-time listener for Machine Staging Area (TM 1-14 / CF 1, 2, 4, 5) in Server API + Cloud Firestore
 */
export function subscribeToSlitMachineStaging(
  onData: (docData: SlitMachineStagingCloudDoc | null) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  let latestUpdatedAt = "";
  let latestDoc: SlitMachineStagingCloudDoc | null = null;
  let apiResponded = false;
  let firestoreResponded = false;

  const handleIncomingDoc = (
    rawDoc: SlitMachineStagingCloudDoc | null,
    source: "api" | "firestore"
  ) => {
    if (isDisposed) return;
    if (source === "api") apiResponded = true;
    if (source === "firestore") firestoreResponded = true;

    if (!rawDoc) {
      if (latestDoc === null && apiResponded && firestoreResponded) {
        onData(null);
      }
      return;
    }

    const incomingTs = rawDoc.updatedAt || "";
    if (source === "firestore") {
      fetch("/api/machine-staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rawDoc, seedOnly: true }),
      }).catch(() => {});
    }

    if (latestDoc && latestUpdatedAt && incomingTs && incomingTs < latestUpdatedAt) {
      return;
    }

    latestDoc = { ...(latestDoc || {}), ...rawDoc };
    if (incomingTs > latestUpdatedAt) {
      latestUpdatedAt = incomingTs;
    }
    onData(latestDoc);
  };

  const unsubSse = subscribeSharedSse("machine_staging_state", (payload) => {
    handleIncomingDoc(payload as SlitMachineStagingCloudDoc, "api");
  });

  if (typeof window !== "undefined") {
    fetch("/api/space-config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.machineStagingConfig) {
          handleIncomingDoc(json.machineStagingConfig as SlitMachineStagingCloudDoc, "api");
        } else {
          handleIncomingDoc(null, "api");
        }
      })
      .catch(() => {
        apiResponded = true;
      });
  }

  const docRef = doc(db, SPACE_CONFIG_COLLECTION, MACHINE_STAGING_DOC_ID);
  const unsubFirestore = onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        if (snapshot.metadata.fromCache) {
          return;
        }
        handleIncomingDoc(null, "firestore");
        return;
      }
      handleIncomingDoc(snapshot.data() as SlitMachineStagingCloudDoc, "firestore");
    },
    (error) => {
      firestoreResponded = true;
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, `${SPACE_CONFIG_COLLECTION}/${MACHINE_STAGING_DOC_ID}`);
    }
  );

  return () => {
    isDisposed = true;
    unsubSse();
    unsubFirestore();
  };
}

let pendingMachineFirestorePayload: Record<string, unknown> | null = null;
let machineFirestoreDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Save or merge Machine Staging Area (TM 1-14 / CF 1, 2, 4, 5) state and summary snapshot to Server API + Cloud Firestore (Bundled)
 */
export async function saveSlitMachineStagingToCloud(
  partial: Partial<Omit<SlitMachineStagingCloudDoc, "id" | "updatedAt">>
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload = stripUndefinedDeep({
    id: MACHINE_STAGING_DOC_ID,
    ...partial,
    updatedAt: nowIso,
  });

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/machine-staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.machineStagingConfig) {
          emitSharedEvent("machine_staging_state", data.machineStagingConfig);
        }
      }
    } catch (err) {
      console.warn("Failed to post machine-staging to server API:", err);
    }
  }

  if (isFirestoreWritePaused()) {
    return;
  }

  pendingMachineFirestorePayload = {
    ...(pendingMachineFirestorePayload || {}),
    ...payload,
    updatedAt: nowIso,
  };

  if (machineFirestoreDebounceTimer) {
    clearTimeout(machineFirestoreDebounceTimer);
  }

  machineFirestoreDebounceTimer = setTimeout(() => {
    machineFirestoreDebounceTimer = null;
    const toWrite = pendingMachineFirestorePayload;
    pendingMachineFirestorePayload = null;
    if (!toWrite) return;

    runFirestoreWriteWithQuotaGuard(
      () =>
        setDoc(doc(db, SPACE_CONFIG_COLLECTION, MACHINE_STAGING_DOC_ID), toWrite, {
          merge: true,
        }),
      OperationType.WRITE,
      `${SPACE_CONFIG_COLLECTION}/${MACHINE_STAGING_DOC_ID}`
    ).catch(() => {});
  }, 1200);
}

/**
 * Clear all documents in Server API and slit_picklists, slit_outbound, slit_inbound, slit_sap_chunks, and slit_space_config on full reset
 */
export async function clearAllSlitDataFromCloud(): Promise<void> {
  clearLegacySlitLocalStorage();

  if (typeof window !== "undefined") {
    try {
      await fetch("/api/space-config", { method: "DELETE" });
    } catch {
      // ignore
    }
  }

  await runFirestoreWriteWithQuotaGuard(
    async () => {
      const [pickSnap, outSnap, inSnap, sapSnap, spaceSnap] = await Promise.all([
        getDocs(collection(db, PICKLIST_COLLECTION)),
        getDocs(collection(db, OUTBOUND_COLLECTION)),
        getDocs(collection(db, INBOUND_COLLECTION)),
        getDocs(collection(db, SAP_CHUNKS_COLLECTION)),
        getDocs(collection(db, SPACE_CONFIG_COLLECTION)),
      ]);

      const allRefs = [
        ...pickSnap.docs.map((d) => d.ref),
        ...outSnap.docs.map((d) => d.ref),
        ...inSnap.docs.map((d) => d.ref),
        ...sapSnap.docs.map((d) => d.ref),
        ...spaceSnap.docs.map((d) => d.ref),
      ];

      for (let i = 0; i < allRefs.length; i += 400) {
        const chunk = allRefs.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
    },
    OperationType.DELETE,
    PICKLIST_COLLECTION
  );
}

/**
 * Legacy auto-migration is disabled: clears legacy localStorage keys and relies 100% on Hybrid Cloud/Server.
 */
export async function syncLocalDataToFirestoreIfEmpty(
  _localInbound?: SlitBarcodeRecord[],
  _localOutbound?: SlitBarcodeRecord[],
  _localPickLists?: PickListOrder[]
): Promise<void> {
  clearLegacySlitLocalStorage();
}
