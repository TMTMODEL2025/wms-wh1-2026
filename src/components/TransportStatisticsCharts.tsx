/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import { BarChart3, Clock, Layers, PieChart, Truck, Users } from "lucide-react";
import { MhTransferRecord } from "../services/forkliftDataService";

export type ChartMetric = "weightTon" | "trips" | "bundles";

export interface VehicleChartRow {
  vehicleNumber: string;
  isAssigned: boolean;
  vehicleType: string;
  drivers: Set<string>;
  trips: number;
  bundles: number;
  weightKg: number;
  overdueCount: number;
}

export interface DriverChartRow {
  driverName: string;
  isAssigned: boolean;
  vehicles: Set<string>;
  trips: number;
  completedTrips: number;
  bundles: number;
  weightKg: number;
  overdueCount: number;
}

export interface ProductChartRow {
  itemName: string;
  trips: number;
  bundles: number;
  weightKg: number;
}

export interface TransferTypeChartRow {
  transferType: string;
  trips: number;
  bundles: number;
  weightKg: number;
}

export interface RouteChartRow {
  origin: string;
  destination: string;
  trips: number;
  bundles: number;
  weightKg: number;
}

export interface DailyChartRow {
  dateYmd: string;
  vehicles: Set<string>;
  drivers: Set<string>;
  trips: number;
  bundles: number;
  weightKg: number;
  overdueCount: number;
}

interface TransportStatisticsChartsProps {
  mode: "overview" | "vehicles" | "drivers" | "products";
  transfers: MhTransferRecord[];
  vehicleRows: VehicleChartRow[];
  driverRows: DriverChartRow[];
  productRows: ProductChartRow[];
  transferTypeRows: TransferTypeChartRow[];
  routeRows: RouteChartRow[];
  dailyRows: DailyChartRow[];
  totalWeightKg: number;
  totalTrips: number;
  totalBundles: number;
  slaEvaluatedCount: number;
  overdueCount: number;
  statusSummary: {
    completed: number;
    inTransit: number;
    pending: number;
    cancelled: number;
  };
  getRecordWeightKg: (r: MhTransferRecord) => number;
  getRecordBundles: (r: MhTransferRecord) => number;
}

const PALETTE = [
  "#2563eb", // blue-600
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#7c3aed", // violet-600
  "#0891b2", // cyan-600
  "#dc2626", // rose-600
  "#4f46e5", // indigo-600
  "#65a30d", // lime-600
];

function formatNum(val: number, decimals = 0): string {
  return val.toLocaleString("th-TH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatShortThaiDate(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function getMetricValue(
  item: { weightKg: number; trips: number; bundles: number },
  metric: ChartMetric
): number {
  if (metric === "weightTon") return item.weightKg / 1000;
  if (metric === "trips") return item.trips;
  return item.bundles;
}

function formatMetricLabel(val: number, metric: ChartMetric): string {
  if (metric === "weightTon") return `${formatNum(val, val >= 10 ? 1 : 2)} ตัน`;
  if (metric === "trips") return `${formatNum(val)} เที่ยว`;
  return `${formatNum(val)} มัด`;
}

function getMetricUnitName(metric: ChartMetric): string {
  if (metric === "weightTon") return "ตัน";
  if (metric === "trips") return "เที่ยว";
  return "มัด";
}

function extractRecordHour(r: MhTransferRecord): number | null {
  if (r.startTime && /^\d{1,2}:\d{2}/.test(r.startTime.trim())) {
    const h = Number(r.startTime.trim().split(":")[0]);
    if (!isNaN(h) && h >= 0 && h <= 23) return h;
  }
  if (typeof r.startTimeMs === "number" && r.startTimeMs > 0) {
    return new Date(r.startTimeMs).getHours();
  }
  if (r.createdAt) {
    const match = r.createdAt.match(/[\sT](\d{2}):\d{2}/);
    if (match) {
      const h = Number(match[1]);
      if (!isNaN(h) && h >= 0 && h <= 23) return h;
    }
  }
  return null;
}

export function TransportStatisticsCharts({
  mode,
  transfers,
  vehicleRows,
  driverRows,
  productRows,
  transferTypeRows,
  routeRows,
  dailyRows,
  totalWeightKg,
  totalTrips,
  totalBundles,
  slaEvaluatedCount,
  overdueCount,
  statusSummary,
  getRecordWeightKg,
  getRecordBundles,
}: TransportStatisticsChartsProps) {
  const [metric, setMetric] = useState<ChartMetric>("weightTon");
  const [hoveredTimeIdx, setHoveredTimeIdx] = useState<number | null>(null);
  const [hoveredProductIdx, setHoveredProductIdx] = useState<number | null>(null);

  // Time-series data: Hourly when single day, Daily ascending when multi-day
  const isHourlyMode = dailyRows.length <= 1;

  const timeSeriesPoints = useMemo(() => {
    if (isHourlyMode) {
      const hourMap = new Map<
        number,
        { label: string; trips: number; bundles: number; weightKg: number }
      >();
      let minHour = 7;
      let maxHour = 19;

      for (const r of transfers) {
        const h = extractRecordHour(r);
        if (h === null) continue;
        if (h < minHour) minHour = h;
        if (h > maxHour) maxHour = h;
        const curr = hourMap.get(h) || {
          label: `${String(h).padStart(2, "0")}:00`,
          trips: 0,
          bundles: 0,
          weightKg: 0,
        };
        curr.trips++;
        curr.bundles += getRecordBundles(r);
        curr.weightKg += getRecordWeightKg(r);
        hourMap.set(h, curr);
      }

      const pts: Array<{
        key: string;
        label: string;
        trips: number;
        bundles: number;
        weightKg: number;
        extra?: string;
      }> = [];
      for (let h = minHour; h <= maxHour; h++) {
        const entry = hourMap.get(h);
        pts.push({
          key: `h-${h}`,
          label: `${String(h).padStart(2, "0")}:00`,
          trips: entry?.trips || 0,
          bundles: entry?.bundles || 0,
          weightKg: entry?.weightKg || 0,
        });
      }
      return pts;
    }

    // Multi-day chronological ascending
    return [...dailyRows]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.dateYmd))
      .sort((a, b) => a.dateYmd.localeCompare(b.dateYmd))
      .map((d) => ({
        key: d.dateYmd,
        label: formatShortThaiDate(d.dateYmd),
        trips: d.trips,
        bundles: d.bundles,
        weightKg: d.weightKg,
        extra: `รถ ${d.vehicles.size} คัน · คนขับ ${d.drivers.size} คน`,
      }));
  }, [isHourlyMode, transfers, dailyRows, getRecordBundles, getRecordWeightKg]);

  const maxTimeValue = useMemo(() => {
    let maxVal = 0;
    for (const pt of timeSeriesPoints) {
      const v = getMetricValue(pt, metric);
      if (v > maxVal) maxVal = v;
    }
    return maxVal > 0 ? maxVal : 1;
  }, [timeSeriesPoints, metric]);

  // Donut data for Products (group items beyond top 6 into "อื่นๆ")
  const donutProducts = useMemo(() => {
    const sorted = [...productRows].sort(
      (a, b) => getMetricValue(b, metric) - getMetricValue(a, metric)
    );
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);
    const items = top.map((p, idx) => ({
      name: p.itemName,
      trips: p.trips,
      bundles: p.bundles,
      weightKg: p.weightKg,
      value: getMetricValue(p, metric),
      color: PALETTE[idx % PALETTE.length],
    }));

    if (rest.length > 0) {
      const sumTrips = rest.reduce((acc, r) => acc + r.trips, 0);
      const sumBundles = rest.reduce((acc, r) => acc + r.bundles, 0);
      const sumKg = rest.reduce((acc, r) => acc + r.weightKg, 0);
      items.push({
        name: `อื่นๆ (${rest.length} รายการ)`,
        trips: sumTrips,
        bundles: sumBundles,
        weightKg: sumKg,
        value: getMetricValue({ trips: sumTrips, bundles: sumBundles, weightKg: sumKg }, metric),
        color: "#94a3b8",
      });
    }
    const total = items.reduce((acc, it) => acc + it.value, 0);
    return { items, total };
  }, [productRows, metric]);

  // Top vehicles / drivers sorted by selected metric
  const sortedVehicles = useMemo(() => {
    return [...vehicleRows]
      .sort((a, b) => getMetricValue(b, metric) - getMetricValue(a, metric))
      .slice(0, mode === "vehicles" ? 20 : 8);
  }, [vehicleRows, metric, mode]);

  const maxVehicleVal = useMemo(() => {
    const m = sortedVehicles.reduce(
      (acc, v) => Math.max(acc, getMetricValue(v, metric)),
      0
    );
    return m > 0 ? m : 1;
  }, [sortedVehicles, metric]);

  const sortedDrivers = useMemo(() => {
    return [...driverRows]
      .sort((a, b) => getMetricValue(b, metric) - getMetricValue(a, metric))
      .slice(0, mode === "drivers" ? 20 : 8);
  }, [driverRows, metric, mode]);

  const maxDriverVal = useMemo(() => {
    const m = sortedDrivers.reduce(
      (acc, d) => Math.max(acc, getMetricValue(d, metric)),
      0
    );
    return m > 0 ? m : 1;
  }, [sortedDrivers, metric]);

  const topRoutes = useMemo(() => {
    return [...routeRows]
      .sort((a, b) => getMetricValue(b, metric) - getMetricValue(a, metric))
      .slice(0, 8);
  }, [routeRows, metric]);

  const maxRouteVal = useMemo(() => {
    const m = topRoutes.reduce(
      (acc, r) => Math.max(acc, getMetricValue(r, metric)),
      0
    );
    return m > 0 ? m : 1;
  }, [topRoutes, metric]);

  // Donut SVG math
  const donutSegments = useMemo(() => {
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    let accumulatedPct = 0;
    return donutProducts.items.map((item) => {
      const pct = donutProducts.total > 0 ? item.value / donutProducts.total : 0;
      const dashLen = pct * circumference;
      const offset = -accumulatedPct * circumference;
      accumulatedPct += pct;
      return {
        ...item,
        pct,
        dashArray: `${dashLen} ${circumference}`,
        dashOffset: offset,
      };
    });
  }, [donutProducts]);

  const metricTotalDisplay =
    metric === "weightTon"
      ? `${formatNum(totalWeightKg / 1000, 2)}`
      : metric === "trips"
      ? `${formatNum(totalTrips)}`
      : `${formatNum(totalBundles)}`;

  // SLA breakdown numbers
  const onTimeCount = Math.max(0, slaEvaluatedCount - overdueCount);
  const slaTotalForBar = Math.max(1, onTimeCount + overdueCount + statusSummary.inTransit + statusSummary.pending);

  return (
    <div className="space-y-4">
      {/* Shared Chart Metric Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            กราฟวิเคราะห์สถิติการย้ายงาน
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 hidden md:inline">
            · แสดงผลตามตัวกรองวันที่และเงื่อนไขปัจจุบัน
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            แกนเปรียบเทียบกราฟ:
          </span>
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1 gap-1">
            {[
              { id: "weightTon" as ChartMetric, label: "น้ำหนัก (ตัน)" },
              { id: "trips" as ChartMetric, label: "จำนวนเที่ยว" },
              { id: "bundles" as ChartMetric, label: "จำนวนมัด" },
            ].map((opt) => {
              const active = metric === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMetric(opt.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* OVERVIEW MODE: Trend + Product Donut + Vehicle Bar + Driver Bar + SLA/TransferType */}
      {mode === "overview" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* 1. Time Series Bar Chart (7 cols) */}
          <div className="xl:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span>
                    {isHourlyMode
                      ? `ปริมาณงานย้ายสินค้ารายชั่วโมง (${getMetricUnitName(metric)})`
                      : `แนวโน้มการขนย้ายรายวัน (${getMetricUnitName(metric)})`}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isHourlyMode
                    ? "แสดงช่วงเวลาที่มีการจ่ายงานหนาแน่นตลอดวัน"
                    : `เปรียบเทียบปริมาณงาน ${timeSeriesPoints.length} วันตามลำดับเวลา`}
                </p>
              </div>
              {hoveredTimeIdx !== null && timeSeriesPoints[hoveredTimeIdx] && (
                <div className="text-right text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 shrink-0">
                  <div className="font-semibold font-mono text-slate-900 dark:text-slate-100">
                    {timeSeriesPoints[hoveredTimeIdx].label}
                  </div>
                  <div className="font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
                    {formatMetricLabel(
                      getMetricValue(timeSeriesPoints[hoveredTimeIdx], metric),
                      metric
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {timeSeriesPoints[hoveredTimeIdx].trips} เที่ยว ·{" "}
                    {formatNum(timeSeriesPoints[hoveredTimeIdx].weightKg / 1000, 2)} ตัน
                  </div>
                </div>
              )}
            </div>

            {timeSeriesPoints.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12 text-xs text-slate-400">
                ไม่มีข้อมูลช่วงเวลาสำหรับแสดงกราฟ
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-end pt-2">
                <div className="relative h-52 flex items-end gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 px-1">
                  {/* Horizontal Gridlines */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 bottom-2 flex flex-col justify-between">
                    {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                      <div
                        key={ratio}
                        className="w-full border-t border-dashed border-slate-100 dark:border-slate-800/80 relative"
                      >
                        <span className="absolute -top-2.5 left-0 text-[10px] font-mono tabular-nums text-slate-400 bg-white dark:bg-slate-900 pr-1">
                          {ratio === 0
                            ? "0"
                            : metric === "weightTon"
                            ? formatNum(maxTimeValue * ratio, maxTimeValue < 5 ? 1 : 0)
                            : formatNum(Math.round(maxTimeValue * ratio))}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Bars */}
                  <div className="relative z-10 flex-1 h-full flex items-end gap-1.5 pl-7">
                    {timeSeriesPoints.map((pt, idx) => {
                      const val = getMetricValue(pt, metric);
                      const heightPct = val > 0 ? Math.max(4, (val / maxTimeValue) * 100) : 0;
                      const isHovered = hoveredTimeIdx === idx;
                      return (
                        <div
                          key={pt.key}
                          onMouseEnter={() => setHoveredTimeIdx(idx)}
                          onMouseLeave={() => setHoveredTimeIdx(null)}
                          className="flex-1 h-full flex flex-col justify-end items-center group cursor-pointer min-w-[14px]"
                          title={`${pt.label}: ${formatMetricLabel(val, metric)} (${pt.trips} เที่ยว)`}
                        >
                          {val > 0 && (
                            <span
                              className={`text-[10px] font-mono tabular-nums mb-1 transition-opacity ${
                                isHovered
                                  ? "opacity-100 text-blue-600 dark:text-blue-400 font-semibold"
                                  : "opacity-0 sm:opacity-80 text-slate-500 dark:text-slate-400"
                              }`}
                            >
                              {metric === "weightTon"
                                ? formatNum(val, val >= 10 ? 0 : 1)
                                : formatNum(val)}
                            </span>
                          )}
                          <div
                            className={`w-full max-w-[34px] rounded-t-md transition-all ${
                              val === 0
                                ? "bg-slate-100 dark:bg-slate-800/40 h-[2px]"
                                : isHovered
                                ? "bg-blue-500 dark:bg-blue-400"
                                : "bg-blue-600/85 dark:bg-blue-500/80"
                            }`}
                            style={val > 0 ? { height: `${heightPct}%` } : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* X-axis Labels */}
                <div className="flex items-center gap-1.5 pl-8 pr-1 pt-2 overflow-x-auto">
                  {timeSeriesPoints.map((pt, idx) => {
                    const showLabel =
                      timeSeriesPoints.length <= 12 ||
                      idx % 2 === 0 ||
                      idx === timeSeriesPoints.length - 1;
                    return (
                      <div
                        key={pt.key}
                        className="flex-1 text-center text-[10px] font-mono text-slate-500 dark:text-slate-400 min-w-[14px] whitespace-nowrap"
                      >
                        {showLabel ? pt.label : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 2. Product Share Donut Chart (5 cols) */}
          <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>สัดส่วนแยกตามสินค้า ({getMetricUnitName(metric)})</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  ชี้ที่กราฟหรือชื่อสินค้าเพื่อดูรายละเอียดแต่ละรายการ
                </p>
              </div>
            </div>

            <div className="flex-1 flex flex-col sm:flex-row items-center gap-5">
              {/* SVG Donut */}
              <div className="relative w-40 h-40 shrink-0">
                <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
                  <circle
                    cx="70"
                    cy="70"
                    r="56"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="18"
                    className="text-slate-100 dark:text-slate-800"
                  />
                  {donutSegments.map((seg, idx) => {
                    const isHovered = hoveredProductIdx === idx;
                    return (
                      <circle
                        key={seg.name}
                        cx="70"
                        cy="70"
                        r="56"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={isHovered ? 22 : 18}
                        strokeDasharray={seg.dashArray}
                        strokeDashoffset={seg.dashOffset}
                        className="transition-all duration-200 cursor-pointer"
                        onMouseEnter={() => setHoveredProductIdx(idx)}
                        onMouseLeave={() => setHoveredProductIdx(null)}
                      />
                    );
                  })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-3">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[90px]">
                    {hoveredProductIdx !== null && donutSegments[hoveredProductIdx]
                      ? donutSegments[hoveredProductIdx].name
                      : "รวมทั้งหมด"}
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {hoveredProductIdx !== null && donutSegments[hoveredProductIdx]
                      ? metric === "weightTon"
                        ? formatNum(donutSegments[hoveredProductIdx].value, 2)
                        : formatNum(donutSegments[hoveredProductIdx].value)
                      : metricTotalDisplay}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {hoveredProductIdx !== null && donutSegments[hoveredProductIdx]
                      ? `${formatNum(donutSegments[hoveredProductIdx].pct * 100, 1)}%`
                      : getMetricUnitName(metric)}
                  </span>
                </div>
              </div>

              {/* Legend */}
              <div className="flex-1 w-full space-y-1.5">
                {donutSegments.map((seg, idx) => {
                  const isHovered = hoveredProductIdx === idx;
                  return (
                    <div
                      key={seg.name}
                      onMouseEnter={() => setHoveredProductIdx(idx)}
                      onMouseLeave={() => setHoveredProductIdx(null)}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
                        isHovered ? "bg-slate-100 dark:bg-slate-800" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: seg.color }}
                        />
                        <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                          {seg.name}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
                        <span className="font-semibold">
                          {metric === "weightTon"
                            ? `${formatNum(seg.value, 2)} ต.`
                            : metric === "trips"
                            ? `${formatNum(seg.value)} ท.`
                            : `${formatNum(seg.value)} ม.`}
                        </span>
                        <span className="ml-1.5 text-[11px] text-slate-400">
                          ({formatNum(seg.pct * 100, 0)}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Vehicle Horizontal Bar Chart (6 cols) */}
          <div className="xl:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span>อันดับผลงานรายรถโฟล์คลิฟท์ ({getMetricUnitName(metric)})</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  เปรียบเทียบปริมาณการขนย้ายแยกตามรหัสรถ (สูงสุด 8 อันดับแรก)
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {sortedVehicles.map((v) => {
                const val = getMetricValue(v, metric);
                const pct = maxVehicleVal > 0 ? (val / maxVehicleVal) * 100 : 0;
                return (
                  <div key={v.vehicleNumber} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="min-w-0 flex items-baseline gap-2">
                        <span className="font-semibold font-mono text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {v.vehicleNumber}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {v.drivers.size > 0 ? Array.from(v.drivers).join(", ") : "-"}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {formatMetricLabel(val, metric)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. Driver Horizontal Bar Chart (6 cols) */}
          <div className="xl:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <span>อันดับผลงานรายพนักงานขับรถ ({getMetricUnitName(metric)})</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  เปรียบเทียบปริมาณงานของพนักงานขับรถแต่ละคน (สูงสุด 8 อันดับแรก)
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {sortedDrivers.map((d) => {
                const val = getMetricValue(d, metric);
                const pct = maxDriverVal > 0 ? (val / maxDriverVal) * 100 : 0;
                return (
                  <div key={d.driverName} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="min-w-0 flex items-baseline gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {d.driverName}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          ({d.trips} เที่ยว)
                        </span>
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {formatMetricLabel(val, metric)}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-300"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 5. SLA & Transfer Type Stacked Visual Summary (12 cols) */}
          <div className="xl:col-span-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* SLA Stacked Bar */}
              <div>
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  สัดส่วนสถานะ SLA 20 นาที & ความคืบหน้างาน
                </h4>
                <div className="h-3.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  {onTimeCount > 0 && (
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${(onTimeCount / slaTotalForBar) * 100}%` }}
                      title={`ตรงเวลา SLA: ${onTimeCount} เที่ยว`}
                    />
                  )}
                  {overdueCount > 0 && (
                    <div
                      className="h-full bg-rose-500"
                      style={{ width: `${(overdueCount / slaTotalForBar) * 100}%` }}
                      title={`เกินเวลา SLA (>20 นาที): ${overdueCount} เที่ยว`}
                    />
                  )}
                  {statusSummary.inTransit + statusSummary.pending > 0 && (
                    <div
                      className="h-full bg-amber-500"
                      style={{
                        width: `${
                          ((statusSummary.inTransit + statusSummary.pending) / slaTotalForBar) * 100
                        }%`,
                      }}
                      title={`กำลังขนส่ง/รอดำเนินการ: ${statusSummary.inTransit + statusSummary.pending} เที่ยว`}
                    />
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                    ตรงเวลา ≤20น.: <strong className="text-slate-900 dark:text-white">{onTimeCount}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
                    เกิน SLA: <strong className="text-slate-900 dark:text-white">{overdueCount}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                    กำลังส่ง: <strong className="text-slate-900 dark:text-white">{statusSummary.inTransit + statusSummary.pending}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-400">
                    ยกเลิก: {statusSummary.cancelled}
                  </span>
                </div>
              </div>

              {/* Transfer Type Stacked Bar */}
              <div>
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  สัดส่วนประเภทงานย้ายสินค้า ({getMetricUnitName(metric)})
                </h4>
                <div className="h-3.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  {transferTypeRows.map((tt, idx) => {
                    const totalMetricAll = transferTypeRows.reduce(
                      (acc, r) => acc + getMetricValue(r, metric),
                      0
                    );
                    const val = getMetricValue(tt, metric);
                    const pct = totalMetricAll > 0 ? (val / totalMetricAll) * 100 : 0;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={tt.transferType}
                        className="h-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: PALETTE[idx % PALETTE.length],
                        }}
                        title={`${tt.transferType}: ${formatMetricLabel(val, metric)} (${formatNum(pct, 1)}%)`}
                      />
                    );
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                  {transferTypeRows.map((tt, idx) => {
                    const val = getMetricValue(tt, metric);
                    return (
                      <span key={tt.transferType} className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                        />
                        {tt.transferType}:{" "}
                        <strong className="text-slate-900 dark:text-white">
                          {formatMetricLabel(val, metric)}
                        </strong>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VEHICLES TAB CHART */}
      {mode === "vehicles" && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>กราฟเปรียบเทียบปริมาณงานรายรถโฟล์คลิฟท์ ({getMetricUnitName(metric)})</span>
          </h3>
          <div className="space-y-3">
            {sortedVehicles.map((v) => {
              const val = getMetricValue(v, metric);
              const pct = maxVehicleVal > 0 ? (val / maxVehicleVal) * 100 : 0;
              return (
                <div key={v.vehicleNumber} className="space-y-1">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-semibold font-mono text-slate-900 dark:text-slate-100">
                      {v.vehicleNumber} ({v.vehicleType !== "-" ? v.vehicleType : "ไม่ระบุ"})
                    </span>
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatMetricLabel(val, metric)} · {v.trips} เที่ยว · {v.bundles} มัด
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DRIVERS TAB CHART */}
      {mode === "drivers" && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>กราฟเปรียบเทียบผลงานพนักงานขับรถ ({getMetricUnitName(metric)})</span>
          </h3>
          <div className="space-y-3">
            {sortedDrivers.map((d) => {
              const val = getMetricValue(d, metric);
              const pct = maxDriverVal > 0 ? (val / maxDriverVal) * 100 : 0;
              return (
                <div key={d.driverName} className="space-y-1">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {d.driverName}
                    </span>
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatMetricLabel(val, metric)} · {d.trips} เที่ยว · รถ{" "}
                      {d.vehicles.size > 0 ? Array.from(d.vehicles).join(", ") : "-"}
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-300"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PRODUCTS & ROUTES TAB CHARTS */}
      {mode === "products" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>กราฟเปรียบเทียบสินค้าที่ย้าย ({getMetricUnitName(metric)})</span>
            </h3>
            <div className="space-y-3">
              {donutProducts.items.map((item) => {
                const pct = donutProducts.total > 0 ? (item.value / donutProducts.total) * 100 : 0;
                return (
                  <div key={item.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                        {item.name}
                      </span>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatMetricLabel(item.value, metric)} ({formatNum(pct, 1)}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max(2, pct)}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span>กราฟเส้นทางขนย้ายยอดนิยม ({getMetricUnitName(metric)})</span>
            </h3>
            <div className="space-y-3">
              {topRoutes.map((rt) => {
                const val = getMetricValue(rt, metric);
                const pct = maxRouteVal > 0 ? (val / maxRouteVal) * 100 : 0;
                return (
                  <div key={`${rt.origin}-${rt.destination}`} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                        {rt.origin} → {rt.destination}
                      </span>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatMetricLabel(val, metric)} · {rt.trips} เที่ยว
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
