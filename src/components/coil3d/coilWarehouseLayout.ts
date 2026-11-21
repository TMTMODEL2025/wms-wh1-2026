import { CoilStockRecord, CoilSapMasterItem } from "../../services/coilDataService";

export type BuildingGroupId = "E7-E8" | "H7-H8" | "05" | "21";

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

export const BUILDING_GROUPS: BuildingGroupConfig[] = [
  {
    id: "E7-E8",
    labelTh: "กลุ่มอาคาร E7 - E8",
    labelEn: "Bay E7 - E8",
    subtitleTh: "คลังเหล็กม้วนหลัก (2 ประตู)",
    subtitleEn: "Main Coil Bay (2 Doors)",
    doors: ["E7", "E8"],
    defaultRowsPerDoor: 8,
    baseSlotsPerRow: 8,
    slabWidth: 42,
    slabDepth: 24,
  },
  {
    id: "H7-H8",
    labelTh: "กลุ่มอาคาร H7 - H8",
    labelEn: "Bay H7 - H8",
    subtitleTh: "คลังเหล็กม้วนสาย H (2 ประตู)",
    subtitleEn: "H-Line Coil Bay (2 Doors)",
    doors: ["H7", "H8"],
    defaultRowsPerDoor: 8,
    baseSlotsPerRow: 8,
    slabWidth: 42,
    slabDepth: 24,
  },
  {
    id: "05",
    labelTh: "อาคาร 05",
    labelEn: "Building 05",
    subtitleTh: "คลังจัดเก็บอาคาร 05",
    subtitleEn: "Storage Building 05",
    doors: ["05"],
    defaultRowsPerDoor: 10,
    baseSlotsPerRow: 8,
    slabWidth: 32,
    slabDepth: 24,
  },
  {
    id: "21",
    labelTh: "อาคาร 21",
    labelEn: "Building 21",
    subtitleTh: "คลังจัดเก็บอาคาร 21",
    subtitleEn: "Storage Building 21",
    doors: ["21"],
    defaultRowsPerDoor: 10,
    baseSlotsPerRow: 8,
    slabWidth: 32,
    slabDepth: 24,
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
  H7: "H7-H8",
  H8: "H7-H8",
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
    door = first === "5" ? "05" : first;
  } else if (/^E7/.test(cleaned)) {
    groupId = "E7-E8";
    door = "E7";
  } else if (/^E8/.test(cleaned)) {
    groupId = "E7-E8";
    door = "E8";
  } else if (/^H7/.test(cleaned)) {
    groupId = "H7-H8";
    door = "H7";
  } else if (/^H8/.test(cleaned)) {
    groupId = "H7-H8";
    door = "H8";
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

  // Optional explicit level (parts[2], e.g. 1, 2, 3)
  let explicitLevel: number | undefined;
  if (third) {
    const lvMatch = third.match(/\d+/);
    if (lvMatch) {
      const lv = parseInt(lvMatch[0], 10);
      if (Number.isFinite(lv) && lv >= 1 && lv <= 3) {
        explicitLevel = lv;
      }
    }
  }

  // Optional explicit sequence slot (parts[3], e.g. 1..20)
  let explicitSlotIndex: number | undefined;
  if (fourth) {
    const slotMatch = fourth.match(/\d+/);
    if (slotMatch) {
      const slot = parseInt(slotMatch[0], 10);
      if (Number.isFinite(slot) && slot >= 1 && slot <= 30) {
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
 * with Level 2 nesting into the grooves between adjacent Level 1 coils.
 */
function computePyramidPositionInRow(
  orderIndex: number,
  baseSlotsPerRow: number
): { level: number; slotIndex: number } {
  const B = Math.max(2, baseSlotsPerRow);

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

  // Overflow into Level 3 (1..(B-2))
  const l3Index = orderIndex - twoLevelCap;
  const maxL3 = Math.max(1, B - 2);
  if (l3Index < maxL3) {
    return { level: 3, slotIndex: 1 + l3Index };
  }

  // Extreme overflow beyond L3: extend along Level 1 beyond B
  const extraIdx = l3Index - maxL3;
  return { level: 1, slotIndex: B + 1 + extraIdx };
}

/**
 * Resolves exact (level, slotIndex) assignments for all coils in a single (door, row) bucket.
 * Coils with explicit Door/Row/Level/Seq coordinates take their exact slot first;
 * legacy coils without explicit level/seq fill remaining pyramid slots without collision.
 */
function resolveRowCoilPlacements(
  rowCoils: CoilStockRecord[],
  baseSlotsPerRow: number
): Array<{ coil: CoilStockRecord; level: number; slotIndex: number }> {
  const occupiedKeys = new Set<string>();
  const resolved: Array<{ coil: CoilStockRecord; level: number; slotIndex: number }> = [];
  const implicitCoils: CoilStockRecord[] = [];

  const getMaxSlotsForLevel = (lv: number) =>
    lv === 1 ? baseSlotsPerRow : lv === 2 ? Math.max(1, baseSlotsPerRow - 1) : Math.max(1, baseSlotsPerRow - 2);

  // Pass 1: Honor coils with explicit level & slotIndex (e.g., E7/1/2/3)
  for (const coil of rowCoils) {
    const parsed = parseCoilLocationTo3D(coil.location);
    if (parsed.explicitLevel && parsed.explicitSlotIndex) {
      let lv = parsed.explicitLevel;
      let slot = parsed.explicitSlotIndex;
      while (occupiedKeys.has(`${lv}:${slot}`)) {
        slot += 1;
      }
      occupiedKeys.add(`${lv}:${slot}`);
      resolved.push({ coil, level: lv, slotIndex: slot });
    } else if (parsed.explicitLevel) {
      // Explicit level only (e.g. E7/1/2): assign next available slot on that level
      const lv = parsed.explicitLevel;
      let slot = 1;
      while (occupiedKeys.has(`${lv}:${slot}`)) {
        slot += 1;
      }
      occupiedKeys.add(`${lv}:${slot}`);
      resolved.push({ coil, level: lv, slotIndex: slot });
    } else {
      implicitCoils.push(coil);
    }
  }

  // Pass 2: Place legacy coils (e.g. E7/1) in next free pyramid slots
  let searchIdx = 0;
  for (const coil of implicitCoils) {
    let chosen = computePyramidPositionInRow(searchIdx, baseSlotsPerRow);
    while (occupiedKeys.has(`${chosen.level}:${chosen.slotIndex}`)) {
      searchIdx += 1;
      chosen = computePyramidPositionInRow(searchIdx, baseSlotsPerRow);
      if (searchIdx > baseSlotsPerRow * 4) {
        const cap = getMaxSlotsForLevel(1);
        chosen = { level: 1, slotIndex: cap + searchIdx };
        break;
      }
    }
    occupiedKeys.add(`${chosen.level}:${chosen.slotIndex}`);
    resolved.push({ coil, level: chosen.level, slotIndex: chosen.slotIndex });
    searchIdx += 1;
  }

  return resolved;
}

export interface RowLevelRecommendation {
  door: string;
  row: number;
  baseCapacity: number;
  level1: {
    capacity: number;
    occupiedSlots: number[];
    occupiedCount: number;
    availableCount: number;
    isFull: boolean;
    nextSeq: number;
  };
  level2: {
    capacity: number;
    occupiedSlots: number[];
    supportedSlots: number[]; // Slots where both L1(k) and L1(k+1) are present
    availableSupportedSlots: number[];
    occupiedCount: number;
    availableCount: number;
    isFull: boolean;
    hasBaseSupport: boolean;
    nextSeq: number;
  };
  recommendedLevel: 1 | 2;
  recommendedSeq: number;
  recommendedLocation: string;
  reasonTh: string;
  reasonEn: string;
  isRowCompletelyFull: boolean;
}

/**
 * Inspects live stock inside (door, row) and recommends the optimal Level (1 or 2)
 * and next sequence slot (e.g. E7/1/2/3 = Door E7, Row 1, Level 2, Seq 3).
 */
export function getRowLevelOccupancy(
  doorInput: string,
  rowInput: number | string,
  activeCoils: CoilStockRecord[]
): RowLevelRecommendation {
  const door = String(doorInput || "E7").trim().toUpperCase();
  const parsedRowNum = parseInt(String(rowInput || "1").replace(/\D/g, ""), 10);
  const row = Number.isFinite(parsedRowNum) && parsedRowNum >= 1 ? parsedRowNum : 1;

  const groupId = KNOWN_BUILDING_TO_GROUP[door] || "E7-E8";
  const groupCfg =
    BUILDING_GROUPS.find((g) => g.id === groupId) || BUILDING_GROUPS[0];
  const baseCapacity = groupCfg.baseSlotsPerRow; // 8 floor slots
  const level2Capacity = Math.max(1, baseCapacity - 1); // 7 pyramid groove slots

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

  const l1Set = new Set<number>();
  const l2Set = new Set<number>();
  placements.forEach((p) => {
    if (p.level === 1) l1Set.add(p.slotIndex);
    if (p.level === 2) l2Set.add(p.slotIndex);
  });

  const l1Occupied = Array.from(l1Set).sort((a, b) => a - b);
  const l2Occupied = Array.from(l2Set).sort((a, b) => a - b);

  // Next free slot on Level 1 (sequential after existing coils or first gap)
  let nextL1 = 1;
  while (l1Set.has(nextL1)) nextL1 += 1;
  const l1CountInCap = l1Occupied.filter((s) => s >= 1 && s <= baseCapacity).length;
  const l1IsFull = l1CountInCap >= baseCapacity;
  const l1Available = Math.max(0, baseCapacity - l1CountInCap);

  // Level 2 supported pyramid slots: slot k needs L1(k) AND L1(k+1)
  const supportedSlots: number[] = [];
  const availableSupportedSlots: number[] = [];
  for (let k = 1; k <= level2Capacity; k++) {
    if (l1Set.has(k) && l1Set.has(k + 1)) {
      supportedSlots.push(k);
      if (!l2Set.has(k)) {
        availableSupportedSlots.push(k);
      }
    }
  }

  let nextL2 = availableSupportedSlots.length > 0 ? availableSupportedSlots[0] : 1;
  if (availableSupportedSlots.length === 0) {
    while (l2Set.has(nextL2)) nextL2 += 1;
  }

  const l2CountInCap = l2Occupied.filter((s) => s >= 1 && s <= level2Capacity).length;
  const l2IsFull = l2CountInCap >= level2Capacity;
  const l2Available = Math.max(0, level2Capacity - l2CountInCap);
  const hasBaseSupport = supportedSlots.length > 0;
  const isRowCompletelyFull = l1IsFull && l2IsFull;

  // Smart recommendation rules:
  // 1. If Level 1 is NOT full -> recommend Level 1 (base floor first for safety & stability),
  //    while still letting operator choose Level 2 anytime base support exists.
  // 2. If Level 1 IS full and Level 2 has free slots -> auto-recommend Level 2!
  // 3. If both full -> recommend Level 2 overflow warning / suggest another row.
  let recommendedLevel: 1 | 2 = 1;
  let recommendedSeq = nextL1;
  let reasonTh = "";
  let reasonEn = "";

  if (!l1IsFull) {
    recommendedLevel = 1;
    recommendedSeq = nextL1;
    if (l1CountInCap === 0) {
      reasonTh = `แถว ${row} ว่างทั้งหมด — แนะนำวางชั้น 1 ลำดับที่ ${nextL1}`;
      reasonEn = `Row ${row} is empty — recommended Level 1, Slot ${nextL1}`;
    } else if (availableSupportedSlots.length > 0) {
      reasonTh = `ชั้น 1 ว่างอีก ${l1Available} ช่อง (แนะนำลำดับ ${nextL1}) · ชั้น 2 วางซ้อนได้ ${availableSupportedSlots.length} ช่อง`;
      reasonEn = `Level 1 has ${l1Available} slots free (Next #${nextL1}) · Level 2 ready (${availableSupportedSlots.length} slots)`;
    } else {
      reasonTh = `ชั้น 1 มี ${l1CountInCap}/${baseCapacity} ม้วน — แนะนำวางต่อชั้น 1 ลำดับที่ ${nextL1}`;
      reasonEn = `Level 1 has ${l1CountInCap}/${baseCapacity} coils — recommended Level 1, Slot ${nextL1}`;
    }
  } else if (!l2IsFull) {
    recommendedLevel = 2;
    recommendedSeq = nextL2;
    reasonTh = `ชั้น 1 เต็มแล้ว (${baseCapacity}/${baseCapacity}) — แนะนำอัตโนมัติวางชั้น 2 ลำดับที่ ${nextL2}`;
    reasonEn = `Level 1 full (${baseCapacity}/${baseCapacity}) — auto-recommended Level 2, Slot ${nextL2}`;
  } else {
    recommendedLevel = 2;
    recommendedSeq = nextL2;
    reasonTh = `แถว ${row} เต็มทั้งชั้น 1 และชั้น 2 (${baseCapacity + level2Capacity}/${baseCapacity + level2Capacity}) — แนะนำเลือกแถวอื่นที่ว่าง`;
    reasonEn = `Row ${row} is completely full — consider selecting another row`;
  }

  return {
    door,
    row,
    baseCapacity,
    level1: {
      capacity: baseCapacity,
      occupiedSlots: l1Occupied,
      occupiedCount: l1Occupied.length,
      availableCount: l1Available,
      isFull: l1IsFull,
      nextSeq: nextL1,
    },
    level2: {
      capacity: level2Capacity,
      occupiedSlots: l2Occupied,
      supportedSlots,
      availableSupportedSlots,
      occupiedCount: l2Occupied.length,
      availableCount: l2Available,
      isFull: l2IsFull,
      hasBaseSupport,
      nextSeq: nextL2,
    },
    recommendedLevel,
    recommendedSeq,
    recommendedLocation: `${door}/${row}/${recommendedLevel}/${recommendedSeq}`,
    reasonTh,
    reasonEn,
    isRowCompletelyFull,
  };
}

export function getGroupCoilCounts(
  activeCoils: CoilStockRecord[]
): Record<BuildingGroupId, { count: number; weightTons: number }> {
  const result: Record<BuildingGroupId, { count: number; weightTons: number }> = {
    "E7-E8": { count: 0, weightTons: 0 },
    "H7-H8": { count: 0, weightTons: 0 },
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
  sapMap?: Map<string, CoilSapMasterItem>
): BuildingLayoutResult {
  const baseGroup =
    BUILDING_GROUPS.find((g) => g.id === groupId) || BUILDING_GROUPS[0];

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
  let maxBaseSlotsNeeded = baseGroup.baseSlotsPerRow;

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
    const placements = resolveRowCoilPlacements(list, baseGroup.baseSlotsPerRow);
    resolvedBucketMap.set(key, placements);
    for (const p of placements) {
      if (p.level === 1 && p.slotIndex > maxBaseSlotsNeeded) {
        maxBaseSlotsNeeded = p.slotIndex;
      } else if (p.level === 2 && p.slotIndex + 1 > maxBaseSlotsNeeded) {
        maxBaseSlotsNeeded = p.slotIndex + 1;
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

  // Road top edge in world Z (matches floor texture laneRatio = min(0.26, 6.0 / D))
  const laneRatio = Math.min(0.26, 6.0 / slabDepth);
  const roadMinZ = slabDepth / 2 - laneRatio * slabDepth;
  // S1 sits facing the road just behind the white road line; S2..SB go back toward -Z
  const frontSlotZ = roadMinZ - 1.55;

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
        // Left door block (e.g. E7 or H7)
        blockStartX = -DOOR_GAP_X / 2 - doorZoneWidthX + ROW_SPACING_X / 2;
      } else {
        // Right door block (e.g. E8 or H8)
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
  const levels = Array.from(usedLevelsSet).sort((a, b) => a - b);
  if (!levels.includes(2)) levels.push(2);
  levels.sort((a, b) => a - b);

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
