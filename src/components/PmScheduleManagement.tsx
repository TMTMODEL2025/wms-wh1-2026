/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Calendar as CalendarIcon,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  Filter,
  History,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  Truck,
  Wifi,
  WifiOff,
  Wrench,
  X,
  AlertTriangle,
  Sparkles,
  Gauge,
} from "lucide-react";
import { Employee, Vehicle } from "../types/officer";
import {
  MH_PM_CATEGORIES,
  MhPmHistoryEntry,
  MhPmScheduleRecord,
  MhPreStartInspectionRecord,
  computeNextPmDate,
  deleteMhPmScheduleFromCloud,
  fetchMhPmSchedulesOnce,
  fetchMhPreStartInspectionsOnce,
  getForkliftCloudRealtimeEnabled,
  saveMhPmScheduleToCloud,
  saveMhPmSchedulesBatchToCloud,
  setForkliftCloudRealtimeEnabled,
  subscribeForkliftCloudRealtimeMode,
  subscribeToMhPmSchedules,
  subscribeToMhPreStartInspections,
} from "../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import { useAuth } from "../contexts/AuthContext";

interface PmScheduleManagementProps {
  vehicles: Vehicle[];
  employees?: Employee[];
}

type PmTabMode = "table" | "calendar" | "history";
type PmHealthStatus = "overdue" | "due-today" | "due-soon" | "normal" | "paused";

interface CalendarEventItem {
  key: string;
  schedule: MhPmScheduleRecord;
  dateYmd: string;
  kind: "overdue" | "due-soon" | "due" | "projected" | "completed" | "mileage-due";
  label: string;
  mileageNote?: string;
}

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

const CYCLE_PRESETS = [
  { label: "ทุก 30 วัน (1 เดือน)", days: 30 },
  { label: "ทุก 60 วัน (2 เดือน)", days: 60 },
  { label: "ทุก 90 วัน (3 เดือน)", days: 90 },
  { label: "ทุก 180 วัน (6 เดือน)", days: 180 },
  { label: "ทุก 365 วัน (1 ปี)", days: 365 },
];

const MILEAGE_PRESETS = [
  { label: "300 กม.", km: 300 },
  { label: "500 กม.", km: 500 },
  { label: "1,000 กม.", km: 1000 },
  { label: "2,500 กม.", km: 2500 },
  { label: "5,000 กม.", km: 5000 },
];

const STANDARD_CONTROL_STYLE: React.CSSProperties = {
  height: 35,
  minHeight: 35,
  fontSize: 12,
  fontWeight: 400,
  borderRadius: 6,
  padding: "7px 10px",
};

const STANDARD_SEARCH_STYLE: React.CSSProperties = {
  height: 35,
  minHeight: 35,
  fontSize: 12,
  fontWeight: 400,
  borderRadius: 6,
  padding: "7px 10px 7px 32px",
};

const STANDARD_DATE_STYLE: React.CSSProperties = {
  height: 35,
  minHeight: 35,
  fontSize: 12,
  fontWeight: 400,
  borderRadius: 6,
  padding: "6px 8px",
};

function getTodayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function diffDaysBetweenYmd(targetYmd: string, baseYmd: string): number {
  const t = parseYmdToLocalDate(targetYmd);
  const b = parseYmdToLocalDate(baseYmd);
  if (!t || !b) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((t.getTime() - b.getTime()) / msPerDay);
}

function formatThaiShortDate(ymd?: string): string {
  if (!ymd) return "-";
  const d = parseYmdToLocalDate(ymd);
  if (!d) return ymd;
  const day = d.getDate();
  const monthShort = [
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
  ][d.getMonth()];
  const buddhistYear = d.getFullYear() + 543;
  return `${day} ${monthShort} ${String(buddhistYear).slice(-2)}`;
}

function formatThaiFullDate(ymd: string): string {
  const d = parseYmdToLocalDate(ymd);
  if (!d) return ymd;
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

export interface PmMileageInfo {
  hasMileageRule: boolean;
  startKm: number;
  cycleKm?: number;
  targetKm?: number;
  latestKm: number;
  latestDateYmd?: string;
  kmRemaining?: number;
  isMileageDue: boolean;
  isMileageSoon: boolean;
  mileageDueDateYmd?: string;
}

function computePmMileageInfo(
  schedule: MhPmScheduleRecord,
  latestReading?: { mileageKm: number; inspectionDate: string; firstReachedDateMap?: Map<number, string> }
): PmMileageInfo {
  const startKm = typeof schedule.startMileageKm === "number" ? schedule.startMileageKm : 0;
  const cycleKm =
    typeof schedule.cycleMileageKm === "number" && schedule.cycleMileageKm > 0
      ? schedule.cycleMileageKm
      : undefined;
  const targetKm =
    typeof schedule.targetMileageKm === "number" && schedule.targetMileageKm > 0
      ? schedule.targetMileageKm
      : cycleKm !== undefined
      ? startKm + cycleKm
      : undefined;

  const latestKm = Math.max(
    schedule.currentMileageKm ?? 0,
    latestReading?.mileageKm ?? 0
  );
  const latestDateYmd = latestReading?.inspectionDate;

  if (targetKm === undefined || targetKm <= 0) {
    return {
      hasMileageRule: false,
      startKm,
      cycleKm,
      targetKm: undefined,
      latestKm,
      latestDateYmd,
      isMileageDue: false,
      isMileageSoon: false,
    };
  }

  const kmRemaining = targetKm - latestKm;
  const isMileageDue = latestKm >= targetKm;
  const warnKmThreshold = Math.max(20, Math.round((cycleKm || targetKm) * 0.1));
  const isMileageSoon = !isMileageDue && kmRemaining <= warnKmThreshold;

  return {
    hasMileageRule: true,
    startKm,
    cycleKm,
    targetKm,
    latestKm,
    latestDateYmd,
    kmRemaining,
    isMileageDue,
    isMileageSoon,
    mileageDueDateYmd: isMileageDue
      ? schedule.mileageDueDate || latestDateYmd || getTodayYmd()
      : undefined,
  };
}

function getPmHealth(
  schedule: MhPmScheduleRecord,
  todayYmd: string,
  mileageInfo: PmMileageInfo
): {
  status: PmHealthStatus;
  daysRemaining: number | null;
  label: string;
  isTriggeredByMileage: boolean;
} {
  if (schedule.scheduleStatus === "Paused") {
    return {
      status: "paused",
      daysRemaining: schedule.nextPmDate
        ? diffDaysBetweenYmd(schedule.nextPmDate, todayYmd)
        : null,
      label: "พักรอบชั่วคราว",
      isTriggeredByMileage: false,
    };
  }

  // 1. Check Mileage PM Due first
  if (mileageInfo.hasMileageRule && mileageInfo.isMileageDue && mileageInfo.targetKm) {
    const overKm = mileageInfo.latestKm - mileageInfo.targetKm;
    return {
      status: overKm > 0 ? "overdue" : "due-today",
      daysRemaining: schedule.nextPmDate
        ? diffDaysBetweenYmd(schedule.nextPmDate, todayYmd)
        : 0,
      label:
        overKm > 0
          ? `ครบกำหนดไมล์ (เกิน ${overKm.toLocaleString()} กม.)`
          : `ครบรอบไมล์ต้อง PM (${mileageInfo.latestKm.toLocaleString()}/${mileageInfo.targetKm.toLocaleString()} กม.)`,
      isTriggeredByMileage: true,
    };
  }

  // 2. Check Date PM if nextPmDate is set
  if (schedule.nextPmDate && schedule.nextPmDate.trim()) {
    const daysRemaining = diffDaysBetweenYmd(schedule.nextPmDate, todayYmd);
    const warnWindow = Math.max(1, schedule.warningDaysBefore || 7);

    if (daysRemaining < 0) {
      return {
        status: "overdue",
        daysRemaining,
        label: `เกินกำหนด ${Math.abs(daysRemaining)} วัน`,
        isTriggeredByMileage: false,
      };
    }
    if (daysRemaining === 0) {
      return {
        status: "due-today",
        daysRemaining: 0,
        label: "ครบกำหนดวันนี้",
        isTriggeredByMileage: false,
      };
    }
    if (daysRemaining <= warnWindow) {
      return {
        status: "due-soon",
        daysRemaining,
        label: `อีก ${daysRemaining} วัน`,
        isTriggeredByMileage: false,
      };
    }
    if (mileageInfo.hasMileageRule && mileageInfo.isMileageSoon && mileageInfo.kmRemaining !== undefined) {
      return {
        status: "due-soon",
        daysRemaining,
        label: `ใกล้ครบไมล์ (อีก ${mileageInfo.kmRemaining.toLocaleString()} กม.)`,
        isTriggeredByMileage: true,
      };
    }
    return {
      status: "normal",
      daysRemaining,
      label: `อีก ${daysRemaining} วัน`,
      isTriggeredByMileage: false,
    };
  }

  // 3. Mileage-only schedule (no nextPmDate set)
  if (mileageInfo.hasMileageRule && mileageInfo.targetKm !== undefined) {
    const rem = mileageInfo.kmRemaining ?? 0;
    if (mileageInfo.isMileageSoon) {
      return {
        status: "due-soon",
        daysRemaining: null,
        label: `ใกล้ครบไมล์ (อีก ${rem.toLocaleString()} กม.)`,
        isTriggeredByMileage: true,
      };
    }
    return {
      status: "normal",
      daysRemaining: null,
      label: `อีก ${rem.toLocaleString()} กม. ถึงรอบ PM`,
      isTriggeredByMileage: true,
    };
  }

  return {
    status: "normal",
    daysRemaining: null,
    label: "ปกติ",
    isTriggeredByMileage: false,
  };
}

export function PmScheduleManagement({ vehicles, employees = [] }: PmScheduleManagementProps) {
  const { currentUser } = useAuth();
  const [schedules, setSchedules] = useState<MhPmScheduleRecord[]>([]);
  const [preStartInspections, setPreStartInspections] = useState<MhPreStartInspectionRecord[]>([]);
  const [cloudRealtime, setCloudRealtime] = useState<boolean>(() =>
    getForkliftCloudRealtimeEnabled()
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [headingPortalTarget, setHeadingPortalTarget] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("page-heading-actions") : null
  );

  // Navigation & Filters
  const [activeTab, setActiveTab] = useState<PmTabMode>("table");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<string>("All");
  const [healthFilter, setHealthFilter] = useState<string>("All");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");

  // Calendar State
  const todayYmd = getTodayYmd();
  const initialDate = useMemo(() => new Date(), []);
  const [calendarYear, setCalendarYear] = useState<number>(initialDate.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(initialDate.getMonth());
  const [selectedDateYmd, setSelectedDateYmd] = useState<string>(todayYmd);
  const [showProjectedCycles, setShowProjectedCycles] = useState<boolean>(true);

  // Add / Edit Schedule Modal State
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [formVehicleId, setFormVehicleId] = useState<string>("");
  const [formPmTitle, setFormPmTitle] = useState<string>("");
  const [formPmCategory, setFormPmCategory] = useState<string>(MH_PM_CATEGORIES[0]);
  const [formCycleDays, setFormCycleDays] = useState<string>("");
  const [formCycleMileageKm, setFormCycleMileageKm] = useState<string>("300");
  const [formStartMileageKm, setFormStartMileageKm] = useState<string>("0");
  const [formTargetMileageKm, setFormTargetMileageKm] = useState<string>("300");
  const [formCycleHours, setFormCycleHours] = useState<string>("");
  const [formCurrentHours, setFormCurrentHours] = useState<string>("");
  const [formLastPmDate, setFormLastPmDate] = useState<string>(todayYmd);
  const [formNextPmDate, setFormNextPmDate] = useState<string>("");
  const [formWarningDays, setFormWarningDays] = useState<number>(7);
  const [formResponsibleTech, setFormResponsibleTech] = useState<string>("ทีมช่างซ่อมบำรุง");
  const [formChecklistSummary, setFormChecklistSummary] = useState<string>(
    "ตรวจระดับน้ำมันเครื่อง/ไฮดรอลิค, ระบบเบรค, ยางและล้อ, แบตเตอรี่/ระบบไฟ, อัดจาระบีจุดหมุน"
  );
  const [formEstimatedCost, setFormEstimatedCost] = useState<string>("");
  const [formScheduleStatus, setFormScheduleStatus] = useState<"Active" | "Paused">("Active");
  const [formNotes, setFormNotes] = useState<string>("");
  const [formError, setFormError] = useState<string>("");

  // Complete PM Modal State
  const [completingSchedule, setCompletingSchedule] = useState<MhPmScheduleRecord | null>(null);
  const [completeDate, setCompleteDate] = useState<string>(todayYmd);
  const [completePerformedBy, setCompletePerformedBy] = useState<string>(
    () => currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || ""
  );
  const [completeMileageKm, setCompleteMileageKm] = useState<string>("");
  const [completeOperatingHours, setCompleteOperatingHours] = useState<string>("");
  const [completeCost, setCompleteCost] = useState<string>("");
  const [completeNotes, setCompleteNotes] = useState<string>("");

  // Batch Auto-Setup Missing Vehicles Modal State
  const [isBatchModalOpen, setIsBatchModalOpen] = useState<boolean>(false);
  const [batchCycleDays, setBatchCycleDays] = useState<number>(90);
  const [batchCategory, setBatchCategory] = useState<string>(MH_PM_CATEGORIES[0]);
  const [batchLastPmDate, setBatchLastPmDate] = useState<string>(todayYmd);
  const [batchTech, setBatchTech] = useState<string>("ทีมช่างซ่อมบำรุง");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Delete Confirmation Modal State
  const [deleteTarget, setDeleteTarget] = useState<MhPmScheduleRecord | null>(null);

  // Inline Status Banner Feedback
  const [statusFeedback, setStatusFeedback] = useState<{
    type: "success" | "info";
    text: string;
  } | null>(null);

  useEffect(() => {
    setHeadingPortalTarget(document.getElementById("page-heading-actions"));
  }, []);

  useEffect(() => {
    const unsubMode = subscribeForkliftCloudRealtimeMode((enabled) => {
      setCloudRealtime(enabled);
    });
    return () => unsubMode();
  }, []);

  useEffect(() => {
    const unsubPm = subscribeToMhPmSchedules((cloudRecords) => {
      setSchedules(cloudRecords);
    });
    const unsubInsp = subscribeToMhPreStartInspections((inspRecords) => {
      setPreStartInspections(inspRecords);
    });
    return () => {
      unsubPm();
      unsubInsp();
    };
  }, [cloudRealtime]);

  useEffect(() => {
    if (!statusFeedback) return;
    const t = setTimeout(() => setStatusFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [statusFeedback]);

  const handleManualReload = async () => {
    setIsRefreshing(true);
    try {
      const [latestPm, latestInsp] = await Promise.all([
        fetchMhPmSchedulesOnce(),
        fetchMhPreStartInspectionsOnce(),
      ]);
      setSchedules(latestPm);
      setPreStartInspections(latestInsp);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Map each vehicleId -> latest mileage reading from Pre-Start Daily Inspection
  const latestMileageByVehicle = useMemo(() => {
    const map = new Map<
      string,
      { mileageKm: number; inspectionDate: string; operatorName: string }
    >();
    preStartInspections.forEach((ins) => {
      const vKey = String(ins.vehicleId || "").trim().toUpperCase();
      if (!vKey) return;
      const km = typeof ins.mileageKm === "number" ? ins.mileageKm : Number(ins.operatingHours) || 0;
      const cur = map.get(vKey);
      if (
        !cur ||
        km > cur.mileageKm ||
        (km === cur.mileageKm && (ins.inspectionDate || "") > cur.inspectionDate)
      ) {
        map.set(vKey, {
          mileageKm: km,
          inspectionDate: ins.inspectionDate || getTodayYmd(),
          operatorName: ins.operatorName || "-",
        });
      }
    });
    return map;
  }, [preStartInspections]);

  // Unscheduled active vehicles from fleet master
  const unscheduledVehicles = useMemo(() => {
    const scheduledIds = new Set(schedules.map((s) => s.vehicleId.trim().toUpperCase()));
    return vehicles.filter(
      (v) =>
        v.activeStatus !== "Inactive" &&
        !scheduledIds.has(String(v.vehicleId || "").trim().toUpperCase())
    );
  }, [vehicles, schedules]);

  const vehicleTypes = useMemo(() => {
    const set = new Set<string>();
    vehicles.forEach((v) => v.vehicleType && set.add(v.vehicleType));
    schedules.forEach((s) => s.vehicleType && set.add(s.vehicleType));
    return Array.from(set);
  }, [vehicles, schedules]);

  const technicianSuggestions = useMemo(() => {
    const names = new Set<string>(["ทีมช่างซ่อมบำรุง", "ผู้รับเหมาภายนอก (Vendor)"]);
    employees.forEach((emp) => {
      if (emp.employmentStatus === "Active" && emp.employeeName) {
        names.add(emp.employeeName);
      }
    });
    return Array.from(names);
  }, [employees]);

  // Enrich schedules with computed health status and live mileage from Pre-Start Inspection
  const enrichedSchedules = useMemo(() => {
    return schedules.map((sch) => {
      const vKey = sch.vehicleId.trim().toUpperCase();
      const latestReading = latestMileageByVehicle.get(vKey);
      const mileageInfo = computePmMileageInfo(sch, latestReading);
      const health = getPmHealth(sch, todayYmd, mileageInfo);
      return {
        schedule: sch,
        health,
        mileageInfo,
        latestReading,
      };
    });
  }, [schedules, latestMileageByVehicle, todayYmd]);

  // KPI Metrics
  const kpiMetrics = useMemo(() => {
    let overdueCount = 0;
    let dueSoonCount = 0;
    let normalCount = 0;
    let completedThisMonth = 0;
    let mileageDueCount = 0;
    const currentMonthPrefix = todayYmd.slice(0, 7);

    enrichedSchedules.forEach(({ schedule, health, mileageInfo }) => {
      if (mileageInfo.isMileageDue) mileageDueCount += 1;
      if (health.status === "overdue") overdueCount += 1;
      else if (health.status === "due-today" || health.status === "due-soon") dueSoonCount += 1;
      else if (health.status === "normal") normalCount += 1;

      if (Array.isArray(schedule.history)) {
        schedule.history.forEach((h) => {
          if (String(h.completedDate || "").startsWith(currentMonthPrefix)) {
            completedThisMonth += 1;
          }
        });
      }
    });

    return {
      totalScheduled: schedules.length,
      overdueCount,
      dueSoonCount,
      normalCount,
      completedThisMonth,
      mileageDueCount,
    };
  }, [enrichedSchedules, schedules.length, todayYmd]);

  // Filtered list for Schedule Table
  const filteredSchedules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedSchedules.filter(({ schedule, health }) => {
      if (q) {
        const hay = [
          schedule.vehicleId,
          schedule.vehicleType,
          schedule.vehicleDescription,
          schedule.pmTitle,
          schedule.pmCategory,
          schedule.responsibleTech,
          schedule.checklistSummary,
          schedule.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (vehicleTypeFilter !== "All" && schedule.vehicleType !== vehicleTypeFilter) {
        return false;
      }

      if (categoryFilter !== "All" && schedule.pmCategory !== categoryFilter) {
        return false;
      }

      if (healthFilter === "overdue" && health.status !== "overdue") return false;
      if (
        healthFilter === "due-soon" &&
        health.status !== "due-today" &&
        health.status !== "due-soon"
      ) {
        return false;
      }
      if (healthFilter === "normal" && health.status !== "normal") return false;
      if (healthFilter === "paused" && health.status !== "paused") return false;

      return true;
    });
  }, [enrichedSchedules, searchQuery, vehicleTypeFilter, healthFilter, categoryFilter]);

  // Aggregated PM Completion History
  const allHistoryRows = useMemo(() => {
    const rows: Array<{
      entry: MhPmHistoryEntry;
      schedule: MhPmScheduleRecord;
    }> = [];
    schedules.forEach((sch) => {
      (sch.history || []).forEach((h) => {
        rows.push({ entry: h, schedule: sch });
      });
    });
    rows.sort((a, b) => (b.entry.completedDate || "").localeCompare(a.entry.completedDate || ""));
    const q = searchQuery.trim().toLowerCase();
    return rows.filter(({ entry, schedule }) => {
      if (vehicleTypeFilter !== "All" && schedule.vehicleType !== vehicleTypeFilter) {
        return false;
      }
      if (categoryFilter !== "All" && schedule.pmCategory !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [
        schedule.vehicleId,
        schedule.vehicleType,
        schedule.pmCategory,
        entry.performedBy,
        entry.notes,
        entry.completedDate,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [schedules, searchQuery, vehicleTypeFilter, categoryFilter]);

  // Calendar Grid Calculations & Event Projection
  const monthPrefix = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}`;

  const calendarEventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    const pushEvent = (dateYmd: string, item: CalendarEventItem) => {
      if (!dateYmd) return;
      const arr = map.get(dateYmd) || [];
      arr.push(item);
      map.set(dateYmd, arr);
    };

    const monthStart = `${monthPrefix}-01`;
    const lastDayOfMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const monthEnd = `${monthPrefix}-${String(lastDayOfMonth).padStart(2, "0")}`;

    enrichedSchedules.forEach(({ schedule, health, mileageInfo }) => {
      // 1A. Mileage-triggered PM event on the inspection date (or today) when mileage reached targetKm
      if (
        schedule.scheduleStatus === "Active" &&
        mileageInfo.hasMileageRule &&
        mileageInfo.isMileageDue &&
        mileageInfo.mileageDueDateYmd
      ) {
        pushEvent(mileageInfo.mileageDueDateYmd, {
          key: `mileage-due-${schedule.id}-${mileageInfo.mileageDueDateYmd}`,
          schedule,
          dateYmd: mileageInfo.mileageDueDateYmd,
          kind: "mileage-due",
          label: `รถ ${schedule.vehicleId} ครบรอบต้อง PM แล้ว (${mileageInfo.latestKm.toLocaleString()}/${mileageInfo.targetKm?.toLocaleString()} กม.)`,
          mileageNote: `เลขไมล์ล่าสุด ${mileageInfo.latestKm.toLocaleString()} กม. ถึงกำหนด PM ที่ตั้งไว้ ${mileageInfo.targetKm?.toLocaleString()} กม.`,
        });
      }

      // 1B. Primary nextPmDate event (if date-based schedule is set)
      if (schedule.scheduleStatus === "Active" && schedule.nextPmDate) {
        let kind: CalendarEventItem["kind"] = "due";
        if (health.status === "overdue" && !health.isTriggeredByMileage) kind = "overdue";
        else if (
          (health.status === "due-today" || health.status === "due-soon") &&
          !health.isTriggeredByMileage
        ) {
          kind = "due-soon";
        }

        // Avoid duplicate card on the exact same day if already added as mileage-due
        if (
          !(
            mileageInfo.isMileageDue &&
            mileageInfo.mileageDueDateYmd === schedule.nextPmDate
          )
        ) {
          pushEvent(schedule.nextPmDate, {
            key: `due-${schedule.id}-${schedule.nextPmDate}`,
            schedule,
            dateYmd: schedule.nextPmDate,
            kind,
            label: `${schedule.vehicleId} · ${schedule.pmCategory}`,
          });
        }

        // 2. Projected recurring cycles within the currently displayed month
        if (showProjectedCycles && schedule.cycleDays && schedule.cycleDays >= 1) {
          let cursorDate = schedule.nextPmDate;
          let guard = 0;
          while (cursorDate < monthEnd && guard < 40) {
            guard += 1;
            cursorDate = computeNextPmDate(cursorDate, schedule.cycleDays);
            if (cursorDate > monthEnd) break;
            if (cursorDate >= monthStart && cursorDate !== schedule.nextPmDate) {
              pushEvent(cursorDate, {
                key: `proj-${schedule.id}-${cursorDate}`,
                schedule,
                dateYmd: cursorDate,
                kind: "projected",
                label: `${schedule.vehicleId} (รอบถัดไปคาดการณ์)`,
              });
            }
          }
        }
      }

      // 3. Completed history markers in the calendar
      (schedule.history || []).forEach((h) => {
        if (h.completedDate && h.completedDate.startsWith(monthPrefix)) {
          pushEvent(h.completedDate, {
            key: `done-${schedule.id}-${h.id}`,
            schedule,
            dateYmd: h.completedDate,
            kind: "completed",
            label: `${schedule.vehicleId} (ทำ PM แล้ว)`,
          });
        }
      });
    });

    return map;
  }, [enrichedSchedules, calendarYear, calendarMonth, monthPrefix, showProjectedCycles]);

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const cells: Array<{ dateYmd: string | null; dayNumber: number | null }> = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ dateYmd: null, dayNumber: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${monthPrefix}-${String(d).padStart(2, "0")}`;
      cells.push({ dateYmd: ymd, dayNumber: d });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateYmd: null, dayNumber: null });
    }
    return cells;
  }, [calendarYear, calendarMonth, monthPrefix]);

  const selectedDayEvents = useMemo(
    () => calendarEventsByDate.get(selectedDateYmd) || [],
    [calendarEventsByDate, selectedDateYmd]
  );

  const overdueList = useMemo(
    () =>
      enrichedSchedules.filter(
        ({ health, mileageInfo }) =>
          health.status === "overdue" || mileageInfo.isMileageDue
      ),
    [enrichedSchedules]
  );

  // Modal Openers
  const openCreateModal = (presetDueDate?: string) => {
    const defaultVeh = unscheduledVehicles[0] || vehicles[0];
    const defaultVehId = defaultVeh?.vehicleId || "";
    const latestReading = latestMileageByVehicle.get(defaultVehId.trim().toUpperCase());
    const initStartKm = latestReading?.mileageKm ?? 0;

    setEditingScheduleId(null);
    setFormVehicleId(defaultVehId);
    setFormPmCategory(MH_PM_CATEGORIES[0]);
    setFormPmTitle("ตรวจเช็ค PM ตามระยะ");
    setFormCycleDays("");
    setFormCycleMileageKm("300");
    setFormStartMileageKm(String(initStartKm));
    setFormTargetMileageKm(String(initStartKm + 300));
    setFormCycleHours("");
    setFormCurrentHours("");
    if (presetDueDate) {
      setFormLastPmDate(todayYmd);
      setFormNextPmDate(presetDueDate);
    } else {
      setFormLastPmDate(todayYmd);
      setFormNextPmDate("");
    }
    setFormWarningDays(7);
    setFormResponsibleTech("ทีมช่างซ่อมบำรุง");
    setFormChecklistSummary(
      "ตรวจระดับน้ำมันเครื่อง/ไฮดรอลิค, ระบบเบรค, ยางและล้อ, แบตเตอรี่/ระบบไฟ, อัดจาระบีจุดหมุน"
    );
    setFormEstimatedCost("");
    setFormScheduleStatus("Active");
    setFormNotes("");
    setFormError("");
    setIsFormModalOpen(true);
  };

  const openEditModal = (sch: MhPmScheduleRecord) => {
    const latestReading = latestMileageByVehicle.get(sch.vehicleId.trim().toUpperCase());
    const startKm =
      sch.startMileageKm !== undefined
        ? sch.startMileageKm
        : latestReading?.mileageKm ?? 0;
    const cycleKm = sch.cycleMileageKm;
    const targetKm =
      sch.targetMileageKm !== undefined
        ? sch.targetMileageKm
        : cycleKm
        ? startKm + cycleKm
        : undefined;

    setEditingScheduleId(sch.id);
    setFormVehicleId(sch.vehicleId);
    setFormPmTitle(sch.pmTitle || "");
    setFormPmCategory(sch.pmCategory || MH_PM_CATEGORIES[0]);
    setFormCycleDays(sch.cycleDays ? String(sch.cycleDays) : "");
    setFormCycleMileageKm(cycleKm !== undefined ? String(cycleKm) : "");
    setFormStartMileageKm(String(startKm));
    setFormTargetMileageKm(targetKm !== undefined ? String(targetKm) : "");
    setFormCycleHours(sch.cycleHours ? String(sch.cycleHours) : "");
    setFormCurrentHours(sch.currentHours !== undefined ? String(sch.currentHours) : "");
    setFormLastPmDate(sch.lastPmDate || todayYmd);
    setFormNextPmDate(sch.nextPmDate || "");
    setFormWarningDays(sch.warningDaysBefore || 7);
    setFormResponsibleTech(sch.responsibleTech || "ทีมช่างซ่อมบำรุง");
    setFormChecklistSummary(sch.checklistSummary || "");
    setFormEstimatedCost(sch.estimatedCost !== undefined ? String(sch.estimatedCost) : "");
    setFormScheduleStatus(sch.scheduleStatus || "Active");
    setFormNotes(sch.notes || "");
    setFormError("");
    setIsFormModalOpen(true);
  };

  const handleVehicleSelectChange = (newVehId: string) => {
    setFormVehicleId(newVehId);
    const reading = latestMileageByVehicle.get(newVehId.trim().toUpperCase());
    const startKm = reading?.mileageKm ?? 0;
    setFormStartMileageKm(String(startKm));
    const cyc = Number(formCycleMileageKm) || 0;
    if (cyc > 0) {
      setFormTargetMileageKm(String(startKm + cyc));
    }
  };

  const handleLastPmDateOrCycleChange = (newLastDate: string, newCycleDaysStr: string) => {
    setFormLastPmDate(newLastDate);
    setFormCycleDays(newCycleDaysStr);
    const parsedDays = Number(newCycleDaysStr);
    if (newLastDate && !isNaN(parsedDays) && parsedDays >= 1) {
      setFormNextPmDate(computeNextPmDate(newLastDate, parsedDays));
    } else if (!newCycleDaysStr.trim()) {
      setFormNextPmDate("");
    }
  };

  const handleMileageCycleOrStartChange = (newStartStr: string, newCycleStr: string) => {
    setFormStartMileageKm(newStartStr);
    setFormCycleMileageKm(newCycleStr);
    const s = Math.max(0, Number(newStartStr) || 0);
    const c = Math.max(0, Number(newCycleStr) || 0);
    if (c > 0) {
      setFormTargetMileageKm(String(s + c));
    } else {
      setFormTargetMileageKm("");
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanVehicleId = formVehicleId.trim();
    if (!cleanVehicleId) {
      setFormError("กรุณาเลือกรถหรือระบุรหัสรถที่ต้องการกำหนดรอบ PM");
      return;
    }

    const parsedCycleDays = formCycleDays.trim()
      ? Math.max(1, Math.min(3650, Math.round(Number(formCycleDays) || 0)))
      : undefined;
    const parsedCycleMileageKm = formCycleMileageKm.trim()
      ? Math.max(1, Math.round(Number(formCycleMileageKm) || 0))
      : undefined;
    const parsedStartMileageKm = formStartMileageKm.trim()
      ? Math.max(0, Math.round(Number(formStartMileageKm) || 0))
      : 0;
    const parsedTargetMileageKm = formTargetMileageKm.trim()
      ? Math.max(1, Math.round(Number(formTargetMileageKm) || 0))
      : parsedCycleMileageKm
      ? parsedStartMileageKm + parsedCycleMileageKm
      : undefined;

    const cleanNextPmDate = formNextPmDate.trim()
      ? formNextPmDate.trim()
      : parsedCycleDays
      ? computeNextPmDate(formLastPmDate || todayYmd, parsedCycleDays)
      : undefined;

    if (!parsedCycleDays && !cleanNextPmDate && !parsedTargetMileageKm) {
      setFormError("กรุณากำหนดรอบ PM อย่างน้อย 1 รูปแบบ (รอบจำนวนวัน, วันครบกำหนด หรือ ระยะเลขไมล์ กม.)");
      return;
    }

    setIsSaving(true);
    try {
      const matchedVehicle = vehicles.find(
        (v) => v.vehicleId.trim().toUpperCase() === cleanVehicleId.toUpperCase()
      );
      const existing = editingScheduleId
        ? schedules.find((s) => s.id === editingScheduleId)
        : undefined;
      const latestReading = latestMileageByVehicle.get(cleanVehicleId.toUpperCase());
      const currentKm = latestReading?.mileageKm ?? existing?.currentMileageKm;
      const isAlreadyReached =
        parsedTargetMileageKm !== undefined &&
        currentKm !== undefined &&
        currentKm >= parsedTargetMileageKm;

      const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19);

      const record: MhPmScheduleRecord = {
        id: existing?.id || `PM_${cleanVehicleId.replace(/[^a-zA-Z0-9_\-]/g, "_")}_${Date.now().toString().slice(-4)}`,
        vehicleId: matchedVehicle?.vehicleId || cleanVehicleId,
        vehicleNumber: matchedVehicle?.number || matchedVehicle?.vehicleId || cleanVehicleId,
        vehicleType: matchedVehicle?.vehicleType || existing?.vehicleType || "Forklift",
        vehicleDescription: matchedVehicle?.description || existing?.vehicleDescription || "",
        pmTitle: formPmTitle.trim() || formPmCategory,
        pmCategory: formPmCategory,
        cycleDays: parsedCycleDays,
        cycleHours: formCycleHours ? Math.max(0, Number(formCycleHours)) : undefined,
        currentHours: formCurrentHours ? Math.max(0, Number(formCurrentHours)) : undefined,
        cycleMileageKm: parsedCycleMileageKm,
        startMileageKm: parsedTargetMileageKm !== undefined ? parsedStartMileageKm : undefined,
        targetMileageKm: parsedTargetMileageKm,
        currentMileageKm: currentKm,
        mileageDueDate: isAlreadyReached
          ? existing?.mileageDueDate || latestReading?.inspectionDate || todayYmd
          : undefined,
        lastPmDate: formLastPmDate || todayYmd,
        nextPmDate: cleanNextPmDate,
        warningDaysBefore: Math.max(1, Math.min(90, Math.round(Number(formWarningDays) || 7))),
        responsibleTech: formResponsibleTech.trim() || "ทีมช่างซ่อมบำรุง",
        checklistSummary: formChecklistSummary.trim() || undefined,
        estimatedCost: formEstimatedCost ? Math.max(0, Number(formEstimatedCost)) : undefined,
        scheduleStatus: formScheduleStatus,
        notes: formNotes.trim() || undefined,
        history: existing?.history || [],
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      setSchedules((prev) => [record, ...prev.filter((item) => item.id !== record.id)]);
      setIsFormModalOpen(false);
      await saveMhPmScheduleToCloud(record);

      const summaryParts: string[] = [];
      if (record.targetMileageKm) {
        summaryParts.push(`ครบกำหนดที่ไมล์ ${record.targetMileageKm.toLocaleString()} กม.`);
      }
      if (record.nextPmDate) {
        summaryParts.push(`วันที่ ${formatThaiShortDate(record.nextPmDate)}`);
      }

      setStatusFeedback({
        type: "success",
        text: `${existing ? "อัปเดต" : "เพิ่ม"}กำหนดการ PM รถ ${record.vehicleId} (${summaryParts.join(" · ") || "บันทึกสำเร็จ"}) เรียบร้อยแล้ว`,
      });

      void appendWmsActivityLog({
        module: "PM Schedule",
        sectionId: "fleet_ops",
        reference: record.vehicleId,
        activity: `${existing ? "แก้ไข" : "กำหนด"}รอบ PM ${record.vehicleId} (${record.pmCategory}${record.targetMileageKm ? `, ไมล์ครบกำหนด ${record.targetMileageKm} กม.` : ""}${record.nextPmDate ? `, วันครบกำหนด ${record.nextPmDate}` : ""})`,
        status: "Completed",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openCompletePmModal = (sch: MhPmScheduleRecord, defaultDate?: string) => {
    const latestReading = latestMileageByVehicle.get(sch.vehicleId.trim().toUpperCase());
    const currentKm = latestReading?.mileageKm ?? sch.currentMileageKm ?? sch.targetMileageKm;
    setCompletingSchedule(sch);
    setCompleteDate(defaultDate || todayYmd);
    setCompletePerformedBy(
      currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || sch.responsibleTech
    );
    setCompleteMileageKm(currentKm !== undefined ? String(currentKm) : "");
    setCompleteOperatingHours(sch.currentHours !== undefined ? String(sch.currentHours) : "");
    setCompleteCost(sch.estimatedCost !== undefined ? String(sch.estimatedCost) : "");
    setCompleteNotes("");
  };

  const handleConfirmCompletePm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingSchedule) return;
    setIsSaving(true);
    try {
      const doneDate = completeDate || todayYmd;
      const newNextDate = completingSchedule.cycleDays
        ? computeNextPmDate(doneDate, completingSchedule.cycleDays)
        : undefined;
      const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19);
      const parsedMileage = completeMileageKm.trim()
        ? Math.max(0, Math.round(Number(completeMileageKm) || 0))
        : completingSchedule.currentMileageKm;
      const parsedHours = completeOperatingHours ? Math.max(0, Number(completeOperatingHours)) : undefined;
      const parsedCost = completeCost ? Math.max(0, Number(completeCost)) : undefined;

      const newStartKm = parsedMileage ?? completingSchedule.targetMileageKm ?? completingSchedule.startMileageKm ?? 0;
      const newTargetKm = completingSchedule.cycleMileageKm
        ? newStartKm + completingSchedule.cycleMileageKm
        : completingSchedule.targetMileageKm;

      const newHistoryEntry: MhPmHistoryEntry = {
        id: `PMH-${Date.now()}`,
        completedDate: doneDate,
        previousDueDate: completingSchedule.nextPmDate,
        nextDueDate: newNextDate,
        performedBy: completePerformedBy.trim() || "ทีมช่างซ่อมบำรุง",
        operatingHours: parsedHours,
        mileageKm: parsedMileage,
        cost: parsedCost,
        notes: completeNotes.trim() || undefined,
        recordedAt: nowIso,
      };

      const updatedRecord: MhPmScheduleRecord = {
        ...completingSchedule,
        lastPmDate: doneDate,
        nextPmDate: newNextDate,
        startMileageKm: completingSchedule.cycleMileageKm ? newStartKm : completingSchedule.startMileageKm,
        targetMileageKm: newTargetKm,
        currentMileageKm: parsedMileage,
        mileageDueDate: undefined,
        currentHours: parsedHours !== undefined ? parsedHours : completingSchedule.currentHours,
        history: [newHistoryEntry, ...(completingSchedule.history || [])].slice(0, 40),
        updatedAt: nowIso,
      };

      setSchedules((prev) =>
        prev.map((item) => (item.id === updatedRecord.id ? updatedRecord : item))
      );
      setCompletingSchedule(null);
      await saveMhPmScheduleToCloud(updatedRecord);

      setStatusFeedback({
        type: "success",
        text: `บันทึกการทำ PM รถ ${updatedRecord.vehicleId} สำเร็จ${
          newTargetKm ? ` · รอบไมล์ถัดไป: ${newTargetKm.toLocaleString()} กม.` : ""
        }${newNextDate ? ` · วันครบกำหนดถัดไป: ${formatThaiShortDate(newNextDate)}` : ""}`,
      });

      void appendWmsActivityLog({
        module: "PM Schedule",
        sectionId: "fleet_ops",
        reference: updatedRecord.vehicleId,
        activity: `บันทึกทำ PM รถ ${updatedRecord.vehicleId} วันที่ ${doneDate}${parsedMileage !== undefined ? ` (เลขไมล์ ${parsedMileage} กม.)` : ""}`,
        status: "Completed",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBatchSetupMissingVehicles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (unscheduledVehicles.length === 0) {
      setIsBatchModalOpen(false);
      return;
    }
    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19);
      const safeDays = Math.max(1, Math.min(3650, Math.round(Number(batchCycleDays) || 90)));
      const nextDate = computeNextPmDate(batchLastPmDate || todayYmd, safeDays);

      const batchRecords: MhPmScheduleRecord[] = unscheduledVehicles.map((v, idx) => ({
        id: `PM_${String(v.vehicleId).replace(/[^a-zA-Z0-9_\-]/g, "_")}_${Date.now().toString().slice(-4)}_${idx}`,
        vehicleId: v.vehicleId,
        vehicleNumber: v.number || v.vehicleId,
        vehicleType: v.vehicleType || "Forklift",
        vehicleDescription: v.description || "",
        pmTitle: batchCategory,
        pmCategory: batchCategory,
        cycleDays: safeDays,
        lastPmDate: batchLastPmDate || todayYmd,
        nextPmDate: nextDate,
        warningDaysBefore: 7,
        responsibleTech: batchTech.trim() || "ทีมช่างซ่อมบำรุง",
        checklistSummary:
          "ตรวจระดับน้ำมันเครื่อง/ไฮดรอลิค, ระบบเบรค, ยางและล้อ, แบตเตอรี่/ระบบไฟ, อัดจาระบีจุดหมุน",
        scheduleStatus: "Active",
        history: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      }));

      setSchedules((prev) => [...batchRecords, ...prev]);
      setIsBatchModalOpen(false);
      await saveMhPmSchedulesBatchToCloud(batchRecords);

      setStatusFeedback({
        type: "success",
        text: `สร้างกำหนดการ PM ให้รถ ${batchRecords.length} คันเรียบร้อยแล้ว`,
      });

      void appendWmsActivityLog({
        module: "PM Schedule",
        sectionId: "fleet_ops",
        reference: `BATCH-${batchRecords.length}`,
        activity: `ตั้งค่ารอบ PM อัตโนมัติสำหรับรถ ${batchRecords.length} คัน (ทุก ${safeDays} วัน)`,
        status: "Completed",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setSchedules((prev) => prev.filter((item) => item.id !== target.id));
    setDeleteTarget(null);
    await deleteMhPmScheduleFromCloud(target.id);

    setStatusFeedback({
      type: "info",
      text: `ลบกำหนดการ PM ของรถ ${target.vehicleId} แล้ว`,
    });

    void appendWmsActivityLog({
      module: "PM Schedule",
      sectionId: "fleet_ops",
      reference: target.vehicleId,
      activity: `ลบกำหนดการ PM รถ ${target.vehicleId}`,
      status: "Completed",
    });
  };

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarYear((y) => y - 1);
      setCalendarMonth(11);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarYear((y) => y + 1);
      setCalendarMonth(0);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  };

  const handleJumpToday = () => {
    const now = new Date();
    setCalendarYear(now.getFullYear());
    setCalendarMonth(now.getMonth());
    setSelectedDateYmd(todayYmd);
  };

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    vehicleTypeFilter !== "All" ||
    healthFilter !== "All" ||
    categoryFilter !== "All";

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
        <span>{cloudRealtime ? "Cloud Real-time: ON" : "Cloud Real-time: OFF"}</span>
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

  const renderHealthBadge = (health: ReturnType<typeof getPmHealth>) => {
    if (health.status === "overdue") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 whitespace-nowrap">
          <AlertTriangle size={11} />
          {health.label}
        </span>
      );
    }
    if (health.status === "due-today") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700 whitespace-nowrap">
          <Clock size={11} />
          {health.label}
        </span>
      );
    }
    if (health.status === "due-soon") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 whitespace-nowrap">
          <Clock size={11} />
          ใกล้ครบกำหนด ({health.label})
        </span>
      );
    }
    if (health.status === "paused") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700 whitespace-nowrap">
          พักรอบชั่วคราว
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 whitespace-nowrap">
        <CheckCircle2 size={11} />
        ปกติ ({health.label})
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {headingPortalTarget ? createPortal(cloudSyncControls, headingPortalTarget) : null}

      {statusFeedback && (
        <div
          className={`px-4 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-between gap-3 ${
            statusFeedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200"
              : "bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-200"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 size={14} />
            {statusFeedback.text}
          </span>
          <button
            type="button"
            onClick={() => setStatusFeedback(null)}
            className="opacity-70 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="kpi-grid">
        <div className="kpi" style={{ borderTopColor: "#087eaf" }}>
          <div className="kpi-label">รถที่กำหนดรอบ PM แล้ว</div>
          <div className="kpi-value font-mono tabular-nums" style={{ color: "#087eaf" }}>
            {kpiMetrics.totalScheduled}{" "}
            <span style={{ fontSize: 13, fontWeight: 600 }}>คัน</span>
          </div>
          <div className="kpi-note">
            {unscheduledVehicles.length > 0
              ? `ยังไม่ได้กำหนดรอบ ${unscheduledVehicles.length} คัน`
              : `ครอบคลุมรถที่ใช้งานครบทุกคัน`}
          </div>
        </div>

        <div
          className="kpi"
          style={{ borderTopColor: kpiMetrics.overdueCount > 0 ? "#ef4444" : "#94a3b8" }}
        >
          <div className="kpi-label">เกินกำหนด PM (Overdue)</div>
          <div
            className="kpi-value font-mono tabular-nums"
            style={{ color: kpiMetrics.overdueCount > 0 ? "#ef4444" : "#64748b" }}
          >
            {kpiMetrics.overdueCount}{" "}
            <span style={{ fontSize: 13, fontWeight: 600 }}>คัน</span>
          </div>
          <div className="kpi-note">
            {kpiMetrics.overdueCount > 0 ? "ต้องเร่งดำเนินการ PM ทันที" : "ไม่มีรถเกินกำหนด"}
          </div>
        </div>

        <div
          className="kpi"
          style={{ borderTopColor: kpiMetrics.dueSoonCount > 0 ? "#f59e0b" : "#10b981" }}
        >
          <div className="kpi-label">ครบกำหนดวันนี้ / เร็วๆ นี้</div>
          <div
            className="kpi-value font-mono tabular-nums"
            style={{ color: kpiMetrics.dueSoonCount > 0 ? "#d97706" : "#10b981" }}
          >
            {kpiMetrics.dueSoonCount}{" "}
            <span style={{ fontSize: 13, fontWeight: 600 }}>คัน</span>
          </div>
          <div className="kpi-note">แจ้งเตือนล่วงหน้าตามรอบที่กำหนด</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#10b981" }}>
          <div className="kpi-label">ปกติ / ทำ PM แล้วเดือนนี้</div>
          <div className="kpi-value font-mono tabular-nums" style={{ color: "#10b981" }}>
            {kpiMetrics.normalCount}{" "}
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              คัน · ทำแล้ว {kpiMetrics.completedThisMonth} ครั้ง
            </span>
          </div>
          <div className="kpi-note">รอบบำรุงรักษาอยู่ในเกณฑ์พร้อมใช้งาน</div>
        </div>
      </div>

      {/* Main Panel */}
      <section className="panel">
        <div
          className="panel-header"
          style={{ padding: "14px 20px", gap: 12, flexWrap: "wrap", alignItems: "center" }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* View Tabs */}
            <div className="inline-flex rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-100/80 dark:bg-[#0a1628] p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("table")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeTab === "table"
                    ? "bg-white dark:bg-[#122646] text-[#087eaf] dark:text-sky-300 shadow-xs"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Table2 size={14} />
                ตารางกำหนดการ PM
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("calendar")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeTab === "calendar"
                    ? "bg-white dark:bg-[#122646] text-[#087eaf] dark:text-sky-300 shadow-xs"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <CalendarIcon size={14} />
                ปฏิทินวันครบกำหนด PM
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeTab === "history"
                    ? "bg-white dark:bg-[#122646] text-[#087eaf] dark:text-sky-300 shadow-xs"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <History size={14} />
                ประวัติการทำ PM ({allHistoryRows.length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {!headingPortalTarget && cloudSyncControls}
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="button primary whitespace-nowrap shrink-0"
            >
              <Plus size={14} />
              เพิ่มกำหนดการ PM
            </button>
          </div>
        </div>

        {/* Standard Filterbar (35px / 12px / borderRadius 6px / px-3 py-2.5 sm:px-[18px] sm:py-3) */}
        {activeTab !== "calendar" && (
          <div className="filterbar px-3 py-2.5 sm:px-[18px] sm:py-3 flex gap-3 flex-wrap items-center">
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Search
                size={14}
                className="modal-sub-text"
                style={{ position: "absolute", left: 10, top: 11 }}
              />
              <input
                type="text"
                placeholder="ค้นหารหัสรถ, ประเภท PM, ช่างผู้รับผิดชอบ หรือหมายเหตุ..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="field"
                style={{ width: "100%", ...STANDARD_SEARCH_STYLE }}
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter size={13} className="modal-sub-text shrink-0" />
              <select
                value={vehicleTypeFilter}
                onChange={(e) => setVehicleTypeFilter(e.target.value)}
                className="field"
                style={STANDARD_CONTROL_STYLE}
              >
                <option value="All">ประเภทรถ: ทั้งหมด</option>
                {vehicleTypes.map((vt) => (
                  <option key={vt} value={vt}>
                    {vt}
                  </option>
                ))}
              </select>
            </div>

            {activeTab === "table" && (
              <div className="flex items-center gap-2">
                <select
                  value={healthFilter}
                  onChange={(e) => setHealthFilter(e.target.value)}
                  className="field"
                  style={STANDARD_CONTROL_STYLE}
                >
                  <option value="All">สถานะ PM: ทั้งหมด</option>
                  <option value="overdue">เกินกำหนด (Overdue)</option>
                  <option value="due-soon">ครบกำหนด / ใกล้ครบกำหนด</option>
                  <option value="normal">ปกติ (อยู่ในรอบ)</option>
                  <option value="paused">พักรอบชั่วคราว</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="field"
                style={STANDARD_CONTROL_STYLE}
              >
                <option value="All">ประเภท PM: ทั้งหมด</option>
                {MH_PM_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setVehicleTypeFilter("All");
                  setHealthFilter("All");
                  setCategoryFilter("All");
                }}
                className="button secondary whitespace-nowrap"
                style={{ height: 35, minHeight: 35, fontSize: 12, borderRadius: 6 }}
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        )}

        {/* TAB 1: PM SCHEDULE TABLE */}
        {activeTab === "table" && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>รหัสรถ / ประเภท</th>
                    <th>รอบ &amp; ประเภท PM</th>
                    <th>การ PM ด้วยเลขไมล์ (ตรวจเช็ครถประจำวัน)</th>
                    <th>ทำ PM ล่าสุด</th>
                    <th>ครบกำหนดครั้งถัดไป</th>
                    <th>สถานะรอบ PM</th>
                    <th>ผู้รับผิดชอบ</th>
                    <th style={{ textAlign: "right" }}>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedules.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                        {schedules.length === 0 ? (
                          <div className="flex flex-col items-center gap-3">
                            <CalendarClock size={28} className="text-slate-400" />
                            <div>ยังไม่มีข้อมูลกำหนดการ PM ของรถในระบบ</div>
                            <div className="flex items-center gap-2 flex-wrap justify-center">
                              <button
                                type="button"
                                onClick={() => openCreateModal()}
                                className="button primary"
                              >
                                <Plus size={13} />
                                เพิ่มกำหนดการ PM คันแรก
                              </button>
                            </div>
                          </div>
                        ) : (
                          "ไม่พบรายการกำหนดการ PM ที่ตรงกับเงื่อนไขการค้นหา"
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredSchedules.map(({ schedule, health, mileageInfo, latestReading }) => (
                      <tr key={schedule.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="code font-bold text-[#087eaf] dark:text-sky-300">
                              {schedule.vehicleId}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              · {schedule.vehicleType}
                            </span>
                          </div>
                          {schedule.vehicleDescription && (
                            <div className="table-sub-text text-[11px] mt-0.5 max-w-[220px] truncate">
                              {schedule.vehicleDescription}
                            </div>
                          )}
                        </td>

                        <td>
                          <div className="table-item-name font-semibold text-xs">
                            {schedule.pmCategory}
                          </div>
                          <div className="table-sub-text text-[11px] mt-0.5 font-mono tabular-nums">
                            {schedule.cycleDays ? `ทุก ${schedule.cycleDays} วัน` : "ไม่กำหนดรอบวัน"}
                            {schedule.cycleMileageKm
                              ? ` · ทุก ${schedule.cycleMileageKm.toLocaleString()} กม.`
                              : ""}
                            {schedule.cycleHours ? ` · ทุก ${schedule.cycleHours} ชม.` : ""}
                          </div>
                          {schedule.checklistSummary && (
                            <div
                              className="table-sub-text text-[10px] mt-0.5 max-w-[240px] truncate"
                              title={schedule.checklistSummary}
                            >
                              {schedule.checklistSummary}
                            </div>
                          )}
                        </td>

                        <td>
                          {mileageInfo.hasMileageRule && mileageInfo.targetKm !== undefined ? (
                            <div className="space-y-1 min-w-[185px]">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-semibold text-slate-800 dark:text-slate-100 font-mono tabular-nums">
                                  ตั้ง PM ที่ {mileageInfo.targetKm.toLocaleString()} กม.
                                </span>
                                {mileageInfo.isMileageDue && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800">
                                    ครบไมล์ PM!
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                เลขไมล์ล่าสุด:{" "}
                                <strong
                                  className={
                                    mileageInfo.isMileageDue
                                      ? "text-rose-600 dark:text-rose-400"
                                      : mileageInfo.isMileageSoon
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-[#087eaf] dark:text-sky-300"
                                  }
                                >
                                  {`${mileageInfo.latestKm.toLocaleString()} กม.`}
                                </strong>
                                {mileageInfo.kmRemaining !== undefined && (
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-1">
                                    {mileageInfo.kmRemaining <= 0
                                      ? `(ถึงกำหนดแล้ว)`
                                      : `(เหลือ ${mileageInfo.kmRemaining.toLocaleString()} กม.)`}
                                  </span>
                                )}
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    mileageInfo.isMileageDue
                                      ? "bg-rose-500"
                                      : mileageInfo.isMileageSoon
                                      ? "bg-amber-500"
                                      : "bg-[#087eaf]"
                                  }`}
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      Math.max(
                                        0,
                                        Math.round(
                                          (mileageInfo.latestKm /
                                            Math.max(1, mileageInfo.targetKm)) *
                                            100
                                        )
                                      )
                                    )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : latestReading ? (
                            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              ไมล์ล่าสุด {latestReading.mileageKm.toLocaleString()} กม.
                              <div className="text-[10px]">ไม่ได้ตั้งรอบไมล์ PM</div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">-</span>
                          )}
                        </td>

                        <td>
                          <div className="table-item-name font-mono tabular-nums text-xs font-medium">
                            {formatThaiShortDate(schedule.lastPmDate)}
                          </div>
                          <div className="table-sub-text font-mono tabular-nums text-[10px]">
                            {schedule.lastPmDate}
                          </div>
                        </td>

                        <td>
                          {schedule.nextPmDate ? (
                            <>
                              <div
                                className={`font-mono tabular-nums text-xs font-bold ${
                                  health.status === "overdue"
                                    ? "text-rose-600 dark:text-rose-400"
                                    : health.status === "due-today" || health.status === "due-soon"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-slate-800 dark:text-slate-200"
                                }`}
                              >
                                {formatThaiShortDate(schedule.nextPmDate)}
                              </div>
                              <div className="table-sub-text font-mono tabular-nums text-[10px]">
                                {schedule.nextPmDate}
                              </div>
                            </>
                          ) : mileageInfo.isMileageDue && mileageInfo.mileageDueDateYmd ? (
                            <>
                              <div className="font-mono tabular-nums text-xs font-bold text-rose-600 dark:text-rose-400">
                                ครบรอบวันที่ {formatThaiShortDate(mileageInfo.mileageDueDateYmd)}
                              </div>
                              <div className="table-sub-text font-mono tabular-nums text-[10px] text-rose-600/80 dark:text-rose-300/80">
                                ตามเลขไมล์ {mileageInfo.targetKm?.toLocaleString()} กม.
                              </div>
                            </>
                          ) : mileageInfo.targetKm !== undefined ? (
                            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              เมื่อครบไมล์{" "}
                              <span className="font-mono font-bold text-[#087eaf] dark:text-sky-300">
                                {mileageInfo.targetKm.toLocaleString()} กม.
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>

                        <td>{renderHealthBadge(health)}</td>

                        <td>
                          <div className="table-item-name text-xs font-medium">
                            {schedule.responsibleTech || "-"}
                          </div>
                          {schedule.estimatedCost ? (
                            <div className="table-sub-text font-mono tabular-nums text-[10px]">
                              งบประมาณ ฿{schedule.estimatedCost.toLocaleString()}
                            </div>
                          ) : null}
                        </td>

                        <td style={{ textAlign: "right" }}>
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openCompletePmModal(schedule)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 whitespace-nowrap"
                              title="บันทึกการทำ PM และคำนวณรอบถัดไปอัตโนมัติ"
                            >
                              <CheckCircle2 size={12} />
                              บันทึกทำ PM
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(schedule)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-slate-200 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#132542]"
                              title="แก้ไขรอบ PM"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(schedule)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                              title="ลบกำหนดการ"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-[18px] py-3 border-t border-slate-200/80 dark:border-[#1e3a5f] flex items-center justify-between flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                แสดง {filteredSchedules.length} จาก {schedules.length} กำหนดการ PM
              </span>
              <button
                type="button"
                onClick={() => setActiveTab("calendar")}
                className="text-[#087eaf] dark:text-sky-300 font-semibold hover:underline inline-flex items-center gap-1"
              >
                <CalendarIcon size={12} />
                สลับดูในปฏิทินวันครบกำหนด PM →
              </button>
            </div>
          </>
        )}

        {/* TAB 2: INTERACTIVE PM CALENDAR */}
        {activeTab === "calendar" && (
          <div className="p-4 sm:p-5 space-y-4">
            {/* Calendar Controls Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="inline-flex items-center justify-center border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744]"
                  style={{ height: 35, width: 35, borderRadius: 6 }}
                  title="เดือนก่อนหน้า"
                >
                  <ChevronLeft size={16} />
                </button>

                <select
                  value={calendarMonth}
                  onChange={(e) => setCalendarMonth(Number(e.target.value))}
                  className="field"
                  style={STANDARD_CONTROL_STYLE}
                >
                  {THAI_MONTHS.map((mName, idx) => (
                    <option key={mName} value={idx}>
                      {mName}
                    </option>
                  ))}
                </select>

                <select
                  value={calendarYear}
                  onChange={(e) => setCalendarYear(Number(e.target.value))}
                  className="field"
                  style={STANDARD_CONTROL_STYLE}
                >
                  {Array.from({ length: 5 }, (_, i) => initialDate.getFullYear() - 1 + i).map(
                    (yr) => (
                      <option key={yr} value={yr}>
                        พ.ศ. {yr + 543} ({yr})
                      </option>
                    )
                  )}
                </select>

                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="inline-flex items-center justify-center border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744]"
                  style={{ height: 35, width: 35, borderRadius: 6 }}
                  title="เดือนถัดไป"
                >
                  <ChevronRight size={16} />
                </button>

                <button
                  type="button"
                  onClick={handleJumpToday}
                  className="button secondary"
                  style={{ height: 35, minHeight: 35, fontSize: 12, borderRadius: 6 }}
                >
                  วันนี้
                </button>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showProjectedCycles}
                    onChange={(e) => setShowProjectedCycles(e.target.checked)}
                    className="rounded border-slate-300 text-[#087eaf]"
                  />
                  <span>แสดงรอบ PM คาดการณ์ล่วงหน้าในเดือนถัดไป</span>
                </label>

                <div className="flex items-center gap-3 flex-wrap text-[11px]">
                  <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-600 inline-block" />
                    ครบรอบเลขไมล์ / เกินกำหนด
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
                    ใกล้ครบกำหนด
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" />
                    วันครบกำหนดรอบถัดไป
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm border border-dashed border-indigo-500 inline-block" />
                    คาดการณ์ล่วงหน้า
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                    ทำ PM แล้ว
                  </span>
                </div>
              </div>
            </div>

            {/* Grid + Day Details Layout */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 items-start">
              {/* Monthly Calendar Grid */}
              <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-lg overflow-hidden bg-white dark:bg-[#091528]">
                <div className="grid grid-cols-7 bg-slate-50 dark:bg-[#0d1d35] border-b border-slate-200 dark:border-[#1e3a5f]">
                  {THAI_WEEKDAYS.map((dayLabel, idx) => (
                    <div
                      key={dayLabel}
                      className={`py-2 text-center text-[11px] font-bold ${
                        idx === 0
                          ? "text-rose-600 dark:text-rose-400"
                          : idx === 6
                          ? "text-sky-700 dark:text-sky-300"
                          : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {dayLabel}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                  {calendarCells.map((cell, idx) => {
                    if (!cell.dateYmd || !cell.dayNumber) {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="min-h-[86px] sm:min-h-[98px] bg-slate-50/50 dark:bg-[#060f1e]"
                        />
                      );
                    }

                    const events = calendarEventsByDate.get(cell.dateYmd) || [];
                    const isToday = cell.dateYmd === todayYmd;
                    const isSelected = cell.dateYmd === selectedDateYmd;

                    return (
                      <button
                        type="button"
                        key={cell.dateYmd}
                        onClick={() => setSelectedDateYmd(cell.dateYmd!)}
                        className={`min-h-[86px] sm:min-h-[98px] p-1.5 text-left align-top flex flex-col gap-1 transition-colors ${
                          isSelected
                            ? "bg-sky-50/80 dark:bg-sky-950/40 ring-1 ring-inset ring-[#087eaf]"
                            : "hover:bg-slate-50 dark:hover:bg-[#0e1e36]"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className={`inline-flex items-center justify-center text-[11px] font-mono tabular-nums font-bold w-6 h-6 rounded-full ${
                              isToday
                                ? "bg-[#087eaf] text-white"
                                : "text-slate-700 dark:text-slate-200"
                            }`}
                          >
                            {cell.dayNumber}
                          </span>
                          {events.length > 0 && (
                            <span className="text-[10px] font-mono tabular-nums font-semibold text-slate-400 dark:text-slate-400">
                              {events.length}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col gap-1 w-full overflow-hidden">
                          {events.slice(0, 3).map((ev) => {
                            const chipClass =
                              ev.kind === "mileage-due"
                                ? "bg-rose-600 text-white border-rose-700 dark:bg-rose-600 dark:text-white dark:border-rose-500 shadow-xs"
                                : ev.kind === "overdue"
                                ? "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800"
                                : ev.kind === "due-soon"
                                ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800"
                                : ev.kind === "due"
                                ? "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/70 dark:text-sky-200 dark:border-sky-800"
                                : ev.kind === "projected"
                                ? "bg-indigo-50 text-indigo-700 border-dashed border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-700"
                                : "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800";

                            return (
                              <div
                                key={ev.key}
                                className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold truncate ${chipClass}`}
                                title={ev.label}
                              >
                                {ev.kind === "mileage-due"
                                  ? `รถ ${ev.schedule.vehicleId} ครบรอบต้อง PM แล้ว`
                                  : `${ev.schedule.vehicleId}${ev.kind === "completed" ? " ✓" : ""}`}
                              </div>
                            );
                          })}
                          {events.length > 3 && (
                            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 pl-1">
                              +{events.length - 3} คัน
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Day Inspector & Overdue Watchlist */}
              <div className="space-y-4">
                <div className="border border-slate-200 dark:border-[#1e3a5f] rounded-lg bg-white dark:bg-[#091528] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-[#1e3a5f]">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        รายละเอียดประจำวันที่เลือก
                      </div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                        {formatThaiFullDate(selectedDateYmd)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openCreateModal(selectedDateYmd)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-[#087eaf] text-white hover:bg-[#066994] whitespace-nowrap"
                    >
                      <Plus size={12} />
                      ตั้ง PM วันนี้
                    </button>
                  </div>

                  {selectedDayEvents.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                      ไม่มีรายการรถครบกำหนด PM ในวันที่ {formatThaiShortDate(selectedDateYmd)}
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                      {selectedDayEvents.map((ev) => (
                        <div
                          key={ev.key}
                          className={`p-2.5 rounded-md border space-y-1.5 ${
                            ev.kind === "mileage-due"
                              ? "border-rose-300 bg-rose-50/80 dark:border-rose-800 dark:bg-rose-950/35"
                              : "border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1d35]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="code font-bold text-xs text-[#087eaf] dark:text-sky-300">
                              {ev.schedule.vehicleId} · {ev.schedule.vehicleType}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                ev.kind === "mileage-due"
                                  ? "bg-rose-600 text-white"
                                  : ev.kind === "overdue"
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                  : ev.kind === "due-soon"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                  : ev.kind === "due"
                                  ? "bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300"
                                  : ev.kind === "projected"
                                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300"
                                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                              }`}
                            >
                              {ev.kind === "mileage-due"
                                ? "ครบเลขไมล์ PM!"
                                : ev.kind === "overdue"
                                ? "เกินกำหนด"
                                : ev.kind === "due-soon"
                                ? "ใกล้ครบกำหนด"
                                : ev.kind === "due"
                                ? "ครบกำหนดรอบนี้"
                                : ev.kind === "projected"
                                ? "รอบคาดการณ์"
                                : "ทำ PM เสร็จแล้ว"}
                            </span>
                          </div>

                          {ev.kind === "mileage-due" && (
                            <div className="p-2 rounded bg-white/90 dark:bg-[#091528] border border-rose-200 dark:border-rose-800/80 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
                              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-rose-600" />
                              <div>
                                <div>รถ {ev.schedule.vehicleId} ครบรอบต้อง PM แล้ว</div>
                                {ev.mileageNote && (
                                  <div className="text-[11px] font-normal text-rose-600/90 dark:text-rose-300/90 mt-0.5">
                                    {ev.mileageNote}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="text-xs font-medium text-slate-800 dark:text-slate-100">
                            {ev.schedule.pmCategory}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {ev.schedule.cycleDays
                              ? `รอบทุก ${ev.schedule.cycleDays} วัน · `
                              : ""}
                            {ev.schedule.targetMileageKm
                              ? `ตั้งไมล์ PM ที่ ${ev.schedule.targetMileageKm.toLocaleString()} กม. · `
                              : ""}
                            ผู้รับผิดชอบ: {ev.schedule.responsibleTech}
                          </div>

                          {ev.kind !== "completed" && (
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => openCompletePmModal(ev.schedule)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                              >
                                <CheckCircle2 size={11} />
                                บันทึกทำ PM แล้ว
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(ev.schedule)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-[#132542]"
                              >
                                <Edit2 size={11} />
                                แก้ไขรอบ
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Overdue / Mileage-Due Watchlist */}
                {overdueList.length > 0 && (
                  <div className="border border-rose-200 dark:border-rose-900 rounded-lg bg-rose-50/60 dark:bg-rose-950/25 p-4 space-y-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300">
                      <AlertTriangle size={14} />
                      รถที่ครบรอบไมล์ / เกินกำหนดต้อง PM ({overdueList.length} คัน)
                    </div>
                    <div className="space-y-2 max-h-[240px] overflow-y-auto">
                      {overdueList.map(({ schedule, health, mileageInfo }) => (
                        <div
                          key={`ov-${schedule.id}`}
                          className="flex items-center justify-between gap-2 p-2 rounded bg-white/90 dark:bg-[#0d1b33] border border-rose-200/80 dark:border-rose-900/70"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              รถ {schedule.vehicleId} ครบรอบต้อง PM แล้ว
                            </div>
                            <div className="text-[10px] text-rose-600 dark:text-rose-300 font-medium truncate">
                              {mileageInfo.isMileageDue
                                ? `เลขไมล์ล่าสุด ${mileageInfo.latestKm?.toLocaleString()} / ${mileageInfo.targetKm?.toLocaleString()} กม.`
                                : `${health.label} (${formatThaiShortDate(schedule.nextPmDate)})`}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openCompletePmModal(schedule)}
                            className="shrink-0 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            ทำ PM
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PM COMPLETION HISTORY */}
        {activeTab === "history" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วันที่ทำ PM</th>
                  <th>รหัสรถ / ประเภท</th>
                  <th>ประเภท PM</th>
                  <th>กำหนดรอบถัดไปใหม่</th>
                  <th>เลขไมล์ / ชั่วโมงใช้งาน</th>
                  <th>ค่าใช้จ่าย (บาท)</th>
                  <th>ผู้ดำเนินการ / ช่าง</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {allHistoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                      ยังไม่มีประวัติการบันทึกทำ PM ในระบบ
                    </td>
                  </tr>
                ) : (
                  allHistoryRows.map(({ entry, schedule }) => (
                    <tr key={`${schedule.id}-${entry.id}`}>
                      <td>
                        <div className="table-item-name font-mono tabular-nums text-xs font-semibold">
                          {formatThaiShortDate(entry.completedDate)}
                        </div>
                        <div className="table-sub-text font-mono tabular-nums text-[10px]">
                          {entry.completedDate}
                        </div>
                      </td>
                      <td>
                        <span className="code font-bold text-[#087eaf] dark:text-sky-300">
                          {schedule.vehicleId}
                        </span>
                        <div className="table-sub-text text-[11px]">{schedule.vehicleType}</div>
                      </td>
                      <td>
                        <div className="table-item-name text-xs font-medium">
                          {schedule.pmCategory}
                        </div>
                      </td>
                      <td>
                        <div className="table-item-name font-mono tabular-nums text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          {entry.nextDueDate ? formatThaiShortDate(entry.nextDueDate) : "ตามระยะเลขไมล์"}
                        </div>
                      </td>
                      <td className="font-mono tabular-nums text-xs">
                        {entry.mileageKm !== undefined ? `${entry.mileageKm.toLocaleString()} กม.` : ""}
                        {entry.mileageKm !== undefined && entry.operatingHours !== undefined ? " · " : ""}
                        {entry.operatingHours !== undefined
                          ? `${entry.operatingHours.toLocaleString()} ชม.`
                          : entry.mileageKm === undefined
                          ? "-"
                          : ""}
                      </td>
                      <td className="font-mono tabular-nums text-xs">
                        {entry.cost !== undefined ? `฿${entry.cost.toLocaleString()}` : "-"}
                      </td>
                      <td className="text-xs font-medium">{entry.performedBy}</td>
                      <td className="text-xs text-slate-500 dark:text-slate-400 max-w-[220px] whitespace-normal">
                        {entry.notes || "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ADD / EDIT PM SCHEDULE MODAL */}
      {isFormModalOpen && (
        <div className="modal-backdrop z-[120]! overflow-y-auto p-3! sm:p-5!">
          <div className="modal-container flex flex-col w-full max-w-[740px] max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-40px)] min-h-0 overflow-hidden">
            <div className="modal-header-box shrink-0 gap-3 px-5! py-3.5!">
              <div className="min-w-0">
                <div className="modal-title-text flex items-center gap-2">
                  <Wrench size={16} className="text-[#087eaf] shrink-0" />
                  <span className="truncate">
                    {editingScheduleId
                      ? `แก้ไขกำหนดการ PM รถ ${formVehicleId}`
                      : "เพิ่มกำหนดการ PM รถใหม่"}
                  </span>
                </div>
                <div className="modal-sub-text mt-0.5 leading-snug">
                  สามารถตั้งรอบ PM ด้วยเลขไมล์ (ดึงเลขไมล์ล่าสุดจากหน้า ตรวจเช็ครถประจำวัน) หรือกำหนดตามจำนวนวันได้
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                className="modal-close-btn shrink-0"
                aria-label="ปิดหน้าต่าง"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSaveSchedule}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-3.5">
                {formError && (
                  <div className="px-3 py-2 rounded border border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:border-rose-800 dark:text-rose-200 text-xs">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pb-1">
                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      เลือกรถ (Vehicle) *
                    </label>
                    <select
                      value={formVehicleId}
                      onChange={(e) => handleVehicleSelectChange(e.target.value)}
                      disabled={Boolean(editingScheduleId)}
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                      required
                    >
                      <option value="">-- เลือกรถโฟล์คลิฟท์ / รถลากจูง --</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.vehicleId}>
                          {v.vehicleId} · {v.vehicleType}{" "}
                          {v.description ? `(${v.description})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      ประเภทงาน PM *
                    </label>
                    <select
                      value={formPmCategory}
                      onChange={(e) => setFormPmCategory(e.target.value)}
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    >
                      {MH_PM_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* MILEAGE-BASED PM CONFIGURATION BOX */}
                  <div className="sm:col-span-2 min-w-0 p-3.5 rounded-lg border border-sky-200 dark:border-sky-900/70 bg-sky-50/50 dark:bg-[#0d1f3a] space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#087eaf] dark:text-sky-300">
                          การตั้งค่า PM ด้วยเลขไมล์ (กม.) — เชื่อมโยงหน้า ตรวจเช็ครถประจำวัน
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          เมื่อพนักงานบันทึกเลขไมล์ในหน้า ตรวจเช็ครถประจำวัน ถึงระยะที่ตั้งไว้ ระบบจะแจ้งเตือนในปฏิทินทันทีว่าครบรอบต้อง PM แล้ว
                        </div>
                      </div>
                      {formVehicleId && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-white dark:bg-[#091528] border border-sky-200 dark:border-sky-800 text-slate-700 dark:text-slate-200 shrink-0">
                          ไมล์ล่าสุด {formVehicleId}:{" "}
                          {(
                            latestMileageByVehicle.get(formVehicleId.trim().toUpperCase())
                              ?.mileageKm ?? 0
                          ).toLocaleString()}{" "}
                          กม.
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="modal-label-text block text-xs mb-1.5">
                        เลือกระยะเลขไมล์ PM ด่วน หรือระบุระยะไมล์เอง
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {MILEAGE_PRESETS.map((preset) => (
                          <button
                            type="button"
                            key={preset.km}
                            onClick={() =>
                              handleMileageCycleOrStartChange(formStartMileageKm, String(preset.km))
                            }
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                              Number(formCycleMileageKm) === preset.km
                                ? "bg-[#087eaf] text-white border-[#087eaf]"
                                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-[#091528] dark:text-slate-200 dark:border-[#1e3a5f]"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setFormCycleMileageKm("");
                            setFormTargetMileageKm("");
                          }}
                          className="px-2.5 py-1 rounded text-[11px] font-medium border border-slate-300 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#132542]"
                        >
                          ไม่ใช้เลขไมล์
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="min-w-0">
                        <label className="modal-label-text block text-xs mb-1">
                          เลขไมล์เริ่มต้นตั้ง PM (กม.)
                        </label>
                        <input
                          type="number"
                          min={0}
                          placeholder="เช่น 0"
                          value={formStartMileageKm}
                          onChange={(e) =>
                            handleMileageCycleOrStartChange(e.target.value, formCycleMileageKm)
                          }
                          className="field w-full font-mono tabular-nums"
                          style={STANDARD_CONTROL_STYLE}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="modal-label-text block text-xs mb-1">
                          รอบระยะทาง PM (ทุกกี่ กม.)
                        </label>
                        <input
                          type="number"
                          min={1}
                          placeholder="เช่น 300"
                          value={formCycleMileageKm}
                          onChange={(e) =>
                            handleMileageCycleOrStartChange(formStartMileageKm, e.target.value)
                          }
                          className="field w-full font-mono tabular-nums"
                          style={STANDARD_CONTROL_STYLE}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="modal-label-text block text-xs mb-1 font-bold text-[#087eaf] dark:text-sky-300">
                          ตั้ง PM ที่เลขไมล์ครบกำหนด (กม.)
                        </label>
                        <input
                          type="number"
                          min={1}
                          placeholder="เช่น 300"
                          value={formTargetMileageKm}
                          onChange={(e) => setFormTargetMileageKm(e.target.value)}
                          className="field w-full font-mono tabular-nums font-bold"
                          style={STANDARD_CONTROL_STYLE}
                        />
                      </div>
                    </div>
                  </div>

                  {/* OPTIONAL DAY-BASED PM CONFIGURATION */}
                  <div className="sm:col-span-2 min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      เลือกรอบระยะเวลา PM ด่วน หรือกำหนดจำนวนวันเอง (ไม่บังคับ)
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {CYCLE_PRESETS.map((preset) => (
                        <button
                          type="button"
                          key={preset.days}
                          onClick={() =>
                            handleLastPmDateOrCycleChange(formLastPmDate, String(preset.days))
                          }
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                            Number(formCycleDays) === preset.days
                              ? "bg-[#087eaf] text-white border-[#087eaf]"
                              : "bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-[#0d1b33] dark:text-slate-200 dark:border-[#1e3a5f]"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setFormCycleDays("");
                          setFormNextPmDate("");
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                          !formCycleDays && !formNextPmDate
                            ? "bg-slate-700 text-white border-slate-700 dark:bg-slate-200 dark:text-slate-900"
                            : "bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100 dark:bg-[#0d1b33] dark:text-slate-300 dark:border-[#1e3a5f]"
                        }`}
                      >
                        ไม่กำหนดวัน (ใช้เลขไมล์อย่างเดียว)
                      </button>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      รอบกำหนด PM (จำนวนวัน - ไม่บังคับ)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      placeholder="เว้นว่างได้หากตั้ง PM ด้วยเลขไมล์"
                      value={formCycleDays}
                      onChange={(e) =>
                        handleLastPmDateOrCycleChange(formLastPmDate, e.target.value)
                      }
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      แจ้งเตือนล่วงหน้า (วันก่อนครบกำหนด)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={formWarningDays}
                      onChange={(e) => setFormWarningDays(Number(e.target.value) || 7)}
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      วันที่เริ่มตั้ง PM / ทำ PM ล่าสุด *
                    </label>
                    <input
                      type="date"
                      value={formLastPmDate}
                      onChange={(e) =>
                        handleLastPmDateOrCycleChange(e.target.value, formCycleDays)
                      }
                      className="field w-full dark:[color-scheme:dark]"
                      style={STANDARD_DATE_STYLE}
                      required
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      วันครบกำหนด PM ครั้งถัดไป (ไม่บังคับ)
                    </label>
                    <input
                      type="date"
                      value={formNextPmDate}
                      onChange={(e) => setFormNextPmDate(e.target.value)}
                      className="field w-full dark:[color-scheme:dark]"
                      style={STANDARD_DATE_STYLE}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      รอบชั่วโมงใช้งาน (ชม. - ถ้ามี)
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="เช่น 250, 500"
                      value={formCycleHours}
                      onChange={(e) => setFormCycleHours(e.target.value)}
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      ผู้รับผิดชอบ / ทีมช่าง / Vendor
                    </label>
                    <input
                      type="text"
                      list="pm-tech-suggestions"
                      value={formResponsibleTech}
                      onChange={(e) => setFormResponsibleTech(e.target.value)}
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    />
                    <datalist id="pm-tech-suggestions">
                      {technicianSuggestions.map((tName) => (
                        <option key={tName} value={tName} />
                      ))}
                    </datalist>
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      ประมาณการค่าใช้จ่ายต่อรอบ (บาท)
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="เช่น 3500"
                      value={formEstimatedCost}
                      onChange={(e) => setFormEstimatedCost(e.target.value)}
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">สถานะแผน PM</label>
                    <select
                      value={formScheduleStatus}
                      onChange={(e) =>
                        setFormScheduleStatus(e.target.value as "Active" | "Paused")
                      }
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    >
                      <option value="Active">เปิดใช้งาน (Active)</option>
                      <option value="Paused">พักรอบชั่วคราว (Paused)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2 min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">
                      รายการตรวจเช็คตามรอบ (Checklist Summary)
                    </label>
                    <input
                      type="text"
                      value={formChecklistSummary}
                      onChange={(e) => setFormChecklistSummary(e.target.value)}
                      placeholder="ระบุรายการอะไหล่/จุดตรวจเช็คสำคัญ..."
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    />
                  </div>

                  <div className="sm:col-span-2 min-w-0">
                    <label className="modal-label-text block text-xs mb-1.5">หมายเหตุเพิ่มเติม</label>
                    <input
                      type="text"
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      placeholder="หมายเหตุหรือข้อควรระวัง..."
                      className="field w-full"
                      style={STANDARD_CONTROL_STYLE}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer-box shrink-0 flex-wrap px-5! py-3!">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="button secondary"
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSaving} className="button primary">
                  <CheckCircle2 size={14} />
                  {isSaving ? "กำลังบันทึก..." : "บันทึกกำหนดการ PM"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MARK PM COMPLETED MODAL */}
      {completingSchedule && (
        <div className="modal-backdrop">
          <div className="modal-container" style={{ maxWidth: 520 }}>
            <div className="modal-header-box" style={{ padding: "16px 22px" }}>
              <div>
                <div className="modal-title-text flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  บันทึกการทำ PM แล้ว · {completingSchedule.vehicleId}
                </div>
                <div className="modal-sub-text mt-0.5">
                  {completingSchedule.pmCategory}
                  {completingSchedule.cycleDays
                    ? ` (รอบทุก ${completingSchedule.cycleDays} วัน)`
                    : ""}
                  {completingSchedule.targetMileageKm
                    ? ` · เป้าหมายไมล์ ${completingSchedule.targetMileageKm.toLocaleString()} กม.`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompletingSchedule(null)}
                className="modal-close-btn"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmCompletePm} className="p-5 space-y-3.5">
              <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-800 text-xs space-y-1">
                {completingSchedule.cycleDays && (
                  <div className="text-emerald-800 dark:text-emerald-200 font-semibold">
                    วันครบกำหนดรอบถัดไปใหม่:{" "}
                    <span className="font-mono tabular-nums underline">
                      {formatThaiFullDate(
                        computeNextPmDate(completeDate || todayYmd, completingSchedule.cycleDays)
                      )}
                    </span>
                  </div>
                )}
                {completingSchedule.cycleMileageKm && (
                  <div className="text-emerald-800 dark:text-emerald-200 font-semibold">
                    รอบเลขไมล์ครบกำหนดถัดไป:{" "}
                    <span className="font-mono tabular-nums underline">
                      {(
                        (Number(completeMileageKm) ||
                          completingSchedule.targetMileageKm ||
                          completingSchedule.startMileageKm ||
                          0) + completingSchedule.cycleMileageKm
                      ).toLocaleString()}{" "}
                      กม.
                    </span>
                  </div>
                )}
                <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                  ระบบจะบันทึกประวัติและรีเซ็ตการแจ้งเตือนรอบถัดไปให้อัตโนมัติ
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="modal-label-text block text-xs mb-1.5">
                    วันที่ทำ PM เสร็จสิ้น *
                  </label>
                  <input
                    type="date"
                    value={completeDate}
                    onChange={(e) => setCompleteDate(e.target.value)}
                    className="field w-full dark:[color-scheme:dark]"
                    style={STANDARD_DATE_STYLE}
                    required
                  />
                </div>

                <div>
                  <label className="modal-label-text block text-xs mb-1.5">
                    ผู้ดำเนินการ / ช่าง *
                  </label>
                  <input
                    type="text"
                    value={completePerformedBy}
                    onChange={(e) => setCompletePerformedBy(e.target.value)}
                    className="field w-full"
                    style={STANDARD_CONTROL_STYLE}
                    required
                  />
                </div>

                <div>
                  <label className="modal-label-text block text-xs mb-1.5">
                    เลขไมล์รถขณะทำ PM (กม.)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="เช่น 300"
                    value={completeMileageKm}
                    onChange={(e) => setCompleteMileageKm(e.target.value)}
                    className="field w-full font-mono tabular-nums"
                    style={STANDARD_CONTROL_STYLE}
                  />
                </div>

                <div>
                  <label className="modal-label-text block text-xs mb-1.5">
                    เลขชั่วโมงรถขณะทำ PM
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="ชั่วโมงใช้งาน"
                    value={completeOperatingHours}
                    onChange={(e) => setCompleteOperatingHours(e.target.value)}
                    className="field w-full font-mono tabular-nums"
                    style={STANDARD_CONTROL_STYLE}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="modal-label-text block text-xs mb-1.5">
                    ค่าใช้จ่ายจริง (บาท)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={completeCost}
                    onChange={(e) => setCompleteCost(e.target.value)}
                    className="field w-full font-mono tabular-nums"
                    style={STANDARD_CONTROL_STYLE}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="modal-label-text block text-xs mb-1.5">
                    รายละเอียดอะไหล่ที่เปลี่ยน / ผลการตรวจเช็ค
                  </label>
                  <input
                    type="text"
                    value={completeNotes}
                    onChange={(e) => setCompleteNotes(e.target.value)}
                    placeholder="เช่น เปลี่ยนน้ำมันเครื่อง กรองอากาศ ตรวจเบรคเรียบร้อย..."
                    className="field w-full"
                    style={STANDARD_CONTROL_STYLE}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-[#1e3a5f]">
                <button
                  type="button"
                  onClick={() => setCompletingSchedule(null)}
                  className="button secondary"
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSaving} className="button primary">
                  <CheckCircle2 size={14} />
                  {isSaving ? "กำลังบันทึก..." : "ยืนยันทำ PM เสร็จสิ้น"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BATCH SETUP MISSING VEHICLES MODAL */}
      {isBatchModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-container" style={{ maxWidth: 520 }}>
            <div className="modal-header-box" style={{ padding: "16px 22px" }}>
              <div>
                <div className="modal-title-text flex items-center gap-2">
                  <Truck size={16} className="text-[#087eaf]" />
                  สร้างกำหนดการ PM อัตโนมัติ ({unscheduledVehicles.length} คัน)
                </div>
                <div className="modal-sub-text mt-0.5">
                  ตั้งค่ารอบ PM เริ่มต้นให้รถที่ยังไม่มีกำหนดการ (สามารถแก้ไขรายคันภายหลังได้)
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchModalOpen(false)}
                className="modal-close-btn"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleBatchSetupMissingVehicles} className="p-5 space-y-3.5">
              <div className="p-2.5 rounded border border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1d35] text-[11px] text-slate-600 dark:text-slate-300 max-h-28 overflow-y-auto">
                <span className="font-semibold">รถที่จะสร้างกำหนดการ: </span>
                {unscheduledVehicles.map((v) => v.vehicleId).join(", ")}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="modal-label-text block text-xs mb-1.5">ประเภท PM เริ่มต้น</label>
                  <select
                    value={batchCategory}
                    onChange={(e) => setBatchCategory(e.target.value)}
                    className="field w-full"
                    style={STANDARD_CONTROL_STYLE}
                  >
                    {MH_PM_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="modal-label-text block text-xs mb-1.5">
                    รอบกำหนด (จำนวนวัน) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={batchCycleDays}
                    onChange={(e) => setBatchCycleDays(Math.max(1, Number(e.target.value) || 90))}
                    className="field w-full"
                    style={STANDARD_CONTROL_STYLE}
                    required
                  />
                </div>

                <div>
                  <label className="modal-label-text block text-xs mb-1.5">
                    วันที่ทำ PM ล่าสุด (อ้างอิงเริ่มต้น) *
                  </label>
                  <input
                    type="date"
                    value={batchLastPmDate}
                    onChange={(e) => setBatchLastPmDate(e.target.value)}
                    className="field w-full dark:[color-scheme:dark]"
                    style={STANDARD_DATE_STYLE}
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="modal-label-text block text-xs mb-1.5">
                    ทีมช่าง / ผู้รับผิดชอบ
                  </label>
                  <input
                    type="text"
                    value={batchTech}
                    onChange={(e) => setBatchTech(e.target.value)}
                    className="field w-full"
                    style={STANDARD_CONTROL_STYLE}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-[#1e3a5f]">
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(false)}
                  className="button secondary"
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSaving} className="button primary">
                  <Layers size={14} />
                  {isSaving ? "กำลังสร้าง..." : `สร้างกำหนดการทั้งหมด (${unscheduledVehicles.length} คัน)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div className="modal-backdrop">
          <div className="modal-container" style={{ maxWidth: 420 }}>
            <div className="modal-header-box" style={{ padding: "16px 20px" }}>
              <div className="modal-title-text text-rose-600 dark:text-rose-400">
                ยืนยันการลบกำหนดการ PM
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="modal-close-btn"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 text-xs text-slate-700 dark:text-slate-200 space-y-2">
              <p>
                ต้องการลบกำหนดการ PM ของรถ{" "}
                <strong className="text-slate-900 dark:text-white">
                  {deleteTarget.vehicleId}
                </strong>{" "}
                ({deleteTarget.pmCategory}) ใช่หรือไม่?
              </p>
            </div>
            <div className="modal-footer-box px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="button secondary"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
              >
                <Trash2 size={13} />
                ลบกำหนดการ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
