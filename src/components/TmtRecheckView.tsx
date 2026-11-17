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
  Search,
  Printer,
  FileText,
  ShieldCheck,
  Truck,
  X,
  Calendar,
  Building2,
  ChevronDown,
  ChevronUp,
  Scale,
} from "lucide-react";
import { subscribeToTmtRecheck, syncTmtRecheckState } from "../services/slitDataService";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";
import { showSuccessAlert, showWarningAlert, showErrorAlert } from "../utils/swalUtils";
import { WeightTicketModal } from "./WeightTicketModal";
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
  // Tab 3: Daily Report State & Filter
  // ============================================================================
  const [reportSearchQuery, setReportSearchQuery] = useState("");
  const [reportDateFilter, setReportDateFilter] = useState<string>("");
  const [viewingPhotoModalGroup, setViewingPhotoModalGroup] = useState<TmtRecheckVehicleGroup | null>(null);

  // Weight Ticket Modal State
  const [isWeightTicketModalOpen, setIsWeightTicketModalOpen] = useState(false);
  const [weightTicketInitialVehicleId, setWeightTicketInitialVehicleId] = useState<string | null>(null);

  const handleOpenWeightTicketModal = (vId?: string) => {
    setWeightTicketInitialVehicleId(vId || null);
    setIsWeightTicketModalOpen(true);
  };

  // Accordion Expand/Collapse State (default is collapsed)
  const [expandedVehicleIds, setExpandedVehicleIds] = useState<Record<string, boolean>>({});

  const toggleExpandVehicle = (vehicleId: string) => {
    setExpandedVehicleIds((prev) => ({
      ...prev,
      [vehicleId]: !prev[vehicleId],
    }));
  };

  const expandAllVehicles = () => {
    const next: Record<string, boolean> = {};
    filteredCompletedReports.forEach((v) => {
      next[v.vehicleId] = true;
    });
    setExpandedVehicleIds(next);
  };

  const collapseAllVehicles = () => {
    setExpandedVehicleIds({});
  };

  // Grouping completed reports by Date -> Customer Name
  const filteredCompletedReports = completedReports.filter((report) => {
    if (reportDateFilter && report.completedDate !== reportDateFilter) return false;
    if (!reportSearchQuery.trim()) return true;
    const q = reportSearchQuery.toLowerCase();
    const matchVehicle = report.vehicleId.toLowerCase().includes(q);
    const matchCustomer = report.customerNames.some((c) => c.toLowerCase().includes(q));
    const matchDo = report.doNumbers.some((d) => d.toLowerCase().includes(q));
    const matchBatch = report.items.some((i) => i.batch.toLowerCase().includes(q));
    return matchVehicle || matchCustomer || matchDo || matchBatch;
  });

  const dateGroupedMap = new Map<string, TmtRecheckVehicleGroup[]>();
  filteredCompletedReports.forEach((rep) => {
    const d = rep.completedDate || rep.completedAt?.slice(0, 10) || "ไม่ระบุวันที่";
    const existing = dateGroupedMap.get(d) || [];
    existing.push(rep);
    dateGroupedMap.set(d, existing);
  });

  return (
    <div className="space-y-3 max-w-5xl mx-auto">
      {/* ============================================================================ */}
      {/* Header Bar & Tab Switcher (Compact Mobile Layout) */}
      {/* ============================================================================ */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
              <ShieldCheck size={18} />
            </div>
            <h2 className="text-base font-bold text-white tracking-wide">
              TMT Recheck
            </h2>
          </div>

          {/* 3 Main Tabs (Single row grid layout for mobile - no horizontal scroll) */}
          <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab("officer")}
              className={`px-1 sm:px-2.5 py-1.5 text-[10.5px] sm:text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1 min-w-0 ${
                activeTab === "officer"
                  ? "bg-cyan-500 text-slate-950 font-bold shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileSpreadsheet size={13} className="shrink-0" />
              <span className="truncate">1. ออฟฟิศ</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("inspector")}
              className={`px-1 sm:px-2.5 py-1.5 text-[10.5px] sm:text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1 min-w-0 ${
                activeTab === "inspector"
                  ? "bg-cyan-500 text-slate-950 font-bold shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Truck size={13} className="shrink-0" />
              <span className="truncate">2. หน้างาน</span>
              {activeVehicles.length > 0 && (
                <span className="px-1 py-0.2 rounded-full text-[9px] bg-amber-500 text-slate-950 font-extrabold shrink-0">
                  {activeVehicles.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("report")}
              className={`px-1 sm:px-2.5 py-1.5 text-[10.5px] sm:text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1 min-w-0 ${
                activeTab === "report"
                  ? "bg-cyan-500 text-slate-950 font-bold shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileText size={13} className="shrink-0" />
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
          <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="text-cyan-400" size={16} />
                <h3 className="text-xs font-bold text-slate-200">
                  นำเข้าข้อมูลคิวขึ้นสินค้าจาก SAP (TSV 18 คอลัมน์)
                </h3>
              </div>
            </div>

            <textarea
              rows={4}
              value={rawSapInput}
              onChange={(e) => setRawSapInput(e.target.value)}
              placeholder="คัดลอกตารางจาก SAP 18 คอลัมน์แล้ววางลงที่นี่..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 transition-all resize-y"
            />

            {importStatusMessage && (
              <div
                className={`text-xs p-2.5 rounded-lg border flex items-center gap-2 ${
                  importStatusMessage.includes("สำเร็จ")
                    ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                    : "bg-amber-950/40 border-amber-800/60 text-amber-300"
                }`}
              >
                <CheckCircle2 size={14} />
                <span>{importStatusMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleParseAndImportSap(rawSapInput)}
                className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <Upload size={14} />
                <span>นำเข้าข้อมูลคิวขึ้นสินค้า</span>
              </button>
            </div>
          </div>

          {/* Active Vehicles Queue Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Truck className="text-cyan-400" size={16} />
                <h3 className="text-xs font-bold text-slate-200">
                  รายการทะเบียนรถในคิว ({activeVehicles.length} คัน)
                </h3>
              </div>

              <button
                type="button"
                onClick={() => handleOpenWeightTicketModal()}
                className="px-2.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer"
                title="พิมพ์บัตรชั่งน้ำหนัก (แยกตาม DO)"
              >
                <Scale size={14} />
                <span>พิมพ์บัตรชั่ง</span>
              </button>
            </div>

            {activeVehicles.length === 0 ? (
              <div className="text-center py-8 text-slate-500 space-y-1">
                <Truck size={32} className="mx-auto opacity-40" />
                <p className="text-xs">ยังไม่มีคิวทะเบียนรถรอตรวจสอบ สามารถนำเข้าข้อมูล SAP ด้านบนได้เลย</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase font-semibold text-[10.5px] border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">ทะเบียนรถ</th>
                      <th className="py-2.5 px-3">ชื่อลูกค้า</th>
                      <th className="py-2.5 px-3">เลขที่ DO / SO</th>
                      <th className="py-2.5 px-3 text-center">ม้วน (สแกน)</th>
                      <th className="py-2.5 px-3 text-right">น้ำหนักรวม (kg)</th>
                      <th className="py-2.5 px-3 text-center">สถานะ</th>
                      <th className="py-2.5 px-3 text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {activeVehicles.map((v) => {
                      const reqCount = v.items.filter((i) => i.requiresScan).length;
                      const scannedCount = v.items.filter((i) => i.requiresScan && i.scanned).length;

                      return (
                        <tr key={v.vehicleId} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-cyan-400">
                            {v.vehicleId}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-100">
                            {v.customerNames.join(", ")}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            {v.doNumbers.join(", ")}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-200">
                            {scannedCount} / {reqCount}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-200">
                            {v.totalGrossWeight.toLocaleString()} kg
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                v.status === "ready_to_inspect"
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                  : v.status === "scanning"
                                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                                  : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                              }`}
                            >
                              {v.status === "ready_to_inspect" ? "พร้อมตรวจสอบ" : v.status === "scanning" ? "กำลังสแกน" : "รอตรวจสอบ"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleOpenWeightTicketModal(v.vehicleId)}
                              className="px-2 py-1 bg-amber-950/80 text-amber-300 hover:bg-amber-900 border border-amber-800/60 rounded text-[11px] font-medium transition-colors"
                              title="พิมพ์บัตรชั่งของคันนี้"
                            >
                              <Scale size={12} className="inline mr-1" />
                              บัตรชั่ง
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedVehicleId(v.vehicleId);
                                setActiveTab("inspector");
                              }}
                              className="px-2.5 py-1 bg-cyan-950 text-cyan-400 hover:bg-cyan-900 border border-cyan-800/60 rounded text-[11px] font-medium transition-colors"
                            >
                              ตรวจสอบ
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteActiveVehicle(v.vehicleId)}
                              className="px-2 py-1 bg-red-950/60 text-red-400 hover:bg-red-900 border border-red-800/60 rounded text-[11px] transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
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
      {/* TAB 2: Inspector หน้างาน (Compact Mobile Touch UI) */}
      {/* ============================================================================ */}
      {activeTab === "inspector" && (
        <div className="space-y-3">
          {!selectedVehicle ? (
            /* Step 1: Truck Selection List */
            <div className="space-y-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-xs flex items-center justify-between">
                <h3 className="text-xs font-bold text-white">
                  เลือกทะเบียนรถเพื่อสแกนทวนสอบ
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  ({activeVehicles.length} คัน)
                </span>
              </div>

              {activeVehicles.length === 0 ? (
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-2">
                  <Truck size={36} className="mx-auto text-slate-600" />
                  <p className="text-xs font-medium text-slate-300">ยังไม่มีทะเบียนรถในคิวรอตรวจสอบ</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {activeVehicles.map((v) => {
                    const reqCount = v.items.filter((i) => i.requiresScan).length;
                    const scannedCount = v.items.filter((i) => i.requiresScan && i.scanned).length;

                    return (
                      <button
                        key={v.vehicleId}
                        type="button"
                        onClick={() => setSelectedVehicleId(v.vehicleId)}
                        className="bg-slate-900 border border-slate-800 hover:border-cyan-500/60 rounded-xl p-3 text-left space-y-2 transition-all active:scale-[0.99] shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-base font-mono font-bold text-cyan-400">
                            {v.vehicleId}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              v.status === "ready_to_inspect"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : v.status === "scanning"
                                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                                : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            }`}
                          >
                            {v.status === "ready_to_inspect" ? "พร้อมตรวจสอบ" : v.status === "scanning" ? "กำลังสแกน" : "รอตรวจสอบ"}
                          </span>
                        </div>

                        <p className="text-xs font-semibold text-slate-200 line-clamp-1">
                          {v.customerNames.join(", ")}
                        </p>

                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-400">
                            ม้วน: <strong className="text-slate-200">{scannedCount}/{reqCount}</strong>
                          </span>
                          <span className={v.photos.length > 0 ? "text-emerald-400" : "text-amber-400"}>
                            รูป: <strong>{v.photos.length}</strong>
                          </span>
                          <span className="text-slate-400">
                            น้ำหนัก: <strong className="text-slate-200">{v.totalGrossWeight.toLocaleString()} kg</strong>
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
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2 shadow-md">
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
                    className="flex-1 min-h-[44px] bg-slate-950 border border-cyan-500/60 rounded-xl px-3 text-xs font-mono font-bold text-cyan-300 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] px-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold text-xs rounded-xl transition-all active:scale-[0.97] shrink-0"
                  >
                    สแกน
                  </button>
                </form>

                {/* Clean Camera Scanner Modal / View */}
                {showCameraScanner && (
                  <div className="pt-2 border-t border-slate-800 space-y-2">
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
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-sm space-y-2.5">
                {/* Top Action Row: Left -> Select Other Truck, Right -> Attach Photo */}
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedVehicleId(null)}
                    className="text-xs text-slate-300 hover:text-white flex items-center gap-1 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 font-semibold"
                  >
                    ← เลือกทะเบียนอื่น
                  </button>

                  <label
                    className={`min-h-[36px] px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-[0.98] shrink-0 border ${
                      selectedVehicle.photos.length === 0
                        ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/60 shadow-xs"
                        : "bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/70"
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
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-800/80 pt-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-cyan-400 text-base">
                      {selectedVehicle.vehicleId}
                    </span>
                    <span className="font-semibold text-slate-200 line-clamp-1 max-w-[220px]">
                      {selectedVehicle.customerNames.join(", ")}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-xs text-slate-300">
                    <span>
                      สแกน: <strong className="text-cyan-400">{selectedVehicle.items.filter((i) => i.requiresScan && i.scanned).length}/{selectedVehicle.items.filter((i) => i.requiresScan).length}</strong>
                    </span>
                    <span>
                      รูปภาพ: <strong className={selectedVehicle.photos.length > 0 ? "text-emerald-400" : "text-amber-400"}>{selectedVehicle.photos.length}</strong>
                    </span>
                    <span>
                      น้ำหนัก: <strong className="text-slate-100">{selectedVehicle.totalGrossWeight.toLocaleString()} kg</strong>
                    </span>
                  </div>
                </div>

                {/* Mandatory Photo Warning or Inline Thumbnail Previews */}
                {selectedVehicle.photos.length === 0 ? (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-950/40 border border-amber-700/60 text-amber-300 text-[11px] font-medium">
                    <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                    <span>บังคับแนบรูปภาพหลักฐานอย่างน้อย 1 รูป ก่อนกดปุ่มยืนยันข้อมูล</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-800/60">
                    {selectedVehicle.photos.map((photo) => (
                      <div key={photo.id} className="relative w-10 h-10 rounded border border-slate-700 overflow-hidden shrink-0">
                        <img src={photo.url} alt="Thumbnail" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(photo.id)}
                          className="absolute top-0 right-0 w-4 h-4 bg-red-600 text-white rounded-bl flex items-center justify-center text-[10px] font-bold"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. CHECKLIST TABLE & BOTTOM ACTIONS */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-3 shadow-md">
                {/* 6-Column Checklist Table (Clean Headers without numbering or license plate column) */}
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-[11px] text-left text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="py-2 px-2.5">สถานะ</th>
                        <th className="py-2 px-2.5">ชื่อลูกค้า</th>
                        <th className="py-2 px-2.5 font-mono">Batch</th>
                        <th className="py-2 px-2.5">Description</th>
                        <th className="py-2 px-2.5 text-right font-mono">น้ำหนัก (kg)</th>
                        <th className="py-2 px-2.5 font-mono">SO</th>
                        <th className="py-2 px-2.5 font-mono">DO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 bg-slate-900">
                      {selectedVehicle.items.map((item, idx) => (
                        <tr
                          key={item.id || idx}
                          className={
                            item.scanned
                              ? "bg-emerald-950/30 text-emerald-300 font-medium"
                              : !item.requiresScan
                              ? "bg-slate-950/40 text-slate-400"
                              : "hover:bg-slate-800/40"
                          }
                        >
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            {item.scanned ? (
                              <span className="text-emerald-400 font-bold flex items-center gap-1">
                                <CheckCircle2 size={14} /> สแกนแล้ว
                              </span>
                            ) : !item.requiresScan ? (
                              <span className="text-amber-400 text-[9.5px] bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
                                เศษ (ไม่ต้องสแกน)
                              </span>
                            ) : (
                              <span className="text-slate-500 font-mono">รอสแกน</span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 font-medium text-slate-100 whitespace-nowrap">{item.customerName}</td>
                          <td className="py-2 px-2.5 font-mono font-bold text-cyan-300 whitespace-nowrap">
                            {item.batch || "-"}
                          </td>
                          <td className="py-2 px-2.5 text-slate-300 max-w-[180px] truncate">
                            {item.description}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-100 whitespace-nowrap">
                            {item.grossWeight.toLocaleString()}
                          </td>
                          <td className="py-2 px-2.5 font-mono text-slate-400 whitespace-nowrap">{item.soNo}</td>
                          <td className="py-2 px-2.5 font-mono text-slate-400 whitespace-nowrap">{item.doNo}</td>
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
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleSaveDraftStatus}
                        className="min-h-[44px] px-3.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-all active:scale-[0.97]"
                      >
                        <Save size={14} />
                        <span>บันทึกไว้ก่อน</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleConfirmFinishVehicleLoading}
                        disabled={!isReadyToConfirm}
                        className={`flex-1 min-h-[44px] rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all ${
                          isReadyToConfirm
                            ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 active:scale-[0.98]"
                            : "bg-slate-800 text-slate-400 border border-slate-700 opacity-75 cursor-not-allowed"
                        }`}
                      >
                        <CheckCircle2 size={16} />
                        <span>
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
      {/* TAB 3: รายงานการขึ้นสินค้าประจำวัน (Daily Loading Inspection Report) */}
      {/* ============================================================================ */}
      {activeTab === "report" && (
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 sm:px-[18px] sm:py-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <input
                  type="text"
                  value={reportSearchQuery}
                  onChange={(e) => setReportSearchQuery(e.target.value)}
                  placeholder="ค้นหาทะเบียนรถ, ชื่อลูกค้า, DO, SO หรือ Batch..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-md font-normal text-slate-200 focus:outline-none focus:border-cyan-500"
                  style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <input
                type="date"
                value={reportDateFilter}
                onChange={(e) => setReportDateFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-md font-normal text-slate-200 [color-scheme:dark] focus:outline-none focus:border-cyan-500"
                style={{ height: 35, minHeight: 35, padding: "6px 8px", borderRadius: 6, fontSize: 12 }}
              />
              {reportDateFilter && (
                <button
                  type="button"
                  onClick={() => setReportDateFilter("")}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  ล้าง
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => handleOpenWeightTicketModal()}
                className="hidden sm:inline-flex px-2.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 rounded-lg text-[11px] sm:text-xs font-bold items-center gap-1 shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
                title="พิมพ์บัตรชั่งน้ำหนัก (แยกตาม DO)"
              >
                <Scale size={14} />
                <span>พิมพ์บัตรชั่ง</span>
              </button>

              <button
                type="button"
                onClick={expandAllVehicles}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center gap-1 transition-all active:scale-95 whitespace-nowrap shrink-0"
                title="ขยายตารางทั้งหมด"
              >
                <ChevronDown size={14} />
                <span>ขยายทั้งหมด</span>
              </button>

              <button
                type="button"
                onClick={collapseAllVehicles}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-[11px] sm:text-xs font-semibold inline-flex items-center gap-1 transition-all active:scale-95 whitespace-nowrap shrink-0"
                title="ย่อตารางทั้งหมด"
              >
                <ChevronUp size={14} />
                <span>ย่อทั้งหมด</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="hidden sm:inline-flex px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold items-center gap-1.5 shrink-0 whitespace-nowrap"
              >
                <Printer size={14} />
                <span>พิมพ์</span>
              </button>
            </div>
          </div>

          {/* Grouped Reports Display (Flat & Collapsible Accordion Layout) */}
          {filteredCompletedReports.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-2">
              <FileText size={36} className="mx-auto text-slate-600" />
              <p className="text-xs font-medium text-slate-300">ยังไม่มีรายงานการขึ้นสินค้าที่ตรวจสอบเสร็จสิ้น</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredCompletedReports.map((v) => {
                const dateStr = v.completedDate || v.completedAt?.slice(0, 10) || "ไม่ระบุวันที่";
                const custName = v.customerNames.join(", ") || "ไม่ระบุชื่อลูกค้า";
                const isExpanded = Boolean(expandedVehicleIds[v.vehicleId]);

                return (
                  <div key={v.vehicleId} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xs transition-all">
                    {/* Compact Accordion Header Strip */}
                    <div
                      onClick={() => toggleExpandVehicle(v.vehicleId)}
                      className="bg-slate-950 p-2.5 sm:px-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs cursor-pointer hover:bg-slate-900/90 transition-colors select-none"
                    >
                      {/* Left side: Chevron icon, Date, Vehicle ID, Customer Name */}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="w-5 h-5 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 shrink-0">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                        <span className="font-mono text-cyan-300 font-bold bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/80 text-[11px] flex items-center gap-1">
                          <Calendar size={12} className="text-cyan-400" />
                          <span>{dateStr}</span>
                        </span>
                        <span className="font-mono font-extrabold text-white text-sm">
                          {v.vehicleId}
                        </span>
                        <span className="text-slate-300 font-medium truncate max-w-[180px] sm:max-w-[320px]">
                          {custName}
                        </span>
                      </div>

                      {/* Right side: Status, Photo Modal Button, Print Ticket Button, Total Gross Weight */}
                      <div className="flex items-center gap-2.5 font-mono text-[11px] shrink-0">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold">
                          ตรวจเสร็จสิ้น
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenWeightTicketModal(v.vehicleId);
                          }}
                          className="hidden sm:inline-flex text-amber-400 hover:text-amber-300 items-center gap-1 font-sans text-xs underline font-semibold cursor-pointer whitespace-nowrap shrink-0"
                          title="พิมพ์บัตรชั่งของคันนี้"
                        >
                          <Scale size={13} />
                          <span>บัตรชั่ง</span>
                        </button>

                        {v.photos.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewingPhotoModalGroup(v);
                            }}
                            className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-sans text-xs underline font-semibold"
                          >
                            <ImageIcon size={13} />
                            <span>รูปหลักฐาน ({v.photos.length})</span>
                          </button>
                        )}

                        <span className="text-slate-300">
                          <strong className="text-slate-100 font-extrabold">{v.totalGrossWeight.toLocaleString()} kg</strong>
                        </span>
                      </div>
                    </div>

                    {/* Collapsible Detail Table */}
                    {isExpanded && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] text-left text-slate-300">
                          <thead className="bg-slate-900/90 text-slate-400 font-bold uppercase text-[10px] border-b border-slate-800">
                            <tr>
                              <th className="py-2 px-3 font-mono">BATCH</th>
                              <th className="py-2 px-3">DESCRIPTION</th>
                              <th className="py-2 px-3 text-right font-mono">น้ำหนัก (KG)</th>
                              <th className="py-2 px-3 font-mono">SO</th>
                              <th className="py-2 px-3 font-mono">DO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 bg-slate-950/30">
                            {v.items.map((item, idx) => (
                              <tr key={item.id || idx} className="hover:bg-slate-800/40 transition-colors">
                                <td className="py-2 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                                  {item.batch || <span className="text-amber-400 text-[9.5px] font-sans">(เศษ)</span>}
                                </td>
                                <td className="py-2 px-3 text-slate-200">{item.description}</td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-slate-100 whitespace-nowrap">
                                  {item.grossWeight.toLocaleString()}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">{item.soNo}</td>
                                <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">{item.doNo}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================================ */}
      {/* RED LOCKOUT ALARM MODAL (Scanned Batch Mismatch Guard) */}
      {/* ============================================================================ */}
      {mismatchBatch && selectedVehicle && (
        <div className="fixed inset-0 z-50 bg-red-950/95 backdrop-blur-md flex items-center justify-center p-4 animate-pulse">
          <div className="bg-red-900 border-4 border-red-500 rounded-3xl p-6 max-w-lg w-full text-center space-y-5 shadow-2xl">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-600 text-white flex items-center justify-center animate-bounce shadow-lg">
              <AlertTriangle size={40} />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xl font-extrabold text-white tracking-wide uppercase">
                ⚠️ เตือนภัย! สแกน BATCH ไม่ถูกต้อง
              </h3>
              <p className="text-xs font-semibold text-red-100">
                บาร์โค้ด Batch ที่สแกน [<span className="font-mono text-yellow-300 text-sm font-bold">{mismatchBatch}</span>] ไม่ตรงกับรายการของทะเบียนรถ [<span className="font-mono text-white text-sm font-bold">{selectedVehicle.vehicleId}</span>]
              </p>
            </div>

            <div className="bg-red-950/80 p-3 rounded-xl border border-red-700 text-left text-xs text-red-200 space-y-1 font-mono">
              <p className="font-bold text-yellow-300">⛔ ห้ามนำม้วนนี้ขึ้นรถเด็ดขาด!</p>
              <p>• ม้วนนี้อาจเป็นของรถคันอื่น หรือไม่ได้อยู่ในใบสั่ง SAP</p>
            </div>

            <button
              type="button"
              onClick={() => setMismatchBatch(null)}
              className="w-full min-h-[48px] bg-white text-red-900 hover:bg-red-100 font-extrabold text-sm rounded-xl shadow-xl transition-all active:scale-[0.97]"
            >
              รับทราบและปิดการเตือน (สแกนใหม่)
            </button>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* Photo Gallery Modal */}
      {/* ============================================================================ */}
      {viewingPhotoModalGroup && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 max-w-2xl w-full space-y-3 max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <ImageIcon size={16} className="text-cyan-400" />
                <span>ภาพถ่ายหลักฐาน - ทะเบียนรถ: {viewingPhotoModalGroup.vehicleId}</span>
              </h3>
              <button
                type="button"
                onClick={() => setViewingPhotoModalGroup(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2">
              {viewingPhotoModalGroup.photos.map((photo) => (
                <div key={photo.id} className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950 p-1 space-y-1">
                  <img src={photo.url} alt="Proof" className="w-full aspect-square object-cover rounded" />
                  <p className="text-[10px] text-slate-400 text-center font-mono">{photo.timestamp}</p>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setViewingPhotoModalGroup(null)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl"
            >
              ปิดหน้าต่าง
            </button>
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
