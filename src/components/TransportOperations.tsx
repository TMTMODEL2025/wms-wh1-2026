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
  MhTransferRecord,
  MhTransferStatus,
  loadCachedMhDailyDuties,
  subscribeToMhTransfers,
  subscribeToMhDailyDuties,
  fetchMhTransfersOnce,
  fetchMhDailyDutiesOnce,
  saveMhTransferToCloud,
  saveMhTransfersBatchToCloud,
  deleteMhTransferFromCloud,
  getForkliftCloudRealtimeEnabled,
  setForkliftCloudRealtimeEnabled,
  subscribeForkliftCloudRealtimeMode,
} from "../services/forkliftDataService";
import { DailyDutyAssignmentPanel } from "./DailyDutyAssignmentPanel";

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
const LAST_OPERATOR_STORAGE_KEY = "tmt_mh_last_operator_name_v1";
const LAST_VEHICLE_STORAGE_KEY = "tmt_mh_last_vehicle_v1";

const QUICK_PRODUCTS = ["เหล็กฟิล์ม", "เหล็กม้วน", "เหล็กสลิต", "เหล็กแผ่น RM"];
const QUICK_TRANSFER_TYPES = ["งาน Stock", "ทั่วไป", "งานฝาก", "อื่นๆ"];
const QUICK_BUILDINGS = ["อาคาร A", "อาคาร B", "อาคาร C", "ลานพักสินค้า"];
const QUICK_TRIP_COUNTS = [1, 2, 3, 4, 5];

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
  assignments,
  employees = [],
  onNavigateToAssignments,
  onNavigateToVehicles,
}: TransportOperationsProps) {
  const [transfers, setTransfers] = useState<TransportTransferRecord[]>([]);
  const [dailyDuties, setDailyDuties] = useState<MhDailyDutyRecord[]>(() =>
    loadCachedMhDailyDuties()
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

  // Quick Entry Form collapse toggle (expanded by default)
  const [isQuickFormExpanded, setIsQuickFormExpanded] = useState<boolean>(true);

  // Quick Transfer Entry State
  const [workingDate, setWorkingDate] = useState<string>(() => getLocalDateStr());
  const [workingTime, setWorkingTime] = useState<string>(() => getLocalTimeHmStr());
  const [isDateTimeEdited, setIsDateTimeEdited] = useState<boolean>(false);

  const [driverName, setDriverName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(LAST_OPERATOR_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
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

  // Subscribe to mh_transfers & mh_daily_duty ONLY while mounted
  useEffect(() => {
    const unsubTransfers = subscribeToMhTransfers((cloudRecords) => {
      setTransfers(cloudRecords);
    });
    const unsubDuties = subscribeToMhDailyDuties((cloudDuties) => {
      setDailyDuties(cloudDuties);
    });
    return () => {
      unsubTransfers();
      unsubDuties();
    };
  }, [cloudRealtime]);

  // Persist last used employee name & vehicle locally
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (driverName.trim()) {
        window.localStorage.setItem(LAST_OPERATOR_STORAGE_KEY, driverName.trim());
      }
    } catch {
      // ignore storage error
    }
  }, [driverName]);

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

  // Match Daily Duty Assignment for selected driverName & workingDate
  const matchedDailyDuty = useMemo(() => {
    const cleanDriver = driverName.trim().toLowerCase();
    if (!cleanDriver) return null;
    const targetDate = workingDate || getLocalDateStr();
    const exactDateMatch = dailyDuties.find(
      (d) =>
        d.workingDate === targetDate &&
        d.employeeName.trim().toLowerCase() === cleanDriver
    );
    if (exactDateMatch) return exactDateMatch;

    // Fallback to today's date if workingDate differs or vice versa
    const todayStr = getLocalDateStr();
    if (targetDate !== todayStr) {
      return (
        dailyDuties.find(
          (d) =>
            d.workingDate === todayStr &&
            d.employeeName.trim().toLowerCase() === cleanDriver
        ) || null
      );
    }
    return null;
  }, [dailyDuties, driverName, workingDate]);

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

  // Employee quick suggestions (prioritizing employees assigned today)
  const employeeSuggestions = useMemo(() => {
    const names = new Set<string>();
    const targetDate = workingDate || getLocalDateStr();
    dailyDuties
      .filter((d) => d.workingDate === targetDate)
      .forEach((d) => {
        if (d.employeeName) names.add(d.employeeName.trim());
      });
    if (driverName.trim()) names.add(driverName.trim());
    assignments.forEach((a) => {
      if (a.driverName && a.driverName !== "-") names.add(a.driverName.trim());
    });
    employees.forEach((emp) => {
      if (emp.employmentStatus === "Active" && emp.employeeName) {
        names.add(emp.employeeName.trim());
      }
    });
    transfers.slice(0, 30).forEach((t) => {
      if (t.driverName && t.driverName !== "-") names.add(t.driverName.trim());
    });
    return Array.from(names).slice(0, 14);
  }, [dailyDuties, workingDate, assignments, employees, transfers, driverName]);

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
      const [latestTransfers, latestDuties] = await Promise.all([
        fetchMhTransfersOnce(),
        fetchMhDailyDutiesOnce(),
      ]);
      setTransfers(latestTransfers);
      setDailyDuties(latestDuties);
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
        recorderName: draft.driverName.trim(),
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
        return;
      }
      draftsToCreate.push(makeCurrentDraft("CURRENT"));
    }

    const allNewRecords = draftsToCreate.flatMap(buildRecordsFromDraft);
    if (allNewRecords.length === 0) return;

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
      setFeedbackBanner({
        type: "success",
        text: `เริ่มส่งงานสำเร็จ ${allNewRecords.length} รายการ (เริ่มนับเวลา SLA 20 นาทีแล้ว)`,
      });
    } catch {
      setFeedbackBanner({
        type: "error",
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
  };

  const handleDeleteTransfer = async (id: string) => {
    setTransfers((prev) => prev.filter((item) => item.id !== id));
    if (selectedRecord?.id === id) {
      setSelectedRecord(null);
    }
    setConfirmDeleteId(null);
    await deleteMhTransferFromCloud(id);
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
        className="button secondary"
        onClick={() => setForkliftCloudRealtimeEnabled(!cloudRealtime)}
        style={{
          padding: "6px 10px",
          fontSize: 11,
          borderColor: cloudRealtime ? "#22c55e" : "#94a3b8",
          color: cloudRealtime ? "#15803d" : "#475569",
        }}
        title="สลับโหมด Cloud Real-time เพื่อประหยัดโควต้าการอ่านข้อมูล"
      >
        {cloudRealtime ? <Wifi size={13} /> : <WifiOff size={13} />}
        {cloudRealtime ? "Cloud Real-time: ON" : "Cloud Real-time: OFF (ประหยัดโควต้า)"}
      </button>
      {!cloudRealtime && (
        <button
          type="button"
          className="button secondary"
          onClick={handleManualReload}
          disabled={isRefreshing}
          style={{ padding: "6px 10px", fontSize: 11 }}
        >
          <RefreshCw size={13} />
          {isRefreshing ? "กำลังโหลด..." : "ดึงข้อมูลล่าสุด"}
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {headingPortalTarget ? createPortal(cloudControlButtons, headingPortalTarget) : null}

      {!headingPortalTarget && (
        <div className="flex justify-end">{cloudControlButtons}</div>
      )}

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold shadow-sm ${
            feedbackBanner.type === "error"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackBanner.type === "error" ? (
              <AlertTriangle size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
            <span>{feedbackBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 border-t-4 border-t-sky-600 bg-white p-4 shadow-xs dark:border-[#1e3a5f] dark:border-t-sky-500 dark:bg-[#111e38]">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            กำลังขนส่งอยู่ (Active)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums text-sky-700 dark:text-sky-400">
              {activeTransfers.length}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">รายการ</span>
          </div>
        </div>

        <div
          className={`rounded-xl border p-4 shadow-xs border-t-4 ${
            activeOverdueCount > 0
              ? "border-red-300 border-t-red-600 bg-red-50/80 dark:border-red-800 dark:border-t-red-500 dark:bg-red-950/35"
              : "border-slate-200 border-t-emerald-600 bg-white dark:border-[#1e3a5f] dark:border-t-emerald-500 dark:bg-[#111e38]"
          }`}
        >
          <div
            className={`text-xs font-semibold ${
              activeOverdueCount > 0
                ? "text-red-700 dark:text-red-300"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            งานเกินเวลา SLA (&gt; 20 นาที)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-extrabold tabular-nums ${
                activeOverdueCount > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-700 dark:text-emerald-400"
              }`}
            >
              {activeOverdueCount}
            </span>
            <span
              className={`text-xs ${
                activeOverdueCount > 0
                  ? "font-bold text-red-600 dark:text-red-300"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {activeOverdueCount > 0 ? "ต้องเร่งติดตาม" : "ปกติทั้งหมด"}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 border-t-4 border-t-emerald-600 bg-white p-4 shadow-xs dark:border-[#1e3a5f] dark:border-t-emerald-500 dark:bg-[#111e38]">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            จบงานแล้ววันนี้
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
              {completedToday.length}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">รอบ</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 border-t-4 border-t-cyan-600 bg-white p-4 shadow-xs dark:border-[#1e3a5f] dark:border-t-cyan-500 dark:bg-[#111e38]">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            น้ำหนักขนย้ายวันนี้
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">
              {totalWeightTodayKg.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              กก. ({(totalWeightTodayKg / 1000).toFixed(2)} ตัน)
            </span>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 1. QUICK TRANSFER ENTRY FORM (Fast Field-Operator UI + Duty AutoLink) */}
      {/* ===================================================================== */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-600 text-white">
              <Truck size={17} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                บันทึกการย้ายงานด่วน (Quick Transfer Entry)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                เลือกชื่อพนักงานเพื่อดึงรถ พื้นที่ทำงาน กะ และทีมที่หัวหน้างานมอบหมายวันนี้ให้อัตโนมัติ (SLA 20 นาที/รอบ)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Shortcut button for Supervisor Daily Duty Assignment */}
            <button
              type="button"
              onClick={() => setIsDailyDutyModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400 bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700"
            >
              <ClipboardList size={14} />
              มอบหมายงานประจำวัน (หัวหน้างาน)
              {todayAssignedCount > 0 && (
                <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-extrabold">
                  {todayAssignedCount}
                </span>
              )}
            </button>

            {onNavigateToVehicles && (
              <button
                type="button"
                onClick={onNavigateToVehicles}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
              >
                ทะเบียนรถ ({vehicles.length})
              </button>
            )}
            {onNavigateToAssignments && (
              <button
                type="button"
                onClick={onNavigateToAssignments}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
              >
                จัดการพนักงาน
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsQuickFormExpanded((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
            >
              {isQuickFormExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {isQuickFormExpanded ? "ย่อฟอร์ม" : "เปิดฟอร์ม"}
            </button>
          </div>
        </div>

        {isQuickFormExpanded && (
          <form onSubmit={handleConfirmDispatch} className="space-y-5 p-5">
            {/* Row 1: Date/Time + Employee + Vehicle + Auto-Linked Duty Badge */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
              {/* Date & Time */}
              <div className="md:col-span-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    วันที่และเวลาเริ่มงาน
                  </label>
                  <button
                    type="button"
                    onClick={handleResetToCurrentTime}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-700 hover:underline dark:text-cyan-400"
                  >
                    <RotateCcw size={11} />
                    ใช้เวลาปัจจุบัน
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                    required
                  />
                  <input
                    type="time"
                    value={workingTime}
                    onChange={(e) => {
                      setWorkingTime(e.target.value);
                      setIsDateTimeEdited(true);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                    required
                  />
                </div>
                {!isDateTimeEdited && (
                  <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    อัปเดตเวลาเริ่มส่งจริงอัตโนมัติเมื่อกดยืนยัน
                  </div>
                )}
              </div>

              {/* Employee Name (Remembered in localStorage + Auto-Links Duty) */}
              <div className="md:col-span-5">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                    <User size={13} />
                    ชื่อ-สกุลพนักงานขับรถ *
                  </label>
                  {driverName.trim() && (
                    <span className="text-[11px] font-medium text-cyan-700 dark:text-cyan-400">
                      จำชื่อล่าสุดในเครื่องแล้ว
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  list="mh-driver-suggestions"
                  placeholder="พิมพ์หรือเลือกชื่อพนักงาน..."
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  required={queuedTrips.length === 0}
                />
                <datalist id="mh-driver-suggestions">
                  {employeeSuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>

                {/* Auto-linked Duty Badge Bar OR Notice */}
                {driverName.trim() && (
                  <div className="mt-2">
                    {matchedDailyDuty ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-xs dark:border-indigo-800 dark:bg-indigo-950/50">
                        <div className="flex flex-wrap items-center gap-1.5 font-bold text-indigo-900 dark:text-indigo-100">
                          <span>{team}</span>
                          <span aria-hidden="true" className="opacity-50">|</span>
                          <span>{shift}</span>
                          <span aria-hidden="true" className="opacity-50">|</span>
                          <span>รถที่ขับ: {vehicleNumber || "-"}</span>
                          <span aria-hidden="true" className="opacity-50">|</span>
                          <span className="text-emerald-700 dark:text-emerald-300">
                            พื้นที่หลัก: {workArea}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setManualDutyOverride((v) => !v)}
                          className="text-[11px] font-semibold text-indigo-700 underline hover:text-indigo-900 dark:text-indigo-300"
                        >
                          {manualDutyOverride ? "ซ่อนตัวเลือก" : "ปรับแก้"}
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/35 dark:text-amber-200">
                        พนักงานยังไม่ได้รับมอบหมายงานในวันนี้ — กรุณาเลือกทีม / กะ / พื้นที่การทำงาน / รถด้านล่าง
                      </div>
                    )}
                  </div>
                )}

                {employeeSuggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {employeeSuggestions.slice(0, 6).map((name) => {
                      const activeChip = driverName.trim() === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setDriverName(name)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                            activeChip
                              ? "border-cyan-600 bg-cyan-600 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-400 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Forklift Vehicle Selector */}
              <div className="md:col-span-3">
                <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
                  หมายเลขรถโฟล์คลิฟท์
                </label>
                <select
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                >
                  <option value="">-- ไม่ระบุ / ทั่วไป --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.vehicleId}>
                      {v.vehicleId} ({v.vehicleType})
                    </option>
                  ))}
                </select>
                {matchedDailyDuty && (
                  <div className="mt-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                    ดึงรถตามตารางมอบหมาย: {matchedDailyDuty.vehicleNumber}
                  </div>
                )}
              </div>
            </div>

            {/* Manual Team / Shift / WorkArea Selection (shown when unassigned OR manual override enabled) */}
            {(!matchedDailyDuty || manualDutyOverride) && (
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-[#1e3a5f] dark:bg-[#0d1930] lg:grid-cols-12">
                {/* Team Quick Toggle */}
                <div className="lg:col-span-3">
                  <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
                    ทีม (Team)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {MH_TEAMS.map((tOpt) => (
                      <button
                        key={`form-team-${tOpt}`}
                        type="button"
                        onClick={() => setTeam(tOpt)}
                        className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${
                          team === tOpt
                            ? "border-cyan-600 bg-cyan-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-cyan-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                        }`}
                      >
                        {tOpt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Shift Quick Toggle */}
                <div className="lg:col-span-4">
                  <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
                    กะทำงาน (Shift)
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {MH_SHIFTS.map((sOpt) => (
                      <button
                        key={`form-shift-${sOpt}`}
                        type="button"
                        onClick={() => setShift(sOpt)}
                        className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${
                          shift === sOpt
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                        }`}
                      >
                        {sOpt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary Work Area Quick Toggle */}
                <div className="lg:col-span-5">
                  <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
                    <MapPin size={12} />
                    พื้นที่การทำงานหลัก (ตั้งเป็นต้นทาง)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {MH_WORK_AREAS.map((area) => (
                      <button
                        key={`form-area-${area}`}
                        type="button"
                        onClick={() => {
                          setWorkArea(area);
                          setOriginFacility(area);
                        }}
                        className={`rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
                          workArea === area
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                        }`}
                      >
                        {area}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Row 2: Product Name Quick Chips + Transfer Type Quick Chips */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Product Name */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-[#1e3a5f] dark:bg-[#0d1930]">
                <label className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <Package size={13} />
                  ชื่อสินค้า (กดเลือกด่วน หรือพิมพ์เพิ่ม) *
                </label>
                <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {QUICK_PRODUCTS.map((prod) => {
                    const selected = itemName === prod;
                    return (
                      <button
                        key={prod}
                        type="button"
                        onClick={() => setItemName(prod)}
                        className={`rounded-lg border px-3 py-2.5 text-xs font-bold transition ${
                          selected
                            ? "border-cyan-600 bg-cyan-600 text-white shadow-xs"
                            : "border-slate-300 bg-white text-slate-800 hover:border-cyan-500 hover:bg-cyan-50/50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-100 dark:hover:bg-[#1d3158]"
                        }`}
                      >
                        {prod}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  placeholder="หรือพิมพ์ชื่อสินค้าอื่น..."
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                />
              </div>

              {/* Transfer Type */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-[#1e3a5f] dark:bg-[#0d1930]">
                <label className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <Layers size={13} />
                  ประเภทการย้าย *
                </label>
                <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {QUICK_TRANSFER_TYPES.map((type) => {
                    const selected = transferType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setTransferType(type)}
                        className={`rounded-lg border px-3 py-2.5 text-xs font-bold transition ${
                          selected
                            ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                            : "border-slate-300 bg-white text-slate-800 hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-100 dark:hover:bg-[#1d3158]"
                        }`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  placeholder="ระบุประเภทการย้ายหรือหมายเหตุสั้นๆ..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                />
              </div>
            </div>

            {/* Row 3: Origin & Destination Quick-Select Buildings */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-[#1e3a5f] dark:bg-[#0d1930]">
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-11">
                {/* Origin */}
                <div className="lg:col-span-5">
                  <label className="mb-2 block text-xs font-bold text-sky-700 dark:text-sky-300">
                    ต้นทาง (Origin) *
                  </label>
                  <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {QUICK_BUILDINGS.map((b) => {
                      const selected = originFacility === b;
                      return (
                        <button
                          key={`orig-${b}`}
                          type="button"
                          onClick={() => setOriginFacility(b)}
                          className={`rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
                            selected
                              ? "border-sky-600 bg-sky-600 text-white shadow-xs"
                              : "border-slate-300 bg-white text-slate-800 hover:border-sky-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-100"
                          }`}
                        >
                          {b}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    placeholder="หรือพิมพ์จุดต้นทาง..."
                    value={originFacility}
                    onChange={(e) => setOriginFacility(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  />
                </div>

                {/* Swap Button */}
                <div className="flex items-center justify-center pt-1 lg:col-span-1 lg:pt-8">
                  <button
                    type="button"
                    onClick={handleSwapFacilities}
                    title="สลับต้นทางและปลายทาง"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
                  >
                    <ArrowLeftRight size={16} />
                  </button>
                </div>

                {/* Destination */}
                <div className="lg:col-span-5">
                  <label className="mb-2 block text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    ปลายทาง (Destination) *
                  </label>
                  <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {QUICK_BUILDINGS.map((b) => {
                      const selected = destinationFacility === b;
                      return (
                        <button
                          key={`dest-${b}`}
                          type="button"
                          onClick={() => setDestinationFacility(b)}
                          className={`rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
                            selected
                              ? "border-emerald-600 bg-emerald-600 text-white shadow-xs"
                              : "border-slate-300 bg-white text-slate-800 hover:border-emerald-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-100"
                          }`}
                        >
                          {b}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    placeholder="หรือพิมพ์จุดปลายทาง..."
                    value={destinationFacility}
                    onChange={(e) => setDestinationFacility(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-emerald-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            {/* Row 4: Auto Weight Calculator (3 Sub-inputs + Live Result) */}
            <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4 dark:border-cyan-900/60 dark:bg-cyan-950/20">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-900 dark:text-cyan-200">
                  <Scale size={15} />
                  <span>คำนวณน้ำหนักอัตโนมัติ (จำนวนมัด × น้ำหนักต่อมัด + น้ำหนักเศษ)</span>
                </div>
                <div className="text-xs font-medium text-cyan-800 dark:text-cyan-300">
                  หากมีน้ำหนักเศษ (&gt; 0 กก.) ระบบนับเพิ่ม +1 มัดเศษให้อัตโนมัติ
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-200">
                    1. จำนวนมัด (มัดเต็ม)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={fullBundlesInput}
                    onChange={(e) => setFullBundlesInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base font-bold tabular-nums text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-200">
                    2. น้ำหนักต่อมัด (กก.)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={weightPerBundleInput}
                    onChange={(e) => setWeightPerBundleInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base font-bold tabular-nums text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-200">
                    3. น้ำหนักเศษ (กก.)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={remainderWeightInput}
                    onChange={(e) => setRemainderWeightInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base font-bold tabular-nums text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Large Clear Live Summary */}
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-300 bg-white px-4 py-3 dark:border-cyan-800 dark:bg-[#0c162c]">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  <span className="font-bold tabular-nums">{fullBundles}</span> มัดเต็ม ×{" "}
                  <span className="font-bold tabular-nums">{weightPerBundleKg.toLocaleString()}</span> กก. ={" "}
                  <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                    {fullBundlesWeightKg.toLocaleString()} กก.
                  </span>
                  {hasRemainderBundle && (
                    <>
                      {" "}
                      + เศษ{" "}
                      <span className="font-bold tabular-nums text-amber-700 dark:text-amber-300">
                        {remainderWeightKg.toLocaleString()} กก. (+1 มัดเศษ)
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-right">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      จำนวนมัดรวม
                    </div>
                    <div className="text-lg font-extrabold tabular-nums text-cyan-700 dark:text-cyan-300">
                      {totalBundles} มัด
                    </div>
                  </div>
                  <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
                  <div className="text-right">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      น้ำหนักรวมสุทธิ
                    </div>
                    <div className="text-xl font-extrabold tabular-nums text-slate-900 dark:text-white">
                      {totalWeightKg.toLocaleString()} กก.{" "}
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        ({totalWeightTon} ตัน)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 5: Multi-Trip Batch Count + Add to Queue + Submit */}
            <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#1e3a5f] dark:bg-[#0d1930] lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  จำนวนรอบที่จะส่งพร้อมกัน:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {QUICK_TRIP_COUNTS.map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setTripCount(cnt)}
                      className={`h-10 min-w-[48px] rounded-lg border px-3 text-sm font-extrabold transition ${
                        tripCount === cnt
                          ? "border-cyan-600 bg-cyan-600 text-white shadow-xs"
                          : "border-slate-300 bg-white text-slate-800 hover:border-cyan-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-100"
                      }`}
                    >
                      {cnt} รอบ
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={tripCount}
                    onChange={(e) => setTripCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className="h-10 w-20 rounded-lg border border-slate-300 bg-white px-2.5 text-center text-sm font-bold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                    aria-label="กำหนดจำนวนรอบเอง"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleAddToQueue}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-600 bg-white px-4 py-3 text-sm font-bold text-cyan-700 transition hover:bg-cyan-50 dark:border-cyan-500 dark:bg-[#162544] dark:text-cyan-300 dark:hover:bg-[#1d3158]"
                >
                  <Plus size={16} />
                  + เพิ่มรายการรอบถัดไปในคิว
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  <Send size={16} />
                  {isSubmitting
                    ? "กำลังบันทึก..."
                    : queuedTrips.length > 0
                    ? `ยืนยันการส่งทั้งหมด (${effectiveBatchCount} รอบ)`
                    : `ยืนยันการส่ง (${tripCount} รอบ)`}
                </button>
              </div>
            </div>

            {/* Staged Multi-Item Queue List */}
            {queuedTrips.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3.5 dark:border-amber-800 dark:bg-amber-950/25">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    รายการรอส่งในคิว ({queuedTrips.length} รายการ · รวม {totalQueuedRounds} รอบ ·{" "}
                    {totalQueuedKg.toLocaleString()} กก.)
                  </div>
                  <button
                    type="button"
                    onClick={() => setQueuedTrips([])}
                    className="text-xs font-semibold text-red-700 hover:underline dark:text-red-400"
                  >
                    ล้างคิวทั้งหมด
                  </button>
                </div>
                <div className="space-y-2">
                  {queuedTrips.map((q, idx) => (
                    <div
                      key={q.queueId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs dark:border-amber-900/60 dark:bg-[#111e38]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
                          #{idx + 1} · {q.tripCount} รอบ
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {q.driverName}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          ({q.team} · {q.shift} · {q.workArea})
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {q.itemName} ({q.transferType})
                        </span>
                        <span className="font-semibold text-sky-700 dark:text-sky-300">
                          {q.originFacility} ➔ {q.destinationFacility}
                        </span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {q.totalBundles} มัด / {q.totalWeightKg.toLocaleString()} กก./รอบ
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromQueue(q.queueId)}
                        className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
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
      {/* 2. ACTIVE TRANSFERS ZONE (Real-Time Timer + 20-Min SLA Alert)         */}
      {/* ===================================================================== */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-sky-50/70 px-5 py-3.5 dark:border-[#1e3a5f] dark:bg-[#0c1a36]">
          <div className="flex items-center gap-2.5">
            <Clock size={18} className="text-sky-600 dark:text-sky-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                รายการที่อยู่ระหว่างการส่ง (Active Transfers)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                จับเวลาแบบ Real-time แยกตามพนักงาน พร้อมข้อมูลทีม กะ รถที่ขับ และพื้นที่ — เกิน 20 นาทีแจ้งเตือนสีแดงอัตโนมัติ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="rounded-md bg-sky-100 px-2.5 py-1 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
              กำลังส่ง {activeTransfers.length} รอบ
            </span>
            {activeOverdueCount > 0 && (
              <span className="rounded-md bg-red-600 px-2.5 py-1 text-white">
                เกินเวลา SLA {activeOverdueCount} รอบ
              </span>
            )}
          </div>
        </div>

        <div className="p-4">
          {groupedActiveTransfers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500 dark:border-[#2c4a75] dark:text-slate-400">
              ไม่มีรายการที่อยู่ระหว่างการส่งในขณะนี้ — สร้างรายการด้านบนแล้วกด &quot;ยืนยันการส่ง&quot; เพื่อเริ่มนับเวลา
            </div>
          ) : (
            <div className="space-y-4">
              {groupedActiveTransfers.map(([operatorGroup, items]) => {
                const groupOverdueCount = items.filter((tr) => isRecordOverdue(tr, nowMs)).length;
                const firstItem = items[0];
                return (
                  <div
                    key={operatorGroup}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-[#1e3a5f] dark:bg-[#0c162c]"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <User size={15} className="text-cyan-700 dark:text-cyan-400" />
                        <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                          {operatorGroup}
                        </span>
                        {firstItem.team && (
                          <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${getTeamTagClass(firstItem.team)}`}>
                            {firstItem.team}
                          </span>
                        )}
                        {firstItem.shift && (
                          <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {firstItem.shift}
                          </span>
                        )}
                        {firstItem.workArea && (
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            พื้นที่: {firstItem.workArea}
                          </span>
                        )}
                        <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 dark:bg-sky-950/70 dark:text-sky-200">
                          {items.length} งานค้างส่ง
                        </span>
                      </div>
                      {groupOverdueCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-950/70 dark:text-red-300">
                          <AlertTriangle size={12} />
                          เกินเวลา 20 นาที {groupOverdueCount} งาน
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {items.map((tr) => {
                        const elapsedSec = getRecordDurationSeconds(tr, nowMs);
                        const overdue = elapsedSec > SLA_LIMIT_SECONDS;
                        const elapsedMins = Math.floor(elapsedSec / 60);
                        const weightKg = getRecordWeightKg(tr);
                        const bundles = tr.totalBundles ?? tr.quantity ?? 0;

                        return (
                          <div
                            key={tr.id}
                            className={`flex flex-col justify-between rounded-xl border p-3.5 shadow-xs transition ${
                              overdue
                                ? "border-red-400 bg-red-50/90 dark:border-red-700 dark:bg-red-950/40"
                                : "border-slate-200 bg-white dark:border-[#24426b] dark:bg-[#111e38]"
                            }`}
                          >
                            <div>
                              {/* Card Top: Code + Live Timer */}
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-300">
                                      {tr.transferCode}
                                    </span>
                                    {typeof tr.tripIndex === "number" &&
                                      typeof tr.totalTrips === "number" && (
                                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200">
                                          รอบ {tr.tripIndex}/{tr.totalTrips}
                                        </span>
                                      )}
                                  </div>
                                  <div className="mt-1 text-sm font-extrabold text-slate-900 dark:text-white">
                                    {tr.itemName}{" "}
                                    <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                                      ({tr.transferType || tr.productCategory})
                                    </span>
                                  </div>
                                </div>

                                <div
                                  className={`shrink-0 rounded-lg border px-2.5 py-1 text-right font-mono ${
                                    overdue
                                      ? "border-red-400 bg-red-600 text-white"
                                      : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  }`}
                                >
                                  <div className="text-[10px] font-sans font-bold uppercase opacity-90">
                                    {overdue ? "เกินเวลา" : "เวลาที่ผ่านไป"}
                                  </div>
                                  <div className="text-sm font-extrabold tabular-nums">
                                    {formatDurationClock(elapsedSec)}
                                  </div>
                                </div>
                              </div>

                              {/* Operator Assignment Metadata Row */}
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                {tr.team && (
                                  <span className={`rounded px-1.5 py-0.5 font-bold ${getTeamTagClass(tr.team)}`}>
                                    {tr.team}
                                  </span>
                                )}
                                {tr.shift && <span>{tr.shift}</span>}
                                {tr.vehicleNumber && tr.vehicleNumber !== "-" && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">
                                      รถ {tr.vehicleNumber}
                                    </span>
                                  </>
                                )}
                                {tr.workArea && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>พื้นที่: {tr.workArea}</span>
                                  </>
                                )}
                              </div>

                              {/* Route */}
                              <div className="mt-2 flex items-center gap-1.5 rounded-md bg-slate-100/80 px-2.5 py-1.5 text-xs font-bold dark:bg-[#0c162c]">
                                <span className="text-sky-700 dark:text-sky-300">
                                  {tr.originFacility}
                                </span>
                                <ArrowRight size={13} className="shrink-0 text-slate-400" />
                                <span className="text-emerald-700 dark:text-emerald-300">
                                  {tr.destinationFacility}
                                </span>
                              </div>

                              {/* Weight & Start Time */}
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                                <span className="tabular-nums">
                                  {bundles} มัด ·{" "}
                                  <strong className="text-slate-900 dark:text-white">
                                    {weightKg.toLocaleString()} กก.
                                  </strong>
                                </span>
                                <span className="tabular-nums">
                                  เริ่ม: <strong>{tr.startTime || "-"}</strong>
                                </span>
                              </div>

                              {overdue && (
                                <div className="mt-2 flex items-center gap-1.5 rounded-md bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-700 dark:bg-red-900/60 dark:text-red-200">
                                  <AlertTriangle size={13} />
                                  เกินเวลา {elapsedMins} นาที (SLA 20 นาที)
                                </div>
                              )}
                            </div>

                            {/* Card Actions */}
                            <div className="mt-3 flex items-center gap-2 border-t border-slate-200/80 pt-2.5 dark:border-[#1e3a5f]">
                              <button
                                type="button"
                                onClick={() => handleCompleteTrip(tr)}
                                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white transition hover:bg-emerald-700"
                              >
                                <CheckCircle2 size={14} />
                                ยืนยันจบงาน
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateTransferStatus(tr, "Cancelled")}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-300"
                                title="ยกเลิกรายการนี้"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 3. HISTORY & LOG TABLE (With Team & Shift Filters)                    */}
      {/* ===================================================================== */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-[#1e3a5f]">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              ประวัติและรายการปฏิบัติการขนย้ายทั้งหมด
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              แสดงข้อมูลทีม กะทำงาน รถที่ขับ พื้นที่ทำงาน และเวลาที่ใช้ส่งเทียบเกณฑ์ SLA 20 นาที
            </p>
          </div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            ทั้งหมด {transfers.length} รายการ
          </div>
        </div>

        {/* Filter Toolbar: Search + Team Filter + Shift Filter + Status Filter */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3 dark:border-[#1e3a5f] dark:bg-[#0d1930]">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="ค้นหาตามรหัส, พนักงาน, รถ, สินค้า, พื้นที่..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
            />
          </div>

          {/* Team Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">ทีม:</span>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
            >
              <option value="All">ทั้งหมด</option>
              {MH_TEAMS.map((tOpt) => (
                <option key={`filter-team-${tOpt}`} value={tOpt}>
                  {tOpt}
                </option>
              ))}
            </select>
          </div>

          {/* Shift Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">กะทำงาน:</span>
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
            >
              <option value="All">ทั้งหมด</option>
              {MH_SHIFTS.map((sOpt) => (
                <option key={`filter-shift-${sOpt}`} value={sOpt}>
                  {sOpt}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-slate-500 dark:text-slate-400" />
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">สถานะ:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
            >
              <option value="All">ทั้งหมด (All)</option>
              <option value="In Transit">อยู่ระหว่างการส่ง</option>
              <option value="Completed">จบงานแล้ว (Completed)</option>
              <option value="Overdue">เกินเวลา SLA (&gt; 20 นาที)</option>
              <option value="Cancelled">ยกเลิก</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/80 text-[11px] font-bold text-slate-600 dark:border-[#1e3a5f] dark:bg-[#0c162c] dark:text-slate-300">
                <th className="px-4 py-3 whitespace-nowrap">วันที่ / เวลาเริ่ม-จบ</th>
                <th className="px-4 py-3 whitespace-nowrap">ชื่อ-สกุลพนักงาน</th>
                <th className="px-4 py-3 whitespace-nowrap">ชื่อสินค้า &amp; ประเภทการย้าย</th>
                <th className="px-4 py-3 whitespace-nowrap">ต้นทาง ➔ ปลายทาง</th>
                <th className="px-4 py-3 whitespace-nowrap">รายละเอียดน้ำหนัก</th>
                <th className="px-4 py-3 whitespace-nowrap">เวลาที่ใช้ส่ง</th>
                <th className="px-4 py-3 whitespace-nowrap">สถานะ</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">ปุ่มจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    ไม่พบรายการขนย้ายที่ตรงกับเงื่อนไขการค้นหา
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((tr) => {
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
                      className={`transition hover:bg-slate-50 dark:hover:bg-[#162544]/70 ${
                        overdue ? "bg-red-50/40 dark:bg-red-950/15" : ""
                      }`}
                    >
                      {/* 1. วันที่/เวลาเริ่ม-จบ */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {tr.workingDate}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                          {tr.startTime || "-"} ➔{" "}
                          {tr.status === "Completed"
                            ? tr.endTime || "-"
                            : tr.status === "Cancelled"
                            ? "ยกเลิก"
                            : "กำลังส่ง..."}
                        </div>
                      </td>

                      {/* 2. ชื่อ-สกุลพนักงาน + ทีม / กะ / รถ / พื้นที่ */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {tr.driverName}
                          </span>
                          {typeof tr.tripIndex === "number" &&
                            typeof tr.totalTrips === "number" && (
                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                                รอบ {tr.tripIndex}/{tr.totalTrips}
                              </span>
                            )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {tr.team && (
                            <span className={`rounded px-1.5 py-0.5 font-bold ${getTeamTagClass(tr.team)}`}>
                              {tr.team}
                            </span>
                          )}
                          {tr.shift && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {tr.shift}
                            </span>
                          )}
                          {tr.vehicleNumber && tr.vehicleNumber !== "-" && (
                            <span className="font-mono font-bold text-cyan-700 dark:text-cyan-400">
                              รถ {tr.vehicleNumber}
                            </span>
                          )}
                          {tr.workArea && (
                            <span className="font-medium text-emerald-700 dark:text-emerald-300">
                              · พื้นที่ {tr.workArea}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. ชื่อสินค้า & ประเภทการย้าย */}
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {tr.itemName}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {tr.transferType || tr.productCategory}
                          </span>
                          <span className="font-mono text-slate-400">{tr.transferCode}</span>
                        </div>
                      </td>

                      {/* 4. ต้นทาง ➔ ปลายทาง */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className="text-sky-700 dark:text-sky-300">
                            {tr.originFacility}
                          </span>
                          <ArrowRight size={12} className="text-slate-400" />
                          <span className="text-emerald-700 dark:text-emerald-300">
                            {tr.destinationFacility}
                          </span>
                        </div>
                      </td>

                      {/* 5. รายละเอียดน้ำหนัก */}
                      <td className="px-4 py-3">
                        <div className="font-extrabold tabular-nums text-slate-900 dark:text-white">
                          {bundles} มัด · {weightKg.toLocaleString()} กก.
                        </div>
                        {typeof tr.fullBundles === "number" &&
                        typeof tr.weightPerBundleKg === "number" ? (
                          <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            {tr.fullBundles}×{tr.weightPerBundleKg} กก.
                            {(tr.remainderWeightKg || 0) > 0
                              ? ` + เศษ ${tr.remainderWeightKg} กก.`
                              : ""}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            {tr.weightTon} ตัน
                          </div>
                        )}
                      </td>

                      {/* 6. เวลาที่ใช้ส่ง (สีแดงเมื่อเกิน 20 นาที) */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {tr.status === "Cancelled" ? (
                          <span className="text-slate-400">-</span>
                        ) : (
                          <div>
                            <div
                              className={`font-mono text-xs font-extrabold tabular-nums ${
                                overdue
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-emerald-700 dark:text-emerald-400"
                              }`}
                            >
                              {isActiveRow
                                ? `${formatDurationClock(durationSec)} (กำลังส่ง)`
                                : formatDurationThai(durationSec)}
                            </div>
                            {overdue && (
                              <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-700 dark:bg-red-950/70 dark:text-red-300">
                                <AlertTriangle size={10} />
                                เกินเวลา {durationMins} นาที
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 7. สถานะ */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-block rounded-md border px-2 py-1 text-[11px] font-bold ${statusInfo.classes}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>

                      {/* 8. ปุ่มจัดการ */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {isActiveRow && (
                            <button
                              type="button"
                              onClick={() => handleCompleteTrip(tr)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                            >
                              <CheckCircle2 size={12} />
                              ยืนยันจบงาน
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecord(tr);
                              setConfirmDeleteId(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
                          >
                            <FileText size={12} />
                            รายละเอียด
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500 dark:border-[#1e3a5f] dark:bg-[#0c162c] dark:text-slate-400">
          <span>
            แสดง {filteredTransfers.length} จากทั้งหมด {transfers.length} รายการ
          </span>
          <span>Material Handling (Forklift) · mh_transfers &amp; mh_daily_duty</span>
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
