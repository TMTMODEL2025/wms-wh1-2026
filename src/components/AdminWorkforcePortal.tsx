/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { CalendarClock, ShieldCheck, Users } from "lucide-react";
import {
  Employee,
  Vehicle,
  VehicleAssignment,
  WmsActivityLogRecord,
} from "../types/officer";
import { EmployeeManagement } from "./EmployeeManagement";
import { WorkforceShiftScheduleView } from "./WorkforceShiftScheduleView";

export type AdminWorkforceTab = "workforce" | "shift_schedule";

interface AdminWorkforcePortalProps {
  employees: Employee[];
  vehicles: Vehicle[];
  assignments: VehicleAssignment[];
  activityLogs?: WmsActivityLogRecord[];
  onUpdateEmployees: (updated: Employee[]) => void;
  onUpdateAssignments: (updated: VehicleAssignment[]) => void;
  onNavigateToAssignment?: () => void;
  onNavigateToVehicles?: () => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
  activeTab?: AdminWorkforceTab;
  onTabChange?: (tab: AdminWorkforceTab) => void;
}

export function AdminWorkforcePortal({
  employees,
  vehicles,
  assignments,
  onUpdateEmployees,
  onUpdateAssignments,
  onNavigateToAssignment,
  onNavigateToVehicles,
  onLogTransaction,
  activeTab: controlledTab,
  onTabChange,
}: AdminWorkforcePortalProps) {
  const [internalTab, setInternalTab] = useState<AdminWorkforceTab>("workforce");
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: AdminWorkforceTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

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
            aria-selected={activeTab === "shift_schedule"}
            onClick={() => setActiveTab("shift_schedule")}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-bold transition ${
              activeTab === "shift_schedule"
                ? "bg-white text-sky-700 shadow-sm dark:bg-[#162749] dark:text-sky-300"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <CalendarClock size={14} />
            <span>จัดตารางกะทำงาน</span>
          </button>
        </div>

        <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex dark:text-slate-400">
          <ShieldCheck size={14} className="text-emerald-500" />
          <span>ฐานข้อมูลกลางสำหรับ Login รายส่วนงาน</span>
        </div>
      </div>

      {activeTab === "shift_schedule" ? (
        <WorkforceShiftScheduleView
          employees={employees}
          onUpdateEmployees={onUpdateEmployees}
          onLogTransaction={onLogTransaction}
        />
      ) : (
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
      )}
    </div>
  );
}
