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
import { SlitBarcodeRecord, PickListOrder } from "../components/SlitFilmManagement";

const INBOUND_COLLECTION = "slit_inbound";
const OUTBOUND_COLLECTION = "slit_outbound";
const PICKLIST_COLLECTION = "slit_picklists";

function sanitizeDocId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 128);
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
 * Clear all legacy localStorage keys for Slit Film Management so only Firebase Firestore is used.
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
 * Real-time listener for Slit Inbound records (100% Cloud Firestore Single Source of Truth)
 */
export function subscribeToSlitInbound(
  onData: (records: SlitBarcodeRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const colRef = collection(db, INBOUND_COLLECTION);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const records: SlitBarcodeRecord[] = [];
      snapshot.forEach((d) => {
        records.push(d.data() as SlitBarcodeRecord);
      });
      // Sort newest scan first
      records.sort((a, b) => (b.scanTimestamp || "").localeCompare(a.scanTimestamp || ""));
      onData(records);
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, INBOUND_COLLECTION);
    }
  );
}

/**
 * Real-time listener for Slit Outbound records (100% Cloud Firestore Single Source of Truth)
 */
export function subscribeToSlitOutbound(
  onData: (records: SlitBarcodeRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const colRef = collection(db, OUTBOUND_COLLECTION);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const records: SlitBarcodeRecord[] = [];
      snapshot.forEach((d) => {
        records.push(d.data() as SlitBarcodeRecord);
      });
      records.sort((a, b) => (b.scanTimestamp || "").localeCompare(a.scanTimestamp || ""));
      onData(records);
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, OUTBOUND_COLLECTION);
    }
  );
}

/**
 * Real-time listener for Slit Pick Lists (100% Cloud Firestore Single Source of Truth)
 */
export function subscribeToSlitPickLists(
  onData: (orders: PickListOrder[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const colRef = collection(db, PICKLIST_COLLECTION);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const orders: PickListOrder[] = [];
      snapshot.forEach((d) => {
        orders.push(d.data() as PickListOrder);
      });
      orders.sort((a, b) => {
        const timeA = `${a.createdDate || ""} ${a.createdAt || ""}`;
        const timeB = `${b.createdDate || ""} ${b.createdAt || ""}`;
        return timeB.localeCompare(timeA);
      });
      onData(orders);
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, PICKLIST_COLLECTION);
    }
  );
}

/**
 * Save single inbound record to Firestore
 */
export async function saveInboundRecordToCloud(record: SlitBarcodeRecord): Promise<void> {
  const docId = sanitizeDocId(record.id || `IN-${record.batch}-${Date.now()}`);
  const payload = sanitizeRecordPayload({ ...record, id: docId });
  try {
    await setDoc(doc(db, INBOUND_COLLECTION, docId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${INBOUND_COLLECTION}/${docId}`);
  }
}

/**
 * Save single outbound record to Firestore
 */
export async function saveOutboundRecordToCloud(record: SlitBarcodeRecord): Promise<void> {
  const docId = sanitizeDocId(record.id || `OUT-${record.batch}-${Date.now()}`);
  const payload = sanitizeRecordPayload({ ...record, id: docId, mode: "outbound" });
  try {
    await setDoc(doc(db, OUTBOUND_COLLECTION, docId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${OUTBOUND_COLLECTION}/${docId}`);
  }
}

/**
 * Batch save multiple inbound records to Firestore
 */
export async function batchSaveInboundToCloud(records: SlitBarcodeRecord[]): Promise<void> {
  if (records.length === 0) return;
  const batch = writeBatch(db);
  for (const r of records) {
    const docId = sanitizeDocId(r.id || `IN-${r.batch}-${Date.now()}`);
    const payload = sanitizeRecordPayload({ ...r, id: docId });
    batch.set(doc(db, INBOUND_COLLECTION, docId), payload, { merge: true });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, INBOUND_COLLECTION);
  }
}

/**
 * Batch save multiple outbound records to Firestore
 */
export async function batchSaveOutboundToCloud(records: SlitBarcodeRecord[]): Promise<void> {
  if (records.length === 0) return;
  const batch = writeBatch(db);
  for (const r of records) {
    const docId = sanitizeDocId(r.id || `OUT-${r.batch}-${Date.now()}`);
    const payload = sanitizeRecordPayload({ ...r, id: docId, mode: "outbound" });
    batch.set(doc(db, OUTBOUND_COLLECTION, docId), payload, { merge: true });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, OUTBOUND_COLLECTION);
  }
}

/**
 * Delete a record from Firestore
 */
export async function deleteRecordFromCloud(collectionName: "slit_inbound" | "slit_outbound", id: string): Promise<void> {
  const docId = sanitizeDocId(id);
  try {
    await deleteDoc(doc(db, collectionName, docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${docId}`);
  }
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
 * Save pick list order to Firestore
 */
export async function savePickListToCloud(order: PickListOrder): Promise<void> {
  const docId = sanitizeDocId(order.id || `ORD-${order.orderNo}`);
  const payload = sanitizePickListOrderPayload(order);
  try {
    await setDoc(doc(db, PICKLIST_COLLECTION, docId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${PICKLIST_COLLECTION}/${docId}`);
  }
}

/**
 * Batch save multiple pick list orders to Firestore
 */
export async function batchSavePickListsToCloud(orders: PickListOrder[]): Promise<void> {
  if (orders.length === 0) return;
  const batch = writeBatch(db);
  for (const order of orders) {
    const docId = sanitizeDocId(order.id || `ORD-${order.orderNo}`);
    const payload = sanitizePickListOrderPayload(order);
    batch.set(doc(db, PICKLIST_COLLECTION, docId), payload, { merge: true });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, PICKLIST_COLLECTION);
  }
}

/**
 * Delete pick list order from Firestore (removes by docId and any matching orderNo document)
 */
export async function deletePickListFromCloud(orderIdOrNo: string): Promise<void> {
  const trimmed = orderIdOrNo.trim();
  const rawOrderNo = trimmed.startsWith("ORD-") ? trimmed.slice(4) : trimmed;
  const primaryDocId = sanitizeDocId(trimmed.startsWith("ORD-") ? trimmed : `ORD-${trimmed}`);
  try {
    await deleteDoc(doc(db, PICKLIST_COLLECTION, primaryDocId));
    // Also clean up any document in slit_picklists with matching orderNo or id
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
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${PICKLIST_COLLECTION}/${primaryDocId}`);
  }
}

/**
 * Delete outbound records linked to a deleted Pick List Order (by orderNo or batch list)
 */
export async function deleteOutboundByOrderOrBatchesFromCloud(
  orderNo: string,
  batches: string[]
): Promise<void> {
  const cleanOrderNo = orderNo.trim().toUpperCase();
  const batchSet = new Set(batches.map((b) => b.trim().toUpperCase()).filter(Boolean));
  if (!cleanOrderNo && batchSet.size === 0) return;

  try {
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
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, OUTBOUND_COLLECTION);
  }
}

/**
 * Delete inbound records by batch list from Firestore
 */
export async function deleteInboundByBatchesFromCloud(batches: string[]): Promise<void> {
  const batchSet = new Set(batches.map((b) => b.trim().toUpperCase()).filter(Boolean));
  if (batchSet.size === 0) return;

  try {
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
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, INBOUND_COLLECTION);
  }
}

/**
 * Clear all documents in slit_picklists, slit_outbound, and slit_inbound on full reset
 */
export async function clearAllSlitDataFromCloud(): Promise<void> {
  clearLegacySlitLocalStorage();
  try {
    const [pickSnap, outSnap, inSnap] = await Promise.all([
      getDocs(collection(db, PICKLIST_COLLECTION)),
      getDocs(collection(db, OUTBOUND_COLLECTION)),
      getDocs(collection(db, INBOUND_COLLECTION)),
    ]);

    const allRefs = [
      ...pickSnap.docs.map((d) => d.ref),
      ...outSnap.docs.map((d) => d.ref),
      ...inSnap.docs.map((d) => d.ref),
    ];

    // Commit in chunks of 400 to respect Firestore 500-op batch limit
    for (let i = 0; i < allRefs.length; i += 400) {
      const chunk = allRefs.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, PICKLIST_COLLECTION);
  }
}

/**
 * Legacy auto-migration is disabled: clears legacy localStorage keys and relies 100% on Firestore.
 */
export async function syncLocalDataToFirestoreIfEmpty(
  _localInbound?: SlitBarcodeRecord[],
  _localOutbound?: SlitBarcodeRecord[],
  _localPickLists?: PickListOrder[]
): Promise<void> {
  clearLegacySlitLocalStorage();
}



