/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Printer,
  X,
  Sun,
  Moon,
  Calendar,
  Clock,
  Truck,
  Users,
  FileText,
  HardHat,
  Edit3,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Employee, Vehicle } from "../types/officer";
import {
  MhDailyDutyRecord,
  MhMaintenanceRecord,
  subscribeToMhMaintenance,
} from "../services/forkliftDataService";

export interface ForkliftTractorOperationReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  initialShift?: string;
  dutiesForDate: MhDailyDutyRecord[];
  allEmployees: Employee[];
  vehicles: Vehicle[];
}

interface VehicleCatalogSpec {
  code: string;
  category: "Forklift" | "Tractor (EV)" | "Tractor" | "SC";
  areaTableCategory: "Forklift" | "Tractor" | "รถคีบ";
  brand: string;
  capacity: string;
  defaultTeam?: "ทีม A" | "ทีม B" | "ทีม C" | "รถสำรอง";
}

// Master reference specs for TMT Wang Noi Forklift, Tractor & Clamp fleet
const TMT_FLEET_SPEC_MAP: Record<string, VehicleCatalogSpec> = {
  "FL-01": { code: "FL-01", category: "Forklift", areaTableCategory: "Forklift", brand: "TCM", capacity: "25 T", defaultTeam: "ทีม A" },
  "FL-03": { code: "FL-03", category: "Forklift", areaTableCategory: "Forklift", brand: "TCM", capacity: "10 T", defaultTeam: "รถสำรอง" },
  "FL-09": { code: "FL-09", category: "Forklift", areaTableCategory: "Forklift", brand: "CAT", capacity: "16 T", defaultTeam: "ทีม B" },
  "FL-10": { code: "FL-10", category: "Forklift", areaTableCategory: "Forklift", brand: "CAT", capacity: "16 T", defaultTeam: "ทีม B" },
  "FL-11": { code: "FL-11", category: "Forklift", areaTableCategory: "Forklift", brand: "Storm", capacity: "10 T", defaultTeam: "รถสำรอง" },
  "FL-12": { code: "FL-12", category: "Forklift", areaTableCategory: "Forklift", brand: "TCM", capacity: "10 T", defaultTeam: "ทีม C" },
  "FL-15": { code: "FL-15", category: "Forklift", areaTableCategory: "Forklift", brand: "TCM", capacity: "15.5 T", defaultTeam: "ทีม C" },
  "TT-03": { code: "TT-03", category: "Tractor", areaTableCategory: "Tractor", brand: "Toyota", capacity: "10 T", defaultTeam: "รถสำรอง" },
  "TT-04": { code: "TT-04", category: "Tractor", areaTableCategory: "Tractor", brand: "Toyota", capacity: "10 T", defaultTeam: "ทีม B" },
  "TT-05": { code: "TT-05", category: "Tractor", areaTableCategory: "Tractor", brand: "Toyota", capacity: "10 T", defaultTeam: "รถสำรอง" },
  "TT-08": { code: "TT-08", category: "Tractor", areaTableCategory: "Tractor", brand: "Toyota", capacity: "15 T", defaultTeam: "ทีม B" },
  "TT-09": { code: "TT-09", category: "Tractor", areaTableCategory: "Tractor", brand: "Toyota", capacity: "15 T", defaultTeam: "ทีม C" },
  "TT-10": { code: "TT-10", category: "Tractor", areaTableCategory: "Tractor", brand: "CURTIS", capacity: "15 T", defaultTeam: "ทีม B" },
  "TT-11": { code: "TT-11", category: "Tractor", areaTableCategory: "Tractor", brand: "CURTIS", capacity: "15 T", defaultTeam: "รถสำรอง" },
  "TT-12": { code: "TT-12", category: "Tractor", areaTableCategory: "Tractor", brand: "CURTIS", capacity: "15 T", defaultTeam: "ทีม C" },
  "TT-13": { code: "TT-13", category: "Tractor", areaTableCategory: "Tractor", brand: "TUG", capacity: "25 T", defaultTeam: "รถสำรอง" },
  "TT-15": { code: "TT-15", category: "Tractor", areaTableCategory: "Tractor", brand: "TUG", capacity: "25 T", defaultTeam: "รถสำรอง" },
  "TT-16": { code: "TT-16", category: "Tractor", areaTableCategory: "Tractor", brand: "NMC", capacity: "25 T", defaultTeam: "ทีม C" },
  "TT-17": { code: "TT-17", category: "Tractor", areaTableCategory: "Tractor", brand: "NMC", capacity: "25 T", defaultTeam: "รถสำรอง" },
  "TT-18": { code: "TT-18", category: "Tractor", areaTableCategory: "Tractor", brand: "NMC", capacity: "25 T", defaultTeam: "ทีม C" },
  "TT-19": { code: "TT-19", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม C" },
  "TT-20": { code: "TT-20", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม A" },
  "TT-21": { code: "TT-21", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม A" },
  "TT-22": { code: "TT-22", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม A" },
  "TT-23": { code: "TT-23", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม A" },
  "TT-24": { code: "TT-24", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม A" },
  "TT-25": { code: "TT-25", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม B" },
  "TT-26": { code: "TT-26", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม B" },
  "TT-27": { code: "TT-27", category: "Tractor (EV)", areaTableCategory: "Tractor", brand: "BYD (EV)", capacity: "25 T", defaultTeam: "ทีม C" },
  "SC-01": { code: "SC-01", category: "SC", areaTableCategory: "รถคีบ", brand: "Xinyuan", capacity: "500 Kg", defaultTeam: "ทีม C" },
};

export interface TeamReportRowItem {
  id: string;
  vehicleCode: string;
  brand: string;
  capacity: string;
  driverName: string;
  workArea: string;
  notes: string;
  endTime?: string;
  isLeave?: boolean;
  rowKind: "normal" | "replacement" | "repair";
}

export interface SpareOrRepairRowItem {
  id: string;
  vehicleCode: string;
  brand: string;
  capacity: string;
  notes: string;
}

export interface ReportCustomConfig {
  teamATitle: string;
  teamALead: string;
  teamAArea: string;
  teamBTitle: string;
  teamBLead: string;
  teamBArea: string;
  teamCTitle: string;
  teamCLead: string;
  teamCArea: string;
  footerNotes: string[];
  replacementRecruitText: string;
  spareVehicles: SpareOrRepairRowItem[];
  repairVehicles: SpareOrRepairRowItem[];
  teamExtraRows: Record<"ทีม A" | "ทีม B" | "ทีม C", TeamReportRowItem[]>;
}

const REPORT_CONFIG_STORAGE_PREFIX = "tmt_wms_mh_forklift_report_cfg_v1_";

const REFERENCE_TEMPLATE_TEAM_ROWS: Record<"ทีม A" | "ทีม B" | "ทีม C", TeamReportRowItem[]> = {
  "ทีม A": [
    { id: "ref-a1", vehicleCode: "FL-01", brand: "TCM", capacity: "25 T", driverName: "รอใช้งานกะเช้า", workArea: "Coil", notes: "-", rowKind: "normal" },
    { id: "ref-a2", vehicleCode: "TT-20", brand: "BYD", capacity: "25 T", driverName: "ชญานนท์ คำกองเกี้ยง", workArea: "Coil", notes: "-", rowKind: "normal" },
    { id: "ref-a3", vehicleCode: "TT-21", brand: "BYD", capacity: "25 T", driverName: "สุทธิงพงศ์ ชูนาคา", workArea: "TM2,4,8,10,12,14", notes: "-", rowKind: "normal" },
    { id: "ref-a4", vehicleCode: "TT-22", brand: "BYD", capacity: "25 T", driverName: "สถาวร ช้างสาร", workArea: "TM1,3,9,11,13,14", notes: "-", rowKind: "normal" },
    { id: "ref-a5", vehicleCode: "TT-23", brand: "BYD", capacity: "25 T", driverName: "ณัฐวุฒิ ภู่สังข์ (ลาป่วย)", workArea: "TM6-7,CF1-5,HT1", notes: "ประกอบย้ายงานแทน / กานต์ เรียนงาน", isLeave: true, rowKind: "normal" },
    { id: "ref-a6", vehicleCode: "TT-24", brand: "BYD", capacity: "25 T", driverName: "ประกอบ นรินท์นอก (ขึ้นขับ TT-23 ย้ายงานแทนณัฐวุฒิ)", workArea: "TM14", notes: "ธนะวัตร ย้ายงานแทน", rowKind: "normal" },
  ],
  "ทีม B": [
    { id: "ref-b1", vehicleCode: "FL-09", brand: "CAT", capacity: "16 T", driverName: "กเนศ เมฆหมอก", workArea: "B,CL,03", notes: "-", rowKind: "normal" },
    { id: "ref-b2", vehicleCode: "FL-10", brand: "CAT", capacity: "16 T", driverName: "รอใช้งานกะดึก", workArea: "-", notes: "-", rowKind: "normal" },
    { id: "ref-b3", vehicleCode: "TT-04", brand: "Toyota", capacity: "10T.", driverName: "เลิศฤทธิ์ ศรีเรืองพันธ์", workArea: "Milkrun", notes: "-", rowKind: "normal" },
    { id: "ref-b4", vehicleCode: "TT-10", brand: "Curtis", capacity: "15 T", driverName: "รถใช้งานกะดึก", workArea: "Milkrun", notes: "ศรายุธร ใช้ย้ายงานแทน TT-08", rowKind: "normal" },
    { id: "ref-b5", vehicleCode: "TT-25", brand: "BYD", capacity: "25 T", driverName: "นิคม คุ้มเณร", workArea: "B,CL,03", notes: "-", rowKind: "normal" },
    { id: "ref-b6", vehicleCode: "TT-26", brand: "BYD", capacity: "25 T", driverName: "เรืองศักดิ์ รัตนรุ่งเรืองกุล", workArea: "B,CL,03", notes: "-", rowKind: "normal" },
    { id: "ref-b7", vehicleCode: "-", brand: "-", capacity: "-", driverName: "รัตพันธ์ ภาลีขันธ์ ( ลาป่วย )", workArea: "-", notes: "-", isLeave: true, rowKind: "normal" },
  ],
  "ทีม C": [
    { id: "ref-c1", vehicleCode: "FL-15", brand: "TCM", capacity: "15.5 T", driverName: "สรศักดิ์ เมฆหมอก", workArea: "04,21,k", notes: "-", rowKind: "normal" },
    { id: "ref-c2", vehicleCode: "TT-09", brand: "Toyota", capacity: "15 T", driverName: "รอสรรหา", workArea: "จ่ายงาน03", notes: "นพนันท์ ใช้จ่ายงาน", rowKind: "normal" },
    { id: "ref-c3", vehicleCode: "TT-16", brand: "NMC", capacity: "25 T", driverName: "นัฐพล เมืองสำราญ", workArea: "Film", notes: "-", rowKind: "normal" },
    { id: "ref-c4", vehicleCode: "TT-18", brand: "NMC", capacity: "25 T", driverName: "รอรถใช้งานกะดึก", workArea: "-", notes: "-", rowKind: "normal" },
    { id: "ref-c5", vehicleCode: "TT-19", brand: "BYD", capacity: "25 T", driverName: "นเรน นุ่มสุก", workArea: "Film", notes: "-", rowKind: "normal" },
    { id: "ref-c6", vehicleCode: "TT-27", brand: "BYD", capacity: "25 T", driverName: "จารุวัฒน์ ศรีโชติ", workArea: "04,21,k", notes: "-", rowKind: "normal" },
    { id: "ref-c7", vehicleCode: "SC-01", brand: "Xinyuan", capacity: "500 Kg.", driverName: "รอรถใช้งานกะเช้า", workArea: "คีบเหล็ก", notes: "-", rowKind: "normal" },
  ],
};

function formatReportShortDate(ymd: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const parts = String(ymd || "").split("-");
  if (parts.length === 3) {
    const yearShort = parts[0].slice(-2);
    const monthIndex = parseInt(parts[1], 10) - 1;
    const day = parts[2].padStart(2, "0");
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${day}-${months[monthIndex]}-${yearShort}`;
    }
  }
  return ymd;
}

function resolveVehicleSpecFromFleet(
  vehicleCode: string,
  vehicles: Vehicle[]
): VehicleCatalogSpec {
  const cleanCode = String(vehicleCode || "").trim().toUpperCase();
  if (!cleanCode || cleanCode === "-") {
    return {
      code: "-",
      category: "Tractor",
      areaTableCategory: "Tractor",
      brand: "-",
      capacity: "-",
    };
  }

  const preset = TMT_FLEET_SPEC_MAP[cleanCode];
  const matchedVehicle = vehicles.find(
    (v) =>
      (v.vehicleId || "").trim().toUpperCase() === cleanCode ||
      (v.number || "").trim().toUpperCase() === cleanCode
  );

  const desc = `${matchedVehicle?.description || ""} ${matchedVehicle?.type || ""}`.trim();
  const descUpper = desc.toUpperCase();

  // Brand resolution
  let brand = preset?.brand || "";
  if (!brand) {
    if (descUpper.includes("BYD")) brand = "BYD (EV)";
    else if (descUpper.includes("TCM")) brand = "TCM";
    else if (descUpper.includes("CAT")) brand = "CAT";
    else if (descUpper.includes("STORM")) brand = "Storm";
    else if (descUpper.includes("TOYOTA")) brand = "Toyota";
    else if (descUpper.includes("CURTIS")) brand = "CURTIS";
    else if (descUpper.includes("NMC")) brand = "NMC";
    else if (descUpper.includes("TUG")) brand = "TUG";
    else if (descUpper.includes("XINYUAN")) brand = "Xinyuan";
    else if (cleanCode.startsWith("FL-")) brand = "TCM";
    else if (cleanCode.startsWith("SC-")) brand = "Xinyuan";
    else {
      const num = parseInt(cleanCode.replace(/\D/g, ""), 10);
      if (!isNaN(num) && num >= 19) brand = "BYD (EV)";
      else brand = "Toyota";
    }
  }

  // Capacity resolution
  let capacity = preset?.capacity || "";
  if (matchedVehicle?.capacityTon) {
    capacity =
      matchedVehicle.capacityTon < 1
        ? `${Math.round(matchedVehicle.capacityTon * 1000)} Kg`
        : `${matchedVehicle.capacityTon} T`;
  } else if (!capacity) {
    capacity = cleanCode.startsWith("SC-") ? "500 Kg" : "25 T";
  }

  // Category resolution
  let category: VehicleCatalogSpec["category"] = preset?.category || "Tractor";
  let areaTableCategory: VehicleCatalogSpec["areaTableCategory"] =
    preset?.areaTableCategory || "Tractor";

  if (cleanCode.startsWith("FL-") || matchedVehicle?.vehicleType === "Forklift") {
    category = "Forklift";
    areaTableCategory = "Forklift";
  } else if (cleanCode.startsWith("SC-") || brand === "Xinyuan") {
    category = "SC";
    areaTableCategory = "รถคีบ";
  } else if (brand.includes("BYD") || descUpper.includes("EV")) {
    category = "Tractor (EV)";
    areaTableCategory = "Tractor";
  } else {
    category = "Tractor";
    areaTableCategory = "Tractor";
  }

  return {
    code: cleanCode,
    category,
    areaTableCategory,
    brand,
    capacity,
    defaultTeam: preset?.defaultTeam,
  };
}

function isLeaveIndication(driverName: string, notes: string, workArea: string): boolean {
  const combined = `${driverName} ${notes} ${workArea}`.toLowerCase();
  return (
    combined.includes("ลาป่วย") ||
    combined.includes("ลากิจ") ||
    combined.includes("ลาพักร้อน") ||
    combined.includes("(ลา") ||
    combined.includes("( ลา") ||
    /\bลา\b/.test(combined)
  );
}

function getDefaultReportConfig(): ReportCustomConfig {
  return {
    teamATitle: "ทีม A Coil CF TM",
    teamALead: "นายประกอบ นรินท์นอก",
    teamAArea: "CF,TM,Coil",
    teamBTitle: "ทีม B CL B 03 Milk Run",
    teamBLead: "นายเพชรรัตน์ วาดเขียน",
    teamBArea: "B,CL,03,MR",
    teamCTitle: "ทีม C 04 21 K FILM",
    teamCLead: "นายนพนันท์ ยันอินทร์",
    teamCArea: "04,21,SC,Film",
    footerNotes: [
      "รถที่จอดซ่อมอยู่ระหว่างดำเนินการซ่อมตามแผน",
      "ตรวจสอบสภาพรถก่อนใช้งานทุกคัน",
      "ปฏิบัติงานตามพื้นที่ที่กำหนด และปฏิบัติตามมาตรฐานความปลอดภัยอย่างเคร่งครัด",
    ],
    replacementRecruitText: "สรรหาทดแทน 4 คน",
    spareVehicles: [
      { id: "sp-1", vehicleCode: "FL-03", brand: "TCM", capacity: "10T.", notes: "-" },
      { id: "sp-2", vehicleCode: "TT-03", brand: "Toyota", capacity: "10T.", notes: "-" },
      { id: "sp-3", vehicleCode: "TT-15", brand: "TUG", capacity: "25T.", notes: "-" },
      { id: "sp-4", vehicleCode: "TT-13", brand: "TUG", capacity: "25T.", notes: "-" },
      { id: "sp-5", vehicleCode: "TT-11", brand: "Curtis", capacity: "15T.", notes: "-" },
    ],
    repairVehicles: [
      { id: "rp-1", vehicleCode: "FL-11", brand: "Storm", capacity: "10T.", notes: "เบรคไม่อยู่" },
      { id: "rp-2", vehicleCode: "TT-17", brand: "NMC", capacity: "25T.", notes: "เบรคไม่อยู่" },
      { id: "rp-3", vehicleCode: "TT-05", brand: "toyota", capacity: "10T.", notes: "สายจ่ายไฟชำรุด" },
    ],
    teamExtraRows: {
      "ทีม A": [],
      "ทีม B": [
        {
          id: "tb-rep-1",
          vehicleCode: "TT-08",
          brand: "Toyota",
          capacity: "15 T",
          driverName: "ศรายุธร ซื่อสัตย์",
          workArea: "ลูกหมากคันชักเสื่อมสภาพ",
          notes: "ใช้ TT-10 แทน",
          rowKind: "repair",
        },
      ],
      "ทีม C": [
        {
          id: "tc-sub-1",
          vehicleCode: "FL-03",
          brand: "TCM",
          capacity: "10T.",
          driverName: "รถสำรอง",
          workArea: "SC",
          notes: "ธีรวัฒน์ ใช้งานแทน FL-12",
          rowKind: "replacement",
        },
        {
          id: "tc-rep-1",
          vehicleCode: "FL-12",
          brand: "TCM",
          capacity: "10 T",
          driverName: "ธีรวัฒน์ สิงห์โตน้อย",
          workArea: "หม้อน้ำรั่ว",
          notes: "ใช้ FL-03 แทน",
          rowKind: "repair",
        },
        {
          id: "tc-rep-2",
          vehicleCode: "TT-12",
          brand: "CURTIS",
          capacity: "15 T",
          driverName: "รอสรรหา",
          workArea: "ล้อหน้าซ้ายมีเสียงดัง",
          notes: "-",
          rowKind: "repair",
        },
      ],
    },
  };
}

export const ForkliftTractorOperationReportModal: React.FC<
  ForkliftTractorOperationReportModalProps
> = ({
  isOpen,
  onClose,
  selectedDate,
  initialShift = "กะเช้า",
  dutiesForDate,
  allEmployees,
  vehicles,
}) => {
  const [reportShift, setReportShift] = useState<string>(() =>
    initialShift === "กะดึก" ? "กะดึก" : "กะเช้า"
  );
  const [isEditingConfig, setIsEditingConfig] = useState<boolean>(false);
  const [useReferencePreview, setUseReferencePreview] = useState<boolean>(false);

  // Sync shift when opened
  useEffect(() => {
    if (isOpen && (initialShift === "กะเช้า" || initialShift === "กะดึก")) {
      setReportShift(initialShift);
    }
  }, [isOpen, initialShift]);

  const storageKey = `${REPORT_CONFIG_STORAGE_PREFIX}${selectedDate}_${reportShift}`;

  const [config, setConfig] = useState<ReportCustomConfig>(() => getDefaultReportConfig());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setConfig({ ...getDefaultReportConfig(), ...parsed });
        return;
      }
    } catch {
      // ignore storage errors
    }
    setConfig(getDefaultReportConfig());
  }, [storageKey]);

  const updateAndSaveConfig = (
    updater: ReportCustomConfig | ((prev: ReportCustomConfig) => ReportCustomConfig)
  ) => {
    setConfig((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  // Subscribe to active maintenance records to enrich repair status
  const [maintenanceRecords, setMaintenanceRecords] = useState<MhMaintenanceRecord[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = subscribeToMhMaintenance((records) => {
      setMaintenanceRecords(records.filter((m) => m.status !== "Completed"));
    });
    return () => unsub();
  }, [isOpen]);

  // Filter duties for selectedDate and reportShift
  const shiftDuties = useMemo(() => {
    const filtered = dutiesForDate.filter((d) => d.shift === reportShift);
    // If user hasn't filtered or assigned specific shift yet, fall back to all duties for selectedDate
    return filtered.length > 0 ? filtered : dutiesForDate;
  }, [dutiesForDate, reportShift]);

  const isShowingReferenceTemplate = useReferencePreview || shiftDuties.length === 0;

  // Build Team A, Team B, Team C rows from live dutiesForDate (or Reference Template if toggled/empty)
  const teamDutyRows = useMemo(() => {
    if (isShowingReferenceTemplate) {
      return REFERENCE_TEMPLATE_TEAM_ROWS;
    }

    const grouped: Record<"ทีม A" | "ทีม B" | "ทีม C", TeamReportRowItem[]> = {
      "ทีม A": [],
      "ทีม B": [],
      "ทีม C": [],
    };

    (["ทีม A", "ทีม B", "ทีม C"] as const).forEach((teamName) => {
      const rowsForTeam = shiftDuties.filter((d) => d.team === teamName);
      grouped[teamName] = rowsForTeam.map((d) => {
        const spec = resolveVehicleSpecFromFleet(d.vehicleNumber, vehicles);
        const onLeave = isLeaveIndication(d.employeeName, d.notes || "", d.workArea || "");
        const displayBrand =
          spec.brand === "BYD (EV)" ? "BYD" : spec.brand === "CURTIS" ? "Curtis" : spec.brand;
        return {
          id: d.id,
          vehicleCode: d.vehicleNumber && d.vehicleNumber !== "-" ? d.vehicleNumber : "-",
          brand: d.vehicleNumber && d.vehicleNumber !== "-" ? displayBrand : "-",
          capacity: d.vehicleNumber && d.vehicleNumber !== "-" ? spec.capacity : "-",
          driverName: d.employeeName,
          workArea: d.workArea || "-",
          notes: d.notes?.trim() || (d.endTime ? `เลิกงาน ${d.endTime} น.` : "-"),
          endTime: d.endTime,
          isLeave: onLeave,
          rowKind: "normal",
        };
      });
    });

    return grouped;
  }, [isShowingReferenceTemplate, shiftDuties, vehicles]);

  // Auto-derive team areas from assigned rows if present, otherwise use config
  const resolvedTeamAreas = useMemo(() => {
    const getAreas = (teamName: "ทีม A" | "ทีม B" | "ทีม C", fallback: string) => {
      const areas = Array.from(
        new Set(
          teamDutyRows[teamName]
            .map((r) => r.workArea)
            .filter((a) => a && a !== "-")
        )
      );
      return areas.length > 0 ? areas.join(", ") : fallback;
    };
    return {
      "ทีม A": getAreas("ทีม A", config.teamAArea),
      "ทีม B": getAreas("ทีม B", config.teamBArea),
      "ทีม C": getAreas("ทีม C", config.teamCArea),
    };
  }, [teamDutyRows, config.teamAArea, config.teamBArea, config.teamCArea]);

  // Compute per-team summary badges: ปกติ, จอดซ่อม, ทั้งหมด, มาทำงาน, ลา, พนง.รวม
  const teamStats = useMemo(() => {
    const calc = (teamName: "ทีม A" | "ทีม B" | "ทีม C") => {
      const normalRows = teamDutyRows[teamName];
      const extraRows = config.teamExtraRows[teamName] || [];
      const repairRows = extraRows.filter((r) => r.rowKind === "repair");

      const normalVehiclesCount = normalRows.filter(
        (r) => r.vehicleCode && r.vehicleCode !== "-"
      ).length;
      const repairVehiclesCount = repairRows.length;
      const totalVehiclesCount = normalVehiclesCount + repairVehiclesCount;

      const leaveEmpCount = normalRows.filter((r) => r.isLeave).length;
      const activeEmpCount = normalRows.filter(
        (r) =>
          !r.isLeave &&
          r.driverName &&
          !r.driverName.includes("รอใช้งาน") &&
          !r.driverName.includes("รอรถใช้งาน") &&
          !r.driverName.includes("รถใช้งานกะ") &&
          !r.driverName.includes("รอสรรหา")
      ).length;
      const totalEmpCount = activeEmpCount + leaveEmpCount;

      return {
        normalVehiclesCount,
        repairVehiclesCount,
        totalVehiclesCount,
        activeEmpCount,
        leaveEmpCount,
        totalEmpCount,
      };
    };

    return {
      "ทีม A": calc("ทีม A"),
      "ทีม B": calc("ทีม B"),
      "ทีม C": calc("ทีม C"),
    };
  }, [teamDutyRows, config.teamExtraRows]);

  // Compute Area Vehicle Summary Table (ประจำพื้นที่ | แยกประเภทรถและรุ่น)
  const areaVehicleSummary = useMemo(() => {
    // Collect all active assigned vehicles across Team A, B, C + team repair rows
    const activeAssignedCodes = new Set<string>();
    const brokenAssignedCodes = new Set<string>();

    (["ทีม A", "ทีม B", "ทีม C"] as const).forEach((t) => {
      teamDutyRows[t].forEach((r) => {
        if (r.vehicleCode && r.vehicleCode !== "-") {
          activeAssignedCodes.add(r.vehicleCode.toUpperCase());
        }
      });
      (config.teamExtraRows[t] || []).forEach((r) => {
        if (r.rowKind === "repair" && r.vehicleCode && r.vehicleCode !== "-") {
          brokenAssignedCodes.add(r.vehicleCode.toUpperCase());
          activeAssignedCodes.delete(r.vehicleCode.toUpperCase());
        }
      });
    });

    // Also check maintenanceRecords or vehicle operationalStatus === "Maintenance"
    vehicles.forEach((v) => {
      const code = (v.vehicleId || "").trim().toUpperCase();
      if (!code) return;
      if (
        v.operationalStatus === "Maintenance" ||
        maintenanceRecords.some((m) => (m.vehicleId || "").toUpperCase() === code)
      ) {
        if (activeAssignedCodes.has(code)) {
          activeAssignedCodes.delete(code);
          brokenAssignedCodes.add(code);
        }
      }
    });

    // Count by brand for the 9 canonical model rows
    const modelCounts: Record<string, { normal: number; broken: number }> = {
      TCM: { normal: 0, broken: 0 },
      CAT: { normal: 0, broken: 0 },
      Storm: { normal: 0, broken: 0 },
      TUG: { normal: 0, broken: 0 },
      Toyota: { normal: 0, broken: 0 },
      CURTIS: { normal: 0, broken: 0 },
      NMC: { normal: 0, broken: 0 },
      "BYD (EV)": { normal: 0, broken: 0 },
      Xinyuan: { normal: 0, broken: 0 },
    };

    const hasAnyTeamVehicles =
      activeAssignedCodes.size > 0 || brokenAssignedCodes.size > 0;

    if (hasAnyTeamVehicles) {
      activeAssignedCodes.forEach((code) => {
        const spec = resolveVehicleSpecFromFleet(code, vehicles);
        const key = modelCounts[spec.brand] ? spec.brand : "Toyota";
        modelCounts[key].normal += 1;
      });
      brokenAssignedCodes.forEach((code) => {
        const spec = resolveVehicleSpecFromFleet(code, vehicles);
        const key = modelCounts[spec.brand] ? spec.brand : "Toyota";
        modelCounts[key].broken += 1;
      });
    } else {
      // Fallback to all active fleet vehicles if no vehicles assigned yet
      vehicles
        .filter((v) => v.activeStatus === "Active")
        .forEach((v) => {
          const spec = resolveVehicleSpecFromFleet(v.vehicleId, vehicles);
          const key = modelCounts[spec.brand] ? spec.brand : "Toyota";
          if (v.operationalStatus === "Maintenance") {
            modelCounts[key].broken += 1;
          } else {
            modelCounts[key].normal += 1;
          }
        });
    }

    const rows = [
      { category: "Forklift", brand: "TCM", ...modelCounts["TCM"] },
      { category: "Forklift", brand: "CAT", ...modelCounts["CAT"] },
      { category: "Forklift", brand: "Storm", ...modelCounts["Storm"] },
      { category: "Tractor", brand: "TUG", ...modelCounts["TUG"] },
      { category: "Tractor", brand: "Toyota", ...modelCounts["Toyota"] },
      { category: "Tractor", brand: "CURTIS", ...modelCounts["CURTIS"] },
      { category: "Tractor", brand: "NMC", ...modelCounts["NMC"] },
      { category: "Tractor", brand: "BYD (EV)", ...modelCounts["BYD (EV)"] },
      { category: "รถคีบ", brand: "Xinyuan", ...modelCounts["Xinyuan"] },
    ].map((r) => ({ ...r, total: r.normal + r.broken }));

    const totalNormal = rows.reduce((sum, r) => sum + r.normal, 0);
    const totalBroken = rows.reduce((sum, r) => sum + r.broken, 0);
    const grandTotal = totalNormal + totalBroken;

    // Top-left 4 category cards summary
    const flNormal =
      modelCounts["TCM"].normal + modelCounts["CAT"].normal + modelCounts["Storm"].normal;
    const flBroken =
      modelCounts["TCM"].broken + modelCounts["CAT"].broken + modelCounts["Storm"].broken;

    const evNormal = modelCounts["BYD (EV)"].normal;
    const evBroken = modelCounts["BYD (EV)"].broken;

    const trNormal =
      modelCounts["TUG"].normal +
      modelCounts["Toyota"].normal +
      modelCounts["CURTIS"].normal +
      modelCounts["NMC"].normal;
    const trBroken =
      modelCounts["TUG"].broken +
      modelCounts["Toyota"].broken +
      modelCounts["CURTIS"].broken +
      modelCounts["NMC"].broken;

    const scNormal = modelCounts["Xinyuan"].normal;
    const scBroken = modelCounts["Xinyuan"].broken;

    return {
      rows,
      totalNormal,
      totalBroken,
      grandTotal,
      cards: {
        fl: { total: flNormal + flBroken, normal: flNormal, broken: flBroken },
        ev: { total: evNormal + evBroken, normal: evNormal, broken: evBroken },
        tractor: { total: trNormal + trBroken, normal: trNormal, broken: trBroken },
        sc: { total: scNormal + scBroken, normal: scNormal, broken: scBroken },
      },
    };
  }, [teamDutyRows, config.teamExtraRows, vehicles, maintenanceRecords]);

  // Compute Manpower Summary Table (พนักงานทั้งหมด ณ วันนี้)
  const manpowerSummary = useMemo(() => {
    const totalAssignedInTeams =
      teamStats["ทีม A"].totalEmpCount +
      teamStats["ทีม B"].totalEmpCount +
      teamStats["ทีม C"].totalEmpCount;

    const totalLeaveInTeams =
      teamStats["ทีม A"].leaveEmpCount +
      teamStats["ทีม B"].leaveEmpCount +
      teamStats["ทีม C"].leaveEmpCount;

    const totalActiveInTeams =
      teamStats["ทีม A"].activeEmpCount +
      teamStats["ทีม B"].activeEmpCount +
      teamStats["ทีม C"].activeEmpCount;

    // Count OT employees based on endTime (e.g. after 17:00 for Day Shift or after 05:00 for Night Shift)
    const standardEndTime = reportShift === "กะดึก" ? "05:00" : "17:00";
    let earlyExitCount = 0;
    let otWorkCount = 0;

    (["ทีม A", "ทีม B", "ทีม C"] as const).forEach((t) => {
      teamDutyRows[t].forEach((r) => {
        if (
          r.isLeave ||
          r.driverName.includes("รอใช้งาน") ||
          r.driverName.includes("รอรถใช้งาน") ||
          r.driverName.includes("รถใช้งานกะ") ||
          r.driverName.includes("รอสรรหา")
        ) {
          return;
        }
        if (r.endTime && r.endTime === standardEndTime) {
          earlyExitCount += 1;
        } else {
          otWorkCount += 1;
        }
      });
    });

    const totalStaff =
      totalAssignedInTeams > 0 ? totalAssignedInTeams : allEmployees.length;
    const leaveStaff = totalLeaveInTeams;
    const workingStaff =
      totalAssignedInTeams > 0 ? totalActiveInTeams : Math.max(0, totalStaff - leaveStaff);

    return {
      totalStaff,
      leaveStaff,
      workingStaff,
      earlyExitCount,
      otWorkCount: totalAssignedInTeams > 0 ? otWorkCount : workingStaff,
    };
  }, [teamStats, teamDutyRows, allEmployees.length, reportShift]);

  const handlePrintReport = () => {
    document.body.classList.add("printing-mh-daily-report");
    window.print();
    setTimeout(() => {
      document.body.classList.remove("printing-mh-daily-report");
    }, 1500);
  };

  if (!isOpen) return null;

  const isMorning = reportShift === "กะเช้า";
  const shiftTitle = isMorning ? "กะเช้า (Day Shift)" : "กะดึก (Night Shift)";
  const shiftTimeText = isMorning ? "เวลา 08.00 - 20.00 น." : "เวลา 20.00 - 08.00 น.";

  const renderReportSheetContent = (forPrint = false) => (
    <div
      className={`min-h-full w-full flex flex-col justify-between bg-[#f4f6f9] dark:bg-[#040d21] text-slate-900 dark:text-slate-100 overflow-hidden font-sans ${
        forPrint ? "print-sheet-container border-0 shadow-none bg-white text-slate-900" : ""
      }`}
    >
      {/* ===================================================================
          1. TOP INDUSTRIAL BANNER HEADER
      =================================================================== */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#2c1905] via-[#1c2331] to-[#111827] px-4 py-3.5 sm:px-6 sm:py-4 text-white border-b-2 border-amber-500/70">
        {/* Decorative Industrial Truss & Forklift Silhouette */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
          preserveAspectRatio="none"
          viewBox="0 0 1400 140"
        >
          <defs>
            <linearGradient id="rptBannerGrid" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <path
            d="M0,25 L1400,25 M0,70 L1400,70 M0,115 L1400,115 M250,0 L180,140 M450,0 L380,140 M650,0 L580,140 M850,0 L780,140 M1050,0 L980,140 M1250,0 L1180,140"
            stroke="url(#rptBannerGrid)"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          {/* Left: Shift Icon + Orange Title Card + Shift Time Pill */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-gradient-to-br from-amber-400 to-orange-600 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.6)]">
                {isMorning ? <Sun size={30} strokeWidth={2.4} /> : <Moon size={28} strokeWidth={2.4} />}
              </div>

              <div className="rounded-2xl border border-amber-300/50 bg-gradient-to-r from-orange-500 via-amber-500 to-orange-500 px-5 py-2 shadow-lg">
                <div className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-xs">
                  {shiftTitle}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-xs sm:text-sm font-bold text-amber-50">
                    รายงานการปฏิบัติงานรถยกและรถลาก
                  </span>
                  <span className="rounded-md bg-amber-300/90 px-2 py-0.5 font-mono text-[10px] font-black text-slate-950">
                    Rev.00
                  </span>
                </div>
              </div>
            </div>

            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-gradient-to-r from-orange-600 to-amber-500 px-3.5 py-1 text-xs font-extrabold text-white shadow-sm">
                <Clock size={13} />
                <span>{shiftTimeText}</span>
              </span>
            </div>
          </div>

          {/* Right: Date Badge Card */}
          <div className="flex items-center gap-3 rounded-2xl border border-orange-300/50 bg-gradient-to-br from-orange-500 to-red-600 px-4 py-2.5 text-white shadow-lg">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 border border-white/25">
              <Calendar size={22} />
            </div>
            <div>
              <div className="text-[11px] font-bold text-orange-100">วันที่</div>
              <div className="font-mono text-lg sm:text-xl font-black tracking-tight tabular-nums">
                {formatReportShortDate(selectedDate)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================
          2. UPPER SUMMARY ROW (4 MAJOR BLOCKS)
      =================================================================== */}
      <div className="grid grid-cols-1 gap-3 p-3 sm:p-4 xl:grid-cols-12">
        {/* BLOCK 1: 5 Vehicle Summary Vertical Cards (xl:col-span-5) */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:col-span-5">
          {/* Card 1: รถทั้งหมด */}
          <div className="flex flex-col justify-between rounded-xl border-2 border-orange-400/80 bg-white dark:bg-[#071739] p-2.5 text-center shadow-xs">
            <div className="flex items-center justify-center gap-1 text-xs font-extrabold text-orange-600 dark:text-amber-300">
              <Truck size={14} />
              <span>รถทั้งหมด</span>
            </div>
            <div className="my-4">
              <div className="font-mono text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums">
                {areaVehicleSummary.grandTotal}
              </div>
              <div className="mt-0.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                คัน
              </div>
            </div>
            <div className="flex items-center justify-center gap-1.5 text-slate-400 dark:text-sky-300/60 pb-1">
              <Truck size={14} />
              <Truck size={14} />
              <Truck size={14} />
            </div>
          </div>

          {/* Card 2: Forklift (FL) */}
          <div className="flex flex-col justify-between overflow-hidden rounded-xl border-2 border-orange-400/80 bg-white dark:bg-[#071739] shadow-xs">
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 py-1.5 text-center text-[11px] font-black text-white">
              Forklift (FL)
            </div>
            <div className="flex flex-1 flex-col items-center justify-center p-2">
              {/* Forklift Vector Icon */}
              <div className="flex h-14 w-16 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-400/20 text-amber-600 dark:text-amber-300">
                <svg viewBox="0 0 64 48" className="h-11 w-14">
                  <rect x="10" y="18" width="24" height="16" rx="3" fill="#f59e0b" />
                  <path d="M16 18 L20 8 L32 8 L32 18 Z" fill="#fbbf24" opacity="0.85" />
                  <rect x="36" y="6" width="3" height="30" fill="#334155" />
                  <rect x="39" y="32" width="14" height="3" fill="#475569" />
                  <circle cx="16" cy="36" r="5" fill="#1e293b" />
                  <circle cx="30" cy="36" r="5" fill="#1e293b" />
                </svg>
              </div>
              <div className="mt-2 font-mono text-base font-black text-slate-900 dark:text-white tabular-nums">
                {areaVehicleSummary.cards.fl.total}{" "}
                <span className="font-sans text-xs font-bold text-slate-600 dark:text-slate-300">
                  คัน
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 text-center text-[10px] font-extrabold text-white">
              <div className="bg-emerald-700 py-1 tabular-nums">
                ปกติ {areaVehicleSummary.cards.fl.normal}
              </div>
              <div className="bg-red-600 py-1 tabular-nums">
                จอดซ่อม {areaVehicleSummary.cards.fl.broken}
              </div>
            </div>
          </div>

          {/* Card 3: Tractor (EV) */}
          <div className="flex flex-col justify-between overflow-hidden rounded-xl border-2 border-orange-400/80 bg-white dark:bg-[#071739] shadow-xs">
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 py-1.5 text-center text-[11px] font-black text-white">
              Tractor (EV)
            </div>
            <div className="flex flex-1 flex-col items-center justify-center p-2">
              <div className="flex h-14 w-16 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-400/20 text-sky-600 dark:text-sky-300">
                <svg viewBox="0 0 64 48" className="h-11 w-14">
                  <rect x="12" y="20" width="38" height="14" rx="3" fill="#0284c7" />
                  <rect x="16" y="11" width="18" height="10" rx="2" fill="#38bdf8" />
                  <circle cx="20" cy="36" r="5" fill="#1e293b" />
                  <circle cx="42" cy="36" r="5" fill="#1e293b" />
                </svg>
              </div>
              <div className="mt-2 font-mono text-base font-black text-slate-900 dark:text-white tabular-nums">
                {areaVehicleSummary.cards.ev.total}{" "}
                <span className="font-sans text-xs font-bold text-slate-600 dark:text-slate-300">
                  คัน
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 text-center text-[10px] font-extrabold text-white">
              <div className="bg-emerald-700 py-1 tabular-nums">
                ปกติ {areaVehicleSummary.cards.ev.normal}
              </div>
              <div className="bg-red-600 py-1 tabular-nums">
                จอดซ่อม {areaVehicleSummary.cards.ev.broken}
              </div>
            </div>
          </div>

          {/* Card 4: Tractor */}
          <div className="flex flex-col justify-between overflow-hidden rounded-xl border-2 border-orange-400/80 bg-white dark:bg-[#071739] shadow-xs">
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 py-1.5 text-center text-[11px] font-black text-white">
              Tractor
            </div>
            <div className="flex flex-1 flex-col items-center justify-center p-2">
              <div className="flex h-14 w-16 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                <svg viewBox="0 0 64 48" className="h-11 w-14">
                  <rect x="10" y="20" width="42" height="14" rx="3" fill="#64748b" />
                  <rect x="28" y="11" width="20" height="10" rx="2" fill="#94a3b8" />
                  <circle cx="18" cy="36" r="5" fill="#1e293b" />
                  <circle cx="44" cy="36" r="5" fill="#1e293b" />
                </svg>
              </div>
              <div className="mt-2 font-mono text-base font-black text-slate-900 dark:text-white tabular-nums">
                {areaVehicleSummary.cards.tractor.total}{" "}
                <span className="font-sans text-xs font-bold text-slate-600 dark:text-slate-300">
                  คัน
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 text-center text-[10px] font-extrabold text-white">
              <div className="bg-emerald-700 py-1 tabular-nums">
                ปกติ {areaVehicleSummary.cards.tractor.normal}
              </div>
              <div className="bg-red-600 py-1 tabular-nums">
                จอดซ่อม {areaVehicleSummary.cards.tractor.broken}
              </div>
            </div>
          </div>

          {/* Card 5: SC (รถคีบ) */}
          <div className="flex flex-col justify-between overflow-hidden rounded-xl border-2 border-orange-400/80 bg-white dark:bg-[#071739] shadow-xs">
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 py-1.5 text-center text-[11px] font-black text-white">
              SC
            </div>
            <div className="flex flex-1 flex-col items-center justify-center p-2">
              <div className="flex h-14 w-16 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-400/20 text-orange-600 dark:text-orange-300">
                <svg viewBox="0 0 64 48" className="h-11 w-14">
                  <rect x="12" y="22" width="22" height="12" rx="2" fill="#ea580c" />
                  <path d="M32 24 L46 10 L54 18" stroke="#c2410c" strokeWidth="3.5" fill="none" />
                  <circle cx="18" cy="36" r="4.5" fill="#1e293b" />
                  <circle cx="28" cy="36" r="4.5" fill="#1e293b" />
                </svg>
              </div>
              <div className="mt-2 font-mono text-base font-black text-slate-900 dark:text-white tabular-nums">
                {areaVehicleSummary.cards.sc.total}{" "}
                <span className="font-sans text-xs font-bold text-slate-600 dark:text-slate-300">
                  คัน
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 text-center text-[10px] font-extrabold text-white">
              <div className="bg-emerald-700 py-1 tabular-nums">
                ปกติ {areaVehicleSummary.cards.sc.normal}
              </div>
              <div className="bg-red-600 py-1 tabular-nums">
                จอดซ่อม {areaVehicleSummary.cards.sc.broken}
              </div>
            </div>
          </div>
        </div>

        {/* BLOCK 2: ประจำพื้นที่ | แยกประเภทรถและรุ่น (xl:col-span-3) */}
        <div className="flex flex-col overflow-hidden rounded-xl border-2 border-blue-600/80 bg-white dark:bg-[#071739] shadow-xs xl:col-span-3">
          <div className="flex items-center justify-between bg-gradient-to-r from-blue-800 to-blue-600 px-3 py-1.5 text-xs font-extrabold text-white">
            <span>ประจำพื้นที่</span>
            <span className="text-[11px] text-sky-100">แยกประเภทรถและรุ่น</span>
          </div>
          <div className="flex-1 overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-sky-400/20 bg-sky-100 dark:bg-[#0b2559] font-extrabold text-slate-800 dark:text-sky-100">
                  <th className="px-2 py-1 text-left">ประเภทรถ</th>
                  <th className="px-2 py-1 text-center">รุ่น</th>
                  <th className="bg-emerald-700 px-2 py-1 text-center text-white">ปกติ</th>
                  <th className="bg-red-600 px-2 py-1 text-center text-white">จอดซ่อม</th>
                  <th className="bg-blue-900 px-2 py-1 text-center text-white">รวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-sky-400/15 font-semibold">
                {areaVehicleSummary.rows.map((r, idx) => {
                  const showCategory =
                    idx === 0 ||
                    areaVehicleSummary.rows[idx - 1].category !== r.category;
                  return (
                    <tr
                      key={`area-model-${r.brand}`}
                      className="hover:bg-sky-50/60 dark:hover:bg-sky-400/10"
                    >
                      <td className="px-2 py-1 font-extrabold text-slate-800 dark:text-white">
                        {showCategory ? r.category : ""}
                      </td>
                      <td className="px-2 py-1 text-center text-slate-700 dark:text-slate-200">
                        {r.brand}
                      </td>
                      <td className="px-2 py-1 text-center font-mono font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {r.normal}
                      </td>
                      <td className="px-2 py-1 text-center font-mono font-extrabold text-red-600 dark:text-rose-400 tabular-nums">
                        {r.broken}
                      </td>
                      <td className="px-2 py-1 text-center font-mono font-extrabold text-slate-900 dark:text-white tabular-nums">
                        {r.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-blue-600/60 bg-slate-100 dark:bg-[#09204f] font-extrabold">
                  <td colSpan={2} className="px-2 py-1.5 text-right text-slate-800 dark:text-white">
                    รวม
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
                    {areaVehicleSummary.totalNormal}
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-red-600 dark:text-rose-300 tabular-nums">
                    {areaVehicleSummary.totalBroken}
                  </td>
                  <td className="bg-blue-800 px-2 py-1.5 text-center font-mono text-white tabular-nums">
                    {areaVehicleSummary.grandTotal}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* BLOCK 3: รถสำรอง & จอดซ่อม (xl:col-span-2) */}
        <div className="flex flex-col overflow-hidden rounded-xl border-2 border-emerald-700/80 bg-white dark:bg-[#071739] shadow-xs xl:col-span-2">
          <div className="bg-gradient-to-r from-emerald-800 to-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white">
            รถสำรอง ({config.spareVehicles.length})
          </div>
          <div className="flex-1 overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-sky-400/20 bg-emerald-50 dark:bg-emerald-950/50 font-extrabold text-slate-700 dark:text-emerald-200">
                  <th className="px-2 py-1 text-center">รหัสรถ</th>
                  <th className="px-2 py-1 text-center">รุ่น</th>
                  <th className="px-2 py-1 text-center">พิกัด</th>
                  <th className="px-2 py-1 text-center">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-sky-400/15 font-semibold">
                {config.spareVehicles.map((sp) => (
                  <tr key={sp.id}>
                    <td className="px-2 py-1 text-center font-mono font-extrabold text-emerald-800 dark:text-emerald-300">
                      {sp.vehicleCode}
                    </td>
                    <td className="px-2 py-1 text-center text-slate-700 dark:text-slate-200">
                      {sp.brand}
                    </td>
                    <td className="px-2 py-1 text-center font-mono text-slate-700 dark:text-slate-300">
                      {sp.capacity}
                    </td>
                    <td className="px-2 py-1 text-center text-slate-600 dark:text-slate-300">
                      {sp.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Sub-header: จอดซ่อม */}
            <div className="bg-gradient-to-r from-red-700 to-red-600 px-3 py-1 text-xs font-extrabold text-white">
              จอดซ่อม ({config.repairVehicles.length})
            </div>
            <table className="w-full border-collapse text-[11px]">
              <tbody className="divide-y divide-slate-200 dark:divide-sky-400/15 font-semibold">
                {config.repairVehicles.map((rp) => (
                  <tr key={rp.id} className="bg-red-50/40 dark:bg-rose-950/20">
                    <td className="px-2 py-1 text-center font-mono font-extrabold text-red-700 dark:text-rose-300">
                      {rp.vehicleCode}
                    </td>
                    <td className="px-2 py-1 text-center text-slate-700 dark:text-slate-200">
                      {rp.brand}
                    </td>
                    <td className="px-2 py-1 text-center font-mono text-slate-700 dark:text-slate-300">
                      {rp.capacity}
                    </td>
                    <td className="px-2 py-1 text-center font-bold text-red-600 dark:text-rose-300">
                      {rp.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* BLOCK 4: พนักงานทั้งหมด ณ วันนี้ (xl:col-span-2) */}
        <div className="flex flex-col justify-between overflow-hidden rounded-xl border-2 border-emerald-800/80 bg-white dark:bg-[#071739] shadow-xs xl:col-span-2">
          <div>
            <div className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-900 to-emerald-700 px-3 py-1.5 text-xs font-extrabold text-white">
              <Users size={14} />
              <span>พนักงานทั้งหมด ณ วันนี้</span>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-sky-400/20 bg-emerald-100/80 dark:bg-emerald-950/50 font-extrabold text-slate-800 dark:text-emerald-200">
                  <th className="px-2.5 py-1.5 text-left">รายการ</th>
                  <th className="px-2 py-1.5 text-center">จำนวน</th>
                  <th className="px-2 py-1.5 text-center">คน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-sky-400/15 font-bold">
                <tr>
                  <td className="px-2.5 py-1.5 text-slate-800 dark:text-slate-100">
                    พนักงานทั้งหมด
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                    {manpowerSummary.totalStaff}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-600 dark:text-slate-300">คน</td>
                </tr>
                <tr>
                  <td className="px-2.5 py-1.5 text-slate-800 dark:text-slate-100">
                    พนักงานลา
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-sm font-black text-red-600 dark:text-rose-400 tabular-nums">
                    {manpowerSummary.leaveStaff}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-600 dark:text-slate-300">คน</td>
                </tr>
                <tr>
                  <td className="px-2.5 py-1.5 text-slate-800 dark:text-slate-100">
                    พนักงานมาปฏิบัติงาน
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                    {manpowerSummary.workingStaff}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-600 dark:text-slate-300">คน</td>
                </tr>
                <tr>
                  <td className="px-2.5 py-1.5 text-slate-800 dark:text-slate-100">
                    ออกโอที
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                    {manpowerSummary.earlyExitCount}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-600 dark:text-slate-300">คน</td>
                </tr>
                <tr>
                  <td className="px-2.5 py-1.5 text-slate-800 dark:text-slate-100">
                    ปฏิบัติงานช่วง OT
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                    {manpowerSummary.otWorkCount}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-600 dark:text-slate-300">คน</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-emerald-800 py-1.5 text-center text-xs font-extrabold text-white">
            {config.replacementRecruitText}
          </div>
        </div>
      </div>

      {/* ===================================================================
          3. SECTION DIVIDER BAR WITH HAZARD STRIPES
      =================================================================== */}
      <div className="mx-3 sm:mx-4 flex items-center justify-between overflow-hidden rounded-xl bg-gradient-to-r from-orange-600 via-amber-500 to-orange-500 px-4 py-2 text-white shadow-sm">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-black tracking-wide">
          <Truck size={16} />
          <span>
            แผนการทำงานประจำวัน – {shiftTitle} | ตารางทีม A / B / C อ้างอิง Excel ต้นฉบับ
          </span>
        </div>
        <div
          aria-hidden="true"
          className="hidden sm:block h-4 w-32 rounded-xs border border-amber-300/60"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-45deg, #111827, #111827 8px, #f59e0b 8px, #f59e0b 16px)",
          }}
        />
      </div>

      {/* ===================================================================
          4. THREE TEAM COLUMNS (ทีม A / ทีม B / ทีม C)
      =================================================================== */}
      <div className="flex-1 grid grid-cols-1 gap-3 p-3 sm:p-4 lg:grid-cols-3">
        {(
          [
            {
              teamKey: "ทีม A" as const,
              title: config.teamATitle,
              lead: config.teamALead,
              area: resolvedTeamAreas["ทีม A"],
            },
            {
              teamKey: "ทีม B" as const,
              title: config.teamBTitle,
              lead: config.teamBLead,
              area: resolvedTeamAreas["ทีม B"],
            },
            {
              teamKey: "ทีม C" as const,
              title: config.teamCTitle,
              lead: config.teamCLead,
              area: resolvedTeamAreas["ทีม C"],
            },
          ] as const
        ).map((teamMeta) => {
          const stats = teamStats[teamMeta.teamKey];
          const mainRows = teamDutyRows[teamMeta.teamKey];
          const extraRows = config.teamExtraRows[teamMeta.teamKey] || [];
          const replacementRows = extraRows.filter((r) => r.rowKind === "replacement");
          const repairRows = extraRows.filter((r) => r.rowKind === "repair");

          return (
            <div
              key={teamMeta.teamKey}
              className="flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-slate-200 dark:border-sky-400/30 bg-white dark:bg-[#071739] shadow-sm"
            >
              <div>
                {/* Team Card Orange Header */}
                <div className="flex items-center justify-between bg-gradient-to-r from-orange-600 to-amber-500 px-3.5 py-2 text-white">
                  <span className="text-sm font-black tracking-wide">{teamMeta.title}</span>
                  <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-extrabold text-white">
                    {reportShift}
                  </span>
                </div>

                {/* Team Lead & Area Info */}
                <div className="border-b border-slate-200 dark:border-sky-400/20 bg-slate-50/70 dark:bg-[#09204f]/60 px-3.5 py-2 text-xs">
                  <div className="font-extrabold text-slate-900 dark:text-white">
                    หัวหน้าทีม: <span>{teamMeta.lead}</span>
                  </div>
                  <div className="mt-0.5 font-extrabold text-slate-800 dark:text-sky-200">
                    พื้นที่: <span>{teamMeta.area}</span>
                  </div>

                  {/* 6 Mini KPI Boxes */}
                  <div className="mt-2 grid grid-cols-6 gap-1.5 text-center">
                    <div className="rounded-lg border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/50 py-1">
                      <div className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                        ปกติ
                      </div>
                      <div className="font-mono text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
                        {stats.normalVehiclesCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-red-300 dark:border-rose-500/40 bg-red-50 dark:bg-rose-950/50 py-1">
                      <div className="text-[10px] font-bold text-red-700 dark:text-rose-300">
                        จอดซ่อม
                      </div>
                      <div className="font-mono text-sm font-black text-red-600 dark:text-rose-300 tabular-nums">
                        {stats.repairVehiclesCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#041029] py-1">
                      <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                        ทั้งหมด
                      </div>
                      <div className="font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                        {stats.totalVehiclesCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-teal-300 dark:border-teal-500/40 bg-teal-50 dark:bg-teal-950/50 py-1">
                      <div className="text-[10px] font-bold text-teal-800 dark:text-teal-300">
                        มาทำงาน
                      </div>
                      <div className="font-mono text-sm font-black text-teal-700 dark:text-teal-300 tabular-nums">
                        {stats.activeEmpCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-red-300 dark:border-rose-500/40 bg-red-50 dark:bg-rose-950/50 py-1">
                      <div className="text-[10px] font-bold text-red-700 dark:text-rose-300">
                        ลา
                      </div>
                      <div className="font-mono text-sm font-black text-red-600 dark:text-rose-300 tabular-nums">
                        {stats.leaveEmpCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#041029] py-1">
                      <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                        พนง.รวม
                      </div>
                      <div className="font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                        {stats.totalEmpCount}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Team Assignment Table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0f2537] dark:bg-[#041029] text-white">
                        <th className="px-2 py-1.5 text-center font-extrabold">ทะเบียนรถ</th>
                        <th className="px-1.5 py-1.5 text-center font-extrabold">รุ่น</th>
                        <th className="px-1.5 py-1.5 text-center font-extrabold">พิกัด</th>
                        <th className="px-2 py-1.5 text-left font-extrabold">ชื่อพนักงานขับรถ</th>
                        <th className="px-2 py-1.5 text-center font-extrabold">สถานที่</th>
                        <th className="px-2 py-1.5 text-center font-extrabold">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-sky-400/15 font-semibold">
                      {mainRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-400"
                          >
                            ยังไม่มีรายการมอบหมายงานใน {teamMeta.teamKey} ({reportShift})
                          </td>
                        </tr>
                      ) : (
                        mainRows.map((row) => (
                          <tr
                            key={row.id}
                            className={
                              row.isLeave
                                ? "bg-amber-50/70 dark:bg-amber-950/25"
                                : "hover:bg-sky-50/50 dark:hover:bg-sky-400/10"
                            }
                          >
                            <td className="px-2 py-1.5 text-center font-mono font-extrabold text-slate-900 dark:text-cyan-300 whitespace-nowrap">
                              {row.vehicleCode}
                            </td>
                            <td className="px-1.5 py-1.5 text-center text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {row.brand}
                            </td>
                            <td className="px-1.5 py-1.5 text-center font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {row.capacity}
                            </td>
                            <td
                              className={`px-2 py-1.5 font-extrabold ${
                                row.isLeave
                                  ? "text-red-600 dark:text-rose-400"
                                  : "text-slate-900 dark:text-white"
                              }`}
                            >
                              {row.driverName}
                            </td>
                            <td className="px-2 py-1.5 text-center text-slate-800 dark:text-sky-200">
                              {row.workArea}
                            </td>
                            <td
                              className={`px-2 py-1.5 text-center font-bold ${
                                row.notes && row.notes !== "-"
                                  ? "text-red-600 dark:text-amber-300"
                                  : "text-slate-400"
                              }`}
                            >
                              {row.notes || "-"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bottom Optional Sub-Sections: รถทดแทน / ใช้รถสำรอง & จอดซ่อม */}
              <div>
                {replacementRows.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between bg-gradient-to-r from-amber-600 to-orange-500 px-3 py-1 text-[11px] font-extrabold text-white">
                      <span>รถทดแทน / ใช้รถสำรอง</span>
                      <span>{replacementRows.length} คัน</span>
                    </div>
                    <table className="w-full border-collapse text-[11px]">
                      <tbody className="divide-y divide-amber-200/70 dark:divide-amber-500/20 bg-amber-50/60 dark:bg-amber-950/20 font-semibold">
                        {replacementRows.map((r) => (
                          <tr key={r.id}>
                            <td className="px-2 py-1.5 text-center font-mono font-extrabold text-slate-900 dark:text-amber-300">
                              {r.vehicleCode}
                            </td>
                            <td className="px-1.5 py-1.5 text-center text-slate-600 dark:text-slate-300">
                              {r.brand}
                            </td>
                            <td className="px-1.5 py-1.5 text-center font-mono text-slate-600 dark:text-slate-300">
                              {r.capacity}
                            </td>
                            <td className="px-2 py-1.5 font-extrabold text-slate-900 dark:text-white">
                              {r.driverName}
                            </td>
                            <td className="px-2 py-1.5 text-center font-bold text-slate-800 dark:text-amber-200">
                              {r.workArea}
                            </td>
                            <td className="px-2 py-1.5 text-center font-bold text-red-600 dark:text-amber-300">
                              {r.notes}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {repairRows.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between bg-gradient-to-r from-red-700 to-red-600 px-3 py-1 text-[11px] font-extrabold text-white">
                      <span>จอดซ่อม</span>
                      <span>{repairRows.length} คัน</span>
                    </div>
                    <table className="w-full border-collapse text-[11px]">
                      <tbody className="divide-y divide-red-200/70 dark:divide-rose-500/20 bg-red-50/40 dark:bg-rose-950/25 font-semibold">
                        {repairRows.map((r) => (
                          <tr key={r.id}>
                            <td className="px-2 py-1.5 text-center font-mono font-extrabold text-red-700 dark:text-rose-300">
                              {r.vehicleCode}
                            </td>
                            <td className="px-1.5 py-1.5 text-center text-slate-600 dark:text-slate-300">
                              {r.brand}
                            </td>
                            <td className="px-1.5 py-1.5 text-center font-mono text-slate-600 dark:text-slate-300">
                              {r.capacity}
                            </td>
                            <td className="px-2 py-1.5 font-extrabold text-slate-900 dark:text-white">
                              {r.driverName}
                            </td>
                            <td className="px-2 py-1.5 text-center font-bold text-red-600 dark:text-rose-300">
                              {r.workArea}
                            </td>
                            <td className="px-2 py-1.5 text-center font-bold text-red-600 dark:text-rose-300">
                              {r.notes}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ===================================================================
          5. BOTTOM FOOTER BAR (หมายเหตุ & SAFETY FIRST BADGE)
      =================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-[#0d1b2a] via-[#13293d] to-[#0d1b2a] px-5 py-3.5 text-white">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-500/15 text-amber-400">
            <FileText size={18} />
          </div>
          <div>
            <div className="text-xs font-extrabold text-amber-400">
              หมายเหตุ ({reportShift})
            </div>
            <ol className="mt-1 space-y-0.5 text-xs font-semibold text-slate-200">
              {config.footerNotes.map((note, idx) => (
                <li key={`fn-${idx}`}>
                  {idx + 1}. {note}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-white/5 px-4 py-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-slate-950 font-black">
            <HardHat size={22} />
          </div>
          <div>
            <div className="text-xs font-extrabold text-amber-400">
              ปลอดภัย ใส่ใจทุกการปฏิบัติงาน
            </div>
            <div className="font-mono text-[10px] font-bold tracking-wider text-slate-300">
              SAFETY FIRST · ACCIDENT FREE OPERATIONS
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-white dark:bg-[#040d21]">
        <div className="flex h-full w-full max-w-none flex-col overflow-hidden bg-white dark:bg-[#040d21]">
          {/* Top Modal Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-sky-400/25 bg-slate-50 dark:bg-[#07183b] px-4 py-2.5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-xs">
                <FileText size={18} />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  หน้ารายงานการปฏิบัติงานรถยกและรถลาก
                </h2>
                <p className="text-[11px] font-medium text-slate-500 dark:text-sky-200/80">
                  ดึงข้อมูลจากตารางวางแผนกำลังคนประจำวันที่ {selectedDate} ({shiftDuties.length} รายการ)
                </p>
              </div>

              {/* Shift Switcher inside Report Modal */}
              <div className="ml-2 inline-flex rounded-xl border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#041029] p-0.5">
                <button
                  type="button"
                  onClick={() => setReportShift("กะเช้า")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-extrabold transition ${
                    reportShift === "กะเช้า"
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  <Sun size={13} />
                  <span>กะเช้า (Day Shift)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReportShift("กะดึก")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-extrabold transition ${
                    reportShift === "กะดึก"
                      ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  <Moon size={13} />
                  <span>กะดึก (Night Shift)</span>
                </button>
              </div>
            </div>

            {/* Right Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {shiftDuties.length > 0 && (
                <button
                  type="button"
                  onClick={() => setUseReferencePreview((prev) => !prev)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition ${
                    useReferencePreview
                      ? "border-sky-500 bg-sky-500 text-white"
                      : "border-slate-300 dark:border-sky-400/35 bg-white dark:bg-[#0b214d] text-slate-700 dark:text-sky-100 hover:bg-slate-100 dark:hover:bg-[#11306b]"
                  }`}
                >
                  <Sparkles size={14} />
                  <span>
                    {useReferencePreview
                      ? "กลับไปดูข้อมูลวางแผนจริง"
                      : "ดูตัวอย่างตามแบบฟอร์มต้นฉบับ"}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsEditingConfig((prev) => !prev)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition ${
                  isEditingConfig
                    ? "border-amber-500 bg-amber-500 text-slate-950"
                    : "border-slate-300 dark:border-sky-400/35 bg-white dark:bg-[#0b214d] text-slate-700 dark:text-sky-100 hover:bg-slate-100 dark:hover:bg-[#11306b]"
                }`}
              >
                <Edit3 size={14} />
                <span>{isEditingConfig ? "ซ่อนตั้งค่ารายงาน" : "ตั้งค่าหัวหน้าทีม / รถสำรอง / หมายเหตุ"}</span>
              </button>

              <button
                type="button"
                onClick={handlePrintReport}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 text-xs font-extrabold text-white shadow-md transition hover:brightness-110 active:scale-95"
              >
                <Printer size={15} />
                <span>พิมพ์รายงาน / PDF</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                aria-label="ปิดหน้ารายงาน"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Expandable Report Configuration Drawer (Edit Team Leads, Spare/Repair Vehicles, Footer Notes) */}
          {isEditingConfig && (
            <div className="border-b border-slate-200 dark:border-sky-400/25 bg-amber-50/60 dark:bg-[#081b42] px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-amber-200/80 dark:border-sky-400/20">
                <div className="flex items-center gap-2 font-extrabold text-amber-900 dark:text-amber-300">
                  <Sparkles size={15} />
                  <span>ปรับแต่งข้อมูลประกอบรายงาน (บันทึกแยกตามวันที่และกะอัตโนมัติ)</span>
                </div>
                <button
                  type="button"
                  onClick={() => updateAndSaveConfig(getDefaultReportConfig())}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-sky-400/30 bg-white dark:bg-[#041029] px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:text-sky-200 hover:bg-slate-50"
                >
                  <RotateCcw size={12} />
                  <span>คืนค่าเริ่มต้นตามแบบฟอร์ม</span>
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                {/* Team A Settings */}
                <div className="space-y-1.5 rounded-xl border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#041029] p-2.5">
                  <div className="font-extrabold text-orange-600 dark:text-amber-300">ตั้งค่า ทีม A</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">ชื่อหัวข้อทีม A</label>
                      <input
                        type="text"
                        value={config.teamATitle}
                        onChange={(e) =>
                          updateAndSaveConfig((prev) => ({ ...prev, teamATitle: e.target.value }))
                        }
                        className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#071739] px-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">หัวหน้าทีม A</label>
                      <input
                        type="text"
                        value={config.teamALead}
                        onChange={(e) =>
                          updateAndSaveConfig((prev) => ({ ...prev, teamALead: e.target.value }))
                        }
                        className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#071739] px-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Team B Settings */}
                <div className="space-y-1.5 rounded-xl border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#041029] p-2.5">
                  <div className="font-extrabold text-orange-600 dark:text-amber-300">ตั้งค่า ทีม B</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">ชื่อหัวข้อทีม B</label>
                      <input
                        type="text"
                        value={config.teamBTitle}
                        onChange={(e) =>
                          updateAndSaveConfig((prev) => ({ ...prev, teamBTitle: e.target.value }))
                        }
                        className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#071739] px-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">หัวหน้าทีม B</label>
                      <input
                        type="text"
                        value={config.teamBLead}
                        onChange={(e) =>
                          updateAndSaveConfig((prev) => ({ ...prev, teamBLead: e.target.value }))
                        }
                        className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#071739] px-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Team C Settings */}
                <div className="space-y-1.5 rounded-xl border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#041029] p-2.5">
                  <div className="font-extrabold text-orange-600 dark:text-amber-300">ตั้งค่า ทีม C</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">ชื่อหัวข้อทีม C</label>
                      <input
                        type="text"
                        value={config.teamCTitle}
                        onChange={(e) =>
                          updateAndSaveConfig((prev) => ({ ...prev, teamCTitle: e.target.value }))
                        }
                        className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#071739] px-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">หัวหน้าทีม C</label>
                      <input
                        type="text"
                        value={config.teamCLead}
                        onChange={(e) =>
                          updateAndSaveConfig((prev) => ({ ...prev, teamCLead: e.target.value }))
                        }
                        className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#071739] px-2 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Remarks & Recruit Status Line */}
              <div className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-4">
                {config.footerNotes.map((note, idx) => (
                  <div key={`edit-note-${idx}`}>
                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      หมายเหตุท้ายรายงาน ข้อ {idx + 1}
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateAndSaveConfig((prev) => {
                          const nextNotes = [...prev.footerNotes];
                          nextNotes[idx] = val;
                          return { ...prev, footerNotes: nextNotes };
                        });
                      }}
                      className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#041029] px-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    ข้อความแถบสรุปพนักงาน (ด้านล่างขวา)
                  </label>
                  <input
                    type="text"
                    value={config.replacementRecruitText}
                    onChange={(e) =>
                      updateAndSaveConfig((prev) => ({
                        ...prev,
                        replacementRecruitText: e.target.value,
                      }))
                    }
                    className="mt-0.5 h-7 w-full rounded border border-slate-300 dark:border-sky-400/30 bg-white dark:bg-[#041029] px-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Main Scrollable Report Sheet Body (Full-Screen Edge-to-Edge) */}
          <div className="flex-1 overflow-y-auto bg-[#f4f6f9] dark:bg-[#040d21]">
            {renderReportSheetContent(false)}
          </div>
        </div>
      </div>

      {/* Dedicated Print Portal for A4/A3 Landscape PDF & Printing */}
      {typeof document !== "undefined" &&
        createPortal(
          <div id="mh-daily-report-print-portal" className="hidden print:block">
            {renderReportSheetContent(true)}
          </div>,
          document.body
        )}

      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 5mm;
          }
          body.printing-mh-daily-report > *:not(#mh-daily-report-print-portal) {
            display: none !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal {
            display: block !important;
            position: static !important;
            width: 100% !important;
            background: #ffffff !important;
            color: #0f172a !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body.printing-mh-daily-report .print-sheet-container {
            zoom: 0.72;
            box-shadow: none !important;
          }
        }
      `}</style>
    </>
  );
};
