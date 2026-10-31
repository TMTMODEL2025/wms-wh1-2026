/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Swal from "sweetalert2";
import {
  Layers,
  ArrowDownRight,
  ArrowUpRight,
  Search,
  RotateCcw,

  Trash2,
  Eye,
  CheckCircle2,
  AlertTriangle,
  X,
  FileText,
  Volume2,
  VolumeX,
  Package,
  ShieldCheck,
  Disc,
  Info,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Table as TableIcon,
  Barcode,
  Cpu,
  Check,
  Sparkles,
  Factory,
  Plus,
  Upload,
  Clock,
  ClipboardList,
  CheckSquare,
  Save,
  FileSpreadsheet,
  Database,
  Scale,
  MapPin,
  RefreshCw,
  Loader2,
  Camera,
} from "lucide-react";
import { CameraBarcodeScanner } from "./CameraBarcodeScanner";
import { cleanBarcode } from "../utils/barcodeUtils";
import { SpaceManagementView } from "./SpaceManagementView";
import * as XLSX from "xlsx";
import { useLanguage } from "../contexts/LanguageContext";
import {
  getRacksForMachine,
  addCoilToMachineRack,
  calculateAccumulatedWidthMm,
  MachineRack,
  MACHINE_STAGING_UPDATED_EVENT,
  removeCoilByBatch,
  getAllStagedCoilsWithMachineInfo,
  resetAllMachineStagingToEmpty,
} from "../data/machineStagingStorage";
import { DailyReportView } from "./DailyReportView";
import { EquipmentInspectionView } from "./EquipmentInspectionView";
import { TransferCarReport } from "./TransferCarReport";

export interface SapMasterItem {
  salesDoc: string;
  materialNo: string;
  certThickness: string;
  storageLocation: string;
  batch: string; // Primary Key
  targetThickness: string;
  width: string;
  weightKg: number;
  unrestricted: string;
  qualityClass: string;
  grade: string;
  manufacturer: string;
  description: string;
  coilNo: string;
  conditionText: string;
}

export interface SlitBarcodeRecord {
  id: string;
  mode: "inbound" | "outbound";
  scanTimestamp: string;
  batch: string; // 10-character scanned barcode (e.g. '26SL00189A')
  machine: string; // 8. รับจากเครื่อง (e.g. SM01, SM02, SM03, SM04)
  location: string; // 9. Location (e.g. H2/A1)
  previousLocation?: string; // Location เดิมก่อนย้าย (Previous Location)
  orderNo?: string; // เลขที่ใบสั่งเบิก (Order No.)
  hasSapData?: boolean; // True if mapped with SAP Master Data
  certThickness?: string; // 3. หนา Certificated.(mm)
  width?: string; // 4. กว้าง(mm)
  weightKg?: number; // 5. Unrestricted(น้ำหนักkg)
  unrestricted?: string; // Formatted weight text
  grade?: string; // 6. Grade (e.g. SS400, SPCC)
  manufacturer?: string; // 7. ผู้ผลิต (e.g. SSI, GJ, GS)
  storageLocation?: string;
  salesDoc?: string;
  materialNo?: string;
  targetThickness?: string;
  qualityClass?: string;
  description?: string;
  coilNo?: string;
  conditionText?: string;
}

export interface PickListItem {
  id: string;
  bomItem: string;
  material: string;
  description: string;
  reqQty: number;
  unit: string;
  itemCategory?: string;
  operation?: string;
  sequence?: string;
  plant?: string;
  storageLocation?: string;
  batch: string;
  status: "pending" | "verified";
  scannedAt?: string;
  machineIssued?: boolean;
  machineIssuedAt?: string;
}

export interface PickListOrder {
  orderNo: string;
  machineId: string;
  machineType: "pipe" | "c_channel" | "mini" | "lip_channel";
  createdAt: string;
  createdDate: string;
  status: "pending" | "in_progress" | "completed";
  items: PickListItem[];
  operatorDismissed?: boolean;
}

export interface MachineDef {
  id: string;
  name: string;
  type: "pipe" | "c_channel" | "mini" | "lip_channel";
  categoryTh: string;
  categoryEn: string;
}

export interface RelocateBatchItem {
  id: string;
  batch: string;
  materialName: string;
  grade: string;
  thicknessWidth: string;
  weightKg: number;
  sourceLayout: string;
  status: string;
  scannedTimestamp: string;
}

export interface ReturnItemRow {
  id: string;
  batch: string;
  machineId: string;
  machineCode: string;
  orderNo: string;
  rackNameTh: string;
  rackId?: string;
  weightKg: number;
  grade: string;
  spec: string;
  dispatchedAt: string;
  defaultLocation: string;
  returnLocation: string;
  description?: string;
  hasSapData?: boolean;
}

interface SlitFilmManagementProps {
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
  activeMode?: "inbound" | "outbound" | "operator_receive" | "movement_history" | "relocate_layout" | "stock_balance" | "space_management" | "return_warehouse" | "daily_report" | "equipment_inspection" | "transfer_car_report";
  onModeChange?: (mode: "inbound" | "outbound" | "operator_receive" | "movement_history" | "relocate_layout" | "stock_balance" | "space_management" | "return_warehouse" | "daily_report" | "equipment_inspection" | "transfer_car_report") => void;
}

const STORAGE_KEY_INBOUND = "tmt_wms_slit_inbound_records";
const STORAGE_KEY_OUTBOUND = "tmt_wms_slit_outbound_records";
const STORAGE_KEY_PICK_LISTS = "tmt_wms_slit_pick_lists";
const STORAGE_KEY_SAP_MASTER = "tmt_wms_slit_sap_master_records";
const STORAGE_KEY_DELETED_RETURN_BATCHES = "tmt_wms_slit_deleted_return_batches";
const STORAGE_KEY_INBOUND_MACHINES = "tmt_wms_slit_inbound_machines";
const STORAGE_KEY_OUTBOUND_MACHINES = "tmt_wms_slit_outbound_machines";

const AVAILABLE_LOCATIONS: string[] = [];

const AVAILABLE_MACHINES = ["SM01", "SM02", "SM03", "SM04"];

// 22 Machines across 4 Categories for Outbound Scan
export const OUTBOUND_MACHINES: MachineDef[] = [
  // Pipe Mills (ท่อ 14 เครื่อง: TM01-TM14)
  ...Array.from({ length: 14 }, (_, i) => {
    const id = `TM${String(i + 1).padStart(2, "0")}`;
    return { id, name: id, type: "pipe" as const, categoryTh: "ผลิตท่อ", categoryEn: "Pipe Mill" };
  }),
  // C-Channel (ตัวซี 4 เครื่อง: CF01, CF02, CF04, CF05)
  { id: "CF01", name: "CF01", type: "c_channel", categoryTh: "ตัวซี", categoryEn: "C-Channel" },
  { id: "CF02", name: "CF02", type: "c_channel", categoryTh: "ตัวซี", categoryEn: "C-Channel" },
  { id: "CF04", name: "CF04", type: "c_channel", categoryTh: "ตัวซี", categoryEn: "C-Channel" },
  { id: "CF05", name: "CF05", type: "c_channel", categoryTh: "ตัวซี", categoryEn: "C-Channel" },
  // Mini Lines (มินิ 2 เครื่อง: ML01, ML02)
  { id: "ML01", name: "ML01", type: "mini", categoryTh: "มินิ", categoryEn: "Mini Line" },
  { id: "ML02", name: "ML02", type: "mini", categoryTh: "มินิ", categoryEn: "Mini Line" },
  // Lip Channel (ตัวซีมีขอบ 2 เครื่อง: ZF01, ZF02)
  { id: "ZF01", name: "ZF01", type: "lip_channel", categoryTh: "ตัวซีมีขอบ", categoryEn: "Lip Channel" },
  { id: "ZF02", name: "ZF02", type: "lip_channel", categoryTh: "ตัวซีมีขอบ", categoryEn: "Lip Channel" },
];

export const MACHINE_CATEGORIES = [
  { key: "pipe" as const, labelTh: "TM", labelEn: "TM (14)", count: 14 },
  { key: "c_channel" as const, labelTh: "CF", labelEn: "CF (4)", count: 4 },
  { key: "mini" as const, labelTh: "มินิ", labelEn: "Mini (2)", count: 2 },
  { key: "lip_channel" as const, labelTh: "ตัวซีมีขอบ", labelEn: "Lip Channel (2)", count: 2 },
];

export const USER_EXACT_SAP_SAMPLE_TEXT = "";

// Default sample Pick List Orders for testing Outbound flow
const INITIAL_PICK_LISTS: PickListOrder[] = [];

// Helper to parse TSV/Table text pasted from Excel or SAP
function parseRawTableText(text: string): Omit<PickListItem, "id" | "status">[] {
  if (!text || !text.trim()) return [];
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const items: Omit<PickListItem, "id" | "status">[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    // Skip header lines
    if (
      lower.includes("sales document") ||
      lower.includes("material description") ||
      lower.includes("requirement quantity") ||
      lower.includes("หนา certificated") ||
      (lower.includes("storage location") && lower.includes("batch")) ||
      lower.startsWith("bom item")
    ) {
      continue;
    }

    // Split by tab FIRST (do NOT trim line before split to preserve empty columns)
    let cols = line.split("\t").map((c) => c.trim());
    if (cols.length < 3) {
      cols = line.trim().split(/\s{2,}/).map((c) => c.trim());
    }

    if (cols.length < 2) continue;

    // Locate 10-character Batch code (e.g. BP00168280, CH00227080, 26SL00189A)
    let B = -1;
    for (let i = 0; i < cols.length; i++) {
      if (/^[A-Za-z0-9]{10}$/.test(cols[i]) && !/^\d{10}$/.test(cols[i])) {
        B = i;
        break;
      }
    }
    if (B === -1) {
      for (let i = 0; i < cols.length; i++) {
        if (/^[A-Za-z0-9]{10}$/.test(cols[i])) {
          B = i;
          break;
        }
      }
    }

    let batch = "";
    let material = "";
    let description = "";
    let reqQty = 0;
    let unit = "KG";
    let storageLocation = "";
    let bomItem = "0010";
    let itemCategory = "L";
    let operation = "0010";
    let sequence = "0";
    let plant = "1200";

    if (B !== -1) {
      batch = cols[B].toUpperCase();

      // Check if SAP Export format (e.g. Batch is at index ~4)
      if (cols.length >= 8 && B >= 3 && B <= 5) {
        material = cols[B - 3] || cols[B - 1] || "";
        storageLocation = cols[B - 1] || "";

        // Find description column (contains Thai description or long text or cols[B+7])
        const descCol = cols.find((c, idx) => idx > B && (c.includes("วัตถุดิบ") || c.includes("ท่อ") || c.includes("Coil") || c.includes("Film") || c.length > 15));
        description = descCol || cols[B + 7] || "";

        // Find weight / reqQty (numeric value > 0 around B+3 or B+2 or in cols)
        let weight = 0;
        if (cols[B + 3]) {
          const parsedW = parseFloat(cols[B + 3].replace(/,/g, ""));
          if (!isNaN(parsedW) && parsedW > 0) weight = parsedW;
        }
        if (weight === 0 && cols[B + 2]) {
          const parsedW = parseFloat(cols[B + 2].replace(/,/g, ""));
          if (!isNaN(parsedW) && parsedW > 0) weight = parsedW;
        }
        if (weight === 0) {
          for (let i = B + 1; i < cols.length; i++) {
            const num = parseFloat(cols[i].replace(/,/g, ""));
            if (!isNaN(num) && num > 50) {
              weight = num;
              break;
            }
          }
        }
        reqQty = weight > 0 ? weight : 0;
        unit = "KG";
      } else if (cols.length >= 11 && B === 10) {
        // Standard BOM 11-column format
        bomItem = cols[0] || "0010";
        material = cols[1] || "";
        description = cols[2] || "";
        reqQty = parseFloat(cols[3]?.replace(/,/g, "") || "0") || 0;
        unit = cols[4] || "KG";
        itemCategory = cols[5] || "L";
        operation = cols[6] || "0010";
        sequence = cols[7] || "0";
        plant = cols[8] || "1200";
        storageLocation = cols[9] || "";
      } else {
        // Generic multi-column layout with batch at B
        material = cols[0] !== batch ? cols[0] : (cols[1] || "");
        description = cols.find((c) => c !== batch && c.length > 10) || "";
        storageLocation = cols.find((c) => /^[0-9][A-Z0-9]{2,4}$/.test(c) || c.startsWith("2E") || c.includes("-")) || "";

        for (let i = 0; i < cols.length; i++) {
          if (i !== B) {
            const num = parseFloat(cols[i].replace(/,/g, ""));
            if (!isNaN(num) && num > 0) {
              reqQty = num;
              break;
            }
          }
        }
      }
    } else {
      // Row has no 10-character batch (e.g. BOM header/summary line), skip it
      continue;
    }

    if (/^[A-Za-z0-9]{10}$/.test(batch)) {
      items.push({
        bomItem,
        material,
        description,
        reqQty: isNaN(reqQty) ? 0 : reqQty,
        unit: unit || "KG",
        itemCategory,
        operation,
        sequence,
        plant,
        storageLocation,
        batch: batch.toUpperCase(),
      });
    }
  }

  return items;
}

// Helper to decode binary file buffer supporting UTF-8 and Windows-874 / TIS-620 (Thai SAP / Excel CSV exports)
export function decodeFileBuffer(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);

  // 1. Try UTF-8 decoding
  const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
  const utf8Text = utf8Decoder.decode(uint8);

  // Count replacement characters (\uFFFD) indicating invalid UTF-8 sequences
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;

  // Check if buffer contains typical Windows-874 / TIS-620 Thai bytes (0xA1 - 0xFB)
  let thaiByteCount = 0;
  for (let i = 0; i < Math.min(uint8.length, 5000); i++) {
    if (uint8[i] >= 0xA1 && uint8[i] <= 0xFB) {
      thaiByteCount++;
    }
  }

  const hasUtf8Thai = /[\u0E00-\u0E7F]/.test(utf8Text);

  // If UTF-8 produced replacement characters () OR buffer contains raw Thai bytes but UTF-8 has no Thai characters:
  if (replacementCount > 0 || (thaiByteCount > 5 && !hasUtf8Thai)) {
    try {
      const thaiDecoder = new TextDecoder("windows-874");
      const thaiText = thaiDecoder.decode(uint8);
      if (/[\u0E00-\u0E7F]/.test(thaiText)) {
        return thaiText;
      }
    } catch {
      try {
        const tisDecoder = new TextDecoder("tis-620");
        const tisText = tisDecoder.decode(uint8);
        if (/[\u0E00-\u0E7F]/.test(tisText)) {
          return tisText;
        }
      } catch {}
    }
  }

  return utf8Text;
}

// Helper to parse and sanitize weight in kg, preventing scientific notation artifacts (e.g. SLoc 2E09 being read as 2,000,000,000 kg)
export function sanitizeWeightKg(val: any, rawStr?: string): number {
  if (val === null || val === undefined) return 0;
  const str = String(rawStr !== undefined ? rawStr : val).trim();
  if (
    !str ||
    str === "-" ||
    str === "0" ||
    str === "0.00" ||
    str.includes("2E09") ||
    str.includes("2e09") ||
    str.includes("2.00E+09") ||
    str.includes("2.00e+09") ||
    str === "2000000000" ||
    str === "2,000,000,000" ||
    /2e09/i.test(str)
  ) {
    return 0;
  }
  const cleanStr = str.replace(/,/g, "").replace(/kg/gi, "").trim();
  const num = typeof val === "number" && !isNaN(val) ? val : parseFloat(cleanStr);
  if (isNaN(num) || num <= 0 || num >= 1000000) {
    // Over 1,000,000 kg is impossible for a steel slit coil (indicates an artifact like 2E09 = 2 billion)
    return 0;
  }
  return num;
}

// Helper to format thickness and width with exactly 2 decimal places (.toFixed(2))
export function formatDimension2Decimals(
  val: string | number | undefined | null,
  defaultIfEmpty?: string
): string {
  if (val === undefined || val === null || val === "") {
    return defaultIfEmpty !== undefined ? defaultIfEmpty : "-";
  }
  if (val === "-") return "-";
  const str = String(val).trim();
  if (str === "-" || str === "รอข้อมูล SAP" || str === "รอระบบ SAP") {
    return str;
  }
  const match = str.match(/-?\d+(?:\.\d+)?/);
  if (!match) return str;
  const num = parseFloat(match[0]);
  if (isNaN(num)) return str;
  return `${num.toFixed(2)} mm`;
}

// Unified parser for SAP rows extracted from Excel (.xlsx/.xls) or parsed CSV/TSV table text
export function parseSapRows(rawRows: any[][]): SapMasterItem[] {
  if (!rawRows || rawRows.length === 0) return [];
  const items: SapMasterItem[] = [];

  // Dynamic Column Indexes
  let batchIdx = -1;
  let salesDocIdx = -1;
  let materialNoIdx = -1;
  let certThicknessIdx = -1;
  let storageLocationIdx = -1;
  let targetThicknessIdx = -1;
  let widthIdx = -1;
  let weightIdx = -1;
  let qualityClassIdx = -1;
  let gradeIdx = -1;
  let manufacturerIdx = -1;
  let descriptionIdx = -1;
  let coilNoIdx = -1;
  let conditionTextIdx = -1;

  let headerRowIdx = -1;

  // 1. Detect header row within the first 15 rows
  for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row) || row.length === 0) continue;
    const rowText = row.map((c) => String(c ?? "").toLowerCase()).join(" ");

    const hasHeaderKeywords =
      rowText.includes("batch") ||
      rowText.includes("แบท") ||
      rowText.includes("เเบต") ||
      rowText.includes("sales") ||
      rowText.includes("material") ||
      rowText.includes("thick") ||
      rowText.includes("หนา") ||
      rowText.includes("width") ||
      rowText.includes("กว้าง") ||
      rowText.includes("unrestricted") ||
      rowText.includes("น้ำหนัก") ||
      rowText.includes("weight") ||
      rowText.includes("grade") ||
      rowText.includes("เกรด") ||
      rowText.includes("storage") ||
      rowText.includes("location") ||
      rowText.includes("คอยล์");

    if (hasHeaderKeywords) {
      headerRowIdx = r;
      row.forEach((col, idx) => {
        const c = String(col ?? "").toLowerCase().trim();
        if (c === "batch" || c.includes("เเบต") || c.includes("แบท") || c.includes("เลขที่ batch") || c.includes("lot") || c.includes("หมายเลขแบท") || c.includes("บาร์โค้ด")) batchIdx = idx;
        else if (c.includes("sales") || c.includes("order") || c.includes("เอกสาร") || c.includes("ใบสั่ง") || c === "so" || c === "s/o") salesDocIdx = idx;
        else if (c.includes("discription") || c.includes("description") || c.includes("รายละเอียด") || c.includes("ชื่อสินค้า") || c === "ชื่อ") descriptionIdx = idx;
        else if (c.includes("material") || c.includes("รหัส") || c.includes("วัตถุดิบ") || (c.includes("item") && materialNoIdx === -1)) materialNoIdx = idx;
        else if (c.includes("cert") || c.includes("หนา certificated") || c.includes("หนาcert") || c.includes("thick") || c === "หนา") certThicknessIdx = idx;
        else if (c.includes("storage") || c.includes("location") || c.includes("คลัง") || c.includes("sloc") || c.includes("ตำแหน่ง") || c.includes("ที่เก็บ")) storageLocationIdx = idx;
        else if (c.includes("เป้าหมาย") || c.includes("target")) targetThicknessIdx = idx;
        else if (c.includes("กว้าง") || c.includes("width")) widthIdx = idx;
        else if (c.includes("unrestricted") || c.includes("น้ำหนัก") || c.includes("weight") || c.includes("kg") || c.includes("กก") || (c.includes("qty") && weightIdx === -1) || c.includes("ปริมาณ")) weightIdx = idx;
        else if (c.includes("ชั้นคุณภาพ") || c.includes("quality") || c.includes("class") || c.includes("เกรดคุณภาพ")) qualityClassIdx = idx;
        else if (c.includes("grade") || c.includes("เกรด") || c === "เหล็ก") gradeIdx = idx;
        else if (c.includes("ผู้ผลิต") || c.includes("manufacturer") || c.includes("maker") || c.includes("vendor") || c.includes("โรงงาน")) manufacturerIdx = idx;
        else if (c.includes("คอยล์") || c.includes("coil") || c.includes("หมายเลขคอยล์") || c.includes("แม่คอยล์")) coilNoIdx = idx;
        else if (c.includes("สภาพ") || c.includes("condition") || c.includes("text") || c.includes("หมายเหตุ") || c.includes("remark") || c.includes("สถานะ")) conditionTextIdx = idx;
      });
      break;
    }
  }

  // 2. Process all data rows (guaranteeing no dropped rows)
  for (let r = 0; r < rawRows.length; r++) {
    if (r <= headerRowIdx) continue;
    const row = rawRows[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    // Convert row items to trimmed strings
    const cells = row.map((cell) => (cell !== null && cell !== undefined ? String(cell).trim() : ""));

    // Check if entire row is empty
    if (cells.every((c) => c.length === 0)) continue;

    // Check if this row is another repeated header row
    const rowStr = cells.join(" ").toLowerCase();
    if (
      rowStr.includes("sales document") ||
      rowStr.includes("material no") ||
      (rowStr.includes("batch") && rowStr.includes("storage"))
    ) {
      continue;
    }

    // Determine Batch column index for this row
    let B = batchIdx;

    if (B === -1 || B >= cells.length || !cells[B]) {
      // 1. Search for standard alphanumeric/numeric batch pattern (8-15 chars)
      for (let i = 0; i < cells.length; i++) {
        const val = cells[i];
        if (/^[A-Za-z0-9\-_]{8,15}$/.test(val)) {
          B = i;
          break;
        }
      }
      // 2. Search for any 6-25 char code containing letters
      if (B === -1) {
        for (let i = 0; i < cells.length; i++) {
          const val = cells[i];
          if (/^[A-Za-z0-9\-_]{6,25}$/.test(val) && /[A-Za-z]/.test(val)) {
            B = i;
            break;
          }
        }
      }
      // 3. Fallback standard SAP batch positions (column 4 or column 0)
      if (B === -1) {
        if (cells.length >= 5 && cells[4]) B = 4;
        else if (cells[0]) B = 0;
      }
    }

    if (B === -1 || !cells[B]) continue;

    const rawBatchCode = cells[B].replace(/[^A-Za-z0-9\-_]/g, "").trim().toUpperCase();
    if (!rawBatchCode || rawBatchCode.length < 3) continue;

    // Extract attributes with robust fallbacks
    const salesDoc = (salesDocIdx !== -1 && cells[salesDocIdx]) || (B >= 4 ? cells[B - 4] : cells[0] || "");
    const materialNo = (materialNoIdx !== -1 && cells[materialNoIdx]) || (B >= 3 ? cells[B - 3] : cells[1] || "");
    
    let certThickness = (certThicknessIdx !== -1 && cells[certThicknessIdx]) || (B >= 2 ? cells[B - 2] : cells[2] || "");
    if (certThickness && !isNaN(Number(certThickness)) && !certThickness.includes("mm")) {
      certThickness = `${certThickness} mm`;
    }

    let storageLocation = (storageLocationIdx !== -1 && cells[storageLocationIdx]) || (B >= 1 ? cells[B - 1] : cells[3] || "");
    if (storageLocation.includes("E+") || storageLocation.includes("e+") || storageLocation === "2000000000" || storageLocation === "2.00E+09") {
      storageLocation = "2E09";
    }

    let targetThickness = (targetThicknessIdx !== -1 && cells[targetThicknessIdx]) || cells[B + 1] || certThickness || "";
    if (targetThickness && !isNaN(Number(targetThickness)) && !targetThickness.includes("mm")) {
      targetThickness = `${targetThickness} mm`;
    }

    let width = (widthIdx !== -1 && cells[widthIdx]) || cells[B + 2] || "";
    if (width && !isNaN(Number(width)) && !width.includes("mm")) {
      width = `${width} mm`;
    }

    // Extract weight / Unrestricted (kg)
    let weightKg = 0;
    if (weightIdx !== -1 && cells[weightIdx] !== undefined) {
      // Prioritize the detected "Unrestricted" column from header (e.g. 0, 1500)
      weightKg = sanitizeWeightKg(cells[weightIdx]);
    } else if (cells[B + 3] !== undefined && sanitizeWeightKg(cells[B + 3]) > 0) {
      // Standard SAP layout position: Column B+3
      weightKg = sanitizeWeightKg(cells[B + 3]);
    } else if (weightIdx === -1) {
      // Fallback only if no header found at all; strictly exclude SLoc (e.g. 2E09) and other columns
      for (let i = 0; i < cells.length; i++) {
        if (
          i !== B &&
          i !== salesDocIdx &&
          i !== materialNoIdx &&
          i !== storageLocationIdx &&
          i !== certThicknessIdx &&
          i !== targetThicknessIdx &&
          i !== widthIdx &&
          i !== coilNoIdx
        ) {
          const w = sanitizeWeightKg(cells[i]);
          if (w > 0 && w < 100000) {
            weightKg = w;
            break;
          }
        }
      }
    }

    const qualityClass = (qualityClassIdx !== -1 && cells[qualityClassIdx]) || cells[B + 4] || "-";
    const grade = (gradeIdx !== -1 && cells[gradeIdx]) || cells[B + 5] || "-";
    const manufacturer = (manufacturerIdx !== -1 && cells[manufacturerIdx]) || cells[B + 6] || "-";
    const description = (descriptionIdx !== -1 && cells[descriptionIdx]) || cells[B + 7] || "";
    const coilNo = (coilNoIdx !== -1 && cells[coilNoIdx]) || cells[B + 8] || "";
    const conditionText = (conditionTextIdx !== -1 && cells[conditionTextIdx]) || cells[B + 9] || "";

    items.push({
      salesDoc,
      materialNo,
      certThickness: certThickness || "-",
      storageLocation: storageLocation || "-",
      batch: rawBatchCode,
      targetThickness: targetThickness || certThickness || "-",
      width: width || "-",
      weightKg,
      unrestricted: `${weightKg.toLocaleString()} kg`,
      qualityClass,
      grade,
      manufacturer,
      description,
      coilNo,
      conditionText,
    });
  }

  return items;
}

// Helper to parse SAP TSV / Table text pasted from SAP / Excel
export function parseRawSapTsvText(rawText: string): SapMasterItem[] {
  if (!rawText || !rawText.trim()) return [];

  // Try using XLSX to parse string directly (handles quotes, commas, tabs, and multiline values natively)
  try {
    const workbook = XLSX.read(rawText, { type: "string" });
    if (workbook.SheetNames.length > 0) {
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (rows && rows.length > 0) {
        const parsed = parseSapRows(rows);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch {
    // fallback to manual line splitting
  }

  // Fallback line & delimiter splitting
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: string[][] = [];

  for (const line of lines) {
    let cols: string[];
    if (line.includes("\t")) {
      cols = line.split("\t");
    } else if (line.includes(",") && (line.match(/,/g) || []).length >= 2) {
      // Split by comma respecting quotes
      cols = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^,/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) || line.split(",");
    } else if (line.includes(";") && (line.match(/;/g) || []).length >= 2) {
      cols = line.split(";");
    } else if (line.includes("|")) {
      cols = line.split("|");
    } else {
      cols = line.split(/\s{2,}/);
    }
    rows.push(cols.map((c) => c.trim().replace(/^["']|["']$/g, "")));
  }

  return parseSapRows(rows);
}

// Sound alert generator using Web Audio API
function playScanSound(success: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (success) {
      // Pleasant double-beep (880Hz then 1760Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, ctx.currentTime);
      gain1.gain.setValueAtTime(0.12, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.08);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1760, ctx.currentTime + 0.09);
      gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.09);
      osc2.stop(ctx.currentTime + 0.18);
    } else {
      // Low buzz / error tone (180Hz sawtooth)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.28);
    }
  } catch {
    // AudioContext blocked or not supported
  }
}

export function generate3000SapRecords(): SapMasterItem[] {
  return [];
}

// Generate record from shopfloor scan (Defaults to 3 shopfloor columns: Batch, Machine, Location; hasSapData: false)
function generateRecordFromBatch(
  batch: string,
  mode: "inbound" | "outbound",
  batchLocation: string = "-",
  batchMachine: string = "SM01",
  sapMap?: Map<string, SapMasterItem>
): SlitBarcodeRecord {
  const now = new Date();
  const timestamp = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  
  const matchedSap = sapMap?.get(batch.trim().toUpperCase());

  if (matchedSap) {
    return {
      id: `SLIT-${mode.toUpperCase()}-${Date.now()}-${batch}`,
      mode,
      scanTimestamp: `${dateStr} ${timestamp}`,
      batch,
      machine: batchMachine || "SM01",
      location: batchLocation || "-",
      hasSapData: true,
      certThickness: matchedSap.certThickness,
      width: matchedSap.width,
      weightKg: matchedSap.weightKg,
      unrestricted: matchedSap.unrestricted,
      grade: matchedSap.grade,
      manufacturer: matchedSap.manufacturer,
      storageLocation: matchedSap.storageLocation || batchLocation,
      salesDoc: matchedSap.salesDoc,
      materialNo: matchedSap.materialNo,
      targetThickness: matchedSap.targetThickness,
      qualityClass: matchedSap.qualityClass,
      description: matchedSap.description,
      coilNo: matchedSap.coilNo,
      conditionText: matchedSap.conditionText,
    };
  }

  // Shopfloor Scan Record without SAP Master Data
  return {
    id: `SLIT-${mode.toUpperCase()}-${Date.now()}-${batch}`,
    mode,
    scanTimestamp: `${dateStr} ${timestamp}`,
    batch,
    machine: batchMachine || "SM01",
    location: batchLocation || "-",
    hasSapData: false,
    storageLocation: batchLocation || "-",
  };
}

// Helper: Merge / Upsert SlitBarcodeRecord by Batch, ensuring no duplicate transaction rows
// and replacing "รอข้อมูล SAP" with real SAP values whenever available.
export function mergeSlitBarcodeRecords(
  existing: SlitBarcodeRecord,
  incoming: Partial<SlitBarcodeRecord>,
  sapMap?: Map<string, SapMasterItem>
): SlitBarcodeRecord {
  const bKey = (incoming.batch || existing.batch || "").trim().toUpperCase();
  const matchedSap = sapMap?.get(bKey);

  const hasIncomingSap = incoming.hasSapData === true || (Boolean(incoming.certThickness) && incoming.certThickness !== "รอข้อมูล SAP");
  const hasExistingSap = existing.hasSapData === true || (Boolean(existing.certThickness) && existing.certThickness !== "รอข้อมูล SAP");
  const hasSap = Boolean(matchedSap) || hasIncomingSap || hasExistingSap;

  // Real SAP data values: prioritize matched SAP Master Data, then incoming with SAP, then existing with SAP
  const certThickness = matchedSap?.certThickness || (hasIncomingSap ? incoming.certThickness : (hasExistingSap ? existing.certThickness : undefined)) || existing.certThickness || incoming.certThickness;
  const width = matchedSap?.width || (hasIncomingSap ? incoming.width : (hasExistingSap ? existing.width : undefined)) || existing.width || incoming.width;
  const weightKg = matchedSap ? matchedSap.weightKg : (hasIncomingSap && incoming.weightKg !== undefined ? incoming.weightKg : (hasExistingSap && existing.weightKg !== undefined ? existing.weightKg : (incoming.weightKg !== undefined ? incoming.weightKg : existing.weightKg)));
  const unrestricted = matchedSap?.unrestricted || (hasIncomingSap ? incoming.unrestricted : (hasExistingSap ? existing.unrestricted : undefined)) || existing.unrestricted || incoming.unrestricted;
  const grade = matchedSap?.grade || (hasIncomingSap ? incoming.grade : (hasExistingSap ? existing.grade : undefined)) || existing.grade || incoming.grade;
  const manufacturer = matchedSap?.manufacturer || (hasIncomingSap ? incoming.manufacturer : (hasExistingSap ? existing.manufacturer : undefined)) || existing.manufacturer || incoming.manufacturer;
  const description = matchedSap?.description || (hasIncomingSap ? incoming.description : (hasExistingSap ? existing.description : undefined)) || existing.description || incoming.description;
  const salesDoc = matchedSap?.salesDoc || incoming.salesDoc || existing.salesDoc;
  const materialNo = matchedSap?.materialNo || incoming.materialNo || existing.materialNo;
  const targetThickness = matchedSap?.targetThickness || incoming.targetThickness || existing.targetThickness;
  const qualityClass = matchedSap?.qualityClass || incoming.qualityClass || existing.qualityClass;
  const coilNo = matchedSap?.coilNo || incoming.coilNo || existing.coilNo;

  // Location tracking: preserve previous location if changing
  const incomingLoc = incoming.location?.trim();
  const existingLoc = existing.location?.trim();
  let prevLoc = incoming.previousLocation || existing.previousLocation;
  if (!prevLoc && incomingLoc && existingLoc && incomingLoc !== existingLoc) {
    prevLoc = existingLoc;
  }
  const finalLoc = incomingLoc || existingLoc || "-";

  // Order No: prefer non-empty
  const finalOrderNo = incoming.orderNo || existing.orderNo;

  return {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id || `SLIT-${Date.now()}-${bKey}`,
    batch: bKey,
    orderNo: finalOrderNo,
    mode: incoming.mode || existing.mode || "inbound",
    location: finalLoc,
    storageLocation: incoming.storageLocation || existing.storageLocation || finalLoc,
    previousLocation: prevLoc,
    machine: incoming.machine || existing.machine || "SM01",
    scanTimestamp: incoming.scanTimestamp || existing.scanTimestamp,
    conditionText: incoming.conditionText || existing.conditionText,
    hasSapData: hasSap,
    certThickness,
    width,
    weightKg,
    unrestricted,
    grade,
    manufacturer,
    description,
    salesDoc,
    materialNo,
    targetThickness,
    qualityClass,
    coilNo,
  };
}

export function SlitFilmManagement({
  onLogTransaction,
  activeMode: externalMode,
  onModeChange,
}: SlitFilmManagementProps) {
  const { language } = useLanguage();
  const isThai = language === "th";

  // Mode: Inbound vs Outbound vs Operator Receive vs Movement History vs Relocate Layout vs Stock Balance vs Space Management vs Return Warehouse vs Equipment Inspection vs Transfer Car Report
  const [internalMode, setInternalMode] = useState<"inbound" | "outbound" | "operator_receive" | "movement_history" | "relocate_layout" | "stock_balance" | "space_management" | "return_warehouse" | "daily_report" | "equipment_inspection" | "transfer_car_report">("inbound");
  const activeMode = externalMode ?? internalMode;
  const setActiveMode = (mode: "inbound" | "outbound" | "operator_receive" | "movement_history" | "relocate_layout" | "stock_balance" | "space_management" | "return_warehouse" | "daily_report" | "equipment_inspection" | "transfer_car_report") => {
    setInternalMode(mode);
    onModeChange?.(mode);
  };

  // Step 1: Selected Source Machine for Inbound (Starts null so employee picks before scanning)
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);

  // Inbound Machines List (Default SM01-SM04, extensible by user and persisted in localStorage)
  const [inboundMachines, setInboundMachines] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INBOUND_MACHINES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return AVAILABLE_MACHINES;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INBOUND_MACHINES, JSON.stringify(inboundMachines));
    } catch {}
  }, [inboundMachines]);

  // Add New Inbound Machine Modal State
  const [isAddInboundMachineOpen, setIsAddInboundMachineOpen] = useState<boolean>(false);
  const [newInboundMachineCode, setNewInboundMachineCode] = useState<string>("");
  const [addInboundMachineError, setAddInboundMachineError] = useState<string | null>(null);

  const getSuggestedNextInboundMachine = useCallback((machines: string[]) => {
    let maxNum = 0;
    machines.forEach((m) => {
      const match = /^SM(\d+)$/i.exec(m.trim());
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    const nextNum = maxNum > 0 ? maxNum + 1 : machines.length + 1;
    return `SM${String(nextNum).padStart(2, "0")}`;
  }, []);

  const handleOpenAddInboundMachine = () => {
    setAddInboundMachineError(null);
    setNewInboundMachineCode(getSuggestedNextInboundMachine(inboundMachines));
    setIsAddInboundMachineOpen(true);
  };

  const handleAddInboundMachineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newInboundMachineCode.trim().toUpperCase();
    if (!cleaned) {
      setAddInboundMachineError(
        isThai ? "กรุณาระบุรหัสเครื่องจักร (เช่น SM05)" : "Please enter a machine code (e.g. SM05)"
      );
      return;
    }
    if (inboundMachines.some((m) => m.toUpperCase() === cleaned)) {
      setAddInboundMachineError(
        isThai ? `รหัสเครื่องจักร "${cleaned}" มีอยู่ในระบบแล้ว` : `Machine "${cleaned}" already exists`
      );
      return;
    }

    setInboundMachines((prev) => [...prev, cleaned]);
    setIsAddInboundMachineOpen(false);
    setNewInboundMachineCode("");
    setAddInboundMachineError(null);
    setNotificationToast({
      type: "success",
      message: isThai
        ? `เพิ่มเครื่องจักรรับเข้า [ ${cleaned} ] สำเร็จเรียบร้อยแล้ว`
        : `Successfully added inbound machine [ ${cleaned} ]`,
    });
    onLogTransaction?.(`Added Inbound Machine ${cleaned}`, cleaned, "Completed");
  };

  const handleDeleteInboundMachine = async (machineId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await Swal.fire({
      title: isThai ? `ลบเครื่องจักร ${machineId}?` : `Remove Machine ${machineId}?`,
      text: isThai
        ? `ต้องการนำเครื่องจักร [ ${machineId} ] ออกจากรายการหน้า + รับเข้า ใช่หรือไม่?`
        : `Do you want to remove machine [ ${machineId} ] from Inbound selection?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ลบเครื่องจักร" : "Remove",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
      reverseButtons: true,
    });

    if (result.isConfirmed) {
      setInboundMachines((prev) => prev.filter((m) => m !== machineId));
      if (selectedMachine === machineId) {
        setSelectedMachine(null);
      }
      setNotificationToast({
        type: "info",
        message: isThai
          ? `ลบเครื่องจักร [ ${machineId} ] ออกจากรายการแล้ว`
          : `Removed machine [ ${machineId} ]`,
      });
    }
  };

  // Step 2: Location configuration for current Inbound round
  const [selectedLocation, setSelectedLocation] = useState<string>("");

  // Barcode Scanner Modal State
  const [isScannerModalOpen, setIsScannerModalOpen] = useState<boolean>(false);

  // Current session batches (isolated scan round before committing to storage)
  const [currentSessionBatches, setCurrentSessionBatches] = useState<SlitBarcodeRecord[]>([]);

  // Mandatory Location Scanner Modal State (Chained Modal Workflow)
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [locationBarcode, setLocationBarcode] = useState<string>("");
  const [locationScanError, setLocationScanError] = useState<string | null>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);

  // Success Notification / Toast State
  const [notificationToast, setNotificationToast] = useState<{
    message: string;
    type: "success" | "info";
  } | null>(null);

  // Auto-dismiss notification toast after 4 seconds
  useEffect(() => {
    if (notificationToast) {
      const timer = setTimeout(() => setNotificationToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notificationToast]);

  // SweetAlert-style Success Modal State
  const [sweetAlertData, setSweetAlertData] = useState<{
    isOpen: boolean;
    machine: string;
    batchCount: number;
    totalWeightKg: number;
    totalWeightTon: string;
    location: string;
    timestamp: string;
  }>({
    isOpen: false,
    machine: "",
    batchCount: 0,
    totalWeightKg: 0,
    totalWeightTon: "0.000",
    location: "",
    timestamp: "",
  });

  // Operator Warning Modal State
  const [operatorWarningModal, setOperatorWarningModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  // SAP Master Data Upload & Mapping State (Pre-loadable & Persistent)
  const [isSapModalOpen, setIsSapModalOpen] = useState<boolean>(false);
  const [sapRawText, setSapRawText] = useState<string>("");
  const [sapMasterMap, setSapMasterMap] = useState<Map<string, SapMasterItem>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SAP_MASTER);
      if (saved) {
        const parsed: SapMasterItem[] = JSON.parse(saved);
        const map = new Map<string, SapMasterItem>();
        let hasSanitized = false;
        parsed.forEach((item) => {
          const safeWeight = sanitizeWeightKg(item.weightKg, item.unrestricted);
          if (safeWeight !== item.weightKg || (item.unrestricted && item.unrestricted.includes("2,000,000,000"))) {
            item.weightKg = safeWeight;
            item.unrestricted = `${safeWeight.toLocaleString()} kg`;
            hasSanitized = true;
          }
          map.set(item.batch.trim().toUpperCase(), item);
        });
        if (hasSanitized) {
          localStorage.setItem(STORAGE_KEY_SAP_MASTER, JSON.stringify(Array.from(map.values())));
        }
        return map;
      }
    } catch {}
    return new Map();
  });

  // SAP Upload & Processing Animation State
  const [isSapProcessing, setIsSapProcessing] = useState<boolean>(false);
  const [sapProgress, setSapProgress] = useState<number>(0);
  const [sapCurrentStep, setSapCurrentStep] = useState<number>(1);
  const [sapTotalCount, setSapTotalCount] = useState<number>(0);
  const [sapProcessedCount, setSapProcessedCount] = useState<number>(0);
  const sapAnimationTimersRef = useRef<NodeJS.Timeout[]>([]);
  const sapFileInputRef = useRef<HTMLInputElement>(null);
  const sapTextAreaRef = useRef<HTMLTextAreaElement>(null);

  // Clear pending timers on unmount
  useEffect(() => {
    return () => {
      sapAnimationTimersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Global paste handler & autofocus when SAP modal opens
  useEffect(() => {
    if (!isSapModalOpen) return;

    const timer = setTimeout(() => {
      sapTextAreaRef.current?.focus();
    }, 80);

    const handleGlobalPasteEvent = (e: ClipboardEvent) => {
      if (!isSapModalOpen || isSapProcessing) return;

      let pasted = e.clipboardData?.getData("text/plain") || e.clipboardData?.getData("text") || "";
      if (!pasted && e.clipboardData?.getData("text/html")) {
        const html = e.clipboardData.getData("text/html");
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const rows = Array.from(doc.querySelectorAll("tr"));
        if (rows.length > 0) {
          pasted = rows
            .map((r) =>
              Array.from(r.querySelectorAll("td, th"))
                .map((c) => c.textContent?.trim() || "")
                .join("\t")
            )
            .join("\n");
        } else {
          pasted = doc.body.textContent || "";
        }
      }

      if (pasted && pasted.trim().length > 0) {
        e.preventDefault();
        handleProcessPastedText(pasted);
      }
    };

    window.addEventListener("paste", handleGlobalPasteEvent);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("paste", handleGlobalPasteEvent);
    };
  }, [isSapModalOpen, isSapProcessing]);

  // Handler to process pasted text immediately with progressive delay animation
  const handleProcessPastedText = (rawText: string) => {
    if (!rawText || !rawText.trim()) return;

    // Immediately trigger progressive animation view so UI never freezes with large data
    setIsSapProcessing(true);
    setSapProgress(8);
    setSapCurrentStep(1);

    // Yield execution to next event loop tick so browser renders animation screen instantly
    setTimeout(() => {
      handlePerformSapMapping(rawText);
    }, 60);
  };

  // Handler to process file uploads (Native Excel .xlsx/.xls or CSV/TSV with Thai encoding support)
  const handleFileUpload = (file: File) => {
    setIsSapProcessing(true);
    setSapProgress(8);
    setSapCurrentStep(1);

    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) {
          setIsSapProcessing(false);
          return;
        }

        if (isExcel) {
          // Parse Excel workbook natively using SheetJS (all 2,600+ rows preserved)
          const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          const parsedItems = parseSapRows(rawRows);
          handlePerformSapMapping(parsedItems);
        } else {
          // Parse CSV/TSV/TXT with Windows-874 / TIS-620 and UTF-8 auto-detection
          const decodedText = decodeFileBuffer(buffer);
          if (decodedText && decodedText.trim()) {
            handlePerformSapMapping(decodedText);
          } else {
            setIsSapProcessing(false);
          }
        }
      } catch (err) {
        console.error("File upload parse error:", err);
        setIsSapProcessing(false);
        Swal.fire({
          icon: "error",
          title: isThai ? "เกิดข้อผิดพลาดในการอ่านไฟล์" : "File Read Error",
          text: isThai ? "ไม่สามารถอ่านไฟล์ได้ กรุณาตรวจสอบว่าเป็นไฟล์ Excel หรือ CSV ที่ถูกต้อง" : "Failed to parse file.",
          confirmButtonColor: "#087eaf",
          confirmButtonText: isThai ? "ตกลง" : "OK",
        });
      }
    };

    reader.onerror = () => {
      setIsSapProcessing(false);
    };

    reader.readAsArrayBuffer(file);
  };

  // Function to execute SAP Mapping across shopfloor batches with timed delay animation
  const handlePerformSapMapping = (isDemoOrCustom?: boolean | SapMasterItem[] | string) => {
    let masterData: SapMasterItem[];
    if (Array.isArray(isDemoOrCustom)) {
      masterData = isDemoOrCustom;
    } else if (typeof isDemoOrCustom === "string") {
      masterData = parseRawSapTsvText(isDemoOrCustom);
    } else if (isDemoOrCustom === true) {
      masterData = generate3000SapRecords();
    } else {
      masterData = parseRawSapTsvText(sapRawText);
    }

    if (masterData.length === 0) {
      setIsSapProcessing(false);
      Swal.fire({
        icon: "warning",
        title: isThai ? "ไม่พบข้อมูลในข้อความที่วาง" : "No Valid Records Parsed",
        text: isThai
          ? "ไม่พบข้อมูล Batch ในข้อความที่วาง กรุณาคัดลอกตารางจาก Excel หรือ SAP มาวางในช่องข้อความแล้วลองอีกครั้ง"
          : "No valid Batch items parsed. Please check table formatting and paste again.",
        confirmButtonColor: "#0284c7",
        confirmButtonText: isThai ? "ตกลง" : "OK",
      });
      return;
    }

    // Clear previous timers
    sapAnimationTimersRef.current.forEach((t) => clearTimeout(t));
    sapAnimationTimersRef.current = [];

    const totalRecords = masterData.length;
    setSapTotalCount(totalRecords);
    setSapProcessedCount(0);
    setSapProgress(12);
    setSapCurrentStep(1);
    setIsSapProcessing(true);

    // Realistic multi-stage progressive delay animation
    // Step 1: 0ms -> 500ms: Validate structure & file header
    const t1 = setTimeout(() => {
      setSapProgress(24);
      setSapProcessedCount(Math.round(totalRecords * 0.24));
      setSapCurrentStep(2);
    }, 500);

    // Step 2: 500ms -> 1100ms: Parse and extract 14 columns
    const t2 = setTimeout(() => {
      setSapProgress(56);
      setSapProcessedCount(Math.round(totalRecords * 0.56));
      setSapCurrentStep(3);
    }, 1100);

    // Step 3: 1100ms -> 1750ms: Cross-match batch barcodes with inventory & machine racks
    const t3 = setTimeout(() => {
      setSapProgress(86);
      setSapProcessedCount(Math.round(totalRecords * 0.86));
      setSapCurrentStep(4);
    }, 1750);

    // Step 4: 1750ms -> 2300ms: Synchronize database and finalize state
    const t4 = setTimeout(() => {
      setSapProgress(100);
      setSapProcessedCount(totalRecords);

      const map = new Map<string, SapMasterItem>(sapMasterMap);
      masterData.forEach((item) => {
        map.set(item.batch.trim().toUpperCase(), item);
      });
      setSapMasterMap(map);
      try {
        localStorage.setItem(STORAGE_KEY_SAP_MASTER, JSON.stringify(Array.from(map.values())));
      } catch {}

      setInboundList((prev) =>
        prev.map((rec) => {
          const match = map.get(rec.batch.trim().toUpperCase());
          if (match) {
            const currentLoc = (rec.location || "").trim();
            const isLocMissing =
              !currentLoc ||
              currentLoc === "-" ||
              currentLoc.toUpperCase() === "PENDING" ||
              currentLoc === "รอระบุ" ||
              currentLoc.includes("รอสแกน");
            const resolvedLocation =
              isLocMissing && match.storageLocation && match.storageLocation !== "-"
                ? match.storageLocation
                : rec.location;
            return {
              ...rec,
              hasSapData: true,
              salesDoc: match.salesDoc,
              materialNo: match.materialNo,
              certThickness: match.certThickness,
              location: resolvedLocation,
              storageLocation: match.storageLocation || resolvedLocation,
              targetThickness: match.targetThickness,
              width: match.width,
              weightKg: match.weightKg,
              unrestricted: match.unrestricted,
              qualityClass: match.qualityClass,
              grade: match.grade,
              manufacturer: match.manufacturer,
              description: match.description,
              coilNo: match.coilNo,
              conditionText: rec.conditionText || match.conditionText,
            };
          }
          return rec;
        })
      );

      setOutboundList((prev) =>
        prev.map((rec) => {
          const match = map.get(rec.batch.trim().toUpperCase());
          if (match) {
            return {
              ...rec,
              hasSapData: true,
              salesDoc: match.salesDoc,
              materialNo: match.materialNo,
              certThickness: match.certThickness,
              storageLocation: match.storageLocation || rec.location,
              targetThickness: match.targetThickness,
              width: match.width,
              weightKg: match.weightKg,
              unrestricted: match.unrestricted,
              qualityClass: match.qualityClass,
              grade: match.grade,
              manufacturer: match.manufacturer,
              description: match.description,
              coilNo: match.coilNo,
              conditionText: match.conditionText,
            };
          }
          return rec;
        })
      );

      // Calculate matched count across shopfloor batches
      const allShopfloorBatches = new Set([
        ...inboundList.map((r) => r.batch.trim().toUpperCase()),
        ...outboundList.map((r) => r.batch.trim().toUpperCase()),
      ]);
      let totalMappedShopfloorBatches = 0;
      allShopfloorBatches.forEach((b) => {
        if (map.has(b)) totalMappedShopfloorBatches++;
      });

      // Brief hold at 100% (500ms) to allow operator to visually confirm completion
      const tFinish = setTimeout(() => {
        setIsSapProcessing(false);
        setIsSapModalOpen(false);
        setSapRawText("");

        if (soundEnabled) playScanSound(true);

        Swal.fire({
          icon: "success",
          title: isThai ? "อัปโหลดข้อมูล SAP สำเร็จ!" : "SAP Master Data Saved!",
          html: `
            <div style="text-align: left; font-size: 13px; line-height: 1.6; font-family: 'Noto Sans Thai', sans-serif;">
              <p style="margin-bottom: 8px; color: #334155; font-weight: 600;">
                ${isThai 
                  ? "ระบบบันทึกฐานข้อมูล SAP เรียบร้อยแล้ว พร้อมนำไปจับคู่อัตโนมัติทันทีที่หน้างานสแกนรับเข้า" 
                  : "SAP master data saved successfully. It will automatically match when shopfloor scans inbound."}
              </p>
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 10px; font-family: 'Noto Sans Thai', sans-serif; font-variant-numeric: tabular-nums;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: #166534;">${isThai ? "จำนวนข้อมูล SAP ที่โหลดเข้าระบบ:" : "Parsed SAP Records:"}</span>
                  <span style="font-weight: bold; color: #15803d;">${masterData.length.toLocaleString()} ${isThai ? "รายการ" : "items"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: #166534;">${isThai ? "จับคู่กับ Batch ในระบบปัจจุบัน:" : "Matched Existing Batches:"}</span>
                  <span style="font-weight: bold; color: #0284c7;">${totalMappedShopfloorBatches} ${isThai ? "รายการ" : "items"}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #166534;">${isThai ? "สถานะการสแกนหน้างาน:" : "Inbound Ready:"}</span>
                  <span style="font-weight: bold; color: #059669;">${isThai ? "รองรับการรับเข้าภายหลังได้ทันที" : "Ready for Inbound Scan"}</span>
                </div>
              </div>
            </div>
          `,
          confirmButtonColor: "#087eaf",
          confirmButtonText: isThai ? "ตกลง (OK)" : "OK",
        });

        onLogTransaction?.(
          `Saved ${masterData.length} SAP master records (${totalMappedShopfloorBatches} existing batches updated)`,
          `SAP-MAP-${Date.now()}`,
          "Completed"
        );
      }, 500);

      sapAnimationTimersRef.current.push(tFinish);
    }, 2300);

    sapAnimationTimersRef.current.push(t1, t2, t3, t4);
  };

  const DEFAULT_INITIAL_INBOUND: SlitBarcodeRecord[] = useMemo(() => [], []);

  // Scanned lists, outbound lists, and pick lists initialized with full localStorage persistence & deduplication
  const [inboundList, setInboundList] = useState<SlitBarcodeRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INBOUND);
      if (saved) {
        const parsed: SlitBarcodeRecord[] = JSON.parse(saved);
        let hasSanitized = false;
        const map = new Map<string, SlitBarcodeRecord>();
        parsed.forEach((r) => {
          if (!r.batch) return;
          const bKey = r.batch.trim().toUpperCase();
          const safeWeight = sanitizeWeightKg(r.weightKg, r.unrestricted);
          const sanitizedR = safeWeight !== r.weightKg || (r.unrestricted && r.unrestricted.includes("2,000,000,000"))
            ? { ...r, weightKg: safeWeight, unrestricted: `${safeWeight.toLocaleString()} kg` }
            : r;
          if (map.has(bKey)) {
            hasSanitized = true;
            map.set(bKey, mergeSlitBarcodeRecords(map.get(bKey)!, sanitizedR));
          } else {
            map.set(bKey, sanitizedR);
          }
        });
        const cleaned = Array.from(map.values());
        if (hasSanitized || cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEY_INBOUND, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    } catch {}
    return [];
  });

  const [outboundList, setOutboundList] = useState<SlitBarcodeRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_OUTBOUND);
      if (saved) {
        const parsed: SlitBarcodeRecord[] = JSON.parse(saved);
        let hasSanitized = false;
        const map = new Map<string, SlitBarcodeRecord>();
        parsed.forEach((r) => {
          if (!r.batch) return;
          const bKey = r.batch.trim().toUpperCase();
          const safeWeight = sanitizeWeightKg(r.weightKg, r.unrestricted);
          const sanitizedR = safeWeight !== r.weightKg || (r.unrestricted && r.unrestricted.includes("2,000,000,000"))
            ? { ...r, weightKg: safeWeight, unrestricted: `${safeWeight.toLocaleString()} kg` }
            : r;
          if (map.has(bKey)) {
            hasSanitized = true;
            map.set(bKey, mergeSlitBarcodeRecords(map.get(bKey)!, sanitizedR));
          } else {
            map.set(bKey, sanitizedR);
          }
        });
        const cleaned = Array.from(map.values());
        if (hasSanitized || cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEY_OUTBOUND, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INBOUND, JSON.stringify(inboundList));
    } catch {
      // ignore
    }
  }, [inboundList]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_OUTBOUND, JSON.stringify(outboundList));
    } catch {
      // ignore
    }
  }, [outboundList]);

  // Pick List Orders state (Officer import & Inspector scanning)
  const [pickLists, setPickLists] = useState<PickListOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PICK_LISTS);
      if (saved) {
        const parsed: PickListOrder[] = JSON.parse(saved);
        return parsed.map((ord) => ({
          ...ord,
          items: ord.items.filter((item) => Boolean(item.batch && /^[A-Za-z0-9]{10}$/.test(item.batch.trim()))),
        }));
      }
    } catch {}
    return INITIAL_PICK_LISTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PICK_LISTS, JSON.stringify(pickLists));
    } catch {
      // ignore
    }
  }, [pickLists]);

  // Outbound active machine category & active machine selection
  const [activeCategory, setActiveCategory] = useState<"pipe" | "c_channel" | "mini" | "lip_channel">("pipe");
  const [selectedOutboundMachine, setSelectedOutboundMachine] = useState<string>("TM01");
  const [selectedOrderNo, setSelectedOrderNo] = useState<string | null>(null);

  // Outbound Machines List (Default 22 machines across 4 categories, extensible by user and persisted in localStorage)
  const [outboundMachines, setOutboundMachines] = useState<MachineDef[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_OUTBOUND_MACHINES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return OUTBOUND_MACHINES;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_OUTBOUND_MACHINES, JSON.stringify(outboundMachines));
    } catch {}
  }, [outboundMachines]);

  // Add New Outbound Machine Modal State
  const [isAddOutboundMachineOpen, setIsAddOutboundMachineOpen] = useState<boolean>(false);
  const [newOutboundMachineCategory, setNewOutboundMachineCategory] = useState<"pipe" | "c_channel" | "mini" | "lip_channel">("pipe");
  const [newOutboundMachineCode, setNewOutboundMachineCode] = useState<string>("");
  const [addOutboundMachineError, setAddOutboundMachineError] = useState<string | null>(null);

  const getSuggestedNextOutboundMachine = useCallback(
    (category: "pipe" | "c_channel" | "mini" | "lip_channel", machines: MachineDef[]) => {
      const prefix =
        category === "pipe"
          ? "TM"
          : category === "c_channel"
          ? "CF"
          : category === "mini"
          ? "ML"
          : "ZF";
      let maxNum = 0;
      machines
        .filter((m) => m.type === category)
        .forEach((m) => {
          const regex = new RegExp(`^${prefix}(\\d+)$`, "i");
          const match = regex.exec(m.id.trim());
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });
      const nextNum = maxNum > 0 ? maxNum + 1 : 1;
      return `${prefix}${String(nextNum).padStart(2, "0")}`;
    },
    []
  );

  const handleOpenAddOutboundMachine = () => {
    setAddOutboundMachineError(null);
    setNewOutboundMachineCategory(activeCategory);
    setNewOutboundMachineCode(getSuggestedNextOutboundMachine(activeCategory, outboundMachines));
    setIsAddOutboundMachineOpen(true);
  };

  const handleAddOutboundMachineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newOutboundMachineCode.trim().toUpperCase();
    if (!cleaned) {
      setAddOutboundMachineError(
        isThai ? "กรุณาระบุรหัสเครื่องจักร (เช่น TM15, CF06)" : "Please enter a machine code (e.g. TM15, CF06)"
      );
      return;
    }
    if (outboundMachines.some((m) => m.id.toUpperCase() === cleaned)) {
      setAddOutboundMachineError(
        isThai ? `รหัสเครื่องจักร "${cleaned}" มีอยู่ในระบบแล้ว` : `Machine "${cleaned}" already exists`
      );
      return;
    }

    const catLabels: Record<
      "pipe" | "c_channel" | "mini" | "lip_channel",
      { categoryTh: string; categoryEn: string }
    > = {
      pipe: { categoryTh: "ผลิตท่อ", categoryEn: "Pipe Mill" },
      c_channel: { categoryTh: "ตัวซี", categoryEn: "C-Channel" },
      mini: { categoryTh: "มินิ", categoryEn: "Mini Line" },
      lip_channel: { categoryTh: "ตัวซีมีขอบ", categoryEn: "Lip Channel" },
    };

    const newMachine: MachineDef = {
      id: cleaned,
      name: cleaned,
      type: newOutboundMachineCategory,
      categoryTh: catLabels[newOutboundMachineCategory].categoryTh,
      categoryEn: catLabels[newOutboundMachineCategory].categoryEn,
    };

    setOutboundMachines((prev) => [...prev, newMachine]);
    setActiveCategory(newOutboundMachineCategory);
    setSelectedOutboundMachine(cleaned);
    setIsAddOutboundMachineOpen(false);
    setNewOutboundMachineCode("");
    setAddOutboundMachineError(null);

    setNotificationToast({
      type: "success",
      message: isThai
        ? `เพิ่มเครื่องจักร [ ${cleaned} ] (${newMachine.categoryTh}) สำเร็จเรียบร้อยแล้ว`
        : `Successfully added machine [ ${cleaned} ] (${newMachine.categoryEn})`,
    });
    onLogTransaction?.(`Added Outbound Machine ${cleaned} (${newMachine.categoryEn})`, cleaned, "Completed");
  };

  const handleDeleteOutboundMachine = async (machineId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await Swal.fire({
      title: isThai ? `ลบเครื่องจักร ${machineId}?` : `Remove Machine ${machineId}?`,
      text: isThai
        ? `ต้องการนำเครื่องจักร [ ${machineId} ] ออกจากรายการหน้าเตรียมเบิกใช่หรือไม่?`
        : `Do you want to remove machine [ ${machineId} ] from Outbound selection?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ลบเครื่องจักร" : "Remove",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
      reverseButtons: true,
    });

    if (result.isConfirmed) {
      const updated = outboundMachines.filter((m) => m.id !== machineId);
      setOutboundMachines(updated);
      if (selectedOutboundMachine === machineId) {
        const fallbackInCat = updated.find((m) => m.type === activeCategory) || updated[0];
        if (fallbackInCat) {
          setSelectedOutboundMachine(fallbackInCat.id);
        }
      }
      setNotificationToast({
        type: "info",
        message: isThai
          ? `ลบเครื่องจักร [ ${machineId} ] ออกจากรายการแล้ว`
          : `Removed machine [ ${machineId} ]`,
      });
    }
  };

  // Destination Rack for Operator Receive & Machine Staging Integration
  const [selectedDestinationRackId, setSelectedDestinationRackId] = useState<string>("");
  const [machineStagingVersion, setMachineStagingVersion] = useState<number>(0);

  // Sync staging racks in real-time with "พื้นที่วางวัตถุดิบรอผลิตหน้าเครื่องจักร"
  useEffect(() => {
    const handleSyncStaging = () => {
      setMachineStagingVersion((v) => v + 1);
    };
    window.addEventListener(MACHINE_STAGING_UPDATED_EVENT, handleSyncStaging);
    window.addEventListener("storage", handleSyncStaging);
    return () => {
      window.removeEventListener(MACHINE_STAGING_UPDATED_EVENT, handleSyncStaging);
      window.removeEventListener("storage", handleSyncStaging);
    };
  }, []);

  const destinationRacks = useMemo(() => {
    return getRacksForMachine(selectedOutboundMachine);
  }, [selectedOutboundMachine, machineStagingVersion, activeMode, isScannerModalOpen]);

  // Synchronize default destination rack whenever machine changes or destination racks update
  useEffect(() => {
    if (destinationRacks.length > 0) {
      const match = destinationRacks.find((r) => r.rackId === selectedDestinationRackId);
      if (!match) {
        const firstAvailable = destinationRacks.find((r) => r.status !== "maintenance") || destinationRacks[0];
        setSelectedDestinationRackId(firstAvailable ? firstAvailable.rackId : "");
      }
    } else {
      setSelectedDestinationRackId("");
    }
  }, [destinationRacks, selectedDestinationRackId]);

  // Collapsible state for order cards in machine view (Default: collapsed "แบบหุบไว้")
  const [expandedOrderNos, setExpandedOrderNos] = useState<string[]>([]);

  // Pagination state for Pick List Orders table & Operator Work Receipt table
  const [pickListItemPages, setPickListItemPages] = useState<Record<string, number>>({});
  const [pickListItemPageSize, setPickListItemPageSize] = useState<number>(5);
  const [operatorItemPages, setOperatorItemPages] = useState<Record<string, number>>({});
  const [operatorItemPageSize, setOperatorItemPageSize] = useState<number>(5);

  const toggleOrderExpand = (orderNo: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedOrderNos((prev) =>
      prev.includes(orderNo) ? prev.filter((o) => o !== orderNo) : [...prev, orderNo]
    );
  };

  const expandAllMachineOrders = () => {
    setExpandedOrderNos(machineOrders.map((o) => o.orderNo));
  };

  const collapseAllMachineOrders = () => {
    setExpandedOrderNos([]);
  };

  // Handler to manually remove an order from the operator queue at machine issue screen
  const handleDeleteMachineOrder = async (orderNo: string, isCompleted: boolean) => {
    const result = await Swal.fire({
      title: isThai ? "ยืนยันการนำใบสั่งเบิกออกจากคิว?" : "Confirm Removing Order?",
      text: isCompleted
        ? (isThai
            ? `ต้องการนำใบสั่งเบิก #${orderNo} (จ่ายเข้าเครื่องครบแล้ว) ออกจากคิวหน้าจ่ายหน้าเครื่องใช่หรือไม่?`
            : `Remove completed order #${orderNo} from machine queue?`)
        : (isThai
            ? `ใบสั่งเบิก #${orderNo} ยังมีรายการที่รอรับงาน ต้องการนำออกจากคิวจ่ายหน้าเครื่องใช่หรือไม่?`
            : `Order #${orderNo} is incomplete. Remove from machine queue?`),
      icon: isCompleted ? "info" : "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ใช่, นำออกจากคิว" : "Yes, remove",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
      reverseButtons: true,
    });

    if (result.isConfirmed) {
      setPickLists((prev) =>
        prev.map((o) => (o.orderNo === orderNo ? { ...o, operatorDismissed: true } : o))
      );
      Swal.fire({
        icon: "success",
        title: isThai ? "นำออกจากคิวสำเร็จ" : "Removed successfully",
        text: isThai ? `ใบสั่ง #${orderNo} ถูกนำออกจากคิวหน้าจ่ายหน้าเครื่องแล้ว` : `Order #${orderNo} removed from queue`,
        timer: 1500,
        showConfirmButton: false,
      });
    }
  };

  // Officer Import Pick List Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importOrderNo, setImportOrderNo] = useState<string>("");
  const [importMachineId, setImportMachineId] = useState<string>("TM01");
  const [rawTableText, setRawTableText] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);

  // Outbound Scanner Modal State
  const [isOutboundScannerOpen, setIsOutboundScannerOpen] = useState<boolean>(false);
  const [isOutboundCameraActive, setIsOutboundCameraActive] = useState<boolean>(false);
  const [outboundBarcodeInput, setOutboundBarcodeInput] = useState<string>("");
  const [outboundScanStatus, setOutboundScanStatus] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const outboundScannerInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus scanner input when Outbound Scanner Modal opens
  useEffect(() => {
    if (isOutboundScannerOpen) {
      setIsOutboundCameraActive(false);
      const timer = setTimeout(() => {
        outboundScannerInputRef.current?.focus();
        outboundScannerInputRef.current?.select();
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [isOutboundScannerOpen]);

  // Active Pick List Order derived
  const activePickListOrder = useMemo(() => {
    if (!selectedOrderNo) return null;
    const found = pickLists.find((o) => o.orderNo === selectedOrderNo);
    if (!found) return null;
    return {
      ...found,
      items: found.items.filter((item) => Boolean(item.batch && /^[A-Za-z0-9]{10}$/.test(item.batch.trim()))),
    };
  }, [pickLists, selectedOrderNo]);

  // Orders filtered for selected outbound machine
  const machineOrders = useMemo(() => {
    return pickLists.filter((o) => o.machineId === selectedOutboundMachine);
  }, [pickLists, selectedOutboundMachine]);

  // Auto select first order if machine changes or if no order is selected
  useEffect(() => {
    if (machineOrders.length > 0) {
      const exists = machineOrders.some((o) => o.orderNo === selectedOrderNo);
      if (!exists) {
        setSelectedOrderNo(machineOrders[0].orderNo);
      }
    } else {
      setSelectedOrderNo(null);
    }
  }, [machineOrders, selectedOutboundMachine, selectedOrderNo]);

  // Fast O(1) lookup map for inbound records by batch
  const inboundByBatchMap = useMemo(() => {
    const map = new Map<string, SlitBarcodeRecord>();
    for (let i = inboundList.length - 1; i >= 0; i--) {
      const r = inboundList[i];
      if (r.batch) {
        map.set(r.batch.trim().toUpperCase(), r);
      }
    }
    return map;
  }, [inboundList]);

  // Helper to match batch location from Inbound storage
  const findInboundLocation = (batchCode: string) => {
    if (!batchCode) return null;
    const match = inboundByBatchMap.get(batchCode.trim().toUpperCase());
    return match ? (match.location || match.storageLocation || null) : null;
  };

  // Handler: Officer submits imported TSV text (Supports single or multi-orders)
  const handleSaveImportedPickList = (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);

    const rawOrderInput = importOrderNo.trim();
    const specifiedOrderNos = rawOrderInput
      ? rawOrderInput.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
      : [];

    if (specifiedOrderNos.length === 0) {
      setImportError(
        isThai
          ? "กรุณาใส่เลขที่ใบสั่งเบิก"
          : "Please enter the Order No."
      );
      return;
    }

    const parsedItems = parseRawTableText(rawTableText);

    if (parsedItems.length === 0) {
      setImportError(
        isThai
          ? "ไม่พบข้อมูล Batch ในข้อความที่วาง กรุณาตรวจสอบตารางและคัดลอกใหม่อีกครั้ง"
          : "No valid Batch items parsed. Please check table formatting and paste again."
      );
      return;
    }

    const machineDef = outboundMachines.find((m) => m.id === importMachineId);
    const mType = machineDef?.type || "pipe";

    const formattedItems: PickListItem[] = parsedItems.map((item, idx) => ({
      ...item,
      id: `PLI-${Date.now()}-${idx}`,
      status: "pending",
    }));

    const createdOrders: PickListOrder[] = [];
    const targetOrderNos = specifiedOrderNos;
    const numOrders = targetOrderNos.length;

    // Check for duplicate order numbers in existing pickLists
    const duplicateOrders = targetOrderNos.filter((ordNo) =>
      pickLists.some((o) => o.orderNo.toLowerCase() === ordNo.toLowerCase())
    );

    if (duplicateOrders.length > 0) {
      setImportError(
        isThai
          ? `ไม่สามารถนำเข้าได้: พบเลขที่ใบสั่งซ้ำในระบบ (${duplicateOrders.join(", ")}) กรุณาระบุเลขที่ใบสั่งที่ไม่ซ้ำกัน`
          : `Import rejected: Duplicate order number(s) found (${duplicateOrders.join(", ")}).`
      );
      return;
    }

    if (numOrders === 1) {
      createdOrders.push({
        orderNo: targetOrderNos[0],
        machineId: importMachineId,
        machineType: mType,
        createdAt: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        createdDate: new Date().toISOString().slice(0, 10),
        status: "pending",
        items: formattedItems,
      });
    } else {
      // Chunk items among specified order numbers
      const chunkSize = Math.ceil(formattedItems.length / numOrders);
      targetOrderNos.forEach((ordNo, idx) => {
        const chunkItems = formattedItems.slice(idx * chunkSize, (idx + 1) * chunkSize);
        if (chunkItems.length > 0) {
          createdOrders.push({
            orderNo: ordNo,
            machineId: importMachineId,
            machineType: mType,
            createdAt: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
            createdDate: new Date().toISOString().slice(0, 10),
            status: "pending",
            items: chunkItems,
          });
        }
      });
    }

    setPickLists((prev) => [...createdOrders, ...prev]);
    setSelectedOutboundMachine(importMachineId);
    setActiveCategory(mType);
    if (createdOrders.length > 0) {
      setSelectedOrderNo(createdOrders[0].orderNo);
    }
    setIsImportModalOpen(false);
    setRawTableText("");
    setImportOrderNo("");

    if (soundEnabled) playScanSound(true);

    setNotificationToast({
      type: "success",
      message: isThai
        ? `นำเข้าสำเร็จ! เพิ่ม ${createdOrders.length} ใบสั่งเบิก (${formattedItems.length} รายการ Batch) ประจำเครื่อง [${importMachineId}]`
        : `Successfully imported ${createdOrders.length} Pick Lists (${formattedItems.length} items) for Machine [${importMachineId}]`,
    });

    onLogTransaction?.(
      `Imported ${createdOrders.length} Pick Lists for Machine ${importMachineId} (${formattedItems.length} Batches)`,
      createdOrders.map((o) => o.orderNo).join(", "),
      "Completed"
    );
  };

  // Handler: Process Outbound Barcode Scan
  const processOutboundBarcodeScan = (rawCode: string) => {
    const trimmed = cleanBarcode(rawCode);
    if (!trimmed || !activePickListOrder) return;

    // RULE: Check if Batch exists in Stock Balance (Stock คงคลัง) or current Pick List
    const existsInStock =
      stockList.some((item) => item.batch.trim().toUpperCase() === trimmed) ||
      sapMasterMap.has(trimmed) ||
      inboundList.some((i) => i.batch.trim().toUpperCase() === trimmed) ||
      activePickListOrder.items.some((i) => i.batch.trim().toUpperCase() === trimmed);

    if (!existsInStock) {
      if (soundEnabled) playScanSound(false);
      setOutboundScanStatus({
        type: "error",
        message: isThai
          ? `ปฏิเสธ: ไม่พบ Batch [${trimmed}] ใน Stock คงคลัง! ต้องทำการสแกนรับเข้าคลังก่อนสแกนเตรียมเบิก`
          : `Rejected: Batch [${trimmed}] not found in Stock Balance! Must scan inbound first.`,
      });
      setOutboundBarcodeInput("");
      outboundScannerInputRef.current?.focus();
      return;
    }

    // Check if trimmed barcode is in current pick list items
    const matchingItemIndex = activePickListOrder.items.findIndex(
      (item) => item.batch.trim().toUpperCase() === trimmed
    );

    if (matchingItemIndex === -1) {
      if (soundEnabled) playScanSound(false);
      setOutboundScanStatus({
        type: "error",
        message: isThai
          ? `ปฏิเสธ: ไม่พบ Batch [${trimmed}] ในใบสั่งเบิก [${activePickListOrder.orderNo}]`
          : `Rejected: Batch [${trimmed}] not found in Pick List [${activePickListOrder.orderNo}]`,
      });
      setOutboundBarcodeInput("");
      outboundScannerInputRef.current?.focus();
      return;
    }

    const matchedItem = activePickListOrder.items[matchingItemIndex];

    if (matchedItem.status === "verified") {
      if (soundEnabled) playScanSound(false);
      setOutboundScanStatus({
        type: "info",
        message: isThai
          ? `แจ้งเตือน: Batch [${trimmed}] สแกนสำเร็จไปแล้วก่อนหน้านี้`
          : `Notice: Batch [${trimmed}] has already been verified in this order.`,
      });
      setOutboundBarcodeInput("");
      outboundScannerInputRef.current?.focus();
      return;
    }

    // Mark item as verified safely across all items in the order
    const nowTime = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const updatedActiveItems = activePickListOrder.items.map((itm, idx) =>
      idx === matchingItemIndex
        ? { ...itm, status: "verified" as const, scannedAt: nowTime, machineIssued: false, machineIssuedAt: undefined }
        : itm
    );
    const verifiedCountNow = updatedActiveItems.filter((i) => i.status === "verified").length;

    setPickLists((prev) =>
      prev.map((o) => {
        if (o.orderNo !== activePickListOrder.orderNo) return o;
        const nextItems = o.items.map((itm) =>
          itm.batch.trim().toUpperCase() === trimmed
            ? { ...itm, status: "verified" as const, scannedAt: nowTime, machineIssued: false, machineIssuedAt: undefined }
            : itm
        );
        const validNextItems = nextItems.filter((itm) =>
          Boolean(itm.batch && /^[A-Za-z0-9]{10}$/.test(itm.batch.trim()))
        );
        const checkPool = validNextItems.length > 0 ? validNextItems : nextItems;
        const isAllVerified = checkPool.length > 0 && checkPool.every((itm) => itm.status === "verified");
        return {
          ...o,
          status: isAllVerified ? ("completed" as const) : ("in_progress" as const),
          items: nextItems,
        };
      })
    );

    if (soundEnabled) playScanSound(true);

    setOutboundScanStatus({
      type: "success",
      message: isThai
        ? `สแกนสำเร็จ: Batch [${trimmed}] ตรวจสอบถูกต้อง (${verifiedCountNow}/${updatedActiveItems.length})`
        : `Scan Success: Batch [${trimmed}] verified (${verifiedCountNow}/${updatedActiveItems.length})`,
    });

    onLogTransaction?.(
      `Outbound Scan Verified: Batch ${trimmed} for Pick List ${activePickListOrder.orderNo} (Machine: ${activePickListOrder.machineId})`,
      trimmed,
      "In-Progress"
    );

    setOutboundBarcodeInput("");
    outboundScannerInputRef.current?.focus();
  };

  // Handler: Save Draft & In-Progress (Inspector saves incomplete scan state)
  const handleSaveOutboundDraft = (targetOrderNo?: string) => {
    const oNo = targetOrderNo || selectedOrderNo;
    const targetOrder = pickLists.find((o) => o.orderNo === oNo);
    if (!targetOrder) return;

    setPickLists((prev) =>
      prev.map((o) =>
        o.orderNo === targetOrder.orderNo
          ? { ...o, status: "in_progress" }
          : o
      )
    );

    const validItems = targetOrder.items.filter((i) => Boolean(i.batch && i.batch.trim().length > 0));
    const verifiedCount = validItems.filter((i) => i.status === "verified").length;

    setNotificationToast({
      type: "success",
      message: isThai
        ? `บันทึกไว้ก่อน: ใบสั่ง [${targetOrder.orderNo}] สถานะ "กำลังเตรียม" (เตรียมแล้ว ${verifiedCount}/${validItems.length} รายการ)`
        : `Saved Draft: Order [${targetOrder.orderNo}] status "In-Progress" (${verifiedCount}/${validItems.length} verified)`,
    });

    onLogTransaction?.(
      `Outbound Draft Saved: Pick List ${targetOrder.orderNo} (Machine: ${targetOrder.machineId}, ${verifiedCount}/${validItems.length} verified)`,
      targetOrder.orderNo,
      "In-Progress"
    );
  };

  // Handler: Final Confirm Outbound
  const handleConfirmOutboundFinal = (targetOrderNo?: string) => {
    const oNo = targetOrderNo || selectedOrderNo;
    const targetOrder = pickLists.find((o) => o.orderNo === oNo);
    if (!targetOrder) return;

    const validItems = targetOrder.items.filter((i) => Boolean(i.batch && i.batch.trim().length > 0));
    const verifiedItems = validItems.filter((i) => i.status === "verified");

    if (verifiedItems.length === 0) {
      if (soundEnabled) playScanSound(false);
      setNotificationToast({
        type: "success",
        message: isThai
          ? "ยังไม่มีรายการสแกนเบิกสำเร็จ กรุณายิงสแกนบาร์โค้ด Batch อย่างน้อย 1 รายการ"
          : "No verified items. Please scan at least 1 Batch barcode.",
      });
      return;
    }

    const nowStr = new Date().toLocaleString(isThai ? "th-TH" : "en-GB");

    // Update inboundList records with order reference while preserving warehouse basket location until จ่ายหน้าเครื่อง
    setInboundList((prevInbound) => {
      let updated = [...prevInbound];
      verifiedItems.forEach((item) => {
        const bKey = item.batch.trim().toUpperCase();
        const matchedSap = sapMasterMap.get(bKey);
        const idx = updated.findIndex((r) => r.batch.trim().toUpperCase() === bKey);
        if (idx !== -1) {
          const existingLoc = updated[idx].location || updated[idx].storageLocation || "-";
          const updateData: Partial<SlitBarcodeRecord> = {
            orderNo: targetOrder.orderNo,
            location: existingLoc,
            storageLocation: existingLoc,
            scanTimestamp: nowStr,
            conditionText: `เตรียมเบิกสำหรับเครื่อง ${targetOrder.machineId} (ใบสั่ง #${targetOrder.orderNo})`,
            ...(matchedSap ? {
              hasSapData: true,
              certThickness: matchedSap.certThickness,
              width: matchedSap.width,
              weightKg: matchedSap.weightKg,
              unrestricted: matchedSap.unrestricted,
              grade: matchedSap.grade,
              manufacturer: matchedSap.manufacturer,
              description: matchedSap.description,
              salesDoc: matchedSap.salesDoc,
              materialNo: matchedSap.materialNo,
              targetThickness: matchedSap.targetThickness,
              qualityClass: matchedSap.qualityClass,
              coilNo: matchedSap.coilNo,
            } : {})
          };
          updated[idx] = mergeSlitBarcodeRecords(updated[idx], updateData, sapMasterMap);
        }
      });
      return updated;
    });

    setPickLists((prev) =>
      prev.map((o) =>
        o.orderNo === targetOrder.orderNo
          ? { ...o, status: "completed" }
          : o
      )
    );

    setNotificationToast({
      type: "success",
      message: isThai
        ? `ยืนยันการเตรียมเบิกสำเร็จ! ใบสั่ง [${targetOrder.orderNo}] จำนวน ${verifiedItems.length} รายการ พร้อมสำหรับจ่ายหน้าเครื่อง [${targetOrder.machineId}]`
        : `Confirmed Outbound Prep! Pick List [${targetOrder.orderNo}] with ${verifiedItems.length} items ready for [${targetOrder.machineId}]`,
    });

    onLogTransaction?.(
      `Confirmed Outbound Prep: Pick List ${targetOrder.orderNo} (Machine ${targetOrder.machineId}, ${verifiedItems.length} Batches)`,
      targetOrder.orderNo,
      "Completed"
    );
  };

  // Handler: Delete Pick List Order Confirmation State & Handler
  const [deleteModalOrderNo, setDeleteModalOrderNo] = useState<string | null>(null);

  const handleConfirmDeleteOrder = () => {
    if (!deleteModalOrderNo) return;
    const ordNo = deleteModalOrderNo;
    setPickLists((prev) => prev.filter((o) => o.orderNo !== ordNo));
    if (selectedOrderNo === ordNo) {
      setSelectedOrderNo(null);
    }
    setDeleteModalOrderNo(null);

    if (soundEnabled) playScanSound(true);

    setNotificationToast({
      type: "success",
      message: isThai
        ? `ลบใบสั่งเบิก [${ordNo}] เรียบร้อยแล้ว`
        : `Successfully deleted Pick List Order [${ordNo}]`,
    });

    onLogTransaction?.(
      `Deleted Pick List Order ${ordNo}`,
      ordNo,
      "Completed"
    );
  };

  // Barcode scanner input state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scanStatus, setScanStatus] = useState<{
    type: "success" | "error";
    message: string;
    batch?: string;
  } | null>(null);

  // Search keyword in current table
  const [searchKeyword, setSearchKeyword] = useState("");

  // Inspect detail modal
  const [selectedRecord, setSelectedRecord] = useState<SlitBarcodeRecord | null>(null);

  // Scanner input ref for autofocus
  const modalScannerInputRef = useRef<HTMLInputElement>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(true);

  // Auto-focus barcode input when Batch Scanner Modal opens
  useEffect(() => {
    if (isScannerModalOpen) {
      setIsCameraActive(true);
      const timer = setTimeout(() => {
        modalScannerInputRef.current?.focus();
        modalScannerInputRef.current?.select();
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [isScannerModalOpen]);

  // Auto-focus location input when Location Scanner Modal opens
  useEffect(() => {
    if (isLocationModalOpen) {
      const timer = setTimeout(() => {
        locationInputRef.current?.focus();
        locationInputRef.current?.select();
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [isLocationModalOpen]);

  // Checkbox selection in scanner modal for deleting mistakes from current round
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);

  // Lock state when cumulative width in inbound scanner exceeds or reaches 2.00 meters (2,000 mm)
  const [isInboundWidthLimitLocked, setIsInboundWidthLimitLocked] = useState<boolean>(false);

  // Helper to extract coil width in millimeters (consistent with SpaceManagementView)
  const getBatchWidthMm = (batchCode: string, recordWidth?: string): number => {
    const cleanBatch = batchCode.trim().toUpperCase();
    const sapItem = sapMasterMap.get(cleanBatch);
    const widthSource =
      recordWidth ||
      sapItem?.width ||
      inboundByBatchMap.get(cleanBatch)?.width ||
      "";
    if (widthSource && widthSource !== "-") {
      const m = String(widthSource).match(/[\d.]+/);
      if (m) {
        const val = parseFloat(m[0]);
        if (!isNaN(val) && val > 0) {
          return val < 10 ? val * 1000 : val;
        }
      }
    }
    return 150;
  };

  // Current session weight & cumulative width calculations
  const currentSessionWeightKg = useMemo(() => {
    return currentSessionBatches.reduce((sum, item) => sum + (item.weightKg || 0), 0);
  }, [currentSessionBatches]);

  const currentSessionWidthMm = useMemo(() => {
    return currentSessionBatches.reduce(
      (sum, item) => sum + getBatchWidthMm(item.batch, item.width),
      0
    );
  }, [currentSessionBatches, sapMasterMap, inboundByBatchMap]);

  const currentSessionWidthMeters = (currentSessionWidthMm / 1000).toFixed(2);

  const currentSessionWeightTon = (currentSessionWeightKg / 1000).toFixed(3);

  // AGENT.MD Compliance: Collapsible Section (Default: Collapsed)
  const [isTableCollapsed, setIsTableCollapsed] = useState<boolean>(true);

  // AGENT.MD Compliance: Pagination (Page Size default 10, page number state)
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Fast O(1) lookup map from batch to orderNo in pickLists
  const pickListOrderByBatchMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const pl of pickLists) {
      if (pl.items) {
        for (const item of pl.items) {
          if (item.batch) {
            const bKey = item.batch.trim().toUpperCase();
            if (!map.has(bKey)) {
              map.set(bKey, pl.orderNo);
            }
          }
        }
      }
    }
    return map;
  }, [pickLists]);

  // Movement history consolidated & deduplicated list (Merge / Upsert)
  const movementHistoryList = useMemo(() => {
    const combined = [...inboundList, ...outboundList];
    const map = new Map<string, SlitBarcodeRecord>();

    for (const record of combined) {
      if (!record.batch) continue;
      const bKey = record.batch.trim().toUpperCase();

      // Find orderNo from pickLists if not present
      let orderNo = record.orderNo;
      if (!orderNo) {
        orderNo = pickListOrderByBatchMap.get(bKey);
      }

      const recordWithOrder: SlitBarcodeRecord = orderNo && orderNo !== record.orderNo
        ? { ...record, orderNo }
        : record;

      if (map.has(bKey)) {
        const existing = map.get(bKey)!;
        const merged = mergeSlitBarcodeRecords(existing, recordWithOrder, sapMasterMap);
        map.set(bKey, merged);
      } else {
        const sapMatch = sapMasterMap.get(bKey);
        if (sapMatch && (!recordWithOrder.hasSapData || !recordWithOrder.certThickness || recordWithOrder.certThickness === "รอข้อมูล SAP")) {
          map.set(bKey, mergeSlitBarcodeRecords(recordWithOrder, {}, sapMasterMap));
        } else {
          map.set(bKey, recordWithOrder);
        }
      }
    }

    return Array.from(map.values());
  }, [inboundList, outboundList, sapMasterMap, pickListOrderByBatchMap]);

  // Helper to check if a record represents an outbound movement
  const isOutboundItem = (row: SlitBarcodeRecord) => {
    if (row.mode === "outbound") return true;
    if (row.orderNo && row.orderNo !== "-") return true;
    if (!row.location) return false;
    const loc = row.location.trim();
    const upperLoc = loc.toUpperCase();
    if (loc.startsWith("เบิก") || loc.includes("เบิก")) return true;
    if (["CF", "ML", "ZF", "เบิกTM01"].includes(upperLoc)) return true;
    return false;
  };

  // Helper to retrieve Order No. for Movement History table
  const getOrderNoForRecord = (row: SlitBarcodeRecord) => {
    if (row.orderNo && row.orderNo !== "-") return row.orderNo;

    if (row.batch) {
      const cleanB = row.batch.trim().toUpperCase();
      const matchedOrder = pickListOrderByBatchMap.get(cleanB);
      if (matchedOrder) return matchedOrder;
    }

    if (!isOutboundItem(row)) return "-";

    if (row.machine) {
      const pl = pickLists.find((p) => p.machineId === row.machine);
      if (pl) return pl.orderNo;
    }
    return "-";
  };

  // Pre-indexed map of movement history records by batch for O(1) lookup
  const movementHistoryByBatchMap = useMemo(() => {
    const map = new Map<string, SlitBarcodeRecord[]>();
    for (const r of movementHistoryList) {
      if (!r.batch) continue;
      const bKey = r.batch.trim().toUpperCase();
      const arr = map.get(bKey);
      if (arr) {
        arr.push(r);
      } else {
        map.set(bKey, [r]);
      }
    }
    return map;
  }, [movementHistoryList]);

  // Helper to retrieve Previous Location from the latest layout relocation
  const getPreviousLocationForRecord = (row: SlitBarcodeRecord): string => {
    if (row.previousLocation && row.previousLocation.trim()) {
      return row.previousLocation.trim();
    }
    if (row.conditionText && row.conditionText.includes("ย้าย Layout จาก")) {
      const match = row.conditionText.match(/ย้าย Layout จาก\s*([^\s➔]+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    // Fallback: Check if there is an earlier inbound or outbound record in history for the same batch with a different location
    if (row.batch) {
      const cleanB = row.batch.trim().toUpperCase();
      const allRecordsForBatch = movementHistoryByBatchMap.get(cleanB);
      if (allRecordsForBatch && allRecordsForBatch.length > 0) {
        for (let i = allRecordsForBatch.length - 1; i >= 0; i--) {
          if (allRecordsForBatch[i].id === row.id) continue;
          const pastLoc = allRecordsForBatch[i].location;
          if (pastLoc && pastLoc !== row.location && !pastLoc.startsWith("เบิก")) {
            return pastLoc;
          }
        }
      }
    }
    return "-";
  };

  // Stock Balance States & Derived Lists
  const [stockSearchKeyword, setStockSearchKeyword] = useState<string>("");
  const [stockStatusFilter, setStockStatusFilter] = useState<"all" | "ready" | "preparing" | "pending_location">("all");
  const [stockPageSize, setStockPageSize] = useState<number>(10);
  const [stockCurrentPage, setStockCurrentPage] = useState<number>(1);

  const stockList = useMemo(() => {
    // Set of batches that have been dispatched to machines (Location contains "เบิก" in Movement History or lists)
    const dispatchedBatchSet = new Set<string>();
    const outboundBatchOrderSet = new Set<string>();

    movementHistoryList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      const loc = (r.location || "").trim();
      const upperLoc = loc.toUpperCase();
      if (loc.includes("เบิก") || loc.startsWith("เบิก") || ["CF", "ML", "ZF", "เบิกTM01"].includes(upperLoc)) {
        dispatchedBatchSet.add(bKey);
      }
    });

    inboundList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      const loc = (r.location || "").trim();
      const upperLoc = loc.toUpperCase();
      if (loc.includes("เบิก") || loc.startsWith("เบิก") || ["CF", "ML", "ZF", "เบิกTM01"].includes(upperLoc)) {
        dispatchedBatchSet.add(bKey);
      }
    });

    outboundList.forEach((r) => {
      if (!r.batch) return;
      const bKey = r.batch.trim().toUpperCase();
      if (r.orderNo) {
        outboundBatchOrderSet.add(`${bKey}::${r.orderNo}`);
      }
      const loc = (r.location || "").trim();
      const upperLoc = loc.toUpperCase();
      if (loc.includes("เบิก") || loc.startsWith("เบิก") || ["CF", "ML", "ZF", "เบิกTM01"].includes(upperLoc)) {
        dispatchedBatchSet.add(bKey);
      }
    });

    // 1. Gather all batches that have been scanned as prepared in pick lists (item status is verified and not yet dispatched)
    const preparedBatchMap = new Map<string, { orderNo: string; machineId: string }>();
    pickLists.forEach((pl) => {
      (pl.items || []).forEach((item) => {
        if (item.batch && item.status === "verified") {
          const bKey = item.batch.trim().toUpperCase();
          // Check if already dispatched to machine in outboundList or movement history
          const isDispatched =
            dispatchedBatchSet.has(bKey) ||
            outboundBatchOrderSet.has(`${bKey}::${pl.orderNo}`);
          if (!isDispatched) {
            preparedBatchMap.set(bKey, {
              orderNo: pl.orderNo,
              machineId: pl.machineId,
            });
          }
        }
      });
    });

    // Map of active shopfloor inbound scans by Batch (excluding dispatched/outbound items)
    const activeInboundMap = new Map<string, SlitBarcodeRecord>();
    inboundList.forEach((item) => {
      if (!item.location) return;
      const loc = item.location.trim();
      const upperLoc = loc.toUpperCase();
      if (loc.startsWith("เบิก") || loc.includes("เบิก")) return;
      if (["CF", "ML", "ZF", "เบิกTM01"].includes(upperLoc)) return;

      activeInboundMap.set(item.batch.trim().toUpperCase(), item);
    });

    const resultList: (SlitBarcodeRecord & {
      stockStatus: "ready" | "preparing" | "pending_location";
      preparedOrderNo?: string;
      preparedMachineId?: string;
    })[] = [];
    const processedBatches = new Set<string>();

    // 1. Include ALL SAP Master Data records uploaded by Officer (excluding dispatched batches)
    sapMasterMap.forEach((sapItem, batchKey) => {
      const cleanKey = batchKey.trim().toUpperCase();
      processedBatches.add(cleanKey);

      // Exclude if batch is already dispatched to a machine
      if (dispatchedBatchSet.has(cleanKey)) {
        return;
      }

      const matchedInbound = activeInboundMap.get(cleanKey);
      const prepInfo = preparedBatchMap.get(cleanKey);

      const locVal = (matchedInbound?.location || "").trim();
      const isPendingLoc = !locVal || locVal === "รอระบุ" || locVal === "-" || locVal.includes("รอสแกน");
      const currentStatus: "ready" | "preparing" | "pending_location" = prepInfo
        ? "preparing"
        : isPendingLoc
        ? "pending_location"
        : "ready";

      resultList.push({
        id: matchedInbound?.id || `SAP-STOCK-${cleanKey}`,
        mode: "inbound",
        scanTimestamp: matchedInbound?.scanTimestamp || "-",
        batch: sapItem.batch,
        machine: matchedInbound?.machine || "-",
        location: matchedInbound?.location || "-",
        hasSapData: true,
        salesDoc: sapItem.salesDoc,
        materialNo: sapItem.materialNo,
        certThickness: sapItem.certThickness,
        storageLocation: sapItem.storageLocation || matchedInbound?.location || "-",
        targetThickness: sapItem.targetThickness,
        width: sapItem.width,
        weightKg: sanitizeWeightKg(sapItem.weightKg, sapItem.unrestricted),
        unrestricted: `${sanitizeWeightKg(sapItem.weightKg, sapItem.unrestricted).toLocaleString()} kg`,
        qualityClass: sapItem.qualityClass,
        grade: sapItem.grade,
        manufacturer: sapItem.manufacturer,
        description: sapItem.description,
        coilNo: sapItem.coilNo,
        conditionText: prepInfo
          ? `กำลังเตรียมเบิกเข้าเครื่อง ${prepInfo.machineId} (ใบสั่ง #${prepInfo.orderNo})`
          : matchedInbound
          ? (matchedInbound.conditionText || "รับเข้าแล้วพร้อมใช้งาน")
          : "รอพนักงานยิงรับเข้า Location หน้างาน",
        stockStatus: currentStatus,
        preparedOrderNo: prepInfo?.orderNo,
        preparedMachineId: prepInfo?.machineId,
      });
    });

    // 2. Include Shopfloor Inbound scans that are NOT YET in SAP Master Data
    activeInboundMap.forEach((inboundItem, batchKey) => {
      const cleanKey = batchKey.trim().toUpperCase();
      if (!processedBatches.has(cleanKey)) {
        processedBatches.add(cleanKey);

        if (dispatchedBatchSet.has(cleanKey)) {
          return;
        }

        const prepInfo = preparedBatchMap.get(cleanKey);
        const locVal = (inboundItem.location || "").trim();
        const isPendingLoc = !locVal || locVal === "รอระบุ" || locVal === "-" || locVal.includes("รอสแกน");
        const currentStatus: "ready" | "preparing" | "pending_location" = prepInfo
          ? "preparing"
          : isPendingLoc
          ? "pending_location"
          : "ready";

        resultList.push({
          ...inboundItem,
          hasSapData: false,
          stockStatus: currentStatus,
          preparedOrderNo: prepInfo?.orderNo,
          preparedMachineId: prepInfo?.machineId,
          conditionText: prepInfo
            ? `กำลังเตรียมเบิกเข้าเครื่อง ${prepInfo.machineId} (ใบสั่ง #${prepInfo.orderNo})`
            : inboundItem.conditionText,
        });
      }
    });

    // 3. Include prepared pick list batches that might not be in sapMasterMap or activeInboundMap yet
    preparedBatchMap.forEach((prepInfo, batchKey) => {
      const cleanKey = batchKey.trim().toUpperCase();
      if (!processedBatches.has(cleanKey)) {
        processedBatches.add(cleanKey);

        if (dispatchedBatchSet.has(cleanKey)) {
          return;
        }

        let foundItem: PickListItem | undefined;
        for (const pl of pickLists) {
          foundItem = (pl.items || []).find(
            (i) => i.batch && i.batch.trim().toUpperCase() === cleanKey
          );
          if (foundItem) break;
        }

        resultList.push({
          id: `PREP-PL-${cleanKey}`,
          mode: "inbound",
          scanTimestamp: foundItem?.scannedAt || "-",
          batch: cleanKey,
          machine: prepInfo.machineId || "-",
          location: foundItem?.storageLocation || "รอระบุ",
          hasSapData: false,
          materialNo: foundItem?.material || "",
          certThickness: "-",
          storageLocation: foundItem?.storageLocation || "รอระบุ",
          targetThickness: "-",
          width: "-",
          weightKg: foundItem?.reqQty || 0,
          unrestricted: `${(foundItem?.reqQty || 0).toLocaleString()} kg`,
          qualityClass: "-",
          grade: "-",
          manufacturer: "-",
          description: foundItem?.description || "",
          conditionText: `กำลังเตรียมเบิกเข้าเครื่อง ${prepInfo.machineId} (ใบสั่ง #${prepInfo.orderNo})`,
          stockStatus: "preparing",
          preparedOrderNo: prepInfo.orderNo,
          preparedMachineId: prepInfo.machineId,
        });
      }
    });

    return resultList;
  }, [inboundList, sapMasterMap, pickLists, outboundList, movementHistoryList]);

  const filteredStockList = useMemo(() => {
    return stockList.filter((item) => {
      const locStr = (item.location || "").trim();
      const isPendingLocationItem =
        item.stockStatus === "pending_location" ||
        !locStr ||
        locStr === "-" ||
        locStr === "รอระบุ" ||
        locStr.includes("รอสแกน");

      if (stockStatusFilter === "ready" && (item.stockStatus !== "ready" || isPendingLocationItem)) return false;
      if (stockStatusFilter === "preparing" && item.stockStatus !== "preparing") return false;
      if (stockStatusFilter === "pending_location" && !isPendingLocationItem) return false;

      if (stockSearchKeyword.trim()) {
        const q = stockSearchKeyword.toLowerCase();
        const matchBatch = item.batch.toLowerCase().includes(q);
        const matchLoc =
          locStr.toLowerCase().includes(q) ||
          (isPendingLocationItem && "รอสแกน location".includes(q));
        const matchGrade = (item.grade || "").toLowerCase().includes(q);
        const matchMat = (item.materialNo || "").toLowerCase().includes(q);
        const matchDesc = (item.description || "").toLowerCase().includes(q);
        const matchOrder = (item.preparedOrderNo || "").toLowerCase().includes(q);
        return matchBatch || matchLoc || matchGrade || matchMat || matchDesc || matchOrder;
      }

      return true;
    });
  }, [stockList, stockStatusFilter, stockSearchKeyword]);

  const stockTotalWeightKg = useMemo(() => {
    return filteredStockList.reduce((sum, item) => sum + (sanitizeWeightKg(item.weightKg, item.unrestricted) || 0), 0);
  }, [filteredStockList]);

  const stockTotalWeightTon = (stockTotalWeightKg / 1000).toFixed(3);
  const stockTotalPages = Math.max(1, Math.ceil(filteredStockList.length / stockPageSize));
  const validStockCurrentPage = Math.min(Math.max(1, stockCurrentPage), stockTotalPages);
  const stockStartIndex = (validStockCurrentPage - 1) * stockPageSize;
  const stockEndIndex = Math.min(stockStartIndex + stockPageSize, filteredStockList.length);

  const paginatedStockList = useMemo(() => {
    return filteredStockList.slice(stockStartIndex, stockEndIndex);
  }, [filteredStockList, stockStartIndex, stockEndIndex]);

  const handleExportStockBalanceExcel = useCallback(() => {
    if (filteredStockList.length === 0) {
      Swal.fire({
        icon: "info",
        title: isThai ? "ไม่มีข้อมูลสำหรับส่งออก" : "No Data to Export",
        text: isThai ? "ไม่พบรายการ Stock คงคลังตามเงื่อนไขปัจจุบัน" : "No stock balance items found to export.",
        confirmButtonColor: "#087eaf",
      });
      return;
    }

    const headers = [
      "ลำดับ",
      "ประตู",
      "กอง",
      "Plan",
      "Sloc",
      "BUNDLE",
      "Material",
      "Material Description",
      "Batch",
      "หนา",
      "กว้าง",
      "ยาว",
      "Grade",
      "QTY",
      "น้ำหนัก",
      "S/O",
      "Item",
      "Customer Name",
      "Text",
    ];

    const rows = filteredStockList.map((row, idx) => {
      const rawLoc = (row.location || "").trim();
      const isValidLoc =
        rawLoc !== "" &&
        rawLoc !== "-" &&
        rawLoc !== "รอระบุ" &&
        !rawLoc.includes("รอสแกน");

      const rawStorageLoc = (row.storageLocation || "").trim();
      const isValidStorageLoc =
        rawStorageLoc !== "" &&
        rawStorageLoc !== "-" &&
        rawStorageLoc !== "รอระบุ" &&
        !rawStorageLoc.includes("รอสแกน");

      let gateVal = "";
      let pileVal = "";
      if (isValidLoc) {
        if (rawLoc.includes("/")) {
          const [gPart, pPart] = rawLoc.split("/", 2);
          gateVal = (gPart || "").trim();
          pileVal = (pPart || "").trim().replace(/^O(?=[A-Z])/i, "");
        } else {
          pileVal = rawLoc;
        }
      }

      const slocVal = isValidLoc ? rawLoc : isValidStorageLoc ? rawStorageLoc : "";
      const materialVal = row.materialNo && row.materialNo !== "-" ? row.materialNo.trim() : "";
      const descVal =
        row.description &&
        row.description !== "-" &&
        !row.description.includes("รอระบบ SAP") &&
        !row.description.includes("รอข้อมูล SAP")
          ? row.description.trim()
          : "";
      const batchVal = row.batch && row.batch !== "-" ? row.batch.trim() : "";

      const rawThick = (row.certThickness && row.certThickness !== "-" ? row.certThickness : row.targetThickness || "")
        .replace(/mm/gi, "")
        .trim();
      const thickVal =
        rawThick && rawThick !== "-"
          ? !isNaN(Number(rawThick))
            ? Number(Number(rawThick).toFixed(2))
            : rawThick
          : "";

      const rawWidth = (row.width || "").replace(/mm/gi, "").trim();
      const widthVal =
        rawWidth && rawWidth !== "-"
          ? !isNaN(Number(rawWidth))
            ? Number(Number(rawWidth).toFixed(2))
            : rawWidth
          : "";

      const gradeVal = row.grade && row.grade !== "-" ? row.grade.trim() : "";
      const weightNum = sanitizeWeightKg(row.weightKg, row.unrestricted);
      const weightVal: number | string = weightNum > 0 ? weightNum : "";
      const soVal =
        row.salesDoc && row.salesDoc !== "-" && row.salesDoc !== "0"
          ? row.salesDoc.trim()
          : "";

      return [
        idx + 1,
        gateVal,
        pileVal,
        "1200",
        slocVal,
        "",
        materialVal,
        descVal,
        batchVal,
        thickVal,
        widthVal,
        "",
        gradeVal,
        "",
        weightVal,
        soVal,
        "",
        "",
        "",
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet["!cols"] = [
      { wch: 8 },
      { wch: 8 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 18 },
      { wch: 36 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 10 },
      { wch: 20 },
      { wch: 20 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock_Balance");
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Stock_Balance_${dateStr}.xlsx`);
  }, [filteredStockList, isThai]);

  // Relocate Layout States
  const [relocateBarcodeInput, setRelocateBarcodeInput] = useState<string>("");
  const [relocateBatchList, setRelocateBatchList] = useState<RelocateBatchItem[]>([]);
  const [destinationLayout, setDestinationLayout] = useState<string>("");
  const relocateInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus barcode input when in relocate_layout mode
  useEffect(() => {
    if (activeMode === "relocate_layout") {
      const timer = setTimeout(() => {
        relocateInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeMode]);

  // Handler: Scan & Add Batch to Relocate Accumulation Table
  const handleScanRelocateBatch = (rawCode: string) => {
    const trimmed = cleanBarcode(rawCode);
    if (!trimmed) return;

    // Check if Batch exists in Movement History, Stock Balance, Inbound List, or SAP Master Data
    const matches = movementHistoryList.filter(
      (item) => item.batch.trim().toUpperCase() === trimmed
    );
    const stockMatch = stockList.find(
      (item) => item.batch.trim().toUpperCase() === trimmed
    );
    const inboundMatch = inboundList.find(
      (item) => item.batch.trim().toUpperCase() === trimmed
    );
    const sapMatch = sapMasterMap.get(trimmed);

    if (matches.length === 0 && !stockMatch && !inboundMatch && !sapMatch) {
      if (soundEnabled) playScanSound(false);
      Swal.fire({
        icon: "warning",
        title: isThai ? "ไม่พบข้อมูล Batch ในระบบ" : "Batch Not Found",
        text: isThai
          ? `ไม่พบรหัส Batch [${trimmed}] ในสต็อกคงคลังหรือประวัติการเคลื่อนไหวของระบบ`
          : `Batch [${trimmed}] was not found in Stock or Movement History.`,
        confirmButtonColor: "#087eaf",
        confirmButtonText: isThai ? "ตกลง" : "OK",
      });
      setRelocateBarcodeInput("");
      relocateInputRef.current?.focus();
      return;
    }

    // Check duplicate in current accumulation table
    const isDuplicate = relocateBatchList.some(
      (item) => item.batch.trim().toUpperCase() === trimmed
    );

    if (isDuplicate) {
      if (soundEnabled) playScanSound(false);
      Swal.fire({
        icon: "info",
        title: isThai ? "รายการซ้ำในตารางสะสม" : "Duplicate Batch",
        text: isThai
          ? `รหัส Batch [${trimmed}] ถูกสแกนเพิ่มในตารางสะสมการย้ายแล้ว`
          : `Batch [${trimmed}] is already in the relocation list.`,
        confirmButtonColor: "#087eaf",
        confirmButtonText: isThai ? "ตกลง" : "OK",
      });
      setRelocateBarcodeInput("");
      relocateInputRef.current?.focus();
      return;
    }

    // Reference data: Latest Movement Record or Stock Record for this Batch
    const latestRecord = matches[matches.length - 1] || inboundMatch || stockMatch;
    const currentSourceLayout =
      latestRecord?.location ||
      latestRecord?.storageLocation ||
      sapMatch?.storageLocation ||
      "-";

    const newItem: RelocateBatchItem = {
      id: `RELOC-${Date.now()}-${trimmed}`,
      batch: trimmed,
      materialName:
        latestRecord?.description ||
        sapMatch?.description ||
        "-",
      grade: latestRecord?.grade || sapMatch?.grade || "-",
      thicknessWidth: `${formatDimension2Decimals(latestRecord?.certThickness || sapMatch?.certThickness, "-")} x ${formatDimension2Decimals(
        latestRecord?.width || sapMatch?.width,
        "-"
      )}`.trim(),
      weightKg: latestRecord?.weightKg || sapMatch?.weightKg || 0,
      sourceLayout: currentSourceLayout,
      status: isThai ? "รอย้าย Layout" : "Pending Relocation",
      scannedTimestamp: new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setRelocateBatchList((prev) => [...prev, newItem]);
    setRelocateBarcodeInput("");
    if (soundEnabled) playScanSound(true);
    setNotificationToast({
      type: "success",
      message: isThai
        ? `เพิ่ม Batch [${trimmed}] (ต้นทาง ${currentSourceLayout}) เข้าตารางสะสมย้าย Layout สำเร็จ`
        : `Added Batch [${trimmed}] (From ${currentSourceLayout}) to relocation list`,
    });
    relocateInputRef.current?.focus();
  };

  const handleRemoveRelocateItem = (id: string) => {
    setRelocateBatchList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleConfirmRelocation = () => {
    if (relocateBatchList.length === 0 || !destinationLayout.trim()) return;

    const destLayout = destinationLayout.trim().toUpperCase();
    const uniqueSourceLayouts = Array.from(
      new Set(relocateBatchList.map((i) => i.sourceLayout))
    ).join(", ");

    Swal.fire({
      title: isThai ? "ยืนยันการย้าย Layout?" : "Confirm Layout Relocation?",
      html: `
        <div style="text-align: left; font-size: 13px; line-height: 1.6;">
          <p style="margin-bottom: 8px; color: #334155; font-weight: 500;">
            ${
              isThai
                ? "คุณต้องการยืนยันการย้ายตำแหน่งจัดเก็บวัตถุดิบไปยัง Layout ปลายทางหรือไม่?"
                : "Do you want to confirm relocating these materials to the destination layout?"
            }
          </p>
          <div style="background-color: #f1f5f9; padding: 12px; border-radius: 10px; font-family: 'Noto Sans Thai', sans-serif; font-variant-numeric: tabular-nums;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">${isThai ? "จำนวน Batch ทั้งหมด:" : "Total Batches:"}</span>
              <span style="font-weight: bold; color: #d97706;">${relocateBatchList.length} ${isThai ? "รายการ" : "items"}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">${isThai ? "Layout ต้นทาง:" : "Source Layout(s):"}</span>
              <span style="font-weight: bold; color: #0284c7;">${uniqueSourceLayouts}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">${isThai ? "Layout ปลายทาง:" : "Destination Layout:"}</span>
              <span style="font-weight: bold; color: #059669;">${destLayout}</span>
            </div>
          </div>
        </div>
      `,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#087eaf",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ยืนยันย้าย Layout" : "Confirm Relocate",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    }).then((result) => {
      if (result.isConfirmed) {
        const timestamp = `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

        setInboundList((prevInbound) => {
          let updated = [...prevInbound];
          relocateBatchList.forEach((relocItem) => {
            const existsIdx = updated.findIndex((r) => r.batch.toUpperCase() === relocItem.batch.toUpperCase());
            const sourceLoc = relocItem.sourceLayout || (existsIdx !== -1 ? updated[existsIdx].location : "");
            if (existsIdx !== -1) {
              const prevLoc = sourceLoc || updated[existsIdx].location;
              updated[existsIdx] = {
                ...updated[existsIdx],
                previousLocation: prevLoc,
                location: destLayout,
                storageLocation: destLayout,
                scanTimestamp: timestamp,
                conditionText: `ย้าย Layout จาก ${relocItem.sourceLayout} ➔ ${destLayout}`,
              };
            } else {
              const record = generateRecordFromBatch(relocItem.batch, "inbound", destLayout);
              record.previousLocation = sourceLoc;
              record.conditionText = `ย้าย Layout จาก ${relocItem.sourceLayout} ➔ ${destLayout}`;
              updated.unshift(record);
            }
          });
          return updated;
        });

        relocateBatchList.forEach((relocItem) => {
          removeCoilByBatch(relocItem.batch);
        });

        relocateBatchList.forEach((relocItem) => {
          onLogTransaction?.(
            `Relocated Batch ${relocItem.batch} from ${relocItem.sourceLayout} to ${destLayout}`,
            relocItem.batch,
            "Completed"
          );
        });

        if (soundEnabled) playScanSound(true);

        Swal.fire({
          icon: "success",
          title: isThai ? "ย้าย Layout สำเร็จ!" : "Relocated Successfully!",
          text: isThai
            ? `บันทึกการย้าย Batch จำนวน ${relocateBatchList.length} รายการ ไปยัง Layout [${destLayout}] เรียบร้อยแล้ว`
            : `Successfully relocated ${relocateBatchList.length} batch(es) to layout [${destLayout}].`,
          confirmButtonColor: "#087eaf",
          confirmButtonText: isThai ? "ตกลง" : "OK",
        });

        setRelocateBatchList([]);
        setDestinationLayout("");
        setRelocateBarcodeInput("");
      }
    });
  };

  // Return to Warehouse (คืนคลัง) States & Handlers
  const [returnSearchKeyword, setReturnSearchKeyword] = useState<string>("");
  const [returnMachineFilter, setReturnMachineFilter] = useState<string>("all");
  const [returnOrderFilter, setReturnOrderFilter] = useState<string>("all");
  const [returnBarcodeInput, setReturnBarcodeInput] = useState<string>("");
  const [returnSelectedBatchIds, setReturnSelectedBatchIds] = useState<string[]>([]);
  const [customReturnLocations, setCustomReturnLocations] = useState<Record<string, string>>({});
  const [bulkReturnLocation, setBulkReturnLocation] = useState<string>("");
  const [returnPageSize, setReturnPageSize] = useState<number>(10);
  const [returnCurrentPage, setReturnCurrentPage] = useState<number>(1);
  const returnBarcodeInputRef = useRef<HTMLInputElement>(null);

  const [deletedReturnBatchIds, setDeletedReturnBatchIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_DELETED_RETURN_BATCHES);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DELETED_RETURN_BATCHES, JSON.stringify(deletedReturnBatchIds));
    } catch {}
  }, [deletedReturnBatchIds]);

  // Auto-focus barcode input when in return_warehouse mode
  useEffect(() => {
    if (activeMode === "return_warehouse") {
      const timer = setTimeout(() => {
        returnBarcodeInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeMode]);

  // Helper to determine if an item has been scanned and received by staff at "จ่ายหน้าเครื่อง"
  const isItemMachineIssued = useCallback(
    (item: PickListItem): boolean => {
      // Must be prepared at outbound first (status === 'verified') AND explicitly scanned by staff at "จ่ายหน้าเครื่อง"
      if (item.status !== "verified") return false;
      return Boolean(item.machineIssued);
    },
    []
  );

  // Aggregate returnable batches currently at machines (Only display when staff at จ่ายหน้าเครื่อง has scanned)
  const returnableBatches = useMemo<ReturnItemRow[]>(() => {
    const map = new Map<string, ReturnItemRow>();

    // 1. Physically staged coils on machine racks (Placed during จ่ายหน้าเครื่อง)
    const stagedCoils = getAllStagedCoilsWithMachineInfo();
    const stagedCoilBatchSet = new Set(stagedCoils.map((sc) => sc.coil.batch.trim().toUpperCase()));

    // Pre-index returned inbound records, outbound machine-scanned records, and pick list machine-issued items in O(N)
    const returnedInboundTimestampMap = new Map<string, number>();
    let hasAnyReturnedInbound = false;
    inboundList.forEach((ib) => {
      if (ib.batch && ib.conditionText && ib.conditionText.includes("คืนคลัง")) {
        hasAnyReturnedInbound = true;
        const bKey = ib.batch.trim().toUpperCase();
        const ts = new Date(ib.scanTimestamp).getTime();
        const prev = returnedInboundTimestampMap.get(bKey);
        if (prev === undefined || (!isNaN(ts) && ts > prev)) {
          returnedInboundTimestampMap.set(bKey, isNaN(ts) ? 0 : ts);
        }
      }
    });

    const outboundOrderByBatchMap = new Map<string, string>();
    const outboundMachineScannedSet = new Set<string>();
    outboundList.forEach((ob) => {
      if (!ob.batch) return;
      const bKey = ob.batch.trim().toUpperCase();
      if (ob.orderNo && !outboundOrderByBatchMap.has(bKey)) {
        outboundOrderByBatchMap.set(bKey, ob.orderNo);
      }
      if (ob.conditionText && ob.conditionText.includes("รับงานหน้าเครื่อง")) {
        outboundMachineScannedSet.add(bKey);
      }
    });

    const pickListMachineIssuedSet = new Set<string>();
    pickLists.forEach((pl) => {
      (pl.items || []).forEach((item) => {
        if (item.batch && item.machineIssued) {
          pickListMachineIssuedSet.add(item.batch.trim().toUpperCase());
        }
      });
    });

    stagedCoils.forEach((sc) => {
      const bKey = sc.coil.batch.trim().toUpperCase();
      if (!bKey) return;

      if (hasAnyReturnedInbound && returnedInboundTimestampMap.has(bKey)) {
        const retTs = returnedInboundTimestampMap.get(bKey)!;
        const stagedTs = new Date(sc.coil.stagedAt || 0).getTime();
        if (retTs >= (isNaN(stagedTs) ? 0 : stagedTs)) return;
      }

      const matchedSap = sapMasterMap.get(bKey);
      // Default to cart name (e.g. "01 TM 01") or machine code (e.g. "TM 01")
      const defaultLoc = (sc.rackNameTh && sc.rackNameTh !== "-")
        ? sc.rackNameTh
        : (sc.machineCode || sc.machineId);

      const orderNo =
        pickListOrderByBatchMap.get(bKey) ||
        outboundOrderByBatchMap.get(bKey) ||
        "-";

      map.set(bKey, {
        id: `STAGED-${sc.machineId}-${bKey}`,
        batch: bKey,
        machineId: sc.machineId,
        machineCode: sc.machineCode,
        orderNo,
        rackNameTh: sc.rackNameTh,
        rackId: sc.rackId,
        weightKg: sc.coil.weightKg || 0,
        grade: sc.coil.grade || "-",
        spec: sc.coil.spec || (sc.coil.thicknessMm || sc.coil.widthMm ? `${sc.coil.thicknessMm || 0} x ${sc.coil.widthMm || 0}mm` : "-"),
        dispatchedAt: sc.coil.stagedAt || "-",
        defaultLocation: defaultLoc,
        returnLocation: customReturnLocations[bKey] || defaultLoc,
        description: matchedSap?.description || "",
        hasSapData: Boolean(matchedSap),
      });
    });

    // 2. Pick Lists items: แสดงเฉพาะรายการที่พนักงานจ่ายหน้าเครื่องสแกนรับเข้าเครื่องแล้วเท่านั้น
    pickLists.forEach((pl) => {
      (pl.items || []).forEach((item) => {
        if (!item.batch) return;
        const bKey = item.batch.trim().toUpperCase();

        const isIssuedAtMachine =
          Boolean(item.machineIssued) ||
          stagedCoilBatchSet.has(bKey) ||
          outboundMachineScannedSet.has(bKey);

        // เงื่อนไขหลัก: แสดงก็ต่อเมื่อพนักงานจ่ายหน้าเครื่องสแกนแล้วเท่านั้น
        if (!isIssuedAtMachine) return;

        if (map.has(bKey)) {
          const existing = map.get(bKey)!;
          if (existing.orderNo === "-") existing.orderNo = pl.orderNo;
          return;
        }

        if (hasAnyReturnedInbound && returnedInboundTimestampMap.has(bKey)) {
          return;
        }

        const matchedSap = sapMasterMap.get(bKey);
        const mId = pl.machineId || "TM01";
        const mCode = mId.startsWith("TM") ? `TM ${mId.replace("TM", "")}` : mId;
        const defaultLoc = mCode;

        map.set(bKey, {
          id: `PL-${bKey}`,
          batch: bKey,
          machineId: mId,
          machineCode: mCode,
          orderNo: pl.orderNo,
          rackNameTh: "-",
          weightKg: item.reqQty || 0,
          grade: "-",
          spec: item.description || "-",
          dispatchedAt: item.machineIssuedAt || item.scannedAt || pl.createdAt || "-",
          defaultLocation: defaultLoc,
          returnLocation: customReturnLocations[bKey] || defaultLoc,
          description: item.description,
          hasSapData: Boolean(matchedSap),
        });
      });
    });

    // 3. Outbound list records: เฉพาะรายการที่ได้รับการสแกนจ่ายหน้าเครื่องแล้วเท่านั้น
    outboundList.forEach((ob) => {
      const bKey = ob.batch.trim().toUpperCase();
      if (!bKey) return;
      if (map.has(bKey)) {
        const item = map.get(bKey)!;
        if (item.orderNo === "-" && ob.orderNo) {
          item.orderNo = ob.orderNo;
        }
        return;
      }

      // ต้องได้รับการยืนยันว่าพนักงานจ่ายหน้าเครื่องสแกนแล้วเท่านั้น
      const isMachineScanned =
        outboundMachineScannedSet.has(bKey) ||
        stagedCoilBatchSet.has(bKey) ||
        pickListMachineIssuedSet.has(bKey);

      if (!isMachineScanned) {
        return;
      }

      if (hasAnyReturnedInbound && returnedInboundTimestampMap.has(bKey)) {
        const retTs = returnedInboundTimestampMap.get(bKey)!;
        const obTs = new Date(ob.scanTimestamp).getTime();
        if (retTs >= (isNaN(obTs) ? 0 : obTs)) return;
      }

      const matchedSap = sapMasterMap.get(bKey);
      const mId = ob.machine || "TM01";
      const mCode = mId.startsWith("TM") ? `TM ${mId.replace("TM", "")}` : mId;
      const defaultLoc = mCode;

      map.set(bKey, {
        id: `OB-${bKey}`,
        batch: bKey,
        machineId: mId,
        machineCode: mCode,
        orderNo: ob.orderNo || "-",
        rackNameTh: "-",
        weightKg: ob.weightKg || 0,
        grade: ob.grade || "-",
        spec: `${formatDimension2Decimals(ob.certThickness, "-")} x ${formatDimension2Decimals(ob.width, "-")}`,
        dispatchedAt: ob.scanTimestamp || "-",
        defaultLocation: defaultLoc,
        returnLocation: customReturnLocations[bKey] || defaultLoc,
        description: ob.description || matchedSap?.description,
        hasSapData: Boolean(matchedSap),
      });
    });

    const result = Array.from(map.values());
    if (deletedReturnBatchIds.length === 0) return result;
    const deletedSet = new Set(deletedReturnBatchIds.map((b) => b.trim().toUpperCase()));
    return result.filter((item) => !deletedSet.has(item.batch.trim().toUpperCase()));
  }, [outboundList, inboundList, pickLists, pickListOrderByBatchMap, sapMasterMap, machineStagingVersion, customReturnLocations, deletedReturnBatchIds]);

  // Filtered returnable batches
  const filteredReturnBatches = useMemo(() => {
    return returnableBatches.filter((item) => {
      if (returnMachineFilter !== "all" && item.machineId.toUpperCase() !== returnMachineFilter.toUpperCase()) {
        return false;
      }
      if (returnOrderFilter !== "all" && item.orderNo !== returnOrderFilter) {
        return false;
      }
      if (returnSearchKeyword.trim()) {
        const q = returnSearchKeyword.toLowerCase();
        const matchBatch = item.batch.toLowerCase().includes(q);
        const matchOrder = item.orderNo.toLowerCase().includes(q);
        const matchMachine = item.machineCode.toLowerCase().includes(q) || item.machineId.toLowerCase().includes(q);
        const matchGrade = item.grade.toLowerCase().includes(q);
        const matchSpec = item.spec.toLowerCase().includes(q);
        return matchBatch || matchOrder || matchMachine || matchGrade || matchSpec;
      }
      return true;
    });
  }, [returnableBatches, returnMachineFilter, returnOrderFilter, returnSearchKeyword]);

  const returnableMachineIds = useMemo(() => {
    return Array.from(new Set(returnableBatches.map((i) => i.machineId))).sort();
  }, [returnableBatches]);

  const returnableOrderNos = useMemo(() => {
    return Array.from(new Set(returnableBatches.map((i) => i.orderNo))).filter((o) => o !== "-").sort();
  }, [returnableBatches]);

  // Selected batches list & calculations
  const selectedReturnItems = useMemo(() => {
    return returnableBatches.filter((b) => returnSelectedBatchIds.includes(b.batch));
  }, [returnableBatches, returnSelectedBatchIds]);

  const selectedReturnWeightKg = useMemo(() => {
    return selectedReturnItems.reduce((sum, item) => sum + item.weightKg, 0);
  }, [selectedReturnItems]);

  const selectedReturnWeightTon = (selectedReturnWeightKg / 1000).toFixed(3);

  // Pagination for Return to Warehouse Table
  const returnTotalPages = Math.max(1, Math.ceil(filteredReturnBatches.length / returnPageSize));
  const validReturnCurrentPage = Math.min(Math.max(1, returnCurrentPage), returnTotalPages);
  const returnStartIndex = (validReturnCurrentPage - 1) * returnPageSize;
  const returnEndIndex = Math.min(returnStartIndex + returnPageSize, filteredReturnBatches.length);
  const paginatedReturnBatches = useMemo(() => {
    return filteredReturnBatches.slice(returnStartIndex, returnEndIndex);
  }, [filteredReturnBatches, returnStartIndex, returnEndIndex]);

  // Handler: Scan Batch Barcode to quick-select
  const handleScanReturnBatchBarcode = (code: string) => {
    const trimmed = cleanBarcode(code);
    if (!trimmed) return;

    const matched = returnableBatches.find((b) => b.batch.toUpperCase() === trimmed);
    if (!matched) {
      if (soundEnabled) playScanSound(false);
      const isPendingMachineDispense = pickLists.some((pl) =>
        (pl.items || []).some(
          (i) => i.batch?.trim().toUpperCase() === trimmed && !isItemMachineIssued(i)
        )
      );

      Swal.fire({
        icon: "warning",
        title: isPendingMachineDispense
          ? (isThai ? "รายการยังไม่ผ่านการจ่ายหน้าเครื่อง" : "Machine Dispense Pending")
          : (isThai ? "ไม่พบข้อมูล Batch ที่หน้าเครื่อง" : "Batch Not Found at Machine"),
        text: isPendingMachineDispense
          ? (isThai
              ? `Batch [${trimmed}] ยังอยู่ในขั้นตอนรอ Operator สแกนรับงานที่หน้า 'จ่ายหน้าเครื่อง' (ต้องทำการจ่ายหน้าเครื่องให้สำเร็จก่อนจึงจะสามารถทำเรื่องคืนคลังได้)`
              : `Batch [${trimmed}] has not completed machine dispense yet.`)
          : (isThai
              ? `ไม่พบรหัส Batch [${trimmed}] ในรายการที่จ่ายหน้าเครื่องแล้ว หรืออาจถูกคืนคลังไปแล้ว`
              : `Batch [${trimmed}] was not found among dispatched batches.`),
        confirmButtonColor: "#ea580c",
        confirmButtonText: isThai ? "ตกลง" : "OK",
      });
      setReturnBarcodeInput("");
      returnBarcodeInputRef.current?.focus();
      return;
    }

    setReturnSelectedBatchIds((prev) => {
      if (prev.includes(matched.batch)) {
        return prev.filter((b) => b !== matched.batch);
      } else {
        return [...prev, matched.batch];
      }
    });

    if (soundEnabled) playScanSound(true);
    setNotificationToast({
      type: "success",
      message: isThai
        ? `เลือก Batch [${matched.batch}] (เครื่อง ${matched.machineCode}, ใบสั่ง #${matched.orderNo}) สำเร็จ`
        : `Selected Batch [${matched.batch}] (${matched.machineCode})`,
    });
    setReturnBarcodeInput("");
    returnBarcodeInputRef.current?.focus();
  };

  const handleToggleSelectReturnBatch = (batch: string) => {
    setReturnSelectedBatchIds((prev) =>
      prev.includes(batch) ? prev.filter((b) => b !== batch) : [...prev, batch]
    );
  };

  const handleToggleSelectAllReturn = () => {
    if (returnSelectedBatchIds.length === filteredReturnBatches.length) {
      setReturnSelectedBatchIds([]);
    } else {
      setReturnSelectedBatchIds(filteredReturnBatches.map((b) => b.batch));
    }
  };

  const handleSetReturnLocationForBatch = (batch: string, loc: string) => {
    setCustomReturnLocations((prev) => ({
      ...prev,
      [batch]: loc.toUpperCase(),
    }));
  };

  const handleApplyBulkLocation = () => {
    if (!bulkReturnLocation.trim()) return;
    const loc = bulkReturnLocation.trim().toUpperCase();
    setCustomReturnLocations((prev) => {
      const updated = { ...prev };
      returnSelectedBatchIds.forEach((b) => {
        updated[b] = loc;
      });
      return updated;
    });
    setNotificationToast({
      type: "success",
      message: isThai
        ? `กำหนดตำแหน่งรับคืนเป็น [${loc}] ให้กับ ${returnSelectedBatchIds.length} รายการที่เลือกเรียบร้อย`
        : `Applied return location [${loc}] to ${returnSelectedBatchIds.length} selected items`,
    });
  };

  // Handler: Execute Return to Warehouse
  const handleExecuteReturnToWarehouse = (singleBatch?: ReturnItemRow) => {
    const itemsToReturn = singleBatch
      ? [singleBatch]
      : returnableBatches.filter((b) => returnSelectedBatchIds.includes(b.batch));

    if (itemsToReturn.length === 0) {
      if (soundEnabled) playScanSound(false);
      Swal.fire({
        icon: "warning",
        title: isThai ? "ยังไม่ได้เลือกรายการ" : "No Items Selected",
        text: isThai
          ? "กรุณาเลือกรายการเหล็กสลิตอย่างน้อย 1 รายการเพื่อทำเรื่องคืนคลัง"
          : "Please select at least 1 item to return.",
        confirmButtonColor: "#ea580c",
        confirmButtonText: isThai ? "ตกลง" : "OK",
      });
      return;
    }

    const machineList = Array.from(new Set(itemsToReturn.map((i) => i.machineCode || i.machineId))).join(", ");
    const orderList = Array.from(new Set(itemsToReturn.map((i) => i.orderNo))).filter((o) => o !== "-").join(", ");
    const totalWeight = itemsToReturn.reduce((sum, i) => sum + i.weightKg, 0);

    Swal.fire({
      title: isThai ? "ยืนยันการรับคืนคลัง?" : "Confirm Return to Warehouse?",
      html: `
        <div style="text-align: left; font-size: 13px; line-height: 1.6;">
          <p style="margin-bottom: 8px; color: #334155; font-weight: 500;">
            ${isThai ? "คุณต้องการยืนยันการรับคืนเหล็กสลิตจากหน้าเครื่องกลับเข้าคลังสินค้าใช่หรือไม่?" : "Do you want to confirm returning these materials to warehouse stock?"}
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; font-family: 'Noto Sans Thai', sans-serif; font-variant-numeric: tabular-nums;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">${isThai ? "จำนวนที่คืน:" : "Items to Return:"}</span>
              <span style="font-weight: bold; color: #ea580c;">${itemsToReturn.length} ${isThai ? "แถบ (Batches)" : "Batches"}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">${isThai ? "น้ำหนักรวม:" : "Total Weight:"}</span>
              <span style="font-weight: bold; color: #059669;">${totalWeight.toLocaleString()} kg (${(totalWeight / 1000).toFixed(3)} ตัน)</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">${isThai ? "เครื่องจักรต้นทาง:" : "Origin Machine(s):"}</span>
              <span style="font-weight: bold; color: #0284c7;">${machineList}</span>
            </div>
            ${orderList ? `
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">${isThai ? "อ้างอิงใบสั่งเบิก:" : "Order Reference(s):"}</span>
              <span style="font-weight: bold; color: #d97706;">#${orderList}</span>
            </div>` : ""}
          </div>
        </div>
      `,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#ea580c",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ยืนยันรับคืนคลัง" : "Confirm Return",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    }).then((result) => {
      if (!result.isConfirmed) return;

      const nowStr = new Date().toLocaleString(isThai ? "th-TH" : "en-GB");
      const returnedBatchesSet = new Set(itemsToReturn.map((i) => i.batch));

      // 1. Remove coils from machine staging racks in localStorage
      itemsToReturn.forEach((item) => {
        removeCoilByBatch(item.batch, item.machineId);
      });

      // 2. Add or update inboundList records so they enter Stock Balance as ready ("พร้อมใช้งาน") and appear in Movement History
      const newInboundRecords: SlitBarcodeRecord[] = itemsToReturn.map((item) => {
        const defaultRackOrMachine = (item.rackNameTh && item.rackNameTh !== "-") ? item.rackNameTh : (item.machineCode || item.machineId);
        const destLocation = customReturnLocations[item.batch] || item.defaultLocation || defaultRackOrMachine;
        const matchedSap = sapMasterMap.get(item.batch);
        return {
          id: `RETURN-${Date.now()}-${item.batch}`,
          mode: "inbound",
          scanTimestamp: nowStr,
          batch: item.batch,
          orderNo: item.orderNo !== "-" ? item.orderNo : undefined,
          location: destLocation,
          storageLocation: destLocation,
          machine: item.machineId,
          hasSapData: Boolean(matchedSap),
          certThickness: matchedSap?.certThickness || item.spec.split("x")[0]?.trim() || "-",
          width: matchedSap?.width || item.spec.split("x")[1]?.trim() || "-",
          weightKg: item.weightKg,
          unrestricted: `${item.weightKg.toLocaleString()} kg`,
          grade: item.grade || matchedSap?.grade || "-",
          manufacturer: matchedSap?.manufacturer || "-",
          description: item.description || matchedSap?.description || "",
          conditionText: `คืนคลังจาก ${item.machineCode || item.machineId}${item.rackNameTh && item.rackNameTh !== "-" ? ` (${item.rackNameTh})` : ""}`,
        };
      });

      setInboundList((prev) => {
        const filteredPrev = prev.filter((r) => !returnedBatchesSet.has(r.batch.trim().toUpperCase()));
        return [...newInboundRecords, ...filteredPrev];
      });

      // 3. Remove returned items from outboundList so remaining items stay with the machine
      setOutboundList((prev) => prev.filter((o) => !returnedBatchesSet.has(o.batch.trim().toUpperCase())));

      // 4. Update pickLists: mark items in the order as returned (remaining batches untouched)
      setPickLists((prev) =>
        prev.map((ord) => {
          const hasMatch = ord.items.some((i) => returnedBatchesSet.has(i.batch?.trim().toUpperCase()));
          if (!hasMatch) return ord;
          return {
            ...ord,
            items: ord.items.map((i) => {
              if (returnedBatchesSet.has(i.batch?.trim().toUpperCase())) {
                return {
                  ...i,
                  status: "pending" as const,
                  machineIssued: false,
                  machineIssuedAt: undefined,
                  scannedAt: undefined,
                };
              }
              return i;
            }),
          };
        })
      );

      // 5. Clear selections
      setReturnSelectedBatchIds([]);
      if (soundEnabled) playScanSound(true);

      // 6. Log transactions
      itemsToReturn.forEach((item) => {
        onLogTransaction?.(
          `คืนคลังจาก ${item.machineId} (Batch ${item.batch}, ใบสั่ง #${item.orderNo})`,
          item.batch,
          "Completed"
        );
      });

      // 7. Show success SweetAlert
      Swal.fire({
        icon: "success",
        title: isThai ? "รับคืนคลังสำเร็จ" : "Return Successful",
        html: `
          <div style="font-size: 13px; text-align: left; line-height: 1.6;">
            <p style="color: #059669; font-weight: bold; margin-bottom: 6px;">
              ${isThai ? `รับคืนเหล็กสลิตจำนวน ${itemsToReturn.length} แถบ เรียบร้อยแล้ว` : `Successfully returned ${itemsToReturn.length} batches.`}
            </p>
            <ul style="margin: 0; padding-left: 18px; color: #475569;">
              <li>${isThai ? `สถานะอัปเดตเป็น: "คืนคลังจาก ${machineList}"` : `Status updated to "Return from ${machineList}"`}</li>
              <li>${isThai ? "ข้อมูลวิ่งเข้าหน้า [สต็อกคงคลัง] พร้อมใช้งานแล้ว" : "Available in Stock Balance"}</li>
              <li>${isThai ? "บันทึกลงใน [ประวัติการเคลื่อนไหว] เรียบร้อย" : "Recorded in Movement History"}</li>
              <li>${isThai ? "รายการที่เหลือยังคงอยู่ที่เครื่องจักรตามเดิม" : "Remaining items remain at machine"}</li>
            </ul>
          </div>
        `,
        confirmButtonColor: "#087eaf",
        confirmButtonText: isThai ? "ตกลง" : "OK",
      });
    });
  };

  // Handler: Clear All Return Data
  const handleClearAllReturnData = () => {
    Swal.fire({
      title: isThai ? "ยืนยันล้างข้อมูลคืนคลังทั้งหมด?" : "Confirm Reset All Return Data?",
      text: isThai ? "ต้องการล้างรายการวัตถุดิบทั้งหมดที่ค้างอยู่หน้าเครื่องจักรในตารางคืนคลังใช่หรือไม่?" : "Do you want to clear all returnable items at machines?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ยืนยันล้างข้อมูล" : "Confirm Clear",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    }).then((result) => {
      if (!result.isConfirmed) return;
      resetAllMachineStagingToEmpty();
      setPickLists((prev) =>
        prev.map((ord) => ({
          ...ord,
          items: (ord.items || []).map((i) => ({
            ...i,
            machineIssued: false,
            machineIssuedAt: undefined,
            scannedAt: undefined,
            status: "pending" as const,
          })),
        }))
      );
      setOutboundList((prev) =>
        prev.filter((o) => !(o.conditionText && o.conditionText.includes("รับงานหน้าเครื่อง")))
      );
      setReturnSelectedBatchIds([]);
      setDeletedReturnBatchIds([]);
      setCustomReturnLocations({});
      if (soundEnabled) playScanSound(true);
      Swal.fire({
        icon: "success",
        title: isThai ? "ล้างข้อมูลคืนคลังเรียบร้อย" : "Return Data Cleared",
        text: isThai ? "ไม่มีรายการวัตถุดิบค้างในตารางคืนคลังแล้ว" : "All returnable items have been cleared.",
        timer: 1600,
        showConfirmButton: false,
        toast: true,
        position: "top-end",
      });
    });
  };

  // Handler: Delete Single Returnable Item
  const handleDeleteReturnableItem = (row: ReturnItemRow) => {
    Swal.fire({
      title: isThai ? "ยืนยันการลบรายการคืนคลัง?" : "Confirm Delete Return Item?",
      html: `
        <div style="text-align: left; font-size: 13px; line-height: 1.6;">
          <p style="margin-bottom: 8px; color: #334155; font-weight: 500;">
            ${isThai ? "คุณต้องการลบรายการเหล็กสลิตนี้ออกจากตารางคืนคลังใช่หรือไม่?" : "Are you sure you want to delete this batch from the return warehouse table?"}
          </p>
          <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 8px; font-family: 'Noto Sans Thai', sans-serif; font-variant-numeric: tabular-nums;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">Batch:</span>
              <span style="font-weight: bold; color: #dc2626;">${row.batch}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">${isThai ? "เครื่องจักร:" : "Machine:"}</span>
              <span style="font-weight: bold; color: #0284c7;">${row.machineCode}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b;">${isThai ? "ใบสั่งเบิก:" : "Order:"}</span>
              <span style="font-weight: bold; color: #d97706;">${row.orderNo !== "-" ? `#${row.orderNo}` : "-"}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">${isThai ? "น้ำหนัก:" : "Weight:"}</span>
              <span style="font-weight: bold; color: #059669;">${row.weightKg.toLocaleString()} kg</span>
            </div>
          </div>
        </div>
      `,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ยืนยันการลบ" : "Confirm Delete",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    }).then((result) => {
      if (!result.isConfirmed) return;

      const bKey = row.batch.trim().toUpperCase();

      // Mark batch as deleted from Return Warehouse
      setDeletedReturnBatchIds((prev) => Array.from(new Set([...prev, bKey])));

      // Deselect batch if selected
      setReturnSelectedBatchIds((prev) => prev.filter((b) => b !== bKey));

      // Remove from physical machine staging rack if present
      removeCoilByBatch(row.batch, row.machineId);

      // Unmark machineIssued from pick lists if item matches
      setPickLists((prev) =>
        prev.map((ord) => ({
          ...ord,
          items: (ord.items || []).map((i) => {
            if (i.batch && i.batch.trim().toUpperCase() === bKey) {
              return { ...i, machineIssued: false, machineIssuedAt: undefined };
            }
            return i;
          }),
        }))
      );

      // Filter out from machine-scanned outbound records
      setOutboundList((prev) =>
        prev.filter(
          (ob) => !(ob.batch.trim().toUpperCase() === bKey && ob.conditionText?.includes("รับงานหน้าเครื่อง"))
        )
      );

      if (soundEnabled) playScanSound(true);

      setNotificationToast({
        type: "success",
        message: isThai
          ? `ลบรายการ Batch [${row.batch}] จากตารางคืนคลังเรียบร้อยแล้ว`
          : `Deleted Batch [${row.batch}] from return warehouse list`,
      });

      onLogTransaction?.(
        `Deleted Return Warehouse Item: Batch ${row.batch} (Machine ${row.machineCode})`,
        row.batch,
        "Completed"
      );
    });
  };

  // Handler: Delete Selected Returnable Items
  const handleDeleteSelectedReturnItems = () => {
    if (returnSelectedBatchIds.length === 0) {
      if (soundEnabled) playScanSound(false);
      Swal.fire({
        icon: "warning",
        title: isThai ? "ยังไม่ได้เลือกรายการ" : "No Items Selected",
        text: isThai ? "กรุณาเลือกรายการที่ต้องการลบในตาราง" : "Please select items to delete.",
        confirmButtonColor: "#ef4444",
        confirmButtonText: isThai ? "ตกลง" : "OK",
      });
      return;
    }

    const count = returnSelectedBatchIds.length;

    Swal.fire({
      title: isThai ? "ยืนยันการลบรายการที่เลือก?" : "Confirm Delete Selected Items?",
      html: `
        <div style="text-align: left; font-size: 13px; line-height: 1.6;">
          <p style="margin-bottom: 8px; color: #334155;">
            ${isThai
              ? `คุณต้องการลบรายการเหล็กสลิตที่เลือกจำนวน <strong style="color: #ef4444;">${count} รายการ</strong> ออกจากตารางคืนคลังใช่หรือไม่?`
              : `Are you sure you want to delete ${count} selected items from the return warehouse list?`}
          </p>
        </div>
      `,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? `ยืนยันการลบ (${count} รายการ)` : `Confirm Delete (${count})`,
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    }).then((result) => {
      if (!result.isConfirmed) return;

      const bKeys = returnSelectedBatchIds.map((b) => b.trim().toUpperCase());
      const bSet = new Set(bKeys);

      setDeletedReturnBatchIds((prev) => Array.from(new Set([...prev, ...bKeys])));

      // Remove from physical machine staging racks
      returnSelectedBatchIds.forEach((b) => {
        const item = returnableBatches.find((rb) => rb.batch === b);
        removeCoilByBatch(b, item?.machineId);
      });

      // Unmark machineIssued in pickLists
      setPickLists((prev) =>
        prev.map((ord) => ({
          ...ord,
          items: (ord.items || []).map((i) => {
            if (i.batch && bSet.has(i.batch.trim().toUpperCase())) {
              return { ...i, machineIssued: false, machineIssuedAt: undefined };
            }
            return i;
          }),
        }))
      );

      // Filter out from machine-scanned outbound records
      setOutboundList((prev) =>
        prev.filter(
          (ob) => !(bSet.has(ob.batch.trim().toUpperCase()) && ob.conditionText?.includes("รับงานหน้าเครื่อง"))
        )
      );

      setReturnSelectedBatchIds([]);

      if (soundEnabled) playScanSound(true);

      setNotificationToast({
        type: "success",
        message: isThai
          ? `ลบรายการคืนคลังจำนวน ${count} รายการเรียบร้อยแล้ว`
          : `Deleted ${count} items from return warehouse list`,
      });

      onLogTransaction?.(
        `Deleted ${count} Return Warehouse Items`,
        `BULK-DEL-${Date.now()}`,
        "Completed"
      );
    });
  };

  // Current active list (with merge/upsert and real-time SAP enrichment)
  const currentList = useMemo(() => {
    const rawList = activeMode === "movement_history"
      ? movementHistoryList
      : activeMode === "inbound"
      ? inboundList
      : outboundList;

    const map = new Map<string, SlitBarcodeRecord>();
    for (const record of rawList) {
      if (!record.batch) continue;
      const bKey = record.batch.trim().toUpperCase();

      let enriched = record;
      const sapMatch = sapMasterMap.get(bKey);
      if (sapMatch && (!record.hasSapData || !record.certThickness || record.certThickness === "รอข้อมูล SAP")) {
        enriched = mergeSlitBarcodeRecords(record, {}, sapMasterMap);
      }

      if (map.has(bKey)) {
        const existing = map.get(bKey)!;
        map.set(bKey, mergeSlitBarcodeRecords(existing, enriched, sapMasterMap));
      } else {
        map.set(bKey, enriched);
      }
    }
    return Array.from(map.values());
  }, [activeMode, movementHistoryList, inboundList, outboundList, sapMasterMap]);

  // Reset selected batch IDs when scanner modal toggles or mode changes
  useEffect(() => {
    setSelectedBatchIds([]);
  }, [isScannerModalOpen, activeMode]);

  // Keep selectedBatchIds in sync with current session batches
  useEffect(() => {
    setSelectedBatchIds((prev) => prev.filter((id) => currentSessionBatches.some((r) => r.id === id)));
  }, [currentSessionBatches]);

  // Machine selection action: Employee taps SM01, SM02, SM03, or SM04
  const handleSelectMachineAndOpenScanner = (machineId: string) => {
    setSelectedMachine(machineId);
    setBarcodeInput("");
    setScanStatus(null);
    setCurrentSessionBatches([]); // Fresh isolated session
    setSelectedBatchIds([]);
    setIsInboundWidthLimitLocked(false);
    setIsScannerModalOpen(true);
  };

  // Process barcode input validation & submission
  const processBarcodeSubmission = (rawCode: string) => {
    const trimmed = cleanBarcode(rawCode);

    // STRICT VALIDATION 1: Reject URLs or structured JSON inputs
    const isForbiddenQr =
      trimmed.includes("HTTP://") ||
      trimmed.includes("HTTPS://") ||
      trimmed.includes("{") ||
      trimmed.includes(",") ||
      trimmed.includes(";") ||
      trimmed.includes(" ");

    if (isForbiddenQr) {
      if (soundEnabled) playScanSound(false);
      setScanStatus({
        type: "error",
        message: isThai
          ? "ปฏิเสธ: ตรวจพบ QR Code! ระบบรองรับเฉพาะบาร์โค้ด Batch 10 หลัก (Barcode-Only)"
          : "Rejected: QR Code detected! System supports Barcode-Only 10 digits.",
        batch: trimmed,
      });
      setBarcodeInput("");
      modalScannerInputRef.current?.focus();
      return;
    }

    // STRICT VALIDATION 2: Exactly 10 characters alphanumeric (e.g. '26SL00189A')
    const isExactly10Alphanumeric = /^[A-Za-z0-9]{10}$/.test(trimmed);

    if (!isExactly10Alphanumeric) {
      if (soundEnabled) playScanSound(false);
      setScanStatus({
        type: "error",
        message: isThai
          ? `ปฏิเสธ: บาร์โค้ดต้องเป็นรหัส Batch 10 หลักเท่านั้น (ตรวจพบ ${trimmed.length} ตัวอักษร เช่น '26SL00189A')`
          : `Rejected: Must be exactly 10-character alphanumeric Batch (received ${trimmed.length} chars).`,
        batch: trimmed,
      });
      setBarcodeInput("");
      modalScannerInputRef.current?.focus();
      return;
    }

    // If Operator Receive Mode, check pick lists & validate machine cross-check strictly by batch code
    if (activeMode === "operator_receive") {
      // RULE: Check if Batch exists in Stock Balance, Inbound, Outbound, SAP Master, or Pick Lists
      const existsInSystem =
        stockList.some((item) => item.batch.trim().toUpperCase() === trimmed) ||
        inboundList.some((item) => item.batch.trim().toUpperCase() === trimmed) ||
        outboundList.some((item) => item.batch.trim().toUpperCase() === trimmed) ||
        sapMasterMap.has(trimmed) ||
        pickLists.some((ord) =>
          (ord.items || []).some((itm) => itm.batch.trim().toUpperCase() === trimmed)
        );

      if (!existsInSystem) {
        if (soundEnabled) playScanSound(false);
        setScanStatus({
          type: "error",
          message: isThai
            ? `ปฏิเสธ: ไม่พบ Batch [${trimmed}] ในระบบคลังสินค้าหรือใบสั่งเบิก! ไม่สามารถสแกนรับงานหน้าเครื่องได้`
            : `Rejected: Batch [${trimmed}] not found in Stock or Pick Lists! Cannot receive at machine.`,
          batch: trimmed,
        });
        setBarcodeInput("");
        modalScannerInputRef.current?.focus();
        return;
      }

      const targetMachine = selectedOutboundMachine || "TM01";
      const effectiveRackId =
        selectedDestinationRackId ||
        destinationRacks.find((r) => r.status !== "maintenance")?.rackId ||
        `${targetMachine}-R01`;

      let foundOrder: PickListOrder | null = null;
      let foundItem: PickListItem | null = null;
      let isWrongMachine = false;
      let wrongMachineId = "";
      let wrongOrderNo = "";

      for (const ord of pickLists) {
        for (const itm of ord.items) {
          if (itm.batch.trim().toUpperCase() === trimmed) {
            if (ord.machineId === targetMachine) {
              foundOrder = ord;
              foundItem = itm;
              break;
            } else {
              isWrongMachine = true;
              wrongMachineId = ord.machineId;
              wrongOrderNo = ord.orderNo;
            }
          }
        }
        if (foundOrder) break;
      }

      // If batch belongs to a different machine order -> Wrong Machine Warning
      if (!foundOrder && isWrongMachine) {
        if (soundEnabled) playScanSound(false);
        setIsScannerModalOpen(false);
        setOperatorWarningModal({
          isOpen: true,
          title: isThai ? "เตือนภัย: ผิดเครื่องจักร (Wrong Machine)" : "Wrong Machine Warning",
          message: isThai
            ? `เตือนภัย: Batch นี้ [${trimmed}] เป็นของเครื่องจักร ${wrongMachineId} (ใบสั่ง ${wrongOrderNo}) ไม่ใช่เครื่อง ${targetMachine} ที่ท่านเลือกไว้! กรุณาตรวจสอบและเลือกเครื่องให้ถูกต้อง`
            : `Warning: Batch [${trimmed}] belongs to machine ${wrongMachineId} (Order ${wrongOrderNo}), not ${targetMachine}!`,
        });
        setBarcodeInput("");
        return;
      }

      // If batch not found in any pick list at all
      if (!foundOrder) {
        if (soundEnabled) playScanSound(false);
        setScanStatus({
          type: "error",
          message: isThai
            ? `ปฏิเสธ: Batch [${trimmed}] ไม่อยู่ในใบสั่งเบิกของเครื่องจักร ${targetMachine} (กรุณาตรวจสอบใบสั่งเตรียมเบิกออกก่อน)`
            : `Rejected: Batch [${trimmed}] not found in Pick List for machine ${targetMachine}.`,
          batch: trimmed,
        });
        setBarcodeInput("");
        modalScannerInputRef.current?.focus();
        return;
      }

      // STRICT RULE: ห้ามให้สแกนผ่านถ้า Status ที่ ตาราง รายการใบสั่งเบิกวัตถุดิบ (Pick List Orders) ที่หน้า เตรียมเบิก ยังไม่ใช่ "เตรียมแล้ว"
      if (!foundItem || foundItem.status !== "verified") {
        if (soundEnabled) playScanSound(false);
        setScanStatus({
          type: "error",
          message: isThai
            ? `ปฏิเสธ: Batch [${trimmed}] ยังไม่ได้รับการเตรียมเบิก! Status ที่ตารางรายการใบสั่งเบิก (${foundOrder.orderNo}) ที่หน้าเตรียมเบิกยังไม่เป็น "เตรียมแล้ว"`
            : `Rejected: Batch [${trimmed}] has not been prepared yet! Status in Pick List Orders table (${foundOrder.orderNo}) at Outbound is not "Prepared".`,
          batch: trimmed,
        });
        setBarcodeInput("");
        modalScannerInputRef.current?.focus();
        return;
      }

      // ตรวจสอบว่าเคยสแกนรับงานเข้าเครื่องจักรไปแล้วหรือไม่
      if (isItemMachineIssued(foundItem)) {
        if (soundEnabled) playScanSound(false);
        setScanStatus({
          type: "error",
          message: isThai
            ? `ปฏิเสธ: Batch [${trimmed}] ได้รับการสแกนรับเข้าเครื่อง [${targetMachine}] เรียบร้อยแล้ว`
            : `Rejected: Batch [${trimmed}] has already been received at machine [${targetMachine}].`,
          batch: trimmed,
        });
        setBarcodeInput("");
        modalScannerInputRef.current?.focus();
        return;
      }

      const nowTime = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const checkOrderItems = foundOrder.items.map((itm) =>
        itm.id === foundItem!.id || itm.batch.trim().toUpperCase() === trimmed
          ? { ...itm, status: "verified" as const, machineIssued: true, machineIssuedAt: nowTime, scannedAt: nowTime }
          : itm
      );
      const validOrderItems = checkOrderItems.filter((i) =>
        Boolean(i.batch && /^[A-Za-z0-9]{10}$/.test(i.batch.trim()))
      );
      const poolToVerify = validOrderItems.length > 0 ? validOrderItems : checkOrderItems;
      const allOrderIssued = poolToVerify.every((i) => i.machineIssued === true);
      const issuedCountNow = poolToVerify.filter((i) => i.machineIssued === true).length;

      // Match correct machine order & update item status to verified
      setPickLists((prev) =>
        prev.map((ord) => {
          if (ord.orderNo === foundOrder!.orderNo) {
            const updatedItems = ord.items.map((itm) => {
              if (itm.id === foundItem!.id || itm.batch.trim().toUpperCase() === trimmed) {
                return {
                  ...itm,
                  status: "verified" as const,
                  machineIssued: true,
                  machineIssuedAt: nowTime,
                  scannedAt: nowTime,
                };
              }
              return itm;
            });
            return {
              ...ord,
              status: allOrderIssued ? ("completed" as const) : ("in_progress" as const),
              items: updatedItems,
            };
          }
          return ord;
        })
      );

      if (soundEnabled) playScanSound(true);
      setBarcodeInput("");

      const inboundMatch = inboundList.find((r) => r.batch.trim().toUpperCase() === trimmed);
      const totalKg = inboundMatch?.weightKg || foundItem?.reqQty || 0;
      const totalTon = (totalKg / 1000).toFixed(3);
      const machineLoc = `เบิก${targetMachine}`;
      const nowTimestampStr = `${new Date().toISOString().slice(0, 10)} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

      const matchedSap = sapMasterMap.get(trimmed);

      // Update inboundList record location to "เบิกTM01" with Upsert / Merge (and deduplicate any older entries for this batch)
      setInboundList((prev) => {
        const existsIdx = prev.findIndex((r) => r.batch.trim().toUpperCase() === trimmed);
        const updateData: Partial<SlitBarcodeRecord> = {
          orderNo: foundOrder!.orderNo,
          location: machineLoc,
          storageLocation: machineLoc,
          machine: targetMachine,
          scanTimestamp: nowTimestampStr,
          conditionText: `รับงานหน้าเครื่อง ${targetMachine} เรียบร้อยแล้ว`,
          ...(matchedSap ? {
            hasSapData: true,
            certThickness: matchedSap.certThickness,
            width: matchedSap.width,
            weightKg: matchedSap.weightKg,
            unrestricted: matchedSap.unrestricted,
            grade: matchedSap.grade,
            manufacturer: matchedSap.manufacturer,
            description: matchedSap.description,
            salesDoc: matchedSap.salesDoc,
            materialNo: matchedSap.materialNo,
            targetThickness: matchedSap.targetThickness,
            qualityClass: matchedSap.qualityClass,
            coilNo: matchedSap.coilNo,
          } : {})
        };
        if (existsIdx !== -1) {
          const mergedRec = mergeSlitBarcodeRecords(prev[existsIdx], updateData, sapMasterMap);
          const others = prev.filter((r, i) => i !== existsIdx && r.batch.trim().toUpperCase() !== trimmed);
          return [mergedRec, ...others];
        } else {
          const record = generateRecordFromBatch(trimmed, "inbound", machineLoc, targetMachine, sapMasterMap);
          record.orderNo = foundOrder!.orderNo;
          record.conditionText = `รับงานหน้าเครื่อง ${targetMachine} เรียบร้อยแล้ว`;
          return [record, ...prev];
        }
      });

      // Remove issued coil from any warehouse basket in Space Management storage
      try {
        const spaceRaw = localStorage.getItem("tmt_wms_space_management_data_v1");
        if (spaceRaw) {
          const parsedSpace = JSON.parse(spaceRaw);
          if (Array.isArray(parsedSpace)) {
            const updatedSpace = parsedSpace.map((b: any) => ({
              ...b,
              rows: (b.rows || []).map((r: any) => ({
                ...r,
                baskets: (r.baskets || []).map((bk: any) => {
                  const remainingCoils = (bk.coils || []).filter(
                    (c: any) => String(c.batch || "").trim().toUpperCase() !== trimmed
                  );
                  return {
                    ...bk,
                    coils: remainingCoils,
                    status:
                      bk.status === "maintenance"
                        ? "maintenance"
                        : remainingCoils.length === 0
                        ? "available"
                        : bk.status,
                  };
                }),
              })),
            }));
            localStorage.setItem("tmt_wms_space_management_data_v1", JSON.stringify(updatedSpace));
          }
        }
        window.dispatchEvent(new Event("storage"));
      } catch {}

      // Also update/add in outboundList so Movement History consistently shows "เบิกTM01"
      setOutboundList((prev) => {
        const existsIdx = prev.findIndex((r) => r.batch.trim().toUpperCase() === trimmed);
        const newOutboundRecord: SlitBarcodeRecord = {
          id: `OUTBOUND-${Date.now()}-${trimmed}`,
          mode: "outbound",
          scanTimestamp: nowTimestampStr,
          batch: trimmed,
          orderNo: foundOrder!.orderNo,
          certThickness: matchedSap?.certThickness || inboundMatch?.certThickness || "-",
          width: matchedSap?.width || inboundMatch?.width || "-",
          weightKg: matchedSap?.weightKg || totalKg,
          unrestricted: matchedSap?.unrestricted || `${totalKg.toLocaleString()} kg`,
          grade: matchedSap?.grade || inboundMatch?.grade || "-",
          manufacturer: matchedSap?.manufacturer || inboundMatch?.manufacturer || "-",
          machine: targetMachine,
          location: machineLoc,
          storageLocation: machineLoc,
          description: matchedSap?.description || foundItem?.description || "",
          conditionText: `รับงานหน้าเครื่อง ${targetMachine} เรียบร้อยแล้ว`,
          hasSapData: Boolean(matchedSap),
        };
        if (existsIdx !== -1) {
          const updated = [...prev];
          updated[existsIdx] = mergeSlitBarcodeRecords(updated[existsIdx], newOutboundRecord, sapMasterMap);
          return updated;
        } else {
          return [newOutboundRecord, ...prev];
        }
      });

      // Integration with Machine Staging: Automatically place coil into destination rack
      const rawWidthStr = inboundMatch?.width || matchedSap?.width || foundItem?.description || "";
      const widthMatch = rawWidthStr.match(/(\d+(?:\.\d+)?)\s*(?:mm|มม|$)/i) || rawWidthStr.match(/[xX]\s*(\d+(?:\.\d+)?)/);
      const widthMm = widthMatch ? parseFloat(widthMatch[1]) : (parseFloat(rawWidthStr.replace(/[^0-9.]/g, "")) || 0);

      const rawThickStr = inboundMatch?.certThickness || matchedSap?.certThickness || matchedSap?.targetThickness || "";
      const thickMatch = rawThickStr.match(/(\d+(?:\.\d+)?)/);
      const thicknessMm = thickMatch ? parseFloat(thickMatch[1]) : 0;

      const grade = inboundMatch?.grade || matchedSap?.grade || "-";
      const spec = thicknessMm > 0 || widthMm > 0 ? `${thicknessMm.toFixed(2)} x ${widthMm}mm` : "-";

      const rackResult = addCoilToMachineRack(targetMachine, effectiveRackId, {
        batch: trimmed,
        widthMm,
        thicknessMm,
        weightKg: totalKg,
        grade,
        spec,
        operator: `Operator ${targetMachine}`,
        notes: `รับจากใบสั่ง #${foundOrder.orderNo}`
      });

      setScanStatus({
        type: "success",
        message: isThai
          ? `รับงานสำเร็จ: Batch [${trimmed}] วางลงแคร่ [${rackResult.rackNameTh || effectiveRackId}] (${issuedCountNow}/${poolToVerify.length})`
          : `Received: Batch [${trimmed}] staged to [${rackResult.rackNameTh || effectiveRackId}] (${issuedCountNow}/${poolToVerify.length})`,
        batch: trimmed,
      });

      if (allOrderIssued) {
        setIsScannerModalOpen(false);
        setSweetAlertData({
          isOpen: true,
          machine: targetMachine,
          batchCount: poolToVerify.length,
          totalWeightKg: poolToVerify.reduce((s, i) => s + (i.reqQty || totalKg), 0),
          totalWeightTon: (poolToVerify.reduce((s, i) => s + (i.reqQty || totalKg), 0) / 1000).toFixed(3),
          location: `${machineLoc} · แคร่ ${rackResult.rackNameTh || ""}`,
          timestamp: new Date().toLocaleString(isThai ? "th-TH" : "en-GB"),
        });
      } else {
        modalScannerInputRef.current?.focus();
      }

      setNotificationToast({
        type: "success",
        message: isThai
          ? `รับงานหน้าเครื่องสำเร็จ: Batch [${trimmed}] วางลงแคร่ [${rackResult.rackNameTh || "แคร่หน้าเครื่อง"}] เรียบร้อย (พื้นที่คงเหลือ ${rackResult.remainingMm.toLocaleString()} มม.)`
          : `Operator Receive Success: Batch [${trimmed}] staged to rack [${rackResult.rackNameTh}] (Free ${rackResult.remainingMm.toLocaleString()} mm)`,
      });

      onLogTransaction?.(
        `Operator Receive: Batch ${trimmed} staged to ${rackResult.rackNameTh || targetMachine} (Order ${foundOrder.orderNo})`,
        trimmed,
        "Completed"
      );
      return;
    }

    // Check duplicate in current session list
    const alreadyInSession = currentSessionBatches.some((item) => item.batch.toUpperCase() === trimmed.toUpperCase());
    if (alreadyInSession) {
      if (soundEnabled) playScanSound(false);
      setScanStatus({
        type: "error",
        message: isThai
          ? `แจ้งเตือน: บาร์โค้ด Batch [${trimmed}] ถูกสแกนในรอบนี้แล้ว!`
          : `Notice: Batch [${trimmed}] has already been scanned in this round!`,
        batch: trimmed,
      });
      setBarcodeInput("");
      modalScannerInputRef.current?.focus();
      return;
    }

    // Also check duplicate in saved list to prevent double inbound
    const alreadySaved = currentList.some((item) => item.batch.toUpperCase() === trimmed.toUpperCase());
    if (alreadySaved) {
      if (soundEnabled) playScanSound(false);
      setScanStatus({
        type: "error",
        message: isThai
          ? `แจ้งเตือน: บาร์โค้ด Batch [${trimmed}] มีบันทึกอยู่ในระบบแล้ว!`
          : `Notice: Batch [${trimmed}] already exists in the system!`,
        batch: trimmed,
      });
      setBarcodeInput("");
      modalScannerInputRef.current?.focus();
      return;
    }

    // Determine machine for this batch
    const activeMachineId = selectedMachine || "SM01";

    // Create record with bound Selected Machine (Location will be bound at Step 2)
    const newRecord = generateRecordFromBatch(
      trimmed.toUpperCase(),
      (activeMode === "inbound" ? "inbound" : "outbound") as "inbound" | "outbound",
      "PENDING",
      activeMachineId,
      sapMasterMap
    );

    // STRICT VALIDATION (Inbound Mode): Cumulative width must not exceed 2.00 meters (2,000 mm)
    if (activeMode === "inbound") {
      const newBatchWidthMm = getBatchWidthMm(trimmed, newRecord.width);
      const projectedWidthMm = currentSessionWidthMm + newBatchWidthMm;

      if (isInboundWidthLimitLocked || currentSessionWidthMm >= 2000 || projectedWidthMm > 2000) {
        if (soundEnabled) playScanSound(false);
        setIsInboundWidthLimitLocked(true);
        const projectedMeters = (projectedWidthMm / 1000).toFixed(2);
        const currentMeters = (currentSessionWidthMm / 1000).toFixed(2);
        const itemMeters = (newBatchWidthMm / 1000).toFixed(2);

        setScanStatus({
          type: "error",
          message: isThai
            ? `แจ้งเตือน: หน้ากว้างสะสมรวม (${projectedMeters} ม.) เกินพิกัด 2.00 เมตร ไม่สามารถสแกนเพิ่มได้!`
            : `Alert: Cumulative width (${projectedMeters} m) exceeds 2.00 m limit. Cannot scan more!`,
          batch: trimmed,
        });
        setBarcodeInput("");

        Swal.fire({
          icon: "warning",
          title: isThai
            ? "หน้ากว้างสะสมรวมเกิน 2.00 เมตร!"
            : "Cumulative Width Exceeds 2.00m!",
          html: isThai
            ? `<div class="text-sm text-slate-700 space-y-1.5 text-left font-sans">
                <p>ไม่สามารถสแกนเพิ่ม Batch <b class="font-mono text-rose-600">${trimmed}</b> ได้ เนื่องจากหน้ากว้างสะสมรวมเกินพิกัด <b>2.00 เมตร (2,000 mm)</b></p>
                <div class="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs space-y-1 mt-2">
                  <div class="flex justify-between"><span>หน้ากว้างสะสมเดิมในรอบนี้:</span><b class="font-mono">${currentMeters} ม. (${currentSessionWidthMm.toFixed(0)} mm)</b></div>
                  <div class="flex justify-between"><span>หน้ากว้างของ Batch ที่สแกน:</span><b class="font-mono">+${itemMeters} ม. (${newBatchWidthMm.toFixed(0)} mm)</b></div>
                  <div class="flex justify-between text-rose-700 pt-1 border-t border-rose-200"><span>หน้ากว้างสะสมรวม:</span><b class="font-mono">${projectedMeters} / 2.00 ม.</b></div>
                </div>
                <p class="text-xs text-slate-500 pt-1">กรุณากดปุ่ม <b>"สแกนเสร็จสิ้น (เลือกพื้นที่จัดเก็บ)"</b> เพื่อจัดเก็บรายการที่สแกนแล้วลงตะกร้าก่อน</p>
              </div>`
            : `<p>Cannot add Batch <b>${trimmed}</b>. Total cumulative width (${projectedMeters} m) exceeds the 2.00 m limit.</p>`,
          confirmButtonText: isThai ? "รับทราบ" : "OK",
          confirmButtonColor: "#e11d48",
        });
        return;
      }

      if (projectedWidthMm >= 2000) {
        setIsInboundWidthLimitLocked(true);
      }
    }

    // Append to current isolated session only
    setCurrentSessionBatches((prev) => [newRecord, ...prev]);

    if (soundEnabled) playScanSound(true);

    setScanStatus({
      type: "success",
      message: newRecord.batch,
      batch: newRecord.batch,
    });

    onLogTransaction?.(
      `${activeMode === "inbound" ? "Inbound Scan" : "Outbound Scan"}: Batch ${newRecord.batch} (Machine: ${newRecord.machine}) [Session]`,
      newRecord.batch,
      "In-Progress"
    );

    // Auto-clear input & maintain focus for rapid continuous scanning
    setBarcodeInput("");
    modalScannerInputRef.current?.focus();
  };

  // Auto-submit when user reaches exactly 10 characters or barcode gun fires
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const val = cleanBarcode(raw);
    setBarcodeInput(val);

    if (val.length === 10) {
      processBarcodeSubmission(val);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanBarcode(barcodeInput);
    if (cleaned) {
      processBarcodeSubmission(cleaned);
    }
  };

  // Global Hardware Scanner Listener: Captures rapid keystrokes from barcode guns even if focus temporarily drifted
  useEffect(() => {
    let keyBuffer = "";
    let lastKeyTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if (target === modalScannerInputRef.current || target === outboundScannerInputRef.current) {
        return;
      }

      if (isInput && (target as HTMLInputElement)?.value?.length > 0) {
        return;
      }

      const now = Date.now();
      if (now - lastKeyTime > 120) {
        keyBuffer = "";
      }
      lastKeyTime = now;

      if (e.key === "Enter") {
        if (keyBuffer.length >= 8) {
          const cleaned = cleanBarcode(keyBuffer);
          if (cleaned.length === 10) {
            e.preventDefault();
            if (isScannerModalOpen) {
              processBarcodeSubmission(cleaned);
            } else if (isOutboundScannerOpen) {
              processOutboundBarcodeScan(cleaned);
            }
          }
        }
        keyBuffer = "";
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        keyBuffer += e.key;
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isScannerModalOpen, isOutboundScannerOpen]);

  // Change machine for a specific row in the table
  const handleMachineChange = (id: string, newMachine: string) => {
    if (activeMode === "inbound") {
      setInboundList((prev) =>
        prev.map((r) => (r.id === id ? { ...r, machine: newMachine } : r))
      );
    } else {
      setOutboundList((prev) =>
        prev.map((r) => (r.id === id ? { ...r, machine: newMachine } : r))
      );
    }
  };

  // Delete a record
  const handleDeleteRecord = (id: string, batch: string) => {
    if (activeMode === "inbound") {
      setInboundList((prev) => prev.filter((r) => r.id !== id));
    } else {
      setOutboundList((prev) => prev.filter((r) => r.id !== id));
    }
    if (selectedRecord?.id === id) {
      setSelectedRecord(null);
    }
    onLogTransaction?.(
      `Removed ${activeMode === "inbound" ? "Inbound" : "Outbound"} record Batch ${batch}`,
      batch,
      "Completed"
    );
  };

  // Toggle selection for a specific batch in scanner modal
  const handleToggleSelectBatch = (id: string) => {
    setSelectedBatchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Toggle select all batches in current session round
  const handleToggleSelectAll = () => {
    if (selectedBatchIds.length === currentSessionBatches.length) {
      setSelectedBatchIds([]);
    } else {
      setSelectedBatchIds(currentSessionBatches.map((item) => item.id));
    }
  };

  // Delete selected batches from current session
  const handleDeleteSelected = () => {
    if (selectedBatchIds.length === 0) return;
    const count = selectedBatchIds.length;
    const remaining = currentSessionBatches.filter((r) => !selectedBatchIds.includes(r.id));
    const remainingWidthMm = remaining.reduce(
      (sum, item) => sum + getBatchWidthMm(item.batch, item.width),
      0
    );
    if (remainingWidthMm < 2000) {
      setIsInboundWidthLimitLocked(false);
    }
    setCurrentSessionBatches(remaining);
    setSelectedBatchIds([]);
    setScanStatus({
      type: "success",
      message: isThai
        ? `ลบ ${count} รายการที่เลือกออกจากรอบนี้แล้ว`
        : `Deleted ${count} selected items from this round`,
    });
  };

  // Quick individual delete of single batch from current round
  const handleDeleteRecordFromSession = (id: string, batch: string) => {
    const remaining = currentSessionBatches.filter((r) => r.id !== id);
    const remainingWidthMm = remaining.reduce(
      (sum, item) => sum + getBatchWidthMm(item.batch, item.width),
      0
    );
    if (remainingWidthMm < 2000) {
      setIsInboundWidthLimitLocked(false);
    }
    setCurrentSessionBatches(remaining);
    setSelectedBatchIds((prev) => prev.filter((x) => x !== id));
    setScanStatus({
      type: "success",
      message: isThai
        ? `ลบ Batch [${batch}] ออกจากรอบนี้แล้ว`
        : `Removed Batch [${batch}] from this round`,
    });
  };

  // Done Scanning button handler from Batch Barcode Modal -> Launches Mandatory Location Scanner Modal (or closes in Operator Receive mode)
  const handleDoneBatchScanning = () => {
    if (activeMode === "operator_receive") {
      setIsScannerModalOpen(false);
      setScanStatus(null);
      setBarcodeInput("");
      return;
    }

    if (currentSessionBatches.length === 0) {
      if (soundEnabled) playScanSound(false);
      setScanStatus({
        type: "error",
        message: isThai
          ? "ยังไม่มีรายการสแกนในรอบนี้ กรุณาสแกนบาร์โค้ด Batch อย่างน้อย 1 รายการก่อนเสร็จสิ้น"
          : "No items scanned in this round. Please scan at least 1 Batch barcode before finishing.",
      });
      modalScannerInputRef.current?.focus();
      return;
    }

    // Chained Modal Workflow: Close Batch Scanner Modal and immediately launch Location Scanner Modal
    setIsScannerModalOpen(false);
    setLocationBarcode("");
    setLocationScanError(null);
    setIsLocationModalOpen(true);
    setTimeout(() => {
      locationInputRef.current?.focus();
    }, 100);
  };

  // Confirm Location Submission: Binds location to all batches in this round, commits to table, and opens SweetAlert
  const handleConfirmLocationSubmission = (overrideLoc?: string) => {
    const finalLocation = (overrideLoc || locationBarcode).trim().toUpperCase();
    if (!finalLocation) {
      setLocationScanError(
        isThai
          ? "กรุณาสแกนหรือระบุตำแหน่งจัดเก็บ (Location ห้ามเว้นว่าง)"
          : "Please scan or specify a storage location (Cannot be empty)"
      );
      locationInputRef.current?.focus();
      return;
    }

    if (currentSessionBatches.length === 0) {
      setLocationScanError(
        isThai ? "ยังไม่มีรายการสแกนในรอบนี้" : "No items scanned in this round."
      );
      return;
    }

    // Bind this Location to all batches in current inbound round
    const finalizedMachine = selectedMachine || "SM01";
    const committedBatches: SlitBarcodeRecord[] = currentSessionBatches.map((item) => {
      const sapMatch = !item.hasSapData && sapMasterMap ? sapMasterMap.get(item.batch.trim().toUpperCase()) : null;
      const cleanConditionText =
        item.conditionText && !item.conditionText.includes("รับงานหน้าเครื่อง")
          ? item.conditionText
          : sapMatch?.conditionText || "รับเข้าคลังเรียบร้อย";
      if (sapMatch) {
        return {
          ...item,
          hasSapData: true,
          salesDoc: sapMatch.salesDoc,
          materialNo: sapMatch.materialNo,
          certThickness: sapMatch.certThickness,
          targetThickness: sapMatch.targetThickness,
          width: sapMatch.width,
          weightKg: sapMatch.weightKg,
          unrestricted: sapMatch.unrestricted,
          qualityClass: sapMatch.qualityClass,
          grade: sapMatch.grade,
          manufacturer: sapMatch.manufacturer,
          description: sapMatch.description,
          coilNo: sapMatch.coilNo,
          conditionText: cleanConditionText,
          location: finalLocation,
          storageLocation: finalLocation,
          machine: item.machine || finalizedMachine,
          status: "Inbound Completed",
        };
      }
      return {
        ...item,
        conditionText: cleanConditionText,
        location: finalLocation,
        storageLocation: finalLocation,
        machine: item.machine || finalizedMachine,
        status: "Inbound Completed",
      };
    });

    if (activeMode === "inbound") {
      committedBatches.forEach((item) => {
        removeCoilByBatch(item.batch);
      });
      setInboundList((prev) => {
        let updated = [...prev];
        for (const item of committedBatches) {
          const bKey = item.batch.trim().toUpperCase();
          const idx = updated.findIndex((r) => r.batch && r.batch.trim().toUpperCase() === bKey);
          if (idx !== -1) {
            updated[idx] = mergeSlitBarcodeRecords(updated[idx], item, sapMasterMap);
          } else {
            updated.unshift(item);
          }
        }
        return updated;
      });
    } else {
      setOutboundList((prev) => {
        let updated = [...prev];
        for (const item of committedBatches) {
          const bKey = item.batch.trim().toUpperCase();
          const idx = updated.findIndex((r) => r.batch && r.batch.trim().toUpperCase() === bKey);
          if (idx !== -1) {
            updated[idx] = mergeSlitBarcodeRecords(updated[idx], item, sapMasterMap);
          } else {
            updated.unshift(item);
          }
        }
        return updated;
      });
    }

    setSelectedLocation(finalLocation);
    setIsLocationModalOpen(false);
    setLocationScanError(null);

    // Auto-expand summary table so employee can inspect the committed batches
    setIsTableCollapsed(false);
    setCurrentPage(1);

    // Calculate totals for SweetAlert and toast
    const totalKg = committedBatches.reduce((sum, item) => sum + (item.weightKg || 0), 0);
    const totalTon = (totalKg / 1000).toFixed(3);
    const nowStr = new Date().toLocaleString(isThai ? "th-TH" : "en-GB");

    if (soundEnabled) playScanSound(true);

    // Show green notification toast
    setNotificationToast({
      type: "success",
      message: isThai
        ? `บันทึกจัดเก็บ ${committedBatches.length} รายการ เข้า Location [${finalLocation}] สำเร็จ`
        : `Successfully stored ${committedBatches.length} items to Location [${finalLocation}]`,
    });

    // Open SweetAlert-style modal with all required information
    setSweetAlertData({
      isOpen: true,
      machine: finalizedMachine,
      batchCount: committedBatches.length,
      totalWeightKg: totalKg,
      totalWeightTon: totalTon,
      location: finalLocation,
      timestamp: nowStr,
    });

    // Clear session
    setCurrentSessionBatches([]);
    setSelectedBatchIds([]);
  };

  // Confirm Inbound & Trigger Location Modal
  const handleConfirmInbound = () => {
    if (inboundList.length === 0) return;
    setLocationBarcode(selectedLocation || "");
    setLocationScanError(null);
    setIsLocationModalOpen(true);
  };

  // Close SweetAlert and reset ready for next cycle while preserving summary table
  const handleCloseSweetAlert = () => {
    // Log transaction
    onLogTransaction?.(
      `Confirmed Inbound: Machine ${sweetAlertData.machine}, ${sweetAlertData.batchCount} Batches (${sweetAlertData.totalWeightKg.toLocaleString()} kg) stored to Location ${sweetAlertData.location}`,
      `INBOUND-${Date.now()}`,
      "Completed"
    );

    // Reset machine selection ready for next cycle while keeping records in summary table
    setSelectedMachine(null);
    setSweetAlertData((prev) => ({ ...prev, isOpen: false }));
    setScanStatus(null);
  };

  // Filtered rows for current view
  const filteredList = useMemo(() => {
    if (!searchKeyword.trim()) return currentList;
    const query = searchKeyword.toLowerCase();
    return currentList.filter(
      (r) =>
        r.batch.toLowerCase().includes(query) ||
        getOrderNoForRecord(r).toLowerCase().includes(query) ||
        (r.grade || "").toLowerCase().includes(query) ||
        (r.manufacturer || "").toLowerCase().includes(query) ||
        (r.location || "").toLowerCase().includes(query) ||
        (getPreviousLocationForRecord(r) || "").toLowerCase().includes(query) ||
        (r.machine || "").toLowerCase().includes(query)
    );
  }, [currentList, searchKeyword, pickLists, movementHistoryList]);

  // Calculate metrics
  const totalWeightKg = useMemo(() => {
    return currentList.reduce((sum, item) => sum + (item.weightKg || 0), 0);
  }, [currentList]);

  const totalWeightTon = (totalWeightKg / 1000).toFixed(3);

  // Pagination calculations per AGENT.MD
  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredList.length);
  const paginatedList = useMemo(() => {
    return filteredList.slice(startIndex, endIndex);
  }, [filteredList, startIndex, endIndex]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="slit-film-management space-y-2 sm:space-y-2.5 pb-16 sm:pb-0 relative">
      {notificationToast && (
        <div className="fixed top-5 right-5 z-[100] max-w-md animate-fade-in shadow-2xl rounded-xl p-3 sm:p-4 bg-emerald-600 text-white flex items-center justify-between gap-3 border border-emerald-400">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-white/20 flex-shrink-0">
              <CheckCircle2 size={18} className="text-white" />
            </div>
            <p className="text-xs sm:text-sm font-bold">{notificationToast.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setNotificationToast(null)}
            className="p-1 hover:bg-white/20 rounded text-emerald-100 hover:text-white flex-shrink-0"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 1. Mode Switcher & Action Bar (Material Design Compact Card) - Hidden on Mobile (<640px), Visible on Desktop (>=640px) */}
      {activeMode !== "movement_history" && activeMode !== "relocate_layout" && activeMode !== "stock_balance" && activeMode !== "space_management" && activeMode !== "daily_report" && activeMode !== "equipment_inspection" && activeMode !== "transfer_car_report" && (
        <div className="hidden sm:flex w-full box-border sm:flex-nowrap items-center justify-between gap-1.5 p-1.5 sm:p-2 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs max-w-full overflow-hidden slit-top-action-bar">
          <div className="grid grid-cols-4 sm:flex sm:flex-initial items-center gap-1.5 w-full sm:w-auto flex-1 max-w-full min-w-0">
            {/* Inbound Mode Tab (+ รับเข้า) */}
            <button
              type="button"
              onClick={() => setActiveMode("inbound")}
              className={`col-span-1 w-full sm:w-auto flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 sm:px-3 rounded-lg text-[10.5px] xs:text-[11.5px] sm:text-xs font-bold leading-tight transition-all cursor-pointer box-border whitespace-nowrap min-w-0 overflow-hidden ${
                activeMode === "inbound"
                  ? "bg-emerald-600 text-white shadow-xs border border-emerald-500"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#0c1930] dark:text-slate-300 dark:hover:bg-[#152646] border border-transparent"
              }`}
              title={isThai ? "+ รับเข้า" : "+ Inbound"}
            >
              <ArrowDownRight size={14} className="flex-shrink-0" />
              <span
                className="whitespace-nowrap overflow-hidden text-ellipsis truncate min-w-0"
                style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {isThai ? "+ รับเข้า" : "+ Inbound"}
              </span>
              {inboundList.length > 0 && (
                <span
                  className={`flex-shrink-0 px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                    activeMode === "inbound" ? "bg-white/20 text-white" : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {inboundList.length}
                </span>
              )}
            </button>

            {/* Outbound Mode Tab (- เตรียมเบิก) */}
            <button
              type="button"
              onClick={() => setActiveMode("outbound")}
              className={`col-span-1 w-full sm:w-auto flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 sm:px-3 rounded-lg text-[10.5px] xs:text-[11.5px] sm:text-xs font-bold leading-tight transition-all cursor-pointer box-border whitespace-nowrap min-w-0 overflow-hidden ${
                activeMode === "outbound"
                  ? "bg-amber-600 text-white shadow-xs border border-amber-500"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#0c1930] dark:text-slate-300 dark:hover:bg-[#152646] border border-transparent"
              }`}
              title={isThai ? "- เตรียมเบิก" : "- Outbound"}
            >
              <ArrowUpRight size={14} className="flex-shrink-0" />
              <span
                className="whitespace-nowrap overflow-hidden text-ellipsis truncate min-w-0"
                style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {isThai ? "- เตรียมเบิก" : "- Outbound"}
              </span>
              {pickLists.length > 0 && (
                <span
                  className={`flex-shrink-0 px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                    activeMode === "outbound" ? "bg-white/20 text-white" : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {pickLists.length}
                </span>
              )}
            </button>

            {/* Machine Issue Mode Tab (จ่ายหน้าเครื่อง) */}
            <button
              type="button"
              onClick={() => setActiveMode("operator_receive")}
              className={`col-span-1 w-full sm:w-auto flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 sm:px-3 rounded-lg text-[10.5px] xs:text-[11.5px] sm:text-xs font-bold leading-tight transition-all cursor-pointer box-border whitespace-nowrap min-w-0 overflow-hidden ${
                activeMode === "operator_receive"
                  ? "bg-blue-600 text-white shadow-xs border border-blue-500"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#0c1930] dark:text-slate-300 dark:hover:bg-[#152646] border border-transparent"
              }`}
              title={isThai ? "จ่ายหน้าเครื่อง" : "Machine Issue"}
            >
              <Cpu size={14} className="flex-shrink-0" />
              <span
                className="whitespace-nowrap overflow-hidden text-ellipsis truncate min-w-0"
                style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {isThai ? "จ่ายหน้าเครื่อง" : "Machine Issue"}
              </span>
              {pickLists.filter((o) => o.status === "completed" || o.status === "in_progress").length > 0 && (
                <span
                  className={`flex-shrink-0 px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                    activeMode === "operator_receive" ? "bg-white/20 text-white" : "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                  }`}
                >
                  {pickLists.filter((o) => o.status === "completed" || o.status === "in_progress").length}
                </span>
              )}
            </button>

            {/* Return to Warehouse Mode Tab (↩ คืนคลัง) */}
            <button
              type="button"
              onClick={() => setActiveMode("return_warehouse")}
              className={`col-span-1 w-full sm:w-auto flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 sm:px-3 rounded-lg text-[10.5px] xs:text-[11.5px] sm:text-xs font-bold leading-tight transition-all cursor-pointer box-border whitespace-nowrap min-w-0 overflow-hidden ${
                activeMode === "return_warehouse"
                  ? "bg-orange-600 text-white shadow-xs border border-orange-500"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#0c1930] dark:text-slate-300 dark:hover:bg-[#152646] border border-transparent"
              }`}
              title={isThai ? "↩ คืนคลัง" : "↩ Return"}
            >
              <RotateCcw size={14} className="flex-shrink-0" />
              <span
                className="whitespace-nowrap overflow-hidden text-ellipsis truncate min-w-0"
                style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {isThai ? "↩ คืนคลัง" : "↩ Return"}
              </span>
              {returnableBatches.length > 0 && (
                <span
                  className={`flex-shrink-0 px-1.5 py-0.2 rounded-full text-[9px] font-extrabold ${
                    activeMode === "return_warehouse" ? "bg-white/20 text-white" : "bg-orange-500/20 text-orange-600 dark:text-orange-400"
                  }`}
                >
                  {returnableBatches.length}
                </span>
              )}
            </button>
          </div>

          {/* Utilities: Sound & Reset */}
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0 pt-1 sm:pt-0">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="inline-flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-[11px] font-semibold border bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#172b4d]"
              title={isThai ? "เปิด/ปิดเสียงสแกน" : "Toggle Sound"}
            >
              {soundEnabled ? <Volume2 size={13} className="text-emerald-500" /> : <VolumeX size={13} className="text-slate-400" />}
              <span className="hidden sm:inline">{soundEnabled ? "ON" : "OFF"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                Swal.fire({
                  title: isThai ? "ล้างข้อมูลธุรกรรมทั้งหมด?" : "Reset All Transactions?",
                  text: isThai ? "การดำเนินการนี้จะลบข้อมูลรับเข้า จ่ายออก และประวัติทั้งหมด เพื่อเริ่มทดสอบใหม่" : "This will clear all inbound, outbound, and history data for fresh testing.",
                  icon: "warning",
                  showCancelButton: true,
                  confirmButtonText: isThai ? "ล้างข้อมูล" : "Reset",
                  cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
                  confirmButtonColor: "#dc2626",
                }).then((result) => {
                  if (result.isConfirmed) {
                    localStorage.removeItem(STORAGE_KEY_INBOUND);
                    localStorage.removeItem(STORAGE_KEY_OUTBOUND);
                    localStorage.removeItem(STORAGE_KEY_PICK_LISTS);
                    localStorage.removeItem(STORAGE_KEY_SAP_MASTER);
                    localStorage.removeItem("tmt_wms_space_management_data_v1");
                    resetAllMachineStagingToEmpty();
                    setInboundList([]);
                    setOutboundList([]);
                    setPickLists([]);
                    setSapMasterMap(new Map());
                    Swal.fire({
                      icon: "success",
                      title: isThai ? "ล้างข้อมูลสำเร็จ" : "Reset Successful",
                      timer: 1500,
                      showConfirmButton: false,
                    });
                  }
                });
              }}
              className="inline-flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-[11px] font-semibold border bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer"
              title={isThai ? "ล้างข้อมูลธุรกรรมทั้งหมดเพื่อทดสอบ" : "Reset All Transactions"}
            >
              <Trash2 size={13} />
              <span className="hidden sm:inline">{isThai ? "รีเซ็ตข้อมูล" : "Reset Data"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Daily Report View (รายงานประจำวัน) */}
      {activeMode === "daily_report" && (
        <DailyReportView
          inboundList={inboundList}
          outboundList={outboundList}
          movementHistoryList={movementHistoryList}
          pickLists={pickLists}
          sapMasterMap={sapMasterMap}
        />
      )}

      {/* Equipment Inspection View (ตรวจสอบอุปกรณ์) */}
      {activeMode === "equipment_inspection" && (
        <EquipmentInspectionView isThai={isThai} />
      )}

      {/* Space Management View (พื้นที่) */}
      {activeMode === "space_management" && (
        <SpaceManagementView isThai={isThai} />
      )}

      {/* Transfer Car Monthly Report View (รายงาน Transfer Car ประจำเดือน TM06 & TM07) */}
      {activeMode === "transfer_car_report" && (
        <TransferCarReport
          pickLists={pickLists}
          outboundList={outboundList}
          movementHistoryList={movementHistoryList}
          sapMasterMap={sapMasterMap}
          isThai={isThai}
        />
      )}

      {/* 2. Inbound Workflow: Machine Selection (Compact Android Material Design Grid) */}
      {activeMode === "inbound" && (
        <section className="p-2 sm:p-2.5 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 mb-2 border-b border-slate-100 dark:border-[#1e3a5f]/60">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Cpu size={14} className="text-emerald-500" />
              <span>
                {isThai
                  ? `เลือกเครื่องจักรรับเข้า (${inboundMachines[0] || "SM01"} - ${inboundMachines[inboundMachines.length - 1] || "SM04"}):`
                  : `Select Inbound Machine (${inboundMachines[0] || "SM01"} - ${inboundMachines[inboundMachines.length - 1] || "SM04"}):`}
              </span>
            </span>

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] font-mono font-medium text-slate-400">
                {isThai ? "แตะเพื่อเริ่มสแกน" : "Tap to scan"}
              </span>
              <button
                type="button"
                onClick={handleOpenAddInboundMachine}
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer active:scale-95 transition-all"
              >
                <Plus size={13} />
                <span>{isThai ? "เพิ่มเครื่องใหม่" : "Add Machine"}</span>
              </button>
            </div>
          </div>

          {/* Machine Cards in a tight, structured Android Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
            {inboundMachines.map((machineId) => {
              const isSelected = selectedMachine === machineId;
              const machineBatchCount = inboundList.filter((item) => item.machine === machineId).length;
              const isCustomMachine = !AVAILABLE_MACHINES.includes(machineId);

              return (
                <button
                  key={machineId}
                  type="button"
                  onClick={() => handleSelectMachineAndOpenScanner(machineId)}
                  className={`group relative flex flex-col items-center justify-center py-2 px-2 sm:py-2.5 sm:px-3 rounded-xl border transition-all active:scale-[0.98] cursor-pointer min-h-[66px] sm:min-h-[72px] ${
                    isSelected
                      ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/25 ring-2 ring-emerald-400/60"
                      : "bg-slate-50/70 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-100 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-[#152646] shadow-xs"
                  }`}
                >
                  {isCustomMachine && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleDeleteInboundMachine(machineId, e)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          handleDeleteInboundMachine(machineId, e as unknown as React.MouseEvent);
                        }
                      }}
                      title={isThai ? `ลบเครื่อง ${machineId}` : `Remove ${machineId}`}
                      className={`absolute top-1.5 left-1.5 p-1 rounded-md transition-colors ${
                        isSelected
                          ? "text-emerald-100 hover:bg-white/20 hover:text-white"
                          : "text-slate-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 hover:text-rose-600 dark:hover:text-rose-400"
                      }`}
                    >
                      <Trash2 size={11} />
                    </span>
                  )}

                  <div className="flex items-center gap-1 mb-0.5">
                    <span className={`text-[9px] font-extrabold uppercase tracking-wider ${isSelected ? "text-emerald-100" : "text-slate-500 dark:text-slate-400"}`}>
                      {isThai ? "เครื่องจักร" : "Machine"}
                    </span>
                    {machineBatchCount > 0 && (
                      <span className={`px-1 py-0.2 rounded-full text-[9px] font-mono font-extrabold ${isSelected ? "bg-white/20 text-white" : "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"}`}>
                        {machineBatchCount}
                      </span>
                    )}
                  </div>

                  <div className={`text-lg sm:text-xl font-black font-mono tracking-tight leading-none ${isSelected ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>
                    {machineId}
                  </div>

                  <div className={`text-[10px] font-semibold mt-1 flex items-center gap-1 ${isSelected ? "text-emerald-100" : "text-emerald-600 dark:text-emerald-400"}`}>
                    <Barcode size={12} />
                    <span>{isThai ? "แตะเพื่อสแกน" : "Scan"}</span>
                  </div>

                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 p-0.5 rounded-full bg-white/25 text-white">
                      <Check size={10} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Add New Inbound Machine Modal */}
          {isAddInboundMachineOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
              onMouseDown={() => setIsAddInboundMachineOpen(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="p-3.5 sm:p-4 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <Cpu size={18} />
                    </div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                      {isThai ? "เพิ่มเครื่องจักรรับเข้าใหม่" : "Add New Inbound Machine"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddInboundMachineOpen(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleAddInboundMachineSubmit} className="p-4 space-y-3">
                  {addInboundMachineError && (
                    <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle size={15} className="flex-shrink-0" />
                      <span>{addInboundMachineError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {isThai ? "รหัสเครื่องจักร (Machine ID):" : "Machine ID:"}
                    </label>
                    <input
                      type="text"
                      value={newInboundMachineCode}
                      onChange={(e) => {
                        setNewInboundMachineCode(e.target.value.toUpperCase());
                        if (addInboundMachineError) setAddInboundMachineError(null);
                      }}
                      placeholder={isThai ? "เช่น SM05, SM06..." : "e.g. SM05, SM06..."}
                      autoFocus
                      maxLength={12}
                      className="w-full px-3.5 py-2.5 text-sm font-mono font-black tracking-wider rounded-xl bg-white dark:bg-[#0c1930] border-2 border-emerald-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-[#1e3a5f]">
                    <button
                      type="button"
                      onClick={() => setIsAddInboundMachineOpen(false)}
                      className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#172b4d] border border-slate-300 dark:border-[#1e3a5f] cursor-pointer"
                    >
                      {isThai ? "ยกเลิก" : "Cancel"}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                    >
                      <Plus size={14} />
                      <span>{isThai ? "บันทึกเพิ่มเครื่อง" : "Add Machine"}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Quick Rescan Launcher when Machine is already selected */}
          {selectedMachine && (
            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-[#1e3a5f]/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                <CheckCircle2 size={14} className="text-emerald-500" />
                <span>
                  {isThai
                    ? `เครื่องปัจจุบัน: [ ${selectedMachine} ] · Location: [ ${selectedLocation} ]`
                    : `Machine: [ ${selectedMachine} ] · Location: [ ${selectedLocation} ]`}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setBarcodeInput("");
                  setScanStatus(null);
                  setIsScannerModalOpen(true);
                }}
                className="py-1 px-3 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center gap-1 cursor-pointer active:scale-95"
              >
                <Barcode size={13} />
                <span>{isThai ? `+ สแกนต่อ [ ${selectedMachine} ]` : `+ Scan [ ${selectedMachine} ]`}</span>
              </button>
            </div>
          )}
        </section>
      )}

      {/* 2. Outbound Workflow: Officer Import & Inspector Machine & Order Selection */}
      {activeMode === "outbound" && (
        <section className="space-y-2 sm:space-y-2.5">
          {/* Machine Category Tabs (4 Groups) */}
          <div className="p-2 sm:p-2.5 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-[#1e3a5f]/60 pb-1.5">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Factory size={14} className="text-amber-500" />
                <span>
                  {isThai
                    ? `เลือกกลุ่มประเภทเครื่องจักร (${outboundMachines.length} เครื่อง):`
                    : `Select Machine Category (${outboundMachines.length} Machines):`}
                </span>
              </span>

              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-[10px] font-mono text-slate-400">
                  {isThai ? `${outboundMachines.length} เครื่อง` : `${outboundMachines.length} Machines`}
                </span>
                <button
                  type="button"
                  onClick={handleOpenAddOutboundMachine}
                  className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer active:scale-95 transition-all"
                >
                  <Plus size={13} />
                  <span>{isThai ? "เพิ่มเครื่องใหม่" : "Add Machine"}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
              {MACHINE_CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.key;
                const catCount = outboundMachines.filter((m) => m.type === cat.key).length;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      setActiveCategory(cat.key);
                      // Auto pick first machine in this category
                      const firstM = outboundMachines.find((m) => m.type === cat.key);
                      if (firstM) setSelectedOutboundMachine(firstM.id);
                    }}
                    className={`py-1.5 px-1 sm:px-2 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all border flex items-center justify-between cursor-pointer ${
                      isActive
                        ? "bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-indigo-500 shadow-sm ring-2 ring-indigo-400/40"
                        : "bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#1e3a5f] hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-[#132240]"
                    }`}
                  >
                    <span>{isThai ? cat.labelTh : cat.labelEn}</span>
                    <span className={`px-1 py-0.2 rounded text-[9px] font-mono font-extrabold ${isActive ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                      {catCount}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Zone Divider Line & Machine Number Header */}
            <div className="pt-2 mt-1 border-t border-slate-100 dark:border-[#1e3a5f]/60 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span>{isThai ? "เลือกหมายเลขเครื่องจักร:" : "Select Machine No.:"}</span>
                <span className="text-amber-600 dark:text-amber-400 font-mono font-black">
                  [ {MACHINE_CATEGORIES.find((c) => c.key === activeCategory)?.labelTh} ]
                </span>
              </span>
            </div>

            {/* Compact Machine Buttons for Active Category */}
            <div className="grid grid-cols-4 sm:grid-cols-7 lg:grid-cols-11 gap-1.5 pt-0.5">
              {outboundMachines.filter((m) => m.type === activeCategory).map((m) => {
                const isMSelected = selectedOutboundMachine === m.id;
                const mOrders = pickLists.filter((o) => o.machineId === m.id);
                const activeOrdersCount = mOrders.filter((o) => o.status !== "completed").length;
                const isCustomOutboundMachine = !OUTBOUND_MACHINES.some((def) => def.id === m.id);

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedOutboundMachine(m.id);
                    }}
                    className={`relative py-1.5 px-1 sm:px-2 rounded-lg border transition-all active:scale-95 cursor-pointer text-center min-h-[50px] flex flex-col justify-center items-center ${
                      isMSelected
                        ? "bg-amber-600 text-white border-amber-500 shadow-xs ring-1 ring-amber-400/50"
                        : "bg-white dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-100 hover:border-amber-500 hover:bg-amber-50/30 dark:hover:bg-[#152646]"
                    }`}
                  >
                    {isCustomOutboundMachine && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleDeleteOutboundMachine(m.id, e)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            handleDeleteOutboundMachine(m.id, e as unknown as React.MouseEvent);
                          }
                        }}
                        title={isThai ? `ลบเครื่อง ${m.id}` : `Remove ${m.id}`}
                        className={`absolute top-0.5 left-0.5 p-0.5 rounded transition-colors ${
                          isMSelected
                            ? "text-amber-100 hover:bg-white/20 hover:text-white"
                            : "text-slate-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 hover:text-rose-600 dark:hover:text-rose-400"
                        }`}
                      >
                        <Trash2 size={9} />
                      </span>
                    )}

                    <div className="text-sm sm:text-base font-black font-mono leading-none">
                      {m.id}
                    </div>

                    {/* Badge for Order Count */}
                    <div className="mt-1 flex items-center justify-center">
                      <span
                        className={`px-1 py-0.2 rounded-full text-[9px] font-bold leading-tight ${
                          activeOrdersCount > 0
                            ? isMSelected
                              ? "bg-white text-amber-800"
                              : "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                            : isMSelected
                            ? "bg-amber-700 text-white opacity-80"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                        }`}
                      >
                        {activeOrdersCount > 0 ? `${activeOrdersCount} ใบ` : "ว่าง"}
                      </span>
                    </div>

                    {isMSelected && (
                      <div className="absolute top-1 right-1 p-0.5 rounded-full bg-white/20 text-white">
                        <Check size={8} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add New Outbound Machine Modal */}
          {isAddOutboundMachineOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
              onMouseDown={() => setIsAddOutboundMachineOpen(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="p-3.5 sm:p-4 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      <Factory size={18} />
                    </div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                      {isThai ? "เพิ่มเครื่องจักรใหม่ (เตรียมเบิก)" : "Add New Outbound Machine"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddOutboundMachineOpen(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleAddOutboundMachineSubmit} className="p-4 space-y-3">
                  {addOutboundMachineError && (
                    <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle size={15} className="flex-shrink-0" />
                      <span>{addOutboundMachineError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {isThai ? "กลุ่มประเภทเครื่องจักร:" : "Machine Category:"}
                    </label>
                    <select
                      value={newOutboundMachineCategory}
                      onChange={(e) => {
                        const nextCat = e.target.value as "pipe" | "c_channel" | "mini" | "lip_channel";
                        setNewOutboundMachineCategory(nextCat);
                        setNewOutboundMachineCode(getSuggestedNextOutboundMachine(nextCat, outboundMachines));
                        if (addOutboundMachineError) setAddOutboundMachineError(null);
                      }}
                      className="w-full px-3 py-2 text-xs font-bold rounded-xl bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      <option value="pipe">{isThai ? "TM - ผลิตท่อ (Pipe Mill)" : "TM - Pipe Mill"}</option>
                      <option value="c_channel">{isThai ? "CF - ตัวซี (C-Channel)" : "CF - C-Channel"}</option>
                      <option value="mini">{isThai ? "มินิ - Mini Line (ML)" : "ML - Mini Line"}</option>
                      <option value="lip_channel">{isThai ? "ตัวซีมีขอบ - Lip Channel (ZF)" : "ZF - Lip Channel"}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {isThai ? "รหัสเครื่องจักร (Machine ID):" : "Machine ID:"}
                    </label>
                    <input
                      type="text"
                      value={newOutboundMachineCode}
                      onChange={(e) => {
                        setNewOutboundMachineCode(e.target.value.toUpperCase());
                        if (addOutboundMachineError) setAddOutboundMachineError(null);
                      }}
                      placeholder={isThai ? "เช่น TM15, CF06, ML03, ZF03..." : "e.g. TM15, CF06..."}
                      autoFocus
                      maxLength={12}
                      className="w-full px-3.5 py-2.5 text-sm font-mono font-black tracking-wider rounded-xl bg-white dark:bg-[#0c1930] border-2 border-amber-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-amber-500/20"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-[#1e3a5f]">
                    <button
                      type="button"
                      onClick={() => setIsAddOutboundMachineOpen(false)}
                      className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#172b4d] border border-slate-300 dark:border-[#1e3a5f] cursor-pointer"
                    >
                      {isThai ? "ยกเลิก" : "Cancel"}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/25 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                    >
                      <Plus size={14} />
                      <span>{isThai ? "บันทึกเพิ่มเครื่อง" : "Add Machine"}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Active Machine Orders Collapsible Cards Section (Compact Android Style) */}
          <div className="p-2 sm:p-2.5 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs space-y-1.5 sm:space-y-2">
            {/* Machine Section Toolbar Header */}
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-[#1e3a5f]/60">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div className="p-1 sm:p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex-shrink-0">
                  <ClipboardList size={14} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10.5px] sm:text-[11px] font-mono font-black text-amber-600 dark:text-amber-400">
                      [ เครื่อง {selectedOutboundMachine} ]
                    </span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {machineOrders.length} {isThai ? "ใบสั่ง" : "orders"}
                    </span>
                  </div>
                  <h3 className="text-[11px] sm:text-xs font-extrabold text-slate-900 dark:text-slate-100 leading-tight truncate">
                    {isThai ? "รายการใบสั่งเบิกวัตถุดิบ (Pick List Orders)" : "Pick List Orders"}
                  </h3>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Import Pick List Button - Desktop View Only (hidden on Mobile <640px) */}
                <button
                  type="button"
                  onClick={() => {
                    setImportMachineId(selectedOutboundMachine);
                    setIsImportModalOpen(true);
                  }}
                  className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer active:scale-95"
                >
                  <Plus size={13} />
                  <span>{isThai ? "นำเข้าใบเบิก" : "Import Pick List"}</span>
                </button>
              </div>
            </div>

            {/* Render Each Order as a Collapsible Card (Accordion Item) */}
            {machineOrders.length > 0 ? (
              <div className="space-y-1.5 sm:space-y-2">
                {machineOrders.map((order) => {
                  const isExpanded = expandedOrderNos.includes(order.orderNo);
                  const validItems = order.items.filter((i) => Boolean(i.batch && /^[A-Za-z0-9]{10}$/.test(i.batch.trim())));
                  const verifiedItems = validItems.filter((i) => isItemMachineIssued(i));
                  const verifiedWeight = verifiedItems.reduce((sum, i) => sum + (i.reqQty || 0), 0);
                  const totalWeight = validItems.reduce((sum, i) => sum + (i.reqQty || 0), 0);

                  const scannedCount = verifiedItems.length;
                  const totalCount = validItems.length;
                  const dynamicStatus =
                    totalCount === 0 || scannedCount === 0
                      ? "pending"
                      : scannedCount === totalCount
                      ? "completed"
                      : "in_progress";

                  return (
                    <div
                      key={order.orderNo}
                      className="rounded-xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-xs overflow-hidden transition-all"
                    >
                      {/* Card Header (Collapsible Accordion Bar - Compact Single Row) */}
                        <div
                          onClick={(e) => toggleOrderExpand(order.orderNo, e)}
                          className="py-1.5 px-1.5 sm:py-2 sm:px-2.5 bg-slate-50/90 dark:bg-[#0d1b33] border-b border-slate-200/80 dark:border-[#1e3a5f] flex flex-wrap sm:flex-nowrap items-center justify-between gap-1 sm:gap-2 cursor-pointer hover:bg-slate-100/80 dark:hover:bg-[#122442] transition-colors"
                        >
                          <div className="flex items-center gap-1 sm:gap-1.5 flex-1">
                            {/* Toggle Arrow Icon */}
                            <div className="p-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex-shrink-0">
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </div>

                            <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap">
                              <span className="font-mono font-black text-[10.5px] sm:text-xs text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {`ใบสั่งเบิก: ${order.orderNo}`}
                              </span>

                              <span
                                className={`flex-shrink-0 px-1 sm:px-1.5 py-0.2 rounded text-[8.5px] sm:text-[10px] font-bold border leading-tight ${
                                  dynamicStatus === "completed"
                                    ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
                                    : dynamicStatus === "in_progress"
                                    ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800"
                                    : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                                }`}
                              >
                                {dynamicStatus === "completed"
                                  ? "เบิกสำเร็จ"
                                  : dynamicStatus === "in_progress"
                                  ? "กำลังเตรียม"
                                  : "รอเตรียม"}
                              </span>
                            </div>
                          </div>

                          {/* Card Header Quick Actions (Same row as Order No., compact size matching header) */}
                          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedOrderNo(order.orderNo);
                                setOutboundBarcodeInput("");
                                setOutboundScanStatus(null);
                                setIsOutboundScannerOpen(true);
                              }}
                              className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[9.5px] sm:text-[11px] font-bold leading-tight bg-amber-600 hover:bg-amber-700 text-white shadow-2xs inline-flex items-center gap-0.5 sm:gap-1 cursor-pointer active:scale-95 whitespace-nowrap"
                            >
                              <Barcode size={10} />
                              <span>สแกนบาร์โค้ด</span>
                            </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteModalOrderNo(order.orderNo);
                            }}
                            className="hidden p-1 sm:p-1.5 rounded-lg text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-950/50 hover:text-rose-700 cursor-pointer"
                            title="ลบใบสั่งนี้"
                          >
                            <Trash2 size={14} />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => toggleOrderExpand(order.orderNo, e)}
                            className="hidden px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg text-[10.5px] sm:text-xs font-semibold bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 items-center gap-0.5 sm:gap-1 cursor-pointer"
                          >
                            <span>{isExpanded ? "ย่อ" : "ดูรายการ"}</span>
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </div>
                      </div>

                      {/* Card Collapsible Content Body */}
                      {isExpanded && (
                        <div className="p-2 sm:p-2.5 space-y-2 bg-white dark:bg-[#111e38]">
                          {/* Compact Details Banner: Machine, Date/Time, Batch Count & Total Weight */}
                          <div className="p-1.5 sm:p-2 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
                            <div>
                              <span className="text-[9.5px] sm:text-[10px] text-slate-400 block uppercase font-semibold leading-tight">เครื่องจักร</span>
                              <span className="font-mono font-bold text-amber-600 dark:text-amber-400 text-[11px] sm:text-xs">
                                เครื่อง {order.machineId}
                              </span>
                            </div>

                            <div>
                              <span className="text-[9.5px] sm:text-[10px] text-slate-400 block uppercase font-semibold leading-tight">วันที่เวลาบันทึก</span>
                              <span className="font-mono text-slate-700 dark:text-slate-300 text-[10.5px] sm:text-[11px]">
                                {order.createdDate} {order.createdAt}
                              </span>
                            </div>

                            <div>
                              <span className="text-[9.5px] sm:text-[10px] text-slate-400 block uppercase font-semibold leading-tight">จำนวน Batch</span>
                              <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px] sm:text-xs">
                                {validItems.length} รายการ (สแกน {verifiedItems.length}/{validItems.length})
                              </span>
                            </div>

                            <div>
                              <span className="text-[9.5px] sm:text-[10px] text-slate-400 block uppercase font-semibold leading-tight">น้ำหนักเตรียม / ยอดรวม</span>
                              <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-[11px] sm:text-xs">
                                {verifiedWeight.toLocaleString()} / {totalWeight.toLocaleString()} kg
                              </span>
                            </div>
                          </div>

                          {/* Ultra-Compact Android Items Table (6 Columns: No., Batch, หนา x กว้าง, Req Qty, Location, Status) */}
                          {(() => {
                            const totalItemsCount = validItems.length;
                            const totalPages = Math.max(1, Math.ceil(totalItemsCount / pickListItemPageSize));
                            const rawPage = pickListItemPages[order.orderNo] || 1;
                            const currentPage = Math.min(Math.max(1, rawPage), totalPages);
                            const startIndex = (currentPage - 1) * pickListItemPageSize;
                            const endIndex = Math.min(startIndex + pickListItemPageSize, totalItemsCount);
                            const paginatedValidItems = validItems.slice(startIndex, endIndex);

                            const setOrderPage = (newPage: number) => {
                              setPickListItemPages((prev) => ({
                                ...prev,
                                [order.orderNo]: Math.min(Math.max(1, newPage), totalPages),
                              }));
                            };

                            return (
                              <div className="overflow-x-auto max-w-full rounded-lg border border-slate-200 dark:border-[#1e3a5f]">
                                <table className="w-full border-collapse text-[10px] sm:text-xs whitespace-nowrap">
                                  <colgroup>
                                    <col className="w-10 sm:w-12" />
                                    <col className="w-24 sm:w-32" />
                                    <col className="w-32 sm:w-44" />
                                    <col className="w-20 sm:w-28" />
                                    <col className="w-24 sm:w-32" />
                                    <col className="w-20 sm:w-28" />
                                  </colgroup>
                                  <thead>
                                    <tr className="bg-slate-100/80 dark:bg-[#0d1b33] text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-[#1e3a5f] font-bold uppercase tracking-wider text-[10px] sm:text-xs">
                                      <th className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center align-middle">No.</th>
                                      <th className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center align-middle">Batch</th>
                                      <th className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center align-middle">
                                        {isThai ? "หนา x กว้าง (mm)" : "Thick x Width"}
                                      </th>
                                      <th className="!py-1.5 !px-1.5 sm:!px-2.5 !text-right align-middle">Req Qty</th>
                                      <th className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center align-middle">Location</th>
                                      <th className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center align-middle">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[10px] sm:text-[11px] leading-tight">
                                    {paginatedValidItems.map((item, idx) => {
                                      const bKey = item.batch.trim().toUpperCase();
                                      const matchedLoc = findInboundLocation(item.batch);
                                      const isVerified = item.status === "verified";
                                      const rowNumber = startIndex + idx + 1;

                                      const sapRec = sapMasterMap.get(bKey);
                                      const inbRec = inboundList.find((r) => r.batch.trim().toUpperCase() === bKey);
                                      const outRec = outboundList.find((r) => r.batch.trim().toUpperCase() === bKey);

                                      const rawThick =
                                        sapRec?.certThickness ||
                                        sapRec?.targetThickness ||
                                        inbRec?.certThickness ||
                                        inbRec?.targetThickness ||
                                        outRec?.certThickness ||
                                        outRec?.targetThickness ||
                                        "";
                                      const rawWidth =
                                        sapRec?.width ||
                                        inbRec?.width ||
                                        outRec?.width ||
                                        "";

                                      const isValidDim = (v: string) =>
                                        Boolean(v && v !== "-" && v !== "รอข้อมูล SAP" && v !== "รอระบบ SAP");

                                      let dimensionDisplay = "-";
                                      if (isValidDim(rawThick) || isValidDim(rawWidth)) {
                                        dimensionDisplay = `${formatDimension2Decimals(
                                          isValidDim(rawThick) ? rawThick : "-",
                                          "-"
                                        )} x ${formatDimension2Decimals(
                                          isValidDim(rawWidth) ? rawWidth : "-",
                                          "-"
                                        )}`;
                                      } else if (item.description) {
                                        const dimMatch = item.description.match(
                                          /(\d+(?:\.\d+)?)\s*(?:mm|มม\.?)?\s*[xX*×]\s*(\d+(?:\.\d+)?)/
                                        );
                                        if (dimMatch) {
                                          dimensionDisplay = `${parseFloat(dimMatch[1]).toFixed(2)} mm x ${parseFloat(dimMatch[2]).toFixed(2)} mm`;
                                        }
                                      }

                                      return (
                                        <tr
                                          key={item.id}
                                          className={`transition-colors ${
                                            isVerified
                                              ? "bg-emerald-50/60 dark:bg-emerald-950/20 text-slate-900 dark:text-slate-100"
                                              : "hover:bg-slate-50 dark:hover:bg-[#152646] text-slate-800 dark:text-slate-200"
                                          }`}
                                        >
                                          <td className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center font-mono text-slate-400 align-middle">
                                            {rowNumber}
                                          </td>
                                          <td className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center font-mono font-black text-amber-600 dark:text-amber-400 align-middle">
                                            {item.batch.trim()}
                                          </td>
                                          <td className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center font-mono font-semibold text-slate-700 dark:text-slate-200 align-middle">
                                            {dimensionDisplay}
                                          </td>
                                          <td className="!py-1.5 !px-1.5 sm:!px-2.5 font-mono font-bold !text-right align-middle">
                                            {item.reqQty > 0 ? item.reqQty.toLocaleString() : "-"}
                                          </td>
                                          <td className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center font-mono align-middle">
                                            <div className="inline-flex items-center justify-center">
                                              {matchedLoc ? (
                                                <span className="px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10px] font-bold bg-cyan-100 dark:bg-cyan-950/80 text-cyan-800 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
                                                  📍 {matchedLoc}
                                                </span>
                                              ) : (
                                                <span className="px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-400">
                                                  {item.storageLocation ? `SAP: ${item.storageLocation}` : "ไม่ระบุ"}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="!py-1.5 !px-1.5 sm:!px-2.5 !text-center align-middle">
                                            <div className="inline-flex items-center justify-center">
                                              {isVerified ? (
                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                                                  <Check size={11} />
                                                  <span>{isThai ? "เตรียมแล้ว" : "Prepared"}</span>
                                                </span>
                                              ) : (
                                                <span className="px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                                                  {isThai ? "รอเตรียม" : "Pending"}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>

                                {/* Compact Pagination Footer for Pick List Orders Table */}
                                <div className="px-1.5 py-1 sm:px-3 sm:py-1.5 bg-slate-50 dark:bg-[#0c1930] border-t border-slate-200 dark:border-[#1e3a5f] flex flex-nowrap items-center justify-between gap-1 sm:gap-2 text-[9.5px] sm:text-xs whitespace-nowrap overflow-x-auto">
                                  <div className="text-slate-600 dark:text-slate-300 font-medium text-[9.5px] sm:text-[11px] whitespace-nowrap">
                                    {isThai
                                      ? `แสดง ${totalItemsCount === 0 ? 0 : startIndex + 1}-${endIndex} จาก ${totalItemsCount}`
                                      : `${totalItemsCount === 0 ? 0 : startIndex + 1}-${endIndex} of ${totalItemsCount}`}
                                  </div>

                                  <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                                    <div className="flex items-center gap-0.5 sm:gap-1 text-[9.5px] sm:text-[11px] text-slate-500 dark:text-slate-400">
                                      <span>{isThai ? "แถว:" : "Rows:"}</span>
                                      <select
                                        value={pickListItemPageSize}
                                        onChange={(e) => {
                                          setPickListItemPageSize(Number(e.target.value));
                                          setOrderPage(1);
                                        }}
                                        className="px-1 py-0.5 text-[9.5px] sm:text-xs rounded bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 cursor-pointer"
                                      >
                                        <option value={5}>5</option>
                                        <option value={10}>10</option>
                                        <option value={20}>20</option>
                                      </select>
                                    </div>

                                    <div className="flex items-center gap-0.5 sm:gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setOrderPage(1)}
                                        disabled={currentPage <= 1}
                                        className="p-0.5 sm:p-1 rounded border text-[9.5px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                        title={isThai ? "หน้าแรก" : "First page"}
                                      >
                                        <ChevronsLeft size={11} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setOrderPage(currentPage - 1)}
                                        disabled={currentPage <= 1}
                                        className="px-1 py-0.5 sm:px-1.5 rounded border text-[9.5px] sm:text-[11px] font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 cursor-pointer"
                                      >
                                        <ChevronLeft size={11} />
                                        <span className="hidden sm:inline">{isThai ? "ก่อนหน้า" : "Prev"}</span>
                                      </button>

                                      <div className="px-1.5 py-0.5 sm:px-2 rounded bg-slate-200/60 dark:bg-[#111e38] font-mono text-[9.5px] sm:text-[11px] font-bold text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-[#1e3a5f]">
                                        {currentPage}/{totalPages}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => setOrderPage(currentPage + 1)}
                                        disabled={currentPage >= totalPages}
                                        className="px-1 py-0.5 sm:px-1.5 rounded border text-[9.5px] sm:text-[11px] font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 cursor-pointer"
                                      >
                                        <span className="hidden sm:inline">{isThai ? "ถัดไป" : "Next"}</span>
                                        <ChevronRight size={11} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setOrderPage(totalPages)}
                                        disabled={currentPage >= totalPages}
                                        className="p-0.5 sm:p-1 rounded border text-[9.5px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                        title={isThai ? "หน้าสุดท้าย" : "Last page"}
                                      >
                                        <ChevronsRight size={11} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Compact Footer Action Bar for Order */}
                          <div className="p-2 sm:p-2.5 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300">
                              <span>{isThai ? "ยอดรวมเตรียมแล้ว: " : "Verified Weight: "}</span>
                              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-extrabold text-xs sm:text-sm ml-1">
                                {verifiedWeight.toLocaleString()} kg
                              </span>
                              <span className="text-slate-400 text-[10.5px] sm:text-[11px] ml-1">
                                ({verifiedItems.length}/{validItems.length} Batch)
                              </span>
                            </div>

                            <div className="flex items-center gap-2 ml-auto">
                              {scannedCount === totalCount && totalCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmOutboundFinal(order.orderNo)}
                                  className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[11px] sm:text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer active:scale-95"
                                >
                                  <CheckCircle2 size={13} />
                                  <span>{isThai ? "ครบตามจำนวน/ยืนยัน" : "Completed / Confirm"}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSaveOutboundDraft(order.orderNo)}
                                  className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[11px] sm:text-xs font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer active:scale-95"
                                >
                                  <Save size={13} />
                                  <span>{isThai ? "บันทึกไว้ก่อน" : "Save Draft"}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-400 text-xs">
                {isThai ? "ยังไม่มีใบสั่งเบิกในเครื่องจักรนี้ กรุณากดปุ่ม '+ นำเข้าใบเบิกเพิ่ม' ด้านบนเพื่อเริ่มต้น" : "No pick list orders for this machine. Click '+ Import Pick List' above."}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 3. Operator Receive Workflow: Operator Scan & Receive at Machine Side */}
      {activeMode === "operator_receive" && (
        <section className="space-y-2 sm:space-y-2.5">
          {/* Machine Category Tabs (4 Groups) */}
          <div className="p-2 sm:p-2.5 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs space-y-2">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#1e3a5f]/60 pb-1.5">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Cpu size={14} className="text-blue-500" />
                <span>
                  {isThai
                    ? `เลือกเครื่องจักรสำหรับ Operator รับงานหน้าเครื่อง (${outboundMachines.length} เครื่อง):`
                    : `Select Machine for Operator Receive (${outboundMachines.length} Machines):`}
                </span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {isThai ? "รับหน้าเครื่อง" : "Operator Receive"}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {MACHINE_CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.key;
                const catCount = outboundMachines.filter((m) => m.type === cat.key).length;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      setActiveCategory(cat.key);
                      const firstM = outboundMachines.find((m) => m.type === cat.key);
                      if (firstM) setSelectedOutboundMachine(firstM.id);
                    }}
                    className={`py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition-all border flex items-center justify-between ${
                      isActive
                        ? "bg-blue-600 text-white border-blue-500 shadow-xs ring-1 ring-blue-400/50"
                        : "bg-slate-50 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#1e3a5f] hover:border-blue-400"
                    }`}
                  >
                    <span>{isThai ? cat.labelTh : cat.labelEn}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-extrabold ${isActive ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"}`}>
                      {catCount}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Compact Machine Buttons for Active Category */}
            <div className="grid grid-cols-4 sm:grid-cols-7 lg:grid-cols-11 gap-1.5 pt-0.5">
              {outboundMachines.filter((m) => m.type === activeCategory).map((m) => {
                const isMSelected = selectedOutboundMachine === m.id;
                const mOrders = pickLists.filter((o) => o.machineId === m.id && !o.operatorDismissed);
                const activeOrdersCount = mOrders.length;

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedOutboundMachine(m.id);
                      setBarcodeInput("");
                      setScanStatus(null);
                      setIsScannerModalOpen(true);
                    }}
                    className={`relative py-1.5 px-1 sm:px-2 rounded-lg border transition-all active:scale-95 cursor-pointer text-center min-h-[50px] flex flex-col justify-center items-center ${
                      isMSelected
                        ? "bg-blue-600 text-white border-blue-500 shadow-xs ring-1 ring-blue-400/50"
                        : "bg-white dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-100 hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-[#152646]"
                    }`}
                  >
                    <div className="text-sm sm:text-base font-black font-mono leading-none">
                      {m.id}
                    </div>

                    <div className="mt-1 flex items-center justify-center">
                      <span
                        className={`px-1 py-0.2 rounded-full text-[9px] font-bold leading-tight ${
                          activeOrdersCount > 0
                            ? isMSelected
                              ? "bg-white text-blue-800"
                              : "bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800"
                            : isMSelected
                            ? "bg-blue-700 text-white opacity-80"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                        }`}
                      >
                        {activeOrdersCount > 0 ? `${activeOrdersCount} ใบ` : "ว่าง"}
                      </span>
                    </div>

                    {isMSelected && (
                      <div className="absolute top-1 right-1 p-0.5 rounded-full bg-white/20 text-white">
                        <Check size={8} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Machine Orders for Operator Receive */}
          <div className="p-2 sm:p-2.5 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-[#1e3a5f]/60">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  <ShieldCheck size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono font-black text-blue-600 dark:text-blue-400">
                      [ เครื่อง {selectedOutboundMachine} ]
                    </span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {machineOrders.filter((o) => !o.operatorDismissed).length} {isThai ? "ใบสั่งในคิว" : "orders"}
                    </span>
                  </div>
                  <h3 className="text-xs font-extrabold text-slate-900 dark:text-slate-100 leading-tight">
                    {isThai ? "สถานะการรับงานหน้าเครื่อง (Operator Work Receipt)" : "Operator Work Receipt"}
                  </h3>
                </div>
              </div>
            </div>

            {/* List of Orders and Batches in Queue (Completed orders remain until staff manually removes them) */}
            {(() => {
              const activeMachineOrders = machineOrders.filter((order) => !order.operatorDismissed);

              if (activeMachineOrders.length === 0) {
                return (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    {isThai ? "ยังไม่มีใบสั่งเบิกสำหรับเครื่องจักรนี้ในคิว" : "No orders in queue for this machine."}
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  {activeMachineOrders.map((order) => {
                    const validOrderItems = order.items.filter((i) => Boolean(i.batch && /^[A-Za-z0-9]{10}$/.test(i.batch.trim())));
                    const displayItems = validOrderItems.length > 0 ? validOrderItems : order.items;
                    const verifiedCount = displayItems.filter((i) => isItemMachineIssued(i)).length;
                    const pendingCount = displayItems.filter((i) => !isItemMachineIssued(i)).length;
                    const totalCount = displayItems.length;
                    const isOrderCompleted = totalCount > 0 && pendingCount === 0;
                    const isExpanded = expandedOrderNos.includes(order.orderNo);
                    return (
                      <div
                        key={order.orderNo}
                        className={`rounded-xl border shadow-xs overflow-hidden transition-all ${
                          isOrderCompleted
                            ? "border-emerald-300 dark:border-emerald-800/80 bg-white dark:bg-[#0c1930]"
                            : "border-slate-200/80 dark:border-[#1e3a5f] bg-white dark:bg-[#0c1930]"
                        }`}
                      >
                        <div
                          onClick={(e) => toggleOrderExpand(order.orderNo, e)}
                          className={`p-2 sm:p-2.5 border-b flex flex-wrap items-center justify-between gap-2 cursor-pointer transition-colors ${
                            isOrderCompleted
                              ? "bg-emerald-50/60 dark:bg-[#0e242b] border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-100/50 dark:hover:bg-[#13303a]"
                              : "bg-slate-50/90 dark:bg-[#0d1b33] border-slate-200/80 dark:border-[#1e3a5f] hover:bg-slate-100/80 dark:hover:bg-[#13233f]"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono font-black text-blue-600 dark:text-blue-400">
                              #{order.orderNo}
                            </span>
                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                              {isThai ? "เครื่อง:" : "Machine:"} <strong className="font-mono">{order.machineId}</strong>
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {order.createdAt} ({order.createdDate})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            {isOrderCompleted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400" />
                                <span>{isThai ? `จ่ายครบทุกรายการแล้ว (${verifiedCount}/${totalCount})` : `All Dispensed (${verifiedCount}/${totalCount})`}</span>
                              </span>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800 whitespace-nowrap">
                                  <Clock size={12} />
                                  <span>{isThai ? `รอแสกนจ่าย(${pendingCount}/${totalCount})` : `Waiting Scan Issue (${pendingCount}/${totalCount})`}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedOutboundMachine(order.machineId);
                                    setBarcodeInput("");
                                    setScanStatus(null);
                                    setIsScannerModalOpen(true);
                                  }}
                                  className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                                >
                                  <Barcode size={12} />
                                  <span>{isThai ? "สแกนจ่าย" : "Scan Issue"}</span>
                                </button>
                              </>
                            )}

                            {/* Manual delete/remove button for staff */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteMachineOrder(order.orderNo, isOrderCompleted);
                              }}
                              title={isThai ? "ลบใบสั่งเบิกนี้ออกจากคิว" : "Remove order from queue"}
                              className={`hidden px-2 py-1 rounded-lg border text-xs font-bold items-center gap-1 transition-colors cursor-pointer ${
                                isOrderCompleted
                                  ? "bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/80 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-800 shadow-2xs"
                                  : "bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600 dark:hover:text-rose-300 border-slate-200 dark:border-slate-700"
                              }`}
                            >
                              <Trash2 size={13} />
                              <span className="hidden sm:inline">{isThai ? "ลบออกจากคิว" : "Remove"}</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => toggleOrderExpand(order.orderNo, e)}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                {isThai ? "รายการ Batch ที่จัดส่งมายังเครื่องจักร:" : "Batches delivered to machine:"}
                              </div>
                             </div>

                            {(() => {
                              const totalItemsCount = displayItems.length;
                              const totalPages = Math.max(1, Math.ceil(totalItemsCount / operatorItemPageSize));
                              const rawPage = operatorItemPages[order.orderNo] || 1;
                              const currentPage = Math.min(Math.max(1, rawPage), totalPages);
                              const startIndex = (currentPage - 1) * operatorItemPageSize;
                              const endIndex = Math.min(startIndex + operatorItemPageSize, totalItemsCount);
                              const paginatedDisplayItems = displayItems.slice(startIndex, endIndex);

                              const setOperatorOrderPage = (newPage: number) => {
                                setOperatorItemPages((prev) => ({
                                  ...prev,
                                  [order.orderNo]: Math.min(Math.max(1, newPage), totalPages),
                                }));
                              };

                              return (
                                <div className="overflow-x-auto border rounded-lg border-slate-200 dark:border-[#1e3a5f]">
                                  <table className="w-full text-left border-collapse text-[10.5px] sm:text-xs whitespace-nowrap">
                                    <colgroup>
                                      <col className="w-10 sm:w-12" />
                                      <col className="w-20 sm:w-28" />
                                      <col className="w-20 sm:w-28" />
                                      <col className="w-20 sm:w-28" />
                                      <col className="w-24 sm:w-36" />
                                    </colgroup>
                                    <thead className="bg-slate-100 dark:bg-[#152646] text-slate-700 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px] sm:text-[11px] border-b border-slate-200 dark:border-[#1e3a5f]">
                                      <tr>
                                        <th className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center whitespace-nowrap">No.</th>
                                        <th className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center whitespace-nowrap">{isThai ? "ความหนา" : "Thickness"}</th>
                                        <th className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center whitespace-nowrap">{isThai ? "หน้ากว้าง" : "Width"}</th>
                                        <th className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center whitespace-nowrap">Req Qty</th>
                                        <th className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center whitespace-nowrap">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                                      {paginatedDisplayItems.map((item, idx) => {
                                        const isPrepared = item.status === "verified";
                                        const isIssuedAtMachine = isPrepared && isItemMachineIssued(item);
                                        const rowNumber = startIndex + idx + 1;

                                        const bKey = item.batch.trim().toUpperCase();
                                        const sapRec = sapMasterMap.get(bKey);
                                        const inbRec = inboundList.find((r) => r.batch.trim().toUpperCase() === bKey);
                                        const outRec = outboundList.find((r) => r.batch.trim().toUpperCase() === bKey);

                                        const rawThick =
                                          sapRec?.certThickness ||
                                          sapRec?.targetThickness ||
                                          inbRec?.certThickness ||
                                          inbRec?.targetThickness ||
                                          outRec?.certThickness ||
                                          outRec?.targetThickness ||
                                          "";
                                        const rawWidth =
                                          sapRec?.width ||
                                          inbRec?.width ||
                                          outRec?.width ||
                                          "";

                                        const isValidDim = (v: string) =>
                                          Boolean(v && v !== "-" && v !== "รอข้อมูล SAP" && v !== "รอระบบ SAP");

                                        let thicknessDisplay = "-";
                                        let widthDisplay = "-";

                                        if (isValidDim(rawThick) || isValidDim(rawWidth)) {
                                          thicknessDisplay = isValidDim(rawThick)
                                            ? formatDimension2Decimals(rawThick, "-")
                                            : "-";
                                          widthDisplay = isValidDim(rawWidth)
                                            ? formatDimension2Decimals(rawWidth, "-")
                                            : "-";
                                        } else if (item.description) {
                                          const dimMatch = item.description.match(
                                            /(\d+(?:\.\d+)?)\s*(?:mm|มม\.?)?\s*[xX*×]\s*(\d+(?:\.\d+)?)/
                                          );
                                          if (dimMatch) {
                                            thicknessDisplay = `${parseFloat(dimMatch[1]).toFixed(2)} mm`;
                                            widthDisplay = `${parseFloat(dimMatch[2]).toFixed(2)} mm`;
                                          }
                                        }

                                        return (
                                          <tr
                                            key={item.id}
                                            className={`transition-colors ${
                                              isIssuedAtMachine
                                                ? "bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30"
                                                : isPrepared
                                                ? "bg-blue-50/20 dark:bg-blue-950/10 hover:bg-blue-50/40"
                                                : "hover:bg-slate-50 dark:hover:bg-[#101d35]"
                                            }`}
                                          >
                                            <td className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center font-mono text-slate-500 whitespace-nowrap">{rowNumber}</td>
                                            <td className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center font-mono font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                                              {thicknessDisplay}
                                            </td>
                                            <td className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center font-mono font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                                              {widthDisplay}
                                            </td>
                                            <td className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center font-mono font-bold whitespace-nowrap">
                                              {item.reqQty > 0 ? `${item.reqQty.toLocaleString()} ${item.unit || "KG"}` : "-"}
                                            </td>
                                            <td className="!py-2 !px-1.5 sm:!p-2.5 sm:!px-3 !text-center whitespace-nowrap">
                                              {isIssuedAtMachine ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                                  <Check size={11} />
                                                  {isThai ? "จ่ายแล้ว" : "Issued"}
                                                  {item.machineIssuedAt ? ` (${item.machineIssuedAt})` : ""}
                                                </span>
                                              ) : isPrepared ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                                                  <Clock size={11} />
                                                  {isThai ? "เตรียมแล้ว (รอรับเข้า)" : "Prepared (Pending Receive)"}
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                                  <Clock size={11} />
                                                  {isThai ? "รอเตรียม" : "Pending Prep"}
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>

                                  {/* Pagination Footer for Operator Work Receipt Table */}
                                  <div className="px-1.5 py-1 sm:px-3 sm:py-1.5 bg-slate-50 dark:bg-[#0c1930] border-t border-slate-200 dark:border-[#1e3a5f] flex flex-nowrap items-center justify-between gap-1 sm:gap-2 text-[9.5px] sm:text-xs whitespace-nowrap overflow-x-auto">
                                    <div className="text-slate-600 dark:text-slate-300 font-medium text-[9.5px] sm:text-[11px] whitespace-nowrap">
                                      {isThai
                                        ? `แสดง ${totalItemsCount === 0 ? 0 : startIndex + 1}-${endIndex} จาก ${totalItemsCount}`
                                        : `${totalItemsCount === 0 ? 0 : startIndex + 1}-${endIndex} of ${totalItemsCount}`}
                                    </div>

                                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                                      <div className="flex items-center gap-0.5 sm:gap-1 text-[9.5px] sm:text-[11px] text-slate-500 dark:text-slate-400">
                                        <span>{isThai ? "แถว:" : "Rows:"}</span>
                                        <select
                                          value={operatorItemPageSize}
                                          onChange={(e) => {
                                            setOperatorItemPageSize(Number(e.target.value));
                                            setOperatorOrderPage(1);
                                          }}
                                          className="px-1 py-0.5 text-[9.5px] sm:text-xs rounded bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 cursor-pointer"
                                        >
                                          <option value={5}>5</option>
                                          <option value={10}>10</option>
                                          <option value={20}>20</option>
                                        </select>
                                      </div>

                                      <div className="flex items-center gap-0.5 sm:gap-1">
                                        <button
                                          type="button"
                                          onClick={() => setOperatorOrderPage(1)}
                                          disabled={currentPage <= 1}
                                          className="p-0.5 sm:p-1 rounded border text-[9.5px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                          title={isThai ? "หน้าแรก" : "First page"}
                                        >
                                          <ChevronsLeft size={11} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setOperatorOrderPage(currentPage - 1)}
                                          disabled={currentPage <= 1}
                                          className="px-1 py-0.5 sm:px-1.5 rounded border text-[9.5px] sm:text-[11px] font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 cursor-pointer"
                                        >
                                          <ChevronLeft size={11} />
                                          <span className="hidden sm:inline">{isThai ? "ก่อนหน้า" : "Prev"}</span>
                                        </button>

                                        <div className="px-1.5 py-0.5 sm:px-2 rounded bg-slate-200/60 dark:bg-[#111e38] font-mono text-[9.5px] sm:text-[11px] font-bold text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-[#1e3a5f]">
                                          {currentPage}/{totalPages}
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => setOperatorOrderPage(currentPage + 1)}
                                          disabled={currentPage >= totalPages}
                                          className="px-1 py-0.5 sm:px-1.5 rounded border text-[9.5px] sm:text-[11px] font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 cursor-pointer"
                                        >
                                          <span className="hidden sm:inline">{isThai ? "ถัดไป" : "Next"}</span>
                                          <ChevronRight size={11} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setOperatorOrderPage(totalPages)}
                                          disabled={currentPage >= totalPages}
                                          className="p-0.5 sm:p-1 rounded border text-[9.5px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                          title={isThai ? "หน้าสุดท้าย" : "Last page"}
                                        >
                                          <ChevronsRight size={11} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </section>
      )}

      {/* 3. Barcode Scanner Modal (Dedicated 10-Digit Alphanumeric Only Scanner - Top Flush Layout) */}
      {isScannerModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
          onMouseDown={() => setIsScannerModalOpen(false)}
        >
          <div
            className="w-full max-w-md h-full sm:h-auto sm:max-h-[94vh] flex flex-col rounded-none sm:rounded-2xl border border-slate-800/90 bg-[#0c1930] text-slate-100 shadow-2xl overflow-hidden font-sans"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 1. Header & Top bar */}
            <div className="px-4 py-3 border-b flex items-center justify-between bg-[#0a1526] border-slate-800/80 flex-shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <Barcode size={18} />
                </div>
                <h3 className="text-sm sm:text-base font-medium text-slate-100 truncate tracking-tight">
                  {activeMode === "operator_receive"
                    ? (isThai
                        ? `สแกนรับงานเข้าเครื่อง [ ${selectedOutboundMachine} ]`
                        : `Receive at Machine [ ${selectedOutboundMachine} ]`)
                    : isThai
                    ? `สแกนรับเข้าจากเครื่องจักร [ ${selectedMachine || "SM03"} ]`
                    : `Inbound Scan from Machine [ ${selectedMachine || "SM03"} ]`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsScannerModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-3.5 sm:p-4 space-y-3 overflow-y-auto flex-1">
              {/* Destination Rack Selector for Operator Receive (if applicable) */}
              {activeMode === "operator_receive" && (
                <div className="p-3 rounded-xl bg-[#0a1526]/80 border border-slate-800/80 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200 flex items-center gap-1.5">
                      <Scale size={14} className="text-blue-400" />
                      <span>{isThai ? `ระบุแคร่ปลายทางเครื่อง [${selectedOutboundMachine}]:` : `Destination Rack for [${selectedOutboundMachine}]:`}</span>
                      <span className="text-[10px] text-rose-400 font-bold">* ({isThai ? "บังคับระบุ" : "Required"})</span>
                    </span>
                    {destinationRacks.find((r) => r.rackId === selectedDestinationRackId) && (
                      <span className="text-[11px] font-mono text-cyan-400 font-medium">
                        {isThai ? "แคร่: " : "Rack: "}
                        {destinationRacks.find((r) => r.rackId === selectedDestinationRackId)?.rackNameTh}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    {destinationRacks.map((rack, rIdx) => {
                      const isSelected = selectedDestinationRackId === rack.rackId;
                      const isMaintenance = rack.status === "maintenance";
                      const accWidth = calculateAccumulatedWidthMm(rack.coils);
                      const remainingMm = Math.max(0, rack.maxCapacityMm - accWidth);
                      const percent = Math.min(100, Math.round((accWidth / rack.maxCapacityMm) * 100));

                      return (
                        <button
                          key={`${rack.rackId}-${rIdx}`}
                          type="button"
                          disabled={isMaintenance}
                          onClick={() => setSelectedDestinationRackId(rack.rackId)}
                          className={`p-1.5 sm:p-2 rounded-lg border text-left transition-all relative ${
                            isMaintenance
                              ? "opacity-40 cursor-not-allowed bg-slate-900 text-slate-500 border-slate-800"
                              : isSelected
                              ? "bg-blue-600 text-white border-blue-500 shadow-sm ring-2 ring-blue-400/50"
                              : "bg-[#111e38] text-slate-200 border-slate-800 hover:border-slate-700 hover:bg-[#16294a]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono font-bold text-[11px] sm:text-xs truncate flex items-center gap-1 min-w-0">
                              {isSelected && (
                                <span className="p-0.5 rounded-full bg-white text-blue-600 inline-flex items-center justify-center flex-shrink-0 shadow-xs">
                                  <Check size={8} className="stroke-[3]" />
                                </span>
                              )}
                              <span className="truncate">{rack.rackNameTh}</span>
                            </span>
                            {!isMaintenance && (
                              <span className={`text-[9px] font-mono font-bold flex-shrink-0 ${isSelected ? "text-blue-100" : "text-slate-400"}`}>
                                {percent}%
                              </span>
                            )}
                          </div>
                          <div className={`text-[9.5px] sm:text-[10px] mt-0.5 flex items-center justify-between ${isSelected ? "text-blue-100" : "text-slate-400"}`}>
                            {isMaintenance ? (
                              <span className="text-amber-400 font-bold text-[9px]">ซ่อมบำรุง</span>
                            ) : (
                              <>
                                <span className="opacity-80">ว่าง:</span>
                                <span className={`font-mono font-bold ${isSelected ? "text-white" : remainingMm === 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                  {remainingMm.toLocaleString()} mm
                                </span>
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. & 3. Camera Viewfinder Section */}
              {isCameraActive ? (
                <div className="w-full">
                  <CameraBarcodeScanner
                    isThai={isThai}
                    placeholderText={isThai ? "เล็งกล้องไปที่บาร์โค้ด Batch 10 หลัก" : "Aim at the 10-digit Batch barcode"}
                    onScan={(decoded) => {
                      const cleaned = cleanBarcode(decoded);
                      if (cleaned) {
                        processBarcodeSubmission(cleaned);
                      }
                    }}
                    onClose={() => setIsCameraActive(false)}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#0a1526]/80 border border-slate-800/80">
                  <span className="text-xs text-slate-300 font-medium">
                    {isThai ? "กล้องถูกปิดอยู่ (พร้อมรับการยิงด้วยเครื่องสแกนบาร์โค้ด)" : "Camera is off (Ready for handheld scanner)"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsCameraActive(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-300 hover:text-white bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                  >
                    <Camera size={13} className="text-emerald-400" />
                    <span>{isThai ? "เปิดกล้อง" : "Open Camera"}</span>
                  </button>
                </div>
              )}

              {/* 4. Input & Status Section */}
              <form onSubmit={handleFormSubmit} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      ref={modalScannerInputRef}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={barcodeInput}
                      onChange={handleInputChange}
                      maxLength={10}
                      disabled={activeMode === "inbound" && (isInboundWidthLimitLocked || currentSessionWidthMm >= 2000)}
                      placeholder={
                        activeMode === "inbound" && (isInboundWidthLimitLocked || currentSessionWidthMm >= 2000)
                          ? (isThai ? "หน้ากว้างสะสมเกิน 2.00 ม." : "Width limit reached")
                          : (isThai ? "พร้อมรับการยิงบาร์โค้ด" : "Ready for barcode input")
                      }
                      className={`w-full pl-3.5 pr-14 py-2.5 text-sm sm:text-base font-mono rounded-xl border transition-all focus:outline-none ${
                        activeMode === "inbound" && (isInboundWidthLimitLocked || currentSessionWidthMm >= 2000)
                          ? "bg-rose-950/30 border-rose-700/80 text-rose-300 placeholder-rose-500/70 cursor-not-allowed"
                          : "bg-[#0a1526] border-slate-700/80 hover:border-slate-600 focus:border-emerald-500 text-slate-100 placeholder-emerald-400/60 focus:ring-2 focus:ring-emerald-500/20"
                      }`}
                    />
                    {/* Light gray inline badge 0/10 */}
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                      <span className={`text-[11px] font-mono font-medium px-1.5 py-0.5 rounded ${
                        barcodeInput.length === 10
                          ? "text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 font-bold"
                          : "text-slate-400 bg-slate-800/80 border border-slate-700/60"
                      }`}>
                        {barcodeInput.length}/10
                      </span>
                    </div>
                  </div>

                  {/* Compact Vibrant Green Scan Button */}
                  <button
                    type="submit"
                    disabled={activeMode === "inbound" && (isInboundWidthLimitLocked || currentSessionWidthMm >= 2000)}
                    className={`px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-white shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all active:scale-95 ${
                      activeMode === "inbound" && (isInboundWidthLimitLocked || currentSessionWidthMm >= 2000)
                        ? "bg-slate-700/80 cursor-not-allowed opacity-60"
                        : "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/30"
                    }`}
                  >
                    <Barcode size={15} />
                    <span>{isThai ? "สแกน" : "Scan"}</span>
                  </button>
                </div>
              </form>

              {/* Real-time Scan Status Banner */}
              {scanStatus && (
                <div
                  className={`p-2.5 rounded-xl flex items-center justify-between text-xs font-semibold ${
                    scanStatus.type === "success"
                      ? "bg-emerald-950/50 border border-emerald-700/70 text-emerald-300"
                      : "bg-rose-950/50 border border-rose-700/70 text-rose-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {scanStatus.type === "success" ? (
                      <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                    ) : (
                      <AlertTriangle size={15} className="text-rose-400 flex-shrink-0" />
                    )}
                    <span>{scanStatus.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScanStatus(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Operator Receive Checklist (when in operator_receive mode) */}
              {activeMode === "operator_receive" ? (
                (() => {
                  const targetMOrders = pickLists.filter(
                    (o) => o.machineId === selectedOutboundMachine && !o.operatorDismissed
                  );
                  const allMItems = targetMOrders.flatMap((o) =>
                    o.items
                      .filter((i) => Boolean(i.batch && /^[A-Za-z0-9]{10}$/.test(i.batch.trim())))
                      .map((i) => ({ ...i, orderNo: o.orderNo }))
                  );
                  const issuedCount = allMItems.filter((i) => isItemMachineIssued(i)).length;

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#0a1526]/80 border border-slate-800/80">
                        <div className="flex items-center gap-2">
                          <Package size={15} className="text-blue-400" />
                          <span className="text-xs font-medium text-slate-200">
                            {isThai ? `รายการรอรับเข้าเครื่อง [${selectedOutboundMachine}]:` : `Items for [${selectedOutboundMachine}]:`}
                          </span>
                        </div>
                        <div className="text-xs sm:text-sm font-bold text-blue-300 font-mono">
                          {issuedCount} / {allMItems.length} {isThai ? "รายการสำเร็จ" : "received"}
                        </div>
                      </div>

                      {allMItems.length > 0 && (
                        <div className="border rounded-xl overflow-hidden bg-[#0a1526]/60 border-slate-800/80">
                          <div className="max-h-48 overflow-y-auto">
                            <table className="w-full text-xs text-left border-collapse">
                              <thead className="bg-[#111e38] text-slate-300 font-medium border-b border-slate-800 sticky top-0 z-10">
                                <tr>
                                  <th className="p-2 text-left font-mono font-bold">Batch</th>
                                  <th className="p-2 text-left font-mono font-bold">{isThai ? "ใบสั่ง" : "Order"}</th>
                                  <th className="p-2 text-center font-bold">{isThai ? "สถานะ / กดสแกน" : "Status"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/80">
                                {allMItems.map((itm) => {
                                  const isPrepared = itm.status === "verified";
                                  const isIssued = isPrepared && isItemMachineIssued(itm);
                                  return (
                                    <tr
                                      key={`${itm.orderNo}-${itm.id}`}
                                      onClick={() => {
                                        if (isPrepared && !isIssued) {
                                          processBarcodeSubmission(itm.batch);
                                        }
                                      }}
                                      className={`transition-colors ${
                                        isIssued
                                          ? "bg-emerald-950/30"
                                          : isPrepared
                                          ? "bg-[#111e38]/70 hover:bg-[#16294a] cursor-pointer"
                                          : "bg-[#0a1526]/40 opacity-70"
                                      }`}
                                    >
                                      <td className="p-2 font-mono font-bold text-cyan-400">
                                        {itm.batch}
                                      </td>
                                      <td className="p-2 font-mono text-[11px] text-slate-400">
                                        #{itm.orderNo}
                                      </td>
                                      <td className="p-2 text-center">
                                        {isIssued ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white">
                                            <Check size={10} />
                                            <span>{isThai ? "จ่ายแล้ว" : "Issued"}</span>
                                          </span>
                                        ) : isPrepared ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs">
                                            <Barcode size={10} />
                                            <span>{isThai ? "เตรียมแล้ว (กดสแกน)" : "Ready (Tap to Scan)"}</span>
                                          </span>
                                        ) : (
                                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800/60">
                                            {isThai ? "รอเตรียมเบิก" : "Pending Prep"}
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <>
                  {/* 5. Scan Summary / Batch Info: Single unified card */}
                  <div className="rounded-xl bg-[#0a1526]/90 border border-slate-800/80 p-3 flex items-center justify-between gap-3 shadow-sm">
                    {/* Left side: green package icon, reading "สแกนแล้วในรอบนี้:" in white text */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center flex-shrink-0">
                        <Package size={16} />
                      </div>
                      <span className="text-xs sm:text-sm font-medium text-white truncate">
                        {isThai ? "สแกนแล้วในรอบนี้:" : "Scanned this round:"}
                      </span>
                    </div>

                    {/* Right side: Bold green "0 รายการ (0 kg)" with subtext "หน้ากว้างสะสม: 0.00 / 2.00 ม." */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs sm:text-sm font-bold text-emerald-400 font-mono">
                        {currentSessionBatches.length} {isThai ? "รายการ" : "items"} ({currentSessionWeightKg.toLocaleString()} kg)
                      </div>
                      <div className="text-[11px] font-mono text-emerald-400/80 font-medium">
                        {isThai
                          ? `หน้ากว้างสะสม: ${currentSessionWidthMeters} / 2.00 ม.`
                          : `Width: ${currentSessionWidthMeters} / 2.00 m`}
                      </div>
                    </div>
                  </div>

                  {/* Scanned Items List (Directly Below Barcode Input & Summary) */}
                  {currentSessionBatches.length > 0 && (
                    <div className="space-y-1.5 pt-0.5">
                      {/* Selection Toolbar: Select All + Delete Selected Button */}
                      <div className="flex items-center justify-between gap-2 px-1">
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.length > 0 && selectedBatchIds.length === currentSessionBatches.length}
                            onChange={handleToggleSelectAll}
                            className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                          />
                          <span>
                            {isThai ? "เลือกทั้งหมด" : "Select All"} ({selectedBatchIds.length}/{currentSessionBatches.length})
                          </span>
                        </label>

                        {selectedBatchIds.length > 0 && (
                          <button
                            type="button"
                            onClick={handleDeleteSelected}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all bg-rose-600 hover:bg-rose-700 text-white shadow-sm cursor-pointer active:scale-95"
                          >
                            <Trash2 size={12} />
                            <span>
                              {isThai
                                ? `ลบที่เลือก (${selectedBatchIds.length})`
                                : `Delete (${selectedBatchIds.length})`}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Clean, Mobile-friendly Scan List */}
                      <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-xl p-2 bg-[#0a1526]/60 border border-slate-800/80">
                        {currentSessionBatches.map((item, idx) => {
                          const isChecked = selectedBatchIds.includes(item.id);
                          return (
                            <div
                              key={item.id}
                              onClick={() => handleToggleSelectBatch(item.id)}
                              className={`flex items-center justify-between text-xs py-2 px-3 rounded-lg border transition-all cursor-pointer select-none ${
                                isChecked
                                  ? "bg-rose-950/40 border-rose-800/80 text-white"
                                  : "bg-[#111e38]/80 border-slate-800/80 text-slate-200 hover:bg-[#16294a]"
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    handleToggleSelectBatch(item.id);
                                  }}
                                  className="w-4 h-4 accent-rose-600 rounded cursor-pointer"
                                />
                                <span className="font-mono text-slate-500 text-[11px] min-w-[20px]">
                                  #{idx + 1}
                                </span>
                                <span className="font-mono font-bold text-sm tracking-wide text-cyan-400">
                                  {item.batch}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteRecordFromSession(item.id, item.batch);
                                }}
                                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                                title={isThai ? "ลบรายการนี้" : "Delete this item"}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 6. Bottom Primary Buttons: Sticky, tidy bottom bar */}
            <div className="p-3 sm:p-4 border-t flex items-center justify-between gap-2.5 bg-[#0a1526] border-slate-800/80 flex-shrink-0 mt-auto">
              <button
                type="button"
                onClick={() => setIsScannerModalOpen(false)}
                className="flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-medium text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/60 transition-all cursor-pointer text-center active:scale-98"
              >
                {isThai ? "ปิด / ยกเลิก" : "Close / Cancel"}
              </button>
              <button
                type="button"
                onClick={handleDoneBatchScanning}
                className="flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-98"
              >
                <Check size={16} className="stroke-[2.5]" />
                <span>{isThai ? "เสร็จสิ้นการสแกน" : "Finish Scanning"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3.1 Mandatory Location Scanner Modal (Chained Modal Workflow - Top Flush Layout) */}
      {isLocationModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-0 pt-0 sm:px-4 sm:pt-0 bg-slate-950/75 backdrop-blur-sm animate-fade-in"
          onMouseDown={() => setIsLocationModalOpen(false)}
        >
          <div
            className="w-full max-w-md mt-0 rounded-b-2xl rounded-t-none border-t-0 border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-3.5 sm:p-4 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                  <Layers size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                    {isThai ? "สแกน Location จัดเก็บ" : "Scan Storage Location"}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsLocationModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3">
              {/* Error Message if empty */}
              {locationScanError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle size={15} className="flex-shrink-0" />
                  <span>{locationScanError}</span>
                </div>
              )}

              {/* 1. Location Barcode Input Form (Moved to Very Top) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleConfirmLocationSubmission();
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Barcode size={15} className="text-cyan-500" />
                      <span>{isThai ? "สแกนบาร์โค้ด Location จัดเก็บ:" : "Scan Location Barcode:"}</span>
                    </span>
                    <span className="text-[10px] text-rose-500 font-extrabold uppercase">
                      {isThai ? "* บังคับระบุ" : "* Required"}
                    </span>
                  </label>

                  <div className="relative">
                    <input
                      ref={locationInputRef}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={locationBarcode}
                      onChange={(e) => {
                        setLocationBarcode(cleanBarcode(e.target.value));
                        if (locationScanError) setLocationScanError(null);
                      }}
                      placeholder={isThai ? "ยิงบาร์โค้ด Location จัดเก็บ..." : "Scan Location barcode..."}
                      className="w-full pl-4 pr-10 py-2.5 text-base sm:text-lg font-mono font-black tracking-wider rounded-xl bg-white dark:bg-[#0c1930] border-2 border-cyan-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-4 focus:ring-cyan-500/20 shadow-inner"
                    />
                    <div className="absolute right-3 top-3 text-cyan-500">
                      <Layers size={20} />
                    </div>
                  </div>
                </div>

                {/* Summary Cards: Source Machine & Scanned Count & Weight */}
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                    <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">
                      {isThai ? "เครื่องต้นทาง" : "Machine"}
                    </span>
                    <span className="text-xs sm:text-sm font-black font-mono text-emerald-600 dark:text-emerald-400">
                      {selectedMachine || "SM01"}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                    <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">
                      {isThai ? "จำนวนสแกน" : "Coils"}
                    </span>
                    <span className="text-xs sm:text-sm font-black font-mono text-cyan-600 dark:text-cyan-400">
                      {currentSessionBatches.length} {isThai ? "รายการ" : "items"}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                    <span className="text-[9px] font-bold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">
                      {isThai ? "น้ำหนักรวม" : "Weight"}
                    </span>
                    <span className="text-xs font-black font-mono text-slate-900 dark:text-slate-100 truncate block">
                      {currentSessionWeightKg.toLocaleString()} kg
                    </span>
                  </div>
                </div>

                {/* Compact Action Buttons */}
                <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-[#1e3a5f]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsLocationModalOpen(false);
                      setIsScannerModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#172b4d] border border-slate-300 dark:border-[#1e3a5f] cursor-pointer"
                  >
                    ← ย้อนกลับ
                  </button>

                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/30 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                  >
                    <Check size={14} />
                    <span>บันทึกจัดเก็บ</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 4. Table Section: 10-Column Scanned Batch Summary Table (AGENT.MD Standards) */}
      {activeMode === "movement_history" && (
        <section className="rounded-lg border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-sm overflow-hidden">
        {/* Collapsible Header with Chevron */}
        <div
          onClick={() => setIsTableCollapsed(!isTableCollapsed)}
          className="py-2.5 px-3 sm:px-4 flex flex-nowrap items-center justify-between gap-2.5 cursor-pointer select-none bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f] hover:bg-slate-100/70 dark:hover:bg-[#142340] transition-colors overflow-hidden"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1 whitespace-nowrap overflow-hidden">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">
              <TableIcon size={15} />
            </div>
            <div className="flex flex-col justify-center min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center gap-2 whitespace-nowrap flex-nowrap min-w-0 overflow-hidden">
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-slate-100 whitespace-nowrap flex-shrink-0">
                  {isThai ? "ตารางประวัติการเคลื่อนไหว" : "History Summary Table"}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-extrabold bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 whitespace-nowrap flex-shrink-0">
                  {filteredList.length} {isThai ? "รายการ" : "items"}
                </span>
                <span className="hidden sm:inline-block text-[10.5px] font-mono font-bold px-2 py-0.5 rounded bg-slate-200/80 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border border-slate-300/50 dark:border-[#1e3a5f] whitespace-nowrap flex-shrink-0">
                  {totalWeightKg.toLocaleString()} kg ({totalWeightTon} TON)
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap truncate mt-0.5">
                {isTableCollapsed
                  ? (isThai ? "สถานะ: ย่อไว้ (คลิกเพื่อขยายดูตาราง)" : "Status: Collapsed (click to expand)")
                  : (isThai ? "สถานะ: ขยายตาราง (คลิกเพื่อย่อตาราง)" : "Status: Expanded (click to collapse)")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap ml-2">
            <span className="hidden md:inline-block text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {isTableCollapsed ? (isThai ? "ขยายตาราง" : "Expand Table") : (isThai ? "ย่อตาราง" : "Collapse Table")}
            </span>
            <div className={`p-1 rounded-md border bg-white dark:bg-[#0c1930] border-slate-300 dark:border-[#1e3a5f] text-slate-600 dark:text-slate-300 transition-transform duration-200 ${isTableCollapsed ? "" : "rotate-180"}`}>
              <ChevronDown size={14} />
            </div>
          </div>
        </div>

        {/* Collapsible Content */}
        {!isTableCollapsed && (
          <div>
            {/* Table Toolbar & Search & Page Size */}
            <div className="py-1 px-2 border-b flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 dark:bg-[#0e1c36] border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <div className="relative flex-1">
                  <Search size={12} className="absolute left-2.5 top-2 text-slate-400" />
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder={isThai ? "ค้นหาตาม Batch, Grade, ผู้ผลิต, เครื่อง, Location..." : "Filter by Batch, Grade, Machine, Location..."}
                    className="w-full pl-8 pr-7 h-7 text-xs rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-400 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                  />
                  {searchKeyword && (
                    <button
                      type="button"
                      onClick={() => setSearchKeyword("")}
                      className="absolute right-2 top-1.5 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* Rows Per Page Selector */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {isThai ? "แสดง:" : "Show:"}
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-0 h-7 text-xs rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value={5}>5 {isThai ? "แถว/หน้า" : "/ page"}</option>
                  <option value={10}>10 {isThai ? "แถว/หน้า" : "/ page"}</option>
                  <option value={20}>20 {isThai ? "แถว/หน้า" : "/ page"}</option>
                </select>
              </div>
            </div>

            {/* 11-Column Scanned Batch Summary Table */}
            <div className="w-full overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-[#1e3a5f]">
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">No.</th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap bg-cyan-50/50 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-300">
                      Batch
                    </th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300">
                      เลขที่ใบสั่งเบิก
                    </th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">หนา(mm)</th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">กว้าง(mm)</th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap text-emerald-700 dark:text-emerald-400">
                      น้ำหนัก (kg)
                    </th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Grade</th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">ผู้ผลิต</th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300">
                      รับจากเครื่อง
                    </th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap text-slate-600 dark:text-slate-300 bg-slate-50/60 dark:bg-slate-900/30">
                      {isThai ? "Location เดิม" : "Prev Location"}
                    </th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap text-blue-700 dark:text-blue-400">
                      Location
                    </th>
                    <th className="py-1 px-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paginatedList.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-4 text-center text-slate-400 dark:text-slate-500 whitespace-nowrap">
                        <div className="flex flex-col items-center justify-center gap-1">
                          <Disc size={24} className="text-slate-300 dark:text-slate-600 animate-pulse" />
                          <div className="font-semibold text-xs">
                            {isThai
                              ? `ยังไม่มีรายการสแกนในรอบนี้`
                              : `No scanned records in current batch`}
                          </div>
                          <p className="text-[10px] text-slate-400 max-w-md">
                            {isThai
                              ? "กรุณากดเลือกเครื่องจักร [ SM01 ] - [ SM04 ] ด้านบน เพื่อเปิดหน้าต่างสแกนบาร์โค้ด Batch 10 หลัก"
                              : "Please select a machine [ SM01 ] - [ SM04 ] above to start scanning 10-digit Batch barcodes."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedList.map((row, idx) => (
                      <tr
                        key={row.id}
                        className="h-5 hover:bg-slate-50/80 dark:hover:bg-[#152646] transition-colors text-slate-800 dark:text-slate-200"
                      >
                        {/* 1. ลำดับ (No.) */}
                        <td className="py-0 px-1 font-mono text-slate-400 text-[11px] leading-tight whitespace-nowrap">
                          {startIndex + idx + 1}
                        </td>

                        {/* 2. Batch (10 หลัก) */}
                        <td className="py-0 px-1 font-mono font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-50/40 dark:bg-cyan-950/10 text-[11px] leading-tight whitespace-nowrap">
                          {row.batch}
                        </td>

                        {/* 3. เลขที่ใบสั่งเบิก (Order No.) */}
                        <td className="py-0 px-1 font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50/30 dark:bg-amber-950/10 text-[11px] leading-tight whitespace-nowrap">
                          {getOrderNoForRecord(row)}
                        </td>

                        {/* 3. หนา Certificated.(mm) */}
                        <td className="py-0 px-1 font-medium text-[11px] leading-tight whitespace-nowrap">
                          {row.hasSapData && row.certThickness && row.certThickness !== "รอข้อมูล SAP" ? (
                            formatDimension2Decimals(row.certThickness)
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300/80 dark:border-amber-800">
                              รอข้อมูล SAP
                            </span>
                          )}
                        </td>

                        {/* 4. กว้าง(mm) */}
                        <td className="py-0 px-1 font-medium text-[11px] leading-tight whitespace-nowrap">
                          {row.hasSapData && row.width && row.width !== "รอข้อมูล SAP" ? (
                            formatDimension2Decimals(row.width)
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300/80 dark:border-amber-800">
                              รอข้อมูล SAP
                            </span>
                          )}
                        </td>

                        {/* 5. Unrestricted(น้ำหนักkg) */}
                        <td className="py-0 px-1 font-bold text-emerald-600 dark:text-emerald-400 font-mono text-[11px] leading-tight whitespace-nowrap">
                          {row.hasSapData && row.unrestricted && row.unrestricted !== "รอข้อมูล SAP" ? (
                            row.unrestricted
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300/80 dark:border-amber-800">
                              รอข้อมูล SAP
                            </span>
                          )}
                        </td>

                        {/* 6. Grade */}
                        <td className="py-0 px-1 font-semibold text-[11px] leading-tight whitespace-nowrap">
                          {row.hasSapData && row.grade && row.grade !== "รอข้อมูล SAP" ? (
                            row.grade
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300/80 dark:border-amber-800">
                              รอข้อมูล SAP
                            </span>
                          )}
                        </td>

                        {/* 7. ผู้ผลิต */}
                        <td className="py-0 px-1 text-slate-600 dark:text-slate-400 text-[11px] leading-tight whitespace-nowrap">
                          {row.hasSapData && row.manufacturer && row.manufacturer !== "รอข้อมูล SAP" ? (
                            row.manufacturer
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300/80 dark:border-amber-800">
                              รอข้อมูล SAP
                            </span>
                          )}
                        </td>

                        {/* 8. รับจากเครื่อง (Dropdown SM01-SM04 or Machine Badge) */}
                        <td className="py-0 px-1 whitespace-nowrap bg-emerald-50/30 dark:bg-emerald-950/10">
                          {AVAILABLE_MACHINES.includes(row.machine) ? (
                            <select
                              value={row.machine}
                              onChange={(e) => handleMachineChange(row.id, e.target.value)}
                              className="bg-white dark:bg-[#0c1930] text-[11px] font-mono font-bold text-slate-800 dark:text-slate-200 py-0 px-0.5 h-4.5 rounded border border-slate-300 dark:border-[#1e3a5f] focus:outline-none focus:border-cyan-500 leading-none"
                            >
                              {AVAILABLE_MACHINES.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded font-mono font-bold text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                              {row.machine}
                            </span>
                          )}
                        </td>

                        {/* 9. Location เดิม (จากการย้าย Layout ครั้งล่าสุด) */}
                        <td className="py-0 px-1 whitespace-nowrap bg-slate-50/30 dark:bg-slate-900/10">
                          {(() => {
                            const prevLoc = getPreviousLocationForRecord(row);
                            return prevLoc !== "-" ? (
                              <span className="px-1.5 py-0.2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-mono font-bold text-[11px] leading-none inline-flex items-center gap-1">
                                {prevLoc}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px] px-1">-</span>
                            );
                          })()}
                        </td>

                        {/* 10. Location */}
                        <td className="py-0 px-1 whitespace-nowrap">
                          <span className="px-1 py-0 rounded bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-mono font-bold text-[11px] leading-none">
                            {row.location}
                          </span>
                        </td>

                        {/* 10. จัดการ (ลบแถว / ดูรายละเอียด) */}
                        <td className="py-0 px-1 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setSelectedRecord(row)}
                              className="p-0.5 rounded text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50 dark:hover:bg-cyan-950/50"
                              title={isThai ? "ดูรายละเอียด" : "View Details"}
                            >
                              <Eye size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRecord(row.id, row.batch)}
                              className="p-0.5 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                              title={isThai ? "ลบรายการ" : "Remove"}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls Bar (AGENT.MD Standards) */}
            <div className="p-3 border-t flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              {/* Pagination Status Text */}
              <div className="text-slate-600 dark:text-slate-300 font-medium">
                {isThai
                  ? `แสดง ${filteredList.length === 0 ? 0 : startIndex + 1} - ${endIndex} จากทั้งหมด ${filteredList.length} รายการ (หน้าที่ ${validCurrentPage} จาก ${totalPages})`
                  : `Showing ${filteredList.length === 0 ? 0 : startIndex + 1} - ${endIndex} of ${filteredList.length} items (Page ${validCurrentPage} of ${totalPages})`}
              </div>

              {/* Navigation Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handlePageChange(1)}
                  disabled={validCurrentPage <= 1}
                  className={`p-1.5 rounded border text-xs font-semibold flex items-center justify-center transition-all ${
                    validCurrentPage <= 1
                      ? "opacity-40 cursor-not-allowed bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-slate-800"
                      : "bg-white dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#172b4d]"
                  }`}
                  title={isThai ? "หน้าแรก" : "First Page"}
                >
                  <ChevronsLeft size={14} />
                </button>

                <button
                  type="button"
                  onClick={() => handlePageChange(validCurrentPage - 1)}
                  disabled={validCurrentPage <= 1}
                  className={`px-2.5 py-1.5 rounded border text-xs font-semibold flex items-center gap-1 transition-all ${
                    validCurrentPage <= 1
                      ? "opacity-40 cursor-not-allowed bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-slate-800"
                      : "bg-white dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#172b4d]"
                  }`}
                >
                  <ChevronLeft size={14} />
                  <span>{isThai ? "ก่อนหน้า" : "Previous"}</span>
                </button>

                {/* Page Indicator */}
                <div className="px-3 py-1 rounded bg-slate-200/60 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 font-mono text-xs font-bold border border-slate-300/60 dark:border-[#1e3a5f]">
                  {validCurrentPage} / {totalPages}
                </div>

                <button
                  type="button"
                  onClick={() => handlePageChange(validCurrentPage + 1)}
                  disabled={validCurrentPage >= totalPages}
                  className={`px-2.5 py-1.5 rounded border text-xs font-semibold flex items-center gap-1 transition-all ${
                    validCurrentPage >= totalPages
                      ? "opacity-40 cursor-not-allowed bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-slate-800"
                      : "bg-white dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#172b4d]"
                  }`}
                >
                  <span>{isThai ? "ถัดไป" : "Next"}</span>
                  <ChevronRight size={14} />
                </button>

                <button
                  type="button"
                  onClick={() => handlePageChange(totalPages)}
                  disabled={validCurrentPage >= totalPages}
                  className={`p-1.5 rounded border text-xs font-semibold flex items-center justify-center transition-all ${
                    validCurrentPage >= totalPages
                      ? "opacity-40 cursor-not-allowed bg-slate-100 dark:bg-[#0c1930] text-slate-400 border-slate-200 dark:border-slate-800"
                      : "bg-white dark:bg-[#0c1930] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-[#1e3a5f] hover:bg-slate-100 dark:hover:bg-[#172b4d]"
                  }`}
                  title={isThai ? "หน้าสุดท้าย" : "Last Page"}
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
            </div>

            {/* Table Footer with Summary Only */}
            <div className="py-2.5 px-3 border-t flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                {isThai ? "ยอดรวมน้ำหนักรอบนี้:" : "Total Weight:"}{" "}
                <strong className="text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                  {totalWeightKg.toLocaleString()} kg
                </strong>{" "}
                <span className="text-slate-400">({totalWeightTon} TON)</span>
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {/* 5. Relocate Layout View */}
      {activeMode === "relocate_layout" && (
        <div className="space-y-2 sm:space-y-2.5 animate-fade-in">
          {/* Grid Layout: Scan Form & Destination Input */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-2.5">
            {/* Column 1: Batch Scanner Input & Accumulation Table */}
            <div className="lg:col-span-2 p-2.5 sm:p-3 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs space-y-2">
              <div className="flex items-center justify-between border-b pb-1.5 border-slate-100 dark:border-[#1e3a5f]/60">
                <h3 className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 uppercase tracking-wider">
                  <Barcode size={14} className="text-amber-500" />
                  <span>{isThai ? "สแกน Batch" : "Scan Batch"}</span>
                </h3>
                <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.2 rounded-full border border-amber-200 dark:border-amber-800">
                  {isThai ? "* เฉพาะ Batch ในระบบ" : "* Only Existing Batches"}
                </span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleScanRelocateBatch(relocateBarcodeInput);
                }}
                className="space-y-1.5"
              >
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      ref={relocateInputRef}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={relocateBarcodeInput}
                      onChange={(e) => {
                        const val = cleanBarcode(e.target.value);
                        setRelocateBarcodeInput(val);
                        if (val.length === 10) {
                          handleScanRelocateBatch(val);
                        }
                      }}
                      placeholder={isThai ? "ยิงหรือพิมพ์รหัส Batch 10 หลัก..." : "Ready for batch scan..."}
                      className="w-full pl-3 pr-8 py-1.5 text-xs font-mono font-bold rounded-lg bg-white dark:bg-[#0c1930] border-2 border-amber-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    />
                    <div className="absolute right-2.5 top-2 text-amber-500">
                      <Barcode size={15} />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg font-bold text-xs bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer transition-all active:scale-95 flex items-center gap-1 whitespace-nowrap"
                  >
                    <Plus size={13} />
                    <span>{isThai ? "เพิ่ม" : "Add"}</span>
                  </button>
                </div>
              </form>

              {/* Accumulation Table */}
              <div className="space-y-1.5 pt-1.5 border-t border-slate-100 dark:border-[#1e3a5f]/60">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  <span>{isThai ? "ตารางสะสมรายการ Batch ที่จะย้าย:" : "Accumulated Batches:"}</span>
                  <span className="font-mono text-amber-600 dark:text-amber-400">
                    {relocateBatchList.length} {isThai ? "รายการ" : "items"} (
                    {relocateBatchList.reduce((s, i) => s + i.weightKg, 0).toLocaleString()} kg)
                  </span>
                </div>

                <div className="border rounded-lg overflow-hidden bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f]">
                  <div className="max-h-56 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-[11px] text-left whitespace-nowrap border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-[#0d1b33] text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-[#1e3a5f]">
                          <th className="py-1 px-2 text-center font-bold">ลำดับ</th>
                          <th className="py-1 px-2 font-bold bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300">Batch</th>
                          <th className="py-1 px-2 font-bold text-blue-700 dark:text-blue-400">Layout ต้นทาง</th>
                          <th className="py-1 px-2 font-bold text-center">สถานะ</th>
                          <th className="py-1 px-2 text-center font-bold">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {relocateBatchList.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-5 text-center text-slate-400">
                              <div className="flex flex-col items-center justify-center gap-1">
                                <Package size={22} className="text-slate-300 dark:text-slate-600" />
                                <span className="font-bold text-xs">
                                  {isThai ? "ยังไม่มีรายการ Batch สะสมสำหรับย้าย Layout" : "No batches accumulated yet"}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          relocateBatchList.map((item, idx) => (
                            <tr key={item.id} className="hover:bg-slate-100/70 dark:hover:bg-[#142340] transition-colors">
                              <td className="py-1 px-2 text-center font-mono text-slate-400 text-[10px]">{idx + 1}</td>
                              <td className="py-1 px-2 font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/10">
                                {item.batch}
                              </td>
                              <td className="py-1 px-2 font-mono">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-800 text-[10px]">
                                  📍 {item.sourceLayout}
                                </span>
                              </td>
                              <td className="py-1 px-2 text-center">
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                  {item.status}
                                </span>
                              </td>
                              <td className="py-1 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRelocateItem(item.id)}
                                  className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-700 transition-colors"
                                  title={isThai ? "ลบออก" : "Remove"}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: Destination Layout Selection & Confirm Card */}
            <div className="p-2.5 sm:p-3 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="border-b pb-1.5 border-slate-100 dark:border-[#1e3a5f]/60">
                  <h3 className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 uppercase tracking-wider">
                    <Layers size={14} className="text-emerald-500" />
                    <span>{isThai ? "ระบุ Layout ปลายทาง" : "Destination"}</span>
                  </h3>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                    <span>{isThai ? "สแกนหรือระบุ Layout ปลายทาง:" : "Destination Layout:"}</span>
                    <span className="text-[9px] text-rose-500 font-extrabold uppercase">{isThai ? "* บังคับระบุ" : "* Required"}</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={destinationLayout}
                      onChange={(e) => setDestinationLayout(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && relocateBatchList.length > 0 && destinationLayout.trim()) {
                          e.preventDefault();
                          handleConfirmRelocation();
                        }
                      }}
                      placeholder={isThai ? "ยิงบาร์โค้ดหรือระบุ Layout ปลายทาง..." : "Enter Destination..."}
                      className="w-full pl-3 pr-8 py-1.5 text-xs font-mono font-black rounded-lg bg-white dark:bg-[#0c1930] border-2 border-emerald-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                    <div className="absolute right-2.5 top-2 text-emerald-500">
                      <Layers size={16} />
                    </div>
                  </div>
                </div>

                {/* Relocation Summary Box */}
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] space-y-1 text-[11px] font-mono">
                  <div className="flex justify-between text-slate-500">
                    <span>{isThai ? "จำนวนที่จะย้าย:" : "Items to move:"}</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">{relocateBatchList.length} รายการ</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>{isThai ? "Layout ปลายทาง:" : "Destination:"}</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">{destinationLayout.trim().toUpperCase() || "-"}</span>
                  </div>
                </div>
              </div>

              {/* Confirm Relocation Button */}
              <div className="pt-2 border-t border-slate-100 dark:border-[#1e3a5f]/60">
                <button
                  type="button"
                  onClick={handleConfirmRelocation}
                  disabled={relocateBatchList.length === 0 || !destinationLayout.trim()}
                  className={`w-full py-2.5 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer ${
                    relocateBatchList.length === 0 || !destinationLayout.trim()
                      ? "opacity-50 bg-slate-300 text-slate-500 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed shadow-none"
                      : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-emerald-600/25"
                  }`}
                >
                  <Check size={15} />
                  <span>{isThai ? "ยืนยันการย้าย Layout" : "Confirm Relocation"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Stock Balance View (Stock คงคลัง) */}
      {activeMode === "stock_balance" && (
        <section className="p-3 sm:p-4 rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-sm space-y-3 font-sans animate-fade-in">
          {/* Header & Subtitle */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 border-slate-100 dark:border-[#1e3a5f]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <Package size={20} />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span>{isThai ? "Stock คงคลัง" : "Stock Balance"}</span>
                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    {filteredStockList.length} {isThai ? "รายการ" : "items"}
                  </span>
                </h2>
                <p className="hidden text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isThai
                    ? "ตารางแสดงปริมาณวัตถุดิบสลิต/ฟิล์มคงคลังล่าสุด"
                    : "Real-time Slit Steel & Film inventory balance"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Export Excel Button */}
              <button
                type="button"
                onClick={handleExportStockBalanceExcel}
                disabled={filteredStockList.length === 0}
                className="hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-xs items-center gap-1.5 cursor-pointer transition-all active:scale-95 border border-emerald-700"
              >
                <FileSpreadsheet size={14} className="text-emerald-100" />
                <span>{isThai ? "Export Excel" : "Export Excel"}</span>
              </button>

              {/* SAP Data Upload Button */}
              <button
                type="button"
                onClick={() => setIsSapModalOpen(true)}
                className="hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1c2d42] hover:bg-[#111f30] dark:bg-[#1e3a5f] dark:hover:bg-[#284c7a] text-white shadow-xs items-center gap-1.5 cursor-pointer transition-all active:scale-95 border border-[#2d4b6e] dark:border-[#385f8d]"
              >
                <FileSpreadsheet size={14} className="text-cyan-400" />
                <span>{isThai ? "อัปโหลดข้อมูลจาก SAP" : "Upload SAP Data"}</span>
              </button>

              <div className="flex items-center gap-1.5 sm:pl-2 sm:border-l border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 hidden sm:inline">
                  {isThai ? "รวมน้ำหนักคลัง:" : "Total Stock:"}
                </span>
                <div className="px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-mono font-extrabold text-xs">
                  {stockTotalWeightKg.toLocaleString()} kg ({stockTotalWeightTon} TON)
                </div>
              </div>
            </div>
          </div>

          {/* SAP Fiori Style Top Toolbar: Quick Search & Status Filter */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={stockSearchKeyword}
                onChange={(e) => {
                  setStockSearchKeyword(e.target.value);
                  setStockCurrentPage(1);
                }}
                placeholder={
                  isThai
                    ? "ค้นหาด่วนตาม Batch, Location, Grade, Material No..."
                    : "Search by Batch, Location, Grade..."
                }
                className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
              />
              {stockSearchKeyword && (
                <button
                  type="button"
                  onClick={() => setStockSearchKeyword("")}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filter Dropdown & Page Size */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span>{isThai ? "สถานะ:" : "Status:"}</span>
                <select
                  value={stockStatusFilter}
                  onChange={(e) => {
                    setStockStatusFilter(e.target.value as "all" | "ready" | "preparing" | "pending_location");
                    setStockCurrentPage(1);
                  }}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="all">{isThai ? "ทั้งหมด (All)" : "All Status"}</option>
                  <option value="ready">{isThai ? "🟢 พร้อมใช้ (Unrestricted)" : "🟢 Ready"}</option>
                  <option value="preparing">{isThai ? "🟠 กำลังเตรียม (Preparing)" : "🟠 Preparing"}</option>
                  <option value="pending_location">{isThai ? "🟡 รอสแกน Location" : "🟡 Pending Location Scan"}</option>
                </select>
              </div>

              <div className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <select
                  value={stockPageSize}
                  onChange={(e) => {
                    setStockPageSize(Number(e.target.value));
                    setStockCurrentPage(1);
                  }}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value={10}>10 {isThai ? "แถว" : "rows"}</option>
                  <option value={20}>20 {isThai ? "แถว" : "rows"}</option>
                  <option value={50}>50 {isThai ? "แถว" : "rows"}</option>
                </select>
              </div>
            </div>
          </div>

          {/* SAP Fiori Compact Table */}
          <div className="w-full overflow-x-auto border rounded-xl bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f]">
            <table className="w-full text-xs border-collapse whitespace-nowrap">
              <colgroup>
                <col className="w-14" />
                <col className="w-36" />
                <col className="w-32" />
                <col className="w-36" />
                <col className="w-64" />
                <col className="w-36" />
                <col className="w-28" />
                <col className="w-36" />
                <col className="w-20" />
              </colgroup>
              <thead>
                <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-[#1e3a5f] font-bold">
                  <th className="!py-2.5 !px-3 !text-center w-14 align-middle">No.</th>
                  <th className="!py-2.5 !px-3 !text-center text-blue-700 dark:text-blue-400 align-middle">Location</th>
                  <th className="!py-2.5 !px-3 !text-center text-cyan-700 dark:text-cyan-300 bg-cyan-50/50 dark:bg-cyan-950/20 align-middle">
                    Batch
                  </th>
                  <th className="!py-2.5 !px-3 !text-center font-bold align-middle">
                    {isThai ? "สถานะ" : "Status"}
                  </th>
                  <th className="!py-2.5 !px-3 !text-left align-middle">Description</th>
                  <th className="!py-2.5 !px-3 !text-center align-middle">หนา (mm) x กว้าง (mm)</th>
                  <th className="!py-2.5 !px-3 !text-center align-middle">Grade</th>
                  <th className="!py-2.5 !px-3 !text-right text-emerald-700 dark:text-emerald-400 align-middle">
                    Unrestricted (kg)
                  </th>
                  <th className="!py-2.5 !px-3 !text-center align-middle">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1e3a5f]/60 font-mono">
                {paginatedStockList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="!py-8 !px-4 !text-center text-slate-400 font-sans">
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <Package size={28} className="text-slate-300 dark:text-slate-600" />
                        <span className="font-bold text-xs">
                          {isThai ? "ไม่พบข้อมูล Stock คงคลังตรงตามเงื่อนไข" : "No stock items found matching filter"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedStockList.map((row, idx) => {
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-[#152646] transition-colors text-slate-800 dark:text-slate-200"
                      >
                        {/* No. */}
                        <td className="!py-2 !px-3 !text-center text-slate-400 text-[11px] align-middle">
                          {stockStartIndex + idx + 1}
                        </td>

                        {/* Location */}
                        <td className="!py-2 !px-3 !text-center align-middle">
                          <div className="inline-flex items-center justify-center">
                            {row.location && row.location !== "-" && row.location !== "รอระบุ" && !row.location.includes("รอสแกน") ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold text-[11px]">
                                📍 {row.location}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-semibold text-[10px]">
                                ⏳ รอสแกน Location
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Batch */}
                        <td className="!py-2 !px-3 !text-center font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-50/40 dark:bg-cyan-950/10 text-[11px] align-middle">
                          {row.batch}
                        </td>

                        {/* Status Column */}
                        <td className="!py-2 !px-3 !text-center whitespace-nowrap align-middle">
                          <div className="inline-flex items-center justify-center">
                            {row.stockStatus === "preparing" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shadow-2xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                <span>{isThai ? "กำลังเตรียม" : "Preparing"}</span>
                                {row.preparedOrderNo && (
                                  <span className="font-mono text-[9px] opacity-90">#{row.preparedOrderNo}</span>
                                )}
                              </span>
                            ) : row.stockStatus === "pending_location" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100/80 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                <span>{isThai ? "รอสแกน Location" : "Pending Location"}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span>{isThai ? "พร้อมใช้" : "Ready"}</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Description */}
                        <td className="!py-2 !px-3 !text-left font-sans text-xs align-middle">
                          {row.hasSapData && row.description ? (
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {row.description}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300 dark:border-amber-800">
                              รอระบบ SAP
                            </span>
                          )}
                        </td>

                        {/* Thickness x Width */}
                        <td className="!py-2 !px-3 !text-center text-xs font-semibold align-middle">
                          {row.certThickness || row.width
                            ? `${formatDimension2Decimals(row.certThickness, "-")} x ${formatDimension2Decimals(row.width, "-")}`
                            : "-"}
                        </td>

                        {/* Grade */}
                        <td className="!py-2 !px-3 !text-center font-semibold text-xs align-middle">
                          {row.grade || "-"}
                        </td>

                        {/* Unrestricted Weight */}
                        <td className="!py-2 !px-3 !text-right font-bold text-emerald-600 dark:text-emerald-400 text-xs align-middle">
                          {sanitizeWeightKg(row.weightKg, row.unrestricted).toLocaleString()} kg
                        </td>

                        {/* Actions */}
                        <td className="!py-2 !px-3 !text-center font-sans align-middle">
                          <div className="inline-flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => setSelectedRecord(row)}
                              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-cyan-600 dark:text-cyan-400 cursor-pointer inline-flex items-center justify-center"
                              title={isThai ? "ดูรายละเอียด" : "View Details"}
                            >
                              <Eye size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Summary & Pagination */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="font-semibold text-slate-700 dark:text-slate-300">
              {isThai ? "ยอดรวมน้ำหนักคงคลังทั้งหมด (หน้าปัจจุบัน):" : "Total Current Stock Weight:"}{" "}
              <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400 text-sm ml-1">
                {stockTotalWeightKg.toLocaleString()} kg
              </span>{" "}
              <span className="text-slate-400">({stockTotalWeightTon} TON)</span>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStockCurrentPage(1)}
                disabled={validStockCurrentPage <= 1}
                className="p-1.5 rounded border text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronsLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => setStockCurrentPage(validStockCurrentPage - 1)}
                disabled={validStockCurrentPage <= 1}
                className="px-2.5 py-1.5 rounded border text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft size={14} />
                <span>{isThai ? "ก่อนหน้า" : "Prev"}</span>
              </button>

              <div className="px-3 py-1 rounded bg-slate-200/60 dark:bg-[#111e38] font-mono text-xs font-bold border border-slate-300 dark:border-[#1e3a5f]">
                {validStockCurrentPage} / {stockTotalPages}
              </div>

              <button
                type="button"
                onClick={() => setStockCurrentPage(validStockCurrentPage + 1)}
                disabled={validStockCurrentPage >= stockTotalPages}
                className="px-2.5 py-1.5 rounded border text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
              >
                <span>{isThai ? "ถัดไป" : "Next"}</span>
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => setStockCurrentPage(stockTotalPages)}
                disabled={validStockCurrentPage >= stockTotalPages}
                className="p-1.5 rounded border text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronsRight size={14} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 5. Return to Warehouse (คืนคลัง) View */}
      {activeMode === "return_warehouse" && (
        <section className="space-y-2 sm:space-y-3 font-sans">
          {/* Header Banner & Stats */}
          <div className="p-2.5 sm:p-3.5 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                  <RotateCcw size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100">
                      {isThai ? "คืนคลัง" : "Return to Warehouse"}
                    </h2>
                    <span className="px-1.5 py-0.5 rounded-full text-[9.5px] sm:text-[10px] font-bold bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-800">
                      {isThai ? "อ้างอิงใบสั่งเบิก" : "Order Referenced"}
                    </span>
                  </div>
                  <p className="hidden text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isThai
                      ? "รับคืนเหล็กสลิตจากหน้าเครื่องจักรกลับเข้าสต็อกคงคลัง (คืนบางส่วนหรือทั้งหมด ข้อมูลจะวิ่งเข้าสต็อกและประวัติการเคลื่อนไหว)"
                      : "Return dispatched slit steel coils from machines back into warehouse stock balance & movement history."}
                  </p>
                </div>
              </div>

              {/* Action: Bulk Return Button & Clear Return Data Button */}
              <div className="flex items-center gap-2">
                {returnableBatches.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllReturnData}
                    className="hidden px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 transition-colors items-center gap-1.5 border border-slate-200 dark:border-slate-700 shadow-2xs cursor-pointer"
                    title={isThai ? "ล้างรายการทั้งหมดในตารางคืนคลัง" : "Clear all returnable data"}
                  >
                    <Trash2 size={14} />
                    <span>{isThai ? "ล้างข้อมูลคืนคลัง" : "Clear Return Data"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleExecuteReturnToWarehouse()}
                  disabled={selectedReturnItems.length === 0}
                  className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer whitespace-nowrap ${
                    selectedReturnItems.length > 0
                      ? "bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white shadow-orange-600/30 active:scale-95 ring-2 ring-orange-400/30"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60"
                  }`}
                >
                  <RotateCcw size={13} />
                  <span>
                    {isThai
                      ? `ยืนยันรับคืนคลัง (${selectedReturnItems.length} รายการ)`
                      : `Confirm Return (${selectedReturnItems.length})`}
                  </span>
                </button>
              </div>
            </div>

            {/* 4 Mini KPI Cards (Hidden per user request) */}
            <div className="hidden grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
              <div className="p-2 sm:p-2.5 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">
                  {isThai ? "วัตถุดิบหน้าเครื่องทั้งหมด" : "Total at Machines"}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base sm:text-lg font-black font-mono text-slate-900 dark:text-slate-100">
                    {returnableBatches.length}
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold">{isThai ? "แถบ" : "coils"}</span>
                </div>
              </div>

              <div className="p-2 sm:p-2.5 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">
                  {isThai ? "เครื่องจักรที่มีงาน" : "Active Machines"}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base sm:text-lg font-black font-mono text-blue-600 dark:text-blue-400">
                    {returnableMachineIds.length}
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold">{isThai ? "เครื่อง" : "machines"}</span>
                </div>
              </div>

              <div className="p-2 sm:p-2.5 rounded-lg bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">
                  {isThai ? "ใบสั่งเบิกรอคืน" : "Pick Lists"}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base sm:text-lg font-black font-mono text-amber-600 dark:text-amber-400">
                    {returnableOrderNos.length}
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold">{isThai ? "ใบสั่ง" : "orders"}</span>
                </div>
              </div>

              <div className="p-2 sm:p-2.5 rounded-lg bg-orange-50/60 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/60">
                <span className="text-[10px] font-bold uppercase text-orange-700 dark:text-orange-300 block mb-0.5">
                  {isThai ? "เลือกคืนคลังรอบนี้" : "Selected to Return"}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base sm:text-lg font-black font-mono text-orange-600 dark:text-orange-400">
                    {selectedReturnItems.length}
                  </span>
                  <span className="text-[10px] text-orange-700 dark:text-orange-300 font-semibold">
                    ({selectedReturnWeightTon} {isThai ? "ตัน" : "TON"})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Search, Filter & Quick Barcode Scanner Card */}
          <div className="p-2 sm:p-3 rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs space-y-2">
            {/* 1. Barcode Scanner Gun Input (Instant Scan to Select) */}
            <div>
              <label className="block text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Barcode size={14} className="text-orange-500" />
                  <span>{isThai ? "สแกนบาร์โค้ด Batch เพื่อเลือกคืนคลังทันที:" : "Scan Batch Barcode to Select:"}</span>
                </span>
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleScanReturnBatchBarcode(returnBarcodeInput);
                }}
                className="flex gap-1.5 sm:gap-2"
              >
                <div className="relative flex-1">
                  <input
                    ref={returnBarcodeInputRef}
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={returnBarcodeInput}
                    onChange={(e) => {
                      const val = cleanBarcode(e.target.value);
                      setReturnBarcodeInput(val);
                      if (val.length === 10) {
                        handleScanReturnBatchBarcode(val);
                      }
                    }}
                    placeholder={isThai ? "ยิงบาร์โค้ด Batch 10 หลัก..." : "Scan 10-char Batch barcode..."}
                    className="w-full pl-2.5 pr-8 py-1.5 text-xs font-mono font-bold rounded-lg bg-white dark:bg-[#0c1930] border-2 border-orange-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 shadow-inner"
                  />
                  <div className="absolute right-2.5 top-2 text-orange-500">
                    <Barcode size={15} />
                  </div>
                </div>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg font-bold text-xs bg-orange-600 hover:bg-orange-700 text-white shadow-xs cursor-pointer transition-all active:scale-95 flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus size={13} />
                  <span>{isThai ? "เลือก" : "Select"}</span>
                </button>
              </form>
            </div>

            {/* 2. Filter Bar: Machine, Order No., Keyword (Single Row on Mobile & Desktop) */}
            <div className="pt-1.5 border-t border-slate-100 dark:border-[#1e3a5f]/60 grid grid-cols-3 gap-1.5 sm:gap-2">
              {/* Machine Filter */}
              <div className="min-w-0">
                <label className="block text-[9.5px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-0.5 truncate">
                  {isThai ? "เครื่องจักร:" : "Machine:"}
                </label>
                <select
                  value={returnMachineFilter}
                  onChange={(e) => {
                    setReturnMachineFilter(e.target.value);
                    setReturnCurrentPage(1);
                  }}
                  className="w-full px-1.5 py-1 sm:px-2.5 sm:py-1.5 text-[10.5px] sm:text-xs font-bold rounded-lg bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-orange-500"
                >
                  <option value="all">{isThai ? "ทุกเครื่อง" : "All"}</option>
                  {returnableMachineIds.map((mId) => (
                    <option key={mId} value={mId}>
                      {mId} ({returnableBatches.filter((b) => b.machineId === mId).length})
                    </option>
                  ))}
                </select>
              </div>

              {/* Order Number Filter */}
              <div className="min-w-0">
                <label className="block text-[9.5px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-0.5 truncate">
                  {isThai ? "เลขที่ใบสั่งเบิก:" : "Pick List:"}
                </label>
                <select
                  value={returnOrderFilter}
                  onChange={(e) => {
                    setReturnOrderFilter(e.target.value);
                    setReturnCurrentPage(1);
                  }}
                  className="w-full px-1.5 py-1 sm:px-2.5 sm:py-1.5 text-[10.5px] sm:text-xs font-bold rounded-lg bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-orange-500 font-mono"
                >
                  <option value="all">{isThai ? "ทุกใบสั่ง" : "All"}</option>
                  {returnableOrderNos.map((ordNo) => (
                    <option key={ordNo} value={ordNo}>
                      #{ordNo} ({returnableBatches.filter((b) => b.orderNo === ordNo).length})
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Keyword */}
              <div className="min-w-0">
                <label className="block text-[9.5px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-0.5 truncate">
                  {isThai ? "ค้นหาคำค้น:" : "Search:"}
                </label>
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-2 text-slate-400" />
                  <input
                    type="text"
                    value={returnSearchKeyword}
                    onChange={(e) => {
                      setReturnSearchKeyword(e.target.value);
                      setReturnCurrentPage(1);
                    }}
                    placeholder={isThai ? "Batch, เกรด..." : "Batch, grade..."}
                    className="w-full pl-6 pr-2 py-1 sm:py-1.5 text-[10.5px] sm:text-xs rounded-lg bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            </div>

            {/* Selection Toolbar */}
            <div className="pt-1.5 border-t border-slate-100 dark:border-[#1e3a5f]/60 flex flex-nowrap items-center justify-between gap-1.5 sm:gap-2 whitespace-nowrap">
              <span className="text-[10px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">
                {isThai
                  ? `เลือก: ${selectedReturnItems.length}/${filteredReturnBatches.length} รายการ`
                  : `Selected: ${selectedReturnItems.length}/${filteredReturnBatches.length}`}
              </span>

              <div className="flex items-center gap-1 sm:gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 flex-shrink-0">
                {selectedReturnItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteSelectedReturnItems}
                    className="px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/80 hover:bg-rose-100 dark:hover:bg-rose-900 text-[9.5px] sm:text-[11px] font-bold text-rose-700 dark:text-rose-300 cursor-pointer transition-colors shadow-2xs flex items-center gap-0.5 sm:gap-1 whitespace-nowrap"
                    title={isThai ? "ลบรายการที่เลือกออกจากตารางคืนคลัง" : "Delete selected items"}
                  >
                    <Trash2 size={11} />
                    <span>{isThai ? `ลบ (${selectedReturnItems.length})` : `Delete (${selectedReturnItems.length})`}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleSelectAllReturn}
                  className="px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#111e38] hover:bg-slate-50 dark:hover:bg-[#152646] text-[9.5px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-300 cursor-pointer transition-colors shadow-2xs whitespace-nowrap"
                >
                  {returnSelectedBatchIds.length === filteredReturnBatches.length && filteredReturnBatches.length > 0
                    ? (isThai ? "ยกเลิกเลือก" : "Deselect All")
                    : (isThai ? `เลือกทั้งหมด (${filteredReturnBatches.length})` : `Select All (${filteredReturnBatches.length})`)}
                </button>
              </div>
            </div>
          </div>

          {/* Return Table Card */}
          <div className="rounded-xl border bg-white dark:bg-[#111e38] border-slate-200/90 dark:border-[#1e3a5f] shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] sm:text-xs border-collapse whitespace-nowrap">
                <colgroup>
                  <col className="w-8 sm:w-10" />
                  <col className="w-9 sm:w-12" />
                  <col className="w-28 sm:w-36" />
                  <col className="w-28 sm:w-36" />
                  <col className="w-36 sm:w-48" />
                  <col className="w-32 sm:w-44" />
                  <col className="w-16 sm:w-24" />
                  <col className="w-24 sm:w-32" />
                  <col className="w-36 sm:w-48" />
                  <col className="w-28 sm:w-40" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#0c1930] text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-[#1e3a5f] font-bold text-[10px] sm:text-xs">
                    <th className="!py-1.5 !px-1.5 sm:!py-2.5 sm:!px-3 !text-center w-8 sm:w-10">
                      <input
                        type="checkbox"
                        checked={filteredReturnBatches.length > 0 && returnSelectedBatchIds.length === filteredReturnBatches.length}
                        onChange={handleToggleSelectAllReturn}
                        className="rounded border-slate-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                        title={isThai ? "เลือกทั้งหมด" : "Select all"}
                      />
                    </th>
                    <th className="!py-1.5 !px-1.5 sm:!py-2.5 sm:!px-2 !text-center w-9 sm:w-12 text-slate-400">No.</th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-center text-cyan-700 dark:text-cyan-300 bg-cyan-50/50 dark:bg-cyan-950/20">
                      Batch
                    </th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-center text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20">
                      {isThai ? "เลขที่ใบสั่งเบิก" : "Order No."}
                    </th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-center text-blue-700 dark:text-blue-400">
                      {isThai ? "เครื่อง / แคร่" : "Machine / Rack"}
                    </th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-center">{isThai ? "หนา x กว้าง" : "Spec (Thk x Width)"}</th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-center">Grade</th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-right text-emerald-700 dark:text-emerald-400">
                      {isThai ? "น้ำหนัก (kg)" : "Weight (kg)"}
                    </th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-center text-orange-700 dark:text-orange-400 bg-orange-50/50 dark:bg-orange-950/20">
                      {isThai ? "Location รับคืน" : "Return Location"}
                    </th>
                    <th className="!py-1.5 !px-2 sm:!py-2.5 sm:!px-3 !text-center">{isThai ? "จัดการ" : "Action"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#1e3a5f]/60 font-mono text-[10px] sm:text-xs">
                  {paginatedReturnBatches.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="!py-6 sm:!py-12 !px-3 sm:!px-4 !text-center text-slate-400 font-sans">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <Package size={24} className="text-slate-300 dark:text-slate-600 sm:w-8 sm:h-8" />
                          <div className="font-bold text-[11px] sm:text-sm text-slate-600 dark:text-slate-300">
                            {isThai
                              ? "ไม่มีรายการวัตถุดิบค้างอยู่ที่หน้าเครื่องจักร"
                              : "No materials currently at machines or matching search filter."}
                          </div>
                          <p className="hidden sm:block text-[11px] text-slate-400 max-w-md">
                            {isThai
                              ? "เมื่อมีงานที่ถูกเบิกจ่ายหรือรับเข้าหน้าเครื่อง (เช่น TM01, CF01) ข้อมูลจะปรากฏที่นี่เพื่อให้สามารถทำเรื่องคืนคลังได้ทันที"
                              : "Dispatched coils waiting at machine areas will appear here for partial or full warehouse return."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedReturnBatches.map((row, idx) => {
                      const isSelected = returnSelectedBatchIds.includes(row.batch);
                      const currentDestLoc = customReturnLocations[row.batch] || row.defaultLocation;

                      return (
                        <tr
                          key={row.id}
                          className={`hover:bg-orange-50/30 dark:hover:bg-[#152646] transition-colors ${
                            isSelected ? "bg-orange-50/50 dark:bg-orange-950/25" : ""
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="!py-1.5 !px-1.5 sm:!py-2 sm:!px-3 !text-center w-8 sm:w-10">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectReturnBatch(row.batch)}
                              className="rounded border-slate-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                            />
                          </td>

                          {/* No. */}
                          <td className="!py-1.5 !px-1.5 sm:!py-2 sm:!px-2 !text-center w-9 sm:w-12 text-slate-400 text-[10px] sm:text-[11px]">
                            {returnStartIndex + idx + 1}
                          </td>

                          {/* Batch Barcode */}
                          <td className="!py-1.5 !px-2 sm:!py-2 sm:!px-3 !text-center font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-50/30 dark:bg-cyan-950/10 text-[10.5px] sm:text-[11px]">
                            {row.batch}
                          </td>

                          {/* Order Number */}
                          <td className="!py-1.5 !px-2 sm:!py-2 sm:!px-3 !text-center font-bold text-amber-600 dark:text-amber-400 bg-amber-50/20 dark:bg-amber-950/10 text-[10.5px] sm:text-[11px]">
                            {row.orderNo !== "-" ? `#${row.orderNo}` : "-"}
                          </td>

                          {/* Machine / Rack */}
                          <td className="!py-1.5 !px-2 sm:!py-2 sm:!px-3 !text-center">
                            <div className="inline-flex items-center justify-center gap-1">
                              <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded font-black text-[10px] sm:text-[11px] bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
                                {row.machineCode}
                              </span>
                              {row.rackNameTh && row.rackNameTh !== "-" && (
                                <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {row.rackNameTh}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Spec */}
                          <td className="!py-1.5 !px-2 sm:!py-2 sm:!px-3 !text-center font-sans text-[10px] sm:text-xs text-slate-700 dark:text-slate-300">
                            {row.spec}
                          </td>

                          {/* Grade */}
                          <td className="!py-1.5 !px-2 sm:!py-2 sm:!px-3 !text-center font-bold text-[10px] sm:text-xs text-slate-800 dark:text-slate-200">
                            {row.grade}
                          </td>

                          {/* Weight */}
                          <td className="!py-1.5 !px-2 sm:!py-2 sm:!px-3 !text-right font-bold text-emerald-600 dark:text-emerald-400 text-[10.5px] sm:text-xs tabular-nums">
                            {row.weightKg.toLocaleString()}
                          </td>

                          {/* Return Location (Editable + Quick Chips) */}
                          <td className="!py-1 !px-2 sm:!py-1.5 sm:!px-3 !text-center bg-orange-50/30 dark:bg-orange-950/10">
                            <div className="inline-flex items-center justify-center gap-1">
                              <input
                                type="text"
                                value={currentDestLoc}
                                onChange={(e) => handleSetReturnLocationForBatch(row.batch, e.target.value)}
                                placeholder={row.defaultLocation}
                                className="w-20 sm:w-28 px-1.5 py-0.5 text-[10.5px] sm:text-xs font-mono font-bold text-center rounded bg-white dark:bg-[#0c1930] border border-orange-400 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-orange-500"
                              />
                              <span
                                className="text-[9.5px] sm:text-[10px] text-slate-400 font-sans cursor-pointer hover:text-orange-600"
                                onClick={() => handleSetReturnLocationForBatch(row.batch, row.defaultLocation)}
                                title={isThai ? `รีเซ็ตเป็นค่าเริ่มต้น (${row.defaultLocation})` : "Reset to default"}
                              >
                                ({row.defaultLocation})
                              </span>
                            </div>
                          </td>

                          {/* Action: Single Return & Delete */}
                          <td className="!py-1.5 !px-2 sm:!py-2 sm:!px-3 !text-center">
                            <div className="inline-flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleExecuteReturnToWarehouse(row)}
                                className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-[11px] font-bold bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/80 dark:hover:bg-orange-900 text-orange-800 dark:text-orange-200 border border-orange-300 dark:border-orange-800 transition-all cursor-pointer flex items-center gap-0.5 sm:gap-1"
                                title={isThai ? "คืนคลังรายการนี้" : "Return this batch"}
                              >
                                <RotateCcw size={11} />
                                <span>{isThai ? "คืนคลัง" : "Return"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteReturnableItem(row)}
                                className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-[11px] font-bold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/70 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 transition-all cursor-pointer flex items-center gap-0.5 sm:gap-1"
                                title={isThai ? "ลบรายการนี้ออกจากตารางคืนคลัง" : "Delete this item"}
                              >
                                <Trash2 size={11} />
                                <span>{isThai ? "ลบ" : "Delete"}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer with Summary & Pagination (Single-Row Compact on Mobile) */}
            <div className="px-2 py-1.5 sm:p-3 bg-slate-50 dark:bg-[#0c1930] border-t border-slate-200 dark:border-[#1e3a5f] flex flex-nowrap items-center justify-between gap-1.5 sm:gap-3 text-[10px] sm:text-xs whitespace-nowrap overflow-x-auto">
              <div className="flex items-center gap-1.5 sm:gap-2 text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap">
                <span className="sm:hidden">
                  {isThai
                    ? `แสดง ${filteredReturnBatches.length === 0 ? 0 : returnStartIndex + 1}-${returnEndIndex} จาก ${filteredReturnBatches.length}`
                    : `${filteredReturnBatches.length === 0 ? 0 : returnStartIndex + 1}-${returnEndIndex} of ${filteredReturnBatches.length}`}
                </span>
                <span className="hidden sm:inline">
                  {isThai
                    ? `แสดง ${filteredReturnBatches.length === 0 ? 0 : returnStartIndex + 1} - ${returnEndIndex} จากทั้งหมด ${filteredReturnBatches.length} รายการ`
                    : `Showing ${filteredReturnBatches.length === 0 ? 0 : returnStartIndex + 1} - ${returnEndIndex} of ${filteredReturnBatches.length} items`}
                </span>
                {selectedReturnItems.length > 0 && (
                  <span className="px-1.5 py-0.5 sm:px-2 rounded-full font-bold bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-300 border border-orange-300 dark:border-orange-800 text-[9.5px] sm:text-[11px]">
                    {isThai ? `เลือก ${selectedReturnItems.length} (${selectedReturnWeightTon} ตัน)` : `Selected ${selectedReturnItems.length}`}
                  </span>
                )}
              </div>

              {/* Rows Per Page & Pagination Controls */}
              <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                <div className="flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-[11px] text-slate-500">
                  <span>{isThai ? "แถว:" : "Rows:"}</span>
                  <select
                    value={returnPageSize}
                    onChange={(e) => {
                      setReturnPageSize(Number(e.target.value));
                      setReturnCurrentPage(1);
                    }}
                    className="px-1 py-0.5 sm:px-1.5 text-[10px] sm:text-xs rounded bg-white dark:bg-[#111e38] border border-slate-300 dark:border-[#1e3a5f] text-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div className="flex items-center gap-0.5 sm:gap-1">
                  <button
                    type="button"
                    onClick={() => setReturnCurrentPage(1)}
                    disabled={validReturnCurrentPage <= 1}
                    className="p-1 sm:p-1.5 rounded border text-[10px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronsLeft size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnCurrentPage(validReturnCurrentPage - 1)}
                    disabled={validReturnCurrentPage <= 1}
                    className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded border text-[10px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 sm:gap-1 cursor-pointer"
                  >
                    <ChevronLeft size={12} />
                    <span className="hidden sm:inline">{isThai ? "ก่อนหน้า" : "Prev"}</span>
                  </button>

                  <div className="px-1.5 py-0.5 sm:px-2.5 rounded bg-slate-200/60 dark:bg-[#111e38] font-mono text-[10px] sm:text-xs font-bold border border-slate-300 dark:border-[#1e3a5f]">
                    {validReturnCurrentPage}/{returnTotalPages}
                  </div>

                  <button
                    type="button"
                    onClick={() => setReturnCurrentPage(validReturnCurrentPage + 1)}
                    disabled={validReturnCurrentPage >= returnTotalPages}
                    className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded border text-[10px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5 sm:gap-1 cursor-pointer"
                  >
                    <span className="hidden sm:inline">{isThai ? "ถัดไป" : "Next"}</span>
                    <ChevronRight size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnCurrentPage(returnTotalPages)}
                    disabled={validReturnCurrentPage >= returnTotalPages}
                    className="p-1 sm:p-1.5 rounded border text-[10px] sm:text-xs font-semibold bg-white dark:bg-[#111e38] border-slate-300 dark:border-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronsRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}




      {/* Delete Confirmation SweetAlert Modal */}
      {deleteModalOrderNo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl p-6 text-center transform transition-all animate-scale-in">
            <div className="w-20 h-20 rounded-full border-4 border-rose-500/30 bg-rose-50 dark:bg-rose-950/60 flex items-center justify-center mx-auto mb-4 shadow-inner">
              <AlertTriangle size={40} className="text-rose-500 animate-pulse" />
            </div>

            <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">
              {isThai ? `ยืนยันการลบใบสั่งเบิก [${deleteModalOrderNo}]?` : `Confirm Delete Pick List [${deleteModalOrderNo}]?`}
            </h3>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
              {isThai
                ? "การลบใบสั่งเบิกนี้จะนำออกจากระบบถาวร ไม่สามารถย้อนกลับได้"
                : "This action will permanently remove the pick list order from the system."}
            </p>

            <div className="flex items-center gap-3 mt-6">
              <button
                type="button"
                onClick={() => setDeleteModalOrderNo(null)}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all cursor-pointer"
              >
                {isThai ? "ยกเลิก (Cancel)" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOrder}
                className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/30 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 size={16} />
                <span>{isThai ? "ยืนยันลบ (Delete)" : "Confirm Delete"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Operator Wrong Machine Warning Modal */}
      {operatorWarningModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border bg-white dark:bg-[#111e38] border-rose-300 dark:border-rose-900 shadow-2xl p-6 text-center transform transition-all animate-scale-in">
            <div className="w-20 h-20 rounded-full border-4 border-rose-500/30 bg-rose-50 dark:bg-rose-950/60 flex items-center justify-center mx-auto mb-4 shadow-inner">
              <AlertTriangle size={44} className="text-rose-500 animate-pulse" />
            </div>

            <h3 className="text-lg font-extrabold text-rose-600 dark:text-rose-400">
              {operatorWarningModal.title}
            </h3>

            <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 p-3 bg-rose-50/50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-900 font-medium">
              {operatorWarningModal.message}
            </p>

            <button
              type="button"
              onClick={() => {
                setOperatorWarningModal({ isOpen: false, title: "", message: "" });
                modalScannerInputRef.current?.focus();
              }}
              className="mt-5 w-full py-3 px-6 rounded-xl font-bold text-sm bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/30 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Check size={18} />
              <span>{isThai ? "รับทราบ / ตรวจสอบใหม่ (OK)" : "Understand & Retry"}</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. SweetAlert2-Style Success Modal (Iconic Animated Checkmark & Confirmation) */}
      {sweetAlertData.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl p-6 text-center transform transition-all animate-scale-in">
            {/* Animated SweetAlert Success Icon */}
            <div className="w-20 h-20 rounded-full border-4 border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center mx-auto mb-4 shadow-inner">
              <CheckCircle2 size={44} className="text-emerald-500 animate-pulse" />
            </div>

            <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">
              {isThai ? "ยืนยันการรับเข้าสำเร็จ!" : "Inbound Confirmed Successfully!"}
            </h3>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {isThai
                ? "ข้อมูล Batch ได้รับการบันทึกเข้าสู่คลังสินค้าเรียบร้อยแล้ว"
                : "Batch records have been successfully committed to warehouse storage."}
            </p>

            {/* Inbound Summary Card */}
            <div className="my-5 p-4 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] text-left space-y-2 text-xs">
              {/* Machine */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {isThai ? "เครื่องจักรต้นทาง:" : "Source Machine:"}
                </span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                  [ {sweetAlertData.machine} ]
                </span>
              </div>

              {/* Batches count */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {isThai ? "จำนวน Batch ที่รับเข้า:" : "Batches Received:"}
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {sweetAlertData.batchCount} {isThai ? "รายการ" : "items"}
                </span>
              </div>

              {/* Total Weight */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {isThai ? "น้ำหนักรวม (Unrestricted):" : "Total Net Weight:"}
                </span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                  {sweetAlertData.totalWeightKg.toLocaleString()} kg ({sweetAlertData.totalWeightTon} TON)
                </span>
              </div>

              {/* Storage Location */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {isThai ? "Location จัดเก็บ:" : "Storage Location:"}
                </span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {sweetAlertData.location}
                </span>
              </div>

              {/* Timestamp */}
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {isThai ? "บันทึกเวลา:" : "Timestamp:"}
                </span>
                <span className="font-mono text-slate-600 dark:text-slate-300 text-[11px]">
                  {sweetAlertData.timestamp}
                </span>
              </div>
            </div>

            {/* SweetAlert Confirm Button */}
            <button
              type="button"
              onClick={handleCloseSweetAlert}
              className="w-full py-3 px-6 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Check size={18} />
              <span>{isThai ? "ตกลง / ยืนยันเรียบร้อย (OK)" : "OK, Confirmed"}</span>
            </button>
          </div>
        </div>
      )}

      {/* 6. Detail Inspection Modal */}
      {selectedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onMouseDown={() => setSelectedRecord(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-cyan-500" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <span>{isThai ? "รายละเอียดรายการสแกน Batch" : "Scanned Batch Record Details"}:</span>
                    <span className="font-mono text-cyan-600 dark:text-cyan-400">{selectedRecord.batch}</span>
                    {selectedRecord.hasSapData === false ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                        {isThai ? "รอข้อมูล SAP" : "Pending SAP Data"}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        {isThai ? "จับคู่ SAP แล้ว" : "SAP Mapped"}
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isThai ? "บันทึกเวลา" : "Recorded at"}: {selectedRecord.scanTimestamp} ·{" "}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 uppercase">
                      {selectedRecord.mode}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs max-h-[70vh] overflow-y-auto">
              <div className="p-2.5 rounded bg-cyan-50/50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 sm:col-span-2">
                <span className="font-semibold text-cyan-700 dark:text-cyan-300 block mb-0.5">
                  {isThai ? "1. Batch (10 หลักที่สแกน - Key)" : "1. Batch Barcode (10 Digits - Key)"}
                </span>
                <span className="font-mono text-base font-extrabold text-cyan-600 dark:text-cyan-400">
                  {selectedRecord.batch}
                </span>
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">2. Sales Document</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.salesDoc || "-"}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">3. Material No.</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{selectedRecord.materialNo || "-"}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "4. หนา Certificated." : "4. Cert. Thickness"}</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{formatDimension2Decimals(selectedRecord.certThickness)}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">5. Storage Location</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.storageLocation || "-"}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "6. ความหนาเป้าหมาย" : "6. Target Thickness"}</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{formatDimension2Decimals(selectedRecord.targetThickness)}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "7. กว้าง" : "7. Width"}</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{formatDimension2Decimals(selectedRecord.width)}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">8. Unrestricted (น้ำหนัก)</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                    {sanitizeWeightKg(selectedRecord.weightKg, selectedRecord.unrestricted).toLocaleString()} kg
                  </span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "9. ชั้นคุณภาพ" : "9. Quality Class"}</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.qualityClass || "-"}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">10. Grade</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.grade}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "11. ผู้ผลิต" : "11. Manufacturer"}</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.manufacturer}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "12. รับจากเครื่อง (หน้างาน)" : "12. Machine"}</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{selectedRecord.machine}</span>
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">13. Location (หน้างาน)</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{selectedRecord.location}</span>
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "Location เดิม (ก่อนย้าย Layout)" : "Previous Location"}</span>
                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                  {getPreviousLocationForRecord(selectedRecord)}
                </span>
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f]">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "14. หมายเลขคอยล์" : "14. Coil No."}</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.coilNo || "-"}</span>
                )}
              </div>

              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] sm:col-span-2">
                <span className="font-semibold text-slate-500 dark:text-slate-400 block mb-0.5">{isThai ? "รายละเอียดสินค้า (Description)" : "Description"}</span>
                {selectedRecord.hasSapData === false ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">รอข้อมูล SAP</span>
                ) : (
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedRecord.description}</span>
                )}
              </div>
            </div>

            <div className="p-4 border-t flex justify-between items-center bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <button
                type="button"
                onClick={() => handleDeleteRecord(selectedRecord.id, selectedRecord.batch)}
                className="px-3 py-1.5 rounded text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                {isThai ? "ลบรายการนี้" : "Delete Record"}
              </button>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-1.5 rounded-md text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                {isThai ? "ปิดหน้าต่าง" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Officer Import Pick List Modal */}
      {isImportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in"
          onMouseDown={() => setIsImportModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <Upload size={22} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    {isThai ? "นำเข้าข้อมูลใบเบิก (Officer Pick List Import)" : "Officer Pick List Import"}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isThai
                      ? "คัดลอกตารางใบเบิกจาก SAP (CO03 กด F6) แล้วนำมาวางในช่องด้านล่าง"
                      : "Paste tab-delimited table text from Excel or SAP into the form below."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSaveImportedPickList} className="p-5 space-y-4 overflow-y-auto flex-1">
              {importError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle size={16} className="flex-shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {isThai ? "ใส่เลขที่ใบสั่งเบิก:" : "Order No.:"}
                  </label>
                  <input
                    type="text"
                    value={importOrderNo}
                    onChange={(e) => {
                      setImportOrderNo(e.target.value);
                      if (importError) setImportError(null);
                    }}
                    className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {isThai ? `เครื่องจักรเป้าหมาย (${outboundMachines.length} เครื่อง):` : "Target Machine:"}
                  </label>
                  <select
                    value={importMachineId}
                    onChange={(e) => setImportMachineId(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                  >
                    {outboundMachines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id} ({m.categoryTh})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>{isThai ? "วางข้อความตาราง (Paste Table / TSV Text):" : "Paste Table Text:"}</span>
                  <span className="text-[10px] text-amber-600 font-normal">
                    {isThai ? "* ประกอบด้วย BOM item, Material, Description, Qty, Unit, Batch..." : "* Tab-delimited TSV supported"}
                  </span>
                </label>
                <textarea
                  rows={6}
                  value={rawTableText}
                  onChange={(e) => setRawTableText(e.target.value)}
                  placeholder={`BOM item\tMaterial\tMaterial Description\tRequirement quantity\tBase Unit of Measure\tItem Category\tOperation\tSequence\tPlant\tStorage Location\tBatch\n0010\t3RMRPTS0-1005025\tวัตถุดิบแป๊บแบน100 X 50 X 2.50MM X FILM\t4081\tKG\tL\t0010\t0\t1200\t2E09\tRP00320002`}
                  className="w-full p-3 font-mono text-xs rounded-xl bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Preview of Parsed Rows */}
              {rawTableText.trim().length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                    <span>{isThai ? "ตัวอย่างข้อมูลที่ถอดรหัสได้ (Preview Parsed Items):" : "Parsed Preview:"}</span>
                    <span className="font-mono text-amber-600 dark:text-amber-400">
                      {parseRawTableText(rawTableText).length} {isThai ? "รายการ Batch" : "items"}
                    </span>
                  </div>

                  <div className="max-h-36 overflow-y-auto border rounded-lg p-2 bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f]">
                    {parseRawTableText(rawTableText).length > 0 ? (
                      <div className="space-y-1">
                        {parseRawTableText(rawTableText).map((item, idx) => (
                          <div
                            key={idx}
                            className="text-[11px] font-mono flex items-center justify-between py-1 px-2 rounded bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f]"
                          >
                            <span className="text-slate-400 min-w-[24px]">#{idx + 1}</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400 min-w-[120px]">{item.material}</span>
                            <span className="truncate max-w-[180px] text-slate-600 dark:text-slate-300">{item.description}</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{item.reqQty.toLocaleString()} {item.unit}</span>
                            <span className="font-extrabold text-amber-600 dark:text-amber-400">{item.batch}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-xs text-rose-500 font-semibold">
                        {isThai ? "ไม่พบรูปแบบ Batch ในข้อความที่วาง" : "No batch barcodes detected in pasted text."}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Footer Buttons */}
              <div className="pt-3 border-t border-slate-100 dark:border-[#1e3a5f] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400"
                >
                  {isThai ? "ยกเลิก" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={!importOrderNo.trim() || parseRawTableText(rawTableText).length === 0}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all active:scale-95 ${
                    !importOrderNo.trim() || parseRawTableText(rawTableText).length === 0
                      ? "opacity-50 bg-slate-300 text-slate-500 cursor-not-allowed"
                      : "bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-500/20"
                  }`}
                >
                  <Save size={16} />
                  <span>{isThai ? "บันทึกใบเบิกลงระบบ" : "Save Pick List"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Outbound Barcode Scanner Modal - Top Flush Layout */}
      {isOutboundScannerOpen && activePickListOrder && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-0 pt-0 sm:px-4 sm:pt-0 bg-slate-950/75 backdrop-blur-sm animate-fade-in"
          onMouseDown={() => setIsOutboundScannerOpen(false)}
        >
          <div
            className="w-full max-w-xl mt-0 rounded-b-2xl rounded-t-none border-t-0 border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal Header - Clean without subtext */}
            <div className="p-3 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Barcode size={18} />
                </div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isThai ? "สแกนบาร์โค้ด" : "Barcode Scanner"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOutboundScannerOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3">
              {/* 1. Barcode Input Form (At Very Top) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (outboundBarcodeInput.trim()) {
                    processOutboundBarcodeScan(outboundBarcodeInput);
                  }
                }}
                className="space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    {isThai ? "ยิงบาร์โค้ด Batch" : "Scan Batch Barcode"}
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsOutboundCameraActive((prev) => !prev)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 border ${
                      isOutboundCameraActive
                        ? "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                        : "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 hover:bg-amber-100"
                    }`}
                  >
                    <Camera size={14} />
                    <span>{isOutboundCameraActive ? (isThai ? "ปิดกล้อง" : "Close Cam") : (isThai ? "เปิดกล้องสแกน" : "Camera Scan")}</span>
                  </button>
                </div>

                {isOutboundCameraActive && (
                  <div className="mb-2">
                    <CameraBarcodeScanner
                      isThai={isThai}
                      placeholderText={isThai ? "เล็งกล้องไปที่บาร์โค้ด Batch" : "Point camera at Batch barcode"}
                      onScan={(decoded) => {
                        const cleaned = cleanBarcode(decoded);
                        if (cleaned) {
                          processOutboundBarcodeScan(cleaned);
                        }
                      }}
                      onClose={() => setIsOutboundCameraActive(false)}
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      ref={outboundScannerInputRef}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={outboundBarcodeInput}
                      onChange={(e) => {
                        const val = cleanBarcode(e.target.value);
                        setOutboundBarcodeInput(val);
                        if (val.length === 10) {
                          processOutboundBarcodeScan(val);
                        }
                      }}
                      placeholder={isThai ? "พร้อมรับการยิงบาร์โค้ด Batch..." : "Ready for batch scan..."}
                      className="w-full pl-4 pr-12 py-3 text-base font-mono font-bold tracking-widest rounded-xl bg-white dark:bg-[#0c1930] border-2 border-amber-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-amber-500/20 shadow-inner"
                    />
                    <div className="absolute right-3.5 top-3.5 text-amber-500">
                      <Barcode size={22} />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-3 rounded-xl font-bold text-xs bg-amber-600 hover:bg-amber-700 text-white shadow-sm cursor-pointer transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Barcode size={16} />
                    <span>{isThai ? "สแกน" : "Scan"}</span>
                  </button>
                </div>
              </form>

              {/* Order Verification Progress */}
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0c1930] border border-slate-200 dark:border-[#1e3a5f] flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500 dark:text-slate-400">
                  {isThai ? "สถานะการสแกน:" : "Progress:"}
                </span>
                <span className="font-extrabold text-amber-600 dark:text-amber-400 text-xs">
                  {activePickListOrder.items.filter((i) => i.status === "verified").length} / {activePickListOrder.items.length} {isThai ? "รายการสำเร็จ" : "verified"}
                </span>
              </div>

              {/* Status Banner */}
              {outboundScanStatus && (
                <div
                  className={`p-2.5 rounded-lg flex items-center justify-between text-xs font-semibold ${
                    outboundScanStatus.type === "success"
                      ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
                      : outboundScanStatus.type === "info"
                      ? "bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300"
                      : "bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {outboundScanStatus.type === "success" ? (
                      <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    ) : outboundScanStatus.type === "info" ? (
                      <Info size={16} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    ) : (
                      <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0" />
                    )}
                    <span>{outboundScanStatus.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOutboundScanStatus(null)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Item checklist preview - 2 columns only (Batch | สถานะ) */}
              <div className="border rounded-xl overflow-hidden bg-slate-50 dark:bg-[#0c1930] border-slate-200 dark:border-[#1e3a5f]">
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-slate-100 dark:bg-[#152646] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#1e3a5f] sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left font-mono font-bold">Batch</th>
                        <th className="p-2 text-center font-bold">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#1e3a5f]">
                      {activePickListOrder.items.map((item) => {
                        const isVerified = item.status === "verified";
                        return (
                          <tr
                            key={item.id}
                            onClick={() => {
                              if (!isVerified) {
                                processOutboundBarcodeScan(item.batch);
                              }
                            }}
                            className={`transition-colors ${
                              isVerified
                                ? "bg-emerald-50/80 dark:bg-emerald-950/40 text-slate-900 dark:text-slate-100"
                                : "bg-white dark:bg-[#111e38] text-slate-700 dark:text-slate-300 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 cursor-pointer"
                            }`}
                          >
                            <td className="p-2 font-mono font-black text-amber-600 dark:text-amber-400 text-xs">
                              {item.batch}
                            </td>
                            <td className="p-2 text-center">
                              {isVerified ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white">
                                  <Check size={10} />
                                  <span>สแกนแล้ว</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                  <Barcode size={10} />
                                  <span>รอสแกน (กดเพื่อสแกน)</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="pt-2 border-t border-slate-100 dark:border-[#1e3a5f] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOutboundScannerOpen(false)}
                  className="w-full py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-500/20 active:scale-95 transition-all cursor-pointer"
                >
                  {isThai ? "เสร็จสิ้นการสแกน" : "Done Scanning"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Officer SAP Upload & Mapping Modal */}
      {isSapModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in"
          onMouseDown={() => {
            if (!isSapProcessing) setIsSapModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border bg-white dark:bg-[#111e38] border-slate-200 dark:border-[#1e3a5f] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col font-sans"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b flex items-center justify-between bg-slate-50 dark:bg-[#0d1b33] border-slate-200 dark:border-[#1e3a5f]">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border transition-all ${
                  isSapProcessing 
                    ? "bg-cyan-500/10 text-cyan-500 border-cyan-500/30" 
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                }`}>
                  <Database size={22} className={isSapProcessing ? "animate-pulse" : ""} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                      {isThai ? "อัปโหลดและจับคู่ข้อมูล SAP (SAP Master Data Upload)" : "Upload & Map SAP Master Data"}
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                      Officer Only
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {isSapProcessing
                      ? (isThai ? "ระบบกำลังประมวลผลโครงสร้างข้อมูลและจับคู่ฐานข้อมูล..." : "Processing records and matching layout database...")
                      : (isThai
                          ? "อัปโหลดไฟล์ TSV/Excel จาก SAP จาก คุณภาพม้วน"
                          : "Upload TSV/Excel from SAP")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSapProcessing}
                onClick={() => {
                  if (!isSapProcessing) setIsSapModalOpen(false);
                }}
                className={`p-1.5 rounded-lg transition-colors ${
                  isSapProcessing
                    ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                }`}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            {isSapProcessing ? (
              /* Timed Delay Processing Animation View */
              <div className="p-8 flex flex-col items-center justify-center text-center space-y-6">
                {/* Animated Pulsing Sync Icon */}
                <div className="relative my-2">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-600/20 to-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-500/10">
                    <Database size={38} className="animate-pulse" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-md animate-spin">
                    <RefreshCw size={14} />
                  </div>
                  <div className="absolute -inset-2 rounded-3xl bg-cyan-500/10 animate-ping opacity-30 pointer-events-none" />
                </div>

                {/* Animated Stage Header */}
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin text-cyan-500" />
                    <span>
                      {sapProgress >= 100
                        ? (isThai ? "จับคู่และบันทึกข้อมูล SAP สำเร็จ!" : "SAP Mapping Completed!")
                        : (isThai ? "กำลังอัปโหลดและจับคู่ข้อมูล SAP..." : "Uploading & Mapping SAP Data...")}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md font-medium">
                    {sapCurrentStep === 1 && (isThai ? "ขั้นตอนที่ 1/4: กำลังตรวจสอบและอ่านโครงสร้างไฟล์ SAP Master Data..." : "Step 1/4: Validating file format and columns...")}
                    {sapCurrentStep === 2 && (isThai ? "ขั้นตอนที่ 2/4: กำลังแยกและจัดรูปแบบ 14 คอลัมน์ (Batch, กว้าง, หนา, Grade, ผู้ผลิต)..." : "Step 2/4: Structuring 14 SAP attributes...")}
                    {sapCurrentStep === 3 && (isThai ? "ขั้นตอนที่ 3/4: กำลังจับคู่รหัส Batch กับประวัติเคลื่อนไหวและแคร่วางหน้าเครื่อง..." : "Step 3/4: Cross-matching Batch barcodes with warehouse inventory...")}
                    {sapCurrentStep === 4 && (isThai ? "ขั้นตอนที่ 4/4: กำลังจัดเก็บฐานข้อมูลและอัปเดตประวัติการเคลื่อนไหว..." : "Step 4/4: Synchronizing local database and movement records...")}
                  </p>
                </div>

                {/* Live Progress Bar with Counter & Percentage */}
                <div className="w-full max-w-lg">
                  <div className="flex justify-between items-center text-xs font-semibold mb-2">
                    <span className="text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5 font-mono">
                      <Database size={13} />
                      {isThai
                        ? `ประมวลผลแล้ว: ${sapProcessedCount.toLocaleString()} / ${sapTotalCount.toLocaleString()} รายการ`
                        : `Processed: ${sapProcessedCount.toLocaleString()} / ${sapTotalCount.toLocaleString()} items`}
                    </span>
                    <span className="text-slate-800 dark:text-slate-100 font-mono font-extrabold text-sm">
                      {sapProgress}%
                    </span>
                  </div>
                  <div className="w-full h-3.5 bg-slate-200 dark:bg-[#0c1930] rounded-full overflow-hidden p-0.5 border border-slate-300 dark:border-[#1e3a5f] shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 rounded-full transition-all duration-300 ease-out shadow-sm shadow-cyan-500/30"
                      style={{ width: `${sapProgress}%` }}
                    />
                  </div>
                </div>

                {/* Multi-step Progressive Checklist */}
                <div className="w-full max-w-lg space-y-2 text-left pt-2">
                  {[
                    { step: 1, textTh: "1. ตรวจสอบความถูกต้องและอ่านโครงสร้างไฟล์ SAP", textEn: "1. Validate and verify SAP file structure" },
                    { step: 2, textTh: "2. แปลงและแยกข้อมูล 14 คอลัมน์ (Batch, กว้าง, หนา, Grade, ผู้ผลิต)", textEn: "2. Parse 14 columns (Batch, Dimensions, Grade, Vendor)" },
                    { step: 3, textTh: "3. จับคู่รหัส Batch กับสต็อกคลังและแคร่จัดเก็บหน้าเครื่อง", textEn: "3. Cross-match Batch barcodes with inventory & staging racks" },
                    { step: 4, textTh: "4. บันทึก Master Data และอัปเดตประวัติการเคลื่อนไหว", textEn: "4. Commit Master Data and sync Movement History" },
                  ].map((s) => {
                    const isDone = sapCurrentStep > s.step || (sapCurrentStep === 4 && sapProgress >= 100);
                    const isCurrent = sapCurrentStep === s.step && sapProgress < 100;
                    return (
                      <div
                        key={s.step}
                        className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all ${
                          isDone
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-medium"
                            : isCurrent
                            ? "bg-cyan-500/10 text-cyan-800 dark:text-cyan-200 border border-cyan-500/40 font-bold shadow-xs"
                            : "bg-slate-50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 border border-transparent"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                        ) : isCurrent ? (
                          <div className="w-4 h-4 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin flex-shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-700 flex-shrink-0" />
                        )}
                        <span className="truncate">{isThai ? s.textTh : s.textEn}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5 font-medium">
                  <Clock size={13} className="text-cyan-400 animate-pulse" />
                  <span>{isThai ? "กำลังหน่วงเวลาเพื่อตรวจสอบและผสานข้อมูลอย่างแม่นยำ..." : "Synchronizing records accurately, please wait..."}</span>
                </div>
              </div>
            ) : (
              /* Normal Upload & Input Form View */
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                {/* Hidden File Input for Excel (.xlsx, .xls) and Text (.csv, .tsv, .txt) */}
                <input
                  type="file"
                  ref={sapFileInputRef}
                  accept=".xlsx,.xls,.tsv,.csv,.txt,.tab"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = "";
                  }}
                />

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <FileSpreadsheet size={15} className="text-cyan-500" />
                      <span>{isThai ? "วางข้อมูลตาราง SAP (กดคลิกในช่องแล้วกด Ctrl + V ได้ทันที):" : "Paste SAP Data (Click & press Ctrl+V):"}</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => sapFileInputRef.current?.click()}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                      >
                        <Upload size={13} />
                        <span>{isThai ? "เลือกไฟล์ SAP (Excel .xlsx / .xls หรือ CSV)" : "Choose File (Excel / CSV)"}</span>
                      </button>
                    </div>
                  </div>

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        handleFileUpload(file);
                        return;
                      }
                      let droppedText = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text");
                      if (!droppedText && e.dataTransfer.getData("text/html")) {
                        const html = e.dataTransfer.getData("text/html");
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, "text/html");
                        const rows = Array.from(doc.querySelectorAll("tr"));
                        if (rows.length > 0) {
                          droppedText = rows
                            .map((r) =>
                              Array.from(r.querySelectorAll("td, th"))
                                .map((c) => c.textContent?.trim() || "")
                                .join("\t")
                            )
                            .join("\n");
                        } else {
                          droppedText = doc.body.textContent || "";
                        }
                      }
                      if (droppedText && droppedText.trim()) {
                        handleProcessPastedText(droppedText);
                      }
                    }}
                    className="relative"
                  >
                    <textarea
                      ref={sapTextAreaRef}
                      rows={12}
                      value={sapRawText}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val && val.trim().length > 0) {
                          handleProcessPastedText(val);
                          e.target.value = "";
                        } else {
                          setSapRawText(val);
                        }
                      }}
                      onPaste={(e) => {
                        let pasted = e.clipboardData?.getData("text/plain") || e.clipboardData?.getData("text") || "";
                        if (!pasted && e.clipboardData?.getData("text/html")) {
                          const html = e.clipboardData.getData("text/html");
                          const parser = new DOMParser();
                          const doc = parser.parseFromString(html, "text/html");
                          const rows = Array.from(doc.querySelectorAll("tr"));
                          if (rows.length > 0) {
                            pasted = rows
                              .map((r) =>
                                Array.from(r.querySelectorAll("td, th"))
                                  .map((c) => c.textContent?.trim() || "")
                                  .join("\t")
                              )
                              .join("\n");
                          } else {
                            pasted = doc.body.textContent || "";
                          }
                        }
                        if (pasted && pasted.trim().length > 0) {
                          e.preventDefault();
                          handleProcessPastedText(pasted);
                        }
                      }}
                      placeholder={
                        isThai
                          ? "👉 คลิกในช่องนี้แล้วกด Ctrl + V เพื่อวางข้อมูล (รองรับ 2,600+ รายการ) หรือลากไฟล์ Excel / CSV มาวางได้ทันที\nระบบจะเริ่มตัวหน่วงเวลาประมวลผล 4 ขั้นตอนและบันทึกข้อมูลทันที..."
                          : "👉 Click here and press Ctrl + V to paste SAP data (supports 2,600+ items) or drag & drop Excel / CSV file..."
                      }
                      className="w-full p-4 font-mono text-xs rounded-xl bg-white dark:bg-[#0c1930] border-2 border-cyan-500/80 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 shadow-inner"
                      spellCheck={false}
                      autoFocus
                    />
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1.5">
                    <Info size={13} className="text-cyan-500 flex-shrink-0" />
                    <span>
                      {isThai
                        ? "เคล็ดลับ: รองรับทั้งไฟล์ Excel (.xlsx, .xls) และ CSV ภาษาไทย (TIS-620/Windows-874/UTF-8) หรือกด Ctrl + V ได้ทันที"
                        : "Tip: Supports Excel (.xlsx, .xls) and Thai CSV (TIS-620/Windows-874/UTF-8) or press Ctrl + V directly."}
                    </span>
                  </p>
                </div>

                {/* Modal Footer */}
                <div className="pt-3 border-t border-slate-100 dark:border-[#1e3a5f] flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSapModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400"
                  >
                    {isThai ? "ยกเลิก" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePerformSapMapping(false)}
                    disabled={!sapRawText.trim()}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all active:scale-95 ${
                      !sapRawText.trim()
                        ? "opacity-50 bg-slate-300 text-slate-500 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20"
                    }`}
                  >
                    <Save size={16} />
                    <span>{isThai ? "บันทึกและจับคู่ข้อมูล SAP" : "Save & Map SAP Data"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
