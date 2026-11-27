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
import { isElectricTractorVehicle, isForkliftVehicle } from "../utils/vehicleHelpers";
import {
  MhDailyDutyRecord,
  MhMaintenanceRecord,
  subscribeToMhMaintenance,
} from "../services/forkliftDataService";
import reportTractorEvImg from "../assets/images/report_tractor_ev_blue_1795748618171.jpg";
import reportForkliftFlImg from "../assets/images/report_forklift_fl_1795747910218.jpg";
import reportClampTruckScImg from "../assets/images/report_clamp_sc_grapple_1795748637295.jpg";

// Primary reference white compact tow tractor photo (TT) & studio-matched models (Blue TTEV, FL, Wheeled Grapple SC)
const REPORT_TRACTOR_TT_IMG = "/assets/aistudio/Screenshot_1_dd1b8f5b.jpg";

interface ReportVehicleVisual {
  src: string;
  alt: string;
  shortLabel: string;
}

const REPORT_VEHICLE_VISUALS: Record<
  "Forklift" | "Tractor (EV)" | "Tractor" | "SC",
  ReportVehicleVisual
> = {
  Forklift: {
    src: reportForkliftFlImg,
    alt: "รถโฟล์คลิฟท์ Forklift (FL) แสดงเสายกและงาหน้า",
    shortLabel: "FL",
  },
  "Tractor (EV)": {
    src: reportTractorEvImg,
    alt: "รถลากไฟฟ้า Tractor (EV) สีฟ้า BYD T250",
    shortLabel: "TTEV",
  },
  Tractor: {
    src: REPORT_TRACTOR_TT_IMG,
    alt: "รถลาก Tractor (TT) สีขาว กระจกหน้าบานใหญ่ ไฟไซเรนสีส้ม",
    shortLabel: "TT",
  },
  SC: {
    src: reportClampTruckScImg,
    alt: "รถคีบ SC ล้อยาง แขนบูมไฮดรอลิกพร้อมหัวคีบเหล็ก",
    shortLabel: "SC",
  },
};

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
    else if (cleanCode.startsWith("TTEV")) brand = "BYD (EV)";
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

  const isEvByRule = isElectricTractorVehicle({
    vehicleId: cleanCode,
    vehicleType: matchedVehicle?.vehicleType,
    description: matchedVehicle?.description,
  });

  if (isEvByRule) {
    category = "Tractor (EV)";
    areaTableCategory = "Tractor";
  } else if (
    isForkliftVehicle({
      vehicleId: cleanCode,
      vehicleType: matchedVehicle?.vehicleType,
    })
  ) {
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

function getReportVehicleVisualByCode(
  vehicleCode: string,
  brandHint: string | undefined,
  vehicles: Vehicle[]
): ReportVehicleVisual | null {
  const cleanCode = String(vehicleCode || "").trim().toUpperCase();
  if (!cleanCode || cleanCode === "-") return null;

  const spec = resolveVehicleSpecFromFleet(cleanCode, vehicles);
  const hintUpper = String(brandHint || "").trim().toUpperCase();

  if (spec.category === "Forklift" || cleanCode.startsWith("FL")) {
    return REPORT_VEHICLE_VISUALS.Forklift;
  }
  if (
    spec.category === "SC" ||
    cleanCode.startsWith("SC") ||
    hintUpper.includes("XINYUAN")
  ) {
    return REPORT_VEHICLE_VISUALS.SC;
  }
  if (
    spec.category === "Tractor (EV)" ||
    cleanCode.startsWith("TTEV") ||
    hintUpper.includes("BYD") ||
    hintUpper.includes("EV")
  ) {
    return REPORT_VEHICLE_VISUALS["Tractor (EV)"];
  }
  return REPORT_VEHICLE_VISUALS.Tractor;
}

function getReportVehicleVisualForAreaRow(
  category: string,
  brand: string
): ReportVehicleVisual {
  const brandUpper = String(brand || "").toUpperCase();
  if (category === "Forklift") return REPORT_VEHICLE_VISUALS.Forklift;
  if (category === "รถคีบ" || brandUpper.includes("XINYUAN")) {
    return REPORT_VEHICLE_VISUALS.SC;
  }
  if (brandUpper.includes("BYD") || brandUpper.includes("EV")) {
    return REPORT_VEHICLE_VISUALS["Tractor (EV)"];
  }
  return REPORT_VEHICLE_VISUALS.Tractor;
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
      className={`min-h-full w-full flex flex-col justify-between bg-[#f4f6f8] dark:bg-[#040d21] text-slate-900 dark:text-slate-100 overflow-hidden font-sans ${
        forPrint ? "print-sheet-container border-0 shadow-none bg-white text-slate-900" : ""
      }`}
    >
      {/* ===================================================================
          1. TOP REPORT EXECUTIVE BANNER (SAP FIORI STRUCTURED HEADER)
      =================================================================== */}
      <div className="bg-gradient-to-r from-[#0f2537] via-[#13324a] to-[#0f2537] px-4 py-3 sm:px-6 text-white border-b-[3px] border-amber-500">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Shift Icon + Structured Title & Shift Metadata */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${
                isMorning
                  ? "border-amber-300/60 bg-amber-500/20 text-amber-300"
                  : "border-sky-300/60 bg-sky-500/20 text-sky-300"
              }`}
            >
              {isMorning ? <Sun size={24} strokeWidth={2.2} /> : <Moon size={22} strokeWidth={2.2} />}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
                  รายงานการปฏิบัติงานรถยกและรถลาก
                </h1>
                <span className="font-mono text-[11px] font-bold text-amber-300/90">
                  Rev.00
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
                <span className={isMorning ? "text-amber-300 font-bold" : "text-sky-300 font-bold"}>
                  {shiftTitle}
                </span>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-slate-200">
                  <Clock size={12} className="text-slate-300 shrink-0" />
                  <span>{shiftTimeText}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Right: Structured Report Date Block */}
          <div className="flex items-center gap-2.5 rounded-lg border border-white/20 bg-white/10 px-3.5 py-2 text-white shrink-0">
            <Calendar size={18} className="text-amber-300 shrink-0" />
            <div className="leading-tight">
              <div className="text-[10.5px] font-semibold text-slate-300">วันที่ปฏิบัติงาน</div>
              <div className="font-mono text-base sm:text-lg font-extrabold tracking-tight tabular-nums text-white">
                {formatReportShortDate(selectedDate)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================
          2. UPPER SUMMARY SECTION (2 CLEAN SAP FIORI ROWS)
      =================================================================== */}
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        {/* ROW A: 5 EQUAL VEHICLE SUMMARY CARDS (FULL WIDTH, ZERO OVERFLOW) */}
        <div className="report-vehicle-cards-grid grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Card 1: รถทั้งหมด */}
          <div className="flex flex-col justify-between overflow-hidden rounded-lg border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#071739] shadow-2xs">
            <div className="flex items-center justify-between bg-[#0f2537] dark:bg-[#0b234d] px-3 py-1.5 text-xs font-extrabold text-white">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Truck size={13} className="text-amber-400 shrink-0" />
                <span>รถทั้งหมด</span>
              </span>
              <span className="font-mono text-[11px] font-bold text-slate-300 tabular-nums">
                ALL
              </span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-between px-3 py-2.5 text-center">
              <div className="flex items-baseline justify-center gap-1.5 py-1">
                <span className="font-mono text-3xl font-black leading-none text-slate-900 dark:text-white tabular-nums">
                  {areaVehicleSummary.grandTotal}
                </span>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-300">
                  คัน
                </span>
              </div>
              {/* 4-Vehicle Fleet Preview Strip in 1 clean row */}
              <div className="mt-2 grid w-full grid-cols-4 gap-1">
                {(["Forklift", "Tractor (EV)", "Tractor", "SC"] as const).map((catKey) => {
                  const vis = REPORT_VEHICLE_VISUALS[catKey];
                  return (
                    <div
                      key={`fleet-mini-${catKey}`}
                      className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded border border-slate-200 dark:border-slate-600/60 bg-white p-0.5"
                    >
                      <img
                        src={vis.src}
                        alt={vis.alt}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-contain select-none"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-sky-400/20 border-t border-slate-200 dark:border-sky-400/20 text-[11px] font-bold">
              <div className="flex items-center justify-between gap-1 whitespace-nowrap bg-emerald-50/90 dark:bg-emerald-950/45 px-2.5 py-1.5 text-emerald-800 dark:text-emerald-300">
                <span>ปกติ</span>
                <span className="font-mono font-extrabold tabular-nums">
                  {areaVehicleSummary.totalNormal}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 whitespace-nowrap bg-rose-50/90 dark:bg-rose-950/45 px-2.5 py-1.5 text-rose-700 dark:text-rose-300">
                <span>จอดซ่อม</span>
                <span className="font-mono font-extrabold tabular-nums">
                  {areaVehicleSummary.totalBroken}
                </span>
              </div>
            </div>
          </div>

          {/* Cards 2-5: Forklift (FL), Tractor (EV), Tractor (TT), SC (รถคีบ) */}
          {(
            [
              {
                key: "fl",
                title: "Forklift (FL)",
                visual: REPORT_VEHICLE_VISUALS.Forklift,
                stats: areaVehicleSummary.cards.fl,
              },
              {
                key: "ev",
                title: "Tractor (EV)",
                visual: REPORT_VEHICLE_VISUALS["Tractor (EV)"],
                stats: areaVehicleSummary.cards.ev,
              },
              {
                key: "tractor",
                title: "Tractor (TT)",
                visual: REPORT_VEHICLE_VISUALS.Tractor,
                stats: areaVehicleSummary.cards.tractor,
              },
              {
                key: "sc",
                title: "SC (รถคีบ)",
                visual: REPORT_VEHICLE_VISUALS.SC,
                stats: areaVehicleSummary.cards.sc,
              },
            ] as const
          ).map((card) => (
            <div
              key={`summary-card-${card.key}`}
              className="flex flex-col justify-between overflow-hidden rounded-lg border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#071739] shadow-2xs"
            >
              <div className="flex items-center justify-between bg-[#0a6ed1] dark:bg-[#0e4280] px-3 py-1.5 text-xs font-extrabold text-white">
                <span className="whitespace-nowrap">{card.title}</span>
                <span className="font-mono text-xs font-black tabular-nums whitespace-nowrap">
                  {card.stats.total} คัน
                </span>
              </div>
              <div className="flex flex-1 items-center justify-center p-2.5">
                <div className="flex h-[84px] w-full items-center justify-center overflow-hidden rounded-md border border-slate-200/80 dark:border-slate-600/60 bg-white p-1.5">
                  <img
                    src={card.visual.src}
                    alt={card.visual.alt}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain select-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-sky-400/20 border-t border-slate-200 dark:border-sky-400/20 text-[11px] font-bold">
                <div className="flex items-center justify-between gap-1 whitespace-nowrap bg-emerald-50/90 dark:bg-emerald-950/45 px-2.5 py-1.5 text-emerald-800 dark:text-emerald-300">
                  <span>ปกติ</span>
                  <span className="font-mono font-extrabold tabular-nums">
                    {card.stats.normal}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 whitespace-nowrap bg-rose-50/90 dark:bg-rose-950/45 px-2.5 py-1.5 text-rose-700 dark:text-rose-300">
                  <span>จอดซ่อม</span>
                  <span className="font-mono font-extrabold tabular-nums">
                    {card.stats.broken}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ROW B: 3 BALANCED SUMMARY TABLES (12-COL SAP FIORI GRID) */}
        <div className="report-summary-tables-grid grid grid-cols-1 gap-3 lg:grid-cols-12">
          {/* BLOCK 2: ประจำพื้นที่ | แยกประเภทรถและรุ่น (lg:col-span-5) */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#071739] shadow-2xs lg:col-span-5">
            <div className="flex h-9 items-center justify-between bg-[#0f2537] dark:bg-[#0b234d] px-3.5 text-xs font-extrabold text-white">
              <span>ประจำพื้นที่</span>
              <span className="text-[11px] font-semibold text-sky-200">แยกประเภทรถและรุ่น</span>
            </div>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-sky-400/20 bg-slate-100 dark:bg-[#09204f] text-[11px] font-bold text-slate-700 dark:text-sky-100">
                    <th className="px-3 py-1.5 text-left whitespace-nowrap">ประเภทรถ</th>
                    <th className="px-2.5 py-1.5 text-left whitespace-nowrap">รุ่น</th>
                    <th className="w-16 bg-emerald-700 px-2 py-1.5 text-center text-white whitespace-nowrap">ปกติ</th>
                    <th className="w-16 bg-rose-600 px-2 py-1.5 text-center text-white whitespace-nowrap">จอดซ่อม</th>
                    <th className="w-16 bg-[#0a6ed1] px-2 py-1.5 text-center text-white whitespace-nowrap">รวม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-sky-400/15 font-medium">
                  {areaVehicleSummary.rows.map((r, idx) => {
                    const showCategory =
                      idx === 0 ||
                      areaVehicleSummary.rows[idx - 1].category !== r.category;
                    const rowVisual = getReportVehicleVisualForAreaRow(r.category, r.brand);
                    return (
                      <tr
                        key={`area-model-${r.brand}`}
                        className="hover:bg-slate-50 dark:hover:bg-sky-400/10"
                      >
                        <td className="px-3 py-1.5 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {showCategory ? r.category : ""}
                        </td>
                        <td className="px-2.5 py-1.5 text-left text-slate-700 dark:text-slate-200">
                          <div className="inline-flex items-center gap-2">
                            <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 dark:border-slate-600/70 bg-white p-0.5">
                              <img
                                src={rowVisual.src}
                                alt={rowVisual.alt}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-contain select-none"
                              />
                            </span>
                            <span className="whitespace-nowrap font-semibold">{r.brand}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {r.normal}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                          {r.broken}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono font-extrabold text-slate-900 dark:text-white tabular-nums">
                          {r.total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-sky-400/30 bg-slate-100 dark:bg-[#09204f] font-extrabold">
                    <td colSpan={2} className="px-3 py-1.5 text-right text-slate-800 dark:text-white">
                      รวมทั้งหมด
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {areaVehicleSummary.totalNormal}
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono text-rose-600 dark:text-rose-300 tabular-nums">
                      {areaVehicleSummary.totalBroken}
                    </td>
                    <td className="bg-[#0a6ed1] px-2 py-1.5 text-center font-mono text-white tabular-nums">
                      {areaVehicleSummary.grandTotal}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* BLOCK 3: รถสำรอง & จอดซ่อม (lg:col-span-4) */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#071739] shadow-2xs lg:col-span-4">
            <div className="flex h-9 items-center justify-between bg-emerald-700 px-3.5 text-xs font-extrabold text-white">
              <span>รถสำรอง</span>
              <span className="font-mono tabular-nums">{config.spareVehicles.length} คัน</span>
            </div>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-sky-400/20 bg-slate-100 dark:bg-[#09204f] text-[11px] font-bold text-slate-700 dark:text-sky-100">
                    <th className="px-2.5 py-1.5 text-left whitespace-nowrap">รหัสรถ</th>
                    <th className="px-2 py-1.5 text-left whitespace-nowrap">รุ่น</th>
                    <th className="px-2 py-1.5 text-center whitespace-nowrap">พิกัด</th>
                    <th className="px-2.5 py-1.5 text-left whitespace-nowrap">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-sky-400/15 font-medium">
                  {config.spareVehicles.map((sp) => {
                    const spVis = getReportVehicleVisualByCode(
                      sp.vehicleCode,
                      sp.brand,
                      vehicles
                    );
                    return (
                      <tr key={sp.id} className="hover:bg-slate-50 dark:hover:bg-sky-400/10">
                        <td className="px-2.5 py-1.5 font-mono font-bold text-emerald-800 dark:text-emerald-300 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {spVis && (
                              <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 dark:border-slate-600/70 bg-white p-0.5">
                                <img
                                  src={spVis.src}
                                  alt={spVis.alt}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-contain select-none"
                                />
                              </span>
                            )}
                            <span>{sp.vehicleCode}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-left text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          {sp.brand}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          {sp.capacity}
                        </td>
                        <td className="px-2.5 py-1.5 text-left text-slate-600 dark:text-slate-300">
                          {sp.notes}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Sub-header: จอดซ่อม */}
              <div className="flex h-8 items-center justify-between border-t border-slate-200 dark:border-sky-400/20 bg-rose-700 px-3.5 text-xs font-extrabold text-white">
                <span>จอดซ่อม</span>
                <span className="font-mono tabular-nums">{config.repairVehicles.length} คัน</span>
              </div>
              <table className="w-full border-collapse text-[11.5px]">
                <tbody className="divide-y divide-slate-200/80 dark:divide-sky-400/15 font-medium">
                  {config.repairVehicles.map((rp) => {
                    const rpVis = getReportVehicleVisualByCode(
                      rp.vehicleCode,
                      rp.brand,
                      vehicles
                    );
                    return (
                      <tr key={rp.id} className="bg-rose-50/40 dark:bg-rose-950/20">
                        <td className="px-2.5 py-1.5 font-mono font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {rpVis && (
                              <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 dark:border-slate-600/70 bg-white p-0.5">
                                <img
                                  src={rpVis.src}
                                  alt={rpVis.alt}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-contain select-none"
                                />
                              </span>
                            )}
                            <span>{rp.vehicleCode}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-left text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          {rp.brand}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          {rp.capacity}
                        </td>
                        <td className="px-2.5 py-1.5 text-left font-semibold text-rose-700 dark:text-rose-300">
                          {rp.notes}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* BLOCK 4: พนักงานทั้งหมด ณ วันนี้ (lg:col-span-3) */}
          <div className="flex flex-col justify-between overflow-hidden rounded-lg border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#071739] shadow-2xs lg:col-span-3">
            <div>
              <div className="flex h-9 items-center gap-2 bg-[#0f4c5c] dark:bg-[#0d3b52] px-3.5 text-xs font-extrabold text-white">
                <Users size={14} className="shrink-0" />
                <span>พนักงานทั้งหมด ณ วันนี้</span>
              </div>
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-sky-400/20 bg-slate-100 dark:bg-[#09204f] text-[11px] font-bold text-slate-700 dark:text-sky-100">
                    <th className="px-3 py-1.5 text-left whitespace-nowrap">รายการ</th>
                    <th className="w-16 px-2 py-1.5 text-right whitespace-nowrap">จำนวน</th>
                    <th className="w-14 px-2.5 py-1.5 text-center whitespace-nowrap">หน่วย</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-sky-400/15 font-semibold">
                  <tr>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      พนักงานทั้งหมด
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                      {manpowerSummary.totalStaff}
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-500 dark:text-slate-300">คน</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      พนักงานลา
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-black text-rose-600 dark:text-rose-400 tabular-nums">
                      {manpowerSummary.leaveStaff}
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-500 dark:text-slate-300">คน</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      พนักงานมาปฏิบัติงาน
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {manpowerSummary.workingStaff}
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-500 dark:text-slate-300">คน</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      ออกโอที
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                      {manpowerSummary.earlyExitCount}
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-500 dark:text-slate-300">คน</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      ปฏิบัติงานช่วง OT
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums">
                      {manpowerSummary.otWorkCount}
                    </td>
                    <td className="px-2.5 py-2 text-center text-slate-500 dark:text-slate-300">คน</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 dark:border-sky-400/20 bg-[#0f4c5c] dark:bg-[#0d3b52] px-3 py-2 text-center text-xs font-extrabold text-white">
              {config.replacementRecruitText}
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================
          3. SECTION DIVIDER BAR
      =================================================================== */}
      <div className="mx-3 sm:mx-4 flex items-center justify-between rounded-lg border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#071739] px-4 py-2 text-slate-900 dark:text-white shadow-2xs">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-extrabold tracking-tight">
          <Truck size={15} className="text-[#0a6ed1] dark:text-sky-400 shrink-0" />
          <span>
            แผนการทำงานประจำวัน · {shiftTitle} (ตารางทีม A / B / C)
          </span>
        </div>
        <span className="hidden sm:inline font-mono text-[11px] font-semibold text-slate-500 dark:text-sky-200/80 tabular-nums">
          {formatReportShortDate(selectedDate)}
        </span>
      </div>

      {/* ===================================================================
          4. THREE TEAM COLUMNS (ทีม A / ทีม B / ทีม C)
      =================================================================== */}
      <div className="report-teams-grid flex-1 grid grid-cols-1 gap-3 p-3 sm:p-4 lg:grid-cols-3">
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
              className="flex flex-col justify-between overflow-hidden rounded-lg border border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#071739] shadow-2xs"
            >
              <div>
                {/* Team Card Header */}
                <div className="flex h-9 items-center justify-between bg-[#0f2537] dark:bg-[#0b234d] px-3.5 text-white">
                  <span className="text-xs sm:text-sm font-extrabold tracking-tight truncate">
                    {teamMeta.title}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-amber-300 shrink-0 ml-2">
                    {reportShift}
                  </span>
                </div>

                {/* Team Lead, Area & 6 Compact Single-Line KPI Cells */}
                <div className="border-b border-slate-200 dark:border-sky-400/20 bg-slate-50/80 dark:bg-[#09204f]/60 px-3.5 py-2.5 text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <div className="font-bold text-slate-900 dark:text-white">
                      <span className="text-slate-500 dark:text-slate-400 font-semibold">หัวหน้าทีม:</span>{" "}
                      {teamMeta.lead}
                    </div>
                    <div className="font-bold text-slate-700 dark:text-sky-200">
                      <span className="text-slate-500 dark:text-slate-400 font-semibold">พื้นที่:</span>{" "}
                      {teamMeta.area}
                    </div>
                  </div>

                  {/* 6 Uniform KPI Boxes */}
                  <div className="mt-2 grid grid-cols-6 gap-1 text-center">
                    <div className="rounded border border-emerald-200 dark:border-emerald-500/35 bg-emerald-50/80 dark:bg-emerald-950/45 py-1 px-0.5">
                      <div className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 whitespace-nowrap">
                        ปกติ
                      </div>
                      <div className="font-mono text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums leading-tight">
                        {stats.normalVehiclesCount}
                      </div>
                    </div>
                    <div className="rounded border border-rose-200 dark:border-rose-500/35 bg-rose-50/80 dark:bg-rose-950/45 py-1 px-0.5">
                      <div className="text-[10px] font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap">
                        จอดซ่อม
                      </div>
                      <div className="font-mono text-sm font-black text-rose-600 dark:text-rose-300 tabular-nums leading-tight">
                        {stats.repairVehiclesCount}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 dark:border-slate-600/70 bg-white dark:bg-[#041029] py-1 px-0.5">
                      <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        ทั้งหมด
                      </div>
                      <div className="font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums leading-tight">
                        {stats.totalVehiclesCount}
                      </div>
                    </div>
                    <div className="rounded border border-teal-200 dark:border-teal-500/35 bg-teal-50/80 dark:bg-teal-950/45 py-1 px-0.5">
                      <div className="text-[10px] font-bold text-teal-800 dark:text-teal-300 whitespace-nowrap">
                        มาทำงาน
                      </div>
                      <div className="font-mono text-sm font-black text-teal-700 dark:text-teal-300 tabular-nums leading-tight">
                        {stats.activeEmpCount}
                      </div>
                    </div>
                    <div className="rounded border border-rose-200 dark:border-rose-500/35 bg-rose-50/80 dark:bg-rose-950/45 py-1 px-0.5">
                      <div className="text-[10px] font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap">
                        ลา
                      </div>
                      <div className="font-mono text-sm font-black text-rose-600 dark:text-rose-300 tabular-nums leading-tight">
                        {stats.leaveEmpCount}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 dark:border-slate-600/70 bg-white dark:bg-[#041029] py-1 px-0.5">
                      <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        พนง.รวม
                      </div>
                      <div className="font-mono text-sm font-black text-slate-900 dark:text-white tabular-nums leading-tight">
                        {stats.totalEmpCount}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Team Assignment Table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-sky-400/20 bg-slate-100 dark:bg-[#041029] text-slate-700 dark:text-sky-100">
                        <th className="px-2 py-1.5 text-left font-bold whitespace-nowrap">ทะเบียนรถ</th>
                        <th className="px-1.5 py-1.5 text-left font-bold whitespace-nowrap">รุ่น</th>
                        <th className="px-1.5 py-1.5 text-center font-bold whitespace-nowrap">พิกัด</th>
                        <th className="px-2 py-1.5 text-left font-bold whitespace-nowrap">ชื่อพนักงานขับรถ</th>
                        <th className="px-2 py-1.5 text-center font-bold whitespace-nowrap">สถานที่</th>
                        <th className="px-2 py-1.5 text-left font-bold whitespace-nowrap">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 dark:divide-sky-400/15 font-medium">
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
                        mainRows.map((row) => {
                          const rowVis = getReportVehicleVisualByCode(
                            row.vehicleCode,
                            row.brand,
                            vehicles
                          );
                          return (
                            <tr
                              key={row.id}
                              className={
                                row.isLeave
                                  ? "bg-amber-50/70 dark:bg-amber-950/25"
                                  : "hover:bg-slate-50 dark:hover:bg-sky-400/10"
                              }
                            >
                              <td className="px-2 py-1.5 font-mono font-bold text-slate-900 dark:text-cyan-300 whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {rowVis ? (
                                    <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 dark:border-slate-600/70 bg-white p-0.5">
                                      <img
                                        src={rowVis.src}
                                        alt={rowVis.alt}
                                        referrerPolicy="no-referrer"
                                        className="h-full w-full object-contain select-none"
                                      />
                                    </span>
                                  ) : (
                                    <span className="inline-block w-7 shrink-0 text-center text-slate-400">
                                      -
                                    </span>
                                  )}
                                  <span>{row.vehicleCode}</span>
                                </div>
                              </td>
                              <td className="px-1.5 py-1.5 text-left text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {row.brand}
                              </td>
                              <td className="px-1.5 py-1.5 text-center font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                                {row.capacity}
                              </td>
                              <td
                                className={`px-2 py-1.5 font-bold ${
                                  row.isLeave
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-slate-900 dark:text-white"
                                }`}
                              >
                                {row.driverName}
                              </td>
                              <td className="px-2 py-1.5 text-center text-slate-800 dark:text-sky-200">
                                {row.workArea}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-left font-semibold ${
                                  row.notes && row.notes !== "-"
                                    ? "text-rose-600 dark:text-amber-300"
                                    : "text-slate-400"
                                }`}
                              >
                                {row.notes || "-"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bottom Optional Sub-Sections: รถทดแทน / ใช้รถสำรอง & จอดซ่อม */}
              <div>
                {replacementRows.length > 0 && (
                  <div className="border-t border-slate-200 dark:border-sky-400/20">
                    <div className="flex items-center justify-between bg-amber-600 px-3 py-1 text-[11px] font-extrabold text-white">
                      <span>รถทดแทน / ใช้รถสำรอง</span>
                      <span className="font-mono tabular-nums">{replacementRows.length} คัน</span>
                    </div>
                    <table className="w-full border-collapse text-[11px]">
                      <tbody className="divide-y divide-amber-200/70 dark:divide-amber-500/20 bg-amber-50/50 dark:bg-amber-950/20 font-medium">
                        {replacementRows.map((r) => {
                          const repVis = getReportVehicleVisualByCode(
                            r.vehicleCode,
                            r.brand,
                            vehicles
                          );
                          return (
                            <tr key={r.id}>
                              <td className="px-2 py-1.5 font-mono font-bold text-slate-900 dark:text-amber-300 whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {repVis && (
                                    <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 dark:border-slate-600/70 bg-white p-0.5">
                                      <img
                                        src={repVis.src}
                                        alt={repVis.alt}
                                        referrerPolicy="no-referrer"
                                        className="h-full w-full object-contain select-none"
                                      />
                                    </span>
                                  )}
                                  <span>{r.vehicleCode}</span>
                                </div>
                              </td>
                              <td className="px-1.5 py-1.5 text-left text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {r.brand}
                              </td>
                              <td className="px-1.5 py-1.5 text-center font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                                {r.capacity}
                              </td>
                              <td className="px-2 py-1.5 font-bold text-slate-900 dark:text-white">
                                {r.driverName}
                              </td>
                              <td className="px-2 py-1.5 text-center font-semibold text-slate-800 dark:text-amber-200">
                                {r.workArea}
                              </td>
                              <td className="px-2 py-1.5 text-left font-semibold text-rose-600 dark:text-amber-300">
                                {r.notes}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {repairRows.length > 0 && (
                  <div className="border-t border-slate-200 dark:border-sky-400/20">
                    <div className="flex items-center justify-between bg-rose-700 px-3 py-1 text-[11px] font-extrabold text-white">
                      <span>จอดซ่อม</span>
                      <span className="font-mono tabular-nums">{repairRows.length} คัน</span>
                    </div>
                    <table className="w-full border-collapse text-[11px]">
                      <tbody className="divide-y divide-rose-200/70 dark:divide-rose-500/20 bg-rose-50/40 dark:bg-rose-950/25 font-medium">
                        {repairRows.map((r) => {
                          const bVis = getReportVehicleVisualByCode(
                            r.vehicleCode,
                            r.brand,
                            vehicles
                          );
                          return (
                            <tr key={r.id}>
                              <td className="px-2 py-1.5 font-mono font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {bVis && (
                                    <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 dark:border-slate-600/70 bg-white p-0.5">
                                      <img
                                        src={bVis.src}
                                        alt={bVis.alt}
                                        referrerPolicy="no-referrer"
                                        className="h-full w-full object-contain select-none"
                                      />
                                    </span>
                                  )}
                                  <span>{r.vehicleCode}</span>
                                </div>
                              </td>
                              <td className="px-1.5 py-1.5 text-left text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {r.brand}
                              </td>
                              <td className="px-1.5 py-1.5 text-center font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                                {r.capacity}
                              </td>
                              <td className="px-2 py-1.5 font-bold text-slate-900 dark:text-white">
                                {r.driverName}
                              </td>
                              <td className="px-2 py-1.5 text-center font-semibold text-rose-600 dark:text-rose-300">
                                {r.workArea}
                              </td>
                              <td className="px-2 py-1.5 text-left font-semibold text-rose-600 dark:text-rose-300">
                                {r.notes}
                              </td>
                            </tr>
                          );
                        })}
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
          5. BOTTOM FOOTER BAR (หมายเหตุ & SAFETY FIRST)
      =================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 dark:border-sky-400/20 bg-[#0f2537] px-5 py-3 text-white">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-400/40 bg-amber-500/15 text-amber-400">
            <FileText size={16} />
          </div>
          <div>
            <div className="text-xs font-extrabold text-amber-300">
              หมายเหตุ ({reportShift})
            </div>
            <ol className="mt-0.5 space-y-0.5 text-[11.5px] font-medium text-slate-200">
              {config.footerNotes.map((note, idx) => (
                <li key={`fn-${idx}`}>
                  {idx + 1}. {note}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 shrink-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500 text-slate-950">
            <HardHat size={18} />
          </div>
          <div>
            <div className="text-xs font-extrabold text-amber-300">
              ปลอดภัย ใส่ใจทุกการปฏิบัติงาน
            </div>
            <div className="font-mono text-[10px] font-semibold tracking-wide text-slate-300">
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
          {/* Top Modal Toolbar — SAP Fiori Object Page Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-sky-400/25 bg-white dark:bg-[#07183b] px-4 py-2.5 sm:px-6 shrink-0">
            {/* Left: Report Title + Quiet Context Metadata */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#0a6ed1] text-white">
                <FileText size={17} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                  หน้ารายงานการปฏิบัติงานรถยกและรถลาก
                </h2>
                <p className="text-[11.5px] font-medium text-slate-500 dark:text-sky-200/80 truncate">
                  ข้อมูลวางแผนกำลังคนประจำวันที่{" "}
                  <span className="font-mono tabular-nums">{selectedDate}</span> ·{" "}
                  <span className="font-mono tabular-nums">{shiftDuties.length}</span> รายการ
                </p>
              </div>
            </div>

            {/* Right: Uniform Height (32px) SAP Fiori Action Controls */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Segmented Shift Switcher */}
              <div className="inline-flex h-8 items-center rounded-md border border-slate-300 dark:border-sky-400/30 bg-slate-100 dark:bg-[#041029] p-0.5">
                <button
                  type="button"
                  onClick={() => setReportShift("กะเช้า")}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-bold whitespace-nowrap transition-colors ${
                    reportShift === "กะเช้า"
                      ? "bg-[#0a6ed1] text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  <Sun size={13} />
                  <span>กะเช้า</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReportShift("กะดึก")}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-bold whitespace-nowrap transition-colors ${
                    reportShift === "กะดึก"
                      ? "bg-[#0a6ed1] text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  <Moon size={13} />
                  <span>กะดึก</span>
                </button>
              </div>

              {shiftDuties.length > 0 && (
                <button
                  type="button"
                  onClick={() => setUseReferencePreview((prev) => !prev)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-bold whitespace-nowrap transition-colors ${
                    useReferencePreview
                      ? "border-[#0a6ed1] bg-[#0a6ed1]/10 text-[#0a6ed1] dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400"
                      : "border-slate-300 dark:border-sky-400/35 bg-white dark:bg-[#0b214d] text-slate-700 dark:text-sky-100 hover:bg-slate-50 dark:hover:bg-[#11306b]"
                  }`}
                >
                  <Sparkles size={13} />
                  <span>
                    {useReferencePreview ? "ดูข้อมูลวางแผนจริง" : "ดูตัวอย่างแบบฟอร์ม"}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsEditingConfig((prev) => !prev)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-bold whitespace-nowrap transition-colors ${
                  isEditingConfig
                    ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                    : "border-slate-300 dark:border-sky-400/35 bg-white dark:bg-[#0b214d] text-slate-700 dark:text-sky-100 hover:bg-slate-50 dark:hover:bg-[#11306b]"
                }`}
              >
                <Edit3 size={13} />
                <span>{isEditingConfig ? "ซ่อนตั้งค่า" : "ตั้งค่ารายงาน"}</span>
              </button>

              <button
                type="button"
                onClick={handlePrintReport}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0a6ed1] hover:bg-[#0854a0] px-3.5 text-xs font-bold text-white whitespace-nowrap shadow-2xs transition-colors"
              >
                <Printer size={14} />
                <span>พิมพ์รายงาน / PDF</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                aria-label="ปิดหน้ารายงาน"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <X size={16} />
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
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal .report-vehicle-cards-grid {
            display: grid !important;
            grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
            gap: 8px !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal .report-summary-tables-grid {
            display: grid !important;
            grid-template-columns: repeat(12, minmax(0, 1fr)) !important;
            gap: 8px !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal .report-summary-tables-grid > div:nth-child(1) {
            grid-column: span 5 / span 5 !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal .report-summary-tables-grid > div:nth-child(2) {
            grid-column: span 4 / span 4 !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal .report-summary-tables-grid > div:nth-child(3) {
            grid-column: span 3 / span 3 !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal .report-teams-grid {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 8px !important;
          }
          body.printing-mh-daily-report #mh-daily-report-print-portal img {
            max-width: 100% !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            image-rendering: auto !important;
          }
          body.printing-mh-daily-report .print-sheet-container {
            zoom: 0.68;
            box-shadow: none !important;
          }
        }
      `}</style>
    </>
  );
};
