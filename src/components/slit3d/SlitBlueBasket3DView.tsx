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
  H2_OPPOSITE_GATE_ID,
  isCradleRackBuilding,
  isDualRoadBuilding,
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
  {
    src: "/assets/aistudio/Gemini_Generated_Image_kn9y1mkn9y1mkn9y__1__c4398bf4.jpg",
    titleTh: "อาคาร E10 · แคร่เหล็กฐานสามเหลี่ยมขา 2 เมตร (แคร่เปล่า)",
    titleEn: "Building E10 · Empty 2m Triangular Steel Cradle Rack",
    captionTh:
      "โครงสร้างแคร่เหล็กหัวสามเหลี่ยม A-Frame พร้อมหมอนไม้รองรับ 2 ขายาว 2 เมตร และแผ่นไม้บุพนักพิงป้องกันรอย",
  },
  {
    src: "/assets/aistudio/Gemini_Generated_Image_kn9y1mkn9y1mkn9y_a42d0d5b.jpg",
    titleTh: "อาคาร E10 · การวางม้วนเหล็กสลิตพิงหัวแคร่ (ชั้นเดียว)",
    titleEn: "Building E10 · Slit Coils Loaded on Steel Cradle",
    captionTh:
      "วางม้วนเหล็กสลิตตั้งตรงบนหมอนไม้ยาว 2 เมตร พิงชิดหัวแคร่สามเหลี่ยม รวมหน้ากว้างไม่เกิน 2,000 มม. (ไม่ซ้อนชั้น)",
  },
  {
    src: "/assets/aistudio/Gemini_Generated_Image_xggvi3xggvi3xggv_f7bf0223.jpg",
    titleTh: "ผังคลัง 3 มิติ อาคาร E10 (ROW A + ถนนกลาง + SLITTING MACHINE)",
    titleEn: "Building E10 3D Warehouse Floorplan",
    captionTh:
      "ฝั่งซ้ายวางแคร่เหล็ก ROW A แถวเดียวชิดผนัง กลางอาคารเป็นถนนเส้นขอบเขตสีเหลือง ฝั่งขวาโซนพื้นเขียวติดตั้งเครื่องสลิตเหล็กวางเยื้องแนว ROW A",
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
  const [rowManagerSide, setRowManagerSide] = useState<"primary" | "opposite">(
    "primary"
  );
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

  // Build layouts for all buildings (E9, H2, F, E10) so building badges & cross-building search are instant
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
      E10: buildBuildingBasketLayout3D(
        "E10",
        warehouseConfig,
        activeStockRecords,
        sapMasterMap
      ),
    };
  }, [warehouseConfig, activeStockRecords, sapMasterMap]);

  const currentLayout = allBuildingLayouts[selectedBuilding];
  const isCurrentCradle = isCradleRackBuilding(selectedBuilding);

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
        effectiveInboundWidthMm
      ),
    [inboundTargetSlot, effectiveInboundWidthMm]
  );

  const validationL2 = useMemo(
    () =>
      validateBasketPlacement(
        inboundTargetSlot,
        2,
        effectiveInboundWidthMm
      ),
    [inboundTargetSlot, effectiveInboundWidthMm]
  );

  // Auto-reset inboundLayer back to Layer 1 whenever target blue basket has an empty Layer 1
  useEffect(() => {
    if (
      inboundTargetSlot &&
      !isCradleRackBuilding(inboundTargetSlot.buildingId) &&
      inboundTargetSlot.layer1.coils.length === 0 &&
      inboundLayer === 2
    ) {
      setInboundLayer(1);
    }
  }, [inboundTargetSlot, inboundLayer]);

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

      // If 4-step inbound drawer is open, clicking a 3D basket/cradle fills Step 3 automatically!
      if (showInboundDrawerRef.current) {
        setInboundBuilding(slot.buildingId);
        setInboundBasketInput(slot.basketCode);
        const isL1Empty = slot.layer1.coils.length === 0;
        let nextLayer: 1 | 2 = 1;
        if (isCradleRackBuilding(slot.buildingId) || isL1Empty) {
          nextLayer = 1;
        } else if (layer) {
          nextLayer = layer;
        } else if (
          slot.layer1.status === "FULL" ||
          slot.layer1.status === "OVERFLOW"
        ) {
          nextLayer = 2;
        }
        setInboundLayer(nextLayer);
        setInboundStep((prev) => (prev >= 2 ? 4 : prev));
        engineRef.current?.focusBasket(slot.basketCode, nextLayer);
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
        !isCradleRackBuilding(selectedBuilding) &&
        inboundBuilding === selectedBuilding &&
        inboundLayer === 2 &&
        inboundTargetSlot &&
        inboundTargetSlot.layer1.coils.length > 0 &&
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
    inboundTargetSlot,
    resolvedInboundBasketCode,
  ]);

  // Reset row/layer filter when switching building
  useEffect(() => {
    if (rowFilter !== "ALL") {
      const validDual =
        Boolean(currentLayout.dualRoadLayout) &&
        (rowFilter === `GATE:${currentLayout.dualRoadLayout?.primaryGateId}` ||
          rowFilter === `GATE:${currentLayout.dualRoadLayout?.oppositeGateId}` ||
          currentLayout.rowPositions.some(
            (rp) => `${rp.gateId}:${rp.rowId}` === rowFilter
          ));
      const validSingle =
        !currentLayout.dualRoadLayout &&
        currentLayout.config.rows.some((r) => r.rowId === rowFilter);
      if (!validDual && !validSingle) {
        setRowFilter("ALL");
      }
    }
    if (isCradleRackBuilding(selectedBuilding) && layerFilter !== "ALL") {
      setLayerFilter("ALL");
    }
    if (!isDualRoadBuilding(selectedBuilding) && rowManagerSide !== "primary") {
      setRowManagerSide("primary");
    }
  }, [currentLayout, rowFilter, selectedBuilding, layerFilter, rowManagerSide]);

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
            ? `พบ${isCradleRackBuilding(parsedBasket.buildingId) ? "แคร่เหล็ก" : "ตะกร้า"} ${slot.basketCode} (อาคาร ${parsedBasket.buildingId} · ${slot.totalCoils} ม้วน)`
            : `Found ${slot.basketCode} (${slot.totalCoils} coils)`,
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
              ? isCradleRackBuilding(bId)
                ? `พบ Batch ${matchedCoil.batch} ที่แคร่ ${slot.basketCode} (${matchedCoil.widthMm} มม.)`
                : `พบ Batch ${matchedCoil.batch} ที่ ${slot.basketCode} ชั้น ${matchedLayer} (${matchedCoil.widthMm} มม.)`
              : `Found ${matchedCoil.batch} at ${slot.basketCode}${isCradleRackBuilding(bId) ? "" : ` Layer ${matchedLayer}`}`,
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
        ? `ไม่พบ Batch หรือรหัสตำแหน่ง "${q}" ในอาคาร E9, H2, F, E10`
        : `No Batch or Location "${q}" found in E9, H2, F, E10`,
    });
  };

  // Open Inbound Drawer (optionally pre-targeted to a specific basket + layer)
  const openInboundDrawer = (preset?: {
    buildingId: BlueBasketBuildingId;
    basketCode: string;
    layer: 1 | 2;
  }) => {
    setShowInboundDrawer(true);
    setCameraScanTarget(null);
    if (preset) {
      const presetSlot = allBuildingLayouts[preset.buildingId]?.slotByCode.get(
        preset.basketCode
      );
      const isL1Empty = !presetSlot || presetSlot.layer1.coils.length === 0;
      const targetLayer: 1 | 2 =
        isCradleRackBuilding(preset.buildingId) ||
        (preset.layer === 2 && isL1Empty)
          ? 1
          : preset.layer;
      setSelectedBuilding(preset.buildingId);
      setInboundBuilding(preset.buildingId);
      setInboundBasketInput(preset.basketCode);
      setInboundLayer(targetLayer);
      setInboundStep(1);
      setFocusedBasketCode(preset.basketCode);
      window.setTimeout(() => {
        engineRef.current?.focusBasket(preset.basketCode, targetLayer);
      }, 60);
    } else {
      setInboundBuilding(selectedBuilding);
      if (isCradleRackBuilding(selectedBuilding)) {
        setInboundLayer(1);
      }
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

      const slot = targetLayout.slotByCode.get(parsed.basketCode)!;
      const isL1Empty = slot.layer1.coils.length === 0;
      // Pick layer from scanned suffix if specified, else smart default (E10 is always layer 1;
      // blue baskets forbid L2 while L1 is empty)
      const hasExplicitLayer = /[-/_]?(?:L|LAYER|ชั้น)[12]$/.test(code);
      const requestedLayer2OnEmptyL1 =
        !isCradleRackBuilding(parsed.buildingId) &&
        hasExplicitLayer &&
        parsed.layer === 2 &&
        isL1Empty;

      const nextLayer: 1 | 2 =
        isCradleRackBuilding(parsed.buildingId) || isL1Empty
          ? 1
          : hasExplicitLayer
          ? parsed.layer
          : slot.layer1.status === "FULL" || slot.layer1.status === "OVERFLOW"
          ? 2
          : 1;

      if (requestedLayer2OnEmptyL1) {
        setToastMessage({
          type: "error",
          text: isThai
            ? `ห้ามวางตะกร้าที่มีงานบนชั้น 2 (${parsed.basketCode}-L2) เนื่องจากชั้นล่าง (L1) ยังเป็นตะกร้าเปล่า — ระบบเปลี่ยนเป็นชั้น 1 (L1) ให้อัตโนมัติ`
            : `Cannot place on ${parsed.basketCode}-L2 while Layer 1 is empty. Switched to Layer 1.`,
        });
      }

      setInboundLayer(nextLayer);
      setInboundStep(4);
      window.setTimeout(() => {
        engineRef.current?.focusBasket(parsed.basketCode, nextLayer);
      }, 80);
      return;
    }

    setToastMessage({
      type: "error",
      text: isThai
        ? `รูปแบบรหัสตำแหน่งไม่ถูกต้อง กรุณาสแกนเช่น E9-A01, H2-B05, F-C10 หรือ E10-A01`
        : `Invalid location code. Expected format like E9-A01, H2-B05, F-C10, E10-A01.`,
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
      const targetIsCradle = isCradleRackBuilding(inboundTargetSlot.buildingId);
      const effectiveLayer: 1 | 2 = targetIsCradle ? 1 : inboundLayer;
      if (
        !targetIsCradle &&
        effectiveLayer === 2 &&
        inboundTargetSlot.layer1.coils.length === 0
      ) {
        setToastMessage({
          type: "error",
          text: isThai
            ? "ห้ามวางตะกร้าที่มีงานบนชั้น 2 (L2) เนื่องจากชั้นล่าง (L1) ยังเป็นตะกร้าเปล่า กรุณาวางงานบนชั้น 1 (L1) ก่อน"
            : "Cannot place a loaded basket on Layer 2 (L2) while Layer 1 (L1) is empty.",
        });
        setInboundLayer(1);
        setIsSavingInbound(false);
        return;
      }
      const canonicalLocation = targetIsCradle
        ? inboundTargetSlot.basketCode
        : formatBasketLayerLocation(
            inboundTargetSlot.basketCode,
            effectiveLayer
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
        conditionText: targetIsCradle
          ? "แคร่เหล็กสามเหลี่ยม E10 3D"
          : "ตะกร้าฟ้า 3D",
      };

      await saveInboundRecordToCloud(newRecord);
      onInboundRecordSaved?.(newRecord);
      onLogTransaction?.(
        targetIsCradle ? "E10 Steel Cradle 3D Inbound" : "Blue Basket 3D Inbound",
        `Batch ${newRecord.batch} (${effectiveInboundWidthMm} mm) -> ${canonicalLocation}`
      );

      setSelectedBuilding(inboundTargetSlot.buildingId);
      setSelectedBasketCode(inboundTargetSlot.basketCode);
      setSelectedLayer(effectiveLayer);
      setFocusedBasketCode(inboundTargetSlot.basketCode);
      window.setTimeout(() => {
        engineRef.current?.focusBasket(
          inboundTargetSlot.basketCode,
          effectiveLayer
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
    const useOpposite =
      isDualRoadBuilding(selectedBuilding) && rowManagerSide === "opposite";
    const activeRows = useOpposite ? bCfg.oppositeRows || [] : bCfg.rows;
    const gateDisplay = useOpposite
      ? bCfg.oppositeGateId || H2_OPPOSITE_GATE_ID
      : selectedBuilding;

    const cleanId = (
      newRowLabel.trim() || getNextAvailableRowId(activeRows)
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
    if (activeRows.some((r) => r.rowId === cleanId)) {
      setRowManagerError(
        isThai
          ? `แถว ${cleanId} มีอยู่แล้วในฝั่งประตู ${gateDisplay}`
          : `Row ${cleanId} already exists in ${gateDisplay}.`
      );
      return;
    }

    const clampedSlots = Math.max(
      MIN_SLOTS_PER_ROW,
      Math.min(MAX_SLOTS_PER_ROW, Math.round(newRowSlots) || DEFAULT_SLOTS_PER_ROW)
    );
    const updatedRows = [...activeRows, { rowId: cleanId, slotCount: clampedSlots }];
    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: useOpposite
          ? {
              ...bCfg,
              oppositeGateId: bCfg.oppositeGateId || H2_OPPOSITE_GATE_ID,
              oppositeRows: updatedRows,
            }
          : {
              ...bCfg,
              rows: updatedRows,
            },
      },
      updatedAt: new Date().toISOString(),
    };
    setNewRowLabel("");
    setNewRowSlots(DEFAULT_SLOTS_PER_ROW);
    await persistConfigUpdate(nextConfig);
  };

  const handleChangeRowSlotCount = async (
    rowId: string,
    delta: number,
    side: "primary" | "opposite" = "primary"
  ) => {
    const bCfg = warehouseConfig.buildings[selectedBuilding];
    const useOpposite =
      isDualRoadBuilding(selectedBuilding) && side === "opposite";
    const activeRows = useOpposite ? bCfg.oppositeRows || [] : bCfg.rows;
    const targetRow = activeRows.find((r) => r.rowId === rowId);
    if (!targetRow) return;
    const nextCount = Math.max(
      MIN_SLOTS_PER_ROW,
      Math.min(MAX_SLOTS_PER_ROW, targetRow.slotCount + delta)
    );
    if (nextCount === targetRow.slotCount) return;

    // Prevent shrinking if active coils exist in the removed slots
    if (nextCount < targetRow.slotCount) {
      const blockedSlots = currentLayout.slots.filter(
        (s) =>
          s.side === side &&
          s.rowId === rowId &&
          s.slotNumber > nextCount &&
          s.hasAnyCoil
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

    const updatedRows = activeRows.map((r) =>
      r.rowId === rowId ? { ...r, slotCount: nextCount } : r
    );
    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: useOpposite
          ? {
              ...bCfg,
              oppositeGateId: bCfg.oppositeGateId || H2_OPPOSITE_GATE_ID,
              oppositeRows: updatedRows,
            }
          : {
              ...bCfg,
              rows: updatedRows,
            },
      },
      updatedAt: new Date().toISOString(),
    };
    await persistConfigUpdate(nextConfig);
  };

  const handleDeleteRow = async (
    rowId: string,
    side: "primary" | "opposite" = "primary"
  ) => {
    const bCfg = warehouseConfig.buildings[selectedBuilding];
    const useOpposite =
      isDualRoadBuilding(selectedBuilding) && side === "opposite";
    const activeRows = useOpposite ? bCfg.oppositeRows || [] : bCfg.rows;
    if (activeRows.length <= 1) {
      setRowManagerError(
        isThai
          ? "ต้องมีแถวอย่างน้อย 1 แถวในแต่ละฝั่ง"
          : "At least 1 row must remain."
      );
      return;
    }

    const hasStockInRow = currentLayout.slots.some(
      (s) => s.side === side && s.rowId === rowId && s.hasAnyCoil
    );
    if (hasStockInRow) {
      setRowManagerError(
        isThai
          ? `ไม่สามารถลบแถว ${rowId} ได้ เนื่องจากยังมีม้วนเหล็กสลิตจัดเก็บอยู่ กรุณาย้ายหรือเบิกออกก่อน`
          : `Cannot delete row ${rowId} while coils are stored in it.`
      );
      return;
    }

    const updatedRows = activeRows.filter((r) => r.rowId !== rowId);
    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: useOpposite
          ? {
              ...bCfg,
              oppositeGateId: bCfg.oppositeGateId || H2_OPPOSITE_GATE_ID,
              oppositeRows: updatedRows,
            }
          : {
              ...bCfg,
              rows: updatedRows,
            },
      },
      updatedAt: new Date().toISOString(),
    };
    if (selectedSlot?.rowId === rowId && selectedSlot?.side === side) {
      setSelectedBasketCode(null);
      setSelectedLayer(null);
    }
    await persistConfigUpdate(nextConfig);
  };

  const handleResetBuildingToDefault = async () => {
    const def = createDefaultBlueBasketConfig();
    const defBuilding = def.buildings[selectedBuilding];
    const defPrimaryLimit = new Map(
      defBuilding.rows.map((r) => [r.rowId, r.slotCount])
    );
    const defOppositeLimit = new Map(
      (defBuilding.oppositeRows || []).map((r) => [r.rowId, r.slotCount])
    );
    const hasStockOutsideDefault = currentLayout.slots.some((s) => {
      if (!s.hasAnyCoil) return false;
      const limit =
        s.side === "opposite"
          ? defOppositeLimit.get(s.rowId)
          : defPrimaryLimit.get(s.rowId);
      return limit === undefined || s.slotNumber > limit;
    });
    if (hasStockOutsideDefault) {
      setRowManagerError(
        isThai
          ? isCurrentCradle
            ? "ไม่สามารถรีเซ็ตเป็นแถว A (8 แคร่) ได้ เนื่องจากมีเหล็กวางอยู่ในช่องที่เกินค่าเริ่มต้น"
            : "ไม่สามารถรีเซ็ตเป็น A–D (แถวละ 10 ช่อง) ได้ เนื่องจากมีเหล็กวางอยู่ในแถวหรือช่องที่เกินค่าเริ่มต้น"
          : "Cannot reset while coils exist outside default slots."
      );
      return;
    }
    const nextConfig: BlueBasketWarehouseConfig = {
      ...warehouseConfig,
      buildings: {
        ...warehouseConfig.buildings,
        [selectedBuilding]: defBuilding,
      },
      updatedAt: new Date().toISOString(),
    };
    await persistConfigUpdate(nextConfig);
  };

  // Filtered basket picker list for Step 3 of Inbound Drawer
  const step3BasketOptions = useMemo(() => {
    return inboundBuildingLayout.slots.filter((s) => {
      if (inboundBasketRowFilter === "ALL") return true;
      if (inboundBasketRowFilter.startsWith("GATE:")) {
        return s.gateId === inboundBasketRowFilter.slice(5);
      }
      if (inboundBasketRowFilter.includes(":")) {
        const [gId, rId] = inboundBasketRowFilter.split(":");
        return s.gateId === gId && s.rowId === rId;
      }
      return s.rowId === inboundBasketRowFilter;
    });
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
                  {isCurrentCradle
                    ? isThai
                      ? "E10 แคร่เหล็กสามเหลี่ยมขา 2 ม. | แถว A ชิดผนังซ้าย + ถนนกลาง + Slitting Machine"
                      : "E10 2m Steel Cradle Rack | ROW A + Central Road + Slitting Machine"
                    : isDualRoadBuilding(selectedBuilding)
                    ? isThai
                      ? "อาคาร H2 · ประตู H2 ↔ ประตู H4 วางตรงข้ามกันมีถนนคั่นกลาง | ≤ 2,000 มม. | ซ้อนสูงสุด 2 ชั้น"
                      : "Building H2 · Gate H2 ↔ Gate H4 across Central Road | ≤ 2,000 mm | Max 2 Layers"
                    : isThai
                    ? "E9 · H2 (ประตู H2/H4) · F ตะกร้าฟ้า (2 ชั้น) | E10 แคร่เหล็ก | ≤ 2,000 มม."
                    : "E9 · H2 (Gate H2/H4) · F Blue Baskets (2 Layers) | E10 Steel Cradle | ≤ 2,000 mm"}
                </p>
              </div>
            </div>

            {/* Building Tabs: E9, H2, F, E10 */}
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-xl border border-slate-800">
              {BLUE_BASKET_BUILDINGS.map((bId) => {
                const bLayout = allBuildingLayouts[bId];
                const active = selectedBuilding === bId;
                const isCradle = isCradleRackBuilding(bId);
                const isDual = isDualRoadBuilding(bId);
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
                        ? isCradle
                          ? "bg-amber-600 text-white shadow-sm shadow-amber-600/30"
                          : "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <Building2 className="w-3 h-3" />
                    <span>{isThai ? `อาคาร ${bId}` : bId}</span>
                    {isDual && (
                      <span
                        className={`px-1 py-0.2 rounded text-[9px] font-black ${
                          active
                            ? "bg-black/25 text-cyan-100"
                            : "bg-cyan-500/20 text-cyan-300"
                        }`}
                      >
                        H2/H4
                      </span>
                    )}
                    {isCradle && (
                      <span
                        className={`px-1 py-0.2 rounded text-[9px] font-black ${
                          active
                            ? "bg-black/25 text-amber-100"
                            : "bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {isThai ? "แคร่เหล็ก" : "Cradle"}
                      </span>
                    )}
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
                    ? "ค้นหา Batch / E9-A01 / E10-A01"
                    : "Search Batch / E9-A01 / E10-A01"
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

          {isCurrentCradle ? (
            <div className="flex items-center gap-1 text-amber-300">
              <Layers className="w-3 h-3" />
              <span className="text-slate-400 font-semibold">
                {isThai ? "รูปแบบวาง:" : "Rack:"}
              </span>
              <span className="font-black">
                {isThai ? "แคร่เหล็กสามเหลี่ยม ขา 2 ม. (ชั้นเดียว)" : "2m Steel Cradle (1-Tier)"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-sky-300">
              <Layers className="w-3 h-3" />
              <span className="text-slate-400 font-semibold">
                {isThai ? "ซ้อน 2 ชั้น:" : "2-Layer:"}
              </span>
              <span className="font-black tabular-nums">
                {currentLayout.stats.stacked2LayerCount} จุด
              </span>
            </div>
          )}

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
              <span
                className={`w-2 h-2 rounded-full ${
                  isCurrentCradle ? "bg-amber-400" : "bg-blue-500"
                }`}
              />
              <span>
                {currentLayout.dualRoadLayout
                  ? `อาคาร ${selectedBuilding} · ประตู ${currentLayout.dualRoadLayout.primaryGateId} ↔ ประตู ${currentLayout.dualRoadLayout.oppositeGateId} (ถนนคั่นกลาง)`
                  : `${BLUE_BASKET_BUILDING_META[selectedBuilding].nameTh} · แถว ${currentLayout.config.rows
                      .map((r) => r.rowId)
                      .join(", ")}${
                      isCurrentCradle ? " · ถนนกลาง · Slitting Machine" : ""
                    }`}
              </span>
            </div>
            {showInboundDrawer && (
              <div className="px-2.5 py-1 rounded-xl bg-emerald-950 border border-emerald-600/60 text-[11px] font-bold text-emerald-300 shadow-md">
                {isCurrentCradle
                  ? isThai
                    ? "คลิกแคร่เหล็กในฉาก 3D เพื่อเลือกช่องรับเข้าได้ทันที"
                    : "Click any 3D steel cradle to pick inbound slot"
                  : isThai
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
              className="fixed z-40 pointer-events-none rounded-xl bg-slate-900 border border-slate-600 px-3 py-2 text-xs text-slate-100 shadow-2xl min-w-[205px]"
              style={{
                left: Math.min(
                  hoverInfo.clientX + 16,
                  typeof window !== "undefined" ? window.innerWidth - 240 : 800
                ),
                top: Math.max(hoverInfo.clientY - 12, 12),
              }}
            >
              <div className="flex items-center justify-between gap-2 pb-1 mb-1 border-b border-slate-700">
                <span
                  className={`font-black ${
                    isCradleRackBuilding(hoverInfo.slot.buildingId)
                      ? "text-amber-300"
                      : hoverInfo.slot.side === "opposite"
                      ? "text-cyan-300"
                      : "text-sky-300"
                  }`}
                >
                  {hoverInfo.slot.basketCode}
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  {isCradleRackBuilding(hoverInfo.slot.buildingId)
                    ? isThai
                      ? "แคร่เหล็ก 2 ม."
                      : "2m Cradle"
                    : isDualRoadBuilding(hoverInfo.slot.buildingId)
                    ? isThai
                      ? `ประตู ${hoverInfo.slot.gateId} · ชั้น ${hoverInfo.layer}`
                      : `Gate ${hoverInfo.slot.gateId} · L${hoverInfo.layer}`
                    : isThai
                    ? `ชั้น ${hoverInfo.layer}`
                    : `L${hoverInfo.layer}`}
                </span>
              </div>
              {isCradleRackBuilding(hoverInfo.slot.buildingId) ? (
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">แคร่ขา 2 ม.:</span>
                    <span className="font-bold text-white tabular-nums">
                      {hoverInfo.slot.layer1.usedWidthMm.toLocaleString()} /{" "}
                      {MAX_BASKET_WIDTH_MM} มม. (
                      {hoverInfo.slot.layer1.coils.length} ม้วน)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">ชั้น 1 (ฐาน):</span>
                    <span className="font-bold text-white tabular-nums">
                      {hoverInfo.slot.layer1.usedWidthMm.toLocaleString()} /{" "}
                      {MAX_BASKET_WIDTH_MM} มม. (
                      {hoverInfo.slot.layer1.coils.length} ม้วน)
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">ชั้น 2 (ซ้อน):</span>
                    <span className="font-bold text-sky-300 tabular-nums">
                      {hoverInfo.slot.layer2.usedWidthMm.toLocaleString()} /{" "}
                      {MAX_BASKET_WIDTH_MM} มม. (
                      {hoverInfo.slot.layer2.coils.length} ม้วน)
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Collapsible Bottom 3D Control Dock (Anchored flush to bottom-left corner) */}
          <div className="absolute bottom-2 left-2 right-2 z-20 flex flex-col items-start pointer-events-none">
            <div className="pointer-events-auto">
              <button
                type="button"
                onClick={() => setDockVisible((v) => !v)}
                className={`px-2.5 py-1.5 bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-200 hover:text-white hover:border-slate-500 flex items-center gap-1.5 cursor-pointer shadow-md transition-colors ${
                  dockVisible ? "rounded-t-xl border-b-0" : "rounded-xl"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>{isThai ? "แถบควบคุม 3D" : "3D Controls"}</span>
                {dockVisible ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>
            </div>

            {dockVisible && (
              <div className="pointer-events-auto w-full max-w-5xl rounded-b-2xl rounded-tr-2xl rounded-tl-none bg-slate-900 border border-slate-700 p-3 shadow-2xl space-y-2.5">
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
                      {currentLayout.dualRoadLayout ? (
                        <>
                          <option value="ALL">
                            ทั้งหมด (ประตู{" "}
                            {currentLayout.dualRoadLayout.primaryGateId} +{" "}
                            {currentLayout.dualRoadLayout.oppositeGateId})
                          </option>
                          <option
                            value={`GATE:${currentLayout.dualRoadLayout.primaryGateId}`}
                          >
                            เฉพาะฝั่งประตู{" "}
                            {currentLayout.dualRoadLayout.primaryGateId}
                          </option>
                          <option
                            value={`GATE:${currentLayout.dualRoadLayout.oppositeGateId}`}
                          >
                            เฉพาะฝั่งประตู{" "}
                            {currentLayout.dualRoadLayout.oppositeGateId}
                          </option>
                          {currentLayout.rowPositions.map((rp) => (
                            <option
                              key={`${rp.gateId}:${rp.rowId}`}
                              value={`${rp.gateId}:${rp.rowId}`}
                            >
                              ประตู {rp.gateId} · แถว {rp.rowId} ({rp.slotCount}{" "}
                              ช่อง)
                            </option>
                          ))}
                        </>
                      ) : (
                        <>
                          <option value="ALL">แถวทั้งหมด</option>
                          {currentLayout.config.rows.map((r) => (
                            <option key={r.rowId} value={r.rowId}>
                              แถว {r.rowId} ({r.slotCount} ช่อง)
                            </option>
                          ))}
                        </>
                      )}
                    </select>

                    {!isCurrentCradle && (
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
                    )}

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
                      {isCurrentCradle
                        ? "แคร่เหล็กเปล่า (0 มม.)"
                        : "ตะกร้าเปล่าชั้น 1 (0 มม.)"}
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
                    {isCurrentCradle
                      ? "ลากเพื่อหมุน · เลื่อนล้อเมาส์เพื่อซูม · คลิกแคร่เหล็ก ROW A เพื่อดูรายละเอียด"
                      : "ลากเพื่อหมุน · เลื่อนล้อเมาส์เพื่อซูม · คลิกตะกร้าเพื่อดูชั้น 1–2"}
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

                {/* STEP 2: เลือกอาคาร (E9 / H2 / F / E10) */}
                <div
                  className={`rounded-xl border p-3 space-y-2 ${
                    inboundStep === 2
                      ? "border-emerald-500/60 bg-slate-950"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="text-xs font-extrabold text-sky-400">
                    ขั้นที่ 2 · เลือกอาคารจัดเก็บ (ตะกร้าฟ้า / แคร่เหล็ก E10)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {BLUE_BASKET_BUILDINGS.map((bId) => {
                      const active = inboundBuilding === bId;
                      const stats = allBuildingLayouts[bId].stats;
                      const isCradle = isCradleRackBuilding(bId);
                      const isDual = isDualRoadBuilding(bId);
                      return (
                        <button
                          key={bId}
                          type="button"
                          onClick={() => {
                            setInboundBuilding(bId);
                            setSelectedBuilding(bId);
                            setInboundBasketRowFilter("ALL");
                            if (isCradle) setInboundLayer(1);
                            setInboundStep(3);
                          }}
                          className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                            active
                              ? isCradle
                                ? "bg-amber-600 border-amber-400 text-white shadow-md"
                                : "bg-blue-600 border-blue-400 text-white shadow-md"
                              : "bg-slate-900 border-slate-700 text-slate-200 hover:border-blue-500"
                          }`}
                        >
                          <div className="text-xs font-black">อาคาร {bId}</div>
                          <div className="text-[9px] opacity-85">
                            {isCradle
                              ? "แคร่เหล็ก"
                              : isDual
                              ? "ประตู H2 / H4"
                              : "ตะกร้าฟ้า"}
                          </div>
                          <div className="text-[10px] opacity-80 mt-0.5">
                            {stats.occupiedSlots}/{stats.totalSlots} ช่อง
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* STEP 3: สแกนเบอร์ตะกร้า / แคร่เหล็ก */}
                <div
                  className={`rounded-xl border p-3 space-y-2.5 ${
                    inboundStep === 3
                      ? "border-emerald-500/60 bg-slate-950"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-sky-400">
                      ขั้นที่ 3 · สแกน
                      {isCradleRackBuilding(inboundBuilding)
                        ? "เบอร์แคร่เหล็ก"
                        : "เบอร์ตะกร้า"}{" "}
                      (
                      {isDualRoadBuilding(inboundBuilding)
                        ? "ประตู H2 / H4"
                        : inboundBuilding}
                      )
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
                      placeholder={
                        isDualRoadBuilding(inboundBuilding)
                          ? "เช่น H2-A01 หรือ H4-A01"
                          : `เช่น ${inboundBuilding}-A01`
                      }
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
                        ทั้งหมด
                      </button>
                      {inboundBuildingLayout.dualRoadLayout ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setInboundBasketRowFilter(
                                `GATE:${inboundBuildingLayout.dualRoadLayout!.primaryGateId}`
                              )
                            }
                            className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                              inboundBasketRowFilter ===
                              `GATE:${inboundBuildingLayout.dualRoadLayout.primaryGateId}`
                                ? "bg-amber-600 text-white"
                                : "bg-slate-800 text-amber-300 hover:text-white"
                            }`}
                          >
                            ประตู{" "}
                            {inboundBuildingLayout.dualRoadLayout.primaryGateId}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setInboundBasketRowFilter(
                                `GATE:${inboundBuildingLayout.dualRoadLayout!.oppositeGateId}`
                              )
                            }
                            className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                              inboundBasketRowFilter ===
                              `GATE:${inboundBuildingLayout.dualRoadLayout.oppositeGateId}`
                                ? "bg-cyan-600 text-white"
                                : "bg-slate-800 text-cyan-300 hover:text-white"
                            }`}
                          >
                            ประตู{" "}
                            {
                              inboundBuildingLayout.dualRoadLayout
                                .oppositeGateId
                            }
                          </button>
                          {inboundBuildingLayout.rowPositions.map((rp) => {
                            const key = `${rp.gateId}:${rp.rowId}`;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setInboundBasketRowFilter(key)}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                  inboundBasketRowFilter === key
                                    ? "bg-sky-600 text-white"
                                    : "bg-slate-800 text-slate-400 hover:text-white"
                                }`}
                              >
                                {rp.gateId}-{rp.rowId}
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        inboundBuildingLayout.config.rows.map((r) => (
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
                        ))
                      )}
                    </div>

                    <div className="grid grid-cols-5 gap-1 max-h-28 overflow-y-auto pr-0.5">
                      {step3BasketOptions.map((slot) => {
                        const isPicked =
                          resolvedInboundBasketCode === slot.basketCode;
                        const bothFull = isCradleRackBuilding(slot.buildingId)
                          ? slot.layer1.remainingWidthMm <
                            effectiveInboundWidthMm
                          : slot.layer1.remainingWidthMm <
                              effectiveInboundWidthMm &&
                            slot.layer2.remainingWidthMm <
                              effectiveInboundWidthMm;
                        const isOpposite = slot.side === "opposite";
                        return (
                          <button
                            key={slot.basketCode}
                            type="button"
                            onClick={() =>
                              handleApplyBasketCodeInput(slot.basketCode)
                            }
                            className={`px-1 py-1.5 rounded-lg border text-center text-[10px] font-bold cursor-pointer transition-all ${
                              isPicked
                                ? isOpposite
                                  ? "bg-cyan-600 border-cyan-300 text-white"
                                  : "bg-blue-600 border-blue-300 text-white"
                                : bothFull
                                ? "bg-rose-950/50 border-rose-800/60 text-rose-300"
                                : slot.hasAnyCoil
                                ? "bg-slate-900 border-sky-700/50 text-sky-200 hover:border-sky-400"
                                : isOpposite
                                ? "bg-slate-900 border-cyan-900/70 text-cyan-300 hover:border-cyan-400"
                                : "bg-slate-900 border-slate-800 text-emerald-300 hover:border-emerald-400"
                            }`}
                          >
                            <div>
                              {inboundBuildingLayout.dualRoadLayout
                                ? `${slot.gateId}-${slot.rowId}${String(
                                    slot.slotNumber
                                  ).padStart(2, "0")}`
                                : `${slot.rowId}${String(
                                    slot.slotNumber
                                  ).padStart(2, "0")}`}
                            </div>
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

                {/* STEP 4: เลือกชั้น / ยืนยันแคร่เหล็ก + ตรวจสอบไม่เกิน 2,000 มม. */}
                <div
                  className={`rounded-xl border p-3 space-y-2.5 ${
                    inboundStep === 4
                      ? "border-emerald-500/60 bg-slate-950"
                      : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-400">
                      {inboundTargetSlot &&
                      isCradleRackBuilding(inboundTargetSlot.buildingId)
                        ? "ขั้นที่ 4 · แคร่เหล็กขา 2 ม. (วางชั้นเดียว · ≤ 2,000 มม.)"
                        : "ขั้นที่ 4 · เลือกชั้น (สูงสุด 2 ชั้น · ≤ 2,000 มม.)"}
                    </span>
                    {inboundTargetSlot && (
                      <span className="text-xs font-black text-sky-300">
                        {inboundTargetSlot.basketCode}
                      </span>
                    )}
                  </div>

                  {!inboundTargetSlot ? (
                    <div className="text-xs text-slate-400 py-2 text-center">
                      กรุณาสแกนหรือคลิกเลือกช่องตำแหน่งในขั้นที่ 3 ก่อน
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const targetIsCradle = isCradleRackBuilding(
                          inboundTargetSlot.buildingId
                        );
                        const targetLocationLabel = targetIsCradle
                          ? inboundTargetSlot.basketCode
                          : formatBasketLayerLocation(
                              inboundTargetSlot.basketCode,
                              inboundLayer
                            );
                        const layerCards = targetIsCradle
                          ? [
                              {
                                layer: 1 as const,
                                title: "แคร่เหล็กสามเหลี่ยม · ขา 2 เมตร (วางพื้นชั้นเดียว)",
                                state: inboundTargetSlot.layer1,
                                validation: validationL1,
                              },
                            ]
                          : [
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
                            ];

                        return (
                          <>
                            <div
                              className={`grid gap-2 ${
                                targetIsCradle ? "grid-cols-1" : "grid-cols-2"
                              }`}
                            >
                              {layerCards.map((card) => {
                                const isL2BlockedByEmptyL1 =
                                  !targetIsCradle &&
                                  card.layer === 2 &&
                                  inboundTargetSlot.layer1.coils.length === 0;
                                const picked =
                                  targetIsCradle ||
                                  (!isL2BlockedByEmptyL1 &&
                                    inboundLayer === card.layer);
                                const overLimit =
                                  card.validation.overflowMm > 0;
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
                                    disabled={isL2BlockedByEmptyL1}
                                    onClick={() => {
                                      if (isL2BlockedByEmptyL1) return;
                                      setInboundLayer(card.layer);
                                      engineRef.current?.focusBasket(
                                        inboundTargetSlot.basketCode,
                                        card.layer
                                      );
                                    }}
                                    className={`p-2.5 rounded-xl border text-left transition-all space-y-1.5 ${
                                      isL2BlockedByEmptyL1
                                        ? "bg-slate-900/50 border-slate-800/80 opacity-50 cursor-not-allowed"
                                        : picked
                                        ? overLimit
                                          ? "bg-rose-950/60 border-rose-400 cursor-pointer"
                                          : targetIsCradle
                                          ? "bg-amber-600/20 border-amber-400 cursor-pointer"
                                          : "bg-blue-600/20 border-sky-400 cursor-pointer"
                                        : "bg-slate-900 border-slate-800 hover:border-slate-600 cursor-pointer"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-xs font-black text-white">
                                        {card.title}
                                      </span>
                                      {isL2BlockedByEmptyL1 ? (
                                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                          ห้ามวาง
                                        </span>
                                      ) : (
                                        picked && (
                                          <Check className="w-3.5 h-3.5 text-sky-300" />
                                        )
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-300 tabular-nums">
                                      {isL2BlockedByEmptyL1 ? (
                                        <span className="text-rose-300 font-semibold">
                                          ชั้นล่าง (L1) ยังเป็นตะกร้าเปล่า
                                        </span>
                                      ) : (
                                        <>
                                          เดิม{" "}
                                          {card.state.usedWidthMm.toLocaleString()}{" "}
                                          +{" "}
                                          <span className="text-emerald-300 font-bold">
                                            {effectiveInboundWidthMm}
                                          </span>{" "}
                                          มม.
                                        </>
                                      )}
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                                      <div
                                        className={`h-full transition-all ${
                                          isL2BlockedByEmptyL1
                                            ? "bg-slate-700"
                                            : overLimit
                                            ? "bg-rose-500"
                                            : projectedPct >= 80
                                            ? "bg-amber-500"
                                            : "bg-emerald-500"
                                        }`}
                                        style={{
                                          width: `${
                                            isL2BlockedByEmptyL1
                                              ? 0
                                              : projectedPct
                                          }%`,
                                        }}
                                      />
                                    </div>
                                    <div
                                      className={`text-[10px] font-bold ${
                                        isL2BlockedByEmptyL1 || overLimit
                                          ? "text-rose-400"
                                          : "text-emerald-300"
                                      }`}
                                    >
                                      {isL2BlockedByEmptyL1
                                        ? "กรุณาวางงานชั้น 1 (L1) ก่อน"
                                        : overLimit
                                        ? `เกิน ${card.validation.overflowMm.toLocaleString()} มม.`
                                        : `เหลือ ${card.validation.nextRemainingWidthMm.toLocaleString()} มม.`}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Blue Basket Layer 2 stacking rule notice when Layer 1 is empty */}
                            {!targetIsCradle &&
                              inboundTargetSlot.layer1.coils.length === 0 && (
                                <div className="rounded-xl bg-rose-500/10 border border-rose-500/40 p-2.5 text-[11px] font-semibold text-rose-200 flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                  <span>
                                    ห้ามวางตะกร้าที่มีงานบนชั้น 2 (L2) หากชั้นล่าง (L1) ยังเป็นตะกร้าเปล่า — กรุณาวางงานบนชั้น 1 (L1) ก่อน
                                  </span>
                                </div>
                              )}

                            {/* Hard Block Error Message (> 2,000 mm or L2 empty L1) */}
                            {!activeLayerValidation.ok &&
                              activeLayerValidation.reasonTh && (
                                <div className="rounded-xl bg-rose-500/15 border border-rose-500/50 p-2.5 text-[11px] font-bold text-rose-200 flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                  <span>{activeLayerValidation.reasonTh}</span>
                                </div>
                              )}

                            {/* Final Target Summary & Submit */}
                            <div className="rounded-xl bg-slate-900 border border-slate-800 p-2.5 flex items-center justify-between text-xs">
                              <span className="text-slate-400">
                                Location ปลายทาง:
                              </span>
                              <span className="font-mono font-black text-emerald-300 text-sm">
                                {targetLocationLabel}
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
                                {targetIsCradle
                                  ? "รับเข้าต่อเนื่องในแคร่เหล็กเดิม (สแกน Batch ถัดไปได้ทันที)"
                                  : "รับเข้าต่อเนื่องในตะกร้าเดิม (สแกน Batch ถัดไปได้ทันที)"}
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
                                  : `ยืนยันรับเข้า ${targetLocationLabel}`}
                              </span>
                            </button>
                          </>
                        );
                      })()}
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
                      อาคาร {selectedSlot.buildingId}
                      {isDualRoadBuilding(selectedSlot.buildingId)
                        ? ` · ประตู ${selectedSlot.gateId}`
                        : ""}{" "}
                      · แถว {selectedSlot.rowId} ช่อง{" "}
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

                {/* Display single steel cradle for E10, or Layer 2 on top & Layer 1 on bottom for Blue Basket buildings */}
                {(isCradleRackBuilding(selectedSlot.buildingId)
                  ? [selectedSlot.layer1]
                  : [selectedSlot.layer2, selectedSlot.layer1]
                ).map((layerObj) => {
                  const slotIsCradle = isCradleRackBuilding(
                    selectedSlot.buildingId
                  );
                  const isL2BlockedByEmptyL1 =
                    !slotIsCradle &&
                    layerObj.layer === 2 &&
                    selectedSlot.layer1.coils.length === 0;
                  const isLayerHighlighted =
                    slotIsCradle || selectedLayer === layerObj.layer;
                  return (
                    <div
                      key={layerObj.layer}
                      className={`rounded-xl border p-3 space-y-2.5 ${
                        isL2BlockedByEmptyL1
                          ? "bg-slate-950/50 border-slate-800/80 opacity-75"
                          : isLayerHighlighted
                          ? slotIsCradle
                            ? "bg-slate-950 border-amber-500/60"
                            : "bg-slate-950 border-sky-500/60"
                          : "bg-slate-950/70 border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-lg border text-xs font-black ${
                              slotIsCradle
                                ? "bg-amber-600/20 border-amber-500/40 text-amber-300"
                                : "bg-blue-600/20 border-blue-500/40 text-sky-300"
                            }`}
                          >
                            {slotIsCradle
                              ? "แคร่เหล็กฐานสามเหลี่ยม (ขา 2 ม.)"
                              : layerObj.layer === 2
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
                          onClick={() => {
                            if (isL2BlockedByEmptyL1) return;
                            openInboundDrawer({
                              buildingId: selectedSlot.buildingId,
                              basketCode: selectedSlot.basketCode,
                              layer: slotIsCradle ? 1 : layerObj.layer,
                            });
                          }}
                          disabled={
                            layerObj.remainingWidthMm <= 0 ||
                            isL2BlockedByEmptyL1
                          }
                          title={
                            isL2BlockedByEmptyL1
                              ? "ห้ามวางงานบนชั้น 2 (L2) ขณะที่ชั้นล่าง (L1) ยังเป็นตะกร้าเปล่า"
                              : undefined
                          }
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-extrabold text-white flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>
                            {slotIsCradle
                              ? "รับเข้าแคร่นี้"
                              : isL2BlockedByEmptyL1
                              ? "วางชั้น 1 ก่อน"
                              : "รับเข้าชั้นนี้"}
                          </span>
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
                        <div
                          className={`text-[11px] py-2 px-2 text-center border border-dashed rounded-lg ${
                            isL2BlockedByEmptyL1
                              ? "text-rose-300 border-rose-500/40 bg-rose-500/10 font-semibold"
                              : "text-slate-500 border-slate-800"
                          }`}
                        >
                          {isL2BlockedByEmptyL1
                            ? "ห้ามวางงานบนชั้น 2 (L2) เนื่องจากชั้นล่าง (L1) ยังเป็นตะกร้าเปล่า"
                            : "ว่าง — รองรับได้สูงสุด 2,000 มม."}
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
                  {isCurrentCradle
                    ? `จัดการแคร่เหล็ก ROW A — อาคาร ${selectedBuilding}`
                    : `จัดการแถวตะกร้าฟ้า — อาคาร ${selectedBuilding}`}
                </h3>
                <p className="text-[11px] text-slate-400">
                  {isCurrentCradle
                    ? "อาคาร E10 วางแคร่เหล็กแถวเดียว (ROW A) ชิดผนังซ้าย · ปรับเพิ่ม/ลดจำนวนแคร่ได้ (1–30 แคร่) · ซิงก์คลาวด์ทันที"
                    : "เพิ่ม/ลบแถว (A, B, C, D, ...) และปรับจำนวนช่องตะกร้าต่อแถว (1–30 ช่อง) · ซิงก์คลาวด์ทันที"}
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
              <div className="flex flex-wrap items-center gap-1.5">
                {BLUE_BASKET_BUILDINGS.map((bId) => (
                  <button
                    key={bId}
                    type="button"
                    onClick={() => {
                      setSelectedBuilding(bId);
                      setRowManagerSide("primary");
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

              {/* Dual-Road Gate Switcher inside Row Manager for Building H2 (ประตู H2 vs ประตู H4) */}
              {currentLayout.dualRoadLayout && (
                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setRowManagerSide("primary");
                      setRowManagerError(null);
                      setNewRowLabel(
                        getNextAvailableRowId(
                          warehouseConfig.buildings[selectedBuilding].rows
                        )
                      );
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                      rowManagerSide === "primary"
                        ? "bg-amber-600 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    ฝั่งประตู {currentLayout.dualRoadLayout.primaryGateId} (ขวา)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRowManagerSide("opposite");
                      setRowManagerError(null);
                      setNewRowLabel(
                        getNextAvailableRowId(
                          warehouseConfig.buildings[selectedBuilding]
                            .oppositeRows || []
                        )
                      );
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                      rowManagerSide === "opposite"
                        ? "bg-cyan-600 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    ฝั่งประตู {currentLayout.dualRoadLayout.oppositeGateId} (ตรงข้าม)
                  </button>
                </div>
              )}

              {rowManagerError && (
                <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 px-3 py-2 text-xs font-bold text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{rowManagerError}</span>
                </div>
              )}

              {/* Existing Rows List */}
              <div className="space-y-2">
                {currentLayout.rowPositions
                  .filter(
                    (rp) =>
                      !currentLayout.dualRoadLayout ||
                      rp.side === rowManagerSide
                  )
                  .map((rp) => (
                    <div
                      key={`${rp.gateId}:${rp.rowId}`}
                      className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm font-black text-white flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              rp.side === "opposite"
                                ? "bg-cyan-500/20 text-cyan-300"
                                : "bg-amber-500/20 text-amber-300"
                            }`}
                          >
                            {currentLayout.dualRoadLayout
                              ? `ประตู ${rp.gateId} · แถว ${rp.rowId}`
                              : `แถว ${rp.rowId}`}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            {formatBasketCode(rp.gateId, rp.rowId, 1)} –{" "}
                            {formatBasketCode(
                              rp.gateId,
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
                              isSavingLayout ||
                              rp.slotCount <= MIN_SLOTS_PER_ROW
                            }
                            onClick={() =>
                              handleChangeRowSlotCount(rp.rowId, -1, rp.side)
                            }
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
                              isSavingLayout ||
                              rp.slotCount >= MAX_SLOTS_PER_ROW
                            }
                            onClick={() =>
                              handleChangeRowSlotCount(rp.rowId, 1, rp.side)
                            }
                            className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                            title="เพิ่ม 1 ช่อง"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          disabled={isSavingLayout || rp.totalCoils > 0}
                          onClick={() => handleDeleteRow(rp.rowId, rp.side)}
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

              {/* Add New Row Form (Blue Basket buildings E9/H2/F only — E10 is fixed single ROW A against left wall) */}
              {!isCurrentCradle && (
                <div className="rounded-xl bg-slate-950 border border-emerald-600/40 p-3 space-y-2">
                  <div className="text-xs font-extrabold text-emerald-400">
                    + เพิ่มแถวตะกร้าใหม่ใน
                    {currentLayout.dualRoadLayout
                      ? `ฝั่งประตู ${
                          rowManagerSide === "opposite"
                            ? currentLayout.dualRoadLayout.oppositeGateId
                            : currentLayout.dualRoadLayout.primaryGateId
                        }`
                      : `อาคาร ${selectedBuilding}`}
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
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
              <button
                type="button"
                disabled={isSavingLayout}
                onClick={handleResetBuildingToDefault}
                className="text-xs font-bold text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>
                  {isCurrentCradle
                    ? "รีเซ็ตเป็นแถว A (8 แคร่)"
                    : currentLayout.dualRoadLayout
                    ? "รีเซ็ตประตู H2 & H4 เป็น A–D (ฝั่งละ 40 ช่อง)"
                    : "รีเซ็ตเป็น A–D (แถวละ 10 ช่อง)"}
                </span>
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

      {/* Modal 2: Reference Blueprint & Stacking Rules (Blue Baskets E9/H2/F + Steel Cradle E10) */}
      {showReferenceModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-700 text-slate-100 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div>
                <h3 className="text-sm font-black text-white">
                  แบบมาตรฐานตะกร้าฟ้า (E9, H2, F) & แคร่เหล็กสามเหลี่ยม (อาคาร E10)
                </h3>
                <p className="text-[11px] text-slate-400">
                  ตะกร้าฟ้า E9/H2/F: รวมหน้ากว้าง ≤ 2,000 มม. ซ้อนสูงสุด 2 ชั้น · แคร่เหล็ก E10: ฐานสามเหลี่ยมขา 2 ม. วางพิงหัวแคร่แถวเดียว (ROW A)
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
