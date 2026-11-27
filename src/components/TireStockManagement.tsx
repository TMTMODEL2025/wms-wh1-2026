/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Disc,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Search,
  Trash2,
  X,
  Wifi,
  WifiOff,
  RefreshCw,
  ChevronDown,
  ChevronUp,
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
  MhTireComponentType,
  MhTireQtyByType,
  MhTireUnitCostByType,
  MH_TIRE_COMPONENT_TYPES,
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
import {
  ForkliftWheelPositionDiagram,
  getWheelPositionOptionsForVehicle,
} from "./ForkliftWheelPositionDiagram";

interface TireStockManagementProps {
  vehicles: Vehicle[];
}

const TIRE_TYPE_QTY_FIELDS: Array<{
  type: MhTireComponentType;
  key: keyof MhTireQtyByType;
  label: string;
}> = [
  { type: "ยางนอก", key: "outer", label: "1. ยางนอก" },
  { type: "ยางใน", key: "inner", label: "2. ยางใน" },
  { type: "ยางรอง", key: "flap", label: "3. ยางรอง" },
];

const EMPTY_QTY_BY_TYPE: Record<keyof MhTireQtyByType, string> = {
  outer: "",
  inner: "",
  flap: "",
};

interface StockTireCatalogItem {
  key: string;
  tireSize: string;
  brand: string;
  inbound: number;
  outbound: number;
  balance: number;
  hasTypeBreakdown: boolean;
  byType: MhTireQtyByType;
  compatibleVehicles: string[];
  knownTireTypes: MhTireComponentType[];
  latestUnitCost: number;
  latestUnitCostByType: MhTireUnitCostByType;
}

interface OutboundTireSelection {
  selectedTypes: MhTireComponentType[];
  qtyByType: Record<keyof MhTireQtyByType, string>;
}

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
  const [selectedTireTypes, setSelectedTireTypes] = useState<MhTireComponentType[]>([]);
  const [tireTypeError, setTireTypeError] = useState<boolean>(false);
  const [tireQtyByType, setTireQtyByType] = useState<Record<keyof MhTireQtyByType, string>>({
    ...EMPTY_QTY_BY_TYPE,
  });
  const [tireQtyError, setTireQtyError] = useState<string>("");
  const [tireUnitCostByType, setTireUnitCostByType] = useState<
    Record<keyof MhTireUnitCostByType, string>
  >({
    ...EMPTY_QTY_BY_TYPE,
  });
  const [tireUnitCostError, setTireUnitCostError] = useState<string>("");
  const [tireSupplierOrInvoice, setTireSupplierOrInvoice] = useState<string>("");
  const [selectedCompatibleVehicles, setSelectedCompatibleVehicles] = useState<string[]>([]);
  const [vehicleFilterQuery, setVehicleFilterQuery] = useState<string>("");
  const [tireVehicleId, setTireVehicleId] = useState<string>("");
  const [outboundSelections, setOutboundSelections] = useState<
    Record<string, OutboundTireSelection>
  >({});
  const [showAllStockInOutbound, setShowAllStockInOutbound] = useState<boolean>(false);
  const [outboundSelectionError, setOutboundSelectionError] = useState<string>("");
  const [tireWheelPosition, setTireWheelPosition] = useState<string>("");
  const [isOutboundExpanded, setIsOutboundExpanded] = useState<boolean>(false);
  const [isOutboundCollapsing, setIsOutboundCollapsing] = useState<boolean>(false);
  const [isInboundCollapsing, setIsInboundCollapsing] = useState<boolean>(false);
  const [outboundVehiclePromptError, setOutboundVehiclePromptError] = useState<boolean>(false);
  const [tireOperatingHours, setTireOperatingHours] = useState<string>("");
  const [tireTechnicianName, setTireTechnicianName] = useState<string>(() =>
    getDefaultTechnicianName()
  );
  const [tireNotes, setTireNotes] = useState<string>("");
  const [tireSearchQuery, setTireSearchQuery] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedRecordIds, setExpandedRecordIds] = useState<string[]>([]);

  const toggleExpandedRecord = (id: string) => {
    setExpandedRecordIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Cloud-backed Combobox dropdown visibility
  const [showSizeDropdown, setShowSizeDropdown] = useState<boolean>(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState<boolean>(false);
  const [showNotesDropdown, setShowNotesDropdown] = useState<boolean>(false);
  const sizeComboRef = useRef<HTMLDivElement | null>(null);
  const brandComboRef = useRef<HTMLDivElement | null>(null);
  const notesComboRef = useRef<HTMLDivElement | null>(null);
  const outboundVehicleSelectRef = useRef<HTMLSelectElement | null>(null);
  const collapseTimerRef = useRef<number | null>(null);

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
    setSelectedTireTypes([]);
    setTireTypeError(false);
    setTireQtyByType({ ...EMPTY_QTY_BY_TYPE });
    setTireQtyError("");
    setTireUnitCostByType({ ...EMPTY_QTY_BY_TYPE });
    setTireUnitCostError("");
    setTireSupplierOrInvoice("");
    setSelectedCompatibleVehicles([]);
    setVehicleFilterQuery("");
    setTireVehicleId("");
    setOutboundSelections({});
    setShowAllStockInOutbound(false);
    setOutboundSelectionError("");
    setTireWheelPosition("");
    setIsOutboundExpanded(false);
    setIsOutboundCollapsing(false);
    setIsInboundCollapsing(false);
    setOutboundVehiclePromptError(false);
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    setTireOperatingHours("");
    setTireTechnicianName(getDefaultTechnicianName());
    setTireNotes("");
    setShowSizeDropdown(false);
    setShowBrandDropdown(false);
    setShowNotesDropdown(false);
  };

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  const collapseOutboundExpanded = () => {
    if (!isOutboundExpanded || isOutboundCollapsing) return;
    setIsOutboundCollapsing(true);
    collapseTimerRef.current = window.setTimeout(() => {
      setIsOutboundExpanded(false);
      setIsOutboundCollapsing(false);
      collapseTimerRef.current = null;
    }, 560);
  };

  const collapseInboundModal = () => {
    if (!isTireModalOpen || tireTxType !== "Inbound" || isInboundCollapsing) return;
    setIsInboundCollapsing(true);
    collapseTimerRef.current = window.setTimeout(() => {
      setIsTireModalOpen(false);
      setIsInboundCollapsing(false);
      collapseTimerRef.current = null;
    }, 560);
  };

  useEffect(() => {
    if (!isTireModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (tireTxType === "Inbound") {
          collapseInboundModal();
        } else if (tireTxType === "Outbound" && isOutboundExpanded) {
          collapseOutboundExpanded();
        } else {
          setIsTireModalOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTireModalOpen, tireTxType, isOutboundExpanded, isOutboundCollapsing, isInboundCollapsing]);

  const toggleTireType = (type: MhTireComponentType) => {
    const field = TIRE_TYPE_QTY_FIELDS.find((f) => f.type === type);
    setSelectedTireTypes((prev) => {
      const exists = prev.includes(type);
      if (exists) {
        if (field) {
          setTireQtyByType((qPrev) => ({ ...qPrev, [field.key]: "" }));
          setTireUnitCostByType((cPrev) => ({ ...cPrev, [field.key]: "" }));
        }
        return prev.filter((item) => item !== type);
      }
      return [...prev, type];
    });
    setTireTypeError(false);
    setTireQtyError("");
    setTireUnitCostError("");
  };

  const handleQtyByTypeChange = (
    key: keyof MhTireQtyByType,
    type: MhTireComponentType,
    rawVal: string
  ) => {
    setTireQtyByType((prev) => ({ ...prev, [key]: rawVal }));
    setTireQtyError("");
    const num = Number(rawVal);
    if (tireTxType === "Inbound" && rawVal !== "" && !isNaN(num) && num > 0) {
      setSelectedTireTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));
      setTireTypeError(false);
    }
  };

  const handleUnitCostByTypeChange = (
    key: keyof MhTireUnitCostByType,
    type: MhTireComponentType,
    rawVal: string
  ) => {
    setTireUnitCostByType((prev) => ({ ...prev, [key]: rawVal }));
    setTireUnitCostError("");
    const num = Number(rawVal);
    if (tireTxType === "Inbound" && rawVal !== "" && !isNaN(num) && num > 0) {
      setSelectedTireTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));
      setTireTypeError(false);
    }
  };

  const parsedQtyByType: MhTireQtyByType = useMemo(() => {
    const toSafeInt = (v: string) => {
      const n = Number(v);
      return v !== "" && !isNaN(n) && n > 0 ? Math.floor(n) : 0;
    };
    return {
      outer: toSafeInt(tireQtyByType.outer),
      inner: toSafeInt(tireQtyByType.inner),
      flap: toSafeInt(tireQtyByType.flap),
    };
  }, [tireQtyByType]);

  const parsedUnitCostByType: MhTireUnitCostByType = useMemo(() => {
    const toSafeCost = (v: string) => {
      const n = Number(v);
      return v !== "" && !isNaN(n) && n >= 0 ? n : 0;
    };
    return {
      outer: toSafeCost(tireUnitCostByType.outer),
      inner: toSafeCost(tireUnitCostByType.inner),
      flap: toSafeCost(tireUnitCostByType.flap),
    };
  }, [tireUnitCostByType]);

  const totalInputTireQty =
    parsedQtyByType.outer + parsedQtyByType.inner + parsedQtyByType.flap;

  const totalInputTireCost =
    parsedQtyByType.outer * parsedUnitCostByType.outer +
    parsedQtyByType.inner * parsedUnitCostByType.inner +
    parsedQtyByType.flap * parsedUnitCostByType.flap;

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

  // Stock balance grouped dynamically by Cloud tireSize records (with per-type breakdown)
  const tireStockBySize = useMemo(() => {
    const map = new Map<
      string,
      {
        inbound: number;
        outbound: number;
        balance: number;
        hasTypeBreakdown: boolean;
        byType: MhTireQtyByType;
      }
    >();
    tireRecords.forEach((tr) => {
      const key = (tr.tireSize || "").trim();
      if (!key || key === "-") return;
      const current = map.get(key) || {
        inbound: 0,
        outbound: 0,
        balance: 0,
        hasTypeBreakdown: false,
        byType: { outer: 0, inner: 0, flap: 0 },
      };
      const sign = tr.transactionType === "Inbound" ? 1 : -1;
      if (tr.transactionType === "Inbound") {
        current.inbound += Number(tr.qty) || 0;
      } else {
        current.outbound += Number(tr.qty) || 0;
      }
      if (tr.qtyByType) {
        current.hasTypeBreakdown = true;
        current.byType.outer += sign * (Number(tr.qtyByType.outer) || 0);
        current.byType.inner += sign * (Number(tr.qtyByType.inner) || 0);
        current.byType.flap += sign * (Number(tr.qtyByType.flap) || 0);
      }
      current.balance = Math.max(0, current.inbound - current.outbound);
      map.set(key, current);
    });
    map.forEach((stats) => {
      stats.byType.outer = Math.max(0, stats.byType.outer);
      stats.byType.inner = Math.max(0, stats.byType.inner);
      stats.byType.flap = Math.max(0, stats.byType.flap);
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

  // Catalog of distinct (tireSize, brand) stock items with balance, per-type stock, bound vehicles, and latest unit costs
  const stockTireCatalog = useMemo<StockTireCatalogItem[]>(() => {
    const map = new Map<
      string,
      {
        tireSize: string;
        brand: string;
        inbound: number;
        outbound: number;
        hasTypeBreakdown: boolean;
        byType: MhTireQtyByType;
        compatibleVehicles: Set<string>;
        knownTireTypes: Set<MhTireComponentType>;
        hasLatestInboundCost: boolean;
        latestUnitCost: number;
        latestUnitCostByType: MhTireUnitCostByType;
      }
    >();

    tireRecords.forEach((tr) => {
      const cleanSize = (tr.tireSize || "").trim();
      const cleanBrand = (tr.brand || "").trim();
      if (!cleanSize || cleanSize === "-" || !cleanBrand || cleanBrand === "-") return;

      const key = `${cleanSize}|||${cleanBrand}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          tireSize: cleanSize,
          brand: cleanBrand,
          inbound: 0,
          outbound: 0,
          hasTypeBreakdown: false,
          byType: { outer: 0, inner: 0, flap: 0 },
          compatibleVehicles: new Set<string>(),
          knownTireTypes: new Set<MhTireComponentType>(),
          hasLatestInboundCost: false,
          latestUnitCost: 0,
          latestUnitCostByType: { outer: 0, inner: 0, flap: 0 },
        };
        map.set(key, entry);
      }

      const sign = tr.transactionType === "Inbound" ? 1 : -1;
      if (tr.transactionType === "Inbound") {
        entry.inbound += Number(tr.qty) || 0;
        if (!entry.hasLatestInboundCost) {
          entry.hasLatestInboundCost = true;
          const fallbackUnit = Number(tr.unitCost) || 0;
          entry.latestUnitCost = fallbackUnit;
          if (tr.unitCostByType) {
            entry.latestUnitCostByType = {
              outer: Number(tr.unitCostByType.outer) || fallbackUnit,
              inner: Number(tr.unitCostByType.inner) || fallbackUnit,
              flap: Number(tr.unitCostByType.flap) || fallbackUnit,
            };
          } else {
            entry.latestUnitCostByType = {
              outer: fallbackUnit,
              inner: fallbackUnit,
              flap: fallbackUnit,
            };
          }
        }
      } else {
        entry.outbound += Number(tr.qty) || 0;
      }

      if (tr.qtyByType) {
        entry.hasTypeBreakdown = true;
        entry.byType.outer += sign * (Number(tr.qtyByType.outer) || 0);
        entry.byType.inner += sign * (Number(tr.qtyByType.inner) || 0);
        entry.byType.flap += sign * (Number(tr.qtyByType.flap) || 0);
        if (tr.transactionType === "Inbound") {
          TIRE_TYPE_QTY_FIELDS.forEach((f) => {
            if ((Number(tr.qtyByType?.[f.key]) || 0) > 0) {
              entry!.knownTireTypes.add(f.type);
            }
          });
        }
      }

      if (Array.isArray(tr.tireTypes)) {
        tr.tireTypes.forEach((t) => entry!.knownTireTypes.add(t));
      }

      if (Array.isArray(tr.compatibleVehicles)) {
        tr.compatibleVehicles.forEach((vid) => {
          const cleanVid = vid.trim();
          if (cleanVid) entry!.compatibleVehicles.add(cleanVid);
        });
      }
    });

    const list: StockTireCatalogItem[] = [];
    map.forEach((entry, key) => {
      const boundVehicles =
        entry.compatibleVehicles.size > 0
          ? Array.from(entry.compatibleVehicles)
          : [...(compatibleVehiclesBySize.get(entry.tireSize) || [])];

      list.push({
        key,
        tireSize: entry.tireSize,
        brand: entry.brand,
        inbound: entry.inbound,
        outbound: entry.outbound,
        balance: Math.max(0, entry.inbound - entry.outbound),
        hasTypeBreakdown: entry.hasTypeBreakdown,
        byType: {
          outer: Math.max(0, entry.byType.outer),
          inner: Math.max(0, entry.byType.inner),
          flap: Math.max(0, entry.byType.flap),
        },
        compatibleVehicles: boundVehicles,
        knownTireTypes: MH_TIRE_COMPONENT_TYPES.filter((t) => entry.knownTireTypes.has(t)),
        latestUnitCost: entry.latestUnitCost,
        latestUnitCostByType: entry.latestUnitCostByType,
      });
    });

    return list.sort((a, b) => {
      if ((a.balance > 0) !== (b.balance > 0)) return a.balance > 0 ? -1 : 1;
      const sizeCmp = a.tireSize.localeCompare(b.tireSize, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (sizeCmp !== 0) return sizeCmp;
      return a.brand.localeCompare(b.brand, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [tireRecords, compatibleVehiclesBySize]);

  const boundTireCountByVehicle = useMemo(() => {
    const counts = new Map<string, number>();
    stockTireCatalog.forEach((item) => {
      item.compatibleVehicles.forEach((vid) => {
        counts.set(vid, (counts.get(vid) || 0) + 1);
      });
    });
    return counts;
  }, [stockTireCatalog]);

  const boundTiresForSelectedVehicle = useMemo(() => {
    if (!tireVehicleId) return [];
    return stockTireCatalog.filter((item) => item.compatibleVehicles.includes(tireVehicleId));
  }, [stockTireCatalog, tireVehicleId]);

  const otherStockTiresForOutbound = useMemo(() => {
    if (!tireVehicleId) return [];
    return stockTireCatalog.filter((item) => !item.compatibleVehicles.includes(tireVehicleId));
  }, [stockTireCatalog, tireVehicleId]);

  const handleOutboundVehicleChange = (nextVehicleId: string) => {
    setTireVehicleId(nextVehicleId);
    setTireWheelPosition("");
    setIsOutboundExpanded(false);
    setIsOutboundCollapsing(false);
    setOutboundVehiclePromptError(false);
    setOutboundSelections({});
    setShowAllStockInOutbound(false);
    setOutboundSelectionError("");
  };

  const handleDiagramWheelPositionSelect = (position: string) => {
    if (!tireVehicleId) {
      setOutboundVehiclePromptError(true);
      outboundVehicleSelectRef.current?.focus();
      return;
    }
    setOutboundVehiclePromptError(false);
    setTireWheelPosition(position);
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    setIsOutboundCollapsing(false);
    setIsOutboundExpanded(true);
  };

  const selectedOutboundVehicle = useMemo(
    () => (tireVehicleId ? vehicleById.get(tireVehicleId) : undefined),
    [tireVehicleId, vehicleById]
  );

  const activeWheelPositionOptions = useMemo(
    () => getWheelPositionOptionsForVehicle(tireVehicleId, selectedOutboundVehicle),
    [tireVehicleId, selectedOutboundVehicle]
  );

  const toggleOutboundTireItem = (item: StockTireCatalogItem) => {
    setOutboundSelections((prev) => {
      if (prev[item.key]) {
        const next = { ...prev };
        delete next[item.key];
        return next;
      }
      // Smart default: pick the single known/stocked tire component type, or default to ยางนอก with qty 1
      let defaultType: MhTireComponentType = "ยางนอก";
      if (item.knownTireTypes.length === 1) {
        defaultType = item.knownTireTypes[0];
      } else if (item.hasTypeBreakdown) {
        const stockedFields = TIRE_TYPE_QTY_FIELDS.filter((f) => item.byType[f.key] > 0);
        if (stockedFields.length > 0) {
          defaultType = stockedFields[0].type;
        }
      } else if (item.knownTireTypes.length > 0) {
        defaultType = item.knownTireTypes[0];
      }
      const defaultField = TIRE_TYPE_QTY_FIELDS.find((f) => f.type === defaultType);
      const nextQty: Record<keyof MhTireQtyByType, string> = { ...EMPTY_QTY_BY_TYPE };
      if (defaultField) {
        nextQty[defaultField.key] = "1";
      }
      return {
        ...prev,
        [item.key]: {
          selectedTypes: [defaultType],
          qtyByType: nextQty,
        },
      };
    });
    setOutboundSelectionError("");
  };

  const toggleOutboundItemComponentType = (itemKey: string, type: MhTireComponentType) => {
    const field = TIRE_TYPE_QTY_FIELDS.find((f) => f.type === type);
    setOutboundSelections((prev) => {
      const current = prev[itemKey];
      if (!current) return prev;
      const exists = current.selectedTypes.includes(type);
      const nextTypes = exists
        ? current.selectedTypes.filter((t) => t !== type)
        : [...current.selectedTypes, type];
      const nextQty = { ...current.qtyByType };
      if (field) {
        if (exists) {
          nextQty[field.key] = "";
        } else if (!nextQty[field.key] || Number(nextQty[field.key]) <= 0) {
          nextQty[field.key] = "1";
        }
      }
      return {
        ...prev,
        [itemKey]: {
          selectedTypes: nextTypes,
          qtyByType: nextQty,
        },
      };
    });
    setOutboundSelectionError("");
  };

  const handleOutboundItemQtyChange = (
    itemKey: string,
    fieldKey: keyof MhTireQtyByType,
    type: MhTireComponentType,
    rawVal: string
  ) => {
    setOutboundSelections((prev) => {
      const current = prev[itemKey];
      if (!current) return prev;
      const num = Number(rawVal);
      const shouldAddType =
        rawVal !== "" && !isNaN(num) && num > 0 && !current.selectedTypes.includes(type);
      return {
        ...prev,
        [itemKey]: {
          selectedTypes: shouldAddType ? [...current.selectedTypes, type] : current.selectedTypes,
          qtyByType: {
            ...current.qtyByType,
            [fieldKey]: rawVal,
          },
        },
      };
    });
    setOutboundSelectionError("");
  };

  const outboundSummary = useMemo(() => {
    const catalogMap = new Map<string, StockTireCatalogItem>(
      stockTireCatalog.map((item) => [item.key, item])
    );
    let selectedItemCount = 0;
    let totalQty = 0;
    let totalCost = 0;

    Object.entries(outboundSelections).forEach(([key, sel]) => {
      const item = catalogMap.get(key);
      if (!item) return;
      selectedItemCount += 1;
      TIRE_TYPE_QTY_FIELDS.forEach((f) => {
        if (!sel.selectedTypes.includes(f.type)) return;
        const n = Number(sel.qtyByType[f.key]);
        const safeQ = sel.qtyByType[f.key] !== "" && !isNaN(n) && n > 0 ? Math.floor(n) : 0;
        if (safeQ > 0) {
          totalQty += safeQ;
          const unitCost = item.latestUnitCostByType[f.key] || item.latestUnitCost || 0;
          totalCost += safeQ * unitCost;
        }
      });
    });

    return { selectedItemCount, totalQty, totalCost };
  }, [outboundSelections, stockTireCatalog]);

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
        (tr.tireTypes || []).join(" ").toLowerCase().includes(q) ||
        (tr.vehicleId || "").toLowerCase().includes(q) ||
        (tr.compatibleVehicles || []).join(" ").toLowerCase().includes(q) ||
        (tr.supplierOrInvoice || "").toLowerCase().includes(q) ||
        tr.technicianOrReceiver.toLowerCase().includes(q)
    );
  }, [tireRecords, tireSearchQuery]);

  const filteredInboundRecords = useMemo(
    () => filteredTireRecords.filter((tr) => tr.transactionType === "Inbound"),
    [filteredTireRecords]
  );

  const filteredOutboundRecords = useMemo(
    () => filteredTireRecords.filter((tr) => tr.transactionType === "Outbound"),
    [filteredTireRecords]
  );

  const handleCreateTireTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTech = tireTechnicianName.trim();
    if (!cleanTech) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);

    if (tireTxType === "Inbound") {
      const cleanSize = tireSize.trim();
      const cleanBrand = tireBrand.trim();
      if (!cleanSize || !cleanBrand) return;

      if (selectedTireTypes.length === 0) {
        setTireTypeError(true);
        return;
      }
      const missingCheckedQty = TIRE_TYPE_QTY_FIELDS.some(
        (f) => selectedTireTypes.includes(f.type) && parsedQtyByType[f.key] < 1
      );
      if (missingCheckedQty || totalInputTireQty < 1) {
        setTireQtyError("กรุณาระบุจำนวน (เส้น) ให้ครบทุกประเภทยางที่ติ๊กเลือก");
        return;
      }
      const missingCheckedCost = TIRE_TYPE_QTY_FIELDS.some((f) => {
        if (!selectedTireTypes.includes(f.type)) return false;
        const raw = tireUnitCostByType[f.key];
        const val = Number(raw);
        return raw === "" || isNaN(val) || val < 0;
      });
      if (missingCheckedCost) {
        setTireUnitCostError("กรุณาระบุราคาต่อเส้น (บาท) ให้ครบทุกประเภทยางที่ติ๊กเลือก");
        return;
      }
      if (!tireSupplierOrInvoice.trim()) return;

      const txId = `TIRE-${now.getFullYear()}-${String(tireRecords.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-4)}`;
      const safeQtyByType: MhTireQtyByType = {
        outer: !selectedTireTypes.includes("ยางนอก") ? 0 : parsedQtyByType.outer,
        inner: !selectedTireTypes.includes("ยางใน") ? 0 : parsedQtyByType.inner,
        flap: !selectedTireTypes.includes("ยางรอง") ? 0 : parsedQtyByType.flap,
      };
      const safeUnitCostByType: MhTireUnitCostByType = {
        outer: safeQtyByType.outer > 0 ? parsedUnitCostByType.outer : 0,
        inner: safeQtyByType.inner > 0 ? parsedUnitCostByType.inner : 0,
        flap: safeQtyByType.flap > 0 ? parsedUnitCostByType.flap : 0,
      };
      const safeQty = Math.max(1, safeQtyByType.outer + safeQtyByType.inner + safeQtyByType.flap);
      const safeTotalCost =
        safeQtyByType.outer * safeUnitCostByType.outer +
        safeQtyByType.inner * safeUnitCostByType.inner +
        safeQtyByType.flap * safeUnitCostByType.flap;
      const safeAvgUnit = Math.round(safeTotalCost / safeQty);
      const orderedTireTypes: MhTireComponentType[] = TIRE_TYPE_QTY_FIELDS.filter(
        (f) => safeQtyByType[f.key] > 0
      ).map((f) => f.type);

      const newTireRecord: MhTireStockRecord = {
        id: txId,
        transactionNo: txId,
        date: dateStr,
        time: timeStr,
        transactionType: "Inbound",
        tireSize: cleanSize,
        brand: cleanBrand,
        tireTypes: orderedTireTypes.length > 0 ? orderedTireTypes : undefined,
        qtyByType: safeQtyByType,
        unitCostByType: safeUnitCostByType,
        qty: safeQty,
        unitCost: safeAvgUnit,
        totalCost: safeTotalCost,
        supplierOrInvoice: tireSupplierOrInvoice.trim(),
        compatibleVehicles:
          selectedCompatibleVehicles.length > 0
            ? [...selectedCompatibleVehicles].sort((a, b) => {
                const aIsTrailer = isTrailerId(a);
                const bIsTrailer = isTrailerId(b);
                if (aIsTrailer !== bIsTrailer) return aIsTrailer ? 1 : -1;
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
              })
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
      const qtyBreakdownText = TIRE_TYPE_QTY_FIELDS.filter((f) => safeQtyByType[f.key] > 0)
        .map((f) => `${f.type} ${safeQtyByType[f.key]}`)
        .join(", ");
      const tireTypePrefix = qtyBreakdownText ? `[${qtyBreakdownText}] ` : "";

      void appendWmsActivityLog({
        module: "สต๊อกยางโฟล์คลิฟท์",
        sectionId: "fleet_ops",
        reference: txId,
        activity: `รับเข้ายาง ${tireTypePrefix}${cleanSize} (${cleanBrand}) รวม ${safeQty} เส้น (${newTireRecord.supplierOrInvoice || "-"}${compatSuffix})`,
        status: "Completed",
      });
      return;
    }

    // Outbound: Vehicle-first -> bound tires ticked + per-type quantities
    if (!tireVehicleId || !tireWheelPosition) return;

    const catalogMap = new Map<string, StockTireCatalogItem>(
      stockTireCatalog.map((item) => [item.key, item])
    );
    const selectedEntries = Object.entries(outboundSelections)
      .map(([key, sel]) => ({ item: catalogMap.get(key), sel }))
      .filter(
        (entry): entry is { item: StockTireCatalogItem; sel: OutboundTireSelection } =>
          Boolean(entry.item)
      );

    if (selectedEntries.length === 0) {
      setOutboundSelectionError("กรุณาติ๊กเลือกรายการยางที่ต้องการเบิกอย่างน้อย 1 รายการ");
      return;
    }

    const baseSuffix = Date.now().toString().slice(-4);
    const recordsToCreate: MhTireStockRecord[] = [];

    for (let idx = 0; idx < selectedEntries.length; idx += 1) {
      const { item, sel } = selectedEntries[idx];
      if (sel.selectedTypes.length === 0) {
        setOutboundSelectionError(
          `กรุณาติ๊กเลือกประเภทยาง (ยางนอก / ยางใน / ยางรอง) สำหรับ ${item.tireSize} (${item.brand})`
        );
        return;
      }

      const toInt = (raw: string) => {
        const n = Number(raw);
        return raw !== "" && !isNaN(n) && n > 0 ? Math.floor(n) : 0;
      };
      const safeQtyByType: MhTireQtyByType = {
        outer: sel.selectedTypes.includes("ยางนอก") ? toInt(sel.qtyByType.outer) : 0,
        inner: sel.selectedTypes.includes("ยางใน") ? toInt(sel.qtyByType.inner) : 0,
        flap: sel.selectedTypes.includes("ยางรอง") ? toInt(sel.qtyByType.flap) : 0,
      };

      const missingQty = TIRE_TYPE_QTY_FIELDS.some(
        (f) => sel.selectedTypes.includes(f.type) && safeQtyByType[f.key] < 1
      );
      const safeQty = safeQtyByType.outer + safeQtyByType.inner + safeQtyByType.flap;
      if (missingQty || safeQty < 1) {
        setOutboundSelectionError(
          `กรุณาระบุจำนวน (เส้น) ให้ครบทุกประเภทยางที่ติ๊กเลือกสำหรับ ${item.tireSize} (${item.brand})`
        );
        return;
      }

      const safeUnitCostByType: MhTireUnitCostByType = {
        outer:
          safeQtyByType.outer > 0
            ? item.latestUnitCostByType.outer || item.latestUnitCost || 0
            : 0,
        inner:
          safeQtyByType.inner > 0
            ? item.latestUnitCostByType.inner || item.latestUnitCost || 0
            : 0,
        flap:
          safeQtyByType.flap > 0
            ? item.latestUnitCostByType.flap || item.latestUnitCost || 0
            : 0,
      };
      const safeTotalCost =
        safeQtyByType.outer * safeUnitCostByType.outer +
        safeQtyByType.inner * safeUnitCostByType.inner +
        safeQtyByType.flap * safeUnitCostByType.flap;
      const safeAvgUnit = Math.round(safeTotalCost / safeQty);
      const orderedTireTypes: MhTireComponentType[] = TIRE_TYPE_QTY_FIELDS.filter(
        (f) => safeQtyByType[f.key] > 0
      ).map((f) => f.type);

      const txId = `TIRE-${now.getFullYear()}-${String(tireRecords.length + 1 + idx).padStart(3, "0")}-${baseSuffix}${selectedEntries.length > 1 ? `-${idx + 1}` : ""}`;

      recordsToCreate.push({
        id: txId,
        transactionNo: txId,
        date: dateStr,
        time: timeStr,
        transactionType: "Outbound",
        tireSize: item.tireSize,
        brand: item.brand,
        tireTypes: orderedTireTypes.length > 0 ? orderedTireTypes : undefined,
        qtyByType: safeQtyByType,
        unitCostByType: safeUnitCostByType,
        qty: safeQty,
        unitCost: safeAvgUnit,
        totalCost: safeTotalCost,
        vehicleId: tireVehicleId,
        vehicleNumber: tireVehicleId,
        wheelPosition: tireWheelPosition,
        operatingHours:
          tireOperatingHours !== "" ? Number(tireOperatingHours) || 0 : undefined,
        technicianOrReceiver: cleanTech,
        notes: tireNotes.trim() || undefined,
        updatedAt: `${dateStr} ${timeStr}`,
      });
    }

    setTireRecords((prev) => [...recordsToCreate, ...prev]);
    setIsTireModalOpen(false);
    resetModalFields();

    await Promise.all(recordsToCreate.map((rec) => saveMhTireTransactionToCloud(rec)));

    recordsToCreate.forEach((rec) => {
      const qtyBreakdownText = TIRE_TYPE_QTY_FIELDS.filter(
        (f) => (rec.qtyByType?.[f.key] || 0) > 0
      )
        .map((f) => `${f.type} ${rec.qtyByType?.[f.key]}`)
        .join(", ");
      const tireTypePrefix = qtyBreakdownText ? `[${qtyBreakdownText}] ` : "";

      void appendWmsActivityLog({
        module: "สต๊อกยางโฟล์คลิฟท์",
        sectionId: "fleet_ops",
        reference: rec.transactionNo,
        activity: `เบิกเปลี่ยนยาง ${tireTypePrefix}${rec.tireSize} (${rec.brand}) รวม ${rec.qty} เส้น รถ ${rec.vehicleId || "-"}`,
        status: "Completed",
      });
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
                    {stats.hasTypeBreakdown && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 tabular-nums">
                        {TIRE_TYPE_QTY_FIELDS.map((f) => (
                          <span
                            key={f.key}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-slate-600 dark:text-slate-300"
                          >
                            {f.type}: {stats.byType[f.key]}
                          </span>
                        ))}
                      </div>
                    )}
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

        <div className="p-3 sm:p-4 grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {(["Inbound", "Outbound"] as const).map((panelType) => {
            const isInbound = panelType === "Inbound";
            const panelRecords = isInbound ? filteredInboundRecords : filteredOutboundRecords;
            const panelTotalQty = panelRecords.reduce((sum, tr) => sum + (Number(tr.qty) || 0), 0);

            return (
              <div
                key={panelType}
                className="rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] overflow-hidden min-w-0"
              >
                <div
                  className={`px-3.5 py-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2 ${
                    isInbound
                      ? "bg-emerald-50/70 dark:bg-emerald-950/25"
                      : "bg-sky-50/70 dark:bg-sky-950/25"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                        isInbound
                          ? "bg-emerald-600 text-white"
                          : "bg-[#087eaf] text-white"
                      }`}
                    >
                      {isInbound ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    </span>
                    <h3
                      className={`text-xs font-bold ${
                        isInbound
                          ? "text-emerald-900 dark:text-emerald-200"
                          : "text-sky-900 dark:text-sky-200"
                      }`}
                    >
                      {isInbound ? "รายการรับเข้ายาง (Inbound)" : "รายการเบิกออกยาง (Outbound)"}
                    </h3>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold tabular-nums border ${
                      isInbound
                        ? "bg-white dark:bg-[#0d1b33] text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                        : "bg-white dark:bg-[#0d1b33] text-[#087eaf] dark:text-sky-300 border-sky-200 dark:border-sky-800"
                    }`}
                  >
                    {panelRecords.length.toLocaleString()} รายการ · รวม {isInbound ? "+" : "-"}
                    {panelTotalQty.toLocaleString()} เส้น
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="ts-stats-table w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300">
                        <th className="ts-left font-bold whitespace-nowrap">เลขที่รายการ & วัน-เวลา</th>
                        <th className="ts-center font-bold whitespace-nowrap">ประเภท</th>
                        <th className="ts-left font-bold whitespace-nowrap">ขนาดยาง & ยี่ห้อ</th>
                        <th className="ts-right font-bold whitespace-nowrap">จำนวน (เส้น)</th>
                        <th className="ts-left font-bold whitespace-nowrap">ผู้รับผิดชอบ</th>
                        <th className="ts-center font-bold whitespace-nowrap">เพิ่มเติม</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                      {panelRecords.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="ts-center py-8 text-slate-500 dark:text-slate-400"
                          >
                            {isInbound
                              ? "ยังไม่มีรายการรับเข้ายางในฐานข้อมูล"
                              : "ยังไม่มีรายการเบิกออกยางในฐานข้อมูล"}
                          </td>
                        </tr>
                      ) : (
                        panelRecords.map((tr) => {
                          const isExpanded = expandedRecordIds.includes(tr.id);
                          const activeQtyFields = tr.qtyByType
                            ? TIRE_TYPE_QTY_FIELDS.filter((f) => (tr.qtyByType?.[f.key] || 0) > 0)
                            : [];
                          return (
                            <React.Fragment key={tr.id}>
                              <tr
                                onClick={() => toggleExpandedRecord(tr.id)}
                                className={`cursor-pointer transition-colors ${
                                  isExpanded
                                    ? isInbound
                                      ? "bg-emerald-50/40 dark:bg-emerald-950/20"
                                      : "bg-sky-50/50 dark:bg-[#132544]"
                                    : "hover:bg-slate-50 dark:hover:bg-[#162744]/60"
                                }`}
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
                                      isInbound
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                                        : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800"
                                    }`}
                                  >
                                    {isInbound ? "+ รับเข้าสต๊อก" : "- เบิกเปลี่ยนยาง"}
                                  </span>
                                </td>
                                <td className="ts-left ts-wrap min-w-[120px]">
                                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                                    {tr.tireSize}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                    ยี่ห้อ: {tr.brand}
                                  </div>
                                </td>
                                <td className="ts-right font-bold tabular-nums whitespace-nowrap">
                                  <div
                                    className={
                                      isInbound
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-sky-600 dark:text-sky-400"
                                    }
                                  >
                                    {isInbound ? "+" : "-"}
                                    {tr.qty} เส้น
                                  </div>
                                </td>
                                <td className="ts-left ts-wrap min-w-[110px]">
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    {tr.technicianOrReceiver}
                                  </div>
                                </td>
                                <td
                                  className="ts-center whitespace-nowrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="inline-flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => toggleExpandedRecord(tr.id)}
                                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                                        isExpanded
                                          ? "bg-[#087eaf] text-white border-[#087eaf]"
                                          : "bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:border-[#087eaf] hover:text-[#087eaf] dark:hover:text-sky-300"
                                      }`}
                                      title={isExpanded ? "ซ่อนข้อมูลเพิ่มเติม" : "แสดงข้อมูลเพิ่มเติม"}
                                    >
                                      <span>{isExpanded ? "ซ่อน" : "เพิ่มเติม"}</span>
                                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                    </button>

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
                                          className="px-2 py-1 rounded text-[11px] border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33]"
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
                                  </div>
                                </td>
                              </tr>

                              {isExpanded && (
                                <tr className="bg-slate-50/90 dark:bg-[#0c1930]">
                                  <td colSpan={6} className="px-3 py-2.5">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                                      {/* Detail 1: Tire Type Breakdown & Quantities */}
                                      <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] space-y-1.5">
                                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                          รายละเอียดประเภทยาง & จำนวน
                                        </div>
                                        {activeQtyFields.length > 0 ? (
                                          <div className="space-y-1 tabular-nums">
                                            {activeQtyFields.map((f) => {
                                              const qtyVal = tr.qtyByType?.[f.key] || 0;
                                              const costVal =
                                                tr.unitCostByType?.[f.key] ?? tr.unitCost ?? 0;
                                              return (
                                                <div
                                                  key={f.key}
                                                  className="flex items-center justify-between gap-2 text-[11px]"
                                                >
                                                  <span className="inline-flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-200">
                                                    <Check
                                                      size={11}
                                                      strokeWidth={2.75}
                                                      className="text-emerald-600 dark:text-emerald-400 shrink-0"
                                                    />
                                                    {f.type}
                                                  </span>
                                                  <span className="text-slate-600 dark:text-slate-300">
                                                    {qtyVal.toLocaleString()} เส้น · @
                                                    {costVal.toLocaleString()} บ.
                                                  </span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : tr.tireTypes && tr.tireTypes.length > 0 ? (
                                          <div className="flex flex-wrap gap-1">
                                            {tr.tireTypes.map((tType) => (
                                              <span
                                                key={tType}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                                              >
                                                <Check size={10} strokeWidth={2.75} />
                                                {tType}
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                            ไม่ได้ระบุแยกประเภทยาง
                                          </div>
                                        )}
                                      </div>

                                      {/* Detail 2: Price & Total Cost */}
                                      <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] space-y-1 tabular-nums">
                                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                          ราคา/หน่วย & มูลค่ารวม
                                        </div>
                                        <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                                          {tr.totalCost.toLocaleString()} บาท
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                          เฉลี่ย @{tr.unitCost.toLocaleString()} บาท/เส้น
                                        </div>
                                      </div>

                                      {/* Detail 3: Vehicle / Trailer Info */}
                                      <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] space-y-1.5">
                                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                          {isInbound
                                            ? "รถ / หางลากที่ผูกไว้"
                                            : "รถ / ตำแหน่งล้อที่เปลี่ยน"}
                                        </div>
                                        {isInbound ? (
                                          tr.compatibleVehicles &&
                                          tr.compatibleVehicles.length > 0 ? (
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
                                            <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                              -
                                            </div>
                                          )
                                        ) : (
                                          <div className="space-y-0.5 tabular-nums">
                                            <div className="font-bold text-slate-900 dark:text-slate-100">
                                              รถ {tr.vehicleId || "-"}
                                            </div>
                                            <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                              {tr.wheelPosition || "-"}
                                              {tr.operatingHours
                                                ? ` · ${tr.operatingHours.toLocaleString()} ชม.`
                                                : ""}
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* Detail 4: Source (Supplier/PO) & Notes */}
                                      <div className="p-2.5 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] space-y-1">
                                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                          {isInbound
                                            ? "แหล่งที่มา (Supplier / PO) & หมายเหตุ"
                                            : "หมายเหตุเพิ่มเติม"}
                                        </div>
                                        {isInbound && (
                                          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                            {tr.supplierOrInvoice || "-"}
                                          </div>
                                        )}
                                        <div className="text-[11px] text-slate-700 dark:text-slate-300">
                                          {tr.notes || "-"}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Tire Stock Outbound Stage 1 Modal (Vehicle Selector + Top-Down Wheel Diagram) */}
      {isTireModalOpen && tireTxType === "Outbound" && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/60 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-xl w-full max-w-3xl max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-32px)] flex flex-col min-h-0 overflow-hidden shadow-xl">
            <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1b33] flex justify-between items-center">
              <div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  - เบิกเปลี่ยนยางรถโฟล์คลิฟท์ (Tire Stock Outbound)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  เลือกเบอร์รถและคลิกตำแหน่งล้อบนผังด้านบน เพื่อขยายหน้าจอกรอกรายละเอียดการเบิกเปลี่ยนยาง
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
                    onClick={() => {
                      setIsInboundCollapsing(false);
                      setIsOutboundExpanded(false);
                      setIsOutboundCollapsing(false);
                      setTireTxType("Inbound");
                      setTireTypeError(false);
                      setTireQtyError("");
                      setTireUnitCostError("");
                      setOutboundSelectionError("");
                    }}
                    className="flex-1 py-2 rounded-md font-bold border bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f] hover:border-emerald-500 transition-colors"
                  >
                    + รับเข้ายางใหม่ (Inbound)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTireTxType("Outbound");
                      setTireTypeError(false);
                      setTireQtyError("");
                      setTireUnitCostError("");
                      setOutboundSelectionError("");
                    }}
                    className="flex-1 py-2 rounded-md font-bold border bg-[#087eaf] text-white border-[#087eaf]"
                  >
                    - เบิกเปลี่ยนยาง (Outbound)
                  </button>
                </div>

                {/* Stage 1 (Outbound): Show ONLY Vehicle Selector + Top-Down Wheel Diagram */}
                <div className="sm:col-span-2">
                  <label
                    htmlFor="outbound-vehicle-select"
                    className="block font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    เลือกเบอร์รถโฟล์คลิฟท์ / หางลากที่เปลี่ยนยาง *
                  </label>
                  <select
                    id="outbound-vehicle-select"
                    ref={outboundVehicleSelectRef}
                    value={tireVehicleId}
                    onChange={(e) => handleOutboundVehicleChange(e.target.value)}
                    required
                    className={`w-full px-3 py-2.5 rounded-md border bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 font-semibold focus:outline-none transition-colors ${
                      outboundVehiclePromptError
                        ? "border-amber-500 ring-2 ring-amber-400/30 dark:border-amber-400"
                        : "border-[#087eaf]/50 dark:border-sky-600/60 focus:border-[#087eaf]"
                    }`}
                  >
                    <option value="">— เลือกเบอร์รถโฟล์คลิฟท์ / หางลาก —</option>
                    {drivableVehicles.length > 0 && (
                      <optgroup label="รถใช้งาน / โฟล์คลิฟท์ / หัวลาก">
                        {drivableVehicles.map((v) => {
                          const boundCount = boundTireCountByVehicle.get(v.vehicleId) || 0;
                          return (
                            <option key={v.id} value={v.vehicleId}>
                              {v.vehicleId} - {getVehicleTypeDisplayLabel(v.vehicleType, v)}
                              {v.description ? ` (${v.description})` : ""}
                              {boundCount > 0 ? ` · ผูกยาง ${boundCount} รายการ` : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {trailerVehicles.length > 0 && (
                      <optgroup label="หางลาก / เทรลเลอร์ (TTL)">
                        {trailerVehicles.map((v) => {
                          const boundCount = boundTireCountByVehicle.get(v.vehicleId) || 0;
                          return (
                            <option key={v.id} value={v.vehicleId}>
                              {v.vehicleId} - {getVehicleTypeDisplayLabel(v.vehicleType, v)}
                              {v.description ? ` (${v.description})` : ""}
                              {boundCount > 0 ? ` · ผูกยาง ${boundCount} รายการ` : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                  {outboundVehiclePromptError && (
                    <p className="mt-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      กรุณาเลือกเบอร์รถโฟล์คลิฟท์ / หางลากด้านบนก่อน แล้วคลิกเลือกตำแหน่งล้อบนภาพ
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2 space-y-2">
                  <ForkliftWheelPositionDiagram
                    vehicleId={tireVehicleId}
                    vehicle={selectedOutboundVehicle}
                    selectedPosition={tireWheelPosition}
                    onSelectPosition={handleDiagramWheelPositionSelect}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      {tireVehicleId
                        ? `คลิกเลือกตำแหน่งล้อของรถ ${tireVehicleId} บนภาพด้านบน เพื่อเปิดหน้ากรอกข้อมูลเบิกเปลี่ยนยางแบบเต็มหน้าจอ`
                        : "เลือกเบอร์รถด้านบนก่อน จากนั้นคลิกเลือกตำแหน่งล้อบนภาพเพื่อเปิดฟอร์มกรอกข้อมูล"}
                    </span>
                    {tireVehicleId && tireWheelPosition && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsOutboundCollapsing(false);
                          setIsOutboundExpanded(true);
                        }}
                        className="px-3 py-1.5 rounded-md bg-[#087eaf] hover:bg-[#075985] text-white text-[11px] font-bold transition-colors whitespace-nowrap"
                      >
                        เปิดหน้ากรอกข้อมูล ({tireWheelPosition}) →
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="shrink-0 px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-slate-50/90 dark:bg-[#0d1b33] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTireModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 dark:border-[#1e3a5f] font-semibold bg-white dark:bg-[#111e38]"
                >
                  ปิด
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tire Stock Inbound: Full-Screen Progressive Diagonal Reveal Form Overlay */}
      {isTireModalOpen &&
        tireTxType === "Inbound" &&
        createPortal(
          <div className="fixed inset-0 z-[1100] pointer-events-auto">
            {/* Ambient backdrop scrim */}
            <div
              aria-hidden="true"
              className={`fixed inset-0 bg-slate-950/35 dark:bg-slate-950/55 backdrop-blur-[2px] pointer-events-none ${
                isInboundCollapsing ? "animate-diagonal-scrim-out" : "animate-diagonal-scrim-in"
              }`}
            />

            {/* Layer 1: Leading emerald diagonal curtain */}
            <div
              aria-hidden="true"
              className={`fixed inset-0 bg-gradient-to-br from-emerald-800 via-emerald-600 to-teal-500 dark:from-emerald-950 dark:via-emerald-700 dark:to-teal-600 pointer-events-none ${
                isInboundCollapsing
                  ? "animate-diagonal-collapse-lead"
                  : "animate-diagonal-wave-lead"
              }`}
            />

            {/* Layer 2: Trailing soft-emerald bevel curtain for progressive depth */}
            <div
              aria-hidden="true"
              className={`fixed inset-0 bg-gradient-to-br from-emerald-200/95 via-emerald-100/95 to-white dark:from-emerald-500/40 dark:via-[#0d2c2d] dark:to-[#0d1b33] pointer-events-none ${
                isInboundCollapsing
                  ? "animate-diagonal-collapse-trail"
                  : "animate-diagonal-wave-trail"
              }`}
            />

            {/* Layer 3: Main full-screen progressive diagonal surface */}
            <div
              className={`fixed inset-0 bg-slate-50 dark:bg-[#091529] flex flex-col min-h-0 overflow-hidden ${
                isInboundCollapsing
                  ? "animate-diagonal-collapse-surface"
                  : "animate-diagonal-wave-surface"
              }`}
            >
              {/* Top Bar (Step 1 of Progressive Diagonal Content Reveal) */}
              <div
                className={`shrink-0 px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] flex items-center justify-between gap-4 ${
                  isInboundCollapsing
                    ? "animate-diagonal-zone-exit"
                    : "animate-diagonal-reveal-header"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                    + รับเข้ายางรถโฟล์คลิฟท์ (Tire Stock Inbound)
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    บันทึกลงฐานข้อมูลแยกอิสระ (mh_tire_stock) · ขนาดยางและยี่ห้อที่บันทึกจะเก็บเป็นตัวเลือกบนคลาวด์อัตโนมัติ
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="hidden sm:flex items-center p-0.5 rounded-md bg-slate-100 dark:bg-[#091529] border border-slate-200 dark:border-[#1e3a5f]">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 text-white whitespace-nowrap"
                    >
                      + รับเข้ายางใหม่
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsInboundCollapsing(false);
                        setIsOutboundExpanded(false);
                        setIsOutboundCollapsing(false);
                        setTireTxType("Outbound");
                        setTireTypeError(false);
                        setTireQtyError("");
                        setTireUnitCostError("");
                        setOutboundSelectionError("");
                      }}
                      className="px-3 py-1.5 rounded text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
                    >
                      - เบิกเปลี่ยนยาง
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={collapseInboundModal}
                    className="p-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-[#162744] transition-colors shrink-0"
                    aria-label="ปิดหน้าต่าง"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Expanded Inbound Form Body */}
              <form
                onSubmit={handleCreateTireTransaction}
                className="flex-1 min-h-0 flex flex-col overflow-hidden text-xs"
              >
                <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-10 py-5 sm:py-6">
                  <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Column (7 cols — Step 2): Tire Specs, Component Types, Qty & Unit Cost */}
                    <div
                      className={`lg:col-span-7 space-y-4 ${
                        isInboundCollapsing
                          ? "animate-diagonal-zone-exit"
                          : "animate-diagonal-reveal-left"
                      }`}
                    >
                      <div className="rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] p-4 sm:p-5 space-y-4">
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100 pb-2.5 border-b border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between gap-2">
                          <span>ข้อมูลยางและจำนวนรับเข้า</span>
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            ขนาด · ยี่ห้อ · ประเภท · จำนวนและราคา
                          </span>
                        </div>

                        {/* Tire Size & Brand (2 columns) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
                                        if (selectedCompatibleVehicles.length === 0) {
                                          const knownCompat = compatibleVehiclesBySize.get(sz);
                                          if (knownCompat && knownCompat.length > 0) {
                                            setSelectedCompatibleVehicles(knownCompat);
                                          }
                                        }
                                      }}
                                      className="w-full px-3 py-2 text-left text-xs hover:bg-emerald-50 dark:hover:bg-[#162744] flex items-center justify-between gap-2 border-b last:border-b-0 border-slate-100 dark:border-[#1e3a5f]/60"
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
                                    className="w-full px-3 py-2 text-left text-xs hover:bg-emerald-50 dark:hover:bg-[#162744] text-slate-800 dark:text-slate-200 font-medium border-b last:border-b-0 border-slate-100 dark:border-[#1e3a5f]/60 truncate"
                                  >
                                    {br}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Tire Type Checkboxes (1. ยางนอก, 2. ยางใน, 3. ยางรอง) */}
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <label className="block font-semibold text-slate-700 dark:text-slate-300">
                              ประเภทยาง (เลือกติ๊กถูกได้มากกว่า 1 รายการ) *
                            </label>
                            {selectedTireTypes.length > 0 && (
                              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                เลือกแล้ว {selectedTireTypes.length} รายการ
                              </span>
                            )}
                          </div>
                          <div
                            className={`grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-2.5 rounded-md border transition-colors ${
                              tireTypeError
                                ? "border-rose-400 bg-rose-50/50 dark:border-rose-700 dark:bg-rose-950/20"
                                : "border-slate-200 bg-slate-50/70 dark:border-[#1e3a5f] dark:bg-[#0c1930]/70"
                            }`}
                          >
                            {MH_TIRE_COMPONENT_TYPES.map((tType, idx) => {
                              const checked = selectedTireTypes.includes(tType);
                              return (
                                <label
                                  key={tType}
                                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md border cursor-pointer select-none transition-colors ${
                                    checked
                                      ? "bg-emerald-50 border-emerald-500 text-emerald-900 dark:bg-emerald-950/50 dark:border-emerald-500 dark:text-emerald-200"
                                      : "bg-white border-slate-300 text-slate-700 hover:border-emerald-400 dark:bg-[#0c1930] dark:border-[#1e3a5f] dark:text-slate-200 dark:hover:border-emerald-500"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleTireType(tType)}
                                    className="sr-only"
                                  />
                                  <span
                                    aria-hidden="true"
                                    className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
                                      checked
                                        ? "bg-emerald-600 border-emerald-600 text-white"
                                        : "bg-white border-slate-400 dark:bg-[#111e38] dark:border-slate-500"
                                    }`}
                                  >
                                    {checked && <Check size={12} strokeWidth={3} />}
                                  </span>
                                  <span className="text-xs font-semibold leading-none whitespace-nowrap">
                                    {idx + 1}. {tType}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          {tireTypeError && (
                            <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                              กรุณาติ๊กเลือกประเภทยางอย่างน้อย 1 รายการ (ยางนอก / ยางใน / ยางรอง)
                            </p>
                          )}
                        </div>

                        {/* 3-Column Quantity Inputs Split by Tire Type */}
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <label className="block font-semibold text-slate-700 dark:text-slate-300">
                              ระบุจำนวน (เส้น) แยกตามประเภทยาง *
                            </label>
                            <span
                              className={`text-xs font-bold tabular-nums ${
                                totalInputTireQty > 0
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-slate-500 dark:text-slate-400"
                              }`}
                            >
                              รวมทั้งหมด {totalInputTireQty.toLocaleString()} เส้น
                            </span>
                          </div>
                          <div
                            className={`grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-md border transition-colors ${
                              tireQtyError
                                ? "border-rose-400 bg-rose-50/50 dark:border-rose-700 dark:bg-rose-950/20"
                                : "border-slate-200 bg-slate-50/70 dark:border-[#1e3a5f] dark:bg-[#0c1930]/70"
                            }`}
                          >
                            {TIRE_TYPE_QTY_FIELDS.map((field) => {
                              const isCheckedInbound = selectedTireTypes.includes(field.type);
                              const hasVal = parsedQtyByType[field.key] > 0;
                              return (
                                <div key={field.key} className="space-y-1">
                                  <label className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                    <span>{field.label} (เส้น)</span>
                                    {isCheckedInbound && (
                                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                        *
                                      </span>
                                    )}
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={tireQtyByType[field.key]}
                                    onChange={(e) =>
                                      handleQtyByTypeChange(field.key, field.type, e.target.value)
                                    }
                                    placeholder={`จำนวน${field.type} (เส้น)`}
                                    className={`w-full px-3 py-2 rounded border text-slate-900 dark:text-slate-100 tabular-nums transition-colors ${
                                      isCheckedInbound || hasVal
                                        ? "border-emerald-500 bg-white dark:bg-[#111e38] dark:border-emerald-500"
                                        : "border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                                    }`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          {tireQtyError && (
                            <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                              {tireQtyError}
                            </p>
                          )}
                        </div>

                        {/* 3-Column Unit Cost Inputs Split by Tire Type */}
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <label className="block font-semibold text-slate-700 dark:text-slate-300">
                              ราคาต่อเส้น (บาท) แยกตามประเภทยาง *
                            </label>
                            <span
                              className={`text-xs font-bold tabular-nums ${
                                totalInputTireCost > 0
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-slate-500 dark:text-slate-400"
                              }`}
                            >
                              รวมเป็นเงิน {totalInputTireCost.toLocaleString()} บาท
                            </span>
                          </div>
                          <div
                            className={`grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-md border transition-colors ${
                              tireUnitCostError
                                ? "border-rose-400 bg-rose-50/50 dark:border-rose-700 dark:bg-rose-950/20"
                                : "border-slate-200 bg-slate-50/70 dark:border-[#1e3a5f] dark:bg-[#0c1930]/70"
                            }`}
                          >
                            {TIRE_TYPE_QTY_FIELDS.map((field) => {
                              const isActive =
                                selectedTireTypes.includes(field.type) ||
                                parsedQtyByType[field.key] > 0;
                              const subtotal =
                                parsedQtyByType[field.key] * parsedUnitCostByType[field.key];
                              return (
                                <div key={field.key} className="space-y-1">
                                  <label className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                    <span>{field.label} (บาท/เส้น)</span>
                                    {isActive && (
                                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                        *
                                      </span>
                                    )}
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={tireUnitCostByType[field.key]}
                                    onChange={(e) =>
                                      handleUnitCostByTypeChange(
                                        field.key,
                                        field.type,
                                        e.target.value
                                      )
                                    }
                                    placeholder={`ราคา${field.type} (บาท)`}
                                    className={`w-full px-3 py-2 rounded border text-slate-900 dark:text-slate-100 tabular-nums transition-colors ${
                                      isActive || tireUnitCostByType[field.key] !== ""
                                        ? "border-emerald-500 bg-white dark:bg-[#111e38] dark:border-emerald-500"
                                        : "border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                                    }`}
                                  />
                                  {parsedQtyByType[field.key] > 0 &&
                                    tireUnitCostByType[field.key] !== "" && (
                                      <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums text-right">
                                        รวม {subtotal.toLocaleString()} บาท
                                      </div>
                                    )}
                                </div>
                              );
                            })}
                          </div>
                          {tireUnitCostError && (
                            <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                              {tireUnitCostError}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right Column (5 cols — Steps 3 & 4): Supplier/Recorder & Compatible Vehicles */}
                    <div className="lg:col-span-5 space-y-4">
                      {/* Top Card (Step 3): Supplier, Technician & Notes */}
                      <div
                        className={`rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] p-4 space-y-3.5 ${
                          isInboundCollapsing
                            ? "animate-diagonal-zone-exit"
                            : "animate-diagonal-reveal-right-top"
                        }`}
                      >
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
                          แหล่งที่มาและผู้บันทึก
                        </div>

                        <div>
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

                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            ผู้บันทึก / ช่างผู้รับเข้า *
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
                      </div>

                      {/* Bottom Card (Step 4): Compatible Vehicles & Trailers Selector */}
                      <div
                        className={`rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] p-4 space-y-3 ${
                          isInboundCollapsing
                            ? "animate-diagonal-zone-exit"
                            : "animate-diagonal-reveal-right-bottom"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Truck size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                              รถและหางลากที่ใช้ยางขนาดนี้
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] tabular-nums shrink-0">
                            <span className="font-bold text-emerald-700 dark:text-emerald-400">
                              เลือกแล้ว {selectedCompatibleVehicles.length} คัน
                            </span>
                            {selectedCompatibleVehicles.length > 0 && (
                              <>
                                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                  ·
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setSelectedCompatibleVehicles([])}
                                  className="font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                                >
                                  ล้างทั้งหมด
                                </button>
                              </>
                            )}
                          </div>
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
                                  toggleGroupSelection(
                                    filteredDrivableVehicles.map((v) => v.vehicleId)
                                  )
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
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
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
                                        : "bg-slate-50/50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:border-sky-400 dark:hover:border-sky-500"
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
                        <div className="space-y-1.5 pt-2.5 border-t border-slate-200 dark:border-[#1e3a5f]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                              หางลาก / เทรลเลอร์ (TTL) ({filteredTrailerVehicles.length} หาง)
                            </span>
                            {filteredTrailerVehicles.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  toggleGroupSelection(
                                    filteredTrailerVehicles.map((v) => v.vehicleId)
                                  )
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
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
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
                                        : "bg-slate-50/50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:border-amber-400 dark:hover:border-amber-500"
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
                    </div>
                  </div>
                </div>

                {/* Bottom Action Bar (Step 5 of Progressive Diagonal Reveal) */}
                <div
                  className={`shrink-0 px-4 sm:px-6 py-3.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] flex flex-wrap items-center justify-between gap-3 ${
                    isInboundCollapsing
                      ? "animate-diagonal-zone-exit"
                      : "animate-diagonal-reveal-footer"
                  }`}
                >
                  <div className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                    {totalInputTireQty > 0 ? (
                      <span>
                        รับเข้ารวม{" "}
                        <strong className="text-emerald-700 dark:text-emerald-400">
                          {totalInputTireQty.toLocaleString()} เส้น
                        </strong>
                        {totalInputTireCost > 0 && (
                          <>
                            {" "}
                            · มูลค่ารวม{" "}
                            <strong className="text-slate-900 dark:text-white">
                              {totalInputTireCost.toLocaleString()} บาท
                            </strong>
                          </>
                        )}
                        {selectedCompatibleVehicles.length > 0 && (
                          <>
                            {" "}
                            · ผูกกับรถ{" "}
                            <strong className="text-slate-900 dark:text-white">
                              {selectedCompatibleVehicles.length} คัน
                            </strong>
                          </>
                        )}
                      </span>
                    ) : (
                      <span>กรุณาระบุขนาดยาง ยี่ห้อ ประเภท และจำนวนยางที่ต้องการรับเข้า</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={collapseInboundModal}
                      className="px-4 py-2 rounded-md border border-slate-300 dark:border-[#1e3a5f] font-semibold bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744]"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs transition-colors"
                    >
                      {totalInputTireQty > 0
                        ? `บันทึกรับเข้าสต๊อกยาง (รวม ${totalInputTireQty.toLocaleString()} เส้น)`
                        : "บันทึกรายการสต๊อกยาง"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Stage 2 (Outbound): Progressive Full-Screen Diagonal Reveal Form Overlay */}
      {isTireModalOpen &&
        tireTxType === "Outbound" &&
        isOutboundExpanded &&
        createPortal(
          <div className="fixed inset-0 z-[1100] pointer-events-auto">
            {/* Ambient backdrop scrim */}
            <div
              aria-hidden="true"
              className={`fixed inset-0 bg-slate-950/35 dark:bg-slate-950/55 backdrop-blur-[2px] pointer-events-none ${
                isOutboundCollapsing ? "animate-diagonal-scrim-out" : "animate-diagonal-scrim-in"
              }`}
            />

            {/* Layer 1: Leading deep-brand diagonal curtain */}
            <div
              aria-hidden="true"
              className={`fixed inset-0 bg-gradient-to-br from-[#075985] via-[#087eaf] to-[#0284c7] dark:from-[#0c2d4d] dark:via-[#087eaf] dark:to-sky-600 pointer-events-none ${
                isOutboundCollapsing
                  ? "animate-diagonal-collapse-lead"
                  : "animate-diagonal-wave-lead"
              }`}
            />

            {/* Layer 2: Trailing soft-sky bevel curtain for progressive depth */}
            <div
              aria-hidden="true"
              className={`fixed inset-0 bg-gradient-to-br from-sky-200/95 via-sky-100/95 to-white dark:from-sky-500/45 dark:via-[#122b4d] dark:to-[#0d1b33] pointer-events-none ${
                isOutboundCollapsing
                  ? "animate-diagonal-collapse-trail"
                  : "animate-diagonal-wave-trail"
              }`}
            />

            {/* Layer 3: Main full-screen progressive diagonal surface */}
            <div
              className={`fixed inset-0 bg-slate-50 dark:bg-[#091529] flex flex-col min-h-0 overflow-hidden ${
                isOutboundCollapsing
                  ? "animate-diagonal-collapse-surface"
                  : "animate-diagonal-wave-surface"
              }`}
            >
              {/* Top Bar (Step 1 of Progressive Diagonal Content Reveal) */}
              <div
                className={`shrink-0 px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] flex items-center justify-between gap-4 ${
                  isOutboundCollapsing
                    ? "animate-diagonal-zone-exit"
                    : "animate-diagonal-reveal-header"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={collapseOutboundExpanded}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#162744] transition-colors whitespace-nowrap shrink-0"
                  >
                    <ArrowLeft size={14} />
                    กลับไปผังล้อ
                  </button>
                  <div className="min-w-0">
                    <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                      เบิกเปลี่ยนยางรถโฟล์คลิฟท์ (Tire Stock Outbound)
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 truncate tabular-nums">
                      <span className="font-bold text-[#087eaf] dark:text-sky-300">
                        รถ {tireVehicleId}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {tireWheelPosition}
                      </span>
                      {selectedOutboundVehicle?.description && (
                        <>
                          <span aria-hidden="true" className="hidden sm:inline">
                            ·
                          </span>
                          <span className="hidden sm:inline truncate">
                            {selectedOutboundVehicle.description}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsOutboundExpanded(false);
                    setIsOutboundCollapsing(false);
                    setIsTireModalOpen(false);
                  }}
                  className="p-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-[#162744] transition-colors shrink-0"
                  aria-label="ปิดหน้าต่าง"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Expanded Outbound Form Body */}
              <form
                onSubmit={handleCreateTireTransaction}
                className="flex-1 min-h-0 flex flex-col overflow-hidden text-xs"
              >
                <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-10 py-5 sm:py-6">
                  <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Column (7 cols — Step 2 of Progressive Diagonal Reveal) */}
                    <div
                      className={`lg:col-span-7 space-y-3 ${
                        isOutboundCollapsing
                          ? "animate-diagonal-zone-exit"
                          : "animate-diagonal-reveal-left"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          รายการยางที่ผูกไว้กับรถ{" "}
                          <span className="text-[#087eaf] dark:text-sky-400">{tireVehicleId}</span> *
                        </label>
                        {outboundSummary.selectedItemCount > 0 && (
                          <span className="text-xs font-bold text-[#087eaf] dark:text-sky-300 tabular-nums">
                            เลือกเบิก {outboundSummary.selectedItemCount} รายการ · รวม{" "}
                            {outboundSummary.totalQty.toLocaleString()} เส้น
                            {outboundSummary.totalCost > 0
                              ? ` · ${outboundSummary.totalCost.toLocaleString()} บาท`
                              : ""}
                          </span>
                        )}
                      </div>

                      <div
                        className={`rounded-lg border p-3.5 sm:p-4 space-y-3 transition-colors ${
                          outboundSelectionError
                            ? "border-rose-400 bg-rose-50/40 dark:border-rose-700 dark:bg-rose-950/20"
                            : "border-slate-200 bg-white dark:border-[#1e3a5f] dark:bg-[#0d1b33]"
                        }`}
                      >
                        {boundTiresForSelectedVehicle.length > 0 ? (
                          <div className="space-y-2.5">
                            {boundTiresForSelectedVehicle.map((item, itemIdx) => {
                              const sel = outboundSelections[item.key];
                              const isChecked = Boolean(sel);
                              const staggerDelayMs = 400 + Math.min(itemIdx, 5) * 45;
                              return (
                                <div
                                  key={item.key}
                                  style={
                                    isOutboundCollapsing
                                      ? undefined
                                      : { animationDelay: `${staggerDelayMs}ms` }
                                  }
                                  className={`rounded-md border transition-colors ${
                                    isOutboundCollapsing ? "" : "animate-diagonal-reveal-item"
                                  } ${
                                    isChecked
                                      ? "border-[#087eaf] bg-sky-50/50 dark:border-sky-500 dark:bg-sky-950/35"
                                      : "border-slate-200 bg-slate-50/40 hover:border-sky-300 dark:border-[#1e3a5f] dark:bg-[#0c1930] dark:hover:border-sky-700"
                                  }`}
                                >
                                  <label className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer select-none">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleOutboundTireItem(item)}
                                        className="sr-only"
                                      />
                                      <span
                                        aria-hidden="true"
                                        className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
                                          isChecked
                                            ? "bg-[#087eaf] border-[#087eaf] text-white"
                                            : "bg-white border-slate-400 dark:bg-[#111e38] dark:border-slate-500"
                                        }`}
                                      >
                                        {isChecked && <Check size={12} strokeWidth={3} />}
                                      </span>
                                      <div className="min-w-0">
                                        <div className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-slate-100 truncate">
                                          {item.tireSize}{" "}
                                          <span className="font-semibold text-slate-600 dark:text-slate-300">
                                            ({item.brand})
                                          </span>
                                        </div>
                                        {item.hasTypeBreakdown && (
                                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                            {TIRE_TYPE_QTY_FIELDS.map((f, fIdx) => (
                                              <React.Fragment key={f.key}>
                                                {fIdx > 0 && <span aria-hidden="true">·</span>}
                                                <span>
                                                  {f.type} {item.byType[f.key]}
                                                </span>
                                              </React.Fragment>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <span
                                      className={`text-[11px] font-bold tabular-nums shrink-0 ${
                                        item.balance > 0
                                          ? "text-emerald-700 dark:text-emerald-400"
                                          : "text-slate-500 dark:text-slate-400"
                                      }`}
                                    >
                                      คงเหลือ {item.balance.toLocaleString()} เส้น
                                    </span>
                                  </label>

                                  {isChecked && sel && (
                                    <div className="px-3.5 pb-3.5 pt-2.5 border-t border-sky-200/80 dark:border-sky-800/60 space-y-2">
                                      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                        ติ๊กเลือกประเภทยางและระบุจำนวนที่เบิก (เส้น):
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                        {TIRE_TYPE_QTY_FIELDS.map((field) => {
                                          const typeChecked = sel.selectedTypes.includes(field.type);
                                          const rawQty = sel.qtyByType[field.key];
                                          const parsedQ =
                                            rawQty !== "" && !isNaN(Number(rawQty)) && Number(rawQty) > 0
                                              ? Math.floor(Number(rawQty))
                                              : 0;
                                          const refCost =
                                            item.latestUnitCostByType[field.key] ||
                                            item.latestUnitCost ||
                                            0;
                                          return (
                                            <div
                                              key={field.key}
                                              className={`p-2.5 rounded border transition-colors space-y-1.5 ${
                                                typeChecked
                                                  ? "bg-white border-[#087eaf] dark:bg-[#0c1930] dark:border-sky-500"
                                                  : "bg-slate-50/80 border-slate-200 dark:bg-[#0d1b33]/80 dark:border-[#1e3a5f]"
                                              }`}
                                            >
                                              <label className="flex items-center justify-between gap-1.5 cursor-pointer select-none">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                  <input
                                                    type="checkbox"
                                                    checked={typeChecked}
                                                    onChange={() =>
                                                      toggleOutboundItemComponentType(
                                                        item.key,
                                                        field.type
                                                      )
                                                    }
                                                    className="sr-only"
                                                  />
                                                  <span
                                                    aria-hidden="true"
                                                    className={`w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                                                      typeChecked
                                                        ? "bg-[#087eaf] border-[#087eaf] text-white"
                                                        : "bg-white border-slate-400 dark:bg-[#111e38] dark:border-slate-500"
                                                    }`}
                                                  >
                                                    {typeChecked && <Check size={10} strokeWidth={3} />}
                                                  </span>
                                                  <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                    {field.label}
                                                  </span>
                                                </div>
                                                {item.hasTypeBreakdown && (
                                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                                                    เหลือ {item.byType[field.key]}
                                                  </span>
                                                )}
                                              </label>
                                              <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={rawQty}
                                                onChange={(e) =>
                                                  handleOutboundItemQtyChange(
                                                    item.key,
                                                    field.key,
                                                    field.type,
                                                    e.target.value
                                                  )
                                                }
                                                placeholder="จำนวน (เส้น)"
                                                className={`w-full px-2.5 py-1.5 rounded border text-xs tabular-nums text-slate-900 dark:text-slate-100 ${
                                                  typeChecked
                                                    ? "border-[#087eaf]/70 bg-white dark:bg-[#111e38] dark:border-sky-500"
                                                    : "border-slate-300 bg-white dark:bg-[#0c1930] dark:border-[#1e3a5f]"
                                                }`}
                                              />
                                              {refCost > 0 && (
                                                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                                  <span>@{refCost.toLocaleString()} บ.</span>
                                                  {typeChecked && parsedQ > 0 && (
                                                    <span className="font-semibold text-[#087eaf] dark:text-sky-400">
                                                      {(parsedQ * refCost).toLocaleString()} บ.
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-3.5 rounded-md border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 space-y-2.5">
                            <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                              รถ {tireVehicleId} ยังไม่มีรายการยางที่ผูกไว้จากประวัติรับเข้า (Inbound)
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {otherStockTiresForOutbound.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setShowAllStockInOutbound((prev) => !prev)}
                                  className="px-3 py-1.5 rounded text-[11px] font-bold bg-[#087eaf] hover:bg-[#075985] text-white"
                                >
                                  {showAllStockInOutbound
                                    ? "ซ่อนสต๊อกยางทั้งหมดในคลัง"
                                    : `เลือกจากสต๊อกยางทั้งหมดในคลัง (${otherStockTiresForOutbound.length} รายการ)`}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  const targetVeh = tireVehicleId;
                                  setIsOutboundExpanded(false);
                                  setIsOutboundCollapsing(false);
                                  setTireTxType("Inbound");
                                  setSelectedCompatibleVehicles([targetVeh]);
                                  setOutboundSelectionError("");
                                }}
                                className="px-3 py-1.5 rounded text-[11px] font-semibold bg-white dark:bg-[#0d1b33] border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-[#162744]"
                              >
                                + ไปรับเข้ายางและผูกกับรถ {tireVehicleId}
                              </button>
                            </div>
                          </div>
                        )}

                        {boundTiresForSelectedVehicle.length > 0 &&
                          otherStockTiresForOutbound.length > 0 && (
                            <div className="pt-1 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setShowAllStockInOutbound((prev) => !prev)}
                                className="text-[11px] font-semibold text-[#087eaf] dark:text-sky-400 hover:underline"
                              >
                                {showAllStockInOutbound
                                  ? "ซ่อนรายการยางอื่นในคลัง"
                                  : `+ แสดงรายการยางอื่นในคลังด้วย (${otherStockTiresForOutbound.length} รายการ)`}
                              </button>
                            </div>
                          )}

                        {showAllStockInOutbound && otherStockTiresForOutbound.length > 0 && (
                          <div className="pt-3 border-t border-slate-200 dark:border-[#1e3a5f] space-y-2.5">
                            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                              รายการยางอื่นในคลังสต๊อก (ยังไม่ได้ผูกกับรถ {tireVehicleId})
                            </div>
                            {otherStockTiresForOutbound.map((item) => {
                              const sel = outboundSelections[item.key];
                              const isChecked = Boolean(sel);
                              return (
                                <div
                                  key={item.key}
                                  className={`rounded-md border transition-colors ${
                                    isChecked
                                      ? "border-[#087eaf] bg-sky-50/50 dark:border-sky-500 dark:bg-sky-950/35"
                                      : "border-slate-200 bg-slate-50/40 hover:border-sky-300 dark:border-[#1e3a5f] dark:bg-[#0c1930] dark:hover:border-sky-700"
                                  }`}
                                >
                                  <label className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer select-none">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleOutboundTireItem(item)}
                                        className="sr-only"
                                      />
                                      <span
                                        aria-hidden="true"
                                        className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${
                                          isChecked
                                            ? "bg-[#087eaf] border-[#087eaf] text-white"
                                            : "bg-white border-slate-400 dark:bg-[#111e38] dark:border-slate-500"
                                        }`}
                                      >
                                        {isChecked && <Check size={12} strokeWidth={3} />}
                                      </span>
                                      <div className="min-w-0">
                                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                          {item.tireSize}{" "}
                                          <span className="font-semibold text-slate-600 dark:text-slate-300">
                                            ({item.brand})
                                          </span>
                                        </div>
                                        {item.hasTypeBreakdown && (
                                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                            {TIRE_TYPE_QTY_FIELDS.map((f, fIdx) => (
                                              <React.Fragment key={f.key}>
                                                {fIdx > 0 && <span aria-hidden="true">·</span>}
                                                <span>
                                                  {f.type} {item.byType[f.key]}
                                                </span>
                                              </React.Fragment>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <span
                                      className={`text-[11px] font-bold tabular-nums shrink-0 ${
                                        item.balance > 0
                                          ? "text-emerald-700 dark:text-emerald-400"
                                          : "text-slate-500 dark:text-slate-400"
                                      }`}
                                    >
                                      คงเหลือ {item.balance.toLocaleString()} เส้น
                                    </span>
                                  </label>

                                  {isChecked && sel && (
                                    <div className="px-3.5 pb-3.5 pt-2.5 border-t border-sky-200/80 dark:border-sky-800/60 space-y-2">
                                      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                        ติ๊กเลือกประเภทยางและระบุจำนวนที่เบิก (เส้น):
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                        {TIRE_TYPE_QTY_FIELDS.map((field) => {
                                          const typeChecked = sel.selectedTypes.includes(field.type);
                                          const rawQty = sel.qtyByType[field.key];
                                          const parsedQ =
                                            rawQty !== "" && !isNaN(Number(rawQty)) && Number(rawQty) > 0
                                              ? Math.floor(Number(rawQty))
                                              : 0;
                                          const refCost =
                                            item.latestUnitCostByType[field.key] ||
                                            item.latestUnitCost ||
                                            0;
                                          return (
                                            <div
                                              key={field.key}
                                              className={`p-2.5 rounded border transition-colors space-y-1.5 ${
                                                typeChecked
                                                  ? "bg-white border-[#087eaf] dark:bg-[#0c1930] dark:border-sky-500"
                                                  : "bg-slate-50/80 border-slate-200 dark:bg-[#0d1b33]/80 dark:border-[#1e3a5f]"
                                              }`}
                                            >
                                              <label className="flex items-center justify-between gap-1.5 cursor-pointer select-none">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                  <input
                                                    type="checkbox"
                                                    checked={typeChecked}
                                                    onChange={() =>
                                                      toggleOutboundItemComponentType(
                                                        item.key,
                                                        field.type
                                                      )
                                                    }
                                                    className="sr-only"
                                                  />
                                                  <span
                                                    aria-hidden="true"
                                                    className={`w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                                                      typeChecked
                                                        ? "bg-[#087eaf] border-[#087eaf] text-white"
                                                        : "bg-white border-slate-400 dark:bg-[#111e38] dark:border-slate-500"
                                                    }`}
                                                  >
                                                    {typeChecked && <Check size={10} strokeWidth={3} />}
                                                  </span>
                                                  <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                    {field.label}
                                                  </span>
                                                </div>
                                                {item.hasTypeBreakdown && (
                                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                                                    เหลือ {item.byType[field.key]}
                                                  </span>
                                                )}
                                              </label>
                                              <input
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={rawQty}
                                                onChange={(e) =>
                                                  handleOutboundItemQtyChange(
                                                    item.key,
                                                    field.key,
                                                    field.type,
                                                    e.target.value
                                                  )
                                                }
                                                placeholder="จำนวน (เส้น)"
                                                className={`w-full px-2.5 py-1.5 rounded border text-xs tabular-nums text-slate-900 dark:text-slate-100 ${
                                                  typeChecked
                                                    ? "border-[#087eaf]/70 bg-white dark:bg-[#111e38] dark:border-sky-500"
                                                    : "border-slate-300 bg-white dark:bg-[#0c1930] dark:border-[#1e3a5f]"
                                                }`}
                                              />
                                              {refCost > 0 && (
                                                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                                  <span>@{refCost.toLocaleString()} บ.</span>
                                                  {typeChecked && parsedQ > 0 && (
                                                    <span className="font-semibold text-[#087eaf] dark:text-sky-400">
                                                      {(parsedQ * refCost).toLocaleString()} บ.
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {outboundSelectionError && (
                        <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                          {outboundSelectionError}
                        </p>
                      )}
                    </div>

                    {/* Right Column (5 cols — Steps 3 & 4 of Progressive Diagonal Reveal) */}
                    <div className="lg:col-span-5 space-y-4">
                      <div
                        className={`rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] p-4 space-y-3.5 ${
                          isOutboundCollapsing
                            ? "animate-diagonal-zone-exit"
                            : "animate-diagonal-reveal-right-top"
                        }`}
                      >
                        <div className="text-sm font-bold text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between gap-2">
                          <span>รายละเอียดการเบิกเปลี่ยนยาง</span>
                          <button
                            type="button"
                            onClick={collapseOutboundExpanded}
                            className="text-[11px] font-semibold text-[#087eaf] dark:text-sky-400 hover:underline"
                          >
                            เปลี่ยนรถ / ผังล้อ
                          </button>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            ตำแหน่งล้อที่เปลี่ยน *
                          </label>
                          <select
                            value={tireWheelPosition}
                            onChange={(e) => setTireWheelPosition(e.target.value)}
                            required
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100 font-semibold"
                          >
                            <option value="">— เลือกตำแหน่งล้อ —</option>
                            {activeWheelPositionOptions.map((pos) => (
                              <option key={pos} value={pos}>
                                {pos}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
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
                              onFocus={() => setShowNotesDropdown(true)}
                              onChange={(e) => {
                                setTireNotes(e.target.value);
                                setShowNotesDropdown(true);
                              }}
                              placeholder={
                                cloudOutboundNotesOptions.length > 0
                                  ? "พิมพ์หมายเหตุ หรือเลือกจากประวัติที่เคยเบิก..."
                                  : "รายละเอียดเพิ่มเติม..."
                              }
                              className={`w-full ${
                                cloudOutboundNotesOptions.length > 0 ? "pl-3 pr-8" : "px-3"
                              } py-2 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100`}
                            />
                            {cloudOutboundNotesOptions.length > 0 && (
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

                          {showNotesDropdown && filteredOutboundNotesOptions.length > 0 && (
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
                      </div>

                      {/* Latest Outbound History Preview (Step 4 of Progressive Diagonal Reveal) */}
                      <div
                        className={`p-4 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] space-y-2 ${
                          isOutboundCollapsing
                            ? "animate-diagonal-zone-exit"
                            : "animate-diagonal-reveal-right-bottom"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <History size={14} className="text-[#087eaf] dark:text-sky-400" />
                            <span>ประวัติการเบิกเปลี่ยนยางล่าสุด (รถ {tireVehicleId})</span>
                          </div>
                          {latestOutboundRecord?.notes && (
                            <button
                              type="button"
                              onClick={() => setTireNotes(latestOutboundRecord.notes || "")}
                              className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-50 dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-[#087eaf] dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-[#162744] whitespace-nowrap"
                            >
                              ดึงหมายเหตุล่าสุดมาใส่
                            </button>
                          )}
                        </div>

                        {latestOutboundRecord ? (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 leading-relaxed">
                            <div className="tabular-nums">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                วันที่เบิก:
                              </span>{" "}
                              {latestOutboundRecord.date} {latestOutboundRecord.time} ·{" "}
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                ตำแหน่ง:
                              </span>{" "}
                              {latestOutboundRecord.wheelPosition || "-"}
                            </div>
                            <div className="tabular-nums">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                ขนาด/ยี่ห้อ:
                              </span>{" "}
                              {latestOutboundRecord.tireSize} ({latestOutboundRecord.brand}) ·{" "}
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                จำนวน:
                              </span>{" "}
                              {latestOutboundRecord.qty} เส้น
                              {latestOutboundRecord.operatingHours
                                ? ` · ชม.รถ ${latestOutboundRecord.operatingHours.toLocaleString()} ชม.`
                                : ""}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                ช่างผู้เบิก:
                              </span>{" "}
                              {latestOutboundRecord.technicianOrReceiver} ·{" "}
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                หมายเหตุ:
                              </span>{" "}
                              <span className="text-slate-900 dark:text-slate-100 font-medium">
                                {latestOutboundRecord.notes || "-"}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            ยังไม่มีประวัติการเบิกเปลี่ยนยางสำหรับรถ {tireVehicleId} ในฐานข้อมูล
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Action Bar (Step 5 of Progressive Diagonal Reveal) */}
                <div
                  className={`shrink-0 px-4 sm:px-6 py-3.5 border-t border-slate-200 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] flex flex-wrap items-center justify-between gap-3 ${
                    isOutboundCollapsing
                      ? "animate-diagonal-zone-exit"
                      : "animate-diagonal-reveal-footer"
                  }`}
                >
                  <div className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                    {outboundSummary.selectedItemCount > 0 ? (
                      <span>
                        เลือกเบิก{" "}
                        <strong className="text-slate-900 dark:text-white">
                          {outboundSummary.selectedItemCount} รายการ
                        </strong>{" "}
                        · รวม{" "}
                        <strong className="text-[#087eaf] dark:text-sky-300">
                          {outboundSummary.totalQty.toLocaleString()} เส้น
                        </strong>
                        {outboundSummary.totalCost > 0
                          ? ` · มูลค่ารวม ${outboundSummary.totalCost.toLocaleString()} บาท`
                          : ""}
                      </span>
                    ) : (
                      <span>กรุณาติ๊กเลือกรายการยางที่ต้องการเบิกและระบุจำนวน</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={collapseOutboundExpanded}
                      className="px-4 py-2 rounded-md border border-slate-300 dark:border-[#1e3a5f] font-semibold bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744]"
                    >
                      ย้อนกลับ
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-md bg-[#087eaf] hover:bg-[#075985] text-white font-bold shadow-xs"
                    >
                      {outboundSummary.totalQty > 0
                        ? `บันทึกเบิกเปลี่ยนยาง (รวม ${outboundSummary.totalQty.toLocaleString()} เส้น)`
                        : "บันทึกเบิกเปลี่ยนยาง"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
