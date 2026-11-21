/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Calendar,
  History,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Employee,
  Vehicle,
  VehicleAssignment,
  WmsActivityLogRecord,
  WmsSectionId,
} from "../types/officer";
import { EmployeeManagement } from "./EmployeeManagement";
import { WMS_SECTIONS } from "../utils/sectionPermissions";

interface AdminWorkforcePortalProps {
  employees: Employee[];
  vehicles: Vehicle[];
  assignments: VehicleAssignment[];
  activityLogs: WmsActivityLogRecord[];
  onUpdateEmployees: (updated: Employee[]) => void;
  onUpdateAssignments: (updated: VehicleAssignment[]) => void;
  onNavigateToAssignment?: () => void;
  onNavigateToVehicles?: () => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
}

export function AdminWorkforcePortal({
  employees,
  vehicles,
  assignments,
  activityLogs,
  onUpdateEmployees,
  onUpdateAssignments,
  onNavigateToAssignment,
  onNavigateToVehicles,
  onLogTransaction,
}: AdminWorkforcePortalProps) {
  const [activeTab, setActiveTab] = useState<"workforce" | "audit_logs">("workforce");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sectionFilter, setSectionFilter] = useState<WmsSectionId | "all">("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [logPage, setLogPage] = useState<number>(1);
  const [logPageSize, setLogPageSize] = useState<number>(20);

  useEffect(() => {
    setLogPage(1);
  }, [searchQuery, sectionFilter, dateFilter, logPageSize]);

  const todayYmd = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }, []);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activityLogs.filter((log) => {
      if (sectionFilter !== "all" && log.sectionId !== sectionFilter) return false;
      if (dateFilter && log.dateYmd !== dateFilter) return false;
      if (!q) return true;
      return (
        log.employeeId.toLowerCase().includes(q) ||
        log.employeeName.toLowerCase().includes(q) ||
        log.reference.toLowerCase().includes(q) ||
        log.activity.toLowerCase().includes(q) ||
        log.module.toLowerCase().includes(q)
      );
    });
  }, [activityLogs, sectionFilter, dateFilter, searchQuery]);

  const totalLogItems = filteredLogs.length;
  const totalLogPages = Math.max(1, Math.ceil(totalLogItems / logPageSize));
  const currentLogPage = Math.min(logPage, totalLogPages);
  const logStartIdx = (currentLogPage - 1) * logPageSize;
  const paginatedLogs = useMemo(
    () => filteredLogs.slice(logStartIdx, logStartIdx + logPageSize),
    [filteredLogs, logStartIdx, logPageSize]
  );

  const auditStats = useMemo(() => {
    const todayLogs = activityLogs.filter((l) => l.dateYmd === todayYmd);
    const activeActorsToday = new Set(
      todayLogs
        .map((l) => l.employeeId)
        .filter((id) => id && id !== "SYSTEM")
    );
    const activeStaffTotal = employees.filter(
      (e) => e.employmentStatus === "Active"
    ).length;

    return {
      totalLogs: activityLogs.length,
      todayCount: todayLogs.length,
      activeActorsTodayCount: activeActorsToday.size,
      activeStaffTotal,
    };
  }, [activityLogs, employees, todayYmd]);

  return (
    <div className="space-y-4">
      {/* Top Portal Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div
          role="tablist"
          aria-label="Admin & Workforce Portal Tabs"
          className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 p-1 dark:bg-[#0b1329]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "workforce"}
            onClick={() => setActiveTab("workforce")}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-bold transition ${
              activeTab === "workforce"
                ? "bg-white text-sky-700 shadow-sm dark:bg-[#162749] dark:text-sky-300"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Users size={14} />
            <span>ทะเบียนพนักงาน & สิทธิ์ส่วนงาน ({employees.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "audit_logs"}
            onClick={() => setActiveTab("audit_logs")}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-bold transition ${
              activeTab === "audit_logs"
                ? "bg-white text-sky-700 shadow-sm dark:bg-[#162749] dark:text-sky-300"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <History size={14} />
            <span>ประวัติกิจกรรมแยกตามผู้ล็อกอิน ({activityLogs.length})</span>
          </button>
        </div>

        <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex dark:text-slate-400">
          <ShieldCheck size={14} className="text-emerald-500" />
          <span>ฐานข้อมูลกลางสำหรับ Login รายส่วนงาน</span>
        </div>
      </div>

      {activeTab === "workforce" ? (
        <EmployeeManagement
          employees={employees}
          vehicles={vehicles}
          assignments={assignments}
          onUpdateEmployees={onUpdateEmployees}
          onUpdateAssignments={onUpdateAssignments}
          onNavigateToAssignment={onNavigateToAssignment}
          onNavigateToVehicles={onNavigateToVehicles}
          onLogTransaction={onLogTransaction}
          hideSubTabs
        />
      ) : (
        <div className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                กิจกรรมที่บันทึกทั้งหมด
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {auditStats.totalLogs.toLocaleString("en-US")}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                กิจกรรมวันนี้ ({todayYmd})
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
                {auditStats.todayCount.toLocaleString("en-US")}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                พนักงานที่บันทึกงานวันนี้
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {auditStats.activeActorsTodayCount}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                พนักงาน Active ทั้งหมด
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {auditStats.activeStaffTotal}
              </div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="filterbar flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-[18px] sm:py-3 dark:border-[#1e3a5f] dark:bg-[#111e38]">
            <div className="relative min-w-[220px] flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหารหัสพนักงาน, ชื่อผู้บันทึก, รหัสอ้างอิง หรือกิจกรรม..."
                className="field w-full rounded-md border border-slate-300 bg-white font-normal text-slate-900 outline-none focus:border-sky-500 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
              />
            </div>

            <select
              value={sectionFilter}
              onChange={(e) =>
                setSectionFilter(e.target.value as WmsSectionId | "all")
              }
              className="field rounded-md border border-slate-300 bg-white font-normal text-slate-700 outline-none focus:border-sky-500 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200"
              style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
            >
              <option value="all">ทุกส่วนงาน (All Sections)</option>
              {WMS_SECTIONS.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.shortLabelTh}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <Calendar size={14} className="text-slate-400" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="field rounded-md border border-slate-300 bg-white font-normal text-slate-700 outline-none focus:border-sky-500 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200 dark:[color-scheme:dark]"
                style={{ height: 35, minHeight: 35, padding: "6px 8px", borderRadius: 6, fontSize: 12 }}
              />
            </div>

            {(searchQuery || sectionFilter !== "all" || dateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSectionFilter("all");
                  setDateFilter("");
                }}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-300"
              >
                <RotateCcw size={12} />
                <span>ล้างตัวกรอง</span>
              </button>
            )}
          </div>

          {/* Audit Log Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <Activity size={15} className="text-sky-500" />
                <span>ประวัติการบันทึกข้อมูลและอ้างอิงผู้ปฏิบัติงาน</span>
              </div>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {totalLogItems > 0
                  ? `แสดง ${logStartIdx + 1} - ${Math.min(
                      logStartIdx + logPageSize,
                      totalLogItems
                    )} จาก ${totalLogItems.toLocaleString("en-US")} รายการ`
                  : "แสดง 0 รายการ"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-300">
                    <th className="whitespace-nowrap px-3.5 py-2.5">วัน-เวลา</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5">ผู้บันทึก (ID · ชื่อ)</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5">ส่วนงาน</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5">โมดูล</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5">รหัสอ้างอิง</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5">รายละเอียดกิจกรรม</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                  {paginatedLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                      >
                        ไม่พบประวัติการบันทึกกิจกรรมที่ตรงกับตัวกรอง
                      </td>
                    </tr>
                  ) : (
                    paginatedLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-[#162749]/40"
                      >
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                          {log.timestamp}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-400">
                            {log.employeeId}
                          </span>{" "}
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {log.employeeName}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-medium text-slate-700 dark:text-slate-300">
                          {log.sectionLabel}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-slate-600 dark:text-slate-400">
                          {log.module}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {log.reference}
                        </td>
                        <td className="max-w-[360px] truncate px-3.5 py-2.5 text-slate-700 dark:text-slate-200">
                          {log.activity}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          <span
                            className={`font-semibold ${
                              log.status === "Attention" || log.status === "Warning"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer (NEXT PAGE เริ่มที่ 20 รายการต่อหน้า) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs dark:border-[#1e3a5f] dark:bg-[#0b1329]">
              <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
                <span className="font-mono font-bold tabular-nums">
                  {totalLogItems > 0
                    ? `แสดง ${logStartIdx + 1} - ${Math.min(
                        logStartIdx + logPageSize,
                        totalLogItems
                      )} จาก ${totalLogItems.toLocaleString("en-US")} รายการ`
                    : "0 รายการ"}
                </span>
                <select
                  value={logPageSize}
                  onChange={(e) => setLogPageSize(Number(e.target.value) || 20)}
                  className="cursor-pointer rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-extrabold text-slate-800 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-100"
                >
                  {[10, 20, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {`${size} รายการ/หน้า`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentLogPage <= 1}
                  onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                  className={`rounded-lg border px-3 py-1 text-xs font-extrabold transition-all ${
                    currentLogPage > 1
                      ? "cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-200 dark:hover:bg-[#1a2d52]"
                      : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-[#1e3a5f]/50 dark:bg-[#0c1930]"
                  }`}
                >
                  ก่อนหน้า
                </button>

                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono font-extrabold tabular-nums text-slate-700 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-200">
                  {`หน้า ${currentLogPage} / ${totalLogPages}`}
                </span>

                <button
                  type="button"
                  disabled={currentLogPage >= totalLogPages}
                  onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                  className={`rounded-lg border px-3 py-1 text-xs font-extrabold transition-all ${
                    currentLogPage < totalLogPages
                      ? "cursor-pointer border-sky-500 bg-sky-600 text-white shadow-xs hover:bg-sky-500"
                      : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-[#1e3a5f]/50 dark:bg-[#0c1930]"
                  }`}
                >
                  หน้าถัดไป (NEXT PAGE)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
