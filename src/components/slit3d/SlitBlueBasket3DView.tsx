import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Image as ImageIcon,
  Layers,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Ruler,
  Scale,
  ScanBarcode,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { CameraBarcodeScanner } from "../CameraBarcodeScanner";
import type { SapMasterItem, SlitBarcodeRecord } from "../SlitFilmManagement";
import {
  deleteRecordFromCloud,
  saveInboundRecordToCloud,
} from "../../services/slitDataService";
import {
  BLUE_BASKET_BUILDINGS,
  BLUE_BASKET_BUILDING_META,
  BasketLayerState,
  BasketSlot3D,
  BlueBasketBuildingId,
  BlueBasketWarehouseConfig,
  DEFAULT_FALLBACK_WIDTH_MM,
  DEFAULT_SLOTS_PER_ROW,
  MAX_BASKET_WIDTH_MM,
  MAX_SLOTS_PER_ROW,
  MIN_SLOTS_PER_ROW,
  buildBuildingBasketLayout3D,
  createDefaultBlueBasketConfig,
  formatBasketCode,
  formatBasketLayerLocation,
  getNextAvailableRowId,
  loadCachedBlueBasketConfig,
  parseBasketLocation,
  parseWidthMm,
  saveBlueBasketConfigToCloud,
  subscribeBlueBasketConfig,
  validateBasketPlacement,
} from "./blueBasketLayout";
import {
  BasketCameraPreset,
  BasketHoverPayload,
  BasketSceneFilterState,
  BlueBasketSceneEngine,
} from "./blueBasketScene";

export interface SlitBlueBasket3DViewProps {
  inboundList: SlitBarcodeRecord[];
  outboundList: SlitBarcodeRecord[];
  sapMasterMap: Map<string, SapMasterItem>;
  isThai: boolean;
  onInboundRecordSaved?: (record: SlitBarcodeRecord) => void;
  onInboundRecordDeleted?: (recordId: string) => void;
  onLogTransaction?: (action: string, details: string) => void;
}

const REFERENCE_IMAGES = [
  {
    src: "/assets/aistudio/Gemini_Generated_Image_4h5u004h5u004h5u_c5145253.jpg",
    titleTh: "มุมมอง 3 มิติ ตะกร้าฟ้าเดี่ยว (ชั้น 1)",
    titleEn: "Single Blue Basket (Layer 1)",
    captionTh:
      "โครงสร้างเสา 4 มุมพร้อมหัวสลักซ้อนทรงกรวย ฐานรองตัว V และคานข้างเจาะรู บรรจุม้วนสลิตเรียงข้างกันรวมหน้ากว้างไม่เกิน 2,000 มม.",
  },
  {
    src: "/assets/aistudio/Gemini_Generated_Image_4h5u004h5u004h5u__1__3099af18.jpg",
    titleTh: "แบบแปลน 4 มุมมอง (หน้า / ข้าง / บน / Isometric)",
    titleEn: "4-View Blueprint",
    captionTh:
      "ม้วนเหล็กสลิตวางแนวนอนเรียงต่อกันเต็มระยะภายในตะกร้า 2.0 เมตร (2,000 มม.) พร้อมช่องเสียบงาโฟล์คลิฟท์ด้านล่าง",
  },
  {
    src: "/assets/aistudio/Gemini_Generated_Image_4h5u004h5u004h5u__2__20ae2ae4.jpg",
    titleTh: "การวางซ้อน 2 ชั้น (สูงสุดไม่เกิน 2 ชั้น)",
    titleEn: "2-Layer Stack (Max 2 Tiers)",
    captionTh:
      "ตะกร้าชั้น 2 สวมลงบนสลักมุมทั้ง 4 เสาของตะกร้าชั้น 1 พอดี เพื่อความปลอดภัยห้ามซ้อนเกิน 2 ชั้น",
  },
];

const INBOUND_MACHINES = ["SM01", "SM02", "SM03", "SM04", "EXTERNAL"] as const;
const QUICK_WIDTH_PRESETS = [150, 200, 250, 300, 400, 500, 600];

function formatCurrentTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function normalizeTsKey(ts?: string): string {
  if (!ts) return "";
  const s = ts.trim();
  const mIso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/);
  if (mIso) {
    let y = parseInt(mIso[1], 10);
    if (y > 2400) y -= 543;
    return `${y}-${String(parseInt(mIso[2], 10)).padStart(2, "0")}-${String(
      parseInt(mIso[3], 10)
    ).padStart(2, "0")} ${(mIso[4] || "").trim()}`;
  }
  const mDmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(.*)$/);
  if (mDmy) {
    let y = parseInt(mDmy[3], 10);
    if (y > 2400) y -= 543;
    return `${y}-${String(parseInt(mDmy[2], 10)).padStart(2, "0")}-${String(
      parseInt(mDmy[1], 10)
    ).padStart(2, "0")} ${(mDmy[4] || "").trim()}`;
  }
  return s;
}

function isOutboundLocationString(loc?: string): boolean {
  if (!loc) return false;
  const s = loc.trim();
  return s.includes("เบิก") || s.toUpperCase().startsWith("OUT-");
}

function getStatusBadgeClasses(status: BasketLayerState["status"]): string {
  switch (status) {
    case "EMPTY":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "PARTIAL":
      return "bg-sky-500/15 text-sky-300 border-sky-500/40";
    case "NEAR_FULL":
      return "bg-amber-500/15 text-amber-300 border-amber-500/40";
    case "FULL":
    case "OVERFLOW":
      return "bg-rose-500/15 text-rose-300 border-rose-500/40";
  }
}

function getStatusBarColor(status: BasketLayerState["status"]): string {
  switch (status) {
    case "EMPTY":
      return "bg-emerald-500";
    case "PARTIAL":
      return "bg-sky-500";
    case "NEAR_FULL":
      return "bg-amber-500";
    case "FULL":
    case "OVERFLOW":
      return "bg-rose-500";
  }
}

export const SlitBlueBasket3DView: React.FC<SlitBlueBasket3DViewProps> = ({
  inboundList,
  outboundList,
  sapMasterMap,
  isThai,
  onInboundRecordSaved,
  onInboundRecordDeleted,
  onLogTransaction,
}) => {
  // Warehouse 3D layout config (synced to Firestore + cached locally)
  const [warehouseConfig, setWarehouseConfig] =
    useState<BlueBasketWarehouseConfig>(() => loadCachedBlueBasketConfig());

  const [selectedBuilding, setSelectedBuilding] =
    useState<BlueBasketBuildingId>("E9");
  const [rowFilter, setRowFilter] = useState<string>("ALL");
  const [layerFilter, setLayerFilter] = useState<"ALL" | "1" | "2">("ALL");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "EMPTY" | "OCCUPIED" | "NEAR_FULL_OR_FULL"
  >("ALL");
  const [activeCameraPreset, setActiveCameraPreset] =
    useState<BasketCameraPreset>("isometric");
  const [dockVisible, setDockVisible] = useState<boolean>(false);

  // Selection / Hover / Focus state
  const [selectedBasketCode, setSelectedBasketCode] = useState<string | null>(
    null
  );
  const [selectedLayer, setSelectedLayer] = useState<1 | 2 | null>(null);
  const [focusedBasketCode, setFocusedBasketCode] = useState<string | null>(
    null
  );
  const [hoverInfo, setHoverInfo] = useState<BasketHoverPayload | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchFeedback, setSearchFeedback] = useState<{
    type: "found" | "not_found";
    message: string;
  } | null>(null);

  // Modals & Drawers
  const [showInboundDrawer, setShowInboundDrawer] = useState<boolean>(false);
  const [showRowManager, setShowRowManager] = useState<boolean>(false);
  const [showReferenceModal, setShowReferenceModal] = useState<boolean>(false);

  // 4-Step Guided Inbound Flow State:
  // Step 1: Scan Batch >> Step 2: Building >> Step 3: Scan Basket Code >> Step 4: Choose Layer
  const [inboundStep, setInboundStep] = useState<1 | 2 | 3 | 4>(1);
  const [inboundBatchInput, setInboundBatchInput] = useState<string>("");
  const [inboundMachine, setInboundMachine] = useState<string>("SM01");
  const [inboundManualWidth, setInboundManualWidth] = useState<string>("");
  const [inboundBuilding, setInboundBuilding] =
    useState<BlueBasketBuildingId>("E9");
  const [inboundBasketInput, setInboundBasketInput] = useState<string>("");
  const [inboundBasketRowFilter, setInboundBasketRowFilter] =
    useState<string>("ALL");
  const [inboundLayer, setInboundLayer] = useState<1 | 2>(1);
  const [confirmEmptyLayer1, setConfirmEmptyLayer1] = useState<boolean>(false);
  const [keepTargetAfterSave, setKeepTargetAfterSave] = useState<boolean>(true);
  const [cameraScanTarget, setCameraScanTarget] = useState<
    "batch" | "basket" | null
  >(null);
  const [isSavingInbound, setIsSavingInbound] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Inline delete confirmation inside Inspector
  const [confirmDeleteRecordId, setConfirmDeleteRecordId] = useState<
    string | null
  >(null);

  // Row Manager Modal State
  const [newRowLabel, setNewRowLabel] = useState<string>("");
  const [newRowSlots, setNewRowSlots] = useState<number>(DEFAULT_SLOTS_PER_ROW);
  const [rowManagerError, setRowManagerError] = useState<string | null>(null);
  const [isSavingLayout, setIsSavingLayout] = useState<boolean>(false);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BlueBasketSceneEngine | null>(null);
  const prevBuildingRef = useRef<BlueBasketBuildingId>(selectedBuilding);
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const basketInputRef = useRef<HTMLInputElement | null>(null);
  const showInboundDrawerRef = useRef<boolean>(showInboundDrawer);

  useEffect(() => {
    showInboundDrawerRef.current = showInboundDrawer;
  }, [showInboundDrawer]);

  // Subscribe to Firestore Blue Basket 3D Layout Config
  useEffect(() => {
    const unsub = subscribeBlueBasketConfig((cloudConfig) => {
      setWarehouseConfig(cloudConfig);
    });
    return unsub;
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  // Compute active slit stock (latest inbound per batch minus issued outbound)
  const activeStockRecords = useMemo(() => {
    const latestOutboundTs = new Map<string, string>();
    for (const outRec of outboundList) {
      if (!outRec.batch) continue;
      const bKey = outRec.batch.trim().toUpperCase();
      const isTemp = Boolean(
        (outRec.isTemporaryOrder || outRec.orderNo?.startsWith("TEMP-")) &&
          !outRec.matchedOrderNo
      );
      if (isTemp) continue;
      if (isOutboundLocationString(outRec.location) || outRec.mode === "outbound") {
        const ts = normalizeTsKey(outRec.scanTimestamp);
        const prev = latestOutboundTs.get(bKey) || "";
        if (!prev || ts > prev) {
          latestOutboundTs.set(bKey, ts || "9999");
        }
      }
    }

    const latestByBatch = new Map<string, SlitBarcodeRecord>();
    for (const rec of inboundList) {
      if (!rec.batch || !rec.location) continue;
      if (isOutboundLocationString(rec.location)) continue;
      const bKey = rec.batch.trim().toUpperCase();
      const inTs = normalizeTsKey(rec.scanTimestamp);
      const outTs = latestOutboundTs.get(bKey);
      const isReturned = Boolean(
        rec.conditionText && String(rec.conditionText).includes("คืนคลัง")
      );
      if (outTs && !isReturned && inTs < outTs) continue;

      const existing = latestByBatch.get(bKey);
      if (!existing) {
        latestByBatch.set(bKey, rec);
      } else {
        const exTs = normalizeTsKey(existing.scanTimestamp);
        if (inTs >= exTs) {
          latestByBatch.set(bKey, rec);
        }
      }
    }

    return Array.from(latestByBatch.values());
  }, [inboundList, outboundList]);

  // Build layouts for all 3 buildings (E9, H2, F) so building badges & cross-building search are instant
  const allBuildingLayouts = useMemo(() => {
    return {
      E9: buildBuildingBasketLayout3D(
        "E9",
        warehouseConfig,
        activeStockRecords,
        sapMasterMap
      ),
      H2: buildBuildingBasketLayout3D(
        "H2",
        warehouseConfig,
        activeStockRecords,
        sapMasterMap
      ),
      F: buildBuildingBasketLayout3D(
        "F",
        warehouseConfig,
        activeStockRecords,
        sapMasterMap
      ),
    };
  }, [warehouseConfig, activeStockRecords, sapMasterMap]);

  const currentLayout = allBuildingLayouts[selectedBuilding];

  // Selected slot object for Inspector
  const selectedSlot: BasketSlot3D | null = useMemo(() => {
    if (!selectedBasketCode) return null;
    return currentLayout.slotByCode.get(selectedBasketCode) || null;
  }, [currentLayout, selectedBasketCode]);

  // Derived Inbound Batch SAP lookup & width calculation
  const normalizedInboundBatch = inboundBatchInput.trim().toUpperCase();
  const inboundSapItem = useMemo(() => {
    if (!normalizedInboundBatch) return undefined;
    return sapMasterMap.get(normalizedInboundBatch);
  }, [sapMasterMap, normalizedInboundBatch]);

  const existingActiveRecordForBatch = useMemo(() => {
    if (!normalizedInboundBatch) return undefined;
    return activeStockRecords.find(
      (r) => r.batch.trim().toUpperCase() === normalizedInboundBatch
    );
  }, [activeStockRecords, normalizedInboundBatch]);

  const sapWidthMm = useMemo(
    () => parseWidthMm(inboundSapItem?.width),
    [inboundSapItem]
  );

  const effectiveInboundWidthMm = useMemo(() => {
    const manualParsed = parseWidthMm(inboundManualWidth);
    if (manualParsed !== null) return manualParsed;
    if (sapWidthMm !== null) return sapWidthMm;
    return DEFAULT_FALLBACK_WIDTH_MM;
  }, [inboundManualWidth, sapWidthMm]);

  // Resolve target basket in Inbound drawer
  const inboundBuildingLayout = allBuildingLayouts[inboundBuilding];
  const resolvedInboundBasketCode = useMemo(() => {
    const raw = inboundBasketInput.trim().toUpperCase();
    if (!raw) return null;
    const parsed = parseBasketLocation(raw);
    if (parsed) return parsed.basketCode;
    return inboundBuildingLayout.slotByCode.has(raw) ? raw : null;
  }, [inboundBasketInput, inboundBuildingLayout]);

  const inboundTargetSlot: BasketSlot3D | null = useMemo(() => {
    if (!resolvedInboundBasketCode) return null;
    return (
      inboundBuildingLayout.slotByCode.get(resolvedInboundBasketCode) || null
    );
  }, [inboundBuildingLayout, resolvedInboundBasketCode]);

  // Live validation for Layer 1 & Layer 2 in Step 4
  const validationL1 = useMemo(
    () =>
      validateBasketPlacement(
        inboundTargetSlot,
        1,
        effectiveInboundWidthMm,
        true
      ),
    [inboundTargetSlot, effectiveInboundWidthMm]
  );

  const validationL2 = useMemo(
    () =>
      validateBasketPlacement(
        inboundTargetSlot,
        2,
        effectiveInboundWidthMm,
        confirmEmptyLayer1
      ),
    [inboundTargetSlot, effectiveInboundWidthMm, confirmEmptyLayer1]
  );

  const activeLayerValidation =
    inboundLayer === 1 ? validationL1 : validationL2;

  // Handle clicking a basket in the 3D scene
  const handleSceneSelectBasket = useCallback(
    (slot: BasketSlot3D | null, layer?: 1 | 2) => {
      if (!slot) {
        setSelectedBasketCode(null);
        setSelectedLayer(null);
        return;
      }
      setSelectedBasketCode(slot.basketCode);
      setSelectedLayer(layer || 1);
      setFocusedBasketCode(slot.basketCode);
      setConfirmDeleteRecordId(null);

      // If 4-step inbound drawer is open, clicking a 3D basket fills Step 3 automatically!
      if (showInboundDrawerRef.current) {
        setInboundBuilding(slot.buildingId);
        setInboundBasketInput(slot.basketCode);
        setConfirmEmptyLayer1(false);
        if (layer) {
          setInboundLayer(layer);
        } else if (
          slot.layer1.status === "FULL" ||
          slot.layer1.status === "OVERFLOW"
        ) {
          setInboundLayer(2);
        } else {
          setInboundLayer(1);
        }
        setInboundStep((prev) => (prev >= 2 ? 4 : prev));
        engineRef.current?.focusBasket(slot.basketCode, layer || 1);
      }
    },
    []
  );

  // Initialize Three.js engine once
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    setWebglError(null);

    try {
      const engine = new BlueBasketSceneEngine(host, {
        onSelectBasket: handleSceneSelectBasket,
        onHoverBasket: (payload) => setHoverInfo(payload),
        onWebGLContextError: (msg) => setWebglError(msg),
      });
      engineRef.current = engine;
      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch (err) {
      setWebglError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถเริ่มต้น WebGL 3D ได้บนอุปกรณ์นี้"
      );
      return undefined;
    }
  }, [handleSceneSelectBasket]);

  // Sync layout + filter state into Three.js scene
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const buildingChanged = prevBuildingRef.current !== selectedBuilding;
    prevBuildingRef.current = selectedBuilding;

    const filterState: BasketSceneFilterState = {
      row: rowFilter,
      layer: layerFilter,
      status: statusFilter,
      selectedBasketCode,
      selectedLayer,
      focusedBasketCode,
      previewLayer2BasketCode:
        showInboundDrawer &&
        inboundBuilding === selectedBuilding &&
        inboundLayer === 2 &&
        resolvedInboundBasketCode
          ? resolvedInboundBasketCode
          : null,
    };

    engine.setLayoutAndFilters(currentLayout, filterState, buildingChanged);
  }, [
    currentLayout,
    selectedBuilding,
    rowFilter,
    layerFilter,
    statusFilter,
    selectedBasketCode,
    selectedLayer,
    focusedBasketCode,
    showInboundDrawer,
    inboundBuilding,
    inboundLayer,
    resolvedInboundBasketCode,
  ]);

  // Reset row filter when switching building if row doesn't exist
  useEffect(() => {
    if (
      rowFilter !== "ALL" &&
      !currentLayout.config.rows.some((r) => r.rowId === rowFilter)
    ) {
      setRowFilter("ALL");
    }
  }, [currentLayout, rowFilter]);

  // Auto-focus inputs when stepping in Inbound Drawer
  useEffect(() => {
    if (!showInboundDrawer || cameraScanTarget) return;
    if (inboundStep === 1) {
      window.setTimeout(() => batchInputRef.current?.focus(), 60);
    } else if (inboundStep === 3) {
      window.setTimeout(() => basketInputRef.current?.focus(), 60);
    }
  }, [showInboundDrawer, inboundStep, cameraScanTarget]);

  const handleCameraPreset = (preset: BasketCameraPreset) => {
    setActiveCameraPreset(preset);
    if (preset === "reset") {
      setFocusedBasketCode(null);
    }
    engineRef.current?.setCameraPreset(preset);
  };

  // Cross-building Search (Batch OR Basket Code like E9-A01)
  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = searchQuery.trim().toUpperCase();
    if (!q) {
      setSearchFeedback(null);
      setFocusedBasketCode(null);
      return;
    }

    // 1. Check direct basket code match (e.g. E9-A01 or E9-A01-L2)
    const parsedBasket = parseBasketLocation(q);
    if (parsedBasket) {
      const bLayout = allBuildingLayouts[parsedBasket.buildingId];
      const slot = bLayout.slotByCode.get(parsedBasket.basketCode);
      if (slot) {
        setSelectedBuilding(parsedBasket.buildingId);
        setRowFilter("ALL");
        setLayerFilter("ALL");
        setStatusFilter("ALL");
        setSelectedBasketCode(slot.basketCode);
        setSelectedLayer(parsedBasket.layer);
        setFocusedBasketCode(slot.basketCode);
        setSearchFeedback({
          type: "found",
          message: isThai
            ? `พบตะกร้า ${slot.basketCode} (อาคาร ${parsedBasket.buildingId} · ${slot.totalCoils} ม้วน)`
            : `Found basket ${slot.basketCode} (${slot.totalCoils} coils)`,
        });
        window.setTimeout(() => {
          engineRef.current?.focusBasket(slot.basketCode, parsedBasket.layer);
        }, 80);
        return;
      }
    }

    // 2. Search across all buildings for Batch No.
    for (const bId of BLUE_BASKET_BUILDINGS) {
      const bLayout = allBuildingLayouts[bId];
      for (const slot of bLayout.slots) {
        const hitL1 = slot.layer1.coils.find((c) => c.batch.includes(q));
        const hitL2 = slot.layer2.coils.find((c) => c.batch.includes(q));
        const matchedCoil = hitL2 || hitL1;
        const matchedLayer: 1 | 2 = hitL2 ? 2 : 1;
        if (matchedCoil) {
          setSelectedBuilding(bId);
          setRowFilter("ALL");
          setLayerFilter("ALL");
          setStatusFilter("ALL");
          setSelectedBasketCode(slot.basketCode);
          setSelectedLayer(matchedLayer);
          setFocusedBasketCode(slot.basketCode);
          setSearchFeedback({
            type: "found",
            message: isThai
              ? `พบ Batch ${matchedCoil.batch} ที่ ${slot.basketCode} ชั้น ${matchedLayer} (${matchedCoil.widthMm} มม.)`
              : `Found ${matchedCoil.batch} at ${slot.basketCode} Layer ${matchedLayer}`,
          });
          window.setTimeout(() => {
            engineRef.current?.focusBasket(slot.basketCode, matchedLayer);
          }, 80);
          return;
        }
      }
    }

    setSearchFeedback({
      type: "not_found",
      message: isThai
        ? `ไม่พบ Batch หรือเบอร์ตะกร้า "${q}" ในอาคาร E9, H2, F`
        : `No Batch or Basket "${q}" found in E9, H2, F`,
    });
  };

  // Open Inbound Drawer (optionally pre-targeted to a specific basket + layer)
  const openInboundDrawer = (preset?: {
    buildingId: BlueBasketBuildingId;
    basketCode: string;
    layer: 1 | 2;
  }) => {
    setShowInboundDrawer(true);
    setConfirmEmptyLayer1(false);
    setCameraScanTarget(null);
    if (preset) {
      setSelectedBuilding(preset.buildingId);
      setInboundBuilding(preset.buildingId);
      setInboundBasketInput(preset.basketCode);
      setInboundLayer(preset.layer);
      setInboundStep(1);
      setFocusedBasketCode(preset.basketCode);
      window.setTimeout(() => {
        engineRef.current?.focusBasket(preset.basketCode, preset.layer);
      }, 60);
    } else {
      setInboundBuilding(selectedBuilding);
      setInboundStep(1);
    }
  };

  // Step 1 Batch Scan submit
  const handleConfirmStep1Batch = (rawBatch?: string) => {
    const val = (rawBatch ?? inboundBatchInput).trim().toUpperCase();
    if (!val) return;
    setInboundBatchInput(val);
    const sap = sapMasterMap.get(val);
    const w = parseWidthMm(sap?.width);
    if (w !== null) {
      setInboundManualWidth(String(w));
    } else if (!parseWidthMm(inboundManualWidth)) {
      setInboundManualWidth(String(DEFAULT_FALLBACK_WIDTH_MM));
    }

    // If user already locked a target basket (continuous scanning), jump straight to Step 4 to review capacity & save!
    if (resolvedInboundBasketCode && inboundTargetSlot) {
      setInboundStep(4);
      engineRef.current?.focusBasket(resolvedInboundBasketCode, inboundLayer);
    } else {
      setInboundStep(2);
    }
  };

  // Step 3 Basket Code Scan submit
  const handleApplyBasketCodeInput = (rawCode?: string) => {
    const code = (rawCode ?? inboundBasketInput).trim().toUpperCase();
    if (!code) return;

    const parsed = parseBasketLocation(code);
    if (parsed) {
      const targetLayout = allBuildingLayouts[parsed.buildingId];
      if (!targetLayout.slotByCode.has(parsed.basketCode)) {
        setToastMessage({
          type: "error",
          text: isThai
            ? `ไม่พบเบอร์ตะกร้า ${parsed.basketCode} ในผังอาคาร ${parsed.buildingId} (สามารถเพิ่มแถว/ช่องได้ที่ "จัดการแถว A–D")`
            : `Basket ${parsed.basketCode} does not exist in ${parsed.buildingId}.`,
        });
        return;
      }
      setInboundBuilding(parsed.buildingId);
      setSelectedBuilding(parsed.buildingId);
      setInboundBasketInput(parsed.basketCode);
      setSelectedBasketCode(parsed.basketCode);
      setFocusedBasketCode(parsed.basketCode);
      setConfirmEmptyLayer1(false);

      const slot = targetLayout.slotByCode.get(parsed.basketCode)!;
      // Pick layer from scanned suffix if specified, else smart default
      const hasExplicitLayer = /[-/_]?(?:L|LAYER|ชั้น)[12]$/.test(code);
      if (hasExplicitLayer) {
        setInboundLayer(parsed.layer);
      } else if (
        slot.layer1.status === "FULL" ||
        slot.layer1.status === "OVERFLOW"
      ) {
        setInboundLayer(2);
      } else {
        setInboundLayer(1);
      }
      setInboundStep(4);
      window.setTimeout(() => {
        engineRef.current?.focusBasket(parsed.basketCode, parsed.layer);
      }, 80);
      return;
    }

    setToastMessage({
      type: "error",
      text: isThai
        ? `รูปแบบเบอร์ตะกร้าไม่ถูกต้อง กรุณาสแกนเช่น E9-A01, H2-B05 หรือ F-C10`
        : `Invalid basket code. Expected format like E9-A01, H2-B05, F-C10.`,
    });
  };

  // Step 4 Save Inbound Record into Slit Stock + Update 3D Basket Immediately
  const handleSaveInboundPlacement = async () => {
    if (!normalizedInboundBatch || !inboundTargetSlot) return;
    if (!activeLayerValidation.ok) {
      setToastMessage({
        type: "error",
        text: isThai
          ? activeLayerValidation.reasonTh ||
            activeLayerValidation.warningTh ||
            "ไม่สามารถวางในตำแหน่งนี้ได้"
          : activeLayerValidation.reasonEn || "Invalid placement.",
      });
      return;
    }

    setIsSavingInbound(true);
    try {
      const canonicalLocation = formatBasketLayerLocation(
        inboundTargetSlot.basketCode,
        inboundLayer
      );
      const nowTs = formatCurrentTimestamp();
      const sap = inboundSapItem;
      const weightKg =
        typeof sap?.weightKg === "number" && sap.weightKg > 0
          ? sap.weightKg
          : existingActiveRecordForBatch?.weightKg || 0;

      const recordId =
        existingActiveRecordForBatch?.id ||
        `IN-${normalizedInboundBatch}-${Date.now()}`;

      const newRecord: SlitBarcodeRecord = {
        ...(existingActiveRecordForBatch || {}),
        id: recordId,
        mode: "inbound",
        scanTimestamp: nowTs,
        batch: normalizedInboundBatch,
        machine: inboundMachine,
        inboundType: inboundMachine === "EXTERNAL" ? "external" : "internal",
        location: canonicalLocation,
        previousLocation:
          existingActiveRecordForBatch?.location &&
          existingActiveRecordForBatch.location !== canonicalLocation
            ? existingActiveRecordForBatch.location
            : "",
        hasSapData: Boolean(sap || existingActiveRecordForBatch?.hasSapData),
        width: String(effectiveInboundWidthMm),
        weightKg,
        unrestricted:
          sap?.unrestricted ||
          existingActiveRecordForBatch?.unrestricted ||
          (weightKg > 0 ? weightKg.toLocaleString() : ""),
        certThickness:
          sap?.certThickness || existingActiveRecordForBatch?.certThickness || "",
        grade: sap?.grade || existingActiveRecordForBatch?.grade || "",
        manufacturer:
          sap?.manufacturer || existingActiveRecordForBatch?.manufacturer || "",
        storageLocation:
          sap?.storageLocation ||
          existingActiveRecordForBatch?.storageLocation ||
          "",
        salesDoc: sap?.salesDoc || existingActiveRecordForBatch?.salesDoc || "",
        materialNo:
          sap?.materialNo || existingActiveRecordForBatch?.materialNo || "",
        targetThickness:
          sap?.targetThickness ||
          existingActiveRecordForBatch?.targetThickness ||
          "",
        qualityClass:
          sap?.qualityClass || existingActiveRecordForBatch?.qualityClass || "",
        description:
          sap?.description || existingActiveRecordForBatch?.description || "",
        coilNo: sap?.coilNo || existingActiveRecordForBatch?.coilNo || "",
        conditionText:
          inboundLayer === 2 &&
          inboundTargetSlot.layer1.coils.length === 0 &&
          confirmEmptyLayer1
            ? "ตะกร้าฟ้า 3D (วางชั้น 2 บนตะกร้าเปล่ารองรับ)"
            : "ตะกร้าฟ้า 3D",
      };

      await saveInboundRecordToCloud(newRecord);
      onInboundRecordSaved?.(newRecord);
      onLogTransaction?.(
        "Blue Basket 3D Inbound",
        `Batch ${newRecord.batch} (${effectiveInboundWidthMm} mm) -> ${canonicalLocation}`
      );

      setSelectedBuilding(inboundTargetSlot.buildingId);
      setSelectedBasketCode(inboundTargetSlot.basketCode);
      setSelectedLayer(inboundLayer);
      setFocusedBasketCode(inboundTargetSlot.basketCode);
      window.setTimeout(() => {
        engineRef.current?.focusBasket(
          inboundTargetSlot.basketCode,
          inboundLayer
        );
      }, 90);

      setToastMessage({
        type: "success",
        text: isThai
          ? `บันทึก Batch ${newRecord.batch} (${effectiveInboundWidthMm} มม.) ลง ${canonicalLocation} เรียบร้อย · เหลือ ${activeLayerValidation.nextRemainingWidthMm.toLocaleString()} มม.`
          : `Saved ${newRecord.batch} to ${canonicalLocation} (${activeLayerValidation.nextRemainingWidthMm} mm left).`,
      });

      // Reset for next scan
      setInboundBatchInput("");
      setInboundManualWidth("");
      setConfirmEmptyLayer1(false);
      if (keepTargetAfterSave) {
        setInboundStep(1);
      } else {
        setInboundBasketInput("");
        setInboundLayer(1);
        setInboundStep(1);
      }
    } catch (err) {
      setToastMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "เกิดข้อผิดพลาดในการบันทึกข้อมูลลงคลาวด์",
      });
    } finally {
      setIsSavingInbound(false);
    }
  };

  // Delete a coil placement from Inspector
  const handleDeleteCoilRecord = async (record: SlitBarcodeRecord) => {
    try {
      await deleteRecordFromCloud("slit_inbound", record.id);
      onInboundRecordDeleted?.(record.id);
      onLogTransaction?.(
        "Blue Basket 3D Remove",
        `Removed Batch ${record.batch} from ${record.location}`
      );
      setConfirmDeleteRecordId(null);
      setToastMessage({
        type: "info",
        text: isThai
          ? `นำ Batch ${record.batch} ออกจาก ${record.location} เรียบร้อย`
          : `Removed ${record.batch} from ${record.location}`,
      });
    } catch {
      setToastMessage({
        type: "error",
        text: isThai
          ? "ไม่สามารถลบรายการได้ กรุณาลองใหม่อีกครั้ง"
          : "Failed to remove record.",
      });
    }
  };

  // Persist Row/Slot changes to Firestore
  const persistConfigUpdate = async (nextConfig: BlueBasketWarehouseConfig) => {
    setIsSavingLayout(true);
    setRowManagerError(null);
    setWarehouseConfig(nextConfig);
    try {
      await saveBlueBasketConfigToCloud(nextConfig);
      setToastMessage({
        type: "success",
        text: isThai
          ? `อัปเดตผังแถวตะกร้าฟ้า อาคาร ${selectedBuilding} เรียบร้อย`
          : `Updated building ${selectedBuilding} row layout.`,
      });
    } finally {
      setIsSavingLayout(false);
    }
  };

  const handleAddRow = async () => {
    const bCfg = warehouseConfig.buildings[selectedBuilding];
    const cleanId = (
      newRowLabel.trim() || getNextAvailableRowId(bCfg.rows)
    )
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);

    if (!cleanId) {
      setRowManagerError(
        isThai ? "กรุณาระบุชื่อแถว เช่น E, F" : "Please enter a row label."
      );
      return;
    }
    if (bCfg.rows.some((r) => r.rowId === cleanId)) {
      setRowManagerError(
        isThai
          ? `แถว ${cleanId} มีอยู่แล้วในอาคาร ${selectedBuilding}`
          : `Row ${cleanId} already exists.`
      );
      return;
    }

    const clampedSlots = Math.max(
      MIN_SLOTS_PER_ROW,
      Math.min(MAX_SLOTS_PER_ROW, Math.round(newRowSlots) || DEFAULT_SLOTS_PER_ROW)
    );
    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: {
          ...bCfg,
          rows: [...bCfg.rows, { rowId: cleanId, slotCount: clampedSlots }],
        },
      },
      updatedAt: new Date().toISOString(),
    };
    setNewRowLabel("");
    setNewRowSlots(DEFAULT_SLOTS_PER_ROW);
    await persistConfigUpdate(nextConfig);
  };

  const handleChangeRowSlotCount = async (rowId: string, delta: number) => {
    const bCfg = warehouseConfig.buildings[selectedBuilding];
    const targetRow = bCfg.rows.find((r) => r.rowId === rowId);
    if (!targetRow) return;
    const nextCount = Math.max(
      MIN_SLOTS_PER_ROW,
      Math.min(MAX_SLOTS_PER_ROW, targetRow.slotCount + delta)
    );
    if (nextCount === targetRow.slotCount) return;

    // Prevent shrinking if active coils exist in the removed slots
    if (nextCount < targetRow.slotCount) {
      const blockedSlots = currentLayout.slots.filter(
        (s) => s.rowId === rowId && s.slotNumber > nextCount && s.hasAnyCoil
      );
      if (blockedSlots.length > 0) {
        setRowManagerError(
          isThai
            ? `ไม่สามารถลดจำนวนช่องแถว ${rowId} ได้ เนื่องจากช่อง ${blockedSlots
                .map((s) => s.basketCode)
                .join(", ")} ยังมีเหล็กสลิตวางอยู่`
            : `Cannot shrink row ${rowId}: active stock in ${blockedSlots
                .map((s) => s.basketCode)
                .join(", ")}.`
        );
        return;
      }
    }

    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: {
          ...bCfg,
          rows: bCfg.rows.map((r) =>
            r.rowId === rowId ? { ...r, slotCount: nextCount } : r
          ),
        },
      },
      updatedAt: new Date().toISOString(),
    };
    await persistConfigUpdate(nextConfig);
  };

  const handleDeleteRow = async (rowId: string) => {
    const bCfg = warehouseConfig.buildings[selectedBuilding];
    if (bCfg.rows.length <= 1) {
      setRowManagerError(
        isThai
          ? "ต้องมีแถวอย่างน้อย 1 แถวในแต่ละอาคาร"
          : "At least 1 row must remain."
      );
      return;
    }

    const hasStockInRow = currentLayout.slots.some(
      (s) => s.rowId === rowId && s.hasAnyCoil
    );
    if (hasStockInRow) {
      setRowManagerError(
        isThai
          ? `ไม่สามารถลบแถว ${rowId} ได้ เนื่องจากยังมีม้วนเหล็กสลิตจัดเก็บอยู่ กรุณาย้ายหรือเบิกออกก่อน`
          : `Cannot delete row ${rowId} while coils are stored in it.`
      );
      return;
    }

    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: {
          ...bCfg,
          rows: bCfg.rows.filter((r) => r.rowId !== rowId),
        },
      },
      updatedAt: new Date().toISOString(),
    };
    if (selectedSlot?.rowId === rowId) {
      setSelectedBasketCode(null);
      setSelectedLayer(null);
    }
    await persistConfigUpdate(nextConfig);
  };

  const handleResetBuildingToDefault = async () => {
    const hasStockOutsideDefault = currentLayout.slots.some(
      (s) =>
        s.hasAnyCoil &&
        (!["A", "B", "C", "D"].includes(s.rowId) ||
          s.slotNumber > DEFAULT_SLOTS_PER_ROW)
    );
    if (hasStockOutsideDefault) {
      setRowManagerError(
        isThai
          ? "ไม่สามารถรีเซ็ตเป็น A–D (แถวละ 10 ช่อง) ได้ เนื่องจากมีเหล็กวางอยู่ในแถวหรือช่องที่เกินค่าเริ่มต้น"
          : "Cannot reset while coils exist outside A–D (10 slots)."
      );
      return;
    }
    const def = createDefaultBlueBasketConfig();
    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: def.buildings[selectedBuilding],
      },
      updatedAt: new Date().toISOString(),
    };
    await persistConfigUpdate(nextConfig);
  };

  // Filtered basket picker list for Step 3 of Inbound Drawer
  const step3BasketOptions = useMemo(() => {
    return inboundBuildingLayout.slots.filter(
      (s) =>
        inboundBasketRowFilter === "ALL" || s.rowId === inboundBasketRowFilter
    );
  }, [inboundBuildingLayout, inboundBasketRowFilter]);

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col gap-2 select-none overflow-hidden">
      {/* Compact Single-Screen Top Control Header (Solid crisp dark slate, zero backdrop-filter) */}
      <div className="shrink-0 rounded-2xl border border-slate-700/80 bg-slate-900 text-slate-100 px-3 py-2 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Compact Title + Building Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
                <Box className="w-4 h-4" />
              </div>
              <div className="leading-tight">
                <h2 className="text-sm font-extrabold tracking-tight text-white">
                  {isThai
                    ? "Location 3D ตะกร้าฟ้า"
                    : "3D Blue Basket Location"}
                </h2>
                <p className="text-[10px] text-slate-400 hidden sm:block">
                  {isThai
                    ? "E9 · H2 · F | แถว A–D | ≤ 2,000 มม. | ซ้อนสูงสุด 2 ชั้น"
                    : "E9 · H2 · F | Rows A–D | ≤ 2,000 mm | Max 2 Layers"}
                </p>
              </div>
            </div>

            {/* Building Tabs: E9, H2, F */}
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-xl border border-slate-800">
              {BLUE_BASKET_BUILDINGS.map((bId) => {
                const bLayout = allBuildingLayouts[bId];
                const active = selectedBuilding === bId;
                return (
                  <button
                    key={bId}
                    type="button"
                    onClick={() => {
                      setSelectedBuilding(bId);
                      setSelectedBasketCode(null);
                      setSelectedLayer(null);
                      setFocusedBasketCode(null);
                      setSearchFeedback(null);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-all flex items-center gap-1.5 cursor-pointer ${
                      active
                        ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <Building2 className="w-3 h-3" />
                    <span>{isThai ? `อาคาร ${bId}` : bId}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        active
                          ? "bg-white/20 text-white"
                          : "bg-slate-800 text-sky-300"
                      }`}
                    >
                      {bLayout.stats.totalCoils}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Actions: Search + 4-Step Inbound + Manage Rows + Reference */}
          <div className="flex flex-wrap items-center gap-1.5">
            <form
              onSubmit={handleSearchSubmit}
              className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-xl px-2 py-1 w-[195px] sm:w-[215px]"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isThai
                    ? "ค้นหา Batch / E9-A01"
                    : "Search Batch / E9-A01"
                }
                className="bg-transparent text-[11px] text-white placeholder-slate-500 outline-none w-full"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchFeedback(null);
                    setFocusedBasketCode(null);
                  }}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <button
                type="submit"
                className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sky-300 cursor-pointer shrink-0"
              >
                <Crosshair className="w-3 h-3" />
              </button>
            </form>

            <button
              type="button"
              onClick={() =>
                showInboundDrawer
                  ? setShowInboundDrawer(false)
                  : openInboundDrawer()
              }
              className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm ${
                showInboundDrawer
                  ? "bg-emerald-500 text-slate-950"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
            >
              <ScanBarcode className="w-3.5 h-3.5" />
              <span>
                {isThai ? "รับเข้าลงตะกร้าฟ้า" : "Inbound to Basket"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRowManagerError(null);
                setNewRowLabel(
                  getNextAvailableRowId(currentLayout.config.rows)
                );
                setShowRowManager(true);
              }}
              className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5 text-amber-400" />
              <span>{isThai ? "จัดการแถว A–D" : "Manage Rows"}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowReferenceModal(true)}
              className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
              title={isThai ? "ดูภาพแบบตะกร้าฟ้าอ้างอิง" : "View Basket Reference"}
            >
              <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden md:inline">
                {isThai ? "แบบตะกร้า" : "Reference"}
              </span>
            </button>
          </div>
        </div>

        {/* Slim Single-Line Inline KPI Strip (Zero vertical bloat) */}
        <div className="mt-1.5 pt-1.5 border-t border-slate-800/90 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold">
              {isThai ? "ช่องใช้งาน:" : "Occupied:"}
            </span>
            <span className="font-black text-white tabular-nums">
              {currentLayout.stats.occupiedSlots}/{currentLayout.stats.totalSlots}
            </span>
          </div>

          <div className="flex items-center gap-1 text-sky-300">
            <Layers className="w-3 h-3" />
            <span className="text-slate-400 font-semibold">
              {isThai ? "ซ้อน 2 ชั้น:" : "2-Layer:"}
            </span>
            <span className="font-black tabular-nums">
              {currentLayout.stats.stacked2LayerCount} จุด
            </span>
          </div>

          <div className="flex items-center gap-1 text-emerald-400">
            <Package className="w-3 h-3" />
            <span className="text-slate-400 font-semibold">
              {isThai ? "ม้วนสลิต:" : "Coils:"}
            </span>
            <span className="font-black tabular-nums">
              {currentLayout.stats.totalCoils.toLocaleString()} ม้วน
            </span>
          </div>

          <div className="flex items-center gap-1 text-white">
            <Scale className="w-3 h-3 text-blue-400" />
            <span className="text-slate-400 font-semibold">
              {isThai ? "น้ำหนัก:" : "Weight:"}
            </span>
            <span className="font-black tabular-nums">
              {currentLayout.stats.totalWeightTons.toFixed(2)} ตัน
            </span>
          </div>

          <div className="flex items-center gap-1 text-amber-400">
            <Ruler className="w-3 h-3" />
            <span className="text-slate-400 font-semibold">
              {isThai ? "เต็มเฉลี่ย:" : "Avg Fill:"}
            </span>
            <span className="font-black tabular-nums">
              {currentLayout.stats.avgUtilizationPercent}%
            </span>
          </div>

          <div className="flex items-center gap-1 text-rose-400">
            <span className="text-slate-400 font-semibold">
              {isThai ? "เต็ม/ใกล้เต็ม:" : "Full/Near:"}
            </span>
            <span className="font-black tabular-nums">
              {currentLayout.stats.fullLayers}
              <span className="text-amber-400">
                /{currentLayout.stats.nearFullLayers}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Split Workspace: Fills 100% Remaining Viewport Height (Zero Page Scrollbar) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-2 items-stretch overflow-hidden">
        {/* 3D Interactive Canvas Container */}
        <div
          className={`relative h-full min-h-0 rounded-2xl border border-slate-700/80 bg-slate-950 overflow-hidden shadow-xl ${
            showInboundDrawer || selectedSlot
              ? "xl:col-span-8"
              : "xl:col-span-12"
          }`}
        >
          {/* Three.js Canvas Host */}
          <div ref={canvasHostRef} className="w-full h-full" />

          {/* WebGL Error Fallback */}
          {webglError && (
            <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center z-30">
              <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
              <h3 className="text-base font-bold text-white mb-1">
                {isThai ? "ไม่สามารถแสดงผลฉาก 3D ได้" : "Unable to render 3D Scene"}
              </h3>
              <p className="text-xs text-slate-400 max-w-md">{webglError}</p>
            </div>
          )}

          {/* Top-Left Compact Building Tag */}
          <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none flex flex-wrap items-center gap-1.5">
            <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-700 text-[11px] font-extrabold text-white flex items-center gap-1.5 shadow-md">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>
                {BLUE_BASKET_BUILDING_META[selectedBuilding].nameTh} · แถว{" "}
                {currentLayout.config.rows.map((r) => r.rowId).join(", ")}
              </span>
            </div>
            {showInboundDrawer && (
              <div className="px-2.5 py-1 rounded-xl bg-emerald-950 border border-emerald-600/60 text-[11px] font-bold text-emerald-300 shadow-md">
                {isThai
                  ? "คลิกตะกร้าในฉาก 3D เพื่อเลือกช่องรับเข้าได้ทันที"
                  : "Click any 3D basket to pick inbound slot"}
              </div>
            )}
          </div>

          {/* Top-Right Floating Search Feedback & Toast Banners (Never shifts viewport height) */}
          {(searchFeedback || toastMessage) && (
            <div className="absolute top-2.5 right-2.5 z-20 flex flex-col items-end gap-1.5 max-w-md">
              {searchFeedback && (
                <div
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 border shadow-lg ${
                    searchFeedback.type === "found"
                      ? "bg-slate-900 text-purple-200 border-purple-500/60"
                      : "bg-slate-900 text-rose-200 border-rose-500/60"
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  <span>{searchFeedback.message}</span>
                  <button
                    type="button"
                    onClick={() => setSearchFeedback(null)}
                    className="ml-1 opacity-75 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {toastMessage && (
                <div
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 border shadow-lg ${
                    toastMessage.type === "success"
                      ? "bg-slate-900 text-emerald-200 border-emerald-500/60"
                      : toastMessage.type === "error"
                      ? "bg-slate-900 text-rose-200 border-rose-500/60"
                      : "bg-slate-900 text-sky-200 border-sky-500/60"
                  }`}
                >
                  {toastMessage.type === "success" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                  )}
                  <span>{toastMessage.text}</span>
                  <button
                    type="button"
                    onClick={() => setToastMessage(null)}
                    className="ml-1 opacity-75 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Hover Tooltip (Solid surface, no backdrop-filter) */}
          {hoverInfo && (
            <div
              className="fixed z-40 pointer-events-none rounded-xl bg-slate-900 border border-slate-600 px-3 py-2 text-xs text-slate-100 shadow-2xl min-w-[195px]"
              style={{
                left: Math.min(
                  hoverInfo.clientX + 16,
                  typeof window !== "undefined" ? window.innerWidth - 230 : 800
                ),
                top: Math.max(hoverInfo.clientY - 12, 12),
              }}
            >
              <div className="flex items-center justify-between gap-2 pb-1 mb-1 border-b border-slate-700">
                <span className="font-black text-sky-300">
                  {hoverInfo.slot.basketCode}
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  {isThai ? `ชั้น ${hoverInfo.layer}` : `L${hoverInfo.layer}`}
                </span>
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">ชั้น 1 (ฐาน):</span>
                  <span className="font-bold text-white tabular-nums">
                    {hoverInfo.slot.layer1.usedWidthMm.toLocaleString()} /{" "}
                    {MAX_BASKET_WIDTH_MM} มม. ({hoverInfo.slot.layer1.coils.length} ม้วน)
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">ชั้น 2 (ซ้อน):</span>
                  <span className="font-bold text-sky-300 tabular-nums">
                    {hoverInfo.slot.layer2.usedWidthMm.toLocaleString()} /{" "}
                    {MAX_BASKET_WIDTH_MM} มม. ({hoverInfo.slot.layer2.coils.length} ม้วน)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Bottom 3D Control Dock */}
          <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-col items-center pointer-events-none">
            <div className="pointer-events-auto">
              <button
                type="button"
                onClick={() => setDockVisible((v) => !v)}
                className="px-3.5 py-1.5 rounded-t-xl bg-slate-900 border border-b-0 border-slate-700 text-[11px] font-bold text-slate-200 hover:text-white flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
                <span>
                  {dockVisible
                    ? isThai
                      ? "ซ่อนแถบควบคุม 3D"
                      : "Hide 3D Controls"
                    : isThai
                    ? "แสดงแถบควบคุม 3D · มุมกล้อง / ตัวกรอง / สีสถานะ"
                    : "Show 3D Controls"}
                </span>
                {dockVisible ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {dockVisible && (
              <div className="pointer-events-auto w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-700 p-3 shadow-2xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Camera Presets */}
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { id: "isometric", label: "Isometric" },
                        { id: "top", label: "Top" },
                        { id: "front", label: "Front" },
                        { id: "side", label: "Side" },
                        { id: "reset", label: "Reset" },
                      ] as const
                    ).map((cam) => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => handleCameraPreset(cam.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1 ${
                          activeCameraPreset === cam.id
                            ? "bg-blue-600 text-white"
                            : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        {cam.id === "reset" && (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        <span>{cam.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Filters: Row / Layer / Status */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={rowFilter}
                      onChange={(e) => setRowFilter(e.target.value)}
                      className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold outline-none"
                    >
                      <option value="ALL">แถวทั้งหมด</option>
                      {currentLayout.config.rows.map((r) => (
                        <option key={r.rowId} value={r.rowId}>
                          แถว {r.rowId} ({r.slotCount} ช่อง)
                        </option>
                      ))}
                    </select>

                    <select
                      value={layerFilter}
                      onChange={(e) =>
                        setLayerFilter(e.target.value as "ALL" | "1" | "2")
                      }
                      className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold outline-none"
                    >
                      <option value="ALL">ทุกชั้น (ชั้น 1–2)</option>
                      <option value="1">เฉพาะชั้น 1 (ฐานล่าง)</option>
                      <option value="2">เฉพาะชั้น 2 (ซ้อนบน)</option>
                    </select>

                    <select
                      value={statusFilter}
                      onChange={(e) =>
                        setStatusFilter(
                          e.target.value as
                            | "ALL"
                            | "EMPTY"
                            | "OCCUPIED"
                            | "NEAR_FULL_OR_FULL"
                        )
                      }
                      className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold outline-none"
                    >
                      <option value="ALL">สถานะทั้งหมด</option>
                      <option value="EMPTY">เฉพาะช่องว่าง</option>
                      <option value="OCCUPIED">เฉพาะที่มีเหล็ก</option>
                      <option value="NEAR_FULL_OR_FULL">
                        ใกล้เต็ม / เต็ม 2 ม.
                      </option>
                    </select>
                  </div>
                </div>

                {/* Color Legend */}
                <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                      ตะกร้าเปล่าชั้น 1 (0 มม.)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                      กำลังบรรจุ (&lt;1,600 มม.)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      ใกล้เต็ม (1,600–1,999 มม.)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      เต็มพิกัด (2,000 มม.)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                      ตำแหน่งที่เลือก / ค้นพบ
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    ลากเพื่อหมุน · เลื่อนล้อเมาส์เพื่อซูม · คลิกตะกร้าเพื่อดูชั้น 1–2
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side Panel: 4-Step Guided Inbound Drawer OR Basket Layer 1/2 Inspector */}
        {(showInboundDrawer || selectedSlot) && (
          <div className="xl:col-span-4 h-full min-h-0 rounded-2xl border border-slate-700/80 bg-slate-900 text-slate-100 shadow-xl flex flex-col overflow-hidden">
            {/* Mode Toggle Header when both are relevant */}
            <div className="p-3 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-950/70">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowInboundDrawer(true)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer ${
                    showInboundDrawer
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-300 hover:text-white"
                  }`}
                >
                  <ScanBarcode className="w-3.5 h-3.5" />
                  <span>รับเข้า 4 สเต็ป</span>
                </button>
                {selectedSlot && (
                  <button
                    type="button"
                    onClick={() => setShowInboundDrawer(false)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer ${
                      !showInboundDrawer
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>รายละเอียด {selectedSlot.basketCode}</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowInboundDrawer(false);
                  setSelectedBasketCode(null);
                  setSelectedLayer(null);
                  setCameraScanTarget(null);
                }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* PANEL A: 4-Step Guided Inbound Flow */}
            {showInboundDrawer ? (
              <div className="p-3.5 overflow-y-auto flex-1 space-y-3.5">
                {/* 4-Step Progress Indicator: สแกน Batch >> อาคาร >> สแกนเบอร์ตะกร้า >> เลือกชั้น */}
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      { step: 1 as const, label: "1. สแกน Batch" },
                      { step: 2 as const, label: "2. อาคาร" },
                      { step: 3 as const, label: "3. เบอร์ตะกร้า" },
                      { step: 4 as const, label: "4. เลือกชั้น" },
                    ] as const
                  ).map((item) => {
                    const isCurrent = inboundStep === item.step;
                    const isDone =
                      (item.step === 1 && Boolean(normalizedInboundBatch)) ||
                      (item.step === 2 && inboundStep > 2) ||
                      (item.step === 3 && Boolean(inboundTargetSlot)) ||
                      false;
                    return (
                      <button
                        key={item.step}
                        type="button"
                        onClick={() => setInboundStep(item.step)}
                        className={`px-1.5 py-2 rounded-xl text-[10px] font-extrabold text-center border transition-all cursor-pointer ${
                          isCurrent
                            ? "bg-emerald-600/25 border-emerald-400 text-emerald-200"
                            : isDone
                            ? "bg-blue-600/15 border-blue-500/40 text-blue-200"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {/* Camera Barcode Scanner Inline Widget */}
                {cameraScanTarget && (
                  <div className="rounded-xl border border-sky-500/50 bg-slate-950 p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-sky-300">
                        {cameraScanTarget === "batch"
                          ? "กำลังสแกนบาร์โค้ด Batch..."
                          : "กำลังสแกนเบอร์ตะกร้า (เช่น E9-A01)..."}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCameraScanTarget(null)}
                        className="text-xs text-slate-400 hover:text-white cursor-pointer"
                      >
                        ปิดกล้อง
                      </button>
                    </div>
                    <CameraBarcodeScanner
                      isThai={isThai}
                      onClose={() => setCameraScanTarget(null)}
                      onScan={(text) => {
                        const cleaned = text.trim().toUpperCase();
                        setCameraScanTarget(null);
                        if (cameraScanTarget === "batch") {
                          handleConfirmStep1Batch(cleaned);
                        } else {
                          handleApplyBasketCodeInput(cleaned);
                        }
                      }}
                    />
                  </div>
                )}

                {/* STEP 1: สแกน Batch */}
                <div
                  className={`rounded-xl border p-3 space-y-2.5 ${
                    inboundStep === 1
                      ? "border-emerald-500/60 bg-slate-950"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-emerald-400">
                      ขั้นที่ 1 · สแกน Batch เหล็กสลิต
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCameraScanTarget(
                          cameraScanTarget === "batch" ? null : "batch"
                        )
                      }
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-sky-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>กล้องสแกน</span>
                    </button>
                  </div>

                  <div className="flex gap-1.5">
                    <input
                      ref={batchInputRef}
                      type="text"
                      value={inboundBatchInput}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase();
                        setInboundBatchInput(v);
                        const sap = sapMasterMap.get(v.trim());
                        const w = parseWidthMm(sap?.width);
                        if (w !== null) setInboundManualWidth(String(w));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleConfirmStep1Batch();
                        }
                      }}
                      placeholder="ยิงบาร์โค้ดหรือพิมพ์ Batch (เช่น 26SL00189A)"
                      className="flex-1 rounded-xl bg-slate-900 border border-slate-700 focus:border-emerald-400 px-3 py-2 text-sm font-mono font-bold text-white outline-none"
                    />
                    <button
                      type="button"
                      disabled={!normalizedInboundBatch}
                      onClick={() => handleConfirmStep1Batch()}
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-extrabold text-white cursor-pointer flex items-center gap-1"
                    >
                      <span>ถัดไป</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Machine Source Quick Chips */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-bold text-slate-400 mr-1">
                      รับจาก:
                    </span>
                    {INBOUND_MACHINES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setInboundMachine(m)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer ${
                          inboundMachine === m
                            ? "bg-blue-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* SAP Data Preview + Width Control */}
                  {normalizedInboundBatch && (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
                      {inboundSapItem ? (
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <div>
                            <span className="text-slate-400">เกรด:</span>{" "}
                            <span className="font-bold text-white">
                              {inboundSapItem.grade || "-"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">หนา:</span>{" "}
                            <span className="font-bold text-white">
                              {inboundSapItem.certThickness || "-"} มม.
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">น้ำหนัก:</span>{" "}
                            <span className="font-bold text-emerald-300">
                              {(inboundSapItem.weightKg || 0).toLocaleString()}{" "}
                              กก.
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">หน้ากว้าง SAP:</span>{" "}
                            <span className="font-black text-sky-300">
                              {sapWidthMm !== null
                                ? `${sapWidthMm.toLocaleString()} มม.`
                                : "ไม่ระบุ"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-amber-300 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>
                            ยังไม่พบข้อมูล SAP สำหรับ Batch นี้ — กรุณาระบุหน้ากว้าง (มม.) ด้านล่างเพื่อตรวจเงื่อนไขไม่เกิน 2,000 มม.
                          </span>
                        </div>
                      )}

                      {existingActiveRecordForBatch && (
                        <div className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg px-2 py-1">
                          Batch นี้มีในระบบแล้วที่{" "}
                          <strong>{existingActiveRecordForBatch.location}</strong>{" "}
                          — หากยืนยันจะอัปเดตย้ายมาลงตะกร้าใหม่ทันที
                        </div>
                      )}

                      {/* Width (mm) input + presets */}
                      <div className="space-y-1.5 pt-1 border-t border-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-bold text-slate-300">
                            หน้ากว้างม้วนสลิต (มม.):
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={10}
                              max={2000}
                              step={1}
                              value={inboundManualWidth || effectiveInboundWidthMm}
                              onChange={(e) =>
                                setInboundManualWidth(e.target.value)
                              }
                              className="w-24 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-right text-xs font-black text-sky-300 outline-none"
                            />
                            <span className="text-[11px] text-slate-400">มม.</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {QUICK_WIDTH_PRESETS.map((w) => (
                            <button
                              key={w}
                              type="button"
                              onClick={() => setInboundManualWidth(String(w))}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                effectiveInboundWidthMm === w
                                  ? "bg-sky-600 text-white"
                                  : "bg-slate-800 text-slate-400 hover:text-white"
                              }`}
                            >
                              {w}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* STEP 2: เลือกอาคาร (E9 / H2 / F) */}
                <div
                  className={`rounded-xl border p-3 space-y-2 ${
                    inboundStep === 2
                      ? "border-emerald-500/60 bg-slate-950"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="text-xs font-extrabold text-sky-400">
                    ขั้นที่ 2 · เลือกอาคารตะกร้าฟ้า
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {BLUE_BASKET_BUILDINGS.map((bId) => {
                      const active = inboundBuilding === bId;
                      const stats = allBuildingLayouts[bId].stats;
                      return (
                        <button
                          key={bId}
                          type="button"
                          onClick={() => {
                            setInboundBuilding(bId);
                            setSelectedBuilding(bId);
                            setInboundBasketRowFilter("ALL");
                            setInboundStep(3);
                          }}
                          className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                            active
                              ? "bg-blue-600 border-blue-400 text-white shadow-md"
                              : "bg-slate-900 border-slate-700 text-slate-200 hover:border-blue-500"
                          }`}
                        >
                          <div className="text-sm font-black">อาคาร {bId}</div>
                          <div className="text-[10px] opacity-80 mt-0.5">
                            {stats.occupiedSlots}/{stats.totalSlots} ช่อง
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* STEP 3: สแกนเบอร์ตะกร้า */}
                <div
                  className={`rounded-xl border p-3 space-y-2.5 ${
                    inboundStep === 3
                      ? "border-emerald-500/60 bg-slate-950"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-sky-400">
                      ขั้นที่ 3 · สแกนเบอร์ตะกร้า ({inboundBuilding})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCameraScanTarget(
                          cameraScanTarget === "basket" ? null : "basket"
                        )
                      }
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-sky-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>กล้องสแกน</span>
                    </button>
                  </div>

                  <div className="flex gap-1.5">
                    <input
                      ref={basketInputRef}
                      type="text"
                      value={inboundBasketInput}
                      onChange={(e) =>
                        setInboundBasketInput(e.target.value.toUpperCase())
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleApplyBasketCodeInput();
                        }
                      }}
                      placeholder={`เช่น ${inboundBuilding}-A01`}
                      className="flex-1 rounded-xl bg-slate-900 border border-slate-700 focus:border-sky-400 px-3 py-2 text-sm font-mono font-bold text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleApplyBasketCodeInput()}
                      className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-extrabold text-white cursor-pointer"
                    >
                      เลือก
                    </button>
                  </div>

                  {/* Quick Row Filter & Basket Slot Chips */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setInboundBasketRowFilter("ALL")}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                          inboundBasketRowFilter === "ALL"
                            ? "bg-sky-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        ทุกแถว
                      </button>
                      {inboundBuildingLayout.config.rows.map((r) => (
                        <button
                          key={r.rowId}
                          type="button"
                          onClick={() => setInboundBasketRowFilter(r.rowId)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                            inboundBasketRowFilter === r.rowId
                              ? "bg-sky-600 text-white"
                              : "bg-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          แถว {r.rowId}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-5 gap-1 max-h-28 overflow-y-auto pr-0.5">
                      {step3BasketOptions.map((slot) => {
                        const isPicked =
                          resolvedInboundBasketCode === slot.basketCode;
                        const bothFull =
                          slot.layer1.remainingWidthMm <
                            effectiveInboundWidthMm &&
                          slot.layer2.remainingWidthMm <
                            effectiveInboundWidthMm;
                        return (
                          <button
                            key={slot.basketCode}
                            type="button"
                            onClick={() =>
                              handleApplyBasketCodeInput(slot.basketCode)
                            }
                            className={`px-1.5 py-1.5 rounded-lg border text-center text-[10px] font-bold cursor-pointer transition-all ${
                              isPicked
                                ? "bg-blue-600 border-blue-300 text-white"
                                : bothFull
                                ? "bg-rose-950/50 border-rose-800/60 text-rose-300"
                                : slot.hasAnyCoil
                                ? "bg-slate-900 border-sky-700/50 text-sky-200 hover:border-sky-400"
                                : "bg-slate-900 border-slate-800 text-emerald-300 hover:border-emerald-400"
                            }`}
                          >
                            <div>{slot.rowId}{String(slot.slotNumber).padStart(2, "0")}</div>
                            <div className="text-[9px] opacity-80">
                              {slot.totalCoils > 0
                                ? `${slot.totalCoils}ม้วน`
                                : "ว่าง"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* STEP 4: เลือกชั้น (ชั้น 1 / ชั้น 2) + ตรวจสอบไม่เกิน 2,000 มม. */}
                <div
                  className={`rounded-xl border p-3 space-y-2.5 ${
                    inboundStep === 4
                      ? "border-emerald-500/60 bg-slate-950"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-400">
                      ขั้นที่ 4 · เลือกชั้น (สูงสุด 2 ชั้น · ≤ 2,000 มม.)
                    </span>
                    {inboundTargetSlot && (
                      <span className="text-xs font-black text-sky-300">
                        {inboundTargetSlot.basketCode}
                      </span>
                    )}
                  </div>

                  {!inboundTargetSlot ? (
                    <div className="text-xs text-slate-400 py-2 text-center">
                      กรุณาสแกนหรือคลิกเลือกเบอร์ตะกร้าในขั้นที่ 3 ก่อน
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            {
                              layer: 1 as const,
                              title: "ชั้น 1 (ฐานล่าง)",
                              state: inboundTargetSlot.layer1,
                              validation: validationL1,
                            },
                            {
                              layer: 2 as const,
                              title: "ชั้น 2 (ซ้อนบน)",
                              state: inboundTargetSlot.layer2,
                              validation: validationL2,
                            },
                          ] as const
                        ).map((card) => {
                          const picked = inboundLayer === card.layer;
                          const overLimit = card.validation.overflowMm > 0;
                          const projectedPct = Math.min(
                            100,
                            Math.round(
                              (card.validation.nextUsedWidthMm /
                                MAX_BASKET_WIDTH_MM) *
                                100
                            )
                          );
                          return (
                            <button
                              key={card.layer}
                              type="button"
                              onClick={() => {
                                setInboundLayer(card.layer);
                                setConfirmEmptyLayer1(false);
                                engineRef.current?.focusBasket(
                                  inboundTargetSlot.basketCode,
                                  card.layer
                                );
                              }}
                              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer space-y-1.5 ${
                                picked
                                  ? overLimit
                                    ? "bg-rose-950/60 border-rose-400"
                                    : "bg-blue-600/20 border-sky-400"
                                  : "bg-slate-900 border-slate-800 hover:border-slate-600"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-black text-white">
                                  {card.title}
                                </span>
                                {picked && (
                                  <Check className="w-3.5 h-3.5 text-sky-300" />
                                )}
                              </div>
                              <div className="text-[10px] text-slate-300 tabular-nums">
                                เดิม {card.state.usedWidthMm.toLocaleString()} +{" "}
                                <span className="text-emerald-300 font-bold">
                                  {effectiveInboundWidthMm}
                                </span>{" "}
                                มม.
                              </div>
                              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                                <div
                                  className={`h-full transition-all ${
                                    overLimit
                                      ? "bg-rose-500"
                                      : projectedPct >= 80
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                  }`}
                                  style={{ width: `${projectedPct}%` }}
                                />
                              </div>
                              <div
                                className={`text-[10px] font-bold ${
                                  overLimit
                                    ? "text-rose-400"
                                    : "text-emerald-300"
                                }`}
                              >
                                {overLimit
                                  ? `เกิน ${card.validation.overflowMm.toLocaleString()} มม.`
                                  : `เหลือ ${card.validation.nextRemainingWidthMm.toLocaleString()} มม.`}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Layer 2 empty Layer 1 advisory confirmation */}
                      {inboundLayer === 2 &&
                        inboundTargetSlot.layer1.coils.length === 0 && (
                          <label className="flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/40 p-2.5 text-[11px] text-amber-200 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={confirmEmptyLayer1}
                              onChange={(e) =>
                                setConfirmEmptyLayer1(e.target.checked)
                              }
                              className="mt-0.5 accent-amber-500"
                            />
                            <span>
                              ชั้น 1 ยังไม่มีม้วนเหล็กในระบบ — ติ๊กยืนยันหากมีตะกร้าเปล่ารองรับที่ชั้น 1 หน้างานแล้ว
                            </span>
                          </label>
                        )}

                      {/* Hard Block Error Message (> 2,000 mm) */}
                      {!activeLayerValidation.ok &&
                        activeLayerValidation.reasonTh && (
                          <div className="rounded-xl bg-rose-500/15 border border-rose-500/50 p-2.5 text-[11px] font-bold text-rose-200 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <span>{activeLayerValidation.reasonTh}</span>
                          </div>
                        )}

                      {/* Final Target Summary & Submit */}
                      <div className="rounded-xl bg-slate-900 border border-slate-800 p-2.5 flex items-center justify-between text-xs">
                        <span className="text-slate-400">Location ปลายทาง:</span>
                        <span className="font-mono font-black text-emerald-300 text-sm">
                          {formatBasketLayerLocation(
                            inboundTargetSlot.basketCode,
                            inboundLayer
                          )}
                        </span>
                      </div>

                      <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={keepTargetAfterSave}
                          onChange={(e) =>
                            setKeepTargetAfterSave(e.target.checked)
                          }
                          className="accent-emerald-500"
                        />
                        <span>
                          รับเข้าต่อเนื่องในตะกร้าเดิม (สแกน Batch ถัดไปได้ทันที)
                        </span>
                      </label>

                      <button
                        type="button"
                        disabled={
                          isSavingInbound ||
                          !normalizedInboundBatch ||
                          !activeLayerValidation.ok
                        }
                        onClick={handleSaveInboundPlacement}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-black text-white shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {isSavingInbound
                            ? "กำลังบันทึก..."
                            : `ยืนยันรับเข้า ${formatBasketLayerLocation(
                                inboundTargetSlot.basketCode,
                                inboundLayer
                              )}`}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : selectedSlot ? (
              /* PANEL B: Basket Layer 1 & Layer 2 Inspector */
              <div className="p-3.5 overflow-y-auto flex-1 space-y-3">
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold text-slate-400">
                      อาคาร {selectedSlot.buildingId} · แถว {selectedSlot.rowId} ช่อง{" "}
                      {String(selectedSlot.slotNumber).padStart(2, "0")}
                    </div>
                    <div className="text-lg font-black text-white font-mono">
                      {selectedSlot.basketCode}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-extrabold text-emerald-400">
                      {selectedSlot.totalCoils} ม้วน
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {(selectedSlot.totalWeightKg / 1000).toFixed(2)} ตัน
                    </div>
                  </div>
                </div>

                {/* Display Layer 2 on top, Layer 1 on bottom (matches physical stacking) */}
                {[selectedSlot.layer2, selectedSlot.layer1].map((layerObj) => {
                  const isLayerHighlighted = selectedLayer === layerObj.layer;
                  return (
                    <div
                      key={layerObj.layer}
                      className={`rounded-xl border p-3 space-y-2.5 ${
                        isLayerHighlighted
                          ? "bg-slate-950 border-sky-500/60"
                          : "bg-slate-950/70 border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-xs font-black text-sky-300">
                            {layerObj.layer === 2
                              ? "ชั้น 2 (ซ้อนบน)"
                              : "ชั้น 1 (ฐานล่าง)"}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${getStatusBadgeClasses(
                              layerObj.status
                            )}`}
                          >
                            {layerObj.utilizationPercent}%
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            openInboundDrawer({
                              buildingId: selectedSlot.buildingId,
                              basketCode: selectedSlot.basketCode,
                              layer: layerObj.layer,
                            })
                          }
                          disabled={layerObj.remainingWidthMm <= 0}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-[11px] font-extrabold text-white flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>รับเข้าชั้นนี้</span>
                        </button>
                      </div>

                      {/* Width Capacity Bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] tabular-nums">
                          <span className="text-slate-300 font-bold">
                            หน้ากว้างสะสม:{" "}
                            {layerObj.usedWidthMm.toLocaleString()} /{" "}
                            {MAX_BASKET_WIDTH_MM.toLocaleString()} มม.
                          </span>
                          <span className="text-emerald-300 font-bold">
                            เหลือ {layerObj.remainingWidthMm.toLocaleString()} มม.
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full transition-all ${getStatusBarColor(
                              layerObj.status
                            )}`}
                            style={{ width: `${layerObj.utilizationPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Coils List inside this layer */}
                      {layerObj.coils.length === 0 ? (
                        <div className="text-[11px] text-slate-500 py-2 text-center border border-dashed border-slate-800 rounded-lg">
                          ว่าง — รองรับได้สูงสุด 2,000 มม.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {layerObj.coils.map((coil) => (
                            <div
                              key={coil.record.id}
                              className="rounded-lg bg-slate-900 border border-slate-800 p-2 text-[11px] space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-black text-white">
                                  {coil.batch}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-bold tabular-nums">
                                    {coil.widthMm.toLocaleString()} มม.
                                  </span>
                                  {confirmDeleteRecordId === coil.record.id ? (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleDeleteCoilRecord(coil.record)
                                        }
                                        className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold cursor-pointer"
                                      >
                                        ยืนยันลบ
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteRecordId(null)
                                        }
                                        className="px-1 py-0.5 rounded bg-slate-700 text-slate-200 text-[10px] cursor-pointer"
                                      >
                                        ยกเลิก
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDeleteRecordId(coil.record.id)
                                      }
                                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                                      title="นำม้วนเหล็กนี้ออกจากตะกร้า"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-slate-400">
                                <span>เกรด: {coil.grade}</span>
                                <span>หนา: {coil.thickness}</span>
                                <span>
                                  น้ำหนัก: {coil.weightKg.toLocaleString()} กก.
                                </span>
                                {!coil.hasSapData && (
                                  <span className="text-amber-400 font-bold">
                                    รอข้อมูล SAP
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Modal 1: Row & Slot Manager (จัดการแถว A–D เพิ่ม/ลบแถว & ปรับจำนวนช่อง) */}
      {showRowManager && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 text-slate-100 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div>
                <h3 className="text-sm font-black text-white">
                  จัดการแถวตะกร้าฟ้า — อาคาร {selectedBuilding}
                </h3>
                <p className="text-[11px] text-slate-400">
                  เพิ่ม/ลบแถว (A, B, C, D, ...) และปรับจำนวนช่องตะกร้าต่อแถว (1–30 ช่อง) · ซิงก์คลาวด์ทันที
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRowManager(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* Building Quick Switcher inside Modal */}
              <div className="flex items-center gap-1.5">
                {BLUE_BASKET_BUILDINGS.map((bId) => (
                  <button
                    key={bId}
                    type="button"
                    onClick={() => {
                      setSelectedBuilding(bId);
                      setRowManagerError(null);
                      setNewRowLabel(
                        getNextAvailableRowId(
                          warehouseConfig.buildings[bId].rows
                        )
                      );
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer ${
                      selectedBuilding === bId
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    อาคาร {bId}
                  </button>
                ))}
              </div>

              {rowManagerError && (
                <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 px-3 py-2 text-xs font-bold text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{rowManagerError}</span>
                </div>
              )}

              {/* Existing Rows List */}
              <div className="space-y-2">
                {currentLayout.rowPositions.map((rp) => (
                  <div
                    key={rp.rowId}
                    className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-black text-white flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs">
                          แถว {rp.rowId}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          {formatBasketCode(selectedBuilding, rp.rowId, 1)} –{" "}
                          {formatBasketCode(
                            selectedBuilding,
                            rp.rowId,
                            rp.slotCount
                          )}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        ใช้งาน {rp.occupiedSlots}/{rp.slotCount} ช่อง ·{" "}
                        {rp.totalCoils} ม้วนสลิต
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1">
                        <button
                          type="button"
                          disabled={
                            isSavingLayout || rp.slotCount <= MIN_SLOTS_PER_ROW
                          }
                          onClick={() => handleChangeRowSlotCount(rp.rowId, -1)}
                          className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                          title="ลด 1 ช่อง"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-12 text-center text-xs font-black tabular-nums">
                          {rp.slotCount} ช่อง
                        </span>
                        <button
                          type="button"
                          disabled={
                            isSavingLayout || rp.slotCount >= MAX_SLOTS_PER_ROW
                          }
                          onClick={() => handleChangeRowSlotCount(rp.rowId, 1)}
                          className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                          title="เพิ่ม 1 ช่อง"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={isSavingLayout || rp.totalCoils > 0}
                        onClick={() => handleDeleteRow(rp.rowId)}
                        className="p-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-30 disabled:cursor-not-allowed text-rose-300 cursor-pointer"
                        title={
                          rp.totalCoils > 0
                            ? "ลบไม่ได้เพราะมีม้วนเหล็กวางอยู่ในแถวนี้"
                            : `ลบแถว ${rp.rowId}`
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add New Row Form */}
              <div className="rounded-xl bg-slate-950 border border-emerald-600/40 p-3 space-y-2">
                <div className="text-xs font-extrabold text-emerald-400">
                  + เพิ่มแถวตะกร้าใหม่ในอาคาร {selectedBuilding}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    maxLength={4}
                    value={newRowLabel}
                    onChange={(e) =>
                      setNewRowLabel(e.target.value.toUpperCase())
                    }
                    placeholder="ชื่อแถว เช่น E"
                    className="w-28 rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-black text-white outline-none"
                  />
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400">จำนวนช่อง:</span>
                    <input
                      type="number"
                      min={MIN_SLOTS_PER_ROW}
                      max={MAX_SLOTS_PER_ROW}
                      value={newRowSlots}
                      onChange={(e) =>
                        setNewRowSlots(
                          parseInt(e.target.value, 10) || DEFAULT_SLOTS_PER_ROW
                        )
                      }
                      className="w-16 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs font-black text-center text-white outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isSavingLayout}
                    onClick={handleAddRow}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-extrabold text-white flex items-center gap-1 cursor-pointer ml-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>เพิ่มแถว</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
              <button
                type="button"
                disabled={isSavingLayout}
                onClick={handleResetBuildingToDefault}
                className="text-xs font-bold text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>รีเซ็ตเป็น A–D (แถวละ 10 ช่อง)</span>
              </button>
              <button
                type="button"
                onClick={() => setShowRowManager(false)}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-extrabold text-white cursor-pointer"
              >
                เสร็จสิ้น
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Reference Blue Basket Blueprint & Stacking Rules (User's 3 Attached Images) */}
      {showReferenceModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-700 text-slate-100 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div>
                <h3 className="text-sm font-black text-white">
                  แบบมาตรฐานตะกร้าเหล็กสีฟ้า & เงื่อนไขการจัดเก็บ (อาคาร E9, H2, F)
                </h3>
                <p className="text-[11px] text-slate-400">
                  ผลรวมหน้ากว้างม้วนสลิตไม่เกิน 2,000 มม. (2 เมตร) ต่อตะกร้า · ซ้อนได้สูงสุดไม่เกิน 2 ชั้น
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowReferenceModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 max-h-[75vh] overflow-y-auto">
              {REFERENCE_IMAGES.map((img) => (
                <div
                  key={img.src}
                  className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden flex flex-col"
                >
                  <div className="bg-white p-2 aspect-square flex items-center justify-center">
                    <img
                      src={img.src}
                      alt={img.titleTh}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="p-3 space-y-1">
                    <div className="text-xs font-black text-sky-300">
                      {img.titleTh}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {img.captionTh}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
