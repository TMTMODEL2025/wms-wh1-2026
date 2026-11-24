/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Check,
  FileSpreadsheet,
  Sun,
  Moon,
  RotateCcw,
} from "lucide-react";
import {
  subscribeToWmsEmployees,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import {
  SlitWorkforceAssignment,
  SlitWorkforceMachineGroup,
  SlitWorkforceShift,
  SlitWorkforceStatus,
  loadCachedSlitWorkforceAssignments,
  subscribeSlitWorkforceAssignments,
  saveSlitWorkforceAssignment,
  deleteSlitWorkforceAssignment,
} from "../services/slitWorkforceService";
import type { Employee } from "../types/officer";

interface SlitWorkforceManagementViewProps {
  isThai?: boolean;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
}

const MACHINE_GROUP_OPTIONS: {
  key: SlitWorkforceMachineGroup;
  labelTh: string;
  labelEn: string;
  machines: string[];
}[] = [
  {
    key: "TM",
    labelTh: "เครื่องผลิตท่อ (TM)",
    labelEn: "Pipe Mill (TM)",
    machines: [
      "TM01",
      "TM02",
      "TM03",
      "TM04",
      "TM05",
      "TM06",
      "TM07",
      "TM08",
      "TM09",
      "TM10",
      "TM11",
      "TM12",
      "TM13",
      "TM14",
    ],
  },
  {
    key: "CF",
    labelTh: "เครื่องตัวซี (CF)",
    labelEn: "C-Channel (CF)",
    machines: ["CF01", "CF02", "CF03", "CF04", "CF05"],
  },
  {
    key: "ML",
    labelTh: "เครื่องมินิ (ML)",
    labelEn: "Mini Line (ML)",
    machines: ["ML01", "ML02"],
  },
  {
    key: "ZF",
    labelTh: "ตัวซีมีขอบ (ZF)",
    labelEn: "Lip Channel (ZF)",
    machines: ["ZF01", "ZF02"],
  },
];

const MACHINE_TO_FAC_AREA: Record<string, string> = {
  TM01: "FAC G",
  TM02: "FAC G",
  TM03: "FAC G",
  TM04: "FAC G",
  TM05: "FAC P",
  TM06: "FAC G",
  TM07: "FAC D",
  TM08: "FAC D",
  TM09: "FAC D",
  TM10: "FAC D",
  TM11: "FAC F",
  TM12: "FAC F",
  TM14: "FAC A",
  CF01: "FAC G",
  CF02: "FAC G",
  CF03: "FAC G",
  CF04: "FAC G",
  CF05: "FAC G",
  ML01: "FAC 21",
  ML02: "FAC 21",
  ZF01: "FAC 21",
  ZF02: "FAC 21",
};

const AREA_BUILDING_OPTIONS = [
  "อาคาร H",
  "อาคาร F",
  "อาคาร E9",
  "อาคาร E10",
  "อาคาร I",
  "FAC A",
  "FAC D",
  "FAC F",
  "FAC G",
  "FAC P",
  "FAC 21",
  "โซนรับเข้า (SM01-SM04)",
  "โซนเตรียมเบิก / หน้าเครื่อง",
];

const DUTY_PRESET_OPTIONS_TH = [
  "รับเข้าเหล็กสลิต (Inbound)",
  "เตรียมเบิกวัตถุดิบ (Pick List / Outbound)",
  "จ่ายงานหน้าเครื่อง (Operator Receive)",
  "ย้าย Layout / จัดเก็บตะกร้า",
  "คืนคลัง / ตรวจสอบสต็อกคงคลัง",
  "ควบคุมเครน / Transfer Car",
  "ตรวจสอบอุปกรณ์และพื้นที่จัดเก็บ",
  "หัวหน้ากะ / ควบคุมการปฏิบัติงาน",
];

const DUTY_PRESET_OPTIONS_EN = [
  "Slit Steel Inbound Receiving",
  "Material Pick List & Outbound Staging",
  "Machine Operator Receiving",
  "Layout Relocation & Basket Storage",
  "Return to Warehouse & Stock Check",
  "Crane / Transfer Car Operation",
  "Equipment & Storage Inspection",
  "Shift Supervisor / Coordination",
];

function getLocalTodayYMD(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function getDefaultShift(): SlitWorkforceShift {
  const h = new Date().getHours();
  return h >= 8 && h < 20 ? "day" : "night";
}

export function SlitWorkforceManagementView({
  isThai = true,
  onLogTransaction,
}: SlitWorkforceManagementViewProps) {
  const [assignments, setAssignments] = useState<SlitWorkforceAssignment[]>(() =>
    loadCachedSlitWorkforceAssignments()
  );
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Filter states
  const [filterDate, setFilterDate] = useState<string>("");
  const [filterShift, setFilterShift] = useState<"all" | SlitWorkforceShift>("all");
  const [filterMachineGroup, setFilterMachineGroup] = useState<
    "all" | SlitWorkforceMachineGroup
  >("all");
  const [filterArea, setFilterArea] = useState<string>("all");
  const [searchKeyword, setSearchKeyword] = useState<string>("");

  // Modal / Form states
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formWorkingDate, setFormWorkingDate] = useState<string>(getLocalTodayYMD());
  const [formEmployeeMode, setFormEmployeeMode] = useState<"directory" | "custom">("directory");
  const [formSelectedEmpId, setFormSelectedEmpId] = useState<string>("");
  const [formCustomEmpName, setFormCustomEmpName] = useState<string>("");
  const [formCustomEmpId, setFormCustomEmpId] = useState<string>("");
  const [formShift, setFormShift] = useState<SlitWorkforceShift>(getDefaultShift());
  const [formAreaMode, setFormAreaMode] = useState<"preset" | "custom">("preset");
  const [formArea, setFormArea] = useState<string>(AREA_BUILDING_OPTIONS[0]);
  const [formCustomArea, setFormCustomArea] = useState<string>("");
  const [formMachineGroup, setFormMachineGroup] = useState<SlitWorkforceMachineGroup>("TM");
  const [formSelectedMachines, setFormSelectedMachines] = useState<string[]>([]);
  const [formDutyMode, setFormDutyMode] = useState<"preset" | "custom">("preset");
  const [formDuty, setFormDuty] = useState<string>(DUTY_PRESET_OPTIONS_TH[0]);
  const [formCustomDuty, setFormCustomDuty] = useState<string>("");
  const [formStatus, setFormStatus] = useState<SlitWorkforceStatus>("active");
  const [formNotes, setFormNotes] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const unsubWorkforce = subscribeSlitWorkforceAssignments(
      (items) => {
        setAssignments(items);
        setIsLoading(false);
      },
      () => {
        setIsLoading(false);
      }
    );
    const unsubEmployees = subscribeToWmsEmployees((empList) => {
      setEmployees(empList);
    });
    return () => {
      unsubWorkforce();
      unsubEmployees();
    };
  }, []);

  const activeEmployees = useMemo(() => {
    return employees
      .filter((e) => e.employmentStatus !== "Inactive")
      .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || ""));
  }, [employees]);

  const dutyOptions = isThai ? DUTY_PRESET_OPTIONS_TH : DUTY_PRESET_OPTIONS_EN;

  const availableFilterAreas = useMemo(() => {
    const set = new Set<string>(AREA_BUILDING_OPTIONS);
    assignments.forEach((a) => {
      if (a.area && a.area !== "-") set.add(a.area);
    });
    return Array.from(set);
  }, [assignments]);

  const filteredAssignments = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    return assignments.filter((item) => {
      if (filterDate && item.workingDate !== filterDate) return false;
      if (filterShift !== "all" && item.shift !== filterShift) return false;
      if (filterMachineGroup !== "all" && item.machineGroup !== filterMachineGroup) return false;
      if (filterArea !== "all" && item.area !== filterArea) return false;
      if (kw) {
        const haystack = [
          item.employeeName,
          item.employeeId || "",
          item.area,
          item.machineGroup,
          ...(item.machines || []),
          item.duty,
          item.notes || "",
          item.workingDate,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [assignments, filterDate, filterShift, filterMachineGroup, filterArea, searchKeyword]);

  const summaryStats = useMemo(() => {
    const dayCount = filteredAssignments.filter((a) => a.shift === "day").length;
    const nightCount = filteredAssignments.filter((a) => a.shift === "night").length;
    const activeCount = filteredAssignments.filter((a) => a.status === "active").length;
    const uniqueEmployees = new Set(
      filteredAssignments.map((a) => (a.employeeId || a.employeeName).trim().toUpperCase())
    ).size;
    const groupCounts: Record<SlitWorkforceMachineGroup, number> = {
      TM: 0,
      CF: 0,
      ML: 0,
      ZF: 0,
    };
    filteredAssignments.forEach((a) => {
      if (groupCounts[a.machineGroup] !== undefined) {
        groupCounts[a.machineGroup] += 1;
      }
    });
    return {
      total: filteredAssignments.length,
      dayCount,
      nightCount,
      activeCount,
      uniqueEmployees,
      groupCounts,
    };
  }, [filteredAssignments]);

  const activeGroupDef = useMemo(
    () =>
      MACHINE_GROUP_OPTIONS.find((g) => g.key === formMachineGroup) || MACHINE_GROUP_OPTIONS[0],
    [formMachineGroup]
  );

  const openCreateModal = () => {
    setEditingId(null);
    setFormError(null);
    setFormWorkingDate(filterDate || getLocalTodayYMD());
    if (activeEmployees.length > 0) {
      setFormEmployeeMode("directory");
      setFormSelectedEmpId(activeEmployees[0].employeeId);
      setFormCustomEmpName("");
      setFormCustomEmpId("");
    } else {
      setFormEmployeeMode("custom");
      setFormSelectedEmpId("");
      setFormCustomEmpName("");
      setFormCustomEmpId("");
    }
    setFormShift(filterShift !== "all" ? filterShift : getDefaultShift());
    setFormAreaMode("preset");
    setFormArea(filterArea !== "all" && AREA_BUILDING_OPTIONS.includes(filterArea) ? filterArea : AREA_BUILDING_OPTIONS[0]);
    setFormCustomArea("");
    setFormMachineGroup(filterMachineGroup !== "all" ? filterMachineGroup : "TM");
    setFormSelectedMachines([]);
    setFormDutyMode("preset");
    setFormDuty(dutyOptions[0]);
    setFormCustomDuty("");
    setFormStatus("active");
    setFormNotes("");
    setIsFormOpen(true);
  };

  const openEditModal = (item: SlitWorkforceAssignment) => {
    setEditingId(item.id);
    setFormError(null);
    setFormWorkingDate(item.workingDate || getLocalTodayYMD());

    const matchedEmp = activeEmployees.find(
      (e) =>
        (item.employeeId && e.employeeId.toUpperCase() === item.employeeId.toUpperCase()) ||
        e.employeeName.trim() === item.employeeName.trim()
    );
    if (matchedEmp) {
      setFormEmployeeMode("directory");
      setFormSelectedEmpId(matchedEmp.employeeId);
      setFormCustomEmpName("");
      setFormCustomEmpId("");
    } else {
      setFormEmployeeMode("custom");
      setFormSelectedEmpId("");
      setFormCustomEmpName(item.employeeName || "");
      setFormCustomEmpId(item.employeeId || "");
    }

    setFormShift(item.shift === "night" ? "night" : "day");

    if (AREA_BUILDING_OPTIONS.includes(item.area)) {
      setFormAreaMode("preset");
      setFormArea(item.area);
      setFormCustomArea("");
    } else {
      setFormAreaMode("custom");
      setFormArea(AREA_BUILDING_OPTIONS[0]);
      setFormCustomArea(item.area || "");
    }

    setFormMachineGroup(item.machineGroup || "TM");
    setFormSelectedMachines(Array.isArray(item.machines) ? item.machines : []);

    if (dutyOptions.includes(item.duty)) {
      setFormDutyMode("preset");
      setFormDuty(item.duty);
      setFormCustomDuty("");
    } else {
      setFormDutyMode("custom");
      setFormDuty(dutyOptions[0]);
      setFormCustomDuty(item.duty || "");
    }

    setFormStatus(item.status || "active");
    setFormNotes(item.notes || "");
    setIsFormOpen(true);
  };

  const handleMachineGroupChange = (group: SlitWorkforceMachineGroup) => {
    setFormMachineGroup(group);
    setFormSelectedMachines([]);
  };

  const toggleSpecificMachine = (machineCode: string) => {
    setFormSelectedMachines((prev) => {
      const exists = prev.includes(machineCode);
      const next = exists ? prev.filter((m) => m !== machineCode) : [...prev, machineCode];
      // Auto-suggest FAC building if picking the first machine and user hasn't customized area
      if (!exists && next.length === 1 && formAreaMode === "preset") {
        const suggestedFac = MACHINE_TO_FAC_AREA[machineCode];
        if (suggestedFac && AREA_BUILDING_OPTIONS.includes(suggestedFac)) {
          setFormArea(suggestedFac);
        }
      }
      return next;
    });
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let resolvedEmpName = "";
    let resolvedEmpId = "";
    if (formEmployeeMode === "directory") {
      const emp = activeEmployees.find((em) => em.employeeId === formSelectedEmpId);
      if (!emp) {
        setFormError(
          isThai ? "กรุณาเลือกพนักงานที่รับผิดชอบ" : "Please select an employee."
        );
        return;
      }
      resolvedEmpName = emp.employeeName.trim();
      resolvedEmpId = emp.employeeId.trim().toUpperCase();
    } else {
      resolvedEmpName = formCustomEmpName.trim();
      resolvedEmpId = formCustomEmpId.trim().toUpperCase();
      if (!resolvedEmpName) {
        setFormError(
          isThai ? "กรุณาระบุชื่อพนักงาน" : "Please enter the employee name."
        );
        return;
      }
    }

    const resolvedArea =
      formAreaMode === "preset" ? formArea.trim() : formCustomArea.trim();
    if (!resolvedArea) {
      setFormError(
        isThai ? "กรุณาระบุพื้นที่ / อาคาร" : "Please specify area / building."
      );
      return;
    }

    const resolvedDuty =
      formDutyMode === "preset" ? formDuty.trim() : formCustomDuty.trim();
    if (!resolvedDuty) {
      setFormError(
        isThai ? "กรุณาระบุหน้าที่รับผิดชอบ" : "Please specify duty / responsibility."
      );
      return;
    }

    const existing = editingId
      ? assignments.find((a) => a.id === editingId)
      : undefined;
    const recorder = getActiveRecorderDisplay();
    const nowIso = new Date().toISOString();

    const payload: SlitWorkforceAssignment = {
      id: editingId || `SLIT_WF_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`,
      workingDate: formWorkingDate || getLocalTodayYMD(),
      employeeId: resolvedEmpId || undefined,
      employeeName: resolvedEmpName,
      shift: formShift,
      area: resolvedArea,
      machineGroup: formMachineGroup,
      machines: formSelectedMachines,
      duty: resolvedDuty,
      status: formStatus,
      notes: formNotes.trim() || undefined,
      assignedBy: existing?.assignedBy || recorder.label,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    setIsSaving(true);
    try {
      await saveSlitWorkforceAssignment(payload);
      setIsFormOpen(false);
      setEditingId(null);

      const machineLabel =
        payload.machines && payload.machines.length > 0
          ? `${payload.machineGroup} (${payload.machines.join(", ")})`
          : payload.machineGroup;

      onLogTransaction?.(
        editingId
          ? `แก้ไขการมอบหมายกำลังพล: ${payload.employeeName} — ${machineLabel} (${payload.duty})`
          : `มอบหมายกำลังพล: ${payload.employeeName} — ${machineLabel} (${payload.duty})`,
        payload.workingDate,
        "Completed"
      );

      Swal.fire({
        icon: "success",
        title: editingId
          ? isThai
            ? "อัปเดตการมอบหมายสำเร็จ"
            : "Assignment Updated"
          : isThai
          ? "บันทึกการมอบหมายสำเร็จ"
          : "Assignment Saved",
        text: `${payload.employeeName} · ${payload.area} · ${machineLabel}`,
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (err) {
      console.error(err);
      setFormError(
        isThai
          ? "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง"
          : "Unable to save assignment. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCycleStatus = async (item: SlitWorkforceAssignment) => {
    const nextStatus: SlitWorkforceStatus =
      item.status === "active"
        ? "completed"
        : item.status === "completed"
        ? "standby"
        : "active";
    try {
      await saveSlitWorkforceAssignment({
        ...item,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteAssignment = async (item: SlitWorkforceAssignment) => {
    const result = await Swal.fire({
      title: isThai ? "ยืนยันลบรายการมอบหมาย?" : "Delete Assignment?",
      text: isThai
        ? `ต้องการลบการมอบหมายของ "${item.employeeName}" (${item.machineGroup} · ${item.area}) ใช่หรือไม่?`
        : `Remove assignment for "${item.employeeName}" (${item.machineGroup} · ${item.area})?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ลบรายการ" : "Delete",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    });

    if (!result.isConfirmed) return;

    try {
      await deleteSlitWorkforceAssignment(item.id);
      onLogTransaction?.(
        `ลบรายการมอบหมายกำลังพล: ${item.employeeName} (${item.machineGroup})`,
        item.workingDate,
        "Completed"
      );
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: "error",
        title: isThai ? "ลบไม่สำเร็จ" : "Delete Failed",
        text: isThai ? "กรุณาลองใหม่อีกครั้ง" : "Please try again.",
      });
    }
  };

  const handleResetFilters = () => {
    setFilterDate("");
    setFilterShift("all");
    setFilterMachineGroup("all");
    setFilterArea("all");
    setSearchKeyword("");
  };

  const handleExportExcel = () => {
    const rows = filteredAssignments.map((item, idx) => ({
      "ลำดับ": idx + 1,
      "วันที่ปฏิบัติงาน": item.workingDate,
      "รหัสพนักงาน": item.employeeId || "-",
      "ชื่อพนักงาน": item.employeeName,
      "กะทำงาน": item.shift === "day" ? "กะเช้า (08:00-20:00)" : "กะดึก (20:00-08:00)",
      "พื้นที่ / อาคาร": item.area,
      "กลุ่มเครื่องจักร": item.machineGroup,
      "เครื่องจักรที่รับผิดชอบ":
        item.machines && item.machines.length > 0
          ? item.machines.join(", ")
          : `ทุกเครื่อง (${item.machineGroup})`,
      "หน้าที่รับผิดชอบ": item.duty,
      "สถานะ":
        item.status === "active"
          ? "ปฏิบัติงาน"
          : item.status === "standby"
          ? "สแตนด์บาย"
          : "เสร็จสิ้น",
      "หมายเหตุ": item.notes || "-",
      "ผู้มอบหมาย": item.assignedBy || "-",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Slit_Workforce");
    XLSX.writeFile(wb, `Slit_Workforce_Assignments_${filterDate || getLocalTodayYMD()}.xlsx`);
  };

  const renderStatusText = (status: SlitWorkforceStatus) => {
    if (status === "active") {
      return (
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          {isThai ? "ปฏิบัติงาน" : "Active"}
        </span>
      );
    }
    if (status === "standby") {
      return (
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
          {isThai ? "สแตนด์บาย" : "Standby"}
        </span>
      );
    }
    return (
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
        {isThai ? "เสร็จสิ้น" : "Completed"}
      </span>
    );
  };

  const hasActiveFilters =
    Boolean(filterDate) ||
    filterShift !== "all" ||
    filterMachineGroup !== "all" ||
    filterArea !== "all" ||
    Boolean(searchKeyword.trim());

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Users size={20} className="text-sky-600 dark:text-sky-400 shrink-0" />
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight truncate">
              {isThai
                ? "จัดการกำลังพล — เหล็กสลิต / ฟิล์ม"
                : "Workforce Management — Slit / Film"}
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {isThai
              ? "มอบหมายพนักงาน กะทำงาน พื้นที่/อาคาร เครื่องจักร (TM, CF, ML, ZF) และหน้าที่รับผิดชอบ"
              : "Assign employees, shifts, areas/buildings, machine groups (TM, CF, ML, ZF), and duties"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filteredAssignments.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#132544] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#193055] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet size={15} />
            <span>{isThai ? "ส่งออก Excel" : "Export Excel"}</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus size={15} />
            <span>{isThai ? "มอบหมายหน้าที่" : "Assign Duty"}</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "รายการมอบหมายทั้งหมด" : "Total Assignments"}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.total}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {summaryStats.uniqueEmployees} {isThai ? "คน" : "staff"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "กะเช้า (08:00 - 20:00)" : "Day Shift (08:00 - 20:00)"}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
              {summaryStats.dayCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isThai ? "รายการ" : "entries"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "กะดึก (20:00 - 08:00)" : "Night Shift (20:00 - 08:00)"}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
              {summaryStats.nightCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isThai ? "รายการ" : "entries"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "กระจายตามกลุ่มเครื่องจักร" : "Machine Group Coverage"}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 flex-wrap">
            <span>
              TM <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.TM}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>
              CF <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.CF}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>
              ML <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.ML}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>
              ZF <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.ZF}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar + Table Container */}
      <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden">
        {/* Filter Controls */}
        <div className="p-4 border-b border-slate-200 dark:border-[#1e3a5f] space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder={
                  isThai
                    ? "ค้นหาชื่อพนักงาน, รหัส, เครื่องจักร, พื้นที่, หน้าที่..."
                    : "Search employee, ID, machine, area, duty..."
                }
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Date Filter */}
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              aria-label={isThai ? "กรองตามวันที่" : "Filter by date"}
              className="px-3 py-2 text-xs sm:text-sm font-mono tabular-nums rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />

            {/* Area Filter */}
            <select
              value={filterArea}
              onChange={(e) => setFilterArea(e.target.value)}
              aria-label={isThai ? "กรองตามพื้นที่/อาคาร" : "Filter by area"}
              className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <option value="all">
                {isThai ? "ทุกพื้นที่ / อาคาร" : "All Areas / Buildings"}
              </option>
              {availableFilterAreas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw size={13} />
                <span>{isThai ? "ล้างตัวกรอง" : "Reset"}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Shift Segmented Control */}
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0a1426] border border-slate-200 dark:border-[#1e3a5f]">
              {(
                [
                  { key: "all", label: isThai ? "ทุกกะ" : "All Shifts" },
                  { key: "day", label: isThai ? "กะเช้า" : "Day" },
                  { key: "night", label: isThai ? "กะดึก" : "Night" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterShift(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    filterShift === tab.key
                      ? "bg-white dark:bg-[#193055] text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Machine Group Segmented Control (TM, CF, ML, ZF) */}
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0a1426] border border-slate-200 dark:border-[#1e3a5f]">
              {(["all", "TM", "CF", "ML", "ZF"] as const).map((grp) => (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setFilterMachineGroup(grp)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold font-mono transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    filterMachineGroup === grp
                      ? "bg-sky-600 text-white"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {grp === "all" ? (isThai ? "ทุกเครื่อง" : "All") : grp}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0b162a] text-xs font-semibold text-slate-600 dark:text-slate-300">
                <th className="py-3 px-4 whitespace-nowrap w-12">#</th>
                <th className="py-3 px-4 whitespace-nowrap">
                  {isThai ? "วันที่" : "Date"}
                </th>
                <th className="py-3 px-4 whitespace-nowrap">
                  {isThai ? "พนักงาน" : "Employee"}
                </th>
                <th className="py-3 px-4 whitespace-nowrap">
                  {isThai ? "กะทำงาน" : "Shift"}
                </th>
                <th className="py-3 px-4 whitespace-nowrap">
                  {isThai ? "พื้นที่ / อาคาร" : "Area / Building"}
                </th>
                <th className="py-3 px-4 whitespace-nowrap">
                  {isThai ? "เครื่องจักร" : "Machine"}
                </th>
                <th className="py-3 px-4 whitespace-nowrap">
                  {isThai ? "หน้าที่รับผิดชอบ" : "Duty"}
                </th>
                <th className="py-3 px-4 whitespace-nowrap">
                  {isThai ? "สถานะ" : "Status"}
                </th>
                <th className="py-3 px-4 text-right whitespace-nowrap">
                  {isThai ? "จัดการ" : "Actions"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#192e50] text-sm">
              {isLoading && assignments.length === 0 ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={9} className="py-3.5 px-4">
                      <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 px-4 text-center">
                    <div className="max-w-sm mx-auto space-y-2">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {hasActiveFilters
                          ? isThai
                            ? "ไม่พบรายการมอบหมายที่ตรงกับตัวกรอง"
                            : "No assignments match the active filters"
                          : isThai
                          ? "ยังไม่มีรายการมอบหมายกำลังพล"
                          : "No workforce assignments yet"}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {isThai
                          ? "กดปุ่ม \"มอบหมายหน้าที่\" เพื่อกำหนดพนักงาน กะทำงาน พื้นที่ เครื่องจักร (TM, CF, ML, ZF) และหน้าที่รับผิดชอบ"
                          : "Click \"Assign Duty\" to add your first Slit/Film workforce responsibility."}
                      </p>
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={hasActiveFilters ? handleResetFilters : openCreateModal}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white transition-colors cursor-pointer"
                        >
                          {hasActiveFilters ? (
                            <>
                              <RotateCcw size={14} />
                              <span>{isThai ? "ล้างตัวกรอง" : "Clear Filters"}</span>
                            </>
                          ) : (
                            <>
                              <Plus size={14} />
                              <span>{isThai ? "มอบหมายหน้าที่รายการแรก" : "Add First Assignment"}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAssignments.map((item, idx) => {
                  const specificMachinesText =
                    item.machines && item.machines.length > 0
                      ? item.machines.join(", ")
                      : isThai
                      ? "ทั้งกลุ่ม"
                      : "All in group";

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/90 dark:hover:bg-[#132544]/70 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-400">
                        {idx + 1}
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {item.workingDate}
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white leading-snug">
                          {item.employeeName}
                        </div>
                        {item.employeeId && (
                          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {item.employeeId}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {item.shift === "day"
                            ? isThai
                              ? "กะเช้า"
                              : "Day Shift"
                            : isThai
                            ? "กะดึก"
                            : "Night Shift"}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {item.shift === "day" ? "08:00 - 20:00" : "20:00 - 08:00"}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {item.area}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-400">
                            {item.machineGroup}
                          </span>
                          <span className="text-slate-300 dark:text-slate-600">/</span>
                          <span className="font-mono text-slate-600 dark:text-slate-300">
                            {specificMachinesText}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-100 font-medium">
                          {item.duty}
                        </div>
                        {item.notes && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs truncate">
                            {item.notes}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleCycleStatus(item)}
                          title={isThai ? "คลิกเพื่อเปลี่ยนสถานะ" : "Click to toggle status"}
                          className="hover:underline cursor-pointer text-left"
                        >
                          {renderStatusText(item.status)}
                        </button>
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            title={isThai ? "แก้ไขรายการ" : "Edit"}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 dark:text-slate-400 dark:hover:text-sky-400 dark:hover:bg-sky-950/40 transition-colors cursor-pointer"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAssignment(item)}
                            title={isThai ? "ลบรายการ" : "Delete"}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-400 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          >
                            <Trash2 size={15} />
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
      </div>

      {/* Add / Edit Assignment Modal */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-[2px] flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slit-workforce-modal-title"
        >
          <div className="w-full max-w-2xl bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden my-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#1e3a5f]">
              <div>
                <h3
                  id="slit-workforce-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-white"
                >
                  {editingId
                    ? isThai
                      ? "แก้ไขการมอบหมายหน้าที่รับผิดชอบ"
                      : "Edit Workforce Assignment"
                    : isThai
                    ? "มอบหมายหน้าที่รับผิดชอบ — เหล็กสลิต / ฟิล์ม"
                    : "Assign Slit / Film Responsibility"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isThai
                    ? "ระบุพนักงาน กะทำงาน พื้นที่/อาคาร กลุ่มเครื่องจักร และหน้าที่"
                    : "Specify employee, shift, area/building, machine group, and duty"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#193055] transition-colors cursor-pointer"
                aria-label={isThai ? "ปิดหน้าต่าง" : "Close modal"}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAssignment} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-medium text-rose-700 dark:text-rose-300">
                  {formError}
                </div>
              )}

              {/* Row 1: Working Date + Shift */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "วันที่ปฏิบัติงาน" : "Working Date"}
                  </label>
                  <input
                    type="date"
                    required
                    value={formWorkingDate}
                    onChange={(e) => setFormWorkingDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "กะทำงาน *" : "Shift *"}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormShift("day")}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        formShift === "day"
                          ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-800 dark:text-amber-300"
                          : "border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      <Sun size={14} />
                      <span>{isThai ? "กะเช้า (08-20)" : "Day (08-20)"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormShift("night")}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        formShift === "night"
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-800 dark:text-indigo-300"
                          : "border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      <Moon size={14} />
                      <span>{isThai ? "กะดึก (20-08)" : "Night (20-08)"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Row 2: Employee */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {isThai ? "พนักงาน *" : "Employee *"}
                  </label>
                  {activeEmployees.length > 0 && (
                    <div className="inline-flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setFormEmployeeMode("directory")}
                        className={`cursor-pointer transition-colors ${
                          formEmployeeMode === "directory"
                            ? "font-semibold text-sky-600 dark:text-sky-400 underline"
                            : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                        }`}
                      >
                        {isThai ? "เลือกจากรายชื่อ" : "From Directory"}
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => setFormEmployeeMode("custom")}
                        className={`cursor-pointer transition-colors ${
                          formEmployeeMode === "custom"
                            ? "font-semibold text-sky-600 dark:text-sky-400 underline"
                            : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                        }`}
                      >
                        {isThai ? "ระบุชื่อเอง" : "Custom Name"}
                      </button>
                    </div>
                  )}
                </div>

                {formEmployeeMode === "directory" && activeEmployees.length > 0 ? (
                  <select
                    value={formSelectedEmpId}
                    onChange={(e) => setFormSelectedEmpId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  >
                    <option value="">
                      {isThai ? "-- เลือกพนักงาน --" : "-- Select Employee --"}
                    </option>
                    {activeEmployees.map((emp) => (
                      <option key={emp.employeeId} value={emp.employeeId}>
                        {emp.employeeName} ({emp.employeeId})
                        {emp.department ? ` — ${emp.department}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      value={formCustomEmpId}
                      onChange={(e) => setFormCustomEmpId(e.target.value)}
                      placeholder={isThai ? "รหัสพนักงาน (ถ้ามี)" : "Employee ID (optional)"}
                      maxLength={64}
                      className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                    <input
                      type="text"
                      required
                      value={formCustomEmpName}
                      onChange={(e) => setFormCustomEmpName(e.target.value)}
                      placeholder={isThai ? "ชื่อ-นามสกุลพนักงาน *" : "Employee Full Name *"}
                      maxLength={128}
                      className="sm:col-span-2 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                  </div>
                )}
              </div>

              {/* Row 3: Machine Group (TM, CF, ML, ZF) + Optional Specific Machines */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {isThai ? "เครื่องจักร (TM, CF, ML, ZF) *" : "Machine Group (TM, CF, ML, ZF) *"}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {MACHINE_GROUP_OPTIONS.map((grp) => (
                    <button
                      key={grp.key}
                      type="button"
                      onClick={() => handleMachineGroupChange(grp.key)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold font-mono border transition-colors cursor-pointer ${
                        formMachineGroup === grp.key
                          ? "bg-sky-600 border-sky-600 text-white"
                          : "border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-700 dark:text-slate-300 hover:border-sky-400"
                      }`}
                    >
                      {grp.key}
                    </button>
                  ))}
                </div>

                {/* Specific machines within selected group */}
                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                    <span>
                      {isThai
                        ? `ระบุเครื่องย่อยในกลุ่ม ${formMachineGroup} (ไม่เลือก = รับผิดชอบทั้งกลุ่ม)`
                        : `Optional specific ${formMachineGroup} machines (leave unselected for entire group)`}
                    </span>
                    {formSelectedMachines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setFormSelectedMachines([])}
                        className="text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        {isThai ? "ล้างการเลือก" : "Clear"}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeGroupDef.machines.map((mc) => {
                      const selected = formSelectedMachines.includes(mc);
                      return (
                        <button
                          key={mc}
                          type="button"
                          onClick={() => toggleSpecificMachine(mc)}
                          className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold border transition-colors cursor-pointer ${
                            selected
                              ? "bg-sky-100 dark:bg-sky-900/50 border-sky-500 text-sky-800 dark:text-sky-300"
                              : "border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-600 dark:text-slate-300 hover:border-slate-400"
                          }`}
                        >
                          {mc}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Row 4: Area / Building + Duty */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {isThai ? "พื้นที่ / อาคาร *" : "Area / Building *"}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormAreaMode((m) => (m === "preset" ? "custom" : "preset"))
                      }
                      className="text-xs text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      {formAreaMode === "preset"
                        ? isThai
                          ? "ระบุเอง"
                          : "Custom"
                        : isThai
                        ? "เลือกจากรายการ"
                        : "Preset"}
                    </button>
                  </div>
                  {formAreaMode === "preset" ? (
                    <select
                      value={formArea}
                      onChange={(e) => setFormArea(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    >
                      {AREA_BUILDING_OPTIONS.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={formCustomArea}
                      onChange={(e) => setFormCustomArea(e.target.value)}
                      placeholder={isThai ? "ระบุพื้นที่ / อาคาร" : "Enter area or building"}
                      maxLength={128}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {isThai ? "หน้าที่รับผิดชอบ *" : "Duty / Responsibility *"}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormDutyMode((m) => (m === "preset" ? "custom" : "preset"))
                      }
                      className="text-xs text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      {formDutyMode === "preset"
                        ? isThai
                          ? "ระบุเอง"
                          : "Custom"
                        : isThai
                        ? "เลือกจากรายการ"
                        : "Preset"}
                    </button>
                  </div>
                  {formDutyMode === "preset" ? (
                    <select
                      value={formDuty}
                      onChange={(e) => setFormDuty(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    >
                      {dutyOptions.map((duty) => (
                        <option key={duty} value={duty}>
                          {duty}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={formCustomDuty}
                      onChange={(e) => setFormCustomDuty(e.target.value)}
                      placeholder={isThai ? "ระบุหน้าที่รับผิดชอบ" : "Enter duty / responsibility"}
                      maxLength={128}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                  )}
                </div>
              </div>

              {/* Row 5: Status + Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "สถานะ" : "Status"}
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as SlitWorkforceStatus)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  >
                    <option value="active">{isThai ? "ปฏิบัติงาน" : "Active"}</option>
                    <option value="standby">{isThai ? "สแตนด์บาย" : "Standby"}</option>
                    <option value="completed">{isThai ? "เสร็จสิ้น" : "Completed"}</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "หมายเหตุ (ถ้ามี)" : "Notes (optional)"}
                  </label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder={
                      isThai ? "รายละเอียดเพิ่มเติม เช่น แทนกะ / ดูแลพิเศษ" : "Additional details..."
                    }
                    maxLength={500}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-[#1e3a5f]">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#193055] transition-colors cursor-pointer"
                >
                  {isThai ? "ยกเลิก" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white transition-colors cursor-pointer"
                >
                  <Check size={14} />
                  <span>
                    {isSaving
                      ? isThai
                        ? "กำลังบันทึก..."
                        : "Saving..."
                      : editingId
                      ? isThai
                        ? "บันทึกการแก้ไข"
                        : "Save Changes"
                      : isThai
                      ? "ยืนยันมอบหมาย"
                      : "Confirm Assignment"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
