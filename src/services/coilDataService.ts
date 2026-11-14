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
  skinpass?: string;
  storageLocation?: string;
  conditionText?: string;
  heatNo?: string;
  actualWeightKg?: number;
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

export interface CoilSapMasterItem {
  materialNo?: string;
  description?: string;
  batch: string;
  certThickness: string;
  targetThickness: string;
  width: string;
  grade: string;
  manufacturer: string;
  skinpass?: string;
  storageLocation: string;
  weightKg: number;
  unrestricted: string;
  coilNo?: string;
  conditionText?: string;
  heatNo?: string;
  actualWeightKg?: number;
  salesDoc?: string;
  qualityClass?: string;
}

export const COIL_SAP_CHUNK_SIZE = 800;

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

  const cleanCoilNo = String(r.coilNo ?? "").trim().toUpperCase();
  const cleanCertThick = String(r.certThickness ?? "").trim();
  const cleanTargetThick = String(r.targetThickness ?? "").trim();
  const cleanWidth = String(r.width ?? "").trim();
  const cleanGrade = String(r.grade ?? "").trim().toUpperCase();
  const cleanMfg = String(r.manufacturer ?? "").trim().toUpperCase();
  const cleanSupplier = String(r.supplier ?? "").trim();

  const cleanLocation = String(r.location ?? "").trim().toUpperCase();

  const payload: CoilStockRecord = {
    id: docId,
    batch: cleanBatch,
    coilNo: (cleanCoilNo || "-").slice(0, 64),
    location: (cleanLocation || "-").slice(0, 64),
    previousLocation: String(r.previousLocation || "").trim().toUpperCase().slice(0, 64),
    status: r.status === "staged" || r.status === "issued" ? r.status : "available",
    weightKg: safeWeight,
    initialWeightKg: safeInitWeight,
    certThickness: (cleanCertThick || "-").slice(0, 32),
    targetThickness: (cleanTargetThick || cleanCertThick || "-").slice(0, 32),
    width: (cleanWidth || "-").slice(0, 32),
    grade: (cleanGrade || "-").slice(0, 64),
    manufacturer: (cleanMfg || "-").slice(0, 64),
    supplier: (cleanSupplier || cleanMfg || "-").slice(0, 64),
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
    qualityClass: String(r.qualityClass || "-").trim().slice(0, 32),
    description: String(r.description || "").trim().slice(0, 256),
    skinpass: String(r.skinpass || "").trim().slice(0, 64),
    storageLocation: String(r.storageLocation || "").trim().slice(0, 64),
    conditionText: String(r.conditionText || "").trim().slice(0, 256),
    heatNo: String(r.heatNo || "").trim().slice(0, 64),
    actualWeightKg:
      typeof r.actualWeightKg === "number" && !isNaN(r.actualWeightKg)
        ? Math.max(0, r.actualWeightKg)
        : 0,
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
    coilNo: String(tx.coilNo || "-").trim().toUpperCase().slice(0, 64),
    weightKg: typeof tx.weightKg === "number" && !isNaN(tx.weightKg) ? tx.weightKg : 0,
    fromLocation: String(tx.fromLocation || "-").trim().slice(0, 64),
    toLocation: String(tx.toLocation || "-").trim().slice(0, 64),
    machineId: String(tx.machineId || "").trim().slice(0, 32),
    orderNo: String(tx.orderNo || "").trim().slice(0, 64),
    grade: String(tx.grade || "-").trim().slice(0, 64),
    thickness: String(tx.thickness || "-").trim().slice(0, 32),
    width: String(tx.width || "-").trim().slice(0, 32),
    manufacturer: String(tx.manufacturer || "-").trim().slice(0, 64),
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
    coilNo: String(itm.coilNo || "-").trim().toUpperCase().slice(0, 64),
    grade: String(itm.grade || "-").trim().slice(0, 64),
    thickness: String(itm.thickness || "-").trim().slice(0, 32),
    width: String(itm.width || "-").trim().slice(0, 32),
    weightKg: typeof itm.weightKg === "number" && !isNaN(itm.weightKg) ? itm.weightKg : 0,
    sourceLocation: String(itm.sourceLocation || "E7/1").trim().slice(0, 64),
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

// ============================================================================
// SAP Master Data Chunks & SAP Stock Import for Steel Coils (dbCoil)
// ============================================================================

export function subscribeToCoilSapChunks(
  onData: (items: CoilSapMasterItem[], chunkCount: number) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  const colRef = collection(dbCoil, COIL_SAP_CHUNKS_COLLECTION);

  const emitFromDocs = (docs: Array<{ chunkIndex?: number; items?: CoilSapMasterItem[] }>) => {
    if (isDisposed) return;
    const sorted = [...docs].sort((a, b) => (Number(a.chunkIndex) || 0) - (Number(b.chunkIndex) || 0));
    const merged: CoilSapMasterItem[] = [];
    for (const chunk of sorted) {
      if (Array.isArray(chunk.items)) {
        merged.push(...chunk.items);
      }
    }
    onData(merged, sorted.length);
  };

  if (!coilCloudRealtimeEnabled) {
    getDocs(colRef)
      .then((snapshot) => {
        if (isDisposed) return;
        const docs: Array<{ chunkIndex?: number; items?: CoilSapMasterItem[] }> = [];
        snapshot.forEach((d) => docs.push(d.data() as { chunkIndex?: number; items?: CoilSapMasterItem[] }));
        emitFromDocs(docs);
      })
      .catch((error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_SAP_CHUNKS_COLLECTION);
      });

    return () => {
      isDisposed = true;
    };
  }

  const unsub = registerCoilFirestoreListener(
    COIL_SAP_CHUNKS_COLLECTION,
    onSnapshot(
      colRef,
      (snapshot) => {
        if (isDisposed) return;
        const docs: Array<{ chunkIndex?: number; items?: CoilSapMasterItem[] }> = [];
        snapshot.forEach((d) => docs.push(d.data() as { chunkIndex?: number; items?: CoilSapMasterItem[] }));
        emitFromDocs(docs);
      },
      (error) => {
        if (isDisposed) return;
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, COIL_SAP_CHUNKS_COLLECTION);
      }
    )
  );

  return () => {
    isDisposed = true;
    unsub();
  };
}

export async function saveCoilSapChunksToCloud(items: CoilSapMasterItem[]): Promise<number> {
  const totalItems = items.length;
  const totalChunks = totalItems === 0 ? 0 : Math.ceil(totalItems / COIL_SAP_CHUNK_SIZE);

  await runCoilFirestoreWriteWithGuard(
    async () => {
      const existingSnap = await getDocs(collection(dbCoil, COIL_SAP_CHUNKS_COLLECTION));
      const existingIds = existingSnap.docs.map((d) => d.id);
      const keepIds = new Set<string>();

      for (let i = 0; i < totalChunks; i++) {
        const chunkId = sanitizeDocId(`COIL_SAP_CHUNK_${i}`);
        keepIds.add(chunkId);
        const slice = items.slice(i * COIL_SAP_CHUNK_SIZE, (i + 1) * COIL_SAP_CHUNK_SIZE).map((item) =>
          stripUndefinedDeep({
            ...item,
            batch: String(item.batch || "").trim().toUpperCase().slice(0, 64),
          })
        );
        await setDoc(
          doc(dbCoil, COIL_SAP_CHUNKS_COLLECTION, chunkId),
          {
            id: chunkId,
            chunkIndex: i,
            totalChunks,
            totalItems,
            itemCount: slice.length,
            items: slice,
            updatedAt: new Date().toISOString(),
          },
          { merge: false }
        );
      }

      const staleIds = existingIds.filter((id) => !keepIds.has(id));
      if (staleIds.length > 0) {
        const batch = writeBatch(dbCoil);
        staleIds.forEach((id) => batch.delete(doc(dbCoil, COIL_SAP_CHUNKS_COLLECTION, id)));
        await batch.commit();
      }
    },
    OperationType.WRITE,
    COIL_SAP_CHUNKS_COLLECTION
  );

  return totalChunks;
}

export async function clearCoilSapChunksFromCloud(): Promise<void> {
  await runCoilFirestoreWriteWithGuard(
    async () => {
      const snap = await getDocs(collection(dbCoil, COIL_SAP_CHUNKS_COLLECTION));
      if (snap.empty) return;
      const batch = writeBatch(dbCoil);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    },
    OperationType.DELETE,
    COIL_SAP_CHUNKS_COLLECTION
  );
}

function isValidScannedCoilLocation(loc: unknown): boolean {
  const s = String(loc ?? "").trim().toUpperCase();
  if (!s || s === "-" || s === "SAP-STOCK" || s === "2E09" || s === "2E07" || /^2000+/.test(s)) {
    return false;
  }
  if (/[\u0E00-\u0E7F]/.test(s)) return false;
  if (/^\d+(\.\d+)?$/.test(s)) return false;
  if (s.length > 16) return false;
  return /^[A-Z0-9]{1,6}[\/\-][A-Z0-9]{1,8}$/.test(s) || /^(E7|E8|H7|H8|05|21)$/.test(s);
}

export async function importCoilSapStockToCloud(params: {
  sapItems: CoilSapMasterItem[];
  existingStock: CoilStockRecord[];
  createMissingStock?: boolean;
}): Promise<{ updatedCount: number; insertedCount: number }> {
  const { sapItems, existingStock, createMissingStock = true } = params;
  if (sapItems.length === 0) return { updatedCount: 0, insertedCount: 0 };

  const existingByBatch = new Map<string, CoilStockRecord>();
  existingStock.forEach((rec) => {
    if (rec.batch) {
      existingByBatch.set(rec.batch.trim().toUpperCase(), rec);
    }
  });

  const { timestamp } = formatNowTimestamp();
  const dedupedSap = new Map<string, CoilSapMasterItem>();
  const materialNoSet = new Set<string>();
  sapItems.forEach((item) => {
    const b = String(item.batch || "").trim().toUpperCase();
    if (b && !b.includes("-") && b.length <= 12) {
      dedupedSap.set(b, { ...item, batch: b });
    }
    const mat = String(item.materialNo || "").trim().toUpperCase();
    if (mat) materialNoSet.add(mat);
  });

  // Identify bogus records (e.g. Material No. saved as Batch, or corrupted unscanned records)
  const bogusDocIdsToDelete: string[] = [];
  existingStock.forEach((rec) => {
    const b = String(rec.batch || "").trim().toUpperCase();
    const isMaterialNoAsBatch =
      b.includes("-") ||
      b.length > 12 ||
      materialNoSet.has(b) ||
      /[\u0E00-\u0E7F]/.test(b);
    const hasCorruptedFields =
      rec.manufacturer === "AUTOSK" ||
      rec.manufacturer === "NONSK" ||
      /[\u0E00-\u0E7F]/.test(String(rec.location || ""));
    if ((isMaterialNoAsBatch || hasCorruptedFields) && !dedupedSap.has(b)) {
      bogusDocIdsToDelete.push(rec.id);
    }
  });

  const payloadsToWrite: CoilStockRecord[] = [];
  let updatedCount = 0;
  let insertedCount = 0;

  dedupedSap.forEach((sap, batchKey) => {
    const existing = existingByBatch.get(batchKey);
    const sapThick = String(sap.certThickness || "").replace(/\s*mm$/i, "").trim();
    const cleanThick =
      sapThick && sapThick !== "-"
        ? sapThick
        : existing?.certThickness && existing.certThickness !== "-" && !existing.certThickness.includes("-")
        ? existing.certThickness
        : "-";
    const sapTargetThick = String(sap.targetThickness || "").replace(/\s*mm$/i, "").trim();
    const cleanTargetThick =
      sapTargetThick && sapTargetThick !== "-" ? sapTargetThick : cleanThick;
    const sapWidth = String(sap.width || "").replace(/\s*mm$/i, "").trim();
    const cleanWidth =
      sapWidth && sapWidth !== "-"
        ? sapWidth
        : existing?.width && existing.width !== "-" && !/[\u0E00-\u0E7F]/.test(existing.width)
        ? existing.width
        : "-";
    const safeWeight =
      typeof sap.weightKg === "number" && sap.weightKg >= 0
        ? sap.weightKg
        : existing?.weightKg || 0;
    const safeActualWeight =
      typeof sap.actualWeightKg === "number" && sap.actualWeightKg >= 0
        ? sap.actualWeightKg
        : existing?.actualWeightKg || 0;
    const cleanGrade =
      sap.grade && sap.grade !== "-"
        ? sap.grade.trim().toUpperCase()
        : existing?.grade && existing.grade !== "-"
        ? existing.grade.trim().toUpperCase()
        : "-";
    const cleanMfg =
      sap.manufacturer && sap.manufacturer !== "-"
        ? sap.manufacturer.trim().toUpperCase()
        : existing?.manufacturer &&
          existing.manufacturer !== "-" &&
          existing.manufacturer !== "AUTOSK" &&
          existing.manufacturer !== "NONSK"
        ? existing.manufacturer.trim().toUpperCase()
        : "-";
    const cleanCoilNo =
      sap.coilNo && sap.coilNo !== "-"
        ? sap.coilNo.trim().toUpperCase()
        : existing?.coilNo && existing.coilNo !== "-"
        ? existing.coilNo.trim().toUpperCase()
        : "-";
    const cleanSkinpass =
      sap.skinpass && sap.skinpass !== "-"
        ? sap.skinpass.trim()
        : existing?.skinpass || "";
    const cleanStorageLoc =
      sap.storageLocation && sap.storageLocation !== "-"
        ? sap.storageLocation.trim().toUpperCase()
        : existing?.storageLocation || "";
    const cleanConditionText =
      sap.conditionText && sap.conditionText !== "-"
        ? sap.conditionText.trim()
        : existing?.conditionText || "";
    const cleanHeatNo =
      sap.heatNo && sap.heatNo !== "-"
        ? sap.heatNo.trim().toUpperCase()
        : existing?.heatNo || "";

    if (existing) {
      // Preserve ONLY genuine shop-floor scanned Location (e.g. E7/7). Never keep SAP Storage Location or corrupted text.
      const preservedScannedLocation = isValidScannedCoilLocation(existing.location)
        ? String(existing.location).trim().toUpperCase()
        : "-";

      updatedCount++;
      payloadsToWrite.push(
        sanitizeCoilStockPayload({
          ...existing,
          location: preservedScannedLocation,
          status: existing.status,
          coilNo: cleanCoilNo,
          weightKg: safeWeight,
          initialWeightKg: safeWeight > 0 ? safeWeight : existing.initialWeightKg || 0,
          actualWeightKg: safeActualWeight,
          certThickness: cleanThick,
          targetThickness: cleanTargetThick,
          width: cleanWidth,
          grade: cleanGrade,
          manufacturer: cleanMfg,
          supplier: cleanMfg,
          materialNo: sap.materialNo || existing.materialNo || "",
          salesDoc: sap.salesDoc || "",
          qualityClass: sap.qualityClass || "-",
          description: sap.description || existing.description || "",
          skinpass: cleanSkinpass,
          storageLocation: cleanStorageLoc,
          conditionText: cleanConditionText,
          heatNo: cleanHeatNo,
          remark: cleanConditionText || "",
          hasSapData: true,
        })
      );
    } else if (createMissingStock) {
      insertedCount++;
      payloadsToWrite.push(
        sanitizeCoilStockPayload({
          id: `COIL-${batchKey}`,
          batch: batchKey,
          coilNo: cleanCoilNo,
          location: "-", // Never overwrite Layout with SAP Storage Location; unscanned SAP items show "-"
          status: "available",
          weightKg: safeWeight,
          initialWeightKg: safeWeight,
          actualWeightKg: safeActualWeight,
          certThickness: cleanThick,
          targetThickness: cleanTargetThick,
          width: cleanWidth,
          grade: cleanGrade,
          manufacturer: cleanMfg,
          supplier: cleanMfg,
          machine: "EXTERNAL",
          inboundType: "external",
          materialNo: sap.materialNo || "",
          salesDoc: sap.salesDoc || "",
          qualityClass: sap.qualityClass || "-",
          description: sap.description || "",
          skinpass: cleanSkinpass,
          storageLocation: cleanStorageLoc,
          conditionText: cleanConditionText,
          heatNo: cleanHeatNo,
          remark: cleanConditionText || "นำเข้าสต็อกจากระบบ SAP",
          hasSapData: true,
          scanTimestamp: timestamp,
        })
      );
    }
  });

  // 1. Delete bogus records in safe chunks of 350
  const CHUNK_LIMIT = 350;
  for (let i = 0; i < bogusDocIdsToDelete.length; i += CHUNK_LIMIT) {
    const delSlice = bogusDocIdsToDelete.slice(i, i + CHUNK_LIMIT);
    await runCoilFirestoreWriteWithGuard(
      async () => {
        const batch = writeBatch(dbCoil);
        for (const bogusId of delSlice) {
          batch.delete(doc(dbCoil, COIL_STOCK_COLLECTION, sanitizeDocId(bogusId)));
        }
        await batch.commit();
      },
      OperationType.DELETE,
      COIL_STOCK_COLLECTION
    );
  }

  // 2. Write updated/inserted SAP stock records in safe chunks of 350
  if (payloadsToWrite.length > 0) {
    for (let i = 0; i < payloadsToWrite.length; i += CHUNK_LIMIT) {
      const slice = payloadsToWrite.slice(i, i + CHUNK_LIMIT);
      await runCoilFirestoreWriteWithGuard(
        async () => {
          const batch = writeBatch(dbCoil);
          for (const rec of slice) {
            batch.set(doc(dbCoil, COIL_STOCK_COLLECTION, rec.id), rec, { merge: true });
          }
          if (i === 0) {
            const summaryTx = sanitizeCoilTransactionPayload({
              txType: "inbound",
              batch: `SAP-SYNC-${payloadsToWrite.length}`,
              coilNo: "SAP-IMPORT",
              weightKg: payloadsToWrite.reduce((s, r) => s + (Number(r.weightKg) || 0), 0),
              fromLocation: "SAP",
              toLocation: "COIL_STOCK",
              remark: `นำเข้า/อัปเดตสต็อกเหล็กม้วนจากระบบ SAP (เพิ่มใหม่ ${insertedCount} / อัปเดต ${updatedCount} รายการ)`,
              timestamp,
            });
            batch.set(doc(dbCoil, COIL_TRANSACTIONS_COLLECTION, summaryTx.id), summaryTx, { merge: true });
          }
          await batch.commit();
        },
        OperationType.WRITE,
        COIL_STOCK_COLLECTION
      );
    }
  }

  return { updatedCount, insertedCount };
}
