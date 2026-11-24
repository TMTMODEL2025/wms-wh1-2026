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
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";

export const SLIT_WORKFORCE_COLLECTION = "slit_workforce_assignments";
export const STORAGE_KEY_SLIT_WORKFORCE = "tmt_wms_slit_workforce_assignments_v1";

export type SlitWorkforceShift = "day" | "night";
export type SlitWorkforceMachineGroup = "TM" | "CF" | "ML" | "ZF";
export type SlitWorkforceStatus = "active" | "standby" | "completed";

export interface SlitWorkforceAssignment {
  id: string;
  workingDate: string; // YYYY-MM-DD
  employeeId?: string;
  employeeName: string;
  department?: string;
  shift: SlitWorkforceShift;
  area: string;
  machineGroup: SlitWorkforceMachineGroup;
  machineGroups?: SlitWorkforceMachineGroup[]; // Multi-group selection e.g. ["TM", "CF"]
  machines?: string[]; // Specific machines across any groups e.g. ["TM01", "CF01", "ML02"]
  duty: string;
  status: SlitWorkforceStatus;
  notes?: string;
  assignedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

const CANONICAL_MACHINE_GROUPS: SlitWorkforceMachineGroup[] = ["TM", "CF", "ML", "ZF"];

const VALID_MACHINE_GROUPS: ReadonlySet<SlitWorkforceMachineGroup> = new Set(
  CANONICAL_MACHINE_GROUPS
);

export function inferMachineGroupFromCode(code: string): SlitWorkforceMachineGroup | null {
  const upper = String(code || "").trim().toUpperCase();
  if (upper.startsWith("TM")) return "TM";
  if (upper.startsWith("CF")) return "CF";
  if (upper.startsWith("ML")) return "ML";
  if (upper.startsWith("ZF")) return "ZF";
  return null;
}

export function getAssignmentMachineGroups(
  item: Pick<SlitWorkforceAssignment, "machineGroup" | "machineGroups" | "machines">
): SlitWorkforceMachineGroup[] {
  const set = new Set<SlitWorkforceMachineGroup>();
  if (Array.isArray(item.machineGroups)) {
    item.machineGroups.forEach((g) => {
      const upper = String(g || "").trim().toUpperCase() as SlitWorkforceMachineGroup;
      if (VALID_MACHINE_GROUPS.has(upper)) set.add(upper);
    });
  }
  if (Array.isArray(item.machines)) {
    item.machines.forEach((code) => {
      const inferred = inferMachineGroupFromCode(code);
      if (inferred) set.add(inferred);
    });
  }
  if (set.size === 0 && item.machineGroup) {
    const upper = String(item.machineGroup).trim().toUpperCase() as SlitWorkforceMachineGroup;
    if (VALID_MACHINE_GROUPS.has(upper)) set.add(upper);
  }
  if (set.size === 0) set.add("TM");
  return CANONICAL_MACHINE_GROUPS.filter((g) => set.has(g));
}

const VALID_STATUSES: ReadonlySet<SlitWorkforceStatus> = new Set([
  "active",
  "standby",
  "completed",
]);

function sanitizeDocId(id: string): string {
  const cleaned = String(id || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 128);
  return cleaned || `SLIT_WF_${Date.now()}`;
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

function normalizeMachineGroup(val: unknown): SlitWorkforceMachineGroup {
  const upper = String(val || "").trim().toUpperCase();
  if (VALID_MACHINE_GROUPS.has(upper as SlitWorkforceMachineGroup)) {
    return upper as SlitWorkforceMachineGroup;
  }
  return "TM";
}

function normalizeStatus(val: unknown): SlitWorkforceStatus {
  const lower = String(val || "").trim().toLowerCase();
  if (VALID_STATUSES.has(lower as SlitWorkforceStatus)) {
    return lower as SlitWorkforceStatus;
  }
  return "active";
}

function formatLocalDateYMD(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function normalizeSlitWorkforcePayload(
  record: SlitWorkforceAssignment
): SlitWorkforceAssignment & { updatedAt: string } {
  const nowIso = new Date().toISOString();
  const docId = sanitizeDocId(record.id || `SLIT_WF_${Date.now()}`);
  const safeShift: SlitWorkforceShift = record.shift === "night" ? "night" : "day";
  const safeMachines = Array.isArray(record.machines)
    ? Array.from(
        new Set(
          record.machines
            .map((m) => String(m || "").trim().toUpperCase().slice(0, 32))
            .filter(Boolean)
        )
      ).slice(0, 50)
    : [];

  const safeMachineGroups = getAssignmentMachineGroups({
    machineGroup: normalizeMachineGroup(record.machineGroup),
    machineGroups: record.machineGroups,
    machines: safeMachines,
  });

  const base: SlitWorkforceAssignment & { updatedAt: string } = {
    id: docId,
    workingDate: String(record.workingDate || formatLocalDateYMD()).trim().slice(0, 32),
    employeeName: String(record.employeeName || "").trim().slice(0, 128) || "-",
    shift: safeShift,
    area: String(record.area || "").trim().slice(0, 128) || "-",
    machineGroup: safeMachineGroups[0] || normalizeMachineGroup(record.machineGroup),
    machineGroups: safeMachineGroups,
    machines: safeMachines,
    duty: String(record.duty || "").trim().slice(0, 128) || "-",
    status: normalizeStatus(record.status),
    createdAt: String(record.createdAt || nowIso).slice(0, 64),
    updatedAt: nowIso,
  };

  if (record.employeeId !== undefined && String(record.employeeId).trim() !== "") {
    base.employeeId = String(record.employeeId).trim().toUpperCase().slice(0, 64);
  }
  if (record.department !== undefined && String(record.department).trim() !== "") {
    base.department = String(record.department).trim().slice(0, 128);
  }
  if (record.notes !== undefined && String(record.notes).trim() !== "") {
    base.notes = String(record.notes).trim().slice(0, 500);
  }
  if (record.assignedBy !== undefined && String(record.assignedBy).trim() !== "") {
    base.assignedBy = String(record.assignedBy).trim().slice(0, 128);
  }

  return stripUndefinedDeep(base);
}

export function loadCachedSlitWorkforceAssignments(): SlitWorkforceAssignment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SLIT_WORKFORCE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SlitWorkforceAssignment[]) : [];
  } catch {
    return [];
  }
}

function saveCachedSlitWorkforceAssignments(items: SlitWorkforceAssignment[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_SLIT_WORKFORCE, JSON.stringify(items));
  } catch {
    // ignore storage quota errors
  }
}

function sortAssignmentsDesc(items: SlitWorkforceAssignment[]): SlitWorkforceAssignment[] {
  return [...items].sort((a, b) => {
    const dateDiff = String(b.workingDate || "").localeCompare(String(a.workingDate || ""));
    if (dateDiff !== 0) return dateDiff;
    return String(b.updatedAt || b.createdAt || "").localeCompare(
      String(a.updatedAt || a.createdAt || "")
    );
  });
}

/**
 * Subscribe in real-time to Slit/Film workforce duty assignments in Firestore.
 */
export function subscribeSlitWorkforceAssignments(
  onUpdate: (items: SlitWorkforceAssignment[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const colRef = collection(db, SLIT_WORKFORCE_COLLECTION);

  return onSnapshot(
    colRef,
    (snapshot) => {
      const cloudItems: SlitWorkforceAssignment[] = snapshot.docs.map((d) => {
        const raw = d.data() as SlitWorkforceAssignment;
        const safeMachines = Array.isArray(raw.machines) ? raw.machines : [];
        const safeGroups = getAssignmentMachineGroups({
          machineGroup: normalizeMachineGroup(raw.machineGroup),
          machineGroups: raw.machineGroups,
          machines: safeMachines,
        });
        return {
          ...raw,
          id: raw.id || d.id,
          shift: raw.shift === "night" ? "night" : "day",
          machineGroup: safeGroups[0] || normalizeMachineGroup(raw.machineGroup),
          machineGroups: safeGroups,
          machines: safeMachines,
          status: normalizeStatus(raw.status),
        };
      });

      const sorted = sortAssignmentsDesc(cloudItems);
      saveCachedSlitWorkforceAssignments(sorted);
      onUpdate(sorted);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, SLIT_WORKFORCE_COLLECTION);
      if (onError) onError(error);
    }
  );
}

/**
 * Create or update a Slit/Film workforce assignment document in Firestore.
 */
export async function saveSlitWorkforceAssignment(
  record: SlitWorkforceAssignment
): Promise<SlitWorkforceAssignment> {
  const payload = normalizeSlitWorkforcePayload(record);
  try {
    await setDoc(
      doc(db, SLIT_WORKFORCE_COLLECTION, payload.id),
      payload,
      { merge: true }
    );
    return payload;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${SLIT_WORKFORCE_COLLECTION}/${payload.id}`
    );
    throw error;
  }
}

/**
 * Delete a Slit/Film workforce assignment document from Firestore.
 */
export async function deleteSlitWorkforceAssignment(id: string): Promise<void> {
  const docId = sanitizeDocId(id);
  try {
    await deleteDoc(doc(db, SLIT_WORKFORCE_COLLECTION, docId));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${SLIT_WORKFORCE_COLLECTION}/${docId}`
    );
    throw error;
  }
}
