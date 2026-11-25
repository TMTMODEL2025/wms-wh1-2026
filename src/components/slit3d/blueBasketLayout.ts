import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import {
  SPACE_CONFIG_COLLECTION,
  getCloudRealtimeEnabled,
} from "../../services/slitDataService";
import type { SapMasterItem, SlitBarcodeRecord } from "../SlitFilmManagement";

export type BlueBasketBuildingId = "E9" | "H2" | "F" | "E10";

export type BuildingStorageStyle = "blue_basket" | "steel_cradle";

export const BLUE_BASKET_BUILDINGS: readonly BlueBasketBuildingId[] = [
  "E9",
  "H2",
  "F",
  "E10",
] as const;

export function isCradleRackBuilding(
  buildingId: BlueBasketBuildingId
): boolean {
  return buildingId === "E10";
}

export function isBlueBasketBuilding(
  buildingId: BlueBasketBuildingId
): boolean {
  return !isCradleRackBuilding(buildingId);
}

export const H2_OPPOSITE_GATE_ID = "H4";

export function isDualRoadBuilding(
  buildingId: BlueBasketBuildingId
): boolean {
  return buildingId === "H2";
}

export const MAX_BASKET_WIDTH_MM = 2000;
export const MAX_STACK_LAYERS = 2;
export const DEFAULT_SLOTS_PER_ROW = 10;
export const DEFAULT_E10_SLOTS_PER_ROW = 8;
export const MIN_SLOTS_PER_ROW = 1;
export const MAX_SLOTS_PER_ROW = 30;
export const DEFAULT_FALLBACK_WIDTH_MM = 250;

export const BLUE_BASKET_3D_DOC_ID = "blue_basket_3d_layout_v1";
const LOCAL_STORAGE_KEY = "tmt_wms_blue_basket_3d_layout_v1";

export const BLUE_BASKET_BUILDING_META: Record<
  BlueBasketBuildingId,
  {
    id: BlueBasketBuildingId;
    nameTh: string;
    nameEn: string;
    accentHex: string;
    subtitleTh: string;
    storageStyle: BuildingStorageStyle;
    maxLayers: 1 | 2;
  }
> = {
  E9: {
    id: "E9",
    nameTh: "อาคาร E9",
    nameEn: "Building E9",
    accentHex: "#2563eb",
    subtitleTh: "โซนตะกร้าฟ้า E9 · แถว A–D",
    storageStyle: "blue_basket",
    maxLayers: 2,
  },
  H2: {
    id: "H2",
    nameTh: "อาคาร H2",
    nameEn: "Building H2",
    accentHex: "#0284c7",
    subtitleTh: "โซนตะกร้าฟ้า ประตู H2 ↔ ประตู H4 (ถนนคั่นกลาง)",
    storageStyle: "blue_basket",
    maxLayers: 2,
  },
  F: {
    id: "F",
    nameTh: "อาคาร F",
    nameEn: "Building F",
    accentHex: "#0ea5e9",
    subtitleTh: "โซนตะกร้าฟ้า F · แถว A–D",
    storageStyle: "blue_basket",
    maxLayers: 2,
  },
  E10: {
    id: "E10",
    nameTh: "อาคาร E10",
    nameEn: "Building E10",
    accentHex: "#f59e0b",
    subtitleTh: "โซนแคร่เหล็กสามเหลี่ยม E10 · แถว A + เครื่องสลิต",
    storageStyle: "steel_cradle",
    maxLayers: 1,
  },
};

export interface BlueBasketRowConfig {
  rowId: string; // e.g. "A", "B", "C", "D"
  slotCount: number; // default 10 (01..10)
}

export interface BlueBasketBuildingConfig {
  buildingId: BlueBasketBuildingId;
  rows: BlueBasketRowConfig[];
  oppositeGateId?: string; // e.g. "H4" opposite Gate H2 across central road
  oppositeRows?: BlueBasketRowConfig[];
}

export interface BlueBasketWarehouseConfig {
  id: string;
  buildings: Record<BlueBasketBuildingId, BlueBasketBuildingConfig>;
  updatedAt: string;
}

export interface ParsedBasketLocation {
  buildingId: BlueBasketBuildingId;
  gateId: string; // e.g. "H2" or "H4" (maps to buildingId "H2"), "E9", "F", "E10"
  rowId: string;
  slotNumber: number; // 1-based
  basketCode: string; // e.g. E9-A01, H2-A01, H4-A01
  layer: 1 | 2;
  canonicalLocation: string; // e.g. E9-A01-L1, H4-A01-L1
}

export interface BasketCoilPlacement {
  record: SlitBarcodeRecord;
  batch: string;
  widthMm: number;
  widthSource: "sap" | "record" | "fallback";
  weightKg: number;
  grade: string;
  thickness: string;
  manufacturer: string;
  hasSapData: boolean;
  scanTimestamp: string;
  machine: string;
}

export type BasketLayerStatus =
  | "EMPTY"
  | "PARTIAL"
  | "NEAR_FULL"
  | "FULL"
  | "OVERFLOW";

export interface BasketLayerState {
  layer: 1 | 2;
  locationCode: string; // e.g. E9-A01-L1
  coils: BasketCoilPlacement[];
  usedWidthMm: number;
  remainingWidthMm: number;
  utilizationPercent: number;
  totalWeightKg: number;
  status: BasketLayerStatus;
}

export interface BasketSlot3D {
  basketCode: string; // e.g. E9-A01, H2-A01, H4-A01
  buildingId: BlueBasketBuildingId;
  gateId: string; // e.g. "H2" or "H4" for dual-road Building H2
  side: "primary" | "opposite";
  rowId: string;
  slotNumber: number; // 1-based
  slotIndex: number; // 0-based
  rowIndex: number; // 0-based
  worldX: number;
  worldZ: number;
  layer1: BasketLayerState;
  layer2: BasketLayerState;
  hasAnyCoil: boolean;
  totalCoils: number;
  totalWeightKg: number;
  highestActiveLayer: 0 | 1 | 2;
}

export interface DualRoadLayoutMeta {
  roadCenterX: number;
  roadWidth: number;
  apronWidth: number;
  primaryGateId: string; // "H2" (+X side)
  oppositeGateId: string; // "H4" (-X side)
  primarySlabCenterX: number;
  primarySlabWidth: number;
  oppositeSlabCenterX: number;
  oppositeSlabWidth: number;
}

export interface BuildingBasketLayout3D {
  buildingId: BlueBasketBuildingId;
  config: BlueBasketBuildingConfig;
  slots: BasketSlot3D[];
  slotByCode: Map<string, BasketSlot3D>;
  rowPositions: Array<{
    gateId: string;
    side: "primary" | "opposite";
    rowId: string;
    rowIndex: number;
    worldZ: number;
    slotCount: number;
    occupiedSlots: number;
    totalCoils: number;
  }>;
  slabWidth: number;
  slabDepth: number;
  dualRoadLayout?: DualRoadLayoutMeta;
  stats: {
    totalSlots: number;
    occupiedSlots: number;
    activeBasketLayers: number;
    stacked2LayerCount: number;
    totalCoils: number;
    totalWeightTons: number;
    fullLayers: number;
    nearFullLayers: number;
    avgUtilizationPercent: number;
    pendingSapCoils: number;
  };
}

export interface PlacementValidationResult {
  ok: boolean;
  reasonTh?: string;
  reasonEn?: string;
  blockedEmptyLayer1?: boolean;
  warningTh?: string;
  warningEn?: string;
  currentUsedWidthMm: number;
  nextUsedWidthMm: number;
  nextRemainingWidthMm: number;
  overflowMm: number;
}

// 3D World spacing constants (1 world unit = 1 meter)
// Square blue basket: outer width === outer length (2.28m x 2.28m), inner span 2.00m (2,000 mm)
export const BASKET_OUTER_WIDTH_X = 2.28;
export const BASKET_INNER_WIDTH_X = 2.0; // Exact 2,000 mm usable coil span
export const BASKET_OUTER_DEPTH_Z = 2.28; // Equal to width (square basket footprint)
export const BASKET_HEIGHT_Y = 1.76;
export const BASKET_STACK_STEP_Y = 1.68; // Layer 2 interlocks onto Layer 1 corner pins
export const SLOT_PITCH_X = 2.88; // Square basket + clear side gap for visibility & forklift
export const ROW_PITCH_Z = 4.15; // Square basket + wide forklift inspection aisle & label strip

// Building E10 triangular A-frame steel cradle rack constants (2.0m leg span, single row along left wall)
export const E10_CRADLE_LEG_SPAN_X = 2.0; // Exact 2.00m timber sleeper coil loading span
export const E10_CRADLE_TOTAL_LENGTH_X = 2.9; // A-frame headboard (0.85m) + 2.0m legs + front plate
export const E10_CRADLE_WIDTH_Z = 1.06; // Width across parallel timber sleepers
export const E10_CRADLE_HEIGHT_Y = 2.02; // Tall triangular A-frame headboard height
export const E10_BAY_PITCH_Z = 2.65; // Spacing between adjacent cradle racks along left wall
export const E10_SLAB_WIDTH = 22.0; // Left ROW A (7.0m) + Center Road (6.4m) + Right Slitting Zone (8.6m)
export const E10_RACK_CENTER_X = -8.05; // A-frame back snug against left wall, 2m legs pointing +X toward center road

export function createDefaultBlueBasketConfig(): BlueBasketWarehouseConfig {
  const defaultRows = (): BlueBasketRowConfig[] => [
    { rowId: "A", slotCount: DEFAULT_SLOTS_PER_ROW },
    { rowId: "B", slotCount: DEFAULT_SLOTS_PER_ROW },
    { rowId: "C", slotCount: DEFAULT_SLOTS_PER_ROW },
    { rowId: "D", slotCount: DEFAULT_SLOTS_PER_ROW },
  ];

  return {
    id: BLUE_BASKET_3D_DOC_ID,
    buildings: {
      E9: { buildingId: "E9", rows: defaultRows() },
      H2: {
        buildingId: "H2",
        rows: defaultRows(),
        oppositeGateId: H2_OPPOSITE_GATE_ID,
        oppositeRows: defaultRows(),
      },
      F: { buildingId: "F", rows: defaultRows() },
      E10: {
        buildingId: "E10",
        rows: [{ rowId: "A", slotCount: DEFAULT_E10_SLOTS_PER_ROW }],
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeRowsList(
  rawRows: unknown,
  fallbackRows: BlueBasketRowConfig[]
): BlueBasketRowConfig[] {
  const list = Array.isArray(rawRows) ? rawRows : [];
  const seen = new Set<string>();
  const cleanRows: BlueBasketRowConfig[] = [];

  for (const r of list) {
    const rowObj = r as Partial<BlueBasketRowConfig> | null;
    const rowId = String(rowObj?.rowId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    if (!rowId || seen.has(rowId)) continue;
    seen.add(rowId);
    const count = Math.max(
      MIN_SLOTS_PER_ROW,
      Math.min(
        MAX_SLOTS_PER_ROW,
        Math.round(Number(rowObj?.slotCount) || DEFAULT_SLOTS_PER_ROW)
      )
    );
    cleanRows.push({ rowId, slotCount: count });
  }

  return cleanRows.length > 0 ? cleanRows : fallbackRows;
}

export function normalizeBlueBasketConfig(
  raw: unknown
): BlueBasketWarehouseConfig {
  const fallback = createDefaultBlueBasketConfig();
  if (!raw || typeof raw !== "object") return fallback;

  const src = raw as Partial<BlueBasketWarehouseConfig>;
  const buildingsOut = {} as Record<
    BlueBasketBuildingId,
    BlueBasketBuildingConfig
  >;

  for (const bId of BLUE_BASKET_BUILDINGS) {
    const rawBuilding = src.buildings?.[bId];
    const cleanRows = sanitizeRowsList(
      rawBuilding?.rows,
      fallback.buildings[bId].rows
    );

    if (isDualRoadBuilding(bId)) {
      const cleanOppositeRows = sanitizeRowsList(
        rawBuilding?.oppositeRows,
        fallback.buildings[bId].oppositeRows || fallback.buildings[bId].rows
      );
      buildingsOut[bId] = {
        buildingId: bId,
        rows: cleanRows,
        oppositeGateId: H2_OPPOSITE_GATE_ID,
        oppositeRows: cleanOppositeRows,
      };
    } else {
      buildingsOut[bId] = {
        buildingId: bId,
        rows: cleanRows,
      };
    }
  }

  return {
    id: BLUE_BASKET_3D_DOC_ID,
    buildings: buildingsOut,
    updatedAt:
      typeof src.updatedAt === "string" && src.updatedAt
        ? src.updatedAt
        : fallback.updatedAt,
  };
}

export function formatBasketCode(
  gateOrBuildingId: string,
  rowId: string,
  slotNumber: number
): string {
  const cleanPrefix = gateOrBuildingId.trim().toUpperCase();
  const cleanRow = rowId.trim().toUpperCase();
  const padded = String(Math.max(1, Math.floor(slotNumber))).padStart(2, "0");
  return `${cleanPrefix}-${cleanRow}${padded}`;
}

export function formatBasketLayerLocation(
  basketCode: string,
  layer: 1 | 2
): string {
  const clean = basketCode.trim().toUpperCase();
  return `${clean}-L${layer}`;
}

export function parseWidthMm(raw?: string | number | null): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 10) / 10 : null;
  }
  const str = String(raw).trim().replace(/,/g, "");
  if (!str || str === "-") return null;
  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  return Math.round(val * 10) / 10;
}

/**
 * Parses blue-basket & E10 steel-cradle barcode / location codes into structured coordinates.
 * Accepts:
 *   "E9-A01", "E9-A01-L1", "E9-A01-L2", "H2-B10-L1", "H4-A01", "H4-A01-L2", "F-C03", "E10-A01"
 * Note: Gate "H4" is the opposite side of Building "H2" across the central road.
 */
export function parseBasketLocation(
  rawLocation?: string | null
): ParsedBasketLocation | null {
  if (!rawLocation) return null;
  const cleaned = String(rawLocation)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!cleaned) return null;

  // Match building/gate prefix (E10 before E9, plus H4, H2, F), separator, row letters, slot digits, optional layer
  const m = cleaned.match(
    /^(E10|E9|H4|H2|F)[-/_ ]?([A-Z]{1,2})[-/_]?(\d{1,2})(?:[-/_]?(?:L|LAYER|ชั้น)?([12]))?$/
  );
  if (!m) return null;

  const rawGate = m[1];
  const buildingId: BlueBasketBuildingId =
    rawGate === H2_OPPOSITE_GATE_ID ? "H2" : (rawGate as BlueBasketBuildingId);
  const gateId = rawGate;
  const rowId = m[2];
  const slotNumber = parseInt(m[3], 10);
  if (!Number.isFinite(slotNumber) || slotNumber < 1 || slotNumber > 99) {
    return null;
  }
  // Building E10 steel cradle racks are strictly ground-level single-tier (Layer 1 only)
  const layer: 1 | 2 =
    buildingId === "E10" ? 1 : m[4] === "2" ? 2 : 1;
  const basketCode = formatBasketCode(gateId, rowId, slotNumber);

  return {
    buildingId,
    gateId,
    rowId,
    slotNumber,
    basketCode,
    layer,
    canonicalLocation:
      buildingId === "E10"
        ? basketCode
        : formatBasketLayerLocation(basketCode, layer),
  };
}

export function resolveCoilWidthMm(
  record: SlitBarcodeRecord,
  sap?: SapMasterItem
): { widthMm: number; widthSource: "sap" | "record" | "fallback" } {
  const fromRecord = parseWidthMm(record.width);
  const fromSap = parseWidthMm(sap?.width);
  if (fromSap !== null) {
    return { widthMm: fromSap, widthSource: "sap" };
  }
  if (fromRecord !== null) {
    return { widthMm: fromRecord, widthSource: "record" };
  }
  return { widthMm: DEFAULT_FALLBACK_WIDTH_MM, widthSource: "fallback" };
}

function computeLayerStatus(usedWidthMm: number): BasketLayerStatus {
  if (usedWidthMm <= 0) return "EMPTY";
  if (usedWidthMm > MAX_BASKET_WIDTH_MM) return "OVERFLOW";
  if (usedWidthMm >= MAX_BASKET_WIDTH_MM) return "FULL";
  if (usedWidthMm >= MAX_BASKET_WIDTH_MM * 0.8) return "NEAR_FULL";
  return "PARTIAL";
}

function buildLayerState(
  basketCode: string,
  layer: 1 | 2,
  coils: BasketCoilPlacement[]
): BasketLayerState {
  const usedWidthMm = Math.round(
    coils.reduce((sum, c) => sum + c.widthMm, 0) * 10
  ) / 10;
  const remainingWidthMm = Math.max(
    0,
    Math.round((MAX_BASKET_WIDTH_MM - usedWidthMm) * 10) / 10
  );
  const utilizationPercent = Math.min(
    100,
    Math.round((usedWidthMm / MAX_BASKET_WIDTH_MM) * 100)
  );
  const totalWeightKg = Math.round(
    coils.reduce((sum, c) => sum + c.weightKg, 0)
  );

  return {
    layer,
    locationCode: formatBasketLayerLocation(basketCode, layer),
    coils,
    usedWidthMm,
    remainingWidthMm,
    utilizationPercent,
    totalWeightKg,
    status: computeLayerStatus(usedWidthMm),
  };
}

export function validateBasketPlacement(
  slot: BasketSlot3D | null | undefined,
  targetLayer: 1 | 2,
  incomingWidthMm: number
): PlacementValidationResult {
  if (!slot) {
    return {
      ok: false,
      reasonTh: "ไม่พบรหัสตะกร้านี้ในผังอาคารที่เลือก",
      reasonEn: "Basket code not found in the selected building layout.",
      currentUsedWidthMm: 0,
      nextUsedWidthMm: incomingWidthMm,
      nextRemainingWidthMm: Math.max(0, MAX_BASKET_WIDTH_MM - incomingWidthMm),
      overflowMm: Math.max(0, incomingWidthMm - MAX_BASKET_WIDTH_MM),
    };
  }

  if (!Number.isFinite(incomingWidthMm) || incomingWidthMm <= 0) {
    return {
      ok: false,
      reasonTh: "กรุณาระบุหน้ากว้างม้วนสลิต (มม.) ที่มากกว่า 0",
      reasonEn: "Please enter a valid slit coil width (> 0 mm).",
      currentUsedWidthMm: 0,
      nextUsedWidthMm: 0,
      nextRemainingWidthMm: MAX_BASKET_WIDTH_MM,
      overflowMm: 0,
    };
  }

  if (isCradleRackBuilding(slot.buildingId) && targetLayer !== 1) {
    return {
      ok: false,
      reasonTh:
        "อาคาร E10 ใช้แคร่เหล็กฐานสามเหลี่ยม วางได้เฉพาะระดับพื้น (ชั้น 1) เท่านั้น ไม่รองรับการซ้อนชั้น 2",
      reasonEn:
        "Building E10 steel cradle racks are single-tier only (Layer 1).",
      currentUsedWidthMm: 0,
      nextUsedWidthMm: incomingWidthMm,
      nextRemainingWidthMm: 0,
      overflowMm: 0,
    };
  }

  if (targetLayer !== 1 && targetLayer !== 2) {
    return {
      ok: false,
      reasonTh: "ตะกร้าฟ้าซ้อนได้ไม่เกิน 2 ชั้น (ชั้น 1 หรือ ชั้น 2 เท่านั้น)",
      reasonEn: "Blue baskets can only be stacked up to 2 layers.",
      currentUsedWidthMm: 0,
      nextUsedWidthMm: incomingWidthMm,
      nextRemainingWidthMm: 0,
      overflowMm: 0,
    };
  }

  const layerState = targetLayer === 1 ? slot.layer1 : slot.layer2;
  const currentUsedWidthMm = layerState.usedWidthMm;
  const nextUsedWidthMm =
    Math.round((currentUsedWidthMm + incomingWidthMm) * 10) / 10;
  const overflowMm =
    Math.round(Math.max(0, nextUsedWidthMm - MAX_BASKET_WIDTH_MM) * 10) / 10;
  const nextRemainingWidthMm =
    Math.round(Math.max(0, MAX_BASKET_WIDTH_MM - nextUsedWidthMm) * 10) / 10;

  // Blue Basket stacking rule: never place a loaded basket on Layer 2 (L2) while Layer 1 (L1) is still empty
  const isLayer1Empty = slot.layer1.coils.length === 0;
  if (isBlueBasketBuilding(slot.buildingId) && targetLayer === 2 && isLayer1Empty) {
    return {
      ok: false,
      blockedEmptyLayer1: true,
      reasonTh:
        "ห้ามวางตะกร้าที่มีงานบนชั้น 2 (L2) เนื่องจากชั้นล่าง (L1) ยังเป็นตะกร้าเปล่า กรุณาวางงานบนชั้น 1 (L1) ก่อน",
      reasonEn:
        "Cannot place a loaded basket on Layer 2 (L2) while Layer 1 (L1) is empty. Please place on Layer 1 (L1) first.",
      currentUsedWidthMm,
      nextUsedWidthMm,
      nextRemainingWidthMm,
      overflowMm,
    };
  }

  if (nextUsedWidthMm > MAX_BASKET_WIDTH_MM) {
    return {
      ok: false,
      reasonTh: `เกินเงื่อนไขความกว้าง 2,000 มม. (เกิน ${overflowMm.toLocaleString()} มม. · คงเหลือรับได้ ${layerState.remainingWidthMm.toLocaleString()} มม.)`,
      reasonEn: `Exceeds 2,000 mm limit by ${overflowMm.toLocaleString()} mm (${layerState.remainingWidthMm.toLocaleString()} mm remaining).`,
      currentUsedWidthMm,
      nextUsedWidthMm,
      nextRemainingWidthMm: 0,
      overflowMm,
    };
  }

  return {
    ok: true,
    currentUsedWidthMm,
    nextUsedWidthMm,
    nextRemainingWidthMm,
    overflowMm: 0,
  };
}

export function buildBuildingBasketLayout3D(
  buildingId: BlueBasketBuildingId,
  warehouseConfig: BlueBasketWarehouseConfig,
  activeStockRecords: SlitBarcodeRecord[],
  sapMasterMap: Map<string, SapMasterItem>
): BuildingBasketLayout3D {
  const buildingConfig = warehouseConfig.buildings[buildingId];
  const rows = buildingConfig.rows;

  // Group active stock records belonging to this building by basketCode + layer
  const coilsByKey = new Map<string, BasketCoilPlacement[]>();

  for (const record of activeStockRecords) {
    const parsed = parseBasketLocation(record.location);
    if (!parsed || parsed.buildingId !== buildingId) continue;

    const batchKey = String(record.batch || "").trim().toUpperCase();
    const sap = sapMasterMap.get(batchKey);
    const { widthMm, widthSource } = resolveCoilWidthMm(record, sap);
    const weightKg =
      typeof sap?.weightKg === "number" && sap.weightKg > 0
        ? sap.weightKg
        : typeof record.weightKg === "number" && record.weightKg > 0
        ? record.weightKg
        : 0;

    const placement: BasketCoilPlacement = {
      record,
      batch: batchKey,
      widthMm,
      widthSource,
      weightKg,
      grade: sap?.grade || record.grade || "-",
      thickness: sap?.certThickness || record.certThickness || "-",
      manufacturer: sap?.manufacturer || record.manufacturer || "-",
      hasSapData: Boolean(sap || record.hasSapData),
      scanTimestamp: record.scanTimestamp || "",
      machine: record.machine || "-",
    };

    const key = `${parsed.basketCode}#L${parsed.layer}`;
    const list = coilsByKey.get(key) || [];
    list.push(placement);
    coilsByKey.set(key, list);
  }

  // Sort coils inside each basket-layer oldest-first so placement order is stable
  coilsByKey.forEach((list) => {
    list.sort((a, b) => a.scanTimestamp.localeCompare(b.scanTimestamp));
  });

  const isE10 = isCradleRackBuilding(buildingId);
  const isDualRoad = isDualRoadBuilding(buildingId);
  const oppositeGateId = buildingConfig.oppositeGateId || H2_OPPOSITE_GATE_ID;
  const oppositeRows = isDualRoad
    ? buildingConfig.oppositeRows && buildingConfig.oppositeRows.length > 0
      ? buildingConfig.oppositeRows
      : rows
    : [];

  const maxPrimarySlots = Math.max(
    1,
    ...rows.map((r) => Math.max(1, r.slotCount))
  );
  const maxOppositeSlots = isDualRoad
    ? Math.max(1, ...oppositeRows.map((r) => Math.max(1, r.slotCount)))
    : 0;

  const primaryRowCount = Math.max(1, rows.length);
  const oppositeRowCount = oppositeRows.length;

  const primarySpanX = (maxPrimarySlots - 1) * SLOT_PITCH_X;
  const oppositeSpanX = isDualRoad
    ? (maxOppositeSlots - 1) * SLOT_PITCH_X
    : 0;

  const primarySpanZ = isE10
    ? (maxPrimarySlots - 1) * E10_BAY_PITCH_Z
    : (primaryRowCount - 1) * ROW_PITCH_Z;
  const oppositeSpanZ = isDualRoad
    ? (Math.max(1, oppositeRowCount) - 1) * ROW_PITCH_Z
    : 0;

  // Dual-road geometry for Building H2: Central asphalt road at X = 0 separating Gate H4 (-X) & Gate H2 (+X)
  const roadWidth = 4.6;
  const apronWidth = 1.25;
  const halfCorridorX = roadWidth / 2 + apronWidth; // 3.55m from road center to each portal edge
  const primarySlabWidthDual = Math.max(
    18,
    primarySpanX + BASKET_OUTER_WIDTH_X + 6.4
  );
  const oppositeSlabWidthDual = Math.max(
    18,
    oppositeSpanX + BASKET_OUTER_WIDTH_X + 6.4
  );
  const primarySlabCenterX = halfCorridorX + primarySlabWidthDual / 2;
  const oppositeSlabCenterX = -(halfCorridorX + oppositeSlabWidthDual / 2);

  const slots: BasketSlot3D[] = [];
  const slotByCode = new Map<string, BasketSlot3D>();
  const rowPositions: BuildingBasketLayout3D["rowPositions"] = [];

  let occupiedSlots = 0;
  let activeBasketLayers = 0;
  let stacked2LayerCount = 0;
  let totalCoils = 0;
  let totalWeightKgAll = 0;
  let fullLayers = 0;
  let nearFullLayers = 0;
  let utilizationSum = 0;
  let pendingSapCoils = 0;

  const populateSideRows = (
    sideRows: BlueBasketRowConfig[],
    gateId: string,
    side: "primary" | "opposite",
    sideSpanZ: number
  ) => {
    sideRows.forEach((rowCfg, rowIndex) => {
      const rowWorldZ = isE10 ? 0 : -sideSpanZ / 2 + rowIndex * ROW_PITCH_Z;
      let rowOccupied = 0;
      let rowCoils = 0;

      for (let slotIndex = 0; slotIndex < rowCfg.slotCount; slotIndex++) {
        const slotNumber = slotIndex + 1;
        const basketCode = formatBasketCode(gateId, rowCfg.rowId, slotNumber);

        let worldX: number;
        let worldZ: number;
        if (isE10) {
          worldX = E10_RACK_CENTER_X;
          worldZ = -sideSpanZ / 2 + slotIndex * E10_BAY_PITCH_Z;
        } else if (isDualRoad) {
          // Mirror across central road at X = 0: slot 01 sits nearest the road on both H2 (+X) and H4 (-X)
          const firstSlotOffsetFromPortal = 4.15;
          worldX =
            side === "primary"
              ? halfCorridorX +
                firstSlotOffsetFromPortal +
                slotIndex * SLOT_PITCH_X
              : -(
                  halfCorridorX +
                  firstSlotOffsetFromPortal +
                  slotIndex * SLOT_PITCH_X
                );
          worldZ = rowWorldZ;
        } else {
          worldX = -primarySpanX / 2 + 0.95 + slotIndex * SLOT_PITCH_X;
          worldZ = rowWorldZ;
        }

        const l1Coils = coilsByKey.get(`${basketCode}#L1`) || [];
        const l2Coils = isE10 ? [] : coilsByKey.get(`${basketCode}#L2`) || [];

        const layer1 = buildLayerState(basketCode, 1, l1Coils);
        const layer2 = buildLayerState(basketCode, 2, l2Coils);

        const slotTotalCoils = l1Coils.length + l2Coils.length;
        const hasAnyCoil = slotTotalCoils > 0;
        const highestActiveLayer: 0 | 1 | 2 =
          l2Coils.length > 0 ? 2 : l1Coils.length > 0 ? 1 : 0;

        const slot: BasketSlot3D = {
          basketCode,
          buildingId,
          gateId,
          side,
          rowId: rowCfg.rowId,
          slotNumber,
          slotIndex,
          rowIndex,
          worldX,
          worldZ,
          layer1,
          layer2,
          hasAnyCoil,
          totalCoils: slotTotalCoils,
          totalWeightKg: layer1.totalWeightKg + layer2.totalWeightKg,
          highestActiveLayer,
        };

        slots.push(slot);
        slotByCode.set(basketCode, slot);

        if (hasAnyCoil) {
          occupiedSlots += 1;
          rowOccupied += 1;
        }
        if (l1Coils.length > 0) {
          activeBasketLayers += 1;
          utilizationSum += layer1.utilizationPercent;
          if (layer1.status === "FULL" || layer1.status === "OVERFLOW") {
            fullLayers += 1;
          } else if (layer1.status === "NEAR_FULL") {
            nearFullLayers += 1;
          }
        }
        if (l2Coils.length > 0) {
          activeBasketLayers += 1;
          stacked2LayerCount += 1;
          utilizationSum += layer2.utilizationPercent;
          if (layer2.status === "FULL" || layer2.status === "OVERFLOW") {
            fullLayers += 1;
          } else if (layer2.status === "NEAR_FULL") {
            nearFullLayers += 1;
          }
        }

        rowCoils += slotTotalCoils;
        totalCoils += slotTotalCoils;
        totalWeightKgAll += slot.totalWeightKg;
        for (const c of [...l1Coils, ...l2Coils]) {
          if (!c.hasSapData) pendingSapCoils += 1;
        }
      }

      rowPositions.push({
        gateId,
        side,
        rowId: rowCfg.rowId,
        rowIndex,
        worldZ: rowWorldZ,
        slotCount: rowCfg.slotCount,
        occupiedSlots: rowOccupied,
        totalCoils: rowCoils,
      });
    });
  };

  populateSideRows(rows, buildingId, "primary", primarySpanZ);
  if (isDualRoad) {
    populateSideRows(oppositeRows, oppositeGateId, "opposite", oppositeSpanZ);
  }

  const slabWidth = isE10
    ? E10_SLAB_WIDTH
    : isDualRoad
    ? oppositeSlabWidthDual + halfCorridorX * 2 + primarySlabWidthDual
    : Math.max(18, primarySpanX + BASKET_OUTER_WIDTH_X + 6.4);

  const maxSpanZ = Math.max(primarySpanZ, oppositeSpanZ);
  const slabDepth = isE10
    ? Math.max(21.5, primarySpanZ + E10_BAY_PITCH_Z + 5.2)
    : Math.max(14, maxSpanZ + BASKET_OUTER_DEPTH_Z + 4.8);

  const dualRoadLayout: DualRoadLayoutMeta | undefined = isDualRoad
    ? {
        roadCenterX: 0,
        roadWidth,
        apronWidth,
        primaryGateId: buildingId,
        oppositeGateId,
        primarySlabCenterX,
        primarySlabWidth: primarySlabWidthDual,
        oppositeSlabCenterX,
        oppositeSlabWidth: oppositeSlabWidthDual,
      }
    : undefined;

  return {
    buildingId,
    config: buildingConfig,
    slots,
    slotByCode,
    rowPositions,
    slabWidth,
    slabDepth,
    dualRoadLayout,
    stats: {
      totalSlots: slots.length,
      occupiedSlots,
      activeBasketLayers,
      stacked2LayerCount,
      totalCoils,
      totalWeightTons: Math.round((totalWeightKgAll / 1000) * 100) / 100,
      fullLayers,
      nearFullLayers,
      avgUtilizationPercent:
        activeBasketLayers > 0
          ? Math.round(utilizationSum / activeBasketLayers)
          : 0,
      pendingSapCoils,
    },
  };
}

export function getNextAvailableRowId(existingRows: BlueBasketRowConfig[]): string {
  const used = new Set(existingRows.map((r) => r.rowId.toUpperCase()));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < alphabet.length; i++) {
    const ch = alphabet[i];
    if (!used.has(ch)) return ch;
  }
  let idx = 1;
  while (used.has(`R${idx}`)) idx += 1;
  return `R${idx}`;
}

export function loadCachedBlueBasketConfig(): BlueBasketWarehouseConfig {
  if (typeof window === "undefined") return createDefaultBlueBasketConfig();
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return createDefaultBlueBasketConfig();
    return normalizeBlueBasketConfig(JSON.parse(raw));
  } catch {
    return createDefaultBlueBasketConfig();
  }
}

export function subscribeBlueBasketConfig(
  onData: (config: BlueBasketWarehouseConfig) => void
): () => void {
  const docRef = doc(db, SPACE_CONFIG_COLLECTION, BLUE_BASKET_3D_DOC_ID);
  let disposed = false;

  const applyConfig = (raw: unknown) => {
    if (disposed) return;
    const normalized = normalizeBlueBasketConfig(raw);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
      }
    } catch {
      // ignore storage quota errors
    }
    onData(normalized);
  };

  if (!getCloudRealtimeEnabled()) {
    getDoc(docRef)
      .then((snap) => {
        if (snap.exists()) {
          applyConfig(snap.data());
        }
      })
      .catch(() => {
        // fallback to cached config
      });
    return () => {
      disposed = true;
    };
  }

  const unsub = onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        applyConfig(snap.data());
      }
    },
    () => {
      // ignore network error; local cache remains active
    }
  );

  return () => {
    disposed = true;
    try {
      unsub();
    } catch {
      // ignore
    }
  };
}

export async function saveBlueBasketConfigToCloud(
  config: BlueBasketWarehouseConfig
): Promise<void> {
  const payload: BlueBasketWarehouseConfig = {
    ...normalizeBlueBasketConfig(config),
    id: BLUE_BASKET_3D_DOC_ID,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    // ignore
  }

  try {
    await setDoc(
      doc(db, SPACE_CONFIG_COLLECTION, BLUE_BASKET_3D_DOC_ID),
      payload,
      { merge: true }
    );
  } catch (err) {
    console.warn("Could not save blue basket 3D layout to Firestore:", err);
  }
}
