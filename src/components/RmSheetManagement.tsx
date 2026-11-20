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
  RmSapBatchCategory,
  RmSapCategory,
  RM_SAP_BATCH_CATEGORIES,
  RM_INTERNAL_MACHINES,
  RM_SAP_CHUNK_SIZE,
  subscribeToRmStock,
  subscribeToRmTransactions,
  subscribeToRmStaging,
  subscribeToRmLayouts,
  subscribeToRmMachines,
  subscribeToRmSapChunks,
  saveRmInboundToCloud,
  deleteRmStockFromCloud,
  relocateRmStockInCloud,
  saveRmSapChunksToCloud,
  clearRmSapChunksFromCloud,
  saveRmMachinesToCloud,
} from "../services/rmDataService";

interface RmSheetManagementProps {
  activeMode?: RmModeTab;
  onModeChange?: (mode: RmModeTab) => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
  onStockSummaryChange?: (records: RmStockRecord[]) => void;
}

const STICKY_RM_LOCATION_KEY = "tmt_wms_rm_sticky_location_v1";

// ============================================================================
// Formula Helpers for RM Steel Sheet:
// 1. น้ำหนัก (Weight) = จำนวน × หนา Certificated. × กว้าง × ยาว × 0.00000785
// 2. จำนวน (Quantity in Stock Table) = น้ำหนัก ÷ หนา Certificated. ÷ กว้าง ÷ ยาว ÷ 0.00000785
// 3. ความสูงของกอง (Stack Height) = จำนวน × หนา Certificated.
// ============================================================================
function calculateRmFormulaWeightKg(
  qty: number,
  certThickness: string | number | undefined,
  width: string | number | undefined,
  length: string | number | undefined
): number {
  const q = Number(qty) || 0;
  const t = parseFloat(String(certThickness ?? "0").replace(/,/g, "")) || 0;
  const w = parseFloat(String(width ?? "0").replace(/,/g, "")) || 0;
  const l = parseFloat(String(length ?? "0").replace(/,/g, "")) || 0;
  if (q <= 0 || t <= 0 || w <= 0 || l <= 0) return 0;
  return Number((q * t * w * l * 0.00000785).toFixed(3));
}

function calculateRmQtyFromWeightKg(
  weightKg: number,
  certThickness: string | number | undefined,
  width: string | number | undefined,
  length: string | number | undefined
): number {
  const weight = Number(weightKg) || 0;
  const t = parseFloat(String(certThickness ?? "0").replace(/,/g, "")) || 0;
  const w = parseFloat(String(width ?? "0").replace(/,/g, "")) || 0;
  const l = parseFloat(String(length ?? "0").replace(/,/g, "")) || 0;
  if (weight <= 0 || t <= 0 || w <= 0 || l <= 0) return 0;
  const rawQty = weight / t / w / l / 0.00000785;
  // Snap to integer if within 0.01 rounding tolerance of a whole sheet
  if (Math.abs(rawQty - Math.round(rawQty)) < 0.01) {
    return Math.round(rawQty);
  }
  return Number(rawQty.toFixed(2));
}

function resolveRmRowWeightKg(
  rawUnrestrOrWeight: number,
  certThickness: string | number | undefined,
  width: string | number | undefined,
  length: string | number | undefined
): number {
  const val = Number(rawUnrestrOrWeight) || 0;
  if (val <= 0) return 0;
  const unitSheetWeight = calculateRmFormulaWeightKg(1, certThickness, width, length);
  if (unitSheetWeight <= 0) return val;
  // If value is already a weight in KG (>= 90% of 1 sheet's weight, or has non-integer decimals, or val * unitSheetWeight > 25,000 KG)
  const isAlreadyWeightKg =
    val >= unitSheetWeight * 0.9 ||
    Math.abs(val - Math.round(val)) > 0.001 ||
    val * unitSheetWeight > 25000;
  if (isAlreadyWeightKg) {
    return Number(val.toFixed(3));
  }
  // Otherwise val is sheet count (e.g., 1.000, 30.000, 2.000) -> multiply by 1 sheet weight
  return Number((val * unitSheetWeight).toFixed(3));
}

// ความสูงของกอง (หน่วย: เมตร) = (จำนวน × หนา Certificated.) ÷ 1000
function calculateRmStackHeight(
  qty: number,
  certThickness: string | number | undefined
): number {
  const q = Number(qty) || 0;
  const t = parseFloat(String(certThickness ?? "0").replace(/,/g, "")) || 0;
  if (q <= 0 || t <= 0) return 0;
  return Number(((q * t) / 1000).toFixed(4));
}

// ============================================================================
// Helper: Parse SAP Master Text / Table for RM Steel Sheet
// Supports 13-column SAP Batch Stock table (Batch, VM, AB, STL, ฝาก):
// Storage Location | Material No. | Discription | Batch | หนา Certificated. | กว้าง | ยาว | Grade | Unrestricted (จำนวน) | ผู้ผลิต | Sales Document | Item | Text สภาพสินค้า
// And Bundle (BAHCH HU / BATCH HU) SAP exports
// ============================================================================
function parseRmSapMasterText(
  rawText: string,
  defaultType: "batch" | "bundle" = "batch",
  sapCategory: RmSapCategory = "Batch"
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
      const rawQty = getCol("inboundQty");
      const isBundleRow =
        defaultType === "bundle" || Boolean(batchHuVal) || headerMap["batchHu"] !== undefined;

      const certThicknessVal = getCol("certThickness") || "-";
      const widthVal = getCol("width") || "-";
      const lengthVal = getCol("length") || "-";

      // Resolve น้ำหนัก (weightKg) and จำนวน (qty = น้ำหนัก ÷ หนา Certificated. ÷ กว้าง ÷ ยาว ÷ 0.00000785)
      const parsedUnrestrNum = parseFloat(rawUnrestr.replace(/,/g, "")) || 0;
      const explicitQtyNum = parseFloat(rawQty.replace(/,/g, "")) || 0;
      const parsedWeight = isBundleRow
        ? parsedUnrestrNum
        : parsedUnrestrNum > 0
        ? resolveRmRowWeightKg(parsedUnrestrNum, certThicknessVal, widthVal, lengthVal)
        : explicitQtyNum > 0
        ? calculateRmFormulaWeightKg(explicitQtyNum, certThicknessVal, widthVal, lengthVal)
        : 0;
      const calculatedQty = !isBundleRow
        ? calculateRmQtyFromWeightKg(parsedWeight, certThicknessVal, widthVal, lengthVal)
        : explicitQtyNum || 1;
      const parsedQty = calculatedQty > 0 ? calculatedQty : explicitQtyNum || parsedUnrestrNum || 1;

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
        sapCategory: isBundleRow ? "Bundle" : sapCategory === "Bundle" ? "Batch" : sapCategory,
        storageLocation: getCol("storageLocation") || "2A06",
        materialNo: getCol("materialNo") || "-",
        description: getCol("description") || "-",
        batch: batchVal || batchHuVal,
        batchHu: isBundleRow ? batchHuVal : "",
        certThickness: certThicknessVal,
        width: widthVal,
        length: lengthVal,
        grade: getCol("grade") || "-",
        unrestricted:
          rawUnrestr || rawQty || (parsedWeight > 0 ? parsedWeight.toFixed(3) : "0.000"),
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
        const parsedUnrestrNum = parseFloat(rawUnrestr.replace(/,/g, "")) || 0;
        const batchVal = (cols[3] || "").trim().toUpperCase();
        if (!batchVal) continue;
        const certThicknessVal = (cols[4] || "").trim() || "-";
        const widthVal = (cols[5] || "").trim() || "-";
        const lengthVal = (cols[6] || "").trim() || "-";
        const resolvedWeight = resolveRmRowWeightKg(
          parsedUnrestrNum,
          certThicknessVal,
          widthVal,
          lengthVal
        );
        const calculatedQty =
          calculateRmQtyFromWeightKg(
            resolvedWeight,
            certThicknessVal,
            widthVal,
            lengthVal
          ) ||
          parsedUnrestrNum ||
          1;

        results.push({
          sapType: "batch",
          sapCategory: sapCategory === "Bundle" ? "Batch" : sapCategory,
          storageLocation: (cols[0] || "").trim() || "2A06",
          materialNo: (cols[1] || "").trim() || "-",
          description: (cols[2] || "").trim() || "-",
          batch: batchVal,
          batchHu: "",
          certThickness: certThicknessVal,
          width: widthVal,
          length: lengthVal,
          grade: (cols[7] || "").trim() || "-",
          unrestricted: rawUnrestr || (resolvedWeight > 0 ? resolvedWeight.toFixed(3) : "0.000"),
          weightKg: resolvedWeight,
          inboundQty: calculatedQty,
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
          sapCategory: "Bundle",
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
  const [rmMachines, setRmMachines] = useState<string[]>([...RM_INTERNAL_MACHINES]);
  const [isAddMachineOpen, setIsAddMachineOpen] = useState<boolean>(false);
  const [newMachineInput, setNewMachineInput] = useState<string>("");
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
    const unsubMachines = subscribeToRmMachines((list) => {
      setRmMachines(list);
    });
    const unsubSap = subscribeToRmSapChunks((items, chunkCount) => {
      setRmSapItems(items);
      setRmSapChunkCount(chunkCount);
    });
    return () => {
      unsubStock();
      unsubTx();
      unsubStaging();
      unsubLayouts();
      unsubMachines();
      unsubSap();
    };
  }, []);

  const handleAddMachine = async () => {
    const clean = newMachineInput
      .replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, "")
      .trim()
      .toUpperCase();
    if (!clean) {
      showToast(
        isThai ? "กรุณาระบุชื่อเครื่องจักร" : "Please enter machine name",
        "warning"
      );
      return;
    }
    if (rmMachines.includes(clean)) {
      setInboundMachine(clean);
      setNewMachineInput("");
      setIsAddMachineOpen(false);
      showToast(
        isThai ? `เลือกเครื่องจักร ${clean} แล้ว` : `Selected machine ${clean}`,
        "info"
      );
      return;
    }
    const nextList = [...rmMachines, clean];
    await saveRmMachinesToCloud(nextList);
    setInboundMachine(clean);
    setNewMachineInput("");
    setIsAddMachineOpen(false);
    playBeep("success");
    showToast(
      isThai
        ? `เพิ่มเครื่องจักร ${clean} สำเร็จ`
        : `Added machine ${clean}`,
      "success"
    );
    focusBarcodeInput();
  };

  const handleRemoveMachine = async (machineId: string) => {
    if (rmMachines.length <= 1) {
      showToast(
        isThai
          ? "ต้องมีเครื่องจักรอย่างน้อย 1 เครื่อง"
          : "At least 1 machine is required",
        "warning"
      );
      return;
    }
    const nextList = rmMachines.filter((m) => m !== machineId);
    await saveRmMachinesToCloud(nextList);
    if (inboundMachine === machineId && nextList.length > 0) {
      setInboundMachine(nextList[0]);
    }
    showToast(
      isThai ? `ลบเครื่องจักร ${machineId} แล้ว` : `Removed ${machineId}`,
      "info"
    );
  };

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
  //   1. รับภายใน (Internal: CL03, CL04, CL05, CL06 + เครื่องจักรที่เพิ่มเอง)
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
  const [inboundQtyInput, setInboundQtyInput] = useState<string>("");
  const [bundleBatchInput, setBundleBatchInput] = useState<string>("");
  const [externalVendorInput, setExternalVendorInput] = useState<string>("");
  const [externalQtyInput, setExternalQtyInput] = useState<string>("");
  const [externalWeightInput, setExternalWeightInput] = useState<string>("");
  const [isInboundCameraOpen, setIsInboundCameraOpen] = useState<boolean>(false);

  const knownExternalVendors = useMemo(() => {
    const set = new Set<string>();
    rmStock.forEach((r) => {
      if (r.manufacturer && r.manufacturer.trim() && r.manufacturer.trim() !== "-") {
        set.add(r.manufacturer.trim());
      }
    });
    rmSapItems.forEach((s) => {
      if (s.manufacturer && s.manufacturer.trim() && s.manufacturer.trim() !== "-") {
        set.add(s.manufacturer.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rmStock, rmSapItems]);
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
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const newMachineInputRef = useRef<HTMLInputElement | null>(null);

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

  // Helper: ตรวจสอบยอดคงเหลือปัจจุบันในหน้า "สต๊อก" สำหรับรหัส Batch ที่สแกน
  const getBatchCurrentStockInfo = (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      return {
        existsInStock: false,
        certThickness: "",
        width: "",
        length: "",
        grade: "-",
        description: "-",
        materialNo: "-",
        storageLocation: "2A06",
        existingQty: 0,
        existingWeightKg: 0,
        sapMatch: undefined as RmSapMasterItem | undefined,
        existingRec: undefined as RmStockRecord | undefined,
      };
    }

    const sapMatch = sapByBatch.get(code) || sapByHu.get(code);
    const existingRec = rmStock.find(
      (r) =>
        r.internalSubMode !== "bundle" &&
        r.status !== "issued" &&
        r.batch.trim().toUpperCase() === code
    );

    const certThickness =
      sapMatch?.certThickness || existingRec?.certThickness || "";
    const width = sapMatch?.width || existingRec?.width || "";
    const length = sapMatch?.length || existingRec?.length || "";

    const sapUnrestrNum =
      parseFloat(String(sapMatch?.unrestricted || "").replace(/,/g, "")) || 0;
    const sapResolvedWeight =
      sapUnrestrNum > 0
        ? resolveRmRowWeightKg(sapUnrestrNum, certThickness, width, length)
        : sapMatch && sapMatch.weightKg > 0
        ? resolveRmRowWeightKg(sapMatch.weightKg, certThickness, width, length)
        : 0;

    const scannedResolvedWeight =
      existingRec && existingRec.weightKg > 0
        ? resolveRmRowWeightKg(existingRec.weightKg, certThickness, width, length)
        : existingRec && existingRec.inboundQty > 0
        ? calculateRmFormulaWeightKg(
            existingRec.inboundQty,
            certThickness,
            width,
            length
          )
        : 0;

    const existingWeightKg =
      existingRec &&
      existingRec.inboundType === "internal" &&
      scannedResolvedWeight > 0
        ? scannedResolvedWeight
        : sapResolvedWeight > 0
        ? sapResolvedWeight
        : scannedResolvedWeight;

    const formulaExistingQty = calculateRmQtyFromWeightKg(
      existingWeightKg,
      certThickness,
      width,
      length
    );
    const existingQty =
      formulaExistingQty > 0
        ? formulaExistingQty
        : existingRec &&
          existingRec.inboundType === "internal" &&
          existingRec.inboundQty > 0
        ? existingRec.inboundQty
        : sapMatch?.inboundQty || existingRec?.inboundQty || sapUnrestrNum || 0;

    const existsInStock = Boolean(
      (existingRec && (existingWeightKg > 0 || existingQty > 0)) ||
        (sapMatch && (existingWeightKg > 0 || existingQty > 0))
    );

    return {
      existsInStock,
      certThickness,
      width,
      length,
      grade: sapMatch?.grade || existingRec?.grade || "-",
      description: sapMatch?.description || existingRec?.description || "-",
      materialNo: sapMatch?.materialNo || existingRec?.materialNo || "-",
      storageLocation:
        sapMatch?.storageLocation || existingRec?.storageLocation || "2A06",
      existingQty,
      existingWeightKg,
      sapMatch,
      existingRec,
    };
  };

  // Resolve active SAP/Stock spec & existing stock in หน้าสต๊อก for current typed/scanned barcode in รับภายใน form
  const activeInboundSpec = useMemo(() => {
    const code = inboundBarcodeInput.trim().toUpperCase();
    const bundleBatch = bundleBatchInput.trim().toUpperCase();
    const lookupCode =
      internalSubMode === "bundle" && bundleBatch ? bundleBatch : code;
    const stockInfo = getBatchCurrentStockInfo(lookupCode);
    return {
      sapMatch: stockInfo.sapMatch,
      existingRec: stockInfo.existingRec,
      certThickness: stockInfo.certThickness,
      width: stockInfo.width,
      length: stockInfo.length,
      existsInStock: stockInfo.existsInStock,
      existingQty: stockInfo.existingQty,
      existingWeightKg: stockInfo.existingWeightKg,
    };
  }, [inboundBarcodeInput, bundleBatchInput, internalSubMode, sapByBatch, sapByHu, rmStock]);

  const autoCalculatedInboundWeight = useMemo(() => {
    const qty = parseFloat(inboundQtyInput.replace(/,/g, "")) || 0;
    return calculateRmFormulaWeightKg(
      qty,
      activeInboundSpec.certThickness,
      activeInboundSpec.width,
      activeInboundSpec.length
    );
  }, [inboundQtyInput, activeInboundSpec]);

  // ============================================================================
  // SAP Master Upload Modal State
  // ============================================================================
  const [isSapModalOpen, setIsSapModalOpen] = useState<boolean>(false);
  const [sapUploadType, setSapUploadType] = useState<"batch" | "bundle">("batch");
  const [sapUploadCategory, setSapUploadCategory] = useState<RmSapCategory>("Batch");
  const [sapRawText, setSapRawText] = useState<string>("");
  const [isSapSaving, setIsSapSaving] = useState<boolean>(false);
  const sapFileInputRef = useRef<HTMLInputElement | null>(null);

  const parsedSapPreview = useMemo(
    () => parseRmSapMasterText(sapRawText, sapUploadType, sapUploadCategory),
    [sapRawText, sapUploadType, sapUploadCategory]
  );

  // ============================================================================
  // Other Tabs State (Stock Search, Batch vs Bundle Table Toggle, Relocate, Return)
  // ============================================================================
  const [stockSearch, setStockSearch] = useState<string>("");
  const [stockTableType, setStockTableType] = useState<"batch" | "bundle">("batch");
  const [stockBatchCategoryFilter, setStockBatchCategoryFilter] = useState<
    "ALL" | RmSapBatchCategory
  >("ALL");
  const [stockCompareFilter, setStockCompareFilter] = useState<
    "ALL" | "matched" | "unscanned" | "no_sap"
  >("ALL");
  const [stockPage, setStockPage] = useState<number>(1);
  const [stockPageSize, setStockPageSize] = useState<number>(20);
  const [internalBatchPage, setInternalBatchPage] = useState<number>(1);
  const [internalBatchPageSize, setInternalBatchPageSize] = useState<number>(20);
  const [relocateTargetLoc, setRelocateTargetLoc] = useState<string>("");
  const [relocateScanInput, setRelocateScanInput] = useState<string>("");
  const [selectedRelocateIds, setSelectedRelocateIds] = useState<string[]>([]);
  const [returnScanInput, setReturnScanInput] = useState<string>("");
  const [returnLocationInput, setReturnLocationInput] = useState<string>("");

  useEffect(() => {
    setStockPage(1);
  }, [
    stockTableType,
    stockBatchCategoryFilter,
    stockCompareFilter,
    stockSearch,
    stockPageSize,
  ]);

  useEffect(() => {
    setInternalBatchPage(1);
  }, [inboundSearch, internalBatchPageSize]);

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

    const parsedInputQty =
      inboundQtyInput.trim() !== ""
        ? parseFloat(inboundQtyInput.replace(/,/g, "")) || 1
        : 0;

    // Clear barcode input immediately so operator can continue rapid scanning
    setInboundBarcodeInput("");
    focusBarcodeInput();

    if (effectiveSubMode === "bundle") {
      // ----------------------------------------------------------------------
      // โหมดรับภายใน Bundle: สแกนบาร์โค้ดจาก BAHCH HU ที่เครื่อง CL03, 04, 05, 06
      // ข้อมูลที่แสดง: Location | Batch | BAHCH HU | จำนวนรับเข้า | น้ำหนักรับเข้า | Material Description
      // ----------------------------------------------------------------------
      const scannedHu = rawScanned;
      const cleanBundleBatch = bundleBatchInput.trim().toUpperCase();
      const sapMatch =
        sapByHu.get(scannedHu) ||
        sapByBatch.get(scannedHu) ||
        (cleanBundleBatch ? sapByBatch.get(cleanBundleBatch) : undefined);
      const existingRec = rmStock.find(
        (r) =>
          (r.batchHu && r.batchHu.toUpperCase() === scannedHu) ||
          r.id === `RM-HU-${scannedHu}` ||
          (cleanBundleBatch && r.batch.toUpperCase() === cleanBundleBatch)
      );

      const resolvedBatch =
        cleanBundleBatch ||
        sapMatch?.batch ||
        existingRec?.batch ||
        scannedHu;
      const resolvedQty =
        parsedInputQty > 0
          ? parsedInputQty
          : sapMatch && sapMatch.inboundQty > 0
          ? sapMatch.inboundQty
          : existingRec && existingRec.inboundQty > 0
          ? existingRec.inboundQty
          : 1;

      const formulaWeight = calculateRmFormulaWeightKg(
        resolvedQty,
        sapMatch?.certThickness || existingRec?.certThickness,
        sapMatch?.width || existingRec?.width,
        sapMatch?.length || existingRec?.length
      );

      const resolvedWeight =
        formulaWeight > 0
          ? formulaWeight
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
        sapCategory: "Bundle",
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
          (resolvedWeight > 0 ? resolvedWeight.toFixed(3) : "0.000"),
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
          ? `Batch: ${saved.batch} • จำนวน: ${saved.inboundQty.toLocaleString()} • น้ำหนักคำนวณ: ${saved.weightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} KG`
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
      // เมื่อสแกน Batch ในโหมด "รับภายใน Batch" ให้เช็คก่อนว่าในหน้า "สต๊อก" มีของเท่าไร
      // และนำจำนวน/น้ำหนักที่สแกนเพิ่มใหม่ไปบวกเพิ่ม (+) จากข้อมูลที่มีอยู่ในหน้า "สต๊อก"
      // ----------------------------------------------------------------------
      const scannedBatch = rawScanned;
      const stockInfo = getBatchCurrentStockInfo(scannedBatch);
      const { sapMatch, existingRec, existingQty, existingWeightKg } = stockInfo;

      const certThickness =
        sapMatch?.certThickness || existingRec?.certThickness || "-";
      const width = sapMatch?.width || existingRec?.width || "-";
      const length = sapMatch?.length || existingRec?.length || "-";

      if (inboundCategory === "internal") {
        // จำนวนที่สแกนรับเพิ่มในครั้งนี้
        const addedQty = parsedInputQty > 0 ? parsedInputQty : 1;
        const addedWeightKg = calculateRmFormulaWeightKg(
          addedQty,
          certThickness,
          width,
          length
        );

        // บวกเพิ่มจากข้อมูลที่มีอยู่ในหน้า "สต๊อก"
        const accumulatedWeightKg = Number(
          (existingWeightKg + addedWeightKg).toFixed(3)
        );
        const formulaTotalQty = calculateRmQtyFromWeightKg(
          accumulatedWeightKg,
          certThickness,
          width,
          length
        );
        const accumulatedQty =
          formulaTotalQty > 0
            ? formulaTotalQty
            : Number((existingQty + addedQty).toFixed(2));

        const saved = await saveRmInboundToCloud({
          id: `RM-BATCH-${scannedBatch}`,
          inboundType: "internal",
          internalSubMode: "batch",
          sapCategory: sapMatch?.sapCategory || existingRec?.sapCategory || "Batch",
          machine: activeMachine,
          location: cleanLoc,
          storageLocation:
            sapMatch?.storageLocation || existingRec?.storageLocation || "2A06",
          materialNo: sapMatch?.materialNo || existingRec?.materialNo || "-",
          description: sapMatch?.description || existingRec?.description || "-",
          batch: scannedBatch,
          batchHu: sapMatch?.batchHu || existingRec?.batchHu || "",
          certThickness,
          width,
          length,
          grade: sapMatch?.grade || existingRec?.grade || "-",
          unrestricted:
            accumulatedWeightKg > 0
              ? accumulatedWeightKg.toFixed(3)
              : accumulatedQty.toFixed(3),
          weightKg: accumulatedWeightKg,
          initialWeightKg:
            existingRec && existingRec.initialWeightKg > 0
              ? existingRec.initialWeightKg
              : existingWeightKg > 0
              ? existingWeightKg
              : accumulatedWeightKg,
          inboundQty: accumulatedQty,
          manufacturer: sapMatch?.manufacturer ?? existingRec?.manufacturer ?? "",
          salesDocument: sapMatch?.salesDocument ?? existingRec?.salesDocument ?? "",
          salesItem: sapMatch?.salesItem ?? existingRec?.salesItem ?? "0",
          conditionText: sapMatch?.conditionText ?? existingRec?.conditionText ?? "",
          status: "available",
          hasSapData: Boolean(sapMatch || existingRec?.hasSapData),
          scanTimestamp: timestamp,
          updatedAt: new Date().toISOString(),
        });

        playBeep("success");
        setLastScannedBanner({
          type: "success",
          message: isThai
            ? `รับภายใน Batch (${activeMachine}) • Batch: [${saved.batch}] -> Location: ${saved.location}`
            : `Internal Batch [${saved.batch}] saved to ${saved.location}`,
          detail: isThai
            ? `สต๊อกเดิม: ${existingQty.toLocaleString()} แผ่น (${existingWeightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} KG) + รับเพิ่ม: ${addedQty.toLocaleString()} แผ่น (${addedWeightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} KG) = รวมในสต๊อก: ${saved.inboundQty.toLocaleString()} แผ่น (${saved.weightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} KG)`
            : `Prev: ${existingQty} (${existingWeightKg} KG) + Added: ${addedQty} (${addedWeightKg} KG) = Total: ${saved.inboundQty} (${saved.weightKg} KG)`,
        });
        showToast(
          isThai
            ? `Batch ${saved.batch}: สต๊อกเดิม ${existingQty.toLocaleString()} + รับเพิ่ม ${addedQty.toLocaleString()} = รวม ${saved.inboundQty.toLocaleString()} แผ่น`
            : `Batch ${saved.batch}: ${existingQty} + ${addedQty} = ${saved.inboundQty}`,
          "success"
        );
        onLogTransaction?.(
          `RM Internal (${activeMachine}) Batch Inbound ${saved.batch} (+${addedQty} -> Total ${saved.inboundQty}) -> ${saved.location}`,
          saved.batch,
          "Completed"
        );
      } else {
        // โหมดรับภายนอก (รองรับระบุ Vendor, จำนวน, น้ำหนัก จากฟอร์ม)
        const cleanVendor = externalVendorInput.trim();
        const parsedExtQty =
          externalQtyInput.trim() !== ""
            ? parseFloat(externalQtyInput.replace(/,/g, "")) || 0
            : 0;
        const parsedExtWeight =
          externalWeightInput.trim() !== ""
            ? parseFloat(externalWeightInput.replace(/,/g, "")) || 0
            : 0;

        const formulaWeightFromExtQty =
          parsedExtQty > 0
            ? calculateRmFormulaWeightKg(parsedExtQty, certThickness, width, length)
            : 0;

        const resolvedWeight =
          parsedExtWeight > 0
            ? Number(parsedExtWeight.toFixed(3))
            : formulaWeightFromExtQty > 0
            ? formulaWeightFromExtQty
            : existingWeightKg > 0
            ? existingWeightKg
            : calculateRmFormulaWeightKg(1, certThickness, width, length);

        const resolvedQty =
          parsedExtQty > 0
            ? parsedExtQty
            : resolvedWeight > 0
            ? calculateRmQtyFromWeightKg(resolvedWeight, certThickness, width, length) ||
              existingQty ||
              1
            : existingQty > 0
            ? existingQty
            : 1;

        const resolvedVendor =
          cleanVendor || sapMatch?.manufacturer || existingRec?.manufacturer || "";

        const saved = await saveRmInboundToCloud({
          id: `RM-BATCH-${scannedBatch}`,
          inboundType: "external",
          internalSubMode: "batch",
          sapCategory: sapMatch?.sapCategory || existingRec?.sapCategory || "Batch",
          machine: activeMachine,
          location: cleanLoc,
          storageLocation:
            sapMatch?.storageLocation || existingRec?.storageLocation || "2A06",
          materialNo: sapMatch?.materialNo || existingRec?.materialNo || "-",
          description: sapMatch?.description || existingRec?.description || "-",
          batch: scannedBatch,
          batchHu: sapMatch?.batchHu || existingRec?.batchHu || "",
          certThickness,
          width,
          length,
          grade: sapMatch?.grade || existingRec?.grade || "-",
          unrestricted:
            resolvedWeight > 0
              ? resolvedWeight.toFixed(3)
              : sapMatch?.unrestricted || existingRec?.unrestricted || "1.000",
          weightKg: resolvedWeight,
          initialWeightKg: resolvedWeight,
          inboundQty: resolvedQty,
          manufacturer: resolvedVendor,
          salesDocument: sapMatch?.salesDocument ?? existingRec?.salesDocument ?? "",
          salesItem: sapMatch?.salesItem ?? existingRec?.salesItem ?? "0",
          conditionText: sapMatch?.conditionText ?? existingRec?.conditionText ?? "",
          status: "available",
          hasSapData: Boolean(sapMatch),
          scanTimestamp: timestamp,
          updatedAt: new Date().toISOString(),
        });

        setExternalQtyInput("");
        setExternalWeightInput("");

        playBeep("success");
        setLastScannedBanner({
          type: "success",
          message: isThai
            ? `รับภายนอกสำเร็จ! • Batch: [${saved.batch}] -> Location: ${saved.location}`
            : `External Inbound Batch [${saved.batch}] saved to ${saved.location}`,
          detail: isThai
            ? `${saved.manufacturer ? `Vendor: ${saved.manufacturer} • ` : ""}จำนวน: ${saved.inboundQty.toLocaleString()} แผ่น • น้ำหนัก: ${saved.weightKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} KG`
            : `${saved.manufacturer ? `Vendor: ${saved.manufacturer} • ` : ""}Qty: ${saved.inboundQty} • Weight: ${saved.weightKg} KG`,
        });
        showToast(
          isThai
            ? `รับภายนอก Batch ${saved.batch}${saved.manufacturer ? ` (${saved.manufacturer})` : ""} -> ${saved.location} สำเร็จ`
            : `External Batch ${saved.batch} -> ${saved.location}`,
          "success"
        );
        onLogTransaction?.(
          `RM External Batch Inbound ${saved.batch}${saved.manufacturer ? ` [Vendor: ${saved.manufacturer}]` : ""} (Qty: ${saved.inboundQty}, Weight: ${saved.weightKg} KG) -> ${saved.location}`,
          saved.batch,
          "Completed"
        );
      }
    }
  };

  // ============================================================================
  // SAP Excel / CSV File Upload & Paste Import Handlers
  // ============================================================================
  const openSapUploadModal = (category: RmSapCategory) => {
    setSapUploadCategory(category);
    setSapUploadType(category === "Bundle" ? "bundle" : "batch");
    setSapRawText("");
    setIsSapModalOpen(true);
  };

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

  const resolveSapItemCategory = (item: RmSapMasterItem): RmSapCategory => {
    if (item.sapCategory) return item.sapCategory;
    const itemType = item.sapType || (item.batchHu ? "bundle" : "batch");
    return itemType === "bundle" ? "Bundle" : "Batch";
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
      // Keep items of all OTHER sapCategories so Batch, VM, AB, STL, ฝาก, and Bundle uploads don't overwrite each other
      const preservedOtherItems = rmSapItems.filter(
        (item) => resolveSapItemCategory(item) !== sapUploadCategory
      );
      const combinedSapItems = [...preservedOtherItems, ...parsedSapPreview];
      await saveRmSapChunksToCloud(combinedSapItems);
      playBeep("success");
      showToast(
        isThai
          ? `อัปโหลดสต๊อก SAP (${sapUploadCategory}) จำนวน ${parsedSapPreview.length.toLocaleString()} รายการ สำเร็จ!`
          : `Uploaded ${parsedSapPreview.length.toLocaleString()} SAP (${sapUploadCategory}) items!`,
        "success"
      );
      setIsSapModalOpen(false);
      setSapRawText("");
    } finally {
      setIsSapSaving(false);
    }
  };

  // Count of uploaded SAP rows per category
  const sapCountByCategory = useMemo(() => {
    const counts: Record<RmSapCategory, number> = {
      Batch: 0,
      VM: 0,
      AB: 0,
      STL: 0,
      ฝาก: 0,
      Bundle: 0,
    };
    rmSapItems.forEach((item) => {
      const cat = resolveSapItemCategory(item);
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [rmSapItems]);

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
      sapCategory: RmSapBatchCategory;
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
      qtyDisplay: string;
      qtyNum: number;
      weightKg: number;
      stackHeight: number;
      manufacturer: string;
      salesDocument: string;
      salesItem: string;
      conditionText: string;
    }> = [];

    // 1. All SAP Batch rows (Batch, VM, AB, STL, ฝาก)
    sapBatchItems.forEach((sap, idx) => {
      const normBatch = (sap.batch || "").trim().toUpperCase();
      if (!normBatch) return;
      seenBatches.add(normBatch);
      const scanned = scannedBatchMap.get(normBatch);
      const cat =
        sap.sapCategory && sap.sapCategory !== "Bundle" ? sap.sapCategory : "Batch";
      const certThickness = sap.certThickness || scanned?.certThickness || "-";
      const width = sap.width || scanned?.width || "-";
      const length = sap.length || scanned?.length || "-";

      // 1) หาน้ำหนัก (weightKg) จากรายการสแกน หรือจาก SAP
      const sapUnrestrNum =
        parseFloat(String(sap.unrestricted || "").replace(/,/g, "")) || 0;
      const sapResolvedWeight =
        sapUnrestrNum > 0
          ? resolveRmRowWeightKg(sapUnrestrNum, certThickness, width, length)
          : sap.weightKg > 0
          ? resolveRmRowWeightKg(sap.weightKg, certThickness, width, length)
          : 0;
      const scannedResolvedWeight =
        scanned && scanned.weightKg > 0
          ? resolveRmRowWeightKg(scanned.weightKg, certThickness, width, length)
          : 0;
      const weightKg =
        scanned && scanned.inboundType === "internal" && scannedResolvedWeight > 0
          ? scannedResolvedWeight
          : sapResolvedWeight > 0
          ? sapResolvedWeight
          : scannedResolvedWeight;

      // 2) หาจำนวน = น้ำหนัก ÷ หนา Certificated. ÷ กว้าง ÷ ยาว ÷ 0.00000785
      const formulaQty = calculateRmQtyFromWeightKg(
        weightKg,
        certThickness,
        width,
        length
      );
      const qtyNum =
        formulaQty > 0
          ? formulaQty
          : scanned && scanned.inboundType === "internal" && scanned.inboundQty > 0
          ? scanned.inboundQty
          : scanned?.inboundQty || sap.inboundQty || sapUnrestrNum || 0;
      const qtyDisplay =
        qtyNum > 0
          ? qtyNum.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })
          : "0";

      // 3) ความสูงของกอง = จำนวน × หนา Certificated.
      const stackHeight = calculateRmStackHeight(qtyNum, certThickness);

      rows.push({
        key: `SAP-BATCH-${cat}-${normBatch}-${idx}`,
        sapCategory: cat,
        compareStatus: scanned ? "matched" : "unscanned",
        scannedLocation: scanned?.location || "",
        machine: scanned?.machine || "",
        storageLocation: sap.storageLocation || scanned?.storageLocation || "2A06",
        materialNo: sap.materialNo || scanned?.materialNo || "-",
        description: sap.description || scanned?.description || "-",
        batch: normBatch,
        certThickness,
        width,
        length,
        grade: sap.grade || scanned?.grade || "-",
        qtyDisplay,
        qtyNum,
        weightKg,
        stackHeight,
        manufacturer: sap.manufacturer || scanned?.manufacturer || "",
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
      const cat =
        r.sapCategory && r.sapCategory !== "Bundle" ? r.sapCategory : "Batch";
      const certThickness = r.certThickness || "-";
      const width = r.width || "-";
      const length = r.length || "-";
      const unrestrNum =
        parseFloat(String(r.unrestricted || "").replace(/,/g, "")) || 0;

      // 1) หาน้ำหนัก (weightKg)
      const weightFromQty =
        r.inboundQty > 0
          ? calculateRmFormulaWeightKg(r.inboundQty, certThickness, width, length)
          : 0;
      const weightKg =
        r.weightKg > 0
          ? resolveRmRowWeightKg(r.weightKg, certThickness, width, length)
          : weightFromQty > 0
          ? weightFromQty
          : resolveRmRowWeightKg(unrestrNum, certThickness, width, length);

      // 2) หาจำนวน = น้ำหนัก ÷ หนา Certificated. ÷ กว้าง ÷ ยาว ÷ 0.00000785
      const formulaQty = calculateRmQtyFromWeightKg(
        weightKg,
        certThickness,
        width,
        length
      );
      const qtyNum = formulaQty > 0 ? formulaQty : r.inboundQty || unrestrNum || 0;
      const qtyDisplay =
        qtyNum > 0
          ? qtyNum.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })
          : "0";

      // 3) ความสูงของกอง = จำนวน × หนา Certificated.
      const stackHeight = calculateRmStackHeight(qtyNum, certThickness);

      rows.push({
        key: `SCAN-BATCH-${r.id}`,
        sapCategory: cat,
        compareStatus: r.hasSapData ? "matched" : "no_sap",
        scannedLocation: r.location || "-",
        machine: r.machine || "",
        storageLocation: r.storageLocation || "-",
        materialNo: r.materialNo || "-",
        description: r.description || "-",
        batch: normBatch,
        certThickness,
        width,
        length,
        grade: r.grade || "-",
        qtyDisplay,
        qtyNum,
        weightKg,
        stackHeight,
        manufacturer: r.manufacturer && r.manufacturer !== "-" ? r.manufacturer : "",
        salesDocument: r.salesDocument ?? "",
        salesItem: r.salesItem ?? "0",
        conditionText: r.conditionText ?? "",
      });
    });

    return rows;
  }, [rmSapItems, rmStock]);

  const categoryFilteredBatchStock = useMemo(() => {
    if (stockBatchCategoryFilter === "ALL") return batchStockComparison;
    return batchStockComparison.filter((r) => r.sapCategory === stockBatchCategoryFilter);
  }, [batchStockComparison, stockBatchCategoryFilter]);

  const filteredBatchStockComparison = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    return categoryFilteredBatchStock.filter((r) => {
      if (stockCompareFilter !== "ALL" && r.compareStatus !== stockCompareFilter) {
        return false;
      }
      if (!q) return true;
      return `${r.sapCategory} ${r.scannedLocation} ${r.storageLocation} ${r.materialNo} ${r.description} ${r.batch} ${r.grade} ${r.manufacturer} ${r.salesDocument} ${r.conditionText}`
        .toLowerCase()
        .includes(q);
    });
  }, [categoryFilteredBatchStock, stockSearch, stockCompareFilter]);

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
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-3 sm:p-4 shadow-xs space-y-3">
            {/* Inbound Category & Sub-Mode Switcher (Full-width 2-col grid on mobile) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-[#1e3a5f]">
              <div className="grid grid-cols-2 sm:flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setInboundCategory("internal")}
                  className={`px-3.5 py-2 sm:py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
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
                  className={`px-3.5 py-2 sm:py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
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
                <div className="grid grid-cols-2 sm:flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setInternalSubMode("batch");
                      focusBarcodeInput();
                    }}
                    className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
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
                    className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
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

            {/* Machine Selector: CL03, CL04, CL05, CL06 + เพิ่มเครื่องจักรได้ */}
            {inboundCategory === "internal" && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 mr-0.5 shrink-0">
                    {isThai ? "เครื่องจักร:" : "Machine:"}
                  </span>

                  {rmMachines.map((mId) => {
                    const isSelected = inboundMachine === mId;
                    const isCustomMachine = !(
                      RM_INTERNAL_MACHINES as readonly string[]
                    ).includes(mId);
                    return (
                      <div key={mId} className="relative group flex shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setInboundMachine(mId);
                            focusBarcodeInput();
                          }}
                          className={`min-w-[60px] sm:min-w-[68px] py-1.5 ${
                            isCustomMachine ? "pl-2.5 pr-6" : "px-2.5"
                          } rounded-lg border text-center font-mono font-extrabold text-xs transition-all cursor-pointer ${
                            isSelected
                              ? internalSubMode === "bundle"
                                ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                                : "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                              : "bg-slate-50 dark:bg-[#0c1930] text-slate-800 dark:text-slate-100 border-slate-200 dark:border-[#1e3a5f]"
                          }`}
                        >
                          {mId}
                        </button>
                        {isCustomMachine && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveMachine(mId);
                            }}
                            title={isThai ? `ลบ ${mId}` : `Remove ${mId}`}
                            className={`absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-full transition-colors cursor-pointer ${
                              isSelected
                                ? "text-white/80 hover:text-white hover:bg-black/20"
                                : "text-slate-400 hover:text-red-500 hover:bg-red-500/10"
                            }`}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMachineOpen((v) => !v);
                      setTimeout(() => newMachineInputRef.current?.focus(), 60);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-extrabold border flex items-center gap-1 cursor-pointer transition-all shrink-0 whitespace-nowrap ${
                      isAddMachineOpen
                        ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700"
                        : internalSubMode === "bundle"
                        ? "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border-indigo-500/30"
                        : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30"
                    }`}
                  >
                    <Plus size={13} />
                    <span>{isThai ? "เพิ่มเครื่องจักร" : "Add Machine"}</span>
                  </button>
                </div>

                {isAddMachineOpen && (
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                    <input
                      ref={newMachineInputRef}
                      type="text"
                      value={newMachineInput}
                      onChange={(e) => setNewMachineInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddMachine();
                        } else if (e.key === "Escape") {
                          setIsAddMachineOpen(false);
                        }
                      }}
                      placeholder={
                        isThai
                          ? "ระบุรหัสเครื่องจักร เช่น CL07..."
                          : "Machine code e.g. CL07..."
                      }
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddMachine}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold text-white cursor-pointer shrink-0 ${
                        internalSubMode === "bundle"
                          ? "bg-indigo-600 hover:bg-indigo-500"
                          : "bg-emerald-600 hover:bg-emerald-500"
                      }`}
                    >
                      {isThai ? "เพิ่ม" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddMachineOpen(false);
                        setNewMachineInput("");
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
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

            {/* Location, Barcode, Quantity & Weight Form */}
            <form onSubmit={(e) => handleInboundSubmit(e)} className="space-y-2.5">
              {inboundCategory === "internal" && internalSubMode === "batch" ? (
                /* Compact Balanced Layout for "รับภายใน Batch" (1 row on Desktop XL, 2 balanced rows on SM/LG, clean stack on Mobile) */
                <div className="grid grid-cols-2 sm:grid-cols-12 xl:grid-cols-[minmax(190px,1.25fr)_minmax(245px,1.65fr)_minmax(96px,0.75fr)_minmax(115px,0.85fr)_auto] gap-2 items-end">
                  {/* Location + สแกน */}
                  <div className="col-span-2 sm:col-span-5 xl:col-span-1 space-y-1 min-w-0">
                    <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                      <MapPin size={13} className="text-emerald-500 shrink-0" />
                      <span>Location</span>
                    </label>

                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1 min-w-0 flex items-center">
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
                          className="w-full h-[36px] pl-2.5 pr-7 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                        {inboundLocation && (
                          <button
                            type="button"
                            onClick={() => {
                              setInboundLocation("");
                              locationInputRef.current?.focus();
                            }}
                            className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCameraScanTarget("location");
                          setIsInboundCameraOpen((v) =>
                            cameraScanTarget === "location" ? !v : true
                          );
                        }}
                        className="h-[36px] px-2.5 rounded-lg text-xs font-extrabold bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
                      >
                        <Camera size={13} />
                        <span>{isThai ? "สแกน" : "Scan"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Batch + สแกน Batch */}
                  <div className="col-span-2 sm:col-span-7 xl:col-span-1 space-y-1 min-w-0">
                    <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                      <Barcode size={14} className="text-emerald-500 shrink-0" />
                      <span>Batch</span>
                    </label>

                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1 min-w-0 flex items-center">
                        <input
                          ref={barcodeInputRef}
                          type="text"
                          value={inboundBarcodeInput}
                          onChange={(e) => setInboundBarcodeInput(e.target.value.toUpperCase())}
                          placeholder="Batch"
                          className="w-full h-[36px] pl-2.5 pr-7 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                        {inboundBarcodeInput && (
                          <button
                            type="button"
                            onClick={() => {
                              setInboundBarcodeInput("");
                              focusBarcodeInput();
                            }}
                            className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCameraScanTarget("barcode");
                          setIsInboundCameraOpen((v) =>
                            cameraScanTarget === "barcode" ? !v : true
                          );
                        }}
                        className="h-[36px] px-2.5 rounded-lg text-xs font-extrabold bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 flex items-center justify-center gap-1 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
                      >
                        <Camera size={13} />
                        <span>{isThai ? "สแกน Batch" : "Scan Batch"}</span>
                      </button>
                    </div>
                  </div>

                  {/* จำนวน (แผ่น) */}
                  <div className="col-span-1 sm:col-span-4 xl:col-span-1 space-y-1 min-w-0">
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 truncate">
                      {isThai ? "จำนวน (แผ่น)" : "Quantity"}
                    </label>
                    <input
                      ref={qtyInputRef}
                      type="number"
                      min="0"
                      step="any"
                      value={inboundQtyInput}
                      onChange={(e) => setInboundQtyInput(e.target.value)}
                      placeholder="1"
                      className="w-full h-[36px] px-2.5 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* น้ำหนัก (KG) */}
                  <div className="col-span-1 sm:col-span-5 xl:col-span-1 space-y-1 min-w-0">
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 truncate">
                      {isThai ? "น้ำหนัก (KG)" : "Weight (KG)"}
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={
                        autoCalculatedInboundWeight > 0
                          ? autoCalculatedInboundWeight.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 3,
                            })
                          : "0.00"
                      }
                      className="w-full h-[36px] px-2.5 rounded-lg text-xs font-mono font-extrabold border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 cursor-not-allowed"
                    />
                  </div>

                  {/* ปุ่ม บันทึก */}
                  <div className="col-span-2 sm:col-span-3 xl:col-span-1">
                    <button
                      type="submit"
                      className="w-full xl:w-auto h-[36px] px-4 rounded-lg text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-500 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <CheckCircle2 size={14} />
                      <span>{isThai ? "บันทึก" : "Save"}</span>
                    </button>
                  </div>
                </div>
              ) : inboundCategory === "external" ? (
                /* Compact Single-Row Layout for "รับภายนอก": Location, Batch, จำนวน (แผ่น), น้ำหนัก (KG), Vendor + บันทึก */
                <div className="grid grid-cols-2 sm:grid-cols-12 lg:grid-cols-[minmax(145px,1.1fr)_minmax(195px,1.4fr)_minmax(76px,0.6fr)_minmax(88px,0.7fr)_minmax(130px,1.05fr)_auto] gap-2 items-end">
                  {/* Location + สแกน */}
                  <div className="col-span-2 sm:col-span-5 lg:col-span-1 space-y-1 min-w-0">
                    <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                      <MapPin size={13} className="text-emerald-500 shrink-0" />
                      <span>Location</span>
                    </label>

                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1 min-w-0 flex items-center">
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
                          className="w-full h-[36px] pl-2.5 pr-7 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                        />
                        {inboundLocation && (
                          <button
                            type="button"
                            onClick={() => {
                              setInboundLocation("");
                              locationInputRef.current?.focus();
                            }}
                            className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCameraScanTarget("location");
                          setIsInboundCameraOpen((v) =>
                            cameraScanTarget === "location" ? !v : true
                          );
                        }}
                        className="h-[36px] px-2 rounded-lg text-xs font-extrabold bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
                      >
                        <Camera size={13} />
                        <span>{isThai ? "สแกน" : "Scan"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Batch + สแกน Batch */}
                  <div className="col-span-2 sm:col-span-7 lg:col-span-1 space-y-1 min-w-0">
                    <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                      <Barcode size={14} className="text-emerald-500 shrink-0" />
                      <span>Batch</span>
                    </label>

                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1 min-w-0 flex items-center">
                        <input
                          ref={barcodeInputRef}
                          type="text"
                          value={inboundBarcodeInput}
                          onChange={(e) => setInboundBarcodeInput(e.target.value.toUpperCase())}
                          placeholder="Batch"
                          className="w-full h-[36px] pl-2.5 pr-7 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                        />
                        {inboundBarcodeInput && (
                          <button
                            type="button"
                            onClick={() => {
                              setInboundBarcodeInput("");
                              focusBarcodeInput();
                            }}
                            className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCameraScanTarget("barcode");
                          setIsInboundCameraOpen((v) =>
                            cameraScanTarget === "barcode" ? !v : true
                          );
                        }}
                        className="h-[36px] px-2 rounded-lg text-xs font-extrabold bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 flex items-center justify-center gap-1 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
                      >
                        <Camera size={13} />
                        <span>{isThai ? "สแกน Batch" : "Scan Batch"}</span>
                      </button>
                    </div>
                  </div>

                  {/* จำนวน (แผ่น) */}
                  <div className="col-span-1 sm:col-span-3 lg:col-span-1 space-y-1 min-w-0">
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 truncate">
                      {isThai ? "จำนวน (แผ่น)" : "Quantity"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={externalQtyInput}
                      onChange={(e) => setExternalQtyInput(e.target.value)}
                      placeholder={
                        activeInboundSpec.existingQty > 0
                          ? String(activeInboundSpec.existingQty)
                          : "1"
                      }
                      className="w-full h-[36px] px-2.5 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* น้ำหนัก (KG) */}
                  <div className="col-span-1 sm:col-span-3 lg:col-span-1 space-y-1 min-w-0">
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 truncate">
                      {isThai ? "น้ำหนัก (KG)" : "Weight (KG)"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={externalWeightInput}
                      onChange={(e) => setExternalWeightInput(e.target.value)}
                      placeholder={(() => {
                        const q = parseFloat(externalQtyInput.replace(/,/g, "")) || 0;
                        const calc =
                          q > 0
                            ? calculateRmFormulaWeightKg(
                                q,
                                activeInboundSpec.certThickness,
                                activeInboundSpec.width,
                                activeInboundSpec.length
                              )
                            : activeInboundSpec.existingWeightKg;
                        return calc > 0
                          ? calc.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 3,
                            })
                          : "0.00";
                      })()}
                      className="w-full h-[36px] px-2.5 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Vendor */}
                  <div className="col-span-2 sm:col-span-4 lg:col-span-1 space-y-1 min-w-0">
                    <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                      <Building2 size={12} className="text-blue-500 shrink-0" />
                      <span>Vendor</span>
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        list="rm-external-vendor-list"
                        value={externalVendorInput}
                        onChange={(e) => setExternalVendorInput(e.target.value)}
                        placeholder={isThai ? "ระบุชื่อ Vendor / ผู้ผลิต..." : "Enter Vendor..."}
                        className="w-full h-[36px] pl-2.5 pr-7 rounded-lg text-xs font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                      />
                      {externalVendorInput && (
                        <button
                          type="button"
                          onClick={() => setExternalVendorInput("")}
                          className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <datalist id="rm-external-vendor-list">
                      {knownExternalVendors.map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                  </div>

                  {/* ปุ่ม บันทึก */}
                  <div className="col-span-2 sm:col-span-2 lg:col-span-1">
                    <button
                      type="submit"
                      className="w-full lg:w-auto h-[36px] px-4 rounded-lg text-xs font-extrabold text-white bg-blue-600 hover:bg-blue-500 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                    >
                      <CheckCircle2 size={14} />
                      <span>{isThai ? "บันทึก" : "Save"}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                  {/* Location Input with inline scan button */}
                  <div className="md:col-span-4 space-y-1">
                    <label className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                      <MapPin size={13} className="text-emerald-500" />
                      <span>Location</span>
                    </label>

                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1 flex items-center">
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
                          className="w-full pl-3 pr-8 py-2.5 sm:py-2 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
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

                      <button
                        type="button"
                        onClick={() => {
                          setCameraScanTarget("location");
                          setIsInboundCameraOpen((v) =>
                            cameraScanTarget === "location" ? !v : true
                          );
                        }}
                        className="px-2.5 py-2.5 sm:py-2 rounded-lg text-xs font-extrabold bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Camera size={14} />
                        <span>{isThai ? "สแกน" : "Scan"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Barcode Input + Action Buttons */}
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

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1 flex items-center">
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
                          className="w-full pl-3 pr-8 py-2.5 sm:py-2 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                        {inboundBarcodeInput && (
                          <button
                            type="button"
                            onClick={() => {
                              setInboundBarcodeInput("");
                              focusBarcodeInput();
                            }}
                            className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setCameraScanTarget("barcode");
                            setIsInboundCameraOpen((v) =>
                              cameraScanTarget === "barcode" ? !v : true
                            );
                          }}
                          className="px-3 py-2.5 sm:py-2 rounded-lg text-xs font-extrabold bg-sky-50 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Camera size={14} />
                          <span>
                            {inboundCategory === "internal" && internalSubMode === "bundle"
                              ? isThai
                                ? "สแกน HU"
                                : "Scan HU"
                              : isThai
                              ? "สแกน Batch"
                              : "Scan Batch"}
                          </span>
                        </button>

                        <button
                          type="submit"
                          className={`px-4 py-2.5 sm:py-2 rounded-lg text-xs font-extrabold text-white shadow-xs flex items-center justify-center gap-1.5 cursor-pointer ${
                            internalSubMode === "bundle"
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
                </div>
              )}

              {/* Internal Inbound Fields: Bundle Batch/จำนวน/น้ำหนัก + Spec/Stock Preview */}
              {inboundCategory === "internal" && (
                <div className="space-y-2 pt-0.5">
                  {internalSubMode === "bundle" && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                          Batch
                        </label>
                        <input
                          type="text"
                          value={bundleBatchInput}
                          onChange={(e) => setBundleBatchInput(e.target.value.toUpperCase())}
                          placeholder="Batch"
                          className="w-full px-3 py-2 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 mb-1">
                          {isThai ? "จำนวน (แผ่น)" : "Quantity"}
                        </label>
                        <input
                          ref={qtyInputRef}
                          type="number"
                          min="0"
                          step="any"
                          value={inboundQtyInput}
                          onChange={(e) => setInboundQtyInput(e.target.value)}
                          placeholder="1"
                          className="w-full px-3 py-2 rounded-lg text-xs font-mono font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-200 truncate">
                            {isThai ? "น้ำหนัก (KG)" : "Weight (KG)"}
                          </label>
                        </div>
                        <input
                          type="text"
                          readOnly
                          value={
                            autoCalculatedInboundWeight > 0
                              ? autoCalculatedInboundWeight.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 3,
                                })
                              : "0.00"
                          }
                          className="w-full px-3 py-2 rounded-lg text-xs font-mono font-extrabold border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 cursor-not-allowed"
                        />
                      </div>
                    </div>
                  )}

                  {/* แสดงสูตรขนาดแผ่น (ถ้าพบข้อมูลใน SAP/สต๊อก) แบบกะทัดรัดไม่ล้นจอ */}
                  {Boolean(
                    activeInboundSpec.certThickness &&
                      activeInboundSpec.width &&
                      activeInboundSpec.length &&
                      activeInboundSpec.certThickness !== "-"
                  ) && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono">
                      <span className="text-slate-500 dark:text-slate-400">
                        {isThai ? "สเปคแผ่น:" : "Spec:"}{" "}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {`${activeInboundSpec.certThickness} × ${activeInboundSpec.width} × ${activeInboundSpec.length}`}
                        </strong>
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        {`${Number(inboundQtyInput) > 0 ? Number(inboundQtyInput) : 0} × ${activeInboundSpec.certThickness} × ${activeInboundSpec.width} × ${activeInboundSpec.length} × 0.00000785`}
                      </span>
                    </div>
                  )}

                  {/* แสดงการเช็คยอดในหน้าสต๊อก + ยอดบวกเพิ่ม สำหรับโหมด รับภายใน Batch (แบ่ง 3 ช่องเป็นระเบียบบนมือถือ) */}
                  {internalSubMode === "batch" && inboundBarcodeInput.trim() !== "" && (
                    <div className="p-2.5 rounded-xl border border-sky-500/30 bg-sky-500/5 space-y-1.5">
                      <div className="grid grid-cols-3 gap-1.5 text-center font-mono">
                        <div className="p-1.5 rounded-lg bg-white/80 dark:bg-[#0c1930] border border-slate-200/80 dark:border-[#1e3a5f]">
                          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                            {isThai ? "สต๊อกเดิม" : "In Stock"}
                          </div>
                          <div className="text-xs font-extrabold text-sky-700 dark:text-sky-300">
                            {activeInboundSpec.existingQty.toLocaleString()}{" "}
                            <span className="text-[10px] font-normal">
                              {isThai ? "แผ่น" : "pcs"}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {activeInboundSpec.existingWeightKg.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            KG
                          </div>
                        </div>

                        <div className="p-1.5 rounded-lg bg-white/80 dark:bg-[#0c1930] border border-emerald-500/30">
                          <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            {isThai ? "+ รับเพิ่ม" : "+ Add"}
                          </div>
                          <div className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                            +
                            {(
                              parseFloat(inboundQtyInput.replace(/,/g, "")) || 1
                            ).toLocaleString()}{" "}
                            <span className="text-[10px] font-normal">
                              {isThai ? "แผ่น" : "pcs"}
                            </span>
                          </div>
                          <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 truncate">
                            +
                            {(autoCalculatedInboundWeight > 0
                              ? autoCalculatedInboundWeight
                              : calculateRmFormulaWeightKg(
                                  1,
                                  activeInboundSpec.certThickness,
                                  activeInboundSpec.width,
                                  activeInboundSpec.length
                                )
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            KG
                          </div>
                        </div>

                        {(() => {
                          const addQ = parseFloat(inboundQtyInput.replace(/,/g, "")) || 1;
                          const addW =
                            autoCalculatedInboundWeight > 0
                              ? autoCalculatedInboundWeight
                              : calculateRmFormulaWeightKg(
                                  addQ,
                                  activeInboundSpec.certThickness,
                                  activeInboundSpec.width,
                                  activeInboundSpec.length
                                );
                          const sumW = Number(
                            (activeInboundSpec.existingWeightKg + addW).toFixed(3)
                          );
                          const sumQ =
                            calculateRmQtyFromWeightKg(
                              sumW,
                              activeInboundSpec.certThickness,
                              activeInboundSpec.width,
                              activeInboundSpec.length
                            ) || Number((activeInboundSpec.existingQty + addQ).toFixed(2));
                          return (
                            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/40">
                              <div className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                {isThai ? "รวมในสต๊อก" : "New Total"}
                              </div>
                              <div className="text-xs font-extrabold text-amber-700 dark:text-amber-300">
                                {sumQ.toLocaleString()}{" "}
                                <span className="text-[10px] font-normal">
                                  {isThai ? "แผ่น" : "pcs"}
                                </span>
                              </div>
                              <div className="text-[10px] text-amber-700/80 dark:text-amber-300/80 truncate">
                                {sumW.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                KG
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </form>

            {/* Scan feedback banner */}
            {lastScannedBanner.type !== "idle" && (
              <div
                className={`px-3 py-2 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 ${
                  lastScannedBanner.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    : lastScannedBanner.type === "warning"
                    ? "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300"
                    : "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300"
                }`}
              >
                <div className="font-extrabold flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="shrink-0" />
                  <span className="break-all sm:break-normal">{lastScannedBanner.message}</span>
                </div>
                {lastScannedBanner.detail && (
                  <span className="text-[11px] opacity-85 font-mono pl-5 sm:pl-0">
                    {lastScannedBanner.detail}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* =================================================================
              INBOUND DATA TABLES (Mobile Card View + Desktop Table View)
             ================================================================= */}
          {inboundCategory === "internal" &&
            internalSubMode === "batch" &&
            (() => {
              const totalItems = filteredInternalBatchRecords.length;
              const totalPages = Math.max(1, Math.ceil(totalItems / internalBatchPageSize));
              const currentPage = Math.min(internalBatchPage, totalPages);
              const startIdx = (currentPage - 1) * internalBatchPageSize;
              const paginatedRows = filteredInternalBatchRecords.slice(
                startIdx,
                startIdx + internalBatchPageSize
              );

              return (
                <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden shadow-xs">
                  <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                      {isThai
                        ? `รับภายใน Batch (${totalItems.toLocaleString()})`
                        : `Internal Batch (${totalItems.toLocaleString()})`}
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
                        placeholder={isThai ? "ค้นหา Batch, Location..." : "Search..."}
                        className="w-full pl-8 pr-3 py-1.5 sm:py-1 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {/* โหมดมือถือ: แสดงเป็นระเบียบแบบ Card อ่านง่ายไม่ต้องเลื่อนซ้าย-ขวา */}
                  <div className="md:hidden divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                    {paginatedRows.map((r) => (
                      <div key={r.id} className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-mono font-extrabold text-xs">
                                {r.batch}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-mono font-extrabold text-[11px]">
                                Loc: {r.location}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 font-mono font-bold text-[11px]">
                                {r.machine}
                              </span>
                              {r.grade && r.grade !== "-" && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono font-bold text-[11px]">
                                  {r.grade}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium line-clamp-1">
                              {r.materialNo !== "-" ? `${r.materialNo} • ` : ""}
                              {r.description}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => deleteRmStockFromCloud(r.id)}
                            className="p-1.5 rounded-lg hover:bg-red-500/15 text-red-500 cursor-pointer shrink-0"
                            title={isThai ? "ลบรายการ" : "Delete"}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px] font-mono">
                          <div className="px-2 py-1 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200/70 dark:border-[#1e3a5f]">
                            <span className="block text-[10px] text-slate-400">
                              {isThai ? "ขนาด (มม.)" : "Size"}
                            </span>
                            <span className="font-bold text-slate-700 dark:text-slate-200">
                              {r.certThickness}×{r.width}×{r.length}
                            </span>
                          </div>

                          <div className="px-2 py-1 rounded bg-sky-500/10 border border-sky-500/25 text-right">
                            <span className="block text-[10px] text-sky-600 dark:text-sky-400">
                              {isThai ? "จำนวน" : "Qty"}
                            </span>
                            <span className="font-extrabold text-sky-700 dark:text-sky-300">
                              {Number(r.inboundQty || 1).toLocaleString()}{" "}
                              {isThai ? "แผ่น" : "pcs"}
                            </span>
                          </div>

                          <div className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/25 text-right">
                            <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">
                              {isThai ? "น้ำหนัก (KG)" : "Weight"}
                            </span>
                            <span className="font-extrabold text-emerald-700 dark:text-emerald-300">
                              {Number(r.weightKg || 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {totalItems === 0 && (
                      <div className="text-center py-8 text-xs text-slate-400">
                        {isThai ? "ไม่มีข้อมูล" : "No records"}
                      </div>
                    )}
                  </div>

                  {/* โหมดหน้าจอคอมพิวเตอร์ / แท็บเล็ตแนวนอน */}
                  <div className="hidden md:block overflow-x-auto">
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
                          <th className="text-right">{isThai ? "จำนวน" : "Qty"}</th>
                          <th className="text-right">{isThai ? "น้ำหนัก" : "Weight"}</th>
                          <th className="text-right">Unrestr.</th>
                          <th>ผู้ผลิต</th>
                          <th className="text-center">{isThai ? "ลบ" : "Del"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.map((r) => (
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
                            <td className="font-mono font-extrabold tabular-nums text-right text-sky-600 dark:text-sky-300">
                              {Number(r.inboundQty || 1).toLocaleString()}
                            </td>
                            <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                              {Number(r.weightKg || 0).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 3,
                              })}
                            </td>
                            <td className="font-mono font-bold tabular-nums text-right">
                              {r.unrestricted || "-"}
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
                        {totalItems === 0 && (
                          <tr>
                            <td colSpan={15} className="text-center py-6 text-slate-400">
                              {isThai ? "ไม่มีข้อมูล" : "No records"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer */}
                  <div className="px-3.5 sm:px-4 py-2.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0c1930]/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300 font-bold">
                      <span>
                        {totalItems > 0
                          ? isThai
                            ? `แสดง ${(startIdx + 1).toLocaleString()} - ${Math.min(
                                startIdx + internalBatchPageSize,
                                totalItems
                              ).toLocaleString()} จาก ${totalItems.toLocaleString()} รายการ`
                            : `Showing ${startIdx + 1} - ${Math.min(
                                startIdx + internalBatchPageSize,
                                totalItems
                              )} of ${totalItems}`
                          : isThai
                          ? "0 รายการ"
                          : "0 items"}
                      </span>
                      <select
                        value={internalBatchPageSize}
                        onChange={(e) => setInternalBatchPageSize(Number(e.target.value) || 20)}
                        className="px-2 py-1 rounded-lg text-xs font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-800 dark:text-slate-100 cursor-pointer"
                      >
                        {[10, 20, 50, 100].map((size) => (
                          <option key={size} value={size}>
                            {isThai ? `${size} รายการ/หน้า` : `${size} / page`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setInternalBatchPage((p) => Math.max(1, p - 1))}
                        className={`px-3 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                          currentPage > 1
                            ? "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#1a2d52] cursor-pointer"
                            : "bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-[#1e3a5f]/50 cursor-not-allowed"
                        }`}
                      >
                        {isThai ? "ก่อนหน้า" : "PREV"}
                      </button>

                      <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] font-mono font-extrabold text-slate-700 dark:text-slate-200">
                        {isThai
                          ? `หน้า ${currentPage} / ${totalPages}`
                          : `Page ${currentPage} / ${totalPages}`}
                      </span>

                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setInternalBatchPage((p) => Math.min(totalPages, p + 1))}
                        className={`px-3 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                          currentPage < totalPages
                            ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-xs cursor-pointer"
                            : "bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-[#1e3a5f]/50 cursor-not-allowed"
                        }`}
                      >
                        {isThai ? "หน้าถัดไป (NEXT PAGE)" : "NEXT PAGE"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

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
              <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
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
                    placeholder={isThai ? "ค้นหา Batch, Vendor, Location..." : "Search..."}
                    className="w-full pl-8 pr-3 py-1.5 sm:py-1 rounded-lg text-xs border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* โหมดมือถือ: Card View สำหรับรับภายนอก */}
              <div className="md:hidden divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                {filteredExternalRecords.slice(0, 50).map((r) => (
                  <div key={r.id} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-300 font-mono font-extrabold text-xs">
                            {r.batch}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-300 font-mono font-extrabold text-[11px]">
                            Loc: {r.location}
                          </span>
                          {r.manufacturer && r.manufacturer !== "-" && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-bold text-[11px]">
                              {r.manufacturer}
                            </span>
                          )}
                          {r.grade && r.grade !== "-" && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono font-bold text-[11px]">
                              {r.grade}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium line-clamp-1">
                          {r.materialNo !== "-" ? `${r.materialNo} • ` : ""}
                          {r.description}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => deleteRmStockFromCloud(r.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/15 text-red-500 cursor-pointer shrink-0"
                        title={isThai ? "ลบรายการ" : "Delete"}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px] font-mono">
                      <div className="px-2 py-1 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200/70 dark:border-[#1e3a5f]">
                        <span className="block text-[10px] text-slate-400">
                          Vendor
                        </span>
                        <span className="font-bold text-slate-700 dark:text-slate-200 truncate block">
                          {r.manufacturer || "-"}
                        </span>
                      </div>

                      <div className="px-2 py-1 rounded bg-sky-500/10 border border-sky-500/25 text-right">
                        <span className="block text-[10px] text-sky-600 dark:text-sky-400">
                          {isThai ? "จำนวน" : "Qty"}
                        </span>
                        <span className="font-extrabold text-sky-700 dark:text-sky-300">
                          {Number(r.inboundQty || 1).toLocaleString()}{" "}
                          {isThai ? "แผ่น" : "pcs"}
                        </span>
                      </div>

                      <div className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/25 text-right">
                        <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">
                          {isThai ? "น้ำหนัก (KG)" : "Weight"}
                        </span>
                        <span className="font-extrabold text-emerald-700 dark:text-emerald-300">
                          {Number(r.weightKg || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredExternalRecords.length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400">
                    {isThai ? "ไม่มีข้อมูล" : "No records"}
                  </div>
                )}
              </div>

              {/* โหมดหน้าจอคอมพิวเตอร์ */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Vendor</th>
                      <th>Storage Location</th>
                      <th>Material No.</th>
                      <th>Discription</th>
                      <th>Batch</th>
                      <th>หนา Certificated.</th>
                      <th>กว้าง</th>
                      <th>ยาว</th>
                      <th>Grade</th>
                      <th className="text-right">{isThai ? "จำนวน" : "Qty"}</th>
                      <th className="text-right">{isThai ? "น้ำหนัก (KG)" : "Weight (KG)"}</th>
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
                        <td className="font-bold text-indigo-600 dark:text-indigo-300">
                          {r.manufacturer || "-"}
                        </td>
                        <td className="font-mono font-bold">{r.storageLocation}</td>
                        <td className="font-mono text-sky-600 dark:text-sky-400">
                          {r.materialNo}
                        </td>
                        <td className="max-w-[240px] truncate" title={r.description}>
                          {r.description}
                        </td>
                        <td>
                          <span className="code font-mono font-extrabold text-blue-600 dark:text-blue-300">
                            {r.batch}
                          </span>
                        </td>
                        <td className="font-mono tabular-nums">{r.certThickness}</td>
                        <td className="font-mono tabular-nums">{r.width}</td>
                        <td className="font-mono tabular-nums">{r.length}</td>
                        <td className="font-bold">{r.grade}</td>
                        <td className="font-mono font-extrabold tabular-nums text-right text-sky-600 dark:text-sky-300">
                          {Number(r.inboundQty || 1).toLocaleString()}
                        </td>
                        <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                          {Number(r.weightKg || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 3,
                          })}
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
                    {filteredExternalRecords.length === 0 && (
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
          {/* Row 1: Toggle สต๊อก Batch / สต๊อก Bundle + ปุ่มอัปโหลดสต๊อก SAP ทั้ง 5 ผลิตภัณฑ์ */}
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
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

              {/* SAP Upload Button (Bundle only; Batch categories use main top-right SAP upload button) */}
              {stockTableType === "bundle" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openSapUploadModal("Bundle")}
                    className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                  >
                    <FileSpreadsheet size={14} />
                    <span>
                      {isThai
                        ? "อัปโหลดสต๊อก SAP (Bundle)"
                        : "Upload SAP (Bundle)"}
                    </span>
                    {sapCountByCategory.Bundle > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-white/20 text-[10.5px] font-mono">
                        {sapCountByCategory.Bundle.toLocaleString()}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Row 2: Product Group Filter (for Batch) + Comparison Status Filter + Search */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {stockTableType === "batch" && (
                  <div className="flex items-center gap-1 flex-wrap pr-2 border-r border-slate-200 dark:border-[#1e3a5f]">
                    <button
                      type="button"
                      onClick={() => setStockBatchCategoryFilter("ALL")}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                        stockBatchCategoryFilter === "ALL"
                          ? "bg-emerald-600 text-white border-emerald-500"
                          : "bg-slate-50 dark:bg-[#0c1930] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                      }`}
                    >
                      {isThai ? "ทุกผลิตภัณฑ์" : "All"} ({batchStockComparison.length})
                    </button>
                    {RM_SAP_BATCH_CATEGORIES.map((cat) => {
                      const catCount = batchStockComparison.filter(
                        (r) => r.sapCategory === cat
                      ).length;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setStockBatchCategoryFilter(cat)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                            stockBatchCategoryFilter === cat
                              ? "bg-emerald-600 text-white border-emerald-500"
                              : "bg-slate-50 dark:bg-[#0c1930] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                          }`}
                        >
                          {cat} ({catCount})
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Comparison Status Filter */}
                <div className="flex items-center gap-1 flex-wrap">
                  {(
                    [
                      {
                        id: "ALL",
                        label: isThai ? "ทั้งหมด" : "All",
                        count:
                          stockTableType === "batch"
                            ? categoryFilteredBatchStock.length
                            : bundleStockComparison.length,
                      },
                      {
                        id: "matched",
                        label: isThai ? "สแกนแล้ว" : "Scanned",
                        count: (stockTableType === "batch"
                          ? categoryFilteredBatchStock
                          : bundleStockComparison
                        ).filter((r) => r.compareStatus === "matched").length,
                      },
                      {
                        id: "unscanned",
                        label: isThai ? "รอสแกน" : "Unscanned",
                        count: (stockTableType === "batch"
                          ? categoryFilteredBatchStock
                          : bundleStockComparison
                        ).filter((r) => r.compareStatus === "unscanned").length,
                      },
                      {
                        id: "no_sap",
                        label: isThai ? "ไม่มีใน SAP" : "Not in SAP",
                        count: (stockTableType === "batch"
                          ? categoryFilteredBatchStock
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

              <div className="relative w-full sm:w-56">
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

          {/* TABLE 1: สต๊อก Batch (แสดงคอลัมน์ จำนวน แทน Unrestricted + เพิ่ม น้ำหนัก และ ความสูงของกอง หน่วยเมตร + แบ่งหน้า 20 รายการ/หน้า) */}
          {stockTableType === "batch" &&
            (() => {
              const totalItems = filteredBatchStockComparison.length;
              const totalPages = Math.max(1, Math.ceil(totalItems / stockPageSize));
              const currentPage = Math.min(stockPage, totalPages);
              const startIdx = (currentPage - 1) * stockPageSize;
              const paginatedRows = filteredBatchStockComparison.slice(
                startIdx,
                startIdx + stockPageSize
              );

              return (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th>{isThai ? "ประเภท" : "Type"}</th>
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
                          <th className="text-right">{isThai ? "จำนวน" : "Quantity"}</th>
                          <th className="text-right">{isThai ? "น้ำหนัก" : "Weight"}</th>
                          <th className="text-right">
                            {isThai ? "ความสูงของกอง (ม.)" : "Stack Height (m)"}
                          </th>
                          <th>ผู้ผลิต</th>
                          <th>Text สภาพสินค้า</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.map((r) => (
                          <tr key={r.key}>
                            <td>
                              <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 font-extrabold text-[11px] whitespace-nowrap">
                                {r.sapCategory}
                              </span>
                            </td>
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
                            <td className="font-mono tabular-nums text-right">
                              {r.certThickness}
                            </td>
                            <td className="font-mono tabular-nums text-right">{r.width}</td>
                            <td className="font-mono tabular-nums text-right">{r.length}</td>
                            <td className="font-bold">{r.grade}</td>
                            <td className="font-mono font-extrabold tabular-nums text-right text-sky-600 dark:text-sky-300">
                              {r.qtyDisplay}
                            </td>
                            <td className="font-mono font-extrabold tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                              {r.weightKg > 0
                                ? r.weightKg.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 3,
                                  })
                                : "0.00"}
                            </td>
                            <td className="font-mono font-extrabold tabular-nums text-right text-amber-600 dark:text-amber-400">
                              {r.stackHeight > 0
                                ? `${r.stackHeight.toLocaleString(undefined, {
                                    minimumFractionDigits: 3,
                                    maximumFractionDigits: 4,
                                  })} ม.`
                                : "0.000 ม."}
                            </td>
                            <td>{r.manufacturer}</td>
                            <td>{r.conditionText}</td>
                          </tr>
                        ))}
                        {totalItems === 0 && (
                          <tr>
                            <td colSpan={16} className="text-center py-6 text-slate-400">
                              {isThai ? "ไม่มีข้อมูล" : "No records"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer (NEXT PAGE เริ่มที่ 20 รายการต่อหน้า) */}
                  <div className="px-4 py-2.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0c1930]/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300 font-bold">
                      <span>
                        {totalItems > 0
                          ? isThai
                            ? `แสดง ${(startIdx + 1).toLocaleString()} - ${Math.min(
                                startIdx + stockPageSize,
                                totalItems
                              ).toLocaleString()} จาก ${totalItems.toLocaleString()} รายการ`
                            : `Showing ${startIdx + 1} - ${Math.min(
                                startIdx + stockPageSize,
                                totalItems
                              )} of ${totalItems}`
                          : isThai
                          ? "0 รายการ"
                          : "0 items"}
                      </span>
                      <select
                        value={stockPageSize}
                        onChange={(e) => setStockPageSize(Number(e.target.value) || 20)}
                        className="px-2 py-1 rounded-lg text-xs font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-800 dark:text-slate-100 cursor-pointer"
                      >
                        {[20, 50, 100, 200].map((size) => (
                          <option key={size} value={size}>
                            {isThai ? `${size} รายการ/หน้า` : `${size} / page`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setStockPage((p) => Math.max(1, p - 1))}
                        className={`px-3 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                          currentPage > 1
                            ? "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#1a2d52] cursor-pointer"
                            : "bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-[#1e3a5f]/50 cursor-not-allowed"
                        }`}
                      >
                        {isThai ? "ก่อนหน้า" : "PREV"}
                      </button>

                      <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] font-mono font-extrabold text-slate-700 dark:text-slate-200">
                        {isThai
                          ? `หน้า ${currentPage} / ${totalPages}`
                          : `Page ${currentPage} / ${totalPages}`}
                      </span>

                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setStockPage((p) => Math.min(totalPages, p + 1))}
                        className={`px-3 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                          currentPage < totalPages
                            ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-xs cursor-pointer"
                            : "bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-[#1e3a5f]/50 cursor-not-allowed"
                        }`}
                      >
                        {isThai ? "หน้าถัดไป (NEXT PAGE)" : "NEXT PAGE"}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}

          {/* TABLE 2: สต๊อก Bundle (แยกจากตาราง สต๊อก Batch ชัดเจน + แบ่งหน้า 20 รายการ/หน้า) */}
          {stockTableType === "bundle" &&
            (() => {
              const totalItems = filteredBundleStockComparison.length;
              const totalPages = Math.max(1, Math.ceil(totalItems / stockPageSize));
              const currentPage = Math.min(stockPage, totalPages);
              const startIdx = (currentPage - 1) * stockPageSize;
              const paginatedRows = filteredBundleStockComparison.slice(
                startIdx,
                startIdx + stockPageSize
              );

              return (
                <>
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
                        {paginatedRows.map((r) => (
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
                        {totalItems === 0 && (
                          <tr>
                            <td colSpan={8} className="text-center py-6 text-slate-400">
                              {isThai ? "ไม่มีข้อมูล" : "No records"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Footer (NEXT PAGE เริ่มที่ 20 รายการต่อหน้า) */}
                  <div className="px-4 py-2.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0c1930]/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300 font-bold">
                      <span>
                        {totalItems > 0
                          ? isThai
                            ? `แสดง ${(startIdx + 1).toLocaleString()} - ${Math.min(
                                startIdx + stockPageSize,
                                totalItems
                              ).toLocaleString()} จาก ${totalItems.toLocaleString()} รายการ`
                            : `Showing ${startIdx + 1} - ${Math.min(
                                startIdx + stockPageSize,
                                totalItems
                              )} of ${totalItems}`
                          : isThai
                          ? "0 รายการ"
                          : "0 items"}
                      </span>
                      <select
                        value={stockPageSize}
                        onChange={(e) => setStockPageSize(Number(e.target.value) || 20)}
                        className="px-2 py-1 rounded-lg text-xs font-extrabold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-800 dark:text-slate-100 cursor-pointer"
                      >
                        {[20, 50, 100, 200].map((size) => (
                          <option key={size} value={size}>
                            {isThai ? `${size} รายการ/หน้า` : `${size} / page`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setStockPage((p) => Math.max(1, p - 1))}
                        className={`px-3 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                          currentPage > 1
                            ? "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#1a2d52] cursor-pointer"
                            : "bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-[#1e3a5f]/50 cursor-not-allowed"
                        }`}
                      >
                        {isThai ? "ก่อนหน้า" : "PREV"}
                      </button>

                      <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] font-mono font-extrabold text-slate-700 dark:text-slate-200">
                        {isThai
                          ? `หน้า ${currentPage} / ${totalPages}`
                          : `Page ${currentPage} / ${totalPages}`}
                      </span>

                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setStockPage((p) => Math.min(totalPages, p + 1))}
                        className={`px-3 py-1 rounded-lg text-xs font-extrabold border transition-all ${
                          currentPage < totalPages
                            ? "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-xs cursor-pointer"
                            : "bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-[#1e3a5f]/50 cursor-not-allowed"
                        }`}
                      >
                        {isThai ? "หน้าถัดไป (NEXT PAGE)" : "NEXT PAGE"}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
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
          MODAL: SAP MASTER UPLOAD / PASTE (รองรับ Batch, VM, AB, STL, ฝาก และ Bundle)
         ===================================================================== */}
      {isSapModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-cyan-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database size={16} />
                <h3 className="text-sm font-extrabold m-0">
                  {isThai
                    ? `อัปโหลดสต๊อก SAP (${sapUploadCategory})`
                    : `Upload SAP Stock (${sapUploadCategory})`}
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
                {/* เลือกผลิตภัณฑ์ SAP ที่ต้องการอัปโหลด: Batch, VM, AB, STL, ฝาก หรือ Bundle */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {RM_SAP_BATCH_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setSapUploadCategory(cat);
                        setSapUploadType("batch");
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                        sapUploadCategory === cat
                          ? "bg-emerald-600 text-white border-emerald-500"
                          : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                      }`}
                    >
                      <Barcode size={13} />
                      <span>
                        {isThai ? `อัปโหลดสต๊อก SAP (${cat})` : `SAP (${cat})`}
                      </span>
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => {
                      setSapUploadCategory("Bundle");
                      setSapUploadType("bundle");
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      sapUploadCategory === "Bundle"
                        ? "bg-indigo-600 text-white border-indigo-500"
                        : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f]"
                    }`}
                  >
                    <ScanLine size={13} />
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
                  {sapCountByCategory[sapUploadCategory] > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        const remaining = rmSapItems.filter(
                          (item) => resolveSapItemCategory(item) !== sapUploadCategory
                        );
                        await saveRmSapChunksToCloud(remaining);
                        showToast(
                          isThai
                            ? `ล้างข้อมูล SAP (${sapUploadCategory}) แล้ว`
                            : `Cleared SAP (${sapUploadCategory})`,
                          "info"
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>
                        {isThai ? `ล้าง (${sapUploadCategory})` : `Clear (${sapUploadCategory})`}
                      </span>
                    </button>
                  )}
                  {rmSapItems.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await clearRmSapChunksFromCloud();
                        showToast(isThai ? "ล้างข้อมูล SAP ทั้งหมดแล้ว" : "Cleared all SAP", "info");
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>{isThai ? "ล้างทั้งหมด" : "Clear All"}</span>
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
                      ? `${sapUploadCategory}: ${parsedSapPreview.length.toLocaleString()} รายการ`
                      : `${sapUploadCategory}: ${parsedSapPreview.length.toLocaleString()} rows`}
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
                            <th className="text-right">{isThai ? "จำนวน" : "Quantity"}</th>
                            <th className="text-right">{isThai ? "น้ำหนัก" : "Weight"}</th>
                            <th className="text-right">
                              {isThai ? "ความสูงของกอง (ม.)" : "Stack Height (m)"}
                            </th>
                            <th>ผู้ผลิต</th>
                            <th>Sales Document</th>
                            <th className="text-center">Item</th>
                            <th>Text สภาพสินค้า</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedSapPreview.slice(0, 50).map((item, idx) => {
                            const rawNum =
                              parseFloat(String(item.unrestricted || "").replace(/,/g, "")) || 0;
                            const previewWeight =
                              item.weightKg > 0
                                ? item.weightKg
                                : resolveRmRowWeightKg(
                                    rawNum,
                                    item.certThickness,
                                    item.width,
                                    item.length
                                  );
                            const previewQty =
                              calculateRmQtyFromWeightKg(
                                previewWeight,
                                item.certThickness,
                                item.width,
                                item.length
                              ) ||
                              item.inboundQty ||
                              0;
                            const previewStackHeight = calculateRmStackHeight(
                              previewQty,
                              item.certThickness
                            );
                            return (
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
                                <td className="font-mono font-bold text-right text-sky-600 dark:text-sky-300">
                                  {previewQty > 0
                                    ? previewQty.toLocaleString(undefined, {
                                        minimumFractionDigits: 0,
                                        maximumFractionDigits: 2,
                                      })
                                    : "0"}
                                </td>
                                <td className="font-mono font-bold text-right text-emerald-600 dark:text-emerald-400">
                                  {previewWeight > 0
                                    ? previewWeight.toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 3,
                                      })
                                    : "0.00"}
                                </td>
                                <td className="font-mono font-bold text-right text-amber-600 dark:text-amber-400">
                                  {previewStackHeight > 0
                                    ? `${previewStackHeight.toLocaleString(undefined, {
                                        minimumFractionDigits: 3,
                                        maximumFractionDigits: 4,
                                      })} ม.`
                                    : "0.000 ม."}
                                </td>
                                <td>{item.manufacturer}</td>
                                <td className="font-mono">{item.salesDocument}</td>
                                <td className="font-mono text-center">{item.salesItem}</td>
                                <td>{item.conditionText}</td>
                              </tr>
                            );
                          })}
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
