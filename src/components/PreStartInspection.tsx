/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
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
  Truck,
  Zap,
  Link2,
  Box,
  LayoutGrid,
} from "lucide-react";
import { Vehicle } from "../types/officer";
import {
  classifyPreStartVehicleCategory,
  getVehicleSearchableText,
  getVehicleTypeDisplayLabel,
  PreStartVehicleCategoryKey,
} from "../utils/vehicleHelpers";
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

import check01Img from "../assets/images/prestart_engine_oil_1795685531654.jpg";
import check02Img from "../assets/images/prestart_coolant_tank_1795685533059.jpg";
import check03Img from "../assets/images/prestart_fuel_gauge_1795685532990.jpg";
import check04Img from "../assets/images/prestart_air_filter_1795685534651.jpg";
import check05Img from "../assets/images/prestart_drive_belt_1795685535812.jpg";
import check06Img from "../assets/images/prestart_brake_fluid_1795685534826.jpg";
import check07Img from "../assets/images/prestart_vehicle_lights_1795685535881.jpg";
import check08Img from "../assets/images/prestart_tire_tread_1795685537809.jpg";
import check09Img from "../assets/images/prestart_fluid_leak_1795685539748.jpg";
import check10Img from "../assets/images/prestart_brake_pedal_1795685541524.jpg";
import check11Img from "../assets/images/prestart_steering_wheel_1795685541414.jpg";
import check12Img from "../assets/images/prestart_tow_hitch_1795685543090.jpg";

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
 * มาตรฐานจุดตรวจสอบประจำวัน (ก่อนใช้งานทุกครั้ง) 12 รายการ พร้อมรูปภาพประกอบความละเอียดสูง
 */
const DEFAULT_CHECKLIST_TEMPLATE: ChecklistTemplateItem[] = [
  {
    id: "daily-01",
    orderNo: 1,
    categoryThai: "1. ระดับน้ำมันเครื่อง",
    categoryEnglish: "ระดับต้องอยู่ระหว่าง MIN - MAX",
    criteriaLines: ["ระดับต้องอยู่ระหว่าง MIN - MAX"],
    imageUrl: check01Img,
  },
  {
    id: "daily-02",
    orderNo: 2,
    categoryThai: "2. ระดับน้ำหล่อเย็น",
    categoryEnglish: "ระดับต้องอยู่ระหว่าง FULL - LOW",
    criteriaLines: ["ระดับต้องอยู่ระหว่าง FULL - LOW"],
    imageUrl: check02Img,
  },
  {
    id: "daily-03",
    orderNo: 3,
    categoryThai: "3. ระดับน้ำมันเชื้อเพลิง",
    categoryEnglish: "ตรวจสอบปริมาณน้ำมันเพียงพอ",
    criteriaLines: ["ตรวจสอบปริมาณน้ำมันเพียงพอ"],
    imageUrl: check03Img,
  },
  {
    id: "daily-04",
    orderNo: 4,
    categoryThai: "4. กรองอากาศ",
    categoryEnglish: "ไม่อุดตัน / ไม่สกปรก",
    criteriaLines: ["ไม่อุดตัน / ไม่สกปรก"],
    imageUrl: check04Img,
  },
  {
    id: "daily-05",
    orderNo: 5,
    categoryThai: "5. สายพาน",
    categoryEnglish: "ไม่ชำรุด / ไม่หย่อน",
    criteriaLines: ["ไม่ชำรุด / ไม่หย่อน"],
    imageUrl: check05Img,
  },
  {
    id: "daily-06",
    orderNo: 6,
    categoryThai: "6. น้ำมันเบรก",
    categoryEnglish: "ระดับต้องอยู่ระหว่าง MIN - MAX",
    criteriaLines: ["ระดับต้องอยู่ระหว่าง MIN - MAX"],
    imageUrl: check06Img,
  },
  {
    id: "daily-07",
    orderNo: 7,
    categoryThai: "7. ระบบไฟ / แสงสว่าง",
    categoryEnglish: "ไฟหน้า / ไฟท้าย / ไฟเลี้ยว / แตร / ไฟเบรก",
    criteriaLines: ["ไฟหน้า / ไฟท้าย / ไฟเลี้ยว", "แตร / ไฟเบรก"],
    imageUrl: check07Img,
  },
  {
    id: "daily-08",
    orderNo: 8,
    categoryThai: "8. ลมยาง / สภาพยาง",
    categoryEnglish: "ลมยางตามกำหนด ดอกยางไม่สึกหรอ",
    criteriaLines: ["ลมยางตามกำหนด ดอกยางไม่สึกหรอ"],
    imageUrl: check08Img,
  },
  {
    id: "daily-09",
    orderNo: 9,
    categoryThai: "9. การรั่วซึม",
    categoryEnglish: "น้ำมันเครื่อง / น้ำมันเชื้อเพลิง / น้ำมันไฮดรอลิก / น้ำหล่อเย็น",
    criteriaLines: ["น้ำมันเครื่อง / น้ำมันเชื้อเพลิง", "น้ำมันไฮดรอลิก / น้ำหล่อเย็น"],
    imageUrl: check09Img,
  },
  {
    id: "daily-10",
    orderNo: 10,
    categoryThai: "10. ระบบเบรก",
    categoryEnglish: "เบรกทำงานปกติ ไม่จม / ไม่แข็ง",
    criteriaLines: ["เบรกทำงานปกติ ไม่จม / ไม่แข็ง"],
    imageUrl: check10Img,
  },
  {
    id: "daily-11",
    orderNo: 11,
    categoryThai: "11. พวงมาลัย",
    categoryEnglish: "หมุนได้ลื่น ไม่หลวม",
    criteriaLines: ["หมุนได้ลื่น ไม่หลวม"],
    imageUrl: check11Img,
  },
  {
    id: "daily-12",
    orderNo: 12,
    categoryThai: "12. ข้อต่อลาก / ชุดลาก",
    categoryEnglish: "สลักล็อกแน่นหนา ไม่มีการชำรุด",
    criteriaLines: ["สลักล็อกแน่นหนา ไม่มีการชำรุด"],
    imageUrl: check12Img,
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

interface VehicleCategoryTabMeta {
  key: PreStartVehicleCategoryKey;
  label: string;
  shortCode: string;
  helperNote: string;
  defaultNaItemIds: string[];
  activeTabClass: string;
  badgeClass: string;
}

const VEHICLE_CATEGORY_TABS: VehicleCategoryTabMeta[] = [
  {
    key: "diesel_tractor",
    label: "รถหัวลากดีเซล",
    shortCode: "TT-",
    helperNote: "ตรวจสอบครบทั้ง 12 จุดมาตรฐานสำหรับรถหัวลากดีเซล",
    defaultNaItemIds: [],
    activeTabClass:
      "border-[#0b2a5b] bg-[#0b2a5b] text-white shadow-sm dark:border-sky-500 dark:bg-sky-600",
    badgeClass:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
  },
  {
    key: "ev_tractor",
    label: "หัวลากไฟฟ้า EV",
    shortCode: "TTEV-",
    helperNote:
      "รายการเฉพาะเครื่องยนต์ (น้ำมันเครื่อง, เชื้อเพลิง, กรองอากาศ, สายพาน) ตั้งค่าเป็น 'ไม่เกี่ยว' ให้อัตโนมัติ (ปรับเปลี่ยนได้)",
    defaultNaItemIds: ["daily-01", "daily-03", "daily-04", "daily-05"],
    activeTabClass:
      "border-emerald-700 bg-emerald-600 text-white shadow-sm dark:border-emerald-500 dark:bg-emerald-600",
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
  {
    key: "trailer",
    label: "หางลาก",
    shortCode: "TTL-",
    helperNote:
      "เน้นตรวจระบบไฟ, ลมยาง/สภาพยาง, การรั่วซึม/โครงสร้าง, ระบบเบรก และข้อต่อลาก (รายการเครื่องยนต์ตั้งเป็น 'ไม่เกี่ยว' และไม่บังคับกรอกเลขไมล์)",
    defaultNaItemIds: [
      "daily-01",
      "daily-02",
      "daily-03",
      "daily-04",
      "daily-05",
      "daily-06",
      "daily-11",
    ],
    activeTabClass:
      "border-amber-700 bg-amber-600 text-white shadow-sm dark:border-amber-500 dark:bg-amber-600",
    badgeClass:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  },
  {
    key: "forklift",
    label: "โฟล์คลิฟท์",
    shortCode: "FL-",
    helperNote: "ตรวจสอบครบทั้ง 12 จุดมาตรฐานสำหรับรถโฟล์คลิฟท์",
    defaultNaItemIds: [],
    activeTabClass:
      "border-indigo-700 bg-indigo-600 text-white shadow-sm dark:border-indigo-500 dark:bg-indigo-600",
    badgeClass:
      "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800",
  },
  {
    key: "clamp_truck",
    label: "หแ-01 (รถคีบ)",
    shortCode: "หแ-01",
    helperNote: "ตรวจสอบครบทั้ง 12 จุดมาตรฐาน รวมการรั่วซึมระบบไฮดรอลิกและชุดคีบ/ข้อต่อ",
    defaultNaItemIds: [],
    activeTabClass:
      "border-purple-700 bg-purple-600 text-white shadow-sm dark:border-purple-500 dark:bg-purple-600",
    badgeClass:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
  },
];

const VEHICLE_CATEGORY_MAP: Record<PreStartVehicleCategoryKey, VehicleCategoryTabMeta> = {
  diesel_tractor: VEHICLE_CATEGORY_TABS[0],
  ev_tractor: VEHICLE_CATEGORY_TABS[1],
  trailer: VEHICLE_CATEGORY_TABS[2],
  forklift: VEHICLE_CATEGORY_TABS[3],
  clamp_truck: VEHICLE_CATEGORY_TABS[4],
};

const BUILTIN_CLAMP_VEHICLE: Vehicle = {
  id: "BUILTIN-CLAMP-01",
  vehicleId: "หแ-01",
  number: "หแ-01",
  vehicleType: "Other",
  type: "รถคีบ",
  description: "รถคีบเหล็ก (Clamp Truck)",
  registrationNumber: "หแ-01",
  activeStatus: "Active",
  operationalStatus: "Available",
  department: "Material Handling - Fleet",
  status: "Available",
  createdAt: "",
  updatedAt: "",
};

function renderCategoryIcon(key: PreStartVehicleCategoryKey, size = 14) {
  switch (key) {
    case "diesel_tractor":
      return <Truck size={size} />;
    case "ev_tractor":
      return <Zap size={size} />;
    case "trailer":
      return <Link2 size={size} />;
    case "forklift":
      return <Box size={size} />;
    case "clamp_truck":
      return <Wrench size={size} />;
  }
}

function buildChecklistFormItems(
  customItems: ChecklistTemplateItem[],
  category: PreStartVehicleCategoryKey = "diesel_tractor"
): ChecklistItem[] {
  const defaultNaSet = new Set(VEHICLE_CATEGORY_MAP[category]?.defaultNaItemIds || []);
  const defaults: ChecklistItem[] = DEFAULT_CHECKLIST_TEMPLATE.map((t, idx) => {
    const id = t.id || `daily-${String(idx + 1).padStart(2, "0")}`;
    return {
      id,
      categoryThai: t.categoryThai,
      categoryEnglish: t.categoryEnglish,
      status: defaultNaSet.has(id) ? "NA" : "Pass",
      isCustom: false,
    };
  });
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
  const [activePageTab, setActivePageTab] = useState<"all" | PreStartVehicleCategoryKey>("all");
  const [modalCategoryTab, setModalCategoryTab] =
    useState<PreStartVehicleCategoryKey>("diesel_tractor");
  const [searchQuery, setSearchQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [pmMileageNotice, setPmMileageNotice] = useState<string | null>(null);
  const [showVisualGuide, setShowVisualGuide] = useState<boolean>(true);
  const [showPosterModal, setShowPosterModal] = useState<boolean>(false);
  const [previewItem, setPreviewItem] = useState<ChecklistTemplateItem | null>(null);

  // Saved Custom Template Items State
  const [customTemplateItems, setCustomTemplateItems] = useState<ChecklistTemplateItem[]>(() =>
    loadCustomChecklistTemplate()
  );

  // Group vehicles cleanly into the 5 requested categories (naturally sorted by vehicleId)
  const vehiclesByCategory = useMemo(() => {
    const grouped: Record<PreStartVehicleCategoryKey, Vehicle[]> = {
      diesel_tractor: [],
      ev_tractor: [],
      trailer: [],
      forklift: [],
      clamp_truck: [],
    };

    for (const v of vehicles) {
      const cat = classifyPreStartVehicleCategory(v);
      grouped[cat].push(v);
    }

    (Object.keys(grouped) as PreStartVehicleCategoryKey[]).forEach((key) => {
      grouped[key].sort((a, b) =>
        (a.vehicleId || "").localeCompare(b.vehicleId || "", undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    });

    // Ensure หแ-01 (รถคีบ) is always available for inspection even if not yet registered in Vehicle Management
    if (grouped.clamp_truck.length === 0) {
      grouped.clamp_truck.push(BUILTIN_CLAMP_VEHICLE);
    }

    return grouped;
  }, [vehicles]);

  const modalTabVehicles = vehiclesByCategory[modalCategoryTab];
  const activeModalTabMeta = VEHICLE_CATEGORY_MAP[modalCategoryTab];

  // Form State
  const [vehicleId, setVehicleId] = useState(
    () => vehiclesByCategory.diesel_tractor[0]?.vehicleId || vehicles[0]?.vehicleId || ""
  );
  const [operatorName, setOperatorName] = useState(() => getActiveRecorderDisplay("").employeeName);
  const [shift, setShift] = useState("Shift 1 (08:00 - 16:00)");
  const [mileageKm, setMileageKm] = useState<string>("");
  const [operatingHours, setOperatingHours] = useState<string>("");
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formItems, setFormItems] = useState<ChecklistItem[]>(() =>
    buildChecklistFormItems(loadCustomChecklistTemplate(), "diesel_tractor")
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
    if (!modalTabVehicles.some((v) => v.vehicleId === vehicleId)) {
      setVehicleId(modalTabVehicles[0]?.vehicleId || "");
    }
  }, [modalTabVehicles, vehicleId]);

  useEffect(() => {
    if (!pmMileageNotice) return;
    const t = setTimeout(() => setPmMileageNotice(null), 6000);
    return () => clearTimeout(t);
  }, [pmMileageNotice]);

  const handleSelectModalCategoryTab = (tab: PreStartVehicleCategoryKey) => {
    setModalCategoryTab(tab);
    const nextList = vehiclesByCategory[tab];
    setVehicleId(nextList[0]?.vehicleId || "");
    setFormItems(buildChecklistFormItems(customTemplateItems, tab));
    setAddItemError("");
    if (tab === "trailer") {
      setMileageKm("");
    }
  };

  const openNewChecklistModal = (preferredCategory?: PreStartVehicleCategoryKey) => {
    const savedCustoms = loadCustomChecklistTemplate();
    setCustomTemplateItems(savedCustoms);

    const targetCategory: PreStartVehicleCategoryKey =
      preferredCategory || (activePageTab !== "all" ? activePageTab : "diesel_tractor");
    setModalCategoryTab(targetCategory);
    setVehicleId(vehiclesByCategory[targetCategory][0]?.vehicleId || "");
    setFormItems(buildChecklistFormItems(savedCustoms, targetCategory));
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
    setFormItems(buildChecklistFormItems(customTemplateItems, modalCategoryTab));
    setAddItemError("");
  };

  const handleMarkAllPass = () => {
    setFormItems((prev) => prev.map((item) => ({ ...item, status: "Pass" })));
  };

  const hasAnyFail = formItems.some((item) => item.status === "Fail");
  const passedFormCount = formItems.filter((item) => item.status === "Pass").length;
  const failedFormCount = formItems.filter((item) => item.status === "Fail").length;
  const naFormCount = formItems.filter((item) => item.status === "NA").length;
  const applicableFormCount = formItems.length - naFormCount;
  const overallResult: "Passed (พร้อมใช้งาน)" | "Grounded / Needs Repair (งดใช้ชั่วคราว)" = hasAnyFail
    ? "Grounded / Needs Repair (งดใช้ชั่วคราว)"
    : "Passed (พร้อมใช้งาน)";

  const getInspectionCategory = (ins: InspectionRecord): PreStartVehicleCategoryKey => {
    const matchedVeh = vehicles.find((v) => v.vehicleId === ins.vehicleId);
    return classifyPreStartVehicleCategory({
      vehicleId: ins.vehicleId,
      vehicleDescription: ins.vehicleDescription,
      vehicleType: matchedVeh?.vehicleType,
      type: matchedVeh?.type,
      description: matchedVeh?.description,
      registrationNumber: matchedVeh?.registrationNumber,
    });
  };

  const handleCreateInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;

    const targetVehicle =
      modalTabVehicles.find((v) => v.vehicleId === vehicleId) ||
      vehicles.find((v) => v.vehicleId === vehicleId);
    const vehicleDescription = targetVehicle
      ? `${targetVehicle.vehicleId} - ${activeModalTabMeta.label} (${targetVehicle.description || getVehicleTypeDisplayLabel(targetVehicle.vehicleType, targetVehicle)})`
      : `${vehicleId} - ${activeModalTabMeta.label}`;

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
        `บันทึกตรวจเช็ค${activeModalTabMeta.label} ${vehicleId} สำเร็จ (${passedFormCount}/${applicableFormCount} รายการที่ตรวจปกติ${naFormCount > 0 ? ` · ไม่เกี่ยว ${naFormCount}` : ""}${parsedMileage > 0 ? ` · เลขไมล์ ${parsedMileage.toLocaleString()} กม.` : ""})`
      );
    }

    void appendWmsActivityLog({
      module: "Pre-Start Inspection",
      sectionId: "fleet_ops",
      reference: newRecord.id,
      activity: `ตรวจเช็คก่อนเริ่มงาน [${activeModalTabMeta.label}] ${vehicleId} (${passedFormCount}/${applicableFormCount} รายการปกติ) เลขไมล์ ${parsedMileage.toLocaleString()} กม. (${overallResult})`,
      status: hasAnyFail ? "Attention" : "Completed",
    });
  };

  const inspectionCountsByCategory = useMemo(() => {
    const counts: Record<PreStartVehicleCategoryKey, number> = {
      diesel_tractor: 0,
      ev_tractor: 0,
      trailer: 0,
      forklift: 0,
      clamp_truck: 0,
    };
    for (const ins of inspections) {
      const cat = getInspectionCategory(ins);
      counts[cat] += 1;
    }
    return counts;
  }, [inspections, vehicles]);

  const tabScopedInspections = useMemo(() => {
    if (activePageTab === "all") return inspections;
    return inspections.filter((ins) => getInspectionCategory(ins) === activePageTab);
  }, [inspections, activePageTab, vehicles]);

  const passedCount = tabScopedInspections.filter((i) => i.overallResult.includes("Passed")).length;
  const groundedCount = tabScopedInspections.filter((i) =>
    i.overallResult.includes("Grounded")
  ).length;

  const filteredInspections = tabScopedInspections.filter((i) => {
    const q = searchQuery.trim().toLowerCase();
    const matchedVeh = vehicles.find((v) => v.vehicleId === i.vehicleId);
    const catLabel = VEHICLE_CATEGORY_MAP[getInspectionCategory(i)].label.toLowerCase();
    const matchesSearch =
      !q ||
      i.id.toLowerCase().includes(q) ||
      i.vehicleId.toLowerCase().includes(q) ||
      i.operatorName.toLowerCase().includes(q) ||
      i.vehicleDescription.toLowerCase().includes(q) ||
      catLabel.includes(q) ||
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
            onClick={() => openNewChecklistModal()}
          >
            <Plus size={14} /> ตรวจสภาพรถ (12 รายการ)
          </button>
        </div>
      </div>

      {/* Separated 5-Category Vehicle Tabs Bar */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-2 dark:border-[#1e3a5f] dark:bg-[#0d1d35]">
        <button
          type="button"
          onClick={() => setActivePageTab("all")}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activePageTab === "all"
              ? "border-[#0b2a5b] bg-[#0b2a5b] text-white shadow-sm dark:border-sky-500 dark:bg-sky-600"
              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-200 dark:hover:bg-[#112645]"
          }`}
        >
          <LayoutGrid size={14} />
          <span>ทั้งหมด</span>
          <span className="font-mono text-[10px] opacity-80">({inspections.length})</span>
        </button>

        {VEHICLE_CATEGORY_TABS.map((tab) => {
          const isActive = activePageTab === tab.key;
          const recordCount = inspectionCountsByCategory[tab.key];
          const unitCount = vehiclesByCategory[tab.key].length;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActivePageTab(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? tab.activeTabClass
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-200 dark:hover:bg-[#112645]"
              }`}
              title={`${tab.label} · มีรถในกลุ่ม ${unitCount} คัน · ผลตรวจ ${recordCount} รายการ`}
            >
              {renderCategoryIcon(tab.key, 14)}
              <span>{tab.label}</span>
              <span className="font-mono text-[10px] opacity-80">({recordCount})</span>
            </button>
          );
        })}

        {activePageTab !== "all" && (
          <button
            type="button"
            onClick={() => openNewChecklistModal(activePageTab)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 transition-colors hover:bg-sky-100 whitespace-nowrap shrink-0 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300 cursor-pointer"
          >
            <Plus size={13} /> บันทึกตรวจ {VEHICLE_CATEGORY_MAP[activePageTab].label}
          </button>
        )}
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
            {tabScopedInspections.filter((i) => (i.mileageKm ?? i.operatingHours) >= 250).length}{" "}
            Units
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#087eaf" }}>
          <div className="kpi-label">Total Daily Checklists</div>
          <div className="kpi-value font-mono tabular-nums" style={{ color: "#087eaf" }}>
            {tabScopedInspections.length}
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
              onClick={() => openNewChecklistModal()}
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
                <button
                  type="button"
                  onClick={() => setPreviewItem(item)}
                  className="mb-2 block w-full overflow-hidden rounded-md border border-slate-200 dark:border-[#22406d] cursor-zoom-in group"
                  title={`คลิกเพื่อขยายภาพ ${item.categoryThai}`}
                >
                  <InspectionThumb
                    src={item.imageUrl}
                    alt={item.categoryThai}
                    className="aspect-[4/3] w-full transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                </button>
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
                filteredInspections.map((ins) => {
                  const insCat = getInspectionCategory(ins);
                  const insCatMeta = VEHICLE_CATEGORY_MAP[insCat];
                  const passCount = ins.items.filter((i) => i.status === "Pass").length;
                  const failCount = ins.items.filter((i) => i.status === "Fail").length;
                  const naCount = ins.items.filter((i) => i.status === "NA").length;
                  const checkedTotal = ins.items.length - naCount;
                  return (
                    <tr key={ins.id}>
                      <td>
                        <span className="code font-mono font-bold">{ins.id}</span>
                        <div className="prestart-modal-sub mt-0.5 font-mono tabular-nums text-[10px] text-slate-500">
                          {ins.inspectionDate}
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="prestart-modal-val font-bold text-[#1e3648] dark:text-slate-100">
                            {ins.vehicleId}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${insCatMeta.badgeClass}`}
                          >
                            {insCatMeta.label}
                          </span>
                        </div>
                        <div className="prestart-modal-sub mt-0.5 font-mono tabular-nums text-[11px] font-semibold text-[#087eaf] dark:text-sky-400">
                          {insCat === "trailer" && !(ins.mileageKm ?? ins.operatingHours)
                            ? "หางลาก (ไม่ใช้เลขไมล์)"
                            : `เลขไมล์: ${(ins.mileageKm ?? ins.operatingHours ?? 0).toLocaleString()} กม.`}
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
                          {passCount} / {checkedTotal} รายการปกติ
                          {naCount > 0 ? (
                            <span className="ml-1 text-[10px] font-normal text-slate-500">
                              (ไม่เกี่ยว {naCount})
                            </span>
                          ) : null}
                        </div>
                        {failCount > 0 && (
                          <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400">
                            พบรายการชำรุด {failCount} จุด
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className="status"
                          style={{
                            background: ins.overallResult.includes("Passed")
                              ? "#dcfce7"
                              : "#fee2e2",
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="prestart-filterbar flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500 dark:border-[#1e3a5f] dark:bg-[#0a1628] dark:text-slate-400">
          <span className="prestart-modal-sub font-mono tabular-nums">
            Showing {filteredInspections.length} of {tabScopedInspections.length} pre-start safety
            checklists
            {activePageTab !== "all" ? ` (${VEHICLE_CATEGORY_MAP[activePageTab].label})` : ""}.
          </span>
          <span className="prestart-modal-sub">WMS Material Handling · Pre-Start Inspection</span>
        </div>
      </section>

      {/* Single Inspection Item Full-Size Image Lightbox */}
      {previewItem && previewItem.imageUrl && (
        <div
          className="prestart-modal-backdrop fixed inset-0 z-[1060] flex items-center justify-center bg-slate-900/80 p-4"
          onMouseDown={() => setPreviewItem(null)}
        >
          <div
            className="prestart-modal-card flex max-h-[92vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1e3a5f] dark:bg-[#0d1d35]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="prestart-modal-header flex items-center justify-between border-b border-slate-200 bg-[#0b2a5b] px-5 py-3 text-white dark:border-[#1e3a5f]">
              <div className="text-sm font-bold">{previewItem.categoryThai}</div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded p-1 text-sky-100 hover:bg-white/15 cursor-pointer"
                aria-label="ปิดหน้าต่าง"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <img
                src={previewItem.imageUrl}
                alt={previewItem.categoryThai}
                referrerPolicy="no-referrer"
                className="mx-auto max-h-[68vh] w-full rounded-lg border border-slate-200 object-contain bg-slate-950 dark:border-[#1e3a5f]"
              />
              <div className="mt-3 space-y-1 text-xs text-slate-700 dark:text-slate-200">
                {(previewItem.criteriaLines || [previewItem.categoryEnglish]).map((line, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 font-medium">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">•</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
                  เลือกแท็บประเภทรถด้านล่าง เพื่อแยกตรวจระหว่างรถหัวลากดีเซล หัวลากไฟฟ้า EV หางลาก โฟล์คลิฟท์ และรถ หแ-01 (รถคีบ)
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

            {/* 5 Separated Vehicle Type Tabs inside Modal */}
            <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-2.5 dark:border-[#1e3a5f] dark:bg-[#0a1628]">
              <div className="flex flex-wrap items-center gap-1.5">
                {VEHICLE_CATEGORY_TABS.map((tab) => {
                  const isActive = modalCategoryTab === tab.key;
                  const unitCount = vehiclesByCategory[tab.key].length;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleSelectModalCategoryTab(tab.key)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isActive
                          ? tab.activeTabClass
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-[#1e3a5f] dark:bg-[#0d1d35] dark:text-slate-200 dark:hover:bg-[#112645]"
                      }`}
                    >
                      {renderCategoryIcon(tab.key, 14)}
                      <span>{tab.label}</span>
                      <span className="font-mono text-[10px] opacity-80">({unitCount})</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">
                    หมวดที่เลือก: {activeModalTabMeta.label} ({activeModalTabMeta.shortCode})
                  </strong>{" "}
                  · {activeModalTabMeta.helperNote}
                </span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  จำนวนรถในแท็บนี้: {modalTabVehicles.length} คัน
                </span>
              </div>
            </div>

            <form
              onSubmit={handleCreateInspection}
              className="flex-1 overflow-y-auto p-5"
            >
              {/* Vehicle & Operator Metadata Inputs */}
              <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="prestart-modal-label mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    เลือกรถในกลุ่ม: {activeModalTabMeta.label} *
                  </label>
                  <select
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    required
                    className="prestart-form-select h-[36px] w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-100"
                  >
                    {modalTabVehicles.length === 0 ? (
                      <option value="">-- ยังไม่มีข้อมูลรถในกลุ่ม {activeModalTabMeta.label} --</option>
                    ) : (
                      <>
                        <option value="">-- เลือกรถในกลุ่ม {activeModalTabMeta.label} --</option>
                        {modalTabVehicles.map((v) => (
                          <option key={v.id} value={v.vehicleId}>
                            {v.vehicleId} - {activeModalTabMeta.label} (
                            {v.description || getVehicleTypeDisplayLabel(v.vehicleType, v)})
                          </option>
                        ))}
                      </>
                    )}
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
                    {modalCategoryTab === "trailer"
                      ? "เลขไมล์ปัจจุบัน (กม. - ไม่บังคับสำหรับหางลาก)"
                      : "เลขไมล์ปัจจุบัน (กม. / Odometer) *"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder={
                      modalCategoryTab === "trailer"
                        ? "ไม่บังคับสำหรับหางลาก (ใส่ 0 หากไม่มี)"
                        : "เช่น 300 (คำนวณรอบ PM อัตโนมัติ)"
                    }
                    value={mileageKm}
                    onChange={(e) => setMileageKm(e.target.value)}
                    required={modalCategoryTab !== "trailer"}
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
                      จุดตรวจสอบประจำวัน — {activeModalTabMeta.label}
                    </span>
                    <span className="prestart-modal-sub font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                      · {formItems.length} รายการ · ปกติ {passedFormCount}
                      {failedFormCount > 0 ? ` · ชำรุด ${failedFormCount}` : ""}
                      {naFormCount > 0 ? ` · ไม่เกี่ยว ${naFormCount}` : ""}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(failedFormCount > 0 || naFormCount > 0) && (
                      <button
                        type="button"
                        onClick={handleMarkAllPass}
                        className="button secondary whitespace-nowrap shrink-0 !px-2.5 !py-1 !text-[11px]"
                        title="ตั้งทุกรายการเป็นปกติ (Pass)"
                      >
                        <Check size={12} /> ปกติทั้งหมด
                      </button>
                    )}
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
                    const isNa = item.status === "NA";
                    const criteriaList = meta?.criteriaLines || [item.categoryEnglish];

                    return (
                      <div
                        key={item.id}
                        className={`prestart-item-box flex flex-col rounded-lg border p-3 transition-colors ${
                          isFail
                            ? "border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30"
                            : isNa
                            ? "border-slate-200 bg-slate-100/70 opacity-75 dark:border-[#1e3a5f] dark:bg-[#081223]"
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
                            className="aspect-[4/3] w-full"
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

                        {/* Pass / Fail / NA Controls */}
                        <div className="mt-auto grid grid-cols-3 gap-1">
                          <button
                            type="button"
                            onClick={() => updateItemStatus(idx, "Pass")}
                            className={`rounded-md border px-1.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                              item.status === "Pass"
                                ? "border-emerald-700 bg-emerald-600 text-white"
                                : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-[#091529] dark:text-emerald-300"
                            }`}
                          >
                            ✓ ปกติ
                          </button>
                          <button
                            type="button"
                            onClick={() => updateItemStatus(idx, "Fail")}
                            className={`rounded-md border px-1.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                              isFail
                                ? "border-rose-700 bg-rose-600 text-white"
                                : "border-rose-300 bg-white text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-[#091529] dark:text-rose-300"
                            }`}
                          >
                            ✗ ชำรุด
                          </button>
                          <button
                            type="button"
                            onClick={() => updateItemStatus(idx, "NA")}
                            className={`rounded-md border px-1.5 py-1.5 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                              isNa
                                ? "border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-600"
                                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-[#1e3a5f] dark:bg-[#091529] dark:text-slate-300"
                            }`}
                          >
                            — ไม่เกี่ยว
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
                                    : item.status === "NA"
                                    ? "text-slate-500 dark:text-slate-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                {item.status === "Pass"
                                  ? "✓ ปกติ"
                                  : item.status === "NA"
                                  ? "— ไม่เกี่ยว (N/A)"
                                  : "✗ ชำรุด"}
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
