/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  Copy,
  Users,
  Truck,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Search,
  RefreshCw,
  Edit3,
  X,
  Check,
  UserPlus,
} from "lucide-react";
import { Employee, Vehicle } from "../types/officer";
import {
  MH_TEAMS,
  MH_SHIFTS,
  MH_WORK_AREAS,
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

function getTeamBadgeStyle(team: string): string {
  if (team === "ทีม A") {
    return "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-200";
  }
  if (team === "ทีม B") {
    return "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200";
  }
  if (team === "ทีม C") {
    return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200";
  }
  return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
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

  const setAllDuties = (updater: MhDailyDutyRecord[] | ((prev: MhDailyDutyRecord[]) => MhDailyDutyRecord[])) => {
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
  const [workArea, setWorkArea] = useState<string>(MH_WORK_AREAS[0]);
  const [vehicleNumber, setVehicleNumber] = useState<string>(vehicles[0]?.vehicleId || "-");
  const [shift, setShift] = useState<string>(MH_SHIFTS[0]);
  const [team, setTeam] = useState<string>(MH_TEAMS[0]);
  const [notes, setNotes] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterTeam, setFilterTeam] = useState<string>("All");
  const [filterShift, setFilterShift] = useState<string>("All");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.employmentStatus === "Active"),
    [employees]
  );

  const activeVehicles = useMemo(
    () => vehicles.filter((v) => v.activeStatus === "Active"),
    [vehicles]
  );

  const dutiesForDate = useMemo(
    () => allDuties.filter((d) => d.workingDate === selectedDate),
    [allDuties, selectedDate]
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

  // Determine source date available to copy from (yesterday first, else latest date < selectedDate)
  const previousCopySource = useMemo(() => {
    const yesterday = getYesterdayYmd(selectedDate);
    const yesterdayRows = allDuties.filter((d) => d.workingDate === yesterday);
    if (yesterdayRows.length > 0) {
      return { date: yesterday, rows: yesterdayRows };
    }
    const priorDates = Array.from(
      new Set(
        allDuties
          .map((d) => d.workingDate)
          .filter((dt) => dt && dt < selectedDate)
      )
    ).sort((a, b) => b.localeCompare(a));

    if (priorDates.length > 0) {
      const latestPrior = priorDates[0];
      return {
        date: latestPrior,
        rows: allDuties.filter((d) => d.workingDate === latestPrior),
      };
    }
    return null;
  }, [allDuties, selectedDate]);

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
    const raw = employeeInput.trim();
    if (!raw || raw.includes(",") || raw.includes(";")) return activeEmployees;
    const q = raw.toLowerCase();
    return activeEmployees.filter(
      (emp) =>
        emp.employeeName.toLowerCase().includes(q) ||
        emp.employeeId.toLowerCase().includes(q)
    );
  }, [activeEmployees, employeeInput]);

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

  const handleSelectAllUnassigned = () => {
    setEditingId(null);
    setSelectedEmployees((prev) => {
      const existingSet = new Set(prev.map((item) => item.employeeName.trim().toLowerCase()));
      const additions = unassignedEmployees
        .filter((emp) => !existingSet.has(emp.employeeName.trim().toLowerCase()))
        .map((emp) => ({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName.trim(),
        }));
      return [...prev, ...additions];
    });
  };

  const handleSelectAllActive = () => {
    setEditingId(null);
    setSelectedEmployees(
      activeEmployees.map((emp) => ({
        employeeId: emp.employeeId,
        employeeName: emp.employeeName.trim(),
      }))
    );
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();

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
      setFeedback({ type: "error", text: "กรุณาเลือกหรือพิมพ์ชื่อ-สกุลพนักงานอย่างน้อย 1 คน" });
      return;
    }

    setIsSaving(true);
    try {
      const { timestamp } = formatForkliftNowTimestamp();
      const cleanArea = workArea.trim() || "อาคาร A";
      const cleanVehicle = vehicleNumber.trim() || "-";

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
        module: "Daily Duty Assignment",
        sectionId: "fleet_ops",
        reference: selectedDate,
        activity: `มอบหมายงานประจำวัน ${selectedDate} จำนวน ${records.length} คน (${team} · ${shift} · ${cleanArea})`,
        status: "Completed",
      });

      const summaryNames =
        records.length === 1
          ? `"${records[0].employeeName}"`
          : `จำนวน ${records.length} คน (${records.map((r) => r.employeeName).join(", ")})`;

      setFeedback({
        type: "success",
        text: `บันทึกการมอบหมายงาน ${summaryNames} เข้า ${team} · ${shift} · ${cleanArea} · รถ ${cleanVehicle} เรียบร้อยแล้ว`,
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
    patch: Partial<Pick<MhDailyDutyRecord, "team" | "shift" | "workArea" | "vehicleNumber">>
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

  return (
    <div className="space-y-5">
      {/* Feedback Alert */}
      {feedback && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold ${
            feedback.type === "error"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Section 1: Workspace Header Toolbar & KPI Strip (Single-Elevation Card) */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-[#1e3a5f]">
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="duty-working-date"
              className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200"
            >
              <Calendar size={15} className="text-cyan-600 dark:text-cyan-400" />
              <span>วันที่ปฏิบัติงาน</span>
            </label>
            <input
              id="duty-working-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-600 focus:bg-white focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
            />
            {selectedDate !== getTodayYmd() && (
              <button
                type="button"
                onClick={() => setSelectedDate(getTodayYmd())}
                className="rounded-lg border border-cyan-600 px-3 py-1.5 text-xs font-bold text-cyan-700 whitespace-nowrap shrink-0 hover:bg-cyan-50 dark:border-cyan-500 dark:text-cyan-300 dark:hover:bg-cyan-950/40"
              >
                กลับสู่วันนี้
              </button>
            )}
            <span className="hidden text-xs text-slate-400 sm:inline" aria-hidden="true">
              |
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
              กะเช้า <strong className="text-slate-900 dark:text-white">{shiftCounts["กะเช้า"] || 0}</strong> คน
              <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                ·
              </span>
              กะดึก <strong className="text-slate-900 dark:text-white">{shiftCounts["กะดึก"] || 0}</strong> คน
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyPreviousDay}
              disabled={isSaving || !previousCopySource}
              title={
                previousCopySource
                  ? `คัดลอกข้อมูลจากวันที่ ${previousCopySource.date} (${previousCopySource.rows.length} คน)`
                  : "ยังไม่มีข้อมูลวันก่อนหน้าให้คัดลอก"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 whitespace-nowrap shrink-0 transition hover:border-indigo-400 hover:bg-indigo-50/60 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-indigo-950/60"
            >
              <Copy size={13} />
              <span>คัดลอกวันก่อนหน้า</span>
              {previousCopySource && (
                <span className="font-mono text-[11px] opacity-75 tabular-nums">
                  ({previousCopySource.date})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleRefreshCloud}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 whitespace-nowrap shrink-0 transition hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200 dark:hover:bg-[#1d3158]"
            >
              <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
              <span>รีเฟรช</span>
            </button>
          </div>
        </div>

        {/* 5-Column KPI Summary Strip */}
        <div className="grid grid-cols-2 divide-y divide-slate-200 sm:grid-cols-5 sm:divide-x sm:divide-y-0 dark:divide-[#1e3a5f]">
          <button
            type="button"
            onClick={() => setFilterTeam("All")}
            className={`flex flex-col items-start px-5 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-[#162544]/60 ${
              filterTeam === "All" ? "bg-slate-50/70 dark:bg-[#0d1930]/60" : ""
            }`}
          >
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              มอบหมายงานแล้ว
            </span>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-extrabold text-slate-900 tabular-nums dark:text-white">
                {dutiesForDate.length}
              </span>
              <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                / {activeEmployees.length} คน
              </span>
            </div>
          </button>

          <div className="flex flex-col items-start px-5 py-3">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              ยังไม่จัดทีม
            </span>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span
                className={`font-mono text-xl font-extrabold tabular-nums ${
                  unassignedEmployees.length > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {unassignedEmployees.length}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">คน</span>
            </div>
          </div>

          {MH_TEAMS.map((tOpt) => {
            const isFiltered = filterTeam === tOpt;
            const accentColor =
              tOpt === "ทีม A"
                ? "text-sky-700 dark:text-sky-300"
                : tOpt === "ทีม B"
                ? "text-indigo-700 dark:text-indigo-300"
                : "text-amber-700 dark:text-amber-300";
            return (
              <button
                key={`kpi-${tOpt}`}
                type="button"
                onClick={() => setFilterTeam((prev) => (prev === tOpt ? "All" : tOpt))}
                title={`คลิกเพื่อกรองเฉพาะ ${tOpt}`}
                className={`flex flex-col items-start px-5 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-[#162544]/60 ${
                  isFiltered ? "bg-cyan-50/70 dark:bg-cyan-950/30" : ""
                }`}
              >
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {tOpt} {isFiltered ? "(กำลังกรอง)" : ""}
                </span>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className={`font-mono text-xl font-extrabold tabular-nums ${accentColor}`}>
                    {teamCounts[tOpt] || 0}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">คน</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 2: Two-Column Assignment Workbench (Single Elevation, Hairline Divider) */}
      <form
        onSubmit={handleSaveAssignment}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]"
      >
        {/* Workbench Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-[#1e3a5f]">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <Users size={16} className="text-cyan-600 dark:text-cyan-400" />
              <span>
                {editingId && selectedEmployees.length <= 1
                  ? "แก้ไขการมอบหมายงานพนักงาน"
                  : "จัดทีมและมอบหมายงานประจำวัน"}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              เลือกพนักงาน 1 คนหรือหลายคนทางซ้าย แล้วกำหนดทีม กะ รถ และพื้นที่ทางขวาเพื่อบันทึกพร้อมกัน
            </p>
          </div>

          {(editingId || selectedEmployees.length > 0 || employeeInput.trim() || notes.trim()) && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setSelectedEmployees([]);
                setEmployeeInput("");
                setNotes("");
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 whitespace-nowrap shrink-0 hover:bg-slate-50 hover:text-slate-900 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-300 dark:hover:text-white"
            >
              ล้างค่าฟอร์ม
            </button>
          )}
        </div>

        {/* 2-Column Split Body */}
        <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-[#1e3a5f]">
          {/* Left Zone: Employee Multi-Selector */}
          <div className="flex flex-col gap-3.5 p-5 lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="duty-employee-search-add"
                className="text-xs font-bold text-slate-800 dark:text-slate-100"
              >
                01. เลือกพนักงาน (คลิกเลือกได้หลายคน)
              </label>
              <span className="font-mono text-xs font-bold text-cyan-700 tabular-nums dark:text-cyan-300">
                เลือกแล้ว {selectedEmployees.length} คน
              </span>
            </div>

            {/* Search / Custom Add Bar */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
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
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pr-3 pl-9 text-xs font-semibold text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={handleAddTypedEmployee}
                disabled={!employeeInput.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-600 bg-cyan-50 px-3.5 py-2 text-xs font-bold text-cyan-800 whitespace-nowrap transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-cyan-500 dark:bg-cyan-950/60 dark:text-cyan-200"
                title="เพิ่มชื่อที่พิมพ์เข้ากลุ่มที่เลือก"
              >
                <UserPlus size={14} />
                <span>เพิ่มชื่อ</span>
              </button>
            </div>
            <datalist id="duty-employee-options">
              {activeEmployees.map((emp) => (
                <option key={emp.employeeId} value={emp.employeeName} />
              ))}
            </datalist>

            {/* Quick Bulk Selection Bar */}
            {activeEmployees.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-500 tabular-nums dark:text-slate-400">
                  ทั้งหมด {activeEmployees.length} คน · ยังไม่มีงาน {unassignedEmployees.length} คน
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  {unassignedEmployees.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSelectAllUnassigned}
                      className="font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                    >
                      เลือกคนที่ยังไม่มีงาน ({unassignedEmployees.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSelectAllActive}
                    className="font-semibold text-slate-600 hover:text-slate-900 hover:underline dark:text-slate-300 dark:hover:text-white"
                  >
                    เลือกทั้งหมด
                  </button>
                  {selectedEmployees.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedEmployees([])}
                      className="font-semibold text-red-600 hover:underline dark:text-red-400"
                    >
                      ล้างที่เลือก
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Uniform Multi-Select Employee Grid */}
            {activeEmployees.length > 0 ? (
              filteredGridEmployees.length > 0 ? (
                <div
                  className={`grid grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 ${
                    compact ? "max-h-48" : "max-h-60"
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
                        className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                          isSelected
                            ? "border-cyan-600 bg-cyan-50 text-cyan-950 dark:border-cyan-500 dark:bg-cyan-950/60 dark:text-cyan-100"
                            : assignedRow
                            ? "border-slate-200 bg-slate-50/70 text-slate-600 hover:border-cyan-400 dark:border-[#1e3a5f] dark:bg-[#0c162c]/70 dark:text-slate-400"
                            : "border-slate-200 bg-white text-slate-800 hover:border-cyan-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-100"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                              isSelected
                                ? "border-cyan-600 bg-cyan-600 text-white"
                                : "border-slate-300 bg-white dark:border-slate-600 dark:bg-[#0c162c]"
                            }`}
                          >
                            {isSelected && <Check size={11} strokeWidth={3} />}
                          </span>
                          <span className="truncate text-xs font-semibold">
                            {emp.employeeName}
                          </span>
                        </div>
                        {assignedRow && (
                          <span className="shrink-0 text-[10px] font-bold text-slate-400 dark:text-slate-500">
                            {assignedRow.team.replace("ทีม ", "")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500 dark:border-[#2c4a75] dark:text-slate-400">
                  ไม่พบชื่อ &quot;{employeeInput.trim()}&quot; ในทำเนียบ — กดปุ่ม{" "}
                  <strong className="text-cyan-700 dark:text-cyan-300">เพิ่มชื่อ</strong> หรือกด{" "}
                  <strong>Enter</strong> เพื่อเพิ่มรายชื่อนี้ได้ทันที
                </div>
              )
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500 dark:border-[#2c4a75] dark:text-slate-400">
                ยังไม่มีรายชื่อพนักงานในทำเนียบ — พิมพ์ชื่อ-สกุลด้านบนแล้วกด &quot;เพิ่มชื่อ&quot;
              </div>
            )}

            {/* Selected Employees Removable Tags (Inline Hairline Strip) */}
            {selectedEmployees.length > 0 && (
              <div className="border-t border-slate-100 pt-3 dark:border-[#1e3a5f]">
                <div className="mb-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  รายชื่อที่จะบันทึก ({selectedEmployees.length} คน):
                </div>
                <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {selectedEmployees.map((sel) => (
                    <button
                      key={`sel-${sel.employeeName}`}
                      type="button"
                      onClick={() => handleToggleEmployee(sel)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-cyan-600 dark:hover:bg-cyan-700"
                      title="คลิกเพื่อเอาออกจากรายการ"
                    >
                      <span>{sel.employeeName}</span>
                      <X size={12} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Zone: Duty Configuration */}
          <div className="flex flex-col justify-between gap-4 p-5 lg:col-span-6">
            <div className="space-y-4">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                02. กำหนดทีม กะ รถ และพื้นที่ปฏิบัติงาน
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Team Segmented Control */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    ทีมปฏิบัติงาน *
                  </label>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0c162c]">
                    {MH_TEAMS.map((tOpt) => (
                      <button
                        key={tOpt}
                        type="button"
                        onClick={() => setTeam(tOpt)}
                        className={`rounded-md px-2 py-2 text-xs font-bold whitespace-nowrap transition ${
                          team === tOpt
                            ? "bg-cyan-600 text-white shadow-xs"
                            : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                        }`}
                      >
                        {tOpt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Shift Segmented Control */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <Clock size={12} />
                    <span>กะทำงาน *</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0c162c]">
                    {MH_SHIFTS.map((sOpt) => (
                      <button
                        key={sOpt}
                        type="button"
                        onClick={() => setShift(sOpt)}
                        className={`rounded-md px-2 py-2 text-xs font-bold whitespace-nowrap transition ${
                          shift === sOpt
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                        }`}
                      >
                        {sOpt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Vehicle Selector */}
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label
                    htmlFor="duty-vehicle-select"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    <Truck size={12} />
                    <span>รถโฟล์คลิฟท์ที่ขับ</span>
                  </label>
                  {activeVehicles.length > 0 && (
                    <span className="text-[11px] text-slate-400">คลิกเลือกรถด่วนได้</span>
                  )}
                </div>
                <select
                  id="duty-vehicle-select"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
                >
                  <option value="-">-- ไม่ระบุรถ / ทั่วไป --</option>
                  {activeVehicles.map((v) => (
                    <option key={v.id} value={v.vehicleId}>
                      {v.vehicleId} ({v.vehicleType})
                    </option>
                  ))}
                </select>

                {activeVehicles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeVehicles.slice(0, 8).map((v) => (
                      <button
                        key={`qv-${v.id}`}
                        type="button"
                        onClick={() => setVehicleNumber(v.vehicleId)}
                        className={`rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                          vehicleNumber === v.vehicleId
                            ? "border-cyan-600 bg-cyan-600 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-400 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                        }`}
                      >
                        {v.vehicleId}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Work Area Quick Toggles */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <MapPin size={12} />
                  <span>พื้นที่การทำงานหลัก (ใช้เป็นค่าเริ่มต้นต้นทางหน้าขนย้าย) *</span>
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {MH_WORK_AREAS.map((area) => (
                    <button
                      key={area}
                      type="button"
                      onClick={() => setWorkArea(area)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                        workArea === area
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                      }`}
                    >
                      {area}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={workArea}
                    onChange={(e) => setWorkArea(e.target.value)}
                    placeholder="หรือพิมพ์พื้นที่อื่น..."
                    aria-label="พื้นที่การทำงานเพิ่มเติม"
                    className="min-w-[150px] flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
                  />
                </div>
              </div>

              {/* Optional Supervisor Notes */}
              <div>
                <label
                  htmlFor="duty-notes-input"
                  className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  หมายเหตุ / คำสั่งหน้างาน (ไม่บังคับ)
                </label>
                <input
                  id="duty-notes-input"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="เช่น โฟกัสงานโหลดเหล็กม้วนช่อง C หรือสลับพักเที่ยงชุดที่ 1"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
                />
              </div>
            </div>

            {/* Footer Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-[#1e3a5f]">
              <div className="text-xs text-slate-600 tabular-nums dark:text-slate-300">
                <span className="font-bold text-slate-900 dark:text-white">
                  {selectedEmployees.length} คน
                </span>
                <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span>{team}</span>
                <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span>{shift}</span>
                <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span>{workArea || "อาคาร A"}</span>
                {vehicleNumber && vehicleNumber !== "-" && (
                  <>
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono font-semibold">{vehicleNumber}</span>
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white whitespace-nowrap shadow-xs transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <Plus size={15} />
                <span>
                  {isSaving
                    ? "กำลังบันทึก..."
                    : editingId && selectedEmployees.length <= 1
                    ? "อัปเดตงานพนักงาน"
                    : selectedEmployees.length > 1
                    ? `บันทึกการมอบหมายงาน (${selectedEmployees.length} คน)`
                    : "บันทึกการมอบหมายงาน"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Section 3: Assigned Roster Table for Selected Date */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-[#1e3a5f]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              ตารางมอบหมายงานประจำวัน
            </h3>
            <span className="text-xs text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums dark:text-slate-300">
              {selectedDate}
            </span>
            <span className="text-xs text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className="text-xs font-semibold text-slate-600 tabular-nums dark:text-slate-300">
              {filteredDuties.length} รายการ
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Segmented Team Filter */}
            <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-[#0c162c]">
              <button
                type="button"
                onClick={() => setFilterTeam("All")}
                className={`rounded-md px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                  filterTeam === "All"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-[#162544] dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                ทุกทีม
              </button>
              {MH_TEAMS.map((tOpt) => (
                <button
                  key={`flt-${tOpt}`}
                  type="button"
                  onClick={() => setFilterTeam(tOpt)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                    filterTeam === tOpt
                      ? "bg-white text-slate-900 shadow-xs dark:bg-[#162544] dark:text-white"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
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
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
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
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="ค้นหาชื่อ, รถ, พื้นที่..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 rounded-lg border border-slate-300 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-900 focus:border-cyan-600 focus:bg-white focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
              />
            </div>
          </div>
        </div>

        <div className={`overflow-x-auto ${compact ? "max-h-72 overflow-y-auto" : ""}`}>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-600 dark:border-[#1e3a5f] dark:bg-[#0d1930] dark:text-slate-300">
                <th className="w-10 px-4 py-2.5 text-center">#</th>
                <th className="px-4 py-2.5 whitespace-nowrap">พนักงาน</th>
                <th className="px-4 py-2.5 whitespace-nowrap">ทีม</th>
                <th className="px-4 py-2.5 whitespace-nowrap">กะทำงาน</th>
                <th className="px-4 py-2.5 whitespace-nowrap">พื้นที่การทำงาน</th>
                <th className="px-4 py-2.5 whitespace-nowrap">รถที่ขับ</th>
                <th className="px-4 py-2.5 whitespace-nowrap">หมายเหตุ</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {filteredDuties.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    {dutiesForDate.length === 0
                      ? `ยังไม่มีรายการมอบหมายงานสำหรับวันที่ ${selectedDate} — เลือกพนักงานจากฟอร์มด้านบน หรือกดปุ่ม "คัดลอกวันก่อนหน้า"`
                      : "ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา"}
                  </td>
                </tr>
              ) : (
                filteredDuties.map((row, idx) => (
                  <tr
                    key={row.id}
                    className="transition hover:bg-slate-50/80 dark:hover:bg-[#162544]/60"
                  >
                    <td className="px-4 py-2.5 text-center font-mono text-[11px] text-slate-400 tabular-nums">
                      {idx + 1}
                    </td>

                    <td className="px-4 py-2.5">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {row.employeeName}
                      </div>
                      {row.employeeId && (
                        <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                          {row.employeeId}
                        </div>
                      )}
                    </td>

                    {/* Inline Segmented Control: Team */}
                    <td className="px-4 py-2.5">
                      <div className="inline-flex rounded-md bg-slate-100 p-0.5 dark:bg-[#0c162c]">
                        {MH_TEAMS.map((tOpt) => {
                          const active = row.team === tOpt;
                          return (
                            <button
                              key={`${row.id}-${tOpt}`}
                              type="button"
                              onClick={() => handleQuickPatchRow(row, { team: tOpt })}
                              className={`rounded px-2 py-1 text-[11px] font-bold whitespace-nowrap transition ${
                                active
                                  ? `${getTeamBadgeStyle(tOpt)} shadow-2xs`
                                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                              }`}
                            >
                              {tOpt}
                            </button>
                          );
                        })}
                      </div>
                    </td>

                    {/* Inline Segmented Control: Shift */}
                    <td className="px-4 py-2.5">
                      <div className="inline-flex rounded-md bg-slate-100 p-0.5 dark:bg-[#0c162c]">
                        {MH_SHIFTS.map((sOpt) => {
                          const active = row.shift === sOpt;
                          return (
                            <button
                              key={`${row.id}-${sOpt}`}
                              type="button"
                              onClick={() => handleQuickPatchRow(row, { shift: sOpt })}
                              className={`rounded px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition ${
                                active
                                  ? "bg-indigo-600 text-white shadow-2xs"
                                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                              }`}
                            >
                              {sOpt}
                            </button>
                          );
                        })}
                      </div>
                    </td>

                    {/* Work Area Quick Select */}
                    <td className="px-4 py-2.5">
                      <select
                        value={row.workArea}
                        onChange={(e) =>
                          handleQuickPatchRow(row, { workArea: e.target.value })
                        }
                        aria-label={`พื้นที่การทำงานของ ${row.employeeName}`}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
                      >
                        {!MH_WORK_AREAS.includes(row.workArea as (typeof MH_WORK_AREAS)[number]) && (
                          <option value={row.workArea}>{row.workArea}</option>
                        )}
                        {MH_WORK_AREAS.map((area) => (
                          <option key={area} value={area}>
                            {area}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Vehicle Quick Select */}
                    <td className="px-4 py-2.5">
                      <select
                        value={row.vehicleNumber}
                        onChange={(e) =>
                          handleQuickPatchRow(row, { vehicleNumber: e.target.value })
                        }
                        aria-label={`รถโฟล์คลิฟท์ของ ${row.employeeName}`}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs font-bold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
                      >
                        <option value="-">-</option>
                        {activeVehicles.map((v) => (
                          <option key={v.id} value={v.vehicleId}>
                            {v.vehicleId}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Notes */}
                    <td className="max-w-[180px] px-4 py-2.5">
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
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
                              { employeeId: row.employeeId, employeeName: row.employeeName },
                            ]);
                            setEmployeeInput("");
                            setWorkArea(row.workArea);
                            setVehicleNumber(row.vehicleNumber);
                            setShift(row.shift);
                            setTeam(row.team);
                            setNotes(row.notes || "");
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-cyan-500 hover:text-cyan-700 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-300"
                          title="โหลดเข้าฟอร์มเพื่อแก้ไข"
                          aria-label={`แก้ไขงานของ ${row.employeeName}`}
                        >
                          <Edit3 size={13} />
                        </button>

                        {confirmDeleteId === row.id ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteDuty(row.id)}
                            className="h-8 rounded-md bg-red-600 px-2.5 text-[11px] font-bold text-white hover:bg-red-700"
                          >
                            ยืนยันลบ
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(row.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:bg-[#162544] dark:text-red-400"
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
  );
}
