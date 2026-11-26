/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Disc,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Trash2,
  X,
  Wifi,
  WifiOff,
  RefreshCw,
  ChevronDown,
  History,
  Check,
  Truck,
} from "lucide-react";
import { Vehicle } from "../types/officer";
import {
  getVehicleSearchableText,
  getVehicleTypeDisplayLabel,
  isTrailerVehicle,
} from "../utils/vehicleHelpers";
import {
  MhTireStockRecord,
  subscribeToMhTireStock,
  fetchMhTireStockOnce,
  saveMhTireTransactionToCloud,
  deleteMhTireTransactionFromCloud,
  getForkliftCloudRealtimeEnabled,
  setForkliftCloudRealtimeEnabled,
  subscribeForkliftCloudRealtimeMode,
} from "../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import { useAuth } from "../contexts/AuthContext";

interface TireStockManagementProps {
  vehicles: Vehicle[];
}

const WHEEL_POSITION_OPTIONS = [
  "ล้อหน้าซ้าย (FL)",
  "ล้อหน้าขวา (FR)",
  "ล้อหลังซ้าย (RL)",
  "ล้อหลังขวา (RR)",
  "คู่ล้อหน้า (Front Pair)",
  "คู่ล้อหลัง (Rear Pair)",
  "ครบชุด 4 ล้อ (Full Set)",
];

export function TireStockManagement({ vehicles }: TireStockManagementProps) {
  const { currentUser } = useAuth();
  const [tireRecords, setTireRecords] = useState<MhTireStockRecord[]>([]);
  const [cloudRealtime, setCloudRealtime] = useState<boolean>(() =>
    getForkliftCloudRealtimeEnabled()
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [headingPortalTarget, setHeadingPortalTarget] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("page-heading-actions") : null
  );

  const getDefaultTechnicianName = () =>
    currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || "";

  // Tire Stock Modal & Filter State (all empty by default except ผู้บันทึก / ช่างผู้เบิก)
  const [isTireModalOpen, setIsTireModalOpen] = useState<boolean>(false);
  const [tireTxType, setTireTxType] = useState<"Inbound" | "Outbound">("Inbound");
  const [tireSize, setTireSize] = useState<string>("");
  const [tireBrand, setTireBrand] = useState<string>("");
  const [tireQty, setTireQty] = useState<string>("");
  const [tireUnitCost, setTireUnitCost] = useState<string>("");
  const [tireSupplierOrInvoice, setTireSupplierOrInvoice] = useState<string>("");
  const [selectedCompatibleVehicles, setSelectedCompatibleVehicles] = useState<string[]>([]);
  const [vehicleFilterQuery, setVehicleFilterQuery] = useState<string>("");
  const [tireVehicleId, setTireVehicleId] = useState<string>("");
  const [tireWheelPosition, setTireWheelPosition] = useState<string>("");
  const [tireOperatingHours, setTireOperatingHours] = useState<string>("");
  const [tireTechnicianName, setTireTechnicianName] = useState<string>(() =>
    getDefaultTechnicianName()
  );
  const [tireNotes, setTireNotes] = useState<string>("");
  const [tireSearchQuery, setTireSearchQuery] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Cloud-backed Combobox dropdown visibility
  const [showSizeDropdown, setShowSizeDropdown] = useState<boolean>(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState<boolean>(false);
  const [showNotesDropdown, setShowNotesDropdown] = useState<boolean>(false);
  const sizeComboRef = useRef<HTMLDivElement | null>(null);
  const brandComboRef = useRef<HTMLDivElement | null>(null);
  const notesComboRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHeadingPortalTarget(document.getElementById("page-heading-actions"));
  }, []);

  useEffect(() => {
    const unsubMode = subscribeForkliftCloudRealtimeMode((enabled) => {
      setCloudRealtime(enabled);
    });
    return () => unsubMode();
  }, []);

  useEffect(() => {
    const unsubTires = subscribeToMhTireStock((cloudTires) => {
      setTireRecords(cloudTires);
    });
    return () => {
      unsubTires();
    };
  }, [cloudRealtime]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sizeComboRef.current && !sizeComboRef.current.contains(target)) {
        setShowSizeDropdown(false);
      }
      if (brandComboRef.current && !brandComboRef.current.contains(target)) {
        setShowBrandDropdown(false);
      }
      if (notesComboRef.current && !notesComboRef.current.contains(target)) {
        setShowNotesDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const resetModalFields = () => {
    setTireSize("");
    setTireBrand("");
    setTireQty("");
    setTireUnitCost("");
    setTireSupplierOrInvoice("");
    setSelectedCompatibleVehicles([]);
    setVehicleFilterQuery("");
    setTireVehicleId("");
    setTireWheelPosition("");
    setTireOperatingHours("");
    setTireTechnicianName(getDefaultTechnicianName());
    setTireNotes("");
    setShowSizeDropdown(false);
    setShowBrandDropdown(false);
    setShowNotesDropdown(false);
  };

  const openTireModal = (txType: "Inbound" | "Outbound") => {
    resetModalFields();
    setTireTxType(txType);
    setIsTireModalOpen(true);
  };

  const handleManualReload = async () => {
    setIsRefreshing(true);
    try {
      const latestTires = await fetchMhTireStockOnce();
      setTireRecords(latestTires);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Stock balance grouped dynamically by Cloud tireSize records
  const tireStockBySize = useMemo(() => {
    const map = new Map<string, { inbound: number; outbound: number; balance: number }>();
    tireRecords.forEach((tr) => {
      const key = (tr.tireSize || "").trim();
      if (!key || key === "-") return;
      const current = map.get(key) || { inbound: 0, outbound: 0, balance: 0 };
      if (tr.transactionType === "Inbound") {
        current.inbound += Number(tr.qty) || 0;
      } else {
        current.outbound += Number(tr.qty) || 0;
      }
      current.balance = Math.max(0, current.inbound - current.outbound);
      map.set(key, current);
    });
    return map;
  }, [tireRecords]);

  // Fleet split cleanly into drivable vehicles (รถใช้งาน) vs trailers (หางลาก TTL)
  const { drivableVehicles, trailerVehicles, vehicleById } = useMemo(() => {
    const sorted = [...vehicles].sort((a, b) =>
      a.vehicleId.localeCompare(b.vehicleId, undefined, { numeric: true, sensitivity: "base" })
    );
    const drivable: Vehicle[] = [];
    const trailers: Vehicle[] = [];
    const lookup = new Map<string, Vehicle>();
    sorted.forEach((v) => {
      lookup.set(v.vehicleId, v);
      if (isTrailerVehicle(v)) {
        trailers.push(v);
      } else {
        drivable.push(v);
      }
    });
    return { drivableVehicles: drivable, trailerVehicles: trailers, vehicleById: lookup };
  }, [vehicles]);

  const isTrailerId = (id: string): boolean => {
    const matched = vehicleById.get(id);
    if (matched) return isTrailerVehicle(matched);
    return id.trim().toUpperCase().startsWith("TTL");
  };

  // Aggregated compatible vehicles & trailers per tireSize from Cloud history
  const compatibleVehiclesBySize = useMemo(() => {
    const map = new Map<string, string[]>();
    tireRecords.forEach((tr) => {
      const key = (tr.tireSize || "").trim();
      if (!key || key === "-" || !Array.isArray(tr.compatibleVehicles) || tr.compatibleVehicles.length === 0) {
        return;
      }
      const existing = new Set<string>(map.get(key) || []);
      tr.compatibleVehicles.forEach((vid) => {
        const clean = vid.trim();
        if (clean) existing.add(clean);
      });
      const sortedList = Array.from(existing).sort((a, b) => {
        const aIsTrailer = isTrailerId(a);
        const bIsTrailer = isTrailerId(b);
        if (aIsTrailer !== bIsTrailer) return aIsTrailer ? 1 : -1;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      });
      map.set(key, sortedList);
    });
    return map;
  }, [tireRecords, vehicleById]);

  const filteredDrivableVehicles = useMemo(() => {
    const q = vehicleFilterQuery.trim().toLowerCase();
    if (!q) return drivableVehicles;
    return drivableVehicles.filter((v) => getVehicleSearchableText(v).includes(q));
  }, [drivableVehicles, vehicleFilterQuery]);

  const filteredTrailerVehicles = useMemo(() => {
    const q = vehicleFilterQuery.trim().toLowerCase();
    if (!q) return trailerVehicles;
    return trailerVehicles.filter((v) => getVehicleSearchableText(v).includes(q));
  }, [trailerVehicles, vehicleFilterQuery]);

  const toggleCompatibleVehicle = (vehicleId: string) => {
    setSelectedCompatibleVehicles((prev) =>
      prev.includes(vehicleId) ? prev.filter((id) => id !== vehicleId) : [...prev, vehicleId]
    );
  };

  const toggleGroupSelection = (groupIds: string[]) => {
    if (groupIds.length === 0) return;
    setSelectedCompatibleVehicles((prev) => {
      const allSelected = groupIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !groupIds.includes(id));
      }
      const merged = new Set([...prev, ...groupIds]);
      return Array.from(merged);
    });
  };

  // Distinct Tire Sizes & Brands fetched from Cloud records for next-time selection
  const cloudTireSizeOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    tireRecords.forEach((tr) => {
      const val = (tr.tireSize || "").trim();
      if (val && val !== "-" && !seen.has(val)) {
        seen.add(val);
        list.push(val);
      }
    });
    return list;
  }, [tireRecords]);

  const cloudTireBrandOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    tireRecords.forEach((tr) => {
      const val = (tr.brand || "").trim();
      if (val && val !== "-" && !seen.has(val)) {
        seen.add(val);
        list.push(val);
      }
    });
    return list;
  }, [tireRecords]);

  const filteredSizeOptions = useMemo(() => {
    const q = tireSize.trim().toLowerCase();
    if (!q || cloudTireSizeOptions.some((opt) => opt.toLowerCase() === q)) {
      return cloudTireSizeOptions;
    }
    const matched = cloudTireSizeOptions.filter((opt) => opt.toLowerCase().includes(q));
    return matched.length > 0 ? matched : cloudTireSizeOptions;
  }, [cloudTireSizeOptions, tireSize]);

  const filteredBrandOptions = useMemo(() => {
    const q = tireBrand.trim().toLowerCase();
    if (!q || cloudTireBrandOptions.some((opt) => opt.toLowerCase() === q)) {
      return cloudTireBrandOptions;
    }
    const matched = cloudTireBrandOptions.filter((opt) => opt.toLowerCase().includes(q));
    return matched.length > 0 ? matched : cloudTireBrandOptions;
  }, [cloudTireBrandOptions, tireBrand]);

  // Outbound history for หมายเหตุ & latest withdrawal preview
  const outboundHistoryRecords = useMemo(
    () => tireRecords.filter((tr) => tr.transactionType === "Outbound"),
    [tireRecords]
  );

  const latestOutboundRecord = useMemo(() => {
    if (tireVehicleId) {
      return outboundHistoryRecords.find((tr) => tr.vehicleId === tireVehicleId) || null;
    }
    return outboundHistoryRecords[0] || null;
  }, [outboundHistoryRecords, tireVehicleId]);

  const cloudOutboundNotesOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: { note: string; vehicleId: string; date: string; wheelPosition?: string }[] = [];
    const prioritized = tireVehicleId
      ? [
          ...outboundHistoryRecords.filter((tr) => tr.vehicleId === tireVehicleId),
          ...outboundHistoryRecords.filter((tr) => tr.vehicleId !== tireVehicleId),
        ]
      : outboundHistoryRecords;
    prioritized.forEach((tr) => {
      const cleanNote = (tr.notes || "").trim();
      if (cleanNote && !seen.has(cleanNote)) {
        seen.add(cleanNote);
        list.push({
          note: cleanNote,
          vehicleId: tr.vehicleId || "-",
          date: tr.date || "",
          wheelPosition: tr.wheelPosition,
        });
      }
    });
    return list;
  }, [outboundHistoryRecords, tireVehicleId]);

  const filteredOutboundNotesOptions = useMemo(() => {
    const q = tireNotes.trim().toLowerCase();
    if (!q || cloudOutboundNotesOptions.some((opt) => opt.note.toLowerCase() === q)) {
      return cloudOutboundNotesOptions;
    }
    const matched = cloudOutboundNotesOptions.filter(
      (opt) =>
        opt.note.toLowerCase().includes(q) ||
        opt.vehicleId.toLowerCase().includes(q)
    );
    return matched.length > 0 ? matched : cloudOutboundNotesOptions;
  }, [cloudOutboundNotesOptions, tireNotes]);

  const totalTiresInStock = useMemo(() => {
    let total = 0;
    tireStockBySize.forEach((v) => {
      total += v.balance;
    });
    return total;
  }, [tireStockBySize]);

  const filteredTireRecords = useMemo(() => {
    if (!tireSearchQuery.trim()) return tireRecords;
    const q = tireSearchQuery.toLowerCase();
    return tireRecords.filter(
      (tr) =>
        tr.transactionNo.toLowerCase().includes(q) ||
        tr.tireSize.toLowerCase().includes(q) ||
        tr.brand.toLowerCase().includes(q) ||
        (tr.vehicleId || "").toLowerCase().includes(q) ||
        (tr.compatibleVehicles || []).join(" ").toLowerCase().includes(q) ||
        (tr.supplierOrInvoice || "").toLowerCase().includes(q) ||
        tr.technicianOrReceiver.toLowerCase().includes(q)
    );
  }, [tireRecords, tireSearchQuery]);

  const handleCreateTireTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSize = tireSize.trim();
    const cleanBrand = tireBrand.trim();
    const cleanTech = tireTechnicianName.trim();
    const parsedQty = Number(tireQty);
    const parsedUnit = Number(tireUnitCost);

    if (!cleanSize || !cleanBrand || !cleanTech) return;
    if (!tireQty || isNaN(parsedQty) || parsedQty < 1) return;
    if (tireUnitCost === "" || isNaN(parsedUnit) || parsedUnit < 0) return;
    if (tireTxType === "Inbound" && !tireSupplierOrInvoice.trim()) return;
    if (tireTxType === "Outbound" && (!tireVehicleId || !tireWheelPosition)) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);
    const txId = `TIRE-${now.getFullYear()}-${String(tireRecords.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-4)}`;
    const safeQty = Math.max(1, parsedQty);
    const safeUnit = Math.max(0, parsedUnit);

    const newTireRecord: MhTireStockRecord = {
      id: txId,
      transactionNo: txId,
      date: dateStr,
      time: timeStr,
      transactionType: tireTxType,
      tireSize: cleanSize,
      brand: cleanBrand,
      qty: safeQty,
      unitCost: safeUnit,
      totalCost: safeQty * safeUnit,
      supplierOrInvoice:
        tireTxType === "Inbound" ? tireSupplierOrInvoice.trim() : undefined,
      compatibleVehicles:
        tireTxType === "Inbound" && selectedCompatibleVehicles.length > 0
          ? [...selectedCompatibleVehicles].sort((a, b) => {
              const aIsTrailer = isTrailerId(a);
              const bIsTrailer = isTrailerId(b);
              if (aIsTrailer !== bIsTrailer) return aIsTrailer ? 1 : -1;
              return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
            })
          : undefined,
      vehicleId: tireTxType === "Outbound" ? tireVehicleId : undefined,
      vehicleNumber: tireTxType === "Outbound" ? tireVehicleId : undefined,
      wheelPosition: tireTxType === "Outbound" ? tireWheelPosition : undefined,
      operatingHours:
        tireTxType === "Outbound" && tireOperatingHours !== ""
          ? Number(tireOperatingHours) || 0
          : undefined,
      technicianOrReceiver: cleanTech,
      notes: tireNotes.trim() || undefined,
      updatedAt: `${dateStr} ${timeStr}`,
    };

    setTireRecords((prev) => [newTireRecord, ...prev]);
    setIsTireModalOpen(false);
    resetModalFields();
    await saveMhTireTransactionToCloud(newTireRecord);

    const compatSuffix =
      newTireRecord.compatibleVehicles && newTireRecord.compatibleVehicles.length > 0
        ? ` · ใช้กับ: ${newTireRecord.compatibleVehicles.join(", ")}`
        : "";

    void appendWmsActivityLog({
      module: "สต๊อกยางโฟล์คลิฟท์",
      sectionId: "fleet_ops",
      reference: txId,
      activity:
        tireTxType === "Inbound"
          ? `รับเข้ายาง ${cleanSize} (${cleanBrand}) จำนวน ${safeQty} เส้น (${newTireRecord.supplierOrInvoice || "-"}${compatSuffix})`
          : `เบิกเปลี่ยนยาง ${cleanSize} (${cleanBrand}) จำนวน ${safeQty} เส้น รถ ${newTireRecord.vehicleId || "-"}`,
      status: "Completed",
    });
  };

  const handleDeleteTireRecord = async (id: string) => {
    setTireRecords((prev) => prev.filter((item) => item.id !== id));
    setConfirmDeleteId(null);
    await deleteMhTireTransactionFromCloud(id);
  };

  const cloudSyncControls = (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setForkliftCloudRealtimeEnabled(!cloudRealtime)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border transition-colors whitespace-nowrap shrink-0 ${
          cloudRealtime
            ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-700"
            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50 dark:bg-[#0d1b33] dark:text-slate-300 dark:border-[#1e3a5f]"
        }`}
        title="สลับโหมด Cloud Real-time เพื่อประหยัดโควต้าการอ่านข้อมูล"
      >
        {cloudRealtime ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span>{cloudRealtime ? "Cloud Sync: ON" : "Cloud Sync: OFF"}</span>
      </button>

      {!cloudRealtime && (
        <button
          type="button"
          onClick={handleManualReload}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744] whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
          <span>{isRefreshing ? "กำลังโหลด..." : "ดึงข้อมูลล่าสุด"}</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {headingPortalTarget ? createPortal(cloudSyncControls, headingPortalTarget) : null}

      <section className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Disc size={16} className="text-[#087eaf]" />
              <span>สต๊อกยางโฟล์คลิฟท์และบันทึกการเบิกเปลี่ยนยาง (mh_tire_stock)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              คงเหลือรวมทั้งสิ้น {totalTiresInStock.toLocaleString()} เส้น · แยกฐานข้อมูลอิสระสำหรับงานโฟล์คลิฟท์
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!headingPortalTarget && cloudSyncControls}
            <button
              type="button"
              onClick={() => openTireModal("Inbound")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
            >
              <ArrowDownLeft size={14} /> + รับเข้ายางใหม่ (Inbound)
            </button>
            <button
              type="button"
              onClick={() => openTireModal("Outbound")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold bg-[#087eaf] hover:bg-[#075985] text-white whitespace-nowrap"
            >
              <ArrowUpRight size={14} /> - เบิกเปลี่ยนยาง (Outbound)
            </button>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-b border-slate-200 dark:border-[#1e3a5f]">
          {tireStockBySize.size === 0 ? (
            <div className="sm:col-span-2 lg:col-span-4 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
              ยังไม่มีรายการขนาดยางในสต๊อก กด "+ รับเข้ายางใหม่ (Inbound)" เพื่อบันทึกขนาดยางและยี่ห้อลงคลาวด์
            </div>
          ) : (
            Array.from(tireStockBySize.entries()).map(([sizeLabel, stats]) => {
              const compatList = compatibleVehiclesBySize.get(sizeLabel) || [];
              return (
                <div
                  key={sizeLabel}
                  className="p-3 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33] flex flex-col justify-between gap-2"
                >
                  <div>
                    <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                      {sizeLabel}
                    </div>
                    <div className="flex justify-between items-baseline mt-1.5 tabular-nums">
                      <span
                        className={`text-lg font-extrabold ${
                          stats.balance > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {stats.balance} <span className="text-[11px] font-semibold">เส้น</span>
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        รับ +{stats.inbound} · เบิก -{stats.outbound}
                      </span>
                    </div>
                  </div>

                  {compatList.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/80 dark:border-[#1e3a5f] flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mr-0.5">
                        ใช้กับ:
                      </span>
                      {compatList.map((vid) => {
                        const trailer = isTrailerId(vid);
                        return (
                          <span
                            key={vid}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border tabular-nums ${
                              trailer
                                ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                                : "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800"
                            }`}
                          >
                            {vid}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="filterbar px-3 py-2.5 sm:px-[18px] sm:py-3 border-b border-slate-200 dark:border-[#1e3a5f]">
          <div className="relative max-w-md w-full">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="ค้นหาเลขที่รายการ, ขนาดยาง, ยี่ห้อ, เบอร์รถ/หางลาก, ช่างผู้เบิก..."
              value={tireSearchQuery}
              onChange={(e) => setTireSearchQuery(e.target.value)}
              className="field w-full font-normal rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
              style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="ts-stats-table w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300">
                <th className="ts-left font-bold whitespace-nowrap">เลขที่รายการ & วัน-เวลา</th>
                <th className="ts-center font-bold whitespace-nowrap">ประเภท</th>
                <th className="ts-left font-bold whitespace-nowrap">ขนาดยาง & ยี่ห้อ</th>
                <th className="ts-right font-bold whitespace-nowrap">จำนวน (เส้น)</th>
                <th className="ts-right font-bold whitespace-nowrap">ราคา/หน่วย & รวม</th>
                <th className="ts-left font-bold whitespace-nowrap">รถ / หางลาก</th>
                <th className="ts-left font-bold whitespace-nowrap">แหล่งที่มา</th>
                <th className="ts-left font-bold whitespace-nowrap">ผู้รับผิดชอบ / หมายเหตุ</th>
                <th className="ts-center font-bold whitespace-nowrap">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {filteredTireRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="ts-center py-10 text-slate-500 dark:text-slate-400">
                    ยังไม่มีประวัติรายการสต๊อกยางในฐานข้อมูล (mh_tire_stock)
                  </td>
                </tr>
              ) : (
                filteredTireRecords.map((tr) => (
                  <tr
                    key={tr.id}
                    className="hover:bg-slate-50 dark:hover:bg-[#162744]/60 transition-colors"
                  >
                    <td className="ts-left whitespace-nowrap">
                      <div className="font-bold text-[#087eaf] dark:text-sky-400 tabular-nums">
                        {tr.transactionNo}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {tr.date} · {tr.time}
                      </div>
                    </td>
                    <td className="ts-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${
                          tr.transactionType === "Inbound"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800"
                        }`}
                      >
                        {tr.transactionType === "Inbound" ? "+ รับเข้าสต๊อก" : "- เบิกเปลี่ยนยาง"}
                      </span>
                    </td>
                    <td className="ts-left ts-wrap min-w-[160px]">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {tr.tireSize}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        ยี่ห้อ: {tr.brand}
                      </div>
                    </td>
                    <td className="ts-right font-bold tabular-nums whitespace-nowrap">
                      <span
                        className={
                          tr.transactionType === "Inbound"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-sky-600 dark:text-sky-400"
                        }
                      >
                        {tr.transactionType === "Inbound" ? "+" : "-"}
                        {tr.qty} เส้น
                      </span>
                    </td>
                    <td className="ts-right tabular-nums whitespace-nowrap">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {tr.totalCost.toLocaleString()} บาท
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        @{tr.unitCost.toLocaleString()} บาท
                      </div>
                    </td>
                    <td className="ts-left ts-wrap min-w-[170px]">
                      {tr.transactionType === "Inbound" ? (
                        tr.compatibleVehicles && tr.compatibleVehicles.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {tr.compatibleVehicles.map((vid) => {
                              const trailer = isTrailerId(vid);
                              return (
                                <span
                                  key={vid}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border tabular-nums ${
                                    trailer
                                      ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                                      : "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800"
                                  }`}
                                >
                                  {vid}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">-</span>
                        )
                      ) : (
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                            {tr.vehicleId || "-"}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {tr.wheelPosition || "-"}
                            {tr.operatingHours ? ` · ${tr.operatingHours} ชม.` : ""}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="ts-left ts-wrap min-w-[160px]">
                      {tr.transactionType === "Inbound" ? (
                        <div>
                          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Supplier / PO
                          </div>
                          <div className="text-slate-700 dark:text-slate-300">
                            {tr.supplierOrInvoice || "-"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">-</span>
                      )}
                    </td>
                    <td className="ts-left ts-wrap min-w-[160px]">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {tr.technicianOrReceiver}
                      </div>
                      {tr.notes && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {tr.notes}
                        </div>
                      )}
                    </td>
                    <td className="ts-center whitespace-nowrap">
                      {confirmDeleteId === tr.id ? (
                        <div className="inline-flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteTireRecord(tr.id)}
                            className="px-2 py-1 rounded text-[11px] font-bold bg-rose-600 text-white whitespace-nowrap"
                          >
                            ยืนยันลบ
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded text-[11px] border border-slate-300 dark:border-[#1e3a5f]"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(tr.id)}
                          className="p-1.5 rounded border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="ลบรายการ"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tire Stock Inbound / Outbound Modal */}
      {isTireModalOpen && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/60 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl w-full max-w-2xl max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-32px)] flex flex-col min-h-0 overflow-hidden shadow-xl">
            <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex justify-between items-center">
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {tireTxType === "Inbound"
                    ? "+ รับเข้ายางรถโฟล์คลิฟท์ (Tire Stock Inbound)"
                    : "- เบิกเปลี่ยนยางรถโฟล์คลิฟท์ (Tire Stock Outbound)"}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  บันทึกลงฐานข้อมูลแยกอิสระ (mh_tire_stock) · ขนาดยางและยี่ห้อที่บันทึกจะเก็บเป็นตัวเลือกบนคลาวด์อัตโนมัติ
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTireModalOpen(false)}
                className="text-slate-500 hover:text-slate-800 dark:text-slate-400"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleCreateTireTransaction}
              className="flex-1 min-h-0 flex flex-col overflow-hidden text-xs"
            >
              <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5 content-start">
              <div className="sm:col-span-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setTireTxType("Inbound")}
                  className={`flex-1 py-2 rounded-md font-bold border ${
                    tireTxType === "Inbound"
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f]"
                  }`}
                >
                  + รับเข้ายางใหม่ (Inbound)
                </button>
                <button
                  type="button"
                  onClick={() => setTireTxType("Outbound")}
                  className={`flex-1 py-2 rounded-md font-bold border ${
                    tireTxType === "Outbound"
                      ? "bg-[#087eaf] text-white border-[#087eaf]"
                      : "bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f]"
                  }`}
                >
                  - เบิกเปลี่ยนยาง (Outbound)
                </button>
              </div>

              {/* Tire Size (User-typed + Cloud-saved dropdown) */}
              <div ref={sizeComboRef} className="relative">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ขนาดยาง (Tire Size) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={tireSize}
                    onFocus={() => setShowSizeDropdown(true)}
                    onChange={(e) => {
                      setTireSize(e.target.value);
                      setShowSizeDropdown(true);
                    }}
                    placeholder={
                      cloudTireSizeOptions.length > 0
                        ? "พิมพ์ขนาดยาง หรือเลือกจากคลาวด์..."
                        : "พิมพ์ขนาดยาง เช่น 7.00-12"
                    }
                    required
                    className="w-full pl-3 pr-8 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                  />
                  {cloudTireSizeOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSizeDropdown((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      title="เลือกขนาดยางจากคลาวด์"
                    >
                      <ChevronDown size={14} />
                    </button>
                  )}
                </div>

                {showSizeDropdown && filteredSizeOptions.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] shadow-lg">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33]">
                      ขนาดยางที่เคยบันทึกบนคลาวด์ ({cloudTireSizeOptions.length})
                    </div>
                    {filteredSizeOptions.map((sz) => {
                      const stats = tireStockBySize.get(sz);
                      return (
                        <button
                          key={sz}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setTireSize(sz);
                            setShowSizeDropdown(false);
                            if (tireTxType === "Inbound" && selectedCompatibleVehicles.length === 0) {
                              const knownCompat = compatibleVehiclesBySize.get(sz);
                              if (knownCompat && knownCompat.length > 0) {
                                setSelectedCompatibleVehicles(knownCompat);
                              }
                            }
                          }}
                          className="w-full px-3 py-2 text-left text-xs hover:bg-sky-50 dark:hover:bg-[#162744] flex items-center justify-between gap-2 border-b last:border-b-0 border-slate-100 dark:border-[#1e3a5f]/60"
                        >
                          <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {sz}
                          </span>
                          {stats && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums shrink-0">
                              คงเหลือ {stats.balance} เส้น
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tire Brand (User-typed + Cloud-saved dropdown) */}
              <div ref={brandComboRef} className="relative">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ยี่ห้อ / รุ่นยาง (Brand) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={tireBrand}
                    onFocus={() => setShowBrandDropdown(true)}
                    onChange={(e) => {
                      setTireBrand(e.target.value);
                      setShowBrandDropdown(true);
                    }}
                    placeholder={
                      cloudTireBrandOptions.length > 0
                        ? "พิมพ์ยี่ห้อ หรือเลือกจากคลาวด์..."
                        : "พิมพ์ยี่ห้อ / รุ่นยาง เช่น KOMACHI, PIO"
                    }
                    required
                    className="w-full pl-3 pr-8 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                  />
                  {cloudTireBrandOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowBrandDropdown((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      title="เลือกยี่ห้อยางจากคลาวด์"
                    >
                      <ChevronDown size={14} />
                    </button>
                  )}
                </div>

                {showBrandDropdown && filteredBrandOptions.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] shadow-lg">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33]">
                      ยี่ห้อ / รุ่นยางที่เคยบันทึกบนคลาวด์ ({cloudTireBrandOptions.length})
                    </div>
                    {filteredBrandOptions.map((br) => (
                      <button
                        key={br}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setTireBrand(br);
                          setShowBrandDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-sky-50 dark:hover:bg-[#162744] text-slate-800 dark:text-slate-200 font-medium border-b last:border-b-0 border-slate-100 dark:border-[#1e3a5f]/60 truncate"
                      >
                        {br}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  จำนวน (เส้น) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={tireQty}
                  onChange={(e) => setTireQty(e.target.value)}
                  placeholder="ระบุจำนวน (เส้น)"
                  required
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ราคาต่อเส้น (บาท) *
                </label>
                <input
                  type="number"
                  min={0}
                  value={tireUnitCost}
                  onChange={(e) => setTireUnitCost(e.target.value)}
                  placeholder="ระบุราคาต่อเส้น (บาท)"
                  required
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              {tireTxType === "Inbound" ? (
                <>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      ผู้จัดจำหน่าย / เลขที่ใบส่งของ (Supplier / Invoice No.) *
                    </label>
                    <input
                      type="text"
                      value={tireSupplierOrInvoice}
                      onChange={(e) => setTireSupplierOrInvoice(e.target.value)}
                      placeholder="เช่น บจก. สยามไทร์ / INV-2026-089"
                      required
                      className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  {/* Compatible Vehicles & Trailers Selector */}
                  <div className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]/70 p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Truck size={14} className="text-[#087eaf] dark:text-sky-400 shrink-0" />
                        <span className="font-bold text-slate-800 dark:text-slate-100">
                          รถและหางลากที่ใช้ยางขนาดนี้ (เลือกได้หลายคัน)
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold tabular-nums">
                          เลือกแล้ว {selectedCompatibleVehicles.length} รายการ
                        </span>
                      </div>
                      {selectedCompatibleVehicles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedCompatibleVehicles([])}
                          className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                        >
                          ล้างที่เลือกทั้งหมด
                        </button>
                      )}
                    </div>

                    {vehicles.length > 10 && (
                      <div className="relative">
                        <Search
                          size={12}
                          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          type="text"
                          value={vehicleFilterQuery}
                          onChange={(e) => setVehicleFilterQuery(e.target.value)}
                          placeholder="กรองรหัสรถหรือหางลาก เช่น FL-01, TT-01, TTL-01..."
                          className="w-full pl-7 pr-3 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-[11px] text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    )}

                    {/* Group 1: รถใช้งาน (Forklift / Tractor / etc.) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-sky-800 dark:text-sky-300">
                          รถใช้งาน / โฟล์คลิฟท์ / หัวลาก ({filteredDrivableVehicles.length} คัน)
                        </span>
                        {filteredDrivableVehicles.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              toggleGroupSelection(filteredDrivableVehicles.map((v) => v.vehicleId))
                            }
                            className="text-[10px] font-semibold text-[#087eaf] dark:text-sky-400 hover:underline"
                          >
                            {filteredDrivableVehicles.every((v) =>
                              selectedCompatibleVehicles.includes(v.vehicleId)
                            )
                              ? "ยกเลิกกลุ่มนี้"
                              : "เลือกทั้งหมดในกลุ่ม"}
                          </button>
                        )}
                      </div>
                      {filteredDrivableVehicles.length === 0 ? (
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 py-1">
                          ไม่พบรายการรถที่ตรงกับคำค้นหา
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 max-h-32 overflow-y-auto pr-0.5">
                          {filteredDrivableVehicles.map((v) => {
                            const selected = selectedCompatibleVehicles.includes(v.vehicleId);
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => toggleCompatibleVehicle(v.vehicleId)}
                                title={`${v.vehicleId} - ${getVehicleTypeDisplayLabel(v.vehicleType, v)}${v.description ? ` (${v.description})` : ""}`}
                                className={`flex items-center justify-between gap-1 px-2 py-1.5 rounded border text-left transition-colors ${
                                  selected
                                    ? "bg-sky-600 text-white border-sky-600 shadow-xs"
                                    : "bg-white dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:border-sky-400 dark:hover:border-sky-500"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="text-[11px] font-bold truncate tabular-nums">
                                    {v.vehicleId}
                                  </div>
                                  <div
                                    className={`text-[9px] truncate ${
                                      selected ? "text-sky-100" : "text-slate-400 dark:text-slate-400"
                                    }`}
                                  >
                                    {getVehicleTypeDisplayLabel(v.vehicleType, v)}
                                  </div>
                                </div>
                                {selected && <Check size={12} className="shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Group 2: หางลาก / เทรลเลอร์ (TTL) */}
                    <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-[#1e3a5f]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                          หางลาก / เทรลเลอร์ (TTL) ({filteredTrailerVehicles.length} หาง)
                        </span>
                        {filteredTrailerVehicles.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              toggleGroupSelection(filteredTrailerVehicles.map((v) => v.vehicleId))
                            }
                            className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:underline"
                          >
                            {filteredTrailerVehicles.every((v) =>
                              selectedCompatibleVehicles.includes(v.vehicleId)
                            )
                              ? "ยกเลิกกลุ่มนี้"
                              : "เลือกทั้งหมดในกลุ่ม"}
                          </button>
                        )}
                      </div>
                      {filteredTrailerVehicles.length === 0 ? (
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 py-1">
                          ไม่พบรายการหางลากที่ตรงกับคำค้นหา
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 max-h-28 overflow-y-auto pr-0.5">
                          {filteredTrailerVehicles.map((v) => {
                            const selected = selectedCompatibleVehicles.includes(v.vehicleId);
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => toggleCompatibleVehicle(v.vehicleId)}
                                title={`${v.vehicleId} - ${getVehicleTypeDisplayLabel(v.vehicleType, v)}${v.description ? ` (${v.description})` : ""}`}
                                className={`flex items-center justify-between gap-1 px-2 py-1.5 rounded border text-left transition-colors ${
                                  selected
                                    ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                                    : "bg-white dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:border-amber-400 dark:hover:border-amber-500"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="text-[11px] font-bold truncate tabular-nums">
                                    {v.vehicleId}
                                  </div>
                                  <div
                                    className={`text-[9px] truncate ${
                                      selected ? "text-amber-100" : "text-slate-400 dark:text-slate-400"
                                    }`}
                                  >
                                    {v.description || "หางลาก / เทรลเลอร์"}
                                  </div>
                                </div>
                                {selected && <Check size={12} className="shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      รถโฟล์คลิฟท์ / หางลากที่เปลี่ยนยาง *
                    </label>
                    <select
                      value={tireVehicleId}
                      onChange={(e) => setTireVehicleId(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                    >
                      <option value="">— เลือกรถ / หางลาก —</option>
                      {drivableVehicles.length > 0 && (
                        <optgroup label="รถใช้งาน / โฟล์คลิฟท์ / หัวลาก">
                          {drivableVehicles.map((v) => {
                            const isCompat =
                              tireSize.trim() &&
                              (compatibleVehiclesBySize.get(tireSize.trim()) || []).includes(
                                v.vehicleId
                              );
                            return (
                              <option key={v.id} value={v.vehicleId}>
                                {v.vehicleId} - {getVehicleTypeDisplayLabel(v.vehicleType, v)}
                                {v.description ? ` (${v.description})` : ""}
                                {isCompat ? " ★ ใช้ยางขนาดนี้" : ""}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                      {trailerVehicles.length > 0 && (
                        <optgroup label="หางลาก / เทรลเลอร์ (TTL)">
                          {trailerVehicles.map((v) => {
                            const isCompat =
                              tireSize.trim() &&
                              (compatibleVehiclesBySize.get(tireSize.trim()) || []).includes(
                                v.vehicleId
                              );
                            return (
                              <option key={v.id} value={v.vehicleId}>
                                {v.vehicleId} - {getVehicleTypeDisplayLabel(v.vehicleType, v)}
                                {v.description ? ` (${v.description})` : ""}
                                {isCompat ? " ★ ใช้ยางขนาดนี้" : ""}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      ตำแหน่งล้อที่เปลี่ยน *
                    </label>
                    <select
                      value={tireWheelPosition}
                      onChange={(e) => setTireWheelPosition(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                    >
                      <option value="">— เลือกตำแหน่งล้อ —</option>
                      {WHEEL_POSITION_OPTIONS.map((pos) => (
                        <option key={pos} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      ชั่วโมงรถขณะเปลี่ยนยาง (ชม.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={tireOperatingHours}
                      onChange={(e) => setTireOperatingHours(e.target.value)}
                      placeholder="ระบุชั่วโมงรถ (ถ้ามี)"
                      className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ผู้บันทึก / ช่างผู้เบิก *
                </label>
                <input
                  type="text"
                  value={tireTechnicianName}
                  onChange={(e) => setTireTechnicianName(e.target.value)}
                  placeholder="ระบุชื่อช่างหรือเจ้าหน้าที่"
                  required
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div ref={notesComboRef} className="relative">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  หมายเหตุ
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={tireNotes}
                    onFocus={() => {
                      if (tireTxType === "Outbound") setShowNotesDropdown(true);
                    }}
                    onChange={(e) => {
                      setTireNotes(e.target.value);
                      if (tireTxType === "Outbound") setShowNotesDropdown(true);
                    }}
                    placeholder={
                      tireTxType === "Outbound" && cloudOutboundNotesOptions.length > 0
                        ? "พิมพ์หมายเหตุ หรือเลือกจากประวัติที่เคยเบิก..."
                        : "รายละเอียดเพิ่มเติม..."
                    }
                    className={`w-full ${
                      tireTxType === "Outbound" && cloudOutboundNotesOptions.length > 0
                        ? "pl-3 pr-8"
                        : "px-3"
                    } py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100`}
                  />
                  {tireTxType === "Outbound" && cloudOutboundNotesOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowNotesDropdown((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      title="เลือกจากประวัติหมายเหตุที่เคยเบิก"
                    >
                      <ChevronDown size={14} />
                    </button>
                  )}
                </div>

                {tireTxType === "Outbound" &&
                  showNotesDropdown &&
                  filteredOutboundNotesOptions.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] shadow-lg">
                      <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33]">
                        ประวัติหมายเหตุที่เคยเบิกล่าสุด ({cloudOutboundNotesOptions.length})
                      </div>
                      {filteredOutboundNotesOptions.map((item) => (
                        <button
                          key={`${item.note}-${item.vehicleId}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setTireNotes(item.note);
                            setShowNotesDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-xs hover:bg-sky-50 dark:hover:bg-[#162744] border-b last:border-b-0 border-slate-100 dark:border-[#1e3a5f]/60"
                        >
                          <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {item.note}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                            รถ {item.vehicleId}
                            {item.wheelPosition ? ` · ${item.wheelPosition}` : ""}
                            {item.date ? ` · ${item.date}` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
              </div>

              {tireTxType === "Outbound" && (
                <div className="sm:col-span-2 p-3 rounded-lg border border-sky-200 dark:border-sky-900/70 bg-sky-50/60 dark:bg-sky-950/25 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-[11px] text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
                      <History size={13} className="text-[#087eaf] dark:text-sky-400" />
                      <span>
                        ประวัติการเบิกเปลี่ยนยางล่าสุด{" "}
                        {tireVehicleId ? `(รถ ${tireVehicleId})` : "(รายการล่าสุดทั้งหมด)"}
                      </span>
                    </div>
                    {latestOutboundRecord?.notes && (
                      <button
                        type="button"
                        onClick={() => setTireNotes(latestOutboundRecord.notes || "")}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-white dark:bg-[#0d1b33] border border-sky-300 dark:border-sky-700 text-[#087eaf] dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-[#162744] whitespace-nowrap"
                      >
                        ดึงหมายเหตุล่าสุดมาใส่
                      </button>
                    )}
                  </div>

                  {latestOutboundRecord ? (
                    <div className="text-[11px] text-slate-700 dark:text-slate-300 space-y-0.5 leading-relaxed">
                      <div className="tabular-nums">
                        <span className="font-semibold">วันที่เบิก:</span>{" "}
                        {latestOutboundRecord.date} {latestOutboundRecord.time} ·{" "}
                        <span className="font-semibold">รถ:</span>{" "}
                        {latestOutboundRecord.vehicleId || "-"} ·{" "}
                        <span className="font-semibold">ตำแหน่ง:</span>{" "}
                        {latestOutboundRecord.wheelPosition || "-"}
                      </div>
                      <div className="tabular-nums">
                        <span className="font-semibold">ขนาด/ยี่ห้อ:</span>{" "}
                        {latestOutboundRecord.tireSize} ({latestOutboundRecord.brand}) ·{" "}
                        <span className="font-semibold">จำนวน:</span>{" "}
                        {latestOutboundRecord.qty} เส้น
                        {latestOutboundRecord.operatingHours
                          ? ` · ชม.รถ ${latestOutboundRecord.operatingHours.toLocaleString()} ชม.`
                          : ""}
                      </div>
                      <div>
                        <span className="font-semibold">ช่างผู้เบิก:</span>{" "}
                        {latestOutboundRecord.technicianOrReceiver} ·{" "}
                        <span className="font-semibold">หมายเหตุล่าสุด:</span>{" "}
                        <span className="text-slate-900 dark:text-slate-100 font-medium">
                          {latestOutboundRecord.notes || "-"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      ยังไม่มีประวัติการเบิกเปลี่ยนยาง
                      {tireVehicleId ? `สำหรับรถ ${tireVehicleId}` : ""} ในฐานข้อมูล
                    </div>
                  )}
                </div>
              )}

              </div>

              <div className="shrink-0 px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-slate-50/90 dark:bg-[#0d1b33] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTireModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 dark:border-[#1e3a5f] font-semibold bg-white dark:bg-[#111e38]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-md bg-[#087eaf] hover:bg-[#075985] text-white font-bold"
                >
                  บันทึกรายการสต๊อกยาง
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
