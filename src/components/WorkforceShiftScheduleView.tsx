/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import {
  ArrowLeftRight,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileSpreadsheet,
  Moon,
  RefreshCw,
  RotateCcw,
  Search,
  Sun,
  Users,
} from "lucide-react";
import { Employee } from "../types/officer";
import {
  formatLocalTimestamp,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import {
  addDaysToYmd,
  buildWeekDaysForShift,
  DailyShiftValue,
  DayKey,
  derivePrimaryShiftFromDays,
  EmployeeWeeklyShiftEntry,
  fetchWeeklyShiftSchedule,
  formatLocalYmd,
  formatThaiWeekRangeLabel,
  getWeekDates,
  getWeekStartYmd,
  loadCachedWeeklyShiftSchedule,
  PrimaryShift,
  saveWeeklyShiftSchedule,
  subscribeWeeklyShiftSchedule,
  WEEK_DAY_META,
  WeeklyShiftScheduleDoc,
  WeeklyWorkPattern,
} from "../services/weeklyShiftScheduleService";

interface WorkforceShiftScheduleViewProps {
  employees: Employee[];
  onUpdateEmployees: (updated: Employee[]) => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
}

interface SectionGroup {
  sectionName: string;
  employees: Employee[];
  dayCount: number;
  nightCount: number;
  unassignedCount: number;
}

function getEmployeeInitials(name: string): string {
  const cleaned = (name || "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function nextDailyShift(current: DailyShiftValue | undefined): DailyShiftValue {
  if (current === "day") return "night";
  if (current === "night") return "off";
  return "day";
}

function formatDayShiftThai(val: DailyShiftValue | undefined): string {
  if (val === "day") return "กะเช้า";
  if (val === "night") return "กะดึก";
  if (val === "off") return "หยุด";
  return "-";
}

export function WorkforceShiftScheduleView({
  employees,
  onUpdateEmployees,
  onLogTransaction,
}: WorkforceShiftScheduleViewProps) {
  const todayYmd = useMemo(() => formatLocalYmd(new Date()), []);
  const currentWeekStartYmd = useMemo(() => getWeekStartYmd(todayYmd), [todayYmd]);

  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(currentWeekStartYmd);
  const [weeklyDoc, setWeeklyDoc] = useState<WeeklyShiftScheduleDoc | null>(() =>
    loadCachedWeeklyShiftSchedule(currentWeekStartYmd)
  );
  const [workPattern, setWorkPattern] = useState<WeeklyWorkPattern>("mon_sat");
  const [isLoadingWeek, setIsLoadingWeek] = useState<boolean>(true);
  const [isCopyingPrevWeek, setIsCopyingPrevWeek] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [shiftFilter, setShiftFilter] = useState<"all" | "day" | "night" | "unassigned">("all");
  const [showInactive, setShowInactive] = useState<boolean>(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [brokenPhotoIds, setBrokenPhotoIds] = useState<Record<string, boolean>>({});
  const [statusFeedback, setStatusFeedback] = useState<string>("");

  const isViewingCurrentWeek = selectedWeekStart === currentWeekStartYmd;
  const weekDates = useMemo(() => getWeekDates(selectedWeekStart), [selectedWeekStart]);
  const weekRangeInfo = useMemo(
    () => formatThaiWeekRangeLabel(selectedWeekStart),
    [selectedWeekStart]
  );

  // Subscribe to Firestore weekly schedule doc for the selected week
  useEffect(() => {
    setIsLoadingWeek(true);
    const cached = loadCachedWeeklyShiftSchedule(selectedWeekStart);
    setWeeklyDoc(cached);
    if (cached?.workPattern) {
      setWorkPattern(cached.workPattern);
    }

    const unsub = subscribeWeeklyShiftSchedule(
      selectedWeekStart,
      (cloudDoc) => {
        setWeeklyDoc(cloudDoc);
        if (cloudDoc?.workPattern) {
          setWorkPattern(cloudDoc.workPattern);
        }
        setIsLoadingWeek(false);
      },
      () => {
        setIsLoadingWeek(false);
      }
    );

    return () => unsub();
  }, [selectedWeekStart]);

  useEffect(() => {
    if (!statusFeedback) return;
    const timer = window.setTimeout(() => setStatusFeedback(""), 2800);
    return () => window.clearTimeout(timer);
  }, [statusFeedback]);

  // Effective entries map for selected week:
  // Uses saved weekly document; for current week without a doc yet, seamlessly falls back to employee.workShift
  const effectiveEntries = useMemo<Record<string, EmployeeWeeklyShiftEntry>>(() => {
    const base: Record<string, EmployeeWeeklyShiftEntry> = {};
    if (weeklyDoc?.entries) {
      Object.entries(weeklyDoc.entries).forEach(([empId, entry]) => {
        base[empId] = entry;
      });
    }
    if (isViewingCurrentWeek && !weeklyDoc) {
      employees.forEach((emp) => {
        if (emp.workShift === "day" || emp.workShift === "night") {
          base[emp.employeeId] = {
            shift: emp.workShift,
            days: buildWeekDaysForShift(emp.workShift, workPattern),
          };
        }
      });
    }
    return base;
  }, [weeklyDoc, isViewingCurrentWeek, employees, workPattern]);

  const persistWeekSchedule = useCallback(
    (
      nextEntries: Record<string, EmployeeWeeklyShiftEntry>,
      nextPattern: WeeklyWorkPattern,
      feedbackMessage: string,
      logActivity?: string,
      logRef?: string
    ) => {
      const recorder = getActiveRecorderDisplay();
      const nextDoc: WeeklyShiftScheduleDoc = {
        id: selectedWeekStart,
        weekStartYmd: selectedWeekStart,
        weekEndYmd: addDaysToYmd(selectedWeekStart, 6),
        workPattern: nextPattern,
        entries: nextEntries,
        updatedAt: new Date().toISOString(),
        updatedBy: recorder.label,
      };

      setWeeklyDoc(nextDoc);
      setStatusFeedback(feedbackMessage);
      void saveWeeklyShiftSchedule(nextDoc);

      // Keep employee roster's current workShift in sync when modifying the active current week
      if (isViewingCurrentWeek) {
        const nowTs = formatLocalTimestamp().timestamp;
        let rosterChanged = false;
        const nextRoster = employees.map((emp) => {
          const entry = nextEntries[emp.employeeId];
          if (entry && emp.workShift !== entry.shift) {
            rosterChanged = true;
            return { ...emp, workShift: entry.shift, updatedAt: nowTs };
          }
          return emp;
        });
        if (rosterChanged) {
          onUpdateEmployees(nextRoster);
        }
      }

      if (logActivity) {
        onLogTransaction?.(logActivity, logRef || selectedWeekStart, "Completed");
      }
    },
    [selectedWeekStart, isViewingCurrentWeek, employees, onUpdateEmployees, onLogTransaction]
  );

  const scopedEmployees = useMemo(() => {
    return showInactive
      ? employees
      : employees.filter((e) => e.employmentStatus === "Active");
  }, [employees, showInactive]);

  const inactiveCount = useMemo(
    () => employees.filter((e) => e.employmentStatus !== "Active").length,
    [employees]
  );

  const allSectionNames = useMemo(() => {
    const set = new Set<string>();
    scopedEmployees.forEach((emp) => {
      set.add(emp.department?.trim() || "ไม่ระบุส่วนงาน");
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
  }, [scopedEmployees]);

  useEffect(() => {
    setExpandedSections((prev) => {
      let changed = false;
      const next = { ...prev };
      allSectionNames.forEach((sec) => {
        if (next[sec] === undefined) {
          next[sec] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [allSectionNames]);

  const stats = useMemo(() => {
    let day = 0;
    let night = 0;
    let unassigned = 0;
    scopedEmployees.forEach((emp) => {
      const entry = effectiveEntries[emp.employeeId];
      if (entry?.shift === "day") day += 1;
      else if (entry?.shift === "night") night += 1;
      else unassigned += 1;
    });
    return {
      total: scopedEmployees.length,
      day,
      night,
      unassigned,
      sectionCount: allSectionNames.length,
    };
  }, [scopedEmployees, effectiveEntries, allSectionNames.length]);

  const dailyTotals = useMemo(() => {
    const totals: Record<DayKey, { day: number; night: number }> = {
      mon: { day: 0, night: 0 },
      tue: { day: 0, night: 0 },
      wed: { day: 0, night: 0 },
      thu: { day: 0, night: 0 },
      fri: { day: 0, night: 0 },
      sat: { day: 0, night: 0 },
      sun: { day: 0, night: 0 },
    };
    scopedEmployees.forEach((emp) => {
      const entry = effectiveEntries[emp.employeeId];
      if (!entry) return;
      WEEK_DAY_META.forEach(({ key }) => {
        if (entry.days[key] === "day") totals[key].day += 1;
        else if (entry.days[key] === "night") totals[key].night += 1;
      });
    });
    return totals;
  }, [scopedEmployees, effectiveEntries]);

  const filteredGroups = useMemo<SectionGroup[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map<string, Employee[]>();

    scopedEmployees.forEach((emp) => {
      const sectionName = emp.department?.trim() || "ไม่ระบุส่วนงาน";
      if (sectionFilter !== "all" && sectionName !== sectionFilter) return;

      const entry = effectiveEntries[emp.employeeId];
      if (shiftFilter === "day" && entry?.shift !== "day") return;
      if (shiftFilter === "night" && entry?.shift !== "night") return;
      if (shiftFilter === "unassigned" && entry) return;

      if (q) {
        const matchName = emp.employeeName.toLowerCase().includes(q);
        const matchSection = sectionName.toLowerCase().includes(q);
        if (!matchName && !matchSection) return;
      }

      const list = map.get(sectionName);
      if (list) list.push(emp);
      else map.set(sectionName, [emp]);
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, "th", { numeric: true }))
      .map(([sectionName, list]) => {
        const sorted = [...list].sort((a, b) =>
          a.employeeName.localeCompare(b.employeeName, "th", { numeric: true })
        );
        let dayCount = 0;
        let nightCount = 0;
        let unassignedCount = 0;
        sorted.forEach((emp) => {
          const entry = effectiveEntries[emp.employeeId];
          if (entry?.shift === "day") dayCount += 1;
          else if (entry?.shift === "night") nightCount += 1;
          else unassignedCount += 1;
        });
        return {
          sectionName,
          employees: sorted,
          dayCount,
          nightCount,
          unassignedCount,
        };
      });
  }, [scopedEmployees, effectiveEntries, searchQuery, sectionFilter, shiftFilter]);

  // 1-Click: Assign employee's shift for the ENTIRE WEEK at once
  const handleSetEmployeeWeeklyShift = (emp: Employee, nextShift: PrimaryShift) => {
    const nextEntries: Record<string, EmployeeWeeklyShiftEntry> = {
      ...effectiveEntries,
      [emp.employeeId]: {
        shift: nextShift,
        days: buildWeekDaysForShift(nextShift, workPattern),
      },
    };
    const shiftLabel = nextShift === "day" ? "กะเช้า" : "กะดึก";
    persistWeekSchedule(
      nextEntries,
      workPattern,
      `บันทึก ${emp.employeeName} → ${shiftLabel} (ทั้งสัปดาห์)`,
      `จัดกะทั้งสัปดาห์ (${selectedWeekStart}): ${emp.employeeName} → ${shiftLabel}`,
      emp.employeeId
    );
  };

  // Optional fine-tune: Click an individual day cell (Mon–Sun) to cycle Day → Night → Off
  const handleCycleEmployeeSingleDay = (emp: Employee, dayKey: DayKey) => {
    const existing = effectiveEntries[emp.employeeId];
    const currentDays: Record<DayKey, DailyShiftValue> = existing
      ? { ...existing.days }
      : buildWeekDaysForShift("day", workPattern);

    const nextVal = existing ? nextDailyShift(currentDays[dayKey]) : "day";
    currentDays[dayKey] = nextVal;
    const derivedPrimary = derivePrimaryShiftFromDays(
      currentDays,
      existing?.shift || (nextVal === "night" ? "night" : "day")
    );

    const nextEntries: Record<string, EmployeeWeeklyShiftEntry> = {
      ...effectiveEntries,
      [emp.employeeId]: {
        shift: derivedPrimary,
        days: currentDays,
      },
    };
    const dayMeta = WEEK_DAY_META.find((d) => d.key === dayKey);
    persistWeekSchedule(
      nextEntries,
      workPattern,
      `ปรับวัน${dayMeta?.fullTh || dayKey} ของ ${emp.employeeName} → ${formatDayShiftThai(nextVal)}`,
      `ปรับกะรายวัน (${selectedWeekStart} ${dayMeta?.shortTh || dayKey}): ${emp.employeeName} → ${formatDayShiftThai(nextVal)}`,
      emp.employeeId
    );
  };

  // Switch Weekly Work Pattern (Mon-Sat with Sun Off vs Mon-Sun all 7 days)
  const handleChangeWorkPattern = (nextPattern: WeeklyWorkPattern) => {
    if (nextPattern === workPattern) return;
    setWorkPattern(nextPattern);

    const entryKeys = Object.keys(effectiveEntries);
    if (entryKeys.length === 0) return;

    const nextEntries: Record<string, EmployeeWeeklyShiftEntry> = {};
    entryKeys.forEach((empId) => {
      const entry = effectiveEntries[empId];
      nextEntries[empId] = {
        shift: entry.shift,
        days: {
          ...entry.days,
          sun: nextPattern === "mon_sat" ? "off" : entry.shift,
        },
      };
    });

    const patternLabel = nextPattern === "mon_sat" ? "จ.-ส. (หยุด อา.)" : "จ.-อา. (ทุกวัน)";
    persistWeekSchedule(
      nextEntries,
      nextPattern,
      `เปลี่ยนรูปแบบวันทำงานเป็น ${patternLabel}`
    );
  };

  // Section-level 1-click: Set whole section to Day or Night for the entire week
  const handleSetSectionShiftAll = (
    sectionName: string,
    sectionEmployees: Employee[],
    targetShift: PrimaryShift
  ) => {
    if (sectionEmployees.length === 0) return;
    const nextEntries: Record<string, EmployeeWeeklyShiftEntry> = { ...effectiveEntries };
    sectionEmployees.forEach((emp) => {
      nextEntries[emp.employeeId] = {
        shift: targetShift,
        days: buildWeekDaysForShift(targetShift, workPattern),
      };
    });
    const shiftLabel = targetShift === "day" ? "กะเช้า" : "กะดึก";
    persistWeekSchedule(
      nextEntries,
      workPattern,
      `จัดทั้งส่วนงาน ${sectionName} → ${shiftLabel} (${sectionEmployees.length} คน)`,
      `จัดกะทั้งส่วนงาน (${selectedWeekStart}) ${sectionName} → ${shiftLabel}`,
      sectionName
    );
  };

  // Section-level 1-click: Swap Day ↔ Night for everyone assigned in that section
  const handleSwapSectionShifts = (sectionName: string, sectionEmployees: Employee[]) => {
    const assigned = sectionEmployees.filter((e) => Boolean(effectiveEntries[e.employeeId]));
    if (assigned.length === 0) {
      Swal.fire({
        icon: "info",
        title: "ยังไม่มีพนักงานที่กำหนดกะในสัปดาห์นี้",
        text: `ส่วนงาน "${sectionName}" ยังไม่ได้เลือกกะเช้าหรือกะดึกสำหรับสัปดาห์นี้`,
        confirmButtonText: "ตกลง",
      });
      return;
    }

    const nextEntries: Record<string, EmployeeWeeklyShiftEntry> = { ...effectiveEntries };
    assigned.forEach((emp) => {
      const prev = effectiveEntries[emp.employeeId];
      const swappedPrimary: PrimaryShift = prev.shift === "day" ? "night" : "day";
      const swappedDays: Record<DayKey, DailyShiftValue> = {
        mon: prev.days.mon === "day" ? "night" : prev.days.mon === "night" ? "day" : "off",
        tue: prev.days.tue === "day" ? "night" : prev.days.tue === "night" ? "day" : "off",
        wed: prev.days.wed === "day" ? "night" : prev.days.wed === "night" ? "day" : "off",
        thu: prev.days.thu === "day" ? "night" : prev.days.thu === "night" ? "day" : "off",
        fri: prev.days.fri === "day" ? "night" : prev.days.fri === "night" ? "day" : "off",
        sat: prev.days.sat === "day" ? "night" : prev.days.sat === "night" ? "day" : "off",
        sun: prev.days.sun === "day" ? "night" : prev.days.sun === "night" ? "day" : "off",
      };
      nextEntries[emp.employeeId] = {
        shift: swappedPrimary,
        days: swappedDays,
      };
    });

    persistWeekSchedule(
      nextEntries,
      workPattern,
      `สลับกะส่วนงาน ${sectionName} เรียบร้อย (${assigned.length} คน)`,
      `สลับกะทั้งส่วนงาน (${selectedWeekStart}) ${sectionName} จำนวน ${assigned.length} คน`,
      sectionName
    );
  };

  // Copy or Rotate (Day ↔ Night) from previous week in 1 click!
  const handleImportFromPreviousWeek = async (rotateShifts: boolean) => {
    setIsCopyingPrevWeek(true);
    try {
      const prevWeekStart = addDaysToYmd(selectedWeekStart, -7);
      const prevDoc = await fetchWeeklyShiftSchedule(prevWeekStart);

      // Build source entries from previous week doc (or current roster fallback if prev week is current week)
      const sourceEntries: Record<string, EmployeeWeeklyShiftEntry> = {};
      if (prevDoc?.entries && Object.keys(prevDoc.entries).length > 0) {
        Object.assign(sourceEntries, prevDoc.entries);
      } else if (prevWeekStart === currentWeekStartYmd) {
        employees.forEach((emp) => {
          if (emp.workShift === "day" || emp.workShift === "night") {
            sourceEntries[emp.employeeId] = {
              shift: emp.workShift,
              days: buildWeekDaysForShift(emp.workShift, workPattern),
            };
          }
        });
      }

      const sourceKeys = Object.keys(sourceEntries);
      if (sourceKeys.length === 0) {
        Swal.fire({
          icon: "info",
          title: "ไม่พบตารางกะของสัปดาห์ก่อน",
          text: `สัปดาห์เริ่มต้นวันที่ ${prevWeekStart} ยังไม่มีข้อมูลการจัดกะ`,
          confirmButtonText: "ตกลง",
        });
        return;
      }

      const existingCount = Object.keys(effectiveEntries).length;
      if (existingCount > 0) {
        const confirm = await Swal.fire({
          icon: "question",
          title: rotateShifts
            ? "สลับกะจากสัปดาห์ก่อน (เช้า ↔ ดึก)?"
            : "คัดลอกตารางกะจากสัปดาห์ก่อน?",
          text: `สัปดาห์นี้มีข้อมูลจัดกะอยู่แล้ว ${existingCount} คน ต้องการแทนที่ด้วยข้อมูลจากสัปดาห์ก่อน (${sourceKeys.length} คน) ใช่หรือไม่`,
          showCancelButton: true,
          confirmButtonText: rotateShifts ? "คัดลอกและสลับกะ" : "คัดลอกเหมือนเดิม",
          cancelButtonText: "ยกเลิก",
          confirmButtonColor: "#0284c7",
        });
        if (!confirm.isConfirmed) return;
      }

      const nextPattern = prevDoc?.workPattern || workPattern;
      const nextEntries: Record<string, EmployeeWeeklyShiftEntry> = {};

      sourceKeys.forEach((empId) => {
        const src = sourceEntries[empId];
        if (rotateShifts) {
          const rotatedPrimary: PrimaryShift = src.shift === "day" ? "night" : "day";
          const rotatedDays: Record<DayKey, DailyShiftValue> = {
            mon: src.days.mon === "day" ? "night" : src.days.mon === "night" ? "day" : "off",
            tue: src.days.tue === "day" ? "night" : src.days.tue === "night" ? "day" : "off",
            wed: src.days.wed === "day" ? "night" : src.days.wed === "night" ? "day" : "off",
            thu: src.days.thu === "day" ? "night" : src.days.thu === "night" ? "day" : "off",
            fri: src.days.fri === "day" ? "night" : src.days.fri === "night" ? "day" : "off",
            sat: src.days.sat === "day" ? "night" : src.days.sat === "night" ? "day" : "off",
            sun: src.days.sun === "day" ? "night" : src.days.sun === "night" ? "day" : "off",
          };
          nextEntries[empId] = { shift: rotatedPrimary, days: rotatedDays };
        } else {
          nextEntries[empId] = {
            shift: src.shift,
            days: { ...src.days },
          };
        }
      });

      setWorkPattern(nextPattern);
      persistWeekSchedule(
        nextEntries,
        nextPattern,
        rotateShifts
          ? `สลับกะจากสัปดาห์ก่อนเรียบร้อย (${sourceKeys.length} คน)`
          : `คัดลอกตารางกะจากสัปดาห์ก่อนเรียบร้อย (${sourceKeys.length} คน)`,
        rotateShifts
          ? `จัดกะสัปดาห์ ${selectedWeekStart}: สลับกะจากสัปดาห์ก่อน (${sourceKeys.length} คน)`
          : `จัดกะสัปดาห์ ${selectedWeekStart}: คัดลอกตารางจากสัปดาห์ก่อน (${sourceKeys.length} คน)`,
        selectedWeekStart
      );
    } finally {
      setIsCopyingPrevWeek(false);
    }
  };

  // Swap all visible employees in the selected week
  const handleSwapAllVisibleShifts = async () => {
    const visibleAssigned = filteredGroups.flatMap((g) =>
      g.employees.filter((e) => Boolean(effectiveEntries[e.employeeId]))
    );
    if (visibleAssigned.length === 0) {
      Swal.fire({
        icon: "info",
        title: "ยังไม่มีรายการที่กำหนดกะในสัปดาห์นี้",
        text: "กรุณาเลือกกะเช้าหรือกะดึกให้พนักงานก่อนทำการสลับกะทั้งหมด",
        confirmButtonText: "ตกลง",
      });
      return;
    }

    const result = await Swal.fire({
      icon: "question",
      title: "ยืนยันการสลับกะทั้งหมดของสัปดาห์นี้?",
      text: `ต้องการสลับกะทำงาน (กะเช้า ↔ กะดึก) สำหรับพนักงานที่แสดงอยู่จำนวน ${visibleAssigned.length} คน ใช่หรือไม่`,
      showCancelButton: true,
      confirmButtonText: "สลับกะทั้งหมด",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#0284c7",
    });
    if (!result.isConfirmed) return;

    const nextEntries: Record<string, EmployeeWeeklyShiftEntry> = { ...effectiveEntries };
    visibleAssigned.forEach((emp) => {
      const prev = effectiveEntries[emp.employeeId];
      const swappedPrimary: PrimaryShift = prev.shift === "day" ? "night" : "day";
      nextEntries[emp.employeeId] = {
        shift: swappedPrimary,
        days: {
          mon: prev.days.mon === "day" ? "night" : prev.days.mon === "night" ? "day" : "off",
          tue: prev.days.tue === "day" ? "night" : prev.days.tue === "night" ? "day" : "off",
          wed: prev.days.wed === "day" ? "night" : prev.days.wed === "night" ? "day" : "off",
          thu: prev.days.thu === "day" ? "night" : prev.days.thu === "night" ? "day" : "off",
          fri: prev.days.fri === "day" ? "night" : prev.days.fri === "night" ? "day" : "off",
          sat: prev.days.sat === "day" ? "night" : prev.days.sat === "night" ? "day" : "off",
          sun: prev.days.sun === "day" ? "night" : prev.days.sun === "night" ? "day" : "off",
        },
      };
    });

    persistWeekSchedule(
      nextEntries,
      workPattern,
      `สลับกะทั้งหมดของสัปดาห์นี้เรียบร้อย (${visibleAssigned.length} คน)`,
      `สลับกะทั้งสัปดาห์ (${selectedWeekStart}) จำนวน ${visibleAssigned.length} คน`,
      selectedWeekStart
    );
  };

  // Export Weekly Shift Schedule to Excel
  const handleExportExcel = () => {
    const rows: Record<string, string>[] = [];
    filteredGroups.forEach((group) => {
      group.employees.forEach((emp) => {
        const entry = effectiveEntries[emp.employeeId];
        const row: Record<string, string> = {
          ส่วนงาน: group.sectionName,
          ชื่อพนักงาน: emp.employeeName,
          กะหลักทั้งสัปดาห์:
            entry?.shift === "day"
              ? "กะเช้า"
              : entry?.shift === "night"
              ? "กะดึก"
              : "ยังไม่ระบุ",
        };
        weekDates.forEach((d) => {
          row[`${d.shortTh} ${d.dayNum} ${d.monthShortTh}`] = formatDayShiftThai(
            entry?.days[d.key]
          );
        });
        rows.push(row);
      });
    });

    if (rows.length === 0) {
      Swal.fire({
        icon: "info",
        title: "ไม่มีข้อมูลสำหรับส่งออก",
        text: "ไม่พบรายชื่อพนักงานในตารางปัจจุบัน",
        confirmButtonText: "ตกลง",
      });
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Week_${weekRangeInfo.weekNumber}`);
    XLSX.writeFile(wb, `Weekly_Shift_Schedule_${selectedWeekStart}.xlsx`);
  };

  const toggleSection = (sectionName: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionName]: !(prev[sectionName] ?? true),
    }));
  };

  const allExpanded = useMemo(
    () =>
      filteredGroups.length > 0 &&
      filteredGroups.every((g) => expandedSections[g.sectionName] ?? true),
    [filteredGroups, expandedSections]
  );

  const toggleExpandCollapseAll = () => {
    const nextValue = !allExpanded;
    const nextState: Record<string, boolean> = { ...expandedSections };
    filteredGroups.forEach((g) => {
      nextState[g.sectionName] = nextValue;
    });
    setExpandedSections(nextState);
  };

  const hasActiveFilters =
    Boolean(searchQuery.trim()) || sectionFilter !== "all" || shiftFilter !== "all";

  return (
    <div className="space-y-4">
      {/* Weekly Period Selector & One-Click Rotation Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Week Navigation */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-[#1e3a5f] dark:bg-[#0b1329]">
              <button
                type="button"
                onClick={() => setSelectedWeekStart((w) => addDaysToYmd(w, -7))}
                aria-label="สัปดาห์ก่อนหน้า"
                className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white hover:shadow-xs dark:text-slate-200 dark:hover:bg-[#162749]"
              >
                <ChevronLeft size={14} />
                <span>สัปดาห์ก่อน</span>
              </button>

              <div className="flex items-center gap-2 px-3 text-xs">
                <Calendar size={14} className="shrink-0 text-sky-600 dark:text-sky-400" />
                <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  สัปดาห์ที่ {weekRangeInfo.weekNumber}
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  ·
                </span>
                <span className="whitespace-nowrap font-semibold text-slate-700 dark:text-slate-200">
                  {weekRangeInfo.rangeText}
                </span>
                {isViewingCurrentWeek && (
                  <>
                    <span aria-hidden="true" className="text-slate-400">
                      ·
                    </span>
                    <span className="whitespace-nowrap font-semibold text-emerald-600 dark:text-emerald-400">
                      สัปดาห์ปัจจุบัน
                    </span>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedWeekStart((w) => addDaysToYmd(w, 7))}
                aria-label="สัปดาห์ถัดไป"
                className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-white hover:shadow-xs dark:text-slate-200 dark:hover:bg-[#162749]"
              >
                <span>สัปดาห์ถัดไป</span>
                <ChevronRight size={14} />
              </button>
            </div>

            {!isViewingCurrentWeek && (
              <button
                type="button"
                onClick={() => setSelectedWeekStart(currentWeekStartYmd)}
                className="inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200 dark:hover:bg-[#162749]"
              >
                กลับสัปดาห์นี้
              </button>
            )}

            <input
              type="date"
              value={selectedWeekStart}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedWeekStart(getWeekStartYmd(e.target.value));
                }
              }}
              aria-label="เลือกวันที่เพื่อข้ามไปยังสัปดาห์ที่ต้องการ"
              className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-sky-500 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200 dark:[color-scheme:dark]"
            />
          </div>

          {/* Right: Weekly Rotation & Pattern Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Work Pattern Switcher */}
            <div
              role="group"
              aria-label="รูปแบบวันทำงานประจำสัปดาห์"
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0b1329]"
            >
              <button
                type="button"
                onClick={() => handleChangeWorkPattern("mon_sat")}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  workPattern === "mon_sat"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-[#162749] dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                จ.–ส. (หยุด อา.)
              </button>
              <button
                type="button"
                onClick={() => handleChangeWorkPattern("mon_sun")}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  workPattern === "mon_sun"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-[#162749] dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                จ.–อา. (ทุกวัน)
              </button>
            </div>

            <button
              type="button"
              disabled={isCopyingPrevWeek}
              onClick={() => handleImportFromPreviousWeek(true)}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-600 px-3.5 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60"
            >
              <RefreshCw size={13} className={isCopyingPrevWeek ? "animate-spin" : ""} />
              <span>สลับกะจากสัปดาห์ก่อน (เช้า ↔ ดึก)</span>
            </button>

            <button
              type="button"
              disabled={isCopyingPrevWeek}
              onClick={() => handleImportFromPreviousWeek(false)}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200 dark:hover:bg-[#162749]"
            >
              <Copy size={13} />
              <span>คัดลอกสัปดาห์ก่อน</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-emerald-300 dark:hover:bg-emerald-500/15"
            >
              <FileSpreadsheet size={13} />
              <span>ส่งออก Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            พนักงานในตารางสัปดาห์นี้
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {stats.total.toLocaleString("en-US")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              คน · {stats.sectionCount} ส่วนงาน
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            กะเช้า (08:00 - 20:00)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {stats.day.toLocaleString("en-US")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">คน</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            กะดึก (20:00 - 08:00)
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
              {stats.night.toLocaleString("en-US")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">คน</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            ยังไม่จัดกะสัปดาห์นี้
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`font-mono text-2xl font-bold tabular-nums ${
                stats.unassigned > 0
                  ? "text-slate-700 dark:text-slate-200"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {stats.unassigned.toLocaleString("en-US")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">คน</span>
          </div>
        </div>
      </div>

      {/* Filter & Bulk Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 sm:max-w-[260px]">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อพนักงาน หรือส่วนงาน..."
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 outline-none transition focus:border-sky-500 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
            />
          </div>

          {/* Section Dropdown */}
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            aria-label="กรองตามส่วนงาน"
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 outline-none transition focus:border-sky-500 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200"
          >
            <option value="all">ทุกส่วนงาน ({allSectionNames.length})</option>
            {allSectionNames.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>

          {/* Shift Filter Segmented Control */}
          <div
            role="group"
            aria-label="กรองตามกะทำงาน"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0b1329]"
          >
            {(
              [
                { id: "all", label: "ทั้งหมด" },
                { id: "day", label: "กะเช้า" },
                { id: "night", label: "กะดึก" },
                { id: "unassigned", label: "ยังไม่จัด" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setShiftFilter(opt.id)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  shiftFilter === opt.id
                    ? "bg-white text-slate-900 shadow-xs dark:bg-[#162749] dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSectionFilter("all");
                setShiftFilter("all");
              }}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-300 dark:hover:bg-[#162749]"
            >
              <RotateCcw size={12} />
              <span>ล้างตัวกรอง</span>
            </button>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {inactiveCount > 0 && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-sky-600"
              />
              <span>แสดงผู้พ้นสภาพ ({inactiveCount})</span>
            </label>
          )}

          {filteredGroups.length > 0 && (
            <button
              type="button"
              onClick={toggleExpandCollapseAll}
              className="inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200 dark:hover:bg-[#162749]"
            >
              {allExpanded ? "ย่อทุกส่วนงาน" : "ขยายทุกส่วนงาน"}
            </button>
          )}

          <button
            type="button"
            onClick={handleSwapAllVisibleShifts}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200 dark:hover:bg-[#162749]"
          >
            <ArrowLeftRight size={13} />
            <span>สลับกะสัปดาห์นี้ทั้งหมด</span>
          </button>
        </div>
      </div>

      {/* Main Weekly Shift Matrix Table Grouped by Section */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-[#1e3a5f]">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-sky-600 dark:text-sky-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              ตารางจัดกะทำงานรายสัปดาห์แยกตามส่วนงาน
            </h2>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isLoadingWeek ? (
              <span>กำลังโหลดข้อมูลสัปดาห์...</span>
            ) : statusFeedback ? (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {statusFeedback}
              </span>
            ) : (
              <span>
                คลิก กะเช้า / กะดึก เพื่อจัดทั้งสัปดาห์ในครั้งเดียว · คลิกช่องรายวันเพื่อปรับเฉพาะวัน (เช้า / ดึก / หยุด)
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-300">
                <th className="w-[72px] whitespace-nowrap px-4 py-2.5">รูปพนักงาน</th>
                <th className="min-w-[170px] whitespace-nowrap px-4 py-2.5">ชื่อพนักงาน</th>
                <th className="w-[210px] whitespace-nowrap px-3 py-2.5 text-center">
                  จัดกะทั้งสัปดาห์
                </th>
                {weekDates.map((d) => {
                  const isToday = d.ymd === todayYmd;
                  const dayTot = dailyTotals[d.key];
                  return (
                    <th
                      key={d.key}
                      className={`w-[70px] whitespace-nowrap px-1.5 py-2 text-center ${
                        isToday ? "bg-sky-50/90 dark:bg-sky-950/50" : ""
                      }`}
                    >
                      <div
                        className={`text-xs font-bold ${
                          isToday
                            ? "text-sky-700 dark:text-sky-300"
                            : d.key === "sun"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {d.shortTh} {d.dayNum}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
                        <span className="text-amber-600 dark:text-amber-400">{dayTot.day}</span>
                        {" / "}
                        <span className="text-indigo-600 dark:text-indigo-400">{dayTot.night}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {filteredGroups.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    {employees.length === 0
                      ? "ยังไม่มีรายชื่อพนักงานในระบบ กรุณาเพิ่มพนักงานในแท็บ ทะเบียนพนักงาน & สิทธิ์ส่วนงาน ก่อน"
                      : "ไม่พบพนักงานที่ตรงกับเงื่อนไขการค้นหา"}
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group) => {
                  const isExpanded = expandedSections[group.sectionName] ?? true;
                  return (
                    <React.Fragment key={group.sectionName}>
                      {/* Section Group Header Row */}
                      <tr className="bg-slate-100/80 dark:bg-[#0d1a33]">
                        <td colSpan={10} className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => toggleSection(group.sectionName)}
                              className="inline-flex items-center gap-2 text-left text-xs font-bold text-slate-900 transition hover:text-sky-700 dark:text-slate-100 dark:hover:text-sky-300"
                            >
                              {isExpanded ? (
                                <ChevronDown size={15} className="shrink-0 text-slate-500" />
                              ) : (
                                <ChevronRight size={15} className="shrink-0 text-slate-500" />
                              )}
                              <span className="text-sm font-bold">{group.sectionName}</span>
                              <span className="font-mono text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">
                                {group.employees.length} คน · กะเช้า {group.dayCount} · กะดึก{" "}
                                {group.nightCount}
                                {group.unassignedCount > 0
                                  ? ` · ยังไม่จัด ${group.unassignedCount}`
                                  : ""}
                              </span>
                            </button>

                            {/* Quick Section Weekly Actions */}
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleSetSectionShiftAll(
                                    group.sectionName,
                                    group.employees,
                                    "day"
                                  )
                                }
                                title="ตั้งทั้งส่วนงานเป็นกะเช้าทั้งสัปดาห์"
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-amber-300 dark:hover:bg-amber-500/15"
                              >
                                <Sun size={12} />
                                <span>เช้าทั้งส่วน</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleSetSectionShiftAll(
                                    group.sectionName,
                                    group.employees,
                                    "night"
                                  )
                                }
                                title="ตั้งทั้งส่วนงานเป็นกะดึกทั้งสัปดาห์"
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-indigo-300 dark:hover:bg-indigo-500/15"
                              >
                                <Moon size={12} />
                                <span>ดึกทั้งส่วน</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleSwapSectionShifts(group.sectionName, group.employees)
                                }
                                title="สลับกะเช้า ↔ กะดึกทั้งส่วนงาน"
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-50 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-sky-300 dark:hover:bg-sky-500/15"
                              >
                                <ArrowLeftRight size={12} />
                                <span>สลับกะส่วนงาน</span>
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Employee Rows: ONLY Photo, Name, Weekly 1-Click Shift, and Mon-Sun Grid */}
                      {isExpanded &&
                        group.employees.map((emp) => {
                          const showPhoto =
                            Boolean(emp.photoUrl) && !brokenPhotoIds[emp.employeeId];
                          const entry = effectiveEntries[emp.employeeId];
                          const isDay = entry?.shift === "day";
                          const isNight = entry?.shift === "night";

                          return (
                            <tr
                              key={emp.id || emp.employeeId}
                              className="transition-colors hover:bg-slate-50/90 dark:hover:bg-[#162749]/40"
                            >
                              {/* Column 1: Employee Photo */}
                              <td className="px-4 py-2">
                                {showPhoto ? (
                                  <img
                                    src={emp.photoUrl}
                                    alt={emp.employeeName}
                                    referrerPolicy="no-referrer"
                                    onError={() =>
                                      setBrokenPhotoIds((prev) => ({
                                        ...prev,
                                        [emp.employeeId]: true,
                                      }))
                                    }
                                    className="h-10 w-10 rounded-full border border-slate-200 object-cover dark:border-[#2a4570]"
                                  />
                                ) : (
                                  <div
                                    aria-label={emp.employeeName}
                                    className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-bold text-slate-600 dark:border-[#2a4570] dark:bg-[#162749] dark:text-slate-200"
                                  >
                                    {getEmployeeInitials(emp.employeeName)}
                                  </div>
                                )}
                              </td>

                              {/* Column 2: Employee Name */}
                              <td className="px-4 py-2">
                                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {emp.employeeName}
                                </div>
                              </td>

                              {/* Column 3: One-Click Whole Week Shift Selector */}
                              <td className="px-3 py-2 text-center">
                                <div
                                  role="radiogroup"
                                  aria-label={`เลือกกะทั้งสัปดาห์สำหรับ ${emp.employeeName}`}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-[#1e3a5f] dark:bg-[#0b1329]"
                                >
                                  <button
                                    type="button"
                                    role="radio"
                                    aria-checked={isDay}
                                    onClick={() => handleSetEmployeeWeeklyShift(emp, "day")}
                                    className={`inline-flex min-h-[34px] items-center justify-center gap-1 whitespace-nowrap rounded-md px-3 py-1 text-xs font-bold transition ${
                                      isDay
                                        ? "bg-amber-500 text-white shadow-xs"
                                        : "text-slate-600 hover:bg-white/70 hover:text-amber-700 dark:text-slate-400 dark:hover:bg-[#162749] dark:hover:text-amber-300"
                                    }`}
                                  >
                                    <Sun size={13} className="shrink-0" />
                                    <span>กะเช้า</span>
                                  </button>

                                  <button
                                    type="button"
                                    role="radio"
                                    aria-checked={isNight}
                                    onClick={() => handleSetEmployeeWeeklyShift(emp, "night")}
                                    className={`inline-flex min-h-[34px] items-center justify-center gap-1 whitespace-nowrap rounded-md px-3 py-1 text-xs font-bold transition ${
                                      isNight
                                        ? "bg-indigo-600 text-white shadow-xs"
                                        : "text-slate-600 hover:bg-white/70 hover:text-indigo-700 dark:text-slate-400 dark:hover:bg-[#162749] dark:hover:text-indigo-300"
                                    }`}
                                  >
                                    <Moon size={13} className="shrink-0" />
                                    <span>กะดึก</span>
                                  </button>
                                </div>
                              </td>

                              {/* Columns 4-10: Mon-Sun Interactive Day Cells */}
                              {weekDates.map((d) => {
                                const dayVal = entry?.days[d.key];
                                const isToday = d.ymd === todayYmd;
                                return (
                                  <td
                                    key={d.key}
                                    className={`px-1 py-2 text-center ${
                                      isToday ? "bg-sky-50/40 dark:bg-sky-950/20" : ""
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleCycleEmployeeSingleDay(emp, d.key)}
                                      title={`${emp.employeeName} · วัน${d.fullTh} ${d.dayNum} ${d.monthShortTh}: ${formatDayShiftThai(
                                        dayVal
                                      )} (คลิกเพื่อสลับ เช้า / ดึก / หยุด)`}
                                      className={`inline-flex h-8 w-14 items-center justify-center whitespace-nowrap rounded-md border text-[11px] font-bold transition ${
                                        dayVal === "day"
                                          ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
                                          : dayVal === "night"
                                          ? "border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/30"
                                          : dayVal === "off"
                                          ? "border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-200/80 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-500 dark:hover:bg-[#162749]"
                                          : "border-dashed border-slate-300 bg-transparent text-slate-400 hover:border-sky-400 hover:text-sky-600 dark:border-[#243d66] dark:text-slate-500 dark:hover:border-sky-500 dark:hover:text-sky-300"
                                      }`}
                                    >
                                      {dayVal === "day"
                                        ? "เช้า"
                                        : dayVal === "night"
                                        ? "ดึก"
                                        : dayVal === "off"
                                        ? "หยุด"
                                        : "—"}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
