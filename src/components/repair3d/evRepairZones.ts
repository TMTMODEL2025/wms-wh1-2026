/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MH_REPAIR_CATEGORIES } from "../../services/forkliftDataService";
import {
  VehicleTypeCandidate,
  isClampTruckVehicle,
  isElectricTractorVehicle,
  isForkliftVehicle,
  isStandardTractorVehicle,
  isTrailerVehicle,
} from "../../utils/vehicleHelpers";

export type RepairVehicleModelKind =
  | "ev_tractor"
  | "diesel_tractor"
  | "forklift"
  | "clamp_truck"
  | "trailer";

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
  | "hydraulics"
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
  /** Primary 3D hotspot anchor coordinate on the vehicle 3D model */
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

export interface ModelCameraPresetMap {
  iso: { pos: [number, number, number]; target: [number, number, number]; label: string };
  side: { pos: [number, number, number]; target: [number, number, number]; label: string };
  front: { pos: [number, number, number]; target: [number, number, number]; label: string };
  rear: { pos: [number, number, number]; target: [number, number, number]; label: string };
  top: { pos: [number, number, number]; target: [number, number, number]; label: string };
}

/**
 * Resolve which interactive 3D Hologram model should be rendered for a fleet vehicle.
 * Covers all 5 Material Handling classes: EV Tractor, Diesel Tractor, Forklift, Clamp Truck, and Flatbed Trailer (TTL).
 */
export function resolveRepair3dModelKind(
  candidate?: VehicleTypeCandidate
): RepairVehicleModelKind | null {
  if (!candidate) return null;
  if (isClampTruckVehicle(candidate)) return "clamp_truck";
  if (isElectricTractorVehicle(candidate)) return "ev_tractor";
  if (isTrailerVehicle(candidate)) return "trailer";
  if (isForkliftVehicle(candidate)) return "forklift";
  if (isStandardTractorVehicle(candidate)) return "diesel_tractor";
  return null;
}

export function getModelDisplayTitle(modelKind: RepairVehicleModelKind): string {
  switch (modelKind) {
    case "ev_tractor":
      return "หัวลากไฟฟ้า EV (360° Hologram)";
    case "diesel_tractor":
      return "หัวลากดีเซล TT (360° Hologram)";
    case "forklift":
      return "รถโฟล์คลิฟท์ FL (360° Hologram)";
    case "clamp_truck":
      return "รถคีบ SC (360° Hologram)";
    case "trailer":
      return "หางลาก TTL (360° Hologram)";
  }
}

export function getModelShortName(modelKind: RepairVehicleModelKind): string {
  switch (modelKind) {
    case "ev_tractor":
      return "รถ EV";
    case "diesel_tractor":
      return "หัวลากดีเซล TT";
    case "forklift":
      return "โฟล์คลิฟท์ FL";
    case "clamp_truck":
      return "รถคีบ SC";
    case "trailer":
      return "หางลาก TTL";
  }
}

export function getCameraPresetsForModel(
  modelKind: RepairVehicleModelKind
): ModelCameraPresetMap {
  if (modelKind === "trailer") {
    return {
      iso: { pos: [4.55, 2.25, 4.15], target: [0, 0.62, 0.35], label: "เฉียง" },
      side: { pos: [5.25, 1.28, 0.42], target: [0, 0.58, 0.42], label: "ข้าง" },
      front: { pos: [0.08, 1.45, 5.45], target: [0, 0.58, 0.75], label: "หน้า" },
      rear: { pos: [0.08, 1.45, -4.65], target: [0, 0.62, -0.25], label: "หลัง" },
      top: { pos: [0.05, 6.05, 1.15], target: [0, 0.45, 0.38], label: "บน" },
    };
  }
  if (modelKind === "clamp_truck") {
    return {
      iso: { pos: [4.6, 2.55, 4.35], target: [0.05, 1.18, 0.45], label: "เฉียง" },
      side: { pos: [5.4, 1.6, 0.55], target: [0.05, 1.18, 0.45], label: "ข้าง" },
      front: { pos: [0.1, 1.85, 5.45], target: [0.05, 1.18, 0.6], label: "หน้า" },
      rear: { pos: [0.1, 1.85, -4.65], target: [0, 1.15, -0.3], label: "หลัง" },
      top: { pos: [0.05, 6.2, 1.35], target: [0.05, 0.9, 0.45], label: "บน" },
    };
  }
  if (modelKind === "forklift") {
    return {
      iso: { pos: [3.55, 2.05, 3.35], target: [0, 0.92, 0.15], label: "เฉียง" },
      side: { pos: [4.35, 1.25, 0.15], target: [0, 0.92, 0.15], label: "ข้าง" },
      front: { pos: [0.06, 1.35, 4.35], target: [0, 0.92, 0.35], label: "หน้า" },
      rear: { pos: [0.06, 1.38, -3.95], target: [0, 0.9, -0.25], label: "หลัง" },
      top: { pos: [0.02, 4.95, 0.85], target: [0, 0.65, 0.15], label: "บน" },
    };
  }
  // ev_tractor & diesel_tractor share the same sculpted BYD Tow Tractor dimensions
  return {
    iso: { pos: [3.25, 1.85, 3.05], target: [0, 0.8, 0], label: "เฉียง" },
    side: { pos: [3.95, 1.15, 0.05], target: [0, 0.82, 0], label: "ข้าง" },
    front: { pos: [0.05, 1.25, 3.85], target: [0, 0.8, 0.15], label: "หน้า" },
    rear: { pos: [0.05, 1.3, -3.85], target: [0, 0.8, -0.15], label: "หลัง" },
    top: { pos: [0.02, 4.45, 0.75], target: [0, 0.5, 0], label: "บน" },
  };
}

// ============================================================================
// 1. EV ELECTRIC TOW TRACTOR (TTEV-*) REPAIR ZONES
// ============================================================================
export const EV_REPAIR_ZONES: Record<Exclude<EvRepairZoneId, "hydraulics">, EvRepairZoneSpec> = {
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

// ============================================================================
// 2. DIESEL TOW TRACTOR (TT-*) REPAIR ZONES (Shares EV Tow Tractor 3D Geometry)
// ============================================================================
export const DIESEL_TRACTOR_REPAIR_ZONES: Record<
  Exclude<EvRepairZoneId, "hydraulics">,
  EvRepairZoneSpec
> = {
  motor: {
    ...EV_REPAIR_ZONES.battery,
    id: "motor",
    nameTh: "เครื่องยนต์ดีเซล (Diesel Engine)",
    nameEn: "Industrial Diesel Engine Bay",
    locationTh: "ห้องเครื่องยนต์ใต้ฝากระโปรงหน้า",
    primaryRepairCategory: "เครื่องยนต์",
    matchedCategories: ["เครื่องยนต์", "มอเตอร์"],
    descriptionTh: "เครื่องยนต์ดีเซลหลัก ฝาสูบ กรองน้ำมันเครื่อง สายพานหน้าเครื่อง และระบบท่อไอเสีย",
    commonSymptoms: ["เครื่องยนต์สตาร์ทติดยาก / สั่นสะดุด", "มีน้ำมันเครื่องรั่วซึม", "ควันดำหรือเครื่องไม่มีกำลัง"],
    hotspotPos: [0, 0.72, 0.72],
    secondaryHotspots: [[0, 0.52, -0.78]],
  },
  battery: {
    ...EV_REPAIR_ZONES.motor,
    id: "battery",
    nameTh: "แบตเตอรี่ ไดสตาร์ท และไดชาร์จ",
    nameEn: "Starter Battery, Starter Motor & Alternator",
    locationTh: "ข้างห้องเครื่องและชุดไดสตาร์ท / ไดชาร์จ",
    primaryRepairCategory: "ระบบแบตเตอร์รี่",
    matchedCategories: ["ระบบแบตเตอร์รี่", "ระบบไดสตาร์ท", "ระบบไดชาร์จ", "ตู้ชาร์จไฟ"],
    descriptionTh: "แบตเตอรี่สตาร์ท 12V/24V มอเตอร์สตาร์ท ไดชาร์จ และสายไฟขั้วแบต",
    commonSymptoms: ["สตาร์ทไม่ติด / ไดสตาร์ทเงียบ", "ไฟแบตเตอรี่โชว์ / ไดชาร์จไม่ชาร์จ", "แบตเตอรี่เสื่อมเก็บไฟไม่อยู่"],
    hotspotPos: [0.32, 0.66, 0.56],
    cameraPos: [2.75, 1.75, 2.35],
    cameraTarget: [0.15, 0.65, 0.45],
  },
  charging: {
    ...EV_REPAIR_ZONES.charging,
    id: "charging",
    nameTh: "ระบบเชื้อเพลิงและถังน้ำมันดีเซล",
    nameEn: "Diesel Fuel Tank, Pump & Injectors",
    locationTh: "ถังน้ำมันด้านข้างตัวถัง กรองดักน้ำ และปั๊มหัวฉีดดีเซล",
    primaryRepairCategory: "ระบบเชื้อเพลิง",
    matchedCategories: ["ระบบเชื้อเพลิง"],
    descriptionTh: "ถังน้ำมันดีเซล กรองโซล่า ปั๊มเชื้อเพลิง ท่อทางเดินน้ำมัน และชุดหัวฉีด",
    commonSymptoms: ["น้ำมันดีเซลรั่วซึม", "กรองโซล่าตัน / เครื่องวูบดับ", "เกจวัดระดับน้ำมันไม่ขึ้น"],
    hotspotPos: [-0.72, 0.68, 0.15],
  },
  drivetrain: {
    ...EV_REPAIR_ZONES.drivetrain,
    nameTh: "ชุดเกียร์ เพลากลาง และเฟืองท้าย",
    nameEn: "Automatic Transmission, Driveshaft & Rear Axle",
    descriptionTh: "ชุดเกียร์เดินหน้า-ถอยหลัง เพลากลาง ยอยกากบาท และเฟืองท้ายล้อหลัง",
    commonSymptoms: ["เข้าเกียร์ยาก / เกียร์กระตุก", "น้ำมันเกียร์หรือเฟืองท้ายรั่วซึม", "เพลากลางสั่นหรือมีเสียงดัง"],
  },
  cooling: {
    ...EV_REPAIR_ZONES.cooling,
    nameTh: "หม้อน้ำ พัดลม และระบบหล่อเย็น",
    nameEn: "Radiator, Cooling Fan & Coolant Hoses",
    locationTh: "ด้านหลังกระจังหน้า ชุดหม้อน้ำและพัดลมเครื่องยนต์",
    descriptionTh: "แผงหม้อน้ำ พัดลมระบายความร้อน ท่อยางน้ำหล่อเย็น และปั๊มน้ำเครื่องยนต์",
    commonSymptoms: ["ความร้อนเครื่องยนต์ขึ้นสูง (Overheat)", "น้ำหล่อเย็นรั่วซึม / หม้อน้ำแห้ง", "พัดลมหรือสายพานหม้อน้ำมีเสียงดัง"],
  },
  lighting: { ...EV_REPAIR_ZONES.lighting },
  sensors: {
    ...EV_REPAIR_ZONES.sensors,
    nameTh: "หน้าปัดเรือนไมล์ และระบบเซนเซอร์",
    nameEn: "Instrument Cluster & Safety Sensors",
    descriptionTh: "หน้าปัดแสดงผล สวิตช์กุญแจ เกจวัดความร้อน/น้ำมัน และเซนเซอร์ความปลอดภัย",
  },
  brakes: { ...EV_REPAIR_ZONES.brakes },
  tires: { ...EV_REPAIR_ZONES.tires },
  suspension: { ...EV_REPAIR_ZONES.suspension },
  hvac: { ...EV_REPAIR_ZONES.hvac },
  structure: { ...EV_REPAIR_ZONES.structure },
  overview: {
    ...EV_REPAIR_ZONES.overview,
    nameTh: "ตรวจเช็กสภาพรถหัวลากดีเซล TT รอบคัน",
    nameEn: "Full Diesel Tow Tractor Diagnostic Scan",
    locationTh: "สแกนภาพรวมระบบหลักทั้งคัน (เครื่องยนต์, เกียร์, เบรค, โครงสร้าง)",
  },
};

export const DIESEL_TRACTOR_INTERACTIVE_ZONE_LIST: EvRepairZoneSpec[] = [
  DIESEL_TRACTOR_REPAIR_ZONES.motor,
  DIESEL_TRACTOR_REPAIR_ZONES.drivetrain,
  DIESEL_TRACTOR_REPAIR_ZONES.cooling,
  DIESEL_TRACTOR_REPAIR_ZONES.charging,
  DIESEL_TRACTOR_REPAIR_ZONES.battery,
  DIESEL_TRACTOR_REPAIR_ZONES.brakes,
  DIESEL_TRACTOR_REPAIR_ZONES.tires,
  DIESEL_TRACTOR_REPAIR_ZONES.suspension,
  DIESEL_TRACTOR_REPAIR_ZONES.lighting,
  DIESEL_TRACTOR_REPAIR_ZONES.sensors,
  DIESEL_TRACTOR_REPAIR_ZONES.hvac,
  DIESEL_TRACTOR_REPAIR_ZONES.structure,
];

// ============================================================================
// 3. FORKLIFT (FL-*) REPAIR ZONES (Aligned with pm3dVehicleBuilders.buildForklift)
// ============================================================================
export const FORKLIFT_REPAIR_ZONES: Record<
  Exclude<EvRepairZoneId, "hvac">,
  EvRepairZoneSpec
> = {
  hydraulics: {
    id: "hydraulics",
    nameTh: "ระบบไฮดรอลิค กระบอกยก/เอียงเสา และปั๊มไฮดรอลิค",
    nameEn: "Lift/Tilt Hydraulic Cylinders, Hoses & Gear Pump",
    locationTh: "กระบอกยกเสาหน้า กระบอกเอียงใต้พื้น และชุดปั๊มไฮดรอลิคใต้เบาะ",
    primaryRepairCategory: "ไฮดรอลิค",
    matchedCategories: ["ไฮดรอลิค", "PM ไฮดรอลิค"],
    descriptionTh: "กระบอกไฮดรอลิคยกเสา กระบอกเอียงเสา สายอ่อนไฮดรอลิค คอนโทรลวาล์ว และปั๊มไฮดรอลิค",
    commonSymptoms: ["น้ำมันไฮดรอลิครั่วซึมที่กระบอก/สาย", "ยกงาไม่ขึ้นหรือตกเอง", "เอียงเสากระตุกหรือไม่มีแรง"],
    hotspotPos: [0, 1.38, 1.12],
    secondaryHotspots: [
      [0.32, 0.68, -0.28],
      [0.34, 0.58, 0.96],
      [-0.34, 0.58, 0.96],
    ],
    cameraPos: [3.05, 1.85, 2.75],
    cameraTarget: [0, 1.15, 0.95],
    preferXray: true,
  },
  structure: {
    id: "structure",
    nameTh: "เสายก (Mast) โซ่ยก แผงงา และงาเหล็กคู่",
    nameEn: "Duplex Mast, Lift Chains, Carriage & Tapered Forks",
    locationTh: "ด้านหน้ารถ ชุดเสายก รอกโซ่ แผงพนักพิง และงาเหล็กคู่",
    primaryRepairCategory: "โครงสร้าง",
    matchedCategories: ["โครงสร้าง", "เคส อุบัติเหตุ"],
    descriptionTh: "โครงเสายก Duplex Mast, โซ่ยกและลูกรอก, แผงงา, งาเหล็กคู่ และโครงหลังคา ROPS",
    commonSymptoms: ["โซ่ยกหย่อนหรือฝืดมีเสียงดัง", "งาคด บิดงอ หรือสลักล็อกงาหลวม", "โครงสร้าง/กันชนชำรุดจากอุบัติเหตุ"],
    hotspotPos: [0, 0.85, 1.48],
    secondaryHotspots: [
      [0, 1.88, 1.18],
      [0, 0.72, -1.52],
    ],
    cameraPos: [3.25, 1.55, 3.05],
    cameraTarget: [0, 0.95, 1.05],
    preferXray: false,
  },
  motor: {
    id: "motor",
    nameTh: "เครื่องยนต์ / ชุดขับเคลื่อนใต้เบาะ",
    nameEn: "Under-Seat Powertrain / Engine Bay",
    locationTh: "ห้องเครื่องใต้ฝากระโปรงเบาะนั่งคนขับ",
    primaryRepairCategory: "เครื่องยนต์",
    matchedCategories: ["เครื่องยนต์", "มอเตอร์"],
    descriptionTh: "เครื่องยนต์หรือมอเตอร์ขับเคลื่อนใต้เบาะ กรองอากาศ กรองน้ำมันเครื่อง และชุดสายพาน",
    commonSymptoms: ["เครื่องยนต์สั่นหรือสตาร์ทติดยาก", "มีน้ำมันเครื่องหยดใต้ท้องรถ", "กำลังตกขณะยกหรือวิ่งขึ้นทางลาด"],
    hotspotPos: [-0.04, 0.76, -0.34],
    cameraPos: [2.75, 1.85, -1.55],
    cameraTarget: [0, 0.78, -0.35],
    preferXray: true,
  },
  drivetrain: {
    id: "drivetrain",
    nameTh: "ชุดเกียร์และเพลาขับล้อหน้า",
    nameEn: "Transmission & Front Drive Axle",
    locationTh: "ชุดเกียร์ใต้พื้นห้องคนขับและเพลาขับล้อหน้า",
    primaryRepairCategory: "ระบบส่งกำลัง",
    matchedCategories: ["ระบบส่งกำลัง"],
    descriptionTh: "ชุดเกียร์เดินหน้า-ถอยหลัง ทอร์กคอนเวอร์เตอร์ และชุดเฟืองเพลาขับล้อหน้า",
    commonSymptoms: ["เข้าเกียร์แล้วรถไม่ขยับหรือออกตัวช้า", "น้ำมันเกียร์รั่วซึม", "เพลาขับหน้ามีเสียงหอน"],
    hotspotPos: [0, 0.44, 0.48],
    cameraPos: [2.85, 1.25, 1.85],
    cameraTarget: [0, 0.46, 0.42],
    preferXray: true,
  },
  cooling: {
    id: "cooling",
    nameTh: "หม้อน้ำและพัดลมระบายความร้อนท้ายรถ",
    nameEn: "Rear Counterweight Radiator & Cooling Fan",
    locationTh: "ด้านหลังห้องเครื่องติดช่องระบายอากาศตุ้มถ่วงน้ำหนัก",
    primaryRepairCategory: "ระบบระบายความร้อน",
    matchedCategories: ["ระบบระบายความร้อน", "พัดลม"],
    descriptionTh: "แผงหม้อน้ำ พัดลมระบายความร้อน ท่อยางหม้อน้ำ และช่องระบายลมท้ายตุ้มถ่วง",
    commonSymptoms: ["ความร้อนขึ้นสูงขณะใช้งานต่อเนื่อง", "น้ำหม้อน้ำรั่วซึม", "พัดลมระบายความร้อนไม่ทำงานหรือดัง"],
    hotspotPos: [0, 0.78, -1.15],
    cameraPos: [2.55, 1.55, -2.95],
    cameraTarget: [0, 0.78, -0.95],
    preferXray: true,
  },
  charging: {
    id: "charging",
    nameTh: "ระบบเชื้อเพลิง (ดีเซล / แก๊ส LPG)",
    nameEn: "Fuel System / LPG & Fuel Line",
    locationTh: "ถังเชื้อเพลิงด้านข้างตัวถังและท่อส่งเชื้อเพลิง",
    primaryRepairCategory: "ระบบเชื้อเพลิง",
    matchedCategories: ["ระบบเชื้อเพลิง"],
    descriptionTh: "ถังน้ำมัน/ถังแก๊ส LPG หม้อต้ม กรองเชื้อเพลิง และท่อส่งน้ำมัน",
    commonSymptoms: ["ได้กลิ่นน้ำมันหรือแก๊สรั่วซึม", "เครื่องวูบดับ / เร่งไม่ขึ้น", "เกจน้ำมันไม่แสดงผล"],
    hotspotPos: [-0.56, 0.72, -0.42],
    cameraPos: [-2.95, 1.55, -1.25],
    cameraTarget: [-0.35, 0.72, -0.35],
    preferXray: true,
  },
  battery: {
    id: "battery",
    nameTh: "แบตเตอรี่ ไดสตาร์ท และไดชาร์จ",
    nameEn: "Battery, Starter Motor & Alternator",
    locationTh: "ช่องแบตเตอรี่และชุดไดสตาร์ทใต้เบาะฝั่งขวา",
    primaryRepairCategory: "ระบบแบตเตอร์รี่",
    matchedCategories: ["ระบบแบตเตอร์รี่", "ระบบไดสตาร์ท", "ระบบไดชาร์จ", "ตู้ชาร์จไฟ"],
    descriptionTh: "แบตเตอรี่ ขั้วสายไฟ มอเตอร์ไดสตาร์ท และไดชาร์จไฟ",
    commonSymptoms: ["บิดกุญแจเงียบ / สตาร์ทไม่ติด", "แบตหมดเร็ว / ไดชาร์จไม่จ่ายไฟ", "ขั้วแบตหลวมหรือเกิดคราบเกลือ"],
    hotspotPos: [0.38, 0.74, -0.45],
    cameraPos: [2.85, 1.75, -1.25],
    cameraTarget: [0.22, 0.72, -0.42],
    preferXray: true,
  },
  lighting: {
    id: "lighting",
    nameTh: "ชุดไฟหน้า LED ไฟท้าย และไฟไซเรนหลังคา",
    nameEn: "ROPS LED Work Lights, Strobe & Blue Safety Spot",
    locationTh: "โครงหลังคา ROPS ด้านหน้า ด้านหลัง และชุดไฟท้ายตุ้มถ่วง",
    primaryRepairCategory: "ระบบไฟรถ",
    matchedCategories: ["ระบบไฟรถ"],
    descriptionTh: "ไฟส่องสว่างหน้า LED ไฟวับวาบหลังคา ไฟบลูสปอตเตือนคนเดินเท้า และไฟท้าย/ไฟถอย",
    commonSymptoms: ["ไฟหน้าหรือไฟท้ายไม่ติด", "ไฟวับวาบ/ไฟบลูสปอตไม่สว่าง", "สัญญาณเสียงถอยหลังไม่ดัง"],
    hotspotPos: [0, 2.24, -0.84],
    secondaryHotspots: [
      [0.45, 1.98, 0.54],
      [-0.45, 1.98, 0.54],
      [0, 1.0, -1.54],
    ],
    cameraPos: [3.15, 2.25, 2.25],
    cameraTarget: [0, 1.65, -0.2],
    preferXray: false,
  },
  sensors: {
    id: "sensors",
    nameTh: "คอนโซลหน้าปัด คันโยกควบคุม และเซนเซอร์",
    nameEn: "Cockpit Dashboard, Control Levers & Sensors",
    locationTh: "ห้องคนขับ พวงมาลัย หน้าปัด และชุดคันโยกไฮดรอลิค 3 ก้าน",
    primaryRepairCategory: "ระบบเซนเซอร์",
    matchedCategories: ["ระบบเซนเซอร์", "ระบบปรับอากาศ"],
    descriptionTh: "หน้าปัดเรือนไมล์ คันโยกควบคุมยก/เอียง/สไลด์งา สวิตช์เบาะนั่ง และเซนเซอร์ความปลอดภัย",
    commonSymptoms: ["หน้าจอแสดงผลไม่ติดหรือขึ้น Error", "คันโยกไฮดรอลิคหลวม/ค้าง", "เซนเซอร์เบาะนั่งหรือแตรไม่ทำงาน"],
    hotspotPos: [0.12, 1.24, 0.48],
    cameraPos: [2.65, 1.95, 1.85],
    cameraTarget: [0.05, 1.18, 0.35],
    preferXray: false,
  },
  brakes: {
    id: "brakes",
    nameTh: "ระบบเบรคล้อขับหน้าและเบรคมือ",
    nameEn: "Front Drive Axle Brakes & Parking Brake",
    locationTh: "ชุดดุมเบรคล้อหน้าซ้าย-ขวา และคันเบรคมือในห้องคนขับ",
    primaryRepairCategory: "ระบบเบรค",
    matchedCategories: ["ระบบเบรค"],
    descriptionTh: "ผ้าเบรคล้อหน้า แม่ปั๊มเบรค น้ำมันเบรค และชุดสายเบรคมือ",
    commonSymptoms: ["เบรคไม่อยู่ / แป้นเบรคจมลึก", "เบรคมีเสียงดังเอี๊ยด", "เบรคมือล็อกไม่อยู่บนทางลาด"],
    hotspotPos: [0.62, 0.34, 0.68],
    secondaryHotspots: [[-0.62, 0.34, 0.68]],
    cameraPos: [2.95, 1.15, 1.75],
    cameraTarget: [0.15, 0.38, 0.65],
    preferXray: true,
  },
  tires: {
    id: "tires",
    nameTh: "ล้อหน้า (ล้อขับ) และล้อหลัง (ล้อเลี้ยว)",
    nameEn: "Front Drive Tires & Rear Steer Tires",
    locationTh: "ล้อหน้าขนาดใหญ่ซ้าย-ขวา และล้อหลังบังคับเลี้ยวซ้าย-ขวา",
    primaryRepairCategory: "ยางเสื่อมสภาพ",
    matchedCategories: ["ยางเสื่อมสภาพ", "ยางรั่ว"],
    descriptionTh: "ยางตัน/ยางลมล้อหน้า-หลัง น็อตล้อ และกระทะล้อโฟล์คลิฟท์",
    commonSymptoms: ["ดอกยางสึกถึงขีดความปลอดภัย", "ยางแตกร้าว/บิ่นหลุดร่อน", "ยางรั่วซึมหรือน็อตล้อหลวม"],
    hotspotPos: [0.66, 0.34, 0.68],
    secondaryHotspots: [
      [-0.66, 0.34, 0.68],
      [0.58, 0.26, -0.86],
      [-0.58, 0.26, -0.86],
    ],
    cameraPos: [3.45, 1.05, 1.35],
    cameraTarget: [0, 0.36, -0.05],
    preferXray: false,
  },
  suspension: {
    id: "suspension",
    nameTh: "เพลาเลี้ยวหลัง ชุดบังคับเลี้ยว และช่วงล่าง",
    nameEn: "Rear Steering Axle, Kingpins & Orbitrol",
    locationTh: "คานเพลาเลี้ยวล้อหลัง กระบอกช่วยเลี้ยว และพวงมาลัย",
    primaryRepairCategory: "ระบบช่วงล่าง",
    matchedCategories: ["ระบบช่วงล่าง"],
    descriptionTh: "คานเพลาเลี้ยวหลัง ลูกหมากคันชัก สลักคิงพิน และกระบอกไฮดรอลิคช่วยเลี้ยว",
    commonSymptoms: ["พวงมาลัยหนักหรือเลี้ยวไม่สุด", "เพลาหลังหลวมคลอนมีเสียงดัง", "กระบอกช่วยเลี้ยวรั่วซึม"],
    hotspotPos: [0, 0.3, -0.86],
    secondaryHotspots: [[0, 0.36, 0.68]],
    cameraPos: [2.95, 1.05, -2.25],
    cameraTarget: [0, 0.36, -0.75],
    preferXray: true,
  },
  overview: {
    id: "overview",
    nameTh: "ตรวจเช็กสภาพรถโฟล์คลิฟท์ FL รอบคัน",
    nameEn: "Full Industrial Forklift Diagnostic Scan",
    locationTh: "สแกนภาพรวมระบบหลักทั้งคัน (เสายก, ไฮดรอลิค, เครื่องยนต์, ล้อ)",
    primaryRepairCategory: "ซ่อมเชิงป้องกัน (PM)",
    matchedCategories: ["ซ่อมเชิงป้องกัน (PM)", "ซ่อมทั่วไป (MN)", "อื่นๆ"],
    descriptionTh: "ตรวจเช็กตามรอบบำรุงรักษา PM หรือแจ้งซ่อมทั่วไป สามารถคลิกจุดชิ้นส่วนบนรถเพื่อระบุตำแหน่งเฉพาะได้",
    commonSymptoms: ["ตรวจเช็ก PM ตามรอบชั่วโมง", "ตรวจเช็กระบบไฮดรอลิคและเสายก", "อาการอื่น ๆ ทั่วไป"],
    hotspotPos: [0, 1.08, 0.2],
    secondaryHotspots: [
      [0, 1.38, 1.12],
      [-0.04, 0.76, -0.34],
      [0.64, 0.34, 0.68],
    ],
    cameraPos: [3.55, 2.05, 3.35],
    cameraTarget: [0, 0.92, 0.15],
    preferXray: true,
  },
};

export const FORKLIFT_INTERACTIVE_ZONE_LIST: EvRepairZoneSpec[] = [
  FORKLIFT_REPAIR_ZONES.hydraulics,
  FORKLIFT_REPAIR_ZONES.structure,
  FORKLIFT_REPAIR_ZONES.motor,
  FORKLIFT_REPAIR_ZONES.drivetrain,
  FORKLIFT_REPAIR_ZONES.cooling,
  FORKLIFT_REPAIR_ZONES.charging,
  FORKLIFT_REPAIR_ZONES.battery,
  FORKLIFT_REPAIR_ZONES.brakes,
  FORKLIFT_REPAIR_ZONES.tires,
  FORKLIFT_REPAIR_ZONES.suspension,
  FORKLIFT_REPAIR_ZONES.lighting,
  FORKLIFT_REPAIR_ZONES.sensors,
];

// ============================================================================
// 4. CLAMP TRUCK (SC-01 / หแ-01) REPAIR ZONES (Aligned with buildClampTruckRoot)
// ============================================================================
export const CLAMP_TRUCK_REPAIR_ZONES: Record<EvRepairZoneId, EvRepairZoneSpec> = {
  hydraulics: {
    id: "hydraulics",
    nameTh: "ระบบไฮดรอลิค บูม-อาร์ม และชุดหมุนหัวคีบ",
    nameEn: "Boom/Stick Hydraulic Cylinders & 360° Rotator",
    locationTh: "กระบอกยกบูมหลัก กระบอกอาร์ม และชุดมอเตอร์หมุนหัวคีบ",
    primaryRepairCategory: "ไฮดรอลิค",
    matchedCategories: ["ไฮดรอลิค", "PM ไฮดรอลิค"],
    descriptionTh: "กระบอกไฮดรอลิคยกบูมหลัก กระบอกอาร์ม สายไฮดรอลิคแรงดันสูง และโรเตเตอร์หมุนหัวคีบ 360°",
    commonSymptoms: ["สายหรือซีลกระบอกไฮดรอลิครั่วซึม", "แขนบูม/หัวคีบไม่มีแรงหรือหนีบไม่อยู่", "หัวคีบหมุน 360° ติดขัดหรือช้าผิดปกติ"],
    hotspotPos: [0.32, 1.85, 1.18],
    secondaryHotspots: [
      [0.32, 2.62, 1.55],
      [0.32, 1.38, 2.66],
    ],
    cameraPos: [4.15, 2.45, 3.65],
    cameraTarget: [0.25, 1.75, 1.45],
    preferXray: true,
  },
  structure: {
    id: "structure",
    nameTh: "หัวคีบเหล็ก 4 ขา แขนบูม และโครงสร้างตัวถัง",
    nameEn: "4-Claw Steel Grapple, Main Boom & Counterweight",
    locationTh: "ปลายแขนสติ๊ก (หัวคีบ 4 ขา), แขนบูมหลัก และตุ้มถ่วงท้าย",
    primaryRepairCategory: "โครงสร้าง",
    matchedCategories: ["โครงสร้าง", "เคส อุบัติเหตุ"],
    descriptionTh: "ขากรรไกรหัวคีบเหล็ก 4 ขา สลักบูชข้อต่อบูม-อาร์ม โครงสร้างตัวถัง และตุ้มถ่วงท้าย",
    commonSymptoms: ["ขาคีบเหล็กคดงอหรือแตกร้าว", "สลักบูชข้อต่อบูม-อาร์มหลวมคลอน", "โครงสร้าง/ตัวถังเสียหายจากอุบัติเหตุ"],
    hotspotPos: [0.32, 0.96, 2.66],
    secondaryHotspots: [
      [0.32, 2.02, 1.05],
      [0, 1.42, -1.28],
    ],
    cameraPos: [3.95, 2.05, 4.45],
    cameraTarget: [0.25, 1.25, 2.05],
    preferXray: false,
  },
  motor: {
    id: "motor",
    nameTh: "เครื่องยนต์ดีเซลและชุดปั๊มหลัก",
    nameEn: "Rear Diesel Engine & Main Hydraulic Pump",
    locationTh: "ห้องเครื่องท้ายรถใต้ฝาครอบสีเหลืองและท่อไอเสีย",
    primaryRepairCategory: "เครื่องยนต์",
    matchedCategories: ["เครื่องยนต์", "มอเตอร์"],
    descriptionTh: "เครื่องยนต์ดีเซลหลัก ชุดปั๊มไฮดรอลิคหลัก ท่อไอเสีย และกรองอากาศ",
    commonSymptoms: ["เครื่องยนต์สั่น ควันดำ หรือไม่มีกำลัง", "น้ำมันเครื่องรั่วซึมห้องเครื่องท้าย", "เสียงเครื่องยนต์/ปั๊มดังผิดปกติ"],
    hotspotPos: [0, 1.52, -0.72],
    cameraPos: [3.45, 2.25, -2.65],
    cameraTarget: [0, 1.42, -0.72],
    preferXray: true,
  },
  drivetrain: {
    id: "drivetrain",
    nameTh: "เฟืองสวิงวงเดือน (Slewing Ring) และระบบส่งกำลัง",
    nameEn: "Slewing Ring Turntable & Travel Drivetrain",
    locationTh: "วงเดือนหมุนเอวกลางตัวรถและชุดขับเคลื่อนล้อ",
    primaryRepairCategory: "ระบบส่งกำลัง",
    matchedCategories: ["ระบบส่งกำลัง"],
    descriptionTh: "ชุดลูกปืนและเฟืองสวิงเอว 360° มอเตอร์สวิง และชุดส่งกำลังขับเคลื่อนล้อ",
    commonSymptoms: ["สวิงเอวมีเสียงดังหรือสะดุด", "เอวรถหลวมคลอนขณะคีบเหล็ก", "รถเคลื่อนที่ช้าหรือเกียร์มีปัญหา"],
    hotspotPos: [0, 0.84, -0.18],
    cameraPos: [3.55, 1.45, 1.45],
    cameraTarget: [0, 0.82, -0.18],
    preferXray: true,
  },
  cooling: {
    id: "cooling",
    nameTh: "หม้อน้ำ พัดลม และออยล์คูลเลอร์ไฮดรอลิค",
    nameEn: "Engine Radiator & Hydraulic Oil Cooler",
    locationTh: "ด้านท้ายห้องเครื่องใกล้ตุ้มถ่วงน้ำหนัก",
    primaryRepairCategory: "ระบบระบายความร้อน",
    matchedCategories: ["ระบบระบายความร้อน", "พัดลม"],
    descriptionTh: "แผงหม้อน้ำเครื่องยนต์ แผงออยล์คูลเลอร์น้ำมันไฮดรอลิค และพัดลมระบายความร้อน",
    commonSymptoms: ["ความร้อนเครื่องยนต์หรือน้ำมันไฮดรอลิคสูง", "หม้อน้ำหรือออยล์คูลเลอร์รั่วซึม", "พัดลมระบายความร้อนไม่ทำงาน"],
    hotspotPos: [0.45, 1.48, -1.18],
    cameraPos: [3.15, 2.05, -3.25],
    cameraTarget: [0.25, 1.42, -1.05],
    preferXray: true,
  },
  charging: {
    id: "charging",
    nameTh: "ถังน้ำมันดีเซลและระบบเชื้อเพลิง",
    nameEn: "Diesel Fuel Tank & Fuel Injection",
    locationTh: "ด้านซ้ายห้องเครื่องท้ายและท่อส่งน้ำมัน",
    primaryRepairCategory: "ระบบเชื้อเพลิง",
    matchedCategories: ["ระบบเชื้อเพลิง"],
    descriptionTh: "ถังน้ำมันเชื้อเพลิงดีเซล กรองดักน้ำ ปั๊มโซล่า และหัวฉีด",
    commonSymptoms: ["น้ำมันดีเซลรั่วซึม", "เครื่องวูบดับ / กรองโซล่าตัน", "เกจน้ำมันเชื้อเพลิงผิดปกติ"],
    hotspotPos: [-0.62, 1.38, -0.78],
    cameraPos: [-3.55, 2.05, -2.15],
    cameraTarget: [-0.35, 1.35, -0.75],
    preferXray: true,
  },
  battery: {
    id: "battery",
    nameTh: "แบตเตอรี่ ไดสตาร์ท และไดชาร์จ",
    nameEn: "24V Battery Pack, Starter & Alternator",
    locationTh: "ช่องแบตเตอรี่ด้านขวาห้องเครื่องท้าย",
    primaryRepairCategory: "ระบบแบตเตอร์รี่",
    matchedCategories: ["ระบบแบตเตอร์รี่", "ระบบไดสตาร์ท", "ระบบไดชาร์จ", "ตู้ชาร์จไฟ"],
    descriptionTh: "ชุดแบตเตอรี่ 24V ไดสตาร์ท ไดชาร์จ และเมนสวิตช์ตัดไฟ",
    commonSymptoms: ["สตาร์ทไม่ติด / ไดสตาร์ทไม่หมุน", "แบตเตอรี่ไฟอ่อน / ไดชาร์จไม่ชาร์จ", "ขั้วแบตหลวมหรือสายไฟชำรุด"],
    hotspotPos: [0.58, 1.38, -0.45],
    cameraPos: [3.65, 2.05, -1.35],
    cameraTarget: [0.35, 1.35, -0.45],
    preferXray: true,
  },
  lighting: {
    id: "lighting",
    nameTh: "ไฟส่องสว่างหน้าหลังคาและไฟไซเรน",
    nameEn: "Cabin Roof Work Lamps & Warning Beacon",
    locationTh: "ขอบหลังคาห้องคนขับด้านหน้าและไฟไซเรนบนหลังคา",
    primaryRepairCategory: "ระบบไฟรถ",
    matchedCategories: ["ระบบไฟรถ"],
    descriptionTh: "ไฟส่องสว่างทำงานคู่หน้าบนหลังคาห้องคนขับ ไฟไซเรนเตือน และระบบไฟส่องบูม",
    commonSymptoms: ["ไฟส่องสว่างหน้าหลังคาไม่ติด", "ไฟไซเรนบนหลังคาไม่หมุน/ไม่สว่าง", "สวิตช์หรือสายไฟส่องสว่างขาด"],
    hotspotPos: [-0.44, 2.46, -0.15],
    secondaryHotspots: [[-0.44, 2.28, 0.88]],
    cameraPos: [-3.45, 2.85, 2.65],
    cameraTarget: [-0.35, 2.15, 0.25],
    preferXray: false,
  },
  sensors: {
    id: "sensors",
    nameTh: "ห้องคนขับ จอยสติ๊กควบคุม และเซนเซอร์",
    nameEn: "Operator Cabin, Joysticks & Monitor",
    locationTh: "ห้องคนขับ ROPS ฝั่งซ้าย",
    primaryRepairCategory: "ระบบเซนเซอร์",
    matchedCategories: ["ระบบเซนเซอร์"],
    descriptionTh: "คันบังคับจอยสติ๊กซ้าย-ขวา หน้าจอมอนิเตอร์ สวิตช์เซฟตี้ล็อกไฮดรอลิค และเซนเซอร์",
    commonSymptoms: ["จอยสติ๊กควบคุมค้างหรือตอบสนองช้า", "หน้าจอมอนิเตอร์แจ้ง Error", "สวิตช์ล็อกความปลอดภัยไม่ทำงาน"],
    hotspotPos: [-0.44, 1.84, 0.24],
    cameraPos: [-3.55, 2.45, 2.15],
    cameraTarget: [-0.4, 1.75, 0.25],
    preferXray: false,
  },
  hvac: {
    id: "hvac",
    nameTh: "ระบบปรับอากาศห้องคนขับรถคีบ",
    nameEn: "Cabin Air Conditioning System",
    locationTh: "ห้องคนขับ ROPS และแผงคอยล์แอร์",
    primaryRepairCategory: "ระบบปรับอากาศ",
    matchedCategories: ["ระบบปรับอากาศ"],
    descriptionTh: "คอมเพรสเซอร์แอร์ พัดลมโบลเวอร์ คอยล์เย็น และระบบลมเย็นในห้องคนขับ",
    commonSymptoms: ["แอร์ไม่เย็น / มีแต่ลมร้อน", "พัดลมแอร์ไม่หมุน", "น้ำยาแอร์รั่วหรือมีน้ำหยดในห้องขับ"],
    hotspotPos: [-0.44, 2.34, 0.24],
    cameraPos: [-3.45, 2.85, 1.85],
    cameraTarget: [-0.4, 2.05, 0.2],
    preferXray: false,
  },
  brakes: {
    id: "brakes",
    nameTh: "ระบบเบรค 4 ล้อ และระบบล็อกเพลา",
    nameEn: "4-Wheel Brake & Axle Lock System",
    locationTh: "ดุมเบรคล้อทั้ง 4 ล้อ และวาล์วเบรคช่วงล่าง",
    primaryRepairCategory: "ระบบเบรค",
    matchedCategories: ["ระบบเบรค"],
    descriptionTh: "ระบบเบรคล้อหน้า-หลัง วาล์วล็อกเพลาขณะจอดคีบ และเบรคมือ",
    commonSymptoms: ["เบรคไม่อยู่ / ลมเบรคหรือน้ำมันเบรครั่ว", "ล็อกเพลาขณะคีบงานไม่อยู่", "เบรคติดหรือมีเสียงดัง"],
    hotspotPos: [0.82, 0.42, 0.68],
    secondaryHotspots: [
      [-0.82, 0.42, 0.68],
      [0.82, 0.42, -0.82],
      [-0.82, 0.42, -0.82],
    ],
    cameraPos: [3.95, 1.25, 2.15],
    cameraTarget: [0.15, 0.48, 0.0],
    preferXray: true,
  },
  tires: {
    id: "tires",
    nameTh: "ล้อและยางลมขนาดใหญ่ 4 เส้น",
    nameEn: "Heavy-Duty Pneumatic Wheels & Tires",
    locationTh: "ล้อหน้าซ้าย-ขวา และล้อหลังซ้าย-ขวา",
    primaryRepairCategory: "ยางเสื่อมสภาพ",
    matchedCategories: ["ยางเสื่อมสภาพ", "ยางรั่ว"],
    descriptionTh: "ยางลมอุตสาหกรรมขนาดใหญ่ 4 ล้อ กระทะล้อ และน็อตดุมล้อ",
    commonSymptoms: ["ยางรั่ว / โดนเศษเหล็กตำ", "ดอกยางสึกหมดหรือแก้มยางฉีก", "น็อตล้อคลายหรือกระทะล้อชำรุด"],
    hotspotPos: [0.92, 0.42, 0.68],
    secondaryHotspots: [
      [-0.92, 0.42, 0.68],
      [0.92, 0.42, -0.82],
      [-0.92, 0.42, -0.82],
    ],
    cameraPos: [4.25, 1.18, 1.85],
    cameraTarget: [0, 0.48, -0.05],
    preferXray: false,
  },
  suspension: {
    id: "suspension",
    nameTh: "ช่วงล่าง คานเพลา และขาค้ำยัน Outriggers",
    nameEn: "Undercarriage Axles & Rear Stabilizer Outriggers",
    locationTh: "โครงช่วงล่าง คานเพลา และชุดขาค้ำยันกันโคลงด้านท้าย",
    primaryRepairCategory: "ระบบช่วงล่าง",
    matchedCategories: ["ระบบช่วงล่าง"],
    descriptionTh: "คานเพลาหน้า-หลัง คันชักบังคับเลี้ยว และชุดขาค้ำยัน Stabilizer Outriggers ท้ายรถ",
    commonSymptoms: ["ขาค้ำยัน Outrigger ยก/วางไม่สุดหรือรั่ว", "ช่วงล่างและลูกหมากหลวมคลอน", "บังคับเลี้ยวหนักหรือเอียง"],
    hotspotPos: [0, 0.36, -1.35],
    secondaryHotspots: [[0, 0.52, 0.68]],
    cameraPos: [3.55, 1.35, -3.45],
    cameraTarget: [0, 0.45, -1.05],
    preferXray: true,
  },
  overview: {
    id: "overview",
    nameTh: "ตรวจเช็กสภาพรถคีบ SC รอบคัน",
    nameEn: "Full Clamp Truck SC Diagnostic Scan",
    locationTh: "สแกนภาพรวมระบบหลักทั้งคัน (หัวคีบ, ไฮดรอลิค, เครื่องยนต์, ช่วงล่าง)",
    primaryRepairCategory: "ซ่อมเชิงป้องกัน (PM)",
    matchedCategories: ["ซ่อมเชิงป้องกัน (PM)", "ซ่อมทั่วไป (MN)", "อื่นๆ"],
    descriptionTh: "ตรวจเช็กตามรอบบำรุงรักษา PM หรือแจ้งซ่อมทั่วไป สามารถคลิกจุดชิ้นส่วนบนตัวรถเพื่อระบุตำแหน่งเฉพาะได้",
    commonSymptoms: ["ตรวจเช็ก PM ตามรอบชั่วโมง", "ตรวจเช็กระบบไฮดรอลิคและหัวคีบ", "อาการอื่น ๆ ทั่วไป"],
    hotspotPos: [0.15, 1.38, 0.45],
    secondaryHotspots: [
      [0.32, 0.96, 2.66],
      [0, 1.52, -0.72],
      [0.86, 0.42, 0.68],
    ],
    cameraPos: [4.6, 2.55, 4.35],
    cameraTarget: [0.05, 1.18, 0.45],
    preferXray: true,
  },
};

export const CLAMP_TRUCK_INTERACTIVE_ZONE_LIST: EvRepairZoneSpec[] = [
  CLAMP_TRUCK_REPAIR_ZONES.hydraulics,
  CLAMP_TRUCK_REPAIR_ZONES.structure,
  CLAMP_TRUCK_REPAIR_ZONES.motor,
  CLAMP_TRUCK_REPAIR_ZONES.drivetrain,
  CLAMP_TRUCK_REPAIR_ZONES.cooling,
  CLAMP_TRUCK_REPAIR_ZONES.charging,
  CLAMP_TRUCK_REPAIR_ZONES.battery,
  CLAMP_TRUCK_REPAIR_ZONES.brakes,
  CLAMP_TRUCK_REPAIR_ZONES.tires,
  CLAMP_TRUCK_REPAIR_ZONES.suspension,
  CLAMP_TRUCK_REPAIR_ZONES.lighting,
  CLAMP_TRUCK_REPAIR_ZONES.sensors,
  CLAMP_TRUCK_REPAIR_ZONES.hvac,
];

// ============================================================================
// 5. FLATBED TRAILER (TTL-*) REPAIR ZONES (Aligned with pm3dVehicleBuilders.buildFlatbedTrailer)
// ============================================================================
export type TrailerRepairZoneId =
  | "structure"
  | "suspension"
  | "brakes"
  | "tires"
  | "hydraulics"
  | "lighting"
  | "overview";

export const TRAILER_REPAIR_ZONES: Record<TrailerRepairZoneId, EvRepairZoneSpec> = {
  structure: {
    id: "structure",
    nameTh: "แขนลาก A-Frame ห่วงลาก และโครงพื้นเหล็กแผ่นลาย",
    nameEn: "A-Frame Drawbar, Lunette Eye & Diamond-Plate Deck",
    locationTh: "ด้านหน้าแขนลาก ห่วงลากจูง โซ่เซฟตี้ และโครงพื้นเหล็กคาน I-Beam",
    primaryRepairCategory: "โครงสร้าง",
    matchedCategories: ["โครงสร้าง", "เคส อุบัติเหตุ"],
    descriptionTh: "ชุดแขนลากจูง A-Frame, ห่วงลาก (Lunette Eye), โซ่คล้องนิรภัย, แผ่นพื้นเหล็กกันลื่น และคานโครงสร้างหลัก",
    commonSymptoms: [
      "ห่วงลาก / บูชสลักแขนลากหลวมหรือแตกร้าว",
      "แผ่นพื้นเหล็กยุบ บิดงอ หรือรอยเชื่อมคานร้าว",
      "โซ่นิรภัยหรือกันชนข้างชำรุดจากอุบัติเหตุ",
    ],
    hotspotPos: [0, 0.48, 2.72],
    secondaryHotspots: [
      [0, 0.96, 0.0],
      [0, 0.52, 2.04],
    ],
    cameraPos: [3.65, 1.85, 4.35],
    cameraTarget: [0, 0.65, 1.35],
    preferXray: false,
  },
  suspension: {
    id: "suspension",
    nameTh: "ชุดจานหมุนเลี้ยวหน้า (Turntable) แหนบ และเพลาหน้า-หลัง",
    nameEn: "Front Steering Turntable, Leaf Springs & Solid Axles",
    locationTh: "ใต้พื้นช่วงหน้า (จานหมุนเลี้ยว) แหนบสปริง 4 จุด และเพลาหน้า-หลัง",
    primaryRepairCategory: "ระบบช่วงล่าง",
    matchedCategories: ["ระบบช่วงล่าง", "ระบบส่งกำลัง"],
    descriptionTh: "ลูกปืนจานหมุนบังคับเลี้ยว (Turntable Ring), ชุดแหนบรับน้ำหนัก, สาแหรก U-Bolt และคานเพลาหน้า-หลัง",
    commonSymptoms: [
      "จานหมุนเลี้ยวฝืด ขาดจาระบี หรือคลอนมีเสียงดัง",
      "แผ่นแหนบหัก ล้า หรือสาแหรก U-Bolt คลาย",
      "เพลาคด หางลากวิ่งเอียงหรือส่ายขณะลากจูง",
    ],
    hotspotPos: [0, 0.74, 1.18],
    secondaryHotspots: [
      [0, 0.44, -1.18],
      [0.56, 0.5, 1.18],
      [-0.56, 0.5, -1.18],
    ],
    cameraPos: [3.85, 1.45, 2.85],
    cameraTarget: [0, 0.56, 0.55],
    preferXray: true,
  },
  brakes: {
    id: "brakes",
    nameTh: "ระบบเบรคลมหางลาก และหม้อลมเบรค 4 ล้อ",
    nameEn: "Trailer Air Brake Chambers, Drums & Shoes",
    locationTh: "หม้อลมเบรคและชุดดรัมเบรคทั้ง 4 ล้อใต้เพลาหน้า-หลัง",
    primaryRepairCategory: "ระบบเบรค",
    matchedCategories: ["ระบบเบรค"],
    descriptionTh: "หม้อลมเบรค 4 ล้อ, ผ้าเบรคและดรัมเบรค, ก้ามปูเบรค และวาล์วเบรคฉุกเฉินหางลาก",
    commonSymptoms: [
      "เบรคหางลากไม่อยู่ / ลมเบรคไม่ลงล้อ",
      "หม้อลมเบรครั่วซึมหรือเบรคล็อกติดค้าง",
      "ผ้าเบรคหมด มีเสียงเหล็กสีกันขณะเบรค",
    ],
    hotspotPos: [0.66, 0.46, 1.06],
    secondaryHotspots: [
      [-0.66, 0.46, 1.06],
      [0.66, 0.46, -1.3],
      [-0.66, 0.46, -1.3],
    ],
    cameraPos: [3.95, 1.18, 2.15],
    cameraTarget: [0.15, 0.45, 0.0],
    preferXray: true,
  },
  tires: {
    id: "tires",
    nameTh: "ล้อและยางหางลาก 4 เส้น กระทะล้อ และน็อตล้อ",
    nameEn: "4-Wheel Trailer Tires, Deep-Dish Rims & Lug Nuts",
    locationTh: "ล้อหน้าซ้าย-ขวา และล้อหลังซ้าย-ขวา",
    primaryRepairCategory: "ยางเสื่อมสภาพ",
    matchedCategories: ["ยางเสื่อมสภาพ", "ยางรั่ว"],
    descriptionTh: "ยางบรรทุกอุตสาหกรรมหางลาก 4 ล้อ กระทะล้อเหล็ก ลูกปืนดุมล้อ และน็อตล้อ",
    commonSymptoms: [
      "ยางรั่ว / แบน / โดนเศษเหล็กตำ",
      "ดอกยางสึกหมด บวม หรือแก้มยางฉีกขาด",
      "น็อตล้อหลวมขาด หรือลูกปืนล้อแตกมีเสียงดัง",
    ],
    hotspotPos: [0.88, 0.41, 1.18],
    secondaryHotspots: [
      [-0.88, 0.41, 1.18],
      [0.88, 0.41, -1.18],
      [-0.88, 0.41, -1.18],
    ],
    cameraPos: [4.35, 1.15, 1.85],
    cameraTarget: [0, 0.42, 0.0],
    preferXray: false,
  },
  hydraulics: {
    id: "hydraulics",
    nameTh: "ชุดสายลม-สายไฟพ่วง (แดง-เหลือง) และถังพักลมใต้ท้อง",
    nameEn: "Coiled Air/Electric Jumper Hoses & Air Reservoir Tank",
    locationTh: "สายลมขดหน้าแขนลาก ข้อต่อสวมเร็ว และถังเก็บลมใต้ท้องกลางหาง",
    primaryRepairCategory: "ไฮดรอลิค",
    matchedCategories: ["ไฮดรอลิค", "PM ไฮดรอลิค"],
    descriptionTh: "สายลมขดสีแดง-เหลือง (Emergency/Service), หัวคอปเปอร์ต่อหัวลาก, วาล์วระบายน้ำ และถังพักลมใต้ท้อง",
    commonSymptoms: [
      "สายลมขดแดง-เหลืองแตก รั่ว หรือหัวต่อหลวม",
      "ลมรั่วที่ถังพักลมหรือข้อต่อท่อลมใต้ท้อง",
      "วาล์วเดรนน้ำใต้ถังลมค้างหรือรั่วซึม",
    ],
    hotspotPos: [0.38, 0.68, 2.0],
    secondaryHotspots: [[0.38, 0.62, -0.05]],
    cameraPos: [3.45, 1.65, 3.25],
    cameraTarget: [0.22, 0.64, 1.05],
    preferXray: true,
  },
  lighting: {
    id: "lighting",
    nameTh: "ชุดไฟท้าย LED ไฟราวข้าง แถบสะท้อนแสง และปลั๊กไฟพ่วง",
    nameEn: "Rear LED Tail Lamps, Side Markers & Safety Reflectors",
    locationTh: "แผงไฟท้ายด้านหลัง ไฟราวข้างซ้าย-ขวา และแถบสะท้อนแสงรอบคัน",
    primaryRepairCategory: "ระบบไฟรถ",
    matchedCategories: ["ระบบไฟรถ", "ระบบเซนเซอร์"],
    descriptionTh: "ชุดไฟท้าย LED (ไฟหรี่/เบรค/เลี้ยว), ไฟราวข้างสีส้ม 6 จุด, แถบสะท้อนแสงขอบข้าง และสายปลั๊กไฟพ่วง",
    commonSymptoms: [
      "ไฟท้าย / ไฟเบรค / ไฟเลี้ยวหางลากไม่ติด",
      "ไฟราวข้างขาดหรือโคมแตกชำรุด",
      "ปลั๊กไฟเชื่อมต่อหัวลากหลวมหรือสายไฟขาดใน",
    ],
    hotspotPos: [0, 0.89, -1.92],
    secondaryHotspots: [
      [1.02, 0.89, 0.02],
      [-1.02, 0.89, 0.02],
    ],
    cameraPos: [3.25, 1.55, -3.65],
    cameraTarget: [0, 0.78, -1.05],
    preferXray: false,
  },
  overview: {
    id: "overview",
    nameTh: "ตรวจเช็กสภาพหางลาก TTL รอบคัน",
    nameEn: "Full Flatbed Trailer TTL Diagnostic Scan",
    locationTh: "สแกนภาพรวมระบบหลักทั้งคัน (แขนลาก, จานหมุนเลี้ยว, เบรคลม, ล้อ-ยาง, ไฟท้าย)",
    primaryRepairCategory: "ซ่อมเชิงป้องกัน (PM)",
    matchedCategories: ["ซ่อมเชิงป้องกัน (PM)", "ซ่อมทั่วไป (MN)", "อื่นๆ"],
    descriptionTh: "ตรวจเช็กตามรอบบำรุงรักษา PM หรือแจ้งซ่อมทั่วไป สามารถคลิกจุดชิ้นส่วนบนตัวหางลากเพื่อระบุตำแหน่งเฉพาะได้",
    commonSymptoms: [
      "ตรวจเช็ก PM หางลากตามรอบและอัดจาระบีจานหมุน",
      "ตรวจเช็กระบบเบรคลม สายลม และไฟท้ายพ่วง",
      "อาการอื่น ๆ ทั่วไป",
    ],
    hotspotPos: [0, 0.82, 0.35],
    secondaryHotspots: [
      [0, 0.48, 2.72],
      [0, 0.74, 1.18],
      [0.88, 0.41, 1.18],
    ],
    cameraPos: [4.55, 2.25, 4.15],
    cameraTarget: [0, 0.62, 0.35],
    preferXray: true,
  },
};

export const TRAILER_INTERACTIVE_ZONE_LIST: EvRepairZoneSpec[] = [
  TRAILER_REPAIR_ZONES.structure,
  TRAILER_REPAIR_ZONES.suspension,
  TRAILER_REPAIR_ZONES.brakes,
  TRAILER_REPAIR_ZONES.tires,
  TRAILER_REPAIR_ZONES.hydraulics,
  TRAILER_REPAIR_ZONES.lighting,
];

// ============================================================================
// UNIFIED MULTI-MODEL LOOKUP HELPERS
// ============================================================================

export function getInteractiveZoneListForModel(
  modelKind: RepairVehicleModelKind
): EvRepairZoneSpec[] {
  switch (modelKind) {
    case "ev_tractor":
      return EV_INTERACTIVE_ZONE_LIST;
    case "diesel_tractor":
      return DIESEL_TRACTOR_INTERACTIVE_ZONE_LIST;
    case "forklift":
      return FORKLIFT_INTERACTIVE_ZONE_LIST;
    case "clamp_truck":
      return CLAMP_TRUCK_INTERACTIVE_ZONE_LIST;
    case "trailer":
      return TRAILER_INTERACTIVE_ZONE_LIST;
  }
}

export function getOverviewZoneForModel(
  modelKind: RepairVehicleModelKind
): EvRepairZoneSpec {
  switch (modelKind) {
    case "ev_tractor":
      return EV_REPAIR_ZONES.overview;
    case "diesel_tractor":
      return DIESEL_TRACTOR_REPAIR_ZONES.overview;
    case "forklift":
      return FORKLIFT_REPAIR_ZONES.overview;
    case "clamp_truck":
      return CLAMP_TRUCK_REPAIR_ZONES.overview;
    case "trailer":
      return TRAILER_REPAIR_ZONES.overview;
  }
}

export function getZoneByIdForModel(
  modelKind: RepairVehicleModelKind,
  zoneId: EvRepairZoneId
): EvRepairZoneSpec | null {
  if (zoneId === "overview") return getOverviewZoneForModel(modelKind);
  const list = getInteractiveZoneListForModel(modelKind);
  return list.find((z) => z.id === zoneId) || null;
}

export function getZoneForRepairCategoryByModel(
  modelKind: RepairVehicleModelKind,
  repairType: string
): EvRepairZoneSpec {
  const clean = (repairType || "").trim();
  const overview = getOverviewZoneForModel(modelKind);
  if (!clean) return overview;
  const list = getInteractiveZoneListForModel(modelKind);
  for (const zone of list) {
    if (zone.matchedCategories.includes(clean)) {
      return zone;
    }
  }
  return overview;
}

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
 * Backwards-compatible EV category resolver.
 */
export function getEvZoneForRepairCategory(repairType: string): EvRepairZoneSpec {
  return getZoneForRepairCategoryByModel("ev_tractor", repairType);
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
export function extractZoneFromDescriptionByModel(
  modelKind: RepairVehicleModelKind,
  description?: string
): EvRepairZoneSpec | null {
  const text = (description || "").trim();
  const match = text.match(REPAIR_PART_TAG_REGEX);
  if (!match) return null;
  const taggedLabel = match[1].trim().toLowerCase();
  const list = getInteractiveZoneListForModel(modelKind);
  for (const zone of list) {
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

export function extractEvZoneFromDescription(
  description?: string
): EvRepairZoneSpec | null {
  return extractZoneFromDescriptionByModel("ev_tractor", description);
}
