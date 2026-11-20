import React, { useState, useEffect, useMemo, useRef } from "react";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import {
  Layers,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRightLeft,
  Cpu,
  Package,
  Search,
  RotateCcw,
  Trash2,
  CheckCircle2,
  FileSpreadsheet,
  MapPin,
  Camera,
  Barcode,
  Volume2,
  VolumeX,
  ClipboardList,
  X,
  Factory,
  Database,
  Building2,
  Info,
  Clock,
  ScanLine,
  BarChart3,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";
import { cleanBarcode } from "../utils/barcodeUtils";
import { showToast } from "../utils/swalUtils";
import { useLanguage } from "../contexts/LanguageContext";
import { formatNowTimestamp } from "../services/coilDataService";
import {
  RmModeTab,
  RmInboundCategory,
  RmInternalSubMode,
  RmStockRecord,
  RmTransactionRecord,
  RmStagingOrder,
  RmLayoutZone,
  RmSapMasterItem,
  RM_INTERNAL_MACHINES,
  RM_SAP_CHUNK_SIZE,
  subscribeToRmStock,
  subscribeToRmTransactions,
  subscribeToRmStaging,
  subscribeToRmLayouts,
  subscribeToRmSapChunks,
  saveRmInboundToCloud,
  deleteRmStockFromCloud,
  relocateRmStockInCloud,
  saveRmSapChunksToCloud,
  clearRmSapChunksFromCloud,
} from "../services/rmDataService";

interface RmSheetManagementProps {
  activeMode?: RmModeTab;
  onModeChange?: (mode: RmModeTab) => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
  onStockSummaryChange?: (records: RmStockRecord[]) => void;
}

const STICKY_RM_LOCATION_KEY = "tmt_wms_rm_sticky_location_v1";

// ============================================================================
// Helper: Parse SAP Master Text / Table for RM Steel Sheet
// Supports 13-column SAP Batch Stock table:
// Storage Location | Material No. | Discription | Batch | หนา Certificated. | กว้าง | ยาว | Grade | Unrestricted | ผู้ผลิต | Sales Document | Item | Text สภาพสินค้า
// And Bundle (BAHCH HU / BATCH HU) SAP exports
// ============================================================================
function parseRmSapMasterText(
  rawText: string,
  defaultType: "batch" | "bundle" = "batch"
): RmSapMasterItem[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText
    .split(/\r?\n/)
    .filter((l) => l.replace(/\s+/g, "").length > 0);
  if (lines.length === 0) return [];

  const results: RmSapMasterItem[] = [];
  let headerMap: Record<string, number> | null = null;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].replace(/\r$/, "");
    const cols = line.includes("\t")
      ? line.split("\t").map((c) => c.trim())
      : line
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map((c) => c.replace(/^"|"$/g, "").trim());

    if (cols.length < 2) continue;

    const lowerLine = line.toLowerCase();
    const isHeaderRow =
      lowerLine.includes("material") ||
      lowerLine.includes("storage location") ||
      lowerLine.includes("certificated") ||
      lowerLine.includes("unrestr") ||
      lowerLine.includes("sales document") ||
      lowerLine.includes("สภาพสินค้า") ||
      lowerLine.includes("bahch hu") ||
      lowerLine.includes("batch hu") ||
      (lowerLine.includes("batch") &&
        (lowerLine.includes("grade") || lowerLine.includes("กว้าง")));

    if (isHeaderRow && !headerMap) {
      headerMap = {};
      cols.forEach((colName, idx) => {
        const c = colName.toLowerCase().trim();
        if (c.includes("storage") || c === "sloc" || c.includes("คลัง")) {
          headerMap!["storageLocation"] = idx;
        } else if (
          (c.includes("material") && !c.includes("desc")) ||
          c === "mat." ||
          c === "รหัสสินค้า"
        ) {
          if (headerMap!["materialNo"] === undefined) headerMap!["materialNo"] = idx;
        } else if (
          c.includes("description") ||
          c.includes("discription") ||
          c.includes("รายการ") ||
          c.includes("รายละเอียด")
        ) {
          headerMap!["description"] = idx;
        } else if (
          c.includes("bahch hu") ||
          c.includes("batch hu") ||
          c === "hu" ||
          c.includes("handling unit")
        ) {
          headerMap!["batchHu"] = idx;
        } else if (c === "batch" || (c.includes("batch") && !c.includes("hu"))) {
          headerMap!["batch"] = idx;
        } else if (c.includes("หนา") || c.includes("thick") || c.includes("cert")) {
          if (headerMap!["certThickness"] === undefined) headerMap!["certThickness"] = idx;
        } else if (c.includes("กว้าง") || c.includes("width")) {
          headerMap!["width"] = idx;
        } else if (c.includes("ยาว") || c.includes("length")) {
          headerMap!["length"] = idx;
        } else if (c.includes("grade") || c.includes("เกรด")) {
          headerMap!["grade"] = idx;
        } else if (
          c.includes("unrestr") ||
          c.includes("น้ำหนัก") ||
          c.includes("weight")
        ) {
          headerMap!["unrestricted"] = idx;
        } else if (c.includes("จำนวน") || c.includes("qty") || c.includes("แผ่น")) {
          headerMap!["inboundQty"] = idx;
        } else if (
          c.includes("ผู้ผลิต") ||
          c.includes("manufacturer") ||
          c.includes("maker") ||
          c.includes("vendor")
        ) {
          headerMap!["manufacturer"] = idx;
        } else if (c.includes("sales document") || c.includes("sales doc") || c === "so") {
          headerMap!["salesDocument"] = idx;
        } else if (c === "item" || c.includes("sales item")) {
          headerMap!["salesItem"] = idx;
        } else if (c.includes("สภาพสินค้า") || c.includes("text")) {
          headerMap!["conditionText"] = idx;
        } else if (c === "location" || c.includes("สถานที่")) {
          if (headerMap!["storageLocation"] === undefined) headerMap!["storageLocation"] = idx;
        }
      });
      continue;
    }

    if (headerMap && Object.keys(headerMap).length >= 2) {
      const getCol = (key: string) =>
        headerMap![key] !== undefined && cols[headerMap![key]] !== undefined
          ? cols[headerMap![key]].trim()
          : "";

      const batchVal = getCol("batch").toUpperCase();
      const batchHuVal = getCol("batchHu").toUpperCase();
      if (!batchVal && !batchHuVal) continue;

      const rawUnrestr = getCol("unrestricted");
      const parsedWeight = parseFloat(rawUnrestr.replace(/,/g, "")) || 0;
      const rawQty = getCol("inboundQty");
      const parsedQty = parseFloat(rawQty.replace(/,/g, "")) || 1;
      const isBundleRow =
        defaultType === "bundle" || Boolean(batchHuVal) || headerMap["batchHu"] !== undefined;

      // Fallback positional reading for columns 9, 10, 11, 12 if standard 13-col Batch table
      const manufacturerVal =
        headerMap["manufacturer"] !== undefined
          ? getCol("manufacturer")
          : !isBundleRow && cols.length >= 10
          ? (cols[9] || "").trim()
          : "";
      const salesDocVal =
        headerMap["salesDocument"] !== undefined
          ? getCol("salesDocument")
          : !isBundleRow && cols.length >= 11
          ? (cols[10] || "").trim()
          : "";
      const salesItemVal =
        headerMap["salesItem"] !== undefined
          ? getCol("salesItem")
          : !isBundleRow && cols.length >= 12
          ? (cols[11] || "").trim()
          : "0";
      const conditionTextVal =
        headerMap["conditionText"] !== undefined
          ? getCol("conditionText")
          : !isBundleRow && cols.length >= 13
          ? (cols[12] || "").trim()
          : "";

      results.push({
        sapType: isBundleRow ? "bundle" : "batch",
        storageLocation: getCol("storageLocation") || "2A06",
        materialNo: getCol("materialNo") || "-",
        description: getCol("description") || "-",
        batch: batchVal || batchHuVal,
        batchHu: isBundleRow ? batchHuVal : "",
        certThickness: getCol("certThickness") || "-",
        width: getCol("width") || "-",
        length: getCol("length") || "-",
        grade: getCol("grade") || "-",
        unrestricted: rawUnrestr || (parsedWeight > 0 ? parsedWeight.toFixed(3) : "0.000"),
        weightKg: parsedWeight,
        inboundQty: parsedQty,
        manufacturer: manufacturerVal,
        salesDocument: salesDocVal,
        salesItem: salesItemVal !== "" ? salesItemVal : "0",
        conditionText: conditionTextVal,
      });
    } else {
      // Fallback positional parser matching standard 13-column SAP Batch layout:
      // 0: Storage Location | 1: Material No. | 2: Discription | 3: Batch | 4: หนา Certificated. |
      // 5: กว้าง | 6: ยาว | 7: Grade | 8: Unrestricted | 9: ผู้ผลิต | 10: Sales Document | 11: Item | 12: Text สภาพสินค้า
      if (defaultType === "batch" && cols.length >= 9) {
        const rawUnrestr = (cols[8] || "0").trim();
        const parsedWeight = parseFloat(rawUnrestr.replace(/,/g, "")) || 0;
        const batchVal = (cols[3] || "").trim().toUpperCase();
        if (!batchVal) continue;

        results.push({
          sapType: "batch",
          storageLocation: (cols[0] || "").trim() || "2A06",
          materialNo: (cols[1] || "").trim() || "-",
          description: (cols[2] || "").trim() || "-",
          batch: batchVal,
          batchHu: "",
          certThickness: (cols[4] || "").trim() || "-",
          width: (cols[5] || "").trim() || "-",
          length: (cols[6] || "").trim() || "-",
          grade: (cols[7] || "").trim() || "-",
          unrestricted: rawUnrestr || (parsedWeight > 0 ? parsedWeight.toFixed(3) : "0.000"),
          weightKg: parsedWeight,
          inboundQty: 1,
          manufacturer: (cols[9] ?? "").trim(),
          salesDocument: (cols[10] ?? "").trim(),
          salesItem:
            cols[11] !== undefined && cols[11].trim() !== "" ? cols[11].trim() : "0",
          conditionText: (cols[12] ?? "").trim(),
        });
      } else if (cols.length >= 5) {
        // 6-column Bundle layout:
        // Location | Batch | BAHCH HU | จำนวนรับเข้า | น้ำหนักรับเข้า | Material Description
        const batchVal = (cols[1] || "").trim().toUpperCase();
        const batchHuVal = (cols[2] || "").trim().toUpperCase();
        if (!batchVal && !batchHuVal) continue;
        const parsedQty = parseFloat((cols[3] || "1").replace(/,/g, "")) || 1;
        const rawWeight = (cols[4] || "0").trim();
        const parsedWeight = parseFloat(rawWeight.replace(/,/g, "")) || 0;

        results.push({
          sapType: "bundle",
          storageLocation: (cols[0] || "").trim() || "1101",
          materialNo: "-",
          description: (cols[5] || "").trim() || "-",
          batch: batchVal || batchHuVal,
          batchHu: batchHuVal || batchVal,
          certThickness: "-",
          width: "-",
          length: "-",
          grade: "-",
          unrestricted: rawWeight || (parsedWeight > 0 ? parsedWeight.toLocaleString() : "0"),
          weightKg: parsedWeight,
          inboundQty: parsedQty,
          manufacturer: "",
          salesDocument: "",
          salesItem: "0",
          conditionText: "",
        });
      }
    }
  }

  return results;
}

export const RmSheetManagement: React.FC<RmSheetManagementProps> = ({
  activeMode: externalMode,
  onModeChange,
  onLogTransaction,
  onStockSummaryChange,
}) => {
  const { language } = useLanguage();
  const isThai = language === "th";

  const [internalMode, setInternalMode] = useState<RmModeTab>("inbound");
  const activeMode = externalMode ?? internalMode;
  const setActiveMode = (mode: RmModeTab) => {
    setInternalMode(mode);
    onModeChange?.(mode);
  };

  // ============================================================================
  // Audio Feedback (Web Audio API Beep)
  // ============================================================================
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const playBeep = (type: "success" | "warning" | "error") => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === "success") {
        osc.frequency.value = 1046.5;
        gain.gain.value = 0.14;
        osc.start();
        osc.stop(ctx.currentTime + 0.11);
      } else if (type === "warning") {
        osc.frequency.value = 587.33;
        gain.gain.value = 0.16;
        osc.start();
        osc.stop(ctx.currentTime + 0.22);
      } else {
        osc.frequency.value = 260;
        gain.gain.value = 0.2;
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {
      // ignore audio context error
    }
  };

  // ============================================================================
  // Real-time Firestore Data State
  // ============================================================================
  const [rmStock, setRmStock] = useState<RmStockRecord[]>([]);
  const [rmTransactions, setRmTransactions] = useState<RmTransactionRecord[]>([]);
  const [rmStagingOrders, setRmStagingOrders] = useState<RmStagingOrder[]>([]);
  const [rmLayouts, setRmLayouts] = useState<RmLayoutZone[]>([]);
  const [rmSapItems, setRmSapItems] = useState<RmSapMasterItem[]>([]);
  const [rmSapChunkCount, setRmSapChunkCount] = useState<number>(0);

  useEffect(() => {
    const unsubStock = subscribeToRmStock((records) => {
      setRmStock(records);
      onStockSummaryChange?.(records);
    });
    const unsubTx = subscribeToRmTransactions(setRmTransactions);
    const unsubStaging = subscribeToRmStaging(setRmStagingOrders);
    const unsubLayouts = subscribeToRmLayouts(setRmLayouts);
    const unsubSap = subscribeToRmSapChunks((items, chunkCount) => {
      setRmSapItems(items);
      setRmSapChunkCount(chunkCount);
    });
    return () => {
      unsubStock();
      unsubTx();
      unsubStaging();
      unsubLayouts();
      unsubSap();
    };
  }, []);

  // Build fast O(1) lookup maps by Batch AND by BATCH HU
  const { sapByBatch, sapByHu } = useMemo(() => {
    const byBatch = new Map<string, RmSapMasterItem>();
    const byHu = new Map<string, RmSapMasterItem>();
    rmSapItems.forEach((item) => {
      if (item.batch) {
        byBatch.set(item.batch.trim().toUpperCase(), item);
      }
      if (item.batchHu) {
        byHu.set(item.batchHu.trim().toUpperCase(), item);
      }
    });
    return { sapByBatch: byBatch, sapByHu: byHu };
  }, [rmSapItems]);

  // ============================================================================
  // Tab 1 State: +รับเข้า (Inbound)
  //   1. รับภายใน (Internal: CL03, CL04, CL05, CL06)
  //      - รับภายใน Batch (สแกนบาร์โค้ดจาก Batch)
  //      - รับภายใน Bundle (สแกนบาร์โค้ดจาก BAHCH HU)
  //   2. รับภายนอก (External)
  // ============================================================================
  const [inboundCategory, setInboundCategory] = useState<RmInboundCategory>("internal");
  const [internalSubMode, setInternalSubMode] = useState<RmInternalSubMode>("batch");
  const [inboundMachine, setInboundMachine] = useState<string>("CL03");
  const [inboundLocation, setInboundLocation] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(STICKY_RM_LOCATION_KEY) || "";
    }
    return "";
  });
  const [inboundBarcodeInput, setInboundBarcodeInput] = useState<string>("");
  const [bundleBatchInput, setBundleBatchInput] = useState<string>("");
  const [bundleQtyInput, setBundleQtyInput] = useState<string>("");
  const [bundleWeightInput, setBundleWeightInput] = useState<string>("");
  const [isInboundCameraOpen, setIsInboundCameraOpen] = useState<boolean>(false);
  const [cameraScanTarget, setCameraScanTarget] = useState<"location" | "barcode">("barcode");
  const [inboundSearch, setInboundSearch] = useState<string>("");
  const [lastScannedBanner, setLastScannedBanner] = useState<{
    type: "idle" | "success" | "warning" | "error";
    message: string;
    detail?: string;
  }>({
    type: "idle",
    message: "ระบุ Location แล้วสแกนบาร์โค้ด Batch หรือ BAHCH HU เพื่อรับเข้าคลังเหล็กแผ่น RM",
  });

  const locationInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && inboundLocation.trim()) {
      window.localStorage.setItem(STICKY_RM_LOCATION_KEY, inboundLocation.trim().toUpperCase());
    }
  }, [inboundLocation]);

  const focusBarcodeInput = () => {
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 60);
  };

  // ============================================================================
  // SAP Master Upload Modal State
  // ============================================================================
  const [isSapModalOpen, setIsSapModalOpen] = useState<boolean>(false);
  const [sapUploadType, setSapUploadType] = useState<"batch" | "bundle">("batch");
  const [sapRawText, setSapRawText] = useState<string>("");
  const [isSapSaving, setIsSapSaving] = useState<boolean>(false);
  const sapFileInputRef = useRef<HTMLInputElement | null>(null);

  const parsedSapPreview = useMemo(
    () => parseRmSapMasterText(sapRawText, sapUploadType),
    [sapRawText, sapUploadType]
  );

  // ============================================================================
  // Other Tabs State (Stock Search, Batch vs Bundle Table Toggle, Relocate, Return)
  // ============================================================================
  const [stockSearch, setStockSearch] = useState<string>("");
  const [stockTableType, setStockTableType] = useState<"batch" | "bundle">("batch");
  const [stockCompareFilter, setStockCompareFilter] = useState<
    "ALL" | "matched" | "unscanned" | "no_sap"
  >("ALL");
  const [relocateTargetLoc, setRelocateTargetLoc] = useState<string>("");
  const [relocateScanInput, setRelocateScanInput] = useState<string>("");
  const [selectedRelocateIds, setSelectedRelocateIds] = useState<string[]>([]);
  const [returnScanInput, setReturnScanInput] = useState<string>("");
  const [returnLocationInput, setReturnLocationInput] = useState<string>("");

  // ============================================================================
  // Inbound Scan Handler (Unlimited Barcode Length for Batch & BAHCH HU)
  // ============================================================================
  const handleInboundSubmit = async (
    e?: React.FormEvent,
    overrideBarcode?: string
  ) => {
    e?.preventDefault();

    const cleanLoc = inboundLocation.trim().toUpperCase();
    if (!cleanLoc) {
      playBeep("warning");
      showToast(
        isThai
          ? "กรุณาพิมพ์หรือสแกนรหัส Location จัดเก็บก่อนสแกนรับเข้า"
          : "Please enter or scan Storage Location first",
        "warning"
      );
      setLastScannedBanner({
        type: "warning",
        message: isThai
          ? "กรุณาพิมพ์หรือสแกนรหัส Location จัดเก็บก่อนสแกนบาร์โค้ดรับเข้า"
          : "Please enter or scan Location before scanning barcode",
      });
      locationInputRef.current?.focus();
      return;
    }

    const rawScanned = String(overrideBarcode ?? inboundBarcodeInput)
      .replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, "")
      .trim()
      .toUpperCase();

    if (!rawScanned) {
      playBeep("warning");
      showToast(
        isThai
          ? internalSubMode === "bundle" && inboundCategory === "internal"
            ? "กรุณาสแกนบาร์โค้ด BAHCH HU"
            : "กรุณาสแกนบาร์โค้ด Batch"
          : "Please scan barcode",
        "warning"
      );
      focusBarcodeInput();
      return;
    }

    const { timestamp } = formatNowTimestamp();
    const activeMachine = inboundCategory === "internal" ? inboundMachine : "EXTERNAL";
    const effectiveSubMode: RmInternalSubMode =
      inboundCategory === "internal" ? internalSubMode : "batch";

    // Clear barcode input immediately so operator can continue rapid scanning
    setInboundBarcodeInput("");
    focusBarcodeInput();

    if (effectiveSubMode === "bundle") {
      // ----------------------------------------------------------------------
      // โหมดรับภายใน Bundle: สแกนบาร์โค้ดจาก BAHCH HU ที่เครื่อง CL03, 04, 05, 06
      // ข้อมูลที่แสดง: Location | Batch | BAHCH HU | จำนวนรับเข้า | น้ำหนักรับเข้า | Material Description
      // ----------------------------------------------------------------------
      const scannedHu = rawScanned;
      const sapMatch = sapByHu.get(scannedHu) || sapByBatch.get(scannedHu);
      const existingRec = rmStock.find(
        (r) =>
          (r.batchHu && r.batchHu.toUpperCase() === scannedHu) ||
          r.id === `RM-HU-${scannedHu}`
      );

      const resolvedBatch =
        bundleBatchInput.trim().toUpperCase() ||
        sapMatch?.batch ||
        existingRec?.batch ||
        scannedHu;
      const resolvedQty =
        bundleQtyInput.trim() !== ""
          ? Number(bundleQtyInput) || 1
          : sapMatch && sapMatch.inboundQty > 0
          ? sapMatch.inboundQty
          : existingRec && existingRec.inboundQty > 0
          ? existingRec.inboundQty
          : 1;
      const resolvedWeight =
        bundleWeightInput.trim() !== ""
          ? Number(bundleWeightInput) || 0
          : sapMatch && sapMatch.weightKg > 0
          ? sapMatch.weightKg
          : existingRec && existingRec.weightKg > 0
          ? existingRec.weightKg
          : 0;
      const resolvedDesc =
        sapMatch?.description && sapMatch.description !== "-"
          ? sapMatch.description
          : existingRec?.description && existingRec.description !== "-"
          ? existingRec.description
          : "-";

      const saved = await saveRmInboundToCloud({
        id: `RM-HU-${scannedHu}`,
        inboundType: "internal",
        internalSubMode: "bundle",
        machine: activeMachine,
        location: cleanLoc,
        storageLocation: sapMatch?.storageLocation || existingRec?.storageLocation || "1101",
        materialNo: sapMatch?.materialNo || existingRec?.materialNo || "-",
        description: resolvedDesc,
        batch: resolvedBatch,
        batchHu: scannedHu,
        certThickness: sapMatch?.certThickness || existingRec?.certThickness || "-",
        width: sapMatch?.width || existingRec?.width || "-",
        length: sapMatch?.length || existingRec?.length || "-",
        grade: sapMatch?.grade || existingRec?.grade || "-",
        unrestricted:
          sapMatch?.unrestricted ||
          (resolvedWeight > 0 ? resolvedWeight.toLocaleString() : "0"),
        weightKg: resolvedWeight,
        initialWeightKg: resolvedWeight,
        inboundQty: resolvedQty,
        manufacturer: sapMatch?.manufacturer ?? existingRec?.manufacturer ?? "",
        salesDocument: sapMatch?.salesDocument ?? existingRec?.salesDocument ?? "",
        salesItem: sapMatch?.salesItem ?? existingRec?.salesItem ?? "0",
        conditionText: sapMatch?.conditionText ?? existingRec?.conditionText ?? "",
        status: "available",
        hasSapData: Boolean(sapMatch),
        scanTimestamp: timestamp,
        updatedAt: new Date().toISOString(),
      });

      playBeep("success");
      setLastScannedBanner({
        type: "success",
        message: isThai
          ? `รับภายใน Bundle สำเร็จ! เครื่อง ${activeMachine} • BAHCH HU: [${saved.batchHu}] -> Location: ${saved.location}`
          : `Bundle Inbound Saved! Machine ${activeMachine} • BAHCH HU: [${saved.batchHu}] -> ${saved.location}`,
        detail: isThai
          ? `Batch: ${saved.batch} • จำนวนรับเข้า: ${saved.inboundQty.toLocaleString()} • น้ำหนักรับเข้า: ${saved.weightKg.toLocaleString()} KG • ${saved.description}`
          : `Batch: ${saved.batch} • Qty: ${saved.inboundQty} • Weight: ${saved.weightKg} KG`,
      });
      showToast(
        isThai
          ? `รับเข้า Bundle BAHCH HU ${saved.batchHu} (${activeMachine}) -> ${saved.location}`
          : `Saved Bundle HU ${saved.batchHu} -> ${saved.location}`,
        "success"
      );
      onLogTransaction?.(
        `RM Internal Bundle Inbound HU ${saved.batchHu} (Batch ${saved.batch}) from ${activeMachine} -> ${saved.location}`,
        saved.batchHu,
        "Completed"
      );
    } else {
      // ----------------------------------------------------------------------
      // โหมดรับภายใน Batch (จากเครื่อง CL03, 04, 05, 06) หรือ รับภายนอก:
      // ข้อมูลที่แสดง: Storage Location | Material No. | Discription | Batch | หนา Certificated. | กว้าง | ยาว | Grade | Unrestr. | ผู้ผลิต
      // ----------------------------------------------------------------------
      const scannedBatch = rawScanned;
      const sapMatch = sapByBatch.get(scannedBatch) || sapByHu.get(scannedBatch);
      const existingRec = rmStock.find(
        (r) => r.batch.toUpperCase() === scannedBatch && r.internalSubMode === "batch"
      );

      const resolvedWeight =
        sapMatch && sapMatch.weightKg > 0
          ? sapMatch.weightKg
          : existingRec && existingRec.weightKg > 0
          ? existingRec.weightKg
          : 0;

      const saved = await saveRmInboundToCloud({
        id: `RM-BATCH-${scannedBatch}`,
        inboundType: inboundCategory,
        internalSubMode: "batch",
        machine: activeMachine,
        location: cleanLoc,
        storageLocation:
          sapMatch?.storageLocation || existingRec?.storageLocation || "2A06",
        materialNo: sapMatch?.materialNo || existingRec?.materialNo || "-",
        description: sapMatch?.description || existingRec?.description || "-",
        batch: scannedBatch,
        batchHu: sapMatch?.batchHu || existingRec?.batchHu || "",
        certThickness: sapMatch?.certThickness || existingRec?.certThickness || "-",
        width: sapMatch?.width || existingRec?.width || "-",
        length: sapMatch?.length || existingRec?.length || "-",
        grade: sapMatch?.grade || existingRec?.grade || "-",
        unrestricted:
          sapMatch?.unrestricted ||
          existingRec?.unrestricted ||
          (resolvedWeight > 0 ? resolvedWeight.toFixed(3) : "0.000"),
        weightKg: resolvedWeight,
        initialWeightKg: resolvedWeight,
        inboundQty: sapMatch?.inboundQty || existingRec?.inboundQty || 1,
        manufacturer: sapMatch?.manufacturer ?? existingRec?.manufacturer ?? "",
        salesDocument: sapMatch?.salesDocument ?? existingRec?.salesDocument ?? "",
        salesItem: sapMatch?.salesItem ?? existingRec?.salesItem ?? "0",
        conditionText: sapMatch?.conditionText ?? existingRec?.conditionText ?? "",
        status: "available",
        hasSapData: Boolean(sapMatch),
        scanTimestamp: timestamp,
        updatedAt: new Date().toISOString(),
      });

      playBeep("success");
      setLastScannedBanner({
        type: "success",
        message: isThai
          ? `${
              inboundCategory === "internal"
                ? `รับภายใน Batch สำเร็จ! เครื่อง ${activeMachine}`
                : "รับภายนอกสำเร็จ!"
            } • Batch: [${saved.batch}] -> Location: ${saved.location}`
          : `Inbound Batch [${saved.batch}] saved to ${saved.location}`,
        detail: isThai
          ? `Mat: ${saved.materialNo} • ขนาด: ${saved.certThickness} x ${saved.width} x ${saved.length} • Grade: ${saved.grade} • Unrestr.: ${saved.unrestricted} • ผู้ผลิต: ${saved.manufacturer || "-"}`
          : `Spec: ${saved.certThickness}x${saved.width}x${saved.length} • Grade: ${saved.grade}`,
      });
      showToast(
        isThai
          ? `รับเข้า Batch ${saved.batch} -> Location ${saved.location} สำเร็จ`
          : `Inbound Batch ${saved.batch} -> ${saved.location}`,
        "success"
      );
      onLogTransaction?.(
        `RM ${inboundCategory === "internal" ? `Internal (${activeMachine})` : "External"} Batch Inbound ${saved.batch} -> ${saved.location}`,
        saved.batch,
        "Completed"
      );
    }
  };

  // ============================================================================
  // SAP Excel / CSV File Upload & Paste Import Handlers
  // ============================================================================
  const handleSapFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) return;
      const ws = wb.Sheets[firstSheetName];
      const tsv = XLSX.utils.sheet_to_csv(ws, { FS: "\t" });
      setSapRawText(tsv);
      showToast(
        isThai
          ? `อ่านไฟล์ ${file.name} สำเร็จ`
          : `Loaded ${file.name}`,
        "info"
      );
    } catch {
      showToast(
        isThai ? "ไม่สามารถอ่านไฟล์ Excel/CSV ได้" : "Failed to read file",
        "error"
      );
    } finally {
      if (sapFileInputRef.current) sapFileInputRef.current.value = "";
    }
  };

  const handleConfirmSapImport = async () => {
    if (parsedSapPreview.length === 0) {
      showToast(
        isThai ? "ไม่พบข้อมูล SAP ในตารางที่วาง" : "No valid SAP rows found",
        "warning"
      );
      return;
    }
    setIsSapSaving(true);
    try {
      // Keep items of the OTHER sapType so Batch and Bundle SAP uploads don't overwrite each other
      const preservedOtherItems = rmSapItems.filter((item) => {
        const itemType = item.sapType || (item.batchHu ? "bundle" : "batch");
        return itemType !== sapUploadType;
      });
      const combinedSapItems = [...preservedOtherItems, ...parsedSapPreview];
      await saveRmSapChunksToCloud(combinedSapItems);
      playBeep("success");
      showToast(
        isThai
          ? `อัปโหลดสต๊อก SAP ${sapUploadType === "batch" ? "Batch" : "Bundle"} (${parsedSapPreview.length.toLocaleString()} รายการ) สำเร็จ!`
          : `Uploaded ${parsedSapPreview.length.toLocaleString()} SAP items!`,
        "success"
      );
      setIsSapModalOpen(false);
      setSapRawText("");
    } finally {
      setIsSapSaving(false);
    }
  };

  // ============================================================================
  // Filtered Records for Inbound Tables
  // ============================================================================
  const filteredInternalBatchRecords = useMemo(() => {
    const q = inboundSearch.trim().toLowerCase();
    return rmStock.filter((r) => {
      if (r.inboundType !== "internal" || r.internalSubMode !== "batch") return false;
      if (!q) return true;
      return `${r.storageLocation} ${r.location} ${r.materialNo} ${r.description} ${r.batch} ${r.grade} ${r.manufacturer} ${r.machine}`
        .toLowerCase()
        .includes(q);
    });
  }, [rmStock, inboundSearch]);

  const filteredInternalBundleRecords = useMemo(() => {
    const q = inboundSearch.trim().toLowerCase();
    return rmStock.filter((r) => {
      if (r.inboundType !== "internal" || r.internalSubMode !== "bundle") return false;
      if (!q) return true;
      return `${r.location} ${r.batch} ${r.batchHu} ${r.description} ${r.machine}`
        .toLowerCase()
        .includes(q);
    });
  }, [rmStock, inboundSearch]);

  const filteredExternalRecords = useMemo(() => {
    const q = inboundSearch.trim().toLowerCase();
    return rmStock.filter((r) => {
      if (r.inboundType !== "external") return false;
      if (!q) return true;
      return `${r.storageLocation} ${r.location} ${r.materialNo} ${r.description} ${r.batch} ${r.grade} ${r.manufacturer}`
        .toLowerCase()
        .includes(q);
    });
  }, [rmStock, inboundSearch]);

  // ============================================================================
  // SAP vs Scanned Comparison Datasets for หน้า "สต๊อก" (Batch vs Bundle)
  // ============================================================================
  const batchStockComparison = useMemo(() => {
    const sapBatchItems = rmSapItems.filter(
      (i) => (i.sapType || (i.batchHu ? "bundle" : "batch")) === "batch"
    );
    const scannedBatchMap = new Map<string, RmStockRecord>();
    rmStock.forEach((r) => {
      if (r.internalSubMode !== "bundle" && r.status !== "issued" && r.batch) {
        scannedBatchMap.set(r.batch.trim().toUpperCase(), r);
      }
    });

    const seenBatches = new Set<string>();
    const rows: Array<{
      key: string;
      compareStatus: "matched" | "unscanned" | "no_sap";
      scannedLocation: string;
      machine: string;
      storageLocation: string;
      materialNo: string;
      description: string;
      batch: string;
      certThickness: string;
      width: string;
      length: string;
      grade: string;
      unrestricted: string;
      manufacturer: string;
      salesDocument: string;
      salesItem: string;
      conditionText: string;
    }> = [];

    // 1. All SAP Batch rows (Matched if scanned, Unscanned if not scanned yet)
    sapBatchItems.forEach((sap, idx) => {
      const normBatch = (sap.batch || "").trim().toUpperCase();
      if (!normBatch) return;
      seenBatches.add(normBatch);
      const scanned = scannedBatchMap.get(normBatch);
      rows.push({
        key: `SAP-BATCH-${normBatch}-${idx}`,
        compareStatus: scanned ? "matched" : "unscanned",
        scannedLocation: scanned?.location || "",
        machine: scanned?.machine || "",
        storageLocation: sap.storageLocation || scanned?.storageLocation || "2A06",
        materialNo: sap.materialNo || scanned?.materialNo || "-",
        description: sap.description || scanned?.description || "-",
        batch: normBatch,
        certThickness: sap.certThickness || scanned?.certThickness || "-",
        width: sap.width || scanned?.width || "-",
        length: sap.length || scanned?.length || "-",
        grade: sap.grade || scanned?.grade || "-",
        unrestricted:
          sap.unrestricted ||
          scanned?.unrestricted ||
          (sap.weightKg ? sap.weightKg.toFixed(3) : "0.000"),
        manufacturer: sap.manufacturer ?? scanned?.manufacturer ?? "",
        salesDocument: sap.salesDocument ?? scanned?.salesDocument ?? "",
        salesItem: sap.salesItem ?? scanned?.salesItem ?? "0",
        conditionText: sap.conditionText ?? scanned?.conditionText ?? "",
      });
    });

    // 2. Scanned Batch rows that are NOT in SAP Batch table
    rmStock.forEach((r) => {
      if (r.internalSubMode === "bundle" || r.status === "issued") return;
      const normBatch = (r.batch || "").trim().toUpperCase();
      if (!normBatch || seenBatches.has(normBatch)) return;
      seenBatches.add(normBatch);
      rows.push({
        key: `SCAN-BATCH-${r.id}`,
        compareStatus: r.hasSapData ? "matched" : "no_sap",
        scannedLocation: r.location || "-",
        machine: r.machine || "",
        storageLocation: r.storageLocation || "-",
        materialNo: r.materialNo || "-",
        description: r.description || "-",
        batch: normBatch,
        certThickness: r.certThickness || "-",
        width: r.width || "-",
        length: r.length || "-",
        grade: r.grade || "-",
        unrestricted: r.unrestricted || (r.weightKg ? r.weightKg.toFixed(3) : "0.000"),
        manufacturer: r.manufacturer && r.manufacturer !== "-" ? r.manufacturer : "",
        salesDocument: r.salesDocument ?? "",
        salesItem: r.salesItem ?? "0",
        conditionText: r.conditionText ?? "",
      });
    });

    return rows;
  }, [rmSapItems, rmStock]);

  const filteredBatchStockComparison = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    return batchStockComparison.filter((r) => {
      if (stockCompareFilter !== "ALL" && r.compareStatus !== stockCompareFilter) {
        return false;
      }
      if (!q) return true;
      return `${r.scannedLocation} ${r.storageLocation} ${r.materialNo} ${r.description} ${r.batch} ${r.grade} ${r.manufacturer} ${r.salesDocument} ${r.conditionText}`
        .toLowerCase()
        .includes(q);
    });
  }, [batchStockComparison, stockSearch, stockCompareFilter]);

  const bundleStockComparison = useMemo(() => {
    const sapBundleItems = rmSapItems.filter(
      (i) => (i.sapType || (i.batchHu ? "bundle" : "batch")) === "bundle"
    );
    const scannedBundleMap = new Map<string, RmStockRecord>();
    rmStock.forEach((r) => {
      if (r.internalSubMode === "bundle" && r.status !== "issued") {
        const key = (r.batchHu || r.batch || "").trim().toUpperCase();
        if (key) scannedBundleMap.set(key, r);
      }
    });

    const seenHus = new Set<string>();
    const rows: Array<{
      key: string;
      compareStatus: "matched" | "unscanned" | "no_sap";
      scannedLocation: string;
      machine: string;
      batch: string;
      batchHu: string;
      inboundQty: number;
      weightKg: number;
      description: string;
    }> = [];

    sapBundleItems.forEach((sap, idx) => {
      const normHu = (sap.batchHu || sap.batch || "").trim().toUpperCase();
      if (!normHu) return;
      seenHus.add(normHu);
      const scanned = scannedBundleMap.get(normHu);
      rows.push({
        key: `SAP-BUNDLE-${normHu}-${idx}`,
        compareStatus: scanned ? "matched" : "unscanned",
        scannedLocation: scanned?.location || "",
        machine: scanned?.machine || "",
        batch: sap.batch || scanned?.batch || normHu,
        batchHu: normHu,
        inboundQty: scanned?.inboundQty || sap.inboundQty || 1,
        weightKg: scanned?.weightKg || sap.weightKg || 0,
        description: sap.description || scanned?.description || "-",
      });
    });

    rmStock.forEach((r) => {
      if (r.internalSubMode !== "bundle" || r.status === "issued") return;
      const normHu = (r.batchHu || r.batch || "").trim().toUpperCase();
      if (!normHu || seenHus.has(normHu)) return;
      seenHus.add(normHu);
      rows.push({
        key: `SCAN-BUNDLE-${r.id}`,
        compareStatus: r.hasSapData ? "matched" : "no_sap",
        scannedLocation: r.location || "-",
        machine: r.machine || "",
        batch: r.batch || normHu,
        batchHu: normHu,
        inboundQty: r.inboundQty || 1,
        weightKg: r.weightKg || 0,
        description: r.description || "-",
      });
    });

    return rows;
  }, [rmSapItems, rmStock]);

  const filteredBundleStockComparison = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    return bundleStockComparison.filter((r) => {
      if (stockCompareFilter !== "ALL" && r.compareStatus !== stockCompareFilter) {
        return false;
      }
      if (!q) return true;
      return `${r.scannedLocation} ${r.machine} ${r.batch} ${r.batchHu} ${r.description}`
        .toLowerCase()
        .includes(q);
    });
  }, [bundleStockComparison, stockSearch, stockCompareFilter]);

  const totalActiveWeightKg = useMemo(
    () =>
      rmStock
        .filter((r) => r.status !== "issued")
        .reduce((acc, r) => acc + (Number(r.weightKg) || 0), 0),
    [rmStock]
  );

  // ============================================================================
  // Navigation Tabs (All 7 Standard Tabs matching Coil & Slit/Film)
  // ============================================================================
  const RM_MODE_TABS: Array<{
    id: RmModeTab;
    labelTh: string;
    labelEn: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    badgeCount?: number;
  }> = [
    {
      id: "inbound",
      labelTh: "+ รับเข้า",
      labelEn: "+ Inbound",
      icon: ArrowDownRight,
    },
    {
      id: "outbound",
      labelTh: "- เตรียมเบิก",
      labelEn: "- Staging",
      icon: ArrowUpRight,
      badgeCount: rmStagingOrders.length,
    },
    {
      id: "operator_receive",
      labelTh: "จ่ายออก",
      labelEn: "Issue",
      icon: Cpu,
    },
    {
      id: "relocate_layout",
      labelTh: "ย้าย Layout",
      labelEn: "Relocate Layout",
      icon: ArrowRightLeft,
    },
    {
      id: "stock_balance",
      labelTh: "สต๊อก",
      labelEn: "Stock Balance",
      icon: Package,
      badgeCount: rmStock.filter((r) => r.status !== "issued").length,
    },
    {
      id: "return_warehouse",
      labelTh: "คืนคลัง",
      labelEn: "Return",
      icon: RotateCcw,
    },
    {
      id: "daily_report",
      labelTh: "รายงาน",
      labelEn: "Daily Report",
      icon: BarChart3,
    },
  ];

  const activeTabMeta =
    RM_MODE_TABS.find((t) => t.id === activeMode) || RM_MODE_TABS[0];

  return (
    <div className="space-y-3">
      {/* Top Bar */}
      <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-3.5 py-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
              <Layers size={17} />
            </div>
            <h1 className="text-sm font-extrabold text-slate-900 dark:text-white m-0">
              {isThai ? "เหล็กแผ่น RM" : "RM Steel Sheet"}
            </h1>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300">
              {isThai ? activeTabMeta.labelTh : activeTabMeta.labelEn}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSapModalOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-cyan-600 hover:bg-cyan-500 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Database size={14} />
              <span>
                {isThai
                  ? `อัปโหลด SAP (${rmSapItems.length.toLocaleString()})`
                  : `SAP (${rmSapItems.length.toLocaleString()})`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              {soundEnabled ? (
                <Volume2 size={14} className="text-emerald-500" />
              ) : (
                <VolumeX size={14} className="text-slate-400" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          TAB 1: + รับเข้า
         ===================================================================== */}
      {activeMode === "inbound" && (
        <div className="space-y-3">
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-3.5 shadow-xs space-y-3">
            {/* Inbound Category: รับภายใน / รับภายนอก */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setInboundCategory("internal")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                    inboundCategory === "internal"
                      ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                      : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                  }`}
                >
                  <Factory size={14} />
                  <span>{isThai ? "รับภายใน" : "Internal"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setInboundCategory("external")}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                    inboundCategory === "external"
                      ? "bg-blue-600 text-white border-blue-500 shadow-xs"
                      : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                  }`}
                >
                  <Building2 size={14} />
                  <span>{isThai ? "รับภายนอก" : "External"}</span>
                </button>
              </div>

              {inboundCategory === "internal" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setInternalSubMode("batch");
                      focusBarcodeInput();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      internalSubMode === "batch"
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                        : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    <Barcode size={14} />
                    <span>{isThai ? "รับภายใน Batch" : "Batch"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setInternalSubMode("bundle");
                      focusBarcodeInput();
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      internalSubMode === "bundle"
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                        : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    <ScanLine size={14} />
                    <span>{isThai ? "รับภายใน Bundle" : "Bundle"}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Machine Selector: CL03, CL04, CL05, CL06 */}
            {inboundCategory === "internal" && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                  {isThai ? "เครื่องจักร:" : "Machine:"}
                </span>
                <div className="grid grid-cols-4 gap-1.5 flex-1 max-w-md">
                  {RM_INTERNAL_MACHINES.map((mId) => {
                    const isSelected = inboundMachine === mId;
                    return (
                      <button
                        key={mId}
                        type="button"
                        onClick={() => {
                          setInboundMachine(mId);
                          focusBarcodeInput();
                        }}
                        className={`py-1.5 px-2.5 rounded-lg border text-center font-mono font-extrabold text-xs transition-all cursor-pointer ${
                          isSelected
                            ? internalSubMode === "bundle"
                              ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                              : "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                            : "bg-slate-50 dark:bg-[#0c1930] text-slate-800 dark:text-slate-100 border-slate-200 dark:border-[#1e3a5f]"
                        }`}
                      >
                        {mId}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Camera Barcode Scanner Box (Top-most when opened) */}
            {isInboundCameraOpen && (
              <div className="rounded-xl overflow-hidden border-2 border-emerald-500/60 bg-slate-950">
                <CameraBarcodeScanner
                  isThai={isThai}
                  barcodeOnly={true}
                  placeholderText={
                    cameraScanTarget === "location"
                      ? "Location"
                      : internalSubMode === "bundle" && inboundCategory === "internal"
                      ? "BAHCH HU"
                      : "Batch"
                  }
                  onClose={() => setIsInboundCameraOpen(false)}
                  onScan={(decodedText) => {
                    const cleaned = String(decodedText || "")
                      .replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, "")
                      .trim()
                      .toUpperCase();
                    if (!cleaned) return;
                    setIsInboundCameraOpen(false);
                    if (cameraScanTarget === "location") {
                      setInboundLocation(cleaned);
                      playBeep("success");
                      focusBarcodeInput();
                    } else {
                      setInboundBarcodeInput(cleaned);
                      handleInboundSubmit(undefined, cleaned);
                    }
                  }}
                />
              </div>
            )}

            {/* Location & Barcode Form */}
            <form onSubmit={(e) => handleInboundSubmit(e)} className="space-y-2.5">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                {/* Location Input */}
                <div className="md:col-span-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                      <MapPin size={13} className="text-emerald-500" />
                      <span>Location</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setCameraScanTarget("location");
                        setIsInboundCameraOpen(true);
                      }}
                      className="text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Camera size={12} />
                      <span>{isThai ? "สแกน" : "Scan"}</span>
                    </button>
                  </div>

                  <div className="relative flex items-center">
                    <input
                      ref={locationInputRef}
                      type="text"
                      value={inboundLocation}
                      onChange={(e) => setInboundLocation(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (inboundLocation.trim()) {
                            playBeep("success");
                            focusBarcodeInput();
                          }
                        }
                      }}
                      placeholder="Location"
                      className="w-full pl-3 pr-8 py-2 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                    {inboundLocation && (
                      <button
                        type="button"
                        onClick={() => {
                          setInboundLocation("");
                          locationInputRef.current?.focus();
                        }}
                        className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Barcode Input */}
                <div className="md:col-span-8 space-y-1">
                  <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                    <Barcode
                      size={14}
                      className={
                        inboundCategory === "internal" && internalSubMode === "bundle"
                          ? "text-indigo-500"
                          : "text-emerald-500"
                      }
                    />
                    <span>
                      {inboundCategory === "internal" && internalSubMode === "bundle"
                        ? "BAHCH HU"
                        : "Batch"}
                    </span>
                  </label>

                  <div className="flex flex-wrap sm:flex-nowrap gap-2">
                    <input
                      ref={barcodeInputRef}
                      type="text"
                      value={inboundBarcodeInput}
                      onChange={(e) => setInboundBarcodeInput(e.target.value.toUpperCase())}
                      placeholder={
                        inboundCategory === "internal" && internalSubMode === "bundle"
                          ? "BAHCH HU"
                          : "Batch"
                      }
                      className="flex-1 min-w-[180px] px-3 py-2 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />

                    <button
                      type="button"
                      onClick={() => {
                        setCameraScanTarget("barcode");
                        setIsInboundCameraOpen((v) => !v);
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-extrabold bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Camera size={14} />
                      <span>
                        {inboundCategory === "internal" && internalSubMode === "bundle"
                          ? isThai
                            ? "สแกน BAHCH HU"
                            : "Scan HU"
                          : isThai
                          ? "สแกน Batch"
                          : "Scan Batch"}
                      </span>
                    </button>

                    <button
                      type="submit"
                      className={`px-4 py-2 rounded-lg text-xs font-extrabold text-white shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0 ${
                        inboundCategory === "internal" && internalSubMode === "bundle"
                          ? "bg-indigo-600 hover:bg-indigo-500"
                          : "bg-emerald-600 hover:bg-emerald-500"
                      }`}
                    >
                      <CheckCircle2 size={14} />
                      <span>{isThai ? "บันทึก" : "Save"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Bundle Optional Fields */}
              {inboundCategory === "internal" && internalSubMode === "bundle" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">
                      Batch
                    </label>
                    <input
                      type="text"
                      value={bundleBatchInput}
                      onChange={(e) => setBundleBatchInput(e.target.value.toUpperCase())}
                      placeholder="Batch"
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-mono border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">
                      {isThai ? "จำนวนรับเข้า" : "Qty"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={bundleQtyInput}
                      onChange={(e) => setBundleQtyInput(e.target.value)}
                      placeholder="1"
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-mono border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-0.5">
                      {isThai ? "น้ำหนักรับเข้า" : "Weight (KG)"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={bundleWeightInput}
                      onChange={(e) => setBundleWeightInput(e.target.value)}
                      placeholder="KG"
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-mono border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              )}
            </form>

            {/* Only show scan feedback banner after an actual scan event */}
            {lastScannedBanner.type !== "idle" && (
              <div
                className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                  lastScannedBanner.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    : lastScannedBanner.type === "warning"
                    ? "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300"
                    : "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300"
                }`}
              >
                <div className="font-extrabold flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="shrink-0" />
                  <span>{lastScannedBanner.message}</span>
                </div>
                {lastScannedBanner.detail && (
                  <span className="text-[11px] opacity-85 font-mono">
                    {lastScannedBanner.detail}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* =================================================================
              INBOUND DATA TABLES
             ================================================================= */}
          {inboundCategory === "internal" && internalSubMode === "batch" && (
            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  {isThai
                    ? `รับภายใน Batch (${filteredInternalBatchRecords.length})`
                    : `Internal Batch (${filteredInternalBatchRecords.length})`}
                </span>

                <div className="relative w-full sm:w-56">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={inboundSearch}
                    onChange={(e) => setInboundSearch(e.target.value)}
                    placeholder={isThai ? "ค้นหา..." : "Search..."}
                    className="w-full pl-8 pr-3 py-1 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>{isThai ? "เครื่อง" : "Machine"}</th>
                      <th>Location</th>
                      <th>Storage Location</th>
                      <th>Material No.</th>
                      <th>Discription</th>
                      <th>Batch</th>
                      <th>หนา Certificated.</th>
                      <th>กว้าง</th>
                      <th>ยาว</th>
                      <th>Grade</th>
                      <th className="text-right">Unrestr.</th>
                      <th>ผู้ผลิต</th>
                      <th className="text-center">{isThai ? "ลบ" : "Del"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInternalBatchRecords.slice(0, 100).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-mono font-extrabold text-[11px]">
                            {r.machine}
                          </span>
                        </td>
                        <td>
                          <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-mono font-extrabold text-[11px]">
                            {r.location}
                          </span>
                        </td>
                        <td className="font-mono font-bold">{r.storageLocation}</td>
                        <td className="font-mono text-sky-600 dark:text-sky-400">
                          {r.materialNo}
                        </td>
                        <td className="max-w-[240px] truncate" title={r.description}>
                          {r.description}
                        </td>
                        <td>
                          <span className="code font-mono font-extrabold text-emerald-600 dark:text-emerald-300">
                            {r.batch}
                          </span>
                        </td>
                        <td className="font-mono tabular-nums">{r.certThickness}</td>
                        <td className="font-mono tabular-nums">{r.width}</td>
                        <td className="font-mono tabular-nums">{r.length}</td>
                        <td className="font-bold">{r.grade}</td>
                        <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                          {r.unrestricted || Number(r.weightKg || 0).toLocaleString()}
                        </td>
                        <td>{r.manufacturer}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => deleteRmStockFromCloud(r.id)}
                            className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredInternalBatchRecords.length === 0 && (
                      <tr>
                        <td colSpan={13} className="text-center py-6 text-slate-400">
                          {isThai ? "ไม่มีข้อมูล" : "No records"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {inboundCategory === "internal" && internalSubMode === "bundle" && (
            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  {isThai
                    ? `รับภายใน Bundle (${filteredInternalBundleRecords.length})`
                    : `Internal Bundle (${filteredInternalBundleRecords.length})`}
                </span>

                <div className="relative w-full sm:w-56">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={inboundSearch}
                    onChange={(e) => setInboundSearch(e.target.value)}
                    placeholder={isThai ? "ค้นหา..." : "Search..."}
                    className="w-full pl-8 pr-3 py-1 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>{isThai ? "เครื่อง" : "Machine"}</th>
                      <th>Location</th>
                      <th>Batch</th>
                      <th>BAHCH HU</th>
                      <th className="text-right">จำนวนรับเข้า</th>
                      <th className="text-right">น้ำหนักรับเข้า</th>
                      <th>Material Description</th>
                      <th className="text-center">{isThai ? "ลบ" : "Del"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInternalBundleRecords.slice(0, 100).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-mono font-extrabold text-[11px]">
                            {r.machine}
                          </span>
                        </td>
                        <td>
                          <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-mono font-extrabold text-[11px]">
                            {r.location}
                          </span>
                        </td>
                        <td className="font-mono font-bold text-slate-700 dark:text-slate-200">
                          {r.batch}
                        </td>
                        <td>
                          <span className="code font-mono font-extrabold text-indigo-600 dark:text-indigo-300">
                            {r.batchHu || r.batch}
                          </span>
                        </td>
                        <td className="font-mono font-extrabold tabular-nums text-right">
                          {Number(r.inboundQty || 1).toLocaleString()}
                        </td>
                        <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                          {Number(r.weightKg || 0).toLocaleString()}
                        </td>
                        <td className="max-w-[280px] truncate" title={r.description}>
                          {r.description}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => deleteRmStockFromCloud(r.id)}
                            className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredInternalBundleRecords.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-6 text-slate-400">
                          {isThai ? "ไม่มีข้อมูล" : "No records"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {inboundCategory === "external" && (
            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  {isThai
                    ? `รับภายนอก (${filteredExternalRecords.length})`
                    : `External (${filteredExternalRecords.length})`}
                </span>

                <div className="relative w-full sm:w-56">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={inboundSearch}
                    onChange={(e) => setInboundSearch(e.target.value)}
                    placeholder={isThai ? "ค้นหา..." : "Search..."}
                    className="w-full pl-8 pr-3 py-1 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Storage Location</th>
                      <th>Material No.</th>
                      <th>Discription</th>
                      <th>Batch</th>
                      <th>หนา Certificated.</th>
                      <th>กว้าง</th>
                      <th>ยาว</th>
                      <th>Grade</th>
                      <th className="text-right">Unrestr.</th>
                      <th>ผู้ผลิต</th>
                      <th className="text-center">{isThai ? "ลบ" : "Del"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExternalRecords.slice(0, 100).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-mono font-extrabold text-[11px]">
                            {r.location}
                          </span>
                        </td>
                        <td className="font-mono font-bold">{r.storageLocation}</td>
                        <td className="font-mono text-sky-600 dark:text-sky-400">
                          {r.materialNo}
                        </td>
                        <td className="max-w-[240px] truncate">{r.description}</td>
                        <td>
                          <span className="code font-mono font-extrabold text-blue-600 dark:text-blue-300">
                            {r.batch}
                          </span>
                        </td>
                        <td className="font-mono tabular-nums">{r.certThickness}</td>
                        <td className="font-mono tabular-nums">{r.width}</td>
                        <td className="font-mono tabular-nums">{r.length}</td>
                        <td className="font-bold">{r.grade}</td>
                        <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                          {r.unrestricted || Number(r.weightKg || 0).toLocaleString()}
                        </td>
                        <td>{r.manufacturer}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => deleteRmStockFromCloud(r.id)}
                            className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredExternalRecords.length === 0 && (
                      <tr>
                        <td colSpan={12} className="text-center py-6 text-slate-400">
                          {isThai ? "ไม่มีข้อมูล" : "No records"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 2: - เตรียมเบิก
         ===================================================================== */}
      {activeMode === "outbound" && (
        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-5 shadow-xs text-center">
          <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 m-0">
            {isThai ? "เตรียมเบิก" : "Staging"}
          </h3>
        </div>
      )}

      {/* =====================================================================
          TAB 3: จ่ายออก
         ===================================================================== */}
      {activeMode === "operator_receive" && (
        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-5 shadow-xs text-center">
          <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 m-0">
            {isThai ? "จ่ายออก" : "Issue"}
          </h3>
        </div>
      )}

      {/* =====================================================================
          TAB 4: ย้าย Layout
         ===================================================================== */}
      {activeMode === "relocate_layout" && (
        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={15} className="text-purple-500" />
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              {isThai ? "ย้าย Layout" : "Relocate Layout"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              value={relocateTargetLoc}
              onChange={(e) => setRelocateTargetLoc(e.target.value.toUpperCase())}
              placeholder={isThai ? "Location ปลายทาง" : "Target Location"}
              className="px-3 py-2 rounded-lg text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={relocateScanInput}
              onChange={(e) => setRelocateScanInput(e.target.value.toUpperCase())}
              placeholder="Batch / BAHCH HU"
              className="px-3 py-2 rounded-lg text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={async () => {
                const code = relocateScanInput.trim().toUpperCase();
                const target = relocateTargetLoc.trim().toUpperCase();
                if (!target || !code) {
                  showToast(
                    isThai ? "ระบุ Location และรหัส" : "Enter location and barcode",
                    "warning"
                  );
                  return;
                }
                const match = rmStock.find(
                  (r) =>
                    r.batch.toUpperCase() === code ||
                    (r.batchHu && r.batchHu.toUpperCase() === code)
                );
                if (!match) {
                  showToast(isThai ? `ไม่พบรหัส ${code}` : `${code} not found`, "error");
                  return;
                }
                await relocateRmStockInCloud({
                  recordIds: [match.id],
                  targetLocation: target,
                });
                setRelocateScanInput("");
                playBeep("success");
                showToast(
                  isThai ? `ย้าย ${code} -> ${target}` : `Relocated ${code} -> ${target}`,
                  "success"
                );
              }}
              className="px-4 py-2 rounded-lg text-xs font-extrabold bg-purple-600 hover:bg-purple-500 text-white cursor-pointer"
            >
              {isThai ? "บันทึก" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 5: สต๊อก (แยกตาราง สต๊อก Batch และ สต๊อก Bundle ชัดเจน + เทียบสต๊อก SAP)
         ===================================================================== */}
      {activeMode === "stock_balance" && (
        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
          {/* Toolbar */}
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Toggle: สต๊อก Batch vs สต๊อก Bundle */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStockTableType("batch")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                    stockTableType === "batch"
                      ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                      : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                  }`}
                >
                  <Barcode size={14} />
                  <span>
                    {isThai
                      ? `สต๊อก Batch (${batchStockComparison.length})`
                      : `Batch Stock (${batchStockComparison.length})`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStockTableType("bundle")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                    stockTableType === "bundle"
                      ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                      : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                  }`}
                >
                  <ScanLine size={14} />
                  <span>
                    {isThai
                      ? `สต๊อก Bundle (${bundleStockComparison.length})`
                      : `Bundle Stock (${bundleStockComparison.length})`}
                  </span>
                </button>
              </div>

              {/* Comparison Status Filter */}
              <div className="flex items-center gap-1">
                {(
                  [
                    {
                      id: "ALL",
                      label: isThai ? "ทั้งหมด" : "All",
                      count:
                        stockTableType === "batch"
                          ? batchStockComparison.length
                          : bundleStockComparison.length,
                    },
                    {
                      id: "matched",
                      label: isThai ? "สแกนแล้ว" : "Scanned",
                      count: (stockTableType === "batch"
                        ? batchStockComparison
                        : bundleStockComparison
                      ).filter((r) => r.compareStatus === "matched").length,
                    },
                    {
                      id: "unscanned",
                      label: isThai ? "รอสแกน" : "Unscanned",
                      count: (stockTableType === "batch"
                        ? batchStockComparison
                        : bundleStockComparison
                      ).filter((r) => r.compareStatus === "unscanned").length,
                    },
                    {
                      id: "no_sap",
                      label: isThai ? "ไม่มีใน SAP" : "Not in SAP",
                      count: (stockTableType === "batch"
                        ? batchStockComparison
                        : bundleStockComparison
                      ).filter((r) => r.compareStatus === "no_sap").length,
                    },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStockCompareFilter(f.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                      stockCompareFilter === f.id
                        ? "bg-cyan-600 text-white border-cyan-500"
                        : "bg-slate-50 dark:bg-[#0c1930] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    {f.label} ({f.count})
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSapUploadType(stockTableType);
                  setIsSapModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-cyan-600 hover:bg-cyan-500 text-white shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet size={14} />
                <span>
                  {isThai
                    ? stockTableType === "batch"
                      ? "อัปโหลดสต๊อก SAP (Batch)"
                      : "อัปโหลดสต๊อก SAP (Bundle)"
                    : "Upload SAP Stock"}
                </span>
              </button>

              <div className="relative w-full sm:w-52">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder={isThai ? "ค้นหา..." : "Search..."}
                  className="w-full pl-8 pr-3 py-1 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* TABLE 1: สต๊อก Batch (13 คอลัมน์ตามตาราง SAP + สถานะ & Location ที่สแกน) */}
          {stockTableType === "batch" && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>{isThai ? "สถานะ" : "Status"}</th>
                    <th>Location</th>
                    <th>Storage Location</th>
                    <th>Material No.</th>
                    <th>Discription</th>
                    <th>Batch</th>
                    <th className="text-right">หนา Certificated.</th>
                    <th className="text-right">กว้าง</th>
                    <th className="text-right">ยาว</th>
                    <th>Grade</th>
                    <th className="text-right">Unrestricted</th>
                    <th>ผู้ผลิต</th>
                    <th>Sales Document</th>
                    <th className="text-center">Item</th>
                    <th>Text สภาพสินค้า</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBatchStockComparison.slice(0, 200).map((r) => (
                    <tr key={r.key}>
                      <td>
                        {r.compareStatus === "matched" ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-extrabold text-[11px] whitespace-nowrap">
                            {isThai ? "สแกนแล้ว" : "Scanned"}
                          </span>
                        ) : r.compareStatus === "unscanned" ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 font-extrabold text-[11px] whitespace-nowrap">
                            {isThai ? "รอสแกน" : "Unscanned"}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 font-extrabold text-[11px] whitespace-nowrap">
                            {isThai ? "ไม่มีใน SAP" : "No SAP"}
                          </span>
                        )}
                      </td>
                      <td>
                        {r.scannedLocation ? (
                          <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-mono font-extrabold text-[11px]">
                            {r.scannedLocation}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">-</span>
                        )}
                      </td>
                      <td className="font-mono font-bold">{r.storageLocation}</td>
                      <td className="font-mono text-sky-600 dark:text-sky-400">
                        {r.materialNo}
                      </td>
                      <td className="max-w-[260px] truncate" title={r.description}>
                        {r.description}
                      </td>
                      <td className="font-mono font-extrabold text-emerald-600 dark:text-emerald-300">
                        {r.batch}
                      </td>
                      <td className="font-mono tabular-nums text-right">{r.certThickness}</td>
                      <td className="font-mono tabular-nums text-right">{r.width}</td>
                      <td className="font-mono tabular-nums text-right">{r.length}</td>
                      <td className="font-bold">{r.grade}</td>
                      <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                        {r.unrestricted}
                      </td>
                      <td>{r.manufacturer}</td>
                      <td className="font-mono">{r.salesDocument}</td>
                      <td className="font-mono text-center">{r.salesItem}</td>
                      <td>{r.conditionText}</td>
                    </tr>
                  ))}
                  {filteredBatchStockComparison.length === 0 && (
                    <tr>
                      <td colSpan={15} className="text-center py-6 text-slate-400">
                        {isThai ? "ไม่มีข้อมูล" : "No records"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TABLE 2: สต๊อก Bundle (แยกจากตาราง สต๊อก Batch ชัดเจน) */}
          {stockTableType === "bundle" && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>{isThai ? "สถานะ" : "Status"}</th>
                    <th>Location</th>
                    <th>{isThai ? "เครื่อง" : "Machine"}</th>
                    <th>Batch</th>
                    <th>BAHCH HU</th>
                    <th className="text-right">จำนวนรับเข้า</th>
                    <th className="text-right">น้ำหนักรับเข้า</th>
                    <th>Material Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBundleStockComparison.slice(0, 200).map((r) => (
                    <tr key={r.key}>
                      <td>
                        {r.compareStatus === "matched" ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-extrabold text-[11px] whitespace-nowrap">
                            {isThai ? "สแกนแล้ว" : "Scanned"}
                          </span>
                        ) : r.compareStatus === "unscanned" ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 font-extrabold text-[11px] whitespace-nowrap">
                            {isThai ? "รอสแกน" : "Unscanned"}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 font-extrabold text-[11px] whitespace-nowrap">
                            {isThai ? "ไม่มีใน SAP" : "No SAP"}
                          </span>
                        )}
                      </td>
                      <td>
                        {r.scannedLocation ? (
                          <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-mono font-extrabold text-[11px]">
                            {r.scannedLocation}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono">-</span>
                        )}
                      </td>
                      <td className="font-mono font-bold">{r.machine || "-"}</td>
                      <td className="font-mono font-bold">{r.batch}</td>
                      <td className="font-mono font-extrabold text-indigo-600 dark:text-indigo-300">
                        {r.batchHu}
                      </td>
                      <td className="font-mono font-extrabold tabular-nums text-right">
                        {Number(r.inboundQty || 1).toLocaleString()}
                      </td>
                      <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                        {Number(r.weightKg || 0).toLocaleString()}
                      </td>
                      <td className="max-w-[280px] truncate" title={r.description}>
                        {r.description}
                      </td>
                    </tr>
                  ))}
                  {filteredBundleStockComparison.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-slate-400">
                        {isThai ? "ไม่มีข้อมูล" : "No records"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 6: คืนคลัง
         ===================================================================== */}
      {activeMode === "return_warehouse" && (
        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 shadow-xs space-y-3">
          <div className="flex items-center gap-2">
            <RotateCcw size={15} className="text-amber-500" />
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              {isThai ? "คืนคลัง" : "Return"}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              value={returnLocationInput}
              onChange={(e) => setReturnLocationInput(e.target.value.toUpperCase())}
              placeholder="Location"
              className="px-3 py-2 rounded-lg text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={returnScanInput}
              onChange={(e) => setReturnScanInput(e.target.value.toUpperCase())}
              placeholder="Batch / BAHCH HU"
              className="px-3 py-2 rounded-lg text-xs font-mono font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={async () => {
                if (!returnLocationInput.trim() || !returnScanInput.trim()) {
                  showToast(isThai ? "ระบุ Location และรหัส" : "Enter Location & Barcode", "warning");
                  return;
                }
                setInboundLocation(returnLocationInput.trim().toUpperCase());
                await handleInboundSubmit(undefined, returnScanInput.trim().toUpperCase());
                setReturnScanInput("");
              }}
              className="px-4 py-2 rounded-lg text-xs font-extrabold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
            >
              {isThai ? "บันทึก" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 7: รายงาน
         ===================================================================== */}
      {activeMode === "daily_report" && (
        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              {isThai
                ? `รายงาน (${rmTransactions.length})`
                : `Report (${rmTransactions.length})`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>{isThai ? "วัน-เวลา" : "Time"}</th>
                  <th>{isThai ? "ประเภท" : "Type"}</th>
                  <th>Batch</th>
                  <th>BAHCH HU</th>
                  <th>Location</th>
                  <th className="text-right">{isThai ? "จำนวน" : "Qty"}</th>
                  <th className="text-right">{isThai ? "น้ำหนัก" : "Weight"}</th>
                </tr>
              </thead>
              <tbody>
                {rmTransactions.slice(0, 80).map((tx) => (
                  <tr key={tx.id}>
                    <td className="font-mono text-[11px]">{tx.timestamp}</td>
                    <td className="font-bold text-emerald-500">{tx.txType.toUpperCase()}</td>
                    <td className="font-mono font-bold">{tx.batch}</td>
                    <td className="font-mono font-bold text-indigo-500">{tx.batchHu || "-"}</td>
                    <td className="font-mono">
                      {tx.fromLocation} → {tx.toLocation}
                    </td>
                    <td className="font-mono text-right">
                      {Number(tx.inboundQty || 1).toLocaleString()}
                    </td>
                    <td className="font-mono font-bold text-right">
                      {Number(tx.weightKg || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {rmTransactions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-slate-400">
                      {isThai ? "ไม่มีข้อมูล" : "No records"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: SAP MASTER UPLOAD / PASTE (แยก สต๊อก Batch 13 คอลัมน์ vs สต๊อก Bundle)
         ===================================================================== */}
      {isSapModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-cyan-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database size={16} />
                <h3 className="text-sm font-extrabold m-0">
                  {isThai
                    ? sapUploadType === "batch"
                      ? "อัปโหลดสต๊อก SAP (สต๊อก Batch)"
                      : "อัปโหลดสต๊อก SAP (สต๊อก Bundle)"
                    : "Upload SAP Stock"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSapModalOpen(false)}
                className="p-1 rounded-lg bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[84vh] overflow-y-auto">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* เลือกประเภทตาราง SAP ที่ต้องการอัปโหลด: สต๊อก Batch vs สต๊อก Bundle */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSapUploadType("batch")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      sapUploadType === "batch"
                        ? "bg-emerald-600 text-white border-emerald-500"
                        : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    <Barcode size={14} />
                    <span>{isThai ? "สต๊อก Batch" : "Batch Stock"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSapUploadType("bundle")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      sapUploadType === "bundle"
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    <ScanLine size={14} />
                    <span>{isThai ? "สต๊อก Bundle" : "Bundle Stock"}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={sapFileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.txt"
                    onChange={handleSapFileSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => sapFileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-300 dark:border-cyan-800 text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet size={14} />
                    <span>{isThai ? "เลือกไฟล์" : "Choose File"}</span>
                  </button>
                  {rmSapItems.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await clearRmSapChunksFromCloud();
                        showToast(isThai ? "ล้างข้อมูล SAP แล้ว" : "Cleared SAP", "info");
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>{isThai ? "ล้างข้อมูล" : "Clear"}</span>
                    </button>
                  )}
                </div>
              </div>

              <textarea
                rows={5}
                value={sapRawText}
                onChange={(e) => setSapRawText(e.target.value)}
                placeholder={
                  sapUploadType === "batch"
                    ? "Storage Location\tMaterial No.\tDiscription\tBatch\tหนา Certificated.\tกว้าง\tยาว\tGrade\tUnrestricted\tผู้ผลิต\tSales Document\tItem\tText สภาพสินค้า"
                    : "Location\tBatch\tBAHCH HU\tจำนวนรับเข้า\tน้ำหนักรับเข้า\tMaterial Description"
                }
                className="w-full p-3 rounded-xl text-xs font-mono border border-slate-300 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
              />

              {parsedSapPreview.length > 0 && (
                <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden">
                  <div className="px-3 py-1.5 bg-slate-100 dark:bg-[#0c1930] border-b border-slate-200 dark:border-[#1e3a5f] text-xs font-extrabold">
                    {isThai
                      ? `${parsedSapPreview.length.toLocaleString()} รายการ`
                      : `${parsedSapPreview.length.toLocaleString()} rows`}
                  </div>
                  <div className="max-h-56 overflow-auto">
                    {sapUploadType === "batch" ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <th>Storage Location</th>
                            <th>Material No.</th>
                            <th>Discription</th>
                            <th>Batch</th>
                            <th className="text-right">หนา Certificated.</th>
                            <th className="text-right">กว้าง</th>
                            <th className="text-right">ยาว</th>
                            <th>Grade</th>
                            <th className="text-right">Unrestricted</th>
                            <th>ผู้ผลิต</th>
                            <th>Sales Document</th>
                            <th className="text-center">Item</th>
                            <th>Text สภาพสินค้า</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedSapPreview.slice(0, 50).map((item, idx) => (
                            <tr key={`${item.batch}-${idx}`}>
                              <td className="font-mono">{item.storageLocation}</td>
                              <td className="font-mono">{item.materialNo}</td>
                              <td className="max-w-[220px] truncate">{item.description}</td>
                              <td className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {item.batch}
                              </td>
                              <td className="font-mono text-right">{item.certThickness}</td>
                              <td className="font-mono text-right">{item.width}</td>
                              <td className="font-mono text-right">{item.length}</td>
                              <td className="font-bold">{item.grade}</td>
                              <td className="font-mono font-bold text-right">
                                {item.unrestricted}
                              </td>
                              <td>{item.manufacturer}</td>
                              <td className="font-mono">{item.salesDocument}</td>
                              <td className="font-mono text-center">{item.salesItem}</td>
                              <td>{item.conditionText}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <th>Location</th>
                            <th>Batch</th>
                            <th>BAHCH HU</th>
                            <th className="text-right">จำนวนรับเข้า</th>
                            <th className="text-right">น้ำหนักรับเข้า</th>
                            <th>Material Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedSapPreview.slice(0, 50).map((item, idx) => (
                            <tr key={`${item.batch}-${item.batchHu}-${idx}`}>
                              <td className="font-mono">{item.storageLocation}</td>
                              <td className="font-mono font-bold">{item.batch}</td>
                              <td className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                {item.batchHu || item.batch}
                              </td>
                              <td className="font-mono text-right">{item.inboundQty}</td>
                              <td className="font-mono font-bold text-right">{item.unrestricted}</td>
                              <td className="max-w-[240px] truncate">{item.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsSapModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  {isThai ? "ปิด" : "Close"}
                </button>
                <button
                  type="button"
                  disabled={parsedSapPreview.length === 0 || isSapSaving}
                  onClick={handleConfirmSapImport}
                  className={`px-4 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 ${
                    parsedSapPreview.length > 0 && !isSapSaving
                      ? "bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer shadow-xs"
                      : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  <CheckCircle2 size={14} />
                  <span>{isThai ? "บันทึก" : "Save"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
