/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  DoorOpen,
  Edit3,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  MhDeliveryPointRecord,
  deleteMhDeliveryPointFromCloud,
  extractUniqueDeliveryPointNames,
  loadCachedMhDeliveryPoints,
  saveMhDeliveryPointToCloud,
  saveMhDeliveryPointsBatchToCloud,
  subscribeToMhDeliveryPoints,
} from "../services/forkliftDataService";
import { appendWmsActivityLog } from "../services/authWorkforceService";

interface DeliveryPointsManagementProps {
  onNavigateToTransport?: () => void;
}

const STARTER_DELIVERY_POINTS: Array<{ deliveryPoint: string; gate: string }> = [
  { deliveryPoint: "อาคาร A", gate: "ประตู A1" },
  { deliveryPoint: "อาคาร A", gate: "ประตู A2" },
  { deliveryPoint: "อาคาร B", gate: "ประตู B1" },
  { deliveryPoint: "อาคาร C", gate: "ประตู C1" },
  { deliveryPoint: "ลานพักสินค้า", gate: "-" },
];

export function DeliveryPointsManagement({
  onNavigateToTransport,
}: DeliveryPointsManagementProps) {
  const [points, setPoints] = useState<MhDeliveryPointRecord[]>(() =>
    loadCachedMhDeliveryPoints()
  );
  const [deliveryPointInput, setDeliveryPointInput] = useState<string>("");
  const [gateInput, setGateInput] = useState<string>("");
  const [editingRecord, setEditingRecord] = useState<MhDeliveryPointRecord | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    const unsub = subscribeToMhDeliveryPoints((cloudPoints) => {
      setPoints(cloudPoints);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const uniqueDeliveryPoints = useMemo(
    () => extractUniqueDeliveryPointNames(points),
    [points]
  );

  const filteredPoints = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return points;
    return points.filter(
      (p) =>
        p.deliveryPoint.toLowerCase().includes(q) ||
        p.gate.toLowerCase().includes(q)
    );
  }, [points, searchQuery]);

  const resetForm = () => {
    setDeliveryPointInput("");
    setGateInput("");
    setEditingRecord(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPoint = deliveryPointInput.trim();
    const cleanGate = gateInput.trim() || "-";

    if (!cleanPoint) {
      setFeedback({ text: "กรุณาระบุชื่อจุดส่งสินค้า / อาคาร", type: "error" });
      return;
    }

    const isDuplicate = points.some(
      (p) =>
        p.id !== editingRecord?.id &&
        p.deliveryPoint.trim().toLowerCase() === cleanPoint.toLowerCase() &&
        p.gate.trim().toLowerCase() === cleanGate.toLowerCase()
    );
    if (isDuplicate) {
      setFeedback({
        text: `จุดส่งสินค้า "${cleanPoint}" (${cleanGate}) มีอยู่ในรายการแล้ว`,
        type: "error",
      });
      return;
    }

    setIsSaving(true);
    try {
      const ok = await saveMhDeliveryPointToCloud({
        id: editingRecord?.id,
        deliveryPoint: cleanPoint,
        gate: cleanGate,
        createdAt: editingRecord?.createdAt,
      });

      if (!ok) {
        setFeedback({
          text: "บันทึกข้อมูลลงเครื่องแล้ว (กำลังรอเชื่อมต่อ Cloud)",
          type: "success",
        });
      } else {
        setFeedback({
          text: editingRecord
            ? `แก้ไขจุดส่งสินค้า "${cleanPoint} (${cleanGate})" เรียบร้อย`
            : `เพิ่มจุดส่งสินค้า "${cleanPoint} (${cleanGate})" เรียบร้อย`,
          type: "success",
        });
      }

      // Optimistically reflect local cache immediately
      setPoints(loadCachedMhDeliveryPoints());

      void appendWmsActivityLog({
        module: "Delivery Points",
        sectionId: "fleet_ops",
        reference: cleanPoint,
        activity: editingRecord
          ? `แก้ไขจุดส่งสินค้า: ${cleanPoint} · ${cleanGate}`
          : `เพิ่มจุดส่งสินค้า: ${cleanPoint} · ${cleanGate}`,
        status: "Completed",
      });

      resetForm();
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (record: MhDeliveryPointRecord) => {
    setEditingRecord(record);
    setDeliveryPointInput(record.deliveryPoint);
    setGateInput(record.gate === "-" ? "" : record.gate);
    setConfirmDeleteId(null);
  };

  const handleDelete = async (record: MhDeliveryPointRecord) => {
    await deleteMhDeliveryPointFromCloud(record.id);
    setPoints(loadCachedMhDeliveryPoints());
    setConfirmDeleteId(null);
    if (editingRecord?.id === record.id) {
      resetForm();
    }
    setFeedback({
      text: `ลบจุดส่งสินค้า "${record.deliveryPoint} (${record.gate})" เรียบร้อย`,
      type: "success",
    });

    void appendWmsActivityLog({
      module: "Delivery Points",
      sectionId: "fleet_ops",
      reference: record.deliveryPoint,
      activity: `ลบจุดส่งสินค้า: ${record.deliveryPoint} · ${record.gate}`,
      status: "Completed",
    });
  };

  const handleSeedStarterPoints = async () => {
    setIsSaving(true);
    try {
      await saveMhDeliveryPointsBatchToCloud(STARTER_DELIVERY_POINTS);
      setPoints(loadCachedMhDeliveryPoints());
      setFeedback({
        text: "เพิ่มจุดส่งสินค้าตัวอย่างเรียบร้อยแล้ว",
        type: "success",
      });
      void appendWmsActivityLog({
        module: "Delivery Points",
        sectionId: "fleet_ops",
        reference: "STARTER",
        activity: `เพิ่มจุดส่งสินค้าเริ่มต้น ${STARTER_DELIVERY_POINTS.length} รายการ`,
        status: "Completed",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Feedback Toast */}
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-semibold ${
            feedback.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle size={15} className="shrink-0 text-rose-600 dark:text-rose-400" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="opacity-70 hover:opacity-100"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Header + Quick Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <MapPin size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
              กำหนดจุดส่งสินค้าและประตู (Delivery Points & Gates)
            </h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              รายชื่อในคอลัมน์ "จุดส่งสินค้า" จะถูกดึงไปใช้เป็นตัวเลือก ต้นทาง และ ปลายทาง ในฟอร์มบันทึกงานย้ายสินค้าอัตโนมัติ
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-200">
            จุดส่งสินค้า: <strong className="font-mono text-sky-600 dark:text-sky-400">{uniqueDeliveryPoints.length}</strong>{" "}
            · ประตูทั้งหมด: <strong className="font-mono">{points.length}</strong>
          </div>
          {onNavigateToTransport && (
            <button
              type="button"
              onClick={onNavigateToTransport}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-300 bg-sky-50 px-3 text-xs font-bold text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60"
            >
              <span>ไปหน้าบันทึกงานย้ายสินค้า</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Add / Edit Form Card */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1e3a5f] dark:bg-[#111e38]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
            <Plus size={15} className="text-sky-600 dark:text-sky-400" />
            <span>
              {editingRecord
                ? `แก้ไขข้อมูล: ${editingRecord.deliveryPoint} (${editingRecord.gate})`
                : "เพิ่มจุดส่งสินค้า / อาคาร และประตู"}
            </span>
          </div>
          {editingRecord && (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <X size={13} />
              <span>ยกเลิกการแก้ไข</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
          <div className="sm:col-span-5">
            <label
              htmlFor="dp-name-input"
              className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"
            >
              <Building2 size={13} className="text-sky-600 dark:text-sky-400" />
              <span>จุดส่งสินค้า *</span>
            </label>
            <input
              id="dp-name-input"
              type="text"
              value={deliveryPointInput}
              onChange={(e) => setDeliveryPointInput(e.target.value)}
              placeholder="เช่น อาคาร A, อาคาร B, ลานพักสินค้า"
              list="existing-delivery-points-list"
              required
              className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-900 outline-none focus:border-sky-600 focus:bg-white sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
            />
            <datalist id="existing-delivery-points-list">
              {uniqueDeliveryPoints.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="sm:col-span-4">
            <label
              htmlFor="dp-gate-input"
              className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"
            >
              <DoorOpen size={13} className="text-emerald-600 dark:text-emerald-400" />
              <span>ประตู</span>
            </label>
            <input
              id="dp-gate-input"
              type="text"
              value={gateInput}
              onChange={(e) => setGateInput(e.target.value)}
              placeholder="เช่น ประตู A2, ประตู B1"
              className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-600 focus:bg-white sm:text-sm dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-100"
            />
          </div>

          <div className="sm:col-span-3 flex gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-600 px-4 text-xs font-bold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              <Plus size={14} />
              <span>{editingRecord ? "บันทึกการแก้ไข" : "เพิ่มจุดส่งสินค้า"}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Delivery Points Table Panel */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#111e38]">
        <div className="filterbar flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-[18px] sm:py-3 dark:border-[#1e3a5f]">
          <div className="text-xs font-bold text-slate-800 dark:text-slate-100 sm:text-sm">
            ตารางกำหนดจุดส่งสินค้าและประตู ({filteredPoints.length})
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {points.length === 0 && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSeedStarterPoints}
                className="inline-flex h-[35px] items-center gap-1.5 whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <Sparkles size={13} />
                <span>เพิ่มจุดตัวอย่างเริ่มต้น</span>
              </button>
            )}

            <div className="relative min-w-[200px]">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาจุดส่งสินค้า / ประตู..."
                className="field w-full rounded-md border border-slate-300 bg-white font-normal text-slate-900 outline-none focus:border-sky-500 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-300">
                <th className="whitespace-nowrap px-4 py-2.5">จุดส่งสินค้า</th>
                <th className="whitespace-nowrap px-4 py-2.5">ประตู</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {filteredPoints.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    {points.length === 0
                      ? 'ยังไม่มีข้อมูลจุดส่งสินค้า — กรุณาเพิ่มด้านบน หรือกด "เพิ่มจุดตัวอย่างเริ่มต้น"'
                      : "ไม่พบรายการจุดส่งสินค้าที่ตรงกับคำค้นหา"}
                  </td>
                </tr>
              ) : (
                filteredPoints.map((row) => {
                  const isConfirmingDelete = confirmDeleteId === row.id;
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-[#162749]/40"
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-bold text-slate-900 dark:text-slate-100">
                        <span className="inline-flex items-center gap-2">
                          <Building2
                            size={14}
                            className="shrink-0 text-sky-600 dark:text-sky-400"
                          />
                          <span>{row.deliveryPoint}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                        <span className="inline-flex items-center gap-1.5">
                          <DoorOpen
                            size={14}
                            className="shrink-0 text-emerald-600 dark:text-emerald-400"
                          />
                          <span>{row.gate}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditClick(row)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-200 dark:hover:bg-[#162749]"
                          >
                            <Edit3 size={12} />
                            <span>แก้ไข</span>
                          </button>

                          {isConfirmingDelete ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDelete(row)}
                                className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-rose-700"
                              >
                                <Trash2 size={12} />
                                <span>ยืนยันลบ</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 dark:border-[#2c4a75] dark:bg-[#0c162c] dark:text-slate-300"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(row.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
                            >
                              <Trash2 size={12} />
                              <span>ลบ</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
