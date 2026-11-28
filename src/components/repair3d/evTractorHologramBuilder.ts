/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { EV_INTERACTIVE_ZONE_LIST, EvRepairZoneId } from "./evRepairZones";

export interface BuiltEvHologramModel {
  root: THREE.Group;
  /** Outer painted/dark body panels that smoothly become X-Ray translucent in hologram mode */
  shellMaterials: Array<{
    material: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
    solidOpacity: number;
    xrayOpacity: number;
    solidColor: THREE.Color;
    xrayColor: THREE.Color;
    solidEmissive: THREE.Color;
    xrayEmissive: THREE.Color;
    solidEmissiveIntensity: number;
    xrayEmissiveIntensity: number;
  }>;
  /** Glowing cyan wireframe edge lines around the BYD EV shell */
  holoEdgeLines: THREE.LineSegments[];
  /** Internal & component meshes grouped by EvRepairZoneId for Blue Glow highlighting */
  zoneMeshes: Map<EvRepairZoneId, THREE.Mesh[]>;
  /** Original material states for every zone mesh so highlighting can smoothly blend & restore */
  meshBaseVisuals: Map<
    THREE.Mesh,
    {
      color: THREE.Color;
      emissive: THREE.Color;
      emissiveIntensity: number;
      opacity: number;
    }
  >;
  /** Invisible proxy hitboxes + visible zone targets for reliable 3D click/hover raycasting */
  clickableProxies: THREE.Mesh[];
  /** Optional floor shader material (disabled when floor blue glow/ring is turned off) */
  floorShaderMaterial: THREE.ShaderMaterial | null;
  /** 3D Hotspot Beacon Group (core + 3 staggered expanding rings + vertical beam) */
  beaconGroup: THREE.Group;
  /** Secondary mini-beacons for multi-point zones (e.g. 4 wheels / overview) */
  secondaryBeaconGroups: THREE.Group[];
  /** Update time-based shaders, beacon animations, X-Ray shell blend, and zone blue glow */
  updateFrame: (params: {
    elapsed: number;
    delta: number;
    activeZoneId: EvRepairZoneId;
    hoveredZoneId: EvRepairZoneId | null;
    isXrayMode: boolean;
    activeHotspotPos: THREE.Vector3;
    secondaryHotspotPositions: THREE.Vector3[];
  }) => void;
  /** Update dynamic vehicle ID decal printed on the BYD EV side panel */
  setVehicleLabel: (vehicleId: string) => void;
  dispose: () => void;
}

const _tmpColor = new THREE.Color();
const _cyanGlowColor = new THREE.Color("#00e5ff");
const _hoverGlowColor = new THREE.Color("#38bdf8");
const _deepCyanEmissive = new THREE.Color("#0284c7");

// ============================================================================
// PROCEDURAL PBR CANVAS TEXTURES (Color + Linear Bump/Roughness Maps)
// ============================================================================

function createTireTreadTextures(maxAnisotropy: number): {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const w = 512;
  const h = 512;
  const col = document.createElement("canvas");
  col.width = w;
  col.height = h;
  const cCtx = col.getContext("2d")!;

  const bmp = document.createElement("canvas");
  bmp.width = w;
  bmp.height = h;
  const bCtx = bmp.getContext("2d")!;

  // Deep matte tire groove base
  cCtx.fillStyle = "#10141a";
  cCtx.fillRect(0, 0, w, h);
  bCtx.fillStyle = "#1c1c1c";
  bCtx.fillRect(0, 0, w, h);

  // Subtle rubber micro-grain
  for (let i = 0; i < 1600; i++) {
    const gx = (i * 97) % w;
    const gy = (i * 53) % h;
    cCtx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.06)";
    cCtx.fillRect(gx, gy, 2, 2);
  }

  // Heavy industrial staggered chevron lug blocks (matching real tow tractor tires)
  const rows = 14;
  const stepY = h / rows;
  for (let r = -1; r <= rows; r++) {
    const y = r * stepY;
    // Left shoulder lug
    cCtx.fillStyle = "#222933";
    bCtx.fillStyle = "#e6e6e6";
    const drawLug = (ctx: CanvasRenderingContext2D, pts: Array<[number, number]>) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    };

    const leftPts: Array<[number, number]> = [
      [14, y + 4],
      [230, y + 14],
      [230, y + stepY * 0.62 + 10],
      [14, y + stepY * 0.62],
    ];
    const rightPts: Array<[number, number]> = [
      [w - 14, y + stepY * 0.45 + 4],
      [282, y + stepY * 0.45 + 14],
      [282, y + stepY * 1.07 + 10],
      [w - 14, y + stepY * 1.07],
    ];

    drawLug(cCtx, leftPts);
    drawLug(cCtx, rightPts);
    drawLug(bCtx, leftPts);
    drawLug(bCtx, rightPts);

    // Center siping grooves
    cCtx.fillStyle = "#151a22";
    cCtx.fillRect(244, 0, 24, h);
    bCtx.fillStyle = "#202020";
    bCtx.fillRect(244, 0, 24, h);
  }

  const colorMap = new THREE.CanvasTexture(col);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.wrapS = THREE.RepeatWrapping;
  colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.repeat.set(1, 3);
  colorMap.anisotropy = Math.min(12, Math.max(1, maxAnisotropy));
  colorMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bmp);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(1, 3);
  bumpMap.anisotropy = Math.min(12, Math.max(1, maxAnisotropy));
  bumpMap.needsUpdate = true;

  return { colorMap, bumpMap };
}

function createFrontGrilleTexture(maxAnisotropy: number): {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;

  const b = document.createElement("canvas");
  b.width = 512;
  b.height = 256;
  const bCtx = b.getContext("2d")!;

  // Rich BYD metallic blue fascia
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 256);
  bgGrad.addColorStop(0, "#1291e6");
  bgGrad.addColorStop(0.5, "#0b7fd0");
  bgGrad.addColorStop(1, "#0863a8");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 256);

  bCtx.fillStyle = "#b0b0b0";
  bCtx.fillRect(0, 0, 512, 256);

  // Outer recessed bezel border
  ctx.strokeStyle = "#06497d";
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 492, 236);

  // Horizontal louvered cooling slats (faithful to BYD EV tow tractor photo)
  for (let y = 34; y <= 210; y += 30) {
    // Deep recess shadow
    ctx.fillStyle = "#042845";
    ctx.fillRect(28, y, 456, 15);
    bCtx.fillStyle = "#181818";
    bCtx.fillRect(28, y, 456, 15);

    // Top chamfer highlight on slat
    ctx.fillStyle = "#38b2f8";
    ctx.fillRect(28, y + 15, 456, 4);
    bCtx.fillStyle = "#f2f2f2";
    bCtx.fillRect(28, y + 15, 456, 5);
  }

  // Central chrome oval emblem (BYD style)
  ctx.save();
  ctx.translate(256, 124);
  const chromeGrad = ctx.createLinearGradient(-64, -36, 64, 36);
  chromeGrad.addColorStop(0, "#f8fafc");
  chromeGrad.addColorStop(0.45, "#94a3b8");
  chromeGrad.addColorStop(0.7, "#f1f5f9");
  chromeGrad.addColorStop(1, "#64748b");

  ctx.fillStyle = "#091b2e";
  ctx.strokeStyle = chromeGrad;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.ellipse(0, 0, 68, 36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "800 32px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("BYD", 0, 2);
  ctx.restore();

  bCtx.save();
  bCtx.translate(256, 124);
  bCtx.fillStyle = "#ffffff";
  bCtx.beginPath();
  bCtx.ellipse(0, 0, 72, 40, 0, 0, Math.PI * 2);
  bCtx.fill();
  bCtx.restore();

  const colorMap = new THREE.CanvasTexture(c);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = Math.min(12, Math.max(1, maxAnisotropy));
  colorMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(b);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = Math.min(12, Math.max(1, maxAnisotropy));
  bumpMap.needsUpdate = true;

  return { colorMap, bumpMap };
}

function createSideBadgeTexture(
  vehicleId: string,
  maxAnisotropy: number,
  variant: "ev" | "diesel" = "ev"
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 192);

  const isDiesel = variant === "diesel";
  // Stylized emblem outline seen on side hood
  ctx.strokeStyle = isDiesel ? "rgba(15, 23, 42, 0.85)" : "rgba(241, 245, 249, 0.94)";
  ctx.lineWidth = 6.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(34, 126);
  ctx.lineTo(34, 86);
  ctx.quadraticCurveTo(36, 54, 78, 48);
  ctx.lineTo(222, 34);
  ctx.stroke();

  ctx.strokeStyle = isDiesel ? "rgba(8, 126, 175, 0.9)" : "rgba(186, 230, 253, 0.85)";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(46, 134);
  ctx.lineTo(472, 134);
  ctx.stroke();

  ctx.fillStyle = isDiesel ? "#0f172a" : "#f8fafc";
  ctx.font = "800 48px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
  ctx.fillText(vehicleId || (isDiesel ? "TT-01" : "TTEV-19"), 68, 114);

  ctx.fillStyle = isDiesel ? "#0369a1" : "#bae6fd";
  ctx.font = "700 21px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
  ctx.fillText(
    isDiesel ? "DIESEL TOW TRACTOR · TT-SERIES" : "EV TOW TRACTOR · T-SERIES",
    68,
    166
  );

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(12, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

function createDashboardClusterTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#06111e";
  ctx.fillRect(0, 0, 512, 256);

  // Subtle screen bezel
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 492, 236);

  // Left SOC Battery gauge arc
  ctx.strokeStyle = "#1e3a5f";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(130, 140, 68, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();

  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(130, 140, 68, Math.PI * 0.75, Math.PI * 1.98);
  ctx.stroke();

  ctx.fillStyle = "#e0f7ff";
  ctx.font = "700 32px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("88%", 130, 148);
  ctx.fillStyle = "#7dd3fc";
  ctx.font = "600 15px sans-serif";
  ctx.fillText("SOC LFP", 130, 182);

  // Right Speed / Power gauge
  ctx.strokeStyle = "#1e3a5f";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(382, 140, 68, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(382, 140, 68, Math.PI * 0.75, Math.PI * 1.35);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 34px 'JetBrains Mono', monospace";
  ctx.fillText("0.0", 382, 148);
  ctx.fillStyle = "#7dd3fc";
  ctx.font = "600 15px sans-serif";
  ctx.fillText("KM/H", 382, 182);

  // Center EV READY indicator
  ctx.fillStyle = "#00e5ff";
  ctx.font = "700 20px sans-serif";
  ctx.fillText("EV READY", 256, 74);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 16px monospace";
  ctx.fillText("80V · 420A", 256, 128);
  ctx.fillText("DRIVE: N", 256, 162);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 512);

  // Soft rectangular vehicle belly ambient occlusion shadow
  const mainGrad = ctx.createRadialGradient(256, 256, 40, 256, 256, 230);
  mainGrad.addColorStop(0, "rgba(0, 0, 0, 0.88)");
  mainGrad.addColorStop(0.55, "rgba(0, 0, 0, 0.52)");
  mainGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = mainGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Extra dark contact patches beneath the 4 wheels
  const wheelDots = [
    [130, 148],
    [382, 148],
    [126, 368],
    [386, 368],
  ];
  for (const [wx, wy] of wheelDots) {
    const wg = ctx.createRadialGradient(wx, wy, 6, wx, wy, 58);
    wg.addColorStop(0, "rgba(0, 0, 0, 0.96)");
    wg.addColorStop(0.6, "rgba(0, 0, 0, 0.48)");
    wg.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = wg;
    ctx.fillRect(wx - 60, wy - 60, 120, 120);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createRadiatorFinTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1a2634";
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 6) {
    ctx.fillStyle = "#4b627a";
    ctx.fillRect(0, y, 256, 2);
    ctx.fillStyle = "#0e1722";
    ctx.fillRect(0, y + 3, 256, 2);
  }
  for (let x = 0; x < 256; x += 28) {
    ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
    ctx.fillRect(x, 0, 3, 256);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create a high-precision 3D Blue Glow + Expanding Ring hotspot beacon anchored in world space.
 */
export function createHotspotBeacon(
  scaleMultiplier = 1,
  disposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] }
): THREE.Group {
  const group = new THREE.Group();
  group.renderOrder = 30;

  // Bright diamond/sphere energy core
  const coreGeo = new THREE.SphereGeometry(0.058 * scaleMultiplier, 24, 24);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xf0fdff,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.name = "beaconCore";
  coreMesh.renderOrder = 36;
  group.add(coreMesh);

  // Soft outer cyan volumetric aura
  const haloGeo = new THREE.SphereGeometry(0.145 * scaleMultiplier, 24, 24);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x00d8ff,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.name = "beaconHalo";
  haloMesh.renderOrder = 33;
  group.add(haloMesh);

  // 3 staggered expanding glow rings
  const ringGeo = new THREE.RingGeometry(0.08 * scaleMultiplier, 0.104 * scaleMultiplier, 56);
  disposables.geometries.push(coreGeo, haloGeo, ringGeo);
  disposables.materials.push(coreMat, haloMat);

  for (let i = 0; i < 3; i++) {
    const rMat = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0x38bdf8 : 0x00e5ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    disposables.materials.push(rMat);

    const ringMesh = new THREE.Mesh(ringGeo, rMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.name = `expandingRing_${i}`;
    ringMesh.userData.phaseOffset = i / 3;
    ringMesh.renderOrder = 32;
    group.add(ringMesh);
  }

  // Orthogonal spinning holographic scanner ring
  const vertRingGeo = new THREE.RingGeometry(0.086 * scaleMultiplier, 0.105 * scaleMultiplier, 56);
  const vertRingMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  disposables.geometries.push(vertRingGeo);
  disposables.materials.push(vertRingMat);
  const vertRing = new THREE.Mesh(vertRingGeo, vertRingMat);
  vertRing.name = "verticalPulseRing";
  vertRing.renderOrder = 31;
  group.add(vertRing);

  return group;
}

/**
 * Create a curved-profile industrial tire using LatheGeometry (authentic rounded sidewall bulge
 * + shoulder bevels instead of a flat cylinder!). Axis of tire ends up aligned with X.
 */
function createLathedTireGeometry(radius: number, width: number): THREE.LatheGeometry {
  const hw = width * 0.5;
  const rRim = radius * 0.54;
  const rSidewall = radius * 0.88;
  const rShoulder = radius * 0.975;

  // Profile in XY plane around Y-axis, then rotated to align wheel axis with X
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(rRim, -hw * 0.86),
    new THREE.Vector2(rRim + (radius - rRim) * 0.25, -hw * 0.96),
    new THREE.Vector2(rSidewall, -hw * 1.03), // subtle rubber sidewall bulge
    new THREE.Vector2(rShoulder, -hw * 0.94),
    new THREE.Vector2(radius, -hw * 0.8),
    new THREE.Vector2(radius, hw * 0.8),
    new THREE.Vector2(rShoulder, hw * 0.94),
    new THREE.Vector2(rSidewall, hw * 1.03),
    new THREE.Vector2(rRim + (radius - rRim) * 0.25, hw * 0.96),
    new THREE.Vector2(rRim, hw * 0.86),
  ];
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create a deep-dish steel wheel rim using LatheGeometry for authentic automotive depth.
 */
function createLathedRimGeometry(radius: number, width: number): THREE.LatheGeometry {
  const hw = width * 0.46;
  const rOuter = radius * 0.56;
  const rInner = radius * 0.44;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.01, -hw * 0.45),
    new THREE.Vector2(rInner * 0.72, -hw * 0.45),
    new THREE.Vector2(rInner, -hw * 0.85),
    new THREE.Vector2(rOuter, -hw * 0.92),
    new THREE.Vector2(rOuter, hw * 0.92),
    new THREE.Vector2(rInner, hw * 0.85),
    new THREE.Vector2(rInner * 0.72, hw * 0.35),
    new THREE.Vector2(0.01, hw * 0.35),
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Smooth 60 FPS Pulsing Core + 3 Staggered Expanding Glow Rings + Vertical Scanner Ring animator.
 */
export function animateHotspotBeacon(
  group: THREE.Group,
  elapsed: number,
  phaseShift: number,
  isPrimary: boolean
): void {
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.8 + phaseShift);
  const core = group.getObjectByName("beaconCore") as THREE.Mesh | undefined;
  const halo = group.getObjectByName("beaconHalo") as THREE.Mesh | undefined;
  const vertRing = group.getObjectByName("verticalPulseRing") as THREE.Mesh | undefined;

  if (core) core.scale.setScalar(0.88 + pulse * 0.28);
  if (halo) {
    halo.scale.setScalar(0.92 + pulse * 0.55);
    (halo.material as THREE.MeshBasicMaterial).opacity = 0.2 + pulse * 0.28;
  }
  if (vertRing) {
    vertRing.rotation.y = elapsed * (isPrimary ? 1.15 : 0.85) + phaseShift;
    const vCycle = (elapsed * 0.82 + phaseShift) % 1;
    vertRing.scale.setScalar(1.0 + vCycle * 1.9);
    (vertRing.material as THREE.MeshBasicMaterial).opacity = (1 - vCycle) * 0.65;
  }

  for (let i = 0; i < 3; i++) {
    const ring = group.getObjectByName(`expandingRing_${i}`) as THREE.Mesh | undefined;
    if (!ring) continue;
    const offset = (ring.userData.phaseOffset as number) || 0;
    const cycle = (elapsed * 0.66 + offset + phaseShift * 0.15) % 1;
    const eased = 1 - Math.pow(1 - cycle, 2.2);
    ring.scale.setScalar(0.65 + eased * (isPrimary ? 3.25 : 2.25));
    const mat = ring.material as THREE.MeshBasicMaterial;
    const fadeIn = Math.min(1, cycle * 5.5);
    const fadeOut = Math.pow(1 - cycle, 1.55);
    mat.opacity = fadeIn * fadeOut * (isPrimary ? 0.92 : 0.68);
  }
}

/**
 * Build the automotive-grade procedural 3D Hologram Tow Tractor (BYD EV or TT Diesel variant).
 * TT Diesel Tractor reuses the exact same sculpted 3D model with industrial white livery & diesel badge.
 */
export function buildBydEvTractorModel(
  maxAnisotropy: number,
  initialVehicleId = "TTEV-19",
  variant: "ev" | "diesel" = "ev"
): BuiltEvHologramModel {
  const isDiesel = variant === "diesel";
  const root = new THREE.Group();
  root.name = isDiesel ? "TT_Diesel_Tow_Tractor_Realistic" : "BYD_EV_Tow_Tractor_Realistic";

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Procedural PBR Texture Set
  const tireTex = createTireTreadTextures(maxAnisotropy);
  const grilleTex = createFrontGrilleTexture(maxAnisotropy);
  const dashTex = createDashboardClusterTexture(maxAnisotropy);
  const radTex = createRadiatorFinTexture(maxAnisotropy);
  const contactShadowTex = createContactShadowTexture();
  let sideBadgeTex = createSideBadgeTexture(initialVehicleId, maxAnisotropy, variant);

  textures.push(
    tireTex.colorMap,
    tireTex.bumpMap,
    grilleTex.colorMap,
    grilleTex.bumpMap,
    dashTex,
    radTex,
    contactShadowTex,
    sideBadgeTex
  );

  const shellMaterials: BuiltEvHologramModel["shellMaterials"] = [];
  const holoEdgeLines: THREE.LineSegments[] = [];
  const zoneMeshes = new Map<EvRepairZoneId, THREE.Mesh[]>();
  const meshBaseVisuals: BuiltEvHologramModel["meshBaseVisuals"] = new Map();
  const clickableProxies: THREE.Mesh[] = [];

  const registerZoneMesh = (zoneId: EvRepairZoneId, mesh: THREE.Mesh) => {
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

  const makeZoneMaterial = (
    colorHex: number,
    roughness: number,
    metalness: number,
    emissiveHex = 0x052540,
    emissiveIntensity = 0.22
  ) =>
    trackMat(
      new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness,
        metalness,
        emissive: emissiveHex,
        emissiveIntensity,
        transparent: true,
        opacity: 1,
      })
    );

  // ============================================================================
  // 1. AUTOMOTIVE PBR SHELL MATERIALS (Smooth Solid <-> X-Ray Hologram Morph)
  // ============================================================================
  const primarySolidColor = isDiesel ? 0xe6edf5 : 0x0b87de;
  const primaryXrayColor = isDiesel ? 0x2b6cb0 : 0x1674b8;

  const bydBluePaintMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: primarySolidColor,
      roughness: 0.22,
      metalness: isDiesel ? 0.18 : 0.28,
      clearcoat: 0.92,
      clearcoatRoughness: 0.12,
      reflectivity: 0.9,
      emissive: 0x021a30,
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0.98,
      depthWrite: true,
    })
  );
  shellMaterials.push({
    material: bydBluePaintMat,
    solidOpacity: 0.99,
    xrayOpacity: 0.24,
    solidColor: new THREE.Color(primarySolidColor),
    xrayColor: new THREE.Color(primaryXrayColor),
    solidEmissive: new THREE.Color(0x021a30),
    xrayEmissive: new THREE.Color(0x06578c),
    solidEmissiveIntensity: 0.1,
    xrayEmissiveIntensity: 0.56,
  });

  const darkCladdingMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x353d47,
      roughness: 0.68,
      metalness: 0.14,
      clearcoat: 0.18,
      clearcoatRoughness: 0.55,
      emissive: 0x051422,
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.99,
      depthWrite: true,
    })
  );
  shellMaterials.push({
    material: darkCladdingMat,
    solidOpacity: 0.99,
    xrayOpacity: 0.27,
    solidColor: new THREE.Color(0x353d47),
    xrayColor: new THREE.Color(0x183047),
    solidEmissive: new THREE.Color(0x051422),
    xrayEmissive: new THREE.Color(0x083e63),
    solidEmissiveIntensity: 0.07,
    xrayEmissiveIntensity: 0.4,
  });

  const cabinFrameMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1a2029,
      roughness: 0.42,
      metalness: 0.45,
      emissive: 0x041628,
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0.99,
    })
  );
  shellMaterials.push({
    material: cabinFrameMat,
    solidOpacity: 0.99,
    xrayOpacity: 0.42,
    solidColor: new THREE.Color(0x1a2029),
    xrayColor: new THREE.Color(0x153552),
    solidEmissive: new THREE.Color(0x041628),
    xrayEmissive: new THREE.Color(0x0a4d78),
    solidEmissiveIntensity: 0.1,
    xrayEmissiveIntensity: 0.42,
  });

  const cabinGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xaad8f5,
      roughness: 0.06,
      metalness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.3,
      emissive: 0x083b61,
      emissiveIntensity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  shellMaterials.push({
    material: cabinGlassMat,
    solidOpacity: 0.34,
    xrayOpacity: 0.15,
    solidColor: new THREE.Color(0xb8e0fa),
    xrayColor: new THREE.Color(0x38bdf8),
    solidEmissive: new THREE.Color(0x052842),
    xrayEmissive: new THREE.Color(0x0ea5e9),
    solidEmissiveIntensity: 0.14,
    xrayEmissiveIntensity: 0.36,
  });

  const chromeTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdbe7f3,
      roughness: 0.18,
      metalness: 0.92,
    })
  );

  const rubberMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x14181f,
      roughness: 0.88,
      metalness: 0.05,
    })
  );

  const holoWireMat = trackMat(
    new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );

  const addEdgeGlow = (mesh: THREE.Mesh, threshold = 24) => {
    const edges = trackGeo(new THREE.EdgesGeometry(mesh.geometry, threshold));
    const lines = new THREE.LineSegments(edges, holoWireMat);
    lines.position.copy(mesh.position);
    lines.rotation.copy(mesh.rotation);
    lines.scale.copy(mesh.scale);
    mesh.parent?.add(lines);
    holoEdgeLines.push(lines);
  };

  // ============================================================================
  // 2. SCULPTED BYD EV TOW TRACTOR EXTERIOR (Faithful Proportions to EV_37dc6f83.jpg)
  //    Coordinate note: +Z = Front, -Z = Rear, +Y = Up (Ground = 0)
  //    Extruded side shapes map Shape.x -> +Z via rotateY(-Math.PI / 2)
  // ============================================================================
  const shellGroup = new THREE.Group();
  shellGroup.name = "OuterShell";
  root.add(shellGroup);

  // 2A. Sculpted BYD Blue Hood (Clamshell curved nose + sloped top + side shoulder)
  const hoodShape = new THREE.Shape();
  hoodShape.moveTo(0.18, 0.72);
  hoodShape.lineTo(1.39, 0.72);
  hoodShape.quadraticCurveTo(1.48, 0.74, 1.48, 0.86);
  hoodShape.lineTo(1.46, 0.99);
  hoodShape.quadraticCurveTo(1.42, 1.09, 1.24, 1.12);
  hoodShape.quadraticCurveTo(0.75, 1.18, 0.2, 1.23);
  hoodShape.lineTo(0.18, 0.72);

  const hoodGeo = trackGeo(
    new THREE.ExtrudeGeometry(hoodShape, {
      depth: 1.2,
      bevelEnabled: true,
      bevelThickness: 0.055,
      bevelSize: 0.048,
      bevelSegments: 5,
    })
  );
  hoodGeo.translate(0, 0, -0.6);
  hoodGeo.rotateY(-Math.PI / 2);
  const hoodMesh = new THREE.Mesh(hoodGeo, bydBluePaintMat);
  hoodMesh.castShadow = true;
  hoodMesh.receiveShadow = true;
  shellGroup.add(hoodMesh);
  addEdgeGlow(hoodMesh, 26);

  // Sculpted Hood Center Crown Crease (subtle raised bonnet contour like photo)
  const crownShape = new THREE.Shape();
  crownShape.moveTo(0.24, 1.21);
  crownShape.lineTo(1.22, 1.11);
  crownShape.quadraticCurveTo(1.36, 1.09, 1.38, 1.03);
  crownShape.lineTo(0.24, 1.15);
  const crownGeo = trackGeo(
    new THREE.ExtrudeGeometry(crownShape, {
      depth: 0.86,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.025,
      bevelSegments: 3,
    })
  );
  crownGeo.translate(0, 0, -0.43);
  crownGeo.rotateY(-Math.PI / 2);
  const crownMesh = new THREE.Mesh(crownGeo, bydBluePaintMat);
  shellGroup.add(crownMesh);

  // Front Grille Panel with Louver Bump & Chrome BYD Oval
  const grilleMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: grilleTex.colorMap,
      bumpMap: grilleTex.bumpMap,
      bumpScale: 0.025,
      roughness: 0.34,
      metalness: 0.32,
      clearcoat: 0.55,
      transparent: true,
      opacity: 0.98,
    })
  );
  shellMaterials.push({
    material: grilleMat,
    solidOpacity: 0.98,
    xrayOpacity: 0.34,
    solidColor: new THREE.Color(0xffffff),
    xrayColor: new THREE.Color(0x7dd3fc),
    solidEmissive: new THREE.Color(0x000000),
    xrayEmissive: new THREE.Color(0x0284c7),
    solidEmissiveIntensity: 0,
    xrayEmissiveIntensity: 0.35,
  });
  const grilleMesh = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.64, 0.27, 0.045)),
    grilleMat
  );
  grilleMesh.position.set(0, 0.88, 1.498);
  shellGroup.add(grilleMesh);

  // Dynamic Side Hood Decals (Left & Right)
  const sideDecalMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: sideBadgeTex,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  const sideDecalGeo = trackGeo(new THREE.PlaneGeometry(0.76, 0.28));
  const leftDecal = new THREE.Mesh(sideDecalGeo, sideDecalMat);
  leftDecal.position.set(-0.658, 0.93, 0.68);
  leftDecal.rotation.y = -Math.PI / 2;
  shellGroup.add(leftDecal);

  const rightDecal = new THREE.Mesh(sideDecalGeo, sideDecalMat);
  rightDecal.position.set(0.658, 0.93, 0.68);
  rightDecal.rotation.y = Math.PI / 2;
  shellGroup.add(rightDecal);

  // 2B. Continuous Sculpted Dark-Grey Lower Cladding with Real Wheel Arch Cutouts!
  //     Left & Right side fenders matching the exact stepped silhouette of BYD T80 photo
  const sideSkirtShape = new THREE.Shape();
  sideSkirtShape.moveTo(1.48, 0.36);
  sideSkirtShape.lineTo(1.5, 0.68);
  sideSkirtShape.lineTo(1.22, 0.74);
  sideSkirtShape.lineTo(0.28, 0.74);
  sideSkirtShape.lineTo(0.18, 0.56); // Steps down gracefully for cabin door sill!
  sideSkirtShape.lineTo(-0.34, 0.56);
  sideSkirtShape.lineTo(-0.44, 0.88); // Rises sharply over the larger rear wheel arch!
  sideSkirtShape.lineTo(-1.32, 0.88);
  sideSkirtShape.quadraticCurveTo(-1.42, 0.86, -1.44, 0.74);
  sideSkirtShape.lineTo(-1.44, 0.38);
  sideSkirtShape.lineTo(-1.26, 0.36);
  // Rear wheel arch cutout centered at z = -0.84, r = 0.44
  sideSkirtShape.absarc(-0.84, 0.39, 0.44, Math.PI, 0, true);
  sideSkirtShape.lineTo(-0.32, 0.34);
  sideSkirtShape.lineTo(0.4, 0.34);
  // Front wheel arch cutout centered at z = +0.84, r = 0.39
  sideSkirtShape.absarc(0.84, 0.34, 0.39, Math.PI, 0, true);
  sideSkirtShape.lineTo(1.48, 0.36);

  const sideSkirtGeo = trackGeo(
    new THREE.ExtrudeGeometry(sideSkirtShape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.028,
      bevelSize: 0.024,
      bevelSegments: 4,
    })
  );
  sideSkirtGeo.translate(0, 0, -0.07);
  sideSkirtGeo.rotateY(-Math.PI / 2);

  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(sideSkirtGeo, darkCladdingMat);
    skirt.position.set(side * 0.65, 0, 0);
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    shellGroup.add(skirt);
    addEdgeGlow(skirt, 26);
  }

  // Sculpted Curved Front Bumper Fascia (Contoured center + recessed air pocket)
  const bumperProfile = new THREE.Shape();
  bumperProfile.moveTo(1.16, 0.32);
  bumperProfile.lineTo(1.44, 0.32);
  bumperProfile.quadraticCurveTo(1.56, 0.36, 1.56, 0.5);
  bumperProfile.lineTo(1.54, 0.69);
  bumperProfile.quadraticCurveTo(1.5, 0.74, 1.38, 0.74);
  bumperProfile.lineTo(1.16, 0.74);
  bumperProfile.lineTo(1.16, 0.32);

  const frontBumperGeo = trackGeo(
    new THREE.ExtrudeGeometry(bumperProfile, {
      depth: 1.34,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.036,
      bevelSegments: 5,
    })
  );
  frontBumperGeo.translate(0, 0, -0.67);
  frontBumperGeo.rotateY(-Math.PI / 2);
  const frontBumperMesh = new THREE.Mesh(frontBumperGeo, darkCladdingMat);
  frontBumperMesh.castShadow = true;
  frontBumperMesh.receiveShadow = true;
  shellGroup.add(frontBumperMesh);
  addEdgeGlow(frontBumperMesh, 26);

  // Bumper Horizontal Character Groove & Lower Step Lip
  const bumperGroove = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.26, 0.045, 0.04)),
    cabinFrameMat
  );
  bumperGroove.position.set(0, 0.61, 1.57);
  shellGroup.add(bumperGroove);

  // Sculpted Rear Counterweight & Bumper Block
  const rearBodyShape = new THREE.Shape();
  rearBodyShape.moveTo(-1.08, 0.34);
  rearBodyShape.lineTo(-1.42, 0.36);
  rearBodyShape.quadraticCurveTo(-1.48, 0.4, -1.48, 0.56);
  rearBodyShape.lineTo(-1.45, 0.88);
  rearBodyShape.lineTo(-1.08, 0.88);
  rearBodyShape.lineTo(-1.08, 0.34);

  const rearBodyGeo = trackGeo(
    new THREE.ExtrudeGeometry(rearBodyShape, {
      depth: 1.32,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.035,
      bevelSegments: 4,
    })
  );
  rearBodyGeo.translate(0, 0, -0.66);
  rearBodyGeo.rotateY(-Math.PI / 2);
  const rearCounterweight = new THREE.Mesh(rearBodyGeo, darkCladdingMat);
  rearCounterweight.castShadow = true;
  rearCounterweight.receiveShadow = true;
  shellGroup.add(rearCounterweight);
  addEdgeGlow(rearCounterweight, 26);

  // 2C. Realistic Enclosed BYD Cabin with True Window Cutouts, Lower Sight Glass & Hinges!
  const cabinGroup = new THREE.Group();
  shellGroup.add(cabinGroup);

  // Sculpted Aerodynamic Roof Cap with Slight Front Visor Lip
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-1.14, 1.9);
  roofShape.lineTo(0.14, 1.9);
  roofShape.quadraticCurveTo(0.22, 1.92, 0.2, 1.97);
  roofShape.lineTo(0.1, 2.01);
  roofShape.lineTo(-1.1, 2.01);
  roofShape.quadraticCurveTo(-1.16, 1.99, -1.14, 1.9);

  const roofGeo = trackGeo(
    new THREE.ExtrudeGeometry(roofShape, {
      depth: 1.24,
      bevelEnabled: true,
      bevelThickness: 0.038,
      bevelSize: 0.032,
      bevelSegments: 4,
    })
  );
  roofGeo.translate(0, 0, -0.62);
  roofGeo.rotateY(-Math.PI / 2);
  const roofMesh = new THREE.Mesh(roofGeo, bydBluePaintMat);
  roofMesh.castShadow = true;
  cabinGroup.add(roofMesh);
  addEdgeGlow(roofMesh, 26);

  // Real Extruded Side Cabin Walls + Blue Doors WITH Actual Upper & Lower Window Cutouts!
  // (Faithful to Image 1: sloped front A-pillar, blue door shell with big upper window + lower sight glass + rear quarter glass)
  const doorOuterShape = new THREE.Shape();
  doorOuterShape.moveTo(0.2, 0.56);
  doorOuterShape.lineTo(-0.34, 0.56);
  doorOuterShape.lineTo(-0.44, 0.88);
  doorOuterShape.lineTo(-0.78, 0.88);
  doorOuterShape.lineTo(-0.78, 1.9);
  doorOuterShape.lineTo(0.02, 1.9);
  doorOuterShape.lineTo(0.2, 1.22);
  doorOuterShape.lineTo(0.2, 0.56);

  // Upper door glass cutout hole
  const upperWinHole = new THREE.Path();
  upperWinHole.moveTo(0.08, 1.25);
  upperWinHole.lineTo(-0.04, 1.81);
  upperWinHole.lineTo(-0.69, 1.81);
  upperWinHole.lineTo(-0.69, 1.25);
  upperWinHole.lineTo(0.08, 1.25);
  doorOuterShape.holes.push(upperWinHole);

  // Lower observation sight-glass cutout hole (Signature BYD T80 door detail!)
  const lowerWinHole = new THREE.Path();
  lowerWinHole.moveTo(0.11, 0.64);
  lowerWinHole.lineTo(-0.29, 0.64);
  lowerWinHole.lineTo(-0.38, 0.96);
  lowerWinHole.lineTo(-0.67, 0.96);
  lowerWinHole.lineTo(-0.67, 1.12);
  lowerWinHole.lineTo(0.11, 1.12);
  lowerWinHole.lineTo(0.11, 0.64);
  doorOuterShape.holes.push(lowerWinHole);

  const doorPanelGeo = trackGeo(
    new THREE.ExtrudeGeometry(doorOuterShape, {
      depth: 0.052,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 2,
    })
  );
  doorPanelGeo.translate(0, 0, -0.026);
  doorPanelGeo.rotateY(-Math.PI / 2);

  // Rear Quarter Side Window Frame (behind B-pillar to C-pillar)
  const rearQtrShape = new THREE.Shape();
  rearQtrShape.moveTo(-0.78, 0.88);
  rearQtrShape.lineTo(-1.12, 0.88);
  rearQtrShape.lineTo(-1.12, 1.9);
  rearQtrShape.lineTo(-0.78, 1.9);
  rearQtrShape.lineTo(-0.78, 0.88);
  const rearQtrHole = new THREE.Path();
  rearQtrHole.moveTo(-0.84, 1.02);
  rearQtrHole.lineTo(-1.05, 1.02);
  rearQtrHole.lineTo(-1.05, 1.81);
  rearQtrHole.lineTo(-0.84, 1.81);
  rearQtrHole.lineTo(-0.84, 1.02);
  rearQtrShape.holes.push(rearQtrHole);

  const rearQtrGeo = trackGeo(
    new THREE.ExtrudeGeometry(rearQtrShape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.008,
      bevelSegments: 2,
    })
  );
  rearQtrGeo.translate(0, 0, -0.025);
  rearQtrGeo.rotateY(-Math.PI / 2);

  for (const side of [-1, 1]) {
    // Blue framed door shell
    const doorMesh = new THREE.Mesh(doorPanelGeo, bydBluePaintMat);
    doorMesh.position.set(side * 0.6, 0, 0);
    doorMesh.castShadow = true;
    cabinGroup.add(doorMesh);
    addEdgeGlow(doorMesh, 28);

    // Dark rear quarter pillar frame
    const rearQtr = new THREE.Mesh(rearQtrGeo, cabinFrameMat);
    rearQtr.position.set(side * 0.6, 0, 0);
    cabinGroup.add(rearQtr);
    addEdgeGlow(rearQtr, 28);

    // Upper & Lower Recessed Door Glass Panes
    const upperGlass = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(0.75, 0.57)),
      cabinGlassMat
    );
    upperGlass.position.set(side * 0.6, 1.53, -0.32);
    upperGlass.rotation.y = side * (Math.PI / 2);
    cabinGroup.add(upperGlass);

    const lowerGlass = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(0.74, 0.48)),
      cabinGlassMat
    );
    lowerGlass.position.set(side * 0.6, 0.88, -0.28);
    lowerGlass.rotation.y = side * (Math.PI / 2);
    cabinGroup.add(lowerGlass);

    const qtrGlass = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(0.24, 0.8)),
      cabinGlassMat
    );
    qtrGlass.position.set(side * 0.6, 1.42, -0.94);
    qtrGlass.rotation.y = side * (Math.PI / 2);
    cabinGroup.add(qtrGlass);

    // 3 Heavy Exposed Black Industrial Door Hinges + Door Handle (Distinct detail from Image 1!)
    for (const hy of [0.76, 1.04, 1.38]) {
      const hz = hy > 1.2 ? 0.16 : 0.21;
      const hinge = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.036, 0.065, 0.055)),
        rubberMat
      );
      hinge.position.set(side * 0.635, hy, hz);
      cabinGroup.add(hinge);
    }
    const handle = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.032, 0.045, 0.12)),
      rubberMat
    );
    handle.position.set(side * 0.635, 1.17, -0.6);
    cabinGroup.add(handle);

    // Tubular Mirror Arm + Contoured Wing Mirror Housing
    const mirrorCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.6, 1.76, -0.02),
      new THREE.Vector3(side * 0.72, 1.76, 0.05),
      new THREE.Vector3(side * 0.75, 1.66, 0.06),
    ]);
    const mirrorArm = new THREE.Mesh(
      trackGeo(new THREE.TubeGeometry(mirrorCurve, 12, 0.013, 8, false)),
      cabinFrameMat
    );
    cabinGroup.add(mirrorArm);

    const mirrorHousing = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.048, 0.21, 0.12)),
      cabinFrameMat
    );
    mirrorHousing.position.set(side * 0.76, 1.61, 0.06);
    cabinGroup.add(mirrorHousing);

    const mirrorFace = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(0.095, 0.18)),
      chromeTrimMat
    );
    mirrorFace.position.set(side * 0.76, 1.61, -0.002);
    mirrorFace.rotation.y = Math.PI;
    cabinGroup.add(mirrorFace);
  }

  // Front Windshield Frame + Slanted Glass + Twin Windshield Wipers (Faithful to Image 1!)
  const wsFrameShape = new THREE.Shape();
  wsFrameShape.moveTo(-0.62, -0.4);
  wsFrameShape.lineTo(0.62, -0.4);
  wsFrameShape.lineTo(0.62, 0.4);
  wsFrameShape.lineTo(-0.62, 0.4);
  wsFrameShape.lineTo(-0.62, -0.4);
  const wsHole = new THREE.Path();
  wsHole.moveTo(-0.52, -0.32);
  wsHole.lineTo(0.52, -0.32);
  wsHole.lineTo(0.52, 0.32);
  wsHole.lineTo(-0.52, 0.32);
  wsHole.lineTo(-0.52, -0.32);
  wsFrameShape.holes.push(wsHole);

  const wsFrameGeo = trackGeo(
    new THREE.ExtrudeGeometry(wsFrameShape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 2,
    })
  );
  wsFrameGeo.translate(0, 0, -0.0275);
  const wsFrame = new THREE.Mesh(wsFrameGeo, cabinFrameMat);
  wsFrame.position.set(0, 1.56, 0.12);
  wsFrame.rotation.x = -0.24;
  cabinGroup.add(wsFrame);
  addEdgeGlow(wsFrame, 28);

  const windshieldGlass = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(1.06, 0.66)),
    cabinGlassMat
  );
  windshieldGlass.position.set(0, 1.56, 0.125);
  windshieldGlass.rotation.x = -0.24;
  cabinGroup.add(windshieldGlass);

  // Twin Wiper Blades resting at base of front windshield
  for (const wx of [-0.26, 0.16]) {
    const wiperArm = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.32, 0.015, 0.015)),
      rubberMat
    );
    wiperArm.position.set(wx + 0.08, 1.28, 0.215);
    wiperArm.rotation.z = 0.08;
    cabinGroup.add(wiperArm);
  }

  // Rear Bulkhead & Rear Window Frame
  const rearBulkhead = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.22, 0.36, 0.07)),
    bydBluePaintMat
  );
  rearBulkhead.position.set(0, 1.04, -1.11);
  cabinGroup.add(rearBulkhead);
  addEdgeGlow(rearBulkhead, 26);

  const rearWinFrame = new THREE.Mesh(wsFrameGeo, cabinFrameMat);
  rearWinFrame.scale.set(0.98, 0.92, 1);
  rearWinFrame.position.set(0, 1.56, -1.11);
  cabinGroup.add(rearWinFrame);

  const rearWindowGlass = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(1.02, 0.62)),
    cabinGlassMat
  );
  rearWindowGlass.position.set(0, 1.56, -1.11);
  cabinGroup.add(rearWindowGlass);

  // 2D. Detailed Cabin Interior (Contoured Bucket Seat, Dashboard with Glowing EV Cluster, Steering Wheel, Pedals)
  const seatLeatherMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x26303d, roughness: 0.72, metalness: 0.08 })
  );
  // Accordion suspension seat pedestal
  const seatBasePedestal = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.34, 0.22, 0.36)),
    rubberMat
  );
  seatBasePedestal.position.set(0, 0.85, -0.58);
  cabinGroup.add(seatBasePedestal);

  // Bolstered seat cushion
  const seatCushion = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.46, 0.11, 0.44)),
    seatLeatherMat
  );
  seatCushion.position.set(0, 1.0, -0.56);
  cabinGroup.add(seatCushion);

  // Contoured backrest + side bolsters + headrest
  const seatBack = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.42, 0.48, 0.1)),
    seatLeatherMat
  );
  seatBack.position.set(0, 1.28, -0.76);
  seatBack.rotation.x = -0.14;
  cabinGroup.add(seatBack);

  const headrest = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.24, 0.16, 0.09)),
    seatLeatherMat
  );
  headrest.position.set(0, 1.6, -0.8);
  cabinGroup.add(headrest);

  for (const side of [-1, 1]) {
    const armrest = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.06, 0.05, 0.3)),
      seatLeatherMat
    );
    armrest.position.set(side * 0.26, 1.18, -0.56);
    cabinGroup.add(armrest);
  }

  // Sculpted Dashboard Console + Glowing Digital EV Cluster
  const dashBody = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.06, 0.28, 0.32)),
    cabinFrameMat
  );
  dashBody.position.set(0, 1.13, 0.06);
  cabinGroup.add(dashBody);

  const dashScreenMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: dashTex,
    })
  );
  const dashScreen = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(0.32, 0.14)),
    dashScreenMat
  );
  dashScreen.position.set(0, 1.24, -0.105);
  dashScreen.rotation.y = Math.PI;
  dashScreen.rotation.x = 0.28;
  cabinGroup.add(dashScreen);

  // Steering Column + 3-Spoke Steering Wheel + Horn Cap
  const steerColumn = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.036, 0.044, 0.48, 16)),
    cabinFrameMat
  );
  steerColumn.position.set(0, 1.12, -0.02);
  steerColumn.rotation.x = -0.52;
  cabinGroup.add(steerColumn);

  const steerGroup = new THREE.Group();
  steerGroup.position.set(0, 1.32, -0.14);
  steerGroup.rotation.x = 1.05;
  const steerRim = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.165, 0.02, 12, 32)),
    rubberMat
  );
  steerGroup.add(steerRim);
  const steerHub = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16)),
    cabinFrameMat
  );
  steerHub.rotation.x = Math.PI / 2;
  steerGroup.add(steerHub);
  for (const ang of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const spoke = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.022, 0.14, 0.018)),
      cabinFrameMat
    );
    spoke.position.set(Math.sin(ang) * 0.075, Math.cos(ang) * 0.075, 0);
    spoke.rotation.z = -ang;
    steerGroup.add(spoke);
  }
  cabinGroup.add(steerGroup);

  // ============================================================================
  // 3. DETAILED INTERNAL EV ASSEMBLIES (Zone-Mapped for Blue Glow Highlighting!)
  // ============================================================================

  // --- ZONE: STRUCTURE (Twin C-Channel Steel Ladder Chassis, Crossmembers, Front & Rear Tow Hitches) ---
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.085, 0.14, 2.7)),
      makeZoneMaterial(0x3a495c, 0.48, 0.68, 0x052844, 0.18)
    );
    rail.position.set(side * 0.34, 0.39, -0.02);
    root.add(rail);
    registerZoneMesh("structure", rail);
  }
  // Chassis steel crossmembers
  for (const cz of [1.18, 0.38, -0.36, -1.16]) {
    const cross = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.74, 0.09, 0.11)),
      makeZoneMaterial(0x475569, 0.45, 0.72, 0x052844, 0.18)
    );
    cross.position.set(0, 0.39, cz);
    root.add(cross);
    registerZoneMesh("structure", cross);
  }
  // Heavy Cast-Steel Rear Tow Hitch Clevis & Drop Pin
  const rearHitchJawUpper = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.28, 0.06, 0.28)),
    makeZoneMaterial(0x4b5c70, 0.38, 0.78, 0x052844, 0.22)
  );
  rearHitchJawUpper.position.set(0, 0.64, -1.5);
  root.add(rearHitchJawUpper);
  registerZoneMesh("structure", rearHitchJawUpper);

  const rearHitchJawLower = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.28, 0.06, 0.28)),
    makeZoneMaterial(0x4b5c70, 0.38, 0.78, 0x052844, 0.22)
  );
  rearHitchJawLower.position.set(0, 0.49, -1.5);
  root.add(rearHitchJawLower);
  registerZoneMesh("structure", rearHitchJawLower);

  const rearHitchPin = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.34, 16)),
    makeZoneMaterial(0xcbd5e1, 0.24, 0.88, 0x0a3b5c, 0.26)
  );
  rearHitchPin.position.set(0, 0.62, -1.56);
  root.add(rearHitchPin);
  registerZoneMesh("structure", rearHitchPin);

  // Front Bumper Recessed Tow Pin Mount (Clearly visible on front bumper of Image 1!)
  const frontCoupler = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.26, 0.22, 0.14)),
    makeZoneMaterial(0x3a4654, 0.48, 0.68, 0x052844, 0.18)
  );
  frontCoupler.position.set(0, 0.5, 1.56);
  root.add(frontCoupler);
  registerZoneMesh("structure", frontCoupler);

  const frontCouplerPin = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 14)),
    makeZoneMaterial(0x94a3b8, 0.3, 0.82, 0x052844, 0.22)
  );
  frontCouplerPin.position.set(0, 0.52, 1.6);
  root.add(frontCouplerPin);
  registerZoneMesh("structure", frontCouplerPin);

  // --- ZONE: BATTERY (Multi-Module LFP Traction Battery Pack + Side Banks like Image 2!) ---
  const batteryMainCase = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.84, 0.32, 0.76)),
    makeZoneMaterial(0x274059, 0.35, 0.68, 0x0369a1, 0.45)
  );
  batteryMainCase.position.set(0, 0.7, 0.68);
  root.add(batteryMainCase);
  registerZoneMesh("battery", batteryMainCase);

  // Individual LFP Prismatic Battery Cell Modules with Top Cooling Ribs
  for (let i = 0; i < 6; i++) {
    const cell = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.76, 0.075, 0.085)),
      makeZoneMaterial(0x5282a8, 0.28, 0.72, 0x0284c7, 0.58)
    );
    cell.position.set(0, 0.9, 0.38 + i * 0.12);
    root.add(cell);
    registerZoneMesh("battery", cell);
  }
  // Dual Side Chassis Battery Packs (Directly inspired by Image 2's glowing side packs!)
  for (const side of [-1, 1]) {
    for (let j = 0; j < 4; j++) {
      const sidePack = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.18, 0.2, 0.15)),
        makeZoneMaterial(0x28435e, 0.36, 0.68, 0x0284c7, 0.48)
      );
      sidePack.position.set(side * 0.46, 0.42, -0.28 + j * 0.19);
      root.add(sidePack);
      registerZoneMesh("battery", sidePack);
    }
  }

  // --- ZONE: MOTOR (High-Detail Ribbed EV Traction Motor on Rear Axle — Straight from Image 2!) ---
  const motorHousing = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.215, 0.215, 0.54, 32)),
    makeZoneMaterial(0x3a5875, 0.28, 0.84, 0x0284c7, 0.48)
  );
  motorHousing.rotation.z = Math.PI / 2;
  motorHousing.position.set(0, 0.52, -0.72);
  root.add(motorHousing);
  registerZoneMesh("motor", motorHousing);

  // 11 Cast-Aluminum Radial Cooling Fins around Motor Stator
  for (let i = -5; i <= 5; i++) {
    const fin = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.222, 0.009, 8, 36)),
      makeZoneMaterial(0x7ca7cc, 0.24, 0.88, 0x0284c7, 0.54)
    );
    fin.rotation.y = Math.PI / 2;
    fin.position.set(i * 0.044, 0.52, -0.72);
    root.add(fin);
    registerZoneMesh("motor", fin);
  }
  // Bolted End Bells + Top 3-Phase Junction Box
  for (const side of [-1, 1]) {
    const endBell = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.18, 0.215, 0.06, 24)),
      makeZoneMaterial(0x4f6b87, 0.3, 0.82, 0x0369a1, 0.42)
    );
    endBell.rotation.z = Math.PI / 2;
    endBell.position.set(side * 0.3, 0.52, -0.72);
    root.add(endBell);
    registerZoneMesh("motor", endBell);
  }
  const motorTerminalBox = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.22, 0.1, 0.19)),
    makeZoneMaterial(0x4b779e, 0.32, 0.72, 0x0284c7, 0.52)
  );
  motorTerminalBox.position.set(0, 0.74, -0.72);
  root.add(motorTerminalBox);
  registerZoneMesh("motor", motorTerminalBox);

  // --- ZONE: DRIVETRAIN (Helical Reducer Gearbox + Differential Pumpkin + Rear Axle Shafts) ---
  const diffHousing = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.175, 24, 20)),
    makeZoneMaterial(0x3f5368, 0.38, 0.78, 0x064870, 0.35)
  );
  diffHousing.position.set(0, 0.42, -0.95);
  root.add(diffHousing);
  registerZoneMesh("drivetrain", diffHousing);

  const rearAxleTube = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.056, 0.056, 1.38, 20)),
    makeZoneMaterial(0x475569, 0.4, 0.78, 0x063d61, 0.3)
  );
  rearAxleTube.rotation.z = Math.PI / 2;
  rearAxleTube.position.set(0, 0.42, -0.84);
  root.add(rearAxleTube);
  registerZoneMesh("drivetrain", rearAxleTube);

  const reducerGearbox = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.12, 0.14, 0.34, 20)),
    makeZoneMaterial(0x526b84, 0.32, 0.82, 0x0284c7, 0.38)
  );
  reducerGearbox.rotation.x = Math.PI / 2;
  reducerGearbox.position.set(0, 0.47, -0.84);
  root.add(reducerGearbox);
  registerZoneMesh("drivetrain", reducerGearbox);

  // --- ZONE: CHARGING (Left-Side EV Charging Socket + On-Board Charger + Dual HV Armored Cables) ---
  const chargePortHousing = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.09, 0.21, 0.22)),
    makeZoneMaterial(0x1f4f75, 0.32, 0.6, 0x0284c7, 0.55)
  );
  chargePortHousing.position.set(-0.62, 0.86, 0.26);
  root.add(chargePortHousing);
  registerZoneMesh("charging", chargePortHousing);

  const chargeSocketRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.055, 0.012, 10, 24)),
    makeZoneMaterial(0x38bdf8, 0.22, 0.5, 0x00e5ff, 0.78)
  );
  chargeSocketRing.rotation.y = Math.PI / 2;
  chargeSocketRing.position.set(-0.67, 0.86, 0.26);
  root.add(chargeSocketRing);
  registerZoneMesh("charging", chargeSocketRing);

  const obcModule = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.32, 0.17, 0.36)),
    makeZoneMaterial(0x2a4a69, 0.34, 0.7, 0x0369a1, 0.45)
  );
  obcModule.position.set(-0.32, 0.84, 0.24);
  root.add(obcModule);
  registerZoneMesh("charging", obcModule);

  // Dual Armored High-Voltage Power Bus Conduits running Battery -> OBC -> Motor
  for (const offset of [-0.032, 0.032]) {
    const hvCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.32 + offset, 0.8, 0.24),
      new THREE.Vector3(-0.22 + offset, 0.65, 0.52),
      new THREE.Vector3(-0.2 + offset, 0.5, -0.15),
      new THREE.Vector3(-0.12 + offset, 0.58, -0.7),
    ]);
    const hvCable = new THREE.Mesh(
      trackGeo(new THREE.TubeGeometry(hvCurve, 32, 0.018, 10, false)),
      makeZoneMaterial(0xf97316, 0.35, 0.28, 0x0284c7, 0.32) // Authentic EV high-voltage orange harness!
    );
    root.add(hvCable);
    registerZoneMesh("charging", hvCable);
  }

  // --- ZONE: COOLING (Finned Radiator Core + Dual Multi-Blade Shrouded Cooling Fans) ---
  const radiatorMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: radTex,
      color: 0x6b88a3,
      roughness: 0.38,
      metalness: 0.75,
      emissive: 0x0369a1,
      emissiveIntensity: 0.36,
      transparent: true,
      opacity: 1,
    })
  );
  const radiatorCore = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.84, 0.33, 0.085)),
    radiatorMat
  );
  radiatorCore.position.set(0, 0.75, 1.24);
  root.add(radiatorCore);
  registerZoneMesh("cooling", radiatorCore);

  for (const fx of [-0.22, 0.22]) {
    const fanShroud = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.125, 0.016, 10, 28)),
      makeZoneMaterial(0x475569, 0.35, 0.7, 0x0284c7, 0.44)
    );
    fanShroud.position.set(fx, 0.75, 1.17);
    root.add(fanShroud);
    registerZoneMesh("cooling", fanShroud);

    const fanHub = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 14)),
      makeZoneMaterial(0x64748b, 0.32, 0.78, 0x0284c7, 0.45)
    );
    fanHub.rotation.x = Math.PI / 2;
    fanHub.position.set(fx, 0.75, 1.17);
    root.add(fanHub);
    registerZoneMesh("cooling", fanHub);
  }

  // --- ZONE: SENSORS (Heatsinked Inverter / VCU Controller + Front Proximity Sensors) ---
  const vcuBox = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.46, 0.14, 0.3)),
    makeZoneMaterial(0x2f5373, 0.3, 0.76, 0x0284c7, 0.48)
  );
  vcuBox.position.set(0, 1.05, 0.22);
  root.add(vcuBox);
  registerZoneMesh("sensors", vcuBox);

  // VCU heatsink fins
  for (let i = -3; i <= 3; i++) {
    const hsFin = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.018, 0.03, 0.28)),
      makeZoneMaterial(0x94a3b8, 0.25, 0.85, 0x0284c7, 0.45)
    );
    hsFin.position.set(i * 0.06, 1.135, 0.22);
    root.add(hsFin);
    registerZoneMesh("sensors", hsFin);
  }
  for (const sx of [-0.44, 0.44]) {
    const frontSensor = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 14)),
      makeZoneMaterial(0x38bdf8, 0.24, 0.6, 0x00e5ff, 0.6)
    );
    frontSensor.rotation.x = Math.PI / 2;
    frontSensor.position.set(sx, 0.51, 1.57);
    root.add(frontSensor);
    registerZoneMesh("sensors", frontSensor);
  }

  // --- ZONE: HVAC (Aerodynamic Roof A/C Condenser Pod & Rear Cabin Evaporator Blower) ---
  const hvacUnit = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.74, 0.13, 0.52)),
    makeZoneMaterial(0x2e455c, 0.36, 0.48, 0x0369a1, 0.32)
  );
  hvacUnit.position.set(0, 2.07, -0.66);
  root.add(hvacUnit);
  registerZoneMesh("hvac", hvacUnit);

  const hvacBlower = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.56, 0.14, 0.2)),
    makeZoneMaterial(0x3b6082, 0.34, 0.55, 0x0284c7, 0.38)
  );
  hvacBlower.position.set(0, 1.84, -0.94);
  root.add(hvacBlower);
  registerZoneMesh("hvac", hvacBlower);

  // --- ZONE: LIGHTING (Recessed Twin Projector Headlights with Chrome Rings + Amber Turn + Red Tail Bar) ---
  for (const side of [-1, 1]) {
    // Deep recessed dark-blue headlight housing (faithful to Image 1!)
    const hlHousing = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.32, 0.19, 0.08)),
      makeZoneMaterial(0x0b1a2e, 0.28, 0.55, 0x0284c7, 0.28)
    );
    hlHousing.position.set(side * 0.49, 0.87, 1.47);
    root.add(hlHousing);
    registerZoneMesh("lighting", hlHousing);

    // Twin chrome-ringed projector headlamp lenses per side
    for (const innerOff of [-0.072, 0.068]) {
      const bezelRing = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(0.052, 0.008, 10, 24)),
        makeZoneMaterial(0xe2e8f0, 0.18, 0.9, 0x38bdf8, 0.35)
      );
      bezelRing.position.set(side * 0.49 + innerOff, 0.87, 1.515);
      root.add(bezelRing);
      registerZoneMesh("lighting", bezelRing);

      const projectorLens = new THREE.Mesh(
        trackGeo(new THREE.SphereGeometry(0.044, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.5)),
        makeZoneMaterial(0xf0fdff, 0.08, 0.15, 0x7dd3fc, 1.25)
      );
      projectorLens.rotation.x = Math.PI / 2;
      projectorLens.position.set(side * 0.49 + innerOff, 0.87, 1.5);
      root.add(projectorLens);
      registerZoneMesh("lighting", projectorLens);
    }

    // Clear protective headlight glass cover
    const hlCover = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(0.31, 0.18)),
      cabinGlassMat
    );
    hlCover.position.set(side * 0.49, 0.87, 1.522);
    root.add(hlCover);

    // Multi-chamber Rear LED Tail Lamp Assembly (Vibrant Red Brake + Amber Turn like Image 2!)
    const tailRed = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.22, 0.11, 0.045)),
      makeZoneMaterial(0xf43f5e, 0.18, 0.25, 0xe11d48, 1.35)
    );
    tailRed.position.set(side * 0.44, 0.65, -1.485);
    root.add(tailRed);
    registerZoneMesh("lighting", tailRed);

    const tailAmber = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.08, 0.11, 0.045)),
      makeZoneMaterial(0xf59e0b, 0.2, 0.25, 0xd97706, 0.85)
    );
    tailAmber.position.set(side * 0.59, 0.65, -1.485);
    root.add(tailAmber);
    registerZoneMesh("lighting", tailAmber);
  }

  // Roof Safety LED Beacon
  const beaconBase = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.068, 0.078, 0.04, 20)),
    rubberMat
  );
  beaconBase.position.set(0, 2.03, -0.18);
  root.add(beaconBase);

  const roofBeaconLens = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.056, 0.064, 0.095, 20)),
    makeZoneMaterial(0x38bdf8, 0.15, 0.2, 0x00d8ff, 1.15)
  );
  roofBeaconLens.position.set(0, 2.095, -0.18);
  root.add(roofBeaconLens);
  registerZoneMesh("lighting", roofBeaconLens);

  // --- ZONES: TIRES (Curved Lathed Industrial Tires + Lug Nuts), BRAKES (Slotted Rotors + Calipers), SUSPENSION ---
  const wheelConfigs = [
    { x: -0.68, z: 0.84, r: 0.34, w: 0.23, isRear: false }, // FL
    { x: 0.68, z: 0.84, r: 0.34, w: 0.23, isRear: false }, // FR
    { x: -0.7, z: -0.84, r: 0.39, w: 0.26, isRear: true }, // RL
    { x: 0.7, z: -0.84, r: 0.39, w: 0.26, isRear: true }, // RR
  ];

  const frontTireGeo = trackGeo(createLathedTireGeometry(0.34, 0.23));
  const rearTireGeo = trackGeo(createLathedTireGeometry(0.39, 0.26));
  const frontRimGeo = trackGeo(createLathedRimGeometry(0.34, 0.23));
  const rearRimGeo = trackGeo(createLathedRimGeometry(0.39, 0.26));
  const lugNutGeo = trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 6));
  lugNutGeo.rotateZ(Math.PI / 2);

  for (const wc of wheelConfigs) {
    const sideSign = wc.x > 0 ? 1 : -1;

    // Curved-shoulder Lathed Tire with Lug Tread Color + Bump Map
    const tireMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x20262f,
        map: tireTex.colorMap,
        bumpMap: tireTex.bumpMap,
        bumpScale: 0.032,
        roughness: 0.86,
        metalness: 0.06,
        emissive: 0x041626,
        emissiveIntensity: 0.14,
        transparent: true,
        opacity: 1,
      })
    );
    const tire = new THREE.Mesh(wc.isRear ? rearTireGeo : frontTireGeo, tireMat);
    tire.position.set(wc.x, wc.r, wc.z);
    tire.castShadow = true;
    tire.receiveShadow = true;
    root.add(tire);
    registerZoneMesh("tires", tire);

    // Deep-Dish Steel Rim
    const rim = new THREE.Mesh(
      wc.isRear ? rearRimGeo : frontRimGeo,
      makeZoneMaterial(0x2a3340, 0.36, 0.82, 0x062c47, 0.18)
    );
    rim.position.set(wc.x, wc.r, wc.z);
    root.add(rim);
    registerZoneMesh("tires", rim);

    // Central Axle Hubcap + 6 Hex Lug Nuts
    const hubCap = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(wc.r * 0.18, wc.r * 0.22, 0.06, 20)),
      makeZoneMaterial(0x3a4654, 0.32, 0.86, 0x052540, 0.18)
    );
    hubCap.rotation.z = Math.PI / 2;
    hubCap.position.set(wc.x + sideSign * (wc.w * 0.22), wc.r, wc.z);
    root.add(hubCap);
    registerZoneMesh("tires", hubCap);

    const lugRingRadius = wc.r * 0.32;
    for (let l = 0; l < 6; l++) {
      const ang = (l / 6) * Math.PI * 2;
      const nut = new THREE.Mesh(
        lugNutGeo,
        makeZoneMaterial(0xb0c4d8, 0.24, 0.9, 0x052540, 0.16)
      );
      nut.position.set(
        wc.x + sideSign * (wc.w * 0.2),
        wc.r + Math.sin(ang) * lugRingRadius,
        wc.z + Math.cos(ang) * lugRingRadius
      );
      root.add(nut);
      registerZoneMesh("tires", nut);
    }

    // Slotted Ventilated Metallic Brake Rotor Disc (Inboard)
    const inboardX = wc.x - sideSign * (wc.w * 0.56);
    const brakeDisc = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(wc.r * 0.52, wc.r * 0.52, 0.036, 28)),
      makeZoneMaterial(0x8899ab, 0.24, 0.9, 0x0284c7, 0.38)
    );
    brakeDisc.rotation.z = Math.PI / 2;
    brakeDisc.position.set(inboardX, wc.r, wc.z);
    root.add(brakeDisc);
    registerZoneMesh("brakes", brakeDisc);

    // Sculpted Multi-Piston Brake Caliper
    const caliper = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.085, 0.15, 0.17)),
      makeZoneMaterial(0x0ea5e9, 0.3, 0.68, 0x0284c7, 0.54)
    );
    caliper.position.set(inboardX, wc.r + wc.r * 0.32, wc.z + 0.06);
    root.add(caliper);
    registerZoneMesh("brakes", caliper);

    // Suspension Coil-Over Shock Strut (Outer tube + chrome piston rod + spring coils)
    const shockX = inboardX - sideSign * 0.08;
    const shockTube = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.26, 14)),
      makeZoneMaterial(0x334155, 0.38, 0.78, 0x0369a1, 0.34)
    );
    shockTube.position.set(shockX, wc.r + 0.24, wc.z);
    root.add(shockTube);
    registerZoneMesh("suspension", shockTube);

    const shockRod = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 12)),
      makeZoneMaterial(0xdbe7f3, 0.16, 0.94, 0x0369a1, 0.3)
    );
    shockRod.position.set(shockX, wc.r + 0.18, wc.z);
    root.add(shockRod);
    registerZoneMesh("suspension", shockRod);

    // Leaf Spring Pack on Rear Suspension
    if (wc.isRear) {
      const leafPack = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.07, 0.06, 0.72)),
        makeZoneMaterial(0x475569, 0.46, 0.72, 0x0369a1, 0.32)
      );
      leafPack.position.set(shockX, wc.r + 0.04, wc.z);
      root.add(leafPack);
      registerZoneMesh("suspension", leafPack);
    }
  }

  // Front Steering I-Beam Axle + Tie Rod Linkage
  const frontAxle = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.18, 0.085, 0.1)),
    makeZoneMaterial(0x475569, 0.42, 0.76, 0x0369a1, 0.34)
  );
  frontAxle.position.set(0, 0.34, 0.84);
  root.add(frontAxle);
  registerZoneMesh("suspension", frontAxle);

  const tieRod = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 1.08, 12)),
    makeZoneMaterial(0x94a3b8, 0.28, 0.84, 0x0369a1, 0.36)
  );
  tieRod.rotation.z = Math.PI / 2;
  tieRod.position.set(0, 0.33, 0.73);
  root.add(tieRod);
  registerZoneMesh("suspension", tieRod);

  // ============================================================================
  // 4. CLICKABLE RAYCAST PROXY HITBOXES (Forgiving Touch/Click Selection)
  // ============================================================================
  const proxyMat = trackMat(new THREE.MeshBasicMaterial({ visible: false }));

  for (const zone of EV_INTERACTIVE_ZONE_LIST) {
    const proxyRadius =
      zone.id === "battery" || zone.id === "motor" || zone.id === "structure" ? 0.32 : 0.24;
    const proxy = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(proxyRadius, 12, 10)), proxyMat);
    proxy.position.set(...zone.hotspotPos);
    proxy.userData.zoneId = zone.id;
    proxy.name = `proxy_${zone.id}`;
    root.add(proxy);
    clickableProxies.push(proxy);

    if (zone.secondaryHotspots) {
      zone.secondaryHotspots.forEach((pos, idx) => {
        const subProxy = new THREE.Mesh(
          trackGeo(new THREE.SphereGeometry(0.22, 10, 8)),
          proxyMat
        );
        subProxy.position.set(...pos);
        subProxy.userData.zoneId = zone.id;
        subProxy.name = `proxy_${zone.id}_${idx}`;
        root.add(subProxy);
        clickableProxies.push(subProxy);
      });
    }
  }

  // ============================================================================
  // 5. STUDIO FLOOR + GROUNDED CONTACT SHADOW + EXPANDING RADAR SHADER
  // ============================================================================
  // Ground matte obsidian reflector (Y = 0)
  const darkBaseFloorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x050b14,
      roughness: 0.34,
      metalness: 0.42,
    })
  );
  const darkBaseFloor = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(7.6, 56)),
    darkBaseFloorMat
  );
  darkBaseFloor.rotation.x = -Math.PI / 2;
  darkBaseFloor.position.y = 0;
  darkBaseFloor.receiveShadow = true;
  root.add(darkBaseFloor);

  // Soft Physical Contact Shadow directly under the 4 wheels & belly (Y = 0.005 — Zero Z-Fighting)
  const contactShadowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
  );
  const contactShadowPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(2.45, 3.65)),
    contactShadowMat
  );
  contactShadowPlane.rotation.x = -Math.PI / 2;
  contactShadowPlane.position.set(0, 0.005, 0.02);
  contactShadowPlane.renderOrder = 1;
  root.add(contactShadowPlane);

  // Floor Blue Glow + Expanding Ring effect intentionally disabled for a clean studio floor
  const floorShaderMaterial: THREE.ShaderMaterial | null = null;

  // ============================================================================
  // 6. 3D PULSING REPAIR HOTSPOT BEACONS (Primary + up to 4 Secondary)
  // ============================================================================
  const beaconGroup = createHotspotBeacon(1.0, { geometries, materials });
  root.add(beaconGroup);

  const secondaryBeaconGroups: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const sub = createHotspotBeacon(0.66, { geometries, materials });
    sub.visible = false;
    root.add(sub);
    secondaryBeaconGroups.push(sub);
  }

  let xrayBlend = 1;
  const smoothedFocusPos = new THREE.Vector3(0, 0.72, 0.72);

  const animateBeacon = animateHotspotBeacon;

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

    // Smoothly blend outer shell between Hologram X-Ray and Solid Automotive PBR finish
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

    // Crisp cyan edge lines fade gently in solid mode and shine in X-Ray hologram mode
    holoWireMat.opacity = THREE.MathUtils.lerp(
      0.04,
      0.42 + 0.08 * Math.sin(elapsed * 2.2),
      xrayBlend
    );

    // Highlight active & hovered 3D components with smooth Electric Blue Glow
    const glowPulse = 0.5 + 0.5 * Math.sin(elapsed * 4.1);
    zoneMeshes.forEach((meshes, zoneId) => {
      const effectiveZoneMatch = isDiesel
        ? (activeZoneId === "motor" && zoneId === "battery") ||
          (activeZoneId === "battery" && zoneId === "motor") ||
          zoneId === activeZoneId
        : zoneId === activeZoneId;
      const isActive =
        effectiveZoneMatch ||
        (activeZoneId === "overview" && (zoneId === "battery" || zoneId === "motor"));
      const isHovered = zoneId === hoveredZoneId && !isActive;

      for (const mesh of meshes) {
        const base = meshBaseVisuals.get(mesh);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!base || !mat) continue;

        if (isActive) {
          const boost =
            activeZoneId === "overview" ? 0.65 + glowPulse * 0.45 : 1.15 + glowPulse * 0.95;
          _tmpColor.copy(base.color).lerp(_cyanGlowColor, 0.44 + glowPulse * 0.22);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_cyanGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, boost, 8, safeDelta);
          mat.opacity = 1;
        } else if (isHovered) {
          _tmpColor.copy(base.color).lerp(_hoverGlowColor, 0.34);
          mat.color.lerp(_tmpColor, Math.min(1, safeDelta * 10));
          mat.emissive.lerp(_hoverGlowColor, Math.min(1, safeDelta * 10));
          mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, 0.85, 8, safeDelta);
          mat.opacity = 1;
        } else {
          mat.color.lerp(base.color, Math.min(1, safeDelta * 7));
          const idleEmissive = isXrayMode ? _deepCyanEmissive : base.emissive;
          mat.emissive.lerp(idleEmissive, Math.min(1, safeDelta * 7));
          const idleIntensity = isXrayMode
            ? Math.max(0.16, base.emissiveIntensity * 0.68)
            : base.emissiveIntensity * 0.45;
          mat.emissiveIntensity = THREE.MathUtils.damp(
            mat.emissiveIntensity,
            idleIntensity,
            7,
            safeDelta
          );
          mat.opacity = base.opacity;
        }
      }
    });

    smoothedFocusPos.x = THREE.MathUtils.damp(smoothedFocusPos.x, activeHotspotPos.x, 9, safeDelta);
    smoothedFocusPos.y = THREE.MathUtils.damp(smoothedFocusPos.y, activeHotspotPos.y, 9, safeDelta);
    smoothedFocusPos.z = THREE.MathUtils.damp(smoothedFocusPos.z, activeHotspotPos.z, 9, safeDelta);

    beaconGroup.position.copy(smoothedFocusPos);
    animateBeacon(beaconGroup, elapsed, 0, true);

    secondaryBeaconGroups.forEach((subGroup, idx) => {
      const pos = secondaryHotspotPositions[idx];
      if (pos) {
        subGroup.visible = true;
        subGroup.position.copy(pos);
        animateBeacon(subGroup, elapsed, (idx + 1) * 1.15, false);
      } else {
        subGroup.visible = false;
      }
    });
  };

  const setVehicleLabel = (vehicleId: string) => {
    const nextTex = createSideBadgeTexture(vehicleId, maxAnisotropy, variant);
    sideDecalMat.map = nextTex;
    sideDecalMat.needsUpdate = true;
    sideBadgeTex.dispose();
    sideBadgeTex = nextTex;
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    sideBadgeTex.dispose();
  };

  return {
    root,
    shellMaterials,
    holoEdgeLines,
    zoneMeshes,
    meshBaseVisuals,
    clickableProxies,
    floorShaderMaterial,
    beaconGroup,
    secondaryBeaconGroups,
    updateFrame,
    setVehicleLabel,
    dispose,
  };
}
