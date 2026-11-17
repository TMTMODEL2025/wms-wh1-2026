/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import { Vehicle } from "../types/officer";
import {
  MhTireStockRecord,
  MhTireSize,
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

const TIRE_SIZE_OPTIONS: MhTireSize[] = [
  "6.00-9 (ยางตันหน้า/หลัง 2.5T)",
  "7.00-12 (ยางตันหน้า 2.5T-3.0T)",
  "28x9-15 (ยางตันหน้า 3.0T-3.5T)",
  "6.50-10 (ยางตันหลัง 3.0T-3.5T)",
  "250-15 (ยางตันหน้า 4.0T-5.0T)",
  "300-15 (ยางตันหน้า 5.0T-7.0T)",
  "8.25-15 (ยางตันรถลากจูง/เทรลเลอร์)",
];

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

  // Tire Stock Modal & Filter State
  const [isTireModalOpen, setIsTireModalOpen] = useState<boolean>(false);
  const [tireTxType, setTireTxType] = useState<"Inbound" | "Outbound">("Inbound");
  const [tireSize, setTireSize] = useState<string>(TIRE_SIZE_OPTIONS[1]);
  const [tireBrand, setTireBrand] = useState<string>("KOMACHI / PIO");
  const [tireQty, setTireQty] = useState<number>(2);
  const [tireUnitCost, setTireUnitCost] = useState<number>(3800);
  const [tireSupplierOrInvoice, setTireSupplierOrInvoice] = useState<string>("");
  const [tireVehicleId, setTireVehicleId] = useState<string>(vehicles[0]?.vehicleId || "");
  const [tireWheelPosition, setTireWheelPosition] = useState<string>(WHEEL_POSITION_OPTIONS[4]);
  const [tireOperatingHours, setTireOperatingHours] = useState<number>(0);
  const [tireTechnicianName, setTireTechnicianName] = useState<string>(() => {
    return currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || "";
  });
  const [tireNotes, setTireNotes] = useState<string>("");
  const [tireSearchQuery, setTireSearchQuery] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    if (!tireVehicleId && vehicles.length > 0) {
      setTireVehicleId(vehicles[0].vehicleId);
    }
  }, [vehicles, tireVehicleId]);

  const handleManualReload = async () => {
    setIsRefreshing(true);
    try {
      const latestTires = await fetchMhTireStockOnce();
      setTireRecords(latestTires);
    } finally {
      setIsRefreshing(false);
    }
  };

  const tireStockBySize = useMemo(() => {
    const map = new Map<string, { inbound: number; outbound: number; balance: number }>();
    TIRE_SIZE_OPTIONS.forEach((size) => {
      map.set(size, { inbound: 0, outbound: 0, balance: 0 });
    });
    tireRecords.forEach((tr) => {
      const key = tr.tireSize || TIRE_SIZE_OPTIONS[1];
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
        (tr.supplierOrInvoice || "").toLowerCase().includes(q) ||
        tr.technicianOrReceiver.toLowerCase().includes(q)
    );
  }, [tireRecords, tireSearchQuery]);

  const handleCreateTireTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);
    const txId = `TIRE-${now.getFullYear()}-${String(tireRecords.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-4)}`;
    const safeQty = Math.max(1, Number(tireQty) || 1);
    const safeUnit = Math.max(0, Number(tireUnitCost) || 0);

    const newTireRecord: MhTireStockRecord = {
      id: txId,
      transactionNo: txId,
      date: dateStr,
      time: timeStr,
      transactionType: tireTxType,
      tireSize,
      brand: tireBrand.trim() || "KOMACHI / PIO",
      qty: safeQty,
      unitCost: safeUnit,
      totalCost: safeQty * safeUnit,
      supplierOrInvoice:
        tireTxType === "Inbound" ? tireSupplierOrInvoice.trim() || "-" : undefined,
      vehicleId: tireTxType === "Outbound" ? tireVehicleId || "-" : undefined,
      vehicleNumber: tireTxType === "Outbound" ? tireVehicleId || "-" : undefined,
      wheelPosition: tireTxType === "Outbound" ? tireWheelPosition : undefined,
      operatingHours: tireTxType === "Outbound" ? Number(tireOperatingHours) || 0 : undefined,
      technicianOrReceiver: tireTechnicianName.trim() || "-",
      notes: tireNotes.trim() || undefined,
      updatedAt: `${dateStr} ${timeStr}`,
    };

    setTireRecords((prev) => [newTireRecord, ...prev]);
    setIsTireModalOpen(false);
    setTireNotes("");
    await saveMhTireTransactionToCloud(newTireRecord);

    void appendWmsActivityLog({
      module: "สต๊อกยางโฟล์คลิฟท์",
      sectionId: "fleet_ops",
      reference: txId,
      activity:
        tireTxType === "Inbound"
          ? `รับเข้ายาง ${tireSize} จำนวน ${safeQty} เส้น (${newTireRecord.supplierOrInvoice || "-"})`
          : `เบิกเปลี่ยนยาง ${tireSize} จำนวน ${safeQty} เส้น รถ ${newTireRecord.vehicleId || "-"}`,
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
              onClick={() => {
                setTireTxType("Inbound");
                setIsTireModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
            >
              <ArrowDownLeft size={14} /> + รับเข้ายางใหม่ (Inbound)
            </button>
            <button
              type="button"
              onClick={() => {
                setTireTxType("Outbound");
                setIsTireModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-bold bg-[#087eaf] hover:bg-[#075985] text-white whitespace-nowrap"
            >
              <ArrowUpRight size={14} /> - เบิกเปลี่ยนยาง (Outbound)
            </button>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-b border-slate-200 dark:border-[#1e3a5f]">
          {Array.from(tireStockBySize.entries()).map(([sizeLabel, stats]) => (
            <div
              key={sizeLabel}
              className="p-3 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#0d1b33]"
            >
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
          ))}
        </div>

        <div className="px-5 py-3 border-b border-slate-200 dark:border-[#1e3a5f]">
          <div className="relative max-w-md">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="ค้นหาเลขที่รายการ, ขนาดยาง, ยี่ห้อ, เบอร์รถ, ช่างผู้เบิก..."
              value={tireSearchQuery}
              onChange={(e) => setTireSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#087eaf]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 text-left">
                <th className="py-3 px-4 font-bold">เลขที่รายการ & วัน-เวลา</th>
                <th className="py-3 px-4 font-bold">ประเภท</th>
                <th className="py-3 px-4 font-bold">ขนาดยาง & ยี่ห้อ</th>
                <th className="py-3 px-4 font-bold text-right">จำนวน (เส้น)</th>
                <th className="py-3 px-4 font-bold text-right">ราคา/หน่วย & รวม</th>
                <th className="py-3 px-4 font-bold">รถโฟล์คลิฟท์ / แหล่งที่มา</th>
                <th className="py-3 px-4 font-bold">ผู้รับผิดชอบ / หมายเหตุ</th>
                <th className="py-3 px-4 font-bold text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {filteredTireRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    ยังไม่มีประวัติรายการสต๊อกยางในฐานข้อมูล (mh_tire_stock)
                  </td>
                </tr>
              ) : (
                filteredTireRecords.map((tr) => (
                  <tr
                    key={tr.id}
                    className="hover:bg-slate-50 dark:hover:bg-[#162744]/60 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#087eaf] dark:text-sky-400 tabular-nums">
                        {tr.transactionNo}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {tr.date} · {tr.time}
                      </div>
                    </td>
                    <td className="py-3 px-4">
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
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {tr.tireSize}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        ยี่ห้อ: {tr.brand}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold tabular-nums">
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
                    <td className="py-3 px-4 text-right tabular-nums">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {tr.totalCost.toLocaleString()} บาท
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        @{tr.unitCost.toLocaleString()} บาท
                      </div>
                    </td>
                    <td className="py-3 px-4">
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
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100">
                            {tr.vehicleId || "-"}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {tr.wheelPosition || "-"}
                            {tr.operatingHours ? ` · ${tr.operatingHours} ชม.` : ""}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {tr.technicianOrReceiver}
                      </div>
                      {tr.notes && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {tr.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {confirmDeleteId === tr.id ? (
                        <div className="inline-flex items-center gap-1">
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
        <div className="fixed inset-0 z-[1000] bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex justify-between items-center">
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {tireTxType === "Inbound"
                    ? "+ รับเข้ายางรถโฟล์คลิฟท์ (Tire Stock Inbound)"
                    : "- เบิกเปลี่ยนยางรถโฟล์คลิฟท์ (Tire Stock Outbound)"}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  บันทึกลงฐานข้อมูลแยกอิสระ (mh_tire_stock)
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
              className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs"
            >
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

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ขนาดยาง (Tire Size) *
                </label>
                <select
                  value={tireSize}
                  onChange={(e) => setTireSize(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                >
                  {TIRE_SIZE_OPTIONS.map((sz) => (
                    <option key={sz} value={sz}>
                      {sz}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ยี่ห้อ / รุ่นยาง (Brand) *
                </label>
                <input
                  type="text"
                  value={tireBrand}
                  onChange={(e) => setTireBrand(e.target.value)}
                  placeholder="เช่น KOMACHI, PIO, BRIDGESTONE"
                  required
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  จำนวน (เส้น) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={tireQty}
                  onChange={(e) => setTireQty(Number(e.target.value))}
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
                  onChange={(e) => setTireUnitCost(Number(e.target.value))}
                  required
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              {tireTxType === "Inbound" ? (
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
              ) : (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      รถโฟล์คลิฟท์ที่เปลี่ยนยาง *
                    </label>
                    <select
                      value={tireVehicleId}
                      onChange={(e) => setTireVehicleId(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                    >
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.vehicleId}>
                          {v.vehicleId} - {v.vehicleType} ({v.description})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      ตำแหน่งล้อที่เปลี่ยน *
                    </label>
                    <select
                      value={tireWheelPosition}
                      onChange={(e) => setTireWheelPosition(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                    >
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
                      onChange={(e) => setTireOperatingHours(Number(e.target.value))}
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

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  หมายเหตุ
                </label>
                <input
                  type="text"
                  value={tireNotes}
                  onChange={(e) => setTireNotes(e.target.value)}
                  placeholder="รายละเอียดเพิ่มเติม..."
                  className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-[#1e3a5f]">
                <button
                  type="button"
                  onClick={() => setIsTireModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 dark:border-[#1e3a5f] font-semibold"
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
