import React, { useState, useEffect, useRef } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Image as ImageIcon,
  Trash2,
  Save,
  FileText,
  ShieldCheck,
  Truck,
  X,
  Scale,
} from "lucide-react";
import { subscribeToTmtRecheck, syncTmtRecheckState } from "../services/slitDataService";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";
import { showSuccessAlert, showWarningAlert, showErrorAlert } from "../utils/swalUtils";
import { WeightTicketModal } from "./WeightTicketModal";
import { TmtRecheckDailyReport } from "./TmtRecheckDailyReport";
import { appendWmsActivityLog } from "../services/authWorkforceService";

// ============================================================================
// Data Interfaces
// ============================================================================

export interface TmtRecheckSapRow {
  id: string;
  doNo: string; // 1. DO
  externalId1: string; // 2. External ID 1 (ทะเบียนรถ)
  soNo: string; // 3. SO
  soItem: string; // 4. Item
  material: string; // 5. Material
  customerName: string; // 6. Name
  description: string; // 7. Description(from DO)
  batch: string; // 8. Batch
  sloc: string; // 9. Sloc
  doQty: number; // 10. จำนวน DO
  grossWeight: number; // 11. Gross Weight (kg)
  docCreator: string; // 12. ผู้ทำเอกสาร (Do)
  doItem: string; // 13. Item
  pickingStatus: string; // 14. Picking status
  planGiDate: string; // 15. Plan GI date
  deliveryNoteStatus: string; // 16. ใบส่งสินค้า
  shipmentNo: string; // 17. Shipment no
  pmtTrmTxt: string; // 18. PmtTrm Txt
  requiresScan: boolean; // true for rows with Batch
  scanned: boolean;
  scannedAt?: string;
}

export interface TmtRecheckVehicleGroup {
  vehicleId: string; // ทะเบียนรถ (External ID 1)
  status: "pending" | "ready_to_inspect" | "scanning" | "completed";
  customerNames: string[];
  doNumbers: string[];
  soNumbers: string[];
  totalGrossWeight: number;
  items: TmtRecheckSapRow[];
  photos: { id: string; url: string; timestamp: string }[];
  importedAt: string;
  updatedAt: string;
  completedAt?: string;
  completedDate?: string; // YYYY-MM-DD
}

interface TmtRecheckViewProps {
  defaultTab?: "officer" | "inspector" | "report";
}

const LOCAL_STORAGE_ACTIVE_KEY = "tmt_recheck_active_vehicles_v1";
const LOCAL_STORAGE_COMPLETED_KEY = "tmt_recheck_completed_reports_v1";

// SAP Fiori Design Tokens (aligned with SlitFilmManagement)
const FIORI_BTN_BASE =
  "inline-flex min-h-[34px] items-center justify-center gap-[6px] rounded-[4px] border px-[14px] py-[7px] !text-[14px] font-semibold leading-tight whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45";

const FIORI_BTN_PRIMARY = `${FIORI_BTN_BASE} border-[#087eaf] bg-[#087eaf] text-white hover:bg-[#075985] hover:border-[#075985] dark:border-[#087eaf] dark:bg-[#087eaf] dark:text-white dark:hover:bg-[#075985] dark:hover:border-[#075985]`;

const FIORI_BTN_SECONDARY = `${FIORI_BTN_BASE} border-[#b9c9d2] bg-white text-[#075985] hover:bg-[#edf7fb] hover:border-[#087eaf] dark:border-[#1e3a5f] dark:bg-[#0d1b33] dark:text-[#38bdf8] dark:hover:bg-[#152b4f] dark:hover:border-[#38bdf8]`;

const FIORI_BTN_SUCCESS = `${FIORI_BTN_BASE} border-[#107e3e] bg-[#107e3e] text-white hover:bg-[#0d6933] hover:border-[#0d6933] dark:border-emerald-600 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-700 dark:hover:border-emerald-700`;

const FIORI_BTN_CRITICAL = `${FIORI_BTN_BASE} border-[#b45309] bg-[#b45309] text-white hover:bg-[#92400e] hover:border-[#92400e] dark:border-amber-600 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-700 dark:hover:border-amber-700`;

const FIORI_BTN_COMPACT_BASE =
  "inline-flex min-h-[30px] items-center justify-center gap-1.5 rounded-[4px] border px-2.5 py-1 !text-[12.5px] font-semibold leading-tight whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45";

const FIORI_BTN_COMPACT_SECONDARY = `${FIORI_BTN_COMPACT_BASE} border-[#b9c9d2] bg-white text-[#075985] hover:bg-[#edf7fb] hover:border-[#087eaf] dark:border-[#1e3a5f] dark:bg-[#0d1b33] dark:text-[#38bdf8] dark:hover:bg-[#152b4f] dark:hover:border-[#38bdf8]`;

const FIORI_BTN_COMPACT_CRITICAL = `${FIORI_BTN_COMPACT_BASE} border-[#f59e0b]/70 bg-[#fffbeb] text-[#b45309] hover:bg-[#fef3c7] hover:border-[#d97706] dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60`;

const FIORI_BTN_ICON_BASE =
  "inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[4px] border !text-[12px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45";

const FIORI_BTN_ICON_SECONDARY = `${FIORI_BTN_ICON_BASE} border-[#b9c9d2] bg-white text-[#075985] hover:bg-[#edf7fb] hover:border-[#087eaf] dark:border-[#1e3a5f] dark:bg-[#0d1b33] dark:text-[#38bdf8] dark:hover:bg-[#152b4f] dark:hover:border-[#38bdf8]`;

const FIORI_BTN_ICON_DANGER = `${FIORI_BTN_ICON_BASE} border-[#fca5a5] bg-white text-[#b91c1c] hover:bg-[#fee2e2] hover:border-[#ef4444] dark:border-[#7f1d1d] dark:bg-[#0d1b33] dark:text-[#fca5a5] dark:hover:bg-[#3b121b] dark:hover:border-[#ef4444]`;

const FIORI_CONTROL_INPUT =
  "h-[36px] rounded-[4px] border border-[#b9c9d2] dark:border-[#1e3a5f] bg-white dark:bg-[#041029] !text-[14px] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-[#087eaf] dark:focus:border-[#38bdf8] focus:outline-none transition-colors";

// Helper: Parse gross weight values safely without comma truncation (e.g. "3,473.000" -> 3473)
export function parseWeightNum(val: any): number {
  if (val === null || val === undefined) return 0;
  const cleaned = String(val).replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num);
}

// Helper: Web Audio Siren Sound for Mismatch Lockout Alarm
function playRedAlarmSiren() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.6);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.85);
  } catch {
    // Ignore audio autoplay restrictions
  }
}

// Helper: Web Audio Success Beep
function playSuccessBeep() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  } catch {
    // Ignore audio restriction
  }
}

// Image compression helper (keeps max dimension 1024px, JPEG quality 0.7)
async function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            width = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

// Helper: Validate and purge corrupt vehicle cards (e.g. numeric totals like "9,780.000" or empty Sloc cards)
export function isInvalidVehicleCard(v: TmtRecheckVehicleGroup): boolean {
  if (!v || !v.vehicleId || typeof v.vehicleId !== "string") return true;
  const cleanV = v.vehicleId.trim();
  if (cleanV === "" || cleanV === "UNKNOWN") return true;
  // If vehicleId is a numeric summary total like "9,780.000" or "9780.000" or contains commas
  if (/^[0-9.,\s]+$/.test(cleanV) || cleanV.includes(",")) return true;
  if (Array.isArray(v.items)) {
    if (v.items.length === 0) return true;
    const hasValidMaterial = v.items.some(
      (i) => (i.material && i.material.trim().length > 0) || (i.sloc && i.sloc.trim().length > 0)
    );
    if (!hasValidMaterial) return true;
  }
  return false;
}

export function sanitizeVehicleGroups(list: TmtRecheckVehicleGroup[]): TmtRecheckVehicleGroup[] {
  if (!Array.isArray(list)) return [];
  const validList = list.filter((v) => !isInvalidVehicleCard(v));

  // Auto-repair items and total weight if grossWeight values were truncated or corrupted previously,
  // and backfill material column from description if missing from older data
  return validList.map((v) => {
    let repaired = false;
    const items = (v.items || []).map((item) => {
      const fixedWeight = parseWeightNum(item.grossWeight);
      let mat = (item.material || "").trim();
      const desc = item.description || "";
      if (!mat) {
        if (desc.includes("เศษ") || desc.toUpperCase().includes("SCRAP")) {
          mat = "SCRAP-W";
        } else {
          mat = "2SLIT";
        }
        repaired = true;
      }
      if (fixedWeight !== item.grossWeight || mat !== item.material) {
        repaired = true;
        return { ...item, grossWeight: fixedWeight, material: mat };
      }
      return item;
    });
    const calculatedTotalWeight = items.reduce((sum, item) => sum + item.grossWeight, 0);
    if (repaired || v.totalGrossWeight !== calculatedTotalWeight) {
      return {
        ...v,
        items,
        totalGrossWeight: calculatedTotalWeight,
      };
    }
    return v;
  });
}

export function TmtRecheckView({ defaultTab = "officer" }: TmtRecheckViewProps) {
  const [activeTab, setActiveTab] = useState<"officer" | "inspector" | "report">(defaultTab);

  // Core State
  const [activeVehicles, setActiveVehicles] = useState<TmtRecheckVehicleGroup[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_ACTIVE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return sanitizeVehicleGroups(parsed);
    } catch {
      return [];
    }
  });

  const [completedReports, setCompletedReports] = useState<TmtRecheckVehicleGroup[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_COMPLETED_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return sanitizeVehicleGroups(parsed);
    } catch {
      return [];
    }
  });

  // Sync local storage & server
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LOCAL_STORAGE_ACTIVE_KEY, JSON.stringify(activeVehicles));
      } catch {
        // storage quota fallback
      }
    }
  }, [activeVehicles]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(LOCAL_STORAGE_COMPLETED_KEY, JSON.stringify(completedReports));
      } catch {
        // storage quota fallback
      }
    }
  }, [completedReports]);

  // Subscribe to real-time server SSE updates
  useEffect(() => {
    const unsub = subscribeToTmtRecheck((data) => {
      if (Array.isArray(data.activeVehicles)) {
        setActiveVehicles(sanitizeVehicleGroups(data.activeVehicles));
      }
      if (Array.isArray(data.completedReports)) {
        setCompletedReports(sanitizeVehicleGroups(data.completedReports));
      }
    });
    return () => unsub();
  }, []);

  const updateServerAndState = (
    newActive: TmtRecheckVehicleGroup[],
    newCompleted: TmtRecheckVehicleGroup[]
  ) => {
    const cleanActive = sanitizeVehicleGroups(newActive);
    const cleanCompleted = sanitizeVehicleGroups(newCompleted);
    setActiveVehicles(cleanActive);
    setCompletedReports(cleanCompleted);
    syncTmtRecheckState(cleanActive, cleanCompleted);
  };

  // Initial purge on mount to clean up any corrupt legacy state stored earlier
  useEffect(() => {
    const cleanActive = sanitizeVehicleGroups(activeVehicles);
    const cleanCompleted = sanitizeVehicleGroups(completedReports);
    if (cleanActive.length !== activeVehicles.length || cleanCompleted.length !== completedReports.length) {
      updateServerAndState(cleanActive, cleanCompleted);
    }
  }, []);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  // ============================================================================
  // Tab 1: Officer State & Handlers
  // ============================================================================
  const [rawSapInput, setRawSapInput] = useState("");
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);

  const handleParseAndImportSap = (textToParse: string) => {
    if (!textToParse.trim()) {
      setImportStatusMessage("กรุณาใส่ข้อมูล SAP ก่อนกดนำเข้า");
      return;
    }

    const lines = textToParse
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsedRows: TmtRecheckSapRow[] = [];
    let lastSeenDo = "";
    let lastSeenExternalId = "";

    lines.forEach((line, idx) => {
      let cols = line.split("\t");
      if (cols.length < 5) {
        cols = line.split(/,\s*/);
      }

      if (cols.length >= 5) {
        // Skip table header row if present
        if (
          cols[0]?.trim().toUpperCase() === "DO" ||
          cols[0]?.trim().toUpperCase() === "DELIVERY" ||
          cols[1]?.trim().toUpperCase() === "EXTERNAL ID 1" ||
          cols[1]?.trim().toUpperCase().includes("ทะเบียน") ||
          cols[4]?.trim().toUpperCase() === "MATERIAL" ||
          cols[8]?.trim().toUpperCase() === "SLOC"
        ) {
          return;
        }

        // User requirement: ยึดที่คอลัมน์ Material เป็นหลัก ไม่ต้องสนใจคอลัมน์ Batch
        // แถวสินค้าจริง (ทั้ง 2SLIT, 4SLIT, 2SCRAP-W, SCRAP-W) จะมีชื่อใน Material
        // แถว Sub-total / ผลรวมของ SAP คอลัมน์ Material จะเป็นค่าว่าง
        const rawMaterial = (cols[4] || "").trim().replace(/^["']|["']$/g, "");
        if (!rawMaterial || rawMaterial === "") {
          return; // Skip summary / subtotal rows where Material is empty
        }

        const externalId1 = cols[1]?.trim() || lastSeenExternalId || "";
        // If External ID 1 is empty or a numeric subtotal (e.g. "9,780.000"), skip
        if (!externalId1 || /^[0-9.,\s]+$/.test(externalId1) || externalId1.includes(",")) {
          return; // Skip subtotal rows
        }

        if (cols[1]?.trim() && !/^[0-9.,\s]+$/.test(cols[1].trim())) {
          lastSeenExternalId = cols[1].trim();
        }

        const rawDo = cols[0]?.trim() || "";
        if (rawDo) {
          lastSeenDo = rawDo;
        }
        const doNo = rawDo || (lastSeenExternalId === externalId1 && lastSeenDo ? lastSeenDo : `DO_${idx + 1}`);
        const soNo = cols[2]?.trim() || "-";
        const soItem = cols[3]?.trim() || "10";
        const customerName = cols[5]?.trim() || "ไม่ระบุชื่อลูกค้า";
        const description =
          cols[6]?.trim() ||
          (rawMaterial.toUpperCase().includes("SCRAP") ? "เศษคืนลูกค้า (KG)" : "เหล็กม้วนสลิต");
        const material = rawMaterial;
        const batch = cols[7]?.trim() || "";
        const sloc = cols[8]?.trim() || "-";
        const doQty = parseWeightNum(cols[9]);
        const grossWeight = parseWeightNum(cols[10]); // Use comma-safe parseWeightNum
        const docCreator = cols[11]?.trim() || "-";
        const doItem = cols[12]?.trim() || "10";
        const pickingStatus = cols[13]?.trim() || "A";
        const planGiDate = cols[14]?.trim() || new Date().toLocaleDateString("th-TH");
        const deliveryNoteStatus = cols[15]?.trim() || "ปกติ";
        const shipmentNo = cols[16]?.trim() || "-";
        const pmtTrmTxt = cols[17]?.trim() || "-";

        // Requires scan only if Batch is present and length >= 3 (e.g. coils)
        // Rows without Batch (e.g. 2SCRAP-W) do not require scanning
        const requiresScan = Boolean(batch && batch.length >= 3);

        parsedRows.push({
          id: `${doNo}_${externalId1}_${batch || idx}`,
          doNo,
          externalId1,
          soNo,
          soItem,
          material,
          customerName,
          description,
          batch,
          sloc,
          doQty,
          grossWeight,
          docCreator,
          doItem,
          pickingStatus,
          planGiDate,
          deliveryNoteStatus,
          shipmentNo,
          pmtTrmTxt,
          requiresScan,
          scanned: false,
        });
      }
    });

    if (parsedRows.length === 0) {
      setImportStatusMessage("ไม่พบรายการที่มีข้อมูล Material ถูกต้อง กรุณาตรวจสอบรูปแบบ TSV 18 คอลัมน์");
      return;
    }

    // Group by External ID 1 (ทะเบียนรถ)
    const groupedMap = new Map<string, TmtRecheckSapRow[]>();
    parsedRows.forEach((row) => {
      const vId = row.externalId1.toUpperCase();
      const existing = groupedMap.get(vId) || [];
      existing.push(row);
      groupedMap.set(vId, existing);
    });

    const nowIso = new Date().toISOString();
    // Sanitize activeVehicles to purge any invalid legacy cards
    let updatedActive = sanitizeVehicleGroups(activeVehicles);
    let replacedCount = 0;
    let newCount = 0;

    groupedMap.forEach((rows, vehicleId) => {
      const uniqueCustomers = Array.from(new Set(rows.map((r) => r.customerName)));
      const uniqueDos = Array.from(new Set(rows.map((r) => r.doNo)));
      const uniqueSos = Array.from(new Set(rows.map((r) => r.soNo)));
      const totalWeight = rows.reduce((sum, r) => sum + (r.grossWeight || 0), 0);

      const newGroup: TmtRecheckVehicleGroup = {
        vehicleId,
        status: "pending",
        customerNames: uniqueCustomers,
        doNumbers: uniqueDos,
        soNumbers: uniqueSos,
        totalGrossWeight: totalWeight,
        items: rows,
        photos: [],
        importedAt: nowIso,
        updatedAt: nowIso,
      };

      // Overwrite existing vehicle in active queue and reset scan state
      const existingIndex = updatedActive.findIndex((v) => v.vehicleId === vehicleId);
      if (existingIndex >= 0) {
        updatedActive[existingIndex] = newGroup;
        replacedCount++;
      } else {
        updatedActive.unshift(newGroup);
        newCount++;
      }
    });

    updateServerAndState(updatedActive, completedReports);
    setRawSapInput("");
    setImportStatusMessage(
      `นำเข้าสำเร็จ! เพิ่มทะเบียนรถใหม่ ${newCount} คัน${
        replacedCount > 0 ? ` (และรีเซ็ตเขียนทับข้อมูลเดิม ${replacedCount} คัน)` : ""
      } รวม ${parsedRows.length} รายการที่มี Sloc`
    );
  };

  const handleDeleteActiveVehicle = (vId: string) => {
    if (confirm(`คุณต้องการลบทะเบียนรถ [${vId}] ออกจากรายการค้างรอตรวจใช่หรือไม่?`)) {
      const nextActive = activeVehicles.filter((v) => v.vehicleId !== vId);
      updateServerAndState(nextActive, completedReports);
    }
  };

  // ============================================================================
  // Tab 2: Inspector Mobile-First State & Handlers
  // ============================================================================
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [scanInputText, setScanInputText] = useState("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  // Red Lockout Alert Modal State
  const [mismatchBatch, setMismatchBatch] = useState<string | null>(null);

  const selectedVehicle = activeVehicles.find((v) => v.vehicleId === selectedVehicleId) || null;

  // Auto-focus barcode input
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (selectedVehicleId && !mismatchBatch && activeTab === "inspector" && !showCameraScanner) {
      setTimeout(() => scanInputRef.current?.focus(), 150);
    }
  }, [selectedVehicleId, mismatchBatch, activeTab, showCameraScanner]);

  // Single "สแกน" button click handler:
  // If input has text -> execute scan; If empty -> toggle/open camera scanner
  const handleScanButtonClick = () => {
    if (scanInputText.trim()) {
      handleExecuteScanBatch(scanInputText);
    } else {
      setShowCameraScanner((prev) => !prev);
    }
  };

  // Handle Photo Upload (up to 50 photos limit)
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedVehicle || !e.target.files) return;
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (selectedVehicle.photos.length + files.length > 50) {
      void showWarningAlert(
        "เกินจำนวนรูปภาพสูงสุด",
        `อัปโหลดรูปภาพได้สูงสุด 50 รูปต่อทะเบียนรถ (ปัจจุบันมีแล้ว ${selectedVehicle.photos.length} รูป)`
      );
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const newPhotos: { id: string; url: string; timestamp: string }[] = [];
      for (const f of files) {
        const compressed = await compressImageFile(f);
        newPhotos.push({
          id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          url: compressed,
          timestamp: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
        });
      }

      const updatedVehicle: TmtRecheckVehicleGroup = {
        ...selectedVehicle,
        photos: [...selectedVehicle.photos, ...newPhotos],
        updatedAt: new Date().toISOString(),
      };

      const nextActive = activeVehicles.map((v) =>
        v.vehicleId === selectedVehicle.vehicleId ? updatedVehicle : v
      );
      updateServerAndState(nextActive, completedReports);
    } catch {
      void showErrorAlert("อัปโหลดรูปภาพไม่สำเร็จ", "เกิดข้อผิดพลาดในการบีบอัดรูปภาพ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = "";
    }
  };

  const handleDeletePhoto = (photoId: string) => {
    if (!selectedVehicle) return;
    const updatedVehicle: TmtRecheckVehicleGroup = {
      ...selectedVehicle,
      photos: selectedVehicle.photos.filter((p) => p.id !== photoId),
      updatedAt: new Date().toISOString(),
    };
    const nextActive = activeVehicles.map((v) =>
      v.vehicleId === selectedVehicle.vehicleId ? updatedVehicle : v
    );
    updateServerAndState(nextActive, completedReports);
  };

  // Button "บันทึกไว้ก่อน" -> set status to "ready_to_inspect"
  const handleSaveDraftStatus = () => {
    if (!selectedVehicle) return;
    const updatedVehicle: TmtRecheckVehicleGroup = {
      ...selectedVehicle,
      status: "ready_to_inspect",
      updatedAt: new Date().toISOString(),
    };
    const nextActive = activeVehicles.map((v) =>
      v.vehicleId === selectedVehicle.vehicleId ? updatedVehicle : v
    );
    updateServerAndState(nextActive, completedReports);
    void appendWmsActivityLog({
      module: "TMT Recheck",
      sectionId: "slit_ops",
      reference: selectedVehicle.vehicleId,
      activity: `บันทึกสถานะ [พร้อมตรวจสอบ] รถ ${selectedVehicle.vehicleId}`,
      status: "Pending",
    });
    void showSuccessAlert(
      "บันทึกสถานะสำเร็จ",
      `บันทึกสถานะ [พร้อมตรวจสอบ] สำหรับทะเบียนรถ ${selectedVehicle.vehicleId} เรียบร้อยแล้ว`
    );
  };

  // Barcode Scanning Handler
  const handleExecuteScanBatch = (scannedRaw: string) => {
    const cleaned = scannedRaw.trim().toUpperCase();
    if (!cleaned || !selectedVehicle) return;

    // Check if scanned batch exists in this vehicle's required batch list
    const batchRow = selectedVehicle.items.find(
      (item) => item.requiresScan && item.batch.trim().toUpperCase() === cleaned
    );

    if (!batchRow) {
      // MISMATCH OR WRONG TRUCK: Lock screen red alarm immediately!
      playRedAlarmSiren();
      setMismatchBatch(cleaned);
      setScanInputText("");
      return;
    }

    // Success Match
    playSuccessBeep();
    const updatedItems = selectedVehicle.items.map((item) => {
      if (item.requiresScan && item.batch.trim().toUpperCase() === cleaned) {
        return {
          ...item,
          scanned: true,
          scannedAt: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
        };
      }
      return item;
    });

    const updatedVehicle: TmtRecheckVehicleGroup = {
      ...selectedVehicle,
      items: updatedItems,
      status: "scanning",
      updatedAt: new Date().toISOString(),
    };

    const nextActive = activeVehicles.map((v) =>
      v.vehicleId === selectedVehicle.vehicleId ? updatedVehicle : v
    );
    updateServerAndState(nextActive, completedReports);
    setScanInputText("");
  };

  // Confirm loading complete -> Enforce batch scan & mandatory photo attachment
  const handleConfirmFinishVehicleLoading = async () => {
    if (!selectedVehicle) return;

    const reqScanCount = selectedVehicle.items.filter((i) => i.requiresScan).length;
    const scannedCount = selectedVehicle.items.filter((i) => i.requiresScan && i.scanned).length;

    if (scannedCount < reqScanCount) {
      await showWarningAlert(
        "ยังสแกน Batch ไม่ครบ",
        `กรุณาสแกนบาร์โค้ดให้ครบทุกรายการก่อนยืนยัน (สแกนแล้ว ${scannedCount}/${reqScanCount} ม้วน)`
      );
      return;
    }

    if (!selectedVehicle.photos || selectedVehicle.photos.length === 0) {
      await showWarningAlert(
        "บังคับแนบรูปภาพหลักฐาน",
        `กรุณาแนบรูปภาพสำหรับทะเบียนรถ [${selectedVehicle.vehicleId}] อย่างน้อย 1 รูปก่อนกดยืนยันข้อมูล`
      );
      return;
    }

    const now = new Date();
    const completedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const completedVehicle: TmtRecheckVehicleGroup = {
      ...selectedVehicle,
      status: "completed",
      completedAt: now.toISOString(),
      completedDate,
      updatedAt: now.toISOString(),
    };

    const nextActive = activeVehicles.filter((v) => v.vehicleId !== selectedVehicle.vehicleId);
    const nextCompleted = [completedVehicle, ...completedReports];

    updateServerAndState(nextActive, nextCompleted);
    void appendWmsActivityLog({
      module: "TMT Recheck",
      sectionId: "slit_ops",
      reference: selectedVehicle.vehicleId,
      activity: `ยืนยันขึ้นสินค้าครบถ้วน ทะเบียนรถ ${selectedVehicle.vehicleId} (${reqScanCount} ม้วน · รูป ${selectedVehicle.photos.length} รูป)`,
      status: "Completed",
    });
    setSelectedVehicleId(null);
    await showSuccessAlert(
      "ยืนยันข้อมูลสำเร็จ",
      `ทะเบียนรถ [${selectedVehicle.vehicleId}] ตรวจสอบขึ้นสินค้าครบถ้วนและย้ายเข้าหน้ารายงานประจำวันเรียบร้อยแล้ว`
    );
  };

  // ============================================================================
  // Tab 3: Photo & Weight Ticket Modal State
  // ============================================================================
  const [viewingPhotoModalGroup, setViewingPhotoModalGroup] = useState<TmtRecheckVehicleGroup | null>(null);

  // Weight Ticket Modal State
  const [isWeightTicketModalOpen, setIsWeightTicketModalOpen] = useState(false);
  const [weightTicketInitialVehicleId, setWeightTicketInitialVehicleId] = useState<string | null>(null);

  const handleOpenWeightTicketModal = (vId?: string) => {
    setWeightTicketInitialVehicleId(vId || null);
    setIsWeightTicketModalOpen(true);
  };

  return (
    <div className="space-y-3 w-full max-w-none">
      {/* ============================================================================ */}
      {/* Header Bar & Tab Switcher (SAP Fiori Style) */}
      {/* ============================================================================ */}
      <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-xs transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[4px] bg-[#edf7fb] dark:bg-[#0c2340] border border-[#b9c9d2] dark:border-[#1e3a5f] flex items-center justify-center text-[#087eaf] dark:text-[#38bdf8] shrink-0">
              <ShieldCheck size={18} />
            </div>
            <h2 className="text-[16px] font-bold text-[#1d2d3e] dark:text-white tracking-tight">
              TMT Recheck
            </h2>
          </div>

          {/* 3 Main Tabs (SAP Fiori Segmented Control) */}
          <div className="grid grid-cols-3 gap-1 bg-[#f5f7fa] dark:bg-[#0c1930] p-1 rounded-[4px] border border-[#b9c9d2] dark:border-[#1e3a5f] w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab("officer")}
              className={`min-h-[34px] px-2 sm:px-3.5 py-1.5 !text-[12.5px] sm:!text-[13.5px] font-semibold rounded-[4px] transition-colors flex items-center justify-center gap-1.5 min-w-0 cursor-pointer ${
                activeTab === "officer"
                  ? "bg-[#087eaf] text-white shadow-xs"
                  : "text-[#075985] dark:text-[#38bdf8] hover:bg-[#edf7fb] dark:hover:bg-[#152b4f]"
              }`}
            >
              <FileSpreadsheet size={15} className="shrink-0" />
              <span className="truncate">1. ออฟฟิศ</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("inspector")}
              className={`min-h-[34px] px-2 sm:px-3.5 py-1.5 !text-[12.5px] sm:!text-[13.5px] font-semibold rounded-[4px] transition-colors flex items-center justify-center gap-1.5 min-w-0 cursor-pointer ${
                activeTab === "inspector"
                  ? "bg-[#087eaf] text-white shadow-xs"
                  : "text-[#075985] dark:text-[#38bdf8] hover:bg-[#edf7fb] dark:hover:bg-[#152b4f]"
              }`}
            >
              <Truck size={15} className="shrink-0" />
              <span className="truncate">2. หน้างาน</span>
              {activeVehicles.length > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-[4px] text-[11px] font-mono tabular-nums font-bold shrink-0 ${
                    activeTab === "inspector"
                      ? "bg-white/20 text-white"
                      : "bg-[#fef3c7] dark:bg-amber-900/50 text-[#b45309] dark:text-amber-300 border border-[#f59e0b]/40"
                  }`}
                >
                  {activeVehicles.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("report")}
              className={`min-h-[34px] px-2 sm:px-3.5 py-1.5 !text-[12.5px] sm:!text-[13.5px] font-semibold rounded-[4px] transition-colors flex items-center justify-center gap-1.5 min-w-0 cursor-pointer ${
                activeTab === "report"
                  ? "bg-[#087eaf] text-white shadow-xs"
                  : "text-[#075985] dark:text-[#38bdf8] hover:bg-[#edf7fb] dark:hover:bg-[#152b4f]"
              }`}
            >
              <FileText size={15} className="shrink-0" />
              <span className="truncate">3. รายงานประจำวัน</span>
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================================ */}
      {/* TAB 1: พนักงานออฟฟิศ (Officer Mode) */}
      {/* ============================================================================ */}
      {activeTab === "officer" && (
        <div className="space-y-3">
          {/* Hidden on mobile (hidden md:block), visible only on Desktop */}
          <div className="hidden md:block bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] overflow-hidden shadow-xs transition-colors">
            <div className="bg-[#f5f8fa] dark:bg-[#0c1930] px-4 py-2.5 border-b border-[#d9e2e8] dark:border-[#1e3a5f] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="text-[#087eaf] dark:text-[#38bdf8]" size={16} />
                <h3 className="text-[14px] font-bold text-[#1d2d3e] dark:text-slate-100">
                  นำเข้าข้อมูลคิวขึ้นสินค้าจาก SAP (TSV 18 คอลัมน์)
                </h3>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <textarea
                rows={4}
                value={rawSapInput}
                onChange={(e) => setRawSapInput(e.target.value)}
                placeholder="คัดลอกตารางจาก SAP 18 คอลัมน์แล้ววางลงที่นี่..."
                className="w-full bg-white dark:bg-[#041029] border border-[#b9c9d2] dark:border-[#1e3a5f] rounded-[4px] p-3 !text-[13px] text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono focus:outline-none focus:border-[#087eaf] dark:focus:border-[#38bdf8] transition-colors resize-y"
              />

              {importStatusMessage && (
                <div
                  className={`text-[13px] px-3 py-2 rounded-[4px] border flex items-center gap-2 font-medium ${
                    importStatusMessage.includes("สำเร็จ")
                      ? "bg-[#ecfdf5] dark:bg-emerald-950/40 border-[#a7f3d0] dark:border-emerald-800/60 text-[#107e3e] dark:text-emerald-300"
                      : "bg-[#fffbeb] dark:bg-amber-950/40 border-[#fde68a] dark:border-amber-800/60 text-[#b45309] dark:text-amber-300"
                  }`}
                >
                  <CheckCircle2 size={15} className="shrink-0" />
                  <span>{importStatusMessage}</span>
                </div>
              )}

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => handleParseAndImportSap(rawSapInput)}
                  className={FIORI_BTN_PRIMARY}
                >
                  <Upload size={15} />
                  <span>นำเข้าข้อมูลคิวขึ้นสินค้า</span>
                </button>
              </div>
            </div>
          </div>

          {/* Active Vehicles Queue Table */}
          <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] overflow-hidden shadow-xs transition-colors">
            <div className="bg-[#f5f8fa] dark:bg-[#0c1930] px-4 py-2.5 border-b border-[#d9e2e8] dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Truck className="text-[#087eaf] dark:text-[#38bdf8]" size={16} />
                <h3 className="text-[14px] font-bold text-[#1d2d3e] dark:text-slate-100">
                  รายการทะเบียนรถในคิว
                </h3>
                <span className="px-2 py-0.5 rounded-[4px] bg-[#edf7fb] dark:bg-[#0c2340] border border-[#b9c9d2] dark:border-[#1e3a5f] text-[12px] font-mono tabular-nums font-bold text-[#075985] dark:text-[#38bdf8]">
                  {activeVehicles.length} คัน
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleOpenWeightTicketModal()}
                className={FIORI_BTN_CRITICAL}
                title="พิมพ์บัตรชั่งน้ำหนัก (แยกตาม DO)"
              >
                <Scale size={15} />
                <span>พิมพ์บัตรชั่ง</span>
              </button>
            </div>

            {activeVehicles.length === 0 ? (
              <div className="text-center py-10 px-4 text-slate-500 dark:text-slate-400 space-y-1.5">
                <Truck size={32} className="mx-auto opacity-40" />
                <p className="text-[13px]">ยังไม่มีคิวทะเบียนรถรอตรวจสอบ สามารถนำเข้าข้อมูล SAP ด้านบนได้เลย</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] text-left text-slate-700 dark:text-slate-300 border-collapse">
                  <thead className="bg-[#f5f8fa] dark:bg-[#0c1930] text-[#475569] dark:text-slate-300 font-semibold text-[12px] border-b border-[#d9e2e8] dark:border-[#1e3a5f]">
                    <tr>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">ทะเบียนรถ</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">ชื่อลูกค้า</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">เลขที่ DO / SO</th>
                      <th className="py-2.5 px-3.5 text-center whitespace-nowrap">ม้วน (สแกน)</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">น้ำหนักรวม (kg)</th>
                      <th className="py-2.5 px-3.5 text-center whitespace-nowrap">สถานะ</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5edf2] dark:divide-[#1e3a5f]/70">
                    {activeVehicles.map((v) => {
                      const reqCount = v.items.filter((i) => i.requiresScan).length;
                      const scannedCount = v.items.filter((i) => i.requiresScan && i.scanned).length;

                      return (
                        <tr key={v.vehicleId} className="hover:bg-[#f5f8fa] dark:hover:bg-[#0d1f3c] transition-colors">
                          <td className="py-2.5 px-3.5 font-mono tabular-nums font-bold text-[#075985] dark:text-[#38bdf8] whitespace-nowrap">
                            {v.vehicleId}
                          </td>
                          <td className="py-2.5 px-3.5 font-medium text-[#1d2d3e] dark:text-slate-100">
                            {v.customerNames.join(", ")}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                            {v.doNumbers.join(", ")}
                          </td>
                          <td className="py-2.5 px-3.5 text-center font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {scannedCount} / {reqCount}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-bold text-[#1d2d3e] dark:text-slate-100 whitespace-nowrap">
                            {v.totalGrossWeight.toLocaleString()} kg
                          </td>
                          <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-[4px] text-[11.5px] font-semibold border ${
                                v.status === "ready_to_inspect"
                                  ? "bg-[#ecfdf5] dark:bg-emerald-950/50 text-[#107e3e] dark:text-emerald-300 border-[#a7f3d0] dark:border-emerald-700/60"
                                  : v.status === "scanning"
                                  ? "bg-[#edf7fb] dark:bg-[#0c2340] text-[#075985] dark:text-[#38bdf8] border-[#b9c9d2] dark:border-[#1e3a5f]"
                                  : "bg-[#fffbeb] dark:bg-amber-950/50 text-[#b45309] dark:text-amber-300 border-[#fde68a] dark:border-amber-700/60"
                              }`}
                            >
                              {v.status === "ready_to_inspect" ? "พร้อมตรวจสอบ" : v.status === "scanning" ? "กำลังสแกน" : "รอตรวจสอบ"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenWeightTicketModal(v.vehicleId)}
                                className={FIORI_BTN_COMPACT_CRITICAL}
                                title="พิมพ์บัตรชั่งของคันนี้"
                              >
                                <Scale size={13} />
                                <span>บัตรชั่ง</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedVehicleId(v.vehicleId);
                                  setActiveTab("inspector");
                                }}
                                className={FIORI_BTN_COMPACT_SECONDARY}
                              >
                                ตรวจสอบ
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteActiveVehicle(v.vehicleId)}
                                className={FIORI_BTN_ICON_DANGER}
                                title="ลบรายการรถคันนี้"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* TAB 2: Inspector หน้างาน (SAP Fiori Mobile-Ready Touch UI) */}
      {/* ============================================================================ */}
      {activeTab === "inspector" && (
        <div className="space-y-3">
          {!selectedVehicle ? (
            /* Step 1: Truck Selection List */
            <div className="space-y-3">
              <div className="bg-[#f5f8fa] dark:bg-[#0c1930] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] px-4 py-2.5 shadow-xs flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-[#1d2d3e] dark:text-white">
                  เลือกทะเบียนรถเพื่อสแกนทวนสอบ
                </h3>
                <span className="px-2 py-0.5 rounded-[4px] bg-white dark:bg-[#08152d] border border-[#b9c9d2] dark:border-[#1e3a5f] text-[12px] text-[#075985] dark:text-[#38bdf8] font-mono tabular-nums font-bold">
                  {activeVehicles.length} คัน
                </span>
              </div>

              {activeVehicles.length === 0 ? (
                <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] p-8 text-center space-y-2">
                  <Truck size={36} className="mx-auto text-slate-400 dark:text-slate-600" />
                  <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">ยังไม่มีทะเบียนรถในคิวรอตรวจสอบ</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {activeVehicles.map((v) => {
                    const reqCount = v.items.filter((i) => i.requiresScan).length;
                    const scannedCount = v.items.filter((i) => i.requiresScan && i.scanned).length;

                    return (
                      <button
                        key={v.vehicleId}
                        type="button"
                        onClick={() => setSelectedVehicleId(v.vehicleId)}
                        className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] hover:border-[#087eaf] dark:hover:border-[#38bdf8] hover:bg-[#f8fbfd] dark:hover:bg-[#0d1f3c] rounded-[6px] p-3.5 text-left space-y-2.5 transition-colors shadow-xs cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[16px] font-mono tabular-nums font-bold text-[#075985] dark:text-[#38bdf8]">
                            {v.vehicleId}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-[4px] text-[11px] font-semibold border ${
                              v.status === "ready_to_inspect"
                                ? "bg-[#ecfdf5] dark:bg-emerald-950/50 text-[#107e3e] dark:text-emerald-300 border-[#a7f3d0] dark:border-emerald-700/60"
                                : v.status === "scanning"
                                ? "bg-[#edf7fb] dark:bg-[#0c2340] text-[#075985] dark:text-[#38bdf8] border-[#b9c9d2] dark:border-[#1e3a5f]"
                                : "bg-[#fffbeb] dark:bg-amber-950/50 text-[#b45309] dark:text-amber-300 border-[#fde68a] dark:border-amber-700/60"
                            }`}
                          >
                            {v.status === "ready_to_inspect" ? "พร้อมตรวจสอบ" : v.status === "scanning" ? "กำลังสแกน" : "รอตรวจสอบ"}
                          </span>
                        </div>

                        <p className="text-[13px] font-semibold text-[#1d2d3e] dark:text-slate-100 line-clamp-1">
                          {v.customerNames.join(", ")}
                        </p>

                        <div className="pt-2 border-t border-[#e5edf2] dark:border-[#1e3a5f] flex items-center justify-between text-[12px] font-mono tabular-nums">
                          <span className="text-slate-500 dark:text-slate-400">
                            ม้วน: <strong className="text-[#1d2d3e] dark:text-slate-100">{scannedCount}/{reqCount}</strong>
                          </span>
                          <span className={v.photos.length > 0 ? "text-[#107e3e] dark:text-emerald-400" : "text-[#b45309] dark:text-amber-400"}>
                            รูป: <strong>{v.photos.length}</strong>
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            น้ำหนัก: <strong className="text-[#1d2d3e] dark:text-slate-100">{v.totalGrossWeight.toLocaleString()} kg</strong>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Selected Vehicle Inspection View (Top-most Scanner Layout) */
            <div className="space-y-3">
              {/* 1. TOP-MOST BARCODE SCANNER & CAMERA SECTION */}
              <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] p-3.5 space-y-2.5 shadow-xs">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleScanButtonClick();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={scanInputRef}
                    type="text"
                    value={scanInputText}
                    onChange={(e) => setScanInputText(e.target.value)}
                    placeholder="ยิงบาร์โค้ด Bluetooth หรือพิมพ์ Batch..."
                    className={`${FIORI_CONTROL_INPUT} flex-1 !h-[42px] px-3 font-mono font-bold text-[#075985] dark:text-[#38bdf8]`}
                  />
                  <button
                    type="submit"
                    className={`${FIORI_BTN_PRIMARY} min-h-[42px] px-5`}
                  >
                    สแกน
                  </button>
                </form>

                {/* Clean Camera Scanner Modal / View */}
                {showCameraScanner && (
                  <div className="pt-2 border-t border-[#d9e2e8] dark:border-[#1e3a5f] space-y-2">
                    <CameraBarcodeScanner
                      onScan={(text) => {
                        setShowCameraScanner(false);
                        handleExecuteScanBatch(text);
                      }}
                      onClose={() => setShowCameraScanner(false)}
                    />
                  </div>
                )}
              </div>

              {/* 2. TOP ACTION BUTTONS & SUMMARY CARD */}
              <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] p-3.5 shadow-xs space-y-2.5">
                {/* Top Action Row: Left -> Select Other Truck, Right -> Attach Photo */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedVehicleId(null)}
                    className={FIORI_BTN_SECONDARY}
                  >
                    ← เลือกทะเบียนอื่น
                  </button>

                  <label
                    className={`${FIORI_BTN_BASE} ${
                      selectedVehicle.photos.length === 0
                        ? "border-[#b45309] bg-[#fffbeb] text-[#b45309] hover:bg-[#fef3c7] dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/60"
                        : "border-[#107e3e] bg-[#ecfdf5] text-[#107e3e] hover:bg-[#d1fae5] dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                    }`}
                  >
                    <Camera size={15} />
                    <span>
                      {isUploadingPhoto
                        ? "กำลังบีบอัด..."
                        : `แนบรูปภาพ * (${selectedVehicle.photos.length}/50)`}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotoUpload}
                      disabled={isUploadingPhoto}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Vehicle Info Summary Bar */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-[#e5edf2] dark:border-[#1e3a5f] pt-2.5 text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums font-extrabold text-[#075985] dark:text-[#38bdf8] text-[16px]">
                      {selectedVehicle.vehicleId}
                    </span>
                    <span className="font-semibold text-[#1d2d3e] dark:text-slate-100 line-clamp-1 max-w-[240px]">
                      {selectedVehicle.customerNames.join(", ")}
                    </span>
                  </div>

                  <div className="flex items-center gap-3.5 font-mono tabular-nums text-[13px] text-slate-600 dark:text-slate-300">
                    <span>
                      สแกน: <strong className="text-[#075985] dark:text-[#38bdf8]">{selectedVehicle.items.filter((i) => i.requiresScan && i.scanned).length}/{selectedVehicle.items.filter((i) => i.requiresScan).length}</strong>
                    </span>
                    <span>
                      รูปภาพ: <strong className={selectedVehicle.photos.length > 0 ? "text-[#107e3e] dark:text-emerald-400" : "text-[#b45309] dark:text-amber-400"}>{selectedVehicle.photos.length}</strong>
                    </span>
                    <span>
                      น้ำหนัก: <strong className="text-[#1d2d3e] dark:text-slate-100">{selectedVehicle.totalGrossWeight.toLocaleString()} kg</strong>
                    </span>
                  </div>
                </div>

                {/* Mandatory Photo Warning or Inline Thumbnail Previews */}
                {selectedVehicle.photos.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-[#fffbeb] dark:bg-amber-950/40 border border-[#fde68a] dark:border-amber-700/60 text-[#b45309] dark:text-amber-300 text-[12.5px] font-medium">
                    <AlertTriangle size={15} className="shrink-0 text-[#b45309] dark:text-amber-400" />
                    <span>บังคับแนบรูปภาพหลักฐานอย่างน้อย 1 รูป ก่อนกดปุ่มยืนยันข้อมูล</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-[#e5edf2] dark:border-[#1e3a5f]">
                    {selectedVehicle.photos.map((photo) => (
                      <div key={photo.id} className="relative w-12 h-12 rounded-[4px] border border-[#b9c9d2] dark:border-[#1e3a5f] overflow-hidden shrink-0">
                        <img src={photo.url} alt="Thumbnail" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(photo.id)}
                          aria-label="ลบรูปภาพ"
                          className="absolute top-0 right-0 w-5 h-5 bg-[#b91c1c] hover:bg-[#991b1b] text-white rounded-bl-[4px] flex items-center justify-center !text-[12px] font-bold cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. CHECKLIST TABLE & BOTTOM ACTIONS */}
              <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] p-3.5 space-y-3 shadow-xs">
                {/* 6-Column Checklist Table (Clean Headers without numbering or license plate column) */}
                <div className="overflow-x-auto rounded-[4px] border border-[#d9e2e8] dark:border-[#1e3a5f]">
                  <table className="w-full text-[12.5px] text-left text-slate-700 dark:text-slate-300 border-collapse">
                    <thead className="bg-[#f5f8fa] dark:bg-[#0c1930] text-[#475569] dark:text-slate-300 font-semibold text-[11.5px] border-b border-[#d9e2e8] dark:border-[#1e3a5f]">
                      <tr>
                        <th className="py-2.5 px-3 whitespace-nowrap">สถานะ</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">ชื่อลูกค้า</th>
                        <th className="py-2.5 px-3 font-mono whitespace-nowrap">Batch</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Description</th>
                        <th className="py-2.5 px-3 text-right font-mono whitespace-nowrap">น้ำหนัก (kg)</th>
                        <th className="py-2.5 px-3 font-mono whitespace-nowrap">SO</th>
                        <th className="py-2.5 px-3 font-mono whitespace-nowrap">DO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e5edf2] dark:divide-[#1e3a5f]/70 bg-white dark:bg-[#08152d]">
                      {selectedVehicle.items.map((item, idx) => (
                        <tr
                          key={item.id || idx}
                          className={
                            item.scanned
                              ? "bg-[#ecfdf5] dark:bg-emerald-950/30 text-[#107e3e] dark:text-emerald-300 font-medium"
                              : !item.requiresScan
                              ? "bg-[#f8fafc] dark:bg-[#0c1930]/60 text-slate-500 dark:text-slate-400"
                              : "hover:bg-[#f5f8fa] dark:hover:bg-[#0d1f3c]"
                          }
                        >
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {item.scanned ? (
                              <span className="text-[#107e3e] dark:text-emerald-400 font-semibold flex items-center gap-1">
                                <CheckCircle2 size={14} /> สแกนแล้ว
                              </span>
                            ) : !item.requiresScan ? (
                              <span className="text-[#b45309] dark:text-amber-300 text-[11px] font-semibold bg-[#fffbeb] dark:bg-amber-950/60 px-2 py-0.5 rounded-[4px] border border-[#fde68a] dark:border-amber-800/60">
                                เศษ (ไม่ต้องสแกน)
                              </span>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-400 font-mono">รอสแกน</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#1d2d3e] dark:text-slate-100 whitespace-nowrap">{item.customerName}</td>
                          <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-[#075985] dark:text-[#38bdf8] whitespace-nowrap">
                            {item.batch || "-"}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-[200px] truncate">
                            {item.description}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#1d2d3e] dark:text-slate-100 whitespace-nowrap">
                            {item.grossWeight.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">{item.soNo}</td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">{item.doNo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bottom Action Bar: "บันทึกไว้ก่อน" (left) + "ยืนยันข้อมูล" (right) */}
                {(() => {
                  const reqScanCount = selectedVehicle.items.filter((i) => i.requiresScan).length;
                  const scannedCount = selectedVehicle.items.filter((i) => i.requiresScan && i.scanned).length;
                  const isScanComplete =
                    selectedVehicle.items.length > 0 &&
                    (reqScanCount === 0 || scannedCount === reqScanCount);
                  const hasRequiredPhoto = (selectedVehicle.photos?.length || 0) > 0;
                  const isReadyToConfirm = isScanComplete && hasRequiredPhoto;

                  return (
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleSaveDraftStatus}
                        className={`${FIORI_BTN_SECONDARY} min-h-[40px] px-4`}
                      >
                        <Save size={15} />
                        <span>บันทึกไว้ก่อน</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleConfirmFinishVehicleLoading}
                        disabled={!isReadyToConfirm}
                        className={`flex-1 min-h-[40px] ${
                          isReadyToConfirm
                            ? FIORI_BTN_SUCCESS
                            : `${FIORI_BTN_BASE} border-[#b9c9d2] dark:border-[#1e3a5f] bg-[#f1f5f9] dark:bg-[#0c1930] text-slate-500 dark:text-slate-400`
                        }`}
                      >
                        <CheckCircle2 size={16} />
                        <span className="truncate">
                          {!isScanComplete
                            ? `ยังสแกน Batch ไม่ครบ (${scannedCount}/${reqScanCount} ม้วน)`
                            : !hasRequiredPhoto
                            ? "กรุณาแนบรูปภาพก่อนยืนยัน (อย่างน้อย 1 รูป)"
                            : "ยืนยันข้อมูล"}
                        </span>
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================================ */}
      {/* TAB 3: รายงานการขึ้นสินค้าประจำวัน (Executive Daily Report & LINE Share) */}
      {/* ============================================================================ */}
      {activeTab === "report" && (
        <TmtRecheckDailyReport
          activeVehicles={activeVehicles}
          completedReports={completedReports}
          onOpenWeightTicket={handleOpenWeightTicketModal}
          onViewPhotos={(group) => setViewingPhotoModalGroup(group)}
          onNavigateToInspector={(vId) => {
            setSelectedVehicleId(vId);
            setActiveTab("inspector");
          }}
        />
      )}

      {/* ============================================================================ */}
      {/* RED LOCKOUT ALARM MODAL (Scanned Batch Mismatch Guard) */}
      {/* ============================================================================ */}
      {mismatchBatch && selectedVehicle && (
        <div className="fixed inset-0 z-50 bg-red-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#7f1d1d] border-2 border-red-400 rounded-[6px] p-6 max-w-lg w-full text-center space-y-5 shadow-2xl">
            <div className="w-16 h-16 mx-auto rounded-[6px] bg-red-600 text-white flex items-center justify-center shadow-lg">
              <AlertTriangle size={38} />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-[18px] font-extrabold text-white tracking-wide">
                เตือนภัย! สแกน Batch ไม่ถูกต้อง
              </h3>
              <p className="text-[13px] font-medium text-red-100 leading-relaxed">
                บาร์โค้ด Batch ที่สแกน [<span className="font-mono text-yellow-300 text-[14px] font-bold">{mismatchBatch}</span>] ไม่ตรงกับรายการของทะเบียนรถ [<span className="font-mono text-white text-[14px] font-bold">{selectedVehicle.vehicleId}</span>]
              </p>
            </div>

            <div className="bg-red-950/80 p-3.5 rounded-[4px] border border-red-700 text-left text-[13px] text-red-100 space-y-1">
              <p className="font-bold text-yellow-300">ห้ามนำม้วนนี้ขึ้นรถเด็ดขาด!</p>
              <p>• ม้วนนี้อาจเป็นของรถคันอื่น หรือไม่ได้อยู่ในใบสั่ง SAP</p>
            </div>

            <button
              type="button"
              onClick={() => setMismatchBatch(null)}
              className="w-full min-h-[42px] rounded-[4px] border border-white bg-white text-[#991b1b] hover:bg-red-50 font-bold !text-[14px] shadow-md transition-colors cursor-pointer"
            >
              รับทราบและปิดการเตือน (สแกนใหม่)
            </button>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* Photo Gallery Modal (SAP Fiori Dialog) */}
      {/* ============================================================================ */}
      {viewingPhotoModalGroup && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="bg-[#f5f8fa] dark:bg-[#0c1930] px-4 py-3 border-b border-[#d9e2e8] dark:border-[#1e3a5f] flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-bold text-[#1d2d3e] dark:text-white flex items-center gap-2">
                <ImageIcon size={16} className="text-[#087eaf] dark:text-[#38bdf8]" />
                <span>ภาพถ่ายหลักฐาน - ทะเบียนรถ: {viewingPhotoModalGroup.vehicleId}</span>
              </h3>
              <button
                type="button"
                onClick={() => setViewingPhotoModalGroup(null)}
                aria-label="ปิดหน้าต่าง"
                className={FIORI_BTN_ICON_SECONDARY}
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {viewingPhotoModalGroup.photos.map((photo) => (
                <div key={photo.id} className="rounded-[4px] overflow-hidden border border-[#d9e2e8] dark:border-[#1e3a5f] bg-[#f5f8fa] dark:bg-[#0c1930] p-1.5 space-y-1">
                  <img src={photo.url} alt="Proof" className="w-full aspect-square object-cover rounded-[2px]" />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center font-mono tabular-nums">{photo.timestamp}</p>
                </div>
              ))}
            </div>

            <div className="bg-[#f5f8fa] dark:bg-[#0c1930] px-4 py-3 border-t border-[#d9e2e8] dark:border-[#1e3a5f] flex items-center justify-end">
              <button
                type="button"
                onClick={() => setViewingPhotoModalGroup(null)}
                className={FIORI_BTN_SECONDARY}
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* Weight Ticket Modal (พิมพ์บัตรชั่งน้ำหนัก แยกตาม DO) */}
      {/* ============================================================================ */}
      <WeightTicketModal
        isOpen={isWeightTicketModalOpen}
        onClose={() => setIsWeightTicketModalOpen(false)}
        activeVehicles={activeVehicles}
        completedReports={completedReports}
        initialVehicleId={weightTicketInitialVehicleId}
      />
    </div>
  );
}
