import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BASKET_HEIGHT_Y,
  BASKET_INNER_WIDTH_X,
  BASKET_OUTER_DEPTH_Z,
  BASKET_OUTER_WIDTH_X,
  BASKET_STACK_STEP_Y,
  BasketLayerState,
  BasketLayerStatus,
  BasketSlot3D,
  BlueBasketBuildingId,
  BuildingBasketLayout3D,
  E10_CRADLE_HEIGHT_Y,
  E10_CRADLE_LEG_SPAN_X,
  E10_CRADLE_TOTAL_LENGTH_X,
  E10_CRADLE_WIDTH_Z,
  isCradleRackBuilding,
} from "./blueBasketLayout";

export type BasketCameraPreset = "isometric" | "top" | "front" | "side" | "reset";

export interface BasketSceneFilterState {
  row: string; // "ALL" or rowId
  layer: "ALL" | "1" | "2";
  status: "ALL" | "EMPTY" | "OCCUPIED" | "NEAR_FULL_OR_FULL";
  selectedBasketCode: string | null;
  selectedLayer: 1 | 2 | null;
  focusedBasketCode: string | null;
  previewLayer2BasketCode: string | null;
}

export interface BasketHoverPayload {
  slot: BasketSlot3D;
  layer: 1 | 2;
  clientX: number;
  clientY: number;
}

export interface BasketSceneCallbacks {
  onSelectBasket: (slot: BasketSlot3D | null, layer?: 1 | 2) => void;
  onHoverBasket?: (payload: BasketHoverPayload | null) => void;
  onWebGLContextError?: (message: string) => void;
}

const STATUS_COLORS: Record<BasketLayerStatus, number> = {
  EMPTY: 0x22c55e,
  PARTIAL: 0x38bdf8,
  NEAR_FULL: 0xf59e0b,
  FULL: 0xf43f5e,
  OVERFLOW: 0xdc2626,
};

const STEEL_COIL_SHADES = [0xdce3ec, 0xcbd5e1, 0xe2e8f0, 0xc2ccd8, 0xd4dde8];

function detectSoftwareWebGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (!dbg) return false;
    const name = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
    return /swiftshader|llvmpipe|software|mesa|basic render/i.test(name);
  } catch {
    return false;
  }
}

function createPerforatedBarTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#1d63b8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle top highlight & bottom shade
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, canvas.width, 6);
  ctx.fillStyle = "rgba(15,23,42,0.28)";
  ctx.fillRect(0, canvas.height - 6, canvas.width, 6);

  // 13 evenly spaced circular holes matching the 4-view blueprint
  const holeCount = 13;
  const margin = 40;
  const step = (canvas.width - margin * 2) / (holeCount - 1);
  for (let i = 0; i < holeCount; i++) {
    const cx = margin + i * step;
    const cy = canvas.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1a30";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#60a5fa";
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createCoilWrapTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#d5dde7";
  ctx.fillRect(0, 0, 256, 256);

  // Concentric wound steel strip rings
  for (let r = 42; r < 126; r += 3) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.strokeStyle = r % 6 === 0 ? "rgba(30,41,59,0.26)" : "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBuildingSignTexture(
  buildingId: string,
  customTitle?: string,
  customSubtitle?: string
): THREE.CanvasTexture {
  const isE10 = buildingId === "E10";
  const isH4 = buildingId === "H4";
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = isE10 ? "#f59e0b" : isH4 ? "#06b6d4" : "#38bdf8";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  // Building / Gate badge
  ctx.fillStyle = isE10 ? "#d97706" : isH4 ? "#0891b2" : "#1d63b8";
  ctx.fillRect(20, 20, 152, 120);
  ctx.strokeStyle = isE10 ? "#fde68a" : isH4 ? "#a5f3fc" : "#93c5fd";
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 152, 120);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 66px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(buildingId, 96, 84);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 34px Inter, system-ui, sans-serif";
  ctx.fillText(
    customTitle ||
      (isE10
        ? "BUILDING E10 · STEEL CRADLE RACK"
        : `BUILDING ${buildingId} · BLUE BASKET ZONE`),
    196,
    62
  );

  ctx.fillStyle = isE10 ? "#fcd34d" : isH4 ? "#67e8f9" : "#7dd3fc";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(
    customSubtitle ||
      (isE10
        ? "ROW A (2.0m A-FRAME RACK) · CENTRAL ROAD · SLITTING MACHINE"
        : "MAX WIDTH 2,000 mm / BASKET · MAX STACK 2 LAYERS"),
    196,
    110
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createRowBadgeTexture(rowId: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 120);

  ctx.fillStyle = "#fbbf24";
  ctx.font = "900 62px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`ROW ${rowId}`, 128, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createSlotFloorLabelTexture(
  basketCode: string,
  statusHex: string,
  widthSummary: string
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.fillRect(0, 0, 256, 96);

  ctx.fillStyle = statusHex;
  ctx.fillRect(0, 0, 14, 96);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "900 38px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(basketCode, 26, 36);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(widthSummary, 26, 72);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createFloorConcreteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#3f4b5e";
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  for (let i = 0; i < 650; i++) {
    const x = (i * 3571) % 512;
    const y = (i * 2143) % 512;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(x, y, 4, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createExteriorRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 384;
  const ctx = canvas.getContext("2d")!;

  // Dark outdoor weathered asphalt
  ctx.fillStyle = "#1f2530";
  ctx.fillRect(0, 0, 1024, 384);

  // Subtle asphalt aggregate texture
  for (let i = 0; i < 1800; i++) {
    const x = (i * 4999) % 1024;
    const y = (i * 3187) % 384;
    ctx.fillStyle =
      i % 3 === 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.09)";
    ctx.fillRect(x, y, 3, 3);
  }

  // Solid white road edge shoulder lines (left & right shoulders)
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 20, 1024, 10);
  ctx.fillRect(0, 354, 1024, 10);

  // Dashed yellow two-way center divider
  ctx.fillStyle = "#facc15";
  for (let x = 24; x < 1024; x += 128) {
    ctx.fillRect(x, 186, 68, 12);
  }

  // Subtle white directional arrows
  const drawArrow = (cx: number, cy: number, dir: 1 | -1) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    ctx.fillStyle = "rgba(241, 245, 249, 0.55)";
    ctx.fillRect(-38, -7, 46, 14);
    ctx.beginPath();
    ctx.moveTo(8, -19);
    ctx.lineTo(42, 0);
    ctx.lineTo(8, 19);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  drawArrow(260, 104, -1);
  drawArrow(760, 104, -1);
  drawArrow(260, 280, 1);
  drawArrow(760, 280, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createRoadLabelTexture(
  buildingId: BlueBasketBuildingId,
  customText?: string
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 112;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(248, 250, 252, 0.84)";
  ctx.font = "900 34px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    customText || `EXTERIOR ROAD · อาคาร ${buildingId} (แนวแถว A–D)`,
    384,
    58
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createFrontFacadeSignTexture(
  gateId: string,
  subtitle = "OUTDOOR ROAD ACCESS",
  isGateStyle = false
): THREE.CanvasTexture {
  const isH4 = gateId === "H4";
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = isH4 ? "#06b6d4" : "#f59e0b";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  ctx.fillStyle = isH4 ? "#06b6d4" : "#f59e0b";
  ctx.fillRect(14, 14, 96, 84);
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 46px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(gateId, 62, 58);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 26px Inter, system-ui, sans-serif";
  ctx.fillText(
    isGateStyle ? `ประตู ${gateId} (GATE ${gateId})` : `BUILDING ${gateId} · ROW A–D`,
    128,
    44
  );
  ctx.fillStyle = isH4 ? "#67e8f9" : "#94a3b8";
  ctx.font = "700 19px Inter, system-ui, sans-serif";
  ctx.fillText(subtitle, 128, 80);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createHollowCoilUnitGeometry(): THREE.BufferGeometry {
  const outerR = 0.66;
  const innerR = 0.25;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 28,
  });
  // Center depth along Z (-0.5..0.5), then rotate Y +90deg so thickness runs along X
  geo.translate(0, 0, -0.5);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createTimberWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#7a5b3e";
  ctx.fillRect(0, 0, 256, 128);

  // Horizontal weathered hardwood grain streaks
  for (let y = 0; y < 128; y += 3) {
    const tone = (y * 37) % 3;
    ctx.fillStyle =
      tone === 0
        ? "rgba(42, 26, 14, 0.24)"
        : tone === 1
        ? "rgba(180, 145, 108, 0.16)"
        : "rgba(58, 38, 22, 0.14)";
    ctx.fillRect(0, y, 256, 2);
  }
  for (let i = 0; i < 45; i++) {
    const x = (i * 59) % 256;
    const y = (i * 29) % 128;
    ctx.fillStyle = "rgba(30, 18, 9, 0.22)";
    ctx.fillRect(x, y, 24 + (i % 28), 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createCorrugatedWallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#9aa6b5";
  ctx.fillRect(0, 0, 256, 256);

  // Vertical corrugated metal sheet flutes
  for (let x = 0; x < 256; x += 16) {
    const grad = ctx.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, "#7c8899");
    grad.addColorStop(0.35, "#cbd5e1");
    grad.addColorStop(0.65, "#94a3b8");
    grad.addColorStop(1, "#64748b");
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 16, 256);
  }

  // Subtle horizontal purlin seam lines
  ctx.fillStyle = "rgba(30, 41, 59, 0.22)";
  ctx.fillRect(0, 84, 256, 3);
  ctx.fillRect(0, 172, 256, 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createE10CenterRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;

  // Clean light-gray concrete drive-through floor matching E10 floorplan
  ctx.fillStyle = "#8a94a2";
  ctx.fillRect(0, 0, 512, 1024);

  // Concrete expansion joints & subtle aggregate
  ctx.strokeStyle = "rgba(30, 41, 59, 0.14)";
  ctx.lineWidth = 2;
  for (let y = 0; y <= 1024; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  for (let i = 0; i < 1200; i++) {
    const x = (i * 4219) % 512;
    const y = (i * 6131) % 1024;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(15,23,42,0.06)";
    ctx.fillRect(x, y, 3, 3);
  }

  // Bright yellow safety boundary lines on BOTH edges of the center road
  ctx.fillStyle = "#facc15";
  ctx.fillRect(10, 0, 22, 1024);
  ctx.fillRect(480, 0, 22, 1024);

  // Dashed white center divider line
  ctx.fillStyle = "#f1f5f9";
  for (let y = 24; y < 1024; y += 112) {
    ctx.fillRect(250, y, 12, 58);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createHazardStripeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#facc15";
  ctx.fillRect(0, 0, 256, 64);

  ctx.fillStyle = "#1e293b";
  for (let x = -64; x < 320; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 18, 0);
    ctx.lineTo(x + 42, 64);
    ctx.lineTo(x + 24, 64);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createFloorStencilTexture(
  text: string,
  color: string,
  fontSize = 86
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = `900 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeBeamBetween(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  thicknessX: number,
  thicknessZ: number
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const box = new THREE.BoxGeometry(thicknessX, len, thicknessZ);
  const geo = box.index ? box.toNonIndexed() : box.clone();
  box.dispose();
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize()
  );
  const mat4 = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(mat4);
  return geo;
}

function makeTriangleGusset(
  baseX: number,
  apexX: number,
  height: number,
  zPos: number,
  thickness = 0.03
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(baseX, 0.06);
  shape.lineTo(apexX, 0.06);
  shape.lineTo(baseX, 0.06 + height);
  shape.closePath();

  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  const geo = raw.index ? raw.toNonIndexed() : raw.clone();
  raw.dispose();
  geo.translate(0, 0, zPos - thickness / 2);
  return geo;
}

export class BlueBasketSceneEngine {
  private container: HTMLElement;
  private callbacks: BasketSceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pmremGenerator: THREE.PMREMGenerator;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private isSoftwareGl: boolean;

  private dynamicRoot = new THREE.Group();
  private hitMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  // Shared geometries & materials (disposed on teardown)
  private sharedTextures: THREE.Texture[] = [];
  private dynamicTextures: THREE.Texture[] = [];
  private dynamicGeometries: THREE.BufferGeometry[] = [];
  private dynamicMaterials: THREE.Material[] = [];

  private basketBlueMat: THREE.MeshStandardMaterial;
  private basketBlueEmptyMat: THREE.MeshStandardMaterial;
  private basketBlueDimMat: THREE.MeshStandardMaterial;
  private basketPerforatedMat: THREE.MeshStandardMaterial;
  private basketVPlateMat: THREE.MeshStandardMaterial;
  private ghostLayer2Mat: THREE.MeshBasicMaterial;
  private statusStripMats: Record<BasketLayerStatus, THREE.MeshBasicMaterial>;
  private statusStripSelectedMat: THREE.MeshBasicMaterial;
  private statusStripFocusedMat: THREE.MeshBasicMaterial;
  private coilUnitGeo: THREE.BufferGeometry;
  private coilMaterials: THREE.MeshStandardMaterial[];
  private coilPendingSapMat: THREE.MeshStandardMaterial;
  private floorConcreteTex: THREE.CanvasTexture;
  private exteriorRoadTex: THREE.CanvasTexture;

  // Shared pre-merged blue basket geometries (4 draw calls per basket instead of 44)
  private mergedFrameGeo: THREE.BufferGeometry;
  private mergedPerfGeo: THREE.BufferGeometry;
  private mergedVPlateGeo: THREE.BufferGeometry;
  private mergedStatusStripGeo: THREE.BufferGeometry;

  // Shared Building E10 steel cradle rack materials, textures & pre-merged geometries
  private cradleSteelMat: THREE.MeshStandardMaterial;
  private cradleSteelDimMat: THREE.MeshStandardMaterial;
  private cradleWoodMat: THREE.MeshStandardMaterial;
  private cradleWoodDimMat: THREE.MeshStandardMaterial;
  private corrugatedWallTex: THREE.CanvasTexture;
  private e10CenterRoadTex: THREE.CanvasTexture;
  private hazardStripeTex: THREE.CanvasTexture;
  private mergedCradleSteelGeo: THREE.BufferGeometry;
  private mergedCradleWoodGeo: THREE.BufferGeometry;
  private mergedCradleStatusGeo: THREE.BufferGeometry;

  private currentLayout: BuildingBasketLayout3D | null = null;
  private currentFilter: BasketSceneFilterState = {
    row: "ALL",
    layer: "ALL",
    status: "ALL",
    selectedBasketCode: null,
    selectedLayer: null,
    focusedBasketCode: null,
    previewLayer2BasketCode: null,
  };

  // Smooth camera transition targets
  private isAnimatingCamera = false;
  private targetCamPos = new THREE.Vector3();
  private targetOrbitLook = new THREE.Vector3();
  private rafId: number | null = null;
  private needsRender = true;
  private clock = new THREE.Clock();
  private resizeObserver: ResizeObserver | null = null;
  private pointerDownPos = { x: 0, y: 0 };
  private hoveredKey: string | null = null;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: BasketSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.isSoftwareGl = detectSoftwareWebGL(this.renderer);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.isSoftwareGl ? 1 : 2)
    );
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);
    this.scene.fog = new THREE.Fog(0x0f172a, 115, 290);

    // Metallic steel reflections via RoomEnvironment
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = this.pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    );
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.72;

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 360);
    this.camera.position.set(18, 16, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 125;
    this.controls.addEventListener("change", () => {
      this.requestRender();
    });
    this.controls.addEventListener("start", () => {
      this.isAnimatingCamera = false;
    });

    // Three-point warehouse lighting
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.55);
    keyLight.position.set(22, 34, 24);
    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 5;
      keyLight.shadow.camera.far = 110;
      keyLight.shadow.camera.left = -28;
      keyLight.shadow.camera.right = 28;
      keyLight.shadow.camera.top = 28;
      keyLight.shadow.camera.bottom = -28;
      keyLight.shadow.bias = -0.0005;
    }
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.6);
    rimLight.position.set(-20, 18, -18);
    this.scene.add(rimLight);

    // Shared textures & materials
    const perfTex = createPerforatedBarTexture();
    const wrapTex = createCoilWrapTexture();
    this.floorConcreteTex = createFloorConcreteTexture();
    this.exteriorRoadTex = createExteriorRoadTexture();
    this.sharedTextures.push(
      perfTex,
      wrapTex,
      this.floorConcreteTex,
      this.exteriorRoadTex
    );

    this.basketBlueMat = new THREE.MeshStandardMaterial({
      color: 0x1d63b8,
      roughness: 0.42,
      metalness: 0.36,
    });
    this.basketBlueEmptyMat = new THREE.MeshStandardMaterial({
      color: 0x1e5ca8,
      roughness: 0.48,
      metalness: 0.32,
    });
    this.basketBlueDimMat = new THREE.MeshStandardMaterial({
      color: 0x264366,
      roughness: 0.65,
      metalness: 0.2,
      transparent: true,
      opacity: 0.34,
    });
    this.basketPerforatedMat = new THREE.MeshStandardMaterial({
      map: perfTex,
      roughness: 0.42,
      metalness: 0.38,
    });
    this.basketVPlateMat = new THREE.MeshStandardMaterial({
      color: 0x273449,
      roughness: 0.52,
      metalness: 0.68,
    });
    this.ghostLayer2Mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    this.statusStripMats = {
      EMPTY: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.EMPTY }),
      PARTIAL: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.PARTIAL }),
      NEAR_FULL: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.NEAR_FULL }),
      FULL: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.FULL }),
      OVERFLOW: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.OVERFLOW }),
    };
    this.statusStripSelectedMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    this.statusStripFocusedMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });

    this.coilUnitGeo = createHollowCoilUnitGeometry();
    this.coilMaterials = STEEL_COIL_SHADES.map(
      (hex) =>
        new THREE.MeshStandardMaterial({
          color: hex,
          map: wrapTex,
          roughness: 0.27,
          metalness: 0.86,
        })
    );
    this.coilPendingSapMat = new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      map: wrapTex,
      roughness: 0.3,
      metalness: 0.72,
    });

    // Build pre-merged procedural square blue basket geometries (2.28m x 2.28m matching reference images)
    const stampPart = (
      src: THREE.BufferGeometry,
      x: number,
      y: number,
      z: number,
      rx = 0
    ): THREE.BufferGeometry => {
      const g = src.index ? src.toNonIndexed() : src.clone();
      if (rx !== 0) g.rotateX(rx);
      g.translate(x, y, z);
      return g;
    };

    const postGeo = new THREE.BoxGeometry(0.11, 1.56, 0.11);
    const pinGeo = new THREE.CylinderGeometry(0.024, 0.05, 0.18, 12);
    const collarGeo = new THREE.CylinderGeometry(0.066, 0.066, 0.065, 12);
    const lugGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.17, 10);
    lugGeo.rotateZ(Math.PI / 2);
    const baseRailXGeo = new THREE.BoxGeometry(BASKET_OUTER_WIDTH_X, 0.095, 0.095);
    const baseRailZGeo = new THREE.BoxGeometry(0.095, 0.095, BASKET_OUTER_DEPTH_Z);
    const subRibZGeo = new THREE.BoxGeometry(0.075, 0.08, BASKET_OUTER_DEPTH_Z - 0.18);
    const perfBarXGeo = new THREE.BoxGeometry(BASKET_OUTER_WIDTH_X - 0.14, 0.095, 0.06);
    const sideBarZGeo = new THREE.BoxGeometry(0.07, 0.07, BASKET_OUTER_DEPTH_Z - 0.14);
    const diagStrutGeo = new THREE.BoxGeometry(0.07, 1.16, 0.07);
    const vPlateGeo = new THREE.BoxGeometry(BASKET_INNER_WIDTH_X + 0.02, 0.045, 0.72);
    const footPadGeo = new THREE.BoxGeometry(0.15, 0.06, 0.15);
    const statusStripGeo = new THREE.BoxGeometry(BASKET_OUTER_WIDTH_X - 0.22, 0.05, 0.045);

    const halfX = BASKET_OUTER_WIDTH_X / 2 - 0.055;
    const halfZ = BASKET_OUTER_DEPTH_Z / 2 - 0.055;
    const frameParts: THREE.BufferGeometry[] = [];

    // 1. 4 Corner vertical square posts + conical stacking pins + lifting lugs
    const corners: [number, number][] = [
      [-halfX, -halfZ],
      [halfX, -halfZ],
      [-halfX, halfZ],
      [halfX, halfZ],
    ];
    for (const [cx, cz] of corners) {
      frameParts.push(stampPart(footPadGeo, cx, 0.03, cz));
      frameParts.push(stampPart(postGeo, cx, 0.84, cz));
      frameParts.push(stampPart(collarGeo, cx, 1.64, cz));
      frameParts.push(stampPart(pinGeo, cx, 1.75, cz));
      frameParts.push(stampPart(lugGeo, cx, 1.56, cz));
    }

    // 2. Bottom forklift perimeter frame (lower + upper base rails)
    for (const yLevel of [0.09, 0.28]) {
      frameParts.push(stampPart(baseRailXGeo, 0, yLevel, halfZ));
      frameParts.push(stampPart(baseRailXGeo, 0, yLevel, -halfZ));
      frameParts.push(stampPart(baseRailZGeo, -halfX, yLevel, 0));
      frameParts.push(stampPart(baseRailZGeo, halfX, yLevel, 0));
    }

    // 4 Base cross-ribs under the coil cradle
    for (const rx of [-0.72, -0.24, 0.24, 0.72]) {
      frameParts.push(stampPart(subRibZGeo, rx, 0.11, 0));
    }

    // Mid-height end rails (left & right) + diagonal V-bracing struts
    for (const sx of [-halfX, halfX]) {
      frameParts.push(stampPart(sideBarZGeo, sx, 0.62, 0));
      frameParts.push(stampPart(diagStrutGeo, sx, 0.82, 0.58, 0.5));
      frameParts.push(stampPart(diagStrutGeo, sx, 0.82, -0.58, -0.5));
    }

    // 3. Perforated horizontal side cross-bars
    const perfParts: THREE.BufferGeometry[] = [
      stampPart(perfBarXGeo, 0, 1.26, halfZ),
      stampPart(perfBarXGeo, 0, 1.26, -halfZ),
    ];

    // 4. Dark steel V-cradle inclined plates
    const vPlateParts: THREE.BufferGeometry[] = [
      stampPart(vPlateGeo, 0, 0.42, 0.48, -0.52),
      stampPart(vPlateGeo, 0, 0.42, -0.48, 0.52),
    ];

    // 5. Capacity LED status strips on both perforated sides
    const statusStripParts: THREE.BufferGeometry[] = [
      stampPart(statusStripGeo, 0, 0.28, halfZ + 0.055),
      stampPart(statusStripGeo, 0, 0.28, -halfZ - 0.055),
    ];

    this.mergedFrameGeo = mergeGeometries(frameParts, false)!;
    this.mergedPerfGeo = mergeGeometries(perfParts, false)!;
    this.mergedVPlateGeo = mergeGeometries(vPlateParts, false)!;
    this.mergedStatusStripGeo = mergeGeometries(statusStripParts, false)!;

    // Dispose temporary source & stamped geometries
    for (const g of [
      ...frameParts,
      ...perfParts,
      ...vPlateParts,
      ...statusStripParts,
      postGeo,
      pinGeo,
      collarGeo,
      lugGeo,
      baseRailXGeo,
      baseRailZGeo,
      subRibZGeo,
      perfBarXGeo,
      sideBarZGeo,
      diagStrutGeo,
      vPlateGeo,
      footPadGeo,
      statusStripGeo,
    ]) {
      g.dispose();
    }

    // Building E10 Triangular A-Frame 2m Steel Cradle Rack Materials & Pre-Merged Geometries
    const woodTex = createTimberWoodTexture();
    this.corrugatedWallTex = createCorrugatedWallTexture();
    this.e10CenterRoadTex = createE10CenterRoadTexture();
    this.hazardStripeTex = createHazardStripeTexture();
    this.sharedTextures.push(
      woodTex,
      this.corrugatedWallTex,
      this.e10CenterRoadTex,
      this.hazardStripeTex
    );

    this.cradleSteelMat = new THREE.MeshStandardMaterial({
      color: 0x3b424c,
      roughness: 0.46,
      metalness: 0.72,
    });
    this.cradleSteelDimMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.7,
      metalness: 0.25,
      transparent: true,
      opacity: 0.34,
    });
    this.cradleWoodMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0xb9936c,
      roughness: 0.84,
      metalness: 0.04,
    });
    this.cradleWoodDimMat = new THREE.MeshStandardMaterial({
      color: 0x6b5642,
      roughness: 0.88,
      metalness: 0.04,
      transparent: true,
      opacity: 0.34,
    });

    // Build pre-merged triangular A-frame steel cradle rack (2.00m timber sleeper legs + inclined A-frame headboard)
    const cradleSteelParts: THREE.BufferGeometry[] = [];
    const cradleWoodParts: THREE.BufferGeometry[] = [];
    const railHalfZ = 0.43;

    for (const sz of [-railHalfZ, railHalfZ]) {
      // Lower parallel steel channel base rail running full length (-1.44 to +1.42)
      cradleSteelParts.push(
        makeBeamBetween(
          new THREE.Vector3(-1.44, 0.045, sz),
          new THREE.Vector3(1.42, 0.045, sz),
          0.085,
          0.095
        )
      );
      // 2.00m hardwood timber sleeper resting atop steel leg (-0.56 to +1.38)
      cradleWoodParts.push(
        makeBeamBetween(
          new THREE.Vector3(-0.56, 0.135, sz),
          new THREE.Vector3(1.38, 0.135, sz),
          0.095,
          0.105
        )
      );
      // Front inclined A-frame steel channel upright extending past apex (twin channel ears)
      cradleSteelParts.push(
        makeBeamBetween(
          new THREE.Vector3(-0.58, 0.06, sz),
          new THREE.Vector3(-1.26, E10_CRADLE_HEIGHT_Y, sz),
          0.09,
          0.095
        )
      );
      // Inclined wooden rubbing liner bolted to front face of A-frame upright
      cradleWoodParts.push(
        makeBeamBetween(
          new THREE.Vector3(-0.51, 0.14, sz),
          new THREE.Vector3(-1.11, 1.74, sz),
          0.07,
          0.092
        )
      );
      // Rear angled steel support leg completing the triangle
      cradleSteelParts.push(
        makeBeamBetween(
          new THREE.Vector3(-1.42, 0.06, sz),
          new THREE.Vector3(-1.17, 1.76, sz),
          0.085,
          0.09
        )
      );
      // Welded triangular corner gusset plates at front & rear of A-frame base
      cradleSteelParts.push(makeTriangleGusset(-0.58, -0.84, 0.34, sz, 0.04));
      cradleSteelParts.push(makeTriangleGusset(-1.42, -1.16, 0.34, sz, 0.04));
    }

    // Cross steel tie-plate at front tip of 2m legs
    const frontTiePlate = new THREE.BoxGeometry(0.22, 0.028, railHalfZ * 2 + 0.11);
    cradleSteelParts.push(stampPart(frontTiePlate, 1.36, 0.016, 0));
    frontTiePlate.dispose();

    // Base cross-beams under A-frame (front & rear) + upper horizontal A-frame cross-brace
    const baseCrossGeo = new THREE.BoxGeometry(0.085, 0.085, railHalfZ * 2 + 0.09);
    cradleSteelParts.push(stampPart(baseCrossGeo, -0.58, 0.045, 0));
    cradleSteelParts.push(stampPart(baseCrossGeo, -1.42, 0.045, 0));
    baseCrossGeo.dispose();

    const upperCrossGeo = new THREE.BoxGeometry(0.075, 0.075, railHalfZ * 2);
    cradleSteelParts.push(stampPart(upperCrossGeo, -1.14, 1.56, 0));
    upperCrossGeo.dispose();

    const cradleStripRaw = new THREE.BoxGeometry(0.06, 0.042, railHalfZ * 2 + 0.02);
    const cradleStripStamped = stampPart(cradleStripRaw, 1.47, 0.04, 0);
    cradleStripRaw.dispose();

    this.mergedCradleSteelGeo = mergeGeometries(cradleSteelParts, false)!;
    this.mergedCradleWoodGeo = mergeGeometries(cradleWoodParts, false)!;
    this.mergedCradleStatusGeo = cradleStripStamped;

    for (const g of [...cradleSteelParts, ...cradleWoodParts]) {
      g.dispose();
    }

    this.scene.add(this.dynamicRoot);

    this.bindEvents();
    this.startLoop();
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;

    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointerup", this.onPointerUp);
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerleave", this.onPointerLeave);
    dom.addEventListener("webglcontextlost", this.onContextLost);

    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
    this.resizeObserver.observe(this.container);
  }

  private onContextLost = (ev: Event) => {
    ev.preventDefault();
    this.callbacks.onWebGLContextError?.(
      "WebGL context lost — กรุณารีเฟรชหน้าจอเพื่อแสดงผล 3D อีกครั้ง"
    );
  };

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 240);
    const height = Math.max(this.container.clientHeight, 240);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.requestRender();
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.pointerDownPos = { x: ev.clientX, y: ev.clientY };
  };

  private onPointerUp = (ev: PointerEvent) => {
    const dx = ev.clientX - this.pointerDownPos.x;
    const dy = ev.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 6) return; // Dragged orbit, not click

    const hit = this.raycastBasket(ev.clientX, ev.clientY);
    if (hit) {
      this.callbacks.onSelectBasket(hit.slot, hit.layer);
    }
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (!this.callbacks.onHoverBasket) return;
    const hit = this.raycastBasket(ev.clientX, ev.clientY);
    const dom = this.renderer.domElement;
    if (hit) {
      dom.style.cursor = "pointer";
      const nextKey = `${hit.slot.basketCode}#L${hit.layer}`;
      this.hoveredKey = nextKey;
      this.callbacks.onHoverBasket({
        slot: hit.slot,
        layer: hit.layer,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
    } else {
      dom.style.cursor = "grab";
      if (this.hoveredKey !== null) {
        this.hoveredKey = null;
        this.callbacks.onHoverBasket(null);
      }
    }
  };

  private onPointerLeave = () => {
    if (this.hoveredKey !== null) {
      this.hoveredKey = null;
      this.callbacks.onHoverBasket?.(null);
    }
  };

  private raycastBasket(
    clientX: number,
    clientY: number
  ): { slot: BasketSlot3D; layer: 1 | 2 } | null {
    if (this.hitMeshes.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitMeshes, false);
    if (hits.length === 0) return null;
    const userData = hits[0].object.userData as {
      slot?: BasketSlot3D;
      layer?: 1 | 2;
    };
    if (!userData.slot) return null;
    return { slot: userData.slot, layer: userData.layer || 1 };
  }

  public setLayoutAndFilters(
    layout: BuildingBasketLayout3D,
    filters: BasketSceneFilterState,
    resetCamera = false
  ): void {
    this.currentLayout = layout;
    this.currentFilter = filters;
    this.rebuildScene();
    if (resetCamera) {
      this.setCameraPreset("isometric", true);
    }
    this.requestRender();
  }

  public setCameraPreset(preset: BasketCameraPreset, instant = false): void {
    const slabW = this.currentLayout?.slabWidth || 34;
    const slabD = this.currentLayout?.slabDepth || 22;
    const span = Math.max(slabW + 6, slabD + 6);
    const isE10 = this.currentLayout
      ? isCradleRackBuilding(this.currentLayout.buildingId)
      : false;
    const isDualRoad = Boolean(this.currentLayout?.dualRoadLayout);

    const look = isE10
      ? new THREE.Vector3(0.1, 1.1, 0.2)
      : isDualRoad
      ? new THREE.Vector3(0, 1.1, 0)
      : new THREE.Vector3(-2.0, 1.1, 0);
    const pos = new THREE.Vector3();

    if (isE10) {
      switch (preset) {
        case "top":
          pos.set(0.1, Math.max(slabW, slabD) * 1.16, 0.01);
          break;
        case "front":
          pos.set(0.0, 8.8, slabD * 0.88 + 10.5);
          break;
        case "side":
          pos.set(10.5, 6.8, 0.2);
          look.set(-6.5, 1.1, 0.2);
          break;
        case "isometric":
        case "reset":
        default:
          // Cutaway front-left diorama angle framing ROW A left, yellow-lined center road, and green Slitting Machine right
          pos.set(-slabW * 0.72, Math.max(15.5, span * 0.5), slabD * 0.78);
          break;
      }
    } else if (isDualRoad) {
      // Dual-side Building H2: Gate H4 (-X) and Gate H2 (+X) facing each other across central road at X = 0
      switch (preset) {
        case "top":
          pos.set(0, Math.max(slabW * 0.92, slabD * 1.45), 0.01);
          break;
        case "front":
          pos.set(0, 12.0, slabD * 0.85 + 32);
          break;
        case "side":
          pos.set(0, 12.0, -(slabD * 0.85 + 30));
          break;
        case "isometric":
        case "reset":
        default:
          pos.set(0, Math.max(30, slabW * 0.42), Math.max(46, slabW * 0.68));
          break;
      }
    } else {
      switch (preset) {
        case "top":
          pos.set(-2.0, span * 1.08, 0.01);
          break;
        case "front":
          pos.set(-2.0, 7.2, slabD * 0.88 + 13);
          break;
        case "side":
          pos.set(-slabW * 0.72 - 14, 9.5, 0);
          break;
        case "isometric":
        case "reset":
        default:
          pos.set(-slabW * 0.44 - 6, Math.max(14.5, span * 0.42), slabD * 0.85 + 11);
          break;
      }
    }

    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(look);
      this.controls.update();
      this.isAnimatingCamera = false;
    } else {
      this.targetCamPos.copy(pos);
      this.targetOrbitLook.copy(look);
      this.isAnimatingCamera = true;
    }
    this.requestRender();
  }

  public focusBasket(basketCode: string, layer: 1 | 2 = 1): void {
    const slot = this.currentLayout?.slotByCode.get(basketCode.toUpperCase());
    if (!slot) return;
    if (isCradleRackBuilding(slot.buildingId)) {
      this.targetOrbitLook.set(slot.worldX, 0.9, slot.worldZ);
      this.targetCamPos.set(
        slot.worldX + 6.2,
        3.4,
        slot.worldZ + 3.8
      );
      this.isAnimatingCamera = true;
      this.requestRender();
      return;
    }
    const targetY = layer === 2 ? BASKET_STACK_STEP_Y + 0.75 : 0.75;
    this.targetOrbitLook.set(slot.worldX, targetY, slot.worldZ);
    const roadSideOffsetX =
      this.currentLayout?.dualRoadLayout && slot.side === "primary" ? -3.4 : 3.4;
    this.targetCamPos.set(
      slot.worldX + roadSideOffsetX,
      targetY + 3.1,
      slot.worldZ + 4.8
    );
    this.isAnimatingCamera = true;
    this.requestRender();
  }

  public requestRender(): void {
    this.needsRender = true;
  }

  private clearDynamicObjects(): void {
    while (this.dynamicRoot.children.length > 0) {
      this.dynamicRoot.remove(this.dynamicRoot.children[0]);
    }
    this.hitMeshes = [];
    for (const tex of this.dynamicTextures) tex.dispose();
    this.dynamicTextures = [];
    for (const geo of this.dynamicGeometries) geo.dispose();
    this.dynamicGeometries = [];
    for (const mat of this.dynamicMaterials) mat.dispose();
    this.dynamicMaterials = [];
  }

  private matchesFilter(slot: BasketSlot3D): boolean {
    const f = this.currentFilter;
    if (f.row !== "ALL") {
      if (f.row.startsWith("GATE:")) {
        if (slot.gateId !== f.row.slice(5)) return false;
      } else if (f.row.includes(":")) {
        const [gateId, rowId] = f.row.split(":");
        if (slot.gateId !== gateId || slot.rowId !== rowId) return false;
      } else if (slot.rowId !== f.row) {
        return false;
      }
    }
    if (f.status === "EMPTY" && slot.hasAnyCoil) return false;
    if (f.status === "OCCUPIED" && !slot.hasAnyCoil) return false;
    if (f.status === "NEAR_FULL_OR_FULL") {
      const l1Hit =
        slot.layer1.status === "NEAR_FULL" ||
        slot.layer1.status === "FULL" ||
        slot.layer1.status === "OVERFLOW";
      const l2Hit =
        slot.layer2.status === "NEAR_FULL" ||
        slot.layer2.status === "FULL" ||
        slot.layer2.status === "OVERFLOW";
      if (!l1Hit && !l2Hit) return false;
    }
    return true;
  }

  private buildBlueBasketMeshGroup(
    layerState: BasketLayerState,
    dimmed: boolean,
    isSelected: boolean,
    isFocused: boolean
  ): THREE.Group {
    const group = new THREE.Group();
    const isEmpty = layerState.coils.length === 0;
    const frameMat = dimmed
      ? this.basketBlueDimMat
      : isEmpty
      ? this.basketBlueEmptyMat
      : this.basketBlueMat;
    const perfMat = dimmed ? this.basketBlueDimMat : this.basketPerforatedMat;

    // 1. Merged blue steel frame (posts, stacking pins, lugs, base rails, ribs, side rails, V-bracing)
    const frameMesh = new THREE.Mesh(this.mergedFrameGeo, frameMat);
    if (!this.isSoftwareGl && !dimmed) {
      frameMesh.castShadow = true;
      frameMesh.receiveShadow = true;
    }
    group.add(frameMesh);

    // 2. Merged perforated horizontal cross-bars
    const perfMesh = new THREE.Mesh(this.mergedPerfGeo, perfMat);
    group.add(perfMesh);

    // 3. Merged dark steel V-cradle inclined plates supporting the slit coils
    if (!dimmed) {
      const vPlateMesh = new THREE.Mesh(this.mergedVPlateGeo, this.basketVPlateMat);
      group.add(vPlateMesh);
    }

    // 4. Merged capacity LED status strips on both perforated sides
    const stripMat = isFocused
      ? this.statusStripFocusedMat
      : isSelected
      ? this.statusStripSelectedMat
      : this.statusStripMats[layerState.status];
    const stripMesh = new THREE.Mesh(this.mergedStatusStripGeo, stripMat);
    group.add(stripMesh);

    // 5. Slit steel coils seated horizontally inside V-cradle proportional to width (mm / 1000)
    if (layerState.coils.length > 0) {
      let cursorX = -BASKET_INNER_WIDTH_X / 2;
      const maxSpan = BASKET_INNER_WIDTH_X;
      const totalRawWidthM = layerState.usedWidthMm / 1000;
      const overflowScale =
        totalRawWidthM > maxSpan ? maxSpan / totalRawWidthM : 1;

      layerState.coils.forEach((coil, idx) => {
        const rawW = Math.max(0.055, (coil.widthMm / 1000) * overflowScale);
        const visualW = Math.max(0.04, rawW - 0.012); // Crisp gap between individual slit coils
        const coilMat = dimmed
          ? this.basketBlueDimMat
          : !coil.hasSapData
          ? this.coilPendingSapMat
          : this.coilMaterials[idx % this.coilMaterials.length];

        const coilMesh = new THREE.Mesh(this.coilUnitGeo, coilMat);
        coilMesh.scale.set(visualW, 1, 1);
        coilMesh.position.set(cursorX + rawW / 2, 0.99, 0);
        if (!this.isSoftwareGl && !dimmed) {
          coilMesh.castShadow = true;
          coilMesh.receiveShadow = true;
        }
        group.add(coilMesh);

        cursorX += rawW;
      });
    }

    return group;
  }

  private buildSteelCradleMeshGroup(
    layerState: BasketLayerState,
    dimmed: boolean,
    isSelected: boolean,
    isFocused: boolean
  ): THREE.Group {
    const group = new THREE.Group();

    const steelMat = dimmed ? this.cradleSteelDimMat : this.cradleSteelMat;
    const woodMat = dimmed ? this.cradleWoodDimMat : this.cradleWoodMat;

    // 1. Merged gunmetal structural steel triangular A-frame & 2m floor rails
    const steelMesh = new THREE.Mesh(this.mergedCradleSteelGeo, steelMat);
    if (!this.isSoftwareGl && !dimmed) {
      steelMesh.castShadow = true;
      steelMesh.receiveShadow = true;
    }
    group.add(steelMesh);

    // 2. Merged hardwood timber sleeper beams & A-frame rubbing liners
    const woodMesh = new THREE.Mesh(this.mergedCradleWoodGeo, woodMat);
    if (!this.isSoftwareGl && !dimmed) {
      woodMesh.castShadow = true;
      woodMesh.receiveShadow = true;
    }
    group.add(woodMesh);

    // 3. Capacity status LED strip along the front toe plate
    const stripMat = isFocused
      ? this.statusStripFocusedMat
      : isSelected
      ? this.statusStripSelectedMat
      : this.statusStripMats[layerState.status];
    const stripMesh = new THREE.Mesh(this.mergedCradleStatusGeo, stripMat);
    group.add(stripMesh);

    // 4. Slit steel coils resting upright along the 2m timber legs, leaning snug against the wooden A-frame headboard
    if (layerState.coils.length > 0) {
      let cursorX = -0.54; // Snug against the inclined timber headboard liner
      const maxSpan = E10_CRADLE_LEG_SPAN_X;
      const totalRawWidthM = layerState.usedWidthMm / 1000;
      const overflowScale =
        totalRawWidthM > maxSpan ? maxSpan / totalRawWidthM : 1;

      layerState.coils.forEach((coil, idx) => {
        const rawW = Math.max(0.055, (coil.widthMm / 1000) * overflowScale);
        const visualW = Math.max(0.04, rawW - 0.012);
        const coilMat = dimmed
          ? this.cradleSteelDimMat
          : !coil.hasSapData
          ? this.coilPendingSapMat
          : this.coilMaterials[idx % this.coilMaterials.length];

        const coilMesh = new THREE.Mesh(this.coilUnitGeo, coilMat);
        coilMesh.scale.set(visualW, 1, 1);
        // Cradled directly onto the twin timber sleeper rails (y = 0.74 -> rim clears floor & nests between rails)
        coilMesh.position.set(cursorX + rawW / 2, 0.74, 0);
        if (!this.isSoftwareGl && !dimmed) {
          coilMesh.castShadow = true;
          coilMesh.receiveShadow = true;
        }
        group.add(coilMesh);

        cursorX += rawW;
      });
    }

    return group;
  }

  private buildSlittingMachineGroup(): THREE.Group {
    const machine = new THREE.Group();

    const bluePaintMat = new THREE.MeshStandardMaterial({
      color: 0x2b5c86,
      roughness: 0.38,
      metalness: 0.52,
    });
    const darkMachineryMat = new THREE.MeshStandardMaterial({
      color: 0x263140,
      roughness: 0.48,
      metalness: 0.7,
    });
    const steelStripMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.3,
      metalness: 0.85,
    });
    const yellowSafetyMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.42,
      metalness: 0.25,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      map: this.hazardStripeTex,
      roughness: 0.48,
      metalness: 0.15,
    });
    this.dynamicMaterials.push(
      bluePaintMat,
      darkMachineryMat,
      steelStripMat,
      yellowSafetyMat,
      hazardMat
    );

    const addBox = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: THREE.Material,
      rx = 0,
      ry = 0,
      rz = 0
    ) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      this.dynamicGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
      if (!this.isSoftwareGl) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      machine.add(mesh);
      return mesh;
    };

    const addCyl = (
      rt: number,
      rb: number,
      h: number,
      x: number,
      y: number,
      z: number,
      mat: THREE.Material,
      rz = 0,
      rx = 0
    ) => {
      const geo = new THREE.CylinderGeometry(rt, rb, h, 20);
      this.dynamicGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      if (rx || rz) mesh.rotation.set(rx, 0, rz);
      if (!this.isSoftwareGl) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      machine.add(mesh);
      return mesh;
    };

    // Dark recessed machine foundation pit pad
    addBox(3.4, 0.06, 9.6, 0, 0.03, -0.3, darkMachineryMat);

    // 1. Rear Uncoiler / Decoiler with Mother Steel Coil (at z = -4.6)
    addBox(1.5, 1.35, 1.65, -0.95, 0.7, -4.6, darkMachineryMat);
    addCyl(0.24, 0.24, 1.9, 0.15, 1.15, -4.6, darkMachineryMat, Math.PI / 2);
    const motherCoil = new THREE.Mesh(this.coilUnitGeo, this.coilMaterials[0]);
    motherCoil.scale.set(1.35, 1.18, 1.18);
    motherCoil.position.set(0.35, 1.15, -4.6);
    if (!this.isSoftwareGl) {
      motherCoil.castShadow = true;
      motherCoil.receiveShadow = true;
    }
    machine.add(motherCoil);

    // 2. Entry Pinch Roll & Leveler Housing (at z = -2.6)
    addBox(0.65, 1.85, 1.65, -1.25, 0.95, -2.6, bluePaintMat);
    addBox(0.65, 1.85, 1.65, 1.25, 0.95, -2.6, bluePaintMat);
    addBox(2.9, 0.34, 1.5, 0, 1.85, -2.6, bluePaintMat);
    addCyl(0.22, 0.22, 2.2, 0, 1.28, -2.6, steelStripMat, Math.PI / 2);
    addCyl(0.22, 0.22, 2.2, 0, 0.82, -2.6, steelStripMat, Math.PI / 2);

    // 3. Main Slitter Head Unit (at z = 0.0)
    addBox(0.75, 2.1, 2.0, -1.3, 1.08, 0.0, bluePaintMat);
    addBox(0.75, 2.1, 2.0, 1.3, 1.08, 0.0, bluePaintMat);
    addBox(3.1, 0.38, 1.9, 0, 2.08, 0.0, bluePaintMat);
    // Upper & lower slitter knife arbors + cutting blades
    addCyl(0.16, 0.16, 2.1, 0, 1.32, 0.0, darkMachineryMat, Math.PI / 2);
    addCyl(0.16, 0.16, 2.1, 0, 0.88, 0.0, darkMachineryMat, Math.PI / 2);
    for (let kx = -0.75; kx <= 0.75; kx += 0.3) {
      addCyl(0.25, 0.25, 0.04, kx, 1.32, 0.0, steelStripMat, Math.PI / 2);
      addCyl(0.25, 0.25, 0.04, kx, 0.88, 0.0, steelStripMat, Math.PI / 2);
    }
    // Yellow electrical control cabinet on right housing
    addBox(0.32, 0.65, 0.52, 1.78, 1.15, 0.35, yellowSafetyMat);

    // Continuous dark steel strip feeding from uncoiler -> leveler -> slitter -> recoiler
    addBox(1.75, 0.04, 7.6, 0, 1.08, -0.7, steelStripMat);
    // Slit strip guide deflection roll in front
    addCyl(0.16, 0.16, 1.9, 0, 0.92, 1.85, steelStripMat, Math.PI / 2);

    // 4. Front Recoiler & Iconic 2-Arm Hazard-Striped Turnstile (at z = +3.35)
    addCyl(1.15, 1.28, 0.55, 0, 0.3, 3.35, bluePaintMat);
    addCyl(0.55, 0.65, 1.05, 0, 0.95, 3.35, bluePaintMat);
    // Left & right extending turnstile coil arms with black/yellow hazard stripes
    addBox(1.95, 0.34, 0.34, -1.65, 1.02, 3.35, hazardMat);
    addBox(1.95, 0.34, 0.34, 1.65, 1.02, 3.35, hazardMat);

    // 5. Right-Side Steel Operator Walkway Platform, Stairs & Safety-Yellow Handrails
    addBox(1.1, 0.12, 5.4, 2.35, 0.82, -1.6, darkMachineryMat);
    // Platform legs
    for (const lz of [-4.1, -1.6, 0.95]) {
      addBox(0.08, 0.82, 0.08, 2.84, 0.41, lz, darkMachineryMat);
      addBox(0.08, 0.82, 0.08, 1.86, 0.41, lz, darkMachineryMat);
    }
    // Front access staircase descending from platform (z = 1.1 to 2.2)
    for (let s = 0; s < 4; s++) {
      addBox(0.95, 0.06, 0.26, 2.35, 0.7 - s * 0.18, 1.2 + s * 0.28, darkMachineryMat);
    }
    // Yellow safety railing along outer edge, rear edge & stair handrails
    addBox(0.05, 0.05, 5.4, 2.86, 1.65, -1.6, yellowSafetyMat);
    addBox(0.05, 0.05, 5.4, 2.86, 1.25, -1.6, yellowSafetyMat);
    addBox(1.1, 0.05, 0.05, 2.35, 1.65, -4.26, yellowSafetyMat);
    addBox(1.1, 0.05, 0.05, 2.35, 1.25, -4.26, yellowSafetyMat);
    for (const rz of [-4.26, -2.9, -1.55, -0.2, 1.06]) {
      addBox(0.05, 0.86, 0.05, 2.86, 1.25, rz, yellowSafetyMat);
    }
    // Left-side rear walkway railing guard
    addBox(0.05, 0.05, 2.2, -1.78, 1.45, -3.5, yellowSafetyMat);
    addBox(0.05, 0.86, 0.05, -1.78, 1.05, -4.55, yellowSafetyMat);
    addBox(0.05, 0.86, 0.05, -1.78, 1.05, -2.45, yellowSafetyMat);

    return machine;
  }

  private rebuildE10Scene(layout: BuildingBasketLayout3D): void {
    const { slabWidth, slabDepth } = layout;

    // 0. Exterior Ground Skirt
    const siteGeo = new THREE.PlaneGeometry(slabWidth + 18, slabDepth + 16);
    const siteMat = new THREE.MeshStandardMaterial({
      color: 0x162030,
      roughness: 0.96,
      metalness: 0.04,
    });
    this.dynamicGeometries.push(siteGeo);
    this.dynamicMaterials.push(siteMat);
    const siteGround = new THREE.Mesh(siteGeo, siteMat);
    siteGround.rotation.x = -Math.PI / 2;
    siteGround.position.set(0, -0.06, 0);
    this.dynamicRoot.add(siteGround);

    // 1. Main Building Concrete Floor Slab & Foundation Plinth
    const floorGeo = new THREE.PlaneGeometry(slabWidth, slabDepth);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x9aa4b2,
      roughness: 0.86,
      metalness: 0.06,
    });
    const plinthGeo = new THREE.BoxGeometry(slabWidth + 0.36, 0.1, slabDepth + 0.36);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.84,
      metalness: 0.16,
    });
    this.dynamicGeometries.push(floorGeo, plinthGeo);
    this.dynamicMaterials.push(floorMat, plinthMat);

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = !this.isSoftwareGl;
    this.dynamicRoot.add(floor);

    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(0, -0.055, 0);
    this.dynamicRoot.add(plinth);

    // 2. Central Drive-Through Road with Bright Yellow Safety Boundaries (x = -3.8 to +2.6, width = 6.4m)
    const roadLeftX = -3.8;
    const roadRightX = 2.6;
    const roadWidth = roadRightX - roadLeftX;
    const roadCenterX = (roadLeftX + roadRightX) / 2;

    const roadGeo = new THREE.PlaneGeometry(roadWidth, slabDepth - 0.12);
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.e10CenterRoadTex,
      roughness: 0.86,
      metalness: 0.06,
    });
    this.dynamicGeometries.push(roadGeo);
    this.dynamicMaterials.push(roadMat);
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set(roadCenterX, 0.014, 0);
    roadMesh.receiveShadow = !this.isSoftwareGl;
    this.dynamicRoot.add(roadMesh);

    // Bold black "ROW A" floor stencil along the left edge of the central road
    const rowATex = createFloorStencilTexture("ROW A", "#0f172a", 92);
    this.dynamicTextures.push(rowATex);
    const rowAGeo = new THREE.PlaneGeometry(4.4, 0.95);
    const rowAMat = new THREE.MeshBasicMaterial({
      map: rowATex,
      transparent: true,
    });
    this.dynamicGeometries.push(rowAGeo);
    this.dynamicMaterials.push(rowAMat);
    const rowALabel = new THREE.Mesh(rowAGeo, rowAMat);
    rowALabel.rotation.x = -Math.PI / 2;
    rowALabel.rotation.z = Math.PI / 2;
    rowALabel.position.set(roadLeftX + 1.05, 0.024, 0.2);
    this.dynamicRoot.add(rowALabel);

    // 3. Right Side: Green Epoxy Floor Zone ("SLITTING MACHINE")
    const greenLeftX = roadRightX + 0.14;
    const greenRightX = slabWidth / 2 - 0.22;
    const greenWidth = greenRightX - greenLeftX;
    const greenCenterX = (greenLeftX + greenRightX) / 2;

    const greenGeo = new THREE.PlaneGeometry(greenWidth, slabDepth - 0.5);
    const greenMat = new THREE.MeshStandardMaterial({
      color: 0x2f7d57,
      roughness: 0.44,
      metalness: 0.08,
    });
    this.dynamicGeometries.push(greenGeo);
    this.dynamicMaterials.push(greenMat);
    const greenFloor = new THREE.Mesh(greenGeo, greenMat);
    greenFloor.rotation.x = -Math.PI / 2;
    greenFloor.position.set(greenCenterX, 0.014, 0);
    greenFloor.receiveShadow = !this.isSoftwareGl;
    this.dynamicRoot.add(greenFloor);

    // Bold white "SLITTING MACHINE" stencil painted on front green epoxy floor
    const slitLblTex = createFloorStencilTexture("SLITTING MACHINE", "#f8fafc", 68);
    this.dynamicTextures.push(slitLblTex);
    const slitLblGeo = new THREE.PlaneGeometry(6.6, 1.35);
    const slitLblMat = new THREE.MeshBasicMaterial({
      map: slitLblTex,
      transparent: true,
    });
    this.dynamicGeometries.push(slitLblGeo);
    this.dynamicMaterials.push(slitLblMat);
    const slitLblMesh = new THREE.Mesh(slitLblGeo, slitLblMat);
    slitLblMesh.rotation.x = -Math.PI / 2;
    slitLblMesh.position.set(greenCenterX - 0.1, 0.024, slabDepth / 2 - 2.45);
    this.dynamicRoot.add(slitLblMesh);

    // Composite 3D Slitting Machine staggered slightly along Z relative to ROW A (matching reference floorplan)
    const slittingMachine = this.buildSlittingMachineGroup();
    slittingMachine.position.set(greenCenterX - 0.35, 0.014, 1.35);
    this.dynamicRoot.add(slittingMachine);

    // 4. Cutaway Corrugated Warehouse Shell & Steel I-Beam Columns (matching Image 3)
    const wallCorrugatedMat = new THREE.MeshStandardMaterial({
      map: this.corrugatedWallTex,
      roughness: 0.54,
      metalness: 0.44,
    });
    const dadoConcreteMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.84,
      metalness: 0.06,
    });
    const steelColMat = new THREE.MeshStandardMaterial({
      color: 0x3f4754,
      roughness: 0.5,
      metalness: 0.62,
    });
    this.dynamicMaterials.push(wallCorrugatedMat, dadoConcreteMat, steelColMat);

    const addWallBox = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: THREE.Material
    ) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      this.dynamicGeometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.dynamicRoot.add(mesh);
    };

    const wallXLeft = -slabWidth / 2 + 0.14;
    const wallXRight = slabWidth / 2 - 0.14;
    const wallZBack = -slabDepth / 2 + 0.14;
    const wallZFront = slabDepth / 2 - 0.14;

    // Left full warehouse wall behind ROW A (concrete dado + corrugated metal upper siding)
    addWallBox(0.24, 1.5, slabDepth, wallXLeft, 0.75, 0, dadoConcreteMat);
    addWallBox(0.18, 3.6, slabDepth, wallXLeft, 3.3, 0, wallCorrugatedMat);
    addWallBox(0.28, 0.24, slabDepth, wallXLeft, 5.18, 0, steelColMat);

    // Steel structural columns evenly spaced along left wall
    const colCount = Math.max(4, Math.round(slabDepth / 5.2));
    for (let i = 0; i <= colCount; i++) {
      const cz = -slabDepth / 2 + 0.25 + (i * (slabDepth - 0.5)) / colCount;
      addWallBox(0.32, 5.25, 0.26, wallXLeft + 0.08, 2.62, cz, steelColMat);
    }

    // Back split walls (left wing behind ROW A + right wing behind Slitting Machine; open drive-through center portal!)
    const backLeftW = roadLeftX - (-slabWidth / 2);
    const backLeftCenterX = -slabWidth / 2 + backLeftW / 2;
    addWallBox(backLeftW, 1.5, 0.24, backLeftCenterX, 0.75, wallZBack, dadoConcreteMat);
    addWallBox(backLeftW, 3.6, 0.18, backLeftCenterX, 3.3, wallZBack, wallCorrugatedMat);
    addWallBox(backLeftW, 0.24, 0.28, backLeftCenterX, 5.18, wallZBack, steelColMat);
    addWallBox(0.3, 5.25, 0.3, roadLeftX, 2.62, wallZBack, steelColMat);

    const backRightW = slabWidth / 2 - roadRightX;
    const backRightCenterX = roadRightX + backRightW / 2;
    addWallBox(backRightW, 1.5, 0.24, backRightCenterX, 0.75, wallZBack, dadoConcreteMat);
    addWallBox(backRightW, 3.6, 0.18, backRightCenterX, 3.3, wallZBack, wallCorrugatedMat);
    addWallBox(backRightW, 0.24, 0.28, backRightCenterX, 5.18, wallZBack, steelColMat);
    addWallBox(0.3, 5.25, 0.3, roadRightX, 2.62, wallZBack, steelColMat);

    // Right cutaway wall (dado full length + upper corrugated back section; kept open in front-right so Slitting Machine is unobstructed)
    addWallBox(0.24, 1.5, slabDepth, wallXRight, 0.75, 0, dadoConcreteMat);
    const rightUpperD = slabDepth * 0.34;
    addWallBox(
      0.18,
      3.6,
      rightUpperD,
      wallXRight,
      3.3,
      -slabDepth / 2 + rightUpperD / 2,
      wallCorrugatedMat
    );
    for (let i = 0; i <= 3; i++) {
      const cz = -slabDepth / 2 + 0.25 + (i * (slabDepth - 0.5)) / 3;
      const ch = i === 0 ? 5.25 : 4.2;
      addWallBox(0.32, ch, 0.26, wallXRight - 0.08, ch / 2, cz, steelColMat);
    }

    // Front low cutaway dado walls on left & right wings (center road drive-through open!)
    addWallBox(backLeftW, 1.25, 0.24, backLeftCenterX, 0.625, wallZFront, dadoConcreteMat);
    addWallBox(backRightW, 1.25, 0.24, backRightCenterX, 0.625, wallZFront, dadoConcreteMat);

    // Building E10 Signboard mounted on left back wall header
    const signTex = createBuildingSignTexture("E10");
    this.dynamicTextures.push(signTex);
    const signGeo = new THREE.PlaneGeometry(6.4, 1.35);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    this.dynamicGeometries.push(signGeo);
    this.dynamicMaterials.push(signMat);
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.set(backLeftCenterX, 4.15, wallZBack + 0.22);
    this.dynamicRoot.add(signMesh);

    // 5. Left Side (ROW A): Yellow Safety Floor Bays + Triangular A-Frame 2m Steel Cradle Racks
    const bayPadGeo = new THREE.PlaneGeometry(5.65, 2.38);
    const bayInnerGeo = new THREE.PlaneGeometry(3.45, 1.38);
    const labelGeo = new THREE.PlaneGeometry(1.55, 0.56);
    const hitGeo = new THREE.BoxGeometry(
      E10_CRADLE_TOTAL_LENGTH_X + 0.35,
      E10_CRADLE_HEIGHT_Y,
      E10_CRADLE_WIDTH_Z + 0.72
    );
    const focusRingGeo = new THREE.PlaneGeometry(5.85, 2.54);
    focusRingGeo.rotateX(-Math.PI / 2);
    this.dynamicGeometries.push(bayPadGeo, bayInnerGeo, labelGeo, hitGeo, focusRingGeo);

    const bayInnerMat = new THREE.MeshStandardMaterial({
      color: 0x7e8896,
      roughness: 0.88,
      metalness: 0.06,
    });
    const invisibleHitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.dynamicMaterials.push(bayInnerMat, invisibleHitMat);

    const f = this.currentFilter;
    for (const slot of layout.slots) {
      const matched = this.matchesFilter(slot);
      const isSelected = f.selectedBasketCode === slot.basketCode;
      const isFocused = f.focusedBasketCode === slot.basketCode;
      const dimmed = !matched && !isSelected && !isFocused;

      const bayColor = isFocused
        ? 0xa855f7
        : isSelected
        ? 0x38bdf8
        : dimmed
        ? 0x475569
        : 0xfacc15; // Iconic yellow painted safety bay around every ROW A cradle rack
      const bayMat = new THREE.MeshStandardMaterial({
        color: bayColor,
        roughness: 0.65,
        metalness: 0.05,
        transparent: dimmed,
        opacity: dimmed ? 0.38 : 1,
      });
      this.dynamicMaterials.push(bayMat);

      const bayPad = new THREE.Mesh(bayPadGeo, bayMat);
      bayPad.rotation.x = -Math.PI / 2;
      bayPad.position.set(-7.1, 0.012, slot.worldZ);
      bayPad.receiveShadow = !this.isSoftwareGl;
      this.dynamicRoot.add(bayPad);

      // Inner concrete cutout beneath rack rails so the yellow safety border pops cleanly like Image 3
      if (!isSelected && !isFocused) {
        const innerPad = new THREE.Mesh(bayInnerGeo, bayInnerMat);
        innerPad.rotation.x = -Math.PI / 2;
        innerPad.position.set(slot.worldX + 0.12, 0.014, slot.worldZ);
        this.dynamicRoot.add(innerPad);
      }

      // Slot floor code badge near the road-facing tip of each bay (E10-A01..E10-A08)
      const statusCss =
        slot.layer1.status === "EMPTY"
          ? "#22c55e"
          : slot.layer1.status === "PARTIAL"
          ? "#38bdf8"
          : slot.layer1.status === "NEAR_FULL"
          ? "#f59e0b"
          : "#f43f5e";
      const summaryTxt = slot.hasAnyCoil
        ? `${Math.round(slot.layer1.usedWidthMm)} / 2000mm`
        : "EMPTY · 2.0m";
      const lblTex = createSlotFloorLabelTexture(
        slot.basketCode,
        statusCss,
        summaryTxt
      );
      this.dynamicTextures.push(lblTex);
      const lblMat = new THREE.MeshBasicMaterial({
        map: lblTex,
        transparent: true,
        opacity: dimmed ? 0.35 : 0.96,
      });
      this.dynamicMaterials.push(lblMat);
      const lblMesh = new THREE.Mesh(labelGeo, lblMat);
      lblMesh.rotation.x = -Math.PI / 2;
      lblMesh.position.set(-5.32, 0.022, slot.worldZ);
      this.dynamicRoot.add(lblMesh);

      // Render Triangular A-Frame 2m Steel Cradle Rack (always visible on ground level, empty or loaded with coils!)
      if (f.layer !== "2") {
        const cradleGroup = this.buildSteelCradleMeshGroup(
          slot.layer1,
          dimmed,
          isSelected,
          isFocused
        );
        cradleGroup.position.set(slot.worldX, 0.015, slot.worldZ);
        this.dynamicRoot.add(cradleGroup);
      }

      // Clickable raycast hitbox covering full rack footprint
      const hitMesh = new THREE.Mesh(hitGeo, invisibleHitMat);
      hitMesh.position.set(slot.worldX, E10_CRADLE_HEIGHT_Y / 2, slot.worldZ);
      hitMesh.userData = { slot, layer: 1 as const };
      this.dynamicRoot.add(hitMesh);
      this.hitMeshes.push(hitMesh);
    }

    const maxSpan = Math.max(slabWidth, slabDepth);
    this.controls.maxDistance = Math.max(55, maxSpan * 2.1);
  }

  private rebuildScene(): void {
    this.clearDynamicObjects();
    const layout = this.currentLayout;
    if (!layout) return;

    if (isCradleRackBuilding(layout.buildingId)) {
      this.rebuildE10Scene(layout);
      return;
    }

    const { slabWidth, slabDepth, buildingId, dualRoadLayout } = layout;

    // 0. Industrial Site Ground Skirt
    const siteGroundGeo = new THREE.PlaneGeometry(slabWidth + 24, slabDepth + 18);
    const siteGroundMat = new THREE.MeshStandardMaterial({
      color: 0x162030,
      roughness: 0.96,
      metalness: 0.04,
    });
    this.dynamicGeometries.push(siteGroundGeo);
    this.dynamicMaterials.push(siteGroundMat);
    const siteGround = new THREE.Mesh(siteGroundGeo, siteGroundMat);
    siteGround.rotation.x = -Math.PI / 2;
    siteGround.position.set(dualRoadLayout ? 0 : -3.2, -0.05, 0);
    this.dynamicRoot.add(siteGround);

    const floorMat = new THREE.MeshStandardMaterial({
      map: this.floorConcreteTex,
      roughness: 0.88,
      metalness: 0.08,
    });
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.85,
      metalness: 0.15,
    });
    const gantryPostGeo = new THREE.BoxGeometry(0.26, 5.4, 0.26);
    const sideHeaderBeamGeo = new THREE.BoxGeometry(0.28, 0.28, slabDepth - 0.8);
    const gantryMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.6,
      metalness: 0.5,
    });
    const safetyPostGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.8, 10);
    const safetyPostMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.45,
      metalness: 0.25,
    });
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.9,
      metalness: 0.06,
    });
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.85,
      metalness: 0.08,
    });
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.exteriorRoadTex,
      roughness: 0.92,
      metalness: 0.05,
    });
    this.dynamicGeometries.push(gantryPostGeo, sideHeaderBeamGeo, safetyPostGeo);
    this.dynamicMaterials.push(
      floorMat,
      plinthMat,
      gantryMat,
      safetyPostMat,
      apronMat,
      curbMat,
      roadMat
    );

    const addBuildingWingShell = (
      centerX: number,
      wingWidth: number,
      gateLabel: string,
      signTitle: string,
      signSubtitle: string,
      borderColorHex: number,
      portalSide: "left" | "right",
      isGateFacade: boolean
    ) => {
      // Concrete Floor Slab
      const fGeo = new THREE.PlaneGeometry(wingWidth, slabDepth);
      const pGeo = new THREE.BoxGeometry(wingWidth + 0.28, 0.08, slabDepth + 0.28);
      const bGeo = new THREE.BoxGeometry(wingWidth - 0.8, 0.28, 0.28);
      this.dynamicGeometries.push(fGeo, pGeo, bGeo);

      const floor = new THREE.Mesh(fGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(centerX, 0, 0);
      floor.receiveShadow = !this.isSoftwareGl;
      this.dynamicRoot.add(floor);

      const plinth = new THREE.Mesh(pGeo, plinthMat);
      plinth.position.set(centerX, -0.045, 0);
      this.dynamicRoot.add(plinth);

      // Perimeter safety line
      const halfW = wingWidth / 2;
      const borderPts = [
        new THREE.Vector3(centerX - halfW + 0.55, 0.02, -slabDepth / 2 + 0.55),
        new THREE.Vector3(centerX + halfW - 0.55, 0.02, -slabDepth / 2 + 0.55),
        new THREE.Vector3(centerX + halfW - 0.55, 0.02, slabDepth / 2 - 0.55),
        new THREE.Vector3(centerX - halfW + 0.55, 0.02, slabDepth / 2 - 0.55),
        new THREE.Vector3(centerX - halfW + 0.55, 0.02, -slabDepth / 2 + 0.55),
      ];
      const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
      const borderMat = new THREE.LineBasicMaterial({ color: borderColorHex });
      this.dynamicGeometries.push(borderGeo);
      this.dynamicMaterials.push(borderMat);
      this.dynamicRoot.add(new THREE.Line(borderGeo, borderMat));

      // Back Overhead Gantry & Signboard (-Z)
      const signTex = createBuildingSignTexture(
        gateLabel,
        signTitle,
        signSubtitle
      );
      this.dynamicTextures.push(signTex);
      const signGeo = new THREE.PlaneGeometry(8.8, 1.85);
      const signMat = new THREE.MeshBasicMaterial({ map: signTex });
      this.dynamicGeometries.push(signGeo);
      this.dynamicMaterials.push(signMat);
      const signMesh = new THREE.Mesh(signGeo, signMat);
      signMesh.position.set(centerX, 4.4, -slabDepth / 2 + 0.7);
      this.dynamicRoot.add(signMesh);

      for (const gx of [centerX - halfW + 0.5, centerX + halfW - 0.5]) {
        const p = new THREE.Mesh(gantryPostGeo, gantryMat);
        p.position.set(gx, 2.7, -slabDepth / 2 + 0.5);
        this.dynamicRoot.add(p);
      }
      const topBeam = new THREE.Mesh(bGeo, gantryMat);
      topBeam.position.set(centerX, 5.4, -slabDepth / 2 + 0.5);
      this.dynamicRoot.add(topBeam);

      // Entrance Portal & Road-Facing Fascia Sign
      const portalEdgeX =
        portalSide === "left" ? centerX - halfW : centerX + halfW;
      for (const pz of [-slabDepth / 2 + 0.5, slabDepth / 2 - 0.5]) {
        const col = new THREE.Mesh(gantryPostGeo, gantryMat);
        col.position.set(portalEdgeX, 2.7, pz);
        this.dynamicRoot.add(col);
      }
      const sideHeaderBeam = new THREE.Mesh(sideHeaderBeamGeo, gantryMat);
      sideHeaderBeam.position.set(portalEdgeX, 5.4, 0);
      this.dynamicRoot.add(sideHeaderBeam);

      const frontSignTex = createFrontFacadeSignTexture(
        gateLabel,
        isGateFacade ? "CENTRAL ROAD · ROW A–D" : "OUTDOOR ROAD ACCESS",
        isGateFacade
      );
      this.dynamicTextures.push(frontSignTex);
      const frontSignGeo = new THREE.PlaneGeometry(5.6, 1.2);
      const frontSignMat = new THREE.MeshBasicMaterial({
        map: frontSignTex,
        side: THREE.DoubleSide,
      });
      this.dynamicGeometries.push(frontSignGeo);
      this.dynamicMaterials.push(frontSignMat);
      const frontSignMesh = new THREE.Mesh(frontSignGeo, frontSignMat);
      frontSignMesh.rotation.y =
        portalSide === "left" ? -Math.PI / 2 : Math.PI / 2;
      frontSignMesh.position.set(
        portalSide === "left" ? portalEdgeX - 0.18 : portalEdgeX + 0.18,
        4.95,
        0
      );
      this.dynamicRoot.add(frontSignMesh);
    };

    const rowBadgeGeo = new THREE.PlaneGeometry(1.75, 0.88);
    this.dynamicGeometries.push(rowBadgeGeo);

    if (dualRoadLayout) {
      // DUAL-SIDE BUILDING H2: Gate H4 (-X) and Gate H2 (+X) facing each other across the central road!
      const {
        roadCenterX,
        roadWidth,
        apronWidth,
        primaryGateId,
        oppositeGateId,
        primarySlabCenterX,
        primarySlabWidth,
        oppositeSlabCenterX,
        oppositeSlabWidth,
      } = dualRoadLayout;

      // Right Wing (+X): ประตู H2
      addBuildingWingShell(
        primarySlabCenterX,
        primarySlabWidth,
        primaryGateId,
        `ประตู ${primaryGateId} (GATE ${primaryGateId}) · BLUE BASKET`,
        "MAX WIDTH 2,000 mm / BASKET · MAX STACK 2 LAYERS",
        0xf59e0b,
        "left",
        true
      );

      // Left Wing (-X): ประตู H4 (opposite across central road)
      addBuildingWingShell(
        oppositeSlabCenterX,
        oppositeSlabWidth,
        oppositeGateId,
        `ประตู ${oppositeGateId} (GATE ${oppositeGateId}) · BLUE BASKET`,
        "OPPOSITE GATE H2 · MAX WIDTH 2,000 mm · MAX 2 LAYERS",
        0x06b6d4,
        "right",
        true
      );

      const roadLength = slabDepth + 10.5;
      const halfRoadW = roadWidth / 2;
      const rightApronCenterX = roadCenterX + halfRoadW + apronWidth / 2;
      const leftApronCenterX = roadCenterX - halfRoadW - apronWidth / 2;

      // Aprons on BOTH sides of the central road
      const apronGeo = new THREE.PlaneGeometry(apronWidth, roadLength);
      const endCurbLen = 3.6;
      const endCurbGeo = new THREE.BoxGeometry(0.22, 0.12, endCurbLen);
      const roadGeo = new THREE.PlaneGeometry(roadLength, roadWidth);
      this.dynamicGeometries.push(apronGeo, endCurbGeo, roadGeo);

      for (const ax of [leftApronCenterX, rightApronCenterX]) {
        const apronMesh = new THREE.Mesh(apronGeo, apronMat);
        apronMesh.rotation.x = -Math.PI / 2;
        apronMesh.position.set(ax, -0.012, 0);
        this.dynamicRoot.add(apronMesh);
      }

      // Curbs & yellow safety bollards flanking BOTH Gate H4 & Gate H2 portals
      for (const edgeSign of [-1, 1]) {
        const curbX = roadCenterX + edgeSign * (halfRoadW + 0.11);
        const bollardX = roadCenterX + edgeSign * (halfRoadW + 0.28);
        for (const zSign of [-1, 1]) {
          const endCurb = new THREE.Mesh(endCurbGeo, curbMat);
          endCurb.position.set(
            curbX,
            0.03,
            zSign * (roadLength / 2 - endCurbLen / 2)
          );
          this.dynamicRoot.add(endCurb);

          const bollard = new THREE.Mesh(safetyPostGeo, safetyPostMat);
          bollard.position.set(
            bollardX,
            0.4,
            zSign * (slabDepth / 2 - 0.55)
          );
          this.dynamicRoot.add(bollard);
        }
      }

      // Central Asphalt Road separating ประตู H4 (-X) and ประตู H2 (+X)
      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadMesh.rotation.x = -Math.PI / 2;
      roadMesh.rotation.z = Math.PI / 2;
      roadMesh.position.set(roadCenterX, -0.02, 0);
      roadMesh.receiveShadow = !this.isSoftwareGl;
      this.dynamicRoot.add(roadMesh);

      // Center Road Stencil Text
      const roadLabelTex = createRoadLabelTexture(
        buildingId,
        `ROAD · ประตู ${oppositeGateId} ◄── ถนนคั่นกลาง ──► ประตู ${primaryGateId}`
      );
      this.dynamicTextures.push(roadLabelTex);
      const roadLabelGeo = new THREE.PlaneGeometry(11.4, 1.45);
      const roadLabelMat = new THREE.MeshBasicMaterial({
        map: roadLabelTex,
        transparent: true,
      });
      this.dynamicGeometries.push(roadLabelGeo);
      this.dynamicMaterials.push(roadLabelMat);
      const roadLabelMesh = new THREE.Mesh(roadLabelGeo, roadLabelMat);
      roadLabelMesh.rotation.x = -Math.PI / 2;
      roadLabelMesh.rotation.z = Math.PI / 2;
      roadLabelMesh.position.set(roadCenterX, -0.004, 0);
      this.dynamicRoot.add(roadLabelMesh);

      // Row Header Badges on BOTH sides along the central road edges
      const rightPortalEdgeX = roadCenterX + halfRoadW + apronWidth;
      const leftPortalEdgeX = roadCenterX - halfRoadW - apronWidth;
      for (const rp of layout.rowPositions) {
        const rTex = createRowBadgeTexture(rp.rowId);
        this.dynamicTextures.push(rTex);
        const rMat = new THREE.MeshBasicMaterial({ map: rTex });
        this.dynamicMaterials.push(rMat);
        const badge = new THREE.Mesh(rowBadgeGeo, rMat);
        badge.rotation.x = -Math.PI / 2;
        const badgeX =
          rp.side === "primary"
            ? rightPortalEdgeX + 1.55
            : leftPortalEdgeX - 1.55;
        badge.position.set(badgeX, 0.025, rp.worldZ);
        this.dynamicRoot.add(badge);
      }
    } else {
      // SINGLE-SIDE BLUE BASKET BUILDINGS (E9, F — unchanged)
      addBuildingWingShell(
        0,
        slabWidth,
        buildingId,
        `BUILDING ${buildingId} · BLUE BASKET ZONE`,
        "MAX WIDTH 2,000 mm / BASKET · MAX STACK 2 LAYERS",
        0xf59e0b,
        "left",
        false
      );

      const roadEdgeX = -slabWidth / 2;
      const apronWidth = 1.25;
      const roadWidth = 4.6;
      const roadLength = slabDepth + 8.5;
      const apronCenterX = roadEdgeX - apronWidth / 2;
      const roadCenterX = roadEdgeX - apronWidth - roadWidth / 2;

      const apronGeo = new THREE.PlaneGeometry(apronWidth, roadLength);
      const farCurbGeo = new THREE.BoxGeometry(0.22, 0.12, roadLength);
      const endCurbLen = 3.2;
      const nearEndCurbGeo = new THREE.BoxGeometry(0.22, 0.12, endCurbLen);
      const roadGeo = new THREE.PlaneGeometry(roadLength, roadWidth);
      this.dynamicGeometries.push(apronGeo, farCurbGeo, nearEndCurbGeo, roadGeo);

      const apronMesh = new THREE.Mesh(apronGeo, apronMat);
      apronMesh.rotation.x = -Math.PI / 2;
      apronMesh.position.set(apronCenterX, -0.012, 0);
      this.dynamicRoot.add(apronMesh);

      const farCurb = new THREE.Mesh(farCurbGeo, curbMat);
      farCurb.position.set(roadEdgeX - apronWidth - roadWidth - 0.11, 0.03, 0);
      this.dynamicRoot.add(farCurb);

      for (const side of [-1, 1]) {
        const nearEndCurb = new THREE.Mesh(nearEndCurbGeo, curbMat);
        nearEndCurb.position.set(
          roadEdgeX - apronWidth + 0.11,
          0.03,
          side * (roadLength / 2 - endCurbLen / 2)
        );
        this.dynamicRoot.add(nearEndCurb);

        const bollard = new THREE.Mesh(safetyPostGeo, safetyPostMat);
        bollard.position.set(
          roadEdgeX - apronWidth + 0.22,
          0.4,
          side * (slabDepth / 2 - 0.55)
        );
        this.dynamicRoot.add(bollard);
      }

      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadMesh.rotation.x = -Math.PI / 2;
      roadMesh.rotation.z = Math.PI / 2;
      roadMesh.position.set(roadCenterX, -0.02, 0);
      roadMesh.receiveShadow = !this.isSoftwareGl;
      this.dynamicRoot.add(roadMesh);

      const roadLabelTex = createRoadLabelTexture(buildingId);
      this.dynamicTextures.push(roadLabelTex);
      const roadLabelGeo = new THREE.PlaneGeometry(9.2, 1.35);
      const roadLabelMat = new THREE.MeshBasicMaterial({
        map: roadLabelTex,
        transparent: true,
      });
      this.dynamicGeometries.push(roadLabelGeo);
      this.dynamicMaterials.push(roadLabelMat);
      const roadLabelMesh = new THREE.Mesh(roadLabelGeo, roadLabelMat);
      roadLabelMesh.rotation.x = -Math.PI / 2;
      roadLabelMesh.rotation.z = Math.PI / 2;
      roadLabelMesh.position.set(
        roadCenterX - roadWidth / 2 - 0.95,
        -0.008,
        0
      );
      this.dynamicRoot.add(roadLabelMesh);

      // Row Header Badges (ROW A, ROW B, ROW C, ROW D...) right along the -X road-facing edge
      for (const rp of layout.rowPositions) {
        const rTex = createRowBadgeTexture(rp.rowId);
        this.dynamicTextures.push(rTex);
        const rMat = new THREE.MeshBasicMaterial({ map: rTex });
        this.dynamicMaterials.push(rMat);
        const badge = new THREE.Mesh(rowBadgeGeo, rMat);
        badge.rotation.x = -Math.PI / 2;
        badge.position.set(roadEdgeX + 1.55, 0.025, rp.worldZ);
        this.dynamicRoot.add(badge);
      }
    }

    // 4. Shared Floor Slot Pad & Hitbox Geometries (square 2.28m x 2.28m footprint)
    const padGeo = new THREE.PlaneGeometry(
      BASKET_OUTER_WIDTH_X + 0.14,
      BASKET_OUTER_DEPTH_Z + 0.14
    );
    const labelGeo = new THREE.PlaneGeometry(1.75, 0.62);
    const hitGeo = new THREE.BoxGeometry(
      BASKET_OUTER_WIDTH_X + 0.08,
      BASKET_HEIGHT_Y,
      BASKET_OUTER_DEPTH_Z + 0.08
    );
    const focusRingGeo = new THREE.RingGeometry(1.58, 1.78, 36);
    focusRingGeo.rotateX(-Math.PI / 2);
    this.dynamicGeometries.push(padGeo, labelGeo, hitGeo, focusRingGeo);

    const invisibleHitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.dynamicMaterials.push(invisibleHitMat);

    // 5. Render every Basket Slot (Floor Bay + Layer 1 + Layer 2 + Ghost Preview)
    const f = this.currentFilter;
    for (const slot of layout.slots) {
      const matched = this.matchesFilter(slot);
      const isSelected = f.selectedBasketCode === slot.basketCode;
      const isFocused = f.focusedBasketCode === slot.basketCode;
      const dimmed = !matched && !isSelected && !isFocused;

      // Determine slot floor pad highlight color
      const hasLayer1Work = slot.layer1.coils.length > 0;
      const primaryStatus: BasketLayerStatus =
        hasLayer1Work && slot.layer2.status !== "EMPTY"
          ? slot.layer2.status
          : slot.layer1.status;
      const padColor = isFocused
        ? 0xa855f7
        : isSelected
        ? 0x38bdf8
        : dimmed
        ? 0x1e293b
        : slot.hasAnyCoil
        ? STATUS_COLORS[primaryStatus]
        : 0x22c55e;

      const padMat = new THREE.MeshBasicMaterial({
        color: padColor,
        transparent: true,
        opacity: isFocused || isSelected ? 0.36 : slot.hasAnyCoil ? 0.22 : 0.16,
      });
      this.dynamicMaterials.push(padMat);

      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(slot.worldX, 0.015, slot.worldZ);
      this.dynamicRoot.add(pad);

      // Floor bay label in front of each basket slot
      const statusCss =
        primaryStatus === "EMPTY"
          ? "#22c55e"
          : primaryStatus === "PARTIAL"
          ? "#38bdf8"
          : primaryStatus === "NEAR_FULL"
          ? "#f59e0b"
          : "#f43f5e";
      const summaryTxt = slot.hasAnyCoil
        ? `L1:${Math.round(slot.layer1.usedWidthMm)} · L2:${Math.round(slot.layer2.usedWidthMm)}`
        : "EMPTY · 2000mm";
      const lblTex = createSlotFloorLabelTexture(
        slot.basketCode,
        statusCss,
        summaryTxt
      );
      this.dynamicTextures.push(lblTex);
      const lblMat = new THREE.MeshBasicMaterial({
        map: lblTex,
        transparent: true,
        opacity: dimmed ? 0.32 : 0.96,
      });
      this.dynamicMaterials.push(lblMat);
      const lblMesh = new THREE.Mesh(labelGeo, lblMat);
      lblMesh.rotation.x = -Math.PI / 2;
      lblMesh.position.set(
        slot.worldX,
        0.022,
        slot.worldZ + BASKET_OUTER_DEPTH_Z / 2 + 0.44
      );
      this.dynamicRoot.add(lblMesh);

      // Focus / Selected glowing ring on floor
      if (isFocused || isSelected) {
        const ringMat = new THREE.MeshBasicMaterial({
          color: isFocused ? 0xc084fc : 0x38bdf8,
          side: THREE.DoubleSide,
        });
        this.dynamicMaterials.push(ringMat);
        const ring = new THREE.Mesh(focusRingGeo, ringMat);
        ring.position.set(slot.worldX, 0.03, slot.worldZ);
        this.dynamicRoot.add(ring);
      }

      // Layer 1 base basket: always display the ground-level (Layer 1) blue basket by default
      // (empty blue basket when no coils yet, loaded with slit coils once stocked)
      const showLayer1 = f.layer !== "2";
      if (showLayer1) {
        const basketL1 = this.buildBlueBasketMeshGroup(
          slot.layer1,
          dimmed,
          isSelected && (f.selectedLayer === 1 || f.selectedLayer === null),
          isFocused
        );
        basketL1.position.set(slot.worldX, 0, slot.worldZ);
        // Rotate basket 90 deg so its front/perforated face faces across the building (แนวขวางของอาคาร)
        basketL1.rotation.y = Math.PI / 2;
        this.dynamicRoot.add(basketL1);
      }

      // Layer 2 stacked basket (interlocked onto Layer 1 corner pins, also rotated 90 deg across building)
      // Blue basket rule: never stack a loaded Layer 2 basket on top of an empty Layer 1 basket
      const showLayer2 =
        f.layer !== "1" && hasLayer1Work && slot.layer2.coils.length > 0;
      if (showLayer2) {
        const basketL2 = this.buildBlueBasketMeshGroup(
          slot.layer2,
          dimmed,
          isSelected && f.selectedLayer === 2,
          isFocused
        );
        basketL2.position.set(slot.worldX, BASKET_STACK_STEP_Y, slot.worldZ);
        basketL2.rotation.y = Math.PI / 2;
        this.dynamicRoot.add(basketL2);
      } else if (
        f.layer !== "1" &&
        hasLayer1Work &&
        f.previewLayer2BasketCode === slot.basketCode
      ) {
        // Preview wireframe when operator picks Layer 2 in Inbound stepper (only allowed when L1 has work)
        const ghostL2 = new THREE.Mesh(hitGeo, this.ghostLayer2Mat);
        ghostL2.position.set(
          slot.worldX,
          BASKET_STACK_STEP_Y + BASKET_HEIGHT_Y / 2,
          slot.worldZ
        );
        this.dynamicRoot.add(ghostL2);
      }

      // Proxy hitboxes for fast raycasting (Layer 1 always clickable; Layer 2 clickable when present)
      const hitL1 = new THREE.Mesh(hitGeo, invisibleHitMat);
      hitL1.position.set(slot.worldX, BASKET_HEIGHT_Y / 2, slot.worldZ);
      hitL1.userData = { slot, layer: 1 as const };
      this.dynamicRoot.add(hitL1);
      this.hitMeshes.push(hitL1);

      if (showLayer2) {
        const hitL2 = new THREE.Mesh(hitGeo, invisibleHitMat);
        hitL2.position.set(
          slot.worldX,
          BASKET_STACK_STEP_Y + BASKET_HEIGHT_Y / 2,
          slot.worldZ
        );
        hitL2.userData = { slot, layer: 2 as const };
        this.dynamicRoot.add(hitL2);
        this.hitMeshes.push(hitL2);
      }
    }

    // Clamp OrbitControls distance nicely to building footprint
    const maxSpan = Math.max(slabWidth, slabDepth);
    this.controls.maxDistance = Math.max(55, maxSpan * 2.1);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      this.rafId = window.requestAnimationFrame(tick);

      const dt = Math.min(this.clock.getDelta(), 0.05);

      if (this.isAnimatingCamera) {
        const lambda = 7.5;
        this.camera.position.x = THREE.MathUtils.damp(
          this.camera.position.x,
          this.targetCamPos.x,
          lambda,
          dt
        );
        this.camera.position.y = THREE.MathUtils.damp(
          this.camera.position.y,
          this.targetCamPos.y,
          lambda,
          dt
        );
        this.camera.position.z = THREE.MathUtils.damp(
          this.camera.position.z,
          this.targetCamPos.z,
          lambda,
          dt
        );
        this.controls.target.x = THREE.MathUtils.damp(
          this.controls.target.x,
          this.targetOrbitLook.x,
          lambda,
          dt
        );
        this.controls.target.y = THREE.MathUtils.damp(
          this.controls.target.y,
          this.targetOrbitLook.y,
          lambda,
          dt
        );
        this.controls.target.z = THREE.MathUtils.damp(
          this.controls.target.z,
          this.targetOrbitLook.z,
          lambda,
          dt
        );

        const dist =
          this.camera.position.distanceTo(this.targetCamPos) +
          this.controls.target.distanceTo(this.targetOrbitLook);
        if (dist < 0.06) {
          this.camera.position.copy(this.targetCamPos);
          this.controls.target.copy(this.targetOrbitLook);
          this.isAnimatingCamera = false;
        }
        this.needsRender = true;
      }

      const controlsUpdated = this.controls.update();
      if (controlsUpdated) {
        this.needsRender = true;
      }

      if (this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    const dom = this.renderer.domElement;
    dom.removeEventListener("pointerdown", this.onPointerDown);
    dom.removeEventListener("pointerup", this.onPointerUp);
    dom.removeEventListener("pointermove", this.onPointerMove);
    dom.removeEventListener("pointerleave", this.onPointerLeave);
    dom.removeEventListener("webglcontextlost", this.onContextLost);

    this.clearDynamicObjects();
    this.controls.dispose();
    this.envRenderTarget.dispose();
    this.pmremGenerator.dispose();

    for (const tex of this.sharedTextures) tex.dispose();
    this.basketBlueMat.dispose();
    this.basketBlueEmptyMat.dispose();
    this.basketBlueDimMat.dispose();
    this.basketPerforatedMat.dispose();
    this.basketVPlateMat.dispose();
    this.ghostLayer2Mat.dispose();
    Object.values(this.statusStripMats).forEach((m) => m.dispose());
    this.statusStripSelectedMat.dispose();
    this.statusStripFocusedMat.dispose();
    this.coilUnitGeo.dispose();
    this.coilMaterials.forEach((m) => m.dispose());
    this.coilPendingSapMat.dispose();

    this.mergedFrameGeo.dispose();
    this.mergedPerfGeo.dispose();
    this.mergedVPlateGeo.dispose();
    this.mergedStatusStripGeo.dispose();

    this.cradleSteelMat.dispose();
    this.cradleSteelDimMat.dispose();
    this.cradleWoodMat.dispose();
    this.cradleWoodDimMat.dispose();
    this.mergedCradleSteelGeo.dispose();
    this.mergedCradleWoodGeo.dispose();
    this.mergedCradleStatusGeo.dispose();

    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
