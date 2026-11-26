/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  RotateCcw,
  Truck,
  User,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Vehicle, VehicleAssignment } from "../../types/officer";
import {
  MhMaintenanceRecord,
  MhPm3dModelType,
  MhRepairPhotoItem,
  inferMhWorkflowStage,
} from "../../services/forkliftDataService";
import {
  getVehicleTypeDisplayLabel,
  isClampTruckVehicle,
  isElectricTractorVehicle,
  isForkliftVehicle,
  isStandardTractorVehicle,
  isTrailerVehicle,
} from "../../utils/vehicleHelpers";
import {
  Pm3dTexturePack,
  VehicleDecalStyle,
  buildVehicleByModelType,
  createPm3dTexturePack,
  createVehicleNumberDecalTexture,
} from "../pm3d/pm3dVehicleBuilders";

export type ParkingZoneId =
  | "diesel_tractor"
  | "ev_tractor"
  | "forklift"
  | "trailer"
  | "clamp_truck";

type YardModelType = MhPm3dModelType | "clamp_truck";

interface ZoneDefinition {
  id: ParkingZoneId;
  title: string;
  shortTitle: string;
  subtitle: string;
  accentHex: number;
  accentCss: string;
  badgeTextCss: string;
}

const ZONE_DEFINITIONS: ZoneDefinition[] = [
  {
    id: "diesel_tractor",
    title: "โซน 1: หัวลากดีเซล (TT-)",
    shortTitle: "หัวลากดีเซล TT-",
    subtitle: "Diesel Tow Tractors (ไม่ใช่ TTEV)",
    accentHex: 0xf59e0b,
    accentCss: "#f59e0b",
    badgeTextCss: "#fef3c7",
  },
  {
    id: "ev_tractor",
    title: "โซน 2: หัวลากไฟฟ้า EV (TTEV-)",
    shortTitle: "หัวลากไฟฟ้า TTEV-",
    subtitle: "Electric Tow Tractors & Charging Bay",
    accentHex: 0x0ea5e9,
    accentCss: "#0ea5e9",
    badgeTextCss: "#e0f2fe",
  },
  {
    id: "forklift",
    title: "โซน 3: รถโฟล์คลิฟท์ (FL-)",
    shortTitle: "โฟล์คลิฟท์ FL-",
    subtitle: "Counterbalance Forklift Fleet",
    accentHex: 0xea580c,
    accentCss: "#ea580c",
    badgeTextCss: "#ffedd5",
  },
  {
    id: "trailer",
    title: "โซน 4: หางลาก TTL (TTL-)",
    shortTitle: "หางลาก TTL-",
    subtitle: "Flatbed Trailers & Dollies",
    accentHex: 0x8b5cf6,
    accentCss: "#8b5cf6",
    badgeTextCss: "#ede9fe",
  },
  {
    id: "clamp_truck",
    title: "โซน 5: ลานจอดรถคีบ (SC-01)",
    shortTitle: "รถคีบ SC-01",
    subtitle: "Steel Grapple / Clamp Truck Bay",
    accentHex: 0x10b981,
    accentCss: "#10b981",
    badgeTextCss: "#d1fae5",
  },
];

const BUILTIN_SC01_CLAMP_VEHICLE: Vehicle = {
  id: "BUILTIN-SC-01",
  vehicleId: "SC-01",
  number: "SC-01",
  vehicleType: "Other",
  type: "รถคีบ",
  description: "Xinyuan 500 Kg · รถคีบเหล็ก (Clamp Truck)",
  registrationNumber: "หแ-01",
  activeStatus: "Active",
  operationalStatus: "Available",
  department: "Material Handling - Fleet",
  capacityTon: 0.5,
  status: "Available",
  createdAt: "",
  updatedAt: "",
};

export interface OpenRepairBadgeInfo {
  label: string;
  shortLabel: string;
  severity: "repair" | "waiting" | "parts";
}

export function resolveOpenRepairMeta(rec: MhMaintenanceRecord): OpenRepairBadgeInfo {
  const stage = inferMhWorkflowStage(rec);
  const combinedNotes = `${rec.progressStatus || ""} ${rec.supervisorNotes || ""} ${rec.notes || ""} ${rec.repairDescription || ""}`.toLowerCase();

  if (
    rec.progressStatus === "On Hold" ||
    combinedNotes.includes("รออะไหล่") ||
    combinedNotes.includes("สั่งอะไหล่")
  ) {
    return {
      label: "รออะไหล่ / พักซ่อม",
      shortLabel: "รออะไหล่",
      severity: "parts",
    };
  }

  switch (stage) {
    case "InRepair":
      return {
        label: "กำลังซ่อม (อยู่ระหว่างการซ่อม)",
        shortLabel: "กำลังซ่อม",
        severity: "repair",
      };
    case "ManagerApproved":
      return {
        label: "รอซ่อม (อนุมัติแล้ว · รอคิวซ่อม)",
        shortLabel: "รอซ่อม",
        severity: "waiting",
      };
    case "SupervisorChecked":
      return {
        label:
          rec.managerStatus === "More Info Requested"
            ? "รอหัวหน้างานตอบข้อมูลเพิ่ม"
            : "รอผู้จัดการอนุมัติซ่อม",
        shortLabel: "รออนุมัติซ่อม",
        severity: "waiting",
      };
    case "Submitted":
    default:
      return {
        label:
          rec.supervisorStatus === "Returned"
            ? "แจ้งซ่อม (ส่งกลับแก้ไข)"
            : "แจ้งซ่อมใหม่ (รอตรวจสอบ)",
        shortLabel: "รอตรวจซ่อม",
        severity: "waiting",
      };
  }
}

export function isMaintenanceRecordOpen(rec: MhMaintenanceRecord): boolean {
  const stage = inferMhWorkflowStage(rec);
  return stage !== "Completed" && stage !== "Rejected";
}

interface StallPlacement {
  vehicle: Vehicle;
  zoneId: ParkingZoneId;
  modelType: YardModelType;
  x: number;
  z: number;
  rotY: number;
  bayW: number;
  bayD: number;
  openRepairs: MhMaintenanceRecord[];
  primaryRepairMeta: OpenRepairBadgeInfo | null;
  isRegistryMaintenance: boolean;
  isInUseToday: boolean;
  assignedToday?: VehicleAssignment;
}

interface ZoneLayoutRect {
  zone: ZoneDefinition;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  count: number;
  repairCount: number;
  stalls: StallPlacement[];
}

interface VehicleParkingYard3DProps {
  vehicles: Vehicle[];
  maintenanceRecords: MhMaintenanceRecord[];
  vehicleAssignmentMap: Map<string, VehicleAssignment>;
  onEditVehicle?: (vehicle: Vehicle) => void;
  onViewVehicleDetails?: (vehicle: Vehicle) => void;
  onNavigateToFixFlush?: () => void;
}

type YardCameraPreset =
  | "overview"
  | "diesel_tractor"
  | "ev_tractor"
  | "forklift"
  | "trailer"
  | "clamp_truck"
  | "top";

// Module-level reusable math helpers (zero GC inside render loop)
const _projVec = new THREE.Vector3();
const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function classifyVehicleParkingZone(v: Vehicle): {
  zoneId: ParkingZoneId;
  modelType: YardModelType;
} {
  if (isClampTruckVehicle(v)) {
    return { zoneId: "clamp_truck", modelType: "clamp_truck" };
  }
  if (isElectricTractorVehicle(v)) {
    return { zoneId: "ev_tractor", modelType: "ev_tractor" };
  }
  if (isTrailerVehicle(v)) {
    return { zoneId: "trailer", modelType: "trailer" };
  }
  if (isForkliftVehicle(v)) {
    return { zoneId: "forklift", modelType: "forklift" };
  }
  if (isStandardTractorVehicle(v)) {
    return { zoneId: "diesel_tractor", modelType: "diesel_tractor" };
  }
  return { zoneId: "diesel_tractor", modelType: "diesel_tractor" };
}

function formatShortBayCode(v: Vehicle): string {
  const raw = String(v.vehicleId || v.number || v.id || "").trim().toUpperCase();
  const token = raw.split(/[\s(·|/]+/)[0] || raw;
  return token.slice(0, 12) || "VEH";
}

interface MergedTemplatePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
}

interface DecalAttachmentSpec {
  matrix: THREE.Matrix4;
  style: VehicleDecalStyle;
  size: [number, number];
}

interface MergedYardVehicleTemplate {
  parts: MergedTemplatePart[];
  decals: DecalAttachmentSpec[];
  dispose: () => void;
}

const _tmpBox = new THREE.Box3();
const _tmpSize = new THREE.Vector3();

/**
 * Composite procedural 3D Steel/Scrap Clamp Truck (รถคีบ Xinyuan SC-01)
 * Built with distinct primary silhouette, secondary mechanical read, and accent details.
 * Grounded flush at y = 0 facing +Z.
 */
function buildClampTruckRoot(textures: Pm3dTexturePack): THREE.Group {
  const root = new THREE.Group();

  const yellowPaintMat = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    roughness: 0.34,
    metalness: 0.26,
  });
  const darkSteelMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.44,
    metalness: 0.68,
  });
  const boomSteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.38,
    metalness: 0.72,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.14,
    metalness: 0.92,
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.88,
    metalness: 0.05,
    map: textures.tireTreadLug,
    bumpMap: textures.tireTreadLugBump,
    bumpScale: 0.03,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.36,
    metalness: 0.74,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.12,
    metalness: 0.25,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xfacc15,
    emissiveIntensity: 0.85,
    roughness: 0.22,
    metalness: 0.1,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0xea580c,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.1,
  });
  const decalPlaceholderMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

  // 1. Lower Undercarriage Frame & Outriggers (grounded at y = 0)
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.34, 2.55), darkSteelMat);
  chassis.position.set(0, 0.56, -0.15);
  chassis.castShadow = true;
  root.add(chassis);

  // Rear Outrigger Stabilizer Beam + Grounded Pads
  const outriggerBeam = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.22, 0.28), darkSteelMat);
  outriggerBeam.position.set(0, 0.42, -1.35);
  outriggerBeam.castShadow = true;
  root.add(outriggerBeam);

  [-0.92, 0.92].forEach((ox) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.18), darkSteelMat);
    leg.position.set(ox, 0.24, -1.35);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.32), boomSteelMat);
    pad.position.set(ox, 0.03, -1.35);
    root.add(leg, pad);
  });

  // 4 Heavy Pneumatic Wheels seated flush at y = 0 (radius = 0.42)
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 18);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.30, 14);
  const wheelPositions: [number, number][] = [
    [-0.86, 0.68],
    [0.86, 0.68],
    [-0.86, -0.82],
    [0.86, -0.82],
  ];
  wheelPositions.forEach(([wx, wz]) => {
    const tire = new THREE.Mesh(wheelGeo, rubberMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(wx, 0.42, wz);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, 0.42, wz);
    root.add(tire, rim);
  });

  // Slewing Ring Turntable
  const slewRing = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.18, 20), boomSteelMat);
  slewRing.position.set(0, 0.82, -0.18);
  root.add(slewRing);

  // 2. Upper Rotating House & Counterweight Hood (Industrial Yellow)
  const upperDeck = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.24, 2.25), darkSteelMat);
  upperDeck.position.set(0, 0.98, -0.28);
  upperDeck.castShadow = true;
  root.add(upperDeck);

  const engineHood = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.72, 1.38), yellowPaintMat);
  engineHood.position.set(0, 1.44, -0.68);
  engineHood.castShadow = true;
  root.add(engineHood);

  // Rounded Rear Counterweight
  const counterweight = new THREE.Mesh(
    new THREE.CylinderGeometry(0.86, 0.86, 0.68, 18, 1, false, Math.PI * 0.5, Math.PI),
    yellowPaintMat
  );
  counterweight.rotation.y = Math.PI * 0.5;
  counterweight.position.set(0, 1.42, -1.28);
  counterweight.castShadow = true;
  root.add(counterweight);

  // Exhaust Stack & Air Intake
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.58, 10), darkSteelMat);
  exhaust.position.set(0.55, 2.02, -0.95);
  root.add(exhaust);

  // 3. Left-Side Panoramic Operator Cabin with ROPS Frame
  const cabBase = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.34, 1.18), yellowPaintMat);
  cabBase.position.set(-0.44, 1.26, 0.24);
  cabBase.castShadow = true;
  root.add(cabBase);

  const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.86, 1.06), glassMat);
  cabGlass.position.set(-0.44, 1.84, 0.24);
  root.add(cabGlass);

  // ROPS Corner Pillars + Protective Roof Canopy
  [
    [-0.81, 0.76],
    [-0.07, 0.76],
    [-0.81, -0.28],
    [-0.07, -0.28],
  ].forEach(([px, pz]) => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.94, 0.06), darkSteelMat);
    pillar.position.set(px, 1.84, pz);
    root.add(pillar);
  });

  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.09, 1.22), yellowPaintMat);
  cabRoof.position.set(-0.44, 2.32, 0.24);
  cabRoof.castShadow = true;
  root.add(cabRoof);

  // Roof Beacon & Front Work Lights
  const roofBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.13, 12), beaconMat);
  roofBeacon.position.set(-0.44, 2.43, -0.15);
  root.add(roofBeacon);

  [-0.68, -0.20].forEach((lx) => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.06), lampMat);
    lamp.position.set(lx, 2.28, 0.86);
    root.add(lamp);
  });

  // 4. Articulated Hydraulic Main Boom + Stick Arm + Dual Chrome Cylinders
  const boomMount = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.56), darkSteelMat);
  boomMount.position.set(0.32, 1.32, 0.26);
  root.add(boomMount);

  const mainBoom = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, 2.25), yellowPaintMat);
  mainBoom.position.set(0.32, 2.02, 1.05);
  mainBoom.rotation.x = -0.58;
  mainBoom.castShadow = true;
  root.add(mainBoom);

  // Main Boom Lift Hydraulic Cylinder (Barrel + Chrome Rod)
  const liftBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.88, 12), darkSteelMat);
  liftBarrel.position.set(0.32, 1.54, 0.88);
  liftBarrel.rotation.x = 0.72;
  const liftRod = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.64, 12), chromeMat);
  liftRod.position.set(0.32, 1.94, 1.24);
  liftRod.rotation.x = 0.72;
  root.add(liftBarrel, liftRod);

  // Stick / Dipper Arm extending down-forward toward Grapple Head
  const stickArm = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.24, 1.62), boomSteelMat);
  stickArm.position.set(0.32, 2.06, 2.26);
  stickArm.rotation.x = 0.92;
  stickArm.castShadow = true;
  root.add(stickArm);

  // Stick Crowd Cylinder above Main Boom
  const stickBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.76, 10), darkSteelMat);
  stickBarrel.position.set(0.32, 2.48, 1.28);
  stickBarrel.rotation.x = -0.52;
  const stickRod = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.54, 10), chromeMat);
  stickRod.position.set(0.32, 2.74, 1.72);
  stickRod.rotation.x = -0.52;
  root.add(stickBarrel, stickRod);

  // 5. 360° Hydraulic Steel Grapple / Clamp Head (หัวคีบเหล็ก 4 ขา)
  const grappleGroup = new THREE.Group();
  grappleGroup.position.set(0.32, 1.38, 2.66);

  const rotator = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.24, 14), boomSteelMat);
  rotator.position.set(0, 0, 0);
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.20, 0.12, 14), darkSteelMat);
  yoke.position.set(0, -0.16, 0);
  grappleGroup.add(rotator, yoke);

  // 4 Articulated Steel Clamp Claws (upper shoulder + inward-curved lower steel tip)
  const clawAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
  clawAngles.forEach((angle) => {
    const clawPivot = new THREE.Group();
    clawPivot.rotation.y = angle;
    clawPivot.position.set(0, -0.20, 0);

    const upperJaw = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.44, 0.12), yellowPaintMat);
    upperJaw.position.set(0.24, -0.16, 0);
    upperJaw.rotation.z = 0.58;
    upperJaw.castShadow = true;

    const lowerTip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.11), darkSteelMat);
    lowerTip.position.set(0.28, -0.52, 0);
    lowerTip.rotation.z = -0.42;
    lowerTip.castShadow = true;

    clawPivot.add(upperJaw, lowerTip);
    grappleGroup.add(clawPivot);
  });

  root.add(grappleGroup);

  // 6. Registration Decals (Cab Roof + Both Sides of Engine Hood)
  const roofDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.34), decalPlaceholderMat);
  roofDecal.rotation.x = -Math.PI / 2;
  roofDecal.position.set(-0.44, 2.375, 0.34);
  roofDecal.userData.decalStyle = "forklift_roof";
  roofDecal.userData.decalSize = [0.68, 0.34];
  root.add(roofDecal);

  const leftSideDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.36), decalPlaceholderMat);
  leftSideDecal.rotation.y = -Math.PI / 2;
  leftSideDecal.position.set(-0.88, 1.46, -0.72);
  leftSideDecal.userData.decalStyle = "tractor_side";
  leftSideDecal.userData.decalSize = [0.92, 0.36];
  root.add(leftSideDecal);

  const rightSideDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.36), decalPlaceholderMat);
  rightSideDecal.rotation.y = Math.PI / 2;
  rightSideDecal.position.set(0.88, 1.46, -0.72);
  rightSideDecal.userData.decalStyle = "tractor_side";
  rightSideDecal.userData.decalSize = [0.92, 0.36];
  root.add(rightSideDecal);

  return root;
}

function buildMergedYardVehicleTemplate(
  modelType: YardModelType,
  textures: Pm3dTexturePack,
  isSoftwareGl: boolean
): MergedYardVehicleTemplate {
  const rootObj =
    modelType === "clamp_truck"
      ? buildClampTruckRoot(textures)
      : buildVehicleByModelType(modelType, textures, isSoftwareGl, "__TPL__").root;
  rootObj.updateMatrixWorld(true);

  const buckets = new Map<
    string,
    { material: THREE.Material; geos: THREE.BufferGeometry[]; castShadow: boolean }
  >();
  const decals: DecalAttachmentSpec[] = [];
  const rawGeosToDispose = new Set<THREE.BufferGeometry>();
  const unusedMaterialsToDispose = new Set<THREE.Material>();
  const keptMaterials = new Set<THREE.Material>();

  rootObj.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    if (mesh.geometry) rawGeosToDispose.add(mesh.geometry);

    if (mesh.userData.decalStyle && Array.isArray(mesh.userData.decalSize)) {
      decals.push({
        matrix: mesh.matrixWorld.clone(),
        style: mesh.userData.decalStyle as VehicleDecalStyle,
        size: mesh.userData.decalSize as [number, number],
      });
      if (!Array.isArray(mesh.material) && mesh.material) {
        unusedMaterialsToDispose.add(mesh.material);
      }
      return;
    }

    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat || !mesh.geometry) return;

    const cloned = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    cloned.applyMatrix4(mesh.matrixWorld);

    // Normalize attributes so all meshes sharing this material merge cleanly
    for (const attrName of Object.keys(cloned.attributes)) {
      if (attrName !== "position" && attrName !== "normal" && attrName !== "uv") {
        cloned.deleteAttribute(attrName);
      }
    }
    if (!cloned.attributes.normal) {
      cloned.computeVertexNormals();
    }
    if (!cloned.attributes.uv && cloned.attributes.position) {
      const count = cloned.attributes.position.count;
      cloned.setAttribute(
        "uv",
        new THREE.BufferAttribute(new Float32Array(count * 2), 2)
      );
    }

    let isMajorShadow = false;
    if (mesh.castShadow && cloned.attributes.position) {
      _tmpBox.setFromBufferAttribute(cloned.attributes.position as THREE.BufferAttribute);
      _tmpBox.getSize(_tmpSize);
      isMajorShadow = _tmpSize.x > 0.24 || _tmpSize.y > 0.24 || _tmpSize.z > 0.24;
    }

    const key = mat.uuid;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mat, geos: [], castShadow: false };
      buckets.set(key, bucket);
    }
    bucket.geos.push(cloned);
    if (isMajorShadow) bucket.castShadow = true;
    keptMaterials.add(mat);
  });

  const parts: MergedTemplatePart[] = [];
  buckets.forEach((bucket) => {
    const merged = mergeGeometries(bucket.geos, false);
    bucket.geos.forEach((g) => g.dispose());
    if (merged) {
      merged.computeBoundingSphere();
      parts.push({
        geometry: merged,
        material: bucket.material,
        castShadow: bucket.castShadow,
      });
    }
  });

  // Dispose only raw intermediate geometries & unused decal template materials
  rawGeosToDispose.forEach((g) => g.dispose());
  unusedMaterialsToDispose.forEach((m) => {
    if (keptMaterials.has(m)) return;
    const std = m as THREE.MeshStandardMaterial;
    if (std.map) std.map.dispose();
    m.dispose();
  });

  return {
    parts,
    decals,
    dispose: () => {
      parts.forEach((p) => p.geometry.dispose());
      keptMaterials.forEach((m) => m.dispose());
    },
  };
}

function createBayFloorTexture(
  code: string,
  regNo: string,
  statusMode: "repair" | "registry_maint" | "inuse" | "available" | "inactive",
  zoneAccentCss: string,
  repairShortLabel: string | null,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext("2d")!;

  const isRepair = statusMode === "repair" || statusMode === "registry_maint";

  // Concrete / tarmac stall surface
  ctx.fillStyle = isRepair ? "#3b171b" : "#1e293b";
  ctx.fillRect(0, 0, 256, 384);

  // Keep repair border highlight for vehicles with open repairs; omit standard divider lines on normal bays
  const borderColor = isRepair
    ? "#ef4444"
    : statusMode === "inuse"
    ? "#38bdf8"
    : statusMode === "inactive"
    ? "#64748b"
    : zoneAccentCss;

  if (isRepair) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, 244, 372);
  }

  // Hazard diagonal warning stripes along front & rear aprons for vehicles under repair
  if (isRepair) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, 10, 236, 30);
    ctx.rect(10, 344, 236, 30);
    ctx.clip();
    ctx.fillStyle = "#f97316";
    ctx.fillRect(10, 10, 236, 364);
    ctx.fillStyle = "#18181b";
    for (let x = -380; x < 460; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 12, 0);
      ctx.lineTo(x - 52, 384);
      ctx.lineTo(x - 64, 384);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Compact front bay number plate strip at bottom of texture (facing drive aisle)
  ctx.fillStyle = isRepair ? "#b91c1c" : "#0f172a";
  ctx.fillRect(28, 316, 200, 56);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 316, 200, 56);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 28px 'JetBrains Mono', monospace";
  ctx.fillText(code.slice(0, 10), 128, 336);

  ctx.fillStyle = isRepair ? "#fecaca" : "#cbd5e1";
  ctx.font = "700 13px 'Noto Sans Thai', sans-serif";
  const subText =
    isRepair && repairShortLabel
      ? `⚠ ${repairShortLabel}`
      : regNo || (statusMode === "inuse" ? "กำลังใช้งาน" : "พร้อมใช้งาน");
  ctx.fillText(subText.slice(0, 22), 128, 359);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

function createSignboardTexture(
  code: string,
  regNo: string,
  statusMode: "repair" | "registry_maint" | "inuse" | "available" | "inactive",
  repairShortLabel: string | null,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  const isRepair = statusMode === "repair" || statusMode === "registry_maint";
  ctx.fillStyle = isRepair ? "#7f1d1d" : "#0f172a";
  ctx.fillRect(0, 0, 256, 128);

  // Top color status bar
  ctx.fillStyle = isRepair
    ? "#ef4444"
    : statusMode === "inuse"
    ? "#0284c7"
    : statusMode === "inactive"
    ? "#475569"
    : "#16a34a";
  ctx.fillRect(0, 0, 256, 26);

  ctx.strokeStyle = isRepair ? "#fca5a5" : "#38bdf8";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 124);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 14px 'Noto Sans Thai', sans-serif";
  const headerText = isRepair
    ? `ซ่อม · ${repairShortLabel || "ซ่อมบำรุง"}`
    : statusMode === "inuse"
    ? "กำลังปฏิบัติงาน"
    : statusMode === "inactive"
    ? "งดใช้งาน"
    : "พร้อมใช้งาน";
  ctx.fillText(headerText, 128, 14);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 38px 'JetBrains Mono', monospace";
  ctx.fillText(code.slice(0, 10), 128, 65);

  ctx.fillStyle = isRepair ? "#fecaca" : "#94a3b8";
  ctx.font = "600 15px 'Noto Sans Thai', sans-serif";
  ctx.fillText((regNo || "-").slice(0, 22), 128, 104);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

function createZoneBannerTexture(
  zone: ZoneDefinition,
  count: number,
  repairCount: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0b1322";
  ctx.fillRect(0, 0, 1024, 256);

  // Left accent bar
  ctx.fillStyle = zone.accentCss;
  ctx.fillRect(0, 0, 26, 256);

  ctx.strokeStyle = zone.accentCss;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 1016, 248);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 54px 'Noto Sans Thai', sans-serif";
  ctx.fillText(zone.title, 56, 92);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 32px 'Noto Sans Thai', sans-serif";
  ctx.fillText(
    `${zone.subtitle} · จำนวน ${count} คัน` +
      (repairCount > 0 ? ` · แจ้งซ่อม ${repairCount} คัน` : ""),
    56,
    174
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

function buildZoneLayout(
  vehicles: Vehicle[],
  openRepairsByVehicle: Map<string, MhMaintenanceRecord[]>,
  vehicleAssignmentMap: Map<string, VehicleAssignment>,
  showRepairOnly: boolean
): ZoneLayoutRect[] {
  const grouped: Record<ParkingZoneId, Vehicle[]> = {
    diesel_tractor: [],
    ev_tractor: [],
    forklift: [],
    trailer: [],
    clamp_truck: [],
  };

  vehicles.forEach((v) => {
    const { zoneId } = classifyVehicleParkingZone(v);
    grouped[zoneId].push(v);
  });

  // Always show dedicated SC-01 Clamp Truck bay in Zone 5 even if SC-01 is not yet added in registry
  if (grouped.clamp_truck.length === 0) {
    const sc01Repairs =
      openRepairsByVehicle.get("SC-01") || openRepairsByVehicle.get("หแ-01") || [];
    if (!showRepairOnly || sc01Repairs.length > 0) {
      grouped.clamp_truck.push(BUILTIN_SC01_CLAMP_VEHICLE);
    }
  }

  // Sort vehicles naturally inside each zone (e.g., TT-01, TT-02, TTEV-19..TTEV-27, SC-01)
  (Object.keys(grouped) as ParkingZoneId[]).forEach((zKey) => {
    grouped[zKey].sort((a, b) =>
      String(a.vehicleId || "").localeCompare(String(b.vehicleId || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  });

  const resolveRepairsForVehicle = (v: Vehicle, zoneId: ParkingZoneId): MhMaintenanceRecord[] => {
    const vidUpper = String(v.vehicleId || v.number || "").trim().toUpperCase();
    const direct = openRepairsByVehicle.get(vidUpper) || [];
    if (direct.length > 0) return direct;
    if (zoneId === "clamp_truck") {
      return (
        openRepairsByVehicle.get("SC-01") ||
        openRepairsByVehicle.get("หแ-01") ||
        []
      );
    }
    return [];
  };

  // Quadrant offsets separated by central cross-roadways
  const aisleHalf = 3.2;

  const buildQuadrant = (zone: ZoneDefinition): ZoneLayoutRect => {
    const list = grouped[zone.id];
    const isTrailer = zone.id === "trailer";
    const isForklift = zone.id === "forklift";

    const bayW = isTrailer ? 3.2 : isForklift ? 2.7 : 2.9;
    const bayD = isTrailer ? 6.6 : 5.0;
    const pitchX = bayW + 0.65;
    const pitchZ = bayD + 2.2;
    const cols = Math.max(3, Math.min(5, Math.ceil(Math.sqrt(Math.max(1, list.length) * 1.35))));
    const rows = Math.max(1, Math.ceil(Math.max(1, list.length) / cols));

    const spanX = cols * pitchX;
    const spanZ = rows * pitchZ;
    const padX = 1.8;
    const padZ = 2.0;

    // Quadrant sign: diesel (-X,-Z), ev (+X,-Z), forklift (-X,+Z), trailer (+X,+Z)
    const signX = zone.id === "diesel_tractor" || zone.id === "forklift" ? -1 : 1;
    const signZ = zone.id === "diesel_tractor" || zone.id === "ev_tractor" ? -1 : 1;

    const innerX = signX * aisleHalf;
    const outerX = signX * (aisleHalf + spanX + padX * 2);
    const innerZ = signZ * aisleHalf;
    const outerZ = signZ * (aisleHalf + spanZ + padZ * 2);

    const minX = Math.min(innerX, outerX);
    const maxX = Math.max(innerX, outerX);
    const minZ = Math.min(innerZ, outerZ);
    const maxZ = Math.max(innerZ, outerZ);
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const stalls: StallPlacement[] = [];
    let repairCount = 0;

    list.forEach((v, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);

      // Start arranging from inner corner outward so zones stay close to the center cross-aisle
      const localX =
        signX < 0
          ? maxX - padX - pitchX * (col + 0.5)
          : minX + padX + pitchX * (col + 0.5);
      const localZ =
        signZ < 0
          ? maxZ - padZ - pitchZ * (row + 0.5)
          : minZ + padZ + pitchZ * (row + 0.5);

      const openRepairs = resolveRepairsForVehicle(v, zone.id);
      const primaryRepairMeta = openRepairs.length > 0 ? resolveOpenRepairMeta(openRepairs[0]) : null;
      const isRegistryMaintenance = v.operationalStatus === "Maintenance";
      if (openRepairs.length > 0 || isRegistryMaintenance) {
        repairCount += 1;
      }

      const assignedToday =
        vehicleAssignmentMap.get(v.vehicleId) || vehicleAssignmentMap.get(v.id);
      const isInUseToday =
        Boolean(assignedToday) || v.operationalStatus === "In Use";

      const modelType: YardModelType =
        zone.id === "ev_tractor"
          ? "ev_tractor"
          : zone.id === "forklift"
          ? "forklift"
          : zone.id === "trailer"
          ? "trailer"
          : "diesel_tractor";

      // Face vehicles toward the main horizontal cross-aisle (Z = 0)
      const rotY = signZ < 0 ? 0 : Math.PI;

      stalls.push({
        vehicle: v,
        zoneId: zone.id,
        modelType,
        x: localX,
        z: localZ,
        rotY,
        bayW,
        bayD,
        openRepairs,
        primaryRepairMeta,
        isRegistryMaintenance,
        isInUseToday,
        assignedToday,
      });
    });

    return {
      zone,
      minX,
      maxX,
      minZ,
      maxZ,
      centerX,
      centerZ,
      count: list.length,
      repairCount,
      stalls,
    };
  };

  // Build Zones 1-4 in the 4 core quadrants
  const primaryZones = ZONE_DEFINITIONS.filter((z) => z.id !== "clamp_truck").map(buildQuadrant);

  // Build Zone 5 (รถคีบ SC-01) cleanly alongside Zone 3 (Forklift) facing the central roadway (Z = 0)
  const clampZoneDef = ZONE_DEFINITIONS.find((z) => z.id === "clamp_truck")!;
  const forkliftZone = primaryZones.find((zl) => zl.zone.id === "forklift");
  const clampList = grouped.clamp_truck;

  const clampBayW = 3.8;
  const clampBayD = 6.2;
  const clampPitchX = clampBayW + 0.8;
  const clampPitchZ = clampBayD + 2.2;
  const clampCols = Math.max(1, Math.min(3, clampList.length));
  const clampRows = Math.max(1, Math.ceil(Math.max(1, clampList.length) / clampCols));
  const clampSpanX = Math.max(clampCols * clampPitchX, 5.4);
  const clampSpanZ = clampRows * clampPitchZ;
  const clampPadX = 1.9;
  const clampPadZ = 2.0;

  const laneGap = 2.6;
  const maxX = (forkliftZone ? forkliftZone.minX : -15) - laneGap;
  const minX = maxX - (clampSpanX + clampPadX * 2);
  const minZ = aisleHalf;
  const maxZ = aisleHalf + clampSpanZ + clampPadZ * 2;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const clampStalls: StallPlacement[] = [];
  let clampRepairCount = 0;

  clampList.forEach((v, idx) => {
    const col = idx % clampCols;
    const row = Math.floor(idx / clampCols);
    const localX =
      clampList.length === 1
        ? centerX
        : maxX - clampPadX - clampPitchX * (col + 0.5);
    const localZ = minZ + clampPadZ + clampPitchZ * (row + 0.5);

    const openRepairs = resolveRepairsForVehicle(v, "clamp_truck");
    const primaryRepairMeta =
      openRepairs.length > 0 ? resolveOpenRepairMeta(openRepairs[0]) : null;
    const isRegistryMaintenance = v.operationalStatus === "Maintenance";
    if (openRepairs.length > 0 || isRegistryMaintenance) {
      clampRepairCount += 1;
    }

    const assignedToday =
      vehicleAssignmentMap.get(v.vehicleId) ||
      vehicleAssignmentMap.get(v.id) ||
      vehicleAssignmentMap.get("SC-01") ||
      vehicleAssignmentMap.get("หแ-01");
    const isInUseToday =
      Boolean(assignedToday) || v.operationalStatus === "In Use";

    clampStalls.push({
      vehicle: v,
      zoneId: "clamp_truck",
      modelType: "clamp_truck",
      x: localX,
      z: localZ,
      rotY: Math.PI, // Facing central roadway (Z = 0)
      bayW: clampBayW,
      bayD: clampBayD,
      openRepairs,
      primaryRepairMeta,
      isRegistryMaintenance,
      isInUseToday,
      assignedToday,
    });
  });

  const clampZoneRect: ZoneLayoutRect = {
    zone: clampZoneDef,
    minX,
    maxX,
    minZ,
    maxZ,
    centerX,
    centerZ,
    count: clampList.length,
    repairCount: clampRepairCount,
    stalls: clampStalls,
  };

  return [...primaryZones, clampZoneRect];
}

export function VehicleParkingYard3D({
  vehicles,
  maintenanceRecords,
  vehicleAssignmentMap,
  onEditVehicle,
  onViewVehicleDetails,
  onNavigateToFixFlush,
}: VehicleParkingYard3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const repairPinRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hoverBannerRef = useRef<HTMLDivElement | null>(null);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<YardCameraPreset>("overview");
  const [showRepairOnly, setShowRepairOnly] = useState<boolean>(false);
  const [showFloatingBadges, setShowFloatingBadges] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(true);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<MhRepairPhotoItem | null>(null);

  // Build map of open repairs from ระบบแจ้งซ่อม (mh_maintenance) keyed by uppercase vehicleId
  const openRepairsByVehicle = useMemo(() => {
    const map = new Map<string, MhMaintenanceRecord[]>();
    maintenanceRecords.forEach((rec) => {
      if (!isMaintenanceRecordOpen(rec)) return;
      const key = String(rec.vehicleId || rec.vehicleNumber || "")
        .trim()
        .toUpperCase();
      if (!key) return;
      const arr = map.get(key) || [];
      arr.push(rec);
      map.set(key, arr);
    });
    // Sort newest first per vehicle
    map.forEach((arr) => {
      arr.sort((a, b) =>
        String(b.updatedAt || b.workingDate || "").localeCompare(
          String(a.updatedAt || a.workingDate || "")
        )
      );
    });
    return map;
  }, [maintenanceRecords]);

  // Filter vehicles if Repair-Only toggle is enabled
  const displayVehicles = useMemo(() => {
    if (!showRepairOnly) return vehicles;
    return vehicles.filter((v) => {
      const key = String(v.vehicleId || v.number || "").trim().toUpperCase();
      return (openRepairsByVehicle.get(key)?.length || 0) > 0 || v.operationalStatus === "Maintenance";
    });
  }, [vehicles, showRepairOnly, openRepairsByVehicle]);

  const zoneLayouts = useMemo(
    () => buildZoneLayout(displayVehicles, openRepairsByVehicle, vehicleAssignmentMap, showRepairOnly),
    [displayVehicles, openRepairsByVehicle, vehicleAssignmentMap, showRepairOnly]
  );

  const allStalls = useMemo(
    () => zoneLayouts.flatMap((zl) => zl.stalls),
    [zoneLayouts]
  );

  const repairStalls = useMemo(
    () =>
      allStalls.filter(
        (s) => s.openRepairs.length > 0 || s.isRegistryMaintenance
      ),
    [allStalls]
  );

  const selectedStall = useMemo(
    () =>
      selectedVehicleId
        ? allStalls.find(
            (s) => s.vehicle.vehicleId.toUpperCase() === selectedVehicleId.toUpperCase()
          ) || null
        : null,
    [allStalls, selectedVehicleId]
  );

  // Summary metrics
  const yardSummary = useMemo(() => {
    const total = allStalls.length;
    const repairing = repairStalls.length;
    const openWorkOrders = repairStalls.reduce((sum, s) => sum + s.openRepairs.length, 0);
    return { total, repairing, openWorkOrders };
  }, [allStalls, repairStalls]);

  // Refs synced into WebGL render loop
  const stallsRef = useRef<StallPlacement[]>(allStalls);
  const zoneLayoutsRef = useRef<ZoneLayoutRect[]>(zoneLayouts);
  const selectedVehicleIdRef = useRef<string | null>(selectedVehicleId);
  const showFloatingBadgesRef = useRef<boolean>(showFloatingBadges);
  stallsRef.current = allStalls;
  zoneLayoutsRef.current = zoneLayouts;
  selectedVehicleIdRef.current = selectedVehicleId;
  showFloatingBadgesRef.current = showFloatingBadges;

  const sceneBridgeRef = useRef<{
    rebuildYard: (layouts: ZoneLayoutRect[]) => void;
    setCameraGoal: (pos: [number, number, number], target: [number, number, number]) => void;
    highlightSelection: (vid: string | null) => void;
  } | null>(null);

  const computeYardOverviewCamera = (
    layouts: ZoneLayoutRect[]
  ): { pos: [number, number, number]; target: [number, number, number] } => {
    let minX = -15;
    let maxX = 15;
    let minZ = -15;
    let maxZ = 15;
    layouts.forEach((zl) => {
      minX = Math.min(minX, zl.minX);
      maxX = Math.max(maxX, zl.maxX);
      minZ = Math.min(minZ, zl.minZ);
      maxZ = Math.max(maxZ, zl.maxZ);
    });
    const span = Math.max(maxX - minX, maxZ - minZ, 24);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    return {
      pos: [cx + span * 0.62, span * 0.56, cz + span * 0.72],
      target: [cx, 0.6, cz],
    };
  };

  const focusPreset = (preset: YardCameraPreset) => {
    setActivePreset(preset);
    if (!sceneBridgeRef.current) return;
    if (preset === "overview") {
      const ov = computeYardOverviewCamera(zoneLayoutsRef.current);
      sceneBridgeRef.current.setCameraGoal(ov.pos, ov.target);
      return;
    }
    if (preset === "top") {
      let minX = -15;
      let maxX = 15;
      let minZ = -15;
      let maxZ = 15;
      zoneLayoutsRef.current.forEach((zl) => {
        minX = Math.min(minX, zl.minX);
        maxX = Math.max(maxX, zl.maxX);
        minZ = Math.min(minZ, zl.minZ);
        maxZ = Math.max(maxZ, zl.maxZ);
      });
      const span = Math.max(maxX - minX, maxZ - minZ, 24);
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      sceneBridgeRef.current.setCameraGoal([cx, span * 1.15, cz + 0.8], [cx, 0, cz]);
      return;
    }
    const targetZone = zoneLayoutsRef.current.find((zl) => zl.zone.id === preset);
    if (targetZone) {
      const span = Math.max(targetZone.maxX - targetZone.minX, targetZone.maxZ - targetZone.minZ, 14);
      const signZ = preset === "diesel_tractor" || preset === "ev_tractor" ? 1 : -1;
      sceneBridgeRef.current.setCameraGoal(
        [targetZone.centerX + span * 0.45, span * 0.72, targetZone.centerZ + signZ * span * 0.78],
        [targetZone.centerX, 0.7, targetZone.centerZ]
      );
    }
  };

  const focusVehicleIn3D = (stall: StallPlacement) => {
    setSelectedVehicleId(stall.vehicle.vehicleId);
    if (!sceneBridgeRef.current) return;
    const frontDir = Math.cos(stall.rotY); // +1 or -1
    sceneBridgeRef.current.setCameraGoal(
      [stall.x + 5.2, 4.4, stall.z + frontDir * 5.8],
      [stall.x, 1.0, stall.z]
    );
  };

  // Mount Three.js WebGL Yard Scene ONCE
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: "high-performance",
        alpha: false,
      });
    } catch {
      setWebglError("เบราว์เซอร์ไม่รองรับการแสดงผลลานจอด 3D WebGL");
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(300, container.clientHeight);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const isDarkTheme = document.documentElement.classList.contains("dark");
    const bgHex = isDarkTheme ? 0x0b1526 : 0x1e293b;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.008);

    // Procedural Studio Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 220);
    const initCam = computeYardOverviewCamera(zoneLayoutsRef.current);
    camera.position.set(...initCam.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.09;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minPolarAngle = 0.1;
    controls.minDistance = 4;
    controls.maxDistance = 120;
    controls.target.set(...initCam.target);
    controls.update();

    // 3-Point Outdoor Industrial Yard Lighting
    const hemiLight = new THREE.HemisphereLight(
      isDarkTheme ? 0xbae6fd : 0xe0f2fe,
      isDarkTheme ? 0x1e293b : 0x334155,
      1.05
    );
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.9);
    sunLight.position.set(24, 38, 22);
    if (!isSoftwareGl) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 2;
      sunLight.shadow.camera.far = 110;
      const d = 32;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.bias = -0.0006;
      sunLight.shadow.normalBias = 0.03;
    }
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.72);
    rimLight.position.set(-22, 18, -24);
    scene.add(rimLight);

    // Ground Asphalt Horizon Plane
    const baseGroundGeo = new THREE.PlaneGeometry(240, 240);
    const baseGroundMat = new THREE.MeshStandardMaterial({
      color: isDarkTheme ? 0x0f172a : 0x263345,
      roughness: 0.92,
      metalness: 0.05,
    });
    const baseGround = new THREE.Mesh(baseGroundGeo, baseGroundMat);
    baseGround.rotation.x = -Math.PI / 2;
    baseGround.position.y = -0.02;
    baseGround.receiveShadow = true;
    scene.add(baseGround);

    // Shared Vehicle Textures + Persistent Merged Vehicle Template Cache
    const texturePack: Pm3dTexturePack = createPm3dTexturePack(
      Math.min(4, renderer.capabilities.getMaxAnisotropy())
    );
    const templateCache = new Map<YardModelType, MergedYardVehicleTemplate>();
    const getOrBuildTemplate = (mType: YardModelType): MergedYardVehicleTemplate => {
      let tpl = templateCache.get(mType);
      if (!tpl) {
        tpl = buildMergedYardVehicleTemplate(mType, texturePack, isSoftwareGl);
        templateCache.set(mType, tpl);
      }
      return tpl;
    };

    const yardRoot = new THREE.Group();
    scene.add(yardRoot);

    // Track disposable per-rebuild resources (templates stay cached until unmount)
    let dynamicGeos: THREE.BufferGeometry[] = [];
    let dynamicMats: THREE.Material[] = [];
    let dynamicTexs: THREE.Texture[] = [];
    let hitboxMeshes: THREE.Mesh[] = [];
    const stallBorderMeshes = new Map<string, THREE.Mesh>();
    let lastHoveredId: string | null = null;
    const prevPinState = new Map<string, { x: number; y: number; visible: boolean }>();

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      dynamicGeos.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      dynamicMats.push(m);
      return m;
    };
    const trackTex = <T extends THREE.Texture>(t: T): T => {
      dynamicTexs.push(t);
      return t;
    };

    const cleanupYard = () => {
      while (yardRoot.children.length > 0) {
        yardRoot.remove(yardRoot.children[0]);
      }
      dynamicGeos.forEach((g) => g.dispose());
      dynamicGeos = [];
      dynamicMats.forEach((m) => m.dispose());
      dynamicMats = [];
      dynamicTexs.forEach((t) => t.dispose());
      dynamicTexs = [];
      hitboxMeshes = [];
      stallBorderMeshes.clear();
      prevPinState.clear();
    };

    // Reusable Shared Geometries/Materials per yard rebuild
    const rebuildYard = (layouts: ZoneLayoutRect[]) => {
      cleanupYard();

      const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const postMat = trackMat(
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.72 })
      );
      const curbMat = trackMat(
        new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.65, metalness: 0.1 })
      );
      const chargerBodyMat = trackMat(
        new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.45 })
      );
      const chargerScreenMat = trackMat(
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      const coneOrangeMat = trackMat(
        new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45, metalness: 0.05 })
      );
      const coneWhiteMat = trackMat(
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.05 })
      );
      const repairBeaconMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xef4444,
          emissive: 0xdc2626,
          emissiveIntensity: 1.5,
          roughness: 0.25,
          metalness: 0.1,
        })
      );
      const hitHiddenMat = trackMat(new THREE.MeshBasicMaterial({ visible: false }));
      const padMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: isDarkTheme ? 0x162235 : 0x324155,
          roughness: 0.86,
          metalness: 0.08,
        })
      );
      const bannerSideMat = trackMat(
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.6 })
      );

      // Shared primitive geometries across all stalls (major draw-call / memory reduction)
      const signPostGeo = trackGeo(new THREE.CylinderGeometry(0.022, 0.026, 0.98, 8));
      const signBoardGeo = trackGeo(new THREE.BoxGeometry(0.62, 0.30, 0.04));
      const beaconGeo = trackGeo(new THREE.SphereGeometry(0.09, 10, 8));
      const haloGeo = trackGeo(new THREE.TorusGeometry(0.36, 0.03, 8, 22));
      const coneBaseGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.035, 0.32));
      const coneBodyGeo = trackGeo(new THREE.ConeGeometry(0.115, 0.44, 10));
      const coneStripeGeo = trackGeo(new THREE.CylinderGeometry(0.068, 0.092, 0.10, 10));
      const chargerPedGeo = trackGeo(new THREE.BoxGeometry(0.28, 1.24, 0.22));
      const chargerScreenGeo = trackGeo(new THREE.PlaneGeometry(0.20, 0.16));

      // Cache per-code decal textures/materials and plane geometries
      const decalMatCache = new Map<string, THREE.MeshStandardMaterial>();
      const decalGeoCache = new Map<string, THREE.PlaneGeometry>();
      const getDecalGeo = (w: number, h: number) => {
        const key = `${w}x${h}`;
        let geo = decalGeoCache.get(key);
        if (!geo) {
          geo = trackGeo(new THREE.PlaneGeometry(w, h));
          decalGeoCache.set(key, geo);
        }
        return geo;
      };
      const getDecalMat = (code: string, style: VehicleDecalStyle) => {
        const key = `${code}|${style}`;
        let mat = decalMatCache.get(key);
        if (!mat) {
          const tex = trackTex(createVehicleNumberDecalTexture(code, style, maxAniso));
          mat = trackMat(
            new THREE.MeshStandardMaterial({
              map: tex,
              transparent: style !== "forklift_roof" && style !== "trailer_side",
              roughness: 0.38,
              metalness: 0.06,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
            })
          );
          decalMatCache.set(key, mat);
        }
        return mat;
      };

      // Compute full yard perimeter for road markings & tight shadow bounds
      let yardMinX = -14;
      let yardMaxX = 14;
      let yardMinZ = -14;
      let yardMaxZ = 14;
      layouts.forEach((zl) => {
        yardMinX = Math.min(yardMinX, zl.minX);
        yardMaxX = Math.max(yardMaxX, zl.maxX);
        yardMinZ = Math.min(yardMinZ, zl.minZ);
        yardMaxZ = Math.max(yardMaxZ, zl.maxZ);
      });

      if (!isSoftwareGl) {
        const halfExtent = Math.max(
          Math.abs(yardMinX),
          Math.abs(yardMaxX),
          Math.abs(yardMinZ),
          Math.abs(yardMaxZ),
          22
        ) + 4;
        sunLight.shadow.camera.left = -halfExtent;
        sunLight.shadow.camera.right = halfExtent;
        sunLight.shadow.camera.top = halfExtent;
        sunLight.shadow.camera.bottom = -halfExtent;
        sunLight.shadow.camera.updateProjectionMatrix();
      }

      // Shared Stall Floor / WheelStop / Hitbox Geometries keyed by bay size
      const floorGeoCache = new Map<string, THREE.PlaneGeometry>();
      const rimGeoCache = new Map<string, THREE.RingGeometry>();
      const wheelStopGeoCache = new Map<number, THREE.BoxGeometry>();
      const hitGeoCache = new Map<string, THREE.BoxGeometry>();

      // Build each of the 5 Zones
      layouts.forEach((zl) => {
        const zw = zl.maxX - zl.minX;
        const zd = zl.maxZ - zl.minZ;

        // Zone concrete pad
        const padGeo = trackGeo(new THREE.BoxGeometry(zw, 0.02, zd));
        const pad = new THREE.Mesh(padGeo, padMat);
        pad.position.set(zl.centerX, 0.002, zl.centerZ);
        pad.receiveShadow = true;
        yardRoot.add(pad);

        // Zone colored perimeter frame
        const frameThick = 0.22;
        const zoneBorderMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: zl.zone.accentHex,
            emissive: zl.zone.accentHex,
            emissiveIntensity: 0.18,
            roughness: 0.5,
          })
        );
        const topBar = new THREE.Mesh(
          trackGeo(new THREE.BoxGeometry(zw, 0.025, frameThick)),
          zoneBorderMat
        );
        topBar.position.set(zl.centerX, 0.015, zl.minZ + frameThick / 2);
        const botBar = new THREE.Mesh(
          trackGeo(new THREE.BoxGeometry(zw, 0.025, frameThick)),
          zoneBorderMat
        );
        botBar.position.set(zl.centerX, 0.015, zl.maxZ - frameThick / 2);
        const leftBar = new THREE.Mesh(
          trackGeo(new THREE.BoxGeometry(frameThick, 0.025, zd)),
          zoneBorderMat
        );
        leftBar.position.set(zl.minX + frameThick / 2, 0.015, zl.centerZ);
        const rightBar = new THREE.Mesh(
          trackGeo(new THREE.BoxGeometry(frameThick, 0.025, zd)),
          zoneBorderMat
        );
        rightBar.position.set(zl.maxX - frameThick / 2, 0.015, zl.centerZ);
        yardRoot.add(topBar, botBar, leftBar, rightBar);

        // Overhead Zone Signboard facing central aisle (Z=0)
        const bannerZ = zl.centerZ < 0 ? zl.maxZ - 0.55 : zl.minZ + 0.55;
        const bannerW = Math.min(zw - 1.2, 8.2);
        const bannerH = 1.7;
        const poleGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.095, 3.6, 10));
        const poleLeft = new THREE.Mesh(poleGeo, postMat);
        poleLeft.position.set(zl.centerX - bannerW * 0.42, 1.8, bannerZ);
        const poleRight = new THREE.Mesh(poleGeo, postMat);
        poleRight.position.set(zl.centerX + bannerW * 0.42, 1.8, bannerZ);
        yardRoot.add(poleLeft, poleRight);

        const bannerTex = trackTex(
          createZoneBannerTexture(zl.zone, zl.count, zl.repairCount, maxAniso)
        );
        const bannerBoardMat = trackMat(
          new THREE.MeshStandardMaterial({
            map: bannerTex,
            roughness: 0.4,
            metalness: 0.15,
          })
        );
        const bannerMesh = new THREE.Mesh(
          trackGeo(new THREE.BoxGeometry(bannerW, bannerH, 0.14)),
          [
            bannerSideMat,
            bannerSideMat,
            bannerSideMat,
            bannerSideMat,
            bannerBoardMat,
            bannerBoardMat,
          ]
        );
        bannerMesh.position.set(zl.centerX, 3.65, bannerZ);
        yardRoot.add(bannerMesh);

        // Build each Stall & Real Vehicle in Zone
        zl.stalls.forEach((stall) => {
          const isRepair = stall.openRepairs.length > 0 || stall.isRegistryMaintenance;
          const statusMode: "repair" | "registry_maint" | "inuse" | "available" | "inactive" =
            stall.openRepairs.length > 0
              ? "repair"
              : stall.isRegistryMaintenance
              ? "registry_maint"
              : stall.vehicle.activeStatus === "Inactive"
              ? "inactive"
              : stall.isInUseToday
              ? "inuse"
              : "available";

          const shortCode = formatShortBayCode(stall.vehicle);
          const stallGroup = new THREE.Group();
          stallGroup.position.set(stall.x, 0, stall.z);
          stallGroup.rotation.y = stall.rotY;
          yardRoot.add(stallGroup);

          const bayKey = `${stall.bayW}x${stall.bayD}`;
          let floorGeo = floorGeoCache.get(bayKey);
          if (!floorGeo) {
            floorGeo = trackGeo(new THREE.PlaneGeometry(stall.bayW, stall.bayD));
            floorGeoCache.set(bayKey, floorGeo);
          }

          // 1. Stall Painted Floor Plate
          const floorTex = trackTex(
            createBayFloorTexture(
              shortCode,
              stall.vehicle.registrationNumber || "",
              statusMode,
              zl.zone.accentCss,
              stall.primaryRepairMeta?.shortLabel || (stall.isRegistryMaintenance ? "ซ่อมบำรุง" : null),
              maxAniso
            )
          );
          const floorMat = trackMat(
            new THREE.MeshStandardMaterial({
              map: floorTex,
              roughness: 0.78,
              metalness: 0.08,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            })
          );
          const floorMesh = new THREE.Mesh(floorGeo, floorMat);
          floorMesh.rotation.x = -Math.PI / 2;
          floorMesh.position.y = 0.018;
          floorMesh.receiveShadow = true;
          stallGroup.add(floorMesh);

          // Selection / Highlight Rim Plane
          let rimGeo = rimGeoCache.get(bayKey);
          if (!rimGeo) {
            rimGeo = trackGeo(
              new THREE.RingGeometry(
                Math.max(stall.bayW, stall.bayD) * 0.48,
                Math.max(stall.bayW, stall.bayD) * 0.54,
                4
              )
            );
            rimGeoCache.set(bayKey, rimGeo);
          }
          const rimMat = trackMat(
            new THREE.MeshBasicMaterial({
              color: isRepair ? 0xef4444 : 0x38bdf8,
              transparent: true,
              opacity: 0,
              depthWrite: false,
            })
          );
          const rimMesh = new THREE.Mesh(rimGeo, rimMat);
          rimMesh.rotation.x = -Math.PI / 2;
          rimMesh.rotation.z = Math.PI / 4;
          rimMesh.position.y = 0.025;
          stallGroup.add(rimMesh);
          stallBorderMeshes.set(stall.vehicle.vehicleId.toUpperCase(), rimMesh);

          // 2. Safety Wheel Stop at Back of Stall
          let wsGeo = wheelStopGeoCache.get(stall.bayW);
          if (!wsGeo) {
            wsGeo = trackGeo(new THREE.BoxGeometry(stall.bayW * 0.64, 0.14, 0.22));
            wheelStopGeoCache.set(stall.bayW, wsGeo);
          }
          const wheelStop = new THREE.Mesh(wsGeo, curbMat);
          wheelStop.position.set(0, 0.07, -stall.bayD * 0.42);
          stallGroup.add(wheelStop);

          // 3. Compact Standing Registration Signboard at Front-Right Corner of Bay
          const signX = stall.bayW * 0.37;
          const signZ = stall.bayD * 0.43;
          const signPost = new THREE.Mesh(signPostGeo, postMat);
          signPost.position.set(signX, 0.49, signZ);
          stallGroup.add(signPost);

          const signTex = trackTex(
            createSignboardTexture(
              shortCode,
              stall.vehicle.registrationNumber || "",
              statusMode,
              stall.primaryRepairMeta?.shortLabel || (stall.isRegistryMaintenance ? "ซ่อมบำรุง" : null),
              maxAniso
            )
          );
          const signFaceMat = trackMat(
            new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.38, metalness: 0.12 })
          );
          const signBoard = new THREE.Mesh(signBoardGeo, [
            postMat,
            postMat,
            postMat,
            postMat,
            signFaceMat,
            signFaceMat,
          ]);
          signBoard.position.set(signX, 1.12, signZ);
          stallGroup.add(signBoard);

          // 4. EV Charger Pedestal in Zone 2 (TTEV-)
          if (zl.zone.id === "ev_tractor") {
            const chargerX = -stall.bayW * 0.36;
            const chargerZ = -stall.bayD * 0.42;
            const pedestal = new THREE.Mesh(chargerPedGeo, chargerBodyMat);
            pedestal.position.set(chargerX, 0.62, chargerZ);
            const chargerScreen = new THREE.Mesh(chargerScreenGeo, chargerScreenMat);
            chargerScreen.position.set(chargerX, 0.96, chargerZ + 0.115);
            stallGroup.add(pedestal, chargerScreen);
          }

          // 4B. Safety Bollards for Zone 5 Clamp Truck Bay (SC-01)
          if (zl.zone.id === "clamp_truck") {
            const bollardGeo = trackGeo(new THREE.CylinderGeometry(0.065, 0.075, 0.82, 10));
            [-stall.bayW * 0.44, stall.bayW * 0.44].forEach((bx) => {
              const bollard = new THREE.Mesh(bollardGeo, curbMat);
              bollard.position.set(bx, 0.41, -stall.bayD * 0.44);
              stallGroup.add(bollard);
            });
          }

          // 5. Realistic 3D Vehicle Model (Instantiated from Shared Merged Template!)
          const template = getOrBuildTemplate(stall.modelType);
          const vehicleGroup = new THREE.Group();
          const scaleFactor =
            stall.modelType === "trailer"
              ? 0.88
              : stall.modelType === "clamp_truck"
              ? 0.90
              : 0.92;
          vehicleGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);
          vehicleGroup.position.set(0, 0, stall.modelType === "clamp_truck" ? -0.45 : -0.15);

          template.parts.forEach((part) => {
            const m = new THREE.Mesh(part.geometry, part.material);
            m.castShadow = !isSoftwareGl && part.castShadow;
            vehicleGroup.add(m);
          });

          // Per-vehicle crisp roof & side registration decals
          template.decals.forEach((dSpec) => {
            const dGeo = getDecalGeo(dSpec.size[0], dSpec.size[1]);
            const dMat = getDecalMat(shortCode, dSpec.style);
            const dMesh = new THREE.Mesh(dGeo, dMat);
            dMesh.applyMatrix4(dSpec.matrix);
            vehicleGroup.add(dMesh);
          });

          stallGroup.add(vehicleGroup);

          // 6. Repair Warning Beacon + Safety Cone when Vehicle has Open Repairs
          if (isRepair) {
            const beacon = new THREE.Mesh(beaconGeo, repairBeaconMat);
            beacon.position.set(signX, 1.38, signZ);
            stallGroup.add(beacon);

            const alertHalo = new THREE.Mesh(haloGeo, repairBeaconMat);
            alertHalo.rotation.x = Math.PI / 2;
            alertHalo.position.set(0, 2.30, 0);
            stallGroup.add(alertHalo);

            const coneBase = new THREE.Mesh(coneBaseGeo, coneOrangeMat);
            coneBase.position.set(-stall.bayW * 0.35, 0.018, stall.bayD * 0.4);
            const coneBody = new THREE.Mesh(coneBodyGeo, coneOrangeMat);
            coneBody.position.set(-stall.bayW * 0.35, 0.24, stall.bayD * 0.4);
            const coneStripe = new THREE.Mesh(coneStripeGeo, coneWhiteMat);
            coneStripe.position.set(-stall.bayW * 0.35, 0.26, stall.bayD * 0.4);
            stallGroup.add(coneBase, coneBody, coneStripe);
          }

          // 7. Invisible Layer-1 Raycast Hitbox for instant pointer pick
          let hitGeo = hitGeoCache.get(bayKey);
          if (!hitGeo) {
            hitGeo = trackGeo(new THREE.BoxGeometry(stall.bayW, 2.8, stall.bayD));
            hitGeoCache.set(bayKey, hitGeo);
          }
          const hitMesh = new THREE.Mesh(hitGeo, hitHiddenMat);
          hitMesh.position.set(0, 1.4, 0);
          hitMesh.layers.set(1);
          hitMesh.userData.vehicleId = stall.vehicle.vehicleId;
          stallGroup.add(hitMesh);
          hitboxMeshes.push(hitMesh);
        });
      });
    };

    const highlightSelection = (vid: string | null, hoveredId: string | null) => {
      stallBorderMeshes.forEach((mesh, key) => {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        const isSel = vid && key === vid.toUpperCase();
        const isHov = hoveredId && key === hoveredId.toUpperCase();
        const nextOpacity = isSel ? 0.72 : isHov ? 0.45 : 0;
        if (mat.opacity !== nextOpacity) {
          mat.opacity = nextOpacity;
        }
      });
    };

    rebuildYard(zoneLayoutsRef.current);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Smooth On-Demand Render Loop & DOM Floating Pin Projection
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let hasCamGoal = false;
    let lastTime = performance.now();

    const updateProjectedPins = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const showPins = showFloatingBadgesRef.current;

      stallsRef.current.forEach((stall) => {
        const keyUpper = stall.vehicle.vehicleId.toUpperCase();
        const el = repairPinRefs.current.get(keyUpper);
        if (!el) return;
        const prev = prevPinState.get(keyUpper);

        if (!showPins) {
          if (!prev || prev.visible) {
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
            prevPinState.set(keyUpper, { x: 0, y: 0, visible: false });
          }
          return;
        }

        _projVec.set(stall.x, 2.55, stall.z);
        _projVec.project(camera);
        if (_projVec.z < -1 || _projVec.z > 1) {
          if (!prev || prev.visible) {
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
            prevPinState.set(keyUpper, { x: 0, y: 0, visible: false });
          }
          return;
        }
        const px = (_projVec.x * 0.5 + 0.5) * w;
        const py = (-_projVec.y * 0.5 + 0.5) * h;
        if (px < -60 || px > w + 60 || py < -40 || py > h + 40) {
          if (!prev || prev.visible) {
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
            prevPinState.set(keyUpper, { x: 0, y: 0, visible: false });
          }
          return;
        }

        if (
          !prev ||
          !prev.visible ||
          Math.abs(px - prev.x) >= 0.4 ||
          Math.abs(py - prev.y) >= 0.4
        ) {
          el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
          if (!prev || !prev.visible) {
            el.style.opacity = "1";
            el.style.pointerEvents = "auto";
          }
          prevPinState.set(keyUpper, { x: px, y: py, visible: true });
        }
      });
    };

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const requestRender = () => {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
        lastTime = now;

        if (hasCamGoal) {
          const factor = 1 - Math.exp(-7 * dt);
          camera.position.lerp(_camGoalPos, factor);
          controls.target.lerp(_camGoalTarget, factor);
          if (
            camera.position.distanceTo(_camGoalPos) < 0.08 &&
            controls.target.distanceTo(_camGoalTarget) < 0.06
          ) {
            camera.position.copy(_camGoalPos);
            controls.target.copy(_camGoalTarget);
            hasCamGoal = false;
          } else {
            renderDirty = true;
          }
        }

        const didDamp = controls.update();
        if (didDamp && !isSoftwareGl) {
          renderDirty = true;
        }

        renderer.render(scene, camera);
        updateProjectedPins();

        const done = () => {
          renderBusy = false;
          if (renderDirty || hasCamGoal) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    sceneBridgeRef.current = {
      rebuildYard: (layouts) => {
        rebuildYard(layouts);
        highlightSelection(selectedVehicleIdRef.current, lastHoveredId);
        requestRender();
      },
      setCameraGoal: (pos, target) => {
        _camGoalPos.set(...pos);
        _camGoalTarget.set(...target);
        hasCamGoal = true;
        requestRender();
      },
      highlightSelection: (vid) => {
        highlightSelection(vid, lastHoveredId);
        requestRender();
      },
    };

    // OrbitControls events
    const onControlsStart = () => {
      hasCamGoal = false;
    };
    const onControlsChange = () => {
      requestRender();
    };
    controls.addEventListener("start", onControlsStart);
    controls.addEventListener("change", onControlsChange);

    // Raycasting on Layer 1 hitboxes
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverTime = 0;

    const getHitVehicleId = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(hitboxMeshes, false);
      if (hits.length > 0) {
        return String(hits[0].object.userData.vehicleId || "");
      }
      return null;
    };

    const updateHoverDom = (hitId: string | null) => {
      const banner = hoverBannerRef.current;
      if (!banner) return;
      if (!hitId) {
        banner.style.display = "none";
        return;
      }
      const stall = stallsRef.current.find(
        (s) => s.vehicle.vehicleId.toUpperCase() === hitId.toUpperCase()
      );
      if (!stall) {
        banner.style.display = "none";
        return;
      }
      const typeLabel = getVehicleTypeDisplayLabel(stall.vehicle.vehicleType, stall.vehicle);
      const repairText = stall.primaryRepairMeta ? ` · ⚠ ${stall.primaryRepairMeta.shortLabel}` : "";
      banner.textContent = `${stall.vehicle.vehicleId} · ${typeLabel}${repairText}`;
      banner.style.display = "flex";
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      // Never raycast while dragging/orbiting camera!
      if (e.buttons !== 0) return;
      const now = performance.now();
      if (now - lastHoverTime < 65) return;
      lastHoverTime = now;
      const hitId = getHitVehicleId(e.clientX, e.clientY);
      if (hitId === lastHoveredId) return;
      lastHoveredId = hitId;
      renderer.domElement.style.cursor = hitId ? "pointer" : "grab";
      updateHoverDom(hitId);
      highlightSelection(selectedVehicleIdRef.current, hitId);
      requestRender();
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return; // dragged orbit, not click
      const hitId = getHitVehicleId(e.clientX, e.clientY);
      if (hitId) {
        const stall = stallsRef.current.find(
          (s) => s.vehicle.vehicleId.toUpperCase() === hitId.toUpperCase()
        );
        if (stall) {
          focusVehicleIn3D(stall);
        } else {
          setSelectedVehicleId(hitId);
        }
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // ResizeObserver for crisp layout transitions
    const resizeObs = new ResizeObserver(() => {
      if (!container) return;
      const w = Math.max(300, container.clientWidth);
      const h = Math.max(280, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      prevPinState.clear();
      requestRender();
    });
    resizeObs.observe(container);

    // WebGL context loss guard
    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      setWebglError("การเชื่อมต่อกราฟิก 3D ขัดข้องชั่วคราว กรุณารีเฟรชมุมมอง");
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    requestRender();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObs.disconnect();
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("change", onControlsChange);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      cleanupYard();
      templateCache.forEach((tpl) => tpl.dispose());
      templateCache.clear();
      texturePack.dispose();
      baseGroundGeo.dispose();
      baseGroundMat.dispose();
      envTarget.dispose();
      renderer.dispose();
      sceneBridgeRef.current = null;
    };
  }, []);

  // Rebuild yard geometry when vehicle list or open repairs change
  useEffect(() => {
    sceneBridgeRef.current?.rebuildYard(zoneLayouts);
  }, [zoneLayouts]);

  // Update highlight ring when selection changes (or floating badge visibility toggles)
  useEffect(() => {
    sceneBridgeRef.current?.highlightSelection(selectedVehicleId);
  }, [selectedVehicleId, showFloatingBadges]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {/* Compact Single-Row 5-Zone Legend & Camera Switcher Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 shrink-0">
        {zoneLayouts.map((zl) => {
          const isActive = activePreset === zl.zone.id;
          return (
            <button
              key={zl.zone.id}
              type="button"
              onClick={() => focusPreset(zl.zone.id)}
              className={`text-left px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-sky-900/60 dark:border-sky-500"
                  : "bg-white text-slate-800 border-slate-200 hover:border-slate-300 dark:bg-[#0d1b33] dark:text-slate-100 dark:border-[#1e3a5f] dark:hover:border-sky-600"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: zl.zone.accentCss }}
                  />
                  <span className="text-[11px] font-bold truncate">{zl.zone.shortTitle}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {zl.repairCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-[10px] text-rose-500 dark:text-rose-400 whitespace-nowrap">
                      <Wrench size={10} />
                      ซ่อม {zl.repairCount}
                    </span>
                  )}
                  <span className="font-mono tabular-nums text-[11px] font-bold">
                    {zl.count} คัน
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main 3D Viewport Container — fills remaining screen height cleanly without page scroll */}
      <div className="relative w-full h-[calc(100dvh-290px)] min-h-[380px] lg:h-auto lg:flex-1 lg:min-h-0 rounded-xl overflow-hidden border border-slate-200 dark:border-[#1e3a5f] bg-[#1e293b] dark:bg-[#0b1526]">
        {/* Isolated WebGL Canvas Mount */}
        <div ref={mountRef} className="w-full h-full" />

        {/* WebGL Unavailable Fallback */}
        {webglError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-100 p-6 text-center z-20">
            <AlertTriangle size={32} className="text-amber-400 mb-2" />
            <div className="text-sm font-bold">{webglError}</div>
            <div className="text-xs text-slate-400 mt-1">
              กรุณาตรวจสอบการตั้งค่า WebGL หรือสลับกลับไปใช้มุมมองตาราง
            </div>
          </div>
        )}

        {/* Top-Left Minimal Yard Telemetry Spec Header (Unobtrusive) */}
        <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none flex flex-wrap items-center gap-2 max-w-[calc(100%-20px)]">
          <div
            className="pointer-events-auto px-2.5 py-1 rounded-lg border border-white/15 text-white flex items-center gap-2 text-[11px]"
            style={{ backgroundColor: "rgba(15, 23, 42, 0.86)" }}
          >
            <Truck size={13} className="text-sky-400 shrink-0" />
            <span className="font-bold whitespace-nowrap">ลานจอดรถ 3D (5 โซน)</span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span className="font-mono tabular-nums text-slate-200 whitespace-nowrap">
              {yardSummary.total} คัน
            </span>
            {yardSummary.repairing > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-rose-300 whitespace-nowrap">
                  <Wrench size={11} />
                  แจ้งซ่อม {yardSummary.repairing} คัน ({yardSummary.openWorkOrders} ใบงาน)
                </span>
              </>
            )}
          </div>

          <div
            ref={hoverBannerRef}
            className="px-2 py-1 rounded-lg border border-sky-400/40 text-sky-200 font-mono text-[10px] font-semibold items-center gap-1.5"
            style={{ display: "none", backgroundColor: "rgba(15, 23, 42, 0.90)" }}
          />
        </div>

        {/* Top-Right Quick-Select Active Repair List (expands vertically to show all open repairs) */}
        {repairStalls.length > 0 && !selectedStall && (
          <div
            className="absolute top-2.5 right-2.5 z-10 w-[224px] max-w-[calc(100%-20px)] max-h-[calc(100%-64px)] flex flex-col rounded-lg border border-rose-500/40 p-2 text-white shadow-lg"
            style={{ backgroundColor: "rgba(28, 13, 18, 0.90)" }}
          >
            <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-rose-200 mb-1.5 shrink-0">
              <span className="inline-flex items-center gap-1">
                <Wrench size={11} className="text-rose-400" />
                รถที่แจ้งซ่อมค้าง ({repairStalls.length} คัน)
              </span>
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto pr-0.5">
              {repairStalls.map((st) => (
                <button
                  key={st.vehicle.vehicleId}
                  type="button"
                  onClick={() => focusVehicleIn3D(st)}
                  className="w-full px-2 py-1 rounded text-[10px] font-semibold bg-rose-600/80 hover:bg-rose-500 text-white border border-rose-400/50 transition-colors cursor-pointer flex items-center justify-between gap-2 text-left"
                >
                  <span className="font-mono font-bold shrink-0">{st.vehicle.vehicleId}</span>
                  <span className="truncate text-[10px] text-rose-100">
                    {st.primaryRepairMeta ? st.primaryRepairMeta.shortLabel : "ซ่อมบำรุง"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Projected Interactive Floating Repair Alert Badges over 3D Vehicles (Compact Size) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
          {repairStalls.map((stall) => {
            const keyUpper = stall.vehicle.vehicleId.toUpperCase();
            const meta = stall.primaryRepairMeta;
            const isSelected = selectedVehicleId?.toUpperCase() === keyUpper;
            return (
              <button
                key={stall.vehicle.vehicleId}
                ref={(el) => {
                  if (el) repairPinRefs.current.set(keyUpper, el);
                  else repairPinRefs.current.delete(keyUpper);
                }}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  focusVehicleIn3D(stall);
                }}
                className={`absolute top-0 left-0 px-1.5 py-0.5 rounded border text-[9px] leading-tight font-semibold text-white shadow transition-opacity flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  isSelected
                    ? "border-white ring-1 ring-amber-300"
                    : "border-rose-200/80 hover:border-white"
                }`}
                style={{
                  opacity: 0,
                  backgroundColor:
                    meta?.severity === "parts"
                      ? "rgba(217, 119, 6, 0.92)"
                      : meta?.severity === "repair"
                      ? "rgba(220, 38, 38, 0.92)"
                      : "rgba(234, 88, 12, 0.92)",
                }}
                title={`คลิกเพื่อดูอาการเสียของ ${stall.vehicle.vehicleId}`}
              >
                <Wrench size={9} className="shrink-0" />
                <span className="font-mono">{stall.vehicle.vehicleId}</span>
                <span>·</span>
                <span>{meta?.shortLabel || "ซ่อมบำรุง"}</span>
              </button>
            );
          })}
        </div>

        {/* Selected Vehicle & Repair Detail Slide-Over Panel (Clean Solid Surface over WebGL) */}
        {selectedStall && (
          <div
            className="absolute top-3 right-3 bottom-20 z-20 w-[min(390px,calc(100%-24px))] rounded-xl border border-slate-700 text-slate-100 flex flex-col overflow-hidden shadow-2xl"
            style={{ backgroundColor: "rgba(11, 19, 34, 0.97)" }}
          >
            <div className="px-4 py-3 border-b border-slate-700/80 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-extrabold text-sky-300">
                    {selectedStall.vehicle.vehicleId}
                  </span>
                  <span className="text-xs text-slate-300 truncate">
                    · {getVehicleTypeDisplayLabel(selectedStall.vehicle.vehicleType, selectedStall.vehicle)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                  {selectedStall.vehicle.description || "-"} · ทะเบียน{" "}
                  {selectedStall.vehicle.registrationNumber || "-"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVehicleId(null)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
                aria-label="ปิดรายละเอียด"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {/* Vehicle Operational Status Row */}
              <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800">
                <div>
                  <div className="text-[10px] text-slate-400">สถานะใช้งาน</div>
                  <div className="font-semibold text-slate-100 mt-0.5">
                    {selectedStall.vehicle.activeStatus} ·{" "}
                    {selectedStall.isInUseToday
                      ? "กำลังใช้งาน"
                      : selectedStall.vehicle.operationalStatus}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">คนขับประจำวันนี้</div>
                  <div className="font-semibold text-sky-300 mt-0.5 truncate flex items-center gap-1">
                    <User size={11} className="shrink-0" />
                    {selectedStall.assignedToday?.driverName || "ยังไม่ระบุ"}
                  </div>
                </div>
              </div>

              {/* Active Open Repairs Section */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-bold text-xs flex items-center gap-1.5 text-slate-100">
                    <Wrench size={13} className="text-rose-400" />
                    สถานะแจ้งซ่อม (ระบบแจ้งซ่อม)
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    {selectedStall.openRepairs.length} ใบงานค้าง
                  </span>
                </div>

                {selectedStall.openRepairs.length > 0 ? (
                  <div className="space-y-2.5">
                    {selectedStall.openRepairs.map((rec) => {
                      const meta = resolveOpenRepairMeta(rec);
                      return (
                        <div
                          key={rec.id}
                          className="p-3 rounded-lg border border-rose-500/40 bg-rose-950/35 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-mono font-bold text-rose-200">
                              {rec.workOrderNo || rec.id}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                meta.severity === "repair"
                                  ? "bg-red-600 text-white"
                                  : meta.severity === "parts"
                                  ? "bg-amber-600 text-white"
                                  : "bg-orange-600 text-white"
                              }`}
                            >
                              {meta.label}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-300">
                            <span className="text-slate-400">ประเภทงานซ่อม: </span>
                            <strong className="text-white">{rec.repairType}</strong>
                          </div>

                          <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-[11px] text-slate-100 whitespace-pre-wrap">
                            <div className="text-[10px] font-semibold text-amber-300 mb-0.5">
                              อาการเสีย / รายละเอียด:
                            </div>
                            {rec.repairDescription || "-"}
                          </div>

                          <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-300">
                            <div>
                              <span className="text-slate-400">วันที่แจ้ง: </span>
                              {rec.workingDate || "-"}
                            </div>
                            <div>
                              <span className="text-slate-400">ผู้แจ้ง: </span>
                              {rec.requesterName || "-"}
                            </div>
                            <div>
                              <span className="text-slate-400">ช่างผู้รับผิดชอบ: </span>
                              {rec.technicianName && rec.technicianName !== "-"
                                ? rec.technicianName
                                : "รอจัดช่าง"}
                            </div>
                            {rec.vendorName && rec.vendorName !== "-" && (
                              <div>
                                <span className="text-slate-400">Vendor: </span>
                                {rec.vendorName}
                              </div>
                            )}
                          </div>

                          {Array.isArray(rec.spareParts) && rec.spareParts.length > 0 && (
                            <div className="text-[11px] text-slate-300 pt-1 border-t border-rose-500/20">
                              <div className="text-[10px] text-slate-400 mb-1">รายการอะไหล่ ({rec.spareParts.length}):</div>
                              <div className="space-y-0.5">
                                {rec.spareParts.slice(0, 4).map((sp, idx) => (
                                  <div key={sp.id || idx} className="flex justify-between gap-2 text-[10px]">
                                    <span className="truncate">{sp.partName}</span>
                                    <span className="font-mono shrink-0">
                                      {sp.qty} {sp.unit || "ชิ้น"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {(rec.supervisorNotes || rec.notes) && (
                            <div className="text-[11px] text-amber-200/90 pt-1 border-t border-rose-500/20">
                              หมายเหตุ: {rec.supervisorNotes || rec.notes}
                            </div>
                          )}

                          {Array.isArray(rec.photos) && rec.photos.length > 0 && (
                            <div className="pt-1 border-t border-rose-500/20">
                              <div className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                                <Camera size={10} />
                                รูปภาพประกอบ ({rec.photos.length})
                              </div>
                              <div className="flex gap-1.5 overflow-x-auto pb-1">
                                {rec.photos.map((ph) => (
                                  <button
                                    key={ph.id}
                                    type="button"
                                    onClick={() => setLightboxPhoto(ph)}
                                    className="w-12 h-12 rounded border border-slate-600 overflow-hidden shrink-0 cursor-pointer hover:border-sky-400"
                                  >
                                    <img
                                      src={ph.dataUrl}
                                      alt={ph.name}
                                      className="w-full h-full object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : selectedStall.isRegistryMaintenance ? (
                  <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/30 text-amber-100 text-[11px] space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <Clock size={13} className="text-amber-400" />
                      สถานะรถในทะเบียน: Maintenance
                    </div>
                    <div className="text-amber-200/80">
                      ไม่พบใบแจ้งซ่อมที่ยังค้างอยู่ในหน้า ระบบแจ้งซ่อม แต่ทะเบียนรถระบุว่ากำลังซ่อมบำรุง
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/25 text-emerald-200 text-[11px] flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                    <span>ไม่มีใบแจ้งซ่อมค้างในระบบ รถอยู่ในสถานะปกติ</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-4 py-2.5 border-t border-slate-800 flex flex-wrap gap-2 justify-between items-center bg-slate-950/80">
              <div className="flex gap-1.5">
                {onViewVehicleDetails && (
                  <button
                    type="button"
                    onClick={() => onViewVehicleDetails(selectedStall.vehicle)}
                    className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 cursor-pointer flex items-center gap-1"
                  >
                    <Eye size={12} />
                    รายละเอียดรถ
                  </button>
                )}
                {onEditVehicle && selectedStall.vehicle.id !== BUILTIN_SC01_CLAMP_VEHICLE.id && (
                  <button
                    type="button"
                    onClick={() => onEditVehicle(selectedStall.vehicle)}
                    className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 cursor-pointer flex items-center gap-1"
                  >
                    <Edit3 size={12} />
                    แก้ไข
                  </button>
                )}
              </div>

              {onNavigateToFixFlush && (
                <button
                  type="button"
                  onClick={onNavigateToFixFlush}
                  className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-sky-600 hover:bg-sky-500 text-white cursor-pointer flex items-center gap-1"
                >
                  <ExternalLink size={12} />
                  ไปหน้าแจ้งซ่อม
                </button>
              )}
            </div>
          </div>
        )}

        {/* Unified Collapsible Bottom Control Dock (Collapsed by default) */}
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[96%]">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className={`px-3 py-1 text-[11px] font-semibold text-slate-200 flex items-center gap-1 cursor-pointer border-white/15 ${
              dockCollapsed ? "rounded-lg border shadow-lg" : "rounded-t-lg border border-b-0"
            }`}
            style={{ backgroundColor: "rgba(15, 23, 42, 0.90)" }}
          >
            {dockCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {dockCollapsed ? "แสดงแถบควบคุมมุมมอง 3D" : "ซ่อนแถบควบคุม"}
          </button>

          {!dockCollapsed && (
            <div
              className="px-3 py-2 rounded-xl border border-white/15 flex flex-wrap items-center justify-center gap-1.5 shadow-xl"
              style={{ backgroundColor: "rgba(15, 23, 42, 0.90)" }}
            >
              {/* Camera Zone Presets */}
              {(
                [
                  { id: "overview" as const, label: "ภาพรวมลานจอด" },
                  { id: "diesel_tractor" as const, label: "โซน TT-" },
                  { id: "ev_tractor" as const, label: "โซน TTEV-" },
                  { id: "forklift" as const, label: "โซน FL-" },
                  { id: "trailer" as const, label: "โซน TTL-" },
                  { id: "clamp_truck" as const, label: "โซนรถคีบ SC-01" },
                  { id: "top" as const, label: "มุมสูง 90°" },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => focusPreset(preset.id)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    activePreset === preset.id
                      ? "bg-sky-600 text-white"
                      : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  {preset.label}
                </button>
              ))}

              <span aria-hidden="true" className="w-px h-5 bg-slate-700 mx-0.5" />

              {/* Filter Repair-Only Toggle */}
              <button
                type="button"
                onClick={() => setShowRepairOnly((v) => !v)}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer border ${
                  showRepairOnly
                    ? "bg-rose-600 text-white border-rose-400"
                    : "bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
                }`}
              >
                <Wrench size={12} />
                {showRepairOnly ? "แสดงเฉพาะรถแจ้งซ่อม (เปิดอยู่)" : "เฉพาะรถแจ้งซ่อม"}
              </button>

              {/* Floating Labels Toggle */}
              <button
                type="button"
                onClick={() => setShowFloatingBadges((v) => !v)}
                className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 whitespace-nowrap cursor-pointer"
                title="แสดง/ซ่อนป้ายแจ้งเตือนซ่อมเหนือตัวรถ"
              >
                {showFloatingBadges ? <Eye size={12} /> : <EyeOff size={12} />}
                ป้ายซ่อม
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedVehicleId(null);
                  focusPreset("overview");
                }}
                className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 whitespace-nowrap cursor-pointer"
                title="รีเซ็ตมุมกล้อง"
              >
                <RotateCcw size={12} />
                รีเซ็ต
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Compact Single-Line Bottom Legend Bar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] text-[10px] text-slate-600 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-500" />
            พร้อมใช้งาน
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-sky-500" />
            กำลังใช้งานวันนี้
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
            <span className="w-2 h-2 rounded-sm bg-rose-500" />
            แจ้งซ่อมค้าง (คลิกที่รถเพื่อดูอาการเสีย)
          </span>
          <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
            <Zap size={11} />
            TTEV- พร้อมเสาชาร์จ
          </span>
        </div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 hidden sm:block">
          ลากเพื่อหมุน 360° · เลื่อนลูกกลิ้งเพื่อซูม · คลิกขวาเพื่อแพน · คลิกที่รถเพื่อดูรายละเอียด
        </div>
      </div>

      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[150] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="relative max-w-3xl max-h-[85vh] rounded-xl overflow-hidden border border-slate-700 bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-900/90 text-white hover:bg-slate-800 cursor-pointer"
              aria-label="ปิดรูปภาพ"
            >
              <X size={18} />
            </button>
            <img
              src={lightboxPhoto.dataUrl}
              alt={lightboxPhoto.name}
              className="max-h-[80vh] w-auto object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
