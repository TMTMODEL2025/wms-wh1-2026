/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Eye,
  History,
  Layers,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import {
  EvRepairZoneId,
  EvRepairZoneSpec,
  RepairVehicleModelKind,
  getCameraPresetsForModel,
  getModelDisplayTitle,
  getZoneByIdForModel,
} from "./evRepairZones";
import { BuiltEvHologramModel } from "./evTractorHologramBuilder";
import { buildRepairHologramModel } from "./mhVehicleHologramBuilder";

export type EvCameraPreset = "focus" | "iso" | "side" | "front" | "rear" | "top";

export interface RepairHistorySnapshotItem {
  id: string;
  workOrderNo: string;
  workingDate: string;
  workingDateDisplay: string;
  daysAgoLabel?: string;
  repairType: string;
  repairDescription: string;
  statusLabel: string;
  statusTone: "completed" | "in_progress" | "pending" | "rejected";
  operatingHours?: number;
  totalCost?: number;
  technicianOrVendor?: string;
  sparePartsSummary?: string;
}

interface EvRepairHologramViewportProps {
  vehicleId: string;
  modelKind?: RepairVehicleModelKind;
  activeZone: EvRepairZoneSpec;
  /** Currently selected repair category (used for side-panel same-category repair history HUD) */
  repairType?: string;
  /** Past maintenance records for this same vehicle and repair category (newest first) */
  sameCategoryHistory?: RepairHistorySnapshotItem[];
  /** Allow clicking 3D zones to change repair category & auto-fill form */
  interactive?: boolean;
  /** Compact height & simplified controls for Supervisor/Manager inspection modal */
  compact?: boolean;
  /** Stretch viewport dynamically to fill available vertical space (full-screen Stage 1 workspace) */
  fillHeight?: boolean;
  onSelectZone?: (zone: EvRepairZoneSpec) => void;
}

// Module-scoped reusable math helpers (Zero GC in animation loop)
const _projVec = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();
const _targetOrbitPos = new THREE.Vector3();
const _rayMouse = new THREE.Vector2();
const _activeHotspotVec = new THREE.Vector3();
const _secondaryVecPool = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
];
const _secList: THREE.Vector3[] = [];

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
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

export const EvRepairHologramViewport: React.FC<EvRepairHologramViewportProps> = ({
  vehicleId,
  modelKind = "ev_tractor",
  activeZone,
  repairType = "",
  sameCategoryHistory = [],
  interactive = true,
  compact = false,
  fillHeight = false,
  onSelectZone,
}) => {
  const cameraPresets = useMemo(() => getCameraPresetsForModel(modelKind), [modelKind]);
  const modelTitle = useMemo(() => getModelDisplayTitle(modelKind), [modelKind]);

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const calloutOverlayRef = useRef<HTMLDivElement | null>(null);

  const [isXrayMode, setIsXrayMode] = useState<boolean>(true);
  const [autoSpin, setAutoSpin] = useState<boolean>(false);
  const [cameraPreset, setCameraPreset] = useState<EvCameraPreset>("focus");
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(compact);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(() => {
    if (compact) return false;
    return typeof window !== "undefined" ? window.innerWidth >= 640 : true;
  });
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [hoveredZone, setHoveredZone] = useState<EvRepairZoneSpec | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);

  const cleanRepairType = (repairType || "").trim();
  const { validHistoryCount, totalHistoryCost, latestHistory } = useMemo(() => {
    let validCount = 0;
    let totalCost = 0;
    for (let i = 0; i < sameCategoryHistory.length; i++) {
      const h = sameCategoryHistory[i];
      if (h.statusTone !== "rejected") {
        validCount++;
        totalCost += h.totalCost || 0;
      }
    }
    return {
      validHistoryCount: validCount,
      totalHistoryCost: totalCost,
      latestHistory: sameCategoryHistory[0] || null,
    };
  }, [sameCategoryHistory]);

  useEffect(() => {
    setExpandedHistoryId(null);
  }, [vehicleId, cleanRepairType]);

  // Refs synced to animation loop so React UI state updates NEVER tear down WebGL
  const activeZoneRef = useRef<EvRepairZoneSpec>(activeZone);
  activeZoneRef.current = activeZone;
  const hoveredZoneIdRef = useRef<EvRepairZoneId | null>(null);
  const isXrayRef = useRef<boolean>(isXrayMode);
  const autoSpinRef = useRef<boolean>(autoSpin);
  const interactiveRef = useRef<boolean>(interactive);
  const onSelectZoneRef = useRef(onSelectZone);
  const modelRef = useRef<BuiltEvHologramModel | null>(null);
  const camTransitionRef = useRef<{
    active: boolean;
    pos: THREE.Vector3;
    target: THREE.Vector3;
  }>({
    active: true,
    pos: new THREE.Vector3(...activeZone.cameraPos),
    target: new THREE.Vector3(...activeZone.cameraTarget),
  });

  useEffect(() => {
    const zone = activeZoneRef.current;
    // Glide camera smoothly toward the newly chosen zone
    camTransitionRef.current.pos.set(...zone.cameraPos);
    camTransitionRef.current.target.set(...zone.cameraTarget);
    camTransitionRef.current.active = true;
    setCameraPreset("focus");
  }, [activeZone.id, modelKind]);

  useEffect(() => {
    isXrayRef.current = isXrayMode;
  }, [isXrayMode]);

  useEffect(() => {
    autoSpinRef.current = autoSpin;
  }, [autoSpin]);

  useEffect(() => {
    interactiveRef.current = interactive;
  }, [interactive]);

  useEffect(() => {
    onSelectZoneRef.current = onSelectZone;
  }, [onSelectZone]);

  useEffect(() => {
    if (modelRef.current) {
      modelRef.current.setVehicleLabel(vehicleId || "TTEV-EV");
    }
  }, [vehicleId]);

  const triggerCameraPreset = (preset: EvCameraPreset) => {
    setCameraPreset(preset);
    setAutoSpin(false);
    if (preset === "focus") {
      camTransitionRef.current.pos.set(...activeZoneRef.current.cameraPos);
      camTransitionRef.current.target.set(...activeZoneRef.current.cameraTarget);
    } else {
      const cfg = cameraPresets[preset];
      camTransitionRef.current.pos.set(...cfg.pos);
      camTransitionRef.current.target.set(...cfg.target);
    }
    camTransitionRef.current.active = true;
  };

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: "high-performance",
        alpha: false,
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    const initWidth = Math.max(260, mount.clientWidth || 480);
    const initHeight = Math.max(240, mount.clientHeight || 380);

    renderer.setSize(initWidth, initHeight);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    // WebGL context loss safety
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    const handleContextRestored = () => {
      setWebglUnavailable(false);
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);

    // Scene & Dark Obsidian Industrial Atmosphere (matching reference Image 2)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050b14);
    scene.fog = new THREE.FogExp2(0x050b14, 0.082);

    // Mandatory RoomEnvironment reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Camera
    const camera = new THREE.PerspectiveCamera(40, initWidth / initHeight, 0.1, 60);
    camera.position.set(...activeZoneRef.current.cameraPos);

    // Balanced 3-point automotive studio rig + RectAreaLight softboxes (hardware GPU) + Blue Glow PointLight
    const hemiLight = new THREE.HemisphereLight(0x93d5ff, 0x0b1628, 1.05);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff6eb, 1.85);
    keyLight.position.set(4.6, 6.4, 4.4);
    const isWideModel = modelKind === "clamp_truck" || modelKind === "trailer";
    const shadowExtent = isWideModel ? 4.8 : 3.4;
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 18;
      keyLight.shadow.camera.left = -shadowExtent;
      keyLight.shadow.camera.right = shadowExtent;
      keyLight.shadow.camera.top = shadowExtent;
      keyLight.shadow.camera.bottom = -shadowExtent;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x00d8ff, 2.0);
    rimLight.position.set(-4.4, 3.6, -4.0);
    scene.add(rimLight);

    const fillFrontLight = new THREE.DirectionalLight(0xbae6fd, 0.72);
    fillFrontLight.position.set(-3.2, 2.4, 4.2);
    scene.add(fillFrontLight);

    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const topSoftbox = new THREE.RectAreaLight(0xe0f2fe, 2.8, 3.8, 1.6);
      topSoftbox.position.set(0, 3.85, 0.2);
      topSoftbox.lookAt(0, 0.9, 0);
      scene.add(topSoftbox);

      const sideCyanStrip = new THREE.RectAreaLight(0x00d8ff, 2.2, 3.4, 0.45);
      sideCyanStrip.position.set(-2.9, 1.45, -0.4);
      sideCyanStrip.lookAt(0, 0.75, 0);
      scene.add(sideCyanStrip);
    }

    const hotspotPointLight = new THREE.PointLight(0x00e5ff, 2.35, 3.8, 1.65);
    hotspotPointLight.position.set(...activeZoneRef.current.hotspotPos);
    scene.add(hotspotPointLight);

    // Build Procedural 3D Hologram Vehicle Model (EV / TT Diesel / FL Forklift / SC Clamp Truck / TTL Trailer)
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const evModel = buildRepairHologramModel(modelKind, maxAnisotropy, vehicleId);
    scene.add(evModel.root);
    modelRef.current = evModel;

    // OrbitControls (360° orbit, zoom, smooth damping, touch-friendly)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = isWideModel ? 2.4 : 2.05;
    controls.maxDistance = isWideModel ? 9.8 : 7.4;
    controls.minPolarAngle = 0.14;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.target.set(...activeZoneRef.current.cameraTarget);
    controls.update();

    // Cancel automatic camera glide as soon as user interacts manually
    const handleControlStart = () => {
      camTransitionRef.current.active = false;
    };
    controls.addEventListener("start", handleControlStart);

    // Pre-compile shaders on hardware GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Raycasting setup (click vs drag detection + throttled hover)
    const raycaster = new THREE.Raycaster();
    const clickTargets: THREE.Object3D[] = [...evModel.clickableProxies];
    evModel.zoneMeshes.forEach((meshes) => {
      meshes.forEach((m) => clickTargets.push(m));
    });

    let pointerDownX = 0;
    let pointerDownY = 0;
    let lastHoverTs = 0;

    const getRaycastZoneId = (clientX: number, clientY: number): EvRepairZoneId | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      _rayMouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _rayMouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_rayMouse, camera);
      const hits = raycaster.intersectObjects(clickTargets, false);
      for (const hit of hits) {
        const zId = hit.object.userData?.zoneId as EvRepairZoneId | undefined;
        if (zId && getZoneByIdForModel(modelKind, zId)) {
          return zId;
        }
      }
      return null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!interactiveRef.current) return;
      const distSq =
        (e.clientX - pointerDownX) * (e.clientX - pointerDownX) +
        (e.clientY - pointerDownY) * (e.clientY - pointerDownY);
      if (distSq > 36) return; // User was orbiting/dragging, not clicking

      const zId = getRaycastZoneId(e.clientX, e.clientY);
      const spec = zId ? getZoneByIdForModel(modelKind, zId) : null;
      if (spec) {
        onSelectZoneRef.current?.(spec);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!interactiveRef.current) return;
      const now = performance.now();
      if (now - lastHoverTs < 45) return;
      lastHoverTs = now;

      const zId = getRaycastZoneId(e.clientX, e.clientY);
      if (zId !== hoveredZoneIdRef.current) {
        hoveredZoneIdRef.current = zId;
        setHoveredZone(zId ? getZoneByIdForModel(modelKind, zId) : null);
        renderer.domElement.style.cursor = zId ? "pointer" : "grab";
      }
    };

    const handlePointerLeave = () => {
      if (hoveredZoneIdRef.current !== null) {
        hoveredZoneIdRef.current = null;
        setHoveredZone(null);
        renderer.domElement.style.cursor = "grab";
      }
    };

    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);

    // ResizeObserver for crisp responsive resizing inside Modal 1 / Modal 2
    let viewportW = initWidth;
    let viewportH = initHeight;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(240, Math.round(entry.contentRect.width));
      const h = Math.max(220, Math.round(entry.contentRect.height));
      if (w === viewportW && h === viewportH) return;
      viewportW = w;
      viewportH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(mount);

    // Continuous 60 FPS animation loop (Software WebGL paced safely with afterDraw)
    const clock = new THREE.Clock();
    let frameId = 0;
    let isDisposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync !== "function") {
        frameId = window.setTimeout(cb, 85);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 6);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 6);
    };

    const tick = () => {
      if (isDisposed || document.hidden) return;

      const delta = Math.min(0.08, clock.getDelta());
      const elapsed = clock.getElapsedTime();
      const zone = activeZoneRef.current;

      // Smooth exponential camera preset/focus glide
      if (camTransitionRef.current.active) {
        _targetCamPos.copy(camTransitionRef.current.pos);
        _targetOrbitPos.copy(camTransitionRef.current.target);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 5.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 5.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 5.5, delta);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetOrbitPos.x, 6.0, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetOrbitPos.y, 6.0, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetOrbitPos.z, 6.0, delta);

        if (
          camera.position.distanceToSquared(_targetCamPos) < 0.0008 &&
          controls.target.distanceToSquared(_targetOrbitPos) < 0.0008
        ) {
          camTransitionRef.current.active = false;
        }
      }

      controls.autoRotate = !isSoftwareGl && autoSpinRef.current;
      controls.autoRotateSpeed = 1.4;
      controls.update();

      // Update active hotspot + secondary beacons (zero per-frame array allocations)
      _activeHotspotVec.set(...zone.hotspotPos);
      _secList.length = 0;
      if (zone.secondaryHotspots) {
        const count = Math.min(4, zone.secondaryHotspots.length);
        for (let i = 0; i < count; i++) {
          _secondaryVecPool[i].set(...zone.secondaryHotspots[i]);
          _secList.push(_secondaryVecPool[i]);
        }
      }

      evModel.updateFrame({
        elapsed,
        delta,
        activeZoneId: zone.id,
        hoveredZoneId: hoveredZoneIdRef.current,
        isXrayMode: isXrayRef.current,
        activeHotspotPos: _activeHotspotVec,
        secondaryHotspotPositions: _secList,
      });

      // Dynamic Blue Glow PointLight tracks active hotspot & breathes softly
      hotspotPointLight.position.lerp(_activeHotspotVec, Math.min(1, delta * 8));
      hotspotPointLight.intensity = 1.9 + 0.9 * Math.sin(elapsed * 3.8);

      renderer.render(scene, camera);

      // Project 3D active hotspot to 2D DOM callout overlay (locked with zero drift!)
      const overlayEl = calloutOverlayRef.current;
      if (overlayEl) {
        _projVec.copy(evModel.beaconGroup.position);
        _projVec.y += 0.22;
        _projVec.project(camera);
        if (_projVec.z < 1) {
          const sx = ((_projVec.x + 1) * 0.5) * viewportW;
          const sy = ((-_projVec.y + 1) * 0.5) * viewportH;
          const clampedX = Math.max(76, Math.min(viewportW - 76, sx));
          const clampedY = Math.max(48, Math.min(viewportH - 58, sy));
          overlayEl.style.opacity = "1";
          overlayEl.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0) translate(-50%, -100%)`;
        } else {
          overlayEl.style.opacity = "0";
        }
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    // Pause WebGL render loop automatically when browser tab is hidden to save GPU/battery
    const handleVisibilityChange = () => {
      if (isDisposed) return;
      if (document.hidden) {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(frameId);
      } else {
        clock.getDelta();
        tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (!document.hidden) {
      tick();
    }

    return () => {
      isDisposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener("start", handleControlStart);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
      evModel.dispose();
      envTex.dispose();
      renderer.dispose();
      modelRef.current = null;
    };
  }, [modelKind]);

  const viewportHeightClass = compact
    ? "h-[260px] sm:h-[290px]"
    : fillHeight
      ? "flex-1 min-h-[340px] lg:min-h-[420px]"
      : "h-[340px] sm:h-[400px] lg:h-[430px]";

  if (webglUnavailable) {
    return (
      <div
        className={`relative w-full overflow-hidden rounded-lg bg-[#050b14] border border-sky-900/50 flex flex-col items-center justify-center p-5 text-center ${
          compact
            ? "h-[260px]"
            : fillHeight
              ? "flex-1 min-h-[340px] lg:min-h-[420px]"
              : "h-[360px] lg:h-[430px]"
        }`}
      >
        <img
          src="/assets/aistudio/EV_37dc6f83.jpg"
          alt={`รถหัวลากไฟฟ้า EV ${vehicleId}`}
          referrerPolicy="no-referrer"
          className="max-h-48 object-contain rounded-md opacity-90"
        />
        <div className="mt-3 text-xs font-semibold text-sky-300">
          {vehicleId || "EV Tractor"} · {activeZone.nameTh}
        </div>
        <div className="text-[11px] text-slate-400 mt-1">{activeZone.locationTh}</div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg bg-[#050b14] border border-sky-900/60 select-none ${viewportHeightClass}`}
    >
      {/* Dedicated isolated WebGL canvas mount */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* Top-Left Clean Unboxed Metadata Overlay (Zero-Pill Discipline) */}
      <div
        className={`pointer-events-none absolute top-3 left-3.5 z-10 flex items-start justify-between gap-2 ${
          isHistoryOpen ? "right-[264px] sm:right-[286px]" : "right-40"
        }`}
      >
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-wide text-sky-100 truncate">
            {vehicleId || "MH-Fleet"} <span className="text-sky-400/70 mx-1">·</span>
            <span className="font-medium text-sky-300">{modelTitle}</span>
          </div>
          <div className="text-[11px] text-slate-300/90 mt-0.5 truncate">
            {activeZone.nameTh}
            <span className="text-slate-500 mx-1.5">/</span>
            <span className="text-slate-400">{activeZone.locationTh}</span>
          </div>
        </div>
      </div>

      {/* Right-Edge Collapsible Same-Category Repair History HUD (Inside 3D Hologram Window) */}
      {!isHistoryOpen ? (
        <button
          type="button"
          onClick={() => setIsHistoryOpen(true)}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2.5 right-2.5 z-20 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#061529]/92 hover:bg-[#0a213d] backdrop-blur-md border border-sky-400/45 text-[11px] font-semibold text-sky-100 shadow-[0_6px_20px_rgba(0,0,0,0.45)] transition-colors whitespace-nowrap"
          title="แสดงประวัติที่รถคันนี้เคยซ่อมในประเภทเดียวกัน"
        >
          <History size={13} className="text-sky-400 shrink-0" />
          <span>ประวัติซ่อมหมวดนี้</span>
          {cleanRepairType ? (
            <span
              className={`tabular-nums font-bold ${
                sameCategoryHistory.length > 0 ? "text-amber-300" : "text-sky-300/80"
              }`}
            >
              ({sameCategoryHistory.length})
            </span>
          ) : null}
        </button>
      ) : (
        <aside
          onWheel={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`absolute top-2.5 right-2.5 z-20 w-[248px] sm:w-[272px] max-w-[calc(100%-20px)] flex flex-col rounded-lg bg-[#051224]/90 backdrop-blur-md border border-sky-400/35 shadow-[0_12px_32px_rgba(0,0,0,0.62)] overflow-hidden ${
            compact ? "bottom-11" : "bottom-14"
          }`}
        >
          {/* HUD Header */}
          <div className="shrink-0 px-2.5 py-2 border-b border-sky-500/25 bg-[#081c36]/92 flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5">
              <History size={13} className="text-sky-400 shrink-0" />
              <span className="text-[11px] font-bold text-sky-100 truncate">
                ประวัติซ่อมหมวดเดียวกัน
              </span>
              {cleanRepairType && (
                <span
                  className={`text-[11px] font-bold tabular-nums shrink-0 ${
                    sameCategoryHistory.length > 0 ? "text-amber-300" : "text-slate-400"
                  }`}
                >
                  ({sameCategoryHistory.length})
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsHistoryOpen(false)}
              className="inline-flex items-center justify-center p-0.5 rounded text-slate-400 hover:text-white hover:bg-sky-500/20 transition-colors shrink-0"
              title="ซ่อนแถบประวัติซ่อม"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Active Vehicle & Category Sub-Bar */}
          <div className="shrink-0 px-2.5 py-1.5 bg-[#040d1a]/75 border-b border-sky-900/55 text-[10px]">
            <div className="flex items-center justify-between gap-1.5 text-slate-300">
              <span className="font-semibold text-sky-300 truncate">{vehicleId || "-"}</span>
              <span className="text-slate-500">·</span>
              <span className="truncate text-slate-200 font-medium">
                {cleanRepairType || "รอเลือกประเภทการซ่อม"}
              </span>
            </div>

            {cleanRepairType && sameCategoryHistory.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-sky-900/45 grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="min-w-0">
                  <div className="text-slate-400 leading-tight">ซ่อมล่าสุด</div>
                  <div className="font-semibold text-sky-100 tabular-nums truncate mt-0.5">
                    {latestHistory?.workingDateDisplay || "-"}
                  </div>
                  {latestHistory?.daysAgoLabel && (
                    <div className="text-[9.5px] text-amber-300/90 truncate">
                      {latestHistory.daysAgoLabel}
                    </div>
                  )}
                </div>
                <div className="min-w-0 text-right">
                  <div className="text-slate-400 leading-tight">
                    {totalHistoryCost > 0 ? "ยอดซ่อมสะสม" : "จำนวนครั้ง"}
                  </div>
                  <div className="font-semibold text-emerald-300 tabular-nums truncate mt-0.5">
                    {totalHistoryCost > 0
                      ? `฿${totalHistoryCost.toLocaleString("th-TH")}`
                      : `${validHistoryCount} ครั้ง`}
                  </div>
                  {totalHistoryCost > 0 && validHistoryCount > 0 && (
                    <div className="text-[9.5px] text-slate-400 tabular-nums truncate">
                      เฉลี่ย ฿{Math.round(totalHistoryCost / validHistoryCount).toLocaleString("th-TH")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Scrollable Same-Category Repair History Feed */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 [scrollbar-width:thin] [scrollbar-color:#1e3a5f_transparent]">
            {!cleanRepairType ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-2 py-4 text-[11px] text-slate-400 leading-relaxed">
                <History size={18} className="text-sky-500/60 mb-1.5" />
                <div>
                  เลือก <span className="text-sky-200 font-semibold">ประเภทการซ่อม</span> หรือคลิกจุดบนโมเดล 3D
                  เพื่อดูประวัติการซ่อมหมวดเดียวกันของรถคันนี้
                </div>
              </div>
            ) : sameCategoryHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-2 py-4 text-[11px] text-slate-400 leading-relaxed">
                <div className="font-semibold text-sky-200 mb-1">ยังไม่เคยซ่อมหมวดนี้</div>
                <div>
                  รถ <strong className="text-white">{vehicleId}</strong> ยังไม่พบประวัติการซ่อมในหมวด{" "}
                  <span className="text-sky-300">&ldquo;{cleanRepairType}&rdquo;</span>
                </div>
              </div>
            ) : (
              sameCategoryHistory.map((item) => {
                const isExpanded = expandedHistoryId === item.id;
                const statusColor =
                  item.statusTone === "completed"
                    ? "text-emerald-300"
                    : item.statusTone === "in_progress"
                      ? "text-amber-300"
                      : item.statusTone === "rejected"
                        ? "text-rose-300"
                        : "text-sky-300";

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setExpandedHistoryId(isExpanded ? null : item.id)}
                    className="w-full text-left rounded-md bg-[#091c34]/85 hover:bg-[#0d2647]/95 border border-sky-800/55 hover:border-sky-500/55 p-2 transition-colors space-y-1"
                  >
                    <div className="flex items-center justify-between gap-1.5 text-[10px]">
                      <span className="font-bold text-sky-100 tabular-nums shrink-0">
                        {item.workingDateDisplay}
                      </span>
                      <span className="text-slate-400 tabular-nums truncate">
                        {item.workOrderNo}
                      </span>
                      <span className={`font-semibold shrink-0 ${statusColor}`}>
                        {item.statusLabel}
                      </span>
                    </div>

                    <p
                      className={`text-[11px] text-slate-200 leading-snug break-words ${
                        isExpanded ? "" : "line-clamp-2"
                      }`}
                    >
                      {item.repairDescription || "-"}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] text-slate-400 pt-0.5 border-t border-sky-900/45">
                      <span className="tabular-nums">
                        {item.operatingHours && item.operatingHours > 0
                          ? `${item.operatingHours.toLocaleString("th-TH")} ชม.`
                          : "ไม่ระบุ ชม."}
                      </span>
                      {item.totalCost && item.totalCost > 0 ? (
                        <span className="font-semibold text-emerald-300 tabular-nums">
                          ฿{item.totalCost.toLocaleString("th-TH")}
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </div>

                    {(item.sparePartsSummary || (isExpanded && item.technicianOrVendor)) && (
                      <div className="text-[10px] text-sky-300/85 leading-snug pt-0.5 space-y-0.5">
                        {item.sparePartsSummary && (
                          <div className={isExpanded ? "" : "truncate"}>
                            อะไหล่: {item.sparePartsSummary}
                          </div>
                        )}
                        {isExpanded && item.technicianOrVendor && (
                          <div className="text-slate-400 truncate">
                            ช่าง/ผู้ให้บริการ: {item.technicianOrVendor}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* 3D-Projected Floating Callout Tag (Locked to Active Hotspot Coordinates) */}
      <div
        ref={calloutOverlayRef}
        className="pointer-events-none absolute top-0 left-0 z-10 transition-opacity duration-200"
        style={{ opacity: 0 }}
      >
        <div className="px-2.5 py-1 rounded bg-[#041222]/90 border border-sky-400/60 shadow-[0_0_16px_rgba(0,216,255,0.35)] whitespace-nowrap">
          <div className="text-[11px] font-bold text-sky-100 leading-tight">
            {hoveredZone ? hoveredZone.nameTh : activeZone.nameTh}
          </div>
          <div className="text-[10px] text-sky-300/90 leading-tight">
            {hoveredZone
              ? `คลิกเพื่อเลือก: ${hoveredZone.primaryRepairCategory}`
              : activeZone.primaryRepairCategory}
          </div>
        </div>
        <div className="mx-auto w-px h-3 bg-gradient-to-b from-sky-400/80 to-transparent" />
      </div>

      {/* Hover Guidance Hint (Only visible when hovering a different clickable 3D part) */}
      {interactive && hoveredZone && hoveredZone.id !== activeZone.id && (
        <div className="pointer-events-none absolute top-14 left-3.5 z-10 px-2.5 py-1 rounded bg-[#071a30]/92 border border-sky-400/50 text-[11px] text-sky-200">
          คลิกเพื่อระบุจุดซ่อม: <strong className="text-white">{hoveredZone.nameTh}</strong>
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Single-Row Horizontal Bar, Zero Viewport Occlusion) */}
      <div className="absolute bottom-2.5 inset-x-2 z-20 flex flex-col items-center pointer-events-none">
        <button
          type="button"
          onClick={() => setIsDockCollapsed((prev) => !prev)}
          className="pointer-events-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-t-md bg-[#071526]/95 border border-b-0 border-sky-500/35 text-[10px] font-semibold text-sky-200 hover:text-white hover:bg-[#0b213b] transition-colors whitespace-nowrap"
        >
          {isDockCollapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>{isDockCollapsed ? "เครื่องมือมุมมอง 3D" : "ซ่อนแถบควบคุม"}</span>
        </button>

        {!isDockCollapsed && (
          <div className="pointer-events-auto flex flex-nowrap items-center gap-1 px-2 py-1 rounded-lg bg-[#071526]/95 border border-sky-500/35 shadow-lg max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* X-Ray vs Solid Toggle */}
            <button
              type="button"
              onClick={() => setIsXrayMode((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isXrayMode
                  ? "bg-sky-500/25 text-sky-200 border border-sky-400/55"
                  : "bg-[#0d2138] text-slate-300 border border-slate-700 hover:text-white"
              }`}
              title="สลับโหมด X-Ray โฮโลแกรม และตัวถังจริง"
            >
              {isXrayMode ? <Layers size={12} /> : <Eye size={12} />}
              <span>{isXrayMode ? "X-Ray" : "ตัวถังจริง"}</span>
            </button>

            <span className="w-px h-3.5 bg-sky-800/70 mx-0.5 shrink-0" />

            {/* Focus Active Zone */}
            <button
              type="button"
              onClick={() => triggerCameraPreset("focus")}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                cameraPreset === "focus"
                  ? "bg-[#087eaf] text-white"
                  : "text-slate-300 hover:bg-[#0d243f] hover:text-white"
              }`}
              title="โฟกัสจุดซ่อมที่เลือก"
            >
              <Crosshair size={12} />
              <span>โฟกัส</span>
            </button>

            {/* Camera Angle Presets */}
            {(["iso", "side", "front", "rear", "top"] as const).map((presetKey) => (
              <button
                key={presetKey}
                type="button"
                onClick={() => triggerCameraPreset(presetKey)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  cameraPreset === presetKey
                    ? "bg-[#087eaf] text-white"
                    : "text-slate-300 hover:bg-[#0d243f] hover:text-white"
                }`}
                title={`มุมมอง${cameraPresets[presetKey].label}`}
              >
                {cameraPresets[presetKey].label}
              </button>
            ))}

            <span className="w-px h-3.5 bg-sky-800/70 mx-0.5 shrink-0" />

            {/* Auto Spin 360 Toggle */}
            <button
              type="button"
              onClick={() => setAutoSpin((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                autoSpin
                  ? "bg-sky-500/25 text-sky-200 border border-sky-400/50"
                  : "text-slate-300 hover:bg-[#0d243f] hover:text-white"
              }`}
              title="หมุนรอบคันอัตโนมัติ 360 องศา"
            >
              <RotateCw size={12} />
              <span>360°</span>
            </button>

            {/* Reset View */}
            <button
              type="button"
              onClick={() => triggerCameraPreset("iso")}
              className="inline-flex items-center justify-center p-1 rounded text-[11px] font-medium text-slate-300 hover:bg-[#0d243f] hover:text-white transition-colors whitespace-nowrap shrink-0"
              title="รีเซ็ตมุมกล้อง"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
