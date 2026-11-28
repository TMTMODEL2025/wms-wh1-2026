import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Printer,
  X,
  Scale,
  Truck,
  AlertCircle,
} from "lucide-react";
import { TmtRecheckVehicleGroup } from "./TmtRecheckView";
import {
  getLocalWeightTicketSequence,
  getTodayDdMmKey,
  loadWeightTicketSequence,
  saveWeightTicketSequence,
} from "../services/slitDataService";

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

    const isSlit =
      mat.includes("2SLIT") ||
      mat.includes("4SLIT") ||
      mat.includes("SLIT") ||
      desc.includes("เหล็กม้วนสลิต") ||
      desc.includes("เหล็กม้วนสิลต") ||
      desc.includes("สลิต") ||
      desc.includes("สิลต") ||
      descUpper.includes("SLIT");

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
  if (hasSlit && hasScrap) {
    productName = "เหล็กม้วนสลิต+เศษคืนลูกค้า";
  } else if (hasSlit) {
    productName = "เหล็กม้วนสลิต";
  } else if (hasScrap) {
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
    activeVehicles.forEach((v) => {
      if (v.vehicleId) map.set(v.vehicleId, v);
    });
    completedReports.forEach((v) => {
      if (v.vehicleId && !map.has(v.vehicleId)) map.set(v.vehicleId, v);
    });
    return Array.from(map.values());
  }, [activeVehicles, completedReports]);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [tickets, setTickets] = useState<DoWeightTicketData[]>([]);
  const [printQueue, setPrintQueue] = useState<DoWeightTicketData[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Track last printed ticket sequence in the current day so ticket numbers run continuously
  const lastPrintedSeqRef = useRef<number>(getLocalWeightTicketSequence().lastSeq);

  // Initialize selected vehicle and sync latest sequence when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setValidationError(null);
    const localSeq = getLocalWeightTicketSequence().lastSeq;
    lastPrintedSeqRef.current = Math.max(lastPrintedSeqRef.current, localSeq);

    if (initialVehicleId && allVehicles.some((v) => v.vehicleId === initialVehicleId)) {
      setSelectedVehicleId(initialVehicleId);
    } else if (allVehicles.length > 0) {
      setSelectedVehicleId(allVehicles[0].vehicleId);
    } else {
      setSelectedVehicleId("");
    }

    let cancelled = false;
    loadWeightTicketSequence().then((cloudState) => {
      if (cancelled) return;
      if (cloudState.lastSeq > lastPrintedSeqRef.current) {
        lastPrintedSeqRef.current = cloudState.lastSeq;
        setTickets((prev) =>
          prev.map((t, idx) => ({
            ...t,
            ticketNo: generateDefaultTicketNo(cloudState.lastSeq + idx + 1),
          }))
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, initialVehicleId, allVehicles]);

  // When selected vehicle changes, generate DO ticket list with continuous running numbers
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
    const baseSeq = Math.max(lastPrintedSeqRef.current, getLocalWeightTicketSequence().lastSeq);
    lastPrintedSeqRef.current = baseSeq;

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
        const itemsToEvaluate =
          isSingleDoVehicle && vehicle.items && vehicle.items.length > 0
            ? vehicle.items
            : data.items && data.items.length > 0
            ? data.items
            : vehicle.items || [];

        const { productName, materialsList, hasSlit, hasScrap } = determineDoProductName(
          itemsToEvaluate,
          vehicle.items
        );
        return {
          doNo,
          customerName: data.customerName,
          vehicleId: vehicle.vehicleId,
          ticketNo: generateDefaultTicketNo(baseSeq + idx + 1),
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
    setValidationError(null);
    setTickets((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // Execute print for specified tickets and advance continuous sequence
  const handleExecutePrint = (ticketsToPrint: DoWeightTicketData[]) => {
    if (ticketsToPrint.length === 0) {
      setValidationError("กรุณาเลือก DO ที่ต้องการพิมพ์อย่างน้อย 1 รายการ");
      return;
    }

    setValidationError(null);

    const now = new Date();
    const todayKey = getTodayDdMmKey(now);
    const currentDateStr = getThaiBuddhistDateFormatted(now);
    const currentTimeStr = getCurrentTimeFormatted(now);

    let nextSeq = Math.max(
      lastPrintedSeqRef.current,
      getLocalWeightTicketSequence(todayKey).lastSeq
    );

    const assignedTicketsToPrint = ticketsToPrint.map((ticket) => {
      nextSeq += 1;
      return {
        ...ticket,
        ticketNo: generateDefaultTicketNo(nextSeq, now),
        inDate: ticket.inDate || currentDateStr,
        inTime: ticket.inTime || currentTimeStr,
        outDate: currentDateStr,
        outTime: currentTimeStr,
      };
    });

    lastPrintedSeqRef.current = nextSeq;
    const lastPrintedTicketNo =
      assignedTicketsToPrint[assignedTicketsToPrint.length - 1]?.ticketNo ||
      generateDefaultTicketNo(nextSeq, now);

    void saveWeightTicketSequence(nextSeq, lastPrintedTicketNo, todayKey);

    setPrintQueue(assignedTicketsToPrint);

    setTimeout(() => {
      document.body.classList.add("printing-weight-ticket");
      window.print();

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        document.body.classList.remove("printing-weight-ticket");
        window.removeEventListener("afterprint", cleanup);

        // Advance DO ticket numbers in state so any subsequent print starts cleanly after the last printed number
        setTickets((prev) =>
          prev.map((t, idx) => ({
            ...t,
            ticketNo: generateDefaultTicketNo(nextSeq + idx + 1),
          }))
        );
      };

      window.addEventListener("afterprint", cleanup);
      setTimeout(cleanup, 2000);
    }, 150);
  };

  if (!isOpen) return null;

  const selectedCount = tickets.filter((t) => t.selectedForPrint).length;

  return (
    <>
      {/* ========================================================================= */}
      {/* On-Screen Modal Dialog (SAP Fiori Style) */}
      {/* ========================================================================= */}
      <div className="fixed inset-0 z-50 bg-slate-900/65 dark:bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
        <div className="bg-white dark:bg-[#08152d] border border-[#d9e2e8] dark:border-[#1e3a5f] rounded-[6px] w-full max-w-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-fade-in font-sans">
          {/* Modal Header */}
          <div className="bg-[#f5f8fa] dark:bg-[#0c1930] px-4 py-3 sm:px-5 border-b border-[#d9e2e8] dark:border-[#1e3a5f] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[4px] bg-[#fffbeb] dark:bg-amber-950/60 border border-[#f59e0b]/50 dark:border-amber-700/60 flex items-center justify-center text-[#b45309] dark:text-amber-300 shrink-0">
                <Scale size={17} />
              </div>
              <h3 className="text-[15px] font-bold text-[#1d2d3e] dark:text-white">
                พิมพ์บัตรชั่งน้ำหนัก (แยกตาม DO)
              </h3>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[4px] border border-[#b9c9d2] bg-white text-[#075985] hover:bg-[#edf7fb] hover:border-[#087eaf] dark:border-[#1e3a5f] dark:bg-[#0d1b33] dark:text-[#38bdf8] dark:hover:bg-[#152b4f] dark:hover:border-[#38bdf8] transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3.5">
            {/* Vehicle Selector */}
            {allVehicles.length === 0 ? (
              <div className="p-3 rounded-[4px] bg-[#fffbeb] dark:bg-amber-950/40 border border-[#fde68a] dark:border-amber-800/60 text-[#b45309] dark:text-amber-300 text-[13px] flex items-center gap-2">
                <AlertCircle size={15} />
                <span>ยังไม่มีข้อมูลทะเบียนรถในระบบ กรุณานำเข้าข้อมูล SAP ในหน้าออฟฟิศก่อน</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 bg-[#f5f8fa] dark:bg-[#0c1930] px-3 py-2.5 rounded-[4px] border border-[#d9e2e8] dark:border-[#1e3a5f]">
                <label className="text-[13px] font-semibold text-[#1d2d3e] dark:text-slate-200 flex items-center gap-1.5 shrink-0">
                  <Truck size={15} className="text-[#087eaf] dark:text-[#38bdf8]" />
                  <span>ทะเบียนรถ</span>
                </label>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="flex-1 h-[36px] rounded-[4px] border border-[#b9c9d2] dark:border-[#1e3a5f] bg-white dark:bg-[#041029] px-3 !text-[14px] text-[#1d2d3e] dark:text-white font-mono font-bold focus:outline-none focus:border-[#087eaf] dark:focus:border-[#38bdf8] transition-colors"
                >
                  {allVehicles.map((v) => (
                    <option key={v.vehicleId} value={v.vehicleId}>
                      {v.vehicleId}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {validationError && (
              <div className="px-3 py-2 rounded-[4px] bg-[#fef2f2] dark:bg-rose-950/50 border border-[#fca5a5] dark:border-rose-700/70 text-[#b91c1c] dark:text-rose-200 text-[13px] flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0 text-[#b91c1c] dark:text-rose-400" />
                <span>{validationError}</span>
              </div>
            )}

            {/* DO Ticket Cards (Minimal Fields Only) */}
            {selectedVehicleId && tickets.length > 0 && (
              <div className="space-y-3">
                {tickets.map((ticket, idx) => (
                  <div
                    key={ticket.doNo}
                    className={`p-3.5 rounded-[6px] border transition-colors space-y-3 ${
                      ticket.selectedForPrint
                        ? "bg-[#f8fbfd] dark:bg-[#0c1930] border-[#087eaf]/60 dark:border-[#38bdf8]/50 shadow-xs"
                        : "bg-slate-50/50 dark:bg-[#08152d] border-[#d9e2e8] dark:border-[#1e3a5f] opacity-70"
                    }`}
                  >
                    {/* Top Row: Selection Checkbox + ทะเบียนรถ + เลขที่ DO + ชื่อลูกค้า + ปุ่มพิมพ์ใบนี้ */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#e5edf2] dark:border-[#1e3a5f] pb-2.5">
                      <label className="flex flex-wrap items-center gap-x-2.5 gap-y-1 cursor-pointer select-none flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={ticket.selectedForPrint}
                          onChange={(e) =>
                            handleUpdateTicketField(idx, "selectedForPrint", e.target.checked)
                          }
                          className="w-4 h-4 rounded-[3px] text-[#087eaf] bg-white dark:bg-[#041029] border-[#b9c9d2] dark:border-[#1e3a5f] focus:ring-0 cursor-pointer shrink-0"
                        />
                        <span className="text-[12.5px] font-mono tabular-nums font-bold text-[#075985] dark:text-[#38bdf8] bg-[#edf7fb] dark:bg-[#0c2340] border border-[#b9c9d2] dark:border-[#1e3a5f] px-2 py-0.5 rounded-[4px]">
                          {ticket.vehicleId}
                        </span>
                        <span className="font-mono tabular-nums font-bold text-[#1d2d3e] dark:text-white text-[13.5px]">
                          DO NO. {ticket.doNo}
                        </span>
                        <span className="text-[13px] text-slate-600 dark:text-slate-300 font-medium truncate">
                          {ticket.customerName}
                        </span>
                      </label>

                      <button
                        type="button"
                        onClick={() => handleExecutePrint([ticket])}
                        className="inline-flex min-h-[30px] items-center justify-center gap-1.5 rounded-[4px] border border-[#f59e0b]/70 bg-[#fffbeb] px-3 py-1 !text-[12.5px] font-semibold text-[#b45309] hover:bg-[#fef3c7] hover:border-[#d97706] dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60 transition-colors shrink-0 cursor-pointer whitespace-nowrap"
                      >
                        <Printer size={14} />
                        <span>พิมพ์ใบนี้</span>
                      </button>
                    </div>

                    {/* Editable Inputs: น้ำหนักสุทธิ (กก.) * และ สินค้า */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
                      <div className="space-y-1">
                        <label className="block text-slate-600 dark:text-slate-300 font-semibold">
                          น้ำหนักสุทธิ (กก.) *
                        </label>
                        <input
                          type="number"
                          value={ticket.netWeightKg}
                          onChange={(e) =>
                            handleUpdateTicketField(idx, "netWeightKg", Number(e.target.value) || 0)
                          }
                          className="w-full h-[36px] bg-white dark:bg-[#041029] border border-[#b9c9d2] dark:border-[#1e3a5f] rounded-[4px] px-3 !text-[14px] text-[#b45309] dark:text-amber-300 font-mono tabular-nums font-bold focus:outline-none focus:border-[#087eaf] dark:focus:border-[#38bdf8]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-slate-600 dark:text-slate-300 font-semibold">
                          สินค้า
                        </label>
                        <input
                          type="text"
                          value={ticket.productName}
                          onChange={(e) =>
                            handleUpdateTicketField(idx, "productName", e.target.value)
                          }
                          className="w-full h-[36px] bg-white dark:bg-[#041029] border border-[#b9c9d2] dark:border-[#1e3a5f] rounded-[4px] px-3 !text-[14px] text-[#1d2d3e] dark:text-white focus:outline-none focus:border-[#087eaf] dark:focus:border-[#38bdf8]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Modal Footer Bar */}
          <div className="bg-[#f5f8fa] dark:bg-[#0c1930] px-4 py-3 sm:px-5 border-t border-[#d9e2e8] dark:border-[#1e3a5f] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[34px] items-center justify-center gap-[6px] rounded-[4px] border border-[#b9c9d2] bg-white px-[14px] py-[7px] !text-[14px] font-semibold leading-tight text-[#075985] hover:bg-[#edf7fb] hover:border-[#087eaf] dark:border-[#1e3a5f] dark:bg-[#0d1b33] dark:text-[#38bdf8] dark:hover:bg-[#152b4f] dark:hover:border-[#38bdf8] transition-colors cursor-pointer whitespace-nowrap"
            >
              ปิดหน้าต่าง
            </button>

            <button
              type="button"
              onClick={() => handleExecutePrint(tickets.filter((t) => t.selectedForPrint))}
              disabled={selectedCount === 0}
              className="inline-flex min-h-[34px] items-center justify-center gap-[6px] rounded-[4px] border border-[#b45309] bg-[#b45309] px-[14px] py-[7px] !text-[14px] font-semibold leading-tight text-white hover:bg-[#92400e] hover:border-[#92400e] dark:border-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 dark:hover:border-amber-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer size={15} />
              <span>พิมพ์บัตรชั่งที่เลือก ({selectedCount} ใบ)</span>
            </button>
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
                key={`${ticket.doNo}-${ticket.ticketNo}`}
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
