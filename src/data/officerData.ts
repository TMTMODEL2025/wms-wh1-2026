/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Driver, Employee, EmployeeRole, Vehicle, VehicleAssignment } from "../types/officer";

export const EMPLOYEE_ROLES: EmployeeRole[] = [
  "Driver",
  "Officer",
  "Inspector",
  "Operator",
  "Supervisor",
  "Manager",
  "Other",
];

export const MASTER_DEPARTMENTS: string[] = [
  "Material Handling - Fleet",
  "Warehouse 1 - Coil Yard",
  "Warehouse 1 - Slitting Bay",
  "Warehouse 1 - RM Staging",
  "Logistics & Shipping Dock",
];

export const MASTER_EMPLOYEES: Employee[] = [];

export const MASTER_DRIVERS: Driver[] = [];

export const MASTER_VEHICLES: Vehicle[] = [];

export const INITIAL_ASSIGNMENTS: VehicleAssignment[] = [];

const STORAGE_KEY_ASSIGNMENTS = "tmt_wms_officer_assignments_v2";
const STORAGE_KEY_VEHICLES = "tmt_wms_vehicles_v2";
const STORAGE_KEY_EMPLOYEES = "tmt_wms_employees_v2";

export function loadStoredEmployees(): Employee[] {
  try {
    localStorage.removeItem("tmt_wms_employees_v1");
    const data = localStorage.getItem(STORAGE_KEY_EMPLOYEES);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Could not load stored employees from localStorage", err);
  }
  return MASTER_EMPLOYEES;
}

export function saveStoredEmployees(employees: Employee[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_EMPLOYEES, JSON.stringify(employees));
  } catch (err) {
    console.warn("Could not persist employees to localStorage", err);
  }
}

/**
 * Returns active drivers suitable for Daily Vehicle Assignment.
 * Inactive employees or non-drivers are excluded from new assignments.
 */
export function getActiveDriversFromEmployees(employees: Employee[]): Driver[] {
  return employees
    .filter((emp) => emp.role === "Driver" && emp.employmentStatus === "Active")
    .map((emp) => ({
      id: emp.legacyDriverId || emp.employeeId,
      name: emp.employeeName,
      employeeId: emp.employeeId,
      department: emp.department,
      licenseType: emp.licenseType || "-",
      phone: emp.phoneNumber,
      status: "Active",
    }));
}

export function loadStoredVehicles(): Vehicle[] {
  try {
    localStorage.removeItem("tmt_wms_vehicles_v1");
    const data = localStorage.getItem(STORAGE_KEY_VEHICLES);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Could not load stored vehicles from localStorage", err);
  }
  return MASTER_VEHICLES;
}

export function saveStoredVehicles(vehicles: Vehicle[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_VEHICLES, JSON.stringify(vehicles));
  } catch (err) {
    console.warn("Could not persist vehicles to localStorage", err);
  }
}

export function loadStoredAssignments(): VehicleAssignment[] {
  try {
    localStorage.removeItem("tmt_wms_officer_assignments_v1");
    const data = localStorage.getItem(STORAGE_KEY_ASSIGNMENTS);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Could not load stored assignments from localStorage", err);
  }
  return INITIAL_ASSIGNMENTS;
}

export function saveStoredAssignments(assignments: VehicleAssignment[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ASSIGNMENTS, JSON.stringify(assignments));
  } catch (err) {
    console.warn("Could not persist assignments to localStorage", err);
  }
}
