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
} from "lucide-react";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";
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
const COMMON_GRADES = ["SS400", "SPCC", "SGCC", "SAPH440", "SPHC", "STKR400"];
const COMMON_MANUFACTURERS = ["SSI", "GJ", "POSCO", "JFE", "NIPPON", "SYS", "CSC"];
const INBOUND_BUILDINGS = ["E7", "E8", "H7", "H8", "05", "21"];
const INBOUND_QUICK_ROWS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const STICKY_COIL_LOCATION_KEY = "tmt_wms_coil_sticky_location_v1";

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
  const [inboundLocation, setInboundLocation] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(STICKY_COIL_LOCATION_KEY);
      if (saved && saved.trim()) return saved.trim().toUpperCase();
    }
    return "E7/1";
  });
  const [inboundBuilding, setInboundBuilding] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(STICKY_COIL_LOCATION_KEY);
      if (saved && saved.includes("/")) {
        const b = saved.split("/")[0].trim().toUpperCase();
        if (INBOUND_BUILDINGS.includes(b)) return b;
      }
    }
    return "E7";
  });
  const [inboundRow, setInboundRow] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(STICKY_COIL_LOCATION_KEY);
      if (saved && saved.includes("/")) {
        return saved.split("/").slice(1).join("/").trim().toUpperCase() || "1";
      }
    }
    return "1";
  });
  const [inboundSearch, setInboundSearch] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inboundBatchInputRef = useRef<HTMLInputElement | null>(null);

  const focusInboundBatchInput = () => {
    setTimeout(() => {
      inboundBatchInputRef.current?.focus();
    }, 20);
  };

  // Persist sticky location & auto-focus Batch input when in Inbound tab
  useEffect(() => {
    if (typeof window !== "undefined" && inboundLocation.trim()) {
      try {
        window.localStorage.setItem(STICKY_COIL_LOCATION_KEY, inboundLocation.trim().toUpperCase());
      } catch {
        // ignore storage error
      }
    }
  }, [inboundLocation]);

  useEffect(() => {
    if (activeMode === "inbound" && !isCameraOpen) {
      focusInboundBatchInput();
    }
  }, [activeMode, inboundSourceType, isCameraOpen]);

  const handleSelectInboundBuilding = (building: string) => {
    const cleanB = building.trim().toUpperCase();
    const cleanR = inboundRow.trim().toUpperCase() || "1";
    setInboundBuilding(cleanB);
    if (!inboundRow.trim()) setInboundRow("1");
    setInboundLocation(`${cleanB}/${cleanR}`);
    focusInboundBatchInput();
  };

  const handleSelectInboundRow = (rowVal: string, shouldFocusBatch = true) => {
    const cleanR = rowVal.replace(/^\//, "").trim().toUpperCase();
    const cleanB = inboundBuilding.trim().toUpperCase() || "E7";
    setInboundRow(cleanR);
    setInboundLocation(cleanR ? `${cleanB}/${cleanR}` : cleanB);
    if (shouldFocusBatch) {
      focusInboundBatchInput();
    }
  };

  const handleManualInboundLocationChange = (rawVal: string) => {
    const val = rawVal.toUpperCase();
    setInboundLocation(val);
    if (val.includes("/")) {
      const [bPart, ...rParts] = val.split("/");
      const cleanB = bPart.trim().toUpperCase();
      const cleanR = rParts.join("/").trim().toUpperCase();
      if (INBOUND_BUILDINGS.includes(cleanB)) {
        setInboundBuilding(cleanB);
      }
      setInboundRow(cleanR);
    } else if (INBOUND_BUILDINGS.includes(val.trim())) {
      setInboundBuilding(val.trim());
      setInboundRow("");
    }
  };

  // ============================================================================
  // Tab 2 State: จ่ายออก (Issue / Operator Receive)
  // ============================================================================
  const [issueMachineId, setIssueMachineId] = useState<string>("CL01");
  const [issueScanInput, setIssueScanInput] = useState<string>("");
  const [issueOrderFilter, setIssueOrderFilter] = useState<string>("ALL");

  // ============================================================================
  // Tab 3 State: -เตรียมเบิก (Staging / PickList Prep)
  // ============================================================================
  const [stagingMachineId, setStagingMachineId] = useState<string>("CL01");
  const [stagingOrderNoInput, setStagingOrderNoInput] = useState<string>("");
  const [stagingScanInput, setStagingScanInput] = useState<string>("");
  const [selectedCoilIdsForStaging, setSelectedCoilIdsForStaging] = useState<string[]>([]);

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

    const rawCode = rawSubmitted;
    const finalLocation = inboundLocation.trim().toUpperCase() || `${inboundBuilding || "E7"}/${inboundRow || "1"}`;
    const existingRecord = coilStock.find((c) => c.batch.toUpperCase() === rawCode);
    const sapMaster = coilSapMap.get(rawCode);
    const hasExistingSap = Boolean(existingRecord?.hasSapData || sapMaster);
    const preservedWeight =
      sapMaster && sapMaster.weightKg > 0
        ? sapMaster.weightKg
        : hasExistingSap && existingRecord?.weightKg && existingRecord.weightKg > 0
        ? existingRecord.weightKg
        : 0;

    // Immediately clear input & keep focus for rapid continuous scanning
    setInboundScanInput("");
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

  const handleExcelImportInbound = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await handleSapFileUpload(file);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ============================================================================
  // Handlers for Tab 3: -เตรียมเบิก (Staging / PickList Prep)
  // ============================================================================
  const handleStageByScan = async (e?: React.FormEvent, overrideCode?: string) => {
    e?.preventDefault();
    const code = cleanBarcode(overrideCode ?? stagingScanInput).toUpperCase();
    if (!code) return;

    const matchedCoil = activeStockCoils.find(
      (c) => c.batch.toUpperCase() === code || c.coilNo.toUpperCase() === code
    );
    if (!matchedCoil) {
      playBeep("error");
      showToast(
        isThai ? `ไม่พบเหล็กม้วนรหัส ${code} ในสต๊อกพร้อมเบิก` : `Coil ${code} not found in active stock`,
        "error"
      );
      return;
    }

    const { dateYmd, timeHms, timestamp } = formatNowTimestamp();
    const orderNo =
      stagingOrderNoInput.trim().toUpperCase() ||
      `STG-${stagingMachineId}-${dateYmd.replace(/-/g, "")}`;

    const existingOrder = stagingOrders.find(
      (o) => o.orderNo.toUpperCase() === orderNo && o.status !== "completed"
    );

    const newItem: CoilStagingItem = {
      id: `CSI-${orderNo}-${matchedCoil.batch}`,
      batch: matchedCoil.batch,
      coilNo: matchedCoil.coilNo,
      grade: matchedCoil.grade,
      thickness: matchedCoil.certThickness,
      width: matchedCoil.width,
      weightKg: matchedCoil.weightKg,
      sourceLocation: matchedCoil.location,
      status: "staged",
      stagedAt: timestamp,
      description: matchedCoil.description,
    };

    const items = existingOrder
      ? [
          ...existingOrder.items.filter(
            (i) => i.batch.toUpperCase() !== matchedCoil.batch.toUpperCase()
          ),
          newItem,
        ]
      : [newItem];

    await saveCoilStagingOrderToCloud({
      id: existingOrder?.id || `CSTG-${orderNo}`,
      orderNo,
      machineId: stagingMachineId,
      createdDate: existingOrder?.createdDate || dateYmd,
      createdAt: existingOrder?.createdAt || timeHms,
      status: "in_progress",
      items,
      updatedAt: new Date().toISOString(),
    });

    setStagingScanInput("");
    playBeep("success");
    showToast(
      isThai
        ? `เตรียมเบิกม้วน ${matchedCoil.batch} สำหรับเครื่อง ${stagingMachineId} (ใบเบิก ${orderNo}) สำเร็จ`
        : `Staged coil ${matchedCoil.batch} for ${stagingMachineId}`,
      "success"
    );
  };

  const handleCreateStagingFromSelection = async () => {
    const selectedCoils = availableCoils.filter((c) =>
      selectedCoilIdsForStaging.includes(c.id)
    );
    if (selectedCoils.length === 0) {
      showToast(
        isThai ? "กรุณาเลือกเหล็กม้วนที่ต้องการเตรียมเบิกอย่างน้อย 1 ม้วน" : "Select at least 1 coil to stage",
        "warning"
      );
      return;
    }

    const { dateYmd, timeHms, timestamp } = formatNowTimestamp();
    const orderNo =
      stagingOrderNoInput.trim().toUpperCase() ||
      `STG-${stagingMachineId}-${dateYmd.slice(5).replace("-", "")}-${String(stagingOrders.length + 1).padStart(2, "0")}`;

    const items: CoilStagingItem[] = selectedCoils.map((c) => ({
      id: `CSI-${orderNo}-${c.batch}`,
      batch: c.batch,
      coilNo: c.coilNo,
      grade: c.grade,
      thickness: c.certThickness,
      width: c.width,
      weightKg: c.weightKg,
      sourceLocation: c.location,
      status: "staged",
      stagedAt: timestamp,
      description: c.description,
    }));

    await saveCoilStagingOrderToCloud({
      id: `CSTG-${orderNo}`,
      orderNo,
      machineId: stagingMachineId,
      createdDate: dateYmd,
      createdAt: timeHms,
      status: "in_progress",
      items,
      updatedAt: new Date().toISOString(),
    });

    setSelectedCoilIdsForStaging([]);
    setStagingOrderNoInput("");
    playBeep("success");
    showToast(
      isThai
        ? `สร้างใบเตรียมเบิก ${orderNo} (${selectedCoils.length} ม้วน) เข้าเครื่อง ${stagingMachineId} เรียบร้อย`
        : `Created staging order ${orderNo} (${selectedCoils.length} coils)`,
      "success"
    );
    onLogTransaction?.(
      `Prepared Coil Staging Order ${orderNo} (${selectedCoils.length} coils) for ${stagingMachineId}`,
      orderNo,
      "Completed"
    );
  };

  // ============================================================================
  // Handlers for Tab 2: จ่ายออก (Issue / Operator Receive)
  // ============================================================================
  const handleIssueCoil = async (coil: CoilStockRecord, targetMachine?: string, stagingOrder?: CoilStagingOrder | null) => {
    const machine = targetMachine || coil.stagedMachineId || issueMachineId || "SM01";
    const orderNo = stagingOrder?.orderNo || coil.stagedOrderNo || `ISS-${machine}-${Date.now().toString().slice(-5)}`;

    const { value: issueWeightStr, isConfirmed } = await Swal.fire({
      title: isThai ? `ยืนยันจ่ายออกเหล็กม้วน ${coil.batch}` : `Confirm Issue Coil ${coil.batch}`,
      html: `
        <div style="text-align:left; font-size:13px; line-height:1.6;">
          <div><b>Batch / Coil No:</b> ${coil.batch} (${coil.coilNo})</div>
          <div><b>Spec:</b> ${coil.grade} • ${coil.certThickness} mm x ${coil.width} mm</div>
          <div><b>Layout ปัจจุบัน:</b> ${coil.location}</div>
          <div><b>จ่ายเข้าเครื่องสลิต:</b> <span style="color:#0284c7; font-weight:700;">${machine}</span></div>
          <div style="margin-top:8px;"><b>ระบุน้ำหนักที่เบิกจ่ายจริง (kg):</b> (เต็มม้วน = ${coil.weightKg.toLocaleString()} kg)</div>
        </div>
      `,
      input: "number",
      inputValue: String(coil.weightKg),
      inputAttributes: {
        min: "1",
        max: String(coil.weightKg),
        step: "any",
      },
      showCancelButton: true,
      confirmButtonColor: "#2563eb",
      confirmButtonText: isThai ? "ยืนยันตัดจ่ายออก" : "Confirm Issue",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    });

    if (!isConfirmed) return;
    const issueWeightKg = parseFloat(String(issueWeightStr || coil.weightKg));
    if (isNaN(issueWeightKg) || issueWeightKg <= 0) return;

    await issueCoilToMachineInCloud({
      stockRecord: coil,
      machineId: machine,
      orderNo,
      issueWeightKg,
      stagingOrder: stagingOrder || null,
    });

    playBeep("success");
    showToast(
      isThai
        ? `ตัดจ่ายเหล็กม้วน ${coil.batch} (${issueWeightKg.toLocaleString()} kg) เข้าเครื่อง ${machine} สำเร็จ`
        : `Issued coil ${coil.batch} (${issueWeightKg.toLocaleString()} kg) to ${machine}`,
      "success"
    );
    onLogTransaction?.(
      `Issued Coil ${coil.batch} (${issueWeightKg.toLocaleString()} kg) to ${machine}`,
      coil.batch,
      "Completed"
    );
  };

  const handleIssueByScan = async (e?: React.FormEvent, overrideCode?: string) => {
    e?.preventDefault();
    const code = cleanBarcode(overrideCode ?? issueScanInput).toUpperCase();
    if (!code) return;

    const matchedCoil = activeStockCoils.find(
      (c) => c.batch.toUpperCase() === code || c.coilNo.toUpperCase() === code
    );
    if (!matchedCoil) {
      playBeep("error");
      showToast(
        isThai ? `ไม่พบเหล็กม้วน ${code} ในสต๊อกหรือถูกตัดจ่ายไปแล้ว` : `Coil ${code} not found in stock`,
        "error"
      );
      return;
    }

    const parentOrder = stagingOrders.find((o) =>
      o.items.some((i) => i.batch.toUpperCase() === matchedCoil.batch.toUpperCase() && i.status !== "issued")
    );

    setIssueScanInput("");
    await handleIssueCoil(matchedCoil, parentOrder?.machineId || issueMachineId, parentOrder || null);
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
  ];

  return (
    <div className="space-y-3 pb-16">
      {/* Top Control Bar: 5 Sub-Tabs + Isolated Cloud DB Status & Real-Time Toggle */}
      <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-2.5 shadow-xs flex flex-wrap items-center justify-between gap-2">
        {/* 5 Primary Sub-Tabs */}
        <div className="grid grid-cols-5 sm:flex sm:flex-wrap items-center gap-1.5 w-full lg:w-auto">
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
                      ? "เลือกอาคารและแถว (ล็อกค่า Location ค้างไว้ให้อัตโนมัติ) แล้วสแกนบาร์โค้ด Batch ได้ต่อเนื่องทันที"
                      : "Select Building & Row (Sticky Location), then scan Batch barcodes continuously"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleExcelImportInbound}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 cursor-pointer"
                >
                  <Upload size={13} />
                  <span>{isThai ? "นำเข้า Excel/CSV" : "Import Excel"}</span>
                </button>

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

            {/* 1. Top: Auto-Focus Barcode / Batch Scanner Input */}
            <form onSubmit={(e) => handleInboundSubmit(e)} className="pt-0.5">
              <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1.5">
                {isThai
                  ? "สแกนบาร์โค้ด / รหัส Batch"
                  : "Scan Barcode / Batch No."}
              </label>
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
                      isThai
                        ? `ยิงบาร์โค้ด หรือพิมพ์รหัส Batch (A-Z, 0-9 ไม่เกิน 10 หลัก) เข้าที่ ${inboundLocation || "E7/1"}...`
                        : `Scan or type Batch (A-Z, 0-9 max 10 chars) into ${inboundLocation || "E7/1"}...`
                    }
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm sm:text-base font-mono font-black border-2 border-emerald-500 dark:border-emerald-500 bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
                <button
                  type="submit"
                  className="py-3 px-5 rounded-xl text-xs sm:text-sm font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus size={16} />
                  <span>{isThai ? `บันทึกรับเข้า (${inboundLocation || "E7/1"})` : `Save (${inboundLocation || "E7/1"})`}</span>
                </button>
              </div>
            </form>

            {/* 2 & 3. Below: 2-Step Easy Location Selector (Sticky) */}
            <div className="p-3 rounded-xl bg-slate-50/90 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] space-y-3">
              {/* Step 1: Main Building */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-black inline-flex items-center justify-center">
                      1
                    </span>
                    <Building2 size={14} className="text-emerald-500" />
                    <span>{isThai ? "เลือกอาคารหลัก:" : "Step 1: Select Building:"}</span>
                  </label>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold">
                    <Lock size={11} />
                    <span>
                      {isThai ? `ล็อก Location: ${inboundLocation || "-"}` : `Sticky Location: ${inboundLocation || "-"}`}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {INBOUND_BUILDINGS.map((b) => {
                    const isSelected = inboundBuilding.toUpperCase() === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => handleSelectInboundBuilding(b)}
                        className={`py-2.5 px-3 rounded-xl text-sm font-black border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          isSelected
                            ? "bg-emerald-600 text-white border-emerald-500 shadow-sm ring-2 ring-emerald-500/30"
                            : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1e3a5f] hover:border-emerald-400"
                        }`}
                      >
                        <MapPin size={14} className={isSelected ? "text-white" : "text-emerald-500"} />
                        <span>{b}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Row Selector & Editable Combined Location */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1 border-t border-slate-200/70 dark:border-[#1e3a5f]/80">
                <div className="lg:col-span-8">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mb-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-black inline-flex items-center justify-center">
                      2
                    </span>
                    <span>{isThai ? "เลือกหรือระบุแถวที่วาง (1, 2, 3...):" : "Step 2: Select or Enter Row:"}</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {INBOUND_QUICK_ROWS.map((r) => {
                      const isRowActive = inboundRow.toUpperCase() === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => handleSelectInboundRow(r, true)}
                          className={`min-w-[40px] h-9 px-2.5 rounded-lg text-xs font-black border transition-all cursor-pointer ${
                            isRowActive
                              ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                              : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f] hover:border-emerald-400"
                          }`}
                        >
                          {r}
                        </button>
                      );
                    })}
                    <input
                      type="text"
                      value={inboundRow}
                      onChange={(e) => handleSelectInboundRow(e.target.value, false)}
                      placeholder={isThai ? "ระบุแถว..." : "Row..."}
                      className="w-24 h-9 px-2.5 rounded-lg text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-900 dark:text-white"
                      title={isThai ? "พิมพ์เลขแถวที่วางเองได้" : "Type custom row"}
                    />
                  </div>
                </div>

                <div className="lg:col-span-4">
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1.5">
                    {isThai ? "รหัส Location (อาคาร/แถว - แก้ไขได้):" : "Location Code (Editable):"}
                  </label>
                  <div className="relative flex items-center">
                    <MapPin size={15} className="absolute left-3 text-emerald-500" />
                    <input
                      type="text"
                      value={inboundLocation}
                      onChange={(e) => handleManualInboundLocationChange(e.target.value)}
                      placeholder="เช่น E7/1, H8/2"
                      className="w-full h-9 pl-9 pr-3 rounded-lg text-sm font-mono font-black border border-emerald-400 dark:border-emerald-600 bg-white dark:bg-[#111e38] text-emerald-700 dark:text-emerald-300"
                    />
                  </div>
                </div>
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
                    <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={inboundSearch}
                      onChange={(e) => setInboundSearch(e.target.value)}
                      placeholder={isThai ? "ค้นหา Batch หรือ Location..." : "Search Batch or Location..."}
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
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
          {/* Quick Barcode Scan to Issue Card */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-500">
                  <Cpu size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 m-0">
                    {isThai
                      ? "จ่ายออกเหล็กม้วนเข้าเครื่องสลิต (Issue Coil to Machine)"
                      : "Issue Steel Coil to Machine"}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 m-0">
                    {isThai
                      ? "สแกนบาร์โค้ดม้วนเหล็กที่เตรียมเบิกไว้ หรือเลือกกดจ่ายออกจากรายการด้านล่าง"
                      : "Scan coil barcode to issue or confirm from staged coils below"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {SLITTING_MACHINES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setIssueMachineId(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border cursor-pointer transition-all ${
                      issueMachineId === m
                        ? "bg-blue-600 text-white border-blue-500 shadow-xs"
                        : "bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={(e) => handleIssueByScan(e)} className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Barcode size={15} className="absolute left-3 top-2.5 text-blue-500" />
                <input
                  type="text"
                  value={issueScanInput}
                  onChange={(e) => setIssueScanInput(e.target.value)}
                  placeholder={
                    isThai
                      ? `สแกนบาร์โค้ดเหล็กม้วนเพื่อตัดจ่ายเข้าเครื่อง ${issueMachineId}...`
                      : `Scan coil barcode to issue to ${issueMachineId}...`
                  }
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-xs font-mono font-bold border border-blue-400 dark:border-blue-700 bg-white dark:bg-[#0c1930]"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsCameraOpen(true)}
                className="px-3 py-2 rounded-lg text-xs font-bold bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 flex items-center gap-1.5 cursor-pointer"
              >
                <Camera size={14} />
                <span>{isThai ? "กล้องสแกน" : "Camera"}</span>
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs font-extrabold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 size={14} />
                <span>{isThai ? `ตัดจ่ายเข้า ${issueMachineId}` : `Issue to ${issueMachineId}`}</span>
              </button>
            </form>
          </div>

          {/* Staged Coils Waiting for Issue */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                {isThai
                  ? `รายการเหล็กม้วนที่เตรียมเบิกรอจ่ายออก (${stagedCoils.length} ม้วน)`
                  : `Staged Coils Ready for Issue (${stagedCoils.length})`}
              </span>
              <select
                value={issueOrderFilter}
                onChange={(e) => setIssueOrderFilter(e.target.value)}
                className="px-2.5 py-1 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
              >
                <option value="ALL">{isThai ? "ทุกเครื่องจักร (All Machines)" : "All Machines"}</option>
                {SLITTING_MACHINES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>{isThai ? "ใบเตรียมเบิก" : "Staging Order"}</th>
                    <th>{isThai ? "เครื่องจักร" : "Machine"}</th>
                    <th>Batch / Coil No.</th>
                    <th>{isThai ? "เกรด & ขนาด" : "Spec"}</th>
                    <th>{isThai ? "น้ำหนัก (kg)" : "Weight"}</th>
                    <th>{isThai ? "จาก Layout" : "Layout"}</th>
                    <th>{isThai ? "ยืนยันจ่ายออก" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(stagedCoils.length > 0 ? stagedCoils : availableCoils.slice(0, 10))
                    .filter((c) =>
                      issueOrderFilter === "ALL"
                        ? true
                        : (c.stagedMachineId || issueMachineId) === issueOrderFilter
                    )
                    .map((c) => {
                      const parentOrd = stagingOrders.find((o) =>
                        o.items.some((i) => i.batch.toUpperCase() === c.batch.toUpperCase())
                      );
                      return (
                        <tr key={c.id}>
                          <td className="font-mono font-bold text-amber-400">
                            {c.stagedOrderNo || parentOrd?.orderNo || (isThai ? "เบิกด่วน (Direct)" : "Direct")}
                          </td>
                          <td className="font-bold text-sky-400">
                            {c.stagedMachineId || parentOrd?.machineId || issueMachineId}
                          </td>
                          <td>
                            <span className="code font-mono font-bold">{c.batch}</span>
                            <div className="text-[10px] text-slate-400">{c.coilNo}</div>
                          </td>
                          <td>
                            <span className="font-bold">{c.grade}</span> • {c.certThickness} x {c.width} mm
                          </td>
                          <td className="font-mono font-bold">
                            {Number(c.weightKg).toLocaleString()} kg
                          </td>
                          <td className="font-mono">{c.location}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() =>
                                handleIssueCoil(
                                  c,
                                  c.stagedMachineId || parentOrd?.machineId || issueMachineId,
                                  parentOrd || null
                                )
                              }
                              className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Check size={12} />
                              <span>{isThai ? "ยืนยันจ่ายออก" : "Confirm Issue"}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {stagedCoils.length === 0 && availableCoils.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-slate-400">
                        {isThai
                          ? "ไม่มีม้วนเหล็กที่รอจ่ายออก"
                          : "No staged or available coils to issue."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
                  <ArrowUpRight size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 m-0">
                    {isThai
                      ? "เตรียมเบิกเหล็กม้วน (-เตรียมเบิก / Coil Staging)"
                      : "Prepare / Stage Steel Coils (-Staging)"}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 m-0">
                    {isThai
                      ? "บันทึกใบเตรียมเบิกลง Collection: coil_staging และล็อกสถานะม้วนเป็น Staged"
                      : "Saves staging orders to coil_staging collection"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {SLITTING_MACHINES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setStagingMachineId(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border cursor-pointer transition-all ${
                      stagingMachineId === m
                        ? "bg-amber-600 text-white border-amber-500 shadow-xs"
                        : "bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={(e) => handleStageByScan(e)} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  {isThai ? "เลขที่ใบสั่งเตรียมเบิก (Order No.)" : "Staging Order No."}
                </label>
                <input
                  type="text"
                  value={stagingOrderNoInput}
                  onChange={(e) => setStagingOrderNoInput(e.target.value)}
                  placeholder={`เช่น ORD-${stagingMachineId}-001 (เว้นว่างสร้างอัตโนมัติ)`}
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                  {isThai ? "สแกนบาร์โค้ดม้วนเหล็กเพื่อเตรียมเบิกด่วน" : "Scan Coil Barcode to Stage"}
                </label>
                <input
                  type="text"
                  value={stagingScanInput}
                  onChange={(e) => setStagingScanInput(e.target.value)}
                  placeholder={isThai ? "สแกนรหัส Batch..." : "Scan Batch..."}
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono font-bold border border-amber-400 dark:border-amber-700 bg-white dark:bg-[#0c1930]"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 px-3 rounded-lg text-xs font-extrabold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
                >
                  {isThai ? "สแกนเข้าเตรียมเบิก" : "Stage Scanned Coil"}
                </button>
                {selectedCoilIdsForStaging.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCreateStagingFromSelection}
                    className="py-2 px-3 rounded-lg text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                  >
                    {isThai
                      ? `ยืนยันเตรียมเบิกที่เลือก (${selectedCoilIdsForStaging.length})`
                      : `Stage Selected (${selectedCoilIdsForStaging.length})`}
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Select Available Coils to Stage */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                {isThai
                  ? `เลือกเหล็กม้วนพร้อมใช้จากสต๊อกเพื่อเตรียมเบิก (${availableCoils.length} ม้วน)`
                  : `Available Coils in Stock (${availableCoils.length})`}
              </span>
              {selectedCoilIdsForStaging.length > 0 && (
                <button
                  type="button"
                  onClick={handleCreateStagingFromSelection}
                  className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold cursor-pointer"
                >
                  {isThai
                    ? `+ สร้างใบเตรียมเบิก (${selectedCoilIdsForStaging.length} ม้วน)`
                    : `+ Stage (${selectedCoilIdsForStaging.length})`}
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="w-10 text-center">เลือก</th>
                    <th>Batch / Barcode</th>
                    <th>Coil No.</th>
                    <th>{isThai ? "เกรด & ขนาด" : "Spec"}</th>
                    <th>{isThai ? "น้ำหนัก (kg)" : "Weight"}</th>
                    <th>Layout</th>
                    <th>{isThai ? "เตรียมเบิกทันที" : "Quick Stage"}</th>
                  </tr>
                </thead>
                <tbody>
                  {availableCoils.slice(0, 30).map((c) => {
                    const checked = selectedCoilIdsForStaging.includes(c.id);
                    return (
                      <tr key={c.id}>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedCoilIdsForStaging((prev) =>
                                checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                              )
                            }
                          />
                        </td>
                        <td>
                          <span className="code font-mono font-bold">{c.batch}</span>
                        </td>
                        <td className="font-mono">{c.coilNo}</td>
                        <td>
                          <span className="font-bold">{c.grade}</span> • {c.certThickness} x {c.width} mm
                        </td>
                        <td className="font-mono font-bold">
                          {Number(c.weightKg).toLocaleString()} kg
                        </td>
                        <td className="font-mono font-bold text-sky-400">{c.location}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleStageByScan(undefined, c.batch)}
                            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-bold text-[11px] cursor-pointer"
                          >
                            {isThai ? `เตรียมเบิก -> ${stagingMachineId}` : `Stage -> ${stagingMachineId}`}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {availableCoils.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-400">
                        {isThai ? "ไม่มีเหล็กม้วนสถานะพร้อมเบิกในสต๊อก" : "No available coils in stock."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Active Staging Orders List */}
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-2.5">
            <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-100 m-0">
              {isThai
                ? `ใบเตรียมเบิกเหล็กม้วนทั้งหมด (${stagingOrders.length} ใบ)`
                : `Coil Staging Orders (${stagingOrders.length})`}
            </h3>
            {stagingOrders.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">
                {isThai ? "ยังไม่มีใบเตรียมเบิกเหล็กม้วน" : "No staging orders created yet."}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {stagingOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/60 dark:bg-[#0c1930] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-extrabold text-xs text-amber-400">
                          {ord.orderNo}
                        </span>
                        <span className="ml-2 px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10.5px] font-bold">
                          {ord.machineId}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setActiveMode("operator_receive")}
                          className="px-2 py-1 rounded bg-blue-600 text-white text-[10.5px] font-bold cursor-pointer"
                        >
                          {isThai ? "ไปหน้าจ่ายออก" : "Go to Issue"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCoilStagingOrderFromCloud(ord)}
                          className="p-1 rounded hover:bg-red-500/20 text-red-400 cursor-pointer"
                          title={isThai ? "ยกเลิกใบเตรียมเบิก" : "Delete Staging Order"}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {ord.createdDate} {ord.createdAt} • {ord.items.length} {isThai ? "ม้วน" : "coils"}
                    </div>
                    <div className="space-y-1">
                      {ord.items.map((itm) => (
                        <div
                          key={itm.id}
                          className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-white dark:bg-[#111e38] border border-slate-200/60 dark:border-[#1e3a5f]"
                        >
                          <span className="font-mono font-bold text-sky-400">{itm.batch}</span>
                          <span>
                            {itm.grade} ({itm.thickness}x{itm.width}) • {Number(itm.weightKg).toLocaleString()} kg
                          </span>
                          <span
                            className={`font-bold ${
                              itm.status === "issued" ? "text-emerald-400" : "text-amber-400"
                            }`}
                          >
                            {itm.status === "issued"
                              ? isThai
                                ? "จ่ายออกแล้ว"
                                : "Issued"
                              : isThai
                              ? "พร้อมจ่าย"
                              : "Staged"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
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
          {/* Bay Capacity Overview Grid (from coil_layouts) */}
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
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                />
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
            <div className="p-3 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder={
                    isThai
                      ? "ค้นหาด้วย Batch, Coil No., เกรด, ขนาด, ผู้ผลิต, Location..."
                      : "Search Batch, Coil No., Grade, Location..."
                  }
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                />
              </div>

              <select
                value={stockStatusFilter}
                onChange={(e) =>
                  setStockStatusFilter(e.target.value as typeof stockStatusFilter)
                }
                className="px-2.5 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
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
                className="px-2.5 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
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
                className="px-2.5 py-1.5 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
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
                className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-cyan-600 hover:bg-cyan-500 text-white inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
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
                    <th>{isThai ? "จัดการด่วน" : "Actions"}</th>
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
                      <td>
                        <div className="flex items-center gap-1">
                          {c.status === "available" && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStageByScan(undefined, c.batch)}
                                className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold text-[10.5px] cursor-pointer"
                              >
                                {isThai ? "-เตรียมเบิก" : "Stage"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleIssueCoil(c)}
                                className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold text-[10.5px] cursor-pointer"
                              >
                                {isThai ? "จ่ายออก" : "Issue"}
                              </button>
                            </>
                          )}
                          {c.status !== "available" && (
                            <button
                              type="button"
                              onClick={() => returnCoilToStockInCloud(c)}
                              className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10.5px] cursor-pointer inline-flex items-center gap-1"
                            >
                              <RotateCcw size={11} />
                              <span>{isThai ? "คืนสต๊อก" : "Return"}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => deleteCoilStockFromCloud(c.id)}
                            className="p-1 rounded hover:bg-red-500/20 text-red-400 cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {filteredStockRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-slate-400">
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

      {/* Camera Barcode Scanner Modal */}
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
                  setIssueScanInput(code);
                  handleIssueByScan(undefined, code);
                } else if (activeMode === "outbound") {
                  setStagingScanInput(code);
                  handleStageByScan(undefined, code);
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
