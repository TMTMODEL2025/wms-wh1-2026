/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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
  isElectricTractorVehicle,
  isForkliftVehicle,
  isStandardTractorVehicle,
  isTrailerVehicle,
} from "../../utils/vehicleHelpers";
import {
  BuiltVehicleModel,
  Pm3dTexturePack,
  buildVehicleByModelType,
  createPm3dTexturePack,
} from "../pm3d/pm3dVehicleBuilders";

export type ParkingZoneId = "diesel_tractor" | "ev_tractor" | "forklift" | "trailer";

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
];

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
  modelType: MhPm3dModelType;
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

type YardCameraPreset = "overview" | "diesel_tractor" | "ev_tractor" | "forklift" | "trailer" | "top";

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
  modelType: MhPm3dModelType;
} {
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

function createBayFloorTexture(
  code: string,
  regNo: string,
  statusMode: "repair" | "registry_maint" | "inuse" | "available" | "inactive",
  zoneAccentCss: string,
  repairShortLabel: string | null,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext("2d")!;

  const isRepair = statusMode === "repair" || statusMode === "registry_maint";

  // Concrete / tarmac stall surface
  ctx.fillStyle = isRepair ? "#3b171b" : "#1e293b";
  ctx.fillRect(0, 0, 512, 768);

  // Subtle surface asphalt speckle
  for (let i = 0; i < 650; i++) {
    const x = (i * 97) % 512;
    const y = (i * 193) % 768;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.12)";
    ctx.fillRect(x, y, 2, 2);
  }

  // Outer bay border lines
  const borderColor = isRepair
    ? "#ef4444"
    : statusMode === "inuse"
    ? "#38bdf8"
    : statusMode === "inactive"
    ? "#64748b"
    : zoneAccentCss;

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = isRepair ? 18 : 12;
  ctx.strokeRect(12, 12, 488, 744);

  // Hazard diagonal warning stripes along front & rear aprons for vehicles under repair
  if (isRepair) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(20, 20, 472, 64);
    ctx.rect(20, 684, 472, 64);
    ctx.clip();
    ctx.fillStyle = "#f97316";
    ctx.fillRect(20, 20, 472, 728);
    ctx.fillStyle = "#18181b";
    for (let x = -760; x < 900; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 22, 0);
      ctx.lineTo(x - 100, 768);
      ctx.lineTo(x - 122, 768);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Front bay number plate strip at bottom of texture (facing drive aisle)
  ctx.fillStyle = isRepair ? "#b91c1c" : "#0f172a";
  ctx.fillRect(36, 610, 440, 126);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 610, 440, 126);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 66px 'JetBrains Mono', monospace";
  ctx.fillText(code.slice(0, 10), 256, 656);

  ctx.fillStyle = isRepair ? "#fecaca" : "#cbd5e1";
  ctx.font = "700 26px 'Noto Sans Thai', sans-serif";
  const subText = isRepair && repairShortLabel
    ? `⚠ แจ้งซ่อม: ${repairShortLabel}`
    : regNo || (statusMode === "inuse" ? "กำลังใช้งาน" : "พร้อมใช้งาน");
  ctx.fillText(subText.slice(0, 24), 256, 708);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, Math.max(1, maxAnisotropy));
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
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  const isRepair = statusMode === "repair" || statusMode === "registry_maint";
  ctx.fillStyle = isRepair ? "#7f1d1d" : "#0f172a";
  ctx.fillRect(0, 0, 512, 256);

  // Top color status bar
  ctx.fillStyle = isRepair
    ? "#ef4444"
    : statusMode === "inuse"
    ? "#0284c7"
    : statusMode === "inactive"
    ? "#475569"
    : "#16a34a";
  ctx.fillRect(0, 0, 512, 48);

  ctx.strokeStyle = isRepair ? "#fca5a5" : "#38bdf8";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 504, 248);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 24px 'Noto Sans Thai', sans-serif";
  const headerText = isRepair
    ? `แจ้งซ่อม · ${repairShortLabel || "ซ่อมบำรุง"}`
    : statusMode === "inuse"
    ? "กำลังปฏิบัติงาน"
    : statusMode === "inactive"
    ? "งดใช้งาน (INACTIVE)"
    : "พร้อมใช้งาน";
  ctx.fillText(headerText, 256, 25);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 76px 'JetBrains Mono', monospace";
  ctx.fillText(code.slice(0, 10), 256, 126);

  ctx.fillStyle = isRepair ? "#fecaca" : "#94a3b8";
  ctx.font = "600 28px 'Noto Sans Thai', sans-serif";
  ctx.fillText((regNo || "-").slice(0, 22), 256, 206);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, Math.max(1, maxAnisotropy));
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
  vehicleAssignmentMap: Map<string, VehicleAssignment>
): ZoneLayoutRect[] {
  const grouped: Record<ParkingZoneId, Vehicle[]> = {
    diesel_tractor: [],
    ev_tractor: [],
    forklift: [],
    trailer: [],
  };

  vehicles.forEach((v) => {
    const { zoneId } = classifyVehicleParkingZone(v);
    grouped[zoneId].push(v);
  });

  // Sort vehicles naturally inside each zone (e.g., TT-01, TT-02, TTEV-19..TTEV-27)
  (Object.keys(grouped) as ParkingZoneId[]).forEach((zKey) => {
    grouped[zKey].sort((a, b) =>
      String(a.vehicleId || "").localeCompare(String(b.vehicleId || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  });

  // Quadrant offsets separated by central cross-roadways (gap 5.8m)
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

      const vidUpper = String(v.vehicleId || v.number || "").trim().toUpperCase();
      const openRepairs = openRepairsByVehicle.get(vidUpper) || [];
      const primaryRepairMeta = openRepairs.length > 0 ? resolveOpenRepairMeta(openRepairs[0]) : null;
      const isRegistryMaintenance = v.operationalStatus === "Maintenance";
      if (openRepairs.length > 0 || isRegistryMaintenance) {
        repairCount += 1;
      }

      const assignedToday =
        vehicleAssignmentMap.get(v.vehicleId) || vehicleAssignmentMap.get(v.id);
      const isInUseToday =
        Boolean(assignedToday) || v.operationalStatus === "In Use";

      const modelType: MhPm3dModelType =
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

  return ZONE_DEFINITIONS.map(buildQuadrant);
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

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [hoveredVehicleId, setHoveredVehicleId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<YardCameraPreset>("overview");
  const [showRepairOnly, setShowRepairOnly] = useState<boolean>(false);
  const [showFloatingBadges, setShowFloatingBadges] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
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
    () => buildZoneLayout(displayVehicles, openRepairsByVehicle, vehicleAssignmentMap),
    [displayVehicles, openRepairsByVehicle, vehicleAssignmentMap]
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
    highlightSelection: (vid: string | null, hoveredId: string | null) => void;
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
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(320, container.clientHeight);
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
    scene.fog = new THREE.FogExp2(bgHex, 0.0085);

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
    controls.dampingFactor = 0.08;
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
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.camera.near = 2;
      sunLight.shadow.camera.far = 110;
      const d = 38;
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

    // Subtle Yard Grid
    const grid = new THREE.GridHelper(160, 40, 0x334155, 0x1e293b);
    grid.position.y = -0.005;
    scene.add(grid);

    // Shared Vehicle Textures
    const texturePack: Pm3dTexturePack = createPm3dTexturePack(
      renderer.capabilities.getMaxAnisotropy()
    );

    const yardRoot = new THREE.Group();
    scene.add(yardRoot);

    // Track disposable resources for rebuilds
    let activeModels: BuiltVehicleModel[] = [];
    let dynamicGeos: THREE.BufferGeometry[] = [];
    let dynamicMats: THREE.Material[] = [];
    let dynamicTexs: THREE.Texture[] = [];
    let hitboxMeshes: THREE.Mesh[] = [];
    const stallBorderMeshes = new Map<string, THREE.Mesh>();

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
      activeModels.forEach((m) => m.dispose());
      activeModels = [];
      dynamicGeos.forEach((g) => g.dispose());
      dynamicGeos = [];
      dynamicMats.forEach((m) => m.dispose());
      dynamicMats = [];
      dynamicTexs.forEach((t) => t.dispose());
      dynamicTexs = [];
      hitboxMeshes = [];
      stallBorderMeshes.clear();
    };

    // Reusable Shared Geometries/Materials per yard rebuild
    const rebuildYard = (layouts: ZoneLayoutRect[]) => {
      cleanupYard();

      const maxAniso = renderer.capabilities.getMaxAnisotropy();
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
      const roadLineMat = trackMat(
        new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
      );

      // Compute full yard perimeter for central aisle road markings
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

      // Central Cross Aisle Dashed Centerlines (X=0 and Z=0)
      const dashGeoX = trackGeo(new THREE.BoxGeometry(1.6, 0.014, 0.14));
      for (let x = Math.floor(yardMinX); x <= Math.ceil(yardMaxX); x += 3.2) {
        const dash = new THREE.Mesh(dashGeoX, roadLineMat);
        dash.position.set(x, 0.008, 0);
        yardRoot.add(dash);
      }
      const dashGeoZ = trackGeo(new THREE.BoxGeometry(0.14, 0.014, 1.6));
      for (let z = Math.floor(yardMinZ); z <= Math.ceil(yardMaxZ); z += 3.2) {
        const dash = new THREE.Mesh(dashGeoZ, roadLineMat);
        dash.position.set(0, 0.008, z);
        yardRoot.add(dash);
      }

      // Build each of the 4 Zones
      layouts.forEach((zl) => {
        const zw = zl.maxX - zl.minX;
        const zd = zl.maxZ - zl.minZ;

        // Zone concrete pad
        const padGeo = trackGeo(new THREE.BoxGeometry(zw, 0.02, zd));
        const padMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: isDarkTheme ? 0x162235 : 0x324155,
            roughness: 0.86,
            metalness: 0.08,
          })
        );
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
        const bannerW = Math.min(zw - 1.2, 8.6);
        const bannerH = 1.9;
        const poleLeft = new THREE.Mesh(
          trackGeo(new THREE.CylinderGeometry(0.08, 0.1, 3.8, 12)),
          postMat
        );
        poleLeft.position.set(zl.centerX - bannerW * 0.42, 1.9, bannerZ);
        const poleRight = new THREE.Mesh(
          trackGeo(new THREE.CylinderGeometry(0.08, 0.1, 3.8, 12)),
          postMat
        );
        poleRight.position.set(zl.centerX + bannerW * 0.42, 1.9, bannerZ);
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
        const bannerSideMat = trackMat(
          new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.6 })
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
        bannerMesh.position.set(zl.centerX, 3.85, bannerZ);
        bannerMesh.castShadow = !isSoftwareGl;
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
          const floorMesh = new THREE.Mesh(
            trackGeo(new THREE.PlaneGeometry(stall.bayW, stall.bayD)),
            floorMat
          );
          floorMesh.rotation.x = -Math.PI / 2;
          floorMesh.position.y = 0.018;
          floorMesh.receiveShadow = true;
          stallGroup.add(floorMesh);

          // Selection / Highlight Rim Plane
          const rimMat = trackMat(
            new THREE.MeshBasicMaterial({
              color: isRepair ? 0xef4444 : 0x38bdf8,
              transparent: true,
              opacity: 0,
              depthWrite: false,
            })
          );
          const rimMesh = new THREE.Mesh(
            trackGeo(new THREE.RingGeometry(
              Math.max(stall.bayW, stall.bayD) * 0.48,
              Math.max(stall.bayW, stall.bayD) * 0.54,
              4
            )),
            rimMat
          );
          rimMesh.rotation.x = -Math.PI / 2;
          rimMesh.rotation.z = Math.PI / 4;
          rimMesh.position.y = 0.025;
          stallGroup.add(rimMesh);
          stallBorderMeshes.set(stall.vehicle.vehicleId.toUpperCase(), rimMesh);

          // 2. Safety Wheel Stop at Back of Stall
          const wheelStop = new THREE.Mesh(
            trackGeo(new THREE.BoxGeometry(stall.bayW * 0.64, 0.14, 0.22)),
            curbMat
          );
          wheelStop.position.set(0, 0.07, -stall.bayD * 0.42);
          wheelStop.castShadow = !isSoftwareGl;
          stallGroup.add(wheelStop);

          // 3. Standing Registration Signboard at Front-Right Corner of Bay
          const signX = stall.bayW * 0.36;
          const signZ = stall.bayD * 0.42;
          const signPost = new THREE.Mesh(
            trackGeo(new THREE.CylinderGeometry(0.032, 0.038, 1.42, 10)),
            postMat
          );
          signPost.position.set(signX, 0.71, signZ);
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
          const signBoard = new THREE.Mesh(
            trackGeo(new THREE.BoxGeometry(0.95, 0.48, 0.05)),
            [
              postMat,
              postMat,
              postMat,
              postMat,
              signFaceMat,
              signFaceMat,
            ]
          );
          signBoard.position.set(signX, 1.54, signZ);
          signBoard.castShadow = !isSoftwareGl;
          stallGroup.add(signBoard);

          // 4. EV Charger Pedestal in Zone 2 (TTEV-)
          if (zl.zone.id === "ev_tractor") {
            const chargerX = -stall.bayW * 0.36;
            const chargerZ = -stall.bayD * 0.42;
            const pedestal = new THREE.Mesh(
              trackGeo(new THREE.BoxGeometry(0.32, 1.35, 0.24)),
              chargerBodyMat
            );
            pedestal.position.set(chargerX, 0.675, chargerZ);
            pedestal.castShadow = !isSoftwareGl;
            const chargerScreen = new THREE.Mesh(
              trackGeo(new THREE.PlaneGeometry(0.22, 0.18)),
              chargerScreenMat
            );
            chargerScreen.position.set(chargerX, 1.05, chargerZ + 0.125);
            stallGroup.add(pedestal, chargerScreen);
          }

          // 5. Realistic 3D Vehicle Model (reused from pm3dVehicleBuilders)
          const built = buildVehicleByModelType(
            stall.modelType,
            texturePack,
            isSoftwareGl,
            shortCode
          );
          // Slight scale-down on trailers so they sit comfortably inside the bay
          if (stall.modelType === "trailer") {
            built.root.scale.set(0.88, 0.88, 0.88);
          } else {
            built.root.scale.set(0.92, 0.92, 0.92);
          }
          built.root.position.set(0, 0, -0.15);
          stallGroup.add(built.root);
          activeModels.push(built);

          // 6. Repair Warning Beacon + Safety Cone when Vehicle has Open Repairs
          if (isRepair) {
            // Glowing red/amber warning beacon on signboard post
            const beacon = new THREE.Mesh(
              trackGeo(new THREE.SphereGeometry(0.14, 14, 12)),
              repairBeaconMat
            );
            beacon.position.set(signX, 1.94, signZ);
            stallGroup.add(beacon);

            // Overhead attention ring hovering cleanly above vehicle roof
            const alertHalo = new THREE.Mesh(
              trackGeo(new THREE.TorusGeometry(0.55, 0.045, 10, 28)),
              repairBeaconMat
            );
            alertHalo.rotation.x = Math.PI / 2;
            alertHalo.position.set(0, 2.72, 0);
            stallGroup.add(alertHalo);

            // Safety Traffic Cone at Front-Left Corner of Stall
            const coneBase = new THREE.Mesh(
              trackGeo(new THREE.BoxGeometry(0.38, 0.04, 0.38)),
              coneOrangeMat
            );
            coneBase.position.set(-stall.bayW * 0.35, 0.02, stall.bayD * 0.4);
            const coneBody = new THREE.Mesh(
              trackGeo(new THREE.ConeGeometry(0.14, 0.52, 14)),
              coneOrangeMat
            );
            coneBody.position.set(-stall.bayW * 0.35, 0.28, stall.bayD * 0.4);
            const coneStripe = new THREE.Mesh(
              trackGeo(new THREE.CylinderGeometry(0.08, 0.11, 0.12, 14)),
              coneWhiteMat
            );
            coneStripe.position.set(-stall.bayW * 0.35, 0.30, stall.bayD * 0.4);
            stallGroup.add(coneBase, coneBody, coneStripe);
          }

          // 7. Invisible Layer-1 Raycast Hitbox for instant pointer pick
          const hitMesh = new THREE.Mesh(
            trackGeo(new THREE.BoxGeometry(stall.bayW, 2.8, stall.bayD)),
            trackMat(new THREE.MeshBasicMaterial({ visible: false }))
          );
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
        mat.opacity = isSel ? 0.72 : isHov ? 0.45 : 0;
        mat.needsUpdate = true;
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
        const el = repairPinRefs.current.get(stall.vehicle.vehicleId.toUpperCase());
        if (!el) return;
        if (!showPins) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          return;
        }
        _projVec.set(stall.x, 3.05, stall.z);
        _projVec.project(camera);
        if (_projVec.z < -1 || _projVec.z > 1) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          return;
        }
        const px = (_projVec.x * 0.5 + 0.5) * w;
        const py = (-_projVec.y * 0.5 + 0.5) * h;
        if (px < -60 || px > w + 60 || py < -40 || py > h + 40) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          return;
        }
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
        el.style.opacity = "1";
        el.style.pointerEvents = "auto";
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
        highlightSelection(selectedVehicleIdRef.current, null);
        requestRender();
      },
      setCameraGoal: (pos, target) => {
        _camGoalPos.set(...pos);
        _camGoalTarget.set(...target);
        hasCamGoal = true;
        requestRender();
      },
      highlightSelection: (vid, hovId) => {
        highlightSelection(vid, hovId);
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

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 45) return;
      lastHoverTime = now;
      const hitId = getHitVehicleId(e.clientX, e.clientY);
      renderer.domElement.style.cursor = hitId ? "pointer" : "grab";
      setHoveredVehicleId((prev) => (prev === hitId ? prev : hitId));
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
      const h = Math.max(300, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
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

  // Update highlight ring on selection/hover changes
  useEffect(() => {
    sceneBridgeRef.current?.highlightSelection(selectedVehicleId, hoveredVehicleId);
  }, [selectedVehicleId, hoveredVehicleId]);

  const hoveredStall = useMemo(
    () =>
      hoveredVehicleId
        ? allStalls.find(
            (s) => s.vehicle.vehicleId.toUpperCase() === hoveredVehicleId.toUpperCase()
          ) || null
        : null,
    [allStalls, hoveredVehicleId]
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Compact Top Zone Legend & Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {zoneLayouts.map((zl) => {
          const isActive = activePreset === zl.zone.id;
          return (
            <button
              key={zl.zone.id}
              type="button"
              onClick={() => focusPreset(zl.zone.id)}
              className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-sky-900/60 dark:border-sky-500"
                  : "bg-white text-slate-800 border-slate-200 hover:border-slate-300 dark:bg-[#0d1b33] dark:text-slate-100 dark:border-[#1e3a5f] dark:hover:border-sky-600"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: zl.zone.accentCss }}
                  />
                  <span className="text-xs font-bold truncate">{zl.zone.shortTitle}</span>
                </div>
                <span className="font-mono tabular-nums text-xs font-bold shrink-0">
                  {zl.count} คัน
                </span>
              </div>
              <div
                className={`mt-1 text-[11px] flex items-center justify-between gap-2 ${
                  isActive ? "text-slate-300" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <span className="truncate">{zl.zone.subtitle}</span>
                {zl.repairCount > 0 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-rose-500 dark:text-rose-400 whitespace-nowrap shrink-0">
                    <Wrench size={11} />
                    แจ้งซ่อม {zl.repairCount}
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap shrink-0">
                    ปกติ
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Main 3D Viewport Container */}
      <div className="relative w-full h-[640px] min-h-[540px] rounded-xl overflow-hidden border border-slate-200 dark:border-[#1e3a5f] bg-[#1e293b] dark:bg-[#0b1526]">
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
        <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-wrap items-center gap-2 max-w-[calc(100%-24px)]">
          <div
            className="pointer-events-auto px-3 py-1.5 rounded-lg border border-white/15 text-white flex items-center gap-2.5 text-xs"
            style={{ backgroundColor: "rgba(15, 23, 42, 0.86)" }}
          >
            <Truck size={14} className="text-sky-400 shrink-0" />
            <span className="font-bold whitespace-nowrap">ลานจอดรถ 3D (4 โซน)</span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span className="font-mono tabular-nums text-slate-200 whitespace-nowrap">
              {yardSummary.total} คัน
            </span>
            {yardSummary.repairing > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-rose-300 whitespace-nowrap">
                  <Wrench size={12} />
                  กำลังแจ้งซ่อม {yardSummary.repairing} คัน ({yardSummary.openWorkOrders} ใบงาน)
                </span>
              </>
            )}
          </div>

          {hoveredStall && (
            <div
              className="px-2.5 py-1.5 rounded-lg border border-sky-400/40 text-white text-[11px] flex items-center gap-2"
              style={{ backgroundColor: "rgba(15, 23, 42, 0.90)" }}
            >
              <span className="font-mono font-bold text-sky-300">{hoveredStall.vehicle.vehicleId}</span>
              <span>·</span>
              <span>{getVehicleTypeDisplayLabel(hoveredStall.vehicle.vehicleType, hoveredStall.vehicle)}</span>
              {hoveredStall.primaryRepairMeta && (
                <span className="text-rose-300 font-semibold">
                  · ⚠ {hoveredStall.primaryRepairMeta.shortLabel}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Top-Right Compact Quick-Select Active Repair Strip (if any open repairs exist and no drawer open) */}
        {repairStalls.length > 0 && !selectedStall && (
          <div
            className="absolute top-3 right-3 z-10 max-w-[300px] rounded-lg border border-rose-500/40 p-2.5 text-white"
            style={{ backgroundColor: "rgba(28, 13, 18, 0.90)" }}
          >
            <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-rose-200 mb-1.5">
              <span className="inline-flex items-center gap-1.5">
                <Wrench size={12} className="text-rose-400" />
                รถที่ยังแจ้งซ่อมค้าง ({repairStalls.length} คัน)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto">
              {repairStalls.map((st) => (
                <button
                  key={st.vehicle.vehicleId}
                  type="button"
                  onClick={() => focusVehicleIn3D(st)}
                  className="px-2 py-1 rounded text-[11px] font-mono font-bold bg-rose-600/80 hover:bg-rose-500 text-white border border-rose-400/50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {st.vehicle.vehicleId}
                  {st.primaryRepairMeta ? ` · ${st.primaryRepairMeta.shortLabel}` : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Projected Interactive Floating Repair Alert Badges over 3D Vehicles */}
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
                className={`absolute top-0 left-0 px-2 py-1 rounded-md border text-[10px] font-bold text-white shadow-md transition-opacity flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  isSelected
                    ? "border-white ring-2 ring-amber-300"
                    : "border-rose-300/80 hover:border-white"
                }`}
                style={{
                  opacity: 0,
                  backgroundColor:
                    meta?.severity === "parts"
                      ? "rgba(217, 119, 6, 0.94)"
                      : meta?.severity === "repair"
                      ? "rgba(220, 38, 38, 0.95)"
                      : "rgba(234, 88, 12, 0.94)",
                }}
                title={`คลิกเพื่อดูอาการเสียของ ${stall.vehicle.vehicleId}`}
              >
                <Wrench size={10} className="shrink-0" />
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
                {onEditVehicle && (
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

        {/* Unified Collapsible Bottom Control Dock */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[96%]">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="px-3 py-1 rounded-t-lg border border-b-0 border-white/15 text-[11px] font-semibold text-slate-200 flex items-center gap-1 cursor-pointer"
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

      {/* Bottom Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] text-[11px] text-slate-600 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            ช่องจอดปกติ / พร้อมใช้งาน
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
            กำลังใช้งานวันนี้
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
            มีรายการแจ้งซ่อมค้าง (คลิกที่รถหรือป้ายซ่อมเพื่อดูอาการเสีย)
          </span>
          <span className="inline-flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
            <Zap size={12} />
            โซนหัวลากไฟฟ้า EV (TTEV-) พร้อมเสาชาร์จประจำช่อง
          </span>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          ลากเพื่อหมุน 360° · เลื่อนลูกกลิ้งเพื่อซูม · คลิกขวาเพื่อแพน · คลิกที่ตัวรถเพื่อดูสถานะซ่อม
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
