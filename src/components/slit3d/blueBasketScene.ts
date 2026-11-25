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
  MAX_BASKET_WIDTH_MM,
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

function createBuildingSignTexture(buildingId: BlueBasketBuildingId): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  // Blue building badge
  ctx.fillStyle = "#1d63b8";
  ctx.fillRect(20, 20, 152, 120);
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 152, 120);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 66px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(buildingId, 96, 84);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 36px Inter, system-ui, sans-serif";
  ctx.fillText(`BUILDING ${buildingId} · BLUE BASKET ZONE`, 196, 62);

  ctx.fillStyle = "#7dd3fc";
  ctx.font = "700 24px Inter, system-ui, sans-serif";
  ctx.fillText("MAX WIDTH 2,000 mm / BASKET · MAX STACK 2 LAYERS", 196, 110);

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

function createRoadLabelTexture(buildingId: BlueBasketBuildingId): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 112;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(248, 250, 252, 0.78)";
  ctx.font = "900 36px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`EXTERIOR ROAD · อาคาร ${buildingId} (แนวแถว A–D)`, 384, 58);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createFrontFacadeSignTexture(buildingId: BlueBasketBuildingId): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(14, 14, 96, 84);
  ctx.fillStyle = "#0f172a";
  ctx.font = "900 46px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(buildingId, 62, 58);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 26px Inter, system-ui, sans-serif";
  ctx.fillText(`BUILDING ${buildingId} · ROW A–D`, 128, 44);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 19px Inter, system-ui, sans-serif";
  ctx.fillText("OUTDOOR ROAD ACCESS", 128, 80);

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
    this.scene.fog = new THREE.Fog(0x0f172a, 78, 185);

    // Metallic steel reflections via RoomEnvironment
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = this.pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    );
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.72;

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 260);
    this.camera.position.set(18, 16, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 85;
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

    // Shift look slightly toward -X so Row A-D labels + compact exterior road on the left edge are framed cleanly
    const look = new THREE.Vector3(-2.0, 1.1, 0);
    const pos = new THREE.Vector3();

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
    const targetY = layer === 2 ? BASKET_STACK_STEP_Y + 0.75 : 0.75;
    this.targetOrbitLook.set(slot.worldX, targetY, slot.worldZ);
    this.targetCamPos.set(
      slot.worldX + 3.4,
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
    if (f.row !== "ALL" && slot.rowId !== f.row) return false;
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

  private rebuildScene(): void {
    this.clearDynamicObjects();
    const layout = this.currentLayout;
    if (!layout) return;

    const { slabWidth, slabDepth, buildingId } = layout;

    // 0. Compact Exterior Industrial Site Ground Skirt (shifted slightly toward -X to cover road on Row A-D side)
    const siteGroundGeo = new THREE.PlaneGeometry(slabWidth + 24, slabDepth + 16);
    const siteGroundMat = new THREE.MeshStandardMaterial({
      color: 0x162030,
      roughness: 0.96,
      metalness: 0.04,
    });
    this.dynamicGeometries.push(siteGroundGeo);
    this.dynamicMaterials.push(siteGroundMat);
    const siteGround = new THREE.Mesh(siteGroundGeo, siteGroundMat);
    siteGround.rotation.x = -Math.PI / 2;
    siteGround.position.set(-3.2, -0.05, 0);
    this.dynamicRoot.add(siteGround);

    // 1. Industrial Concrete Floor Slab (Building Interior)
    const floorGeo = new THREE.PlaneGeometry(slabWidth, slabDepth);
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.floorConcreteTex,
      roughness: 0.88,
      metalness: 0.08,
    });
    this.dynamicGeometries.push(floorGeo);
    this.dynamicMaterials.push(floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = !this.isSoftwareGl;
    this.dynamicRoot.add(floor);

    // Building concrete foundation plinth edge so interior slab visibly stands apart from outdoor road
    const plinthGeo = new THREE.BoxGeometry(slabWidth + 0.28, 0.08, slabDepth + 0.28);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.85,
      metalness: 0.15,
    });
    this.dynamicGeometries.push(plinthGeo);
    this.dynamicMaterials.push(plinthMat);
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(0, -0.045, 0);
    this.dynamicRoot.add(plinth);

    // Safety yellow perimeter border inside the building floor
    const borderPts = [
      new THREE.Vector3(-slabWidth / 2 + 0.55, 0.02, -slabDepth / 2 + 0.55),
      new THREE.Vector3(slabWidth / 2 - 0.55, 0.02, -slabDepth / 2 + 0.55),
      new THREE.Vector3(slabWidth / 2 - 0.55, 0.02, slabDepth / 2 - 0.55),
      new THREE.Vector3(-slabWidth / 2 + 0.55, 0.02, slabDepth / 2 - 0.55),
      new THREE.Vector3(-slabWidth / 2 + 0.55, 0.02, -slabDepth / 2 + 0.55),
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
    const borderMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
    this.dynamicGeometries.push(borderGeo);
    this.dynamicMaterials.push(borderMat);
    this.dynamicRoot.add(new THREE.Line(borderGeo, borderMat));

    // 2. Overhead Building Signboard Gantry at Back Edge (-Z)
    const signTex = createBuildingSignTexture(buildingId);
    this.dynamicTextures.push(signTex);
    const signGeo = new THREE.PlaneGeometry(8.8, 1.85);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    this.dynamicGeometries.push(signGeo);
    this.dynamicMaterials.push(signMat);
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.set(0, 4.4, -slabDepth / 2 + 0.7);
    this.dynamicRoot.add(signMesh);

    const gantryPostGeo = new THREE.BoxGeometry(0.26, 5.4, 0.26);
    const gantryBeamGeo = new THREE.BoxGeometry(slabWidth - 0.8, 0.28, 0.28);
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
    this.dynamicGeometries.push(
      gantryPostGeo,
      gantryBeamGeo,
      sideHeaderBeamGeo,
      safetyPostGeo
    );
    this.dynamicMaterials.push(gantryMat, safetyPostMat);

    for (const gx of [-slabWidth / 2 + 0.5, slabWidth / 2 - 0.5]) {
      const p = new THREE.Mesh(gantryPostGeo, gantryMat);
      p.position.set(gx, 2.7, -slabDepth / 2 + 0.5);
      this.dynamicRoot.add(p);
    }
    const topBeam = new THREE.Mesh(gantryBeamGeo, gantryMat);
    topBeam.position.set(0, 5.4, -slabDepth / 2 + 0.5);
    this.dynamicRoot.add(topBeam);

    // 2B. Building Entrance Portal along Row A–D Side (-X edge, separating building interior from exterior road)
    const roadEdgeX = -slabWidth / 2;
    const portalColumnsZ = [-slabDepth / 2 + 0.5, slabDepth / 2 - 0.5];
    for (const pz of portalColumnsZ) {
      const col = new THREE.Mesh(gantryPostGeo, gantryMat);
      col.position.set(roadEdgeX, 2.7, pz);
      this.dynamicRoot.add(col);
    }
    const sideHeaderBeam = new THREE.Mesh(sideHeaderBeamGeo, gantryMat);
    sideHeaderBeam.position.set(roadEdgeX, 5.4, 0);
    this.dynamicRoot.add(sideHeaderBeam);

    // Exterior fascia sign on the Row A–D entrance portal facing outward toward the road (-X)
    const frontSignTex = createFrontFacadeSignTexture(buildingId);
    this.dynamicTextures.push(frontSignTex);
    const frontSignGeo = new THREE.PlaneGeometry(5.6, 1.2);
    const frontSignMat = new THREE.MeshBasicMaterial({
      map: frontSignTex,
      side: THREE.DoubleSide,
    });
    this.dynamicGeometries.push(frontSignGeo);
    this.dynamicMaterials.push(frontSignMat);
    const frontSignMesh = new THREE.Mesh(frontSignGeo, frontSignMat);
    frontSignMesh.rotation.y = -Math.PI / 2;
    frontSignMesh.position.set(roadEdgeX - 0.18, 4.95, 0);
    this.dynamicRoot.add(frontSignMesh);

    // 2C. Compact Exterior Sidewalk / Apron & Slim Outdoor Asphalt Road OUTSIDE the Row A–D Edge (-X)
    const apronWidth = 1.25;
    const roadWidth = 4.6; // Compact slim exterior road
    const roadLength = slabDepth + 8.5;
    const apronCenterX = roadEdgeX - apronWidth / 2;
    const roadCenterX = roadEdgeX - apronWidth - roadWidth / 2;

    // Exterior concrete apron/threshold between building edge and outdoor road
    const apronGeo = new THREE.PlaneGeometry(apronWidth, roadLength);
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.9,
      metalness: 0.06,
    });
    this.dynamicGeometries.push(apronGeo);
    this.dynamicMaterials.push(apronMat);
    const apronMesh = new THREE.Mesh(apronGeo, apronMat);
    apronMesh.rotation.x = -Math.PI / 2;
    apronMesh.position.set(apronCenterX, -0.012, 0);
    this.dynamicRoot.add(apronMesh);

    // Outer concrete road curb along the far side of the road + short curbs & yellow safety bollards at building ends
    const farCurbGeo = new THREE.BoxGeometry(0.22, 0.12, roadLength);
    const endCurbLen = 3.2;
    const nearEndCurbGeo = new THREE.BoxGeometry(0.22, 0.12, endCurbLen);
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.85,
      metalness: 0.08,
    });
    this.dynamicGeometries.push(farCurbGeo, nearEndCurbGeo);
    this.dynamicMaterials.push(curbMat);

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

    // Compact Outdoor Asphalt Road running parallel along the Row A–D badges (outside the building!)
    const roadGeo = new THREE.PlaneGeometry(roadLength, roadWidth);
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.exteriorRoadTex,
      roughness: 0.92,
      metalness: 0.05,
    });
    this.dynamicGeometries.push(roadGeo);
    this.dynamicMaterials.push(roadMat);
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.rotation.z = Math.PI / 2;
    roadMesh.position.set(roadCenterX, -0.02, 0);
    roadMesh.receiveShadow = !this.isSoftwareGl;
    this.dynamicRoot.add(roadMesh);

    // Compact road label painted parallel along the outer shoulder of the exterior road
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

    // 3. Row Header Badges (ROW A, ROW B, ROW C, ROW D...) right along the -X road-facing edge
    const rowBadgeGeo = new THREE.PlaneGeometry(1.75, 0.88);
    this.dynamicGeometries.push(rowBadgeGeo);
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
      const primaryStatus: BasketLayerStatus =
        slot.layer2.status !== "EMPTY"
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
      const showLayer2 = f.layer !== "1" && slot.layer2.coils.length > 0;
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
        f.previewLayer2BasketCode === slot.basketCode
      ) {
        // Preview wireframe when operator picks Layer 2 in Inbound stepper
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

    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
