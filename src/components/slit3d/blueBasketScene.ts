import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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

function createHollowCoilUnitGeometry(): THREE.BufferGeometry {
  const outerR = 0.54;
  const innerR = 0.2;
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
  private basketBlueDimMat: THREE.MeshStandardMaterial;
  private basketPerforatedMat: THREE.MeshStandardMaterial;
  private basketVPlateMat: THREE.MeshStandardMaterial;
  private ghostLayer2Mat: THREE.MeshBasicMaterial;
  private coilUnitGeo: THREE.BufferGeometry;
  private coilMaterials: THREE.MeshStandardMaterial[];
  private coilPendingSapMat: THREE.MeshStandardMaterial;
  private floorConcreteTex: THREE.CanvasTexture;

  // Shared basket frame part geometries
  private postGeo: THREE.BoxGeometry;
  private pinGeo: THREE.CylinderGeometry;
  private collarGeo: THREE.CylinderGeometry;
  private lugGeo: THREE.CylinderGeometry;
  private baseRailXGeo: THREE.BoxGeometry;
  private baseRailZGeo: THREE.BoxGeometry;
  private subRibZGeo: THREE.BoxGeometry;
  private perfBarXGeo: THREE.BoxGeometry;
  private sideBarZGeo: THREE.BoxGeometry;
  private diagStrutGeo: THREE.BoxGeometry;
  private vPlateGeo: THREE.BoxGeometry;
  private footPadGeo: THREE.BoxGeometry;
  private statusStripGeo: THREE.BoxGeometry;

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
    this.scene.fog = new THREE.Fog(0x0f172a, 52, 130);

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
    this.sharedTextures.push(perfTex, wrapTex, this.floorConcreteTex);

    this.basketBlueMat = new THREE.MeshStandardMaterial({
      color: 0x1d63b8,
      roughness: 0.42,
      metalness: 0.36,
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

    // Shared procedural blue basket geometries (100% matching the 3 reference images)
    this.postGeo = new THREE.BoxGeometry(0.11, 1.24, 0.11);
    this.pinGeo = new THREE.CylinderGeometry(0.022, 0.048, 0.16, 12);
    this.collarGeo = new THREE.CylinderGeometry(0.064, 0.064, 0.06, 12);
    this.lugGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10);
    this.lugGeo.rotateZ(Math.PI / 2);
    this.baseRailXGeo = new THREE.BoxGeometry(BASKET_OUTER_WIDTH_X, 0.09, 0.09);
    this.baseRailZGeo = new THREE.BoxGeometry(0.09, 0.09, BASKET_OUTER_DEPTH_Z);
    this.subRibZGeo = new THREE.BoxGeometry(0.07, 0.075, BASKET_OUTER_DEPTH_Z - 0.16);
    this.perfBarXGeo = new THREE.BoxGeometry(BASKET_OUTER_WIDTH_X - 0.14, 0.085, 0.055);
    this.sideBarZGeo = new THREE.BoxGeometry(0.065, 0.065, BASKET_OUTER_DEPTH_Z - 0.12);
    this.diagStrutGeo = new THREE.BoxGeometry(0.065, 0.86, 0.065);
    this.vPlateGeo = new THREE.BoxGeometry(BASKET_INNER_WIDTH_X + 0.02, 0.04, 0.52);
    this.footPadGeo = new THREE.BoxGeometry(0.14, 0.06, 0.14);
    this.statusStripGeo = new THREE.BoxGeometry(BASKET_OUTER_WIDTH_X - 0.22, 0.045, 0.04);

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
    const slabW = this.currentLayout?.slabWidth || 30;
    const slabD = this.currentLayout?.slabDepth || 18;
    const span = Math.max(slabW, slabD);

    const look = new THREE.Vector3(0, 1.1, 0);
    const pos = new THREE.Vector3();

    switch (preset) {
      case "top":
        pos.set(0, span * 1.15, 0.01);
        break;
      case "front":
        pos.set(0, 6.5, slabD * 0.95 + 10);
        break;
      case "side":
        pos.set(slabW * 0.78 + 10, 8.5, 0);
        break;
      case "isometric":
      case "reset":
      default:
        pos.set(slabW * 0.48, Math.max(13, span * 0.44), slabD * 0.78 + 9);
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
    const frameMat = dimmed ? this.basketBlueDimMat : this.basketBlueMat;
    const perfMat = dimmed ? this.basketBlueDimMat : this.basketPerforatedMat;

    const halfX = BASKET_OUTER_WIDTH_X / 2 - 0.055;
    const halfZ = BASKET_OUTER_DEPTH_Z / 2 - 0.055;

    // 1. 4 Corner vertical square posts + conical stacking pins + lifting lugs
    const corners: [number, number][] = [
      [-halfX, -halfZ],
      [halfX, -halfZ],
      [-halfX, halfZ],
      [halfX, halfZ],
    ];
    for (const [cx, cz] of corners) {
      const foot = new THREE.Mesh(this.footPadGeo, frameMat);
      foot.position.set(cx, 0.03, cz);
      group.add(foot);

      const post = new THREE.Mesh(this.postGeo, frameMat);
      post.position.set(cx, 0.68, cz);
      if (!this.isSoftwareGl && !dimmed) {
        post.castShadow = true;
        post.receiveShadow = true;
      }
      group.add(post);

      const collar = new THREE.Mesh(this.collarGeo, frameMat);
      collar.position.set(cx, 1.31, cz);
      group.add(collar);

      const pin = new THREE.Mesh(this.pinGeo, frameMat);
      pin.position.set(cx, 1.4, cz);
      group.add(pin);

      const lug = new THREE.Mesh(this.lugGeo, frameMat);
      lug.position.set(cx, 1.24, cz);
      group.add(lug);
    }

    // 2. Bottom forklift perimeter frame (lower + upper base rails like photo 1 & 2)
    for (const yLevel of [0.09, 0.25]) {
      const frontRail = new THREE.Mesh(this.baseRailXGeo, frameMat);
      frontRail.position.set(0, yLevel, halfZ);
      group.add(frontRail);

      const backRail = new THREE.Mesh(this.baseRailXGeo, frameMat);
      backRail.position.set(0, yLevel, -halfZ);
      group.add(backRail);

      const leftRail = new THREE.Mesh(this.baseRailZGeo, frameMat);
      leftRail.position.set(-halfX, yLevel, 0);
      group.add(leftRail);

      const rightRail = new THREE.Mesh(this.baseRailZGeo, frameMat);
      rightRail.position.set(halfX, yLevel, 0);
      group.add(rightRail);
    }

    // 4 Base cross-ribs under the coil cradle
    for (const rx of [-0.72, -0.24, 0.24, 0.72]) {
      const rib = new THREE.Mesh(this.subRibZGeo, frameMat);
      rib.position.set(rx, 0.11, 0);
      group.add(rib);
    }

    // 3. Perforated horizontal side cross-bars (front & back, matching photo 1 & 2)
    const frontPerf = new THREE.Mesh(this.perfBarXGeo, perfMat);
    frontPerf.position.set(0, 1.04, halfZ);
    group.add(frontPerf);

    const backPerf = new THREE.Mesh(this.perfBarXGeo, perfMat);
    backPerf.position.set(0, 1.04, -halfZ);
    group.add(backPerf);

    // Mid-height end rails (left & right)
    for (const sx of [-halfX, halfX]) {
      const midRail = new THREE.Mesh(this.sideBarZGeo, frameMat);
      midRail.position.set(sx, 0.52, 0);
      group.add(midRail);

      // Diagonal V-bracing struts on both ends
      const strutFront = new THREE.Mesh(this.diagStrutGeo, frameMat);
      strutFront.position.set(sx, 0.66, 0.42);
      strutFront.rotation.x = 0.42;
      group.add(strutFront);

      const strutBack = new THREE.Mesh(this.diagStrutGeo, frameMat);
      strutBack.position.set(sx, 0.66, -0.42);
      strutBack.rotation.x = -0.42;
      group.add(strutBack);
    }

    // 4. Dark steel V-cradle inclined plates supporting the slit coils
    if (!dimmed) {
      const frontVPlate = new THREE.Mesh(this.vPlateGeo, this.basketVPlateMat);
      frontVPlate.position.set(0, 0.34, 0.34);
      frontVPlate.rotation.x = -0.46;
      group.add(frontVPlate);

      const backVPlate = new THREE.Mesh(this.vPlateGeo, this.basketVPlateMat);
      backVPlate.position.set(0, 0.34, -0.34);
      backVPlate.rotation.x = 0.46;
      group.add(backVPlate);
    }

    // 5. Capacity LED status strip on the front base rail
    const stripColor = isFocused
      ? 0xa855f7
      : isSelected
      ? 0x38bdf8
      : STATUS_COLORS[layerState.status];
    const stripMat = new THREE.MeshBasicMaterial({ color: stripColor });
    this.dynamicMaterials.push(stripMat);
    const strip = new THREE.Mesh(this.statusStripGeo, stripMat);
    strip.position.set(0, 0.25, halfZ + 0.055);
    group.add(strip);

    // 6. Slit steel coils seated horizontally inside V-cradle proportional to width (mm / 1000)
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
        coilMesh.position.set(cursorX + rawW / 2, 0.83, 0);
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

    // 1. Industrial Concrete Floor Slab
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

    // Safety yellow perimeter border on floor
    const borderPts = [
      new THREE.Vector3(-slabWidth / 2 + 0.6, 0.02, -slabDepth / 2 + 0.6),
      new THREE.Vector3(slabWidth / 2 - 0.6, 0.02, -slabDepth / 2 + 0.6),
      new THREE.Vector3(slabWidth / 2 - 0.6, 0.02, slabDepth / 2 - 0.6),
      new THREE.Vector3(-slabWidth / 2 + 0.6, 0.02, slabDepth / 2 - 0.6),
      new THREE.Vector3(-slabWidth / 2 + 0.6, 0.02, -slabDepth / 2 + 0.6),
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

    const gantryPostGeo = new THREE.BoxGeometry(0.24, 5.4, 0.24);
    const gantryBeamGeo = new THREE.BoxGeometry(slabWidth - 1.4, 0.28, 0.28);
    const gantryMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.6,
      metalness: 0.5,
    });
    this.dynamicGeometries.push(gantryPostGeo, gantryBeamGeo);
    this.dynamicMaterials.push(gantryMat);

    for (const gx of [-slabWidth / 2 + 0.8, slabWidth / 2 - 0.8]) {
      const p = new THREE.Mesh(gantryPostGeo, gantryMat);
      p.position.set(gx, 2.7, -slabDepth / 2 + 0.6);
      this.dynamicRoot.add(p);
    }
    const topBeam = new THREE.Mesh(gantryBeamGeo, gantryMat);
    topBeam.position.set(0, 5.4, -slabDepth / 2 + 0.6);
    this.dynamicRoot.add(topBeam);

    // 3. Row Header Badges (ROW A, ROW B, ROW C, ROW D...) on left aisle edge
    const rowBadgeGeo = new THREE.PlaneGeometry(1.75, 0.88);
    this.dynamicGeometries.push(rowBadgeGeo);
    for (const rp of layout.rowPositions) {
      const rTex = createRowBadgeTexture(rp.rowId);
      this.dynamicTextures.push(rTex);
      const rMat = new THREE.MeshBasicMaterial({ map: rTex });
      this.dynamicMaterials.push(rMat);
      const badge = new THREE.Mesh(rowBadgeGeo, rMat);
      badge.rotation.x = -Math.PI / 2;
      badge.position.set(-slabWidth / 2 + 2.05, 0.025, rp.worldZ);
      this.dynamicRoot.add(badge);
    }

    // 4. Shared Floor Slot Pad & Hitbox Geometries
    const padGeo = new THREE.PlaneGeometry(
      BASKET_OUTER_WIDTH_X + 0.14,
      BASKET_OUTER_DEPTH_Z + 0.14
    );
    const labelGeo = new THREE.PlaneGeometry(1.7, 0.62);
    const hitGeo = new THREE.BoxGeometry(
      BASKET_OUTER_WIDTH_X + 0.08,
      BASKET_HEIGHT_Y,
      BASKET_OUTER_DEPTH_Z + 0.08
    );
    const focusRingGeo = new THREE.RingGeometry(1.32, 1.54, 32);
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

      // Layer 1 basket: render solid blue steel basket whenever Layer 1 OR Layer 2 has coils,
      // OR render subtle empty blue frame outline if selected
      const showLayer1 =
        f.layer !== "2" &&
        (slot.layer1.coils.length > 0 || slot.layer2.coils.length > 0);
      if (showLayer1) {
        const basketL1 = this.buildBlueBasketMeshGroup(
          slot.layer1,
          dimmed,
          isSelected && (f.selectedLayer === 1 || f.selectedLayer === null),
          isFocused
        );
        basketL1.position.set(slot.worldX, 0, slot.worldZ);
        this.dynamicRoot.add(basketL1);
      } else if (
        f.layer !== "2" &&
        (isSelected || isFocused || f.previewLayer2BasketCode === slot.basketCode)
      ) {
        // Show translucent wireframe basket guide on Layer 1 when inspecting/targeting an empty bay
        const ghostBox = new THREE.Mesh(hitGeo, this.ghostLayer2Mat);
        ghostBox.position.set(slot.worldX, BASKET_HEIGHT_Y / 2, slot.worldZ);
        this.dynamicRoot.add(ghostBox);
      }

      // Layer 2 stacked basket (interlocked onto Layer 1 corner pins!)
      const showLayer2 = f.layer !== "1" && slot.layer2.coils.length > 0;
      if (showLayer2) {
        const basketL2 = this.buildBlueBasketMeshGroup(
          slot.layer2,
          dimmed,
          isSelected && f.selectedLayer === 2,
          isFocused
        );
        basketL2.position.set(slot.worldX, BASKET_STACK_STEP_Y, slot.worldZ);
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
    this.basketBlueDimMat.dispose();
    this.basketPerforatedMat.dispose();
    this.basketVPlateMat.dispose();
    this.ghostLayer2Mat.dispose();
    this.coilUnitGeo.dispose();
    this.coilMaterials.forEach((m) => m.dispose());
    this.coilPendingSapMat.dispose();

    this.postGeo.dispose();
    this.pinGeo.dispose();
    this.collarGeo.dispose();
    this.lugGeo.dispose();
    this.baseRailXGeo.dispose();
    this.baseRailZGeo.dispose();
    this.subRibZGeo.dispose();
    this.perfBarXGeo.dispose();
    this.sideBarZGeo.dispose();
    this.diagStrutGeo.dispose();
    this.vPlateGeo.dispose();
    this.footPadGeo.dispose();
    this.statusStripGeo.dispose();

    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
