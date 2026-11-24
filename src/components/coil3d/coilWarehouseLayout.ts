import { CoilStockRecord, CoilSapMasterItem } from "../../services/coilDataService";

export type BuildingGroupId = "E7-E8" | "H9-H10" | "05" | "21";

export type SlotVisualStatus =
  | "EMPTY"
  | "OCCUPIED"
  | "RESERVED"
  | "BLOCKED"
  | "FOCUS"
  | "PENDING_SAP";

export interface BuildingGroupConfig {
  id: BuildingGroupId;
  labelTh: string;
  labelEn: string;
  subtitleTh: string;
  subtitleEn: string;
  doors: string[];
  defaultRowsPerDoor: number;
  baseSlotsPerRow: number;
  slabWidth: number;
  slabDepth: number;
}

export const DEFAULT_BASE_SLOTS_PER_ROW = 12;
export const MIN_BASE_SLOTS_PER_ROW = 6;
export const MAX_BASE_SLOTS_PER_ROW = 30;
export const MAX_STACK_LEVEL = 4;
export type StackLevel = 1 | 2 | 3 | 4;
export const STACK_LEVELS: StackLevel[] = [1, 2, 3, 4];

export function clampBaseSlotsPerRow(value?: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BASE_SLOTS_PER_ROW;
  return Math.max(MIN_BASE_SLOTS_PER_ROW, Math.min(MAX_BASE_SLOTS_PER_ROW, n));
}

export function getLevelCapacity(baseSlotsPerRow: number, level: number): number {
  if (level < 1 || level > MAX_STACK_LEVEL) return 0;
  return Math.max(0, baseSlotsPerRow - (level - 1));
}

export function getMaxCoilsPerRow(baseSlotsPerRow: number): number {
  let total = 0;
  for (let lv = 1; lv <= MAX_STACK_LEVEL; lv++) {
    total += getLevelCapacity(baseSlotsPerRow, lv);
  }
  return total;
}

export const BUILDING_GROUPS: BuildingGroupConfig[] = [
  {
    id: "E7-E8",
    labelTh: "กลุ่มอาคาร E7 - E8",
    labelEn: "Bay E7 - E8",
    subtitleTh: "คลังเหล็กม้วนหลัก (2 ประตู)",
    subtitleEn: "Main Coil Bay (2 Doors)",
    doors: ["E7", "E8"],
    defaultRowsPerDoor: 8,
    baseSlotsPerRow: DEFAULT_BASE_SLOTS_PER_ROW,
    slabWidth: 42,
    slabDepth: 28,
  },
  {
    id: "H9-H10",
    labelTh: "กลุ่มอาคาร H9 - H10",
    labelEn: "Bay H9 - H10",
    subtitleTh: "คลังเหล็กม้วนสาย H (2 ประตู)",
    subtitleEn: "H-Line Coil Bay (2 Doors)",
    doors: ["H9", "H10"],
    defaultRowsPerDoor: 8,
    baseSlotsPerRow: DEFAULT_BASE_SLOTS_PER_ROW,
    slabWidth: 42,
    slabDepth: 28,
  },
  {
    id: "05",
    labelTh: "อาคาร 05",
    labelEn: "Building 05",
    subtitleTh: "คลังจัดเก็บอาคาร 05",
    subtitleEn: "Storage Building 05",
    doors: ["05"],
    defaultRowsPerDoor: 10,
    baseSlotsPerRow: DEFAULT_BASE_SLOTS_PER_ROW,
    slabWidth: 32,
    slabDepth: 28,
  },
  {
    id: "21",
    labelTh: "อาคาร 21",
    labelEn: "Building 21",
    subtitleTh: "คลังจัดเก็บอาคาร 21",
    subtitleEn: "Storage Building 21",
    doors: ["21"],
    defaultRowsPerDoor: 10,
    baseSlotsPerRow: DEFAULT_BASE_SLOTS_PER_ROW,
    slabWidth: 32,
    slabDepth: 28,
  },
];

// Physical 3D dimensions (in meters)
export const COIL_OUTER_RADIUS = 0.62;
export const COIL_INNER_RADIUS = 0.25;
export const COIL_WIDTH = 1.06;
export const SADDLE_HEIGHT = 0.14;
export const SLOT_SPACING_Z = 1.38; // Center-to-center spacing along pyramid stacking axis (perpendicular to road)
export const ROW_SPACING_X = 1.92; // Center-to-center spacing between rows along the road
export const DOOR_GAP_X = 2.6; // Separation between Door A (left) and Door B (right) in dual-door bay

// Exact tangent vertical lift for Level 2 coil nested in groove between two Level 1 coils
export const PYRAMID_LEVEL_DY = Math.sqrt(
  Math.max(0.01, (2 * COIL_OUTER_RADIUS) ** 2 - (SLOT_SPACING_Z / 2) ** 2)
);

export interface WarehouseSlot3D {
  slotKey: string;
  groupId: BuildingGroupId;
  door: string;
  row: number;
  slotIndex: number; // 1-based slot index within row/level (S1 closest to road)
  level: number; // 1 = floor base, 2 = pyramid groove, 3 = apex overflow
  x: number;
  y: number; // Center Y for coil (or floor top Y for saddle)
  z: number;
  saddleY: number;
  status: SlotVisualStatus;
  coil?: CoilStockRecord;
  isPendingSap: boolean;
  isBlocked: boolean;
}

export interface BuildingLayoutResult {
  group: BuildingGroupConfig;
  slots: WarehouseSlot3D[];
  occupiedSlots: WarehouseSlot3D[];
  emptyFloorSlots: WarehouseSlot3D[];
  doors: string[];
  rows: number[];
  levels: number[];
  stats: {
    totalCoils: number;
    totalWeightTons: number;
    emptyFloorCount: number;
    totalFloorCount: number;
    occupiedCount: number;
    reservedCount: number;
    blockedCount: number;
    pendingSapCount: number;
  };
}

export interface ParsedCoilLocation {
  groupId: BuildingGroupId;
  door: string;
  row: number;
  explicitLevel?: number;
  explicitSlotIndex?: number;
  rawLocation: string;
}

const KNOWN_BUILDING_TO_GROUP: Record<string, BuildingGroupId> = {
  E7: "E7-E8",
  E8: "E7-E8",
  H9: "H9-H10",
  H10: "H9-H10",
  H7: "H9-H10",
  H8: "H9-H10",
  "05": "05",
  "5": "05",
  "21": "21",
};

export function parseCoilLocationTo3D(rawLocation?: string): ParsedCoilLocation {
  const cleaned = String(rawLocation || "")
    .trim()
    .toUpperCase();

  if (!cleaned || cleaned === "-") {
    return { groupId: "E7-E8", door: "E7", row: 1, rawLocation: cleaned || "E7/1" };
  }

  // Supports 2-part ("E7/1"), 3-part ("E7/1/2"), and 4-part ("E7/1/2/3" = Door/Row/Level/Seq)
  const parts = cleaned.split(/[\/\-_\s]+/).filter(Boolean);
  const first = parts[0] || "";
  const second = parts[1] || "";
  const third = parts[2] || "";
  const fourth = parts[3] || "";

  let door = "E7";
  let groupId: BuildingGroupId = "E7-E8";

  if (KNOWN_BUILDING_TO_GROUP[first]) {
    groupId = KNOWN_BUILDING_TO_GROUP[first];
    door =
      first === "5"
        ? "05"
        : first === "H7"
        ? "H9"
        : first === "H8"
        ? "H10"
        : first;
  } else if (/^E7/.test(cleaned)) {
    groupId = "E7-E8";
    door = "E7";
  } else if (/^E8/.test(cleaned)) {
    groupId = "E7-E8";
    door = "E8";
  } else if (/^H10/.test(cleaned)) {
    groupId = "H9-H10";
    door = "H10";
  } else if (/^H9/.test(cleaned)) {
    groupId = "H9-H10";
    door = "H9";
  } else if (/^H7/.test(cleaned)) {
    groupId = "H9-H10";
    door = "H9";
  } else if (/^H8/.test(cleaned)) {
    groupId = "H9-H10";
    door = "H10";
  } else if (/^0?5\b/.test(cleaned)) {
    groupId = "05";
    door = "05";
  } else if (/^21\b/.test(cleaned)) {
    groupId = "21";
    door = "21";
  } else if (/^CL2|^SM/.test(cleaned)) {
    // Map legacy bay codes gracefully so zero coils are orphaned
    groupId = "E7-E8";
    door = "E8";
  }

  // Extract numeric row from second token (or trailing digits)
  let row = 1;
  const digitMatch = (second || cleaned.slice(door.length)).match(/\d+/);
  if (digitMatch) {
    const parsedRow = parseInt(digitMatch[0], 10);
    if (Number.isFinite(parsedRow) && parsedRow >= 1) {
      row = Math.min(parsedRow, 24);
    }
  }

  // Optional explicit level (parts[2], e.g. 1..4; parse higher integers too so validation can reject > 4)
  let explicitLevel: number | undefined;
  if (third) {
    const lvMatch = third.match(/\d+/);
    if (lvMatch) {
      const lv = parseInt(lvMatch[0], 10);
      if (Number.isFinite(lv) && lv >= 1 && lv <= 99) {
        explicitLevel = lv;
      }
    }
  }

  // Optional explicit sequence slot (parts[3], e.g. 1..50)
  let explicitSlotIndex: number | undefined;
  if (fourth) {
    const slotMatch = fourth.match(/\d+/);
    if (slotMatch) {
      const slot = parseInt(slotMatch[0], 10);
      if (Number.isFinite(slot) && slot >= 1 && slot <= 50) {
        explicitSlotIndex = slot;
      }
    }
  }

  return {
    groupId,
    door,
    row,
    explicitLevel,
    explicitSlotIndex,
    rawLocation: cleaned,
  };
}

export function isCoilPendingSap(
  coil: CoilStockRecord,
  sapMap?: Map<string, CoilSapMasterItem>
): boolean {
  const batchKey = String(coil.batch || "")
    .trim()
    .toUpperCase();
  if (sapMap && batchKey && sapMap.has(batchKey)) {
    return false;
  }
  if (coil.hasSapData === true) return false;
  if (coil.hasSapData === false) return true;
  // Fallback for legacy records without explicit boolean
  const hasWeight = Number(coil.weightKg || 0) > 0;
  const hasGrade = Boolean(coil.grade && coil.grade.trim() !== "" && coil.grade.trim() !== "-");
  return !hasWeight && !hasGrade;
}

export function isCoilBlocked(coil: CoilStockRecord): boolean {
  const text = `${coil.remark || ""} ${coil.conditionText || ""} ${coil.qualityClass || ""}`;
  return /\b(hold|block|blocked|ng|reject|quarantine)\b|กักกัน|ปิดใช้งาน|รอตรวจสอบคุณภาพ/i.test(
    text
  );
}

/**
 * Computes auto-pyramid (slotIndex, level) for the n-th coil (0-based) placed inside a row.
 * Coils stack from the road edge (S1) going back into the bay (S2..SB),
 * filling pyramid grooves up to MAX_STACK_LEVEL (4 levels max).
 */
function computePyramidPositionInRow(
  orderIndex: number,
  baseSlotsPerRow: number
): { level: number; slotIndex: number } {
  const B = Math.max(4, baseSlotsPerRow);

  if (orderIndex === 0) return { level: 1, slotIndex: 1 };
  if (orderIndex === 1) return { level: 1, slotIndex: 2 };
  if (orderIndex === 2) return { level: 2, slotIndex: 1 };

  // Pattern for indices 3 .. (2*B - 2): alternates L1 S(k) then L2 S(k-1)
  const twoLevelCap = 2 * B - 1;
  if (orderIndex < twoLevelCap) {
    const offset = orderIndex - 3;
    const pair = Math.floor(offset / 2); // 0 -> S3/S2, 1 -> S4/S3 ...
    const isUpper = offset % 2 === 1;
    if (!isUpper) {
      return { level: 1, slotIndex: 3 + pair };
    }
    return { level: 2, slotIndex: 2 + pair };
  }

  // Level 3 (1..(B-2))
  const l3Index = orderIndex - twoLevelCap;
  const maxL3 = Math.max(0, B - 2);
  if (l3Index < maxL3) {
    return { level: 3, slotIndex: 1 + l3Index };
  }

  // Level 4 (1..(B-3)) — strictly capped at 4 levels max
  const l4Index = l3Index - maxL3;
  const maxL4 = Math.max(0, B - 3);
  if (l4Index < maxL4) {
    return { level: 4, slotIndex: 1 + l4Index };
  }

  // Overflow beyond 4-level pyramid capacity: extend along Level 1 floor beyond B (never level 5+)
  const extraIdx = l4Index - maxL4;
  return { level: 1, slotIndex: B + 1 + extraIdx };
}

/**
 * Resolves exact (level, slotIndex) assignments for all coils in a single (door, row) bucket.
 * Enforces the physical pyramid base-support rule AND maximum height of 4 levels:
 * - Level 1: floor base.
 * - Level L (2..4) slot k requires BOTH Level (L-1) slot k and slot k+1 beneath it.
 * - Never renders any coil above Level 4 or floating without base support.
 */
function resolveRowCoilPlacements(
  rowCoils: CoilStockRecord[],
  baseSlotsPerRow: number
): Array<{ coil: CoilStockRecord; level: number; slotIndex: number }> {
  const occupiedKeys = new Set<string>();
  const resolved: Array<{ coil: CoilStockRecord; level: number; slotIndex: number }> = [];

  const explicitByLevel: Record<StackLevel, Array<{ coil: CoilStockRecord; slot?: number }>> = {
    1: [],
    2: [],
    3: [],
    4: [],
  };
  const implicitCoils: CoilStockRecord[] = [];

  for (const coil of rowCoils) {
    const parsed = parseCoilLocationTo3D(coil.location);
    if (parsed.explicitLevel && parsed.explicitLevel >= 1) {
      // Strictly clamp any historical record > 4 to max 4
      const clampedLv = Math.min(MAX_STACK_LEVEL, parsed.explicitLevel) as StackLevel;
      explicitByLevel[clampedLv].push({ coil, slot: parsed.explicitSlotIndex });
    } else {
      implicitCoils.push(coil);
    }
  }

  const getMaxSlotsForLevel = (lv: number) => getLevelCapacity(baseSlotsPerRow, lv);

  const hasBaseSupport = (level: number, slot: number): boolean => {
    if (level <= 1) return true;
    if (level > MAX_STACK_LEVEL) return false;
    return (
      occupiedKeys.has(`${level - 1}:${slot}`) &&
      occupiedKeys.has(`${level - 1}:${slot + 1}`)
    );
  };

  const findNextFreeFloorSlot = (startAt = 1): number => {
    let slot = Math.max(1, startAt);
    while (occupiedKeys.has(`1:${slot}`)) {
      slot += 1;
    }
    return slot;
  };

  const findNextFreeSupportedSlot = (level: number, preferredSlot?: number): number | null => {
    if (level > MAX_STACK_LEVEL || level < 1) return null;
    if (preferredSlot && preferredSlot >= 1) {
      if (!occupiedKeys.has(`${level}:${preferredSlot}`) && hasBaseSupport(level, preferredSlot)) {
        return preferredSlot;
      }
    }
    const maxSlots = getMaxSlotsForLevel(level);
    for (let s = 1; s <= maxSlots; s++) {
      if (!occupiedKeys.has(`${level}:${s}`) && hasBaseSupport(level, s)) {
        return s;
      }
    }
    return null;
  };

  const settleToHighestSupportedOrFloor = (maxLevel: number, coil: CoilStockRecord, preferredSlot?: number) => {
    for (let lv = Math.min(MAX_STACK_LEVEL, maxLevel); lv >= 2; lv--) {
      const slot = findNextFreeSupportedSlot(lv, lv === maxLevel ? preferredSlot : undefined);
      if (slot !== null) {
        occupiedKeys.add(`${lv}:${slot}`);
        resolved.push({ coil, level: lv, slotIndex: slot });
        return;
      }
    }
    const floorSlot = findNextFreeFloorSlot(1);
    occupiedKeys.add(`1:${floorSlot}`);
    resolved.push({ coil, level: 1, slotIndex: floorSlot });
  };

  // Pass 1: Place all explicit Level 1 floor coils first
  for (const item of explicitByLevel[1]) {
    const slot = findNextFreeFloorSlot(item.slot || 1);
    occupiedKeys.add(`1:${slot}`);
    resolved.push({ coil: item.coil, level: 1, slotIndex: slot });
  }

  // Pass 2: Place explicit Level 2 coils that already have base support; defer others for Pass 4
  const deferredL2: Array<{ coil: CoilStockRecord; slot?: number }> = [];
  const reservedExplicitSlots = new Set<string>();
  for (const lv of [2, 3, 4] as StackLevel[]) {
    for (const item of explicitByLevel[lv]) {
      if (item.slot) reservedExplicitSlots.add(`${lv}:${item.slot}`);
    }
  }

  for (const item of explicitByLevel[2]) {
    if (item.slot && !occupiedKeys.has(`2:${item.slot}`) && hasBaseSupport(2, item.slot)) {
      occupiedKeys.add(`2:${item.slot}`);
      resolved.push({ coil: item.coil, level: 2, slotIndex: item.slot });
    } else if (!item.slot) {
      const supportedSlot = findNextFreeSupportedSlot(2);
      if (supportedSlot !== null) {
        occupiedKeys.add(`2:${supportedSlot}`);
        resolved.push({ coil: item.coil, level: 2, slotIndex: supportedSlot });
      } else {
        deferredL2.push(item);
      }
    } else {
      deferredL2.push(item);
    }
  }

  // Pass 3: Place legacy/implicit coils in next free & physically supported pyramid slots (max Level 4)
  let searchIdx = 0;
  for (const coil of implicitCoils) {
    let chosen = computePyramidPositionInRow(searchIdx, baseSlotsPerRow);
    let safetyCounter = 0;
    while (
      occupiedKeys.has(`${chosen.level}:${chosen.slotIndex}`) ||
      !hasBaseSupport(chosen.level, chosen.slotIndex) ||
      (chosen.level >= 2 && reservedExplicitSlots.has(`${chosen.level}:${chosen.slotIndex}`))
    ) {
      searchIdx += 1;
      safetyCounter += 1;
      chosen = computePyramidPositionInRow(searchIdx, baseSlotsPerRow);
      if (safetyCounter > baseSlotsPerRow * 8) {
        chosen = { level: 1, slotIndex: findNextFreeFloorSlot(1) };
        break;
      }
    }
    occupiedKeys.add(`${chosen.level}:${chosen.slotIndex}`);
    resolved.push({ coil, level: chosen.level, slotIndex: chosen.slotIndex });
    searchIdx += 1;
  }

  // Pass 4: Retry deferred explicit Level 2 coils
  for (const item of deferredL2) {
    settleToHighestSupportedOrFloor(2, item.coil, item.slot);
  }

  // Pass 5: Place explicit Level 3 coils (require BOTH Level 2 k & k+1)
  for (const item of explicitByLevel[3]) {
    settleToHighestSupportedOrFloor(3, item.coil, item.slot);
  }

  // Pass 6: Place explicit Level 4 coils (require BOTH Level 3 k & k+1; max height = 4)
  for (const item of explicitByLevel[4]) {
    settleToHighestSupportedOrFloor(4, item.coil, item.slot);
  }

  return resolved;
}

export interface LevelOccupancyInfo {
  level: StackLevel;
  capacity: number;
  occupiedSlots: number[];
  supportedSlots: number[]; // Slots where lower-level base exists (for L1: 1..capacity; for L2..L4: both L-1(k) & L-1(k+1))
  availableSupportedSlots: number[];
  occupiedCount: number;
  availableCount: number;
  isFull: boolean;
  hasBaseSupport: boolean;
  canPlace: boolean;
  nextSeq: number | null;
}

export interface RowLevelRecommendation {
  door: string;
  row: number;
  baseCapacity: number;
  totalRowCapacity: number;
  maxStackLevel: number;
  levels: Record<StackLevel, LevelOccupancyInfo>;
  level1: LevelOccupancyInfo & { nextSeq: number };
  level2: LevelOccupancyInfo;
  level3: LevelOccupancyInfo;
  level4: LevelOccupancyInfo;
  recommendedLevel: StackLevel;
  recommendedSeq: number;
  recommendedLocation: string;
  reasonTh: string;
  reasonEn: string;
  isRowCompletelyFull: boolean;
}

/**
 * Inspects live stock inside (door, row) across Levels 1..4 (max 4 levels)
 * and recommends the optimal Level and next sequence slot (e.g. E7/1/3/2).
 * Strictly enforces base support: Level L (2..4) slot k requires BOTH Level (L-1) slot k and k+1.
 */
export function getRowLevelOccupancy(
  doorInput: string,
  rowInput: number | string,
  activeCoils: CoilStockRecord[],
  customBaseSlotsPerRow?: number
): RowLevelRecommendation {
  const door = String(doorInput || "E7").trim().toUpperCase();
  const parsedRowNum = parseInt(String(rowInput || "1").replace(/\D/g, ""), 10);
  const row = Number.isFinite(parsedRowNum) && parsedRowNum >= 1 ? parsedRowNum : 1;

  const groupId = KNOWN_BUILDING_TO_GROUP[door] || "E7-E8";
  const groupCfg =
    BUILDING_GROUPS.find((g) => g.id === groupId) || BUILDING_GROUPS[0];
  const baseCapacity =
    customBaseSlotsPerRow !== undefined
      ? clampBaseSlotsPerRow(customBaseSlotsPerRow)
      : groupCfg.baseSlotsPerRow;
  const totalRowCapacity = getMaxCoilsPerRow(baseCapacity);

  const rowCoils = activeCoils
    .filter((c) => c.status !== "issued")
    .filter((c) => {
      const p = parseCoilLocationTo3D(c.location);
      return p.door === door && p.row === row;
    })
    .sort((a, b) => {
      const ta = a.scanTimestamp || a.updatedAt || "";
      const tb = b.scanTimestamp || b.updatedAt || "";
      if (ta !== tb) return ta.localeCompare(tb);
      return String(a.batch || "").localeCompare(String(b.batch || ""));
    });

  const placements = resolveRowCoilPlacements(rowCoils, baseCapacity);

  const setsByLevel: Record<StackLevel, Set<number>> = {
    1: new Set<number>(),
    2: new Set<number>(),
    3: new Set<number>(),
    4: new Set<number>(),
  };

  placements.forEach((p) => {
    if (p.level >= 1 && p.level <= MAX_STACK_LEVEL) {
      setsByLevel[p.level as StackLevel].add(p.slotIndex);
    }
  });

  const buildLevelInfo = (lv: StackLevel): LevelOccupancyInfo => {
    const cap = getLevelCapacity(baseCapacity, lv);
    const occSet = setsByLevel[lv];
    const occupiedSlots = Array.from(occSet).sort((a, b) => a - b);
    const countInCap = occupiedSlots.filter((s) => s >= 1 && s <= cap).length;
    const isFull = countInCap >= cap;
    const availableCount = Math.max(0, cap - countInCap);

    if (lv === 1) {
      let nextL1 = 1;
      while (occSet.has(nextL1)) nextL1 += 1;
      const supportedSlots = Array.from({ length: cap }, (_, i) => i + 1);
      const availableSupportedSlots = supportedSlots.filter((s) => !occSet.has(s));
      return {
        level: 1,
        capacity: cap,
        occupiedSlots,
        supportedSlots,
        availableSupportedSlots,
        occupiedCount: occupiedSlots.length,
        availableCount,
        isFull,
        hasBaseSupport: true,
        canPlace: true,
        nextSeq: nextL1,
      };
    }

    const lowerSet = setsByLevel[(lv - 1) as StackLevel];
    const supportedSlots: number[] = [];
    const availableSupportedSlots: number[] = [];
    for (let k = 1; k <= cap; k++) {
      if (lowerSet.has(k) && lowerSet.has(k + 1)) {
        supportedSlots.push(k);
        if (!occSet.has(k)) {
          availableSupportedSlots.push(k);
        }
      }
    }

    const nextSeq = availableSupportedSlots.length > 0 ? availableSupportedSlots[0] : null;
    return {
      level: lv,
      capacity: cap,
      occupiedSlots,
      supportedSlots,
      availableSupportedSlots,
      occupiedCount: occupiedSlots.length,
      availableCount,
      isFull,
      hasBaseSupport: supportedSlots.length > 0,
      canPlace: availableSupportedSlots.length > 0,
      nextSeq,
    };
  };

  const level1Info = buildLevelInfo(1) as LevelOccupancyInfo & { nextSeq: number };
  const level2Info = buildLevelInfo(2);
  const level3Info = buildLevelInfo(3);
  const level4Info = buildLevelInfo(4);

  const levels: Record<StackLevel, LevelOccupancyInfo> = {
    1: level1Info,
    2: level2Info,
    3: level3Info,
    4: level4Info,
  };

  const isRowCompletelyFull =
    level1Info.isFull && level2Info.isFull && level3Info.isFull && level4Info.isFull;

  // Smart auto-recommendation across Levels 1..4:
  // Recommend lowest level that isn't full and has valid base support.
  let recommendedLevel: StackLevel = 1;
  let recommendedSeq = level1Info.nextSeq;
  let reasonTh = "";
  let reasonEn = "";

  if (!level1Info.isFull) {
    recommendedLevel = 1;
    recommendedSeq = level1Info.nextSeq;
    const upperReadyLevels = ([2, 3, 4] as StackLevel[]).filter((lv) => levels[lv].canPlace);
    if (level1Info.occupiedCount === 0) {
      reasonTh = `แถว ${row} ว่างทั้งหมด — แนะนำวางชั้น 1 ลำดับที่ ${recommendedSeq} (วางซ้อนได้สูงสุด 4 ชั้น)`;
      reasonEn = `Row ${row} is empty — recommended Level 1, Slot ${recommendedSeq} (max 4 levels)`;
    } else if (upperReadyLevels.length > 0) {
      reasonTh = `ชั้น 1 ว่างอีก ${level1Info.availableCount} ช่อง (แนะนำลำดับ ${recommendedSeq}) · ชั้น ${upperReadyLevels.join(", ")} พร้อมวางซ้อนได้`;
      reasonEn = `Level 1 has ${level1Info.availableCount} free (Next #${recommendedSeq}) · Upper levels ready: L${upperReadyLevels.join(", L")}`;
    } else {
      reasonTh = `ชั้น 1 มี ${level1Info.occupiedCount}/${baseCapacity} ม้วน — แนะนำวางต่อชั้น 1 ลำดับที่ ${recommendedSeq} (ชั้นบนต้องมีฐานติดกัน 2 ลูก)`;
      reasonEn = `Level 1 has ${level1Info.occupiedCount}/${baseCapacity} coils — recommended Level 1, Slot ${recommendedSeq}`;
    }
  } else if (level2Info.canPlace && level2Info.nextSeq !== null) {
    recommendedLevel = 2;
    recommendedSeq = level2Info.nextSeq;
    reasonTh = `ชั้น 1 เต็มแล้ว — แนะนำอัตโนมัติวางชั้น 2 ลำดับที่ ${recommendedSeq} (มีฐานชั้น 1 ลูกที่ ${recommendedSeq} และ ${recommendedSeq + 1} รองรับ)`;
    reasonEn = `Level 1 full — auto-recommended Level 2, Slot ${recommendedSeq}`;
  } else if (level3Info.canPlace && level3Info.nextSeq !== null) {
    recommendedLevel = 3;
    recommendedSeq = level3Info.nextSeq;
    reasonTh = `ชั้น 1–2 เต็มแล้ว — แนะนำอัตโนมัติวางชั้น 3 ลำดับที่ ${recommendedSeq} (มีฐานชั้น 2 ลูกที่ ${recommendedSeq} และ ${recommendedSeq + 1} รองรับ)`;
    reasonEn = `Levels 1–2 full — auto-recommended Level 3, Slot ${recommendedSeq}`;
  } else if (level4Info.canPlace && level4Info.nextSeq !== null) {
    recommendedLevel = 4;
    recommendedSeq = level4Info.nextSeq;
    reasonTh = `ชั้น 1–3 เต็มแล้ว — แนะนำอัตโนมัติวางชั้น 4 (ชั้นสูงสุด) ลำดับที่ ${recommendedSeq} (มีฐานชั้น 3 ลูกที่ ${recommendedSeq} และ ${recommendedSeq + 1} รองรับ)`;
    reasonEn = `Levels 1–3 full — auto-recommended Level 4 (Max), Slot ${recommendedSeq}`;
  } else {
    recommendedLevel = 1;
    recommendedSeq = level1Info.nextSeq;
    reasonTh = `แถว ${row} เต็มครบทั้ง 4 ชั้นแล้ว (${totalRowCapacity}/${totalRowCapacity} ม้วน) — แนะนำเลือกแถวอื่นที่ว่าง`;
    reasonEn = `Row ${row} is completely full across all 4 levels (${totalRowCapacity}/${totalRowCapacity}) — select another row`;
  }

  return {
    door,
    row,
    baseCapacity,
    totalRowCapacity,
    maxStackLevel: MAX_STACK_LEVEL,
    levels,
    level1: level1Info,
    level2: level2Info,
    level3: level3Info,
    level4: level4Info,
    recommendedLevel,
    recommendedSeq,
    recommendedLocation: `${door}/${row}/${recommendedLevel}/${recommendedSeq}`,
    reasonTh,
    reasonEn,
    isRowCompletelyFull,
  };
}

export interface CoilPlacementValidationResult {
  valid: boolean;
  door: string;
  row: number;
  level: number;
  slotIndex?: number;
  requiredBaseSlots: number[];
  missingBaseSlots: number[];
  reasonTh?: string;
  reasonEn?: string;
  recommendedLocation: string;
}

/**
 * Validates whether a target Location (e.g. E7/1/2/1 or E7/1/4/1) satisfies:
 * 1. Maximum stack height = 4 levels (rejects Level 5+).
 * 2. Pyramid base-support rule: Level L (2..4) slot k MUST have BOTH Level (L-1) slot k AND k+1 occupied.
 * Excludes any batch in `excludeBatches` so a coil being updated/relocated cannot count as its own base.
 */
export function validateCoilPlacementLocation(
  targetLocation: string,
  activeCoils: CoilStockRecord[],
  excludeBatches: string[] = [],
  customBaseSlotsPerRow?: number
): CoilPlacementValidationResult {
  const parsed = parseCoilLocationTo3D(targetLocation);
  const excludeSet = new Set(
    excludeBatches.map((b) => String(b || "").trim().toUpperCase()).filter(Boolean)
  );
  const filteredCoils = activeCoils.filter(
    (c) =>
      c.status !== "issued" &&
      !excludeSet.has(String(c.batch || "").trim().toUpperCase())
  );

  const occupancy = getRowLevelOccupancy(
    parsed.door,
    parsed.row,
    filteredCoils,
    customBaseSlotsPerRow
  );
  const targetLevel = parsed.explicitLevel || 1;

  // Hard cap: maximum 4 levels allowed
  if (targetLevel > MAX_STACK_LEVEL) {
    return {
      valid: false,
      door: parsed.door,
      row: parsed.row,
      level: targetLevel,
      slotIndex: parsed.explicitSlotIndex,
      requiredBaseSlots: [],
      missingBaseSlots: [],
      reasonTh: `ไม่สามารถวางชั้นที่ ${targetLevel} (${parsed.rawLocation}) ได้ — ระบบจำกัดความสูงการวางสูงสุดแค่ ${MAX_STACK_LEVEL} ชั้นเท่านั้น (ชั้น 1–${MAX_STACK_LEVEL})`,
      reasonEn: `Cannot place on Level ${targetLevel} — maximum stacking height is ${MAX_STACK_LEVEL} levels (L1–L${MAX_STACK_LEVEL})`,
      recommendedLocation: occupancy.recommendedLocation,
    };
  }

  if (targetLevel <= 1) {
    return {
      valid: true,
      door: parsed.door,
      row: parsed.row,
      level: 1,
      slotIndex: parsed.explicitSlotIndex ?? occupancy.level1.nextSeq,
      requiredBaseSlots: [],
      missingBaseSlots: [],
      recommendedLocation: occupancy.recommendedLocation,
    };
  }

  // Levels 2, 3, 4: strictly require BOTH lower-level coils k and k+1
  const lv = targetLevel as StackLevel;
  const lowerLv = (lv - 1) as StackLevel;
  const levelInfo = occupancy.levels[lv];
  const lowerInfo = occupancy.levels[lowerLv];
  const lowerSet = new Set(lowerInfo.occupiedSlots);
  const currSet = new Set(levelInfo.occupiedSlots);

  // If user didn't specify a slot (e.g., E7/1/3), check if any supported empty slot exists on this level
  if (!parsed.explicitSlotIndex) {
    if (levelInfo.canPlace && levelInfo.nextSeq !== null) {
      const k = levelInfo.nextSeq;
      return {
        valid: true,
        door: parsed.door,
        row: parsed.row,
        level: lv,
        slotIndex: k,
        requiredBaseSlots: [k, k + 1],
        missingBaseSlots: [],
        recommendedLocation: `${parsed.door}/${parsed.row}/${lv}/${k}`,
      };
    }

    if (levelInfo.isFull) {
      return {
        valid: false,
        door: parsed.door,
        row: parsed.row,
        level: lv,
        requiredBaseSlots: [],
        missingBaseSlots: [],
        reasonTh: `ไม่สามารถวางชั้นที่ ${lv} แถว ${parsed.door}/${parsed.row} ได้ — ชั้นที่ ${lv} เต็มแล้ว (${levelInfo.capacity}/${levelInfo.capacity})`,
        reasonEn: `Cannot place on Level ${lv} in ${parsed.door}/${parsed.row} — Level ${lv} is full`,
        recommendedLocation: occupancy.recommendedLocation,
      };
    }

    let firstFree = 1;
    while (currSet.has(firstFree) && firstFree <= levelInfo.capacity) {
      firstFree += 1;
    }
    const req = [firstFree, firstFree + 1];
    const missing = req.filter((s) => !lowerSet.has(s));
    return {
      valid: false,
      door: parsed.door,
      row: parsed.row,
      level: lv,
      slotIndex: firstFree,
      requiredBaseSlots: req,
      missingBaseSlots: missing,
      reasonTh: `ไม่สามารถวางชั้นที่ ${lv} (${parsed.door}/${parsed.row}/${lv}/${firstFree}) ได้ — ต้องมีฐานชั้นที่ ${lowerLv} ลูกที่ ${firstFree} และลูกที่ ${firstFree + 1} รองรับก่อน (ยังขาดชั้น ${lowerLv} ลูกที่ ${missing.join(" และ ")})`,
      reasonEn: `Cannot place on Level ${lv} Slot ${firstFree} — requires Level ${lowerLv} base coils #${firstFree} & #${firstFree + 1} (missing L${lowerLv} #${missing.join(", #")})`,
      recommendedLocation: occupancy.recommendedLocation,
    };
  }

  // Explicit slot k on Level 2, 3, or 4 (e.g., E7/1/4/1)
  const k = parsed.explicitSlotIndex;
  const req = [k, k + 1];
  const missing = req.filter((s) => !lowerSet.has(s));
  if (missing.length > 0) {
    return {
      valid: false,
      door: parsed.door,
      row: parsed.row,
      level: lv,
      slotIndex: k,
      requiredBaseSlots: req,
      missingBaseSlots: missing,
      reasonTh: `ไม่สามารถวางชั้นที่ ${lv} ลูกที่ ${k} (${parsed.door}/${parsed.row}/${lv}/${k}) ได้ — ต้องมีฐานชั้นที่ ${lowerLv} ลูกที่ ${k} และลูกที่ ${k + 1} รองรับก่อน (ยังขาดชั้น ${lowerLv} ลูกที่ ${missing.join(" และ ")})`,
      reasonEn: `Cannot place on Level ${lv} Slot ${k} (${parsed.door}/${parsed.row}/${lv}/${k}) — requires Level ${lowerLv} base coils #${k} and #${k + 1} (missing L${lowerLv} #${missing.join(", #")})`,
      recommendedLocation: occupancy.recommendedLocation,
    };
  }

  return {
    valid: true,
    door: parsed.door,
    row: parsed.row,
    level: lv,
    slotIndex: k,
    requiredBaseSlots: req,
    missingBaseSlots: [],
    recommendedLocation: `${parsed.door}/${parsed.row}/${lv}/${k}`,
  };
}

export function getGroupCoilCounts(
  activeCoils: CoilStockRecord[]
): Record<BuildingGroupId, { count: number; weightTons: number }> {
  const result: Record<BuildingGroupId, { count: number; weightTons: number }> = {
    "E7-E8": { count: 0, weightTons: 0 },
    "H9-H10": { count: 0, weightTons: 0 },
    "05": { count: 0, weightTons: 0 },
    "21": { count: 0, weightTons: 0 },
  };

  for (const coil of activeCoils) {
    const parsed = parseCoilLocationTo3D(coil.location);
    result[parsed.groupId].count += 1;
    result[parsed.groupId].weightTons += Number(coil.weightKg || 0) / 1000;
  }
  return result;
}

export function buildBuildingWarehouseLayout(
  groupId: BuildingGroupId,
  activeCoils: CoilStockRecord[],
  sapMap?: Map<string, CoilSapMasterItem>,
  customBaseSlotsPerRow?: number
): BuildingLayoutResult {
  const baseGroup =
    BUILDING_GROUPS.find((g) => g.id === groupId) || BUILDING_GROUPS[0];
  const configuredBaseSlots =
    customBaseSlotsPerRow !== undefined
      ? clampBaseSlotsPerRow(customBaseSlotsPerRow)
      : baseGroup.baseSlotsPerRow;

  // Filter coils belonging to this building group
  const groupCoils: Array<{ coil: CoilStockRecord; parsed: ParsedCoilLocation }> = [];
  let maxRowFound = baseGroup.defaultRowsPerDoor;

  for (const coil of activeCoils) {
    const parsed = parseCoilLocationTo3D(coil.location);
    if (parsed.groupId === baseGroup.id) {
      groupCoils.push({ coil, parsed });
      if (parsed.row > maxRowFound) {
        maxRowFound = parsed.row;
      }
    }
  }

  // Sort coils deterministically by timestamp / batch so layout doesn't jump randomly
  groupCoils.sort((a, b) => {
    const ta = a.coil.scanTimestamp || a.coil.updatedAt || "";
    const tb = b.coil.scanTimestamp || b.coil.updatedAt || "";
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.coil.batch || "").localeCompare(String(b.coil.batch || ""));
  });

  // Group coils by door + row and resolve exact placements (honoring Door/Row/Level/Seq)
  const bucketMap = new Map<string, CoilStockRecord[]>();
  const resolvedBucketMap = new Map<
    string,
    Array<{ coil: CoilStockRecord; level: number; slotIndex: number }>
  >();
  let maxBaseSlotsNeeded = configuredBaseSlots;

  for (const item of groupCoils) {
    const key = `${item.parsed.door}::${item.parsed.row}`;
    const list = bucketMap.get(key) || [];
    list.push(item.coil);
    bucketMap.set(key, list);
  }

  const rowCount = Math.min(Math.max(baseGroup.defaultRowsPerDoor, maxRowFound), 16);
  const doors = baseGroup.doors;
  const isDualDoor = doors.length >= 2;

  bucketMap.forEach((list, key) => {
    const placements = resolveRowCoilPlacements(list, configuredBaseSlots);
    resolvedBucketMap.set(key, placements);
    for (const p of placements) {
      const footprintMax = p.slotIndex + Math.max(0, p.level - 1);
      if (footprintMax > maxBaseSlotsNeeded) {
        maxBaseSlotsNeeded = footprintMax;
      }
    }
  });

  const baseSlots = maxBaseSlotsNeeded;

  // Compute dynamic slab sizing:
  // - X axis: Rows arranged side-by-side along the front road (Door 0 on left, Door 1 on right)
  // - Z axis: Slots S1..S_base inside each row extending perpendicular back from the road
  const doorZoneWidthX = rowCount * ROW_SPACING_X;
  const totalStorageWidthX = isDualDoor
    ? doorZoneWidthX * 2 + DOOR_GAP_X
    : doorZoneWidthX;
  const slabWidth = Math.max(baseGroup.slabWidth, totalStorageWidthX + 9.0);

  const storageDepthZ = baseSlots * SLOT_SPACING_Z;
  const frontAisleDepth = 6.6; // Road lane + safety buffer at front (+Z)
  const backMargin = 3.2;
  const slabDepth = Math.max(baseGroup.slabDepth, storageDepthZ + frontAisleDepth + backMargin);

  const group: BuildingGroupConfig = {
    ...baseGroup,
    slabWidth,
    slabDepth,
    baseSlotsPerRow: baseSlots,
  };

  // Road edge in world Z (matches floor texture laneRatio = min(0.26, 6.0 / D))
  const laneRatio = Math.min(0.26, 6.0 / slabDepth);
  const roadMinZ = slabDepth / 2 - laneRatio * slabDepth;
  const defaultFrontSlotZ = roadMinZ - 1.55;
  // For Bay H9-H10, the road is on the opposite (-Z) side while Doors H9/H10 remain at the front (+Z).
  // Ensure the backmost slot clears the -Z road edge cleanly at any baseSlots setting.
  const backRoadInnerZ = -slabDepth / 2 + laneRatio * slabDepth;
  const minFrontSlotZForBackRoad =
    backRoadInnerZ + 1.55 + Math.max(0, baseSlots - 1) * SLOT_SPACING_Z;
  const frontSlotZ =
    baseGroup.id === "H9-H10"
      ? Math.max(defaultFrontSlotZ, minFrontSlotZForBackRoad)
      : defaultFrontSlotZ;

  const getSlotWorldPosition = (
    doorIdx: number,
    row: number,
    slotIndex: number,
    level: number
  ) => {
    // Row X coordinate: rows arranged side-by-side along the road
    let blockStartX: number;
    if (isDualDoor) {
      if (doorIdx === 0) {
        // Left door block (e.g. E7 or H9)
        blockStartX = -DOOR_GAP_X / 2 - doorZoneWidthX + ROW_SPACING_X / 2;
      } else {
        // Right door block (e.g. E8 or H10)
        blockStartX = DOOR_GAP_X / 2 + ROW_SPACING_X / 2;
      }
    } else {
      blockStartX = -doorZoneWidthX / 2 + ROW_SPACING_X / 2;
    }

    const x = blockStartX + (row - 1) * ROW_SPACING_X;

    // Pyramid Z coordinate: S1 closest to road (+Z), subsequent slots going back (-Z)
    // Level 2 shifts -0.5 slot along Z to nest in groove between S(i) and S(i+1)
    const levelShiftZ = (level - 1) * (SLOT_SPACING_Z / 2);
    const z = frontSlotZ - (slotIndex - 1) * SLOT_SPACING_Z - levelShiftZ;

    const saddleY = SADDLE_HEIGHT / 2;
    const baseCoilCenterY = SADDLE_HEIGHT + COIL_OUTER_RADIUS;
    const y = baseCoilCenterY + (level - 1) * PYRAMID_LEVEL_DY;

    return { x, y, z, saddleY };
  };

  const slots: WarehouseSlot3D[] = [];
  const occupiedSlots: WarehouseSlot3D[] = [];
  const emptyFloorSlots: WarehouseSlot3D[] = [];
  const occupiedFloorKeySet = new Set<string>();
  const usedLevelsSet = new Set<number>([1]);

  let totalWeightKg = 0;
  let occupiedCount = 0;
  let reservedCount = 0;
  let blockedCount = 0;
  let pendingSapCount = 0;

  // 1. Place all active coils (explicit Door/Row/Level/Seq honored directly)
  doors.forEach((door, doorIdx) => {
    for (let row = 1; row <= rowCount; row++) {
      const key = `${door}::${row}`;
      const rowPlacements = resolvedBucketMap.get(key) || [];

      rowPlacements.forEach(({ coil, level, slotIndex }) => {
        usedLevelsSet.add(level);

        const pos = getSlotWorldPosition(doorIdx, row, slotIndex, level);
        const pendingSap = isCoilPendingSap(coil, sapMap);
        const blocked = isCoilBlocked(coil);
        const reserved = coil.status === "staged";

        let status: SlotVisualStatus = "OCCUPIED";
        if (blocked) {
          status = "BLOCKED";
          blockedCount += 1;
        } else if (pendingSap) {
          status = "PENDING_SAP";
          pendingSapCount += 1;
        } else if (reserved) {
          status = "RESERVED";
          reservedCount += 1;
        } else {
          status = "OCCUPIED";
          occupiedCount += 1;
        }

        totalWeightKg += Number(coil.weightKg || 0);

        const slotKey = `${door}-R${row}-L${level}-S${slotIndex}`;
        const slot: WarehouseSlot3D = {
          slotKey,
          groupId: group.id,
          door,
          row,
          slotIndex,
          level,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          saddleY: pos.saddleY,
          status,
          coil,
          isPendingSap: pendingSap,
          isBlocked: blocked,
        };

        slots.push(slot);
        occupiedSlots.push(slot);

        if (level === 1) {
          occupiedFloorKeySet.add(`${door}-R${row}-S${slotIndex}`);
        }
      });
    }
  });

  // 2. Generate all empty Level-1 floor saddle slots
  doors.forEach((door, doorIdx) => {
    for (let row = 1; row <= rowCount; row++) {
      for (let s = 1; s <= baseSlots; s++) {
        const floorKey = `${door}-R${row}-S${s}`;
        if (occupiedFloorKeySet.has(floorKey)) continue;

        const pos = getSlotWorldPosition(doorIdx, row, s, 1);
        const slot: WarehouseSlot3D = {
          slotKey: `${door}-R${row}-L1-S${s}`,
          groupId: group.id,
          door,
          row,
          slotIndex: s,
          level: 1,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          saddleY: pos.saddleY,
          status: "EMPTY",
          isPendingSap: false,
          isBlocked: false,
        };

        slots.push(slot);
        emptyFloorSlots.push(slot);
      }
    }
  });

  const rows = Array.from({ length: rowCount }, (_, i) => i + 1);
  const levels = [1, 2, 3, 4];

  const totalFloorCount = doors.length * rowCount * baseSlots;

  return {
    group,
    slots,
    occupiedSlots,
    emptyFloorSlots,
    doors,
    rows,
    levels,
    stats: {
      totalCoils: occupiedSlots.length,
      totalWeightTons: totalWeightKg / 1000,
      emptyFloorCount: emptyFloorSlots.length,
      totalFloorCount,
      occupiedCount,
      reservedCount,
      blockedCount,
      pendingSapCount,
    },
  };
}
