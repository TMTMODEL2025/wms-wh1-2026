/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Check } from "lucide-react";
import {
  VehicleTypeCandidate,
  isClampTruckVehicle,
  isForkliftVehicle,
  isTractorVehicle,
  isTrailerVehicle,
} from "../utils/vehicleHelpers";
import forkliftEightWheelImg from "../assets/images/forklift_eight_wheel_topdown_1795767239875.jpg";
import forkliftSixWheelImg from "../assets/images/forklift_six_wheel_topdown_1795768525751.jpg";
import trailerFourWheelImg from "../assets/images/trailer_four_wheel_topdown_1795768528894.jpg";
import trailerTwelveWheelImg from "../assets/images/trailer_twelve_wheel_topdown_1795768529888.jpg";
import tractorFourWheelImg from "../assets/images/tractor_four_wheel_topdown_1795769518611.jpg";
import tractorSixWheelImg from "../assets/images/tractor_six_wheel_topdown_1795769519935.jpg";
import clampTruckEightWheelImg from "../assets/images/sc_clamp_eight_wheel_topdown_1795770729731.jpg";

export type VehicleWheelProfileKey =
  | "fl_6w"
  | "tt_4w"
  | "tt_6w"
  | "sc_8w"
  | "ttl_4w"
  | "ttl_12w"
  | "default_8w";

export type WheelCalloutCode =
  | "FL"
  | "FR"
  | "RL"
  | "RR"
  | "FLI"
  | "FLO"
  | "FRI"
  | "FRO"
  | "RLI"
  | "RLO"
  | "RRI"
  | "RRO"
  | "RL1I"
  | "RL1O"
  | "RR1I"
  | "RR1O"
  | "RL2I"
  | "RL2O"
  | "RR2I"
  | "RR2O";

export interface ForkliftWheelCallout {
  code: WheelCalloutCode;
  label: string;
  side: "left" | "right";
  /** Target circular dot on the 1600x900 3D top-down render */
  dotX: number;
  dotY: number;
  /** Elbow bend point so leader lines never cross */
  elbowX: number;
  elbowY: number;
  /** Horizontal line endpoint attaching to the label pill */
  endX: number;
  endY: number;
  /** Pill bounding box in 1600x900 SVG coordinates */
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  fontSize?: number;
}

interface WheelDiagramProfile {
  key: VehicleWheelProfileKey;
  title: string;
  specBadge: string;
  imageSrc: string;
  imageAlt: string;
  callouts: ForkliftWheelCallout[];
  extraGroupOptions: string[];
}

/** 1) รถ FL ทั้งหมด — 6 ล้อ (ล้อหน้าซ้าย-ขวา ข้างละ 2 ล้อ นอก/ใน, ล้อหลังซ้าย-ขวา ข้างละ 1 ล้อ) */
const FL_SIX_WHEEL_CALLOUTS: ForkliftWheelCallout[] = [
  {
    code: "FLI",
    label: "ล้อหน้าซ้ายใน (FLI)",
    side: "left",
    dotX: 674,
    dotY: 302,
    elbowX: 598,
    elbowY: 184,
    endX: 462,
    endY: 184,
    boxX: 42,
    boxY: 155,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FLO",
    label: "ล้อหน้าซ้ายนอก (FLO)",
    side: "left",
    dotX: 615,
    dotY: 302,
    elbowX: 556,
    elbowY: 274,
    endX: 462,
    endY: 274,
    boxX: 42,
    boxY: 245,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FRI",
    label: "ล้อหน้าขวาใน (FRI)",
    side: "right",
    dotX: 926,
    dotY: 302,
    elbowX: 1002,
    elbowY: 184,
    endX: 1138,
    endY: 184,
    boxX: 1138,
    boxY: 155,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FRO",
    label: "ล้อหน้าขวานอก (FRO)",
    side: "right",
    dotX: 985,
    dotY: 302,
    elbowX: 1044,
    elbowY: 274,
    endX: 1138,
    endY: 274,
    boxX: 1138,
    boxY: 245,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RL",
    label: "ล้อหลังซ้าย (RL)",
    side: "left",
    dotX: 622,
    dotY: 758,
    elbowX: 548,
    elbowY: 758,
    endX: 462,
    endY: 758,
    boxX: 42,
    boxY: 729,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RR",
    label: "ล้อหลังขวา (RR)",
    side: "right",
    dotX: 978,
    dotY: 758,
    elbowX: 1052,
    elbowY: 758,
    endX: 1138,
    endY: 758,
    boxX: 1138,
    boxY: 729,
    boxW: 420,
    boxH: 58,
  },
];

/** 1B) รถหัวลาก TT รุ่นล้อเดี่ยว 4 ล้อ (เบอร์ TT-03 ถึง TT-15 และ TT-19 ถึง TT-27 / TTEV) */
const TT_FOUR_WHEEL_CALLOUTS: ForkliftWheelCallout[] = [
  {
    code: "FL",
    label: "ล้อหน้าซ้าย (FL)",
    side: "left",
    dotX: 612,
    dotY: 254,
    elbowX: 548,
    elbowY: 254,
    endX: 462,
    endY: 254,
    boxX: 42,
    boxY: 225,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FR",
    label: "ล้อหน้าขวา (FR)",
    side: "right",
    dotX: 988,
    dotY: 254,
    elbowX: 1052,
    elbowY: 254,
    endX: 1138,
    endY: 254,
    boxX: 1138,
    boxY: 225,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RL",
    label: "ล้อหลังซ้าย (RL)",
    side: "left",
    dotX: 576,
    dotY: 666,
    elbowX: 520,
    elbowY: 666,
    endX: 462,
    endY: 666,
    boxX: 42,
    boxY: 637,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RR",
    label: "ล้อหลังขวา (RR)",
    side: "right",
    dotX: 1024,
    dotY: 666,
    elbowX: 1080,
    elbowY: 666,
    endX: 1138,
    endY: 666,
    boxX: 1138,
    boxY: 637,
    boxW: 420,
    boxH: 58,
  },
];

/** 1C) รถหัวลาก TT รุ่นล้อหน้าเดี่ยว ล้อหลังคู่ รวม 6 ล้อ (เบอร์ TT-16 ถึง TT-18) */
const TT_SIX_WHEEL_CALLOUTS: ForkliftWheelCallout[] = [
  {
    code: "FL",
    label: "ล้อหน้าซ้าย (FL)",
    side: "left",
    dotX: 612,
    dotY: 248,
    elbowX: 548,
    elbowY: 248,
    endX: 462,
    endY: 248,
    boxX: 42,
    boxY: 219,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FR",
    label: "ล้อหน้าขวา (FR)",
    side: "right",
    dotX: 988,
    dotY: 248,
    elbowX: 1052,
    elbowY: 248,
    endX: 1138,
    endY: 248,
    boxX: 1138,
    boxY: 219,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RLO",
    label: "ล้อหลังซ้ายนอก (RLO)",
    side: "left",
    dotX: 558,
    dotY: 655,
    elbowX: 518,
    elbowY: 646,
    endX: 462,
    endY: 646,
    boxX: 42,
    boxY: 617,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RLI",
    label: "ล้อหลังซ้ายใน (RLI)",
    side: "left",
    dotX: 624,
    dotY: 736,
    elbowX: 594,
    elbowY: 782,
    endX: 462,
    endY: 782,
    boxX: 42,
    boxY: 753,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RRO",
    label: "ล้อหลังขวานอก (RRO)",
    side: "right",
    dotX: 1042,
    dotY: 655,
    elbowX: 1082,
    elbowY: 646,
    endX: 1138,
    endY: 646,
    boxX: 1138,
    boxY: 617,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RRI",
    label: "ล้อหลังขวาใน (RRI)",
    side: "right",
    dotX: 976,
    dotY: 736,
    elbowX: 1006,
    elbowY: 782,
    endX: 1138,
    endY: 782,
    boxX: 1138,
    boxY: 753,
    boxW: 420,
    boxH: 58,
  },
];

/** 1D) รถคีบ SC (SC-* / หแ-*) — 8 ล้อคู่ (ล้อคู่ หน้า-หลัง ข้างละ 2 ล้อ) */
const SC_EIGHT_WHEEL_CALLOUTS: ForkliftWheelCallout[] = [
  {
    code: "FLI",
    label: "ล้อหน้าซ้ายใน (FLI)",
    side: "left",
    dotX: 693,
    dotY: 312,
    elbowX: 616,
    elbowY: 198,
    endX: 462,
    endY: 198,
    boxX: 42,
    boxY: 169,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FLO",
    label: "ล้อหน้าซ้ายนอก (FLO)",
    side: "left",
    dotX: 646,
    dotY: 312,
    elbowX: 566,
    elbowY: 286,
    endX: 462,
    endY: 286,
    boxX: 42,
    boxY: 257,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FRI",
    label: "ล้อหน้าขวาใน (FRI)",
    side: "right",
    dotX: 907,
    dotY: 312,
    elbowX: 984,
    elbowY: 198,
    endX: 1138,
    endY: 198,
    boxX: 1138,
    boxY: 169,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FRO",
    label: "ล้อหน้าขวานอก (FRO)",
    side: "right",
    dotX: 954,
    dotY: 312,
    elbowX: 1034,
    elbowY: 286,
    endX: 1138,
    endY: 286,
    boxX: 1138,
    boxY: 257,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RLO",
    label: "ล้อหลังซ้ายนอก (RLO)",
    side: "left",
    dotX: 592,
    dotY: 684,
    elbowX: 530,
    elbowY: 670,
    endX: 462,
    endY: 670,
    boxX: 42,
    boxY: 641,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RLI",
    label: "ล้อหลังซ้ายใน (RLI)",
    side: "left",
    dotX: 654,
    dotY: 748,
    elbowX: 634,
    elbowY: 836,
    endX: 462,
    endY: 836,
    boxX: 42,
    boxY: 807,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RRO",
    label: "ล้อหลังขวานอก (RRO)",
    side: "right",
    dotX: 1008,
    dotY: 684,
    elbowX: 1070,
    elbowY: 670,
    endX: 1138,
    endY: 670,
    boxX: 1138,
    boxY: 641,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RRI",
    label: "ล้อหลังขวาใน (RRI)",
    side: "right",
    dotX: 946,
    dotY: 748,
    elbowX: 966,
    elbowY: 836,
    endX: 1138,
    endY: 836,
    boxX: 1138,
    boxY: 807,
    boxW: 420,
    boxH: 58,
  },
];

/** 2) หางลาก TTL-16, TTL-33, TTL-36 — 4 ล้อเดี่ยว (ล้อหน้า-หลัง ข้างละ 1 ล้อ) */
const TTL_FOUR_WHEEL_CALLOUTS: ForkliftWheelCallout[] = [
  {
    code: "FL",
    label: "ล้อหน้าซ้าย (FL)",
    side: "left",
    dotX: 632,
    dotY: 336,
    elbowX: 548,
    elbowY: 336,
    endX: 462,
    endY: 336,
    boxX: 42,
    boxY: 307,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FR",
    label: "ล้อหน้าขวา (FR)",
    side: "right",
    dotX: 968,
    dotY: 336,
    elbowX: 1052,
    elbowY: 336,
    endX: 1138,
    endY: 336,
    boxX: 1138,
    boxY: 307,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RL",
    label: "ล้อหลังซ้าย (RL)",
    side: "left",
    dotX: 632,
    dotY: 734,
    elbowX: 548,
    elbowY: 734,
    endX: 462,
    endY: 734,
    boxX: 42,
    boxY: 705,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RR",
    label: "ล้อหลังขวา (RR)",
    side: "right",
    dotX: 968,
    dotY: 734,
    elbowX: 1052,
    elbowY: 734,
    endX: 1138,
    endY: 734,
    boxX: 1138,
    boxY: 705,
    boxW: 420,
    boxH: 58,
  },
];

/** 3) หางลาก TTL ที่เหลือทั้งหมด — 12 ล้อ (ล้อหน้าซ้าย-ขวา ข้างละ 2 ล้อ + ล้อหลัง 2 เพลา ข้างละ 2 ล้อ รวม 8 ล้อ) */
const TTL_TWELVE_WHEEL_CALLOUTS: ForkliftWheelCallout[] = [
  // Front Axle (4 tires)
  {
    code: "FLI",
    label: "ล้อหน้าซ้ายใน (FLI)",
    side: "left",
    dotX: 719,
    dotY: 244,
    elbowX: 640,
    elbowY: 172,
    endX: 492,
    endY: 172,
    boxX: 30,
    boxY: 146,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "FLO",
    label: "ล้อหน้าซ้ายนอก (FLO)",
    side: "left",
    dotX: 681,
    dotY: 244,
    elbowX: 612,
    elbowY: 244,
    endX: 492,
    endY: 244,
    boxX: 30,
    boxY: 218,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "FRI",
    label: "ล้อหน้าขวาใน (FRI)",
    side: "right",
    dotX: 881,
    dotY: 244,
    elbowX: 960,
    elbowY: 172,
    endX: 1108,
    endY: 172,
    boxX: 1108,
    boxY: 146,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "FRO",
    label: "ล้อหน้าขวานอก (FRO)",
    side: "right",
    dotX: 919,
    dotY: 244,
    elbowX: 988,
    elbowY: 244,
    endX: 1108,
    endY: 244,
    boxX: 1108,
    boxY: 218,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  // Rear Axle 1 (4 tires)
  {
    code: "RL1I",
    label: "หลังเพลา 1 ซ้ายใน (RL1I)",
    side: "left",
    dotX: 719,
    dotY: 608,
    elbowX: 638,
    elbowY: 536,
    endX: 492,
    endY: 536,
    boxX: 30,
    boxY: 510,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "RL1O",
    label: "หลังเพลา 1 ซ้ายนอก (RL1O)",
    side: "left",
    dotX: 668,
    dotY: 656,
    elbowX: 602,
    elbowY: 628,
    endX: 492,
    endY: 628,
    boxX: 30,
    boxY: 602,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "RR1I",
    label: "หลังเพลา 1 ขวาใน (RR1I)",
    side: "right",
    dotX: 881,
    dotY: 608,
    elbowX: 962,
    elbowY: 536,
    endX: 1108,
    endY: 536,
    boxX: 1108,
    boxY: 510,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "RR1O",
    label: "หลังเพลา 1 ขวานอก (RR1O)",
    side: "right",
    dotX: 932,
    dotY: 656,
    elbowX: 998,
    elbowY: 628,
    endX: 1108,
    endY: 628,
    boxX: 1108,
    boxY: 602,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  // Rear Axle 2 (4 tires)
  {
    code: "RL2O",
    label: "หลังเพลา 2 ซ้ายนอก (RL2O)",
    side: "left",
    dotX: 668,
    dotY: 780,
    elbowX: 602,
    elbowY: 758,
    endX: 492,
    endY: 758,
    boxX: 30,
    boxY: 732,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "RL2I",
    label: "หลังเพลา 2 ซ้ายใน (RL2I)",
    side: "left",
    dotX: 719,
    dotY: 830,
    elbowX: 672,
    elbowY: 858,
    endX: 492,
    endY: 858,
    boxX: 30,
    boxY: 832,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "RR2O",
    label: "หลังเพลา 2 ขวานอก (RR2O)",
    side: "right",
    dotX: 932,
    dotY: 780,
    elbowX: 998,
    elbowY: 758,
    endX: 1108,
    endY: 758,
    boxX: 1108,
    boxY: 732,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
  {
    code: "RR2I",
    label: "หลังเพลา 2 ขวาใน (RR2I)",
    side: "right",
    dotX: 881,
    dotY: 830,
    elbowX: 928,
    elbowY: 858,
    endX: 1108,
    endY: 858,
    boxX: 1108,
    boxY: 832,
    boxW: 462,
    boxH: 52,
    fontSize: 23,
  },
];

/** 4) ค่าเริ่มต้น / รถประเภทอื่น — 8 ล้อคู่มาตรฐาน */
export const FORKLIFT_DUAL_WHEEL_CALLOUTS: ForkliftWheelCallout[] = [
  {
    code: "FLI",
    label: "ล้อหน้าซ้ายใน (FLI)",
    side: "left",
    dotX: 674,
    dotY: 302,
    elbowX: 598,
    elbowY: 184,
    endX: 462,
    endY: 184,
    boxX: 42,
    boxY: 155,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FLO",
    label: "ล้อหน้าซ้ายนอก (FLO)",
    side: "left",
    dotX: 615,
    dotY: 302,
    elbowX: 556,
    elbowY: 274,
    endX: 462,
    endY: 274,
    boxX: 42,
    boxY: 245,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FRI",
    label: "ล้อหน้าขวาใน (FRI)",
    side: "right",
    dotX: 926,
    dotY: 302,
    elbowX: 1002,
    elbowY: 184,
    endX: 1138,
    endY: 184,
    boxX: 1138,
    boxY: 155,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "FRO",
    label: "ล้อหน้าขวานอก (FRO)",
    side: "right",
    dotX: 985,
    dotY: 302,
    elbowX: 1044,
    elbowY: 274,
    endX: 1138,
    endY: 274,
    boxX: 1138,
    boxY: 245,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RLO",
    label: "ล้อหลังซ้ายนอก (RLO)",
    side: "left",
    dotX: 594,
    dotY: 756,
    elbowX: 546,
    elbowY: 744,
    endX: 462,
    endY: 744,
    boxX: 42,
    boxY: 715,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RLI",
    label: "ล้อหลังซ้ายใน (RLI)",
    side: "left",
    dotX: 664,
    dotY: 826,
    elbowX: 632,
    elbowY: 856,
    endX: 462,
    endY: 856,
    boxX: 42,
    boxY: 827,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RRO",
    label: "ล้อหลังขวานอก (RRO)",
    side: "right",
    dotX: 1006,
    dotY: 756,
    elbowX: 1054,
    elbowY: 744,
    endX: 1138,
    endY: 744,
    boxX: 1138,
    boxY: 715,
    boxW: 420,
    boxH: 58,
  },
  {
    code: "RRI",
    label: "ล้อหลังขวาใน (RRI)",
    side: "right",
    dotX: 936,
    dotY: 826,
    elbowX: 968,
    elbowY: 856,
    endX: 1138,
    endY: 856,
    boxX: 1138,
    boxY: 827,
    boxW: 420,
    boxH: 58,
  },
];

const WHEEL_DIAGRAM_PROFILES: Record<VehicleWheelProfileKey, WheelDiagramProfile> = {
  fl_6w: {
    key: "fl_6w",
    title: "ผังตำแหน่งล้อรถโฟล์คลิฟท์ FL (6 ล้อ: หน้าคู่ 4 / หลังเดี่ยว 2)",
    specBadge: "6 ล้อ (หน้า 2+2 · หลัง 1+1)",
    imageSrc: forkliftSixWheelImg,
    imageAlt: "ผังตำแหน่งล้อรถโฟล์คลิฟท์ FL 6 ล้อ (หน้าคู่ หลังเดี่ยว)",
    callouts: FL_SIX_WHEEL_CALLOUTS,
    extraGroupOptions: [
      "ล้อหน้าซ้าย (FL)",
      "ล้อหน้าขวา (FR)",
      "คู่ล้อหน้า (Front Pair)",
      "คู่ล้อหลัง (Rear Pair)",
      "ครบชุด 6 ล้อ (Full Set)",
    ],
  },
  tt_4w: {
    key: "tt_4w",
    title: "ผังตำแหน่งล้อรถหัวลาก TT (4 ล้อเดี่ยว: หน้าเดี่ยว / หลังเดี่ยว)",
    specBadge: "4 ล้อเดี่ยว (หน้า 1+1 · หลัง 1+1)",
    imageSrc: tractorFourWheelImg,
    imageAlt: "ผังตำแหน่งล้อรถหัวลาก TT รุ่นล้อเดี่ยว 4 ล้อ",
    callouts: TT_FOUR_WHEEL_CALLOUTS,
    extraGroupOptions: [
      "คู่ล้อหน้า (Front Pair)",
      "คู่ล้อหลัง (Rear Pair)",
      "ครบชุด 4 ล้อ (Full Set)",
    ],
  },
  tt_6w: {
    key: "tt_6w",
    title: "ผังตำแหน่งล้อรถหัวลาก TT (6 ล้อ: หน้าเดี่ยว 2 / หลังคู่ 4)",
    specBadge: "6 ล้อ (หน้า 1+1 · หลังคู่ 2+2)",
    imageSrc: tractorSixWheelImg,
    imageAlt: "ผังตำแหน่งล้อรถหัวลาก TT รุ่นล้อหน้าเดี่ยว ล้อหลังคู่ รวม 6 ล้อ",
    callouts: TT_SIX_WHEEL_CALLOUTS,
    extraGroupOptions: [
      "ล้อหลังซ้าย (RL)",
      "ล้อหลังขวา (RR)",
      "คู่ล้อหน้า (Front Pair)",
      "คู่ล้อหลัง (Rear Pair)",
      "ครบชุด 6 ล้อ (Full Set)",
    ],
  },
  sc_8w: {
    key: "sc_8w",
    title: "ผังตำแหน่งล้อรถคีบ SC (8 ล้อคู่: หน้าคู่ 4 / หลังคู่ 4)",
    specBadge: "8 ล้อคู่ (หน้า 2+2 · หลัง 2+2)",
    imageSrc: clampTruckEightWheelImg,
    imageAlt: "ผังตำแหน่งล้อรถคีบ SC แบบ 8 ล้อคู่ หน้า-หลัง ข้างละ 2 ล้อ",
    callouts: SC_EIGHT_WHEEL_CALLOUTS,
    extraGroupOptions: [
      "ล้อหน้าซ้าย (FL)",
      "ล้อหน้าขวา (FR)",
      "ล้อหลังซ้าย (RL)",
      "ล้อหลังขวา (RR)",
      "คู่ล้อหน้า (Front Pair)",
      "คู่ล้อหลัง (Rear Pair)",
      "ครบชุด 8 ล้อ (Full Set)",
    ],
  },
  ttl_4w: {
    key: "ttl_4w",
    title: "ผังตำแหน่งล้อหางลาก TTL (4 ล้อเดี่ยว: ข้างละ 1 ล้อ)",
    specBadge: "4 ล้อ (หน้า 1+1 · หลัง 1+1)",
    imageSrc: trailerFourWheelImg,
    imageAlt: "ผังตำแหน่งล้อหางลาก TTL แบบ 4 ล้อเดี่ยว",
    callouts: TTL_FOUR_WHEEL_CALLOUTS,
    extraGroupOptions: [
      "คู่ล้อหน้า (Front Pair)",
      "คู่ล้อหลัง (Rear Pair)",
      "ครบชุด 4 ล้อ (Full Set)",
    ],
  },
  ttl_12w: {
    key: "ttl_12w",
    title: "ผังตำแหน่งล้อหางลาก TTL (12 ล้อ: หน้า 4 / หลัง 2 เพลา 8 ล้อ)",
    specBadge: "12 ล้อ (หน้า 2+2 · หลัง 2 เพลา 8 ล้อ)",
    imageSrc: trailerTwelveWheelImg,
    imageAlt: "ผังตำแหน่งล้อหางลาก TTL แบบ 12 ล้อ (ล้อหน้าคู่ + ล้อหลัง 2 เพลาคู่)",
    callouts: TTL_TWELVE_WHEEL_CALLOUTS,
    extraGroupOptions: [
      "ล้อหน้าซ้าย (FL)",
      "ล้อหน้าขวา (FR)",
      "เพลาหน้า 4 ล้อ (Front Pair)",
      "เพลาหลัง 1 (Rear Axle 1)",
      "เพลาหลัง 2 (Rear Axle 2)",
      "คู่เพลาหลัง 8 ล้อ (Rear Pair)",
      "ครบชุด 12 ล้อ (Full Set)",
    ],
  },
  default_8w: {
    key: "default_8w",
    title: "ผังตำแหน่งล้อ (มุมมองด้านบน 8 ล้อคู่) — เปลี่ยนตามเบอร์รถที่เลือกอัตโนมัติ",
    specBadge: "8 ล้อคู่มาตรฐาน",
    imageSrc: forkliftEightWheelImg,
    imageAlt: "ผังตำแหน่งล้อรถโฟล์คลิฟท์ 8 ล้อคู่ มุมมองด้านบน",
    callouts: FORKLIFT_DUAL_WHEEL_CALLOUTS,
    extraGroupOptions: [
      "ล้อหน้าซ้าย (FL)",
      "ล้อหน้าขวา (FR)",
      "ล้อหลังซ้าย (RL)",
      "ล้อหลังขวา (RR)",
      "คู่ล้อหน้า (Front Pair)",
      "คู่ล้อหลัง (Rear Pair)",
      "ครบชุด (Full Set)",
    ],
  },
};

const SINGLE_WHEEL_TTL_NUMBERS = new Set([16, 33, 36]);

export function resolveWheelProfileForVehicle(
  vehicleId?: string,
  vehicle?: VehicleTypeCandidate
): VehicleWheelProfileKey {
  const raw = String(vehicleId || vehicle?.vehicleId || "")
    .trim()
    .toUpperCase();
  const compact = raw.replace(/[\s_-]+/g, "");

  if (
    compact.startsWith("SC") ||
    compact.startsWith("หแ") ||
    compact.startsWith("CLAMP") ||
    (vehicle && isClampTruckVehicle(vehicle))
  ) {
    return "sc_8w";
  }

  if (compact.startsWith("TTL") || (vehicle && isTrailerVehicle(vehicle))) {
    const numMatch = compact.match(/^TTL0*(\d+)$/);
    if (numMatch && SINGLE_WHEEL_TTL_NUMBERS.has(Number(numMatch[1]))) {
      return "ttl_4w";
    }
    return "ttl_12w";
  }

  if (
    compact.startsWith("TTEV") ||
    compact.startsWith("TT") ||
    (vehicle && isTractorVehicle(vehicle))
  ) {
    const ttNumMatch = compact.match(/^TT(?:EV)?0*(\d+)$/);
    if (ttNumMatch) {
      const ttNum = Number(ttNumMatch[1]);
      if (ttNum >= 16 && ttNum <= 18) {
        return "tt_6w";
      }
    }
    return "tt_4w";
  }

  if (compact.startsWith("FL") || (vehicle && isForkliftVehicle(vehicle))) {
    return "fl_6w";
  }

  return "default_8w";
}

export function getWheelPositionOptionsForVehicle(
  vehicleId?: string,
  vehicle?: VehicleTypeCandidate
): string[] {
  const profileKey = resolveWheelProfileForVehicle(vehicleId, vehicle);
  const profile = WHEEL_DIAGRAM_PROFILES[profileKey];
  return [...profile.callouts.map((c) => c.label), ...profile.extraGroupOptions];
}

function isCalloutHighlighted(
  code: WheelCalloutCode,
  selectedPosition: string
): boolean {
  if (!selectedPosition) return false;
  if (selectedPosition.includes(`(${code})`)) return true;
  if (selectedPosition.includes("(FL)")) return code === "FL" || code === "FLI" || code === "FLO";
  if (selectedPosition.includes("(FR)")) return code === "FR" || code === "FRI" || code === "FRO";
  if (selectedPosition.includes("(RL)")) {
    return code === "RL" || code === "RLI" || code === "RLO";
  }
  if (selectedPosition.includes("(RR)")) {
    return code === "RR" || code === "RRI" || code === "RRO";
  }
  if (selectedPosition.includes("Front Pair")) {
    return (
      code === "FL" ||
      code === "FR" ||
      code === "FLI" ||
      code === "FLO" ||
      code === "FRI" ||
      code === "FRO"
    );
  }
  if (selectedPosition.includes("Rear Axle 1")) {
    return code === "RL1I" || code === "RL1O" || code === "RR1I" || code === "RR1O";
  }
  if (selectedPosition.includes("Rear Axle 2")) {
    return code === "RL2I" || code === "RL2O" || code === "RR2I" || code === "RR2O";
  }
  if (selectedPosition.includes("Rear Pair")) {
    return (
      code === "RL" ||
      code === "RR" ||
      code === "RLI" ||
      code === "RLO" ||
      code === "RRI" ||
      code === "RRO" ||
      code === "RL1I" ||
      code === "RL1O" ||
      code === "RR1I" ||
      code === "RR1O" ||
      code === "RL2I" ||
      code === "RL2O" ||
      code === "RR2I" ||
      code === "RR2O"
    );
  }
  if (selectedPosition.includes("Full Set")) return true;
  return false;
}

interface ForkliftWheelPositionDiagramProps {
  vehicleId?: string;
  vehicle?: VehicleTypeCandidate;
  selectedPosition: string;
  onSelectPosition: (position: string) => void;
}

export function ForkliftWheelPositionDiagram({
  vehicleId,
  vehicle,
  selectedPosition,
  onSelectPosition,
}: ForkliftWheelPositionDiagramProps) {
  const profileKey = resolveWheelProfileForVehicle(vehicleId, vehicle);
  const profile = WHEEL_DIAGRAM_PROFILES[profileKey];

  return (
    <div className="rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/80 dark:bg-[#0d1b33]/80 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
            {profile.title}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200/80 text-slate-700 dark:bg-[#162744] dark:text-slate-200 tabular-nums">
            {vehicleId ? `${vehicleId} · ${profile.specBadge}` : profile.specBadge}
          </span>
        </div>
        {selectedPosition ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-[#087eaf] border border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-700">
            <Check size={11} strokeWidth={3} />
            {selectedPosition}
          </span>
        ) : (
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            คลิกเลือกตำแหน่งล้อบนภาพ
          </span>
        )}
      </div>

      <div className="relative w-full aspect-[16/9] bg-[#f8fafc] select-none overflow-hidden">
        <img
          src={profile.imageSrc}
          alt={profile.imageAlt}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover block pointer-events-none"
        />

        <svg
          viewBox="0 0 1600 900"
          className="absolute inset-0 w-full h-full"
          role="img"
          aria-label={profile.imageAlt}
        >
          {profile.callouts.map((item) => {
            const active = isCalloutHighlighted(item.code, selectedPosition);
            const strokeColor = active ? "#087eaf" : "#0f2942";
            const fillColor = active ? "#087eaf" : "#ffffff";
            const textColor = active ? "#ffffff" : "#0f2942";
            const pillStroke = active ? "#075985" : "#0f2942";
            const textX = item.boxX + item.boxW / 2;
            const textY = item.boxY + item.boxH / 2 + 1;

            return (
              <g
                key={item.code}
                onClick={() => onSelectPosition(item.label)}
                className="cursor-pointer group"
                role="button"
                tabIndex={0}
                aria-label={`เลือก ${item.label}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPosition(item.label);
                  }
                }}
              >
                {/* Leader line halo for crisp contrast on grid & tire edges */}
                <polyline
                  points={`${item.dotX},${item.dotY} ${item.elbowX},${item.elbowY} ${item.endX},${item.endY}`}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={active ? 7.5 : 6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.92}
                />
                {/* Main technical dark-navy / active Fiori blue leader line */}
                <polyline
                  points={`${item.dotX},${item.dotY} ${item.elbowX},${item.elbowY} ${item.endX},${item.endY}`}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={active ? 4 : 3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Circular target dot on the tire */}
                {active && (
                  <circle
                    cx={item.dotX}
                    cy={item.dotY}
                    r={16}
                    fill="#087eaf"
                    opacity={0.28}
                  />
                )}
                <circle
                  cx={item.dotX}
                  cy={item.dotY}
                  r={active ? 10.5 : 8.5}
                  fill="#ffffff"
                />
                <circle
                  cx={item.dotX}
                  cy={item.dotY}
                  r={active ? 7.5 : 5.8}
                  fill={strokeColor}
                />

                {/* Label badge box */}
                <rect
                  x={item.boxX}
                  y={item.boxY}
                  width={item.boxW}
                  height={item.boxH}
                  rx={10}
                  ry={10}
                  fill={fillColor}
                  fillOpacity={active ? 0.98 : 0.95}
                  stroke={pillStroke}
                  strokeWidth={active ? 3 : 2.2}
                />

                {/* Crisp Thai / English position label */}
                <text
                  x={textX}
                  y={textY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={textColor}
                  fontSize={item.fontSize ?? 26}
                  fontWeight="700"
                  style={{ fontFamily: "'Noto Sans Thai', sans-serif" }}
                >
                  {item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
