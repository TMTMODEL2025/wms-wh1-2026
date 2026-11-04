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
import type { SlitBarcodeRecord, PickListOrder, SapMasterItem } from "../components/SlitFilmManagement";
import type { MasterBuildingLayout } from "../data/masterBasketStorage";
import type { MachineStagingConfig } from "../data/machineStagingStorage";

const INBOUND_COLLECTION = "slit_inbound";
const OUTBOUND_COLLECTION = "slit_outbound";
const PICKLIST_COLLECTION = "slit_picklists";
export const SAP_CHUNKS_COLLECTION = "slit_sap_chunks";
export const SAP_CHUNK_SIZE = 800;
export const SPACE_CONFIG_COLLECTION = "slit_space_config";
export const SPACE_CONFIG_DOC_ID = "warehouse_space_state";
export const MACHINE_STAGING_DOC_ID = "machine_staging_state";

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
 * Sanitize a single SAP Master Item so it is compact and safe for Firestore storage
 */
function sanitizeSapMasterItem(item: SapMasterItem): SapMasterItem {
  const safeWeight =
    typeof item.weightKg === "number" && !isNaN(item.weightKg) && item.weightKg >= 0 && item.weightKg <= 100000
      ? item.weightKg
      : 0;
  return {
    batch: String(item.batch || "").trim().toUpperCase().slice(0, 32),
    salesDoc: String(item.salesDoc || "").trim().slice(0, 64),
    materialNo: String(item.materialNo || "").trim().slice(0, 64),
    certThickness: String(item.certThickness || "").trim().slice(0, 32),
    storageLocation: String(item.storageLocation || "").trim().slice(0, 64),
    targetThickness: String(item.targetThickness || "").trim().slice(0, 32),
    width: String(item.width || "").trim().slice(0, 32),
    weightKg: safeWeight,
    unrestricted: String(item.unrestricted || `${safeWeight.toLocaleString()} kg`).trim().slice(0, 64),
    qualityClass: String(item.qualityClass || "").trim().slice(0, 32),
    grade: String(item.grade || "").trim().slice(0, 64),
    manufacturer: String(item.manufacturer || "").trim().slice(0, 64),
    description: String(item.description || "").trim().slice(0, 256),
    coilNo: String(item.coilNo || "").trim().slice(0, 64),
    conditionText: String(item.conditionText || "").trim().slice(0, 128),
  };
}

export interface SlitSapChunkDoc {
  id: string;
  chunkIndex: number;
  totalChunks: number;
  totalItems: number;
  itemCount: number;
  items: SapMasterItem[];
  updatedAt: string;
}

/**
 * Real-time listener for bundled SAP Master Data chunks (800 items per document)
 * 3,000+ SAP rows require only 4 document reads per sync!
 */
export function subscribeToSlitSapMaster(
  onData: (items: SapMasterItem[], chunkCount: number) => void,
  onError?: (err: unknown) => void
): () => void {
  const colRef = collection(db, SAP_CHUNKS_COLLECTION);
  return onSnapshot(
    colRef,
    (snapshot) => {
      const chunks: SlitSapChunkDoc[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as SlitSapChunkDoc;
        if (data && Array.isArray(data.items)) {
          chunks.push(data);
        }
      });
      chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
      const allItems: SapMasterItem[] = [];
      for (const ch of chunks) {
        for (const itm of ch.items) {
          if (itm && itm.batch) {
            allItems.push(itm);
          }
        }
      }
      onData(allItems, chunks.length);
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, SAP_CHUNKS_COLLECTION);
    }
  );
}

/**
 * Bundle SAP Master Data into chunks of 800 items per document and commit to Firestore.
 * For 3,000+ items, this uses only 4 document writes instead of 3,000!
 */
export async function saveSapMasterChunksToCloud(
  items: SapMasterItem[]
): Promise<{ chunkCount: number; itemCount: number }> {
  // Deduplicate by uppercase batch and sanitize
  const dedupMap = new Map<string, SapMasterItem>();
  for (const raw of items) {
    if (!raw || !raw.batch) continue;
    const cleaned = sanitizeSapMasterItem(raw);
    if (cleaned.batch) {
      dedupMap.set(cleaned.batch, cleaned);
    }
  }
  const cleanItems = Array.from(dedupMap.values());
  const totalItems = cleanItems.length;
  const totalChunks = totalItems === 0 ? 0 : Math.ceil(totalItems / SAP_CHUNK_SIZE);
  const nowIso = new Date().toISOString();

  try {
    const existingSnap = await getDocs(collection(db, SAP_CHUNKS_COLLECTION));
    const newChunkIds = new Set<string>();
    const batch = writeBatch(db);

    for (let idx = 0; idx < totalChunks; idx++) {
      const slice = cleanItems.slice(idx * SAP_CHUNK_SIZE, (idx + 1) * SAP_CHUNK_SIZE);
      const docId = `SAP_CHUNK_${String(idx + 1).padStart(4, "0")}`;
      newChunkIds.add(docId);

      const chunkPayload: SlitSapChunkDoc = {
        id: docId,
        chunkIndex: idx,
        totalChunks,
        totalItems,
        itemCount: slice.length,
        items: slice,
        updatedAt: nowIso,
      };
      batch.set(doc(db, SAP_CHUNKS_COLLECTION, docId), stripUndefinedDeep(chunkPayload));
    }

    // Remove any obsolete chunk documents if the new dataset has fewer chunks
    existingSnap.forEach((d) => {
      if (!newChunkIds.has(d.id)) {
        batch.delete(d.ref);
      }
    });

    await batch.commit();
    return { chunkCount: totalChunks, itemCount: totalItems };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, SAP_CHUNKS_COLLECTION);
    return { chunkCount: 0, itemCount: 0 };
  }
}

/**
 * Clear all SAP Master Data chunks from Cloud Firestore
 */
export async function clearSapMasterChunksFromCloud(): Promise<void> {
  try {
    const snap = await getDocs(collection(db, SAP_CHUNKS_COLLECTION));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, SAP_CHUNKS_COLLECTION);
  }
}

export interface SlitWarehouseSpaceSummaryBuilding {
  buildingId: "H" | "F" | "E9" | "E10" | "I";
  buildingNameTh: string;
  maxCapacityTons: number;
  usedSpaceTons: number;
  remainingSpaceTons: number;
  totalBaskets: number;
  usedBaskets: number;
  totalCoils: number;
  percent: number;
  spaceUsagePercent: number;
}

export interface SlitWarehouseSpaceSummarySnapshot {
  totalMaxCapacityTons: number;
  totalUsedSpaceTons: number;
  totalRemainingSpaceTons: number;
  totalBaskets: number;
  totalUsedBaskets: number;
  totalCoils: number;
  basketPercent: number;
  spacePercent: number;
  buildings: SlitWarehouseSpaceSummaryBuilding[];
}

export interface SlitWarehouseSpaceCloudDoc {
  id: string;
  buildingMaxCapacityTons?: Record<"H" | "F" | "E9" | "E10" | "I", number>;
  masterLayout?: MasterBuildingLayout[];
  statusOverrides?: Record<string, { status: string; notes?: string; lastUpdated?: string }>;
  summarySnapshot?: SlitWarehouseSpaceSummarySnapshot;
  updatedAt: string;
}

const LOCAL_CAP_STORAGE_KEY = "tmt_wms_building_max_capacity_tons_v1";
const LOCAL_CAP_UPDATED_AT_KEY = "tmt_wms_building_max_capacity_updated_at_v1";

let isFirestoreSpaceWriteExhausted = false;

/**
 * Real-time listener for Slit Warehouse Space Configuration & Summary Metrics
 * (buildingMaxCapacityTons, masterLayout, statusOverrides, summarySnapshot)
 * Combines Express real-time API/SSE (/api/space-config) + Cloud Firestore with timestamp conflict resolution
 */
export function subscribeToSlitSpaceConfig(
  onData: (config: SlitWarehouseSpaceCloudDoc | null) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  let latestUpdatedAt = "";
  let latestDoc: SlitWarehouseSpaceCloudDoc | null = null;
  let apiResponded = false;
  let firestoreResponded = false;

  const mergeWithNewerLocalCapacity = (
    docData: SlitWarehouseSpaceCloudDoc
  ): { mergedDoc: SlitWarehouseSpaceCloudDoc; localWasNewer: boolean } => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const localCapUpdatedAt = window.localStorage.getItem(LOCAL_CAP_UPDATED_AT_KEY) || "";
        const localCapRaw = window.localStorage.getItem(LOCAL_CAP_STORAGE_KEY);
        const docUpdatedAt = docData.updatedAt || "";

        if (localCapRaw && localCapUpdatedAt && localCapUpdatedAt > docUpdatedAt) {
          const parsedLocalCap = JSON.parse(localCapRaw);
          if (parsedLocalCap && typeof parsedLocalCap === "object") {
            return {
              mergedDoc: {
                ...docData,
                buildingMaxCapacityTons: {
                  ...(docData.buildingMaxCapacityTons || {}),
                  ...parsedLocalCap,
                },
                updatedAt: localCapUpdatedAt,
              },
              localWasNewer: true,
            };
          }
        }
      }
    } catch {
      // ignore localStorage read error
    }
    return { mergedDoc: docData, localWasNewer: false };
  };

  const handleIncomingDoc = (
    rawDoc: SlitWarehouseSpaceCloudDoc | null,
    source: "api" | "firestore"
  ) => {
    if (isDisposed) return;

    if (source === "api") apiResponded = true;
    if (source === "firestore") firestoreResponded = true;

    if (!rawDoc) {
      if (latestDoc === null && apiResponded && firestoreResponded) {
        onData(null);
      }
      return;
    }

    const { mergedDoc, localWasNewer } = mergeWithNewerLocalCapacity(rawDoc);
    const incomingTs = mergedDoc.updatedAt || "";

    // Seed server state if Firestore had data that server hasn't received yet or if local was newer
    if (source === "firestore" || localWasNewer) {
      fetch("/api/space-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...mergedDoc,
          seedOnly: !localWasNewer,
        }),
      }).catch(() => {});
    }

    if (latestDoc && latestUpdatedAt && incomingTs && incomingTs < latestUpdatedAt) {
      // Ignore stale snapshot (e.g. older Firestore state when server/local already has newer state)
      return;
    }

    latestDoc = {
      ...(latestDoc || {}),
      ...mergedDoc,
      buildingMaxCapacityTons: {
        ...(latestDoc?.buildingMaxCapacityTons || {}),
        ...(mergedDoc.buildingMaxCapacityTons || {}),
      },
    };
    if (incomingTs > latestUpdatedAt) {
      latestUpdatedAt = incomingTs;
    }

    onData(latestDoc);
  };

  // 1. Initial fetch from /api/space-config
  if (typeof window !== "undefined") {
    fetch("/api/space-config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.warehouseSpaceConfig) {
          handleIncomingDoc(json.warehouseSpaceConfig as SlitWarehouseSpaceCloudDoc, "api");
        } else {
          handleIncomingDoc(null, "api");
        }
      })
      .catch(() => {
        apiResponded = true;
      });
  }

  // 2. Real-time Server-Sent Events (SSE) subscription + lightweight polling fallback
  let eventSource: EventSource | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  if (typeof window !== "undefined" && typeof EventSource !== "undefined") {
    try {
      eventSource = new EventSource("/api/space-config/stream");
      eventSource.addEventListener("warehouse_space_state", (evt: MessageEvent) => {
        try {
          const parsed = JSON.parse(evt.data) as SlitWarehouseSpaceCloudDoc;
          handleIncomingDoc(parsed, "api");
        } catch {
          // ignore malformed SSE event
        }
      });
    } catch {
      // ignore SSE error
    }

    pollInterval = setInterval(() => {
      if (isDisposed) return;
      fetch("/api/space-config", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.warehouseSpaceConfig) {
            handleIncomingDoc(json.warehouseSpaceConfig as SlitWarehouseSpaceCloudDoc, "api");
          }
        })
        .catch(() => {});
    }, 4000);
  }

  // 3. Firestore real-time listener
  const docRef = doc(db, SPACE_CONFIG_COLLECTION, SPACE_CONFIG_DOC_ID);
  const unsubFirestore = onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        if (snapshot.metadata.fromCache) {
          return;
        }
        handleIncomingDoc(null, "firestore");
        return;
      }
      handleIncomingDoc(snapshot.data() as SlitWarehouseSpaceCloudDoc, "firestore");
    },
    (error) => {
      firestoreResponded = true;
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, `${SPACE_CONFIG_COLLECTION}/${SPACE_CONFIG_DOC_ID}`);
    }
  );

  return () => {
    isDisposed = true;
    unsubFirestore();
    if (eventSource) {
      eventSource.close();
    }
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  };
}

/**
 * Save or merge Slit Warehouse Space Configuration & Summary Metrics to Server API + Cloud Firestore
 */
export async function saveSlitSpaceConfigToCloud(
  partial: Partial<Omit<SlitWarehouseSpaceCloudDoc, "id" | "updatedAt">>
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload = stripUndefinedDeep({
    id: SPACE_CONFIG_DOC_ID,
    ...partial,
    updatedAt: nowIso,
  });

  if (partial.buildingMaxCapacityTons && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_CAP_UPDATED_AT_KEY, nowIso);
    } catch {
      // ignore
    }
  }

  // 1. Always persist immediately to backend /api/space-config (fast & immune to Firestore daily write quota)
  if (typeof window !== "undefined") {
    try {
      await fetch("/api/space-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn("Failed to post space-config to server API:", err);
    }
  }

  // 2. Also sync to Cloud Firestore if daily write quota is not exhausted
  if (isFirestoreSpaceWriteExhausted) {
    return;
  }

  try {
    const writePromise = setDoc(
      doc(db, SPACE_CONFIG_COLLECTION, SPACE_CONFIG_DOC_ID),
      payload,
      { merge: true }
    );
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 2500)
    );
    const result = await Promise.race([writePromise, timeoutPromise]);
    if (result === "timeout") {
      // Firestore SDK is backing off due to quota exhaustion or offline state
      isFirestoreSpaceWriteExhausted = true;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("resource-exhausted") || errMsg.includes("RESOURCE_EXHAUSTED")) {
      isFirestoreSpaceWriteExhausted = true;
    }
    handleFirestoreError(error, OperationType.WRITE, `${SPACE_CONFIG_COLLECTION}/${SPACE_CONFIG_DOC_ID}`);
  }
}

export interface SlitMachineStagingGroupSummary {
  totalMachines: number;
  totalRacks: number;
  totalCapacityMeters: number;
  totalCapacityTons: number;
  usedRacks: number;
  occupiedRacks: number;
  fullRacks: number;
  usedMeters: number;
  usedTons: number;
  availableRacks: number;
  availableMeters: number;
  availableTons: number;
  maintenanceRacks: number;
  maintenanceMeters: number;
  maintenanceTons: number;
  usagePercent: number;
}

export interface SlitMachineStagingSummarySnapshot {
  all: SlitMachineStagingGroupSummary;
  tm: SlitMachineStagingGroupSummary;
  cf: SlitMachineStagingGroupSummary;
}

export interface SlitMachineStagingCloudDoc {
  id: string;
  machines: MachineStagingConfig[];
  summarySnapshot?: SlitMachineStagingSummarySnapshot;
  productionStatus?: Record<
    string,
    {
      waitingMoveInActive: boolean;
      waitingMoveInCoils: number;
      waitingSlitActive: boolean;
      waitingSlitCoils: number;
    }
  >;
  updatedAt: string;
}

/**
 * Real-time listener for Machine Staging Area (TM 1-14 / CF 1, 2, 4, 5) in Server API + Cloud Firestore
 */
export function subscribeToSlitMachineStaging(
  onData: (docData: SlitMachineStagingCloudDoc | null) => void,
  onError?: (err: unknown) => void
): () => void {
  let isDisposed = false;
  let latestUpdatedAt = "";
  let latestDoc: SlitMachineStagingCloudDoc | null = null;
  let apiResponded = false;
  let firestoreResponded = false;

  const handleIncomingDoc = (
    rawDoc: SlitMachineStagingCloudDoc | null,
    source: "api" | "firestore"
  ) => {
    if (isDisposed) return;
    if (source === "api") apiResponded = true;
    if (source === "firestore") firestoreResponded = true;

    if (!rawDoc) {
      if (latestDoc === null && apiResponded && firestoreResponded) {
        onData(null);
      }
      return;
    }

    const incomingTs = rawDoc.updatedAt || "";
    if (source === "firestore") {
      fetch("/api/machine-staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rawDoc, seedOnly: true }),
      }).catch(() => {});
    }

    if (latestDoc && latestUpdatedAt && incomingTs && incomingTs < latestUpdatedAt) {
      return;
    }

    latestDoc = { ...(latestDoc || {}), ...rawDoc };
    if (incomingTs > latestUpdatedAt) {
      latestUpdatedAt = incomingTs;
    }
    onData(latestDoc);
  };

  if (typeof window !== "undefined") {
    fetch("/api/space-config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.machineStagingConfig) {
          handleIncomingDoc(json.machineStagingConfig as SlitMachineStagingCloudDoc, "api");
        } else {
          handleIncomingDoc(null, "api");
        }
      })
      .catch(() => {
        apiResponded = true;
      });
  }

  let eventSource: EventSource | null = null;
  if (typeof window !== "undefined" && typeof EventSource !== "undefined") {
    try {
      eventSource = new EventSource("/api/space-config/stream");
      eventSource.addEventListener("machine_staging_state", (evt: MessageEvent) => {
        try {
          const parsed = JSON.parse(evt.data) as SlitMachineStagingCloudDoc;
          handleIncomingDoc(parsed, "api");
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }

  const docRef = doc(db, SPACE_CONFIG_COLLECTION, MACHINE_STAGING_DOC_ID);
  const unsubFirestore = onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        if (snapshot.metadata.fromCache) {
          return;
        }
        handleIncomingDoc(null, "firestore");
        return;
      }
      handleIncomingDoc(snapshot.data() as SlitMachineStagingCloudDoc, "firestore");
    },
    (error) => {
      firestoreResponded = true;
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, `${SPACE_CONFIG_COLLECTION}/${MACHINE_STAGING_DOC_ID}`);
    }
  );

  return () => {
    isDisposed = true;
    unsubFirestore();
    if (eventSource) {
      eventSource.close();
    }
  };
}

/**
 * Save or merge Machine Staging Area (TM 1-14 / CF 1, 2, 4, 5) state and summary snapshot to Server API + Cloud Firestore
 */
export async function saveSlitMachineStagingToCloud(
  partial: Partial<Omit<SlitMachineStagingCloudDoc, "id" | "updatedAt">>
): Promise<void> {
  const payload = stripUndefinedDeep({
    id: MACHINE_STAGING_DOC_ID,
    ...partial,
    updatedAt: new Date().toISOString(),
  });

  if (typeof window !== "undefined") {
    try {
      await fetch("/api/machine-staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn("Failed to post machine-staging to server API:", err);
    }
  }

  if (isFirestoreSpaceWriteExhausted) {
    return;
  }

  try {
    const writePromise = setDoc(
      doc(db, SPACE_CONFIG_COLLECTION, MACHINE_STAGING_DOC_ID),
      payload,
      { merge: true }
    );
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 2500)
    );
    const result = await Promise.race([writePromise, timeoutPromise]);
    if (result === "timeout") {
      isFirestoreSpaceWriteExhausted = true;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("resource-exhausted") || errMsg.includes("RESOURCE_EXHAUSTED")) {
      isFirestoreSpaceWriteExhausted = true;
    }
    handleFirestoreError(error, OperationType.WRITE, `${SPACE_CONFIG_COLLECTION}/${MACHINE_STAGING_DOC_ID}`);
  }
}

/**
 * Clear all documents in slit_picklists, slit_outbound, slit_inbound, slit_sap_chunks, and slit_space_config on full reset
 */
export async function clearAllSlitDataFromCloud(): Promise<void> {
  clearLegacySlitLocalStorage();
  try {
    const [pickSnap, outSnap, inSnap, sapSnap, spaceSnap] = await Promise.all([
      getDocs(collection(db, PICKLIST_COLLECTION)),
      getDocs(collection(db, OUTBOUND_COLLECTION)),
      getDocs(collection(db, INBOUND_COLLECTION)),
      getDocs(collection(db, SAP_CHUNKS_COLLECTION)),
      getDocs(collection(db, SPACE_CONFIG_COLLECTION)),
    ]);

    const allRefs = [
      ...pickSnap.docs.map((d) => d.ref),
      ...outSnap.docs.map((d) => d.ref),
      ...inSnap.docs.map((d) => d.ref),
      ...sapSnap.docs.map((d) => d.ref),
      ...spaceSnap.docs.map((d) => d.ref),
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
