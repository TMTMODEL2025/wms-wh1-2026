/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Truck,
  ArrowRight,
  ArrowLeftRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  X,
  FileText,
  User,
  Package,
  RefreshCw,
  Wifi,
  WifiOff,
  Trash2,
  Send,
  Layers,
  Scale,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  MapPin,
} from "lucide-react";
import { Employee, Vehicle, VehicleAssignment } from "../types/officer";
import {
  MH_TEAMS,
  MH_SHIFTS,
  MH_WORK_AREAS,
  MhDailyDutyRecord,
  MhDeliveryPointRecord,
  MhTransferRecord,
  MhTransferStatus,
  loadCachedMhDailyDuties,
  loadCachedMhDeliveryPoints,
  extractUniqueDeliveryPointNames,
  subscribeToMhTransfers,
  subscribeToMhDailyDuties,
  subscribeToMhDeliveryPoints,
  fetchMhTransfersOnce,
  fetchMhDailyDutiesOnce,
  fetchMhDeliveryPointsOnce,
  saveMhTransferToCloud,
  saveMhTransfersBatchToCloud,
  deleteMhTransferFromCloud,
  getForkliftCloudRealtimeEnabled,
  setForkliftCloudRealtimeEnabled,
  subscribeForkliftCloudRealtimeMode,
} from "../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import { useAuth } from "../contexts/AuthContext";
import { DailyDutyAssignmentPanel } from "./DailyDutyAssignmentPanel";
import {
  showConfirmDialog,
  showErrorAlert,
  showSuccessAlert,
  showWarningAlert,
} from "../utils/swalUtils";

type TransportTransferRecord = MhTransferRecord;

interface TransportOperationsProps {
  vehicles: Vehicle[];
  assignments: VehicleAssignment[];
  employees?: Employee[];
  onNavigateToAssignments?: () => void;
  onNavigateToVehicles?: () => void;
}

interface QueuedTripDraft {
  queueId: string;
  workingDate: string;
  workingTime: string;
  isDateTimeEdited: boolean;
  driverName: string;
  vehicleNumber: string;
  workArea: string;
  shift: string;
  team: string;
  itemName: string;
  transferType: string;
  originFacility: string;
  destinationFacility: string;
  fullBundles: number;
  weightPerBundleKg: number;
  remainderWeightKg: number;
  totalBundles: number;
  totalWeightKg: number;
  tripCount: number;
  notes: string;
}

const SLA_LIMIT_SECONDS = 20 * 60; // 1200 seconds (20 minutes)
const LAST_VEHICLE_STORAGE_KEY = "tmt_mh_last_vehicle_v1";

const QUICK_PRODUCTS = ["เหล็กฟิล์ม", "เหล็กม้วน", "เหล็กสลิต", "เหล็กแผ่น RM"];
const QUICK_TRANSFER_TYPES = ["งาน Stock", "ทั่วไป", "งานฝาก", "อื่นๆ"];
const QUICK_BUILDINGS = ["อาคาร A", "อาคาร B", "อาคาร C", "ลานพักสินค้า"];
const QUICK_TRIP_COUNTS = [1, 2, 3, 4, 5];

function escapeHtmlText(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getLocalDateStr(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLocalTimeHmStr(date = new Date()): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

function getLocalTimeHmsStr(date = new Date()): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${min}:${s}`;
}

function parseRecordStartMs(record: TransportTransferRecord): number | null {
  if (typeof record.startTimeMs === "number" && !isNaN(record.startTimeMs) && record.startTimeMs > 0) {
    return record.startTimeMs;
  }
  if (record.workingDate && record.startTime) {
    const normalizedTime = record.startTime.length === 5 ? `${record.startTime}:00` : record.startTime;
    const parsed = new Date(`${record.workingDate}T${normalizedTime}`).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  if (record.createdAt) {
    const parsed = new Date(record.createdAt.replace(" ", "T")).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

function formatDurationClock(totalSeconds: number): string {
  const safeSec = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safeSec / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);
  const secs = safeSec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDurationThai(totalSeconds: number): string {
  const safeSec = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  if (mins === 0) return `${secs} วินาที`;
  if (secs === 0) return `${mins} นาที`;
  return `${mins} นาที ${secs} วิ`;
}

function getRecordWeightKg(record: TransportTransferRecord): number {
  if (typeof record.totalWeightKg === "number" && !isNaN(record.totalWeightKg)) {
    return record.totalWeightKg;
  }
  if (
    typeof record.fullBundles === "number" &&
    typeof record.weightPerBundleKg === "number"
  ) {
    return record.fullBundles * record.weightPerBundleKg + (record.remainderWeightKg || 0);
  }
  if (typeof record.weightTon === "number" && !isNaN(record.weightTon)) {
    return Math.round(record.weightTon * 1000);
  }
  return 0;
}

function getRecordDurationSeconds(record: TransportTransferRecord, nowMs: number): number {
  if (record.status === "Completed") {
    if (typeof record.durationSeconds === "number" && !isNaN(record.durationSeconds)) {
      return Math.max(0, Math.round(record.durationSeconds));
    }
    if (typeof record.startTimeMs === "number" && typeof record.endTimeMs === "number") {
      return Math.max(0, Math.round((record.endTimeMs - record.startTimeMs) / 1000));
    }
    if (typeof record.durationMinutes === "number" && !isNaN(record.durationMinutes)) {
      return Math.max(0, Math.round(record.durationMinutes * 60));
    }
    return 0;
  }
  if (record.status === "Cancelled") {
    return typeof record.durationSeconds === "number" ? record.durationSeconds : 0;
  }
  const startMs = parseRecordStartMs(record);
  if (!startMs) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

function isRecordOverdue(record: TransportTransferRecord, nowMs: number): boolean {
  if (record.status === "Cancelled") return false;
  if (record.status === "Completed" && typeof record.isSlaOverdue === "boolean") {
    return record.isSlaOverdue;
  }
  return getRecordDurationSeconds(record, nowMs) > SLA_LIMIT_SECONDS;
}

function getStatusBadgeInfo(status: MhTransferStatus): {
  label: string;
  classes: string;
} {
  switch (status) {
    case "In Transit":
      return {
        label: "อยู่ระหว่างการส่ง",
        classes:
          "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
      };
    case "Pending":
      return {
        label: "รอดำเนินการ",
        classes:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
      };
    case "Completed":
      return {
        label: "จบงานแล้ว (Completed)",
        classes:
          "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "Cancelled":
      return {
        label: "ยกเลิก",
        classes:
          "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

function getTeamTagClass(team?: string): string {
  if (team === "ทีม A") {
    return "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200";
  }
  if (team === "ทีม B") {
    return "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200";
  }
  if (team === "ทีม C") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

export function TransportOperations({
  vehicles,
  employees = [],
  onNavigateToAssignments,
  onNavigateToVehicles,
}: TransportOperationsProps) {
  const { currentUser } = useAuth();
  const [transfers, setTransfers] = useState<TransportTransferRecord[]>([]);
  const [dailyDuties, setDailyDuties] = useState<MhDailyDutyRecord[]>(() =>
    loadCachedMhDailyDuties()
  );
  const [deliveryPoints, setDeliveryPoints] = useState<MhDeliveryPointRecord[]>(() =>
    loadCachedMhDeliveryPoints()
  );
  const [cloudRealtime, setCloudRealtime] = useState<boolean>(() =>
    getForkliftCloudRealtimeEnabled()
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDailyDutyModalOpen, setIsDailyDutyModalOpen] = useState<boolean>(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Real-time ticking clock for 20-minute SLA timer
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Quick Entry Form toggle (hidden by default)
  const [isQuickFormExpanded, setIsQuickFormExpanded] = useState<boolean>(false);

  // History Table Status Group collapse state (both collapsed by default)
  const [expandedStatusGroups, setExpandedStatusGroups] = useState<{
    inProgress: boolean;
    completed: boolean;
    cancelled: boolean;
  }>({
    inProgress: false,
    completed: false,
    cancelled: false,
  });

  // Quick Transfer Entry State
  const [workingDate, setWorkingDate] = useState<string>(() => getLocalDateStr());
  const [workingTime, setWorkingTime] = useState<string>(() => getLocalTimeHmStr());
  const [isDateTimeEdited, setIsDateTimeEdited] = useState<boolean>(false);

  const loggedInDriverName = useMemo(
    () =>
      currentUser?.employeeName?.trim() ||
      currentUser?.employeeId?.trim() ||
      "",
    [currentUser]
  );
  const driverName = loggedInDriverName;
  const [vehicleNumber, setVehicleNumber] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(LAST_VEHICLE_STORAGE_KEY);
        if (saved) return saved;
      } catch {
        // ignore
      }
    }
    return vehicles[0]?.vehicleId || "";
  });

  // Duty-linked fields (auto-filled when matched, or manually selectable)
  const [workArea, setWorkArea] = useState<string>("อาคาร A");
  const [shift, setShift] = useState<string>(MH_SHIFTS[0]);
  const [team, setTeam] = useState<string>(MH_TEAMS[0]);
  const [manualDutyOverride, setManualDutyOverride] = useState<boolean>(false);

  const [itemName, setItemName] = useState<string>("เหล็กม้วน");
  const [transferType, setTransferType] = useState<string>("งาน Stock");
  const [originFacility, setOriginFacility] = useState<string>("อาคาร A");
  const [destinationFacility, setDestinationFacility] = useState<string>("อาคาร B");

  // 3-field Weight Calculator
  const [fullBundlesInput, setFullBundlesInput] = useState<string>("1");
  const [weightPerBundleInput, setWeightPerBundleInput] = useState<string>("0");
  const [remainderWeightInput, setRemainderWeightInput] = useState<string>("0");

  // Multi-trip batch & queue
  const [tripCount, setTripCount] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const [queuedTrips, setQueuedTrips] = useState<QueuedTripDraft[]>([]);
  const [showOptionalFields, setShowOptionalFields] = useState<boolean>(false);

  // History Filters & Detail Modal
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [teamFilter, setTeamFilter] = useState<string>("All");
  const [shiftFilter, setShiftFilter] = useState<string>("All");
  const [selectedRecord, setSelectedRecord] = useState<TransportTransferRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const lastAppliedDutyKeyRef = useRef<string>("");

  // Subscribe to cloud real-time toggle
  useEffect(() => {
    const unsubMode = subscribeForkliftCloudRealtimeMode((enabled) => {
      setCloudRealtime(enabled);
    });
    return () => unsubMode();
  }, []);

  // Subscribe to mh_transfers, mh_daily_duty & mh_delivery_points ONLY while mounted
  useEffect(() => {
    const unsubTransfers = subscribeToMhTransfers((cloudRecords) => {
      setTransfers(cloudRecords);
    });
    const unsubDuties = subscribeToMhDailyDuties((cloudDuties) => {
      setDailyDuties(cloudDuties);
    });
    const unsubDeliveryPoints = subscribeToMhDeliveryPoints((cloudPoints) => {
      setDeliveryPoints(cloudPoints);
    });
    return () => {
      unsubTransfers();
      unsubDuties();
      unsubDeliveryPoints();
    };
  }, [cloudRealtime]);

  const configuredDeliveryPointNames = useMemo(
    () => extractUniqueDeliveryPointNames(deliveryPoints),
    [deliveryPoints]
  );

  const facilityOptions = useMemo(() => {
    if (configuredDeliveryPointNames.length > 0) {
      return configuredDeliveryPointNames;
    }
    return [
      ...QUICK_BUILDINGS,
      ...MH_WORK_AREAS.filter((a) => !QUICK_BUILDINGS.includes(a)),
    ];
  }, [configuredDeliveryPointNames]);

  useEffect(() => {
    if (configuredDeliveryPointNames.length === 0) return;
    setOriginFacility((prev) =>
      prev === "อาคาร A" && !configuredDeliveryPointNames.includes(prev)
        ? configuredDeliveryPointNames[0]
        : prev
    );
    setDestinationFacility((prev) =>
      prev === "อาคาร B" && !configuredDeliveryPointNames.includes(prev)
        ? configuredDeliveryPointNames[1] || configuredDeliveryPointNames[0]
        : prev
    );
  }, [configuredDeliveryPointNames]);

  // Persist last used vehicle locally
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (vehicleNumber.trim()) {
        window.localStorage.setItem(LAST_VEHICLE_STORAGE_KEY, vehicleNumber.trim());
      }
    } catch {
      // ignore storage error
    }
  }, [vehicleNumber]);

  // Auto-keep quick date/time synced to current minute while untouched
  useEffect(() => {
    if (isDateTimeEdited) return;
    const syncTimer = window.setInterval(() => {
      const now = new Date();
      setWorkingDate(getLocalDateStr(now));
      setWorkingTime(getLocalTimeHmStr(now));
    }, 15000);
    return () => window.clearInterval(syncTimer);
  }, [isDateTimeEdited]);

  // Match Daily Duty Assignment for logged-in driver & workingDate
  const matchedDailyDuty = useMemo(() => {
    const cleanDriver = driverName.trim().toLowerCase();
    const cleanEmpId = (currentUser?.employeeId || "").trim().toLowerCase();
    if (!cleanDriver && !cleanEmpId) return null;
    const isDutyForLoggedInUser = (d: MhDailyDutyRecord) =>
      (cleanEmpId && (d.employeeId || "").trim().toLowerCase() === cleanEmpId) ||
      (cleanDriver && d.employeeName.trim().toLowerCase() === cleanDriver);

    const targetDate = workingDate || getLocalDateStr();
    const exactDateMatch = dailyDuties.find(
      (d) => d.workingDate === targetDate && isDutyForLoggedInUser(d)
    );
    if (exactDateMatch) return exactDateMatch;

    // Fallback to today's date if workingDate differs or vice versa
    const todayStr = getLocalDateStr();
    if (targetDate !== todayStr) {
      return (
        dailyDuties.find(
          (d) => d.workingDate === todayStr && isDutyForLoggedInUser(d)
        ) || null
      );
    }
    return null;
  }, [dailyDuties, driverName, currentUser?.employeeId, workingDate]);

  // Auto-fill vehicle, workArea, originFacility, shift, team when matchedDailyDuty changes
  useEffect(() => {
    if (!matchedDailyDuty) {
      lastAppliedDutyKeyRef.current = "";
      return;
    }
    const key = `${matchedDailyDuty.id}__${matchedDailyDuty.updatedAt}`;
    if (lastAppliedDutyKeyRef.current === key) return;
    lastAppliedDutyKeyRef.current = key;

    const assignedVeh =
      matchedDailyDuty.vehicleNumber && matchedDailyDuty.vehicleNumber !== "-"
        ? matchedDailyDuty.vehicleNumber
        : "";
    setVehicleNumber(assignedVeh);
    setWorkArea(matchedDailyDuty.workArea || "อาคาร A");
    setOriginFacility(matchedDailyDuty.workArea || "อาคาร A");
    setShift(matchedDailyDuty.shift || MH_SHIFTS[0]);
    setTeam(matchedDailyDuty.team || MH_TEAMS[0]);
    setManualDutyOverride(false);
  }, [matchedDailyDuty]);

  // Live 1-second timer tick while there are active transfers
  const activeTransfers = useMemo(
    () => transfers.filter((t) => t.status === "In Transit" || t.status === "Pending"),
    [transfers]
  );

  useEffect(() => {
    if (activeTransfers.length === 0) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeTransfers.length]);

  // Auto-dismiss feedback banner
  useEffect(() => {
    if (!feedbackBanner) return;
    const timer = window.setTimeout(() => setFeedbackBanner(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedbackBanner]);

  // Live Weight Calculation
  const fullBundles = Math.max(0, Math.floor(Number(fullBundlesInput) || 0));
  const weightPerBundleKg = Math.max(0, Number(weightPerBundleInput) || 0);
  const remainderWeightKg = Math.max(0, Number(remainderWeightInput) || 0);
  const hasRemainderBundle = remainderWeightKg > 0;
  const totalBundles = fullBundles + (hasRemainderBundle ? 1 : 0);
  const fullBundlesWeightKg = fullBundles * weightPerBundleKg;
  const totalWeightKg = Number((fullBundlesWeightKg + remainderWeightKg).toFixed(2));
  const totalWeightTon = Number((totalWeightKg / 1000).toFixed(3));

  const handleManualReload = async () => {
    setIsRefreshing(true);
    try {
      const [latestTransfers, latestDuties, latestDeliveryPoints] = await Promise.all([
        fetchMhTransfersOnce(),
        fetchMhDailyDutiesOnce(),
        fetchMhDeliveryPointsOnce(),
      ]);
      setTransfers(latestTransfers);
      setDailyDuties(latestDuties);
      setDeliveryPoints(latestDeliveryPoints);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleResetToCurrentTime = () => {
    const now = new Date();
    setWorkingDate(getLocalDateStr(now));
    setWorkingTime(getLocalTimeHmStr(now));
    setIsDateTimeEdited(false);
  };

  const handleSwapFacilities = () => {
    const prevOrigin = originFacility;
    setOriginFacility(destinationFacility);
    setDestinationFacility(prevOrigin);
  };

  const validateCurrentForm = (): string | null => {
    if (!driverName.trim()) return "กรุณาระบุชื่อ-สกุลพนักงานขับรถ";
    if (!itemName.trim()) return "กรุณาระบุชื่อสินค้า";
    if (!originFacility.trim() || !destinationFacility.trim()) {
      return "กรุณาระบุทั้งต้นทางและปลายทาง";
    }
    if (totalBundles <= 0 && totalWeightKg <= 0) {
      return "กรุณาระบุจำนวนมัดหรือน้ำหนักอย่างน้อย 1 รายการ";
    }
    return null;
  };

  const buildRecordsFromDraft = (draft: QueuedTripDraft): TransportTransferRecord[] => {
    const nowDate = new Date();
    const startDateObj = draft.isDateTimeEdited
      ? new Date(`${draft.workingDate}T${draft.workingTime.length === 5 ? `${draft.workingTime}:00` : draft.workingTime}`)
      : nowDate;
    const validStartObj = isNaN(startDateObj.getTime()) ? nowDate : startDateObj;
    const startMs = validStartObj.getTime();
    const startTimeStr = getLocalTimeHmsStr(validStartObj);
    const createdStr = `${getLocalDateStr(validStartObj)} ${startTimeStr.slice(0, 5)}`;
    const safeTrips = Math.max(1, Math.min(50, Math.floor(draft.tripCount || 1)));
    const batchGroupId = safeTrips > 1 ? `GRP-${Date.now().toString().slice(-6)}` : undefined;
    const weightTon = Number((draft.totalWeightKg / 1000).toFixed(3));

    const records: TransportTransferRecord[] = [];
    for (let i = 0; i < safeTrips; i++) {
      const uniqueSuffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 90 + 10)}${i + 1}`;
      const recordId = `TRF-${validStartObj.getFullYear()}-${uniqueSuffix}`;
      records.push({
        id: recordId,
        transferCode: recordId,
        originFacility: draft.originFacility.trim(),
        destinationFacility: draft.destinationFacility.trim(),
        sku: "-",
        itemName: draft.itemName.trim(),
        productCategory: draft.transferType.trim() || "งาน Stock",
        transferType: draft.transferType.trim() || "งาน Stock",
        batchNumber: "-",
        palletId: "-",
        quantity: draft.totalBundles,
        unit: "มัด",
        weightTon,
        fullBundles: draft.fullBundles,
        weightPerBundleKg: draft.weightPerBundleKg,
        remainderWeightKg: draft.remainderWeightKg,
        totalBundles: draft.totalBundles,
        totalWeightKg: draft.totalWeightKg,
        startTime: startTimeStr,
        startTimeMs: startMs,
        tripIndex: safeTrips > 1 ? i + 1 : undefined,
        totalTrips: safeTrips > 1 ? safeTrips : undefined,
        batchGroupId,
        recorderName: getActiveRecorderDisplay(draft.driverName.trim()).label,
        workingDate: draft.workingDate,
        status: "In Transit",
        priority: "Normal",
        vehicleNumber: draft.vehicleNumber.trim() || "-",
        driverName: draft.driverName.trim(),
        workArea: draft.workArea.trim() || draft.originFacility.trim(),
        shift: draft.shift.trim() || MH_SHIFTS[0],
        team: draft.team.trim() || MH_TEAMS[0],
        transportCost: 0,
        notes: draft.notes.trim() || undefined,
        createdAt: createdStr,
        updatedAt: `${getLocalDateStr(nowDate)} ${getLocalTimeHmsStr(nowDate)}`,
      });
    }
    return records;
  };

  const makeCurrentDraft = (queueId: string): QueuedTripDraft => ({
    queueId,
    workingDate,
    workingTime,
    isDateTimeEdited,
    driverName: driverName.trim(),
    vehicleNumber: vehicleNumber.trim() || "-",
    workArea: workArea.trim() || originFacility.trim(),
    shift: shift.trim() || MH_SHIFTS[0],
    team: team.trim() || MH_TEAMS[0],
    itemName: itemName.trim(),
    transferType: transferType.trim() || "งาน Stock",
    originFacility: originFacility.trim(),
    destinationFacility: destinationFacility.trim(),
    fullBundles,
    weightPerBundleKg,
    remainderWeightKg,
    totalBundles,
    totalWeightKg,
    tripCount: Math.max(1, Math.min(50, Math.floor(tripCount || 1))),
    notes: notes.trim(),
  });

  const handleAddToQueue = () => {
    const err = validateCurrentForm();
    if (err) {
      setFeedbackBanner({ type: "error", text: err });
      return;
    }
    const newDraft = makeCurrentDraft(`Q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    setQueuedTrips((prev) => [...prev, newDraft]);
    setTripCount(1);
    setNotes("");
    setFeedbackBanner({
      type: "success",
      text: `เพิ่มรายการ "${newDraft.itemName}" (${newDraft.tripCount} รอบ) ลงในคิวเตรียมส่งแล้ว`,
    });
  };

  const handleRemoveFromQueue = (queueId: string) => {
    setQueuedTrips((prev) => prev.filter((q) => q.queueId !== queueId));
  };

  const handleConfirmDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const draftsToCreate: QueuedTripDraft[] = [];

    if (queuedTrips.length > 0) {
      draftsToCreate.push(...queuedTrips);
      const currentValid = validateCurrentForm() === null && totalWeightKg > 0;
      if (currentValid) {
        draftsToCreate.push(makeCurrentDraft("CURRENT"));
      }
    } else {
      const err = validateCurrentForm();
      if (err) {
        setFeedbackBanner({ type: "error", text: err });
        await showWarningAlert({
          title: "กรุณาตรวจสอบข้อมูล",
          text: err,
          confirmButtonText: "ตกลง",
        });
        return;
      }
      draftsToCreate.push(makeCurrentDraft("CURRENT"));
    }

    const allNewRecords = draftsToCreate.flatMap(buildRecordsFromDraft);
    if (allNewRecords.length === 0) return;

    const totalBatchWeightKg = allNewRecords.reduce(
      (sum, rec) => sum + (rec.totalWeightKg || 0),
      0
    );
    const totalBatchBundles = allNewRecords.reduce(
      (sum, rec) => sum + (rec.totalBundles || 0),
      0
    );
    const primary = allNewRecords[0];
    const summaryRowsHtml =
      draftsToCreate.length === 1
        ? `
          <div style="text-align:left; font-size:13px; line-height:1.65;">
            <div><strong>พนักงานขับรถ:</strong> ${escapeHtmlText(primary.driverName)}</div>
            <div><strong>สินค้า:</strong> ${escapeHtmlText(primary.itemName)} (${escapeHtmlText(primary.transferType || "งาน Stock")})</div>
            <div><strong>เส้นทาง:</strong> ${escapeHtmlText(primary.originFacility)} &rarr; ${escapeHtmlText(primary.destinationFacility)}</div>
            <div><strong>จำนวนรอบ:</strong> ${allNewRecords.length} รอบ · <strong>รวม:</strong> ${totalBatchBundles.toLocaleString()} มัด / ${totalBatchWeightKg.toLocaleString()} กก.</div>
          </div>
        `
        : `
          <div style="text-align:left; font-size:13px; line-height:1.65;">
            <div><strong>พนักงานขับรถ:</strong> ${escapeHtmlText(primary.driverName)}</div>
            <div><strong>รายการทั้งหมด:</strong> ${draftsToCreate.length} รายการ (${allNewRecords.length} รอบ)</div>
            <div><strong>น้ำหนักรวมทุกเที่ยว:</strong> ${totalBatchBundles.toLocaleString()} มัด / ${totalBatchWeightKg.toLocaleString()} กก.</div>
          </div>
        `;

    const confirmed = await showConfirmDialog({
      title: "ยืนยันการส่งงานย้ายสินค้า?",
      html: summaryRowsHtml,
      icon: "question",
      confirmButtonText: `ยืนยันการส่ง (${allNewRecords.length} รอบ)`,
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#059669",
    });

    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      setTransfers((prev) => [...allNewRecords, ...prev]);
      setQueuedTrips([]);
      setTripCount(1);
      setNotes("");
      if (!isDateTimeEdited) {
        const now = new Date();
        setWorkingDate(getLocalDateStr(now));
        setWorkingTime(getLocalTimeHmStr(now));
      }
      await saveMhTransfersBatchToCloud(allNewRecords);
      void appendWmsActivityLog({
        module: "Transport Operations",
        sectionId: "fleet_ops",
        reference: allNewRecords.map((r) => r.transferCode).slice(0, 3).join(", "),
        activity: `เริ่มส่งงาน ${allNewRecords[0]?.itemName || ""} (${allNewRecords.length} เที่ยว · พนักงานขับ ${allNewRecords[0]?.driverName || "-"})`,
        status: "In Transit",
      });
      setFeedbackBanner({
        type: "success",
        text: `เริ่มส่งงานสำเร็จ ${allNewRecords.length} รายการ (เริ่มนับเวลา SLA 20 นาทีแล้ว)`,
      });
      void showSuccessAlert({
        title: "เริ่มส่งงานสำเร็จ",
        text: `บันทึกงานย้ายสินค้า ${allNewRecords.length} รายการเรียบร้อยแล้ว (เริ่มนับเวลา SLA 20 นาที)`,
        timer: 2200,
      });
    } catch {
      setFeedbackBanner({
        type: "error",
        text: "เกิดข้อผิดพลาดในการบันทึกข้อมูลลงคลาวด์ กรุณาลองใหม่อีกครั้ง",
      });
      void showErrorAlert({
        title: "บันทึกข้อมูลไม่สำเร็จ",
        text: "เกิดข้อผิดพลาดในการบันทึกข้อมูลลงคลาวด์ กรุณาลองใหม่อีกครั้ง",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteTrip = async (record: TransportTransferRecord) => {
    const endDate = new Date();
    const endMs = endDate.getTime();
    const endTimeStr = getLocalTimeHmsStr(endDate);
    const startMs = parseRecordStartMs(record) || endMs;
    const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));
    const durationMin = Number((durationSec / 60).toFixed(2));
    const overdue = durationSec > SLA_LIMIT_SECONDS;

    const updated: TransportTransferRecord = {
      ...record,
      status: "Completed",
      endTime: endTimeStr,
      endTimeMs: endMs,
      durationSeconds: durationSec,
      durationMinutes: durationMin,
      isSlaOverdue: overdue,
      updatedAt: `${getLocalDateStr(endDate)} ${endTimeStr}`,
    };

    setTransfers((prev) => prev.map((item) => (item.id === record.id ? updated : item)));
    if (selectedRecord?.id === record.id) {
      setSelectedRecord(updated);
    }
    await saveMhTransferToCloud(updated);
    void appendWmsActivityLog({
      module: "Transport Operations",
      sectionId: "fleet_ops",
      reference: record.transferCode,
      activity: `จบงานขนย้าย ${record.itemName} (${formatDurationThai(durationSec)})`,
      status: overdue ? "Attention" : "Completed",
    });
    setFeedbackBanner({
      type: overdue ? "error" : "success",
      text: overdue
        ? `จบงาน ${record.transferCode} แล้ว — ใช้เวลา ${formatDurationThai(durationSec)} (เกินเวลา SLA 20 นาที)`
        : `จบงาน ${record.transferCode} เรียบร้อย (${formatDurationThai(durationSec)})`,
    });
  };

  const handleUpdateTransferStatus = async (
    record: TransportTransferRecord,
    nextStatus: MhTransferStatus
  ) => {
    if (nextStatus === "Completed") {
      await handleCompleteTrip(record);
      return;
    }
    const nowDate = new Date();
    const updated: TransportTransferRecord = {
      ...record,
      status: nextStatus,
      updatedAt: `${getLocalDateStr(nowDate)} ${getLocalTimeHmsStr(nowDate)}`,
    };
    setTransfers((prev) => prev.map((item) => (item.id === record.id ? updated : item)));
    if (selectedRecord?.id === record.id) {
      setSelectedRecord(updated);
    }
    await saveMhTransferToCloud(updated);
    void appendWmsActivityLog({
      module: "Transport Operations",
      sectionId: "fleet_ops",
      reference: record.transferCode,
      activity: `อัปเดตสถานะงานขนย้าย ${record.itemName} เป็น ${nextStatus}`,
      status: nextStatus,
    });
  };

  const handleDeleteTransfer = async (id: string) => {
    setTransfers((prev) => prev.filter((item) => item.id !== id));
    if (selectedRecord?.id === id) {
      setSelectedRecord(null);
    }
    setConfirmDeleteId(null);
    await deleteMhTransferFromCloud(id);
    void appendWmsActivityLog({
      module: "Transport Operations",
      sectionId: "fleet_ops",
      reference: id,
      activity: `ลบรายการขนย้าย ${id}`,
      status: "Completed",
    });
  };

  // Group Active Transfers by Driver (+ Vehicle / Team / Shift)
  const groupedActiveTransfers = useMemo(() => {
    const groups = new Map<string, TransportTransferRecord[]>();
    activeTransfers.forEach((tr) => {
      const vehicleTag = tr.vehicleNumber && tr.vehicleNumber !== "-" ? ` · ${tr.vehicleNumber}` : "";
      const key = `${tr.driverName || "ไม่ระบุพนักงาน"}${vehicleTag}`;
      const list = groups.get(key) || [];
      list.push(tr);
      groups.set(key, list);
    });
    return Array.from(groups.entries());
  }, [activeTransfers]);

  // Daily KPI metrics
  const todayDateStr = getLocalDateStr();
  const todayAssignedCount = dailyDuties.filter((d) => d.workingDate === todayDateStr).length;
  const activeOverdueCount = activeTransfers.filter((t) => isRecordOverdue(t, nowMs)).length;
  const completedToday = transfers.filter(
    (t) => t.status === "Completed" && t.workingDate === todayDateStr
  );
  const totalWeightTodayKg = transfers
    .filter((t) => t.workingDate === todayDateStr && t.status !== "Cancelled")
    .reduce((sum, t) => sum + getRecordWeightKg(t), 0);

  // Filtered History Table (Search + Status + Team + Shift)
  const filteredTransfers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transfers.filter((t) => {
      if (teamFilter !== "All" && (t.team || "") !== teamFilter) return false;
      if (shiftFilter !== "All" && (t.shift || "") !== shiftFilter) return false;

      const matchesSearch =
        !q ||
        t.id.toLowerCase().includes(q) ||
        t.transferCode.toLowerCase().includes(q) ||
        t.driverName.toLowerCase().includes(q) ||
        t.vehicleNumber.toLowerCase().includes(q) ||
        (t.team || "").toLowerCase().includes(q) ||
        (t.shift || "").toLowerCase().includes(q) ||
        (t.workArea || "").toLowerCase().includes(q) ||
        t.itemName.toLowerCase().includes(q) ||
        (t.transferType || t.productCategory || "").toLowerCase().includes(q) ||
        t.originFacility.toLowerCase().includes(q) ||
        t.destinationFacility.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (statusFilter === "All") return true;
      if (statusFilter === "Overdue") return isRecordOverdue(t, nowMs);
      if (statusFilter === "In Transit") {
        return t.status === "In Transit" || t.status === "Pending";
      }
      return t.status === statusFilter;
    });
  }, [transfers, searchQuery, statusFilter, teamFilter, shiftFilter, nowMs]);

  const inProgressTransfers = useMemo(
    () => filteredTransfers.filter((t) => t.status === "In Transit" || t.status === "Pending"),
    [filteredTransfers]
  );

  const completedTransfers = useMemo(
    () => filteredTransfers.filter((t) => t.status === "Completed"),
    [filteredTransfers]
  );

  const cancelledTransfers = useMemo(
    () => filteredTransfers.filter((t) => t.status === "Cancelled"),
    [filteredTransfers]
  );

  const inProgressTotalWeightKg = useMemo(
    () => inProgressTransfers.reduce((sum, t) => sum + getRecordWeightKg(t), 0),
    [inProgressTransfers]
  );

  const completedTotalWeightKg = useMemo(
    () => completedTransfers.reduce((sum, t) => sum + getRecordWeightKg(t), 0),
    [completedTransfers]
  );

  const cancelledTotalWeightKg = useMemo(
    () => cancelledTransfers.reduce((sum, t) => sum + getRecordWeightKg(t), 0),
    [cancelledTransfers]
  );

  const toggleStatusGroup = (groupKey: "inProgress" | "completed" | "cancelled") => {
    setExpandedStatusGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const totalQueuedRounds = queuedTrips.reduce((sum, q) => sum + q.tripCount, 0);
  const totalQueuedKg = queuedTrips.reduce((sum, q) => sum + q.totalWeightKg * q.tripCount, 0);
  const effectiveBatchCount =
    queuedTrips.length > 0
      ? totalQueuedRounds + (validateCurrentForm() === null && totalWeightKg > 0 ? tripCount : 0)
      : tripCount;

  const headingPortalTarget =
    typeof document !== "undefined" ? document.getElementById("page-heading-actions") : null;

  const cloudControlButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setForkliftCloudRealtimeEnabled(!cloudRealtime)}
        className={`hidden sm:inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-bold transition ${
          cloudRealtime
            ? "border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-600 dark:bg-[#162544] dark:text-emerald-300 dark:hover:bg-[#1d3158]"
            : "border-slate-400 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-[#162544] dark:text-slate-300 dark:hover:bg-[#1d3158]"
        }`}
        title="สลับโหมด Cloud Real-time เพื่อประหยัดโควต้าการอ่านข้อมูล"
      >
        {cloudRealtime ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span>{cloudRealtime ? "Cloud Real-time: ON" : "Cloud Real-time: OFF (ประหยัดโควต้า)"}</span>
      </button>
      {!cloudRealtime && (
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
          onClick={handleManualReload}
          disabled={isRefreshing}
        >
          <RefreshCw size={12} />
          <span>{isRefreshing ? "กำลังโหลด..." : "ดึงข้อมูลล่าสุด"}</span>
        </button>
      )}
    </div>
  );

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    statusFilter !== "All" ||
    teamFilter !== "All" ||
    shiftFilter !== "All";

  return (
    <div className="space-y-2.5 overflow-x-hidden sm:space-y-5">
      {headingPortalTarget ? createPortal(cloudControlButtons, headingPortalTarget) : null}

      {!headingPortalTarget && (
        <div className={cloudRealtime ? "hidden justify-end sm:flex" : "flex justify-end"}>
          {cloudControlButtons}
        </div>
      )}

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-xs font-semibold sm:px-4 ${
            feedbackBanner.type === "error"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {feedbackBanner.type === "error" ? (
              <AlertTriangle size={16} className="shrink-0" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0" />
            )}
            <span className="break-words">{feedbackBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* KPI Summary Strip (Compact Single-Line 2x2 Mobile / 4-Column Desktop) */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-4 dark:border-[#1e3a5f] dark:bg-[#111e38] [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b lg:[&>*:not(:last-child)]:border-r lg:[&>*]:border-b-0 [&>*]:border-slate-200 dark:[&>*]:border-[#1e3a5f]">
        <div className="flex min-w-0 items-center justify-between gap-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5">
          <span className="truncate text-xs font-semibold whitespace-nowrap text-slate-500 dark:text-slate-400">
            กำลังส่ง
          </span>
          <span className="shrink-0 font-mono text-xs font-extrabold text-sky-700 tabular-nums whitespace-nowrap sm:text-base dark:text-sky-400">
            {activeTransfers.length} <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">งาน</span>
          </span>
        </div>

        <div
          className={`flex min-w-0 items-center justify-between gap-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5 ${
            activeOverdueCount > 0 ? "bg-red-50/70 dark:bg-red-950/30" : ""
          }`}
        >
          <span
            className={`truncate text-xs font-semibold whitespace-nowrap ${
              activeOverdueCount > 0
                ? "text-red-700 dark:text-red-300"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            เกิน SLA
          </span>
          <span
            className={`shrink-0 font-mono text-xs font-extrabold tabular-nums whitespace-nowrap sm:text-base ${
              activeOverdueCount > 0
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {activeOverdueCount}{" "}
            <span className="text-[11px] font-semibold">
              {activeOverdueCount > 0 ? "เร่ง" : "ปกติ"}
            </span>
          </span>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5">
          <span className="truncate text-xs font-semibold whitespace-nowrap text-slate-500 dark:text-slate-400">
            จบวันนี้
          </span>
          <span className="shrink-0 font-mono text-xs font-extrabold text-emerald-700 tabular-nums whitespace-nowrap sm:text-base dark:text-emerald-400">
            {completedToday.length}{" "}
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">รอบ</span>
          </span>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5">
          <span className="truncate text-xs font-semibold whitespace-nowrap text-slate-500 dark:text-slate-400">
            น้ำหนักวันนี้
          </span>
          <span className="shrink-0 font-mono text-xs font-extrabold text-slate-900 tabular-nums whitespace-nowrap sm:text-base dark:text-white">
            {totalWeightTodayKg.toLocaleString()} กก.
            <span className="hidden text-[11px] font-semibold text-slate-500 sm:inline dark:text-slate-400">
              {" "}({(totalWeightTodayKg / 1000).toFixed(2)} ตัน)
            </span>
          </span>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 1. QUICK TRANSFER ENTRY WORKBENCH                                     */}
      {/* ===================================================================== */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-2.5 py-2 sm:px-5 sm:py-3 dark:border-[#1e3a5f]">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-600 text-white sm:h-8 sm:w-8">
              <Truck size={14} />
            </div>
            <h2 className="truncate text-xs font-bold whitespace-nowrap text-slate-900 sm:text-sm dark:text-white">
              บันทึกการย้ายงานด่วน
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setIsQuickFormExpanded((v) => !v)}
            className={`inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold whitespace-nowrap transition sm:h-9 sm:px-3.5 ${
              isQuickFormExpanded
                ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
                : "bg-cyan-600 text-white shadow-xs hover:bg-cyan-700"
            }`}
          >
            {isQuickFormExpanded ? <X size={13} /> : null}
            <span>{isQuickFormExpanded ? "ปิดฟอร์ม" : "+ บันทึกงานย้ายสินค้า"}</span>
          </button>
        </div>

        {isQuickFormExpanded && (
          <form onSubmit={handleConfirmDispatch} className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
            {/* (1) Operator + Single-Line Auto-Filled Summary Strip */}
            <div className="space-y-2 p-2.5 sm:space-y-2.5 sm:p-4">
              <div className="min-w-0">
                <label className="mb-1 flex items-center gap-1 truncate text-xs font-bold whitespace-nowrap text-slate-700 dark:text-slate-200">
                  <User size={13} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
                  <span className="truncate">1. พนักงานขับรถ</span>
                </label>
                <div className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-100/80 px-2.5 py-1 text-xs font-bold text-slate-900 sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100">
                  <div className="flex min-w-0 items-center gap-2">
                    {currentUser?.employeeId && (
                      <span className="shrink-0 font-mono text-[11px] font-bold text-sky-700 dark:text-sky-400">
                        {currentUser.employeeId}
                      </span>
                    )}
                    <span className="truncate">
                      {driverName || "ไม่พบผู้ใช้งานที่ล็อกอิน"}
                    </span>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={12} />
                    <span>ตามผู้ล็อกอิน</span>
                  </span>
                </div>
              </div>

              {/* Single-Line Auto-Filled Summary + "แก้ไข" Button */}
              <div
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] sm:px-3 sm:text-xs ${
                  matchedDailyDuty
                    ? "border-indigo-200/80 bg-indigo-50/70 text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-100"
                    : "border-slate-200 bg-slate-50 text-slate-700 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-200"
                }`}
              >
                <div className="min-w-0 truncate font-semibold whitespace-nowrap">
                  <span>รถ {vehicleNumber || "-"}</span>
                  <span className="mx-1 opacity-50">·</span>
                  <span>{team}</span>
                  <span className="mx-1 opacity-50">·</span>
                  <span>{shift}</span>
                  <span className="mx-1 opacity-50">·</span>
                  <span className="text-emerald-700 dark:text-emerald-300">{workArea}</span>
                  <span className="mx-1 opacity-50">·</span>
                  <span className="font-mono tabular-nums">{workingTime} น.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setManualDutyOverride((v) => !v)}
                  className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-slate-700 hover:border-cyan-500 hover:text-cyan-700 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                >
                  {manualDutyOverride ? "ซ่อน" : "แก้ไข"}
                </button>
              </div>

              {/* Hidden Auto-Filled Controls (Shown only when user clicks "แก้ไข") */}
              {manualDutyOverride && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 sm:p-3 dark:border-[#1e3a5f] dark:bg-[#0d1930]/80">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label
                        htmlFor="mh-vehicle-select"
                        className="mb-1 block truncate text-[11px] font-bold whitespace-nowrap text-slate-600 dark:text-slate-300"
                      >
                        รถโฟล์คลิฟท์
                      </label>
                      <select
                        id="mh-vehicle-select"
                        value={vehicleNumber}
                        onChange={(e) => setVehicleNumber(e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                      >
                        <option value="">-- ทั่วไป --</option>
                        {vehicleNumber && !vehicles.some((v) => v.vehicleId === vehicleNumber) && (
                          <option value={vehicleNumber}>{vehicleNumber}</option>
                        )}
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.vehicleId}>
                            {v.vehicleId} ({v.vehicleType})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="min-w-0">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="truncate text-[11px] font-bold whitespace-nowrap text-slate-600 dark:text-slate-300">
                          วัน-เวลาเริ่มงาน
                        </label>
                        <button
                          type="button"
                          onClick={handleResetToCurrentTime}
                          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold whitespace-nowrap text-cyan-700 hover:underline dark:text-cyan-400"
                        >
                          <RotateCcw size={11} />
                          <span>เวลาปัจจุบัน</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={workingDate}
                          onChange={(e) => {
                            setWorkingDate(e.target.value);
                            setIsDateTimeEdited(true);
                          }}
                          className="h-8 min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                          required
                        />
                        <input
                          type="time"
                          value={workingTime}
                          onChange={(e) => {
                            setWorkingTime(e.target.value);
                            setIsDateTimeEdited(true);
                          }}
                          className="h-8 min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="min-w-0">
                      <label
                        htmlFor="mh-team-select"
                        className="mb-1 block truncate text-[11px] font-bold whitespace-nowrap text-slate-600 dark:text-slate-300"
                      >
                        ทีม
                      </label>
                      <select
                        id="mh-team-select"
                        value={team}
                        onChange={(e) => setTeam(e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                      >
                        {team && !(MH_TEAMS as readonly string[]).includes(team) && (
                          <option value={team}>{team}</option>
                        )}
                        {MH_TEAMS.map((tOpt) => (
                          <option key={`form-team-${tOpt}`} value={tOpt}>
                            {tOpt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="mh-shift-select"
                        className="mb-1 block truncate text-[11px] font-bold whitespace-nowrap text-slate-600 dark:text-slate-300"
                      >
                        กะทำงาน
                      </label>
                      <select
                        id="mh-shift-select"
                        value={shift}
                        onChange={(e) => setShift(e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-indigo-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                      >
                        {shift && !(MH_SHIFTS as readonly string[]).includes(shift) && (
                          <option value={shift}>{shift}</option>
                        )}
                        {MH_SHIFTS.map((sOpt) => (
                          <option key={`form-shift-${sOpt}`} value={sOpt}>
                            {sOpt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="mh-workarea-select"
                        className="mb-1 flex items-center gap-1 truncate text-[11px] font-bold whitespace-nowrap text-slate-600 dark:text-slate-300"
                      >
                        <MapPin size={11} className="shrink-0" />
                        <span className="truncate">พื้นที่หลัก</span>
                      </label>
                      <select
                        id="mh-workarea-select"
                        value={workArea}
                        onChange={(e) => {
                          setWorkArea(e.target.value);
                          setOriginFacility(e.target.value);
                        }}
                        className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-emerald-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                      >
                        {workArea && !(MH_WORK_AREAS as readonly string[]).includes(workArea) && (
                          <option value={workArea}>{workArea}</option>
                        )}
                        {MH_WORK_AREAS.map((area) => (
                          <option key={`form-area-${area}`} value={area}>
                            {area}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* (2) Product & Transfer Type (Paired) + (3) Origin -> Destination */}
            <div className="space-y-2.5 p-2.5 sm:space-y-3 sm:p-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="min-w-0">
                  <label
                    htmlFor="mh-product-select"
                    className="mb-1 flex items-center gap-1 truncate text-xs font-bold whitespace-nowrap text-slate-700 dark:text-slate-200"
                  >
                    <Package size={12} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
                    <span className="truncate">2. สินค้า *</span>
                  </label>
                  <select
                    id="mh-product-select"
                    value={QUICK_PRODUCTS.includes(itemName) ? itemName : "__CUSTOM__"}
                    onChange={(e) => {
                      if (e.target.value === "__CUSTOM__") {
                        if (QUICK_PRODUCTS.includes(itemName)) setItemName("");
                      } else {
                        setItemName(e.target.value);
                      }
                    }}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  >
                    {QUICK_PRODUCTS.map((prod) => (
                      <option key={prod} value={prod}>
                        {prod}
                      </option>
                    ))}
                    <option value="__CUSTOM__">อื่นๆ (พิมพ์เอง)...</option>
                  </select>
                  {!QUICK_PRODUCTS.includes(itemName) && (
                    <input
                      type="text"
                      placeholder="ระบุชื่อสินค้า..."
                      value={itemName}
                      onChange={(e) => setItemName(e.target.value)}
                      className="mt-1.5 h-8 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none sm:h-9 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                    />
                  )}
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="mh-transfer-type-select"
                    className="mb-1 flex items-center gap-1 truncate text-xs font-bold whitespace-nowrap text-slate-700 dark:text-slate-200"
                  >
                    <Layers size={12} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span className="truncate">ประเภทการย้าย *</span>
                  </label>
                  <select
                    id="mh-transfer-type-select"
                    value={transferType}
                    onChange={(e) => setTransferType(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  >
                    {transferType && !QUICK_TRANSFER_TYPES.includes(transferType) && (
                      <option value={transferType}>{transferType}</option>
                    )}
                    {QUICK_TRANSFER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* (3) Origin -> [Swap] -> Destination */}
              {(() => {
                const isPresetOrigin = facilityOptions.includes(originFacility);
                const isPresetDest = facilityOptions.includes(destinationFacility);
                return (
                  <div className="grid grid-cols-12 items-start gap-1.5 border-t border-slate-100 pt-2.5 sm:gap-3 dark:border-[#1e3a5f]">
                    <div className="col-span-5 min-w-0">
                      <label
                        htmlFor="mh-origin-select"
                        className="mb-1 block truncate text-xs font-bold whitespace-nowrap text-sky-700 dark:text-sky-300"
                      >
                        3. ต้นทาง *
                      </label>
                      <select
                        id="mh-origin-select"
                        value={isPresetOrigin ? originFacility : "__CUSTOM__"}
                        onChange={(e) => {
                          if (e.target.value === "__CUSTOM__") {
                            if (isPresetOrigin) setOriginFacility("");
                          } else {
                            setOriginFacility(e.target.value);
                          }
                        }}
                        className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-sky-600 focus:bg-white focus:outline-none sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                      >
                        {facilityOptions.map((b) => (
                          <option key={`orig-${b}`} value={b}>
                            {b}
                          </option>
                        ))}
                        <option value="__CUSTOM__">อื่นๆ (พิมพ์เอง)...</option>
                      </select>
                      {!isPresetOrigin && (
                        <input
                          type="text"
                          placeholder="พิมพ์ต้นทาง..."
                          value={originFacility}
                          onChange={(e) => setOriginFacility(e.target.value)}
                          className="mt-1.5 h-8 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-sky-600 focus:bg-white focus:outline-none sm:h-9 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                        />
                      )}
                    </div>

                    <div className="col-span-2 min-w-0 pt-[20px]">
                      <button
                        type="button"
                        onClick={handleSwapFacilities}
                        className="flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold whitespace-nowrap text-slate-700 transition hover:border-cyan-500 hover:bg-white hover:text-cyan-700 sm:h-10 sm:px-2.5 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
                        title="สลับต้นทางและปลายทาง"
                      >
                        <ArrowLeftRight size={13} className="shrink-0" />
                        <span className="hidden sm:inline">สลับ</span>
                      </button>
                    </div>

                    <div className="col-span-5 min-w-0">
                      <label
                        htmlFor="mh-dest-select"
                        className="mb-1 block truncate text-xs font-bold whitespace-nowrap text-emerald-700 dark:text-emerald-300"
                      >
                        ปลายทาง *
                      </label>
                      <select
                        id="mh-dest-select"
                        value={isPresetDest ? destinationFacility : "__CUSTOM__"}
                        onChange={(e) => {
                          if (e.target.value === "__CUSTOM__") {
                            if (isPresetDest) setDestinationFacility("");
                          } else {
                            setDestinationFacility(e.target.value);
                          }
                        }}
                        className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                      >
                        {facilityOptions.map((b) => (
                          <option key={`dest-${b}`} value={b}>
                            {b}
                          </option>
                        ))}
                        <option value="__CUSTOM__">อื่นๆ (พิมพ์เอง)...</option>
                      </select>
                      {!isPresetDest && (
                        <input
                          type="text"
                          placeholder="พิมพ์ปลายทาง..."
                          value={destinationFacility}
                          onChange={(e) => setDestinationFacility(e.target.value)}
                          className="mt-1.5 h-8 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none sm:h-9 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                        />
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* (4) Weight (Full Bundles, Kg/Bundle, Remainder + Single-Line Summary) */}
            <div className="space-y-2 bg-slate-50/60 p-2.5 sm:space-y-2.5 sm:p-4 dark:bg-[#0d1930]/70">
              <div className="flex items-center gap-1.5 truncate text-xs font-bold whitespace-nowrap text-slate-700 dark:text-slate-200">
                <Scale size={13} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
                <span className="truncate">4. น้ำหนัก</span>
              </div>

              <div className="grid grid-cols-1 items-end gap-2 sm:gap-3 lg:grid-cols-12">
                <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:col-span-7">
                  <div className="min-w-0">
                    <label className="mb-1 block truncate text-[11px] font-bold whitespace-nowrap text-slate-600 sm:text-xs dark:text-slate-300">
                      มัดเต็ม
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={fullBundlesInput}
                      onChange={(e) => setFullBundlesInput(e.target.value)}
                      className="h-9 min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-600 focus:outline-none sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1 block truncate text-[11px] font-bold whitespace-nowrap text-slate-600 sm:text-xs dark:text-slate-300">
                      กก./มัด
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={weightPerBundleInput}
                      onChange={(e) => setWeightPerBundleInput(e.target.value)}
                      className="h-9 min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-600 focus:outline-none sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1 block truncate text-[11px] font-bold whitespace-nowrap text-slate-600 sm:text-xs dark:text-slate-300">
                      เศษ (กก.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={remainderWeightInput}
                      onChange={(e) => setRemainderWeightInput(e.target.value)}
                      className="h-9 min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-600 focus:outline-none sm:h-10 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* Single-Line Live Weight Summary */}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 sm:px-3 sm:py-2 lg:col-span-5 dark:border-[#1e3a5f] dark:bg-[#111e38]">
                  <span className="truncate font-mono text-xs font-bold text-cyan-700 tabular-nums whitespace-nowrap dark:text-cyan-300">
                    รวม {totalBundles} มัด
                    {hasRemainderBundle ? " (+เศษ)" : ""}
                  </span>
                  <span className="shrink-0 font-mono text-xs font-extrabold text-slate-900 tabular-nums whitespace-nowrap sm:text-sm dark:text-white">
                    {totalWeightKg.toLocaleString()} กก.{" "}
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      ({totalWeightTon} ตัน)
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* (5) Trip Count, Optional "+ เพิ่มหมายเหตุ" Toggle & Large Clear Confirm Button */}
            <div className="space-y-2.5 p-2.5 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mh-trip-count-select"
                    className="shrink-0 text-xs font-bold whitespace-nowrap text-slate-700 dark:text-slate-200"
                  >
                    5. จำนวนรอบ
                  </label>
                  <select
                    id="mh-trip-count-select"
                    value={tripCount}
                    onChange={(e) => setTripCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className="h-9 w-28 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-600 focus:bg-white focus:outline-none sm:h-10 sm:w-32 sm:px-3 sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  >
                    {Array.from({ length: 50 }, (_, idx) => idx + 1).map((cnt) => (
                      <option key={cnt} value={cnt}>
                        {cnt} รอบ
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setShowOptionalFields((v) => !v)}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-slate-600 transition hover:border-cyan-500 hover:text-cyan-700 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-300"
                >
                  <span>{showOptionalFields ? "ซ่อนหมายเหตุ" : "+ เพิ่มหมายเหตุ"}</span>
                </button>
              </div>

              {/* Hidden Optional Controls: Notes & Add to Queue */}
              {showOptionalFields && (
                <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 sm:flex-row sm:items-center sm:p-2.5 dark:border-[#1e3a5f] dark:bg-[#0d1930]/80">
                  <input
                    id="mh-notes-input"
                    type="text"
                    placeholder="หมายเหตุ (ถ้ามี)..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddToQueue}
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold whitespace-nowrap text-slate-800 transition hover:border-cyan-500 hover:text-cyan-700 sm:h-9 sm:px-3 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-100 dark:hover:bg-[#1d3158]"
                  >
                    <Plus size={13} className="shrink-0" />
                    <span>เพิ่มลงคิว</span>
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-extrabold whitespace-nowrap text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <Send size={15} className="shrink-0" />
                <span>
                  {isSubmitting
                    ? "กำลังบันทึก..."
                    : queuedTrips.length > 0
                    ? `ยืนยันการส่ง (${effectiveBatchCount} รอบ)`
                    : `ยืนยันการส่ง (${tripCount} รอบ)`}
                </span>
              </button>
            </div>

            {/* Staged Multi-Item Queue List */}
            {queuedTrips.length > 0 && (
              <div className="bg-amber-50/60 px-2.5 py-2.5 sm:px-4 sm:py-3 dark:bg-amber-950/20">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="truncate text-xs font-bold text-amber-900 tabular-nums whitespace-nowrap dark:text-amber-200">
                    คิวเตรียมส่ง ({queuedTrips.length} รายการ · {totalQueuedRounds} รอบ ·{" "}
                    {totalQueuedKg.toLocaleString()} กก.)
                  </div>
                  <button
                    type="button"
                    onClick={() => setQueuedTrips([])}
                    className="shrink-0 text-xs font-semibold whitespace-nowrap text-red-700 hover:underline dark:text-red-400"
                  >
                    ล้างคิว
                  </button>
                </div>
                <div className="divide-y divide-amber-200/80 rounded-lg border border-amber-200 bg-white dark:divide-amber-900/50 dark:border-amber-900/60 dark:bg-[#111e38]">
                  {queuedTrips.map((q, idx) => (
                    <div
                      key={q.queueId}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs sm:px-3 sm:py-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="font-mono font-bold text-amber-800 tabular-nums dark:text-amber-300">
                          #{idx + 1} ({q.tripCount} รอบ)
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {q.driverName}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {q.team} · {q.shift} · {q.workArea}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {q.itemName} ({q.transferType})
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-semibold text-sky-700 dark:text-sky-300">
                          {q.originFacility} ➔ {q.destinationFacility}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-mono font-bold text-slate-800 tabular-nums dark:text-slate-200">
                          {q.totalBundles} มัด / {q.totalWeightKg.toLocaleString()} กก.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromQueue(q.queueId)}
                        className="shrink-0 rounded-md p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        title="ลบออกจากคิว"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}
      </section>

      {/* ===================================================================== */}
      {/* 3. HISTORY & LOG TABLE (With Team & Shift Filters)                    */}
      {/* ===================================================================== */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-2.5 py-2 sm:px-5 sm:py-3 dark:border-[#1e3a5f]">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="truncate text-xs font-bold whitespace-nowrap text-slate-900 sm:text-sm dark:text-white">
              รายการขนย้ายทั้งหมด
            </h2>
            <span className="shrink-0 font-mono text-xs font-semibold text-slate-500 tabular-nums whitespace-nowrap dark:text-slate-400">
              ({filteredTransfers.length}/{transfers.length})
            </span>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setTeamFilter("All");
                setShiftFilter("All");
                setStatusFilter("All");
              }}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-semibold whitespace-nowrap text-cyan-700 hover:underline dark:text-cyan-400"
            >
              <RotateCcw size={12} />
              <span>ล้างตัวกรอง</span>
            </button>
          )}
        </div>

        {/* Filter Toolbar: Search + Segmented Team Filter + Shift + Status */}
        <div className="flex flex-col gap-1.5 border-b border-slate-200 bg-slate-50/60 px-2.5 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-2.5 dark:border-[#1e3a5f] dark:bg-[#0d1930]">
          <div className="relative min-w-0 w-full sm:min-w-[240px] sm:flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="ค้นหารหัส, พนักงาน, รถ, สินค้า..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-lg border border-slate-300 bg-white py-1 pr-2.5 pl-8 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none sm:h-9 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
            />
          </div>

          <div className="hidden sm:flex sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
            {/* Segmented Team Filter */}
            <div className="inline-flex w-auto items-center gap-0.5 rounded-lg bg-slate-200/70 p-0.5 dark:bg-[#0c162c]">
              <button
                type="button"
                onClick={() => setTeamFilter("All")}
                className={`h-8 rounded-md px-2.5 py-1 text-xs font-bold whitespace-nowrap transition ${
                  teamFilter === "All"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-[#162544] dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                ทุกทีม
              </button>
              {MH_TEAMS.map((tOpt) => (
                <button
                  key={`filter-team-${tOpt}`}
                  type="button"
                  onClick={() => setTeamFilter(tOpt)}
                  className={`h-8 rounded-md px-2.5 py-1 text-xs font-bold whitespace-nowrap transition ${
                    teamFilter === tOpt
                      ? "bg-white text-slate-900 shadow-xs dark:bg-[#162544] dark:text-white"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  {tOpt}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                aria-label="กรองตามกะทำงาน"
                className="h-9 w-auto rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
              >
                <option value="All">ทุกกะทำงาน</option>
                {MH_SHIFTS.map((sOpt) => (
                  <option key={`filter-shift-${sOpt}`} value={sOpt}>
                    {sOpt}
                  </option>
                ))}
              </select>

              <div className="flex min-w-0 items-center gap-1.5">
                <Filter size={13} className="shrink-0 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="กรองตามสถานะ"
                  className="h-9 w-auto rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                >
                  <option value="All">ทุกสถานะ</option>
                  <option value="In Transit">อยู่ระหว่างการส่ง</option>
                  <option value="Completed">จบงานแล้ว</option>
                  <option value="Overdue">เกิน SLA (&gt; 20 นาที)</option>
                  <option value="Cancelled">ยกเลิก</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Grouped Status Accordions: (1) อยู่ระหว่างการส่ง, (2) ส่งสินค้าสำเร็จ */}
        <div className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
          {(
            [
              {
                key: "inProgress" as const,
                title: "อยู่ระหว่างการส่ง",
                items: inProgressTransfers,
                totalWeightKg: inProgressTotalWeightKg,
                overdueCount: inProgressTransfers.filter((t) => isRecordOverdue(t, nowMs)).length,
                accent: "sky" as const,
              },
              {
                key: "completed" as const,
                title: "ส่งสินค้าสำเร็จ",
                items: completedTransfers,
                totalWeightKg: completedTotalWeightKg,
                overdueCount: 0,
                accent: "emerald" as const,
              },
              ...(statusFilter === "Cancelled" && cancelledTransfers.length > 0
                ? [
                    {
                      key: "cancelled" as const,
                      title: "รายการที่ยกเลิก",
                      items: cancelledTransfers,
                      totalWeightKg: cancelledTotalWeightKg,
                      overdueCount: 0,
                      accent: "slate" as const,
                    },
                  ]
                : []),
            ]
          ).map((group) => {
            const isExpanded = expandedStatusGroups[group.key];
            const accentTitleClass =
              group.accent === "sky"
                ? "text-sky-700 dark:text-sky-300"
                : group.accent === "emerald"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-slate-700 dark:text-slate-300";
            const accentIconBgClass =
              group.accent === "sky"
                ? "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800"
                : group.accent === "emerald"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                : "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";

            return (
              <div key={group.key}>
                {/* Collapsible Group Header (Single-Line Summary) */}
                <button
                  type="button"
                  onClick={() => toggleStatusGroup(group.key)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center justify-between gap-2 bg-slate-50/40 px-2.5 py-2 text-left transition hover:bg-slate-100/70 sm:px-5 sm:py-3 dark:bg-[#0e1a33]/60 dark:hover:bg-[#162544]/70"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${accentIconBgClass}`}
                    >
                      {group.accent === "sky" ? (
                        <Clock size={12} />
                      ) : group.accent === "emerald" ? (
                        <CheckCircle2 size={12} />
                      ) : (
                        <X size={12} />
                      )}
                    </span>
                    <span className={`truncate text-xs font-extrabold whitespace-nowrap sm:text-sm ${accentTitleClass}`}>
                      {group.title}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-300">
                      ({group.items.length.toLocaleString()})
                    </span>
                    {group.overdueCount > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-extrabold whitespace-nowrap text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
                        <AlertTriangle size={10} />
                        <span>{group.overdueCount}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
                    <span className="font-mono text-xs font-extrabold text-slate-900 tabular-nums whitespace-nowrap dark:text-white">
                      {group.totalWeightKg.toLocaleString()} กก.
                      <span className="hidden font-semibold text-slate-500 sm:inline dark:text-slate-400">
                        {" "}({(group.totalWeightKg / 1000).toFixed(2)} ตัน)
                      </span>
                    </span>

                    <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-slate-600 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-300">
                      {isExpanded ? (
                        <>
                          <ChevronUp size={12} />
                          <span>ย่อ</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown size={12} />
                          <span>แสดง</span>
                        </>
                      )}
                    </span>
                  </div>
                </button>

                {/* Group Table (Rendered only when expanded) */}
                {isExpanded && (
                  <div className="overflow-x-auto border-t border-slate-200 dark:border-[#1e3a5f]">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-600 dark:border-[#1e3a5f] dark:bg-[#0c162c] dark:text-slate-300">
                          <th className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">วันที่</th>
                          <th className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">พนักงาน</th>
                          <th className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">สินค้า &amp; ประเภท</th>
                          <th className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">เส้นทาง</th>
                          <th className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">ปริมาณ / น้ำหนัก</th>
                          <th className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">เวลาที่ใช้ส่ง</th>
                          <th className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">สถานะ</th>
                          <th className="px-3 py-2 text-right whitespace-nowrap sm:px-4 sm:py-2.5">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                        {group.items.length === 0 ? (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-5 py-8 text-center text-xs whitespace-nowrap text-slate-500 dark:text-slate-400"
                            >
                              ไม่มีรายการในกลุ่ม &quot;{group.title}&quot;
                            </td>
                          </tr>
                        ) : (
                          group.items.map((tr) => {
                            const durationSec = getRecordDurationSeconds(tr, nowMs);
                            const overdue = isRecordOverdue(tr, nowMs);
                            const durationMins = Math.floor(durationSec / 60);
                            const weightKg = getRecordWeightKg(tr);
                            const bundles = tr.totalBundles ?? tr.quantity ?? 0;
                            const statusInfo = getStatusBadgeInfo(tr.status);
                            const isActiveRow = tr.status === "In Transit" || tr.status === "Pending";

                            return (
                              <tr
                                key={tr.id}
                                className={`transition hover:bg-slate-50/80 dark:hover:bg-[#162544]/60 ${
                                  overdue ? "bg-red-50/35 dark:bg-red-950/15" : ""
                                }`}
                              >
                                {/* 1. Date (Single Line) */}
                                <td className="px-3 py-2 font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap sm:px-4 sm:py-2.5 dark:text-slate-100">
                                  {tr.workingDate}
                                </td>

                                {/* 2. Operator (Single Line) */}
                                <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap sm:px-4 sm:py-2.5 dark:text-white">
                                  {tr.driverName}
                                </td>

                                {/* 3. Item & Transfer Type (Single Line) */}
                                <td className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">
                                  <span className="font-bold text-slate-900 dark:text-white">
                                    {tr.itemName}
                                  </span>
                                  <span className="mx-1.5 text-slate-400">·</span>
                                  <span className="text-slate-600 dark:text-slate-300">
                                    {tr.transferType || tr.productCategory}
                                  </span>
                                </td>

                                {/* 4. Route (Single Line) */}
                                <td className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">
                                  <div className="inline-flex items-center gap-1.5 font-bold whitespace-nowrap">
                                    <span className="text-sky-700 dark:text-sky-300">
                                      {tr.originFacility}
                                    </span>
                                    <ArrowRight size={12} className="shrink-0 text-slate-400" />
                                    <span className="text-emerald-700 dark:text-emerald-300">
                                      {tr.destinationFacility}
                                    </span>
                                  </div>
                                </td>

                                {/* 5. Quantity / Weight (Single Line) */}
                                <td className="px-3 py-2 font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap sm:px-4 sm:py-2.5 dark:text-white">
                                  {bundles} มัด · {weightKg.toLocaleString()} กก.
                                </td>

                                {/* 6. Duration / SLA (Single Line) */}
                                <td className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">
                                  {tr.status === "Cancelled" ? (
                                    <span className="text-slate-400">—</span>
                                  ) : (
                                    <span
                                      title={overdue ? `เกิน SLA (${durationMins} นาที)` : undefined}
                                      className={`inline-flex items-center gap-1 font-mono text-xs font-extrabold tabular-nums whitespace-nowrap ${
                                        overdue
                                          ? "text-red-600 dark:text-red-400"
                                          : "text-emerald-700 dark:text-emerald-400"
                                      }`}
                                    >
                                      {overdue && <AlertTriangle size={12} className="shrink-0" />}
                                      <span>
                                        {isActiveRow
                                          ? `${formatDurationClock(durationSec)} (กำลังส่ง)`
                                          : formatDurationThai(durationSec)}
                                      </span>
                                    </span>
                                  )}
                                </td>

                                {/* 7. Status (Single Line) */}
                                <td className="px-3 py-2 whitespace-nowrap sm:px-4 sm:py-2.5">
                                  <span
                                    className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${statusInfo.classes}`}
                                  >
                                    {statusInfo.label}
                                  </span>
                                </td>

                                {/* 8. Actions (Single Line) */}
                                <td className="px-3 py-2 text-right whitespace-nowrap sm:px-4 sm:py-2.5">
                                  <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                                    {isActiveRow && (
                                      <button
                                        type="button"
                                        onClick={() => handleCompleteTrip(tr)}
                                        className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white transition hover:bg-emerald-700"
                                      >
                                        <CheckCircle2 size={12} />
                                        <span>ยืนยันจบงาน</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedRecord(tr);
                                        setConfirmDeleteId(null);
                                      }}
                                      className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-slate-700 transition hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
                                    >
                                      <FileText size={12} />
                                      <span>รายละเอียด</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-500 sm:px-5 sm:py-3 dark:border-[#1e3a5f] dark:text-slate-400">
          <span className="tabular-nums">
            อยู่ระหว่างการส่ง {inProgressTransfers.length} · ส่งสินค้าสำเร็จ {completedTransfers.length} (จากทั้งหมด {transfers.length} รายการ)
          </span>
          <span>ระบบปฏิบัติการขนย้ายโฟล์คลิฟท์ (Material Handling)</span>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 4. DAILY DUTY ASSIGNMENT MODAL (Shortcut for Supervisors)             */}
      {/* ===================================================================== */}
      {isDailyDutyModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setIsDailyDutyModalOpen(false)}>
          <div
            className="modal-container transfer-modal-card"
            style={{ maxWidth: 1080, width: "96%", maxHeight: "92vh", overflowY: "auto" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header-box" style={{ padding: "16px 22px" }}>
              <div>
                <div className="modal-title-text flex items-center gap-2">
                  <ClipboardList size={18} className="text-indigo-600 dark:text-indigo-400" />
                  ระบบมอบหมายงานประจำวันสำหรับหัวหน้างาน (Daily Duty Assignment)
                </div>
                <div className="modal-sub-text" style={{ marginTop: 2 }}>
                  กำหนดพื้นที่การทำงาน รถที่ขับ กะทำงาน และทีม — เมื่อพนักงานเลือกชื่อในหน้าขนย้าย ระบบจะดึงข้อมูลไปเติมให้อัตโนมัติทันที
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDailyDutyModalOpen(false)}
                className="modal-close-btn"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5">
              <DailyDutyAssignmentPanel
                employees={employees}
                vehicles={vehicles}
                duties={dailyDuties}
                onDutiesChange={setDailyDuties}
                defaultDate={workingDate}
                compact
              />
            </div>

            <div className="modal-footer-box flex justify-end">
              <button
                type="button"
                className="button primary"
                onClick={() => setIsDailyDutyModalOpen(false)}
              >
                เสร็จสิ้น / กลับหน้าขนย้าย
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 5. VIEW DETAILS MODAL                                                 */}
      {/* ===================================================================== */}
      {selectedRecord && (
        <div className="modal-backdrop">
          <div
            className="modal-container transfer-modal-card"
            style={{ maxWidth: 620, width: "95%" }}
          >
            <div className="modal-header-box" style={{ padding: "18px 24px" }}>
              <div>
                <div className="modal-title-text">
                  รายละเอียดการขนย้าย: <span className="code">{selectedRecord.transferCode}</span>
                </div>
                <div className="modal-sub-text" style={{ marginTop: 2 }}>
                  วันที่ {selectedRecord.workingDate} · บันทึกโดย {selectedRecord.driverName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedRecord(null);
                  setConfirmDeleteId(null);
                }}
                className="modal-close-btn"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-6 text-xs sm:grid-cols-2">
              <div>
                <div className="modal-label-text">พนักงานขับรถ / รถโฟล์คลิฟท์</div>
                <div className="modal-val-text mt-1 font-bold">
                  {selectedRecord.driverName}{" "}
                  {selectedRecord.vehicleNumber && selectedRecord.vehicleNumber !== "-"
                    ? `(${selectedRecord.vehicleNumber})`
                    : ""}
                </div>
                <div className="mt-1 text-[11px] opacity-80">
                  {selectedRecord.team || "-"} · {selectedRecord.shift || "-"} · พื้นที่:{" "}
                  {selectedRecord.workArea || "-"}
                </div>
              </div>

              <div>
                <div className="modal-label-text">ชื่อสินค้า &amp; ประเภทการย้าย</div>
                <div className="modal-val-text mt-1 font-bold">
                  {selectedRecord.itemName} ·{" "}
                  {selectedRecord.transferType || selectedRecord.productCategory}
                </div>
              </div>

              <div>
                <div className="modal-label-text">ต้นทาง</div>
                <div className="mt-1 font-bold text-sky-700 dark:text-sky-300">
                  {selectedRecord.originFacility}
                </div>
              </div>

              <div>
                <div className="modal-label-text">ปลายทาง</div>
                <div className="mt-1 font-bold text-emerald-700 dark:text-emerald-300">
                  {selectedRecord.destinationFacility}
                </div>
              </div>

              <div>
                <div className="modal-label-text">รายละเอียดน้ำหนัก</div>
                <div className="modal-val-text mt-1 font-bold tabular-nums">
                  {(selectedRecord.totalBundles ?? selectedRecord.quantity) || 0} มัด ·{" "}
                  {getRecordWeightKg(selectedRecord).toLocaleString()} กก. ({selectedRecord.weightTon} ตัน)
                  {typeof selectedRecord.fullBundles === "number" &&
                    typeof selectedRecord.weightPerBundleKg === "number" && (
                      <div className="mt-0.5 text-[11px] font-normal opacity-80">
                        {selectedRecord.fullBundles} มัดเต็ม × {selectedRecord.weightPerBundleKg} กก.
                        {(selectedRecord.remainderWeightKg || 0) > 0
                          ? ` + เศษ ${selectedRecord.remainderWeightKg} กก.`
                          : ""}
                      </div>
                    )}
                </div>
              </div>

              <div>
                <div className="modal-label-text">เวลาเริ่ม - จบ &amp; SLA (20 นาที)</div>
                <div className="modal-val-text mt-1">
                  <div>
                    เริ่ม {selectedRecord.startTime || "-"} ➔ จบ{" "}
                    {selectedRecord.endTime || "กำลังดำเนินการ"}
                  </div>
                  {selectedRecord.status !== "Cancelled" && (
                    <div
                      className={`mt-1 font-extrabold ${
                        isRecordOverdue(selectedRecord, nowMs)
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      ใช้เวลา: {formatDurationThai(getRecordDurationSeconds(selectedRecord, nowMs))}
                      {isRecordOverdue(selectedRecord, nowMs) ? " (เกินเวลา SLA 20 นาที)" : " (ผ่านเกณฑ์ SLA)"}
                    </div>
                  )}
                </div>
              </div>

              {selectedRecord.notes && (
                <div className="modal-notes-box sm:col-span-2">
                  <div className="modal-label-text">หมายเหตุ</div>
                  <div className="modal-val-text mt-1 font-medium">{selectedRecord.notes}</div>
                </div>
              )}
            </div>

            <div className="modal-footer-box flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {selectedRecord.status !== "Completed" && (
                  <button
                    type="button"
                    onClick={() => handleCompleteTrip(selectedRecord)}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 size={13} />
                    ยืนยันจบงาน
                  </button>
                )}

                {confirmDeleteId === selectedRecord.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDeleteTransfer(selectedRecord.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                    >
                      ยืนยันลบถาวร
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:border-[#2c4a75] dark:text-slate-300"
                    >
                      ยกเลิก
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(selectedRecord.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
                  >
                    <Trash2 size={13} />
                    ลบรายการ
                  </button>
                )}
              </div>

              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setSelectedRecord(null);
                  setConfirmDeleteId(null);
                }}
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
