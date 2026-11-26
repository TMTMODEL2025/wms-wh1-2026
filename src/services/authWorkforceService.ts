/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
  query,
  limit,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import {
  Employee,
  Vehicle,
  VehicleAssignment,
  WmsActivityLogRecord,
  WmsSectionId,
  WmsSessionUser,
} from "../types/officer";
import {
  loadStoredEmployees,
  saveStoredEmployees,
  loadStoredVehicles,
  saveStoredVehicles,
  loadStoredAssignments,
  saveStoredAssignments,
} from "../data/officerData";
import {
  getSectionIdForMenu,
  getSectionMeta,
  resolveEmployeeAllowedSections,
} from "../utils/sectionPermissions";
import { resolveVehicleType } from "../utils/vehicleHelpers";

export const WMS_EMPLOYEES_COLLECTION = "wms_employees";
export const WMS_VEHICLES_COLLECTION = "wms_vehicles";
export const WMS_VEHICLE_ASSIGNMENTS_COLLECTION = "wms_vehicle_assignments";
export const WMS_ACTIVITY_LOGS_COLLECTION = "wms_activity_logs";

const STORAGE_KEY_CURRENT_SESSION = "tmt_wms_current_session_v1";
const STORAGE_KEY_ACTIVITY_LOGS = "tmt_wms_activity_logs_v1";
const MAX_CACHED_LOGS = 250;

function sanitizeDocId(id: string): string {
  const cleaned = String(id || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 128);
  return cleaned || `ID_${Date.now()}`;
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

export function formatLocalTimestamp(): {
  timestamp: string;
  dateYmd: string;
  timeHm: string;
} {
  const now = new Date();
  const dateYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
  const timeHms = now.toTimeString().slice(0, 8);
  return {
    timestamp: `${dateYmd} ${timeHms}`,
    dateYmd,
    timeHm: timeHms.slice(0, 5),
  };
}

// ============================================================================
// Active Session Accessor (Readable across components and data services)
// ============================================================================
let cachedSessionUser: WmsSessionUser | null = (() => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CURRENT_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WmsSessionUser;
    if (parsed && typeof parsed.employeeId === "string" && parsed.employeeId.trim()) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
})();

export function getActiveWmsSessionUser(): WmsSessionUser | null {
  return cachedSessionUser;
}

export function setActiveWmsSessionUser(user: WmsSessionUser | null): void {
  cachedSessionUser = user;
  if (typeof window === "undefined") return;
  try {
    if (user) {
      window.localStorage.setItem(STORAGE_KEY_CURRENT_SESSION, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(STORAGE_KEY_CURRENT_SESSION);
    }
  } catch {
    // ignore storage errors
  }
}

export function getActiveRecorderDisplay(fallback = "WMS System"): {
  employeeId: string;
  employeeName: string;
  department: string;
  label: string;
} {
  if (cachedSessionUser) {
    return {
      employeeId: cachedSessionUser.employeeId,
      employeeName: cachedSessionUser.employeeName,
      department: cachedSessionUser.department,
      label: `${cachedSessionUser.employeeName} (${cachedSessionUser.employeeId})`,
    };
  }
  return {
    employeeId: "SYSTEM",
    employeeName: fallback,
    department: "-",
    label: fallback,
  };
}

// ============================================================================
// Centralized Employee Directory Cloud Sync (wms_employees)
// ============================================================================
let hasSyncedLocalEmployeesToCloud = false;

export async function saveWmsEmployeeToCloud(employee: Employee): Promise<void> {
  const docId = sanitizeDocId(employee.employeeId || employee.id);
  const payload = stripUndefinedDeep({
    ...employee,
    id: docId,
    employeeId: employee.employeeId.trim().toUpperCase(),
    allowedSections: resolveEmployeeAllowedSections(employee),
    updatedAt: employee.updatedAt || formatLocalTimestamp().timestamp,
  });

  try {
    await setDoc(doc(db, WMS_EMPLOYEES_COLLECTION, docId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${WMS_EMPLOYEES_COLLECTION}/${docId}`);
  }
}

export async function syncEmployeeRosterDiffToCloud(
  prevList: Employee[],
  nextList: Employee[]
): Promise<void> {
  saveStoredEmployees(nextList);

  const prevMap = new Map<string, Employee>();
  prevList.forEach((e) => prevMap.set(sanitizeDocId(e.employeeId || e.id), e));

  const nextIds = new Set<string>();
  const upserts: Employee[] = [];

  nextList.forEach((emp) => {
    const key = sanitizeDocId(emp.employeeId || emp.id);
    nextIds.add(key);
    const prev = prevMap.get(key);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(emp)) {
      upserts.push(emp);
    }
  });

  const deletedIds: string[] = [];
  prevMap.forEach((_, key) => {
    if (!nextIds.has(key)) deletedIds.push(key);
  });

  if (upserts.length === 0 && deletedIds.length === 0) return;

  try {
    const batch = writeBatch(db);
    upserts.forEach((emp) => {
      const docId = sanitizeDocId(emp.employeeId || emp.id);
      const payload = stripUndefinedDeep({
        ...emp,
        id: docId,
        employeeId: emp.employeeId.trim().toUpperCase(),
        allowedSections: resolveEmployeeAllowedSections(emp),
      });
      batch.set(doc(db, WMS_EMPLOYEES_COLLECTION, docId), payload, { merge: true });
    });
    deletedIds.forEach((docId) => {
      batch.delete(doc(db, WMS_EMPLOYEES_COLLECTION, docId));
    });
    await batch.commit();
  } catch (error) {
    // Fallback individual writes so partial errors still surface properly
    for (const emp of upserts) {
      await saveWmsEmployeeToCloud(emp);
    }
    for (const docId of deletedIds) {
      try {
        await deleteDoc(doc(db, WMS_EMPLOYEES_COLLECTION, docId));
      } catch (delErr) {
        handleFirestoreError(delErr, OperationType.DELETE, `${WMS_EMPLOYEES_COLLECTION}/${docId}`);
      }
    }
    if (upserts.length === 0 && deletedIds.length === 0) {
      handleFirestoreError(error, OperationType.WRITE, WMS_EMPLOYEES_COLLECTION);
    }
  }
}

export function subscribeToWmsEmployees(
  onUpdate: (employees: Employee[]) => void
): () => void {
  const cached = loadStoredEmployees();
  if (cached.length > 0) {
    onUpdate(cached);
  }

  const colRef = collection(db, WMS_EMPLOYEES_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const cloudList: Employee[] = snapshot.docs.map((d) => {
        const raw = d.data() as Employee;
        return {
          ...raw,
          id: raw.id || d.id,
          employeeId: (raw.employeeId || d.id).toUpperCase(),
          allowedSections: resolveEmployeeAllowedSections(raw),
        };
      });

      if (cloudList.length === 0 && !hasSyncedLocalEmployeesToCloud) {
        hasSyncedLocalEmployeesToCloud = true;
        const localNow = loadStoredEmployees();
        if (localNow.length > 0) {
          void syncEmployeeRosterDiffToCloud([], localNow);
          onUpdate(localNow);
          return;
        }
      }

      hasSyncedLocalEmployeesToCloud = true;
      cloudList.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
      saveStoredEmployees(cloudList);
      onUpdate(cloudList);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, WMS_EMPLOYEES_COLLECTION);
    }
  );

  return unsub;
}

export async function fetchWmsEmployeesOnce(): Promise<Employee[]> {
  try {
    const snap = await getDocs(collection(db, WMS_EMPLOYEES_COLLECTION));
    const list: Employee[] = snap.docs.map((d) => {
      const raw = d.data() as Employee;
      return {
        ...raw,
        id: raw.id || d.id,
        employeeId: (raw.employeeId || d.id).toUpperCase(),
        allowedSections: resolveEmployeeAllowedSections(raw),
      };
    });
    list.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
    if (list.length > 0) {
      saveStoredEmployees(list);
    }
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, WMS_EMPLOYEES_COLLECTION);
    return loadStoredEmployees();
  }
}

// ============================================================================
// Centralized Vehicle Fleet Cloud Sync (wms_vehicles) - Shared across warehouse
// ============================================================================
let hasSyncedLocalVehiclesToCloud = false;

export async function saveWmsVehicleToCloud(vehicle: Vehicle): Promise<void> {
  const normalizedVehicleId = String(vehicle.vehicleId || vehicle.number || vehicle.id || "")
    .trim()
    .toUpperCase();
  const docId = sanitizeDocId(normalizedVehicleId);
  const resolvedType = resolveVehicleType({ ...vehicle, vehicleId: normalizedVehicleId });
  const payload = stripUndefinedDeep({
    ...vehicle,
    id: vehicle.id || docId,
    vehicleId: normalizedVehicleId,
    number: normalizedVehicleId,
    vehicleType: resolvedType,
    updatedAt: vehicle.updatedAt || formatLocalTimestamp().timestamp,
  });

  try {
    await setDoc(doc(db, WMS_VEHICLES_COLLECTION, docId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${WMS_VEHICLES_COLLECTION}/${docId}`);
  }
}

export async function syncVehicleFleetDiffToCloud(
  prevList: Vehicle[],
  nextList: Vehicle[]
): Promise<void> {
  saveStoredVehicles(nextList);

  const prevMap = new Map<string, Vehicle>();
  prevList.forEach((v) => {
    const key = sanitizeDocId(v.vehicleId || v.number || v.id);
    prevMap.set(key, v);
  });

  const nextIds = new Set<string>();
  const upserts: Vehicle[] = [];

  nextList.forEach((v) => {
    const key = sanitizeDocId(v.vehicleId || v.number || v.id);
    nextIds.add(key);
    const prev = prevMap.get(key);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(v)) {
      upserts.push(v);
    }
  });

  const deletedIds: string[] = [];
  prevMap.forEach((_, key) => {
    if (!nextIds.has(key)) deletedIds.push(key);
  });

  if (upserts.length === 0 && deletedIds.length === 0) return;

  try {
    const batch = writeBatch(db);
    upserts.forEach((v) => {
      const normalizedVehicleId = String(v.vehicleId || v.number || v.id || "")
        .trim()
        .toUpperCase();
      const docId = sanitizeDocId(normalizedVehicleId);
      const resolvedType = resolveVehicleType({ ...v, vehicleId: normalizedVehicleId });
      const payload = stripUndefinedDeep({
        ...v,
        id: v.id || docId,
        vehicleId: normalizedVehicleId,
        number: normalizedVehicleId,
        vehicleType: resolvedType,
        updatedAt: v.updatedAt || formatLocalTimestamp().timestamp,
      });
      batch.set(doc(db, WMS_VEHICLES_COLLECTION, docId), payload, { merge: true });
    });
    deletedIds.forEach((docId) => {
      batch.delete(doc(db, WMS_VEHICLES_COLLECTION, docId));
    });
    await batch.commit();
  } catch (error) {
    for (const v of upserts) {
      await saveWmsVehicleToCloud(v);
    }
    for (const docId of deletedIds) {
      try {
        await deleteDoc(doc(db, WMS_VEHICLES_COLLECTION, docId));
      } catch (delErr) {
        handleFirestoreError(delErr, OperationType.DELETE, `${WMS_VEHICLES_COLLECTION}/${docId}`);
      }
    }
    if (upserts.length === 0 && deletedIds.length === 0) {
      handleFirestoreError(error, OperationType.WRITE, WMS_VEHICLES_COLLECTION);
    }
  }
}

export function subscribeToWmsVehicles(
  onUpdate: (vehicles: Vehicle[]) => void
): () => void {
  const cached = loadStoredVehicles().map((raw) => ({
    ...raw,
    vehicleType: resolveVehicleType(raw),
  }));
  if (cached.length > 0) {
    onUpdate(cached);
  }

  const colRef = collection(db, WMS_VEHICLES_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const cloudList: Vehicle[] = snapshot.docs.map((d) => {
        const raw = d.data() as Vehicle;
        const normalizedVehicleId = String(raw.vehicleId || raw.number || d.id)
          .trim()
          .toUpperCase();
        const resolvedType = resolveVehicleType({
          ...raw,
          vehicleId: normalizedVehicleId,
          vehicleType: raw.vehicleType || "Forklift",
        });
        return {
          ...raw,
          id: raw.id || d.id,
          vehicleId: normalizedVehicleId,
          number: raw.number || normalizedVehicleId,
          vehicleType: resolvedType,
          type:
            resolvedType === "ElectricTractor"
              ? `หัวลากไฟฟ้า ${raw.capacityTon ? `${raw.capacityTon}T` : ""}`.trim()
              : raw.type || resolvedType,
          description: raw.description || "",
          registrationNumber: raw.registrationNumber || `TMT-${normalizedVehicleId}`,
          activeStatus: raw.activeStatus || "Active",
          operationalStatus: raw.operationalStatus || "Available",
          department: raw.department || "Material Handling - Fleet",
          status:
            raw.status ||
            (raw.operationalStatus === "Maintenance"
              ? "Maintenance"
              : raw.activeStatus === "Inactive"
              ? "Inactive"
              : "Available"),
          createdAt: raw.createdAt || "",
          updatedAt: raw.updatedAt || "",
        };
      });

      if (cloudList.length === 0 && !hasSyncedLocalVehiclesToCloud) {
        hasSyncedLocalVehiclesToCloud = true;
        const localNow = loadStoredVehicles();
        if (localNow.length > 0) {
          void syncVehicleFleetDiffToCloud([], localNow);
          onUpdate(localNow);
          return;
        }
      }

      hasSyncedLocalVehiclesToCloud = true;
      cloudList.sort((a, b) =>
        a.vehicleId.localeCompare(b.vehicleId, undefined, { numeric: true })
      );
      saveStoredVehicles(cloudList);
      onUpdate(cloudList);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, WMS_VEHICLES_COLLECTION);
    }
  );

  return unsub;
}

// ============================================================================
// Centralized Vehicle Assignments Cloud Sync (wms_vehicle_assignments)
// ============================================================================
let hasSyncedLocalAssignmentsToCloud = false;

export async function syncVehicleAssignmentsDiffToCloud(
  prevList: VehicleAssignment[],
  nextList: VehicleAssignment[]
): Promise<void> {
  saveStoredAssignments(nextList);

  const prevMap = new Map<string, VehicleAssignment>();
  prevList.forEach((a) => prevMap.set(sanitizeDocId(a.id), a));

  const nextIds = new Set<string>();
  const upserts: VehicleAssignment[] = [];

  nextList.forEach((a) => {
    const key = sanitizeDocId(a.id);
    nextIds.add(key);
    const prev = prevMap.get(key);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(a)) {
      upserts.push(a);
    }
  });

  const deletedIds: string[] = [];
  prevMap.forEach((_, key) => {
    if (!nextIds.has(key)) deletedIds.push(key);
  });

  if (upserts.length === 0 && deletedIds.length === 0) return;

  try {
    const batch = writeBatch(db);
    upserts.forEach((a) => {
      const docId = sanitizeDocId(a.id);
      const payload = stripUndefinedDeep({
        ...a,
        id: docId,
      });
      batch.set(doc(db, WMS_VEHICLE_ASSIGNMENTS_COLLECTION, docId), payload, { merge: true });
    });
    deletedIds.forEach((docId) => {
      batch.delete(doc(db, WMS_VEHICLE_ASSIGNMENTS_COLLECTION, docId));
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, WMS_VEHICLE_ASSIGNMENTS_COLLECTION);
  }
}

export function subscribeToWmsVehicleAssignments(
  onUpdate: (assignments: VehicleAssignment[]) => void
): () => void {
  const cached = loadStoredAssignments();
  if (cached.length > 0) {
    onUpdate(cached);
  }

  const colRef = collection(db, WMS_VEHICLE_ASSIGNMENTS_COLLECTION);
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      const cloudList: VehicleAssignment[] = snapshot.docs.map((d) => {
        const raw = d.data() as VehicleAssignment;
        return {
          ...raw,
          id: raw.id || d.id,
        };
      });

      if (cloudList.length === 0 && !hasSyncedLocalAssignmentsToCloud) {
        hasSyncedLocalAssignmentsToCloud = true;
        const localNow = loadStoredAssignments();
        if (localNow.length > 0) {
          void syncVehicleAssignmentsDiffToCloud([], localNow);
          onUpdate(localNow);
          return;
        }
      }

      hasSyncedLocalAssignmentsToCloud = true;
      cloudList.sort((a, b) => (b.workingDate || "").localeCompare(a.workingDate || ""));
      saveStoredAssignments(cloudList);
      onUpdate(cloudList);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, WMS_VEHICLE_ASSIGNMENTS_COLLECTION);
    }
  );

  return unsub;
}

// ============================================================================
// Cross-Module Activity Audit Logs (wms_activity_logs)
// ============================================================================
export function loadCachedWmsActivityLogs(): WmsActivityLogRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ACTIVITY_LOGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore storage errors
  }
  return [];
}

function saveCachedWmsActivityLogs(logs: WmsActivityLogRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY_ACTIVITY_LOGS,
      JSON.stringify(logs.slice(0, MAX_CACHED_LOGS))
    );
  } catch {
    // ignore storage errors
  }
}

const localLogSubscribers = new Set<(logs: WmsActivityLogRecord[]) => void>();

export function notifyLocalActivityLogSubscribers(logs: WmsActivityLogRecord[]): void {
  localLogSubscribers.forEach((cb) => {
    try {
      cb(logs);
    } catch {
      // ignore
    }
  });
}

export interface LogActivityInput {
  module: string;
  reference: string;
  activity: string;
  status?: string;
  sectionId?: WmsSectionId;
  menuId?: string;
  userOverride?: Pick<WmsSessionUser, "employeeId" | "employeeName" | "department" | "role">;
}

export async function appendWmsActivityLog(
  input: LogActivityInput
): Promise<WmsActivityLogRecord> {
  const { timestamp, dateYmd, timeHm } = formatLocalTimestamp();
  const activeUser = input.userOverride || cachedSessionUser;

  const resolvedSectionId: WmsSectionId =
    input.sectionId ||
    (input.menuId ? getSectionIdForMenu(input.menuId) : inferSectionFromModule(input.module));
  const sectionMeta = getSectionMeta(resolvedSectionId);

  const uniqueRand = Math.random().toString(36).slice(2, 7).toUpperCase();
  const docId = sanitizeDocId(`ACT-${Date.now()}-${uniqueRand}`);

  const record: WmsActivityLogRecord = {
    id: docId,
    timestamp,
    dateYmd,
    timeHm,
    employeeId: activeUser?.employeeId || "SYSTEM",
    employeeName: activeUser?.employeeName || "WMS Operator",
    department: activeUser?.department || "-",
    role: activeUser?.role || "Operator",
    sectionId: resolvedSectionId,
    sectionLabel: sectionMeta.shortLabelTh,
    module: String(input.module || "WMS").slice(0, 128),
    reference: String(input.reference || "-").slice(0, 128),
    activity: String(input.activity || "").slice(0, 500),
    status: String(input.status || "Completed").slice(0, 64),
    updatedAt: timestamp,
  };

  const cached = loadCachedWmsActivityLogs();
  const nextCache = [record, ...cached].slice(0, MAX_CACHED_LOGS);
  saveCachedWmsActivityLogs(nextCache);
  notifyLocalActivityLogSubscribers(nextCache);

  try {
    await setDoc(doc(db, WMS_ACTIVITY_LOGS_COLLECTION, docId), stripUndefinedDeep(record));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${WMS_ACTIVITY_LOGS_COLLECTION}/${docId}`);
  }

  return record;
}

function inferSectionFromModule(moduleName: string): WmsSectionId {
  const m = (moduleName || "").toLowerCase();
  if (m.includes("coil") || m.includes("เหล็กม้วน")) return "coil_ops";
  if (m.includes("slit") || m.includes("สลิต") || m.includes("recheck") || m.includes("equipment")) {
    return "slit_ops";
  }
  if (m.includes("rm") || m.includes("sheet") || m.includes("เหล็กแผ่น")) return "rm_ops";
  if (
    m.includes("admin") ||
    m.includes("บริหาร") ||
    m.includes("workforce") ||
    m.includes("auth") ||
    m.includes("login")
  ) {
    return "admin_hr";
  }
  if (
    m.includes("transport") ||
    m.includes("vehicle") ||
    m.includes("fuel") ||
    m.includes("fix") ||
    m.includes("pre-start") ||
    m.includes("employee") ||
    m.includes("fleet") ||
    m.includes("duty")
  ) {
    return "fleet_ops";
  }
  return "overview";
}

export function subscribeToWmsActivityLogs(
  onUpdate: (logs: WmsActivityLogRecord[]) => void
): () => void {
  const initialCached = loadCachedWmsActivityLogs();
  if (initialCached.length > 0) {
    onUpdate(initialCached);
  }

  const localSub = (logs: WmsActivityLogRecord[]) => {
    onUpdate(logs);
  };
  localLogSubscribers.add(localSub);

  const q = query(collection(db, WMS_ACTIVITY_LOGS_COLLECTION), limit(MAX_CACHED_LOGS));
  const unsubFirestore = onSnapshot(
    q,
    (snapshot) => {
      const cloudLogs: WmsActivityLogRecord[] = snapshot.docs.map((d) => ({
        ...(d.data() as WmsActivityLogRecord),
        id: d.id,
      }));
      cloudLogs.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
      if (cloudLogs.length > 0) {
        saveCachedWmsActivityLogs(cloudLogs);
        onUpdate(cloudLogs);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, WMS_ACTIVITY_LOGS_COLLECTION);
    }
  );

  return () => {
    localLogSubscribers.delete(localSub);
    unsubFirestore();
  };
}
