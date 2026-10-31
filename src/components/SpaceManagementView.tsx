/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import Swal from "sweetalert2";
import {
  Building2,
  Grid,
  Layers,
  Search,
  Plus,
  Printer,
  Trash2,
  Eye,
  CheckCircle2,
  AlertTriangle,
  X,
  Package,
  Boxes,
  FileSpreadsheet,
  RotateCcw,
  Info,
  Filter,
  Check,
  Wrench,
  ShieldAlert,
  ArrowRightLeft,
  SlidersHorizontal,
  ChevronRight,
  HardDrive,
  Cpu
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { MachineStagingArea } from "./MachineStagingArea";
import {
  getAllStagedCoilsWithMachineInfo,
  MACHINE_STAGING_UPDATED_EVENT,
} from "../data/machineStagingStorage";
import {
  getStoredMasterBasketLayout,
  addBasketToRow,
  addNewRowToBuilding,
  removeBasketFromRow,
  ensureBasketInMasterLayout,
  STORAGE_KEY_MASTER_BASKET_LAYOUT,
  MASTER_BASKET_LAYOUT_UPDATED_EVENT,
  BuildingId,
} from "../data/masterBasketStorage";
import type { SlitBarcodeRecord, PickListOrder, SapMasterItem } from "./SlitFilmManagement";
import {
  subscribeToSlitInbound,
  subscribeToSlitOutbound,
  subscribeToSlitPickLists,
  saveInboundRecordToCloud,
  deleteInboundByBatchesFromCloud,
  clearLegacySlitLocalStorage,
} from "../services/slitDataService";

export interface SlitCoilItem {
  batch: string;
  spec: string;
  grade: string;
  weightKg: number;
  inboundDate: string;
  machine: string;
  customerOrder?: string;
}

export interface BasketItem {
  id: string; // e.g. "H-A01"
  basketNo: string; // e.g. "ตะกร้า 01"
  buildingId: "H" | "F" | "E9" | "E10" | "I";
  rowId: string; // e.g. "A", "B", "C", "D", "E"
  status: "available" | "occupied" | "full" | "maintenance";
  maxCapacityKg: number;
  maxCoils: number;
  coils: SlitCoilItem[];
  notes?: string;
  lastUpdated?: string;
}

export interface RowStorage {
  rowId: string; // "A", "B", "C", "D", "E"
  rowNameTh: string; // "แถว A"
  rowNameEn: string; // "Row A"
  descriptionTh?: string;
  baskets: BasketItem[];
}

export interface BuildingSpaceData {
  buildingId: "H" | "F" | "E9" | "E10" | "I";
  buildingNameTh: string;
  buildingNameEn: string;
  subtitleTh: string;
  subtitleEn: string;
  rows: RowStorage[];
}

const STORAGE_KEY_SPACE_DATA = "tmt_wms_space_management_data_v1";

const BUILDING_METADATA: Record<string, { buildingNameTh: string; buildingNameEn: string; subtitleTh: string; subtitleEn: string }> = {
  H: {
    buildingNameTh: "อาคาร H",
    buildingNameEn: "Building H",
    subtitleTh: "ศูนย์จัดเก็บฟิล์มสลิตหลัก และคลังย่อยแปรรูป (Main Slit Film Hub)",
    subtitleEn: "Primary Slit Film Processing & Storage Hub",
  },
  F: {
    buildingNameTh: "อาคาร F",
    buildingNameEn: "Building F",
    subtitleTh: "คลังฟิล์มสลิตเกรดพรีเมียม และงานส่งมอบด่วน (High Grade Warehouse)",
    subtitleEn: "Premium Grade & Fast Dispatch Slit Warehouse",
  },
  E9: {
    buildingNameTh: "อาคาร E9",
    buildingNameEn: "Building E9",
    subtitleTh: "คลังจัดเก็บฟิล์มสลิตเกรดอุตสาหกรรมหนัก (Heavy Industrial Slit Storage)",
    subtitleEn: "Heavy Industrial Slit Storage Zone",
  },
  E10: {
    buildingNameTh: "อาคาร E10",
    buildingNameEn: "Building E10",
    subtitleTh: "โซนจัดเก็บและเตรียมการส่งออกฟิล์มสลิต (Export & Fast Staging Area)",
    subtitleEn: "Export & Fast Staging Slit Warehouse Zone",
  },
  I: {
    buildingNameTh: "อาคาร I",
    buildingNameEn: "Building I",
    subtitleTh: "โซนจัดเก็บฟิล์มสลิตวัตถุดิบรองรับงานแปรรูป (Raw Material Slit Buffer)",
    subtitleEn: "Raw Material Slit Buffer & Processing Storage",
  },
};

function calculateBasketTotalWidthMm(coils: SlitCoilItem[]): number {
  if (!coils || coils.length === 0) return 0;
  let totalMm = 0;
  coils.forEach((c) => {
    const parts = c.spec.split("x");
    const widthStr = parts[1] || parts[0] || "";
    const numMatch = widthStr.match(/[\d.]+/);
    if (numMatch) {
      let val = parseFloat(numMatch[0]);
      if (val < 10) {
        totalMm += val * 1000;
      } else {
        totalMm += val;
      }
    } else {
      totalMm += 150;
    }
  });
  return totalMm;
}

function calculateBasketTotalWidthMeters(coils: SlitCoilItem[]): number {
  return calculateBasketTotalWidthMm(coils) / 1000;
}

function formatShortBasketName(id: string): string {
  if (!id) return "";
  return id;
}

function parseWarehouseBasketLocation(rawLoc: string): {
  bId: "H" | "F" | "E9" | "E10" | "I";
  rId: string;
  bNo: string;
  basketId: string;
} {
  let loc = String(rawLoc || "").trim().toUpperCase();
  loc = loc.replace(/^อาคาร\s*/i, "").trim();

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
    if (/^F\d+\s*[-/_]\s*[A-Z]/i.test(loc)) {
      rest = loc.replace(/^F\d+\s*[-/_]\s*/i, "");
    } else {
      rest = loc.replace(/^F\s*[-/_]?\s*/i, "");
    }
  } else if (loc.startsWith("I")) {
    bId = "I";
    if (/^I\d+\s*[-/_]\s*[A-Z]/i.test(loc)) {
      rest = loc.replace(/^I\d+\s*[-/_]\s*/i, "");
    } else {
      rest = loc.replace(/^I\s*[-/_]?\s*/i, "");
    }
  } else if (loc.startsWith("H")) {
    bId = "H";
    if (/^H\d+\s*[-/_]\s*[A-Z]/i.test(loc)) {
      rest = loc.replace(/^H\d+\s*[-/_]\s*/i, "");
    } else {
      rest = loc.replace(/^H\s*[-/_]?\s*/i, "");
    }
  }

  // Strip optional SAP 'O' prefix before row letter + digits (e.g. H/OE10 -> E10, F/OC13 -> C13)
  rest = rest.replace(/^O(?=[A-Z]\d)/i, "").trim();

  const rowMatch = rest.match(/[A-Z]/);
  const rId = rowMatch ? rowMatch[0] : "A";

  const numMatch = rest.match(/\d+/);
  const bNo = numMatch ? numMatch[0].padStart(2, "0") : "01";

  return {
    bId,
    rId,
    bNo,
    basketId: `${bId}-${rId}${bNo}`,
  };
}

function loadSpaceDataFromInventory(
  records: SlitBarcodeRecord[] = [],
  pickLists: PickListOrder[] = [],
  outboundRecs: SlitBarcodeRecord[] = [],
  externalSapMasterMap?: Map<string, SapMasterItem>,
  statusOverrides: Record<string, { status: string; notes?: string; lastUpdated?: string }> = {}
): BuildingSpaceData[] {
  try {
    // Load SAP master records as fallback for location, thickness, width, grade, and weight
    const sapMasterMap = new Map<string, any>();
    if (externalSapMasterMap && externalSapMasterMap.size > 0) {
      externalSapMasterMap.forEach((val, key) => {
        sapMasterMap.set(String(key).trim().toUpperCase(), val);
      });
    } else {
      try {
        const sapStr = localStorage.getItem("tmt_wms_slit_sap_master_records");
        if (sapStr) {
          const sapArr = JSON.parse(sapStr);
          if (Array.isArray(sapArr)) {
            sapArr.forEach((item: any) => {
              if (item?.batch) {
                sapMasterMap.set(String(item.batch).trim().toUpperCase(), item);
              }
            });
          }
        }
      } catch {}
    }

    // Track batches issued at machine (จ่ายหน้าเครื่อง) along with their latest issue timestamp
    const issuedAtMachineMap = new Map<string, string>();
    if (Array.isArray(pickLists)) {
      pickLists.forEach((pl: any) => {
        (pl.items || []).forEach((item: any) => {
          if (item?.batch && item?.machineIssued === true) {
            const bKey = String(item.batch).trim().toUpperCase();
            const ts = String(item.machineIssuedAt || pl.createdAt || "");
            const prevTs = issuedAtMachineMap.get(bKey) || "";
            if (ts >= prevTs) {
              issuedAtMachineMap.set(bKey, ts);
            }
          }
        });
      });
    }

    if (Array.isArray(outboundRecs)) {
      outboundRecs.forEach((ob: any) => {
        if (!ob?.batch) return;
        const loc = String(ob.location || ob.storageLocation || "").trim().toUpperCase();
        if (
          loc.startsWith("เบิก") ||
          loc.includes("เบิก") ||
          (ob.conditionText && String(ob.conditionText).includes("รับงานหน้าเครื่อง"))
        ) {
          const bKey = String(ob.batch).trim().toUpperCase();
          const ts = String(ob.scanTimestamp || "");
          const prevTs = issuedAtMachineMap.get(bKey) || "";
          if (ts >= prevTs) {
            issuedAtMachineMap.set(bKey, ts);
          }
        }
      });
    }

    const buildingMap: Record<string, Record<string, Record<string, any[]>>> = {
      H: {},
      F: {},
      E9: {},
      E10: {},
      I: {}
    };

    // Load Master Layout once and build an in-memory Set of existing basket IDs to avoid per-record localStorage reads/writes
    let masterLayout = getStoredMasterBasketLayout();
    const existingMasterBasketSet = new Set<string>();
    masterLayout.forEach((b) => {
      b.rows.forEach((r) => {
        r.baskets.forEach((bk) => {
          existingMasterBasketSet.add(`${b.buildingId}::${r.rowId.toUpperCase()}::${bk.id.toUpperCase()}`);
        });
      });
    });
    let masterLayoutModified = false;

    // Deduplicate inbound records by batch (taking the first/latest record per batch)
    const seenBatches = new Set<string>();

    records.forEach((rec: any) => {
      if (!rec || !rec.batch) return;
      const bKey = String(rec.batch).trim().toUpperCase();
      if (!bKey || seenBatches.has(bKey)) return;
      seenBatches.add(bKey);

      const sapMatch = sapMasterMap.get(bKey);

      const isReturnedToWarehouse = Boolean(
        rec.conditionText && String(rec.conditionText).includes("คืนคลัง")
      );

      let rawLoc = String(rec.location || rec.storageLocation || "").trim();
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

      const loc = rawLoc.toUpperCase();

      // Check if this batch was issued at machine (unless returned to warehouse)
      const issuedTs = issuedAtMachineMap.get(bKey);
      const isIssuedAfterInbound =
        issuedTs !== undefined && !isReturnedToWarehouse;

      // Exclude records that have no basket location or have completed จ่ายหน้าเครื่อง
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
        (rec.conditionText && String(rec.conditionText).includes("รับงานหน้าเครื่อง")) ||
        isIssuedAfterInbound
      ) {
        return;
      }

      const { bId, rId, basketId } = parseWarehouseBasketLocation(loc);

      // Auto-register in Master Layout only if not already present in memory
      const masterKey = `${bId}::${rId.toUpperCase()}::${basketId.toUpperCase()}`;
      if (!existingMasterBasketSet.has(masterKey)) {
        existingMasterBasketSet.add(masterKey);
        if (ensureBasketInMasterLayout(bId, rId, basketId)) {
          masterLayoutModified = true;
        }
      }

      if (!buildingMap[bId]) buildingMap[bId] = {};
      if (!buildingMap[bId][rId]) buildingMap[bId][rId] = {};
      if (!buildingMap[bId][rId][basketId]) {
        buildingMap[bId][rId][basketId] = [];
      }

      const certThickness = rec.certThickness || sapMatch?.certThickness;
      const width = rec.width || sapMatch?.width;
      const grade = rec.grade || sapMatch?.grade || "-";
      const weightKg = rec.weightKg || sapMatch?.weightKg || 0;

      buildingMap[bId][rId][basketId].push({
        batch: rec.batch,
        spec: certThickness || width ? `${certThickness || "-"} x ${width || "-"}` : "-",
        grade,
        weightKg,
        inboundDate: rec.scanTimestamp || "-",
        machine: rec.machine || "-",
      });
    });

    if (masterLayoutModified) {
      masterLayout = getStoredMasterBasketLayout();
    }

    // Preserve manual statuses (like maintenance) passed in statusOverrides
    const existingStatusMap: Record<string, { status: string; notes?: string; lastUpdated?: string }> = {
      ...statusOverrides,
    };

    const result: BuildingSpaceData[] = masterLayout.map((masterBuilding) => {
      const bId = masterBuilding.buildingId;
      const rowsObj = buildingMap[bId] || {};

      const rows: RowStorage[] = masterBuilding.rows.map((masterRow) => {
        const basketsObj = rowsObj[masterRow.rowId] || {};

        const baskets: BasketItem[] = masterRow.baskets.map((masterBasket) => {
          const coils = basketsObj[masterBasket.id] || [];
          const totalWidthMm = calculateBasketTotalWidthMm(coils);
          const existingInfo = existingStatusMap[masterBasket.id];
          let status: BasketItem["status"] = "available";
          if (existingInfo && existingInfo.status === "maintenance") {
            status = "maintenance";
          } else if (coils.length === 0) {
            status = "available";
          } else if (totalWidthMm >= 2000) {
            status = "full";
          } else {
            status = "occupied";
          }

          return {
            id: masterBasket.id,
            basketNo: masterBasket.basketNo,
            buildingId: bId,
            rowId: masterRow.rowId,
            status,
            maxCapacityKg: masterBasket.maxCapacityKg || 2500,
            maxCoils: masterBasket.maxCoils || 3,
            coils,
            notes: existingInfo?.notes || masterBasket.notes,
            lastUpdated: coils[0]?.inboundDate || existingInfo?.lastUpdated || ""
          };
        });

        return {
          rowId: masterRow.rowId,
          rowNameTh: masterRow.rowNameTh,
          rowNameEn: masterRow.rowNameEn,
          descriptionTh: masterRow.descriptionTh,
          baskets
        };
      });

      return {
        buildingId: bId,
        buildingNameTh: masterBuilding.buildingNameTh,
        buildingNameEn: masterBuilding.buildingNameEn,
        subtitleTh: masterBuilding.subtitleTh,
        subtitleEn: masterBuilding.subtitleEn,
        rows
      };
    });

    return result;
  } catch (e) {
    console.error("Failed to load space data from inventory stock:", e);
    return [];
  }
}

export interface SpaceManagementViewProps {
  isThai?: boolean;
  inboundList?: SlitBarcodeRecord[];
  outboundList?: SlitBarcodeRecord[];
  pickLists?: PickListOrder[];
  sapMasterMap?: Map<string, SapMasterItem>;
}

export const SpaceManagementView: React.FC<SpaceManagementViewProps> = ({
  isThai: externalIsThai,
  inboundList: propInboundList,
  outboundList: propOutboundList,
  pickLists: propPickLists,
  sapMasterMap: propSapMasterMap,
}) => {
  const { language } = useLanguage();
  const isThai = externalIsThai ?? (language === "th");

  const [cloudInbound, setCloudInbound] = useState<SlitBarcodeRecord[]>(propInboundList || []);
  const [cloudOutbound, setCloudOutbound] = useState<SlitBarcodeRecord[]>(propOutboundList || []);
  const [cloudPickLists, setCloudPickLists] = useState<PickListOrder[]>(propPickLists || []);
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, { status: string; notes?: string; lastUpdated?: string }>
  >({});

  useEffect(() => {
    clearLegacySlitLocalStorage();
    const unsubIn = subscribeToSlitInbound((records) => setCloudInbound(records));
    const unsubOut = subscribeToSlitOutbound((records) => setCloudOutbound(records));
    const unsubPick = subscribeToSlitPickLists((orders) => setCloudPickLists(orders));
    return () => {
      unsubIn();
      unsubOut();
      unsubPick();
    };
  }, []);

  const effectiveInbound = propInboundList ?? cloudInbound;
  const effectiveOutbound = propOutboundList ?? cloudOutbound;
  const effectivePickLists = propPickLists ?? cloudPickLists;

  const [spaceData, setSpaceData] = useState<BuildingSpaceData[]>(() =>
    loadSpaceDataFromInventory(
      effectiveInbound,
      effectivePickLists,
      effectiveOutbound,
      propSapMasterMap,
      statusOverrides
    )
  );

  const [spaceSubView, setSpaceSubView] = useState<"warehouse_baskets" | "machine_staging">("warehouse_baskets");
  const [activeBuildingId, setActiveBuildingId] = useState<"H" | "F" | "E9" | "E10" | "I">("H");
  const [selectedRowId, setSelectedRowId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedBasket, setSelectedBasket] = useState<BasketItem | null>(null);
  const [isCompactView, setIsCompactView] = useState<boolean>(true);

  // Modals state
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [isAddBasketModalOpen, setIsAddBasketModalOpen] = useState<boolean>(false);
  const [isAddCoilModalOpen, setIsAddCoilModalOpen] = useState<boolean>(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);

  // New Basket Form
  const [newBasketRowId, setNewBasketRowId] = useState<string>("A");
  const [newBasketNo, setNewBasketNo] = useState<string>("");
  const [newBasketMaxKg, setNewBasketMaxKg] = useState<number>(2500);

  // New Coil Form for Basket
  const [newCoilBatch, setNewCoilBatch] = useState<string>("");
  const [newCoilSpec, setNewCoilSpec] = useState<string>("");
  const [newCoilGrade, setNewCoilGrade] = useState<string>("");
  const [newCoilWeight, setNewCoilWeight] = useState<number>(0);
  const [newCoilMachine, setNewCoilMachine] = useState<string>("SM01");

  // Recompute basket contents directly from live Cloud Firestore data
  useEffect(() => {
    const syncData = () => {
      const liveData = loadSpaceDataFromInventory(
        effectiveInbound,
        effectivePickLists,
        effectiveOutbound,
        propSapMasterMap,
        statusOverrides
      );
      setSpaceData((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(liveData)) {
          return prev;
        }
        return liveData;
      });
    };

    syncData();
    window.addEventListener(MACHINE_STAGING_UPDATED_EVENT, syncData);
    window.addEventListener(MASTER_BASKET_LAYOUT_UPDATED_EVENT, syncData);

    return () => {
      window.removeEventListener(MACHINE_STAGING_UPDATED_EVENT, syncData);
      window.removeEventListener(MASTER_BASKET_LAYOUT_UPDATED_EVENT, syncData);
    };
  }, [effectiveInbound, effectivePickLists, effectiveOutbound, propSapMasterMap, statusOverrides]);

  // Keep selectedBasket modal in sync when coils are cut/removed upon จ่ายหน้าเครื่อง
  useEffect(() => {
    if (!selectedBasket) return;
    let foundBasket: BasketItem | null = null;
    for (const b of spaceData) {
      for (const r of b.rows) {
        const match = r.baskets.find((bk) => bk.id === selectedBasket.id);
        if (match) {
          foundBasket = match;
          break;
        }
      }
      if (foundBasket) break;
    }
    if (foundBasket) {
      setSelectedBasket((prev) => {
        if (!prev || JSON.stringify(prev) === JSON.stringify(foundBasket)) return prev;
        return foundBasket;
      });
    } else if (selectedBasket.coils.length > 0) {
      setSelectedBasket((prev) =>
        prev
          ? {
              ...prev,
              coils: [],
              status: prev.status === "maintenance" ? "maintenance" : "available",
            }
          : null
      );
    }
  }, [spaceData]);

  // Building Max Storage Capacity (Tons) - User configurable per building & persisted in LocalStorage
  const [buildingMaxCapacityTons, setBuildingMaxCapacityTons] = useState<Record<"H" | "F" | "E9" | "E10" | "I", number>>(() => {
    const defaults: Record<"H" | "F" | "E9" | "E10" | "I", number> = {
      H: 8000,
      F: 8000,
      E9: 8000,
      E10: 8000,
      I: 8000,
    };
    try {
      const saved = localStorage.getItem("tmt_wms_building_max_capacity_tons_v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          return { ...defaults, ...parsed };
        }
      }
    } catch {}
    return defaults;
  });

  const [editingCapacityBuildingId, setEditingCapacityBuildingId] = useState<"H" | "F" | "E9" | "E10" | "I" | null>(null);
  const [editingCapacityValue, setEditingCapacityValue] = useState<string>("");

  const handleSaveBuildingCapacity = (buildingId: "H" | "F" | "E9" | "E10" | "I") => {
    const parsed = parseFloat(editingCapacityValue.replace(/,/g, "").trim());
    if (isNaN(parsed) || parsed < 0) {
      Swal.fire({
        icon: "warning",
        title: "ค่าความจุไม่ถูกต้อง",
        text: "กรุณาระบุพื้นที่จัดเก็บอาคารเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0 ตัน",
        confirmButtonColor: "#0891b2",
      });
      return;
    }
    const updated = {
      ...buildingMaxCapacityTons,
      [buildingId]: parsed,
    };
    setBuildingMaxCapacityTons(updated);
    try {
      localStorage.setItem("tmt_wms_building_max_capacity_tons_v1", JSON.stringify(updated));
    } catch {}
    setEditingCapacityBuildingId(null);
    Swal.fire({
      icon: "success",
      title: "บันทึกพื้นที่จัดเก็บอาคารสำเร็จ",
      text: `กำหนดความจุสูงสุด อาคาร ${buildingId} = ${parsed.toLocaleString()} ตัน`,
      timer: 1400,
      showConfirmButton: false,
      toast: true,
      position: "top-end",
    });
  };

  // Current Active Building Data
  const currentBuilding = useMemo(() => {
    return spaceData.find((b) => b.buildingId === activeBuildingId) || spaceData[0];
  }, [spaceData, activeBuildingId]);

  // Overall Statistics for Current Building
  const buildingStats = useMemo(() => {
    let totalBaskets = 0;
    let availableBaskets = 0;
    let occupiedBaskets = 0;
    let fullBaskets = 0;
    let maintenanceBaskets = 0;
    let totalWeightKg = 0;
    let maxWeightCapacityKg = 0;
    let totalCoilCount = 0;

    currentBuilding.rows.forEach((row) => {
      row.baskets.forEach((basket) => {
        totalBaskets++;
        maxWeightCapacityKg += basket.maxCapacityKg;
        const currentBasketWeight = basket.coils.reduce((sum, c) => sum + c.weightKg, 0);
        totalWeightKg += currentBasketWeight;
        totalCoilCount += basket.coils.length;

        if (basket.status === "available") availableBaskets++;
        else if (basket.status === "occupied") occupiedBaskets++;
        else if (basket.status === "full") fullBaskets++;
        else if (basket.status === "maintenance") maintenanceBaskets++;
      });
    });

    const occupancyRatePercent = totalBaskets > 0
      ? Math.round(((occupiedBaskets + fullBaskets) / totalBaskets) * 100)
      : 0;

    return {
      totalBaskets,
      availableBaskets,
      occupiedBaskets,
      fullBaskets,
      maintenanceBaskets,
      totalWeightKg,
      maxWeightCapacityKg,
      totalCoilCount,
      occupancyRatePercent
    };
  }, [currentBuilding]);

  // Building Summaries for Tab Badges & Building Space Cards
  const buildingTabSummaries = useMemo(() => {
    return spaceData.map((b) => {
      let totalB = 0;
      let usedB = 0;
      let totalCoils = 0;
      let totalInboundWeight = 0;
      b.rows.forEach((r) => {
        r.baskets.forEach((bk) => {
          totalB++;
          if (bk.status === "occupied" || bk.status === "full") usedB++;
          totalCoils += bk.coils.length;
          totalInboundWeight += bk.coils.reduce((sum, c) => sum + (Number(c.weightKg) || 0), 0);
        });
      });
      const percent = totalB > 0 ? Math.round((usedB / totalB) * 100) : 0;
      const maxCapacityTons = buildingMaxCapacityTons[b.buildingId] ?? 8000;
      const usedSpaceTons = Number((totalInboundWeight / 1000).toFixed(3));
      const remainingSpaceTons = Number((maxCapacityTons - usedSpaceTons).toFixed(3));
      const spaceUsagePercent = maxCapacityTons > 0 ? Math.round((usedSpaceTons / maxCapacityTons) * 100) : 0;

      return {
        buildingId: b.buildingId,
        buildingNameTh: b.buildingNameTh,
        percent,
        totalBaskets: totalB,
        usedBaskets: usedB,
        totalCoils,
        maxCapacityTons,
        usedSpaceTons,
        remainingSpaceTons,
        spaceUsagePercent,
      };
    });
  }, [spaceData, buildingMaxCapacityTons]);

  // Summary across ALL storage areas combined (H, F, E9, E10, I)
  const allStorageAreasSummary = useMemo(() => {
    const totalMaxCapacityTons = buildingTabSummaries.reduce((sum, b) => sum + b.maxCapacityTons, 0);
    const totalUsedSpaceTons = Number(
      buildingTabSummaries.reduce((sum, b) => sum + b.usedSpaceTons, 0).toFixed(3)
    );
    const totalRemainingSpaceTons = Number((totalMaxCapacityTons - totalUsedSpaceTons).toFixed(3));
    const totalBaskets = buildingTabSummaries.reduce((sum, b) => sum + b.totalBaskets, 0);
    const totalUsedBaskets = buildingTabSummaries.reduce((sum, b) => sum + b.usedBaskets, 0);
    const totalCoils = buildingTabSummaries.reduce((sum, b) => sum + b.totalCoils, 0);
    const basketPercent = totalBaskets > 0 ? Math.round((totalUsedBaskets / totalBaskets) * 100) : 0;
    const spacePercent = totalMaxCapacityTons > 0 ? Math.round((totalUsedSpaceTons / totalMaxCapacityTons) * 100) : 0;

    return {
      totalMaxCapacityTons,
      totalUsedSpaceTons,
      totalRemainingSpaceTons,
      totalBaskets,
      totalUsedBaskets,
      totalCoils,
      basketPercent,
      spacePercent,
    };
  }, [buildingTabSummaries]);

  const hasInventoryStock = useMemo(() => {
    return spaceData.some((b) => b.rows.some((r) => r.baskets.length > 0));
  }, [spaceData]);

  // Filtered Rows and Baskets
  const filteredRows = useMemo(() => {
    return currentBuilding.rows
      .filter((row) => selectedRowId === "all" || row.rowId === selectedRowId)
      .map((row) => {
        const filteredBaskets = row.baskets.filter((basket) => {
          // Status Filter
          if (selectedStatus !== "all" && basket.status !== selectedStatus) return false;

          // Search Query
          if (searchQuery.trim()) {
            const query = searchQuery.trim().toLowerCase();
            const matchId = basket.id.toLowerCase().includes(query);
            const matchNo = basket.basketNo.toLowerCase().includes(query);
            const matchNotes = (basket.notes || "").toLowerCase().includes(query);
            const matchCoils = basket.coils.some((c) =>
              c.batch.toLowerCase().includes(query) ||
              c.spec.toLowerCase().includes(query) ||
              c.grade.toLowerCase().includes(query) ||
              (c.customerOrder || "").toLowerCase().includes(query)
            );
            return matchId || matchNo || matchNotes || matchCoils;
          }
          return true;
        });

        return {
          ...row,
          baskets: filteredBaskets
        };
      })
      .filter((row) => row.baskets.length > 0 || (selectedRowId !== "all" && searchQuery === ""));
  }, [currentBuilding, selectedRowId, selectedStatus, searchQuery]);

  // Handler: Change Basket Status
  const handleUpdateBasketStatus = (basketId: string, newStatus: "available" | "occupied" | "full" | "maintenance") => {
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 16);
    setStatusOverrides((prev) => ({
      ...prev,
      [basketId]: {
        status: newStatus,
        notes: prev[basketId]?.notes,
        lastUpdated: nowStr,
      },
    }));
    setSpaceData((prev) =>
      prev.map((b) => {
        if (b.buildingId !== activeBuildingId) return b;
        return {
          ...b,
          rows: b.rows.map((r) => ({
            ...r,
            baskets: r.baskets.map((bk) => {
              if (bk.id === basketId) {
                const updated = {
                  ...bk,
                  status: newStatus,
                  lastUpdated: nowStr
                };
                if (selectedBasket?.id === basketId) setSelectedBasket(updated);
                return updated;
              }
              return bk;
            })
          }))
        };
      })
    );

    Swal.fire({
      icon: "success",
      title: "อัปเดตสถานะตะกร้าเรียบร้อย",
      text: `ปรับเปลี่ยนสถานะตะกร้า ${basketId} เป็นเรียบร้อยแล้ว`,
      timer: 1500,
      showConfirmButton: false,
      toast: true,
      position: "top-end"
    });
  };

  // Handler: Remove Coil from Basket
  const handleRemoveCoilFromBasket = (basketId: string, batchNo: string) => {
    Swal.fire({
      title: "ยืนยันนำฟิล์มสลิตออกจากตะกร้า?",
      text: `ต้องการเบิกนำแถบเหล็กสลิต Batch ${batchNo} ออกจากตะกร้า ${basketId} ใช่หรือไม่?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: "ยืนยันการนำออก",
      cancelButtonText: "ยกเลิก"
    }).then((result) => {
      if (result.isConfirmed) {
        deleteInboundByBatchesFromCloud([batchNo]).catch(console.error);
        setSpaceData((prev) =>
          prev.map((b) => {
            if (b.buildingId !== activeBuildingId) return b;
            return {
              ...b,
              rows: b.rows.map((r) => ({
                ...r,
                baskets: r.baskets.map((bk) => {
                  if (bk.id === basketId) {
                    const remainingCoils = bk.coils.filter((c) => c.batch !== batchNo);
                    const remainingWidthMm = calculateBasketTotalWidthMm(remainingCoils);
                    let newStatus: BasketItem["status"] =
                      remainingCoils.length === 0
                        ? "available"
                        : remainingWidthMm >= 2000
                        ? "full"
                        : "occupied";
                    if (bk.status === "maintenance") newStatus = "maintenance";

                    const updated = {
                      ...bk,
                      coils: remainingCoils,
                      status: newStatus,
                      lastUpdated: new Date().toISOString().replace("T", " ").slice(0, 16)
                    };
                    if (selectedBasket?.id === basketId) setSelectedBasket(updated);
                    return updated;
                  }
                  return bk;
                })
              }))
            };
          })
        );

        Swal.fire({
          icon: "success",
          title: "นำฟิล์มสลิตออกสำเร็จ",
          timer: 1400,
          showConfirmButton: false,
          toast: true,
          position: "top-end"
        });
      }
    });
  };

  // Handler: Add Coil to Basket
  const handleAddCoilToBasket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBasket) return;
    if (!newCoilBatch.trim()) {
      Swal.fire({ icon: "error", title: "กรุณาระบุ Batch Number", text: "โปรดป้อนรหัสบาร์โค้ด Batch ของฟิล์มสลิต" });
      return;
    }

    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 16);
    const newCoil: SlitCoilItem = {
      batch: newCoilBatch.trim().toUpperCase(),
      spec: newCoilSpec,
      grade: newCoilGrade,
      weightKg: Number(newCoilWeight) || 900,
      inboundDate: nowStr,
      machine: newCoilMachine
    };

    const currentWidthMm = calculateBasketTotalWidthMm(selectedBasket.coils);
    const projectedWidthMm = calculateBasketTotalWidthMm([...selectedBasket.coils, newCoil]);

    if (projectedWidthMm > 2000) {
      Swal.fire({
        icon: "warning",
        title: "หน้ากว้างสะสมรวมเกิน 2.00 เมตร!",
        text: `ไม่สามารถเพิ่ม Batch ${newCoil.batch} ลงตะกร้า ${selectedBasket.id} ได้ เนื่องจากหน้ากว้างสะสมรวม (${(projectedWidthMm / 1000).toFixed(2)} ม. จากเดิม ${(currentWidthMm / 1000).toFixed(2)} ม.) เกินพิกัด 2.00 เมตร`,
        confirmButtonColor: "#e11d48",
        confirmButtonText: "รับทราบ"
      });
      return;
    }

    const specParts = (newCoilSpec || "").split("x");
    const certThickness = specParts[0]?.trim() || "-";
    const widthVal = specParts[1]?.trim() || "-";
    saveInboundRecordToCloud({
      id: `IN-${newCoil.batch}-${Date.now()}`,
      mode: "inbound",
      scanTimestamp: nowStr,
      batch: newCoil.batch,
      machine: newCoilMachine || "SM01",
      location: selectedBasket.id,
      storageLocation: selectedBasket.id,
      weightKg: newCoil.weightKg,
      unrestricted: `${newCoil.weightKg.toLocaleString()} kg`,
      certThickness,
      width: widthVal,
      grade: newCoilGrade || "-",
      hasSapData: false,
      conditionText: "รับเข้าคลังเรียบร้อย",
    }).catch(console.error);

    setSpaceData((prev) =>
      prev.map((b) => {
        if (b.buildingId !== activeBuildingId) return b;
        return {
          ...b,
          rows: b.rows.map((r) => ({
            ...r,
            baskets: r.baskets.map((bk) => {
              if (bk.id === selectedBasket.id) {
                const updatedCoils = [...bk.coils, newCoil];
                const totalWidthMm = calculateBasketTotalWidthMm(updatedCoils);
                let newStatus: BasketItem["status"] = totalWidthMm >= 2000 ? "full" : "occupied";
                if (bk.status === "maintenance") newStatus = "maintenance";

                const updated = {
                  ...bk,
                  coils: updatedCoils,
                  status: newStatus,
                  lastUpdated: nowStr
                };
                setSelectedBasket(updated);
                return updated;
              }
              return bk;
            })
          }))
        };
      })
    );

    setIsAddCoilModalOpen(false);
    setNewCoilBatch("");
    Swal.fire({
      icon: "success",
      title: "บรรจุฟิล์มสลิตลงตะกร้าสำเร็จ",
      text: `เพิ่ม Batch ${newCoil.batch} ลงในตะกร้า ${selectedBasket.id} แล้ว`,
      timer: 1600,
      showConfirmButton: false,
      toast: true,
      position: "top-end"
    });
  };

  // Handler: Add New Row to Current Building (Requirement 1)
  const handleAddNewRow = async () => {
    const { value: formValues } = await Swal.fire({
      title: `เพิ่มแถวใหม่ใน ${currentBuilding.buildingNameTh}`,
      html: `
        <div class="text-left space-y-3 p-1 font-sans">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">รหัสแถว (เช่น E, F, G หรือ AA):</label>
            <input id="swal-row-id" class="w-full p-2 border border-slate-300 rounded-lg text-sm uppercase font-mono font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="E" maxlength="4" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">จำนวนตะกร้าตั้งต้นในแถวนี้ (ค่าเริ่มต้น 10 ตะกร้า):</label>
            <input id="swal-basket-count" type="number" min="1" max="50" value="10" class="w-full p-2 border border-slate-300 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500" />
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: "สร้างแถวใหม่",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#0891b2",
      cancelButtonColor: "#64748b",
      preConfirm: () => {
        const rowIdInput = document.getElementById("swal-row-id") as HTMLInputElement;
        const countInput = document.getElementById("swal-basket-count") as HTMLInputElement;
        const rowId = rowIdInput?.value?.trim().toUpperCase();
        const basketCount = parseInt(countInput?.value || "10", 10);
        if (!rowId) {
          Swal.showValidationMessage("กรุณาระบุรหัสแถว");
          return false;
        }
        return { rowId, basketCount: isNaN(basketCount) || basketCount <= 0 ? 10 : basketCount };
      }
    });

    if (formValues) {
      const ok = addNewRowToBuilding(activeBuildingId, formValues.rowId, formValues.basketCount);
      if (!ok) {
        Swal.fire({
          icon: "error",
          title: "ไม่สามารถเพิ่มแถวได้",
          text: `แถว ${formValues.rowId} มีอยู่แล้วใน ${currentBuilding.buildingNameTh}`
        });
        return;
      }
      setSpaceData(
        loadSpaceDataFromInventory(
          effectiveInbound,
          effectivePickLists,
          effectiveOutbound,
          propSapMasterMap,
          statusOverrides
        )
      );
      Swal.fire({
        icon: "success",
        title: "เพิ่มแถวสำเร็จ",
        text: `สร้างแถว ${formValues.rowId} พร้อมตะกร้า ${formValues.basketCount} ใบ ใน ${currentBuilding.buildingNameTh} เรียบร้อย`,
        timer: 1600,
        showConfirmButton: false,
        toast: true,
        position: "top-end"
      });
    }
  };

  // Handler: Add Basket to Row (Requirement 1)
  const handleAddBasketToRow = (rowId: string) => {
    const newBasket = addBasketToRow(activeBuildingId, rowId);
    if (newBasket) {
      setSpaceData(
        loadSpaceDataFromInventory(
          effectiveInbound,
          effectivePickLists,
          effectiveOutbound,
          propSapMasterMap,
          statusOverrides
        )
      );
      Swal.fire({
        icon: "success",
        title: "เพิ่มตะกร้าสำเร็จ",
        text: `เพิ่มตะกร้า ${newBasket.id} ในแถว ${rowId} เรียบร้อย`,
        timer: 1500,
        showConfirmButton: false,
        toast: true,
        position: "top-end"
      });
    }
  };

  // Handler: Delete Empty Basket from Row
  const handleDeleteEmptyBasket = (basketId: string, rowId: string) => {
    if (selectedBasket && selectedBasket.coils.length > 0) {
      Swal.fire({
        icon: "error",
        title: "ไม่สามารถลบตะกร้าได้",
        text: "ตะกร้านี้ยังมีสินค้าบรรจุอยู่ กรุณานำสินค้าออกก่อนทำการลบ"
      });
      return;
    }

    Swal.fire({
      title: "ยืนยันลบตะกร้า?",
      text: `ต้องการลบตะกร้า ${basketId} ออกจากแถว ${rowId} ใช่หรือไม่?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: "ยืนยันการลบ",
      cancelButtonText: "ยกเลิก"
    }).then((result) => {
      if (result.isConfirmed) {
        removeBasketFromRow(activeBuildingId, rowId, basketId);
        setIsDetailModalOpen(false);
        setSelectedBasket(null);
        setSpaceData(
          loadSpaceDataFromInventory(
            effectiveInbound,
            effectivePickLists,
            effectiveOutbound,
            propSapMasterMap,
            statusOverrides
          )
        );
        Swal.fire({
          icon: "success",
          title: "ลบตะกร้าเรียบร้อย",
          timer: 1400,
          showConfirmButton: false,
          toast: true,
          position: "top-end"
        });
      }
    });
  };

  // Handler: Add New Basket to Current Building
  const handleCreateNewBasket = (e: React.FormEvent) => {
    e.preventDefault();
    const basketNumberClean = newBasketNo.trim().padStart(2, "0");
    const newBasketId = `${activeBuildingId}-${newBasketRowId}${basketNumberClean}`;

    // Check if ID exists
    let exists = false;
    currentBuilding.rows.forEach((r) => {
      r.baskets.forEach((bk) => {
        if (bk.id.toLowerCase() === newBasketId.toLowerCase()) exists = true;
      });
    });

    if (exists) {
      Swal.fire({ icon: "error", title: "รหัสตะกร้าซ้ำ", text: `ตะกร้า ${newBasketId} มีอยู่แล้วในระบบ` });
      return;
    }

    ensureBasketInMasterLayout(activeBuildingId, newBasketRowId, newBasketId);
    setSpaceData(
      loadSpaceDataFromInventory(
        effectiveInbound,
        effectivePickLists,
        effectiveOutbound,
        propSapMasterMap,
        statusOverrides
      )
    );

    setIsAddBasketModalOpen(false);
    setNewBasketNo("");
    Swal.fire({
      icon: "success",
      title: "เพิ่มตะกร้าจัดเก็บสำเร็จ",
      text: `สร้างตะกร้าใหม่รหัส ${newBasketId} ในอาคาร ${activeBuildingId} แถว ${newBasketRowId} เรียบร้อย`,
      timer: 1600,
      showConfirmButton: false,
      toast: true,
      position: "top-end"
    });
  };

  // Helper: Status badge color & width-based calculation
  const getStatusBadge = (status: BasketItem["status"], coils: SlitCoilItem[] = []) => {
    if (status === "maintenance") {
      return {
        label: "ปิดซ่อมบำรุง",
        bg: "bg-rose-500/15 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30",
        dot: "bg-rose-500"
      };
    }

    const totalWidthMm = calculateBasketTotalWidthMm(coils);

    if (coils.length === 0) {
      return {
        label: "ว่าง",
        bg: "bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
        dot: "bg-emerald-500"
      };
    } else if (totalWidthMm >= 2000) {
      return {
        label: "เต็ม",
        bg: "bg-rose-500/15 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30",
        dot: "bg-rose-500"
      };
    } else {
      return {
        label: "ใช้งาน",
        bg: "bg-amber-500/15 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30",
        dot: "bg-amber-500"
      };
    }
  };

  return (
    <div className="w-full space-y-2.5 sm:space-y-6 pb-12 text-slate-800 dark:text-slate-100">
      {/* High-level Space Sub-View Switcher */}
      <div className="grid grid-cols-2 sm:flex sm:flex-nowrap items-center gap-1 sm:gap-2 p-1 sm:p-1.5 bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <button
          type="button"
          onClick={() => setSpaceSubView("warehouse_baskets")}
          className={`flex-1 py-1.5 px-2 sm:py-2.5 sm:px-4 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-black transition-all flex items-center justify-center gap-1 sm:gap-2 ${
            spaceSubView === "warehouse_baskets"
              ? "bg-slate-900 dark:bg-cyan-500 text-white shadow-md"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Boxes size={13} className="shrink-0 sm:w-4 sm:h-4" />
          <span className="truncate sm:hidden">พื้นที่อาคาร</span>
          <span className="hidden sm:inline">คลังจัดเก็บตะกร้าเหล็กสลิต (อาคาร H, F, E9, E10, I)</span>
        </button>

        <button
          type="button"
          onClick={() => setSpaceSubView("machine_staging")}
          className={`flex-1 py-1.5 px-2 sm:py-2.5 sm:px-4 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-black transition-all flex items-center justify-center gap-1 sm:gap-2 ${
            spaceSubView === "machine_staging"
              ? "bg-slate-900 dark:bg-cyan-500 text-white shadow-md"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Cpu size={13} className="shrink-0 sm:w-4 sm:h-4" />
          <span className="truncate sm:hidden">พื้นที่หน้าเครื่อง</span>
          <span className="hidden sm:inline">พื้นที่วางวัตถุดิบรอผลิตหน้าเครื่องจักร (TM 1-14 / CF 1, 2, 4, 5)</span>
        </button>
      </div>

      {spaceSubView === "machine_staging" ? (
        <MachineStagingArea isThai={isThai} />
      ) : (
        <>
          {/* Top Header & All Storage Areas Combined Summary Card */}
          <div className="relative overflow-hidden rounded-xl sm:rounded-2xl bg-gradient-to-r from-slate-900 via-sky-950 to-blue-900 p-3 sm:p-6 md:p-8 text-white shadow-xl border border-cyan-500/30">
            <div className="absolute -right-12 -bottom-12 opacity-10 pointer-events-none hidden sm:block">
              <Boxes size={280} />
            </div>

            <div className="relative z-10 flex flex-nowrap sm:flex-wrap items-center justify-between gap-2 sm:gap-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <h1 className="text-sm sm:text-lg md:text-2xl font-extrabold tracking-tight text-white flex items-center gap-2 shrink-0">
                  <span>พื้นที่จัดเก็บเหล็กสลิต</span>
                </h1>
                <div className="hidden sm:flex items-center gap-2 text-xs sm:text-sm font-bold text-cyan-300 bg-cyan-950/80 px-3 py-1 rounded-lg border border-cyan-500/30">
                  <Layers size={15} className="text-cyan-400 shrink-0" />
                  <span>สรุปปริมาณพื้นที่จัดเก็บเหล็กสลิตรวมทุกพื้นที่ (อาคาร H, F, E9, E10, I)</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold shrink-0">
                <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/10 backdrop-blur-md text-cyan-300 border border-cyan-400/30 whitespace-nowrap">
                  ตะกร้า {allStorageAreasSummary.totalUsedBaskets.toLocaleString()}/{allStorageAreasSummary.totalBaskets.toLocaleString()} ({allStorageAreasSummary.basketPercent}%)
                </span>
              </div>
            </div>

            <div className="relative z-10 grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-3 mt-2.5 pt-2.5 sm:mt-6 sm:pt-6 border-t border-white/10">
              {/* 1. พื้นที่จัดเก็บทั้งหมด (ตัน) */}
              <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 flex flex-col justify-between">
                <div className="text-slate-300 text-[10px] sm:text-xs font-semibold truncate">
                  <span className="sm:hidden">ความจุรวม</span>
                  <span className="hidden sm:inline">พื้นที่จัดเก็บทั้งหมด (ตัน)</span>
                </div>
                <div className="mt-0.5 sm:mt-1.5 font-mono text-sm sm:text-xl md:text-2xl font-black text-white tabular-nums leading-tight">
                  {allStorageAreasSummary.totalMaxCapacityTons.toLocaleString()}{" "}
                  <span className="text-[9.5px] sm:text-xs font-normal text-slate-300">ตัน</span>
                </div>
              </div>

              {/* 2. พื้นที่ใช้ไป (ตัน) */}
              <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 flex flex-col justify-between">
                <div className="text-amber-300 text-[10px] sm:text-xs font-semibold truncate">
                  <span className="sm:hidden">ใช้ไป</span>
                  <span className="hidden sm:inline">พื้นที่ใช้ไป (ตัน)</span>
                </div>
                <div className="mt-0.5 sm:mt-1.5 font-mono text-sm sm:text-xl md:text-2xl font-black text-amber-300 tabular-nums leading-tight">
                  {allStorageAreasSummary.totalUsedSpaceTons.toLocaleString(undefined, { maximumFractionDigits: 3 })}{" "}
                  <span className="text-[9.5px] sm:text-xs font-normal text-slate-300">ตัน</span>
                </div>
              </div>

              {/* 3. พื้นที่คงเหลือ (ตัน) */}
              <div
                className={`backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border flex flex-col justify-between ${
                  allStorageAreasSummary.totalRemainingSpaceTons < 0
                    ? "bg-rose-500/20 border-rose-400/40"
                    : "bg-white/10 border-white/15"
                }`}
              >
                <div
                  className={`text-[10px] sm:text-xs font-semibold truncate ${
                    allStorageAreasSummary.totalRemainingSpaceTons < 0
                      ? "text-rose-300"
                      : "text-emerald-300"
                  }`}
                >
                  <span className="sm:hidden">คงเหลือ</span>
                  <span className="hidden sm:inline">พื้นที่คงเหลือ (ตัน)</span>
                </div>
                <div
                  className={`mt-0.5 sm:mt-1.5 font-mono text-sm sm:text-xl md:text-2xl font-black tabular-nums leading-tight ${
                    allStorageAreasSummary.totalRemainingSpaceTons < 0
                      ? "text-rose-400"
                      : "text-emerald-400"
                  }`}
                >
                  {allStorageAreasSummary.totalRemainingSpaceTons.toLocaleString(undefined, { maximumFractionDigits: 3 })}{" "}
                  <span className="text-[9.5px] sm:text-xs font-normal text-slate-300">ตัน</span>
                </div>
              </div>

              {/* 4. จำนวนตะกร้า */}
              <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 flex flex-col justify-between col-span-1">
                <div className="text-sky-300 text-[10px] sm:text-xs font-semibold truncate">
                  จำนวนตะกร้า
                </div>
                <div className="mt-0.5 sm:mt-1.5 font-mono text-sm sm:text-xl md:text-2xl font-black text-sky-400 tabular-nums leading-tight">
                  {allStorageAreasSummary.totalBaskets.toLocaleString()}{" "}
                  <span className="text-[9.5px] sm:text-xs font-normal text-slate-300">ใบ</span>
                </div>
              </div>

              {/* 5. จำนวนแถบ */}
              <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 flex flex-col justify-between col-span-2 sm:col-span-1">
                <div className="text-indigo-300 text-[10px] sm:text-xs font-semibold truncate">
                  จำนวนแถบ
                </div>
                <div className="mt-0.5 sm:mt-1.5 font-mono text-sm sm:text-xl md:text-2xl font-black text-indigo-300 tabular-nums leading-tight">
                  {allStorageAreasSummary.totalCoils.toLocaleString()}{" "}
                  <span className="text-[9.5px] sm:text-xs font-normal text-slate-300">แถบ</span>
                </div>
              </div>
            </div>
          </div>

      {/* Building Tabs Switcher & Building Space Summary Cards */}
      <div className="bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl p-2 sm:p-4 shadow-md border border-slate-200 dark:border-slate-800">
        <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 px-1 py-2 mb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
            <Building2 size={15} className="text-cyan-500" />
            <span>ปริมาณพื้นที่รวมทั้งหมดของแต่ละอาคาร & เลือกอาคารคลังสินค้า</span>
          </div>
          <div className="text-xs font-medium text-slate-400">
            คลิกการ์ดอาคารเพื่อดูเลย์เอาต์ หรือกดแก้ไขเพื่อกำหนดพื้นที่จัดเก็บสูงสุด (ตัน)
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-1.5 sm:gap-3">
          {buildingTabSummaries.map((tab, idx) => {
            const isActive = tab.buildingId === activeBuildingId;
            const isNegativeRemaining = tab.remainingSpaceTons < 0;
            const isEditingCap = editingCapacityBuildingId === tab.buildingId;
            const isLastOddItem = idx === buildingTabSummaries.length - 1 && buildingTabSummaries.length % 2 === 1;

            return (
              <div
                key={tab.buildingId}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setActiveBuildingId(tab.buildingId);
                  setSelectedRowId("all");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveBuildingId(tab.buildingId);
                    setSelectedRowId("all");
                  }
                }}
                className={`group flex flex-col justify-between p-2 sm:p-3.5 rounded-xl transition-all border text-left relative overflow-hidden cursor-pointer ${
                  isLastOddItem ? "col-span-2 sm:col-span-1" : ""
                } ${
                  isActive
                    ? "bg-gradient-to-br from-cyan-500/15 via-blue-500/10 to-indigo-500/15 dark:from-cyan-950/80 dark:to-blue-900/60 border-cyan-500 dark:border-cyan-400 shadow-md ring-1 sm:ring-2 ring-cyan-500/20"
                    : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                {/* Card Header: Building Name & Basket Occupancy % */}
                <div className="flex items-center justify-between w-full pb-1 mb-1 sm:pb-2 sm:mb-2 border-b border-slate-200/70 dark:border-slate-700/70">
                  <span className={`text-xs sm:text-base font-black ${isActive ? "text-cyan-600 dark:text-cyan-300" : "text-slate-800 dark:text-slate-100"}`}>
                    {tab.buildingNameTh}
                  </span>
                  <span className={`text-[10px] sm:text-[11px] font-bold px-1.5 py-0.2 sm:px-2 sm:py-0.5 rounded-full ${
                    isActive ? "bg-cyan-500 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                  }`}>
                    {tab.percent}%
                  </span>
                </div>

                {/* 5 Building Summary Metrics */}
                <div className="w-full space-y-1 sm:space-y-1.5 text-[10px] sm:text-xs">
                  {/* ข้อ 1: พื้นที่จัดเก็บอาคาร = ตัน (แก้ไข/กำหนดเองได้) */}
                  <div
                    className="px-1.5 py-1 sm:p-1.5 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/70"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">
                        <span className="sm:hidden">1.ความจุ:</span>
                        <span className="hidden sm:inline">1. พื้นที่จัดเก็บอาคาร:</span>
                      </span>
                      <div className="flex items-center gap-1">
                        {!isEditingCap && (
                          <span className="sm:hidden font-mono font-black text-[10.5px] text-slate-900 dark:text-white tabular-nums">
                            {tab.maxCapacityTons.toLocaleString()} ตัน
                          </span>
                        )}
                        {!isEditingCap && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCapacityBuildingId(tab.buildingId);
                              setEditingCapacityValue(String(tab.maxCapacityTons));
                            }}
                            className="sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto transition-opacity duration-200 text-[9px] sm:text-[10px] font-bold px-1 sm:px-1.5 py-0.2 sm:py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 cursor-pointer"
                            title="ตั้งค่าความจุสูงสุดของอาคาร (ตัน)"
                          >
                            แก้ไข
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditingCap ? (
                      <div className="mt-1 sm:mt-1.5 flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editingCapacityValue}
                          onChange={(e) => setEditingCapacityValue(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveBuildingCapacity(tab.buildingId);
                            } else if (e.key === "Escape") {
                              setEditingCapacityBuildingId(null);
                            }
                          }}
                          autoFocus
                          className="w-full px-1.5 py-0.5 sm:px-2 sm:py-1 text-[10.5px] sm:text-xs font-mono font-bold rounded bg-white dark:bg-slate-800 border border-cyan-500 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveBuildingCapacity(tab.buildingId);
                          }}
                          className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[9.5px] sm:text-[10px] font-bold shrink-0 cursor-pointer"
                        >
                          บันทึก
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCapacityBuildingId(null);
                          }}
                          className="px-1 py-0.5 sm:px-1.5 sm:py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[9.5px] sm:text-[10px] font-bold shrink-0 cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <div className="hidden sm:block mt-0.5 font-mono font-black text-sm text-slate-900 dark:text-white tabular-nums">
                        {tab.maxCapacityTons.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">ตัน</span>
                      </div>
                    )}
                  </div>

                  {/* ข้อ 2: พื้นที่ใช้ไป */}
                  <div className="flex items-center justify-between px-1.5 py-0.5 sm:py-1 rounded-lg bg-white/50 dark:bg-slate-900/40">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      <span className="sm:hidden">2.ใช้ไป:</span>
                      <span className="hidden sm:inline">2. พื้นที่ใช้ไป:</span>
                    </span>
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                      {tab.usedSpaceTons.toLocaleString(undefined, { maximumFractionDigits: 3 })} <span className="text-[9.5px] sm:text-[10px] font-normal">ตัน</span>
                    </span>
                  </div>

                  {/* ข้อ 3: พื้นที่คงเหลือ (แสดงค่าติดลบเมื่อพื้นที่ใช้ไป > พื้นที่จัดเก็บ) */}
                  <div
                    className={`flex items-center justify-between px-1.5 py-0.5 sm:py-1 rounded-lg border ${
                      isNegativeRemaining
                        ? "bg-rose-500/10 dark:bg-rose-950/50 border-rose-500/40"
                        : "bg-emerald-500/10 dark:bg-emerald-950/30 border-emerald-500/20"
                    }`}
                  >
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      <span className="sm:hidden">3.คงเหลือ:</span>
                      <span className="hidden sm:inline">3. พื้นที่คงเหลือ:</span>
                    </span>
                    <span
                      className={`font-mono font-black tabular-nums ${
                        isNegativeRemaining
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {tab.remainingSpaceTons.toLocaleString(undefined, { maximumFractionDigits: 3 })} <span className="text-[9.5px] sm:text-[10px] font-normal">ตัน</span>
                    </span>
                  </div>

                  {/* ข้อ 4 & 5: จำนวนตะกร้า & จำนวนแถบ */}
                  <div className="flex items-center justify-between px-1.5 py-0.5 sm:py-1 rounded-lg bg-white/50 dark:bg-slate-900/40">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      <span className="sm:hidden">4.ตะกร้า:</span>
                      <span className="hidden sm:inline">4. จำนวนตะกร้า:</span>
                    </span>
                    <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400 tabular-nums">
                      {tab.totalBaskets.toLocaleString()} <span className="text-[9.5px] sm:text-[10px] font-normal text-slate-500 dark:text-slate-400">ตะกร้า</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between px-1.5 py-0.5 sm:py-1 rounded-lg bg-white/50 dark:bg-slate-900/40">
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      <span className="sm:hidden">5.แถบ:</span>
                      <span className="hidden sm:inline">5. จำนวนแถบ:</span>
                    </span>
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {tab.totalCoils.toLocaleString()} <span className="text-[9.5px] sm:text-[10px] font-normal text-slate-500 dark:text-slate-400">แถบ</span>
                    </span>
                  </div>
                </div>

                {/* Footer: Basket Usage & Progress Bar */}
                <div className="mt-1.5 pt-1.5 sm:mt-3 sm:pt-2 border-t border-slate-200/70 dark:border-slate-700/70 w-full space-y-1">
                  <div className="flex justify-between text-[9.5px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                    <span>ใช้งาน {tab.usedBaskets}/{tab.totalBaskets} ตะกร้า</span>
                    {isNegativeRemaining && (
                      <span className="text-rose-600 dark:text-rose-400 font-bold">เกินความจุ!</span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-1 sm:h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isNegativeRemaining
                          ? "bg-rose-600"
                          : tab.percent >= 85
                          ? "bg-purple-500"
                          : tab.percent >= 50
                          ? "bg-cyan-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(isNegativeRemaining ? 100 : tab.percent, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter Bar & Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl p-2 sm:p-3.5 shadow-md border border-slate-200 dark:border-slate-800 space-y-1.5 sm:space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-1.5 sm:gap-2.5">
          {/* Left: Row Selector & Status Filter Pills */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
            {/* Compact Row Selector Dropdown */}
            <div className="flex items-center gap-1 sm:gap-1.5 w-full sm:w-auto shrink-0">
              <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1 shrink-0">
                <SlidersHorizontal size={11} className="sm:w-3 sm:h-3" />
                <span>แถว:</span>
              </span>

              <select
                value={selectedRowId}
                onChange={(e) => setSelectedRowId(e.target.value)}
                className="flex-1 sm:flex-initial px-2 py-0.5 sm:px-3 sm:py-1.5 h-7 sm:h-auto rounded-lg sm:rounded-xl text-[10.5px] sm:text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 dark:focus:ring-cyan-400 transition-all cursor-pointer shadow-2xs hover:bg-slate-200 dark:hover:bg-slate-700/80"
              >
                <option value="all" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-medium">
                  ทุกแถว ({currentBuilding.rows.length} แถว)
                </option>
                {currentBuilding.rows.map((row) => (
                  <option
                    key={row.rowId}
                    value={row.rowId}
                    className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-medium"
                  >
                    {row.rowNameTh} ({row.baskets.length} ตะกร้า)
                  </option>
                ))}
              </select>
            </div>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block mx-1" />

            {/* Status Filter Pills (Single clean scrollable row on mobile) */}
            <div className="flex flex-nowrap sm:flex-wrap items-center gap-1 text-[9.5px] sm:text-xs overflow-x-auto scrollbar-none pb-0.5 sm:pb-0">
              <span className="font-bold text-slate-400 uppercase text-[9.5px] sm:text-[11px] mr-0.5 shrink-0">สถานะ:</span>

              <button
                type="button"
                onClick={() => setSelectedStatus("all")}
                className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md font-semibold transition-all shrink-0 whitespace-nowrap ${
                  selectedStatus === "all"
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                }`}
              >
                ทั้งหมด
              </button>

              <button
                type="button"
                onClick={() => setSelectedStatus("available")}
                className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md font-semibold transition-all flex items-center gap-1 shrink-0 whitespace-nowrap ${
                  selectedStatus === "available"
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>ว่าง</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStatus("occupied")}
                className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md font-semibold transition-all flex items-center gap-1 shrink-0 whitespace-nowrap ${
                  selectedStatus === "occupied"
                    ? "bg-amber-600 text-white"
                    : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>ใช้งาน</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStatus("full")}
                className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md font-semibold transition-all flex items-center gap-1 shrink-0 whitespace-nowrap ${
                  selectedStatus === "full"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                <span>เต็ม</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStatus("maintenance")}
                className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md font-semibold transition-all flex items-center gap-1 shrink-0 whitespace-nowrap ${
                  selectedStatus === "maintenance"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                <span>ซ่อมบำรุง</span>
              </button>
            </div>
          </div>

          {/* Right: View Density Toggle & Search Box & Add Row */}
          <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto sm:ml-auto">
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] sm:text-xs font-bold shrink-0">
              <button
                type="button"
                onClick={() => setIsCompactView(true)}
                className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md transition-all flex items-center gap-1 ${
                  isCompactView
                    ? "bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
                title="มุมมองกะทัดรัด (รองรับ 50+ ตะกร้าต่อแถว)"
              >
                <Grid size={11} className="sm:w-3 sm:h-3" />
                <span className="sm:hidden">กะทัดรัด</span>
                <span className="hidden sm:inline">มุมมองกะทัดรัด (50+)</span>
              </button>
              <button
                type="button"
                onClick={() => setIsCompactView(false)}
                className={`px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md transition-all flex items-center gap-1 ${
                  !isCompactView
                    ? "bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
                title="มุมมองปกติ"
              >
                <span className="sm:hidden">ปกติ</span>
                <span className="hidden sm:inline">มุมมองปกติ</span>
              </button>
            </div>

            <div className="relative flex-1 sm:w-40 min-w-0">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="ค้นหา..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-6 pr-6 py-0.5 sm:py-1 h-7 sm:h-auto rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10.5px] sm:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Action Button: Add Row (Desktop only, hidden on Mobile) */}
            <button
              type="button"
              onClick={handleAddNewRow}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-xs shrink-0"
              title={`เพิ่มแถวใหม่ใน ${currentBuilding.buildingNameTh}`}
            >
              <Plus size={13} />
              <span>เพิ่มแถวใหม่</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Storage Row & Basket Layout Matrix (Master Layout with live stock mapping) */}
      <div className="space-y-3 sm:space-y-6">
        {filteredRows.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl p-6 sm:p-12 text-center border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
            <Boxes size={36} className="mx-auto text-slate-300 dark:text-slate-600 sm:w-12 sm:h-12" />
            <h3 className="text-sm sm:text-lg font-bold text-slate-700 dark:text-slate-200">ไม่พบข้อมูลตะกร้าจัดเก็บ</h3>
            <p className="hidden sm:block text-xs text-slate-500 max-w-md mx-auto">
              ไม่พบตะกร้าที่ตรงกับเงื่อนไขการกรองใน {currentBuilding.buildingNameTh} ลองเปลี่ยนคำค้นหาหรือเลือกตัวกรองสถานะอื่น
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedRowId("all");
                setSelectedStatus("all");
                setSearchQuery("");
              }}
              className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold hover:bg-slate-200 text-slate-700 dark:text-slate-200"
            >
              <RotateCcw size={13} />
              <span>ล้างตัวกรองทั้งหมด</span>
            </button>
          </div>
        ) : (
          filteredRows.map((row) => {
            const rowCoilCount = row.baskets.reduce((acc, b) => acc + b.coils.length, 0);
            const rowTotalKg = row.baskets.reduce((acc, b) => acc + b.coils.reduce((s, c) => s + c.weightKg, 0), 0);

            return (
              <div
                key={row.rowId}
                className="bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl p-2.5 sm:p-5 shadow-lg border border-slate-200 dark:border-slate-800 space-y-2.5 sm:space-y-4"
              >
                {/* Row Header */}
                <div className="flex flex-wrap items-center justify-between pb-2 sm:pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white font-black text-[11px] sm:text-sm flex items-center justify-center shadow-md shrink-0">
                      {row.rowId}
                    </div>
                    <div>
                      <h3 className="text-xs sm:text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 sm:gap-2">
                        <span>{row.rowNameTh}</span>
                        <span className="hidden sm:inline text-xs font-normal text-slate-400">({row.rowNameEn})</span>
                      </h3>
                      {row.descriptionTh && (
                        <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400">{row.descriptionTh}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
                    <div className="flex items-center gap-1.5 sm:gap-3 text-[10px] sm:text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 px-2 py-0.5 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 whitespace-nowrap">
                      <span>ตะกร้า: <strong className="text-cyan-600 dark:text-cyan-400">{row.baskets.length}</strong></span>
                      <span>•</span>
                      <span><strong className="text-amber-600 dark:text-amber-400">{rowCoilCount} แถบ</strong> <span className="hidden xs:inline">({rowTotalKg.toLocaleString()} kg)</span></span>
                    </div>

                    {/* Add Basket to Row Button (Desktop only, hidden on Mobile) */}
                    <button
                      type="button"
                      onClick={() => handleAddBasketToRow(row.rowId)}
                      className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-all shadow-xs whitespace-nowrap"
                      title={`เพิ่มตะกร้าใหม่ใน ${row.rowNameTh}`}
                    >
                      <Plus size={12} />
                      <span>เพิ่มตะกร้าในแถว</span>
                    </button>
                  </div>
                </div>

                {/* Basket Grid Matrix */}
                <div className={`grid gap-1.5 sm:gap-2 ${
                  isCompactView
                    ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12"
                    : "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4"
                }`}>
                  {row.baskets.map((basket) => {
                    const badge = getStatusBadge(basket.status, basket.coils);

                    return (
                      <div
                        key={basket.id}
                        onClick={() => {
                          setSelectedBasket(basket);
                          setIsDetailModalOpen(true);
                        }}
                        title={`${basket.id} • ${badge.label} • ${basket.coils.length} แถบ`}
                        className={`group relative rounded-xl ${
                          isCompactView
                            ? "px-1 pt-1.5 pb-2 sm:px-1.5 sm:pt-2 sm:pb-2.5 text-xs flex flex-col items-center justify-center min-h-[46px] sm:min-h-[54px]"
                            : "px-2.5 py-2 sm:px-3.5 sm:py-3 text-xs sm:text-sm flex items-center justify-between gap-1.5 sm:gap-2 min-h-[48px] sm:min-h-[58px]"
                        } transition-all duration-150 cursor-pointer border overflow-hidden ${
                          badge.label === "ว่าง"
                            ? "bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-50/90 border-emerald-200/90 dark:border-emerald-800/90 hover:border-emerald-400"
                            : badge.label === "เต็ม"
                            ? "bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-50/90 border-rose-200/90 dark:border-rose-800/90 hover:border-rose-400"
                            : badge.label === "ใช้งาน"
                            ? "bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-50/90 border-amber-200/90 dark:border-amber-800/90 hover:border-amber-400"
                            : "bg-rose-50/20 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60 opacity-80"
                        } shadow-xs hover:shadow-md transform hover:-translate-y-0.5`}
                      >
                        {/* Distinct Bottom Charging Progress Bar */}
                        {(() => {
                          const totalWidthMeters = calculateBasketTotalWidthMeters(basket.coils);
                          const fillPercent = Math.min(Math.round((totalWidthMeters / 2) * 100), 100);
                          const barColor = badge.label === "ว่าง"
                            ? "bg-emerald-500"
                            : badge.label === "เต็ม"
                            ? "bg-rose-600 animate-pulse"
                            : "bg-amber-500";
                          return (
                            <div className="absolute left-0 right-0 bottom-0 h-1 sm:h-1.5 bg-slate-200/70 dark:bg-slate-700/70 overflow-hidden rounded-b-xl">
                              <div
                                className={`h-full transition-all duration-500 ${barColor}`}
                                style={{ width: `${Math.max(fillPercent, basket.coils.length > 0 ? 10 : 0)}%` }}
                              />
                            </div>
                          );
                        })()}

                        {isCompactView ? (
                          /* Compact View (50+): Full Basket Name and Status vertically stacked without truncation */
                          <div className="relative z-10 flex flex-col items-center justify-center w-full gap-0.5 sm:gap-1 text-center select-none">
                            <span className="text-[11px] sm:text-[13px] font-black text-slate-800 dark:text-slate-100 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors whitespace-nowrap leading-none tracking-tight">
                              {basket.id}
                            </span>
                            <span className={`inline-flex items-center gap-0.5 sm:gap-1 px-1.5 py-0.5 text-[8.5px] sm:text-[9px] rounded-full font-bold border ${badge.bg} whitespace-nowrap leading-none`}>
                              <span className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${badge.dot}`} />
                              <span>{badge.label}</span>
                            </span>
                          </div>
                        ) : (
                          /* Normal View: Spacious horizontal flex */
                          <>
                            <div className="relative z-10 flex items-center gap-1.5 sm:gap-2 min-w-0">
                              <span className="text-xs md:text-sm font-black text-slate-800 dark:text-slate-100 group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors whitespace-nowrap">
                                {basket.id}
                              </span>
                              {basket.coils.length > 0 && (
                                <span className="text-xs text-slate-400 font-medium whitespace-nowrap hidden sm:inline">
                                  ({basket.coils.length} แถบ)
                                </span>
                              )}
                            </div>
                            <div className="relative z-10 flex items-center gap-1 shrink-0">
                              <span className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs rounded-full font-bold border ${badge.bg}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                                <span className="whitespace-nowrap">{badge.label}</span>
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: BASKET DETAILS & COIL MANAGEMENT MODAL                          */}
      {/* ========================================================================= */}
      {isDetailModalOpen && selectedBasket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-sky-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cyan-500/20">
              <div className="flex items-center gap-3 min-w-0 whitespace-nowrap overflow-x-auto scrollbar-none pl-1">
                <div className="text-white font-black text-base shrink-0">
                  {formatShortBasketName(selectedBasket.id)}
                </div>
                <div className="flex items-center gap-2.5 min-w-0 whitespace-nowrap">
                  <span className="text-xs text-slate-300 whitespace-nowrap">
                    อาคาร {selectedBasket.buildingId} - แถว {selectedBasket.rowId}
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap hidden md:inline">
                    • อัปเดต: {selectedBasket.lastUpdated || "-"}
                  </span>
                </div>
              </div>

              {/* Status Badge & Quick Maintenance Button in Header */}
              <div className="flex items-center gap-3 shrink-0">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(selectedBasket.status).bg}`}>
                  <span className={`w-2 h-2 rounded-full ${getStatusBadge(selectedBasket.status).dot}`} />
                  <span>{getStatusBadge(selectedBasket.status).label}</span>
                </span>

                <button
                  type="button"
                  onClick={() => handleUpdateBasketStatus(selectedBasket.id, selectedBasket.status === "maintenance" ? (selectedBasket.coils.length === 0 ? "available" : "occupied") : "maintenance")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                    selectedBasket.status === "maintenance"
                      ? "bg-rose-500 text-white border-rose-600"
                      : "bg-white/10 text-white border-white/20 hover:bg-white/20"
                  }`}
                >
                  ปิดซ่อมบำรุง
                </button>

                <button
                  type="button"
                  onClick={() => setIsDetailModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/15 transition-colors shrink-0 ml-1"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content Body */}
            <div className="p-6 space-y-6 overflow-y-auto">

              {/* Slit Coils List in this Basket */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Layers size={16} className="text-cyan-500" />
                    <span>รายการแถบเหล็กสลิตที่จัดเก็บในตะกร้านี้ ({selectedBasket.coils.length} แถบ)</span>
                  </h4>
                </div>

                {selectedBasket.coils.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 text-xs">
                    ตะกร้านี้ยังไม่มีรายการฟิล์มสลิตจัดเก็บ
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                          <th className="p-3 text-center w-12">ลำดับ</th>
                          <th className="p-3">ชื่อสินค้า</th>
                          <th className="p-3">BATCH</th>
                          <th className="p-3">ความหนา</th>
                          <th className="p-3">หน้ากว้าง</th>
                          <th className="p-3 text-right">น้ำหนักทั้งหมด</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedBasket.coils.map((coil, idx) => {
                          const specParts = coil.spec.split("x").map(s => s.trim());
                          const rawThickness = specParts[0] || "-";
                          const rawWidth = specParts[1] || "-";
                          const thicknessNum = parseFloat(rawThickness);
                          const widthNum = parseFloat(rawWidth);
                          const thickness = !isNaN(thicknessNum) ? thicknessNum.toFixed(2) : rawThickness;
                          const width = !isNaN(widthNum) ? widthNum.toFixed(2) : rawWidth;
                          const formattedSpec =
                            rawThickness !== "-" || rawWidth !== "-"
                              ? `${thickness} x ${width}`
                              : coil.spec;
                          return (
                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="p-3 text-center font-bold text-slate-500">{idx + 1}</td>
                              <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                <div>{formattedSpec}</div>
                                <div className="text-[10px] text-slate-400">เกรด: {coil.grade} • เครื่อง: {coil.machine}</div>
                              </td>
                              <td className="p-3 font-mono font-bold text-cyan-600 dark:text-cyan-400">{coil.batch}</td>
                              <td className="p-3 font-medium text-slate-700 dark:text-slate-300">{thickness}</td>
                              <td className="p-3 font-medium text-slate-700 dark:text-slate-300">{width}</td>
                              <td className="p-3 text-right font-black text-slate-900 dark:text-slate-100">{coil.weightKg.toLocaleString()} kg</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                {selectedBasket.coils.length === 0 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteEmptyBasket(selectedBasket.id, selectedBasket.rowId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 text-xs font-bold transition-all"
                    title="ลบตะกร้าว่างนี้ออกจากแถว"
                  >
                    <Trash2 size={13} />
                    <span>ลบตะกร้านี้ออกจากแถว</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsDetailModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-slate-900 dark:bg-cyan-500 text-white font-bold text-xs hover:bg-slate-800 dark:hover:bg-cyan-400 transition-colors"
              >
                <span>ปิดหน้าต่าง</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADD NEW BASKET MODAL                                            */}
      {/* ========================================================================= */}
      {isAddBasketModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-cyan-600 to-blue-700 text-white flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Plus size={18} />
                <span>สร้างตะกร้าจัดเก็บใหม่ ({currentBuilding.buildingNameTh})</span>
              </h3>
              <button type="button" onClick={() => setIsAddBasketModalOpen(false)} className="text-white/80 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewBasket} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  เลือกแถว (Row):
                </label>
                <select
                  value={newBasketRowId}
                  onChange={(e) => setNewBasketRowId(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  <option value="A">แถว A (Row A)</option>
                  <option value="B">แถว B (Row B)</option>
                  <option value="C">แถว C (Row C)</option>
                  <option value="D">แถว D (Row D)</option>
                  <option value="E">แถว E (Row E)</option>
                  <option value="F">แถว F (Row F)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  หมายเลขตะกร้า (Basket No. e.g. 06, 07):
                </label>
                <input
                  type="text"
                  placeholder="เช่น 06 หรือ 07"
                  value={newBasketNo}
                  onChange={(e) => setNewBasketNo(e.target.value)}
                  required
                  className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  รหัสตะกร้าจะถูกสร้างให้อัตโนมัติ: <strong className="text-cyan-600">{activeBuildingId}-{newBasketRowId}{(newBasketNo || "00").padStart(2, "0")}</strong>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  ความจุน้ำหนักสูงสุด (Max Capacity kg):
                </label>
                <input
                  type="number"
                  value={newBasketMaxKg}
                  onChange={(e) => setNewBasketMaxKg(Number(e.target.value))}
                  required
                  min={500}
                  max={10000}
                  className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddBasketModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md"
                >
                  บันทึกตะกร้าใหม่
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        </>
      )}

    </div>
  );
};

export default SpaceManagementView;
