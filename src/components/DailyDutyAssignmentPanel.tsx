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
  Truck,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Search,
  RefreshCw,
  Edit3,
  X,
  Check,
  UserPlus,
  Sun,
  Moon,
  Wrench,
  MessageSquare,
  Save,
  ChevronRight,
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
  const [selectedEmployees, setSelectedEmployees] = useState<
    Array<{ employeeId?: string; employeeName: string }>
  >([]);
  const [employeeInput, setEmployeeInput] = useState<string>("");
  const [employeePanelFilter, setEmployeePanelFilter] = useState<"all" | "unassigned">("all");
  const [workArea, setWorkArea] = useState<string>(MH_WORK_AREAS[0]);
  const [vehicleNumber, setVehicleNumber] = useState<string>(vehicles[0]?.vehicleId || "-");
  const [shift, setShift] = useState<string>(MH_SHIFTS[0]);
  const [team, setTeam] = useState<string>(MH_TEAMS[0]);
  const [endTime, setEndTime] = useState<string>("17:00");
  const [notes, setNotes] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterTeam, setFilterTeam] = useState<string>("All");
  const [filterShift, setFilterShift] = useState<string>("All");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 4500);
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

  // Exclude employees known to belong to other departments (e.g. Slitting, Coil Yard, RM)
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

  // Ensure default vehicle selection is valid when vehicles list updates
  useEffect(() => {
    if (vehicleNumber === "-" && activeVehicles.length > 0 && !editingId) {
      setVehicleNumber(activeVehicles[0].vehicleId);
    }
  }, [activeVehicles, vehicleNumber, editingId]);

  const dutiesForDate = useMemo(
    () =>
      allDuties.filter(
        (d) => d.workingDate === selectedDate && isDutyAllowedForMhFleet(d)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allDuties, selectedDate, nonMhFleetEmployeeSet]
  );

  const assignedNamesSet = useMemo(
    () => new Set(dutiesForDate.map((d) => d.employeeName.trim().toLowerCase())),
    [dutiesForDate]
  );

  const unassignedEmployees = useMemo(
    () =>
      activeEmployees.filter(
        (emp) => !assignedNamesSet.has(emp.employeeName.trim().toLowerCase())
      ),
    [activeEmployees, assignedNamesSet]
  );

  const assignedPercent = useMemo(() => {
    if (activeEmployees.length === 0) return 0;
    const assignedCount = activeEmployees.length - unassignedEmployees.length;
    return Math.min(100, Math.round((assignedCount / activeEmployees.length) * 100));
  }, [activeEmployees.length, unassignedEmployees.length]);

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

  const filteredGridEmployees = useMemo(() => {
    const baseList =
      employeePanelFilter === "unassigned" ? unassignedEmployees : activeEmployees;
    const raw = employeeInput.trim();
    if (!raw || raw.includes(",") || raw.includes(";")) return baseList;
    const q = raw.toLowerCase();
    return baseList.filter(
      (emp) =>
        emp.employeeName.toLowerCase().includes(q) ||
        emp.employeeId.toLowerCase().includes(q)
    );
  }, [activeEmployees, unassignedEmployees, employeePanelFilter, employeeInput]);

  const filteredDuties = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return dutiesForDate.filter((d) => {
      if (filterTeam !== "All" && d.team !== filterTeam) return false;
      if (filterShift !== "All" && d.shift !== filterShift) return false;
      if (!q) return true;
      return (
        d.employeeName.toLowerCase().includes(q) ||
        (d.employeeId || "").toLowerCase().includes(q) ||
        d.workArea.toLowerCase().includes(q) ||
        d.vehicleNumber.toLowerCase().includes(q) ||
        d.team.toLowerCase().includes(q) ||
        d.shift.toLowerCase().includes(q) ||
        (d.notes || "").toLowerCase().includes(q)
      );
    });
  }, [dutiesForDate, filterTeam, filterShift, searchQuery]);

  const selectedEmployeeNamesSet = useMemo(
    () => new Set(selectedEmployees.map((e) => e.employeeName.trim().toLowerCase())),
    [selectedEmployees]
  );

  const areAllFilteredSelected = useMemo(() => {
    if (filteredGridEmployees.length === 0) return false;
    return filteredGridEmployees.every((emp) =>
      selectedEmployeeNamesSet.has(emp.employeeName.trim().toLowerCase())
    );
  }, [filteredGridEmployees, selectedEmployeeNamesSet]);

  const handleToggleEmployee = (emp: { employeeId?: string; employeeName: string }) => {
    const cleanKey = emp.employeeName.trim().toLowerCase();
    const exists = selectedEmployees.some(
      (item) => item.employeeName.trim().toLowerCase() === cleanKey
    );
    if (exists) {
      setSelectedEmployees((prev) =>
        prev.filter((item) => item.employeeName.trim().toLowerCase() !== cleanKey)
      );
      if (editingId) setEditingId(null);
      return;
    }

    setSelectedEmployees((prev) => [
      ...prev,
      { employeeId: emp.employeeId, employeeName: emp.employeeName.trim() },
    ]);

    // If this is the first selected employee and they already have a duty for selectedDate, preload their defaults
    if (selectedEmployees.length === 0 && !editingId) {
      const existing = dutiesForDate.find(
        (d) =>
          d.employeeName.trim().toLowerCase() === cleanKey ||
          (emp.employeeId && d.employeeId === emp.employeeId)
      );
      if (existing) {
        setWorkArea(existing.workArea);
        setVehicleNumber(existing.vehicleNumber);
        setShift(existing.shift);
        setTeam(existing.team);
        setEndTime(normalizeEndTimeForShift(existing.shift, existing.endTime));
        setNotes(existing.notes || "");
      }
    }
  };

  const handleAddTypedEmployee = () => {
    const raw = employeeInput.trim();
    if (!raw) return;
    const parts = raw
      .split(/[,;\n]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    setSelectedEmployees((prev) => {
      const next = [...prev];
      const existingSet = new Set(next.map((item) => item.employeeName.trim().toLowerCase()));
      parts.forEach((namePart) => {
        const key = namePart.toLowerCase();
        if (!existingSet.has(key)) {
          const matchedEmp = activeEmployees.find(
            (emp) => emp.employeeName.trim().toLowerCase() === key
          );
          next.push({
            employeeId: matchedEmp?.employeeId,
            employeeName: matchedEmp?.employeeName || namePart,
          });
          existingSet.add(key);
        }
      });
      return next;
    });
    setEmployeeInput("");
  };

  const handleToggleSelectAllVisible = () => {
    setEditingId(null);
    if (areAllFilteredSelected) {
      const visibleKeys = new Set(
        filteredGridEmployees.map((emp) => emp.employeeName.trim().toLowerCase())
      );
      setSelectedEmployees((prev) =>
        prev.filter((item) => !visibleKeys.has(item.employeeName.trim().toLowerCase()))
      );
    } else {
      setSelectedEmployees((prev) => {
        const existingSet = new Set(prev.map((item) => item.employeeName.trim().toLowerCase()));
        const additions = filteredGridEmployees
          .filter((emp) => !existingSet.has(emp.employeeName.trim().toLowerCase()))
          .map((emp) => ({
            employeeId: emp.employeeId,
            employeeName: emp.employeeName.trim(),
          }));
        return [...prev, ...additions];
      });
    }
  };

  const executeResetForm = () => {
    setEditingId(null);
    setSelectedEmployees([]);
    setEmployeeInput("");
    setShift(MH_SHIFTS[0]);
    setTeam(MH_TEAMS[0]);
    setVehicleNumber(activeVehicles[0]?.vehicleId || "-");
    setWorkArea(MH_WORK_AREAS[0]);
    setEndTime("17:00");
    setNotes("");
    setShowClearConfirm(false);
    setFeedback({ type: "success", text: "ล้างข้อมูลที่เลือกในฟอร์มเรียบร้อยแล้ว" });
  };

  const handleSaveAssignment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving) return;

    // Merge selectedEmployees + any typed text still in employeeInput
    const targets: Array<{ employeeId?: string; employeeName: string }> = [...selectedEmployees];
    const targetKeys = new Set(targets.map((t) => t.employeeName.trim().toLowerCase()));

    if (employeeInput.trim()) {
      employeeInput
        .split(/[,;\n]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((namePart) => {
          const key = namePart.toLowerCase();
          if (!targetKeys.has(key)) {
            const matchedEmp = activeEmployees.find(
              (emp) => emp.employeeName.trim().toLowerCase() === key
            );
            targets.push({
              employeeId: matchedEmp?.employeeId,
              employeeName: matchedEmp?.employeeName || namePart,
            });
            targetKeys.add(key);
          }
        });
    }

    if (targets.length === 0) {
      setFeedback({ type: "error", text: "กรุณาเลือกพนักงานอย่างน้อย 1 คนจากรายการด้านซ้ายก่อนบันทึก" });
      return;
    }

    setIsSaving(true);
    try {
      const { timestamp } = formatForkliftNowTimestamp();
      const cleanArea = workArea.trim() || "อาคาร A";
      const cleanVehicle = vehicleNumber.trim() || "-";
      const resolvedEndTime = endTime.trim() || normalizeEndTimeForShift(shift, endTime);

      const records: MhDailyDutyRecord[] = targets.map((target) => {
        const cleanName = target.employeeName.trim();
        const matchedEmp = activeEmployees.find(
          (emp) => emp.employeeName.trim().toLowerCase() === cleanName.toLowerCase()
        );
        const resolvedEmpId = target.employeeId?.trim() || matchedEmp?.employeeId || undefined;
        const useEditingId = editingId && targets.length === 1 ? editingId : null;
        const docId =
          useEditingId || buildMhDailyDutyDocId(selectedDate, resolvedEmpId || cleanName);
        const existingRecord = allDuties.find((d) => d.id === docId);

        const supervisorLabel = getActiveRecorderDisplay("Supervisor").label;
        return {
          id: docId,
          workingDate: selectedDate,
          employeeId: resolvedEmpId,
          employeeName: cleanName,
          workArea: cleanArea,
          vehicleNumber: cleanVehicle,
          shift,
          team,
          endTime: resolvedEndTime,
          supervisorName: supervisorLabel,
          notes: notes.trim() || undefined,
          createdAt: existingRecord?.createdAt || timestamp,
          updatedAt: timestamp,
        };
      });

      const savedIds = new Set(records.map((r) => r.id));
      const savedNames = new Set(records.map((r) => r.employeeName.trim().toLowerCase()));
      const remaining = allDuties.filter(
        (d) =>
          !savedIds.has(d.id) &&
          !(
            d.workingDate === selectedDate &&
            savedNames.has(d.employeeName.trim().toLowerCase())
          )
      );
      setAllDuties([...records, ...remaining]);

      await saveMhDailyDutiesBatchToCloud(records);
      void appendWmsActivityLog({
        module: "Manpower Planning",
        sectionId: "fleet_ops",
        reference: selectedDate,
        activity: `วางแผนกำลังคนประจำวัน ${selectedDate} จำนวน ${records.length} คน (${team} · ${shift} · รถ ${cleanVehicle} · ${cleanArea} · เลิกงาน ${resolvedEndTime})`,
        status: "Completed",
      });

      const summaryNames =
        records.length === 1
          ? `"${records[0].employeeName}"`
          : `จำนวน ${records.length} คน (${records.map((r) => r.employeeName).join(", ")})`;

      setFeedback({
        type: "success",
        text: `บันทึกวางแผนกำลังคน ${summaryNames} เข้า ${team} · ${shift} · รถ ${cleanVehicle} · ${cleanArea} · เลิกงาน ${resolvedEndTime} น. เรียบร้อยแล้ว`,
      });
      setSelectedEmployees([]);
      setEmployeeInput("");
      setNotes("");
      setEditingId(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickPatchRow = async (
    row: MhDailyDutyRecord,
    patch: Partial<
      Pick<MhDailyDutyRecord, "team" | "shift" | "workArea" | "vehicleNumber" | "endTime">
    >
  ) => {
    const { timestamp } = formatForkliftNowTimestamp();
    const updated: MhDailyDutyRecord = {
      ...row,
      ...patch,
      updatedAt: timestamp,
    };
    setAllDuties(allDuties.map((d) => (d.id === row.id ? updated : d)));
    await saveMhDailyDutyToCloud(updated);
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
    setFeedback({ type: "success", text: "ลบรายการมอบหมายงานเรียบร้อยแล้ว" });
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

        {/* Confirmation Dialog before Clearing Form */}
        {showClearConfirm && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-confirm-title"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/50 bg-[#14203d]/95 px-4 py-3 text-xs shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={16} className="shrink-0 text-amber-400" />
              <div>
                <span id="clear-confirm-title" className="font-bold text-white">
                  ยืนยันการล้างข้อมูลที่เลือกในฟอร์มหรือไม่?
                </span>
                <span className="ml-2 text-slate-300">
                  รายชื่อพนักงานที่ติ๊กไว้ ({selectedEmployees.length} คน) และค่าที่กำลังตั้งจะถูกรีเซ็ต
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={executeResetForm}
                className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                ยืนยันล้างข้อมูล
              </button>
            </div>
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
                {/* Perspective warehouse roof beams */}
                <path
                  d="M550,0 L700,160 M650,0 L820,160 M750,0 L940,160 M850,0 L1060,160 M950,0 L1180,160 M500,35 L1200,35 M520,75 L1200,75 M540,115 L1200,115"
                  stroke="url(#whGridGrad)"
                  strokeWidth="1.2"
                  fill="none"
                />
                {/* Diagonal accent slashes */}
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
                    กำหนดหน้าที่รับผิดชอบพนักงานประจำวัน: 1.กะทำงาน 2.รถที่ขึ้นขับ 3.พื้นที่รับผิดชอบ 4.ทีม A/B/C และ 5.เวลาเลิกงาน
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
                  {/* Left Person */}
                  <circle cx="28" cy="24" r="10" stroke="currentColor" strokeWidth="2.5" />
                  <path
                    d="M10 58C10 46.9543 18.0589 40 28 40C37.9411 40 46 46.9543 46 58"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  {/* Right Person */}
                  <circle cx="98" cy="24" r="10" stroke="currentColor" strokeWidth="2.5" />
                  <path
                    d="M80 58C80 46.9543 88.0589 40 98 40C107.941 40 116 46.9543 116 58"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  {/* Center Prominent Person */}
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
              setEmployeePanelFilter("all");
            }}
            className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-[#0284c7]/40 via-[#0c2d6b]/80 to-[#07193d] px-4 py-3.5 text-left shadow-[0_8px_25px_rgba(2,132,199,0.22)] transition hover:border-cyan-300/70"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                <Users size={24} />
              </div>
              <div>
                <div className="text-xs font-bold text-sky-100">มอบหมายงานแล้ว</div>
                <div className="mt-1 flex items-baseline gap-1 tabular-nums">
                  <span className="font-mono text-2xl font-extrabold text-white">
                    {dutiesForDate.length}
                  </span>
                  <span className="text-xs font-semibold text-sky-200/80">
                    / {activeEmployees.length} คน
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
            onClick={() => setEmployeePanelFilter("unassigned")}
            className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-amber-400/45 bg-gradient-to-br from-amber-500/35 via-[#3d2610]/85 to-[#1f1619] px-4 py-3.5 text-left shadow-[0_8px_25px_rgba(245,158,11,0.2)] transition hover:border-amber-300/80"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-amber-300/60 bg-gradient-to-br from-amber-400 to-orange-600 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.5)]">
                <Clock size={22} strokeWidth={2.5} />
              </div>
              <div>
                <div className="text-xs font-bold text-amber-100">ยังไม่ได้จัดทีม</div>
                <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                  <span className="font-mono text-2xl font-extrabold text-amber-300">
                    {unassignedEmployees.length}
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
            onClick={() => setFilterTeam((prev) => (prev === "ทีม A" ? "All" : "ทีม A"))}
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
            onClick={() => setFilterTeam((prev) => (prev === "ทีม B" ? "All" : "ทีม B"))}
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
            onClick={() => setFilterTeam((prev) => (prev === "ทีม C" ? "All" : "ทีม C"))}
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
            SECTION 3: MAIN WORKSPACE – 2 COLUMN LAYOUT
        ===================================================================== */}
        <form onSubmit={handleSaveAssignment} className="space-y-4">
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
            {/* -----------------------------------------------------------------
                LEFT PANEL: EMPLOYEE SELECTION (จัดทีมและมอบหมายงานประจำวัน)
            ----------------------------------------------------------------- */}
            <div className="flex flex-col justify-between overflow-hidden rounded-2xl border border-sky-400/35 bg-gradient-to-b from-[#092252]/95 via-[#07193d]/95 to-[#061330]/95 shadow-[0_12px_35px_rgba(2,10,30,0.6)] lg:col-span-6">
              <div>
                {/* Left Panel Header */}
                <div className="flex items-center justify-between gap-3 border-b border-sky-400/25 bg-gradient-to-r from-[#0d3175]/80 via-[#0a255c]/80 to-transparent px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-400/15 text-cyan-200">
                      <Users size={20} />
                    </div>
                    <div>
                      <h2 className="text-sm font-extrabold text-white sm:text-base">
                        จัดทีมและมอบหมายงานประจำวัน
                      </h2>
                      <p className="text-[11px] text-sky-200/80">
                        เลือกพนักงาน 1 คนหรือหลายคนจากซ้าย แล้วกำหนดทีม กะ รถ และพื้นที่รับผิดชอบเพื่อบันทึกพร้อมกัน
                      </p>
                    </div>
                  </div>
                </div>

                {/* Left Panel Body */}
                <div className="space-y-3.5 p-4 sm:p-5">
                  {/* 1. Real-time Search Box + Selected Counter Badge */}
                  <div className="flex items-center gap-2.5">
                    <div className="relative flex-1">
                      <Search
                        size={15}
                        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sky-300/70"
                      />
                      <input
                        id="duty-employee-search-add"
                        type="text"
                        list="duty-employee-options"
                        value={employeeInput}
                        onChange={(e) => setEmployeeInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddTypedEmployee();
                          }
                        }}
                        placeholder="ค้นหาชื่อ หรือพิมพ์ชื่อเพิ่ม (คั่นด้วย , แล้วกด Enter)..."
                        className="h-10 w-full rounded-xl border border-sky-400/35 bg-[#041029]/90 pr-9 pl-10 text-xs font-semibold text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                      />
                      {employeeInput && (
                        <button
                          type="button"
                          onClick={() => setEmployeeInput("")}
                          aria-label="ล้างคำค้นหา"
                          className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {employeeInput.trim() && (
                      <button
                        type="button"
                        onClick={handleAddTypedEmployee}
                        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-cyan-500/20 px-3 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30"
                        title="เพิ่มรายชื่อที่พิมพ์เข้ากลุ่มที่เลือก"
                      >
                        <UserPlus size={14} />
                        <span>เพิ่มชื่อ</span>
                      </button>
                    )}

                    <div className="inline-flex h-10 shrink-0 items-center rounded-xl border border-cyan-300/50 bg-gradient-to-r from-[#0284c7] to-[#2563eb] px-3.5 font-mono text-xs font-extrabold text-white tabular-nums shadow-[0_0_15px_rgba(14,165,233,0.4)]">
                      เลือกแล้ว {selectedEmployees.length} คน
                    </div>
                  </div>

                  <datalist id="duty-employee-options">
                    {activeEmployees.map((emp) => (
                      <option key={emp.employeeId} value={emp.employeeName} />
                    ))}
                  </datalist>

                  {/* 2 & 3. Filter Pills (ทั้งหมด / ยังไม่มอบหมาย) + Select All Checkbox Button */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEmployeePanelFilter("all")}
                      className={`h-8 rounded-full px-3.5 text-xs font-bold whitespace-nowrap transition ${
                        employeePanelFilter === "all"
                          ? "border border-cyan-300/70 bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_14px_rgba(14,165,233,0.45)]"
                          : "border border-sky-400/30 bg-[#071636] text-slate-300 hover:border-sky-400/60 hover:text-white"
                      }`}
                    >
                      ทั้งหมด {activeEmployees.length} คน
                    </button>

                    <button
                      type="button"
                      onClick={() => setEmployeePanelFilter("unassigned")}
                      className={`h-8 rounded-full px-3.5 text-xs font-bold whitespace-nowrap transition ${
                        employeePanelFilter === "unassigned"
                          ? "border border-cyan-300/70 bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_14px_rgba(14,165,233,0.45)]"
                          : "border border-sky-400/30 bg-[#071636] text-slate-300 hover:border-sky-400/60 hover:text-white"
                      }`}
                    >
                      ยังไม่มอบหมาย {unassignedEmployees.length} คน
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleSelectAllVisible}
                      disabled={filteredGridEmployees.length === 0}
                      className={`inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-xs font-bold whitespace-nowrap transition disabled:opacity-40 ${
                        areAllFilteredSelected
                          ? "border-cyan-300 bg-cyan-500/25 text-cyan-100"
                          : "border-sky-400/30 bg-[#071636] text-slate-200 hover:border-sky-400/60 hover:text-white"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          areAllFilteredSelected
                            ? "border-cyan-300 bg-cyan-400 text-slate-950"
                            : "border-slate-400 bg-transparent"
                        }`}
                      >
                        {areAllFilteredSelected && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span>
                        {areAllFilteredSelected ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
                      </span>
                    </button>
                  </div>

                  {/* 4 & 6. Employee 2-Column Grid with Internal Scrollbar & Skeleton/Empty State */}
                  {isRefreshing ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={`skel-${i}`}
                          className="h-10 animate-pulse rounded-xl border border-sky-400/20 bg-[#0c214a]/60"
                        />
                      ))}
                    </div>
                  ) : activeEmployees.length > 0 ? (
                    filteredGridEmployees.length > 0 ? (
                      <div
                        className={`grid grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 ${
                          compact ? "max-h-52" : "max-h-[310px]"
                        }`}
                      >
                        {filteredGridEmployees.map((emp) => {
                          const cleanKey = emp.employeeName.trim().toLowerCase();
                          const isSelected = selectedEmployeeNamesSet.has(cleanKey);
                          const assignedRow = dutiesForDate.find(
                            (d) =>
                              d.employeeName.trim().toLowerCase() === cleanKey ||
                              (emp.employeeId && d.employeeId === emp.employeeId)
                          );
                          return (
                            <button
                              key={emp.employeeId}
                              type="button"
                              onClick={() => handleToggleEmployee(emp)}
                              aria-pressed={isSelected}
                              className={`group flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                                isSelected
                                  ? "border-cyan-300 bg-gradient-to-r from-[#0284c7]/50 to-[#1e40af]/60 text-white shadow-[0_0_16px_rgba(56,189,248,0.35)]"
                                  : assignedRow
                                  ? "border-sky-400/20 bg-[#061433]/80 text-slate-300 hover:border-cyan-400/50 hover:bg-[#0b214d]"
                                  : "border-sky-400/30 bg-[#0a1d45]/90 text-slate-100 hover:border-cyan-400/60 hover:bg-[#0f295e]"
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                                    isSelected
                                      ? "border-cyan-300 bg-cyan-400 text-slate-950"
                                      : "border-sky-300/50 bg-[#041029]"
                                  }`}
                                >
                                  {isSelected && <Check size={11} strokeWidth={3} />}
                                </span>
                                <User
                                  size={14}
                                  className={
                                    isSelected ? "shrink-0 text-cyan-200" : "shrink-0 text-sky-300/80"
                                  }
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-bold">
                                    {emp.employeeName}
                                  </div>
                                  {emp.employeeId && (
                                    <div className="font-mono text-[10px] text-sky-300/65">
                                      {emp.employeeId}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {assignedRow && (
                                <span className="shrink-0 rounded-md border border-sky-400/30 bg-[#041029]/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
                                  {assignedRow.team.replace("ทีม ", "")} · {assignedRow.vehicleNumber}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-sky-400/30 bg-[#041029]/60 px-4 py-8 text-center text-xs text-slate-300">
                        {employeeInput.trim() ? (
                          <>
                            ไม่พบรายชื่อ &quot;{employeeInput.trim()}&quot; ในส่วนงาน Material Handling - Fleet — กดปุ่ม{" "}
                            <strong className="text-cyan-300">เพิ่มชื่อ</strong> หรือกด{" "}
                            <strong className="text-cyan-300">Enter</strong> เพื่อเพิ่มชื่อนี้เข้ากลุ่มที่เลือกได้ทันที
                          </>
                        ) : (
                          "พนักงานทุกคนได้รับการจัดทีมและมอบหมายงานครบแล้วในวันนี้"
                        )}
                      </div>
                    )
                  ) : (
                    <div className="rounded-xl border border-dashed border-sky-400/30 bg-[#041029]/60 px-4 py-8 text-center text-xs text-slate-300">
                      ยังไม่มีรายชื่อพนักงานส่วนงาน Material Handling - Fleet — พิมพ์ชื่อ-สกุลด้านบนแล้วกด Enter
                    </div>
                  )}
                </div>
              </div>

              {/* 5. Selected Employee Counter Status Footer */}
              <div className="border-t border-sky-400/20 bg-[#05112b]/90 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                        selectedEmployees.length > 0
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                          : "border-emerald-500/50 bg-emerald-950/50 text-emerald-400"
                      }`}
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                    {selectedEmployees.length === 0 ? (
                      <span className="text-slate-300">
                        ยังไม่ได้เลือกพนักงาน (ทั้งหมด {activeEmployees.length} คน)
                      </span>
                    ) : (
                      <span className="text-emerald-300 tabular-nums">
                        เลือกพนักงานแล้ว <strong>{selectedEmployees.length}</strong> จาก{" "}
                        {activeEmployees.length} คน
                      </span>
                    )}
                  </div>

                  {selectedEmployees.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEmployees([]);
                        setEditingId(null);
                      }}
                      className="text-[11px] font-bold text-rose-300 hover:text-rose-200 hover:underline"
                    >
                      ล้างที่เลือกทั้งหมด
                    </button>
                  )}
                </div>

                {selectedEmployees.length > 0 && (
                  <div className="mt-2 flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
                    {selectedEmployees.map((sel) => (
                      <button
                        key={`sel-chip-${sel.employeeName}`}
                        type="button"
                        onClick={() => handleToggleEmployee(sel)}
                        className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-500/20 px-2 py-0.5 text-[11px] font-bold text-cyan-100 transition hover:bg-rose-500/30 hover:border-rose-400/50"
                        title="คลิกเพื่อเอาออกจากรายการที่เลือก"
                      >
                        <span>{sel.employeeName}</span>
                        <X size={11} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* -----------------------------------------------------------------
                RIGHT PANEL: WORK ASSIGNMENT (กำหนดหน้าที่ของพนักงานในแต่ละวัน)
            ----------------------------------------------------------------- */}
            <div className="flex flex-col justify-between overflow-hidden rounded-2xl border border-sky-400/35 bg-gradient-to-b from-[#092252]/95 via-[#07193d]/95 to-[#061330]/95 shadow-[0_12px_35px_rgba(2,10,30,0.6)] lg:col-span-6">
              <div>
                {/* Right Panel Header */}
                <div className="flex items-center justify-between gap-3 border-b border-sky-400/25 bg-gradient-to-r from-[#0d3175]/80 via-[#0a255c]/80 to-transparent px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-400/15 text-cyan-200">
                      <Wrench size={19} />
                    </div>
                    <div>
                      <h2 className="text-sm font-extrabold text-white sm:text-base">
                        {editingId && selectedEmployees.length <= 1
                          ? "แก้ไขหน้าที่ของพนักงาน"
                          : "กำหนดหน้าที่ของพนักงานในแต่ละวัน"}
                      </h2>
                      <p className="text-[11px] text-sky-200/80">
                        กำหนดกะทำงาน รถที่รับผิดชอบ พื้นที่ ทีม A/B/C และเวลาเลิกงาน
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right Panel Body */}
                <div className="space-y-4 p-4 sm:p-5">
                  {/* Row 1: 1. กำหนดกะทำงานพนักงาน & 4. กำหนดทีม A / B / C */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                    {/* 1. กำหนดกะทำงานพนักงาน */}
                    <div className="sm:col-span-6">
                      <label className="mb-2 flex items-center gap-2 text-xs font-bold text-sky-100">
                        <Calendar size={14} className="text-cyan-300" />
                        <span>1. กำหนดกะทำงานพนักงาน *</span>
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-sky-400/30 bg-[#041029]/90 p-1">
                        {MH_SHIFTS.map((sOpt) => {
                          const isMorning = sOpt === "กะเช้า";
                          const active = shift === sOpt;
                          return (
                            <button
                              key={sOpt}
                              type="button"
                              onClick={() => {
                                setShift(sOpt);
                                setEndTime((prev) => normalizeEndTimeForShift(sOpt, prev));
                              }}
                              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-extrabold whitespace-nowrap transition ${
                                active
                                  ? "border border-cyan-300/80 bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_16px_rgba(14,165,233,0.5)]"
                                  : "text-slate-300 hover:bg-white/5 hover:text-white"
                              }`}
                            >
                              {isMorning ? (
                                <Sun size={14} className={active ? "text-amber-200" : "text-slate-400"} />
                              ) : (
                                <Moon size={14} className={active ? "text-cyan-100" : "text-slate-400"} />
                              )}
                              <span>{sOpt}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 4. กำหนดทีม A / B / C */}
                    <div className="sm:col-span-6">
                      <label className="mb-2 block text-xs font-bold text-sky-100">
                        4. กำหนดทีม A / B / C *
                      </label>
                      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-sky-400/30 bg-[#041029]/90 p-1">
                        {MH_TEAMS.map((tOpt) => {
                          const active = team === tOpt;
                          const activeTeamClass =
                            tOpt === "ทีม A"
                              ? "border border-cyan-300/80 bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_15px_rgba(14,165,233,0.5)]"
                              : tOpt === "ทีม B"
                              ? "border border-purple-300/80 bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]"
                              : "border border-emerald-300/80 bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)]";
                          return (
                            <button
                              key={tOpt}
                              type="button"
                              onClick={() => setTeam(tOpt)}
                              className={`h-9 rounded-lg px-2 text-xs font-extrabold whitespace-nowrap transition ${
                                active
                                  ? activeTeamClass
                                  : "text-slate-300 hover:bg-white/5 hover:text-white"
                              }`}
                            >
                              {tOpt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* 2. กำหนดรถที่รับผิดชอบ */}
                  <div>
                    <label
                      htmlFor="duty-vehicle-select"
                      className="mb-2 flex items-center gap-2 text-xs font-bold text-sky-100"
                    >
                      <Truck size={15} className="text-cyan-300" />
                      <span>2. กำหนดรถที่รับผิดชอบ *</span>
                    </label>
                    <select
                      id="duty-vehicle-select"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value)}
                      className="h-10 w-full rounded-xl border border-sky-400/35 bg-[#041029]/90 px-3.5 text-xs font-bold text-white focus:border-cyan-400 focus:outline-none"
                    >
                      {activeVehicles.map((v) => (
                        <option key={v.id} value={v.vehicleId} className="bg-[#061536] text-white">
                          {v.vehicleId} ({v.vehicleType})
                        </option>
                      ))}
                      <option value="-" className="bg-[#061536] text-white">
                        -- ไม่ระบุรถ / ปฏิบัติงานทั่วไป --
                      </option>
                    </select>

                    {/* Quick Vehicle Selection Pills */}
                    {activeVehicles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {activeVehicles.map((v) => {
                          const active = vehicleNumber === v.vehicleId;
                          return (
                            <button
                              key={`qv-btn-${v.id}`}
                              type="button"
                              onClick={() => setVehicleNumber(v.vehicleId)}
                              className={`h-8 rounded-lg border px-3 font-mono text-xs font-bold whitespace-nowrap transition ${
                                active
                                  ? "border-cyan-300 bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_12px_rgba(14,165,233,0.45)]"
                                  : "border-sky-400/30 bg-[#061536]/90 text-slate-200 hover:border-cyan-400/60 hover:text-white"
                              }`}
                            >
                              {v.vehicleId}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 3. กำหนดพื้นที่รับผิดชอบ */}
                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs font-bold text-sky-100">
                      <MapPin size={15} className="text-cyan-300" />
                      <span>3. กำหนดพื้นที่รับผิดชอบ *</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {MH_WORK_AREAS.map((area) => {
                        const active = workArea === area;
                        return (
                          <button
                            key={area}
                            type="button"
                            onClick={() => setWorkArea(area)}
                            className={`h-8 rounded-lg border px-3 text-xs font-bold whitespace-nowrap transition ${
                              active
                                ? "border-cyan-300 bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_12px_rgba(14,165,233,0.45)]"
                                : "border-sky-400/30 bg-[#061536]/90 text-slate-200 hover:border-cyan-400/60 hover:text-white"
                            }`}
                          >
                            {area}
                          </button>
                        );
                      })}
                      <input
                        type="text"
                        value={workArea}
                        onChange={(e) => setWorkArea(e.target.value)}
                        placeholder="หรือระบุพื้นที่เพิ่มเติม..."
                        aria-label="พื้นที่รับผิดชอบเพิ่มเติม"
                        className="h-8 min-w-[150px] flex-1 rounded-lg border border-sky-400/35 bg-[#041029]/90 px-3 text-xs font-semibold text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* 5. เวลาเลิกงาน (Filtered by Shift + Custom Time Picker) */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label
                        htmlFor="duty-end-time-picker"
                        className="flex items-center gap-2 text-xs font-bold text-sky-100"
                      >
                        <Clock size={15} className="text-cyan-300" />
                        <span>5. เวลาเลิกงาน ({shift}) *</span>
                      </label>
                      <span className="text-[11px] text-sky-200/75">
                        ตัวเลือกตาม{shift} หรือระบุเวลาเอง
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {getEndTimesForShift(shift).map((timeOpt) => {
                        const active = endTime === timeOpt;
                        return (
                          <button
                            key={`${shift}-${timeOpt}`}
                            type="button"
                            onClick={() => setEndTime(timeOpt)}
                            className={`h-9 rounded-lg border px-3.5 font-mono text-xs font-extrabold whitespace-nowrap transition ${
                              active
                                ? "border-cyan-300 bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[0_0_14px_rgba(14,165,233,0.5)]"
                                : "border-sky-400/30 bg-[#061536]/90 text-slate-200 hover:border-cyan-400/60 hover:text-white"
                            }`}
                          >
                            {timeOpt} น.
                          </button>
                        );
                      })}

                      <input
                        id="duty-end-time-picker"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        aria-label="กำหนดเวลาเลิกงานเอง"
                        className="h-9 rounded-lg border border-sky-400/40 bg-[#041029]/95 px-3 font-mono text-xs font-extrabold text-white focus:border-cyan-400 focus:outline-none [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  {/* 6. หมายเหตุ / คำสั่งหน้างาน (Textarea) */}
                  <div>
                    <label
                      htmlFor="duty-notes-textarea"
                      className="mb-2 flex items-center gap-2 text-xs font-bold text-sky-100"
                    >
                      <MessageSquare size={15} className="text-cyan-300" />
                      <span>หมายเหตุ / คำสั่งหน้างาน (ไม่บังคับ)</span>
                    </label>
                    <textarea
                      id="duty-notes-textarea"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="ระบุหมายเหตุเพิ่มเติม..."
                      className="w-full resize-y rounded-xl border border-sky-400/35 bg-[#041029]/90 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===================================================================
              SECTION 4: BOTTOM ACTION BUTTONS BAR
          =================================================================== */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-400/30 bg-[#061433]/90 px-4 py-3 shadow-[0_8px_25px_rgba(2,8,23,0.6)] sm:px-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (
                    selectedEmployees.length > 0 ||
                    employeeInput.trim() ||
                    notes.trim() ||
                    editingId
                  ) {
                    setShowClearConfirm(true);
                  } else {
                    executeResetForm();
                  }
                }}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-sky-400/35 bg-[#0a214d] px-4 text-xs font-bold text-slate-200 transition hover:border-cyan-300/60 hover:bg-[#102d66] hover:text-white"
              >
                <RotateCcw size={14} className="text-cyan-300" />
                <span>ล้างข้อมูล</span>
              </button>

              {(editingId || selectedEmployees.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setSelectedEmployees([]);
                    setEmployeeInput("");
                    setNotes("");
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-600/70 bg-slate-800/70 px-4 text-xs font-bold text-slate-300 transition hover:bg-slate-700 hover:text-white"
                >
                  <X size={14} />
                  <span>ยกเลิก</span>
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-11 min-w-[210px] items-center justify-between gap-4 rounded-xl border border-cyan-300/80 bg-gradient-to-r from-[#0284c7] via-[#0ea5e9] to-[#2563eb] px-6 text-sm font-extrabold text-white shadow-[0_0_25px_rgba(14,165,233,0.55)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="inline-flex items-center gap-2">
                <Save size={17} />
                <span>
                  {isSaving
                    ? "กำลังบันทึกข้อมูล..."
                    : editingId && selectedEmployees.length <= 1
                    ? "อัปเดตข้อมูล"
                    : selectedEmployees.length > 1
                    ? `บันทึกข้อมูล (${selectedEmployees.length} คน)`
                    : "บันทึกข้อมูล"}
                </span>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
        </form>

        {/* =====================================================================
            SECTION 5: ASSIGNED ROSTER TABLE FOR SELECTED DATE
        ===================================================================== */}
        <div className="overflow-hidden rounded-2xl border border-sky-400/30 bg-[#071739]/95 shadow-[0_12px_35px_rgba(2,10,30,0.6)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-400/25 bg-[#09204f]/80 px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-extrabold text-white">
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
                {filteredDuties.length} รายการ
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
                className="rounded-lg border border-sky-400/30 bg-[#041029] text-white focus:border-cyan-400 focus:outline-none"
                style={{
                  height: 35,
                  minHeight: 35,
                  padding: "7px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                }}
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
                  placeholder="ค้นหาชื่อ, รถ, พื้นที่..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48 rounded-lg border border-sky-400/30 bg-[#041029] text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                  style={{
                    height: 35,
                    minHeight: 35,
                    padding: "7px 10px 7px 30px",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
              </div>
            </div>
          </div>

          <div className={`overflow-x-auto ${compact ? "max-h-72 overflow-y-auto" : ""}`}>
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-sky-400/20 bg-[#041029]/90 text-[11px] font-bold text-sky-200">
                  <th className="w-10 px-4 py-3 text-center">#</th>
                  <th className="px-4 py-3 whitespace-nowrap">พนักงาน</th>
                  <th className="px-4 py-3 whitespace-nowrap">1. กะทำงาน</th>
                  <th className="px-4 py-3 whitespace-nowrap">2. รถที่ขึ้นขับ</th>
                  <th className="px-4 py-3 whitespace-nowrap">3. พื้นที่รับผิดชอบ</th>
                  <th className="px-4 py-3 whitespace-nowrap">4. ทีม A / B / C</th>
                  <th className="px-4 py-3 whitespace-nowrap">5. เวลาเลิกงาน</th>
                  <th className="px-4 py-3 whitespace-nowrap">หมายเหตุ</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-400/15">
                {filteredDuties.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-10 text-center text-xs text-slate-300"
                    >
                      {dutiesForDate.length === 0
                        ? `ยังไม่มีรายการวางแผนกำลังคนสำหรับวันที่ ${selectedDate} — เลือกพนักงานจากด้านซ้าย หรือกดปุ่ม "คัดลอกวันก่อนหน้า"`
                        : "ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา"}
                    </td>
                  </tr>
                ) : (
                  filteredDuties.map((row, idx) => (
                    <tr
                      key={row.id}
                      className="transition hover:bg-sky-400/10"
                    >
                      <td className="px-4 py-2.5 text-center font-mono text-[11px] text-slate-400 tabular-nums">
                        {idx + 1}
                      </td>

                      <td className="px-4 py-2.5">
                        <div className="font-bold text-white">{row.employeeName}</div>
                        {row.employeeId && (
                          <div className="font-mono text-[10px] text-sky-300/75">
                            {row.employeeId}
                          </div>
                        )}
                      </td>

                      {/* 1. Shift */}
                      <td className="px-4 py-2.5">
                        <div className="inline-flex rounded-lg border border-sky-400/25 bg-[#041029] p-0.5">
                          {MH_SHIFTS.map((sOpt) => {
                            const active = row.shift === sOpt;
                            return (
                              <button
                                key={`${row.id}-${sOpt}`}
                                type="button"
                                onClick={() =>
                                  handleQuickPatchRow(row, {
                                    shift: sOpt,
                                    endTime: normalizeEndTimeForShift(sOpt, row.endTime),
                                  })
                                }
                                className={`rounded-md px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition ${
                                  active
                                    ? "bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white"
                                    : "text-slate-400 hover:text-white"
                                }`}
                              >
                                {sOpt}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      {/* 2. Vehicle Quick Select */}
                      <td className="px-4 py-2.5">
                        <select
                          value={row.vehicleNumber}
                          onChange={(e) =>
                            handleQuickPatchRow(row, { vehicleNumber: e.target.value })
                          }
                          aria-label={`รถโฟล์คลิฟท์ของ ${row.employeeName}`}
                          className="h-8 rounded-lg border border-sky-400/30 bg-[#041029] px-2.5 font-mono text-xs font-bold text-cyan-200 focus:border-cyan-400 focus:outline-none"
                        >
                          <option value="-">-</option>
                          {activeVehicles.map((v) => (
                            <option key={v.id} value={v.vehicleId}>
                              {v.vehicleId}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* 3. Work Area Quick Select */}
                      <td className="px-4 py-2.5">
                        <select
                          value={row.workArea}
                          onChange={(e) =>
                            handleQuickPatchRow(row, { workArea: e.target.value })
                          }
                          aria-label={`พื้นที่รับผิดชอบของ ${row.employeeName}`}
                          className="h-8 rounded-lg border border-sky-400/30 bg-[#041029] px-2.5 text-xs font-semibold text-white focus:border-cyan-400 focus:outline-none"
                        >
                          {!MH_WORK_AREAS.includes(
                            row.workArea as (typeof MH_WORK_AREAS)[number]
                          ) && <option value={row.workArea}>{row.workArea}</option>}
                          {MH_WORK_AREAS.map((area) => (
                            <option key={area} value={area}>
                              {area}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* 4. Team A / B / C */}
                      <td className="px-4 py-2.5">
                        <div className="inline-flex rounded-lg border border-sky-400/25 bg-[#041029] p-0.5">
                          {MH_TEAMS.map((tOpt) => {
                            const active = row.team === tOpt;
                            const badgeColor =
                              tOpt === "ทีม A"
                                ? "bg-sky-500 text-white"
                                : tOpt === "ทีม B"
                                ? "bg-purple-600 text-white"
                                : "bg-emerald-600 text-white";
                            return (
                              <button
                                key={`${row.id}-${tOpt}`}
                                type="button"
                                onClick={() => handleQuickPatchRow(row, { team: tOpt })}
                                className={`rounded-md px-2 py-1 text-[11px] font-bold whitespace-nowrap transition ${
                                  active ? badgeColor : "text-slate-400 hover:text-white"
                                }`}
                              >
                                {tOpt}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      {/* 5. End of Shift Time (เวลาเลิกงาน) */}
                      <td className="px-4 py-2.5">
                        <select
                          value={
                            getEndTimesForShift(row.shift).includes(row.endTime || "")
                              ? row.endTime
                              : normalizeEndTimeForShift(row.shift, row.endTime)
                          }
                          onChange={(e) =>
                            handleQuickPatchRow(row, { endTime: e.target.value })
                          }
                          aria-label={`เวลาเลิกงานของ ${row.employeeName}`}
                          className="h-8 rounded-lg border border-sky-400/30 bg-[#041029] px-2.5 font-mono text-xs font-bold text-amber-300 focus:border-cyan-400 focus:outline-none"
                        >
                          {row.endTime &&
                            !getEndTimesForShift(row.shift).includes(row.endTime) && (
                              <option value={row.endTime}>{row.endTime} น.</option>
                            )}
                          {getEndTimesForShift(row.shift).map((timeOpt) => (
                            <option key={`${row.id}-${timeOpt}`} value={timeOpt}>
                              {timeOpt} น.
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Notes */}
                      <td className="max-w-[180px] px-4 py-2.5">
                        <span className="block truncate text-xs text-slate-300">
                          {row.notes || "—"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(row.id);
                              setSelectedEmployees([
                                {
                                  employeeId: row.employeeId,
                                  employeeName: row.employeeName,
                                },
                              ]);
                              setEmployeeInput("");
                              setWorkArea(row.workArea);
                              setVehicleNumber(row.vehicleNumber);
                              setShift(row.shift);
                              setTeam(row.team);
                              setEndTime(
                                row.endTime || normalizeEndTimeForShift(row.shift, row.endTime)
                              );
                              setNotes(row.notes || "");
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-400/30 bg-[#041029] text-sky-200 transition hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white"
                            title="โหลดเข้าฟอร์มเพื่อแก้ไข"
                            aria-label={`แก้ไขงานของ ${row.employeeName}`}
                          >
                            <Edit3 size={13} />
                          </button>

                          {confirmDeleteId === row.id ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteDuty(row.id)}
                              className="h-8 rounded-lg bg-rose-600 px-2.5 text-[11px] font-bold text-white hover:bg-rose-500"
                            >
                              ยืนยันลบ
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(row.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/35 bg-[#041029] text-rose-400 transition hover:bg-rose-500/20 hover:text-rose-200"
                              title="ลบการมอบหมายงาน"
                              aria-label={`ลบงานของ ${row.employeeName}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
