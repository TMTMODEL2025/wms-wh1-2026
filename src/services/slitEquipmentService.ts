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
  writeBatch,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import type {
  EquipmentItem,
  EquipmentStatus,
  InspectionLog,
} from "../components/EquipmentInspectionView";

export const SLIT_EQUIPMENT_ITEMS_COLLECTION = "slit_equipment_items";
export const SLIT_EQUIPMENT_LOGS_COLLECTION = "slit_equipment_logs";

export const STORAGE_KEY_EQUIPMENT_LIST = "wms_equipment_master_list";
export const STORAGE_KEY_INSPECTION_LOGS = "wms_equipment_inspection_logs";

const VALID_STATUSES: ReadonlySet<EquipmentStatus> = new Set([
  "ready",
  "repair_needed",
  "in_maintenance",
  "out_of_service",
]);

function sanitizeDocId(id: string): string {
  const cleaned = String(id || "")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 128);
  return cleaned || `ID-${Date.now()}`;
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

function normalizeStatus(status: unknown): EquipmentStatus {
  if (typeof status === "string" && VALID_STATUSES.has(status as EquipmentStatus)) {
    return status as EquipmentStatus;
  }
  return "ready";
}

function normalizeShift(shift: unknown): "day" | "night" | undefined {
  if (shift === "day" || shift === "night") return shift;
  return undefined;
}

export function normalizeEquipmentItemPayload(
  item: EquipmentItem
): EquipmentItem & { updatedAt: string } {
  const nowIso = new Date().toISOString();
  const docId = sanitizeDocId(item.id || `EQ-${Date.now()}`);
  const parsedQty = Number(item.quantity);
  const safeQty =
    Number.isFinite(parsedQty) && parsedQty >= 1
      ? Math.min(99999, Math.floor(parsedQty))
      : 1;

  const base: EquipmentItem & { updatedAt: string } = {
    id: docId,
    name: String(item.name || "").trim().slice(0, 128) || "-",
    code: String(item.code || "").trim().toUpperCase().slice(0, 64) || "-",
    area: String(item.area || "").trim().slice(0, 128) || "-",
    quantity: safeQty,
    status: normalizeStatus(item.status),
    createdAt: String(item.createdAt || nowIso).slice(0, 64),
    updatedAt: nowIso,
  };

  if (item.lastInspector !== undefined && String(item.lastInspector).trim() !== "") {
    base.lastInspector = String(item.lastInspector).trim().slice(0, 128);
  }
  if (
    item.lastInspectionDate !== undefined &&
    String(item.lastInspectionDate).trim() !== ""
  ) {
    base.lastInspectionDate = String(item.lastInspectionDate).trim().slice(0, 64);
  }
  const safeShift = normalizeShift(item.lastShift);
  if (safeShift) {
    base.lastShift = safeShift;
  }
  if (item.notes !== undefined) {
    base.notes = String(item.notes).trim().slice(0, 500);
  }

  return stripUndefinedDeep(base);
}

export function normalizeInspectionLogPayload(
  log: InspectionLog
): InspectionLog & { updatedAt: string } {
  const nowIso = new Date().toISOString();
  const docId = sanitizeDocId(log.id || `LOG-${Date.now()}`);
  const safeShift = log.shift === "night" ? "night" : "day";

  const base: InspectionLog & { updatedAt: string } = {
    id: docId,
    equipmentId: sanitizeDocId(log.equipmentId),
    equipmentName: String(log.equipmentName || "").trim().slice(0, 128) || "-",
    equipmentCode: String(log.equipmentCode || "").trim().toUpperCase().slice(0, 64) || "-",
    area: String(log.area || "").trim().slice(0, 128) || "-",
    inspectionDate: String(log.inspectionDate || nowIso.slice(0, 10)).slice(0, 32),
    shift: safeShift,
    status: normalizeStatus(log.status),
    inspector: String(log.inspector || "").trim().slice(0, 128) || "-",
    timestamp: String(log.timestamp || nowIso).slice(0, 64),
    updatedAt: nowIso,
  };

  if (log.remarks !== undefined) {
    base.remarks = String(log.remarks).trim().slice(0, 500);
  }

  return stripUndefinedDeep(base);
}

export function loadCachedEquipmentList(): EquipmentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_EQUIPMENT_LIST);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EquipmentItem[]) : [];
  } catch {
    return [];
  }
}

function saveCachedEquipmentList(items: EquipmentItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_EQUIPMENT_LIST, JSON.stringify(items));
  } catch {
    // ignore storage quota errors
  }
}

export function loadCachedInspectionLogs(): InspectionLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_INSPECTION_LOGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InspectionLog[]) : [];
  } catch {
    return [];
  }
}

function saveCachedInspectionLogs(logs: InspectionLog[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_INSPECTION_LOGS, JSON.stringify(logs));
  } catch {
    // ignore storage quota errors
  }
}

function sortEquipmentDesc(items: EquipmentItem[]): EquipmentItem[] {
  return [...items].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

function sortLogsDesc(logs: InspectionLog[]): InspectionLog[] {
  return [...logs].sort((a, b) =>
    String(b.timestamp || "").localeCompare(String(a.timestamp || ""))
  );
}

let hasMigratedLocalEquipment = false;
let hasMigratedLocalLogs = false;

async function migrateLocalEquipmentToCloud(items: EquipmentItem[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const slice = items.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      slice.forEach((item) => {
        const payload = normalizeEquipmentItemPayload(item);
        batch.set(
          doc(db, SLIT_EQUIPMENT_ITEMS_COLLECTION, payload.id),
          payload,
          { merge: true }
        );
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, SLIT_EQUIPMENT_ITEMS_COLLECTION);
  }
}

async function migrateLocalLogsToCloud(logs: InspectionLog[]): Promise<void> {
  if (logs.length === 0) return;
  try {
    const CHUNK_SIZE = 400;
    for (let i = 0; i < logs.length; i += CHUNK_SIZE) {
      const slice = logs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      slice.forEach((log) => {
        const payload = normalizeInspectionLogPayload(log);
        batch.set(
          doc(db, SLIT_EQUIPMENT_LOGS_COLLECTION, payload.id),
          payload,
          { merge: true }
        );
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, SLIT_EQUIPMENT_LOGS_COLLECTION);
  }
}

/**
 * Subscribe in real-time to the central shared Equipment Inspection master list
 * across all devices and URLs (not scoped to any User ID).
 */
export function subscribeSlitEquipmentItems(
  onUpdate: (items: EquipmentItem[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const colRef = collection(db, SLIT_EQUIPMENT_ITEMS_COLLECTION);

  return onSnapshot(
    colRef,
    (snapshot) => {
      const cloudItems: EquipmentItem[] = snapshot.docs.map((d) => {
        const raw = d.data() as EquipmentItem;
        return {
          ...raw,
          id: raw.id || d.id,
          status: normalizeStatus(raw.status),
          quantity: Number.isFinite(Number(raw.quantity)) ? Number(raw.quantity) : 1,
        };
      });

      // One-time safe migration: if server collection is empty and this browser
      // has legacy localStorage-only items, push them to the central collection.
      if (
        !snapshot.metadata.fromCache &&
        cloudItems.length === 0 &&
        !hasMigratedLocalEquipment
      ) {
        hasMigratedLocalEquipment = true;
        const localLegacy = loadCachedEquipmentList();
        if (localLegacy.length > 0) {
          void migrateLocalEquipmentToCloud(localLegacy);
          onUpdate(sortEquipmentDesc(localLegacy));
          return;
        }
      }

      if (!snapshot.metadata.fromCache) {
        hasMigratedLocalEquipment = true;
      }

      const sorted = sortEquipmentDesc(cloudItems);
      saveCachedEquipmentList(sorted);
      onUpdate(sorted);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, SLIT_EQUIPMENT_ITEMS_COLLECTION);
      if (onError) onError(error);
    }
  );
}

/**
 * Subscribe in real-time to the central shared Equipment Inspection history logs
 * across all devices and URLs (not scoped to any User ID).
 */
export function subscribeSlitEquipmentLogs(
  onUpdate: (logs: InspectionLog[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const colRef = collection(db, SLIT_EQUIPMENT_LOGS_COLLECTION);

  return onSnapshot(
    colRef,
    (snapshot) => {
      const cloudLogs: InspectionLog[] = snapshot.docs.map((d) => {
        const raw = d.data() as InspectionLog;
        return {
          ...raw,
          id: raw.id || d.id,
          status: normalizeStatus(raw.status),
          shift: raw.shift === "night" ? "night" : "day",
        };
      });

      if (
        !snapshot.metadata.fromCache &&
        cloudLogs.length === 0 &&
        !hasMigratedLocalLogs
      ) {
        hasMigratedLocalLogs = true;
        const localLegacy = loadCachedInspectionLogs();
        if (localLegacy.length > 0) {
          void migrateLocalLogsToCloud(localLegacy);
          onUpdate(sortLogsDesc(localLegacy));
          return;
        }
      }

      if (!snapshot.metadata.fromCache) {
        hasMigratedLocalLogs = true;
      }

      const sorted = sortLogsDesc(cloudLogs);
      saveCachedInspectionLogs(sorted);
      onUpdate(sorted);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, SLIT_EQUIPMENT_LOGS_COLLECTION);
      if (onError) onError(error);
    }
  );
}

/**
 * Create or update an equipment item in the central Firestore collection.
 */
export async function saveSlitEquipmentItem(item: EquipmentItem): Promise<EquipmentItem> {
  const payload = normalizeEquipmentItemPayload(item);
  try {
    await setDoc(
      doc(db, SLIT_EQUIPMENT_ITEMS_COLLECTION, payload.id),
      payload,
      { merge: true }
    );
    return payload;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${SLIT_EQUIPMENT_ITEMS_COLLECTION}/${payload.id}`
    );
    throw error;
  }
}

/**
 * Delete an equipment item from the central Firestore collection.
 */
export async function deleteSlitEquipmentItem(id: string): Promise<void> {
  const docId = sanitizeDocId(id);
  try {
    await deleteDoc(doc(db, SLIT_EQUIPMENT_ITEMS_COLLECTION, docId));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${SLIT_EQUIPMENT_ITEMS_COLLECTION}/${docId}`
    );
    throw error;
  }
}

/**
 * Atomically save a daily/shift inspection log and update the parent equipment item
 * in the central Firestore collections so every device sees the change in real-time.
 */
export async function recordSlitEquipmentInspection(
  updatedEquipment: EquipmentItem,
  newLog: InspectionLog
): Promise<{ equipment: EquipmentItem; log: InspectionLog }> {
  const equipmentPayload = normalizeEquipmentItemPayload(updatedEquipment);
  const logPayload = normalizeInspectionLogPayload(newLog);

  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, SLIT_EQUIPMENT_ITEMS_COLLECTION, equipmentPayload.id),
      equipmentPayload,
      { merge: true }
    );
    batch.set(
      doc(db, SLIT_EQUIPMENT_LOGS_COLLECTION, logPayload.id),
      logPayload,
      { merge: true }
    );
    await batch.commit();
    return { equipment: equipmentPayload, log: logPayload };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${SLIT_EQUIPMENT_ITEMS_COLLECTION}/${equipmentPayload.id}`
    );
    throw error;
  }
}
