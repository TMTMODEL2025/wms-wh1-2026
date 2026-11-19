/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  Copy,
  Users,
  User,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Search,
  RefreshCw,
  X,
  Check,
  Sun,
  Moon,
  Plus,
  MapPin,
  RotateCcw,
} from "lucide-react";
import { Employee, Vehicle } from "../types/officer";
import {
  MH_TEAMS,
  MH_SHIFTS,
  MH_WORK_AREAS,
  MH_END_TIMES_BY_SHIFT,
  MhDailyDutyRecord,
  buildMhDailyDutyDocId,
  loadCachedMhDailyDuties,
  subscribeToMhDailyDuties,
  fetchMhDailyDutiesOnce,
  saveMhDailyDutyToCloud,
  saveMhDailyDutiesBatchToCloud,
  deleteMhDailyDutyFromCloud,
  formatForkliftNowTimestamp,
} from "../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";

interface DailyDutyAssignmentPanelProps {
  employees: Employee[];
  vehicles: Vehicle[];
  duties?: MhDailyDutyRecord[];
  onDutiesChange?: (updated: MhDailyDutyRecord[]) => void;
  defaultDate?: string;
  compact?: boolean;
}

interface RosterTableRow {
  rowKey: string;
  employeeId?: string;
  employeeName: string;
  isAssigned: boolean;
  dutyId: string;
  shift: string;
  vehicleNumber: string;
  workArea: string;
  team: string;
  endTime: string;
  notes: string;
  existingRecord?: MhDailyDutyRecord;
}

function getTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getYesterdayYmd(fromYmd: string): string {
  const parsed = new Date(`${fromYmd}T12:00:00`);
  if (isNaN(parsed.getTime())) return getTodayYmd();
  parsed.setDate(parsed.getDate() - 1);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function getEndTimesForShift(shiftVal: string): readonly string[] {
  return MH_END_TIMES_BY_SHIFT[shiftVal] || MH_END_TIMES_BY_SHIFT["กะเช้า"];
}

function normalizeEndTimeForShift(shiftVal: string, currentEndTime?: string): string {
  const allowed = getEndTimesForShift(shiftVal);
  const clean = String(currentEndTime || "").trim();
  return allowed.includes(clean) ? clean : allowed[0];
}

const CUSTOM_WORK_AREAS_STORAGE_KEY = "tmt_wms_mh_custom_work_areas_v1";

function loadStoredWorkAreas(): string[] {
  if (typeof window === "undefined") return [...MH_WORK_AREAS];
  try {
    const raw = window.localStorage.getItem(CUSTOM_WORK_AREAS_STORAGE_KEY);
    if (!raw) return [...MH_WORK_AREAS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const cleaned = parsed
        .map((item) => String(item || "").trim())
        .filter((item) => item && item !== "-");
      if (cleaned.length > 0) return Array.from(new Set(cleaned));
    }
  } catch {
    // ignore storage errors
  }
  return [...MH_WORK_AREAS];
}

function saveStoredWorkAreas(areas: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_WORK_AREAS_STORAGE_KEY, JSON.stringify(areas));
  } catch {
    // ignore storage errors
  }
}

export function DailyDutyAssignmentPanel({
  employees,
  vehicles,
  duties: externalDuties,
  onDutiesChange,
  defaultDate,
  compact = false,
}: DailyDutyAssignmentPanelProps) {
  const [internalDuties, setInternalDuties] = useState<MhDailyDutyRecord[]>(() =>
    loadCachedMhDailyDuties()
  );
  const allDuties = externalDuties ?? internalDuties;

  const setAllDuties = (
    updater: MhDailyDutyRecord[] | ((prev: MhDailyDutyRecord[]) => MhDailyDutyRecord[])
  ) => {
    const next = typeof updater === "function" ? updater(allDuties) : updater;
    if (!externalDuties) {
      setInternalDuties(next);
    }
    onDutiesChange?.(next);
  };

  // Subscribe only if parent is not already managing duties externally
  useEffect(() => {
    if (externalDuties) return;
    const unsub = subscribeToMhDailyDuties((cloudRecords) => {
      setInternalDuties(cloudRecords);
      onDutiesChange?.(cloudRecords);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(externalDuties)]);

  const [selectedDate, setSelectedDate] = useState<string>(() => defaultDate || getTodayYmd());
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterTeam, setFilterTeam] = useState<string>("All");
  const [filterShift, setFilterShift] = useState<string>("All");
  const [filterStatus, setFilterStatus] = useState<"all" | "assigned" | "unassigned">("all");
  const [draftNotesByKey, setDraftNotesByKey] = useState<Record<string, string>>({});
  const [workAreaOptions, setWorkAreaOptions] = useState<string[]>(() => loadStoredWorkAreas());
  const [addingWorkAreaForRow, setAddingWorkAreaForRow] = useState<string | null>(null);
  const [newWorkAreaText, setNewWorkAreaText] = useState<string>("");
  const [isManageWorkAreasOpen, setIsManageWorkAreasOpen] = useState<boolean>(false);
  const [headerNewWorkAreaText, setHeaderNewWorkAreaText] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const isMhFleetDepartment = (dept?: string): boolean => {
    const clean = String(dept || "").trim().toLowerCase();
    return (
      clean === "material handling - fleet" ||
      (clean.includes("material handling") && clean.includes("fleet"))
    );
  };

  const activeEmployees = useMemo(
    () =>
      employees.filter(
        (e) => e.employmentStatus === "Active" && isMhFleetDepartment(e.department)
      ),
    [employees]
  );

  // Exclude employees known to belong to other departments
  const nonMhFleetEmployeeSet = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (!isMhFleetDepartment(e.department)) {
        if (e.employeeName) set.add(e.employeeName.trim().toLowerCase());
        if (e.employeeId) set.add(e.employeeId.trim().toLowerCase());
      }
    });
    return set;
  }, [employees]);

  const isDutyAllowedForMhFleet = (d: MhDailyDutyRecord): boolean => {
    const nameKey = String(d.employeeName || "").trim().toLowerCase();
    const idKey = String(d.employeeId || "").trim().toLowerCase();
    if (nameKey && nonMhFleetEmployeeSet.has(nameKey)) return false;
    if (idKey && nonMhFleetEmployeeSet.has(idKey)) return false;
    return true;
  };

  const activeVehicles = useMemo(
    () => vehicles.filter((v) => v.activeStatus === "Active"),
    [vehicles]
  );

  const dutiesForDate = useMemo(
    () =>
      allDuties.filter(
        (d) => d.workingDate === selectedDate && isDutyAllowedForMhFleet(d)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allDuties, selectedDate, nonMhFleetEmployeeSet]
  );

  // Build unified roster rows combining all Material Handling - Fleet employees + any saved duty for selectedDate
  const allRosterRows = useMemo<RosterTableRow[]>(() => {
    const rows: RosterTableRow[] = [];
    const seenNameKeys = new Set<string>();
    const defaultVehicle = activeVehicles[0]?.vehicleId || "-";
    const defaultArea = workAreaOptions[0] || MH_WORK_AREAS[0] || "-";

    activeEmployees.forEach((emp) => {
      const cleanName = emp.employeeName.trim();
      const nameKey = cleanName.toLowerCase();
      seenNameKeys.add(nameKey);

      const matchedDuty = dutiesForDate.find(
        (d) =>
          d.employeeName.trim().toLowerCase() === nameKey ||
          (emp.employeeId && d.employeeId === emp.employeeId)
      );

      const shiftVal = matchedDuty?.shift || MH_SHIFTS[0];
      const dutyId =
        matchedDuty?.id || buildMhDailyDutyDocId(selectedDate, emp.employeeId || cleanName);

      rows.push({
        rowKey: emp.employeeId || cleanName,
        employeeId: emp.employeeId,
        employeeName: cleanName,
        isAssigned: Boolean(matchedDuty),
        dutyId,
        shift: shiftVal,
        vehicleNumber: matchedDuty?.vehicleNumber || defaultVehicle,
        workArea: matchedDuty?.workArea || defaultArea,
        team: matchedDuty?.team || MH_TEAMS[0],
        endTime: normalizeEndTimeForShift(shiftVal, matchedDuty?.endTime),
        notes: matchedDuty?.notes || "",
        existingRecord: matchedDuty,
      });
    });

    // Also include any saved duty on selectedDate not already in activeEmployees
    dutiesForDate.forEach((d) => {
      const cleanName = d.employeeName.trim();
      const nameKey = cleanName.toLowerCase();
      if (seenNameKeys.has(nameKey)) return;
      seenNameKeys.add(nameKey);

      const shiftVal = d.shift || MH_SHIFTS[0];
      rows.push({
        rowKey: d.id,
        employeeId: d.employeeId,
        employeeName: cleanName,
        isAssigned: true,
        dutyId: d.id,
        shift: shiftVal,
        vehicleNumber: d.vehicleNumber || defaultVehicle,
        workArea: d.workArea || defaultArea,
        team: d.team || MH_TEAMS[0],
        endTime: normalizeEndTimeForShift(shiftVal, d.endTime),
        notes: d.notes || "",
        existingRecord: d,
      });
    });

    return rows;
  }, [activeEmployees, dutiesForDate, activeVehicles, selectedDate, workAreaOptions]);

  const totalEmployeeCount = allRosterRows.length;
  const assignedCount = useMemo(
    () => allRosterRows.filter((r) => r.isAssigned).length,
    [allRosterRows]
  );
  const unassignedCount = Math.max(0, totalEmployeeCount - assignedCount);

  const assignedPercent = useMemo(() => {
    if (totalEmployeeCount === 0) return 0;
    return Math.min(100, Math.round((assignedCount / totalEmployeeCount) * 100));
  }, [totalEmployeeCount, assignedCount]);

  // Determine source date available to copy from (yesterday first, else latest date < selectedDate)
  const previousCopySource = useMemo(() => {
    const yesterday = getYesterdayYmd(selectedDate);
    const yesterdayRows = allDuties.filter(
      (d) => d.workingDate === yesterday && isDutyAllowedForMhFleet(d)
    );
    if (yesterdayRows.length > 0) {
      return { date: yesterday, rows: yesterdayRows };
    }
    const priorDates = Array.from(
      new Set(
        allDuties
          .filter((d) => isDutyAllowedForMhFleet(d))
          .map((d) => d.workingDate)
          .filter((dt) => dt && dt < selectedDate)
      )
    ).sort((a, b) => b.localeCompare(a));

    if (priorDates.length > 0) {
      const latestPrior = priorDates[0];
      return {
        date: latestPrior,
        rows: allDuties.filter(
          (d) => d.workingDate === latestPrior && isDutyAllowedForMhFleet(d)
        ),
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDuties, selectedDate, nonMhFleetEmployeeSet]);

  // Summary counters for selectedDate
  const teamCounts = useMemo(() => {
    const counts: Record<string, number> = { "ทีม A": 0, "ทีม B": 0, "ทีม C": 0 };
    dutiesForDate.forEach((d) => {
      counts[d.team] = (counts[d.team] || 0) + 1;
    });
    return counts;
  }, [dutiesForDate]);

  const shiftCounts = useMemo(() => {
    const counts: Record<string, number> = { กะเช้า: 0, กะดึก: 0 };
    dutiesForDate.forEach((d) => {
      counts[d.shift] = (counts[d.shift] || 0) + 1;
    });
    return counts;
  }, [dutiesForDate]);

  const filteredRosterRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allRosterRows.filter((row) => {
      if (filterStatus === "assigned" && !row.isAssigned) return false;
      if (filterStatus === "unassigned" && row.isAssigned) return false;
      if (filterTeam !== "All") {
        if (!row.isAssigned || row.team !== filterTeam) return false;
      }
      if (filterShift !== "All") {
        if (!row.isAssigned || row.shift !== filterShift) return false;
      }
      if (!q) return true;
      return (
        row.employeeName.toLowerCase().includes(q) ||
        row.workArea.toLowerCase().includes(q) ||
        row.vehicleNumber.toLowerCase().includes(q) ||
        row.team.toLowerCase().includes(q) ||
        row.shift.toLowerCase().includes(q) ||
        (row.notes || "").toLowerCase().includes(q)
      );
    });
  }, [allRosterRows, filterStatus, filterTeam, filterShift, searchQuery]);

  // Save or update an employee row directly from the table
  const handleUpsertRosterRow = async (
    row: RosterTableRow,
    patch: Partial<
      Pick<
        MhDailyDutyRecord,
        "team" | "shift" | "workArea" | "vehicleNumber" | "endTime" | "notes"
      >
    >
  ) => {
    const { timestamp } = formatForkliftNowTimestamp();
    const supervisorLabel = getActiveRecorderDisplay("Supervisor").label;
    const nextShift = patch.shift ?? row.shift;
    const nextEndTime =
      patch.endTime !== undefined
        ? patch.endTime
        : patch.shift
        ? normalizeEndTimeForShift(patch.shift, row.endTime)
        : row.endTime;

    const updatedRecord: MhDailyDutyRecord = {
      id: row.dutyId,
      workingDate: selectedDate,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      shift: nextShift,
      vehicleNumber: patch.vehicleNumber ?? row.vehicleNumber,
      workArea: patch.workArea ?? row.workArea,
      team: patch.team ?? row.team,
      endTime: nextEndTime,
      notes:
        patch.notes !== undefined
          ? patch.notes.trim() || undefined
          : row.notes.trim() || undefined,
      supervisorName: supervisorLabel,
      createdAt: row.existingRecord?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    const cleanNameKey = row.employeeName.trim().toLowerCase();
    setAllDuties((prev) => {
      const remaining = prev.filter(
        (d) =>
          d.id !== updatedRecord.id &&
          !(
            d.workingDate === selectedDate &&
            d.employeeName.trim().toLowerCase() === cleanNameKey
          )
      );
      return [updatedRecord, ...remaining];
    });

    await saveMhDailyDutyToCloud(updatedRecord);
    void appendWmsActivityLog({
      module: "Manpower Planning",
      sectionId: "fleet_ops",
      reference: selectedDate,
      activity: `กำหนดงาน ${row.employeeName} (${updatedRecord.team} · ${updatedRecord.shift} · รถ ${updatedRecord.vehicleNumber} · ${updatedRecord.workArea} · เลิกงาน ${updatedRecord.endTime})`,
      status: "Completed",
    });
  };

  // Add a new work area option (from a row cell or from the header manager)
  const handleAddWorkAreaOption = async (rawAreaName: string, targetRow?: RosterTableRow) => {
    const cleanArea = rawAreaName.trim();
    if (!cleanArea || cleanArea === "-") {
      setFeedback({ type: "error", text: "กรุณาระบุชื่อพื้นที่รับผิดชอบที่ต้องการเพิ่ม" });
      return;
    }

    const exists = workAreaOptions.some(
      (opt) => opt.trim().toLowerCase() === cleanArea.toLowerCase()
    );
    const resolvedArea =
      workAreaOptions.find((opt) => opt.trim().toLowerCase() === cleanArea.toLowerCase()) ||
      cleanArea;

    if (!exists) {
      const nextOptions = [...workAreaOptions, cleanArea];
      setWorkAreaOptions(nextOptions);
      saveStoredWorkAreas(nextOptions);
    }

    setAddingWorkAreaForRow(null);
    setNewWorkAreaText("");
    setHeaderNewWorkAreaText("");

    if (targetRow) {
      await handleUpsertRosterRow(targetRow, { workArea: resolvedArea });
      setFeedback({
        type: "success",
        text: `เพิ่มพื้นที่รับผิดชอบ "${resolvedArea}" และกำหนดให้ ${targetRow.employeeName} เรียบร้อยแล้ว`,
      });
    } else {
      setFeedback({
        type: "success",
        text: `เพิ่มพื้นที่รับผิดชอบ "${resolvedArea}" เข้าในรายการเรียบร้อยแล้ว`,
      });
    }
  };

  // Delete a work area option from the list (and clear/update the row if triggered from a row)
  const handleDeleteWorkAreaOption = async (areaToDelete: string, targetRow?: RosterTableRow) => {
    const cleanTarget = String(areaToDelete || "").trim();
    if (!cleanTarget || cleanTarget === "-") {
      if (targetRow && targetRow.workArea !== "-") {
        await handleUpsertRosterRow(targetRow, { workArea: "-" });
      }
      return;
    }

    const nextOptions = workAreaOptions.filter(
      (opt) => opt.trim().toLowerCase() !== cleanTarget.toLowerCase()
    );
    setWorkAreaOptions(nextOptions);
    saveStoredWorkAreas(nextOptions);

    if (targetRow) {
      const fallbackArea = nextOptions[0] || "-";
      await handleUpsertRosterRow(targetRow, { workArea: fallbackArea });
    }

    setFeedback({
      type: "success",
      text: `ลบพื้นที่รับผิดชอบ "${cleanTarget}" ออกจากตัวเลือกเรียบร้อยแล้ว`,
    });
  };

  const handleRestoreDefaultWorkAreas = () => {
    const defaults = [...MH_WORK_AREAS];
    setWorkAreaOptions(defaults);
    saveStoredWorkAreas(defaults);
    setFeedback({
      type: "success",
      text: "คืนค่ารายการพื้นที่รับผิดชอบเริ่มต้นเรียบร้อยแล้ว",
    });
  };

  const handleAssignAllUnassigned = async () => {
    const unassignedRows = allRosterRows.filter((r) => !r.isAssigned);
    if (unassignedRows.length === 0) return;

    setIsSaving(true);
    try {
      const { timestamp } = formatForkliftNowTimestamp();
      const supervisorLabel = getActiveRecorderDisplay("Supervisor").label;
      const newRecords: MhDailyDutyRecord[] = unassignedRows.map((row) => ({
        id: row.dutyId,
        workingDate: selectedDate,
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        shift: row.shift,
        vehicleNumber: row.vehicleNumber,
        workArea: row.workArea,
        team: row.team,
        endTime: row.endTime,
        notes: row.notes.trim() || undefined,
        supervisorName: supervisorLabel,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));

      const newIds = new Set(newRecords.map((r) => r.id));
      setAllDuties((prev) => [...newRecords, ...prev.filter((d) => !newIds.has(d.id))]);
      await saveMhDailyDutiesBatchToCloud(newRecords);
      setFeedback({
        type: "success",
        text: `มอบหมายงานให้พนักงานที่เหลือ ${newRecords.length} คน เรียบร้อยแล้ว`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyPreviousDay = async () => {
    if (!previousCopySource || previousCopySource.rows.length === 0) {
      setFeedback({
        type: "error",
        text: "ไม่พบข้อมูลตารางมอบหมายงานของวันก่อนหน้าสำหรับคัดลอก",
      });
      return;
    }

    setIsSaving(true);
    try {
      const { timestamp } = formatForkliftNowTimestamp();
      const existingNames = new Set(
        dutiesForDate.map((d) => d.employeeName.trim().toLowerCase())
      );

      const newRecords: MhDailyDutyRecord[] = [];
      previousCopySource.rows.forEach((src) => {
        if (existingNames.has(src.employeeName.trim().toLowerCase())) {
          return;
        }
        const newId = buildMhDailyDutyDocId(
          selectedDate,
          src.employeeId || src.employeeName
        );
        newRecords.push({
          id: newId,
          workingDate: selectedDate,
          employeeId: src.employeeId,
          employeeName: src.employeeName,
          workArea: src.workArea,
          vehicleNumber: src.vehicleNumber,
          shift: src.shift,
          team: src.team,
          endTime: src.endTime || (src.shift === "กะดึก" ? "05:00" : "17:00"),
          notes: src.notes,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });

      if (newRecords.length === 0) {
        setFeedback({
          type: "success",
          text: `พนักงานทุกคนจากวันที่ ${previousCopySource.date} ถูกมอบหมายงานในวันที่ ${selectedDate} ครบแล้ว`,
        });
        return;
      }

      setAllDuties([...newRecords, ...allDuties]);
      await saveMhDailyDutiesBatchToCloud(newRecords);
      setFeedback({
        type: "success",
        text: `คัดลอกตารางมอบหมายงานจากวันที่ ${previousCopySource.date} จำนวน ${newRecords.length} คน มาวันที่ ${selectedDate} เรียบร้อยแล้ว`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDuty = async (id: string) => {
    setAllDuties(allDuties.filter((d) => d.id !== id));
    setConfirmDeleteId(null);
    await deleteMhDailyDutyFromCloud(id);
    setFeedback({ type: "success", text: "ยกเลิกการมอบหมายงานของพนักงานเรียบร้อยแล้ว" });
  };

  const handleRefreshCloud = async () => {
    setIsRefreshing(true);
    try {
      const latest = await fetchMhDailyDutiesOnce();
      setAllDuties(latest);
      setFeedback({ type: "success", text: "ซิงค์ข้อมูลมอบหมายงานล่าสุดแล้ว" });
    } finally {
      setIsRefreshing(false);
    }
  };

  // SVG progress circle math for KPI Card 1
  const circleRadius = 22;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleStrokeDashoffset =
    circleCircumference - (assignedPercent / 100) * circleCircumference;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#1d4ed8]/45 bg-gradient-to-br from-[#040d21] via-[#071636] to-[#040b1d] p-3 text-slate-100 shadow-[0_20px_50px_rgba(2,8,23,0.75)] sm:p-5">
      {/* Subtle Ambient Blue Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/4 h-72 w-96 rounded-full bg-cyan-500/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 right-1/4 h-72 w-96 rounded-full bg-blue-600/10 blur-3xl"
      />

      <div className="relative z-10 space-y-4">
        {/* Feedback Alert Toast */}
        {feedback && (
          <div
            role="alert"
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold backdrop-blur-md transition ${
              feedback.type === "error"
                ? "border-rose-500/50 bg-rose-950/80 text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.25)]"
                : "border-emerald-500/50 bg-emerald-950/80 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {feedback.type === "error" ? (
                <AlertTriangle size={16} className="shrink-0 text-rose-400" />
              ) : (
                <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
              )}
              <span>{feedback.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white"
              aria-label="ปิดการแจ้งเตือน"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* =====================================================================
            SECTION 1: ENTERPRISE HEADER BANNER & CONTROL BAR
        ===================================================================== */}
        <div className="overflow-hidden rounded-2xl border border-sky-400/30 bg-gradient-to-r from-[#071a42] via-[#0c2966] to-[#081d4a] shadow-[0_8px_30px_rgba(3,12,38,0.65)]">
          {/* Top Hero Banner with Industrial Warehouse Silhouette & Team Emblem */}
          {!compact && (
            <div className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden border-b border-sky-400/25 px-5 py-4 sm:px-6 sm:py-5">
              {/* Subtle Industrial Warehouse Ceiling Trusses & Perspective Grid Pattern */}
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
                preserveAspectRatio="none"
                viewBox="0 0 1200 160"
              >
                <defs>
                  <linearGradient id="whGridGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.05" />
                    <stop offset="65%" stopColor="#38bdf8" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity="0.15" />
                  </linearGradient>
                </defs>
                <path
                  d="M550,0 L700,160 M650,0 L820,160 M750,0 L940,160 M850,0 L1060,160 M950,0 L1180,160 M500,35 L1200,35 M520,75 L1200,75 M540,115 L1200,115"
                  stroke="url(#whGridGrad)"
                  strokeWidth="1.2"
                  fill="none"
                />
                <polygon
                  points="440,0 520,0 430,160 350,160"
                  fill="#38bdf8"
                  fillOpacity="0.07"
                />
                <polygon
                  points="540,0 590,0 500,160 450,160"
                  fill="#38bdf8"
                  fillOpacity="0.05"
                />
              </svg>

              {/* Left Brand & Title */}
              <div className="relative z-10 flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/40 bg-gradient-to-br from-sky-400/30 via-blue-600/40 to-indigo-900/60 text-white shadow-[0_0_25px_rgba(56,189,248,0.35)]">
                  <Users size={28} className="text-cyan-200" />
                </div>
                <div>
                  <h1 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                    วางแผนกำลังคน
                  </h1>
                  <p className="mt-0.5 text-xs font-medium text-sky-200/90 sm:text-sm">
                    กำหนดหน้าที่รับผิดชอบพนักงานประจำวันในตารางได้ทันที: 1.กะทำงาน 2.รถที่ขึ้นขับ 3.พื้นที่รับผิดชอบ 4.ทีม A/B/C และ 5.เวลาเลิกงาน
                  </p>
                </div>
              </div>

              {/* Right Outlined Team Vector Illustration */}
              <div className="relative z-10 hidden items-center pr-2 md:flex" aria-hidden="true">
                <svg
                  width="126"
                  height="68"
                  viewBox="0 0 126 68"
                  fill="none"
                  className="text-sky-200/80 drop-shadow-[0_0_12px_rgba(56,189,248,0.35)]"
                >
                  <circle cx="28" cy="24" r="10" stroke="currentColor" strokeWidth="2.5" />
                  <path
                    d="M10 58C10 46.9543 18.0589 40 28 40C37.9411 40 46 46.9543 46 58"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle cx="98" cy="24" r="10" stroke="currentColor" strokeWidth="2.5" />
                  <path
                    d="M80 58C80 46.9543 88.0589 40 98 40C107.941 40 116 46.9543 116 58"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="63"
                    cy="19"
                    r="12"
                    fill="#09214f"
                    stroke="#7dd3fc"
                    strokeWidth="2.8"
                  />
                  <path
                    d="M40 60C40 46.7452 50.2975 37 63 37C75.7025 37 86 46.7452 86 60"
                    fill="#09214f"
                    stroke="#7dd3fc"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          )}

          {/* Control Bar Below Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#061536]/90 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-3 sm:gap-5">
              {/* Working Date Picker */}
              <div className="flex items-center gap-2.5">
                <label
                  htmlFor="duty-working-date"
                  className="flex items-center gap-2 text-xs font-bold text-sky-100 whitespace-nowrap"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/15 text-cyan-300">
                    <Calendar size={14} />
                  </div>
                  <span>วันที่ปฏิบัติงาน</span>
                </label>
                <input
                  id="duty-working-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-9 rounded-lg border border-sky-400/35 bg-[#041029] px-3 font-mono text-xs font-bold text-white tabular-nums shadow-inner focus:border-cyan-400 focus:outline-none [color-scheme:dark]"
                />
                {selectedDate !== getTodayYmd() && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(getTodayYmd())}
                    className="h-9 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 text-xs font-bold text-cyan-200 whitespace-nowrap transition hover:bg-cyan-500/25"
                  >
                    วันนี้
                  </button>
                )}
              </div>

              {/* Shift Counters with Radio Indicators */}
              <div className="flex items-center gap-4 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() =>
                    setFilterShift((prev) => (prev === "กะเช้า" ? "All" : "กะเช้า"))
                  }
                  className="group inline-flex items-center gap-2 text-slate-200 transition hover:text-white"
                  title="คลิกเพื่อกรองตารางเฉพาะกะเช้า"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      filterShift === "กะเช้า" || filterShift === "All"
                        ? "border-cyan-400 bg-cyan-500/20 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                        : "border-slate-500 bg-transparent"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        filterShift === "กะเช้า" || filterShift === "All"
                          ? "bg-cyan-400"
                          : "bg-slate-500"
                      }`}
                    />
                  </span>
                  <span className="tabular-nums">
                    กะเช้า <strong className="font-mono text-white">{shiftCounts["กะเช้า"] || 0}</strong> คน
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setFilterShift((prev) => (prev === "กะดึก" ? "All" : "กะดึก"))
                  }
                  className="group inline-flex items-center gap-2 text-slate-200 transition hover:text-white"
                  title="คลิกเพื่อกรองตารางเฉพาะกะดึก"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      filterShift === "กะดึก"
                        ? "border-cyan-400 bg-cyan-500/20 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                        : "border-slate-400 bg-transparent"
                    }`}
                  >
                    {filterShift === "กะดึก" && (
                      <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    )}
                  </span>
                  <span className="tabular-nums">
                    กะดึก <strong className="font-mono text-white">{shiftCounts["กะดึก"] || 0}</strong> คน
                  </span>
                </button>
              </div>
            </div>

            {/* Right Action Buttons: Copy Previous Day & Refresh */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleCopyPreviousDay}
                disabled={isSaving || !previousCopySource}
                title={
                  previousCopySource
                    ? `คัดลอกข้อมูลจากวันที่ ${previousCopySource.date} (${previousCopySource.rows.length} คน)`
                    : "ยังไม่มีข้อมูลวันก่อนหน้าให้คัดลอก"
                }
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-sky-400/40 bg-gradient-to-r from-[#0c2759] to-[#0f3473] px-3.5 text-xs font-bold text-sky-100 whitespace-nowrap shrink-0 shadow-[0_0_15px_rgba(14,165,233,0.2)] transition hover:border-cyan-300 hover:from-[#103370] hover:to-[#15428f] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Copy size={14} className="text-cyan-300" />
                <span>คัดลอกวันก่อนหน้า</span>
                {previousCopySource && (
                  <span className="font-mono text-[11px] text-sky-200/80 tabular-nums">
                    ({previousCopySource.date})
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={handleRefreshCloud}
                disabled={isRefreshing}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-sky-400/40 bg-[#0b214d] px-3.5 text-xs font-bold text-sky-100 whitespace-nowrap shrink-0 transition hover:border-cyan-300 hover:bg-[#11306b] disabled:opacity-50"
              >
                <RefreshCw size={14} className={`text-cyan-300 ${isRefreshing ? "animate-spin" : ""}`} />
                <span>รีเฟรช</span>
              </button>
            </div>
          </div>
        </div>

        {/* =====================================================================
            SECTION 2: KPI DASHBOARD (5 CARDS IN A SINGLE ROW)
        ===================================================================== */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Card 1: มอบหมายงานแล้ว (Blue / Cyan + Circular Progress Ring) */}
          <button
            type="button"
            onClick={() => {
              setFilterTeam("All");
              setFilterShift("All");
              setFilterStatus((prev) => (prev === "assigned" ? "all" : "assigned"));
            }}
            className={`group relative flex items-center justify-between overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition ${
              filterStatus === "assigned"
                ? "border-cyan-300 bg-gradient-to-br from-[#0284c7]/55 via-[#0c2d6b] to-[#07193d] shadow-[0_0_25px_rgba(34,211,238,0.35)]"
                : "border-cyan-400/40 bg-gradient-to-br from-[#0284c7]/40 via-[#0c2d6b]/80 to-[#07193d] shadow-[0_8px_25px_rgba(2,132,199,0.22)] hover:border-cyan-300/70"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                <Users size={24} />
              </div>
              <div>
                <div className="text-xs font-bold text-sky-100">
                  มอบหมายงานแล้ว {filterStatus === "assigned" ? "(กรอง)" : ""}
                </div>
                <div className="mt-1 flex items-baseline gap-1 tabular-nums">
                  <span className="font-mono text-2xl font-extrabold text-white">
                    {assignedCount}
                  </span>
                  <span className="text-xs font-semibold text-sky-200/80">
                    / {totalEmployeeCount} คน
                  </span>
                </div>
              </div>
            </div>

            {/* Circular Progress Indicator */}
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
              <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56">
                <circle
                  cx="28"
                  cy="28"
                  r={circleRadius}
                  stroke="rgba(148,163,184,0.25)"
                  strokeWidth="4.5"
                  fill="none"
                />
                <circle
                  cx="28"
                  cy="28"
                  r={circleRadius}
                  stroke="#38bdf8"
                  strokeWidth="4.5"
                  strokeDasharray={circleCircumference}
                  strokeDashoffset={circleStrokeDashoffset}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <span className="absolute font-mono text-xs font-extrabold text-white tabular-nums">
                {assignedPercent}%
              </span>
            </div>
          </button>

          {/* Card 2: ยังไม่ได้จัดทีม (Amber / Orange) */}
          <button
            type="button"
            onClick={() => {
              setFilterTeam("All");
              setFilterShift("All");
              setFilterStatus((prev) => (prev === "unassigned" ? "all" : "unassigned"));
            }}
            className={`group relative flex items-center justify-between overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition ${
              filterStatus === "unassigned"
                ? "border-amber-300 bg-gradient-to-br from-amber-500/50 via-[#4a2e12] to-[#1f1619] shadow-[0_0_25px_rgba(245,158,11,0.4)]"
                : "border-amber-400/45 bg-gradient-to-br from-amber-500/35 via-[#3d2610]/85 to-[#1f1619] shadow-[0_8px_25px_rgba(245,158,11,0.2)] hover:border-amber-300/80"
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-amber-300/60 bg-gradient-to-br from-amber-400 to-orange-600 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.5)]">
                <Clock size={22} strokeWidth={2.5} />
              </div>
              <div>
                <div className="text-xs font-bold text-amber-100">
                  ยังไม่ได้จัดทีม {filterStatus === "unassigned" ? "(กรอง)" : ""}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                  <span className="font-mono text-2xl font-extrabold text-amber-300">
                    {unassignedCount}
                  </span>
                  <span className="text-xs font-semibold text-amber-100/80">คน</span>
                </div>
              </div>
            </div>
            <Users
              size={40}
              aria-hidden="true"
              className="pointer-events-none text-amber-200/15"
            />
          </button>

          {/* Card 3: ทีม A (Blue) */}
          <button
            type="button"
            onClick={() => {
              setFilterStatus("all");
              setFilterTeam((prev) => (prev === "ทีม A" ? "All" : "ทีม A"));
            }}
            className={`group relative flex items-center justify-between overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition ${
              filterTeam === "ทีม A"
                ? "border-cyan-300 bg-gradient-to-br from-sky-500/45 via-[#0e347a] to-[#081c45] shadow-[0_0_25px_rgba(56,189,248,0.4)]"
                : "border-sky-400/40 bg-gradient-to-br from-sky-500/30 via-[#0b2963]/85 to-[#071739] shadow-[0_8px_25px_rgba(14,165,233,0.18)] hover:border-sky-300/70"
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-cyan-300/70 bg-gradient-to-br from-cyan-400 to-blue-600 font-mono text-xl font-black text-white shadow-[0_0_20px_rgba(56,189,248,0.55)]">
                A
              </div>
              <div>
                <div className="text-xs font-bold text-sky-100">
                  ทีม A {filterTeam === "ทีม A" ? "(กรอง)" : ""}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                  <span className="font-mono text-2xl font-extrabold text-cyan-300">
                    {teamCounts["ทีม A"] || 0}
                  </span>
                  <span className="text-xs font-semibold text-sky-100/80">คน</span>
                </div>
              </div>
            </div>
          </button>

          {/* Card 4: ทีม B (Purple) */}
          <button
            type="button"
            onClick={() => {
              setFilterStatus("all");
              setFilterTeam((prev) => (prev === "ทีม B" ? "All" : "ทีม B"));
            }}
            className={`group relative flex items-center justify-between overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition ${
              filterTeam === "ทีม B"
                ? "border-purple-300 bg-gradient-to-br from-purple-500/45 via-[#2e1c63] to-[#171136] shadow-[0_0_25px_rgba(168,85,247,0.4)]"
                : "border-purple-400/40 bg-gradient-to-br from-purple-500/30 via-[#251752]/85 to-[#120e2e] shadow-[0_8px_25px_rgba(168,85,247,0.2)] hover:border-purple-300/70"
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-purple-300/70 bg-gradient-to-br from-purple-400 to-indigo-600 font-mono text-xl font-black text-white shadow-[0_0_20px_rgba(168,85,247,0.55)]">
                B
              </div>
              <div>
                <div className="text-xs font-bold text-purple-100">
                  ทีม B {filterTeam === "ทีม B" ? "(กรอง)" : ""}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                  <span className="font-mono text-2xl font-extrabold text-white">
                    {teamCounts["ทีม B"] || 0}
                  </span>
                  <span className="text-xs font-semibold text-purple-200/80">คน</span>
                </div>
              </div>
            </div>
          </button>

          {/* Card 5: ทีม C (Green / Emerald) */}
          <button
            type="button"
            onClick={() => {
              setFilterStatus("all");
              setFilterTeam((prev) => (prev === "ทีม C" ? "All" : "ทีม C"));
            }}
            className={`group relative flex items-center justify-between overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition ${
              filterTeam === "ทีม C"
                ? "border-emerald-300 bg-gradient-to-br from-emerald-500/45 via-[#0c3b38] to-[#071f24] shadow-[0_0_25px_rgba(16,185,129,0.4)]"
                : "border-emerald-400/40 bg-gradient-to-br from-emerald-500/30 via-[#0a3030]/85 to-[#061820] shadow-[0_8px_25px_rgba(16,185,129,0.2)] hover:border-emerald-300/70"
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-emerald-300/70 bg-gradient-to-br from-emerald-400 to-teal-600 font-mono text-xl font-black text-white shadow-[0_0_20px_rgba(16,185,129,0.55)]">
                C
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-100">
                  ทีม C {filterTeam === "ทีม C" ? "(กรอง)" : ""}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                  <span className="font-mono text-2xl font-extrabold text-amber-300">
                    {teamCounts["ทีม C"] || 0}
                  </span>
                  <span className="text-xs font-semibold text-emerald-100/80">คน</span>
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* =====================================================================
            SECTION 3: FULL ROSTER & DAILY DUTY ASSIGNMENT TABLE
        ===================================================================== */}
        <div className="overflow-hidden rounded-2xl border border-sky-400/30 bg-[#071739]/95 shadow-[0_12px_35px_rgba(2,10,30,0.6)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-400/25 bg-[#09204f]/80 px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-extrabold text-white sm:text-base">
                ตารางมอบหมายงานประจำวัน
              </h3>
              <span className="text-xs text-sky-400/60" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-xs font-bold text-cyan-300 tabular-nums">
                {selectedDate}
              </span>
              <span className="text-xs text-sky-400/60" aria-hidden="true">
                ·
              </span>
              <span className="text-xs font-semibold text-sky-200 tabular-nums">
                แสดง {filteredRosterRows.length} / {totalEmployeeCount} คน
              </span>

              {unassignedCount > 0 && (
                <button
                  type="button"
                  onClick={handleAssignAllUnassigned}
                  disabled={isSaving}
                  className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-lg border border-cyan-300/50 bg-gradient-to-r from-[#0284c7] to-[#2563eb] px-2.5 text-[11px] font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
                  title="กดเพื่อบันทึกมอบหมายงานตามค่าเริ่มต้นให้พนักงานที่ยังไม่ได้จัดทีมทั้งหมดทันที"
                >
                  <Check size={12} strokeWidth={3} />
                  <span>มอบหมายทั้งหมด ({unassignedCount} คน)</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter Segmented Control */}
              <div className="inline-flex h-[35px] items-center rounded-lg border border-sky-400/30 bg-[#041029] p-0.5">
                <button
                  type="button"
                  onClick={() => setFilterStatus("all")}
                  className={`h-[29px] rounded-md px-2.5 text-xs font-bold whitespace-nowrap transition ${
                    filterStatus === "all"
                      ? "bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  ทั้งหมด ({totalEmployeeCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus("assigned")}
                  className={`h-[29px] rounded-md px-2.5 text-xs font-bold whitespace-nowrap transition ${
                    filterStatus === "assigned"
                      ? "bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  มอบหมายแล้ว ({assignedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus("unassigned")}
                  className={`h-[29px] rounded-md px-2.5 text-xs font-bold whitespace-nowrap transition ${
                    filterStatus === "unassigned"
                      ? "bg-amber-500 text-slate-950"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  ยังไม่จัดทีม ({unassignedCount})
                </button>
              </div>

              {/* Segmented Team Filter */}
              <div className="inline-flex h-[35px] items-center rounded-lg border border-sky-400/30 bg-[#041029] p-0.5">
                <button
                  type="button"
                  onClick={() => setFilterTeam("All")}
                  className={`h-[29px] rounded-md px-2.5 text-xs font-bold whitespace-nowrap transition ${
                    filterTeam === "All"
                      ? "bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  ทุกทีม
                </button>
                {MH_TEAMS.map((tOpt) => (
                  <button
                    key={`flt-${tOpt}`}
                    type="button"
                    onClick={() => setFilterTeam(tOpt)}
                    className={`h-[29px] rounded-md px-2.5 text-xs font-bold whitespace-nowrap transition ${
                      filterTeam === tOpt
                        ? "bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    {tOpt}
                  </button>
                ))}
              </div>

              <select
                value={filterShift}
                onChange={(e) => setFilterShift(e.target.value)}
                aria-label="กรองตามกะทำงาน"
                className="h-[35px] rounded-lg border border-sky-400/30 bg-[#041029] px-2.5 text-xs text-white focus:border-cyan-400 focus:outline-none"
              >
                <option value="All">ทุกกะทำงาน</option>
                {MH_SHIFTS.map((sOpt) => (
                  <option key={sOpt} value={sOpt}>
                    {sOpt}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sky-300/70"
                />
                <input
                  type="text"
                  placeholder="ค้นหาชื่อพนักงาน, รถ, พื้นที่..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-[35px] w-48 rounded-lg border border-sky-400/30 bg-[#041029] pr-7 pl-8 text-xs text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="ล้างคำค้นหา"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Expandable Work Area Management Bar (เพิ่ม / ลบ พื้นที่รับผิดชอบ) */}
          {isManageWorkAreasOpen && (
            <div className="border-b border-sky-400/25 bg-[#05122e]/95 px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-200">
                  <MapPin size={14} className="text-cyan-300" />
                  <span>จัดการรายการพื้นที่รับผิดชอบ (เพิ่ม / ลบ ตัวเลือกในตาราง)</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRestoreDefaultWorkAreas}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-sky-400/30 bg-[#081d47] px-2.5 text-[11px] font-bold text-sky-200 transition hover:border-cyan-300 hover:text-white"
                    title="คืนค่ารายการพื้นที่เริ่มต้น"
                  >
                    <RotateCcw size={11} />
                    <span>คืนค่าเริ่มต้น</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsManageWorkAreasOpen(false)}
                    className="inline-flex h-7 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-800/70 px-2 text-[11px] font-bold text-slate-300 hover:text-white"
                  >
                    ปิด
                  </button>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {workAreaOptions.map((area) => (
                  <span
                    key={`mgr-area-${area}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/35 bg-[#09204f] px-2.5 py-1 text-xs font-bold text-white"
                  >
                    <span>{area}</span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteWorkAreaOption(area)}
                      className="rounded p-0.5 text-rose-300 transition hover:bg-rose-500/25 hover:text-rose-100"
                      title={`ลบพื้นที่ "${area}"`}
                      aria-label={`ลบพื้นที่ ${area}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}

                <div className="inline-flex items-center gap-1.5">
                  <input
                    type="text"
                    value={headerNewWorkAreaText}
                    onChange={(e) => setHeaderNewWorkAreaText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddWorkAreaOption(headerNewWorkAreaText);
                      }
                    }}
                    placeholder="พิมพ์ชื่อพื้นที่ใหม่..."
                    className="h-7 w-40 rounded-lg border border-cyan-400/40 bg-[#041029] px-2.5 text-xs text-white placeholder:text-slate-400 focus:border-cyan-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddWorkAreaOption(headerNewWorkAreaText)}
                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-cyan-500 px-2.5 text-[11px] font-extrabold text-slate-950 transition hover:bg-cyan-400"
                  >
                    <Plus size={12} strokeWidth={3} />
                    <span>เพิ่มพื้นที่</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className={`overflow-x-auto ${compact ? "max-h-96 overflow-y-auto" : ""}`}>
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-sky-400/20 bg-[#041029]/90 text-[11px] font-bold text-sky-200">
                  <th className="w-10 px-4 py-3 text-center">#</th>
                  <th className="px-4 py-3 whitespace-nowrap">พนักงาน</th>
                  <th className="px-4 py-3 whitespace-nowrap">1. กะทำงาน</th>
                  <th className="px-4 py-3 whitespace-nowrap">2. รถที่ขึ้นขับ</th>
                  <th className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span>3. พื้นที่รับผิดชอบ</span>
                      <button
                        type="button"
                        onClick={() => setIsManageWorkAreasOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1 rounded-md border border-cyan-400/40 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan-200 transition hover:bg-cyan-500/30 hover:text-white"
                        title="เพิ่มหรือลบรายการพื้นที่รับผิดชอบ"
                      >
                        <Plus size={10} strokeWidth={3} />
                        <span>เพิ่ม/ลบ</span>
                      </button>
                    </div>
                  </th>
                  <th className="px-4 py-3 whitespace-nowrap">4. ทีม A / B / C</th>
                  <th className="px-4 py-3 whitespace-nowrap">5. เวลาเลิกงาน</th>
                  <th className="px-4 py-3 whitespace-nowrap">หมายเหตุ</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-400/15">
                {filteredRosterRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-10 text-center text-xs text-slate-300"
                    >
                      ไม่พบรายชื่อพนักงานที่ตรงกับเงื่อนไขการค้นหาหรือตัวกรอง
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const renderEmployeeRow = (row: RosterTableRow, indexInGroup: number) => {
                      const noteDraft =
                        draftNotesByKey[row.rowKey] !== undefined
                          ? draftNotesByKey[row.rowKey]
                          : row.notes;

                      return (
                        <tr
                          key={row.rowKey}
                          className={`transition hover:bg-sky-400/10 ${
                            row.isAssigned ? "bg-sky-500/[0.03]" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5 text-center font-mono text-[11px] text-slate-400 tabular-nums">
                            {indexInGroup}
                          </td>

                          {/* พนักงาน (แสดงเฉพาะชื่อพนักงาน ไม่มีรหัสพนักงาน) */}
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                  row.isAssigned
                                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-300"
                                    : "border-amber-400/40 bg-amber-500/15 text-amber-300"
                                }`}
                                title={row.isAssigned ? "มอบหมายงานแล้ว" : "ยังไม่ได้จัดทีม"}
                              >
                                <User size={13} />
                              </span>
                              <span className="font-bold text-white whitespace-nowrap">
                                {row.employeeName}
                              </span>
                            </div>
                          </td>

                          {/* 1. กะทำงาน */}
                          <td className="px-4 py-2.5">
                            <div className="inline-flex rounded-lg border border-sky-400/25 bg-[#041029] p-0.5">
                              {MH_SHIFTS.map((sOpt) => {
                                const isMorning = sOpt === "กะเช้า";
                                const active = row.isAssigned && row.shift === sOpt;
                                return (
                                  <button
                                    key={`${row.rowKey}-${sOpt}`}
                                    type="button"
                                    onClick={() =>
                                      handleUpsertRosterRow(row, {
                                        shift: sOpt,
                                        endTime: normalizeEndTimeForShift(sOpt, row.endTime),
                                      })
                                    }
                                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition ${
                                      active
                                        ? "bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_10px_rgba(14,165,233,0.4)]"
                                        : "text-slate-400 hover:text-white"
                                    }`}
                                  >
                                    {isMorning ? <Sun size={11} /> : <Moon size={11} />}
                                    <span>{sOpt}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </td>

                          {/* 2. รถที่ขึ้นขับ */}
                          <td className="px-4 py-2.5">
                            <select
                              value={row.vehicleNumber}
                              onChange={(e) =>
                                handleUpsertRosterRow(row, { vehicleNumber: e.target.value })
                              }
                              aria-label={`รถที่ขึ้นขับของ ${row.employeeName}`}
                              className={`h-8 rounded-lg border bg-[#041029] px-2.5 font-mono text-xs font-bold focus:border-cyan-400 focus:outline-none ${
                                row.isAssigned
                                  ? "border-sky-400/40 text-cyan-200"
                                  : "border-sky-400/25 text-slate-300"
                              }`}
                            >
                              <option value="-">-- ไม่ระบุรถ --</option>
                              {activeVehicles.map((v) => (
                                <option key={v.id} value={v.vehicleId}>
                                  {v.vehicleId}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* 3. พื้นที่รับผิดชอบ (รองรับเลือก, + เพิ่มพื้นที่ใหม่ และ ลบพื้นที่) */}
                          <td className="px-4 py-2.5">
                            {addingWorkAreaForRow === row.rowKey ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={newWorkAreaText}
                                  onChange={(e) => setNewWorkAreaText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void handleAddWorkAreaOption(newWorkAreaText, row);
                                    } else if (e.key === "Escape") {
                                      setAddingWorkAreaForRow(null);
                                      setNewWorkAreaText("");
                                    }
                                  }}
                                  placeholder="ระบุพื้นที่ใหม่..."
                                  autoFocus
                                  className="h-8 w-32 rounded-lg border border-cyan-400 bg-[#041029] px-2 text-xs text-white placeholder:text-slate-400 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleAddWorkAreaOption(newWorkAreaText, row)}
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500 text-slate-950 transition hover:bg-cyan-400"
                                  title="บันทึกพื้นที่ใหม่"
                                >
                                  <Check size={13} strokeWidth={3} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddingWorkAreaForRow(null);
                                    setNewWorkAreaText("");
                                  }}
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 text-slate-300 transition hover:text-white"
                                  title="ยกเลิก"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <select
                                  value={row.workArea}
                                  onChange={(e) =>
                                    handleUpsertRosterRow(row, { workArea: e.target.value })
                                  }
                                  aria-label={`พื้นที่รับผิดชอบของ ${row.employeeName}`}
                                  className={`h-8 rounded-lg border bg-[#041029] px-2.5 text-xs font-semibold focus:border-cyan-400 focus:outline-none ${
                                    row.isAssigned
                                      ? "border-sky-400/40 text-white"
                                      : "border-sky-400/25 text-slate-300"
                                  }`}
                                >
                                  <option value="-">-- ไม่ระบุพื้นที่ --</option>
                                  {row.workArea &&
                                    row.workArea !== "-" &&
                                    !workAreaOptions.includes(row.workArea) && (
                                      <option value={row.workArea}>{row.workArea}</option>
                                    )}
                                  {workAreaOptions.map((area) => (
                                    <option key={area} value={area}>
                                      {area}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddingWorkAreaForRow(row.rowKey);
                                    setNewWorkAreaText("");
                                  }}
                                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-400/35 bg-cyan-500/15 text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-500/30 hover:text-white"
                                  title="เพิ่มพื้นที่รับผิดชอบใหม่"
                                  aria-label={`เพิ่มพื้นที่รับผิดชอบใหม่ให้ ${row.employeeName}`}
                                >
                                  <Plus size={13} strokeWidth={2.5} />
                                </button>

                                {row.workArea && row.workArea !== "-" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleDeleteWorkAreaOption(row.workArea, row)
                                    }
                                    className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-lg border border-rose-500/35 bg-[#041029] text-rose-400 transition hover:bg-rose-500/20 hover:text-rose-200"
                                    title={`ลบพื้นที่ "${row.workArea}"`}
                                    aria-label={`ลบพื้นที่ ${row.workArea}`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>

                          {/* 4. ทีม A / B / C */}
                          <td className="px-4 py-2.5">
                            <div className="inline-flex rounded-lg border border-sky-400/25 bg-[#041029] p-0.5">
                              {MH_TEAMS.map((tOpt) => {
                                const active = row.isAssigned && row.team === tOpt;
                                const badgeColor =
                                  tOpt === "ทีม A"
                                    ? "bg-sky-500 text-white shadow-[0_0_10px_rgba(14,165,233,0.4)]"
                                    : tOpt === "ทีม B"
                                    ? "bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.4)]"
                                    : "bg-emerald-600 text-white shadow-[0_0_10px_rgba(5,150,105,0.4)]";
                                return (
                                  <button
                                    key={`${row.rowKey}-${tOpt}`}
                                    type="button"
                                    onClick={() => handleUpsertRosterRow(row, { team: tOpt })}
                                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition ${
                                      active ? badgeColor : "text-slate-400 hover:text-white"
                                    }`}
                                  >
                                    {tOpt}
                                  </button>
                                );
                              })}
                            </div>
                          </td>

                          {/* 5. เวลาเลิกงาน (แสดงเฉพาะช่วงเวลาของกะที่เลือก) */}
                          <td className="px-4 py-2.5">
                            <select
                              value={
                                getEndTimesForShift(row.shift).includes(row.endTime || "")
                                  ? row.endTime
                                  : normalizeEndTimeForShift(row.shift, row.endTime)
                              }
                              onChange={(e) =>
                                handleUpsertRosterRow(row, { endTime: e.target.value })
                              }
                              aria-label={`เวลาเลิกงานของ ${row.employeeName}`}
                              className={`h-8 rounded-lg border bg-[#041029] px-2.5 font-mono text-xs font-bold focus:border-cyan-400 focus:outline-none ${
                                row.isAssigned
                                  ? "border-sky-400/40 text-amber-300"
                                  : "border-sky-400/25 text-slate-300"
                              }`}
                            >
                              {row.endTime &&
                                !getEndTimesForShift(row.shift).includes(row.endTime) && (
                                  <option value={row.endTime}>{row.endTime} น.</option>
                                )}
                              {getEndTimesForShift(row.shift).map((timeOpt) => (
                                <option key={`${row.rowKey}-${timeOpt}`} value={timeOpt}>
                                  {timeOpt} น.
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* หมายเหตุ (แก้ไขในตารางได้ทันที) */}
                          <td className="min-w-[160px] px-4 py-2.5">
                            <input
                              type="text"
                              value={noteDraft}
                              placeholder="ระบุหมายเหตุ..."
                              onChange={(e) => {
                                const val = e.target.value;
                                setDraftNotesByKey((prev) => ({
                                  ...prev,
                                  [row.rowKey]: val,
                                }));
                              }}
                              onBlur={() => {
                                if (
                                  draftNotesByKey[row.rowKey] !== undefined &&
                                  draftNotesByKey[row.rowKey] !== row.notes
                                ) {
                                  void handleUpsertRosterRow(row, {
                                    notes: draftNotesByKey[row.rowKey],
                                  });
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  (e.currentTarget as HTMLInputElement).blur();
                                }
                              }}
                              className="h-8 w-full rounded-lg border border-sky-400/25 bg-[#041029] px-2.5 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                            />
                          </td>

                          {/* จัดการ */}
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {row.isAssigned ? (
                              <div className="inline-flex items-center gap-1.5">
                                <span className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 text-[11px] font-bold text-emerald-300">
                                  <Check size={12} strokeWidth={2.5} />
                                  <span>จัดทีมแล้ว</span>
                                </span>

                                {confirmDeleteId === row.dutyId ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDuty(row.dutyId)}
                                    className="h-7 rounded-lg bg-rose-600 px-2.5 text-[11px] font-bold text-white hover:bg-rose-500"
                                  >
                                    ยืนยันยกเลิก
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(row.dutyId)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/35 bg-[#041029] text-rose-400 transition hover:bg-rose-500/20 hover:text-rose-200"
                                    title="ยกเลิกการมอบหมายงานของพนักงานคนนี้"
                                    aria-label={`ยกเลิกงานของ ${row.employeeName}`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleUpsertRosterRow(row, {})}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-cyan-400/45 bg-cyan-500/15 px-2.5 text-[11px] font-bold text-cyan-200 transition hover:bg-cyan-500/30 hover:text-white"
                                title="กดเพื่อยืนยันการมอบหมายงานตามค่าในแถวนี้"
                              >
                                <Check size={12} strokeWidth={2.5} />
                                <span>มอบหมาย</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    };

                    const shiftGroups = MH_SHIFTS.map((shiftName) => {
                      const shiftRows = filteredRosterRows.filter(
                        (r) => r.isAssigned && r.shift === shiftName
                      );
                      const teamSubgroups = MH_TEAMS.map((teamName) => ({
                        teamName,
                        rows: shiftRows.filter((r) => r.team === teamName),
                      })).filter((tg) => tg.rows.length > 0);
                      return {
                        shiftName,
                        totalInShift: shiftRows.length,
                        teamSubgroups,
                      };
                    }).filter((sg) => sg.totalInShift > 0);

                    const unassignedRows = filteredRosterRows.filter((r) => !r.isAssigned);

                    return (
                      <>
                        {/* 1. กลุ่มหลักตามกะทำงาน -> กลุ่มย่อยตามทีม A / B / C */}
                        {shiftGroups.map((sg) => {
                          const isMorning = sg.shiftName === "กะเช้า";
                          return (
                            <React.Fragment key={`shift-grp-${sg.shiftName}`}>
                              {/* Main Group Header: กะทำงาน */}
                              <tr
                                className={
                                  isMorning
                                    ? "border-y border-cyan-400/35 bg-gradient-to-r from-[#0c316e] via-[#092454] to-[#06183b]"
                                    : "border-y border-indigo-400/35 bg-gradient-to-r from-[#17286e] via-[#111f54] to-[#081338]"
                                }
                              >
                                <td colSpan={9} className="px-4 py-2.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2.5">
                                      <span
                                        className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                                          isMorning
                                            ? "border-amber-300/50 bg-amber-400/20 text-amber-300"
                                            : "border-cyan-300/50 bg-cyan-400/20 text-cyan-200"
                                        }`}
                                      >
                                        {isMorning ? <Sun size={15} /> : <Moon size={15} />}
                                      </span>
                                      <span className="text-xs font-extrabold tracking-wide text-white sm:text-sm">
                                        กลุ่มกะทำงาน: {sg.shiftName}
                                      </span>
                                      <span className="rounded-md border border-cyan-300/40 bg-cyan-500/20 px-2 py-0.5 font-mono text-[11px] font-extrabold text-cyan-200 tabular-nums">
                                        รวม {sg.totalInShift} คน
                                      </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                                      {sg.teamSubgroups.map((tg) => {
                                        const pillClass =
                                          tg.teamName === "ทีม A"
                                            ? "border-sky-400/40 bg-sky-500/20 text-sky-200"
                                            : tg.teamName === "ทีม B"
                                            ? "border-purple-400/40 bg-purple-500/20 text-purple-200"
                                            : "border-emerald-400/40 bg-emerald-500/20 text-emerald-200";
                                        return (
                                          <span
                                            key={`summary-${sg.shiftName}-${tg.teamName}`}
                                            className={`rounded-md border px-2 py-0.5 tabular-nums ${pillClass}`}
                                          >
                                            {tg.teamName}: {tg.rows.length} คน
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </td>
                              </tr>

                              {/* Sub-groups: ทีม A / ทีม B / ทีม C */}
                              {sg.teamSubgroups.map((tg) => {
                                const teamLetter = tg.teamName.replace("ทีม ", "").trim();
                                const subHeaderStyle =
                                  tg.teamName === "ทีม A"
                                    ? {
                                        rowBg: "bg-[#071d47]/90 border-y border-sky-400/25",
                                        badge:
                                          "border-cyan-300/60 bg-gradient-to-br from-cyan-400 to-blue-600 text-white",
                                        text: "text-cyan-200",
                                        countBadge:
                                          "border-sky-400/35 bg-sky-500/15 text-sky-200",
                                      }
                                    : tg.teamName === "ทีม B"
                                    ? {
                                        rowBg: "bg-[#14143d]/90 border-y border-purple-400/25",
                                        badge:
                                          "border-purple-300/60 bg-gradient-to-br from-purple-400 to-indigo-600 text-white",
                                        text: "text-purple-200",
                                        countBadge:
                                          "border-purple-400/35 bg-purple-500/15 text-purple-200",
                                      }
                                    : {
                                        rowBg: "bg-[#06242c]/90 border-y border-emerald-400/25",
                                        badge:
                                          "border-emerald-300/60 bg-gradient-to-br from-emerald-400 to-teal-600 text-white",
                                        text: "text-emerald-200",
                                        countBadge:
                                          "border-emerald-400/35 bg-emerald-500/15 text-emerald-200",
                                      };

                                return (
                                  <React.Fragment
                                    key={`team-subgrp-${sg.shiftName}-${tg.teamName}`}
                                  >
                                    <tr className={subHeaderStyle.rowBg}>
                                      <td colSpan={9} className="py-2 pr-4 pl-7">
                                        <div className="flex items-center gap-2.5">
                                          <span
                                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-black shadow-xs ${subHeaderStyle.badge}`}
                                          >
                                            {teamLetter}
                                          </span>
                                          <span
                                            className={`text-xs font-extrabold ${subHeaderStyle.text}`}
                                          >
                                            กลุ่มย่อย{tg.teamName} ({sg.shiftName})
                                          </span>
                                          <span
                                            className={`rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-bold tabular-nums ${subHeaderStyle.countBadge}`}
                                          >
                                            {tg.rows.length} คน
                                          </span>
                                        </div>
                                      </td>
                                    </tr>

                                    {tg.rows.map((row, idx) =>
                                      renderEmployeeRow(row, idx + 1)
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}

                        {/* 2. กลุ่มพนักงานที่ยังไม่ได้จัดทีม / รอมอบหมายงาน */}
                        {unassignedRows.length > 0 && (
                          <React.Fragment key="unassigned-group">
                            <tr className="border-y border-amber-400/35 bg-gradient-to-r from-amber-500/20 via-[#2b1f14] to-[#0a1736]">
                              <td colSpan={9} className="px-4 py-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-300/50 bg-amber-400/20 text-amber-300">
                                      <Clock size={15} />
                                    </span>
                                    <span className="text-xs font-extrabold tracking-wide text-amber-100 sm:text-sm">
                                      ยังไม่ได้จัดทีม / รอมอบหมายงาน
                                    </span>
                                    <span className="rounded-md border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-extrabold text-amber-200 tabular-nums">
                                      {unassignedRows.length} คน
                                    </span>
                                  </div>
                                  <span className="text-[11px] font-medium text-amber-200/80">
                                    คลิกเลือกกะทำงาน หรือ ทีม A / B / C ในแถวเพื่อจัดเข้ากลุ่มทันที
                                  </span>
                                </div>
                              </td>
                            </tr>

                            {unassignedRows.map((row, idx) =>
                              renderEmployeeRow(row, idx + 1)
                            )}
                          </React.Fragment>
                        )}
                      </>
                    );
                  })()
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
