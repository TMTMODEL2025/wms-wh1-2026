/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MH_REPAIR_CATEGORIES } from "../../services/forkliftDataService";

export type EvRepairZoneId =
  | "battery"
  | "motor"
  | "drivetrain"
  | "charging"
  | "lighting"
  | "sensors"
  | "brakes"
  | "tires"
  | "suspension"
  | "cooling"
  | "hvac"
  | "structure"
  | "overview";

export interface EvRepairZoneSpec {
  id: EvRepairZoneId;
  nameTh: string;
  nameEn: string;
  locationTh: string;
  primaryRepairCategory: string;
  matchedCategories: string[];
  descriptionTh: string;
  commonSymptoms: string[];
  /** Primary 3D hotspot anchor coordinate on the BYD EV Tow Tractor model */
  hotspotPos: [number, number, number];
  /** Optional secondary hotspot coordinates for multi-point zones (e.g., 4 wheels/brakes) */
  secondaryHotspots?: [number, number, number][];
  /** Ideal camera position to frame this zone smoothly */
  cameraPos: [number, number, number];
  /** OrbitControls target point when focusing this zone */
  cameraTarget: [number, number, number];
  /** Whether X-Ray translucent shell should be emphasized for this zone */
  preferXray: boolean;
}

/**
 * 12 dedicated EV Tow Tractor component zones + 1 full-vehicle overview scan zone.
 * Coordinates align with the BYD EV Tow Tractor procedural model (length ~3.2m along Z,
 * front = +Z, rear = -Z, ground = Y 0).
 */
export const EV_REPAIR_ZONES: Record<EvRepairZoneId, EvRepairZoneSpec> = {
  battery: {
    id: "battery",
    nameTh: "ชุดแบตเตอรี่แรงสูง (LFP Battery)",
    nameEn: "High-Voltage LFP Traction Battery",
    locationTh: "ใต้ฝากระโปรงหน้าและใต้ท้องกลางตัวถัง",
    primaryRepairCategory: "ระบบแบตเตอร์รี่",
    matchedCategories: ["ระบบแบตเตอร์รี่"],
    descriptionTh: "ชุดเซลล์แบตเตอรี่ LFP หลัก ระบบ BMS และสายบัสบาร์แรงสูง",
    commonSymptoms: ["แบตหมดเร็วผิดปกติ", "ไฟเตือนแบตเตอรี่ / BMS โชว์", "แรงดันตกขณะลากจูง"],
    hotspotPos: [0, 0.72, 0.72],
    secondaryHotspots: [[0, 0.44, 0.05]],
    cameraPos: [2.75, 1.85, 2.55],
    cameraTarget: [0, 0.65, 0.55],
    preferXray: true,
  },
  motor: {
    id: "motor",
    nameTh: "มอเตอร์ขับเคลื่อนไฟฟ้า (EV Motor)",
    nameEn: "Electric Traction Drive Motor",
    locationTh: "เพลาขับล้อหลัง ใต้โครงสร้างห้องโดยสาร",
    primaryRepairCategory: "มอเตอร์",
    matchedCategories: ["มอเตอร์", "ระบบไดสตาร์ท", "ระบบไดชาร์จ", "เครื่องยนต์"],
    descriptionTh: "มอเตอร์ไฟฟ้าขับเคลื่อนหลัก คอยล์ระบายความร้อน และชุดสายไฟ 3 เฟส",
    commonSymptoms: ["มอเตอร์มีเสียงหอนหรือสั่น", "รถออกตัวไม่มีแรง", "ความร้อนมอเตอร์สูงเกินกำหนด"],
    hotspotPos: [0, 0.52, -0.78],
    cameraPos: [2.65, 1.55, -2.35],
    cameraTarget: [0, 0.55, -0.75],
    preferXray: true,
  },
  drivetrain: {
    id: "drivetrain",
    nameTh: "ชุดส่งกำลังและเฟืองท้าย",
    nameEn: "Reducer Gearbox & Rear Differential",
    locationTh: "ชุดเกียร์ทดกำลังและแกนเพลาหลัง",
    primaryRepairCategory: "ระบบส่งกำลัง",
    matchedCategories: ["ระบบส่งกำลัง"],
    descriptionTh: "ชุดเกียร์ทดรอบขับเคลื่อน เพลาข้าง และเฟืองท้ายล้อหลัง",
    commonSymptoms: ["มีเสียงกระแทกตอนเปลี่ยนทิศทาง", "น้ำมันเฟืองท้ายรั่วซึม", "เพลาขับสั่นขณะวิ่ง"],
    hotspotPos: [0, 0.44, -0.96],
    cameraPos: [-2.6, 1.45, -2.35],
    cameraTarget: [0, 0.46, -0.88],
    preferXray: true,
  },
  charging: {
    id: "charging",
    nameTh: "พอร์ตชาร์จและชุดชาร์จไฟ (OBC)",
    nameEn: "Charging Port & On-Board Charger",
    locationTh: "ด้านข้างตัวถังฝั่งซ้าย ช่วงต่อฝากระโปรงและห้องโดยสาร",
    primaryRepairCategory: "ตู้ชาร์จไฟ",
    matchedCategories: ["ตู้ชาร์จไฟ", "ระบบเชื้อเพลิง"],
    descriptionTh: "เต้ารับหัวชาร์จไฟรถ EV, โมดูล On-Board Charger และสายไฟเชื่อมต่อตู้ชาร์จ",
    commonSymptoms: ["เสียบชาร์จไม่เข้า / ตัดการชาร์จ", "หัวปลั๊กชาร์จหลวมหรือร้อน", "หน้าจอตู้ชาร์จแจ้ง Error"],
    hotspotPos: [-0.72, 0.88, 0.25],
    cameraPos: [-2.85, 1.55, 1.35],
    cameraTarget: [-0.55, 0.82, 0.2],
    preferXray: true,
  },
  lighting: {
    id: "lighting",
    nameTh: "ชุดไฟหน้า ไฟท้าย และไฟสัญญาณ",
    nameEn: "LED Headlights, Tail Lamps & Beacon",
    locationTh: "กระจังหน้า, หลังคาห้องโดยสาร และชุดไฟท้าย",
    primaryRepairCategory: "ระบบไฟรถ",
    matchedCategories: ["ระบบไฟรถ"],
    descriptionTh: "ไฟหน้าคู่ LED, ไฟเลี้ยว, ไฟวับวาบหลังคา และชุดไฟเบรค/ไฟถอยด้านหลัง",
    commonSymptoms: ["ไฟหน้าไม่ติด / ขาด", "ไฟสัญญาณหลังคาไม่หมุนหรือไม่สว่าง", "ไฟท้าย/ไฟถอยไม่ทำงาน"],
    hotspotPos: [0, 0.78, 1.48],
    secondaryHotspots: [
      [0, 2.02, -0.45],
      [0, 0.62, -1.42],
    ],
    cameraPos: [2.5, 1.6, 2.8],
    cameraTarget: [0, 0.85, 0.9],
    preferXray: false,
  },
  sensors: {
    id: "sensors",
    nameTh: "ชุดเซนเซอร์และกล่องควบคุม (VCU / Inverter)",
    nameEn: "Inverter, VCU & Safety Sensors",
    locationTh: "ใต้คอนโซลหน้า และชุดเซนเซอร์รอบคัน",
    primaryRepairCategory: "ระบบเซนเซอร์",
    matchedCategories: ["ระบบเซนเซอร์"],
    descriptionTh: "กล่องควบคุมอินเวอร์เตอร์, เซนเซอร์คันเร่ง, เซนเซอร์เบาะนั่ง และสวิตช์ความปลอดภัย",
    commonSymptoms: ["ขึ้นรหัส Error บนหน้าจอ", "เซนเซอร์เบาะ/คันเร่งไม่ตอบสนอง", "รถตัดกำลังอัตโนมัติ"],
    hotspotPos: [0, 1.08, 0.22],
    cameraPos: [2.55, 1.95, 1.65],
    cameraTarget: [0, 1.0, 0.15],
    preferXray: true,
  },
  brakes: {
    id: "brakes",
    nameTh: "ชุดระบบเบรคและคาลิเปอร์ 4 ล้อ",
    nameEn: "Hydraulic Brake & Caliper System",
    locationTh: "ดุมล้อทั้ง 4 จุด และแม่ปั๊มเบรคใต้ห้องโดยสาร",
    primaryRepairCategory: "ระบบเบรค",
    matchedCategories: ["ระบบเบรค", "ไฮดรอลิค", "PM ไฮดรอลิค"],
    descriptionTh: "ผ้าเบรค จาน/ดรัมเบรคทั้ง 4 ล้อ แม่ปั๊มเบรค และชุดเบรคมือ",
    commonSymptoms: ["เบรคไม่อยู่ / แป้นเบรคจม", "เบรคมีเสียงดังเอี๊ยด", "เบรคมือล็อกไม่สนิท"],
    hotspotPos: [0.68, 0.36, 0.84],
    secondaryHotspots: [
      [0.7, 0.4, -0.84],
      [-0.68, 0.36, 0.84],
      [-0.7, 0.4, -0.84],
    ],
    cameraPos: [2.95, 1.15, 1.45],
    cameraTarget: [0.25, 0.42, 0.2],
    preferXray: true,
  },
  tires: {
    id: "tires",
    nameTh: "ล้อและยางอุตสาหกรรม 4 เส้น",
    nameEn: "Industrial Front & Rear Wheels / Tires",
    locationTh: "ล้อหน้าซ้าย-ขวา และล้อหลังซ้าย-ขวา",
    primaryRepairCategory: "ยางเสื่อมสภาพ",
    matchedCategories: ["ยางเสื่อมสภาพ", "ยางรั่ว"],
    descriptionTh: "ชุดยางตัน/ยางลม ล้อหน้า-หลัง น็อตล้อ และกระทะล้อ",
    commonSymptoms: ["ดอกยางสึกหมด / แตกบิ่น", "ยางรั่ว / โดนตะปู", "น็อตล้อคลายหรือกระทะล้อคด"],
    hotspotPos: [0.76, 0.38, 0.84],
    secondaryHotspots: [
      [0.78, 0.42, -0.84],
      [-0.76, 0.38, 0.84],
      [-0.78, 0.42, -0.84],
    ],
    cameraPos: [3.25, 1.05, 1.35],
    cameraTarget: [0, 0.42, 0.05],
    preferXray: false,
  },
  suspension: {
    id: "suspension",
    nameTh: "ระบบช่วงล่าง คานเพลา และชุดบังคับเลี้ยว",
    nameEn: "Chassis Suspension & Steering Axle",
    locationTh: "คานเพลาหน้า ชุดโช้กอัพ แหนบหลัง และแกนพวงมาลัย",
    primaryRepairCategory: "ระบบช่วงล่าง",
    matchedCategories: ["ระบบช่วงล่าง"],
    descriptionTh: "คานเพลาหน้า โช้กอัพ แหนบรับน้ำหนัก ลูกหมากคันชัก และแร็คพวงมาลัย",
    commonSymptoms: ["พวงมาลัยหนักหรือมีระยะฟรีมาก", "ช่วงล่างมีเสียงดังกุกกัก", "รถเอียงหรือกระแทกแรงผิดปกติ"],
    hotspotPos: [0, 0.34, 0.84],
    secondaryHotspots: [[0, 0.36, -0.84]],
    cameraPos: [2.95, 1.0, 2.25],
    cameraTarget: [0, 0.38, 0.3],
    preferXray: true,
  },
  cooling: {
    id: "cooling",
    nameTh: "ชุดระบายความร้อนและพัดลมไฟฟ้า",
    nameEn: "Thermal Management & Cooling Fan",
    locationTh: "ด้านหลังกระจังหน้า บริเวณชุดระบายความร้อนอินเวอร์เตอร์และแบตเตอรี่",
    primaryRepairCategory: "ระบบระบายความร้อน",
    matchedCategories: ["ระบบระบายความร้อน", "พัดลม"],
    descriptionTh: "พัดลมระบายความร้อนไฟฟ้า แผงแลกเปลี่ยนความร้อน และปั๊มน้ำหล่อเย็นระบบ EV",
    commonSymptoms: ["พัดลมระบายความร้อนไม่หมุน", "มีเสียงพัดลมดังผิดปกติ", "อุณหภูมิระบบขับเคลื่อนสูง"],
    hotspotPos: [0, 0.72, 1.24],
    cameraPos: [2.25, 1.45, 2.95],
    cameraTarget: [0, 0.72, 1.05],
    preferXray: true,
  },
  hvac: {
    id: "hvac",
    nameTh: "ระบบปรับอากาศห้องโดยสาร (Cabin A/C)",
    nameEn: "Cabin Air Conditioning & Ventilation",
    locationTh: "ด้านบนและด้านหลังห้องโดยสารคนขับ",
    primaryRepairCategory: "ระบบปรับอากาศ",
    matchedCategories: ["ระบบปรับอากาศ"],
    descriptionTh: "ชุดคอยล์เย็น คอมเพรสเซอร์แอร์ไฟฟ้า พัดลมโบลเวอร์ และช่องลมห้องโดยสาร",
    commonSymptoms: ["แอร์ไม่เย็น / มีแต่ลมร้อน", "พัดลมแอร์ไม่ทำงาน", "มีน้ำหยดในห้องโดยสาร"],
    hotspotPos: [0, 1.88, -0.52],
    cameraPos: [2.75, 2.25, 1.45],
    cameraTarget: [0, 1.55, -0.45],
    preferXray: false,
  },
  structure: {
    id: "structure",
    nameTh: "โครงสร้างตัวถัง ห้องโดยสาร และชุดลากจูง",
    nameEn: "Body Shell, Cabin & Rear Tow Hitch",
    locationTh: "กันชนหน้า, ประตู/กระจกห้องโดยสาร และชุดสลักลากจูงด้านท้าย",
    primaryRepairCategory: "โครงสร้าง",
    matchedCategories: ["โครงสร้าง", "เคส อุบัติเหตุ"],
    descriptionTh: "โครงสร้างห้องโดยสาร ประตู กระจกมองข้าง กันชนหน้า-หลัง และชุดตะขอพ่วงท้าย",
    commonSymptoms: ["กระจก/ประตูชำรุดหรือปิดไม่สนิท", "กันชนบุบหรือฉีกขาดจากอุบัติเหตุ", "ชุดสลักลากจูงท้ายหลวม/ติดขัด"],
    hotspotPos: [0, 0.68, -1.46],
    secondaryHotspots: [[0, 1.42, -0.42]],
    cameraPos: [2.95, 1.65, -2.55],
    cameraTarget: [0, 0.92, -0.65],
    preferXray: false,
  },
  overview: {
    id: "overview",
    nameTh: "ตรวจเช็กสภาพรถ EV รอบคัน",
    nameEn: "Full EV Tractor Diagnostic Scan",
    locationTh: "สแกนภาพรวมระบบหลักทั้งคัน (แบตเตอรี่, มอเตอร์, เบรค, โครงสร้าง)",
    primaryRepairCategory: "ซ่อมเชิงป้องกัน (PM)",
    matchedCategories: ["ซ่อมเชิงป้องกัน (PM)", "ซ่อมทั่วไป (MN)", "อื่นๆ"],
    descriptionTh: "ตรวจเช็กตามรอบบำรุงรักษา PM หรือแจ้งซ่อมทั่วไป สามารถคลิกจุดชิ้นส่วนบนรถเพื่อระบุตำแหน่งเฉพาะได้",
    commonSymptoms: ["ตรวจเช็ก PM ตามรอบชั่วโมง", "ตรวจสภาพทั่วไปก่อนใช้งาน", "อาการอื่น ๆ ทั่วไป"],
    hotspotPos: [0, 0.92, 0.0],
    secondaryHotspots: [
      [0, 0.72, 0.72],
      [0, 0.52, -0.78],
      [0.72, 0.38, 0.84],
    ],
    cameraPos: [3.25, 1.95, 3.05],
    cameraTarget: [0, 0.82, 0.0],
    preferXray: true,
  },
};

export const EV_INTERACTIVE_ZONE_LIST: EvRepairZoneSpec[] = [
  EV_REPAIR_ZONES.battery,
  EV_REPAIR_ZONES.motor,
  EV_REPAIR_ZONES.drivetrain,
  EV_REPAIR_ZONES.charging,
  EV_REPAIR_ZONES.lighting,
  EV_REPAIR_ZONES.sensors,
  EV_REPAIR_ZONES.brakes,
  EV_REPAIR_ZONES.tires,
  EV_REPAIR_ZONES.suspension,
  EV_REPAIR_ZONES.cooling,
  EV_REPAIR_ZONES.hvac,
  EV_REPAIR_ZONES.structure,
];

/**
 * Categories prioritized at the top of the dropdown when an Electric Tractor (EV) is selected.
 * All 24 standard categories remain selectable for full backwards compatibility.
 */
export const EV_PRIORITY_CATEGORIES: string[] = [
  "ระบบแบตเตอร์รี่",
  "มอเตอร์",
  "ตู้ชาร์จไฟ",
  "ระบบไฟรถ",
  "ระบบเซนเซอร์",
  "ระบบเบรค",
  "ยางเสื่อมสภาพ",
  "ยางรั่ว",
  "ระบบส่งกำลัง",
  "ระบบช่วงล่าง",
  "ระบบระบายความร้อน",
  "พัดลม",
  "ระบบปรับอากาศ",
  "โครงสร้าง",
  "เคส อุบัติเหตุ",
  "ซ่อมเชิงป้องกัน (PM)",
  "ซ่อมทั่วไป (MN)",
  "อื่นๆ",
];

export function getGroupedRepairCategoriesForVehicle(isEv: boolean): {
  primaryGroupLabel: string;
  primaryCategories: string[];
  secondaryGroupLabel: string | null;
  secondaryCategories: string[];
} {
  const all = [...MH_REPAIR_CATEGORIES] as string[];
  if (!isEv) {
    return {
      primaryGroupLabel: "ประเภทการซ่อมทั้งหมด",
      primaryCategories: all,
      secondaryGroupLabel: null,
      secondaryCategories: [],
    };
  }
  const evSet = new Set(EV_PRIORITY_CATEGORIES);
  const primaryCategories = EV_PRIORITY_CATEGORIES.filter((c) => all.includes(c));
  const secondaryCategories = all.filter((c) => !evSet.has(c));
  return {
    primaryGroupLabel: "หมวดแนะนำสำหรับรถ EV ไฟฟ้า",
    primaryCategories,
    secondaryGroupLabel: "หมวดอื่น ๆ (รถเครื่องยนต์ / ไฮดรอลิค)",
    secondaryCategories,
  };
}

/**
 * Resolve any of the 24 repair categories to its corresponding 3D EV zone.
 */
export function getEvZoneForRepairCategory(repairType: string): EvRepairZoneSpec {
  const clean = (repairType || "").trim();
  if (!clean) return EV_REPAIR_ZONES.overview;
  for (const zone of EV_INTERACTIVE_ZONE_LIST) {
    if (zone.matchedCategories.includes(clean)) {
      return zone;
    }
  }
  return EV_REPAIR_ZONES.overview;
}

const REPAIR_PART_TAG_REGEX = /^\[จุดซ่อม:\s*([^\]]+)\]\s*/;

/**
 * Auto-insert or replace the leading `[จุดซ่อม: <part>]` tag inside the repair description
 * while preserving any symptom details the user has already typed.
 */
export function upsertRepairPartTagInDescription(
  currentDescription: string,
  partNameTh: string
): string {
  const cleanPart = partNameTh.trim();
  if (!cleanPart) return currentDescription;
  const tag = `[จุดซ่อม: ${cleanPart}] `;
  const trimmed = currentDescription || "";
  if (REPAIR_PART_TAG_REGEX.test(trimmed)) {
    return trimmed.replace(REPAIR_PART_TAG_REGEX, tag);
  }
  return trimmed.trim().length > 0 ? `${tag}${trimmed.trimStart()}` : tag;
}

/**
 * Parse a saved `[จุดซ่อม: ...]` tag from a maintenance record description to recover
 * the exact highlighted zone for Supervisor/Manager 3D preview.
 */
export function extractEvZoneFromDescription(
  description?: string
): EvRepairZoneSpec | null {
  const text = (description || "").trim();
  const match = text.match(REPAIR_PART_TAG_REGEX);
  if (!match) return null;
  const taggedLabel = match[1].trim().toLowerCase();
  for (const zone of EV_INTERACTIVE_ZONE_LIST) {
    if (
      zone.nameTh.toLowerCase() === taggedLabel ||
      zone.nameTh.toLowerCase().includes(taggedLabel) ||
      taggedLabel.includes(zone.nameTh.toLowerCase())
    ) {
      return zone;
    }
  }
  return null;
}
