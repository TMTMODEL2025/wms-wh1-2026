/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from "react";
import { Compass, Info, MousePointerClick, Wrench } from "lucide-react";
import { Vehicle } from "../../types/officer";
import {
  getVehicleTypeDisplayLabel,
  isClampTruckVehicle,
  isElectricTractorVehicle,
  isStandardTractorVehicle,
  isTrailerVehicle,
  resolveVehicleType,
} from "../../utils/vehicleHelpers";
import {
  EV_INTERACTIVE_ZONE_LIST,
  EvRepairZoneSpec,
  extractEvZoneFromDescription,
  getEvZoneForRepairCategory,
} from "./evRepairZones";
import { EvRepairHologramViewport } from "./EvRepairHologramViewport";

interface VehicleRepairVisualPanelProps {
  vehicleId: string;
  vehicle?: Vehicle;
  repairType: string;
  repairDescription?: string;
  /** Explicitly selected zone (e.g., when user clicked a specific 3D part in Stage 1) */
  selectedZoneOverride?: EvRepairZoneSpec | null;
  interactive?: boolean;
  compact?: boolean;
  fillHeight?: boolean;
  onSelectZone?: (zone: EvRepairZoneSpec) => void;
  onAppendSymptom?: (symptom: string) => void;
}

/**
 * Clean industrial blueprint SVG silhouettes for Non-EV vehicle classes
 * while the full 360° 3D Hologram starts with Electric Tractors (EV).
 */
const NonEvBlueprintSilhouette: React.FC<{
  kind: "forklift" | "tractor" | "trailer" | "clamp";
  repairType: string;
}> = ({ kind, repairType }) => {
  return (
    <svg
      viewBox="0 0 420 210"
      className="w-full h-44 sm:h-48"
      role="img"
      aria-label={`ผังโครงร่างพื้นฐาน ${kind}`}
    >
      <defs>
        <radialGradient id="bpFloorGlow" cx="50%" cy="84%" r="52%">
          <stop offset="0%" stopColor="#00d8ff" stopOpacity="0.32" />
          <stop offset="65%" stopColor="#0284c7" stopOpacity="0.09" />
          <stop offset="100%" stopColor="#050b14" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bpWireStroke" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
          <stop offset="50%" stopColor="#00e5ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.45" />
        </linearGradient>
      </defs>

      {/* Concentric diagnostic radar rings on dark floor */}
      <ellipse cx="210" cy="176" rx="180" ry="26" fill="url(#bpFloorGlow)" />
      <ellipse
        cx="210"
        cy="176"
        rx="168"
        ry="21"
        fill="none"
        stroke="#0ea5e9"
        strokeOpacity="0.28"
        strokeWidth="1"
        strokeDasharray="6 6"
      />
      <ellipse
        cx="210"
        cy="176"
        rx="124"
        ry="15"
        fill="none"
        stroke="#38bdf8"
        strokeOpacity="0.45"
        strokeWidth="1.2"
      />
      <ellipse
        cx="210"
        cy="176"
        rx="74"
        ry="9"
        fill="none"
        stroke="#00e5ff"
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />

      {kind === "forklift" && (
        <g stroke="url(#bpWireStroke)" strokeWidth="2" fill="#0b223b" fillOpacity="0.45">
          {/* Mast & Forks */}
          <rect x="298" y="34" width="12" height="128" rx="2" />
          <path d="M310 150 L368 150 L368 158 L302 158 Z" />
          {/* Counterweight & Body */}
          <path d="M98 118 L128 110 L212 110 L224 120 L294 120 L294 156 L104 156 Q92 150 98 118 Z" />
          {/* Overhead Guard Cabin */}
          <path d="M148 110 L166 56 L252 56 L266 118" fill="none" strokeWidth="2.4" />
          <line x1="162" y1="68" x2="256" y2="68" strokeOpacity="0.45" />
          {/* Wheels */}
          <circle cx="138" cy="158" r="19" fill="#081629" strokeWidth="2.5" />
          <circle cx="138" cy="158" r="8" fill="none" strokeOpacity="0.6" />
          <circle cx="268" cy="154" r="24" fill="#081629" strokeWidth="2.5" />
          <circle cx="268" cy="154" r="10" fill="none" strokeOpacity="0.6" />
        </g>
      )}

      {kind === "clamp" && (
        <g stroke="url(#bpWireStroke)" strokeWidth="2" fill="#0b223b" fillOpacity="0.45">
          {/* Mast & Roll Clamp Arm */}
          <rect x="292" y="36" width="12" height="124" rx="2" />
          <path d="M304 108 L352 108 Q372 118 352 142 L304 142 Z" fill="#0c3459" fillOpacity="0.55" />
          {/* Heavy Body */}
          <path d="M88 112 L134 106 L218 106 L232 118 L290 118 L290 156 L94 156 Z" />
          {/* Cabin */}
          <path d="M146 106 L162 56 L246 56 L262 116" fill="none" strokeWidth="2.4" />
          {/* Wheels */}
          <circle cx="132" cy="157" r="20" fill="#081629" strokeWidth="2.5" />
          <circle cx="262" cy="153" r="25" fill="#081629" strokeWidth="2.5" />
        </g>
      )}

      {kind === "tractor" && (
        <g stroke="url(#bpWireStroke)" strokeWidth="2" fill="#0b223b" fillOpacity="0.45">
          {/* Diesel Tow Tractor silhouette */}
          <path d="M106 112 L182 104 L198 60 L292 60 L306 114 L314 154 L102 154 Z" />
          <rect x="206" y="70" width="76" height="40" rx="3" fill="#0d2c4a" fillOpacity="0.5" />
          <rect x="314" y="130" width="20" height="14" rx="2" />
          <circle cx="146" cy="156" r="21" fill="#081629" strokeWidth="2.5" />
          <circle cx="272" cy="154" r="23" fill="#081629" strokeWidth="2.5" />
        </g>
      )}

      {kind === "trailer" && (
        <g stroke="url(#bpWireStroke)" strokeWidth="2" fill="#0b223b" fillOpacity="0.45">
          {/* Flatbed Trailer Drawbar & Deck */}
          <line x1="68" y1="138" x2="112" y2="132" strokeWidth="3" />
          <circle cx="64" cy="138" r="6" fill="#00e5ff" fillOpacity="0.6" />
          <rect x="112" y="114" width="234" height="24" rx="3" />
          <line x1="112" y1="126" x2="346" y2="126" strokeOpacity="0.4" />
          {/* Dual Axles */}
          <circle cx="160" cy="156" r="19" fill="#081629" strokeWidth="2.5" />
          <circle cx="298" cy="156" r="19" fill="#081629" strokeWidth="2.5" />
        </g>
      )}

      {/* Animated Blue Glow + Expanding Ring target marker on center chassis */}
      <g transform="translate(210, 126)">
        <circle r="22" fill="none" stroke="#00e5ff" strokeWidth="1.6" className="repair-hotspot-ring" />
        <circle
          r="22"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.4"
          className="repair-hotspot-ring repair-hotspot-ring-delay-1"
        />
        <circle r="11" fill="#00d8ff" fillOpacity="0.32" className="repair-hotspot-halo" />
        <circle r="5.5" fill="#e0f7ff" stroke="#00e5ff" strokeWidth="2" className="repair-hotspot-core" />
      </g>

      {/* Active Repair Category Blueprint Label */}
      <g transform="translate(210, 26)">
        <text
          textAnchor="middle"
          fill="#bae6fd"
          fontSize="11.5"
          fontWeight="600"
          fontFamily="Plus Jakarta Sans, sans-serif"
        >
          {repairType ? `หมวดแจ้งซ่อม: ${repairType}` : "รอเลือกประเภทการซ่อม"}
        </text>
      </g>
    </svg>
  );
};

export const VehicleRepairVisualPanel: React.FC<VehicleRepairVisualPanelProps> = ({
  vehicleId,
  vehicle,
  repairType,
  repairDescription,
  selectedZoneOverride,
  interactive = true,
  compact = false,
  fillHeight = false,
  onSelectZone,
  onAppendSymptom,
}) => {
  const cleanVehicleId = (vehicleId || "").trim();
  const candidate = vehicle || (cleanVehicleId ? { vehicleId: cleanVehicleId } : undefined);

  const isEv = useMemo(
    () => (candidate ? isElectricTractorVehicle(candidate) : false),
    [candidate]
  );

  const nonEvKind = useMemo<"forklift" | "tractor" | "trailer" | "clamp">(() => {
    if (!candidate) return "forklift";
    if (isTrailerVehicle(candidate)) return "trailer";
    if (isClampTruckVehicle(candidate)) return "clamp";
    if (isStandardTractorVehicle(candidate)) return "tractor";
    return "forklift";
  }, [candidate]);

  const vehicleTypeLabel = useMemo(() => {
    if (!candidate) return "";
    const resolved = resolveVehicleType(candidate);
    return getVehicleTypeDisplayLabel(resolved, candidate);
  }, [candidate]);

  const activeZone = useMemo<EvRepairZoneSpec>(() => {
    if (selectedZoneOverride) return selectedZoneOverride;
    const fromDesc = extractEvZoneFromDescription(repairDescription);
    if (fromDesc && fromDesc.matchedCategories.includes((repairType || "").trim())) {
      return fromDesc;
    }
    return getEvZoneForRepairCategory(repairType);
  }, [selectedZoneOverride, repairDescription, repairType]);

  // Zero-state when no vehicle has been chosen yet
  if (!cleanVehicleId) {
    return (
      <div
        className={`${
          fillHeight ? "flex-1 min-h-[360px] lg:h-full" : "h-full min-h-[340px]"
        } rounded-xl bg-[#050b14] border border-sky-900/60 p-5 flex flex-col items-center justify-center text-center relative overflow-hidden`}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              "radial-gradient(circle at 50% 62%, rgba(0,216,255,0.22) 0%, rgba(2,132,199,0.06) 42%, transparent 72%)",
          }}
        />
        <div className="relative z-10 max-w-xs space-y-3">
          <div className="relative mx-auto w-56 h-36 rounded-lg overflow-hidden border border-sky-500/30 bg-[#081526] flex items-center justify-center p-2">
            <img
              src="/assets/aistudio/EV_37dc6f83.jpg"
              alt="โมเดลรถหัวลากไฟฟ้า EV"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain opacity-85"
            />
          </div>
          <div className="text-sm font-bold text-sky-100">
            ขั้นตอนที่ 1: เลือกเบอร์รถเพื่อแสดงโมเดล
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            ระบบจะแสดงโมเดลรถ 3 มิติสไตล์โฮโลแกรมพร้อมแสงสีฟ้าเรืองแสง (Blue Glow + Expanding Ring)
            อัตโนมัติตามประเภทรถที่เลือก
          </p>
        </div>
      </div>
    );
  }

  // EV Electric Tractor -> Full 360° 3D Hologram Interactive Viewer!
  if (isEv) {
    return (
      <div className={`flex flex-col gap-3 ${fillHeight ? "flex-1 h-full min-h-0" : "h-full"}`}>
        <EvRepairHologramViewport
          vehicleId={cleanVehicleId}
          activeZone={activeZone}
          interactive={interactive}
          compact={compact}
          fillHeight={fillHeight}
          onSelectZone={onSelectZone}
        />

        {/* Compact Diagnostic Part Info & Quick Tap Bar (Outside Canvas -> Zero Occlusion) */}
        {!compact && (
          <div className="shrink-0 rounded-lg bg-[#071324] border border-sky-900/60 p-3.5 space-y-2.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-sky-100 text-[13px] leading-snug">
                  {activeZone.nameTh}
                </div>
                <div className="text-[11px] text-sky-300/80 mt-0.5">
                  {activeZone.nameEn} · {activeZone.locationTh}
                </div>
              </div>
              <div className="text-[11px] font-semibold text-sky-300 shrink-0 text-right">
                {activeZone.primaryRepairCategory}
              </div>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              {activeZone.descriptionTh}
            </p>

            {/* Quick symptom buttons to assist operators without typing from scratch */}
            {interactive && onAppendSymptom && activeZone.commonSymptoms.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-sky-900/50">
                <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                  <Wrench size={12} className="text-sky-400" />
                  <span>อาการพบบ่อยในจุดนี้ (คลิกเพื่อเติมลงช่องอาการ):</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeZone.commonSymptoms.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => onAppendSymptom(sym)}
                      className="px-2.5 py-1 rounded text-[11px] font-medium bg-[#0d223b] hover:bg-[#133256] text-sky-200 border border-sky-500/30 transition-colors text-left"
                    >
                      + {sym}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick 3D Component Selector Bar (Great for Mobile & Precision Selection) */}
            {interactive && onSelectZone && (
              <div className="space-y-1.5 pt-2 border-t border-sky-900/50">
                <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                  <MousePointerClick size={12} className="text-sky-400" />
                  <span>คลิกเลือกจุดชิ้นส่วนบนตัวรถ EV (เชื่อมกับประเภทการซ่อมอัตโนมัติ):</span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  {EV_INTERACTIVE_ZONE_LIST.map((zone) => {
                    const isSelected = activeZone.id === zone.id;
                    return (
                      <button
                        key={zone.id}
                        type="button"
                        onClick={() => onSelectZone(zone)}
                        className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                          isSelected
                            ? "bg-[#087eaf] text-white border border-sky-400"
                            : "bg-[#0b1c32] text-slate-300 border border-slate-700/80 hover:border-sky-500/60 hover:text-sky-200"
                        }`}
                      >
                        {zone.primaryRepairCategory}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Non-EV Vehicle -> Blueprint Schematic & Status Card (Confirmed Q4)
  return (
    <div
      className={`rounded-xl bg-[#050b14] border border-sky-900/60 p-4 flex flex-col justify-between gap-3 ${
        compact ? "" : fillHeight ? "flex-1 h-full min-h-[360px]" : "h-full"
      }`}
    >
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-sky-100 truncate">
            {cleanVehicleId}
            <span className="text-sky-400/70 mx-1.5">·</span>
            <span className="text-sky-300 font-medium">{vehicleTypeLabel || "Material Handling"}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            ทะเบียน: {vehicle?.registrationNumber || "-"} · สถานะ:{" "}
            {vehicle?.operationalStatus || "พร้อมใช้งาน"}
          </div>
        </div>
        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 shrink-0">
          <Compass size={13} />
          <span>ผังโครงร่างพื้นฐาน</span>
        </div>
      </div>

      <div
        className={`rounded-lg bg-[#071324] border border-sky-900/50 px-3 py-2 flex items-center justify-center ${
          fillHeight && !compact ? "flex-1 min-h-[240px]" : ""
        }`}
      >
        <NonEvBlueprintSilhouette kind={nonEvKind} repairType={repairType} />
      </div>

      <div className="shrink-0 rounded-lg bg-[#08172b] border border-sky-800/45 px-3 py-2.5 text-[11px] text-slate-300 flex items-start gap-2 leading-relaxed">
        <Info size={14} className="text-sky-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-sky-200">
            สถานะโมเดล 3 มิติโฮโลแกรม:
          </span>{" "}
          ขณะนี้เปิดใช้งานโมเดล 3D โฮโลแกรมเต็มรูปแบบสำหรับ{" "}
          <strong className="text-white">รถหัวลากไฟฟ้า EV (TTEV-*)</strong>{" "}
          ก่อน และรองรับการต่อยอดสำหรับรถประเภท {vehicleTypeLabel || "อื่น ๆ"} ในเฟสถัดไป
          คุณสามารถเลือกประเภทการซ่อมและส่งใบแจ้งซ่อมได้ตามปกติ
        </div>
      </div>
    </div>
  );
};
