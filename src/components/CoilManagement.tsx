import React, { useState, useEffect, useMemo, useRef } from "react";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import {
  Disc,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRightLeft,
  Cpu,
  Package,
  Search,
  RotateCcw,
  Trash2,
  CheckCircle2,
  Plus,
  Upload,
  FileSpreadsheet,
  MapPin,
  RefreshCw,
  Camera,
  Barcode,
  Volume2,
  VolumeX,
  ClipboardList,
  Layers,
  Check,
  X,
  Sparkles,
  Scale,
  Factory,
  Database,
  Building2,
  Lock,
  Info,
  Loader2,
  Clock,
  Zap,
  Save,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ScanLine,
  Box,
  Minus,
} from "lucide-react";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";
import { CoilWarehouse3DView } from "./coil3d/CoilWarehouse3DView";
import {
  DEFAULT_BASE_SLOTS_PER_ROW,
  MAX_BASE_SLOTS_PER_ROW,
  MAX_STACK_LEVEL,
  MIN_BASE_SLOTS_PER_ROW,
  STACK_LEVELS,
  StackLevel,
  clampBaseSlotsPerRow,
  getMaxCoilsPerRow,
  getRowLevelOccupancy,
  parseCoilLocationTo3D,
  validateCoilPlacementLocation,
} from "./coil3d/coilWarehouseLayout";
import { cleanBarcode } from "../utils/barcodeUtils";
import { showToast } from "../utils/swalUtils";
import { useLanguage } from "../contexts/LanguageContext";
import {
  CoilModeTab,
  CoilStockRecord,
  CoilTransactionRecord,
  CoilStagingOrder,
  CoilStagingItem,
  CoilLayoutZone,
  CoilSapMasterItem,
  COIL_SAP_CHUNK_SIZE,
  DEFAULT_COIL_LAYOUT_ZONES,
  subscribeToCoilStock,
  subscribeToCoilTransactions,
  subscribeToCoilStaging,
  subscribeToCoilLayouts,
  subscribeToCoilSapChunks,
  saveCoilInboundToCloud,
  batchSaveCoilInboundToCloud,
  saveCoilStagingOrderToCloud,
  batchSaveCoilStagingOrdersToCloud,
  deleteCoilStagingOrderFromCloud,
  issueCoilToMachineInCloud,
  relocateCoilsInCloud,
  saveCoilLayoutZoneToCloud,
  returnCoilToStockInCloud,
  deleteCoilStockFromCloud,
  clearAllCoilDataFromCloud,
  saveCoilSapChunksToCloud,
  clearCoilSapChunksFromCloud,
  importCoilSapStockToCloud,
  getCoilCloudRealtimeEnabled,
  setCoilCloudRealtimeEnabled,
  subscribeCoilCloudRealtimeMode,
  unsubscribeAllCoilFirestoreListeners,
  formatNowTimestamp,
} from "../services/coilDataService";

interface CoilManagementProps {
  activeMode?: CoilModeTab;
  onModeChange?: (mode: CoilModeTab) => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
  onStockSummaryChange?: (coils: CoilStockRecord[]) => void;
}

const SLITTING_MACHINES = [
  "CL01",
  "CL02",
  "CL03",
  "CL04",
  "CL05",
  "CL06",
  "SM01",
  "SM02",
  "SM03",
  "SM04",
];

const COIL_MACHINE_CATEGORIES: Array<{
  id: string;
  label: string;
  machines: string[];
}> = [
  { id: "ALL", label: "ทั้งหมด (10 เครื่อง)", machines: SLITTING_MACHINES },
  {
    id: "CL",
    label: "CL (CL01-CL06)",
    machines: SLITTING_MACHINES.filter((m) => m.startsWith("CL")),
  },
  {
    id: "SM",
    label: "SM (SM01-SM04)",
    machines: SLITTING_MACHINES.filter((m) => m.startsWith("SM")),
  },
];

interface ParsedCoilPickListItem {
  orderNo?: string;
  bomItem: string;
  material: string;
  materialDescription: string;
  requirementQty: number;
  unit: string;
  storageLocation: string;
  batch: string;
}

function parseRawCoilPickListText(text: string): ParsedCoilPickListItem[] {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const items: ParsedCoilPickListItem[] = [];
  const seenOrderBatch = new Set<string>();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("sales document") ||
      lower.includes("material description") ||
      lower.includes("requirement quantity") ||
      lower.includes("หนา certificated") ||
      (lower.includes("storage location") && lower.includes("batch")) ||
      lower.startsWith("bom item") ||
      (lower.startsWith("order") && lower.includes("batch"))
    ) {
      continue;
    }

    let cols = line.split("\t").map((c) => c.trim());
    if (cols.length < 2) {
      cols = line.trim().split(/[\s,;]+/).map((c) => c.trim());
    }
    if (cols.length === 0) continue;

    // Detect if col[0] is a 7-12 digit SAP Order number when there are multiple columns
    let rowOrderNo: string | undefined = undefined;
    let startOffset = 0;
    if (
      cols.length >= 6 &&
      /^\d{7,12}$/.test(cols[0].replace(/^["']|["']$/g, "").trim()) &&
      /^\d{2,4}$/.test(cols[1].replace(/^["']|["']$/g, "").trim())
    ) {
      rowOrderNo = cols[0].replace(/^["']|["']$/g, "").trim();
      startOffset = 1;
    }

    // 1. Find 10-character alphanumeric Batch code
    let B = -1;
    for (let i = startOffset; i < cols.length; i++) {
      const token = cols[i].replace(/^["']|["']$/g, "").trim();
      if (/^[A-Za-z0-9]{10}$/.test(token) && !/^\d{10}$/.test(token)) {
        B = i;
        break;
      }
    }
    if (B === -1) {
      for (let i = startOffset; i < cols.length; i++) {
        const token = cols[i].replace(/^["']|["']$/g, "").trim();
        if (/^[A-Za-z0-9]{10}$/.test(token)) {
          B = i;
          break;
        }
      }
    }

    if (B === -1) continue;

    const batch = cols[B].replace(/^["']|["']$/g, "").trim().toUpperCase();
    const dedupeKey = `${rowOrderNo || "DEFAULT"}_${batch}`;
    if (!batch || seenOrderBatch.has(dedupeKey)) continue;
    seenOrderBatch.add(dedupeKey);

    let bomItem = String((items.length + 1) * 10).padStart(4, "0");
    let material = "-";
    let materialDescription = "-";
    let requirementQty = 0;
    let unit = "KG";
    let storageLocation = "1101";

    const workCols = startOffset > 0 ? cols.slice(startOffset) : cols;
    const workB = B - startOffset;

    if (workCols.length >= 11 && workB === 10) {
      bomItem = workCols[0] || bomItem;
      material = workCols[1] || "-";
      materialDescription = workCols[2] || "-";
      requirementQty = parseFloat((workCols[3] || "0").replace(/,/g, "")) || 0;
      unit = workCols[4] || "KG";
      storageLocation = workCols[9] || "1101";
    } else if (workCols.length >= 7 && workB >= 4) {
      bomItem = /^\d{2,4}$/.test(workCols[0]) ? workCols[0] : bomItem;
      material = workCols[1] || "-";
      materialDescription = workCols[2] || "-";
      requirementQty = parseFloat((workCols[3] || "0").replace(/,/g, "")) || 0;
      unit = workCols[4] && /^[A-Za-z]{1,4}$/.test(workCols[4]) ? workCols[4].toUpperCase() : "KG";
      storageLocation =
        workCols.find(
          (c, idx) => idx !== workB && (/^[0-9][A-Z0-9]{3}$/i.test(c) || /^2E/i.test(c))
        ) || "1101";
    } else {
      material = workCols[0] !== batch ? workCols[0] : workCols[1] || "-";
      materialDescription = workCols.find((c) => c !== batch && c.length > 10) || "-";
      storageLocation =
        workCols.find((c) => /^[0-9][A-Z0-9]{2,4}$/i.test(c) || /^2E/i.test(c)) || "1101";
      for (let i = 0; i < workCols.length; i++) {
        if (i !== workB) {
          const num = parseFloat(workCols[i].replace(/,/g, ""));
          if (!isNaN(num) && num > 0 && num < 1000000) {
            requirementQty = num;
            break;
          }
        }
      }
    }

    items.push({
      orderNo: rowOrderNo,
      bomItem,
      material,
      materialDescription,
      requirementQty: isNaN(requirementQty) ? 0 : requirementQty,
      unit: unit || "KG",
      storageLocation: storageLocation || "1101",
      batch,
    });
  }

  return items;
}

const COMMON_GRADES = ["SS400", "SPCC", "SGCC", "SAPH440", "SPHC", "STKR400"];
const COMMON_MANUFACTURERS = ["SSI", "GJ", "POSCO", "JFE", "NIPPON", "SYS", "CSC"];
const INBOUND_BUILDINGS = ["E7", "E8", "H7", "H8", "05", "21"];
const INBOUND_QUICK_ROWS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const WAREHOUSE_BASE_SLOTS_KEY = "tmt_wms_coil_base_slots_per_row_v1";

// ============================================================================
// SAP Data Decoders & Parsers for Coil Stock Upload (UTF-8 / Windows-874 / Excel)
// ============================================================================
function decodeCoilSapBuffer(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  if (uint8.length >= 3 && uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(uint8);
  }
  const utf8Text = new TextDecoder("utf-8").decode(uint8);
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;
  let thaiByteCount = 0;
  for (let i = 0; i < Math.min(uint8.length, 5000); i++) {
    if (uint8[i] >= 0xa1 && uint8[i] <= 0xfb) {
      thaiByteCount++;
    }
  }
  const hasUtf8Thai = /[\u0E00-\u0E7F]/.test(utf8Text);

  if (replacementCount > 0 || (thaiByteCount > 5 && !hasUtf8Thai)) {
    try {
      const thaiText = new TextDecoder("windows-874").decode(uint8);
      if (/[\u0E00-\u0E7F]/.test(thaiText)) return thaiText;
    } catch {
      try {
        const tisText = new TextDecoder("tis-620").decode(uint8);
        if (/[\u0E00-\u0E7F]/.test(tisText)) return tisText;
      } catch {
        // fallback to utf-8
      }
    }
  }
  return utf8Text;
}

function sanitizeCoilWeightKg(val: unknown, rawStr?: string): number {
  if (val === null || val === undefined) return 0;
  const str = String(rawStr !== undefined ? rawStr : val).trim();
  if (
    !str ||
    str === "-" ||
    str === "0" ||
    str === "0.00" ||
    /2e09/i.test(str) ||
    str.includes("2.00E+09") ||
    str.includes("2.00e+09") ||
    str === "2000000000" ||
    str === "2,000,000,000"
  ) {
    return 0;
  }
  const cleanStr = str.replace(/,/g, "").replace(/kg/gi, "").replace(/\s+/g, "").trim();
  const num = typeof val === "number" && !isNaN(val) ? val : parseFloat(cleanStr);
  if (isNaN(num) || num <= 0 || num >= 1000000) {
    return 0;
  }
  return num;
}

function formatSapThickness(val: unknown): string {
  if (val === null || val === undefined) return "-";
  const raw = String(val).replace(/,/g, "").replace(/\s*mm$/i, "").trim();
  if (!raw || raw === "-") return "-";
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0 || num >= 200) return "-";
  return num.toFixed(2);
}

function formatSapWidth(val: unknown): string {
  if (val === null || val === undefined) return "-";
  const raw = String(val).replace(/,/g, "").replace(/\s*mm$/i, "").trim();
  if (!raw || raw === "-") return "-";
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0 || num >= 10000) return "-";
  return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(2)));
}

function splitCsvLine(line: string, delimiter = ","): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Strict 15-column SAP format ([0] to [14]):
// [0] Material No.
// [1] Discription
// [2] Batch
// [3] หนา Certificated.
// [4] ความหนาเป้าหมาย
// [5] กว้าง
// [6] Grade
// [7] ผู้ผลิต
// [8] Skinpass
// [9] Storage Location
// [10] Unrestr.
// [11] หมายเลขคอยล์
// [12] Text สภาพสินค้า
// [13] HEAT NO.
// [14] นน. ชั่งจริง
function parseCoilSapRows(rawRows: unknown[][]): CoilSapMasterItem[] {
  if (!rawRows || rawRows.length === 0) return [];
  const items: CoilSapMasterItem[] = [];

  for (let r = 0; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row) || row.length < 3) continue;

    let cells = row.map((cell) =>
      cell !== null && cell !== undefined ? String(cell).trim().replace(/^["']|["']$/g, "") : ""
    );
    if (cells.every((c) => c.length === 0)) continue;

    // If Excel sheet has leading empty column(s) before Material No., shift left so [0] is Material No.
    while (cells.length > 15 && cells[0] === "") {
      cells = cells.slice(1);
    }

    // Skip header rows
    const c0 = (cells[0] || "").toLowerCase();
    const c1 = (cells[1] || "").toLowerCase();
    const c2 = (cells[2] || "").toLowerCase();
    const c3 = (cells[3] || "").toLowerCase();
    const c6 = (cells[6] || "").toLowerCase();
    const c10 = (cells[10] || "").toLowerCase();
    if (
      c2 === "batch" ||
      c2.includes("batch") ||
      c0.includes("material") ||
      c1.includes("discription") ||
      c1.includes("description") ||
      c3.includes("certificated") ||
      c6 === "grade" ||
      c10.includes("unrestr")
    ) {
      continue;
    }

    // If an unquoted CSV line split [10] Unrestr. (e.g. "12,018" -> "12" and "018"), merge them back
    if (
      cells.length >= 16 &&
      /^\d{1,3}$/.test(cells[10] || "") &&
      /^\d{3}$/.test(cells[11] || "")
    ) {
      cells = [
        ...cells.slice(0, 10),
        `${cells[10]},${cells[11]}`,
        ...cells.slice(12),
      ];
    }

    // [2] Batch ONLY (never use [0] Material No. which contains '-' or >10 chars)
    const rawCell2 = (cells[2] || "").trim().toUpperCase();
    if (!rawCell2 || rawCell2.includes("-") || /[\u0E00-\u0E7F]/.test(rawCell2)) {
      continue;
    }
    const rawBatchCode = rawCell2.replace(/[^A-Z0-9]/g, "");
    if (!rawBatchCode || rawBatchCode.length < 3 || rawBatchCode.length > 10) continue;

    // [0] Material No.
    const materialNo = (cells[0] || "").trim();
    // [1] Discription
    const description = (cells[1] || "").trim();
    // [3] หนา Certificated.
    const certThickness = formatSapThickness(cells[3]);
    // [4] ความหนาเป้าหมาย
    const targetThickness =
      formatSapThickness(cells[4]) !== "-" ? formatSapThickness(cells[4]) : certThickness;
    // [5] กว้าง
    const width = formatSapWidth(cells[5]);
    // [6] Grade
    const rawGrade = (cells[6] || "").trim().toUpperCase();
    const grade = rawGrade || "-";
    // [7] ผู้ผลิต (never [8] Skinpass)
    const rawManufacturer = (cells[7] || "").trim().toUpperCase();
    const manufacturer =
      rawManufacturer && rawManufacturer !== "AUTOSK" && rawManufacturer !== "NONSK"
        ? rawManufacturer
        : "-";
    // [8] Skinpass
    const skinpass = (cells[8] || "").trim();
    // [9] Storage Location
    let storageLocation = (cells[9] || "").trim() || "-";
    if (
      storageLocation.includes("E+") ||
      storageLocation.includes("e+") ||
      storageLocation === "2000000000" ||
      storageLocation === "2.00E+09"
    ) {
      storageLocation = "2E09";
    }
    // [10] Unrestr. (น้ำหนักคงเหลือ kg - strip commas, never [5] กว้าง)
    const weightKg = sanitizeCoilWeightKg(cells[10]);
    // [11] หมายเลขคอยล์ (Coil No.)
    const coilNo = (cells[11] || "").trim().toUpperCase() || "-";
    // [12] Text สภาพสินค้า
    const conditionText = (cells[12] || "").trim();
    // [13] HEAT NO.
    const heatNo = (cells[13] || "").trim().toUpperCase();
    // [14] นน. ชั่งจริง
    const actualWeightKg = cells[14] !== undefined ? sanitizeCoilWeightKg(cells[14]) : 0;

    items.push({
      materialNo,
      description,
      batch: rawBatchCode,
      certThickness,
      targetThickness,
      width,
      grade,
      manufacturer,
      skinpass,
      storageLocation,
      weightKg,
      unrestricted: `${weightKg.toLocaleString()} kg`,
      coilNo,
      conditionText,
      heatNo,
      actualWeightKg,
      salesDoc: "",
      qualityClass: "-",
    });
  }

  return items;
}

function parseRawCoilSapText(rawText: string): CoilSapMasterItem[] {
  if (!rawText || !rawText.trim()) return [];

  // 1. Tab-Separated (TSV) from Excel/SAP copy-paste: preserve exact tab positions [0]..[14]
  if (rawText.includes("\t")) {
    const tsvLines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const tsvRows = tsvLines.map((line) =>
      line.split("\t").map((c) => c.trim().replace(/^["']|["']$/g, ""))
    );
    const parsedTsv = parseCoilSapRows(tsvRows);
    if (parsedTsv.length > 0) return parsedTsv;
  }

  // 2. CSV / Semicolon / Pipe lines (quote-aware so "8,280" in [10] Unrestr. stays a single column)
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: string[][] = [];
  for (const line of lines) {
    let cols: string[];
    if (line.includes("\t")) {
      cols = line.split("\t");
    } else if (line.includes(";") && (line.match(/;/g) || []).length >= 5) {
      cols = splitCsvLine(line, ";");
    } else if (line.includes("|") && (line.match(/\|/g) || []).length >= 5) {
      cols = line.split("|");
    } else if (line.includes(",")) {
      cols = splitCsvLine(line, ",");
    } else {
      cols = line.trim().split(/\s{2,}/);
    }
    rows.push(cols.map((c) => c.trim().replace(/^["']|["']$/g, "")));
  }
  const parsedFromLines = parseCoilSapRows(rows);
  if (parsedFromLines.length > 0) return parsedFromLines;

  // 3. Fallback via XLSX parser
  try {
    const workbook = XLSX.read(rawText, { type: "string", raw: true });
    if (workbook.SheetNames.length > 0) {
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      if (sheetRows && sheetRows.length > 0) {
        return parseCoilSapRows(sheetRows);
      }
    }
  } catch {
    // ignore fallback error
  }

  return [];
}

export const CoilManagement: React.FC<CoilManagementProps> = ({
  activeMode: controlledMode,
  onModeChange,
  onLogTransaction,
  onStockSummaryChange,
}) => {
  const { language } = useLanguage();
  const isThai = language === "th";

  const [internalMode, setInternalMode] = useState<CoilModeTab>("inbound");
  const activeMode: CoilModeTab = controlledMode || internalMode;

  const setActiveMode = (next: CoilModeTab) => {
    setInternalMode(next);
    onModeChange?.(next);
  };

  // ============================================================================
  // Live Firestore State (100% Isolated in dbCoil)
  // ============================================================================
  const [coilStock, setCoilStock] = useState<CoilStockRecord[]>([]);
  const [coilTransactions, setCoilTransactions] = useState<CoilTransactionRecord[]>([]);
  const [stagingOrders, setStagingOrders] = useState<CoilStagingOrder[]>([]);
  const [layoutZones, setLayoutZones] = useState<CoilLayoutZone[]>(DEFAULT_COIL_LAYOUT_ZONES);
  const [isCloudLoading, setIsCloudLoading] = useState<boolean>(true);
  const [isCloudRealtime, setIsCloudRealtime] = useState<boolean>(() =>
    getCoilCloudRealtimeEnabled()
  );
  const [manualRefreshTick, setManualRefreshTick] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);

  // Sync Cloud Realtime mode toggle
  useEffect(() => {
    return subscribeCoilCloudRealtimeMode((enabled) => {
      setIsCloudRealtime(enabled);
    });
  }, []);

  // Connect to coilDataService ONLY when CoilManagement is mounted, and unsubscribe immediately on unmount
  useEffect(() => {
    let isMounted = true;
    let stockLoaded = false;
    let txLoaded = false;
    let stagingLoaded = false;

    setIsCloudLoading(true);

    const checkLoaded = () => {
      if (isMounted && stockLoaded && txLoaded && stagingLoaded) {
        setIsCloudLoading(false);
      }
    };

    // Clear any stale listeners before attaching current Coil listeners
    unsubscribeAllCoilFirestoreListeners();

    const unsubStock = subscribeToCoilStock(
      (records) => {
        if (!isMounted) return;
        stockLoaded = true;
        setCoilStock(records);
        onStockSummaryChange?.(records);
        checkLoaded();
      },
      () => {
        stockLoaded = true;
        checkLoaded();
      }
    );

    const unsubTx = subscribeToCoilTransactions(
      (records) => {
        if (!isMounted) return;
        txLoaded = true;
        setCoilTransactions(records);
        checkLoaded();
      },
      () => {
        txLoaded = true;
        checkLoaded();
      }
    );

    const unsubStaging = subscribeToCoilStaging(
      (orders) => {
        if (!isMounted) return;
        stagingLoaded = true;
        setStagingOrders(orders);
        checkLoaded();
      },
      () => {
        stagingLoaded = true;
        checkLoaded();
      }
    );

    const unsubLayouts = subscribeToCoilLayouts((zones) => {
      if (!isMounted) return;
      if (zones && zones.length > 0) {
        setLayoutZones(zones);
      }
    });

    const unsubSap = subscribeToCoilSapChunks((items, chunkCount) => {
      if (!isMounted) return;
      const nextMap = new Map<string, CoilSapMasterItem>();
      items.forEach((itm) => {
        const key = String(itm.batch || "").trim().toUpperCase();
        if (key) nextMap.set(key, itm);
      });
      setCoilSapMap(nextMap);
      setCoilSapChunkCount(chunkCount);
    });

    return () => {
      isMounted = false;
      unsubStock();
      unsubTx();
      unsubStaging();
      unsubLayouts();
      unsubSap();
      // Strict Rule 3: Immediately clear all Coil Firestore listeners when leaving Coil Management
      unsubscribeAllCoilFirestoreListeners();
    };
  }, [isCloudRealtime, manualRefreshTick]);

  const playBeep = (type: "success" | "warning" | "error" = "success") => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type === "error" ? "sawtooth" : "sine";
      osc.frequency.setValueAtTime(
        type === "success" ? 880 : type === "warning" ? 540 : 240,
        ctx.currentTime
      );
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + (type === "error" ? 0.25 : 0.12));
    } catch {
      // ignore audio error
    }
  };

  // ============================================================================
  // Tab 1 State: +รับเข้า (Inbound - Fast Shop-Floor Scanner)
  // ============================================================================
  const [inboundSourceType, setInboundSourceType] = useState<"external" | "internal">("external");
  const [inboundMachine, setInboundMachine] = useState<string>("CL01");
  const [inboundScanInput, setInboundScanInput] = useState<string>("");
  const [inboundLocation, setInboundLocation] = useState<string>("");
  const [inboundBuilding, setInboundBuilding] = useState<string>("");
  const [inboundRow, setInboundRow] = useState<string>("");
  const [inboundLevel, setInboundLevel] = useState<StackLevel | null>(null);
  const [inboundManualLocationOverride, setInboundManualLocationOverride] = useState<string | null>(null);
  const [inboundSearch, setInboundSearch] = useState<string>("");
  const [warehouseBaseSlotsPerRow, setWarehouseBaseSlotsPerRow] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(WAREHOUSE_BASE_SLOTS_KEY);
      if (saved) return clampBaseSlotsPerRow(Number(saved));
    }
    return DEFAULT_BASE_SLOTS_PER_ROW;
  });
  const inboundBatchInputRef = useRef<HTMLInputElement | null>(null);

  const handleChangeWarehouseBaseSlots = (nextVal: number) => {
    const clamped = clampBaseSlotsPerRow(nextVal);
    setWarehouseBaseSlotsPerRow(clamped);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(WAREHOUSE_BASE_SLOTS_KEY, String(clamped));
      } catch {
        // ignore storage error
      }
    }
  };

  const focusInboundBatchInput = () => {
    setTimeout(() => {
      inboundBatchInputRef.current?.focus();
    }, 20);
  };

  useEffect(() => {
    if (activeMode === "inbound" && !isCameraOpen) {
      focusInboundBatchInput();
    }
  }, [activeMode, inboundSourceType, isCameraOpen]);

  const handleSelectInboundBuilding = (building: string) => {
    const cleanB = building.trim().toUpperCase();
    if (cleanB !== inboundBuilding) {
      setInboundBuilding(cleanB);
      setInboundRow("");
      setInboundLevel(null);
      setInboundManualLocationOverride(null);
      setInboundLocation("");
    }
    focusInboundBatchInput();
  };

  const handleSelectInboundRow = (rowVal: string, shouldFocusBatch = true) => {
    const cleanR = rowVal.replace(/^\//, "").replace(/[^0-9A-Za-z]/g, "").trim().toUpperCase();
    if (cleanR !== inboundRow) {
      setInboundRow(cleanR);
      setInboundLevel(null);
      setInboundManualLocationOverride(null);
      setInboundLocation("");
    }
    if (shouldFocusBatch) {
      focusInboundBatchInput();
    }
  };

  // (handleSelectInboundLevel is declared below after inboundRowOccupancy so it can validate Level 2 base support live)

  // ============================================================================
  // Shared Machine & Order State for Tab 3 (เตรียมเบิก) and Tab 2 (จ่ายออก)
  // ============================================================================
  const [activeMachineCategory, setActiveMachineCategory] = useState<string>("ALL");
  const [selectedMachineId, setSelectedMachineId] = useState<string>("CL01");
  const [selectedOrderNo, setSelectedOrderNo] = useState<string>("");
  const [expandedOrderNos, setExpandedOrderNos] = useState<string[]>([]);
  const [pickListItemPages, setPickListItemPages] = useState<Record<string, number>>({});
  const [pickListItemPageSize, setPickListItemPageSize] = useState<number>(10);
  const [operatorItemPages, setOperatorItemPages] = useState<Record<string, number>>({});
  const [operatorItemPageSize, setOperatorItemPageSize] = useState<number>(10);

  // Outbound Pick List Scanner Modal State (เตรียมเบิก)
  const [isOutboundScannerOpen, setIsOutboundScannerOpen] = useState<boolean>(false);
  const [isOutboundCameraActive, setIsOutboundCameraActive] = useState<boolean>(false);
  const [outboundBarcodeInput, setOutboundBarcodeInput] = useState<string>("");
  const [outboundScanStatus, setOutboundScanStatus] = useState<{
    type: "idle" | "success" | "error" | "warning";
    message: string;
    scannedBatch?: string;
  }>({ type: "idle", message: "พร้อมสแกนบาร์โค้ด Batch เหล็กม้วน (10 หลัก)" });
  const outboundScannerInputRef = useRef<HTMLInputElement | null>(null);

  // Officer Import Pick List Modal State (+ เพิ่มใบสั่งเบิก)
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importOrderNo, setImportOrderNo] = useState<string>("");
  const [importMachineId, setImportMachineId] = useState<string>("CL01");
  const [rawTableText, setRawTableText] = useState<string>("");
  const [importError, setImportError] = useState<string>("");

  // Emergency Pre-Staging Modal State (เบิกฉุกเฉิน (TEMP) - เตรียมเบิกก่อนมี Order)
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState<boolean>(false);
  const [emergencyMachineId, setEmergencyMachineId] = useState<string>("CL01");
  const [emergencyTempOrderNo, setEmergencyTempOrderNo] = useState<string>("");
  const [emergencyBarcodeInput, setEmergencyBarcodeInput] = useState<string>("");
  const [emergencyScannedBatches, setEmergencyScannedBatches] = useState<
    Array<{
      batch: string;
      coilNo: string;
      grade: string;
      thickness: string;
      width: string;
      weightKg: number;
      sourceLocation: string;
      description: string;
      inStock: boolean;
    }>
  >([]);
  const [isEmergencyCameraActive, setIsEmergencyCameraActive] = useState<boolean>(false);
  const emergencyBarcodeRef = useRef<HTMLInputElement | null>(null);

  // Operator Receive / Machine Issue Scanner Modal State (จ่ายออก)
  const [isOperatorScannerOpen, setIsOperatorScannerOpen] = useState<boolean>(false);
  const [isOperatorCameraActive, setIsOperatorCameraActive] = useState<boolean>(false);
  const [operatorBarcodeInput, setOperatorBarcodeInput] = useState<string>("");
  const [operatorScanStatus, setOperatorScanStatus] = useState<{
    type: "idle" | "success" | "error" | "warning";
    message: string;
    scannedBatch?: string;
  }>({ type: "idle", message: "พร้อมสแกนบาร์โค้ด Batch รับงานเข้าเครื่องจักร" });
  const operatorScannerInputRef = useRef<HTMLInputElement | null>(null);
  const [operatorWarningModal, setOperatorWarningModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    detail?: string;
  }>({ isOpen: false, title: "", message: "" });
  const [deleteModalOrderNo, setDeleteModalOrderNo] = useState<string | null>(null);
  const [dismissedOperatorOrders, setDismissedOperatorOrders] = useState<string[]>([]);
  const [issueMachineId, setIssueMachineId] = useState<string>("CL01");
  const [stagingMachineId, setStagingMachineId] = useState<string>("CL01");

  // ============================================================================
  // Tab 4 State: ย้าย Layout (Relocate Layout)
  // ============================================================================
  const [relocateTargetLocation, setRelocateTargetLocation] = useState<string>("CL2-A01");
  const [relocateScanInput, setRelocateScanInput] = useState<string>("");
  const [selectedRelocateBatches, setSelectedRelocateBatches] = useState<string[]>([]);
  const [newZoneCode, setNewZoneCode] = useState<string>("");
  const [newZoneName, setNewZoneName] = useState<string>("");
  const [newZoneCapTons, setNewZoneCapTons] = useState<string>("350");
  const [isAddZoneModalOpen, setIsAddZoneModalOpen] = useState<boolean>(false);

  // ============================================================================
  // Tab 5 State: สต๊อก (Stock Balance & SAP Stock Upload)
  // ============================================================================
  const [stockSearch, setStockSearch] = useState<string>("");
  const [stockBayFilter, setStockBayFilter] = useState<string>("ALL");
  const [stockGradeFilter, setStockGradeFilter] = useState<string>("ALL");
  const [stockStatusFilter, setStockStatusFilter] = useState<"ACTIVE" | "available" | "staged" | "issued" | "ALL">("ACTIVE");
  const [coilSapMap, setCoilSapMap] = useState<Map<string, CoilSapMasterItem>>(() => new Map());
  const [coilSapChunkCount, setCoilSapChunkCount] = useState<number>(0);
  const [isSapModalOpen, setIsSapModalOpen] = useState<boolean>(false);
  const [sapRawText, setSapRawText] = useState<string>("");
  const [isSapProcessing, setIsSapProcessing] = useState<boolean>(false);
  const [sapProgress, setSapProgress] = useState<number>(0);
  const [sapCurrentStep, setSapCurrentStep] = useState<number>(1);
  const [sapTotalCount, setSapTotalCount] = useState<number>(0);
  const [sapProcessedCount, setSapProcessedCount] = useState<number>(0);
  const [createMissingStockOnSapImport, setCreateMissingStockOnSapImport] = useState<boolean>(true);
  const sapFileInputRef = useRef<HTMLInputElement | null>(null);
  const sapTextAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // ============================================================================
  // Derived Metrics & Filtered Lists
  // ============================================================================
  const activeStockCoils = useMemo(
    () => coilStock.filter((c) => c.status !== "issued"),
    [coilStock]
  );

  const hasSelectedInboundDoor = Boolean(inboundBuilding.trim());
  const hasSelectedInboundRow = hasSelectedInboundDoor && Boolean(inboundRow.trim());

  // Live Door/Row/Level/Seq occupancy & automatic recommendation (computed only after Door + Row are selected)
  const inboundRowOccupancy = useMemo(() => {
    if (!hasSelectedInboundDoor || !hasSelectedInboundRow) return null;
    return getRowLevelOccupancy(
      inboundBuilding,
      inboundRow,
      activeStockCoils,
      warehouseBaseSlotsPerRow
    );
  }, [
    hasSelectedInboundDoor,
    hasSelectedInboundRow,
    inboundBuilding,
    inboundRow,
    activeStockCoils,
    warehouseBaseSlotsPerRow,
  ]);

  // Quick occupancy counts per Door and per Row (for Step 2 & Step 3 badges)
  const inboundDoorCoilCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of activeStockCoils) {
      const p = parseCoilLocationTo3D(c.location);
      counts[p.door] = (counts[p.door] || 0) + 1;
    }
    return counts;
  }, [activeStockCoils]);

  const inboundSelectedDoorRowCounts = useMemo(() => {
    if (!hasSelectedInboundDoor) return {};
    const targetDoor = inboundBuilding.trim().toUpperCase();
    const counts: Record<number, number> = {};
    for (const c of activeStockCoils) {
      const p = parseCoilLocationTo3D(c.location);
      if (p.door === targetDoor) {
        counts[p.row] = (counts[p.row] || 0) + 1;
      }
    }
    return counts;
  }, [activeStockCoils, hasSelectedInboundDoor, inboundBuilding]);

  const effectiveInboundLevel: StackLevel | null = useMemo(() => {
    if (!inboundRowOccupancy || inboundLevel === null) {
      return null;
    }
    // Strictly enforce base support for upper levels (2..4): never stay on an unsupported level
    if (inboundLevel >= 2 && !inboundRowOccupancy.levels[inboundLevel].canPlace) {
      return inboundRowOccupancy.recommendedLevel;
    }
    // If operator chose a level that just became completely full, auto-advance to recommended level
    if (
      inboundRowOccupancy.levels[inboundLevel].isFull &&
      inboundRowOccupancy.recommendedLevel !== inboundLevel &&
      !inboundRowOccupancy.isRowCompletelyFull
    ) {
      return inboundRowOccupancy.recommendedLevel;
    }
    return inboundLevel;
  }, [inboundLevel, inboundRowOccupancy]);

  const effectiveInboundSeq: number | null =
    inboundRowOccupancy && effectiveInboundLevel !== null
      ? inboundRowOccupancy.levels[effectiveInboundLevel].nextSeq ??
        inboundRowOccupancy.level1.nextSeq
      : null;

  const autoComposedInboundLocation =
    inboundRowOccupancy && effectiveInboundLevel !== null && effectiveInboundSeq !== null
      ? `${inboundRowOccupancy.door}/${inboundRowOccupancy.row}/${effectiveInboundLevel}/${effectiveInboundSeq}`
      : "";

  const effectiveInboundLocation =
    inboundRowOccupancy && effectiveInboundLevel !== null
      ? inboundManualLocationOverride !== null && inboundManualLocationOverride.trim() !== ""
        ? inboundManualLocationOverride.trim().toUpperCase()
        : autoComposedInboundLocation
      : "";

  const isInboundLocationComplete = Boolean(
    hasSelectedInboundDoor &&
      hasSelectedInboundRow &&
      effectiveInboundLevel !== null &&
      effectiveInboundLocation
  );

  // Synced active coordinates (Door / Row / Level / Seq) derived from effectiveInboundLocation
  const selectedInboundCoords = useMemo(() => {
    if (!inboundRowOccupancy || !effectiveInboundLocation || effectiveInboundLevel === null) {
      return null;
    }
    const raw = effectiveInboundLocation.trim().toUpperCase();
    const parsed = parseCoilLocationTo3D(raw);
    const parts = raw.includes("/") ? raw.split("/").map((p) => p.trim()) : [];
    const rawLvNum = parts[2] ? parseInt(parts[2].replace(/\D/g, ""), 10) : NaN;
    const rawSeqNum = parts[3] ? parseInt(parts[3].replace(/\D/g, ""), 10) : NaN;

    const levelNum =
      Number.isFinite(rawLvNum) && rawLvNum >= 1
        ? rawLvNum
        : parsed.explicitLevel ?? effectiveInboundLevel;

    const validLevel: StackLevel | null =
      levelNum >= 1 && levelNum <= MAX_STACK_LEVEL ? (levelNum as StackLevel) : null;

    const seqNum =
      Number.isFinite(rawSeqNum) && rawSeqNum >= 1
        ? rawSeqNum
        : parsed.explicitSlotIndex ??
          (validLevel
            ? inboundRowOccupancy.levels[validLevel].nextSeq ?? effectiveInboundSeq
            : null);

    const matchesCurrentRow =
      parsed.door === inboundRowOccupancy.door && parsed.row === inboundRowOccupancy.row;

    const isAutoRecommended =
      matchesCurrentRow &&
      validLevel === inboundRowOccupancy.recommendedLevel &&
      seqNum === inboundRowOccupancy.recommendedSeq;

    const isOccupiedSlot =
      matchesCurrentRow &&
      validLevel !== null &&
      seqNum !== null &&
      inboundRowOccupancy.levels[validLevel].occupiedSlots.includes(seqNum);

    return {
      door: parsed.door,
      row: parsed.row,
      level: levelNum,
      validLevel,
      seq: seqNum,
      matchesCurrentRow,
      isAutoRecommended,
      isOccupiedSlot,
      fullCode: raw || autoComposedInboundLocation,
    };
  }, [
    effectiveInboundLocation,
    autoComposedInboundLocation,
    effectiveInboundLevel,
    effectiveInboundSeq,
    inboundRowOccupancy,
  ]);

  const inboundPlacementValidation = useMemo(() => {
    if (!isInboundLocationComplete) return null;
    return validateCoilPlacementLocation(
      effectiveInboundLocation,
      activeStockCoils,
      inboundScanInput.trim() ? [inboundScanInput.trim()] : [],
      warehouseBaseSlotsPerRow
    );
  }, [
    isInboundLocationComplete,
    effectiveInboundLocation,
    activeStockCoils,
    inboundScanInput,
    warehouseBaseSlotsPerRow,
  ]);

  const relocatePlacementValidation = useMemo(() => {
    const target = relocateTargetLocation.trim().toUpperCase();
    if (!target) return null;
    return validateCoilPlacementLocation(
      target,
      activeStockCoils,
      selectedRelocateBatches,
      warehouseBaseSlotsPerRow
    );
  }, [relocateTargetLocation, activeStockCoils, selectedRelocateBatches, warehouseBaseSlotsPerRow]);

  const handleSelectInboundLevel = (level: StackLevel) => {
    if (!inboundRowOccupancy) return;
    const lvInfo = inboundRowOccupancy.levels[level];
    if (level >= 2 && !lvInfo.canPlace) {
      const lowerLv = level - 1;
      playBeep("error");
      showToast(
        isThai
          ? lvInfo.isFull
            ? `ไม่สามารถวางชั้นที่ ${level} แถว ${inboundRowOccupancy.door}/${inboundRowOccupancy.row} ได้ — ชั้นที่ ${level} เต็มแล้ว`
            : `ไม่สามารถวางชั้นที่ ${level} ได้ — ต้องมีฐานชั้นที่ ${lowerLv} วางติดกันอย่างน้อย 2 ลูกก่อน (เช่น ชั้น ${lowerLv} ลูกที่ 1 และลูกที่ 2)`
          : lvInfo.isFull
          ? `Level ${level} in ${inboundRowOccupancy.door}/${inboundRowOccupancy.row} is full`
          : `Cannot select Level ${level} — requires at least 2 adjacent Level ${lowerLv} base coils`,
        "error"
      );
      focusInboundBatchInput();
      return;
    }
    setInboundLevel(level);
    setInboundManualLocationOverride(null);
    focusInboundBatchInput();
  };

  // Keep already-selected inboundLevel valid if live stock changes (never auto-selects when null)
  useEffect(() => {
    if (!inboundRowOccupancy || inboundLevel === null) return;
    if (inboundLevel >= 2 && !inboundRowOccupancy.levels[inboundLevel].canPlace) {
      setInboundLevel(inboundRowOccupancy.recommendedLevel);
    } else if (
      inboundRowOccupancy.levels[inboundLevel].isFull &&
      inboundRowOccupancy.recommendedLevel !== inboundLevel &&
      !inboundRowOccupancy.isRowCompletelyFull
    ) {
      setInboundLevel(inboundRowOccupancy.recommendedLevel);
    }
  }, [inboundLevel, inboundRowOccupancy]);

  useEffect(() => {
    if (inboundManualLocationOverride === null) {
      setInboundLocation(autoComposedInboundLocation);
    }
  }, [autoComposedInboundLocation, inboundManualLocationOverride]);

  const availableCoils = useMemo(
    () => activeStockCoils.filter((c) => c.status === "available"),
    [activeStockCoils]
  );

  const stagedCoils = useMemo(
    () => activeStockCoils.filter((c) => c.status === "staged"),
    [activeStockCoils]
  );

  const totalActiveWeightKg = useMemo(
    () => activeStockCoils.reduce((sum, c) => sum + (Number(c.weightKg) || 0), 0),
    [activeStockCoils]
  );

  const totalActiveTons = useMemo(
    () => Number((totalActiveWeightKg / 1000).toFixed(2)),
    [totalActiveWeightKg]
  );

  const bayUtilizationList = useMemo(() => {
    return layoutZones.map((zone) => {
      const coilsInZone = activeStockCoils.filter(
        (c) => (c.location || "").toUpperCase() === zone.bayCode.toUpperCase()
      );
      const weightKg = coilsInZone.reduce((s, c) => s + (Number(c.weightKg) || 0), 0);
      const weightTons = Number((weightKg / 1000).toFixed(2));
      const percent =
        zone.maxCapacityTons > 0
          ? Math.min(100, Math.round((weightTons / zone.maxCapacityTons) * 100))
          : 0;
      return {
        ...zone,
        coilCount: coilsInZone.length,
        weightKg,
        weightTons,
        percent,
      };
    });
  }, [layoutZones, activeStockCoils]);

  // ============================================================================
  // Handlers for Tab 1: +รับเข้า (Inbound)
  // ============================================================================
  const handleInboundSubmit = async (e?: React.FormEvent, scannedBarcodeOverride?: string) => {
    e?.preventDefault();
    const rawSubmitted = String(scannedBarcodeOverride ?? inboundScanInput)
      .replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, "")
      .toUpperCase();

    if (!rawSubmitted) {
      showToast(isThai ? "กรุณาสแกนหรือระบุรหัส Batch" : "Please scan or enter Batch barcode", "warning");
      playBeep("warning");
      focusInboundBatchInput();
      return;
    }

    if (rawSubmitted.length > 10) {
      showToast(
        isThai
          ? `รหัส Batch เกิน 10 หลัก (${rawSubmitted.length} หลัก) — ระบบจำกัดไม่เกิน 10 หลัก`
          : `Batch code exceeds 10 characters (${rawSubmitted.length})`,
        "error"
      );
      playBeep("error");
      focusInboundBatchInput();
      return;
    }

    if (!/^[A-Z0-9]{1,10}$/.test(rawSubmitted)) {
      showToast(
        isThai
          ? "รูปแบบรหัส Batch ไม่ถูกต้อง (รับเฉพาะตัวอักษรภาษาอังกฤษ A-Z และตัวเลข 0-9 ไม่รับอักษรพิเศษหรือช่องว่าง)"
          : "Invalid Batch format (only A-Z and 0-9 allowed, no spaces or special characters)",
        "error"
      );
      playBeep("error");
      focusInboundBatchInput();
      return;
    }

    // Strictly block saving if Door, Row, or Level has not been selected yet
    if (!hasSelectedInboundDoor) {
      showToast(
        isThai
          ? "กรุณาเลือกประตูที่วาง (ขั้นตอนที่ 2) ก่อนบันทึกรับเข้า"
          : "Please select a Door (Step 2) before saving",
        "warning"
      );
      playBeep("warning");
      focusInboundBatchInput();
      return;
    }
    if (!hasSelectedInboundRow) {
      showToast(
        isThai
          ? `กรุณาเลือกแถวที่จะวางของประตู ${inboundBuilding} (ขั้นตอนที่ 3) ก่อนบันทึกรับเข้า`
          : `Please select a Row in Door ${inboundBuilding} (Step 3) before saving`,
        "warning"
      );
      playBeep("warning");
      focusInboundBatchInput();
      return;
    }
    if (!isInboundLocationComplete || !effectiveInboundLocation) {
      showToast(
        isThai
          ? `กรุณาเลือกชั้นหรือช่องวางในแถว ${inboundBuilding}/${inboundRow} (ขั้นตอนที่ 4) ก่อนบันทึกรับเข้า`
          : `Please select a Level or Slot in ${inboundBuilding}/${inboundRow} (Step 4) before saving`,
        "warning"
      );
      playBeep("warning");
      focusInboundBatchInput();
      return;
    }

    const rawCode = rawSubmitted;
    const finalLocation = effectiveInboundLocation;

    // Strictly enforce Level 2+ pyramid base-support rule before saving
    const placementValidation = validateCoilPlacementLocation(
      finalLocation,
      activeStockCoils,
      [rawCode],
      warehouseBaseSlotsPerRow
    );
    if (!placementValidation.valid) {
      playBeep("error");
      showToast(
        isThai
          ? placementValidation.reasonTh ||
              "ไม่สามารถวางชั้นที่ 2 ได้ — ต้องมีฐานชั้นที่ 1 รองรับครบ 2 ลูกก่อน"
          : placementValidation.reasonEn ||
              "Cannot place on Level 2 — requires 2 supporting Level 1 base coils",
        "error"
      );
      focusInboundBatchInput();
      return;
    }

    const existingRecord = coilStock.find((c) => c.batch.toUpperCase() === rawCode);
    const sapMaster = coilSapMap.get(rawCode);
    const hasExistingSap = Boolean(existingRecord?.hasSapData || sapMaster);
    const preservedWeight =
      sapMaster && sapMaster.weightKg > 0
        ? sapMaster.weightKg
        : hasExistingSap && existingRecord?.weightKg && existingRecord.weightKg > 0
        ? existingRecord.weightKg
        : 0;

    // Immediately clear input & reset manual location override so next scan auto-advances sequence
    setInboundScanInput("");
    setInboundManualLocationOverride(null);
    focusInboundBatchInput();

    const { timestamp } = formatNowTimestamp();
    const saved = await saveCoilInboundToCloud({
      id: `COIL-${rawCode}`,
      batch: rawCode,
      coilNo:
        sapMaster?.coilNo && sapMaster.coilNo !== "-"
          ? sapMaster.coilNo
          : hasExistingSap && existingRecord?.coilNo
          ? existingRecord.coilNo
          : "-",
      location: finalLocation,
      status: "available",
      weightKg: preservedWeight,
      initialWeightKg:
        hasExistingSap && existingRecord?.initialWeightKg && existingRecord.initialWeightKg > 0
          ? existingRecord.initialWeightKg
          : preservedWeight,
      certThickness:
        sapMaster?.certThickness && sapMaster.certThickness !== "-"
          ? sapMaster.certThickness
          : hasExistingSap && existingRecord?.certThickness
          ? formatSapThickness(existingRecord.certThickness)
          : "-",
      targetThickness:
        sapMaster?.targetThickness && sapMaster.targetThickness !== "-"
          ? sapMaster.targetThickness
          : hasExistingSap && existingRecord?.targetThickness
          ? formatSapThickness(existingRecord.targetThickness)
          : "-",
      width:
        sapMaster?.width && sapMaster.width !== "-"
          ? sapMaster.width
          : hasExistingSap && existingRecord?.width
          ? formatSapWidth(existingRecord.width)
          : "-",
      grade:
        sapMaster?.grade && sapMaster.grade !== "-"
          ? sapMaster.grade
          : hasExistingSap && existingRecord?.grade
          ? existingRecord.grade
          : "-",
      manufacturer:
        sapMaster?.manufacturer && sapMaster.manufacturer !== "-"
          ? sapMaster.manufacturer
          : hasExistingSap && existingRecord?.manufacturer
          ? existingRecord.manufacturer
          : "-",
      supplier:
        sapMaster?.manufacturer && sapMaster.manufacturer !== "-"
          ? sapMaster.manufacturer
          : hasExistingSap && existingRecord?.supplier
          ? existingRecord.supplier
          : "-",
      machine: inboundSourceType === "internal" ? inboundMachine : "EXTERNAL",
      inboundType: inboundSourceType,
      orderNo: existingRecord?.orderNo || "",
      materialNo: sapMaster?.materialNo || (hasExistingSap ? existingRecord?.materialNo || "" : ""),
      salesDoc: sapMaster?.salesDoc || (hasExistingSap ? existingRecord?.salesDoc || "" : ""),
      qualityClass:
        sapMaster?.qualityClass || (hasExistingSap ? existingRecord?.qualityClass || "-" : "-"),
      description:
        sapMaster?.description || (hasExistingSap ? existingRecord?.description || "" : ""),
      skinpass: sapMaster?.skinpass || (hasExistingSap ? existingRecord?.skinpass || "" : ""),
      storageLocation:
        sapMaster?.storageLocation || (hasExistingSap ? existingRecord?.storageLocation || "" : ""),
      conditionText:
        sapMaster?.conditionText || (hasExistingSap ? existingRecord?.conditionText || "" : ""),
      heatNo: sapMaster?.heatNo || (hasExistingSap ? existingRecord?.heatNo || "" : ""),
      actualWeightKg:
        sapMaster?.actualWeightKg || (hasExistingSap ? existingRecord?.actualWeightKg || 0 : 0),
      hasSapData: hasExistingSap,
      scanTimestamp: timestamp,
    });

    playBeep("success");
    showToast(
      isThai
        ? `รับเข้า Batch ${saved.batch} -> Location ${saved.location} สำเร็จ`
        : `Inbound Batch ${saved.batch} saved to ${saved.location}`,
      "success"
    );
    onLogTransaction?.(
      `Inbound Coil ${saved.batch} -> ${saved.location}`,
      saved.batch,
      "Completed"
    );
    focusInboundBatchInput();
  };

  // ============================================================================
  // Derived Lists & Helpers for Tab 3 (-เตรียมเบิก) and Tab 2 (จ่ายออก)
  // ============================================================================
  const machineFilteredOrders = useMemo(
    () => stagingOrders.filter((o) => o.machineId === selectedMachineId),
    [stagingOrders, selectedMachineId]
  );

  // Sync selectedOrderNo when machine changes or orders update
  useEffect(() => {
    const ordersForMachine = stagingOrders.filter((o) => o.machineId === selectedMachineId);
    if (ordersForMachine.length === 0) {
      if (selectedOrderNo !== "") setSelectedOrderNo("");
    } else if (!ordersForMachine.some((o) => o.orderNo === selectedOrderNo)) {
      setSelectedOrderNo(ordersForMachine[0].orderNo);
    }
  }, [selectedMachineId, stagingOrders, selectedOrderNo]);

  const activeOrder = useMemo(
    () =>
      machineFilteredOrders.find((o) => o.orderNo === selectedOrderNo) ||
      machineFilteredOrders[0] ||
      null,
    [machineFilteredOrders, selectedOrderNo]
  );

  const toggleOrderExpand = (orderNo: string) => {
    setExpandedOrderNos((prev) =>
      prev.includes(orderNo) ? prev.filter((no) => no !== orderNo) : [...prev, orderNo]
    );
  };

  const parsedPreviewItems = useMemo(() => {
    return parseRawCoilPickListText(rawTableText);
  }, [rawTableText]);

  // Auto-focus scanner inputs when modals open
  useEffect(() => {
    if (isOutboundScannerOpen) {
      const t = setTimeout(() => outboundScannerInputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [isOutboundScannerOpen]);

  useEffect(() => {
    if (isOperatorScannerOpen) {
      const t = setTimeout(() => operatorScannerInputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [isOperatorScannerOpen]);

  useEffect(() => {
    if (isEmergencyModalOpen) {
      const t = setTimeout(() => emergencyBarcodeRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [isEmergencyModalOpen]);

  const enrichBatchFromCoilStockOrSap = (batchCode: string) => {
    const clean = batchCode.trim().toUpperCase();
    const stockRec = coilStock.find((c) => c.batch.toUpperCase() === clean);
    const sapRec = coilSapMap.get(clean);
    const hasRealLocation =
      stockRec &&
      stockRec.location &&
      stockRec.location.trim() !== "" &&
      stockRec.location.trim() !== "-" &&
      !stockRec.location.includes("รอระบุ") &&
      !stockRec.location.includes("รอสแกน");

    return {
      stockRec,
      sapRec,
      coilNo: stockRec?.coilNo && stockRec.coilNo !== "-" ? stockRec.coilNo : sapRec?.coilNo || "-",
      grade: stockRec?.grade && stockRec.grade !== "-" ? stockRec.grade : sapRec?.grade || "-",
      thickness:
        stockRec?.certThickness && stockRec.certThickness !== "-"
          ? stockRec.certThickness
          : sapRec?.certThickness || "-",
      width: stockRec?.width && stockRec.width !== "-" ? stockRec.width : sapRec?.width || "-",
      weightKg:
        stockRec && Number(stockRec.weightKg) > 0
          ? Number(stockRec.weightKg)
          : sapRec && Number(sapRec.weightKg) > 0
          ? Number(sapRec.weightKg)
          : 0,
      sourceLocation: hasRealLocation ? stockRec!.location : "-",
      description: stockRec?.description || sapRec?.description || "",
      materialNo: stockRec?.materialNo || sapRec?.materialNo || "-",
      storageLocation: stockRec?.storageLocation || sapRec?.storageLocation || "1101",
    };
  };

  // ============================================================================
  // Handlers for Tab 3: -เตรียมเบิก (Pick List Staging & Emergency TEMP)
  // ============================================================================
  const processOutboundBarcodeScan = async (rawCode: string) => {
    const cleanCode = cleanBarcode(rawCode).toUpperCase();
    if (!cleanCode) return;

    if (!/^[A-Z0-9]{10}$/.test(cleanCode)) {
      playBeep("error");
      setOutboundScanStatus({
        type: "error",
        message: isThai
          ? `ปฏิเสธ: รหัส "${cleanCode}" (${cleanCode.length} หลัก) ไม่ใช่รหัส Batch 10 หลัก`
          : `Invalid 10-digit Batch code: "${cleanCode}"`,
        scannedBatch: cleanCode,
      });
      setOutboundBarcodeInput("");
      setTimeout(() => outboundScannerInputRef.current?.focus(), 60);
      return;
    }

    if (!activeOrder) {
      playBeep("error");
      setOutboundScanStatus({
        type: "error",
        message: isThai ? "กรุณาเลือกใบสั่งเบิก (Order) ก่อนทำการสแกน" : "Please select a Pick List Order first",
      });
      setOutboundBarcodeInput("");
      return;
    }

    const targetItem = activeOrder.items.find(
      (item) => item.batch.toUpperCase() === cleanCode
    );

    if (!targetItem) {
      playBeep("error");
      setOutboundScanStatus({
        type: "error",
        message: isThai
          ? `ไม่พบรหัส Batch [${cleanCode}] ในใบสั่งเบิก Order ${activeOrder.orderNo} (เครื่อง ${activeOrder.machineId})!`
          : `Batch [${cleanCode}] is not in Order ${activeOrder.orderNo}!`,
        scannedBatch: cleanCode,
      });
      setOutboundBarcodeInput("");
      setTimeout(() => outboundScannerInputRef.current?.focus(), 60);
      return;
    }

    if (targetItem.status === "staged" || targetItem.status === "issued") {
      playBeep("warning");
      setOutboundScanStatus({
        type: "warning",
        message: isThai
          ? `แจ้งเตือน: รหัส Batch [${cleanCode}] ถูกสแกนเตรียมเบิกไปแล้ว (${
              targetItem.status === "issued" ? "จ่ายแล้ว" : "เตรียมแล้ว"
            })`
          : `Batch [${cleanCode}] was already scanned (${targetItem.status})`,
        scannedBatch: cleanCode,
      });
      setOutboundBarcodeInput("");
      setTimeout(() => outboundScannerInputRef.current?.focus(), 60);
      return;
    }

    // Enrich with latest stock location/weight if available, without blocking if location is not yet scanned
    const enriched = enrichBatchFromCoilStockOrSap(cleanCode);
    const { timestamp } = formatNowTimestamp();

    const updatedItems: CoilStagingItem[] = activeOrder.items.map((itm) =>
      itm.batch.toUpperCase() === cleanCode
        ? {
            ...itm,
            status: "staged",
            stagedAt: timestamp,
            coilNo: itm.coilNo && itm.coilNo !== "-" ? itm.coilNo : enriched.coilNo,
            grade: itm.grade && itm.grade !== "-" ? itm.grade : enriched.grade,
            thickness: itm.thickness && itm.thickness !== "-" ? itm.thickness : enriched.thickness,
            width: itm.width && itm.width !== "-" ? itm.width : enriched.width,
            weightKg: Number(itm.weightKg) > 0 ? Number(itm.weightKg) : enriched.weightKg,
            sourceLocation:
              enriched.sourceLocation !== "-" ? enriched.sourceLocation : itm.sourceLocation || "-",
            description: itm.description || enriched.description,
          }
        : itm
    );

    const updatedOrder: CoilStagingOrder = {
      ...activeOrder,
      status: "in_progress",
      items: updatedItems,
      updatedAt: new Date().toISOString(),
    };

    // Expand this order table so user sees the updated status
    setExpandedOrderNos((prev) =>
      prev.includes(activeOrder.orderNo) ? prev : [...prev, activeOrder.orderNo]
    );

    const remainingCount = updatedItems.filter((i) => i.status === "pending").length;
    playBeep("success");
    setOutboundScanStatus({
      type: "success",
      message: isThai
        ? `สแกนสำเร็จ! Batch [${cleanCode}] -> เปลี่ยนสถานะเป็น "เตรียมแล้ว" (เหลือรอเตรียมอีก ${remainingCount} รายการ)`
        : `Scanned Batch [${cleanCode}] -> Staged (${remainingCount} remaining)`,
      scannedBatch: cleanCode,
    });
    setOutboundBarcodeInput("");
    setTimeout(() => outboundScannerInputRef.current?.focus(), 60);

    await saveCoilStagingOrderToCloud(updatedOrder);
    onLogTransaction?.(
      `Prepared Coil PickList Batch ${cleanCode} for Order ${activeOrder.orderNo} (${activeOrder.machineId})`,
      cleanCode,
      "Completed"
    );
  };

  const handleOutboundBarcodeScan = (e: React.FormEvent) => {
    e.preventDefault();
    processOutboundBarcodeScan(outboundBarcodeInput);
  };

  const handleFinishOutboundScan = () => {
    setIsOutboundCameraActive(false);
    setIsOutboundScannerOpen(false);
    if (!activeOrder) return;
    const preparedCount = activeOrder.items.filter(
      (i) => i.status === "staged" || i.status === "issued"
    ).length;
    showToast(
      isThai
        ? `บันทึกการสแกนเตรียมเบิก Order ${activeOrder.orderNo} เรียบร้อย (${preparedCount}/${activeOrder.items.length} รายการ)`
        : `Saved Pick List scan progress (${preparedCount}/${activeOrder.items.length})`,
      "success"
    );
  };

  const handleSaveOutboundDraft = async (orderNo: string) => {
    const targetOrd = stagingOrders.find((o) => o.orderNo === orderNo);
    if (!targetOrd) return;
    const preparedCount = targetOrd.items.filter(
      (i) => i.status === "staged" || i.status === "issued"
    ).length;
    await saveCoilStagingOrderToCloud({
      ...targetOrd,
      status: "in_progress",
      updatedAt: new Date().toISOString(),
    });
    playBeep("success");
    showToast(
      isThai
        ? `บันทึกใบสั่งเบิก Order ${orderNo} สำเร็จ (เตรียมแล้ว ${preparedCount}/${targetOrd.items.length} รายการ) สามารถกลับมาสแกนต่อได้`
        : `Saved Draft Order ${orderNo} (${preparedCount}/${targetOrd.items.length} items)`,
      "success"
    );
  };

  const handleConfirmOutboundFinal = async (orderNo: string) => {
    const targetOrd = stagingOrders.find((o) => o.orderNo === orderNo);
    if (!targetOrd) return;
    const preparedCount = targetOrd.items.filter(
      (i) => i.status === "staged" || i.status === "issued"
    ).length;
    const totalCount = targetOrd.items.length;

    await saveCoilStagingOrderToCloud({
      ...targetOrd,
      status: "in_progress",
      updatedAt: new Date().toISOString(),
    });
    playBeep("success");
    onLogTransaction?.(
      `Confirmed Coil Outbound Order ${orderNo} (${preparedCount}/${totalCount} items) for ${targetOrd.machineId}`,
      orderNo,
      "Completed"
    );

    await Swal.fire({
      icon: "success",
      title: isThai ? "ยืนยันการเตรียมเบิกสำเร็จ!" : "Staging Confirmed!",
      html: isThai
        ? `<div class="text-xs text-left space-y-1">
            <div><b>เลขที่ใบสั่งเบิก (Order):</b> ${orderNo}</div>
            <div><b>เครื่องจักร (Machine):</b> ${targetOrd.machineId}</div>
            <div><b>รายการที่เตรียมแล้ว:</b> <span class="text-emerald-600 font-bold">${preparedCount} / ${totalCount} รายการ</span></div>
            <div class="text-slate-500 pt-1">ส่งข้อมูลไปยังหน้า "จ่ายออก" ของเครื่อง ${targetOrd.machineId} เรียบร้อยแล้ว</div>
          </div>`
        : `Order ${orderNo} confirmed (${preparedCount}/${totalCount} items) for ${targetOrd.machineId}.`,
      confirmButtonColor: "#10b981",
      confirmButtonText: isThai ? "รับทราบ" : "OK",
    });
  };

  // Save Imported Pick List Order(s) (+ เพิ่มใบสั่งเบิก) with Automatic Retroactive TEMP Matching
  const handleSaveImportedPickList = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError("");

    const defaultOrderNo = importOrderNo.trim().toUpperCase();
    const hasPerRowOrders =
      parsedPreviewItems.length > 0 &&
      parsedPreviewItems.every((item) => Boolean(item.orderNo && item.orderNo.trim()));

    if (!defaultOrderNo && !hasPerRowOrders) {
      setImportError(
        isThai
          ? "กรุณาระบุหมายเลขใบสั่งเบิก (Order No.) หรือวางข้อมูลตารางที่มีคอลัมน์ Order"
          : "Please enter Order No. or paste table containing Order column"
      );
      return;
    }

    if (parsedPreviewItems.length === 0) {
      setImportError(
        isThai
          ? "ไม่พบข้อมูลรายการ Batch 10 หลักในตารางที่วาง กรุณาตรวจสอบข้อมูลอีกครั้ง"
          : "No valid 10-digit Batch rows found in the pasted table"
      );
      return;
    }

    const groupedByOrder = new Map<string, ParsedCoilPickListItem[]>();
    parsedPreviewItems.forEach((item) => {
      const ordKey = (item.orderNo?.trim() || defaultOrderNo).toUpperCase();
      if (!ordKey) return;
      if (!groupedByOrder.has(ordKey)) {
        groupedByOrder.set(ordKey, []);
      }
      groupedByOrder.get(ordKey)!.push(item);
    });

    if (groupedByOrder.size === 0) {
      setImportError(isThai ? "ไม่สามารถระบุหมายเลข Order ได้" : "Could not determine Order No.");
      return;
    }

    const duplicateOrderNos = Array.from(groupedByOrder.keys()).filter((ordNo) =>
      stagingOrders.some((o) => o.orderNo.toUpperCase() === ordNo.toUpperCase())
    );
    if (duplicateOrderNos.length > 0) {
      setImportError(
        isThai
          ? `หมายเลข Order [${duplicateOrderNos.join(", ")}] มีอยู่ในระบบแล้ว กรุณาใช้หมายเลขอื่น หรือลบใบเดิมก่อน`
          : `Order [${duplicateOrderNos.join(", ")}] already exists.`
      );
      return;
    }

    // Build lookup of emergency TEMP pre-staged batches for this machine
    const tempOrderItemsByBatch = new Map<
      string,
      { tempOrderNo: string; item: CoilStagingItem }
    >();
    stagingOrders
      .filter((o) => o.isTemporary && o.machineId === importMachineId)
      .forEach((tempOrd) => {
        tempOrd.items.forEach((itm) => {
          tempOrderItemsByBatch.set(itm.batch.toUpperCase(), {
            tempOrderNo: tempOrd.orderNo,
            item: itm,
          });
        });
      });

    let autoMatchedBatchCount = 0;
    const matchedTempOrderNos = new Set<string>();
    const newOrdersToAdd: CoilStagingOrder[] = [];
    const { dateYmd, timeHms, timestamp } = formatNowTimestamp();

    groupedByOrder.forEach((itemsForOrder, ordNo) => {
      const stagingItems: CoilStagingItem[] = itemsForOrder.map((parsed, idx) => {
        const cleanB = parsed.batch.trim().toUpperCase();
        const preStagedMatch = tempOrderItemsByBatch.get(cleanB);
        const enriched = enrichBatchFromCoilStockOrSap(cleanB);

        if (preStagedMatch) {
          autoMatchedBatchCount++;
          matchedTempOrderNos.add(preStagedMatch.tempOrderNo);
        }

        const resolvedWeight =
          Number(parsed.requirementQty) > 0
            ? Number(parsed.requirementQty)
            : enriched.weightKg > 0
            ? enriched.weightKg
            : preStagedMatch?.item.weightKg || 0;

        return {
          id: `CSI-${ordNo}-${cleanB}-${idx + 1}`,
          batch: cleanB,
          coilNo: enriched.coilNo,
          grade: enriched.grade,
          thickness: enriched.thickness,
          width: enriched.width,
          weightKg: resolvedWeight,
          sourceLocation:
            preStagedMatch?.item.sourceLocation && preStagedMatch.item.sourceLocation !== "-"
              ? preStagedMatch.item.sourceLocation
              : enriched.sourceLocation,
          status: preStagedMatch
            ? preStagedMatch.item.status === "issued"
              ? "issued"
              : "staged"
            : "pending",
          stagedAt: preStagedMatch?.item.stagedAt || (preStagedMatch ? timestamp : undefined),
          issuedAt: preStagedMatch?.item.issuedAt,
          description:
            parsed.materialDescription && parsed.materialDescription !== "-"
              ? parsed.materialDescription
              : enriched.description,
          material:
            parsed.material && parsed.material !== "-" ? parsed.material : enriched.materialNo,
          bomItem: parsed.bomItem || String((idx + 1) * 10).padStart(4, "0"),
          unit: parsed.unit || "KG",
          storageLocation: parsed.storageLocation || enriched.storageLocation || "1101",
          tempOrderRef: preStagedMatch ? preStagedMatch.tempOrderNo : undefined,
        };
      });

      const allIssued = stagingItems.length > 0 && stagingItems.every((i) => i.status === "issued");
      newOrdersToAdd.push({
        id: `CSTG-${ordNo}`,
        orderNo: ordNo,
        machineId: importMachineId,
        createdDate: dateYmd,
        createdAt: timeHms,
        status: allIssued ? "completed" : "in_progress",
        items: stagingItems,
        updatedAt: new Date().toISOString(),
      });
    });

    // If any TEMP orders had items matched into the newly imported real orders, update or remove the TEMP orders
    const ordersToPersist: CoilStagingOrder[] = [...newOrdersToAdd];
    const tempOrdersToDelete: CoilStagingOrder[] = [];

    if (matchedTempOrderNos.size > 0) {
      const firstNewOrderNo = newOrdersToAdd[0]?.orderNo || defaultOrderNo;
      const importedBatchesSet = new Set(
        parsedPreviewItems.map((p) => p.batch.trim().toUpperCase())
      );

      stagingOrders
        .filter((o) => o.isTemporary && matchedTempOrderNos.has(o.orderNo))
        .forEach((tempOrd) => {
          const remainingUnmatched = tempOrd.items.filter(
            (i) => !importedBatchesSet.has(i.batch.toUpperCase())
          );
          if (remainingUnmatched.length === 0) {
            tempOrdersToDelete.push(tempOrd);
          } else {
            ordersToPersist.push({
              ...tempOrd,
              matchedOrderNo: firstNewOrderNo,
              items: remainingUnmatched,
              updatedAt: new Date().toISOString(),
            });
          }
        });
    }

    const firstImportedOrder = newOrdersToAdd[0];
    setSelectedMachineId(importMachineId);
    if (firstImportedOrder) {
      setSelectedOrderNo(firstImportedOrder.orderNo);
      setExpandedOrderNos((prev) =>
        Array.from(new Set([...prev, ...newOrdersToAdd.map((o) => o.orderNo)]))
      );
    }

    setIsImportModalOpen(false);
    setImportOrderNo("");
    setRawTableText("");

    await batchSaveCoilStagingOrdersToCloud(ordersToPersist);
    for (const delOrd of tempOrdersToDelete) {
      await deleteCoilStagingOrderFromCloud(delOrd);
    }

    playBeep("success");
    if (autoMatchedBatchCount > 0) {
      showToast(
        isThai
          ? `นำเข้า ${newOrdersToAdd.length} Order สำเร็จ และจับคู่ Batch จากใบเบิกฉุกเฉินอัตโนมัติ ${autoMatchedBatchCount} ม้วน -> สถานะ "เตรียมแล้ว"`
          : `Imported ${newOrdersToAdd.length} Order(s) & auto-matched ${autoMatchedBatchCount} TEMP batches!`,
        "success"
      );
    } else {
      showToast(
        isThai
          ? `นำเข้าใบสั่งเบิก ${newOrdersToAdd.map((o) => o.orderNo).join(", ")} (${parsedPreviewItems.length} รายการ) สำเร็จ`
          : `Imported Pick List Order(s) (${parsedPreviewItems.length} items)`,
        "success"
      );
    }

    onLogTransaction?.(
      `Imported Coil Pick List ${newOrdersToAdd.map((o) => o.orderNo).join(", ")} for ${importMachineId}`,
      firstImportedOrder?.orderNo || "PICKLIST",
      "Completed"
    );
  };

  // Emergency Pre-Staging Handlers (เบิกฉุกเฉิน (TEMP))
  const handleOpenEmergencyModal = () => {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const timePart = `${String(now.getHours()).padStart(2, "0")}${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    setEmergencyMachineId(selectedMachineId);
    setEmergencyTempOrderNo(`TEMP-${selectedMachineId}-${datePart}-${timePart}`);
    setEmergencyBarcodeInput("");
    setEmergencyScannedBatches([]);
    setIsEmergencyCameraActive(false);
    setIsEmergencyModalOpen(true);
  };

  const processEmergencyBatchCode = (rawInput: string) => {
    const cleanB = cleanBarcode(rawInput).toUpperCase();
    if (!cleanB) return;

    if (!/^[A-Z0-9]{10}$/.test(cleanB)) {
      playBeep("error");
      showToast(
        isThai
          ? `รหัส "${cleanB}" (${cleanB.length} หลัก) ไม่ถูกต้อง — ต้องเป็นรหัส Batch 10 หลัก (A-Z, 0-9)`
          : `Invalid 10-digit Batch code: "${cleanB}"`,
        "error"
      );
      setEmergencyBarcodeInput("");
      return;
    }

    if (emergencyScannedBatches.some((b) => b.batch === cleanB)) {
      playBeep("warning");
      showToast(
        isThai ? `รหัส Batch [${cleanB}] ถูกสแกนอยู่ในรายการเบิกฉุกเฉินนี้แล้ว` : `Batch [${cleanB}] already scanned`,
        "warning"
      );
      setEmergencyBarcodeInput("");
      return;
    }

    const enriched = enrichBatchFromCoilStockOrSap(cleanB);
    setEmergencyScannedBatches((prev) => [
      ...prev,
      {
        batch: cleanB,
        coilNo: enriched.coilNo,
        grade: enriched.grade,
        thickness: enriched.thickness,
        width: enriched.width,
        weightKg: enriched.weightKg,
        sourceLocation: enriched.sourceLocation,
        description:
          enriched.description || "เบิกฉุกเฉิน (รอจับคู่ใบสั่งเบิก Order จริง)",
        inStock: Boolean(enriched.stockRec || enriched.sapRec),
      },
    ]);
    setEmergencyBarcodeInput("");
    playBeep("success");
    setTimeout(() => emergencyBarcodeRef.current?.focus(), 60);
  };

  const handleAddEmergencyBatch = (e: React.FormEvent) => {
    e.preventDefault();
    processEmergencyBatchCode(emergencyBarcodeInput);
  };

  const handleConfirmEmergencyStaging = async () => {
    if (emergencyScannedBatches.length === 0) {
      showToast(
        isThai ? "กรุณาสแกนรหัส Batch อย่างน้อย 1 รายการ" : "Please scan at least 1 Batch",
        "warning"
      );
      return;
    }

    const tempOrdNo =
      emergencyTempOrderNo.trim().toUpperCase() ||
      `TEMP-${emergencyMachineId}-${Date.now().toString().slice(-6)}`;
    const { dateYmd, timeHms, timestamp } = formatNowTimestamp();

    const tempOrder: CoilStagingOrder = {
      id: `CSTG-${tempOrdNo}`,
      orderNo: tempOrdNo,
      machineId: emergencyMachineId,
      createdDate: dateYmd,
      createdAt: timeHms,
      status: "in_progress",
      isTemporary: true,
      items: emergencyScannedBatches.map((b, idx) => ({
        id: `CSI-${tempOrdNo}-${b.batch}-${idx + 1}`,
        batch: b.batch,
        coilNo: b.coilNo,
        grade: b.grade,
        thickness: b.thickness,
        width: b.width,
        weightKg: b.weightKg,
        sourceLocation: b.sourceLocation,
        status: "staged",
        stagedAt: timestamp,
        description: b.description,
        bomItem: String((idx + 1) * 10).padStart(4, "0"),
        unit: "KG",
        storageLocation: "1101",
        isTemporary: true,
        tempOrderRef: tempOrdNo,
      })),
      updatedAt: new Date().toISOString(),
    };

    setSelectedMachineId(emergencyMachineId);
    setSelectedOrderNo(tempOrdNo);
    setExpandedOrderNos((prev) => (prev.includes(tempOrdNo) ? prev : [...prev, tempOrdNo]));
    setIsEmergencyCameraActive(false);
    setIsEmergencyModalOpen(false);

    await saveCoilStagingOrderToCloud(tempOrder);
    playBeep("success");
    showToast(
      isThai
        ? `สร้างใบเบิกฉุกเฉิน ${tempOrdNo} (${emergencyScannedBatches.length} ม้วน) สถานะ "เตรียมแล้ว" พร้อมจ่ายออกทันที!`
        : `Created Emergency TEMP Order ${tempOrdNo} (${emergencyScannedBatches.length} coils)!`,
      "success"
    );
    onLogTransaction?.(
      `Emergency Coil Pre-Staged ${tempOrdNo} (${emergencyScannedBatches.length} coils) for ${emergencyMachineId}`,
      tempOrdNo,
      "Completed"
    );
  };

  const handleManualMatchTempOrder = async (tempOrderNo: string) => {
    const tempOrd = stagingOrders.find((o) => o.orderNo === tempOrderNo);
    if (!tempOrd) return;

    const { value: realOrderInput, isConfirmed } = await Swal.fire({
      title: isThai ? "ผูกเลขที่ Order จริง (Match Real Order)" : "Match Real Order No.",
      html: isThai
        ? `<div class="text-xs text-slate-600 text-left space-y-1">
            <div>ใบเบิกฉุกเฉิน: <b class="font-mono text-amber-600">${tempOrderNo}</b> (${tempOrd.items.length} ม้วน)</div>
            <div>เครื่องจักร: <b>${tempOrd.machineId}</b></div>
            <div class="pt-1">กรอกเลขที่ใบสั่งเบิก (Order No.) จริงที่ได้รับจากวางแผน/SAP เพื่อเปลี่ยนรหัสใบเบิก หรือรวมเข้ากับ Order จริงที่มีอยู่แล้ว:</div>
          </div>`
        : `Enter real SAP Order No. for ${tempOrderNo}:`,
      input: "text",
      inputPlaceholder: isThai ? "เช่น 1020045890" : "e.g. 1020045890",
      showCancelButton: true,
      confirmButtonText: isThai ? "ยืนยันผูกเลข Order" : "Confirm Match",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
      confirmButtonColor: "#d97706",
    });

    if (!isConfirmed || !realOrderInput || !String(realOrderInput).trim()) return;
    const targetOrderNo = String(realOrderInput).trim().toUpperCase();
    if (targetOrderNo === tempOrderNo) return;

    const existingRealOrder = stagingOrders.find(
      (o) => o.orderNo.toUpperCase() === targetOrderNo
    );

    if (existingRealOrder) {
      // Merge temp items into existing real order
      const tempByBatch = new Map<string, CoilStagingItem>();
      tempOrd.items.forEach((i) => tempByBatch.set(i.batch.toUpperCase(), i));

      const mergedItems = existingRealOrder.items.map((item) => {
        const matched = tempByBatch.get(item.batch.toUpperCase());
        if (matched) {
          tempByBatch.delete(item.batch.toUpperCase());
          return {
            ...item,
            status: matched.status === "issued" ? ("issued" as const) : ("staged" as const),
            stagedAt: matched.stagedAt || item.stagedAt,
            issuedAt: matched.issuedAt || item.issuedAt,
            tempOrderRef: tempOrderNo,
          };
        }
        return item;
      });

      const extraItems = Array.from(tempByBatch.values()).map((extra) => ({
        ...extra,
        isTemporary: false,
        tempOrderRef: tempOrderNo,
      }));

      await saveCoilStagingOrderToCloud({
        ...existingRealOrder,
        items: [...mergedItems, ...extraItems],
        updatedAt: new Date().toISOString(),
      });
      await deleteCoilStagingOrderFromCloud(tempOrd);
    } else {
      // Convert TEMP order into the real order number
      const convertedOrder: CoilStagingOrder = {
        ...tempOrd,
        id: `CSTG-${targetOrderNo}`,
        orderNo: targetOrderNo,
        isTemporary: false,
        matchedOrderNo: targetOrderNo,
        items: tempOrd.items.map((i) => ({
          ...i,
          isTemporary: false,
          tempOrderRef: tempOrderNo,
        })),
        updatedAt: new Date().toISOString(),
      };
      await saveCoilStagingOrderToCloud(convertedOrder);
      await deleteCoilStagingOrderFromCloud(tempOrd);
    }

    setSelectedOrderNo(targetOrderNo);
    playBeep("success");
    showToast(
      isThai
        ? `ผูกใบเบิกฉุกเฉิน ${tempOrderNo} เข้ากับ Order จริง [${targetOrderNo}] สำเร็จ!`
        : `Matched ${tempOrderNo} -> Order [${targetOrderNo}]!`,
      "success"
    );
  };

  const handleConfirmDeleteOrder = async () => {
    if (!deleteModalOrderNo) return;
    const targetOrd = stagingOrders.find((o) => o.orderNo === deleteModalOrderNo);
    setDeleteModalOrderNo(null);
    if (!targetOrd) return;

    await deleteCoilStagingOrderFromCloud(targetOrd);
    playBeep("warning");
    showToast(
      isThai
        ? `ลบใบสั่งเบิก Order ${targetOrd.orderNo} เรียบร้อยแล้ว`
        : `Deleted Pick List Order ${targetOrd.orderNo}`,
      "info"
    );
  };

  // ============================================================================
  // Handlers for Tab 2: จ่ายออก (Operator Receive / Machine Issue by Scan)
  // ============================================================================
  const processOperatorIssueScan = async (rawCode: string) => {
    const cleanCode = cleanBarcode(rawCode).toUpperCase();
    if (!cleanCode) return;

    if (!/^[A-Z0-9]{10}$/.test(cleanCode)) {
      playBeep("error");
      setOperatorScanStatus({
        type: "error",
        message: isThai
          ? `ปฏิเสธ: รหัส "${cleanCode}" (${cleanCode.length} หลัก) ไม่ใช่รหัส Batch 10 หลัก`
          : `Invalid 10-digit Batch code: "${cleanCode}"`,
        scannedBatch: cleanCode,
      });
      setOperatorBarcodeInput("");
      setTimeout(() => operatorScannerInputRef.current?.focus(), 60);
      return;
    }

    // Search in orders for the currently selected machine
    let foundInCurrentMachineOrder: CoilStagingOrder | null = null;
    let foundItem: CoilStagingItem | null = null;

    for (const ord of machineFilteredOrders) {
      const match = ord.items.find((i) => i.batch.toUpperCase() === cleanCode);
      if (match) {
        foundInCurrentMachineOrder = ord;
        foundItem = match;
        break;
      }
    }

    // Check if Batch belongs to another machine's order
    if (!foundInCurrentMachineOrder || !foundItem) {
      const otherMachineOrder = stagingOrders.find(
        (o) =>
          o.machineId !== selectedMachineId &&
          o.items.some((i) => i.batch.toUpperCase() === cleanCode)
      );

      playBeep("error");
      if (otherMachineOrder) {
        setOperatorScanStatus({
          type: "error",
          message: isThai
            ? `ผิดเครื่องจักร! Batch [${cleanCode}] อยู่ในใบสั่งเบิก Order ${otherMachineOrder.orderNo} ของเครื่อง [${otherMachineOrder.machineId}] (ไม่ใช่เครื่อง ${selectedMachineId})`
            : `Wrong Machine! Batch [${cleanCode}] belongs to ${otherMachineOrder.machineId} (Order ${otherMachineOrder.orderNo})`,
          scannedBatch: cleanCode,
        });
        setOperatorWarningModal({
          isOpen: true,
          title: isThai ? "เตือนภัย: ผิดเครื่องจักร (Wrong Machine)" : "Warning: Wrong Machine",
          message: isThai
            ? `รหัส Batch [${cleanCode}] ถูกจัดเตรียมไว้สำหรับเครื่องจักร [${otherMachineOrder.machineId}] ในใบสั่งเบิก Order ${otherMachineOrder.orderNo}`
            : `Batch [${cleanCode}] is assigned to Machine [${otherMachineOrder.machineId}] (Order ${otherMachineOrder.orderNo})`,
          detail: isThai
            ? `ขณะนี้คุณกำลังเลือกหน้าจอจ่ายออกของเครื่อง [${selectedMachineId}] กรุณาตรวจสอบม้วนเหล็กหรือสลับเครื่องจักรให้ถูกต้อง`
            : `Current active machine is [${selectedMachineId}].`,
        });
      } else {
        setOperatorScanStatus({
          type: "error",
          message: isThai
            ? `ไม่พบรหัส Batch [${cleanCode}] ในใบสั่งเบิกใดๆ ของเครื่อง ${selectedMachineId}`
            : `Batch [${cleanCode}] not found in any Pick List for ${selectedMachineId}`,
          scannedBatch: cleanCode,
        });
      }
      setOperatorBarcodeInput("");
      setTimeout(() => operatorScannerInputRef.current?.focus(), 60);
      return;
    }

    if (foundItem.status === "issued") {
      playBeep("warning");
      setOperatorScanStatus({
        type: "warning",
        message: isThai
          ? `แจ้งเตือน: รหัส Batch [${cleanCode}] ถูกสแกนจ่ายออกเข้าเครื่อง ${selectedMachineId} ไปเรียบร้อยแล้ว`
          : `Batch [${cleanCode}] has already been issued to ${selectedMachineId}`,
        scannedBatch: cleanCode,
      });
      setOperatorBarcodeInput("");
      setTimeout(() => operatorScannerInputRef.current?.focus(), 60);
      return;
    }

    // Strict Rule 1: Must have a valid Location in Stock (unless it's a TEMP emergency order with known location or operator override)
    const stockRecord = coilStock.find((c) => c.batch.toUpperCase() === cleanCode);
    const currentLoc = (stockRecord?.location || foundItem.sourceLocation || "").trim();
    const isMissingLocation =
      !currentLoc ||
      currentLoc === "-" ||
      currentLoc.includes("รอระบุ") ||
      currentLoc.includes("รอสแกน");

    if (isMissingLocation && !foundInCurrentMachineOrder.isTemporary) {
      playBeep("error");
      const locErrMsg = isThai
        ? `ไม่สามารถสแกนจ่าย Batch [${cleanCode}] ได้ เนื่องจากในหน้า "สต๊อก" ยังไม่ระบุ Location (รอสแกน Location)`
        : `Cannot issue Batch [${cleanCode}]: Location is not yet assigned in Stock.`;
      setOperatorScanStatus({
        type: "error",
        message: locErrMsg,
        scannedBatch: cleanCode,
      });
      setOperatorWarningModal({
        isOpen: true,
        title: isThai
          ? "Batch ยังไม่ถูกรับโอนย้ายเข้าระบบ (Missing Stock Location)"
          : "Missing Stock Location",
        message: locErrMsg,
        detail: isThai
          ? `กรุณานำ Batch [${cleanCode}] ไปสแกนระบุพื้นที่จัดเก็บ (Location) ในเมนู "+รับเข้า" หรือ "ย้าย Layout" ก่อน จึงจะสามารถสแกนจ่ายออกเข้าเครื่องจักรได้`
          : `Please scan Batch [${cleanCode}] into a storage location before issuing.`,
      });
      setOperatorBarcodeInput("");
      setTimeout(() => operatorScannerInputRef.current?.focus(), 60);
      return;
    }

    // Strict Rule 2: Must be prepared ('staged' = เตรียมแล้ว) in Outbound (เตรียมเบิก) before issuing
    if (foundItem.status !== "staged") {
      playBeep("error");
      const notPreparedMsg = isThai
        ? `ปฏิเสธ: Batch [${cleanCode}] ยังไม่ได้รับการเตรียมเบิก! Status ที่ตารางรายการใบสั่งเบิกที่หน้าเตรียมเบิกยังไม่เป็น "เตรียมแล้ว"`
        : `Rejected: Batch [${cleanCode}] has not been staged in Outbound yet!`;
      setOperatorScanStatus({
        type: "error",
        message: notPreparedMsg,
        scannedBatch: cleanCode,
      });
      setOperatorWarningModal({
        isOpen: true,
        title: isThai
          ? "ยังไม่ได้สแกนเตรียมเบิก (Not Staged Yet)"
          : "Batch Not Staged Yet",
        message: notPreparedMsg,
        detail: isThai
          ? `กรุณาให้เจ้าหน้าที่คลังสแกนบาร์โค้ด Batch [${cleanCode}] ในเมนู "-เตรียมเบิก" (Order: ${foundInCurrentMachineOrder.orderNo}) ให้สถานะเปลี่ยนเป็น "เตรียมแล้ว" ก่อนนำมาสแกนจ่ายออก`
          : `Please scan Batch [${cleanCode}] in Outbound (Order ${foundInCurrentMachineOrder.orderNo}) first.`,
      });
      setOperatorBarcodeInput("");
      setTimeout(() => operatorScannerInputRef.current?.focus(), 60);
      return;
    }

    // Passed all validations -> Issue to Machine and deduct from active stock
    const { timestamp } = formatNowTimestamp();
    const issueWeightKg =
      Number(foundItem.weightKg) > 0
        ? Number(foundItem.weightKg)
        : Number(stockRecord?.weightKg) || 0;

    const effectiveStockRecord: CoilStockRecord = stockRecord || {
      id: `COIL-${cleanCode}`,
      batch: cleanCode,
      coilNo: foundItem.coilNo || "-",
      location: currentLoc || "STAGE",
      status: "staged",
      weightKg: issueWeightKg,
      initialWeightKg: issueWeightKg,
      certThickness: foundItem.thickness || "-",
      targetThickness: foundItem.thickness || "-",
      width: foundItem.width || "-",
      grade: foundItem.grade || "-",
      manufacturer: "-",
      supplier: "-",
      machine: selectedMachineId,
      inboundType: "external",
      orderNo: foundInCurrentMachineOrder.orderNo,
      description: foundItem.description || "",
      scanTimestamp: timestamp,
      updatedAt: new Date().toISOString(),
    };

    setExpandedOrderNos((prev) =>
      prev.includes(foundInCurrentMachineOrder!.orderNo)
        ? prev
        : [...prev, foundInCurrentMachineOrder!.orderNo]
    );

    const remainingToIssue = foundInCurrentMachineOrder.items.filter(
      (i) => i.batch.toUpperCase() !== cleanCode && i.status !== "issued"
    ).length;

    playBeep("success");
    setOperatorScanStatus({
      type: "success",
      message: isThai
        ? `จ่ายออกสำเร็จ! Batch [${cleanCode}] (${issueWeightKg.toLocaleString()} kg) เข้าเครื่อง ${selectedMachineId} • ตัดสต๊อกเรียบร้อย (เหลือรอรับอีก ${remainingToIssue} รายการ)`
        : `Issued Batch [${cleanCode}] (${issueWeightKg.toLocaleString()} kg) to ${selectedMachineId} (${remainingToIssue} remaining)`,
      scannedBatch: cleanCode,
    });
    setOperatorBarcodeInput("");
    setTimeout(() => operatorScannerInputRef.current?.focus(), 60);

    await issueCoilToMachineInCloud({
      stockRecord: effectiveStockRecord,
      machineId: selectedMachineId,
      orderNo: foundInCurrentMachineOrder.orderNo,
      issueWeightKg,
      stagingOrder: foundInCurrentMachineOrder,
    });

    onLogTransaction?.(
      `Issued Coil ${cleanCode} (${issueWeightKg.toLocaleString()} kg) to ${selectedMachineId} (Order ${foundInCurrentMachineOrder.orderNo})`,
      cleanCode,
      "Completed"
    );
  };

  const handleOperatorBarcodeScan = (e: React.FormEvent) => {
    e.preventDefault();
    processOperatorIssueScan(operatorBarcodeInput);
  };

  const handleDismissCompletedOrder = async (order: CoilStagingOrder) => {
    setDismissedOperatorOrders((prev) =>
      prev.includes(order.orderNo) ? prev : [...prev, order.orderNo]
    );
    await saveCoilStagingOrderToCloud({
      ...order,
      status: "completed",
      operatorDismissed: true,
      updatedAt: new Date().toISOString(),
    });
    showToast(
      isThai
        ? `ซ่อนใบสั่งเบิก Order ${order.orderNo} ที่จ่ายครบแล้วออกจากหน้าจอจ่ายออก`
        : `Hidden completed Order ${order.orderNo} from Operator view`,
      "info"
    );
  };

  // ============================================================================
  // Handlers for Tab 4: ย้าย Layout (Relocate Layout)
  // ============================================================================
  const handleRelocateScanAdd = (e?: React.FormEvent, overrideCode?: string) => {
    e?.preventDefault();
    const code = cleanBarcode(overrideCode ?? relocateScanInput).toUpperCase();
    if (!code) return;

    const found = activeStockCoils.find(
      (c) => c.batch.toUpperCase() === code || c.coilNo.toUpperCase() === code
    );
    if (!found) {
      playBeep("error");
      showToast(
        isThai ? `ไม่พบรหัสเหล็กม้วน ${code} ในสต๊อกปัจจุบัน` : `Coil ${code} not found in active stock`,
        "error"
      );
      return;
    }

    setSelectedRelocateBatches((prev) =>
      prev.includes(found.batch) ? prev : [...prev, found.batch]
    );
    setRelocateScanInput("");
    playBeep("success");
    showToast(
      isThai
        ? `เพิ่มม้วน ${found.batch} (จาก ${found.location}) เข้าคิวรอย้าย Layout`
        : `Added ${found.batch} (from ${found.location}) to relocation queue`,
      "info"
    );
  };

  const handleConfirmRelocate = async () => {
    const target = relocateTargetLocation.trim().toUpperCase();
    if (!target) {
      showToast(isThai ? "กรุณาเลือกหรือระบุ Layout ปลายทาง" : "Please specify target Layout", "warning");
      return;
    }
    const coilsToMove = activeStockCoils.filter((c) =>
      selectedRelocateBatches.includes(c.batch)
    );
    if (coilsToMove.length === 0) {
      showToast(
        isThai ? "กรุณาสแกนหรือเลือกม้วนเหล็กที่ต้องการย้ายอย่างน้อย 1 ม้วน" : "Select at least 1 coil to relocate",
        "warning"
      );
      return;
    }

    // Strictly enforce Level 2+ pyramid base-support rule on relocation target
    const relocateCheck = validateCoilPlacementLocation(
      target,
      activeStockCoils,
      coilsToMove.map((c) => c.batch),
      warehouseBaseSlotsPerRow
    );
    if (!relocateCheck.valid) {
      playBeep("error");
      showToast(
        isThai
          ? relocateCheck.reasonTh ||
              "ไม่สามารถย้ายไปวางชั้นที่ 2 ได้ — ต้องมีฐานชั้นที่ 1 รองรับครบ 2 ลูกก่อน"
          : relocateCheck.reasonEn ||
              "Cannot relocate to Level 2 — requires 2 supporting Level 1 base coils",
        "error"
      );
      return;
    }

    await relocateCoilsInCloud({
      coils: coilsToMove,
      targetLocation: target,
    });

    setSelectedRelocateBatches([]);
    playBeep("success");
    showToast(
      isThai
        ? `ย้าย Layout เหล็กม้วนจำนวน ${coilsToMove.length} ม้วน ไปยัง ${target} สำเร็จ!`
        : `Relocated ${coilsToMove.length} coils to ${target}`,
      "success"
    );
    onLogTransaction?.(
      `Relocated ${coilsToMove.length} coils to Layout ${target}`,
      target,
      "Completed"
    );
  };

  const handleAddNewLayoutZone = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = newZoneCode.trim().toUpperCase();
    if (!code) return;
    await saveCoilLayoutZoneToCloud({
      id: `LAYOUT-${code}`,
      bayCode: code,
      bayGroup: code.startsWith("CL2") ? "CL2" : "CL1",
      zoneName: newZoneName.trim() || `Bay ${code}`,
      maxCapacityTons: parseFloat(newZoneCapTons) || 350,
      maxCoils: 25,
      updatedAt: new Date().toISOString(),
    });
    setRelocateTargetLocation(code);
    setInboundLocation(code);
    setNewZoneCode("");
    setNewZoneName("");
    setIsAddZoneModalOpen(false);
    showToast(isThai ? `เพิ่มโซน Layout ${code} สำเร็จ` : `Added Layout Zone ${code}`, "success");
  };

  // ============================================================================
  // Handlers for Tab 5: สต๊อก (Stock Balance & Export)
  // ============================================================================
  const filteredStockRows = useMemo(() => {
    return coilStock.filter((c) => {
      if (stockStatusFilter === "ACTIVE") {
        if (c.status === "issued") return false;
      } else if (stockStatusFilter !== "ALL") {
        if (c.status !== stockStatusFilter) return false;
      }
      if (stockBayFilter !== "ALL" && c.location.toUpperCase() !== stockBayFilter.toUpperCase()) {
        return false;
      }
      if (stockGradeFilter !== "ALL" && c.grade.toUpperCase() !== stockGradeFilter.toUpperCase()) {
        return false;
      }
      if (stockSearch.trim()) {
        const q = stockSearch.trim().toLowerCase();
        const hay = `${c.batch} ${c.coilNo} ${c.grade} ${c.certThickness} ${c.targetThickness || ""} ${c.width} ${c.location} ${c.manufacturer} ${c.materialNo || ""} ${c.description || ""} ${c.skinpass || ""} ${c.storageLocation || ""} ${c.conditionText || ""} ${c.heatNo || ""} ${c.orderNo || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [coilStock, stockStatusFilter, stockBayFilter, stockGradeFilter, stockSearch]);

  const handleExportStockExcel = () => {
    const exportRows = filteredStockRows.map((c, i) => ({
      "ลำดับ (No.)": i + 1,
      "Material No.": c.materialNo || "-",
      "Discription": c.description || "-",
      "Batch": c.batch,
      "หนา Certificated.": c.certThickness,
      "ความหนาเป้าหมาย": c.targetThickness || c.certThickness,
      "กว้าง": c.width,
      "Grade": c.grade,
      "ผู้ผลิต": c.manufacturer,
      "Skinpass": c.skinpass || "-",
      "Storage Location (SAP)": c.storageLocation || "-",
      "Unrestr. (น้ำหนักคงเหลือ kg)": c.weightKg,
      "หมายเลขคอยล์ (Coil No.)": c.coilNo,
      "Text สภาพสินค้า": c.conditionText || c.remark || "-",
      "HEAT NO.": c.heatNo || "-",
      "นน. ชั่งจริง (kg)": c.actualWeightKg || 0,
      "สถานที่จัดเก็บ (Layout อาคาร/แถว)": c.location,
      "Layout เดิม": c.previousLocation || "-",
      "สถานะ (Status)":
        c.status === "available"
          ? "พร้อมใช้ (Available)"
          : c.status === "staged"
          ? `เตรียมเบิก (${c.stagedMachineId || "STAGED"})`
          : "จ่ายออกแล้ว (Issued)",
      "วันเวลาสแกนล่าสุด": c.scanTimestamp,
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coil_Stock");
    XLSX.writeFile(wb, `TMT_Coil_Stock_${formatNowTimestamp().dateYmd}.xlsx`);
  };

  // ============================================================================
  // Handlers for SAP Stock Upload & Sync (coil_sap_chunks + coil_stock)
  // ============================================================================
  const parsedSapPreviewItems = useMemo(() => {
    if (!sapRawText.trim()) return [];
    return parseRawCoilSapText(sapRawText);
  }, [sapRawText]);

  const executeCoilSapImport = async (parsedItems: CoilSapMasterItem[], sourceLabel: string) => {
    if (!parsedItems || parsedItems.length === 0) {
      playBeep("warning");
      Swal.fire({
        icon: "warning",
        title: isThai ? "ไม่พบข้อมูลที่ถูกต้องจากระบบ SAP" : "No valid SAP rows detected",
        text: isThai
          ? "กรุณาตรวจสอบว่าไฟล์หรือข้อมูลที่วางมีคอลัมน์ Batch / น้ำหนัก / สเปคเหล็กม้วนครบถ้วน"
          : "Please check that your file or pasted data contains valid SAP columns (Batch, Weight, Spec).",
      });
      return;
    }

    setIsSapProcessing(true);
    setSapTotalCount(parsedItems.length);
    setSapProcessedCount(0);
    setSapCurrentStep(1);
    setSapProgress(15);

    try {
      await new Promise((r) => setTimeout(r, 150));
      setSapCurrentStep(2);
      setSapProgress(35);
      setSapProcessedCount(Math.round(parsedItems.length * 0.35));

      await new Promise((r) => setTimeout(r, 150));
      setSapCurrentStep(3);
      setSapProgress(60);
      const chunksSaved = await saveCoilSapChunksToCloud(parsedItems);

      setSapCurrentStep(4);
      setSapProgress(82);
      setSapProcessedCount(Math.round(parsedItems.length * 0.85));

      const { updatedCount, insertedCount } = await importCoilSapStockToCloud({
        sapItems: parsedItems,
        existingStock: coilStock,
        createMissingStock: createMissingStockOnSapImport,
      });

      const nextMap = new Map<string, CoilSapMasterItem>();
      parsedItems.forEach((itm) => {
        const key = String(itm.batch || "").trim().toUpperCase();
        if (key) nextMap.set(key, itm);
      });
      setCoilSapMap(nextMap);
      setCoilSapChunkCount(chunksSaved);
      setSapProcessedCount(parsedItems.length);
      setSapProgress(100);

      if (!isCloudRealtime) {
        setManualRefreshTick((t) => t + 1);
      }

      onLogTransaction?.(
        `SAP Coil Stock Upload (${sourceLabel}): ${parsedItems.length} rows (New: ${insertedCount}, Updated: ${updatedCount})`,
        `SAP-${parsedItems.length}`,
        "Completed"
      );

      await new Promise((r) => setTimeout(r, 250));
      setIsSapProcessing(false);
      setIsSapModalOpen(false);
      setSapRawText("");
      playBeep("success");

      Swal.fire({
        icon: "success",
        title: isThai ? "อัปโหลดและจับคู่สต็อก SAP สำเร็จ" : "SAP Stock Merge Completed",
        html: isThai
          ? `<div style="text-align:left;font-size:13px;line-height:1.7;">
              <div>• ข้อมูลจากไฟล์ SAP ทั้งหมด: <b>${parsedItems.length.toLocaleString()}</b> รายการ</div>
              <div>• จับคู่ Batch ตรงกับสต๊อกและเติมเต็มข้อมูลสำเร็จ: <b style="color:#0284c7;">${updatedCount.toLocaleString()}</b> ม้วน</div>
              ${
                insertedCount > 0
                  ? `<div>• เพิ่มรายการใหม่เข้าสต๊อก: <b style="color:#10b981;">${insertedCount.toLocaleString()}</b> ม้วน</div>`
                  : `<div style="color:#64748b;font-size:12px;">(คงค่า Location อาคาร/แถว และสถานะเดิมที่สแกนไว้ทั้งหมด)</div>`
              }
            </div>`
          : `Parsed <b>${parsedItems.length.toLocaleString()}</b> SAP items.<br/>Matched & Updated: <b>${updatedCount}</b> | Inserted: <b>${insertedCount}</b>`,
      });
    } catch (err) {
      console.error("Coil SAP Import Error:", err);
      setIsSapProcessing(false);
      playBeep("error");
      Swal.fire({
        icon: "error",
        title: isThai ? "เกิดข้อผิดพลาดในการนำเข้า SAP" : "SAP Import Error",
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSapFileUpload = async (file: File) => {
    try {
      const lower = file.name.toLowerCase();
      let parsed: CoilSapMasterItem[] = [];

      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", raw: true });
        if (workbook.SheetNames.length > 0) {
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
          parsed = parseCoilSapRows(rows);
        }
      } else {
        const buffer = await file.arrayBuffer();
        const text = decodeCoilSapBuffer(buffer);
        parsed = parseRawCoilSapText(text);
      }

      await executeCoilSapImport(parsed, file.name);
    } catch (err) {
      console.error("Failed to read SAP file:", err);
      playBeep("error");
      showToast(
        isThai ? "ไม่สามารถอ่านไฟล์ SAP นี้ได้ กรุณาตรวจสอบรูปแบบไฟล์" : "Failed to parse SAP file",
        "error"
      );
    }
  };

  const TABS: Array<{
    id: CoilModeTab;
    labelTh: string;
    labelEn: string;
    icon: React.ElementType;
    badgeCount?: number;
    activeColor: string;
  }> = [
    {
      id: "inbound",
      labelTh: "+ รับเข้า",
      labelEn: "+ Inbound",
      icon: ArrowDownRight,
      badgeCount: coilTransactions.filter((t) => t.txType === "inbound").length,
      activeColor: "bg-emerald-600 text-white border-emerald-500 shadow-sm",
    },
    {
      id: "operator_receive",
      labelTh: "จ่ายออก",
      labelEn: "Issue",
      icon: Cpu,
      badgeCount: stagedCoils.length,
      activeColor: "bg-blue-600 text-white border-blue-500 shadow-sm",
    },
    {
      id: "outbound",
      labelTh: "- เตรียมเบิก",
      labelEn: "- Staging",
      icon: ArrowUpRight,
      badgeCount: stagingOrders.filter((o) => o.status !== "completed").length,
      activeColor: "bg-amber-600 text-white border-amber-500 shadow-sm",
    },
    {
      id: "relocate_layout",
      labelTh: "ย้าย Layout",
      labelEn: "Relocate",
      icon: ArrowRightLeft,
      badgeCount: selectedRelocateBatches.length || undefined,
      activeColor: "bg-purple-600 text-white border-purple-500 shadow-sm",
    },
    {
      id: "stock_balance",
      labelTh: "สต๊อก",
      labelEn: "Stock",
      icon: Package,
      badgeCount: activeStockCoils.length,
      activeColor: "bg-cyan-600 text-white border-cyan-500 shadow-sm",
    },
    {
      id: "warehouse_3d",
      labelTh: "ผังคลัง 3D",
      labelEn: "3D Warehouse",
      icon: Box,
      activeColor: "bg-indigo-600 text-white border-indigo-500 shadow-sm",
    },
  ];

  return (
    <div
      className={
        activeMode === "warehouse_3d"
          ? "flex-1 min-h-0 flex flex-col gap-2 overflow-hidden"
          : "space-y-3 pb-16"
      }
    >
      {/* Top Control Bar: Sub-Tabs + Isolated Cloud DB Status & Real-Time Toggle */}
      <div className="shrink-0 bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-2.5 shadow-xs flex flex-wrap items-center justify-between gap-2">
        {/* Primary Sub-Tabs */}
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5 w-full lg:w-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveMode(tab.id)}
                className={`inline-flex items-center justify-center gap-1.5 py-2 px-2.5 sm:px-3.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all cursor-pointer border whitespace-nowrap ${
                  isActive
                    ? tab.activeColor
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#0c1930] dark:text-slate-300 dark:hover:bg-[#152646] border-transparent"
                }`}
              >
                <Icon size={14} className="flex-shrink-0" />
                <span className="truncate">{isThai ? tab.labelTh : tab.labelEn}</span>
                {typeof tab.badgeCount === "number" && tab.badgeCount > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9.5px] font-extrabold ${
                      isActive
                        ? "bg-white/25 text-white"
                        : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {tab.badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Utilities: Isolated DB Badge, Cloud Real-time Toggle, Reload, Sound, Reset */}
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <span
            className="hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800/60 text-sky-700 dark:text-sky-300"
            title="ฐานข้อมูลแยกอิสระสำหรับเหล็กม้วน (dbCoil: coil_stock, coil_transactions, coil_staging, coil_layouts)"
          >
            <Database size={11} />
            <span>dbCoil (แยกอิสระ 100%)</span>
          </span>

          <button
            type="button"
            onClick={() => {
              const nextState = !isCloudRealtime;
              setCoilCloudRealtimeEnabled(nextState);
              setIsCloudRealtime(nextState);
              showToast(
                nextState
                  ? isThai
                    ? "เปิดโหมด Cloud Real-time (เหล็กม้วน)"
                    : "Coil Cloud Real-time ON"
                  : isThai
                  ? "ปิดโหมด Cloud Real-time (ดึงข้อมูลเฉพาะเมื่อกดโหลด เพื่อประหยัดโควต้า Read)"
                  : "Coil Cloud Real-time OFF",
                nextState ? "success" : "info"
              );
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold border cursor-pointer transition-colors ${
              isCloudRealtime
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100"
                : "bg-slate-100 dark:bg-slate-800/70 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            }`}
            title={
              isCloudRealtime
                ? isThai
                  ? "คลิกเพื่อปิด Cloud Real-time ของส่วนงานเหล็กม้วน"
                  : "Click to turn OFF Cloud Real-time"
                : isThai
                ? "คลิกเพื่อเปิด Cloud Real-time ของส่วนงานเหล็กม้วน"
                : "Click to turn ON Cloud Real-time"
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isCloudRealtime ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
              }`}
            />
            <span>{isCloudRealtime ? "ON" : "OFF"}</span>
          </button>

          {!isCloudRealtime && (
            <button
              type="button"
              onClick={() => {
                setManualRefreshTick((t) => t + 1);
                showToast(
                  isThai ? "กำลังดึงข้อมูลเหล็กม้วนล่าสุดจาก Cloud..." : "Reloading Coil data...",
                  "info"
                );
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold border bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 cursor-pointer"
            >
              <RefreshCw size={12} className={isCloudLoading ? "animate-spin" : ""} />
              <span>{isThai ? "โหลดข้อมูล" : "Reload"}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 cursor-pointer"
            title={isThai ? "เปิด/ปิดเสียงแจ้งเตือนสแกน" : "Toggle Sound"}
          >
            {soundEnabled ? (
              <Volume2 size={13} className="text-emerald-500" />
            ) : (
              <VolumeX size={13} className="text-slate-400" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              Swal.fire({
                title: isThai ? "ล้างข้อมูลส่วนงานเหล็กม้วนทั้งหมด?" : "Reset All Coil Data?",
                text: isThai
                  ? "จะลบเฉพาะข้อมูลในฐานข้อมูลเหล็กม้วน (coil_stock, coil_transactions, coil_staging) โดยไม่กระทบส่วนงานเหล็กสลิต"
                  : "Clears only Coil collections without affecting Slit data.",
                icon: "warning",
                showCancelButton: true,
                confirmButtonColor: "#dc2626",
                confirmButtonText: isThai ? "ยืนยันล้างข้อมูล" : "Reset Coil DB",
                cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
              }).then(async (res) => {
                if (res.isConfirmed) {
                  await clearAllCoilDataFromCloud();
                  showToast(isThai ? "ล้างข้อมูลเหล็กม้วนเรียบร้อย" : "Coil data cleared", "success");
                }
              });
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 cursor-pointer"
          >
            <Trash2 size={13} />
            <span className="hidden sm:inline">{isThai ? "รีเซ็ต" : "Reset"}</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          TAB 1: + รับเข้า (INBOUND COIL)
         ===================================================================== */}
      {activeMode === "inbound" && (
        <div className="space-y-3">
          {/* Inbound Source Type Switcher */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
            <button
              type="button"
              onClick={() => setInboundSourceType("external")}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                inboundSourceType === "external"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <Factory size={15} />
              <span>{isThai ? "รับเข้าเหล็กม้วน" : "Supplier Mother Coil Inbound"}</span>
            </button>
            <button
              type="button"
              onClick={() => setInboundSourceType("internal")}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                inboundSourceType === "internal"
                  ? "bg-teal-600 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <Cpu size={15} />
              <span>{isThai ? "คืนคลัง" : "Return from Machine (CL01 - CL06, SM01 - SM04)"}</span>
            </button>
          </div>

          {/* Inbound Entry & Fast Shop-Floor Scanner Card */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-[#1e3a5f] pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
                  <ArrowDownRight size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 m-0">
                    {inboundSourceType === "internal"
                      ? isThai
                        ? "สแกนรับเหล็กม้วนคืนคลัง"
                        : "Scan Coil Return to Warehouse"
                      : isThai
                      ? "สแกนรับเข้าเหล็กม้วน (+รับเข้า)"
                      : "Scan Coil Inbound"}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 m-0">
                    {isThai
                      ? "ทำตาม 4 ขั้นตอน: สแกน Batch → เลือกประตู → เลือกแถว → เลือกชั้น (ระบบแนะนำชั้นและลำดับวางต่ออัตโนมัติ)"
                      : "4-Step Inbound: Scan Batch → Select Door → Select Row → Select Level (Auto-recommended Slot)"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCameraOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-100 cursor-pointer"
                >
                  <Camera size={13} />
                  <span>{isThai ? "สแกนด้วยกล้อง" : "Camera Scan"}</span>
                </button>
              </div>
            </div>

            {/* Machine Selector when in Return to Warehouse ("คืนคลัง") mode */}
            {inboundSourceType === "internal" && (
              <div className="p-3 rounded-xl bg-teal-50/60 dark:bg-[#0c1930] border border-teal-200 dark:border-teal-900/60 space-y-1.5">
                <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Cpu size={14} className="text-teal-500" />
                  <span>{isThai ? "รับคืนจากเครื่องจักร:" : "Return from Machine:"}</span>
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SLITTING_MACHINES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setInboundMachine(m);
                        focusInboundBatchInput();
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border cursor-pointer transition-all ${
                        inboundMachine === m
                          ? "bg-teal-600 text-white border-teal-500 shadow-xs"
                          : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f] hover:border-teal-400"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 1: Barcode / Batch Scanner Input */}
            <form onSubmit={(e) => handleInboundSubmit(e)} className="pt-0.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-black inline-flex items-center justify-center">
                    1
                  </span>
                  <span>
                    {isThai
                      ? "สแกนบาร์โค้ด / รหัส Batch"
                      : "Step 1: Scan Barcode / Batch No."}
                  </span>
                </label>
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                    !isInboundLocationComplete
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                      : inboundPlacementValidation && !inboundPlacementValidation.valid
                      ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  <MapPin
                    size={12}
                    className={
                      !isInboundLocationComplete
                        ? "text-amber-500"
                        : inboundPlacementValidation && !inboundPlacementValidation.valid
                        ? "text-red-500"
                        : "text-emerald-500"
                    }
                  />
                  <span>{isThai ? "ตำแหน่งปลายทาง:" : "Target:"}</span>
                  <span className="font-mono font-black">
                    {isInboundLocationComplete
                      ? effectiveInboundLocation
                      : isThai
                      ? "ยังเลือกพิกัดไม่ครบ"
                      : "Incomplete"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1 flex items-center">
                  <Barcode size={18} className="absolute left-3.5 text-emerald-500" />
                  <input
                    ref={inboundBatchInputRef}
                    type="text"
                    autoFocus
                    maxLength={10}
                    value={inboundScanInput}
                    onChange={(e) => setInboundScanInput(e.target.value.toUpperCase())}
                    placeholder={
                      isInboundLocationComplete
                        ? isThai
                          ? `ยิงบาร์โค้ด หรือพิมพ์รหัส Batch (A-Z, 0-9 ไม่เกิน 10 หลัก) เข้าที่ ${effectiveInboundLocation}...`
                          : `Scan or type Batch (A-Z, 0-9 max 10 chars) into ${effectiveInboundLocation}...`
                        : isThai
                        ? "สแกนหรือพิมพ์รหัส Batch แล้วเลือก ประตู → แถว → ชั้น ด้านล่างให้ครบก่อนบันทึก..."
                        : "Scan or type Batch, then select Door → Row → Level below before saving..."
                    }
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm sm:text-base font-mono font-black border-2 border-emerald-500 dark:border-emerald-500 bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!isInboundLocationComplete}
                  title={
                    !isInboundLocationComplete
                      ? isThai
                        ? "กรุณาเลือก ประตู แถว และชั้น ให้ครบก่อนบันทึกรับเข้า"
                        : "Select Door, Row, and Level before saving"
                      : undefined
                  }
                  className={`py-3 px-5 rounded-xl text-xs sm:text-sm font-extrabold shadow-sm flex items-center justify-center gap-1.5 shrink-0 transition-all ${
                    isInboundLocationComplete
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                      : "bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700 cursor-not-allowed"
                  }`}
                >
                  {isInboundLocationComplete ? <Plus size={16} /> : <Lock size={15} />}
                  <span>
                    {isInboundLocationComplete
                      ? isThai
                        ? `บันทึกรับเข้า (${effectiveInboundLocation})`
                        : `Save (${effectiveInboundLocation})`
                      : isThai
                      ? "กรุณาเลือกพิกัดให้ครบ"
                      : "Select Location First"}
                  </span>
                </button>
              </div>
            </form>

            {/* STEPS 2, 3, 4: Guided Door -> Row -> Level (Sequential Selection) */}
            <div className="p-3.5 rounded-xl bg-slate-50/90 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] space-y-3.5">
              {/* STEP 2: Select Door (E7, E8, H7, H8, 05, 21) */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-black inline-flex items-center justify-center">
                      2
                    </span>
                    <Building2 size={14} className="text-emerald-500" />
                    <span>{isThai ? "เลือกประตูที่วาง (เช่น E7 หรือ E8):" : "Step 2: Select Door (e.g. E7, E8):"}</span>
                  </label>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold ${
                      isInboundLocationComplete
                        ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    <Lock size={11} />
                    <span>
                      {isInboundLocationComplete
                        ? isThai
                          ? `พิกัดปัจจุบัน: ${effectiveInboundLocation}`
                          : `Active Slot: ${effectiveInboundLocation}`
                        : hasSelectedInboundRow
                        ? isThai
                          ? `ประตู ${inboundBuilding} แถว ${inboundRow} · รอเลือกชั้น`
                          : `Door ${inboundBuilding} Row ${inboundRow} · Select Level`
                        : hasSelectedInboundDoor
                        ? isThai
                          ? `ประตู ${inboundBuilding} · รอเลือกแถว`
                          : `Door ${inboundBuilding} · Select Row`
                        : isThai
                        ? "ยังไม่เลือกประตู"
                        : "No Door Selected"}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {INBOUND_BUILDINGS.map((doorCode) => {
                    const isSelected = hasSelectedInboundDoor && inboundBuilding.toUpperCase() === doorCode;
                    const doorCount = inboundDoorCoilCounts[doorCode] || 0;
                    return (
                      <button
                        key={doorCode}
                        type="button"
                        onClick={() => handleSelectInboundBuilding(doorCode)}
                        className={`py-2 px-3 rounded-xl text-sm font-black border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          isSelected
                            ? "bg-emerald-600 text-white border-emerald-500 shadow-sm ring-2 ring-emerald-500/30"
                            : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1e3a5f] hover:border-emerald-400"
                        }`}
                      >
                        <MapPin size={14} className={isSelected ? "text-white" : "text-emerald-500"} />
                        <span>{doorCode}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                            isSelected
                              ? "bg-white/20 text-white"
                              : "bg-slate-100 dark:bg-[#0a1428] text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {doorCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* STEP 3: Select Row (Revealed only after Door is selected) */}
              <div className="pt-2.5 border-t border-slate-200/70 dark:border-[#1e3a5f]/80">
                <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mb-2">
                  <span
                    className={`w-5 h-5 rounded-full text-white text-[11px] font-black inline-flex items-center justify-center ${
                      hasSelectedInboundDoor ? "bg-emerald-600" : "bg-slate-400 dark:bg-slate-600"
                    }`}
                  >
                    3
                  </span>
                  <span>
                    {hasSelectedInboundDoor
                      ? isThai
                        ? `เลือกแถวที่จะวาง ประตู ${inboundBuilding} (เช่น แถว 1):`
                        : `Step 3: Select Row in Door ${inboundBuilding}:`
                      : isThai
                      ? "เลือกแถวที่จะวาง:"
                      : "Step 3: Select Row:"}
                  </span>
                </label>
                {!hasSelectedInboundDoor ? (
                  <div className="px-3 py-2.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-[#0f1c33]/60 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <Info size={14} className="text-amber-500 shrink-0" />
                    <span>
                      {isThai
                        ? "กรุณาเลือกประตูที่วางในขั้นตอนที่ 2 ก่อน เพื่อแสดงรายการแถวและจำนวนม้วนของประตูนั้น"
                        : "Select a Door in Step 2 first to view available rows and occupancy."}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {INBOUND_QUICK_ROWS.map((r) => {
                      const rowNum = parseInt(r, 10);
                      const isRowActive = hasSelectedInboundRow && inboundRow.toUpperCase() === r;
                      const countInRow = inboundSelectedDoorRowCounts[rowNum] || 0;
                      const maxRowCap = getMaxCoilsPerRow(warehouseBaseSlotsPerRow);
                      const isFullRow = countInRow >= maxRowCap;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => handleSelectInboundRow(r, true)}
                          className={`min-w-[52px] h-10 px-2.5 rounded-lg text-xs font-black border transition-all cursor-pointer flex flex-col items-center justify-center leading-tight ${
                            isRowActive
                              ? "bg-emerald-600 text-white border-emerald-500 shadow-xs ring-2 ring-emerald-500/25"
                              : isFullRow
                              ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800/60"
                              : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1e3a5f] hover:border-emerald-400"
                          }`}
                        >
                          <span>{isThai ? `แถว ${r}` : `R${r}`}</span>
                          <span
                            className={`text-[9.5px] font-bold ${
                              isRowActive
                                ? "text-emerald-100"
                                : isFullRow
                                ? "text-red-500 dark:text-red-400"
                                : countInRow > 0
                                ? "text-sky-600 dark:text-sky-400"
                                : "text-slate-400"
                            }`}
                          >
                            {countInRow > 0 ? `${countInRow}/${maxRowCap}` : isThai ? "ว่าง" : "Empty"}
                          </span>
                        </button>
                      );
                    })}
                    <input
                      type="text"
                      value={inboundRow}
                      onChange={(e) => handleSelectInboundRow(e.target.value, false)}
                      placeholder={isThai ? "ระบุแถว..." : "Row..."}
                      className="w-24 h-10 px-2.5 rounded-lg text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-900 dark:text-white"
                      title={isThai ? "พิมพ์เลขแถวที่วางเองได้" : "Type custom row"}
                    />
                  </div>
                )}
              </div>

              {/* STEP 4: Select Level (Revealed only after Door & Row are selected) */}
              <div className="pt-2.5 border-t border-slate-200/70 dark:border-[#1e3a5f]/80 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <span
                      className={`w-5 h-5 rounded-full text-white text-[11px] font-black inline-flex items-center justify-center ${
                        inboundRowOccupancy ? "bg-emerald-600" : "bg-slate-400 dark:bg-slate-600"
                      }`}
                    >
                      4
                    </span>
                    <Layers
                      size={14}
                      className={inboundRowOccupancy ? "text-emerald-500" : "text-slate-400"}
                    />
                    <span>
                      {isThai
                        ? "เลือกชั้นที่จะวาง (ระบบแนะนำอัตโนมัติตามสถานะว่างของแถว):"
                        : "Step 4: Select Level (Auto-Recommended):"}
                    </span>
                  </label>
                  {inboundRowOccupancy && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                        inboundRowOccupancy.isRowCompletelyFull
                          ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
                          : "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800/70"
                      }`}
                    >
                      <Sparkles size={12} className="shrink-0" />
                      <span>
                        {isThai
                          ? inboundRowOccupancy.reasonTh
                          : inboundRowOccupancy.reasonEn}
                      </span>
                    </span>
                  )}
                </div>

                {!inboundRowOccupancy ? (
                  <div className="px-3 py-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-[#0f1c33]/60 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <Info size={14} className="text-amber-500 shrink-0" />
                    <span>
                      {!hasSelectedInboundDoor
                        ? isThai
                          ? "กรุณาเลือกประตู (ขั้นตอนที่ 2) และแถว (ขั้นตอนที่ 3) ก่อน เพื่อคำนวณสถานะชั้นและแสดงผังช่องวางปัจจุบัน"
                          : "Select a Door (Step 2) and Row (Step 3) first to calculate level status and live row map."
                        : isThai
                        ? `กรุณาเลือกแถวในขั้นตอนที่ 3 ของประตู ${inboundBuilding} ก่อน เพื่อคำนวณสถานะชั้นและแสดงผังช่องวางปัจจุบัน`
                        : `Select a Row in Door ${inboundBuilding} (Step 3) first to calculate level status and live row map.`}
                    </span>
                  </div>
                ) : (
                  <>

                {/* Level 1 to Level 4 Cards (Strictly Max 4 Levels) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
                  {STACK_LEVELS.map((lv) => {
                    const info = inboundRowOccupancy.levels[lv];
                    const isBase = lv === 1;
                    const isLocked = !isBase && !info.canPlace;
                    const isSelected = effectiveInboundLevel === lv && (isBase || info.canPlace);
                    const isRecommended =
                      inboundRowOccupancy.recommendedLevel === lv &&
                      (isBase || info.canPlace) &&
                      !inboundRowOccupancy.isRowCompletelyFull;
                    const pct =
                      info.capacity > 0
                        ? Math.min(100, Math.round((info.occupiedCount / info.capacity) * 100))
                        : 100;

                    const themeMap: Record<
                      StackLevel,
                      {
                        subtitleTh: string;
                        subtitleEn: string;
                        selectedCard: string;
                        hoverCard: string;
                        badgeSelected: string;
                        readyBadge: string;
                        barColor: string;
                        nextText: string;
                      }
                    > = {
                      1: {
                        subtitleTh: "วางฐานพื้น",
                        subtitleEn: "Floor Base",
                        selectedCard:
                          "bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/25 shadow-xs",
                        hoverCard: "hover:border-emerald-400",
                        badgeSelected: "bg-emerald-600 text-white",
                        readyBadge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                        barColor: "bg-emerald-500",
                        nextText: "text-emerald-700 dark:text-emerald-300",
                      },
                      2: {
                        subtitleTh: "ซ้อนบนชั้น 1",
                        subtitleEn: "Above L1",
                        selectedCard:
                          "bg-indigo-50/90 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/25 shadow-xs",
                        hoverCard: "hover:border-indigo-400",
                        badgeSelected: "bg-indigo-600 text-white",
                        readyBadge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
                        barColor: "bg-indigo-500",
                        nextText: "text-indigo-700 dark:text-indigo-300",
                      },
                      3: {
                        subtitleTh: "ซ้อนบนชั้น 2",
                        subtitleEn: "Above L2",
                        selectedCard:
                          "bg-violet-50/90 dark:bg-violet-950/40 border-violet-500 ring-2 ring-violet-500/25 shadow-xs",
                        hoverCard: "hover:border-violet-400",
                        badgeSelected: "bg-violet-600 text-white",
                        readyBadge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
                        barColor: "bg-violet-500",
                        nextText: "text-violet-700 dark:text-violet-300",
                      },
                      4: {
                        subtitleTh: "ชั้นสูงสุด",
                        subtitleEn: "Top (Max)",
                        selectedCard:
                          "bg-amber-50/90 dark:bg-amber-950/35 border-amber-500 ring-2 ring-amber-500/25 shadow-xs",
                        hoverCard: "hover:border-amber-400",
                        badgeSelected: "bg-amber-600 text-white",
                        readyBadge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                        barColor: "bg-amber-500",
                        nextText: "text-amber-700 dark:text-amber-300",
                      },
                    };
                    const t = themeMap[lv];

                    return (
                      <button
                        key={`level-card-${lv}`}
                        type="button"
                        aria-disabled={isLocked}
                        onClick={() => handleSelectInboundLevel(lv)}
                        className={`text-left p-2.5 rounded-xl border transition-all space-y-2 ${
                          isLocked
                            ? "bg-slate-50/80 dark:bg-[#0c162b] border-slate-200 dark:border-slate-800 opacity-75 cursor-not-allowed"
                            : isSelected
                            ? `${t.selectedCard} cursor-pointer`
                            : `bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] ${t.hoverCard} cursor-pointer`
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] font-black inline-flex items-center gap-1 shrink-0 ${
                                isSelected
                                  ? t.badgeSelected
                                  : isLocked
                                  ? "bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                                  : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                              }`}
                            >
                              {isLocked && <Lock size={10} />}
                              {isThai ? `ชั้นที่ ${lv}` : `Level ${lv}`}
                            </span>
                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate">
                              {isThai ? t.subtitleTh : t.subtitleEn}
                            </span>
                          </div>
                          {isRecommended && (
                            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-extrabold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/40 shrink-0">
                              {isThai ? "แนะนำ" : "Auto"}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-1 text-[10px]">
                          <span className="text-slate-500 dark:text-slate-400">
                            {info.occupiedCount}/{info.capacity} {isThai ? "ม้วน" : "coils"}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-extrabold ${
                              info.isFull
                                ? "bg-red-500/15 text-red-600 dark:text-red-300"
                                : isBase
                                ? t.readyBadge
                                : info.canPlace
                                ? t.readyBadge
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            }`}
                          >
                            {info.isFull
                              ? isThai
                                ? "เต็มแล้ว"
                                : "Full"
                              : isBase
                              ? isThai
                                ? `ว่าง ${info.availableCount}`
                                : `${info.availableCount} Free`
                              : info.canPlace
                              ? isThai
                                ? `ซ้อนได้ ${info.availableSupportedSlots.length}`
                                : `${info.availableSupportedSlots.length} Ready`
                              : isThai
                              ? `ขาดฐานชั้น ${lv - 1}`
                              : `Needs L${lv - 1}`}
                          </span>
                        </div>

                        <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              info.isFull ? "bg-red-500" : isLocked ? "bg-slate-400" : t.barColor
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[10.5px] gap-1">
                          {(isBase || info.canPlace) && info.nextSeq !== null ? (
                            <span className={`font-mono font-extrabold ${t.nextText}`}>
                              {isThai ? "ถัดไป:" : "Next:"}{" "}
                              {inboundRowOccupancy.door}/{inboundRowOccupancy.row}/{lv}/{info.nextSeq}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 truncate">
                              {info.isFull
                                ? isThai
                                  ? `ชั้น ${lv} เต็มแล้ว`
                                  : `L${lv} Full`
                                : isThai
                                ? `ต้องมีชั้น ${lv - 1} ติดกัน 2 ลูก`
                                : `Needs 2 adjacent L${lv - 1}`}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Live Mini Pyramid Slot Map (4 Tiers Max: L4 down to L1) */}
                <div className="pt-1">
                  {/* Visual Row Slot Occupancy Map */}
                  <div className="p-2.5 rounded-lg bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10.5px] font-bold text-slate-500 dark:text-slate-400">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>
                          {isThai
                            ? `ผังช่องวางปัจจุบัน (สูงสุด ${MAX_STACK_LEVEL} ชั้น): ประตู ${inboundRowOccupancy.door} แถว ${inboundRowOccupancy.row}`
                            : `Live Row Map (Max ${MAX_STACK_LEVEL} Levels): ${inboundRowOccupancy.door} Row ${inboundRowOccupancy.row}`}
                        </span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#0a1428] border border-slate-200 dark:border-[#1e3a5f] text-[10px]">
                          <span className="text-slate-500 dark:text-slate-400">
                            {isThai ? "ฐาน/แถว:" : "Base/Row:"}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleChangeWarehouseBaseSlots(warehouseBaseSlotsPerRow - 1)}
                            disabled={warehouseBaseSlotsPerRow <= MIN_BASE_SLOTS_PER_ROW}
                            className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 inline-flex items-center justify-center cursor-pointer"
                            title={isThai ? "ลดจำนวนลูกต่อแถว" : "Decrease coils per row"}
                          >
                            <Minus size={10} />
                          </button>
                          <span className="font-mono font-black text-emerald-700 dark:text-emerald-300 px-0.5">
                            {warehouseBaseSlotsPerRow}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleChangeWarehouseBaseSlots(warehouseBaseSlotsPerRow + 1)}
                            disabled={warehouseBaseSlotsPerRow >= MAX_BASE_SLOTS_PER_ROW}
                            className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 inline-flex items-center justify-center cursor-pointer"
                            title={isThai ? "เพิ่มจำนวนลูกต่อแถว" : "Increase coils per row"}
                          >
                            <Plus size={10} />
                          </button>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[10px]">
                        <span className="inline-flex items-center gap-1 font-extrabold text-fuchsia-700 dark:text-fuchsia-300">
                          <span className="w-2.5 h-2.5 rounded-xs bg-fuchsia-600 ring-1 ring-fuchsia-300" />
                          {isThai ? "กำลังเลือก" : "Selected"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-xs bg-sky-500" />
                          {isThai ? "มีม้วน" : "Used"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-xs bg-emerald-500" />
                          {isThai ? "ตำแหน่งถัดไป" : "Next"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-xs bg-indigo-400" />
                          {isThai ? "ซ้อนได้" : "Ready"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-xs border border-dashed border-slate-400 bg-slate-200 dark:bg-slate-800" />
                          {isThai ? "ล็อก (ขาดฐาน)" : "No Base"}
                        </span>
                      </div>
                    </div>

                    {/* Pyramid Tiers from Level 4 (Top) down to Level 1 (Floor Base) */}
                    {([4, 3, 2, 1] as StackLevel[]).map((lv) => {
                      const lvInfo = inboundRowOccupancy.levels[lv];
                      const lowerInfo = lv >= 2 ? inboundRowOccupancy.levels[(lv - 1) as StackLevel] : null;
                      const isActiveSelectedTier = Boolean(
                        selectedInboundCoords &&
                          selectedInboundCoords.matchesCurrentRow &&
                          selectedInboundCoords.validLevel === lv
                      );
                      const labelColorClass = isActiveSelectedTier
                        ? "text-fuchsia-700 dark:text-fuchsia-300 font-black"
                        : lv === 1
                        ? "text-emerald-600 dark:text-emerald-400"
                        : lv === 2
                        ? "text-indigo-500"
                        : lv === 3
                        ? "text-violet-500"
                        : "text-amber-500";
                      const readySlotClass =
                        lv === 1
                          ? "bg-slate-100 dark:bg-[#0a1428] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-fuchsia-400 cursor-pointer"
                          : lv === 2
                          ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 border-indigo-400 dark:border-indigo-600 hover:bg-indigo-100 cursor-pointer"
                          : lv === 3
                          ? "bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-300 border-violet-400 dark:border-violet-600 hover:bg-violet-100 cursor-pointer"
                          : "bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-300 border-amber-400 dark:border-amber-600 hover:bg-amber-100 cursor-pointer";
                      const indentPx = (lv - 1) * 14;
                      const isValidationValid = inboundPlacementValidation
                        ? inboundPlacementValidation.valid
                        : true;

                      return (
                        <div
                          key={`tier-${lv}`}
                          className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors ${
                            isActiveSelectedTier
                              ? "bg-fuchsia-50/75 dark:bg-fuchsia-950/25"
                              : ""
                          }`}
                        >
                          <span className={`w-10 text-[10px] font-bold shrink-0 ${labelColorClass}`}>
                            {isThai ? `ชั้น ${lv}` : `L${lv}`}
                          </span>
                          <div
                            className="flex items-center gap-1 flex-wrap"
                            style={{ paddingLeft: `${indentPx}px` }}
                          >
                            {Array.from({ length: lvInfo.capacity }, (_, i) => i + 1).map((slotNum) => {
                              const isUsed = lvInfo.occupiedSlots.includes(slotNum);
                              const isSupported = lv === 1 || lvInfo.supportedSlots.includes(slotNum);
                              const isSelectedSlot = Boolean(
                                selectedInboundCoords &&
                                  selectedInboundCoords.matchesCurrentRow &&
                                  selectedInboundCoords.validLevel === lv &&
                                  selectedInboundCoords.seq === slotNum
                              );
                              const isNextTarget =
                                inboundRowOccupancy.recommendedLevel === lv &&
                                inboundRowOccupancy.recommendedSeq === slotNum &&
                                isSupported;
                              const isLockedSlot = lv >= 2 && !isUsed && !isSupported;
                              const missingBase =
                                lowerInfo !== null
                                  ? [slotNum, slotNum + 1].filter(
                                      (s) => !lowerInfo.occupiedSlots.includes(s)
                                    )
                                  : [];

                              const slotStateClass = isSelectedSlot
                                ? isValidationValid
                                  ? "bg-fuchsia-600 text-white border-fuchsia-300 ring-2 ring-fuchsia-400/75 ring-offset-1 ring-offset-white dark:ring-offset-[#111e38] shadow-sm scale-105 z-10 cursor-pointer"
                                  : "bg-red-600 text-white border-red-300 ring-2 ring-red-400/75 ring-offset-1 ring-offset-white dark:ring-offset-[#111e38] shadow-sm scale-105 z-10 cursor-pointer"
                                : isNextTarget
                                ? "bg-emerald-600 text-white border-emerald-400 ring-2 ring-emerald-500/30 cursor-pointer"
                                : isUsed
                                ? "bg-sky-600 text-white border-sky-500 cursor-pointer"
                                : isSupported
                                ? readySlotClass
                                : "bg-slate-100/70 dark:bg-[#091224] text-slate-400/70 border-dashed border-slate-300 dark:border-slate-700 cursor-not-allowed opacity-65";

                              return (
                                <button
                                  key={`L${lv}-${slotNum}`}
                                  type="button"
                                  aria-pressed={isSelectedSlot}
                                  aria-disabled={isLockedSlot}
                                  onClick={() => {
                                    if (lv >= 2 && !isSupported) {
                                      playBeep("error");
                                      showToast(
                                        isThai
                                          ? `ไม่สามารถวางชั้นที่ ${lv} ลูกที่ ${slotNum} (${inboundRowOccupancy.door}/${inboundRowOccupancy.row}/${lv}/${slotNum}) ได้ — ต้องมีฐานชั้นที่ ${lv - 1} ลูกที่ ${slotNum} และลูกที่ ${slotNum + 1} รองรับก่อน (ยังขาดลูกที่ ${missingBase.join(" และ ")})`
                                          : `Cannot place on Level ${lv} Slot ${slotNum} — requires Level ${lv - 1} base coils #${slotNum} and #${slotNum + 1}`,
                                        "error"
                                      );
                                      focusInboundBatchInput();
                                      return;
                                    }
                                    const nextLoc = `${inboundRowOccupancy.door}/${inboundRowOccupancy.row}/${lv}/${slotNum}`;
                                    setInboundLevel(lv);
                                    setInboundManualLocationOverride(nextLoc);
                                    setInboundLocation(nextLoc);
                                    focusInboundBatchInput();
                                  }}
                                  title={
                                    isSelectedSlot
                                      ? isThai
                                        ? `กำลังเลือก: ${inboundRowOccupancy.door}/${inboundRowOccupancy.row}/${lv}/${slotNum} (ชั้น ${lv} ลำดับ ${slotNum})`
                                        : `Selected: ${inboundRowOccupancy.door}/${inboundRowOccupancy.row}/${lv}/${slotNum}`
                                      : isLockedSlot
                                      ? isThai
                                        ? `วางไม่ได้: ชั้น ${lv} ลูกที่ ${slotNum} ต้องมีฐานชั้น ${lv - 1} ลูกที่ ${slotNum} และลูกที่ ${slotNum + 1} รองรับก่อน`
                                        : `Locked: L${lv} #${slotNum} requires L${lv - 1} #${slotNum} & #${slotNum + 1}`
                                      : `${inboundRowOccupancy.door}/${inboundRowOccupancy.row}/${lv}/${slotNum}`
                                  }
                                  className={`relative w-7 h-6 rounded text-[10px] font-mono font-black border transition-all inline-flex items-center justify-center ${slotStateClass}`}
                                >
                                  {slotNum}
                                  {isSelectedSlot && isNextTarget && isValidationValid && (
                                    <span
                                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 border border-white dark:border-[#111e38]"
                                      title={isThai ? "ตรงกับตำแหน่งถัดไป" : "Auto next slot"}
                                    />
                                  )}
                                  {isSelectedSlot && isUsed && isValidationValid && (
                                    <span
                                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-300 border border-white dark:border-[#111e38]"
                                      title={isThai ? "ช่องนี้มีม้วนอยู่แล้ว" : "Slot already occupied"}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Selected Coordinate Summary Strip */}
                    {!selectedInboundCoords ? (
                      <div className="mt-1 px-2.5 py-1.5 rounded-lg border border-amber-300/80 dark:border-amber-700/70 bg-amber-50/80 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-500 text-white">
                            <MapPin size={10} />
                            {isThai ? "รอเลือกชั้น/ช่อง" : "Select Level/Slot"}
                          </span>
                          <span className="font-bold">
                            {isThai
                              ? `ประตู ${inboundRowOccupancy.door} · แถว ${inboundRowOccupancy.row} — กรุณาเลือกชั้นด้านบน หรือคลิกช่องที่ต้องการบนผัง`
                              : `Door ${inboundRowOccupancy.door} · Row ${inboundRowOccupancy.row} — Select a level above or click a slot on the map`}
                          </span>
                        </div>
                        {!inboundRowOccupancy.isRowCompletelyFull && (
                          <button
                            type="button"
                            onClick={() => {
                              setInboundLevel(inboundRowOccupancy.recommendedLevel);
                              setInboundManualLocationOverride(null);
                              focusInboundBatchInput();
                            }}
                            className="text-[10.5px] font-extrabold underline text-emerald-700 dark:text-emerald-300 hover:opacity-80 cursor-pointer"
                          >
                            {isThai
                              ? `ใช้ตำแหน่งแนะนำ (${inboundRowOccupancy.recommendedLocation})`
                              : `Use Recommended (${inboundRowOccupancy.recommendedLocation})`}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div
                        className={`mt-1 px-2.5 py-1.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-[11px] ${
                          inboundPlacementValidation && !inboundPlacementValidation.valid
                            ? "bg-red-50/90 dark:bg-red-950/35 border-red-200 dark:border-red-800/80 text-red-700 dark:text-red-300"
                            : "bg-fuchsia-50/90 dark:bg-fuchsia-950/30 border-fuchsia-300/80 dark:border-fuchsia-700/70 text-fuchsia-900 dark:text-fuchsia-100"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black text-white ${
                              inboundPlacementValidation && !inboundPlacementValidation.valid
                                ? "bg-red-600"
                                : "bg-fuchsia-600"
                            }`}
                          >
                            <MapPin size={10} />
                            {isThai ? "กำลังเลือก" : "Selected"}
                          </span>
                          <span className="font-mono font-black text-xs">
                            {selectedInboundCoords.fullCode}
                          </span>
                          <span className="text-[10.5px] opacity-90">
                            {isThai
                              ? `(ประตู ${selectedInboundCoords.door} · แถว ${selectedInboundCoords.row} · ชั้น ${selectedInboundCoords.level} · ลำดับ ${selectedInboundCoords.seq ?? "-"})`
                              : `(Door ${selectedInboundCoords.door} · Row ${selectedInboundCoords.row} · L${selectedInboundCoords.level} · #${selectedInboundCoords.seq ?? "-"})`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {inboundPlacementValidation && !inboundPlacementValidation.valid ? (
                            <>
                              <span className="px-1.5 py-0.5 rounded bg-red-600/15 text-red-700 dark:text-red-300 text-[10px] font-extrabold">
                                {isThai ? "พิกัดไม่ผ่านเงื่อนไข" : "Invalid Slot"}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setInboundLevel(inboundRowOccupancy.recommendedLevel);
                                  setInboundManualLocationOverride(null);
                                  focusInboundBatchInput();
                                }}
                                className="text-[10px] font-extrabold underline text-red-700 dark:text-red-200 hover:opacity-80 cursor-pointer"
                              >
                                {isThai
                                  ? `ใช้พิกัดแนะนำ (${inboundPlacementValidation.recommendedLocation})`
                                  : `Use Recommended (${inboundPlacementValidation.recommendedLocation})`}
                              </button>
                            </>
                          ) : selectedInboundCoords.isOccupiedSlot ? (
                            <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-700 dark:text-sky-300 text-[10px] font-extrabold">
                              {isThai ? "ช่องนี้มีม้วนอยู่แล้ว" : "Occupied"}
                            </span>
                          ) : selectedInboundCoords.isAutoRecommended ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-extrabold">
                              {isThai ? "ตำแหน่งถัดไปอัตโนมัติ" : "Auto Next"}
                            </span>
                          ) : (
                            <>
                              <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300 text-[10px] font-extrabold">
                                {isThai ? "เลือกช่องเอง" : "Custom Slot"}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setInboundLevel(inboundRowOccupancy.recommendedLevel);
                                  setInboundManualLocationOverride(null);
                                  focusInboundBatchInput();
                                }}
                                className="text-[10px] font-extrabold underline text-emerald-700 dark:text-emerald-300 hover:opacity-80 cursor-pointer"
                              >
                                {isThai
                                  ? `กลับตำแหน่งถัดไป (${inboundRowOccupancy.recommendedLocation})`
                                  : `Use Next (${inboundRowOccupancy.recommendedLocation})`}
                              </button>
                            </>
                          )}
                        </div>
                        {inboundPlacementValidation && !inboundPlacementValidation.valid && (
                          <div className="w-full pt-1 border-t border-red-200/70 dark:border-red-800/60 flex items-start gap-1.5 text-[10.5px] font-bold">
                            <AlertTriangle size={13} className="shrink-0 mt-0.5 text-red-500" />
                            <span>
                              {isThai
                                ? inboundPlacementValidation.reasonTh
                                : inboundPlacementValidation.reasonEn}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-0.5 flex items-center gap-1">
                      <ShieldCheck size={11} className="text-indigo-500 shrink-0" />
                      <span>
                        {isThai
                          ? `จำกัดความสูงสูงสุด ${MAX_STACK_LEVEL} ชั้น · การวางชั้น 2–${MAX_STACK_LEVEL} ลูกที่ k ต้องมีฐานชั้นล่างลูกที่ k และ k+1 รองรับครบทั้ง 2 ลูก`
                          : `Max ${MAX_STACK_LEVEL} levels · Upper levels (L2–L${MAX_STACK_LEVEL}) slot k require BOTH lower-level coils #k and #(k+1).`}
                      </span>
                    </p>
                  </div>
                </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Recent Inbound Coils Table (4 Columns: วัน-เวลารับเข้า, Batch, Location, สถานะ — Available & Scanned only) */}
          {(() => {
            const availableInboundCoils = coilStock.filter((c) => {
              if (c.status !== "available") return false;
              if (!c.location || c.location === "-") return false;
              if (!inboundSearch.trim()) return true;
              const q = inboundSearch.toLowerCase();
              return `${c.batch} ${c.location}`.toLowerCase().includes(q);
            });
            return (
              <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers size={15} className="text-emerald-500" />
                    <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                      {isThai
                        ? `รายการรับเข้าล่าสุด (${availableInboundCoils.length} รายการ)`
                        : `Recent Inbound Coils (${availableInboundCoils.length})`}
                    </span>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={inboundSearch}
                      onChange={(e) => setInboundSearch(e.target.value)}
                      placeholder={isThai ? "ค้นหา Batch หรือ Location..." : "Search Batch or Location..."}
                      className="field w-full rounded-md font-normal border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                      style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th>{isThai ? "วัน-เวลารับเข้า" : "Timestamp"}</th>
                        <th>Batch</th>
                        <th>Location</th>
                        <th>{isThai ? "สถานะ" : "Status"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableInboundCoils.slice(0, 50).map((c) => (
                        <tr key={c.id}>
                          <td className="font-mono text-[11px]">{c.scanTimestamp}</td>
                          <td>
                            <span className="code font-mono font-bold">{c.batch}</span>
                          </td>
                          <td>
                            <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 font-mono font-bold text-[11px]">
                              {c.location}
                            </span>
                          </td>
                          <td>
                            <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-emerald-500/20 text-emerald-400">
                              {isThai ? "พร้อมใช้" : "Available"}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {availableInboundCoils.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center py-8 text-slate-400">
                            {isThai
                              ? "ยังไม่มีรายการเหล็กม้วนสถานะพร้อมใช้ กรุณาเลือก Location และสแกนรหัส Batch เพื่อเริ่มรับเข้า"
                              : "No available inbound coil records yet."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* =====================================================================
          TAB 2: จ่ายออก (ISSUE / OPERATOR RECEIVE AT MACHINE)
         ===================================================================== */}
      {activeMode === "operator_receive" && (
        <div className="space-y-3">
          {/* Machine Selection Grid Card for Operator */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-extrabold flex items-center justify-center">
                  1
                </span>
                <div>
                  <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                    {isThai
                      ? "เลือกเครื่องจักรของผู้ปฏิบัติงาน (Operator Machine Selection)"
                      : "Operator Machine Selection"}
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 m-0">
                    {isThai
                      ? "เลือกเครื่องจักรเพื่อดูรายการใบสั่งเบิกที่เจ้าหน้าที่คลังเตรียมไว้ (สถานะ 'เตรียมแล้ว') และกดสแกนจ่ายออกเข้าเครื่อง"
                      : "Select machine to view staged Pick Lists and scan to issue coils"}
                  </p>
                </div>
              </div>

              {/* Machine Category Filter Buttons */}
              <div className="flex flex-wrap gap-1.5">
                {COIL_MACHINE_CATEGORIES.map((cat) => {
                  const isActive = activeMachineCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setActiveMachineCategory(cat.id);
                        if (!cat.machines.includes(selectedMachineId)) {
                          setSelectedMachineId(cat.machines[0]);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        isActive
                          ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                          : "bg-slate-50 dark:bg-[#0c1930] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Machine Cards Grid (CL01-CL06, SM01-SM04) */}
            <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-1.5">
              {(
                COIL_MACHINE_CATEGORIES.find((c) => c.id === activeMachineCategory)?.machines ||
                SLITTING_MACHINES
              ).map((mId) => {
                const isSelected = selectedMachineId === mId;
                const mOrders = stagingOrders.filter((o) => o.machineId === mId);
                const readyCount = mOrders.reduce(
                  (acc, o) => acc + o.items.filter((i) => i.status === "staged").length,
                  0
                );
                const issuedCount = mOrders.reduce(
                  (acc, o) => acc + o.items.filter((i) => i.status === "issued").length,
                  0
                );
                const totalCount = mOrders.reduce((acc, o) => acc + o.items.length, 0);

                return (
                  <button
                    key={mId}
                    type="button"
                    onClick={() => setSelectedMachineId(mId)}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer relative ${
                      isSelected
                        ? "bg-indigo-600/15 dark:bg-indigo-500/20 border-indigo-500 ring-2 ring-indigo-500/30"
                        : "bg-slate-50/70 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] hover:border-indigo-400"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-extrabold font-mono ${
                          isSelected
                            ? "text-indigo-600 dark:text-indigo-300"
                            : "text-slate-800 dark:text-slate-100"
                        }`}
                      >
                        {mId}
                      </span>
                      {readyCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[9.5px] font-extrabold">
                          {readyCount}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                      {totalCount > 0
                        ? `${issuedCount}/${totalCount} ${isThai ? "จ่ายแล้ว" : "Issued"}`
                        : isThai
                        ? "ไม่มี Order"
                        : "No Order"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operator Scan to Issue & Machine Orders Table */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-extrabold flex items-center justify-center">
                  2
                </span>
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  {isThai
                    ? `รายการใบสั่งเบิกที่เตรียมไว้สำหรับเครื่อง:`
                    : `Staged Pick Lists for Machine:`}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-600 dark:text-indigo-300 font-mono font-extrabold text-xs">
                  {selectedMachineId}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  ({machineFilteredOrders.length} {isThai ? "ใบสั่งเบิก" : "Orders"})
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setOperatorBarcodeInput("");
                  setOperatorScanStatus({
                    type: "idle",
                    message: isThai
                      ? `พร้อมสแกนบาร์โค้ด Batch (10 หลัก) เพื่อจ่ายออกเข้าเครื่อง ${selectedMachineId}`
                      : `Ready to scan 10-digit Batch for ${selectedMachineId}`,
                  });
                  setIsOperatorCameraActive(true);
                  setIsOperatorScannerOpen(true);
                }}
                disabled={machineFilteredOrders.length === 0}
                className={`px-3.5 py-2 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all ${
                  machineFilteredOrders.length > 0
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs cursor-pointer"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                }`}
              >
                <ScanLine size={15} />
                <span>
                  {isThai
                    ? `สแกนจ่ายเข้าเครื่อง ${selectedMachineId}`
                    : `Scan Issue to ${selectedMachineId}`}
                </span>
              </button>
            </div>

            {(() => {
              const visibleOperatorOrders = machineFilteredOrders.filter(
                (ord) =>
                  !ord.operatorDismissed && !dismissedOperatorOrders.includes(ord.orderNo)
              );

              if (machineFilteredOrders.length === 0) {
                return (
                  <div className="py-10 text-center space-y-1.5">
                    <Cpu size={28} className="mx-auto text-slate-400 opacity-50" />
                    <div className="text-xs font-bold text-slate-500 dark:text-slate-300">
                      {isThai
                        ? `ยังไม่มีใบสั่งเบิกที่เตรียมไว้สำหรับเครื่องจักร ${selectedMachineId}`
                        : `No Pick List orders prepared for Machine ${selectedMachineId}`}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {isThai
                        ? "กรุณาให้เจ้าหน้าที่คลังเพิ่มใบสั่งเบิกและสแกนเตรียมเบิกในเมนู '-เตรียมเบิก' ก่อน"
                        : "Please prepare a Pick List order in '-Outbound' first."}
                    </div>
                  </div>
                );
              }

              if (visibleOperatorOrders.length === 0) {
                return (
                  <div className="py-8 text-center space-y-2">
                    <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
                    <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {isThai
                        ? `ใบสั่งเบิกของเครื่อง ${selectedMachineId} ถูกจ่ายออกครบและซ่อนไว้แล้ว`
                        : `All completed orders for ${selectedMachineId} are hidden`}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDismissedOperatorOrders([])}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      {isThai ? "แสดงใบสั่งเบิกทั้งหมดอีกครั้ง" : "Show All Orders"}
                    </button>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {visibleOperatorOrders.map((ord) => {
                    const readyToReceiveCount = ord.items.filter(
                      (i) => i.status === "staged"
                    ).length;
                    const issuedCount = ord.items.filter(
                      (i) => i.status === "issued"
                    ).length;
                    const pendingPrepCount = ord.items.filter(
                      (i) => i.status === "pending"
                    ).length;
                    const isAllIssued =
                      ord.items.length > 0 && issuedCount === ord.items.length;
                    const isExpanded = expandedOrderNos.includes(ord.orderNo);

                    return (
                      <div
                        key={ord.orderNo}
                        className="rounded-xl border border-slate-200 dark:border-[#1e3a5f] overflow-hidden"
                      >
                        <div
                          onClick={() => toggleOrderExpand(ord.orderNo)}
                          className="px-3.5 py-2.5 bg-slate-100/80 dark:bg-[#0c1930] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-slate-200/60 dark:hover:bg-[#132647] transition-colors"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleOrderExpand(ord.orderNo);
                              }}
                              className="w-6 h-6 rounded-md bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                              Order:
                            </span>
                            <span className="font-mono font-extrabold text-xs text-indigo-600 dark:text-indigo-300">
                              {ord.orderNo}
                            </span>
                            {ord.isTemporary && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-300 text-[10px] font-extrabold">
                                {isThai ? "เบิกฉุกเฉิน (TEMP)" : "TEMP"}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[10.5px] font-bold">
                              Machine: {ord.machineId}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              ({ord.createdDate} {ord.createdAt})
                            </span>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {pendingPrepCount > 0 && (
                              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-slate-500/15 text-slate-500 dark:text-slate-400">
                                {isThai
                                  ? `คลังยังไม่ได้เตรียม: ${pendingPrepCount}`
                                  : `Unprepared: ${pendingPrepCount}`}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400">
                              {isThai
                                ? `เตรียมแล้ว (รอสแกนจ่าย): ${readyToReceiveCount}`
                                : `Ready to Issue: ${readyToReceiveCount}`}
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-extrabold ${
                                isAllIssued
                                  ? "bg-emerald-500/20 text-emerald-500"
                                  : "bg-indigo-500/20 text-indigo-500"
                              }`}
                            >
                              {isThai
                                ? `จ่ายแล้ว ${issuedCount} / ${ord.items.length} รายการ`
                                : `Issued ${issuedCount} / ${ord.items.length}`}
                            </span>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrderNo(ord.orderNo);
                                setOperatorBarcodeInput("");
                                setOperatorScanStatus({
                                  type: "idle",
                                  message: isThai
                                    ? `พร้อมสแกนบาร์โค้ด Batch จ่ายออก Order ${ord.orderNo} เข้าเครื่อง ${selectedMachineId}`
                                    : `Ready to scan Batch for Order ${ord.orderNo}`,
                                });
                                setIsOperatorCameraActive(true);
                                setIsOperatorScannerOpen(true);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ScanLine size={12} />
                              <span>{isThai ? "สแกนจ่าย" : "Scan Issue"}</span>
                            </button>

                            {isAllIssued && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDismissCompletedOrder(ord);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <CheckCircle2 size={12} />
                                <span>{isThai ? "เสร็จสิ้น (ซ่อนใบเบิก)" : "Complete"}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded &&
                          (() => {
                            const totalItems = ord.items.length;
                            const totalPages = Math.max(
                              1,
                              Math.ceil(totalItems / operatorItemPageSize)
                            );
                            const currentPage = Math.min(
                              operatorItemPages[ord.orderNo] || 1,
                              totalPages
                            );
                            const pagedItems = ord.items.slice(
                              (currentPage - 1) * operatorItemPageSize,
                              currentPage * operatorItemPageSize
                            );

                            return (
                              <>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr>
                                        <th>Order</th>
                                        <th>Item</th>
                                        <th>Material</th>
                                        <th>Material Description</th>
                                        <th>Req. Qty</th>
                                        <th>Unit</th>
                                        <th>Batch (10 หลัก)</th>
                                        <th>Location</th>
                                        <th>Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pagedItems.map((item, idx) => {
                                        const stockMatch = coilStock.find(
                                          (s) =>
                                            s.batch.toUpperCase() === item.batch.toUpperCase()
                                        );
                                        const locText =
                                          stockMatch?.location && stockMatch.location !== "-"
                                            ? stockMatch.location
                                            : item.sourceLocation || "-";
                                        return (
                                          <tr
                                            key={`${ord.orderNo}-${item.batch}-${idx}`}
                                            className={
                                              item.status === "issued"
                                                ? "bg-indigo-500/10 dark:bg-indigo-950/30"
                                                : item.status === "staged"
                                                ? "bg-amber-500/5 dark:bg-amber-950/15"
                                                : ""
                                            }
                                          >
                                            <td className="font-mono font-bold">{ord.orderNo}</td>
                                            <td className="font-mono">
                                              {item.bomItem ||
                                                String((idx + 1) * 10).padStart(4, "0")}
                                            </td>
                                            <td className="font-mono text-sky-600 dark:text-sky-400">
                                              {item.material || stockMatch?.materialNo || "-"}
                                            </td>
                                            <td className="max-w-[240px] truncate">
                                              {item.description ||
                                                `${item.grade} (${item.thickness}x${item.width})`}
                                            </td>
                                            <td className="font-mono font-bold text-right">
                                              {Number(item.weightKg || 0).toLocaleString()}
                                            </td>
                                            <td className="font-mono">{item.unit || "KG"}</td>
                                            <td>
                                              <span className="code font-mono font-extrabold text-indigo-600 dark:text-indigo-300">
                                                {item.batch}
                                              </span>
                                            </td>
                                            <td className="font-mono font-bold text-sky-500">
                                              {locText}
                                            </td>
                                            <td>
                                              {item.status === "issued" ? (
                                                <span className="px-2 py-0.5 rounded text-[10.5px] font-extrabold bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1">
                                                  <CheckCircle2 size={11} />
                                                  {isThai ? "จ่ายแล้ว" : "Issued"}
                                                </span>
                                              ) : item.status === "staged" ? (
                                                <span className="px-2 py-0.5 rounded text-[10.5px] font-extrabold bg-amber-500/20 text-amber-600 dark:text-amber-400">
                                                  {isThai
                                                    ? "เตรียมแล้ว (รอสแกนจ่าย)"
                                                    : "Staged (Ready)"}
                                                </span>
                                              ) : (
                                                <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-slate-500/15 text-slate-500 dark:text-slate-400">
                                                  {isThai
                                                    ? "รอคลังเตรียมเบิก"
                                                    : "Waiting Prep"}
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {totalItems > operatorItemPageSize && (
                                  <div className="px-3.5 py-2 border-t border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between text-[11px] text-slate-500">
                                    <span>
                                      {isThai
                                        ? `หน้า ${currentPage} / ${totalPages} (ทั้งหมด ${totalItems} รายการ)`
                                        : `Page ${currentPage} / ${totalPages}`}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={currentPage <= 1}
                                        onClick={() =>
                                          setOperatorItemPages((p) => ({
                                            ...p,
                                            [ord.orderNo]: Math.max(1, currentPage - 1),
                                          }))
                                        }
                                        className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 cursor-pointer"
                                      >
                                        <ChevronLeft size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={currentPage >= totalPages}
                                        onClick={() =>
                                          setOperatorItemPages((p) => ({
                                            ...p,
                                            [ord.orderNo]: Math.min(totalPages, currentPage + 1),
                                          }))
                                        }
                                        className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 cursor-pointer"
                                      >
                                        <ChevronRight size={13} />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Issue History Table */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1e3a5f]">
              <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                {isThai ? "ประวัติการตัดจ่ายออกเหล็กม้วนล่าสุด" : "Recent Coil Issue History"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>{isThai ? "เวลาจ่ายออก" : "Issued At"}</th>
                    <th>Batch</th>
                    <th>{isThai ? "เครื่องจักร" : "Machine"}</th>
                    <th>{isThai ? "เลขที่ใบเบิก" : "Order No."}</th>
                    <th>{isThai ? "น้ำหนักที่จ่าย (kg)" : "Issued Weight"}</th>
                    <th>{isThai ? "หมายเหตุ" : "Remark"}</th>
                  </tr>
                </thead>
                <tbody>
                  {coilTransactions
                    .filter((tx) => tx.txType === "issue")
                    .slice(0, 25)
                    .map((tx) => (
                      <tr key={tx.id}>
                        <td className="font-mono text-[11px]">{tx.timestamp}</td>
                        <td>
                          <span className="code font-mono font-bold">{tx.batch}</span>
                        </td>
                        <td className="font-bold text-blue-400">{tx.machineId || "-"}</td>
                        <td className="font-mono">{tx.orderNo || "-"}</td>
                        <td className="font-mono font-bold text-emerald-400">
                          {Number(tx.weightKg).toLocaleString()} kg
                        </td>
                        <td className="text-[11px] text-slate-400">{tx.remark}</td>
                      </tr>
                    ))}
                  {coilTransactions.filter((tx) => tx.txType === "issue").length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-slate-400">
                        {isThai ? "ยังไม่มีประวัติการจ่ายออก" : "No issue transactions yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: - เตรียมเบิก (OUTBOUND STAGING / PICKLIST PREP)
         ===================================================================== */}
      {activeMode === "outbound" && (
        <div className="space-y-3">
          {/* Step 1: Machine Selection & Officer Import / Emergency TEMP Actions */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs font-extrabold flex items-center justify-center">
                  1
                </span>
                <div>
                  <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                    {isThai
                      ? "เลือกเครื่องจักรที่จะนำใบสั่งเบิกไปใช้ (Target Machine Selection)"
                      : "Select Target Machine for Pick List"}
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 m-0">
                    {isThai
                      ? "เพิ่มใบสั่งเบิกจากตาราง SAP หรือเบิกฉุกเฉิน (TEMP) แล้วสแกนบาร์โค้ด Batch เพื่อเปลี่ยนสถานะเป็น 'เตรียมแล้ว'"
                      : "Import SAP Pick List or Emergency TEMP staging, then scan Batches to mark as Staged"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Machine Category Filter Buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {COIL_MACHINE_CATEGORIES.map((cat) => {
                    const isActive = activeMachineCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setActiveMachineCategory(cat.id);
                          if (!cat.machines.includes(selectedMachineId)) {
                            setSelectedMachineId(cat.machines[0]);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                          isActive
                            ? "bg-blue-600 text-white border-blue-500 shadow-xs"
                            : "bg-slate-50 dark:bg-[#0c1930] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>

                {/* Emergency Pre-Staging Button (เบิกฉุกเฉินก่อนมี Order) */}
                <button
                  type="button"
                  onClick={handleOpenEmergencyModal}
                  className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-amber-600 hover:bg-amber-500 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                  title={
                    isThai
                      ? "เตรียมเบิกฉุกเฉินก่อนได้รับเลข Order จากวางแผน (ระบบจะจับคู่ให้อัตโนมัติเมื่อนำเข้าใบสั่งเบิกภายหลัง)"
                      : "Emergency Pre-Staging before receiving SAP Order"
                  }
                >
                  <Zap size={14} />
                  <span>{isThai ? "เบิกฉุกเฉิน (TEMP)" : "Emergency (TEMP)"}</span>
                </button>

                {/* Officer Button: Import Pick List Table */}
                <button
                  type="button"
                  onClick={() => {
                    setImportMachineId(selectedMachineId);
                    setImportOrderNo("");
                    setRawTableText("");
                    setImportError("");
                    setIsImportModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <FileSpreadsheet size={14} />
                  <span>
                    {isThai
                      ? "+ เพิ่มใบสั่งเบิก (สำหรับเจ้าหน้าที่)"
                      : "+ Import Pick List (Officer)"}
                  </span>
                </button>
              </div>
            </div>

            {/* Machine Cards Grid (CL01-CL06, SM01-SM04) */}
            <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-1.5">
              {(
                COIL_MACHINE_CATEGORIES.find((c) => c.id === activeMachineCategory)?.machines ||
                SLITTING_MACHINES
              ).map((mId) => {
                const isSelected = selectedMachineId === mId;
                const mOrders = stagingOrders.filter((o) => o.machineId === mId);
                const pendingCount = mOrders.reduce(
                  (acc, o) => acc + o.items.filter((i) => i.status === "pending").length,
                  0
                );
                const stagedCount = mOrders.reduce(
                  (acc, o) =>
                    acc +
                    o.items.filter((i) => i.status === "staged" || i.status === "issued").length,
                  0
                );

                return (
                  <button
                    key={mId}
                    type="button"
                    onClick={() => setSelectedMachineId(mId)}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer relative ${
                      isSelected
                        ? "bg-blue-600/15 dark:bg-blue-500/20 border-blue-500 ring-2 ring-blue-500/30"
                        : "bg-slate-50/70 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] hover:border-blue-400"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-extrabold font-mono ${
                          isSelected
                            ? "text-blue-600 dark:text-blue-300"
                            : "text-slate-800 dark:text-slate-100"
                        }`}
                      >
                        {mId}
                      </span>
                      {mOrders.length > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-500 dark:text-blue-300 text-[9.5px] font-extrabold">
                          {mOrders.length} {isThai ? "ใบ" : "Ord"}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                      {mOrders.length > 0
                        ? `${stagedCount}/${stagedCount + pendingCount} ${
                            isThai ? "เตรียมแล้ว" : "Staged"
                          }`
                        : isThai
                        ? "ว่าง"
                        : "Empty"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Order Selection & Pick List Table for Selected Machine */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs font-extrabold flex items-center justify-center">
                  2
                </span>
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  {isThai ? "รายการใบสั่งเบิก (Pick List) ของเครื่อง:" : "Pick List Orders for Machine:"}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-500 dark:text-blue-300 font-mono font-extrabold text-xs">
                  {selectedMachineId}
                </span>
              </div>

              {/* Order Tabs & Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {machineFilteredOrders.map((ord) => {
                  const isOrdSelected = activeOrder?.orderNo === ord.orderNo;
                  const doneCount = ord.items.filter(
                    (i) => i.status === "staged" || i.status === "issued"
                  ).length;
                  return (
                    <button
                      key={ord.orderNo}
                      type="button"
                      onClick={() => setSelectedOrderNo(ord.orderNo)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                        isOrdSelected
                          ? ord.isTemporary
                            ? "bg-amber-600 text-white border-amber-500 shadow-xs"
                            : "bg-blue-600 text-white border-blue-500 shadow-xs"
                          : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                      }`}
                    >
                      {ord.isTemporary && <Zap size={12} />}
                      <span>Order: {ord.orderNo}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] ${
                          isOrdSelected
                            ? "bg-white/20 text-white"
                            : "bg-slate-200 dark:bg-slate-800 text-slate-500"
                        }`}
                      >
                        {doneCount}/{ord.items.length}
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setOutboundBarcodeInput("");
                    setOutboundScanStatus({
                      type: "idle",
                      message: isThai
                        ? "พร้อมสแกนบาร์โค้ด Batch (10 หลัก) เพื่อยืนยันการเตรียมเบิก"
                        : "Ready to scan 10-digit Batch barcode",
                    });
                    setIsOutboundCameraActive(true);
                    setIsOutboundScannerOpen(true);
                  }}
                  disabled={!activeOrder}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all ${
                    activeOrder
                      ? "bg-blue-600 hover:bg-blue-500 text-white shadow-xs cursor-pointer"
                      : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  <ScanLine size={15} />
                  <span>{isThai ? "สแกนบาร์โค้ด" : "Scan Barcode"}</span>
                </button>
              </div>
            </div>

            {/* Active Pick List Table */}
            {!activeOrder ? (
              <div className="py-10 text-center space-y-2">
                <ClipboardList size={28} className="mx-auto text-slate-400 opacity-50" />
                <div className="text-xs font-bold text-slate-500 dark:text-slate-300">
                  {isThai
                    ? `ยังไม่มีใบสั่งเบิกสำหรับเครื่องจักร ${selectedMachineId}`
                    : `No Pick List Order for Machine ${selectedMachineId}`}
                </div>
                <div className="text-[11px] text-slate-400">
                  {isThai
                    ? "กดปุ่ม '+ เพิ่มใบสั่งเบิก (สำหรับเจ้าหน้าที่)' เพื่อวางตาราง SAP หรือกด 'เบิกฉุกเฉิน (TEMP)' ด้านบน"
                    : "Click '+ Import Pick List (Officer)' or 'Emergency (TEMP)' above to start."}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Summary Header of Active Order */}
                {(() => {
                  const isOrderExpanded = expandedOrderNos.includes(activeOrder.orderNo);
                  const doneCount = activeOrder.items.filter(
                    (i) => i.status === "staged" || i.status === "issued"
                  ).length;
                  return (
                    <div
                      onClick={() => toggleOrderExpand(activeOrder.orderNo)}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200/80 dark:border-[#1e3a5f] text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-[#132647] transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleOrderExpand(activeOrder.orderNo);
                          }}
                          className="w-6 h-6 rounded-md bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          {isOrderExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span>
                          <strong className="text-slate-500 dark:text-slate-400">Order:</strong>{" "}
                          <span className="font-mono font-extrabold text-blue-600 dark:text-blue-300">
                            {activeOrder.orderNo}
                          </span>
                        </span>
                        {activeOrder.isTemporary && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-300 text-[10.5px] font-extrabold flex items-center gap-1">
                            <Zap size={11} />
                            <span>
                              {isThai
                                ? "ใบเบิกฉุกเฉิน (รอจับคู่ Order จริง)"
                                : "TEMP Emergency Order"}
                            </span>
                          </span>
                        )}
                        {activeOrder.matchedOrderNo && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-[10.5px] font-bold">
                            Matched: {activeOrder.matchedOrderNo}
                          </span>
                        )}
                        <span>
                          <strong className="text-slate-500 dark:text-slate-400">Machine:</strong>{" "}
                          <span className="font-extrabold text-amber-500">
                            {activeOrder.machineId}
                          </span>
                        </span>
                        <span className="text-slate-400 text-[11px]">
                          {isThai ? "สร้างเมื่อ:" : "Created:"} {activeOrder.createdDate}{" "}
                          {activeOrder.createdAt}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {activeOrder.isTemporary && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleManualMatchTempOrder(activeOrder.orderNo);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-700 dark:text-amber-300 font-extrabold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <CheckCircle2 size={12} />
                            <span>
                              {isThai ? "ผูกเลข Order จริง" : "Match Real Order"}
                            </span>
                          </button>
                        )}
                        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                          {isThai ? "ความคืบหน้าการเตรียมเบิก:" : "Progress:"}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-500/20 text-emerald-500">
                          {doneCount} / {activeOrder.items.length}{" "}
                          {isThai ? "รายการ" : "Items"}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteModalOrderNo(activeOrder.orderNo);
                          }}
                          className="px-2 py-1 rounded-lg text-[11px] font-bold border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 flex items-center gap-1 cursor-pointer transition-all"
                        >
                          <Trash2 size={12} />
                          <span>{isThai ? "ลบใบสั่งเบิก" : "Delete"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Collapsible Table Body */}
                {expandedOrderNos.includes(activeOrder.orderNo) &&
                  (() => {
                    const totalItems = activeOrder.items.length;
                    const totalPages = Math.max(
                      1,
                      Math.ceil(totalItems / pickListItemPageSize)
                    );
                    const currentPage = Math.min(
                      pickListItemPages[activeOrder.orderNo] || 1,
                      totalPages
                    );
                    const pagedItems = activeOrder.items.slice(
                      (currentPage - 1) * pickListItemPageSize,
                      currentPage * pickListItemPageSize
                    );

                    return (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr>
                                <th>Order</th>
                                <th>Item</th>
                                <th>Material</th>
                                <th>Material Description</th>
                                <th>Requirement Qty</th>
                                <th>Unit</th>
                                <th>Batch (10 หลัก)</th>
                                <th>Location</th>
                                <th>SLoc</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedItems.map((item, idx) => {
                                const stockMatch = coilStock.find(
                                  (s) => s.batch.toUpperCase() === item.batch.toUpperCase()
                                );
                                const locText =
                                  stockMatch?.location && stockMatch.location !== "-"
                                    ? stockMatch.location
                                    : item.sourceLocation || "-";
                                return (
                                  <tr
                                    key={`${activeOrder.orderNo}-${item.batch}-${idx}`}
                                    className={
                                      item.status === "staged"
                                        ? "bg-emerald-500/5 dark:bg-emerald-950/20"
                                        : item.status === "issued"
                                        ? "bg-indigo-500/5 dark:bg-indigo-950/20"
                                        : ""
                                    }
                                  >
                                    <td className="font-mono font-bold">
                                      {activeOrder.orderNo}
                                    </td>
                                    <td className="font-mono">
                                      {item.bomItem ||
                                        String((idx + 1) * 10).padStart(4, "0")}
                                    </td>
                                    <td className="font-mono text-sky-600 dark:text-sky-400">
                                      {item.material || stockMatch?.materialNo || "-"}
                                    </td>
                                    <td className="max-w-[240px] truncate">
                                      {item.description ||
                                        `${item.grade} (${item.thickness}x${item.width})`}
                                    </td>
                                    <td className="font-mono font-bold text-right">
                                      {Number(item.weightKg || 0).toLocaleString()}
                                    </td>
                                    <td className="font-mono">{item.unit || "KG"}</td>
                                    <td>
                                      <div className="flex items-center gap-1.5">
                                        <span className="code font-mono font-extrabold text-blue-600 dark:text-blue-300">
                                          {item.batch}
                                        </span>
                                        {item.tempOrderRef && (
                                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-600 dark:text-amber-300 text-[9.5px] font-bold">
                                            Auto-Matched
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="font-mono font-bold text-sky-500">
                                      {locText}
                                    </td>
                                    <td className="font-mono">
                                      {item.storageLocation || "1101"}
                                    </td>
                                    <td>
                                      {item.status === "issued" ? (
                                        <span className="px-2 py-0.5 rounded text-[10.5px] font-extrabold bg-indigo-500/20 text-indigo-500 inline-flex items-center gap-1">
                                          <CheckCircle2 size={11} />
                                          {isThai ? "จ่ายแล้ว" : "Issued"}
                                        </span>
                                      ) : item.status === "staged" ? (
                                        <span className="px-2 py-0.5 rounded text-[10.5px] font-extrabold bg-emerald-500/20 text-emerald-500 inline-flex items-center gap-1">
                                          <CheckCircle2 size={11} />
                                          {isThai ? "เตรียมแล้ว" : "Staged"}
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-amber-500/20 text-amber-500">
                                          {isThai ? "รอเตรียม" : "Pending"}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination Bar */}
                        {totalItems > pickListItemPageSize && (
                          <div className="px-3 py-2 border-t border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <div className="flex items-center gap-1.5">
                              <span>{isThai ? "แสดงต่อหน้า:" : "Rows:"}</span>
                              <select
                                value={pickListItemPageSize}
                                onChange={(e) => {
                                  setPickListItemPageSize(Number(e.target.value));
                                  setPickListItemPages((p) => ({
                                    ...p,
                                    [activeOrder.orderNo]: 1,
                                  }));
                                }}
                                className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-xs"
                              >
                                {[10, 20, 50, 100].map((sz) => (
                                  <option key={sz} value={sz}>
                                    {sz}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={currentPage <= 1}
                                onClick={() =>
                                  setPickListItemPages((p) => ({
                                    ...p,
                                    [activeOrder.orderNo]: 1,
                                  }))
                                }
                                className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 cursor-pointer"
                              >
                                <ChevronsLeft size={13} />
                              </button>
                              <button
                                type="button"
                                disabled={currentPage <= 1}
                                onClick={() =>
                                  setPickListItemPages((p) => ({
                                    ...p,
                                    [activeOrder.orderNo]: Math.max(1, currentPage - 1),
                                  }))
                                }
                                className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 cursor-pointer"
                              >
                                <ChevronLeft size={13} />
                              </button>
                              <span className="px-2 font-bold">
                                {currentPage} / {totalPages}
                              </span>
                              <button
                                type="button"
                                disabled={currentPage >= totalPages}
                                onClick={() =>
                                  setPickListItemPages((p) => ({
                                    ...p,
                                    [activeOrder.orderNo]: Math.min(
                                      totalPages,
                                      currentPage + 1
                                    ),
                                  }))
                                }
                                className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 cursor-pointer"
                              >
                                <ChevronRight size={13} />
                              </button>
                              <button
                                type="button"
                                disabled={currentPage >= totalPages}
                                onClick={() =>
                                  setPickListItemPages((p) => ({
                                    ...p,
                                    [activeOrder.orderNo]: totalPages,
                                  }))
                                }
                                className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 cursor-pointer"
                              >
                                <ChevronsRight size={13} />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Action Bar: Save Draft vs Confirm Outbound Preparation */}
                        <div className="mt-2 pt-3 border-t border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {isThai
                              ? "สามารถกด 'บันทึกใบสั่งเบิก (พักไว้สแกนต่อ)' เพื่อกลับมาสแกนต่อภายหลัง หรือกด 'ยืนยันการเตรียมเบิก' เมื่อเตรียมเสร็จสิ้น"
                              : "Save draft to continue scanning later, or confirm outbound preparation when finished."}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleSaveOutboundDraft(activeOrder.orderNo)}
                              className="px-3.5 py-2 rounded-lg text-xs font-extrabold bg-slate-100 hover:bg-slate-200 dark:bg-[#0c1930] dark:hover:bg-[#162a4a] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#1e3a5f] flex items-center gap-1.5 cursor-pointer transition-all"
                            >
                              <Save size={14} className="text-blue-500" />
                              <span>
                                {isThai
                                  ? "บันทึกใบสั่งเบิก (พักไว้สแกนต่อ)"
                                  : "Save Pick List (Resume Later)"}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirmOutboundFinal(activeOrder.orderNo)}
                              className="px-4 py-2 rounded-lg text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                            >
                              <CheckCircle2 size={14} />
                              <span>
                                {isThai
                                  ? "ยืนยันการเตรียมเบิก"
                                  : "Confirm Outbound Preparation"}
                              </span>
                            </button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 4: ย้าย LAYOUT (RELOCATE COIL LAYOUT & BAY CAPACITY)
         ===================================================================== */}
      {activeMode === "relocate_layout" && (
        <div className="space-y-3">
          {/* Bay Capacity Overview Grid (from coil_layouts) — hidden per user request */}
          {false && (
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-purple-500" />
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  {isThai
                    ? "ผังพื้นที่จัดเก็บเหล็กม้วน (Coil Layout Bays - คลิกเพื่อเลือกเป็นปลายทางย้าย)"
                    : "Coil Storage Layout Bays (Click to select destination)"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsAddZoneModalOpen(!isAddZoneModalOpen)}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 cursor-pointer flex items-center gap-1"
              >
                <Plus size={13} />
                <span>{isThai ? "เพิ่มโซน Layout ใหม่" : "Add Layout Zone"}</span>
              </button>
            </div>

            {isAddZoneModalOpen && (
              <form
                onSubmit={handleAddNewLayoutZone}
                className="p-3 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-purple-400/40 grid grid-cols-1 sm:grid-cols-4 gap-2"
              >
                <input
                  type="text"
                  value={newZoneCode}
                  onChange={(e) => setNewZoneCode(e.target.value)}
                  placeholder="รหัส Bay เช่น CL1-C01"
                  required
                  className="px-2.5 py-1.5 rounded text-xs font-mono border border-slate-300 dark:border-[#1e3a5f]"
                />
                <input
                  type="text"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="ชื่อโซน เช่น Bay CL1 โซน C1"
                  className="px-2.5 py-1.5 rounded text-xs border border-slate-300 dark:border-[#1e3a5f]"
                />
                <input
                  type="number"
                  value={newZoneCapTons}
                  onChange={(e) => setNewZoneCapTons(e.target.value)}
                  placeholder="ความจุ (ตัน)"
                  className="px-2.5 py-1.5 rounded text-xs font-mono border border-slate-300 dark:border-[#1e3a5f]"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-purple-600 text-white text-xs font-bold cursor-pointer"
                >
                  {isThai ? "บันทึกโซนใหม่" : "Save Zone"}
                </button>
              </form>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {bayUtilizationList.map((b) => {
                const isSelectedTarget =
                  relocateTargetLocation.toUpperCase() === b.bayCode.toUpperCase();
                return (
                  <div
                    key={b.id}
                    onClick={() => setRelocateTargetLocation(b.bayCode)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isSelectedTarget
                        ? "border-purple-500 bg-purple-500/10 shadow-sm"
                        : "border-slate-200 dark:border-[#1e3a5f] bg-slate-50/50 dark:bg-[#0c1930]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-extrabold text-xs text-purple-400">
                        {b.bayCode}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">
                        {b.coilCount} {isThai ? "ม้วน" : "coils"}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {b.zoneName}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono">
                      <span>
                        {b.weightTons} / {b.maxCapacityTons} T
                      </span>
                      <span className="font-bold text-sky-400">{b.percent}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Scan & Select Coils to Relocate */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <form onSubmit={(e) => handleRelocateScanAdd(e)} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  {isThai ? "1. สแกนบาร์โค้ดม้วนเหล็กที่ต้องการย้าย" : "1. Scan Coil Barcode"}
                </label>
                <input
                  type="text"
                  value={relocateScanInput}
                  onChange={(e) => setRelocateScanInput(e.target.value)}
                  placeholder={isThai ? "สแกนรหัส Batch เพื่อเพิ่มเข้าคิวย้าย..." : "Scan Batch..."}
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono font-bold border border-purple-400 dark:border-purple-700 bg-white dark:bg-[#0c1930]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  {isThai ? "2. เลือกหรือพิมพ์ Layout ปลายทาง" : "2. Target Layout Bay"}
                </label>
                <input
                  type="text"
                  value={relocateTargetLocation}
                  onChange={(e) => setRelocateTargetLocation(e.target.value.toUpperCase())}
                  className={`w-full px-3 py-2 rounded-lg text-xs font-mono font-bold border bg-white dark:bg-[#0c1930] ${
                    relocatePlacementValidation && !relocatePlacementValidation.valid
                      ? "border-red-500 text-red-600 dark:text-red-400"
                      : "border-slate-300 dark:border-[#1e3a5f]"
                  }`}
                />
                {relocatePlacementValidation && !relocatePlacementValidation.valid && (
                  <p className="mt-1 text-[10.5px] font-bold text-red-600 dark:text-red-400 flex items-start gap-1">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>
                      {isThai
                        ? relocatePlacementValidation.reasonTh
                        : relocatePlacementValidation.reasonEn}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleConfirmRelocate}
                  className="w-full py-2 px-4 rounded-lg text-xs font-extrabold bg-purple-600 hover:bg-purple-500 text-white cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <ArrowRightLeft size={14} />
                  <span>
                    {isThai
                      ? `ยืนยันย้าย Layout (${selectedRelocateBatches.length} ม้วน -> ${relocateTargetLocation})`
                      : `Confirm Relocate (${selectedRelocateBatches.length})`}
                  </span>
                </button>
              </div>
            </form>

            {/* Selectable Stock Coils for Relocation */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="w-10 text-center">เลือก</th>
                    <th>Batch / Barcode</th>
                    <th>{isThai ? "เกรด & ขนาด" : "Spec"}</th>
                    <th>{isThai ? "น้ำหนัก (kg)" : "Weight"}</th>
                    <th>{isThai ? "Layout ปัจจุบัน" : "Current Layout"}</th>
                    <th>{isThai ? "Layout เดิม" : "Previous Layout"}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStockCoils.slice(0, 30).map((c) => {
                    const isSelected = selectedRelocateBatches.includes(c.batch);
                    return (
                      <tr
                        key={c.id}
                        onClick={() =>
                          setSelectedRelocateBatches((prev) =>
                            isSelected ? prev.filter((b) => b !== c.batch) : [...prev, c.batch]
                          )
                        }
                      >
                        <td className="text-center">
                          <input type="checkbox" checked={isSelected} readOnly />
                        </td>
                        <td>
                          <span className="code font-mono font-bold">{c.batch}</span>
                        </td>
                        <td>
                          <span className="font-bold">{c.grade}</span> • {c.certThickness} x {c.width} mm
                        </td>
                        <td className="font-mono font-bold">
                          {Number(c.weightKg).toLocaleString()} kg
                        </td>
                        <td>
                          <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 font-mono font-bold">
                            {c.location}
                          </span>
                        </td>
                        <td className="font-mono text-slate-400">{c.previousLocation || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 5: สต๊อก (COIL STOCK BALANCE & INVENTORY OVERVIEW)
         ===================================================================== */}
      {activeMode === "stock_balance" && (
        <div className="space-y-3">
          {/* 4 KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] border-t-3 border-t-cyan-500 rounded-xl p-3">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {isThai ? "สต๊อกเหล็กม้วนคงเหลือรวม" : "Total Active Coils"}
              </div>
              <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                {activeStockCoils.length.toLocaleString()}{" "}
                <span className="text-xs font-semibold text-slate-400">
                  {isThai ? "ม้วน" : "Coils"}
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] border-t-3 border-t-emerald-500 rounded-xl p-3">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {isThai ? "น้ำหนักสต๊อกรวม (ตัน / kg)" : "Total Stock Weight"}
              </div>
              <div className="text-xl font-black text-emerald-500 mt-1">
                {totalActiveTons.toLocaleString()}{" "}
                <span className="text-xs font-semibold text-slate-400">
                  TON ({totalActiveWeightKg.toLocaleString()} kg)
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] border-t-3 border-t-sky-500 rounded-xl p-3">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {isThai ? "พร้อมเบิกใช้งาน (Available)" : "Available Ready"}
              </div>
              <div className="text-xl font-black text-sky-400 mt-1">
                {availableCoils.length.toLocaleString()}{" "}
                <span className="text-xs font-semibold text-slate-400">
                  {isThai ? "ม้วน" : "Coils"}
                </span>
              </div>
            </div>

            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] border-t-3 border-t-amber-500 rounded-xl p-3">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {isThai ? "เตรียมเบิกรอจ่าย (Staged)" : "Staged for Machine"}
              </div>
              <div className="text-xl font-black text-amber-400 mt-1">
                {stagedCoils.length.toLocaleString()}{" "}
                <span className="text-xs font-semibold text-slate-400">
                  {isThai ? "ม้วน" : "Coils"}
                </span>
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
            <div className="filterbar px-3 py-2.5 sm:px-[18px] sm:py-3 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder={
                    isThai
                      ? "ค้นหาด้วย Batch, Coil No., เกรด, ขนาด, ผู้ผลิต, Location..."
                      : "Search Batch, Coil No., Grade, Location..."
                  }
                  className="field w-full rounded-md font-normal border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-cyan-500"
                  style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <select
                value={stockStatusFilter}
                onChange={(e) =>
                  setStockStatusFilter(e.target.value as typeof stockStatusFilter)
                }
                className="field rounded-md font-normal border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 max-w-[230px]"
                style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
              >
                <option value="ACTIVE">{isThai ? "สต๊อกคงเหลือ (พร้อมใช้ + เตรียมเบิก)" : "Active Stock (Available + Staged)"}</option>
                <option value="available">{isThai ? "เฉพาะพร้อมใช้ (Available)" : "Available Only"}</option>
                <option value="staged">{isThai ? "เฉพาะเตรียมเบิก (Staged)" : "Staged Only"}</option>
                <option value="issued">{isThai ? "จ่ายออกแล้ว (Issued)" : "Issued"}</option>
                <option value="ALL">{isThai ? "ทั้งหมด (All Records)" : "All Records"}</option>
              </select>

              <select
                value={stockBayFilter}
                onChange={(e) => setStockBayFilter(e.target.value)}
                className="field rounded-md font-normal border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
              >
                <option value="ALL">{isThai ? "ทุก Layout Bay" : "All Layout Bays"}</option>
                {layoutZones.map((z) => (
                  <option key={z.id} value={z.bayCode}>
                    {z.bayCode}
                  </option>
                ))}
              </select>

              <select
                value={stockGradeFilter}
                onChange={(e) => setStockGradeFilter(e.target.value)}
                className="field rounded-md font-normal border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
              >
                <option value="ALL">{isThai ? "ทุกเกรดเหล็ก" : "All Grades"}</option>
                {COMMON_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  setIsSapModalOpen(true);
                  setTimeout(() => sapTextAreaRef.current?.focus(), 80);
                }}
                className="h-[35px] px-3 rounded-md text-xs font-extrabold bg-cyan-600 hover:bg-cyan-500 text-white inline-flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap"
                title={
                  isThai
                    ? "อัปโหลดไฟล์สต็อก SAP (Excel/CSV/TSV) เพื่อจับคู่ Batch และเติมข้อมูลสต๊อกอัตโนมัติ"
                    : "Upload SAP Stock (Excel/CSV/TSV) to match Batch and update stock fields"
                }
              >
                <Upload size={13} />
                <span>{isThai ? "อัปโหลดสต็อก SAP" : "Upload SAP Stock"}</span>
                {coilSapMap.size > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/25 text-white font-mono">
                    {coilSapMap.size.toLocaleString()}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportStockExcel}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet size={13} />
                <span>Export Excel</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>Batch / Barcode</th>
                    <th>Coil No.</th>
                    <th>{isThai ? "เกรด" : "Grade"}</th>
                    <th>{isThai ? "หนา x กว้าง (mm)" : "Spec (mm)"}</th>
                    <th>{isThai ? "ผู้ผลิต" : "Mill"}</th>
                    <th>{isThai ? "น้ำหนักคงเหลือ (kg)" : "Weight (kg)"}</th>
                    <th>Layout</th>
                    <th>{isThai ? "สถานะ" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStockRows.map((c) => {
                    const formattedThick = formatSapThickness(c.certThickness);
                    const formattedWidth = formatSapWidth(c.width);
                    const hasThick = formattedThick !== "-";
                    const hasWidth = formattedWidth !== "-";
                    const specDisplay =
                      hasThick && hasWidth
                        ? `${formattedThick} x ${formattedWidth}`
                        : hasThick
                        ? formattedThick
                        : hasWidth
                        ? formattedWidth
                        : "-";
                    const weightNum = Number(c.weightKg) || 0;
                    const layoutDisplay = c.location && c.location.trim() && c.location !== "-" ? c.location : "-";
                    return (
                      <tr key={c.id}>
                        <td>
                          <span className="code font-mono font-bold">{c.batch}</span>
                        </td>
                        <td className="font-mono">{c.coilNo || "-"}</td>
                        <td className="font-bold">{c.grade || "-"}</td>
                        <td className="font-mono">{specDisplay}</td>
                        <td>{c.manufacturer || "-"}</td>
                        <td className="font-mono font-bold">
                          {weightNum > 0 ? `${weightNum.toLocaleString()} kg` : "0"}
                        </td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded font-mono font-bold ${
                              layoutDisplay !== "-"
                                ? "bg-sky-500/20 text-sky-400"
                                : "bg-slate-500/15 text-slate-400"
                            }`}
                          >
                            {layoutDisplay}
                          </span>
                        </td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${
                            c.status === "available"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : c.status === "staged"
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-slate-500/20 text-slate-400"
                          }`}
                        >
                          {c.status === "available"
                            ? isThai
                              ? "พร้อมใช้"
                              : "Available"
                            : c.status === "staged"
                            ? isThai
                              ? `เตรียมเบิก (${c.stagedMachineId || ""})`
                              : "Staged"
                            : isThai
                            ? "จ่ายออกแล้ว"
                            : "Issued"}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                  {filteredStockRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400">
                        {isThai ? "ไม่พบรายการสต๊อกเหล็กม้วนที่ค้นหา" : "No matching coil stock records."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SAP Stock Upload & Import Modal */}
      {isSapModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm"
          onMouseDown={() => {
            if (!isSapProcessing) setIsSapModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-xl border ${
                    isSapProcessing
                      ? "bg-cyan-500/15 text-cyan-500 border-cyan-500/30"
                      : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20"
                  }`}
                >
                  <Database size={20} className={isSapProcessing ? "animate-pulse" : ""} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100 m-0">
                    {isThai
                      ? "นำเข้าสต๊อกเหล็กม้วนจากระบบ SAP (Upload SAP Stock)"
                      : "Import Coil Stock from SAP"}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 m-0 mt-0.5">
                    {isThai
                      ? "รองรับไฟล์ Excel (.xlsx, .xls), CSV/TSV จาก SAP หรือคลิกแล้วกด Ctrl+V เพื่อวางตารางข้อมูลทันที"
                      : "Supports Excel (.xlsx, .xls), CSV/TSV from SAP, or paste table data (Ctrl+V)"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSapProcessing}
                onClick={() => {
                  if (!isSapProcessing) setIsSapModalOpen(false);
                }}
                className={`p-1.5 rounded-lg transition-colors ${
                  isSapProcessing
                    ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                }`}
              >
                <X size={20} />
              </button>
            </div>

            {isSapProcessing ? (
              <div className="p-8 flex flex-col items-center justify-center text-center space-y-5">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Loader2 size={32} className="animate-spin" />
                </div>
                <div>
                  <h4 className="text-base font-extrabold text-slate-900 dark:text-slate-100 m-0">
                    {sapProgress >= 100
                      ? isThai
                        ? "นำเข้าและอัปเดตสต๊อก SAP สำเร็จ!"
                        : "SAP Stock Import Completed!"
                      : isThai
                      ? "กำลังประมวลผลและนำเข้าสต๊อก SAP..."
                      : "Processing & Syncing SAP Stock..."}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {sapCurrentStep === 1 && (isThai ? "ขั้นตอนที่ 1/4: ตรวจสอบโครงสร้างข้อมูล SAP..." : "Step 1/4: Validating SAP structure...")}
                    {sapCurrentStep === 2 && (isThai ? "ขั้นตอนที่ 2/4: แยกคอลัมน์ Batch, Spec, น้ำหนัก, SLoc..." : "Step 2/4: Parsing Batch, Spec, Weight, SLoc...")}
                    {sapCurrentStep === 3 && (isThai ? "ขั้นตอนที่ 3/4: บันทึกข้อมูล SAP Master ลง Cloud (coil_sap_chunks)..." : "Step 3/4: Saving SAP Master chunks...")}
                    {sapCurrentStep === 4 && (isThai ? "ขั้นตอนที่ 4/4: อัปเดตสต๊อกเหล็กม้วนคงเหลือ (coil_stock)..." : "Step 4/4: Updating coil_stock records...")}
                  </p>
                </div>

                <div className="w-full max-w-md space-y-1.5">
                  <div className="flex justify-between text-xs font-mono font-bold">
                    <span className="text-cyan-500">
                      {sapProcessedCount.toLocaleString()} / {sapTotalCount.toLocaleString()} {isThai ? "รายการ" : "items"}
                    </span>
                    <span className="text-slate-700 dark:text-slate-200">{sapProgress}%</span>
                  </div>
                  <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-[#0c1930] overflow-hidden border border-slate-300 dark:border-[#1e3a5f]">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${sapProgress}%` }}
                    />
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Clock size={13} className="text-cyan-400 animate-pulse" />
                  <span>{isThai ? "กำลังบันทึกลงฐานข้อมูล dbCoil กรุณารอสักครู่..." : "Syncing to dbCoil..."}</span>
                </div>
              </div>
            ) : (
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                <input
                  ref={sapFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt,.tab"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSapFileUpload(file);
                    e.target.value = "";
                  }}
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <FileSpreadsheet size={15} className="text-cyan-500" />
                    <span>
                      {isThai
                        ? "เลือกไฟล์จาก SAP หรือวางข้อมูลตารางด้านล่าง (Ctrl+V):"
                        : "Select SAP file or paste SAP table below (Ctrl+V):"}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => sapFileInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-cyan-600 hover:bg-cyan-500 text-white inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Upload size={14} />
                    <span>{isThai ? "อัปโหลดไฟล์ SAP (.xlsx / .xls / .csv)" : "Choose SAP File (.xlsx / .csv)"}</span>
                  </button>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      handleSapFileUpload(file);
                      return;
                    }
                    let dropped = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text");
                    if (!dropped && e.dataTransfer.getData("text/html")) {
                      const html = e.dataTransfer.getData("text/html");
                      const docHtml = new DOMParser().parseFromString(html, "text/html");
                      const rows = Array.from(docHtml.querySelectorAll("tr"));
                      dropped =
                        rows.length > 0
                          ? rows
                              .map((r) =>
                                Array.from(r.querySelectorAll("td, th"))
                                  .map((c) => c.textContent?.trim() || "")
                                  .join("\t")
                              )
                              .join("\n")
                          : docHtml.body.textContent || "";
                    }
                    if (dropped?.trim()) {
                      setSapRawText(dropped);
                    }
                  }}
                >
                  <textarea
                    ref={sapTextAreaRef}
                    rows={9}
                    value={sapRawText}
                    onChange={(e) => setSapRawText(e.target.value)}
                    onPaste={(e) => {
                      let pasted =
                        e.clipboardData?.getData("text/plain") ||
                        e.clipboardData?.getData("text") ||
                        "";
                      if (!pasted && e.clipboardData?.getData("text/html")) {
                        const html = e.clipboardData.getData("text/html");
                        const docHtml = new DOMParser().parseFromString(html, "text/html");
                        const rows = Array.from(docHtml.querySelectorAll("tr"));
                        if (rows.length > 0) {
                          pasted = rows
                            .map((r) =>
                              Array.from(r.querySelectorAll("td, th"))
                                .map((c) => c.textContent?.trim() || "")
                                .join("\t")
                            )
                            .join("\n");
                        }
                      }
                      if (pasted?.trim()) {
                        e.preventDefault();
                        setSapRawText(pasted);
                      }
                    }}
                    placeholder={
                      isThai
                        ? "คลิกแล้วกด Ctrl+V เพื่อวางตารางจาก SAP / Excel หรือลากไฟล์ SAP (.xlsx, .xls, .csv) มาวางในช่องนี้..."
                        : "Click and press Ctrl+V to paste SAP table or drag & drop SAP file (.xlsx, .xls, .csv)..."
                    }
                    className="w-full p-3.5 font-mono text-xs rounded-xl bg-slate-50 dark:bg-[#0c1930] border-2 border-cyan-500/70 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                    spellCheck={false}
                  />
                </div>

                {sapRawText.trim() && (
                  <div className="space-y-2">
                    <div className="px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-between text-xs">
                      <span className="font-bold text-cyan-600 dark:text-cyan-400">
                        {isThai
                          ? `ตรวจพบข้อมูล SAP พร้อมนำเข้า: ${parsedSapPreviewItems.length.toLocaleString()} รายการ`
                          : `Detected SAP items ready to import: ${parsedSapPreviewItems.length.toLocaleString()}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSapRawText("")}
                        className="text-slate-400 hover:text-rose-400 text-[11px] font-bold cursor-pointer"
                      >
                        {isThai ? "ล้างข้อความ" : "Clear"}
                      </button>
                    </div>

                    {parsedSapPreviewItems.length > 0 && (
                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-[#1e3a5f]">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr>
                              <th>[2] Batch</th>
                              <th>[11] Coil No.</th>
                              <th>[6] เกรด</th>
                              <th>[3]x[5] หนา x กว้าง (mm)</th>
                              <th>[7] ผู้ผลิต</th>
                              <th>[10] น้ำหนักคงเหลือ (kg)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsedSapPreviewItems.slice(0, 5).map((itm, idx) => (
                              <tr key={`${itm.batch}-${idx}`}>
                                <td className="font-mono font-bold text-cyan-400">{itm.batch}</td>
                                <td className="font-mono">{itm.coilNo}</td>
                                <td className="font-bold">{itm.grade}</td>
                                <td className="font-mono">
                                  {itm.certThickness !== "-" && itm.width !== "-"
                                    ? `${itm.certThickness} x ${itm.width}`
                                    : "-"}
                                </td>
                                <td>{itm.manufacturer}</td>
                                <td className="font-mono font-bold">
                                  {itm.weightKg > 0 ? `${itm.weightKg.toLocaleString()} kg` : "0"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createMissingStockOnSapImport}
                    onChange={(e) => setCreateMissingStockOnSapImport(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      {isThai
                        ? "เพิ่มรายการเหล็กม้วนใหม่จาก SAP เข้าสต๊อกคงเหลือ (coil_stock) ทันที"
                        : "Insert new SAP coils directly into Active Stock (coil_stock)"}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {isThai
                        ? "หากเปิดไว้ ระบบจะทั้งอัปเดตม้วนที่สแกนรับเข้าแล้ว และเพิ่มม้วนจาก SAP ที่ยังไม่มีในสต๊อกให้แสดงในตารางสต๊อกทันที (ไม่ทับ Location ที่พนักงานสแกนหน้างานไว้)"
                        : "Updates already-scanned coils and adds missing SAP coils to stock without overwriting shop-floor locations."}
                    </div>
                  </div>
                </label>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 m-0">
                  <Info size={13} className="text-cyan-500 flex-shrink-0" />
                  <span>
                    {isThai
                      ? "รองรับไฟล์ Excel (.xlsx, .xls) และ CSV ภาษาไทย (Windows-874 / TIS-620 / UTF-8) จากระบบ SAP โดยไม่กระทบฐานข้อมูลส่วนงานสลิต"
                      : "Supports SAP Excel (.xlsx, .xls) and Thai CSV (Windows-874 / UTF-8). Completely isolated inside dbCoil."}
                  </span>
                </p>

                {/* Modal Footer */}
                <div className="pt-3 border-t border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                  <div>
                    {coilSapMap.size > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          Swal.fire({
                            title: isThai ? "ล้างข้อมูล SAP Master เดิม?" : "Clear Cloud SAP Data?",
                            text: isThai
                              ? `ต้องการลบข้อมูล SAP Master ที่จัดเก็บไว้ (${coilSapMap.size.toLocaleString()} รายการ / ${coilSapChunkCount || Math.ceil(coilSapMap.size / COIL_SAP_CHUNK_SIZE)} chunks) ใช่หรือไม่? (ไม่ลบรายการในสต๊อกปัจจุบัน)`
                              : `Clear ${coilSapMap.size.toLocaleString()} SAP master records from Cloud?`,
                            icon: "warning",
                            showCancelButton: true,
                            confirmButtonColor: "#dc2626",
                            confirmButtonText: isThai ? "ยืนยันล้างข้อมูล SAP" : "Clear SAP",
                            cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
                          }).then(async (res) => {
                            if (res.isConfirmed) {
                              await clearCoilSapChunksFromCloud();
                              setCoilSapMap(new Map());
                              setCoilSapChunkCount(0);
                              showToast(isThai ? "ล้างข้อมูล SAP สำเร็จ" : "SAP data cleared", "success");
                            }
                          });
                        }}
                        className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/70 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 size={14} />
                        <span>
                          {isThai
                            ? `ล้างข้อมูล SAP เดิม (${coilSapMap.size.toLocaleString()})`
                            : `Clear SAP (${coilSapMap.size.toLocaleString()})`}
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setIsSapModalOpen(false)}
                      className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#152646] cursor-pointer"
                    >
                      {isThai ? "ปิด" : "Close"}
                    </button>
                    <button
                      type="button"
                      disabled={parsedSapPreviewItems.length === 0}
                      onClick={() => executeCoilSapImport(parsedSapPreviewItems, "Paste/Table")}
                      className={`px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 transition-all ${
                        parsedSapPreviewItems.length > 0
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-xs"
                          : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <CheckCircle2 size={14} />
                      <span>
                        {isThai
                          ? `อัปโหลดและนำเข้าสต๊อก SAP (${parsedSapPreviewItems.length.toLocaleString()})`
                          : `Upload & Import (${parsedSapPreviewItems.length.toLocaleString()})`}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODE 6: 3D COIL WAREHOUSE LAYOUT (ผังคลัง 3D — Live Sync)
         ===================================================================== */}
      {activeMode === "warehouse_3d" && (
        <CoilWarehouse3DView
          activeCoils={activeStockCoils}
          coilSapMap={coilSapMap}
          isThai={isThai}
          isCloudLoading={isCloudLoading}
          baseSlotsPerRow={warehouseBaseSlotsPerRow}
          onChangeBaseSlotsPerRow={handleChangeWarehouseBaseSlots}
        />
      )}

      {/* =====================================================================
          MODAL 1: OUTBOUND PICK LIST BARCODE SCANNER (-เตรียมเบิก)
         ===================================================================== */}
      {isOutboundScannerOpen && activeOrder && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-blue-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScanLine size={18} />
                <div>
                  <h3 className="text-sm font-extrabold m-0">
                    {isThai
                      ? `สแกนบาร์โค้ดเตรียมเบิกเหล็กม้วน (Order: ${activeOrder.orderNo})`
                      : `Scan Batch to Stage (Order: ${activeOrder.orderNo})`}
                  </h3>
                  <p className="text-[11px] text-blue-100 m-0">
                    {isThai
                      ? `เครื่องจักรเป้าหมาย: ${activeOrder.machineId} • เตรียมแล้ว ${
                          activeOrder.items.filter(
                            (i) => i.status === "staged" || i.status === "issued"
                          ).length
                        }/${activeOrder.items.length} รายการ`
                      : `Target Machine: ${activeOrder.machineId}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleFinishOutboundScan}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              {/* Camera Scanner Toggle */}
              {isOutboundCameraActive && (
                <div className="rounded-xl overflow-hidden border border-blue-500/40">
                  <CameraBarcodeScanner
                    isThai={isThai}
                    barcodeOnly={true}
                    onClose={() => setIsOutboundCameraActive(false)}
                    onScan={(code) => processOutboundBarcodeScan(code)}
                  />
                </div>
              )}

              <form onSubmit={handleOutboundBarcodeScan} className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                    {isThai
                      ? "สแกนหรือกรอกรหัส Batch 10 หลัก (10-Digit Batch Code):"
                      : "Scan or enter 10-Digit Batch Code:"}
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsOutboundCameraActive((v) => !v)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Camera size={13} />
                    <span>
                      {isOutboundCameraActive
                        ? isThai
                          ? "ปิดกล้องสแกน"
                          : "Close Camera"
                        : isThai
                        ? "เปิดกล้องสแกน"
                        : "Open Camera"}
                    </span>
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={outboundScannerInputRef}
                    type="text"
                    maxLength={10}
                    value={outboundBarcodeInput}
                    onChange={(e) => setOutboundBarcodeInput(e.target.value.toUpperCase())}
                    placeholder={isThai ? "เช่น 23A0967518" : "e.g. 23A0967518"}
                    className="flex-1 px-3.5 py-2.5 rounded-xl text-sm font-mono font-extrabold border-2 border-blue-500 bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold cursor-pointer"
                  >
                    {isThai ? "ยืนยันสแกน" : "Submit"}
                  </button>
                </div>
              </form>

              {/* Scan Status Feedback Banner */}
              <div
                className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                  outboundScanStatus.type === "success"
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300"
                    : outboundScanStatus.type === "error"
                    ? "bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-300"
                    : outboundScanStatus.type === "warning"
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300"
                    : "bg-slate-100 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300"
                }`}
              >
                {outboundScanStatus.type === "success" ? (
                  <CheckCircle2 size={16} className="shrink-0" />
                ) : outboundScanStatus.type === "error" ||
                  outboundScanStatus.type === "warning" ? (
                  <AlertTriangle size={16} className="shrink-0" />
                ) : (
                  <Barcode size={16} className="shrink-0" />
                )}
                <span>{outboundScanStatus.message}</span>
              </div>

              {/* Quick Checklist of Batches in Active Order */}
              <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 dark:bg-[#0c1930] border-b border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
                  <span>
                    {isThai
                      ? `รายการ Batch ในใบสั่งเบิก (${activeOrder.items.length} รายการ)`
                      : `Batches in Order (${activeOrder.items.length})`}
                  </span>
                  <span className="text-emerald-500">
                    {isThai ? "เตรียมแล้ว:" : "Staged:"}{" "}
                    {
                      activeOrder.items.filter(
                        (i) => i.status === "staged" || i.status === "issued"
                      ).length
                    }{" "}
                    / {activeOrder.items.length}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-200/70 dark:divide-[#1e3a5f]">
                  {activeOrder.items.map((itm, i) => (
                    <div
                      key={`${itm.batch}-${i}`}
                      className="px-3 py-2 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-extrabold text-blue-600 dark:text-blue-300">
                          {itm.batch}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate max-w-[210px]">
                          {itm.description || `${itm.grade} (${itm.thickness}x${itm.width})`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">
                          {Number(itm.weightKg || 0).toLocaleString()} {itm.unit || "KG"}
                        </span>
                        {itm.status === "staged" || itm.status === "issued" ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-500 text-[10.5px] font-extrabold">
                            {itm.status === "issued"
                              ? isThai
                                ? "จ่ายแล้ว"
                                : "Issued"
                              : isThai
                              ? "เตรียมแล้ว"
                              : "Staged"}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[10.5px] font-bold">
                            {isThai ? "รอเตรียม" : "Pending"}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleFinishOutboundScan}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold cursor-pointer"
                >
                  {isThai ? "เสร็จสิ้นการสแกน" : "Done"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: OFFICER IMPORT PICK LIST MODAL (+ เพิ่มใบสั่งเบิก)
         ===================================================================== */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-emerald-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={18} />
                <div>
                  <h3 className="text-sm font-extrabold m-0">
                    {isThai
                      ? "เพิ่มใบสั่งเบิกเหล็กม้วน (Import SAP Pick List Table)"
                      : "Import Coil Pick List Table"}
                  </h3>
                  <p className="text-[11px] text-emerald-100 m-0">
                    {isThai
                      ? "คัดลอกตารางจาก SAP / Excel แล้ววางลงในช่องด้านล่าง ระบบจะแยก Order และ Batch 10 หลักให้อัตโนมัติ"
                      : "Paste SAP / Excel Pick List table below"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={handleSaveImportedPickList}
              className="p-5 space-y-4 max-h-[84vh] overflow-y-auto"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    {isThai
                      ? "1. เลือกเครื่องจักรเป้าหมาย (Target Machine):"
                      : "1. Target Machine:"}
                  </label>
                  <select
                    value={importMachineId}
                    onChange={(e) => setImportMachineId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
                  >
                    {SLITTING_MACHINES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    {isThai
                      ? "2. เลขที่ใบสั่งเบิก (Order No.) [เว้นว่างได้ถ้าในตารางมีคอลัมน์ Order]:"
                      : "2. Order No. (Optional if table has Order column):"}
                  </label>
                  <input
                    type="text"
                    value={importOrderNo}
                    onChange={(e) => setImportOrderNo(e.target.value.toUpperCase())}
                    placeholder={
                      isThai
                        ? "เช่น 1020045890 (หรือดึงจากคอลัมน์แรกของตารางอัตโนมัติ)"
                        : "e.g. 1020045890"
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                  {isThai
                    ? "3. วางข้อมูลตารางใบสั่งเบิกจาก SAP / Excel (Order | Item | Material | Description | Req Qty | Unit | Batch | SLoc):"
                    : "3. Paste SAP / Excel Pick List Table:"}
                </label>
                <textarea
                  rows={6}
                  value={rawTableText}
                  onChange={(e) => setRawTableText(e.target.value)}
                  placeholder={
                    isThai
                      ? "วางข้อมูลตารางจาก SAP / Excel ที่นี่...\nตัวอย่าง:\n1020045890\t0010\t111000234\tCOIL GI 0.45x1219\t5,420\tKG\t23A0967518\t1101"
                      : "Paste table rows here..."
                  }
                  className="w-full p-3 rounded-xl text-xs font-mono border border-slate-300 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {importError && (
                <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/40 text-red-600 dark:text-red-300 text-xs font-bold flex items-center gap-2">
                  <AlertTriangle size={15} />
                  <span>{importError}</span>
                </div>
              )}

              {/* Live Preview Table */}
              <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-100 dark:bg-[#0c1930] border-b border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between text-xs font-extrabold">
                  <span>
                    {isThai
                      ? `ตัวอย่างรายการที่ตรวจพบ (${parsedPreviewItems.length} รายการ)`
                      : `Detected Pick List Items (${parsedPreviewItems.length})`}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Machine: {importMachineId}
                  </span>
                </div>
                <div className="max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Item</th>
                        <th>Material</th>
                        <th>Description</th>
                        <th>Req. Qty</th>
                        <th>Unit</th>
                        <th>Batch</th>
                        <th>SLoc</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedPreviewItems.slice(0, 50).map((itm, idx) => (
                        <tr key={`${itm.batch}-${idx}`}>
                          <td className="font-mono font-bold">
                            {itm.orderNo || importOrderNo || "-"}
                          </td>
                          <td className="font-mono">{itm.bomItem}</td>
                          <td className="font-mono">{itm.material}</td>
                          <td className="max-w-[200px] truncate">{itm.materialDescription}</td>
                          <td className="font-mono font-bold text-right">
                            {Number(itm.requirementQty || 0).toLocaleString()}
                          </td>
                          <td className="font-mono">{itm.unit}</td>
                          <td className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                            {itm.batch}
                          </td>
                          <td className="font-mono">{itm.storageLocation}</td>
                        </tr>
                      ))}
                      {parsedPreviewItems.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center py-6 text-slate-400">
                            {isThai
                              ? "วางข้อมูลตารางด้านบนเพื่อดูตัวอย่างรายการก่อนบันทึก"
                              : "Paste table data above to preview items"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  {isThai ? "ยกเลิก" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 size={14} />
                  <span>
                    {isThai
                      ? `บันทึกใบสั่งเบิก (${parsedPreviewItems.length} รายการ)`
                      : `Save Pick List (${parsedPreviewItems.length})`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: EMERGENCY PRE-STAGING MODAL (เบิกฉุกเฉิน TEMP ก่อนมี Order)
         ===================================================================== */}
      {isEmergencyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-amber-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={18} />
                <div>
                  <h3 className="text-sm font-extrabold m-0">
                    {isThai
                      ? "เบิกฉุกเฉิน (Emergency Pre-Staging / TEMP Order)"
                      : "Emergency Pre-Staging (TEMP Order)"}
                  </h3>
                  <p className="text-[11px] text-amber-100 m-0">
                    {isThai
                      ? "สแกนเตรียมเบิกเหล็กม้วนล่วงหน้าก่อนได้รับเลข Order จริง (ระบบจะจับคู่ให้อัตโนมัติเมื่อนำเข้าใบสั่งเบิกภายหลัง)"
                      : "Pre-stage coils before receiving a real SAP Order No."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEmergencyCameraActive(false);
                  setIsEmergencyModalOpen(false);
                }}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    {isThai ? "1. เลือกเครื่องจักร (Machine):" : "1. Target Machine:"}
                  </label>
                  <select
                    value={emergencyMachineId}
                    onChange={(e) => {
                      const nextM = e.target.value;
                      setEmergencyMachineId(nextM);
                      setEmergencyTempOrderNo((prev) =>
                        prev.replace(/^TEMP-[A-Z0-9]+-/, `TEMP-${nextM}-`)
                      );
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
                  >
                    {SLITTING_MACHINES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                    {isThai ? "2. รหัสใบเบิกชั่วคราว (TEMP Order No.):" : "2. TEMP Order No.:"}
                  </label>
                  <input
                    type="text"
                    value={emergencyTempOrderNo}
                    onChange={(e) => setEmergencyTempOrderNo(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border border-amber-400 dark:border-amber-700 bg-amber-50/40 dark:bg-[#0c1930] text-amber-700 dark:text-amber-300"
                  />
                </div>
              </div>

              {isEmergencyCameraActive && (
                <div className="rounded-xl overflow-hidden border border-amber-500/40">
                  <CameraBarcodeScanner
                    isThai={isThai}
                    barcodeOnly={true}
                    onClose={() => setIsEmergencyCameraActive(false)}
                    onScan={(code) => processEmergencyBatchCode(code)}
                  />
                </div>
              )}

              <form onSubmit={handleAddEmergencyBatch} className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                    {isThai
                      ? "3. สแกนบาร์โค้ด Batch 10 หลัก ที่ต้องการเบิกฉุกเฉิน:"
                      : "3. Scan 10-Digit Batch Barcode:"}
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsEmergencyCameraActive((v) => !v)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Camera size={13} />
                    <span>
                      {isEmergencyCameraActive
                        ? isThai
                          ? "ปิดกล้องสแกน"
                          : "Close Camera"
                        : isThai
                        ? "เปิดกล้องสแกน"
                        : "Open Camera"}
                    </span>
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={emergencyBarcodeRef}
                    type="text"
                    maxLength={10}
                    value={emergencyBarcodeInput}
                    onChange={(e) => setEmergencyBarcodeInput(e.target.value.toUpperCase())}
                    placeholder={isThai ? "สแกนรหัส Batch 10 หลัก..." : "Scan 10-digit Batch..."}
                    className="flex-1 px-3.5 py-2 rounded-xl text-sm font-mono font-extrabold border-2 border-amber-500 bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-extrabold cursor-pointer"
                  >
                    {isThai ? "+ เพิ่ม Batch" : "+ Add Batch"}
                  </button>
                </div>
              </form>

              {/* Scanned Emergency Batches List */}
              <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-100 dark:bg-[#0c1930] border-b border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between text-xs font-extrabold">
                  <span>
                    {isThai
                      ? `รายการ Batch ที่สแกนเบิกฉุกเฉิน (${emergencyScannedBatches.length} ม้วน)`
                      : `Scanned Emergency Batches (${emergencyScannedBatches.length})`}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Batch</th>
                        <th>Spec / Description</th>
                        <th>Weight (KG)</th>
                        <th>Location</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {emergencyScannedBatches.map((b, idx) => (
                        <tr key={b.batch}>
                          <td className="font-mono">{idx + 1}</td>
                          <td className="font-mono font-extrabold text-amber-600 dark:text-amber-400">
                            {b.batch}
                          </td>
                          <td className="max-w-[200px] truncate">
                            {b.description || `${b.grade} (${b.thickness}x${b.width})`}
                          </td>
                          <td className="font-mono font-bold">
                            {Number(b.weightKg || 0).toLocaleString()}
                          </td>
                          <td className="font-mono">{b.sourceLocation}</td>
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setEmergencyScannedBatches((prev) =>
                                  prev.filter((x) => x.batch !== b.batch)
                                )
                              }
                              className="p-1 text-red-500 hover:bg-red-500/10 rounded cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {emergencyScannedBatches.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-6 text-slate-400">
                            {isThai
                              ? "ยังไม่มีรายการที่สแกน กรุณาสแกนบาร์โค้ด Batch ด้านบน"
                              : "No batches scanned yet"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEmergencyCameraActive(false);
                    setIsEmergencyModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  {isThai ? "ยกเลิก" : "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmEmergencyStaging}
                  disabled={emergencyScannedBatches.length === 0}
                  className={`px-5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 ${
                    emergencyScannedBatches.length > 0
                      ? "bg-amber-600 hover:bg-amber-500 text-white cursor-pointer shadow-xs"
                      : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  <CheckCircle2 size={14} />
                  <span>
                    {isThai
                      ? `ยืนยันสร้างใบเบิกฉุกเฉิน (${emergencyScannedBatches.length} ม้วน)`
                      : `Confirm Emergency Staging (${emergencyScannedBatches.length})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: OPERATOR RECEIVE / MACHINE ISSUE BARCODE SCANNER (จ่ายออก)
         ===================================================================== */}
      {isOperatorScannerOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-indigo-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScanLine size={18} />
                <div>
                  <h3 className="text-sm font-extrabold m-0">
                    {isThai
                      ? `สแกนบาร์โค้ดจ่ายออกเหล็กม้วนเข้าเครื่อง [${selectedMachineId}]`
                      : `Scan Batch to Issue to Machine [${selectedMachineId}]`}
                  </h3>
                  <p className="text-[11px] text-indigo-100 m-0">
                    {isThai
                      ? "สแกนได้เฉพาะรายการที่สถานะเป็น 'เตรียมแล้ว' และมี Location ในสต๊อก"
                      : "Only staged items with a valid Stock Location can be issued"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOperatorCameraActive(false);
                  setIsOperatorScannerOpen(false);
                }}
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              {isOperatorCameraActive && (
                <div className="rounded-xl overflow-hidden border border-indigo-500/40">
                  <CameraBarcodeScanner
                    isThai={isThai}
                    barcodeOnly={true}
                    onClose={() => setIsOperatorCameraActive(false)}
                    onScan={(code) => processOperatorIssueScan(code)}
                  />
                </div>
              )}

              <form onSubmit={handleOperatorBarcodeScan} className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                    {isThai
                      ? "สแกนหรือกรอกรหัส Batch 10 หลัก เพื่อจ่ายออกและตัดสต๊อก:"
                      : "Scan or enter 10-Digit Batch Code to Issue:"}
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsOperatorCameraActive((v) => !v)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Camera size={13} />
                    <span>
                      {isOperatorCameraActive
                        ? isThai
                          ? "ปิดกล้องสแกน"
                          : "Close Camera"
                        : isThai
                        ? "เปิดกล้องสแกน"
                        : "Open Camera"}
                    </span>
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={operatorScannerInputRef}
                    type="text"
                    maxLength={10}
                    value={operatorBarcodeInput}
                    onChange={(e) => setOperatorBarcodeInput(e.target.value.toUpperCase())}
                    placeholder={isThai ? "เช่น 23A0967518" : "e.g. 23A0967518"}
                    className="flex-1 px-3.5 py-2.5 rounded-xl text-sm font-mono font-extrabold border-2 border-indigo-500 bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold cursor-pointer"
                  >
                    {isThai ? "ยืนยันจ่ายออก" : "Issue"}
                  </button>
                </div>
              </form>

              <div
                className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                  operatorScanStatus.type === "success"
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300"
                    : operatorScanStatus.type === "error"
                    ? "bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-300"
                    : operatorScanStatus.type === "warning"
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300"
                    : "bg-slate-100 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300"
                }`}
              >
                {operatorScanStatus.type === "success" ? (
                  <CheckCircle2 size={16} className="shrink-0" />
                ) : operatorScanStatus.type === "error" ||
                  operatorScanStatus.type === "warning" ? (
                  <AlertTriangle size={16} className="shrink-0" />
                ) : (
                  <Barcode size={16} className="shrink-0" />
                )}
                <span>{operatorScanStatus.message}</span>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsOperatorCameraActive(false);
                    setIsOperatorScannerOpen(false);
                  }}
                  className="px-5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-extrabold cursor-pointer"
                >
                  {isThai ? "ปิดหน้าต่างสแกน" : "Close"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 5: OPERATOR WARNING MODAL (Wrong Machine / Missing Location / Not Staged)
         ===================================================================== */}
      {operatorWarningModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#111e38] border-2 border-red-500 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-red-600 text-white flex items-center gap-2">
              <AlertTriangle size={20} />
              <h3 className="text-sm font-extrabold m-0">{operatorWarningModal.title}</h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs font-extrabold text-red-600 dark:text-red-400 m-0 leading-relaxed">
                {operatorWarningModal.message}
              </p>
              {operatorWarningModal.detail && (
                <p className="text-xs text-slate-600 dark:text-slate-300 m-0 leading-relaxed bg-slate-100 dark:bg-[#0c1930] p-3 rounded-xl border border-slate-200 dark:border-[#1e3a5f]">
                  {operatorWarningModal.detail}
                </p>
              )}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOperatorWarningModal({ isOpen: false, title: "", message: "" });
                    setTimeout(() => operatorScannerInputRef.current?.focus(), 60);
                  }}
                  className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold cursor-pointer"
                >
                  {isThai ? "รับทราบ" : "Acknowledge"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 6: DELETE PICK LIST ORDER CONFIRMATION MODAL
         ===================================================================== */}
      {deleteModalOrderNo && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden p-5 space-y-4">
            <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
              <Trash2 size={20} />
              <h3 className="text-sm font-extrabold m-0">
                {isThai ? "ยืนยันการลบใบสั่งเบิก" : "Confirm Delete Pick List Order"}
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 m-0 leading-relaxed">
              {isThai
                ? `คุณต้องการลบใบสั่งเบิก Order [${deleteModalOrderNo}] ออกจากระบบใช่หรือไม่? (รายการที่ยังไม่จ่ายออกจะถูกปลดล็อกกลับเป็นสถานะพร้อมใช้)`
                : `Are you sure you want to delete Order [${deleteModalOrderNo}]?`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModalOrderNo(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                {isThai ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOrder}
                className="px-4 py-2 rounded-xl text-xs font-extrabold bg-red-600 hover:bg-red-500 text-white cursor-pointer"
              >
                {isThai ? "ยืนยันลบใบสั่งเบิก" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* General Camera Barcode Scanner Modal (Inbound / Relocate / Stock Search) */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <CameraBarcodeScanner
              isThai={isThai}
              onClose={() => setIsCameraOpen(false)}
              onScan={(decodedText) => {
                setIsCameraOpen(false);
                if (activeMode === "inbound") {
                  const rawInbound = String(decodedText || "")
                    .replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, "")
                    .toUpperCase();
                  setInboundScanInput(rawInbound.slice(0, 10));
                  handleInboundSubmit(undefined, rawInbound);
                  return;
                }
                const code = cleanBarcode(decodedText).toUpperCase();
                if (!code) return;
                if (activeMode === "operator_receive") {
                  processOperatorIssueScan(code);
                } else if (activeMode === "outbound") {
                  processOutboundBarcodeScan(code);
                } else if (activeMode === "relocate_layout") {
                  setRelocateScanInput(code);
                  handleRelocateScanAdd(undefined, code);
                } else {
                  setStockSearch(code);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
