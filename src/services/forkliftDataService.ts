import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { dbForklift, handleFirestoreError, OperationType } from "./firebase";

// ============================================================================
// Dedicated Firestore Collections for Material Handling (Forklift) (100% Isolated)
// NEVER connects or mixes with Slit Steel or Steel Coil collections
// ============================================================================
export const MH_TRANSFERS_COLLECTION = "mh_transfers";
export const MH_MAINTENANCE_COLLECTION = "mh_maintenance";
export const MH_FUEL_STOCK_COLLECTION = "mh_fuel_stock";
export const MH_TIRE_STOCK_COLLECTION = "mh_tire_stock";

// ============================================================================
// 1. Transport Operation (mh_transfers) Types
// ============================================================================
export type MhTransferStatus = "Pending" | "In Transit" | "Completed" | "Cancelled";
export type MhPriorityLevel = "Normal" | "Urgent" | "Express";

export interface MhTransferRecord {
  id: string;
  transferCode: string;
  originFacility: string;
  destinationFacility: string;
  sku: string;
  itemName: string;
  productCategory: string;
  batchNumber: string;
  palletId: string;
  quantity: number;
  unit: string;
  weightTon: number;
  recorderName: string;
  workingDate: string;
  status: MhTransferStatus;
  priority: MhPriorityLevel;
  vehicleNumber: string;
  driverName: string;
  transportCost?: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

// ============================================================================
// 2. Maintenance / Fix & Flush (mh_maintenance) Types
// ============================================================================
export type MhRepairType =
  | "เปลี่ยนยาง (Tire Replacement)"
  | "ซ่อมเครื่องยนต์ (Engine Repair)"
  | "ระบบไฮดรอลิก (Hydraulic System)"
  | "ระบบเบรกและช่วงล่าง (Brake & Suspension)"
  | "ระบบไฟฟ้าและแบตเตอรี่ (Electrical & Battery)"
  | "ซ่อมบำรุงตามรอบ PM (Preventive Maintenance)"
  | "ฟลัชชิ่งระบบของเหลว (Fluid & Oil Flushing)";

export type MhManagerApprovalStatus =
  | "Pending Manager Approval"
  | "Approved"
  | "More Info Requested"
  | "Rejected";

export type MhWorkOrderProgress =
  | "Awaiting Approval"
  | "In Progress"
  | "Completed"
  | "On Hold";

export interface MhSparePartItem {
  id?: string;
  partCode: string;
  partName: string;
  qty: number;
  unit?: string;
  unitCost: number;
}

export interface MhFeedbackComment {
  id: string;
  author: string;
  role: "Manager" | "Technician";
  timestamp: string;
  queryType?: string;
  message: string;
}

export type MhMaintenanceStatus =
  | "Pending Inspection"
  | "In Workshop"
  | "Testing"
  | "Approved"
  | "Completed";

export interface MhMaintenanceRecord {
  id: string;
  workOrderNo: string;
  vehicleId: string;
  vehicleNumber?: string;
  vehicleType?: string;
  vehicleDescription: string;
  repairType: string;
  repairDescription: string;
  status: MhMaintenanceStatus;
  workingDate: string;
  spareParts: MhSparePartItem[];
  estimatedCost: number;
  actualCost?: number;
  technicianName: string;
  workshopBay: string;
  operatingHours: number;
  createdAt: string;
  completedAt?: string;
  managerStatus: MhManagerApprovalStatus;
  progressStatus?: MhWorkOrderProgress;
  feedbackThread: MhFeedbackComment[];
  notes?: string;
  updatedAt?: string;
}

// ============================================================================
// 3. Fuel Stock (mh_fuel_stock) Types
// ============================================================================
export type MhFuelType = "Diesel (ดีเซล)" | "Gasoline (เบนซิน)";
export type MhFuelTransactionType =
  | "Inbound Receipt (รับเข้า)"
  | "Outbound Withdrawal (เบิกออก)";

export interface MhFuelStockRecord {
  id: string;
  transactionNo: string;
  type: MhFuelTransactionType;
  fuelType: MhFuelType;
  qty: number;
  meterStart: number;
  meterEnd: number;
  recorderName: string;
  referenceSource: string; // Supplier for inbound, Vehicle ID for outbound
  purposeOrNotes: string;
  workingDate: string;
  timestamp: string;
  updatedAt?: string;
}

// ============================================================================
// 4. Tire Stock (mh_tire_stock) Types
// ============================================================================
export type MhTireSize =
  | "6.00-9 (ยางตันหน้า/หลัง 2.5T)"
  | "7.00-12 (ยางตันหน้า 2.5T-3.0T)"
  | "28x9-15 (ยางตันหน้า 3.0T-3.5T)"
  | "6.50-10 (ยางตันหลัง 3.0T-3.5T)"
  | "250-15 (ยางตันหน้า 4.0T-5.0T)"
  | "300-15 (ยางตันหน้า 5.0T-7.0T)"
  | "8.25-15 (ยางตันรถลากจูง/เทรลเลอร์)";

export type MhTireTransactionType = "Inbound" | "Outbound";

export interface MhTireStockRecord {
  id: string;
  transactionNo: string;
  date: string;
  time: string;
  transactionType: MhTireTransactionType;
  tireSize: MhTireSize | string;
  brand: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  supplierOrInvoice?: string;
  vehicleId?: string;
  vehicleNumber?: string;
  wheelPosition?: string; // e.g. "ล้อหน้าซ้าย (FL)", "ล้อหน้าขวา (FR)", "ล้อหลังซ้าย (RL)", "ล้อหลังขวา (RR)", "ครบชุด 4 ล้อ"
  operatingHours?: number;
  technicianOrReceiver: string;
  workOrderRef?: string;
  notes?: string;
  updatedAt?: string;
}

// ============================================================================
// Helpers & Sanitizers
// ============================================================================
function sanitizeDocId(id: string): string {
  return String(id || "")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 128);
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

export function formatForkliftNowTimestamp(): {
  timestamp: string;
  dateYmd: string;
  timeHm: string;
  timeHms: string;
} {
  const now = new Date();
  const dateYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeHms = now.toTimeString().slice(0, 8);
  const timeHm = now.toTimeString().slice(0, 5);
  return {
    timestamp: `${dateYmd} ${timeHms}`,
    dateYmd,
    timeHm,
    timeHms,
  };
}

// ============================================================================
// Write Circuit Breaker & Quota Guard for dbForklift
// ============================================================================
let forkliftQuotaExhaustedUntil = 0;
const FORKLIFT_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

function isForkliftWritePaused(): boolean {
  return Date.now() < forkliftQuotaExhaustedUntil;
}

function markForkliftWriteExhausted(): void {
  forkliftQuotaExhaustedUntil = Date.now() + FORKLIFT_QUOTA_COOLDOWN_MS;
}

async function runForkliftFirestoreWriteWithGuard(
  writeFn: () => Promise<void>,
  opType: OperationType,
  path: string
): Promise<boolean> {
  if (isForkliftWritePaused()) {
    return false;
  }
  try {
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 3500)
    );
    const result = await Promise.race([
      writeFn().then(() => "ok" as const),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      markForkliftWriteExhausted();
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
      markForkliftWriteExhausted();
    }
    handleFirestoreError(error, opType, path);
    return false;
  }
}

// ============================================================================
// Isolated Listener Registry & Cloud Real-Time Mode Manager for Material Handling
// Prevents Read quota leaks when user switches away from Material Handling
// ============================================================================
const FORKLIFT_CLOUD_REALTIME_STORAGE_KEY = "tmt_wms_forklift_cloud_realtime_enabled_v1";
const activeForkliftFirestoreListeners = new Map<string, () => void>();
const forkliftRealtimeModeSubscribers = new Set<(enabled: boolean) => void>();

let forkliftCloudRealtimeEnabled: boolean = (() => {
  if (typeof window === "undefined") return true;
  try {
    const saved = window.localStorage.getItem(FORKLIFT_CLOUD_REALTIME_STORAGE_KEY);
    return saved === null ? true : saved !== "false";
  } catch {
    return true;
  }
})();

function registerForkliftFirestoreListener(channelKey: string, unsubFn: () => void): () => void {
  const existing = activeForkliftFirestoreListeners.get(channelKey);
  if (existing) {
    try {
      existing();
    } catch {
      // ignore cleanup error
    }
    activeForkliftFirestoreListeners.delete(channelKey);
  }
  activeForkliftFirestoreListeners.set(channelKey, unsubFn);
  return () => {
    try {
      unsubFn();
    } catch {
      // ignore cleanup error
    }
    if (activeForkliftFirestoreListeners.get(channelKey) === unsubFn) {
      activeForkliftFirestoreListeners.delete(channelKey);
    }
  };
}

/**
 * Immediately clears all active Firestore listeners for Material Handling (Forklift).
 * Must be called when unmounting Material Handling components or switching to another menu.
 */
export function unsubscribeAllForkliftFirestoreListeners(): void {
  activeForkliftFirestoreListeners.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // ignore cleanup error
    }
  });
  activeForkliftFirestoreListeners.clear();
}

/**
 * Alias for unsubscribeAllForkliftFirestoreListeners() to satisfy strict unsubscribe() contract
 */
export const unsubscribe = unsubscribeAllForkliftFirestoreListeners;

export function getActiveForkliftListenerCount(): number {
  return activeForkliftFirestoreListeners.size;
}

export function getForkliftCloudRealtimeEnabled(): boolean {
  return forkliftCloudRealtimeEnabled;
}

export function setForkliftCloudRealtimeEnabled(enabled: boolean): void {
  if (forkliftCloudRealtimeEnabled === enabled) return;
  forkliftCloudRealtimeEnabled = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        FORKLIFT_CLOUD_REALTIME_STORAGE_KEY,
        enabled ? "true" : "false"
      );
    } catch {
      // ignore storage error
    }
  }
  if (!enabled) {
    unsubscribeAllForkliftFirestoreListeners();
  }
  forkliftRealtimeModeSubscribers.forEach((cb) => {
    try {
      cb(enabled);
    } catch {
      // ignore callback error
    }
  });
}

export function subscribeForkliftCloudRealtimeMode(
  cb: (enabled: boolean) => void
): () => void {
  forkliftRealtimeModeSubscribers.add(cb);
  return () => {
    forkliftRealtimeModeSubscribers.delete(cb);
  };
}

// ============================================================================
// 1. mh_transfers (Transport Operations) CRUD & Subscription
// ============================================================================
function sanitizeMhTransferPayload(
  r: Partial<MhTransferRecord> & { id: string }
): MhTransferRecord {
  const { timestamp, dateYmd } = formatForkliftNowTimestamp();
  const docId = sanitizeDocId(r.id || r.transferCode || `TRF-${Date.now()}`);
  return stripUndefinedDeep({
    id: docId,
    transferCode: String(r.transferCode || docId).trim().slice(0, 64),
    originFacility: String(r.originFacility || "-").trim().slice(0, 128),
    destinationFacility: String(r.destinationFacility || "-").trim().slice(0, 128),
    sku: String(r.sku || "-").trim().slice(0, 64),
    itemName: String(r.itemName || "-").trim().slice(0, 128),
    productCategory: String(r.productCategory || "Raw Material Coils").trim().slice(0, 64),
    batchNumber: String(r.batchNumber || "-").trim().slice(0, 64),
    palletId: String(r.palletId || "-").trim().slice(0, 64),
    quantity: typeof r.quantity === "number" && !isNaN(r.quantity) ? Math.max(0, r.quantity) : 1,
    unit: String(r.unit || "Coil").trim().slice(0, 32),
    weightTon: typeof r.weightTon === "number" && !isNaN(r.weightTon) ? Math.max(0, r.weightTon) : 0,
    recorderName: String(r.recorderName || "-").trim().slice(0, 128),
    workingDate: String(r.workingDate || dateYmd).trim().slice(0, 32),
    status:
      r.status === "Pending" ||
      r.status === "In Transit" ||
      r.status === "Completed" ||
      r.status === "Cancelled"
        ? r.status
        : "Pending",
    priority:
      r.priority === "Urgent" || r.priority === "Express" ? r.priority : "Normal",
    vehicleNumber: String(r.vehicleNumber || "-").trim().slice(0, 64),
    driverName: String(r.driverName || "-").trim().slice(0, 128),
    transportCost:
      typeof r.transportCost === "number" && !isNaN(r.transportCost)
        ? Math.max(0, r.transportCost)
        : 0,
    notes: r.notes ? String(r.notes).trim().slice(0, 500) : undefined,
    createdAt: String(r.createdAt || timestamp.slice(0, 16)).slice(0, 64),
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhTransfers(items: MhTransferRecord[]): MhTransferRecord[] {
  return [...items].sort((a, b) => {
    const dtA = a.createdAt || a.workingDate || a.updatedAt || "";
    const dtB = b.createdAt || b.workingDate || b.updatedAt || "";
    if (dtA !== dtB) return dtB.localeCompare(dtA);
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

export async function fetchMhTransfersOnce(): Promise<MhTransferRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_TRANSFERS_COLLECTION));
    const records: MhTransferRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhTransferRecord;
      if (data && data.id) {
        records.push(data);
      }
    });
    return sortMhTransfers(records);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_TRANSFERS_COLLECTION);
    return [];
  }
}

export function subscribeToMhTransfers(
  onData: (records: MhTransferRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_transfers_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhTransfersOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_TRANSFERS_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhTransferRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhTransferRecord;
        if (data && data.id) {
          records.push(data);
        }
      });
      onData(sortMhTransfers(records));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_TRANSFERS_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhTransferToCloud(record: MhTransferRecord): Promise<boolean> {
  const payload = sanitizeMhTransferPayload(record);
  const docRef = doc(dbForklift, MH_TRANSFERS_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_TRANSFERS_COLLECTION}/${payload.id}`
  );
}

export async function deleteMhTransferFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const docRef = doc(dbForklift, MH_TRANSFERS_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_TRANSFERS_COLLECTION}/${cleanId}`
  );
}

// ============================================================================
// 2. mh_maintenance (Fix & Flush / Maintenance) CRUD & Subscription
// ============================================================================
function sanitizeMhMaintenancePayload(r: MhMaintenanceRecord): MhMaintenanceRecord {
  const { timestamp, dateYmd } = formatForkliftNowTimestamp();
  const docId = sanitizeDocId(r.id || r.workOrderNo || `FIX-${Date.now()}`);
  const safeParts: MhSparePartItem[] = Array.isArray(r.spareParts)
    ? r.spareParts.map((sp, idx) => ({
        id: String(sp.id || `SP-${idx + 1}`).slice(0, 64),
        partCode: String(sp.partCode || "-").trim().slice(0, 64),
        partName: String(sp.partName || "-").trim().slice(0, 128),
        qty: typeof sp.qty === "number" && !isNaN(sp.qty) ? Math.max(0, sp.qty) : 1,
        unit: String(sp.unit || "PCS").trim().slice(0, 32),
        unitCost: typeof sp.unitCost === "number" && !isNaN(sp.unitCost) ? Math.max(0, sp.unitCost) : 0,
      }))
    : [];

  const safeFeedback: MhFeedbackComment[] = Array.isArray(r.feedbackThread)
    ? r.feedbackThread.map((fb, idx) =>
        stripUndefinedDeep({
          id: String(fb.id || `FB-${idx + 1}`).slice(0, 64),
          author: String(fb.author || "-").trim().slice(0, 128),
          role: fb.role === "Manager" ? "Manager" : "Technician",
          timestamp: String(fb.timestamp || timestamp).slice(0, 64),
          queryType: fb.queryType ? String(fb.queryType).slice(0, 128) : undefined,
          message: String(fb.message || "").trim().slice(0, 500),
        })
      )
    : [];

  return stripUndefinedDeep({
    id: docId,
    workOrderNo: String(r.workOrderNo || docId).trim().slice(0, 64),
    vehicleId: String(r.vehicleId || "").trim().slice(0, 64),
    vehicleNumber: String(r.vehicleNumber || r.vehicleId || "").trim().slice(0, 64),
    vehicleType: String(r.vehicleType || "Forklift").trim().slice(0, 64),
    vehicleDescription: String(r.vehicleDescription || "-").trim().slice(0, 256),
    repairType: String(r.repairType || "ซ่อมบำรุงทั่วไป").trim().slice(0, 128),
    repairDescription: String(r.repairDescription || "-").trim().slice(0, 500),
    status:
      r.status === "Pending Inspection" ||
      r.status === "In Workshop" ||
      r.status === "Testing" ||
      r.status === "Approved" ||
      r.status === "Completed"
        ? r.status
        : "Pending Inspection",
    workingDate: String(r.workingDate || dateYmd).trim().slice(0, 32),
    spareParts: safeParts,
    estimatedCost:
      typeof r.estimatedCost === "number" && !isNaN(r.estimatedCost)
        ? Math.max(0, r.estimatedCost)
        : 0,
    actualCost:
      typeof r.actualCost === "number" && !isNaN(r.actualCost)
        ? Math.max(0, r.actualCost)
        : undefined,
    technicianName: String(r.technicianName || "-").trim().slice(0, 128),
    workshopBay: String(r.workshopBay || "-").trim().slice(0, 128),
    operatingHours:
      typeof r.operatingHours === "number" && !isNaN(r.operatingHours)
        ? Math.max(0, r.operatingHours)
        : 0,
    createdAt: String(r.createdAt || timestamp.slice(0, 16)).slice(0, 64),
    completedAt: r.completedAt ? String(r.completedAt).slice(0, 64) : undefined,
    managerStatus: r.managerStatus || "Pending Manager Approval",
    progressStatus: r.progressStatus || "Awaiting Approval",
    feedbackThread: safeFeedback,
    notes: r.notes ? String(r.notes).trim().slice(0, 500) : undefined,
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhMaintenance(items: MhMaintenanceRecord[]): MhMaintenanceRecord[] {
  return [...items].sort((a, b) => {
    const dtA = a.createdAt || a.updatedAt || "";
    const dtB = b.createdAt || b.updatedAt || "";
    return dtB.localeCompare(dtA);
  });
}

export async function fetchMhMaintenanceOnce(): Promise<MhMaintenanceRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_MAINTENANCE_COLLECTION));
    const records: MhMaintenanceRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhMaintenanceRecord;
      if (data && data.id) {
        records.push({
          ...data,
          spareParts: Array.isArray(data.spareParts) ? data.spareParts : [],
          feedbackThread: Array.isArray(data.feedbackThread) ? data.feedbackThread : [],
        });
      }
    });
    return sortMhMaintenance(records);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_MAINTENANCE_COLLECTION);
    return [];
  }
}

export function subscribeToMhMaintenance(
  onData: (records: MhMaintenanceRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_maintenance_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhMaintenanceOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_MAINTENANCE_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhMaintenanceRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhMaintenanceRecord;
        if (data && data.id) {
          records.push({
            ...data,
            spareParts: Array.isArray(data.spareParts) ? data.spareParts : [],
            feedbackThread: Array.isArray(data.feedbackThread) ? data.feedbackThread : [],
          });
        }
      });
      onData(sortMhMaintenance(records));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_MAINTENANCE_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhMaintenanceToCloud(record: MhMaintenanceRecord): Promise<boolean> {
  const payload = sanitizeMhMaintenancePayload(record);
  const docRef = doc(dbForklift, MH_MAINTENANCE_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_MAINTENANCE_COLLECTION}/${payload.id}`
  );
}

export async function deleteMhMaintenanceFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const docRef = doc(dbForklift, MH_MAINTENANCE_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_MAINTENANCE_COLLECTION}/${cleanId}`
  );
}

// ============================================================================
// 3. mh_fuel_stock (Fuel Stock & Transactions) CRUD & Subscription
// ============================================================================
function sanitizeMhFuelStockPayload(r: MhFuelStockRecord): MhFuelStockRecord {
  const { timestamp, dateYmd } = formatForkliftNowTimestamp();
  const docId = sanitizeDocId(r.id || r.transactionNo || `FUEL-${Date.now()}`);
  const safeQty = typeof r.qty === "number" && !isNaN(r.qty) ? Math.max(0, r.qty) : 0;
  const safeStart =
    typeof r.meterStart === "number" && !isNaN(r.meterStart) ? Math.max(0, r.meterStart) : 0;
  const safeEnd =
    typeof r.meterEnd === "number" && !isNaN(r.meterEnd) ? Math.max(0, r.meterEnd) : safeStart;

  return stripUndefinedDeep({
    id: docId,
    transactionNo: String(r.transactionNo || docId).trim().slice(0, 64),
    type: r.type?.includes("Outbound")
      ? "Outbound Withdrawal (เบิกออก)"
      : "Inbound Receipt (รับเข้า)",
    fuelType: r.fuelType?.includes("Gasoline") || r.fuelType?.includes("เบนซิน")
      ? "Gasoline (เบนซิน)"
      : "Diesel (ดีเซล)",
    qty: safeQty,
    meterStart: safeStart,
    meterEnd: safeEnd,
    recorderName: String(r.recorderName || "WMS Storekeeper").trim().slice(0, 128),
    referenceSource: String(r.referenceSource || "-").trim().slice(0, 128),
    purposeOrNotes: String(r.purposeOrNotes || "-").trim().slice(0, 500),
    workingDate: String(r.workingDate || dateYmd).trim().slice(0, 32),
    timestamp: String(r.timestamp || timestamp.slice(0, 16)).slice(0, 64),
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhFuelStock(items: MhFuelStockRecord[]): MhFuelStockRecord[] {
  return [...items].sort((a, b) => {
    const dtA = a.timestamp || a.workingDate || a.updatedAt || "";
    const dtB = b.timestamp || b.workingDate || b.updatedAt || "";
    if (dtA !== dtB) return dtB.localeCompare(dtA);
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

export async function fetchMhFuelStockOnce(): Promise<MhFuelStockRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_FUEL_STOCK_COLLECTION));
    const records: MhFuelStockRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhFuelStockRecord;
      if (data && data.id) {
        records.push(data);
      }
    });
    return sortMhFuelStock(records);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_FUEL_STOCK_COLLECTION);
    return [];
  }
}

export function subscribeToMhFuelStock(
  onData: (records: MhFuelStockRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_fuel_stock_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhFuelStockOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_FUEL_STOCK_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhFuelStockRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhFuelStockRecord;
        if (data && data.id) {
          records.push(data);
        }
      });
      onData(sortMhFuelStock(records));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_FUEL_STOCK_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhFuelTransactionToCloud(
  record: MhFuelStockRecord
): Promise<boolean> {
  const payload = sanitizeMhFuelStockPayload(record);
  const docRef = doc(dbForklift, MH_FUEL_STOCK_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_FUEL_STOCK_COLLECTION}/${payload.id}`
  );
}

export async function deleteMhFuelTransactionFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const docRef = doc(dbForklift, MH_FUEL_STOCK_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_FUEL_STOCK_COLLECTION}/${cleanId}`
  );
}

// ============================================================================
// 4. mh_tire_stock (Tire Stock & Replacement Logs) CRUD & Subscription
// ============================================================================
function sanitizeMhTireStockPayload(r: MhTireStockRecord): MhTireStockRecord {
  const { timestamp, dateYmd, timeHm } = formatForkliftNowTimestamp();
  const docId = sanitizeDocId(r.id || r.transactionNo || `TIRE-${Date.now()}`);
  const safeQty = typeof r.qty === "number" && !isNaN(r.qty) ? Math.max(1, r.qty) : 1;
  const safeUnitCost =
    typeof r.unitCost === "number" && !isNaN(r.unitCost) ? Math.max(0, r.unitCost) : 0;
  const safeTotalCost =
    typeof r.totalCost === "number" && !isNaN(r.totalCost) && r.totalCost > 0
      ? r.totalCost
      : safeQty * safeUnitCost;

  return stripUndefinedDeep({
    id: docId,
    transactionNo: String(r.transactionNo || docId).trim().slice(0, 64),
    date: String(r.date || dateYmd).trim().slice(0, 32),
    time: String(r.time || timeHm).trim().slice(0, 32),
    transactionType: r.transactionType === "Outbound" ? "Outbound" : "Inbound",
    tireSize: String(r.tireSize || "7.00-12 (ยางตันหน้า 2.5T-3.0T)").trim().slice(0, 128),
    brand: String(r.brand || "KOMACHI / PIO").trim().slice(0, 64),
    qty: safeQty,
    unitCost: safeUnitCost,
    totalCost: safeTotalCost,
    supplierOrInvoice: r.supplierOrInvoice
      ? String(r.supplierOrInvoice).trim().slice(0, 128)
      : undefined,
    vehicleId: r.vehicleId ? String(r.vehicleId).trim().slice(0, 64) : undefined,
    vehicleNumber: r.vehicleNumber ? String(r.vehicleNumber).trim().slice(0, 64) : undefined,
    wheelPosition: r.wheelPosition ? String(r.wheelPosition).trim().slice(0, 64) : undefined,
    operatingHours:
      typeof r.operatingHours === "number" && !isNaN(r.operatingHours)
        ? Math.max(0, r.operatingHours)
        : undefined,
    technicianOrReceiver: String(r.technicianOrReceiver || "-").trim().slice(0, 128),
    workOrderRef: r.workOrderRef ? String(r.workOrderRef).trim().slice(0, 64) : undefined,
    notes: r.notes ? String(r.notes).trim().slice(0, 500) : undefined,
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhTireStock(items: MhTireStockRecord[]): MhTireStockRecord[] {
  return [...items].sort((a, b) => {
    const dtA = `${a.date || ""} ${a.time || ""}`;
    const dtB = `${b.date || ""} ${b.time || ""}`;
    if (dtA !== dtB) return dtB.localeCompare(dtA);
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
}

export async function fetchMhTireStockOnce(): Promise<MhTireStockRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_TIRE_STOCK_COLLECTION));
    const records: MhTireStockRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhTireStockRecord;
      if (data && data.id) {
        records.push(data);
      }
    });
    return sortMhTireStock(records);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_TIRE_STOCK_COLLECTION);
    return [];
  }
}

export function subscribeToMhTireStock(
  onData: (records: MhTireStockRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_tire_stock_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhTireStockOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_TIRE_STOCK_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhTireStockRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhTireStockRecord;
        if (data && data.id) {
          records.push(data);
        }
      });
      onData(sortMhTireStock(records));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_TIRE_STOCK_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhTireTransactionToCloud(
  record: MhTireStockRecord
): Promise<boolean> {
  const payload = sanitizeMhTireStockPayload(record);
  const docRef = doc(dbForklift, MH_TIRE_STOCK_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_TIRE_STOCK_COLLECTION}/${payload.id}`
  );
}

export async function deleteMhTireTransactionFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const docRef = doc(dbForklift, MH_TIRE_STOCK_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_TIRE_STOCK_COLLECTION}/${cleanId}`
  );
}
