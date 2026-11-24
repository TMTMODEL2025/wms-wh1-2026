/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Check,
  FileSpreadsheet,
  Sun,
  Moon,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from "lucide-react";
import {
  subscribeToWmsEmployees,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";
import {
  SlitWorkforceAssignment,
  SlitWorkforceMachineGroup,
  SlitWorkforceShift,
  SlitWorkforceStatus,
  getAssignmentMachineGroups,
  inferMachineGroupFromCode,
  loadCachedSlitWorkforceAssignments,
  subscribeSlitWorkforceAssignments,
  saveSlitWorkforceAssignment,
  deleteSlitWorkforceAssignment,
} from "../services/slitWorkforceService";
import {
  addDaysToYmd,
  DayKey,
  DailyShiftValue,
  getWeekStartYmd,
  loadCachedWeeklyShiftSchedule,
  parseLocalYmd,
  subscribeWeeklyShiftSchedule,
  WeeklyShiftScheduleDoc,
} from "../services/weeklyShiftScheduleService";
import type { Employee } from "../types/officer";

interface SlitWorkforceManagementViewProps {
  isThai?: boolean;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
}

const MACHINE_GROUP_OPTIONS: {
  key: SlitWorkforceMachineGroup;
  labelTh: string;
  labelEn: string;
  machines: string[];
}[] = [
  {
    key: "TM",
    labelTh: "เครื่องผลิตท่อ (TM)",
    labelEn: "Pipe Mill (TM)",
    machines: [
      "TM01",
      "TM02",
      "TM03",
      "TM04",
      "TM05",
      "TM06",
      "TM07",
      "TM08",
      "TM09",
      "TM10",
      "TM11",
      "TM12",
      "TM13",
      "TM14",
    ],
  },
  {
    key: "CF",
    labelTh: "เครื่องตัวซี (CF)",
    labelEn: "C-Channel (CF)",
    machines: ["CF01", "CF02", "CF03", "CF04", "CF05"],
  },
  {
    key: "ML",
    labelTh: "เครื่องมินิ (ML)",
    labelEn: "Mini Line (ML)",
    machines: ["ML01", "ML02"],
  },
  {
    key: "ZF",
    labelTh: "ตัวซีมีขอบ (ZF)",
    labelEn: "Lip Channel (ZF)",
    machines: ["ZF01", "ZF02"],
  },
];

const ALL_SLIT_MACHINE_GROUPS: SlitWorkforceMachineGroup[] = ["TM", "CF", "ML", "ZF"];

const ALL_SLIT_MACHINE_CODES: string[] = MACHINE_GROUP_OPTIONS.flatMap((g) => g.machines);

const GROUP_TO_MACHINES_MAP: Record<SlitWorkforceMachineGroup, string[]> = {
  TM: MACHINE_GROUP_OPTIONS[0].machines,
  CF: MACHINE_GROUP_OPTIONS[1].machines,
  ML: MACHINE_GROUP_OPTIONS[2].machines,
  ZF: MACHINE_GROUP_OPTIONS[3].machines,
};

function sortMachineGroupsCanonical(
  groups: Iterable<SlitWorkforceMachineGroup>
): SlitWorkforceMachineGroup[] {
  const set = new Set<SlitWorkforceMachineGroup>(groups);
  return ALL_SLIT_MACHINE_GROUPS.filter((g) => set.has(g));
}

function sortMachineCodesCanonical(codes: Iterable<string>): string[] {
  const unique = Array.from(
    new Set(
      Array.from(codes)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    )
  );
  const orderMap = new Map(ALL_SLIT_MACHINE_CODES.map((code, idx) => [code, idx]));
  return unique.sort((a, b) => {
    const idxA = orderMap.get(a);
    const idxB = orderMap.get(b);
    if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
    if (idxA !== undefined) return -1;
    if (idxB !== undefined) return 1;
    return a.localeCompare(b);
  });
}

function getCoveredMachineCodesForAssignment(
  asn: SlitWorkforceAssignment | undefined
): string[] {
  if (!asn) return [];
  const groups = getAssignmentMachineGroups(asn);
  const specific = sortMachineCodesCanonical(asn.machines || []);
  const covered = new Set<string>(specific);

  groups.forEach((grp) => {
    const hasSpecificInGroup = specific.some(
      (code) => inferMachineGroupFromCode(code) === grp
    );
    if (!hasSpecificInGroup) {
      GROUP_TO_MACHINES_MAP[grp].forEach((code) => covered.add(code));
    }
  });

  return sortMachineCodesCanonical(covered);
}

function doesAssignmentMatchMachineCode(
  asn: SlitWorkforceAssignment | undefined,
  machineCode: string
): boolean {
  if (!asn) return false;
  const target = machineCode.trim().toUpperCase();
  if (!target) return true;
  return getCoveredMachineCodesForAssignment(asn).includes(target);
}

function describeAssignmentMachines(
  asn: SlitWorkforceAssignment | undefined,
  isThai: boolean
): {
  groups: SlitWorkforceMachineGroup[];
  specificCodes: string[];
  isAllMachines: boolean;
  detailText: string;
  compactText: string;
} {
  if (!asn) {
    return {
      groups: [],
      specificCodes: [],
      isAllMachines: false,
      detailText: "",
      compactText: "",
    };
  }
  const groups = getAssignmentMachineGroups(asn);
  const specificCodes = sortMachineCodesCanonical(asn.machines || []);
  const isAllExplicit = ALL_SLIT_MACHINE_CODES.every((c) => specificCodes.includes(c));
  const isAllViaGroups =
    groups.length === ALL_SLIT_MACHINE_GROUPS.length && specificCodes.length === 0;
  const isAllMachines = isAllExplicit || isAllViaGroups;

  if (isAllMachines) {
    const allLabel = isThai
      ? `ทุกเครื่อง (${ALL_SLIT_MACHINE_CODES.length} เครื่อง)`
      : `All Machines (${ALL_SLIT_MACHINE_CODES.length})`;
    return {
      groups,
      specificCodes,
      isAllMachines: true,
      detailText: allLabel,
      compactText: allLabel,
    };
  }

  const segments: string[] = [];
  const fullGroupSegments: string[] = [];

  groups.forEach((grp) => {
    const groupSpecific = specificCodes.filter(
      (code) => inferMachineGroupFromCode(code) === grp
    );
    if (groupSpecific.length > 0) {
      if (groupSpecific.length === GROUP_TO_MACHINES_MAP[grp].length) {
        segments.push(
          isThai ? `${grp} (ครบ ${groupSpecific.length} เครื่อง)` : `${grp} (All ${groupSpecific.length})`
        );
      } else {
        segments.push(groupSpecific.join(", "));
      }
    } else {
      fullGroupSegments.push(grp);
      segments.push(isThai ? `${grp} (ทั้งกลุ่ม)` : `${grp} (Full Group)`);
    }
  });

  // Include any specific machine codes whose prefix didn't match standard groups
  const extraCodes = specificCodes.filter((code) => !inferMachineGroupFromCode(code));
  if (extraCodes.length > 0) {
    segments.push(extraCodes.join(", "));
  }

  const detailText =
    specificCodes.length > 0
      ? fullGroupSegments.length > 0
        ? [
            ...specificCodes,
            ...fullGroupSegments.map((g) => (isThai ? `${g} (ทั้งกลุ่ม)` : `${g} (All)`)),
          ].join(", ")
        : specificCodes.join(", ")
      : groups.length > 0
      ? isThai
        ? `ทั้งกลุ่ม ${groups.join(", ")}`
        : `Full group: ${groups.join(", ")}`
      : "";

  const compactText = segments.join(" · ");

  return {
    groups,
    specificCodes,
    isAllMachines: false,
    detailText,
    compactText,
  };
}

const MACHINE_TO_FAC_AREA: Record<string, string> = {
  TM01: "FAC G",
  TM02: "FAC G",
  TM03: "FAC G",
  TM04: "FAC G",
  TM05: "FAC P",
  TM06: "FAC G",
  TM07: "FAC D",
  TM08: "FAC D",
  TM09: "FAC D",
  TM10: "FAC D",
  TM11: "FAC F",
  TM12: "FAC F",
  TM14: "FAC A",
  CF01: "FAC G",
  CF02: "FAC G",
  CF03: "FAC G",
  CF04: "FAC G",
  CF05: "FAC G",
  ML01: "FAC 21",
  ML02: "FAC 21",
  ZF01: "FAC 21",
  ZF02: "FAC 21",
};

const AREA_BUILDING_OPTIONS = [
  "อาคาร H",
  "อาคาร F",
  "อาคาร E9",
  "อาคาร E10",
  "อาคาร I",
  "FAC A",
  "FAC D",
  "FAC F",
  "FAC G",
  "FAC P",
  "FAC 21",
  "โซนรับเข้า (SM01-SM04)",
  "โซนเตรียมเบิก / หน้าเครื่อง",
];

const DUTY_PRESET_OPTIONS_TH = [
  "รับเข้าเหล็กสลิต (Inbound)",
  "เตรียมเบิกวัตถุดิบ (Pick List / Outbound)",
  "จ่ายงานหน้าเครื่อง (Operator Receive)",
  "ย้าย Layout / จัดเก็บตะกร้า",
  "คืนคลัง / ตรวจสอบสต็อกคงคลัง",
  "ควบคุมเครน / Transfer Car",
  "ตรวจสอบอุปกรณ์และพื้นที่จัดเก็บ",
  "หัวหน้ากะ / ควบคุมการปฏิบัติงาน",
];

const DUTY_PRESET_OPTIONS_EN = [
  "Slit Steel Inbound Receiving",
  "Material Pick List & Outbound Staging",
  "Machine Operator Receiving",
  "Layout Relocation & Basket Storage",
  "Return to Warehouse & Stock Check",
  "Crane / Transfer Car Operation",
  "Equipment & Storage Inspection",
  "Shift Supervisor / Coordination",
];

const DAY_INDEX_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const THAI_DAY_NAMES = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

function getLocalTodayYMD(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function getDefaultShift(): SlitWorkforceShift {
  const h = new Date().getHours();
  return h >= 8 && h < 20 ? "day" : "night";
}

function getDayKeyForYmd(ymd: string): DayKey {
  const d = parseLocalYmd(ymd);
  return DAY_INDEX_TO_KEY[d.getDay()] || "mon";
}

function formatThaiDateLabel(ymd: string): string {
  const d = parseLocalYmd(ymd);
  const dayName = THAI_DAY_NAMES[d.getDay()] || "";
  return `วัน${dayName} ${ymd}`;
}

function getEmployeeInitials(name: string): string {
  const cleaned = (name || "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Matches employees belonging to the Film / Slit section from the central employee directory.
 */
function isFilmOrSlitEmployee(emp: Employee): boolean {
  const dept = (emp.department || "").toLowerCase();
  const pos = (emp.jobPosition || "").toLowerCase();

  if (
    dept.includes("ฟิล์ม") ||
    dept.includes("film") ||
    dept.includes("สลิต") ||
    dept.includes("slit")
  ) {
    return true;
  }
  if (
    pos.includes("ฟิล์ม") ||
    pos.includes("film") ||
    pos.includes("สลิต") ||
    pos.includes("slit")
  ) {
    return true;
  }
  // Also include employees explicitly scoped to slit_ops (excluding all-access cross-plant admins)
  if (
    Array.isArray(emp.allowedSections) &&
    emp.allowedSections.includes("slit_ops") &&
    emp.allowedSections.length <= 3 &&
    !dept.includes("coil") &&
    !dept.includes("เหล็กม้วน") &&
    !dept.includes("rm") &&
    !dept.includes("เหล็กแผ่น") &&
    !dept.includes("fleet") &&
    !dept.includes("material handling")
  ) {
    return true;
  }
  return false;
}

function buildDeterministicAssignmentId(workingDate: string, employeeId: string): string {
  const safeEmp = String(employeeId || "")
    .trim()
    .toUpperCase()
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 64);
  const safeDate = String(workingDate || getLocalTodayYMD()).replace(/[^0-9\-]/g, "");
  return `SLIT_WF_${safeDate}_${safeEmp}`.slice(0, 128);
}

type ResolvedShiftState = {
  shift: SlitWorkforceShift | "off" | "unassigned";
  source: "weekly_schedule" | "employee_profile" | "assignment" | "none";
};

interface UnifiedWorkforceRow {
  rowKey: string;
  employee?: Employee;
  employeeId: string;
  employeeName: string;
  department: string;
  photoUrl?: string;
  scheduledShift: ResolvedShiftState;
  assignment?: SlitWorkforceAssignment;
  effectiveShift: SlitWorkforceShift | "off" | "unassigned";
  isExtraAssignmentOnly: boolean;
}

export function SlitWorkforceManagementView({
  isThai = true,
  onLogTransaction,
}: SlitWorkforceManagementViewProps) {
  const todayYmd = useMemo(() => getLocalTodayYMD(), []);

  const [selectedDate, setSelectedDate] = useState<string>(todayYmd);
  const [assignments, setAssignments] = useState<SlitWorkforceAssignment[]>(() =>
    loadCachedSlitWorkforceAssignments()
  );
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyShiftScheduleDoc | null>(() =>
    loadCachedWeeklyShiftSchedule(getWeekStartYmd(todayYmd))
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savingRowKeys, setSavingRowKeys] = useState<Record<string, boolean>>({});
  const [brokenPhotoIds, setBrokenPhotoIds] = useState<Record<string, boolean>>({});
  const [inlineFeedback, setInlineFeedback] = useState<string>("");

  // Filter states
  const [departmentScope, setDepartmentScope] = useState<string>("film_slit");
  const [filterShift, setFilterShift] = useState<"all" | SlitWorkforceShift>("all");
  const [filterMachineGroup, setFilterMachineGroup] = useState<
    "all" | SlitWorkforceMachineGroup
  >("all");
  const [filterMachineCode, setFilterMachineCode] = useState<string>("all");
  const [filterArea, setFilterArea] = useState<string>("all");
  const [searchKeyword, setSearchKeyword] = useState<string>("");

  // Modal / Form states
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formWorkingDate, setFormWorkingDate] = useState<string>(todayYmd);
  const [formEmployeeMode, setFormEmployeeMode] = useState<"directory" | "custom">("directory");
  const [formSelectedEmpId, setFormSelectedEmpId] = useState<string>("");
  const [formCustomEmpName, setFormCustomEmpName] = useState<string>("");
  const [formCustomEmpId, setFormCustomEmpId] = useState<string>("");
  const [formDepartment, setFormDepartment] = useState<string>("");
  const [formShift, setFormShift] = useState<SlitWorkforceShift>(getDefaultShift());
  const [formAreaMode, setFormAreaMode] = useState<"preset" | "custom">("preset");
  const [formArea, setFormArea] = useState<string>(AREA_BUILDING_OPTIONS[0]);
  const [formCustomArea, setFormCustomArea] = useState<string>("");
  const [formMachineGroups, setFormMachineGroups] = useState<SlitWorkforceMachineGroup[]>(["TM"]);
  const [formSelectedMachines, setFormSelectedMachines] = useState<string[]>([]);
  const [formDutyMode, setFormDutyMode] = useState<"preset" | "custom">("preset");
  const [formDuty, setFormDuty] = useState<string>(DUTY_PRESET_OPTIONS_TH[0]);
  const [formCustomDuty, setFormCustomDuty] = useState<string>("");
  const [formStatus, setFormStatus] = useState<SlitWorkforceStatus>("active");
  const [formNotes, setFormNotes] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const selectedWeekStart = useMemo(() => getWeekStartYmd(selectedDate), [selectedDate]);
  const selectedDayKey = useMemo(() => getDayKeyForYmd(selectedDate), [selectedDate]);

  useEffect(() => {
    const unsubWorkforce = subscribeSlitWorkforceAssignments(
      (items) => {
        setAssignments(items);
        setIsLoading(false);
      },
      () => {
        setIsLoading(false);
      }
    );
    const unsubEmployees = subscribeToWmsEmployees((empList) => {
      setEmployees(empList);
    });
    return () => {
      unsubWorkforce();
      unsubEmployees();
    };
  }, []);

  // Subscribe to Weekly Shift Schedule for the selected date's week
  useEffect(() => {
    const cached = loadCachedWeeklyShiftSchedule(selectedWeekStart);
    setWeeklySchedule(cached);
    const unsubWeek = subscribeWeeklyShiftSchedule(selectedWeekStart, (cloudWeek) => {
      setWeeklySchedule(cloudWeek);
    });
    return () => unsubWeek();
  }, [selectedWeekStart]);

  useEffect(() => {
    if (!inlineFeedback) return;
    const timer = window.setTimeout(() => setInlineFeedback(""), 2600);
    return () => window.clearTimeout(timer);
  }, [inlineFeedback]);

  const activeEmployees = useMemo(() => {
    return employees
      .filter((e) => e.employmentStatus !== "Inactive")
      .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || "", "th"));
  }, [employees]);

  const filmSectionEmployees = useMemo(() => {
    return activeEmployees.filter(isFilmOrSlitEmployee);
  }, [activeEmployees]);

  const allEmployeeDepartments = useMemo(() => {
    const set = new Set<string>();
    activeEmployees.forEach((e) => {
      if (e.department?.trim()) set.add(e.department.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
  }, [activeEmployees]);

  const employeeLookupById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((e) => {
      map.set(e.employeeId.trim().toUpperCase(), e);
    });
    return map;
  }, [employees]);

  const resolveScheduledShiftForEmployee = useCallback(
    (emp: Employee | undefined): ResolvedShiftState => {
      if (!emp) return { shift: "unassigned", source: "none" };
      const empKey = emp.employeeId.trim();
      const weekEntry =
        weeklySchedule?.entries?.[empKey] ||
        weeklySchedule?.entries?.[empKey.toUpperCase()];

      if (weekEntry) {
        const dayVal: DailyShiftValue | undefined = weekEntry.days?.[selectedDayKey];
        if (dayVal === "day" || dayVal === "night") {
          return { shift: dayVal, source: "weekly_schedule" };
        }
        if (dayVal === "off") {
          return { shift: "off", source: "weekly_schedule" };
        }
        if (weekEntry.shift === "day" || weekEntry.shift === "night") {
          return { shift: weekEntry.shift, source: "weekly_schedule" };
        }
      }

      if (emp.workShift === "day" || emp.workShift === "night") {
        return { shift: emp.workShift, source: "employee_profile" };
      }

      return { shift: "unassigned", source: "none" };
    },
    [weeklySchedule, selectedDayKey]
  );

  // Scoped employees displayed directly in the table based on departmentScope
  const scopedRosterEmployees = useMemo(() => {
    if (departmentScope === "film_slit") return filmSectionEmployees;
    if (departmentScope === "all") return activeEmployees;
    return activeEmployees.filter(
      (e) => (e.department || "").trim() === departmentScope
    );
  }, [departmentScope, filmSectionEmployees, activeEmployees]);

  // Assignments strictly for selectedDate
  const assignmentsForDate = useMemo(() => {
    return assignments.filter((a) => a.workingDate === selectedDate);
  }, [assignments, selectedDate]);

  // Build unified rows: every Film/Slit employee appears directly, merged with their shift schedule + saved assignment for selectedDate
  const unifiedRows = useMemo<UnifiedWorkforceRow[]>(() => {
    const matchedAssignmentIds = new Set<string>();
    const rows: UnifiedWorkforceRow[] = [];

    scopedRosterEmployees.forEach((emp) => {
      const empIdUpper = emp.employeeId.trim().toUpperCase();
      const matched = assignmentsForDate.find(
        (a) =>
          (a.employeeId && a.employeeId.trim().toUpperCase() === empIdUpper) ||
          a.employeeName.trim() === emp.employeeName.trim()
      );
      if (matched) matchedAssignmentIds.add(matched.id);

      const scheduled = resolveScheduledShiftForEmployee(emp);
      const effectiveShift: SlitWorkforceShift | "off" | "unassigned" =
        scheduled.source === "weekly_schedule"
          ? scheduled.shift
          : matched?.shift
          ? matched.shift
          : scheduled.shift;

      rows.push({
        rowKey: `EMP_${empIdUpper}`,
        employee: emp,
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        department: emp.department?.trim() || "ส่วนงานฟิล์ม",
        photoUrl: emp.photoUrl,
        scheduledShift: scheduled,
        assignment: matched,
        effectiveShift,
        isExtraAssignmentOnly: false,
      });
    });

    // Include any manual/extra assignments saved for selectedDate whose employee is outside the roster filter
    assignmentsForDate.forEach((a) => {
      if (matchedAssignmentIds.has(a.id)) return;
      const empMatch = a.employeeId
        ? employeeLookupById.get(a.employeeId.trim().toUpperCase())
        : undefined;
      rows.push({
        rowKey: `ASN_${a.id}`,
        employee: empMatch,
        employeeId: a.employeeId || "",
        employeeName: a.employeeName,
        department: a.department || empMatch?.department?.trim() || "มอบหมายเพิ่มเติม",
        photoUrl: empMatch?.photoUrl,
        scheduledShift: { shift: a.shift, source: "assignment" },
        assignment: a,
        effectiveShift: a.shift,
        isExtraAssignmentOnly: true,
      });
    });

    // Sort: Day shift first, then Night shift, then Unassigned, then Off; within each by name
    const shiftRank = (s: SlitWorkforceShift | "off" | "unassigned") =>
      s === "day" ? 0 : s === "night" ? 1 : s === "unassigned" ? 2 : 3;

    return rows.sort((a, b) => {
      const rankDiff = shiftRank(a.effectiveShift) - shiftRank(b.effectiveShift);
      if (rankDiff !== 0) return rankDiff;
      return a.employeeName.localeCompare(b.employeeName, "th");
    });
  }, [
    scopedRosterEmployees,
    assignmentsForDate,
    resolveScheduledShiftForEmployee,
    employeeLookupById,
  ]);

  const dutyOptions = isThai ? DUTY_PRESET_OPTIONS_TH : DUTY_PRESET_OPTIONS_EN;

  const availableFilterAreas = useMemo(() => {
    const set = new Set<string>(AREA_BUILDING_OPTIONS);
    assignmentsForDate.forEach((a) => {
      if (a.area && a.area !== "-") set.add(a.area);
    });
    return Array.from(set);
  }, [assignmentsForDate]);

  const filteredRows = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    return unifiedRows.filter((row) => {
      if (filterShift !== "all" && row.effectiveShift !== filterShift) return false;

      if (filterMachineGroup !== "all") {
        if (!row.assignment) return false;
        const rowGroups = getAssignmentMachineGroups(row.assignment);
        if (!rowGroups.includes(filterMachineGroup)) return false;
      }

      if (filterMachineCode !== "all") {
        if (!doesAssignmentMatchMachineCode(row.assignment, filterMachineCode)) {
          return false;
        }
      }

      if (filterArea !== "all" && row.assignment?.area !== filterArea) return false;

      if (kw) {
        const rowGroups = row.assignment ? getAssignmentMachineGroups(row.assignment) : [];
        const coveredCodes = getCoveredMachineCodesForAssignment(row.assignment);
        const haystack = [
          row.employeeName,
          row.employeeId,
          row.department,
          row.assignment?.area || "",
          ...rowGroups,
          ...(row.assignment?.machines || []),
          ...coveredCodes,
          row.assignment?.duty || "",
          row.assignment?.notes || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [
    unifiedRows,
    filterShift,
    filterMachineGroup,
    filterMachineCode,
    filterArea,
    searchKeyword,
  ]);

  const summaryStats = useMemo(() => {
    const dayCount = filteredRows.filter((r) => r.effectiveShift === "day").length;
    const nightCount = filteredRows.filter((r) => r.effectiveShift === "night").length;
    const assignedCount = filteredRows.filter((r) => Boolean(r.assignment)).length;
    const groupCounts: Record<SlitWorkforceMachineGroup, number> = {
      TM: 0,
      CF: 0,
      ML: 0,
      ZF: 0,
    };
    filteredRows.forEach((r) => {
      if (!r.assignment) return;
      const groups = getAssignmentMachineGroups(r.assignment);
      groups.forEach((grp) => {
        if (groupCounts[grp] !== undefined) {
          groupCounts[grp] += 1;
        }
      });
    });
    return {
      totalStaff: filteredRows.length,
      assignedCount,
      dayCount,
      nightCount,
      groupCounts,
    };
  }, [filteredRows]);

  // Direct inline save helper for Area / MachineGroups / Duty / Shift on any row
  const handleInlinePatchRow = async (
    row: UnifiedWorkforceRow,
    patch: Partial<{
      shift: SlitWorkforceShift;
      area: string;
      machineGroup: SlitWorkforceMachineGroup;
      machineGroups: SlitWorkforceMachineGroup[];
      machines: string[];
      duty: string;
      status: SlitWorkforceStatus;
    }>,
    feedbackText: string
  ) => {
    const existing = row.assignment;
    const recorder = getActiveRecorderDisplay();
    const nowIso = new Date().toISOString();

    const fallbackShift: SlitWorkforceShift =
      row.effectiveShift === "night"
        ? "night"
        : row.effectiveShift === "day"
        ? "day"
        : getDefaultShift();

    const docId =
      existing?.id ||
      (row.employeeId
        ? buildDeterministicAssignmentId(selectedDate, row.employeeId)
        : `SLIT_WF_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`);

    const existingGroups = existing ? getAssignmentMachineGroups(existing) : (["TM"] as SlitWorkforceMachineGroup[]);
    const resolvedGroups = sortMachineGroupsCanonical(
      patch.machineGroups && patch.machineGroups.length > 0
        ? patch.machineGroups
        : patch.machineGroup
        ? [patch.machineGroup]
        : existingGroups
    );
    const primaryGroup = resolvedGroups[0] || "TM";

    const resolvedMachines = sortMachineCodesCanonical(
      patch.machines !== undefined ? patch.machines : existing?.machines || []
    );

    const payload: SlitWorkforceAssignment = {
      id: docId,
      workingDate: selectedDate,
      employeeId: row.employeeId || undefined,
      employeeName: row.employeeName,
      department: row.department || undefined,
      shift: patch.shift ?? existing?.shift ?? fallbackShift,
      area: patch.area !== undefined ? patch.area || "-" : existing?.area || "-",
      machineGroup: primaryGroup,
      machineGroups: resolvedGroups,
      machines: resolvedMachines,
      duty: patch.duty !== undefined ? patch.duty || "-" : existing?.duty || "-",
      status: patch.status ?? existing?.status ?? "active",
      notes: existing?.notes,
      assignedBy: existing?.assignedBy || recorder.label,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
    try {
      await saveSlitWorkforceAssignment(payload);
      setInlineFeedback(feedbackText);
      onLogTransaction?.(
        `มอบหมายกำลังพลสลิต/ฟิล์ม: ${payload.employeeName} · ${payload.area} · ${resolvedGroups.join(", ")} (${payload.duty})`,
        payload.workingDate,
        "Completed"
      );
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: "error",
        title: isThai ? "บันทึกไม่สำเร็จ" : "Save Failed",
        text: isThai ? "กรุณาลองใหม่อีกครั้ง" : "Please try again.",
      });
    } finally {
      setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: false }));
    }
  };

  // Multi-select inline toggle for TM / CF / ML / ZF in the table row
  const handleInlineToggleMachineGroup = async (
    row: UnifiedWorkforceRow,
    grp: SlitWorkforceMachineGroup
  ) => {
    const existing = row.assignment;
    if (!existing) {
      await handleInlinePatchRow(
        row,
        { machineGroup: grp, machineGroups: [grp], machines: [] },
        `บันทึกเครื่องจักร ${row.employeeName} → ${grp}`
      );
      return;
    }

    const currentGroups = getAssignmentMachineGroups(existing);
    const isCurrentlySelected = currentGroups.includes(grp);

    if (isCurrentlySelected) {
      if (currentGroups.length <= 1) {
        setInlineFeedback(
          isThai
            ? `ต้องเลือกอย่างน้อย 1 กลุ่มเครื่องจักร (กดปุ่มดินสอเพื่อระบุรหัสเครื่องย่อย)`
            : `At least 1 machine group is required`
        );
        return;
      }
      const nextGroups = currentGroups.filter((g) => g !== grp);
      const nextMachines = (existing.machines || []).filter(
        (code) => inferMachineGroupFromCode(code) !== grp
      );
      await handleInlinePatchRow(
        row,
        {
          machineGroup: nextGroups[0],
          machineGroups: nextGroups,
          machines: nextMachines,
        },
        `อัปเดตเครื่องจักร ${row.employeeName} → ${nextGroups.join(", ")}`
      );
    } else {
      const nextGroups = sortMachineGroupsCanonical([...currentGroups, grp]);
      await handleInlinePatchRow(
        row,
        {
          machineGroup: nextGroups[0],
          machineGroups: nextGroups,
          machines: existing.machines || [],
        },
        `เพิ่มกลุ่มเครื่องจักร ${row.employeeName} → ${nextGroups.join(", ")}`
      );
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormError(null);
    setFormWorkingDate(selectedDate);
    const defaultList =
      filmSectionEmployees.length > 0 ? filmSectionEmployees : activeEmployees;
    if (defaultList.length > 0) {
      const firstEmp = defaultList[0];
      const resolved = resolveScheduledShiftForEmployee(firstEmp);
      setFormEmployeeMode("directory");
      setFormSelectedEmpId(firstEmp.employeeId);
      setFormDepartment(firstEmp.department || "");
      setFormShift(
        resolved.shift === "day" || resolved.shift === "night"
          ? resolved.shift
          : filterShift !== "all"
          ? filterShift
          : getDefaultShift()
      );
      setFormCustomEmpName("");
      setFormCustomEmpId("");
    } else {
      setFormEmployeeMode("custom");
      setFormSelectedEmpId("");
      setFormDepartment("ส่วนงานฟิล์ม");
      setFormShift(filterShift !== "all" ? filterShift : getDefaultShift());
      setFormCustomEmpName("");
      setFormCustomEmpId("");
    }
    setFormAreaMode("preset");
    setFormArea(
      filterArea !== "all" && AREA_BUILDING_OPTIONS.includes(filterArea)
        ? filterArea
        : AREA_BUILDING_OPTIONS[0]
    );
    setFormCustomArea("");
    const initialMachineCode = filterMachineCode !== "all" ? filterMachineCode : null;
    const initialGroupFromCode = initialMachineCode
      ? inferMachineGroupFromCode(initialMachineCode)
      : null;
    setFormMachineGroups(
      initialGroupFromCode
        ? [initialGroupFromCode]
        : filterMachineGroup !== "all"
        ? [filterMachineGroup]
        : ["TM"]
    );
    setFormSelectedMachines(initialMachineCode ? [initialMachineCode] : []);
    setFormDutyMode("preset");
    setFormDuty(dutyOptions[0]);
    setFormCustomDuty("");
    setFormStatus("active");
    setFormNotes("");
    setIsFormOpen(true);
  };

  const openDetailModalForRow = (row: UnifiedWorkforceRow) => {
    const existing = row.assignment;
    setEditingId(existing?.id || null);
    setFormError(null);
    setFormWorkingDate(existing?.workingDate || selectedDate);

    if (row.employee) {
      setFormEmployeeMode("directory");
      setFormSelectedEmpId(row.employee.employeeId);
      setFormDepartment(row.department);
      setFormCustomEmpName("");
      setFormCustomEmpId("");
    } else {
      setFormEmployeeMode("custom");
      setFormSelectedEmpId("");
      setFormDepartment(row.department);
      setFormCustomEmpName(row.employeeName);
      setFormCustomEmpId(row.employeeId);
    }

    const resolvedShift: SlitWorkforceShift =
      row.effectiveShift === "night"
        ? "night"
        : row.effectiveShift === "day"
        ? "day"
        : existing?.shift || getDefaultShift();
    setFormShift(resolvedShift);

    const existingArea = existing?.area && existing.area !== "-" ? existing.area : "";
    if (!existingArea) {
      setFormAreaMode("preset");
      setFormArea(AREA_BUILDING_OPTIONS[0]);
      setFormCustomArea("");
    } else if (AREA_BUILDING_OPTIONS.includes(existingArea)) {
      setFormAreaMode("preset");
      setFormArea(existingArea);
      setFormCustomArea("");
    } else {
      setFormAreaMode("custom");
      setFormArea(AREA_BUILDING_OPTIONS[0]);
      setFormCustomArea(existingArea);
    }

    setFormMachineGroups(
      existing ? getAssignmentMachineGroups(existing) : ["TM"]
    );
    setFormSelectedMachines(
      Array.isArray(existing?.machines) ? sortMachineCodesCanonical(existing.machines) : []
    );

    const existingDuty = existing?.duty && existing.duty !== "-" ? existing.duty : "";
    if (!existingDuty) {
      setFormDutyMode("preset");
      setFormDuty(dutyOptions[0]);
      setFormCustomDuty("");
    } else if (dutyOptions.includes(existingDuty)) {
      setFormDutyMode("preset");
      setFormDuty(existingDuty);
      setFormCustomDuty("");
    } else {
      setFormDutyMode("custom");
      setFormDuty(dutyOptions[0]);
      setFormCustomDuty(existingDuty);
    }

    setFormStatus(existing?.status || "active");
    setFormNotes(existing?.notes || "");
    setIsFormOpen(true);
  };

  const handleModalSelectEmployee = (empId: string) => {
    setFormSelectedEmpId(empId);
    const emp = activeEmployees.find((e) => e.employeeId === empId);
    if (emp) {
      setFormDepartment(emp.department || "");
      const resolved = resolveScheduledShiftForEmployee(emp);
      if (resolved.shift === "day" || resolved.shift === "night") {
        setFormShift(resolved.shift);
      }
    }
  };

  const handleToggleFormMachineGroup = (group: SlitWorkforceMachineGroup) => {
    setFormMachineGroups((prev) => {
      const exists = prev.includes(group);
      if (exists) {
        // Removing group also clears specific sub-machines from that group
        setFormSelectedMachines((curr) =>
          curr.filter((code) => inferMachineGroupFromCode(code) !== group)
        );
        return prev.filter((g) => g !== group);
      }
      return sortMachineGroupsCanonical([...prev, group]);
    });
  };

  const handleToggleAllMachinesInGroup = (group: SlitWorkforceMachineGroup) => {
    const groupMachines = GROUP_TO_MACHINES_MAP[group];
    const allSelectedInGroup = groupMachines.every((m) =>
      formSelectedMachines.includes(m)
    );

    if (allSelectedInGroup) {
      setFormSelectedMachines((prev) =>
        prev.filter((m) => !groupMachines.includes(m))
      );
    } else {
      setFormMachineGroups((prev) => sortMachineGroupsCanonical([...prev, group]));
      setFormSelectedMachines((prev) =>
        sortMachineCodesCanonical([...prev, ...groupMachines])
      );
    }
  };

  const handleSelectAllSlitMachines = () => {
    const allAlreadySelected = ALL_SLIT_MACHINE_CODES.every((code) =>
      formSelectedMachines.includes(code)
    );
    if (allAlreadySelected) {
      setFormSelectedMachines([]);
      setFormMachineGroups(ALL_SLIT_MACHINE_GROUPS);
    } else {
      setFormMachineGroups(ALL_SLIT_MACHINE_GROUPS);
      setFormSelectedMachines(ALL_SLIT_MACHINE_CODES);
    }
  };

  const handleClearAllFormMachines = () => {
    setFormSelectedMachines([]);
    setFormMachineGroups([]);
  };

  const toggleSpecificMachine = (machineCode: string) => {
    const parentGroup = inferMachineGroupFromCode(machineCode);
    setFormSelectedMachines((prev) => {
      const exists = prev.includes(machineCode);
      const next = exists
        ? prev.filter((m) => m !== machineCode)
        : sortMachineCodesCanonical([...prev, machineCode]);

      if (!exists) {
        if (parentGroup) {
          setFormMachineGroups((curr) =>
            curr.includes(parentGroup)
              ? curr
              : sortMachineGroupsCanonical([...curr, parentGroup])
          );
        }
        if (next.length === 1 && formAreaMode === "preset") {
          const suggestedFac = MACHINE_TO_FAC_AREA[machineCode];
          if (suggestedFac && AREA_BUILDING_OPTIONS.includes(suggestedFac)) {
            setFormArea(suggestedFac);
          }
        }
      }
      return next;
    });
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let resolvedEmpName = "";
    let resolvedEmpId = "";
    let resolvedDept = formDepartment.trim();
    if (formEmployeeMode === "directory") {
      const emp = activeEmployees.find((em) => em.employeeId === formSelectedEmpId);
      if (!emp) {
        setFormError(
          isThai ? "กรุณาเลือกพนักงานที่รับผิดชอบ" : "Please select an employee."
        );
        return;
      }
      resolvedEmpName = emp.employeeName.trim();
      resolvedEmpId = emp.employeeId.trim().toUpperCase();
      resolvedDept = emp.department?.trim() || resolvedDept;
    } else {
      resolvedEmpName = formCustomEmpName.trim();
      resolvedEmpId = formCustomEmpId.trim().toUpperCase();
      if (!resolvedEmpName) {
        setFormError(
          isThai ? "กรุณาระบุชื่อพนักงาน" : "Please enter the employee name."
        );
        return;
      }
    }

    const resolvedArea =
      formAreaMode === "preset" ? formArea.trim() : formCustomArea.trim();
    if (!resolvedArea) {
      setFormError(
        isThai ? "กรุณาระบุพื้นที่ / อาคาร" : "Please specify area / building."
      );
      return;
    }

    const resolvedDuty =
      formDutyMode === "preset" ? formDuty.trim() : formCustomDuty.trim();
    if (!resolvedDuty) {
      setFormError(
        isThai ? "กรุณาระบุหน้าที่รับผิดชอบ" : "Please specify duty / responsibility."
      );
      return;
    }

    const inferredFromMachines = formSelectedMachines
      .map((code) => inferMachineGroupFromCode(code))
      .filter((g): g is SlitWorkforceMachineGroup => Boolean(g));
    const finalMachineGroups = sortMachineGroupsCanonical([
      ...formMachineGroups,
      ...inferredFromMachines,
    ]);
    const finalSelectedMachines = sortMachineCodesCanonical(formSelectedMachines);

    if (finalMachineGroups.length === 0 && finalSelectedMachines.length === 0) {
      setFormError(
        isThai
          ? "กรุณาเลือกเครื่องจักรอย่างน้อย 1 กลุ่ม หรือ 1 รหัสเครื่อง"
          : "Please select at least 1 machine group or machine."
      );
      return;
    }

    const targetDate = formWorkingDate || selectedDate;
    const existing = editingId
      ? assignments.find((a) => a.id === editingId)
      : resolvedEmpId
      ? assignments.find(
          (a) =>
            a.workingDate === targetDate &&
            a.employeeId?.trim().toUpperCase() === resolvedEmpId
        )
      : undefined;

    const recorder = getActiveRecorderDisplay();
    const nowIso = new Date().toISOString();
    const docId =
      existing?.id ||
      (resolvedEmpId
        ? buildDeterministicAssignmentId(targetDate, resolvedEmpId)
        : `SLIT_WF_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`);

    const payload: SlitWorkforceAssignment = {
      id: docId,
      workingDate: targetDate,
      employeeId: resolvedEmpId || undefined,
      employeeName: resolvedEmpName,
      department: resolvedDept || undefined,
      shift: formShift,
      area: resolvedArea,
      machineGroup: finalMachineGroups[0] || "TM",
      machineGroups: finalMachineGroups.length > 0 ? finalMachineGroups : ["TM"],
      machines: finalSelectedMachines,
      duty: resolvedDuty,
      status: formStatus,
      notes: formNotes.trim() || undefined,
      assignedBy: existing?.assignedBy || recorder.label,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    setIsSaving(true);
    try {
      await saveSlitWorkforceAssignment(payload);
      setIsFormOpen(false);
      setEditingId(null);

      const summary = describeAssignmentMachines(payload, isThai);
      const machineLabel =
        summary.isAllMachines
          ? summary.compactText
          : summary.specificCodes.length > 0
          ? `${summary.groups.join(", ")} (${summary.detailText})`
          : summary.groups.join(", ");

      setInlineFeedback(`บันทึก ${payload.employeeName} · ${payload.area} · ${machineLabel}`);
      onLogTransaction?.(
        editingId
          ? `แก้ไขการมอบหมายกำลังพล: ${payload.employeeName} — ${machineLabel} (${payload.duty})`
          : `มอบหมายกำลังพล: ${payload.employeeName} — ${machineLabel} (${payload.duty})`,
        payload.workingDate,
        "Completed"
      );
    } catch (err) {
      console.error(err);
      setFormError(
        isThai
          ? "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง"
          : "Unable to save assignment. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCycleStatus = async (row: UnifiedWorkforceRow) => {
    const existing = row.assignment;
    if (!existing) {
      await handleInlinePatchRow(
        row,
        { status: "active" },
        `เปิดสถานะปฏิบัติงาน: ${row.employeeName}`
      );
      return;
    }
    const nextStatus: SlitWorkforceStatus =
      existing.status === "active"
        ? "completed"
        : existing.status === "completed"
        ? "standby"
        : "active";
    await handleInlinePatchRow(
      row,
      { status: nextStatus },
      `เปลี่ยนสถานะ ${row.employeeName}`
    );
  };

  const handleDeleteAssignment = async (item: SlitWorkforceAssignment) => {
    const result = await Swal.fire({
      title: isThai ? "ยืนยันล้างการมอบหมาย?" : "Clear Assignment?",
      text: isThai
        ? `ต้องการล้างข้อมูลพื้นที่/เครื่องจักร/หน้าที่ของ "${item.employeeName}" ในวันที่ ${item.workingDate} ใช่หรือไม่?`
        : `Clear assignment for "${item.employeeName}" on ${item.workingDate}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
      confirmButtonText: isThai ? "ล้างรายการ" : "Clear",
      cancelButtonText: isThai ? "ยกเลิก" : "Cancel",
    });

    if (!result.isConfirmed) return;

    try {
      await deleteSlitWorkforceAssignment(item.id);
      setInlineFeedback(`ล้างการมอบหมายของ ${item.employeeName} แล้ว`);
      onLogTransaction?.(
        `ลบรายการมอบหมายกำลังพล: ${item.employeeName} (${item.machineGroup})`,
        item.workingDate,
        "Completed"
      );
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: "error",
        title: isThai ? "ลบไม่สำเร็จ" : "Delete Failed",
        text: isThai ? "กรุณาลองใหม่อีกครั้ง" : "Please try again.",
      });
    }
  };

  const handleResetFilters = () => {
    setDepartmentScope("film_slit");
    setFilterShift("all");
    setFilterMachineGroup("all");
    setFilterMachineCode("all");
    setFilterArea("all");
    setSearchKeyword("");
  };

  const handleExportExcel = () => {
    const rows = filteredRows.map((row, idx) => {
      const asn = row.assignment;
      const machineDesc = describeAssignmentMachines(asn, true);
      return {
        "ลำดับ": idx + 1,
        "วันที่ปฏิบัติงาน": selectedDate,
        "รหัสพนักงาน": row.employeeId || "-",
        "ชื่อพนักงาน": row.employeeName,
        "ส่วนงาน": row.department || "-",
        "กะทำงาน":
          row.effectiveShift === "day"
            ? "กะเช้า (08:00-20:00)"
            : row.effectiveShift === "night"
            ? "กะดึก (20:00-08:00)"
            : row.effectiveShift === "off"
            ? "วันหยุด"
            : "ยังไม่ระบุกะ",
        "พื้นที่ / อาคาร": asn?.area && asn.area !== "-" ? asn.area : "-",
        "กลุ่มเครื่องจักร":
          machineDesc.groups.length > 0 ? machineDesc.groups.join(", ") : "-",
        "เครื่องจักรที่รับผิดชอบ": machineDesc.detailText || "-",
        "หน้าที่รับผิดชอบ": asn?.duty && asn.duty !== "-" ? asn.duty : "-",
        "สถานะ": !asn
          ? "ยังไม่มอบหมาย"
          : asn.status === "active"
          ? "ปฏิบัติงาน"
          : asn.status === "standby"
          ? "สแตนด์บาย"
          : "เสร็จสิ้น",
        "หมายเหตุ": asn?.notes || "-",
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Slit_Workforce");
    XLSX.writeFile(wb, `Slit_Workforce_${selectedDate}.xlsx`);
  };

  const renderStatusText = (status?: SlitWorkforceStatus) => {
    if (!status) {
      return (
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap">
          {isThai ? "รอมอบหมาย" : "Pending"}
        </span>
      );
    }
    if (status === "active") {
      return (
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          {isThai ? "ปฏิบัติงาน" : "Active"}
        </span>
      );
    }
    if (status === "standby") {
      return (
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
          {isThai ? "สแตนด์บาย" : "Standby"}
        </span>
      );
    }
    return (
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
        {isThai ? "เสร็จสิ้น" : "Completed"}
      </span>
    );
  };

  const hasActiveFilters =
    departmentScope !== "film_slit" ||
    filterShift !== "all" ||
    filterMachineGroup !== "all" ||
    filterMachineCode !== "all" ||
    filterArea !== "all" ||
    Boolean(searchKeyword.trim());

  const modalEmployeeList = useMemo(() => {
    const filmSet = new Set(filmSectionEmployees.map((e) => e.employeeId));
    const others = activeEmployees.filter((e) => !filmSet.has(e.employeeId));
    return { film: filmSectionEmployees, others };
  }, [filmSectionEmployees, activeEmployees]);

  return (
    <div className="space-y-4">
      {/* Header Bar with Date Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Users size={20} className="text-sky-600 dark:text-sky-400 shrink-0" />
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight truncate">
              {isThai
                ? "จัดการกำลังพล — เหล็กสลิต / ฟิล์ม"
                : "Workforce Management — Slit / Film"}
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {isThai
              ? "ดึงรายชื่อพนักงานส่วนงานฟิล์มพร้อมกะทำงานจากตารางจัดกะอัตโนมัติ — เลือกพื้นที่/อาคาร เครื่องจักร (TM, CF, ML, ZF) และหน้าที่ได้ทันที"
              : "Auto-pulls Film/Slit staff and shift schedules — assign area/building, machines (TM, CF, ML, ZF), and duties directly"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Working Date Switcher */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] p-1">
            <button
              type="button"
              onClick={() => setSelectedDate((d) => addDaysToYmd(d, -1))}
              aria-label={isThai ? "วันก่อนหน้า" : "Previous day"}
              className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#193055] transition-colors cursor-pointer"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="flex items-center gap-1.5 px-1.5">
              <Calendar size={13} className="text-sky-600 dark:text-sky-400 shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                aria-label={isThai ? "วันที่ปฏิบัติงาน" : "Working date"}
                className="bg-transparent text-xs font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none dark:[color-scheme:dark]"
              />
            </div>
            <button
              type="button"
              onClick={() => setSelectedDate((d) => addDaysToYmd(d, 1))}
              aria-label={isThai ? "วันถัดไป" : "Next day"}
              className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#193055] transition-colors cursor-pointer"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {selectedDate !== todayYmd && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayYmd)}
              className="px-2.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#132544] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#193055] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isThai ? "วันนี้" : "Today"}
            </button>
          )}

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#132544] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#193055] disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet size={15} />
            <span>{isThai ? "ส่งออก Excel" : "Export Excel"}</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus size={15} />
            <span>{isThai ? "มอบหมายเพิ่มเติม" : "Assign Extra"}</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "กำลังพลในตาราง / มอบหมายแล้ว" : "Staff Roster / Assigned"}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.totalStaff}
            </span>
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-mono font-semibold tabular-nums">
              {isThai
                ? `กำหนดแล้ว ${summaryStats.assignedCount} คน`
                : `${summaryStats.assignedCount} assigned`}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "กะเช้า (08:00 - 20:00)" : "Day Shift (08:00 - 20:00)"}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
              {summaryStats.dayCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isThai ? "คน" : "staff"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "กะดึก (20:00 - 08:00)" : "Night Shift (20:00 - 08:00)"}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
              {summaryStats.nightCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isThai ? "คน" : "staff"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl px-4 py-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isThai ? "กระจายตามกลุ่มเครื่องจักร" : "Machine Group Coverage"}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 flex-wrap">
            <span>
              TM <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.TM}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>
              CF <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.CF}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>
              ML <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.ML}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>
              ZF <strong className="text-slate-900 dark:text-white">{summaryStats.groupCounts.ZF}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar + Unified Roster & Assignment Table */}
      <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl overflow-hidden">
        {/* Filter Controls */}
        <div className="p-4 border-b border-slate-200 dark:border-[#1e3a5f] space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder={
                  isThai
                    ? "ค้นหาชื่อพนักงาน, รหัส, ส่วนงาน, เครื่องจักร, พื้นที่, หน้าที่..."
                    : "Search employee, ID, section, machine, area, duty..."
                }
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Section / Department Scope Filter */}
            <select
              value={departmentScope}
              onChange={(e) => setDepartmentScope(e.target.value)}
              aria-label={isThai ? "เลือกส่วนงานพนักงาน" : "Filter by section"}
              className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <option value="film_slit">
                {isThai
                  ? `ส่วนงานฟิล์ม / สลิต (${filmSectionEmployees.length})`
                  : `Film / Slit Section (${filmSectionEmployees.length})`}
              </option>
              <option value="all">
                {isThai
                  ? `พนักงานทั้งหมดทุกส่วนงาน (${activeEmployees.length})`
                  : `All Active Employees (${activeEmployees.length})`}
              </option>
              {allEmployeeDepartments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            {/* Area Filter */}
            <select
              value={filterArea}
              onChange={(e) => setFilterArea(e.target.value)}
              aria-label={isThai ? "กรองตามพื้นที่/อาคาร" : "Filter by area"}
              className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <option value="all">
                {isThai ? "ทุกพื้นที่ / อาคาร" : "All Areas / Buildings"}
              </option>
              {availableFilterAreas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw size={13} />
                <span>{isThai ? "ล้างตัวกรอง" : "Reset"}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Shift Segmented Control */}
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0a1426] border border-slate-200 dark:border-[#1e3a5f]">
              {(
                [
                  { key: "all", label: isThai ? "ทุกกะ" : "All Shifts" },
                  { key: "day", label: isThai ? "กะเช้า" : "Day" },
                  { key: "night", label: isThai ? "กะดึก" : "Night" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterShift(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    filterShift === tab.key
                      ? "bg-white dark:bg-[#193055] text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Machine Group Segmented Control + Specific Machine Code Filter */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0a1426] border border-slate-200 dark:border-[#1e3a5f]">
                {(["all", "TM", "CF", "ML", "ZF"] as const).map((grp) => (
                  <button
                    key={grp}
                    type="button"
                    onClick={() => {
                      setFilterMachineGroup(grp);
                      if (
                        grp !== "all" &&
                        filterMachineCode !== "all" &&
                        inferMachineGroupFromCode(filterMachineCode) !== grp
                      ) {
                        setFilterMachineCode("all");
                      }
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold font-mono transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      filterMachineGroup === grp
                        ? "bg-sky-600 text-white"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {grp === "all" ? (isThai ? "ทุกกลุ่ม" : "All") : grp}
                  </button>
                ))}
              </div>

              <select
                value={filterMachineCode}
                onChange={(e) => {
                  const val = e.target.value;
                  setFilterMachineCode(val);
                  if (val !== "all" && filterMachineGroup !== "all") {
                    const codeGroup = inferMachineGroupFromCode(val);
                    if (codeGroup && codeGroup !== filterMachineGroup) {
                      setFilterMachineGroup("all");
                    }
                  }
                }}
                aria-label={isThai ? "กรองตามรหัสเครื่องจักร" : "Filter by machine code"}
                className="px-3 py-1.5 text-xs font-mono font-semibold rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                <option value="all">
                  {isThai ? "ทุกรหัสเครื่อง (23)" : "All Machines (23)"}
                </option>
                {MACHINE_GROUP_OPTIONS.map((grp) => (
                  <optgroup
                    key={grp.key}
                    label={`${grp.key} — ${isThai ? grp.labelTh : grp.labelEn}`}
                  >
                    {grp.machines.map((mCode) => (
                      <option key={mCode} value={mCode}>
                        {mCode}
                        {MACHINE_TO_FAC_AREA[mCode] ? ` (${MACHINE_TO_FAC_AREA[mCode]})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Active Date & Live Save Feedback Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
            <span>
              {formatThaiDateLabel(selectedDate)}
              {" · "}
              {weeklySchedule
                ? isThai
                  ? "ซิงก์กะทำงานจากตารางจัดกะรายสัปดาห์แล้ว"
                  : "Synced with Weekly Shift Schedule"
                : isThai
                ? "ใช้ข้อมูลกะจากทะเบียนพนักงาน"
                : "Using shift from employee roster"}
            </span>
            {inlineFeedback && (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {inlineFeedback}
              </span>
            )}
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0b162a] text-xs font-semibold text-slate-600 dark:text-slate-300">
                <th className="py-3 px-3 whitespace-nowrap w-10">#</th>
                <th className="py-3 px-3 whitespace-nowrap min-w-[180px]">
                  {isThai ? "พนักงาน" : "Employee"}
                </th>
                <th className="py-3 px-3 whitespace-nowrap min-w-[130px]">
                  {isThai ? "ส่วนงาน" : "Section"}
                </th>
                <th className="py-3 px-3 whitespace-nowrap min-w-[125px]">
                  {isThai ? "กะทำงาน" : "Shift"}
                </th>
                <th className="py-3 px-3 whitespace-nowrap min-w-[165px]">
                  {isThai ? "พื้นที่ / อาคาร" : "Area / Building"}
                </th>
                <th className="py-3 px-3 whitespace-nowrap min-w-[195px]">
                  {isThai ? "เครื่องจักร (TM / CF / ML / ZF)" : "Machine"}
                </th>
                <th className="py-3 px-3 whitespace-nowrap min-w-[205px]">
                  {isThai ? "หน้าที่รับผิดชอบ" : "Duty"}
                </th>
                <th className="py-3 px-3 whitespace-nowrap">
                  {isThai ? "สถานะ" : "Status"}
                </th>
                <th className="py-3 px-3 text-right whitespace-nowrap">
                  {isThai ? "จัดการ" : "Actions"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#192e50] text-sm">
              {isLoading && unifiedRows.length === 0 ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={9} className="py-3.5 px-4">
                      <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 px-4 text-center">
                    <div className="max-w-md mx-auto space-y-2">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {departmentScope === "film_slit" && filmSectionEmployees.length === 0
                          ? isThai
                            ? "ยังไม่มีรายชื่อพนักงานที่ระบุส่วนงานฟิล์ม / สลิตในฐานข้อมูลพนักงาน"
                            : "No employees found in the Film / Slit section"
                          : isThai
                          ? "ไม่พบรายการกำลังพลที่ตรงกับตัวกรอง"
                          : "No workforce rows match the active filters"}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {departmentScope === "film_slit" && filmSectionEmployees.length === 0
                          ? isThai
                            ? "คุณสามารถเพิ่มพนักงานส่วนงานฟิล์มได้ที่หน้า งานบริหารและกำลังพล หรือเลือกดูพนักงานทั้งหมดเพื่อมอบหมายหน้าที่ได้ทันที"
                            : "Add Film/Slit staff in Admin & Workforce, or switch to All Active Employees."
                          : isThai
                          ? "ลองล้างตัวกรอง หรือกดปุ่ม \"มอบหมายเพิ่มเติม\" เพื่อเพิ่มรายการใหม่"
                          : "Try resetting filters or click \"Assign Extra\"."}
                      </p>
                      <div className="pt-2 flex items-center justify-center gap-2">
                        {departmentScope === "film_slit" && activeEmployees.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setDepartmentScope("all")}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#132544] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#193055] transition-colors cursor-pointer"
                          >
                            <span>{isThai ? "แสดงพนักงานทั้งหมด" : "Show All Staff"}</span>
                          </button>
                        )}
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={handleResetFilters}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white transition-colors cursor-pointer"
                          >
                            <RotateCcw size={14} />
                            <span>{isThai ? "ล้างตัวกรอง" : "Clear Filters"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const asn = row.assignment;
                  const isRowSaving = Boolean(savingRowKeys[row.rowKey]);
                  const showPhoto = Boolean(row.photoUrl) && !brokenPhotoIds[row.rowKey];
                  const currentArea = asn?.area && asn.area !== "-" ? asn.area : "";
                  const currentDuty = asn?.duty && asn.duty !== "-" ? asn.duty : "";
                  const machineDesc = describeAssignmentMachines(asn, isThai);
                  const currentGroups = machineDesc.groups;

                  return (
                    <tr
                      key={row.rowKey}
                      className={`transition-colors ${
                        row.effectiveShift === "off"
                          ? "bg-slate-50/70 dark:bg-[#0b1528]/70 opacity-75"
                          : "hover:bg-slate-50/90 dark:hover:bg-[#132544]/70"
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono tabular-nums text-xs text-slate-400">
                        {idx + 1}
                      </td>

                      {/* Employee Photo + Name + ID */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          {showPhoto ? (
                            <img
                              src={row.photoUrl}
                              alt={row.employeeName}
                              referrerPolicy="no-referrer"
                              onError={() =>
                                setBrokenPhotoIds((prev) => ({ ...prev, [row.rowKey]: true }))
                              }
                              className="h-9 w-9 rounded-full border border-slate-200 dark:border-[#2a4570] object-cover shrink-0"
                            />
                          ) : (
                            <div
                              aria-label={row.employeeName}
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 dark:border-[#2a4570] bg-slate-100 dark:bg-[#162749] text-xs font-bold text-slate-600 dark:text-slate-200 shrink-0"
                            >
                              {getEmployeeInitials(row.employeeName)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-white leading-snug truncate">
                              {row.employeeName}
                            </div>
                            {row.employeeId && (
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {row.employeeId}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Section / Department */}
                      <td className="py-2.5 px-3">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                          {row.department}
                        </div>
                      </td>

                      {/* Shift (Auto-pulled from Shift Schedule + Inline Override if Unassigned) */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {row.effectiveShift === "day" ? (
                          <div>
                            <div className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400">
                              <Sun size={13} />
                              <span>{isThai ? "กะเช้า" : "Day Shift"}</span>
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              08:00 - 20:00
                            </div>
                          </div>
                        ) : row.effectiveShift === "night" ? (
                          <div>
                            <div className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 dark:text-indigo-400">
                              <Moon size={13} />
                              <span>{isThai ? "กะดึก" : "Night Shift"}</span>
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              20:00 - 08:00
                            </div>
                          </div>
                        ) : row.effectiveShift === "off" ? (
                          <div className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                            {isThai ? "วันหยุด (ตารางกะ)" : "Day Off"}
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isRowSaving}
                              onClick={() =>
                                handleInlinePatchRow(
                                  row,
                                  { shift: "day" },
                                  `กำหนดกะเช้า: ${row.employeeName}`
                                )
                              }
                              className="px-2 py-1 rounded border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 cursor-pointer"
                            >
                              {isThai ? "เช้า" : "Day"}
                            </button>
                            <button
                              type="button"
                              disabled={isRowSaving}
                              onClick={() =>
                                handleInlinePatchRow(
                                  row,
                                  { shift: "night" },
                                  `กำหนดกะดึก: ${row.employeeName}`
                                )
                              }
                              className="px-2 py-1 rounded border border-indigo-300 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 cursor-pointer"
                            >
                              {isThai ? "ดึก" : "Night"}
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Area / Building Inline Selector */}
                      <td className="py-2.5 px-3">
                        <select
                          value={currentArea}
                          disabled={isRowSaving}
                          onChange={(e) =>
                            handleInlinePatchRow(
                              row,
                              { area: e.target.value },
                              `บันทึกพื้นที่ ${row.employeeName} → ${e.target.value || "-"}`
                            )
                          }
                          aria-label={`เลือกพื้นที่สำหรับ ${row.employeeName}`}
                          className="w-full min-w-[145px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        >
                          <option value="">
                            {isThai ? "— เลือกพื้นที่/อาคาร —" : "— Select Area —"}
                          </option>
                          {AREA_BUILDING_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                          {currentArea && !AREA_BUILDING_OPTIONS.includes(currentArea) && (
                            <option value={currentArea}>{currentArea}</option>
                          )}
                        </select>
                      </td>

                      {/* Machine Groups Multi-Select Inline Toggle (TM, CF, ML, ZF) + Selected Machines */}
                      <td className="py-2.5 px-3">
                        <div className="space-y-1.5 min-w-[205px]">
                          <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0a1426] border border-slate-200 dark:border-[#1e3a5f]">
                            {ALL_SLIT_MACHINE_GROUPS.map((grp) => {
                              const selected = currentGroups.includes(grp);
                              return (
                                <button
                                  key={grp}
                                  type="button"
                                  disabled={isRowSaving}
                                  onClick={() => handleInlineToggleMachineGroup(row, grp)}
                                  title={
                                    selected
                                      ? isThai
                                        ? `คลิกเพื่อนำกลุ่ม ${grp} ออก`
                                        : `Remove ${grp}`
                                      : isThai
                                      ? `คลิกเพื่อเพิ่มกลุ่ม ${grp}`
                                      : `Add ${grp}`
                                  }
                                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold transition-colors cursor-pointer whitespace-nowrap ${
                                    selected
                                      ? "bg-sky-600 text-white shadow-xs"
                                      : "text-slate-600 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-[#193055] hover:text-slate-900 dark:hover:text-white"
                                  }`}
                                >
                                  {grp}
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex items-start justify-between gap-1.5 max-w-[245px]">
                            {machineDesc.isAllMachines ? (
                              <span className="text-[11px] font-mono font-semibold text-sky-700 dark:text-sky-400 leading-snug">
                                {machineDesc.compactText}
                              </span>
                            ) : machineDesc.specificCodes.length > 0 ? (
                              <div
                                title={machineDesc.detailText}
                                className="flex flex-wrap items-center gap-1"
                              >
                                {machineDesc.specificCodes.slice(0, 6).map((code) => (
                                  <span
                                    key={code}
                                    className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 text-[10px] font-mono font-semibold text-sky-700 dark:text-sky-300 leading-none"
                                  >
                                    {code}
                                  </span>
                                ))}
                                {machineDesc.specificCodes.length > 6 && (
                                  <span className="text-[10px] font-mono font-semibold text-sky-600 dark:text-sky-400">
                                    +{machineDesc.specificCodes.length - 6}
                                  </span>
                                )}
                                {currentGroups
                                  .filter(
                                    (grp) =>
                                      !machineDesc.specificCodes.some(
                                        (c) => inferMachineGroupFromCode(c) === grp
                                      )
                                  )
                                  .map((fullGrp) => (
                                    <span
                                      key={fullGrp}
                                      className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#162749] border border-slate-200 dark:border-[#24426b] text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-300 leading-none"
                                    >
                                      {fullGrp} {isThai ? "ทั้งกลุ่ม" : "All"}
                                    </span>
                                  ))}
                              </div>
                            ) : currentGroups.length > 0 ? (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                                {isThai
                                  ? `ทั้งกลุ่ม ${currentGroups.join(", ")}`
                                  : `Full ${currentGroups.join(", ")}`}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                {isThai ? "ยังไม่ได้ระบุเครื่อง" : "Not assigned"}
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => openDetailModalForRow(row)}
                              className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer pt-0.5"
                            >
                              {isThai ? "เลือกเครื่อง" : "Pick"}
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Duty Inline Selector */}
                      <td className="py-2.5 px-3">
                        <select
                          value={currentDuty}
                          disabled={isRowSaving}
                          onChange={(e) =>
                            handleInlinePatchRow(
                              row,
                              { duty: e.target.value },
                              `บันทึกหน้าที่ ${row.employeeName} → ${e.target.value || "-"}`
                            )
                          }
                          aria-label={`เลือกหน้าที่สำหรับ ${row.employeeName}`}
                          className="w-full min-w-[190px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        >
                          <option value="">
                            {isThai ? "— เลือกหน้าที่ —" : "— Select Duty —"}
                          </option>
                          {dutyOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                          {currentDuty && !dutyOptions.includes(currentDuty) && (
                            <option value={currentDuty}>{currentDuty}</option>
                          )}
                        </select>
                        {asn?.notes && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-[210px] truncate">
                            {asn.notes}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={isRowSaving}
                          onClick={() => handleCycleStatus(row)}
                          title={isThai ? "คลิกเพื่อเปลี่ยนสถานะ" : "Click to toggle status"}
                          className="hover:underline cursor-pointer text-left"
                        >
                          {renderStatusText(asn?.status)}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openDetailModalForRow(row)}
                            title={
                              isThai
                                ? "ระบุเครื่องจักรย่อย / แก้ไขรายละเอียด"
                                : "Specify Machines / Edit Details"
                            }
                            className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 dark:text-slate-400 dark:hover:text-sky-400 dark:hover:bg-sky-950/40 transition-colors cursor-pointer"
                          >
                            <Edit2 size={15} />
                          </button>
                          {asn && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAssignment(asn)}
                              title={isThai ? "ล้างการมอบหมาย" : "Clear Assignment"}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-400 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Detailed Assignment Modal */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-[2px] flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slit-workforce-modal-title"
        >
          <div className="w-full max-w-2xl bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-2xl shadow-2xl overflow-hidden my-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#1e3a5f]">
              <div>
                <h3
                  id="slit-workforce-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-white"
                >
                  {editingId
                    ? isThai
                      ? "แก้ไขรายละเอียดการมอบหมายกำลังพล"
                      : "Edit Workforce Assignment"
                    : isThai
                    ? "มอบหมายหน้าที่รับผิดชอบ — เหล็กสลิต / ฟิล์ม"
                    : "Assign Slit / Film Responsibility"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isThai
                    ? "ระบุพนักงาน กะทำงาน พื้นที่/อาคาร เครื่องจักรย่อย (TM, CF, ML, ZF) และหน้าที่"
                    : "Specify employee, shift, area/building, sub-machines, and duty"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#193055] transition-colors cursor-pointer"
                aria-label={isThai ? "ปิดหน้าต่าง" : "Close modal"}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAssignment} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-medium text-rose-700 dark:text-rose-300">
                  {formError}
                </div>
              )}

              {/* Row 1: Working Date + Shift */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "วันที่ปฏิบัติงาน" : "Working Date"}
                  </label>
                  <input
                    type="date"
                    required
                    value={formWorkingDate}
                    onChange={(e) => setFormWorkingDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "กะทำงาน" : "Shift"}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormShift("day")}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        formShift === "day"
                          ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-800 dark:text-amber-300"
                          : "bg-white dark:bg-[#0a1426] border-slate-300 dark:border-[#24426b] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#132544]"
                      }`}
                    >
                      <Sun size={14} />
                      <span>{isThai ? "กะเช้า (08-20)" : "Day (08-20)"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormShift("night")}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        formShift === "night"
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-800 dark:text-indigo-300"
                          : "bg-white dark:bg-[#0a1426] border-slate-300 dark:border-[#24426b] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#132544]"
                      }`}
                    >
                      <Moon size={14} />
                      <span>{isThai ? "กะดึก (20-08)" : "Night (20-08)"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Row 2: Employee */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {isThai ? "พนักงาน" : "Employee"}
                  </label>
                  {activeEmployees.length > 0 && (
                    <div className="inline-flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setFormEmployeeMode("directory")}
                        className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                          formEmployeeMode === "directory"
                            ? "text-sky-700 dark:text-sky-400 underline underline-offset-4"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                      >
                        {isThai ? "เลือกจากรายชื่อ" : "From Directory"}
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">/</span>
                      <button
                        type="button"
                        onClick={() => setFormEmployeeMode("custom")}
                        className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                          formEmployeeMode === "custom"
                            ? "text-sky-700 dark:text-sky-400 underline underline-offset-4"
                            : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                      >
                        {isThai ? "ระบุเอง" : "Custom Input"}
                      </button>
                    </div>
                  )}
                </div>

                {formEmployeeMode === "directory" && activeEmployees.length > 0 ? (
                  <select
                    value={formSelectedEmpId}
                    onChange={(e) => handleModalSelectEmployee(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  >
                    {modalEmployeeList.film.length > 0 && (
                      <optgroup label={isThai ? "ส่วนงานฟิล์ม / สลิต" : "Film / Slit Section"}>
                        {modalEmployeeList.film.map((emp) => (
                          <option key={emp.employeeId} value={emp.employeeId}>
                            {emp.employeeId} — {emp.employeeName}
                            {emp.department ? ` (${emp.department})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {modalEmployeeList.others.length > 0 && (
                      <optgroup label={isThai ? "ส่วนงานอื่น" : "Other Sections"}>
                        {modalEmployeeList.others.map((emp) => (
                          <option key={emp.employeeId} value={emp.employeeId}>
                            {emp.employeeId} — {emp.employeeName}
                            {emp.department ? ` (${emp.department})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      value={formCustomEmpId}
                      onChange={(e) => setFormCustomEmpId(e.target.value)}
                      placeholder={isThai ? "รหัสพนักงาน (ไม่บังคับ)" : "Employee ID (optional)"}
                      className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                    <input
                      type="text"
                      required
                      value={formCustomEmpName}
                      onChange={(e) => setFormCustomEmpName(e.target.value)}
                      placeholder={isThai ? "ชื่อ-นามสกุลพนักงาน *" : "Employee Full Name *"}
                      className="sm:col-span-2 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                  </div>
                )}
              </div>

              {/* Row 3: Multi-Select Machine Groups (TM, CF, ML, ZF) + Cross-Group Specific Machines */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {isThai
                        ? "เครื่องจักร (เลือกได้หลายกลุ่ม / หลายเครื่องข้ามกลุ่มพร้อมกัน)"
                        : "Machines (Multi-Group & Cross-Group Multi-Select)"}
                    </label>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {isThai
                        ? "เลือกกลุ่มเครื่องจักร (TM, CF, ML, ZF) หรือคลิกเลือกรหัสเครื่องย่อยข้ามกลุ่มได้ตามต้องการ"
                        : "Select multiple machine groups or pick any combination of specific machines across groups"}
                    </p>
                  </div>

                  <div className="inline-flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleSelectAllSlitMachines}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
                        ALL_SLIT_MACHINE_CODES.every((c) => formSelectedMachines.includes(c))
                          ? "bg-sky-600 border-sky-600 text-white"
                          : "bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50"
                      }`}
                    >
                      {ALL_SLIT_MACHINE_CODES.every((c) => formSelectedMachines.includes(c))
                        ? isThai
                          ? `เลือกครบทุกเครื่อง (${ALL_SLIT_MACHINE_CODES.length})`
                          : `All Selected (${ALL_SLIT_MACHINE_CODES.length})`
                        : isThai
                        ? `เลือกทุกเครื่อง (${ALL_SLIT_MACHINE_CODES.length})`
                        : `Select All (${ALL_SLIT_MACHINE_CODES.length})`}
                    </button>
                    {(formSelectedMachines.length > 0 || formMachineGroups.length > 0) && (
                      <button
                        type="button"
                        onClick={handleClearAllFormMachines}
                        className="px-2 py-1 rounded-md text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-[#193055] transition-colors cursor-pointer"
                      >
                        {isThai ? "ล้างทั้งหมด" : "Clear All"}
                      </button>
                    )}
                  </div>
                </div>

                {/* 4 Group Multi-Select Toggle Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MACHINE_GROUP_OPTIONS.map((grp) => {
                    const isSelected = formMachineGroups.includes(grp.key);
                    const selectedInGrpCount = grp.machines.filter((m) =>
                      formSelectedMachines.includes(m)
                    ).length;
                    return (
                      <button
                        key={grp.key}
                        type="button"
                        onClick={() => handleToggleFormMachineGroup(grp.key)}
                        className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-sky-50 dark:bg-sky-950/50 border-sky-600 text-sky-900 dark:text-sky-200"
                            : "bg-white dark:bg-[#0a1426] border-slate-300 dark:border-[#24426b] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#132544]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-sm font-bold font-mono">{grp.key}</span>
                          {isSelected && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold text-sky-700 dark:text-sky-300">
                              <Check size={12} />
                              {selectedInGrpCount > 0
                                ? `${selectedInGrpCount}/${grp.machines.length}`
                                : isThai
                                ? "ทั้งกลุ่ม"
                                : "All"}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {isThai ? grp.labelTh : grp.labelEn}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Cross-Group Specific Machines Matrix (All 4 Groups Visible Simultaneously) */}
                <div className="rounded-xl border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/70 dark:bg-[#081224] divide-y divide-slate-200/80 dark:divide-[#1a3154] max-h-[250px] overflow-y-auto">
                  {MACHINE_GROUP_OPTIONS.map((grp) => {
                    const groupSelectedCount = grp.machines.filter((m) =>
                      formSelectedMachines.includes(m)
                    ).length;
                    const allInGroupSelected = groupSelectedCount === grp.machines.length;
                    const isGroupActive = formMachineGroups.includes(grp.key);

                    return (
                      <div key={grp.key} className="p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold ${
                                isGroupActive
                                  ? "bg-sky-600 text-white"
                                  : "bg-slate-200 dark:bg-[#193055] text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {grp.key}
                            </span>
                            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                              {isThai ? grp.labelTh : grp.labelEn}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                              ({groupSelectedCount}/{grp.machines.length})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleAllMachinesInGroup(grp.key)}
                            className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {allInGroupSelected
                              ? isThai
                                ? `ล้าง ${grp.key}`
                                : `Clear ${grp.key}`
                              : isThai
                              ? `เลือกทุกเครื่อง ${grp.key}`
                              : `Select All ${grp.key}`}
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {grp.machines.map((mCode) => {
                            const active = formSelectedMachines.includes(mCode);
                            const fac = MACHINE_TO_FAC_AREA[mCode];
                            return (
                              <button
                                key={mCode}
                                type="button"
                                onClick={() => toggleSpecificMachine(mCode)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono font-semibold border transition-colors cursor-pointer ${
                                  active
                                    ? "bg-sky-600 border-sky-600 text-white"
                                    : "bg-white dark:bg-[#0f1d36] border-slate-200 dark:border-[#24426b] text-slate-700 dark:text-slate-300 hover:border-sky-400"
                                }`}
                              >
                                {active && <Check size={11} />}
                                <span>{mCode}</span>
                                {fac && (
                                  <span
                                    className={`text-[10px] font-sans ${
                                      active ? "text-sky-100" : "text-slate-400 dark:text-slate-500"
                                    }`}
                                  >
                                    {fac}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Live Selection Summary */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-100/80 dark:bg-[#0a162b] border border-slate-200/80 dark:border-[#1e3a5f] text-[11px]">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {isThai ? "สรุปเครื่องจักรที่เลือก:" : "Selected:"}
                  </span>
                  <span className="font-mono font-semibold text-sky-700 dark:text-sky-300 text-right">
                    {ALL_SLIT_MACHINE_CODES.every((c) => formSelectedMachines.includes(c))
                      ? isThai
                        ? `ครบทุกเครื่อง (${ALL_SLIT_MACHINE_CODES.length} เครื่อง · TM, CF, ML, ZF)`
                        : `All ${ALL_SLIT_MACHINE_CODES.length} Machines (TM, CF, ML, ZF)`
                      : formSelectedMachines.length > 0
                      ? `${formMachineGroups.join(", ")} · ${formSelectedMachines.length} ${
                          isThai ? "เครื่อง" : "machines"
                        } (${formSelectedMachines.slice(0, 8).join(", ")}${
                          formSelectedMachines.length > 8
                            ? ` +${formSelectedMachines.length - 8}`
                            : ""
                        })`
                      : formMachineGroups.length > 0
                      ? isThai
                        ? `ทั้งกลุ่ม ${formMachineGroups.join(", ")} (ไม่จำกัดรหัสเครื่องย่อย)`
                        : `Full Groups: ${formMachineGroups.join(", ")}`
                      : isThai
                      ? "ยังไม่ได้เลือกเครื่องจักร"
                      : "None selected"}
                  </span>
                </div>
              </div>

              {/* Row 4: Area / Building */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {isThai ? "พื้นที่ / อาคาร" : "Area / Building"}
                  </label>
                  <div className="inline-flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setFormAreaMode("preset")}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        formAreaMode === "preset"
                          ? "text-sky-700 dark:text-sky-400 underline underline-offset-4"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {isThai ? "เลือกจากรายการ" : "Preset"}
                    </button>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <button
                      type="button"
                      onClick={() => setFormAreaMode("custom")}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        formAreaMode === "custom"
                          ? "text-sky-700 dark:text-sky-400 underline underline-offset-4"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {isThai ? "ระบุเอง" : "Custom"}
                    </button>
                  </div>
                </div>

                {formAreaMode === "preset" ? (
                  <select
                    value={formArea}
                    onChange={(e) => setFormArea(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  >
                    {AREA_BUILDING_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={formCustomArea}
                    onChange={(e) => setFormCustomArea(e.target.value)}
                    placeholder={isThai ? "ระบุชื่อพื้นที่ / อาคาร *" : "Enter area / building *"}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                )}
              </div>

              {/* Row 5: Duty */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {isThai ? "หน้าที่รับผิดชอบ" : "Duty / Responsibility"}
                  </label>
                  <div className="inline-flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setFormDutyMode("preset")}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        formDutyMode === "preset"
                          ? "text-sky-700 dark:text-sky-400 underline underline-offset-4"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {isThai ? "เลือกจากรายการ" : "Preset"}
                    </button>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <button
                      type="button"
                      onClick={() => setFormDutyMode("custom")}
                      className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                        formDutyMode === "custom"
                          ? "text-sky-700 dark:text-sky-400 underline underline-offset-4"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {isThai ? "ระบุเอง" : "Custom"}
                    </button>
                  </div>
                </div>

                {formDutyMode === "preset" ? (
                  <select
                    value={formDuty}
                    onChange={(e) => setFormDuty(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  >
                    {dutyOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={formCustomDuty}
                    onChange={(e) => setFormCustomDuty(e.target.value)}
                    placeholder={isThai ? "ระบุรายละเอียดหน้าที่รับผิดชอบ *" : "Enter duty details *"}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                )}
              </div>

              {/* Row 6: Status + Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "สถานะ" : "Status"}
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as SlitWorkforceStatus)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  >
                    <option value="active">{isThai ? "ปฏิบัติงาน" : "Active"}</option>
                    <option value="standby">{isThai ? "สแตนด์บาย" : "Standby"}</option>
                    <option value="completed">{isThai ? "เสร็จสิ้น" : "Completed"}</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {isThai ? "หมายเหตุเพิ่มเติม (ไม่บังคับ)" : "Notes (Optional)"}
                  </label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder={
                      isThai
                        ? "เช่น รับผิดชอบงานเร่งด่วน, สแตนด์บายเปลี่ยนกะ..."
                        : "Optional remarks or handoff instructions..."
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#0a1426] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#1e3a5f]">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#193055] transition-colors cursor-pointer"
                >
                  {isThai ? "ยกเลิก" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-55 transition-colors cursor-pointer"
                >
                  <Check size={14} />
                  <span>
                    {isSaving
                      ? isThai
                        ? "กำลังบันทึก..."
                        : "Saving..."
                      : editingId
                      ? isThai
                        ? "บันทึกการแก้ไข"
                        : "Save Changes"
                      : isThai
                      ? "บันทึกการมอบหมาย"
                      : "Save Assignment"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
