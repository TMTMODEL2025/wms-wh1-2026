import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Play,
  Square,
  X,
  Crosshair,
  Building2,
  Package,
  Scale,
  AlertTriangle,
  CheckCircle2,
  Layers,
  MapPin,
  Box,
} from "lucide-react";
import {
  CoilSapMasterItem,
  CoilStockRecord,
} from "../../services/coilDataService";
import {
  BUILDING_GROUPS,
  BuildingGroupId,
  WarehouseSlot3D,
  SlotVisualStatus,
  buildBuildingWarehouseLayout,
  getGroupCoilCounts,
  parseCoilLocationTo3D,
} from "./coilWarehouseLayout";
import {
  CameraPreset,
  CoilWarehouseSceneEngine,
  SceneFilterState,
} from "./coilWarehouseScene";

interface CoilWarehouse3DViewProps {
  activeCoils: CoilStockRecord[];
  coilSapMap: Map<string, CoilSapMasterItem>;
  isThai: boolean;
  isCloudLoading?: boolean;
}

const STATUS_BADGE_META: Record<
  SlotVisualStatus,
  { labelTh: string; labelEn: string; dotClass: string; badgeClass: string }
> = {
  EMPTY: {
    labelTh: "EMPTY ว่างพร้อมจัดเก็บ",
    labelEn: "EMPTY Available",
    dotClass: "bg-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  OCCUPIED: {
    labelTh: "OCCUPIED มีเหล็กม้วนจัดเก็บ",
    labelEn: "OCCUPIED Stored",
    dotClass: "bg-blue-500",
    badgeClass: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  },
  RESERVED: {
    labelTh: "RESERVED จองตำแหน่ง (Active)",
    labelEn: "RESERVED Staged",
    dotClass: "bg-orange-500",
    badgeClass: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  },
  BLOCKED: {
    labelTh: "BLOCKED ปิดใช้งาน / กักกัน",
    labelEn: "BLOCKED Hold",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-500/15 text-red-300 border-red-500/40",
  },
  FOCUS: {
    labelTh: "RECOMMENDED / FOCUS ตำแหน่งที่เลือก / ค้นพบ",
    labelEn: "FOCUS Selected / Matched",
    dotClass: "bg-purple-500",
    badgeClass: "bg-purple-500/15 text-purple-300 border-purple-500/40",
  },
  PENDING_SAP: {
    labelTh: "PENDING SAP รอข้อมูล SAP",
    labelEn: "PENDING SAP Waiting",
    dotClass: "bg-amber-400",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
};

export const CoilWarehouse3DView: React.FC<CoilWarehouse3DViewProps> = ({
  activeCoils,
  coilSapMap,
  isThai,
  isCloudLoading = false,
}) => {
  const [selectedGroupId, setSelectedGroupId] = useState<BuildingGroupId>("E7-E8");
  const [doorFilter, setDoorFilter] = useState<string>("ALL");
  const [rowFilter, setRowFilter] = useState<string>("ALL");
  const [levelFilter, setLevelFilter] = useState<string>("ALL");
  const [onlyPendingSap, setOnlyPendingSap] = useState<boolean>(false);
  const [activeCameraPreset, setActiveCameraPreset] = useState<CameraPreset>("isometric");
  const [craneDemoEnabled, setCraneDemoEnabled] = useState<boolean>(false);
  const [dockVisible, setDockVisible] = useState<boolean>(true);

  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [focusedSlotKey, setFocusedSlotKey] = useState<string | null>(null);
  const [pendingFocusBatch, setPendingFocusBatch] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchFeedback, setSearchFeedback] = useState<{
    type: "found" | "not_found";
    message: string;
  } | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CoilWarehouseSceneEngine | null>(null);

  // Live coil counts across all 4 building groups
  const groupCounts = useMemo(
    () => getGroupCoilCounts(activeCoils),
    [activeCoils]
  );

  // Compute current building group 3D pyramid layout from live stock
  const layout = useMemo(
    () => buildBuildingWarehouseLayout(selectedGroupId, activeCoils, coilSapMap),
    [selectedGroupId, activeCoils, coilSapMap]
  );

  // Quick live search suggestions across all buildings
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    if (q.length < 2) return [];
    return activeCoils
      .filter(
        (c) =>
          String(c.batch || "").toUpperCase().includes(q) ||
          String(c.coilNo || "").toUpperCase().includes(q)
      )
      .slice(0, 6);
  }, [activeCoils, searchQuery]);

  // Resolve currently selected slot from latest live layout
  const selectedSlot: WarehouseSlot3D | null = useMemo(() => {
    if (!selectedSlotKey) return null;
    return layout.slots.find((s) => s.slotKey === selectedSlotKey) || null;
  }, [layout, selectedSlotKey]);

  // Count how many coils currently sit in the selected slot's row
  const selectedRowCoilCount = useMemo(() => {
    if (!selectedSlot) return 0;
    return layout.occupiedSlots.filter(
      (s) => s.door === selectedSlot.door && s.row === selectedSlot.row
    ).length;
  }, [layout, selectedSlot]);

  // Memoize filter payload passed into Three.js engine
  const filterState: SceneFilterState = useMemo(
    () => ({
      door: doorFilter,
      row: rowFilter,
      level: levelFilter,
      onlyPendingSap,
      selectedSlotKey,
      focusedSlotKey,
    }),
    [
      doorFilter,
      rowFilter,
      levelFilter,
      onlyPendingSap,
      selectedSlotKey,
      focusedSlotKey,
    ]
  );

  // Initialize Three.js Scene Engine once on mount
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    try {
      const engine = new CoilWarehouseSceneEngine(host, {
        onSelectSlot: (slot) => {
          if (slot) {
            setSelectedSlotKey(slot.slotKey);
            setFocusedSlotKey(slot.slotKey);
          } else {
            setSelectedSlotKey(null);
            setFocusedSlotKey(null);
          }
        },
        onWebGLContextError: (msg) => setWebglError(msg),
      });
      engineRef.current = engine;
      setWebglError(null);

      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch (err) {
      console.error("Failed to initialize 3D warehouse WebGL:", err);
      setWebglError(
        isThai
          ? "ไม่สามารถเปิดโหมดแสดงผล WebGL 3D บนเบราว์เซอร์นี้ได้"
          : "WebGL 3D rendering is unavailable on this browser."
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push live layout updates immediately whenever stock/SAP/group changes
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLayout(layout, filterState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Push filter & selection updates without rebuilding geometry
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setFilter(filterState);
  }, [filterState]);

  // Sync Crane Demo toggle
  useEffect(() => {
    engineRef.current?.setCraneDemo(craneDemoEnabled);
  }, [craneDemoEnabled]);

  // When a cross-building Batch Search switched building groups, focus once new layout arrives
  useEffect(() => {
    if (!pendingFocusBatch) return;
    const match = layout.occupiedSlots.find(
      (s) =>
        s.coil &&
        (String(s.coil.batch || "").toUpperCase() === pendingFocusBatch ||
          String(s.coil.coilNo || "").toUpperCase() === pendingFocusBatch)
    );
    if (match) {
      setSelectedSlotKey(match.slotKey);
      setFocusedSlotKey(match.slotKey);
      engineRef.current?.focusOnSlot(match);
      setPendingFocusBatch(null);
    }
  }, [layout, pendingFocusBatch]);

  // Reset camera & filters cleanly when switching building groups manually
  const handleSelectGroup = (groupId: BuildingGroupId) => {
    if (groupId === selectedGroupId) return;
    setSelectedGroupId(groupId);
    setDoorFilter("ALL");
    setRowFilter("ALL");
    setLevelFilter("ALL");
    setOnlyPendingSap(false);
    setSelectedSlotKey(null);
    setFocusedSlotKey(null);
    setSearchFeedback(null);
    setActiveCameraPreset("isometric");
    setTimeout(() => {
      engineRef.current?.applyCameraPreset("isometric");
    }, 60);
  };

  const handleCameraPreset = (preset: CameraPreset) => {
    setActiveCameraPreset(preset === "reset" ? "isometric" : preset);
    if (preset === "reset") {
      setDoorFilter("ALL");
      setRowFilter("ALL");
      setLevelFilter("ALL");
      setOnlyPendingSap(false);
      setSelectedSlotKey(null);
      setFocusedSlotKey(null);
      setSearchFeedback(null);
    }
    engineRef.current?.applyCameraPreset(preset);
  };

  const focusCoilRecord = (coil: CoilStockRecord) => {
    const parsed = parseCoilLocationTo3D(coil.location);
    const batchUpper = String(coil.batch || "").toUpperCase();

    // Clear restrictive filters so the found coil is never dimmed
    setDoorFilter("ALL");
    setRowFilter("ALL");
    setLevelFilter("ALL");
    setOnlyPendingSap(false);

    if (parsed.groupId !== selectedGroupId) {
      setSelectedGroupId(parsed.groupId);
      setPendingFocusBatch(batchUpper);
      setSearchFeedback({
        type: "found",
        message: isThai
          ? `พบ Batch ${coil.batch} ที่อาคาร ${parsed.door} แถว ${parsed.row} — สลับกลุ่มอาคารและซูมโฟกัสแล้ว`
          : `Found ${coil.batch} at ${parsed.door}/${parsed.row} — switched bay & focused`,
      });
      return;
    }

    const slot = layout.occupiedSlots.find(
      (s) => s.coil && String(s.coil.batch || "").toUpperCase() === batchUpper
    );
    if (slot) {
      setSelectedSlotKey(slot.slotKey);
      setFocusedSlotKey(slot.slotKey);
      engineRef.current?.focusOnSlot(slot);
      setSearchFeedback({
        type: "found",
        message: isThai
          ? `โฟกัส Batch ${coil.batch} · ประตู ${slot.door} แถว ${slot.row} ชั้น L${slot.level} ช่อง S${slot.slotIndex}`
          : `Focused ${coil.batch} at Door ${slot.door} Row ${slot.row} L${slot.level}`,
      });
    }
  };

  const handleBatchSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim().toUpperCase();
    if (!q) {
      setSearchFeedback(null);
      return;
    }

    // Exact match first, then partial match
    const exact = activeCoils.find(
      (c) =>
        String(c.batch || "").toUpperCase() === q ||
        String(c.coilNo || "").toUpperCase() === q
    );
    const partial =
      exact ||
      activeCoils.find(
        (c) =>
          String(c.batch || "").toUpperCase().includes(q) ||
          String(c.coilNo || "").toUpperCase().includes(q)
      );

    if (!partial) {
      setSearchFeedback({
        type: "not_found",
        message: isThai
          ? `ไม่พบรหัส "${q}" ในสต๊อกคลังเหล็กม้วนปัจจุบัน`
          : `Batch "${q}" not found in active coil stock`,
      });
      return;
    }

    focusCoilRecord(partial);
  };

  const utilizationPct =
    layout.stats.totalFloorCount > 0
      ? Math.min(
          100,
          Math.round(
            ((layout.stats.totalFloorCount - layout.stats.emptyFloorCount) /
              layout.stats.totalFloorCount) *
              100
          )
        )
      : 0;

  return (
    <div className="space-y-2.5">
      {/* Top Bar: Building Group Switcher + Live Batch Search + Live Bay KPIs */}
      <div className="bg-[#0d1629] border border-[#1e3154] rounded-xl p-2.5 shadow-sm flex flex-wrap items-center justify-between gap-2.5">
        {/* 4 Building Group Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {BUILDING_GROUPS.map((grp) => {
            const info = groupCounts[grp.id];
            const active = grp.id === selectedGroupId;
            return (
              <button
                key={grp.id}
                type="button"
                onClick={() => handleSelectGroup(grp.id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  active
                    ? "bg-blue-600 text-white border-blue-400 shadow-xs"
                    : "bg-[#13203b] text-slate-300 border-[#22365c] hover:bg-[#1a2b4f] hover:text-white"
                }`}
              >
                <Building2 size={14} className="shrink-0" />
                <span>{isThai ? grp.labelTh : grp.labelEn}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-[#0a1222] text-sky-300"
                  }`}
                >
                  {info.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Batch Search & Zoom-to-Focus */}
        <div className="relative flex-1 min-w-[230px] max-w-md">
          <form onSubmit={handleBatchSearchSubmit} className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value.trim()) setSearchFeedback(null);
                }}
                placeholder={
                  isThai
                    ? "ค้นหา Batch / Coil No. เพื่อซูมโฟกัส 3D..."
                    : "Search Batch / Coil No. to focus..."
                }
                className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-[#091020] border border-[#253b63] text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-purple-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchFeedback(null);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
            >
              <Crosshair size={13} />
              <span>{isThai ? "ซูมโฟกัส" : "Focus"}</span>
            </button>
          </form>

          {/* Instant Search Suggestions Dropdown */}
          {searchSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-[#0d1629] border border-[#2a426d] rounded-lg shadow-xl overflow-hidden">
              {searchSuggestions.map((coil) => {
                const parsed = parseCoilLocationTo3D(coil.location);
                return (
                  <button
                    key={coil.id}
                    type="button"
                    onClick={() => {
                      setSearchQuery(coil.batch);
                      focusCoilRecord(coil);
                    }}
                    className="w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-[#192949] text-xs border-b border-[#1b2d4d] last:border-b-0 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-slate-100 truncate">
                        {coil.batch}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {coil.grade && coil.grade !== "-" ? coil.grade : "รอ SAP"} ·{" "}
                        {Number(coil.weightKg || 0).toLocaleString()} kg
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-sky-300 font-bold text-[10px] shrink-0">
                      {parsed.door}/{parsed.row}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Bay Metrics */}
        <div className="flex items-center gap-2 text-[11px] font-bold">
          <div className="px-2.5 py-1 rounded-lg bg-[#13203b] border border-[#22365c] text-slate-200 flex items-center gap-1.5">
            <Package size={13} className="text-sky-400" />
            <span>
              {layout.stats.totalCoils.toLocaleString()}{" "}
              {isThai ? "ม้วน" : "coils"}
            </span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-[#13203b] border border-[#22365c] text-slate-200 flex items-center gap-1.5">
            <Scale size={13} className="text-emerald-400" />
            <span>
              {layout.stats.totalWeightTons.toFixed(2)}{" "}
              {isThai ? "ตัน" : "t"}
            </span>
          </div>
          <div className="hidden xl:flex px-2.5 py-1 rounded-lg bg-[#13203b] border border-[#22365c] text-slate-200 items-center gap-1.5">
            <Box size={13} className="text-amber-400" />
            <span>
              {isThai ? "ใช้งานฐาน" : "Floor"} {utilizationPct}%
            </span>
          </div>
        </div>
      </div>

      {/* Inline Search Feedback Strip (if any) */}
      {searchFeedback && (
        <div
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between border ${
            searchFeedback.type === "found"
              ? "bg-purple-950/80 border-purple-500/50 text-purple-200"
              : "bg-red-950/80 border-red-500/50 text-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {searchFeedback.type === "found" ? (
              <Crosshair size={14} className="text-purple-400 shrink-0" />
            ) : (
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
            )}
            <span>{searchFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSearchFeedback(null)}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* =====================================================================
          MAIN 3D VIEWPORT CONTAINER (Zero backdrop-filter over WebGL)
         ===================================================================== */}
      <div className="relative w-full h-[640px] lg:h-[700px] rounded-xl overflow-hidden border border-[#1e3154] bg-[#0b1324] shadow-lg select-none">
        {/* WebGL Canvas Mount */}
        <div ref={canvasHostRef} className="w-full h-full" />

        {/* Graceful Fallback if WebGL unavailable */}
        {webglError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0b1324] text-slate-200 p-6 text-center gap-3">
            <AlertTriangle size={34} className="text-amber-400" />
            <p className="text-sm font-bold">{webglError}</p>
            <p className="text-xs text-slate-400 max-w-md">
              {isThai
                ? "กรุณาตรวจสอบการเปิดใช้งาน Hardware Acceleration หรือรีโหลดหน้าเพื่อกู้คืนฉาก 3 มิติ"
                : "Please enable hardware acceleration or reload the page to restore 3D view."}
            </p>
          </div>
        )}

        {/* Top-Left Compact Building Title Badge */}
        <div className="absolute top-3 left-3 z-10 pointer-events-none flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-[#0d1629]/95 border border-[#23375e] text-slate-100 shadow-md">
            <div className="text-xs font-extrabold tracking-wide flex items-center gap-2">
              <span>{isThai ? layout.group.labelTh : layout.group.labelEn}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {isCloudLoading
                  ? isThai
                    ? "กำลังโหลด..."
                    : "Syncing..."
                  : isThai
                  ? "อัปเดตเรียลไทม์"
                  : "Live Sync"}
              </span>
            </div>
            <div className="text-[10.5px] text-slate-400 mt-0.5">
              {isThai
                ? `ประตู: ${layout.doors.join(", ")} · ว่าง ${layout.stats.emptyFloorCount}/${layout.stats.totalFloorCount} ช่องฐาน · จอง ${layout.stats.reservedCount} ม้วน`
                : `Doors: ${layout.doors.join(", ")} · Empty ${layout.stats.emptyFloorCount}/${layout.stats.totalFloorCount} floor slots`}
            </div>
          </div>
        </div>

        {/* Right Floating Inspector Card (when a coil or floor slot is selected) */}
        {selectedSlot && (
          <div className="absolute top-3 right-3 z-20 w-80 max-w-[calc(100%-24px)] bg-[#0d1629]/95 border border-[#2b426d] rounded-xl shadow-2xl text-slate-100 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-[#13203b] border-b border-[#23375e] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    STATUS_BADGE_META[selectedSlot.status].dotClass
                  }`}
                />
                <span className="text-xs font-extrabold truncate">
                  {selectedSlot.coil
                    ? selectedSlot.coil.batch
                    : `${isThai ? "ช่องว่าง" : "Empty Slot"} ${selectedSlot.door}/R${selectedSlot.row}-S${selectedSlot.slotIndex}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedSlotKey(null);
                  setFocusedSlotKey(null);
                }}
                className="p-1 rounded hover:bg-[#1e3259] text-slate-400 hover:text-white cursor-pointer"
                aria-label="Close inspector"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-3.5 space-y-3 text-xs">
              {/* Status Badge + 3D Coordinate */}
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span
                  className={`px-2 py-0.5 rounded border text-[10.5px] font-bold ${
                    STATUS_BADGE_META[selectedSlot.status].badgeClass
                  }`}
                >
                  {isThai
                    ? STATUS_BADGE_META[selectedSlot.status].labelTh
                    : STATUS_BADGE_META[selectedSlot.status].labelEn}
                </span>
                <span className="text-[10.5px] font-mono font-bold text-sky-300 flex items-center gap-1">
                  <MapPin size={11} />
                  {selectedSlot.door}/R{selectedSlot.row} · L{selectedSlot.level} · S
                  {selectedSlot.slotIndex}
                </span>
              </div>

              {selectedSlot.coil ? (
                <>
                  <div className="grid grid-cols-2 gap-2 bg-[#091121] border border-[#1d3054] rounded-lg p-2.5">
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {isThai ? "รหัส Batch" : "Batch No."}
                      </div>
                      <div className="font-mono font-extrabold text-white">
                        {selectedSlot.coil.batch}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {isThai ? "Coil No." : "Coil No."}
                      </div>
                      <div className="font-mono font-bold text-slate-200 truncate">
                        {selectedSlot.coil.coilNo || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {isThai ? "น้ำหนัก" : "Weight"}
                      </div>
                      <div className="font-bold text-emerald-300">
                        {Number(selectedSlot.coil.weightKg || 0).toLocaleString()} kg
                        <span className="text-[10px] text-slate-400 ml-1">
                          ({(Number(selectedSlot.coil.weightKg || 0) / 1000).toFixed(2)} t)
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {isThai ? "เกรดเหล็ก" : "Grade"}
                      </div>
                      <div className="font-bold text-slate-100">
                        {selectedSlot.coil.grade || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {isThai ? "หนา × กว้าง (mm)" : "Thick × Width"}
                      </div>
                      <div className="font-bold text-slate-200">
                        {selectedSlot.coil.certThickness || "-"} ×{" "}
                        {selectedSlot.coil.width || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {isThai ? "ผู้ผลิต / Location" : "Mill / Loc"}
                      </div>
                      <div className="font-bold text-slate-200 truncate">
                        {selectedSlot.coil.manufacturer || "-"} ·{" "}
                        {selectedSlot.coil.location || "-"}
                      </div>
                    </div>
                  </div>

                  {/* SAP & Staging Info */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">
                        {isThai ? "ข้อมูล SAP:" : "SAP Status:"}
                      </span>
                      {selectedSlot.isPendingSap ? (
                        <span className="text-amber-300 font-bold flex items-center gap-1">
                          <AlertTriangle size={12} />
                          {isThai ? "รอข้อมูล SAP" : "Pending SAP"}
                        </span>
                      ) : (
                        <span className="text-emerald-300 font-bold flex items-center gap-1">
                          <CheckCircle2 size={12} />
                          {isThai ? "เชื่อมข้อมูล SAP แล้ว" : "SAP Matched"}
                        </span>
                      )}
                    </div>

                    {selectedSlot.coil.status === "staged" && (
                      <div className="px-2.5 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/40 text-[11px] text-orange-200 font-semibold">
                        {isThai ? "จองเตรียมเบิก:" : "Staged Order:"}{" "}
                        <span className="font-mono font-bold">
                          {selectedSlot.coil.stagedOrderNo || "-"}
                        </span>
                        {selectedSlot.coil.stagedMachineId && (
                          <span className="ml-1.5 text-orange-300">
                            ({selectedSlot.coil.stagedMachineId})
                          </span>
                        )}
                      </div>
                    )}

                    {selectedSlot.coil.remark && (
                      <div className="text-[11px] text-slate-300 bg-[#091121] px-2.5 py-1.5 rounded border border-[#1e3154]">
                        {selectedSlot.coil.remark}
                      </div>
                    )}

                    <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1">
                      <span>{isThai ? "อัปเดตล่าสุด:" : "Updated:"}</span>
                      <span className="font-mono">
                        {selectedSlot.coil.updatedAt ||
                          selectedSlot.coil.scanTimestamp ||
                          "-"}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => engineRef.current?.focusOnSlot(selectedSlot)}
                    className="w-full py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Crosshair size={13} />
                    <span>{isThai ? "ซูมเข้าใกล้ม้วนนี้" : "Zoom to Coil"}</span>
                  </button>
                </>
              ) : (
                <div className="space-y-2.5">
                  <div className="bg-[#091121] border border-[#1d3054] rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">
                        {isThai ? "พิกัดช่องจัดเก็บ:" : "Slot Coordinate:"}
                      </span>
                      <span className="font-mono font-bold text-emerald-300">
                        {selectedSlot.door}/{selectedSlot.row} (S{selectedSlot.slotIndex})
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">
                        {isThai ? "ม้วนในแถวนี้ปัจจุบัน:" : "Coils in Row:"}
                      </span>
                      <span className="font-bold text-slate-100 flex items-center gap-1">
                        <Layers size={12} className="text-sky-400" />
                        {selectedRowCoilCount} {isThai ? "ม้วน" : "coils"}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed m-0">
                    {isThai
                      ? `ช่องฐานชั้นที่ 1 นี้พร้อมรับเข้าเหล็กม้วนใหม่ เมื่อสแกนรับเข้าที่ Location "${selectedSlot.door}/${selectedSlot.row}" ม้วนจะปรากฏบนผัง 3D ทันที`
                      : `Floor saddle ready for inbound. Scanning into "${selectedSlot.door}/${selectedSlot.row}" immediately places the coil here.`}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            BOTTOM COLLAPSIBLE 3D CONTROL DOCK (Faithful to Reference Image)
           =================================================================== */}
        <div className="absolute left-3 right-3 bottom-3 z-20 flex flex-col items-start gap-2 pointer-events-none">
          {/* Collapse / Expand Toggle Pill */}
          <button
            type="button"
            onClick={() => setDockVisible((v) => !v)}
            className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0d1629]/95 hover:bg-[#152442] border border-[#273d66] text-slate-200 text-xs font-bold shadow-md cursor-pointer transition-colors"
          >
            {dockVisible ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            <span>
              {dockVisible
                ? isThai
                  ? "ซ่อนแถบควบคุม 3D"
                  : "Hide 3D Controls"
                : isThai
                ? "แสดงแถบควบคุม 3D"
                : "Show 3D Controls"}
            </span>
          </button>

          {/* Main Dock Panel */}
          {dockVisible && (
            <div className="pointer-events-auto w-full bg-[#0d1629]/95 border border-[#24385f] rounded-xl px-3.5 py-3 shadow-2xl space-y-2.5">
              {/* Row 1: Camera Presets (Left) + Filters, Pending SAP, Crane Demo (Right) */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Camera Presets */}
                <div className="inline-flex items-center bg-[#091020] border border-[#1f3255] rounded-lg p-1 gap-0.5">
                  {(
                    [
                      { id: "isometric", label: "Isometric" },
                      { id: "top", label: "Top" },
                      { id: "front", label: "Front" },
                      { id: "side", label: "Side" },
                    ] as Array<{ id: CameraPreset; label: string }>
                  ).map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => handleCameraPreset(cam.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                        activeCameraPreset === cam.id
                          ? "bg-[#1e3358] text-white border border-[#38578f]"
                          : "text-slate-300 hover:text-white hover:bg-[#142340] border border-transparent"
                      }`}
                    >
                      {cam.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleCameraPreset("reset")}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold text-slate-300 hover:text-white hover:bg-[#142340] cursor-pointer transition-colors"
                  >
                    <RotateCcw size={12} />
                    <span>Reset</span>
                  </button>
                </div>

                {/* Filters + Pending SAP + Crane Demo */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Door Filter */}
                  <select
                    value={doorFilter}
                    onChange={(e) => setDoorFilter(e.target.value)}
                    aria-label="Filter by Door"
                    className="px-2.5 py-1.5 rounded-lg bg-[#091020] border border-[#243961] text-xs font-semibold text-slate-200 focus:outline-none focus:border-blue-400 cursor-pointer"
                  >
                    <option value="ALL">
                      {isThai ? "Door ทั้งหมด" : "All Doors"}
                    </option>
                    {layout.doors.map((d) => (
                      <option key={d} value={d}>
                        Door {d}
                      </option>
                    ))}
                  </select>

                  {/* Row Filter */}
                  <select
                    value={rowFilter}
                    onChange={(e) => setRowFilter(e.target.value)}
                    aria-label="Filter by Row"
                    className="px-2.5 py-1.5 rounded-lg bg-[#091020] border border-[#243961] text-xs font-semibold text-slate-200 focus:outline-none focus:border-blue-400 cursor-pointer"
                  >
                    <option value="ALL">
                      {isThai ? "Row ทั้งหมด" : "All Rows"}
                    </option>
                    {layout.rows.map((r) => (
                      <option key={r} value={String(r)}>
                        Row {r}
                      </option>
                    ))}
                  </select>

                  {/* Level Filter */}
                  <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value)}
                    aria-label="Filter by Level"
                    className="px-2.5 py-1.5 rounded-lg bg-[#091020] border border-[#243961] text-xs font-semibold text-slate-200 focus:outline-none focus:border-blue-400 cursor-pointer"
                  >
                    <option value="ALL">
                      {isThai ? "Level ทั้งหมด" : "All Levels"}
                    </option>
                    {layout.levels.map((lv) => (
                      <option key={lv} value={String(lv)}>
                        Level {lv}
                      </option>
                    ))}
                  </select>

                  {/* Pending SAP Toggle Button */}
                  <button
                    type="button"
                    onClick={() => setOnlyPendingSap((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                      onlyPendingSap
                        ? "bg-amber-500 text-slate-950 border-amber-300"
                        : "bg-amber-500/15 text-amber-300 border-amber-500/45 hover:bg-amber-500/25"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        onlyPendingSap ? "bg-slate-950" : "bg-amber-400"
                      }`}
                    />
                    <span>
                      {isThai
                        ? `รอข้อมูล SAP (${layout.stats.pendingSapCount})`
                        : `Pending SAP (${layout.stats.pendingSapCount})`}
                    </span>
                  </button>

                  {/* Crane Demo (Visual Only) Toggle */}
                  <button
                    type="button"
                    onClick={() => setCraneDemoEnabled((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                      craneDemoEnabled
                        ? "bg-yellow-500 text-slate-950 border-yellow-300"
                        : "bg-[#111e38] text-slate-200 border-[#2b426d] hover:bg-[#1a2c4f]"
                    }`}
                  >
                    {craneDemoEnabled ? (
                      <Square size={11} className="fill-current" />
                    ) : (
                      <Play size={11} />
                    )}
                    <span>Crane Demo (Visual Only)</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Color Status Legend */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 border-t border-[#1b2c4c] text-[11px]">
                {(
                  [
                    {
                      color: "bg-emerald-500",
                      code: "EMPTY",
                      text: isThai ? "ว่างพร้อมจัดเก็บ" : "Available",
                    },
                    {
                      color: "bg-blue-500",
                      code: "OCCUPIED",
                      text: isThai ? "มีเหล็กม้วนจัดเก็บ" : "Stored Coil",
                    },
                    {
                      color: "bg-orange-500",
                      code: "RESERVED",
                      text: isThai ? "จองตำแหน่ง (Active)" : "Staged / Reserved",
                    },
                    {
                      color: "bg-red-500",
                      code: "BLOCKED",
                      text: isThai ? "ปิดใช้งาน / กักกัน" : "Blocked / Hold",
                    },
                    {
                      color: "bg-purple-500",
                      code: "RECOMMENDED / FOCUS",
                      text: isThai ? "ตำแหน่งที่เลือก / ค้นพบ" : "Selected / Found",
                    },
                    {
                      color: "bg-amber-400",
                      code: "PENDING SAP",
                      text: isThai ? "รอข้อมูล SAP" : "Pending SAP",
                    },
                  ] as const
                ).map((item) => (
                  <div key={item.code} className="inline-flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                    <span className="font-extrabold text-slate-100">{item.code}</span>
                    <span className="text-slate-400">{item.text}</span>
                  </div>
                ))}
              </div>

              {/* Row 3: Helper Hint */}
              <div className="text-[11px] text-slate-400">
                {isThai
                  ? "คลิกตำแหน่งหรือม้วนเหล็กเพื่อดูรายละเอียด · ลากเพื่อหมุนมุมมอง · เลื่อนลูกกลิ้งเพื่อซูมเข้า-ออก"
                  : "Click any slot or steel coil to inspect details · Drag to orbit · Scroll to zoom"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
