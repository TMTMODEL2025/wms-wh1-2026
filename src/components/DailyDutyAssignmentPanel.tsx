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
  const [employeeName, setEmployeeName] = useState<string>("");
  const [employeeId, setEmployeeId] = useState<string>("");
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
        d.shift.toLowerCase().includes(q)
      );
    });
  }, [dutiesForDate, filterTeam, filterShift, searchQuery]);

  const handleSelectEmployeeFromList = (emp: Employee) => {
    setEmployeeName(emp.employeeName);
    setEmployeeId(emp.employeeId);
    // If already assigned today, load their current assignment for quick editing
    const existing = dutiesForDate.find(
      (d) =>
        d.employeeName.trim().toLowerCase() === emp.employeeName.trim().toLowerCase() ||
        (d.employeeId && d.employeeId === emp.employeeId)
    );
    if (existing) {
      setEditingId(existing.id);
      setWorkArea(existing.workArea);
      setVehicleNumber(existing.vehicleNumber);
      setShift(existing.shift);
      setTeam(existing.team);
      setNotes(existing.notes || "");
    } else {
      setEditingId(null);
    }
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = employeeName.trim();
    if (!cleanName) {
      setFeedback({ type: "error", text: "กรุณาระบุชื่อ-สกุลพนักงาน" });
      return;
    }

    setIsSaving(true);
    try {
      const { timestamp } = formatForkliftNowTimestamp();
      const matchedEmp = activeEmployees.find(
        (emp) => emp.employeeName.trim().toLowerCase() === cleanName.toLowerCase()
      );
      const resolvedEmpId = employeeId.trim() || matchedEmp?.employeeId || undefined;
      const docId =
        editingId || buildMhDailyDutyDocId(selectedDate, resolvedEmpId || cleanName);

      const existingRecord = allDuties.find((d) => d.id === docId);

      const record: MhDailyDutyRecord = {
        id: docId,
        workingDate: selectedDate,
        employeeId: resolvedEmpId,
        employeeName: cleanName,
        workArea: workArea.trim() || "อาคาร A",
        vehicleNumber: vehicleNumber.trim() || "-",
        shift,
        team,
        notes: notes.trim() || undefined,
        createdAt: existingRecord?.createdAt || timestamp,
        updatedAt: timestamp,
      };

      // Replace existing assignment for same employee on same date if ID changed
      const withoutDup = allDuties.filter(
        (d) =>
          d.id !== record.id &&
          !(
            d.workingDate === selectedDate &&
            d.employeeName.trim().toLowerCase() === cleanName.toLowerCase()
          )
      );
      setAllDuties([record, ...withoutDup]);

      await saveMhDailyDutyToCloud(record);

      setFeedback({
        type: "success",
        text: `บันทึกการมอบหมายงาน "${cleanName}" (${team} · ${shift} · ${record.workArea} · รถ ${record.vehicleNumber}) เรียบร้อยแล้ว`,
      });
      setEmployeeName("");
      setEmployeeId("");
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
    <div className="space-y-4">
      {/* Feedback Alert */}
      {feedback && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs font-semibold ${
            feedback.type === "error"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "error" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Bar: Date Selection + Copy Previous Day + Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-cyan-700 dark:text-cyan-400" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              วันที่มอบหมายงาน:
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#111e38] dark:text-white"
            />
            {selectedDate !== getTodayYmd() && (
              <button
                type="button"
                onClick={() => setSelectedDate(getTodayYmd())}
                className="rounded-md border border-cyan-600 px-2.5 py-1.5 text-xs font-bold text-cyan-700 hover:bg-cyan-50 dark:border-cyan-500 dark:text-cyan-300 dark:hover:bg-cyan-950/40"
              >
                วันนี้
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-bold text-slate-900 dark:text-white">
              มอบหมายแล้ว {dutiesForDate.length} คน
            </span>
            <span aria-hidden="true">·</span>
            <span>ทีม A: {teamCounts["ทีม A"] || 0}</span>
            <span aria-hidden="true">/</span>
            <span>ทีม B: {teamCounts["ทีม B"] || 0}</span>
            <span aria-hidden="true">/</span>
            <span>ทีม C: {teamCounts["ทีม C"] || 0}</span>
          </div>
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-900/60"
          >
            <Copy size={14} />
            คัดลอกตารางมอบหมายงานจากวันก่อนหน้า
            {previousCopySource ? ` (${previousCopySource.date})` : ""}
          </button>

          <button
            type="button"
            onClick={handleRefreshCloud}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
          >
            <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
            รีเฟรช
          </button>
        </div>
      </div>

      {/* Quick Assignment Form */}
      <form
        onSubmit={handleSaveAssignment}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-[#1e3a5f] dark:bg-[#111e38]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-[#1e3a5f]">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Users size={16} className="text-cyan-600 dark:text-cyan-400" />
            {editingId ? "แก้ไขการมอบหมายงานพนักงาน" : "กำหนดงานประจำวันให้พนักงาน"}
          </div>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setEmployeeName("");
                setEmployeeId("");
                setNotes("");
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
            >
              ยกเลิกการแก้ไข
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Employee Name + Quick Select from Unassigned */}
          <div className="lg:col-span-5">
            <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
              1. ชื่อ-สกุลพนักงาน *
            </label>
            <input
              type="text"
              list="duty-employee-options"
              value={employeeName}
              onChange={(e) => {
                setEmployeeName(e.target.value);
                const found = activeEmployees.find(
                  (emp) => emp.employeeName.trim().toLowerCase() === e.target.value.trim().toLowerCase()
                );
                setEmployeeId(found?.employeeId || "");
              }}
              placeholder="พิมพ์ชื่อ หรือเลือกพนักงานด้านล่าง..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
              required
            />
            <datalist id="duty-employee-options">
              {activeEmployees.map((emp) => (
                <option key={emp.employeeId} value={emp.employeeName} />
              ))}
            </datalist>

            {unassignedEmployees.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  พนักงานที่ยังไม่ได้รับมอบหมายวันนี้ ({unassignedEmployees.length} คน):
                </div>
                <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {unassignedEmployees.map((emp) => (
                    <button
                      key={emp.employeeId}
                      type="button"
                      onClick={() => handleSelectEmployeeFromList(emp)}
                      className={`rounded-md border px-2 py-1 text-xs font-semibold transition ${
                        employeeName.trim() === emp.employeeName
                          ? "border-cyan-600 bg-cyan-600 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-400 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                      }`}
                    >
                      {emp.employeeName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick Toggles: Team & Shift */}
          <div className="space-y-3 lg:col-span-4">
            {/* Team Quick Toggle */}
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">
                2. ทีม (Quick Toggle) *
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {MH_TEAMS.map((tOpt) => (
                  <button
                    key={tOpt}
                    type="button"
                    onClick={() => setTeam(tOpt)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
                      team === tOpt
                        ? "border-cyan-600 bg-cyan-600 text-white shadow-xs"
                        : "border-slate-300 bg-white text-slate-700 hover:border-cyan-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                    }`}
                  >
                    {tOpt}
                  </button>
                ))}
              </div>
            </div>

            {/* Shift Quick Toggle */}
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
                <Clock size={12} />
                3. กะทำงาน (Quick Toggle) *
              </label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {MH_SHIFTS.map((sOpt) => (
                  <button
                    key={sOpt}
                    type="button"
                    onClick={() => setShift(sOpt)}
                    className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${
                      shift === sOpt
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                        : "border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                    }`}
                  >
                    {sOpt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Vehicle Selector */}
          <div className="space-y-3 lg:col-span-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
                <Truck size={12} />
                4. รถที่ขับ (โฟล์คลิฟท์)
              </label>
              <select
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
              >
                <option value="-">-- ไม่ระบุรถ / ทั่วไป --</option>
                {activeVehicles.map((v) => (
                  <option key={v.id} value={v.vehicleId}>
                    {v.vehicleId} ({v.vehicleType})
                  </option>
                ))}
              </select>
            </div>

            {activeVehicles.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {activeVehicles.slice(0, 6).map((v) => (
                  <button
                    key={`qv-${v.id}`}
                    type="button"
                    onClick={() => setVehicleNumber(v.vehicleId)}
                    className={`rounded border px-2 py-1 font-mono text-[11px] font-bold transition ${
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
        </div>

        {/* Work Area Quick Toggles + Submit */}
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-[#1e3a5f] dark:bg-[#0d1930] lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1">
            <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
              <MapPin size={12} />
              5. พื้นที่การทำงานหลัก (ตั้งเป็นค่าเริ่มต้นของต้นทางในหน้าขนย้าย) *
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {MH_WORK_AREAS.map((area) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => setWorkArea(area)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    workArea === area
                      ? "border-emerald-600 bg-emerald-600 text-white shadow-xs"
                      : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
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
                className="min-w-[160px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 focus:border-emerald-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-60"
          >
            <Plus size={15} />
            {isSaving
              ? "กำลังบันทึก..."
              : editingId
              ? "อัปเดตงานพนักงาน"
              : "บันทึกการมอบหมายงาน"}
          </button>
        </div>
      </form>

      {/* Assigned Roster Table for Selected Date */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
          <div className="text-xs font-bold text-slate-900 dark:text-white">
            ตารางมอบหมายงานประจำวันที่ {selectedDate} ({filteredDuties.length} รายการ)
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="ค้นหาชื่อ, รถ, พื้นที่..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 rounded-lg border border-slate-300 bg-white py-1.5 pr-2.5 pl-8 text-xs text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-[#2c4a75] dark:bg-[#111e38] dark:text-white"
              />
            </div>

            <select
              value={filterTeam}
              onChange={(e) => setFilterTeam(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:border-[#2c4a75] dark:bg-[#111e38] dark:text-slate-100"
            >
              <option value="All">ทุกทีม</option>
              {MH_TEAMS.map((tOpt) => (
                <option key={tOpt} value={tOpt}>
                  {tOpt}
                </option>
              ))}
            </select>

            <select
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:border-[#2c4a75] dark:bg-[#111e38] dark:text-slate-100"
            >
              <option value="All">ทุกกะทำงาน</option>
              {MH_SHIFTS.map((sOpt) => (
                <option key={sOpt} value={sOpt}>
                  {sOpt}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`overflow-x-auto ${compact ? "max-h-72 overflow-y-auto" : ""}`}>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 text-[11px] font-bold text-slate-600 dark:border-[#1e3a5f] dark:bg-[#0d1930] dark:text-slate-300">
                <th className="px-4 py-2.5 whitespace-nowrap">พนักงาน</th>
                <th className="px-4 py-2.5 whitespace-nowrap">ทีม (กดสลับด่วนได้)</th>
                <th className="px-4 py-2.5 whitespace-nowrap">กะทำงาน (กดสลับด่วนได้)</th>
                <th className="px-4 py-2.5 whitespace-nowrap">พื้นที่การทำงาน</th>
                <th className="px-4 py-2.5 whitespace-nowrap">รถที่ขับ</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {filteredDuties.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    ยังไม่มีรายการมอบหมายงานสำหรับวันที่ {selectedDate} — ใช้ฟอร์มด้านบนหรือกดปุ่ม &quot;คัดลอกตารางมอบหมายงานจากวันก่อนหน้า&quot;
                  </td>
                </tr>
              ) : (
                filteredDuties.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50 dark:hover:bg-[#162544]/60"
                  >
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

                    {/* Inline Quick Toggle: Team */}
                    <td className="px-4 py-2.5">
                      <div className="inline-flex flex-wrap gap-1">
                        {MH_TEAMS.map((tOpt) => {
                          const active = row.team === tOpt;
                          return (
                            <button
                              key={`${row.id}-${tOpt}`}
                              type="button"
                              onClick={() => handleQuickPatchRow(row, { team: tOpt })}
                              className={`rounded border px-2 py-0.5 text-[11px] font-bold transition ${
                                active
                                  ? getTeamBadgeStyle(tOpt)
                                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-400 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-400"
                              }`}
                            >
                              {tOpt}
                            </button>
                          );
                        })}
                      </div>
                    </td>

                    {/* Inline Quick Toggle: Shift */}
                    <td className="px-4 py-2.5">
                      <div className="inline-flex flex-wrap gap-1">
                        {MH_SHIFTS.map((sOpt) => {
                          const active = row.shift === sOpt;
                          return (
                            <button
                              key={`${row.id}-${sOpt}`}
                              type="button"
                              onClick={() => handleQuickPatchRow(row, { shift: sOpt })}
                              className={`rounded border px-2 py-0.5 text-[11px] font-bold transition ${
                                active
                                  ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-600 dark:bg-indigo-950/70 dark:text-indigo-200"
                                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-400 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-400"
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
                        className="rounded border border-emerald-300 bg-emerald-50/70 px-2 py-1 text-xs font-bold text-emerald-800 focus:outline-none dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
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
                        className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs font-bold text-slate-900 focus:outline-none dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-white"
                      >
                        <option value="-">-</option>
                        {activeVehicles.map((v) => (
                          <option key={v.id} value={v.vehicleId}>
                            {v.vehicleId}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(row.id);
                            setEmployeeName(row.employeeName);
                            setEmployeeId(row.employeeId || "");
                            setWorkArea(row.workArea);
                            setVehicleNumber(row.vehicleNumber);
                            setShift(row.shift);
                            setTeam(row.team);
                            setNotes(row.notes || "");
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#162544] dark:text-slate-200"
                          title="โหลดเข้าฟอร์มเพื่อแก้ไข"
                        >
                          <Edit3 size={11} />
                        </button>

                        {confirmDeleteId === row.id ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteDuty(row.id)}
                            className="rounded bg-red-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-700"
                          >
                            ยืนยันลบ
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(row.id)}
                            className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-[#162544] dark:text-red-400"
                            title="ลบการมอบหมายงาน"
                          >
                            <Trash2 size={11} />
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
