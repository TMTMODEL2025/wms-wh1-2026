import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Printer,
  X,
  Scale,
  Truck,
  CheckSquare,
  Square,
  Eye,
  Edit3,
  Calendar,
  Clock,
  FileText,
  AlertCircle,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { TmtRecheckVehicleGroup } from "./TmtRecheckView";

export interface DoWeightTicketData {
  doNo: string;
  customerName: string;
  vehicleId: string;
  ticketNo: string;
  productName: string;
  netWeightKg: number;
  inDate: string;
  inTime: string;
  outDate: string;
  outTime: string;
  selectedForPrint: boolean;
  materialsSummary?: string;
  hasSlit?: boolean;
  hasScrap?: boolean;
}

export interface WeightTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeVehicles: TmtRecheckVehicleGroup[];
  completedReports: TmtRecheckVehicleGroup[];
  initialVehicleId?: string | null;
}

// Helper: Format current date in Thai Buddhist Era (e.g. 12/11/2569)
export function getThaiBuddhistDateFormatted(date = new Date()): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = String(date.getFullYear() + 543);
  return `${d}/${m}/${y}`;
}

// Helper: Format current time HH:mm:ss (e.g. 14:04:04)
export function getCurrentTimeFormatted(date = new Date()): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${min}:${s}`;
}

// Helper: Generate default ticket number: Day (2) + Month (2) + Running (4) e.g. 12110006
export function generateDefaultTicketNo(index = 1, date = new Date()): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const run = String(index).padStart(4, "0");
  return `${d}${m}${run}`;
}

/**
 * Helper: Determine default "สินค้า :" based on all items/batches in a DO or vehicle:
 * - Slit steel (hasSlit): Material contains "2SLIT" or "4SLIT" or "SLIT" OR Description contains "เหล็กม้วนสลิต" / "สลิต"
 * - Scrap (hasScrap): Material contains "SCRAP-W" or "2SCRAP-W" or "4SCRAP-W" or "SCRAP" OR Description contains "เศษคืนลูกค้า" / "เศษ"
 *
 * Rules:
 * - Condition 1: Both Slit and Scrap (2SLIT/4SLIT and SCRAP-W) -> "เหล็กม้วนสลิต+เศษคืนลูกค้า"
 * - Condition 2: Only Slit (2SLIT/4SLIT without scrap) -> "เหล็กม้วนสลิต"
 * - Condition 3: Only Scrap (SCRAP-W without slit) -> "เศษคืนลูกค้า"
 */
export function determineDoProductName(
  items: { material?: string; description?: string }[],
  fallbackItems?: { material?: string; description?: string }[]
): {
  productName: string;
  hasSlit: boolean;
  hasScrap: boolean;
  materialsList: string[];
} {
  const itemsToCheck =
    items && items.length > 0
      ? items
      : fallbackItems && fallbackItems.length > 0
      ? fallbackItems
      : [];

  if (itemsToCheck.length === 0) {
    return {
      productName: "เหล็กม้วนสลิต",
      hasSlit: true,
      hasScrap: false,
      materialsList: ["2SLIT"],
    };
  }

  let hasSlit = false;
  let hasScrap = false;
  const rawMaterialsSet = new Set<string>();

  for (const item of itemsToCheck) {
    const rawMat = (item.material || "").trim();
    const mat = rawMat.toUpperCase();
    const desc = (item.description || "").trim();
    const descUpper = desc.toUpperCase();

    if (rawMat) {
      rawMaterialsSet.add(rawMat);
    }

    // Check Slit: 2SLIT or 4SLIT or SLIT in material OR เหล็กม้วนสลิต/สลิต in description
    const isSlit =
      mat.includes("2SLIT") ||
      mat.includes("4SLIT") ||
      mat.includes("SLIT") ||
      desc.includes("เหล็กม้วนสลิต") ||
      desc.includes("เหล็กม้วนสิลต") ||
      desc.includes("สลิต") ||
      desc.includes("สิลต") ||
      descUpper.includes("SLIT");

    // Check Scrap: SCRAP-W, 2SCRAP-W, 4SCRAP-W, SCRAP in material OR เศษคืนลูกค้า/เศษ in description
    const isScrap =
      mat.includes("SCRAP-W") ||
      mat.includes("2SCRAP-W") ||
      mat.includes("4SCRAP-W") ||
      mat.includes("SCRAP") ||
      desc.includes("เศษคืนลูกค้า") ||
      desc.includes("เศษ") ||
      descUpper.includes("SCRAP");

    if (isSlit) hasSlit = true;
    if (isScrap) hasScrap = true;
  }

  let productName = "เหล็กม้วนสลิต";
  // Condition 1: Both Slit and Scrap (e.g. 2SLIT/4SLIT and SCRAP-W)
  if (hasSlit && hasScrap) {
    productName = "เหล็กม้วนสลิต+เศษคืนลูกค้า";
  }
  // Condition 2: Only Slit (2SLIT หรือ 4SLIT)
  else if (hasSlit) {
    productName = "เหล็กม้วนสลิต";
  }
  // Condition 3: Only Scrap (SCRAP-W หรือ เศษ)
  else if (hasScrap) {
    productName = "เศษคืนลูกค้า";
  }

  return {
    productName,
    hasSlit,
    hasScrap,
    materialsList: Array.from(rawMaterialsSet),
  };
}

export const WeightTicketModal: React.FC<WeightTicketModalProps> = ({
  isOpen,
  onClose,
  activeVehicles,
  completedReports,
  initialVehicleId,
}) => {
  // Combine unique vehicles from active queue and completed reports
  const allVehicles = useMemo(() => {
    const map = new Map<string, TmtRecheckVehicleGroup>();
    // Completed reports first, then active vehicles
    activeVehicles.forEach((v) => {
      if (v.vehicleId) map.set(v.vehicleId, v);
    });
    completedReports.forEach((v) => {
      if (v.vehicleId && !map.has(v.vehicleId)) map.set(v.vehicleId, v);
    });
    return Array.from(map.values());
  }, [activeVehicles, completedReports]);

  // Selected vehicle state
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");

  // DO ticket items for the selected vehicle
  const [tickets, setTickets] = useState<DoWeightTicketData[]>([]);

  // View mode inside modal: "edit" or "preview"
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");

  // Tickets queued for actual printing
  const [printQueue, setPrintQueue] = useState<DoWeightTicketData[]>([]);

  // Initialize selected vehicle when modal opens or initialVehicleId changes
  useEffect(() => {
    if (isOpen) {
      if (initialVehicleId && allVehicles.some((v) => v.vehicleId === initialVehicleId)) {
        setSelectedVehicleId(initialVehicleId);
      } else if (allVehicles.length > 0) {
        setSelectedVehicleId(allVehicles[0].vehicleId);
      } else {
        setSelectedVehicleId("");
      }
      setViewMode("edit");
    }
  }, [isOpen, initialVehicleId, allVehicles]);

  // When selected vehicle changes, generate DO ticket list
  useEffect(() => {
    if (!selectedVehicleId) {
      setTickets([]);
      return;
    }

    const vehicle = allVehicles.find((v) => v.vehicleId === selectedVehicleId);
    if (!vehicle) {
      setTickets([]);
      return;
    }

    const defaultDate = getThaiBuddhistDateFormatted();
    const defaultTime = getCurrentTimeFormatted();

    // Group items by DO number
    const doMap = new Map<
      string,
      {
        customerName: string;
        totalWeight: number;
        itemsCount: number;
        items: any[];
      }
    >();

    (vehicle.items || []).forEach((item) => {
      const doNo = item.doNo ? item.doNo.trim() : "DO-ไม่ระบุ";
      const existing = doMap.get(doNo) || {
        customerName: item.customerName || vehicle.customerNames[0] || "ไม่ระบุชื่อลูกค้า",
        totalWeight: 0,
        itemsCount: 0,
        items: [],
      };
      existing.totalWeight += item.grossWeight || 0;
      existing.itemsCount += 1;
      existing.items.push(item);
      if (item.customerName && existing.customerName === "ไม่ระบุชื่อลูกค้า") {
        existing.customerName = item.customerName;
      }
      doMap.set(doNo, existing);
    });

    // If no items in vehicle.items but vehicle.doNumbers exists
    if (doMap.size === 0 && Array.isArray(vehicle.doNumbers) && vehicle.doNumbers.length > 0) {
      vehicle.doNumbers.forEach((doNo) => {
        doMap.set(doNo, {
          customerName: vehicle.customerNames[0] || "ไม่ระบุชื่อลูกค้า",
          totalWeight: vehicle.totalGrossWeight || 0,
          itemsCount: 1,
          items: [],
        });
      });
    }

    const isSingleDoVehicle = doMap.size === 1 || (vehicle.doNumbers && vehicle.doNumbers.length === 1);

    const generatedTickets: DoWeightTicketData[] = Array.from(doMap.entries()).map(
      ([doNo, data], idx) => {
        // When vehicle has 1 DO, all vehicle items belong to this vehicle/DO
        const itemsToEvaluate =
          isSingleDoVehicle && vehicle.items && vehicle.items.length > 0
            ? vehicle.items
            : (data.items && data.items.length > 0 ? data.items : (vehicle.items || []));

        const { productName, materialsList, hasSlit, hasScrap } = determineDoProductName(
          itemsToEvaluate,
          vehicle.items
        );
        return {
          doNo,
          customerName: data.customerName,
          vehicleId: vehicle.vehicleId,
          ticketNo: generateDefaultTicketNo(idx + 1),
          productName,
          netWeightKg: data.totalWeight,
          inDate: defaultDate,
          inTime: defaultTime,
          outDate: defaultDate,
          outTime: defaultTime,
          selectedForPrint: true,
          materialsSummary: materialsList.length > 0 ? materialsList.join(", ") : undefined,
          hasSlit,
          hasScrap,
        };
      }
    );

    setTickets(generatedTickets);
  }, [selectedVehicleId, allVehicles]);

  // Update a single ticket field
  const handleUpdateTicketField = (
    index: number,
    field: keyof DoWeightTicketData,
    value: any
  ) => {
    setTickets((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // Toggle selection for all DO tickets
  const handleToggleSelectAll = () => {
    const allSelected = tickets.every((t) => t.selectedForPrint);
    setTickets((prev) => prev.map((t) => ({ ...t, selectedForPrint: !allSelected })));
  };

  // Execute print for specified tickets
  const handleExecutePrint = (ticketsToPrint: DoWeightTicketData[]) => {
    if (ticketsToPrint.length === 0) {
      alert("กรุณาเลือก DO ที่ต้องการพิมพ์อย่างน้อย 1 รายการ");
      return;
    }

    setPrintQueue(ticketsToPrint);

    // Give React time to render portal before calling window.print()
    setTimeout(() => {
      document.body.classList.add("printing-weight-ticket");
      window.print();

      const cleanup = () => {
        document.body.classList.remove("printing-weight-ticket");
        window.removeEventListener("afterprint", cleanup);
      };

      window.addEventListener("afterprint", cleanup);

      // Fallback timer if afterprint doesn't fire
      setTimeout(() => {
        document.body.classList.remove("printing-weight-ticket");
      }, 2000);
    }, 150);
  };

  if (!isOpen) return null;

  const selectedCount = tickets.filter((t) => t.selectedForPrint).length;
  const currentVehicle = allVehicles.find((v) => v.vehicleId === selectedVehicleId);

  return (
    <>
      {/* ========================================================================= */}
      {/* On-Screen Modal Dialog */}
      {/* ========================================================================= */}
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
        <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-fade-in font-sans">
          {/* Modal Header */}
          <div className="bg-slate-950 p-3.5 sm:px-5 border-b border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <Scale size={20} />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  <span>พิมพ์บัตรชั่งน้ำหนัก (แยกตาม DO)</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  แบบฟอร์มใบชั่งน้ำหนักมาตรฐาน บมจ. ทีเอ็มที สตีล สาขาวังน้อย
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-3.5 sm:p-5 overflow-y-auto flex-1 space-y-4">
            {/* Step 1: Vehicle Selector */}
            <div className="bg-slate-950/80 p-3 sm:p-4 rounded-xl border border-slate-800 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Truck size={14} className="text-cyan-400" />
                  <span>1. เลือกทะเบียนรถ:</span>
                </label>

                {currentVehicle && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-300">
                    <span className="bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded border border-cyan-800/80">
                      DO: {tickets.length} รายการ
                    </span>
                    <span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded border border-slate-700">
                      รวม: {tickets.reduce((s, t) => s + (Number(t.netWeightKg) || 0), 0).toLocaleString()} กก.
                    </span>
                  </div>
                )}
              </div>

              {allVehicles.length === 0 ? (
                <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs flex items-center gap-2">
                  <AlertCircle size={15} />
                  <span>ยังไม่มีข้อมูลทะเบียนรถในระบบ กรุณานำเข้าข้อมูล SAP ในหน้าออฟฟิศก่อน</span>
                </div>
              ) : (
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold focus:outline-none focus:border-cyan-500 transition-all"
                >
                  {allVehicles.map((v) => {
                    const custStr = v.customerNames.join(", ") || "ไม่ระบุชื่อลูกค้า";
                    const doCount = (v.doNumbers && v.doNumbers.length) || (v.items ? new Set(v.items.map((i) => i.doNo)).size : 1);
                    return (
                      <option key={v.vehicleId} value={v.vehicleId}>
                        {v.vehicleId} — ลูกค้า: {custStr} ({doCount} DO | {v.totalGrossWeight.toLocaleString()} kg)
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {/* Step 2: DO Tickets List or Preview */}
            {selectedVehicleId && tickets.length > 0 && (
              <div className="space-y-3">
                {/* Mode Selector & Bulk Select Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5 bg-slate-800 hover:bg-slate-750 px-2.5 py-1.5 rounded-lg border border-slate-700 font-medium transition-all"
                    >
                      {tickets.every((t) => t.selectedForPrint) ? (
                        <>
                          <CheckSquare size={14} className="text-cyan-400" />
                          <span>ไม่เลือกทั้งหมด</span>
                        </>
                      ) : (
                        <>
                          <Square size={14} className="text-slate-400" />
                          <span>เลือกทั้งหมด ({tickets.length} DO)</span>
                        </>
                      )}
                    </button>
                    <span className="text-xs text-slate-400 font-mono">
                      (เลือกแล้ว {selectedCount}/{tickets.length})
                    </span>
                  </div>

                  {/* Edit vs Preview Tabs */}
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => setViewMode("edit")}
                      className={`px-3 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-all ${
                        viewMode === "edit"
                          ? "bg-cyan-500 text-slate-950 font-bold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <Edit3 size={13} />
                      <span>กรอก/แก้ไขข้อมูล</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`px-3 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-all ${
                        viewMode === "preview"
                          ? "bg-cyan-500 text-slate-950 font-bold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <Eye size={13} />
                      <span>ตัวอย่างก่อนพิมพ์ (Preview)</span>
                    </button>
                  </div>
                </div>

                {/* VIEW MODE: EDIT */}
                {viewMode === "edit" && (
                  <div className="space-y-3">
                    {tickets.map((ticket, idx) => (
                      <div
                        key={ticket.doNo}
                        className={`p-3.5 rounded-xl border transition-all space-y-3 ${
                          ticket.selectedForPrint
                            ? "bg-slate-950/70 border-cyan-800/80 shadow-xs"
                            : "bg-slate-950/30 border-slate-800 opacity-70"
                        }`}
                      >
                        {/* DO Card Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={ticket.selectedForPrint}
                                onChange={(e) =>
                                  handleUpdateTicketField(idx, "selectedForPrint", e.target.checked)
                                }
                                className="w-4 h-4 rounded text-cyan-500 bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer"
                              />
                              <span className="font-mono font-bold text-white text-xs sm:text-sm">
                                DO NO. {ticket.doNo}
                              </span>
                              <span className="text-[11px] text-cyan-300 font-medium">
                                ({ticket.customerName})
                              </span>
                            </label>

                            {ticket.materialsSummary && (
                              <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700 font-mono">
                                Mat: {ticket.materialsSummary}
                              </span>
                            )}

                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
                                ticket.hasSlit && ticket.hasScrap
                                  ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                                  : ticket.hasSlit
                                  ? "bg-cyan-950 text-cyan-300 border-cyan-800"
                                  : "bg-amber-950 text-amber-300 border-amber-800"
                              }`}
                            >
                              {ticket.productName}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleExecutePrint([ticket])}
                            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95"
                          >
                            <Printer size={12} />
                            <span>พิมพ์ใบนี้</span>
                          </button>
                        </div>

                        {/* Editable Form Inputs Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
                          {/* 1. น้ำหนักสุทธิ */}
                          <div className="space-y-1">
                            <label className="text-slate-400 font-medium">
                              น้ำหนักสุทธิ (กก.) *
                            </label>
                            <input
                              type="number"
                              value={ticket.netWeightKg}
                              onChange={(e) =>
                                handleUpdateTicketField(idx, "netWeightKg", Number(e.target.value) || 0)
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-500"
                            />
                          </div>

                          {/* 2. เลขที่บัตร */}
                          <div className="space-y-1">
                            <label className="text-slate-400 font-medium">
                              เลขที่บัตร *
                            </label>
                            <input
                              type="text"
                              value={ticket.ticketNo}
                              onChange={(e) =>
                                handleUpdateTicketField(idx, "ticketNo", e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          {/* 3. สินค้า */}
                          <div className="space-y-1 md:col-span-2">
                            <div className="flex items-center justify-between">
                              <label className="text-slate-400 font-medium">
                                สินค้า *
                              </label>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateTicketField(idx, "productName", "เหล็กม้วนสลิต")}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                    ticket.productName === "เหล็กม้วนสลิต"
                                      ? "bg-cyan-500 text-slate-950 font-bold"
                                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                  }`}
                                  title="เหล็กม้วนสลิต (2SLIT / 4SLIT)"
                                >
                                  สลิต
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateTicketField(idx, "productName", "เศษคืนลูกค้า")}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                    ticket.productName === "เศษคืนลูกค้า"
                                      ? "bg-amber-500 text-slate-950 font-bold"
                                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                  }`}
                                  title="เศษคืนลูกค้า (2SCRAP-W)"
                                >
                                  เศษ
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateTicketField(idx, "productName", "เหล็กม้วนสลิต+เศษคืนลูกค้า")}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                    ticket.productName === "เหล็กม้วนสลิต+เศษคืนลูกค้า"
                                      ? "bg-emerald-500 text-slate-950 font-bold"
                                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                  }`}
                                  title="เหล็กม้วนสลิต+เศษคืนลูกค้า (มีทั้งสลิตและเศษ)"
                                >
                                  สลิต+เศษ
                                </button>
                              </div>
                            </div>
                            <input
                              type="text"
                              value={ticket.productName}
                              onChange={(e) =>
                                handleUpdateTicketField(idx, "productName", e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          {/* 4. วันที่ชั่งเข้า */}
                          <div className="space-y-1">
                            <label className="text-slate-400 font-medium">
                              วันที่ชั่งเข้า
                            </label>
                            <input
                              type="text"
                              value={ticket.inDate}
                              onChange={(e) =>
                                handleUpdateTicketField(idx, "inDate", e.target.value)
                              }
                              placeholder="วว/ดด/ปปปป"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          {/* 5. เวลาชั่งเข้า */}
                          <div className="space-y-1">
                            <label className="text-slate-400 font-medium">
                              เวลาชั่งเข้า
                            </label>
                            <input
                              type="text"
                              value={ticket.inTime}
                              onChange={(e) =>
                                handleUpdateTicketField(idx, "inTime", e.target.value)
                              }
                              placeholder="HH:mm:ss"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          {/* 6. วันที่ชั่งออก */}
                          <div className="space-y-1">
                            <label className="text-slate-400 font-medium">
                              วันที่ชั่งออก
                            </label>
                            <input
                              type="text"
                              value={ticket.outDate}
                              onChange={(e) =>
                                handleUpdateTicketField(idx, "outDate", e.target.value)
                              }
                              placeholder="วว/ดด/ปปปป"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          {/* 7. เวลาชั่งออก */}
                          <div className="space-y-1">
                            <label className="text-slate-400 font-medium">
                              เวลาชั่งออก
                            </label>
                            <input
                              type="text"
                              value={ticket.outTime}
                              onChange={(e) =>
                                handleUpdateTicketField(idx, "outTime", e.target.value)
                              }
                              placeholder="HH:mm:ss"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* VIEW MODE: PREVIEW */}
                {viewMode === "preview" && (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-400 text-center font-medium">
                      แสดงตัวอย่างแบบฟอร์มใบชั่งน้ำหนัก ({tickets.filter((t) => t.selectedForPrint).length} ใบที่เลือก)
                    </p>

                    <div className="space-y-6 max-h-[60vh] overflow-y-auto p-2">
                      {tickets
                        .filter((t) => t.selectedForPrint)
                        .map((ticket) => (
                          <div
                            key={ticket.doNo}
                            className="bg-white rounded-lg shadow-xl p-4 max-w-2xl mx-auto border border-slate-300"
                          >
                            <WeightTicketSlipContent ticket={ticket} />
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modal Footer Bar */}
          <div className="bg-slate-950 p-3.5 sm:px-5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-400 font-mono">
              {currentVehicle && (
                <span>
                  ทะเบียน: <strong className="text-cyan-300">{currentVehicle.vehicleId}</strong> | เลือกพิมพ์{" "}
                  <strong className="text-amber-300">{selectedCount}</strong> จาก {tickets.length} DO
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold transition-colors"
              >
                ปิดหน้าต่าง
              </button>

              <button
                type="button"
                onClick={() => handleExecutePrint(tickets.filter((t) => t.selectedForPrint))}
                disabled={selectedCount === 0}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              >
                <Printer size={15} />
                <span>พิมพ์บัตรชั่งที่เลือก ({selectedCount} ใบ)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* Printable Element Portal (Rendered strictly for print mode) */}
      {/* ========================================================================= */}
      {typeof document !== "undefined" &&
        createPortal(
          <div id="tmt-weight-ticket-print-portal" className="hidden print:block">
            {printQueue.map((ticket) => (
              <div
                key={ticket.doNo}
                className="weight-ticket-print-sheet"
              >
                <WeightTicketSlipContent ticket={ticket} />
              </div>
            ))}
          </div>,
          document.body
        )}

      {/* Exact Print Styles for 5.5in x 9.5in continuous form */}
      <style>{`
        @media print {
          @page {
            size: 5.5in 9.5in;
            margin: 0.05in;
          }
          body {
            visibility: hidden;
            background: transparent !important;
          }
          #tmt-weight-ticket-print-portal,
          #tmt-weight-ticket-print-portal * {
            visibility: visible;
          }
          #tmt-weight-ticket-print-portal {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            display: block !important;
            background: #ffffff !important;
          }
          .weight-ticket-print-sheet {
            page-break-after: always;
            break-after: page;
            width: 100% !important;
          }
          #printable-area {
            width: 100% !important;
            padding: 8px 4px !important;
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'Angsana New', 'Cordia New', serif !important;
            line-height: 1.25 !important;
          }
        }
      `}</style>
    </>
  );
};

// ============================================================================
// Exact Layout Subcomponent for the TMT Weight Ticket Slip (100% Spec Match)
// ============================================================================
export const WeightTicketSlipContent: React.FC<{ ticket: DoWeightTicketData }> = ({
  ticket,
}) => {
  return (
    <div
      id="printable-area"
      className="w-full text-black px-1 py-2 bg-white select-text leading-tight"
      style={{
        fontFamily: "'Angsana New', 'Cordia New', serif",
        lineHeight: 1.25,
      }}
    >
      {/* 1. Header (Centered) */}
      <div className="text-center pb-1">
        <h1 className="text-[35px] font-extrabold text-center tracking-tight leading-tight">
          บริษัท ทีเอ็มที สตีล จำกัด (มหาชน)
        </h1>
        <p className="text-[19px] font-normal text-center leading-tight">
          สาขาวังน้อย : 332-333 หมู่ที่5 ถนนพหลโยธิน ต.ลำไทร อ.วังน้อย พระนครศรีอยุธยา 13170
        </p>
        <div className="mt-2">
          <h2 className="text-[25px] font-bold text-center leading-tight">
            ใบชั่งน้ำหนัก
          </h2>
        </div>
      </div>

      {/* 2. Upper General Information (.row.default 2 Columns) */}
      <div className="grid grid-cols-2 gap-x-4 mt-2 text-[24px]">
        {/* Left Column */}
        <div className="space-y-1">
          <div className="flex items-center">
            <span className="whitespace-nowrap">เลขที่บัตร</span>
            <span className="px-1">:</span>
            <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
              {ticket.ticketNo}
            </span>
          </div>
          <div className="flex items-center">
            <span className="whitespace-nowrap">ทะเบียนรถ</span>
            <span className="px-1">:</span>
            <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
              {ticket.vehicleId}
            </span>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-1">
          <div className="flex items-center">
            <span className="whitespace-nowrap">คู่ค้า</span>
            <span className="px-1">:</span>
            <span
              className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis"
              title={ticket.customerName}
            >
              {ticket.customerName}
            </span>
          </div>
          <div className="flex items-center">
            <span className="whitespace-nowrap">สินค้า</span>
            <span className="px-1">:</span>
            <span
              className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis"
              title={ticket.productName}
            >
              {ticket.productName}
            </span>
          </div>
        </div>
      </div>

      {/* Dashed Line 1 */}
      <hr className="border-t border-dashed border-black my-2" />

      {/* 3. Table Column Headers 2 Sides (Bold, Centered) */}
      <div className="grid grid-cols-2 gap-x-6 text-[24px] font-bold text-center">
        <div>รถเข้า</div>
        <div>รถออก</div>
      </div>

      {/* Dashed Line 2 */}
      <hr className="border-t border-dashed border-black my-2" />

      {/* 4. Weighing Details (2 Columns Left - Right with .row.tight) */}
      <div className="grid grid-cols-2 gap-x-6 text-[24px] font-normal">
        {/* Left Side: รถเข้า */}
        <div className="space-y-1">
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">วันที่ชั่งเข้า</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">{ticket.inDate || "-"}</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">เวลาชั่งเข้า</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">{ticket.inTime || "-"}</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">น้ำหนักรถเข้า</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">- กก.</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">น้ำหนักตามบิล</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">- กก.</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">น้ำหนักต่าง</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">- กก.</span>
          </div>
        </div>

        {/* Right Side: รถออก */}
        <div className="space-y-1">
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">วันที่ชั่งออก</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">{ticket.outDate || "-"}</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">เวลาชั่งออก</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">{ticket.outTime || "-"}</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">น้ำหนักรถเข้า</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">- กก.</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">น้ำหนักรถออก</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">- กก.</span>
          </div>
          <div className="flex items-center">
            <span className="w-[115px] whitespace-nowrap shrink-0">น้ำหนักสุทธิ</span>
            <span className="w-[10px] text-center shrink-0">:</span>
            <span className="pl-[28px] flex-1">
              {(Number(ticket.netWeightKg) || 0).toLocaleString()} กก.
            </span>
          </div>
        </div>
      </div>

      {/* Dashed Line 3 */}
      <hr className="border-t border-dashed border-black my-2" />

      {/* 5. หมายเหตุ (.row.tight) */}
      <div className="mt-2 flex items-center text-[24px]">
        <span className="w-[115px] whitespace-nowrap shrink-0">หมายเหตุ</span>
        <span className="w-[10px] text-center shrink-0">:</span>
        <span className="pl-[28px] flex-1">DO NO. {ticket.doNo}</span>
      </div>

      {/* 6. ลายเซ็นพนักงานชั่ง */}
      <div className="mt-1 text-right text-[24px]">
        <span>พนักงานชั่งน้ำหนัก........................................</span>
      </div>
    </div>
  );
};
