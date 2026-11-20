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
import { db, handleFirestoreError, OperationType } from "./firebase";
import { getActiveRecorderDisplay } from "./authWorkforceService";
import { formatNowTimestamp } from "./coilDataService";

// ============================================================================
// Dedicated Firestore Collections for RM Steel Sheet (เหล็กแผ่น RM)
// ============================================================================
export const RM_STOCK_COLLECTION = "rm_stock";
export const RM_TRANSACTIONS_COLLECTION = "rm_transactions";
export const RM_STAGING_COLLECTION = "rm_staging";
export const RM_LAYOUTS_COLLECTION = "rm_layouts";
export const RM_SAP_CHUNKS_COLLECTION = "rm_sap_chunks";

export type RmModeTab =
  | "inbound"
  | "outbound"
  | "operator_receive"
  | "relocate_layout"
  | "stock_balance"
  | "return_warehouse"
  | "daily_report";

export type RmInboundCategory = "internal" | "external";
export type RmInternalSubMode = "batch" | "bundle";
export type RmStatus = "available" | "staged" | "issued";
export type RmSapBatchCategory = "Batch" | "VM" | "AB" | "STL" | "ฝาก";
export type RmSapCategory = RmSapBatchCategory | "Bundle";

export const RM_INTERNAL_MACHINES = ["CL03", "CL04", "CL05", "CL06"] as const;
export const RM_SAP_BATCH_CATEGORIES: RmSapBatchCategory[] = [
  "Batch",
  "VM",
  "AB",
  "STL",
  "ฝาก",
];

export interface RmStockRecord {
  id: string;
  inboundType: RmInboundCategory; // "internal" | "external"
  internalSubMode: RmInternalSubMode; // "batch" | "bundle"
  sapCategory?: RmSapCategory; // "Batch" | "VM" | "AB" | "STL" | "ฝาก" | "Bundle"
  machine: string; // "CL03" | "CL04" | "CL05" | "CL06" | "EXTERNAL"
  location: string; // พื้นที่จัดเก็บที่พิมพ์หรือสแกนหน้างาน
  previousLocation?: string;
  storageLocation: string; // Storage Location จาก SAP (เช่น 1101, 1201)
  materialNo: string; // Material No.
  description: string; // Description / Material Description
  batch: string; // รหัส Batch (ไม่จำกัดจำนวนหลัก)
  batchHu: string; // รหัส BAHCH HU / BATCH HU สำหรับโหมดรับภายใน Bundle (ไม่จำกัดจำนวนหลัก)
  certThickness: string; // หนา Certificated.
  width: string; // กว้าง
  length: string; // ยาว
  grade: string; // Grade
  unrestricted: string; // Unrestr.
  weightKg: number; // น้ำหนักรับเข้า (KG)
  initialWeightKg: number;
  inboundQty: number; // จำนวนรับเข้า (แผ่น / มัด)
  manufacturer: string; // ผู้ผลิต
  salesDocument?: string; // Sales Document
  salesItem?: string; // Item (เช่น 0)
  conditionText?: string; // Text สภาพสินค้า
  status: RmStatus;
  orderNo?: string;
  stagedOrderNo?: string;
  stagedMachineId?: string;
  stagedAt?: string;
  issuedOrderNo?: string;
  issuedMachineId?: string;
  issuedAt?: string;
  hasSapData?: boolean;
  remark?: string;
  scanTimestamp: string;
  updatedAt: string;
}

export interface RmTransactionRecord {
  id: string;
  txType: "inbound" | "staging" | "issue" | "relocate" | "return" | "adjust";
  inboundType?: RmInboundCategory;
  internalSubMode?: RmInternalSubMode;
  batch: string;
  batchHu?: string;
  materialNo?: string;
  description?: string;
  weightKg: number;
  inboundQty?: number;
  fromLocation: string;
  toLocation: string;
  machineId?: string;
  orderNo?: string;
  grade?: string;
  thickness?: string;
  width?: string;
  length?: string;
  manufacturer?: string;
  operator?: string;
  remark?: string;
  timestamp: string;
  dateYmd: string;
  updatedAt: string;
}

export interface RmStagingItem {
  id: string;
  batch: string;
  batchHu?: string;
  materialNo?: string;
  description?: string;
  grade: string;
  thickness: string;
  width: string;
  length: string;
  weightKg: number;
  inboundQty?: number;
  sourceLocation: string;
  storageLocation?: string;
  status: "pending" | "staged" | "issued";
  stagedAt?: string;
  issuedAt?: string;
  bomItem?: string;
  unit?: string;
  isTemporary?: boolean;
  tempOrderRef?: string;
}

export interface RmStagingOrder {
  id: string;
  orderNo: string;
  machineId: string;
  createdDate: string;
  createdAt: string;
  status: "pending" | "in_progress" | "completed";
  items: RmStagingItem[];
  isTemporary?: boolean;
  matchedOrderNo?: string;
  operatorDismissed?: boolean;
  updatedAt: string;
}

export interface RmLayoutZone {
  id: string;
  bayCode: string;
  zoneName: string;
  maxCapacityTons: number;
  maxBundles: number;
  description?: string;
  updatedAt: string;
}

export interface RmSapMasterItem {
  sapType?: "batch" | "bundle";
  sapCategory?: RmSapCategory;
  storageLocation: string;
  materialNo: string;
  description: string;
  batch: string;
  batchHu?: string;
  certThickness: string;
  width: string;
  length: string;
  grade: string;
  unrestricted: string;
  weightKg: number;
  inboundQty: number;
  manufacturer: string;
  salesDocument?: string;
  salesItem?: string;
  conditionText?: string;
}

export const RM_SAP_CHUNK_SIZE = 800;

export const DEFAULT_RM_LAYOUT_ZONES: RmLayoutZone[] = [
  {
    id: "RM-LAYOUT-E7-A01",
    bayCode: "E7/A01",
    zoneName: "โซนเหล็กแผ่น RM อาคาร E7 แถว A01 (CL03-CL04)",
    maxCapacityTons: 300,
    maxBundles: 120,
    description: "พื้นที่จัดเก็บเหล็กแผ่นตัดจากเครื่อง CL03 และ CL04",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "RM-LAYOUT-E7-A02",
    bayCode: "E7/A02",
    zoneName: "โซนเหล็กแผ่น RM อาคาร E7 แถว A02 (CL05-CL06)",
    maxCapacityTons: 300,
    maxBundles: 120,
    description: "พื้นที่จัดเก็บเหล็กแผ่นตัดจากเครื่อง CL05 และ CL06",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "RM-LAYOUT-E8-B01",
    bayCode: "E8/B01",
    zoneName: "โซนเหล็กแผ่น RM อาคาร E8 แถว B01 (Bundle / HU)",
    maxCapacityTons: 350,
    maxBundles: 150,
    description: "พื้นที่จัดเก็บมัดเหล็กแผ่น Bundle (BATCH HU)",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "RM-LAYOUT-E8-B02",
    bayCode: "E8/B02",
    zoneName: "โซนเหล็กแผ่น RM อาคาร E8 แถว B02 (รับภายนอก)",
    maxCapacityTons: 350,
    maxBundles: 150,
    description: "พื้นที่จัดเก็บเหล็กแผ่น RM รับเข้าจากภายนอก",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

// ============================================================================
// Local Cache Storage Keys & Helpers
// ============================================================================
const RM_STOCK_CACHE_KEY = "tmt_wms_rm_stock_cache_v1";
const RM_TX_CACHE_KEY = "tmt_wms_rm_tx_cache_v1";
const RM_STAGING_CACHE_KEY = "tmt_wms_rm_staging_cache_v1";
const RM_LAYOUTS_CACHE_KEY = "tmt_wms_rm_layouts_cache_v1";
const RM_SAP_CACHE_KEY = "tmt_wms_rm_sap_cache_v1";

type LocalCacheListener = () => void;
const localRmListeners = new Set<LocalCacheListener>();

function notifyLocalRmListeners() {
  localRmListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

function readLocalCache<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore storage quota errors
  }
}

export function sanitizeRmDocId(rawId: string, prefix = "RM"): string {
  const cleaned = String(rawId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!cleaned) {
    return `${prefix}_${Date.now()}`;
  }
  return cleaned.slice(0, 120);
}

function sanitizeRmStockPayload(record: RmStockRecord): RmStockRecord {
  const safeId = sanitizeRmDocId(record.id || `RM-${record.batchHu || record.batch}`, "RM");
  const safeBatch = String(record.batch || record.batchHu || "UNKNOWN")
    .trim()
    .slice(0, 64);
  const safeBatchHu = String(record.batchHu || "")
    .trim()
    .slice(0, 64);
  const safeLocation = String(record.location || "-")
    .trim()
    .slice(0, 64);

  return {
    id: safeId,
    inboundType: record.inboundType === "external" ? "external" : "internal",
    internalSubMode: record.internalSubMode === "bundle" ? "bundle" : "batch",
    sapCategory: record.sapCategory || (record.internalSubMode === "bundle" ? "Bundle" : "Batch"),
    machine: String(record.machine || "CL03").slice(0, 32),
    location: safeLocation || "-",
    previousLocation: String(record.previousLocation || "").slice(0, 64),
    storageLocation: String(record.storageLocation || "1101").slice(0, 64),
    materialNo: String(record.materialNo || "-").slice(0, 64),
    description: String(record.description || "-").slice(0, 256),
    batch: safeBatch || "-",
    batchHu: safeBatchHu,
    certThickness: String(record.certThickness || "-").slice(0, 32),
    width: String(record.width || "-").slice(0, 32),
    length: String(record.length || "-").slice(0, 32),
    grade: String(record.grade || "-").slice(0, 64),
    unrestricted: String(
      record.unrestricted || (record.weightKg ? record.weightKg.toLocaleString() : "0")
    ).slice(0, 64),
    weightKg: Number(record.weightKg) || 0,
    initialWeightKg: Number(record.initialWeightKg ?? record.weightKg) || 0,
    inboundQty: Number(record.inboundQty) || 0,
    manufacturer: String(record.manufacturer ?? "").slice(0, 64),
    salesDocument: String(record.salesDocument ?? "").slice(0, 64),
    salesItem: String(record.salesItem ?? "0").slice(0, 32),
    conditionText: String(record.conditionText ?? "").slice(0, 128),
    status: record.status || "available",
    orderNo: String(record.orderNo || "").slice(0, 64),
    stagedOrderNo: String(record.stagedOrderNo || "").slice(0, 64),
    stagedMachineId: String(record.stagedMachineId || "").slice(0, 32),
    stagedAt: String(record.stagedAt || "").slice(0, 64),
    issuedOrderNo: String(record.issuedOrderNo || "").slice(0, 64),
    issuedMachineId: String(record.issuedMachineId || "").slice(0, 32),
    issuedAt: String(record.issuedAt || "").slice(0, 64),
    hasSapData: Boolean(record.hasSapData),
    remark: String(record.remark || "").slice(0, 256),
    scanTimestamp: String(record.scanTimestamp || formatNowTimestamp().timestamp).slice(0, 64),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Subscriptions (Real-time Firestore + Local Cache Fallback)
// ============================================================================
const activeRmFirestoreUnsubs = new Set<() => void>();

export function unsubscribeAllRmFirestoreListeners(): void {
  activeRmFirestoreUnsubs.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // ignore
    }
  });
  activeRmFirestoreUnsubs.clear();
}

export function subscribeToRmStock(onData: (records: RmStockRecord[]) => void): () => void {
  const cached = readLocalCache<RmStockRecord[]>(RM_STOCK_CACHE_KEY, []);
  onData(cached);

  const localHandler = () => {
    onData(readLocalCache<RmStockRecord[]>(RM_STOCK_CACHE_KEY, []));
  };
  localRmListeners.add(localHandler);

  let unsubFirestore: (() => void) | null = null;
  try {
    const colRef = collection(db, RM_STOCK_COLLECTION);
    unsubFirestore = onSnapshot(
      colRef,
      (snapshot) => {
        const docs: RmStockRecord[] = [];
        snapshot.forEach((d) => {
          docs.push(d.data() as RmStockRecord);
        });
        docs.sort((a, b) => (b.scanTimestamp || "").localeCompare(a.scanTimestamp || ""));
        writeLocalCache(RM_STOCK_CACHE_KEY, docs);
        onData(docs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, RM_STOCK_COLLECTION);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, RM_STOCK_COLLECTION);
  }

  return () => {
    localRmListeners.delete(localHandler);
    if (unsubFirestore) unsubFirestore();
  };
}

export function subscribeToRmTransactions(
  onData: (records: RmTransactionRecord[]) => void
): () => void {
  const cached = readLocalCache<RmTransactionRecord[]>(RM_TX_CACHE_KEY, []);
  onData(cached);

  const localHandler = () => {
    onData(readLocalCache<RmTransactionRecord[]>(RM_TX_CACHE_KEY, []));
  };
  localRmListeners.add(localHandler);

  let unsubFirestore: (() => void) | null = null;
  try {
    const colRef = collection(db, RM_TRANSACTIONS_COLLECTION);
    unsubFirestore = onSnapshot(
      colRef,
      (snapshot) => {
        const docs: RmTransactionRecord[] = [];
        snapshot.forEach((d) => {
          docs.push(d.data() as RmTransactionRecord);
        });
        docs.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
        writeLocalCache(RM_TX_CACHE_KEY, docs);
        onData(docs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, RM_TRANSACTIONS_COLLECTION);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, RM_TRANSACTIONS_COLLECTION);
  }

  return () => {
    localRmListeners.delete(localHandler);
    if (unsubFirestore) unsubFirestore();
  };
}

export function subscribeToRmStaging(onData: (orders: RmStagingOrder[]) => void): () => void {
  const cached = readLocalCache<RmStagingOrder[]>(RM_STAGING_CACHE_KEY, []);
  onData(cached);

  const localHandler = () => {
    onData(readLocalCache<RmStagingOrder[]>(RM_STAGING_CACHE_KEY, []));
  };
  localRmListeners.add(localHandler);

  let unsubFirestore: (() => void) | null = null;
  try {
    const colRef = collection(db, RM_STAGING_COLLECTION);
    unsubFirestore = onSnapshot(
      colRef,
      (snapshot) => {
        const docs: RmStagingOrder[] = [];
        snapshot.forEach((d) => {
          docs.push(d.data() as RmStagingOrder);
        });
        docs.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        writeLocalCache(RM_STAGING_CACHE_KEY, docs);
        onData(docs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, RM_STAGING_COLLECTION);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, RM_STAGING_COLLECTION);
  }

  return () => {
    localRmListeners.delete(localHandler);
    if (unsubFirestore) unsubFirestore();
  };
}

export function subscribeToRmLayouts(onData: (zones: RmLayoutZone[]) => void): () => void {
  const cached = readLocalCache<RmLayoutZone[]>(RM_LAYOUTS_CACHE_KEY, DEFAULT_RM_LAYOUT_ZONES);
  onData(cached.length > 0 ? cached : DEFAULT_RM_LAYOUT_ZONES);

  const localHandler = () => {
    const current = readLocalCache<RmLayoutZone[]>(RM_LAYOUTS_CACHE_KEY, DEFAULT_RM_LAYOUT_ZONES);
    onData(current.length > 0 ? current : DEFAULT_RM_LAYOUT_ZONES);
  };
  localRmListeners.add(localHandler);

  let unsubFirestore: (() => void) | null = null;
  try {
    const colRef = collection(db, RM_LAYOUTS_COLLECTION);
    unsubFirestore = onSnapshot(
      colRef,
      (snapshot) => {
        if (snapshot.empty) {
          onData(DEFAULT_RM_LAYOUT_ZONES);
          return;
        }
        const docs: RmLayoutZone[] = [];
        snapshot.forEach((d) => {
          docs.push(d.data() as RmLayoutZone);
        });
        docs.sort((a, b) => a.bayCode.localeCompare(b.bayCode));
        writeLocalCache(RM_LAYOUTS_CACHE_KEY, docs);
        onData(docs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, RM_LAYOUTS_COLLECTION);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, RM_LAYOUTS_COLLECTION);
  }

  return () => {
    localRmListeners.delete(localHandler);
    if (unsubFirestore) unsubFirestore();
  };
}

export function subscribeToRmSapChunks(
  onData: (items: RmSapMasterItem[], chunkCount: number) => void
): () => void {
  const cached = readLocalCache<RmSapMasterItem[]>(RM_SAP_CACHE_KEY, []);
  onData(cached, Math.ceil(cached.length / RM_SAP_CHUNK_SIZE));

  const localHandler = () => {
    const list = readLocalCache<RmSapMasterItem[]>(RM_SAP_CACHE_KEY, []);
    onData(list, Math.ceil(list.length / RM_SAP_CHUNK_SIZE));
  };
  localRmListeners.add(localHandler);

  let unsubFirestore: (() => void) | null = null;
  try {
    const colRef = collection(db, RM_SAP_CHUNKS_COLLECTION);
    unsubFirestore = onSnapshot(
      colRef,
      (snapshot) => {
        const chunks: Array<{ chunkIndex: number; items: RmSapMasterItem[] }> = [];
        snapshot.forEach((d) => {
          const data = d.data();
          if (Array.isArray(data.items)) {
            chunks.push({
              chunkIndex: Number(data.chunkIndex) || 0,
              items: data.items as RmSapMasterItem[],
            });
          }
        });
        chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        const flat = chunks.flatMap((c) => c.items);
        if (flat.length > 0 || snapshot.size === 0) {
          writeLocalCache(RM_SAP_CACHE_KEY, flat);
          onData(flat, chunks.length);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, RM_SAP_CHUNKS_COLLECTION);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, RM_SAP_CHUNKS_COLLECTION);
  }

  return () => {
    localRmListeners.delete(localHandler);
    if (unsubFirestore) unsubFirestore();
  };
}

// ============================================================================
// Mutations: Inbound (รับภายใน Batch, รับภายใน Bundle / BATCH HU, รับภายนอก)
// ============================================================================
export async function saveRmInboundToCloud(record: RmStockRecord): Promise<RmStockRecord> {
  const cleanRecord = sanitizeRmStockPayload(record);
  const { dateYmd, timestamp } = formatNowTimestamp();

  const txId = sanitizeRmDocId(
    `RMTX-IN-${cleanRecord.batchHu || cleanRecord.batch}-${Date.now()}`,
    "RMTX"
  );
  const txRecord: RmTransactionRecord = {
    id: txId,
    txType: "inbound",
    inboundType: cleanRecord.inboundType,
    internalSubMode: cleanRecord.internalSubMode,
    batch: cleanRecord.batch,
    batchHu: cleanRecord.batchHu || "",
    materialNo: cleanRecord.materialNo,
    description: cleanRecord.description,
    weightKg: cleanRecord.weightKg,
    inboundQty: cleanRecord.inboundQty,
    fromLocation:
      cleanRecord.inboundType === "internal" ? cleanRecord.machine : "EXTERNAL",
    toLocation: cleanRecord.location,
    machineId: cleanRecord.machine,
    grade: cleanRecord.grade,
    thickness: cleanRecord.certThickness,
    width: cleanRecord.width,
    length: cleanRecord.length,
    manufacturer: cleanRecord.manufacturer,
    operator: getActiveRecorderDisplay().label,
    remark:
      cleanRecord.inboundType === "internal"
        ? cleanRecord.internalSubMode === "bundle"
          ? `รับภายใน Bundle (BATCH HU: ${cleanRecord.batchHu}) จากเครื่อง ${cleanRecord.machine} -> ${cleanRecord.location}`
          : `รับภายใน Batch (${cleanRecord.batch}) จากเครื่อง ${cleanRecord.machine} -> ${cleanRecord.location}`
        : `รับภายนอก (${cleanRecord.batch}) -> ${cleanRecord.location}`,
    timestamp: cleanRecord.scanTimestamp || timestamp,
    dateYmd,
    updatedAt: new Date().toISOString(),
  };

  // Update Local Cache immediately for instant UI response
  const currentStock = readLocalCache<RmStockRecord[]>(RM_STOCK_CACHE_KEY, []);
  const nextStock = [
    cleanRecord,
    ...currentStock.filter((item) => item.id !== cleanRecord.id),
  ];
  writeLocalCache(RM_STOCK_CACHE_KEY, nextStock);

  const currentTx = readLocalCache<RmTransactionRecord[]>(RM_TX_CACHE_KEY, []);
  writeLocalCache(RM_TX_CACHE_KEY, [txRecord, ...currentTx]);
  notifyLocalRmListeners();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, RM_STOCK_COLLECTION, cleanRecord.id), cleanRecord, { merge: true });
    batch.set(doc(db, RM_TRANSACTIONS_COLLECTION, txRecord.id), txRecord, { merge: true });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${RM_STOCK_COLLECTION}/${cleanRecord.id}`);
  }

  return cleanRecord;
}

export async function deleteRmStockFromCloud(id: string): Promise<void> {
  const safeId = sanitizeRmDocId(id, "RM");
  const current = readLocalCache<RmStockRecord[]>(RM_STOCK_CACHE_KEY, []);
  writeLocalCache(
    RM_STOCK_CACHE_KEY,
    current.filter((r) => r.id !== safeId && r.id !== id)
  );
  notifyLocalRmListeners();

  try {
    await deleteDoc(doc(db, RM_STOCK_COLLECTION, safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${RM_STOCK_COLLECTION}/${safeId}`);
  }
}

export async function saveRmStagingOrderToCloud(
  order: RmStagingOrder
): Promise<RmStagingOrder> {
  const safeId = sanitizeRmDocId(order.id || `RMSTG-${order.orderNo}`, "RMSTG");
  const cleanOrder: RmStagingOrder = {
    ...order,
    id: safeId,
    orderNo: String(order.orderNo || "").trim().toUpperCase(),
    updatedAt: new Date().toISOString(),
  };

  const currentOrders = readLocalCache<RmStagingOrder[]>(RM_STAGING_CACHE_KEY, []);
  const nextOrders = [
    cleanOrder,
    ...currentOrders.filter(
      (o) => o.id !== cleanOrder.id && o.orderNo !== cleanOrder.orderNo
    ),
  ];
  writeLocalCache(RM_STAGING_CACHE_KEY, nextOrders);
  notifyLocalRmListeners();

  try {
    await setDoc(doc(db, RM_STAGING_COLLECTION, cleanOrder.id), cleanOrder, {
      merge: true,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${RM_STAGING_COLLECTION}/${cleanOrder.id}`);
  }

  return cleanOrder;
}

export async function deleteRmStagingOrderFromCloud(order: RmStagingOrder): Promise<void> {
  const safeId = sanitizeRmDocId(order.id || `RMSTG-${order.orderNo}`, "RMSTG");
  const currentOrders = readLocalCache<RmStagingOrder[]>(RM_STAGING_CACHE_KEY, []);
  writeLocalCache(
    RM_STAGING_CACHE_KEY,
    currentOrders.filter((o) => o.id !== safeId && o.orderNo !== order.orderNo)
  );
  notifyLocalRmListeners();

  try {
    await deleteDoc(doc(db, RM_STAGING_COLLECTION, safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${RM_STAGING_COLLECTION}/${safeId}`);
  }
}

export async function relocateRmStockInCloud(params: {
  recordIds: string[];
  targetLocation: string;
}): Promise<number> {
  const { recordIds, targetLocation } = params;
  const cleanLoc = targetLocation.trim().toUpperCase();
  if (!cleanLoc || recordIds.length === 0) return 0;

  const { dateYmd, timestamp } = formatNowTimestamp();
  const currentStock = readLocalCache<RmStockRecord[]>(RM_STOCK_CACHE_KEY, []);
  const currentTx = readLocalCache<RmTransactionRecord[]>(RM_TX_CACHE_KEY, []);
  const updatedRecords: RmStockRecord[] = [];
  const newTxs: RmTransactionRecord[] = [];

  const nextStock = currentStock.map((rec) => {
    if (!recordIds.includes(rec.id)) return rec;
    const prevLoc = rec.location;
    const updated: RmStockRecord = {
      ...rec,
      previousLocation: prevLoc,
      location: cleanLoc,
      scanTimestamp: timestamp,
      updatedAt: new Date().toISOString(),
    };
    updatedRecords.push(updated);
    newTxs.push({
      id: sanitizeRmDocId(`RMTX-REL-${rec.batch}-${Date.now()}-${updatedRecords.length}`, "RMTX"),
      txType: "relocate",
      batch: rec.batch,
      batchHu: rec.batchHu,
      materialNo: rec.materialNo,
      description: rec.description,
      weightKg: rec.weightKg,
      inboundQty: rec.inboundQty,
      fromLocation: prevLoc,
      toLocation: cleanLoc,
      operator: getActiveRecorderDisplay().label,
      remark: `ย้าย Layout ${rec.batchHu || rec.batch}: ${prevLoc} -> ${cleanLoc}`,
      timestamp,
      dateYmd,
      updatedAt: new Date().toISOString(),
    });
    return updated;
  });

  writeLocalCache(RM_STOCK_CACHE_KEY, nextStock);
  writeLocalCache(RM_TX_CACHE_KEY, [...newTxs, ...currentTx]);
  notifyLocalRmListeners();

  try {
    const batch = writeBatch(db);
    updatedRecords.forEach((r) => {
      batch.set(doc(db, RM_STOCK_COLLECTION, r.id), r, { merge: true });
    });
    newTxs.forEach((t) => {
      batch.set(doc(db, RM_TRANSACTIONS_COLLECTION, t.id), t, { merge: true });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, RM_STOCK_COLLECTION);
  }

  return updatedRecords.length;
}

export async function saveRmSapChunksToCloud(
  items: RmSapMasterItem[],
  onProgress?: (currentChunk: number, totalChunks: number) => void
): Promise<number> {
  writeLocalCache(RM_SAP_CACHE_KEY, items);

  // Enrich any existing scanned rmStock records that match Batch or BAHCH HU
  const byBatch = new Map<string, RmSapMasterItem>();
  const byHu = new Map<string, RmSapMasterItem>();
  items.forEach((it) => {
    if (it.batch) byBatch.set(it.batch.trim().toUpperCase(), it);
    if (it.batchHu) byHu.set(it.batchHu.trim().toUpperCase(), it);
  });

  const currentStock = readLocalCache<RmStockRecord[]>(RM_STOCK_CACHE_KEY, []);
  const enrichedDocs: RmStockRecord[] = [];
  const nextStock = currentStock.map((rec) => {
    const match =
      (rec.batchHu && byHu.get(rec.batchHu.trim().toUpperCase())) ||
      (rec.batch && byBatch.get(rec.batch.trim().toUpperCase()));
    if (!match) return rec;
    const updated = sanitizeRmStockPayload({
      ...rec,
      sapCategory: match.sapCategory || rec.sapCategory,
      storageLocation: match.storageLocation || rec.storageLocation,
      materialNo: match.materialNo && match.materialNo !== "-" ? match.materialNo : rec.materialNo,
      description:
        match.description && match.description !== "-" ? match.description : rec.description,
      certThickness:
        match.certThickness && match.certThickness !== "-"
          ? match.certThickness
          : rec.certThickness,
      width: match.width && match.width !== "-" ? match.width : rec.width,
      length: match.length && match.length !== "-" ? match.length : rec.length,
      grade: match.grade && match.grade !== "-" ? match.grade : rec.grade,
      unrestricted:
        rec.inboundType === "internal" && rec.weightKg > 0
          ? rec.unrestricted
          : match.unrestricted || rec.unrestricted,
      weightKg:
        rec.inboundType === "internal" && rec.weightKg > 0
          ? rec.weightKg
          : match.weightKg > 0
          ? match.weightKg
          : rec.weightKg,
      initialWeightKg:
        rec.inboundType === "internal" && rec.initialWeightKg > 0
          ? rec.initialWeightKg
          : match.weightKg > 0
          ? match.weightKg
          : rec.initialWeightKg,
      inboundQty:
        rec.inboundType === "internal" && rec.inboundQty > 0
          ? rec.inboundQty
          : match.inboundQty > 0
          ? match.inboundQty
          : rec.inboundQty,
      manufacturer:
        match.manufacturer !== undefined && match.manufacturer !== "-"
          ? match.manufacturer
          : rec.manufacturer,
      salesDocument: match.salesDocument ?? rec.salesDocument ?? "",
      salesItem: match.salesItem ?? rec.salesItem ?? "0",
      conditionText: match.conditionText ?? rec.conditionText ?? "",
      hasSapData: true,
    });
    enrichedDocs.push(updated);
    return updated;
  });

  if (enrichedDocs.length > 0) {
    writeLocalCache(RM_STOCK_CACHE_KEY, nextStock);
  }
  notifyLocalRmListeners();

  const totalChunks = Math.max(1, Math.ceil(items.length / RM_SAP_CHUNK_SIZE));
  try {
    if (enrichedDocs.length > 0) {
      for (let i = 0; i < enrichedDocs.length; i += 400) {
        const enrichBatch = writeBatch(db);
        enrichedDocs.slice(i, i + 400).forEach((r) => {
          enrichBatch.set(doc(db, RM_STOCK_COLLECTION, r.id), r, { merge: true });
        });
        await enrichBatch.commit();
      }
    }

    const existingSnap = await getDocs(collection(db, RM_SAP_CHUNKS_COLLECTION));
    const oldDocs = existingSnap.docs;
    for (let i = 0; i < oldDocs.length; i += 400) {
      const delBatch = writeBatch(db);
      oldDocs.slice(i, i + 400).forEach((d) => delBatch.delete(d.ref));
      await delBatch.commit();
    }

    for (let idx = 0; idx < totalChunks; idx++) {
      const slice = items.slice(idx * RM_SAP_CHUNK_SIZE, (idx + 1) * RM_SAP_CHUNK_SIZE);
      const chunkId = `rm_sap_chunk_${String(idx).padStart(4, "0")}`;
      await setDoc(doc(db, RM_SAP_CHUNKS_COLLECTION, chunkId), {
        id: chunkId,
        chunkIndex: idx,
        totalChunks,
        totalItems: items.length,
        itemCount: slice.length,
        items: slice,
        updatedAt: new Date().toISOString(),
      });
      onProgress?.(idx + 1, totalChunks);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, RM_SAP_CHUNKS_COLLECTION);
  }

  return totalChunks;
}

export async function clearRmSapChunksFromCloud(): Promise<void> {
  writeLocalCache(RM_SAP_CACHE_KEY, []);
  notifyLocalRmListeners();
  try {
    const snap = await getDocs(collection(db, RM_SAP_CHUNKS_COLLECTION));
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, RM_SAP_CHUNKS_COLLECTION);
  }
}
