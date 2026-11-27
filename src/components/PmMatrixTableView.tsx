/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BatteryCharging,
  Bell,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Cog,
  Compass,
  Disc,
  Droplet,
  Droplets,
  Eraser,
  Fan,
  Filter,
  Flame,
  Fuel,
  Gauge,
  Link2,
  Lock,
  ParkingCircle,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Thermometer,
  Truck,
  Volume2,
  Wind,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Vehicle } from "../types/officer";
import {
  MhPmMatrixCategory,
  MhPmMatrixRecord,
  loadCachedMhPmMatrixRecords,
  saveMhPmMatrixRecordToCloud,
  subscribeToMhPmMatrixRecords,
} from "../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import { useAuth } from "../contexts/AuthContext";

interface PmMatrixTableViewProps {
  vehicles: Vehicle[];
  cloudRealtime?: boolean;
}

interface PmMatrixColumn {
  key: string;
  titleLine1: string;
  titleLine2: string;
}

interface PmMatrixRowDef {
  id: string;
  label: string;
  section?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  defaultChecks: string[];
}

interface PmMatrixCategoryConfig {
  id: MhPmMatrixCategory;
  shortLabel: string;
  headerTitle: string;
  subtitle: string;
  columns: PmMatrixColumn[];
  rows: PmMatrixRowDef[];
}

const PM_MATRIX_CONFIGS: Record<MhPmMatrixCategory, PmMatrixCategoryConfig> = {
  forklift: {
    id: "forklift",
    shortLabel: "โฟล์คลิฟท์",
    headerTitle: "ตารางบำรุงรักษาเชิงป้องกัน (PM Schedule) โฟล์คลิฟท์",
    subtitle: "Forklift · รอบบำรุงรักษา D / W / 250H / 500H / 1000H / 2000H",
    columns: [
      { key: "D", titleLine1: "ทุกวัน", titleLine2: "(D)" },
      { key: "W", titleLine1: "ทุกสัปดาห์", titleLine2: "(W)" },
      { key: "250H", titleLine1: "ทุก 250 ชม.", titleLine2: "(250H)" },
      { key: "500H", titleLine1: "ทุก 500 ชม.", titleLine2: "(500H)" },
      { key: "1000H", titleLine1: "ทุก 1000 ชม.", titleLine2: "(1000H)" },
      { key: "2000H", titleLine1: "ทุก 2000 ชม.", titleLine2: "(2000H)" },
    ],
    rows: [
      { id: "fl_01", label: "ตรวจสอบก่อนใช้งาน (ข้อ 1)", icon: ClipboardCheck, defaultChecks: ["D"] },
      { id: "fl_02", label: "เปลี่ยนถ่ายน้ำมันไฮดรอลิก", icon: Droplets, defaultChecks: ["250H", "500H"] },
      { id: "fl_03", label: "เปลี่ยนไส้กรองไฮดรอลิก", icon: Filter, defaultChecks: ["1000H"] },
      { id: "fl_04", label: "ตรวจ / ปรับตั้งโซ่เสา", icon: Link2, defaultChecks: ["250H"] },
      { id: "fl_05", label: "หล่อลื่นโซ่เสา", icon: Droplet, defaultChecks: ["W"] },
      { id: "fl_06", label: "ตรวจสอบระบบเบรก", icon: Disc, defaultChecks: ["W"] },
      { id: "fl_07", label: "ตรวจสอบระบบบังคับเลี้ยว", icon: Compass, defaultChecks: ["250H"] },
      { id: "fl_08", label: "ตรวจสอบระบบไฟฟ้า", icon: Zap, defaultChecks: ["250H"] },
      { id: "fl_09", label: "ตรวจสอบการรั่วซึม (น้ำมัน/ไฮดรอลิก)", icon: Activity, defaultChecks: ["W", "250H"] },
      { id: "fl_10", label: "เปลี่ยนไส้กรองอากาศ", icon: Wind, defaultChecks: ["500H"] },
      { id: "fl_11", label: "เปลี่ยนไส้กรองน้ำมันเครื่อง", icon: Filter, defaultChecks: ["500H"] },
      { id: "fl_12", label: "เปลี่ยนน้ำมันเครื่อง", icon: Droplets, defaultChecks: ["500H"] },
      { id: "fl_13", label: "เปลี่ยนไส้กรองน้ำมันเชื้อเพลิง", icon: Fuel, defaultChecks: ["1000H"] },
      { id: "fl_14", label: "เปลี่ยนหัวเทียน (เครื่องยนต์เบนซิน/LPG)", icon: Flame, defaultChecks: ["1000H"] },
      { id: "fl_15", label: "ตรวจวัด / ปรับตั้งระยะห่างวาล์ว", icon: Sliders, defaultChecks: ["2000H"] },
      { id: "fl_16", label: "ตรวจเช็คหม้อน้ำ / ทำความสะอาด", icon: Thermometer, defaultChecks: ["2000H"] },
      { id: "fl_17", label: "ตรวจสอบระบบไอเสีย", icon: Fan, defaultChecks: ["2000H"] },
      { id: "fl_18", label: "ตรวจสอบโครงสร้าง / สลัก / น็อตทุกจุด", icon: ShieldCheck, defaultChecks: ["2000H"] },
    ],
  },
  ev_tractor: {
    id: "ev_tractor",
    shortLabel: "หัวลากไฟฟ้า",
    headerTitle: "ตารางบำรุงรักษาเชิงป้องกัน (PM Schedule) หัวลากไฟฟ้า",
    subtitle: "Electric Tractor · รอบบำรุงรักษา D / W / 250H / 500H / 1000H",
    columns: [
      { key: "D", titleLine1: "ทุกวัน", titleLine2: "(D)" },
      { key: "W", titleLine1: "ทุกสัปดาห์", titleLine2: "(W)" },
      { key: "250H", titleLine1: "ทุก 250 ชม.", titleLine2: "(250H)" },
      { key: "500H", titleLine1: "ทุก 500 ชม.", titleLine2: "(500H)" },
      { key: "1000H", titleLine1: "ทุก 1000 ชม.", titleLine2: "(1000H)" },
    ],
    rows: [
      { id: "ev_01", label: "ตรวจสอบก่อนใช้งาน (ตามข้อ 1)", icon: ClipboardCheck, defaultChecks: ["D"] },
      { id: "ev_02", label: "ทำความสะอาดรถ", icon: Sparkles, defaultChecks: ["D"] },
      { id: "ev_03", label: "ตรวจสอบความแน่นน็อต / สลัก", icon: Wrench, defaultChecks: ["W"] },
      { id: "ev_04", label: "ตรวจสอบระบบเบรก", icon: Disc, defaultChecks: ["W", "250H"] },
      { id: "ev_05", label: "หล่อลื่นจุดหมุนต่างๆ", icon: Droplet, defaultChecks: ["W"] },
      { id: "ev_06", label: "ตรวจสอบระดับน้ำมันเบรก", icon: Gauge, defaultChecks: ["W", "250H"] },
      { id: "ev_07", label: "ตรวจสอบระดับน้ำหล่อเย็น", icon: Thermometer, defaultChecks: ["250H"] },
      { id: "ev_08", label: "ตรวจสอบน้ำกลั่นแบตเตอรี่", icon: BatteryCharging, defaultChecks: ["W"] },
      { id: "ev_09", label: "ทำความสะอาดขั้วแบตเตอรี่", icon: Zap, defaultChecks: ["W", "250H"] },
      { id: "ev_10", label: "ตรวจสอบ / ปรับตั้งลมยาง", icon: Compass, defaultChecks: ["W", "250H"] },
      { id: "ev_11", label: "เปลี่ยนไส้กรองอากาศ", icon: Wind, defaultChecks: ["250H"] },
      { id: "ev_12", label: "เปลี่ยนไส้กรองไฮดรอลิก", icon: Filter, defaultChecks: ["500H"] },
      { id: "ev_13", label: "เปลี่ยนน้ำมันเกียร์ / ไฮดรอลิก", icon: Droplets, defaultChecks: ["500H"] },
      { id: "ev_14", label: "ตรวจเช็คมอเตอร์ / คอนโทรลเลอร์", icon: Settings, defaultChecks: ["500H"] },
      { id: "ev_15", label: "เปลี่ยนถ่ายน้ำหล่อเย็น", icon: Thermometer, defaultChecks: ["1000H"] },
      { id: "ev_16", label: "ตรวจสอบระบบไฟฟ้าใหญ่", icon: Zap, defaultChecks: ["1000H"] },
      { id: "ev_17", label: "ตรวจสอบระบบเบรกทั้งหมด", icon: ShieldCheck, defaultChecks: ["1000H"] },
    ],
  },
  diesel_tractor: {
    id: "diesel_tractor",
    shortLabel: "หัวลากดีเซล",
    headerTitle: "ตารางบำรุงรักษาเชิงป้องกัน (PM Schedule) หัวลากดีเซล",
    subtitle: "Diesel Tractor · รอบบำรุงรักษา D / W / 250H / 500H / 1000H / 2000H",
    columns: [
      { key: "D", titleLine1: "ทุกวัน", titleLine2: "(D)" },
      { key: "W", titleLine1: "ทุกสัปดาห์", titleLine2: "(W)" },
      { key: "250H", titleLine1: "ทุก 250 ชม.", titleLine2: "(1 เดือน)" },
      { key: "500H", titleLine1: "ทุก 500 ชม.", titleLine2: "(3 เดือน)" },
      { key: "1000H", titleLine1: "ทุก 1000 ชม.", titleLine2: "(6 เดือน)" },
      { key: "2000H", titleLine1: "ทุก 2000 ชม.", titleLine2: "(1 ปี)" },
    ],
    rows: [
      { id: "ds_01", label: "ตรวจสอบรายการประจำวัน (ข้อ 1)", icon: ClipboardCheck, defaultChecks: ["D"] },
      { id: "ds_02", label: "เปลี่ยนถ่ายน้ำมันเครื่อง", icon: Droplets, defaultChecks: ["W", "2000H"] },
      { id: "ds_03", label: "เปลี่ยนไส้กรองน้ำมันเครื่อง", icon: Filter, defaultChecks: ["250H"] },
      { id: "ds_04", label: "ตรวจสอบ/ปรับตั้งสายพาน", icon: Cog, defaultChecks: ["500H", "2000H"] },
      { id: "ds_05", label: "ทำความสะอาดกรองอากาศ", icon: Wind, defaultChecks: ["250H", "2000H"] },
      { id: "ds_06", label: "เปลี่ยนไส้กรองอากาศ (นอก)", icon: Wind, defaultChecks: ["1000H"] },
      { id: "ds_07", label: "ตรวจสอบระบบน้ำหล่อเย็น/ระดับน้ำ", icon: Thermometer, defaultChecks: ["W", "2000H"] },
      { id: "ds_08", label: "เปลี่ยนน้ำหล่อเย็น", icon: Droplet, defaultChecks: ["1000H"] },
      { id: "ds_09", label: "ตรวจสอบระบบเชื้อเพลิง/สายยาง", icon: Fuel, defaultChecks: ["500H"] },
      { id: "ds_10", label: "เปลี่ยนไส้กรองเชื้อเพลิง", icon: Filter, defaultChecks: ["250H"] },
      { id: "ds_11", label: "ตรวจสอบน้ำมันเกียร์ / เฟืองท้าย", icon: Gauge, defaultChecks: ["1000H"] },
      { id: "ds_12", label: "เปลี่ยนน้ำมันเกียร์ / เฟืองท้าย", icon: Droplets, defaultChecks: ["2000H"] },
      { id: "ds_13", label: "ตรวจสอบ/ปรับเบรก", icon: Disc, defaultChecks: ["250H"] },
      { id: "ds_14", label: "ตรวจสอบระบบไฟฟ้า/แบตเตอรี่", icon: BatteryCharging, defaultChecks: ["W", "1000H"] },
      { id: "ds_15", label: "อัดจาระบีจุดหมุน / ข้อต่อ", icon: Wrench, defaultChecks: ["1000H"] },
      { id: "ds_16", label: "ตรวจสอบช่วงล่าง / ยาง", icon: Compass, defaultChecks: ["1000H"] },
      { id: "ds_17", label: "ตรวจสอบไอเสีย / เขม่าควัน", icon: Fan, defaultChecks: ["1000H"] },
      { id: "ds_18", label: "ตรวจสอบหัวฉีด / เครื่องยนต์โดยรวม", icon: Settings, defaultChecks: ["2000H"] },
    ],
  },
  sc_clamp: {
    id: "sc_clamp",
    shortLabel: "รถคีบ (SC)",
    headerTitle: "ตารางบำรุงรักษาเชิงป้องกัน (PM Schedule) รถคีบ (SC)",
    subtitle: "SC Clamp Truck · ตรวจเช็คก่อนใช้งาน / หลังติดเครื่อง / หลังการใช้งาน",
    columns: [
      { key: "D", titleLine1: "ทุกวัน", titleLine2: "(D)" },
      { key: "W", titleLine1: "ทุกสัปดาห์", titleLine2: "(W)" },
      { key: "250H", titleLine1: "ทุก 250 ชม.", titleLine2: "(250H)" },
      { key: "500H", titleLine1: "ทุก 500 ชม.", titleLine2: "(500H)" },
      { key: "1000H", titleLine1: "ทุก 1000 ชม.", titleLine2: "(1000H)" },
      { key: "2000H", titleLine1: "ทุก 2000 ชม.", titleLine2: "(2000H)" },
    ],
    rows: [
      // ก่อนการใช้งาน
      { id: "sc_01", section: "ก่อนการใช้งาน", label: "1. ตรวจสอบความสะอาดภายนอก", icon: Sparkles, defaultChecks: ["D"] },
      { id: "sc_02", section: "ก่อนการใช้งาน", label: "2. ตรวจสอบระดับน้ำหม้อน้ำ-หม้อพักน้ำ", icon: Thermometer, defaultChecks: ["D"] },
      { id: "sc_03", section: "ก่อนการใช้งาน", label: "3. ตรวจสอบระดับน้ำมันเครื่อง", icon: Droplets, defaultChecks: ["D"] },
      { id: "sc_04", section: "ก่อนการใช้งาน", label: "4. ตรวจสอบระดับน้ำมันเชื้อเพลิง", icon: Fuel, defaultChecks: ["D"] },
      { id: "sc_05", section: "ก่อนการใช้งาน", label: "5. ตรวจสอบระดับน้ำมันเกียร์", icon: Cog, defaultChecks: ["D"] },
      { id: "sc_06", section: "ก่อนการใช้งาน", label: "6. ตรวจสอบระดับน้ำมันไฮดรอลิค(พาวเวอร์)", icon: Droplet, defaultChecks: ["D"] },
      { id: "sc_07", section: "ก่อนการใช้งาน", label: "7. ตรวจสอบระดับน้ำมันเบรก", icon: Gauge, defaultChecks: ["D"] },
      { id: "sc_08", section: "ก่อนการใช้งาน", label: "8. ตรวจสอบน้ำกลั่นแบตเตอรี่", icon: BatteryCharging, defaultChecks: ["D"] },
      { id: "sc_09", section: "ก่อนการใช้งาน", label: "9. ตรวจสอบความตึงสายพาน", icon: Settings, defaultChecks: ["D"] },
      { id: "sc_10", section: "ก่อนการใช้งาน", label: "10. ตรวจสอบการทำงานของเบรกมือ", icon: Disc, defaultChecks: ["D"] },
      { id: "sc_11", section: "ก่อนการใช้งาน", label: "11. ตรวจสอบระบบสัญญาณไฟ", icon: Zap, defaultChecks: ["D"] },
      { id: "sc_12", section: "ก่อนการใช้งาน", label: "12. ตรวจสอบระบบสัญญาณเสียง (แตร)", icon: Volume2, defaultChecks: ["D"] },
      { id: "sc_13", section: "ก่อนการใช้งาน", label: "13. ตรวจสอบสภาพยาง", icon: Compass, defaultChecks: ["D"] },
      { id: "sc_14", section: "ก่อนการใช้งาน", label: "14. ตรวจสอบลมยาง", icon: Wind, defaultChecks: ["D"] },
      { id: "sc_15", section: "ก่อนการใช้งาน", label: "15. ตรวจสอบรอยรั่วจุดต่าง ๆ", icon: Activity, defaultChecks: ["D"] },
      // หลังติดเครื่อง
      { id: "sc_16", section: "หลังติดเครื่อง", label: "16. ตรวจสอบเสียงดังผิดปกติจากเครื่องยนต์", icon: Volume2, defaultChecks: ["D"] },
      { id: "sc_17", section: "หลังติดเครื่อง", label: "17. ตรวจสอบดูไฟที่หน้าปัด", icon: Gauge, defaultChecks: ["D"] },
      { id: "sc_18", section: "หลังติดเครื่อง", label: "18. ตรวจสอบระยะฟรีของพวงมาลัย", icon: Compass, defaultChecks: ["D"] },
      { id: "sc_19", section: "หลังติดเครื่อง", label: "19. ตรวจสอบการทำงานของชุดควบคุม", icon: Sliders, defaultChecks: ["D"] },
      // หลังการใช้งาน ขณะเครื่องยนต์ยังติดอยู่
      { id: "sc_20", section: "หลังการใช้งาน ขณะเครื่องยนต์ยังติดอยู่", label: "20. จอดรถในสถานที่จอดรถกำหนดไว้", icon: ParkingCircle, defaultChecks: ["D"] },
      { id: "sc_21", section: "หลังการใช้งาน ขณะเครื่องยนต์ยังติดอยู่", label: "21. ล็อคเบรกมือ", icon: Lock, defaultChecks: ["D"] },
      { id: "sc_22", section: "หลังการใช้งาน ขณะเครื่องยนต์ยังติดอยู่", label: "22. ตรวจสอบการหล่อลื่นตามจุดต่าง ๆ", icon: Wrench, defaultChecks: ["D"] },
      { id: "sc_23", section: "หลังการใช้งาน ขณะเครื่องยนต์ยังติดอยู่", label: "23. ตรวจสอบการรั่วซึมจากการใช้งาน", icon: Activity, defaultChecks: ["D"] },
      { id: "sc_24", section: "หลังการใช้งาน ขณะเครื่องยนต์ยังติดอยู่", label: "24. ตรวจสอบสภาพยาง", icon: ShieldCheck, defaultChecks: ["D"] },
    ],
  },
};

const CATEGORY_ORDER: MhPmMatrixCategory[] = ["forklift", "ev_tractor", "diesel_tractor", "sc_clamp"];

function buildDefaultChecks(category: MhPmMatrixCategory): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  PM_MATRIX_CONFIGS[category].rows.forEach((row) => {
    map[row.id] = [...row.defaultChecks];
  });
  return map;
}

function buildMatrixDocId(category: MhPmMatrixCategory, targetKey: string): string {
  const cleanTarget = targetKey
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_");
  return `PMM_${category}_${cleanTarget || "TEMPLATE"}`;
}

function normalizeChecksEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
  rowIds: string[]
): boolean {
  for (const id of rowIds) {
    const arrA = [...(a[id] || [])].sort();
    const arrB = [...(b[id] || [])].sort();
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (arrA[i] !== arrB[i]) return false;
    }
  }
  return true;
}

function classifyVehicleForMatrix(v: Vehicle): MhPmMatrixCategory | "other" {
  const id = String(v.vehicleId || v.number || "").trim().toUpperCase();
  const typeStr = `${v.vehicleType || ""} ${v.type || ""} ${v.description || ""} ${v.engineType || ""}`.toLowerCase();

  if (id.startsWith("SC") || typeStr.includes("รถคีบ") || typeStr.includes("clamp")) {
    return "sc_clamp";
  }
  if (id.startsWith("FL") || typeStr.includes("forklift") || typeStr.includes("โฟล์คลิฟ") || typeStr.includes("รถยก")) {
    return "forklift";
  }
  if (id.startsWith("TTL") || typeStr.includes("trailer") || typeStr.includes("หางลาก")) {
    return "other";
  }
  if (
    id.includes("EV") ||
    typeStr.includes("ไฟฟ้า") ||
    typeStr.includes("electric") ||
    typeStr.includes("battery") ||
    typeStr.includes("ev")
  ) {
    return "ev_tractor";
  }
  if (id.startsWith("TT") || typeStr.includes("tractor") || typeStr.includes("หัวลาก") || typeStr.includes("diesel") || typeStr.includes("ดีเซล")) {
    return "diesel_tractor";
  }
  return "other";
}

export function PmMatrixTableView({ vehicles, cloudRealtime = true }: PmMatrixTableViewProps) {
  const { currentUser } = useAuth();
  const [activeCategory, setActiveCategory] = useState<MhPmMatrixCategory>("forklift");
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>("TEMPLATE");
  const [savedRecords, setSavedRecords] = useState<MhPmMatrixRecord[]>(() =>
    loadCachedMhPmMatrixRecords()
  );
  const [draftChecks, setDraftChecks] = useState<Record<string, string[]>>(() =>
    buildDefaultChecks("forklift")
  );
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "info";
    text: string;
  } | null>(null);

  useEffect(() => {
    const unsub = subscribeToMhPmMatrixRecords((records) => {
      setSavedRecords(records);
    });
    return () => unsub();
  }, [cloudRealtime]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const currentConfig = PM_MATRIX_CONFIGS[activeCategory];
  const currentDocId = useMemo(
    () => buildMatrixDocId(activeCategory, selectedTargetKey),
    [activeCategory, selectedTargetKey]
  );

  const savedRecordMap = useMemo(() => {
    const map = new Map<string, MhPmMatrixRecord>();
    savedRecords.forEach((rec) => map.set(rec.id, rec));
    return map;
  }, [savedRecords]);

  const activeSavedRecord = savedRecordMap.get(currentDocId) || null;
  const baselineChecks = useMemo(() => {
    if (activeSavedRecord?.checks) {
      const merged: Record<string, string[]> = {};
      currentConfig.rows.forEach((row) => {
        const stored = activeSavedRecord.checks[row.id];
        merged[row.id] = Array.isArray(stored) ? [...stored] : [];
      });
      return merged;
    }
    return buildDefaultChecks(activeCategory);
  }, [activeSavedRecord, activeCategory, currentConfig.rows]);

  // Sync draftChecks whenever category, selected vehicle, or newly fetched saved record changes
  useEffect(() => {
    setDraftChecks(baselineChecks);
  }, [currentDocId, activeSavedRecord?.updatedAt]);

  const rowIds = useMemo(() => currentConfig.rows.map((r) => r.id), [currentConfig.rows]);

  const isDirty = useMemo(
    () => !normalizeChecksEqual(draftChecks, baselineChecks, rowIds),
    [draftChecks, baselineChecks, rowIds]
  );

  const isDifferentFromDefault = useMemo(
    () => !normalizeChecksEqual(draftChecks, buildDefaultChecks(activeCategory), rowIds),
    [draftChecks, activeCategory, rowIds]
  );

  const totalCheckedCount = useMemo(() => {
    let count = 0;
    currentConfig.rows.forEach((row) => {
      count += (draftChecks[row.id] || []).length;
    });
    return count;
  }, [draftChecks, currentConfig.rows]);

  const { matchedVehicles, otherVehicles } = useMemo(() => {
    const activeFleet = vehicles.filter((v) => v.activeStatus !== "Inactive");
    const matched: Vehicle[] = [];
    const others: Vehicle[] = [];
    activeFleet.forEach((v) => {
      if (classifyVehicleForMatrix(v) === activeCategory) {
        matched.push(v);
      } else {
        others.push(v);
      }
    });
    matched.sort((a, b) => (a.vehicleId || "").localeCompare(b.vehicleId || "", undefined, { numeric: true }));
    others.sort((a, b) => (a.vehicleId || "").localeCompare(b.vehicleId || "", undefined, { numeric: true }));
    return { matchedVehicles: matched, otherVehicles: others };
  }, [vehicles, activeCategory]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentConfig.rows;
    return currentConfig.rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        (r.section && r.section.toLowerCase().includes(q))
    );
  }, [currentConfig.rows, searchQuery]);

  const handleSwitchCategory = (cat: MhPmMatrixCategory) => {
    setActiveCategory(cat);
    setSelectedTargetKey("TEMPLATE");
    setSearchQuery("");
  };

  const handleToggleCell = (rowId: string, colKey: string) => {
    setDraftChecks((prev) => {
      const currentList = prev[rowId] || [];
      const exists = currentList.includes(colKey);
      const nextList = exists
        ? currentList.filter((c) => c !== colKey)
        : [...currentList, colKey];
      return {
        ...prev,
        [rowId]: nextList,
      };
    });
  };

  const handleResetToStandard = () => {
    setDraftChecks(buildDefaultChecks(activeCategory));
    setFeedback({
      type: "info",
      text: `รีเซ็ตตาราง PM (${currentConfig.shortLabel}) กลับเป็นค่ามาตรฐานแล้ว — กด "บันทึกข้อมูล (Save)" เพื่อยืนยันการบันทึก`,
    });
  };

  const handleClearAllChecks = () => {
    const empty: Record<string, string[]> = {};
    currentConfig.rows.forEach((r) => {
      empty[r.id] = [];
    });
    setDraftChecks(empty);
    setFeedback({
      type: "info",
      text: `ล้างเครื่องหมายถูกทั้งหมดในหน้านี้แล้ว — คลิกช่องที่ต้องการเพื่อเลือกใหม่`,
    });
  };

  const persistMatrix = async (mode: "draft" | "submitted") => {
    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19);
      const recorder =
        currentUser?.employeeName ||
        getActiveRecorderDisplay("").employeeName ||
        "เจ้าหน้าที่ซ่อมบำรุง";
      const targetLabel =
        selectedTargetKey === "TEMPLATE"
          ? `ตารางมาตรฐาน ${currentConfig.shortLabel}`
          : `รถ ${selectedTargetKey} (${currentConfig.shortLabel})`;

      const record: MhPmMatrixRecord = {
        id: currentDocId,
        vehicleCategory: activeCategory,
        targetKey: selectedTargetKey,
        vehicleId: selectedTargetKey === "TEMPLATE" ? undefined : selectedTargetKey,
        checks: draftChecks,
        status: mode,
        updatedBy: recorder,
        updatedAt: nowIso,
        submittedAt: mode === "submitted" ? nowIso : activeSavedRecord?.submittedAt,
        submittedBy: mode === "submitted" ? recorder : activeSavedRecord?.submittedBy,
      };

      setSavedRecords((prev) => [record, ...prev.filter((item) => item.id !== record.id)]);
      await saveMhPmMatrixRecordToCloud(record);

      setFeedback({
        type: "success",
        text:
          mode === "submitted"
            ? `ส่งรายงานตาราง PM (${targetLabel}) เรียบร้อยแล้ว · รวม ${totalCheckedCount} รายการ`
            : `บันทึกข้อมูลตาราง PM (${targetLabel}) เรียบร้อยแล้ว · รวม ${totalCheckedCount} รายการ`,
      });

      void appendWmsActivityLog({
        module: "PM Schedule",
        sectionId: "fleet_ops",
        reference: selectedTargetKey === "TEMPLATE" ? currentConfig.shortLabel : selectedTargetKey,
        activity: `${mode === "submitted" ? "ส่งรายงาน" : "บันทึก"}ตาราง PM ${targetLabel} (${totalCheckedCount} ช่อง)`,
        status: "Completed",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Saved per-vehicle records for the active category (quick chips)
  const savedCategoryRecords = useMemo(
    () =>
      savedRecords
        .filter((r) => r.vehicleCategory === activeCategory && r.targetKey !== "TEMPLATE")
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [savedRecords, activeCategory]
  );

  return (
    <div className="p-3 sm:p-5 space-y-4">
      {/* Top Category Switcher & Vehicle Target Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        {/* 3 Vehicle Type Sub-Tabs */}
        <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-100/80 dark:bg-[#091529] p-1">
          {CATEGORY_ORDER.map((catId) => {
            const cfg = PM_MATRIX_CONFIGS[catId];
            const isActive = activeCategory === catId;
            const tplSaved = savedRecordMap.get(buildMatrixDocId(catId, "TEMPLATE"));
            return (
              <button
                key={catId}
                type="button"
                onClick={() => handleSwitchCategory(catId)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-[#0a3668] text-white shadow-xs"
                    : "text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-[#132645]"
                }`}
              >
                <Truck size={14} className={isActive ? "text-sky-300" : "text-slate-400"} />
                <span>{cfg.shortLabel}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    isActive
                      ? "bg-white/15 text-sky-100"
                      : "bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {cfg.rows.length} รายการ
                </span>
                {tplSaved?.status === "submitted" && (
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"
                    title="ส่งรายงานแล้ว"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Target Vehicle Selector & Quick Tools */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="pm-matrix-target-select"
              className="text-xs font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap"
            >
              อ้างอิงรถ:
            </label>
            <select
              id="pm-matrix-target-select"
              value={selectedTargetKey}
              onChange={(e) => setSelectedTargetKey(e.target.value)}
              className="field text-xs h-[35px] min-w-[200px] max-w-[260px]"
            >
              <option value="TEMPLATE">
                ตารางมาตรฐาน ({currentConfig.shortLabel})
              </option>
              {matchedVehicles.length > 0 && (
                <optgroup label={`รถประเภท${currentConfig.shortLabel} (${matchedVehicles.length} คัน)`}>
                  {matchedVehicles.map((v) => {
                    const hasSaved = savedRecordMap.has(
                      buildMatrixDocId(activeCategory, v.vehicleId)
                    );
                    return (
                      <option key={v.vehicleId} value={v.vehicleId}>
                        {v.vehicleId}
                        {v.description ? ` · ${v.description}` : ""}
                        {hasSaved ? " ✓" : ""}
                      </option>
                    );
                  })}
                </optgroup>
              )}
              {otherVehicles.length > 0 && (
                <optgroup label={`รถคันอื่นในระบบ (${otherVehicles.length} คัน)`}>
                  {otherVehicles.map((v) => (
                    <option key={v.vehicleId} value={v.vehicleId}>
                      {v.vehicleId}
                      {v.description ? ` · ${v.description}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <button
            type="button"
            onClick={handleResetToStandard}
            disabled={!isDifferentFromDefault}
            className="inline-flex items-center gap-1.5 px-2.5 h-[35px] rounded-md border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#152847] disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            title="คืนค่าเครื่องหมายถูกกลับเป็นค่ามาตรฐานตามตาราง"
          >
            <RotateCcw size={13} />
            รีเซ็ตค่ามาตรฐาน
          </button>

          <button
            type="button"
            onClick={handleClearAllChecks}
            disabled={totalCheckedCount === 0}
            className="inline-flex items-center gap-1.5 px-2.5 h-[35px] rounded-md border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            title="ล้างเครื่องหมายถูกทั้งหมดเพื่อเริ่มติ๊กใหม่"
          >
            <Eraser size={13} />
            ล้างทั้งหมด
          </button>
        </div>
      </div>

      {/* Inline Feedback Toast */}
      {feedback && (
        <div
          className={`px-3.5 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-between gap-3 ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200"
              : "bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-200"
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" />
            {feedback.text}
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="opacity-70 hover:opacity-100"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Navy-Framed PM Schedule Matrix Card (Faithful to Reference Sheets) */}
      <div className="rounded-xl border border-[#0a3668]/30 dark:border-[#1e3a5f] bg-white dark:bg-[#0a1628] shadow-sm overflow-hidden">
        {/* Top Navy Title Banner */}
        <div className="bg-[#0a3668] dark:bg-[#072347] text-white px-4 sm:px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex items-center gap-3 flex-wrap">
            <h3 className="text-sm sm:text-base font-bold tracking-tight text-white">
              {currentConfig.headerTitle}
            </h3>
            {selectedTargetKey !== "TEMPLATE" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-sky-400/20 border border-sky-300/40 text-sky-100 font-mono text-xs font-bold">
                <Truck size={12} />
                {selectedTargetKey}
              </span>
            )}
            {isDirty && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400/20 border border-amber-300/40 text-amber-200 text-[11px] font-semibold">
                มีการแก้ไขยังไม่บันทึก
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {searchOpen ? (
              <div className="relative flex items-center">
                <Search size={13} className="absolute left-2.5 text-slate-300 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหารายการบำรุงรักษา..."
                  autoFocus
                  className="h-8 pl-8 pr-7 rounded-md bg-white/15 border border-white/25 text-xs text-white placeholder:text-slate-300 focus:outline-none focus:bg-white/20 w-[190px] sm:w-[230px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchOpen(false);
                  }}
                  className="absolute right-2 text-slate-200 hover:text-white"
                  aria-label="ปิดช่องค้นหา"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="p-1.5 rounded-md hover:bg-white/15 text-white/90 hover:text-white transition-colors"
                title="ค้นหารายการบำรุงรักษา"
                aria-label="ค้นหารายการบำรุงรักษา"
              >
                <Search size={17} />
              </button>
            )}
            <span
              className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-sky-100/90 bg-white/10 px-2.5 py-1 rounded-md"
              title="คลิกที่ช่องใดก็ได้ในตารางเพื่อเพิ่มหรือนำเครื่องหมายถูกออก"
            >
              <Bell size={13} />
              คลิกช่องในตารางเพื่อเพิ่ม/ลบ ✓
            </span>
          </div>
        </div>

        {/* Interactive Matrix Table */}
        <div className="p-2.5 sm:p-3.5 bg-white dark:bg-[#0a1628]">
          <div className="overflow-x-auto rounded-lg border border-[#a9c2de] dark:border-[#1e3a5f]">
            <table className="w-full border-collapse min-w-[680px]">
              <thead>
                <tr className="bg-[#d6e4f4] dark:bg-[#112645] text-slate-900 dark:text-slate-100">
                  <th className="py-2.5 px-4 text-center text-xs sm:text-sm font-bold border-b border-r border-[#a9c2de] dark:border-[#1e3a5f] min-w-[260px] w-[36%]">
                    รายการบำรุงรักษา
                  </th>
                  {currentConfig.columns.map((col, idx) => (
                    <th
                      key={col.key}
                      className={`py-2 px-2 text-center text-xs sm:text-[13px] font-bold border-b border-[#a9c2de] dark:border-[#1e3a5f] leading-tight ${
                        idx < currentConfig.columns.length - 1
                          ? "border-r border-[#a9c2de] dark:border-[#1e3a5f]"
                          : ""
                      }`}
                    >
                      <div>{col.titleLine1}</div>
                      <div className="font-mono text-[11px] sm:text-xs font-bold text-[#0a3668] dark:text-sky-300 mt-0.5">
                        {col.titleLine2}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={currentConfig.columns.length + 1}
                      className="py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      ไม่พบรายการบำรุงรักษาที่ตรงกับคำค้นหา "{searchQuery}"
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, rowIdx) => {
                    const IconComp = row.icon;
                    const rowChecks = draftChecks[row.id] || [];
                    const prevSection = rowIdx > 0 ? filteredRows[rowIdx - 1].section : undefined;
                    const showSectionHeader = Boolean(row.section && row.section !== prevSection);
                    const isEven = rowIdx % 2 === 1;
                    const rowBgClass = isEven
                      ? "bg-[#e7f0fa]/85 dark:bg-[#0e1f3a]/90"
                      : "bg-white dark:bg-[#0a1628]";
                    const labelColBgClass = isEven
                      ? "bg-[#dce9f7] dark:bg-[#102544]"
                      : "bg-[#eaf2fb]/90 dark:bg-[#0d1d36]";

                    return (
                      <React.Fragment key={row.id}>
                        {showSectionHeader && (
                          <tr className="bg-[#0a3668]/10 dark:bg-[#143059]">
                            <td
                              colSpan={currentConfig.columns.length + 1}
                              className="py-2 px-3.5 text-xs sm:text-[13px] font-bold text-[#0a3668] dark:text-sky-200 border-b border-[#a9c2de] dark:border-[#1e3a5f] tracking-tight"
                            >
                              {row.section}
                            </td>
                          </tr>
                        )}
                        <tr
                          className={`${rowBgClass} transition-colors hover:bg-sky-50/80 dark:hover:bg-[#13294b]/70`}
                        >
                          {/* Item Name & Icon Cell */}
                          <td
                            className={`${labelColBgClass} py-2 px-3 sm:px-3.5 border-b border-r border-[#b7cce4] dark:border-[#1e3a5f]`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/80 dark:bg-[#0a1628]/80 text-[#0a3668] dark:text-sky-300 border border-[#b7cce4]/70 dark:border-[#1e3a5f] shrink-0">
                                <IconComp size={14} />
                              </span>
                              <span className="text-xs sm:text-[13px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                {row.label}
                              </span>
                            </div>
                          </td>

                          {/* Interactive Interval Check Cells */}
                          {currentConfig.columns.map((col, colIdx) => {
                            const isChecked = rowChecks.includes(col.key);
                            const wasCheckedInBaseline = (baselineChecks[row.id] || []).includes(col.key);
                            const cellChanged = isChecked !== wasCheckedInBaseline;

                            return (
                              <td
                                key={`${row.id}_${col.key}`}
                                className={`p-0 text-center align-middle border-b border-[#b7cce4] dark:border-[#1e3a5f] ${
                                  colIdx < currentConfig.columns.length - 1
                                    ? "border-r border-[#b7cce4] dark:border-[#1e3a5f]"
                                    : ""
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleToggleCell(row.id, col.key)}
                                  aria-pressed={isChecked}
                                  aria-label={`${row.label} - ${col.titleLine1} ${col.titleLine2}: ${
                                    isChecked ? "เลือกแล้ว (คลิกเพื่อนำออก)" : "ยังไม่เลือก (คลิกเพื่อเพิ่มเครื่องหมายถูก)"
                                  }`}
                                  title={`${row.label} · ${col.titleLine1} ${col.titleLine2} — คลิกเพื่อ${
                                    isChecked ? "นำเครื่องหมายถูกออก" : "เพิ่มเครื่องหมายถูก"
                                  }`}
                                  className="group relative w-full h-10 sm:h-[42px] flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#087eaf] transition-colors hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30"
                                >
                                  {isChecked ? (
                                    <span className="inline-flex items-center justify-center w-6 h-6 sm:w-[26px] sm:h-[26px] rounded-full bg-[#166534] dark:bg-emerald-600 text-white shadow-xs transition-transform duration-100 group-hover:scale-110 group-active:scale-95">
                                      <Check size={15} strokeWidth={3} />
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center justify-center w-6 h-6 sm:w-[26px] sm:h-[26px] rounded-full border border-dashed border-emerald-500/70 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                                      <Plus size={13} strokeWidth={2.5} />
                                    </span>
                                  )}
                                  {cellChanged && (
                                    <span
                                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500"
                                      title="แก้ไขแล้วยังไม่บันทึก"
                                    />
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Legend & Action Buttons (Save / Submit) */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50/80 dark:bg-[#0d1c34] border-t border-slate-200 dark:border-[#1e3a5f] flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <span>
              <strong className="font-mono text-[#0a3668] dark:text-sky-300">D</strong> = Daily (ทุกวัน)
            </span>
            <span>
              <strong className="font-mono text-[#0a3668] dark:text-sky-300">W</strong> = Weekly (ทุกสัปดาห์)
            </span>
            <span>
              <strong className="font-mono text-[#0a3668] dark:text-sky-300">H</strong> = Hour (ชั่วโมงการทำงาน)
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">
              <Check size={12} strokeWidth={3} />
              เลือกแล้ว {totalCheckedCount} ช่อง
            </span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => persistMatrix("draft")}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2f73c0] hover:bg-[#2560a3] text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              <Save size={14} />
              บันทึกข้อมูล (Save)
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => persistMatrix("submitted")}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0a3668] hover:bg-[#07284f] text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              <Send size={14} />
              ส่งรายงาน (Submit)
            </button>
          </div>
        </div>
      </div>

      {/* Saved Status & Per-Vehicle Quick Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2 flex-wrap">
          {activeSavedRecord ? (
            <>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold ${
                  activeSavedRecord.status === "submitted"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                    : "bg-sky-50 text-[#087eaf] border border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800"
                }`}
              >
                <CheckCircle2 size={11} />
                {activeSavedRecord.status === "submitted" ? "ส่งรายงานแล้ว" : "บันทึกแล้ว"}
              </span>
              <span>
                อัปเดตล่าสุด:{" "}
                <strong className="font-mono text-slate-700 dark:text-slate-200">
                  {activeSavedRecord.updatedAt}
                </strong>
                {activeSavedRecord.updatedBy ? ` โดย ${activeSavedRecord.updatedBy}` : ""}
              </span>
            </>
          ) : (
            <span>กำลังแสดงค่ามาตรฐานเริ่มต้นของตาราง PM {currentConfig.shortLabel} (ยังไม่มีการบันทึกเฉพาะรายการนี้)</span>
          )}
        </div>

        {savedCategoryRecords.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-slate-600 dark:text-slate-300">รถที่บันทึกแล้ว:</span>
            {savedCategoryRecords.slice(0, 8).map((rec) => {
              const active = selectedTargetKey === rec.targetKey;
              return (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => setSelectedTargetKey(rec.targetKey)}
                  className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold border transition-colors ${
                    active
                      ? "bg-[#0a3668] text-white border-[#0a3668]"
                      : "bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:border-[#087eaf]"
                  }`}
                >
                  {rec.targetKey}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
