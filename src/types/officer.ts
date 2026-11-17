/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AssignmentStatus =
  | "Pending Assignment"
  | "Assigned"
  | "In Progress"
  | "Completed"
  | "Cancelled";

export type EmployeeRole =
  | "Driver"
  | "Officer"
  | "Sr.Warehouse Officer"
  | "Inspector"
  | "Sr.Inspector"
  | "Operator"
  | "Supervisor"
  | "Manager"
  | "Other";

export type EmploymentStatus = "Active" | "Inactive";

export type WmsSectionId =
  | "overview"
  | "fleet_ops"
  | "slit_ops"
  | "coil_ops"
  | "rm_ops"
  | "admin_hr";

export interface WmsSessionUser {
  employeeId: string;
  employeeName: string;
  department: string;
  jobPosition: string;
  role: EmployeeRole;
  allowedSections: WmsSectionId[];
  loginSection: WmsSectionId | "all";
  loggedInAt: string;
}

export interface WmsActivityLogRecord {
  id: string;
  timestamp: string; // YYYY-MM-DD HH:mm:ss
  dateYmd: string; // YYYY-MM-DD
  timeHm: string; // HH:mm
  employeeId: string;
  employeeName: string;
  department: string;
  role: string;
  sectionId: WmsSectionId;
  sectionLabel: string;
  module: string;
  reference: string;
  activity: string;
  status: string;
  updatedAt: string;
}

export interface Employee {
  id: string; // Stable internal identifier e.g. "EMP-001"
  employeeId: string; // Unique business identifier e.g. "EMP-001"
  employeeName: string; // Full employee name e.g. "Somchai Prasert"
  department: string; // Department / Section e.g. "Material Handling - Fleet"
  jobPosition: string; // Job Position e.g. "Lead Tugger Operator"
  role: EmployeeRole; // Driver, Officer, Inspector, Operator, Supervisor, Manager, Other
  phoneNumber: string; // e.g. "081-456-7890"
  employmentStatus: EmploymentStatus; // "Active" | "Inactive"
  allowedSections?: WmsSectionId[]; // Sections this employee is permitted to access
  notes?: string;
  licenseType?: string; // Driver license class if role is Driver
  legacyDriverId?: string; // e.g. "DRV-001" for backwards compatibility with historical assignments
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  id: string; // e.g. "DRV-001" or "EMP-001"
  name: string; // e.g. "Somchai Prasert"
  employeeId: string; // e.g. "EMP-001"
  department: string; // e.g. "Material Handling - Fleet"
  licenseType: string; // e.g. "Heavy Industrial Equipment"
  phone?: string;
  status: "Active" | "On Leave" | "Inactive";
}

export type VehicleType = "Tractor" | "Forklift" | "Tugger" | "Trailer" | "Other";
export type VehicleActiveStatus = "Active" | "Inactive";
export type VehicleOperationalStatus = "Available" | "In Use" | "Maintenance" | "Out of Service";

export interface Vehicle {
  id: string; // Internal stable unique ID e.g. "VEH-001"
  vehicleId: string; // Unique Vehicle ID code e.g. "TT-01", "FL-001"
  number: string; // Backward compatibility alias for vehicleId
  vehicleType: VehicleType;
  type: string; // Backward compatibility alias for vehicle description/type
  description: string;
  registrationNumber: string; // e.g. "1กก-4821 BKK", "70-3491 HY"
  activeStatus: VehicleActiveStatus; // "Active" | "Inactive"
  operationalStatus: VehicleOperationalStatus; // "Available" | "In Use" | "Maintenance" | "Out of Service"
  department: string; // e.g. "Material Handling - Fleet"
  capacityTon?: number; // e.g. 5.0
  status: "Available" | "Maintenance" | "Inactive"; // Backward compatibility alias
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentHistoryItem {
  id: string;
  assignmentId: string;
  timestamp: string;
  action: "Created" | "Driver Changed" | "Vehicle Changed" | "Status Updated" | "Cancelled" | "Details Edited";
  previousDriver?: string;
  newDriver?: string;
  previousVehicle?: string;
  newVehicle?: string;
  previousStatus?: AssignmentStatus;
  newStatus?: AssignmentStatus;
  reason?: string;
  officerName: string;
}

export interface VehicleAssignment {
  id: string; // e.g. "ASN-20261012-01"
  workingDate: string; // "YYYY-MM-DD"
  driverId: string;
  driverName: string;
  driverEmployeeId: string;
  vehicleId: string;
  vehicleNumber: string;
  department: string;
  status: AssignmentStatus;
  shift?: "Morning (08:00 - 17:00)" | "Night (20:00 - 05:00)" | "Overtime Shift";
  startTime?: string;
  endTime?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  history: AssignmentHistoryItem[];
}
