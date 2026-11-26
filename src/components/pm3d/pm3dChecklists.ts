/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MhPm3dModelType, MhRepairPhotoItem } from "../../services/forkliftDataService";

export type Pm3dItemStatus = "pending" | "ok" | "issue" | "replaced";

export interface Pm3dChecklistTemplateItem {
  id: string;
  label: string;
  specHint?: string;
}

export interface Pm3dZoneDefinition {
  id: string;
  modelType: MhPm3dModelType;
  label: string;
  shortLabel: string;
  englishLabel: string;
  repairCategory: string;
  /** Anchor position in local vehicle coordinates [x, y, z] when closed */
  anchor: [number, number, number];
  /** Anchor position when hood/exploded inspection mode is active */
  openAnchor?: [number, number, number];
  /** Ideal camera offset relative to the anchor when focusing this zone */
  cameraOffset: [number, number, number];
  /** If true, clicking this zone automatically opens the hood / inspection view */
  requiresOpenHood?: boolean;
  defaultItems: Pm3dChecklistTemplateItem[];
}

export interface Pm3dZoneSessionData {
  itemStatuses: Record<string, Pm3dItemStatus>;
  notes: string;
  cost: string;
  photos: MhRepairPhotoItem[];
  linkedRepairNo?: string;
}

export interface Pm3dModelMeta {
  id: MhPm3dModelType;
  label: string;
  shortLabel: string;
  subtitle: string;
  supportsTrailerCoupling: boolean;
  supportsOpenHood: boolean;
  openHoodLabel: string;
}

export const PM3D_MODELS: Record<MhPm3dModelType, Pm3dModelMeta> = {
  diesel_tractor: {
    id: "diesel_tractor",
    label: "รถลากจูงดีเซล (Diesel)",
    shortLabel: "เครื่องดีเซล",
    subtitle: "รถลากจูงเครื่องยนต์ดีเซลพร้อมห้องเครื่องเปิดตรวจได้",
    supportsTrailerCoupling: true,
    supportsOpenHood: true,
    openHoodLabel: "เปิดฝากระโปรงดูเครื่องดีเซล",
  },
  ev_tractor: {
    id: "ev_tractor",
    label: "รถลากจูงไฟฟ้า (EV)",
    shortLabel: "ไฟฟ้า EV",
    subtitle: "รถลากจูงพลังงานไฟฟ้าพร้อมชุดแบตเตอรี่แรงสูง & อินเวอร์เตอร์",
    supportsTrailerCoupling: true,
    supportsOpenHood: true,
    openHoodLabel: "เปิดฝากระโปรงดูแบตเตอรี่ EV",
  },
  forklift: {
    id: "forklift",
    label: "รถโฟล์คลิฟท์ (Forklift)",
    shortLabel: "โฟล์คลิฟท์",
    subtitle: "รถโฟล์คลิฟท์มาตรฐานสากลพร้อมเสายก ไฮดรอลิค และโครงกันตก ROPS",
    supportsTrailerCoupling: false,
    supportsOpenHood: true,
    openHoodLabel: "เปิดฝาครอบห้องเครื่อง",
  },
  trailer: {
    id: "trailer",
    label: "หางเทลเลอร์ (Flatbed Trailer)",
    shortLabel: "หางเทลเลอร์",
    subtitle: "หางพ่วงพื้นเรียบลายตีนเป็ด คานลาก A-Frame สายลม และจานหมุน",
    supportsTrailerCoupling: false,
    supportsOpenHood: false,
    openHoodLabel: "มุมตรวจช่วงล่าง",
  },
};

export const PM3D_MODEL_LIST: Pm3dModelMeta[] = [
  PM3D_MODELS.diesel_tractor,
  PM3D_MODELS.ev_tractor,
  PM3D_MODELS.forklift,
  PM3D_MODELS.trailer,
];

export const DEFAULT_PM3D_ZONES: Record<MhPm3dModelType, Pm3dZoneDefinition[]> = {
  diesel_tractor: [
    {
      id: "diesel_engine",
      modelType: "diesel_tractor",
      label: "เครื่องยนต์ดีเซล & น้ำมันเครื่อง",
      shortLabel: "เครื่องยนต์ดีเซล",
      englishLabel: "Diesel Engine & Oil",
      repairCategory: "ระบบเครื่องยนต์ (Engine)",
      anchor: [0.0, 1.02, 0.92],
      openAnchor: [0.0, 1.15, 0.92],
      cameraOffset: [2.1, 1.4, 2.2],
      requiresOpenHood: true,
      defaultItems: [
        { id: "de_1", label: "ตรวจระดับและสภาพน้ำมันเครื่อง / เปลี่ยนถ่ายตามรอบ", specHint: "ระดับระหว่าง Min–Max" },
        { id: "de_2", label: "เปลี่ยนไส้กรองน้ำมันเครื่องและตรวจรอยรั่วซึมซีลเครื่อง", specHint: "ไม่มีคราบน้ำมันหยด" },
        { id: "de_3", label: "ตรวจความตึงและสภาพสายพานหน้าเครื่อง (พัดลม/ไดชาร์จ)", specHint: "ไม่แตกลายงา ไม่หย่อน" },
        { id: "de_4", label: "ฟังเสียงเดินเบาและตรวจการสั่นสะเทือนแท่นเครื่อง", specHint: "เดินเรียบ ไม่มีเสียงเคาะ" },
      ],
    },
    {
      id: "diesel_cooling",
      modelType: "diesel_tractor",
      label: "หม้อน้ำ & ระบบระบายความร้อน",
      shortLabel: "หม้อน้ำ/หล่อเย็น",
      englishLabel: "Radiator & Cooling",
      repairCategory: "ระบบระบายความร้อน (Cooling)",
      anchor: [0.0, 0.72, 1.46],
      openAnchor: [0.0, 0.85, 1.44],
      cameraOffset: [1.5, 1.0, 2.5],
      requiresOpenHood: true,
      defaultItems: [
        { id: "dc_1", label: "ตรวจระดับน้ำยาหล่อเย็นในหม้อน้ำและถังพักน้ำ", specHint: "ใช้น้ำยาหล่อเย็นตามสเปค" },
        { id: "dc_2", label: "เป่าทำความสะอาดครีบระบายความร้อนและตะแกรงหน้ารถ", specHint: "ไม่มีฝุ่น/เศษวัสดุอุดตัน" },
        { id: "dc_3", label: "ตรวจท่อยางหม้อน้ำ เข็มขัดรัดท่อ และฝาหม้อน้ำ", specHint: "ไม่บวมกรอบ ไม่รั่วซึม" },
      ],
    },
    {
      id: "diesel_fuel_air",
      modelType: "diesel_tractor",
      label: "กรองอากาศ & ระบบน้ำมันเชื้อเพลิง",
      shortLabel: "กรองอากาศ/ดีเซล",
      englishLabel: "Air Filter & Fuel System",
      repairCategory: "ระบบเชื้อเพลิง (Fuel System)",
      anchor: [-0.46, 0.96, 0.88],
      openAnchor: [-0.48, 1.08, 0.88],
      cameraOffset: [-2.2, 1.3, 1.9],
      requiresOpenHood: true,
      defaultItems: [
        { id: "df_1", label: "เป่าทำความสะอาดหรือเปลี่ยนไส้กรองอากาศ", specHint: "ไม่อุดตัน ไม่ฉีกขาด" },
        { id: "df_2", label: "เดรนน้ำดักเชื้อเพลิงและเปลี่ยนกรองโซล่าตามระยะ", specHint: "ไม่มีน้ำปนในถังดัก" },
        { id: "df_3", label: "ตรวจท่อส่งน้ำมันดีเซล ปั๊มหัวฉีด และฝาถังน้ำมัน", specHint: "ไม่รั่วซึม ปิดสนิท" },
      ],
    },
    {
      id: "diesel_exhaust",
      modelType: "diesel_tractor",
      label: "ระบบท่อไอเสีย & แบตเตอรี่สตาร์ท",
      shortLabel: "ท่อไอเสีย/แบต 12V",
      englishLabel: "Exhaust & Starter Battery",
      repairCategory: "ระบบไอเสียและไฟฟ้าสตาร์ท",
      anchor: [0.58, 0.42, -0.45],
      cameraOffset: [2.4, 0.8, -1.6],
      defaultItems: [
        { id: "dx_1", label: "ตรวจท่อไอเสีย หม้อพัก และยางแขวนท่อไม่ให้รั่วหรือหลวม", specHint: "ควันไม่ดำผิดปกติ" },
        { id: "dx_2", label: "ตรวจขั้วแบตเตอรี่สตาร์ท 12V ระดับน้ำกลั่น และแรงดันไฟชาร์จ", specHint: "12.6V / ชาร์จ 13.8-14.4V" },
      ],
    },
    {
      id: "tractor_cabin",
      modelType: "diesel_tractor",
      label: "ห้องคนขับ กระจก ไฟหน้า & ไฟไซเรน",
      shortLabel: "ห้องคนขับ & ไฟ",
      englishLabel: "Cabin, Lights & Beacon",
      repairCategory: "ระบบไฟฟ้าและอุปกรณ์ความปลอดภัย",
      anchor: [0.0, 1.78, -0.15],
      cameraOffset: [2.2, 1.5, 1.6],
      defaultItems: [
        { id: "tc_1", label: "ทดสอบไฟหน้า ไฟเลี้ยวหน้า-หลัง ไฟเบรค และไฟไซเรนหลังคา", specHint: "ติดครบทุกดวงชัดเจน" },
        { id: "tc_2", label: "ตรวจกระจกหน้า ใบปัดน้ำฝน กระจกมองข้างซ้าย-ขวา และแตรสัญญาณ", specHint: "มองเห็นชัดไม่แตกร้าว" },
        { id: "tc_3", label: "ตรวจเบาะนั่ง เข็มขัดนิรภัย พวงมาลัย และคันเกียร์/เบรคมือ", specHint: "ล็อคแน่น ใช้งานคล่อง" },
      ],
    },
    {
      id: "tractor_wheels",
      modelType: "diesel_tractor",
      label: "ล้อ ยาง ช่วงล่าง & ระบบเบรค",
      shortLabel: "ล้อ ยาง & เบรค",
      englishLabel: "Wheels, Tires & Brakes",
      repairCategory: "ระบบเบรค ล้อ และช่วงล่าง",
      anchor: [0.78, 0.42, 0.72],
      cameraOffset: [2.6, 0.85, 1.6],
      defaultItems: [
        { id: "tw_1", label: "ตรวจสภาพดอกยาง ลมยางหน้า-หลัง และรอยฉีกขาดแก้มยาง", specHint: "แรงดันตามมาตรฐาน" },
        { id: "tw_2", label: "ตรวจขันน็อตล้อทั้ง 4 ล้อ และลูกปืนดุมล้อ", specHint: "ไม่มีน็อตคลาย/โยก" },
        { id: "tw_3", label: "ตรวจระดับน้ำมันเบรค ความหนาผ้าเบรค และระยะฟรีแป้นเบรค", specHint: "เบรคหยุดสนิทไม่ดึงข้าง" },
        { id: "tw_4", label: "อัดจาระบีลูกหมากคันชัก คันส่ง และจุดหมุนเพลาหน้า", specHint: "อัดจาระบีครบทุกจุด" },
      ],
    },
    {
      id: "tractor_hitch",
      modelType: "diesel_tractor",
      label: "ชุดขอพ่วงท้าย & โครงสร้างตัวถัง",
      shortLabel: "ขอพ่วงท้าย",
      englishLabel: "Rear Tow Hitch & Chassis",
      repairCategory: "โครงสร้างตัวถังและชุดลากจูง",
      anchor: [0.0, 0.56, -1.48],
      cameraOffset: [1.7, 0.9, -2.5],
      defaultItems: [
        { id: "th_1", label: "ตรวจสลักพ่วง (Tow Pin) ตัวล็อคนิรภัย และปากนกแก้วท้ายรถ", specHint: "สลักไม่สึก ล็อคแน่น" },
        { id: "th_2", label: "อัดจาระบีชุดขอพ่วงและตรวจน็อตยึดแชสซีท้าย", specHint: "ไม่มีรอยร้าวรอยเชื่อม" },
        { id: "th_3", label: "ตรวจไฟท้าย แถบสะท้อนแสง และเสียงเตือนถอยหลัง", specHint: "ทำงานปกติเมื่อเข้าเกียร์ถอย" },
      ],
    },
  ],

  ev_tractor: [
    {
      id: "ev_battery",
      modelType: "ev_tractor",
      label: "ชุดแบตเตอรี่แรงสูง (HV Battery Pack)",
      shortLabel: "แบตเตอรี่ EV",
      englishLabel: "HV Battery Pack",
      repairCategory: "ระบบแบตเตอรี่และพลังงานไฟฟ้า (EV)",
      anchor: [0.0, 0.96, 0.86],
      openAnchor: [0.0, 1.12, 0.86],
      cameraOffset: [2.1, 1.45, 2.2],
      requiresOpenHood: true,
      defaultItems: [
        { id: "eb_1", label: "ตรวจค่า State of Health (SOH) แรงดันรวม และสมดุลเซลล์แบตเตอรี่", specHint: "Cell balance ปกติ ไม่มี Fault" },
        { id: "eb_2", label: "ตรวจขั้วต่อแบตเตอรี่ น็อตยึดโมดูล และความสะอาดภายในห้องแบต", specHint: "ไม่มีคราบขี้เกลือ/ความชื้น" },
        { id: "eb_3", label: "ตรวจพัดลมระบายความร้อนและอุณหภูมิชุดแบตเตอรี่ขณะใช้งาน", specHint: "อุณหภูมิไม่เกินเกณฑ์" },
      ],
    },
    {
      id: "ev_inverter",
      modelType: "ev_tractor",
      label: "อินเวอร์เตอร์ & คอนโทรลเลอร์ไฟฟ้า",
      shortLabel: "อินเวอร์เตอร์",
      englishLabel: "Inverter & Controller",
      repairCategory: "ระบบควบคุมไฟฟ้าและอินเวอร์เตอร์",
      anchor: [-0.42, 0.96, 1.18],
      openAnchor: [-0.46, 1.08, 1.18],
      cameraOffset: [-2.1, 1.35, 2.2],
      requiresOpenHood: true,
      defaultItems: [
        { id: "ei_1", label: "ตรวจรหัส Error Code / Log บนกล่อง Controller และ BMS", specHint: "ไม่มี Active Fault" },
        { id: "ei_2", label: "เป่าฝุ่นครีบระบายความร้อน (Heatsink) อินเวอร์เตอร์และ DC-DC", specHint: "ระบายความร้อนสะดวก" },
        { id: "ei_3", label: "ตรวจคอนแทคเตอร์หลัก ฟิวส์แรงสูง และรีเลย์ควบคุม", specHint: "หน้าสัมผัสไม่ไหม้" },
      ],
    },
    {
      id: "ev_motor",
      modelType: "ev_tractor",
      label: "มอเตอร์ขับเคลื่อนไฟฟ้า & เพลาขับ",
      shortLabel: "มอเตอร์ขับเคลื่อน",
      englishLabel: "EV Traction Motor",
      repairCategory: "ระบบมอเตอร์และส่งกำลัง (EV)",
      anchor: [0.36, 0.56, -0.58],
      openAnchor: [0.36, 0.72, -0.58],
      cameraOffset: [2.4, 0.95, -1.5],
      requiresOpenHood: true,
      defaultItems: [
        { id: "em_1", label: "ตรวจเสียงลูกปืนมอเตอร์ขับเคลื่อนและการสั่นสะเทือนขณะออกตัว", specHint: "เงียบเรียบ ไม่มีเสียงหอน" },
        { id: "em_2", label: "ตรวจระดับน้ำมันเฟืองท้าย/เกียร์ทด และซีลเพลาขับ", specHint: "ไม่รั่วซึม ระดับปกติ" },
        { id: "em_3", label: "ตรวจจุดเชื่อมต่อสาย 3 เฟสและเซ็นเซอร์รอบมอเตอร์ (Encoder)", specHint: "ขั้วแน่นไม่หลวม" },
      ],
    },
    {
      id: "ev_charger",
      modelType: "ev_tractor",
      label: "ช่องชาร์จไฟ & สายไฟแรงสูงสีส้ม",
      shortLabel: "ช่องชาร์จ/HV Cable",
      englishLabel: "Charging Port & HV Cables",
      repairCategory: "ระบบชาร์จและสายไฟแรงสูง",
      anchor: [-0.74, 0.84, -0.25],
      cameraOffset: [-2.4, 1.05, -0.4],
      defaultItems: [
        { id: "ec_1", label: "ตรวจสภาพหัวปลั๊กชาร์จ พินทองแดง และฝาปิดกันน้ำ/ฝุ่น", specHint: "ไม่มีรอยไหม้ ปิดสนิท" },
        { id: "ec_2", label: "ตรวจฉนวนหุ้มสายไฟแรงสูงสีส้ม (HV Harness) ตลอดแนวเดินสาย", specHint: "ไม่ถลอก ไม่กรอบแตก" },
        { id: "ec_3", label: "ทดสอบสวิตช์ตัดไฟฉุกเฉิน (Emergency Stop) และระบบตัดไฟขณะชาร์จ", specHint: "ตัดวงจรได้ทันที" },
      ],
    },
    {
      id: "ev_cabin",
      modelType: "ev_tractor",
      label: "ห้องคนขับ จอแสดงแบต & ไฟสัญญาณ",
      shortLabel: "ห้องคนขับ & จอ EV",
      englishLabel: "Cabin, Display & Lights",
      repairCategory: "ระบบไฟฟ้าและอุปกรณ์ความปลอดภัย",
      anchor: [0.0, 1.78, -0.15],
      cameraOffset: [2.2, 1.5, 1.6],
      defaultItems: [
        { id: "evc_1", label: "ตรวจจอแสดง % แบตเตอรี่ (SOC) มิเตอร์ชั่วโมง และไฟเตือนหน้าปัด", specHint: "แสดงผลครบถ้วนแม่นยำ" },
        { id: "evc_2", label: "ทดสอบไฟหน้า ไฟเลี้ยว ไฟเบรค ไฟไซเรนหลังคา และใบปัดน้ำฝน", specHint: "ทำงานครบทุกจุด" },
        { id: "evc_3", label: "ตรวจเบาะคู่ กระจกมองข้าง เข็มขัดนิรภัย และคันเร่งไฟฟ้า", specHint: "คืนตัวนุ่มนวลไม่ค้าง" },
      ],
    },
    {
      id: "ev_wheels",
      modelType: "ev_tractor",
      label: "ล้อ ยาง ช่วงล่าง & ระบบเบรค",
      shortLabel: "ล้อ ยาง & เบรค",
      englishLabel: "Wheels, Tires & Brakes",
      repairCategory: "ระบบเบรค ล้อ และช่วงล่าง",
      anchor: [0.78, 0.42, 0.72],
      cameraOffset: [2.6, 0.85, 1.6],
      defaultItems: [
        { id: "evw_1", label: "ตรวจสภาพดอกยาง แรงดันลมยาง และขันปอนด์น็อตล้อทั้ง 4 ล้อ", specHint: "ครบแน่นตามสเปค" },
        { id: "evw_2", label: "ตรวจระบบเบรคไฟฟ้า (Regen Brake) ผ้าเบรค และน้ำมันเบรค", specHint: "เบรคนุ่มนวลหยุดมั่นคง" },
        { id: "evw_3", label: "อัดจาระบีจุดหมุนเพลาหน้าและลูกหมากบังคับเลี้ยว", specHint: "พวงมาลัยเลี้ยวคล่อง" },
      ],
    },
    {
      id: "ev_hitch",
      modelType: "ev_tractor",
      label: "ชุดขอพ่วงท้าย & โครงสร้างตัวถัง",
      shortLabel: "ขอพ่วงท้าย",
      englishLabel: "Rear Tow Hitch & Chassis",
      repairCategory: "โครงสร้างตัวถังและชุดลากจูง",
      anchor: [0.0, 0.56, -1.48],
      cameraOffset: [1.7, 0.9, -2.5],
      defaultItems: [
        { id: "evh_1", label: "ตรวจสลักลากพ่วง ตัวล็อคนิรภัย และความแข็งแรงโครงสร้างท้าย", specHint: "ไม่สึกหรอ ไม่ร้าว" },
        { id: "evh_2", label: "อัดจาระบีขอพ่วงและทดสอบเสียงเตือนถอยหลัง / ไฟท้าย", specHint: "ทำงานสมบูรณ์" },
      ],
    },
  ],

  forklift: [
    {
      id: "fl_mast_forks",
      modelType: "forklift",
      label: "เสายก โซ่ยก & ชุดงา (Mast & Forks)",
      shortLabel: "เสายก & งา",
      englishLabel: "Mast, Chains & Forks",
      repairCategory: "ระบบเสายกและชุดงา (Mast/Forks)",
      anchor: [0.0, 1.35, 1.48],
      cameraOffset: [2.2, 1.4, 2.5],
      defaultItems: [
        { id: "fm_1", label: "ตรวจสภาพงายก รอยร้าวโคนงา ความหนาใบงา และตัวล็อคงา", specHint: "งาไม่คดงอ ล็อคแน่น" },
        { id: "fm_2", label: "ตรวจความตึงโซ่ยกทั้ง 2 ข้าง หล่อลื่นโซ่ และตรวจสลักยึดโซ่", specHint: "ตึงเท่ากันทั้งซ้าย-ขวา" },
        { id: "fm_3", label: "ตรวจลูกกลิ้งเสายก (Mast Rollers) รางเสา และแผงกันสินค้าตก", specHint: "ขึ้น-ลงเรียบไม่สะดุด" },
      ],
    },
    {
      id: "fl_hydraulics",
      modelType: "forklift",
      label: "ระบบไฮดรอลิค & กระบอกยก/เอียง",
      shortLabel: "ไฮดรอลิค",
      englishLabel: "Hydraulic System & Cylinders",
      repairCategory: "ระบบไฮดรอลิค (Hydraulic)",
      anchor: [0.35, 0.95, 1.08],
      cameraOffset: [2.4, 1.1, 2.1],
      defaultItems: [
        { id: "fh_1", label: "ตรวจระดับและสภาพน้ำมันไฮดรอลิค / เปลี่ยนไส้กรองตามรอบ", specHint: "น้ำมันใส ระดับปกติ" },
        { id: "fh_2", label: "ตรวจซีลกระบอกยก (Lift) และกระบอกเอียงเสา (Tilt) ทั้ง 2 ข้าง", specHint: "ไม่มีคราบน้ำมันรั่วซึม" },
        { id: "fh_3", label: "ตรวจสายอ่อนไฮดรอลิค ข้อต่อ และวาล์วควบคุม (Control Valve)", specHint: "ไม่บวม ไม่ถลอก" },
      ],
    },
    {
      id: "fl_powertrain",
      modelType: "forklift",
      label: "ห้องเครื่องยนต์ / ระบบขับเคลื่อน",
      shortLabel: "ห้องเครื่อง/ปั๊ม",
      englishLabel: "Powertrain & Pump Bay",
      repairCategory: "ระบบเครื่องยนต์และส่งกำลัง",
      anchor: [0.0, 0.98, -0.25],
      openAnchor: [0.0, 1.24, -0.25],
      cameraOffset: [2.3, 1.5, -0.6],
      requiresOpenHood: true,
      defaultItems: [
        { id: "fp_1", label: "ตรวจน้ำมันเครื่อง น้ำมันเกียร์ และไส้กรองต่างๆ ใต้ฝาครอบเบาะ", specHint: "เปลี่ยนตามชั่วโมงใช้งาน" },
        { id: "fp_2", label: "ตรวจปั๊มไฮดรอลิค หม้อน้ำ พัดลม และสายพานหน้าเครื่อง", specHint: "ไม่รั่วซึม ทำงานปกติ" },
        { id: "fp_3", label: "ตรวจแบตเตอรี่ ขั้วสายไฟ และความสะอาดห้องเครื่อง", specHint: "ไม่มีคราบน้ำมันสะสม" },
      ],
    },
    {
      id: "fl_cabin",
      modelType: "forklift",
      label: "ห้องคนขับ พวงมาลัย & คันควบคุม",
      shortLabel: "ห้องคนขับ",
      englishLabel: "Operator Compartment",
      repairCategory: "ห้องคนขับและระบบควบคุม",
      anchor: [-0.32, 1.32, 0.2],
      cameraOffset: [-2.3, 1.45, 1.4],
      defaultItems: [
        { id: "fc_1", label: "ทดสอบคันโยกควบคุม ยก-วาง เอียงเสา และ Side Shift", specHint: "ตอบสนองนุ่มนวลไม่ค้าง" },
        { id: "fc_2", label: "ตรวจพวงมาลัยเพาเวอร์ หน้าปัดเกจวัด ชั่วโมงทำงาน และแตร", specHint: "แสดงผลครบถ้วน" },
        { id: "fc_3", label: "ตรวจเบาะนั่ง เข็มขัดนิรภัย และแป้นเหยียบเบรค/อินชิ่ง", specHint: "ใช้งานปลอดภัย" },
      ],
    },
    {
      id: "fl_rops_lights",
      modelType: "forklift",
      label: "โครงกันตก ROPS & ไฟเตือนความปลอดภัย",
      shortLabel: "ROPS & ไฟเตือน",
      englishLabel: "Overhead Guard & Safety Lights",
      repairCategory: "ระบบไฟฟ้าและอุปกรณ์ความปลอดภัย",
      anchor: [0.0, 2.15, -0.1],
      cameraOffset: [2.3, 2.2, 1.8],
      defaultItems: [
        { id: "fr_1", label: "ตรวจความแข็งแรงโครงหลังคากันตก ROPS และจุดเชื่อมยึด", specHint: "ไม่บิดเบี้ยว ไม่แตกร้าว" },
        { id: "fr_2", label: "ทดสอบไฟส่องสว่างหน้า-หลัง ไฟไซเรน และ Blue Spot / Red Zone", specHint: "สว่างชัดเจนครบทุกดวง" },
        { id: "fr_3", label: "ตรวจกระจกมองหลังและเสียงสัญญาณเตือนถอยหลัง", specHint: "ได้ยินและมองเห็นชัด" },
      ],
    },
    {
      id: "fl_wheels",
      modelType: "forklift",
      label: "ล้อ ยางตัน & ระบบเบรค",
      shortLabel: "ล้อ ยาง & เบรค",
      englishLabel: "Drive/Steer Tires & Brakes",
      repairCategory: "ระบบเบรค ล้อ และช่วงล่าง",
      anchor: [0.68, 0.36, 0.65],
      cameraOffset: [2.5, 0.8, 1.6],
      defaultItems: [
        { id: "fw_1", label: "ตรวจสภาพยางตันหน้า-หลัง ความลึกดอกยาง และรอยบิ่นฉีกขาด", specHint: "ไม่สึกถึงเส้น Wear Line" },
        { id: "fw_2", label: "ตรวจขันน็อตล้อ ดุมล้อ และลูกปืนเพลาบังคับเลี้ยวหลัง", specHint: "ไม่คลายไม่คลอน" },
        { id: "fw_3", label: "ทดสอบเบรคเท้าและเบรคมือบนทางลาด / ตรวจน้ำมันเบรค", specHint: "หยุดสนิทตามมาตรฐาน" },
      ],
    },
    {
      id: "fl_counterweight",
      modelType: "forklift",
      label: "ตุ้มถ่วงน้ำหนัก & พินลากท้าย",
      shortLabel: "ตุ้มถ่วงท้าย",
      englishLabel: "Counterweight & Rear Pin",
      repairCategory: "โครงสร้างตัวถังและตุ้มถ่วง",
      anchor: [0.0, 0.92, -1.25],
      cameraOffset: [1.9, 1.25, -2.5],
      defaultItems: [
        { id: "fcw_1", label: "ตรวจน็อตยึดตุ้มถ่วงน้ำหนัก ช่องระบายลมหลัง และพินลากท้าย", specHint: "แน่นหนาไม่มีสิ่งกีดขวาง" },
        { id: "fcw_2", label: "ตรวจไฟท้าย แผ่นป้ายพิกัดน้ำหนัก (Load Chart) และสติกเกอร์เตือน", specHint: "อ่านชัดเจนครบถ้วน" },
      ],
    },
  ],

  trailer: [
    {
      id: "tr_drawbar",
      modelType: "trailer",
      label: "คานลากสามเหลี่ยม ห่วงลาก & โซ่นิรภัย",
      shortLabel: "คานลาก & โซ่",
      englishLabel: "A-Frame Drawbar & Hitch Eye",
      repairCategory: "ชุดคานลากและข้อต่อพ่วง",
      anchor: [0.0, 0.56, 2.75],
      cameraOffset: [2.0, 1.1, 2.6],
      defaultItems: [
        { id: "td_1", label: "ตรวจห่วงลาก (Lunette Eye) รอยสึกหรอ รอยร้าว และน็อตยึดหัวลาก", specHint: "ไม่ร้าว ไม่สึกเกินพิกัด" },
        { id: "td_2", label: "ตรวจโครงคานลากสามเหลี่ยม A-Frame และสลักบานพับจุดหมุน", specHint: "แนวเชื่อมสมบูรณ์ไม่บิดงอ" },
        { id: "td_3", label: "ตรวจโซ่นิรภัย ตะขอเกี่ยว และอัดจาระบีจุดหมุนคานลาก", specHint: "โซ่ไม่ขาด ตะขอล็อคปกติ" },
      ],
    },
    {
      id: "tr_air_electric",
      modelType: "trailer",
      label: "สายลมเบรค & ปลั๊กไฟพ่วง (ขดแดง-เหลือง)",
      shortLabel: "สายลม/ไฟพ่วง",
      englishLabel: "Coiled Air & Electric Lines",
      repairCategory: "ระบบลมเบรคและไฟฟ้าพ่วง",
      anchor: [0.46, 0.72, 1.98],
      cameraOffset: [2.1, 1.05, 2.1],
      defaultItems: [
        { id: "ta_1", label: "ตรวจสายลมขดสีแดง-เหลือง และหัวคัปปลิ้งว่าไม่มีลมรั่วหรือกรอบแตก", specHint: "ไม่มีเสียงลมรั่ว" },
        { id: "ta_2", label: "ตรวจสายไฟพ่วง ปลั๊กเชื่อมต่อ และยางกันน้ำข้อต่อไฟฟ้า", specHint: "ขั้วไม่เป็นสนิม ไฟส่งครบ" },
      ],
    },
    {
      id: "tr_turntable",
      modelType: "trailer",
      label: "จานหมุนบังคับเลี้ยว & ชุดแหนบหน้า",
      shortLabel: "จานหมุน & แหนบ",
      englishLabel: "Turntable & Leaf Springs",
      repairCategory: "ระบบช่วงล่างและจานหมุนพ่วง",
      anchor: [0.0, 0.55, 1.28],
      cameraOffset: [2.5, 0.9, 1.7],
      defaultItems: [
        { id: "tt_1", label: "อัดจาระบีจานหมุนบังคับเลี้ยว (Turntable Bearing) ให้ทั่วรอบวง", specHint: "หมุนลื่นไม่ฝืดไม่คลอน" },
        { id: "tt_2", label: "ตรวจตับแหนบ สาแหรก (U-Bolt) สลักโตงเตง และน็อตยึดเพลาหน้า-หลัง", specHint: "แหนบไม่หัก สาแหรกแน่น" },
      ],
    },
    {
      id: "tr_deck",
      modelType: "trailer",
      label: "พื้นบรรทุกลายตีนเป็ด & โครงสร้างแชสซี",
      shortLabel: "พื้นตีนเป็ด/แชสซี",
      englishLabel: "Checkered Steel Deck & Frame",
      repairCategory: "โครงสร้างพื้นบรรทุกหางพ่วง",
      anchor: [0.0, 0.96, -0.1],
      cameraOffset: [2.8, 1.9, 1.8],
      defaultItems: [
        { id: "tdk_1", label: "ตรวจแผ่นเหล็กลายตีนเป็ด รอยเชื่อมพื้น และความเรียบไม่แอ่นยุบ", specHint: "พื้นแข็งแรงไม่ทะลุผุ" },
        { id: "tdk_2", label: "ตรวจคานแชสซีหลัก ขอบกันตก และจุดผูกมัดสินค้า (Tie-Down)", specHint: "ไม่มีรอยร้าวที่คานหลัก" },
      ],
    },
    {
      id: "tr_wheels",
      modelType: "trailer",
      label: "ล้อ ยาง ดุมล้อ & น็อตล้อ 4 จุด",
      shortLabel: "ล้อ & ยาง 4 จุด",
      englishLabel: "Trailer Tires, Rims & Hubs",
      repairCategory: "ระบบล้อ ยาง และเบรคหางพ่วง",
      anchor: [-0.96, 0.44, -0.85],
      cameraOffset: [-2.8, 0.85, -1.2],
      defaultItems: [
        { id: "trw_1", label: "ตรวจดอกยาง แก้มยาง และเติมลมยางทั้ง 4 ล้อตามพิกัดบรรทุก", specHint: "ไม่มีรอยบวม/บาดลึก" },
        { id: "trw_2", label: "ตรวจขันน็อตล้อ ตรวจสภาพกระทะล้อ และอัดจาระบีลูกปืนดุมล้อ", specHint: "ดุมไม่ร้อน ล้อไม่โยก" },
        { id: "trw_3", label: "ตรวจชุดเบรคหางพ่วง ผ้าเบรค และหม้อลมเบรค (ถ้ามี)", specHint: "ทำงานประสานรถลากปกติ" },
      ],
    },
    {
      id: "tr_reflectors",
      modelType: "trailer",
      label: "แถบสะท้อนแสงเหลือง-ดำ & ไฟสัญญาณรอบหาง",
      shortLabel: "แถบเตือน & ไฟ",
      englishLabel: "Hazard Stripes & Reflectors",
      repairCategory: "อุปกรณ์ความปลอดภัยและไฟสัญญาณ",
      anchor: [0.94, 0.86, -1.55],
      cameraOffset: [2.4, 1.05, -2.5],
      defaultItems: [
        { id: "trf_1", label: "ตรวจแถบสะท้อนแสงเตือนเหลือง-ดำ รอบขอบข้างและด้านหน้า-หลัง", specHint: "ไม่หลุดลอก มองเห็นชัด" },
        { id: "trf_2", label: "ตรวจไฟหรี่ข้าง ไฟเลี้ยว ไฟเบรคท้าย และแผ่นทับทิมสะท้อนแสง", specHint: "ติดครบทุกดวงไม่แตก" },
      ],
    },
  ],
};

const CUSTOM_CHECKLIST_STORAGE_KEY = "tmt_pm3d_custom_checklists_v1";

export type CustomChecklistMap = Record<string, Pm3dChecklistTemplateItem[]>;

export function loadCustomPm3dChecklists(): CustomChecklistMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CUSTOM_CHECKLIST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCustomPm3dChecklists(map: CustomChecklistMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_CHECKLIST_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function getZoneChecklistItems(
  zone: Pm3dZoneDefinition,
  customMap: CustomChecklistMap
): Pm3dChecklistTemplateItem[] {
  const override = customMap[zone.id];
  if (Array.isArray(override)) {
    return override;
  }
  return zone.defaultItems;
}

export function inferPm3dModelType(
  vehicleType?: string,
  vehicleDescription?: string,
  vehicleId?: string
): MhPm3dModelType {
  const combined = `${vehicleType || ""} ${vehicleDescription || ""} ${vehicleId || ""}`
    .trim()
    .toLowerCase();

  if (
    combined.includes("trailer") ||
    combined.includes("หาง") ||
    combined.includes("เทลเลอร์") ||
    combined.includes("เทรลเลอร์") ||
    /\btr[-_\s]?\d/i.test(combined) ||
    /\btl[-_\s]?\d/i.test(combined)
  ) {
    return "trailer";
  }

  if (
    combined.includes("forklift") ||
    combined.includes("โฟล์คลิฟท์") ||
    combined.includes("โฟคลิฟ") ||
    /\bfl[-_\s]?\d/i.test(combined)
  ) {
    return "forklift";
  }

  if (
    combined.includes("ttev") ||
    combined.includes("หัวลากไฟฟ้า") ||
    combined.includes("electrictractor") ||
    combined.includes("ev") ||
    combined.includes("electric") ||
    combined.includes("ไฟฟ้า") ||
    combined.includes("แบต")
  ) {
    return "ev_tractor";
  }

  if (
    combined.includes("tractor") ||
    combined.includes("tugger") ||
    combined.includes("diesel") ||
    combined.includes("ดีเซล") ||
    combined.includes("ลากจูง") ||
    /\btt[-_\s]?\d/i.test(combined)
  ) {
    return "diesel_tractor";
  }

  return "diesel_tractor";
}

export function computeZoneAggregateStatus(
  items: Pm3dChecklistTemplateItem[],
  session?: Pm3dZoneSessionData
): Pm3dItemStatus {
  if (!session || items.length === 0) return "pending";
  let hasIssue = false;
  let hasReplaced = false;
  let checkedCount = 0;

  for (const item of items) {
    const st = session.itemStatuses[item.id] || "pending";
    if (st === "issue") {
      hasIssue = true;
      checkedCount += 1;
    } else if (st === "replaced") {
      hasReplaced = true;
      checkedCount += 1;
    } else if (st === "ok") {
      checkedCount += 1;
    }
  }

  if (hasIssue) return "issue";
  if (hasReplaced) return "replaced";
  if (checkedCount > 0 && checkedCount === items.length) return "ok";
  if (checkedCount > 0) return "ok";
  return "pending";
}

/** Compress an uploaded image file to JPEG DataURL safe for Firestore (< 240KB) */
export function compressPmPhotoFile(file: File): Promise<MhRepairPhotoItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพได้"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("ไฟล์รูปภาพไม่ถูกต้อง"));
      img.onload = () => {
        const maxDim = 960;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("ไม่สามารถประมวลผลรูปภาพได้"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.78;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > 260000 && quality > 0.35) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }

        resolve({
          id: `PMPH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || "pm_photo.jpg",
          dataUrl,
          sizeBytes: dataUrl.length,
          uploadedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
        });
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}
