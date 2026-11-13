import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { dbCoil, handleFirestoreError, OperationType } from "./firebase";

// ============================================================================
// Dedicated Firestore Collections for Steel Coil Management (100% Isolated)
// ============================================================================
export const COIL_STOCK_COLLECTION = "coil_stock";
export const COIL_TRANSACTIONS_COLLECTION = "coil_transactions";
export const COIL_STAGING_COLLECTION = "coil_staging";
export const COIL_LAYOUTS_COLLECTION = "coil_layouts";
export const COIL_SAP_CHUNKS_COLLECTION = "coil_sap_chunks";

export type CoilModeTab =
  | "inbound"
  | "operator_receive"
  | "outbound"
  | "relocate_layout"
  | "stock_balance";

export type CoilStatus = "available" | "staged" | "issued";

export interface CoilStockRecord {
  id: string;
  batch: string; // Primary Barcode / Batch No. (e.g., MC2600125A or 10-char SAP batch)
  coilNo: string; // Mother Coil / Mill Coil No.
  location: string; // Current Layout Bay/Slot (e.g., CL1-A01, CL2-B02)
  previousLocation?: string;
  status: CoilStatus;
  weightKg: number;
  initialWeightKg: number;
  certThickness: string; // e.g. "2.00"
  targetThickness?: string;
  width: string; // e.g. "1219"
  grade: string; // e.g. "SS400", "SPCC", "SGCC"
  manufacturer: string; // e.g. "SSI", "GJ", "POSCO", "JFE"
  supplier?: string;
  machine?: string; // Source or Target Slitting Machine (e.g., SM01, SM02, EXTERNAL)
  inboundType?: "external" | "internal";
  orderNo?: string;
  stagedOrderNo?: string;
  stagedMachineId?: string;
  stagedAt?: string;
  issuedOrderNo?: string;
  issuedMachineId?: string;
  issuedAt?: string;
  materialNo?: string;
  salesDoc?: string;
  qualityClass?: string;
  description?: string;
  remark?: string;
  hasSapData?: boolean;
  scanTimestamp: string;
  updatedAt: string;
}

export interface CoilTransactionRecord {
  id: string;
  txType: "inbound" | "staging" | "issue" | "relocate" | "return" | "adjust";
  batch: string;
  coilNo: string;
  weightKg: number;
  fromLocation: string;
  toLocation: string;
  machineId?: string;
  orderNo?: string;
  grade?: string;
  thickness?: string;
  width?: string;
  manufacturer?: string;
  operator?: string;
  remark?: string;
  timestamp: string; // YYYY-MM-DD HH:mm:ss
  dateYmd: string; // YYYY-MM-DD
  updatedAt: string;
}

export interface CoilStagingItem {
  id: string;
  batch: string;
  coilNo: string;
  grade: string;
  thickness: string;
  width: string;
  weightKg: number;
  sourceLocation: string;
  status: "pending" | "staged" | "issued";
  stagedAt?: string;
  issuedAt?: string;
  description?: string;
}

export interface CoilStagingOrder {
  id: string;
  orderNo: string;
  machineId: string; // e.g. SM01, SM02, SM03, SM04
  createdDate: string; // YYYY-MM-DD
  createdAt: string; // HH:mm:ss
  status: "pending" | "in_progress" | "completed";
  items: CoilStagingItem[];
  remark?: string;
  updatedAt: string;
}

export interface CoilLayoutZone {
  id: string;
  bayCode: string; // e.g. "CL1-A01", "CL1-A02", "CL2-A01"
  bayGroup: "CL1" | "CL2" | "BUFFER" | string;
  zoneName: string;
  maxCapacityTons: number;
  maxCoils: number;
  description?: string;
  updatedAt: string;
}

export interface CoilQueryOptions {
  onlyPositiveStock?: boolean;
  dateFilter?: string;
  endDateFilter?: string;
}

export const DEFAULT_COIL_LAYOUT_ZONES: CoilLayoutZone[] = [
  {
    id: "LAYOUT-CL1-A01",
    bayCode: "CL1-A01",
    bayGroup: "CL1",
    zoneName: "Bay CL1 โซน A1 (Hot Rolled SS400)",
    maxCapacityTons: 350,
    maxCoils: 25,
    description: "พื้นที่จัดเก็บเหล็กม้วนดำ HR ใกล้เครื่องสลิต SM01-SM02",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "LAYOUT-CL1-A02",
    bayCode: "CL1-A02",
    bayGroup: "CL1",
    zoneName: "Bay CL1 โซน A2 (Hot Rolled Pickled)",
    maxCapacityTons: 350,
    maxCoils: 25,
    description: "พื้นที่จัดเก็บเหล็กม้วนหลัก โซนกลางอาคาร CL1",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "LAYOUT-CL1-B01",
    bayCode: "CL1-B01",
    bayGroup: "CL1",
    zoneName: "Bay CL1 โซน B1 (Heavy Gauge Coil)",
    maxCapacityTons: 400,
    maxCoils: 30,
    description: "พื้นที่รับน้ำหนักสูงสำหรับม้วนเหล็กหนาพิเศษ",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "LAYOUT-CL2-A01",
    bayCode: "CL2-A01",
    bayGroup: "CL2",
    zoneName: "Bay CL2 โซน A1 (Cold Rolled SPCC)",
    maxCapacityTons: 350,
    maxCoils: 25,
    description: "พื้นที่จัดเก็บเหล็กม้วนขาว CR และ GI",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "LAYOUT-CL2-B01",
    bayCode: "CL2-B01",
    bayGroup: "CL2",
    zoneName: "Bay CL2 โซน B1 (Galvanized SGCC)",
    maxCapacityTons: 350,
    maxCoils: 25,
    description: "พื้นที่จัดเก็บเหล็กม้วนชุบซิงค์และรอจ่าย SM03-SM04",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "LAYOUT-STG-SM",
    bayCode: "STG-SM01",
    bayGroup: "BUFFER",
    zoneName: "จุดพักม้วนรอเข้าเครื่องสลิต (Coil Staging Buffer)",
    maxCapacityTons: 200,
    maxCoils: 15,
    description: "จุดพักเหล็กม้วนที่เตรียมเบิกหน้าเครื่องสลิต",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

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

export function formatNowTimestamp(): { timestamp: string; dateYmd: string; timeHms: string } {
  const now = new Date();
  const dateYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeHms = now.toTimeString().slice(0, 8);
  return {
    timestamp: `${dateYmd} ${timeHms}`,
    dateYmd,
    timeHms,
  };
}

// ============================================================================
// Write Circuit Breaker & Quota Guard for dbCoil
// ============================================================================
let coilQuotaExhaustedUntil = 0;
const COIL_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

function isCoilWritePaused(): boolean {
  return Date.now() < coilQuotaExhaustedUntil;
}

function markCoilWriteExhausted(): void {
  coilQuotaExhaustedUntil = Date.now() + COIL_QUOTA_COOLDOWN_MS;
}

async function runCoilFirestoreWriteWithGuard(
  writeFn: () => Promise<void>,
  opType: OperationType,
  path: string
): Promise<boolean> {
  if (isCoilWritePaused()) {
    return false;
  }
  try {
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 3000)
    );
    const result = await Promise.race([
      writeFn().then(() => "ok" as const),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      markCoilWriteExhausted();
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
      markCoilWriteExhausted();
    }
    handleFirestoreError(error, opType, path);
    return false;
  }
}

// ============================================================================
// Isolated Listener Registry & Cloud Real-Time Mode Manager for Coil
// Prevents Read quota leaks when user switches away from Coil Management
// ============================================================================
const COIL_CLOUD_REALTIME_STORAGE_KEY = "tmt_wms_coil_cloud_realtime_enabled_v1";
const activeCoilFirestoreListeners = new Map<string, () => void>();
const coilRealtimeModeSubscribers = new Set<(enabled: boolean) => void>();

let coilCloudRealtimeEnabled: boolean = (() => {
  if (typeof window === "undefined") return true;
  try {
    const saved = window.localStorage.getItem(COIL_CLOUD_REALTIME_STORAGE_KEY);
    return saved === null ? true : saved !== "false";
  } catch {
    return true;
  }
})();

function registerCoilFirestoreListener(channelKey: string, unsubFn: () => void): () => void {
  const existing = activeCoilFirestoreListeners.get(channelKey);
  if (existing) {
    try {
      existing();
    } catch {
      // ignore cleanup error
    }
    activeCoilFirestoreListeners.delete(channelKey);
  }
  activeCoilFirestoreListeners.set(channelKey, unsubFn);
  return () => {
    try {
      unsubFn();
    } catch {
      // ignore cleanup error
    }
    if (activeCoilFirestoreListeners.get(channelKey) === unsubFn) {
      activeCoilFirestoreListeners.delete(channelKey);
    }
  };
}

/**
 * Immediately clears all active Firestore listeners for Coil Management.
 * Must be called when unmounting CoilManagement or switching to another menu.
 */
export function unsubscribeAllCoilFirestoreListeners(): void {
  activeCoilFirestoreListeners.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // ignore cleanup error
    }
  });
  activeCoilFirestoreListeners.clear();
}

/**
 * Alias for unsubscribeAllCoilFirestoreListeners() to satisfy strict unsubscribe() contract
 */
export const unsubscribe = unsubscribeAllCoilFirestoreListeners;

export function getActiveCoilListenerCount(): number {
  return activeCoilFirestoreListeners.size;
}

export function getCoilCloudRealtimeEnabled(): boolean {
  return coilCloudRealtimeEnabled;
}

export function setCoilCloudRealtimeEnabled(enabled: boolean): void {
  if (coilCloudRealtimeEnabled === enabled) return;
  coilCloudRealtimeEnabled = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COIL_CLOUD_REALTIME_STORAGE_KEY, enabled ? "true" : "false");
    } catch {
      // ignore storage error
    }
  }
  if (!enabled) {
    unsubscribeAllCoilFirestoreListeners();
  }
  coilRealtimeModeSubscribers.forEach((cb) => {
    try {
      cb(enabled);
    } catch {
      // ignore callback error
    }
  });
}

export function subscribeCoilCloudRealtimeMode(cb: (enabled: boolean) => void): () => void {
  coilRealtimeModeSubscribers.add(cb);
  return () => {
    coilRealtimeModeSubscribers.delete(cb);
  };
}

// ============================================================================
// Payload Sanitizers
// ============================================================================
function sanitizeCoilStockPayload(r: Partial<CoilStockRecord> & { batch: string; location: string }): CoilStockRecord {
  const { timestamp } = formatNowTimestamp();
  const cleanBatch = String(r.batch || "").trim().toUpperCase().slice(0, 64);
  const docId = sanitizeDocId(r.id || `COIL-${cleanBatch}`);
  const safeWeight = typeof r.weightKg === "number" && !isNaN(r.weightKg) ? Math.max(0, r.weightKg) : 0;
  const safeInitWeight =
    typeof r.initialWeightKg === "number" && !isNaN(r.initialWeightKg) && r.initialWeightKg > 0
      ? r.initialWeightKg
      : safeWeight;

  const payload: CoilStockRecord = {
    id: docId,
    batch: cleanBatch,
    coilNo: String(r.coilNo || cleanBatch).trim().toUpperCase().slice(0, 64),
    location: String(r.location || "CL1-A01").trim().toUpperCase().slice(0, 64),
    previousLocation: String(r.previousLocation || "").trim().toUpperCase().slice(0, 64),
    status: r.status === "staged" || r.status === "issued" ? r.status : "available",
    weightKg: safeWeight,
    initialWeightKg: safeInitWeight,
    certThickness: String(r.certThickness || "2.00").trim().slice(0, 32),
    targetThickness: String(r.targetThickness || r.certThickness || "2.00").trim().slice(0, 32),
    width: String(r.width || "1219").trim().slice(0, 32),
    grade: String(r.grade || "SS400").trim().toUpperCase().slice(0, 64),
    manufacturer: String(r.manufacturer || "SSI").trim().toUpperCase().slice(0, 64),
    supplier: String(r.supplier || r.manufacturer || "SSI").trim().slice(0, 64),
    machine: String(r.machine || "EXTERNAL").trim().toUpperCase().slice(0, 32),
    inboundType: r.inboundType === "internal" ? "internal" : "external",
    orderNo: String(r.orderNo || "").trim().slice(0, 64),
    stagedOrderNo: String(r.stagedOrderNo || "").trim().slice(0, 64),
    stagedMachineId: String(r.stagedMachineId || "").trim().slice(0, 32),
    stagedAt: String(r.stagedAt || "").trim().slice(0, 64),
    issuedOrderNo: String(r.issuedOrderNo || "").trim().slice(0, 64),
    issuedMachineId: String(r.issuedMachineId || "").trim().slice(0, 32),
    issuedAt: String(r.issuedAt || "").trim().slice(0, 64),
    materialNo: String(r.materialNo || "").trim().slice(0, 64),
    salesDoc: String(r.salesDoc || "").trim().slice(0, 64),
    qualityClass: String(r.qualityClass || "A").trim().slice(0, 32),
    description: String(r.description || `Steel Coil ${r.grade || "SS400"} ${r.certThickness || "2.00"}x${r.width || "1219"}mm`).trim().slice(0, 256),
    remark: String(r.remark || "").trim().slice(0, 256),
    hasSapData: Boolean(r.hasSapData),
    scanTimestamp: String(r.scanTimestamp || timestamp).trim().slice(0, 64),
    updatedAt: new Date().toISOString(),
  };

  return stripUndefinedDeep(payload);
}

function sanitizeCoilTransactionPayload(
  tx: Partial<CoilTransactionRecord> & { batch: string; txType: CoilTransactionRecord["txType"] }
): CoilTransactionRecord {
  const { timestamp, dateYmd } = formatNowTimestamp();
  const cleanBatch = String(tx.batch || "").trim().toUpperCase().slice(0, 64);
  const docId = sanitizeDocId(tx.id || `CTX-${tx.txType.toUpperCase()}-${cleanBatch}-${Date.now()}`);

  const payload: CoilTransactionRecord = {
    id: docId,
    txType: tx.txType,
    batch: cleanBatch,
    coilNo: String(tx.coilNo || cleanBatch).trim().toUpperCase().slice(0, 64),
    weightKg: typeof tx.weightKg === "number" && !isNaN(tx.weightKg) ? tx.weightKg : 0,
    fromLocation: String(tx.fromLocation || "-").trim().slice(0, 64),
    toLocation: String(tx.toLocation || "-").trim().slice(0, 64),
    machineId: String(tx.machineId || "").trim().slice(0, 32),
    orderNo: String(tx.orderNo || "").trim().slice(0, 64),
    grade: String(tx.grade || "SS400").trim().slice(0, 64),
    thickness: String(tx.thickness || "").trim().slice(0, 32),
    width: String(tx.width || "").trim().slice(0, 32),
    manufacturer: String(tx.manufacturer || "").trim().slice(0, 64),
    operator: String(tx.operator || "ADMIN").trim().slice(0, 64),
    remark: String(tx.remark || "").trim().slice(0, 256),
    timestamp: String(tx.timestamp || timestamp).trim().slice(0, 64),
    dateYmd: String(tx.dateYmd || (tx.timestamp ? tx.timestamp.slice(0, 10) : dateYmd)).trim().slice(0, 16),
    updatedAt: new Date().toISOString(),
  };

  return stripUndefinedDeep(payload);
}

function sanitizeCoilStagingPayload(order: CoilStagingOrder): CoilStagingOrder {
  const { dateYmd, timeHms } = formatNowTimestamp();
  const cleanOrderNo = String(order.orderNo || `STG-${Date.now()}`).trim().toUpperCase().slice(0, 64);
  const docId = sanitizeDocId(order.id || `CSTG-${cleanOrderNo}`);

  const cleanItems: CoilStagingItem[] = (Array.isArray(order.items) ? order.items : []).map((itm, idx) => ({
    id: String(itm.id || `CSI-${docId}-${idx}`),
    batch: String(itm.batch || "").trim().toUpperCase().slice(0, 64),
    coilNo: String(itm.coilNo || itm.batch || "").trim().toUpperCase().slice(0, 64),
    grade: String(itm.grade || "SS400").trim().slice(0, 64),
    thickness: String(itm.thickness || "2.00").trim().slice(0, 32),
    width: String(itm.width || "1219").trim().slice(0, 32),
    weightKg: typeof itm.weightKg === "number" && !isNaN(itm.weightKg) ? itm.weightKg : 0,
    sourceLocation: String(itm.sourceLocation || "CL1-A01").trim().slice(0, 64),
    status: itm.status === "issued" ? "issued" : itm.status === "staged" ? "staged" : "pending",
    stagedAt: String(itm.stagedAt || ""),
    issuedAt: String(itm.issuedAt || ""),
    description: String(itm.description || ""),
  }));

  const allIssued = cleanItems.length > 0 && cleanItems.every((i) => i.status === "issued");
  const someActive = cleanItems.some((i) => i.status === "staged" || i.status === "issued");

  const resolvedStatus: CoilStagingOrder["status"] =
    order.status === "completed" || allIssued
      ? "completed"
      : order.status === "in_progress" || someActive
      ? "in_progress"
      : "pending";

  return stripUndefinedDeep({
    id: docId,
    orderNo: cleanOrderNo,
    machineId: String(order.machineId || "SM01").trim().toUpperCase().slice(0, 32),
    createdDate: String(order.createdDate || dateYmd).slice(0, 32),
    createdAt: String(order.createdAt || timeHms).slice(0, 64),
    status: resolvedStatus,
    items: cleanItems,
    remark: String(order.remark || "").slice(0, 256),
    updatedAt: new Date().toISOString(),
  });
}

// ============================================================================
// Subscriptions (Active ONLY when Coil Management UI is mounted)
// ============================================================================

export function subscribeToCoilStock(
  onData: (records: CoilStockRecord[]) => void,
  onError?: (err: unknown) => void,
  options?: CoilQueryOptions
): () => void {
  let isDisposed = false;

  const colRef = collection(dbCoil, COIL_STOCK_COLLECTION);
  const targetQuery = options?.onlyPositiveStock
    ? query(colRef, where("weightKg", ">", 0))
    : colRef;

  const sortAndEmit = (raw: CoilStockRecord[]) => {
    if (isDisposed) return;
    const filtered = options?.onlyPositiveStock
      ? raw.filter((r) => (Number(r.weightKg) || 0) > 0 && r.status !== "issued")
      : raw;
    const sorted = [...filtered].sort((a, b) =>
      String(b.scanTimestamp || "").localeCompare(String(a.scanTimestamp || ""))
    );
    onData(sorted);
  };

  if (!coilCloudRealtimeEnabled) {
    getDocs(targetQuery)
      .then((snapshot) => {
        if (isDisposed) return;
        const list: CoilStockRecord[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilStockRecord));
        sortAndEmit(list);
      })
      .catch((error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_STOCK_COLLECTION);
      });

    return () => {
      isDisposed = true;
    };
  }

  const unsub = registerCoilFirestoreListener(
    COIL_STOCK_COLLECTION,
    onSnapshot(
      targetQuery,
      (snapshot) => {
        if (isDisposed) return;
        const list: CoilStockRecord[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilStockRecord));
        sortAndEmit(list);
      },
      (error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_STOCK_COLLECTION);
      }
    )
  );

  return () => {
    isDisposed = true;
    unsub();
  };
}

export function subscribeToCoilTransactions(
  onData: (records: CoilTransactionRecord[]) => void,
  onError?: (err: unknown) => void,
  options?: CoilQueryOptions
): () => void {
  let isDisposed = false;

  const colRef = collection(dbCoil, COIL_TRANSACTIONS_COLLECTION);
  const targetQuery =
    options?.dateFilter && options.dateFilter.trim()
      ? query(
          colRef,
          where("dateYmd", ">=", options.dateFilter.trim()),
          where("dateYmd", "<=", (options.endDateFilter || options.dateFilter).trim())
        )
      : colRef;

  const sortAndEmit = (raw: CoilTransactionRecord[]) => {
    if (isDisposed) return;
    const sorted = [...raw].sort((a, b) =>
      String(b.timestamp || "").localeCompare(String(a.timestamp || ""))
    );
    onData(sorted);
  };

  if (!coilCloudRealtimeEnabled) {
    getDocs(targetQuery)
      .then((snapshot) => {
        if (isDisposed) return;
        const list: CoilTransactionRecord[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilTransactionRecord));
        sortAndEmit(list);
      })
      .catch((error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_TRANSACTIONS_COLLECTION);
      });

    return () => {
      isDisposed = true;
    };
  }

  const unsub = registerCoilFirestoreListener(
    COIL_TRANSACTIONS_COLLECTION,
    onSnapshot(
      targetQuery,
      (snapshot) => {
        if (isDisposed) return;
        const list: CoilTransactionRecord[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilTransactionRecord));
        sortAndEmit(list);
      },
      (error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_TRANSACTIONS_COLLECTION);
      }
    )
  );

  return () => {
    isDisposed = true;
    unsub();
  };
}

export function subscribeToCoilStaging(
  onData: (orders: CoilStagingOrder[]) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  const colRef = collection(dbCoil, COIL_STAGING_COLLECTION);

  const sortAndEmit = (raw: CoilStagingOrder[]) => {
    if (isDisposed) return;
    const sorted = [...raw].sort((a, b) => {
      const timeA = `${a.createdDate || ""} ${a.createdAt || ""}`;
      const timeB = `${b.createdDate || ""} ${b.createdAt || ""}`;
      return timeB.localeCompare(timeA);
    });
    onData(sorted);
  };

  if (!coilCloudRealtimeEnabled) {
    getDocs(colRef)
      .then((snapshot) => {
        if (isDisposed) return;
        const list: CoilStagingOrder[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilStagingOrder));
        sortAndEmit(list);
      })
      .catch((error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_STAGING_COLLECTION);
      });

    return () => {
      isDisposed = true;
    };
  }

  const unsub = registerCoilFirestoreListener(
    COIL_STAGING_COLLECTION,
    onSnapshot(
      colRef,
      (snapshot) => {
        if (isDisposed) return;
        const list: CoilStagingOrder[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilStagingOrder));
        sortAndEmit(list);
      },
      (error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_STAGING_COLLECTION);
      }
    )
  );

  return () => {
    isDisposed = true;
    unsub();
  };
}

export function subscribeToCoilLayouts(
  onData: (zones: CoilLayoutZone[]) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  const colRef = collection(dbCoil, COIL_LAYOUTS_COLLECTION);

  const emitOrSeed = (raw: CoilLayoutZone[]) => {
    if (isDisposed) return;
    if (raw.length === 0) {
      onData(DEFAULT_COIL_LAYOUT_ZONES);
      seedDefaultCoilLayoutsIfEmpty().catch(() => {});
      return;
    }
    const sorted = [...raw].sort((a, b) => a.bayCode.localeCompare(b.bayCode));
    onData(sorted);
  };

  if (!coilCloudRealtimeEnabled) {
    getDocs(colRef)
      .then((snapshot) => {
        if (isDisposed) return;
        const list: CoilLayoutZone[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilLayoutZone));
        emitOrSeed(list);
      })
      .catch((error) => {
        if (isDisposed) return;
        onError?.(error);
        onData(DEFAULT_COIL_LAYOUT_ZONES);
        handleFirestoreError(error, OperationType.GET, COIL_LAYOUTS_COLLECTION);
      });

    return () => {
      isDisposed = true;
    };
  }

  const unsub = registerCoilFirestoreListener(
    COIL_LAYOUTS_COLLECTION,
    onSnapshot(
      colRef,
      (snapshot) => {
        if (isDisposed) return;
        const list: CoilLayoutZone[] = [];
        snapshot.forEach((d) => list.push(d.data() as CoilLayoutZone));
        emitOrSeed(list);
      },
      (error) => {
        if (isDisposed) return;
        onError?.(error);
        onData(DEFAULT_COIL_LAYOUT_ZONES);
        handleFirestoreError(error, OperationType.GET, COIL_LAYOUTS_COLLECTION);
      }
    )
  );

  return () => {
    isDisposed = true;
    unsub();
  };
}

// ============================================================================
// Mutations for Tab 1: +รับเข้า (Inbound Coil)
// ============================================================================

export async function saveCoilInboundToCloud(
  record: Partial<CoilStockRecord> & { batch: string; location: string }
): Promise<CoilStockRecord> {
  const stockPayload = sanitizeCoilStockPayload({
    ...record,
    status: "available",
  });

  const txPayload = sanitizeCoilTransactionPayload({
    txType: "inbound",
    batch: stockPayload.batch,
    coilNo: stockPayload.coilNo,
    weightKg: stockPayload.weightKg,
    fromLocation: stockPayload.inboundType === "internal" ? stockPayload.machine || "SM01" : stockPayload.manufacturer || "SUPPLIER",
    toLocation: stockPayload.location,
    machineId: stockPayload.machine,
    orderNo: stockPayload.orderNo,
    grade: stockPayload.grade,
    thickness: stockPayload.certThickness,
    width: stockPayload.width,
    manufacturer: stockPayload.manufacturer,
    remark: stockPayload.remark || "รับเข้าเหล็กม้วนเข้าคลัง",
    timestamp: stockPayload.scanTimestamp,
  });

  await runCoilFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbCoil);
      batch.set(doc(dbCoil, COIL_STOCK_COLLECTION, stockPayload.id), stockPayload, { merge: true });
      batch.set(doc(dbCoil, COIL_TRANSACTIONS_COLLECTION, txPayload.id), txPayload, { merge: true });
      await batch.commit();
    },
    OperationType.WRITE,
    `${COIL_STOCK_COLLECTION}/${stockPayload.id}`
  );

  return stockPayload;
}

export async function batchSaveCoilInboundToCloud(
  records: Array<Partial<CoilStockRecord> & { batch: string; location: string }>
): Promise<CoilStockRecord[]> {
  if (records.length === 0) return [];
  const stockPayloads = records.map((r) =>
    sanitizeCoilStockPayload({
      ...r,
      status: "available",
    })
  );

  await runCoilFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbCoil);
      for (const s of stockPayloads) {
        batch.set(doc(dbCoil, COIL_STOCK_COLLECTION, s.id), s, { merge: true });
        const tx = sanitizeCoilTransactionPayload({
          txType: "inbound",
          batch: s.batch,
          coilNo: s.coilNo,
          weightKg: s.weightKg,
          fromLocation: s.manufacturer || "SUPPLIER",
          toLocation: s.location,
          machineId: s.machine,
          orderNo: s.orderNo,
          grade: s.grade,
          thickness: s.certThickness,
          width: s.width,
          manufacturer: s.manufacturer,
          remark: "นำเข้าข้อมูลเหล็กม้วนแบบกลุ่ม (Batch Import)",
          timestamp: s.scanTimestamp,
        });
        batch.set(doc(dbCoil, COIL_TRANSACTIONS_COLLECTION, tx.id), tx, { merge: true });
      }
      await batch.commit();
    },
    OperationType.WRITE,
    COIL_STOCK_COLLECTION
  );

  return stockPayloads;
}

// ============================================================================
// Mutations for Tab 3: -เตรียมเบิก (Staging / PickList Preparation)
// ============================================================================

export async function saveCoilStagingOrderToCloud(
  order: CoilStagingOrder,
  syncStockStatus = true
): Promise<CoilStagingOrder> {
  const cleanOrder = sanitizeCoilStagingPayload(order);
  const { timestamp } = formatNowTimestamp();

  await runCoilFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbCoil);
      batch.set(doc(dbCoil, COIL_STAGING_COLLECTION, cleanOrder.id), cleanOrder, { merge: true });

      if (syncStockStatus) {
        for (const item of cleanOrder.items) {
          if (item.status === "staged") {
            const stockDocId = sanitizeDocId(`COIL-${item.batch}`);
            batch.set(
              doc(dbCoil, COIL_STOCK_COLLECTION, stockDocId),
              {
                id: stockDocId,
                batch: item.batch,
                location: item.sourceLocation || "STG-SM01",
                status: "staged",
                stagedOrderNo: cleanOrder.orderNo,
                stagedMachineId: cleanOrder.machineId,
                stagedAt: item.stagedAt || timestamp,
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            );

            const tx = sanitizeCoilTransactionPayload({
              id: `CTX-STG-${cleanOrder.orderNo}-${item.batch}`,
              txType: "staging",
              batch: item.batch,
              coilNo: item.coilNo,
              weightKg: item.weightKg,
              fromLocation: item.sourceLocation,
              toLocation: `STAGING (${cleanOrder.machineId})`,
              machineId: cleanOrder.machineId,
              orderNo: cleanOrder.orderNo,
              grade: item.grade,
              thickness: item.thickness,
              width: item.width,
              remark: `เตรียมเบิกเหล็กม้วนเข้าเครื่อง ${cleanOrder.machineId}`,
              timestamp,
            });
            batch.set(doc(dbCoil, COIL_TRANSACTIONS_COLLECTION, tx.id), tx, { merge: true });
          }
        }
      }

      await batch.commit();
    },
    OperationType.WRITE,
    `${COIL_STAGING_COLLECTION}/${cleanOrder.id}`
  );

  return cleanOrder;
}

export async function deleteCoilStagingOrderFromCloud(
  order: CoilStagingOrder
): Promise<void> {
  const docId = sanitizeDocId(order.id || `CSTG-${order.orderNo}`);
  await runCoilFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbCoil);
      batch.delete(doc(dbCoil, COIL_STAGING_COLLECTION, docId));

      for (const item of order.items || []) {
        if (item.status === "staged") {
          const stockDocId = sanitizeDocId(`COIL-${item.batch}`);
          batch.set(
            doc(dbCoil, COIL_STOCK_COLLECTION, stockDocId),
            {
              id: stockDocId,
              batch: item.batch,
              location: item.sourceLocation || "CL1-A01",
              status: "available",
              stagedOrderNo: "",
              stagedMachineId: "",
              stagedAt: "",
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      }
      await batch.commit();
    },
    OperationType.DELETE,
    `${COIL_STAGING_COLLECTION}/${docId}`
  );
}

// ============================================================================
// Mutations for Tab 2: จ่ายออก (Issue / Operator Receive at Machine)
// ============================================================================

export async function issueCoilToMachineInCloud(params: {
  stockRecord: CoilStockRecord;
  machineId: string;
  orderNo?: string;
  issueWeightKg?: number;
  stagingOrder?: CoilStagingOrder | null;
  remark?: string;
}): Promise<void> {
  const { stockRecord, machineId, orderNo, issueWeightKg, stagingOrder, remark } = params;
  const { timestamp } = formatNowTimestamp();
  const actualIssuedWeight =
    typeof issueWeightKg === "number" && issueWeightKg > 0 && issueWeightKg <= stockRecord.weightKg
      ? issueWeightKg
      : stockRecord.weightKg;
  const remainingWeight = Math.max(0, Number((stockRecord.weightKg - actualIssuedWeight).toFixed(2)));
  const isFullIssue = remainingWeight <= 0;

  const updatedStock: CoilStockRecord = sanitizeCoilStockPayload({
    ...stockRecord,
    weightKg: remainingWeight,
    status: isFullIssue ? "issued" : "available",
    issuedMachineId: machineId,
    issuedOrderNo: orderNo || stockRecord.stagedOrderNo || `ISS-${Date.now()}`,
    issuedAt: timestamp,
  });

  const txPayload = sanitizeCoilTransactionPayload({
    txType: "issue",
    batch: stockRecord.batch,
    coilNo: stockRecord.coilNo,
    weightKg: actualIssuedWeight,
    fromLocation: stockRecord.location,
    toLocation: `MACHINE ${machineId}`,
    machineId,
    orderNo: updatedStock.issuedOrderNo,
    grade: stockRecord.grade,
    thickness: stockRecord.certThickness,
    width: stockRecord.width,
    manufacturer: stockRecord.manufacturer,
    remark:
      remark ||
      (isFullIssue
        ? `จ่ายออกเหล็กม้วนทั้งม้วนเข้าเครื่อง ${machineId}`
        : `แบ่งจ่ายเหล็กม้วน ${actualIssuedWeight.toLocaleString()} kg (คงเหลือ ${remainingWeight.toLocaleString()} kg)`),
    timestamp,
  });

  await runCoilFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbCoil);
      batch.set(doc(dbCoil, COIL_STOCK_COLLECTION, updatedStock.id), updatedStock, { merge: true });
      batch.set(doc(dbCoil, COIL_TRANSACTIONS_COLLECTION, txPayload.id), txPayload, { merge: true });

      if (stagingOrder) {
        const updatedItems = stagingOrder.items.map((itm) =>
          itm.batch.toUpperCase() === stockRecord.batch.toUpperCase()
            ? { ...itm, status: "issued" as const, issuedAt: timestamp }
            : itm
        );
        const cleanStaging = sanitizeCoilStagingPayload({
          ...stagingOrder,
          items: updatedItems,
        });
        batch.set(doc(dbCoil, COIL_STAGING_COLLECTION, cleanStaging.id), cleanStaging, {
          merge: true,
        });
      }

      await batch.commit();
    },
    OperationType.WRITE,
    `${COIL_STOCK_COLLECTION}/${updatedStock.id}`
  );
}

// ============================================================================
// Mutations for Tab 4: ย้าย Layout (Relocate Coil Layout)
// ============================================================================

export async function relocateCoilsInCloud(params: {
  coils: CoilStockRecord[];
  targetLocation: string;
  remark?: string;
}): Promise<void> {
  const { coils, targetLocation, remark } = params;
  if (coils.length === 0 || !targetLocation.trim()) return;
  const cleanTarget = targetLocation.trim().toUpperCase().slice(0, 64);
  const { timestamp } = formatNowTimestamp();

  await runCoilFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbCoil);
      for (const c of coils) {
        const prevLoc = c.location || "CL1-A01";
        const updatedStock = sanitizeCoilStockPayload({
          ...c,
          previousLocation: prevLoc,
          location: cleanTarget,
          scanTimestamp: timestamp,
        });
        batch.set(doc(dbCoil, COIL_STOCK_COLLECTION, updatedStock.id), updatedStock, {
          merge: true,
        });

        const tx = sanitizeCoilTransactionPayload({
          txType: "relocate",
          batch: c.batch,
          coilNo: c.coilNo,
          weightKg: c.weightKg,
          fromLocation: prevLoc,
          toLocation: cleanTarget,
          grade: c.grade,
          thickness: c.certThickness,
          width: c.width,
          manufacturer: c.manufacturer,
          remark: remark || `ย้าย Layout จาก ${prevLoc} ไปยัง ${cleanTarget}`,
          timestamp,
        });
        batch.set(doc(dbCoil, COIL_TRANSACTIONS_COLLECTION, tx.id), tx, { merge: true });
      }
      await batch.commit();
    },
    OperationType.WRITE,
    COIL_STOCK_COLLECTION
  );
}

export async function saveCoilLayoutZoneToCloud(zone: CoilLayoutZone): Promise<void> {
  const cleanCode = String(zone.bayCode || "").trim().toUpperCase().slice(0, 64);
  const docId = sanitizeDocId(zone.id || `LAYOUT-${cleanCode}`);
  const payload: CoilLayoutZone = {
    id: docId,
    bayCode: cleanCode,
    bayGroup: String(zone.bayGroup || (cleanCode.startsWith("CL2") ? "CL2" : "CL1")).trim().toUpperCase(),
    zoneName: String(zone.zoneName || cleanCode).trim().slice(0, 128),
    maxCapacityTons: Number(zone.maxCapacityTons) > 0 ? Number(zone.maxCapacityTons) : 300,
    maxCoils: Number(zone.maxCoils) > 0 ? Number(zone.maxCoils) : 25,
    description: String(zone.description || "").trim().slice(0, 256),
    updatedAt: new Date().toISOString(),
  };

  await runCoilFirestoreWriteWithGuard(
    () => setDoc(doc(dbCoil, COIL_LAYOUTS_COLLECTION, docId), payload, { merge: true }),
    OperationType.WRITE,
    `${COIL_LAYOUTS_COLLECTION}/${docId}`
  );
}

export async function seedDefaultCoilLayoutsIfEmpty(): Promise<void> {
  await runCoilFirestoreWriteWithGuard(
    async () => {
      const snap = await getDocs(collection(dbCoil, COIL_LAYOUTS_COLLECTION));
      if (!snap.empty) return;
      const batch = writeBatch(dbCoil);
      for (const z of DEFAULT_COIL_LAYOUT_ZONES) {
        batch.set(doc(dbCoil, COIL_LAYOUTS_COLLECTION, z.id), z, { merge: true });
      }
      await batch.commit();
    },
    OperationType.WRITE,
    COIL_LAYOUTS_COLLECTION
  );
}

// ============================================================================
// Mutations for Tab 5: สต๊อก (Stock Balance Management & Return/Delete)
// ============================================================================

export async function returnCoilToStockInCloud(
  coil: CoilStockRecord,
  returnLocation?: string,
  returnWeightKg?: number
): Promise<void> {
  const { timestamp } = formatNowTimestamp();
  const targetLoc = (returnLocation || coil.location || "CL1-A01").trim().toUpperCase();
  const restoredWeight =
    typeof returnWeightKg === "number" && returnWeightKg > 0
      ? returnWeightKg
      : coil.weightKg > 0
      ? coil.weightKg
      : coil.initialWeightKg || 5000;

  const updated = sanitizeCoilStockPayload({
    ...coil,
    previousLocation: coil.location,
    location: targetLoc,
    weightKg: restoredWeight,
    status: "available",
    stagedOrderNo: "",
    stagedMachineId: "",
    scanTimestamp: timestamp,
  });

  const tx = sanitizeCoilTransactionPayload({
    txType: "return",
    batch: coil.batch,
    coilNo: coil.coilNo,
    weightKg: restoredWeight,
    fromLocation: coil.issuedMachineId || coil.stagedMachineId || "PRODUCTION",
    toLocation: targetLoc,
    grade: coil.grade,
    thickness: coil.certThickness,
    width: coil.width,
    manufacturer: coil.manufacturer,
    remark: `รับคืนเหล็กม้วนเข้าสต๊อก (${targetLoc})`,
    timestamp,
  });

  await runCoilFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbCoil);
      batch.set(doc(dbCoil, COIL_STOCK_COLLECTION, updated.id), updated, { merge: true });
      batch.set(doc(dbCoil, COIL_TRANSACTIONS_COLLECTION, tx.id), tx, { merge: true });
      await batch.commit();
    },
    OperationType.WRITE,
    `${COIL_STOCK_COLLECTION}/${updated.id}`
  );
}

export async function deleteCoilStockFromCloud(id: string): Promise<void> {
  const docId = sanitizeDocId(id);
  await runCoilFirestoreWriteWithGuard(
    () => deleteDoc(doc(dbCoil, COIL_STOCK_COLLECTION, docId)),
    OperationType.DELETE,
    `${COIL_STOCK_COLLECTION}/${docId}`
  );
}

export async function clearAllCoilDataFromCloud(): Promise<void> {
  const collectionsToClear = [
    COIL_STOCK_COLLECTION,
    COIL_TRANSACTIONS_COLLECTION,
    COIL_STAGING_COLLECTION,
  ];
  for (const colName of collectionsToClear) {
    await runCoilFirestoreWriteWithGuard(
      async () => {
        const snap = await getDocs(collection(dbCoil, colName));
        if (snap.empty) return;
        const batch = writeBatch(dbCoil);
        snap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      },
      OperationType.DELETE,
      colName
    );
  }
}
