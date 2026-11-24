/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";

export const WMS_WEEKLY_SHIFT_COLLECTION = "wms_weekly_shift_schedules";
const STORAGE_KEY_PREFIX = "tmt_wms_weekly_shift_schedule_v1_";

export type PrimaryShift = "day" | "night";
export type DailyShiftValue = "day" | "night" | "off";
export type WeeklyWorkPattern = "mon_sat" | "mon_sun";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEK_DAY_META: {
  key: DayKey;
  shortTh: string;
  fullTh: string;
  offset: number;
}[] = [
  { key: "mon", shortTh: "จ.", fullTh: "จันทร์", offset: 0 },
  { key: "tue", shortTh: "อ.", fullTh: "อังคาร", offset: 1 },
  { key: "wed", shortTh: "พ.", fullTh: "พุธ", offset: 2 },
  { key: "thu", shortTh: "พฤ.", fullTh: "พฤหัสบดี", offset: 3 },
  { key: "fri", shortTh: "ศ.", fullTh: "ศุกร์", offset: 4 },
  { key: "sat", shortTh: "ส.", fullTh: "เสาร์", offset: 5 },
  { key: "sun", shortTh: "อา.", fullTh: "อาทิตย์", offset: 6 },
];

export interface EmployeeWeeklyShiftEntry {
  shift: PrimaryShift;
  days: Record<DayKey, DailyShiftValue>;
}

export interface WeeklyShiftScheduleDoc {
  id: string; // weekStartYmd e.g. "2026-11-23"
  weekStartYmd: string; // Monday YYYY-MM-DD
  weekEndYmd: string; // Sunday YYYY-MM-DD
  workPattern: WeeklyWorkPattern;
  entries: Record<string, EmployeeWeeklyShiftEntry>; // keyed by employeeId
  updatedAt: string;
  updatedBy?: string;
}

const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

export function formatLocalYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function parseLocalYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Returns the Monday YYYY-MM-DD of the week containing `dateOrYmd`.
 */
export function getWeekStartYmd(dateOrYmd: Date | string = new Date()): string {
  const d = typeof dateOrYmd === "string" ? parseLocalYmd(dateOrYmd) : new Date(dateOrYmd);
  d.setHours(12, 0, 0, 0);
  const dayOfWeek = d.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diffToMonday);
  return formatLocalYmd(d);
}

export function addDaysToYmd(ymd: string, deltaDays: number): string {
  const d = parseLocalYmd(ymd);
  d.setDate(d.getDate() + deltaDays);
  return formatLocalYmd(d);
}

export function getWeekDates(weekStartYmd: string): {
  key: DayKey;
  shortTh: string;
  fullTh: string;
  ymd: string;
  dayNum: number;
  monthShortTh: string;
}[] {
  return WEEK_DAY_META.map((meta) => {
    const ymd = addDaysToYmd(weekStartYmd, meta.offset);
    const d = parseLocalYmd(ymd);
    return {
      key: meta.key,
      shortTh: meta.shortTh,
      fullTh: meta.fullTh,
      ymd,
      dayNum: d.getDate(),
      monthShortTh: THAI_MONTHS_SHORT[d.getMonth()] || "",
    };
  });
}

export function getIsoWeekNumber(ymd: string): number {
  const d = parseLocalYmd(ymd);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatThaiWeekRangeLabel(weekStartYmd: string): {
  weekNumber: number;
  rangeText: string;
  buddhistYear: number;
} {
  const start = parseLocalYmd(weekStartYmd);
  const end = parseLocalYmd(addDaysToYmd(weekStartYmd, 6));
  const startMonth = THAI_MONTHS_SHORT[start.getMonth()] || "";
  const endMonth = THAI_MONTHS_SHORT[end.getMonth()] || "";
  const buddhistYear = end.getFullYear() + 543;
  const weekNumber = getIsoWeekNumber(weekStartYmd);

  const rangeText =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
      ? `จ. ${start.getDate()} – อา. ${end.getDate()} ${endMonth} ${buddhistYear}`
      : `จ. ${start.getDate()} ${startMonth} – อา. ${end.getDate()} ${endMonth} ${buddhistYear}`;

  return { weekNumber, rangeText, buddhistYear };
}

export function buildWeekDaysForShift(
  shift: PrimaryShift,
  pattern: WeeklyWorkPattern
): Record<DayKey, DailyShiftValue> {
  return {
    mon: shift,
    tue: shift,
    wed: shift,
    thu: shift,
    fri: shift,
    sat: shift,
    sun: pattern === "mon_sat" ? "off" : shift,
  };
}

export function derivePrimaryShiftFromDays(
  days: Record<DayKey, DailyShiftValue>,
  fallback: PrimaryShift = "day"
): PrimaryShift {
  let dayCount = 0;
  let nightCount = 0;
  WEEK_DAY_META.forEach(({ key }) => {
    if (days[key] === "day") dayCount += 1;
    else if (days[key] === "night") nightCount += 1;
  });
  if (dayCount === 0 && nightCount === 0) return fallback;
  return nightCount > dayCount ? "night" : "day";
}

function sanitizeDailyShift(val: unknown, fallback: DailyShiftValue): DailyShiftValue {
  if (val === "day" || val === "night" || val === "off") return val;
  return fallback;
}

export function normalizeWeeklyShiftScheduleDoc(
  weekStartYmd: string,
  raw: Partial<WeeklyShiftScheduleDoc> | null | undefined
): WeeklyShiftScheduleDoc {
  const safeStart = getWeekStartYmd(weekStartYmd);
  const safeEnd = addDaysToYmd(safeStart, 6);
  const workPattern: WeeklyWorkPattern =
    raw?.workPattern === "mon_sun" ? "mon_sun" : "mon_sat";

  const sanitizedEntries: Record<string, EmployeeWeeklyShiftEntry> = {};
  if (raw?.entries && typeof raw.entries === "object") {
    const keys = Object.keys(raw.entries).slice(0, 1000);
    for (const empId of keys) {
      const item = raw.entries[empId];
      if (!item || typeof item !== "object") continue;
      const safePrimary: PrimaryShift = item.shift === "night" ? "night" : "day";
      const defaultDays = buildWeekDaysForShift(safePrimary, workPattern);
      const rawDays = (item.days || {}) as Partial<Record<DayKey, DailyShiftValue>>;
      const days: Record<DayKey, DailyShiftValue> = {
        mon: sanitizeDailyShift(rawDays.mon, defaultDays.mon),
        tue: sanitizeDailyShift(rawDays.tue, defaultDays.tue),
        wed: sanitizeDailyShift(rawDays.wed, defaultDays.wed),
        thu: sanitizeDailyShift(rawDays.thu, defaultDays.thu),
        fri: sanitizeDailyShift(rawDays.fri, defaultDays.fri),
        sat: sanitizeDailyShift(rawDays.sat, defaultDays.sat),
        sun: sanitizeDailyShift(rawDays.sun, defaultDays.sun),
      };
      sanitizedEntries[String(empId).trim().slice(0, 64)] = {
        shift: safePrimary,
        days,
      };
    }
  }

  const docObj: WeeklyShiftScheduleDoc = {
    id: safeStart,
    weekStartYmd: safeStart,
    weekEndYmd: safeEnd,
    workPattern,
    entries: sanitizedEntries,
    updatedAt: String(raw?.updatedAt || new Date().toISOString()).slice(0, 64),
  };

  if (raw?.updatedBy && String(raw.updatedBy).trim()) {
    docObj.updatedBy = String(raw.updatedBy).trim().slice(0, 128);
  }

  return docObj;
}

export function loadCachedWeeklyShiftSchedule(
  weekStartYmd: string
): WeeklyShiftScheduleDoc | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${weekStartYmd}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeeklyShiftScheduleDoc>;
    return normalizeWeeklyShiftScheduleDoc(weekStartYmd, parsed);
  } catch {
    return null;
  }
}

function saveCachedWeeklyShiftSchedule(schedule: WeeklyShiftScheduleDoc): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${schedule.weekStartYmd}`,
      JSON.stringify(schedule)
    );
  } catch {
    // ignore storage errors
  }
}

export function subscribeWeeklyShiftSchedule(
  weekStartYmd: string,
  onUpdate: (schedule: WeeklyShiftScheduleDoc | null) => void,
  onError?: (error: unknown) => void
): () => void {
  const safeWeekId = getWeekStartYmd(weekStartYmd);
  const docRef = doc(db, WMS_WEEKLY_SHIFT_COLLECTION, safeWeekId);

  return onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null);
        return;
      }
      const normalized = normalizeWeeklyShiftScheduleDoc(
        safeWeekId,
        snapshot.data() as Partial<WeeklyShiftScheduleDoc>
      );
      saveCachedWeeklyShiftSchedule(normalized);
      onUpdate(normalized);
    },
    (error) => {
      handleFirestoreError(
        error,
        OperationType.GET,
        `${WMS_WEEKLY_SHIFT_COLLECTION}/${safeWeekId}`
      );
      onError?.(error);
    }
  );
}

export async function fetchWeeklyShiftSchedule(
  weekStartYmd: string
): Promise<WeeklyShiftScheduleDoc | null> {
  const safeWeekId = getWeekStartYmd(weekStartYmd);
  const docRef = doc(db, WMS_WEEKLY_SHIFT_COLLECTION, safeWeekId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return loadCachedWeeklyShiftSchedule(safeWeekId);
    }
    const normalized = normalizeWeeklyShiftScheduleDoc(
      safeWeekId,
      snap.data() as Partial<WeeklyShiftScheduleDoc>
    );
    saveCachedWeeklyShiftSchedule(normalized);
    return normalized;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.GET,
      `${WMS_WEEKLY_SHIFT_COLLECTION}/${safeWeekId}`
    );
    return loadCachedWeeklyShiftSchedule(safeWeekId);
  }
}

export async function saveWeeklyShiftSchedule(
  schedule: WeeklyShiftScheduleDoc
): Promise<WeeklyShiftScheduleDoc> {
  const normalized = normalizeWeeklyShiftScheduleDoc(schedule.weekStartYmd, {
    ...schedule,
    updatedAt: new Date().toISOString(),
  });
  saveCachedWeeklyShiftSchedule(normalized);

  try {
    await setDoc(doc(db, WMS_WEEKLY_SHIFT_COLLECTION, normalized.id), normalized);
    return normalized;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${WMS_WEEKLY_SHIFT_COLLECTION}/${normalized.id}`
    );
    throw error;
  }
}
