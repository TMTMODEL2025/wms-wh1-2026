/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { buildClampTruckRoot } from "../fleet3d/VehicleParkingYard3D";
import {
  buildFlatbedTrailer,
  buildForklift,
  createPm3dTexturePack,
  createVehicleNumberDecalTexture,
} from "../pm3d/pm3dVehicleBuilders";
import {
  CLAMP_TRUCK_INTERACTIVE_ZONE_LIST,
  EvRepairZoneId,
  FORKLIFT_INTERACTIVE_ZONE_LIST,
  RepairVehicleModelKind,
  TRAILER_INTERACTIVE_ZONE_LIST,
} from "./evRepairZones";
import {
  BuiltEvHologramModel,
  animateHotspotBeacon,
  buildBydEvTractorModel,
  createHotspotBeacon,
} from "./evTractorHologramBuilder";

const _tmpColor = new THREE.Color();
const _cyanGlowColor = new THREE.Color("#00e5ff");
const _hoverGlowColor = new THREE.Color("#38bdf8");
const _deepCyanEmissive = new THREE.Color("#0284c7");

const _tmpBox = new THREE.Box3();
const _tmpCenter = new THREE.Vector3();

/**
 * Helper: Attach crisp cyan hologram wireframe edge lines to a mesh.
 */
function attachHoloEdges(
  mesh: THREE.Mesh,
  wireMat: THREE.LineBasicMaterial,
  geometries: THREE.BufferGeometry[],
  holoEdgeLines: THREE.LineSegments[],
  threshold = 24
) {
  if (!mesh.geometry) return;
  const edges = new THREE.EdgesGeometry(mesh.geometry, threshold);
  geometries.push(edges);
  const lines = new THREE.LineSegments(edges, wireMat);
  lines.position.copy(mesh.position);
  lines.rotation.copy(mesh.rotation);
  lines.scale.copy(mesh.scale);
  mesh.parent?.add(lines);
  holoEdgeLines.push(lines);
}

/**
 * Helper: Add invisible clickable spherical hitboxes for every interactive zone on the model
 * so operators can click any repair zone effortlessly on desktop or mobile.
 */
function buildClickableZoneProxies(
  root: THREE.Group,
  zones: Array<{ id: EvRepairZoneId; hotspotPos: [number, number, number]; secondaryHotspots?: [number, number, number][] }>,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
  radiusBase = 0.26
): THREE.Mesh[] {
  const proxies: THREE.Mesh[] = [];
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  materials.push(proxyMat);

  for (const zone of zones) {
    const r =
      zone.id === "hydraulics" || zone.id === "structure" || zone.id === "motor"
        ? radiusBase * 1.25
        : radiusBase;
    const geo = new THREE.SphereGeometry(r, 12, 10);
    geometries.push(geo);
    const proxy = new THREE.Mesh(geo, proxyMat);
    proxy.position.set(...zone.hotspotPos);
    proxy.userData.zoneId = zone.id;
    proxy.name = `proxy_${zone.id}`;
    root.add(proxy);
    proxies.push(proxy);

    if (zone.secondaryHotspots) {
      zone.secondaryHotspots.forEach((pos, idx) => {
        const subGeo = new THREE.SphereGeometry(radiusBase * 0.9, 10, 8);
        geometries.push(subGeo);
        const sub = new THREE.Mesh(subGeo, proxyMat);
        sub.position.set(...pos);
        sub.userData.zoneId = zone.id;
        sub.name = `proxy_${zone.id}_${idx}`;
        root.add(sub);
        proxies.push(sub);
      });
    }
  }

  return proxies;
}

/**
 * Helper: Build a clean dark obsidian studio floor disc (NO glowing floor rings).
 */
function addCleanStudioFloor(
  root: THREE.Group,
  radius: number,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[]
) {
  const floorGeo = new THREE.CircleGeometry(radius, 56);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x050b14,
    roughness: 0.36,
    metalness: 0.42,
  });
  geometries.push(floorGeo);
  materials.push(floorMat);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  root.add(floor);
}

/**
 * 3D Hologram Forklift (FL-*) — wraps the existing photorealistic `buildForklift` model
 * with smooth Solid <-> X-Ray Hologram morph, cyan edge lines, and Blue Glow + Expanding Ring hotspots.
 */
function buildForkliftHologramModel(
  maxAnisotropy: number,
  initialVehicleId = "FL-01"
): BuiltEvHologramModel {
  const root = new THREE.Group();
  root.name = "FL_Forklift_Hologram";

  const textures = createPm3dTexturePack(maxAnisotropy);
  const built = buildForklift(textures, initialVehicleId || "FL-01");
  root.add(built.root);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dynamicTextures: THREE.Texture[] = [];

  addCleanStudioFloor(root, 7.6, geometries, materials);

  const holoWireMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.36,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(holoWireMat);

  const shellMaterials: BuiltEvHologramModel["shellMaterials"] = [];
  const holoEdgeLines: THREE.LineSegments[] = [];
  const zoneMeshes = new Map<EvRepairZoneId, THREE.Mesh[]>();
  const meshBaseVisuals: BuiltEvHologramModel["meshBaseVisuals"] = new Map();

  const registerRepairZoneMesh = (zoneId: EvRepairZoneId, mesh: THREE.Mesh) => {
    // Give each zone mesh an isolated material clone so glowing one zone never bleeds into other zones
    if (mesh.material && !Array.isArray(mesh.material)) {
      const cloned = mesh.material.clone();
      materials.push(cloned);
      mesh.material = cloned;
    }
    const list = zoneMeshes.get(zoneId) || [];
    list.push(mesh);
    zoneMeshes.set(zoneId, list);
    mesh.userData.zoneId = zoneId;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && "color" in mat && "emissive" in mat) {
      meshBaseVisuals.set(mesh, {
        color: mat.color.clone(),
        emissive: mat.emissive.clone(),
        emissiveIntensity: mat.emissiveIntensity ?? 0,
        opacity: mat.opacity ?? 1,
      });
    }
  };

  // Track dynamic registration decal meshes for live vehicle ID switching
  const decalMeshes: THREE.Mesh[] = [];
  const seenShellMats = new Set<THREE.Material>();

  built.root.updateMatrixWorld(true);
  built.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    // Collect dynamic vehicle number decals
    if (obj.userData?.decalStyle) {
      decalMeshes.push(obj);
      return;
    }

    const srcZone = String(obj.userData?.zoneId || "");
    const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

    // Identify outer painted yellow panels/counterweight -> smooth X-Ray Hologram morph
    if (mat && "color" in mat && mat.color) {
      const hex = mat.color.getHex();
      const isYellowShell = hex === 0xf4b400 && srcZone !== "fl_wheels";
      if (isYellowShell) {
        if (!seenShellMats.has(mat)) {
          seenShellMats.add(mat);
          mat.transparent = true;
          shellMaterials.push({
            material: mat,
            solidOpacity: 0.99,
            xrayOpacity: 0.28,
            solidColor: mat.color.clone(),
            xrayColor: new THREE.Color(0x1674b8),
            solidEmissive: new THREE.Color(0x1c1404),
            xrayEmissive: new THREE.Color(0x06578c),
            solidEmissiveIntensity: 0.08,
            xrayEmissiveIntensity: 0.52,
          });
        }
        attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 26);
        return;
      }
    }

    // Map PM3D Forklift zones to our 3D Repair Zones
    if (srcZone === "fl_hydraulics") {
      registerRepairZoneMesh("hydraulics", obj);
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 28);
    } else if (srcZone === "fl_mast_forks") {
      registerRepairZoneMesh("structure", obj);
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 28);
    } else if (srcZone === "fl_powertrain") {
      _tmpBox.setFromObject(obj);
      _tmpBox.getCenter(_tmpCenter);
      if (_tmpCenter.z < -0.72) {
        registerRepairZoneMesh("cooling", obj);
      } else {
        registerRepairZoneMesh("motor", obj);
      }
    } else if (srcZone === "fl_counterweight") {
      registerRepairZoneMesh("cooling", obj);
    } else if (srcZone === "fl_cabin") {
      registerRepairZoneMesh("sensors", obj);
    } else if (srcZone === "fl_rops_lights") {
      registerRepairZoneMesh("lighting", obj);
    } else if (srcZone === "fl_wheels") {
      registerRepairZoneMesh("tires", obj);
    }
  });

  // Add subtle internal battery & fuel modules inside the Forklift body so X-Ray mode reveals rich systems
  const internalBatteryMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    roughness: 0.36,
    metalness: 0.55,
    emissive: 0x052540,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 1,
  });
  materials.push(internalBatteryMat);
  const battGeo = new THREE.BoxGeometry(0.24, 0.22, 0.28);
  geometries.push(battGeo);
  const battMesh = new THREE.Mesh(battGeo, internalBatteryMat);
  battMesh.position.set(0.36, 0.68, -0.45);
  built.root.add(battMesh);
  registerRepairZoneMesh("battery", battMesh);

  const internalFuelMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.42,
    metalness: 0.68,
    emissive: 0x052540,
    emissiveIntensity: 0.2,
    transparent: true,
    opacity: 1,
  });
  materials.push(internalFuelMat);
  const fuelGeo = new THREE.BoxGeometry(0.22, 0.24, 0.42);
  geometries.push(fuelGeo);
  const fuelMesh = new THREE.Mesh(fuelGeo, internalFuelMat);
  fuelMesh.position.set(-0.38, 0.68, -0.42);
  built.root.add(fuelMesh);
  registerRepairZoneMesh("charging", fuelMesh);

  // Clickable proxies for all Forklift repair zones
  const clickableProxies = buildClickableZoneProxies(
    root,
    FORKLIFT_INTERACTIVE_ZONE_LIST,
    geometries,
    materials,
    0.26
  );

  // 3D Pulsing Repair Hotspot Beacons (Primary + 4 Secondary)
  const beaconGroup = createHotspotBeacon(1.0, { geometries, materials });
  root.add(beaconGroup);

  const secondaryBeaconGroups: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const sub = createHotspotBeacon(0.68, { geometries, materials });
    sub.visible = false;
    root.add(sub);
    secondaryBeaconGroups.push(sub);
  }

  let xrayBlend = 1;
  const smoothedFocusPos = new THREE.Vector3(0, 1.38, 1.12);

  const updateFrame: BuiltEvHologramModel["updateFrame"] = ({
    elapsed,
    delta,
    activeZoneId,
    hoveredZoneId,
    isXrayMode,
    activeHotspotPos,
    secondaryHotspotPositions,
  }) => {
    const safeDelta = Math.min(0.1, Math.max(0.001, delta));
    const targetXray = isXrayMode ? 1 : 0;
    xrayBlend = THREE.MathUtils.damp(xrayBlend, targetXray, 6.2, safeDelta);

    for (const sm of shellMaterials) {
      sm.material.opacity = THREE.MathUtils.lerp(sm.solidOpacity, sm.xrayOpacity, xrayBlend);
      sm.material.color.lerpColors(sm.solidColor, sm.xrayColor, xrayBlend);
      sm.material.emissive.lerpColors(sm.solidEmissive, sm.xrayEmissive, xrayBlend);
      sm.material.emissiveIntensity = THREE.MathUtils.lerp(
        sm.solidEmissiveIntensity,
        sm.xrayEmissiveIntensity,
        xrayBlend
      );
      sm.material.depthWrite = sm.material.opacity > 0.72;
    }

    holoWireMat.opacity = THREE.MathUtils.lerp(
      0.04,
      0.4 + 0.08 * Math.sin(elapsed * 2.2),
      xrayBlend
    );

    const glowPulse = 0.5 + 0.5 * Math.sin(elapsed * 4.1);
    zoneMeshes.forEach((meshes, zoneId) => {
      const isActive =
        zoneId === activeZoneId ||
        (activeZoneId === "brakes" && zoneId === "tires") ||
        (activeZoneId === "suspension" && zoneId === "tires") ||
        (activeZoneId === "drivetrain" && zoneId === "motor") ||
        (activeZoneId === "overview" && (zoneId === "hydraulics" || zoneId === "motor"));
      const isHovered = zoneId === hoveredZoneId && !isActive;

      for (const mesh of meshes) {
        const base = meshBaseVisuals.get(mesh);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!base || !mat) continue;

        if (isActive) {
          const boost =
            activeZoneId === "overview" ? 0.65 + glowPulse * 0.45 : 1.1 + glowPulse * 0.9;
          _tmpColor.copy(base.color).lerp(_cyanGlowColor, 0.45 + glowPulse * 0.22);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_cyanGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, boost, 8, safeDelta);
        } else if (isHovered) {
          _tmpColor.copy(base.color).lerp(_hoverGlowColor, 0.34);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_hoverGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, 0.85, 8, safeDelta);
        } else {
          mat.color.lerp(base.color, Math.min(1, safeDelta * 7));
          const idleEmissive = isXrayMode ? _deepCyanEmissive : base.emissive;
          mat.emissive.lerp(idleEmissive, Math.min(1, safeDelta * 7));
          const idleIntensity = isXrayMode
            ? Math.max(0.14, base.emissiveIntensity * 0.65)
            : base.emissiveIntensity * 0.45;
          mat.emissiveIntensity = THREE.MathUtils.damp(
            mat.emissiveIntensity,
            idleIntensity,
            7,
            safeDelta
          );
        }
      }
    });

    smoothedFocusPos.x = THREE.MathUtils.damp(smoothedFocusPos.x, activeHotspotPos.x, 9, safeDelta);
    smoothedFocusPos.y = THREE.MathUtils.damp(smoothedFocusPos.y, activeHotspotPos.y, 9, safeDelta);
    smoothedFocusPos.z = THREE.MathUtils.damp(smoothedFocusPos.z, activeHotspotPos.z, 9, safeDelta);

    beaconGroup.position.copy(smoothedFocusPos);
    animateHotspotBeacon(beaconGroup, elapsed, 0, true);

    secondaryBeaconGroups.forEach((subGroup, idx) => {
      const pos = secondaryHotspotPositions[idx];
      if (pos) {
        subGroup.visible = true;
        subGroup.position.copy(pos);
        animateHotspotBeacon(subGroup, elapsed, (idx + 1) * 1.15, false);
      } else {
        subGroup.visible = false;
      }
    });
  };

  const setVehicleLabel = (vehicleId: string) => {
    const cleanCode = (vehicleId || "FL-01").trim();
    const sideTex = createVehicleNumberDecalTexture(cleanCode, "yellow_body", maxAnisotropy);
    const roofTex = createVehicleNumberDecalTexture(cleanCode, "forklift_roof", maxAnisotropy);
    dynamicTextures.push(sideTex, roofTex);

    decalMeshes.forEach((dm) => {
      const mat = dm.material as THREE.MeshStandardMaterial;
      if (!mat) return;
      mat.map = dm.userData.decalStyle === "forklift_roof" ? roofTex : sideTex;
      mat.needsUpdate = true;
    });
  };

  const dispose = () => {
    built.dispose();
    textures.dispose();
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    dynamicTextures.forEach((t) => t.dispose());
  };

  return {
    root,
    shellMaterials,
    holoEdgeLines,
    zoneMeshes,
    meshBaseVisuals,
    clickableProxies,
    floorShaderMaterial: null,
    beaconGroup,
    secondaryBeaconGroups,
    updateFrame,
    setVehicleLabel,
    dispose,
  };
}

/**
 * 3D Hologram Steel/Scrap Clamp Truck (SC-01 / หแ-01) — reuses the EXACT existing
 * `buildClampTruckRoot` model from VehicleParkingYard3D, enhanced with dynamic registration decals,
 * internal X-Ray engine/hydraulic assemblies, glowing cyan edge lines, and 3D pulsing hotspots.
 */
function buildClampTruckHologramModel(
  maxAnisotropy: number,
  initialVehicleId = "SC-01"
): BuiltEvHologramModel {
  const root = new THREE.Group();
  root.name = "SC_Clamp_Truck_Hologram";

  const textures = createPm3dTexturePack(maxAnisotropy);
  const clampRoot = buildClampTruckRoot(textures);
  root.add(clampRoot);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dynamicTextures: THREE.Texture[] = [];

  addCleanStudioFloor(root, 9.2, geometries, materials);

  // Soft Ground Contact Shadow directly beneath the 4 tires & undercarriage
  const shadowGeo = new THREE.PlaneGeometry(3.2, 4.4);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    depthWrite: false,
    opacity: 0.82,
  });
  geometries.push(shadowGeo);
  materials.push(shadowMat);
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0, 0.008, -0.08);
  root.add(shadowPlane);

  const holoWireMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.36,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(holoWireMat);

  const shellMaterials: BuiltEvHologramModel["shellMaterials"] = [];
  const holoEdgeLines: THREE.LineSegments[] = [];
  const zoneMeshes = new Map<EvRepairZoneId, THREE.Mesh[]>();
  const meshBaseVisuals: BuiltEvHologramModel["meshBaseVisuals"] = new Map();
  const decalMeshes: THREE.Mesh[] = [];

  // Keep track of original geometries/materials inside clampRoot for clean disposal
  const clampOwnedGeos = new Set<THREE.BufferGeometry>();
  const clampOwnedMats = new Set<THREE.Material>();

  const registerRepairZoneMesh = (zoneId: EvRepairZoneId, mesh: THREE.Mesh) => {
    if (mesh.material && !Array.isArray(mesh.material)) {
      const cloned = mesh.material.clone();
      materials.push(cloned);
      mesh.material = cloned;
    }
    const list = zoneMeshes.get(zoneId) || [];
    list.push(mesh);
    zoneMeshes.set(zoneId, list);
    mesh.userData.zoneId = zoneId;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && "color" in mat && "emissive" in mat) {
      meshBaseVisuals.set(mesh, {
        color: mat.color.clone(),
        emissive: mat.emissive.clone(),
        emissiveIntensity: mat.emissiveIntensity ?? 0,
        opacity: mat.opacity ?? 1,
      });
    }
  };

  const applyClampDecals = (vehicleId: string) => {
    const cleanCode = (vehicleId || "SC-01").trim();
    const roofTex = createVehicleNumberDecalTexture(cleanCode, "forklift_roof", maxAnisotropy);
    const sideTex = createVehicleNumberDecalTexture(cleanCode, "yellow_body", maxAnisotropy);
    dynamicTextures.push(roofTex, sideTex);

    decalMeshes.forEach((dm) => {
      const isRoof = dm.userData.decalStyle === "forklift_roof";
      const nextMat = new THREE.MeshStandardMaterial({
        map: isRoof ? roofTex : sideTex,
        transparent: !isRoof,
        roughness: 0.36,
        metalness: 0.08,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      materials.push(nextMat);
      dm.material = nextMat;
    });
  };

  clampRoot.updateMatrixWorld(true);
  clampRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.geometry) clampOwnedGeos.add(obj.geometry);
    if (obj.material && !Array.isArray(obj.material)) clampOwnedMats.add(obj.material);

    if (obj.userData?.decalStyle) {
      decalMeshes.push(obj);
      return;
    }

    _tmpBox.setFromObject(obj);
    _tmpBox.getCenter(_tmpCenter);
    const mat = obj.material as THREE.MeshStandardMaterial;
    const hex = mat && "color" in mat && mat.color ? mat.color.getHex() : 0;

    // 1. Yellow rear engine hood, counterweight & cabin shell -> smooth X-Ray Hologram shell
    const isRearHouseYellow = hex === 0xeab308 && _tmpCenter.z < 0.85 && _tmpCenter.y > 1.05;
    const isCabGlass = hex === 0x0f172a && _tmpCenter.x < 0 && _tmpCenter.y > 1.5;

    if (isRearHouseYellow || isCabGlass) {
      const cloned = mat.clone();
      cloned.transparent = true;
      materials.push(cloned);
      obj.material = cloned;

      shellMaterials.push({
        material: cloned,
        solidOpacity: isCabGlass ? 0.52 : 0.99,
        xrayOpacity: isCabGlass ? 0.2 : 0.28,
        solidColor: cloned.color.clone(),
        xrayColor: new THREE.Color(isCabGlass ? 0x38bdf8 : 0x1674b8),
        solidEmissive: new THREE.Color(0x051829),
        xrayEmissive: new THREE.Color(0x06578c),
        solidEmissiveIntensity: 0.08,
        xrayEmissiveIntensity: isCabGlass ? 0.42 : 0.52,
      });
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 26);

      // Still allow clicking the cab roof/window for cabin/hvac
      if (_tmpCenter.x < -0.1 && _tmpCenter.z > -0.3) {
        obj.userData.zoneId = _tmpCenter.y > 2.2 ? "hvac" : "sensors";
      } else {
        obj.userData.zoneId = "motor";
      }
      return;
    }

    // 2. Classify all mechanical assemblies of buildClampTruckRoot into repair zones
    if (_tmpCenter.z > 2.15) {
      // 4-claw 360° Steel Grapple Head
      registerRepairZoneMesh("structure", obj);
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 26);
    } else if (
      _tmpCenter.z > 0.72 &&
      _tmpCenter.y > 1.25 &&
      _tmpCenter.x > 0.1
    ) {
      // Boom, Stick Arm & Hydraulic Cylinders
      if (hex === 0xe2e8f0 || hex === 0x1e293b) {
        registerRepairZoneMesh("hydraulics", obj);
      } else {
        registerRepairZoneMesh("structure", obj);
      }
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 28);
    } else if (_tmpCenter.y > 2.18 && _tmpCenter.x < 0) {
      // Roof beacon & front work lights
      registerRepairZoneMesh("lighting", obj);
    } else if (Math.abs(_tmpCenter.x) > 0.62 && _tmpCenter.y < 0.85 && _tmpCenter.z > -1.15) {
      // 4 Heavy Pneumatic Wheels & Rims
      registerRepairZoneMesh("tires", obj);
    } else if (_tmpCenter.z < -1.18 && _tmpCenter.y < 0.75) {
      // Rear Stabilizer Outriggers
      registerRepairZoneMesh("suspension", obj);
    } else if (_tmpCenter.y >= 0.7 && _tmpCenter.y <= 1.05 && Math.abs(_tmpCenter.z + 0.2) < 0.4) {
      // Slewing Ring Turntable
      registerRepairZoneMesh("drivetrain", obj);
    } else if (_tmpCenter.y > 1.75 && _tmpCenter.x > 0.35 && _tmpCenter.z < -0.6) {
      // Exhaust stack
      registerRepairZoneMesh("motor", obj);
    } else if (_tmpCenter.y < 0.85) {
      // Undercarriage chassis
      registerRepairZoneMesh("suspension", obj);
    } else {
      registerRepairZoneMesh("sensors", obj);
    }
  });

  // Apply dynamic registration decals (SC-01 / หแ-01 / vehicleId)
  applyClampDecals(initialVehicleId);

  // Add detailed internal mechanical components inside the yellow rear engine house
  // so X-Ray Hologram mode reveals the Diesel Engine, Hydraulic Pump, Radiator, Fuel Tank & 24V Battery!
  const makeInternalMat = (colorHex: number, roughness = 0.42, metalness = 0.65) => {
    const m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness,
      metalness,
      emissive: 0x052540,
      emissiveIntensity: 0.26,
      transparent: true,
      opacity: 1,
    });
    materials.push(m);
    return m;
  };

  // Internal Diesel Engine Block
  const engGeo = new THREE.BoxGeometry(0.62, 0.42, 0.74);
  geometries.push(engGeo);
  const engMesh = new THREE.Mesh(engGeo, makeInternalMat(0x475569));
  engMesh.position.set(0, 1.44, -0.68);
  clampRoot.add(engMesh);
  registerRepairZoneMesh("motor", engMesh);

  // Internal Main Hydraulic Pump
  const pumpGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 18);
  pumpGeo.rotateZ(Math.PI / 2);
  geometries.push(pumpGeo);
  const pumpMesh = new THREE.Mesh(pumpGeo, makeInternalMat(0x0284c7, 0.3, 0.6));
  pumpMesh.position.set(0.32, 1.42, -0.22);
  clampRoot.add(pumpMesh);
  registerRepairZoneMesh("hydraulics", pumpMesh);

  // Internal Rear Radiator & Oil Cooler
  const radGeo = new THREE.BoxGeometry(0.58, 0.44, 0.12);
  geometries.push(radGeo);
  const radMat = new THREE.MeshStandardMaterial({
    map: textures.radiatorFins,
    roughness: 0.38,
    metalness: 0.72,
    emissive: 0x052540,
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 1,
  });
  materials.push(radMat);
  const radMesh = new THREE.Mesh(radGeo, radMat);
  radMesh.position.set(0.38, 1.46, -1.16);
  clampRoot.add(radMesh);
  registerRepairZoneMesh("cooling", radMesh);

  // Internal Diesel Fuel Tank (Left Side)
  const tankGeo = new THREE.BoxGeometry(0.32, 0.36, 0.56);
  geometries.push(tankGeo);
  const tankMesh = new THREE.Mesh(tankGeo, makeInternalMat(0x334155));
  tankMesh.position.set(-0.58, 1.4, -0.78);
  clampRoot.add(tankMesh);
  registerRepairZoneMesh("charging", tankMesh);

  // Internal 24V Battery Pack (Right Side)
  const batGeo = new THREE.BoxGeometry(0.3, 0.28, 0.42);
  geometries.push(batGeo);
  const batMesh = new THREE.Mesh(batGeo, makeInternalMat(0x0ea5e9, 0.35, 0.5));
  batMesh.position.set(0.58, 1.38, -0.46);
  clampRoot.add(batMesh);
  registerRepairZoneMesh("battery", batMesh);

  // Clickable proxies for all Clamp Truck repair zones
  const clickableProxies = buildClickableZoneProxies(
    root,
    CLAMP_TRUCK_INTERACTIVE_ZONE_LIST,
    geometries,
    materials,
    0.3
  );

  // 3D Pulsing Repair Hotspot Beacons (Primary + 4 Secondary)
  const beaconGroup = createHotspotBeacon(1.15, { geometries, materials });
  root.add(beaconGroup);

  const secondaryBeaconGroups: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const sub = createHotspotBeacon(0.76, { geometries, materials });
    sub.visible = false;
    root.add(sub);
    secondaryBeaconGroups.push(sub);
  }

  let xrayBlend = 1;
  const smoothedFocusPos = new THREE.Vector3(0.32, 1.85, 1.18);

  const updateFrame: BuiltEvHologramModel["updateFrame"] = ({
    elapsed,
    delta,
    activeZoneId,
    hoveredZoneId,
    isXrayMode,
    activeHotspotPos,
    secondaryHotspotPositions,
  }) => {
    const safeDelta = Math.min(0.1, Math.max(0.001, delta));
    const targetXray = isXrayMode ? 1 : 0;
    xrayBlend = THREE.MathUtils.damp(xrayBlend, targetXray, 6.2, safeDelta);

    for (const sm of shellMaterials) {
      sm.material.opacity = THREE.MathUtils.lerp(sm.solidOpacity, sm.xrayOpacity, xrayBlend);
      sm.material.color.lerpColors(sm.solidColor, sm.xrayColor, xrayBlend);
      sm.material.emissive.lerpColors(sm.solidEmissive, sm.xrayEmissive, xrayBlend);
      sm.material.emissiveIntensity = THREE.MathUtils.lerp(
        sm.solidEmissiveIntensity,
        sm.xrayEmissiveIntensity,
        xrayBlend
      );
      sm.material.depthWrite = sm.material.opacity > 0.72;
    }

    holoWireMat.opacity = THREE.MathUtils.lerp(
      0.04,
      0.4 + 0.08 * Math.sin(elapsed * 2.2),
      xrayBlend
    );

    const glowPulse = 0.5 + 0.5 * Math.sin(elapsed * 4.1);
    zoneMeshes.forEach((meshes, zoneId) => {
      const isActive =
        zoneId === activeZoneId ||
        (activeZoneId === "brakes" && zoneId === "tires") ||
        (activeZoneId === "hvac" && zoneId === "sensors") ||
        (activeZoneId === "overview" && (zoneId === "hydraulics" || zoneId === "structure"));
      const isHovered = zoneId === hoveredZoneId && !isActive;

      for (const mesh of meshes) {
        const base = meshBaseVisuals.get(mesh);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!base || !mat) continue;

        if (isActive) {
          const boost =
            activeZoneId === "overview" ? 0.65 + glowPulse * 0.45 : 1.1 + glowPulse * 0.9;
          _tmpColor.copy(base.color).lerp(_cyanGlowColor, 0.45 + glowPulse * 0.22);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_cyanGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, boost, 8, safeDelta);
        } else if (isHovered) {
          _tmpColor.copy(base.color).lerp(_hoverGlowColor, 0.34);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_hoverGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, 0.85, 8, safeDelta);
        } else {
          mat.color.lerp(base.color, Math.min(1, safeDelta * 7));
          const idleEmissive = isXrayMode ? _deepCyanEmissive : base.emissive;
          mat.emissive.lerp(idleEmissive, Math.min(1, safeDelta * 7));
          const idleIntensity = isXrayMode
            ? Math.max(0.14, base.emissiveIntensity * 0.65)
            : base.emissiveIntensity * 0.45;
          mat.emissiveIntensity = THREE.MathUtils.damp(
            mat.emissiveIntensity,
            idleIntensity,
            7,
            safeDelta
          );
        }
      }
    });

    smoothedFocusPos.x = THREE.MathUtils.damp(smoothedFocusPos.x, activeHotspotPos.x, 9, safeDelta);
    smoothedFocusPos.y = THREE.MathUtils.damp(smoothedFocusPos.y, activeHotspotPos.y, 9, safeDelta);
    smoothedFocusPos.z = THREE.MathUtils.damp(smoothedFocusPos.z, activeHotspotPos.z, 9, safeDelta);

    beaconGroup.position.copy(smoothedFocusPos);
    animateHotspotBeacon(beaconGroup, elapsed, 0, true);

    secondaryBeaconGroups.forEach((subGroup, idx) => {
      const pos = secondaryHotspotPositions[idx];
      if (pos) {
        subGroup.visible = true;
        subGroup.position.copy(pos);
        animateHotspotBeacon(subGroup, elapsed, (idx + 1) * 1.15, false);
      } else {
        subGroup.visible = false;
      }
    });
  };

  const setVehicleLabel = (vehicleId: string) => {
    applyClampDecals(vehicleId);
  };

  const dispose = () => {
    textures.dispose();
    clampOwnedGeos.forEach((g) => g.dispose());
    clampOwnedMats.forEach((m) => m.dispose());
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    dynamicTextures.forEach((t) => t.dispose());
  };

  return {
    root,
    shellMaterials,
    holoEdgeLines,
    zoneMeshes,
    meshBaseVisuals,
    clickableProxies,
    floorShaderMaterial: null,
    beaconGroup,
    secondaryBeaconGroups,
    updateFrame,
    setVehicleLabel,
    dispose,
  };
}

/**
 * 3D Hologram Flatbed Trailer (TTL-*) — wraps the existing photorealistic `buildFlatbedTrailer` model
 * with smooth Solid <-> X-Ray Hologram deck morph (revealing I-beams, turntable ring, leaf springs,
 * axles, air brake chambers & air reservoir tank underneath), dynamic TTL-* decals, cyan edge lines,
 * and Blue Glow + Expanding Ring 3D pulsing hotspots.
 */
function buildTrailerHologramModel(
  maxAnisotropy: number,
  initialVehicleId = "TTL-01"
): BuiltEvHologramModel {
  const root = new THREE.Group();
  root.name = "TTL_Trailer_Hologram";

  const textures = createPm3dTexturePack(maxAnisotropy);
  const built = buildFlatbedTrailer(textures, initialVehicleId || "TTL-01");
  root.add(built.root);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dynamicTextures: THREE.Texture[] = [];

  // Clean dark obsidian studio floor (NO glowing floor rings)
  addCleanStudioFloor(root, 9.6, geometries, materials);

  const holoWireMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.36,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(holoWireMat);

  const shellMaterials: BuiltEvHologramModel["shellMaterials"] = [];
  const holoEdgeLines: THREE.LineSegments[] = [];
  const zoneMeshes = new Map<EvRepairZoneId, THREE.Mesh[]>();
  const meshBaseVisuals: BuiltEvHologramModel["meshBaseVisuals"] = new Map();

  const registerRepairZoneMesh = (zoneId: EvRepairZoneId, mesh: THREE.Mesh) => {
    // Isolate each zone mesh material so active cyan glow never bleeds across unrelated zones
    if (mesh.material && !Array.isArray(mesh.material)) {
      const cloned = mesh.material.clone();
      materials.push(cloned);
      mesh.material = cloned;
    }
    const list = zoneMeshes.get(zoneId) || [];
    list.push(mesh);
    zoneMeshes.set(zoneId, list);
    mesh.userData.zoneId = zoneId;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && "color" in mat && "emissive" in mat) {
      meshBaseVisuals.set(mesh, {
        color: mat.color.clone(),
        emissive: mat.emissive.clone(),
        emissiveIntensity: mat.emissiveIntensity ?? 0,
        opacity: mat.opacity ?? 1,
      });
    }
  };

  const decalMeshes: THREE.Mesh[] = [];

  built.root.updateMatrixWorld(true);
  built.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    // Collect dynamic TTL-* registration plates (side plates + top deck stencil)
    if (obj.userData?.decalStyle) {
      decalMeshes.push(obj);
      return;
    }

    const srcZone = String(obj.userData?.zoneId || "");
    if (!srcZone) return;

    _tmpBox.setFromObject(obj);
    _tmpBox.getCenter(_tmpCenter);
    const mat = obj.material as THREE.MeshStandardMaterial;

    // Top diamond-plate steel deck morphs into translucent cyan X-Ray in X-Ray mode
    // so operators can inspect the I-beams, turntable ring, leaf springs, axles & air tank below!
    if (srcZone === "tr_deck" && _tmpCenter.y > 0.91 && mat && "color" in mat && "emissive" in mat) {
      const cloned = mat.clone();
      cloned.transparent = true;
      materials.push(cloned);
      obj.material = cloned;
      obj.userData.zoneId = "structure";

      shellMaterials.push({
        material: cloned,
        solidOpacity: 0.99,
        xrayOpacity: 0.28,
        solidColor: cloned.color.clone(),
        xrayColor: new THREE.Color(0x1674b8),
        solidEmissive: new THREE.Color(0x051526),
        xrayEmissive: new THREE.Color(0x06578c),
        solidEmissiveIntensity: 0.06,
        xrayEmissiveIntensity: 0.5,
      });
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 26);
      return;
    }

    // Map PM3D Trailer sub-assemblies cleanly into interactive 3D Repair Zones
    if (srcZone === "tr_drawbar" || srcZone === "tr_deck") {
      registerRepairZoneMesh("structure", obj);
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 28);
    } else if (srcZone === "tr_turntable") {
      registerRepairZoneMesh("suspension", obj);
      attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 30);
    } else if (srcZone === "tr_air_electric") {
      registerRepairZoneMesh("hydraulics", obj);
    } else if (srcZone === "tr_reflectors") {
      registerRepairZoneMesh("lighting", obj);
      if (_tmpCenter.y > 0.82 && Math.abs(_tmpCenter.x) > 0.9) {
        attachHoloEdges(obj, holoWireMat, geometries, holoEdgeLines, 28);
      }
    } else if (srcZone === "tr_wheels") {
      // Brake chambers sit inboard at x = ±0.66; tires & deep-dish rims sit outboard at x = ±0.84
      if (Math.abs(_tmpCenter.x) < 0.72) {
        registerRepairZoneMesh("brakes", obj);
      } else {
        registerRepairZoneMesh("tires", obj);
      }
    }
  });

  // Clickable proxies for all Trailer repair zones
  const clickableProxies = buildClickableZoneProxies(
    root,
    TRAILER_INTERACTIVE_ZONE_LIST,
    geometries,
    materials,
    0.3
  );

  // 3D Pulsing Repair Hotspot Beacons (Primary + 4 Secondary)
  const beaconGroup = createHotspotBeacon(1.12, { geometries, materials });
  root.add(beaconGroup);

  const secondaryBeaconGroups: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const sub = createHotspotBeacon(0.74, { geometries, materials });
    sub.visible = false;
    root.add(sub);
    secondaryBeaconGroups.push(sub);
  }

  let xrayBlend = 1;
  const smoothedFocusPos = new THREE.Vector3(0, 0.48, 2.72);

  const updateFrame: BuiltEvHologramModel["updateFrame"] = ({
    elapsed,
    delta,
    activeZoneId,
    hoveredZoneId,
    isXrayMode,
    activeHotspotPos,
    secondaryHotspotPositions,
  }) => {
    const safeDelta = Math.min(0.1, Math.max(0.001, delta));
    const targetXray = isXrayMode ? 1 : 0;
    xrayBlend = THREE.MathUtils.damp(xrayBlend, targetXray, 6.2, safeDelta);

    for (const sm of shellMaterials) {
      sm.material.opacity = THREE.MathUtils.lerp(sm.solidOpacity, sm.xrayOpacity, xrayBlend);
      sm.material.color.lerpColors(sm.solidColor, sm.xrayColor, xrayBlend);
      sm.material.emissive.lerpColors(sm.solidEmissive, sm.xrayEmissive, xrayBlend);
      sm.material.emissiveIntensity = THREE.MathUtils.lerp(
        sm.solidEmissiveIntensity,
        sm.xrayEmissiveIntensity,
        xrayBlend
      );
      sm.material.depthWrite = sm.material.opacity > 0.72;
    }

    holoWireMat.opacity = THREE.MathUtils.lerp(
      0.04,
      0.4 + 0.08 * Math.sin(elapsed * 2.2),
      xrayBlend
    );

    const glowPulse = 0.5 + 0.5 * Math.sin(elapsed * 4.1);
    zoneMeshes.forEach((meshes, zoneId) => {
      const isActive =
        zoneId === activeZoneId ||
        (activeZoneId === "brakes" && zoneId === "hydraulics") ||
        (activeZoneId === "overview" && (zoneId === "structure" || zoneId === "suspension"));
      const isHovered = zoneId === hoveredZoneId && !isActive;

      for (const mesh of meshes) {
        const base = meshBaseVisuals.get(mesh);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!base || !mat) continue;

        if (isActive) {
          const boost =
            activeZoneId === "overview" ? 0.65 + glowPulse * 0.45 : 1.1 + glowPulse * 0.9;
          _tmpColor.copy(base.color).lerp(_cyanGlowColor, 0.45 + glowPulse * 0.22);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_cyanGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, boost, 8, safeDelta);
        } else if (isHovered) {
          _tmpColor.copy(base.color).lerp(_hoverGlowColor, 0.34);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_hoverGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, 0.85, 8, safeDelta);
        } else {
          mat.color.lerp(base.color, Math.min(1, safeDelta * 7));
          const idleEmissive = isXrayMode ? _deepCyanEmissive : base.emissive;
          mat.emissive.lerp(idleEmissive, Math.min(1, safeDelta * 7));
          const idleIntensity = isXrayMode
            ? Math.max(0.14, base.emissiveIntensity * 0.65)
            : base.emissiveIntensity * 0.45;
          mat.emissiveIntensity = THREE.MathUtils.damp(
            mat.emissiveIntensity,
            idleIntensity,
            7,
            safeDelta
          );
        }
      }
    });

    smoothedFocusPos.x = THREE.MathUtils.damp(smoothedFocusPos.x, activeHotspotPos.x, 9, safeDelta);
    smoothedFocusPos.y = THREE.MathUtils.damp(smoothedFocusPos.y, activeHotspotPos.y, 9, safeDelta);
    smoothedFocusPos.z = THREE.MathUtils.damp(smoothedFocusPos.z, activeHotspotPos.z, 9, safeDelta);

    beaconGroup.position.copy(smoothedFocusPos);
    animateHotspotBeacon(beaconGroup, elapsed, 0, true);

    secondaryBeaconGroups.forEach((subGroup, idx) => {
      const pos = secondaryHotspotPositions[idx];
      if (pos) {
        subGroup.visible = true;
        subGroup.position.copy(pos);
        animateHotspotBeacon(subGroup, elapsed, (idx + 1) * 1.15, false);
      } else {
        subGroup.visible = false;
      }
    });
  };

  const setVehicleLabel = (vehicleId: string) => {
    const cleanCode = (vehicleId || "TTL-01").trim();
    const sideTex = createVehicleNumberDecalTexture(cleanCode, "trailer_side", maxAnisotropy);
    const deckTex = createVehicleNumberDecalTexture(cleanCode, "trailer_deck", maxAnisotropy);
    dynamicTextures.push(sideTex, deckTex);

    decalMeshes.forEach((dm) => {
      const mat = dm.material as THREE.MeshStandardMaterial;
      if (!mat) return;
      mat.map = dm.userData.decalStyle === "trailer_deck" ? deckTex : sideTex;
      mat.needsUpdate = true;
    });
  };

  const dispose = () => {
    built.dispose();
    textures.dispose();
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    dynamicTextures.forEach((t) => t.dispose());
  };

  return {
    root,
    shellMaterials,
    holoEdgeLines,
    zoneMeshes,
    meshBaseVisuals,
    clickableProxies,
    floorShaderMaterial: null,
    beaconGroup,
    secondaryBeaconGroups,
    updateFrame,
    setVehicleLabel,
    dispose,
  };
}

/**
 * Unified 3D Repair Hologram Factory for all Material Handling vehicle classes:
 * - ev_tractor: BYD Electric Tow Tractor (TTEV-*)
 * - diesel_tractor: Diesel Tow Tractor (TT-*) reusing the exact BYD EV Tow Tractor 3D model
 * - forklift: Industrial Forklift (FL-*) reusing pm3dVehicleBuilders.buildForklift
 * - clamp_truck: Steel Clamp Truck (SC-01 / หแ-01) reusing VehicleParkingYard3D.buildClampTruckRoot
 * - trailer: Flatbed Trailer (TTL-*) reusing pm3dVehicleBuilders.buildFlatbedTrailer
 */
export function buildRepairHologramModel(
  modelKind: RepairVehicleModelKind,
  maxAnisotropy: number,
  initialVehicleId: string
): BuiltEvHologramModel {
  switch (modelKind) {
    case "ev_tractor":
      return buildBydEvTractorModel(maxAnisotropy, initialVehicleId || "TTEV-19", "ev");
    case "diesel_tractor":
      return buildBydEvTractorModel(maxAnisotropy, initialVehicleId || "TT-01", "diesel");
    case "forklift":
      return buildForkliftHologramModel(maxAnisotropy, initialVehicleId || "FL-01");
    case "clamp_truck":
      return buildClampTruckHologramModel(maxAnisotropy, initialVehicleId || "SC-01");
    case "trailer":
      return buildTrailerHologramModel(maxAnisotropy, initialVehicleId || "TTL-01");
  }
}
