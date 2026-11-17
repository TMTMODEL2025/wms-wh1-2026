import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
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
export const MH_DAILY_DUTY_COLLECTION = "mh_daily_duty";
export const MH_DELIVERY_POINTS_COLLECTION = "mh_delivery_points";

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
  transferType?: string; // งาน Stock | ทั่วไป | งานฝาก | อื่นๆ
  batchNumber: string;
  palletId: string;
  quantity: number;
  unit: string;
  weightTon: number;
  // 3-field Weight Breakdown
  fullBundles?: number; // จำนวนมัด (มัดเต็ม)
  weightPerBundleKg?: number; // น้ำหนักต่อมัด (กก.)
  remainderWeightKg?: number; // น้ำหนักเศษ (กก.)
  totalBundles?: number; // รวมมัดทั้งหมด (มัดเต็ม + 1 ถ้ามีเศษ)
  totalWeightKg?: number; // น้ำหนักรวมสุทธิ (กก.)
  // SLA 20-minute Real-time Timing
  startTime?: string; // HH:mm:ss
  startTimeMs?: number; // epoch ms
  endTime?: string; // HH:mm:ss
  endTimeMs?: number; // epoch ms
  durationSeconds?: number;
  durationMinutes?: number;
  isSlaOverdue?: boolean; // true when durationSeconds > 1200 (> 20 min)
  // Multi-trip Batch
  tripIndex?: number;
  totalTrips?: number;
  batchGroupId?: string;
  recorderName: string;
  workingDate: string;
  status: MhTransferStatus;
  priority: MhPriorityLevel;
  vehicleNumber: string;
  trailerNumber?: string;
  driverName: string;
  workArea?: string; // พื้นที่การทำงานหลัก เช่น อาคาร A, อาคาร B, ลานพักสินค้า
  shift?: string; // กะทำงาน เช่น กะเช้า, กะดึก
  team?: string; // ทีม A | ทีม B | ทีม C
  transportCost?: number;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

// ============================================================================
// 1B. Daily Duty Assignment (mh_daily_duty) Types & Constants
// ============================================================================
export const MH_TEAMS = ["ทีม A", "ทีม B", "ทีม C"] as const;
export const MH_SHIFTS = ["กะเช้า", "กะดึก"] as const;
export const MH_WORK_AREAS = [
  "อาคาร A",
  "อาคาร B",
  "อาคาร C",
  "ลานพักสินค้า",
  "คลังสินค้า 1",
] as const;

export interface MhDailyDutyRecord {
  id: string;
  workingDate: string; // YYYY-MM-DD
  employeeId?: string;
  employeeName: string;
  workArea: string;
  vehicleNumber: string;
  shift: string;
  team: string;
  supervisorName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 1C. Delivery Points & Gates (mh_delivery_points) Types
// ============================================================================
export interface MhDeliveryPointRecord {
  id: string;
  deliveryPoint: string; // จุดส่งสินค้า เช่น "อาคาร A"
  gate: string; // ประตู เช่น "ประตู A2"
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 2. Maintenance / Fix & Flush (mh_maintenance) Types
// ============================================================================
export const MH_REPAIR_CATEGORIES = [
  "ซ่อมเชิงป้องกัน (PM)",
  "ซ่อมทั่วไป (MN)",
  "ระบบส่งกำลัง",
  "ระบบเบรค",
  "ยางเสื่อมสภาพ",
  "PM ไฮดรอลิค",
  "ยางรั่ว",
  "ระบบระบายความร้อน",
  "ระบบแบตเตอร์รี่",
  "ระบบไฟรถ",
  "เครื่องยนต์",
  "ตู้ชาร์จไฟ",
  "ไฮดรอลิค",
  "ระบบช่วงล่าง",
  "ระบบไดสตาร์ท",
  "ระบบไดชาร์จ",
  "ระบบเชื้อเพลิง",
  "มอเตอร์",
  "โครงสร้าง",
  "ระบบปรับอากาศ",
  "ระบบเซนเซอร์",
  "เคส อุบัติเหตุ",
  "พัดลม",
  "อื่นๆ",
] as const;

export type MhRepairType = (typeof MH_REPAIR_CATEGORIES)[number] | string;

export type MhWorkflowStage =
  | "Submitted"
  | "SupervisorChecked"
  | "ManagerApproved"
  | "Rejected"
  | "Completed";

export type MhSupervisorStatus = "Pending" | "Checked" | "Returned";

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

export interface MhRepairPhotoItem {
  id: string;
  name: string;
  dataUrl: string;
  sizeBytes?: number;
  uploadedAt?: string;
}

export interface MhFeedbackComment {
  id: string;
  author: string;
  role: "Manager" | "Supervisor" | "Technician" | "Requester";
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
  requesterName?: string;
  vehicleId: string;
  vehicleNumber?: string;
  vehicleType?: string;
  vehicleDescription: string;
  repairType: string;
  repairDescription: string;
  workflowStage?: MhWorkflowStage;
  status: MhMaintenanceStatus;
  workingDate: string;
  spareParts: MhSparePartItem[];
  partsCost?: number;
  laborCost?: number;
  estimatedCost: number;
  actualCost?: number;
  technicianName: string;
  vendorName?: string;
  workshopBay: string;
  operatingHours: number;
  createdAt: string;
  completedAt?: string;
  supervisorStatus?: MhSupervisorStatus;
  supervisorName?: string;
  supervisorCheckedAt?: string;
  supervisorNotes?: string;
  managerStatus: MhManagerApprovalStatus;
  managerName?: string;
  managerApprovedAt?: string;
  managerDecisionNote?: string;
  progressStatus?: MhWorkOrderProgress;
  photos?: MhRepairPhotoItem[];
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
  const { timestamp, dateYmd, timeHms } = formatForkliftNowTimestamp();
  const docId = sanitizeDocId(r.id || r.transferCode || `TRF-${Date.now()}`);

  const fullBundles =
    typeof r.fullBundles === "number" && !isNaN(r.fullBundles)
      ? Math.max(0, Math.floor(r.fullBundles))
      : undefined;
  const weightPerBundleKg =
    typeof r.weightPerBundleKg === "number" && !isNaN(r.weightPerBundleKg)
      ? Math.max(0, r.weightPerBundleKg)
      : undefined;
  const remainderWeightKg =
    typeof r.remainderWeightKg === "number" && !isNaN(r.remainderWeightKg)
      ? Math.max(0, r.remainderWeightKg)
      : undefined;
  const computedTotalKg =
    fullBundles !== undefined && weightPerBundleKg !== undefined
      ? fullBundles * weightPerBundleKg + (remainderWeightKg || 0)
      : typeof r.totalWeightKg === "number" && !isNaN(r.totalWeightKg)
      ? Math.max(0, r.totalWeightKg)
      : undefined;
  const computedTotalBundles =
    fullBundles !== undefined
      ? fullBundles + ((remainderWeightKg || 0) > 0 ? 1 : 0)
      : typeof r.totalBundles === "number" && !isNaN(r.totalBundles)
      ? Math.max(0, r.totalBundles)
      : undefined;

  const weightTon =
    typeof r.weightTon === "number" && !isNaN(r.weightTon) && r.weightTon > 0
      ? Math.max(0, r.weightTon)
      : computedTotalKg !== undefined
      ? Number((computedTotalKg / 1000).toFixed(3))
      : 0;

  return stripUndefinedDeep({
    id: docId,
    transferCode: String(r.transferCode || docId).trim().slice(0, 64),
    originFacility: String(r.originFacility || "-").trim().slice(0, 128),
    destinationFacility: String(r.destinationFacility || "-").trim().slice(0, 128),
    sku: String(r.sku || "-").trim().slice(0, 64),
    itemName: String(r.itemName || "-").trim().slice(0, 128),
    productCategory: String(r.productCategory || r.transferType || "งาน Stock").trim().slice(0, 64),
    transferType: r.transferType ? String(r.transferType).trim().slice(0, 64) : undefined,
    batchNumber: String(r.batchNumber || "-").trim().slice(0, 64),
    palletId: String(r.palletId || "-").trim().slice(0, 64),
    quantity:
      typeof r.quantity === "number" && !isNaN(r.quantity)
        ? Math.max(0, r.quantity)
        : computedTotalBundles ?? 1,
    unit: String(r.unit || "มัด").trim().slice(0, 32),
    weightTon,
    fullBundles,
    weightPerBundleKg,
    remainderWeightKg,
    totalBundles: computedTotalBundles,
    totalWeightKg: computedTotalKg,
    startTime: r.startTime ? String(r.startTime).trim().slice(0, 32) : timeHms,
    startTimeMs:
      typeof r.startTimeMs === "number" && !isNaN(r.startTimeMs) ? r.startTimeMs : undefined,
    endTime: r.endTime ? String(r.endTime).trim().slice(0, 32) : undefined,
    endTimeMs: typeof r.endTimeMs === "number" && !isNaN(r.endTimeMs) ? r.endTimeMs : undefined,
    durationSeconds:
      typeof r.durationSeconds === "number" && !isNaN(r.durationSeconds)
        ? Math.max(0, Math.round(r.durationSeconds))
        : undefined,
    durationMinutes:
      typeof r.durationMinutes === "number" && !isNaN(r.durationMinutes)
        ? Math.max(0, r.durationMinutes)
        : undefined,
    isSlaOverdue: typeof r.isSlaOverdue === "boolean" ? r.isSlaOverdue : undefined,
    tripIndex:
      typeof r.tripIndex === "number" && !isNaN(r.tripIndex) ? Math.max(1, r.tripIndex) : undefined,
    totalTrips:
      typeof r.totalTrips === "number" && !isNaN(r.totalTrips)
        ? Math.max(1, r.totalTrips)
        : undefined,
    batchGroupId: r.batchGroupId ? String(r.batchGroupId).trim().slice(0, 64) : undefined,
    recorderName: String(r.recorderName || r.driverName || "-").trim().slice(0, 128),
    workingDate: String(r.workingDate || dateYmd).trim().slice(0, 32),
    status:
      r.status === "Pending" ||
      r.status === "In Transit" ||
      r.status === "Completed" ||
      r.status === "Cancelled"
        ? r.status
        : "In Transit",
    priority:
      r.priority === "Urgent" || r.priority === "Express" ? r.priority : "Normal",
    vehicleNumber: String(r.vehicleNumber || "-").trim().slice(0, 64),
    trailerNumber: r.trailerNumber ? String(r.trailerNumber).trim().slice(0, 64) : undefined,
    driverName: String(r.driverName || "-").trim().slice(0, 128),
    workArea: r.workArea ? String(r.workArea).trim().slice(0, 128) : undefined,
    shift: r.shift ? String(r.shift).trim().slice(0, 64) : undefined,
    team: r.team ? String(r.team).trim().slice(0, 64) : undefined,
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
    const msA = typeof a.startTimeMs === "number" ? a.startTimeMs : 0;
    const msB = typeof b.startTimeMs === "number" ? b.startTimeMs : 0;
    if (msA !== msB) return msB - msA;
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

export async function saveMhTransfersBatchToCloud(
  records: MhTransferRecord[]
): Promise<boolean> {
  if (records.length === 0) return true;
  if (records.length === 1) return saveMhTransferToCloud(records[0]);
  return runForkliftFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbForklift);
      records.forEach((rec) => {
        const payload = sanitizeMhTransferPayload(rec);
        const docRef = doc(dbForklift, MH_TRANSFERS_COLLECTION, payload.id);
        batch.set(docRef, payload, { merge: true });
      });
      await batch.commit();
    },
    OperationType.WRITE,
    MH_TRANSFERS_COLLECTION
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
export function generateNextRepairRequestNo(
  existingRecords: MhMaintenanceRecord[],
  targetDate: Date = new Date()
): string {
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const prefix = `TMT-${year}-${month}-`;
  let maxSeq = 0;

  for (const rec of existingRecords) {
    const code = String(rec.workOrderNo || rec.id || "").trim().toUpperCase();
    if (code.startsWith(prefix)) {
      const tail = code.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (!isNaN(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }

  let nextSeq = maxSeq + 1;
  let candidate = `${prefix}${String(nextSeq).padStart(3, "0")}`;
  const existingSet = new Set(
    existingRecords.map((r) => String(r.workOrderNo || r.id || "").trim().toUpperCase())
  );
  while (existingSet.has(candidate)) {
    nextSeq += 1;
    candidate = `${prefix}${String(nextSeq).padStart(3, "0")}`;
  }
  return candidate;
}

export function inferMhWorkflowStage(r: MhMaintenanceRecord): MhWorkflowStage {
  if (
    r.workflowStage === "Submitted" ||
    r.workflowStage === "SupervisorChecked" ||
    r.workflowStage === "ManagerApproved" ||
    r.workflowStage === "Rejected" ||
    r.workflowStage === "Completed"
  ) {
    return r.workflowStage;
  }
  if (r.managerStatus === "Rejected") return "Rejected";
  if (r.status === "Completed") return "Completed";
  if (r.managerStatus === "Approved") return "ManagerApproved";
  if (r.supervisorStatus === "Checked") return "SupervisorChecked";
  if (r.supervisorStatus === "Pending" || r.supervisorStatus === "Returned") return "Submitted";
  // Legacy records created before 3-stage workflow
  return "SupervisorChecked";
}

function sanitizeMhMaintenancePayload(r: MhMaintenanceRecord): MhMaintenanceRecord {
  const { timestamp, dateYmd } = formatForkliftNowTimestamp();
  const docId = sanitizeDocId(r.id || r.workOrderNo || `TMT-${Date.now()}`);
  const safeParts: MhSparePartItem[] = Array.isArray(r.spareParts)
    ? r.spareParts.slice(0, 100).map((sp, idx) => ({
        id: String(sp.id || `SP-${idx + 1}`).slice(0, 64),
        partCode: String(sp.partCode || "-").trim().slice(0, 64),
        partName: String(sp.partName || "-").trim().slice(0, 128),
        qty: typeof sp.qty === "number" && !isNaN(sp.qty) ? Math.max(0, sp.qty) : 1,
        unit: String(sp.unit || "ชิ้น").trim().slice(0, 32),
        unitCost: typeof sp.unitCost === "number" && !isNaN(sp.unitCost) ? Math.max(0, sp.unitCost) : 0,
      }))
    : [];

  const computedPartsFromRows = safeParts.reduce(
    (sum, sp) => sum + (Number(sp.qty) || 0) * (Number(sp.unitCost) || 0),
    0
  );
  const partsCost =
    typeof r.partsCost === "number" && !isNaN(r.partsCost)
      ? Math.max(0, r.partsCost)
      : computedPartsFromRows;
  const laborCost =
    typeof r.laborCost === "number" && !isNaN(r.laborCost)
      ? Math.max(0, r.laborCost)
      : 0;
  const estimatedCost =
    typeof r.estimatedCost === "number" && !isNaN(r.estimatedCost) && r.estimatedCost > 0
      ? Math.max(0, r.estimatedCost)
      : partsCost + laborCost;

  const safeFeedback: MhFeedbackComment[] = Array.isArray(r.feedbackThread)
    ? r.feedbackThread.map((fb, idx) =>
        stripUndefinedDeep({
          id: String(fb.id || `FB-${idx + 1}`).slice(0, 64),
          author: String(fb.author || "-").trim().slice(0, 128),
          role:
            fb.role === "Manager" ||
            fb.role === "Supervisor" ||
            fb.role === "Requester"
              ? fb.role
              : "Technician",
          timestamp: String(fb.timestamp || timestamp).slice(0, 64),
          queryType: fb.queryType ? String(fb.queryType).slice(0, 128) : undefined,
          message: String(fb.message || "").trim().slice(0, 500),
        })
      )
    : [];

  const safePhotos: MhRepairPhotoItem[] = [];
  let accumulatedPhotoBytes = 0;
  const MAX_TOTAL_PHOTO_BYTES = 720 * 1024;
  if (Array.isArray(r.photos)) {
    for (let i = 0; i < Math.min(9, r.photos.length); i++) {
      const ph = r.photos[i];
      if (!ph || typeof ph.dataUrl !== "string") continue;
      if (!ph.dataUrl.startsWith("data:image/")) continue;
      if (ph.dataUrl.length > 340000) continue;
      if (accumulatedPhotoBytes + ph.dataUrl.length > MAX_TOTAL_PHOTO_BYTES) break;
      accumulatedPhotoBytes += ph.dataUrl.length;
      safePhotos.push(
        stripUndefinedDeep({
          id: String(ph.id || `PH-${i + 1}`).slice(0, 64),
          name: String(ph.name || `photo_${i + 1}.jpg`).slice(0, 128),
          dataUrl: ph.dataUrl,
          sizeBytes:
            typeof ph.sizeBytes === "number" && !isNaN(ph.sizeBytes)
              ? ph.sizeBytes
              : ph.dataUrl.length,
          uploadedAt: ph.uploadedAt ? String(ph.uploadedAt).slice(0, 64) : timestamp,
        })
      );
    }
  }

  const workflowStage = inferMhWorkflowStage(r);
  const supervisorStatus: MhSupervisorStatus =
    r.supervisorStatus === "Checked" ||
    r.supervisorStatus === "Returned" ||
    r.supervisorStatus === "Pending"
      ? r.supervisorStatus
      : workflowStage === "Submitted"
      ? "Pending"
      : "Checked";

  return stripUndefinedDeep({
    id: docId,
    workOrderNo: String(r.workOrderNo || docId).trim().slice(0, 64),
    requesterName: r.requesterName
      ? String(r.requesterName).trim().slice(0, 128)
      : r.technicianName
      ? String(r.technicianName).trim().slice(0, 128)
      : "-",
    vehicleId: String(r.vehicleId || "").trim().slice(0, 64),
    vehicleNumber: String(r.vehicleNumber || r.vehicleId || "").trim().slice(0, 64),
    vehicleType: String(r.vehicleType || "Forklift").trim().slice(0, 64),
    vehicleDescription: String(r.vehicleDescription || "-").trim().slice(0, 256),
    repairType: String(r.repairType || "ซ่อมทั่วไป (MN)").trim().slice(0, 128),
    repairDescription: String(r.repairDescription || "-").trim().slice(0, 1000),
    workflowStage,
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
    partsCost,
    laborCost,
    estimatedCost,
    actualCost:
      typeof r.actualCost === "number" && !isNaN(r.actualCost)
        ? Math.max(0, r.actualCost)
        : undefined,
    technicianName: String(r.technicianName || "-").trim().slice(0, 128),
    vendorName: r.vendorName ? String(r.vendorName).trim().slice(0, 128) : undefined,
    workshopBay: String(r.workshopBay || "-").trim().slice(0, 128),
    operatingHours:
      typeof r.operatingHours === "number" && !isNaN(r.operatingHours)
        ? Math.max(0, r.operatingHours)
        : 0,
    createdAt: String(r.createdAt || timestamp.slice(0, 16)).slice(0, 64),
    completedAt: r.completedAt ? String(r.completedAt).slice(0, 64) : undefined,
    supervisorStatus,
    supervisorName: r.supervisorName ? String(r.supervisorName).trim().slice(0, 128) : undefined,
    supervisorCheckedAt: r.supervisorCheckedAt
      ? String(r.supervisorCheckedAt).slice(0, 64)
      : undefined,
    supervisorNotes: r.supervisorNotes
      ? String(r.supervisorNotes).trim().slice(0, 1000)
      : undefined,
    managerStatus: r.managerStatus || "Pending Manager Approval",
    managerName: r.managerName ? String(r.managerName).trim().slice(0, 128) : undefined,
    managerApprovedAt: r.managerApprovedAt ? String(r.managerApprovedAt).slice(0, 64) : undefined,
    managerDecisionNote: r.managerDecisionNote
      ? String(r.managerDecisionNote).trim().slice(0, 1000)
      : undefined,
    progressStatus: r.progressStatus || "Awaiting Approval",
    photos: safePhotos,
    feedbackThread: safeFeedback,
    notes: r.notes ? String(r.notes).trim().slice(0, 1000) : undefined,
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhMaintenance(items: MhMaintenanceRecord[]): MhMaintenanceRecord[] {
  return [...items].sort((a, b) => {
    const dtA = a.createdAt || a.updatedAt || "";
    const dtB = b.createdAt || b.updatedAt || "";
    if (dtA !== dtB) return dtB.localeCompare(dtA);
    return (b.workOrderNo || "").localeCompare(a.workOrderNo || "");
  });
}

function normalizeMhMaintenanceRecord(data: MhMaintenanceRecord): MhMaintenanceRecord {
  const spareParts = Array.isArray(data.spareParts) ? data.spareParts : [];
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const feedbackThread = Array.isArray(data.feedbackThread) ? data.feedbackThread : [];
  const workflowStage = inferMhWorkflowStage(data);
  return {
    ...data,
    spareParts,
    photos,
    feedbackThread,
    workflowStage,
    requesterName: data.requesterName || data.technicianName || "-",
    partsCost:
      typeof data.partsCost === "number"
        ? data.partsCost
        : spareParts.reduce((s, sp) => s + (Number(sp.qty) || 0) * (Number(sp.unitCost) || 0), 0),
    laborCost: typeof data.laborCost === "number" ? data.laborCost : 0,
    supervisorStatus:
      data.supervisorStatus ||
      (workflowStage === "Submitted" ? "Pending" : "Checked"),
  };
}

export async function fetchMhMaintenanceOnce(): Promise<MhMaintenanceRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_MAINTENANCE_COLLECTION));
    const records: MhMaintenanceRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhMaintenanceRecord;
      if (data && data.id) {
        records.push(normalizeMhMaintenanceRecord(data));
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
          records.push(normalizeMhMaintenanceRecord(data));
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

// ============================================================================
// 5. mh_daily_duty (Daily Duty Assignments) CRUD, Local Cache & Subscription
// ============================================================================
const MH_DAILY_DUTY_CACHE_KEY = "tmt_mh_daily_duty_cache_v1";

export function buildMhDailyDutyDocId(workingDate: string, employeeKey: string): string {
  const cleanDate = String(workingDate || "").replace(/[^0-9\-]/g, "");
  let hash = 0;
  const raw = String(employeeKey || "").trim().toLowerCase();
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  const asciiPart = raw.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 48);
  return sanitizeDocId(`DUTY_${cleanDate}_${asciiPart || "emp"}_${hash.toString(36)}`);
}

function sanitizeMhDailyDutyPayload(
  r: Partial<MhDailyDutyRecord> & { workingDate: string; employeeName: string }
): MhDailyDutyRecord {
  const { timestamp, dateYmd } = formatForkliftNowTimestamp();
  const cleanDate = String(r.workingDate || dateYmd).trim().slice(0, 32);
  const cleanName = String(r.employeeName || "-").trim().slice(0, 128);
  const keyForId = String(r.employeeId || cleanName).trim();
  const docId = sanitizeDocId(r.id || buildMhDailyDutyDocId(cleanDate, keyForId));

  return stripUndefinedDeep({
    id: docId,
    workingDate: cleanDate,
    employeeId: r.employeeId ? String(r.employeeId).trim().slice(0, 64) : undefined,
    employeeName: cleanName,
    workArea: String(r.workArea || "อาคาร A").trim().slice(0, 128),
    vehicleNumber: String(r.vehicleNumber || "-").trim().slice(0, 64),
    shift: String(r.shift || "กะเช้า").trim().slice(0, 64),
    team: String(r.team || "ทีม A").trim().slice(0, 64),
    supervisorName: r.supervisorName
      ? String(r.supervisorName).trim().slice(0, 128)
      : undefined,
    notes: r.notes ? String(r.notes).trim().slice(0, 500) : undefined,
    createdAt: String(r.createdAt || timestamp).slice(0, 64),
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhDailyDuties(items: MhDailyDutyRecord[]): MhDailyDutyRecord[] {
  return [...items].sort((a, b) => {
    if (a.workingDate !== b.workingDate) {
      return b.workingDate.localeCompare(a.workingDate);
    }
    if (a.team !== b.team) {
      return a.team.localeCompare(b.team, "th");
    }
    return a.employeeName.localeCompare(b.employeeName, "th");
  });
}

export function loadCachedMhDailyDuties(): MhDailyDutyRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MH_DAILY_DUTY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortMhDailyDuties(parsed) : [];
  } catch {
    return [];
  }
}

export function saveCachedMhDailyDuties(records: MhDailyDutyRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      MH_DAILY_DUTY_CACHE_KEY,
      JSON.stringify(sortMhDailyDuties(records))
    );
  } catch {
    // ignore storage quota error
  }
}

export async function fetchMhDailyDutiesOnce(): Promise<MhDailyDutyRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_DAILY_DUTY_COLLECTION));
    const records: MhDailyDutyRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhDailyDutyRecord;
      if (data && data.id) {
        records.push(data);
      }
    });
    const sorted = sortMhDailyDuties(records);
    if (sorted.length > 0) {
      saveCachedMhDailyDuties(sorted);
      return sorted;
    }
    return loadCachedMhDailyDuties();
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_DAILY_DUTY_COLLECTION);
    return loadCachedMhDailyDuties();
  }
}

export function subscribeToMhDailyDuties(
  onData: (records: MhDailyDutyRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_daily_duty_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhDailyDutiesOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_DAILY_DUTY_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhDailyDutyRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhDailyDutyRecord;
        if (data && data.id) {
          records.push(data);
        }
      });
      const sorted = sortMhDailyDuties(records);
      if (sorted.length > 0 || !snapshot.metadata.fromCache) {
        saveCachedMhDailyDuties(sorted);
      }
      onData(sorted);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_DAILY_DUTY_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhDailyDutyToCloud(
  record: Partial<MhDailyDutyRecord> & { workingDate: string; employeeName: string }
): Promise<boolean> {
  const payload = sanitizeMhDailyDutyPayload(record);
  const cached = loadCachedMhDailyDuties();
  const nextCache = [payload, ...cached.filter((item) => item.id !== payload.id)];
  saveCachedMhDailyDuties(nextCache);

  const docRef = doc(dbForklift, MH_DAILY_DUTY_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_DAILY_DUTY_COLLECTION}/${payload.id}`
  );
}

export async function saveMhDailyDutiesBatchToCloud(
  records: Array<Partial<MhDailyDutyRecord> & { workingDate: string; employeeName: string }>
): Promise<boolean> {
  if (records.length === 0) return true;
  const payloads = records.map(sanitizeMhDailyDutyPayload);
  const payloadIds = new Set(payloads.map((p) => p.id));
  const cached = loadCachedMhDailyDuties();
  const nextCache = [...payloads, ...cached.filter((item) => !payloadIds.has(item.id))];
  saveCachedMhDailyDuties(nextCache);

  if (payloads.length === 1) {
    const docRef = doc(dbForklift, MH_DAILY_DUTY_COLLECTION, payloads[0].id);
    return runForkliftFirestoreWriteWithGuard(
      () => setDoc(docRef, payloads[0], { merge: true }),
      OperationType.WRITE,
      `${MH_DAILY_DUTY_COLLECTION}/${payloads[0].id}`
    );
  }

  return runForkliftFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbForklift);
      payloads.forEach((payload) => {
        const docRef = doc(dbForklift, MH_DAILY_DUTY_COLLECTION, payload.id);
        batch.set(docRef, payload, { merge: true });
      });
      await batch.commit();
    },
    OperationType.WRITE,
    MH_DAILY_DUTY_COLLECTION
  );
}

export async function deleteMhDailyDutyFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const cached = loadCachedMhDailyDuties();
  saveCachedMhDailyDuties(cached.filter((item) => item.id !== cleanId));

  const docRef = doc(dbForklift, MH_DAILY_DUTY_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_DAILY_DUTY_COLLECTION}/${cleanId}`
  );
}

// ============================================================================
// 6. Delivery Points & Gates (mh_delivery_points) Cloud & Local Cache
// ============================================================================
const MH_DELIVERY_POINTS_CACHE_KEY = "tmt_mh_delivery_points_cache_v1";

function buildMhDeliveryPointDocId(deliveryPoint: string, gate: string): string {
  const raw = `${deliveryPoint.trim()}__${gate.trim()}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  const asciiPart = raw.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 48);
  return sanitizeDocId(`DP_${asciiPart || "point"}_${hash.toString(36)}`);
}

function sanitizeMhDeliveryPointPayload(
  r: Partial<MhDeliveryPointRecord> & { deliveryPoint: string }
): MhDeliveryPointRecord {
  const { timestamp } = formatForkliftNowTimestamp();
  const cleanPoint = String(r.deliveryPoint || "").trim().slice(0, 128);
  const cleanGate = String(r.gate ?? "-").trim().slice(0, 64) || "-";
  const docId = sanitizeDocId(r.id || buildMhDeliveryPointDocId(cleanPoint, cleanGate));

  return stripUndefinedDeep({
    id: docId,
    deliveryPoint: cleanPoint,
    gate: cleanGate,
    createdAt: String(r.createdAt || timestamp).slice(0, 64),
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhDeliveryPoints(items: MhDeliveryPointRecord[]): MhDeliveryPointRecord[] {
  return [...items].sort((a, b) => {
    const pCmp = a.deliveryPoint.localeCompare(b.deliveryPoint, "th", { numeric: true });
    if (pCmp !== 0) return pCmp;
    return a.gate.localeCompare(b.gate, "th", { numeric: true });
  });
}

export function extractUniqueDeliveryPointNames(items: MhDeliveryPointRecord[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    const name = String(item.deliveryPoint || "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function loadCachedMhDeliveryPoints(): MhDeliveryPointRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MH_DELIVERY_POINTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortMhDeliveryPoints(parsed) : [];
  } catch {
    return [];
  }
}

export function saveCachedMhDeliveryPoints(records: MhDeliveryPointRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      MH_DELIVERY_POINTS_CACHE_KEY,
      JSON.stringify(sortMhDeliveryPoints(records))
    );
  } catch {
    // ignore storage quota error
  }
}

export async function fetchMhDeliveryPointsOnce(): Promise<MhDeliveryPointRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_DELIVERY_POINTS_COLLECTION));
    const records: MhDeliveryPointRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhDeliveryPointRecord;
      if (data && data.id && data.deliveryPoint) {
        records.push(data);
      }
    });
    const sorted = sortMhDeliveryPoints(records);
    if (sorted.length > 0) {
      saveCachedMhDeliveryPoints(sorted);
      return sorted;
    }
    return loadCachedMhDeliveryPoints();
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_DELIVERY_POINTS_COLLECTION);
    return loadCachedMhDeliveryPoints();
  }
}

export function subscribeToMhDeliveryPoints(
  onData: (records: MhDeliveryPointRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_delivery_points_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhDeliveryPointsOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_DELIVERY_POINTS_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhDeliveryPointRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhDeliveryPointRecord;
        if (data && data.id && data.deliveryPoint) {
          records.push(data);
        }
      });
      const sorted = sortMhDeliveryPoints(records);
      if (sorted.length > 0 || !snapshot.metadata.fromCache) {
        saveCachedMhDeliveryPoints(sorted);
      }
      onData(sorted);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_DELIVERY_POINTS_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhDeliveryPointToCloud(
  record: Partial<MhDeliveryPointRecord> & { deliveryPoint: string }
): Promise<boolean> {
  const payload = sanitizeMhDeliveryPointPayload(record);
  const cached = loadCachedMhDeliveryPoints();
  const nextCache = [payload, ...cached.filter((item) => item.id !== payload.id)];
  saveCachedMhDeliveryPoints(nextCache);

  const docRef = doc(dbForklift, MH_DELIVERY_POINTS_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_DELIVERY_POINTS_COLLECTION}/${payload.id}`
  );
}

export async function saveMhDeliveryPointsBatchToCloud(
  records: Array<Partial<MhDeliveryPointRecord> & { deliveryPoint: string }>
): Promise<boolean> {
  if (records.length === 0) return true;
  const payloads = records.map(sanitizeMhDeliveryPointPayload);
  const payloadIds = new Set(payloads.map((p) => p.id));
  const cached = loadCachedMhDeliveryPoints();
  const nextCache = [...payloads, ...cached.filter((item) => !payloadIds.has(item.id))];
  saveCachedMhDeliveryPoints(nextCache);

  if (payloads.length === 1) {
    const docRef = doc(dbForklift, MH_DELIVERY_POINTS_COLLECTION, payloads[0].id);
    return runForkliftFirestoreWriteWithGuard(
      () => setDoc(docRef, payloads[0], { merge: true }),
      OperationType.WRITE,
      `${MH_DELIVERY_POINTS_COLLECTION}/${payloads[0].id}`
    );
  }

  return runForkliftFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbForklift);
      payloads.forEach((payload) => {
        const docRef = doc(dbForklift, MH_DELIVERY_POINTS_COLLECTION, payload.id);
        batch.set(docRef, payload, { merge: true });
      });
      await batch.commit();
    },
    OperationType.WRITE,
    MH_DELIVERY_POINTS_COLLECTION
  );
}

export async function deleteMhDeliveryPointFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const cached = loadCachedMhDeliveryPoints();
  saveCachedMhDeliveryPoints(cached.filter((item) => item.id !== cleanId));

  const docRef = doc(dbForklift, MH_DELIVERY_POINTS_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_DELIVERY_POINTS_COLLECTION}/${cleanId}`
  );
}
