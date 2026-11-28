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
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  Layers,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import {
  EV_REPAIR_ZONES,
  EvRepairZoneId,
  EvRepairZoneSpec,
} from "./evRepairZones";
import {
  BuiltEvHologramModel,
  buildBydEvTractorModel,
} from "./evTractorHologramBuilder";

export type EvCameraPreset = "focus" | "iso" | "side" | "front" | "rear" | "top";

interface EvRepairHologramViewportProps {
  vehicleId: string;
  activeZone: EvRepairZoneSpec;
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

const CAMERA_PRESETS: Record<
  Exclude<EvCameraPreset, "focus">,
  { pos: [number, number, number]; target: [number, number, number]; label: string }
> = {
  iso: { pos: [3.25, 1.85, 3.05], target: [0, 0.8, 0], label: "เฉียง" },
  side: { pos: [3.95, 1.15, 0.05], target: [0, 0.82, 0], label: "ข้าง" },
  front: { pos: [0.05, 1.25, 3.85], target: [0, 0.8, 0.15], label: "หน้า" },
  rear: { pos: [0.05, 1.3, -3.85], target: [0, 0.8, -0.15], label: "หลัง" },
  top: { pos: [0.02, 4.45, 0.75], target: [0, 0.5, 0], label: "บน" },
};

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
  activeZone,
  interactive = true,
  compact = false,
  fillHeight = false,
  onSelectZone,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const calloutOverlayRef = useRef<HTMLDivElement | null>(null);

  const [isXrayMode, setIsXrayMode] = useState<boolean>(true);
  const [autoSpin, setAutoSpin] = useState<boolean>(false);
  const [cameraPreset, setCameraPreset] = useState<EvCameraPreset>("focus");
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(compact);
  const [hoveredZone, setHoveredZone] = useState<EvRepairZoneSpec | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);

  // Refs synced to animation loop so React UI state updates NEVER tear down WebGL
  const activeZoneRef = useRef<EvRepairZoneSpec>(activeZone);
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
    activeZoneRef.current = activeZone;
    // Glide camera smoothly toward the newly chosen zone
    camTransitionRef.current.pos.set(...activeZone.cameraPos);
    camTransitionRef.current.target.set(...activeZone.cameraTarget);
    camTransitionRef.current.active = true;
    setCameraPreset("focus");
  }, [activeZone]);

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
      const cfg = CAMERA_PRESETS[preset];
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
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 16;
      keyLight.shadow.camera.left = -3.2;
      keyLight.shadow.camera.right = 3.2;
      keyLight.shadow.camera.top = 3.2;
      keyLight.shadow.camera.bottom = -3.2;
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

    const hotspotPointLight = new THREE.PointLight(0x00e5ff, 2.35, 3.4, 1.65);
    hotspotPointLight.position.set(...activeZoneRef.current.hotspotPos);
    scene.add(hotspotPointLight);

    // Build Procedural BYD EV Tow Tractor 3D Hologram Model
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const evModel = buildBydEvTractorModel(maxAnisotropy, vehicleId || "TTEV-19");
    scene.add(evModel.root);
    modelRef.current = evModel;

    // OrbitControls (360° orbit, zoom, smooth damping, touch-friendly)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 2.05;
    controls.maxDistance = 6.8;
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
        if (zId && EV_REPAIR_ZONES[zId]) {
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
      if (zId && EV_REPAIR_ZONES[zId]) {
        onSelectZoneRef.current?.(EV_REPAIR_ZONES[zId]);
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
        setHoveredZone(zId ? EV_REPAIR_ZONES[zId] : null);
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
      if (isDisposed) return;

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

      // Update active hotspot + secondary beacons
      _activeHotspotVec.set(...zone.hotspotPos);
      const secList: THREE.Vector3[] = [];
      if (zone.secondaryHotspots) {
        for (let i = 0; i < Math.min(4, zone.secondaryHotspots.length); i++) {
          _secondaryVecPool[i].set(...zone.secondaryHotspots[i]);
          secList.push(_secondaryVecPool[i]);
        }
      }

      evModel.updateFrame({
        elapsed,
        delta,
        activeZoneId: zone.id,
        hoveredZoneId: hoveredZoneIdRef.current,
        isXrayMode: isXrayRef.current,
        activeHotspotPos: _activeHotspotVec,
        secondaryHotspotPositions: secList,
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

    tick();

    return () => {
      isDisposed = true;
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
  }, []);

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
      <div className="pointer-events-none absolute top-3 left-3.5 right-3.5 z-10 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-wide text-sky-100 truncate">
            {vehicleId || "TTEV"} <span className="text-sky-400/70 mx-1">·</span>
            <span className="font-medium text-sky-300">หัวลากไฟฟ้า EV (360° Hologram)</span>
          </div>
          <div className="text-[11px] text-slate-300/90 mt-0.5 truncate">
            {activeZone.nameTh}
            <span className="text-slate-500 mx-1.5">/</span>
            <span className="text-slate-400">{activeZone.locationTh}</span>
          </div>
        </div>
      </div>

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
                title={`มุมมอง${CAMERA_PRESETS[presetKey].label}`}
              >
                {CAMERA_PRESETS[presetKey].label}
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
