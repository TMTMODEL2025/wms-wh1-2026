import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  BuildingLayoutResult,
  COIL_INNER_RADIUS,
  COIL_OUTER_RADIUS,
  COIL_WIDTH,
  DOOR_GAP_X,
  ROW_SPACING_X,
  SADDLE_HEIGHT,
  WarehouseSlot3D,
  SlotVisualStatus,
} from "./coilWarehouseLayout";

export type CameraPreset = "isometric" | "top" | "front" | "side" | "reset";

export interface SceneFilterState {
  door: string; // "ALL" or door code
  row: string; // "ALL" or numeric string
  level: string; // "ALL" or numeric string
  onlyPendingSap: boolean;
  selectedSlotKey: string | null;
  focusedSlotKey: string | null;
}

export interface SceneCallbacks {
  onSelectSlot: (slot: WarehouseSlot3D | null) => void;
  onWebGLContextError?: (message: string) => void;
}

const STATUS_HEX: Record<SlotVisualStatus, number> = {
  EMPTY: 0x22c55e,
  OCCUPIED: 0x3b82f6,
  RESERVED: 0xf97316,
  BLOCKED: 0xef4444,
  FOCUS: 0xa855f7,
  PENDING_SAP: 0xf59e0b,
};

const COIL_BODY_HEX: Record<SlotVisualStatus, number> = {
  EMPTY: 0x94a3b8,
  OCCUPIED: 0xdbe4f0, // Brushed bright industrial steel
  RESERVED: 0xfdba74, // Warm orange-tinted steel
  BLOCKED: 0xfca5a5, // Red-tinted steel
  FOCUS: 0xe9d5ff, // Purple-illuminated steel
  PENDING_SAP: 0xfde68a, // Amber-gold steel (matches pending SAP highlight)
};

const DIMMED_HEX = 0x334155;

function detectSoftwareWebGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (!dbg) return false;
    const rendererName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
    return /swiftshader|llvmpipe|software|mesa|basic render/i.test(rendererName);
  } catch {
    return false;
  }
}

/**
 * Generates a high-contrast industrial door signage texture (zero external assets).
 */
function createDoorSignTexture(doorCode: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 176;
  const ctx = canvas.getContext("2d")!;

  // Dark metallic signboard body
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer industrial silver frame
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  // Bottom safety amber strip
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(10, canvas.height - 16, canvas.width - 20, 8);

  // Left bright blue door code box
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(22, 24, 132, 114);
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 24, 132, 114);

  // Door code text
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 62px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(doorCode, 88, 84);

  // Right industrial door description
  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 32px Inter, system-ui, sans-serif";
  ctx.fillText(`WAREHOUSE DOOR ${doorCode}`, 176, 62);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText("STEEL COIL STORAGE BAY", 176, 108);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Generates procedural brushed concrete floor with forklift road lane & safety lines.
 */
function createWarehouseFloorTexture(
  slabWidth: number,
  slabDepth: number,
  doors: string[],
  rowCount: number
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;

  // Base industrial concrete
  ctx.fillStyle = "#4d586b";
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle concrete grid expansion joints
  ctx.strokeStyle = "rgba(15, 23, 42, 0.24)";
  ctx.lineWidth = 2;
  for (let i = 64; i < 1024; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }

  // Subtle mottled aggregate speckle
  for (let i = 0; i < 900; i++) {
    const px = ((i * 7919) % 1024);
    const py = ((i * 4421) % 1024);
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.045)";
    ctx.fillRect(px, py, 5, 5);
  }

  // Front forklift/truck drive lane (bottom portion in UV = +Z front of slab)
  const laneRatio = Math.min(0.26, 6.0 / slabDepth);
  const laneTopY = Math.round(1024 * (1 - laneRatio));
  const laneBottomY = 1024 - 44;
  const laneMidY = Math.round((laneTopY + laneBottomY) / 2);

  // Yellow safety perimeter border (with clean openings at left & right road entrances)
  ctx.strokeStyle = "#eab308";
  ctx.lineWidth = 8;
  ctx.beginPath();
  // Top back edge
  ctx.moveTo(24, 24);
  ctx.lineTo(1024 - 24, 24);
  // Left wall edge above road
  ctx.moveTo(24, 24);
  ctx.lineTo(24, laneTopY);
  // Right wall edge above road
  ctx.moveTo(1024 - 24, 24);
  ctx.lineTo(1024 - 24, laneTopY);
  // Front curb edge below road
  ctx.moveTo(24, 1024 - 20);
  ctx.lineTo(1024 - 24, 1024 - 20);
  ctx.stroke();

  // Darker asphalt-concrete drive aisle extending cleanly through both road entrances
  ctx.fillStyle = "#3f495b";
  ctx.fillRect(0, laneTopY, 1024, laneBottomY - laneTopY);

  // Solid white lane borders extending to both road entrances
  ctx.strokeStyle = "rgba(226, 232, 240, 0.88)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, laneTopY + 4);
  ctx.lineTo(1024, laneTopY + 4);
  ctx.moveTo(0, laneBottomY - 4);
  ctx.lineTo(1024, laneBottomY - 4);
  ctx.stroke();

  // Dashed white road centerline spanning from left entrance to right entrance
  ctx.setLineDash([28, 22]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(241, 245, 249, 0.9)";
  ctx.beginPath();
  ctx.moveTo(12, laneMidY);
  ctx.lineTo(1024 - 12, laneMidY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Door zone divider line if dual-door
  if (doors.length >= 2) {
    ctx.strokeStyle = "rgba(234, 179, 8, 0.65)";
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 14]);
    ctx.beginPath();
    ctx.moveTo(512, 34);
    ctx.lineTo(512, laneTopY - 8);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Painted door zone stenciled labels in drive lane
  ctx.fillStyle = "rgba(226, 232, 240, 0.25)";
  ctx.font = "900 44px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (doors.length >= 2) {
    ctx.fillText(`ZONE ${doors[0]}`, 270, laneMidY);
    ctx.fillText(`ZONE ${doors[1]}`, 754, laneMidY);
  } else if (doors.length === 1) {
    ctx.fillText(`ZONE ${doors[0]}`, 512, laneMidY);
  }

  // Row index markings painted cleanly along the road edge in front of each row
  ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
  ctx.font = "800 17px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rowLabelY = laneTopY - 14;
  const doorZoneWidthX = rowCount * ROW_SPACING_X;

  const worldXToPx = (wx: number) => ((wx + slabWidth / 2) / slabWidth) * 1024;

  if (doors.length >= 2) {
    const leftStartX = -DOOR_GAP_X / 2 - doorZoneWidthX + ROW_SPACING_X / 2;
    const rightStartX = DOOR_GAP_X / 2 + ROW_SPACING_X / 2;
    for (let r = 1; r <= rowCount; r++) {
      const lx = worldXToPx(leftStartX + (r - 1) * ROW_SPACING_X);
      const rx = worldXToPx(rightStartX + (r - 1) * ROW_SPACING_X);
      ctx.fillText(`R${r}`, lx, rowLabelY);
      ctx.fillText(`R${r}`, rx, rowLabelY);
    }
  } else {
    const startX = -doorZoneWidthX / 2 + ROW_SPACING_X / 2;
    for (let r = 1; r <= rowCount; r++) {
      const cx = worldXToPx(startX + (r - 1) * ROW_SPACING_X);
      ctx.fillText(`R${r}`, cx, rowLabelY);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Generates brushed wound-steel texture for realistic metallic coils.
 */
function createSteelCoilTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#cfd8e3";
  ctx.fillRect(0, 0, 256, 256);

  // Fine metallic brushed horizontal grain
  for (let y = 0; y < 256; y += 2) {
    const shade = 192 + Math.round(Math.sin(y * 0.35) * 18 + ((y * 37) % 14));
    ctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 10})`;
    ctx.fillRect(0, y, 256, 2);
  }

  // Subtle coil lap seam lines
  ctx.strokeStyle = "rgba(51, 65, 85, 0.28)";
  ctx.lineWidth = 2;
  for (let i = 1; i <= 5; i++) {
    const y = Math.round((i / 6) * 256);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Builds a hollow extruded steel coil BufferGeometry centered at origin with bore along Z.
 */
function createHollowCoilGeometry(
  outerR: number,
  innerR: number,
  width: number,
  curveSegments: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments,
  });
  geom.translate(0, 0, -width / 2);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds an annular status collar ring sitting flush on both circular ends of a coil.
 */
function createCoilCollarGeometry(
  outerR: number,
  innerR: number,
  coilWidth: number,
  curveSegments: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: coilWidth + 0.065,
    bevelEnabled: false,
    curveSegments,
  });
  geom.translate(0, 0, -(coilWidth + 0.065) / 2);
  geom.computeVertexNormals();
  return geom;
}

export class CoilWarehouseSceneEngine {
  private container: HTMLElement;
  private callbacks: SceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pmremGenerator: THREE.PMREMGenerator;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private isSoftwareGl: boolean;

  private structureGroup = new THREE.Group();
  private dynamicGroup = new THREE.Group();
  private craneGroup = new THREE.Group();
  private craneBridgeGroup = new THREE.Group();
  private craneTrolleyGroup = new THREE.Group();
  private craneHoistGroup = new THREE.Group();
  private focusMarkerGroup = new THREE.Group();

  // Pickable instanced meshes + lookup tables
  private coilBodyInstanced: THREE.InstancedMesh | null = null;
  private coilCollarInstanced: THREE.InstancedMesh | null = null;
  private coilStrapInstanced: THREE.InstancedMesh | null = null;
  private saddleBaseInstanced: THREE.InstancedMesh | null = null;
  private saddleChockInstanced: THREE.InstancedMesh | null = null;

  private occupiedSlotList: WarehouseSlot3D[] = [];
  private floorSlotList: WarehouseSlot3D[] = [];

  // Shared persistent geometries/textures
  private coilGeom: THREE.BufferGeometry;
  private collarGeom: THREE.BufferGeometry;
  private strapGeom: THREE.BufferGeometry;
  private saddleBaseGeom: THREE.BufferGeometry;
  private saddleChockGeom: THREE.BufferGeometry;
  private steelTexture: THREE.CanvasTexture;

  private currentLayout: BuildingLayoutResult | null = null;
  private currentFilter: SceneFilterState = {
    door: "ALL",
    row: "ALL",
    level: "ALL",
    onlyPendingSap: false,
    selectedSlotKey: null,
    focusedSlotKey: null,
  };

  // Animation & on-demand render loop state
  private disposed = false;
  private renderPending = false;
  private rafId: number | null = null;
  private craneDemoActive = false;
  private cranePhase = 0;
  private lastTickTime = 0;
  private currentSlabWidth = 42;
  private currentSlabDepth = 28;

  // Smooth camera tween
  private camTween: {
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    startTime: number;
    durationMs: number;
  } | null = null;

  // Pointer picking state
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private lastHoverCheck = 0;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    // 1. Renderer setup with Software WebGL detection
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.isSoftwareGl = detectSoftwareWebGL(this.renderer);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.isSoftwareGl ? 1 : 2)
    );
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.outline = "none";
    container.innerHTML = "";
    container.appendChild(canvas);
    requestAnimationFrame(() => this.handleResize());

    // 2. Scene, atmosphere, and IBL RoomEnvironment
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1324);
    this.scene.fog = new THREE.Fog(0x0b1324, 95, 250);

    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.65;

    // 3. Camera & OrbitControls
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.3, 460);
    this.camera.position.set(27, 20, 31);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 165;
    this.controls.target.set(0, 1.8, 0);
    this.controls.update();

    // 4. Studio + Industrial Three-Point Lighting
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.45);
    keyLight.position.set(28, 42, 30);
    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.near = 5;
      keyLight.shadow.camera.far = 180;
      const d = 48;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0004;
      keyLight.shadow.normalBias = 0.03;
    }
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.55);
    rimLight.position.set(-28, 20, -24);
    this.scene.add(rimLight);

    // Exterior horizon industrial apron ground plane (matches reference image)
    const groundGeo = new THREE.PlaneGeometry(480, 480);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3b4454,
      roughness: 0.94,
      metalness: 0.04,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.26;
    ground.receiveShadow = !this.isSoftwareGl;
    this.scene.add(ground);

    // Scene containers
    this.scene.add(this.structureGroup);
    this.scene.add(this.dynamicGroup);
    this.scene.add(this.craneGroup);
    this.scene.add(this.focusMarkerGroup);

    // 5. Shared procedural coil & saddle geometries
    const segs = this.isSoftwareGl ? 18 : 28;
    this.steelTexture = createSteelCoilTexture();
    this.coilGeom = createHollowCoilGeometry(
      COIL_OUTER_RADIUS,
      COIL_INNER_RADIUS,
      COIL_WIDTH,
      segs
    );
    this.collarGeom = createCoilCollarGeometry(
      COIL_INNER_RADIUS + 0.13,
      COIL_INNER_RADIUS + 0.015,
      COIL_WIDTH,
      segs
    );
    // Steel strapping band around coil circumference
    this.strapGeom = new THREE.CylinderGeometry(
      COIL_OUTER_RADIUS + 0.014,
      COIL_OUTER_RADIUS + 0.014,
      0.08,
      segs,
      1,
      true
    );
    this.strapGeom.rotateX(Math.PI / 2);

    this.saddleBaseGeom = new THREE.BoxGeometry(1.18, SADDLE_HEIGHT * 0.55, 1.18);
    this.saddleChockGeom = new THREE.BoxGeometry(0.18, SADDLE_HEIGHT * 0.85, 1.12);

    // Build reusable Focus Beacon Marker (purple industrial brackets, zero pulsing dots)
    this.buildFocusMarker();

    // 6. Event bindings
    this.controls.addEventListener("change", this.handleControlsChange);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.requestRender();
  }

  private buildFocusMarker() {
    this.focusMarkerGroup.visible = false;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.92,
    });

    // Crisp purple wireframe-style frame box matching road-facing rotated coil
    const boxEdges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(
        COIL_WIDTH * 1.28,
        COIL_OUTER_RADIUS * 2.35,
        COIL_OUTER_RADIUS * 2.35
      )
    );
    const frameLines = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0xc084fc })
    );
    this.focusMarkerGroup.add(frameLines);

    // Bottom glowing purple indicator ring
    const ringGeo = new THREE.RingGeometry(0.72, 0.88, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeo, mat);
    ringMesh.position.y = -(COIL_OUTER_RADIUS + SADDLE_HEIGHT * 0.6);
    this.focusMarkerGroup.add(ringMesh);
  }

  private disposeGroupChildren(group: THREE.Group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          // Do not dispose shared persistent geometries
          if (
            obj.geometry !== this.coilGeom &&
            obj.geometry !== this.collarGeom &&
            obj.geometry !== this.strapGeom &&
            obj.geometry !== this.saddleBaseGeom &&
            obj.geometry !== this.saddleChockGeom
          ) {
            obj.geometry?.dispose();
          }
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (!m) return;
            const std = m as THREE.MeshStandardMaterial;
            if (std.map && std.map !== this.steelTexture) {
              std.map.dispose();
            }
            m.dispose();
          });
        }
      });
    }
  }

  /**
   * Rebuilds warehouse structural bay, doors, floor slab, crane, saddles, and coils.
   */
  public setLayout(layout: BuildingLayoutResult, filter: SceneFilterState) {
    const structureChanged =
      !this.currentLayout ||
      this.currentLayout.group.id !== layout.group.id ||
      this.currentLayout.group.slabWidth !== layout.group.slabWidth ||
      this.currentLayout.group.slabDepth !== layout.group.slabDepth ||
      this.currentLayout.rows.length !== layout.rows.length;

    this.currentLayout = layout;
    this.currentFilter = filter;

    if (structureChanged) {
      this.currentSlabWidth = layout.group.slabWidth;
      this.currentSlabDepth = layout.group.slabDepth;
      this.rebuildStructureAndCrane(layout);
    }

    this.rebuildCoilsAndSaddles(layout, filter);
    this.updateFocusMarker(layout, filter);
    this.requestRender();
  }

  public setFilter(filter: SceneFilterState) {
    this.currentFilter = filter;
    if (!this.currentLayout) return;
    this.applyInstanceColors(this.currentLayout, filter);
    this.updateFocusMarker(this.currentLayout, filter);
    this.requestRender();
  }

  public setCraneDemo(enabled: boolean) {
    this.craneDemoActive = enabled;
    if (enabled) {
      this.lastTickTime = performance.now();
      this.startLoopIfNeeded();
    }
    this.requestRender();
  }

  public applyCameraPreset(preset: CameraPreset) {
    const w = this.currentSlabWidth;
    const d = this.currentSlabDepth;
    const maxSpan = Math.max(w, d);

    let endPos: THREE.Vector3;
    let endTarget = new THREE.Vector3(0, 1.4, 0);

    switch (preset) {
      case "top":
        endPos = new THREE.Vector3(0, maxSpan * 1.18, 0.01);
        endTarget = new THREE.Vector3(0, 0, 0);
        break;
      case "front":
        endPos = new THREE.Vector3(0, 8.5, d * 0.95 + 14);
        endTarget = new THREE.Vector3(0, 2.2, 0);
        break;
      case "side":
        endPos = new THREE.Vector3(w * 0.9 + 14, 7.2, 2.5);
        endTarget = new THREE.Vector3(0, 2.0, -1.5);
        break;
      case "reset":
      case "isometric":
      default:
        endPos = new THREE.Vector3(w * 0.62, maxSpan * 0.46, d * 0.85 + 7);
        endTarget = new THREE.Vector3(0, 1.6, 0.5);
        break;
    }

    this.animateCameraTo(endPos, endTarget, 620);
  }

  public focusOnSlot(slot: WarehouseSlot3D) {
    const target = new THREE.Vector3(slot.x, slot.y, slot.z);
    const camPos = new THREE.Vector3(slot.x + 5.8, slot.y + 4.4, slot.z + 7.2);
    this.animateCameraTo(camPos, target, 680);
  }

  private animateCameraTo(
    endPos: THREE.Vector3,
    endTarget: THREE.Vector3,
    durationMs: number
  ) {
    this.camTween = {
      startPos: this.camera.position.clone(),
      endPos: endPos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: endTarget.clone(),
      startTime: performance.now(),
      durationMs,
    };
    this.startLoopIfNeeded();
  }

  private rebuildStructureAndCrane(layout: BuildingLayoutResult) {
    this.disposeGroupChildren(this.structureGroup);
    this.disposeGroupChildren(this.craneGroup);

    const W = layout.group.slabWidth;
    const D = layout.group.slabDepth;
    const bayH = 10.2;
    const railY = 8.0;

    // 1. Concrete Warehouse Slab
    const floorTex = createWarehouseFloorTexture(
      W,
      D,
      layout.doors,
      layout.rows.length
    );
    const slabTopMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.86,
      metalness: 0.06,
    });
    const slabSideMat = new THREE.MeshStandardMaterial({
      color: 0x2c3648,
      roughness: 0.9,
      metalness: 0.1,
    });

    const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(W, 0.28, D), [
      slabSideMat,
      slabSideMat,
      slabTopMat,
      slabSideMat,
      slabSideMat,
      slabSideMat,
    ]);
    slabMesh.position.y = -0.14;
    slabMesh.receiveShadow = !this.isSoftwareGl;
    this.structureGroup.add(slabMesh);

    // 2. Structural Steel Columns along Left (-X) & Right (+X) edges of the bay
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x1e2c44,
      roughness: 0.45,
      metalness: 0.65,
    });
    const safetyYellowMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.42,
      metalness: 0.28,
    });
    const craneYellowMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.36,
      metalness: 0.42,
    });

    const colSpanX = W / 2 - 1.1;
    const laneRatio = Math.min(0.26, 6.0 / D);
    const laneTopFrac = 1 - laneRatio;
    const laneBottomFrac = (1024 - 44) / 1024;
    const roadMinZ = -D / 2 + laneTopFrac * D;
    const roadMaxZ = -D / 2 + laneBottomFrac * D;
    const roadCenterZ = (roadMinZ + roadMaxZ) / 2;
    const roadWidth = roadMaxZ - roadMinZ;

    // Columns along storage bay depth + front corner column clear of road opening
    const storageColStartZ = -D / 2 + 1.2;
    const storageColEndZ = roadMinZ - 0.55;
    const storageColSpanZ = Math.max(4, storageColEndZ - storageColStartZ);
    const storageColCount = Math.max(4, Math.round(storageColSpanZ / 4.8) + 1);
    const frontCornerColZ = D / 2 - 0.55;

    const colGeo = new THREE.BoxGeometry(0.42, bayH, 0.42);
    const baseGuardGeo = new THREE.BoxGeometry(0.62, 0.95, 0.62);
    const corbelGeo = new THREE.BoxGeometry(0.65, 0.35, 0.44);

    const colZList: number[] = [];
    for (let i = 0; i < storageColCount; i++) {
      const t = i / (storageColCount - 1);
      colZList.push(storageColStartZ + t * storageColSpanZ);
    }
    colZList.push(frontCornerColZ);

    const beamLengthZ = frontCornerColZ - storageColStartZ + 0.5;
    const beamCenterZ = (storageColStartZ + frontCornerColZ) / 2;

    for (const side of [-1, 1]) {
      const colX = side * colSpanX;
      for (const colZ of colZList) {
        const col = new THREE.Mesh(colGeo, steelMat);
        col.position.set(colX, bayH / 2, colZ);
        col.castShadow = !this.isSoftwareGl;
        this.structureGroup.add(col);

        // Safety yellow bumper guard at column base
        const guard = new THREE.Mesh(baseGuardGeo, safetyYellowMat);
        guard.position.set(colX, 0.475, colZ);
        this.structureGroup.add(guard);

        // Corbel bracket supporting crane runway girder
        const corbel = new THREE.Mesh(corbelGeo, steelMat);
        corbel.position.set(colX - side * 0.42, railY - 0.32, colZ);
        this.structureGroup.add(corbel);
      }

      // Top longitudinal eave girder
      const eaveBeam = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.36, beamLengthZ),
        steelMat
      );
      eaveBeam.position.set(colX, bayH - 0.18, beamCenterZ);
      this.structureGroup.add(eaveBeam);

      // Mid tie rail along storage zone only (leaves road doorway completely unobstructed)
      const midRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.2, storageColSpanZ),
        steelMat
      );
      midRail.position.set(
        colX,
        bayH * 0.56,
        (storageColStartZ + storageColEndZ) / 2
      );
      this.structureGroup.add(midRail);

      // Longitudinal YELLOW crane runway girder
      const runway = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.58, beamLengthZ),
        craneYellowMat
      );
      runway.position.set(colX - side * 0.58, railY, beamCenterZ);
      runway.castShadow = !this.isSoftwareGl;
      this.structureGroup.add(runway);
    }

    // Back gable truss header
    const backHeader = new THREE.Mesh(
      new THREE.BoxGeometry(W - 2.0, 0.38, 0.34),
      steelMat
    );
    backHeader.position.set(0, bayH - 0.18, storageColStartZ);
    this.structureGroup.add(backHeader);

    // 3. Blue Industrial Door Portals at Left (-X) and Right (+X) road entrances
    // Left entrance (-X) = doors[0] (e.g. E7, H7, 05, 21)
    // Right entrance (+X) = doors[1] (e.g. E8, H8)
    const doorPortalBlueMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.38,
      metalness: 0.35,
    });
    const portalConfigs: Array<{ doorCode: string; x: number; rotY: number }> =
      layout.doors.length >= 2
        ? [
            { doorCode: layout.doors[0], x: -colSpanX, rotY: Math.PI / 2 },
            { doorCode: layout.doors[1], x: colSpanX, rotY: -Math.PI / 2 },
          ]
        : [{ doorCode: layout.doors[0] || "05", x: -colSpanX, rotY: Math.PI / 2 }];

    const portalW = Math.max(4.6, roadWidth + 0.25);
    const portalH = 4.05;

    portalConfigs.forEach(({ doorCode, x, rotY }) => {
      const portalGroup = new THREE.Group();
      portalGroup.position.set(x, 0, roadCenterZ);
      portalGroup.rotation.y = rotY;

      // Left & Right blue steel portal legs framing the road lane
      const legGeo = new THREE.BoxGeometry(0.46, portalH, 0.56);
      const leftLeg = new THREE.Mesh(legGeo, doorPortalBlueMat);
      leftLeg.position.set(-portalW / 2, portalH / 2, 0);
      leftLeg.castShadow = !this.isSoftwareGl;
      portalGroup.add(leftLeg);

      const rightLeg = new THREE.Mesh(legGeo, doorPortalBlueMat);
      rightLeg.position.set(portalW / 2, portalH / 2, 0);
      rightLeg.castShadow = !this.isSoftwareGl;
      portalGroup.add(rightLeg);

      // Blue lintel header spanning over road
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(portalW + 0.85, 0.58, 0.68),
        doorPortalBlueMat
      );
      lintel.position.set(0, portalH + 0.14, 0);
      lintel.castShadow = !this.isSoftwareGl;
      portalGroup.add(lintel);

      // Protective yellow bollards flanking both sides of doorway approach
      const bollardGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.95, 12);
      for (const s of [-1, 1]) {
        const outerBollard = new THREE.Mesh(bollardGeo, safetyYellowMat);
        outerBollard.position.set(s * (portalW / 2 - 0.12), 0.475, -0.58);
        portalGroup.add(outerBollard);

        const innerBollard = new THREE.Mesh(bollardGeo, safetyYellowMat);
        innerBollard.position.set(s * (portalW / 2 - 0.12), 0.475, 0.58);
        portalGroup.add(innerBollard);
      }

      // Illuminated Door Signage Board (readable from both outside and inside)
      const signTex = createDoorSignTexture(doorCode);
      const signFrontMat = new THREE.MeshStandardMaterial({
        map: signTex,
        roughness: 0.32,
        metalness: 0.2,
        emissive: new THREE.Color(0x1e293b),
        emissiveIntensity: 0.35,
      });
      const signBox = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.18, 0.24), [
        steelMat,
        steelMat,
        steelMat,
        steelMat,
        signFrontMat,
        signFrontMat,
      ]);
      signBox.position.set(0, portalH + 0.96, 0);
      portalGroup.add(signBox);

      this.structureGroup.add(portalGroup);
    });

    // 4. Overhead Double-Girder Yellow Bridge Crane (composite multi-part model)
    this.craneBridgeGroup = new THREE.Group();
    this.craneTrolleyGroup = new THREE.Group();
    this.craneHoistGroup = new THREE.Group();

    const bridgeSpanX = (colSpanX - 0.58) * 2;
    const bridgeY = railY + 0.64;

    // Twin main yellow box girders
    const girderGeo = new THREE.BoxGeometry(bridgeSpanX + 0.6, 0.68, 0.44);
    const frontGirder = new THREE.Mesh(girderGeo, craneYellowMat);
    frontGirder.position.set(0, bridgeY, 0.72);
    frontGirder.castShadow = !this.isSoftwareGl;
    this.craneBridgeGroup.add(frontGirder);

    const backGirder = new THREE.Mesh(girderGeo, craneYellowMat);
    backGirder.position.set(0, bridgeY, -0.72);
    backGirder.castShadow = !this.isSoftwareGl;
    this.craneBridgeGroup.add(backGirder);

    // End-truck bogies resting on the longitudinal runway beams
    const truckGeo = new THREE.BoxGeometry(0.62, 0.42, 2.35);
    for (const s of [-1, 1]) {
      const truck = new THREE.Mesh(truckGeo, steelMat);
      truck.position.set(s * (bridgeSpanX / 2), railY + 0.36, 0);
      this.craneBridgeGroup.add(truck);
    }

    // Hoist Trolley carriage riding between the twin bridge girders
    const trolleyBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 0.58, 1.72),
      steelMat
    );
    trolleyBody.position.set(0, bridgeY + 0.35, 0);
    this.craneTrolleyGroup.add(trolleyBody);

    const motorDrum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.95, 16),
      craneYellowMat
    );
    motorDrum.rotation.z = Math.PI / 2;
    motorDrum.position.set(0, bridgeY + 0.66, 0);
    this.craneTrolleyGroup.add(motorDrum);

    // Suspended wire ropes + yellow spreader / coil lifting beam
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.3,
    });
    const ropeGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8);
    for (const rx of [-0.45, 0.45]) {
      for (const rz of [-0.22, 0.22]) {
        const rope = new THREE.Mesh(ropeGeo, ropeMat);
        rope.position.set(rx, bridgeY - 1.15, rz);
        this.craneHoistGroup.add(rope);
      }
    }

    const liftingBeam = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.42, 0.72),
      safetyYellowMat
    );
    liftingBeam.position.set(0, bridgeY - 2.45, 0);
    liftingBeam.castShadow = !this.isSoftwareGl;
    this.craneHoistGroup.add(liftingBeam);

    // Coil grab jaws underneath lifting beam
    const jawGeo = new THREE.BoxGeometry(0.18, 0.56, 0.58);
    for (const jx of [-0.75, 0.75]) {
      const jaw = new THREE.Mesh(jawGeo, steelMat);
      jaw.position.set(jx, bridgeY - 2.86, 0);
      this.craneHoistGroup.add(jaw);
    }

    this.craneTrolleyGroup.add(this.craneHoistGroup);
    this.craneBridgeGroup.add(this.craneTrolleyGroup);
    this.craneBridgeGroup.position.set(0, 0, -2.5);
    this.craneTrolleyGroup.position.set(-2.0, 0, 0);
    this.craneGroup.add(this.craneBridgeGroup);
  }

  private rebuildCoilsAndSaddles(
    layout: BuildingLayoutResult,
    filter: SceneFilterState
  ) {
    this.disposeGroupChildren(this.dynamicGroup);
    this.coilBodyInstanced = null;
    this.coilCollarInstanced = null;
    this.coilStrapInstanced = null;
    this.saddleBaseInstanced = null;
    this.saddleChockInstanced = null;

    // 1. Collect all Level-1 floor slots (both empty and occupied on L1) for saddles
    const floorSlots = layout.slots.filter((s) => s.level === 1);
    this.floorSlotList = floorSlots;

    if (floorSlots.length > 0) {
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.25,
      });
      const chockMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.75,
        metalness: 0.35,
      });

      this.saddleBaseInstanced = new THREE.InstancedMesh(
        this.saddleBaseGeom,
        baseMat,
        floorSlots.length
      );
      this.saddleBaseInstanced.receiveShadow = !this.isSoftwareGl;

      this.saddleChockInstanced = new THREE.InstancedMesh(
        this.saddleChockGeom,
        chockMat,
        floorSlots.length * 2
      );

      const dummy = new THREE.Object3D();
      floorSlots.forEach((slot, idx) => {
        dummy.position.set(slot.x, SADDLE_HEIGHT * 0.28, slot.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.saddleBaseInstanced!.setMatrixAt(idx, dummy.matrix);

        // Twin cradle chocks on front (+Z road side) & back (-Z) cradling the road-facing coil
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.position.set(slot.x, SADDLE_HEIGHT * 0.56, slot.z - 0.44);
        dummy.updateMatrix();
        this.saddleChockInstanced!.setMatrixAt(idx * 2, dummy.matrix);

        dummy.position.set(slot.x, SADDLE_HEIGHT * 0.56, slot.z + 0.44);
        dummy.updateMatrix();
        this.saddleChockInstanced!.setMatrixAt(idx * 2 + 1, dummy.matrix);
      });

      this.saddleBaseInstanced.instanceMatrix.needsUpdate = true;
      this.saddleChockInstanced.instanceMatrix.needsUpdate = true;
      this.dynamicGroup.add(this.saddleBaseInstanced);
      this.dynamicGroup.add(this.saddleChockInstanced);
    }

    // 2. Instanced Hollow Metallic Steel Coils (occupied slots across all levels)
    this.occupiedSlotList = layout.occupiedSlots;
    const coilCount = this.occupiedSlotList.length;

    if (coilCount > 0) {
      const coilBodyMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.steelTexture,
        metalness: 0.72,
        roughness: 0.34,
      });

      const collarMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.35,
        metalness: 0.25,
      });

      const strapMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.45,
        metalness: 0.75,
      });

      this.coilBodyInstanced = new THREE.InstancedMesh(
        this.coilGeom,
        coilBodyMat,
        coilCount
      );
      this.coilBodyInstanced.castShadow = !this.isSoftwareGl;
      this.coilBodyInstanced.receiveShadow = !this.isSoftwareGl;

      this.coilCollarInstanced = new THREE.InstancedMesh(
        this.collarGeom,
        collarMat,
        coilCount
      );

      this.coilStrapInstanced = new THREE.InstancedMesh(
        this.strapGeom,
        strapMat,
        coilCount * 2
      );

      const dummy = new THREE.Object3D();
      this.occupiedSlotList.forEach((slot, idx) => {
        // Rotate 90° around Y so coil's curved face faces the road (+Z) and pyramid stacks back along Z
        dummy.position.set(slot.x, slot.y, slot.z);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.coilBodyInstanced!.setMatrixAt(idx, dummy.matrix);
        this.coilCollarInstanced!.setMatrixAt(idx, dummy.matrix);

        // Two circumferential dark steel strapping bands spaced along coil width (X)
        dummy.position.set(slot.x - COIL_WIDTH * 0.28, slot.y, slot.z);
        dummy.updateMatrix();
        this.coilStrapInstanced!.setMatrixAt(idx * 2, dummy.matrix);

        dummy.position.set(slot.x + COIL_WIDTH * 0.28, slot.y, slot.z);
        dummy.updateMatrix();
        this.coilStrapInstanced!.setMatrixAt(idx * 2 + 1, dummy.matrix);
      });

      this.coilBodyInstanced.instanceMatrix.needsUpdate = true;
      this.coilCollarInstanced.instanceMatrix.needsUpdate = true;
      this.coilStrapInstanced.instanceMatrix.needsUpdate = true;

      this.dynamicGroup.add(this.coilBodyInstanced);
      this.dynamicGroup.add(this.coilCollarInstanced);
      this.dynamicGroup.add(this.coilStrapInstanced);
    }

    this.applyInstanceColors(layout, filter);
  }

  private matchesFilter(slot: WarehouseSlot3D, filter: SceneFilterState): boolean {
    if (filter.door !== "ALL" && slot.door !== filter.door) return false;
    if (filter.row !== "ALL" && String(slot.row) !== filter.row) return false;
    if (filter.level !== "ALL" && String(slot.level) !== filter.level) return false;
    if (filter.onlyPendingSap && !slot.isPendingSap) return false;
    return true;
  }

  private applyInstanceColors(
    _layout: BuildingLayoutResult,
    filter: SceneFilterState
  ) {
    const color = new THREE.Color();

    // Floor saddle colors
    if (this.saddleBaseInstanced) {
      this.floorSlotList.forEach((slot, idx) => {
        const isHighlighted =
          slot.slotKey === filter.focusedSlotKey ||
          slot.slotKey === filter.selectedSlotKey;

        if (isHighlighted) {
          color.setHex(STATUS_HEX.FOCUS);
        } else if (!this.matchesFilter(slot, filter)) {
          color.setHex(DIMMED_HEX);
        } else {
          color.setHex(STATUS_HEX[slot.status]);
        }
        this.saddleBaseInstanced!.setColorAt(idx, color);
      });
      if (this.saddleBaseInstanced.instanceColor) {
        this.saddleBaseInstanced.instanceColor.needsUpdate = true;
      }
    }

    // Coil body & status collar colors
    if (this.coilBodyInstanced && this.coilCollarInstanced) {
      this.occupiedSlotList.forEach((slot, idx) => {
        const isHighlighted =
          slot.slotKey === filter.focusedSlotKey ||
          slot.slotKey === filter.selectedSlotKey;
        const matched = this.matchesFilter(slot, filter);

        if (isHighlighted) {
          color.setHex(COIL_BODY_HEX.FOCUS);
          this.coilBodyInstanced!.setColorAt(idx, color);
          color.setHex(STATUS_HEX.FOCUS);
          this.coilCollarInstanced!.setColorAt(idx, color);
        } else if (!matched) {
          color.setHex(0x3a4659);
          this.coilBodyInstanced!.setColorAt(idx, color);
          color.setHex(DIMMED_HEX);
          this.coilCollarInstanced!.setColorAt(idx, color);
        } else {
          color.setHex(COIL_BODY_HEX[slot.status]);
          this.coilBodyInstanced!.setColorAt(idx, color);
          color.setHex(STATUS_HEX[slot.status]);
          this.coilCollarInstanced!.setColorAt(idx, color);
        }
      });

      if (this.coilBodyInstanced.instanceColor) {
        this.coilBodyInstanced.instanceColor.needsUpdate = true;
      }
      if (this.coilCollarInstanced.instanceColor) {
        this.coilCollarInstanced.instanceColor.needsUpdate = true;
      }
    }
  }

  private updateFocusMarker(
    layout: BuildingLayoutResult,
    filter: SceneFilterState
  ) {
    const key = filter.focusedSlotKey || filter.selectedSlotKey;
    if (!key) {
      this.focusMarkerGroup.visible = false;
      return;
    }

    const slot = layout.slots.find((s) => s.slotKey === key);
    if (!slot) {
      this.focusMarkerGroup.visible = false;
      return;
    }

    this.focusMarkerGroup.visible = true;
    this.focusMarkerGroup.position.set(slot.x, slot.y, slot.z);
  }

  // ============================================================================
  // Pointer Raycasting & Hover Feedback
  // ============================================================================
  private updateNdc(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickSlot(event: PointerEvent): WarehouseSlot3D | null {
    this.updateNdc(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    // 1. Priority: steel coils
    if (this.coilBodyInstanced) {
      const coilHits = this.raycaster.intersectObject(this.coilBodyInstanced, false);
      if (coilHits.length > 0 && typeof coilHits[0].instanceId === "number") {
        const slot = this.occupiedSlotList[coilHits[0].instanceId];
        if (slot) return slot;
      }
    }

    // 2. Fallback: floor saddles (empty or occupied base)
    if (this.saddleBaseInstanced) {
      const saddleHits = this.raycaster.intersectObject(
        this.saddleBaseInstanced,
        false
      );
      if (saddleHits.length > 0 && typeof saddleHits[0].instanceId === "number") {
        const slot = this.floorSlotList[saddleHits[0].instanceId];
        if (slot) return slot;
      }
    }

    return null;
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.pointerDownPos = { x: event.clientX, y: event.clientY };
  };

  private handlePointerUp = (event: PointerEvent) => {
    const dx = event.clientX - this.pointerDownPos.x;
    const dy = event.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 6) return; // Drag/orbit gesture, not a click

    const picked = this.pickSlot(event);
    this.callbacks.onSelectSlot(picked);
  };

  private handlePointerMove = (event: PointerEvent) => {
    const now = performance.now();
    if (now - this.lastHoverCheck < 55) return;
    this.lastHoverCheck = now;

    const hit = this.pickSlot(event);
    this.renderer.domElement.style.cursor = hit ? "pointer" : "grab";
  };

  // ============================================================================
  // Render Loop, Resize & Context Safety
  // ============================================================================
  private handleControlsChange = () => {
    this.requestRender();
  };

  private handleResize() {
    if (this.disposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.callbacks.onWebGLContextError?.(
      "WebGL Context Lost — กำลังรอการกู้คืนการแสดงผล 3 มิติ"
    );
  };

  private handleContextRestored = () => {
    this.requestRender();
  };

  public requestRender() {
    if (this.disposed || this.renderPending) return;
    this.renderPending = true;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private startLoopIfNeeded() {
    if (!this.renderPending && !this.disposed) {
      this.renderPending = true;
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number) => {
    this.renderPending = false;
    if (this.disposed) return;

    let needsAnotherFrame = false;

    // 1. Smooth camera fly-to interpolation
    if (this.camTween) {
      const elapsed = now - this.camTween.startTime;
      const rawT = Math.min(1, elapsed / this.camTween.durationMs);
      // Cubic ease-out
      const t = 1 - Math.pow(1 - rawT, 3);
      this.camera.position.lerpVectors(
        this.camTween.startPos,
        this.camTween.endPos,
        t
      );
      this.controls.target.lerpVectors(
        this.camTween.startTarget,
        this.camTween.endTarget,
        t
      );
      if (rawT >= 1) {
        this.camTween = null;
      } else {
        needsAnotherFrame = true;
      }
    }

    // 2. Crane Demo visual-only animation
    if (this.craneDemoActive) {
      const dt = Math.min(0.08, Math.max(0.001, (now - this.lastTickTime) / 1000));
      this.lastTickTime = now;
      this.cranePhase += dt;

      const travelZ = Math.max(4, this.currentSlabDepth * 0.34);
      const travelX = Math.max(4, this.currentSlabWidth * 0.32);

      this.craneBridgeGroup.position.z = Math.sin(this.cranePhase * 0.42) * travelZ;
      this.craneTrolleyGroup.position.x = Math.cos(this.cranePhase * 0.65) * travelX;
      this.craneHoistGroup.position.y = Math.sin(this.cranePhase * 1.15) * 0.45;
      needsAnotherFrame = true;
    }

    // 3. OrbitControls damping settle
    const dampingMoved = this.controls.update();
    if (dampingMoved && !this.isSoftwareGl) {
      needsAnotherFrame = true;
    }

    this.renderer.render(this.scene, this.camera);

    if (needsAnotherFrame) {
      if (this.isSoftwareGl) {
        // Yield briefly on software WebGL so UI remains responsive
        setTimeout(() => this.requestRender(), 32);
      } else {
        this.requestRender();
      }
    }
  };

  public dispose() {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);

    this.controls.removeEventListener("change", this.handleControlsChange);
    this.controls.dispose();

    this.disposeGroupChildren(this.structureGroup);
    this.disposeGroupChildren(this.dynamicGroup);
    this.disposeGroupChildren(this.craneGroup);
    this.disposeGroupChildren(this.focusMarkerGroup);

    this.coilGeom.dispose();
    this.collarGeom.dispose();
    this.strapGeom.dispose();
    this.saddleBaseGeom.dispose();
    this.saddleChockGeom.dispose();
    this.steelTexture.dispose();

    this.envRenderTarget.dispose();
    this.pmremGenerator.dispose();
    this.renderer.dispose();
  }
}
