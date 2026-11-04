import React, { useState, useMemo } from "react";
import {
  Truck,
  Calendar,
  Clock,
  Filter,
  Download,
  FileSpreadsheet,
  Layers,
  Scale,
  Cpu,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  BarChart3,
  Search,
  RotateCcw,
  Boxes,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import * as XLSX from "xlsx";
import { PickListOrder, SlitBarcodeRecord, SapMasterItem } from "./SlitFilmManagement";
import { getStoredMachineStaging } from "../data/machineStagingStorage";

export interface TransferCarTripItem {
  id: string;
  batch: string;
  orderNo: string;
  machineId: "TM06" | "TM07";
  weightKg: number;
  certThickness: string;
  width: string;
  grade: string;
  timestampStr: string;
  dateObj: Date;
}

export interface TransferCarTrip {
  id: string;
  tripNo: number;
  dateStr: string; // YYYY-MM-DD
  displayDate: string; // DD/MM/YYYY
  timePeriod: string; // e.g. "10:00 - 10:15"
  machineId: "TM06" | "TM07";
  orderNo: string;
  stripCount: number;
  totalWeightKg: number;
  totalWeightTon: number;
  items: TransferCarTripItem[];
}

interface TransferCarReportProps {
  pickLists: PickListOrder[];
  outboundList: SlitBarcodeRecord[];
  movementHistoryList: SlitBarcodeRecord[];
  sapMasterMap: Map<string, SapMasterItem>;
  isThai?: boolean;
}

// Helper to normalize machine ID to "TM06" or "TM07"
function normalizeTargetMachine(mStr?: string): "TM06" | "TM07" | null {
  if (!mStr) return null;
  const clean = mStr.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  if (clean === "TM06" || clean === "TM6") return "TM06";
  if (clean === "TM07" || clean === "TM7") return "TM07";
  return null;
}

// Helper to parse date string into Date object
function parseAnyDate(str?: string): Date | null {
  if (!str) return null;
  const trimmed = str.trim();

  // Try direct parse if ISO
  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime()) && trimmed.includes("-")) {
    return isoDate;
  }

  // Common Thai/UK format: "DD/MM/YYYY, HH:mm:ss" or "DD/MM/YYYY HH:mm"
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    let year = parseInt(dmyMatch[3], 10);
    // Handle Buddhist Era if > 2400
    if (year > 2400) year -= 543;
    const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const minute = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const second = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    return new Date(year, month, day, hour, minute, second);
  }

  return !isNaN(isoDate.getTime()) ? isoDate : null;
}

// Format 2 decimal places with comma
function formatTwoDecimals(val?: number): string {
  if (val === undefined || val === null || isNaN(val)) return "0.00";
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TransferCarReport({
  pickLists,
  outboundList,
  movementHistoryList,
  sapMasterMap,
  isThai = true,
}: TransferCarReportProps) {
  // Current month default: "YYYY-MM"
  const defaultMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);

  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [selectedMachineFilter, setSelectedMachineFilter] = useState<"ALL" | "TM06" | "TM07">("ALL");
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Aggregate all raw transferred items for TM06 and TM07 strictly from completed "จ่ายหน้าเครื่อง" (Machine Issue)
  const allTransferredItems = useMemo(() => {
    const items: TransferCarTripItem[] = [];
    const seenBatches = new Set<string>();

    // 1. From pickLists: ONLY items that have been verified AND issued at machine by Operator (machineIssued === true)
    // Strictly exclude items that are still in pending/pick status (เตรียมเบิก / รอเตรียม / รอ Operator สแกนรับงาน)
    pickLists.forEach((order) => {
      const normMachine = normalizeTargetMachine(order.machineId);
      if (!normMachine) return;

      (order.items || []).forEach((item) => {
        // Strict filter: Must be verified AND machineIssued must be explicitly true
        if (!item.machineIssued) return;
        if (!item.batch) return;

        const bKey = item.batch.trim().toUpperCase();
        if (!bKey || seenBatches.has(bKey)) return;

        // Trip timestamp must be the actual machine issue completion time
        const timestamp = item.machineIssuedAt || item.scannedAt;
        if (!timestamp) return;

        const dObj = parseAnyDate(timestamp);
        if (!dObj) return;

        seenBatches.add(bKey);
        const matchedSap = sapMasterMap.get(bKey);
        const wKg = matchedSap?.weightKg || item.reqQty || 0;

        items.push({
          id: `PL-${order.orderNo}-${bKey}`,
          batch: bKey,
          orderNo: order.orderNo,
          machineId: normMachine,
          weightKg: wKg,
          certThickness: matchedSap?.certThickness || "-",
          width: matchedSap?.width || "-",
          grade: matchedSap?.grade || "-",
          timestampStr: timestamp,
          dateObj: dObj,
        });
      });
    });

    // 2. From outboundList and movementHistoryList: ONLY records specifically confirmed as "จ่ายหน้าเครื่อง" / "รับงานหน้าเครื่อง"
    const combinedOutbound = [...outboundList, ...movementHistoryList];
    combinedOutbound.forEach((rec) => {
      if (!rec.batch) return;
      const bKey = rec.batch.trim().toUpperCase();
      if (!bKey || seenBatches.has(bKey)) return;

      const normMachine = normalizeTargetMachine(rec.machine) || normalizeTargetMachine(rec.location?.replace("เบิก", ""));
      if (!normMachine) return;

      // Strict check: Only count if this record represents a completed machine issue / operator receive event
      const cond = rec.conditionText || "";
      const isMachineIssuedRecord =
        cond.includes("รับงานหน้าเครื่อง") ||
        cond.includes("จ่ายหน้าเครื่อง") ||
        cond.includes("จ่ายแล้ว") ||
        (rec.mode === "outbound" && (cond.includes("หน้าเครื่อง") || (rec.orderNo && rec.orderNo !== "-")));

      if (!isMachineIssuedRecord) return;

      const timestamp = rec.scanTimestamp;
      if (!timestamp) return;

      const dObj = parseAnyDate(timestamp);
      if (!dObj) return;

      seenBatches.add(bKey);
      const matchedSap = sapMasterMap.get(bKey);
      const wKg = matchedSap?.weightKg || rec.weightKg || 0;

      items.push({
        id: `OUT-${rec.id || bKey}`,
        batch: bKey,
        orderNo: rec.orderNo && rec.orderNo !== "-" ? rec.orderNo : "-",
        machineId: normMachine,
        weightKg: wKg,
        certThickness: matchedSap?.certThickness || rec.certThickness || "-",
        width: matchedSap?.width || rec.width || "-",
        grade: matchedSap?.grade || rec.grade || "-",
        timestampStr: timestamp,
        dateObj: dObj,
      });
    });

    // 3. From physical staging racks: Coils placed on TM06 and TM07 racks via operator scanning at machine
    try {
      const stagingConfigs = getStoredMachineStaging();
      stagingConfigs.forEach((m) => {
        const normMachine = normalizeTargetMachine(m.machineId);
        if (!normMachine) return;

        (m.racks || []).forEach((rack) => {
          (rack.coils || []).forEach((coil) => {
            if (!coil.batch) return;
            const bKey = coil.batch.trim().toUpperCase();
            if (!bKey || seenBatches.has(bKey)) return;

            const timestamp = coil.stagedAt;
            if (!timestamp) return;

            const dObj = parseAnyDate(timestamp);
            if (!dObj) return;

            seenBatches.add(bKey);
            const matchedSap = sapMasterMap.get(bKey);

            items.push({
              id: `STG-${normMachine}-${bKey}`,
              batch: bKey,
              orderNo: "-",
              machineId: normMachine,
              weightKg: matchedSap?.weightKg || coil.weightKg || 0,
              certThickness: matchedSap?.certThickness || (coil.thicknessMm ? `${coil.thicknessMm}` : "-"),
              width: matchedSap?.width || (coil.widthMm ? `${coil.widthMm}` : "-"),
              grade: matchedSap?.grade || coil.grade || "-",
              timestampStr: timestamp,
              dateObj: dObj,
            });
          });
        });
      });
    } catch {}

    return items;
  }, [pickLists, outboundList, movementHistoryList, sapMasterMap]);

  // Filter items by selected month
  const monthlyItems = useMemo(() => {
    if (!selectedMonth) return [];
    return allTransferredItems.filter((item) => {
      const y = item.dateObj.getFullYear();
      const m = String(item.dateObj.getMonth() + 1).padStart(2, "0");
      const ym = `${y}-${m}`;
      return ym === selectedMonth;
    });
  }, [allTransferredItems, selectedMonth]);

  // Cluster items into Transfer Car trips ("รอบ")
  // Rule: Group items for the same machine and order scanned within a 25-minute window
  const computedTrips = useMemo(() => {
    // Group by machine + date
    const groups: Record<string, TransferCarTripItem[]> = {};

    monthlyItems.forEach((item) => {
      const y = item.dateObj.getFullYear();
      const m = String(item.dateObj.getMonth() + 1).padStart(2, "0");
      const d = String(item.dateObj.getDate()).padStart(2, "0");
      const dateKey = `${y}-${m}-${d}`;
      const groupKey = `${dateKey}_${item.machineId}_${item.orderNo !== "-" ? item.orderNo : "GENERAL"}`;

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(item);
    });

    const trips: TransferCarTrip[] = [];
    let globalTripCounter = 1;

    // Process each group chronologically
    Object.keys(groups).sort().forEach((groupKey) => {
      const groupItems = groups[groupKey].sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
      if (groupItems.length === 0) return;

      let currentTripItems: TransferCarTripItem[] = [];
      let lastTime: number | null = null;
      const CLUSTER_WINDOW_MS = 25 * 60 * 1000; // 25 minutes gap starts a new trip

      const flushTrip = () => {
        if (currentTripItems.length === 0) return;
        const first = currentTripItems[0];
        const last = currentTripItems[currentTripItems.length - 1];

        const y = first.dateObj.getFullYear();
        const m = String(first.dateObj.getMonth() + 1).padStart(2, "0");
        const d = String(first.dateObj.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;
        const displayDate = `${d}/${m}/${y}`;

        const startTime = first.dateObj.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        const endTime = last.dateObj.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        const timePeriod = startTime === endTime ? `${startTime} น.` : `${startTime} - ${endTime} น.`;

        const totalKg = currentTripItems.reduce((acc, it) => acc + (it.weightKg || 0), 0);
        const totalTon = totalKg / 1000;

        trips.push({
          id: `TRIP-${dateStr}-${first.machineId}-${globalTripCounter}`,
          tripNo: globalTripCounter++,
          dateStr,
          displayDate,
          timePeriod,
          machineId: first.machineId,
          orderNo: first.orderNo,
          stripCount: currentTripItems.length,
          totalWeightKg: totalKg,
          totalWeightTon: totalTon,
          items: [...currentTripItems],
        });

        currentTripItems = [];
        lastTime = null;
      };

      groupItems.forEach((item) => {
        const itemTime = item.dateObj.getTime();
        if (lastTime === null) {
          currentTripItems.push(item);
          lastTime = itemTime;
        } else if (itemTime - lastTime <= CLUSTER_WINDOW_MS) {
          currentTripItems.push(item);
          lastTime = itemTime;
        } else {
          // Time gap > 25 mins: Transfer Car completed round 1 and this is round 2!
          flushTrip();
          currentTripItems.push(item);
          lastTime = itemTime;
        }
      });

      flushTrip();
    });

    // Sort trips descending by date and time
    return trips.sort((a, b) => b.items[0]?.dateObj.getTime() - a.items[0]?.dateObj.getTime());
  }, [monthlyItems]);

  // Apply machine and keyword search filters
  const filteredTrips = useMemo(() => {
    return computedTrips.filter((t) => {
      if (selectedMachineFilter !== "ALL" && t.machineId !== selectedMachineFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchTrip =
          t.orderNo.toLowerCase().includes(query) ||
          t.displayDate.includes(query) ||
          t.timePeriod.toLowerCase().includes(query) ||
          t.machineId.toLowerCase().includes(query);
        const matchBatch = t.items.some(
          (it) =>
            it.batch.toLowerCase().includes(query) ||
            it.grade.toLowerCase().includes(query)
        );
        return matchTrip || matchBatch;
      }
      return true;
    });
  }, [computedTrips, selectedMachineFilter, searchTerm]);

  // Overall KPI statistics
  const stats = useMemo(() => {
    const trips = filteredTrips;
    const totalTrips = trips.length;
    const totalStrips = trips.reduce((sum, t) => sum + t.stripCount, 0);
    const totalWeightKg = trips.reduce((sum, t) => sum + t.totalWeightKg, 0);
    const totalWeightTon = totalWeightKg / 1000;
    const avgWeightKgPerTrip = totalTrips > 0 ? totalWeightKg / totalTrips : 0;

    const tm06Trips = trips.filter((t) => t.machineId === "TM06");
    const tm07Trips = trips.filter((t) => t.machineId === "TM07");

    const tm06WeightKg = tm06Trips.reduce((sum, t) => sum + t.totalWeightKg, 0);
    const tm07WeightKg = tm07Trips.reduce((sum, t) => sum + t.totalWeightKg, 0);

    return {
      totalTrips,
      totalStrips,
      totalWeightKg,
      totalWeightTon,
      avgWeightKgPerTrip,
      tm06: {
        trips: tm06Trips.length,
        strips: tm06Trips.reduce((s, t) => s + t.stripCount, 0),
        weightKg: tm06WeightKg,
        weightTon: tm06WeightKg / 1000,
      },
      tm07: {
        trips: tm07Trips.length,
        strips: tm07Trips.reduce((s, t) => s + t.stripCount, 0),
        weightKg: tm07WeightKg,
        weightTon: tm07WeightKg / 1000,
      },
    };
  }, [filteredTrips]);

  // Daily & Per-Machine (TM06 & TM07) Chart Data
  const dailyChartData = useMemo(() => {
    if (!selectedMonth) {
      return {
        days: [],
        maxDailyTotalTrips: 0,
        maxMachineDailyTrips: 0,
        activeDaysCount: 0,
      };
    }

    const [yearStr, monthStr] = selectedMonth.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(month)) {
      return {
        days: [],
        maxDailyTotalTrips: 0,
        maxMachineDailyTrips: 0,
        activeDaysCount: 0,
      };
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const dayMap = new Map<
      string,
      {
        dayNum: number;
        dayLabel: string;
        dateStr: string;
        displayDate: string;
        tm06Trips: number;
        tm07Trips: number;
        totalTrips: number;
        tm06Strips: number;
        tm07Strips: number;
        tm06WeightKg: number;
        tm07WeightKg: number;
        tm06WeightTon: number;
        tm07WeightTon: number;
        totalWeightKg: number;
        totalWeightTon: number;
      }
    >();

    for (let d = 1; d <= daysInMonth; d++) {
      const dd = String(d).padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      const dateStr = `${year}-${mm}-${dd}`;
      const displayDate = `${dd}/${mm}/${year}`;
      dayMap.set(dateStr, {
        dayNum: d,
        dayLabel: dd,
        dateStr,
        displayDate,
        tm06Trips: 0,
        tm07Trips: 0,
        totalTrips: 0,
        tm06Strips: 0,
        tm07Strips: 0,
        tm06WeightKg: 0,
        tm07WeightKg: 0,
        tm06WeightTon: 0,
        tm07WeightTon: 0,
        totalWeightKg: 0,
        totalWeightTon: 0,
      });
    }

    filteredTrips.forEach((trip) => {
      const entry = dayMap.get(trip.dateStr);
      if (!entry) return;
      if (trip.machineId === "TM06") {
        entry.tm06Trips += 1;
        entry.tm06Strips += trip.stripCount;
        entry.tm06WeightKg += trip.totalWeightKg;
        entry.tm06WeightTon += trip.totalWeightTon;
      } else if (trip.machineId === "TM07") {
        entry.tm07Trips += 1;
        entry.tm07Strips += trip.stripCount;
        entry.tm07WeightKg += trip.totalWeightKg;
        entry.tm07WeightTon += trip.totalWeightTon;
      }
      entry.totalTrips += 1;
      entry.totalWeightKg += trip.totalWeightKg;
      entry.totalWeightTon += trip.totalWeightTon;
    });

    const days = Array.from(dayMap.values());
    const maxDailyTotalTrips = days.reduce((max, d) => Math.max(max, d.totalTrips), 0);
    const maxMachineDailyTrips = days.reduce(
      (max, d) => Math.max(max, d.tm06Trips, d.tm07Trips),
      0
    );
    const activeDaysCount = days.filter((d) => d.totalTrips > 0).length;

    return {
      days,
      maxDailyTotalTrips,
      maxMachineDailyTrips,
      activeDaysCount,
    };
  }, [filteredTrips, selectedMonth]);

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    if (filteredTrips.length === 0) return;

    // Sheet 1: Summary Statistics
    const summaryData = [
      {
        หัวข้อ: "รายงานปริมาณการใช้งาน Transfer Car ประจำเดือน",
        รายละเอียด: selectedMonth,
      },
      {
        หัวข้อ: "เครื่องจักรเป้าหมาย",
        รายละเอียด: selectedMachineFilter === "ALL" ? "TM06 & TM07 (ทั้งหมด)" : selectedMachineFilter,
      },
      {
        หัวข้อ: "จำนวนรอบการย้ายทั้งหมด (รอบ)",
        รายละเอียด: stats.totalTrips,
      },
      {
        หัวข้อ: "จำนวนแถบเหล็กทั้งหมด (แถบ)",
        รายละเอียด: stats.totalStrips,
      },
      {
        หัวข้อ: "น้ำหนักรวมทั้งหมด (กก.)",
        รายละเอียด: Number(stats.totalWeightKg.toFixed(2)),
      },
      {
        หัวข้อ: "น้ำหนักรวมทั้งหมด (ตัน)",
        รายละเอียด: Number(stats.totalWeightTon.toFixed(2)),
      },
      {
        หัวข้อ: "น้ำหนักเฉลี่ยต่อรอบ (กก./รอบ)",
        รายละเอียด: Number(stats.avgWeightKgPerTrip.toFixed(2)),
      },
      {
        หัวข้อ: "เครื่อง TM06 (จำนวนรอบ / น้ำหนักตัน)",
        รายละเอียด: `${stats.tm06.trips} รอบ / ${stats.tm06.weightTon.toFixed(2)} ตัน`,
      },
      {
        หัวข้อ: "เครื่อง TM07 (จำนวนรอบ / น้ำหนักตัน)",
        รายละเอียด: `${stats.tm07.trips} รอบ / ${stats.tm07.weightTon.toFixed(2)} ตัน`,
      },
    ];

    // Sheet 2: Trips Detail Breakdown
    const tripsData: any[] = [];
    filteredTrips.forEach((t) => {
      t.items.forEach((it, idx) => {
        tripsData.push({
          รอบที่: t.tripNo,
          วันที่: t.displayDate,
          ช่วงเวลา: t.timePeriod,
          เครื่องจักร: t.machineId,
          เลขที่ใบสั่งเบิก: t.orderNo,
          ลำดับแถบในรอบ: idx + 1,
          รหัส_Batch: it.batch,
          ความหนา_mm: it.certThickness,
          ความกว้าง_mm: it.width,
          เกรดเหล็ก: it.grade,
          น้ำหนัก_กก: Number(it.weightKg.toFixed(2)),
          ยอดรวมน้ำหนักรอบ_กก: idx === 0 ? Number(t.totalWeightKg.toFixed(2)) : "",
          ยอดรวมน้ำหนักรอบ_ตัน: idx === 0 ? Number(t.totalWeightTon.toFixed(2)) : "",
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    const wsTrips = XLSX.utils.json_to_sheet(tripsData);

    // Set column widths
    wsSummary["!cols"] = [{ wch: 35 }, { wch: 30 }];
    wsTrips["!cols"] = [
      { wch: 10 },
      { wch: 14 },
      { wch: 18 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 18 },
      { wch: 18 },
    ];

    XLSX.utils.book_append_sheet(wb, wsSummary, "สรุปภาพรวม");
    XLSX.utils.book_append_sheet(wb, wsTrips, "รายละเอียดรอบขนย้าย");

    XLSX.writeFile(wb, `Transfer_Car_Report_${selectedMonth}_${selectedMachineFilter}.xlsx`);
  };

  return (
    <div className="space-y-2.5 sm:space-y-4">
      {/* 1. Header Banner & Filter Controls (2-Row Structured Layout) */}
      <div className="rounded-xl sm:rounded-2xl border p-3 sm:p-4 bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-md overflow-hidden">
        <div className="flex flex-col gap-2.5 sm:gap-3">
          {/* Row 1: Main Title and Icon */}
          <div className="flex items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100 dark:border-[#1e3a5f]/80">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
              <div className="p-2 sm:p-2.5 rounded-lg sm:rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-orange-500/20 shrink-0">
                <Truck size={18} className="sm:w-[22px] sm:h-[22px]" />
              </div>
              <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                <h2 className="text-sm sm:text-lg font-black tracking-tight text-slate-900 dark:text-white leading-snug">
                  {isThai
                    ? "รายงานปริมาณการใช้งาน Transfer Car ประจำเดือน"
                    : "Transfer Car Monthly Usage Report"}
                </h2>
                <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-extrabold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0 whitespace-nowrap">
                  TM06 & TM07
                </span>
              </div>
            </div>
          </div>

          {/* Row 2: Action Tools - Month Picker, Machine Filter, Export Excel */}
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex flex-wrap items-center gap-2 flex-1 sm:flex-initial">
              {/* Month Selector */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg sm:rounded-xl border bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] shrink-0">
                <Calendar size={14} className="text-amber-500 shrink-0" />
                <label className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0">
                  {isThai ? "เดือน/ปี:" : "Month:"}
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-2 py-0.5 rounded-md sm:rounded-lg bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-[11px] sm:text-xs font-mono font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer shadow-xs"
                />
              </div>

              {/* Machine Filter Toggle Buttons */}
              <div className="inline-flex flex-1 sm:flex-initial rounded-lg sm:rounded-xl p-0.5 sm:p-1 border bg-slate-100 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedMachineFilter("ALL")}
                  className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1 rounded-md sm:rounded-lg text-[10.5px] sm:text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    selectedMachineFilter === "ALL"
                      ? "bg-white dark:bg-blue-600 text-blue-600 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <span className="sm:hidden">{isThai ? "ทั้งหมด" : "All"}</span>
                  <span className="hidden sm:inline">{isThai ? "ทั้งหมด (TM06 + TM07)" : "All (TM06 & TM07)"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMachineFilter("TM06")}
                  className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1 rounded-md sm:rounded-lg text-[10.5px] sm:text-xs font-bold transition-all cursor-pointer ${
                    selectedMachineFilter === "TM06"
                      ? "bg-amber-500 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  TM06
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMachineFilter("TM07")}
                  className={`flex-1 sm:flex-initial px-2.5 sm:px-3 py-1 rounded-md sm:rounded-lg text-[10.5px] sm:text-xs font-bold transition-all cursor-pointer ${
                    selectedMachineFilter === "TM07"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  TM07
                </button>
              </div>
            </div>

            {/* Export Excel Button */}
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={filteredTrips.length === 0}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs shrink-0 whitespace-nowrap ml-auto ${
                filteredTrips.length === 0
                  ? "opacity-50 bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 active:scale-95"
              }`}
              title={isThai ? "ส่งออกรายงานเป็นไฟล์ Excel (.xlsx)" : "Export report as Excel"}
            >
              <FileSpreadsheet size={14} className="shrink-0" />
              <span>{isThai ? "ส่งออก Excel" : "Export Excel"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. KPI Summary Dashboard Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {/* Card 1: Total Trips */}
        <div className="p-2.5 sm:p-4 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10.5px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
              {isThai ? "จำนวนรอบขนย้าย (Trips)" : "Total Trips"}
            </span>
            <div className="p-1.5 sm:p-2 rounded-md sm:rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
              <Truck size={14} className="sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span className="text-base sm:text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
              {stats.totalTrips.toLocaleString()}
            </span>
            <span className="text-[10px] sm:text-xs text-slate-400 font-semibold">{isThai ? "รอบ" : "trips"}</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-400 flex items-center justify-between gap-1">
            <span className="truncate">TM06: {stats.tm06.trips} รอบ</span>
            <span className="truncate">TM07: {stats.tm07.trips} รอบ</span>
          </div>
        </div>

        {/* Card 2: Total Strips */}
        <div className="p-2.5 sm:p-4 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10.5px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
              {isThai ? "จำนวนแถบที่ย้าย (Strips)" : "Total Strips"}
            </span>
            <div className="p-1.5 sm:p-2 rounded-md sm:rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
              <Layers size={14} className="sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span className="text-base sm:text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
              {stats.totalStrips.toLocaleString()}
            </span>
            <span className="text-[10px] sm:text-xs text-slate-400 font-semibold">{isThai ? "แถบ" : "coils"}</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-400 flex items-center justify-between gap-1">
            <span className="truncate">TM06: {stats.tm06.strips} แถบ</span>
            <span className="truncate">TM07: {stats.tm07.strips} แถบ</span>
          </div>
        </div>

        {/* Card 3: Total Weight */}
        <div className="p-2.5 sm:p-4 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10.5px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
              {isThai ? "น้ำหนักรวมทั้งหมด (Weight)" : "Total Weight"}
            </span>
            <div className="p-1.5 sm:p-2 rounded-md sm:rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
              <Scale size={14} className="sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span className="text-base sm:text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
              {formatTwoDecimals(stats.totalWeightTon)}
            </span>
            <span className="text-[10px] sm:text-xs text-slate-400 font-semibold">{isThai ? "ตัน" : "tons"}</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-400 truncate">
            <span>({formatTwoDecimals(stats.totalWeightKg)} kg)</span>
          </div>
        </div>

        {/* Card 4: Average Weight per Trip */}
        <div className="p-2.5 sm:p-4 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10.5px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
              {isThai ? "น้ำหนักเฉลี่ยต่อรอบ (Avg/Trip)" : "Avg Weight/Trip"}
            </span>
            <div className="p-1.5 sm:p-2 rounded-md sm:rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
              <TrendingUp size={14} className="sm:w-4 sm:h-4" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span className="text-base sm:text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
              {formatTwoDecimals(stats.avgWeightKgPerTrip)}
            </span>
            <span className="text-[10px] sm:text-xs text-slate-400 font-semibold">kg/{isThai ? "รอบ" : "trip"}</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] text-slate-400 truncate">
            <span>
              {stats.totalTrips > 0
                ? `${(stats.totalStrips / stats.totalTrips).toFixed(1)} ${isThai ? "แถบเฉลี่ย/รอบ" : "strips/trip"}`
                : "-"}
            </span>
          </div>
        </div>
      </div>

      {/* 2.5 Daily & Per-Machine (TM06 & TM07) Transfer Trips Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 sm:gap-4">
        {/* Daily Transfer Trips Chart (TM06 & TM07 per day) */}
        <div className="lg:col-span-2 rounded-xl sm:rounded-2xl border p-3 sm:p-5 bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 pb-2 sm:pb-3 mb-2.5 sm:mb-4 border-b border-slate-100 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2 sm:gap-2.5">
                <div className="p-1.5 sm:p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                  <BarChart3 size={16} className="sm:w-[18px] sm:h-[18px]" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    {isThai
                      ? "กราฟแสดงรอบในการย้ายแต่ละวัน (แยกตามเครื่องจักร TM06 และ TM07)"
                      : "Daily Transfer Trips by Machine (TM06 & TM07)"}
                  </h3>
                  <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400">
                    {isThai
                      ? `ประจำเดือน ${selectedMonth} • วันที่มีการย้าย ${dailyChartData.activeDaysCount} วัน`
                      : `Month ${selectedMonth} • Active days: ${dailyChartData.activeDaysCount}`}
                  </p>
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 sm:gap-4 text-[10.5px] sm:text-xs font-semibold">
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-xs bg-amber-500 inline-block shadow-xs" />
                  <span className="text-slate-700 dark:text-slate-300">
                    TM06 ({stats.tm06.trips} {isThai ? "รอบ" : "trips"})
                  </span>
                </div>
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-xs bg-blue-600 inline-block shadow-xs" />
                  <span className="text-slate-700 dark:text-slate-300">
                    TM07 ({stats.tm07.trips} {isThai ? "รอบ" : "trips"})
                  </span>
                </div>
              </div>
            </div>

            {filteredTrips.length === 0 ? (
              <div className="h-36 sm:h-52 flex flex-col items-center justify-center text-center rounded-xl bg-slate-50/70 dark:bg-[#0c1930]/50 border border-dashed border-slate-200 dark:border-[#1e3a5f] p-4 sm:p-6">
                <BarChart3 size={24} className="text-slate-300 dark:text-slate-600 mb-1.5 sm:mb-2 sm:w-7 sm:h-7" />
                <p className="text-[11px] sm:text-xs font-bold text-slate-600 dark:text-slate-400">
                  {isThai
                    ? "ยังไม่มีข้อมูลรอบการย้ายรายวันในเดือนที่เลือก"
                    : "No daily transfer trip data for selected month"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto pb-1">
                <div className="min-w-[580px] sm:min-w-[640px]">
                  {/* Y-axis scale + Bars area */}
                  <div className="relative h-48 sm:h-64 pt-6 sm:pt-8 pb-1.5 sm:pb-2 px-1.5 sm:px-2 rounded-xl bg-slate-50/60 dark:bg-[#0c1930]/60 border border-slate-100 dark:border-[#1e3a5f]/80 flex items-end gap-1">
                    {/* Horizontal reference lines */}
                    <div className="absolute inset-x-2 top-6 sm:top-8 bottom-6 sm:bottom-7 pointer-events-none flex flex-col justify-between">
                      {[1, 0.5, 0].map((ratio, idx) => {
                        const scaleMax = Math.max(dailyChartData.maxMachineDailyTrips, 4);
                        const val = Math.round(scaleMax * ratio);
                        return (
                          <div
                            key={idx}
                            className="w-full border-b border-dashed border-slate-200/80 dark:border-[#1e3a5f]/70 flex items-center"
                          >
                            <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 -mt-3.5 pr-1">
                              {val}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Day columns */}
                    {dailyChartData.days.map((d) => {
                      const scaleMax = Math.max(dailyChartData.maxMachineDailyTrips, 4);
                      const tm06HeightPct =
                        d.tm06Trips > 0 ? Math.max((d.tm06Trips / scaleMax) * 100, 8) : 0;
                      const tm07HeightPct =
                        d.tm07Trips > 0 ? Math.max((d.tm07Trips / scaleMax) * 100, 8) : 0;
                      const hasActivity = d.totalTrips > 0;
                      const tooltipHorizontalPos =
                        d.dayNum <= 6
                          ? "left-0"
                          : d.dayNum >= dailyChartData.days.length - 5
                          ? "right-0"
                          : "left-1/2 -translate-x-1/2";

                      return (
                        <div
                          key={d.dateStr}
                          className="group relative flex-1 min-w-[16px] sm:min-w-[18px] h-full flex flex-col items-center justify-end z-10 hover:z-50"
                        >
                          {/* Hover Tooltip (Positioned inside chart top area so it never clips) */}
                          {hasActivity && (
                            <div
                              className={`opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 absolute top-1.5 ${tooltipHorizontalPos} z-50 w-56 p-2.5 rounded-xl bg-slate-900/95 dark:bg-slate-800/95 text-white text-[10.5px] shadow-xl border border-slate-700 backdrop-blur-xs`}
                            >
                              <div className="font-bold text-amber-300 border-b border-slate-700 pb-1 mb-1.5 flex items-center justify-between">
                                <span>{d.displayDate}</span>
                                <span>
                                  {isThai ? `รวม ${d.totalTrips} รอบ` : `Total ${d.totalTrips} trips`}
                                </span>
                              </div>
                              <div className="space-y-1.5 font-mono">
                                <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                  <div className="flex items-center justify-between text-amber-400 font-bold">
                                    <span>TM06:</span>
                                    <span>
                                      {d.tm06Trips} {isThai ? "รอบ" : "trips"} ({d.tm06Strips}{" "}
                                      {isThai ? "แถบ" : "pcs"})
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-slate-300 text-[10px] mt-0.5">
                                    <span>{isThai ? "น้ำหนัก:" : "Weight:"}</span>
                                    <span>
                                      {formatTwoDecimals(d.tm06WeightTon)} {isThai ? "ตัน" : "t"} (
                                      {formatTwoDecimals(d.tm06WeightKg)} kg)
                                    </span>
                                  </div>
                                </div>

                                <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                  <div className="flex items-center justify-between text-blue-400 font-bold">
                                    <span>TM07:</span>
                                    <span>
                                      {d.tm07Trips} {isThai ? "รอบ" : "trips"} ({d.tm07Strips}{" "}
                                      {isThai ? "แถบ" : "pcs"})
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-slate-300 text-[10px] mt-0.5">
                                    <span>{isThai ? "น้ำหนัก:" : "Weight:"}</span>
                                    <span>
                                      {formatTwoDecimals(d.tm07WeightTon)} {isThai ? "ตัน" : "t"} (
                                      {formatTwoDecimals(d.tm07WeightKg)} kg)
                                    </span>
                                  </div>
                                </div>

                                <div className="pt-1 border-t border-slate-700 flex items-center justify-between text-emerald-400 font-bold">
                                  <span>{isThai ? "น้ำหนักรวม:" : "Total Weight:"}</span>
                                  <span>
                                    {formatTwoDecimals(d.totalWeightTon)} {isThai ? "ตัน" : "t"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Bars Wrapper */}
                          <div className="w-full flex-1 flex items-end justify-center gap-[2px] px-[1px]">
                            {/* TM06 Bar */}
                            {(selectedMachineFilter === "ALL" || selectedMachineFilter === "TM06") && (
                              <div className="flex-1 h-full flex flex-col items-center justify-end">
                                {d.tm06Trips > 0 && (
                                  <span className="text-[9px] font-mono font-extrabold text-amber-600 dark:text-amber-400 leading-none mb-0.5">
                                    {d.tm06Trips}
                                  </span>
                                )}
                                <div
                                  style={{ height: `${tm06HeightPct}%` }}
                                  className={`w-full max-w-[10px] rounded-t-xs transition-all ${
                                    d.tm06Trips > 0
                                      ? "bg-gradient-to-t from-amber-600 to-amber-400 shadow-xs"
                                      : "h-[2px] bg-slate-200 dark:bg-slate-800"
                                  }`}
                                />
                              </div>
                            )}

                            {/* TM07 Bar */}
                            {(selectedMachineFilter === "ALL" || selectedMachineFilter === "TM07") && (
                              <div className="flex-1 h-full flex flex-col items-center justify-end">
                                {d.tm07Trips > 0 && (
                                  <span className="text-[9px] font-mono font-extrabold text-blue-600 dark:text-blue-400 leading-none mb-0.5">
                                    {d.tm07Trips}
                                  </span>
                                )}
                                <div
                                  style={{ height: `${tm07HeightPct}%` }}
                                  className={`w-full max-w-[10px] rounded-t-xs transition-all ${
                                    d.tm07Trips > 0
                                      ? "bg-gradient-to-t from-blue-700 to-blue-500 shadow-xs"
                                      : "h-[2px] bg-slate-200 dark:bg-slate-800"
                                  }`}
                                />
                              </div>
                            )}
                          </div>

                          {/* X-Axis Day Number */}
                          <span
                            className={`mt-1 sm:mt-1.5 text-[9px] sm:text-[9.5px] font-mono leading-none ${
                              hasActivity
                                ? "font-extrabold text-slate-900 dark:text-white"
                                : "text-slate-400 dark:text-slate-500"
                            }`}
                          >
                            {d.dayLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Per-Machine Comparison Chart (TM06 vs TM07) */}
        <div className="rounded-xl sm:rounded-2xl border p-3 sm:p-5 bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-2 sm:pb-3 mb-2.5 sm:mb-4 border-b border-slate-100 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2 sm:gap-2.5">
                <div className="p-1.5 sm:p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                  <Cpu size={16} className="sm:w-[18px] sm:h-[18px]" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    {isThai
                      ? "กราฟเปรียบเทียบรอบย้ายแต่ละเครื่องจักร"
                      : "Trips by Machine (TM06 vs TM07)"}
                  </h3>
                  <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400">
                    {isThai
                      ? "สัดส่วนจำนวนรอบ แถบ และน้ำหนักแยกตามเครื่อง"
                      : "Share of trips, strips, and weight per machine"}
                  </p>
                </div>
              </div>
            </div>

            {filteredTrips.length === 0 ? (
              <div className="h-36 sm:h-52 flex flex-col items-center justify-center text-center rounded-xl bg-slate-50/70 dark:bg-[#0c1930]/50 border border-dashed border-slate-200 dark:border-[#1e3a5f] p-4 sm:p-6">
                <Cpu size={24} className="text-slate-300 dark:text-slate-600 mb-1.5 sm:mb-2 sm:w-7 sm:h-7" />
                <p className="text-[11px] sm:text-xs font-bold text-slate-600 dark:text-slate-400">
                  {isThai
                    ? "ยังไม่มีข้อมูลเปรียบเทียบเครื่องจักร"
                    : "No machine comparison data available"}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 sm:space-y-4">
                {/* TM06 Bar Block */}
                <div className="p-2.5 sm:p-3 rounded-xl border bg-amber-50/40 dark:bg-amber-950/15 border-amber-200/70 dark:border-amber-800/50">
                  <div className="flex items-center justify-between mb-1 sm:mb-1.5">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="px-1.5 sm:px-2 py-0.5 rounded-md text-[11px] sm:text-xs font-extrabold bg-amber-500 text-white">
                        TM06
                      </span>
                      <span className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-200">
                        {stats.totalTrips > 0
                          ? `${((stats.tm06.trips / stats.totalTrips) * 100).toFixed(1)}%`
                          : "0.0%"}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm sm:text-base font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">
                        {stats.tm06.trips.toLocaleString()}
                      </span>
                      <span className="text-[10.5px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 ml-1">
                        {isThai ? "รอบ" : "trips"}
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2 sm:h-3 rounded-full bg-slate-200/80 dark:bg-[#0c1930] overflow-hidden">
                    <div
                      style={{
                        width: `${
                          stats.totalTrips > 0
                            ? Math.max((stats.tm06.trips / stats.totalTrips) * 100, stats.tm06.trips > 0 ? 4 : 0)
                            : 0
                        }%`,
                      }}
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-300"
                    />
                  </div>
                  <div className="mt-1.5 sm:mt-2 flex items-center justify-between text-[10.5px] sm:text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                    <span>
                      {isThai ? "จำนวนแถบ:" : "Strips:"}{" "}
                      <strong className="font-mono">{stats.tm06.strips.toLocaleString()}</strong>{" "}
                      {isThai ? "แถบ" : "pcs"}
                    </span>
                    <span>
                      {isThai ? "น้ำหนัก:" : "Weight:"}{" "}
                      <strong className="font-mono">{formatTwoDecimals(stats.tm06.weightTon)}</strong>{" "}
                      {isThai ? "ตัน" : "tons"}
                    </span>
                  </div>
                </div>

                {/* TM07 Bar Block */}
                <div className="p-2.5 sm:p-3 rounded-xl border bg-blue-50/40 dark:bg-blue-950/15 border-blue-200/70 dark:border-blue-800/50">
                  <div className="flex items-center justify-between mb-1 sm:mb-1.5">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="px-1.5 sm:px-2 py-0.5 rounded-md text-[11px] sm:text-xs font-extrabold bg-blue-600 text-white">
                        TM07
                      </span>
                      <span className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-200">
                        {stats.totalTrips > 0
                          ? `${((stats.tm07.trips / stats.totalTrips) * 100).toFixed(1)}%`
                          : "0.0%"}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm sm:text-base font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">
                        {stats.tm07.trips.toLocaleString()}
                      </span>
                      <span className="text-[10.5px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 ml-1">
                        {isThai ? "รอบ" : "trips"}
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2 sm:h-3 rounded-full bg-slate-200/80 dark:bg-[#0c1930] overflow-hidden">
                    <div
                      style={{
                        width: `${
                          stats.totalTrips > 0
                            ? Math.max((stats.tm07.trips / stats.totalTrips) * 100, stats.tm07.trips > 0 ? 4 : 0)
                            : 0
                        }%`,
                      }}
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 transition-all duration-300"
                    />
                  </div>
                  <div className="mt-1.5 sm:mt-2 flex items-center justify-between text-[10.5px] sm:text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                    <span>
                      {isThai ? "จำนวนแถบ:" : "Strips:"}{" "}
                      <strong className="font-mono">{stats.tm07.strips.toLocaleString()}</strong>{" "}
                      {isThai ? "แถบ" : "pcs"}
                    </span>
                    <span>
                      {isThai ? "น้ำหนัก:" : "Weight:"}{" "}
                      <strong className="font-mono">{formatTwoDecimals(stats.tm07.weightTon)}</strong>{" "}
                      {isThai ? "ตัน" : "tons"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Search and Quick Filter Bar */}
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
        <div className="relative flex-1 min-w-0">
          <Search size={13} className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 text-slate-400 sm:w-3.5 sm:h-3.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              isThai
                ? "ค้นหาใบสั่งเบิก, Batch, วันที่..."
                : "Search Order, Batch, Date..."
            }
            className="w-full pl-8 sm:pl-9 pr-3 sm:pr-4 py-1.5 sm:py-2 rounded-lg text-[11px] sm:text-xs bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">
          <span className="sm:hidden">
            {isThai ? `${filteredTrips.length}/${computedTrips.length} รอบ` : `${filteredTrips.length}/${computedTrips.length}`}
          </span>
          <span className="hidden sm:inline">
            {isThai
              ? `แสดง ${filteredTrips.length} รอบการขนย้าย (จากทั้งหมด ${computedTrips.length} รอบในเดือนนี้)`
              : `Showing ${filteredTrips.length} of ${computedTrips.length} trips`}
          </span>
        </div>
      </div>

      {/* 4. Trips Table or Empty State */}
      {filteredTrips.length === 0 ? (
        /* Clean Production Empty State */
        <div className="rounded-xl sm:rounded-2xl border p-6 sm:p-12 text-center bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
          <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-2 sm:mb-3 rounded-xl sm:rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-500">
            <Truck size={24} className="sm:w-8 sm:h-8" />
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
            {isThai
              ? "ไม่พบข้อมูลการใช้งาน Transfer Car ในเดือนที่เลือก"
              : "No Transfer Car Usage Records Found"}
          </h3>
          <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4">
            {isThai
              ? `ยังไม่มีรายการเบิกหรือขนย้ายเหล็กสลิตเข้าเครื่อง TM06 หรือ TM07 ในช่วงเดือน ${selectedMonth} หรือไม่ตรงกับเงื่อนไขการค้นหา`
              : `No slit coils were transported to TM06 or TM07 during ${selectedMonth}.`}
          </p>
          <div className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-[#0c1930] text-[11px] text-slate-600 dark:text-slate-300">
            <AlertCircle size={13} className="text-amber-500" />
            <span>
              {isThai
                ? "ข้อมูลจะถูกบันทึกอัตโนมัติเมื่อมีการสแกนในเมนู 'จ่ายหน้าเครื่อง' (Machine Issue) ของเครื่อง TM06 หรือ TM07"
                : "Trips are recorded automatically upon scanning at Machine Issue for TM06 or TM07"}
            </span>
          </div>
        </div>
      ) : (
        /* Detailed Trips Table */
        <div className="rounded-xl sm:rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[10.5px] sm:text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0c1930] text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px] sm:text-[11px]">
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit w-9 sm:w-12">#</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "รอบที่" : "Trip No."}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "วันที่" : "Date"}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "ช่วงเวลาย้าย" : "Time Window"}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "เครื่องจักร" : "Machine"}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "เลขที่ใบสั่งเบิก" : "Order No."}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "จำนวนแถบ" : "Strips"}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-right !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "น้ำหนักรวม (กก.)" : "Weight (kg)"}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-right !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "น้ำหนักรวม (ตัน)" : "Weight (ton)"}</th>
                  <th className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center !bg-transparent !text-inherit w-20 sm:w-28 whitespace-nowrap">{isThai ? "รายละเอียด" : "Actions"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1e3a5f]/60">
                {filteredTrips.map((trip) => {
                  const isExpanded = expandedTripId === trip.id;
                  const isTM06 = trip.machineId === "TM06";

                  return (
                    <React.Fragment key={trip.id}>
                      <tr
                        className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-[#152646] ${
                          isExpanded ? "bg-amber-50/40 dark:bg-amber-950/20" : ""
                        }`}
                      >
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center text-slate-400 font-mono text-[10px] sm:text-[11px] w-9 sm:w-12">
                          <button
                            type="button"
                            onClick={() => setExpandedTripId(isExpanded ? null : trip.id)}
                            className="inline-flex items-center justify-center p-0.5 sm:p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                          >
                            {isExpanded ? <ChevronDown size={13} className="sm:w-3.5 sm:h-3.5" /> : <ChevronRight size={13} className="sm:w-3.5 sm:h-3.5" />}
                          </button>
                        </td>

                        {/* Trip Number */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                          <span className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono text-[10.5px] sm:text-xs">
                            <Truck size={11} className="text-amber-500 shrink-0 sm:w-3 sm:h-3" />
                            <span>{isThai ? `รอบที่ ${trip.tripNo}` : `Trip #${trip.tripNo}`}</span>
                          </span>
                        </td>

                        {/* Date */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          <div className="inline-flex items-center justify-center gap-1 sm:gap-1.5">
                            <Calendar size={12} className="text-slate-400 shrink-0 hidden sm:block sm:w-[13px] sm:h-[13px]" />
                            <span>{trip.displayDate}</span>
                          </div>
                        </td>

                        {/* Time Window */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center font-mono text-[10.5px] sm:text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          <div className="inline-flex items-center justify-center gap-1 sm:gap-1.5">
                            <Clock size={12} className="text-amber-500 shrink-0 hidden sm:block sm:w-[13px] sm:h-[13px]" />
                            <span>{trip.timePeriod}</span>
                          </div>
                        </td>

                        {/* Machine Badge */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center justify-center px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-extrabold ${
                              isTM06
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                                : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-300 dark:border-blue-700"
                            }`}
                          >
                            {trip.machineId}
                          </span>
                        </td>

                        {/* Order No */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center font-mono text-[10.5px] sm:text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          {trip.orderNo}
                        </td>

                        {/* Strip Count */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center font-bold text-slate-800 dark:text-slate-100 tabular-nums whitespace-nowrap">
                          <span className="inline-flex items-center justify-center px-1.5 sm:px-2 py-0.5 rounded bg-slate-100 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                            {trip.stripCount} {isThai ? "แถบ" : "pcs"}
                          </span>
                        </td>

                        {/* Total Weight Kg */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-right font-mono font-bold text-slate-800 dark:text-slate-100 tabular-nums whitespace-nowrap">
                          {formatTwoDecimals(trip.totalWeightKg)}
                        </td>

                        {/* Total Weight Ton */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-right font-mono font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                          {formatTwoDecimals(trip.totalWeightTon)}
                        </td>

                        {/* Expand/Collapse Button */}
                        <td className="!py-2 sm:!py-3 !px-2 sm:!px-3.5 !text-center w-20 sm:w-28 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpandedTripId(isExpanded ? null : trip.id)}
                            className="inline-flex items-center justify-center gap-0.5 sm:gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[10px] sm:text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 border border-amber-200 dark:border-amber-800 cursor-pointer transition-all"
                          >
                            <span>{isExpanded ? (isThai ? "ซ่อน" : "Hide") : (isThai ? "ดูแถบย่อย" : "View Coils")}</span>
                            {isExpanded ? <ChevronDown size={11} className="sm:w-3 sm:h-3" /> : <ChevronRight size={11} className="sm:w-3 sm:h-3" />}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Coils Breakdown Sub-table */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70 dark:bg-[#0a1628]/80 border-b border-slate-200 dark:border-[#1e3a5f]">
                          <td colSpan={10} className="!p-2 sm:!p-4">
                            <div className="rounded-lg sm:rounded-xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] p-2 sm:p-3 shadow-inner">
                              <div className="flex items-center justify-between pb-1.5 sm:pb-2 mb-1.5 sm:mb-2 border-b border-slate-100 dark:border-[#1e3a5f]/80">
                                <span className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 sm:gap-1.5">
                                  <Layers size={13} className="text-amber-500 shrink-0 sm:w-3.5 sm:h-3.5" />
                                  <span>
                                    {isThai
                                      ? `รายการแถบเหล็กสลิตที่ขนย้ายในรอบนี้ (${trip.items.length} รายการ)`
                                      : `Coil strips transported in this trip (${trip.items.length} items)`}
                                  </span>
                                </span>
                                <span className="text-[10.5px] sm:text-[11px] text-slate-400 font-mono shrink-0">
                                  {isThai ? "ปลายทาง: " : "Destination: "}
                                  <strong className="text-slate-700 dark:text-slate-200">{trip.machineId}</strong>
                                </span>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-[10.5px] sm:text-xs border-collapse">
                                  <thead>
                                    <tr className="text-[10px] sm:text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-[#1e3a5f] bg-slate-50/60 dark:bg-[#0c1930]/60">
                                      <th className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center !bg-transparent !text-inherit w-8 sm:w-10">#</th>
                                      <th className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-left !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "รหัส Batch" : "Batch No."}</th>
                                      <th className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "ความหนา (mm)" : "Thickness (mm)"}</th>
                                      <th className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "ความกว้าง (mm)" : "Width (mm)"}</th>
                                      <th className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "เกรด (Grade)" : "Grade"}</th>
                                      <th className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-right !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "น้ำหนัก (กก.)" : "Weight (kg)"}</th>
                                      <th className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center !bg-transparent !text-inherit whitespace-nowrap">{isThai ? "เวลายิงสแกน" : "Scan Time"}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-[#1e3a5f]/40">
                                    {trip.items.map((item, idx) => (
                                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-[#152646]/60">
                                        <td className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center font-mono text-[10px] sm:text-[11px] text-slate-400 w-8 sm:w-10">
                                          {idx + 1}
                                        </td>
                                        <td className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-left font-mono font-bold text-blue-600 dark:text-cyan-400 whitespace-nowrap">
                                          {item.batch}
                                        </td>
                                        <td className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                          {item.certThickness}
                                        </td>
                                        <td className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                          {item.width}
                                        </td>
                                        <td className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                          {item.grade}
                                        </td>
                                        <td className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-right font-mono font-bold text-slate-800 dark:text-slate-100 tabular-nums whitespace-nowrap">
                                          {formatTwoDecimals(item.weightKg)}
                                        </td>
                                        <td className="!py-1.5 sm:!py-2 !px-2 sm:!px-3 !text-center text-slate-500 font-mono text-[10px] sm:text-[11px] whitespace-nowrap">
                                          {item.timestampStr}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
