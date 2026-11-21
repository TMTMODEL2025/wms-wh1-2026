/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Employee, EmployeeRole, WmsSectionId } from "../types/officer";

export interface WmsSectionMeta {
  id: WmsSectionId;
  labelTh: string;
  shortLabelTh: string;
  labelEn: string;
  defaultMenuId: string;
  menuIds: string[];
  descriptionTh: string;
}

export const WMS_SECTIONS: WmsSectionMeta[] = [
  {
    id: "overview",
    labelTh: "ภาพรวมผู้บริหาร (Overview)",
    shortLabelTh: "ภาพรวม",
    labelEn: "Executive Overview",
    defaultMenuId: "dashboard",
    menuIds: ["dashboard"],
    descriptionTh: "แดชบอร์ดภาพรวมคลังสินค้าและกิจกรรมล่าสุด",
  },
  {
    id: "fleet_ops",
    labelTh: "ปฏิบัติการขนย้ายและรถยก (Fleet & MH)",
    shortLabelTh: "ขนย้าย/รถยก",
    labelEn: "Material Handling & Fleet",
    defaultMenuId: "transport",
    menuIds: ["transport", "transport-stats", "manpower-planning", "delivery-points", "fix-flush", "pm-schedule", "tire-stock", "pre-start", "vehicles", "employees", "fuel"],
    descriptionTh: "ขนย้ายสินค้า, สถิติการย้ายงาน, วางแผนกำลังคน, จุดส่งสินค้า, ซ่อมบำรุง, กำหนดการPM, ตรวจเช็ครถ, น้ำมัน และตารางงาน",
  },
  {
    id: "slit_ops",
    labelTh: "เหล็กสลิต / ฟิล์ม & TMT Recheck",
    shortLabelTh: "สลิต/ฟิล์ม",
    labelEn: "Slit / Film & Recheck",
    defaultMenuId: "slit",
    menuIds: ["slit"],
    descriptionTh: "รับเข้า-จ่ายออกสลิต, ย้าย Layout, สต๊อก, ตรวจอุปกรณ์ และ Recheck",
  },
  {
    id: "coil_ops",
    labelTh: "การจัดการเหล็กม้วน (Steel Coil)",
    shortLabelTh: "เหล็กม้วน Coil",
    labelEn: "Steel Coil Yard",
    defaultMenuId: "coil",
    menuIds: ["coil"],
    descriptionTh: "รับเข้า-จ่ายออก-เตรียมเบิก-ย้าย Bay เหล็กม้วน",
  },
  {
    id: "rm_ops",
    labelTh: "เหล็กแผ่น RM (Steel Sheet)",
    shortLabelTh: "เหล็กแผ่น RM",
    labelEn: "RM Steel Sheet",
    defaultMenuId: "rm",
    menuIds: ["rm"],
    descriptionTh: "สต๊อกและการจัดการเหล็กแผ่น RM Staging",
  },
  {
    id: "admin_hr",
    labelTh: "งานบริหารและกำลังพล (Admin & HR)",
    shortLabelTh: "บริหาร/กำลังพล",
    labelEn: "Admin & Workforce",
    defaultMenuId: "admin",
    menuIds: ["admin"],
    descriptionTh: "ศูนย์กลางจัดการรายชื่อพนักงาน สิทธิ์ส่วนงาน และประวัติกิจกรรม",
  },
];

export const ALL_WMS_SECTION_IDS: WmsSectionId[] = WMS_SECTIONS.map((s) => s.id);

export const MENU_TO_SECTION_MAP: Record<string, WmsSectionId> = {
  dashboard: "overview",
  transport: "fleet_ops",
  "transport-stats": "fleet_ops",
  "manpower-planning": "fleet_ops",
  "delivery-points": "fleet_ops",
  "fix-flush": "fleet_ops",
  "pm-schedule": "fleet_ops",
  "tire-stock": "fleet_ops",
  "pre-start": "fleet_ops",
  vehicles: "fleet_ops",
  employees: "fleet_ops",
  fuel: "fleet_ops",
  slit: "slit_ops",
  coil: "coil_ops",
  rm: "rm_ops",
  admin: "admin_hr",
};

export function getSectionMeta(sectionId: WmsSectionId): WmsSectionMeta {
  return (
    WMS_SECTIONS.find((s) => s.id === sectionId) || {
      id: "fleet_ops",
      labelTh: "ปฏิบัติการขนย้ายและรถยก (Fleet & MH)",
      shortLabelTh: "ขนย้าย/รถยก",
      labelEn: "Material Handling & Fleet",
      defaultMenuId: "transport",
      menuIds: ["transport"],
      descriptionTh: "",
    }
  );
}

export function getSectionIdForMenu(menuId: string): WmsSectionId {
  return MENU_TO_SECTION_MAP[menuId] || "overview";
}

export function normalizeAllowedSections(sections?: string[]): WmsSectionId[] {
  if (!Array.isArray(sections) || sections.length === 0) return [];
  const validSet = new Set<WmsSectionId>(ALL_WMS_SECTION_IDS);
  const unique: WmsSectionId[] = [];
  for (const s of sections) {
    if (validSet.has(s as WmsSectionId) && !unique.includes(s as WmsSectionId)) {
      unique.push(s as WmsSectionId);
    }
  }
  return unique;
}

/**
 * Computes default permitted sections based on role + department when an employee
 * doesn't yet have explicit allowedSections saved.
 */
export function getDefaultSectionsForRoleAndDept(
  role: EmployeeRole,
  department: string
): WmsSectionId[] {
  if (role === "Manager" || role === "Assistant Manager" || role === "Supervisor") {
    return [...ALL_WMS_SECTION_IDS];
  }

  const dept = (department || "").toLowerCase();
  const sections: WmsSectionId[] = [];

  if (role === "Officer" || role === "Sr.Warehouse Officer") {
    sections.push("overview");
  }

  if (dept.includes("admin") || dept.includes("incoming")) {
    if (!sections.includes("overview")) sections.push("overview");
    if (!sections.includes("admin_hr")) sections.push("admin_hr");
  }
  if (dept.includes("material handling") || dept.includes("fleet") || role === "Driver") {
    if (!sections.includes("fleet_ops")) sections.push("fleet_ops");
  }
  if (dept.includes("slit") || dept.includes("shipping") || dept.includes("logistics")) {
    if (!sections.includes("slit_ops")) sections.push("slit_ops");
  }
  if (dept.includes("coil")) {
    if (!sections.includes("coil_ops")) sections.push("coil_ops");
  }
  if (dept.includes("rm") || dept.includes("staging") || dept.includes("sheet")) {
    if (!sections.includes("rm_ops")) sections.push("rm_ops");
  }

  if (sections.length === 0) {
    sections.push("fleet_ops");
  }

  return sections;
}

export function resolveEmployeeAllowedSections(employee: Pick<Employee, "role" | "department" | "allowedSections">): WmsSectionId[] {
  const explicit = normalizeAllowedSections(employee.allowedSections);
  if (explicit.length > 0) {
    return explicit;
  }
  return getDefaultSectionsForRoleAndDept(employee.role, employee.department);
}

export function canAccessMenu(allowedSections: WmsSectionId[], menuId: string): boolean {
  const ownerSection = MENU_TO_SECTION_MAP[menuId];
  if (!ownerSection) return true;
  return allowedSections.includes(ownerSection);
}

export function getDefaultMenuForSections(
  allowedSections: WmsSectionId[],
  preferredSection?: WmsSectionId | "all"
): string {
  if (
    preferredSection &&
    preferredSection !== "all" &&
    allowedSections.includes(preferredSection)
  ) {
    return getSectionMeta(preferredSection).defaultMenuId;
  }
  for (const sec of WMS_SECTIONS) {
    if (allowedSections.includes(sec.id)) {
      return sec.defaultMenuId;
    }
  }
  return "dashboard";
}
