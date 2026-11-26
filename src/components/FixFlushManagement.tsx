/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Swal from "sweetalert2";
import {
  Wrench,
  Clock,
  CheckCircle2,
  Printer,
  Search,
  Filter,
  Plus,
  X,
  FileText,
  Package,
  ShieldCheck,
  MessageSquare,
  Send,
  HelpCircle,
  Check,
  Ban,
  RefreshCw,
  Wifi,
  WifiOff,
  Trash2,
  Camera,
  ImagePlus,
  ZoomIn,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  RotateCcw,
  Calculator,
  User,
  History,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Employee, Vehicle } from "../types/officer";
import {
  getVehicleSearchableText,
  getVehicleTypeDisplayLabel,
  resolveVehicleType,
} from "../utils/vehicleHelpers";
import {
  MH_REPAIR_CATEGORIES,
  MhMaintenanceRecord,
  MhRepairPhotoItem,
  MhSparePartItem,
  MhTireStockRecord,
  MhTireSize,
  MhWorkflowStage,
  generateNextRepairRequestNo,
  inferMhWorkflowStage,
  subscribeToMhMaintenance,
  fetchMhMaintenanceOnce,
  saveMhMaintenanceToCloud,
  deleteMhMaintenanceFromCloud,
  saveMhTireTransactionToCloud,
  getForkliftCloudRealtimeEnabled,
  setForkliftCloudRealtimeEnabled,
  subscribeForkliftCloudRealtimeMode,
} from "../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import { useAuth } from "../contexts/AuthContext";

type FixFlushRecord = MhMaintenanceRecord;

interface FixFlushManagementProps {
  vehicles: Vehicle[];
  employees?: Employee[];
}

type RepairHubTab = "requester" | "supervisor" | "manager";

const TIRE_SIZE_OPTIONS: MhTireSize[] = [
  "6.00-9 (ยางตันหน้า/หลัง 2.5T)",
  "7.00-12 (ยางตันหน้า 2.5T-3.0T)",
  "28x9-15 (ยางตันหน้า 3.0T-3.5T)",
  "6.50-10 (ยางตันหลัง 3.0T-3.5T)",
  "250-15 (ยางตันหน้า 4.0T-5.0T)",
  "300-15 (ยางตันหน้า 5.0T-7.0T)",
  "8.25-15 (ยางตันรถลากจูง/เทรลเลอร์)",
];

const WHEEL_POSITION_OPTIONS = [
  "ล้อหน้าซ้าย (FL)",
  "ล้อหน้าขวา (FR)",
  "ล้อหลังซ้าย (RL)",
  "ล้อหลังขวา (RR)",
  "คู่ล้อหน้า (Front Pair)",
  "คู่ล้อหลัง (Rear Pair)",
  "ครบชุด 4 ล้อ (Full Set)",
];

const SPARE_PART_UNITS = ["ชิ้น", "ชุด", "เส้น", "ลิตร", "อัน", "เมตร", "กล่อง"];

const MAX_REPAIR_PHOTOS = 9;
const MAX_TOTAL_PHOTO_BYTES = 660 * 1024; // Keep total photos safely under Firestore's 1MB doc limit

async function compressRepairImageFile(
  file: File,
  indexOffset: number
): Promise<MhRepairPhotoItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`ไม่สามารถอ่านไฟล์ ${file.name} ได้`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`ไฟล์ ${file.name} ไม่ใช่รูปภาพที่รองรับ`));
      img.onload = () => {
        const maxEdge = 760;
        let targetW = img.width;
        let targetH = img.height;
        if (targetW > maxEdge || targetH > maxEdge) {
          if (targetW >= targetH) {
            targetH = Math.round((targetH * maxEdge) / targetW);
            targetW = maxEdge;
          } else {
            targetW = Math.round((targetW * maxEdge) / targetH);
            targetH = maxEdge;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, targetW);
        canvas.height = Math.max(1, targetH);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("เบราว์เซอร์ไม่รองรับการบีบอัดรูปภาพ"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        let quality = 0.62;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > 95000 && quality > 0.32) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }

        // If still large on very dense textures, scale down slightly more
        if (dataUrl.length > 110000) {
          const smallCanvas = document.createElement("canvas");
          smallCanvas.width = Math.max(1, Math.round(canvas.width * 0.72));
          smallCanvas.height = Math.max(1, Math.round(canvas.height * 0.72));
          const sCtx = smallCanvas.getContext("2d");
          if (sCtx) {
            sCtx.fillStyle = "#ffffff";
            sCtx.fillRect(0, 0, smallCanvas.width, smallCanvas.height);
            sCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
            dataUrl = smallCanvas.toDataURL("image/jpeg", 0.52);
          }
        }

        resolve({
          id: `PH-${Date.now()}-${indexOffset}`,
          name: file.name || `repair_photo_${indexOffset + 1}.jpg`,
          dataUrl,
          sizeBytes: dataUrl.length,
          uploadedAt: new Date().toISOString().replace("T", " ").substring(0, 16),
        });
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function getStageMeta(rec: FixFlushRecord): {
  stage: MhWorkflowStage;
  labelTh: string;
  shortLabel: string;
  stepNumber: number;
  badgeClass: string;
} {
  const stage = inferMhWorkflowStage(rec);
  if (
    rec.managerStatus === "More Info Requested" &&
    stage !== "Rejected" &&
    stage !== "Completed" &&
    stage !== "ManagerApproved" &&
    stage !== "InRepair"
  ) {
    return {
      stage,
      labelTh: "รอหัวหน้างานตอบข้อมูลเพิ่ม",
      shortLabel: "รอตอบข้อมูลเพิ่ม",
      stepNumber: 2,
      badgeClass:
        "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800",
    };
  }
  switch (stage) {
    case "Submitted":
      if (rec.supervisorStatus === "Returned") {
        return {
          stage,
          labelTh: "ส่งกลับแก้ไขข้อมูล",
          shortLabel: "ส่งกลับแก้ไข",
          stepNumber: 1,
          badgeClass:
            "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
        };
      }
      return {
        stage,
        labelTh: "รอหัวหน้างานตรวจสอบ",
        shortLabel: "รอหัวหน้าตรวจสอบ",
        stepNumber: 2,
        badgeClass:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
      };
    case "SupervisorChecked":
      return {
        stage,
        labelTh: "รอผู้จัดการอนุมัติ",
        shortLabel: "รออนุมัติ",
        stepNumber: 3,
        badgeClass:
          "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800",
      };
    case "ManagerApproved":
      return {
        stage,
        labelTh: "รอคิวซ่อม",
        shortLabel: "รอคิวซ่อม",
        stepNumber: 4,
        badgeClass:
          "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800",
      };
    case "InRepair":
      return {
        stage,
        labelTh: "กำลังซ่อม",
        shortLabel: "กำลังซ่อม",
        stepNumber: 4,
        badgeClass:
          "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800",
      };
    case "Completed":
      return {
        stage,
        labelTh: "ซ่อมเสร็จ",
        shortLabel: "ซ่อมเสร็จ",
        stepNumber: 4,
        badgeClass:
          "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-700",
      };
    case "Rejected":
      return {
        stage,
        labelTh: "ไม่อนุมัติ",
        shortLabel: "ไม่อนุมัติ",
        stepNumber: 3,
        badgeClass:
          "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
      };
  }
}

function getMaintenanceRecordTotalCost(rec: FixFlushRecord): number {
  const est = Number(rec.estimatedCost) || 0;
  if (est > 0) return est;
  return (Number(rec.partsCost) || 0) + (Number(rec.laborCost) || 0);
}

function parseYmdToMs(dateStr?: string): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr.trim())) return null;
  const [y, m, d] = dateStr.trim().slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function compareRecordsNewestFirst(a: FixFlushRecord, b: FixFlushRecord): number {
  const dCmp = (b.workingDate || "").localeCompare(a.workingDate || "");
  if (dCmp !== 0) return dCmp;
  return (b.createdAt || "").localeCompare(a.createdAt || "");
}

function showRepairSwal(opts: {
  icon: "success" | "info" | "warning" | "error";
  title: string;
  text: string;
}) {
  const isDark =
    typeof document !== "undefined" &&
    (document.documentElement.classList.contains("dark") ||
      Boolean(document.querySelector(".shell.theme-dark")));
  void Swal.fire({
    icon: opts.icon,
    title: opts.title,
    text: opts.text,
    confirmButtonText: "ตกลง",
    confirmButtonColor: "#087eaf",
    background: isDark ? "#111e38" : "#ffffff",
    color: isDark ? "#f1f5f9" : "#0f172a",
    timer: opts.icon === "error" ? undefined : 3200,
    timerProgressBar: opts.icon !== "error",
    customClass: {
      container: "!z-[2000]",
    },
  });
}

export function FixFlushManagement({ vehicles, employees = [] }: FixFlushManagementProps) {
  const { currentUser } = useAuth();
  const [records, setRecords] = useState<FixFlushRecord[]>([]);
  const [cloudRealtime, setCloudRealtime] = useState<boolean>(() =>
    getForkliftCloudRealtimeEnabled()
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [headingPortalTarget, setHeadingPortalTarget] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("page-heading-actions") : null
  );

  const [activeTab, setActiveTab] = useState<RepairHubTab>(() => {
    if (currentUser?.role === "Manager") return "manager";
    if (currentUser?.role === "Supervisor") return "supervisor";
    return "requester";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("All");
  const [supervisorSubFilter, setSupervisorSubFilter] = useState<
    "all_sup" | "Submitted" | "MoreInfo" | "ManagerApproved" | "InRepair"
  >("all_sup");
  const [repairCategoryFilter, setRepairCategoryFilter] = useState<string>("All");
  // Collapsible status groups for "ตารางแจ้งซ่อมและติดตามสถานะ Material Handling" (default: all collapsed)
  const [expandedStageGroups, setExpandedStageGroups] = useState<Record<string, boolean>>({});

  // Modals & Inspection Drawer State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<FixFlushRecord | null>(null);
  const [isEditingSupervisorCost, setIsEditingSupervisorCost] = useState(false);
  const [showAllSameVehicleHistory, setShowAllSameVehicleHistory] = useState(false);
  const [showAllOtherVehicleHistory, setShowAllOtherVehicleHistory] = useState(false);

  useEffect(() => {
    setShowAllSameVehicleHistory(false);
    setShowAllOtherVehicleHistory(false);
  }, [selectedRecord?.id]);

  // Decision-support history & peer comparison for Manager Approval detail view
  const approvalComparisonData = useMemo(() => {
    if (!selectedRecord) return null;
    const currentTypeKey = (selectedRecord.repairType || "").trim().toLowerCase();
    const currentVehicleKey = (selectedRecord.vehicleId || "").trim().toUpperCase();
    const currentCost = getMaintenanceRecordTotalCost(selectedRecord);
    const currentDateMs = parseYmdToMs(selectedRecord.workingDate);

    const sameVehicleList = records
      .filter(
        (r) =>
          r.id !== selectedRecord.id &&
          (r.vehicleId || "").trim().toUpperCase() === currentVehicleKey &&
          (r.repairType || "").trim().toLowerCase() === currentTypeKey
      )
      .sort(compareRecordsNewestFirst);

    const otherVehiclesList = records
      .filter(
        (r) =>
          r.id !== selectedRecord.id &&
          (r.vehicleId || "").trim().toUpperCase() !== currentVehicleKey &&
          (r.repairType || "").trim().toLowerCase() === currentTypeKey
      )
      .sort(compareRecordsNewestFirst);

    const validSame = sameVehicleList.filter((r) => inferMhWorkflowStage(r) !== "Rejected");
    const sameCosts = validSame.map(getMaintenanceRecordTotalCost).filter((c) => c > 0);
    const sameTotalCost = validSame.reduce(
      (sum, r) => sum + getMaintenanceRecordTotalCost(r),
      0
    );
    const sameAvgCost =
      sameCosts.length > 0
        ? Math.round(sameCosts.reduce((sum, c) => sum + c, 0) / sameCosts.length)
        : 0;

    const latestSame = validSame[0] || sameVehicleList[0] || null;
    const latestSameDateMs = latestSame ? parseYmdToMs(latestSame.workingDate) : null;
    const daysSinceLastRepair =
      currentDateMs !== null && latestSameDateMs !== null && currentDateMs >= latestSameDateMs
        ? Math.round((currentDateMs - latestSameDateMs) / 86400000)
        : null;
    const hoursSinceLastRepair =
      latestSame &&
      (selectedRecord.operatingHours || 0) > 0 &&
      (latestSame.operatingHours || 0) > 0 &&
      selectedRecord.operatingHours >= latestSame.operatingHours
        ? selectedRecord.operatingHours - latestSame.operatingHours
        : null;

    const validOther = otherVehiclesList.filter((r) => inferMhWorkflowStage(r) !== "Rejected");
    const otherCosts = validOther.map(getMaintenanceRecordTotalCost).filter((c) => c > 0);
    const otherAvgCost =
      otherCosts.length > 0
        ? Math.round(otherCosts.reduce((sum, c) => sum + c, 0) / otherCosts.length)
        : 0;
    const otherMinCost = otherCosts.length > 0 ? Math.min(...otherCosts) : 0;
    const otherMaxCost = otherCosts.length > 0 ? Math.max(...otherCosts) : 0;

    const diffFromOtherAvg =
      otherAvgCost > 0 && currentCost > 0 ? currentCost - otherAvgCost : null;
    const diffFromOtherAvgPct =
      otherAvgCost > 0 && diffFromOtherAvg !== null
        ? Math.round((diffFromOtherAvg / otherAvgCost) * 100)
        : null;

    // Grouped summary per other vehicle
    const otherVehicleMap = new Map<
      string,
      {
        vehicleId: string;
        vehicleType: string;
        count: number;
        costCount: number;
        totalCost: number;
        latestDate: string;
      }
    >();
    otherVehiclesList.forEach((r) => {
      const vid = (r.vehicleId || "-").trim().toUpperCase();
      const isRejected = inferMhWorkflowStage(r) === "Rejected";
      const cost = getMaintenanceRecordTotalCost(r);
      const entry = otherVehicleMap.get(vid) || {
        vehicleId: r.vehicleId || "-",
        vehicleType: getVehicleTypeDisplayLabel(r.vehicleType, r),
        count: 0,
        costCount: 0,
        totalCost: 0,
        latestDate: r.workingDate || "",
      };
      entry.count += 1;
      if (!isRejected && cost > 0) {
        entry.costCount += 1;
        entry.totalCost += cost;
      }
      if ((r.workingDate || "") > entry.latestDate) {
        entry.latestDate = r.workingDate || "";
      }
      otherVehicleMap.set(vid, entry);
    });

    const otherByVehicle = Array.from(otherVehicleMap.values())
      .map((item) => ({
        ...item,
        avgCost: item.costCount > 0 ? Math.round(item.totalCost / item.costCount) : 0,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.latestDate.localeCompare(a.latestDate);
      });

    return {
      currentCost,
      sameVehicleList,
      sameValidCount: validSame.length,
      sameTotalCost,
      sameAvgCost,
      latestSame,
      daysSinceLastRepair,
      hoursSinceLastRepair,
      otherVehiclesList,
      otherValidCount: validOther.length,
      otherUniqueVehicleCount: otherByVehicle.length,
      otherAvgCost,
      otherMinCost,
      otherMaxCost,
      diffFromOtherAvg,
      diffFromOtherAvgPct,
      otherByVehicle,
    };
  }, [selectedRecord, records]);

  // Lightbox State for viewing attached photos
  const [lightboxPhotos, setLightboxPhotos] = useState<MhRepairPhotoItem[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);

  // Feedback / Manager Query Modal State
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbackRecord, setFeedbackRecord] = useState<FixFlushRecord | null>(null);
  const [feedbackMessageText, setFeedbackMessageText] = useState("");

  // Reject / Return Reason Inline State
  const [rejectReasonText, setRejectReasonText] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [returnReasonText, setReturnReasonText] = useState("");
  const [showReturnBox, setShowReturnBox] = useState(false);

  // Delete confirmation state (no window.confirm)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Stage 1: New Repair Request Form State
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [reqWorkingDate, setReqWorkingDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [reqRequesterName, setReqRequesterName] = useState(() => {
    return currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || "";
  });
  const [reqVehicleId, setReqVehicleId] = useState(vehicles[0]?.vehicleId || "");
  const [reqRepairType, setReqRepairType] = useState<string>(MH_REPAIR_CATEGORIES[0]);
  const [reqRepairDescription, setReqRepairDescription] = useState("");
  const [reqOperatingHours, setReqOperatingHours] = useState<number>(0);
  const [reqNotes, setReqNotes] = useState("");
  const [reqPhotos, setReqPhotos] = useState<MhRepairPhotoItem[]>([]);
  const [isCompressingPhotos, setIsCompressingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  // Stage 2: Supervisor Inspection & Costing Form State (inside selectedRecord modal)
  const [supSpareParts, setSupSpareParts] = useState<MhSparePartItem[]>([]);
  const [supPartsCost, setSupPartsCost] = useState<number>(0);
  const [supLaborCost, setSupLaborCost] = useState<number>(0);
  const [supPartsCostManual, setSupPartsCostManual] = useState<boolean>(false);
  const [supTechnicianName, setSupTechnicianName] = useState<string>("");
  const [supVendorName, setSupVendorName] = useState<string>("");
  const [supOperatingHours, setSupOperatingHours] = useState<number>(0);
  const [supRepairDescription, setSupRepairDescription] = useState<string>("");
  const [supNotes, setSupNotes] = useState<string>("");
  const [supReplyText, setSupReplyText] = useState<string>("");
  const [supLogTireOutbound, setSupLogTireOutbound] = useState<boolean>(false);
  const [supTireSize, setSupTireSize] = useState<string>(TIRE_SIZE_OPTIONS[1]);
  const [supTireQty, setSupTireQty] = useState<number>(2);
  const [supTirePosition, setSupTirePosition] = useState<string>(WHEEL_POSITION_OPTIONS[4]);
  const [isSavingSupervisor, setIsSavingSupervisor] = useState(false);

  // Portal target for Cloud Sync button beside Print / Export
  useEffect(() => {
    setHeadingPortalTarget(document.getElementById("page-heading-actions"));
  }, []);

  // Subscriptions
  useEffect(() => {
    const unsubMode = subscribeForkliftCloudRealtimeMode((enabled) => {
      setCloudRealtime(enabled);
    });
    return () => unsubMode();
  }, []);

  useEffect(() => {
    const unsubMaint = subscribeToMhMaintenance((cloudMaint) => {
      setRecords(cloudMaint);
    });
    return () => {
      unsubMaint();
    };
  }, [cloudRealtime]);

  // Keep selectedVehicle default populated when vehicles prop loads
  useEffect(() => {
    if (!reqVehicleId && vehicles.length > 0) {
      setReqVehicleId(vehicles[0].vehicleId);
    }
  }, [vehicles, reqVehicleId]);

  const handleManualReload = async () => {
    setIsRefreshing(true);
    try {
      const latestMaint = await fetchMhMaintenanceOnce();
      setRecords(latestMaint);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Auto-generated TMT-YYYY-MM-NNN preview for new repair request
  const previewRequestNo = useMemo(() => {
    const parsedDate = reqWorkingDate ? new Date(`${reqWorkingDate}T00:00:00`) : new Date();
    const safeDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    return generateNextRepairRequestNo(records, safeDate);
  }, [records, reqWorkingDate]);

  // Open Inspect Drawer and initialize Stage 2 form state
  const openInspectModal = (rec: FixFlushRecord, startEditing = false) => {
    const stage = inferMhWorkflowStage(rec);
    const parts = Array.isArray(rec.spareParts) ? rec.spareParts.map((p) => ({ ...p })) : [];
    const sumFromParts = parts.reduce(
      (s, p) => s + (Number(p.qty) || 0) * (Number(p.unitCost) || 0),
      0
    );
    const initialPartsCost =
      typeof rec.partsCost === "number" ? rec.partsCost : sumFromParts;

    setSelectedRecord(rec);
    setSupSpareParts(parts);
    setSupPartsCost(initialPartsCost);
    setSupPartsCostManual(parts.length === 0 && initialPartsCost > 0);
    setSupLaborCost(typeof rec.laborCost === "number" ? rec.laborCost : 0);
    setSupTechnicianName(
      rec.technicianName && rec.technicianName !== "-"
        ? rec.technicianName
        : rec.supervisorName || ""
    );
    setSupVendorName(rec.vendorName && rec.vendorName !== "-" ? rec.vendorName : "");
    setSupReplyText("");
    setSupOperatingHours(Number(rec.operatingHours) || 0);
    setSupRepairDescription(rec.repairDescription || "");
    setSupNotes(rec.supervisorNotes || "");
    setSupLogTireOutbound(false);
    setSupTireSize(TIRE_SIZE_OPTIONS[1]);
    setSupTireQty(2);
    setSupTirePosition(WHEEL_POSITION_OPTIONS[4]);
    setShowRejectBox(false);
    setRejectReasonText("");
    setShowReturnBox(false);
    setReturnReasonText("");
    setConfirmDeleteId(null);
    setIsEditingSupervisorCost(startEditing || stage === "Submitted");
  };

  // Sync parts cost from spare parts table unless manually overridden
  const computedPartsSubtotal = useMemo(() => {
    return supSpareParts.reduce(
      (sum, p) => sum + (Number(p.qty) || 0) * (Number(p.unitCost) || 0),
      0
    );
  }, [supSpareParts]);

  useEffect(() => {
    if (!supPartsCostManual) {
      setSupPartsCost(computedPartsSubtotal);
    }
  }, [computedPartsSubtotal, supPartsCostManual]);

  const supTotalEstimatedCost = Math.max(0, Number(supPartsCost) || 0) + Math.max(0, Number(supLaborCost) || 0);

  // Photo handlers (max 9 photos, client-side compressed)
  const handlePhotoFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhotoError(null);

    const remainingSlots = MAX_REPAIR_PHOTOS - reqPhotos.length;
    if (remainingSlots <= 0) {
      setPhotoError(`แนบรูปถ่ายได้สูงสุด ${MAX_REPAIR_PHOTOS} รูปต่อ 1 ใบแจ้งซ่อม`);
      return;
    }

    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      setPhotoError(
        `เลือกได้เพิ่มอีก ${remainingSlots} รูปเท่านั้น (สูงสุด ${MAX_REPAIR_PHOTOS} รูป)`
      );
    }

    setIsCompressingPhotos(true);
    try {
      let currentBytes = reqPhotos.reduce((s, p) => s + p.dataUrl.length, 0);
      const nextPhotos: MhRepairPhotoItem[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const compressed = await compressRepairImageFile(selectedFiles[i], reqPhotos.length + i);
        if (currentBytes + compressed.dataUrl.length > MAX_TOTAL_PHOTO_BYTES) {
          setPhotoError(
            "ขนาดรูปภาพรวมใกล้ขีดจำกัดฐานข้อมูล (660 KB) จึงหยุดรับรูปเพิ่มเติม"
          );
          break;
        }
        currentBytes += compressed.dataUrl.length;
        nextPhotos.push(compressed);
      }
      if (nextPhotos.length > 0) {
        setReqPhotos((prev) => [...prev, ...nextPhotos].slice(0, MAX_REPAIR_PHOTOS));
      }
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการประมวลผลรูปภาพ");
    } finally {
      setIsCompressingPhotos(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    }
  };

  const handleRemoveReqPhoto = (photoId: string) => {
    setReqPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setPhotoError(null);
  };

  const openLightbox = (photos: MhRepairPhotoItem[], startIndex = 0) => {
    if (!photos || photos.length === 0) return;
    setLightboxPhotos(photos);
    setLightboxIndex(Math.max(0, Math.min(startIndex, photos.length - 1)));
  };

  // Stage 1 Submit: Employee submits repair request
  const handleCreateRepairRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRequest) return;

    const cleanRequester =
      reqRequesterName.trim() ||
      currentUser?.employeeName ||
      getActiveRecorderDisplay("พนักงานแจ้งซ่อม").employeeName;
    const cleanVehicleId = reqVehicleId.trim();
    const cleanDesc = reqRepairDescription.trim();

    if (!cleanVehicleId || !cleanDesc) {
      showRepairSwal({
        icon: "warning",
        title: "กรุณากรอกข้อมูลให้ครบถ้วน",
        text: "กรุณาเลือกรถที่แจ้งซ่อมและระบุอาการ / รายละเอียดที่ต้องการซ่อมก่อนกดยืนยัน",
      });
      return;
    }

    setIsSubmittingRequest(true);
    try {
      const targetVehicle = vehicles.find((v) => v.vehicleId === cleanVehicleId);
      const resolvedVehType = resolveVehicleType(
        targetVehicle || { vehicleId: cleanVehicleId, vehicleType: "Forklift" }
      );
      const resolvedVehLabel = getVehicleTypeDisplayLabel(resolvedVehType, targetVehicle || { vehicleId: cleanVehicleId });
      const vehicleDescription = targetVehicle
        ? `${targetVehicle.vehicleId} - ${resolvedVehLabel} (${targetVehicle.description || "-"})`
        : cleanVehicleId;

      const parsedDate = reqWorkingDate ? new Date(`${reqWorkingDate}T00:00:00`) : new Date();
      const safeDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
      const requestNo = generateNextRepairRequestNo(records, safeDate);
      const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);

      const newRecord: FixFlushRecord = {
        id: requestNo,
        workOrderNo: requestNo,
        requesterName: cleanRequester,
        vehicleId: cleanVehicleId,
        vehicleNumber: cleanVehicleId,
        vehicleType: resolvedVehType,
        vehicleDescription,
        repairType: reqRepairType,
        repairDescription: cleanDesc,
        workflowStage: "Submitted",
        status: "Pending Inspection",
        supervisorStatus: "Pending",
        managerStatus: "Pending Manager Approval",
        progressStatus: "Awaiting Approval",
        workingDate: reqWorkingDate,
        operatingHours: Number(reqOperatingHours) || 0,
        technicianName: "-",
        workshopBay: "-",
        spareParts: [],
        partsCost: 0,
        laborCost: 0,
        estimatedCost: 0,
        photos: reqPhotos,
        feedbackThread: [],
        notes: reqNotes.trim() || undefined,
        createdAt: nowStr,
        updatedAt: nowStr,
      };

      setRecords((prev) => [newRecord, ...prev]);
      setIsRequestModalOpen(false);
      setReqRepairDescription("");
      setReqNotes("");
      setReqPhotos([]);
      setReqOperatingHours(0);
      setPhotoError(null);

      await saveMhMaintenanceToCloud(newRecord);
      void appendWmsActivityLog({
        module: "ระบบแจ้งซ่อม (MH)",
        sectionId: "fleet_ops",
        reference: requestNo,
        activity: `แจ้งซ่อม ${requestNo} รถ ${cleanVehicleId} · ${reqRepairType} (ผู้แจ้ง: ${cleanRequester})`,
        status: "Pending",
      });

      showRepairSwal({
        icon: "success",
        title: "ส่งใบแจ้งซ่อมเรียบร้อยแล้ว",
        text: `เลขที่ใบแจ้งซ่อม ${requestNo} · รถ ${cleanVehicleId} (${reqRepairType}) ส่งให้หัวหน้างานตรวจสอบแล้ว`,
      });
    } catch {
      showRepairSwal({
        icon: "error",
        title: "บันทึกใบแจ้งซ่อมไม่สำเร็จ",
        text: "เกิดข้อผิดพลาดขณะบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง",
      });
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Stage 2 Spare parts helpers
  const addSupSparePartRow = () => {
    setSupPartsCostManual(false);
    setSupSpareParts((prev) => [
      ...prev,
      {
        id: `SP-${Date.now()}-${prev.length + 1}`,
        partCode: "",
        partName: "",
        qty: 1,
        unit: "ชิ้น",
        unitCost: 0,
      },
    ]);
  };

  const updateSupSparePart = (
    index: number,
    field: keyof MhSparePartItem,
    value: string | number
  ) => {
    setSupSpareParts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeSupSparePart = (index: number) => {
    setSupPartsCostManual(false);
    setSupSpareParts((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Stage 2 Action: Supervisor confirms inspection & sends to Manager
  const handleSupervisorConfirmInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord || isSavingSupervisor) return;
    setIsSavingSupervisor(true);

    try {
      const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
      const supervisorDisplay =
        currentUser?.employeeName ||
        getActiveRecorderDisplay("หัวหน้างาน").employeeName ||
        "หัวหน้างาน Material Handling";

      const cleanParts = supSpareParts.filter(
        (sp) => sp.partName.trim() !== "" || sp.partCode.trim() !== "" || sp.unitCost > 0
      );
      const finalPartsCost = Math.max(0, Number(supPartsCost) || 0);
      const finalLaborCost = Math.max(0, Number(supLaborCost) || 0);
      const finalTotal = finalPartsCost + finalLaborCost;
      const cleanVendor = supVendorName.trim() || undefined;
      const currentStage = inferMhWorkflowStage(selectedRecord);
      const isPostApprovalEdit =
        currentStage === "ManagerApproved" || currentStage === "InRepair";
      const wasMoreInfo = selectedRecord.managerStatus === "More Info Requested";
      const nextThread = isPostApprovalEdit
        ? [
            ...selectedRecord.feedbackThread,
            {
              id: `FB-${Date.now()}`,
              author: supervisorDisplay,
              role: "Supervisor" as const,
              queryType: "หัวหน้างานเพิ่มรายการอะไหล่ (หลังอนุมัติ)",
              message: `อัปเดตรายการอะไหล่ ${cleanParts.length} รายการ (ค่าอะไหล่ ${finalPartsCost.toLocaleString()} บาท · ค่าแรง ${finalLaborCost.toLocaleString()} บาท · รวม ${finalTotal.toLocaleString()} บาท)`,
              timestamp: nowStr,
            },
          ]
        : wasMoreInfo
        ? [
            ...selectedRecord.feedbackThread,
            {
              id: `FB-${Date.now()}`,
              author: supervisorDisplay,
              role: "Supervisor" as const,
              queryType: "หัวหน้างานอัปเดตข้อมูลและส่งกลับพิจารณา",
              message: `${cleanVendor ? `Vendor/ร้านซ่อม: ${cleanVendor} · ` : ""}${
                supNotes.trim() || "อัปเดตรายการประเมินและส่งกลับผู้จัดการพิจารณาอนุมัติ"
              }`,
              timestamp: nowStr,
            },
          ]
        : selectedRecord.feedbackThread;

      const finalRepairDescription =
        supRepairDescription.trim() || selectedRecord.repairDescription;

      const updated: FixFlushRecord = {
        ...selectedRecord,
        repairDescription: finalRepairDescription,
        spareParts: cleanParts,
        partsCost: finalPartsCost,
        laborCost: finalLaborCost,
        estimatedCost: finalTotal,
        workshopBay: selectedRecord.workshopBay || "-",
        technicianName: supTechnicianName.trim() || selectedRecord.technicianName || supervisorDisplay,
        vendorName: cleanVendor,
        operatingHours: Number(supOperatingHours) || selectedRecord.operatingHours || 0,
        supervisorStatus: "Checked",
        supervisorName: isPostApprovalEdit
          ? selectedRecord.supervisorName || supervisorDisplay
          : supervisorDisplay,
        supervisorCheckedAt: isPostApprovalEdit
          ? selectedRecord.supervisorCheckedAt || nowStr
          : nowStr,
        supervisorNotes: supNotes.trim() || undefined,
        workflowStage: isPostApprovalEdit ? currentStage : "SupervisorChecked",
        managerStatus: isPostApprovalEdit ? "Approved" : "Pending Manager Approval",
        managerName: isPostApprovalEdit ? selectedRecord.managerName : selectedRecord.managerName,
        managerApprovedAt: isPostApprovalEdit
          ? selectedRecord.managerApprovedAt
          : selectedRecord.managerApprovedAt,
        status: isPostApprovalEdit
          ? selectedRecord.status || "In Workshop"
          : "Pending Inspection",
        progressStatus: isPostApprovalEdit
          ? selectedRecord.progressStatus || "In Progress"
          : selectedRecord.progressStatus,
        feedbackThread: nextThread,
        updatedAt: nowStr,
      };

      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSelectedRecord(updated);
      setIsEditingSupervisorCost(false);

      await saveMhMaintenanceToCloud(updated);

      // Optional automatic outbound tire deduction if supervisor ticked it
      if (supLogTireOutbound && supTireQty > 0) {
        const tireTxId = `TIRE-WO-${updated.workOrderNo}-${Date.now().toString().slice(-4)}`;
        const unitCostVal =
          finalPartsCost > 0 ? Math.round(finalPartsCost / Math.max(1, supTireQty)) : 3800;
        const tireTx: MhTireStockRecord = {
          id: tireTxId,
          transactionNo: tireTxId,
          date: nowStr.slice(0, 10),
          time: nowStr.slice(11, 16) || "09:00",
          transactionType: "Outbound",
          tireSize: supTireSize,
          brand: "KOMACHI / PIO",
          qty: supTireQty,
          unitCost: unitCostVal,
          totalCost: unitCostVal * supTireQty,
          vehicleId: updated.vehicleId,
          vehicleNumber: updated.vehicleNumber || updated.vehicleId,
          wheelPosition: supTirePosition,
          operatingHours: updated.operatingHours,
          technicianOrReceiver: updated.technicianName || supervisorDisplay,
          workOrderRef: updated.workOrderNo,
          notes: `เบิกเปลี่ยนยางตามใบขอซ่อม ${updated.workOrderNo}`,
          updatedAt: nowStr,
        };
        await saveMhTireTransactionToCloud(tireTx);
      }

      void appendWmsActivityLog({
        module: "ระบบแจ้งซ่อม (MH)",
        sectionId: "fleet_ops",
        reference: updated.workOrderNo,
        activity: isPostApprovalEdit
          ? `หัวหน้างานเพิ่มรายการอะไหล่หลังอนุมัติ ${updated.workOrderNo} (${cleanParts.length} รายการ · ยอดรวม ${finalTotal.toLocaleString()} บาท)`
          : `หัวหน้างานตรวจสอบใบซ่อม ${updated.workOrderNo} (${updated.vehicleId}) ยอดประเมิน ${finalTotal.toLocaleString()} บาท → ส่งผู้จัดการอนุมัติ`,
        status: isPostApprovalEdit ? "Approved" : "Pending",
      });

      showRepairSwal({
        icon: "success",
        title: isPostApprovalEdit
          ? "บันทึกเพิ่มรายการอะไหล่เรียบร้อยแล้ว"
          : "ยืนยันการตรวจสอบเรียบร้อยแล้ว",
        text: isPostApprovalEdit
          ? `อัปเดตใบขอซ่อม ${updated.workOrderNo} (${updated.vehicleId}) ยอดรวม ${finalTotal.toLocaleString()} บาท เรียบร้อยแล้ว`
          : `ใบขอซ่อม ${updated.workOrderNo} (${updated.vehicleId}) ยอดประเมิน ${finalTotal.toLocaleString()} บาท ส่งให้ผู้จัดการพิจารณาอนุมัติแล้ว`,
      });
    } catch {
      showRepairSwal({
        icon: "error",
        title: "บันทึกการตรวจสอบไม่สำเร็จ",
        text: "เกิดข้อผิดพลาดขณะบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง",
      });
    } finally {
      setIsSavingSupervisor(false);
    }
  };

  // Stage 2 Action: Supervisor returns request to requester
  const handleSupervisorReturnToRequester = async () => {
    if (!selectedRecord || !returnReasonText.trim()) return;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const supervisorDisplay =
      currentUser?.employeeName || getActiveRecorderDisplay("หัวหน้างาน").employeeName;

    const msg = {
      id: `FB-${Date.now()}`,
      author: supervisorDisplay,
      role: "Supervisor" as const,
      queryType: "ส่งกลับแก้ไขรายละเอียดแจ้งซ่อม",
      message: returnReasonText.trim(),
      timestamp: nowStr,
    };

    const updated: FixFlushRecord = {
      ...selectedRecord,
      workflowStage: "Submitted",
      supervisorStatus: "Returned",
      supervisorName: supervisorDisplay,
      supervisorCheckedAt: nowStr,
      supervisorNotes: returnReasonText.trim(),
      feedbackThread: [...selectedRecord.feedbackThread, msg],
      updatedAt: nowStr,
    };

    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedRecord(updated);
    setShowReturnBox(false);
    setReturnReasonText("");
    setIsEditingSupervisorCost(false);

    await saveMhMaintenanceToCloud(updated);
    void appendWmsActivityLog({
      module: "ระบบแจ้งซ่อม (MH)",
      sectionId: "fleet_ops",
      reference: updated.workOrderNo,
      activity: `หัวหน้างานส่งกลับใบซ่อม ${updated.workOrderNo}: ${msg.message}`,
      status: "Attention",
    });

    showRepairSwal({
      icon: "info",
      title: "ส่งกลับให้ผู้แจ้งแก้ไขแล้ว",
      text: `ส่งใบขอซ่อม ${updated.workOrderNo} (${updated.vehicleId}) กลับให้ผู้แจ้งแก้ไขรายละเอียดเรียบร้อยแล้ว`,
    });
  };

  // Stage 3 Actions: Manager Approve / Reject / Query / Complete
  const handleManagerApprove = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const managerDisplay =
      currentUser?.employeeName || getActiveRecorderDisplay("Manager").employeeName;

    const updated: FixFlushRecord = {
      ...target,
      workflowStage: "ManagerApproved",
      managerStatus: "Approved",
      managerName: managerDisplay,
      managerApprovedAt: nowStr,
      status: "In Workshop",
      progressStatus: "In Progress",
      updatedAt: nowStr,
    };
    setRecords((prev) => prev.map((r) => (r.id === recordId ? updated : r)));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updated);
    }
    await saveMhMaintenanceToCloud(updated);
    void appendWmsActivityLog({
      module: "ระบบแจ้งซ่อม (MH)",
      sectionId: "fleet_ops",
      reference: target.workOrderNo,
      activity: `ผู้จัดการอนุมัติซ่อม ${target.workOrderNo} (${target.vehicleId}) ยอด ${target.estimatedCost.toLocaleString()} บาท → ตารางแจ้งซ่อม (รอคิวซ่อม)`,
      status: "Approved",
    });
    showRepairSwal({
      icon: "success",
      title: "อนุมัติการซ่อมเรียบร้อยแล้ว",
      text: `อนุมัติใบขอซ่อม ${target.workOrderNo} (${target.vehicleId}) ยอด ${target.estimatedCost.toLocaleString()} บาท → ส่งเข้าคิวรอซ่อมแล้ว`,
    });
  };

  const handleManagerReject = async (recordId: string, reason?: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const managerDisplay =
      currentUser?.employeeName || getActiveRecorderDisplay("Manager").employeeName;

    const cleanReason = reason?.trim();
    const updatedThread = cleanReason
      ? [
          ...target.feedbackThread,
          {
            id: `FB-${Date.now()}`,
            author: managerDisplay,
            role: "Manager" as const,
            queryType: "เหตุผลการไม่อนุมัติ",
            message: cleanReason,
            timestamp: nowStr,
          },
        ]
      : target.feedbackThread;

    const updated: FixFlushRecord = {
      ...target,
      workflowStage: "Rejected",
      managerStatus: "Rejected",
      managerName: managerDisplay,
      managerApprovedAt: nowStr,
      managerDecisionNote: cleanReason || undefined,
      feedbackThread: updatedThread,
      updatedAt: nowStr,
    };
    setRecords((prev) => prev.map((r) => (r.id === recordId ? updated : r)));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updated);
    }
    setShowRejectBox(false);
    setRejectReasonText("");
    await saveMhMaintenanceToCloud(updated);
    void appendWmsActivityLog({
      module: "ระบบแจ้งซ่อม (MH)",
      sectionId: "fleet_ops",
      reference: target.workOrderNo,
      activity: `ไม่อนุมัติใบแจ้งซ่อม ${target.workOrderNo} (${target.vehicleId})${cleanReason ? ` · ${cleanReason}` : ""}`,
      status: "Attention",
    });
    showRepairSwal({
      icon: "warning",
      title: "บันทึกไม่อนุมัติเรียบร้อยแล้ว",
      text: `อัปเดตสถานะใบขอซ่อม ${target.workOrderNo} (${target.vehicleId}) เป็น "ไม่อนุมัติ" แล้ว`,
    });
  };

  const handleMarkInRepair = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const supervisorDisplay =
      currentUser?.employeeName || getActiveRecorderDisplay("หัวหน้างาน").employeeName;
    const updated: FixFlushRecord = {
      ...target,
      workflowStage: "InRepair",
      status: "In Workshop",
      progressStatus: "In Progress",
      supervisorNotes: target.supervisorNotes
        ? target.supervisorNotes
        : `เริ่มดำเนินการซ่อมโดย ${supervisorDisplay} (${nowStr})`,
      updatedAt: nowStr,
    };
    setRecords((prev) => prev.map((r) => (r.id === recordId ? updated : r)));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updated);
    }
    await saveMhMaintenanceToCloud(updated);
    void appendWmsActivityLog({
      module: "ระบบแจ้งซ่อม (MH)",
      sectionId: "fleet_ops",
      reference: target.workOrderNo,
      activity: `หัวหน้างานอัปเดตสถานะ ${target.workOrderNo} (${target.vehicleId}) → กำลังซ่อม`,
      status: "Pending",
    });
    showRepairSwal({
      icon: "success",
      title: "อัปเดตสถานะกำลังซ่อมแล้ว",
      text: `ใบขอซ่อม ${target.workOrderNo} (${target.vehicleId}) เปลี่ยนสถานะเป็น "กำลังซ่อม" เรียบร้อยแล้ว`,
    });
  };

  const handleMarkRepairCompleted = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const supervisorDisplay =
      currentUser?.employeeName || getActiveRecorderDisplay("หัวหน้างาน").employeeName;
    const updated: FixFlushRecord = {
      ...target,
      workflowStage: "Completed",
      status: "Completed",
      progressStatus: "Completed",
      completedAt: nowStr,
      supervisorNotes: target.supervisorNotes
        ? target.supervisorNotes
        : `อัปเดตสถานะซ่อมเสร็จโดย ${supervisorDisplay} (${nowStr})`,
      updatedAt: nowStr,
    };
    setRecords((prev) => prev.map((r) => (r.id === recordId ? updated : r)));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updated);
    }
    await saveMhMaintenanceToCloud(updated);
    void appendWmsActivityLog({
      module: "ระบบแจ้งซ่อม (MH)",
      sectionId: "fleet_ops",
      reference: target.workOrderNo,
      activity: `หัวหน้างานอัปเดตสถานะ ${target.workOrderNo} (${target.vehicleId}) → ซ่อมเสร็จ`,
      status: "Completed",
    });
    showRepairSwal({
      icon: "success",
      title: "อัปเดตสถานะซ่อมเสร็จเรียบร้อยแล้ว",
      text: `ปิดงานใบขอซ่อม ${target.workOrderNo} (${target.vehicleId}) เป็น "ซ่อมเสร็จ" แล้ว`,
    });
  };

  const handleDeleteMaintenanceOrder = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(null);
    }
    setConfirmDeleteId(null);
    await deleteMhMaintenanceFromCloud(recordId);
    if (target) {
      void appendWmsActivityLog({
        module: "ระบบแจ้งซ่อม (MH)",
        sectionId: "fleet_ops",
        reference: target.workOrderNo,
        activity: `ลบใบแจ้งซ่อม ${target.workOrderNo} (${target.vehicleId})`,
        status: "Attention",
      });
    }
    showRepairSwal({
      icon: "success",
      title: "ลบใบแจ้งซ่อมเรียบร้อยแล้ว",
      text: target
        ? `ลบใบขอซ่อม ${target.workOrderNo} (${target.vehicleId}) ออกจากระบบแล้ว`
        : "ลบใบแจ้งซ่อมออกจากระบบแล้ว",
    });
  };

  const handleSendManagerQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackRecord || !feedbackMessageText.trim()) return;

    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const activeAuthor =
      currentUser?.employeeName || getActiveRecorderDisplay("Manager").label;
    const newMessage = {
      id: `FB-${Date.now()}`,
      author: activeAuthor,
      role: "Manager" as const,
      queryType: "ขอรายละเอียดเพิ่มเติม",
      message: feedbackMessageText.trim(),
      timestamp: nowStr,
    };

    const updatedRecord: FixFlushRecord = {
      ...feedbackRecord,
      workflowStage: "SupervisorChecked",
      managerStatus: "More Info Requested",
      feedbackThread: [...feedbackRecord.feedbackThread, newMessage],
      updatedAt: nowStr,
    };

    setRecords((prev) => prev.map((r) => (r.id === feedbackRecord.id ? updatedRecord : r)));
    if (selectedRecord && selectedRecord.id === feedbackRecord.id) {
      setSelectedRecord(updatedRecord);
    }

    setIsFeedbackModalOpen(false);
    setFeedbackRecord(null);
    setFeedbackMessageText("");
    await saveMhMaintenanceToCloud(updatedRecord);
    void appendWmsActivityLog({
      module: "ระบบแจ้งซ่อม (MH)",
      sectionId: "fleet_ops",
      reference: updatedRecord.workOrderNo,
      activity: `ผู้จัดการขอรายละเอียดเพิ่มเติม ${updatedRecord.workOrderNo} → ส่งกลับหัวหน้างานตรวจสอบ`,
      status: "Pending",
    });
    showRepairSwal({
      icon: "info",
      title: "ส่งคำขอข้อมูลเพิ่มเติมแล้ว",
      text: `ส่งคำถามใบขอซ่อม ${updatedRecord.workOrderNo} กลับไปยังหัวหน้างานเรียบร้อยแล้ว`,
    });
  };

  const handleThreadReply = async (
    recordId: string,
    replyText: string,
    updatedVendorName?: string
  ) => {
    const cleanReply = replyText.trim();
    const cleanVendor = updatedVendorName?.trim();
    if (!cleanReply && !cleanVendor) return;

    const target = records.find((r) => r.id === recordId);
    if (!target) return;

    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const activeName =
      currentUser?.employeeName || getActiveRecorderDisplay("หัวหน้างาน").employeeName;
    const replyRole: "Supervisor" | "Technician" =
      currentUser?.role === "Supervisor" || currentUser?.role === "Sr.Warehouse Officer"
        ? "Supervisor"
        : "Supervisor";

    const combinedMessage = cleanVendor
      ? cleanReply
        ? `Vendor / ร้านซ่อม: ${cleanVendor} · ${cleanReply}`
        : `แจ้งชื่อ Vendor / ร้านซ่อม: ${cleanVendor}`
      : cleanReply;

    const replyMsg = {
      id: `FB-${Date.now()}`,
      author: activeName,
      role: replyRole,
      queryType: "คำตอบเพิ่มเติมจากหัวหน้างาน",
      message: combinedMessage,
      timestamp: nowStr,
    };

    const updatedRecord: FixFlushRecord = {
      ...target,
      vendorName: cleanVendor || target.vendorName,
      supervisorStatus: "Checked",
      supervisorName: target.supervisorName || activeName,
      supervisorCheckedAt: target.supervisorCheckedAt || nowStr,
      workflowStage: "SupervisorChecked",
      managerStatus: "Pending Manager Approval",
      feedbackThread: [...target.feedbackThread, replyMsg],
      updatedAt: nowStr,
    };

    setRecords((prev) => prev.map((r) => (r.id === recordId ? updatedRecord : r)));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updatedRecord);
    }
    setSupVendorName(updatedRecord.vendorName || "");
    setSupReplyText("");

    await saveMhMaintenanceToCloud(updatedRecord);
    void appendWmsActivityLog({
      module: "ระบบแจ้งซ่อม (MH)",
      sectionId: "fleet_ops",
      reference: updatedRecord.workOrderNo,
      activity: `หัวหน้างานตอบข้อมูลเพิ่มเติม ${updatedRecord.workOrderNo} (${combinedMessage}) → ส่งผู้จัดการอนุมัติ`,
      status: "Pending",
    });
    showRepairSwal({
      icon: "success",
      title: "ส่งข้อมูลตอบกลับเรียบร้อยแล้ว",
      text: `ส่งคำชี้แจงใบขอซ่อม ${updatedRecord.workOrderNo} กลับให้ผู้จัดการพิจารณาอนุมัติแล้ว`,
    });
  };

  // Counts for KPI and 3-Stage Tabs
  const pendingSupervisorNewCount = useMemo(
    () => records.filter((r) => inferMhWorkflowStage(r) === "Submitted").length,
    [records]
  );
  const pendingSupervisorInfoCount = useMemo(
    () =>
      records.filter(
        (r) =>
          inferMhWorkflowStage(r) === "SupervisorChecked" &&
          r.managerStatus === "More Info Requested"
      ).length,
    [records]
  );
  const pendingSupervisorCount = pendingSupervisorNewCount + pendingSupervisorInfoCount;

  const pendingManagerCount = useMemo(
    () =>
      records.filter(
        (r) =>
          inferMhWorkflowStage(r) === "SupervisorChecked" &&
          r.managerStatus !== "More Info Requested" &&
          r.managerStatus !== "Rejected"
      ).length,
    [records]
  );
  const inWorkshopCount = useMemo(
    () => records.filter((r) => inferMhWorkflowStage(r) === "ManagerApproved").length,
    [records]
  );
  const inRepairCount = useMemo(
    () => records.filter((r) => inferMhWorkflowStage(r) === "InRepair").length,
    [records]
  );
  const completedCount = useMemo(
    () => records.filter((r) => inferMhWorkflowStage(r) === "Completed").length,
    [records]
  );
  const totalApprovedCost = useMemo(
    () =>
      records
        .filter((r) => {
          const s = inferMhWorkflowStage(r);
          return s === "ManagerApproved" || s === "InRepair" || s === "Completed";
        })
        .reduce((sum, r) => sum + (Number(r.estimatedCost) || 0), 0),
    [records]
  );

  // Filtered work orders per active tab & toolbar filters
  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((r) => {
      const stage = inferMhWorkflowStage(r);
      const isMoreInfo =
        stage === "SupervisorChecked" && r.managerStatus === "More Info Requested";

      // Tab scope filtering
      if (activeTab === "supervisor" && stageFilter === "All") {
        if (supervisorSubFilter === "Submitted") {
          if (stage !== "Submitted") return false;
        } else if (supervisorSubFilter === "MoreInfo") {
          if (!isMoreInfo) return false;
        } else if (supervisorSubFilter === "ManagerApproved") {
          if (stage !== "ManagerApproved") return false;
        } else if (supervisorSubFilter === "InRepair") {
          if (stage !== "InRepair") return false;
        } else {
          // "all_sup": Supervisor handles new requests, Manager info-requests, queued ("รอคิวซ่อม"), and in-repair ("กำลังซ่อม") jobs
          if (
            stage !== "Submitted" &&
            !isMoreInfo &&
            stage !== "ManagerApproved" &&
            stage !== "InRepair"
          ) {
            return false;
          }
        }
      } else if (activeTab === "manager" && stageFilter === "All") {
        // Manager queue strictly excludes items sent back for More Info or Rejected
        if (
          stage !== "SupervisorChecked" ||
          r.managerStatus === "More Info Requested" ||
          r.managerStatus === "Rejected"
        ) {
          return false;
        }
      }

      if (stageFilter !== "All") {
        if (stageFilter === "MoreInfo") {
          if (!isMoreInfo) return false;
        } else if (stageFilter === "SupervisorChecked") {
          if (stage !== "SupervisorChecked" || r.managerStatus === "More Info Requested") {
            return false;
          }
        } else if (stage !== stageFilter) {
          return false;
        }
      }

      if (repairCategoryFilter !== "All" && r.repairType !== repairCategoryFilter) {
        return false;
      }

      if (!q) return true;
      return (
        r.workOrderNo.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.requesterName || "").toLowerCase().includes(q) ||
        (r.vendorName || "").toLowerCase().includes(q) ||
        r.vehicleId.toLowerCase().includes(q) ||
        r.repairType.toLowerCase().includes(q) ||
        r.repairDescription.toLowerCase().includes(q) ||
        r.technicianName.toLowerCase().includes(q) ||
        getVehicleSearchableText(r).includes(q)
      );
    });
  }, [records, activeTab, supervisorSubFilter, stageFilter, repairCategoryFilter, searchQuery]);

  // Group filtered records by "สถานะ 3 ช่วง" for the main Material Handling status tracking table
  const groupedStatusSections = useMemo(() => {
    const groupDefs: {
      key: string;
      title: string;
      stageLabel: string;
      badgeClass: string;
      headerBgClass: string;
      dotClass: string;
    }[] = [
      {
        key: "Submitted",
        title: "รอหัวหน้างานตรวจสอบ / ส่งกลับแก้ไข",
        stageLabel: "ช่วงที่ 1",
        badgeClass:
          "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
        headerBgClass:
          "bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-950/25 dark:hover:bg-amber-950/40",
        dotClass: "bg-amber-500",
      },
      {
        key: "MoreInfo",
        title: "รอหัวหน้างานตอบข้อมูลเพิ่ม",
        stageLabel: "ช่วงที่ 2",
        badgeClass:
          "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800",
        headerBgClass:
          "bg-purple-50/70 hover:bg-purple-100/70 dark:bg-purple-950/25 dark:hover:bg-purple-950/40",
        dotClass: "bg-purple-600",
      },
      {
        key: "SupervisorChecked",
        title: "รอผู้จัดการอนุมัติ",
        stageLabel: "ช่วงที่ 3",
        badgeClass:
          "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800",
        headerBgClass:
          "bg-sky-50/70 hover:bg-sky-100/70 dark:bg-sky-950/25 dark:hover:bg-sky-950/40",
        dotClass: "bg-sky-600",
      },
      {
        key: "ManagerApproved",
        title: "รอคิวซ่อม (อนุมัติแล้ว)",
        stageLabel: "อนุมัติแล้ว",
        badgeClass:
          "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800",
        headerBgClass:
          "bg-indigo-50/70 hover:bg-indigo-100/70 dark:bg-indigo-950/25 dark:hover:bg-indigo-950/40",
        dotClass: "bg-indigo-600",
      },
      {
        key: "InRepair",
        title: "กำลังซ่อม",
        stageLabel: "ดำเนินการซ่อม",
        badgeClass:
          "bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800",
        headerBgClass:
          "bg-orange-50/70 hover:bg-orange-100/70 dark:bg-orange-950/25 dark:hover:bg-orange-950/40",
        dotClass: "bg-orange-500",
      },
      {
        key: "Completed",
        title: "ซ่อมเสร็จ",
        stageLabel: "ปิดงานแล้ว",
        badgeClass:
          "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
        headerBgClass:
          "bg-emerald-50/70 hover:bg-emerald-100/70 dark:bg-emerald-950/25 dark:hover:bg-emerald-950/40",
        dotClass: "bg-emerald-600",
      },
      {
        key: "Rejected",
        title: "ไม่อนุมัติ",
        stageLabel: "ช่วงที่ 3",
        badgeClass:
          "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
        headerBgClass:
          "bg-rose-50/70 hover:bg-rose-100/70 dark:bg-rose-950/25 dark:hover:bg-rose-950/40",
        dotClass: "bg-rose-600",
      },
    ];

    const buckets = new Map<string, FixFlushRecord[]>();
    groupDefs.forEach((def) => buckets.set(def.key, []));

    filteredRecords.forEach((r) => {
      const stage = inferMhWorkflowStage(r);
      const isMoreInfo =
        stage === "SupervisorChecked" && r.managerStatus === "More Info Requested";
      const key = isMoreInfo ? "MoreInfo" : stage;
      const list = buckets.get(key);
      if (list) {
        list.push(r);
      } else {
        buckets.set(key, [r]);
      }
    });

    return groupDefs
      .map((def) => {
        const items = buckets.get(def.key) || [];
        const totalCost = items.reduce(
          (sum, item) => sum + getMaintenanceRecordTotalCost(item),
          0
        );
        return { ...def, items, totalCost };
      })
      .filter((group) => group.items.length > 0);
  }, [filteredRecords]);

  const toggleStageGroup = (groupKey: string) => {
    setExpandedStageGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const handleExpandAllGroups = () => {
    const next: Record<string, boolean> = {};
    groupedStatusSections.forEach((g) => {
      next[g.key] = true;
    });
    setExpandedStageGroups(next);
  };

  const handleCollapseAllGroups = () => {
    setExpandedStageGroups({});
  };

  const activeEmployeeNames = useMemo(() => {
    return employees
      .filter((e) => e.employmentStatus === "Active")
      .map((e) => e.employeeName);
  }, [employees]);

  const selectedVehicleObj = useMemo(
    () => vehicles.find((v) => v.vehicleId === reqVehicleId),
    [vehicles, reqVehicleId]
  );

  const isSupervisorOrManager =
    currentUser?.role === "Supervisor" ||
    currentUser?.role === "Assistant Manager" ||
    currentUser?.role === "Manager" ||
    currentUser?.role === "Sr.Warehouse Officer";

  const cloudSyncControls = (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setForkliftCloudRealtimeEnabled(!cloudRealtime)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border transition-colors whitespace-nowrap shrink-0 ${
          cloudRealtime
            ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-700"
            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50 dark:bg-[#0d1b33] dark:text-slate-300 dark:border-[#1e3a5f]"
        }`}
        title="สลับโหมด Cloud Real-time เพื่อประหยัดโควต้าการอ่านข้อมูล"
      >
        {cloudRealtime ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span>{cloudRealtime ? "Cloud Sync: ON" : "Cloud Sync: OFF"}</span>
      </button>

      {!cloudRealtime && (
        <button
          type="button"
          onClick={handleManualReload}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744] whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
          <span>{isRefreshing ? "กำลังโหลด..." : "ดึงข้อมูลล่าสุด"}</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="fix-flush-management space-y-4">
      {headingPortalTarget ? createPortal(cloudSyncControls, headingPortalTarget) : null}

      {/* Top Stage Switcher & Action Bar */}
      <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 dark:bg-[#091322] rounded-md border border-slate-200 dark:border-[#1e3a5f]">
          <button
            type="button"
            onClick={() => {
              setActiveTab("requester");
              setStageFilter("All");
            }}
            className={`inline-flex h-[31px] items-center gap-1.5 px-3 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "requester"
                ? "bg-[#087eaf] text-white"
                : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-[#162744]"
            }`}
          >
            <Wrench size={13} />
            <span>1. ตารางแจ้งซ่อม / ทั้งหมด</span>
            <span className="tabular-nums opacity-85">({records.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("supervisor");
              setStageFilter("All");
              setSupervisorSubFilter("all_sup");
            }}
            className={`inline-flex h-[31px] items-center gap-1.5 px-3 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "supervisor"
                ? "bg-[#087eaf] text-white"
                : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-[#162744]"
            }`}
          >
            <ClipboardCheck size={13} />
            <span>2. หัวหน้างานตรวจสอบ</span>
            {(pendingSupervisorCount > 0 || inWorkshopCount > 0) && (
              <span
                className={`tabular-nums px-1.5 py-0.5 rounded text-[11px] font-bold ${
                  activeTab === "supervisor"
                    ? "bg-white text-[#087eaf]"
                    : pendingSupervisorInfoCount > 0
                    ? "bg-purple-600 text-white"
                    : "bg-amber-500 text-white"
                }`}
              >
                {pendingSupervisorCount + inWorkshopCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("manager");
              setStageFilter("All");
            }}
            className={`inline-flex h-[31px] items-center gap-1.5 px-3 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "manager"
                ? "bg-[#087eaf] text-white"
                : "text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-[#162744]"
            }`}
          >
            <ShieldCheck size={13} />
            <span>3. ผู้จัดการอนุมัติ</span>
            {pendingManagerCount > 0 && (
              <span
                className={`tabular-nums px-1.5 py-0.5 rounded text-[11px] font-bold ${
                  activeTab === "manager"
                    ? "bg-white text-[#087eaf]"
                    : "bg-rose-600 text-white"
                }`}
              >
                {pendingManagerCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!headingPortalTarget && cloudSyncControls}

          <button
            type="button"
            onClick={() => {
              setReqRequesterName(
                currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || ""
              );
              setPhotoError(null);
              setIsRequestModalOpen(true);
            }}
            className="inline-flex h-[35px] items-center gap-1.5 px-3.5 rounded-md text-xs font-bold bg-[#087eaf] hover:bg-[#075985] text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Plus size={14} />
            <span>+ แจ้งซ่อมใหม่</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            ช่วงที่ 1–2 · หัวหน้างานตรวจสอบ / ตอบข้อมูลเพิ่ม
          </div>
          <div className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
            {pendingSupervisorCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            รอตรวจสอบ {pendingSupervisorNewCount} · ผู้จัดการขอข้อมูลเพิ่ม {pendingSupervisorInfoCount}
          </div>
        </div>

        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            ช่วงที่ 3 · รอผู้จัดการอนุมัติ
          </div>
          <div className="text-2xl font-extrabold text-sky-600 dark:text-sky-400 mt-1 tabular-nums">
            {pendingManagerCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            ตรวจสอบราคาและข้อมูลครบถ้วนแล้ว รอพิจารณาอนุมัติ
          </div>
        </div>

        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            ตารางแจ้งซ่อม · รอคิวซ่อม / กำลังซ่อม
          </div>
          <div className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1 tabular-nums">
            {inWorkshopCount + inRepairCount}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            รอคิวซ่อม {inWorkshopCount} · กำลังซ่อม {inRepairCount} · ซ่อมเสร็จ {completedCount}
          </div>
        </div>

        <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            งบซ่อมที่อนุมัติแล้วทั้งหมด
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {totalApprovedCost.toLocaleString()} <span className="text-sm font-semibold">บาท</span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            ใบแจ้งซ่อมทั้งหมด {records.length} รายการ
          </div>
        </div>
      </div>

      {/* Main Content Area: 3-Stage Work Orders */}
      <section className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {activeTab === "supervisor"
                  ? "งานหัวหน้างาน: ตรวจสอบประเมินราคา · ตอบข้อมูลผู้จัดการ · อัปเดตซ่อมเสร็จ"
                  : activeTab === "manager"
                  ? "คิวงานรอผู้จัดการพิจารณาอนุมัติ (Stage 3)"
                  : "ตารางแจ้งซ่อมและติดตามสถานะ Material Handling"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {activeTab === "supervisor"
                  ? "ตรวจสอบใบแจ้งซ่อมใหม่ ตอบข้อมูลเพิ่มเติมเมื่อผู้จัดการสอบถาม (เช่น ชื่อ Vendor) และอัปเดตสถานะรอคิวซ่อมเป็นซ่อมเสร็จ"
                  : activeTab === "manager"
                  ? "พิจารณาอนุมัติหรือส่งกลับให้หัวหน้างานตอบข้อมูลเพิ่มเติม (รายการที่ขอข้อมูลเพิ่มจะวิ่งกลับไปที่คิวหัวหน้างาน)"
                  : "พนักงานแจ้งซ่อม → หัวหน้างานตรวจสอบ → ผู้จัดการอนุมัติ → รอคิวซ่อม → กำลังซ่อม → ซ่อมเสร็จ"}
              </p>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <User size={13} />
              <span>
                ผู้ใช้งาน:{" "}
                <strong className="text-slate-800 dark:text-slate-200">
                  {currentUser?.employeeName || "ผู้ใช้งานทั่วไป"}
                </strong>
                {currentUser?.role ? ` · ${currentUser.role}` : ""}
              </span>
            </div>
          </div>

          {/* Supervisor Stage Quick Sub-Filters */}
          {activeTab === "supervisor" && (
            <div className="px-4 py-2 sm:px-[18px] border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50/60 dark:bg-[#091322] flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setStageFilter("All");
                  setSupervisorSubFilter("all_sup");
                }}
                className={`inline-flex h-[31px] items-center px-2.5 rounded-md font-semibold border transition-colors whitespace-nowrap ${
                  supervisorSubFilter === "all_sup" && stageFilter === "All"
                    ? "bg-[#087eaf] text-white border-[#087eaf]"
                    : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f]"
                }`}
              >
                ทั้งหมดในความดูแล ({pendingSupervisorCount + inWorkshopCount + inRepairCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStageFilter("All");
                  setSupervisorSubFilter("Submitted");
                }}
                className={`inline-flex h-[31px] items-center px-2.5 rounded-md font-semibold border transition-colors whitespace-nowrap ${
                  supervisorSubFilter === "Submitted" && stageFilter === "All"
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f]"
                }`}
              >
                รอตรวจสอบใหม่ ({pendingSupervisorNewCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStageFilter("All");
                  setSupervisorSubFilter("MoreInfo");
                }}
                className={`inline-flex h-[31px] items-center px-2.5 rounded-md font-semibold border transition-colors whitespace-nowrap ${
                  supervisorSubFilter === "MoreInfo" && stageFilter === "All"
                    ? "bg-purple-700 text-white border-purple-700"
                    : "bg-white dark:bg-[#111e38] text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800"
                }`}
              >
                ผู้จัดการขอข้อมูลเพิ่ม / Vendor ({pendingSupervisorInfoCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStageFilter("All");
                  setSupervisorSubFilter("ManagerApproved");
                }}
                className={`inline-flex h-[31px] items-center px-2.5 rounded-md font-semibold border transition-colors whitespace-nowrap ${
                  supervisorSubFilter === "ManagerApproved" && stageFilter === "All"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white dark:bg-[#111e38] text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800"
                }`}
              >
                รอคิวซ่อม ({inWorkshopCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStageFilter("All");
                  setSupervisorSubFilter("InRepair");
                }}
                className={`inline-flex h-[31px] items-center px-2.5 rounded-md font-semibold border transition-colors whitespace-nowrap ${
                  supervisorSubFilter === "InRepair" && stageFilter === "All"
                    ? "bg-orange-600 text-white border-orange-600"
                    : "bg-white dark:bg-[#111e38] text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-800"
                }`}
              >
                กำลังซ่อม → อัปเดตซ่อมเสร็จ ({inRepairCount})
              </button>
            </div>
          )}

          {/* Search & Filters */}
          <div className="fixflush-filterbar px-4 py-2.5 sm:px-[18px] sm:py-3 border-b border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาเลขที่ขอซ่อม (TMT-...), เบอร์รถ, ชื่อผู้แจ้ง, Vendor, อาการ..."
                className="field w-full text-xs font-normal rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#087eaf]"
                style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter size={14} className="text-slate-400 shrink-0" />
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="field text-xs font-normal rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf] max-w-[230px]"
                style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
              >
                <option value="All">
                  {activeTab === "supervisor"
                    ? "คิวงานหัวหน้างาน (ตามแถบด้านบน)"
                    : activeTab === "manager"
                    ? "เฉพาะงานรออนุมัติ"
                    : "ทุกสถานะ (All Stages)"}
                </option>
                <option value="Submitted">1. รอหัวหน้างานตรวจสอบ</option>
                <option value="MoreInfo">2. รอหัวหน้างานตอบข้อมูลเพิ่ม</option>
                <option value="SupervisorChecked">3. รอผู้จัดการอนุมัติ</option>
                <option value="ManagerApproved">4. รอคิวซ่อม (อนุมัติแล้ว)</option>
                <option value="InRepair">5. กำลังซ่อม</option>
                <option value="Completed">6. ซ่อมเสร็จ</option>
                <option value="Rejected">ไม่อนุมัติ</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={repairCategoryFilter}
                onChange={(e) => setRepairCategoryFilter(e.target.value)}
                className="field text-xs font-normal rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf] max-w-[230px]"
                style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
              >
                <option value="All">ทุกประเภทการซ่อม (24 หมวด)</option>
                {MH_REPAIR_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {activeTab === "requester" && groupedStatusSections.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={handleExpandAllGroups}
                  className="inline-flex h-[35px] items-center gap-1 px-2.5 rounded-md text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744] whitespace-nowrap"
                >
                  <ChevronDown size={13} />
                  <span>ขยายทั้งหมด</span>
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAllGroups}
                  className="inline-flex h-[35px] items-center gap-1 px-2.5 rounded-md text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744] whitespace-nowrap"
                >
                  <ChevronRight size={13} />
                  <span>ย่อทั้งหมด</span>
                </button>
              </div>
            )}
          </div>

          {/* Work Orders Table */}
          {(() => {
            const renderWorkOrderRow = (rec: FixFlushRecord) => {
              const meta = getStageMeta(rec);
              const photos = rec.photos || [];
              const partsCostVal = Number(rec.partsCost) || 0;
              const laborCostVal = Number(rec.laborCost) || 0;
              const totalCostVal =
                Number(rec.estimatedCost) || partsCostVal + laborCostVal;

              return (
                <tr
                  key={rec.id}
                  onClick={() => openInspectModal(rec, false)}
                  className="hover:bg-sky-50/50 dark:hover:bg-[#162744]/70 cursor-pointer transition-colors"
                >
                  <td className="ts-left align-top whitespace-nowrap">
                    <div className="font-bold text-[#087eaf] dark:text-sky-400 tabular-nums">
                      {rec.workOrderNo}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {rec.workingDate} · {rec.requesterName || "-"}
                    </div>
                  </td>

                  <td className="ts-left align-top whitespace-nowrap">
                    <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {rec.vehicleId}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {getVehicleTypeDisplayLabel(rec.vehicleType, rec)}
                      {rec.operatingHours > 0 ? ` · ${rec.operatingHours} ชม.` : ""}
                    </div>
                  </td>

                  <td className="ts-left ts-wrap align-top max-w-[320px]">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {rec.repairType}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
                      {rec.repairDescription}
                    </div>
                    {(photos.length > 0 || rec.feedbackThread.length > 0 || rec.vendorName) && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {rec.vendorName && (
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            Vendor: {rec.vendorName}
                          </span>
                        )}
                        {rec.vendorName && (photos.length > 0 || rec.feedbackThread.length > 0) && (
                          <span aria-hidden="true">·</span>
                        )}
                        {photos.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Camera size={11} /> {photos.length} รูป
                          </span>
                        )}
                        {photos.length > 0 && rec.feedbackThread.length > 0 && (
                          <span aria-hidden="true">·</span>
                        )}
                        {rec.feedbackThread.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 font-medium">
                            <MessageSquare size={11} /> {rec.feedbackThread.length} ข้อความ
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="ts-right align-top tabular-nums whitespace-nowrap">
                    {meta.stage === "Submitted" && totalCostVal === 0 ? (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        รอหัวหน้างานประเมิน
                      </span>
                    ) : (
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {totalCostVal.toLocaleString()} บาท
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          อะไหล่ {partsCostVal.toLocaleString()} · แรง{" "}
                          {laborCostVal.toLocaleString()} ({rec.spareParts.length} รายการ)
                        </div>
                      </div>
                    )}
                  </td>

                  <td className="ts-left align-top whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-semibold whitespace-nowrap ${meta.badgeClass}`}
                    >
                      {meta.stage === "Completed" ? (
                        <CheckCircle2 size={12} />
                      ) : meta.stage === "InRepair" ? (
                        <Wrench size={12} />
                      ) : meta.stage === "Rejected" ? (
                        <Ban size={12} />
                      ) : (
                        <Clock size={12} />
                      )}
                      <span>{meta.labelTh}</span>
                    </span>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {rec.supervisorName
                        ? `ตรวจ: ${rec.supervisorName}`
                        : "ยังไม่ผ่านหัวหน้าตรวจสอบ"}
                      {rec.managerName ? ` · อนุมัติ: ${rec.managerName}` : ""}
                    </div>
                  </td>

                  <td
                    className="ts-right align-top whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      {meta.stage === "Submitted" && (
                        <button
                          type="button"
                          onClick={() => openInspectModal(rec, true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white whitespace-nowrap"
                        >
                          <ClipboardCheck size={12} />
                          <span>ตรวจสอบ & ประเมินราคา</span>
                        </button>
                      )}

                      {meta.stage === "SupervisorChecked" &&
                        rec.managerStatus === "More Info Requested" && (
                          <button
                            type="button"
                            onClick={() => openInspectModal(rec, false)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-bold bg-purple-700 hover:bg-purple-800 text-white whitespace-nowrap"
                          >
                            <MessageSquare size={12} />
                            <span>ตอบข้อมูลเพิ่ม</span>
                          </button>
                        )}

                      {activeTab === "manager" &&
                        meta.stage === "SupervisorChecked" &&
                        rec.managerStatus !== "More Info Requested" &&
                        rec.managerStatus !== "Rejected" && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleManagerApprove(rec.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                            >
                              <Check size={12} />
                              <span>อนุมัติ</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFeedbackRecord(rec);
                                setIsFeedbackModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800 whitespace-nowrap"
                            >
                              <HelpCircle size={12} />
                              <span>ขอข้อมูลเพิ่ม</span>
                            </button>
                          </>
                        )}

                      {activeTab !== "manager" && meta.stage === "ManagerApproved" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleMarkInRepair(rec.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-bold bg-orange-600 hover:bg-orange-700 text-white whitespace-nowrap"
                          >
                            <Wrench size={12} />
                            <span>อัปเดต: กำลังซ่อม</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkRepairCompleted(rec.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                          >
                            <CheckCircle2 size={12} />
                            <span>อัปเดต: ซ่อมเสร็จ</span>
                          </button>
                        </>
                      )}

                      {activeTab !== "manager" && meta.stage === "InRepair" && (
                        <button
                          type="button"
                          onClick={() => handleMarkRepairCompleted(rec.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
                        >
                          <CheckCircle2 size={12} />
                          <span>อัปเดต: ซ่อมเสร็จ</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openInspectModal(rec, false)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744] whitespace-nowrap"
                      >
                        <FileText size={12} />
                        <span>รายละเอียด</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            };

            return (
              <div className="overflow-x-auto">
                <table className="ts-stats-table w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300">
                      <th className="ts-left font-bold whitespace-nowrap">เลขที่ขอซ่อม / ผู้แจ้ง</th>
                      <th className="ts-left font-bold whitespace-nowrap">เบอร์รถ</th>
                      <th className="ts-left font-bold whitespace-nowrap">ประเภท & อาการที่แจ้ง</th>
                      <th className="ts-right font-bold whitespace-nowrap">ค่าอะไหล่ / ค่าแรง / รวม</th>
                      <th className="ts-left font-bold whitespace-nowrap">สถานะ 3 ช่วง</th>
                      <th className="ts-right font-bold whitespace-nowrap">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                    {filteredRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="ts-center py-12 px-4">
                          <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                            ไม่พบรายการแจ้งซ่อมตามเงื่อนไขที่เลือก
                          </div>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            {activeTab === "supervisor"
                              ? "ไม่มีงานค้างรอหัวหน้างานตรวจสอบในขณะนี้"
                              : activeTab === "manager"
                              ? "ไม่มีงานค้างรอผู้จัดการอนุมัติในขณะนี้"
                              : "เริ่มต้นแจ้งซ่อมรถโฟล์คลิฟท์หรือเปลี่ยนตัวกรองเพื่อดูรายการอื่น"}
                          </p>
                          {activeTab === "requester" && (
                            <button
                              type="button"
                              onClick={() => setIsRequestModalOpen(true)}
                              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold bg-[#087eaf] hover:bg-[#075985] text-white"
                            >
                              <Plus size={14} />
                              <span>+ แจ้งซ่อมใบแรก</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ) : activeTab === "requester" ? (
                      groupedStatusSections.map((group) => {
                        const isExpanded = Boolean(expandedStageGroups[group.key]);
                        return (
                          <React.Fragment key={group.key}>
                            <tr
                              onClick={() => toggleStageGroup(group.key)}
                              className={`${group.headerBgClass} cursor-pointer transition-colors select-none`}
                            >
                              <td colSpan={6} className="ts-left !py-2.5 !px-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/80 dark:bg-[#0d1b33] border border-slate-300/80 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300">
                                      {isExpanded ? (
                                        <ChevronDown size={13} />
                                      ) : (
                                        <ChevronRight size={13} />
                                      )}
                                    </span>
                                    <span
                                      className={`w-2 h-2 rounded-full shrink-0 ${group.dotClass}`}
                                    />
                                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                      {group.stageLabel}
                                    </span>
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-bold ${group.badgeClass}`}
                                    >
                                      {group.title}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-white dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f] text-[11px] font-extrabold text-slate-800 dark:text-slate-100 tabular-nums">
                                      {group.items.length.toLocaleString("th-TH")} รายการ
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-3 text-[11px] tabular-nums">
                                    {group.totalCost > 0 && (
                                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                                        ยอดรวม {group.totalCost.toLocaleString("th-TH")} บาท
                                      </span>
                                    )}
                                    <span className="text-slate-500 dark:text-slate-400 font-medium">
                                      {isExpanded ? "คลิกเพื่อย่อ" : "คลิกเพื่อขยายดูรายการ"}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && group.items.map((rec) => renderWorkOrderRow(rec))}
                          </React.Fragment>
                        );
                      })
                    ) : (
                      filteredRecords.map((rec) => renderWorkOrderRow(rec))
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

          <div className="px-5 py-2.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex flex-wrap justify-between items-center text-[11px] text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">
              แสดง {filteredRecords.length} จาก {records.length} ใบแจ้งซ่อม
            </span>
            <span>Material Handling · ระบบแจ้งซ่อม 3 ขั้นตอน (TMT-YYYY-MM-NNN)</span>
          </div>
        </section>

      {/* ========================================================================
          MODAL 1: Stage 1 - New Repair Request (พนักงานแจ้งซ่อม)
          ======================================================================== */}
      {isRequestModalOpen && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  แบบฟอร์มแจ้งซ่อมรถ Material Handling (ช่วงที่ 1: พนักงานแจ้งซ่อม)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  ระบุข้อมูลรถ อาการที่พบ และแนบรูปถ่ายสูงสุด 9 รูป · หัวหน้างานจะตรวจสอบและประเมินค่าใช้จ่ายในขั้นถัดไป
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRequestModalOpen(false)}
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleCreateRepairRequest}
              className="p-6 overflow-y-auto flex-1 space-y-4 text-xs"
            >
              {/* Auto-generated Running Number & Working Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    เลขที่ขอซ่อม (รันอัตโนมัติ TMT-ปี-เดือน-ลำดับ)
                  </label>
                  <div className="px-3 py-2.5 rounded-md bg-sky-50 dark:bg-[#091322] border border-sky-200 dark:border-[#1e3a5f] text-[#087eaf] dark:text-sky-400 font-bold text-sm tabular-nums flex items-center justify-between">
                    <span>{previewRequestNo}</span>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      อัตโนมัติ
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    วันที่แจ้งซ่อม *
                  </label>
                  <input
                    type="date"
                    value={reqWorkingDate}
                    onChange={(e) => setReqWorkingDate(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
                  />
                </div>
              </div>

              {/* Requester Name & Vehicle Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ชื่อผู้แจ้งซ่อม *
                  </label>
                  <input
                    type="text"
                    list="mh-repair-employees-list"
                    value={reqRequesterName}
                    onChange={(e) => setReqRequesterName(e.target.value)}
                    placeholder="ระบุชื่อ-นามสกุลผู้แจ้งซ่อม"
                    required
                    className="w-full px-3 py-2.5 rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
                  />
                  <datalist id="mh-repair-employees-list">
                    {activeEmployeeNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    เบอร์รถ *
                  </label>
                  <select
                    value={reqVehicleId}
                    onChange={(e) => setReqVehicleId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
                  >
                    <option value="">-- เลือกเบอร์รถ --</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.vehicleId}>
                        {v.vehicleId} - {getVehicleTypeDisplayLabel(v.vehicleType, v)} ({v.description || "Fleet"})
                      </option>
                    ))}
                  </select>
                  {selectedVehicleObj && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      ทะเบียน: {selectedVehicleObj.registrationNumber || "-"} · สถานะ:{" "}
                      {selectedVehicleObj.operationalStatus}
                    </div>
                  )}
                </div>
              </div>

              {/* Repair Category & Operating Hours */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ประเภทการซ่อม *
                  </label>
                  <select
                    value={reqRepairType}
                    onChange={(e) => setReqRepairType(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
                  >
                    {MH_REPAIR_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    เลขไมล์ / ชั่วโมงการทำงานรถ (ชม.)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={reqOperatingHours}
                    onChange={(e) => setReqOperatingHours(Number(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2.5 rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#087eaf]"
                  />
                </div>
              </div>

              {/* Symptoms / Repair Details */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  อาการ / รายละเอียดที่ต้องการซ่อม *
                </label>
                <textarea
                  value={reqRepairDescription}
                  onChange={(e) => setReqRepairDescription(e.target.value)}
                  rows={3}
                  required
                  placeholder="อธิบายอาการเสีย เสียงผิดปกติ จุดรั่วซึม หรือส่วนที่ชำรุด..."
                  className="w-full px-3 py-2.5 rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
                />
              </div>

              {/* Photo Attachment (Max 9 Photos) */}
              <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Camera size={14} className="text-[#087eaf]" />
                      <span>แนบรูปถ่ายประกอบการแจ้งซ่อม (สูงสุด {MAX_REPAIR_PHOTOS} รูป)</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      แนบแล้ว {reqPhotos.length} / {MAX_REPAIR_PHOTOS} รูป · ย่อขนาดอัตโนมัติ (
                      {Math.round(
                        reqPhotos.reduce((s, p) => s + p.dataUrl.length, 0) / 1024
                      )}{" "}
                      KB)
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handlePhotoFilesSelected(e.target.files)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={reqPhotos.length >= MAX_REPAIR_PHOTOS || isCompressingPhotos}
                      onClick={() => photoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162744] disabled:opacity-50"
                    >
                      <ImagePlus size={14} />
                      <span>
                        {isCompressingPhotos ? "กำลังย่อรูป..." : "+ เลือกรูปถ่าย"}
                      </span>
                    </button>
                  </div>
                </div>

                {photoError && (
                  <div className="mb-3 px-3 py-2 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px]">
                    {photoError}
                  </div>
                )}

                {reqPhotos.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full py-6 border border-dashed border-slate-300 dark:border-[#1e3a5f] rounded-lg text-center text-slate-500 dark:text-slate-400 hover:border-[#087eaf] hover:text-[#087eaf] transition-colors"
                  >
                    คลิกเพื่อเลือกรูปถ่ายหรือถ่ายภาพหน้างาน (รองรับหลายรูปพร้อมกัน สูงสุด 9 รูป)
                  </button>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                    {reqPhotos.map((ph, idx) => (
                      <div
                        key={ph.id}
                        className="relative group rounded-md overflow-hidden border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#091322] aspect-square"
                      >
                        <img
                          src={ph.dataUrl}
                          alt={ph.name}
                          onClick={() => openLightbox(reqPhotos, idx)}
                          className="w-full h-full object-cover cursor-pointer"
                        />
                        <div className="absolute bottom-0 inset-x-0 bg-slate-950/70 text-white text-[10px] px-1.5 py-0.5 flex justify-between items-center tabular-nums">
                          <span>รูปที่ {idx + 1}</span>
                          <span>{Math.round(ph.dataUrl.length / 1024)}KB</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveReqPhoto(ph.id)}
                          className="absolute top-1 right-1 p-1 rounded-full bg-slate-950/75 text-white hover:bg-rose-600 transition-colors"
                          title="ลบรูปนี้"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Additional Notes */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  หมายเหตุเพิ่มเติม
                </label>
                <textarea
                  value={reqNotes}
                  onChange={(e) => setReqNotes(e.target.value)}
                  rows={2}
                  placeholder="ตำแหน่งรถที่จอดอยู่ ความเร่งด่วน หรือหมายเหตุเพิ่มเติม..."
                  className="w-full px-3 py-2.5 rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
                />
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-[#1e3a5f] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRequestModalOpen(false)}
                  className="px-4 py-2 rounded-md text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRequest || isCompressingPhotos}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-bold bg-[#087eaf] hover:bg-[#075985] text-white disabled:opacity-60"
                >
                  <Send size={13} />
                  <span>
                    {isSubmittingRequest
                      ? "กำลังบันทึก..."
                      : "ส่งใบแจ้งซ่อมให้หัวหน้างานตรวจสอบ"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 2: 3-Stage Detail, Supervisor Inspection & Manager Approval
          ======================================================================== */}
      {selectedRecord && (() => {
        const meta = getStageMeta(selectedRecord);
        const photos = selectedRecord.photos || [];
        const partsCostDisplay = Number(selectedRecord.partsCost) || 0;
        const laborCostDisplay = Number(selectedRecord.laborCost) || 0;
        const totalCostDisplay =
          Number(selectedRecord.estimatedCost) || partsCostDisplay + laborCostDisplay;
        const isPostApprovalStage =
          meta.stage === "ManagerApproved" || meta.stage === "InRepair";
        const canEditPostApproval =
          activeTab === "supervisor" && isPostApprovalStage;
        const canSupervisorEdit =
          meta.stage === "Submitted" ||
          ((meta.stage === "SupervisorChecked" || canEditPostApproval) &&
            isEditingSupervisorCost);

        return (
          <div className="fixed inset-0 z-[1000] bg-slate-950/60 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                      ใบขอซ่อม {selectedRecord.workOrderNo}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded border text-[11px] font-semibold ${meta.badgeClass}`}
                    >
                      {meta.labelTh}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    ผู้แจ้ง: {selectedRecord.requesterName || "-"} · วันที่แจ้ง{" "}
                    {selectedRecord.workingDate} · บันทึกเมื่อ {selectedRecord.createdAt}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
                {/* 3-Stage Workflow Stepper */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div
                    className={`p-3 rounded-lg border ${
                      meta.stepNumber >= 1
                        ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30"
                        : "border-slate-200 bg-slate-50 dark:border-[#1e3a5f] dark:bg-[#0d1b33]"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                      <span>ช่วงที่ 1 · พนักงานแจ้งซ่อม</span>
                      <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                      {selectedRecord.requesterName || "-"} · {selectedRecord.createdAt}
                    </div>
                  </div>

                  <div
                    className={`p-3 rounded-lg border ${
                      selectedRecord.managerStatus === "More Info Requested"
                        ? "border-purple-300 bg-purple-50/70 dark:border-purple-800 dark:bg-purple-950/30"
                        : selectedRecord.supervisorStatus === "Checked"
                        ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30"
                        : "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                      <span>ช่วงที่ 2 · หัวหน้างานตรวจสอบ</span>
                      {selectedRecord.managerStatus === "More Info Requested" ? (
                        <HelpCircle size={14} className="text-purple-600 dark:text-purple-400" />
                      ) : selectedRecord.supervisorStatus === "Checked" ? (
                        <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Clock size={14} className="text-amber-600 dark:text-amber-400" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                      {selectedRecord.managerStatus === "More Info Requested"
                        ? "ผู้จัดการขอข้อมูลเพิ่ม — รอหัวหน้างานตอบกลับ"
                        : selectedRecord.supervisorName
                        ? `${selectedRecord.supervisorName} · ${selectedRecord.supervisorCheckedAt || ""}`
                        : "รอหัวหน้างานตรวจสอบและประเมินราคา"}
                    </div>
                  </div>

                  <div
                    className={`p-3 rounded-lg border ${
                      meta.stage === "ManagerApproved" ||
                      meta.stage === "InRepair" ||
                      meta.stage === "Completed"
                        ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30"
                        : meta.stage === "Rejected"
                        ? "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30"
                        : meta.stage === "SupervisorChecked" &&
                          selectedRecord.managerStatus !== "More Info Requested"
                        ? "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30"
                        : "border-slate-200 bg-slate-50 dark:border-[#1e3a5f] dark:bg-[#0d1b33]"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                      <span>ช่วงที่ 3 · ผู้จัดการอนุมัติ</span>
                      {meta.stage === "ManagerApproved" ||
                      meta.stage === "InRepair" ||
                      meta.stage === "Completed" ? (
                        <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                      ) : meta.stage === "Rejected" ? (
                        <Ban size={14} className="text-rose-600 dark:text-rose-400" />
                      ) : (
                        <Clock size={14} className="text-slate-400" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                      {meta.stage === "Completed"
                        ? `ซ่อมเสร็จสิ้น (${selectedRecord.completedAt || ""})`
                        : meta.stage === "InRepair"
                        ? `อนุมัติแล้ว · กำลังซ่อม (${selectedRecord.managerName || ""})`
                        : meta.stage === "ManagerApproved"
                        ? `อนุมัติแล้ว · รอคิวซ่อม (${selectedRecord.managerName || ""})`
                        : selectedRecord.managerStatus === "More Info Requested"
                        ? "รอหัวหน้างานตอบข้อมูลเพิ่มเติมกลับมาก่อน"
                        : selectedRecord.managerName
                        ? `${selectedRecord.managerName} · ${selectedRecord.managerApprovedAt || ""}`
                        : meta.stage === "SupervisorChecked"
                        ? "รอผู้จัดการพิจารณาอนุมัติ"
                        : "รอผ่านช่วงตรวจสอบก่อน"}
                    </div>
                  </div>
                </div>

                {/* Highlighted Manager Inquiry -> Supervisor Reply Banner */}
                {selectedRecord.managerStatus === "More Info Requested" &&
                  meta.stage === "SupervisorChecked" && (() => {
                    const latestManagerQuestion = [...selectedRecord.feedbackThread]
                      .reverse()
                      .find((fb) => fb.role === "Manager");
                    return (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleThreadReply(selectedRecord.id, supReplyText);
                        }}
                        className="p-4 rounded-lg border border-purple-300 dark:border-purple-700 bg-purple-50/70 dark:bg-purple-950/25 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-sm text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                            <HelpCircle size={15} className="text-purple-600 dark:text-purple-400" />
                            <span>ผู้จัดการขอข้อมูลเพิ่มเติม (ส่งกลับหัวหน้างานตอบกลับ)</span>
                          </div>
                          {latestManagerQuestion && (
                            <span className="text-[11px] text-purple-700 dark:text-purple-300 tabular-nums">
                              ถามโดย {latestManagerQuestion.author} · {latestManagerQuestion.timestamp}
                            </span>
                          )}
                        </div>

                        {latestManagerQuestion && (
                          <div className="p-2.5 rounded-md bg-white dark:bg-[#0d1b33] border border-purple-200 dark:border-purple-800">
                            {latestManagerQuestion.queryType && (
                              <div className="text-[11px] font-bold text-purple-700 dark:text-purple-300">
                                {latestManagerQuestion.queryType}
                              </div>
                            )}
                            <div className="text-slate-800 dark:text-slate-200 mt-0.5">
                              {latestManagerQuestion.message}
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            คำชี้แจง / ข้อมูลตอบกลับผู้จัดการ *
                          </label>
                          <input
                            type="text"
                            value={supReplyText}
                            onChange={(e) => setSupReplyText(e.target.value)}
                            required
                            placeholder="ระบุรายละเอียดตอบกลับ เช่น ชื่อ Vendor, ใบเสนอราคา, กำหนดเข้าซ่อม..."
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-purple-800 dark:text-purple-300">
                            เมื่อกดส่งข้อมูลตอบกลับ ใบขอซ่อมจะวิ่งกลับไปที่คิวผู้จัดการเพื่อพิจารณาอนุมัติทันที
                          </span>
                          <button
                            type="submit"
                            disabled={!supReplyText.trim()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-purple-700 hover:bg-purple-800 text-white font-bold whitespace-nowrap disabled:opacity-50"
                          >
                            <Send size={12} /> ส่งข้อมูลตอบกลับไปให้ผู้จัดการอนุมัติ
                          </button>
                        </div>
                      </form>
                    );
                  })()}

                {/* Section A: Request Info & Attached Photos */}
                <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1e3a5f] space-y-3">
                  <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    ข้อมูลการแจ้งซ่อม (ช่วงที่ 1)
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">เบอร์รถ / รุ่นรถ</div>
                      <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                        {selectedRecord.vehicleDescription || selectedRecord.vehicleId}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">ประเภทการซ่อม</div>
                      <div className="font-bold text-[#087eaf] dark:text-sky-400 mt-0.5">
                        {selectedRecord.repairType}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">ชั่วโมงการทำงานรถ</div>
                      <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                        {selectedRecord.operatingHours || 0} ชม.
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 dark:text-slate-400">
                          อาการ / รายละเอียดที่ต้องการซ่อม
                        </span>
                        {canSupervisorEdit && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 text-[10px] font-bold">
                            หัวหน้างานแก้ไขได้
                          </span>
                        )}
                      </div>
                      {canSupervisorEdit &&
                        supRepairDescription.trim() !==
                          (selectedRecord.repairDescription || "").trim() && (
                          <button
                            type="button"
                            onClick={() =>
                              setSupRepairDescription(selectedRecord.repairDescription || "")
                            }
                            className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline"
                          >
                            คืนค่าข้อความเดิม
                          </button>
                        )}
                    </div>
                    {canSupervisorEdit ? (
                      <div className="space-y-1">
                        <textarea
                          value={supRepairDescription}
                          onChange={(e) => setSupRepairDescription(e.target.value)}
                          rows={3}
                          placeholder="ระบุอาการชำรุดหรือรายละเอียดที่ต้องการซ่อม..."
                          className="w-full p-3 rounded-md bg-white dark:bg-[#0c1930] border border-amber-300 dark:border-amber-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
                        />
                        <div className="text-[10.5px] text-amber-700 dark:text-amber-300">
                          * หัวหน้างานสามารถแก้ไขหรือเพิ่มเติมรายละเอียดอาการได้โดยตรง ข้อมูลจะบันทึกเมื่อกดปุ่มยืนยันด้านล่าง
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-md bg-slate-50 dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                        {selectedRecord.repairDescription}
                      </div>
                    )}
                  </div>

                  {selectedRecord.notes && (
                    <div>
                      <div className="text-slate-500 dark:text-slate-400 mb-1">หมายเหตุเพิ่มเติม</div>
                      <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-300">
                        {selectedRecord.notes}
                      </div>
                    </div>
                  )}

                  {/* Photo Gallery */}
                  <div>
                    <div className="text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <Camera size={13} />
                      <span>รูปถ่ายประกอบการแจ้งซ่อม ({photos.length} / 9 รูป)</span>
                    </div>
                    {photos.length === 0 ? (
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                        ไม่มีรูปถ่ายแนบมากับใบแจ้งซ่อมนี้
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                        {photos.map((ph, idx) => (
                          <button
                            key={ph.id}
                            type="button"
                            onClick={() => openLightbox(photos, idx)}
                            className="relative group rounded-md overflow-hidden border border-slate-200 dark:border-[#1e3a5f] aspect-square bg-slate-100 dark:bg-[#091322]"
                          >
                            <img
                              src={ph.dataUrl}
                              alt={ph.name}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-slate-950/0 group-hover:bg-slate-950/35 transition-colors flex items-center justify-center">
                              <ZoomIn
                                size={18}
                                className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Section B: Stage 2 Supervisor Inspection & Parts/Labor Costing */}
                {canSupervisorEdit ? (
                  <form
                    onSubmit={handleSupervisorConfirmInspection}
                    className="p-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/15 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <ClipboardCheck size={15} className="text-amber-600 dark:text-amber-400" />
                          <span>ช่วงที่ 2 · หัวหน้างานตรวจสอบและประเมินค่าใช้จ่าย</span>
                        </h4>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                          {isPostApprovalStage
                            ? `เพิ่มรายการอะไหล่/ราคาต่อชิ้นเพิ่มเติมหลังผู้จัดการอนุมัติ (คงสถานะ${meta.labelTh})`
                            : "กรอกรายการอะไหล่/ราคาต่อชิ้น ค่าอะไหล่ และค่าแรง จากนั้นยืนยันเพื่อส่งให้ผู้จัดการอนุมัติ"}
                        </p>
                      </div>
                      {(meta.stage === "SupervisorChecked" || canEditPostApproval) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSupRepairDescription(selectedRecord.repairDescription || "");
                            setIsEditingSupervisorCost(false);
                          }}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400"
                        >
                          ยกเลิกการแก้ไข
                        </button>
                      )}
                    </div>

                    {/* Technician, Vendor Name, Operating Hours */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          ชื่อ Vendor / ร้านซ่อม (ถ้ามี)
                        </label>
                        <input
                          type="text"
                          value={supVendorName}
                          onChange={(e) => setSupVendorName(e.target.value)}
                          placeholder="เช่น บจก. โฟล์คลิฟท์ เซอร์วิส / ศูนย์ฯ"
                          className="w-full px-2.5 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          ช่างผู้รับผิดชอบ / ตรวจประเมิน
                        </label>
                        <input
                          type="text"
                          list="mh-repair-employees-list"
                          value={supTechnicianName}
                          onChange={(e) => setSupTechnicianName(e.target.value)}
                          placeholder="ระบุชื่อช่างหรือหัวหน้างาน"
                          className="w-full px-2.5 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          ชั่วโมงรถที่ตรวจวัดได้ (ชม.)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={supOperatingHours}
                          onChange={(e) => setSupOperatingHours(Number(e.target.value))}
                          className="w-full px-2.5 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 tabular-nums"
                        />
                      </div>
                    </div>

                    {/* Spare Parts / Price per Unit Table */}
                    <div className="p-3 rounded-lg bg-white dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <Package size={14} className="text-[#087eaf]" />
                          <span>รายการอะไหล่ / ราคาต่อชิ้น</span>
                        </div>
                        <button
                          type="button"
                          onClick={addSupSparePartRow}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#111e38] text-slate-700 dark:text-slate-200 hover:bg-slate-100"
                        >
                          <Plus size={12} /> เพิ่มรายการอะไหล่
                        </button>
                      </div>

                      {supSpareParts.length === 0 ? (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 py-2">
                          ยังไม่มีรายการอะไหล่ (กด "+ เพิ่มรายการอะไหล่" หรือกรอกยอดค่าอะไหล่/ค่าแรงด้านล่างโดยตรง)
                        </div>
                      ) : (
                        <div className="space-y-2 overflow-x-auto">
                          <div className="grid grid-cols-[1fr_1.8fr_0.7fr_0.8fr_1fr_0.9fr_auto] gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400 min-w-[600px]">
                            <span>รหัสอะไหล่</span>
                            <span>ชื่อรายการอะไหล่</span>
                            <span className="text-center">จำนวน</span>
                            <span>หน่วย</span>
                            <span className="text-right">ราคา/ชิ้น (บาท)</span>
                            <span className="text-right">รวม (บาท)</span>
                            <span />
                          </div>
                          {supSpareParts.map((sp, idx) => (
                            <div
                              key={sp.id || idx}
                              className="grid grid-cols-[1fr_1.8fr_0.7fr_0.8fr_1fr_0.9fr_auto] gap-2 items-center min-w-[600px]"
                            >
                              <input
                                type="text"
                                placeholder="รหัส"
                                value={sp.partCode}
                                onChange={(e) =>
                                  updateSupSparePart(idx, "partCode", e.target.value)
                                }
                                className="px-2 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                              />
                              <input
                                type="text"
                                placeholder="ชื่ออะไหล่ / รายละเอียด"
                                value={sp.partName}
                                onChange={(e) =>
                                  updateSupSparePart(idx, "partName", e.target.value)
                                }
                                className="px-2 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                              />
                              <input
                                type="number"
                                min={1}
                                value={sp.qty}
                                onChange={(e) =>
                                  updateSupSparePart(idx, "qty", Number(e.target.value))
                                }
                                className="px-2 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 text-center tabular-nums"
                              />
                              <select
                                value={sp.unit || "ชิ้น"}
                                onChange={(e) => updateSupSparePart(idx, "unit", e.target.value)}
                                className="px-2 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                              >
                                {SPARE_PART_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={0}
                                value={sp.unitCost}
                                onChange={(e) => {
                                  setSupPartsCostManual(false);
                                  updateSupSparePart(idx, "unitCost", Number(e.target.value));
                                }}
                                className="px-2 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 text-right tabular-nums"
                              />
                              <div className="text-right font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                                {((Number(sp.qty) || 0) * (Number(sp.unitCost) || 0)).toLocaleString()}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeSupSparePart(idx)}
                                className="p-1 text-rose-500 hover:text-rose-700"
                                title="ลบแถว"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Parts Cost, Labor Cost, Total Cost */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-white dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f]">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="font-semibold text-slate-700 dark:text-slate-300">
                            ค่าอะไหล่ (บาท)
                          </label>
                          {supPartsCostManual && supSpareParts.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSupPartsCostManual(false);
                                setSupPartsCost(computedPartsSubtotal);
                              }}
                              className="text-[10px] text-[#087eaf] hover:underline flex items-center gap-0.5"
                            >
                              <Calculator size={10} /> ใช้ยอดจากตาราง
                            </button>
                          )}
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={supPartsCost}
                          onChange={(e) => {
                            setSupPartsCostManual(true);
                            setSupPartsCost(Number(e.target.value));
                          }}
                          className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 font-bold tabular-nums text-right"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          ค่าแรง (บาท)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={supLaborCost}
                          onChange={(e) => setSupLaborCost(Number(e.target.value))}
                          className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 font-bold tabular-nums text-right"
                        />
                      </div>

                      <div className="flex flex-col justify-center items-end bg-sky-50 dark:bg-[#091322] rounded-md px-3 py-2 border border-sky-200 dark:border-[#1e3a5f]">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          ยอดรวมค่าใช้จ่ายทั้งหมด
                        </span>
                        <span className="text-lg font-extrabold text-[#087eaf] dark:text-sky-400 tabular-nums">
                          {supTotalEstimatedCost.toLocaleString()} บาท
                        </span>
                      </div>
                    </div>

                    {/* Optional Tire Stock Outbound Link for Tire Categories */}
                    {(selectedRecord.repairType.includes("ยาง") ||
                      selectedRecord.repairType.includes("Tire")) && (
                      <div className="p-3 rounded-lg bg-white dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f] space-y-2">
                        <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={supLogTireOutbound}
                            onChange={(e) => setSupLogTireOutbound(e.target.checked)}
                            className="rounded border-slate-300"
                          />
                          <span>ตัดสต๊อกยางโฟล์คลิฟท์ (mh_tire_stock) พร้อมกัน</span>
                        </label>
                        {supLogTireOutbound && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                            <select
                              value={supTireSize}
                              onChange={(e) => setSupTireSize(e.target.value)}
                              className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                            >
                              {TIRE_SIZE_OPTIONS.map((sz) => (
                                <option key={sz} value={sz}>
                                  {sz}
                                </option>
                              ))}
                            </select>
                            <select
                              value={supTirePosition}
                              onChange={(e) => setSupTirePosition(e.target.value)}
                              className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                            >
                              {WHEEL_POSITION_OPTIONS.map((pos) => (
                                <option key={pos} value={pos}>
                                  {pos}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={1}
                              value={supTireQty}
                              onChange={(e) => setSupTireQty(Number(e.target.value))}
                              placeholder="จำนวน (เส้น)"
                              className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] tabular-nums"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Supervisor Notes */}
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        หมายเหตุ / ความเห็นหัวหน้างาน
                      </label>
                      <textarea
                        value={supNotes}
                        onChange={(e) => setSupNotes(e.target.value)}
                        rows={2}
                        placeholder="สรุปผลการตรวจสอบหน้างาน เหตุผลความจำเป็น หรือเงื่อนไขการรับประกันอะไหล่..."
                        className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    {/* Return to requester inline box */}
                    {showReturnBox && (
                      <div className="p-3 rounded-md bg-white dark:bg-[#091322] border border-amber-300 dark:border-amber-700 space-y-2">
                        <div className="font-semibold text-amber-800 dark:text-amber-300">
                          ระบุเหตุผลที่ส่งกลับให้ผู้แจ้งแก้ไข:
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={returnReasonText}
                            onChange={(e) => setReturnReasonText(e.target.value)}
                            placeholder="เช่น กรุณาถ่ายรูปจุดรั่วซึมเพิ่ม หรือระบุเบอร์รถให้ถูกต้อง..."
                            className="flex-1 px-3 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                          />
                          <button
                            type="button"
                            onClick={handleSupervisorReturnToRequester}
                            disabled={!returnReasonText.trim()}
                            className="px-3 py-1.5 rounded bg-amber-600 text-white font-bold disabled:opacity-50"
                          >
                            ยืนยันส่งกลับ
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
                      {!isPostApprovalStage ? (
                        <button
                          type="button"
                          onClick={() => setShowReturnBox((prev) => !prev)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-[#0d1b33] text-amber-700 dark:text-amber-300 font-semibold hover:bg-amber-50"
                        >
                          <RotateCcw size={13} />
                          <span>ส่งกลับผู้แจ้งแก้ไข</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">
                          ผู้จัดการอนุมัติแล้ว · บันทึกเพิ่มรายการอะไหล่โดยยังคงสถานะ{meta.labelTh}
                        </span>
                      )}

                      <button
                        type="submit"
                        disabled={isSavingSupervisor}
                        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md bg-[#087eaf] hover:bg-[#075985] text-white font-bold disabled:opacity-60 ml-auto"
                      >
                        <ClipboardCheck size={14} />
                        <span>
                          {isSavingSupervisor
                            ? "กำลังบันทึก..."
                            : isPostApprovalStage
                            ? `บันทึกเพิ่มรายการอะไหล่ (คงสถานะ${meta.labelTh})`
                            : "ยืนยันตรวจสอบ & ส่งผู้จัดการอนุมัติ"}
                        </span>
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Read-only Stage 2 Costing Breakdown */
                  <div className="p-4 rounded-lg border border-slate-200 dark:border-[#1e3a5f] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        ผลการตรวจสอบและประเมินค่าใช้จ่าย (ช่วงที่ 2: หัวหน้างาน)
                      </div>
                      {(meta.stage === "SupervisorChecked" || canEditPostApproval) && (
                        <button
                          type="button"
                          onClick={() => openInspectModal(selectedRecord, true)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#087eaf] hover:underline"
                        >
                          {isPostApprovalStage ? (
                            <>
                              <Plus size={13} />
                              <span>เพิ่มรายการอะไหล่ / แก้ไขค่าใช้จ่าย</span>
                            </>
                          ) : (
                            <span>แก้ไขรายการอะไหล่ / ค่าใช้จ่าย</span>
                          )}
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Vendor / ร้านซ่อม</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                          {selectedRecord.vendorName || "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">ช่างผู้รับผิดชอบ</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                          {selectedRecord.technicianName || "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">หัวหน้างานผู้ตรวจสอบ</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                          {selectedRecord.supervisorName || "-"}
                          {selectedRecord.supervisorCheckedAt
                            ? ` (${selectedRecord.supervisorCheckedAt})`
                            : ""}
                        </div>
                      </div>
                    </div>

                    {selectedRecord.spareParts.length > 0 && (
                      <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-md overflow-hidden">
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300">
                              <th className="py-2 px-3 text-left">รหัสอะไหล่</th>
                              <th className="py-2 px-3 text-left">รายการอะไหล่</th>
                              <th className="py-2 px-3 text-center">จำนวน</th>
                              <th className="py-2 px-3 text-right">ราคา/ชิ้น</th>
                              <th className="py-2 px-3 text-right">รวม (บาท)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                            {selectedRecord.spareParts.map((sp, idx) => (
                              <tr key={idx}>
                                <td className="py-2 px-3 font-semibold text-[#087eaf] dark:text-sky-400 tabular-nums">
                                  {sp.partCode || "-"}
                                </td>
                                <td className="py-2 px-3 text-slate-800 dark:text-slate-200">
                                  {sp.partName}
                                </td>
                                <td className="py-2 px-3 text-center tabular-nums">
                                  {sp.qty} {sp.unit || "ชิ้น"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {Number(sp.unitCost).toLocaleString()}
                                </td>
                                <td className="py-2 px-3 text-right font-bold tabular-nums">
                                  {((Number(sp.qty) || 0) * (Number(sp.unitCost) || 0)).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-md bg-slate-50 dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f] tabular-nums">
                      <div className="flex justify-between sm:block">
                        <div className="text-slate-500 dark:text-slate-400">ค่าอะไหล่</div>
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                          {partsCostDisplay.toLocaleString()} บาท
                        </div>
                      </div>
                      <div className="flex justify-between sm:block">
                        <div className="text-slate-500 dark:text-slate-400">ค่าแรง</div>
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                          {laborCostDisplay.toLocaleString()} บาท
                        </div>
                      </div>
                      <div className="flex justify-between sm:block">
                        <div className="text-slate-500 dark:text-slate-400">รวมค่าใช้จ่ายทั้งหมด</div>
                        <div className="font-extrabold text-[#087eaf] dark:text-sky-400 text-base">
                          {totalCostDisplay.toLocaleString()} บาท
                        </div>
                      </div>
                    </div>

                    {selectedRecord.supervisorNotes && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                        <span className="font-semibold">ความเห็นหัวหน้างาน: </span>
                        {selectedRecord.supervisorNotes}
                      </div>
                    )}
                  </div>
                )}

                {/* Section B2: Manager Decision Support — Same Vehicle History & Peer Vehicle Comparison */}
                {(activeTab === "manager" || meta.stage === "SupervisorChecked") &&
                  approvalComparisonData && (
                    <div className="p-4 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/40 dark:bg-[#0c1a33] space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-sky-200/80 dark:border-[#1e3a5f]">
                        <div>
                          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <BarChart3 size={15} className="text-[#087eaf] dark:text-sky-400" />
                            <span>ข้อมูลประวัติย้อนหลังและเปรียบเทียบเพื่อประกอบการตัดสินใจอนุมัติ</span>
                          </h4>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            เปรียบเทียบเฉพาะประเภทการซ่อมเดียวกัน:{" "}
                            <span className="font-bold text-[#087eaf] dark:text-sky-400">
                              {selectedRecord.repairType}
                            </span>
                          </p>
                        </div>
                        <span className="px-2.5 py-1 rounded border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#111e38] text-[11px] font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                          ยอดประเมินใบนี้: {totalCostDisplay.toLocaleString()} บาท
                        </span>
                      </div>

                      {/* 1. Same Vehicle + Same Repair Type History */}
                      <div className="rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] overflow-hidden">
                        <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <History size={14} className="text-amber-600 dark:text-amber-400" />
                            <span>
                              1. ประวัติการซ่อมย้อนหลังของรถ{" "}
                              <span className="text-[#087eaf] dark:text-sky-400">
                                {selectedRecord.vehicleId}
                              </span>{" "}
                              (ประเภทเดียวกัน · {approvalComparisonData.sameVehicleList.length} รายการ)
                            </span>
                          </div>
                          {approvalComparisonData.daysSinceLastRepair !== null &&
                            approvalComparisonData.daysSinceLastRepair <= 30 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 text-[10px] font-bold">
                                <AlertTriangle size={11} />
                                แจ้งซ่อมซ้ำใน {approvalComparisonData.daysSinceLastRepair} วัน
                              </span>
                            )}
                        </div>

                        {approvalComparisonData.sameVehicleList.length === 0 ? (
                          <div className="p-3.5 text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/15 flex items-center gap-1.5">
                            <CheckCircle2 size={13} className="shrink-0" />
                            <span>
                              รถ <strong>{selectedRecord.vehicleId}</strong> ยังไม่เคยมีประวัติการแจ้งซ่อมประเภท{" "}
                              <strong>&ldquo;{selectedRecord.repairType}&rdquo;</strong> มาก่อน (แจ้งซ่อมประเภทนี้ครั้งแรก)
                            </span>
                          </div>
                        ) : (
                          <div className="p-3.5 space-y-3">
                            {/* KPI Summary Strip for Same Vehicle */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]">
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                  เคยซ่อมประเภทนี้มาแล้ว
                                </div>
                                <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                                  {approvalComparisonData.sameVehicleList.length} ครั้ง
                                  {approvalComparisonData.sameValidCount !==
                                    approvalComparisonData.sameVehicleList.length && (
                                    <span className="text-[10.5px] font-normal text-slate-500 ml-1">
                                      (อนุมัติ/ดำเนินการ {approvalComparisonData.sameValidCount})
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]">
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                  ครั้งล่าสุดเมื่อ / ระยะห่าง
                                </div>
                                <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                                  {approvalComparisonData.latestSame?.workingDate || "-"}
                                </div>
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                                  {approvalComparisonData.daysSinceLastRepair !== null
                                    ? `ห่างจากครั้งก่อน ${approvalComparisonData.daysSinceLastRepair} วัน`
                                    : ""}
                                  {approvalComparisonData.hoursSinceLastRepair !== null
                                    ? ` · +${approvalComparisonData.hoursSinceLastRepair.toLocaleString()} ชม.รถ`
                                    : ""}
                                </div>
                              </div>

                              <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]">
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                  ค่าใช้จ่ายสะสม / เฉลี่ยต่อครั้ง
                                </div>
                                <div className="text-sm font-extrabold text-[#087eaf] dark:text-sky-400 tabular-nums mt-0.5">
                                  {approvalComparisonData.sameTotalCost.toLocaleString()} บาท
                                </div>
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                                  เฉลี่ย {approvalComparisonData.sameAvgCost.toLocaleString()} บาท/ครั้ง
                                </div>
                              </div>
                            </div>

                            {/* Table of Same Vehicle History */}
                            <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-md overflow-x-auto">
                              <table className="ts-stats-table w-full text-[11px] border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300">
                                    <th className="ts-left font-bold whitespace-nowrap">วันที่ / เลขที่ใบงาน</th>
                                    <th className="ts-left font-bold whitespace-nowrap">อาการ / รายละเอียด & ร้านซ่อม</th>
                                    <th className="ts-right font-bold whitespace-nowrap">ชม.รถ</th>
                                    <th className="ts-right font-bold whitespace-nowrap">ค่าใช้จ่าย</th>
                                    <th className="ts-center font-bold whitespace-nowrap">สถานะ</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                                  {(showAllSameVehicleHistory
                                    ? approvalComparisonData.sameVehicleList
                                    : approvalComparisonData.sameVehicleList.slice(0, 5)
                                  ).map((hist) => {
                                    const hMeta = getStageMeta(hist);
                                    const hCost = getMaintenanceRecordTotalCost(hist);
                                    return (
                                      <tr
                                        key={hist.id}
                                        className="hover:bg-slate-50 dark:hover:bg-[#162744]/50"
                                      >
                                        <td className="ts-left whitespace-nowrap tabular-nums">
                                          <div className="font-bold text-slate-800 dark:text-slate-200">
                                            {hist.workingDate}
                                          </div>
                                          <div className="text-[10px] text-[#087eaf] dark:text-sky-400">
                                            {hist.workOrderNo}
                                          </div>
                                        </td>
                                        <td className="ts-left ts-wrap min-w-[200px]">
                                          <div className="text-slate-800 dark:text-slate-200 line-clamp-2">
                                            {hist.repairDescription || "-"}
                                          </div>
                                          {(hist.vendorName || hist.spareParts.length > 0) && (
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                              {hist.vendorName ? `Vendor: ${hist.vendorName}` : ""}
                                              {hist.vendorName && hist.spareParts.length > 0 ? " · " : ""}
                                              {hist.spareParts.length > 0
                                                ? `อะไหล่ ${hist.spareParts.length} รายการ`
                                                : ""}
                                            </div>
                                          )}
                                        </td>
                                        <td className="ts-right whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
                                          {hist.operatingHours > 0
                                            ? `${hist.operatingHours.toLocaleString()} ชม.`
                                            : "-"}
                                        </td>
                                        <td className="ts-right whitespace-nowrap tabular-nums">
                                          <div className="font-bold text-slate-900 dark:text-slate-100">
                                            {hCost.toLocaleString()} บาท
                                          </div>
                                          {((Number(hist.partsCost) || 0) > 0 ||
                                            (Number(hist.laborCost) || 0) > 0) && (
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                              อะไหล่ {(Number(hist.partsCost) || 0).toLocaleString()} · แรง{" "}
                                              {(Number(hist.laborCost) || 0).toLocaleString()}
                                            </div>
                                          )}
                                        </td>
                                        <td className="ts-center whitespace-nowrap">
                                          <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold ${hMeta.badgeClass}`}
                                          >
                                            {hMeta.shortLabel}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {approvalComparisonData.sameVehicleList.length > 5 && (
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setShowAllSameVehicleHistory((prev) => !prev)}
                                  className="text-[11px] font-semibold text-[#087eaf] dark:text-sky-400 hover:underline"
                                >
                                  {showAllSameVehicleHistory
                                    ? "ย่อรายการเหลือ 5 รายการล่าสุด"
                                    : `ดูประวัติทั้งหมดของรถคันนี้ (${approvalComparisonData.sameVehicleList.length} รายการ)`}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 2. Other Vehicles + Same Repair Type Benchmark Comparison */}
                      <div className="rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] overflow-hidden">
                        <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <BarChart3 size={14} className="text-indigo-600 dark:text-indigo-400" />
                            <span>
                              2. เปรียบเทียบประวัติการซ่อมของรถคันอื่นในประเภทเดียวกัน (
                              {approvalComparisonData.otherUniqueVehicleCount} คัน ·{" "}
                              {approvalComparisonData.otherVehiclesList.length} รายการ)
                            </span>
                          </div>
                        </div>

                        {approvalComparisonData.otherVehiclesList.length === 0 ? (
                          <div className="p-3.5 text-[11px] text-slate-500 dark:text-slate-400 italic">
                            ยังไม่มีประวัติการซ่อมประเภท &ldquo;{selectedRecord.repairType}&rdquo; ของรถคันอื่นสำหรับเปรียบเทียบในระบบ
                          </div>
                        ) : (
                          <div className="p-3.5 space-y-3">
                            {/* Benchmark KPI Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]">
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                  รถคันอื่นที่เคยซ่อมประเภทนี้
                                </div>
                                <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                                  {approvalComparisonData.otherUniqueVehicleCount} คัน ({approvalComparisonData.otherVehiclesList.length} ครั้ง)
                                </div>
                              </div>

                              <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]">
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                  ค่าเฉลี่ยรถคันอื่น (ต่ำสุด – สูงสุด)
                                </div>
                                <div className="text-sm font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums mt-0.5">
                                  {approvalComparisonData.otherAvgCost > 0
                                    ? `${approvalComparisonData.otherAvgCost.toLocaleString()} บาท/ครั้ง`
                                    : "-"}
                                </div>
                                {approvalComparisonData.otherMaxCost > 0 && (
                                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                                    ช่วง {approvalComparisonData.otherMinCost.toLocaleString()} –{" "}
                                    {approvalComparisonData.otherMaxCost.toLocaleString()} บาท
                                  </div>
                                )}
                              </div>

                              <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]">
                                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                                  เทียบราคาใบนี้กับค่าเฉลี่ยรถคันอื่น
                                </div>
                                {approvalComparisonData.diffFromOtherAvg !== null &&
                                approvalComparisonData.diffFromOtherAvgPct !== null ? (
                                  <>
                                    <div
                                      className={`text-sm font-extrabold tabular-nums mt-0.5 flex items-center gap-1 ${
                                        approvalComparisonData.diffFromOtherAvgPct > 15
                                          ? "text-rose-600 dark:text-rose-400"
                                          : approvalComparisonData.diffFromOtherAvgPct < -10
                                          ? "text-emerald-600 dark:text-emerald-400"
                                          : "text-sky-700 dark:text-sky-300"
                                      }`}
                                    >
                                      {approvalComparisonData.diffFromOtherAvg > 0 ? (
                                        <TrendingUp size={14} />
                                      ) : approvalComparisonData.diffFromOtherAvg < 0 ? (
                                        <TrendingDown size={14} />
                                      ) : null}
                                      <span>
                                        {approvalComparisonData.diffFromOtherAvg > 0
                                          ? `สูงกว่า +${approvalComparisonData.diffFromOtherAvg.toLocaleString()} บ.`
                                          : approvalComparisonData.diffFromOtherAvg < 0
                                          ? `ต่ำกว่า ${Math.abs(approvalComparisonData.diffFromOtherAvg).toLocaleString()} บ.`
                                          : "เท่ากับค่าเฉลี่ย"}
                                      </span>
                                    </div>
                                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                                      ({approvalComparisonData.diffFromOtherAvgPct > 0 ? "+" : ""}
                                      {approvalComparisonData.diffFromOtherAvgPct}% จากค่าเฉลี่ยรถคันอื่น)
                                    </div>
                                  </>
                                ) : (
                                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                    รอข้อมูลราคาเปรียบเทียบ
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Per-Vehicle Quick Summary Chips */}
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">
                                สรุปรายคัน:
                              </span>
                              {approvalComparisonData.otherByVehicle.map((vItem) => (
                                <span
                                  key={vItem.vehicleId}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 text-[10.5px] font-semibold tabular-nums"
                                >
                                  <span className="font-bold">{vItem.vehicleId}</span>
                                  <span className="text-indigo-600/80 dark:text-indigo-300/80 font-normal">
                                    {vItem.count} ครั้ง
                                    {vItem.avgCost > 0
                                      ? ` · เฉลี่ย ${vItem.avgCost.toLocaleString()} บ.`
                                      : ""}
                                  </span>
                                </span>
                              ))}
                            </div>

                            {/* Detailed Peer Vehicles Repair Table */}
                            <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-md overflow-x-auto">
                              <table className="ts-stats-table w-full text-[11px] border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300">
                                    <th className="ts-left font-bold whitespace-nowrap">เบอร์รถ</th>
                                    <th className="ts-left font-bold whitespace-nowrap">วันที่ / เลขที่ใบงาน</th>
                                    <th className="ts-left font-bold whitespace-nowrap">อาการ / ร้านซ่อม</th>
                                    <th className="ts-right font-bold whitespace-nowrap">ชม.รถ</th>
                                    <th className="ts-right font-bold whitespace-nowrap">ค่าใช้จ่าย (เทียบใบนี้)</th>
                                    <th className="ts-center font-bold whitespace-nowrap">สถานะ</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                                  {(showAllOtherVehicleHistory
                                    ? approvalComparisonData.otherVehiclesList
                                    : approvalComparisonData.otherVehiclesList.slice(0, 5)
                                  ).map((other) => {
                                    const oMeta = getStageMeta(other);
                                    const oCost = getMaintenanceRecordTotalCost(other);
                                    const diffVsThis =
                                      totalCostDisplay > 0 && oCost > 0
                                        ? totalCostDisplay - oCost
                                        : null;
                                    return (
                                      <tr
                                        key={other.id}
                                        className="hover:bg-slate-50 dark:hover:bg-[#162744]/50"
                                      >
                                        <td className="ts-left whitespace-nowrap">
                                          <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                                            {other.vehicleId}
                                          </div>
                                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                            {getVehicleTypeDisplayLabel(other.vehicleType, other)}
                                          </div>
                                        </td>
                                        <td className="ts-left whitespace-nowrap tabular-nums">
                                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                                            {other.workingDate}
                                          </div>
                                          <div className="text-[10px] text-[#087eaf] dark:text-sky-400">
                                            {other.workOrderNo}
                                          </div>
                                        </td>
                                        <td className="ts-left ts-wrap min-w-[180px]">
                                          <div className="text-slate-800 dark:text-slate-200 line-clamp-2">
                                            {other.repairDescription || "-"}
                                          </div>
                                          {other.vendorName && (
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                              Vendor: {other.vendorName}
                                            </div>
                                          )}
                                        </td>
                                        <td className="ts-right whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
                                          {other.operatingHours > 0
                                            ? `${other.operatingHours.toLocaleString()} ชม.`
                                            : "-"}
                                        </td>
                                        <td className="ts-right whitespace-nowrap tabular-nums">
                                          <div className="font-bold text-slate-900 dark:text-slate-100">
                                            {oCost.toLocaleString()} บาท
                                          </div>
                                          {diffVsThis !== null && (
                                            <div
                                              className={`text-[10px] font-semibold ${
                                                diffVsThis > 0
                                                  ? "text-rose-600 dark:text-rose-400"
                                                  : diffVsThis < 0
                                                  ? "text-emerald-600 dark:text-emerald-400"
                                                  : "text-slate-400"
                                              }`}
                                            >
                                              {diffVsThis > 0
                                                ? `ใบนี้แพงกว่า +${diffVsThis.toLocaleString()}`
                                                : diffVsThis < 0
                                                ? `ใบนี้ถูกกว่า ${Math.abs(diffVsThis).toLocaleString()}`
                                                : "ราคาเท่ากัน"}
                                            </div>
                                          )}
                                        </td>
                                        <td className="ts-center whitespace-nowrap">
                                          <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold ${oMeta.badgeClass}`}
                                          >
                                            {oMeta.shortLabel}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {approvalComparisonData.otherVehiclesList.length > 5 && (
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setShowAllOtherVehicleHistory((prev) => !prev)}
                                  className="text-[11px] font-semibold text-[#087eaf] dark:text-sky-400 hover:underline"
                                >
                                  {showAllOtherVehicleHistory
                                    ? "ย่อรายการเหลือ 5 รายการล่าสุด"
                                    : `ดูรายการเปรียบเทียบรถคันอื่นทั้งหมด (${approvalComparisonData.otherVehiclesList.length} รายการ)`}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {/* Section C: Feedback / Query Loop */}
                <div className="p-4 rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/40 dark:bg-purple-950/15 space-y-3">
                  <div className="font-bold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                    <MessageSquare size={14} />
                    <span>ประวัติการสอบถามและตอบกลับข้อมูล (Feedback Thread)</span>
                  </div>

                  {selectedRecord.feedbackThread.length === 0 ? (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                      ยังไม่มีข้อความสอบถามหรือบันทึกเพิ่มเติม
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedRecord.feedbackThread.map((fb) => (
                        <div
                          key={fb.id}
                          className="p-2.5 rounded-md bg-white dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f]"
                        >
                          <div className="flex justify-between text-[11px] font-bold mb-1">
                            <span className="text-slate-800 dark:text-slate-200">
                              {fb.author} ({fb.role})
                            </span>
                            <span className="text-slate-400 font-normal tabular-nums">
                              {fb.timestamp}
                            </span>
                          </div>
                          {fb.queryType && (
                            <div className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 mb-0.5">
                              หัวข้อ: {fb.queryType}
                            </div>
                          )}
                          <div className="text-slate-700 dark:text-slate-300">{fb.message}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedRecord.managerStatus === "More Info Requested" && (
                    <div className="text-[11px] text-purple-700 dark:text-purple-300 font-semibold">
                      * กรุณากรอกคำชี้แจง / ข้อมูลตอบกลับผู้จัดการในกล่องตอบข้อมูลเพิ่มเติมด้านบนของหน้าต่างนี้ เพื่อส่งกลับให้ผู้จัดการอนุมัติ
                    </div>
                  )}
                </div>

                {/* Inline Reject Box for Manager */}
                {activeTab === "manager" && showRejectBox && (
                  <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 space-y-2">
                    <div className="font-bold text-rose-700 dark:text-rose-300">
                      ระบุเหตุผลการไม่อนุมัติใบแจ้งซ่อม:
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={rejectReasonText}
                        onChange={(e) => setRejectReasonText(e.target.value)}
                        placeholder="เช่น ราคาสูงเกินงบประมาณ หรือให้รอตรวจสภาพซ้ำ..."
                        className="flex-1 px-3 py-1.5 rounded border border-rose-300 dark:border-rose-700 bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => handleManagerReject(selectedRecord.id, rejectReasonText)}
                        className="px-4 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold whitespace-nowrap"
                      >
                        ยืนยันไม่อนุมัติ
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer Actions */}
              <div className="px-6 py-3.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {activeTab === "manager" &&
                    meta.stage === "SupervisorChecked" &&
                    selectedRecord.managerStatus !== "More Info Requested" &&
                    selectedRecord.managerStatus !== "Rejected" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleManagerApprove(selectedRecord.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <Check size={14} /> อนุมัติซ่อม → รอคิวซ่อม
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFeedbackRecord(selectedRecord);
                            setIsFeedbackModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800"
                        >
                          <HelpCircle size={14} /> ขอข้อมูลเพิ่ม (ส่งกลับหัวหน้างาน)
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRejectBox((prev) => !prev)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800"
                        >
                          <Ban size={14} /> ไม่อนุมัติ
                        </button>
                      </>
                    )}

                  {activeTab !== "manager" && meta.stage === "ManagerApproved" && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleMarkInRepair(selectedRecord.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white"
                      >
                        <Wrench size={14} /> หัวหน้างานอัปเดต: กำลังซ่อม
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMarkRepairCompleted(selectedRecord.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <CheckCircle2 size={14} /> หัวหน้างานอัปเดต: ซ่อมเสร็จ
                      </button>
                    </>
                  )}

                  {activeTab !== "manager" && meta.stage === "InRepair" && (
                    <button
                      type="button"
                      onClick={() => handleMarkRepairCompleted(selectedRecord.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 size={14} /> หัวหน้างานอัปเดต: ซ่อมเสร็จ
                    </button>
                  )}

                  {isSupervisorOrManager &&
                    (confirmDeleteId === selectedRecord.id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDeleteMaintenanceOrder(selectedRecord.id)}
                          className="px-3 py-1.5 rounded text-xs font-bold bg-rose-600 text-white"
                        >
                          ยืนยันลบใบซ่อม
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1.5 rounded text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f]"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(selectedRecord.id)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 size={13} /> ลบใบงาน
                      </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {activeTab !== "manager" && (
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200"
                    >
                      <Printer size={13} /> พิมพ์ใบขอซ่อม
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedRecord(null)}
                    className="px-4 py-2 rounded-md text-xs font-bold bg-slate-800 hover:bg-slate-900 dark:bg-[#087eaf] dark:hover:bg-[#075985] text-white"
                  >
                    ปิดหน้าต่าง
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================
          MODAL 3: Manager Query / Feedback Modal
          ======================================================================== */}
      {isFeedbackModalOpen && feedbackRecord && (
        <div className="fixed inset-0 z-[1050] bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  ขอรายละเอียดเพิ่มเติม: {feedbackRecord.workOrderNo}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  ข้อมูลจะวิ่งกลับไปยังคิวหัวหน้างานตรวจสอบเพื่อตอบคำชี้แจงก่อนส่งกลับมาอนุมัติ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFeedbackModalOpen(false)}
                className="text-slate-500 hover:text-slate-800 dark:text-slate-400"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendManagerQuery} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  รายละเอียดคำถามส่งกลับให้หัวหน้างาน *
                </label>
                <textarea
                  value={feedbackMessageText}
                  onChange={(e) => setFeedbackMessageText(e.target.value)}
                  rows={4}
                  required
                  placeholder="เช่น ขอทราบชื่อ Vendor / ร้านซ่อมที่เข้ามาดำเนินการซ่อม หรือรายละเอียดอะไหล่เพิ่มเติม..."
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFeedbackModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 dark:border-[#1e3a5f] font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-purple-700 hover:bg-purple-800 text-white font-bold"
                >
                  <Send size={13} /> ส่งคำถาม
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 4: Photo Lightbox Viewer
          ======================================================================== */}
      {lightboxPhotos.length > 0 && (
        <div
          className="fixed inset-0 z-[1100] bg-slate-950/90 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxPhotos([])}
        >
          <div
            className="w-full max-w-4xl flex items-center justify-between text-white mb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-semibold tabular-nums">
              รูปที่ {lightboxIndex + 1} / {lightboxPhotos.length} ·{" "}
              {lightboxPhotos[lightboxIndex]?.name}
            </div>
            <button
              type="button"
              onClick={() => setLightboxPhotos([])}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white"
            >
              <X size={20} />
            </button>
          </div>

          <div
            className="relative flex items-center justify-center max-w-4xl max-h-[80vh] w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {lightboxPhotos.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setLightboxIndex((prev) =>
                    prev === 0 ? lightboxPhotos.length - 1 : prev - 1
                  )
                }
                className="absolute left-2 p-2 rounded-full bg-slate-950/70 hover:bg-slate-900 text-white"
              >
                <ChevronLeft size={22} />
              </button>
            )}

            <img
              src={lightboxPhotos[lightboxIndex]?.dataUrl}
              alt={lightboxPhotos[lightboxIndex]?.name || "Repair attachment"}
              className="max-h-[78vh] max-w-full rounded-lg object-contain border border-white/15"
            />

            {lightboxPhotos.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setLightboxIndex((prev) =>
                    prev === lightboxPhotos.length - 1 ? 0 : prev + 1
                  )
                }
                className="absolute right-2 p-2 rounded-full bg-slate-950/70 hover:bg-slate-900 text-white"
              >
                <ChevronRight size={22} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
