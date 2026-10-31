/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import Swal from "sweetalert2";
import {
  Wrench,
  ShieldCheck,
  Plus,
  Search,
  Edit2,
  Trash2,
  ClipboardCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Calendar,
  User,
  MapPin,
  FileSpreadsheet,
  RotateCcw,
  Info,
  Check,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import * as XLSX from "xlsx";

export type EquipmentStatus =
  | "ready"
  | "repair_needed"
  | "in_maintenance"
  | "out_of_service";

export interface EquipmentItem {
  id: string;
  name: string; // ชื่ออุปกรณ์ (e.g. เครนยกคอยล์)
  code: string; // หมายเลข (e.g. CRN-A01)
  area: string; // พื้นที่ตรวจเช็ค (e.g. อาคาร A)
  quantity: number; // จำนวน
  status: EquipmentStatus; // สถานะ (พร้อมใช้งาน, ชำรุด/รอซ่อม, ส่งซ่อมบำรุง, งดใช้งาน)
  lastInspector?: string; // ผู้ตรวจสอบ
  lastInspectionDate?: string; // วันที่ตรวจสอบ (e.g. 2026-10-27 09:30)
  lastShift?: "day" | "night"; // กะการทำงาน
  notes?: string; // หมายเหตุ
  createdAt: string;
}

export interface InspectionLog {
  id: string;
  equipmentId: string;
  equipmentName: string;
  equipmentCode: string;
  area: string;
  inspectionDate: string; // YYYY-MM-DD
  shift: "day" | "night"; // กะเช้า / กะดึก
  status: EquipmentStatus;
  inspector: string;
  remarks?: string;
  timestamp: string;
}

const STORAGE_KEY_EQUIPMENT_LIST = "wms_equipment_master_list";
const STORAGE_KEY_INSPECTION_LOGS = "wms_equipment_inspection_logs";

export function EquipmentInspectionView({ isThai = true }: { isThai?: boolean }) {
  // Master Equipment List & Logs loaded from localStorage
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_EQUIPMENT_LIST);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load equipment list from localStorage", e);
    }
    return []; // Start empty as requested
  });

  const [inspectionLogs, setInspectionLogs] = useState<InspectionLog[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INSPECTION_LOGS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load inspection logs from localStorage", e);
    }
    return [];
  });

  // Save to localStorage on state changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_EQUIPMENT_LIST, JSON.stringify(equipmentList));
    } catch (e) {
      console.error("Failed to save equipment list to localStorage", e);
    }
  }, [equipmentList]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INSPECTION_LOGS, JSON.stringify(inspectionLogs));
    } catch (e) {
      console.error("Failed to save inspection logs to localStorage", e);
    }
  }, [inspectionLogs]);

  // Filter & Search Controls
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>("all");
  const [isAreaDropdownOpen, setIsAreaDropdownOpen] = useState<boolean>(false);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<
    "all" | EquipmentStatus
  >("all");

  // Modal States
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState<boolean>(false);
  const [editingEquipment, setEditingEquipment] = useState<EquipmentItem | null>(null);

  // Equipment Form Inputs
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    area: "อาคาร A",
    quantity: 1,
    status: "ready" as EquipmentStatus,
    notes: "",
  });

  // Daily Inspection Check Modal State
  const [isCheckModalOpen, setIsCheckModalOpen] = useState<boolean>(false);
  const [checkingEquipment, setCheckingEquipment] = useState<EquipmentItem | null>(null);
  const [checkFormData, setCheckFormData] = useState({
    inspectionDate: new Date().toISOString().slice(0, 10),
    shift: "day" as "day" | "night",
    status: "ready" as EquipmentStatus,
    inspector: "",
    remarks: "",
  });

  // Unique Area list derived from equipment items
  const areaOptions = useMemo(() => {
    const defaultAreas = ["อาคาร A", "อาคาร B", "สายการผลิต SM01-SM04", "คลังสินค้าเหล็กสลิต"];
    const itemAreas = equipmentList.map((item) => item.area).filter(Boolean);
    return Array.from(new Set([...defaultAreas, ...itemAreas]));
  }, [equipmentList]);

  // Filtered Equipment List
  const filteredEquipment = useMemo(() => {
    return equipmentList.filter((item) => {
      // 1. Search keyword
      if (searchKeyword.trim()) {
        const q = searchKeyword.toLowerCase().trim();
        const matchName = item.name.toLowerCase().includes(q);
        const matchCode = item.code.toLowerCase().includes(q);
        const matchArea = item.area.toLowerCase().includes(q);
        const matchInspector = (item.lastInspector || "").toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchArea && !matchInspector) return false;
      }

      // 2. Area filter
      if (selectedAreaFilter !== "all" && item.area !== selectedAreaFilter) {
        return false;
      }

      // 3. Status filter
      if (selectedStatusFilter !== "all" && item.status !== selectedStatusFilter) {
        return false;
      }

      return true;
    });
  }, [equipmentList, searchKeyword, selectedAreaFilter, selectedStatusFilter]);

  // Status Badge Helper
  const getStatusBadge = (status: EquipmentStatus) => {
    switch (status) {
      case "ready":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
            <span>พร้อมใช้งาน</span>
          </span>
        );
      case "repair_needed":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400" />
            <span>ชำรุด/รอซ่อม</span>
          </span>
        );
      case "in_maintenance":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            <Clock size={13} className="text-blue-600 dark:text-blue-400" />
            <span>ส่งซ่อมบำรุง</span>
          </span>
        );
      case "out_of_service":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            <XCircle size={13} className="text-rose-600 dark:text-rose-400" />
            <span>งดใช้งาน</span>
          </span>
        );
      default:
        return null;
    }
  };

  // Open Add / Edit Modal
  const handleOpenEquipmentModal = (item?: EquipmentItem) => {
    if (item) {
      setEditingEquipment(item);
      setFormData({
        name: item.name,
        code: item.code,
        area: item.area,
        quantity: item.quantity,
        status: item.status,
        notes: item.notes || "",
      });
    } else {
      setEditingEquipment(null);
      setFormData({
        name: "",
        code: "",
        area: "อาคาร A",
        quantity: 1,
        status: "ready",
        notes: "",
      });
    }
    setIsEquipmentModalOpen(true);
  };

  // Submit Add / Edit Form
  const handleSaveEquipment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) {
      Swal.fire({
        icon: "warning",
        title: "กรุณากรอกข้อมูลให้ครบถ้วน",
        text: "ชื่ออุปกรณ์และหมายเลขรหัสอุปกรณ์จำเป็นต้องระบุ",
        confirmButtonColor: "#087eaf",
      });
      return;
    }

    if (editingEquipment) {
      // Update
      setEquipmentList((prev) =>
        prev.map((item) =>
          item.id === editingEquipment.id
            ? {
                ...item,
                name: formData.name.trim(),
                code: formData.code.trim().toUpperCase(),
                area: formData.area,
                quantity: Number(formData.quantity) || 1,
                status: formData.status,
                notes: formData.notes.trim(),
              }
            : item
        )
      );
      Swal.fire({
        icon: "success",
        title: "แก้ไขข้อมูลอุปกรณ์เรียบร้อยแล้ว",
        timer: 1500,
        showConfirmButton: false,
      });
    } else {
      // Add
      const newItem: EquipmentItem = {
        id: `EQ-${Date.now()}`,
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        area: formData.area,
        quantity: Number(formData.quantity) || 1,
        status: formData.status,
        notes: formData.notes.trim(),
        createdAt: new Date().toISOString(),
      };
      setEquipmentList((prev) => [newItem, ...prev]);
      Swal.fire({
        icon: "success",
        title: "เพิ่มรายการอุปกรณ์ใหม่เรียบร้อยแล้ว",
        timer: 1500,
        showConfirmButton: false,
      });
    }

    setIsEquipmentModalOpen(false);
  };

  // Delete Equipment Item
  const handleDeleteEquipment = (item: EquipmentItem) => {
    Swal.fire({
      title: "ยืนยันการลบรายการอุปกรณ์?",
      html: `
        <div style="text-align: left; font-size: 13px; line-height: 1.6;">
          <p style="margin-bottom: 8px;">คุณต้องการลบรายการอุปกรณ์นี้ออกจากระบบหรือไม่?</p>
          <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 8px; font-family: 'Noto Sans Thai', sans-serif; font-variant-numeric: tabular-nums;">
            <div><strong>ชื่ออุปกรณ์:</strong> ${item.name}</div>
            <div><strong>หมายเลข:</strong> ${item.code}</div>
            <div><strong>พื้นที่:</strong> ${item.area}</div>
          </div>
        </div>
      `,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: "ยืนยันลบข้อมูล",
      cancelButtonText: "ยกเลิก",
    }).then((result) => {
      if (result.isConfirmed) {
        setEquipmentList((prev) => prev.filter((i) => i.id !== item.id));
        Swal.fire({
          icon: "success",
          title: "ลบรายการอุปกรณ์เรียบร้อยแล้ว",
          timer: 1500,
          showConfirmButton: false,
        });
      }
    });
  };

  // Open Shift Check Modal
  const handleOpenCheckModal = (item: EquipmentItem) => {
    setCheckingEquipment(item);

    // Auto calculate shift by current hour (08:00 - 20:00 = day shift, else night shift)
    const hour = new Date().getHours();
    const currentShift = hour >= 8 && hour < 20 ? "day" : "night";

    setCheckFormData({
      inspectionDate: new Date().toISOString().slice(0, 10),
      shift: currentShift,
      status: item.status,
      inspector: item.lastInspector || "",
      remarks: "",
    });
    setIsCheckModalOpen(true);
  };

  // Save Shift Check Inspection
  const handleSaveCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkingEquipment) return;

    if (!checkFormData.inspector.trim()) {
      Swal.fire({
        icon: "warning",
        title: "กรุณาระบุชื่อผู้ตรวจสอบ",
        confirmButtonColor: "#087eaf",
      });
      return;
    }

    const timestampStr = `${checkFormData.inspectionDate} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

    // Create log entry
    const newLog: InspectionLog = {
      id: `LOG-${Date.now()}`,
      equipmentId: checkingEquipment.id,
      equipmentName: checkingEquipment.name,
      equipmentCode: checkingEquipment.code,
      area: checkingEquipment.area,
      inspectionDate: checkFormData.inspectionDate,
      shift: checkFormData.shift,
      status: checkFormData.status,
      inspector: checkFormData.inspector.trim(),
      remarks: checkFormData.remarks.trim(),
      timestamp: timestampStr,
    };

    setInspectionLogs((prev) => [newLog, ...prev]);

    // Update equipment item's status, lastInspector, and lastInspectionDate
    setEquipmentList((prev) =>
      prev.map((item) =>
        item.id === checkingEquipment.id
          ? {
              ...item,
              status: checkFormData.status,
              lastInspector: checkFormData.inspector.trim(),
              lastInspectionDate: timestampStr,
              lastShift: checkFormData.shift,
            }
          : item
      )
    );

    setIsCheckModalOpen(false);

    Swal.fire({
      icon: "success",
      title: "บันทึกผลการตรวจเช็คสภาพอุปกรณ์สำเร็จ",
      text: `อุปกรณ์: ${checkingEquipment.name} (${checkingEquipment.code}) - สถานะ: ${
        checkFormData.status === "ready"
          ? "พร้อมใช้งาน"
          : checkFormData.status === "repair_needed"
          ? "ชำรุด/รอซ่อม"
          : checkFormData.status === "in_maintenance"
          ? "ส่งซ่อมบำรุง"
          : "งดใช้งาน"
      }`,
      confirmButtonColor: "#087eaf",
    });
  };

  // Export Equipment List to Excel
  const handleExportExcel = () => {
    if (equipmentList.length === 0) {
      Swal.fire({
        icon: "info",
        title: "ไม่มีข้อมูลสำหรับส่งออก",
        confirmButtonColor: "#087eaf",
      });
      return;
    }

    const exportRows = filteredEquipment.map((item, idx) => ({
      ลำดับ: idx + 1,
      ชื่ออุปกรณ์: item.name,
      หมายเลขรหัส: item.code,
      พื้นที่ตรวจเช็ค: item.area,
      จำนวน: item.quantity,
      สถานะการใช้งาน:
        item.status === "ready"
          ? "พร้อมใช้งาน"
          : item.status === "repair_needed"
          ? "ชำรุด/รอซ่อม"
          : item.status === "in_maintenance"
          ? "ส่งซ่อมบำรุง"
          : "งดใช้งาน",
      ผู้ตรวจสอบล่าสุด: item.lastInspector || "-",
      วันที่ตรวจสอบล่าสุด: item.lastInspectionDate || "-",
      กะการทำงาน: item.lastShift === "day" ? "กะเช้า" : item.lastShift === "night" ? "กะดึก" : "-",
      หมายเหตุ: item.notes || "-",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Equipment_Inspection");
    XLSX.writeFile(
      workbook,
      `Equipment_Inspection_Report_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  // KPI Metrics calculation
  const metrics = useMemo(() => {
    const total = equipmentList.length;
    const ready = equipmentList.filter((i) => i.status === "ready").length;
    const repair = equipmentList.filter((i) => i.status === "repair_needed").length;
    const maintenance = equipmentList.filter((i) => i.status === "in_maintenance").length;
    const outOfService = equipmentList.filter((i) => i.status === "out_of_service").length;
    return { total, ready, repair, maintenance, outOfService };
  }, [equipmentList]);

  return (
    <div className="space-y-2.5 sm:space-y-4 animate-fade-in font-['Noto_Sans_Thai']">
      {/* Top Header & KPI Summary Bar */}
      <div className="p-2.5 sm:p-4 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-xs space-y-2 sm:space-y-3">
        <div className="flex flex-row items-center justify-between gap-2 sm:gap-3 pb-2 sm:pb-3 border-b border-slate-100 dark:border-[#1e3a5f]">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="p-1.5 sm:p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
              <ShieldCheck size={16} className="sm:w-[22px] sm:h-[22px]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">
                <span className="sm:hidden">ระบบตรวจสอบอุปกรณ์การทำงาน</span>
                <span className="hidden sm:inline">
                  ระบบตรวจสอบอุปกรณ์การทำงาน (Equipment Inspection)
                </span>
              </h2>
              <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                ตรวจเช็คสภาพความพร้อมของเครน, สลิง, โซ่ยก, ตะขอ และอุปกรณ์ความปลอดภัยก่อนเริ่มงาน
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportExcel}
              className="hidden sm:flex px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FileSpreadsheet size={15} className="text-emerald-600 dark:text-emerald-400" />
              <span>ส่งออก Excel</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenEquipmentModal()}
              className="px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-[10.5px] sm:text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer active:scale-95 whitespace-nowrap"
            >
              <Plus size={13} className="sm:w-4 sm:h-4" />
              <span className="sm:hidden">เพิ่มอุปกรณ์</span>
              <span className="hidden sm:inline">+ เพิ่มรายการอุปกรณ์</span>
            </button>
          </div>
        </div>

        {/* KPI Status Summary Tiles */}
        <div className="grid grid-cols-5 gap-1 sm:gap-2 pt-0.5 sm:pt-1">
          <div className="px-1 py-1.5 sm:p-2.5 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-center sm:text-left">
            <div className="text-[8.5px] sm:text-[11px] font-semibold tracking-tighter sm:tracking-normal text-slate-500 dark:text-slate-400 truncate">
              <span className="sm:hidden">ทั้งหมด</span>
              <span className="hidden sm:inline">อุปกรณ์ทั้งหมด</span>
            </div>
            <div className="text-xs sm:text-lg font-black font-mono text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
              {metrics.total.toLocaleString()}{" "}
              <span className="hidden sm:inline text-xs font-normal text-slate-500">รายการ</span>
            </div>
          </div>

          <div className="px-1 py-1.5 sm:p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center sm:text-left">
            <div className="text-[8.5px] sm:text-[11px] font-semibold tracking-tighter sm:tracking-normal text-emerald-800 dark:text-emerald-300 truncate">
              พร้อมใช้งาน
            </div>
            <div className="text-xs sm:text-lg font-black font-mono text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
              {metrics.ready.toLocaleString()}{" "}
              <span className="hidden sm:inline text-xs font-normal opacity-80">รายการ</span>
            </div>
          </div>

          <div className="px-1 py-1.5 sm:p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center sm:text-left">
            <div className="text-[8.5px] sm:text-[11px] font-semibold tracking-tighter sm:tracking-normal text-amber-800 dark:text-amber-300 truncate">
              ชำรุด/รอซ่อม
            </div>
            <div className="text-xs sm:text-lg font-black font-mono text-amber-700 dark:text-amber-400 mt-0.5 tabular-nums">
              {metrics.repair.toLocaleString()}{" "}
              <span className="hidden sm:inline text-xs font-normal opacity-80">รายการ</span>
            </div>
          </div>

          <div className="px-1 py-1.5 sm:p-2.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-center sm:text-left">
            <div className="text-[8.5px] sm:text-[11px] font-semibold tracking-tighter sm:tracking-normal text-blue-800 dark:text-blue-300 truncate">
              ส่งซ่อมบำรุง
            </div>
            <div className="text-xs sm:text-lg font-black font-mono text-blue-700 dark:text-blue-400 mt-0.5 tabular-nums">
              {metrics.maintenance.toLocaleString()}{" "}
              <span className="hidden sm:inline text-xs font-normal opacity-80">รายการ</span>
            </div>
          </div>

          <div className="px-1 py-1.5 sm:p-2.5 rounded-lg bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-center sm:text-left">
            <div className="text-[8.5px] sm:text-[11px] font-semibold tracking-tighter sm:tracking-normal text-rose-800 dark:text-rose-300 truncate">
              งดใช้งาน
            </div>
            <div className="text-xs sm:text-lg font-black font-mono text-rose-700 dark:text-rose-400 mt-0.5 tabular-nums">
              {metrics.outOfService.toLocaleString()}{" "}
              <span className="hidden sm:inline text-xs font-normal opacity-80">รายการ</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-2 sm:p-3 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-xs space-y-1.5 sm:space-y-2.5">
        <div className="flex flex-row items-center justify-between gap-1.5 sm:gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-0">
            <Search
              size={13}
              className="absolute left-2.5 sm:left-3 top-2 sm:top-2.5 text-slate-400 dark:text-slate-500 sm:w-4 sm:h-4"
            />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="ค้นหาอุปกรณ์, รหัส, พื้นที่..."
              className="w-full pl-7 sm:pl-9 pr-6 sm:pr-8 py-1 sm:py-2 text-[11px] sm:text-xs rounded-md sm:rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 sm:focus:ring-2 focus:ring-emerald-500"
            />
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword("")}
                className="absolute right-2 sm:right-2.5 top-2 sm:top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X size={13} className="sm:w-3.5 sm:h-3.5" />
              </button>
            )}
          </div>

          {/* Area Dropdown Filter */}
          <div className="relative flex items-center gap-1 sm:gap-2 shrink-0">
            <span className="text-[10.5px] sm:text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1 shrink-0">
              <MapPin size={12} className="text-emerald-500 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">พื้นที่:</span>
            </span>

            {/* Mobile Custom Right-Aligned Dropdown (Prevents right-edge screen overflow) */}
            <div className="relative sm:hidden">
              <button
                type="button"
                onClick={() => setIsAreaDropdownOpen((prev) => !prev)}
                className="py-1 px-2 text-[10.5px] rounded-md bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 font-semibold flex items-center justify-between gap-1.5 max-w-[130px] focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
              >
                <span className="truncate">
                  {selectedAreaFilter === "all"
                    ? `ทุกพื้นที่ (${equipmentList.length})`
                    : `${selectedAreaFilter} (${
                        equipmentList.filter((i) => i.area === selectedAreaFilter).length
                      })`}
                </span>
                <ChevronDown
                  size={12}
                  className={`shrink-0 text-slate-400 transition-transform ${
                    isAreaDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isAreaDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setIsAreaDropdownOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-40 w-48 max-w-[calc(100vw-2rem)] rounded-lg bg-white dark:bg-[#0d1b33] border border-slate-200 dark:border-[#1e3a5f] shadow-xl py-1 max-h-60 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAreaFilter("all");
                        setIsAreaDropdownOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 text-left text-[11px] font-semibold flex items-center justify-between gap-1.5 transition-colors cursor-pointer ${
                        selectedAreaFilter === "all"
                          ? "bg-emerald-600 text-white"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#152646]"
                      }`}
                    >
                      <span className="truncate">ทุกพื้นที่ ({equipmentList.length})</span>
                      {selectedAreaFilter === "all" && <Check size={12} className="shrink-0" />}
                    </button>

                    {areaOptions.map((area) => {
                      const count = equipmentList.filter((i) => i.area === area).length;
                      const isSelected = selectedAreaFilter === area;
                      return (
                        <button
                          key={area}
                          type="button"
                          onClick={() => {
                            setSelectedAreaFilter(area);
                            setIsAreaDropdownOpen(false);
                          }}
                          className={`w-full px-2.5 py-1.5 text-left text-[11px] font-semibold flex items-center justify-between gap-1.5 transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-emerald-600 text-white"
                              : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#152646]"
                          }`}
                        >
                          <span className="truncate">
                            {area} ({count})
                          </span>
                          {isSelected && <Check size={12} className="shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Desktop Native Select (100% preserved) */}
            <select
              value={selectedAreaFilter}
              onChange={(e) => setSelectedAreaFilter(e.target.value)}
              className="hidden sm:block py-1.5 px-3 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">ทุกพื้นที่ตรวจเช็ค ({equipmentList.length})</option>
              {areaOptions.map((area) => {
                const count = equipmentList.filter((i) => i.area === area).length;
                return (
                  <option key={area} value={area}>
                    {area} ({count})
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Status Filter Segmented Tab Buttons */}
        <div className="flex items-center justify-between sm:justify-start gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar pt-1.5 sm:pt-1 border-t border-slate-100 dark:border-[#1e3a5f]">
          <button
            type="button"
            onClick={() => setSelectedStatusFilter("all")}
            className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal whitespace-nowrap transition-colors cursor-pointer text-center ${
              selectedStatusFilter === "all"
                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-xs"
                : "bg-slate-100 dark:bg-[#0c1930] text-slate-600 dark:text-slate-400 hover:bg-slate-200"
            }`}
          >
            ทั้งหมด ({equipmentList.length})
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatusFilter("ready")}
            className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal whitespace-nowrap transition-colors cursor-pointer text-center ${
              selectedStatusFilter === "ready"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-slate-100 dark:bg-[#0c1930] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50"
            }`}
          >
            พร้อมใช้งาน ({metrics.ready})
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatusFilter("repair_needed")}
            className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal whitespace-nowrap transition-colors cursor-pointer text-center ${
              selectedStatusFilter === "repair_needed"
                ? "bg-amber-600 text-white shadow-xs"
                : "bg-slate-100 dark:bg-[#0c1930] text-amber-700 dark:text-amber-400 hover:bg-amber-50"
            }`}
          >
            ชำรุด/รอซ่อม ({metrics.repair})
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatusFilter("in_maintenance")}
            className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal whitespace-nowrap transition-colors cursor-pointer text-center ${
              selectedStatusFilter === "in_maintenance"
                ? "bg-blue-600 text-white shadow-xs"
                : "bg-slate-100 dark:bg-[#0c1930] text-blue-700 dark:text-blue-400 hover:bg-blue-50"
            }`}
          >
            ส่งซ่อมบำรุง ({metrics.maintenance})
          </button>

          <button
            type="button"
            onClick={() => setSelectedStatusFilter("out_of_service")}
            className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal whitespace-nowrap transition-colors cursor-pointer text-center ${
              selectedStatusFilter === "out_of_service"
                ? "bg-rose-600 text-white shadow-xs"
                : "bg-slate-100 dark:bg-[#0c1930] text-rose-700 dark:text-rose-400 hover:bg-rose-50"
            }`}
          >
            งดใช้งาน ({metrics.outOfService})
          </button>
        </div>
      </div>

      {/* Main Table Content View */}
      <div className="rounded-xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-xs overflow-hidden">
        {filteredEquipment.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] sm:text-xs border-collapse">
              <thead className="bg-slate-100 dark:bg-[#0d1b33] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#1e3a5f]">
                <tr>
                  <th className="p-2 sm:p-3 w-8 sm:w-12 text-center">#</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">ชื่ออุปกรณ์</th>
                  <th className="p-2 sm:p-3 font-mono whitespace-nowrap">หมายเลข</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">พื้นที่ตรวจเช็ค</th>
                  <th className="p-2 sm:p-3 text-center w-14 sm:w-20 whitespace-nowrap">จำนวน</th>
                  <th className="p-2 sm:p-3 text-center whitespace-nowrap">สถานะ</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">ผู้ตรวจสอบ</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">วันที่ตรวจสอบ</th>
                  <th className="p-2 sm:p-3 text-center w-28 sm:w-36 whitespace-nowrap">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                {filteredEquipment.map((item, idx) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50 dark:hover:bg-[#152646] transition-colors"
                  >
                    <td className="p-2 sm:p-3 text-center font-mono text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="p-2 sm:p-3 font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Wrench size={13} className="text-slate-400 shrink-0 sm:w-[15px] sm:h-[15px]" />
                        <span>{item.name}</span>
                      </div>
                      {item.notes && (
                        <div className="text-[10px] sm:text-[11px] text-slate-400 font-normal mt-0.5">
                          {item.notes}
                        </div>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 font-mono font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      {item.code}
                    </td>
                    <td className="p-2 sm:p-3 text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px]">
                        <MapPin size={11} className="text-emerald-500 sm:w-3 sm:h-3" />
                        <span>{item.area}</span>
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                      {item.quantity}
                    </td>
                    <td className="p-2 sm:p-3 text-center whitespace-nowrap">{getStatusBadge(item.status)}</td>
                    <td className="p-2 sm:p-3 text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap">
                      {item.lastInspector ? (
                        <div className="flex items-center gap-1">
                          <User size={12} className="text-slate-400 sm:w-[13px] sm:h-[13px]" />
                          <span>{item.lastInspector}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">ยังไม่ได้ตรวจ</span>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 font-mono text-slate-600 dark:text-slate-400 text-[10px] sm:text-[11px] whitespace-nowrap">
                      {item.lastInspectionDate ? (
                        <div>
                          <div>{item.lastInspectionDate}</div>
                          {item.lastShift && (
                            <span className="text-[9.5px] sm:text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                              ({item.lastShift === "day" ? "กะเช้า" : "กะดึก"})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">-</span>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenCheckModal(item)}
                          className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-bold text-[10px] sm:text-[11px] flex items-center gap-1 cursor-pointer"
                          title="บันทึกการตรวจเช็คสภาพประจำวัน"
                        >
                          <ClipboardCheck size={12} className="sm:w-[13px] sm:h-[13px]" />
                          <span>ตรวจเช็ค</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenEquipmentModal(item)}
                          className="p-1 rounded-md text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          title="แก้ไขข้อมูลอุปกรณ์"
                        >
                          <Edit2 size={13} className="sm:w-3.5 sm:h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteEquipment(item)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                          title="ลบรายการ"
                        >
                          <Trash2 size={13} className="sm:w-3.5 sm:h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Empty State View */
          <div className="p-5 sm:p-8 text-center space-y-2.5 sm:space-y-3">
            <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto rounded-full bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-400 border border-slate-200 dark:border-slate-700">
              <Wrench size={24} className="sm:w-8 sm:h-8" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
                ยังไม่มีรายการอุปกรณ์ในระบบ
              </h3>
              <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                {searchKeyword || selectedAreaFilter !== "all" || selectedStatusFilter !== "all"
                  ? "ไม่พบข้อมูลอุปกรณ์ตามเงื่อนไขการค้นหาที่เลือก"
                  : "เริ่มต้นเพิ่มข้อมูลอุปกรณ์ เช่น เครนยกคอยล์, สลิงผ้าใบ, โซ่ยก หรือตะขอ เพื่อตรวจเช็คสภาพก่อนทำงาน"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenEquipmentModal()}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[11px] sm:text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer active:scale-95"
            >
              <Plus size={14} className="sm:w-4 sm:h-4" />
              <span>+ เพิ่มรายการอุปกรณ์แรก</span>
            </button>
          </div>
        )}
      </div>

      {/* 1. Master Equipment Modal (Add / Edit Equipment) */}
      {isEquipmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench size={18} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {editingEquipment ? "แก้ไขข้อมูลอุปกรณ์" : "+ เพิ่มรายการอุปกรณ์ใหม่"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEquipmentModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEquipment} className="p-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  ชื่ออุปกรณ์ <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="เช่น เครนยกคอยล์ อาคาร A, สลิงผ้าใบ 5 ตัน"
                  className="w-full p-2.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    หมายเลข/รหัสอุปกรณ์ <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="เช่น CRN-A01"
                    className="w-full p-2.5 text-xs font-mono font-bold rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-blue-600 dark:text-blue-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    จำนวน (ชิ้น/ชุด)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                    className="w-full p-2.5 text-xs font-mono font-bold rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    พื้นที่ตรวจเช็ค
                  </label>
                  <input
                    type="text"
                    value={formData.area}
                    onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                    placeholder="เช่น อาคาร A, SM01"
                    className="w-full p-2.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    สถานะเริ่มต้น
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value as EquipmentStatus })
                    }
                    className="w-full p-2.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="ready">พร้อมใช้งาน</option>
                    <option value="repair_needed">ชำรุด/รอซ่อม</option>
                    <option value="in_maintenance">ส่งซ่อมบำรุง</option>
                    <option value="out_of_service">งดใช้งาน</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  หมายเหตุเพิ่มเติม
                </label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="ระบุรายละเอียด เช่น พิกัดรับน้ำหนักสูงสุด..."
                  className="w-full p-2.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#1e3a5f]">
                <button
                  type="button"
                  onClick={() => setIsEquipmentModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
                >
                  บันทึกข้อมูล
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Shift Daily Check Modal */}
      {isCheckModalOpen && checkingEquipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={18} className="text-emerald-500" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    บันทึกการตรวจเช็คสภาพประจำวัน
                  </h3>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {checkingEquipment.name} ({checkingEquipment.code})
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCheckModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCheck} className="p-4 space-y-3.5">
              <div className="p-2.5 rounded-lg bg-blue-50/70 dark:bg-[#0c1930] border border-blue-200 dark:border-blue-900 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">พื้นที่ตรวจเช็ค:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{checkingEquipment.area}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">จำนวน:</span>
                  <span className="font-bold font-mono text-slate-800 dark:text-slate-200">{checkingEquipment.quantity} ชิ้น</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    วันที่ตรวจเช็ค
                  </label>
                  <input
                    type="date"
                    required
                    value={checkFormData.inspectionDate}
                    onChange={(e) =>
                      setCheckFormData({ ...checkFormData, inspectionDate: e.target.value })
                    }
                    className="w-full p-2.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    กะการทำงาน
                  </label>
                  <select
                    value={checkFormData.shift}
                    onChange={(e) =>
                      setCheckFormData({
                        ...checkFormData,
                        shift: e.target.value as "day" | "night",
                      })
                    }
                    className="w-full p-2.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="day">กะเช้า (08:00 - 20:00)</option>
                    <option value="night">กะดึก (20:00 - 08:00)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  ผลการประเมินสภาพอุปกรณ์ <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`p-2.5 rounded-lg border flex items-center gap-2 cursor-pointer transition-all ${
                      checkFormData.status === "ready"
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 ring-2 ring-emerald-500/30"
                        : "bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="checkStatus"
                      value="ready"
                      checked={checkFormData.status === "ready"}
                      onChange={() => setCheckFormData({ ...checkFormData, status: "ready" })}
                      className="accent-emerald-600"
                    />
                    <span className="text-xs font-bold">พร้อมใช้งาน</span>
                  </label>

                  <label
                    className={`p-2.5 rounded-lg border flex items-center gap-2 cursor-pointer transition-all ${
                      checkFormData.status === "repair_needed"
                        ? "bg-amber-50 border-amber-500 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 ring-2 ring-amber-500/30"
                        : "bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="checkStatus"
                      value="repair_needed"
                      checked={checkFormData.status === "repair_needed"}
                      onChange={() =>
                        setCheckFormData({ ...checkFormData, status: "repair_needed" })
                      }
                      className="accent-amber-600"
                    />
                    <span className="text-xs font-bold">ชำรุด/รอซ่อม</span>
                  </label>

                  <label
                    className={`p-2.5 rounded-lg border flex items-center gap-2 cursor-pointer transition-all ${
                      checkFormData.status === "in_maintenance"
                        ? "bg-blue-50 border-blue-500 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 ring-2 ring-blue-500/30"
                        : "bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="checkStatus"
                      value="in_maintenance"
                      checked={checkFormData.status === "in_maintenance"}
                      onChange={() =>
                        setCheckFormData({ ...checkFormData, status: "in_maintenance" })
                      }
                      className="accent-blue-600"
                    />
                    <span className="text-xs font-bold">ส่งซ่อมบำรุง</span>
                  </label>

                  <label
                    className={`p-2.5 rounded-lg border flex items-center gap-2 cursor-pointer transition-all ${
                      checkFormData.status === "out_of_service"
                        ? "bg-rose-50 border-rose-500 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 ring-2 ring-rose-500/30"
                        : "bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="checkStatus"
                      value="out_of_service"
                      checked={checkFormData.status === "out_of_service"}
                      onChange={() =>
                        setCheckFormData({ ...checkFormData, status: "out_of_service" })
                      }
                      className="accent-rose-600"
                    />
                    <span className="text-xs font-bold">งดใช้งาน</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  ชื่อผู้ตรวจสอบ <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={checkFormData.inspector}
                  onChange={(e) =>
                    setCheckFormData({ ...checkFormData, inspector: e.target.value })
                  }
                  placeholder="ระบุชื่อพนักงานผู้ตรวจเช็ค"
                  className="w-full p-2.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  ข้อสังเกต / รายละเอียดการซ่อม
                </label>
                <textarea
                  rows={2}
                  value={checkFormData.remarks}
                  onChange={(e) =>
                    setCheckFormData({ ...checkFormData, remarks: e.target.value })
                  }
                  placeholder="ระบุสภาพความชำรุด หรือหมายเหตุเพิ่มเติม..."
                  className="w-full p-2.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#1e3a5f]">
                <button
                  type="button"
                  onClick={() => setIsCheckModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
                >
                  บันทึกผลการตรวจ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
