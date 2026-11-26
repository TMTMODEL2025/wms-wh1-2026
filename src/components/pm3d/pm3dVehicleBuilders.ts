/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { MhPm3dModelType } from "../../services/forkliftDataService";

export interface Pm3dTexturePack {
  diamondPlate: THREE.CanvasTexture;
  diamondPlateBump: THREE.CanvasTexture;
  hazardStripe: THREE.CanvasTexture;
  hazardStripeEnd: THREE.CanvasTexture;
  meshGrille: THREE.CanvasTexture;
  meshGrilleBump: THREE.CanvasTexture;
  tireTreadLug: THREE.CanvasTexture;
  tireTreadLugBump: THREE.CanvasTexture;
  tireTreadRib: THREE.CanvasTexture;
  tireTreadRibBump: THREE.CanvasTexture;
  tireSidewall: THREE.CanvasTexture;
  radiatorFins: THREE.CanvasTexture;
  dashboardGauge: THREE.CanvasTexture;
  specPlate: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  studioFloor: THREE.CanvasTexture;
  studioFloorRoughness: THREE.CanvasTexture;
  maxAnisotropy: number;
  dispose: () => void;
}

export interface BuiltVehicleModel {
  root: THREE.Group;
  hoodPivot: THREE.Object3D | null;
  hoodOpenRotationX: number;
  hoodOpenOffsetY: number;
  /** Extra panels that glide outward slightly in inspect/exploded mode */
  explodedParts: Array<{ object: THREE.Object3D; closedPos: THREE.Vector3; openOffset: THREE.Vector3 }>;
  /** Meshes tagged with userData.zoneId for raycasting & hover highlight */
  clickableMeshes: THREE.Mesh[];
  /** Map zoneId -> meshes belonging to that zone for highlight feedback */
  zoneMeshes: Map<string, THREE.Mesh[]>;
  dispose: () => void;
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  maxAnisotropy: number,
  isColor: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.min(16, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

export function createPm3dTexturePack(maxAnisotropy: number): Pm3dTexturePack {
  // 1. Checkered Diamond-Plate Steel (Color + Linear Bump Map)
  const dpColor = document.createElement("canvas");
  dpColor.width = 512;
  dpColor.height = 512;
  const dpCtx = dpColor.getContext("2d")!;
  dpCtx.fillStyle = "#22272f";
  dpCtx.fillRect(0, 0, 512, 512);

  // Subtle brushed metallic grain
  for (let y = 0; y < 512; y += 2) {
    const shade = 30 + ((y * 17) % 10);
    dpCtx.fillStyle = `rgba(${shade}, ${shade + 5}, ${shade + 12}, 0.25)`;
    dpCtx.fillRect(0, y, 512, 1);
  }

  const dpBump = document.createElement("canvas");
  dpBump.width = 512;
  dpBump.height = 512;
  const dpbCtx = dpBump.getContext("2d")!;
  dpbCtx.fillStyle = "#404040";
  dpbCtx.fillRect(0, 0, 512, 512);

  const step = 32;
  for (let y = 0; y < 512; y += step) {
    for (let x = 0; x < 512; x += step) {
      const alt = ((x / step) + (y / step)) % 2 === 0;
      const cx = x + step / 2;
      const cy = y + step / 2;
      const ang = alt ? Math.PI / 4 : -Math.PI / 4;

      // Color pass
      dpCtx.save();
      dpCtx.translate(cx, cy);
      dpCtx.rotate(ang);
      dpCtx.fillStyle = "#161a20";
      dpCtx.beginPath();
      dpCtx.ellipse(1.2, 1.4, 10.5, 3.6, 0, 0, Math.PI * 2);
      dpCtx.fill();
      dpCtx.fillStyle = "#3b4452";
      dpCtx.beginPath();
      dpCtx.ellipse(0, 0, 9.8, 3.2, 0, 0, Math.PI * 2);
      dpCtx.fill();
      dpCtx.fillStyle = "#64748b";
      dpCtx.beginPath();
      dpCtx.ellipse(-1.2, -0.9, 6.4, 1.2, 0, 0, Math.PI * 2);
      dpCtx.fill();
      dpCtx.restore();

      // Bump height pass
      dpbCtx.save();
      dpbCtx.translate(cx, cy);
      dpbCtx.rotate(ang);
      const grad = dpbCtx.createRadialGradient(0, 0, 1, 0, 0, 10);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.65, "#c0c0c0");
      grad.addColorStop(1, "#404040");
      dpbCtx.fillStyle = grad;
      dpbCtx.beginPath();
      dpbCtx.ellipse(0, 0, 10, 3.5, 0, 0, Math.PI * 2);
      dpbCtx.fill();
      dpbCtx.restore();
    }
  }
  const diamondPlate = finalizeTexture(dpColor, maxAnisotropy, true, 3.5, 7);
  const diamondPlateBump = finalizeTexture(dpBump, maxAnisotropy, false, 3.5, 7);

  // 2. Diagonal Black & Yellow Industrial Hazard Stripes (Side + End repeats)
  const buildHazardCanvas = () => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#14181e";
    ctx.fillRect(0, 0, 512, 128);

    // Painted industrial yellow diagonal stripes
    ctx.fillStyle = "#f4be0b";
    for (let x = -128; x < 640; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 128);
      ctx.lineTo(x + 56, 128);
      ctx.lineTo(x + 112, 0);
      ctx.lineTo(x + 56, 0);
      ctx.closePath();
      ctx.fill();
    }

    // Top & bottom subtle steel flange shadow
    const topGrad = ctx.createLinearGradient(0, 0, 0, 16);
    topGrad.addColorStop(0, "rgba(0,0,0,0.45)");
    topGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, 512, 16);

    const botGrad = ctx.createLinearGradient(0, 110, 0, 128);
    botGrad.addColorStop(0, "rgba(0,0,0,0)");
    botGrad.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, 110, 512, 18);

    return c;
  };
  const hazardStripe = finalizeTexture(buildHazardCanvas(), maxAnisotropy, true, 4.2, 1);
  const hazardStripeEnd = finalizeTexture(buildHazardCanvas(), maxAnisotropy, true, 2.2, 1);

  // 3. Silver Expanded-Metal Honeycomb Grille (Color + Bump)
  const mgColor = document.createElement("canvas");
  mgColor.width = 512;
  mgColor.height = 256;
  const mgCtx = mgColor.getContext("2d")!;
  mgCtx.fillStyle = "#10151c";
  mgCtx.fillRect(0, 0, 512, 256);

  // Faint dark radiator fins behind mesh
  mgCtx.fillStyle = "#18202a";
  for (let y = 0; y < 256; y += 8) {
    mgCtx.fillRect(0, y, 512, 3);
  }

  const mgBump = document.createElement("canvas");
  mgBump.width = 512;
  mgBump.height = 256;
  const mgbCtx = mgBump.getContext("2d")!;
  mgbCtx.fillStyle = "#151515";
  mgbCtx.fillRect(0, 0, 512, 256);

  // Draw crisp diamond mesh
  for (let i = -256; i < 768; i += 24) {
    // Shadow line
    mgCtx.strokeStyle = "#475569";
    mgCtx.lineWidth = 6;
    mgCtx.beginPath();
    mgCtx.moveTo(i + 2, 0);
    mgCtx.lineTo(i + 258, 256);
    mgCtx.stroke();
    mgCtx.beginPath();
    mgCtx.moveTo(i + 258, 0);
    mgCtx.lineTo(i + 2, 256);
    mgCtx.stroke();

    // Bright chrome highlight strand
    mgCtx.strokeStyle = "#e2e8f0";
    mgCtx.lineWidth = 3.2;
    mgCtx.beginPath();
    mgCtx.moveTo(i, 0);
    mgCtx.lineTo(i + 256, 256);
    mgCtx.stroke();
    mgCtx.beginPath();
    mgCtx.moveTo(i + 256, 0);
    mgCtx.lineTo(i, 256);
    mgCtx.stroke();

    // Bump strand
    mgbCtx.strokeStyle = "#f0f0f0";
    mgbCtx.lineWidth = 5;
    mgbCtx.beginPath();
    mgbCtx.moveTo(i, 0);
    mgbCtx.lineTo(i + 256, 256);
    mgbCtx.stroke();
    mgbCtx.beginPath();
    mgbCtx.moveTo(i + 256, 0);
    mgbCtx.lineTo(i, 256);
    mgbCtx.stroke();
  }
  const meshGrille = finalizeTexture(mgColor, maxAnisotropy, true, 1, 1);
  const meshGrilleBump = finalizeTexture(mgBump, maxAnisotropy, false, 1, 1);

  // 4A. Rugged Lugged Industrial Tire Tread (Tow Tractor & Forklift — matching Photo 1)
  const tlColor = document.createElement("canvas");
  tlColor.width = 512;
  tlColor.height = 256;
  const tlCtx = tlColor.getContext("2d")!;
  tlCtx.fillStyle = "#16191e";
  tlCtx.fillRect(0, 0, 512, 256);

  const tlBump = document.createElement("canvas");
  tlBump.width = 512;
  tlBump.height = 256;
  const tlbCtx = tlBump.getContext("2d")!;
  tlbCtx.fillStyle = "#222222";
  tlbCtx.fillRect(0, 0, 512, 256);

  for (let x = 0; x < 512; x += 32) {
    // Left angled chevron block
    tlCtx.fillStyle = "#2a2f37";
    tlCtx.beginPath();
    tlCtx.moveTo(x + 3, 14);
    tlCtx.lineTo(x + 22, 14);
    tlCtx.lineTo(x + 29, 114);
    tlCtx.lineTo(x + 10, 114);
    tlCtx.closePath();
    tlCtx.fill();

    // Right staggered angled chevron block
    tlCtx.beginPath();
    tlCtx.moveTo(x + 19, 142);
    tlCtx.lineTo(x + 38, 142);
    tlCtx.lineTo(x + 31, 242);
    tlCtx.lineTo(x + 12, 242);
    tlCtx.closePath();
    tlCtx.fill();

    // Bump pass
    tlbCtx.fillStyle = "#e8e8e8";
    tlbCtx.beginPath();
    tlbCtx.moveTo(x + 3, 14);
    tlbCtx.lineTo(x + 22, 14);
    tlbCtx.lineTo(x + 29, 114);
    tlbCtx.lineTo(x + 10, 114);
    tlbCtx.closePath();
    tlbCtx.fill();
    tlbCtx.beginPath();
    tlbCtx.moveTo(x + 19, 142);
    tlbCtx.lineTo(x + 38, 142);
    tlbCtx.lineTo(x + 31, 242);
    tlbCtx.lineTo(x + 12, 242);
    tlbCtx.closePath();
    tlbCtx.fill();
  }
  const tireTreadLug = finalizeTexture(tlColor, maxAnisotropy, true, 3, 1);
  const tireTreadLugBump = finalizeTexture(tlBump, maxAnisotropy, false, 3, 1);

  // 4B. Commercial Highway Ribbed Tire Tread (Flatbed Trailer — matching Photo 2)
  const trColor = document.createElement("canvas");
  trColor.width = 512;
  trColor.height = 256;
  const trCtx = trColor.getContext("2d")!;
  trCtx.fillStyle = "#262b33";
  trCtx.fillRect(0, 0, 512, 256);

  const trBump = document.createElement("canvas");
  trBump.width = 512;
  trBump.height = 256;
  const trbCtx = trBump.getContext("2d")!;
  trbCtx.fillStyle = "#d8d8d8";
  trbCtx.fillRect(0, 0, 512, 256);

  // 4 Circumferential rain grooves
  for (const gy of [48, 102, 154, 208]) {
    trCtx.fillStyle = "#101317";
    trCtx.fillRect(0, gy - 7, 512, 14);
    trbCtx.fillStyle = "#151515";
    trbCtx.fillRect(0, gy - 7, 512, 14);
  }
  // Fine lateral shoulder sipes
  for (let x = 0; x < 512; x += 24) {
    trCtx.fillStyle = "#15181d";
    trCtx.fillRect(x, 0, 4, 42);
    trCtx.fillRect(x + 12, 214, 4, 42);
    trCtx.fillRect(x + 6, 56, 3, 38);
    trCtx.fillRect(x + 18, 162, 3, 38);

    trbCtx.fillStyle = "#353535";
    trbCtx.fillRect(x, 0, 4, 42);
    trbCtx.fillRect(x + 12, 214, 4, 42);
    trbCtx.fillRect(x + 6, 56, 3, 38);
    trbCtx.fillRect(x + 18, 162, 3, 38);
  }
  const tireTreadRib = finalizeTexture(trColor, maxAnisotropy, true, 4, 1);
  const tireTreadRibBump = finalizeTexture(trBump, maxAnisotropy, false, 4, 1);

  // 4C. Radial Tire Sidewall Texture
  const swCanvas = document.createElement("canvas");
  swCanvas.width = 512;
  swCanvas.height = 512;
  const swCtx = swCanvas.getContext("2d")!;
  swCtx.fillStyle = "#1f2329";
  swCtx.fillRect(0, 0, 512, 512);
  // Concentric molded sidewall rings
  swCtx.strokeStyle = "#2e343e";
  swCtx.lineWidth = 4;
  for (const r of [155, 195, 225, 240]) {
    swCtx.beginPath();
    swCtx.arc(256, 256, r, 0, Math.PI * 2);
    swCtx.stroke();
  }
  // Subtle shoulder lug notches around perimeter
  swCtx.fillStyle = "#14171b";
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    swCtx.save();
    swCtx.translate(256 + Math.cos(a) * 238, 256 + Math.sin(a) * 238);
    swCtx.rotate(a);
    swCtx.fillRect(-10, -4, 20, 8);
    swCtx.restore();
  }
  // Subtle molded industrial tire lettering
  swCtx.save();
  swCtx.fillStyle = "#39414d";
  swCtx.font = "bold 16px sans-serif";
  swCtx.textAlign = "center";
  swCtx.fillText("HEAVY DUTY  •  INDUSTRIAL RADIAL", 256, 82);
  swCtx.translate(256, 256);
  swCtx.rotate(Math.PI);
  swCtx.fillText("7.00-12  14PR  MAX LOAD", 0, -174);
  swCtx.restore();
  const tireSidewall = finalizeTexture(swCanvas, maxAnisotropy, true, 1, 1);

  // 5. Aluminum Radiator Cooling Fins
  const radCanvas = document.createElement("canvas");
  radCanvas.width = 256;
  radCanvas.height = 256;
  const radCtx = radCanvas.getContext("2d")!;
  radCtx.fillStyle = "#1e293b";
  radCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 6) {
    radCtx.fillStyle = "#64748b";
    radCtx.fillRect(0, y, 256, 2);
  }
  for (let x = 0; x < 256; x += 22) {
    radCtx.fillStyle = "#334155";
    radCtx.fillRect(x, 0, 3, 256);
  }
  const radiatorFins = finalizeTexture(radCanvas, maxAnisotropy, true, 1, 1);

  // 6. Instrument Cluster / Digital Dashboard Display
  const dashCanvas = document.createElement("canvas");
  dashCanvas.width = 512;
  dashCanvas.height = 256;
  const dashCtx = dashCanvas.getContext("2d")!;
  dashCtx.fillStyle = "#0f172a";
  dashCtx.fillRect(0, 0, 512, 256);
  dashCtx.strokeStyle = "#334155";
  dashCtx.lineWidth = 6;
  dashCtx.strokeRect(10, 10, 492, 236);

  // Left circular speedometer dial
  dashCtx.beginPath();
  dashCtx.arc(130, 132, 76, 0, Math.PI * 2);
  dashCtx.fillStyle = "#1e293b";
  dashCtx.fill();
  dashCtx.strokeStyle = "#38bdf8";
  dashCtx.lineWidth = 4;
  dashCtx.stroke();
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.78 + (i / 10) * Math.PI * 1.44;
    dashCtx.strokeStyle = i >= 8 ? "#ef4444" : "#cbd5e1";
    dashCtx.lineWidth = 3;
    dashCtx.beginPath();
    dashCtx.moveTo(130 + Math.cos(a) * 56, 132 + Math.sin(a) * 56);
    dashCtx.lineTo(130 + Math.cos(a) * 68, 132 + Math.sin(a) * 68);
    dashCtx.stroke();
  }
  // Needle
  dashCtx.strokeStyle = "#f97316";
  dashCtx.lineWidth = 4;
  dashCtx.beginPath();
  dashCtx.moveTo(130, 132);
  dashCtx.lineTo(100, 92);
  dashCtx.stroke();

  // Center digital LCD readout
  dashCtx.fillStyle = "#082f49";
  dashCtx.fillRect(228, 52, 134, 152);
  dashCtx.strokeStyle = "#0284c7";
  dashCtx.lineWidth = 3;
  dashCtx.strokeRect(228, 52, 134, 152);
  dashCtx.fillStyle = "#38bdf8";
  dashCtx.font = "bold 28px monospace";
  dashCtx.fillText("PM OK", 248, 102);
  dashCtx.fillStyle = "#10b981";
  dashCtx.font = "bold 20px monospace";
  dashCtx.fillText("100% SOC", 244, 146);
  dashCtx.fillStyle = "#94a3b8";
  dashCtx.font = "16px monospace";
  dashCtx.fillText("00482 HR", 248, 184);

  // Right status bar gauges
  dashCtx.fillStyle = "#1e293b";
  dashCtx.fillRect(382, 52, 102, 152);
  const barColors = ["#22c55e", "#22c55e", "#22c55e", "#eab308", "#ef4444"];
  for (let i = 0; i < 5; i++) {
    dashCtx.fillStyle = barColors[i];
    dashCtx.fillRect(398, 168 - i * 24, 70, 14);
  }
  const dashboardGauge = finalizeTexture(dashCanvas, maxAnisotropy, true, 1, 1);

  // 7. Industrial Specification / Manufacturer Plate Decal
  const spCanvas = document.createElement("canvas");
  spCanvas.width = 256;
  spCanvas.height = 128;
  const spCtx = spCanvas.getContext("2d")!;
  spCtx.fillStyle = "#f8fafc";
  spCtx.fillRect(0, 0, 256, 128);
  spCtx.strokeStyle = "#0f172a";
  spCtx.lineWidth = 6;
  spCtx.strokeRect(6, 6, 244, 116);
  spCtx.fillStyle = "#dc2626";
  spCtx.fillRect(16, 18, 224, 28);
  spCtx.fillStyle = "#ffffff";
  spCtx.font = "bold 18px sans-serif";
  spCtx.fillText("INDUSTRIAL MH FLEET", 28, 39);
  spCtx.fillStyle = "#0f172a";
  spCtx.font = "bold 15px monospace";
  spCtx.fillText("MAX LOAD: 5,000 KG", 24, 72);
  spCtx.font = "13px monospace";
  spCtx.fillText("INSPECT BEFORE USE", 24, 98);
  const specPlate = finalizeTexture(spCanvas, maxAnisotropy, true, 1, 1);

  // 8. Soft Radial Contact Shadow
  const shCanvas = document.createElement("canvas");
  shCanvas.width = 512;
  shCanvas.height = 512;
  const shCtx = shCanvas.getContext("2d")!;
  const grad = shCtx.createRadialGradient(256, 256, 40, 256, 256, 244);
  grad.addColorStop(0, "rgba(8, 15, 26, 0.72)");
  grad.addColorStop(0.45, "rgba(8, 15, 26, 0.42)");
  grad.addColorStop(0.78, "rgba(8, 15, 26, 0.14)");
  grad.addColorStop(1, "rgba(8, 15, 26, 0)");
  shCtx.fillStyle = grad;
  shCtx.fillRect(0, 0, 512, 512);
  const contactShadow = new THREE.CanvasTexture(shCanvas);
  contactShadow.colorSpace = THREE.SRGBColorSpace;
  contactShadow.needsUpdate = true;

  // 9. Epoxy-Coated Industrial Workshop Bay Floor (Color + Roughness)
  const flCanvas = document.createElement("canvas");
  flCanvas.width = 512;
  flCanvas.height = 512;
  const flCtx = flCanvas.getContext("2d")!;
  flCtx.fillStyle = "#9aa8b8";
  flCtx.fillRect(0, 0, 512, 512);

  // Subtle concrete aggregate speckle
  for (let i = 0; i < 2400; i++) {
    const px = (i * 197) % 512;
    const py = (i * 313) % 512;
    const dark = i % 3 === 0;
    flCtx.fillStyle = dark ? "rgba(30, 41, 59, 0.15)" : "rgba(226, 232, 240, 0.13)";
    flCtx.fillRect(px, py, 2, 2);
  }
  // Expansion joint grid lines
  flCtx.strokeStyle = "rgba(30, 41, 59, 0.28)";
  flCtx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 128) {
    flCtx.beginPath();
    flCtx.moveTo(i, 0);
    flCtx.lineTo(i, 512);
    flCtx.stroke();
    flCtx.beginPath();
    flCtx.moveTo(0, i);
    flCtx.lineTo(512, i);
    flCtx.stroke();
  }
  const studioFloor = finalizeTexture(flCanvas, maxAnisotropy, true, 8, 8);

  const flRough = document.createElement("canvas");
  flRough.width = 512;
  flRough.height = 512;
  const flrCtx = flRough.getContext("2d")!;
  flrCtx.fillStyle = "#b8b8b8";
  flrCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 600; i++) {
    const px = (i * 173) % 512;
    const py = (i * 269) % 512;
    flrCtx.fillStyle = i % 2 === 0 ? "#a0a0a0" : "#cccccc";
    flrCtx.fillRect(px, py, 14, 14);
  }
  const studioFloorRoughness = finalizeTexture(flRough, maxAnisotropy, false, 8, 8);

  return {
    diamondPlate,
    diamondPlateBump,
    hazardStripe,
    hazardStripeEnd,
    meshGrille,
    meshGrilleBump,
    tireTreadLug,
    tireTreadLugBump,
    tireTreadRib,
    tireTreadRibBump,
    tireSidewall,
    radiatorFins,
    dashboardGauge,
    specPlate,
    contactShadow,
    studioFloor,
    studioFloorRoughness,
    maxAnisotropy,
    dispose: () => {
      diamondPlate.dispose();
      diamondPlateBump.dispose();
      hazardStripe.dispose();
      hazardStripeEnd.dispose();
      meshGrille.dispose();
      meshGrilleBump.dispose();
      tireTreadLug.dispose();
      tireTreadLugBump.dispose();
      tireTreadRib.dispose();
      tireTreadRibBump.dispose();
      tireSidewall.dispose();
      radiatorFins.dispose();
      dashboardGauge.dispose();
      specPlate.dispose();
      contactShadow.dispose();
      studioFloor.dispose();
      studioFloorRoughness.dispose();
    },
  };
}

export type VehicleDecalStyle =
  | "white_body"
  | "ev_body"
  | "yellow_body"
  | "forklift_roof"
  | "trailer_side"
  | "trailer_deck";

export function createVehicleNumberDecalTexture(
  rawCode: string,
  style: VehicleDecalStyle,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const text = (rawCode || "TT-01").trim().slice(0, 12) || "TT-01";
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 220;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (style === "forklift_roof") {
    // High-contrast industrial yellow steel overhead ID plate with dark border & bolts
    ctx.fillStyle = "#f4b400";
    ctx.fillRect(0, 0, 512, 220);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 492, 200);
    ctx.fillStyle = "#334155";
    for (const [bx, by] of [
      [30, 30],
      [482, 30],
      [30, 190],
      [482, 190],
    ]) {
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === "trailer_side") {
    // Crisp white industrial plate over hazard-striped side beam
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 512, 220);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 14;
    ctx.strokeRect(8, 8, 496, 204);
    ctx.fillStyle = "#087eaf";
    ctx.fillRect(20, 182, 472, 12);
  }

  // Auto-fit bold industrial typography
  let fontSize = style === "trailer_side" ? 132 : 140;
  const maxWidth = style === "trailer_side" || style === "forklift_roof" ? 430 : 464;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  while (fontSize > 52) {
    ctx.font = `900 ${fontSize}px "Segoe UI", "Roboto", "Noto Sans Thai", Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    fontSize -= 6;
  }

  const textY = style === "trailer_side" ? 102 : 104;

  if (style === "trailer_deck") {
    ctx.lineJoin = "round";
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.72)";
    ctx.strokeText(text, 256, textY);
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(text, 256, textY);
    ctx.fillStyle = "#facc15";
    ctx.fillRect(96, 178, 320, 10);
  } else if (style === "white_body") {
    ctx.fillStyle = "#0f172a";
    ctx.fillText(text, 256, textY);
    ctx.fillStyle = "#087eaf";
    ctx.fillRect(84, 182, 344, 12);
  } else if (style === "ev_body") {
    ctx.fillStyle = "#0c4a6e";
    ctx.fillText(text, 256, textY);
    ctx.fillStyle = "#10b981";
    ctx.fillRect(84, 182, 344, 12);
  } else if (style === "yellow_body" || style === "forklift_roof") {
    ctx.fillStyle = "#111827";
    ctx.fillText(text, 256, textY);
    if (style === "yellow_body") {
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(92, 182, 328, 10);
    }
  } else {
    ctx.fillStyle = "#0f172a";
    ctx.fillText(text, 256, textY);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(16, Math.max(1, maxAnisotropy));
  tex.needsUpdate = true;
  return tex;
}

function registerZoneMesh(
  mesh: THREE.Mesh,
  zoneId: string,
  clickableMeshes: THREE.Mesh[],
  zoneMeshes: Map<string, THREE.Mesh[]>
) {
  mesh.userData.zoneId = zoneId;
  clickableMeshes.push(mesh);
  const arr = zoneMeshes.get(zoneId) || [];
  arr.push(mesh);
  zoneMeshes.set(zoneId, arr);
}

/**
 * Contoured LatheGeometry pneumatic industrial tire + deep-dish stepped rim + hub drum + hex lug nuts
 */
function createRealisticWheel(opts: {
  radius: number;
  width: number;
  rimColor: number;
  lugColor: number;
  lugCount: number;
  treadType: "lug" | "rib";
  deepDish?: boolean;
  textures: Pm3dTexturePack;
  zoneId: string;
  clickableMeshes: THREE.Mesh[];
  zoneMeshes: Map<string, THREE.Mesh[]>;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}): THREE.Group {
  const {
    radius,
    width,
    rimColor,
    lugColor,
    lugCount,
    treadType,
    deepDish = false,
    textures,
    zoneId,
    clickableMeshes,
    zoneMeshes,
    geometries,
    materials,
  } = opts;
  const grp = new THREE.Group();
  const halfW = width * 0.5;
  const rimR = radius * 0.56;

  // 1. Contoured LatheGeometry Tire Carcass (rounded shoulders + sidewall bulge)
  const tireProfile: THREE.Vector2[] = [
    new THREE.Vector2(rimR * 0.96, -halfW * 0.86),
    new THREE.Vector2(radius * 0.78, -halfW * 1.03),
    new THREE.Vector2(radius * 0.94, -halfW * 0.98),
    new THREE.Vector2(radius, -halfW * 0.82),
    new THREE.Vector2(radius, halfW * 0.82),
    new THREE.Vector2(radius * 0.94, halfW * 0.98),
    new THREE.Vector2(radius * 0.78, halfW * 1.03),
    new THREE.Vector2(rimR * 0.96, halfW * 0.86),
  ];
  const tireGeo = new THREE.LatheGeometry(tireProfile, 36);
  tireGeo.rotateZ(Math.PI / 2);
  geometries.push(tireGeo);

  const treadMap = treadType === "rib" ? textures.tireTreadRib : textures.tireTreadLug;
  const treadBump = treadType === "rib" ? textures.tireTreadRibBump : textures.tireTreadLugBump;

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x262b33,
    map: treadMap,
    bumpMap: treadBump,
    bumpScale: treadType === "rib" ? 0.018 : 0.028,
    roughness: 0.86,
    metalness: 0.04,
  });
  materials.push(tireMat);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  registerZoneMesh(tireMesh, zoneId, clickableMeshes, zoneMeshes);
  grp.add(tireMesh);

  // Sidewall detail rings (left & right faces)
  const sideRingGeo = new THREE.RingGeometry(rimR * 0.98, radius * 0.95, 32);
  geometries.push(sideRingGeo);
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x20242a,
    map: textures.tireSidewall,
    roughness: 0.84,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  materials.push(sideMat);
  for (const s of [-1, 1]) {
    const sw = new THREE.Mesh(sideRingGeo, sideMat);
    sw.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    sw.position.x = s * (halfW * 1.015);
    registerZoneMesh(sw, zoneId, clickableMeshes, zoneMeshes);
    grp.add(sw);
  }

  // 2. Stepped Deep-Dish Rim (LatheGeometry)
  const dishDepth = deepDish ? halfW * 0.56 : halfW * 0.34;
  const rimProfile: THREE.Vector2[] = [
    new THREE.Vector2(rimR * 0.25, -halfW * 0.72),
    new THREE.Vector2(rimR * 0.99, -halfW * 0.72),
    new THREE.Vector2(rimR * 1.02, -halfW * 0.88),
    new THREE.Vector2(rimR * 0.92, -halfW * 0.88),
    new THREE.Vector2(rimR * 0.82, -dishDepth),
    new THREE.Vector2(rimR * 0.82, dishDepth),
    new THREE.Vector2(rimR * 0.92, halfW * 0.88),
    new THREE.Vector2(rimR * 1.02, halfW * 0.88),
    new THREE.Vector2(rimR * 0.99, halfW * 0.72),
    new THREE.Vector2(rimR * 0.25, halfW * 0.72),
  ];
  const rimGeo = new THREE.LatheGeometry(rimProfile, 28);
  rimGeo.rotateZ(Math.PI / 2);
  geometries.push(rimGeo);

  const isBrightRim = rimColor > 0x777777;
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: rimColor,
    roughness: isBrightRim ? 0.24 : 0.36,
    metalness: isBrightRim ? 0.84 : 0.52,
    clearcoat: isBrightRim ? 0.45 : 0.25,
    clearcoatRoughness: 0.22,
  });
  materials.push(rimMat);

  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.castShadow = true;
  registerZoneMesh(rimMesh, zoneId, clickableMeshes, zoneMeshes);
  grp.add(rimMesh);

  // Inner rim web plate
  const webGeo = new THREE.CylinderGeometry(rimR * 0.84, rimR * 0.84, dishDepth * 0.55, 24);
  webGeo.rotateZ(Math.PI / 2);
  geometries.push(webGeo);
  const webMesh = new THREE.Mesh(webGeo, rimMat);
  registerZoneMesh(webMesh, zoneId, clickableMeshes, zoneMeshes);
  grp.add(webMesh);

  // Brake drum / central protruding axle hub cap
  const hubGeo = new THREE.CylinderGeometry(rimR * 0.34, rimR * 0.38, width * 0.86, 20);
  hubGeo.rotateZ(Math.PI / 2);
  geometries.push(hubGeo);
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0x161a20,
    roughness: 0.38,
    metalness: 0.72,
  });
  materials.push(hubMat);
  const hubMesh = new THREE.Mesh(hubGeo, hubMat);
  grp.add(hubMesh);

  // Center grease dust cap
  const dustCapGeo = new THREE.CylinderGeometry(rimR * 0.20, rimR * 0.23, width * 0.96, 16);
  dustCapGeo.rotateZ(Math.PI / 2);
  geometries.push(dustCapGeo);
  const dustCap = new THREE.Mesh(dustCapGeo, hubMat);
  grp.add(dustCap);

  // Hex Lug Bolts around bolt circle
  const lugGeo = new THREE.CylinderGeometry(0.017, 0.017, width * 0.78, 6);
  lugGeo.rotateZ(Math.PI / 2);
  geometries.push(lugGeo);
  const lugMat = new THREE.MeshStandardMaterial({
    color: lugColor,
    roughness: 0.22,
    metalness: 0.9,
  });
  materials.push(lugMat);

  const boltCircleR = rimR * 0.58;
  for (let i = 0; i < lugCount; i++) {
    const a = (i / lugCount) * Math.PI * 2;
    const lug = new THREE.Mesh(lugGeo, lugMat);
    lug.position.set(0, Math.cos(a) * boltCircleR, Math.sin(a) * boltCircleR);
    grp.add(lug);
  }

  // Rim ventilation cooling slots on deep-dish rims
  if (deepDish) {
    const ventGeo = new THREE.CylinderGeometry(rimR * 0.11, rimR * 0.11, dishDepth * 0.62, 12);
    ventGeo.rotateZ(Math.PI / 2);
    geometries.push(ventGeo);
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.9, metalness: 0.1 });
    materials.push(ventMat);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const vent = new THREE.Mesh(ventGeo, ventMat);
      vent.position.set(0, Math.cos(a) * rimR * 0.74, Math.sin(a) * rimR * 0.74);
      grp.add(vent);
    }
  }

  return grp;
}

/**
 * Helper: Sculpted contoured bucket seat with side bolsters & horizontal vinyl ribs
 */
function createBucketSeat(
  vinylMat: THREE.Material,
  frameMat: THREE.Material,
  zoneId: string,
  clickableMeshes: THREE.Mesh[],
  zoneMeshes: Map<string, THREE.Mesh[]>,
  geometries: THREE.BufferGeometry[]
): THREE.Group {
  const seat = new THREE.Group();
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  // Steel base rail pedestal
  const ped = new THREE.Mesh(track(new THREE.BoxGeometry(0.32, 0.08, 0.34)), frameMat);
  ped.position.set(0, 0.04, 0);
  seat.add(ped);

  // Main cushion
  const cushion = new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.10, 0.42)), vinylMat);
  cushion.position.set(0, 0.12, 0.01);
  cushion.castShadow = true;
  registerZoneMesh(cushion, zoneId, clickableMeshes, zoneMeshes);
  seat.add(cushion);

  // Left & Right cushion side bolsters
  for (const s of [-1, 1]) {
    const bolster = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.055, 0.32, 4, 8)), vinylMat);
    bolster.rotation.x = Math.PI / 2;
    bolster.position.set(s * 0.21, 0.145, 0.01);
    registerZoneMesh(bolster, zoneId, clickableMeshes, zoneMeshes);
    seat.add(bolster);
  }

  // Contoured backrest group
  const backGroup = new THREE.Group();
  backGroup.position.set(0, 0.16, -0.18);
  backGroup.rotation.x = -0.16;
  seat.add(backGroup);

  const backMain = new THREE.Mesh(track(new THREE.BoxGeometry(0.40, 0.44, 0.09)), vinylMat);
  backMain.position.set(0, 0.22, 0);
  backMain.castShadow = true;
  registerZoneMesh(backMain, zoneId, clickableMeshes, zoneMeshes);
  backGroup.add(backMain);

  // Horizontal stitched comfort ribs
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.036, 0.28, 4, 8)), vinylMat);
    rib.rotation.z = Math.PI / 2;
    rib.position.set(0, 0.08 + i * 0.095, 0.038);
    backGroup.add(rib);
  }

  // Backrest side bolsters
  for (const s of [-1, 1]) {
    const bBolster = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.05, 0.36, 4, 8)), vinylMat);
    bBolster.position.set(s * 0.20, 0.22, 0.02);
    backGroup.add(bBolster);
  }

  return seat;
}

/**
 * Helper: Realistic Fresnel Amber Rotating Beacon Light
 */
function createAmberBeacon(
  baseMat: THREE.Material,
  chromeMat: THREE.Material,
  amberGlassMat: THREE.Material,
  bulbGlowMat: THREE.Material,
  zoneId: string,
  clickableMeshes: THREE.Mesh[],
  zoneMeshes: Map<string, THREE.Mesh[]>,
  geometries: THREE.BufferGeometry[]
): THREE.Group {
  const g = new THREE.Group();
  const track = <T extends THREE.BufferGeometry>(geo: T): T => {
    geometries.push(geo);
    return geo;
  };

  const base = new THREE.Mesh(track(new THREE.CylinderGeometry(0.068, 0.078, 0.045, 20)), baseMat);
  base.position.y = 0.022;
  g.add(base);

  const collar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.064, 0.066, 0.016, 20)), chromeMat);
  collar.position.y = 0.05;
  g.add(collar);

  const innerReflector = new THREE.Mesh(track(new THREE.CylinderGeometry(0.024, 0.034, 0.075, 14)), bulbGlowMat);
  innerReflector.position.y = 0.095;
  g.add(innerReflector);

  // Translucent dome profile via LatheGeometry
  const domePts = [
    new THREE.Vector2(0.06, 0.056),
    new THREE.Vector2(0.056, 0.135),
    new THREE.Vector2(0.044, 0.162),
    new THREE.Vector2(0.018, 0.174),
    new THREE.Vector2(0.0, 0.176),
  ];
  const dome = new THREE.Mesh(track(new THREE.LatheGeometry(domePts, 24)), amberGlassMat);
  dome.renderOrder = 6;
  registerZoneMesh(dome, zoneId, clickableMeshes, zoneMeshes);
  g.add(dome);

  return g;
}

/**
 * 1 & 2. Photorealistic Industrial Tow Tractor (Diesel or EV variant)
 * Faithfully modeled after Reference Photo 1:
 * Sculpted white steel body with beveled wrap-around bumper, trapezoidal silver diamond-mesh grille,
 * recessed multi-reflector headlights, fender-top amber turn signals, sculpted rear wheel arches,
 * sloped rubber-gasket windshield with pantograph wiper & curved-arm convex mirrors, open canopy + Fresnel beacon,
 * twin ribbed bucket seats, instrument console, rugged lugged tires with black deep-dish rims & brass lugs,
 * and openable hinged hood revealing detailed Diesel Engine OR Modular EV HV Battery & Inverter.
 */
export function buildTowTractor(
  variant: "diesel" | "ev",
  textures: Pm3dTexturePack,
  isSoftwareGl: boolean,
  vehicleCode?: string
): BuiltVehicleModel {
  const root = new THREE.Group();
  const clickableMeshes: THREE.Mesh[] = [];
  const zoneMeshes = new Map<string, THREE.Mesh[]>();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dynamicTextures: THREE.Texture[] = [];
  const explodedParts: BuiltVehicleModel["explodedParts"] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    dynamicTextures.push(t);
    return t;
  };

  const isEv = variant === "ev";
  const zCabin = isEv ? "ev_cabin" : "tractor_cabin";
  const zWheels = isEv ? "ev_wheels" : "tractor_wheels";
  const zHitch = isEv ? "ev_hitch" : "tractor_hitch";

  // === HIGH-FIDELITY AUTOMOTIVE PBR MATERIALS ===
  const whiteBodyMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf4f6f9,
      roughness: 0.24,
      metalness: 0.08,
      clearcoat: 0.72,
      clearcoatRoughness: 0.14,
      reflectivity: 0.85,
    })
  );
  const darkChassisMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x19202a, roughness: 0.68, metalness: 0.42 })
  );
  const rubberTrimMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.88, metalness: 0.04 })
  );
  const chromeMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xe2e8f0,
      roughness: 0.12,
      metalness: 0.96,
      clearcoat: 0.4,
    })
  );
  const brushedSteelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x9aa6b5, roughness: 0.30, metalness: 0.84 })
  );
  const grilleMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6edf5,
      map: textures.meshGrille,
      bumpMap: textures.meshGrilleBump,
      bumpScale: 0.015,
      roughness: 0.34,
      metalness: 0.82,
    })
  );
  const seatVinylMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x1b1f26,
      roughness: 0.52,
      metalness: 0.04,
      sheen: 0.35,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color(0x334155),
    })
  );
  const glassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x2c3e50,
      roughness: 0.06,
      metalness: 0.06,
      transparent: true,
      opacity: isSoftwareGl ? 0.48 : 0.38,
      transmission: isSoftwareGl ? 0 : 0.52,
      ior: 1.52,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      depthWrite: false,
    })
  );
  const clearLensMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.58,
      clearcoat: 1.0,
      depthWrite: false,
    })
  );
  const headlightGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff8e7,
      emissiveIntensity: 0.85,
      roughness: 0.15,
    })
  );
  const amberGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.45,
      roughness: 0.14,
      metalness: 0.06,
      transparent: true,
      opacity: 0.86,
      clearcoat: 0.9,
      depthWrite: false,
    })
  );
  const amberBulbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    })
  );
  const tailLensMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xdc2626,
      emissive: 0x991b1b,
      emissiveIntensity: 0.52,
      roughness: 0.18,
      clearcoat: 0.85,
    })
  );
  const evBlueMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      roughness: 0.25,
      metalness: 0.25,
      clearcoat: 0.65,
    })
  );
  const evGreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0.2,
    })
  );
  const dashScreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.dashboardGauge,
      emissive: 0x0c4a6e,
      emissiveMap: textures.dashboardGauge,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.1,
    })
  );

  // === 1. HEAVY STEEL UNDERCHASSIS & SCULPTED BODY SHELL ===
  const chassisMain = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.12, 0.20, 2.52)), darkChassisMat);
  chassisMain.position.set(0, 0.34, 0.02);
  chassisMain.castShadow = true;
  chassisMain.receiveShadow = true;
  registerZoneMesh(chassisMain, zHitch, clickableMeshes, zoneMeshes);
  root.add(chassisMain);

  // Front & rear axle housings underneath
  for (const [zAx, rAx] of [
    [0.82, 0.055],
    [-0.78, 0.072],
  ] as const) {
    const axle = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(rAx, rAx, 1.18, 16)), darkChassisMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, zAx > 0 ? 0.28 : 0.38, zAx);
    registerZoneMesh(axle, zWheels, clickableMeshes, zoneMeshes);
    root.add(axle);
  }
  // Rear differential pumpkin
  const diffPumpkin = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.14, 18, 14)), darkChassisMat);
  diffPumpkin.position.set(0, 0.38, -0.78);
  registerZoneMesh(diffPumpkin, isEv ? "ev_motor" : "diesel_engine", clickableMeshes, zoneMeshes);
  root.add(diffPumpkin);

  // Sculpted wrap-around lower white bumper (ExtrudeGeometry with smooth bevels matching Photo 1)
  const bumperShape = new THREE.Shape();
  bumperShape.moveTo(-0.67, -0.18);
  bumperShape.lineTo(0.67, -0.18);
  bumperShape.lineTo(0.67, 0.16);
  bumperShape.quadraticCurveTo(0.67, 0.22, 0.60, 0.22);
  bumperShape.lineTo(-0.60, 0.22);
  bumperShape.quadraticCurveTo(-0.67, 0.22, -0.67, 0.16);
  bumperShape.closePath();

  const bumperGeo = trackGeo(
    new THREE.ExtrudeGeometry(bumperShape, {
      depth: 0.36,
      bevelEnabled: true,
      bevelThickness: 0.032,
      bevelSize: 0.026,
      bevelSegments: 4,
    })
  );
  bumperGeo.rotateX(Math.PI / 2);
  const frontBumper = new THREE.Mesh(bumperGeo, whiteBodyMat);
  frontBumper.position.set(0, 0.62, 1.36);
  frontBumper.castShadow = true;
  frontBumper.receiveShadow = true;
  registerZoneMesh(frontBumper, isEv ? "ev_battery" : "diesel_cooling", clickableMeshes, zoneMeshes);
  root.add(frontBumper);

  // Recessed lower bumper twin vent grille (exact match to Photo 1!)
  const lowerVentPocket = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.66, 0.17, 0.05)), darkChassisMat);
  lowerVentPocket.position.set(0, 0.48, 1.575);
  root.add(lowerVentPocket);
  for (let i = 0; i < 2; i++) {
    const slot = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.60, 0.052, 0.035)), grilleMat);
    slot.position.set(0, 0.44 + i * 0.08, 1.595);
    root.add(slot);
  }
  // Front recovery pin bar inside bumper recess
  const frontPin = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.11, 10)), chromeMat);
  frontPin.position.set(0, 0.34, 1.56);
  root.add(frontPin);

  // Upper Front Nose Cowl (Beveled Box via ExtrudeGeometry)
  const cowlShape = new THREE.Shape();
  cowlShape.moveTo(-0.66, -0.17);
  cowlShape.lineTo(0.66, -0.17);
  cowlShape.lineTo(0.64, 0.17);
  cowlShape.lineTo(-0.64, 0.17);
  cowlShape.closePath();
  const cowlGeo = trackGeo(
    new THREE.ExtrudeGeometry(cowlShape, {
      depth: 0.32,
      bevelEnabled: true,
      bevelThickness: 0.024,
      bevelSize: 0.022,
      bevelSegments: 3,
    })
  );
  const frontNose = new THREE.Mesh(cowlGeo, whiteBodyMat);
  frontNose.position.set(0, 0.81, 1.10);
  frontNose.castShadow = true;
  frontNose.receiveShadow = true;
  registerZoneMesh(frontNose, isEv ? "ev_inverter" : "diesel_cooling", clickableMeshes, zoneMeshes);
  root.add(frontNose);

  // Trapezoidal Recessed Silver Honeycomb Mesh Grille (signature look of Photo 1!)
  const trapGrilleShape = new THREE.Shape();
  trapGrilleShape.moveTo(-0.32, 0.13);
  trapGrilleShape.lineTo(0.32, 0.13);
  trapGrilleShape.lineTo(0.26, -0.13);
  trapGrilleShape.lineTo(-0.26, -0.13);
  trapGrilleShape.closePath();

  const grilleBezelGeo = trackGeo(
    new THREE.ExtrudeGeometry(trapGrilleShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 2,
    })
  );
  const grilleBezel = new THREE.Mesh(grilleBezelGeo, darkChassisMat);
  grilleBezel.position.set(0, 0.81, 1.415);
  root.add(grilleBezel);

  const grilleFace = new THREE.Mesh(trackGeo(new THREE.ShapeGeometry(trapGrilleShape)), grilleMat);
  grilleFace.position.set(0, 0.81, 1.462);
  registerZoneMesh(grilleFace, isEv ? "ev_inverter" : "diesel_cooling", clickableMeshes, zoneMeshes);
  root.add(grilleFace);

  // Center dark rectangular hood-release latch pocket inside mesh grille (visible in Photo 1!)
  const grilleLatch = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 0.06, 0.02)), darkChassisMat);
  grilleLatch.position.set(0, 0.84, 1.468);
  root.add(grilleLatch);

  // Recessed Multi-Reflector Headlights + Fender-Top Amber Turn Signals
  for (const side of [-1, 1]) {
    const pocket = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.19, 0.08)), darkChassisMat);
    pocket.position.set(side * 0.49, 0.81, 1.415);
    root.add(pocket);

    // Chrome parabolic reflector bowl
    const refl = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.068, 0.036, 0.05, 18)), chromeMat);
    refl.rotation.x = Math.PI / 2;
    refl.position.set(side * 0.49, 0.81, 1.435);
    root.add(refl);

    // Inner bright halogen/LED bulb core
    const bulb = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.028, 12, 10)), headlightGlowMat);
    bulb.position.set(side * 0.49, 0.81, 1.448);
    root.add(bulb);

    // Outer clear headlight glass lens
    const lens = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.20, 0.15, 0.022)), clearLensMat);
    lens.position.set(side * 0.49, 0.81, 1.462);
    lens.renderOrder = 5;
    registerZoneMesh(lens, zCabin, clickableMeshes, zoneMeshes);
    root.add(lens);

    // Fender-top amber turn signal housing on black rubber base (exact match to Photo 1!)
    const sigBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, 0.035, 0.12)), rubberTrimMat);
    sigBase.position.set(side * 0.56, 1.005, 1.32);
    root.add(sigBase);

    const sigBulb = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.07, 0.055, 0.07)), amberBulbMat);
    sigBulb.position.set(side * 0.56, 1.05, 1.32);
    root.add(sigBulb);

    const sigLens = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.115, 0.082, 0.115)), amberGlassMat);
    sigLens.position.set(side * 0.56, 1.055, 1.32);
    sigLens.renderOrder = 5;
    registerZoneMesh(sigLens, zCabin, clickableMeshes, zoneMeshes);
    root.add(sigLens);
  }

  // Sculpted Side Body Panels with Stepped Entry Footwell & Flared Rear Wheel Arch (ExtrudeGeometry!)
  const sideFenderShape = new THREE.Shape();
  // Profile in (Z, Y) plane: from front wheel cutout -> low floor step -> sweeping rear fender arch -> rear tail
  sideFenderShape.moveTo(1.16, 0.62);
  sideFenderShape.lineTo(1.16, 0.98);
  sideFenderShape.lineTo(0.36, 1.02);
  sideFenderShape.lineTo(0.36, 0.46);
  sideFenderShape.lineTo(-0.24, 0.46);
  // Sweeping diagonal rise over rear wheel arch (matching Photo 1!)
  sideFenderShape.lineTo(-0.46, 0.94);
  sideFenderShape.lineTo(-1.14, 0.94);
  sideFenderShape.lineTo(-1.34, 0.72);
  sideFenderShape.lineTo(-1.34, 0.34);
  sideFenderShape.lineTo(-1.18, 0.34);
  // Rear wheel arch cutout
  sideFenderShape.absarc(-0.78, 0.38, 0.435, Math.PI, 0, true);
  sideFenderShape.lineTo(-0.30, 0.28);
  sideFenderShape.lineTo(0.42, 0.28);
  // Front wheel arch cutout
  sideFenderShape.absarc(0.82, 0.28, 0.345, Math.PI, 0, true);
  sideFenderShape.closePath();

  const sidePanelGeo = trackGeo(
    new THREE.ExtrudeGeometry(sideFenderShape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.016,
      bevelSize: 0.014,
      bevelSegments: 3,
    })
  );
  // Rotate so shape X maps to +Z, shape Y maps to +Y, depth along X
  sidePanelGeo.rotateY(-Math.PI / 2);

  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(sidePanelGeo, whiteBodyMat);
    panel.position.set(side > 0 ? 0.67 : -0.55, 0, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    registerZoneMesh(panel, zHitch, clickableMeshes, zoneMeshes);
    root.add(panel);

    // Anti-slip black rubber entry step mat in cabin footwell
    const stepMat = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.025, 0.56)), rubberTrimMat);
    stepMat.position.set(side * 0.55, 0.475, 0.04);
    root.add(stepMat);

    // Side body livery & Diesel/EV identification accent stripe
    const liveryStripe = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.016, 0.05, 0.62)),
      isEv ? evBlueMat : darkChassisMat
    );
    liveryStripe.position.set(side * 0.688, 0.40, 0.06);
    root.add(liveryStripe);
    if (isEv) {
      const greenAccent = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.018, 0.026, 0.44)), evGreenMat);
      greenAccent.position.set(side * 0.69, 0.35, 0.06);
      root.add(greenAccent);
    }
  }

  // Dynamic Fleet Registration Decals on Left & Right Front Side Body Panels
  const tractorPlateCode = (vehicleCode || (isEv ? "EV-01" : "TT-01")).trim();
  const tractorDecalTex = trackTex(
    createVehicleNumberDecalTexture(
      tractorPlateCode,
      isEv ? "ev_body" : "white_body",
      textures.maxAnisotropy
    )
  );
  const tractorDecalMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: tractorDecalTex,
      transparent: true,
      roughness: 0.34,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const sideDecalGeo = trackGeo(new THREE.PlaneGeometry(0.56, 0.24));
  for (const side of [-1, 1]) {
    const sideDecal = new THREE.Mesh(sideDecalGeo, tractorDecalMat);
    sideDecal.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    sideDecal.position.set(side * 0.694, 0.81, 0.76);
    sideDecal.userData.decalStyle = isEv ? "ev_body" : "white_body";
    sideDecal.userData.decalSize = [0.56, 0.24];
    root.add(sideDecal);
  }

  // Cabin floor pan with ribbed rubber mat
  const cabinFloor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.10, 0.04, 0.92)), rubberTrimMat);
  cabinFloor.position.set(0, 0.46, -0.02);
  cabinFloor.receiveShadow = true;
  root.add(cabinFloor);

  // Rear solid steel body deck & seat riser box
  const rearDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.16, 0.48, 0.96)), whiteBodyMat);
  rearDeck.position.set(0, 0.70, -0.84);
  rearDeck.castShadow = true;
  rearDeck.receiveShadow = true;
  registerZoneMesh(rearDeck, zHitch, clickableMeshes, zoneMeshes);
  root.add(rearDeck);

  // Rear Bumper Step & Heavy Pintle Tow Hitch Assembly (aligned at y = 0.46, z = -1.39!)
  const rearBumper = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.34, 0.14, 0.12)), darkChassisMat);
  rearBumper.position.set(0, 0.44, -1.35);
  rearBumper.castShadow = true;
  registerZoneMesh(rearBumper, zHitch, clickableMeshes, zoneMeshes);
  root.add(rearBumper);

  // Heavy Tow Jaw Clevis + Vertical Lock Pin
  const jawTop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.04, 0.18)), darkChassisMat);
  jawTop.position.set(0, 0.52, -1.40);
  registerZoneMesh(jawTop, zHitch, clickableMeshes, zoneMeshes);
  root.add(jawTop);
  const jawBot = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.04, 0.18)), darkChassisMat);
  jawBot.position.set(0, 0.40, -1.40);
  registerZoneMesh(jawBot, zHitch, clickableMeshes, zoneMeshes);
  root.add(jawBot);

  const hitchPin = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.25, 16)), chromeMat);
  hitchPin.position.set(0, 0.49, -1.40);
  registerZoneMesh(hitchPin, zHitch, clickableMeshes, zoneMeshes);
  root.add(hitchPin);
  const pinHandle = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.038, 0.01, 8, 16)), chromeMat);
  pinHandle.position.set(0, 0.63, -1.40);
  root.add(pinHandle);

  // Rear Combo Taillights + Reverse Lights
  for (const side of [-1, 1]) {
    const housing = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 0.11, 0.045)), rubberTrimMat);
    housing.position.set(side * 0.46, 0.82, -1.335);
    root.add(housing);
    const tailRed = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 0.075, 0.025)), tailLensMat);
    tailRed.position.set(side * 0.49, 0.82, -1.358);
    registerZoneMesh(tailRed, zHitch, clickableMeshes, zoneMeshes);
    root.add(tailRed);
    const tailAmber = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.065, 0.075, 0.025)), amberGlassMat);
    tailAmber.position.set(side * 0.39, 0.82, -1.358);
    root.add(tailAmber);
  }

  // === 2. BEVELED OPENABLE FRONT HOOD (Hinged at windshield base z = 0.38, y = 1.03) ===
  const hoodPivot = new THREE.Group();
  hoodPivot.position.set(0, 1.03, 0.38);
  root.add(hoodPivot);

  const hoodShape = new THREE.Shape();
  hoodShape.moveTo(-0.57, 0);
  hoodShape.lineTo(0.57, 0);
  hoodShape.lineTo(0.55, 0.92);
  hoodShape.lineTo(-0.55, 0.92);
  hoodShape.closePath();

  const hoodGeo = trackGeo(
    new THREE.ExtrudeGeometry(hoodShape, {
      depth: 0.065,
      bevelEnabled: true,
      bevelThickness: 0.022,
      bevelSize: 0.024,
      bevelSegments: 4,
    })
  );
  hoodGeo.rotateX(Math.PI / 2);

  const hoodPanel = new THREE.Mesh(hoodGeo, whiteBodyMat);
  hoodPanel.position.set(0, 0.025, 0.01);
  hoodPanel.rotation.x = 0.055;
  hoodPanel.castShadow = true;
  hoodPanel.receiveShadow = true;
  registerZoneMesh(hoodPanel, isEv ? "ev_battery" : "diesel_engine", clickableMeshes, zoneMeshes);
  hoodPivot.add(hoodPanel);

  // Twin rear hood hinge knuckles & front chrome U-shaped lift handle (exact match to Photo 1!)
  for (const side of [-1, 1]) {
    const hinge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.055, 0.032, 0.08)), brushedSteelMat);
    hinge.position.set(side * 0.42, 0.042, 0.04);
    hoodPivot.add(hinge);
  }
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.07, -0.025, 0.84),
    new THREE.Vector3(-0.07, 0.022, 0.84),
    new THREE.Vector3(0.07, 0.022, 0.84),
    new THREE.Vector3(0.07, -0.025, 0.84),
  ]);
  const hoodHandle = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(handleCurve, 16, 0.01, 8, false)), chromeMat);
  hoodPivot.add(hoodHandle);

  // === 3. HIGH-DETAIL UNDER-HOOD POWERTRAIN (DIESEL ENGINE vs EV HV BATTERY/INVERTER) ===
  if (!isEv) {
    // --- DETAILED 4-CYLINDER INDUSTRIAL DIESEL ENGINE ---
    const castIronMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3b4452, roughness: 0.62, metalness: 0.62 })
    );
    const castAlumMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xb6c2cf, roughness: 0.28, metalness: 0.84 })
    );
    const filterYellowMat = trackMat(
      new THREE.MeshPhysicalMaterial({ color: 0xeab308, roughness: 0.34, metalness: 0.16, clearcoat: 0.4 })
    );
    const filterWhiteMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.38, metalness: 0.12 })
    );
    const radCoreMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        map: textures.radiatorFins,
        roughness: 0.42,
        metalness: 0.78,
      })
    );
    const hoseMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: 0.78, metalness: 0.06 })
    );
    const copperMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.35, metalness: 0.75 })
    );

    // Engine Block + Oil Sump + Cylinder Head
    const oilSump = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.38, 0.14, 0.54)), darkChassisMat);
    oilSump.position.set(0.05, 0.50, 0.82);
    root.add(oilSump);

    const engineBlock = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.28, 0.56)), castIronMat);
    engineBlock.position.set(0.05, 0.70, 0.82);
    engineBlock.castShadow = true;
    registerZoneMesh(engineBlock, "diesel_engine", clickableMeshes, zoneMeshes);
    root.add(engineBlock);

    // Finned Aluminum Valve Cover + Bolts + Yellow Oil Filler Cap
    const valveCover = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.10, 0.52)), castAlumMat);
    valveCover.position.set(0.05, 0.89, 0.82);
    valveCover.castShadow = true;
    registerZoneMesh(valveCover, "diesel_engine", clickableMeshes, zoneMeshes);
    root.add(valveCover);

    for (let i = 0; i < 4; i++) {
      const bolt = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.025, 6)), chromeMat);
      bolt.position.set(0.05, 0.945, 0.62 + i * 0.13);
      root.add(bolt);
    }

    const oilCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.042, 0.042, 0.038, 16)), filterYellowMat);
    oilCap.position.set(0.05, 0.955, 0.95);
    registerZoneMesh(oilCap, "diesel_engine", clickableMeshes, zoneMeshes);
    root.add(oilCap);

    // Yellow Dipstick Ring
    const dipTube = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8)), brushedSteelMat);
    dipTube.position.set(-0.19, 0.79, 0.92);
    dipTube.rotation.z = 0.25;
    root.add(dipTube);
    const dipLoop = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.022, 0.006, 8, 14)), filterYellowMat);
    dipLoop.position.set(-0.22, 0.91, 0.92);
    registerZoneMesh(dipLoop, "diesel_engine", clickableMeshes, zoneMeshes);
    root.add(dipLoop);

    // 4-Runner Exhaust Manifold on Right Side
    for (let i = 0; i < 4; i++) {
      const runner = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 10)), copperMat);
      runner.rotation.z = Math.PI / 2;
      runner.position.set(0.28, 0.78, 0.62 + i * 0.13);
      registerZoneMesh(runner, "diesel_exhaust", clickableMeshes, zoneMeshes);
      root.add(runner);
    }
    const manifoldCollector = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.036, 0.036, 0.48, 12)), copperMat);
    manifoldCollector.rotation.x = Math.PI / 2;
    manifoldCollector.position.set(0.33, 0.78, 0.82);
    registerZoneMesh(manifoldCollector, "diesel_exhaust", clickableMeshes, zoneMeshes);
    root.add(manifoldCollector);

    // Front Serpentine Pulleys & Multi-Blade Cooling Fan
    const pulleyCoords: Array<[number, number, number]> = [
      [0.05, 0.62, 0.068],
      [0.05, 0.80, 0.048],
      [0.21, 0.72, 0.044],
    ];
    for (const [px, py, pr] of pulleyCoords) {
      const pulley = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(pr, pr, 0.032, 18)), darkChassisMat);
      pulley.rotation.x = Math.PI / 2;
      pulley.position.set(px, py, 1.115);
      registerZoneMesh(pulley, "diesel_engine", clickableMeshes, zoneMeshes);
      root.add(pulley);
    }
    // Cooling fan blades
    const fanHub = new THREE.Group();
    fanHub.position.set(0.05, 0.76, 1.155);
    for (let b = 0; b < 6; b++) {
      const blade = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.055, 0.14, 0.012)), rubberTrimMat);
      const a = (b / 6) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0);
      blade.rotation.z = a;
      blade.rotation.y = 0.35;
      fanHub.add(blade);
    }
    root.add(fanHub);

    // Finned Aluminum Radiator + Pressure Cap + Upper/Lower Coolant Hoses
    const radFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.68, 0.42, 0.09)), darkChassisMat);
    radFrame.position.set(0, 0.73, 1.24);
    registerZoneMesh(radFrame, "diesel_cooling", clickableMeshes, zoneMeshes);
    root.add(radFrame);

    const radCore = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.60, 0.34, 0.098)), radCoreMat);
    radCore.position.set(0, 0.73, 1.24);
    registerZoneMesh(radCore, "diesel_cooling", clickableMeshes, zoneMeshes);
    root.add(radCore);

    const radCap = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.038, 0.038, 0.028, 16)), chromeMat);
    radCap.position.set(0.20, 0.955, 1.24);
    registerZoneMesh(radCap, "diesel_cooling", clickableMeshes, zoneMeshes);
    root.add(radCap);

    // Curved upper radiator hose
    const upperHoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.05, 0.87, 1.04),
      new THREE.Vector3(0.09, 0.92, 1.14),
      new THREE.Vector3(0.12, 0.88, 1.22),
    ]);
    const upperHose = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(upperHoseCurve, 14, 0.022, 10, false)), hoseMat);
    registerZoneMesh(upperHose, "diesel_cooling", clickableMeshes, zoneMeshes);
    root.add(upperHose);

    // Cyclone Air Cleaner Canister + Corrugated Intake Duct (left engine bay)
    const airCanister = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.105, 0.105, 0.38, 20)), darkChassisMat);
    airCanister.rotation.x = Math.PI / 2;
    airCanister.position.set(-0.37, 0.82, 0.86);
    airCanister.castShadow = true;
    registerZoneMesh(airCanister, "diesel_fuel_air", clickableMeshes, zoneMeshes);
    root.add(airCanister);

    const airSnorkelCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.37, 0.82, 0.67),
      new THREE.Vector3(-0.26, 0.86, 0.64),
      new THREE.Vector3(-0.08, 0.86, 0.72),
    ]);
    const airSnorkel = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(airSnorkelCurve, 14, 0.034, 10, false)), hoseMat);
    registerZoneMesh(airSnorkel, "diesel_fuel_air", clickableMeshes, zoneMeshes);
    root.add(airSnorkel);

    // Spin-on Yellow Diesel Fuel Filter & White Oil Filter
    const fuelFilter = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.16, 16)), filterYellowMat);
    fuelFilter.position.set(-0.35, 0.64, 0.66);
    registerZoneMesh(fuelFilter, "diesel_fuel_air", clickableMeshes, zoneMeshes);
    root.add(fuelFilter);

    const oilFilter = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.13, 16)), filterWhiteMat);
    oilFilter.position.set(-0.24, 0.64, 0.84);
    registerZoneMesh(oilFilter, "diesel_engine", clickableMeshes, zoneMeshes);
    root.add(oilFilter);

    // 12V Starter Battery with Red/Black Terminals
    const batt12v = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.20, 0.18, 0.24)), darkChassisMat);
    batt12v.position.set(0.41, 0.64, 0.58);
    root.add(batt12v);
    const posTerm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10)), tailLensMat);
    posTerm.position.set(0.36, 0.74, 0.64);
    root.add(posTerm);
    const negTerm = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10)), brushedSteelMat);
    negTerm.position.set(0.46, 0.74, 0.64);
    root.add(negTerm);

    // Full Underbody Exhaust Pipe + Oval Muffler + Chrome Tailpipe Tip
    const exhaustCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.33, 0.76, 0.62),
      new THREE.Vector3(0.44, 0.42, 0.42),
      new THREE.Vector3(0.46, 0.28, -0.45),
      new THREE.Vector3(0.45, 0.29, -1.36),
    ]);
    const exhaustPipe = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(exhaustCurve, 28, 0.030, 12, false)), brushedSteelMat);
    registerZoneMesh(exhaustPipe, "diesel_exhaust", clickableMeshes, zoneMeshes);
    root.add(exhaustPipe);

    const muffler = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.088, 0.088, 0.46, 18)), brushedSteelMat);
    muffler.rotation.x = Math.PI / 2;
    muffler.position.set(0.46, 0.29, -0.52);
    registerZoneMesh(muffler, "diesel_exhaust", clickableMeshes, zoneMeshes);
    root.add(muffler);
  } else {
    // --- DETAILED HIGH-VOLTAGE EV POWERTRAIN ---
    const batteryCellMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x0284c7,
        roughness: 0.28,
        metalness: 0.48,
        clearcoat: 0.45,
      })
    );
    const busbarCopperMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.22, metalness: 0.92 })
    );
    const hvOrangeMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xf97316,
        emissive: 0xc2410c,
        emissiveIntensity: 0.22,
        roughness: 0.34,
        metalness: 0.14,
        clearcoat: 0.35,
      })
    );
    const inverterAlumMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd2dce6, roughness: 0.26, metalness: 0.86 })
    );

    // Steel Containment Tray
    const packTray = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.84, 0.09, 0.66)), darkChassisMat);
    packTray.position.set(0.06, 0.54, 0.78);
    root.add(packTray);

    // 4 Modular HV Lithium-Ion Battery Packs with Copper Busbars & Hold-Down Straps
    for (let i = 0; i < 4; i++) {
      const cx = -0.21 + i * 0.18;
      const cell = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.155, 0.28, 0.56)), batteryCellMat);
      cell.position.set(cx, 0.72, 0.78);
      cell.castShadow = true;
      registerZoneMesh(cell, "ev_battery", clickableMeshes, zoneMeshes);
      root.add(cell);

      // Aluminum top cap plate
      const topPlate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.02, 0.52)), inverterAlumMat);
      topPlate.position.set(cx, 0.868, 0.78);
      root.add(topPlate);

      // Copper busbar interconnects
      if (i < 3) {
        const bus = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.016, 0.045)), busbarCopperMat);
        bus.position.set(cx + 0.09, 0.885, 0.92);
        root.add(bus);
      }
    }

    // BMS Control Box with Green Status LED Strip
    const bmsBox = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.075, 0.18)), darkChassisMat);
    bmsBox.position.set(0.06, 0.905, 0.62);
    registerZoneMesh(bmsBox, "ev_battery", clickableMeshes, zoneMeshes);
    root.add(bmsBox);
    const bmsLed = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.018, 0.025)), evGreenMat);
    bmsLed.position.set(0.06, 0.946, 0.68);
    root.add(bmsLed);

    // Finned Cast-Aluminum Inverter & DC-DC Controller Unit
    const inverterBox = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.18, 0.30)), inverterAlumMat);
    inverterBox.position.set(-0.24, 0.74, 1.18);
    inverterBox.castShadow = true;
    registerZoneMesh(inverterBox, "ev_inverter", clickableMeshes, zoneMeshes);
    root.add(inverterBox);
    for (let f = 0; f < 8; f++) {
      const fin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.014, 0.045, 0.28)), inverterAlumMat);
      fin.position.set(-0.42 + f * 0.052, 0.85, 1.18);
      root.add(fin);
    }

    // High-Voltage Safety-Orange Braided Cables + Waterproof Orange Connectors
    const hvCurve1 = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.18, 0.88, 0.94),
      new THREE.Vector3(-0.24, 0.92, 1.06),
      new THREE.Vector3(-0.26, 0.85, 1.14),
    ]);
    const hvCable1 = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(hvCurve1, 18, 0.020, 10, false)), hvOrangeMat);
    registerZoneMesh(hvCable1, "ev_charger", clickableMeshes, zoneMeshes);
    root.add(hvCable1);

    const hvCurve2 = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.24, 0.87, 0.72),
      new THREE.Vector3(0.32, 0.68, 0.30),
      new THREE.Vector3(0.24, 0.46, -0.62),
    ]);
    const hvCable2 = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(hvCurve2, 24, 0.022, 10, false)), hvOrangeMat);
    registerZoneMesh(hvCable2, "ev_motor", clickableMeshes, zoneMeshes);
    root.add(hvCable2);

    // Finned AC Electric Traction Motor coupled to Rear Drive Axle
    const motorHousing = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.155, 0.155, 0.44, 24)), inverterAlumMat);
    motorHousing.rotation.z = Math.PI / 2;
    motorHousing.position.set(0.16, 0.44, -0.66);
    registerZoneMesh(motorHousing, "ev_motor", clickableMeshes, zoneMeshes);
    root.add(motorHousing);
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.16, 0.01, 6, 20)), brushedSteelMat);
      rib.rotation.y = Math.PI / 2;
      rib.position.set(-0.02 + i * 0.072, 0.44, -0.66);
      root.add(rib);
    }

    // Left-Side Industrial EV Charging Port (Hinged Bezel + Illuminated Multi-Pin Socket)
    const chargeBezel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.055, 0.21, 0.22)), darkChassisMat);
    chargeBezel.position.set(-0.675, 0.76, -0.25);
    registerZoneMesh(chargeBezel, "ev_charger", clickableMeshes, zoneMeshes);
    root.add(chargeBezel);

    const chargeRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.062, 0.012, 10, 20)), evGreenMat);
    chargeRing.rotation.y = Math.PI / 2;
    chargeRing.position.set(-0.706, 0.76, -0.25);
    registerZoneMesh(chargeRing, "ev_charger", clickableMeshes, zoneMeshes);
    root.add(chargeRing);

    const chargeCore = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.03, 18)), rubberTrimMat);
    chargeCore.rotation.z = Math.PI / 2;
    chargeCore.position.set(-0.70, 0.76, -0.25);
    root.add(chargeCore);
  }

  // === 4. SLOPED WINDSHIELD WITH RUBBER GASKET, ARTICULATED WIPER, CONVEX MIRRORS & CANOPY ===
  const wsGroup = new THREE.Group();
  wsGroup.position.set(0, 1.02, 0.36);
  wsGroup.rotation.x = -0.20;
  root.add(wsGroup);

  // Outer white steel A-pillars + top/bottom header beams
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.088, 0.94, 0.088)), whiteBodyMat);
    pillar.position.set(side * 0.56, 0.47, 0);
    pillar.castShadow = true;
    registerZoneMesh(pillar, zCabin, clickableMeshes, zoneMeshes);
    wsGroup.add(pillar);
  }
  const wsTopBar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.22, 0.095, 0.095)), whiteBodyMat);
  wsTopBar.position.set(0, 0.93, 0);
  wsGroup.add(wsTopBar);
  const wsBottomBar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.22, 0.075, 0.095)), whiteBodyMat);
  wsBottomBar.position.set(0, 0.035, 0);
  wsGroup.add(wsBottomBar);

  // Molded Black Rubber Windshield Gasket Surround (matching Photo 1!)
  for (const [gx, gy, gw, gh] of [
    [0, 0.875, 1.07, 0.038],
    [0, 0.085, 1.07, 0.038],
    [-0.516, 0.48, 0.038, 0.82],
    [0.516, 0.48, 0.038, 0.82],
  ] as const) {
    const gasket = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(gw, gh, 0.048)), rubberTrimMat);
    gasket.position.set(gx, gy, 0.01);
    wsGroup.add(gasket);
  }

  // Tinted Automotive Laminated Safety Windshield Glass
  const wsGlass = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.00, 0.76, 0.018)), glassMat);
  wsGlass.position.set(0, 0.48, 0.008);
  wsGlass.renderOrder = 4;
  registerZoneMesh(wsGlass, zCabin, clickableMeshes, zoneMeshes);
  wsGroup.add(wsGlass);

  // Articulated Windshield Wiper Pivot + Arm + Blade (matching Photo 1!)
  const wiperPivot = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.022, 0.024, 0.04, 12)), rubberTrimMat);
  wiperPivot.rotation.x = Math.PI / 2;
  wiperPivot.position.set(0.14, 0.14, 0.03);
  wsGroup.add(wiperPivot);

  const wiperArm = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.016, 0.50, 0.014)), rubberTrimMat);
  wiperArm.position.set(-0.02, 0.36, 0.042);
  wiperArm.rotation.z = 0.52;
  wsGroup.add(wiperArm);

  const wiperBlade = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.012, 0.42, 0.020)), rubberTrimMat);
  wiperBlade.position.set(-0.10, 0.56, 0.034);
  wiperBlade.rotation.z = 0.42;
  wsGroup.add(wiperBlade);

  // Curved Black Tubular Mirror Stalks + Rounded Beveled Side Mirrors with Reflective Glass (Photo 1!)
  for (const side of [-1, 1]) {
    const stalkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.59, 0.18, 0.03),
      new THREE.Vector3(side * 0.77, 0.18, 0.11),
      new THREE.Vector3(side * 0.80, 0.30, 0.13),
      new THREE.Vector3(side * 0.80, 0.46, 0.13),
    ]);
    const stalk = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(stalkCurve, 18, 0.014, 10, false)), rubberTrimMat);
    stalk.castShadow = true;
    wsGroup.add(stalk);

    // Mirror housing
    const mHousing = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.048, 0.25, 0.135)), rubberTrimMat);
    mHousing.position.set(side * 0.80, 0.55, 0.13);
    mHousing.castShadow = true;
    registerZoneMesh(mHousing, zCabin, clickableMeshes, zoneMeshes);
    wsGroup.add(mHousing);

    // Reflective mirror glass facing driver (-Z)
    const mGlass = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.115, 0.22)), chromeMat);
    mGlass.rotation.y = Math.PI;
    mGlass.position.set(side * 0.80, 0.55, 0.06);
    wsGroup.add(mGlass);
  }

  // Sleek Beveled Overhead Canopy Roof + Drip Trim + Rear C-Pillars
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-0.60, -0.68);
  roofShape.lineTo(0.60, -0.68);
  roofShape.lineTo(0.60, 0.68);
  roofShape.lineTo(-0.60, 0.68);
  roofShape.closePath();
  const roofGeo = trackGeo(
    new THREE.ExtrudeGeometry(roofShape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.02,
      bevelSegments: 3,
    })
  );
  roofGeo.rotateX(Math.PI / 2);

  const roofPanel = new THREE.Mesh(roofGeo, whiteBodyMat);
  roofPanel.position.set(0, 1.98, -0.46);
  roofPanel.castShadow = true;
  registerZoneMesh(roofPanel, zCabin, clickableMeshes, zoneMeshes);
  root.add(roofPanel);

  // Dynamic Fleet Registration Decal on Canopy Roof (Clear of Beacon & Drip Trim)
  const roofDecal = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.92, 0.39)), tractorDecalMat);
  roofDecal.rotation.x = -Math.PI / 2;
  roofDecal.position.set(0, 2.002, -0.56);
  roofDecal.userData.decalStyle = isEv ? "ev_body" : "white_body";
  roofDecal.userData.decalSize = [0.92, 0.39];
  root.add(roofDecal);

  // Black roof brow trim
  const roofBrow = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.18, 0.022, 0.08)), rubberTrimMat);
  roofBrow.position.set(0, 1.995, 0.19);
  root.add(roofBrow);

  for (const side of [-1, 1]) {
    const rearPillar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.075, 1.02, 0.082)), whiteBodyMat);
    rearPillar.position.set(side * 0.56, 1.44, -1.08);
    rearPillar.castShadow = true;
    root.add(rearPillar);
  }

  // Rooftop Fresnel Amber Beacon Light (Photo 1!)
  const beacon = createAmberBeacon(
    rubberTrimMat,
    chromeMat,
    amberGlassMat,
    amberBulbMat,
    zCabin,
    clickableMeshes,
    zoneMeshes,
    geometries
  );
  beacon.position.set(0, 1.99, 0.08);
  root.add(beacon);

  // === 5. CABIN INTERIOR (TWIN BOLSTERED BUCKET SEATS, DASHBOARD GAUGES, 3-SPOKE WHEEL, PEDALS) ===
  for (const side of [-1, 1]) {
    const seat = createBucketSeat(
      seatVinylMat,
      darkChassisMat,
      zCabin,
      clickableMeshes,
      zoneMeshes,
      geometries
    );
    seat.position.set(side * 0.28, 0.88, -0.42);
    root.add(seat);
  }

  // Sculpted Dashboard Console + Illuminated Instrument Cluster
  const dashBody = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.06, 0.28, 0.26)), darkChassisMat);
  dashBody.position.set(0, 0.92, 0.24);
  registerZoneMesh(dashBody, zCabin, clickableMeshes, zoneMeshes);
  root.add(dashBody);

  const gaugeFace = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.42, 0.16)), dashScreenMat);
  gaugeFace.position.set(0.24, 0.98, 0.105);
  gaugeFace.rotation.y = Math.PI;
  gaugeFace.rotation.x = 0.28;
  root.add(gaugeFace);

  // Steering Column + 3-Spoke Steering Wheel with Center Horn Pad
  const steerCol = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.032, 0.040, 0.54, 16)), darkChassisMat);
  steerCol.position.set(0.28, 1.06, 0.08);
  steerCol.rotation.x = -0.50;
  root.add(steerCol);

  const wheelGrp = new THREE.Group();
  wheelGrp.position.set(0.28, 1.27, -0.05);
  wheelGrp.rotation.x = Math.PI / 2 - 0.50;
  root.add(wheelGrp);

  const steerRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.165, 0.020, 12, 28)), rubberTrimMat);
  registerZoneMesh(steerRim, zCabin, clickableMeshes, zoneMeshes);
  wheelGrp.add(steerRim);
  const hornBoss = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.032, 16)), darkChassisMat);
  hornBoss.rotation.x = Math.PI / 2;
  wheelGrp.add(hornBoss);
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * Math.PI * 2 + Math.PI / 6;
    const spoke = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.022, 0.15, 0.016)), darkChassisMat);
    spoke.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheelGrp.add(spoke);
  }

  // Brake & Accelerator Pedals
  for (const [px, pw] of [
    [0.18, 0.08],
    [0.34, 0.055],
  ] as const) {
    const pedal = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(pw, 0.11, 0.02)), rubberTrimMat);
    pedal.position.set(px, 0.56, 0.26);
    pedal.rotation.x = -0.45;
    root.add(pedal);
  }

  // Gear Shift & Parking Brake Levers with Knobs
  const lever = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.011, 0.013, 0.36, 10)), chromeMat);
  lever.position.set(0.0, 1.12, -0.22);
  lever.rotation.x = 0.26;
  root.add(lever);
  const leverKnob = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.028, 12, 10)), rubberTrimMat);
  leverKnob.position.set(0.0, 1.30, -0.17);
  root.add(leverKnob);

  // === 6. REALISTIC CONTOURED WHEELS (SMALLER FRONT, LARGER REAR, BLACK RIMS & BRASS LUGS — PHOTO 1) ===
  const frontR = 0.28;
  const rearR = 0.38;
  for (const side of [-1, 1]) {
    const fw = createRealisticWheel({
      radius: frontR,
      width: 0.21,
      rimColor: 0x161a20,
      lugColor: 0xd4b15f,
      lugCount: 6,
      treadType: "lug",
      deepDish: false,
      textures,
      zoneId: zWheels,
      clickableMeshes,
      zoneMeshes,
      geometries,
      materials,
    });
    fw.position.set(side * 0.64, frontR, 0.82);
    root.add(fw);

    const rw = createRealisticWheel({
      radius: rearR,
      width: 0.27,
      rimColor: 0x161a20,
      lugColor: 0xd4b15f,
      lugCount: 6,
      treadType: "lug",
      deepDish: true,
      textures,
      zoneId: zWheels,
      clickableMeshes,
      zoneMeshes,
      geometries,
      materials,
    });
    rw.position.set(side * 0.66, rearR, -0.78);
    root.add(rw);
  }

  // Soft Ground Contact Shadow
  const shadowPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(2.35, 3.8)),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: textures.contactShadow,
        transparent: true,
        depthWrite: false,
        opacity: 0.78,
      })
    )
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0, 0.012, 0.04);
  root.add(shadowPlane);

  return {
    root,
    hoodPivot,
    hoodOpenRotationX: -0.98,
    hoodOpenOffsetY: 0,
    explodedParts,
    clickableMeshes,
    zoneMeshes,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      dynamicTextures.forEach((t) => t.dispose());
    },
  };
}

/**
 * 3. Photorealistic International Standard Counterbalance Forklift
 * Sculpted safety-yellow clearcoat chassis & curved cast-iron counterweight,
 * true C-channel duplex hydraulic mast with leaf lift chains, chain sheaves, hydraulic hoses,
 * forged tapered L-forks, contoured 4-pillar ROPS overhead guard with LED work lights & strobe,
 * ergonomic cabin with spinner-knob wheel, color-coded levers & openable under-seat powertrain bay.
 */
export function buildForklift(
  textures: Pm3dTexturePack,
  vehicleCode?: string
): BuiltVehicleModel {
  const root = new THREE.Group();
  const clickableMeshes: THREE.Mesh[] = [];
  const zoneMeshes = new Map<string, THREE.Mesh[]>();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dynamicTextures: THREE.Texture[] = [];
  const explodedParts: BuiltVehicleModel["explodedParts"] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    dynamicTextures.push(t);
    return t;
  };

  // === HIGH-FIDELITY INDUSTRIAL FORKLIFT PBR MATERIALS ===
  const yellowPaintMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf4b400,
      roughness: 0.25,
      metalness: 0.12,
      clearcoat: 0.68,
      clearcoatRoughness: 0.16,
    })
  );
  const darkMetalMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.54, metalness: 0.52 })
  );
  const rubberMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.88, metalness: 0.04 })
  );
  const chromeMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xe6edf5,
      roughness: 0.08,
      metalness: 0.97,
      clearcoat: 0.5,
    })
  );
  const forgedSteelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x2c3644, roughness: 0.38, metalness: 0.82 })
  );
  const chainSteelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.88 })
  );
  const amberGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.48,
      roughness: 0.14,
      transparent: true,
      opacity: 0.88,
      clearcoat: 0.9,
      depthWrite: false,
    })
  );
  const amberBulbMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xf59e0b, emissiveIntensity: 1.2 })
  );
  const headlightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 0.85,
      roughness: 0.12,
    })
  );
  const safetyBlueMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    })
  );
  const seatBeltOrangeMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, metalness: 0.05 })
  );
  const tailRedMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xdc2626,
      emissive: 0x991b1b,
      emissiveIntensity: 0.5,
      roughness: 0.18,
      clearcoat: 0.8,
    })
  );
  const dashScreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.dashboardGauge,
      emissive: 0x0c4a6e,
      emissiveMap: textures.dashboardGauge,
      emissiveIntensity: 0.55,
      roughness: 0.25,
    })
  );
  const specPlateMat = trackMat(
    new THREE.MeshStandardMaterial({ map: textures.specPlate, roughness: 0.35, metalness: 0.2 })
  );

  // === 1. LOWER STEEL CHASSIS & SCULPTED SIDE FENDERS ===
  const lowerFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.14, 0.34, 2.04)), darkMetalMat);
  lowerFrame.position.set(0, 0.40, -0.06);
  lowerFrame.castShadow = true;
  lowerFrame.receiveShadow = true;
  registerZoneMesh(lowerFrame, "fl_powertrain", clickableMeshes, zoneMeshes);
  root.add(lowerFrame);

  // Sculpted Yellow Side Body Panels with Boarding Step Cutout (ExtrudeGeometry)
  const flSideShape = new THREE.Shape();
  flSideShape.moveTo(0.84, 0.54);
  flSideShape.lineTo(0.84, 0.88);
  flSideShape.lineTo(0.58, 0.96);
  flSideShape.lineTo(-0.88, 0.96);
  flSideShape.lineTo(-0.88, 0.42);
  flSideShape.lineTo(-0.56, 0.42);
  flSideShape.lineTo(-0.50, 0.54);
  flSideShape.lineTo(0.28, 0.54);
  flSideShape.lineTo(0.36, 0.38);
  flSideShape.lineTo(0.84, 0.38);
  flSideShape.closePath();

  const flSideGeo = trackGeo(
    new THREE.ExtrudeGeometry(flSideShape, {
      depth: 0.13,
      bevelEnabled: true,
      bevelThickness: 0.018,
      bevelSize: 0.016,
      bevelSegments: 3,
    })
  );
  flSideGeo.rotateY(-Math.PI / 2);

  for (const side of [-1, 1]) {
    const bodySide = new THREE.Mesh(flSideGeo, yellowPaintMat);
    bodySide.position.set(side > 0 ? 0.62 : -0.49, 0, 0);
    bodySide.castShadow = true;
    bodySide.receiveShadow = true;
    registerZoneMesh(bodySide, "fl_powertrain", clickableMeshes, zoneMeshes);
    root.add(bodySide);

    // Side anti-slip entry step plate
    const stepPlate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.16, 0.025, 0.44)), darkMetalMat);
    stepPlate.position.set(side * 0.54, 0.43, -0.10);
    root.add(stepPlate);

    // Black protective rub rail strip
    const rubRail = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.024, 0.075, 1.24)), rubberMat);
    rubRail.position.set(side * 0.635, 0.68, -0.22);
    root.add(rubRail);

    // Capacity spec nameplate decal (rear side position)
    const decal = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.24, 0.115)), specPlateMat);
    decal.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    decal.position.set(side * 0.642, 0.84, -0.62);
    root.add(decal);
  }

  // Dynamic Fleet Registration Decals on Forklift Left & Right Side Panels
  const flPlateCode = (vehicleCode || "FL-01").trim();
  const flSideTex = trackTex(
    createVehicleNumberDecalTexture(flPlateCode, "yellow_body", textures.maxAnisotropy)
  );
  const flSideMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: flSideTex,
      transparent: true,
      roughness: 0.36,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const flSideDecalGeo = trackGeo(new THREE.PlaneGeometry(0.56, 0.21));
  for (const side of [-1, 1]) {
    const sideIdMesh = new THREE.Mesh(flSideDecalGeo, flSideMat);
    sideIdMesh.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    sideIdMesh.position.set(side * 0.644, 0.845, 0.04);
    sideIdMesh.userData.decalStyle = "yellow_body";
    sideIdMesh.userData.decalSize = [0.56, 0.21];
    root.add(sideIdMesh);
  }

  // === 2. SCULPTED CURVED CAST-IRON REAR COUNTERWEIGHT (ExtrudeGeometry) ===
  const cwShape = new THREE.Shape();
  cwShape.moveTo(-0.62, 0.0);
  cwShape.lineTo(0.62, 0.0);
  cwShape.quadraticCurveTo(0.62, -0.58, 0.36, -0.76);
  cwShape.quadraticCurveTo(0.0, -0.88, -0.36, -0.76);
  cwShape.quadraticCurveTo(-0.62, -0.58, -0.62, 0.0);
  cwShape.closePath();

  const cwGeo = trackGeo(
    new THREE.ExtrudeGeometry(cwShape, {
      depth: 0.72,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.036,
      bevelSegments: 5,
    })
  );
  cwGeo.rotateX(-Math.PI / 2);

  const counterweight = new THREE.Mesh(cwGeo, yellowPaintMat);
  counterweight.position.set(0, 0.38, -0.86);
  counterweight.castShadow = true;
  counterweight.receiveShadow = true;
  registerZoneMesh(counterweight, "fl_counterweight", clickableMeshes, zoneMeshes);
  root.add(counterweight);

  // Recessed Louvered Radiator Exhaust Vent on Counterweight Rear
  const cwVentBox = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.66, 0.28, 0.07)), darkMetalMat);
  cwVentBox.position.set(0, 0.86, -1.66);
  registerZoneMesh(cwVentBox, "fl_counterweight", clickableMeshes, zoneMeshes);
  root.add(cwVentBox);
  for (let i = 0; i < 4; i++) {
    const louver = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.58, 0.022, 0.05)), forgedSteelMat);
    louver.position.set(0, 0.76 + i * 0.062, -1.685);
    louver.rotation.x = 0.35;
    root.add(louver);
  }

  // Tow Pin Pocket + Chrome Tow Pin
  const towRecess = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.16, 0.14, 0.08)), darkMetalMat);
  towRecess.position.set(0, 0.56, -1.69);
  root.add(towRecess);
  const towPin = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.22, 14)), chromeMat);
  towPin.position.set(0, 0.58, -1.70);
  registerZoneMesh(towPin, "fl_counterweight", clickableMeshes, zoneMeshes);
  root.add(towPin);

  // Rear Combo LED Taillights
  for (const side of [-1, 1]) {
    const tailCase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.085, 0.045)), rubberMat);
    tailCase.position.set(side * 0.44, 1.00, -1.52);
    tailCase.rotation.y = side * -0.34;
    root.add(tailCase);
    const tailRed = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.09, 0.058, 0.025)), tailRedMat);
    tailRed.position.set(side * 0.45, 1.00, -1.54);
    tailRed.rotation.y = side * -0.34;
    registerZoneMesh(tailRed, "fl_counterweight", clickableMeshes, zoneMeshes);
    root.add(tailRed);
  }

  // === 3. UNDER-SEAT POWERTRAIN & HYDRAULIC PUMP BAY (REVEALED WHEN HOOD OPENS) ===
  const engineBlock = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.46, 0.32, 0.56)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0x3b4452, roughness: 0.55, metalness: 0.65 }))
  );
  engineBlock.position.set(-0.04, 0.66, -0.34);
  registerZoneMesh(engineBlock, "fl_powertrain", clickableMeshes, zoneMeshes);
  root.add(engineBlock);

  const valveCover = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.32, 0.08, 0.48)),
    trackMat(new THREE.MeshStandardMaterial({ color: 0xb6c2cf, roughness: 0.28, metalness: 0.85 }))
  );
  valveCover.position.set(-0.04, 0.86, -0.34);
  registerZoneMesh(valveCover, "fl_powertrain", clickableMeshes, zoneMeshes);
  root.add(valveCover);

  // Rear cooling radiator inside counterweight cavity
  const flRadiator = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.56, 0.36, 0.08)),
    trackMat(new THREE.MeshStandardMaterial({ map: textures.radiatorFins, roughness: 0.4, metalness: 0.78 }))
  );
  flRadiator.position.set(0, 0.72, -0.82);
  registerZoneMesh(flRadiator, "fl_powertrain", clickableMeshes, zoneMeshes);
  root.add(flRadiator);

  // Blue Hydraulic Gear Pump + Reservoir Tank + Braided Hoses
  const hydPump = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.10, 0.10, 0.24, 18)),
    trackMat(new THREE.MeshPhysicalMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.62, clearcoat: 0.4 }))
  );
  hydPump.rotation.x = Math.PI / 2;
  hydPump.position.set(0.32, 0.68, -0.22);
  registerZoneMesh(hydPump, "fl_hydraulics", clickableMeshes, zoneMeshes);
  root.add(hydPump);

  const hydTank = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 0.24, 0.32)), darkMetalMat);
  hydTank.position.set(0.34, 0.68, -0.58);
  registerZoneMesh(hydTank, "fl_hydraulics", clickableMeshes, zoneMeshes);
  root.add(hydTank);

  // Hinged Seat Deck / Engine Hood (Pivots Backward)
  const hoodPivot = new THREE.Group();
  hoodPivot.position.set(0, 0.96, -0.82);
  root.add(hoodPivot);

  const deckLid = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.94, 0.09, 0.80)), darkMetalMat);
  deckLid.position.set(0, 0.02, 0.40);
  deckLid.castShadow = true;
  registerZoneMesh(deckLid, "fl_powertrain", clickableMeshes, zoneMeshes);
  hoodPivot.add(deckLid);

  // Sculpted Suspension Seat + Orange Retractable Safety Belt mounted on hinged hood
  const opSeat = createBucketSeat(
    rubberMat,
    darkMetalMat,
    "fl_cabin",
    clickableMeshes,
    zoneMeshes,
    geometries
  );
  opSeat.position.set(0, 0.06, 0.38);
  hoodPivot.add(opSeat);

  // Bright orange seatbelt strap across seat hip
  const seatBelt = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.45, 0.032, 0.04)), seatBeltOrangeMat);
  seatBelt.position.set(0, 0.24, 0.40);
  hoodPivot.add(seatBelt);

  // === 4. OPERATOR COCKPIT: DASHBOARD, TILT WHEEL WITH SPINNER KNOB, 3 COLOR-CODED LEVERS ===
  const floorMat = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.94, 0.035, 0.72)), rubberMat);
  floorMat.position.set(0, 0.58, 0.22);
  root.add(floorMat);

  const dashTower = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.60, 0.56, 0.30)), darkMetalMat);
  dashTower.position.set(0, 0.86, 0.58);
  dashTower.castShadow = true;
  registerZoneMesh(dashTower, "fl_cabin", clickableMeshes, zoneMeshes);
  root.add(dashTower);

  const dashGauge = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.36, 0.14)), dashScreenMat);
  dashGauge.position.set(-0.04, 1.06, 0.425);
  dashGauge.rotation.y = Math.PI;
  dashGauge.rotation.x = 0.25;
  root.add(dashGauge);

  // Steering Column + 3-Spoke Wheel + Driver Spinner Knob
  const steerCol = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.032, 0.038, 0.48, 14)), darkMetalMat);
  steerCol.position.set(-0.04, 1.24, 0.48);
  steerCol.rotation.x = -0.44;
  root.add(steerCol);

  const flWheelGrp = new THREE.Group();
  flWheelGrp.position.set(-0.04, 1.43, 0.36);
  flWheelGrp.rotation.x = Math.PI / 2 - 0.44;
  root.add(flWheelGrp);

  const flSteerRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.155, 0.020, 12, 26)), rubberMat);
  registerZoneMesh(flSteerRim, "fl_cabin", clickableMeshes, zoneMeshes);
  flWheelGrp.add(flSteerRim);
  const spinnerKnob = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.022, 0.018, 0.055, 12)), darkMetalMat);
  spinnerKnob.rotation.x = Math.PI / 2;
  spinnerKnob.position.set(-0.11, 0.11, 0.035);
  flWheelGrp.add(spinnerKnob);

  // 3 Ergonomic Hydraulic Control Levers with Color-Coded Knobs (Lift, Tilt, Sideshift)
  const knobColors = [0xef4444, 0xf59e0b, 0x0ea5e9];
  for (let i = 0; i < 3; i++) {
    const lv = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.010, 0.010, 0.28, 10)), chromeMat);
    lv.position.set(0.22 + i * 0.06, 1.26, 0.46);
    lv.rotation.x = -0.18;
    registerZoneMesh(lv, "fl_cabin", clickableMeshes, zoneMeshes);
    root.add(lv);
    const knob = new THREE.Mesh(
      trackGeo(new THREE.CapsuleGeometry(0.018, 0.028, 4, 8)),
      trackMat(new THREE.MeshStandardMaterial({ color: knobColors[i], roughness: 0.35 }))
    );
    knob.position.set(0.22 + i * 0.06, 1.41, 0.43);
    root.add(knob);
  }

  // === 5. CONTOURED 4-PILLAR ROPS OVERHEAD GUARD, GRAB HANDLE, LED WORK LIGHTS & STROBE ===
  for (const side of [-1, 1]) {
    const ropsCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.54, 0.94, 0.72),
      new THREE.Vector3(side * 0.54, 1.56, 0.58),
      new THREE.Vector3(side * 0.54, 2.08, 0.42),
      new THREE.Vector3(side * 0.54, 2.13, -0.32),
      new THREE.Vector3(side * 0.54, 2.10, -0.96),
      new THREE.Vector3(side * 0.54, 1.06, -1.04),
    ]);
    const ropsPipe = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(ropsCurve, 44, 0.036, 12, false)), darkMetalMat);
    ropsPipe.castShadow = true;
    registerZoneMesh(ropsPipe, "fl_rops_lights", clickableMeshes, zoneMeshes);
    root.add(ropsPipe);

    // Front LED Work Spotlights on ROPS A-pillar brackets
    const lampCase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.125, 0.095, 0.085)), darkMetalMat);
    lampCase.position.set(side * 0.45, 1.98, 0.50);
    registerZoneMesh(lampCase, "fl_rops_lights", clickableMeshes, zoneMeshes);
    root.add(lampCase);
    const lampLens = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.10, 0.07, 0.02)), headlightMat);
    lampLens.position.set(side * 0.45, 1.98, 0.545);
    registerZoneMesh(lampLens, "fl_rops_lights", clickableMeshes, zoneMeshes);
    root.add(lampLens);
  }

  // Boarding Grab Handle on Left Front A-Pillar
  const grabCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.58, 1.12, 0.68),
    new THREE.Vector3(-0.63, 1.24, 0.65),
    new THREE.Vector3(-0.63, 1.48, 0.60),
    new THREE.Vector3(-0.58, 1.58, 0.58),
  ]);
  const grabHandle = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(grabCurve, 14, 0.014, 8, false)), rubberMat);
  root.add(grabHandle);

  // Slotted ROPS Overhead Guard Cross-Bars
  for (let i = 0; i < 7; i++) {
    const bar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.08, 0.036, 0.055)), darkMetalMat);
    bar.position.set(0, 2.13, -0.92 + i * 0.22);
    bar.rotation.x = 0.25;
    bar.castShadow = true;
    registerZoneMesh(bar, "fl_rops_lights", clickableMeshes, zoneMeshes);
    root.add(bar);
  }

  // Overhead ROPS Mounted Fleet Registration ID Plate (Visible from Iso & Top Views)
  const flRoofPlateBack = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.84, 0.018, 0.38)),
    darkMetalMat
  );
  flRoofPlateBack.position.set(0, 2.164, -0.26);
  flRoofPlateBack.castShadow = true;
  registerZoneMesh(flRoofPlateBack, "fl_rops_lights", clickableMeshes, zoneMeshes);
  root.add(flRoofPlateBack);

  const flRoofTex = trackTex(
    createVehicleNumberDecalTexture(flPlateCode, "forklift_roof", textures.maxAnisotropy)
  );
  const flRoofMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: flRoofTex,
      roughness: 0.34,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const flRoofDecal = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.80, 0.34)), flRoofMat);
  flRoofDecal.rotation.x = -Math.PI / 2;
  flRoofDecal.position.set(0, 2.176, -0.26);
  flRoofDecal.userData.decalStyle = "forklift_roof";
  flRoofDecal.userData.decalSize = [0.80, 0.34];
  root.add(flRoofDecal);

  // Panoramic Convex Rearview Mirror
  const rearMirror = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.08, 0.03)), rubberMat);
  rearMirror.position.set(0.24, 2.02, 0.42);
  root.add(rearMirror);

  // Rear Blue Pedestrian Safety Warning Spotlight
  const blueSpot = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.10, 0.075, 0.07)), darkMetalMat);
  blueSpot.position.set(0.22, 2.04, -1.00);
  root.add(blueSpot);
  const blueLens = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.075, 0.05, 0.02)), safetyBlueMat);
  blueLens.position.set(0.22, 2.04, -1.04);
  registerZoneMesh(blueLens, "fl_rops_lights", clickableMeshes, zoneMeshes);
  root.add(blueLens);

  // Rooftop Fresnel Amber Safety Beacon
  const flBeacon = createAmberBeacon(
    rubberMat,
    chromeMat,
    amberGlassMat,
    amberBulbMat,
    "fl_rops_lights",
    clickableMeshes,
    zoneMeshes,
    geometries
  );
  flBeacon.position.set(0, 2.14, -0.84);
  root.add(flBeacon);

  // === 6. TRUE C-CHANNEL DUPLEX MAST, LIFT CHAINS, SHEAVES, HYDRAULICS & TAPERED FORKS ===
  for (const side of [-1, 1]) {
    // Outer C-Channel Mast Rail (web + front & rear flanges)
    const web = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.035, 2.30, 0.16)), darkMetalMat);
    web.position.set(side * 0.37, 1.32, 1.14);
    web.castShadow = true;
    registerZoneMesh(web, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(web);
    for (const zf of [1.07, 1.21]) {
      const flange = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 2.30, 0.028)), darkMetalMat);
      flange.position.set(side * 0.34, 1.32, zf);
      registerZoneMesh(flange, "fl_mast_forks", clickableMeshes, zoneMeshes);
      root.add(flange);
    }

    // Inner Nested Telescoping Mast Channel
    const innerRail = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.075, 2.12, 0.11)), forgedSteelMat);
    innerRail.position.set(side * 0.25, 1.45, 1.18);
    innerRail.castShadow = true;
    registerZoneMesh(innerRail, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(innerRail);

    // Side Hydraulic Lift Cylinders + Mirror-Chrome Piston Rods
    const sideBarrel = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.038, 0.038, 1.56, 16)), darkMetalMat);
    sideBarrel.position.set(side * 0.24, 1.04, 1.06);
    registerZoneMesh(sideBarrel, "fl_hydraulics", clickableMeshes, zoneMeshes);
    root.add(sideBarrel);

    const sideRod = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 16)), chromeMat);
    sideRod.position.set(side * 0.24, 2.02, 1.06);
    registerZoneMesh(sideRod, "fl_hydraulics", clickableMeshes, zoneMeshes);
    root.add(sideRod);

    // Chain Sheave Pulley + Leaf Lift Chain
    const sheave = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.042, 20)), forgedSteelMat);
    sheave.rotation.z = Math.PI / 2;
    sheave.position.set(side * 0.17, 2.34, 1.18);
    registerZoneMesh(sheave, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(sheave);

    const leafChain = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.028, 1.72, 0.018)), chainSteelMat);
    leafChain.position.set(side * 0.17, 1.48, 1.24);
    registerZoneMesh(leafChain, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(leafChain);

    // Flexible Hydraulic Mast Hose Loop
    const mastHoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.11, 0.56, 1.12),
      new THREE.Vector3(side * 0.11, 2.18, 1.13),
      new THREE.Vector3(side * 0.11, 2.26, 1.19),
      new THREE.Vector3(side * 0.11, 0.72, 1.24),
    ]);
    const mastHose = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(mastHoseCurve, 28, 0.014, 8, false)), rubberMat);
    registerZoneMesh(mastHose, "fl_hydraulics", clickableMeshes, zoneMeshes);
    root.add(mastHose);

    // Twin Under-Floor Hydraulic Tilt Cylinders + Chrome Rods
    const tiltCyl = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.044, 0.044, 0.56, 16)), darkMetalMat);
    tiltCyl.rotation.x = Math.PI / 2;
    tiltCyl.position.set(side * 0.34, 0.58, 0.84);
    registerZoneMesh(tiltCyl, "fl_hydraulics", clickableMeshes, zoneMeshes);
    root.add(tiltCyl);

    const tiltRod = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.28, 14)), chromeMat);
    tiltRod.rotation.x = Math.PI / 2;
    tiltRod.position.set(side * 0.34, 0.58, 1.05);
    registerZoneMesh(tiltRod, "fl_hydraulics", clickableMeshes, zoneMeshes);
    root.add(tiltRod);
  }

  // Mast Cross Tie-Bars
  for (const yPos of [0.46, 1.42, 2.40]) {
    const cross = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.74, 0.085, 0.095)), darkMetalMat);
    cross.position.set(0, yPos, 1.14);
    registerZoneMesh(cross, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(cross);
  }

  // Central Free-Lift Hydraulic Cylinder + Chrome Piston
  const liftBarrel = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.056, 0.056, 1.44, 20)), darkMetalMat);
  liftBarrel.position.set(0, 1.00, 1.14);
  registerZoneMesh(liftBarrel, "fl_hydraulics", clickableMeshes, zoneMeshes);
  root.add(liftBarrel);
  const liftRod = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.034, 0.034, 0.64, 18)), chromeMat);
  liftRod.position.set(0, 1.94, 1.14);
  registerZoneMesh(liftRod, "fl_hydraulics", clickableMeshes, zoneMeshes);
  root.add(liftRod);

  // Fork Carriage + 5-Bar Tubular Load Backrest
  for (const yc of [0.28, 0.62]) {
    const carriageBar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.08, 0.09, 0.065)), darkMetalMat);
    carriageBar.position.set(0, yc, 1.29);
    registerZoneMesh(carriageBar, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(carriageBar);
  }
  for (let i = -2; i <= 2; i++) {
    const picket = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.036, 0.72, 0.036)), darkMetalMat);
    picket.position.set(i * 0.24, 0.84, 1.29);
    registerZoneMesh(picket, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(picket);
  }
  const backrestTop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.08, 0.048, 0.048)), darkMetalMat);
  backrestTop.position.set(0, 1.20, 1.29);
  root.add(backrestTop);

  // Forged Tapered Steel L-Forks (ExtrudeGeometry with authentic thick heel tapering to slim tip!)
  const forkProfile = new THREE.Shape();
  forkProfile.moveTo(0, 0.56);
  forkProfile.lineTo(0.055, 0.56);
  forkProfile.lineTo(0.055, 0.068);
  forkProfile.lineTo(0.45, 0.058);
  forkProfile.lineTo(1.16, 0.022);
  forkProfile.lineTo(1.16, 0.008);
  forkProfile.lineTo(0.04, 0.0);
  forkProfile.quadraticCurveTo(0, 0, 0, 0.05);
  forkProfile.closePath();

  const forkGeo = trackGeo(
    new THREE.ExtrudeGeometry(forkProfile, {
      depth: 0.11,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
    })
  );
  forkGeo.rotateY(-Math.PI / 2);

  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(forkGeo, forgedSteelMat);
    fork.position.set(side * 0.29 + 0.055, 0.08, 1.32);
    fork.castShadow = true;
    fork.receiveShadow = true;
    registerZoneMesh(fork, "fl_mast_forks", clickableMeshes, zoneMeshes);
    root.add(fork);

    // Fork top locking latch pin
    const lockPin = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10)), chromeMat);
    lockPin.position.set(side * 0.29, 0.66, 1.345);
    root.add(lockPin);
  }

  // === 7. LARGE FRONT DRIVE WHEELS & SMALLER REAR STEER WHEELS ===
  const frontR = 0.34;
  const rearR = 0.26;
  for (const side of [-1, 1]) {
    const fw = createRealisticWheel({
      radius: frontR,
      width: 0.25,
      rimColor: 0xf4b400,
      lugColor: 0x1e2530,
      lugCount: 6,
      treadType: "lug",
      deepDish: true,
      textures,
      zoneId: "fl_wheels",
      clickableMeshes,
      zoneMeshes,
      geometries,
      materials,
    });
    fw.position.set(side * 0.62, frontR, 0.68);
    root.add(fw);

    const rw = createRealisticWheel({
      radius: rearR,
      width: 0.19,
      rimColor: 0xf4b400,
      lugColor: 0x1e2530,
      lugCount: 6,
      treadType: "lug",
      deepDish: false,
      textures,
      zoneId: "fl_wheels",
      clickableMeshes,
      zoneMeshes,
      geometries,
      materials,
    });
    rw.position.set(side * 0.56, rearR, -0.86);
    root.add(rw);
  }

  // Ground Contact Shadow
  const shadowPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(2.4, 4.3)),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: textures.contactShadow,
        transparent: true,
        depthWrite: false,
        opacity: 0.76,
      })
    )
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0, 0.012, 0.22);
  root.add(shadowPlane);

  return {
    root,
    hoodPivot,
    hoodOpenRotationX: -0.76,
    hoodOpenOffsetY: 0,
    explodedParts,
    clickableMeshes,
    zoneMeshes,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      dynamicTextures.forEach((t) => t.dispose());
    },
  };
}

/**
 * 4. Photorealistic Heavy-Duty Industrial Flatbed Tow Trailer
 * Faithfully modeled after Reference Photo 2:
 * Matte charcoal checkered diamond-plate steel deck with crisp bump relief & lashing D-rings,
 * matte-black C-channel steel perimeter rail with bold black/yellow diagonal hazard stripes,
 * front white/red prismatic reflectors, side amber marker lamps & white manufacturer spec plate,
 * bolted front steering turntable + arched multi-leaf parabolic steel leaf springs with U-bolts & air brake chambers,
 * heavy rectangular A-frame steel drawbar with bolted tow head, forged lunette eye, multi-link draped safety chains,
 * genuine 3D helical red & yellow coiled air/electric hoses, and 4 large ribbed commercial tires on deep-dish silver rims.
 */
export function buildFlatbedTrailer(
  textures: Pm3dTexturePack,
  vehicleCode?: string
): BuiltVehicleModel {
  const root = new THREE.Group();
  const clickableMeshes: THREE.Mesh[] = [];
  const zoneMeshes = new Map<string, THREE.Mesh[]>();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dynamicTextures: THREE.Texture[] = [];
  const explodedParts: BuiltVehicleModel["explodedParts"] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    dynamicTextures.push(t);
    return t;
  };

  // === HIGH-FIDELITY INDUSTRIAL TRAILER PBR MATERIALS ===
  const deckMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b434f,
      map: textures.diamondPlate,
      bumpMap: textures.diamondPlateBump,
      bumpScale: 0.018,
      roughness: 0.56,
      metalness: 0.58,
    })
  );
  const hazardSideMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.hazardStripe,
      roughness: 0.42,
      metalness: 0.22,
    })
  );
  const hazardEndMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.hazardStripeEnd,
      roughness: 0.42,
      metalness: 0.22,
    })
  );
  const blackSteelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.52, metalness: 0.58 })
  );
  const chainIronMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1c2129, roughness: 0.44, metalness: 0.72 })
  );
  const boltSteelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.26, metalness: 0.88 })
  );
  const redCoilMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xdc2626,
      roughness: 0.26,
      metalness: 0.06,
      clearcoat: 0.55,
    })
  );
  const yellowCoilMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xfacc15,
      roughness: 0.26,
      metalness: 0.06,
      clearcoat: 0.55,
    })
  );
  const amberMarkerMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.42,
      roughness: 0.18,
      clearcoat: 0.85,
    })
  );
  const redReflectorMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.45,
      roughness: 0.16,
      clearcoat: 0.9,
    })
  );
  const whiteReflectorMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      emissive: 0xcbd5e1,
      emissiveIntensity: 0.32,
      roughness: 0.16,
      clearcoat: 0.9,
    })
  );
  const specPlateMat = trackMat(
    new THREE.MeshStandardMaterial({ map: textures.specPlate, roughness: 0.35, metalness: 0.15 })
  );

  const deckW = 1.98;
  const deckL = 3.78;
  const deckY = 0.89;

  // === 1. CHECKERED DIAMOND-PLATE STEEL DECK + STRUCTURAL UNDER-CHASSIS I-BEAMS ===
  const deckTop = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(deckW - 0.06, 0.055, deckL - 0.06)),
    deckMat
  );
  deckTop.position.set(0, deckY + 0.068, 0);
  deckTop.castShadow = true;
  deckTop.receiveShadow = true;
  registerZoneMesh(deckTop, "tr_deck", clickableMeshes, zoneMeshes);
  root.add(deckTop);

  // Subtle recessed perimeter steel deck frame lip + cargo tie-down D-rings
  for (const side of [-1, 1]) {
    for (const zRing of [-1.45, -0.5, 0.5, 1.45]) {
      const pocket = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.09, 0.015, 0.10)), blackSteelMat);
      pocket.position.set(side * (deckW / 2 - 0.14), deckY + 0.098, zRing);
      root.add(pocket);
      const ring = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.026, 0.007, 8, 14)), boltSteelMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(side * (deckW / 2 - 0.14), deckY + 0.104, zRing);
      root.add(ring);
    }
  }

  // Longitudinal Main Chassis Steel I-Beams + Crossmembers underneath deck
  for (const side of [-1, 1]) {
    const mainBeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 0.17, deckL - 0.18)), blackSteelMat);
    mainBeam.position.set(side * 0.56, deckY - 0.09, 0);
    mainBeam.castShadow = true;
    registerZoneMesh(mainBeam, "tr_deck", clickableMeshes, zoneMeshes);
    root.add(mainBeam);
  }
  for (let i = 0; i < 6; i++) {
    const zCross = -1.55 + i * 0.62;
    const cross = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(deckW - 0.16, 0.09, 0.075)), blackSteelMat);
    cross.position.set(0, deckY - 0.04, zCross);
    registerZoneMesh(cross, "tr_deck", clickableMeshes, zoneMeshes);
    root.add(cross);
  }

  // Under-deck tool/air reservoir box visible between front & rear axles (matching Photo 2!)
  const airTank = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.095, 0.095, 0.56, 18)), blackSteelMat);
  airTank.rotation.x = Math.PI / 2;
  airTank.position.set(0.38, 0.62, -0.05);
  registerZoneMesh(airTank, "tr_air_electric", clickableMeshes, zoneMeshes);
  root.add(airTank);

  // === 2. HAZARD-STRIPED PERIMETER C-CHANNEL BEAMS, REFLECTORS & SPEC PLATE (PHOTO 2) ===
  for (const side of [-1, 1]) {
    const sideBeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.075, 0.185, deckL)), hazardSideMat);
    sideBeam.position.set(side * (deckW / 2 - 0.02), deckY, 0);
    sideBeam.castShadow = true;
    sideBeam.receiveShadow = true;
    registerZoneMesh(sideBeam, "tr_reflectors", clickableMeshes, zoneMeshes);
    root.add(sideBeam);

    // Side amber oval marker lamps in black rubber grommets
    for (const zMark of [1.46, 0.02, -1.46]) {
      const grommet = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.025, 0.08, 0.125)), blackSteelMat);
      grommet.position.set(side * (deckW / 2 + 0.022), deckY - 0.005, zMark);
      root.add(grommet);
      const marker = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.022, 0.058, 0.098)), amberMarkerMat);
      marker.position.set(side * (deckW / 2 + 0.036), deckY - 0.005, zMark);
      registerZoneMesh(marker, "tr_reflectors", clickableMeshes, zoneMeshes);
      root.add(marker);
    }

    // White Manufacturer / Spec Plate Decal on side beam (matching Photo 2!)
    const plate = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.28, 0.12)), specPlateMat);
    plate.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    plate.position.set(side * (deckW / 2 + 0.022), deckY, -0.45);
    root.add(plate);
  }

  // Dynamic Fleet Registration Plates on Trailer Top Deck & Both Side Beams
  const trailerPlateCode = (vehicleCode || "TR-01").trim();
  const trSideTex = trackTex(
    createVehicleNumberDecalTexture(trailerPlateCode, "trailer_side", textures.maxAnisotropy)
  );
  const trSideMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: trSideTex,
      roughness: 0.34,
      metalness: 0.14,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const trSideGeo = trackGeo(new THREE.PlaneGeometry(0.50, 0.145));
  for (const side of [-1, 1]) {
    const trSidePlate = new THREE.Mesh(trSideGeo, trSideMat);
    trSidePlate.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    trSidePlate.position.set(side * (deckW / 2 + 0.024), deckY, 0.72);
    trSidePlate.userData.decalStyle = "trailer_side";
    trSidePlate.userData.decalSize = [0.50, 0.145];
    root.add(trSidePlate);
  }

  const trDeckTex = trackTex(
    createVehicleNumberDecalTexture(trailerPlateCode, "trailer_deck", textures.maxAnisotropy)
  );
  const trDeckMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: trDeckTex,
      transparent: true,
      roughness: 0.52,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const trDeckDecal = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(1.30, 0.56)), trDeckMat);
  trDeckDecal.rotation.x = -Math.PI / 2;
  trDeckDecal.position.set(0, deckY + 0.10, 0.02);
  trDeckDecal.userData.decalStyle = "trailer_deck";
  trDeckDecal.userData.decalSize = [1.30, 0.56];
  root.add(trDeckDecal);

  for (const zEnd of [deckL / 2 - 0.02, -(deckL / 2 - 0.02)]) {
    const endBeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(deckW, 0.185, 0.075)), hazardEndMat);
    endBeam.position.set(0, deckY, zEnd);
    endBeam.castShadow = true;
    registerZoneMesh(endBeam, "tr_reflectors", clickableMeshes, zoneMeshes);
    root.add(endBeam);
  }

  // Front Red/White Corner Prismatic Reflectors & Rear Recessed LED Tail Lamps (Photo 2!)
  for (const side of [-1, 1]) {
    const fCase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.135, 0.095, 0.024)), blackSteelMat);
    fCase.position.set(side * 0.78, deckY, deckL / 2 + 0.022);
    root.add(fCase);
    const fRefl = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.11, 0.072, 0.02)),
      side > 0 ? whiteReflectorMat : redReflectorMat
    );
    fRefl.position.set(side * 0.78, deckY, deckL / 2 + 0.036);
    registerZoneMesh(fRefl, "tr_reflectors", clickableMeshes, zoneMeshes);
    root.add(fRefl);

    const rCase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.22, 0.095, 0.03)), blackSteelMat);
    rCase.position.set(side * 0.72, deckY, -(deckL / 2 + 0.024));
    root.add(rCase);
    const rLight = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.068, 0.022)), redReflectorMat);
    rLight.position.set(side * 0.72, deckY, -(deckL / 2 + 0.038));
    registerZoneMesh(rLight, "tr_reflectors", clickableMeshes, zoneMeshes);
    root.add(rLight);
  }

  // === 3. STEERING TURNTABLE RING, ARCHED MULTI-LEAF SPRINGS, U-BOLTS & BRAKE CHAMBERS ===
  const turntableOuter = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.55, 0.55, 0.075, 32)), blackSteelMat);
  turntableOuter.position.set(0, 0.74, 1.18);
  registerZoneMesh(turntableOuter, "tr_turntable", clickableMeshes, zoneMeshes);
  root.add(turntableOuter);

  const turntableRace = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.54, 0.018, 10, 32)), boltSteelMat);
  turntableRace.rotation.x = Math.PI / 2;
  turntableRace.position.set(0, 0.74, 1.18);
  root.add(turntableRace);

  const subFrameFront = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.20, 0.11, 0.62)), blackSteelMat);
  subFrameFront.position.set(0, 0.63, 1.18);
  registerZoneMesh(subFrameFront, "tr_turntable", clickableMeshes, zoneMeshes);
  root.add(subFrameFront);

  // Heavy Solid Axles + Stacked Curved Multi-Leaf Parabolic Springs + U-Bolts + Air Brake Chambers
  for (const zAxle of [1.18, -1.18]) {
    const axle = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.056, 0.056, 1.72, 18)), blackSteelMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.40, zAxle);
    axle.castShadow = true;
    registerZoneMesh(axle, "tr_turntable", clickableMeshes, zoneMeshes);
    root.add(axle);

    for (const side of [-1, 1]) {
      // Stacked 5-blade arched steel leaf spring pack (Photo 2!)
      for (let blade = 0; blade < 5; blade++) {
        const len = 0.74 - blade * 0.095;
        const leaf = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.078, 0.017, len)), blackSteelMat);
        leaf.position.set(side * 0.56, 0.46 + blade * 0.019, zAxle);
        registerZoneMesh(leaf, "tr_turntable", clickableMeshes, zoneMeshes);
        root.add(leaf);
      }

      // Twin U-bolt clamps binding spring pack to axle
      for (const uz of [-0.055, 0.055]) {
        const uBolt = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.105, 0.145, 0.022)), boltSteelMat);
        uBolt.position.set(side * 0.56, 0.48, zAxle + uz);
        root.add(uBolt);
      }

      // Front & rear spring shackle brackets
      for (const sz of [-0.36, 0.36]) {
        const shackle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.095, 0.16, 0.065)), blackSteelMat);
        shackle.position.set(side * 0.56, 0.62, zAxle + sz);
        root.add(shackle);
      }

      // Cylindrical Air Brake Chamber near wheel hub
      const brakeChamber = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.11, 16)), blackSteelMat);
      brakeChamber.rotation.x = Math.PI / 2;
      brakeChamber.position.set(side * 0.66, 0.46, zAxle - 0.12);
      registerZoneMesh(brakeChamber, "tr_wheels", clickableMeshes, zoneMeshes);
      root.add(brakeChamber);
    }
  }

  // === 4. HEAVY BOX-SECTION A-FRAME DRAWBAR, FORGED LUNETTE EYE & LINKED SAFETY CHAINS (PHOTO 2!) ===
  const drawbarGroup = new THREE.Group();
  root.add(drawbarGroup);

  const buildBoxStrut = (p1: THREE.Vector3, p2: THREE.Vector3, w: number, h: number) => {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, h, len)), blackSteelMat);
    mesh.position.copy(mid);
    mesh.lookAt(p2);
    mesh.castShadow = true;
    registerZoneMesh(mesh, "tr_drawbar", clickableMeshes, zoneMeshes);
    drawbarGroup.add(mesh);
  };

  // Left & Right heavy rectangular box-section A-frame drawbar arms (matching Photo 2!)
  buildBoxStrut(new THREE.Vector3(-0.56, 0.58, 1.44), new THREE.Vector3(-0.07, 0.46, 2.66), 0.068, 0.095);
  buildBoxStrut(new THREE.Vector3(0.56, 0.58, 1.44), new THREE.Vector3(0.07, 0.46, 2.66), 0.068, 0.095);

  // Horizontal A-frame reinforcement cross-brace
  const aCross = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.54, 0.075, 0.065)), blackSteelMat);
  aCross.position.set(0, 0.52, 2.04);
  aCross.castShadow = true;
  registerZoneMesh(aCross, "tr_drawbar", clickableMeshes, zoneMeshes);
  drawbarGroup.add(aCross);

  // Bolted Heavy Tow-Head Block + Forged Weld Collar + Thick Lunette Towing Eye (aligned at y=0.46, z=2.86!)
  const hitchHead = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.18, 0.145, 0.25)), blackSteelMat);
  hitchHead.position.set(0, 0.46, 2.68);
  hitchHead.castShadow = true;
  registerZoneMesh(hitchHead, "tr_drawbar", clickableMeshes, zoneMeshes);
  drawbarGroup.add(hitchHead);

  // Side flange bolts on tow head
  for (const side of [-1, 1]) {
    for (const bz of [2.62, 2.74]) {
      const bolt = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.025, 6)), boltSteelMat);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(side * 0.098, 0.46, bz);
      drawbarGroup.add(bolt);
    }
  }

  const eyeCollar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.044, 0.052, 0.08, 16)), blackSteelMat);
  eyeCollar.rotation.x = Math.PI / 2;
  eyeCollar.position.set(0, 0.46, 2.81);
  drawbarGroup.add(eyeCollar);

  const lunetteEye = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.085, 0.029, 16, 30)), blackSteelMat);
  lunetteEye.rotation.x = Math.PI / 2;
  lunetteEye.position.set(0, 0.46, 2.86);
  lunetteEye.castShadow = true;
  registerZoneMesh(lunetteEye, "tr_drawbar", clickableMeshes, zoneMeshes);
  drawbarGroup.add(lunetteEye);

  // Authentic Multi-Link Draped Heavy Steel Safety Chains (Individual alternating Torus links!)
  const chainPathLeft = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.08, 0.51, 2.64),
    new THREE.Vector3(-0.14, 0.36, 2.62),
    new THREE.Vector3(-0.11, 0.19, 2.58),
    new THREE.Vector3(0.0, 0.15, 2.56),
    new THREE.Vector3(0.11, 0.21, 2.58),
    new THREE.Vector3(0.14, 0.38, 2.62),
    new THREE.Vector3(0.08, 0.51, 2.64),
  ]);
  const linkGeo = trackGeo(new THREE.TorusGeometry(0.020, 0.0068, 7, 12));
  const linkCount = 24;
  for (let i = 0; i <= linkCount; i++) {
    const t = i / linkCount;
    const pt = chainPathLeft.getPoint(t);
    const tangent = chainPathLeft.getTangent(t);
    const link = new THREE.Mesh(linkGeo, chainIronMat);
    link.position.copy(pt);
    link.lookAt(pt.clone().add(tangent));
    if (i % 2 === 1) link.rotateZ(Math.PI / 2);
    link.scale.set(0.75, 1.32, 1.0);
    link.castShadow = true;
    registerZoneMesh(link, "tr_drawbar", clickableMeshes, zoneMeshes);
    drawbarGroup.add(link);
  }

  // === 5. HIGH-RES 3D HELICAL RED & YELLOW COILED AIR/ELECTRIC HOSES (MATCHING PHOTO 2!) ===
  const buildHelixCoil = (
    startX: number,
    startY: number,
    startZ: number,
    endX: number,
    endY: number,
    endZ: number,
    turns: number,
    coilRadius: number,
    mat: THREE.Material
  ) => {
    // Bulkhead grommet at deck corner
    const grommet = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 12)), boltSteelMat);
    grommet.position.set(startX, startY + 0.01, startZ);
    root.add(grommet);

    const pts: THREE.Vector3[] = [];
    const steps = 110;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * turns * Math.PI * 2;
      const bx = THREE.MathUtils.lerp(startX, endX, t);
      const by = THREE.MathUtils.lerp(startY, endY, t) - Math.sin(t * Math.PI) * 0.14;
      const bz = THREE.MathUtils.lerp(startZ, endZ, t);
      const rFade = Math.sin(t * Math.PI);
      const rad = coilRadius * (0.35 + 0.65 * rFade);
      pts.push(new THREE.Vector3(bx + Math.cos(angle) * rad, by + Math.sin(angle) * rad, bz));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const mesh = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(curve, 110, 0.0115, 8, false)), mat);
    mesh.castShadow = true;
    registerZoneMesh(mesh, "tr_air_electric", clickableMeshes, zoneMeshes);
    root.add(mesh);

    // Brass coupling fitting at drawbar end
    const fitting = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.018, 0.016, 0.055, 10)), boltSteelMat);
    fitting.position.set(endX, endY, endZ);
    fitting.rotation.x = Math.PI / 3;
    registerZoneMesh(fitting, "tr_air_electric", clickableMeshes, zoneMeshes);
    root.add(fitting);
  };

  // Vibrant red & yellow coils draped cleanly at front-left deck corner (just like Photo 2!)
  buildHelixCoil(0.58, 0.80, 1.88, 0.22, 0.56, 2.08, 9, 0.042, redCoilMat);
  buildHelixCoil(0.45, 0.78, 1.90, 0.12, 0.54, 2.13, 8, 0.036, yellowCoilMat);

  // === 6. 4 LARGE COMMERCIAL HIGHWAY TIRES ON DEEP-DISH SILVER STEEL RIMS (PHOTO 2!) ===
  const wheelR = 0.41;
  for (const zPos of [1.18, -1.18]) {
    for (const side of [-1, 1]) {
      const w = createRealisticWheel({
        radius: wheelR,
        width: 0.29,
        rimColor: 0xd8e0ea,
        lugColor: 0x334155,
        lugCount: 8,
        treadType: "rib",
        deepDish: true,
        textures,
        zoneId: "tr_wheels",
        clickableMeshes,
        zoneMeshes,
        geometries,
        materials,
      });
      w.position.set(side * 0.84, wheelR, zPos);
      root.add(w);
    }
  }

  // Soft Ground Contact Shadow
  const shadowPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(3.2, 5.6)),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: textures.contactShadow,
        transparent: true,
        depthWrite: false,
        opacity: 0.74,
      })
    )
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0, 0.012, 0.36);
  root.add(shadowPlane);

  return {
    root,
    hoodPivot: null,
    hoodOpenRotationX: 0,
    hoodOpenOffsetY: 0,
    explodedParts,
    clickableMeshes,
    zoneMeshes,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      dynamicTextures.forEach((t) => t.dispose());
    },
  };
}

export function buildVehicleByModelType(
  modelType: MhPm3dModelType,
  textures: Pm3dTexturePack,
  isSoftwareGl: boolean,
  vehicleCode?: string
): BuiltVehicleModel {
  if (modelType === "diesel_tractor")
    return buildTowTractor("diesel", textures, isSoftwareGl, vehicleCode);
  if (modelType === "ev_tractor")
    return buildTowTractor("ev", textures, isSoftwareGl, vehicleCode);
  if (modelType === "forklift") return buildForklift(textures, vehicleCode);
  return buildFlatbedTrailer(textures, vehicleCode);
}
