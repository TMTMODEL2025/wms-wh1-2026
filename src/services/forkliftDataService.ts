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
import { resolveVehicleType } from "../utils/vehicleHelpers";

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
export const MH_PM_SCHEDULES_COLLECTION = "mh_pm_schedules";
export const MH_PM_MATRIX_COLLECTION = "mh_pm_matrix";
export const MH_PRESTART_INSPECTIONS_COLLECTION = "mh_prestart_inspections";

// ============================================================================
// 1. Transport Operation (mh_transfers) Types
// ============================================================================
export type MhTransferStatus = "Pending" | "In Transit" | "Completed" | "Cancelled";
export type MhPriorityLevel = "Normal" | "Urgent" | "Express";
export type MhTransferScope = "FG" | "RM";
export type MhRmProductType = "slit" | "coil";

export interface MhTransferRecord {
  id: string;
  transferCode: string;
  transferScope?: MhTransferScope; // FG (สินค้าผลิตเสร็จ) | RM (เหล็กม้วนสลิต / เหล็กม้วนคอล์ย)
  rmProductType?: MhRmProductType; // slit | coil
  sourceOrderNo?: string; // เลขที่ใบสั่งเบิกต้นทาง (งาน RM)
  sourceOrderDocId?: string; // Firestore Doc ID ของใบสั่งเบิกต้นทาง
  sourceMachineId?: string; // เครื่องจักรปลายทาง เช่น TM01, CF01, SM01, CL01
  sourceCollection?: "slit_picklists" | "coil_staging";
  sourceRoundNo?: number; // รอบการสแกนส่งของใบสั่งเบิกนั้น (1, 2, ...)
  sourceBatches?: string[]; // รายชื่อ Batch ในรอบนี้ (เก็บภายในเพื่อสะสมน้ำหนัก & ซิงค์สถานะกลับ)
  sourceOrigins?: string[]; // รวม Location ต้นทางจาก Stock คงคลังของรอบนี้
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

export const RM_MACHINE_FAC_MAP: Record<string, string> = {
  TM01: "FAC G",
  TM02: "FAC G",
  TM03: "FAC G",
  TM04: "FAC G",
  TM05: "FAC P",
  TM06: "FAC G",
  TM07: "FAC G",
  TM08: "FAC D",
  TM09: "FAC D",
  TM10: "FAC D",
  TM11: "FAC F",
  TM12: "FAC F",
  TM13: "FAC F",
  TM14: "FAC A",
  CF01: "FAC G",
  CF02: "FAC G",
  CF03: "FAC G",
  CF04: "FAC G",
  CF05: "FAC G",
  ML01: "FAC 21",
  ML02: "FAC 21",
  ZF01: "FAC 21",
  ZF02: "FAC 21",
  CL01: "FAC Cut-to-Length",
  CL02: "FAC Cut-to-Length",
  CL03: "FAC Cut-to-Length",
  CL04: "FAC Cut-to-Length",
  CL05: "FAC Cut-to-Length",
  CL06: "FAC Cut-to-Length",
  SM01: "FAC Slitting",
  SM02: "FAC Slitting",
  SM03: "FAC Slitting",
  SM04: "FAC Slitting",
};

export function resolveMachineFacDestination(
  machineId?: string,
  rmProductType?: MhRmProductType
): string {
  const cleanMachine = String(machineId || "").trim().toUpperCase();
  if (!cleanMachine) {
    return rmProductType === "coil" ? "หน้าเครื่องคอล์ย" : "หน้าเครื่องสลิต";
  }
  const fac = RM_MACHINE_FAC_MAP[cleanMachine];
  if (fac) {
    return `${fac} (${cleanMachine})`;
  }
  if (cleanMachine.startsWith("CL")) {
    return `FAC Cut-to-Length (${cleanMachine})`;
  }
  if (cleanMachine.startsWith("SM")) {
    return `FAC Slitting (${cleanMachine})`;
  }
  return cleanMachine;
}

export function isRmTransferRecord(record?: Partial<MhTransferRecord> | null): boolean {
  if (!record) return false;
  return record.transferScope === "RM" || Boolean(record.rmProductType);
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

export const MH_END_TIMES_BY_SHIFT: Record<string, readonly string[]> = {
  กะเช้า: ["17:00", "18:30", "19:30", "20:30"],
  กะดึก: ["05:00", "08:30"],
};

export const MH_END_TIME_PRESETS = [
  { time: "17:00", shift: "กะเช้า", label: "17:00 น. (กะเช้า)" },
  { time: "18:30", shift: "กะเช้า", label: "18:30 น. (กะเช้า)" },
  { time: "19:30", shift: "กะเช้า", label: "19:30 น. (กะเช้า)" },
  { time: "20:30", shift: "กะเช้า", label: "20:30 น. (กะเช้า)" },
  { time: "05:00", shift: "กะดึก", label: "05:00 น. (กะดึก)" },
  { time: "08:30", shift: "กะดึก", label: "08:30 น. (กะดึก)" },
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
  endTime?: string; // เวลาเลิกงาน กะเช้า: 17:00, 18:30, 19:30, 20:30 | กะดึก: 05:00, 08:30
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
  | "InRepair"
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
  pricePerLiter?: number;
  totalCost?: number;
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

export const MH_TIRE_COMPONENT_TYPES = ["ยางนอก", "ยางใน", "ยางรอง"] as const;
export type MhTireComponentType = (typeof MH_TIRE_COMPONENT_TYPES)[number];

export interface MhTireQtyByType {
  outer: number; // ยางนอก
  inner: number; // ยางใน
  flap: number; // ยางรอง
}

export interface MhTireUnitCostByType {
  outer: number; // ราคาต่อเส้น ยางนอก (บาท)
  inner: number; // ราคาต่อเส้น ยางใน (บาท)
  flap: number; // ราคาต่อเส้น ยางรอง (บาท)
}

export interface MhTireStockRecord {
  id: string;
  transactionNo: string;
  date: string;
  time: string;
  transactionType: MhTireTransactionType;
  tireSize: MhTireSize | string;
  brand: string;
  tireTypes?: MhTireComponentType[]; // ประเภทยางที่รับเข้า/เบิกออก: ยางนอก, ยางใน, ยางรอง
  qtyByType?: MhTireQtyByType; // จำนวน (เส้น) แยกตามประเภทยาง
  unitCostByType?: MhTireUnitCostByType; // ราคาต่อเส้น (บาท) แยกตามประเภทยาง
  qty: number;
  unitCost: number;
  totalCost: number;
  supplierOrInvoice?: string;
  compatibleVehicles?: string[]; // รายการรถและหางลากที่ใช้ยางขนาดนี้ (เช่น FL-01, TT-01, TTL-01)
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
// 5. Preventive Maintenance Schedule (mh_pm_schedules) Types & Constants
// ============================================================================
export const MH_PM_CATEGORIES = [
  "PM 1 (ตรวจเช็คตามระยะพื้นฐาน)",
  "PM 2 (เปลี่ยนถ่ายน้ำมันเครื่อง/กรอง)",
  "PM ไฮดรอลิค / ระบบส่งกำลัง",
  "PM แบตเตอรี่ / ระบบไฟฟ้า",
  "PM ระบบเบรค / ช่วงล่าง",
  "PM ใหญ่ประจำปี (Major Overhaul)",
] as const;

export type MhPmCategory = (typeof MH_PM_CATEGORIES)[number] | string;

export type MhPm3dModelType = "diesel_tractor" | "ev_tractor" | "forklift" | "trailer";

export interface MhPm3dZoneSnapshot {
  zoneId: string;
  zoneLabel: string;
  status: "pending" | "ok" | "issue" | "replaced";
  cost?: number;
  notes?: string;
  photoCount?: number;
  itemsSummary?: string;
  linkedRepairNo?: string;
}

export interface MhPm3dSummary {
  totalZones: number;
  checkedZones: number;
  okCount: number;
  issueCount: number;
  replacedCount: number;
  zoneSnapshots: MhPm3dZoneSnapshot[];
}

export interface MhPmHistoryEntry {
  id: string;
  pmNo?: string;
  completedDate: string; // YYYY-MM-DD
  previousDueDate?: string; // YYYY-MM-DD
  nextDueDate?: string; // YYYY-MM-DD
  performedBy: string;
  operatingHours?: number;
  mileageKm?: number;
  cost?: number;
  notes?: string;
  recordedAt: string;
  pm3dModelType?: MhPm3dModelType;
  pm3dCoupledTrailer?: boolean;
  pm3dSummary?: MhPm3dSummary;
  linkedRepairNos?: string[];
}

export interface MhPmScheduleRecord {
  id: string;
  pmNo?: string;
  vehicleId: string;
  vehicleNumber?: string;
  vehicleType: string;
  vehicleDescription?: string;
  pmTitle: string;
  pmCategory: MhPmCategory;
  cycleDays?: number;
  cycleHours?: number;
  currentHours?: number;
  cycleMileageKm?: number;
  startMileageKm?: number;
  targetMileageKm?: number;
  currentMileageKm?: number;
  mileageDueDate?: string; // YYYY-MM-DD when mileage reached target
  lastPmDate: string; // YYYY-MM-DD
  nextPmDate?: string; // YYYY-MM-DD (optional when using mileage-only PM)
  warningDaysBefore: number;
  responsibleTech: string;
  checklistSummary?: string;
  estimatedCost?: number;
  scheduleStatus: "Active" | "Paused";
  notes?: string;
  history?: MhPmHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type MhPmMatrixCategory = "forklift" | "ev_tractor" | "diesel_tractor";

export interface MhPmMatrixRecord {
  id: string;
  vehicleCategory: MhPmMatrixCategory;
  targetKey: string; // "TEMPLATE" or specific vehicleId e.g. "FL-01"
  vehicleId?: string;
  checks: Record<string, string[]>; // itemId -> checked column keys (e.g. ["D", "250H"])
  status: "draft" | "submitted";
  notes?: string;
  updatedBy?: string;
  updatedAt: string;
  submittedAt?: string;
  submittedBy?: string;
}

// ============================================================================
// 6. Pre-Start Daily Inspection (mh_prestart_inspections) Types
// ============================================================================
export interface MhPreStartChecklistItem {
  id: string;
  categoryThai: string;
  categoryEnglish: string;
  status: "Pass" | "Fail" | "NA";
  remark?: string;
  isCustom?: boolean;
}

export interface MhPreStartInspectionRecord {
  id: string;
  vehicleId: string;
  vehicleDescription: string;
  operatorName: string;
  shift: string;
  operatingHours: number;
  mileageKm: number;
  items: MhPreStartChecklistItem[];
  overallResult: "Passed (พร้อมใช้งาน)" | "Grounded / Needs Repair (งดใช้ชั่วคราว)";
  inspectorSignature: string;
  inspectionDate: string; // YYYY-MM-DD
  createdAt: string;
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

  const cleanSourceBatches = Array.isArray(r.sourceBatches)
    ? Array.from(
        new Set(
          r.sourceBatches
            .map((b) => String(b || "").trim().toUpperCase().slice(0, 32))
            .filter(Boolean)
        )
      ).slice(0, 200)
    : undefined;

  const cleanSourceOrigins = Array.isArray(r.sourceOrigins)
    ? Array.from(
        new Set(
          r.sourceOrigins
            .map((loc) => String(loc || "").trim().slice(0, 64))
            .filter(Boolean)
        )
      ).slice(0, 40)
    : undefined;

  return stripUndefinedDeep({
    id: docId,
    transferCode: String(r.transferCode || docId).trim().slice(0, 64),
    transferScope:
      r.transferScope === "RM" || r.rmProductType === "slit" || r.rmProductType === "coil"
        ? "RM"
        : r.transferScope === "FG"
        ? "FG"
        : undefined,
    rmProductType:
      r.rmProductType === "slit" || r.rmProductType === "coil" ? r.rmProductType : undefined,
    sourceOrderNo: r.sourceOrderNo ? String(r.sourceOrderNo).trim().slice(0, 64) : undefined,
    sourceOrderDocId: r.sourceOrderDocId
      ? String(r.sourceOrderDocId).trim().slice(0, 128)
      : undefined,
    sourceMachineId: r.sourceMachineId
      ? String(r.sourceMachineId).trim().toUpperCase().slice(0, 32)
      : undefined,
    sourceCollection:
      r.sourceCollection === "slit_picklists" || r.sourceCollection === "coil_staging"
        ? r.sourceCollection
        : undefined,
    sourceRoundNo:
      typeof r.sourceRoundNo === "number" && !isNaN(r.sourceRoundNo)
        ? Math.max(1, Math.floor(r.sourceRoundNo))
        : undefined,
    sourceBatches: cleanSourceBatches,
    sourceOrigins: cleanSourceOrigins,
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
// 1A. Automated RM Pick List -> Material Handling Transfer Sync
// ============================================================================
export interface RmPickListDispatchItemInput {
  batch: string;
  weightKg: number;
  originLocation?: string;
}

export interface RmPickListDispatchInput {
  rmProductType: MhRmProductType;
  sourceCollection: "slit_picklists" | "coil_staging";
  sourceOrderNo: string;
  sourceOrderDocId?: string;
  machineId: string;
  recorderName?: string;
  items: RmPickListDispatchItemInput[];
}

function formatAggregatedOriginLocations(
  origins: string[],
  rmProductType: MhRmProductType
): string {
  const valid = Array.from(
    new Set(
      origins
        .map((loc) => String(loc || "").trim())
        .filter(
          (loc) =>
            loc.length > 0 &&
            loc !== "-" &&
            loc !== "ไม่ระบุ" &&
            !loc.includes("รอสแกน")
        )
    )
  );
  if (valid.length === 0) {
    return rmProductType === "coil" ? "คลังเหล็กม้วน RM" : "คลังเหล็กสลิต";
  }
  if (valid.length <= 3) {
    return valid.join(", ");
  }
  return `${valid.slice(0, 3).join(", ")} (+${valid.length - 3})`;
}

// Serialize concurrent RM upserts per order so rapid consecutive barcode scans never race
const rmUpsertQueueByOrder = new Map<string, Promise<MhTransferRecord | null>>();

export function upsertRmTransferFromPickListScan(
  input: RmPickListDispatchInput
): Promise<MhTransferRecord | null> {
  const cleanOrderNo = String(input.sourceOrderNo || "").trim().toUpperCase();
  const queueKey = `${input.sourceCollection}::${cleanOrderNo}`;
  const prevPromise = rmUpsertQueueByOrder.get(queueKey) || Promise.resolve(null);

  const nextPromise = prevPromise
    .catch(() => null)
    .then(() => runUpsertRmTransferFromPickListScan(input));

  rmUpsertQueueByOrder.set(queueKey, nextPromise);
  return nextPromise;
}

async function runUpsertRmTransferFromPickListScan(
  input: RmPickListDispatchInput
): Promise<MhTransferRecord | null> {
  const cleanOrderNo = String(input.sourceOrderNo || "").trim().toUpperCase();
  if (!cleanOrderNo) return null;

  const incomingUnique = new Map<string, RmPickListDispatchItemInput>();
  for (const itm of input.items || []) {
    const cleanBatch = String(itm.batch || "").trim().toUpperCase();
    if (!cleanBatch) continue;
    if (!incomingUnique.has(cleanBatch)) {
      incomingUnique.set(cleanBatch, {
        batch: cleanBatch,
        weightKg: Math.max(0, Number(itm.weightKg) || 0),
        originLocation: String(itm.originLocation || "").trim(),
      });
    }
  }
  if (incomingUnique.size === 0) return null;

  const existingTransfers = await fetchMhTransfersOnce();
  const matchingOrderTransfers = existingTransfers.filter(
    (tr) =>
      isRmTransferRecord(tr) &&
      tr.sourceCollection === input.sourceCollection &&
      String(tr.sourceOrderNo || "").trim().toUpperCase() === cleanOrderNo &&
      tr.status !== "Cancelled"
  );

  // Check if there is an active ("In Transit" / "Pending") round for this order
  const activeRound = matchingOrderTransfers.find(
    (tr) => tr.status === "In Transit" || tr.status === "Pending"
  );

  const now = new Date();
  const nowMs = now.getTime();
  const { timestamp, dateYmd, timeHms } = formatForkliftNowTimestamp();
  const destinationFacility = resolveMachineFacDestination(
    input.machineId,
    input.rmProductType
  );
  const itemName =
    input.rmProductType === "coil" ? "เหล็กม้วนคอล์ย" : "เหล็กม้วนสลิต";
  const transferType =
    input.rmProductType === "coil"
      ? "เหล็กม้วนคอล์ย (RM)"
      : "เหล็กม้วนสลิต (RM)";

  if (activeRound) {
    const existingBatches = new Set(
      (activeRound.sourceBatches || []).map((b) => String(b).trim().toUpperCase())
    );
    const newlyAddedItems: RmPickListDispatchItemInput[] = [];
    incomingUnique.forEach((itm, bKey) => {
      if (!existingBatches.has(bKey)) {
        newlyAddedItems.push(itm);
        existingBatches.add(bKey);
      }
    });

    if (newlyAddedItems.length === 0) {
      return activeRound;
    }

    const addedWeightKg = newlyAddedItems.reduce((sum, i) => sum + i.weightKg, 0);
    const prevWeightKg =
      typeof activeRound.totalWeightKg === "number" && !isNaN(activeRound.totalWeightKg)
        ? activeRound.totalWeightKg
        : Math.round((activeRound.weightTon || 0) * 1000);
    const nextTotalWeightKg = Math.round((prevWeightKg + addedWeightKg) * 100) / 100;
    const nextBatches = Array.from(existingBatches);
    const nextOrigins = Array.from(
      new Set([
        ...(activeRound.sourceOrigins || []),
        ...newlyAddedItems
          .map((i) => String(i.originLocation || "").trim())
          .filter(
            (loc) =>
              loc.length > 0 &&
              loc !== "-" &&
              loc !== "ไม่ระบุ" &&
              !loc.includes("รอสแกน")
          ),
      ])
    );

    const updatedRecord: MhTransferRecord = {
      ...activeRound,
      transferScope: "RM",
      rmProductType: input.rmProductType,
      sourceOrderNo: cleanOrderNo,
      sourceOrderDocId:
        activeRound.sourceOrderDocId || input.sourceOrderDocId || undefined,
      sourceMachineId: String(input.machineId || activeRound.sourceMachineId || "")
        .trim()
        .toUpperCase(),
      sourceCollection: input.sourceCollection,
      sourceBatches: nextBatches,
      sourceOrigins: nextOrigins,
      originFacility: formatAggregatedOriginLocations(
        nextOrigins,
        input.rmProductType
      ),
      destinationFacility,
      quantity: nextBatches.length,
      totalBundles: nextBatches.length,
      totalWeightKg: nextTotalWeightKg,
      weightTon: Number((nextTotalWeightKg / 1000).toFixed(3)),
      updatedAt: timestamp,
    };

    await saveMhTransferToCloud(updatedRecord);
    return updatedRecord;
  }

  // Otherwise start a fresh round (Round 1, or Round N+1 if earlier round already Completed)
  const maxRoundNo = matchingOrderTransfers.reduce(
    (max, tr) => Math.max(max, tr.sourceRoundNo || 1),
    0
  );
  const nextRoundNo = maxRoundNo + 1;
  const newItemsArr = Array.from(incomingUnique.values());
  const totalWeightKg =
    Math.round(newItemsArr.reduce((sum, i) => sum + i.weightKg, 0) * 100) / 100;
  const sourceBatches = newItemsArr.map((i) => i.batch);
  const sourceOrigins = Array.from(
    new Set(
      newItemsArr
        .map((i) => String(i.originLocation || "").trim())
        .filter(
          (loc) =>
            loc.length > 0 &&
            loc !== "-" &&
            loc !== "ไม่ระบุ" &&
            !loc.includes("รอสแกน")
        )
    )
  );
  const originFacility = formatAggregatedOriginLocations(
    sourceOrigins,
    input.rmProductType
  );
  const safeOrderSuffix = cleanOrderNo.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 48);
  const docId = sanitizeDocId(
    `RM_${input.rmProductType.toUpperCase()}_${safeOrderSuffix}_R${nextRoundNo}_${nowMs
      .toString(36)
      .slice(-4)
      .toUpperCase()}`
  );
  const transferCode = (
    nextRoundNo > 1 ? `RM-${cleanOrderNo}-R${nextRoundNo}` : `RM-${cleanOrderNo}`
  ).slice(0, 64);

  const newRecord: MhTransferRecord = {
    id: docId,
    transferCode,
    transferScope: "RM",
    rmProductType: input.rmProductType,
    sourceOrderNo: cleanOrderNo,
    sourceOrderDocId: input.sourceOrderDocId,
    sourceMachineId: String(input.machineId || "").trim().toUpperCase(),
    sourceCollection: input.sourceCollection,
    sourceRoundNo: nextRoundNo,
    sourceBatches,
    sourceOrigins,
    originFacility,
    destinationFacility,
    sku: String(input.machineId || "-").trim().toUpperCase(),
    itemName,
    productCategory: "ย้ายงาน RM",
    transferType,
    batchNumber: cleanOrderNo,
    palletId: `R${nextRoundNo}`,
    quantity: sourceBatches.length,
    totalBundles: sourceBatches.length,
    unit: "ม้วน",
    totalWeightKg,
    weightTon: Number((totalWeightKg / 1000).toFixed(3)),
    startTime: timeHms,
    startTimeMs: nowMs,
    recorderName: String(input.recorderName || "ระบบเตรียมเบิก").trim().slice(0, 128),
    workingDate: dateYmd,
    status: "In Transit",
    priority: "Normal",
    vehicleNumber: "-",
    driverName: "รอคนขับยืนยัน",
    notes: `เชื่อมอัตโนมัติจากหน้าเตรียมเบิก ${itemName} · ใบสั่ง ${cleanOrderNo}${
      nextRoundNo > 1 ? ` (รอบที่ ${nextRoundNo})` : ""
    }`,
    createdAt: `${dateYmd} ${timeHms.slice(0, 5)}`,
    updatedAt: timestamp,
  };

  await saveMhTransferToCloud(newRecord);
  return newRecord;
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
    r.workflowStage === "InRepair" ||
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
    vehicleType: String(
      resolveVehicleType({
        vehicleId: r.vehicleId,
        number: r.vehicleNumber,
        vehicleDescription: r.vehicleDescription,
        vehicleType: r.vehicleType || "Forklift",
      })
    ).slice(0, 64),
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
  const safePricePerLiter =
    typeof r.pricePerLiter === "number" && !isNaN(r.pricePerLiter) && r.pricePerLiter >= 0
      ? Number(r.pricePerLiter.toFixed(2))
      : undefined;
  const safeTotalCost =
    typeof r.totalCost === "number" && !isNaN(r.totalCost) && r.totalCost >= 0
      ? Number(r.totalCost.toFixed(2))
      : safePricePerLiter !== undefined
      ? Number((safeQty * safePricePerLiter).toFixed(2))
      : undefined;
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
    pricePerLiter: safePricePerLiter,
    totalCost: safeTotalCost,
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

  const safeCompatibleVehicles = Array.isArray(r.compatibleVehicles)
    ? Array.from(
        new Set(
          r.compatibleVehicles
            .map((v) => String(v || "").trim().slice(0, 64))
            .filter(Boolean)
        )
      ).slice(0, 100)
    : [];

  const validTireTypeSet = new Set<string>(MH_TIRE_COMPONENT_TYPES);
  const safeTireTypes = Array.isArray(r.tireTypes)
    ? MH_TIRE_COMPONENT_TYPES.filter((t) =>
        r.tireTypes!.some((item) => String(item || "").trim() === t && validTireTypeSet.has(t))
      )
    : [];

  let safeQtyByType: MhTireQtyByType | undefined;
  if (r.qtyByType && typeof r.qtyByType === "object") {
    const outer =
      typeof r.qtyByType.outer === "number" && !isNaN(r.qtyByType.outer)
        ? Math.max(0, Math.floor(r.qtyByType.outer))
        : 0;
    const inner =
      typeof r.qtyByType.inner === "number" && !isNaN(r.qtyByType.inner)
        ? Math.max(0, Math.floor(r.qtyByType.inner))
        : 0;
    const flap =
      typeof r.qtyByType.flap === "number" && !isNaN(r.qtyByType.flap)
        ? Math.max(0, Math.floor(r.qtyByType.flap))
        : 0;
    if (outer + inner + flap > 0) {
      safeQtyByType = { outer, inner, flap };
    }
  }

  let safeUnitCostByType: MhTireUnitCostByType | undefined;
  if (r.unitCostByType && typeof r.unitCostByType === "object") {
    const outer =
      typeof r.unitCostByType.outer === "number" && !isNaN(r.unitCostByType.outer)
        ? Math.max(0, r.unitCostByType.outer)
        : 0;
    const inner =
      typeof r.unitCostByType.inner === "number" && !isNaN(r.unitCostByType.inner)
        ? Math.max(0, r.unitCostByType.inner)
        : 0;
    const flap =
      typeof r.unitCostByType.flap === "number" && !isNaN(r.unitCostByType.flap)
        ? Math.max(0, r.unitCostByType.flap)
        : 0;
    if (safeQtyByType || outer + inner + flap > 0) {
      safeUnitCostByType = { outer, inner, flap };
    }
  }

  const computedTotalCost =
    typeof r.totalCost === "number" && !isNaN(r.totalCost) && r.totalCost >= 0
      ? r.totalCost
      : safeQtyByType && safeUnitCostByType
        ? safeQtyByType.outer * safeUnitCostByType.outer +
          safeQtyByType.inner * safeUnitCostByType.inner +
          safeQtyByType.flap * safeUnitCostByType.flap
        : safeTotalCost;

  return stripUndefinedDeep({
    id: docId,
    transactionNo: String(r.transactionNo || docId).trim().slice(0, 64),
    date: String(r.date || dateYmd).trim().slice(0, 32),
    time: String(r.time || timeHm).trim().slice(0, 32),
    transactionType: r.transactionType === "Outbound" ? "Outbound" : "Inbound",
    tireSize: String(r.tireSize || "-").trim().slice(0, 128),
    brand: String(r.brand || "-").trim().slice(0, 64),
    tireTypes: safeTireTypes.length > 0 ? safeTireTypes : undefined,
    qtyByType: safeQtyByType,
    unitCostByType: safeUnitCostByType,
    qty: safeQty,
    unitCost: safeUnitCost,
    totalCost: computedTotalCost,
    supplierOrInvoice: r.supplierOrInvoice
      ? String(r.supplierOrInvoice).trim().slice(0, 128)
      : undefined,
    compatibleVehicles:
      safeCompatibleVehicles.length > 0 ? safeCompatibleVehicles : undefined,
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
    endTime: r.endTime ? String(r.endTime).trim().slice(0, 32) : undefined,
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

// ============================================================================
// 7. Preventive Maintenance Schedule (mh_pm_schedules) Cloud & Local Cache
// ============================================================================
const MH_PM_SCHEDULES_CACHE_KEY = "tmt_mh_pm_schedules_cache_v1";

export function generateNextPmNo(
  existingRecords: MhPmScheduleRecord[],
  targetDate: Date = new Date(),
  reservedNos?: Iterable<string>
): string {
  const safeDate = isNaN(targetDate.getTime()) ? new Date() : targetDate;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const prefix = `PM-${year}-${month}-`;

  const existingSet = new Set<string>();
  let maxSeq = 0;

  const inspectCode = (raw?: string) => {
    const code = String(raw || "").trim().toUpperCase();
    if (!code) return;
    existingSet.add(code);
    if (code.startsWith(prefix)) {
      const tail = code.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (!isNaN(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  };

  for (const rec of existingRecords) {
    inspectCode(rec.pmNo);
    if (Array.isArray(rec.history)) {
      for (const h of rec.history) {
        inspectCode(h.pmNo);
      }
    }
  }

  if (reservedNos) {
    for (const rNo of reservedNos) {
      inspectCode(rNo);
    }
  }

  let nextSeq = maxSeq + 1;
  let candidate = `${prefix}${String(nextSeq).padStart(3, "0")}`;
  while (existingSet.has(candidate)) {
    nextSeq += 1;
    candidate = `${prefix}${String(nextSeq).padStart(3, "0")}`;
  }
  return candidate;
}

export function computeNextPmDate(baseDateYmd: string, cycleDays: number): string {
  const safeDays = Math.max(1, Math.min(3650, Math.round(Number(cycleDays) || 30)));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(baseDateYmd || "").trim());
  const d = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();
  d.setDate(d.getDate() + safeDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sanitizeMhPmSchedulePayload(
  r: Partial<MhPmScheduleRecord> & { vehicleId: string }
): MhPmScheduleRecord {
  const { timestamp, dateYmd } = formatForkliftNowTimestamp();
  const cleanVehicleId = String(r.vehicleId || "").trim().slice(0, 64);
  const cleanVehicleNumber = String(r.vehicleNumber || cleanVehicleId).trim().slice(0, 64);
  const cycleDays =
    typeof r.cycleDays === "number" && !isNaN(r.cycleDays) && r.cycleDays > 0
      ? Math.max(1, Math.min(3650, Math.round(r.cycleDays)))
      : undefined;
  const lastPmDate = String(r.lastPmDate || dateYmd).trim().slice(0, 32);
  const rawNextPmDate = r.nextPmDate !== undefined ? String(r.nextPmDate).trim() : "";
  const nextPmDate = rawNextPmDate
    ? rawNextPmDate.slice(0, 32)
    : cycleDays
    ? computeNextPmDate(lastPmDate, cycleDays)
    : "";
  const docId = sanitizeDocId(r.id || `PM_${cleanVehicleId}_${Date.now()}`);

  const cycleMileageKm =
    typeof r.cycleMileageKm === "number" && !isNaN(r.cycleMileageKm) && r.cycleMileageKm > 0
      ? Math.round(r.cycleMileageKm)
      : undefined;
  const startMileageKm =
    typeof r.startMileageKm === "number" && !isNaN(r.startMileageKm) && r.startMileageKm >= 0
      ? Math.round(r.startMileageKm)
      : undefined;
  const targetMileageKm =
    typeof r.targetMileageKm === "number" && !isNaN(r.targetMileageKm) && r.targetMileageKm > 0
      ? Math.round(r.targetMileageKm)
      : cycleMileageKm !== undefined
      ? (startMileageKm ?? 0) + cycleMileageKm
      : undefined;
  const currentMileageKm =
    typeof r.currentMileageKm === "number" && !isNaN(r.currentMileageKm) && r.currentMileageKm >= 0
      ? Math.round(r.currentMileageKm)
      : undefined;
  const mileageDueDate =
    r.mileageDueDate && String(r.mileageDueDate).trim()
      ? String(r.mileageDueDate).trim().slice(0, 32)
      : undefined;

  const cleanPmNo =
    r.pmNo && String(r.pmNo).trim()
      ? String(r.pmNo).trim().toUpperCase().slice(0, 64)
      : undefined;

  const safeHistory: MhPmHistoryEntry[] = Array.isArray(r.history)
    ? r.history.slice(0, 40).map((h, idx) => {
        const safeZoneSnapshots: MhPm3dZoneSnapshot[] | undefined = Array.isArray(
          h.pm3dSummary?.zoneSnapshots
        )
          ? h.pm3dSummary.zoneSnapshots.slice(0, 20).map((zs) =>
              stripUndefinedDeep({
                zoneId: String(zs.zoneId || "").slice(0, 64),
                zoneLabel: String(zs.zoneLabel || "").slice(0, 128),
                status:
                  zs.status === "ok" ||
                  zs.status === "issue" ||
                  zs.status === "replaced" ||
                  zs.status === "pending"
                    ? zs.status
                    : "pending",
                cost:
                  typeof zs.cost === "number" && !isNaN(zs.cost) && zs.cost >= 0
                    ? zs.cost
                    : undefined,
                notes: zs.notes ? String(zs.notes).trim().slice(0, 300) : undefined,
                photoCount:
                  typeof zs.photoCount === "number" && !isNaN(zs.photoCount) && zs.photoCount > 0
                    ? Math.min(20, Math.round(zs.photoCount))
                    : undefined,
                itemsSummary: zs.itemsSummary
                  ? String(zs.itemsSummary).trim().slice(0, 240)
                  : undefined,
                linkedRepairNo: zs.linkedRepairNo
                  ? String(zs.linkedRepairNo).trim().slice(0, 64)
                  : undefined,
              })
            )
          : undefined;

        const safePm3dSummary: MhPm3dSummary | undefined = h.pm3dSummary
          ? {
              totalZones: Math.max(0, Math.round(Number(h.pm3dSummary.totalZones) || 0)),
              checkedZones: Math.max(0, Math.round(Number(h.pm3dSummary.checkedZones) || 0)),
              okCount: Math.max(0, Math.round(Number(h.pm3dSummary.okCount) || 0)),
              issueCount: Math.max(0, Math.round(Number(h.pm3dSummary.issueCount) || 0)),
              replacedCount: Math.max(0, Math.round(Number(h.pm3dSummary.replacedCount) || 0)),
              zoneSnapshots: safeZoneSnapshots || [],
            }
          : undefined;

        const safeLinkedRepairNos = Array.isArray(h.linkedRepairNos)
          ? h.linkedRepairNos
              .map((rn) => String(rn || "").trim().slice(0, 64))
              .filter(Boolean)
              .slice(0, 10)
          : undefined;

        const safeModelType: MhPm3dModelType | undefined =
          h.pm3dModelType === "diesel_tractor" ||
          h.pm3dModelType === "ev_tractor" ||
          h.pm3dModelType === "forklift" ||
          h.pm3dModelType === "trailer"
            ? h.pm3dModelType
            : undefined;

        return stripUndefinedDeep({
          id: String(h.id || `PMH-${idx + 1}`).slice(0, 64),
          pmNo: h.pmNo ? String(h.pmNo).trim().toUpperCase().slice(0, 64) : undefined,
          completedDate: String(h.completedDate || dateYmd).trim().slice(0, 32),
          previousDueDate: h.previousDueDate ? String(h.previousDueDate).trim().slice(0, 32) : undefined,
          nextDueDate: h.nextDueDate ? String(h.nextDueDate).trim().slice(0, 32) : undefined,
          performedBy: String(h.performedBy || "-").trim().slice(0, 128),
          operatingHours:
            typeof h.operatingHours === "number" && !isNaN(h.operatingHours)
              ? Math.max(0, h.operatingHours)
              : undefined,
          mileageKm:
            typeof h.mileageKm === "number" && !isNaN(h.mileageKm)
              ? Math.max(0, h.mileageKm)
              : undefined,
          cost:
            typeof h.cost === "number" && !isNaN(h.cost) ? Math.max(0, h.cost) : undefined,
          notes: h.notes ? String(h.notes).trim().slice(0, 500) : undefined,
          recordedAt: String(h.recordedAt || timestamp).slice(0, 64),
          pm3dModelType: safeModelType,
          pm3dCoupledTrailer:
            typeof h.pm3dCoupledTrailer === "boolean" ? h.pm3dCoupledTrailer : undefined,
          pm3dSummary: safePm3dSummary,
          linkedRepairNos:
            safeLinkedRepairNos && safeLinkedRepairNos.length > 0
              ? safeLinkedRepairNos
              : undefined,
        });
      })
    : [];

  return stripUndefinedDeep({
    id: docId,
    pmNo: cleanPmNo,
    vehicleId: cleanVehicleId,
    vehicleNumber: cleanVehicleNumber,
    vehicleType: String(
      resolveVehicleType({
        vehicleId: cleanVehicleId,
        number: cleanVehicleNumber,
        vehicleDescription: r.vehicleDescription,
        vehicleType: r.vehicleType || "Forklift",
      })
    ).slice(0, 64),
    vehicleDescription: r.vehicleDescription
      ? String(r.vehicleDescription).trim().slice(0, 256)
      : undefined,
    pmTitle: String(r.pmTitle || r.pmCategory || "PM เชิงป้องกันตามรอบ").trim().slice(0, 128),
    pmCategory: String(r.pmCategory || MH_PM_CATEGORIES[0]).trim().slice(0, 128),
    cycleDays,
    cycleHours:
      typeof r.cycleHours === "number" && !isNaN(r.cycleHours) && r.cycleHours > 0
        ? Math.round(r.cycleHours)
        : undefined,
    currentHours:
      typeof r.currentHours === "number" && !isNaN(r.currentHours) && r.currentHours >= 0
        ? Math.round(r.currentHours)
        : undefined,
    cycleMileageKm,
    startMileageKm,
    targetMileageKm,
    currentMileageKm,
    mileageDueDate,
    lastPmDate,
    nextPmDate: nextPmDate || undefined,
    warningDaysBefore:
      typeof r.warningDaysBefore === "number" && !isNaN(r.warningDaysBefore)
        ? Math.max(1, Math.min(90, Math.round(r.warningDaysBefore)))
        : 7,
    responsibleTech: String(r.responsibleTech || "ทีมช่างซ่อมบำรุง").trim().slice(0, 128),
    checklistSummary: r.checklistSummary
      ? String(r.checklistSummary).trim().slice(0, 500)
      : undefined,
    estimatedCost:
      typeof r.estimatedCost === "number" && !isNaN(r.estimatedCost) && r.estimatedCost >= 0
        ? r.estimatedCost
        : undefined,
    scheduleStatus: r.scheduleStatus === "Paused" ? "Paused" : "Active",
    notes: r.notes ? String(r.notes).trim().slice(0, 500) : undefined,
    history: safeHistory,
    createdAt: String(r.createdAt || timestamp).slice(0, 64),
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhPmSchedules(items: MhPmScheduleRecord[]): MhPmScheduleRecord[] {
  return [...items].sort((a, b) => {
    if (a.scheduleStatus !== b.scheduleStatus) {
      return a.scheduleStatus === "Active" ? -1 : 1;
    }
    const dateA = a.mileageDueDate || a.nextPmDate || "9999-99-99";
    const dateB = b.mileageDueDate || b.nextPmDate || "9999-99-99";
    const dateCmp = dateA.localeCompare(dateB);
    if (dateCmp !== 0) return dateCmp;
    return (a.vehicleId || "").localeCompare(b.vehicleId || "", "th", { numeric: true });
  });
}

export function loadCachedMhPmSchedules(): MhPmScheduleRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MH_PM_SCHEDULES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortMhPmSchedules(parsed) : [];
  } catch {
    return [];
  }
}

export function saveCachedMhPmSchedules(records: MhPmScheduleRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      MH_PM_SCHEDULES_CACHE_KEY,
      JSON.stringify(sortMhPmSchedules(records))
    );
  } catch {
    // ignore storage quota error
  }
}

export async function fetchMhPmSchedulesOnce(): Promise<MhPmScheduleRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_PM_SCHEDULES_COLLECTION));
    const records: MhPmScheduleRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhPmScheduleRecord;
      if (data && data.id && data.vehicleId) {
        records.push({
          ...data,
          history: Array.isArray(data.history) ? data.history : [],
        });
      }
    });
    const sorted = sortMhPmSchedules(records);
    if (sorted.length > 0) {
      saveCachedMhPmSchedules(sorted);
      return sorted;
    }
    return loadCachedMhPmSchedules();
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_PM_SCHEDULES_COLLECTION);
    return loadCachedMhPmSchedules();
  }
}

export function subscribeToMhPmSchedules(
  onData: (records: MhPmScheduleRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_pm_schedules_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhPmSchedulesOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_PM_SCHEDULES_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhPmScheduleRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhPmScheduleRecord;
        if (data && data.id && data.vehicleId) {
          records.push({
            ...data,
            history: Array.isArray(data.history) ? data.history : [],
          });
        }
      });
      const sorted = sortMhPmSchedules(records);
      if (sorted.length > 0 || !snapshot.metadata.fromCache) {
        saveCachedMhPmSchedules(sorted);
      }
      onData(sorted);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_PM_SCHEDULES_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhPmScheduleToCloud(
  record: Partial<MhPmScheduleRecord> & { vehicleId: string }
): Promise<boolean> {
  const payload = sanitizeMhPmSchedulePayload(record);
  const cached = loadCachedMhPmSchedules();
  const nextCache = [payload, ...cached.filter((item) => item.id !== payload.id)];
  saveCachedMhPmSchedules(nextCache);

  const docRef = doc(dbForklift, MH_PM_SCHEDULES_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_PM_SCHEDULES_COLLECTION}/${payload.id}`
  );
}

export async function saveMhPmSchedulesBatchToCloud(
  records: Array<Partial<MhPmScheduleRecord> & { vehicleId: string }>
): Promise<boolean> {
  if (records.length === 0) return true;
  const payloads = records.map(sanitizeMhPmSchedulePayload);
  const payloadIds = new Set(payloads.map((p) => p.id));
  const cached = loadCachedMhPmSchedules();
  const nextCache = [...payloads, ...cached.filter((item) => !payloadIds.has(item.id))];
  saveCachedMhPmSchedules(nextCache);

  if (payloads.length === 1) {
    const docRef = doc(dbForklift, MH_PM_SCHEDULES_COLLECTION, payloads[0].id);
    return runForkliftFirestoreWriteWithGuard(
      () => setDoc(docRef, payloads[0], { merge: true }),
      OperationType.WRITE,
      `${MH_PM_SCHEDULES_COLLECTION}/${payloads[0].id}`
    );
  }

  return runForkliftFirestoreWriteWithGuard(
    async () => {
      const batch = writeBatch(dbForklift);
      payloads.forEach((payload) => {
        const docRef = doc(dbForklift, MH_PM_SCHEDULES_COLLECTION, payload.id);
        batch.set(docRef, payload, { merge: true });
      });
      await batch.commit();
    },
    OperationType.WRITE,
    MH_PM_SCHEDULES_COLLECTION
  );
}

export async function deleteMhPmScheduleFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const cached = loadCachedMhPmSchedules();
  saveCachedMhPmSchedules(cached.filter((item) => item.id !== cleanId));

  const docRef = doc(dbForklift, MH_PM_SCHEDULES_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_PM_SCHEDULES_COLLECTION}/${cleanId}`
  );
}

// ============================================================================
// 8. Pre-Start Daily Inspection (mh_prestart_inspections) Cloud & Local Cache
// ============================================================================
const MH_PRESTART_INSPECTIONS_CACHE_KEY = "tmt_mh_prestart_inspections_cache_v1";

function sanitizeMhPreStartInspectionPayload(
  r: Partial<MhPreStartInspectionRecord> & { vehicleId: string }
): MhPreStartInspectionRecord {
  const { timestamp, dateYmd } = formatForkliftNowTimestamp();
  const docId = sanitizeDocId(r.id || `INS-${Date.now()}`);
  const cleanVehicleId = String(r.vehicleId || "").trim().slice(0, 64);
  const safeHours =
    typeof r.operatingHours === "number" && !isNaN(r.operatingHours)
      ? Math.max(0, Math.round(r.operatingHours))
      : 0;
  const safeMileage =
    typeof r.mileageKm === "number" && !isNaN(r.mileageKm)
      ? Math.max(0, Math.round(r.mileageKm))
      : safeHours;

  const safeItems: MhPreStartChecklistItem[] = Array.isArray(r.items)
    ? r.items.slice(0, 60).map((it, idx) =>
        stripUndefinedDeep({
          id: String(it.id || `item-${idx}`).slice(0, 64),
          categoryThai: String(it.categoryThai || "-").trim().slice(0, 200),
          categoryEnglish: String(it.categoryEnglish || "").trim().slice(0, 200),
          status: it.status === "Fail" || it.status === "NA" ? it.status : "Pass",
          remark: it.remark ? String(it.remark).trim().slice(0, 300) : undefined,
          isCustom: typeof it.isCustom === "boolean" ? it.isCustom : undefined,
        })
      )
    : [];

  return stripUndefinedDeep({
    id: docId,
    vehicleId: cleanVehicleId,
    vehicleDescription: String(r.vehicleDescription || cleanVehicleId).trim().slice(0, 256),
    operatorName: String(r.operatorName || "WMS Operator").trim().slice(0, 128),
    shift: String(r.shift || "Shift 1 (08:00 - 16:00)").trim().slice(0, 64),
    operatingHours: safeHours,
    mileageKm: safeMileage,
    items: safeItems,
    overallResult:
      r.overallResult && r.overallResult.includes("Grounded")
        ? "Grounded / Needs Repair (งดใช้ชั่วคราว)"
        : "Passed (พร้อมใช้งาน)",
    inspectorSignature: String(r.inspectorSignature || r.operatorName || "WMS Operator")
      .trim()
      .slice(0, 128),
    inspectionDate: String(r.inspectionDate || dateYmd).trim().slice(0, 32),
    createdAt: String(r.createdAt || timestamp.slice(0, 16)).slice(0, 64),
    updatedAt: String(r.updatedAt || timestamp).slice(0, 64),
  });
}

function sortMhPreStartInspections(
  items: MhPreStartInspectionRecord[]
): MhPreStartInspectionRecord[] {
  return [...items].sort((a, b) => {
    const dtA = a.inspectionDate || a.createdAt || "";
    const dtB = b.inspectionDate || b.createdAt || "";
    if (dtA !== dtB) return dtB.localeCompare(dtA);
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

export function loadCachedMhPreStartInspections(): MhPreStartInspectionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MH_PRESTART_INSPECTIONS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortMhPreStartInspections(parsed) : [];
  } catch {
    return [];
  }
}

export function saveCachedMhPreStartInspections(
  records: MhPreStartInspectionRecord[]
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      MH_PRESTART_INSPECTIONS_CACHE_KEY,
      JSON.stringify(sortMhPreStartInspections(records))
    );
  } catch {
    // ignore storage quota error
  }
}

export async function fetchMhPreStartInspectionsOnce(): Promise<MhPreStartInspectionRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_PRESTART_INSPECTIONS_COLLECTION));
    const records: MhPreStartInspectionRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhPreStartInspectionRecord;
      if (data && data.id && data.vehicleId) {
        records.push({
          ...data,
          mileageKm:
            typeof data.mileageKm === "number" && !isNaN(data.mileageKm)
              ? data.mileageKm
              : Number(data.operatingHours) || 0,
          items: Array.isArray(data.items) ? data.items : [],
        });
      }
    });
    const sorted = sortMhPreStartInspections(records);
    if (sorted.length > 0) {
      saveCachedMhPreStartInspections(sorted);
      return sorted;
    }
    return loadCachedMhPreStartInspections();
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_PRESTART_INSPECTIONS_COLLECTION);
    return loadCachedMhPreStartInspections();
  }
}

export function subscribeToMhPreStartInspections(
  onData: (records: MhPreStartInspectionRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_prestart_inspections_listener";
  const cached = loadCachedMhPreStartInspections();
  if (cached.length > 0) {
    onData(cached);
  }
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhPreStartInspectionsOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_PRESTART_INSPECTIONS_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhPreStartInspectionRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhPreStartInspectionRecord;
        if (data && data.id && data.vehicleId) {
          records.push({
            ...data,
            mileageKm:
              typeof data.mileageKm === "number" && !isNaN(data.mileageKm)
                ? data.mileageKm
                : Number(data.operatingHours) || 0,
            items: Array.isArray(data.items) ? data.items : [],
          });
        }
      });
      const sorted = sortMhPreStartInspections(records);
      if (sorted.length > 0 || !snapshot.metadata.fromCache) {
        saveCachedMhPreStartInspections(sorted);
      }
      onData(sorted);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_PRESTART_INSPECTIONS_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

/**
 * Saves a Pre-Start Inspection record and automatically syncs its latest mileageKm
 * into any active PM Schedules for that vehicle so the PM Calendar immediately flags
 * vehicles that have reached their target mileage.
 */
export async function saveMhPreStartInspectionToCloud(
  record: Partial<MhPreStartInspectionRecord> & { vehicleId: string }
): Promise<{ saved: boolean; duePmSchedules: MhPmScheduleRecord[] }> {
  const payload = sanitizeMhPreStartInspectionPayload(record);
  const cached = loadCachedMhPreStartInspections();
  const nextCache = [payload, ...cached.filter((item) => item.id !== payload.id)];
  saveCachedMhPreStartInspections(nextCache);

  const docRef = doc(dbForklift, MH_PRESTART_INSPECTIONS_COLLECTION, payload.id);
  const saved = await runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: true }),
    OperationType.WRITE,
    `${MH_PRESTART_INSPECTIONS_COLLECTION}/${payload.id}`
  );

  // Sync latest mileage to active PM Schedules for this vehicle
  const duePmSchedules: MhPmScheduleRecord[] = [];
  if (payload.mileageKm > 0) {
    try {
      const allSchedules = await fetchMhPmSchedulesOnce();
      const targetVeh = payload.vehicleId.trim().toUpperCase();
      const matchingSchedules = allSchedules.filter(
        (s) => s.scheduleStatus === "Active" && s.vehicleId.trim().toUpperCase() === targetVeh
      );
      for (const sch of matchingSchedules) {
        const targetKm =
          typeof sch.targetMileageKm === "number" && sch.targetMileageKm > 0
            ? sch.targetMileageKm
            : typeof sch.cycleMileageKm === "number" && sch.cycleMileageKm > 0
            ? (sch.startMileageKm ?? 0) + sch.cycleMileageKm
            : undefined;
        const reachedTarget = targetKm !== undefined && payload.mileageKm >= targetKm;
        const updatedSch: MhPmScheduleRecord = {
          ...sch,
          currentMileageKm: Math.max(sch.currentMileageKm ?? 0, payload.mileageKm),
          currentHours:
            payload.operatingHours > 0
              ? Math.max(sch.currentHours ?? 0, payload.operatingHours)
              : sch.currentHours,
          mileageDueDate: reachedTarget
            ? sch.mileageDueDate || payload.inspectionDate
            : sch.mileageDueDate,
        };
        await saveMhPmScheduleToCloud(updatedSch);
        if (reachedTarget) {
          duePmSchedules.push(updatedSch);
        }
      }
    } catch {
      // Ignore secondary sync error
    }
  }

  return { saved, duePmSchedules };
}

// ============================================================================
// 9. Interactive PM Schedule Matrix (mh_pm_matrix) Cloud & Local Cache
// ============================================================================
const MH_PM_MATRIX_CACHE_KEY = "tmt_mh_pm_matrix_cache_v1";

function sanitizeMhPmMatrixPayload(
  r: Partial<MhPmMatrixRecord> & { id: string; vehicleCategory: MhPmMatrixCategory; targetKey: string }
): MhPmMatrixRecord {
  const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19);
  const cleanId = sanitizeDocId(r.id) || `PMM_${r.vehicleCategory}_${Date.now()}`;
  const cleanCategory: MhPmMatrixCategory =
    r.vehicleCategory === "ev_tractor" || r.vehicleCategory === "diesel_tractor"
      ? r.vehicleCategory
      : "forklift";

  const cleanChecks: Record<string, string[]> = {};
  if (r.checks && typeof r.checks === "object") {
    Object.entries(r.checks).forEach(([rowKey, cols]) => {
      const k = String(rowKey || "").trim().slice(0, 64);
      if (!k) return;
      if (Array.isArray(cols)) {
        const uniqueCols = Array.from(
          new Set(
            cols
              .map((c) => String(c || "").trim().slice(0, 24))
              .filter(Boolean)
          )
        ).slice(0, 12);
        cleanChecks[k] = uniqueCols;
      }
    });
  }

  const payload: MhPmMatrixRecord = {
    id: cleanId,
    vehicleCategory: cleanCategory,
    targetKey: String(r.targetKey || "TEMPLATE").trim().slice(0, 64) || "TEMPLATE",
    checks: cleanChecks,
    status: r.status === "submitted" ? "submitted" : "draft",
    updatedAt: String(r.updatedAt || nowIso).slice(0, 64),
  };

  if (r.vehicleId && String(r.vehicleId).trim()) {
    payload.vehicleId = String(r.vehicleId).trim().slice(0, 64);
  }
  if (r.notes && String(r.notes).trim()) {
    payload.notes = String(r.notes).trim().slice(0, 500);
  }
  if (r.updatedBy && String(r.updatedBy).trim()) {
    payload.updatedBy = String(r.updatedBy).trim().slice(0, 128);
  }
  if (r.submittedAt && String(r.submittedAt).trim()) {
    payload.submittedAt = String(r.submittedAt).trim().slice(0, 64);
  }
  if (r.submittedBy && String(r.submittedBy).trim()) {
    payload.submittedBy = String(r.submittedBy).trim().slice(0, 128);
  }

  return payload;
}

export function loadCachedMhPmMatrixRecords(): MhPmMatrixRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MH_PM_MATRIX_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCachedMhPmMatrixRecords(records: MhPmMatrixRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MH_PM_MATRIX_CACHE_KEY, JSON.stringify(records));
  } catch {
    // ignore storage quota error
  }
}

export async function fetchMhPmMatrixRecordsOnce(): Promise<MhPmMatrixRecord[]> {
  try {
    const snap = await getDocs(collection(dbForklift, MH_PM_MATRIX_COLLECTION));
    const records: MhPmMatrixRecord[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() as MhPmMatrixRecord;
      if (data && data.id && data.vehicleCategory) {
        records.push(data);
      }
    });
    if (records.length > 0) {
      saveCachedMhPmMatrixRecords(records);
      return records;
    }
    return loadCachedMhPmMatrixRecords();
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MH_PM_MATRIX_COLLECTION);
    return loadCachedMhPmMatrixRecords();
  }
}

export function subscribeToMhPmMatrixRecords(
  onData: (records: MhPmMatrixRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const channelKey = "mh_pm_matrix_listener";
  if (!forkliftCloudRealtimeEnabled) {
    fetchMhPmMatrixRecordsOnce().then(onData).catch((err) => onError?.(err));
    return () => {};
  }

  const colRef = collection(dbForklift, MH_PM_MATRIX_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const records: MhPmMatrixRecord[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as MhPmMatrixRecord;
        if (data && data.id && data.vehicleCategory) {
          records.push(data);
        }
      });
      if (records.length > 0 || !snapshot.metadata.fromCache) {
        saveCachedMhPmMatrixRecords(records);
      }
      onData(records);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, MH_PM_MATRIX_COLLECTION);
      onError?.(error);
    }
  );

  return registerForkliftFirestoreListener(channelKey, unsub);
}

export async function saveMhPmMatrixRecordToCloud(
  record: Partial<MhPmMatrixRecord> & { id: string; vehicleCategory: MhPmMatrixCategory; targetKey: string }
): Promise<boolean> {
  const payload = sanitizeMhPmMatrixPayload(record);
  const cached = loadCachedMhPmMatrixRecords();
  const nextCache = [payload, ...cached.filter((item) => item.id !== payload.id)];
  saveCachedMhPmMatrixRecords(nextCache);

  const docRef = doc(dbForklift, MH_PM_MATRIX_COLLECTION, payload.id);
  return runForkliftFirestoreWriteWithGuard(
    () => setDoc(docRef, payload, { merge: false }),
    OperationType.WRITE,
    `${MH_PM_MATRIX_COLLECTION}/${payload.id}`
  );
}

export async function deleteMhPmMatrixRecordFromCloud(id: string): Promise<boolean> {
  const cleanId = sanitizeDocId(id);
  if (!cleanId) return false;
  const cached = loadCachedMhPmMatrixRecords();
  saveCachedMhPmMatrixRecords(cached.filter((item) => item.id !== cleanId));

  const docRef = doc(dbForklift, MH_PM_MATRIX_COLLECTION, cleanId);
  return runForkliftFirestoreWriteWithGuard(
    () => deleteDoc(docRef),
    OperationType.DELETE,
    `${MH_PM_MATRIX_COLLECTION}/${cleanId}`
  );
}


