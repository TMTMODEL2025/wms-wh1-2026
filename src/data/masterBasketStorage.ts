/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type BuildingId = "H" | "F" | "E9" | "E10" | "I";

export interface MasterBasketConfig {
  id: string; // e.g. "H-A01"
  basketNo: string; // e.g. "01"
  buildingId: BuildingId;
  rowId: string; // e.g. "A"
  maxCapacityKg?: number; // default 2500
  maxCoils?: number; // default 3
  notes?: string;
}

export interface MasterRowConfig {
  rowId: string; // e.g. "A", "B", "C", "D"
  rowNameTh: string; // e.g. "แถว A"
  rowNameEn: string; // e.g. "Row A"
  descriptionTh?: string;
  baskets: MasterBasketConfig[];
}

export interface MasterBuildingLayout {
  buildingId: BuildingId;
  buildingNameTh: string;
  buildingNameEn: string;
  subtitleTh: string;
  subtitleEn: string;
  rows: MasterRowConfig[];
}

export const STORAGE_KEY_MASTER_BASKET_LAYOUT = "tmt_wms_master_basket_layout_v1";
export const MASTER_BASKET_LAYOUT_UPDATED_EVENT = "master-basket-layout-updated";

export const BUILDING_DEFINITIONS: Array<{
  id: BuildingId;
  nameTh: string;
  nameEn: string;
  subtitleTh: string;
  subtitleEn: string;
}> = [
  {
    id: "H",
    nameTh: "อาคาร H",
    nameEn: "Building H",
    subtitleTh: "ศูนย์จัดเก็บฟิล์มสลิตหลัก และคลังย่อยแปรรูป (Main Slit Film Hub)",
    subtitleEn: "Primary Slit Film Processing & Storage Hub",
  },
  {
    id: "F",
    nameTh: "อาคาร F",
    nameEn: "Building F",
    subtitleTh: "คลังฟิล์มสลิตเกรดพรีเมียม และงานส่งมอบด่วน (High Grade Warehouse)",
    subtitleEn: "Premium Grade & Fast Dispatch Slit Warehouse",
  },
  {
    id: "E9",
    nameTh: "อาคาร E9",
    nameEn: "Building E9",
    subtitleTh: "คลังจัดเก็บฟิล์มสลิตเกรดอุตสาหกรรมหนัก (Heavy Industrial Slit Storage)",
    subtitleEn: "Heavy Industrial Slit Storage Zone",
  },
  {
    id: "E10",
    nameTh: "อาคาร E10",
    nameEn: "Building E10",
    subtitleTh: "โซนจัดเก็บและเตรียมการส่งออกฟิล์มสลิต (Export & Fast Staging Area)",
    subtitleEn: "Export & Fast Staging Slit Warehouse Zone",
  },
  {
    id: "I",
    nameTh: "อาคาร I",
    nameEn: "Building I",
    subtitleTh: "โซนจัดเก็บฟิล์มสลิตวัตถุดิบรองรับงานแปรรูป (Raw Material Slit Buffer)",
    subtitleEn: "Raw Material Slit Buffer & Processing Storage",
  },
];

const DEFAULT_ROWS = ["A", "B", "C", "D"];
const DEFAULT_BASKETS_PER_ROW = 10;

/**
 * Generate default baskets for a building and row (e.g. H-A01 to H-A10)
 */
export function generateDefaultBasketsForRow(
  buildingId: BuildingId,
  rowId: string,
  count: number = DEFAULT_BASKETS_PER_ROW
): MasterBasketConfig[] {
  const cleanRow = rowId.trim().toUpperCase();
  const baskets: MasterBasketConfig[] = [];
  for (let i = 1; i <= count; i++) {
    const numStr = String(i).padStart(2, "0");
    baskets.push({
      id: `${buildingId}-${cleanRow}${numStr}`,
      basketNo: numStr,
      buildingId,
      rowId: cleanRow,
      maxCapacityKg: 2500,
      maxCoils: 3,
    });
  }
  return baskets;
}

/**
 * Build default layout for all 5 buildings with rows A, B, C, D (10 baskets per row = 40 per building)
 */
export function buildDefaultMasterBasketLayout(): MasterBuildingLayout[] {
  return BUILDING_DEFINITIONS.map((b) => ({
    buildingId: b.id,
    buildingNameTh: b.nameTh,
    buildingNameEn: b.nameEn,
    subtitleTh: b.subtitleTh,
    subtitleEn: b.subtitleEn,
    rows: DEFAULT_ROWS.map((rId) => ({
      rowId: rId,
      rowNameTh: `แถว ${rId}`,
      rowNameEn: `Row ${rId}`,
      descriptionTh: `โซนจัดเก็บแถว ${rId} อาคาร ${b.id}`,
      baskets: generateDefaultBasketsForRow(b.id, rId, DEFAULT_BASKETS_PER_ROW),
    })),
  }));
}

/**
 * Get stored master basket layout from LocalStorage or initialize default
 */
export function getStoredMasterBasketLayout(): MasterBuildingLayout[] {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = localStorage.getItem(STORAGE_KEY_MASTER_BASKET_LAYOUT);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Verify that all 5 buildings exist
          const existingBuildingIds = new Set(parsed.map((b: any) => b.buildingId));
          const defaults = buildDefaultMasterBasketLayout();
          let changed = false;

          const merged: MasterBuildingLayout[] = defaults.map((def) => {
            const found = parsed.find((p: any) => p.buildingId === def.buildingId);
            if (!found) {
              changed = true;
              return def;
            }
            // Ensure rows are non-empty and well-formed
            const rows = (found.rows && found.rows.length > 0 ? found.rows : def.rows).map(
              (r: any) => ({
                rowId: String(r.rowId || "A").toUpperCase(),
                rowNameTh: r.rowNameTh || `แถว ${r.rowId}`,
                rowNameEn: r.rowNameEn || `Row ${r.rowId}`,
                descriptionTh: r.descriptionTh || `โซนจัดเก็บแถว ${r.rowId} อาคาร ${def.buildingId}`,
                baskets: Array.isArray(r.baskets) ? r.baskets : [],
              })
            );
            return {
              ...def,
              ...found,
              rows,
            };
          });

          if (changed) {
            saveStoredMasterBasketLayout(merged);
          }
          return merged;
        }
      }
    }
  } catch (e) {
    console.error("Failed to load master basket layout from localStorage:", e);
  }

  const initial = buildDefaultMasterBasketLayout();
  saveStoredMasterBasketLayout(initial);
  return initial;
}

/**
 * Save master basket layout to LocalStorage and dispatch sync event
 */
export function saveStoredMasterBasketLayout(data: MasterBuildingLayout[]): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const serialized = JSON.stringify(data);
      if (localStorage.getItem(STORAGE_KEY_MASTER_BASKET_LAYOUT) === serialized) {
        return;
      }
      localStorage.setItem(STORAGE_KEY_MASTER_BASKET_LAYOUT, serialized);
      window.dispatchEvent(
        new CustomEvent(MASTER_BASKET_LAYOUT_UPDATED_EVENT, { detail: data })
      );
    }
  } catch (e) {
    console.error("Failed to save master basket layout to localStorage:", e);
  }
}

/**
 * Add a new basket to a specific row (e.g. H-A11)
 */
export function addBasketToRow(buildingId: BuildingId, rowId: string): MasterBasketConfig | null {
  const layout = getStoredMasterBasketLayout();
  const bIndex = layout.findIndex((b) => b.buildingId === buildingId);
  if (bIndex === -1) return null;

  const cleanRow = rowId.trim().toUpperCase();
  const rIndex = layout[bIndex].rows.findIndex((r) => r.rowId === cleanRow);
  if (rIndex === -1) return null;

  const row = layout[bIndex].rows[rIndex];
  // Calculate next basket number
  let maxNo = 0;
  row.baskets.forEach((bk) => {
    const m = bk.id.match(/\d+$/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (!isNaN(n) && n > maxNo) maxNo = n;
    }
  });

  const nextNo = maxNo + 1;
  const numStr = String(nextNo).padStart(2, "0");
  const newBasket: MasterBasketConfig = {
    id: `${buildingId}-${cleanRow}${numStr}`,
    basketNo: numStr,
    buildingId,
    rowId: cleanRow,
    maxCapacityKg: 2500,
    maxCoils: 3,
  };

  layout[bIndex].rows[rIndex].baskets.push(newBasket);
  saveStoredMasterBasketLayout(layout);
  return newBasket;
}

/**
 * Add a new row with initial baskets to a building
 */
export function addNewRowToBuilding(
  buildingId: BuildingId,
  rowId: string,
  basketCount: number = DEFAULT_BASKETS_PER_ROW
): boolean {
  const layout = getStoredMasterBasketLayout();
  const bIndex = layout.findIndex((b) => b.buildingId === buildingId);
  if (bIndex === -1) return false;

  const cleanRow = rowId.trim().toUpperCase();
  const exists = layout[bIndex].rows.some((r) => r.rowId === cleanRow);
  if (exists) return false;

  const newRow: MasterRowConfig = {
    rowId: cleanRow,
    rowNameTh: `แถว ${cleanRow}`,
    rowNameEn: `Row ${cleanRow}`,
    descriptionTh: `โซนจัดเก็บแถว ${cleanRow} อาคาร ${buildingId}`,
    baskets: generateDefaultBasketsForRow(buildingId, cleanRow, Math.max(1, basketCount)),
  };

  layout[bIndex].rows.push(newRow);
  // Sort rows alphabetically by rowId
  layout[bIndex].rows.sort((a, b) => a.rowId.localeCompare(b.rowId));
  saveStoredMasterBasketLayout(layout);
  return true;
}

/**
 * Delete a basket from a row in master layout
 */
export function removeBasketFromRow(
  buildingId: BuildingId,
  rowId: string,
  basketId: string
): boolean {
  const layout = getStoredMasterBasketLayout();
  const bIndex = layout.findIndex((b) => b.buildingId === buildingId);
  if (bIndex === -1) return false;

  const cleanRow = rowId.trim().toUpperCase();
  const rIndex = layout[bIndex].rows.findIndex((r) => r.rowId === cleanRow);
  if (rIndex === -1) return false;

  const originalLen = layout[bIndex].rows[rIndex].baskets.length;
  layout[bIndex].rows[rIndex].baskets = layout[bIndex].rows[rIndex].baskets.filter(
    (b) => b.id.toUpperCase() !== basketId.trim().toUpperCase()
  );

  if (layout[bIndex].rows[rIndex].baskets.length !== originalLen) {
    saveStoredMasterBasketLayout(layout);
    return true;
  }
  return false;
}

/**
 * Automatically ensures a basket location is registered in Master Layout.
 * If not present, inserts it into the corresponding building and row automatically.
 */
export function ensureBasketInMasterLayout(
  buildingId: BuildingId,
  rowId: string,
  basketId: string
): boolean {
  if (!buildingId || !rowId || !basketId) return false;
  const layout = getStoredMasterBasketLayout();
  const bIndex = layout.findIndex((b) => b.buildingId === buildingId);
  if (bIndex === -1) return false;

  const cleanRow = rowId.trim().toUpperCase();
  const cleanBasketId = basketId.trim().toUpperCase();
  let rIndex = layout[bIndex].rows.findIndex((r) => r.rowId === cleanRow);

  let updated = false;

  if (rIndex === -1) {
    // Row doesn't exist yet, create row
    const numMatch = cleanBasketId.match(/\d+$/);
    const bNo = numMatch ? numMatch[0].padStart(2, "0") : "01";
    const newRow: MasterRowConfig = {
      rowId: cleanRow,
      rowNameTh: `แถว ${cleanRow}`,
      rowNameEn: `Row ${cleanRow}`,
      descriptionTh: `โซนจัดเก็บแถว ${cleanRow} อาคาร ${buildingId}`,
      baskets: [
        {
          id: cleanBasketId,
          basketNo: bNo,
          buildingId,
          rowId: cleanRow,
          maxCapacityKg: 2500,
          maxCoils: 3,
        },
      ],
    };
    layout[bIndex].rows.push(newRow);
    layout[bIndex].rows.sort((a, b) => a.rowId.localeCompare(b.rowId));
    updated = true;
  } else {
    const row = layout[bIndex].rows[rIndex];
    const basketExists = row.baskets.some((bk) => bk.id.toUpperCase() === cleanBasketId);
    if (!basketExists) {
      const numMatch = cleanBasketId.match(/\d+$/);
      const bNo = numMatch ? numMatch[0].padStart(2, "0") : "01";
      row.baskets.push({
        id: cleanBasketId,
        basketNo: bNo,
        buildingId,
        rowId: cleanRow,
        maxCapacityKg: 2500,
        maxCoils: 3,
      });
      // Sort baskets by basket id or number
      row.baskets.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      updated = true;
    }
  }

  if (updated) {
    saveStoredMasterBasketLayout(layout);
    return true;
  }
  return false;
}

/**
 * Reset master basket layout back to standard default (40 baskets per building)
 */
export function resetMasterBasketLayoutToDefault(): MasterBuildingLayout[] {
  const defaults = buildDefaultMasterBasketLayout();
  saveStoredMasterBasketLayout(defaults);
  return defaults;
}
