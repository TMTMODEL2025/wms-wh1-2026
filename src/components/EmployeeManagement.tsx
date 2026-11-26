/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Users,
  Plus,
  Search,
  RotateCcw,
  Edit3,
  Eye,
  Power,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Calendar,
  Layers,
  FileText,
  Truck,
  Phone,
  Briefcase,
  Building,
  UserX,
  UserCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  ClipboardList,
  Camera,
  Upload,
  Trash2,
} from "lucide-react";
import {
  Employee,
  EmployeeRole,
  EmploymentStatus,
  VehicleAssignment,
  Vehicle,
  AssignmentStatus,
  WmsSectionId,
} from "../types/officer";
import { EMPLOYEE_ROLES, isDriverRole, MASTER_DEPARTMENTS } from "../data/officerData";
import {
  getDefaultSectionsForRoleAndDept,
  getSectionMeta,
  resolveEmployeeAllowedSections,
  WMS_SECTIONS,
} from "../utils/sectionPermissions";
import {
  MhDailyDutyRecord,
  loadCachedMhDailyDuties,
  subscribeToMhDailyDuties,
} from "../services/forkliftDataService";
import { DailyDutyAssignmentPanel } from "./DailyDutyAssignmentPanel";

/**
 * บีบอัดรูปถ่ายพนักงานให้เป็นขนาดไม่เกิน 320x320 px (JPEG 82%)
 * เพื่อความรวดเร็วในการบันทึกและซิงค์ขึ้น Cloud / localStorage
 */
async function compressEmployeePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("กรุณาเลือกไฟล์รูปภาพเท่านั้น (JPG, PNG, WEBP)");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพได้"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("ไฟล์รูปภาพไม่ถูกต้อง"));
      img.onload = () => {
        const maxSize = 320;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
        resolve(compressedDataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

interface EmployeeManagementProps {
  employees: Employee[];
  vehicles: Vehicle[];
  assignments: VehicleAssignment[];
  onUpdateEmployees: (updated: Employee[]) => void;
  onUpdateAssignments: (updated: VehicleAssignment[]) => void;
  onNavigateToAssignment?: () => void;
  onNavigateToVehicles?: () => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
  hideSubTabs?: boolean;
  lockedDepartment?: string;
  groupBy?: "department" | "position";
}

function matchesLockedDepartment(dept?: string, lockedDepartment?: string): boolean {
  if (!lockedDepartment) return true;
  const clean = String(dept || "").trim().toLowerCase();
  const target = lockedDepartment.trim().toLowerCase();
  if (clean === target) return true;
  if (target === "material handling - fleet") {
    return clean.includes("material handling") && clean.includes("fleet");
  }
  return false;
}

const ROLE_SENIORITY_RANK: Record<string, number> = {
  Manager: 10,
  "Assistant Manager": 20,
  Supervisor: 30,
  "Sr.Warehouse Officer": 40,
  Officer: 50,
  "Sr.Inspector": 60,
  Inspector: 70,
  Operator: 80,
  "Technical Service Forklift": 82,
  "Sr.Forklift Driver": 85,
  "Forklift Driver": 90,
  "Tractor Driver": 92,
  Driver: 95,
  Other: 100,
};

function getRoleSeniorityRank(role?: string): number {
  if (!role) return 110;
  return ROLE_SENIORITY_RANK[role] ?? 105;
}

function getJobPositionTextRank(jobPosition?: string): number | null {
  const pos = String(jobPosition || "").trim().toLowerCase();
  if (!pos) return null;
  if (pos.includes("ผู้ช่วยผู้จัดการ") || pos.includes("assistant manager") || pos.includes("asst. manager") || pos.includes("asst manager")) {
    return 20;
  }
  if (pos.includes("ผู้จัดการ") || pos.includes("manager")) {
    return 10;
  }
  if (pos.includes("หัวหน้า") || pos.includes("supervisor") || pos.includes("foreman") || pos.includes("leader") || pos.includes("chief")) {
    return 30;
  }
  if ((pos.includes("อาวุโส") || pos.includes("sr.") || pos.includes("senior")) && (pos.includes("เจ้าหน้าที่") || pos.includes("officer") || pos.includes("warehouse"))) {
    return 40;
  }
  if (pos.includes("เจ้าหน้าที่") || pos.includes("officer") || pos.includes("admin") || pos.includes("ธุรการ") || pos.includes("ประสานงาน")) {
    return 50;
  }
  if ((pos.includes("อาวุโส") || pos.includes("sr.") || pos.includes("senior")) && (pos.includes("ตรวจ") || pos.includes("inspector"))) {
    return 60;
  }
  if (pos.includes("ตรวจ") || pos.includes("inspector") || pos.includes("qc")) {
    return 70;
  }
  if (pos.includes("ปฏิบัติการ") || pos.includes("operator") || pos.includes("ช่าง") || pos.includes("technician") || pos.includes("mechanic")) {
    return 80;
  }
  if (pos.includes("ขับรถ") || pos.includes("driver") || pos.includes("โฟล์คลิฟ") || pos.includes("โฟล์กลิฟ") || pos.includes("forklift") || pos.includes("เครน") || pos.includes("crane") || pos.includes("รถยก")) {
    return 90;
  }
  return null;
}

function getEmployeePositionRank(emp: Employee): number {
  const roleRank = getRoleSeniorityRank(emp.role);
  const textRank = getJobPositionTextRank(emp.jobPosition);

  // If role is explicit (not Other), anchor by role seniority and apply slight refinement for Senior/Lead titles
  if (emp.role && emp.role !== "Other" && roleRank < 100) {
    const posLower = String(emp.jobPosition || "").trim().toLowerCase();
    const hasSeniorKeyword =
      posLower.includes("อาวุโส") ||
      posLower.includes("sr.") ||
      posLower.includes("senior") ||
      posLower.includes("หัวหน้า") ||
      posLower.includes("lead");
    return hasSeniorKeyword ? roleRank - 2 : roleRank;
  }

  if (textRank !== null) {
    return textRank;
  }

  return roleRank;
}

export function EmployeeManagement({
  employees,
  vehicles,
  assignments,
  onUpdateEmployees,
  onUpdateAssignments,
  onNavigateToAssignment,
  onNavigateToVehicles,
  onLogTransaction,
  hideSubTabs = false,
  lockedDepartment,
  groupBy = "department",
}: EmployeeManagementProps) {
  const isPositionMode = groupBy === "position";

  // Search & Filter state
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [filterDepartment, setFilterDepartment] = useState<string>("All");
  const [filterRole, setFilterRole] = useState<string>("All");
  const [filterPosition, setFilterPosition] = useState<string>("All");
  const [filterStatus, setFilterStatus] = useState<string>("All");

  // Sorting state
  const [sortKey, setSortKey] = useState<keyof Employee>(isPositionMode ? "jobPosition" : "employeeId");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Collapsible Group Overrides (Department mode defaults collapsed; Position mode defaults expanded)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Modals state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [assigningVehicleEmployee, setAssigningVehicleEmployee] = useState<Employee | null>(null);

  // Quick photo upload from table row
  const quickPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [quickPhotoTargetEmp, setQuickPhotoTargetEmp] = useState<Employee | null>(null);

  // In-place confirmation state for Deactivation
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);

  // Active Sub-Tab: Employee Registry vs Daily Duty Assignment (Supervisor)
  const [activeSubTab, setActiveSubTab] = useState<"registry" | "daily_duty">("registry");
  const [dailyDuties, setDailyDuties] = useState<MhDailyDutyRecord[]>(() =>
    loadCachedMhDailyDuties()
  );

  useEffect(() => {
    const unsub = subscribeToMhDailyDuties((cloudRecords) => {
      setDailyDuties(cloudRecords);
    });
    return () => unsub();
  }, []);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const todayDate = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Today's Daily Duty lookup by employeeId / employeeName
  const todayDailyDutyMap = useMemo(() => {
    const map = new Map<string, MhDailyDutyRecord>();
    dailyDuties
      .filter((d) => d.workingDate === todayDate)
      .forEach((d) => {
        if (d.employeeId) map.set(d.employeeId.trim().toLowerCase(), d);
        if (d.employeeName) map.set(d.employeeName.trim().toLowerCase(), d);
      });
    return map;
  }, [dailyDuties, todayDate]);

  // Active assignment lookup for drivers on today's working date
  const activeDriverAssignmentMap = useMemo(() => {
    const map = new Map<string, VehicleAssignment>();
    assignments.forEach((a) => {
      if (
        a.workingDate === todayDate &&
        (a.status === "Assigned" || a.status === "In Progress")
      ) {
        map.set(a.driverEmployeeId, a);
        map.set(a.driverId, a);
      }
    });
    return map;
  }, [assignments, todayDate]);

  // Overall assignment count by employee
  const employeeAssignmentCountMap = useMemo(() => {
    const map = new Map<string, number>();
    assignments.forEach((a) => {
      const idKey = a.driverEmployeeId || a.driverId;
      map.set(idKey, (map.get(idKey) || 0) + 1);
    });
    return map;
  }, [assignments]);

  // Employees scoped to lockedDepartment when opened inside a department-specific menu (e.g. Material Handling - Fleet)
  const scopedEmployees = useMemo(
    () =>
      lockedDepartment
        ? employees.filter((e) => matchesLockedDepartment(e.department, lockedDepartment))
        : employees,
    [employees, lockedDepartment]
  );

  // Distinct job positions for filter dropdown
  const availablePositions = useMemo(() => {
    const positionRankMap = new Map<string, number>();
    scopedEmployees.forEach((e) => {
      if (e.jobPosition) {
        const rank = getEmployeePositionRank(e);
        const existing = positionRankMap.get(e.jobPosition);
        if (existing === undefined || rank < existing) {
          positionRankMap.set(e.jobPosition, rank);
        }
      }
    });
    const list = Array.from(positionRankMap.keys());
    if (isPositionMode) {
      return list.sort((a, b) => {
        const rankDiff = (positionRankMap.get(a) ?? 100) - (positionRankMap.get(b) ?? 100);
        if (rankDiff !== 0) return rankDiff;
        return a.localeCompare(b, "th", { numeric: true });
      });
    }
    return list.sort();
  }, [scopedEmployees, isPositionMode]);

  // Distinct departments for filter dropdown
  const availableDepartments = useMemo(() => {
    if (lockedDepartment) {
      return [lockedDepartment];
    }
    const depts = new Set<string>(MASTER_DEPARTMENTS);
    employees.forEach((e) => {
      if (e.department) depts.add(e.department);
    });
    return Array.from(depts).sort();
  }, [employees, lockedDepartment]);

  const hasActiveAdmin = useMemo(
    () =>
      employees.some(
        (e) =>
          e.employmentStatus === "Active" &&
          resolveEmployeeAllowedSections(e).includes("admin_hr")
      ),
    [employees]
  );

  // Workforce KPI Metrics
  const metrics = useMemo(() => {
    const total = scopedEmployees.length;
    const active = scopedEmployees.filter((e) => e.employmentStatus === "Active").length;
    const inactive = scopedEmployees.filter((e) => e.employmentStatus === "Inactive").length;
    const activeDrivers = scopedEmployees.filter((e) => isDriverRole(e.role) && e.employmentStatus === "Active").length;
    const onDutyDriversToday = Array.from(activeDriverAssignmentMap.keys()).length;
    const officersAndSupervisors = scopedEmployees.filter(
      (e) =>
        (e.role === "Officer" ||
          e.role === "Sr.Warehouse Officer" ||
          e.role === "Supervisor" ||
          e.role === "Assistant Manager" ||
          e.role === "Manager") &&
        e.employmentStatus === "Active"
    ).length;

    return {
      total,
      active,
      inactive,
      activeDrivers,
      onDutyDriversToday,
      officersAndSupervisors,
    };
  }, [scopedEmployees, activeDriverAssignmentMap]);

  // Filtered and Sorted employees
  const filteredEmployees = useMemo(() => {
    return scopedEmployees
      .filter((emp) => {
        if (searchKeyword.trim()) {
          const q = searchKeyword.toLowerCase();
          const searchable = [
            emp.employeeId,
            emp.employeeName,
            emp.department,
            emp.jobPosition,
            emp.role,
            emp.phoneNumber,
            emp.notes || "",
          ]
            .join(" ")
            .toLowerCase();

          if (!searchable.includes(q)) return false;
        }

        if (!lockedDepartment && filterDepartment !== "All" && emp.department !== filterDepartment) {
          return false;
        }

        if (filterRole !== "All" && emp.role !== filterRole) {
          return false;
        }

        if (filterPosition !== "All" && emp.jobPosition !== filterPosition) {
          return false;
        }

        if (filterStatus !== "All" && emp.employmentStatus !== filterStatus) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortKey === "jobPosition") {
          const rankDiff = getEmployeePositionRank(a) - getEmployeePositionRank(b);
          if (rankDiff !== 0) return sortOrder === "asc" ? rankDiff : -rankDiff;

          const posA = a.jobPosition?.trim() || a.role || "";
          const posB = b.jobPosition?.trim() || b.role || "";
          const posComp = posA.localeCompare(posB, "th", { numeric: true });
          if (posComp !== 0) return sortOrder === "asc" ? posComp : -posComp;

          return String(a.employeeId ?? "").localeCompare(String(b.employeeId ?? ""), undefined, { numeric: true });
        }

        if (sortKey === "role") {
          const roleDiff = getRoleSeniorityRank(a.role) - getRoleSeniorityRank(b.role);
          if (roleDiff !== 0) return sortOrder === "asc" ? roleDiff : -roleDiff;

          const posComp = String(a.jobPosition ?? "").localeCompare(String(b.jobPosition ?? ""), "th", { numeric: true });
          if (posComp !== 0) return sortOrder === "asc" ? posComp : -posComp;

          return String(a.employeeId ?? "").localeCompare(String(b.employeeId ?? ""), undefined, { numeric: true });
        }

        const valA = a[sortKey] ?? "";
        const valB = b[sortKey] ?? "";
        const comp = String(valA).localeCompare(String(valB), undefined, { numeric: true });
        return sortOrder === "asc" ? comp : -comp;
      });
  }, [scopedEmployees, lockedDepartment, searchKeyword, filterDepartment, filterRole, filterPosition, filterStatus, sortKey, sortOrder]);

  // Group filtered employees by Department / Section OR by Position (Job Position)
  const groupedEmployees = useMemo(() => {
    const groupMap = new Map<string, Employee[]>();
    filteredEmployees.forEach((emp) => {
      const groupKey = isPositionMode
        ? emp.jobPosition?.trim() || emp.role || "ไม่ระบุตำแหน่ง / Unassigned"
        : emp.department?.trim() || "ไม่ระบุแผนก / Unassigned";
      const list = groupMap.get(groupKey);
      if (list) {
        list.push(emp);
      } else {
        groupMap.set(groupKey, [emp]);
      }
    });

    const groups = Array.from(groupMap.entries()).map(([groupKey, list]) => {
      const activeCount = list.filter((e) => e.employmentStatus === "Active").length;
      const inactiveCount = list.length - activeCount;
      const driverCount = list.filter((e) => isDriverRole(e.role)).length;
      const minPositionRank = Math.min(...list.map((e) => getEmployeePositionRank(e)));
      return {
        groupKey,
        groupLabel: groupKey,
        employees: list,
        activeCount,
        inactiveCount,
        driverCount,
        minPositionRank,
      };
    });

    if (isPositionMode) {
      groups.sort((a, b) => {
        const rankDiff = a.minPositionRank - b.minPositionRank;
        if (rankDiff !== 0) {
          return (sortKey === "jobPosition" || sortKey === "role") && sortOrder === "desc"
            ? -rankDiff
            : rankDiff;
        }
        const labelComp = a.groupLabel.localeCompare(b.groupLabel, "th", { numeric: true });
        return (sortKey === "jobPosition" || sortKey === "role") && sortOrder === "desc"
          ? -labelComp
          : labelComp;
      });
    } else {
      groups.sort((a, b) => {
        const comp = a.groupLabel.localeCompare(b.groupLabel, undefined, { numeric: true });
        return sortKey === "department" && sortOrder === "desc" ? -comp : comp;
      });
    }

    return groups;
  }, [filteredEmployees, isPositionMode, sortKey, sortOrder]);

  const isGroupExpanded = (groupKey: string) => expandedGroups[groupKey] ?? isPositionMode;

  const expandedGroupCount = useMemo(
    () => groupedEmployees.filter((g) => expandedGroups[g.groupKey] ?? isPositionMode).length,
    [groupedEmployees, expandedGroups, isPositionMode]
  );

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupKey]: !(prev[groupKey] ?? isPositionMode),
    }));
  };

  const handleExpandAllGroups = () => {
    const next: Record<string, boolean> = {};
    groupedEmployees.forEach((g) => {
      next[g.groupKey] = true;
    });
    setExpandedGroups(next);
  };

  const handleCollapseAllGroups = () => {
    const next: Record<string, boolean> = {};
    groupedEmployees.forEach((g) => {
      next[g.groupKey] = false;
    });
    setExpandedGroups(next);
  };

  // Sort click helper
  const handleSort = (key: keyof Employee) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  // HANDLER: ADD EMPLOYEE
  const handleAddEmployee = (form: {
    employeeId: string;
    employeeName: string;
    department: string;
    jobPosition: string;
    role: EmployeeRole;
    phoneNumber: string;
    employmentStatus: EmploymentStatus;
    allowedSections: WmsSectionId[];
    photoUrl?: string;
    licenseType?: string;
    notes?: string;
  }) => {
    const trimmedId = form.employeeId.trim().toUpperCase();

    const exists = employees.some(
      (e) => e.employeeId.toUpperCase() === trimmedId || e.id.toUpperCase() === trimmedId
    );

    if (exists) {
      return {
        success: false,
        error: `Employee ID "${trimmedId}" is already registered. Employee ID must be unique across the organization.`,
      };
    }

    if (!form.allowedSections || form.allowedSections.length === 0) {
      return {
        success: false,
        error: "กรุณาเลือกส่วนงานที่อนุญาตให้พนักงานเข้าใช้งานอย่างน้อย 1 ส่วนงาน",
      };
    }

    const cleanPhone = form.phoneNumber.trim();
    if (cleanPhone) {
      const phoneDigits = cleanPhone.replace(/[^0-9]/g, "");
      if (phoneDigits.length < 9 || phoneDigits.length > 12) {
        return {
          success: false,
          error: "Please provide a valid phone number with 9 to 11 digits (e.g. 081-456-7890).",
        };
      }
    }

    const now = new Date();
    const timestampStr =
      now.toLocaleDateString("en-CA") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const newEmp: Employee = {
      id: trimmedId,
      employeeId: trimmedId,
      employeeName: form.employeeName.trim(),
      department: lockedDepartment ? lockedDepartment : form.department.trim(),
      jobPosition: form.jobPosition.trim(),
      role: form.role,
      phoneNumber: cleanPhone,
      employmentStatus: form.employmentStatus,
      allowedSections: form.allowedSections,
      photoUrl: form.photoUrl || undefined,
      licenseType: isDriverRole(form.role) ? form.licenseType?.trim() || "Class 2 Industrial Heavy Equipment" : undefined,
      notes: form.notes?.trim() || undefined,
      legacyDriverId: isDriverRole(form.role) ? trimmedId : undefined,
      createdAt: timestampStr,
      updatedAt: timestampStr,
    };

    const updatedList = [newEmp, ...employees];
    onUpdateEmployees(updatedList);
    setShowAddModal(false);
    showToast(`Employee "${newEmp.employeeName}" (${newEmp.employeeId}) registered successfully.`);

    onLogTransaction?.(
      `Registered employee ${newEmp.employeeId} (${newEmp.employeeName} · ${newEmp.role})`,
      newEmp.employeeId,
      "Completed"
    );

    return { success: true };
  };

  // Count active users with admin_hr access so we never lock out Admin & Workforce
  const countOtherActiveAdmins = (excludeEmployeeId: string) =>
    employees.filter(
      (e) =>
        e.employeeId !== excludeEmployeeId &&
        e.employmentStatus === "Active" &&
        resolveEmployeeAllowedSections(e).includes("admin_hr")
    ).length;

  // HANDLER: EDIT EMPLOYEE
  const handleEditEmployee = (form: {
    employeeName: string;
    department: string;
    jobPosition: string;
    role: EmployeeRole;
    phoneNumber: string;
    employmentStatus: EmploymentStatus;
    allowedSections: WmsSectionId[];
    photoUrl?: string;
    licenseType?: string;
    notes?: string;
  }) => {
    if (!editingEmployee) return { success: false, error: "No employee selected for editing." };

    if (!form.allowedSections || form.allowedSections.length === 0) {
      return {
        success: false,
        error: "กรุณาเลือกส่วนงานที่อนุญาตให้พนักงานเข้าใช้งานอย่างน้อย 1 ส่วนงาน",
      };
    }

    const wasActiveAdmin =
      editingEmployee.employmentStatus === "Active" &&
      resolveEmployeeAllowedSections(editingEmployee).includes("admin_hr");
    const willBeActiveAdmin =
      form.employmentStatus === "Active" && form.allowedSections.includes("admin_hr");

    if (wasActiveAdmin && !willBeActiveAdmin && countOtherActiveAdmins(editingEmployee.employeeId) === 0) {
      return {
        success: false,
        error: "ไม่สามารถปิดใช้งานหรือถอดสิทธิ์งานบริหารและกำลังพลจากผู้ดูแลระบบคนสุดท้ายได้",
      };
    }

    const cleanPhone = form.phoneNumber.trim();
    if (cleanPhone) {
      const phoneDigits = cleanPhone.replace(/[^0-9]/g, "");
      if (phoneDigits.length < 9 || phoneDigits.length > 12) {
        return {
          success: false,
          error: "Please provide a valid phone number with 9 to 11 digits (e.g. 081-456-7890).",
        };
      }
    }

    const now = new Date();
    const timestampStr =
      now.toLocaleDateString("en-CA") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const updatedList = employees.map((emp) => {
      if (emp.employeeId === editingEmployee.employeeId) {
        return {
          ...emp,
          employeeName: form.employeeName.trim(),
          department: form.department.trim(),
          jobPosition: form.jobPosition.trim(),
          role: form.role,
          phoneNumber: cleanPhone,
          employmentStatus: form.employmentStatus,
          allowedSections: form.allowedSections,
          photoUrl: form.photoUrl || undefined,
          licenseType: isDriverRole(form.role) ? form.licenseType?.trim() || emp.licenseType : undefined,
          notes: form.notes?.trim() || undefined,
          updatedAt: timestampStr,
        };
      }
      return emp;
    });

    onUpdateEmployees(updatedList);
    setEditingEmployee(null);
    showToast(`Updated employee details for ${editingEmployee.employeeId} (${form.employeeName}).`);

    onLogTransaction?.(
      `Updated profile for employee ${editingEmployee.employeeId} (${form.employeeName})`,
      editingEmployee.employeeId,
      "Completed"
    );

    return { success: true };
  };

  // HANDLER: QUICK PHOTO UPLOAD / UPDATE FOR AN EMPLOYEE
  const handleUpdateEmployeePhoto = (targetEmployee: Employee, newPhotoUrl?: string) => {
    const now = new Date();
    const timestampStr =
      now.toLocaleDateString("en-CA") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const updatedList = employees.map((emp) => {
      if (emp.employeeId === targetEmployee.employeeId) {
        return {
          ...emp,
          photoUrl: newPhotoUrl || undefined,
          updatedAt: timestampStr,
        };
      }
      return emp;
    });

    onUpdateEmployees(updatedList);

    if (viewingEmployee && viewingEmployee.employeeId === targetEmployee.employeeId) {
      setViewingEmployee({
        ...viewingEmployee,
        photoUrl: newPhotoUrl || undefined,
        updatedAt: timestampStr,
      });
    }

    showToast(
      newPhotoUrl
        ? `อัปเดตรูปถ่ายของ ${targetEmployee.employeeName} (${targetEmployee.employeeId}) เรียบร้อยแล้ว`
        : `ลบรูปถ่ายของ ${targetEmployee.employeeName} (${targetEmployee.employeeId}) เรียบร้อยแล้ว`
    );

    onLogTransaction?.(
      `${newPhotoUrl ? "Uploaded" : "Removed"} employee photo for ${targetEmployee.employeeId} (${targetEmployee.employeeName})`,
      targetEmployee.employeeId,
      "Completed"
    );
  };

  const handleTriggerQuickPhotoUpload = (targetEmployee: Employee) => {
    setQuickPhotoTargetEmp(targetEmployee);
    if (quickPhotoInputRef.current) {
      quickPhotoInputRef.current.value = "";
      quickPhotoInputRef.current.click();
    }
  };

  const handleQuickPhotoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !quickPhotoTargetEmp) return;
    try {
      const compressed = await compressEmployeePhoto(file);
      handleUpdateEmployeePhoto(quickPhotoTargetEmp, compressed);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "อัปโหลดรูปภาพไม่สำเร็จ", "error");
    } finally {
      setQuickPhotoTargetEmp(null);
      e.target.value = "";
    }
  };

  // HANDLER: IN-PLACE ACTIVATE / DEACTIVATE
  const handleDirectToggleStatus = (targetEmployee: Employee) => {
    const targetStatus: EmploymentStatus =
      targetEmployee.employmentStatus === "Active" ? "Inactive" : "Active";

    if (
      targetStatus === "Inactive" &&
      resolveEmployeeAllowedSections(targetEmployee).includes("admin_hr") &&
      countOtherActiveAdmins(targetEmployee.employeeId) === 0
    ) {
      setConfirmingDeactivateId(null);
      showToast(
        "ไม่สามารถระงับผู้ดูแลงานบริหารและกำลังพลคนสุดท้ายได้ กรุณาแต่งตั้งผู้ดูแลเพิ่มก่อน",
        "error"
      );
      return;
    }

    const now = new Date();
    const timestampStr =
      now.toLocaleDateString("en-CA") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const updatedList = employees.map((emp) => {
      if (emp.employeeId === targetEmployee.employeeId) {
        return {
          ...emp,
          employmentStatus: targetStatus,
          updatedAt: timestampStr,
        };
      }
      return emp;
    });

    onUpdateEmployees(updatedList);
    setConfirmingDeactivateId(null);

    const actionText = targetStatus === "Active" ? "activated" : "deactivated";
    showToast(`Employee ${targetEmployee.employeeId} (${targetEmployee.employeeName}) has been ${actionText}.`);

    onLogTransaction?.(
      `Employment status changed: ${targetEmployee.employeeId} (${targetEmployee.employeeName}) set to ${targetStatus}`,
      targetEmployee.employeeId,
      targetStatus === "Active" ? "Completed" : "Attention"
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toast Feedback Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9999,
            backgroundColor: toastMessage.type === "success" ? "#1e3a2b" : "#4a1e1e",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: 4,
            boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            borderLeft: `4px solid ${toastMessage.type === "success" ? "#22c55e" : "#ef4444"}`,
          }}
        >
          {toastMessage.type === "success" ? (
            <CheckCircle2 size={18} color="#86efac" />
          ) : (
            <AlertTriangle size={18} color="#fca5a5" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Sub-Navigation Tabs: Registry vs Daily Duty Assignment */}
      {!hideSubTabs && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-[#1e3a5f]">
          <div
            role="tablist"
            aria-label="Employee Management Views"
            className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0c162c]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === "registry"}
              onClick={() => setActiveSubTab("registry")}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-bold whitespace-nowrap shrink-0 transition ${
                activeSubTab === "registry"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-[#162544] dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <Users size={14} className={activeSubTab === "registry" ? "text-cyan-600 dark:text-cyan-400" : ""} />
              <span>ทำเนียบพนักงาน (Employee Registry)</span>
              <span className="font-mono text-[11px] font-semibold opacity-70 tabular-nums">
                · {scopedEmployees.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === "daily_duty"}
              onClick={() => setActiveSubTab("daily_duty")}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-bold whitespace-nowrap shrink-0 transition ${
                activeSubTab === "daily_duty"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-[#162544] dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <ClipboardList size={14} className={activeSubTab === "daily_duty" ? "text-indigo-600 dark:text-indigo-400" : ""} />
              <span>มอบหมายงานประจำวัน (หัวหน้างาน)</span>
              <span className="font-mono text-[11px] font-semibold opacity-75 tabular-nums">
                · วันนี้ {dailyDuties.filter((d) => d.workingDate === todayDate).length} คน
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>วันที่ปัจจุบัน:</span>
            <span className="font-mono font-semibold text-slate-700 tabular-nums dark:text-slate-200">
              {todayDate}
            </span>
          </div>
        </div>
      )}

      {!hideSubTabs && activeSubTab === "daily_duty" ? (
        <DailyDutyAssignmentPanel
          employees={employees}
          vehicles={vehicles}
          duties={dailyDuties}
          onDutiesChange={setDailyDuties}
          defaultDate={todayDate}
        />
      ) : (
        <>
      {!hasActiveAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>ยังไม่มีพนักงานที่มีสิทธิ์เข้าเมนู งานบริหารและกำลังพล (Admin & HR):</strong>{" "}
              ทะเบียนพนักงานนี้ใช้ฐานข้อมูลเดียวกับหน้างานบริหารและกำลังพล คุณสามารถกดแก้ไขพนักงานหรือเพิ่มพนักงานใหม่แล้วเลือกสิทธิ์ <strong>บริหาร/กำลังพล</strong> (หรือตำแหน่ง Manager / Supervisor) เพื่อปลดล็อกได้ทันที
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-700"
          >
            <Plus size={14} />
            <span>เพิ่มพนักงาน / ผู้ดูแล</span>
          </button>
        </div>
      )}

      {/* Workforce Summary KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total Employees</div>
          <div className="kpi-value">{metrics.total}</div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Active Workforce</div>
          <div className="kpi-value" style={{ color: "#15803d" }}>
            {metrics.active}
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Eligible Drivers</div>
          <div className="kpi-value" style={{ color: "#0369a1" }}>
            {metrics.activeDrivers}
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Officers & Supervisors</div>
          <div className="kpi-value">{metrics.officersAndSupervisors}</div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Inactive / On Leave</div>
          <div className="kpi-value" style={{ color: metrics.inactive > 0 ? "#b45309" : "#64748b" }}>
            {metrics.inactive}
          </div>
        </div>
      </div>

      {/* Main Employee Registry Panel */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Employee Registry & Operational Roles</div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {groupedEmployees.length > 0 && (
              <>
                <button
                  type="button"
                  className="button secondary"
                  onClick={handleExpandAllGroups}
                  disabled={expandedGroupCount === groupedEmployees.length}
                  style={{ fontSize: 11, padding: "5px 10px" }}
                  title={isPositionMode ? "ขยายทุกตำแหน่ง" : "ขยายทุกแผนก"}
                >
                  <ChevronDown size={13} />
                  ขยายทั้งหมด
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={handleCollapseAllGroups}
                  disabled={expandedGroupCount === 0}
                  style={{ fontSize: 11, padding: "5px 10px" }}
                  title={isPositionMode ? "ย่อทุกตำแหน่ง" : "ย่อทุกแผนก"}
                >
                  <ChevronRight size={13} />
                  ย่อทั้งหมด
                </button>
              </>
            )}
            <button
              className="button"
              onClick={() => setShowAddModal(true)}
              style={{ fontWeight: 600 }}
            >
              <Plus size={14} />
              + Add Employee
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="filterbar" style={{ padding: "12px 18px", gap: 10, flexWrap: "wrap" }}>
          {/* Search box */}
          <div
            style={{
              position: "relative",
              flex: 2,
              minWidth: "220px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Search size={14} style={{ position: "absolute", left: 10, color: "#82919c" }} />
            <input
              className="field search-field"
              style={{ paddingLeft: 30 }}
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
              }}
              placeholder="Search by Employee ID, name, position, phone..."
              aria-label="Search employees"
            />
          </div>

          {/* Department Filter */}
          {lockedDepartment ? (
            <select
              className="field"
              style={{ flex: 1, minWidth: "160px", opacity: 0.9 }}
              value={lockedDepartment}
              disabled
              aria-label="Locked Department"
              title={`แสดงเฉพาะส่วนงาน ${lockedDepartment}`}
            >
              <option value={lockedDepartment}>{lockedDepartment}</option>
            </select>
          ) : (
            <select
              className="field"
              style={{ flex: 1, minWidth: "160px" }}
              value={filterDepartment}
              onChange={(e) => {
                setFilterDepartment(e.target.value);
              }}
              aria-label="Filter Department"
              title="Filter by Department"
            >
              <option value="All">All Departments</option>
              {availableDepartments.map((dept) => (
                <option value={dept} key={dept}>
                  {dept}
                </option>
              ))}
            </select>
          )}

          {/* Role Filter */}
          <select
            className="field"
            style={{ flex: 1, minWidth: "130px" }}
            value={filterRole}
            onChange={(e) => {
              setFilterRole(e.target.value);
            }}
            aria-label="Filter Role"
            title="Filter by Employee Role"
          >
            <option value="All">All Roles</option>
            {EMPLOYEE_ROLES.map((r) => (
              <option value={r} key={r}>
                {r}
              </option>
            ))}
          </select>

          {/* Position Filter */}
          <select
            className="field"
            style={{ flex: 1, minWidth: "150px" }}
            value={filterPosition}
            onChange={(e) => {
              setFilterPosition(e.target.value);
            }}
            aria-label="Filter Job Position"
            title="Filter by Job Position"
          >
            <option value="All">All Positions</option>
            {availablePositions.map((pos) => (
              <option value={pos} key={pos}>
                {pos}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            className="field"
            style={{ flex: 1, minWidth: "120px" }}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
            }}
            aria-label="Filter Status"
            title="Filter by Employment Status"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Inactive">Inactive Only</option>
          </select>

          {/* Reset Filters */}
          <button
            className="button secondary"
            onClick={() => {
              setSearchKeyword("");
              setFilterDepartment("All");
              setFilterRole("All");
              setFilterPosition("All");
              setFilterStatus("All");
            }}
            title="Reset all filters"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>

        {/* Hidden File Input for Quick Photo Upload from Table */}
        <input
          ref={quickPhotoInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleQuickPhotoFileSelected}
        />

        {/* Data Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 45 }}>No.</th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("employeeId")}
                  >
                    Employee ID {sortKey === "employeeId" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("employeeName")}
                  >
                    Employee Name & Photo {sortKey === "employeeName" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("department")}
                  >
                    Department / Section {sortKey === "department" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("jobPosition")}
                  >
                    Job Position {sortKey === "jobPosition" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("role")}
                  >
                    Employee Role {sortKey === "role" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th>Phone Number</th>
                <th>Assigned Vehicle (Today)</th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => handleSort("employmentStatus")}
                  >
                    Employment Status {sortKey === "employmentStatus" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th style={{ textAlign: "right", paddingRight: 20 }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {groupedEmployees.map((group) => {
                const isExpanded = isGroupExpanded(group.groupKey);

                return (
                  <React.Fragment key={group.groupKey}>
                    {/* Collapsible Group Header Row (Department or Job Position) */}
                    <tr
                      onClick={() => toggleGroup(group.groupKey)}
                      className="cursor-pointer select-none bg-slate-100/90 hover:bg-slate-200/75 dark:bg-slate-800/80 dark:hover:bg-slate-800 border-y border-slate-200 dark:border-slate-700 transition-colors"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleGroup(group.groupKey);
                        }
                      }}
                    >
                      <td colSpan={10} className="!py-2.5 !px-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                                isExpanded
                                  ? "bg-sky-600 text-white border-sky-600 dark:bg-sky-500 dark:border-sky-500"
                                  : "bg-white text-slate-600 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-600"
                              }`}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                            {isPositionMode ? (
                              <Briefcase size={15} className="text-sky-600 dark:text-sky-400 shrink-0" />
                            ) : (
                              <Building size={15} className="text-sky-600 dark:text-sky-400 shrink-0" />
                            )}
                            <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                              {group.groupLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800 whitespace-nowrap">
                              {group.employees.length} คน
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="px-2 py-0.5 rounded-md font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/80 whitespace-nowrap">
                              Active: {group.activeCount}
                            </span>
                            {group.driverCount > 0 && (
                              <span className="px-2 py-0.5 rounded-md font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/80 whitespace-nowrap">
                                Driver: {group.driverCount}
                              </span>
                            )}
                            {group.inactiveCount > 0 && (
                              <span className="px-2 py-0.5 rounded-md font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/80 whitespace-nowrap">
                                Inactive: {group.inactiveCount}
                              </span>
                            )}
                            <span className="hidden sm:inline text-[10.5px] font-medium text-slate-500 dark:text-slate-400 ml-1">
                              {isExpanded ? "คลิกเพื่อย่อ" : "คลิกเพื่อขยาย"}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>

                    {isExpanded &&
                      group.employees.map((emp, index) => {
                        const isInactive = emp.employmentStatus === "Inactive";
                        const todayAssignment = activeDriverAssignmentMap.get(emp.employeeId);
                        const todayDuty =
                          todayDailyDutyMap.get(emp.employeeId.trim().toLowerCase()) ||
                          todayDailyDutyMap.get(emp.employeeName.trim().toLowerCase());
                        const rowNumber = index + 1;
                        const isConfirming = confirmingDeactivateId === emp.employeeId;

                        return (
                          <tr
                            key={emp.employeeId}
                            style={{
                              opacity: isInactive ? 0.75 : 1,
                            }}
                          >
                    <td className="emp-row-num">{rowNumber}</td>

                    <td>
                      <span className="code" style={{ fontSize: 12 }}>
                        {emp.employeeId}
                      </span>
                    </td>

                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button
                          type="button"
                          onClick={() => handleTriggerQuickPhotoUpload(emp)}
                          title="คลิกเพื่ออัปโหลดหรือเปลี่ยนรูปถ่ายพนักงาน"
                          className="group relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-sky-600 text-xs font-bold text-white shadow-xs transition hover:ring-2 hover:ring-sky-500 dark:border-slate-700"
                        >
                          {emp.photoUrl ? (
                            <img
                              src={emp.photoUrl}
                              alt={emp.employeeName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span>{emp.employeeName.trim().charAt(0).toUpperCase() || "E"}</span>
                          )}
                          <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                            <Camera size={14} className="text-white" />
                          </span>
                        </button>

                        <div className="min-w-0">
                          <div className="emp-name">{emp.employeeName}</div>
                          {todayDuty && (
                            <div style={{ fontSize: 10, color: "#0369a1", marginTop: 2, fontWeight: 600 }}>
                              {todayDuty.team} · {todayDuty.shift} · {todayDuty.workArea}
                              {todayDuty.vehicleNumber && todayDuty.vehicleNumber !== "-"
                                ? ` · รถ ${todayDuty.vehicleNumber}`
                                : ""}
                            </div>
                          )}
                          {!todayDuty && isDriverRole(emp.role) && todayAssignment && (
                            <div
                              style={{
                                fontSize: 10,
                                color: "#0369a1",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 2,
                              }}
                            >
                              <Truck size={10} />
                              On Duty Today: <strong>{todayAssignment.vehicleNumber}</strong> ({todayAssignment.status})
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td>
                      <div className="emp-dept">{emp.department}</div>
                      <div style={{ fontSize: 10, color: "#0284c7", marginTop: 2, fontWeight: 600 }}>
                        สิทธิ์:{" "}
                        {resolveEmployeeAllowedSections(emp)
                          .map((sid) => getSectionMeta(sid).shortLabelTh)
                          .join(" · ")}
                      </div>
                    </td>

                    <td>
                      <div className="emp-pos">
                        {emp.jobPosition || <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>}
                      </div>
                      {emp.licenseType && (
                        <div style={{ fontSize: 10, color: "#8a9ba8" }}>
                          {emp.licenseType}
                        </div>
                      )}
                    </td>

                    <td>
                      <RoleBadge role={emp.role} />
                    </td>

                    <td>
                      {emp.phoneNumber ? (
                        <span className="emp-phone">{emp.phoneNumber}</span>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
                      )}
                    </td>

                    <td>
                      {todayDuty ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className="status status-inuse" style={{ padding: "2px 6px", fontSize: 11, fontWeight: 700 }}>
                            <Truck size={11} />
                            {todayDuty.vehicleNumber && todayDuty.vehicleNumber !== "-"
                              ? todayDuty.vehicleNumber
                              : "ไม่ระบุรถ"}
                          </span>
                          <span style={{ fontSize: 10, color: "#64748b" }}>
                            {todayDuty.team} | {todayDuty.shift} | {todayDuty.workArea}
                          </span>
                        </div>
                      ) : isDriverRole(emp.role) ? (
                        todayAssignment ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span className="status status-inuse" style={{ padding: "2px 6px", fontSize: 11, fontWeight: 700 }}>
                              <Truck size={11} />
                              {todayAssignment.vehicleNumber}
                            </span>
                            <span style={{ fontSize: 10, color: "#8a9ba8" }}>
                              {todayAssignment.status} ({todayAssignment.workingDate})
                            </span>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>Unassigned</span>
                          </div>
                        )
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>N/A (Staff)</span>
                      )}
                    </td>

                    <td>
                      <EmploymentStatusBadge status={emp.employmentStatus} />
                    </td>

                    <td style={{ textAlign: "right", paddingRight: 16 }}>
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        {/* View Details */}
                        <button
                          className="button secondary"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => setViewingEmployee(emp)}
                          title="View Employee Profile"
                        >
                          <Eye size={12} />
                          View
                        </button>

                        {/* Edit Employee */}
                        <button
                          className="button secondary"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => setEditingEmployee(emp)}
                          title="Edit Employee Information"
                        >
                          <Edit3 size={12} />
                          Edit
                        </button>

                        {/* In-place Activate / Deactivate Toggle */}
                        <button
                          className={
                            isInactive
                              ? "button secondary"
                              : isConfirming
                              ? "button danger"
                              : "button secondary"
                          }
                          style={{
                            padding: "4px 8px",
                            fontSize: 11,
                            borderColor: isInactive
                              ? "#86efac"
                              : isConfirming
                              ? "#dc2626"
                              : "#fca5a5",
                            color: isInactive
                              ? "#15803d"
                              : isConfirming
                              ? "#ffffff"
                              : "#b91c1c",
                            background: isInactive
                              ? undefined
                              : isConfirming
                              ? "#dc2626"
                              : undefined,
                          }}
                          onClick={() => {
                            if (isInactive) {
                              handleDirectToggleStatus(emp);
                            } else {
                              if (isConfirming) {
                                handleDirectToggleStatus(emp);
                              } else {
                                setConfirmingDeactivateId(emp.employeeId);
                                setTimeout(() => setConfirmingDeactivateId((prev) => (prev === emp.employeeId ? null : prev)), 4000);
                              }
                            }
                          }}
                          title={
                            isInactive
                              ? "Activate employee"
                              : "Deactivate employee"
                          }
                        >
                          <Power size={11} />
                          {isInactive
                            ? "Activate"
                            : isConfirming
                            ? "Confirm Deactivation?"
                            : "Deactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                        );
                      })}
                  </React.Fragment>
                );
              })}

              {filteredEmployees.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <div className="empty" style={{ padding: "36px 20px" }}>
                      <UserX size={32} color="#94a3b8" style={{ marginBottom: 8 }} />
                      <div style={{ fontWeight: 600 }}>
                        No employee records found
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Grouped Summary Footer */}
        <div
          className="border-t border-slate-200 dark:border-slate-700/80 text-slate-500 dark:text-slate-400"
          style={{
            padding: "12px 18px",
            fontSize: 11,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            {isPositionMode ? "จัดกลุ่มและเรียงตามตำแหน่ง (Job Position): " : "จัดกลุ่มตาม Department / Section: "}
            <strong className="text-slate-800 dark:text-slate-100">
              {groupedEmployees.length}
            </strong>{" "}
            {isPositionMode ? "ตำแหน่ง" : "แผนก"} · แสดง{" "}
            <strong className="text-slate-800 dark:text-slate-100">
              {filteredEmployees.length}
            </strong>{" "}
            คน (Total: {scopedEmployees.length})
          </div>

          <div className="text-[11px] font-medium">
            กำลังขยาย{" "}
            <strong className="text-slate-800 dark:text-slate-100">
              {expandedGroupCount} / {groupedEmployees.length}
            </strong>{" "}
            {isPositionMode ? "ตำแหน่ง" : "แผนก"}
          </div>
        </div>
      </section>
      </>
      )}

      {/* MODAL: ADD EMPLOYEE */}
      {showAddModal && (
        <AddEmployeeModal
          existingCount={employees.length}
          departments={availableDepartments}
          onClose={() => setShowAddModal(false)}
          onSave={handleAddEmployee}
        />
      )}

      {/* MODAL: EDIT EMPLOYEE */}
      {editingEmployee && (
        <EditEmployeeModal
          employee={editingEmployee}
          departments={availableDepartments}
          onClose={() => setEditingEmployee(null)}
          onSave={handleEditEmployee}
        />
      )}

      {/* MODAL: VIEW EMPLOYEE DETAILS */}
      {viewingEmployee && (
        <ViewEmployeeDetailsModal
          employee={viewingEmployee}
          activeAssignment={activeDriverAssignmentMap.get(viewingEmployee.employeeId)}
          assignmentCount={employeeAssignmentCountMap.get(viewingEmployee.employeeId) || 0}
          onClose={() => setViewingEmployee(null)}
          onUpdatePhoto={(newPhotoUrl) => handleUpdateEmployeePhoto(viewingEmployee, newPhotoUrl)}
          onEdit={() => {
            const target = viewingEmployee;
            setViewingEmployee(null);
            setEditingEmployee(target);
          }}
        />
      )}
    </div>
  );
}

// ROLE BADGE COMPONENT
function RoleBadge({ role }: { role: EmployeeRole }) {
  switch (role) {
    case "Sr.Forklift Driver":
    case "Forklift Driver":
    case "Tractor Driver":
    case "Driver":
      return <span className="status status-inuse">{role}</span>;
    case "Technical Service Forklift":
      return <span className="status status-maintenance">{role}</span>;
    case "Officer":
    case "Sr.Warehouse Officer":
      return <span className="status status-officer">{role}</span>;
    case "Inspector":
    case "Sr.Inspector":
      return <span className="status status-maintenance">{role}</span>;
    case "Supervisor":
    case "Assistant Manager":
    case "Manager":
      return <span className="status status-manager">{role}</span>;
    default:
      return <span className="status">{role}</span>;
  }
}

// EMPLOYMENT STATUS BADGE
function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  if (status === "Active") {
    return (
      <span className="status status-active">
        <span className="dot dot-active" />
        Active
      </span>
    );
  }

  return (
    <span className="status status-inactive">
      <span className="dot dot-inactive" />
      Inactive
    </span>
  );
}

// REUSABLE EMPLOYEE PHOTO PICKER COMPONENT
function EmployeePhotoPicker({
  photoUrl,
  employeeName,
  onChangePhoto,
  onError,
}: {
  photoUrl?: string;
  employeeName: string;
  onChangePhoto: (newPhotoUrl?: string) => void;
  onError?: (errText: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const compressed = await compressEmployeePhoto(file);
      onChangePhoto(compressed);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "อัปโหลดรูปภาพไม่สำเร็จ");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="คลิกเพื่อเลือกรูปถ่ายพนักงาน"
          className="group relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-sky-500/50 bg-sky-600 text-lg font-bold text-white shadow-sm transition hover:border-sky-500"
        >
          {photoUrl ? (
            <img src={photoUrl} alt={employeeName || "Employee"} className="h-full w-full object-cover" />
          ) : (
            <span>{(employeeName || "E").trim().charAt(0).toUpperCase() || "E"}</span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size={18} className="text-white" />
          </span>
        </button>

        <div>
          <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
            รูปถ่ายพนักงาน (Employee Photo)
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            รองรับไฟล์ JPG, PNG, WEBP ระบบจะปรับขนาดอัตโนมัติ
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-sky-700 disabled:opacity-50"
        >
          <Upload size={13} />
          <span>{isUploading ? "กำลังประมวลผล..." : photoUrl ? "เปลี่ยนรูปถ่าย" : "อัปโหลดรูปถ่าย"}</span>
        </button>

        {photoUrl && (
          <button
            type="button"
            onClick={() => onChangePhoto(undefined)}
            className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-300"
            title="ลบรูปถ่ายพนักงาน"
          >
            <Trash2 size={13} />
            <span>ลบรูป</span>
          </button>
        )}
      </div>
    </div>
  );
}

// MODAL: ADD EMPLOYEE
function AddEmployeeModal({
  existingCount,
  departments,
  onClose,
  onSave,
}: {
  existingCount: number;
  departments: string[];
  onClose: () => void;
  onSave: (form: {
    employeeId: string;
    employeeName: string;
    department: string;
    jobPosition: string;
    role: EmployeeRole;
    phoneNumber: string;
    employmentStatus: EmploymentStatus;
    allowedSections: WmsSectionId[];
    photoUrl?: string;
    licenseType?: string;
    notes?: string;
  }) => { success: boolean; error?: string };
}) {
  const defaultDept = departments[0] || "Material Handling - Fleet";
  const [employeeId, setEmployeeId] = useState<string>("");
  const [employeeName, setEmployeeName] = useState<string>("");
  const [department, setDepartment] = useState<string>(defaultDept);
  const [jobPosition, setJobPosition] = useState<string>("");
  const [role, setRole] = useState<EmployeeRole>("Forklift Driver");
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>("Active");
  const [allowedSections, setAllowedSections] = useState<WmsSectionId[]>(() =>
    getDefaultSectionsForRoleAndDept("Forklift Driver", defaultDept)
  );
  const [hasCustomizedSections, setHasCustomizedSections] = useState<boolean>(false);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [licenseType, setLicenseType] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleToggleSection = (secId: WmsSectionId) => {
    setHasCustomizedSections(true);
    setAllowedSections((prev) =>
      prev.includes(secId) ? prev.filter((id) => id !== secId) : [...prev, secId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!employeeId.trim()) {
      setErrorMessage("Employee ID is required and must be unique.");
      return;
    }
    if (!employeeName.trim()) {
      setErrorMessage("Employee Name is required.");
      return;
    }
    if (allowedSections.length === 0) {
      setErrorMessage("กรุณาเลือกส่วนงานที่อนุญาตให้เข้าใช้งานอย่างน้อย 1 ส่วนงาน");
      return;
    }

    const res = onSave({
      employeeId: employeeId.trim().toUpperCase(),
      employeeName: employeeName.trim(),
      department: department.trim(),
      jobPosition: jobPosition.trim(),
      role,
      phoneNumber: phoneNumber.trim(),
      employmentStatus,
      allowedSections,
      photoUrl,
      licenseType: isDriverRole(role) ? licenseType : undefined,
      notes: notes.trim() || undefined,
    });

    if (!res.success && res.error) {
      setErrorMessage(res.error);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal vehicle-modal-card"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="panel-header vehicle-modal-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Add New Employee</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: 0,
              color: "#64748b",
              cursor: "pointer",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && (
            <div className="modal-error">
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>Validation Error:</strong> {errorMessage}
              </div>
            </div>
          )}

          {/* Employee Photo Upload */}
          <EmployeePhotoPicker
            photoUrl={photoUrl}
            employeeName={employeeName}
            onChangePhoto={setPhotoUrl}
            onError={setErrorMessage}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <label className="form-field">
              Employee ID *
              <input
                className="field"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="e.g. EMP-101"
                required
                autoFocus
              />
            </label>

            <label className="form-field">
              Employee Full Name *
              <input
                className="field"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="e.g. Wichai Srisuk"
                required
              />
            </label>
          </div>

          {/* Department / Section */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Department / Section *
              </span>
              <span className="truncate text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                {department}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {departments.map((dept) => {
                const checked = department === dept;
                return (
                  <label
                    key={dept}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
                      checked
                        ? "border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
                        : "border-slate-200 bg-white text-slate-600 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setDepartment(dept);
                        if (!hasCustomizedSections) {
                          setAllowedSections(getDefaultSectionsForRoleAndDept(role, dept));
                        }
                      }}
                      className="h-3.5 w-3.5 shrink-0 accent-sky-600"
                    />
                    <span className="truncate font-semibold">{dept}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Operational Role */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Operational Role *
              </span>
              <span className="truncate text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                {role}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {EMPLOYEE_ROLES.map((r) => {
                const checked = role === r;
                return (
                  <label
                    key={r}
                    title={r}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
                      checked
                        ? "border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
                        : "border-slate-200 bg-white text-slate-600 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setRole(r);
                        if (!hasCustomizedSections) {
                          setAllowedSections(getDefaultSectionsForRoleAndDept(r, department));
                        }
                      }}
                      className="h-3.5 w-3.5 shrink-0 accent-sky-600"
                    />
                    <span className="truncate font-semibold">{r}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Job Position
              <input
                className="field"
                value={jobPosition}
                onChange={(e) => setJobPosition(e.target.value)}
                placeholder="e.g. Forklift Operator, Logistics Officer (ไม่บังคับ)"
              />
            </label>

            <label className="form-field">
              Phone Number
              <input
                className="field"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. 081-234-5678"
              />
            </label>
          </div>

          {/* Section Access Permissions */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                สิทธิ์การเข้าใช้งานส่วนงาน (Login & Menu Permissions) *
              </span>
              <button
                type="button"
                onClick={() => {
                  setHasCustomizedSections(false);
                  setAllowedSections(getDefaultSectionsForRoleAndDept(role, department));
                }}
                className="text-[11px] font-semibold text-sky-600 hover:underline dark:text-sky-400"
              >
                รีเซ็ตตามแผนก/ตำแหน่ง
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {WMS_SECTIONS.map((sec) => {
                const checked = allowedSections.includes(sec.id);
                return (
                  <label
                    key={sec.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
                      checked
                        ? "border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
                        : "border-slate-200 bg-white text-slate-600 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleSection(sec.id)}
                      className="h-3.5 w-3.5 accent-sky-600"
                    />
                    <span className="truncate font-semibold">{sec.shortLabelTh}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {isDriverRole(role) && (
            <label className="form-field">
              Industrial Equipment Driver License
              <input
                className="field"
                value={licenseType}
                onChange={(e) => setLicenseType(e.target.value)}
                placeholder="e.g. Class 2 Industrial Heavy Equipment"
              />
            </label>
          )}

          <label className="form-field">
            Employment Status *
            <select
              className="field"
              value={employmentStatus}
              onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
              required
            >
              <option value="Active">Active (Eligible for assignment)</option>
              <option value="Inactive">Inactive (Restricted from assignment)</option>
            </select>
          </label>

          <label className="form-field">
            Notes
            <textarea
              className="field"
              style={{ minHeight: 60, resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Shift preference, certifications..."
            />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button">
            Save Employee
          </button>
        </div>
      </form>
    </div>
  );
}

// MODAL: EDIT EMPLOYEE
function EditEmployeeModal({
  employee,
  departments,
  onClose,
  onSave,
}: {
  employee: Employee;
  departments: string[];
  onClose: () => void;
  onSave: (form: {
    employeeName: string;
    department: string;
    jobPosition: string;
    role: EmployeeRole;
    phoneNumber: string;
    employmentStatus: EmploymentStatus;
    allowedSections: WmsSectionId[];
    photoUrl?: string;
    licenseType?: string;
    notes?: string;
  }) => { success: boolean; error?: string };
}) {
  const [employeeName, setEmployeeName] = useState<string>(employee.employeeName);
  const [department, setDepartment] = useState<string>(employee.department);
  const [jobPosition, setJobPosition] = useState<string>(employee.jobPosition);
  const [role, setRole] = useState<EmployeeRole>(() =>
    EMPLOYEE_ROLES.includes(employee.role) ? employee.role : "Forklift Driver"
  );
  const [phoneNumber, setPhoneNumber] = useState<string>(employee.phoneNumber || "");
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>(employee.employmentStatus);
  const [allowedSections, setAllowedSections] = useState<WmsSectionId[]>(() =>
    resolveEmployeeAllowedSections(employee)
  );
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(employee.photoUrl);
  const [licenseType, setLicenseType] = useState<string>(employee.licenseType || "Class 2 Industrial Heavy Equipment");
  const [notes, setNotes] = useState<string>(employee.notes || "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleToggleSection = (secId: WmsSectionId) => {
    setAllowedSections((prev) =>
      prev.includes(secId) ? prev.filter((id) => id !== secId) : [...prev, secId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!employeeName.trim()) {
      setErrorMessage("Employee Name is required.");
      return;
    }
    if (allowedSections.length === 0) {
      setErrorMessage("กรุณาเลือกส่วนงานที่อนุญาตให้เข้าใช้งานอย่างน้อย 1 ส่วนงาน");
      return;
    }

    const res = onSave({
      employeeName: employeeName.trim(),
      department: department.trim(),
      jobPosition: jobPosition.trim(),
      role,
      phoneNumber: phoneNumber.trim(),
      employmentStatus,
      allowedSections,
      photoUrl,
      licenseType: isDriverRole(role) ? licenseType : undefined,
      notes: notes.trim() || undefined,
    });

    if (!res.success && res.error) {
      setErrorMessage(res.error);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal vehicle-modal-card"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="panel-header vehicle-modal-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Edit Employee: {employee.employeeId}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: 0,
              color: "#64748b",
              cursor: "pointer",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && (
            <div className="modal-error">
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>Validation Error:</strong> {errorMessage}
              </div>
            </div>
          )}

          {/* Employee Photo Upload */}
          <EmployeePhotoPicker
            photoUrl={photoUrl}
            employeeName={employeeName}
            onChangePhoto={setPhotoUrl}
            onError={setErrorMessage}
          />

          <div
            className="vehicle-info-box"
            style={{
              padding: "10px 14px",
              borderRadius: 4,
              border: "1px solid #e2e8f0",
              fontSize: 11,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <div>Employee ID: <strong>{employee.employeeId}</strong></div>
            <div>Active Status: <strong>{employee.employmentStatus}</strong></div>
            <div>Current Role: <strong>{employee.role}</strong></div>
            <div>Registered: <strong>{employee.createdAt || "N/A"}</strong></div>
          </div>

          <label className="form-field">
            Employee Full Name *
            <input
              className="field"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              required
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Department / Section *
              <select
                className="field"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                required
              >
                {departments.map((dept) => (
                  <option value={dept} key={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              Operational Role *
              <select
                className="field"
                value={role}
                onChange={(e) => setRole(e.target.value as EmployeeRole)}
                required
              >
                {EMPLOYEE_ROLES.map((r) => (
                  <option value={r} key={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Job Position
              <input
                className="field"
                value={jobPosition}
                onChange={(e) => setJobPosition(e.target.value)}
                placeholder="ไม่บังคับ"
              />
            </label>

            <label className="form-field">
              Phone Number
              <input
                className="field"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </label>
          </div>

          {isDriverRole(role) && (
            <label className="form-field">
              Industrial Equipment License
              <input
                className="field"
                value={licenseType}
                onChange={(e) => setLicenseType(e.target.value)}
              />
            </label>
          )}

          <label className="form-field">
            Employment Status *
            <select
              className="field"
              value={employmentStatus}
              onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
              required
            >
              <option value="Active">Active (Eligible for assignment)</option>
              <option value="Inactive">Inactive (Restricted from assignment)</option>
            </select>
          </label>

          {/* Section Access Permissions */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#1e3a5f] dark:bg-[#0c162c]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                สิทธิ์การเข้าใช้งานส่วนงาน (Login & Menu Permissions) *
              </span>
              <button
                type="button"
                onClick={() =>
                  setAllowedSections(getDefaultSectionsForRoleAndDept(role, department))
                }
                className="text-[11px] font-semibold text-sky-600 hover:underline dark:text-sky-400"
              >
                ตั้งค่าตามแผนก/ตำแหน่ง
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {WMS_SECTIONS.map((sec) => {
                const checked = allowedSections.includes(sec.id);
                return (
                  <label
                    key={sec.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
                      checked
                        ? "border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100"
                        : "border-slate-200 bg-white text-slate-600 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleSection(sec.id)}
                      className="h-3.5 w-3.5 accent-sky-600"
                    />
                    <span className="truncate font-semibold">{sec.shortLabelTh}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <label className="form-field">
            Notes
            <textarea
              className="field"
              style={{ minHeight: 60, resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button">
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}

// MODAL: VIEW EMPLOYEE DETAILS
function ViewEmployeeDetailsModal({
  employee,
  activeAssignment,
  assignmentCount,
  onClose,
  onUpdatePhoto,
  onEdit,
}: {
  employee: Employee;
  activeAssignment?: VehicleAssignment;
  assignmentCount: number;
  onClose: () => void;
  onUpdatePhoto: (newPhotoUrl?: string) => void;
  onEdit: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressEmployeePhoto(file);
      onUpdatePhoto(compressed);
    } catch {
      // handled by parent or ignored
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal vehicle-modal-card"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)" }}
      >
        <div className="panel-header vehicle-modal-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Employee Profile Inspection</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: 0,
              color: "#64748b",
              cursor: "pointer",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Header Card */}
          <div
            className="vehicle-info-box"
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: "14px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="คลิกเพื่ออัปโหลดหรือเปลี่ยนรูปถ่ายพนักงาน"
                className="group relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-sky-500/60 bg-sky-600 text-lg font-bold text-white shadow-sm transition hover:border-sky-500"
              >
                {employee.photoUrl ? (
                  <img
                    src={employee.photoUrl}
                    alt={employee.employeeName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{employee.employeeName.charAt(0)}</span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera size={18} className="text-white" />
                </span>
              </button>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {employee.employeeName}
                </div>
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  {employee.jobPosition ? `${employee.jobPosition} · ` : ""}ID: {employee.employeeId}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-sky-700"
                  >
                    <Camera size={11} />
                    <span>{employee.photoUrl ? "เปลี่ยนรูปถ่าย" : "อัปโหลดรูปถ่าย"}</span>
                  </button>
                  {employee.photoUrl && (
                    <button
                      type="button"
                      onClick={() => onUpdatePhoto(undefined)}
                      className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                    >
                      <Trash2 size={10} />
                      <span>ลบรูป</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <RoleBadge role={employee.role} />
              <EmploymentStatusBadge status={employee.employmentStatus} />
            </div>
          </div>

          {/* Details Grid */}
          <div
            className="vehicle-spec-box"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px 14px",
              fontSize: 12,
              padding: "12px 14px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
            }}
          >
            <div>
              <span>Department:</span>
              <div style={{ fontWeight: 600, marginTop: 2 }}>
                {employee.department}
              </div>
            </div>

            <div>
              <span>Phone Number:</span>
              <div style={{ fontWeight: 600, marginTop: 2 }}>
                {employee.phoneNumber || "Not provided"}
              </div>
            </div>

            {isDriverRole(employee.role) && (
              <div style={{ gridColumn: "span 2" }}>
                <span>Industrial License:</span>
                <div style={{ fontWeight: 600, marginTop: 2 }}>
                  {employee.licenseType || "Class 2 Industrial Heavy Equipment"}
                </div>
              </div>
            )}

            <div>
              <span>Record Created:</span>
              <div style={{ marginTop: 2 }}>
                {employee.createdAt || "N/A"}
              </div>
            </div>

            <div>
              <span>Last Profile Update:</span>
              <div style={{ marginTop: 2 }}>
                {employee.updatedAt || "N/A"}
              </div>
            </div>

            <div style={{ gridColumn: "span 2" }}>
              <span>ส่วนงานที่อนุญาตให้เข้าใช้งาน:</span>
              <div style={{ fontWeight: 600, marginTop: 2, color: "#0284c7" }}>
                {resolveEmployeeAllowedSections(employee)
                  .map((sid) => getSectionMeta(sid).shortLabelTh)
                  .join(" · ")}
              </div>
            </div>
          </div>

          {/* Operational Assignment Status Card */}
          {isDriverRole(employee.role) && (
            <div
              className="vehicle-info-box"
              style={{
                border: `1px solid ${activeAssignment ? "#a7f3d0" : "#e2e8f0"}`,
                borderRadius: 6,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Daily Dispatch Activity (Today)
              </div>
              {activeAssignment ? (
                <div style={{ fontSize: 11, color: "#065f46" }}>
                  Currently assigned to Vehicle <strong>{activeAssignment.vehicleNumber}</strong> (
                  {activeAssignment.id}) on {activeAssignment.workingDate}. Status:{" "}
                  <strong>{activeAssignment.status}</strong>.
                </div>
              ) : (
                <div style={{ fontSize: 11 }}>
                  No active vehicle dispatch assigned for today.
                </div>
              )}
              <div style={{ fontSize: 10, marginTop: 6 }}>
                Lifetime assignment records: <strong>{assignmentCount}</strong>
              </div>
            </div>
          )}

          {/* Notes */}
          {employee.notes && (
            <div
              className="vehicle-spec-box"
              style={{
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              <span>Notes: </span>
              <em>{employee.notes}</em>
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="button secondary" onClick={onEdit}>
            Edit Profile
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
