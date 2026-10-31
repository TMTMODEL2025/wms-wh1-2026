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

  if (r.previousLocation) payload.previousLocation = String(r.previousLocation).slice(0, 64);
  if (r.orderNo) payload.orderNo = String(r.orderNo).slice(0, 64);
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
  if (r.conditionText) payload.conditionText = String(r.conditionText).slice(0, 128);

  return payload;
}

/**
 * Real-time listener for Slit Inbound records
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
 * Real-time listener for Slit Outbound records
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
 * Real-time listener for Slit Pick Lists
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

/**
 * Save pick list order to Firestore
 */
export async function savePickListToCloud(order: PickListOrder): Promise<void> {
  const docId = sanitizeDocId(order.id || `ORD-${order.orderNo}`);
  const payload = {
    ...order,
    id: docId,
    updatedAt: new Date().toISOString(),
  };
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
    const payload = {
      ...order,
      id: docId,
      updatedAt: new Date().toISOString(),
    };
    batch.set(doc(db, PICKLIST_COLLECTION, docId), payload, { merge: true });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, PICKLIST_COLLECTION);
  }
}

/**
 * Delete pick list order from Firestore
 */
export async function deletePickListFromCloud(orderIdOrNo: string): Promise<void> {
  const docId = sanitizeDocId(orderIdOrNo.startsWith("ORD-") ? orderIdOrNo : `ORD-${orderIdOrNo}`);
  try {
    await deleteDoc(doc(db, PICKLIST_COLLECTION, docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${PICKLIST_COLLECTION}/${docId}`);
  }
}

/**
 * Initial sync / migration helper: If Firestore is empty and local data exists, seed to Firestore
 */
export async function syncLocalDataToFirestoreIfEmpty(
  localInbound: SlitBarcodeRecord[],
  localOutbound: SlitBarcodeRecord[],
  localPickLists?: PickListOrder[]
): Promise<void> {
  try {
    const inboundSnap = await getDocs(collection(db, INBOUND_COLLECTION));
    if (inboundSnap.empty && localInbound.length > 0) {
      await batchSaveInboundToCloud(localInbound);
    }

    const outboundSnap = await getDocs(collection(db, OUTBOUND_COLLECTION));
    if (outboundSnap.empty && localOutbound.length > 0) {
      await batchSaveOutboundToCloud(localOutbound);
    }

    if (localPickLists && localPickLists.length > 0) {
      const pickListSnap = await getDocs(collection(db, PICKLIST_COLLECTION));
      if (pickListSnap.empty) {
        await batchSavePickListsToCloud(localPickLists);
      }
    }
  } catch {
    // If offline or permission check, ignore initial seed
  }
}
