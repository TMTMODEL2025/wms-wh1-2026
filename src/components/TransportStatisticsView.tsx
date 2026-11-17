/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Calendar,
  RefreshCw,
  Search,
  Truck,
  Users,
  Package,
  Scale,
  Clock,
  Route,
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Filter,
} from "lucide-react";
import { Employee, Vehicle } from "../types/officer";
import {
  MH_SHIFTS,
  MH_TEAMS,
  MhTransferRecord,
  fetchMhTransfersOnce,
  subscribeToMhTransfers,
} from "../services/forkliftDataService";
import { TransportStatisticsCharts } from "./TransportStatisticsCharts";

interface TransportStatisticsViewProps {
  vehicles: Vehicle[];
  employees?: Employee[];
}

type DatePreset = "today" | "yesterday" | "last7" | "thisMonth" | "all" | "custom";
type StatusScope = "active" | "completed" | "all";
type StatsTab = "overview" | "vehicles" | "drivers" | "products" | "trips";

const SLA_LIMIT_SECONDS = 20 * 60;

function getLocalDateYmd(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysYmd(baseYmd: string, offsetDays: number): string {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + offsetDays);
  return getLocalDateYmd(dt);
}

function getMonthStartYmd(baseYmd: string): string {
  return `${baseYmd.slice(0, 7)}-01`;
}

function normalizeDateYmd(record: MhTransferRecord): string {
  if (record.workingDate && /^\d{4}-\d{2}-\d{2}/.test(record.workingDate)) {
    return record.workingDate.slice(0, 10);
  }
  if (record.createdAt && /^\d{4}-\d{2}-\d{2}/.test(record.createdAt)) {
    return record.createdAt.slice(0, 10);
  }
  return "";
}

function getRecordWeightKg(record: MhTransferRecord): number {
  if (typeof record.totalWeightKg === "number" && !isNaN(record.totalWeightKg)) {
    return Math.max(0, record.totalWeightKg);
  }
  if (
    typeof record.fullBundles === "number" &&
    typeof record.weightPerBundleKg === "number"
  ) {
    return Math.max(
      0,
      record.fullBundles * record.weightPerBundleKg + (record.remainderWeightKg || 0)
    );
  }
  if (typeof record.weightTon === "number" && !isNaN(record.weightTon)) {
    return Math.max(0, Math.round(record.weightTon * 1000));
  }
  return 0;
}

function getRecordBundles(record: MhTransferRecord): number {
  if (typeof record.totalBundles === "number" && !isNaN(record.totalBundles)) {
    return Math.max(0, record.totalBundles);
  }
  if (typeof record.quantity === "number" && !isNaN(record.quantity)) {
    return Math.max(0, record.quantity);
  }
  return 0;
}

function getRecordDurationSeconds(record: MhTransferRecord): number | null {
  if (record.status === "Cancelled") return null;
  if (typeof record.durationSeconds === "number" && !isNaN(record.durationSeconds)) {
    return Math.max(0, Math.round(record.durationSeconds));
  }
  if (typeof record.startTimeMs === "number" && typeof record.endTimeMs === "number") {
    return Math.max(0, Math.round((record.endTimeMs - record.startTimeMs) / 1000));
  }
  if (typeof record.durationMinutes === "number" && !isNaN(record.durationMinutes)) {
    return Math.max(0, Math.round(record.durationMinutes * 60));
  }
  return null;
}

function isRecordOverdue(record: MhTransferRecord): boolean {
  if (record.status === "Cancelled") return false;
  if (typeof record.isSlaOverdue === "boolean") return record.isSlaOverdue;
  const secs = getRecordDurationSeconds(record);
  return secs !== null && secs > SLA_LIMIT_SECONDS;
}

function formatDurationMinutesText(avgSeconds: number | null): string {
  if (avgSeconds === null || !isFinite(avgSeconds) || avgSeconds <= 0) return "-";
  const mins = Math.floor(avgSeconds / 60);
  const secs = Math.round(avgSeconds % 60);
  if (mins === 0) return `${secs} วินาที`;
  if (secs === 0) return `${mins} นาที`;
  return `${mins} น. ${secs} วิ`;
}

function formatNumber(val: number, decimals = 0): string {
  return val.toLocaleString("th-TH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatThaiDateLabel(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || "-";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export function TransportStatisticsView({
  vehicles,
  employees = [],
}: TransportStatisticsViewProps) {
  const todayYmd = useMemo(() => getLocalDateYmd(), []);

  const [transfers, setTransfers] = useState<MhTransferRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [headingActionsEl, setHeadingActionsEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHeadingActionsEl(document.getElementById("page-heading-actions"));
  }, []);

  // Filters (Date-first)
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState<string>(todayYmd);
  const [endDate, setEndDate] = useState<string>(todayYmd);
  const [statusScope, setStatusScope] = useState<StatusScope>("active");
  const [selectedTeam, setSelectedTeam] = useState<string>("all");
  const [selectedShift, setSelectedShift] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<StatsTab>("overview");

  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    setIsLoading(true);

    const unsub = subscribeToMhTransfers(
      (records) => {
        if (cancelled) return;
        resolved = true;
        setTransfers(records);
        setIsLoading(false);
      },
      () => {
        if (cancelled) return;
        resolved = true;
        setIsLoading(false);
      }
    );

    // Fallback one-time fetch so data displays quickly and never hangs if snapshot is slow
    fetchMhTransfersOnce()
      .then((records) => {
        if (cancelled || resolved) return;
        resolved = true;
        setTransfers(records);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled || resolved) return;
        resolved = true;
        setIsLoading(false);
      });

    const safetyTimer = window.setTimeout(() => {
      if (!cancelled && !resolved) {
        resolved = true;
        setIsLoading(false);
      }
    }, 6000);

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      unsub();
    };
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      const latest = await fetchMhTransfersOnce();
      setTransfers(latest);
    } finally {
      setIsRefreshing(false);
    }
  };

  const applyDatePreset = (preset: DatePreset) => {
    const nowYmd = getLocalDateYmd();
    setDatePreset(preset);
    if (preset === "today") {
      setStartDate(nowYmd);
      setEndDate(nowYmd);
    } else if (preset === "yesterday") {
      const yest = addDaysYmd(nowYmd, -1);
      setStartDate(yest);
      setEndDate(yest);
    } else if (preset === "last7") {
      setStartDate(addDaysYmd(nowYmd, -6));
      setEndDate(nowYmd);
    } else if (preset === "thisMonth") {
      setStartDate(getMonthStartYmd(nowYmd));
      setEndDate(nowYmd);
    } else if (preset === "all") {
      setStartDate("");
      setEndDate("");
    }
  };

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    setDatePreset("custom");
    if (endDate && val && val > endDate) {
      setEndDate(val);
    }
  };

  const handleEndDateChange = (val: string) => {
    setEndDate(val);
    setDatePreset("custom");
    if (startDate && val && val < startDate) {
      setStartDate(val);
    }
  };

  // Lookup maps from vehicles and employees props
  const vehicleMetaMap = useMemo(() => {
    const map = new Map<string, Vehicle>();
    for (const v of vehicles) {
      if (v.vehicleId) map.set(v.vehicleId.trim().toUpperCase(), v);
      if (v.number) map.set(v.number.trim().toUpperCase(), v);
    }
    return map;
  }, [vehicles]);

  const employeeMetaMap = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const emp of employees) {
      if (emp.employeeName) {
        map.set(emp.employeeName.trim().toLowerCase(), emp);
      }
    }
    return map;
  }, [employees]);

  // Distinct team & shift options combining constants + live records
  const availableTeams = useMemo(() => {
    const set = new Set<string>(MH_TEAMS);
    transfers.forEach((r) => {
      if (r.team && r.team.trim()) set.add(r.team.trim());
    });
    return Array.from(set);
  }, [transfers]);

  const availableShifts = useMemo(() => {
    const set = new Set<string>(MH_SHIFTS);
    transfers.forEach((r) => {
      if (r.shift && r.shift.trim()) set.add(r.shift.trim());
    });
    return Array.from(set);
  }, [transfers]);

  // 1. Records matching Date + Team + Shift + Search (before statusScope filter so we can show status counts accurately)
  const dateFilteredTransfers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transfers.filter((r) => {
      const ymd = normalizeDateYmd(r);
      if (datePreset !== "all") {
        if (startDate && ymd && ymd < startDate) return false;
        if (endDate && ymd && ymd > endDate) return false;
        if ((startDate || endDate) && !ymd) return false;
      }
      if (selectedTeam !== "all" && (r.team || "").trim() !== selectedTeam) {
        return false;
      }
      if (selectedShift !== "all" && (r.shift || "").trim() !== selectedShift) {
        return false;
      }
      if (q) {
        const haystack = [
          r.transferCode,
          r.vehicleNumber,
          r.trailerNumber,
          r.driverName,
          r.itemName,
          r.transferType,
          r.originFacility,
          r.destinationFacility,
          r.team,
          r.shift,
          r.workArea,
          r.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [transfers, datePreset, startDate, endDate, selectedTeam, selectedShift, searchQuery]);

  // Status counts in the selected date/filter window
  const statusSummary = useMemo(() => {
    let completed = 0;
    let inTransit = 0;
    let pending = 0;
    let cancelled = 0;
    for (const r of dateFilteredTransfers) {
      if (r.status === "Completed") completed++;
      else if (r.status === "In Transit") inTransit++;
      else if (r.status === "Pending") pending++;
      else if (r.status === "Cancelled") cancelled++;
    }
    return {
      totalAll: dateFilteredTransfers.length,
      activeCount: completed + inTransit + pending,
      completed,
      inTransit,
      pending,
      cancelled,
    };
  }, [dateFilteredTransfers]);

  // 2. Final scoped records according to statusScope
  const scopedTransfers = useMemo(() => {
    if (statusScope === "completed") {
      return dateFilteredTransfers.filter((r) => r.status === "Completed");
    }
    if (statusScope === "active") {
      return dateFilteredTransfers.filter((r) => r.status !== "Cancelled");
    }
    return dateFilteredTransfers;
  }, [dateFilteredTransfers, statusScope]);

  // 3. Aggregated Statistics
  const stats = useMemo(() => {
    const vehicleMap = new Map<
      string,
      {
        vehicleNumber: string;
        isAssigned: boolean;
        vehicleType: string;
        registrationNumber: string;
        drivers: Set<string>;
        products: Set<string>;
        trips: number;
        completedTrips: number;
        inTransitTrips: number;
        bundles: number;
        weightKg: number;
        durationSumSec: number;
        durationCount: number;
        overdueCount: number;
      }
    >();

    const driverMap = new Map<
      string,
      {
        driverName: string;
        isAssigned: boolean;
        employeeId: string;
        vehicles: Set<string>;
        teams: Set<string>;
        shifts: Set<string>;
        trips: number;
        completedTrips: number;
        inTransitTrips: number;
        bundles: number;
        weightKg: number;
        durationSumSec: number;
        durationCount: number;
        overdueCount: number;
      }
    >();

    const productMap = new Map<
      string,
      {
        itemName: string;
        transferTypes: Set<string>;
        vehicles: Set<string>;
        drivers: Set<string>;
        trips: number;
        bundles: number;
        weightKg: number;
      }
    >();

    const transferTypeMap = new Map<
      string,
      {
        transferType: string;
        trips: number;
        bundles: number;
        weightKg: number;
      }
    >();

    const routeMap = new Map<
      string,
      {
        origin: string;
        destination: string;
        trips: number;
        bundles: number;
        weightKg: number;
        durationSumSec: number;
        durationCount: number;
      }
    >();

    const teamShiftMap = new Map<
      string,
      {
        team: string;
        shift: string;
        vehicles: Set<string>;
        drivers: Set<string>;
        trips: number;
        bundles: number;
        weightKg: number;
        overdueCount: number;
      }
    >();

    const dailyMap = new Map<
      string,
      {
        dateYmd: string;
        vehicles: Set<string>;
        drivers: Set<string>;
        trips: number;
        bundles: number;
        weightKg: number;
        completedWithSla: number;
        overdueCount: number;
      }
    >();

    let totalBundles = 0;
    let totalWeightKg = 0;
    let totalDurationSec = 0;
    let durationMeasurableCount = 0;
    let overdueCount = 0;
    let slaEvaluatedCount = 0;

    for (const r of scopedTransfers) {
      const weightKg = getRecordWeightKg(r);
      const bundles = getRecordBundles(r);
      const durSec = getRecordDurationSeconds(r);
      const overdue = isRecordOverdue(r);

      totalBundles += bundles;
      totalWeightKg += weightKg;

      if (r.status === "Completed" && durSec !== null) {
        totalDurationSec += durSec;
        durationMeasurableCount++;
      }
      if (r.status === "Completed") {
        slaEvaluatedCount++;
        if (overdue) overdueCount++;
      } else if (r.status === "In Transit" && overdue) {
        overdueCount++;
      }

      // Vehicle key
      const rawVeh = (r.vehicleNumber || "").trim();
      const isVehAssigned = rawVeh !== "" && rawVeh !== "-";
      const vehKey = isVehAssigned ? rawVeh : "ไม่ระบุรหัสรถ (-)";
      const rawDrv = (r.driverName || "").trim();
      const isDrvAssigned = rawDrv !== "" && rawDrv !== "-";
      const drvKey = isDrvAssigned ? rawDrv : "ไม่ระบุพนักงาน (-)";
      const itemKey = (r.itemName || "").trim() || "ไม่ระบุสินค้า";
      const typeKey = (r.transferType || "").trim() || "ไม่ระบุประเภท";
      const originKey = (r.originFacility || "").trim() || "-";
      const destKey = (r.destinationFacility || "").trim() || "-";
      const routeKey = `${originKey}|||${destKey}`;
      const teamKey = (r.team || "").trim() || "ไม่ระบุทีม";
      const shiftKey = (r.shift || "").trim() || "ไม่ระบุกะ";
      const tsKey = `${teamKey}|||${shiftKey}`;
      const dateYmd = normalizeDateYmd(r) || "ไม่ระบุวันที่";

      // 1. Vehicle aggregate
      let vEntry = vehicleMap.get(vehKey);
      if (!vEntry) {
        const meta = isVehAssigned ? vehicleMetaMap.get(vehKey.toUpperCase()) : undefined;
        vEntry = {
          vehicleNumber: vehKey,
          isAssigned: isVehAssigned,
          vehicleType: meta?.vehicleType || meta?.type || "-",
          registrationNumber: meta?.registrationNumber || "-",
          drivers: new Set<string>(),
          products: new Set<string>(),
          trips: 0,
          completedTrips: 0,
          inTransitTrips: 0,
          bundles: 0,
          weightKg: 0,
          durationSumSec: 0,
          durationCount: 0,
          overdueCount: 0,
        };
        vehicleMap.set(vehKey, vEntry);
      }
      vEntry.trips++;
      if (r.status === "Completed") vEntry.completedTrips++;
      if (r.status === "In Transit") vEntry.inTransitTrips++;
      vEntry.bundles += bundles;
      vEntry.weightKg += weightKg;
      if (isDrvAssigned) vEntry.drivers.add(drvKey);
      vEntry.products.add(itemKey);
      if (r.status === "Completed" && durSec !== null) {
        vEntry.durationSumSec += durSec;
        vEntry.durationCount++;
      }
      if (overdue) vEntry.overdueCount++;

      // 2. Driver aggregate
      let dEntry = driverMap.get(drvKey);
      if (!dEntry) {
        const empMeta = isDrvAssigned ? employeeMetaMap.get(drvKey.toLowerCase()) : undefined;
        dEntry = {
          driverName: drvKey,
          isAssigned: isDrvAssigned,
          employeeId: empMeta?.employeeId || "",
          vehicles: new Set<string>(),
          teams: new Set<string>(),
          shifts: new Set<string>(),
          trips: 0,
          completedTrips: 0,
          inTransitTrips: 0,
          bundles: 0,
          weightKg: 0,
          durationSumSec: 0,
          durationCount: 0,
          overdueCount: 0,
        };
        driverMap.set(drvKey, dEntry);
      }
      dEntry.trips++;
      if (r.status === "Completed") dEntry.completedTrips++;
      if (r.status === "In Transit") dEntry.inTransitTrips++;
      dEntry.bundles += bundles;
      dEntry.weightKg += weightKg;
      if (isVehAssigned) dEntry.vehicles.add(vehKey);
      if (r.team && r.team.trim()) dEntry.teams.add(r.team.trim());
      if (r.shift && r.shift.trim()) dEntry.shifts.add(r.shift.trim());
      if (r.status === "Completed" && durSec !== null) {
        dEntry.durationSumSec += durSec;
        dEntry.durationCount++;
      }
      if (overdue) dEntry.overdueCount++;

      // 3. Product aggregate
      let pEntry = productMap.get(itemKey);
      if (!pEntry) {
        pEntry = {
          itemName: itemKey,
          transferTypes: new Set<string>(),
          vehicles: new Set<string>(),
          drivers: new Set<string>(),
          trips: 0,
          bundles: 0,
          weightKg: 0,
        };
        productMap.set(itemKey, pEntry);
      }
      pEntry.trips++;
      pEntry.bundles += bundles;
      pEntry.weightKg += weightKg;
      pEntry.transferTypes.add(typeKey);
      if (isVehAssigned) pEntry.vehicles.add(vehKey);
      if (isDrvAssigned) pEntry.drivers.add(drvKey);

      // 4. TransferType aggregate
      let ttEntry = transferTypeMap.get(typeKey);
      if (!ttEntry) {
        ttEntry = {
          transferType: typeKey,
          trips: 0,
          bundles: 0,
          weightKg: 0,
        };
        transferTypeMap.set(typeKey, ttEntry);
      }
      ttEntry.trips++;
      ttEntry.bundles += bundles;
      ttEntry.weightKg += weightKg;

      // 5. Route aggregate
      let rtEntry = routeMap.get(routeKey);
      if (!rtEntry) {
        rtEntry = {
          origin: originKey,
          destination: destKey,
          trips: 0,
          bundles: 0,
          weightKg: 0,
          durationSumSec: 0,
          durationCount: 0,
        };
        routeMap.set(routeKey, rtEntry);
      }
      rtEntry.trips++;
      rtEntry.bundles += bundles;
      rtEntry.weightKg += weightKg;
      if (r.status === "Completed" && durSec !== null) {
        rtEntry.durationSumSec += durSec;
        rtEntry.durationCount++;
      }

      // 6. Team/Shift aggregate
      let tsEntry = teamShiftMap.get(tsKey);
      if (!tsEntry) {
        tsEntry = {
          team: teamKey,
          shift: shiftKey,
          vehicles: new Set<string>(),
          drivers: new Set<string>(),
          trips: 0,
          bundles: 0,
          weightKg: 0,
          overdueCount: 0,
        };
        teamShiftMap.set(tsKey, tsEntry);
      }
      tsEntry.trips++;
      tsEntry.bundles += bundles;
      tsEntry.weightKg += weightKg;
      if (isVehAssigned) tsEntry.vehicles.add(vehKey);
      if (isDrvAssigned) tsEntry.drivers.add(drvKey);
      if (overdue) tsEntry.overdueCount++;

      // 7. Daily aggregate
      let dyEntry = dailyMap.get(dateYmd);
      if (!dyEntry) {
        dyEntry = {
          dateYmd,
          vehicles: new Set<string>(),
          drivers: new Set<string>(),
          trips: 0,
          bundles: 0,
          weightKg: 0,
          completedWithSla: 0,
          overdueCount: 0,
        };
        dailyMap.set(dateYmd, dyEntry);
      }
      dyEntry.trips++;
      dyEntry.bundles += bundles;
      dyEntry.weightKg += weightKg;
      if (isVehAssigned) dyEntry.vehicles.add(vehKey);
      if (isDrvAssigned) dyEntry.drivers.add(drvKey);
      if (r.status === "Completed") dyEntry.completedWithSla++;
      if (overdue) dyEntry.overdueCount++;
    }

    const vehicleRows = Array.from(vehicleMap.values()).sort((a, b) => {
      if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
      if (b.weightKg !== a.weightKg) return b.weightKg - a.weightKg;
      return b.trips - a.trips;
    });

    const driverRows = Array.from(driverMap.values()).sort((a, b) => {
      if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
      if (b.trips !== a.trips) return b.trips - a.trips;
      return b.weightKg - a.weightKg;
    });

    const productRows = Array.from(productMap.values()).sort((a, b) => {
      if (b.weightKg !== a.weightKg) return b.weightKg - a.weightKg;
      return b.trips - a.trips;
    });

    const transferTypeRows = Array.from(transferTypeMap.values()).sort(
      (a, b) => b.trips - a.trips
    );

    const routeRows = Array.from(routeMap.values()).sort((a, b) => {
      if (b.trips !== a.trips) return b.trips - a.trips;
      return b.weightKg - a.weightKg;
    });

    const teamShiftRows = Array.from(teamShiftMap.values()).sort((a, b) => {
      if (b.trips !== a.trips) return b.trips - a.trips;
      return b.weightKg - a.weightKg;
    });

    const dailyRows = Array.from(dailyMap.values()).sort((a, b) =>
      b.dateYmd.localeCompare(a.dateYmd)
    );

    const activeVehicleCount = vehicleRows.filter((v) => v.isAssigned).length;
    const activeDriverCount = driverRows.filter((d) => d.isAssigned).length;
    const avgDurationSec =
      durationMeasurableCount > 0 ? totalDurationSec / durationMeasurableCount : null;
    const slaOnTimeRate =
      slaEvaluatedCount > 0
        ? Math.max(
            0,
            Math.round(((slaEvaluatedCount - overdueCount) / slaEvaluatedCount) * 1000) / 10
          )
        : null;

    return {
      totalTrips: scopedTransfers.length,
      activeVehicleCount,
      activeDriverCount,
      totalBundles,
      totalWeightKg,
      totalWeightTon: totalWeightKg / 1000,
      avgDurationSec,
      overdueCount,
      slaEvaluatedCount,
      slaOnTimeRate,
      vehicleRows,
      driverRows,
      productRows,
      transferTypeRows,
      routeRows,
      teamShiftRows,
      dailyRows,
    };
  }, [scopedTransfers, vehicleMetaMap, employeeMetaMap]);

  const activeVehicleNamesList = useMemo(
    () => stats.vehicleRows.filter((v) => v.isAssigned).map((v) => v.vehicleNumber),
    [stats.vehicleRows]
  );

  const activeDriverNamesList = useMemo(
    () => stats.driverRows.filter((d) => d.isAssigned).map((d) => d.driverName),
    [stats.driverRows]
  );

  const refreshButtonNode = (
    <button
      type="button"
      onClick={handleManualRefresh}
      disabled={isRefreshing}
      className="button secondary inline-flex items-center gap-1.5 disabled:opacity-50"
    >
      <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
      <span>รีเฟรชข้อมูล</span>
    </button>
  );

  return (
    <div className="space-y-6">
      {headingActionsEl ? createPortal(refreshButtonNode, headingActionsEl) : null}

      {/* Header & Filter Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] px-3.5 py-3 sm:px-[18px] sm:py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
            <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              สถิติการย้ายงาน (Transport Statistics)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหารถ, คนขับ, สินค้า, เส้นทาง..."
                className="field w-full rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-xs font-normal text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                style={{ width: "100%", height: 35, minHeight: 35, padding: "7px 10px 7px 32px", borderRadius: 6, fontSize: 12 }}
              />
            </div>
            {!headingActionsEl && refreshButtonNode}
          </div>
        </div>

        {/* Unified Date & Option Filter Row */}
        <div className="mt-2.5 border-t border-slate-200 dark:border-[#1e3a5f] pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Date Presets */}
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0">
              <Calendar className="h-3.5 w-3.5" />
              ตัวกรองวันที่:
            </span>
            <div className="inline-flex min-h-[35px] flex-wrap items-center rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-100 dark:bg-[#0c162c] p-0.5 gap-0.5 shrink-0">
              {[
                { id: "today" as DatePreset, label: "วันนี้" },
                { id: "yesterday" as DatePreset, label: "เมื่อวาน" },
                { id: "last7" as DatePreset, label: "7 วันล่าสุด" },
                { id: "thisMonth" as DatePreset, label: "เดือนนี้" },
                { id: "all" as DatePreset, label: "ทั้งหมด" },
              ].map((preset) => {
                const isActive = datePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyDatePreset(preset.id)}
                    className={`h-[29px] rounded px-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      isActive
                        ? "bg-white dark:bg-[#162544] text-blue-600 dark:text-blue-400 shadow-xs"
                        : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Custom Start / End Date Pickers */}
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                aria-label="ตั้งแต่วันที่"
                title="ตั้งแต่วันที่"
                className="field rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-xs font-mono font-normal text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:border-blue-500 focus:outline-none"
                style={{ height: 35, minHeight: 35, padding: "6px 8px", borderRadius: 6, fontSize: 12 }}
              />
              <span className="text-slate-400 text-xs">–</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => handleEndDateChange(e.target.value)}
                aria-label="ถึงวันที่"
                title="ถึงวันที่"
                className="field rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-xs font-mono font-normal text-slate-900 dark:text-slate-100 dark:[color-scheme:dark] focus:border-blue-500 focus:outline-none"
                style={{ height: 35, minHeight: 35, padding: "6px 8px", borderRadius: 6, fontSize: 12 }}
              />
            </div>

            {/* Select Option Filters on the same row */}
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <select
                value={statusScope}
                onChange={(e) => setStatusScope(e.target.value as StatusScope)}
                aria-label="กรองสถานะงาน"
                className="field rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-xs font-normal text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none max-w-[215px]"
                style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
              >
                <option value="active">
                  งานปฏิบัติการจริง (ไม่รวมยกเลิก) · {statusSummary.activeCount} เที่ยว
                </option>
                <option value="completed">
                  เฉพาะงานส่งเสร็จแล้ว (Completed) · {statusSummary.completed} เที่ยว
                </option>
                <option value="all">
                  ทั้งหมด (รวมยกเลิก) · {statusSummary.totalAll} เที่ยว
                </option>
              </select>
            </div>

            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              aria-label="กรองตามทีม"
              className="field rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-xs font-normal text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none shrink-0"
              style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
            >
              <option value="all">ทีม: ทุกทีม</option>
              {availableTeams.map((tm) => (
                <option key={tm} value={tm}>
                  {tm}
                </option>
              ))}
            </select>

            <select
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value)}
              aria-label="กรองตามกะ"
              className="field rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-xs font-normal text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none shrink-0"
              style={{ height: 35, minHeight: 35, padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
            >
              <option value="all">กะทำงาน: ทุกกะ</option>
              {availableShifts.map((sh) => (
                <option key={sh} value={sh}>
                  {sh}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: Vehicles */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>รถโฟล์คลิฟท์ที่ย้ายงาน</span>
            <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatNumber(stats.activeVehicleCount)}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">คัน</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 truncate" title={activeVehicleNamesList.join(", ")}>
            {activeVehicleNamesList.length > 0
              ? activeVehicleNamesList.slice(0, 4).join(", ") +
                (activeVehicleNamesList.length > 4 ? ` (+${activeVehicleNamesList.length - 4})` : "")
              : "ยังไม่มีรถปฏิบัติงาน"}
          </p>
        </div>

        {/* KPI 2: Drivers */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>พนักงานขับรถ</span>
            <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatNumber(stats.activeDriverCount)}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">คน</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 truncate" title={activeDriverNamesList.join(", ")}>
            {activeDriverNamesList.length > 0
              ? `เฉลี่ย ${formatNumber(
                  stats.totalTrips / Math.max(1, stats.activeDriverCount),
                  1
                )} เที่ยว/คน · ${activeDriverNamesList[0]}`
              : "ยังไม่มีผู้ขับปฏิบัติงาน"}
          </p>
        </div>

        {/* KPI 3: Trips & Bundles */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>เที่ยวงาน & จำนวนมัด</span>
            <Package className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatNumber(stats.totalTrips)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              เที่ยว · {formatNumber(stats.totalBundles)} มัด
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
            เสร็จสิ้น {statusSummary.completed} · กำลังส่ง {statusSummary.inTransit} · ยกเลิก{" "}
            {statusSummary.cancelled}
          </p>
        </div>

        {/* KPI 4: Total Weight */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>น้ำหนักขนย้ายรวม</span>
            <Scale className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatNumber(stats.totalWeightTon, 2)}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">ตัน</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
            {formatNumber(stats.totalWeightKg)} กก. · เฉลี่ย{" "}
            {stats.totalTrips > 0
              ? formatNumber(Math.round(stats.totalWeightKg / stats.totalTrips))
              : 0}{" "}
            กก./เที่ยว
          </p>
        </div>

        {/* KPI 5: SLA & Cycle Time */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>ตรงเวลา SLA ≤ 20 นาที</span>
            <Clock className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {stats.slaOnTimeRate !== null ? `${formatNumber(stats.slaOnTimeRate, 1)}%` : "-"}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              (เกิน {stats.overdueCount} เที่ยว)
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
            เวลาเฉลี่ยต่อเที่ยว:{" "}
            <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
              {formatDurationMinutesText(stats.avgDurationSec)}
            </span>
          </p>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center rounded-lg bg-slate-100 dark:bg-slate-800/80 p-1 gap-1">
          {[
            { id: "overview" as StatsTab, label: "ภาพรวมทั้งหมด" },
            { id: "vehicles" as StatsTab, label: `รายรถโฟล์คลิฟท์ (${stats.vehicleRows.length})` },
            { id: "drivers" as StatsTab, label: `รายพนักงานขับรถ (${stats.driverRows.length})` },
            { id: "products" as StatsTab, label: `สินค้า & เส้นทาง (${stats.productRows.length})` },
            { id: "trips" as StatsTab, label: `รายการงานละเอียด (${scopedTransfers.length})` },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          แสดงผลจาก {formatNumber(scopedTransfers.length)} รายการขนย้าย
          {statusScope === "active" && statusSummary.cancelled > 0
            ? ` (ไม่รวมงานยกเลิก ${statusSummary.cancelled} รายการ)`
            : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-sm text-slate-500 dark:text-slate-400">
          กำลังโหลดข้อมูลสถิติการขนย้าย...
        </div>
      ) : scopedTransfers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            ไม่พบข้อมูลการย้ายงานในช่วงวันที่และเงื่อนไขที่เลือก
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            ลองเปลี่ยนตัวกรองเป็น &quot;7 วันล่าสุด&quot;, &quot;เดือนนี้&quot; หรือ &quot;ทั้งหมด&quot; เพื่อดูสถิติย้อนหลัง
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {activeTab !== "trips" && (
            <TransportStatisticsCharts
              mode={activeTab}
              transfers={scopedTransfers}
              vehicleRows={stats.vehicleRows}
              driverRows={stats.driverRows}
              productRows={stats.productRows}
              transferTypeRows={stats.transferTypeRows}
              routeRows={stats.routeRows}
              dailyRows={stats.dailyRows}
              totalWeightKg={stats.totalWeightKg}
              totalTrips={stats.totalTrips}
              totalBundles={stats.totalBundles}
              slaEvaluatedCount={stats.slaEvaluatedCount}
              overdueCount={stats.overdueCount}
              statusSummary={statusSummary}
              getRecordWeightKg={getRecordWeightKg}
              getRecordBundles={getRecordBundles}
            />
          )}

          {/* SECTION 1: Vehicles Breakdown */}
          {(activeTab === "overview" || activeTab === "vehicles") && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    1. สถิติแยกตามรถโฟล์คลิฟท์ ({stats.activeVehicleCount} คันที่ระบุรหัสรถ)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    แสดงปริมาณงาน น้ำหนักที่ขนย้าย และผู้ขับขี่ที่ใช้รถแต่ละคัน
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  รวม {formatNumber(stats.totalTrips)} เที่ยว · {formatNumber(stats.totalWeightTon, 2)} ตัน
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="ts-stats-table w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="ts-center w-12 px-4 py-3 font-semibold whitespace-nowrap">#</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">รหัสรถ / ประเภท</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">ทะเบียน</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">พนักงานขับรถที่ใช้รถคันนี้</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เที่ยว</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">มัดรวม</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (กก.)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (ตัน)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เวลาเฉลี่ย</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เกิน SLA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {stats.vehicleRows.map((v, idx) => {
                      const sharePct =
                        stats.totalWeightKg > 0 ? (v.weightKg / stats.totalWeightKg) * 100 : 0;
                      return (
                        <tr
                          key={v.vehicleNumber}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="ts-center w-12 px-4 py-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                            {idx + 1}
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {v.vehicleNumber}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {v.vehicleType !== "-" ? v.vehicleType : "ไม่ระบุประเภท"}
                            </div>
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap font-mono text-slate-600 dark:text-slate-300">
                            {v.registrationNumber}
                          </td>
                          <td className="ts-left ts-wrap px-4 py-3 text-slate-700 dark:text-slate-200 min-w-[180px] max-w-[260px]">
                            {v.drivers.size > 0 ? Array.from(v.drivers).join(", ") : "-"}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatNumber(v.trips)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatNumber(v.bundles)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatNumber(v.weightKg)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatNumber(v.weightKg / 1000, 2)}
                            </span>
                            <span className="ml-1.5 text-[11px] text-slate-400">
                              ({formatNumber(sharePct, 0)}%)
                            </span>
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {v.durationCount > 0
                              ? formatDurationMinutesText(v.durationSumSec / v.durationCount)
                              : "-"}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                            <span
                              className={
                                v.overdueCount > 0
                                  ? "font-semibold text-rose-600 dark:text-rose-400"
                                  : "text-slate-400"
                              }
                            >
                              {v.overdueCount}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SECTION 2: Drivers Breakdown */}
          {(activeTab === "overview" || activeTab === "drivers") && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    2. สถิติรายพนักงานขับรถ ({stats.activeDriverCount} คน)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    รายชื่อผู้ขับขี่ จำนวนเที่ยวขนย้าย ปริมาณมัด น้ำหนักรวม และความตรงต่อเวลา (SLA)
                  </p>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  รายชื่อทั้งหมด: {activeDriverNamesList.join(", ") || "-"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="ts-stats-table w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="ts-center w-12 px-4 py-3 font-semibold whitespace-nowrap">#</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">ชื่อพนักงานขับรถ</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">รถที่ใช้งาน</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">ทีม / กะ</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เที่ยว</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">มัดรวม</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (กก.)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (ตัน)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เวลาเฉลี่ย</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">SLA ตรงเวลา</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {stats.driverRows.map((d, idx) => {
                      const onTimePct =
                        d.completedTrips > 0
                          ? Math.max(
                              0,
                              ((d.completedTrips - d.overdueCount) / d.completedTrips) * 100
                            )
                          : null;
                      return (
                        <tr
                          key={d.driverName}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="ts-center w-12 px-4 py-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                            {idx + 1}
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {d.driverName}
                            </div>
                            {d.employeeId && (
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                รหัส {d.employeeId}
                              </div>
                            )}
                          </td>
                          <td className="ts-left ts-wrap px-4 py-3 text-slate-700 dark:text-slate-200 font-mono min-w-[120px] max-w-[220px]">
                            {d.vehicles.size > 0 ? Array.from(d.vehicles).join(", ") : "-"}
                          </td>
                          <td className="ts-left px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {[
                              d.teams.size > 0 ? Array.from(d.teams).join(", ") : "-",
                              d.shifts.size > 0 ? Array.from(d.shifts).join(", ") : "-",
                            ].join(" · ")}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatNumber(d.trips)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatNumber(d.bundles)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatNumber(d.weightKg)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatNumber(d.weightKg / 1000, 2)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {d.durationCount > 0
                              ? formatDurationMinutesText(d.durationSumSec / d.durationCount)
                              : "-"}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                            {onTimePct !== null ? (
                              <span
                                className={
                                  onTimePct >= 90
                                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                    : onTimePct >= 75
                                    ? "font-semibold text-amber-600 dark:text-amber-400"
                                    : "font-semibold text-rose-600 dark:text-rose-400"
                                }
                              >
                                {formatNumber(onTimePct, 0)}%
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SECTION 3 & 4: Products, Transfer Types, Routes & Team/Shift */}
          {(activeTab === "overview" || activeTab === "products") && (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Products Breakdown (2 cols) */}
                <section className="xl:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                  <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        3. สถิติแยกตามรายการสินค้าที่ขนย้าย ({stats.productRows.length} รายการ)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        สรุปชนิดสินค้า จำนวนเที่ยว จำนวนมัด และน้ำหนักรวมสุทธิ
                      </p>
                    </div>
                    <Layers className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="ts-stats-table w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">สินค้า</th>
                          <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">ประเภทงาน</th>
                          <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เที่ยว</th>
                          <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">มัด</th>
                          <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (กก.)</th>
                          <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">ตัน</th>
                          <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap w-36 min-w-[144px]">สัดส่วนน้ำหนัก</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {stats.productRows.map((p) => {
                          const pct =
                            stats.totalWeightKg > 0
                              ? (p.weightKg / stats.totalWeightKg) * 100
                              : 0;
                          return (
                            <tr
                              key={p.itemName}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                            >
                              <td className="ts-left px-4 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {p.itemName}
                              </td>
                              <td className="ts-left px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {Array.from(p.transferTypes).join(", ")}
                              </td>
                              <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {formatNumber(p.trips)}
                              </td>
                              <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {formatNumber(p.bundles)}
                              </td>
                              <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {formatNumber(p.weightKg)}
                              </td>
                              <td className="ts-right px-4 py-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {formatNumber(p.weightKg / 1000, 2)}
                              </td>
                              <td className="ts-left px-4 py-3 whitespace-nowrap w-36 min-w-[144px]">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                    <div
                                      className="h-full bg-blue-600 dark:bg-blue-400"
                                      style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                                    />
                                  </div>
                                  <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 w-10 text-right">
                                    {formatNumber(pct, 1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Transfer Type + Team/Shift Breakdown (1 col) */}
                <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
                  <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      4. แยกตามประเภทงาน & ทีม/กะ
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      จำแนกงาน Stock / ทั่วไป / งานฝาก และสรุปตามกะทำงาน
                    </p>
                  </div>

                  <div className="p-4 space-y-5 flex-1">
                    <div>
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        ประเภทงานย้ายสินค้า
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                        {stats.transferTypeRows.map((tt) => (
                          <div
                            key={tt.transferType}
                            className="flex items-center justify-between px-3 py-2 text-xs"
                          >
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {tt.transferType}
                            </span>
                            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                              {formatNumber(tt.trips)} เที่ยว · {formatNumber(tt.bundles)} มัด ·{" "}
                              <strong className="text-slate-900 dark:text-white">
                                {formatNumber(tt.weightKg / 1000, 2)} ตัน
                              </strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        สรุปตามทีมและกะทำงาน
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                        {stats.teamShiftRows.map((ts) => (
                          <div
                            key={`${ts.team}-${ts.shift}`}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                {ts.team} · {ts.shift}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                รถ {ts.vehicles.size} คัน · คนขับ {ts.drivers.size} คน
                              </div>
                            </div>
                            <div className="text-right font-mono tabular-nums shrink-0">
                              <div className="font-semibold text-slate-900 dark:text-white">
                                {formatNumber(ts.trips)} เที่ยว
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {formatNumber(ts.weightKg / 1000, 2)} ตัน
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {/* Routes Table */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      5. สถิติเส้นทางขนย้าย (ต้นทาง → ปลายทาง · {stats.routeRows.length} เส้นทาง)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      จัดลำดับเส้นทางที่มีความถี่ในการขนย้ายสูงสุดพร้อมเวลาเฉลี่ยต่อเที่ยว
                    </p>
                  </div>
                  <Route className="h-4 w-4 text-slate-400" />
                </div>
                <div className="overflow-x-auto">
                  <table className="ts-stats-table w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="ts-center w-12 px-4 py-3 font-semibold whitespace-nowrap">#</th>
                        <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">จุดส่งต้นทาง</th>
                        <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">จุดส่งปลายทาง</th>
                        <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เที่ยว</th>
                        <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">มัดรวม</th>
                        <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (กก.)</th>
                        <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (ตัน)</th>
                        <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เวลาเฉลี่ย</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {stats.routeRows.map((rt, idx) => (
                        <tr
                          key={`${rt.origin}-${rt.destination}`}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="ts-center w-12 px-4 py-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                            {idx + 1}
                          </td>
                          <td className="ts-left px-4 py-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {rt.origin}
                          </td>
                          <td className="ts-left px-4 py-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            → {rt.destination}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatNumber(rt.trips)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatNumber(rt.bundles)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatNumber(rt.weightKg)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatNumber(rt.weightKg / 1000, 2)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {rt.durationCount > 0
                              ? formatDurationMinutesText(rt.durationSumSec / rt.durationCount)
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* Daily Trend (shown when range spans multiple days) */}
          {activeTab === "overview" && stats.dailyRows.length > 1 && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  6. สรุปสถิติรายวัน ({stats.dailyRows.length} วัน)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  เปรียบเทียบจำนวนรถ จำนวนพนักงานขับรถ เที่ยวงาน และน้ำหนักขนย้ายในแต่ละวัน
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="ts-stats-table w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">วันที่</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">รถ (คัน)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">คนขับ (คน)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เที่ยวงาน</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">มัดรวม</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (กก.)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (ตัน)</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">เกิน SLA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {stats.dailyRows.map((dy) => (
                      <tr
                        key={dy.dateYmd}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="ts-left px-4 py-3 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatThaiDateLabel(dy.dateYmd)}
                        </td>
                        <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatNumber(dy.vehicles.size)}
                        </td>
                        <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatNumber(dy.drivers.size)}
                        </td>
                        <td className="ts-right px-4 py-3 font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatNumber(dy.trips)}
                        </td>
                        <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatNumber(dy.bundles)}
                        </td>
                        <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatNumber(dy.weightKg)}
                        </td>
                        <td className="ts-right px-4 py-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatNumber(dy.weightKg / 1000, 2)}
                        </td>
                        <td className="ts-right px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={
                              dy.overdueCount > 0
                                ? "font-semibold text-rose-600 dark:text-rose-400"
                                : "text-slate-400"
                            }
                          >
                            {dy.overdueCount}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Raw Filtered Trips Table */}
          {activeTab === "trips" && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    รายการใบงานย้ายสินค้าทั้งหมดตามตัวกรอง ({scopedTransfers.length} รายการ)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    แสดงรายละเอียดรายเที่ยวเพื่อการตรวจสอบย้อนหลัง
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="ts-stats-table w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">วันที่ / เวลา</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">เลขที่ใบงาน</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">รถโฟล์คลิฟท์</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">พนักงานขับรถ</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">สินค้า / ประเภท</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">เส้นทาง</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">มัด</th>
                      <th className="ts-right px-4 py-3 font-semibold whitespace-nowrap">น้ำหนัก (กก.)</th>
                      <th className="ts-left px-4 py-3 font-semibold whitespace-nowrap">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {scopedTransfers.map((r) => {
                      const weightKg = getRecordWeightKg(r);
                      const bundles = getRecordBundles(r);
                      const ymd = normalizeDateYmd(r);
                      return (
                        <tr
                          key={r.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="ts-left px-4 py-3 whitespace-nowrap font-mono text-slate-600 dark:text-slate-300">
                            <div>{formatThaiDateLabel(ymd)}</div>
                            <div className="text-[11px] text-slate-400">
                              {r.startTime || "-"}
                              {r.endTime ? ` – ${r.endTime}` : ""}
                            </div>
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap font-mono font-medium text-slate-900 dark:text-slate-100">
                            {r.transferCode}
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap font-mono text-slate-800 dark:text-slate-200">
                            <div>{r.vehicleNumber || "-"}</div>
                            {r.trailerNumber && (
                              <div className="text-[11px] text-indigo-600 dark:text-indigo-400">
                                หาง {r.trailerNumber}
                              </div>
                            )}
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap text-slate-800 dark:text-slate-200">
                            <div>{r.driverName || "-"}</div>
                            {(r.team || r.shift) && (
                              <div className="text-[11px] text-slate-400">
                                {[r.team, r.shift].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {r.itemName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {r.transferType || "-"}
                            </div>
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {r.originFacility} → {r.destinationFacility}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatNumber(bundles)}
                          </td>
                          <td className="ts-right px-4 py-3 font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatNumber(weightKg)}
                          </td>
                          <td className="ts-left px-4 py-3 whitespace-nowrap">
                            {r.status === "Completed" ? (
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                ส่งเสร็จแล้ว
                              </span>
                            ) : r.status === "Cancelled" ? (
                              <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
                                <XCircle className="h-3.5 w-3.5" />
                                ยกเลิก
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {r.status === "In Transit" ? "กำลังขนส่ง" : "รอดำเนินการ"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
