/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  X,
  FileText,
  Check,
  Trash2,
  RotateCcw,
  Gauge,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Wrench,
} from "lucide-react";
import { Vehicle } from "../types/officer";
import { getVehicleSearchableText, getVehicleTypeDisplayLabel } from "../utils/vehicleHelpers";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import {
  MhPreStartChecklistItem,
  MhPreStartInspectionRecord,
  saveMhPreStartInspectionToCloud,
  subscribeToMhPreStartInspections,
} from "../services/forkliftDataService";

type ChecklistItem = MhPreStartChecklistItem;
type InspectionRecord = MhPreStartInspectionRecord;

interface PreStartInspectionProps {
  vehicles: Vehicle[];
  onNavigateToFixFlush?: () => void;
}

const INITIAL_INSPECTIONS: InspectionRecord[] = [];

interface ChecklistTemplateItem {
  id?: string;
  orderNo?: number;
  categoryThai: string;
  categoryEnglish: string;
  criteriaLines?: string[];
  imageUrl?: string;
  isCustom?: boolean;
}

const CUSTOM_CHECKLIST_STORAGE_KEY = "tmt_prestart_custom_checklist_items_v1";
const FULL_REFERENCE_POSTER_URL = "/assets/aistudio/image_7b6bdcc5.png";

/**
 * มาตรฐานจุดตรวจสอบประจำวัน (ก่อนใช้งานทุกครั้ง) 12 รายการ พร้อมรูปภาพประกอบ
 */
const DEFAULT_CHECKLIST_TEMPLATE: ChecklistTemplateItem[] = [
  {
    id: "daily-01",
    orderNo: 1,
    categoryThai: "1. ระดับน้ำมันเครื่อง",
    categoryEnglish: "ระดับต้องอยู่ระหว่าง MIN - MAX",
    criteriaLines: ["ระดับต้องอยู่ระหว่าง MIN - MAX"],
    imageUrl: "/assets/prestart/check-01.png",
  },
  {
    id: "daily-02",
    orderNo: 2,
    categoryThai: "2. ระดับน้ำหล่อเย็น",
    categoryEnglish: "ระดับต้องอยู่ระหว่าง FULL - LOW",
    criteriaLines: ["ระดับต้องอยู่ระหว่าง FULL - LOW"],
    imageUrl: "/assets/prestart/check-02.png",
  },
  {
    id: "daily-03",
    orderNo: 3,
    categoryThai: "3. ระดับน้ำมันเชื้อเพลิง",
    categoryEnglish: "ตรวจสอบปริมาณน้ำมันเพียงพอ",
    criteriaLines: ["ตรวจสอบปริมาณน้ำมันเพียงพอ"],
    imageUrl: "/assets/prestart/check-03.png",
  },
  {
    id: "daily-04",
    orderNo: 4,
    categoryThai: "4. กรองอากาศ",
    categoryEnglish: "ไม่อุดตัน / ไม่สกปรก",
    criteriaLines: ["ไม่อุดตัน / ไม่สกปรก"],
    imageUrl: "/assets/prestart/check-04.png",
  },
  {
    id: "daily-05",
    orderNo: 5,
    categoryThai: "5. สายพาน",
    categoryEnglish: "ไม่ชำรุด / ไม่หย่อน",
    criteriaLines: ["ไม่ชำรุด / ไม่หย่อน"],
    imageUrl: "/assets/prestart/check-05.png",
  },
  {
    id: "daily-06",
    orderNo: 6,
    categoryThai: "6. น้ำมันเบรก",
    categoryEnglish: "ระดับต้องอยู่ระหว่าง MIN - MAX",
    criteriaLines: ["ระดับต้องอยู่ระหว่าง MIN - MAX"],
    imageUrl: "/assets/prestart/check-06.png",
  },
  {
    id: "daily-07",
    orderNo: 7,
    categoryThai: "7. ระบบไฟ / แสงสว่าง",
    categoryEnglish: "ไฟหน้า / ไฟท้าย / ไฟเลี้ยว / แตร / ไฟเบรก",
    criteriaLines: ["ไฟหน้า / ไฟท้าย / ไฟเลี้ยว", "แตร / ไฟเบรก"],
    imageUrl: "/assets/prestart/check-07.png",
  },
  {
    id: "daily-08",
    orderNo: 8,
    categoryThai: "8. ลมยาง / สภาพยาง",
    categoryEnglish: "ลมยางตามกำหนด ดอกยางไม่สึกหรอ",
    criteriaLines: ["ลมยางตามกำหนด ดอกยางไม่สึกหรอ"],
    imageUrl: "/assets/prestart/check-08.png",
  },
  {
    id: "daily-09",
    orderNo: 9,
    categoryThai: "9. การรั่วซึม",
    categoryEnglish: "น้ำมันเครื่อง / น้ำมันเชื้อเพลิง / น้ำมันไฮดรอลิก / น้ำหล่อเย็น",
    criteriaLines: ["น้ำมันเครื่อง / น้ำมันเชื้อเพลิง", "น้ำมันไฮดรอลิก / น้ำหล่อเย็น"],
    imageUrl: "/assets/prestart/check-09.png",
  },
  {
    id: "daily-10",
    orderNo: 10,
    categoryThai: "10. ระบบเบรก",
    categoryEnglish: "เบรกทำงานปกติ ไม่จม / ไม่แข็ง",
    criteriaLines: ["เบรกทำงานปกติ ไม่จม / ไม่แข็ง"],
    imageUrl: "/assets/prestart/check-10.png",
  },
  {
    id: "daily-11",
    orderNo: 11,
    categoryThai: "11. พวงมาลัย",
    categoryEnglish: "หมุนได้ลื่น ไม่หลวม",
    criteriaLines: ["หมุนได้ลื่น ไม่หลวม"],
    imageUrl: "/assets/prestart/check-11.png",
  },
  {
    id: "daily-12",
    orderNo: 12,
    categoryThai: "12. ข้อต่อลาก / ชุดลาก",
    categoryEnglish: "สลักล็อกแน่นหนา ไม่มีการชำรุด",
    criteriaLines: ["สลักล็อกแน่นหนา ไม่มีการชำรุด"],
    imageUrl: "/assets/prestart/check-12.png",
  },
];

function resolveTemplateMetaForItem(item: ChecklistItem): ChecklistTemplateItem | undefined {
  const byId = DEFAULT_CHECKLIST_TEMPLATE.find((t) => t.id === item.id);
  if (byId) return byId;
  const cleanTitle = (item.categoryThai || "").trim();
  return DEFAULT_CHECKLIST_TEMPLATE.find(
    (t) => t.categoryThai === cleanTitle || cleanTitle.includes(t.categoryThai.replace(/^\d+\.\s*/, ""))
  );
}

function loadCustomChecklistTemplate(): ChecklistTemplateItem[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_CHECKLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ChecklistTemplateItem =>
          Boolean(item) &&
          typeof item.categoryThai === "string" &&
          item.categoryThai.trim().length > 0
      )
      .map((item, idx) => ({
        id: typeof item.id === "string" && item.id ? item.id : `custom-saved-${idx}`,
        categoryThai: item.categoryThai.trim(),
        categoryEnglish: typeof item.categoryEnglish === "string" ? item.categoryEnglish.trim() : "",
        isCustom: true,
      }));
  } catch {
    return [];
  }
}

function saveCustomChecklistTemplate(items: ChecklistTemplateItem[]): void {
  try {
    window.localStorage.setItem(CUSTOM_CHECKLIST_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

function buildChecklistFormItems(customItems: ChecklistTemplateItem[]): ChecklistItem[] {
  const defaults: ChecklistItem[] = DEFAULT_CHECKLIST_TEMPLATE.map((t, idx) => ({
    id: t.id || `daily-${String(idx + 1).padStart(2, "0")}`,
    categoryThai: t.categoryThai,
    categoryEnglish: t.categoryEnglish,
    status: "Pass",
    isCustom: false,
  }));
  const customs: ChecklistItem[] = customItems.map((t, idx) => ({
    id: t.id || `custom-${Date.now()}-${idx}`,
    categoryThai: t.categoryThai,
    categoryEnglish: t.categoryEnglish,
    status: "Pass",
    isCustom: true,
  }));
  return [...defaults, ...customs];
}

function InspectionThumb({
  src,
  alt,
  className = "h-28 w-full",
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-md bg-slate-100 text-slate-400 dark:bg-[#10203a] dark:text-slate-500 ${className}`}
      >
        <Wrench size={20} />
        <span className="mt-1 text-[10px] font-medium">รายการเพิ่มเติม</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`rounded-md object-cover bg-slate-900 ${className}`}
    />
  );
}

export function PreStartInspection({ vehicles }: PreStartInspectionProps) {
  const [inspections, setInspections] = useState<InspectionRecord[]>(INITIAL_INSPECTIONS);
  const [searchQuery, setSearchQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [pmMileageNotice, setPmMileageNotice] = useState<string | null>(null);
  const [showVisualGuide, setShowVisualGuide] = useState<boolean>(true);
  const [showPosterModal, setShowPosterModal] = useState<boolean>(false);

  // Saved Custom Template Items State
  const [customTemplateItems, setCustomTemplateItems] = useState<ChecklistTemplateItem[]>(() =>
    loadCustomChecklistTemplate()
  );

  // Form State
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.vehicleId || "");
  const [operatorName, setOperatorName] = useState(() => getActiveRecorderDisplay("").employeeName);
  const [shift, setShift] = useState("Shift 1 (08:00 - 16:00)");
  const [mileageKm, setMileageKm] = useState<string>("");
  const [operatingHours, setOperatingHours] = useState<string>("");
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formItems, setFormItems] = useState<ChecklistItem[]>(() =>
    buildChecklistFormItems(loadCustomChecklistTemplate())
  );

  // Add New Inspection Item UI State
  const [showAddItemForm, setShowAddItemForm] = useState(false);
  const [newItemThai, setNewItemThai] = useState("");
  const [newItemEnglish, setNewItemEnglish] = useState("");
  const [saveAsTemplateItem, setSaveAsTemplateItem] = useState(true);
  const [addItemError, setAddItemError] = useState("");

  useEffect(() => {
    const unsub = subscribeToMhPreStartInspections((records) => {
      setInspections(records);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!vehicleId && vehicles.length > 0) {
      setVehicleId(vehicles[0].vehicleId);
    }
  }, [vehicles, vehicleId]);

  useEffect(() => {
    if (!pmMileageNotice) return;
    const t = setTimeout(() => setPmMileageNotice(null), 6000);
    return () => clearTimeout(t);
  }, [pmMileageNotice]);

  const openNewChecklistModal = () => {
    const savedCustoms = loadCustomChecklistTemplate();
    setCustomTemplateItems(savedCustoms);
    setFormItems(buildChecklistFormItems(savedCustoms));
    setInspectionDate(new Date().toISOString().slice(0, 10));
    setMileageKm("");
    setOperatingHours("");
    setShowAddItemForm(false);
    setNewItemThai("");
    setNewItemEnglish("");
    setSaveAsTemplateItem(true);
    setAddItemError("");
    setIsModalOpen(true);
  };

  const updateItemStatus = (index: number, status: "Pass" | "Fail" | "NA") => {
    setFormItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, status } : item))
    );
  };

  const updateItemRemark = (index: number, remark: string) => {
    setFormItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, remark } : item))
    );
  };

  const handleAddChecklistItem = () => {
    const thai = newItemThai.trim();
    const eng = newItemEnglish.trim();
    if (!thai) {
      setAddItemError("กรุณาระบุชื่อรายการตรวจสอบ (ภาษาไทย)");
      return;
    }

    const exists = formItems.some(
      (item) => item.categoryThai.trim().toLowerCase() === thai.toLowerCase()
    );
    if (exists) {
      setAddItemError("มีรายการตรวจสอบนี้อยู่ในแบบฟอร์มแล้ว");
      return;
    }

    const newId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newChecklistItem: ChecklistItem = {
      id: newId,
      categoryThai: thai,
      categoryEnglish: eng || "เกณฑ์ตรวจสอบเพิ่มเติม",
      status: "Pass",
      isCustom: true,
    };

    setFormItems((prev) => [...prev, newChecklistItem]);

    if (saveAsTemplateItem) {
      const alreadyInTemplate = customTemplateItems.some(
        (t) => t.categoryThai.trim().toLowerCase() === thai.toLowerCase()
      );
      if (!alreadyInTemplate) {
        const nextTemplate = [
          ...customTemplateItems,
          {
            id: newId,
            categoryThai: thai,
            categoryEnglish: eng || "เกณฑ์ตรวจสอบเพิ่มเติม",
            isCustom: true,
          },
        ];
        setCustomTemplateItems(nextTemplate);
        saveCustomChecklistTemplate(nextTemplate);
      }
    }

    setNewItemThai("");
    setNewItemEnglish("");
    setAddItemError("");
    setShowAddItemForm(false);
  };

  const handleRemoveChecklistItem = (itemId: string) => {
    if (formItems.length <= 1) {
      setAddItemError("ต้องมีรายการตรวจสอบอย่างน้อย 1 รายการ");
      return;
    }
    setAddItemError("");
    setFormItems((prev) => prev.filter((item) => item.id !== itemId));

    const nextTemplate = customTemplateItems.filter((item) => item.id !== itemId);
    if (nextTemplate.length !== customTemplateItems.length) {
      setCustomTemplateItems(nextTemplate);
      saveCustomChecklistTemplate(nextTemplate);
    }
  };

  const handleResetDefaultChecklist = () => {
    setFormItems(buildChecklistFormItems(customTemplateItems));
    setAddItemError("");
  };

  const hasAnyFail = formItems.some((item) => item.status === "Fail");
  const passedFormCount = formItems.filter((item) => item.status === "Pass").length;
  const failedFormCount = formItems.filter((item) => item.status === "Fail").length;
  const overallResult: "Passed (พร้อมใช้งาน)" | "Grounded / Needs Repair (งดใช้ชั่วคราว)" = hasAnyFail
    ? "Grounded / Needs Repair (งดใช้ชั่วคราว)"
    : "Passed (พร้อมใช้งาน)";

  const handleCreateInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;

    const targetVehicle = vehicles.find((v) => v.vehicleId === vehicleId);
    const vehicleDescription = targetVehicle
      ? `${targetVehicle.vehicleId} - ${getVehicleTypeDisplayLabel(targetVehicle.vehicleType, targetVehicle)} (${targetVehicle.description || "Fleet"})`
      : `${vehicleId} - Warehouse Fleet Unit`;

    const resolvedOperator = operatorName.trim() || getActiveRecorderDisplay("WMS Operator").label;
    const parsedMileage = Math.max(0, Math.round(Number(mileageKm) || 0));
    const parsedHours = operatingHours.trim()
      ? Math.max(0, Math.round(Number(operatingHours) || 0))
      : parsedMileage;

    const newRecord: InspectionRecord = {
      id: `INS-${new Date().getFullYear()}-${String(inspections.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-3)}`,
      vehicleId,
      vehicleDescription,
      operatorName: resolvedOperator,
      shift,
      operatingHours: parsedHours,
      mileageKm: parsedMileage,
      items: formItems.map((item) => ({ ...item })),
      overallResult,
      inspectorSignature: resolvedOperator,
      inspectionDate,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setInspections((prev) => [newRecord, ...prev]);
    setIsModalOpen(false);

    const { duePmSchedules } = await saveMhPreStartInspectionToCloud(newRecord);
    if (duePmSchedules.length > 0) {
      setPmMileageNotice(
        `แจ้งเตือน PM ตามเลขไมล์: รถ ${vehicleId} เลขไมล์ปัจจุบัน ${parsedMileage.toLocaleString()} กม. ครบรอบที่ต้องทำ PM แล้ว (ระบบแจ้งเตือนในปฏิทินหน้า กำหนดการ PM เรียบร้อยแล้ว)`
      );
    } else {
      setPmMileageNotice(
        `บันทึกตรวจเช็ครถ ${vehicleId} สำเร็จ (${passedFormCount}/${formItems.length} รายการปกติ · เลขไมล์ ${parsedMileage.toLocaleString()} กม.)`
      );
    }

    void appendWmsActivityLog({
      module: "Pre-Start Inspection",
      sectionId: "fleet_ops",
      reference: newRecord.id,
      activity: `ตรวจเช็คก่อนเริ่มงานรถ ${vehicleId} (${formItems.length} รายการ) เลขไมล์ ${parsedMileage.toLocaleString()} กม. (${overallResult})`,
      status: hasAnyFail ? "Attention" : "Completed",
    });
  };

  const passedCount = inspections.filter((i) => i.overallResult.includes("Passed")).length;
  const groundedCount = inspections.filter((i) => i.overallResult.includes("Grounded")).length;

  const filteredInspections = inspections.filter((i) => {
    const q = searchQuery.trim().toLowerCase();
    const matchedVeh = vehicles.find((v) => v.vehicleId === i.vehicleId);
    const matchesSearch =
      !q ||
      i.id.toLowerCase().includes(q) ||
      i.vehicleId.toLowerCase().includes(q) ||
      i.operatorName.toLowerCase().includes(q) ||
      i.vehicleDescription.toLowerCase().includes(q) ||
      getVehicleSearchableText({
        vehicleId: i.vehicleId,
        vehicleDescription: i.vehicleDescription,
        vehicleType: matchedVeh?.vehicleType,
        description: matchedVeh?.description,
      }).includes(q);

    const matchesResult = resultFilter === "All" || i.overallResult.includes(resultFilter);
    return matchesSearch && matchesResult;
  });

  return (
    <div className="pre-start-inspection">
      {pmMileageNotice && (
        <div
          className={`mb-3 px-4 py-2.5 rounded-lg border text-xs font-semibold flex items-center justify-between gap-3 ${
            pmMileageNotice.includes("ครบรอบที่ต้องทำ PM แล้ว")
              ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/50 dark:border-amber-700 dark:text-amber-200"
              : "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            {pmMileageNotice.includes("ครบรอบที่ต้องทำ PM แล้ว") ? (
              <AlertTriangle size={15} />
            ) : (
              <CheckCircle2 size={15} />
            )}
            {pmMileageNotice}
          </span>
          <button
            type="button"
            onClick={() => setPmMileageNotice(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="prestart-header-card mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3 dark:border-[#1e3a5f] dark:bg-[#0d1d35]">
        <div>
          <div className="prestart-modal-title text-base font-bold text-[#1e3648] dark:text-slate-100">
            ตรวจเช็ครถประจำวัน — จุดตรวจสอบก่อนใช้งานทุกครั้ง (12 รายการมาตรฐาน)
          </div>
          <div className="prestart-modal-sub mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Pre-Start Safety Inspection Checklist · บันทึกผลตรวจพร้อมเลขไมล์เชื่อมโยงรอบ PM อัตโนมัติ
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="button secondary whitespace-nowrap shrink-0"
            onClick={() => setShowPosterModal(true)}
          >
            <ImageIcon size={14} /> ดูผังภาพต้นฉบับ
          </button>
          <button
            type="button"
            className="button primary whitespace-nowrap shrink-0"
            onClick={openNewChecklistModal}
          >
            <Plus size={14} /> ตรวจสภาพรถ (12 รายการ)
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid mb-4">
        <div className="kpi" style={{ borderTopColor: "#10b981" }}>
          <div className="kpi-label">Passed Safety Inspection</div>
          <div className="kpi-value font-mono tabular-nums" style={{ color: "#10b981" }}>
            {passedCount}
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#ef4444" }}>
          <div className="kpi-label">Grounded / Needs Maintenance</div>
          <div className="kpi-value font-mono tabular-nums" style={{ color: "#ef4444" }}>
            {groundedCount}
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#f59e0b" }}>
          <div className="kpi-label">Service Interval Alert (250km/250h)</div>
          <div className="kpi-value font-mono tabular-nums" style={{ color: "#d97706" }}>
            {inspections.filter((i) => (i.mileageKm ?? i.operatingHours) >= 250).length} Units
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#087eaf" }}>
          <div className="kpi-label">Total Daily Checklists</div>
          <div className="kpi-value font-mono tabular-nums" style={{ color: "#087eaf" }}>
            {inspections.length}
          </div>
        </div>
      </div>

      {/* Visual 12-Point Daily Pre-Start Inspection Guide Grid */}
      <section className="panel mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0b2a5b] px-4 py-2.5 text-white dark:bg-[#0a234c]">
          <div className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <span>1. จุดตรวจสอบประจำวัน (ก่อนใช้งานทุกครั้ง)</span>
            <span className="text-xs font-normal text-sky-200">· 12 รายการมาตรฐานพร้อมรูปภาพประกอบ</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openNewChecklistModal}
              className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              เริ่มบันทึกตรวจเช็ค
            </button>
            <button
              type="button"
              onClick={() => setShowVisualGuide((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md border border-white/25 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showVisualGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showVisualGuide ? "ย่อคู่มือภาพ" : "แสดงคู่มือภาพ 12 จุด"}
            </button>
          </div>
        </div>

        {showVisualGuide && (
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-4 dark:divide-[#1e3a5f] dark:bg-[#0d1d35]">
            {DEFAULT_CHECKLIST_TEMPLATE.map((item) => (
              <div
                key={item.id}
                className="flex flex-col p-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-[#112645]"
              >
                <div className="mb-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                  {item.categoryThai}
                </div>
                <div className="mb-2 overflow-hidden rounded-md border border-slate-200 dark:border-[#22406d]">
                  <InspectionThumb
                    src={item.imageUrl}
                    alt={item.categoryThai}
                    className="aspect-[16/11] w-full"
                  />
                </div>
                <div className="mt-auto space-y-0.5 text-[11px] leading-snug text-slate-700 dark:text-slate-300">
                  {(item.criteriaLines || [item.categoryEnglish]).map((line, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="mt-0.5 font-bold text-emerald-600 dark:text-emerald-400">
                        •
                      </span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Main Table Section */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Pre-Start Inspection Records Register</div>
          </div>
        </div>

        {/* Toolbar & Filter */}
        <div className="prestart-filterbar flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#1e3a5f] dark:bg-[#0a1628]">
          <div className="relative min-w-[240px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Search by ID, vehicle, operator name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="prestart-form-input h-[35px] w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs outline-none dark:border-[#1e3a5f] dark:bg-[#0d1d35] dark:text-slate-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-500" />
            <span className="prestart-modal-label text-xs font-semibold text-slate-600 dark:text-slate-300">
              Inspection Result:
            </span>
            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              className="prestart-form-select h-[35px] rounded-md border border-slate-300 bg-white px-2.5 text-xs dark:border-[#1e3a5f] dark:bg-[#0d1d35] dark:text-slate-100"
            >
              <option value="All">All Results</option>
              <option value="Passed">Passed (พร้อมใช้งาน)</option>
              <option value="Grounded">Grounded (งดใช้ชั่วคราว)</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Inspection ID &amp; Date</th>
                <th>Vehicle &amp; Mileage (เลขไมล์)</th>
                <th>Operator &amp; Shift</th>
                <th>Checklist Summary</th>
                <th>Overall Safety Clearance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInspections.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                    No safety inspection records found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredInspections.map((ins) => (
                  <tr key={ins.id}>
                    <td>
                      <span className="code font-mono font-bold">{ins.id}</span>
                      <div className="prestart-modal-sub mt-0.5 font-mono tabular-nums text-[10px] text-slate-500">
                        {ins.inspectionDate}
                      </div>
                    </td>
                    <td>
                      <div className="prestart-modal-val font-bold text-[#1e3648] dark:text-slate-100">
                        {ins.vehicleId}
                      </div>
                      <div className="prestart-modal-sub font-mono tabular-nums text-[11px] font-semibold text-[#087eaf] dark:text-sky-400">
                        เลขไมล์: {(ins.mileageKm ?? ins.operatingHours ?? 0).toLocaleString()} กม.
                        {ins.operatingHours && ins.operatingHours !== ins.mileageKm
                          ? ` · ${ins.operatingHours.toLocaleString()} ชม.`
                          : ""}
                      </div>
                    </td>
                    <td>
                      <div className="prestart-modal-val font-semibold text-slate-700 dark:text-slate-200">
                        {ins.operatorName}
                      </div>
                      <div className="prestart-modal-sub text-[10px] text-slate-500">
                        {ins.shift}
                      </div>
                    </td>
                    <td>
                      <div className="prestart-modal-val font-mono tabular-nums text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                        {ins.items.filter((i) => i.status === "Pass").length} / {ins.items.length}{" "}
                        items passed
                      </div>
                      {ins.items.some((i) => i.status === "Fail") && (
                        <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
                          พบรายการชำรุด {ins.items.filter((i) => i.status === "Fail").length} จุด
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className="status"
                        style={{
                          background: ins.overallResult.includes("Passed") ? "#dcfce7" : "#fee2e2",
                          color: ins.overallResult.includes("Passed") ? "#15803d" : "#b91c1c",
                          border: `1px solid ${ins.overallResult.includes("Passed") ? "#86efac" : "#fca5a5"}`,
                        }}
                      >
                        {ins.overallResult}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button secondary whitespace-nowrap shrink-0 !px-2.5 !py-1 !text-[11px]"
                        onClick={() => setSelectedInspection(ins)}
                      >
                        <FileText size={12} /> View Checklist
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="prestart-filterbar flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500 dark:border-[#1e3a5f] dark:bg-[#0a1628] dark:text-slate-400">
          <span className="prestart-modal-sub font-mono tabular-nums">
            Showing {filteredInspections.length} of {inspections.length} pre-start safety checklists.
          </span>
          <span className="prestart-modal-sub">WMS Material Handling · Pre-Start Inspection</span>
        </div>
      </section>

      {/* Full Original Reference Poster Modal */}
      {showPosterModal && (
        <div
          className="prestart-modal-backdrop fixed inset-0 z-[1050] flex items-center justify-center bg-slate-900/70 p-4"
          onMouseDown={() => setShowPosterModal(false)}
        >
          <div
            className="prestart-modal-card flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-[#1e3a5f] dark:bg-[#0d1d35]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="prestart-modal-header flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3 dark:border-[#1e3a5f] dark:bg-[#0a1628]">
              <div className="prestart-modal-title text-sm font-bold text-slate-900 dark:text-slate-100">
                ผังภาพประกอบจุดตรวจสอบประจำวัน (ก่อนใช้งานทุกครั้ง) 12 รายการ
              </div>
              <button
                type="button"
                onClick={() => setShowPosterModal(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4 text-center">
              <img
                src={FULL_REFERENCE_POSTER_URL}
                alt="จุดตรวจสอบประจำวันก่อนใช้งานทุกครั้ง 12 รายการ"
                referrerPolicy="no-referrer"
                className="mx-auto max-h-[75vh] w-auto rounded-lg border border-slate-200 dark:border-[#1e3a5f]"
              />
            </div>
          </div>
        </div>
      )}

      {/* New Pre-Start Inspection Modal (12 Visual Photo Cards) */}
      {isModalOpen && (
        <div className="prestart-modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/65 p-3 sm:p-5">
          <div className="prestart-modal-card flex max-h-[92vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1e3a5f] dark:bg-[#0d1d35]">
            <div className="prestart-modal-header flex shrink-0 items-center justify-between border-b border-slate-200 bg-[#0b2a5b] px-5 py-3.5 text-white dark:border-[#1e3a5f]">
              <div>
                <div className="text-base font-bold">
                  แบบตรวจสอบรถประจำวันก่อนใช้งาน — 12 จุดตรวจสอบมาตรฐาน
                </div>
                <div className="mt-0.5 text-xs text-sky-200">
                  Pre-Start Safety Inspection Checklist · ตรวจสอบครบทั้ง 12 จุดตามภาพประกอบก่อนออกปฏิบัติงาน
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-md p-1 text-sky-100 transition-colors hover:bg-white/15 cursor-pointer"
                aria-label="ปิดหน้าต่าง"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleCreateInspection}
              className="flex-1 overflow-y-auto p-5"
            >
              {/* Vehicle & Operator Metadata Inputs */}
              <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="prestart-modal-label mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    เลือกรถที่ตรวจเช็ค (Vehicle) *
                  </label>
                  <select
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    required
                    className="prestart-form-select h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                  >
                    <option value="">-- เลือกรถ / Select Vehicle --</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.vehicleId}>
                        {v.vehicleId} - {getVehicleTypeDisplayLabel(v.vehicleType, v)} ({v.description || "Active Fleet"})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="prestart-modal-label mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    ชื่อผู้ตรวจสอบ / พนักงานขับรถ *
                  </label>
                  <input
                    type="text"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    required
                    className="prestart-form-input h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="prestart-modal-label mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    กะการทำงาน (Operation Shift) *
                  </label>
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    className="prestart-form-select h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                  >
                    <option value="Shift 1 (08:00 - 16:00)">Shift 1 (08:00 - 16:00)</option>
                    <option value="Shift 2 (16:00 - 00:00)">Shift 2 (16:00 - 00:00)</option>
                    <option value="Shift 3 (00:00 - 08:00)">Shift 3 (00:00 - 08:00)</option>
                  </select>
                </div>

                <div>
                  <label className="prestart-modal-label mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    วันที่ตรวจเช็ค (Inspection Date) *
                  </label>
                  <input
                    type="date"
                    value={inspectionDate}
                    onChange={(e) => setInspectionDate(e.target.value)}
                    required
                    className="prestart-form-input h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="prestart-modal-label mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <Gauge size={13} className="mr-1 inline text-[#087eaf]" />
                    เลขไมล์ปัจจุบัน (กม. / Odometer) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="เช่น 300 (คำนวณรอบ PM อัตโนมัติ)"
                    value={mileageKm}
                    onChange={(e) => setMileageKm(e.target.value)}
                    required
                    className="prestart-form-input h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="prestart-modal-label mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    ชั่วโมงการทำงาน (Operating Hours - ถ้ามี)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="ระบุชั่วโมงทำงาน (ถ้ามี)"
                    value={operatingHours}
                    onChange={(e) => setOperatingHours(e.target.value)}
                    className="prestart-form-input h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                  />
                </div>
              </div>

              {/* 12-Item Visual Photo Checklist Section */}
              <div className="prestart-item-box rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-[#1e3a5f] dark:bg-[#091529]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="prestart-modal-title text-sm font-bold text-slate-900 dark:text-slate-100">
                      จุดตรวจสอบประจำวัน (ก่อนใช้งานทุกครั้ง)
                    </span>
                    <span className="prestart-modal-sub font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                      · {formItems.length} รายการ · ปกติ {passedFormCount}
                      {failedFormCount > 0 ? ` · ชำรุด ${failedFormCount}` : ""}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {formItems.length < DEFAULT_CHECKLIST_TEMPLATE.length + customTemplateItems.length && (
                      <button
                        type="button"
                        onClick={handleResetDefaultChecklist}
                        className="button secondary whitespace-nowrap shrink-0 !px-2.5 !py-1 !text-[11px]"
                        title="กู้คืนรายการตรวจสอบที่นำออก"
                      >
                        <RotateCcw size={12} /> กู้คืนรายการทั้งหมด
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddItemForm((prev) => !prev);
                        setAddItemError("");
                      }}
                      className="button primary whitespace-nowrap shrink-0 !px-2.5 !py-1 !text-[11px]"
                    >
                      <Plus size={13} /> เพิ่มรายการตรวจสอบ
                    </button>
                  </div>
                </div>

                {showAddItemForm && (
                  <div className="prestart-item-box mb-4 rounded-md border border-sky-200 bg-white p-3 dark:border-sky-800 dark:bg-[#0d1d35]">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="prestart-item-title text-xs font-bold text-slate-800 dark:text-slate-100">
                        เพิ่มรายการตรวจสอบความปลอดภัยใหม่
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddItemForm(false);
                          setAddItemError("");
                        }}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                        aria-label="ปิดฟอร์มเพิ่มรายการ"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="prestart-modal-label mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          ชื่อรายการตรวจสอบ (ภาษาไทย) *
                        </label>
                        <input
                          type="text"
                          value={newItemThai}
                          onChange={(e) => {
                            setNewItemThai(e.target.value);
                            if (addItemError) setAddItemError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddChecklistItem();
                            }
                          }}
                          placeholder="เช่น 13. ตรวจสอบสายชาร์จแบตเตอรี่ / เข็มขัดนิรภัย"
                          className="prestart-form-input w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                          autoFocus
                        />
                      </div>

                      <div>
                        <label className="prestart-modal-label mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          เกณฑ์การตรวจสอบ / รายละเอียด (ถ้ามี)
                        </label>
                        <input
                          type="text"
                          value={newItemEnglish}
                          onChange={(e) => setNewItemEnglish(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddChecklistItem();
                            }
                          }}
                          placeholder="เช่น สภาพสมบูรณ์ ไม่ฉีกขาด ล็อกได้ปกติ"
                          className="prestart-form-input w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                        />
                      </div>
                    </div>

                    {addItemError && (
                      <div className="mt-2 text-[11px] font-semibold text-rose-600">
                        {addItemError}
                      </div>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                      <label className="prestart-modal-sub flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600 select-none dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={saveAsTemplateItem}
                          onChange={(e) => setSaveAsTemplateItem(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-sky-600"
                        />
                        บันทึกเป็นรายการประจำสำหรับตรวจเช็คครั้งถัดไป
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddItemForm(false);
                            setNewItemThai("");
                            setNewItemEnglish("");
                            setAddItemError("");
                          }}
                          className="button secondary whitespace-nowrap shrink-0 !px-2.5 !py-1 !text-[11px]"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={handleAddChecklistItem}
                          className="button primary whitespace-nowrap shrink-0 !px-3 !py-1 !text-[11px]"
                        >
                          <Check size={12} /> เพิ่มลงรายการ
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {!showAddItemForm && addItemError && (
                  <div className="mb-2 text-[11px] font-semibold text-rose-600">{addItemError}</div>
                )}

                {/* Visual Photo-Illustrated 12-Item Checklist Grid */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {formItems.map((item, idx) => {
                    const meta = resolveTemplateMetaForItem(item);
                    const isFail = item.status === "Fail";
                    const criteriaList = meta?.criteriaLines || [item.categoryEnglish];

                    return (
                      <div
                        key={item.id}
                        className={`prestart-item-box flex flex-col rounded-lg border p-3 transition-colors ${
                          isFail
                            ? "border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30"
                            : "border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#0d1d35]"
                        }`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="prestart-item-title text-xs font-bold text-slate-900 dark:text-slate-100">
                              {item.categoryThai}
                            </div>
                            {item.isCustom && (
                              <div className="text-[10px] font-medium text-sky-600 dark:text-sky-400">
                                รายการเพิ่มเติม
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveChecklistItem(item.id)}
                            disabled={formItems.length <= 1}
                            title={formItems.length <= 1 ? "ต้องมีอย่างน้อย 1 รายการ" : "ลบรายการนี้"}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 text-slate-400 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#1e3a5f] cursor-pointer"
                            aria-label={`ลบรายการ ${item.categoryThai}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        {/* Reference Inspection Photo */}
                        <div className="mb-2 overflow-hidden rounded-md border border-slate-200 dark:border-[#1e3a5f]">
                          <InspectionThumb
                            src={meta?.imageUrl}
                            alt={item.categoryThai}
                            className="aspect-[16/10] w-full"
                          />
                        </div>

                        {/* Criteria Guide */}
                        <div className="mb-2.5 space-y-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                          {criteriaList.filter(Boolean).map((line, lineIdx) => (
                            <div key={lineIdx} className="flex items-start gap-1.5">
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                •
                              </span>
                              <span>{line}</span>
                            </div>
                          ))}
                        </div>

                        {/* Pass / Fail Controls */}
                        <div className="mt-auto grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateItemStatus(idx, "Pass")}
                            className={`rounded-md border px-2 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                              item.status === "Pass"
                                ? "border-emerald-700 bg-emerald-600 text-white"
                                : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-[#091529] dark:text-emerald-300"
                            }`}
                          >
                            ✓ ปกติ (Pass)
                          </button>
                          <button
                            type="button"
                            onClick={() => updateItemStatus(idx, "Fail")}
                            className={`rounded-md border px-2 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                              isFail
                                ? "border-rose-700 bg-rose-600 text-white"
                                : "border-rose-300 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-[#091529] dark:text-rose-300"
                            }`}
                          >
                            ✗ ชำรุด (Fail)
                          </button>
                        </div>

                        {/* Defect Remark Field */}
                        <input
                          type="text"
                          placeholder={
                            isFail
                              ? "ระบุอาการชำรุดที่พบ *"
                              : "หมายเหตุเพิ่มเติม (ถ้ามี)..."
                          }
                          value={item.remark || ""}
                          onChange={(e) => updateItemRemark(idx, e.target.value)}
                          className={`prestart-form-input mt-2 w-full rounded border px-2 py-1.5 text-[11px] outline-none ${
                            isFail
                              ? "border-rose-300 bg-white text-rose-900 placeholder:text-rose-400 dark:border-rose-700 dark:bg-[#1a0f18] dark:text-rose-100"
                              : "border-slate-200 bg-slate-50/70 text-slate-700 dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-200"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Overall Clearance Banner */}
                <div
                  className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3.5 py-2.5 ${
                    overallResult.includes("Passed")
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                  }`}
                >
                  <div className="text-xs font-bold">
                    สรุปผลการตรวจเช็ค: {overallResult}
                  </div>
                  <div className="text-[11px] opacity-85">
                    {hasAnyFail
                      ? "ตรวจพบจุดชำรุด — ควรงดใช้งานชั่วคราวและแจ้งซ่อมในระบบแจ้งซ่อม"
                      : "รถผ่านเกณฑ์ความปลอดภัยครบทุกจุด พร้อมปฏิบัติงาน"}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  className="button secondary whitespace-nowrap shrink-0"
                  onClick={() => setIsModalOpen(false)}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="button primary whitespace-nowrap shrink-0"
                >
                  <Check size={14} /> บันทึกผลตรวจเช็ครถประจำวัน
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspection Details Modal ("Safety Checklist Report") */}
      {selectedInspection && (
        <div
          className="prestart-modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/65 p-4"
          onMouseDown={() => setSelectedInspection(null)}
        >
          <div
            className="prestart-modal-card flex max-h-[90vh] w-full max-w-[780px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1e3a5f] dark:bg-[#0d1d35]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="prestart-modal-header flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-[#1e3a5f] dark:bg-[#0a1628]">
              <div>
                <div className="prestart-modal-title text-base font-bold text-slate-900 dark:text-slate-100">
                  รายงานตรวจเช็ครถประจำวัน:{" "}
                  <span className="code font-mono">{selectedInspection.id}</span>
                </div>
                <div className="prestart-modal-sub mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  วันที่ตรวจ {selectedInspection.inspectionDate} · ผู้ตรวจสอบ{" "}
                  {selectedInspection.operatorName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInspection(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-3.5 overflow-y-auto p-5 text-xs sm:grid-cols-2">
              <div>
                <div className="prestart-modal-label font-semibold text-slate-500">รถที่ตรวจเช็ค:</div>
                <div className="prestart-modal-val mt-0.5 font-bold text-slate-900 dark:text-slate-100">
                  {selectedInspection.vehicleDescription}
                </div>
              </div>
              <div>
                <div className="prestart-modal-label font-semibold text-slate-500">ผลการประเมิน:</div>
                <div
                  className={`mt-0.5 font-bold ${
                    selectedInspection.overallResult.includes("Passed")
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {selectedInspection.overallResult}
                </div>
              </div>

              <div>
                <div className="prestart-modal-label font-semibold text-slate-500">
                  ผู้ตรวจสอบและกะทำงาน:
                </div>
                <div className="prestart-modal-val mt-0.5 font-bold text-slate-900 dark:text-slate-100">
                  {selectedInspection.operatorName} ({selectedInspection.shift})
                </div>
              </div>
              <div>
                <div className="prestart-modal-label font-semibold text-slate-500">
                  เลขไมล์ / ชั่วโมงใช้งาน:
                </div>
                <div className="prestart-modal-val mt-0.5 font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                  {(selectedInspection.mileageKm ?? selectedInspection.operatingHours ?? 0).toLocaleString()}{" "}
                  กม.
                  {selectedInspection.operatingHours
                    ? ` (${selectedInspection.operatingHours.toLocaleString()} HRS)`
                    : ""}
                </div>
              </div>

              <div className="sm:col-span-2">
                <div className="prestart-modal-label mb-2 font-semibold text-slate-500">
                  รายละเอียดผลการตรวจสอบ ({selectedInspection.items.length} รายการ):
                </div>
                <div className="prestart-table-border overflow-hidden rounded-lg border border-slate-200 dark:border-[#1e3a5f]">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="prestart-table-header bg-slate-100 dark:bg-[#091529]">
                        <th className="px-3 py-2 text-left">จุดตรวจสอบและภาพประกอบ</th>
                        <th className="px-3 py-2 text-center">ผลตรวจ</th>
                        <th className="px-3 py-2 text-left">หมายเหตุ / อาการชำรุด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInspection.items.map((item, idx) => {
                        const meta = resolveTemplateMetaForItem(item);
                        return (
                          <tr
                            key={idx}
                            className="prestart-table-row border-b border-slate-200 last:border-b-0 dark:border-[#1e3a5f]"
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2.5">
                                {meta?.imageUrl && (
                                  <img
                                    src={meta.imageUrl}
                                    alt={item.categoryThai}
                                    referrerPolicy="no-referrer"
                                    className="h-10 w-14 shrink-0 rounded border border-slate-200 object-cover dark:border-[#1e3a5f]"
                                  />
                                )}
                                <div>
                                  <div className="prestart-item-title font-bold text-[#1e3648] dark:text-slate-100">
                                    {item.categoryThai}
                                  </div>
                                  <div className="prestart-item-sub text-[10px] text-slate-500 dark:text-slate-400">
                                    {item.categoryEnglish}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              <span
                                className={`font-bold ${
                                  item.status === "Pass"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                {item.status === "Pass" ? "✓ ปกติ" : "✗ ชำรุด"}
                              </span>
                            </td>
                            <td className="prestart-item-remark px-3 py-2 text-slate-700 dark:text-slate-300">
                              {item.remark || "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="prestart-modal-footer flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-[#1e3a5f] dark:bg-[#0a1628]">
              <button
                type="button"
                className="button primary"
                onClick={() => setSelectedInspection(null)}
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
