/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Link2,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { MhPm3dModelType } from "../../services/forkliftDataService";
import {
  PM3D_MODELS,
  PM3D_MODEL_LIST,
  Pm3dItemStatus,
  Pm3dZoneDefinition,
} from "./pm3dChecklists";
import {
  BuiltVehicleModel,
  buildFlatbedTrailer,
  buildVehicleByModelType,
  createPm3dTexturePack,
} from "./pm3dVehicleBuilders";

export interface Pm3dRenderZone {
  zone: Pm3dZoneDefinition;
  status: Pm3dItemStatus;
  worldOffsetZ: number;
  checkedCount: number;
  totalCount: number;
}

interface Pm3dViewportProps {
  vehicleCode: string;
  modelType: MhPm3dModelType;
  onModelTypeChange: (modelType: MhPm3dModelType) => void;
  attachTrailer: boolean;
  onToggleAttachTrailer: () => void;
  isHoodOpen: boolean;
  onToggleHoodOpen: () => void;
  zones: Pm3dRenderZone[];
  activeZoneId: string | null;
  onSelectZone: (zoneId: string) => void;
}

type CameraPreset = "iso" | "front" | "side" | "rear" | "top";

// Coupled trailer offset so lunette eye (local z=+2.86) meets tractor rear hitch (local z=-1.39)
export const COUPLED_TRAILER_OFFSET_Z = -4.25;

// Reusable module-scope math objects (Zero GC inside render loop)
const _projVec = new THREE.Vector3();
const _bboxCorner = new THREE.Vector3();
const _stageBox = new THREE.Box3();
const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();
const _highlightColor = new THREE.Color(0x0ea5e9);

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

function deriveCoupledTrailerCode(primaryCode: string): string {
  const numMatch = primaryCode.match(/(\d{1,3})$/);
  return numMatch ? `TR-${numMatch[1]}` : "TR-01";
}

export function Pm3dViewport({
  vehicleCode,
  modelType,
  onModelTypeChange,
  attachTrailer,
  onToggleAttachTrailer,
  isHoodOpen,
  onToggleHoodOpen,
  zones,
  activeZoneId,
  onSelectZone,
}: Pm3dViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lineRefs = useRef<Map<string, SVGPolylineElement>>(new Map());
  const dotGroupRefs = useRef<Map<string, SVGGElement>>(new Map());
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<CameraPreset>("iso");

  // Mutable refs for Three.js loop to read latest React props without tearing down WebGL
  const zonesRef = useRef<Pm3dRenderZone[]>(zones);
  const activeZoneIdRef = useRef<string | null>(activeZoneId);
  const isHoodOpenRef = useRef<boolean>(isHoodOpen);
  const onSelectZoneRef = useRef(onSelectZone);
  const showLabelsRef = useRef<boolean>(showLabels);

  zonesRef.current = zones;
  activeZoneIdRef.current = activeZoneId;
  isHoodOpenRef.current = isHoodOpen;
  onSelectZoneRef.current = onSelectZone;
  showLabelsRef.current = showLabels;

  // Exposed imperative bridge into Three.js scene
  const sceneBridgeRef = useRef<{
    rebuildModels: (mType: MhPm3dModelType, coupled: boolean, vCode: string) => void;
    requestRender: () => void;
    setCameraGoal: (pos: [number, number, number], target: [number, number, number]) => void;
    applyHoverHighlight: (zoneId: string | null) => void;
  } | null>(null);
  const prevModelShapeKeyRef = useRef<string>(`${modelType}|${attachTrailer ? 1 : 0}`);

  const modelMeta = PM3D_MODELS[modelType];

  const computePresetCoords = (
    preset: CameraPreset,
    mType: MhPm3dModelType,
    coupled: boolean
  ): { pos: [number, number, number]; target: [number, number, number] } => {
    const isLong = coupled || mType === "trailer";
    const tz = coupled ? -1.4 : mType === "trailer" ? 0.3 : 0.05;
    const distScale = coupled ? 1.72 : mType === "trailer" ? 1.42 : 1.16;

    switch (preset) {
      case "front":
        return { pos: [0.35, 1.55, 4.7 * distScale + tz], target: [0, 0.85, tz] };
      case "side":
        return { pos: [5.3 * distScale, 1.55, tz + 0.2], target: [0, 0.85, tz] };
      case "rear":
        return { pos: [-0.4, 1.6, -4.8 * distScale + tz], target: [0, 0.85, tz] };
      case "top":
        return { pos: [0.1, (isLong ? 8.2 : 5.8), tz + 1.5], target: [0, 0.5, tz] };
      case "iso":
      default:
        return {
          pos: [3.8 * distScale, 2.32 * (coupled ? 1.15 : 1), 3.7 * distScale + tz],
          target: [0, 0.85, tz],
        };
    }
  };

  // Mount Three.js WebGLRenderer ONCE
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
      setWebglError("เบราว์เซอร์ไม่รองรับการแสดงผล 3D WebGL");
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(300, container.clientWidth);
    const height = Math.max(300, container.clientHeight);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const isDarkTheme = document.documentElement.classList.contains("dark");
    const bgHex = isDarkTheme ? 0x0f1b2d : 0x243447;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.030);

    // Mandatory studio environment map via PMREMGenerator + RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 80);
    camera.position.set(3.8, 2.3, 3.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minPolarAngle = 0.12;
    controls.minDistance = 1.8;
    controls.maxDistance = 16;
    controls.target.set(0, 0.85, 0);

    // Balanced 3-point Studio Lighting (Warm key + Cool Hemisphere + Crisp Rim + Studio Softboxes)
    const hemiLight = new THREE.HemisphereLight(
      isDarkTheme ? 0xb6d4fe : 0xdbeafe,
      isDarkTheme ? 0x1e293b : 0x334155,
      0.95
    );
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.95);
    keyLight.position.set(5.8, 9.6, 6.4);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 28;
      const d = 6.8;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0004;
      keyLight.shadow.normalBias = 0.022;
      keyLight.shadow.radius = 3;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xbae6fd, 1.05);
    rimLight.position.set(-6.2, 5.2, -5.8);
    scene.add(rimLight);

    // Studio overhead & side softboxes for elongated specular reflections on automotive clearcoat & chrome
    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const topSoftbox = new THREE.RectAreaLight(0xffffff, 2.4, 7.5, 3.2);
      topSoftbox.position.set(0, 5.8, -0.4);
      topSoftbox.lookAt(0, 0.8, -0.4);
      scene.add(topSoftbox);

      const sideSoftbox = new THREE.RectAreaLight(0xe0f2fe, 1.6, 5.5, 2.2);
      sideSoftbox.position.set(-5.2, 2.4, 1.5);
      sideSoftbox.lookAt(0, 0.9, 0);
      scene.add(sideSoftbox);
    }

    // Procedural Textures & Grounded Epoxy-Concrete Inspection Bay Floor
    const textures = createPm3dTexturePack(renderer.capabilities.getMaxAnisotropy());
    const floorGeo = new THREE.CircleGeometry(24, 56);
    const floorMat = new THREE.MeshStandardMaterial({
      color: isDarkTheme ? 0x263447 : 0x4b5c70,
      map: textures.studioFloor,
      roughnessMap: textures.studioFloorRoughness,
      roughness: 0.78,
      metalness: 0.08,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = !isSoftwareGl;
    scene.add(floorMesh);

    // Subtle circular inspection bay ring on floor
    const ringGeo = new THREE.RingGeometry(2.85, 2.93, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: isDarkTheme ? 0.45 : 0.42,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const bayRing = new THREE.Mesh(ringGeo, ringMat);
    bayRing.rotation.x = -Math.PI / 2;
    bayRing.position.y = 0.006;
    scene.add(bayRing);

    const vehicleStage = new THREE.Group();
    scene.add(vehicleStage);

    let primaryModel: BuiltVehicleModel | null = null;
    let coupledTrailerModel: BuiltVehicleModel | null = null;
    let hoodProgress = isHoodOpenRef.current ? 1 : 0;
    let isCameraAnimating = false;
    let currentHoveredZone: string | null = null;
    let disposed = false;

    const clearEmissiveForModel = (model: BuiltVehicleModel | null) => {
      if (!model) return;
      model.zoneMeshes.forEach((meshes) => {
        for (const m of meshes) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat && mat.emissive && m.userData.baseEmissiveHex === undefined) {
            m.userData.baseEmissiveHex = mat.emissive.getHex();
          }
          if (mat && mat.emissive && m.userData.baseEmissiveHex !== undefined) {
            mat.emissive.setHex(m.userData.baseEmissiveHex);
          }
        }
      });
    };

    const applyHoverHighlight = (zoneId: string | null) => {
      currentHoveredZone = zoneId;
      clearEmissiveForModel(primaryModel);
      clearEmissiveForModel(coupledTrailerModel);

      const targetId = zoneId || activeZoneIdRef.current;
      if (!targetId) {
        requestRender();
        return;
      }

      const highlightOn = (model: BuiltVehicleModel | null) => {
        if (!model) return;
        const list = model.zoneMeshes.get(targetId);
        if (!list) return;
        for (const m of list) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat && mat.emissive) {
            if (m.userData.baseEmissiveHex === undefined) {
              m.userData.baseEmissiveHex = mat.emissive.getHex();
            }
            mat.emissive.copy(_highlightColor).multiplyScalar(0.28);
          }
        }
      };

      highlightOn(primaryModel);
      highlightOn(coupledTrailerModel);
      requestRender();
    };

    const rebuildModels = (mType: MhPm3dModelType, coupled: boolean, vCode: string) => {
      if (primaryModel) {
        vehicleStage.remove(primaryModel.root);
        primaryModel.dispose();
        primaryModel = null;
      }
      if (coupledTrailerModel) {
        vehicleStage.remove(coupledTrailerModel.root);
        coupledTrailerModel.dispose();
        coupledTrailerModel = null;
      }

      primaryModel = buildVehicleByModelType(mType, textures, isSoftwareGl, vCode);
      vehicleStage.add(primaryModel.root);

      const shouldCouple = coupled && (mType === "diesel_tractor" || mType === "ev_tractor");
      if (shouldCouple) {
        coupledTrailerModel = buildFlatbedTrailer(textures, deriveCoupledTrailerCode(vCode));
        coupledTrailerModel.root.position.set(0, 0, COUPLED_TRAILER_OFFSET_Z);
        vehicleStage.add(coupledTrailerModel.root);
      }

      // Snap hood to current open state immediately on model switch
      hoodProgress = isHoodOpenRef.current ? 1 : 0;
      if (primaryModel.hoodPivot) {
        primaryModel.hoodPivot.rotation.x = primaryModel.hoodOpenRotationX * hoodProgress;
      }

      bayRing.scale.setScalar(shouldCouple ? 1.65 : mType === "trailer" ? 1.25 : 1.0);
      bayRing.position.z = shouldCouple ? -1.4 : 0;

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }
      applyHoverHighlight(currentHoveredZone);
      requestRender();
    };

    // Project 3D anchors to non-occluding external callout labels + CAD elbow leader lines (Zero React re-renders)
    const updateProjectedLabels = () => {
      const rectW = renderer.domElement.clientWidth;
      const rectH = renderer.domElement.clientHeight;
      if (rectW <= 0 || rectH <= 0) return;

      const list = zonesRef.current;
      const visible = showLabelsRef.current;

      const hideItem = (id: string) => {
        const el = labelRefs.current.get(id);
        if (el) {
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        }
        const line = lineRefs.current.get(id);
        if (line) line.style.opacity = "0";
        const dotGrp = dotGroupRefs.current.get(id);
        if (dotGrp) dotGrp.style.opacity = "0";
      };

      if (!visible) {
        for (const item of list) hideItem(item.zone.id);
        return;
      }

      // 1. Compute live 2D screen-space silhouette bounding box of the active 3D vehicle(s)
      _stageBox.makeEmpty();
      if (primaryModel) _stageBox.expandByObject(primaryModel.root);
      if (coupledTrailerModel) _stageBox.expandByObject(coupledTrailerModel.root);

      let vehMinX = rectW * 0.34;
      let vehMaxX = rectW * 0.66;
      let vehCenterX = rectW * 0.5;

      if (!_stageBox.isEmpty()) {
        // Clamp bottom Y slightly above ground plane so contact shadow plane doesn't bloat X silhouette
        const minX3 = _stageBox.min.x * 0.72;
        const maxX3 = _stageBox.max.x * 0.72;
        const minY3 = Math.max(0.08, _stageBox.min.y);
        const maxY3 = _stageBox.max.y;
        const minZ3 = _stageBox.min.z * 0.86;
        const maxZ3 = _stageBox.max.z * 0.86;

        let sMinX = Infinity;
        let sMaxX = -Infinity;
        const xs = [minX3, maxX3];
        const ys = [minY3, maxY3];
        const zs = [minZ3, maxZ3];
        for (let ix = 0; ix < 2; ix++) {
          for (let iy = 0; iy < 2; iy++) {
            for (let iz = 0; iz < 2; iz++) {
              _bboxCorner.set(xs[ix], ys[iy], zs[iz]).project(camera);
              if (_bboxCorner.z >= -1 && _bboxCorner.z <= 1) {
                const px = ((_bboxCorner.x + 1) / 2) * rectW;
                if (px < sMinX) sMinX = px;
                if (px > sMaxX) sMaxX = px;
              }
            }
          }
        }
        if (Number.isFinite(sMinX) && Number.isFinite(sMaxX)) {
          vehMinX = Math.max(rectW * 0.16, Math.min(rectW * 0.44, sMinX));
          vehMaxX = Math.min(rectW * 0.84, Math.max(rectW * 0.56, sMaxX));
          vehCenterX = (sMinX + sMaxX) * 0.5;
        }
      }

      // 2. Project all 3D hotspot anchors into 2D screen space and partition Left vs Right rails
      type ProjectedItem = {
        id: string;
        ax: number;
        ay: number;
        side: "left" | "right";
        labelY: number;
      };
      const leftItems: ProjectedItem[] = [];
      const rightItems: ProjectedItem[] = [];

      for (const item of list) {
        const aClosed = item.zone.anchor;
        const aOpen = item.zone.openAnchor || aClosed;
        const wx = THREE.MathUtils.lerp(aClosed[0], aOpen[0], hoodProgress);
        const wy = THREE.MathUtils.lerp(aClosed[1], aOpen[1], hoodProgress);
        const wz = THREE.MathUtils.lerp(aClosed[2], aOpen[2], hoodProgress) + item.worldOffsetZ;

        _projVec.set(wx, wy, wz).project(camera);
        const inFront = _projVec.z >= -1 && _projVec.z <= 1;
        const sx = ((_projVec.x + 1) / 2) * rectW;
        const sy = ((-_projVec.y + 1) / 2) * rectH;
        const inBounds =
          inFront && sx >= -30 && sx <= rectW + 30 && sy >= -20 && sy <= rectH + 20;

        if (!inBounds) {
          hideItem(item.zone.id);
          continue;
        }

        const side: "left" | "right" = sx < vehCenterX ? "left" : "right";
        const entry: ProjectedItem = {
          id: item.zone.id,
          ax: sx,
          ay: sy,
          side,
          labelY: sy,
        };
        if (side === "left") leftItems.push(entry);
        else rightItems.push(entry);
      }

      // Gently balance if one side has >2 more items than the other so neither flank gets cramped
      const rebalance = (from: ProjectedItem[], to: ProjectedItem[], toSide: "left" | "right") => {
        while (from.length - to.length > 2) {
          // Move the item closest to the vehicle centerline
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < from.length; i++) {
            const d = Math.abs(from[i].ax - vehCenterX);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          const [moved] = from.splice(bestIdx, 1);
          moved.side = toSide;
          to.push(moved);
        }
      };
      rebalance(leftItems, rightItems, "right");
      rebalance(rightItems, leftItems, "left");

      // 3. Layout each rail vertically (sorted top-to-bottom so leader lines never tangle!)
      const topSafe = 56; // Clear top-left badge
      const bottomSafe = rectH - 112; // Clear collapsible bottom dock
      const availH = Math.max(120, bottomSafe - topSafe);

      const layoutRail = (items: ProjectedItem[], side: "left" | "right") => {
        if (items.length === 0) return;
        items.sort((a, b) => a.ay - b.ay);

        const maxGap = Math.floor(availH / Math.max(1, items.length));
        const minGap = Math.max(26, Math.min(38, maxGap));

        // Initial clamped targets
        for (const it of items) {
          it.labelY = Math.max(topSafe, Math.min(bottomSafe, it.ay));
        }

        // Top-down de-overlap pass
        for (let i = 1; i < items.length; i++) {
          if (items[i].labelY < items[i - 1].labelY + minGap) {
            items[i].labelY = items[i - 1].labelY + minGap;
          }
        }
        // Bottom-up pull back inside bottomSafe
        if (items[items.length - 1].labelY > bottomSafe) {
          items[items.length - 1].labelY = bottomSafe;
          for (let i = items.length - 2; i >= 0; i--) {
            if (items[i].labelY > items[i + 1].labelY - minGap) {
              items[i].labelY = items[i + 1].labelY - minGap;
            }
          }
        }
        // Final top clamp safeguard
        if (items[0].labelY < topSafe) {
          const shift = topSafe - items[0].labelY;
          for (const it of items) it.labelY += shift;
        }

        // Compute horizontal rail anchor outside the vehicle silhouette
        const isCompact = rectW < 640;
        const margin = isCompact ? 8 : 16;
        const minLabelSpace = isCompact ? 118 : 156;
        const clearance = isCompact ? 20 : 34;

        // For left rail, label sits to the LEFT of edgeX (transform: translate(-100%, -50%))
        // For right rail, label sits to the RIGHT of edgeX (transform: translate(0%, -50%))
        const leftEdgeX = Math.max(margin + minLabelSpace, Math.min(vehMinX - clearance, vehCenterX - 95));
        const rightEdgeX = Math.min(rectW - margin - minLabelSpace, Math.max(vehMaxX + clearance, vehCenterX + 95));

        for (const it of items) {
          const el = labelRefs.current.get(it.id);
          const line = lineRefs.current.get(it.id);
          const dotGrp = dotGroupRefs.current.get(it.id);

          const edgeX = side === "left" ? leftEdgeX : rightEdgeX;
          const elbowSpan = isCompact ? 12 : 18;
          const elbowX = side === "left" ? edgeX + elbowSpan : edgeX - elbowSpan;

          if (el) {
            el.style.opacity = "1";
            el.style.pointerEvents = "auto";
            el.style.transform =
              side === "left"
                ? `translate3d(${edgeX.toFixed(1)}px, ${it.labelY.toFixed(1)}px, 0) translate(-100%, -50%)`
                : `translate3d(${edgeX.toFixed(1)}px, ${it.labelY.toFixed(1)}px, 0) translate(0%, -50%)`;
          }

          if (line) {
            line.style.opacity = "1";
            line.setAttribute(
              "points",
              `${it.ax.toFixed(1)},${it.ay.toFixed(1)} ${elbowX.toFixed(1)},${it.labelY.toFixed(1)} ${edgeX.toFixed(1)},${it.labelY.toFixed(1)}`
            );
          }

          if (dotGrp) {
            dotGrp.style.opacity = "1";
            dotGrp.setAttribute("transform", `translate(${it.ax.toFixed(1)}, ${it.ay.toFixed(1)})`);
          }
        }
      };

      layoutRail(leftItems, "left");
      layoutRail(rightItems, "right");
    };

    // Coalesced on-demand renderer with Software-WebGL fence pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      try {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
        if (!sync) {
          frameId = window.setTimeout(cb, 60);
          return;
        }
        gl.flush();
        const poll = () => {
          if (disposed) {
            gl.deleteSync(sync);
            return;
          }
          const st = gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (st === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 50);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } catch {
        frameId = window.setTimeout(cb, 60);
      }
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
        lastTime = now;

        let needsMoreFrames = false;

        // Smooth hood/inspection lid animation
        const targetHood = isHoodOpenRef.current ? 1 : 0;
        if (Math.abs(hoodProgress - targetHood) > 0.004) {
          hoodProgress = THREE.MathUtils.damp(hoodProgress, targetHood, 8.5, dt);
          needsMoreFrames = true;
        } else {
          hoodProgress = targetHood;
        }
        if (primaryModel?.hoodPivot) {
          primaryModel.hoodPivot.rotation.x = primaryModel.hoodOpenRotationX * hoodProgress;
        }

        // Smooth camera transition (cancelled immediately when user orbits)
        if (isCameraAnimating) {
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camGoalPos.x, 7.5, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camGoalPos.y, 7.5, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camGoalPos.z, 7.5, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _camGoalTarget.x, 7.5, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _camGoalTarget.y, 7.5, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _camGoalTarget.z, 7.5, dt);

          const posDist = camera.position.distanceTo(_camGoalPos);
          const tgtDist = controls.target.distanceTo(_camGoalTarget);
          if (posDist < 0.03 && tgtDist < 0.03) {
            camera.position.copy(_camGoalPos);
            controls.target.copy(_camGoalTarget);
            isCameraAnimating = false;
          } else {
            needsMoreFrames = true;
          }
        }

        const dampingChanged = controls.update();
        if (dampingChanged && !isSoftwareGl) {
          needsMoreFrames = true;
        }

        renderer.render(scene, camera);
        updateProjectedLabels();

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    const setCameraGoal = (pos: [number, number, number], target: [number, number, number]) => {
      _camGoalPos.set(pos[0], pos[1], pos[2]);
      _camGoalTarget.set(target[0], target[1], target[2]);
      if (isSoftwareGl) {
        camera.position.copy(_camGoalPos);
        controls.target.copy(_camGoalTarget);
        isCameraAnimating = false;
      } else {
        isCameraAnimating = true;
      }
      requestRender();
    };

    // Cancel camera tween immediately when user grabs OrbitControls
    const onControlStart = () => {
      isCameraAnimating = false;
    };
    const onControlChange = () => {
      requestRender();
    };
    controls.addEventListener("start", onControlStart);
    controls.addEventListener("change", onControlChange);

    // Throttled Raycasting on Canvas Click & Hover
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverTs = 0;

    const getHitZoneId = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const targets: THREE.Mesh[] = [];
      if (primaryModel) targets.push(...primaryModel.clickableMeshes);
      if (coupledTrailerModel) targets.push(...coupledTrailerModel.clickableMeshes);
      if (targets.length === 0) return null;

      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        return String(hits[0].object.userData.zoneId || "") || null;
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return; // Ignore orbit drag
      const zId = getHitZoneId(e.clientX, e.clientY);
      if (zId) {
        onSelectZoneRef.current(zId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTs < 60) return;
      lastHoverTs = now;
      const zId = getHitZoneId(e.clientX, e.clientY);
      renderer.domElement.style.cursor = zId ? "pointer" : "grab";
      if (zId !== currentHoveredZone) {
        setHoveredZoneId(zId);
        applyHoverHighlight(zId);
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    // WebGL Context Lost / Restored resilience
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError("การเชื่อมต่อ 3D WebGL หยุดชั่วคราว กรุณารีเฟรชหน้าจอ");
    };
    const onContextRestored = () => {
      setWebglError(null);
      requestRender();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    // Responsive ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(280, Math.floor(entry.contentRect.width));
        const h = Math.max(280, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    // Watch Dark/Light mode class toggles on <html>
    const themeObserver = new MutationObserver(() => {
      const darkNow = document.documentElement.classList.contains("dark");
      const nextBg = darkNow ? 0x0f1b2d : 0x243447;
      scene.background = new THREE.Color(nextBg);
      scene.fog = new THREE.FogExp2(nextBg, 0.030);
      floorMat.color.setHex(darkNow ? 0x263447 : 0x4b5c70);
      ringMat.opacity = darkNow ? 0.45 : 0.42;
      hemiLight.color.setHex(darkNow ? 0xb6d4fe : 0xdbeafe);
      hemiLight.groundColor.setHex(darkNow ? 0x1e293b : 0x334155);
      requestRender();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    sceneBridgeRef.current = {
      rebuildModels,
      requestRender,
      setCameraGoal,
      applyHoverHighlight,
    };

    // Initial model build + camera framing
    rebuildModels(modelType, attachTrailer, vehicleCode);
    const initCoords = computePresetCoords("iso", modelType, attachTrailer);
    camera.position.set(...initCoords.pos);
    controls.target.set(...initCoords.target);
    controls.update();
    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      controls.removeEventListener("start", onControlStart);
      controls.removeEventListener("change", onControlChange);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      controls.dispose();
      if (primaryModel) primaryModel.dispose();
      if (coupledTrailerModel) coupledTrailerModel.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      textures.dispose();
      envTarget.dispose();
      renderer.dispose();
      sceneBridgeRef.current = null;
    };
  }, []);

  // Rebuild 3D vehicle meshes when modelType, attachTrailer, or vehicleCode changes
  useEffect(() => {
    const bridge = sceneBridgeRef.current;
    if (!bridge) return;
    bridge.rebuildModels(modelType, attachTrailer, vehicleCode);
    const nextShapeKey = `${modelType}|${attachTrailer ? 1 : 0}`;
    if (prevModelShapeKeyRef.current !== nextShapeKey) {
      prevModelShapeKeyRef.current = nextShapeKey;
      const coords = computePresetCoords("iso", modelType, attachTrailer);
      setActivePreset("iso");
      bridge.setCameraGoal(coords.pos, coords.target);
    }
  }, [modelType, attachTrailer, vehicleCode]);

  // Trigger smooth hood animation render when isHoodOpen toggles
  useEffect(() => {
    sceneBridgeRef.current?.requestRender();
  }, [isHoodOpen, showLabels, zones]);

  // Focus camera smoothly on selected zone
  useEffect(() => {
    const bridge = sceneBridgeRef.current;
    if (!bridge) return;
    bridge.applyHoverHighlight(hoveredZoneId);
    if (!activeZoneId) return;
    const matched = zones.find((z) => z.zone.id === activeZoneId);
    if (!matched) return;
    const anchor = isHoodOpen && matched.zone.openAnchor ? matched.zone.openAnchor : matched.zone.anchor;
    const tx = anchor[0];
    const ty = anchor[1];
    const tz = anchor[2] + matched.worldOffsetZ;
    const [ox, oy, oz] = matched.zone.cameraOffset;
    bridge.setCameraGoal([tx + ox, Math.max(0.55, ty + oy * 0.65), tz + oz], [tx, ty, tz]);
  }, [activeZoneId]);

  const handlePresetClick = (preset: CameraPreset) => {
    setActivePreset(preset);
    const coords = computePresetCoords(preset, modelType, attachTrailer);
    sceneBridgeRef.current?.setCameraGoal(coords.pos, coords.target);
  };

  return (
    <div className="relative w-full h-[460px] lg:h-full lg:min-h-[380px] flex-1 rounded-xl overflow-hidden border border-slate-300 dark:border-[#1e3a5f] bg-[#243447] dark:bg-[#0f1b2d] select-none">
      {/* Isolated WebGL Canvas Mount */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Graceful WebGL Fallback */}
      {webglError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-slate-100 dark:bg-[#0b1628] text-slate-700 dark:text-slate-200">
          <AlertTriangle size={32} className="text-amber-500 mb-2" />
          <div className="text-sm font-semibold">{webglError}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
            คุณยังสามารถคลิกเลือกจุดตรวจจากรายการด้านล่างเพื่อบันทึกผลตรวจ PM ได้ตามปกติ
          </p>
        </div>
      )}

      {/* Minimal Top-Left Viewport Hint (Unobstructive) */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/90 dark:bg-[#0d1d35]/90 border border-slate-200/90 dark:border-[#1e3a5f] text-[11px] text-slate-700 dark:text-slate-200 shadow-xs">
        <span className="font-mono font-bold text-slate-900 dark:text-white tracking-wide">
          {vehicleCode}
        </span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="font-semibold text-[#087eaf] dark:text-sky-300">
          {modelMeta.shortLabel}
          {attachTrailer && modelMeta.supportsTrailerCoupling ? " + พ่วงหางเทลเลอร์" : ""}
        </span>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">
          ลากเพื่อหมุน 360° · สโครลซูม · คลิกป้ายกำกับเพื่อทำรายการ PM
        </span>
      </div>

      {/* CAD-Style Elbow Leader Lines & Pinpoint 3D Anchor Dots (SVG Layer behind labels) */}
      <svg
        className="pointer-events-none absolute inset-0 w-full h-full z-10 overflow-visible"
        aria-hidden="true"
      >
        {zones.map(({ zone, status }) => {
          const isSelected = activeZoneId === zone.id;
          const isHovered = hoveredZoneId === zone.id;
          const active = isSelected || isHovered;

          const strokeColor =
            status === "issue"
              ? "#fb7185"
              : status === "replaced"
              ? "#fbbf24"
              : status === "ok"
              ? "#34d399"
              : active
              ? "#7dd3fc"
              : "#38bdf8";

          return (
            <g key={`leader-${zone.id}`}>
              <polyline
                ref={(el) => {
                  if (el) lineRefs.current.set(zone.id, el);
                  else lineRefs.current.delete(zone.id);
                }}
                fill="none"
                stroke={strokeColor}
                strokeWidth={active ? 2.4 : 1.6}
                strokeOpacity={active ? 1 : 0.85}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: 0 }}
              />
              <g
                ref={(el) => {
                  if (el) dotGroupRefs.current.set(zone.id, el);
                  else dotGroupRefs.current.delete(zone.id);
                }}
                style={{ opacity: 0 }}
              >
                <circle
                  cx={0}
                  cy={0}
                  r={active ? 7 : 5.5}
                  fill="#ffffff"
                  fillOpacity={0.92}
                  stroke={strokeColor}
                  strokeWidth={active ? 2 : 1.5}
                />
                <circle
                  cx={0}
                  cy={0}
                  r={active ? 3.4 : 2.6}
                  fill={strokeColor}
                />
              </g>
            </g>
          );
        })}
      </svg>

      {/* 3D-to-2D External Non-Occluding Hotspot Callout Labels */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {zones.map(({ zone, status, checkedCount, totalCount }) => {
          const isSelected = activeZoneId === zone.id;
          const isHovered = hoveredZoneId === zone.id;

          const statusStyle =
            status === "issue"
              ? "bg-rose-600 text-white border-rose-700"
              : status === "replaced"
              ? "bg-amber-500 text-slate-950 border-amber-600"
              : status === "ok"
              ? "bg-emerald-600 text-white border-emerald-700"
              : "bg-white/95 text-slate-800 border-slate-300 dark:bg-[#0d1d35]/95 dark:text-slate-100 dark:border-[#2a4a78]";

          return (
            <button
              key={zone.id}
              type="button"
              ref={(el) => {
                if (el) labelRefs.current.set(zone.id, el);
                else labelRefs.current.delete(zone.id);
              }}
              onClick={() => onSelectZone(zone.id)}
              onMouseEnter={() => {
                setHoveredZoneId(zone.id);
                sceneBridgeRef.current?.applyHoverHighlight(zone.id);
              }}
              onMouseLeave={() => {
                setHoveredZoneId(null);
                sceneBridgeRef.current?.applyHoverHighlight(null);
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                opacity: 0,
                willChange: "transform",
              }}
              className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold shadow-sm transition-colors cursor-pointer whitespace-nowrap ${statusStyle} ${
                isSelected || isHovered
                  ? "ring-2 ring-[#087eaf] dark:ring-sky-400 z-20"
                  : "z-10"
              }`}
              title={`${zone.label} (${checkedCount}/${totalCount})`}
            >
              {status === "issue" ? (
                <AlertTriangle size={12} className="shrink-0" />
              ) : status === "replaced" ? (
                <Wrench size={12} className="shrink-0" />
              ) : status === "ok" ? (
                <CheckCircle2 size={12} className="shrink-0" />
              ) : (
                <span className="inline-block w-2 h-2 rounded-full bg-[#087eaf] dark:bg-sky-400 shrink-0" />
              )}
              <span>{zone.shortLabel}</span>
              <span className="font-mono tabular-nums text-[10px] opacity-80">
                {checkedCount}/{totalCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Collapsible Unified Bottom Control Dock (Zero Viewport Center Occlusion, No backdrop-filter) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center max-w-[96%] w-max">
        <button
          type="button"
          onClick={() => setDockCollapsed((c) => !c)}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-t-md border border-b-0 border-slate-200 dark:border-[#1e3a5f] bg-white/95 dark:bg-[#0d1d35]/95 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-[#087eaf] dark:hover:text-sky-300 shadow-xs cursor-pointer whitespace-nowrap"
        >
          {dockCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <span>{dockCollapsed ? "แสดงแถบควบคุม 3D" : "ซ่อนแถบควบคุม"}</span>
        </button>

        {!dockCollapsed && (
          <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white/95 dark:bg-[#0d1d35]/95 shadow-md">
            {/* 4 Vehicle Model Selector */}
            <div className="inline-flex items-center gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#081326] border border-slate-200/80 dark:border-[#1e3a5f]">
              {PM3D_MODEL_LIST.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onModelTypeChange(m.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    modelType === m.id
                      ? "bg-[#087eaf] text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {m.shortLabel}
                </button>
              ))}
            </div>

            <div className="h-5 w-px bg-slate-200 dark:bg-[#1e3a5f] hidden sm:block" />

            {/* Coupled Trailer & Open Hood Inspection Toggles */}
            <div className="inline-flex items-center gap-1.5 flex-wrap justify-center">
              {modelMeta.supportsTrailerCoupling && (
                <button
                  type="button"
                  onClick={onToggleAttachTrailer}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    attachTrailer
                      ? "bg-amber-500 text-slate-950 border-amber-600"
                      : "bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-[#10223f] dark:text-slate-200 dark:border-[#24436e]"
                  }`}
                >
                  <Link2 size={12} />
                  {attachTrailer ? "ถอดหางเทลเลอร์" : "พ่วงหางเทลเลอร์"}
                </button>
              )}

              {modelMeta.supportsOpenHood && (
                <button
                  type="button"
                  onClick={onToggleHoodOpen}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    isHoodOpen
                      ? "bg-[#087eaf] text-white border-[#087eaf]"
                      : "bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-[#10223f] dark:text-slate-200 dark:border-[#24436e]"
                  }`}
                >
                  <Wrench size={12} />
                  {isHoodOpen ? "ปิดฝากระโปรง" : modelMeta.openHoodLabel}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowLabels((s) => !s)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-[#24436e] bg-slate-50 dark:bg-[#10223f] text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#173056] whitespace-nowrap cursor-pointer"
                title="แสดงหรือซ่อนป้ายกำกับชิ้นส่วนบนรถ 3D"
              >
                {showLabels ? <EyeOff size={12} /> : <Eye size={12} />}
                {showLabels ? "ซ่อนป้าย" : "แสดงป้าย"}
              </button>
            </div>

            <div className="h-5 w-px bg-slate-200 dark:bg-[#1e3a5f] hidden md:block" />

            {/* Camera Angle Presets */}
            <div className="inline-flex items-center gap-1">
              {(
                [
                  { id: "iso", label: "360°" },
                  { id: "front", label: "หน้า" },
                  { id: "side", label: "ข้าง" },
                  { id: "rear", label: "หลัง" },
                  { id: "top", label: "มุมสูง" },
                ] as Array<{ id: CameraPreset; label: string }>
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePresetClick(preset.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    activePreset === preset.id
                      ? "bg-slate-800 text-white dark:bg-sky-500 dark:text-slate-950"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#14294a]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handlePresetClick("iso")}
                className="p-1 rounded text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#14294a] cursor-pointer"
                title="รีเซ็ตมุมกล้อง"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
