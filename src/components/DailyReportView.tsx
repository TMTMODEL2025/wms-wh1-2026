import React, { useState, useMemo, useEffect } from "react";
import {
  FileText,
  Calendar,
  Clock,
  Sun,
  Moon,
  TrendingUp,
  TrendingDown,
  Layers,
  Scale,
  Cpu,
  Package,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Filter,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  ArrowRightLeft,
  UserCheck,
  ShieldCheck,
  Download,
  ChevronLeft,
  ChevronRight,
  Boxes,
  Building2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { useLanguage } from "../contexts/LanguageContext";
import { SlitBarcodeRecord, PickListOrder, SapMasterItem } from "./SlitFilmManagement";
import {
  getStoredMachineStaging,
  MACHINE_STAGING_UPDATED_EVENT,
  MachineStagingConfig,
  calculateAccumulatedWidthMm,
} from "../data/machineStagingStorage";
import { getStoredMasterBasketLayout } from "../data/masterBasketStorage";

interface DailyReportViewProps {
  inboundList: SlitBarcodeRecord[];
  outboundList: SlitBarcodeRecord[];
  movementHistoryList: SlitBarcodeRecord[];
  pickLists: PickListOrder[];
  sapMasterMap: Map<string, SapMasterItem>;
}

const REPORT_BUILDING_META: Array<{
  buildingId: "H" | "F" | "E9" | "E10" | "I";
  buildingNameTh: string;
  buildingNameEn: string;
  subtitleTh: string;
  subtitleEn: string;
}> = [
  {
    buildingId: "H",
    buildingNameTh: "อาคาร H",
    buildingNameEn: "Building H",
    subtitleTh: "ศูนย์จัดเก็บฟิล์มสลิตหลัก และคลังย่อยแปรรูป",
    subtitleEn: "Primary Slit Film Processing & Storage Hub",
  },
  {
    buildingId: "F",
    buildingNameTh: "อาคาร F",
    buildingNameEn: "Building F",
    subtitleTh: "คลังฟิล์มสลิตเกรดพรีเมียม และงานส่งมอบด่วน",
    subtitleEn: "Premium Grade & Fast Dispatch Slit Warehouse",
  },
  {
    buildingId: "E9",
    buildingNameTh: "อาคาร E9",
    buildingNameEn: "Building E9",
    subtitleTh: "คลังจัดเก็บฟิล์มสลิตเกรดอุตสาหกรรมหนัก",
    subtitleEn: "Heavy Industrial Slit Storage Zone",
  },
  {
    buildingId: "E10",
    buildingNameTh: "อาคาร E10",
    buildingNameEn: "Building E10",
    subtitleTh: "โซนจัดเก็บและเตรียมการส่งออกฟิล์มสลิต",
    subtitleEn: "Export & Fast Staging Slit Warehouse Zone",
  },
  {
    buildingId: "I",
    buildingNameTh: "อาคาร I",
    buildingNameEn: "Building I",
    subtitleTh: "โซนจัดเก็บฟิล์มสลิตวัตถุดิบรองรับงานแปรรูป",
    subtitleEn: "Raw Material Slit Buffer & Processing Storage",
  },
];

export function DailyReportView({
  inboundList,
  outboundList,
  movementHistoryList,
  pickLists,
  sapMasterMap,
}: DailyReportViewProps) {
  const { language } = useLanguage();
  const isThai = language === "th";

  // Helper to format Date as local YYYY-MM-DD (avoiding UTC shift from toISOString)
  const formatLocalDateStr = (d: Date): string => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };

  // Helper to format thickness and width with exactly 2 decimal places (.toFixed(2))
  const formatDimension2Decimals = (val: string | number | undefined | null, defaultIfEmpty?: string): string => {
    if (val === undefined || val === null || val === "") {
      return defaultIfEmpty !== undefined ? defaultIfEmpty : "-";
    }
    if (val === "-") return "-";
    const str = String(val).trim();
    if (str === "-") return "-";
    const match = str.match(/-?\d+(?:\.\d+)?/);
    if (!match) return str;
    const num = parseFloat(match[0]);
    if (isNaN(num)) return str;
    return `${num.toFixed(2)} mm`;
  };

  // Filter Header States
  const todayStr = useMemo(() => formatLocalDateStr(new Date()), []);
  const [reportMode, setReportMode] = useState<"daily" | "monthly" | "space">("daily");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedShift, setSelectedShift] = useState<"day" | "night">(() => {
    const h = new Date().getHours();
    return h >= 8 && h < 20 ? "day" : "night";
  });
  const [hasUserChangedShift, setHasUserChangedShift] = useState<boolean>(false);

  // Monthly Report Filter States
  const [selectedMonth, setSelectedMonth] = useState<string>(() => todayStr.slice(0, 7));
  const [monthlyShiftFilter, setMonthlyShiftFilter] = useState<"all" | "day" | "night">("all");
  const [showOnlyActiveDays, setShowOnlyActiveDays] = useState<boolean>(false);
  const [monthlyLedgerPage, setMonthlyLedgerPage] = useState<number>(1);
  const [monthlyLedgerPageSize, setMonthlyLedgerPageSize] = useState<number>(10);

  // Storage Space Report Filter States
  const [spaceReportSubTab, setSpaceReportSubTab] = useState<"all" | "warehouse" | "machine">("all");
  const [spaceBuildingFilter, setSpaceBuildingFilter] = useState<string>("all");
  const [spaceBasketStatusFilter, setSpaceBasketStatusFilter] = useState<string>("all");
  const [spaceMachineCategoryFilter, setSpaceMachineCategoryFilter] = useState<"all" | "pipe" | "c_channel">("all");
  const [showOnlyActiveMachines, setShowOnlyActiveMachines] = useState<boolean>(false);
  const [spaceStorageTick, setSpaceStorageTick] = useState<number>(0);
  const [machineStagingConfigs, setMachineStagingConfigs] = useState<MachineStagingConfig[]>(() =>
    getStoredMachineStaging()
  );

  const STORAGE_KEY_MACHINE_PRODUCTION_STATUS = "tmt_wms_machine_production_status_v1";

  const [machineProductionStatus, setMachineProductionStatus] = useState<
    Record<
      string,
      {
        waitingMoveInActive: boolean;
        waitingMoveInCoils: number;
        waitingSlitActive: boolean;
        waitingSlitCoils: number;
      }
    >
  >(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const saved = localStorage.getItem("tmt_wms_machine_production_status_v1");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === "object") return parsed;
        }
      }
    } catch {}
    return {};
  });

  const handleUpdateProductionStatus = (
    machineId: string,
    updates: Partial<{
      waitingMoveInActive: boolean;
      waitingMoveInCoils: number;
      waitingSlitActive: boolean;
      waitingSlitCoils: number;
    }>
  ) => {
    setMachineProductionStatus((prev) => {
      const current = prev[machineId] || {
        waitingMoveInActive: false,
        waitingMoveInCoils: 0,
        waitingSlitActive: false,
        waitingSlitCoils: 0,
      };
      const updated = {
        ...prev,
        [machineId]: {
          ...current,
          ...updates,
        },
      };
      try {
        localStorage.setItem(
          "tmt_wms_machine_production_status_v1",
          JSON.stringify(updated)
        );
      } catch {}
      return updated;
    });
  };

  const { totalWaitingMoveIn, totalWaitingSlit } = useMemo(() => {
    let moveIn = 0;
    let slit = 0;
    Object.values(machineProductionStatus).forEach((item) => {
      if (item.waitingMoveInActive && item.waitingMoveInCoils > 0) {
        moveIn += item.waitingMoveInCoils;
      } else if (item.waitingSlitActive && item.waitingSlitCoils > 0) {
        slit += item.waitingSlitCoils;
      }
    });
    return { totalWaitingMoveIn: moveIn, totalWaitingSlit: slit };
  }, [machineProductionStatus]);

  useEffect(() => {
    const refreshStaging = () => {
      setMachineStagingConfigs(getStoredMachineStaging());
      setSpaceStorageTick((t) => t + 1);
    };

    const handleStorageSync = (e: StorageEvent) => {
      refreshStaging();
      if (e.key === "tmt_wms_machine_production_status_v1" && e.newValue) {
        try {
          setMachineProductionStatus(JSON.parse(e.newValue));
        } catch {}
      }
    };

    window.addEventListener(MACHINE_STAGING_UPDATED_EVENT, refreshStaging);
    window.addEventListener("storage", handleStorageSync);
    return () => {
      window.removeEventListener(MACHINE_STAGING_UPDATED_EVENT, refreshStaging);
      window.removeEventListener("storage", handleStorageSync);
    };
  }, []);

  // Helper to parse timestamp to Date object or time components in local time
  const parseTimestampDate = (timestampStr?: string): Date | null => {
    if (!timestampStr) return null;

    const trimmed = timestampStr.trim();
    if (!trimmed || trimmed === "-") return null;

    // 1. YYYY-MM-DD HH:mm(:ss) or YYYY/MM/DD HH:mm(:ss)
    const matchFull = trimmed.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[\s,T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (matchFull) {
      const [, y, m, d, hh, mm, ss] = matchFull;
      let yearNum = parseInt(y, 10);
      if (yearNum > 2400) yearNum -= 543;
      return new Date(yearNum, parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10), parseInt(mm, 10), parseInt(ss || "0", 10));
    }

    // 2. DD/MM/YYYY HH:mm(:ss)
    const matchThaiSlash = trimmed.match(/(\d{1,2})[/](\d{1,2})[/](\d{4})[\s,]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (matchThaiSlash) {
      const [, d, m, y, hh, mm, ss] = matchThaiSlash;
      let yearNum = parseInt(y, 10);
      if (yearNum > 2400) yearNum -= 543;
      return new Date(yearNum, parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10), parseInt(mm, 10), parseInt(ss || "0", 10));
    }

    // 3. Time-only string "10:15" or "07:51:30"
    const matchTime = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (matchTime) {
      const [, hh, mm, ss] = matchTime;
      const [sy, sm, sd] = (selectedDate || todayStr).split("-").map((n) => parseInt(n, 10));
      return new Date(sy || new Date().getFullYear(), (sm || 1) - 1, sd || 1, parseInt(hh, 10), parseInt(mm, 10), parseInt(ss || "0", 10));
    }

    // 4. Fallback direct Date parsing
    const directDate = new Date(trimmed);
    if (!isNaN(directDate.getTime())) {
      return directDate;
    }

    return null;
  };

  // Helper to get next calendar day string YYYY-MM-DD in local time
  const getNextDayStr = (dateStr: string): string => {
    const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return dateStr;
    const nextD = new Date(y, m - 1, d + 1);
    return formatLocalDateStr(nextD);
  };

  // Helper to check if a Date/Timestamp falls within selected date and shift
  const isRecordInShift = (timestampStr: string | undefined, targetDate: string, targetShift: "day" | "night"): boolean => {
    const dt = parseTimestampDate(timestampStr);
    if (!dt) return true;

    const recDateStr = formatLocalDateStr(dt);
    const recHour = dt.getHours();

    if (targetShift === "day") {
      // Day shift: 08:00 - 19:59 on targetDate
      return recDateStr === targetDate && recHour >= 8 && recHour < 20;
    } else {
      // Night shift:
      // Includes 00:00 - 07:59 on targetDate (morning of targetDate, e.g. 07:51 today),
      // 20:00 - 23:59 on targetDate, and 00:00 - 07:59 on targetDate + 1 day
      const nextDayStr = getNextDayStr(targetDate);
      if (recDateStr === targetDate && (recHour >= 20 || recHour < 8)) return true;
      if (recDateStr === nextDayStr && recHour < 8) return true;
      return false;
    }
  };

  const isRecordInSelectedShift = (timestampStr?: string): boolean => {
    return isRecordInShift(timestampStr, selectedDate, selectedShift);
  };

  // Auto-select shift that has activity on selectedDate if user hasn't manually toggled shift
  useEffect(() => {
    if (hasUserChangedShift) return;
    const allRecs = [...inboundList, ...outboundList, ...movementHistoryList];
    const hasCurrentShift = allRecs.some((r) => r.batch && isRecordInShift(r.scanTimestamp, selectedDate, selectedShift));
    if (!hasCurrentShift) {
      const otherShift: "day" | "night" = selectedShift === "day" ? "night" : "day";
      const hasOtherShift = allRecs.some((r) => r.batch && isRecordInShift(r.scanTimestamp, selectedDate, otherShift));
      if (hasOtherShift) {
        setSelectedShift(otherShift);
      }
    }
  }, [inboundList, outboundList, movementHistoryList, selectedDate, selectedShift, hasUserChangedShift]);

  // Formatted display time string (e.g. "09:15" or "21:40")
  const formatTimeDisplay = (timestampStr?: string): string => {
    const dt = parseTimestampDate(timestampStr);
    if (!dt) return timestampStr || "-";
    return dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  // =========================================================================
  // SECTION 1 DATA: Inbound from machines SM01 - SM04
  // =========================================================================
  const smInboundRecords = useMemo(() => {
    const map = new Map<string, SlitBarcodeRecord>();

    // 1. Primary source: inboundList (all records received into warehouse via + รับเข้า)
    // Do NOT exclude records even if their location or machine was later updated during outbound/issue on the same day
    for (const item of inboundList) {
      if (!item.batch) continue;
      const bKey = item.batch.trim().toUpperCase();

      if (!isRecordInSelectedShift(item.scanTimestamp)) continue;

      const rawMachine = (item.machine || "SM01").trim().toUpperCase();
      const machine = rawMachine.startsWith("SM") ? rawMachine : "SM01";

      if (!map.has(bKey)) {
        const sapMatch = sapMasterMap.get(bKey);
        map.set(bKey, {
          ...item,
          machine,
          weightKg: item.weightKg || sapMatch?.weightKg || 0,
          grade: item.grade || sapMatch?.grade || "-",
          certThickness: formatDimension2Decimals(item.certThickness || sapMatch?.certThickness, "2.50 mm"),
          width: formatDimension2Decimals(item.width || sapMatch?.width, "100.00 mm"),
        });
      }
    }

    // 2. Fallback source: movementHistoryList for any inbound record not already in map
    for (const item of movementHistoryList) {
      if (!item.batch) continue;
      const bKey = item.batch.trim().toUpperCase();
      if (map.has(bKey)) continue;

      const loc = (item.location || item.storageLocation || "").trim();
      if (item.mode === "outbound" || loc.startsWith("เบิก") || loc.includes("เบิก")) {
        continue;
      }

      const rawMachine = (item.machine || "SM01").trim().toUpperCase();
      const machine = !rawMachine || rawMachine === "-" ? "SM01" : rawMachine;
      const isSmMachine =
        machine.startsWith("SM") ||
        ["SM01", "SM02", "SM03", "SM04"].includes(machine) ||
        item.mode === "inbound";

      if (!isSmMachine) continue;

      if (!isRecordInSelectedShift(item.scanTimestamp)) continue;

      const sapMatch = sapMasterMap.get(bKey);
      map.set(bKey, {
        ...item,
        machine: machine.startsWith("SM") ? machine : "SM01",
        weightKg: item.weightKg || sapMatch?.weightKg || 0,
        grade: item.grade || sapMatch?.grade || "-",
        certThickness: formatDimension2Decimals(item.certThickness || sapMatch?.certThickness, "2.50 mm"),
        width: formatDimension2Decimals(item.width || sapMatch?.width, "100.00 mm"),
      });
    }

    return Array.from(map.values());
  }, [inboundList, movementHistoryList, sapMasterMap, selectedDate, selectedShift]);

  const totalSmInboundWeightKg = useMemo(() => {
    return smInboundRecords.reduce((sum, r) => sum + (r.weightKg || 0), 0);
  }, [smInboundRecords]);

  // =========================================================================
  // SECTION 2 DATA: Machine Issuance / Dispensing Report
  // =========================================================================
  const machineDispensingRecords = useMemo(() => {
    const results: {
      id: string;
      time: string;
      orderNo: string;
      batch: string;
      destinationMachine: string;
      weightKg: number;
      status: string;
    }[] = [];

    const processedBatches = new Set<string>();

    // 1. Collect from outboundList
    outboundList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();

      if (!isRecordInSelectedShift(r.scanTimestamp)) return;

      processedBatches.add(bKey);
      results.push({
        id: r.id || `DISP-${bKey}`,
        time: formatTimeDisplay(r.scanTimestamp),
        orderNo: r.orderNo && r.orderNo !== "-" ? r.orderNo : "-",
        batch: r.batch,
        destinationMachine: r.machine || r.location?.replace("เบิก", "") || "-",
        weightKg: r.weightKg || 0,
        status: isThai ? "เบิกจ่ายสำเร็จ" : "Dispatched",
      });
    });

    // 2. Collect from pickLists verified / machineIssued items
    pickLists.forEach((pl) => {
      (pl.items || []).forEach((item) => {
        if (!item.batch) return;
        const bKey = item.batch.trim().toUpperCase();

        if (processedBatches.has(bKey)) return;

        if (item.status === "verified" || item.machineIssued) {
          const scanTime = item.machineIssuedAt || item.scannedAt || pl.createdAt;
          if (!isRecordInSelectedShift(scanTime)) return;

          processedBatches.add(bKey);
          results.push({
            id: item.id || `DISP-PL-${bKey}`,
            time: formatTimeDisplay(scanTime),
            orderNo: pl.orderNo,
            batch: item.batch,
            destinationMachine: pl.machineId || "-",
            weightKg: item.reqQty || 0,
            status: item.machineIssued
              ? (isThai ? "จ่ายเข้าเครื่องแล้ว" : "Issued at Machine")
              : (isThai ? "เตรียมแล้ว" : "Prepared"),
          });
        }
      });
    });

    // 3. Collect from movementHistoryList where location indicates dispensing ("เบิก")
    movementHistoryList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      if (processedBatches.has(bKey)) return;

      const loc = (r.location || "").trim();
      if (loc.startsWith("เบิก") || loc.includes("เบิก") || ["CF", "ML", "ZF"].includes(loc.toUpperCase())) {
        if (!isRecordInSelectedShift(r.scanTimestamp)) return;

        processedBatches.add(bKey);
        results.push({
          id: r.id || `DISP-MH-${bKey}`,
          time: formatTimeDisplay(r.scanTimestamp),
          orderNo: r.orderNo && r.orderNo !== "-" ? r.orderNo : "-",
          batch: r.batch,
          destinationMachine: r.machine || loc.replace("เบิก", "") || "-",
          weightKg: r.weightKg || 0,
          status: isThai ? "เบิกจ่ายสำเร็จ" : "Dispatched",
        });
      }
    });

    return results;
  }, [outboundList, pickLists, movementHistoryList, selectedDate, selectedShift, isThai]);

  const totalDispensedWeightKg = useMemo(() => {
    return machineDispensingRecords.reduce((sum, r) => sum + (r.weightKg || 0), 0);
  }, [machineDispensingRecords]);

  // =========================================================================
  // SECTION 3 DATA: Modern Visual Charts & KPI Analytics
  // =========================================================================

  // =========================================================================
  // SECTION 3 DATA: Modern Visual Charts & KPI Analytics
  // =========================================================================

  // Chart 1 Data: Inbound SM01 - SM04 pure inbound weight & coil count
  const smInboundChartData = useMemo(() => {
    const smMachines = ["SM01", "SM02", "SM03", "SM04"];
    const inboundMap: Record<string, { kg: number; coils: number }> = {
      SM01: { kg: 0, coils: 0 },
      SM02: { kg: 0, coils: 0 },
      SM03: { kg: 0, coils: 0 },
      SM04: { kg: 0, coils: 0 },
    };

    smInboundRecords.forEach((r) => {
      let m = (r.machine || "SM01").trim().toUpperCase();
      if (!smMachines.includes(m)) {
        if (m.startsWith("SM")) {
          if (!inboundMap[m]) inboundMap[m] = { kg: 0, coils: 0 };
          inboundMap[m].kg += r.weightKg || 0;
          inboundMap[m].coils += 1;
          return;
        }
        m = "SM01";
      }
      inboundMap[m].kg += r.weightKg || 0;
      inboundMap[m].coils += 1;
    });

    const activeSmMachines = Array.from(new Set([...smMachines, ...Object.keys(inboundMap)]));

    return activeSmMachines.map((m) => ({
      machine: m,
      inboundKg: inboundMap[m]?.kg || 0,
      coilCount: inboundMap[m]?.coils || 0,
    }));
  }, [smInboundRecords]);

  const maxSmInboundKg = useMemo(() => {
    let max = 1000;
    smInboundChartData.forEach((d) => {
      if (d.inboundKg > max) max = d.inboundKg;
    });
    return max * 1.15;
  }, [smInboundChartData]);

  const maxSmInboundCoils = useMemo(() => {
    let max = 5;
    smInboundChartData.forEach((d) => {
      if (d.coilCount > max) max = d.coilCount;
    });
    return max * 1.2;
  }, [smInboundChartData]);

  // Chart 2 Data: Machine Dispensing pure outbound weight & coil count
  const machineDispensingChartData = useMemo(() => {
    const defaultDispensingMachines = ["TM01", "ML01", "ZF01", "CF01"];
    const dispensedMap: Record<string, { kg: number; coils: number }> = {};

    defaultDispensingMachines.forEach((m) => {
      dispensedMap[m] = { kg: 0, coils: 0 };
    });

    machineDispensingRecords.forEach((r) => {
      const m = (r.destinationMachine || "TM01").trim().toUpperCase();
      if (!dispensedMap[m]) dispensedMap[m] = { kg: 0, coils: 0 };
      dispensedMap[m].kg += r.weightKg || 0;
      dispensedMap[m].coils += 1;
    });

    const activeMachines = Array.from(new Set([...defaultDispensingMachines, ...Object.keys(dispensedMap)]));

    return activeMachines.map((m) => ({
      machine: m,
      dispensedKg: dispensedMap[m]?.kg || 0,
      coilCount: dispensedMap[m]?.coils || 0,
    }));
  }, [machineDispensingRecords]);

  const maxDispensingKg = useMemo(() => {
    let max = 1000;
    machineDispensingChartData.forEach((d) => {
      if (d.dispensedKg > max) max = d.dispensedKg;
    });
    return max * 1.15;
  }, [machineDispensingChartData]);

  // Inbound vs Outbound Distribution for Chart 3 (Combined across BOTH shifts: Day + Night)
  const { inOutDistribution, bothShiftsSummary } = useMemo(() => {
    const getRecordShiftOnSelectedDate = (timestampStr?: string): "day" | "night" | null => {
      const dt = parseTimestampDate(timestampStr);
      if (!dt) return "day";
      const recDateStr = formatLocalDateStr(dt);
      const recHour = dt.getHours();
      const nextDayStr = getNextDayStr(selectedDate);

      if (recDateStr === selectedDate) {
        if (recHour >= 8 && recHour < 20) return "day";
        return "night";
      }
      if (recDateStr === nextDayStr && recHour < 8) {
        return "night";
      }
      return null;
    };

    // Map batch -> weight from inbound/history/SAP for lookup
    const batchWeightMap = new Map<string, number>();
    sapMasterMap.forEach((sap, bKey) => {
      batchWeightMap.set(bKey.trim().toUpperCase(), sap.weightKg || 0);
    });
    [...inboundList, ...movementHistoryList, ...outboundList].forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      const existing = batchWeightMap.get(bKey) || 0;
      batchWeightMap.set(bKey, r.weightKg || existing || 0);
    });

    // 1. Collect Inbound records across both shifts (SM machines)
    const inboundMap = new Map<string, { shift: "day" | "night"; weightKg: number }>();
    inboundList.forEach((item) => {
      if (!item.batch) return;
      const bKey = item.batch.trim().toUpperCase();
      const shift = getRecordShiftOnSelectedDate(item.scanTimestamp);
      if (!shift) return;

      if (!inboundMap.has(bKey)) {
        inboundMap.set(bKey, {
          shift,
          weightKg: item.weightKg || batchWeightMap.get(bKey) || 0,
        });
      }
    });
    movementHistoryList.forEach((item) => {
      if (!item.batch) return;
      const bKey = item.batch.trim().toUpperCase();
      if (inboundMap.has(bKey)) return;
      const loc = (item.location || item.storageLocation || "").trim();
      if (item.mode === "outbound" || loc.startsWith("เบิก") || loc.includes("เบิก")) return;
      const machine = (item.machine || "SM01").trim().toUpperCase();
      const isSmMachine =
        machine.startsWith("SM") ||
        ["SM01", "SM02", "SM03", "SM04"].includes(machine) ||
        item.mode === "inbound";
      if (!isSmMachine) return;
      const shift = getRecordShiftOnSelectedDate(item.scanTimestamp);
      if (!shift) return;

      inboundMap.set(bKey, {
        shift,
        weightKg: item.weightKg || batchWeightMap.get(bKey) || 0,
      });
    });

    // 2. Collect Outbound / Dispensed records across both shifts
    const outboundMap = new Map<string, { shift: "day" | "night"; weightKg: number }>();
    outboundList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      const shift = getRecordShiftOnSelectedDate(r.scanTimestamp);
      if (!shift) return;
      outboundMap.set(bKey, {
        shift,
        weightKg: r.weightKg || batchWeightMap.get(bKey) || 0,
      });
    });

    pickLists.forEach((pl) => {
      (pl.items || []).forEach((item) => {
        if (!item.batch) return;
        const bKey = item.batch.trim().toUpperCase();
        if (outboundMap.has(bKey)) return;
        if (item.status === "verified" || item.machineIssued) {
          const scanTime = item.machineIssuedAt || item.scannedAt || pl.createdAt;
          const shift = getRecordShiftOnSelectedDate(scanTime);
          if (!shift) return;
          outboundMap.set(bKey, {
            shift,
            weightKg: item.reqQty || batchWeightMap.get(bKey) || 0,
          });
        }
      });
    });

    movementHistoryList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      if (outboundMap.has(bKey)) return;
      const loc = (r.location || "").trim();
      if (loc.startsWith("เบิก") || loc.includes("เบิก") || ["CF", "ML", "ZF"].includes(loc.toUpperCase())) {
        const shift = getRecordShiftOnSelectedDate(r.scanTimestamp);
        if (!shift) return;
        outboundMap.set(bKey, {
          shift,
          weightKg: r.weightKg || batchWeightMap.get(bKey) || 0,
        });
      }
    });

    let inboundDayKg = 0;
    let inboundDayCoils = 0;
    let inboundNightKg = 0;
    let inboundNightCoils = 0;

    inboundMap.forEach(({ shift, weightKg }) => {
      if (shift === "day") {
        inboundDayCoils += 1;
        inboundDayKg += weightKg;
      } else {
        inboundNightCoils += 1;
        inboundNightKg += weightKg;
      }
    });

    let outboundDayKg = 0;
    let outboundDayCoils = 0;
    let outboundNightKg = 0;
    let outboundNightCoils = 0;

    outboundMap.forEach(({ shift, weightKg }) => {
      if (shift === "day") {
        outboundDayCoils += 1;
        outboundDayKg += weightKg;
      } else {
        outboundNightCoils += 1;
        outboundNightKg += weightKg;
      }
    });

    const totalInboundKg = inboundDayKg + inboundNightKg;
    const totalInboundCoils = inboundDayCoils + inboundNightCoils;
    const totalOutboundKg = outboundDayKg + outboundNightKg;
    const totalOutboundCoils = outboundDayCoils + outboundNightCoils;

    const grandTotalKg = totalInboundKg + totalOutboundKg;
    const grandTotalCoils = totalInboundCoils + totalOutboundCoils;

    const inboundPercent =
      grandTotalKg > 0
        ? Math.round((totalInboundKg / grandTotalKg) * 100)
        : grandTotalCoils > 0
        ? Math.round((totalInboundCoils / grandTotalCoils) * 100)
        : 0;
    const outboundPercent =
      grandTotalKg > 0 || grandTotalCoils > 0 ? Math.max(0, 100 - inboundPercent) : 0;

    const distribution = [
      {
        key: "inbound",
        labelTh: "รับเข้าคลัง (Inbound)",
        labelEn: "Inbound Total",
        totalKg: totalInboundKg,
        totalCoils: totalInboundCoils,
        dayKg: inboundDayKg,
        dayCoils: inboundDayCoils,
        nightKg: inboundNightKg,
        nightCoils: inboundNightCoils,
        percentage: inboundPercent,
        color: "#0284c7",
      },
      {
        key: "outbound",
        labelTh: "จ่ายออกหน้าเครื่อง (Outbound)",
        labelEn: "Outbound Total",
        totalKg: totalOutboundKg,
        totalCoils: totalOutboundCoils,
        dayKg: outboundDayKg,
        dayCoils: outboundDayCoils,
        nightKg: outboundNightKg,
        nightCoils: outboundNightCoils,
        percentage: outboundPercent,
        color: "#f59e0b",
      },
    ];

    return {
      inOutDistribution: distribution,
      bothShiftsSummary: {
        totalInboundKg,
        totalInboundCoils,
        inboundDayKg,
        inboundDayCoils,
        inboundNightKg,
        inboundNightCoils,
        totalOutboundKg,
        totalOutboundCoils,
        outboundDayKg,
        outboundDayCoils,
        outboundNightKg,
        outboundNightCoils,
        grandTotalKg,
        grandTotalCoils,
        inboundPercent,
        outboundPercent,
      },
    };
  }, [inboundList, outboundList, movementHistoryList, pickLists, sapMasterMap, selectedDate]);

  // Hourly timeline activity for Chart 4
  const hourlyActivityData = useMemo(() => {
    const hours = selectedShift === "day"
      ? [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
      : [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7];

    const hourlyMap: Record<number, { inbound: number; inboundCoils: number; dispensed: number; dispensedCoils: number }> = {};
    hours.forEach((h) => {
      hourlyMap[h] = { inbound: 0, inboundCoils: 0, dispensed: 0, dispensedCoils: 0 };
    });

    smInboundRecords.forEach((r) => {
      const dt = parseTimestampDate(r.scanTimestamp);
      if (dt) {
        const h = dt.getHours();
        if (hourlyMap[h]) {
          hourlyMap[h].inbound += r.weightKg || 0;
          hourlyMap[h].inboundCoils += 1;
        }
      }
    });

    machineDispensingRecords.forEach((r) => {
      const dt = parseTimestampDate(r.time);
      if (dt) {
        const h = dt.getHours();
        if (hourlyMap[h]) {
          hourlyMap[h].dispensed += r.weightKg || 0;
          hourlyMap[h].dispensedCoils += 1;
        }
      }
    });

    return hours.map((h) => ({
      hourLabel: `${String(h).padStart(2, "0")}:00`,
      inbound: hourlyMap[h]?.inbound || 0,
      inboundCoils: hourlyMap[h]?.inboundCoils || 0,
      dispensed: hourlyMap[h]?.dispensed || 0,
      dispensedCoils: hourlyMap[h]?.dispensedCoils || 0,
    }));
  }, [smInboundRecords, machineDispensingRecords, selectedShift]);

  const maxHourlyKg = useMemo(() => {
    let max = 500;
    hourlyActivityData.forEach((d) => {
      if (d.inbound > max) max = d.inbound;
      if (d.dispensed > max) max = d.dispensed;
    });
    return max * 1.2;
  }, [hourlyActivityData]);

  const maxHourlyCoils = useMemo(() => {
    let max = 5;
    hourlyActivityData.forEach((d) => {
      if (d.inboundCoils > max) max = d.inboundCoils;
      if (d.dispensedCoils > max) max = d.dispensedCoils;
    });
    return max * 1.2;
  }, [hourlyActivityData]);

  // Export Report to Excel Workbook
  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: SM Inbound
    const smData = smInboundRecords.map((r, idx) => ({
      "No.": idx + 1,
      "เวลา (Time)": formatTimeDisplay(r.scanTimestamp),
      "Batch Barcode": r.batch,
      "เครื่องจักร (Machine)": r.machine || "-",
      "เกรด (Grade)": r.grade || "-",
      "ความหนา (mm)": formatDimension2Decimals(r.certThickness, "-"),
      "ความกว้าง (mm)": formatDimension2Decimals(r.width, "-"),
      "น้ำหนัก (kg)": r.weightKg || 0,
      "ผู้บันทึก (Operator)": r.conditionText || "-",
    }));

    const ws1 = XLSX.utils.json_to_sheet(smData);
    XLSX.utils.book_append_sheet(wb, ws1, "SM01-SM04 Inbound");

    // Sheet 2: Machine Dispensing
    const dispData = machineDispensingRecords.map((r, idx) => ({
      "No.": idx + 1,
      "เวลา (Time)": r.time,
      "เลขที่ใบสั่งเบิก (Order No.)": r.orderNo,
      "Batch Barcode": r.batch,
      "เครื่องจักรปลายทาง (Destination)": r.destinationMachine,
      "น้ำหนักที่เบิก (kg)": r.weightKg,
      "สถานะการเบิก (Status)": r.status,
    }));

    const ws2 = XLSX.utils.json_to_sheet(dispData);
    XLSX.utils.book_append_sheet(wb, ws2, "Machine Dispensing");

    XLSX.writeFile(wb, `WMS_Daily_Report_${selectedDate}_Shift_${selectedShift}.xlsx`);
  };

  // =========================================================================
  // MONTHLY REPORT AGGREGATION ENGINE (Cumulative Daily & Machine Analytics)
  // =========================================================================
  const monthlyAnalytics = useMemo(() => {
    const [yearStr, monthStr] = (selectedMonth || todayStr.slice(0, 7)).split("-");
    const yearNum = parseInt(yearStr, 10) || new Date().getFullYear();
    const monthNum = parseInt(monthStr, 10) || new Date().getMonth() + 1;
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const formatLocalYYYYMMDD = (d: Date): string => {
      const yy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yy}-${mm}-${dd}`;
    };

    const getOperationalDateAndShift = (
      timestampStr?: string
    ): { opDateStr: string; shift: "day" | "night" } => {
      const dt = parseTimestampDate(timestampStr);
      if (!dt) {
        return { opDateStr: selectedDate || todayStr, shift: "day" };
      }
      const hour = dt.getHours();
      if (hour < 8 || hour >= 20) {
        return { opDateStr: formatLocalYYYYMMDD(dt), shift: "night" };
      }
      return { opDateStr: formatLocalYYYYMMDD(dt), shift: "day" };
    };

    // Build Batch -> Weight Lookup Map
    const batchWeightMap = new Map<string, number>();
    sapMasterMap.forEach((sap, bKey) => {
      batchWeightMap.set(bKey.trim().toUpperCase(), sap.weightKg || 0);
    });
    [...inboundList, ...movementHistoryList, ...outboundList].forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      const existing = batchWeightMap.get(bKey) || 0;
      batchWeightMap.set(bKey, r.weightKg || existing || 0);
    });

    // 1. Collect Monthly Inbound Records (SM Machines)
    const monthlyInboundMap = new Map<
      string,
      {
        batch: string;
        opDateStr: string;
        shift: "day" | "night";
        machine: string;
        weightKg: number;
        grade: string;
      }
    >();

    inboundList.forEach((item) => {
      if (!item.batch) return;
      const bKey = item.batch.trim().toUpperCase();
      const rawMachine = (item.machine || "SM01").trim().toUpperCase();
      const machine = rawMachine.startsWith("SM") ? rawMachine : "SM01";

      const { opDateStr, shift } = getOperationalDateAndShift(item.scanTimestamp);
      if (!opDateStr.startsWith(selectedMonth)) return;
      if (monthlyShiftFilter !== "all" && shift !== monthlyShiftFilter) return;

      if (!monthlyInboundMap.has(bKey)) {
        monthlyInboundMap.set(bKey, {
          batch: item.batch,
          opDateStr,
          shift,
          machine,
          weightKg: item.weightKg || batchWeightMap.get(bKey) || 0,
          grade: item.grade || "-",
        });
      }
    });

    movementHistoryList.forEach((item) => {
      if (!item.batch) return;
      const bKey = item.batch.trim().toUpperCase();
      if (monthlyInboundMap.has(bKey)) return;
      const loc = (item.location || item.storageLocation || "").trim();
      if (item.mode === "outbound" || loc.startsWith("เบิก") || loc.includes("เบิก")) return;
      const machine = (item.machine || "").trim().toUpperCase();
      const isSmMachine =
        machine.startsWith("SM") || ["SM01", "SM02", "SM03", "SM04"].includes(machine);
      if (!isSmMachine) return;

      const { opDateStr, shift } = getOperationalDateAndShift(item.scanTimestamp);
      if (!opDateStr.startsWith(selectedMonth)) return;
      if (monthlyShiftFilter !== "all" && shift !== monthlyShiftFilter) return;

      monthlyInboundMap.set(bKey, {
        batch: item.batch,
        opDateStr,
        shift,
        machine: machine || "SM01",
        weightKg: item.weightKg || batchWeightMap.get(bKey) || 0,
        grade: item.grade || "-",
      });
    });

    // 2. Collect Monthly Outbound / Dispensing Records
    const monthlyOutboundMap = new Map<
      string,
      {
        batch: string;
        orderNo: string;
        opDateStr: string;
        shift: "day" | "night";
        destinationMachine: string;
        weightKg: number;
        status: string;
      }
    >();

    outboundList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      const { opDateStr, shift } = getOperationalDateAndShift(r.scanTimestamp);
      if (!opDateStr.startsWith(selectedMonth)) return;
      if (monthlyShiftFilter !== "all" && shift !== monthlyShiftFilter) return;

      monthlyOutboundMap.set(bKey, {
        batch: r.batch,
        orderNo: r.orderNo && r.orderNo !== "-" ? r.orderNo : "-",
        opDateStr,
        shift,
        destinationMachine: (r.machine || r.location?.replace("เบิก", "") || "TM01")
          .trim()
          .toUpperCase(),
        weightKg: r.weightKg || batchWeightMap.get(bKey) || 0,
        status: isThai ? "เบิกจ่ายสำเร็จ" : "Dispatched",
      });
    });

    pickLists.forEach((pl) => {
      (pl.items || []).forEach((item) => {
        if (!item.batch) return;
        const bKey = item.batch.trim().toUpperCase();
        if (monthlyOutboundMap.has(bKey)) return;
        if (item.status === "verified" || item.machineIssued) {
          const scanTime = item.machineIssuedAt || item.scannedAt || pl.createdAt;
          const { opDateStr, shift } = getOperationalDateAndShift(scanTime);
          if (!opDateStr.startsWith(selectedMonth)) return;
          if (monthlyShiftFilter !== "all" && shift !== monthlyShiftFilter) return;

          monthlyOutboundMap.set(bKey, {
            batch: item.batch,
            orderNo: pl.orderNo || "-",
            opDateStr,
            shift,
            destinationMachine: (pl.machineId || "TM01").trim().toUpperCase(),
            weightKg: item.reqQty || batchWeightMap.get(bKey) || 0,
            status: item.machineIssued
              ? isThai
                ? "จ่ายเข้าเครื่องแล้ว"
                : "Issued at Machine"
              : isThai
              ? "เตรียมแล้ว"
              : "Prepared",
          });
        }
      });
    });

    movementHistoryList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      if (monthlyOutboundMap.has(bKey)) return;
      const loc = (r.location || "").trim();
      if (
        loc.startsWith("เบิก") ||
        loc.includes("เบิก") ||
        ["CF", "ML", "ZF"].includes(loc.toUpperCase())
      ) {
        const { opDateStr, shift } = getOperationalDateAndShift(r.scanTimestamp);
        if (!opDateStr.startsWith(selectedMonth)) return;
        if (monthlyShiftFilter !== "all" && shift !== monthlyShiftFilter) return;

        monthlyOutboundMap.set(bKey, {
          batch: r.batch,
          orderNo: r.orderNo && r.orderNo !== "-" ? r.orderNo : "-",
          opDateStr,
          shift,
          destinationMachine: (r.machine || loc.replace("เบิก", "") || "TM01")
            .trim()
            .toUpperCase(),
          weightKg: r.weightKg || batchWeightMap.get(bKey) || 0,
          status: isThai ? "เบิกจ่ายสำเร็จ" : "Dispatched",
        });
      }
    });

    // 3. Build Daily Series (Days 1 .. daysInMonth) + Running Cumulative (MTD)
    const dailyMap = new Map<
      string,
      {
        dayNumber: number;
        dateStr: string;
        inboundDayKg: number;
        inboundDayCoils: number;
        inboundNightKg: number;
        inboundNightCoils: number;
        outboundDayKg: number;
        outboundDayCoils: number;
        outboundNightKg: number;
        outboundNightCoils: number;
      }
    >();

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${selectedMonth}-${String(d).padStart(2, "0")}`;
      dailyMap.set(dateStr, {
        dayNumber: d,
        dateStr,
        inboundDayKg: 0,
        inboundDayCoils: 0,
        inboundNightKg: 0,
        inboundNightCoils: 0,
        outboundDayKg: 0,
        outboundDayCoils: 0,
        outboundNightKg: 0,
        outboundNightCoils: 0,
      });
    }

    const smMachineMap: Record<
      string,
      { totalKg: number; coils: number; dayKg: number; nightKg: number }
    > = {
      SM01: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
      SM02: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
      SM03: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
      SM04: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
    };

    const dispensingMachineMap: Record<
      string,
      { totalKg: number; coils: number; dayKg: number; nightKg: number }
    > = {
      TM01: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
      ML01: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
      ZF01: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
      CF01: { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 },
    };

    monthlyInboundMap.forEach((rec) => {
      const dayEntry = dailyMap.get(rec.opDateStr);
      if (dayEntry) {
        if (rec.shift === "day") {
          dayEntry.inboundDayKg += rec.weightKg;
          dayEntry.inboundDayCoils += 1;
        } else {
          dayEntry.inboundNightKg += rec.weightKg;
          dayEntry.inboundNightCoils += 1;
        }
      }

      const mKey = rec.machine || "SM01";
      if (!smMachineMap[mKey]) {
        smMachineMap[mKey] = { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 };
      }
      smMachineMap[mKey].totalKg += rec.weightKg;
      smMachineMap[mKey].coils += 1;
      if (rec.shift === "day") {
        smMachineMap[mKey].dayKg += rec.weightKg;
      } else {
        smMachineMap[mKey].nightKg += rec.weightKg;
      }
    });

    monthlyOutboundMap.forEach((rec) => {
      const dayEntry = dailyMap.get(rec.opDateStr);
      if (dayEntry) {
        if (rec.shift === "day") {
          dayEntry.outboundDayKg += rec.weightKg;
          dayEntry.outboundDayCoils += 1;
        } else {
          dayEntry.outboundNightKg += rec.weightKg;
          dayEntry.outboundNightCoils += 1;
        }
      }

      const mKey = rec.destinationMachine || "TM01";
      if (!dispensingMachineMap[mKey]) {
        dispensingMachineMap[mKey] = { totalKg: 0, coils: 0, dayKg: 0, nightKg: 0 };
      }
      dispensingMachineMap[mKey].totalKg += rec.weightKg;
      dispensingMachineMap[mKey].coils += 1;
      if (rec.shift === "day") {
        dispensingMachineMap[mKey].dayKg += rec.weightKg;
      } else {
        dispensingMachineMap[mKey].nightKg += rec.weightKg;
      }
    });

    let runningInboundKg = 0;
    let runningOutboundKg = 0;
    let inboundDayKgTotal = 0;
    let inboundDayCoilsTotal = 0;
    let inboundNightKgTotal = 0;
    let inboundNightCoilsTotal = 0;
    let outboundDayKgTotal = 0;
    let outboundDayCoilsTotal = 0;
    let outboundNightKgTotal = 0;
    let outboundNightCoilsTotal = 0;

    const dailySeries = Array.from(dailyMap.values()).map((d) => {
      const inboundTotalKg = d.inboundDayKg + d.inboundNightKg;
      const inboundCoils = d.inboundDayCoils + d.inboundNightCoils;
      const outboundTotalKg = d.outboundDayKg + d.outboundNightKg;
      const outboundCoils = d.outboundDayCoils + d.outboundNightCoils;

      runningInboundKg += inboundTotalKg;
      runningOutboundKg += outboundTotalKg;

      inboundDayKgTotal += d.inboundDayKg;
      inboundDayCoilsTotal += d.inboundDayCoils;
      inboundNightKgTotal += d.inboundNightKg;
      inboundNightCoilsTotal += d.inboundNightCoils;

      outboundDayKgTotal += d.outboundDayKg;
      outboundDayCoilsTotal += d.outboundDayCoils;
      outboundNightKgTotal += d.outboundNightKg;
      outboundNightCoilsTotal += d.outboundNightCoils;

      return {
        ...d,
        inboundTotalKg,
        inboundCoils,
        outboundTotalKg,
        outboundCoils,
        netDeltaKg: inboundTotalKg - outboundTotalKg,
        cumulativeInboundKg: runningInboundKg,
        cumulativeOutboundKg: runningOutboundKg,
        cumulativeNetKg: runningInboundKg - runningOutboundKg,
        hasActivity: inboundTotalKg > 0 || outboundTotalKg > 0 || inboundCoils > 0 || outboundCoils > 0,
      };
    });

    const maxDailyBarKg =
      Math.max(
        1000,
        ...dailySeries.map((d) => Math.max(d.inboundTotalKg, d.outboundTotalKg))
      ) * 1.15;

    const smMachineList = Object.entries(smMachineMap).map(([machine, stats]) => ({
      machine,
      ...stats,
    }));
    const maxSmMonthlyKg =
      Math.max(1000, ...smMachineList.map((m) => m.totalKg)) * 1.15;

    const dispensingMachineList = Object.entries(dispensingMachineMap).map(
      ([machine, stats]) => ({
        machine,
        ...stats,
      })
    );
    const maxDispensingMonthlyKg =
      Math.max(1000, ...dispensingMachineList.map((m) => m.totalKg)) * 1.15;

    const totalInboundKg = inboundDayKgTotal + inboundNightKgTotal;
    const totalInboundCoils = inboundDayCoilsTotal + inboundNightCoilsTotal;
    const totalOutboundKg = outboundDayKgTotal + outboundNightKgTotal;
    const totalOutboundCoils = outboundDayCoilsTotal + outboundNightCoilsTotal;
    const grandTotalKg = totalInboundKg + totalOutboundKg;
    const grandTotalCoils = totalInboundCoils + totalOutboundCoils;

    const inboundPercent =
      grandTotalKg > 0
        ? Math.round((totalInboundKg / grandTotalKg) * 100)
        : grandTotalCoils > 0
        ? Math.round((totalInboundCoils / grandTotalCoils) * 100)
        : 0;
    const outboundPercent =
      grandTotalKg > 0 || grandTotalCoils > 0 ? Math.max(0, 100 - inboundPercent) : 0;

    const activeDaysCount = dailySeries.filter((d) => d.hasActivity).length;
    const activeMachinesCount =
      smMachineList.filter((m) => m.totalKg > 0).length +
      dispensingMachineList.filter((m) => m.totalKg > 0).length;

    const monthlyDistribution = [
      {
        key: "inbound",
        labelTh: "รับเข้าคลังสะสม (Monthly Inbound)",
        labelEn: "Monthly Inbound Total",
        totalKg: totalInboundKg,
        totalCoils: totalInboundCoils,
        dayKg: inboundDayKgTotal,
        dayCoils: inboundDayCoilsTotal,
        nightKg: inboundNightKgTotal,
        nightCoils: inboundNightCoilsTotal,
        percentage: inboundPercent,
        color: "#0284c7",
      },
      {
        key: "outbound",
        labelTh: "จ่ายออกสะสม (Monthly Outbound)",
        labelEn: "Monthly Outbound Total",
        totalKg: totalOutboundKg,
        totalCoils: totalOutboundCoils,
        dayKg: outboundDayKgTotal,
        dayCoils: outboundDayCoilsTotal,
        nightKg: outboundNightKgTotal,
        nightCoils: outboundNightCoilsTotal,
        percentage: outboundPercent,
        color: "#f59e0b",
      },
    ];

    return {
      daysInMonth,
      dailySeries,
      maxDailyBarKg,
      smMachineList,
      maxSmMonthlyKg,
      dispensingMachineList,
      maxDispensingMonthlyKg,
      totalInboundKg,
      totalInboundCoils,
      inboundDayKgTotal,
      inboundDayCoilsTotal,
      inboundNightKgTotal,
      inboundNightCoilsTotal,
      totalOutboundKg,
      totalOutboundCoils,
      outboundDayKgTotal,
      outboundDayCoilsTotal,
      outboundNightKgTotal,
      outboundNightCoilsTotal,
      grandTotalKg,
      grandTotalCoils,
      inboundPercent,
      outboundPercent,
      activeDaysCount,
      activeMachinesCount,
      monthlyDistribution,
      inboundRecordsList: Array.from(monthlyInboundMap.values()),
      outboundRecordsList: Array.from(monthlyOutboundMap.values()),
    };
  }, [
    inboundList,
    outboundList,
    movementHistoryList,
    pickLists,
    sapMasterMap,
    selectedMonth,
    monthlyShiftFilter,
    selectedDate,
    todayStr,
    isThai,
  ]);

  // Export Monthly Report to Excel Workbook
  const exportMonthlyToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Daily Cumulative Summary (MTD)
    const dailySheetData = monthlyAnalytics.dailySeries.map((d) => ({
      "วันที่ (Date)": d.dateStr,
      "รับเข้า กะเช้า (kg)": d.inboundDayKg,
      "รับเข้า กะดึก (kg)": d.inboundNightKg,
      "รวมรับเข้ารายวัน (kg)": d.inboundTotalKg,
      "จำนวนม้วนรับเข้า (Coils)": d.inboundCoils,
      "เบิกจ่าย กะเช้า (kg)": d.outboundDayKg,
      "เบิกจ่าย กะดึก (kg)": d.outboundNightKg,
      "รวมเบิกจ่ายรายวัน (kg)": d.outboundTotalKg,
      "จำนวนม้วนเบิกจ่าย (Coils)": d.outboundCoils,
      "ยอดสะสมรับเข้า MTD (kg)": d.cumulativeInboundKg,
      "ยอดสะสมเบิกจ่าย MTD (kg)": d.cumulativeOutboundKg,
      "ดุลสะสมสุทธิ MTD (kg)": d.cumulativeNetKg,
    }));
    const wsDaily = XLSX.utils.json_to_sheet(dailySheetData);
    XLSX.utils.book_append_sheet(wb, wsDaily, "Daily Cumulative (MTD)");

    // Sheet 2: Machine Cumulative Summary
    const machineSheetData = [
      ...monthlyAnalytics.smMachineList.map((m) => ({
        "ประเภท (Type)": "รับเข้าคลัง (SM Inbound)",
        "เครื่องจักร (Machine)": m.machine,
        "กะเช้า (kg)": m.dayKg,
        "กะดึก (kg)": m.nightKg,
        "น้ำหนักสะสมรวม (kg)": m.totalKg,
        "น้ำหนักสะสมรวม (TON)": Number((m.totalKg / 1000).toFixed(3)),
        "จำนวนม้วนสะสม (Coils)": m.coils,
      })),
      ...monthlyAnalytics.dispensingMachineList.map((m) => ({
        "ประเภท (Type)": "เบิกจ่ายหน้าเครื่อง (Dispensing)",
        "เครื่องจักร (Machine)": m.machine,
        "กะเช้า (kg)": m.dayKg,
        "กะดึก (kg)": m.nightKg,
        "น้ำหนักสะสมรวม (kg)": m.totalKg,
        "น้ำหนักสะสมรวม (TON)": Number((m.totalKg / 1000).toFixed(3)),
        "จำนวนม้วนสะสม (Coils)": m.coils,
      })),
    ];
    const wsMachines = XLSX.utils.json_to_sheet(machineSheetData);
    XLSX.utils.book_append_sheet(wb, wsMachines, "Machine Summary");

    // Sheet 3: Monthly Transactions
    const txSheetData = [
      ...monthlyAnalytics.inboundRecordsList.map((r, idx) => ({
        "No.": idx + 1,
        "วันที่ปฏิบัติงาน (Date)": r.opDateStr,
        "กะ (Shift)": r.shift === "day" ? "กะเช้า (Day)" : "กะดึก (Night)",
        "ประเภทรายการ (Type)": "รับเข้าคลัง (Inbound)",
        "Batch Barcode": r.batch,
        "เครื่องจักร (Machine)": r.machine,
        "น้ำหนัก (kg)": r.weightKg,
        "เลขที่ใบสั่งเบิก (Order No.)": "-",
      })),
      ...monthlyAnalytics.outboundRecordsList.map((r, idx) => ({
        "No.": monthlyAnalytics.inboundRecordsList.length + idx + 1,
        "วันที่ปฏิบัติงาน (Date)": r.opDateStr,
        "กะ (Shift)": r.shift === "day" ? "กะเช้า (Day)" : "กะดึก (Night)",
        "ประเภทรายการ (Type)": "เบิกจ่ายหน้าเครื่อง (Outbound)",
        "Batch Barcode": r.batch,
        "เครื่องจักร (Machine)": r.destinationMachine,
        "น้ำหนัก (kg)": r.weightKg,
        "เลขที่ใบสั่งเบิก (Order No.)": r.orderNo,
      })),
    ];
    const wsTx = XLSX.utils.json_to_sheet(txSheetData);
    XLSX.utils.book_append_sheet(wb, wsTx, "Monthly Transactions");

    XLSX.writeFile(
      wb,
      `WMS_Monthly_Report_${selectedMonth}_Shift_${monthlyShiftFilter}.xlsx`
    );
  };

  // =========================================================================
  // STORAGE SPACE REPORT AGGREGATION ENGINE (Warehouse Baskets + Machine Staging)
  // =========================================================================
  const storageSpaceAnalytics = useMemo(() => {
    const parseCoilWidthMm = (specStr: string): number => {
      if (!specStr) return 0;
      const parts = specStr.split("x");
      const widthPart = parts[1] || parts[0] || "";
      const numMatch = widthPart.match(/[\d.]+/);
      if (!numMatch) return 150;
      const val = parseFloat(numMatch[0]);
      if (isNaN(val)) return 150;
      return val < 10 ? val * 1000 : val;
    };

    const existingStatusMap: Record<
      string,
      { status: "available" | "occupied" | "full" | "maintenance"; notes?: string; maxCapacityKg?: number }
    > = {};

    // Group active inbound records by Building -> Row -> Basket
    const buildingGroupMap: Record<
      string,
      Record<
        string,
        Record<
          string,
          Array<{
            batch: string;
            spec: string;
            grade: string;
            weightKg: number;
            widthMm: number;
            inboundDate: string;
            machine: string;
          }>
        >
      >
    > = {
      H: {},
      F: {},
      E9: {},
      E10: {},
      I: {},
    };

    let resolvedSapMasterMap: Map<string, any> = sapMasterMap;
    if (!resolvedSapMasterMap || resolvedSapMasterMap.size === 0) {
      const fallbackMap = new Map<string, any>();
      try {
        const sapStr = localStorage.getItem("tmt_wms_slit_sap_master_records");
        if (sapStr) {
          const sapArr = JSON.parse(sapStr);
          if (Array.isArray(sapArr)) {
            sapArr.forEach((item: any) => {
              if (item?.batch) {
                fallbackMap.set(String(item.batch).trim().toUpperCase(), item);
              }
            });
          }
        }
      } catch {}
      resolvedSapMasterMap = fallbackMap;
    }

    const issuedAtMachineMap = new Map<string, string>();
    pickLists.forEach((pl) => {
      (pl.items || []).forEach((item: any) => {
        if (item.batch && item.machineIssued === true) {
          const bKey = item.batch.trim().toUpperCase();
          const ts = String(item.machineIssuedAt || pl.createdAt || "");
          const prevTs = issuedAtMachineMap.get(bKey) || "";
          if (ts >= prevTs) {
            issuedAtMachineMap.set(bKey, ts);
          }
        }
      });
    });
    outboundList.forEach((ob) => {
      if (!ob.batch) return;
      const loc = (ob.location || ob.storageLocation || "").trim().toUpperCase();
      if (
        loc.startsWith("เบิก") ||
        loc.includes("เบิก") ||
        (ob.conditionText && ob.conditionText.includes("รับงานหน้าเครื่อง"))
      ) {
        const bKey = ob.batch.trim().toUpperCase();
        const ts = String(ob.scanTimestamp || "");
        const prevTs = issuedAtMachineMap.get(bKey) || "";
        if (ts >= prevTs) {
          issuedAtMachineMap.set(bKey, ts);
        }
      }
    });

    const seenBatches = new Set<string>();

    inboundList.forEach((rec) => {
      if (!rec.batch) return;
      const bKey = rec.batch.trim().toUpperCase();
      if (!bKey || seenBatches.has(bKey)) return;
      seenBatches.add(bKey);

      const sapMatch = resolvedSapMasterMap.get(bKey);

      const isReturnedToWarehouse = Boolean(
        rec.conditionText && rec.conditionText.includes("คืนคลัง")
      );

      let rawLoc = (rec.location || rec.storageLocation || "").trim();
      if (
        (!rawLoc ||
          rawLoc === "-" ||
          rawLoc.toUpperCase() === "PENDING" ||
          rawLoc === "รอระบุ" ||
          rawLoc.includes("รอสแกน")) &&
        sapMatch?.storageLocation
      ) {
        rawLoc = String(sapMatch.storageLocation).trim();
      }

      const loc = rawLoc.toUpperCase().replace(/^อาคาร\s*/i, "").trim();

      const issuedTs = issuedAtMachineMap.get(bKey);
      const isIssuedAfterInbound =
        issuedTs !== undefined && !isReturnedToWarehouse;

      if (
        !loc ||
        loc === "-" ||
        loc === "PENDING" ||
        loc === "รอระบุ" ||
        loc.includes("รอสแกน") ||
        loc === "เตรียมออก" ||
        loc.startsWith("เบิก") ||
        loc.includes("เบิก") ||
        ["CF", "ML", "ZF"].includes(loc) ||
        /^(?:เบิก)?\s*(?:TM|CF|ML|ZF)\s*\d+/i.test(loc) ||
        rec.mode === "outbound" ||
        (rec.conditionText && rec.conditionText.includes("รับงานหน้าเครื่อง")) ||
        isIssuedAfterInbound
      ) {
        return;
      }

      let bId: "H" | "F" | "E9" | "E10" | "I" = "H";
      let rest = loc;

      if (/^E-?10(?![0-9])/i.test(loc) && (loc.length <= 4 || /^E-?10[-/_ A-Z]/i.test(loc))) {
        bId = "E10";
        rest = loc.replace(/^E-?10\s*[-/_]?\s*/i, "");
      } else if (/^E-?9(?![0-9])/i.test(loc) && (loc.length <= 3 || /^E-?9[-/_ A-Z]/i.test(loc))) {
        bId = "E9";
        rest = loc.replace(/^E-?9\s*[-/_]?\s*/i, "");
      } else if (loc.startsWith("F")) {
        bId = "F";
        rest = /^F\d+\s*[-/_]\s*[A-Z]/i.test(loc)
          ? loc.replace(/^F\d+\s*[-/_]\s*/i, "")
          : loc.replace(/^F\s*[-/_]?\s*/i, "");
      } else if (loc.startsWith("I")) {
        bId = "I";
        rest = /^I\d+\s*[-/_]\s*[A-Z]/i.test(loc)
          ? loc.replace(/^I\d+\s*[-/_]\s*/i, "")
          : loc.replace(/^I\s*[-/_]?\s*/i, "");
      } else if (loc.startsWith("H")) {
        bId = "H";
        rest = /^H\d+\s*[-/_]\s*[A-Z]/i.test(loc)
          ? loc.replace(/^H\d+\s*[-/_]\s*/i, "")
          : loc.replace(/^H\s*[-/_]?\s*/i, "");
      }

      rest = rest.replace(/^O(?=[A-Z]\d)/i, "").trim();
      const rowMatch = rest.match(/[A-Z]/);
      const rId = rowMatch ? rowMatch[0] : "A";
      const numMatch = rest.match(/\d+/);
      const bNo = numMatch ? numMatch[0].padStart(2, "0") : "01";
      const basketId = `${bId}-${rId}${bNo}`;

      if (!buildingGroupMap[bId]) buildingGroupMap[bId] = {};
      if (!buildingGroupMap[bId][rId]) buildingGroupMap[bId][rId] = {};
      if (!buildingGroupMap[bId][rId][basketId]) buildingGroupMap[bId][rId][basketId] = [];

      const certThickness = rec.certThickness || sapMatch?.certThickness;
      const width = rec.width || sapMatch?.width;
      const grade = rec.grade || sapMatch?.grade || "-";
      const weightKg = rec.weightKg || sapMatch?.weightKg || 0;
      const specStr = certThickness || width
        ? `${formatDimension2Decimals(certThickness, "-")} x ${formatDimension2Decimals(width, "-")}`
        : "-";

      buildingGroupMap[bId][rId][basketId].push({
        batch: rec.batch,
        spec: specStr,
        grade,
        weightKg,
        widthMm: parseCoilWidthMm(specStr),
        inboundDate: rec.scanTimestamp || "-",
        machine: rec.machine || "-",
      });
    });

    // Also include any maintenance baskets from existingStatusMap
    Object.entries(existingStatusMap).forEach(([bkId, info]) => {
      if (info.status === "maintenance") {
        let bId: "H" | "F" | "E9" | "E10" | "I" = "H";
        if (bkId.startsWith("F")) bId = "F";
        else if (bkId.startsWith("E9")) bId = "E9";
        else if (bkId.startsWith("E10")) bId = "E10";
        else if (bkId.startsWith("I")) bId = "I";
        const rowMatch = bkId.split("-")[1]?.match(/[A-Z]/);
        const rId = rowMatch ? rowMatch[0] : "A";
        if (!buildingGroupMap[bId][rId]) buildingGroupMap[bId][rId] = {};
        if (!buildingGroupMap[bId][rId][bkId]) buildingGroupMap[bId][rId][bkId] = [];
      }
    });

    const allBasketRows: Array<{
      buildingId: "H" | "F" | "E9" | "E10" | "I";
      buildingNameTh: string;
      rowId: string;
      basketId: string;
      basketNo: string;
      status: "available" | "occupied" | "full" | "maintenance";
      coilCount: number;
      totalWidthMm: number;
      totalWidthMeters: number;
      totalWeightKg: number;
      maxCapacityKg: number;
      coils: Array<{
        batch: string;
        spec: string;
        grade: string;
        weightKg: number;
        widthMm: number;
        inboundDate: string;
        machine: string;
      }>;
    }> = [];

    const masterLayout = getStoredMasterBasketLayout();

    const buildingSummaries = REPORT_BUILDING_META.map((meta) => {
      const masterB = masterLayout.find((m) => m.buildingId === meta.buildingId);
      const rowsObj = buildingGroupMap[meta.buildingId] || {};

      const masterRowKeys = masterB ? masterB.rows.map((r) => r.rowId) : [];
      const inboundRowKeys = Object.keys(rowsObj);
      const allRowKeys = Array.from(new Set([...masterRowKeys, ...inboundRowKeys])).sort();

      let totalBaskets = 0;
      let availableBaskets = 0;
      let occupiedBaskets = 0;
      let fullBaskets = 0;
      let maintenanceBaskets = 0;
      let totalCoils = 0;
      let totalWeightKg = 0;
      let maxCapacityKg = 0;

      allRowKeys.forEach((rId) => {
        const masterRow = masterB?.rows.find((r) => r.rowId === rId);
        const masterBasketKeys = masterRow ? masterRow.baskets.map((b) => b.id) : [];
        const inboundBasketsObj = rowsObj[rId] || {};
        const inboundBasketKeys = Object.keys(inboundBasketsObj);
        const allBasketKeys = Array.from(new Set([...masterBasketKeys, ...inboundBasketKeys])).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true })
        );

        allBasketKeys.forEach((bKey, idx) => {
          const coils = inboundBasketsObj[bKey] || [];
          const totalWidthMm = coils.reduce((s, c) => s + c.widthMm, 0);
          const basketWeightKg = coils.reduce((s, c) => s + c.weightKg, 0);
          const existingInfo = existingStatusMap[bKey];
          const basketMaxCapKg = existingInfo?.maxCapacityKg || 2500;

          let status: "available" | "occupied" | "full" | "maintenance" = "available";
          if (existingInfo?.status === "maintenance") {
            status = "maintenance";
          } else if (coils.length === 0) {
            status = "available";
          } else if (totalWidthMm >= 2000) {
            status = "full";
          } else {
            status = "occupied";
          }

          totalBaskets += 1;
          maxCapacityKg += basketMaxCapKg;
          totalCoils += coils.length;
          totalWeightKg += basketWeightKg;

          if (status === "available") availableBaskets += 1;
          else if (status === "occupied") occupiedBaskets += 1;
          else if (status === "full") fullBaskets += 1;
          else if (status === "maintenance") maintenanceBaskets += 1;

          allBasketRows.push({
            buildingId: meta.buildingId,
            buildingNameTh: meta.buildingNameTh,
            rowId: rId,
            basketId: bKey,
            basketNo: String(idx + 1).padStart(2, "0"),
            status,
            coilCount: coils.length,
            totalWidthMm,
            totalWidthMeters: Number((totalWidthMm / 1000).toFixed(2)),
            totalWeightKg: basketWeightKg,
            maxCapacityKg: basketMaxCapKg,
            coils,
          });
        });
      });

      const occupancyPercent =
        totalBaskets > 0 ? Math.round(((occupiedBaskets + fullBaskets) / totalBaskets) * 100) : 0;

      return {
        ...meta,
        rowCount: allRowKeys.length,
        totalBaskets,
        availableBaskets,
        occupiedBaskets,
        fullBaskets,
        maintenanceBaskets,
        totalCoils,
        totalWeightKg,
        maxCapacityKg,
        occupancyPercent,
      };
    });

    const warehouseTotals = buildingSummaries.reduce(
      (acc, b) => {
        acc.totalBaskets += b.totalBaskets;
        acc.availableBaskets += b.availableBaskets;
        acc.occupiedBaskets += b.occupiedBaskets;
        acc.fullBaskets += b.fullBaskets;
        acc.maintenanceBaskets += b.maintenanceBaskets;
        acc.totalCoils += b.totalCoils;
        acc.totalWeightKg += b.totalWeightKg;
        acc.maxCapacityKg += b.maxCapacityKg;
        return acc;
      },
      {
        totalBaskets: 0,
        availableBaskets: 0,
        occupiedBaskets: 0,
        fullBaskets: 0,
        maintenanceBaskets: 0,
        totalCoils: 0,
        totalWeightKg: 0,
        maxCapacityKg: 0,
      }
    );

    const warehouseOccupancyPercent =
      warehouseTotals.totalBaskets > 0
        ? Math.round(
            ((warehouseTotals.occupiedBaskets + warehouseTotals.fullBaskets) /
              warehouseTotals.totalBaskets) *
              100
          )
        : 0;

    const maxBuildingWeightKg = Math.max(
      1000,
      ...buildingSummaries.map((b) => b.totalWeightKg)
    ) * 1.15;

    // 2. Machine Staging Area Analytics (TM 1-14 / CF 1, 2, 4, 5)
    const machineSummaries = machineStagingConfigs.map((m) => {
      let totalRacks = (m.racks || []).length;
      let availableRacks = 0;
      let occupiedRacks = 0;
      let fullRacks = 0;
      let maintenanceRacks = 0;
      let totalCapacityMeters = 0;
      let totalUsedMeters = 0;
      let totalCoils = 0;
      let totalWeightKg = 0;

      const rackDetails = (m.racks || []).map((r) => {
        const maxM = Math.max(1, Math.round((r.maxCapacityMm || 2000) / 1000));
        const accWidthMm = calculateAccumulatedWidthMm(r.coils || []);
        const usedM = Math.min(
          maxM,
          Math.max(0, r.usedMeters ?? (accWidthMm > 0 ? Math.ceil(accWidthMm / 1000) : 0))
        );
        const rackWeightKg = (r.coils || []).reduce((s, c) => s + (c.weightKg || 0), 0);

        totalCapacityMeters += maxM;
        totalUsedMeters += usedM;
        totalCoils += (r.coils || []).length;
        totalWeightKg += rackWeightKg;

        let effectiveStatus: "available" | "occupied" | "full" | "maintenance" = r.status;
        if (effectiveStatus !== "maintenance") {
          if (usedM === 0 && (r.coils || []).length === 0) effectiveStatus = "available";
          else if (usedM >= maxM) effectiveStatus = "full";
          else effectiveStatus = "occupied";
        }

        if (effectiveStatus === "maintenance") maintenanceRacks += 1;
        else if (effectiveStatus === "available") availableRacks += 1;
        else if (effectiveStatus === "full") fullRacks += 1;
        else occupiedRacks += 1;

        return {
          rackId: r.rackId,
          rackNo: r.rackNo,
          rackNameTh: r.rackNameTh,
          maxMeters: maxM,
          usedMeters: usedM,
          status: effectiveStatus,
          coilCount: (r.coils || []).length,
          weightKg: rackWeightKg,
          coils: r.coils || [],
        };
      });

      const utilizationPercent =
        totalCapacityMeters > 0 ? Math.round((totalUsedMeters / totalCapacityMeters) * 100) : 0;

      return {
        machineId: m.machineId,
        machineCode: m.machineCode,
        machineNameTh: m.machineNameTh,
        category: m.category,
        descriptionTh: m.descriptionTh || "",
        totalRacks,
        availableRacks,
        occupiedRacks,
        fullRacks,
        maintenanceRacks,
        totalCapacityMeters,
        totalUsedMeters,
        totalCoils,
        totalWeightKg,
        utilizationPercent,
        hasActivity: totalUsedMeters > 0 || totalCoils > 0,
        rackDetails,
      };
    });

    const machineTotals = machineSummaries.reduce(
      (acc, m) => {
        acc.totalMachines += 1;
        if (m.hasActivity) acc.activeMachines += 1;
        acc.totalRacks += m.totalRacks;
        acc.availableRacks += m.availableRacks;
        acc.occupiedRacks += m.occupiedRacks;
        acc.fullRacks += m.fullRacks;
        acc.maintenanceRacks += m.maintenanceRacks;
        acc.totalCapacityMeters += m.totalCapacityMeters;
        acc.totalUsedMeters += m.totalUsedMeters;
        acc.totalCoils += m.totalCoils;
        acc.totalWeightKg += m.totalWeightKg;
        return acc;
      },
      {
        totalMachines: 0,
        activeMachines: 0,
        totalRacks: 0,
        availableRacks: 0,
        occupiedRacks: 0,
        fullRacks: 0,
        maintenanceRacks: 0,
        totalCapacityMeters: 0,
        totalUsedMeters: 0,
        totalCoils: 0,
        totalWeightKg: 0,
      }
    );

    const machineUtilizationPercent =
      machineTotals.totalCapacityMeters > 0
        ? Math.round((machineTotals.totalUsedMeters / machineTotals.totalCapacityMeters) * 100)
        : 0;

    return {
      buildingSummaries,
      allBasketRows,
      warehouseTotals,
      warehouseOccupancyPercent,
      maxBuildingWeightKg,
      machineSummaries,
      machineTotals,
      machineUtilizationPercent,
    };
  }, [inboundList, outboundList, pickLists, sapMasterMap, machineStagingConfigs, spaceStorageTick]);

  // Export Storage Space Report to Excel Workbook
  const exportSpaceReportToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Building Summary
    const buildingSheet = storageSpaceAnalytics.buildingSummaries.map((b, idx) => ({
      "ลำดับ": idx + 1,
      "อาคาร (Building)": b.buildingNameTh,
      "รายละเอียดโซน": b.subtitleTh,
      "จำนวนแถว": b.rowCount,
      "ตะกร้าทั้งหมด": b.totalBaskets,
      "ตะกร้าว่าง": b.availableBaskets,
      "ตะกร้าใช้งาน": b.occupiedBaskets,
      "ตะกร้าเต็ม": b.fullBaskets,
      "ปิดซ่อมบำรุง": b.maintenanceBaskets,
      "จำนวนแถบเหล็กสลิต": b.totalCoils,
      "น้ำหนักรวม (kg)": b.totalWeightKg,
      "ความจุน้ำหนักรวม (kg)": b.maxCapacityKg,
      "อัตราการใช้งาน (%)": `${b.occupancyPercent}%`,
    }));
    const wsBuilding = XLSX.utils.json_to_sheet(buildingSheet);
    XLSX.utils.book_append_sheet(wb, wsBuilding, "สรุปคลังอาคาร");

    // Sheet 2: Basket Details
    const basketSheet = storageSpaceAnalytics.allBasketRows.map((bk, idx) => ({
      "ลำดับ": idx + 1,
      "อาคาร": bk.buildingNameTh,
      "แถว": `แถว ${bk.rowId}`,
      "รหัสตะกร้า": bk.basketId,
      "สถานะ":
        bk.status === "maintenance"
          ? "ปิดซ่อมบำรุง"
          : bk.status === "full"
          ? "เต็ม"
          : bk.status === "occupied"
          ? "ใช้งาน"
          : "ว่าง",
      "จำนวนแถบ": bk.coilCount,
      "ความกว้างสะสม (mm)": bk.totalWidthMm,
      "ความกว้างสะสม (m)": bk.totalWidthMeters,
      "น้ำหนักรวม (kg)": bk.totalWeightKg,
      "รายการ Batch": bk.coils.map((c) => c.batch).join(", "),
    }));
    const wsBasket = XLSX.utils.json_to_sheet(
      basketSheet.length > 0
        ? basketSheet
        : [{ "ลำดับ": "-", "อาคาร": "ไม่มีข้อมูลในคลังตะกร้า", "รหัสตะกร้า": "-", "สถานะ": "-" }]
    );
    XLSX.utils.book_append_sheet(wb, wsBasket, "รายละเอียดตะกร้า");

    // Sheet 3: Machine Staging Summary
    const machineSheet = storageSpaceAnalytics.machineSummaries.map((m, idx) => {
      const p = machineProductionStatus[m.machineId];
      const pStatuses: string[] = [];
      if (p?.waitingMoveInActive && (p?.waitingMoveInCoils || 0) > 0) {
        pStatuses.push(`รอย้ายเข้า ${p.waitingMoveInCoils} แถบ`);
      }
      if (p?.waitingSlitActive && (p?.waitingSlitCoils || 0) > 0) {
        pStatuses.push(`รอสลิต ${p.waitingSlitCoils} แถบ`);
      }

      return {
        "ลำดับ": idx + 1,
        "รหัสเครื่องจักร": m.machineCode,
        "ชื่อเครื่องจักร": m.machineNameTh,
        "ประเภทเครื่อง": m.category === "pipe" ? "เครื่องผลิตท่อ (TM)" : "เครื่องผลิตตัวซี (CF)",
        "จำนวนแคร่ทั้งหมด": m.totalRacks,
        "แคร่ว่าง": m.availableRacks,
        "แคร่ใช้งาน": m.occupiedRacks,
        "แคร่เต็ม": m.fullRacks,
        "ซ่อมบำรุง": m.maintenanceRacks,
        "ความยาวใช้งาน (m)": m.totalUsedMeters,
        "ความจุความยาวรวม (m)": m.totalCapacityMeters,
        "จำนวนแถบหน้าเครื่อง": m.totalCoils,
        "น้ำหนักรวม (kg)": m.totalWeightKg,
        "อัตราการใช้พื้นที่ (%)": `${m.utilizationPercent}%`,
        "สถานะการผลิต": pStatuses.join(", ") || "-",
      };
    });
    const wsMachine = XLSX.utils.json_to_sheet(machineSheet);
    XLSX.utils.book_append_sheet(wb, wsMachine, "สรุปพื้นที่หน้าเครื่องจักร");

    // Sheet 4: Machine Rack Details
    const rackRows: any[] = [];
    storageSpaceAnalytics.machineSummaries.forEach((m) => {
      m.rackDetails.forEach((r) => {
        rackRows.push({
          "เครื่องจักร": m.machineCode,
          "กลุ่ม": m.category === "pipe" ? "TM" : "CF",
          "ชื่อแคร่": r.rackNameTh,
          "สถานะแคร่":
            r.status === "maintenance"
              ? "ปิดซ่อมบำรุง"
              : r.status === "full"
              ? "เต็ม"
              : r.status === "occupied"
              ? "ใช้งาน"
              : "ว่าง",
          "พื้นที่ใช้งาน (m)": r.usedMeters,
          "ความจุแคร่ (m)": r.maxMeters,
          "จำนวนแถบ": r.coilCount,
          "น้ำหนักรวม (kg)": r.weightKg,
          "รายการ Batch": r.coils.map((c) => c.batch).join(", ") || "-",
        });
      });
    });
    const wsRacks = XLSX.utils.json_to_sheet(rackRows);
    XLSX.utils.book_append_sheet(wb, wsRacks, "รายละเอียดแคร่หน้าเครื่อง");

    XLSX.writeFile(wb, `WMS_Storage_Space_Report_${todayStr}.xlsx`);
  };

  return (
    <div className="space-y-3 sm:space-y-6 pb-8 sm:pb-12 animate-fade-in text-slate-800 dark:text-slate-100">
      {/* =========================================================================
          REPORT MODE SWITCHER (Daily Report vs Monthly Report vs Storage Space Report)
          ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 p-0.5 sm:p-2.5 rounded-lg sm:rounded-2xl bg-slate-100/90 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] shadow-xs">
        <div className="flex items-center justify-between sm:inline-flex sm:flex-wrap w-full sm:w-auto rounded-md sm:rounded-xl p-0.5 sm:p-1 bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-xs gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => setReportMode("daily")}
            className={`flex-1 sm:flex-initial px-1 sm:px-4 py-1 sm:py-2 rounded sm:rounded-lg text-[9px] sm:text-sm font-bold sm:font-extrabold tracking-tighter sm:tracking-normal leading-tight transition-all flex items-center justify-center gap-0.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
              reportMode === "daily"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <FileText size={10} className="shrink-0 w-2.5 h-2.5 sm:w-4 sm:h-4" />
            <span>{isThai ? "รายงานประจำวัน" : "Daily Report"}</span>
          </button>

          <button
            type="button"
            onClick={() => setReportMode("monthly")}
            className={`flex-1 sm:flex-initial px-1 sm:px-4 py-1 sm:py-2 rounded sm:rounded-lg text-[9px] sm:text-sm font-bold sm:font-extrabold tracking-tighter sm:tracking-normal leading-tight transition-all flex items-center justify-center gap-0.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
              reportMode === "monthly"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Calendar size={10} className="shrink-0 w-2.5 h-2.5 sm:w-4 sm:h-4" />
            <span>{isThai ? "รายงานประจำเดือน" : "Monthly Report"}</span>
          </button>

          <button
            type="button"
            onClick={() => setReportMode("space")}
            className={`flex-1 sm:flex-initial px-1 sm:px-4 py-1 sm:py-2 rounded sm:rounded-lg text-[9px] sm:text-sm font-bold sm:font-extrabold tracking-tighter sm:tracking-normal leading-tight transition-all flex items-center justify-center gap-0.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
              reportMode === "space"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Boxes size={10} className="shrink-0 w-2.5 h-2.5 sm:w-4 sm:h-4" />
            <span className="sm:hidden">{isThai ? "พื้นที่จัดเก็บ" : "Space"}</span>
            <span className="hidden sm:inline">{isThai ? "รายงานพื้นที่จัดเก็บเหล็กสลิต" : "Storage Space Report"}</span>
          </button>
        </div>

        <div className="hidden sm:flex text-[11px] font-medium text-slate-500 dark:text-slate-400 px-2 items-center gap-2">
          <span>
            {reportMode === "daily"
              ? isThai
                ? `โหมดรายงานรายวัน · ข้อมูลวันที่ ${selectedDate}`
                : `Daily Mode · ${selectedDate}`
              : reportMode === "monthly"
              ? isThai
                ? `โหมดรายงานสะสมรายเดือน · ประจำเดือน ${selectedMonth} (${monthlyAnalytics.activeDaysCount}/${monthlyAnalytics.daysInMonth} วันที่มีรายการ)`
                : `Monthly Cumulative Mode · ${selectedMonth}`
              : isThai
              ? `โหมดรายงานพื้นที่จัดเก็บเหล็กสลิต · คลังอาคาร & หน้าเครื่องจักร`
              : `Storage Space Report Mode · Buildings & Machine Staging`}
          </span>
        </div>
      </div>

      {reportMode === "daily" ? (
        <>
          {/* =========================================================================
              HEADER & FILTER BAR (Section 1 Requirement)
              ========================================================================= */}
          {/* =========================================================================
              HEADER & FILTER BAR (Compact Inline Single Row Layout)
              ========================================================================= */}
      <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md flex flex-col lg:flex-row lg:flex-wrap lg:items-center justify-between gap-2 sm:gap-3 overflow-hidden">
        {/* Left: Title & Subtitle */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-xs shrink-0">
            <FileText size={18} className="sm:w-[22px] sm:h-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-lg font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2 truncate">
              <span className="truncate">{isThai ? "รายงานประจำวัน (Daily Report)" : "Daily Production & Material Report"}</span>
            </h2>
            <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {isThai
                ? "สรุปการรับเข้าวัตถุดิบเครื่องจักร SM01 - SM04 และรายงานการเบิกจ่ายหน้าเครื่องประจำวัน"
                : "Daily Machine Inbound & Dispensing Summary Report"}
            </p>
          </div>
        </div>

        {/* Right: Inline Compact Controls (Date, Shift, Excel, Print) */}
        <div className="flex items-center justify-start lg:justify-end gap-1.5 sm:gap-2 flex-wrap w-full lg:w-auto max-w-full shrink-0">
          {/* 1. Compact Date Selector */}
          <div className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs flex-1 sm:flex-initial justify-between sm:justify-start shrink-0">
            <div className="flex items-center gap-1 shrink-0">
              <Calendar size={13} className="text-cyan-500 shrink-0 sm:w-3.5 sm:h-3.5" />
              <span className="font-bold text-slate-700 dark:text-slate-300 text-[10.5px] sm:text-[11px] shrink-0">
                {isThai ? "วันที่:" : "Date:"}
              </span>
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setHasUserChangedShift(false);
              }}
              className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[11px] sm:text-xs font-mono font-bold bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer shadow-xs"
            />
          </div>

          {/* 2. Compact Shift Selector + Integrated Period Badge */}
          <div className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs shrink-0">
            <Clock size={13} className="text-amber-500 shrink-0 hidden sm:block sm:w-3.5 sm:h-3.5" />
            <div className="inline-flex rounded-md sm:rounded-lg p-0.5 bg-slate-200/80 dark:bg-[#122342] border border-slate-300 dark:border-[#1e3a5f]">
              <button
                type="button"
                onClick={() => {
                  setHasUserChangedShift(true);
                  setSelectedShift("day");
                }}
                className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[10.5px] sm:text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  selectedShift === "day"
                    ? "bg-amber-500 text-white shadow-xs font-extrabold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Sun size={11} className="sm:w-3 sm:h-3" />
                <span>{isThai ? "กะเช้า" : "Day"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setHasUserChangedShift(true);
                  setSelectedShift("night");
                }}
                className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[10.5px] sm:text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  selectedShift === "night"
                    ? "bg-indigo-600 text-white shadow-xs font-extrabold"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Moon size={11} className="sm:w-3 sm:h-3" />
                <span>{isThai ? "กะดึก" : "Night"}</span>
              </button>
            </div>

            {/* Embedded Shift Period Badge */}
            <span className="hidden 2xl:inline-block font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-cyan-500/10 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-500/20 whitespace-nowrap">
              {selectedShift === "day"
                ? "08:00-20:00 น."
                : "20:00-08:00 น."}
            </span>
          </div>

          {/* 3. Export Excel */}
          <button
            type="button"
            onClick={exportToExcel}
            className="hidden sm:flex px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs items-center gap-1.5 transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet size={14} className="shrink-0" />
            <span>{isThai ? "ส่งออก Excel" : "Export"}</span>
          </button>

          {/* 4. Print Report */}
          <button
            type="button"
            onClick={() => window.print()}
            className="hidden sm:flex px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-[#182a4a] hover:bg-slate-200 dark:hover:bg-[#20375e] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#1e3a5f] shadow-xs items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <Printer size={14} className="shrink-0" />
            <span>{isThai ? "พิมพ์" : "Print"}</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          SECTION 3 KPI SUMMARY CARDS (Top Overview Dashboard)
          ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {/* KPI 1: SM Inbound Weight */}
        <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-cyan-500 relative overflow-hidden">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
              {isThai ? "รับเข้า SM01 - SM04" : "SM01-SM04 Inbound"}
            </span>
            <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-cyan-500/10 text-cyan-500 shrink-0">
              <TrendingUp size={14} className="sm:w-[18px] sm:h-[18px]" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
              {totalSmInboundWeightKg.toLocaleString()}
            </span>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500">kg</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-cyan-600 dark:text-cyan-400 font-bold font-mono truncate">
            = {(totalSmInboundWeightKg / 1000).toFixed(3)} TON ({smInboundRecords.length} {isThai ? "รายการ" : "coils"})
          </div>
        </div>

        {/* KPI 2: Machine Dispensed Weight */}
        <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-amber-500 relative overflow-hidden">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
              {isThai ? "เบิกจ่ายหน้าเครื่อง" : "Machine Dispensed"}
            </span>
            <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
              <TrendingDown size={14} className="sm:w-[18px] sm:h-[18px]" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
              {totalDispensedWeightKg.toLocaleString()}
            </span>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500">kg</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 font-bold font-mono truncate">
            = {(totalDispensedWeightKg / 1000).toFixed(3)} TON ({machineDispensingRecords.length} {isThai ? "รายการ" : "coils"})
          </div>
        </div>

        {/* KPI 3: Net Movement Balance */}
        <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-emerald-500 relative overflow-hidden">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
              {isThai ? "ดุลเคลื่อนไหวสุทธิ" : "Net Movement Delta"}
            </span>
            <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
              <ArrowRightLeft size={14} className="sm:w-[18px] sm:h-[18px]" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span
              className={`text-base sm:text-2xl font-black font-mono ${
                totalSmInboundWeightKg - totalDispensedWeightKg >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {(totalSmInboundWeightKg - totalDispensedWeightKg >= 0 ? "+" : "") +
                (totalSmInboundWeightKg - totalDispensedWeightKg).toLocaleString()}
            </span>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500">kg</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-slate-500 font-mono font-medium truncate">
            {isThai ? "ผลต่างรับเข้า vs เบิกจ่าย" : "Inbound vs Dispensed Delta"}
          </div>
        </div>

        {/* KPI 4: Active Machines */}
        <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-purple-500 relative overflow-hidden">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
              {isThai ? "เครื่องจักรที่มีการเดินงาน" : "Active Machines"}
            </span>
            <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
              <Cpu size={14} className="sm:w-[18px] sm:h-[18px]" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
            <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
              {smInboundChartData.filter((m) => m.inboundKg > 0 || m.coilCount > 0).length +
                machineDispensingChartData.filter((m) => m.dispensedKg > 0 || m.coilCount > 0).length}
            </span>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500">{isThai ? "เครื่อง" : "units"}</span>
          </div>
          <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-purple-600 dark:text-purple-400 font-bold truncate">
            {isThai ? "กำลังการผลิตปกติ" : "Normal Operation"}
          </div>
        </div>
      </div>

      {/* =========================================================================
          SECTION 3: SEPARATED MACHINE CHARTS (Inbound vs Dispensing)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6">
        {/* Chart 1: Inbound SM01 - SM04 Chart */}
        <div className="p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-4">
          <div className="flex items-center justify-between border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <BarChart3 size={16} className="text-cyan-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
              <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                {isThai ? "1. กราฟสรุปการรับเข้าวัตถุดิบ (SM01 - SM04)" : "1. Material Inbound Summary (SM01 - SM04)"}
              </h3>
            </div>
            <span className="hidden sm:inline-block text-xs px-2.5 py-0.5 rounded-full font-bold bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
              {isThai ? "รับเข้าจากเครื่อง SM01-04" : "Pure Inbound"}
            </span>
          </div>

          <div className="h-44 sm:h-56 w-full pt-2">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 500 200" preserveAspectRatio="none">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                const y = 160 - ratio * 130;
                const val =
                  totalSmInboundWeightKg > 0 || smInboundRecords.length === 0
                    ? Math.round(maxSmInboundKg * ratio)
                    : Math.round(maxSmInboundCoils * ratio);
                return (
                  <g key={idx}>
                    <line x1="45" y1={y} x2="480" y2={y} stroke="rgba(148, 163, 184, 0.15)" strokeDasharray="3 3" />
                    <text x="40" y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8" className="font-mono">
                      {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                    </text>
                  </g>
                );
              })}

              {/* Inbound Bars */}
              {smInboundChartData.map((d, idx) => {
                const groupWidth = 435 / smInboundChartData.length;
                const xCenter = 55 + idx * groupWidth + groupWidth / 2;
                const barWidth = 32;

                const inboundHeight =
                  d.inboundKg > 0
                    ? (d.inboundKg / maxSmInboundKg) * 130
                    : d.coilCount > 0
                    ? (d.coilCount / maxSmInboundCoils) * 130
                    : 0;
                const xInbound = xCenter - barWidth / 2;
                const yInbound = 160 - inboundHeight;

                return (
                  <g key={d.machine} className="group cursor-pointer">
                    <rect
                      x={xInbound}
                      y={yInbound}
                      width={barWidth}
                      height={Math.max(3, inboundHeight)}
                      rx="4"
                      fill="url(#gradientPureInbound)"
                      className="transition-all duration-300 hover:opacity-80"
                    />

                    {(d.inboundKg > 0 || d.coilCount > 0) && (
                      <text
                        x={xCenter}
                        y={yInbound - 6}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="bold"
                        fill="#0284c7"
                        className="font-mono"
                      >
                        {d.inboundKg > 0
                          ? `${d.inboundKg >= 1000 ? `${(d.inboundKg / 1000).toFixed(1)}k` : d.inboundKg.toLocaleString()} kg (${d.coilCount})`
                          : `${d.coilCount} ${isThai ? "ม้วน" : "coils"}`}
                      </text>
                    )}

                    <text
                      x={xCenter}
                      y="182"
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#64748b"
                      className="font-mono"
                    >
                      {d.machine}
                    </text>
                  </g>
                );
              })}

              <defs>
                <linearGradient id="gradientPureInbound" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#0284c7" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* Chart 2: Machine Dispensing Chart */}
        <div className="p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-4">
          <div className="flex items-center justify-between border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <BarChart3 size={16} className="text-amber-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
              <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                {isThai ? "2. กราฟสรุปการเบิกจ่าย รายเครื่องจักรผลิต" : "2. Machine Dispensing Summary"}
              </h3>
            </div>
            <span className="hidden sm:inline-block text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              {isThai ? "เบิกจ่ายเครื่องTM,CF,MINI,ZF" : "Pure Dispensing"}
            </span>
          </div>

          <div className="h-44 sm:h-56 w-full pt-2">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 500 200" preserveAspectRatio="none">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                const y = 160 - ratio * 130;
                const val = Math.round(maxDispensingKg * ratio);
                return (
                  <g key={idx}>
                    <line x1="45" y1={y} x2="480" y2={y} stroke="rgba(148, 163, 184, 0.15)" strokeDasharray="3 3" />
                    <text x="40" y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8" className="font-mono">
                      {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                    </text>
                  </g>
                );
              })}

              {/* Dispensed Bars */}
              {machineDispensingChartData.map((d, idx) => {
                const groupWidth = 435 / machineDispensingChartData.length;
                const xCenter = 55 + idx * groupWidth + groupWidth / 2;
                const barWidth = 32;

                const dispensedHeight = (d.dispensedKg / maxDispensingKg) * 130;
                const xDispensed = xCenter - barWidth / 2;
                const yDispensed = 160 - dispensedHeight;

                return (
                  <g key={d.machine} className="group cursor-pointer">
                    <rect
                      x={xDispensed}
                      y={yDispensed}
                      width={barWidth}
                      height={Math.max(3, dispensedHeight)}
                      rx="4"
                      fill="url(#gradientPureDispensed)"
                      className="transition-all duration-300 hover:opacity-80"
                    />

                    {d.dispensedKg > 0 && (
                      <text
                        x={xCenter}
                        y={yDispensed - 6}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="bold"
                        fill="#f59e0b"
                        className="font-mono"
                      >
                        {(d.dispensedKg / 1000).toFixed(1)}k kg
                      </text>
                    )}

                    <text
                      x={xCenter}
                      y="182"
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#64748b"
                      className="font-mono"
                    >
                      {d.machine}
                    </text>
                  </g>
                );
              })}

              <defs>
                <linearGradient id="gradientPureDispensed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#d97706" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      {/* Row 2: Grade Donut Chart & Shift Hourly Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
        {/* Chart 3: Inbound vs Outbound Distribution Donut (Combined across Both Shifts) */}
        <div className="lg:col-span-1 p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <PieChartIcon size={16} className="text-purple-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
              <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white truncate">
                {isThai ? "3. สัดส่วนการรับเข้า-จ่ายออก ทั้ง2กะ" : "3. Inbound-Outbound Distribution (Both Shifts)"}
              </h3>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 whitespace-nowrap shrink-0">
              {isThai ? "กะเช้า + กะดึก" : "Day + Night"}
            </span>
          </div>

          {/* 2-Shift Combined Inbound & Outbound Summary Strip */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded-xl bg-cyan-50/70 dark:bg-[#0c1930] border border-cyan-200/80 dark:border-cyan-900/50">
              <div className="text-[10px] font-bold text-cyan-700 dark:text-cyan-400 flex items-center justify-between">
                <span>{isThai ? "รับเข้า (2 กะ)" : "Inbound (2 Shifts)"}</span>
                <span className="font-mono">{bothShiftsSummary.inboundPercent}%</span>
              </div>
              <div className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5">
                {bothShiftsSummary.totalInboundKg.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">kg</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {(bothShiftsSummary.totalInboundKg / 1000).toFixed(2)} TON ({bothShiftsSummary.totalInboundCoils} {isThai ? "ม้วน" : "coils"})
              </div>
            </div>

            <div className="p-2 rounded-xl bg-amber-50/70 dark:bg-[#0c1930] border border-amber-200/80 dark:border-amber-900/50">
              <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 flex items-center justify-between">
                <span>{isThai ? "จ่ายออก (2 กะ)" : "Outbound (2 Shifts)"}</span>
                <span className="font-mono">{bothShiftsSummary.outboundPercent}%</span>
              </div>
              <div className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5">
                {bothShiftsSummary.totalOutboundKg.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">kg</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {(bothShiftsSummary.totalOutboundKg / 1000).toFixed(2)} TON ({bothShiftsSummary.totalOutboundCoils} {isThai ? "ม้วน" : "coils"})
              </div>
            </div>
          </div>

          {/* Donut Chart representation (Inbound vs Outbound Proportion) */}
          <div className="flex flex-col items-center justify-center my-auto space-y-2.5 sm:space-y-3">
            <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                {bothShiftsSummary.grandTotalKg === 0 && bothShiftsSummary.grandTotalCoils === 0 ? (
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="transparent"
                    stroke="rgba(148, 163, 184, 0.2)"
                    strokeWidth="18"
                  />
                ) : (
                  (() => {
                    let accumulatedPercent = 0;
                    return inOutDistribution.map((item) => {
                      const strokeDasharray = `${item.percentage} ${100 - item.percentage}`;
                      const strokeDashoffset = -accumulatedPercent;
                      accumulatedPercent += item.percentage;
                      return (
                        <circle
                          key={item.key}
                          cx="50"
                          cy="50"
                          r="38"
                          fill="transparent"
                          stroke={item.color}
                          strokeWidth="18"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          pathLength="100"
                          className="transition-all duration-500 hover:opacity-80 cursor-pointer"
                        />
                      );
                    });
                  })()
                )}
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase">
                  {isThai ? "ยอดรวม 2 กะ" : "Total 2 Shifts"}
                </span>
                <span className="text-xs sm:text-sm font-black font-mono text-slate-900 dark:text-white leading-tight mt-0.5">
                  {(bothShiftsSummary.grandTotalKg / 1000).toFixed(1)} T
                </span>
                <span className="text-[9px] font-bold text-slate-400 mt-0.5">
                  ({bothShiftsSummary.grandTotalCoils} {isThai ? "ม้วน" : "coils"})
                </span>
              </div>
            </div>

            {/* Detailed Breakdown by Inbound & Outbound across Day Shift & Night Shift */}
            <div className="w-full space-y-1.5">
              {inOutDistribution.map((item) => (
                <div
                  key={item.key}
                  className="p-2 rounded-xl bg-slate-50/90 dark:bg-[#0c1930] border border-slate-200/80 dark:border-[#1e3a5f] text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="font-extrabold text-slate-800 dark:text-slate-100 text-[11px] sm:text-xs">
                        {isThai ? item.labelTh : item.labelEn}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[10.5px] sm:text-[11px]">
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {item.totalKg.toLocaleString()} kg ({item.totalCoils} {isThai ? "ม้วน" : "coils"})
                      </span>
                      <span
                        className={`font-black ${
                          item.key === "inbound"
                            ? "text-cyan-600 dark:text-cyan-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {item.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono pl-4 pt-0.5 border-t border-slate-200/60 dark:border-[#1e3a5f]/60 text-slate-500 dark:text-slate-400">
                    <span className="flex items-center justify-between pr-1">
                      <span className="text-amber-600 dark:text-amber-400 font-sans font-semibold">
                        ☀️ {isThai ? "กะเช้า:" : "Day:"}
                      </span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {item.dayKg.toLocaleString()} kg ({item.dayCoils})
                      </span>
                    </span>
                    <span className="flex items-center justify-between pl-1 border-l border-slate-200 dark:border-[#1e3a5f]">
                      <span className="text-indigo-600 dark:text-indigo-400 font-sans font-semibold">
                        🌙 {isThai ? "กะดึก:" : "Night:"}
                      </span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {item.nightKg.toLocaleString()} kg ({item.nightCoils})
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chart 4: Shift Timeline Hourly Throughput Area Chart */}
        <div className="lg:col-span-2 p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-3">
          <div className="flex items-center justify-between border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Activity size={16} className="text-emerald-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
              <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                {isThai ? "4. กราฟแนวโน้มการรับเข้า-เบิกจ่าย รายชั่วโมงในกะ" : "4. Hourly Shift Throughput Timeline"}
              </h3>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 text-[10.5px] sm:text-xs font-bold shrink-0">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-sky-500 inline-block" />
                <span>{isThai ? "รับเข้า" : "Inbound"}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-amber-500 inline-block" />
                <span>{isThai ? "เบิกจ่าย" : "Dispensed"}</span>
              </div>
            </div>
          </div>

          <div className="h-36 sm:h-44 w-full pt-2">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 600 140" preserveAspectRatio="none">
              {/* Grid Lines */}
              {[0, 0.5, 1].map((r, i) => {
                const y = 110 - r * 90;
                return (
                  <line key={i} x1="30" y1={y} x2="580" y2={y} stroke="rgba(148, 163, 184, 0.15)" strokeDasharray="3 3" />
                );
              })}

              {/* Connecting Lines for Hourly Data */}
              {(() => {
                const step = 540 / (hourlyActivityData.length - 1 || 1);
                const useCoilScale =
                  totalSmInboundWeightKg === 0 &&
                  totalDispensedWeightKg === 0 &&
                  (smInboundRecords.length > 0 || machineDispensingRecords.length > 0);

                const inboundPoints = hourlyActivityData
                  .map((d, idx) => {
                    const x = 35 + idx * step;
                    const y = useCoilScale
                      ? 110 - (d.inboundCoils / maxHourlyCoils) * 90
                      : 110 - (d.inbound / maxHourlyKg) * 90;
                    return `${x},${y}`;
                  })
                  .join(" ");

                const dispensedPoints = hourlyActivityData
                  .map((d, idx) => {
                    const x = 35 + idx * step;
                    const y = useCoilScale
                      ? 110 - (d.dispensedCoils / maxHourlyCoils) * 90
                      : 110 - (d.dispensed / maxHourlyKg) * 90;
                    return `${x},${y}`;
                  })
                  .join(" ");

                return (
                  <>
                    <polyline
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={inboundPoints}
                    />
                    <polyline
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={dispensedPoints}
                    />
                  </>
                );
              })()}

              {/* Points & Labels for Hourly Data */}
              {hourlyActivityData.map((d, idx) => {
                const step = 540 / (hourlyActivityData.length - 1 || 1);
                const x = 35 + idx * step;
                const useCoilScale =
                  totalSmInboundWeightKg === 0 &&
                  totalDispensedWeightKg === 0 &&
                  (smInboundRecords.length > 0 || machineDispensingRecords.length > 0);

                const yInbound = useCoilScale
                  ? 110 - (d.inboundCoils / maxHourlyCoils) * 90
                  : 110 - (d.inbound / maxHourlyKg) * 90;
                const yDispensed = useCoilScale
                  ? 110 - (d.dispensedCoils / maxHourlyCoils) * 90
                  : 110 - (d.dispensed / maxHourlyKg) * 90;

                const hasInbound = d.inbound > 0 || d.inboundCoils > 0;
                const hasDispensed = d.dispensed > 0 || d.dispensedCoils > 0;

                return (
                  <g key={d.hourLabel}>
                    {/* Inbound Point */}
                    <circle cx={x} cy={yInbound} r={hasInbound ? "5.5" : "3.5"} fill="#0284c7" />
                    {hasInbound && (
                      <text
                        x={x}
                        y={yInbound - 8}
                        textAnchor="middle"
                        fontSize="8.5"
                        fontWeight="bold"
                        fill="#0284c7"
                        className="font-mono"
                      >
                        {d.inbound > 0
                          ? `${d.inbound >= 1000 ? `${(d.inbound / 1000).toFixed(1)}k` : d.inbound}`
                          : `${d.inboundCoils} ม้วน`}
                      </text>
                    )}

                    {/* Dispensed Point */}
                    <circle cx={x} cy={yDispensed} r={hasDispensed ? "5.5" : "3.5"} fill="#f59e0b" />
                    {hasDispensed && (
                      <text
                        x={x}
                        y={yDispensed - 8}
                        textAnchor="middle"
                        fontSize="8.5"
                        fontWeight="bold"
                        fill="#d97706"
                        className="font-mono"
                      >
                        {d.dispensed > 0
                          ? `${d.dispensed >= 1000 ? `${(d.dispensed / 1000).toFixed(1)}k` : d.dispensed}`
                          : `${d.dispensedCoils} ม้วน`}
                      </text>
                    )}

                    {/* Hour Label */}
                    <text x={x} y="128" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#64748b" className="font-mono">
                      {d.hourLabel}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SECTION 1: รายงานการรับเข้าจากเครื่องจักร SM01 - SM04 (Table)
          ========================================================================= */}
      <section className="rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md overflow-hidden">
        <div className="p-2.5 sm:p-5 bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
              <Layers size={16} className="sm:w-5 sm:h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center flex-wrap gap-1.5 sm:gap-2">
                <span>{isThai ? "ส่วนที่ 1: รายงานการรับเข้าจากเครื่องจักร SM01 - SM04" : "Section 1: SM01 - SM04 Machine Inbound Report"}</span>
                <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full font-bold bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300">
                  {smInboundRecords.length} {isThai ? "รายการ" : "records"}
                </span>
              </h3>
              <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isThai
                  ? "ตารางสรุปรายการวัตถุดิบเหล็กสลิตที่สแกนรับเข้าจากเครื่อง SM01 ถึง SM04 ในกะและวันที่เลือก"
                  : "Summary of raw materials received from SM01 to SM04 machines"}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right font-mono text-[11px] sm:text-xs font-bold text-cyan-600 dark:text-cyan-400">
            {isThai ? "น้ำหนักรวมรับเข้า: " : "Total Inbound: "}
            <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white">
              {totalSmInboundWeightKg.toLocaleString()} kg
            </span>{" "}
            ({(totalSmInboundWeightKg / 1000).toFixed(3)} TON)
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[10.5px] sm:text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#1e3a5f] whitespace-nowrap">
                <th className="!p-1.5 sm:!p-3 !text-center w-10 sm:w-14">#</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "เวลา" : "Time"}</th>
                <th className="!p-1.5 sm:!p-3 !text-left">{isThai ? "เลขที่ Batch" : "Batch Barcode"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "เครื่องจักร" : "Machine"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "เกรด (Grade)" : "Grade"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "ความหนา" : "Thickness"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "ความกว้าง" : "Width"}</th>
                <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "น้ำหนัก (kg)" : "Weight (kg)"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "ผู้บันทึก" : "Recorded By"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {smInboundRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="!p-5 sm:!p-8 !text-center text-slate-400 text-[11px] sm:text-xs font-medium">
                    {isThai
                      ? `ไม่พบข้อมูลการรับเข้าจากเครื่องจักร SM01 - SM04 ในวันที่ ${selectedDate} (${
                          selectedShift === "day" ? "กะเช้า" : "กะดึก"
                        })`
                      : "No SM01-SM04 inbound data found for selected date and shift."}
                  </td>
                </tr>
              ) : (
                smInboundRecords.map((r, idx) => (
                  <tr
                    key={r.id || r.batch + idx}
                    className="hover:bg-cyan-50/40 dark:hover:bg-cyan-950/20 transition-colors whitespace-nowrap"
                  >
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                      {formatTimeDisplay(r.scanTimestamp)}
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-left font-mono font-black text-cyan-600 dark:text-cyan-400">{r.batch}</td>
                    <td className="!p-1.5 sm:!p-3 !text-center">
                      <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold font-mono bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
                        {r.machine || "SM01"}
                      </span>
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                      {r.grade || "SS400"}
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      {formatDimension2Decimals(r.certThickness, "2.50 mm")}
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      {formatDimension2Decimals(r.width, "100.00 mm")}
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-right font-mono font-black text-slate-900 dark:text-white tabular-nums">
                      {(r.weightKg || 0).toLocaleString()} kg
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-center text-slate-600 dark:text-slate-400 text-[10.5px] sm:text-[11.5px]">
                      {r.conditionText || "Operator SM"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {smInboundRecords.length > 0 && (
              <tfoot className="bg-slate-100 dark:bg-[#0c1930] font-bold border-t-2 border-slate-300 dark:border-[#1e3a5f] whitespace-nowrap">
                <tr>
                  <td colSpan={7} className="!p-1.5 sm:!p-3 !text-right uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {isThai ? "ยอดรวมน้ำหนักรับเข้าทั้งหมด (Total Inbound Weight):" : "Total Inbound Weight:"}
                  </td>
                  <td className="!p-1.5 sm:!p-3 !text-right font-mono font-black text-xs sm:text-sm text-cyan-600 dark:text-cyan-400 tabular-nums">
                    {totalSmInboundWeightKg.toLocaleString()} kg
                  </td>
                  <td className="!p-1.5 sm:!p-3 !text-center font-mono text-[10.5px] sm:text-xs text-slate-500 tabular-nums">
                    ({(totalSmInboundWeightKg / 1000).toFixed(3)} TON)
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: รายงานการเบิกจ่ายหน้าเครื่อง (Machine Issuance / Dispensing Report)
          ========================================================================= */}
      <section className="rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md overflow-hidden">
        <div className="p-2.5 sm:p-5 bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
              <Cpu size={16} className="sm:w-5 sm:h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center flex-wrap gap-1.5 sm:gap-2">
                <span>{isThai ? "ส่วนที่ 2: รายงานการเบิกจ่ายหน้าเครื่อง (Machine Issuance / Dispensing)" : "Section 2: Machine Dispensing Report"}</span>
                <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                  {machineDispensingRecords.length} {isThai ? "รายการ" : "records"}
                </span>
              </h3>
              <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isThai
                  ? "ตารางสรุปรายการเบิกจ่ายวัตถุดิบเหล็กสลิตไปหน้าเครื่องจักรผลิตในกะและวันที่เลือก"
                  : "Summary of materials dispensed to machine stations"}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right font-mono text-[11px] sm:text-xs font-bold text-amber-600 dark:text-amber-400">
            {isThai ? "น้ำหนักรวมเบิกจ่าย: " : "Total Dispensed: "}
            <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white">
              {totalDispensedWeightKg.toLocaleString()} kg
            </span>{" "}
            ({(totalDispensedWeightKg / 1000).toFixed(3)} TON)
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[10.5px] sm:text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#1e3a5f] whitespace-nowrap">
                <th className="!p-1.5 sm:!p-3 !text-center w-10 sm:w-14">#</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "เวลา" : "Time"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "เลขที่ใบสั่งเบิก" : "Order No."}</th>
                <th className="!p-1.5 sm:!p-3 !text-left">{isThai ? "เลขที่ Batch" : "Batch Barcode"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "เครื่องจักรปลายทาง" : "Destination Machine"}</th>
                <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "น้ำหนักที่เบิก (kg)" : "Dispensed Wt (kg)"}</th>
                <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "สถานะการเบิก" : "Status"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
              {machineDispensingRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="!p-5 sm:!p-8 !text-center text-slate-400 text-[11px] sm:text-xs font-medium">
                    {isThai
                      ? `ไม่พบข้อมูลการเบิกจ่ายหน้าเครื่อง ในวันที่ ${selectedDate} (${
                          selectedShift === "day" ? "กะเช้า" : "กะดึก"
                        })`
                      : "No machine dispensing data found for selected date and shift."}
                  </td>
                </tr>
              ) : (
                machineDispensingRecords.map((r, idx) => (
                  <tr
                    key={r.id || r.batch + idx}
                    className="hover:bg-amber-50/40 dark:hover:bg-amber-950/20 transition-colors whitespace-nowrap"
                  >
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono font-bold text-slate-600 dark:text-slate-300 tabular-nums">{r.time}</td>
                    <td className="!p-1.5 sm:!p-3 !text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                      {r.orderNo !== "-" ? `#${r.orderNo}` : "-"}
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-left font-mono font-black text-slate-900 dark:text-white">{r.batch}</td>
                    <td className="!p-1.5 sm:!p-3 !text-center">
                      <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold font-mono bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                        {r.destinationMachine}
                      </span>
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-right font-mono font-black text-slate-900 dark:text-white tabular-nums">
                      {r.weightKg.toLocaleString()} kg
                    </td>
                    <td className="!p-1.5 sm:!p-3 !text-center">
                      <span className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-md text-[10px] sm:text-[10.5px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        <CheckCircle2 size={11} className="sm:w-3 sm:h-3" />
                        <span>{r.status}</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {machineDispensingRecords.length > 0 && (
              <tfoot className="bg-slate-100 dark:bg-[#0c1930] font-bold border-t-2 border-slate-300 dark:border-[#1e3a5f] whitespace-nowrap">
                <tr>
                  <td colSpan={5} className="!p-1.5 sm:!p-3 !text-right uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {isThai ? "ยอดรวมน้ำหนักเบิกจ่ายทั้งหมด (Total Dispensed Weight):" : "Total Dispensed Weight:"}
                  </td>
                  <td className="!p-1.5 sm:!p-3 !text-right font-mono font-black text-xs sm:text-sm text-amber-600 dark:text-amber-400 tabular-nums">
                    {totalDispensedWeightKg.toLocaleString()} kg
                  </td>
                  <td className="!p-1.5 sm:!p-3 !text-center font-mono text-[10.5px] sm:text-xs text-slate-500 tabular-nums">
                    ({(totalDispensedWeightKg / 1000).toFixed(3)} TON)
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
        </>
      ) : reportMode === "monthly" ? (
        /* =========================================================================
           MONTHLY REPORT VIEW (Cumulative Daily & Machine Analytics)
           ========================================================================= */
        <>
          {/* MONTHLY HEADER & FILTER BAR */}
          <div className="p-2 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md flex flex-col lg:flex-row lg:flex-wrap lg:items-center justify-between gap-1.5 sm:gap-3 overflow-hidden">
            {/* Left: Title & Subtitle */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-xs shrink-0">
                <Calendar size={16} className="sm:w-[22px] sm:h-[22px]" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xs sm:text-lg font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2 truncate">
                  <span className="truncate">
                    {isThai
                      ? "รายงานประจำเดือน (Monthly Cumulative Report)"
                      : "Monthly Cumulative Production & Material Report"}
                  </span>
                </h2>
                <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {isThai
                    ? "สรุปยอดสะสมการรับเข้าวัตถุดิบและเบิกจ่ายหน้าเครื่องรายวัน รายเครื่องจักร และสัดส่วนรวมตลอดทั้งเดือน"
                    : "Monthly Cumulative Inbound, Machine Dispensing & Daily Trend Summary"}
                </p>
              </div>
            </div>

            {/* Right: Monthly Filter Controls (Month/Year, Shift Filter, Export Excel, Print) */}
            <div className="flex items-center justify-between sm:justify-start lg:justify-end gap-1 sm:gap-2 flex-nowrap sm:flex-wrap w-full lg:w-auto max-w-full shrink-0">
              {/* 1. Month/Year Selector */}
              <div className="px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs shrink-0">
                <div className="flex items-center gap-1 shrink-0">
                  <Calendar size={11} className="text-cyan-500 shrink-0 w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline font-bold text-slate-700 dark:text-slate-300 text-[11px] shrink-0">
                    {isThai ? "เดือน/ปี:" : "Month:"}
                  </span>
                </div>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setMonthlyLedgerPage(1);
                  }}
                  className="w-[102px] sm:w-auto px-1 sm:px-2 py-0.5 sm:py-1 rounded sm:rounded-lg text-[10px] sm:text-xs font-mono font-bold bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer shadow-xs"
                />
              </div>

              {/* 2. Shift Filter Selector (All / Day / Night) */}
              <div className="px-1 sm:px-2.5 py-0.5 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs flex-1 sm:flex-initial min-w-0 justify-center shrink-0">
                <Clock size={13} className="text-amber-500 shrink-0 hidden sm:block sm:w-3.5 sm:h-3.5" />
                <div className="flex sm:inline-flex w-full sm:w-auto rounded sm:rounded-lg p-0.5 bg-slate-200/80 dark:bg-[#122342] border border-slate-300 dark:border-[#1e3a5f] gap-0.5">
                  <button
                    type="button"
                    onClick={() => setMonthlyShiftFilter("all")}
                    className={`flex-1 sm:flex-initial px-1.5 sm:px-2 py-0.5 sm:py-1 rounded sm:rounded-md text-[9.5px] sm:text-[11px] font-bold tracking-tight sm:tracking-normal transition-all flex items-center justify-center gap-0.5 sm:gap-1 cursor-pointer whitespace-nowrap ${
                      monthlyShiftFilter === "all"
                        ? "bg-cyan-600 text-white shadow-xs font-extrabold"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <Layers size={10} className="shrink-0 w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    <span>{isThai ? "รวมทุกกะ" : "All Shifts"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMonthlyShiftFilter("day")}
                    className={`flex-1 sm:flex-initial px-1.5 sm:px-2 py-0.5 sm:py-1 rounded sm:rounded-md text-[9.5px] sm:text-[11px] font-bold tracking-tight sm:tracking-normal transition-all flex items-center justify-center gap-0.5 sm:gap-1 cursor-pointer whitespace-nowrap ${
                      monthlyShiftFilter === "day"
                        ? "bg-amber-500 text-white shadow-xs font-extrabold"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <Sun size={10} className="shrink-0 w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    <span>{isThai ? "กะเช้า" : "Day"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMonthlyShiftFilter("night")}
                    className={`flex-1 sm:flex-initial px-1.5 sm:px-2 py-0.5 sm:py-1 rounded sm:rounded-md text-[9.5px] sm:text-[11px] font-bold tracking-tight sm:tracking-normal transition-all flex items-center justify-center gap-0.5 sm:gap-1 cursor-pointer whitespace-nowrap ${
                      monthlyShiftFilter === "night"
                        ? "bg-indigo-600 text-white shadow-xs font-extrabold"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <Moon size={10} className="shrink-0 w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    <span>{isThai ? "กะดึก" : "Night"}</span>
                  </button>
                </div>
              </div>

              {/* 3. Export Monthly Excel */}
              <button
                type="button"
                onClick={exportMonthlyToExcel}
                className="hidden sm:flex px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs items-center gap-1.5 transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet size={14} className="shrink-0" />
                <span>{isThai ? "ส่งออก Excel" : "Export Excel"}</span>
              </button>

              {/* 4. Print Report */}
              <button
                type="button"
                onClick={() => window.print()}
                className="hidden sm:flex px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-[#182a4a] hover:bg-slate-200 dark:hover:bg-[#20375e] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#1e3a5f] shadow-xs items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <Printer size={14} className="shrink-0" />
                <span>{isThai ? "พิมพ์" : "Print"}</span>
              </button>
            </div>
          </div>

          {/* MONTHLY KPI SUMMARY CARDS */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            {/* Monthly KPI 1: Cumulative Inbound */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "ยอดรับเข้าสะสมทั้งเดือน (MTD)" : "Monthly Inbound Total"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-cyan-500/10 text-cyan-500 shrink-0">
                  <TrendingUp size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                  {monthlyAnalytics.totalInboundKg.toLocaleString()}
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500">kg</span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-cyan-600 dark:text-cyan-400 font-bold font-mono tabular-nums truncate">
                = {(monthlyAnalytics.totalInboundKg / 1000).toFixed(3)} TON ({monthlyAnalytics.totalInboundCoils}{" "}
                {isThai ? "ม้วน" : "coils"})
              </div>
            </div>

            {/* Monthly KPI 2: Cumulative Dispensed */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "ยอดเบิกจ่ายสะสมทั้งเดือน (MTD)" : "Monthly Dispensed Total"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
                  <TrendingDown size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                  {monthlyAnalytics.totalOutboundKg.toLocaleString()}
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500">kg</span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 font-bold font-mono tabular-nums truncate">
                = {(monthlyAnalytics.totalOutboundKg / 1000).toFixed(3)} TON ({monthlyAnalytics.totalOutboundCoils}{" "}
                {isThai ? "ม้วน" : "coils"})
              </div>
            </div>

            {/* Monthly KPI 3: Net Balance Delta */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "ดุลสะสมสุทธิรายเดือน" : "Monthly Net Movement Delta"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
                  <ArrowRightLeft size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span
                  className={`text-base sm:text-2xl font-black font-mono tabular-nums ${
                    monthlyAnalytics.totalInboundKg - monthlyAnalytics.totalOutboundKg >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {(monthlyAnalytics.totalInboundKg - monthlyAnalytics.totalOutboundKg >= 0 ? "+" : "") +
                    (monthlyAnalytics.totalInboundKg - monthlyAnalytics.totalOutboundKg).toLocaleString()}
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500">kg</span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-slate-500 font-mono font-medium truncate">
                {isThai ? "ผลต่างรับเข้าสะสม vs เบิกจ่ายสะสม" : "Cumulative Inbound vs Outbound"}
              </div>
            </div>

            {/* Monthly KPI 4: Active Operational Days & Machines */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md relative overflow-hidden">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "วันที่มีธุรกรรม / เครื่องจักร" : "Active Days & Machines"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
                  <Cpu size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                  {monthlyAnalytics.activeDaysCount}
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500">
                  / {monthlyAnalytics.daysInMonth} {isThai ? "วัน" : "days"}
                </span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-purple-600 dark:text-purple-400 font-bold truncate">
                {isThai
                  ? `เครื่องจักรที่เดินงาน ${monthlyAnalytics.activeMachinesCount} เครื่อง`
                  : `${monthlyAnalytics.activeMachinesCount} Active Machines`}
              </div>
            </div>
          </div>

          {/* CHART M1: Daily Inbound vs Outbound Trend (Days 1 to End of Month) */}
          <div className="p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Activity size={16} className="text-cyan-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                  {isThai
                    ? `1. กราฟแนวโน้มรับเข้า-จ่ายออกรายวัน ตลอดทั้งเดือน (วันที่ 1 - ${monthlyAnalytics.daysInMonth})`
                    : `1. Daily Inbound vs Outbound Trend (Day 1 - ${monthlyAnalytics.daysInMonth})`}
                </h3>
              </div>

              <div className="flex items-center gap-3 sm:gap-4 text-[10.5px] sm:text-xs font-bold">
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-xs bg-sky-500 inline-block" />
                  <span>{isThai ? "รับเข้าคลัง (Inbound)" : "Inbound"}</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-xs bg-amber-500 inline-block" />
                  <span>{isThai ? "เบิกจ่ายหน้าเครื่อง (Outbound)" : "Outbound"}</span>
                </div>
              </div>
            </div>

            <div className="h-52 sm:h-64 w-full pt-2 overflow-x-auto">
              <div className="min-w-[680px] sm:min-w-[760px] h-full">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 920 220" preserveAspectRatio="none">
                  {/* Horizontal Grid Lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                    const y = 180 - ratio * 150;
                    const val = Math.round(monthlyAnalytics.maxDailyBarKg * ratio);
                    return (
                      <g key={idx}>
                        <line
                          x1="48"
                          y1={y}
                          x2="905"
                          y2={y}
                          stroke="rgba(148, 163, 184, 0.15)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x="42"
                          y={y + 4}
                          textAnchor="end"
                          fontSize="9"
                          fill="#94a3b8"
                          className="font-mono"
                        >
                          {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Daily Grouped Bars (1..daysInMonth) */}
                  {monthlyAnalytics.dailySeries.map((d, idx) => {
                    const groupWidth = 850 / monthlyAnalytics.daysInMonth;
                    const xCenter = 55 + idx * groupWidth + groupWidth / 2;
                    const barWidth = Math.max(4, Math.min(10, groupWidth * 0.36));

                    const inH = (d.inboundTotalKg / monthlyAnalytics.maxDailyBarKg) * 150;
                    const outH = (d.outboundTotalKg / monthlyAnalytics.maxDailyBarKg) * 150;

                    const xIn = xCenter - barWidth - 1;
                    const yIn = 180 - inH;
                    const xOut = xCenter + 1;
                    const yOut = 180 - outH;

                    return (
                      <g key={d.dateStr} className="group cursor-pointer">
                        <title>
                          {`${d.dateStr}\nรับเข้า: ${d.inboundTotalKg.toLocaleString()} kg (${d.inboundCoils} ม้วน)\nเบิกจ่าย: ${d.outboundTotalKg.toLocaleString()} kg (${d.outboundCoils} ม้วน)\nสะสมรับเข้า (MTD): ${d.cumulativeInboundKg.toLocaleString()} kg\nสะสมเบิกจ่าย (MTD): ${d.cumulativeOutboundKg.toLocaleString()} kg`}
                        </title>

                        {/* Inbound Bar */}
                        <rect
                          x={xIn}
                          y={yIn}
                          width={barWidth}
                          height={Math.max(2, inH)}
                          rx="2"
                          fill="#0284c7"
                          className="transition-all duration-200 group-hover:opacity-80"
                        />

                        {/* Outbound Bar */}
                        <rect
                          x={xOut}
                          y={yOut}
                          width={barWidth}
                          height={Math.max(2, outH)}
                          rx="2"
                          fill="#f59e0b"
                          className="transition-all duration-200 group-hover:opacity-80"
                        />

                        {/* Value label above active bars */}
                        {(d.inboundTotalKg > 0 || d.outboundTotalKg > 0) && (
                          <text
                            x={xCenter}
                            y={Math.min(yIn, yOut) - 5}
                            textAnchor="middle"
                            fontSize="8"
                            fontWeight="bold"
                            fill="#38bdf8"
                            className="font-mono"
                          >
                            {((d.inboundTotalKg + d.outboundTotalKg) / 1000).toFixed(1)}T
                          </text>
                        )}

                        {/* Day Number Label */}
                        <text
                          x={xCenter}
                          y="198"
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight={d.hasActivity ? "bold" : "normal"}
                          fill={d.hasActivity ? "#38bdf8" : "#64748b"}
                          className="font-mono"
                        >
                          {String(d.dayNumber).padStart(2, "0")}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>

          {/* ROW 2: Monthly Machine Cumulative Charts & Monthly Inbound-Outbound Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
            {/* Chart M2: Monthly SM Machine Inbound Cumulative */}
            <div className="p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-4">
              <div className="flex items-center justify-between border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <BarChart3 size={16} className="text-cyan-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
                  <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                    {isThai
                      ? "2. ยอดสะสมรับเข้าแยกตามเครื่องจักร (SM)"
                      : "2. Monthly Cumulative Inbound by Machine"}
                  </h3>
                </div>
              </div>

              <div className="h-44 sm:h-52 w-full pt-2">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 420 190" preserveAspectRatio="none">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                    const y = 150 - ratio * 120;
                    const val = Math.round(monthlyAnalytics.maxSmMonthlyKg * ratio);
                    return (
                      <g key={idx}>
                        <line
                          x1="42"
                          y1={y}
                          x2="405"
                          y2={y}
                          stroke="rgba(148, 163, 184, 0.15)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x="36"
                          y={y + 4}
                          textAnchor="end"
                          fontSize="9"
                          fill="#94a3b8"
                          className="font-mono"
                        >
                          {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                        </text>
                      </g>
                    );
                  })}

                  {monthlyAnalytics.smMachineList.map((d, idx) => {
                    const groupWidth = 355 / (monthlyAnalytics.smMachineList.length || 1);
                    const xCenter = 48 + idx * groupWidth + groupWidth / 2;
                    const barWidth = Math.min(30, groupWidth * 0.55);
                    const barHeight = (d.totalKg / monthlyAnalytics.maxSmMonthlyKg) * 120;
                    const xBar = xCenter - barWidth / 2;
                    const yBar = 150 - barHeight;

                    return (
                      <g key={d.machine}>
                        <rect
                          x={xBar}
                          y={yBar}
                          width={barWidth}
                          height={Math.max(3, barHeight)}
                          rx="4"
                          fill="#0284c7"
                        />
                        {d.totalKg > 0 && (
                          <text
                            x={xCenter}
                            y={yBar - 6}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight="bold"
                            fill="#0284c7"
                            className="font-mono"
                          >
                            {(d.totalKg / 1000).toFixed(1)}T
                          </text>
                        )}
                        <text
                          x={xCenter}
                          y="172"
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="bold"
                          fill="#64748b"
                          className="font-mono"
                        >
                          {d.machine}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="space-y-1 sm:space-y-1.5 pt-1 border-t border-slate-200 dark:border-[#1e3a5f]">
                {monthlyAnalytics.smMachineList.map((m) => (
                  <div
                    key={m.machine}
                    className="flex items-center justify-between text-[11px] sm:text-xs font-mono py-1 px-2 rounded-lg bg-slate-50 dark:bg-[#0c1930]"
                  >
                    <span className="font-bold text-cyan-600 dark:text-cyan-400">{m.machine}</span>
                    <span className="text-slate-700 dark:text-slate-300 font-bold tabular-nums">
                      {m.totalKg.toLocaleString()} kg ({m.coils} {isThai ? "ม้วน" : "coils"})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chart M3: Monthly Production Machine Dispensing Cumulative */}
            <div className="p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-4">
              <div className="flex items-center justify-between border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <BarChart3 size={16} className="text-amber-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
                  <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                    {isThai
                      ? "3. ยอดสะสมเบิกจ่ายแยกตามเครื่องจักรผลิต"
                      : "3. Monthly Cumulative Dispensing by Machine"}
                  </h3>
                </div>
              </div>

              <div className="h-44 sm:h-52 w-full pt-2">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 420 190" preserveAspectRatio="none">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                    const y = 150 - ratio * 120;
                    const val = Math.round(monthlyAnalytics.maxDispensingMonthlyKg * ratio);
                    return (
                      <g key={idx}>
                        <line
                          x1="42"
                          y1={y}
                          x2="405"
                          y2={y}
                          stroke="rgba(148, 163, 184, 0.15)"
                          strokeDasharray="3 3"
                        />
                        <text
                          x="36"
                          y={y + 4}
                          textAnchor="end"
                          fontSize="9"
                          fill="#94a3b8"
                          className="font-mono"
                        >
                          {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                        </text>
                      </g>
                    );
                  })}

                  {monthlyAnalytics.dispensingMachineList.map((d, idx) => {
                    const groupWidth = 355 / (monthlyAnalytics.dispensingMachineList.length || 1);
                    const xCenter = 48 + idx * groupWidth + groupWidth / 2;
                    const barWidth = Math.min(30, groupWidth * 0.55);
                    const barHeight = (d.totalKg / monthlyAnalytics.maxDispensingMonthlyKg) * 120;
                    const xBar = xCenter - barWidth / 2;
                    const yBar = 150 - barHeight;

                    return (
                      <g key={d.machine}>
                        <rect
                          x={xBar}
                          y={yBar}
                          width={barWidth}
                          height={Math.max(3, barHeight)}
                          rx="4"
                          fill="#f59e0b"
                        />
                        {d.totalKg > 0 && (
                          <text
                            x={xCenter}
                            y={yBar - 6}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight="bold"
                            fill="#f59e0b"
                            className="font-mono"
                          >
                            {(d.totalKg / 1000).toFixed(1)}T
                          </text>
                        )}
                        <text
                          x={xCenter}
                          y="172"
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="bold"
                          fill="#64748b"
                          className="font-mono"
                        >
                          {d.machine}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="space-y-1 sm:space-y-1.5 pt-1 border-t border-slate-200 dark:border-[#1e3a5f]">
                {monthlyAnalytics.dispensingMachineList.map((m) => (
                  <div
                    key={m.machine}
                    className="flex items-center justify-between text-[11px] sm:text-xs font-mono py-1 px-2 rounded-lg bg-slate-50 dark:bg-[#0c1930]"
                  >
                    <span className="font-bold text-amber-600 dark:text-amber-400">{m.machine}</span>
                    <span className="text-slate-700 dark:text-slate-300 font-bold tabular-nums">
                      {m.totalKg.toLocaleString()} kg ({m.coils} {isThai ? "ม้วน" : "coils"})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chart M4: Monthly Inbound-Outbound Distribution Donut */}
            <div className="p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md space-y-2.5 sm:space-y-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2 border-b pb-2 sm:pb-3 border-slate-200 dark:border-[#1e3a5f]">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <PieChartIcon size={16} className="text-purple-500 shrink-0 sm:w-[18px] sm:h-[18px]" />
                  <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white truncate">
                    {isThai
                      ? "4. สัดส่วนการรับเข้า-จ่ายออกรวมทั้งเดือน"
                      : "4. Monthly Inbound-Outbound Distribution"}
                  </h3>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-xl bg-cyan-50/70 dark:bg-[#0c1930] border border-cyan-200/80 dark:border-cyan-900/50">
                  <div className="text-[10px] font-bold text-cyan-700 dark:text-cyan-400 flex items-center justify-between">
                    <span>{isThai ? "รับเข้าสะสม" : "Inbound"}</span>
                    <span className="font-mono">{monthlyAnalytics.inboundPercent}%</span>
                  </div>
                  <div className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5 tabular-nums">
                    {monthlyAnalytics.totalInboundKg.toLocaleString()}{" "}
                    <span className="text-[10px] font-normal text-slate-500">kg</span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {(monthlyAnalytics.totalInboundKg / 1000).toFixed(2)} TON ({monthlyAnalytics.totalInboundCoils}{" "}
                    {isThai ? "ม้วน" : "coils"})
                  </div>
                </div>

                <div className="p-2 rounded-xl bg-amber-50/70 dark:bg-[#0c1930] border border-amber-200/80 dark:border-amber-900/50">
                  <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 flex items-center justify-between">
                    <span>{isThai ? "จ่ายออกสะสม" : "Outbound"}</span>
                    <span className="font-mono">{monthlyAnalytics.outboundPercent}%</span>
                  </div>
                  <div className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5 tabular-nums">
                    {monthlyAnalytics.totalOutboundKg.toLocaleString()}{" "}
                    <span className="text-[10px] font-normal text-slate-500">kg</span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {(monthlyAnalytics.totalOutboundKg / 1000).toFixed(2)} TON ({monthlyAnalytics.totalOutboundCoils}{" "}
                    {isThai ? "ม้วน" : "coils"})
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center my-auto space-y-2.5 sm:space-y-3">
                <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    {monthlyAnalytics.grandTotalKg === 0 && monthlyAnalytics.grandTotalCoils === 0 ? (
                      <circle
                        cx="50"
                        cy="50"
                        r="38"
                        fill="transparent"
                        stroke="rgba(148, 163, 184, 0.2)"
                        strokeWidth="18"
                      />
                    ) : (
                      (() => {
                        let accumulatedPercent = 0;
                        return monthlyAnalytics.monthlyDistribution.map((item) => {
                          const strokeDasharray = `${item.percentage} ${100 - item.percentage}`;
                          const strokeDashoffset = -accumulatedPercent;
                          accumulatedPercent += item.percentage;
                          return (
                            <circle
                              key={item.key}
                              cx="50"
                              cy="50"
                              r="38"
                              fill="transparent"
                              stroke={item.color}
                              strokeWidth="18"
                              strokeDasharray={strokeDasharray}
                              strokeDashoffset={strokeDashoffset}
                              pathLength="100"
                              className="transition-all duration-500 hover:opacity-80 cursor-pointer"
                            />
                          );
                        });
                      })()
                    )}
                  </svg>

                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">
                      {isThai ? "ยอดรวมทั้งเดือน" : "Monthly Total"}
                    </span>
                    <span className="text-xs sm:text-sm font-black font-mono text-slate-900 dark:text-white leading-tight mt-0.5">
                      {(monthlyAnalytics.grandTotalKg / 1000).toFixed(1)} T
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 mt-0.5">
                      ({monthlyAnalytics.grandTotalCoils} {isThai ? "ม้วน" : "coils"})
                    </span>
                  </div>
                </div>

                <div className="w-full space-y-1.5">
                  {monthlyAnalytics.monthlyDistribution.map((item) => (
                    <div
                      key={item.key}
                      className="p-2 rounded-xl bg-slate-50/90 dark:bg-[#0c1930] border border-slate-200/80 dark:border-[#1e3a5f] text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-extrabold text-slate-800 dark:text-slate-100 text-[11px] sm:text-xs">
                            {isThai ? item.labelTh : item.labelEn}
                          </span>
                        </div>
                        <span className="font-mono font-black text-slate-800 dark:text-slate-200 text-[11px] sm:text-xs">
                          {item.percentage}%
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono pl-4 pt-0.5 border-t border-slate-200/60 dark:border-[#1e3a5f]/60 text-slate-500 dark:text-slate-400">
                        <span className="flex items-center justify-between pr-1">
                          <span className="text-amber-600 dark:text-amber-400 font-sans font-semibold">
                            {isThai ? "กะเช้า:" : "Day:"}
                          </span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                            {item.dayKg.toLocaleString()} kg ({item.dayCoils})
                          </span>
                        </span>
                        <span className="flex items-center justify-between pl-1 border-l border-slate-200 dark:border-[#1e3a5f]">
                          <span className="text-indigo-600 dark:text-indigo-400 font-sans font-semibold">
                            {isThai ? "กะดึก:" : "Night:"}
                          </span>
                          <span className="font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                            {item.nightKg.toLocaleString()} kg ({item.nightCoils})
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* MONTHLY CUMULATIVE DAILY LEDGER TABLE (MTD) */}
          <section className="rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md overflow-hidden">
            <div className="p-2.5 sm:p-5 bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
                  <Layers size={16} className="sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>
                      {isThai
                        ? `ตารางสรุปยอดสะสมรายวันประจำเดือน ${selectedMonth} (Daily Cumulative MTD)`
                        : `Monthly Daily Cumulative Ledger (${selectedMonth})`}
                    </span>
                  </h3>
                  <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {isThai
                      ? "แสดงข้อมูลการรับเข้าและเบิกจ่ายสะสมรายวัน แยกกะเช้า-กะดึก พร้อมยอดสะสมต่อเนื่อง (Running Total MTD)"
                      : "Daily inbound and dispensing breakdown by shift with Month-to-Date running totals"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <div className="flex items-center gap-1 sm:gap-1.5 text-[10.5px] sm:text-xs bg-white dark:bg-[#111e38] px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl border border-slate-300 dark:border-[#1e3a5f]">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">
                    {isThai ? "แสดงหน้าละ:" : "Rows:"}
                  </span>
                  <select
                    value={monthlyLedgerPageSize}
                    onChange={(e) => {
                      setMonthlyLedgerPageSize(Number(e.target.value));
                      setMonthlyLedgerPage(1);
                    }}
                    className="bg-transparent font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer"
                  >
                    <option value={7} className="bg-white dark:bg-[#111e38]">
                      7 {isThai ? "วัน" : "days"}
                    </option>
                    <option value={10} className="bg-white dark:bg-[#111e38]">
                      10 {isThai ? "วัน" : "days"}
                    </option>
                    <option value={15} className="bg-white dark:bg-[#111e38]">
                      15 {isThai ? "วัน" : "days"}
                    </option>
                    <option value={31} className="bg-white dark:bg-[#111e38]">
                      31 {isThai ? "วัน" : "days"}
                    </option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowOnlyActiveDays((prev) => !prev);
                    setMonthlyLedgerPage(1);
                  }}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl text-[10.5px] sm:text-xs font-bold border transition-all cursor-pointer whitespace-nowrap ${
                    showOnlyActiveDays
                      ? "bg-cyan-600 text-white border-cyan-600"
                      : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f]"
                  }`}
                >
                  {showOnlyActiveDays
                    ? isThai
                      ? "แสดงครบทุกวันในเดือน (1-31)"
                      : "Show All Days"
                    : isThai
                    ? "แสดงเฉพาะวันที่มีรายการ"
                    : "Active Days Only"}
                </button>
              </div>
            </div>

            {(() => {
              const filteredRows = showOnlyActiveDays
                ? monthlyAnalytics.dailySeries.filter((d) => d.hasActivity)
                : monthlyAnalytics.dailySeries;

              const totalRows = filteredRows.length;
              const totalPages = Math.max(1, Math.ceil(totalRows / monthlyLedgerPageSize));
              const safeCurrentPage = Math.min(Math.max(1, monthlyLedgerPage), totalPages);
              const startIndex = (safeCurrentPage - 1) * monthlyLedgerPageSize;
              const paginatedRows = filteredRows.slice(
                startIndex,
                startIndex + monthlyLedgerPageSize
              );

              return (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[10.5px] sm:text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#1e3a5f] whitespace-nowrap">
                          <th className="!p-1.5 sm:!p-3 !text-left">{isThai ? "วันที่" : "Date"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "รับเข้า กะเช้า (kg)" : "Inbound Day"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "รับเข้า กะดึก (kg)" : "Inbound Night"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-right !text-cyan-600 dark:!text-cyan-400">
                            {isThai ? "รวมรับเข้าวันนั้น (kg)" : "Daily Inbound"}
                          </th>
                          <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "เบิกจ่าย กะเช้า (kg)" : "Disp. Day"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "เบิกจ่าย กะดึก (kg)" : "Disp. Night"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-right !text-amber-600 dark:!text-amber-400">
                            {isThai ? "รวมเบิกจ่ายวันนั้น (kg)" : "Daily Dispensed"}
                          </th>
                          <th className="!p-1.5 sm:!p-3 !text-right bg-cyan-50/50 dark:bg-cyan-950/20">
                            {isThai ? "สะสมรับเข้า MTD (kg)" : "Cum. Inbound (MTD)"}
                          </th>
                          <th className="!p-1.5 sm:!p-3 !text-right bg-amber-50/50 dark:bg-amber-950/20">
                            {isThai ? "สะสมเบิกจ่าย MTD (kg)" : "Cum. Outbound (MTD)"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                        {paginatedRows.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="!p-5 sm:!p-8 !text-center text-slate-400 text-[11px] sm:text-xs font-medium">
                              {isThai
                                ? `ยังไม่มีรายการเคลื่อนไหวในเดือน ${selectedMonth}`
                                : `No activity found for ${selectedMonth}`}
                            </td>
                          </tr>
                        ) : (
                          paginatedRows.map((d) => (
                            <tr
                              key={d.dateStr}
                              className={`transition-colors whitespace-nowrap ${
                                d.hasActivity
                                  ? "hover:bg-cyan-50/40 dark:hover:bg-cyan-950/20"
                                  : "opacity-60 hover:opacity-100"
                              }`}
                            >
                              <td className="!p-1.5 sm:!p-3 !text-left font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {d.dateStr}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {d.inboundDayKg.toLocaleString()}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {d.inboundNightKg.toLocaleString()}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-cyan-600 dark:text-cyan-400">
                                {d.inboundTotalKg.toLocaleString()} ({d.inboundCoils})
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {d.outboundDayKg.toLocaleString()}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {d.outboundNightKg.toLocaleString()}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-amber-600 dark:text-amber-400">
                                {d.outboundTotalKg.toLocaleString()} ({d.outboundCoils})
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-bold bg-cyan-50/30 dark:bg-cyan-950/10 text-slate-900 dark:text-white">
                                {d.cumulativeInboundKg.toLocaleString()}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-bold bg-amber-50/30 dark:bg-amber-950/10 text-slate-900 dark:text-white">
                                {d.cumulativeOutboundKg.toLocaleString()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot className="bg-slate-100 dark:bg-[#0c1930] font-bold border-t-2 border-slate-300 dark:border-[#1e3a5f] whitespace-nowrap">
                        <tr>
                          <td className="!p-1.5 sm:!p-3 !text-left uppercase tracking-wider text-slate-700 dark:text-slate-200">
                            {isThai ? "ยอดรวมทั้งเดือน (Total)" : "Monthly Total"}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {monthlyAnalytics.inboundDayKgTotal.toLocaleString()}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {monthlyAnalytics.inboundNightKgTotal.toLocaleString()}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-cyan-600 dark:text-cyan-400">
                            {monthlyAnalytics.totalInboundKg.toLocaleString()} kg ({monthlyAnalytics.totalInboundCoils})
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {monthlyAnalytics.outboundDayKgTotal.toLocaleString()}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {monthlyAnalytics.outboundNightKgTotal.toLocaleString()}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-amber-600 dark:text-amber-400">
                            {monthlyAnalytics.totalOutboundKg.toLocaleString()} kg ({monthlyAnalytics.totalOutboundCoils})
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-cyan-700 dark:text-cyan-300">
                            {(monthlyAnalytics.totalInboundKg / 1000).toFixed(3)} TON
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-amber-700 dark:text-amber-300">
                            {(monthlyAnalytics.totalOutboundKg / 1000).toFixed(3)} TON
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Pagination Footer Bar */}
                  <div className="px-2.5 sm:px-4 py-2 sm:py-3 bg-slate-50 dark:bg-[#0d1b33] border-t border-slate-200 dark:border-[#1e3a5f] flex flex-row items-center justify-between gap-1.5 sm:gap-3 text-[10.5px] sm:text-xs">
                    <div className="text-slate-600 dark:text-slate-400 font-medium font-mono truncate">
                      {totalRows === 0 ? (
                        isThai ? "ไม่มีข้อมูลแสดงผล" : "Showing 0 of 0 days"
                      ) : (
                        <>
                          <span className="sm:hidden">
                            {`${startIndex + 1}-${Math.min(startIndex + monthlyLedgerPageSize, totalRows)} / ${totalRows} วัน (${safeCurrentPage}/${totalPages})`}
                          </span>
                          <span className="hidden sm:inline">
                            {isThai
                              ? `แสดงวันที่ลำดับ ${startIndex + 1} - ${Math.min(
                                  startIndex + monthlyLedgerPageSize,
                                  totalRows
                                )} จากทั้งหมด ${totalRows} วัน (หน้า ${safeCurrentPage}/${totalPages})`
                              : `Showing ${startIndex + 1} - ${Math.min(
                                  startIndex + monthlyLedgerPageSize,
                                  totalRows
                                )} of ${totalRows} days (Page ${safeCurrentPage}/${totalPages})`}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={safeCurrentPage <= 1}
                        onClick={() => setMonthlyLedgerPage((p) => Math.max(1, p - 1))}
                        className="px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#182a4a] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 sm:gap-1 transition-all cursor-pointer whitespace-nowrap"
                      >
                        <ChevronLeft size={13} className="sm:w-3.5 sm:h-3.5" />
                        <span className="hidden sm:inline">{isThai ? "ก่อนหน้า" : "Prev"}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                          <button
                            key={pageNum}
                            type="button"
                            onClick={() => setMonthlyLedgerPage(pageNum)}
                            className={`w-6 h-6 sm:w-7 sm:h-7 rounded-md sm:rounded-lg font-mono font-bold text-[10.5px] sm:text-xs transition-all cursor-pointer ${
                              pageNum === safeCurrentPage
                                ? "bg-cyan-600 text-white shadow-xs"
                                : "bg-white dark:bg-[#111e38] text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#182a4a]"
                            }`}
                          >
                            {pageNum}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={safeCurrentPage >= totalPages}
                        onClick={() => setMonthlyLedgerPage((p) => Math.min(totalPages, p + 1))}
                        className="px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-md sm:rounded-lg font-bold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#182a4a] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 sm:gap-1 transition-all cursor-pointer whitespace-nowrap"
                      >
                        <span className="hidden sm:inline">{isThai ? "ถัดไป (Next Page)" : "Next Page"}</span>
                        <ChevronRight size={13} className="sm:w-3.5 sm:h-3.5" />
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </section>
        </>
      ) : (
        /* =========================================================================
           STORAGE SPACE REPORT VIEW (Warehouse Baskets + Machine Staging Area)
           ========================================================================= */
        <>
          {/* HEADER & FILTER BAR FOR STORAGE SPACE REPORT */}
          <div className="px-1.5 py-2 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md flex flex-col lg:flex-row lg:flex-wrap lg:items-center justify-between gap-1.5 sm:gap-3 overflow-hidden">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 px-0.5 sm:px-0">
              <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-xs shrink-0">
                <Boxes size={16} className="sm:w-[22px] sm:h-[22px]" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xs sm:text-lg font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2 truncate">
                  <span className="sm:hidden truncate">
                    {isThai ? "รายงานพื้นที่จัดเก็บเหล็กสลิต" : "Slit Steel Storage Space Report"}
                  </span>
                  <span className="hidden sm:inline truncate">
                    {isThai
                      ? "รายงานพื้นที่จัดเก็บเหล็กสลิต (Slit Steel Storage Space Report)"
                      : "Slit Steel Storage Space Report"}
                  </span>
                </h2>
                <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {isThai
                    ? "สรุปสถานะคลังจัดเก็บตะกร้าเหล็กสลิต (อาคาร H, F, E9, E10, I) และพื้นที่วางวัตถุดิบรอผลิตหน้าเครื่องจักร (TM 1-14 / CF 1, 2, 4, 5)"
                    : "Comprehensive report for Warehouse Basket Storage by Building and Machine Staging Areas"}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-start lg:justify-end gap-1 sm:gap-2 flex-nowrap sm:flex-wrap w-full lg:w-auto max-w-full min-w-0 shrink-0">
              {/* Sub-view Switcher: All vs Warehouse vs Machine */}
              <div className="flex items-center justify-between sm:inline-flex w-full sm:w-auto min-w-0 rounded-md sm:rounded-xl p-0.5 sm:p-1 bg-slate-100 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] gap-0.5 sm:gap-0 shrink-0">
                <button
                  type="button"
                  onClick={() => setSpaceReportSubTab("all")}
                  className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-2.5 py-1 sm:py-1.5 rounded sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal leading-tight transition-all flex items-center justify-center cursor-pointer whitespace-nowrap text-center ${
                    spaceReportSubTab === "all"
                      ? "bg-cyan-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <span>{isThai ? "แสดงทั้งหมด" : "All Areas"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSpaceReportSubTab("warehouse")}
                  className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-2.5 py-1 sm:py-1.5 rounded sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal leading-tight transition-all flex items-center justify-center gap-0.5 sm:gap-1.5 cursor-pointer whitespace-nowrap ${
                    spaceReportSubTab === "warehouse"
                      ? "bg-cyan-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Building2 size={9} className="shrink-0 w-2.5 h-2.5 sm:w-[13px] sm:h-[13px]" />
                  <span>{isThai ? "คลังตะกร้าอาคาร" : "Warehouse Baskets"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSpaceReportSubTab("machine")}
                  className={`flex-1 sm:flex-initial min-w-0 px-1 sm:px-2.5 py-1 sm:py-1.5 rounded sm:rounded-lg text-[8.5px] sm:text-xs font-bold tracking-tighter sm:tracking-normal leading-tight transition-all flex items-center justify-center gap-0.5 sm:gap-1.5 cursor-pointer whitespace-nowrap ${
                    spaceReportSubTab === "machine"
                      ? "bg-cyan-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Cpu size={9} className="shrink-0 w-2.5 h-2.5 sm:w-[13px] sm:h-[13px]" />
                  <span>{isThai ? "พื้นที่หน้าเครื่อง" : "Machine Staging"}</span>
                </button>
              </div>

              {/* Export Excel */}
              <button
                type="button"
                onClick={exportSpaceReportToExcel}
                className="hidden sm:flex px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs items-center gap-1.5 transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet size={14} className="shrink-0" />
                <span>{isThai ? "ส่งออก Excel" : "Export Excel"}</span>
              </button>

              {/* Print */}
              <button
                type="button"
                onClick={() => window.print()}
                className="hidden sm:flex px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-[#182a4a] hover:bg-slate-200 dark:hover:bg-[#20375e] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#1e3a5f] shadow-xs items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <Printer size={14} className="shrink-0" />
                <span>{isThai ? "พิมพ์" : "Print"}</span>
              </button>
            </div>
          </div>

          {/* 4 TOP KPI CARDS FOR STORAGE SPACE REPORT */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            {/* KPI 1: Warehouse Baskets & Weight */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-cyan-500">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "คลังจัดเก็บตะกร้า (5 อาคาร)" : "Warehouse Baskets (5 Bldgs)"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-cyan-500/10 text-cyan-500 shrink-0">
                  <Building2 size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                  {storageSpaceAnalytics.warehouseTotals.totalWeightKg.toLocaleString()}
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500">kg</span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-cyan-600 dark:text-cyan-400 font-bold font-mono tabular-nums truncate">
                {storageSpaceAnalytics.warehouseTotals.totalCoils} {isThai ? "แถบ" : "coils"} ·{" "}
                {storageSpaceAnalytics.warehouseTotals.totalBaskets} {isThai ? "ตะกร้า" : "baskets"}
              </div>
            </div>

            {/* KPI 2: Warehouse Basket Occupancy */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-emerald-500">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "อัตราใช้ตะกร้าคลังอาคาร" : "Warehouse Basket Occupancy"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
                  <Boxes size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span className="text-base sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                  {storageSpaceAnalytics.warehouseOccupancyPercent}%
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 truncate">
                  ({storageSpaceAnalytics.warehouseTotals.occupiedBaskets + storageSpaceAnalytics.warehouseTotals.fullBaskets}/
                  {storageSpaceAnalytics.warehouseTotals.totalBaskets} {isThai ? "ตะกร้า" : "baskets"})
                </span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-slate-500 font-mono tabular-nums truncate">
                {isThai
                  ? `ว่าง ${storageSpaceAnalytics.warehouseTotals.availableBaskets} · ใช้งาน ${storageSpaceAnalytics.warehouseTotals.occupiedBaskets} · เต็ม ${storageSpaceAnalytics.warehouseTotals.fullBaskets}`
                  : `Avail ${storageSpaceAnalytics.warehouseTotals.availableBaskets} · Used ${storageSpaceAnalytics.warehouseTotals.occupiedBaskets} · Full ${storageSpaceAnalytics.warehouseTotals.fullBaskets}`}
              </div>
            </div>

            {/* KPI 3: Machine Staging Area (TM & CF) */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-amber-500">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "พื้นที่วางรอผลิตหน้าเครื่องจักร" : "Machine Staging Racks"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
                  <Cpu size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span className="text-base sm:text-2xl font-black text-slate-900 dark:text-white font-mono tabular-nums">
                  {storageSpaceAnalytics.machineTotals.totalUsedMeters}
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 truncate">
                  / {storageSpaceAnalytics.machineTotals.totalCapacityMeters} {isThai ? "เมตร" : "m"}
                </span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 font-bold font-mono tabular-nums truncate">
                {storageSpaceAnalytics.machineTotals.totalCoils} {isThai ? "แถบ" : "coils"} (
                {storageSpaceAnalytics.machineTotals.totalWeightKg.toLocaleString()} kg)
              </div>
            </div>

            {/* KPI 4: Machine Staging Utilization */}
            <div className="p-2.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md border-l-4 border-l-purple-500">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate">
                  {isThai ? "อัตราใช้พื้นที่แคร่หน้าเครื่อง" : "Machine Rack Utilization"}
                </span>
                <div className="p-1 sm:p-2 rounded-md sm:rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
                  <BarChart3 size={14} className="sm:w-[18px] sm:h-[18px]" />
                </div>
              </div>
              <div className="mt-1 sm:mt-2 flex items-baseline gap-1 sm:gap-2">
                <span className="text-base sm:text-2xl font-black text-purple-600 dark:text-purple-400 font-mono tabular-nums">
                  {storageSpaceAnalytics.machineUtilizationPercent}%
                </span>
                <span className="text-[10px] sm:text-xs font-bold text-slate-500 truncate">
                  ({storageSpaceAnalytics.machineTotals.activeMachines}/{storageSpaceAnalytics.machineTotals.totalMachines}{" "}
                  {isThai ? "เครื่อง" : "machines"})
                </span>
              </div>
              <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-slate-500 font-mono tabular-nums truncate">
                {isThai
                  ? `แคร่ว่าง ${storageSpaceAnalytics.machineTotals.availableRacks} · ใช้งาน ${storageSpaceAnalytics.machineTotals.occupiedRacks} · เต็ม ${storageSpaceAnalytics.machineTotals.fullRacks}`
                  : `Avail ${storageSpaceAnalytics.machineTotals.availableRacks} · Used ${storageSpaceAnalytics.machineTotals.occupiedRacks} · Full ${storageSpaceAnalytics.machineTotals.fullRacks}`}
              </div>
            </div>
          </div>

          {/* =========================================================================
              PART 1: คลังจัดเก็บตะกร้าเหล็กสลิต อาคาร (อาคาร H, F, E9, E10, I)
              ========================================================================= */}
          {(spaceReportSubTab === "all" || spaceReportSubTab === "warehouse") && (
            <div className="space-y-3 sm:space-y-6">
              {/* Building Summary Table & Chart */}
              <section className="rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md overflow-hidden">
                <div className="p-2.5 sm:p-5 bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
                      <Building2 size={16} className="sm:w-5 sm:h-5" />
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>
                          {isThai
                            ? "ส่วนที่ 1: รายงานคลังจัดเก็บตะกร้าเหล็กสลิต แยกตามอาคาร (อาคาร H, F, E9, E10, I)"
                            : "Part 1: Warehouse Basket Storage Report by Building (H, F, E9, E10, I)"}
                        </span>
                      </h3>
                      <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {isThai
                          ? "สรุปจำนวนตะกร้า แถบเหล็กสลิต น้ำหนักรวม และอัตราการใช้พื้นที่ของแต่ละอาคารคลังสินค้า"
                          : "Summary of storage baskets, coils, net weight and occupancy rate by warehouse building"}
                      </p>
                    </div>
                  </div>

                  <div className="text-left sm:text-right font-mono text-[11px] sm:text-xs font-bold text-cyan-600 dark:text-cyan-400 tabular-nums">
                    {isThai ? "น้ำหนักรวมทุกอาคาร: " : "Total Building Weight: "}
                    <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-white">
                      {storageSpaceAnalytics.warehouseTotals.totalWeightKg.toLocaleString()} kg
                    </span>{" "}
                    ({(storageSpaceAnalytics.warehouseTotals.totalWeightKg / 1000).toFixed(3)} TON)
                  </div>
                </div>

                {/* Building Summary Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[10.5px] sm:text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#1e3a5f] whitespace-nowrap">
                        <th className="!p-1.5 sm:!p-3 !text-left">{isThai ? "อาคาร" : "Building"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "จำนวนแถว" : "Rows"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "ตะกร้าทั้งหมด" : "Total Baskets"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-center !text-emerald-600 dark:!text-emerald-400">{isThai ? "ว่าง" : "Avail"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-center !text-amber-600 dark:!text-amber-400">{isThai ? "ใช้งาน" : "Occupied"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-center !text-rose-600 dark:!text-rose-400">{isThai ? "เต็ม" : "Full"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-center !text-slate-500">{isThai ? "ซ่อมบำรุง" : "Maint."}</th>
                        <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "จำนวนแถบ" : "Coils"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-right">{isThai ? "น้ำหนักรวม (kg)" : "Weight (kg)"}</th>
                        <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "อัตราการใช้งาน" : "Occupancy"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                      {storageSpaceAnalytics.buildingSummaries.map((b) => (
                        <tr
                          key={b.buildingId}
                          className="hover:bg-cyan-50/40 dark:hover:bg-cyan-950/20 transition-colors whitespace-nowrap"
                        >
                          <td className="!p-1.5 sm:!p-3 !text-left font-mono font-black text-cyan-600 dark:text-cyan-400 whitespace-nowrap">
                            {isThai ? b.buildingNameTh : b.buildingNameEn}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold">
                            {b.rowCount}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold">
                            {b.totalBaskets}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                            {b.availableBaskets}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">
                            {b.occupiedBaskets}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400">
                            {b.fullBaskets}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-slate-500">
                            {b.maintenanceBaskets}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-bold">
                            {b.totalCoils.toLocaleString()}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-slate-900 dark:text-white">
                            {b.totalWeightKg.toLocaleString()} kg
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center">
                            <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                              <div className="w-14 sm:w-20 bg-slate-200 dark:bg-slate-700 h-1.5 sm:h-2 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    b.occupancyPercent >= 85
                                      ? "bg-rose-500"
                                      : b.occupancyPercent >= 50
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                  }`}
                                  style={{ width: `${Math.min(100, b.occupancyPercent)}%` }}
                                />
                              </div>
                              <span className="font-mono tabular-nums font-bold text-[10px] sm:text-[11px] w-8 sm:w-9 text-right">
                                {b.occupancyPercent}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-100 dark:bg-[#0c1930] font-bold border-t-2 border-slate-300 dark:border-[#1e3a5f] whitespace-nowrap">
                      <tr>
                        <td colSpan={2} className="!p-1.5 sm:!p-3 !text-left uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          {isThai ? "รวมทุกอาคารคลังสินค้า (Total)" : "All Buildings Total"}
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums">
                          {storageSpaceAnalytics.warehouseTotals.totalBaskets}
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          {storageSpaceAnalytics.warehouseTotals.availableBaskets}
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-amber-600 dark:text-amber-400">
                          {storageSpaceAnalytics.warehouseTotals.occupiedBaskets}
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-rose-600 dark:text-rose-400">
                          {storageSpaceAnalytics.warehouseTotals.fullBaskets}
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-slate-500">
                          {storageSpaceAnalytics.warehouseTotals.maintenanceBaskets}
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                          {storageSpaceAnalytics.warehouseTotals.totalCoils.toLocaleString()}
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-right font-mono tabular-nums font-black text-cyan-600 dark:text-cyan-400">
                          {storageSpaceAnalytics.warehouseTotals.totalWeightKg.toLocaleString()} kg
                        </td>
                        <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-black">
                          {storageSpaceAnalytics.warehouseOccupancyPercent}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* =========================================================================
              PART 2: พื้นที่วางวัตถุดิบรอผลิตหน้าเครื่องจักร (TM 1-14 / CF 1, 2, 4, 5)
              ========================================================================= */}
          {(spaceReportSubTab === "all" || spaceReportSubTab === "machine") && (
            <section className="rounded-xl sm:rounded-2xl bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] shadow-md overflow-hidden">
              <div className="p-2.5 sm:p-5 bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                    <Cpu size={16} className="sm:w-5 sm:h-5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>
                        {isThai
                          ? "ส่วนที่ 2: รายงานพื้นที่วางวัตถุดิบรอผลิตหน้าเครื่องจักร (TM 1-14 / CF 1, 2, 4, 5)"
                          : "Part 2: Pre-Production Machine Staging Area Report (TM 1-14 / CF 1, 2, 4, 5)"}
                      </span>
                    </h3>
                    <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {isThai
                        ? "สรุปสถานะแคร่วางเหล็กสลิตหน้าเครื่องจักร ความยาวพื้นที่ใช้งาน (เมตร) จำนวนแถบ และรายการ Batch รอผลิต"
                        : "Summary of machine staging racks, used length (meters), staged coils and batches"}
                    </p>
                  </div>
                </div>

                {/* Machine Category & Activity Filter */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10.5px] sm:text-xs">
                  <div className="flex items-center gap-1 sm:gap-1.5 bg-white dark:bg-[#111e38] px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl border border-slate-300 dark:border-[#1e3a5f]">
                    <span className="text-slate-500 font-semibold">{isThai ? "กลุ่มเครื่อง:" : "Category:"}</span>
                    <select
                      value={spaceMachineCategoryFilter}
                      onChange={(e) =>
                        setSpaceMachineCategoryFilter(e.target.value as "all" | "pipe" | "c_channel")
                      }
                      className="bg-transparent font-bold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer"
                    >
                      <option value="all" className="bg-white dark:bg-[#111e38]">
                        {isThai ? "ทุกกลุ่มเครื่องจักร (18 เครื่อง)" : "All Machines (18)"}
                      </option>
                      <option value="pipe" className="bg-white dark:bg-[#111e38]">
                        {isThai ? "เครื่องผลิตท่อ (TM 01 - TM 14)" : "Pipe Forming (TM 01 - TM 14)"}
                      </option>
                      <option value="c_channel" className="bg-white dark:bg-[#111e38]">
                        {isThai ? "เครื่องผลิตตัวซี (CF 1, 2, 4, 5)" : "C-Channel (CF 1, 2, 4, 5)"}
                      </option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowOnlyActiveMachines((prev) => !prev)}
                    className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl text-[10.5px] sm:text-xs font-bold border transition-all cursor-pointer whitespace-nowrap ${
                      showOnlyActiveMachines
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f]"
                    }`}
                  >
                    {showOnlyActiveMachines
                      ? isThai
                        ? "แสดงครบทุกเครื่องจักร"
                        : "Show All Machines"
                      : isThai
                      ? "เฉพาะเครื่องที่มีวัตถุดิบ"
                      : "Active Machines Only"}
                  </button>
                </div>
              </div>

              {(() => {
                const filteredMachines = storageSpaceAnalytics.machineSummaries.filter((m) => {
                  if (spaceMachineCategoryFilter !== "all" && m.category !== spaceMachineCategoryFilter)
                    return false;
                  if (showOnlyActiveMachines && !m.hasActivity) return false;
                  return true;
                });

                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[10.5px] sm:text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#1e3a5f] whitespace-nowrap">
                          <th className="!p-1.5 sm:!p-3 !text-center w-10 sm:w-14">#</th>
                          <th className="!p-1.5 sm:!p-3 !text-left">{isThai ? "เครื่องจักร" : "Machine"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-left">{isThai ? "ประเภท / รายละเอียด" : "Category"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "แคร่ทั้งหมด" : "Total Racks"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-center !text-emerald-600 dark:!text-emerald-400">{isThai ? "ว่าง" : "Avail"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-center !text-amber-600 dark:!text-amber-400">{isThai ? "ใช้งาน" : "Occupied"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-center !text-rose-600 dark:!text-rose-400">{isThai ? "เต็ม" : "Full"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "พื้นที่ใช้ / ความจุ (m)" : "Used / Cap (m)"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-center">{isThai ? "อัตราใช้พื้นที่" : "Utilization"}</th>
                          <th className="!p-1.5 sm:!p-3 !text-center min-w-[190px] sm:min-w-[220px]">{isThai ? "สถานะการผลิต" : "Production Status"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                        {filteredMachines.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="!p-5 sm:!p-8 !text-center text-slate-400 text-[11px] sm:text-xs font-medium">
                              {isThai
                                ? "ไม่พบเครื่องจักรที่ตรงกับเงื่อนไขตัวกรอง"
                                : "No machine staging records match the filter."}
                            </td>
                          </tr>
                        ) : (
                          filteredMachines.map((m, idx) => (
                            <tr
                              key={m.machineId}
                              className="hover:bg-amber-50/30 dark:hover:bg-amber-950/15 transition-colors whitespace-nowrap"
                            >
                              <td className="!p-1.5 sm:!p-3 !text-center font-mono text-slate-400 tabular-nums">{idx + 1}</td>
                              <td className="!p-1.5 sm:!p-3 !text-left font-mono font-black text-amber-600 dark:text-amber-400 whitespace-nowrap">
                                {m.machineCode}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-left text-slate-600 dark:text-slate-300">
                                <div className="font-bold text-slate-800 dark:text-slate-200">
                                  {m.machineNameTh}
                                </div>
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold">
                                {m.totalRacks}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                                {m.availableRacks}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">
                                {m.occupiedRacks}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400">
                                {m.fullRacks}
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-bold">
                                {m.totalUsedMeters} / {m.totalCapacityMeters} m
                              </td>
                              <td className="!p-1.5 sm:!p-3 !text-center">
                                <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                                  <div className="w-12 sm:w-16 bg-slate-200 dark:bg-slate-700 h-1.5 sm:h-2 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        m.utilizationPercent >= 85
                                          ? "bg-rose-500"
                                          : m.utilizationPercent >= 50
                                          ? "bg-amber-500"
                                          : "bg-emerald-500"
                                      }`}
                                      style={{ width: `${Math.min(100, m.utilizationPercent)}%` }}
                                    />
                                  </div>
                                  <span className="font-mono tabular-nums font-bold text-[10px] sm:text-[11px] w-8 sm:w-9 text-right">
                                    {m.utilizationPercent}%
                                  </span>
                                </div>
                              </td>
                              <td className="!p-1.5 sm:!p-2.5 !text-center min-w-[190px] sm:min-w-[220px]">
                                {(() => {
                                  const prodStatus = machineProductionStatus[m.machineId] || {
                                    waitingMoveInActive: false,
                                    waitingMoveInCoils: 0,
                                    waitingSlitActive: false,
                                    waitingSlitCoils: 0,
                                  };

                                  const isMoveInSelected =
                                    prodStatus.waitingMoveInActive || prodStatus.waitingMoveInCoils > 0;
                                  const isSlitSelected =
                                    prodStatus.waitingSlitActive || prodStatus.waitingSlitCoils > 0;

                                  const showMoveIn = !isSlitSelected;
                                  const showSlit = !isMoveInSelected;

                                  return (
                                    <div className="flex flex-row items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap">
                                      {/* 1) รอย้ายเข้า */}
                                      {showMoveIn && (
                                        <div
                                          className={`flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg border text-[10.5px] sm:text-xs transition-colors ${
                                            prodStatus.waitingMoveInActive
                                              ? "bg-amber-500/10 border-amber-500/40 text-amber-900 dark:text-amber-200"
                                              : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400"
                                          }`}
                                        >
                                          <label className="flex items-center gap-1 sm:gap-1.5 cursor-pointer select-none font-bold shrink-0">
                                            <input
                                              type="checkbox"
                                              checked={prodStatus.waitingMoveInActive}
                                              onChange={(e) => {
                                                const isChecked = e.target.checked;
                                                handleUpdateProductionStatus(m.machineId, {
                                                  waitingMoveInActive: isChecked,
                                                  waitingMoveInCoils: isChecked ? (prodStatus.waitingMoveInCoils || 0) : 0,
                                                  waitingSlitActive: false,
                                                  waitingSlitCoils: 0,
                                                });
                                              }}
                                              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer w-3 h-3 sm:w-3.5 sm:h-3.5"
                                            />
                                            <span className={prodStatus.waitingMoveInActive ? "text-amber-700 dark:text-amber-300 font-bold" : "text-slate-500"}>
                                              {isThai ? "รอย้ายเข้า" : "Wait In"}
                                            </span>
                                          </label>

                                          <div className="flex items-center gap-1 shrink-0">
                                            <input
                                              type="number"
                                              min={0}
                                              value={prodStatus.waitingMoveInCoils || ""}
                                              placeholder="0"
                                              onChange={(e) => {
                                                const val = parseInt(e.target.value, 10);
                                                const num = isNaN(val) ? 0 : Math.max(0, val);
                                                handleUpdateProductionStatus(m.machineId, {
                                                  waitingMoveInCoils: num,
                                                  waitingMoveInActive: num > 0 ? true : prodStatus.waitingMoveInActive,
                                                  ...(num > 0 ? { waitingSlitActive: false, waitingSlitCoils: 0 } : {}),
                                                });
                                              }}
                                              className={`w-11 sm:w-14 px-1 sm:px-1.5 py-0.5 text-center font-mono font-black text-[10.5px] sm:text-xs rounded border focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                                                prodStatus.waitingMoveInActive
                                                  ? "bg-white dark:bg-slate-900 border-amber-400 text-amber-700 dark:text-amber-300 shadow-xs"
                                                  : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400"
                                              }`}
                                            />
                                            <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 dark:text-slate-400">{isThai ? "แถบ" : "coils"}</span>
                                          </div>
                                        </div>
                                      )}

                                      {/* 2) รอสลิต */}
                                      {showSlit && (
                                        <div
                                          className={`flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg border text-[10.5px] sm:text-xs transition-colors ${
                                            prodStatus.waitingSlitActive
                                              ? "bg-blue-500/10 border-blue-500/40 text-blue-900 dark:text-blue-200"
                                              : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400"
                                          }`}
                                        >
                                          <label className="flex items-center gap-1 sm:gap-1.5 cursor-pointer select-none font-bold shrink-0">
                                            <input
                                              type="checkbox"
                                              checked={prodStatus.waitingSlitActive}
                                              onChange={(e) => {
                                                const isChecked = e.target.checked;
                                                handleUpdateProductionStatus(m.machineId, {
                                                  waitingSlitActive: isChecked,
                                                  waitingSlitCoils: isChecked ? (prodStatus.waitingSlitCoils || 0) : 0,
                                                  waitingMoveInActive: false,
                                                  waitingMoveInCoils: 0,
                                                });
                                              }}
                                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-3 h-3 sm:w-3.5 sm:h-3.5"
                                            />
                                            <span className={prodStatus.waitingSlitActive ? "text-blue-700 dark:text-blue-300 font-bold" : "text-slate-500"}>
                                              {isThai ? "รอสลิต" : "Wait Slit"}
                                            </span>
                                          </label>

                                          <div className="flex items-center gap-1 shrink-0">
                                            <input
                                              type="number"
                                              min={0}
                                              value={prodStatus.waitingSlitCoils || ""}
                                              placeholder="0"
                                              onChange={(e) => {
                                                const val = parseInt(e.target.value, 10);
                                                const num = isNaN(val) ? 0 : Math.max(0, val);
                                                handleUpdateProductionStatus(m.machineId, {
                                                  waitingSlitCoils: num,
                                                  waitingSlitActive: num > 0 ? true : prodStatus.waitingSlitActive,
                                                  ...(num > 0 ? { waitingMoveInActive: false, waitingMoveInCoils: 0 } : {}),
                                                });
                                              }}
                                              className={`w-11 sm:w-14 px-1 sm:px-1.5 py-0.5 text-center font-mono font-black text-[10.5px] sm:text-xs rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                                prodStatus.waitingSlitActive
                                                  ? "bg-white dark:bg-slate-900 border-blue-400 text-blue-700 dark:text-blue-300 shadow-xs"
                                                  : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400"
                                              }`}
                                            />
                                            <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 dark:text-slate-400">{isThai ? "แถบ" : "coils"}</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot className="bg-slate-100 dark:bg-[#0c1930] font-bold border-t-2 border-slate-300 dark:border-[#1e3a5f] whitespace-nowrap">
                        <tr>
                          <td colSpan={3} className="!p-1.5 sm:!p-3 !text-left uppercase tracking-wider text-slate-700 dark:text-slate-200">
                            {isThai ? "รวมพื้นที่หน้าเครื่องจักรทั้งหมด (Total)" : "All Machines Total"}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums">
                            {storageSpaceAnalytics.machineTotals.totalRacks}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                            {storageSpaceAnalytics.machineTotals.availableRacks}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-amber-600 dark:text-amber-400">
                            {storageSpaceAnalytics.machineTotals.occupiedRacks}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-rose-600 dark:text-rose-400">
                            {storageSpaceAnalytics.machineTotals.fullRacks}
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums text-amber-600 dark:text-amber-400">
                            {storageSpaceAnalytics.machineTotals.totalUsedMeters} /{" "}
                            {storageSpaceAnalytics.machineTotals.totalCapacityMeters} m
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono tabular-nums font-black">
                            {storageSpaceAnalytics.machineUtilizationPercent}%
                          </td>
                          <td className="!p-1.5 sm:!p-3 !text-center font-mono text-[10.5px] sm:text-xs min-w-[190px] sm:min-w-[220px]">
                            <div className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full bg-amber-500"></span>
                                <span className="text-slate-600 dark:text-slate-300 font-semibold">{isThai ? "รอย้ายเข้าทั้งหมด:" : "Total Wait In:"}</span>
                                <strong className="text-amber-600 dark:text-amber-400 font-bold tabular-nums">
                                  {totalWaitingMoveIn.toLocaleString()}
                                </strong>
                                <span className="text-slate-400">{isThai ? "แถบ" : "coils"}</span>
                              </div>
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                                <span className="text-slate-600 dark:text-slate-300 font-semibold">{isThai ? "รอสลิตทั้งหมด:" : "Total Wait Slit:"}</span>
                                <strong className="text-blue-600 dark:text-blue-400 font-bold tabular-nums">
                                  {totalWaitingSlit.toLocaleString()}
                                </strong>
                                <span className="text-slate-400">{isThai ? "แถบ" : "coils"}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })()}
            </section>
          )}
        </>
      )}
    </div>
  );
}
