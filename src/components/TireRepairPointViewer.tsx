/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Crosshair,
  Info,
  Layers,
  RotateCcw,
  RotateCw,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Vehicle } from "../types/officer";
import { MhTireStockRecord } from "../services/forkliftDataService";
import {
  ForkliftWheelCallout,
  WheelCalloutCode,
  getWheelProfileForVehicle,
  isCalloutHighlighted,
} from "./ForkliftWheelPositionDiagram";

export interface SelectedOutboundTirePreviewItem {
  tireSize: string;
  brand: string;
  typesSummary: string;
  qty: number;
}

interface TireRepairPointViewerProps {
  vehicleId: string;
  vehicle?: Vehicle;
  selectedPosition: string;
  onSelectPosition: (position: string) => void;
  tireNotes: string;
  onChangeNotes: (nextNotes: string) => void;
  operatingHours: string;
  technicianName: string;
  selectedTireItems: SelectedOutboundTirePreviewItem[];
  latestVehicleRecord?: MhTireStockRecord | null;
  latestWheelRecord?: MhTireStockRecord | null;
}

const QUICK_SYMPTOM_PRESETS = [
  "ยางรั่ว / โดนตะปู",
  "ดอกยางหมด / สึกหรอ",
  "แก้มยางฉีกขาด / บวม",
  "เปลี่ยนตามรอบชั่วโมงใช้งาน",
];

function getWheelTechnicalLocation(code: WheelCalloutCode): {
  axleLabel: string;
  sideLabel: string;
  mountLabel: string;
} {
  const isFront = code.startsWith("F");
  const isAxle1 = code.includes("1");
  const isAxle2 = code.includes("2");
  const axleLabel = isFront
    ? "เพลาหน้า (Front Axle)"
    : isAxle1
    ? "เพลาหลัง 1 (Rear Axle 1)"
    : isAxle2
    ? "เพลาหลัง 2 (Rear Axle 2)"
    : "เพลาหลัง (Rear Axle)";

  const isLeft = code.includes("L");
  const sideLabel = isLeft ? "ฝั่งซ้าย (Left)" : "ฝั่งขวา (Right)";

  const mountLabel = code.endsWith("I")
    ? "ล้อคู่ด้านใน (Inner Dual)"
    : code.endsWith("O")
    ? "ล้อคู่ด้านนอก (Outer Dual)"
    : "ล้อเดี่ยว (Single Wheel)";

  return { axleLabel, sideLabel, mountLabel };
}

export function TireRepairPointViewer({
  vehicleId,
  vehicle,
  selectedPosition,
  onSelectPosition,
  tireNotes,
  onChangeNotes,
  operatingHours,
  technicianName,
  selectedTireItems,
  latestVehicleRecord,
  latestWheelRecord,
}: TireRepairPointViewerProps) {
  const profile = useMemo(
    () => getWheelProfileForVehicle(vehicleId, vehicle),
    [vehicleId, vehicle]
  );

  // Active repair point callouts derived from the selected position
  const activeCallouts = useMemo(
    () => profile.callouts.filter((c) => isCalloutHighlighted(c.code, selectedPosition)),
    [profile.callouts, selectedPosition]
  );

  // Interactive 3D perspective / zoom / rotate / pan state (locked coordinate space)
  const [zoom, setZoom] = useState<number>(1.08);
  const [tilt3D, setTilt3D] = useState<number>(22); // degrees rotateX (0 = flat 2D, 22-42 = 3D perspective)
  const [rotationZ, setRotationZ] = useState<number>(0); // degrees rotateZ
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  // Selected hotspot for detail popover (Requirement 5)
  const [inspectedCode, setInspectedCode] = useState<WheelCalloutCode | null>(null);

  // Optional local reference photo preview (UI-only, zero DB impact)
  const [localDefectPhotoUrl, setLocalDefectPhotoUrl] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Keep inspected marker synced if user changes position dropdown
  useEffect(() => {
    if (inspectedCode && !activeCallouts.some((c) => c.code === inspectedCode)) {
      setInspectedCode(activeCallouts[0]?.code ?? null);
    }
  }, [activeCallouts, inspectedCode]);

  // Smoothly focus camera slightly toward single selected wheel when switching wheel
  useEffect(() => {
    if (activeCallouts.length === 1) {
      const target = activeCallouts[0];
      const normX = (target.dotX - 800) / 800; // -1..1
      const normY = (target.dotY - 450) / 450; // -1..1
      setPan({
        x: Math.round(-normX * 26),
        y: Math.round(-normY * 18),
      });
    } else {
      setPan({ x: 0, y: 0 });
    }
  }, [selectedPosition, profile.key]);

  const inspectedCallout: ForkliftWheelCallout | null = useMemo(() => {
    if (!inspectedCode) return null;
    return profile.callouts.find((c) => c.code === inspectedCode) || null;
  }, [inspectedCode, profile.callouts]);

  const handleZoomDelta = (delta: number) => {
    setZoom((prev) => Number(Math.min(2.4, Math.max(0.95, prev + delta)).toFixed(2)));
  };

  const handleResetView = () => {
    setZoom(1.08);
    setTilt3D(22);
    setRotationZ(0);
    setPan({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Allow clicking hotspot buttons without starting a drag
    if ((e.target as HTMLElement).closest("[data-hotspot-button='true']")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.clientX;
    const dy = e.clientY - dragStartRef.current.clientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragStartRef.current.moved = true;
    }
    const maxPan = Math.round(130 * zoom);
    setPan({
      x: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.panX + dx)),
      y: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.panY + dy)),
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    handleZoomDelta(e.deltaY < 0 ? 0.16 : -0.16);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartRef.current = { dist: Math.hypot(dx, dy), zoom };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchStartRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchStartRef.current.dist > 10) {
        const scaleRatio = dist / pinchStartRef.current.dist;
        setZoom(
          Number(Math.min(2.4, Math.max(0.95, pinchStartRef.current.zoom * scaleRatio)).toFixed(2))
        );
      }
    }
  };

  const handleTouchEnd = () => {
    pinchStartRef.current = null;
  };

  const handleLocalPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLocalDefectPhotoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleHotspotClick = (callout: ForkliftWheelCallout, isActive: boolean) => {
    if (isActive) {
      // Toggle detail popover for the clicked active repair hotspot
      setInspectedCode((prev) => (prev === callout.code ? null : callout.code));
    } else {
      // Switch active wheel position AND open its repair details immediately
      onSelectPosition(callout.label);
      setInspectedCode(callout.code);
    }
  };

  const historyRefRecord = latestWheelRecord || latestVehicleRecord || null;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-950/[0.025] dark:bg-[#081326] overflow-hidden">
      {/* Top Industrial Monitor Toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50/90 dark:bg-[#0c1930] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Crosshair size={13} className="text-orange-500 shrink-0" />
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate">
            จุดเปลี่ยนล้อที่เลือก ({activeCallouts.length > 0 ? `${activeCallouts.length} จุด` : "ยังไม่ระบุ"})
          </span>
        </div>

        {/* Zoom / 3D Tilt / Rotate Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setTilt3D((prev) => (prev > 0 ? 0 : 28))}
            title={tilt3D > 0 ? "สลับเป็นมุมมอง 2D ด้านบน" : "สลับเป็นมุมมอง 3D เอียง"}
            className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
              tilt3D > 0
                ? "bg-[#087eaf] text-white border-[#087eaf]"
                : "bg-white dark:bg-[#111e38] text-slate-600 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f] hover:border-[#087eaf]"
            }`}
          >
            <Layers size={11} className="inline mr-1" />
            {tilt3D > 0 ? "3D" : "2D"}
          </button>

          <button
            type="button"
            onClick={() => setRotationZ((prev) => (prev - 45) % 360)}
            title="หมุนซ้าย 45°"
            className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-600 dark:text-slate-300 hover:text-[#087eaf] hover:border-[#087eaf] transition-colors cursor-pointer"
          >
            <RotateCcw size={12} />
          </button>

          <button
            type="button"
            onClick={() => setRotationZ((prev) => (prev + 45) % 360)}
            title="หมุนขวา 45°"
            className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-600 dark:text-slate-300 hover:text-[#087eaf] hover:border-[#087eaf] transition-colors cursor-pointer"
          >
            <RotateCw size={12} />
          </button>

          <button
            type="button"
            onClick={() => handleZoomDelta(-0.2)}
            disabled={zoom <= 0.95}
            title="ซูมออก"
            className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-600 dark:text-slate-300 hover:text-[#087eaf] hover:border-[#087eaf] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ZoomOut size={12} />
          </button>

          <span className="text-[10px] font-mono tabular-nums font-semibold text-slate-600 dark:text-slate-300 min-w-[34px] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <button
            type="button"
            onClick={() => handleZoomDelta(0.2)}
            disabled={zoom >= 2.4}
            title="ซูมเข้า"
            className="p-1 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-600 dark:text-slate-300 hover:text-[#087eaf] hover:border-[#087eaf] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ZoomIn size={12} />
          </button>

          {(zoom !== 1.08 || tilt3D !== 22 || rotationZ !== 0 || pan.x !== 0 || pan.y !== 0) && (
            <button
              type="button"
              onClick={handleResetView}
              className="px-1.5 py-1 rounded text-[10px] font-semibold text-[#087eaf] dark:text-sky-400 hover:underline cursor-pointer"
            >
              รีเซ็ต
            </button>
          )}
        </div>
      </div>

      {/* Interactive 3D-Perspective + Zoomable Vehicle Stage (Hotspots Locked to Exact Coordinates) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheelZoom}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative w-full aspect-[16/10] bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100 dark:from-[#061020] dark:via-[#0b1930] dark:to-[#071225] overflow-hidden select-none touch-none ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ perspective: "1050px" }}
      >
        {/* Subtle industrial blueprint grid */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-35 dark:opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(8, 126, 175, 0.32) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />

        {/* Unified Transformed 3D Layer: Image + Locked Hotspot Markers move together with 0px drift */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) rotateX(${tilt3D}deg) rotateZ(${rotationZ}deg) scale(${zoom})`,
            transformStyle: "preserve-3d",
            transition: isDragging ? "none" : "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div className="relative w-full aspect-[16/9]">
            <img
              src={profile.imageSrc}
              alt={profile.imageAlt}
              referrerPolicy="no-referrer"
              draggable={false}
              className="w-full h-full object-cover block pointer-events-none rounded-[4px] shadow-md"
            />

            {/* Coordinate-locked Repair Hotspot Markers */}
            {profile.callouts.map((callout, idx) => {
              const isActive = isCalloutHighlighted(callout.code, selectedPosition);
              const isInspected = inspectedCode === callout.code;
              const leftPct = (callout.dotX / 1600) * 100;
              const topPct = (callout.dotY / 900) * 100;
              const staggerMs = (idx % 4) * 140;

              return (
                <div
                  key={`${profile.key}-${callout.code}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    zIndex: isInspected ? 35 : isActive ? 25 : 10,
                  }}
                >
                  {isActive ? (
                    <button
                      type="button"
                      data-hotspot-button="true"
                      key={`active-${callout.code}-${selectedPosition}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHotspotClick(callout, true);
                      }}
                      title={`คลิกดูรายละเอียดจุดเปลี่ยนล้อ: ${callout.label}`}
                      aria-label={`ดูรายละเอียดจุดเปลี่ยนล้อ ${callout.label}`}
                      className="repair-hotspot-enter relative w-11 h-11 flex items-center justify-center cursor-pointer focus:outline-none group"
                    >
                      {/* Expanding Radar Glow Ring Wave 1 */}
                      <span
                        aria-hidden="true"
                        className="repair-hotspot-ring pointer-events-none absolute w-7 h-7 rounded-full border-2 border-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.75)]"
                        style={{ animationDelay: `${staggerMs}ms` }}
                      />
                      {/* Expanding Radar Glow Ring Wave 2 */}
                      <span
                        aria-hidden="true"
                        className="repair-hotspot-ring pointer-events-none absolute w-7 h-7 rounded-full border-[1.5px] border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.65)]"
                        style={{ animationDelay: `${staggerMs + 750}ms` }}
                      />
                      {/* Expanding Radar Glow Ring Wave 3 (Industrial Cyan Outer Harmonic) */}
                      <span
                        aria-hidden="true"
                        className="repair-hotspot-ring pointer-events-none absolute w-7 h-7 rounded-full border border-sky-400/90"
                        style={{ animationDelay: `${staggerMs + 1500}ms` }}
                      />

                      {/* Soft Breathing Glow Halo */}
                      <span
                        aria-hidden="true"
                        className="repair-hotspot-halo pointer-events-none absolute w-7 h-7 rounded-full bg-orange-500/55 blur-[3px]"
                      />

                      {/* Pulsing Glowing Core Marker */}
                      <span
                        aria-hidden="true"
                        className={`repair-hotspot-core relative flex items-center justify-center w-4 h-4 rounded-full border-2 border-white shadow-[0_0_14px_rgba(234,88,12,0.95)] ${
                          isInspected ? "bg-sky-500 ring-2 ring-sky-300" : "bg-orange-600"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-50" />
                      </span>

                      {/* Compact Counter-Rotated Industrial Coordinate Tag */}
                      <span
                        aria-hidden="true"
                        style={{
                          transform: `rotateZ(${-rotationZ}deg)`,
                          transition: "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                        className={`pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-[3px] text-[9.5px] font-mono font-bold leading-none whitespace-nowrap shadow-sm border ${
                          isInspected
                            ? "bg-[#087eaf] text-white border-sky-300"
                            : "bg-slate-900/90 text-orange-200 border-orange-400/80"
                        }`}
                      >
                        {callout.code}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-hotspot-button="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHotspotClick(callout, false);
                      }}
                      title={`สลับไปตำแหน่ง ${callout.label}`}
                      aria-label={`สลับตำแหน่งล้อเป็น ${callout.label}`}
                      className="w-6 h-6 flex items-center justify-center rounded-full cursor-pointer group focus:outline-none"
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-white/90 border-[1.5px] border-slate-600 group-hover:scale-125 group-hover:border-[#087eaf] group-hover:bg-sky-200 transition-transform shadow-xs" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom-left helper hint */}
        <div className="pointer-events-none absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between gap-2 text-[10px]">
          <span className="px-2 py-0.5 rounded-[4px] bg-slate-900/75 text-slate-100 backdrop-blur-[2px] truncate">
            {activeCallouts.length > 0
              ? "คลิกที่จุดกระพริบเพื่อดูรายละเอียดจุดเปลี่ยนล้อ · ลากเพื่อเลื่อนภาพ"
              : "เลือกตำแหน่งล้อด้านบน หรือคลิกจุดบนรถเพื่อระบุตำแหน่งเปลี่ยนยาง"}
          </span>
          <span className="hidden sm:inline-block px-2 py-0.5 rounded-[4px] bg-slate-900/75 text-sky-200 font-mono tabular-nums backdrop-blur-[2px] shrink-0">
            {vehicleId || profile.specBadge}
          </span>
        </div>
      </div>

      {/* Requirement 5: Interactive Repair Point Detail Inspector (shown when clicking a Hotspot Marker) */}
      {inspectedCallout && (() => {
        const loc = getWheelTechnicalLocation(inspectedCallout.code);
        const cropX = (inspectedCallout.dotX / 1600) * 100;
        const cropY = (inspectedCallout.dotY / 900) * 100;

        return (
          <div className="repair-hotspot-detail-pop border-t border-orange-300/80 dark:border-orange-700/60 bg-white dark:bg-[#0d1b33] p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-[4px] bg-orange-50 dark:bg-orange-950/60 border border-orange-300 dark:border-orange-700/70 flex items-center justify-center text-orange-600 dark:text-orange-400 shrink-0">
                  <Wrench size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-900 dark:text-white truncate">
                    {inspectedCallout.label}
                  </div>
                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
                    {loc.axleLabel} · {loc.sideLabel} · {loc.mountLabel}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInspectedCode(null)}
                aria-label="ปิดรายละเอียดจุดเปลี่ยนล้อ"
                className="p-1 rounded-[4px] text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-[#162744] transition-colors cursor-pointer shrink-0"
              >
                <X size={14} />
              </button>
            </div>

            {/* Visual Reference Image (Zoomed 3D Wheel Crop + Optional Attached Defect Photo) + Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start">
              {/* Zoomed Wheel Reference Visual */}
              <div className="sm:col-span-5 space-y-1.5">
                <div className="relative w-full aspect-[4/3] rounded-[4px] border border-slate-200 dark:border-[#1e3a5f] bg-slate-100 dark:bg-[#071225] overflow-hidden">
                  {localDefectPhotoUrl ? (
                    <>
                      <img
                        src={localDefectPhotoUrl}
                        alt={`รูปภาพประกอบจุดเปลี่ยนล้อ ${inspectedCallout.label}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setLocalDefectPhotoUrl(null)}
                        title="กลับไปดูภาพตำแหน่งล้อ 3D"
                        className="absolute top-1 right-1 px-1.5 py-0.5 rounded-[3px] bg-slate-900/80 text-white text-[9.5px] font-semibold hover:bg-slate-900 cursor-pointer"
                      >
                        ภาพ 3D
                      </button>
                    </>
                  ) : (
                    <>
                      <img
                        src={profile.imageSrc}
                        alt={`ภาพขยายจุดเปลี่ยนล้อ ${inspectedCallout.label}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover pointer-events-none"
                        style={{
                          objectPosition: `${cropX}% ${cropY}%`,
                          transform: "scale(2.35)",
                          transformOrigin: `${cropX}% ${cropY}%`,
                        }}
                      />
                      {/* Mini pulsing crosshair centered over zoomed wheel */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="repair-hotspot-ring absolute w-7 h-7 rounded-full border-2 border-orange-500" />
                        <span className="repair-hotspot-core w-3 h-3 rounded-full bg-orange-600 border-2 border-white shadow-md" />
                      </div>
                      <span className="pointer-events-none absolute bottom-1 left-1 px-1.5 py-0.5 rounded-[3px] bg-slate-900/80 text-orange-200 font-mono text-[9.5px] font-bold">
                        จุดซ่อม: {inspectedCallout.code}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    {localDefectPhotoUrl ? "รูปถ่ายประกอบที่แนบ" : "ภาพขยายตำแหน่งชิ้นส่วน"}
                  </span>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#087eaf] dark:text-sky-400 hover:underline cursor-pointer"
                  >
                    <Camera size={11} />
                    <span>{localDefectPhotoUrl ? "เปลี่ยนรูป" : "แนบรูปประกอบ"}</span>
                  </button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLocalPhotoSelect}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Part Name, Defect Symptom, & Maintenance Details */}
              <div className="sm:col-span-7 space-y-2 text-[11px]">
                <div className="rounded-[4px] border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/80 dark:bg-[#0c1930] p-2 space-y-1">
                  <div className="flex items-center justify-between gap-1 text-[10.5px]">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">รถ / รุ่น:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                      {vehicleId || "-"}
                      {vehicle?.description ? ` (${vehicle.description})` : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1 text-[10.5px]">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">อาการเสีย / หมายเหตุ:</span>
                    <span
                      className={`font-semibold truncate max-w-[180px] ${
                        tireNotes.trim()
                          ? "text-orange-700 dark:text-orange-300"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {tireNotes.trim() || "ยังไม่ระบุอาการเสีย"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1 text-[10.5px] tabular-nums">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">ชั่วโมงรถ / ช่าง:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {operatingHours ? `${Number(operatingHours).toLocaleString()} ชม.` : "-"} ·{" "}
                      {technicianName || "-"}
                    </span>
                  </div>
                </div>

                {/* Selected Tire Items Summary */}
                <div className="space-y-1">
                  <div className="text-[10.5px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <Info size={11} className="text-[#087eaf] dark:text-sky-400" />
                    <span>ยางที่เลือกเบิกสำหรับจุดนี้</span>
                  </div>
                  {selectedTireItems.length > 0 ? (
                    <div className="space-y-1">
                      {selectedTireItems.map((it, idx) => (
                        <div
                          key={`${it.tireSize}-${it.brand}-${idx}`}
                          className="text-[10.5px] px-2 py-1 rounded-[4px] bg-sky-50/70 dark:bg-sky-950/35 border border-sky-200/80 dark:border-sky-800/60 text-slate-800 dark:text-slate-200 tabular-nums"
                        >
                          <span className="font-bold text-[#087eaf] dark:text-sky-300">
                            {it.tireSize}
                          </span>{" "}
                          ({it.brand}) · {it.typesSummary} ·{" "}
                          <strong className="text-slate-900 dark:text-white">{it.qty} เส้น</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                      ยังไม่ได้ติ๊กเลือกรายการยางทางฝั่งซ้าย
                    </div>
                  )}
                </div>

                {/* Quick Symptom Selector (fills existing หมายเหตุ field directly) */}
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    ระบุอาการเสียด่วน (บันทึกลงช่องหมายเหตุ):
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {QUICK_SYMPTOM_PRESETS.map((preset) => {
                      const activePreset = tireNotes.trim() === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => onChangeNotes(preset)}
                          className={`px-2 py-0.5 rounded-[4px] border text-[10px] font-semibold transition-colors cursor-pointer ${
                            activePreset
                              ? "bg-[#087eaf] text-white border-[#087eaf]"
                              : "bg-white dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f] hover:border-[#087eaf] hover:text-[#087eaf]"
                          }`}
                        >
                          {preset}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Previous Tire Replacement Record for this wheel/vehicle */}
                {historyRefRecord && (
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-[#1e3a5f] tabular-nums">
                    ประวัติล่าสุด ({latestWheelRecord ? "ตำแหน่งนี้" : "รถคันนี้"}):{" "}
                    <span className="text-slate-700 dark:text-slate-200 font-medium">
                      {historyRefRecord.date} · {historyRefRecord.tireSize} ({historyRefRecord.qty} เส้น)
                      {historyRefRecord.notes ? ` · ${historyRefRecord.notes}` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
