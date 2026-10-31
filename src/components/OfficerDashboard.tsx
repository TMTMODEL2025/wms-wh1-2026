/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import {
  Calendar,
  Users,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Plus,
  Search,
  RotateCcw,
  History,
  Edit3,
  Ban,
  ShieldCheck,
  Info,
  Filter,
  ArrowRightLeft,
  Printer,
  ChevronRight,
  FileText
} from "lucide-react";
import {
  AssignmentHistoryItem,
  AssignmentStatus,
  Driver,
  Employee,
  Vehicle,
  VehicleAssignment
} from "../types/officer";
import {
  MASTER_DEPARTMENTS,
  MASTER_DRIVERS,
  MASTER_VEHICLES,
  loadStoredAssignments,
  saveStoredAssignments,
  loadStoredVehicles,
  saveStoredVehicles,
  getActiveDriversFromEmployees,
} from "../data/officerData";

interface OfficerDashboardProps {
  vehicles?: Vehicle[];
  employees?: Employee[];
  assignments?: VehicleAssignment[];
  onUpdateAssignments?: (updated: VehicleAssignment[]) => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
  onNavigateToVehicles?: () => void;
  onNavigateToEmployees?: () => void;
}

export function OfficerDashboard({
  vehicles: propVehicles,
  employees: propEmployees,
  assignments: propAssignments,
  onUpdateAssignments: propOnUpdateAssignments,
  onLogTransaction,
  onNavigateToVehicles,
  onNavigateToEmployees,
}: OfficerDashboardProps) {
  // Working date state (defaults to today)
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayDateStr);
  const [filterAllDates, setFilterAllDates] = useState<boolean>(false);

  // Master lists - active drivers derived dynamically from shared employees roster
  const drivers = useMemo<Driver[]>(() => {
    if (propEmployees) {
      return getActiveDriversFromEmployees(propEmployees);
    }
    return MASTER_DRIVERS;
  }, [propEmployees]);

  const vehicles = propVehicles ?? MASTER_VEHICLES;

  // Assignments state with persistent local storage
  const [internalAssignments, setInternalAssignments] = useState<VehicleAssignment[]>(() =>
    loadStoredAssignments()
  );

  const assignments = propAssignments ?? internalAssignments;

  const updateAssignmentsState = (updatedList: VehicleAssignment[]) => {
    if (propOnUpdateAssignments) {
      propOnUpdateAssignments(updatedList);
    } else {
      setInternalAssignments(updatedList);
      saveStoredAssignments(updatedList);
    }
  };

  // Filter states
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [filterDriver, setFilterDriver] = useState<string>("All");
  const [filterVehicle, setFilterVehicle] = useState<string>("All");
  const [filterDepartment, setFilterDepartment] = useState<string>("All");
  const [filterStatus, setFilterStatus] = useState<string>("All");

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [editingAssignment, setEditingAssignment] = useState<VehicleAssignment | null>(null);
  const [historyAssignment, setHistoryAssignment] = useState<VehicleAssignment | null>(null);
  const [cancellingAssignment, setCancellingAssignment] = useState<VehicleAssignment | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");

  // Notification toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Quick date jump helpers
  const handleDateChange = (dateStr: string) => {
    setSelectedDate(dateStr);
    setFilterAllDates(false);
  };

  const shiftDate = (days: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + days);
    const newDateStr = current.toISOString().split("T")[0];
    setSelectedDate(newDateStr);
    setFilterAllDates(false);
  };

  // ==========================================
  // DASHBOARD SUMMARY METRICS (Calculated dynamically)
  // ==========================================
  const summaryMetrics = useMemo(() => {
    const dateAssignments = assignments.filter((a) => a.workingDate === selectedDate);

    // Active assignments are those in progress or assigned
    const activeOnDate = dateAssignments.filter(
      (a) => a.status === "Assigned" || a.status === "In Progress"
    );

    const completedOnDate = dateAssignments.filter((a) => a.status === "Completed");

    // Assigned drivers on selected date
    const assignedDriverIds = new Set(
      activeOnDate.map((a) => a.driverId)
    );

    const activeDriversCount = drivers.filter((d) => d.status === "Active").length;
    const assignedDriversCount = assignedDriverIds.size;
    const unassignedDriversCount = Math.max(0, activeDriversCount - assignedDriversCount);

    return {
      totalDrivers: activeDriversCount,
      totalVehicles: vehicles.filter((v) => v.status !== "Inactive").length,
      assignedDrivers: assignedDriversCount,
      unassignedDrivers: unassignedDriversCount,
      activeAssignments: activeOnDate.length,
      completedAssignments: completedOnDate.length,
      dateCount: dateAssignments.length,
    };
  }, [assignments, drivers, vehicles, selectedDate]);

  // ==========================================
  // FILTERED ASSIGNMENTS LIST
  // ==========================================
  const filteredAssignments = useMemo(() => {
    return assignments.filter((item) => {
      // Date filter
      if (!filterAllDates && item.workingDate !== selectedDate) {
        return false;
      }

      // Keyword search
      if (searchKeyword.trim()) {
        const query = searchKeyword.toLowerCase();
        const searchable = [
          item.id,
          item.driverName,
          item.driverEmployeeId,
          item.vehicleNumber,
          item.department,
          item.status,
          item.notes || "",
        ]
          .join(" ")
          .toLowerCase();

        if (!searchable.includes(query)) return false;
      }

      // Driver filter
      if (filterDriver !== "All" && item.driverId !== filterDriver) {
        return false;
      }

      // Vehicle filter
      if (filterVehicle !== "All" && item.vehicleNumber !== filterVehicle) {
        return false;
      }

      // Department filter
      if (filterDepartment !== "All" && item.department !== filterDepartment) {
        return false;
      }

      // Status filter
      if (filterStatus !== "All" && item.status !== filterStatus) {
        return false;
      }

      return true;
    });
  }, [
    assignments,
    selectedDate,
    filterAllDates,
    searchKeyword,
    filterDriver,
    filterVehicle,
    filterDepartment,
    filterStatus,
  ]);

  // ==========================================
  // VALIDATION LOGIC
  // ==========================================
  const checkAssignmentConflicts = (
    workingDate: string,
    driverId: string,
    vehicleId: string,
    currentAssignmentId?: string,
    targetStatus: AssignmentStatus = "Assigned"
  ): { valid: boolean; error?: string } => {
    // If target status is Cancelled or Completed, it does not lock
    if (targetStatus === "Cancelled" || targetStatus === "Completed") {
      return { valid: true };
    }

    // Check Driver active conflicts on the same working date
    const conflictingDriverAssignment = assignments.find(
      (a) =>
        a.id !== currentAssignmentId &&
        a.workingDate === workingDate &&
        a.driverId === driverId &&
        (a.status === "Pending Assignment" || a.status === "Assigned" || a.status === "In Progress")
    );

    if (conflictingDriverAssignment) {
      const driverObj = drivers.find((d) => d.id === driverId);
      return {
        valid: false,
        error: `Driver "${driverObj?.name || driverId}" is already actively assigned to Vehicle "${conflictingDriverAssignment.vehicleNumber}" (${conflictingDriverAssignment.id}) on ${workingDate}. A driver cannot be assigned to multiple active vehicles simultaneously. Complete or cancel the existing assignment first.`,
      };
    }

    // Check Vehicle active conflicts on the same working date
    const conflictingVehicleAssignment = assignments.find(
      (a) =>
        a.id !== currentAssignmentId &&
        a.workingDate === workingDate &&
        a.vehicleId === vehicleId &&
        (a.status === "Pending Assignment" || a.status === "Assigned" || a.status === "In Progress")
    );

    if (conflictingVehicleAssignment) {
      const vehicleObj = vehicles.find((v) => v.id === vehicleId);
      return {
        valid: false,
        error: `Vehicle "${vehicleObj?.number || vehicleId}" is already actively assigned to Driver "${conflictingVehicleAssignment.driverName}" (${conflictingVehicleAssignment.id}) on ${workingDate}. A vehicle cannot be assigned to multiple drivers simultaneously.`,
      };
    }

    return { valid: true };
  };

  // ==========================================
  // CREATE ASSIGNMENT HANDLER
  // ==========================================
  const handleSaveNewAssignment = (form: {
    workingDate: string;
    driverId: string;
    vehicleId: string;
    department: string;
    status: AssignmentStatus;
    shift: "Morning (08:00 - 17:00)" | "Night (20:00 - 05:00)" | "Overtime Shift";
    notes?: string;
  }) => {
    const conflict = checkAssignmentConflicts(
      form.workingDate,
      form.driverId,
      form.vehicleId,
      undefined,
      form.status
    );

    if (!conflict.valid) {
      return { success: false, error: conflict.error };
    }

    const driverObj = drivers.find((d) => d.id === form.driverId)!;
    const vehicleObj = vehicles.find((v) => v.id === form.vehicleId)!;

    const now = new Date();
    const timestampStr = now.toLocaleDateString("en-CA") + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const newId = `ASN-${form.workingDate.replace(/-/g, "")}-${String(assignments.length + 1).padStart(2, "0")}`;

    const initialHistory: AssignmentHistoryItem = {
      id: `HIST-${Date.now()}-1`,
      assignmentId: newId,
      timestamp: timestampStr,
      action: "Created",
      newDriver: driverObj.name,
      newVehicle: vehicleObj.number,
      newStatus: form.status,
      reason: "Initial assignment registered by officer",
      officerName: "Officer Pitak",
    };

    const newAssignment: VehicleAssignment = {
      id: newId,
      workingDate: form.workingDate,
      driverId: form.driverId,
      driverName: driverObj.name,
      driverEmployeeId: driverObj.employeeId,
      vehicleId: form.vehicleId,
      vehicleNumber: vehicleObj.number,
      department: form.department,
      status: form.status,
      shift: form.shift,
      startTime: form.status === "In Progress" ? now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : undefined,
      notes: form.notes,
      createdAt: timestampStr,
      updatedAt: timestampStr,
      history: [initialHistory],
    };

    const updated = [newAssignment, ...assignments];
    updateAssignmentsState(updated);

    setShowCreateModal(false);
    showToast(`Assignment created: ${newAssignment.id} (${driverObj.name} ➔ ${vehicleObj.number})`);

    onLogTransaction?.(
      `Assigned vehicle ${vehicleObj.number} to driver ${driverObj.name}`,
      newAssignment.id,
      form.status
    );

    return { success: true };
  };

  // ==========================================
  // UPDATE / EDIT ASSIGNMENT HANDLER
  // ==========================================
  const handleUpdateAssignment = (form: {
    driverId: string;
    vehicleId: string;
    department: string;
    status: AssignmentStatus;
    notes?: string;
    changeReason?: string;
  }): { success: boolean; error?: string } => {
    if (!editingAssignment) return { success: false, error: "No assignment selected" };

    // Validate conflicts
    const conflict = checkAssignmentConflicts(
      editingAssignment.workingDate,
      form.driverId,
      form.vehicleId,
      editingAssignment.id,
      form.status
    );

    if (!conflict.valid) {
      return { success: false, error: conflict.error };
    }

    const driverObj = drivers.find((d) => d.id === form.driverId)!;
    const vehicleObj = vehicles.find((v) => v.id === form.vehicleId)!;

    const isDriverChanged = editingAssignment.driverId !== form.driverId;
    const isVehicleChanged = editingAssignment.vehicleId !== form.vehicleId;
    const isStatusChanged = editingAssignment.status !== form.status;

    if ((isDriverChanged || isVehicleChanged) && (!form.changeReason || !form.changeReason.trim())) {
      return {
        success: false,
        error: "A change reason is required whenever reassigned driver or vehicle is modified.",
      };
    }

    const now = new Date();
    const timestampStr = now.toLocaleDateString("en-CA") + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const newHistoryEntries: AssignmentHistoryItem[] = [...editingAssignment.history];

    if (isDriverChanged) {
      newHistoryEntries.push({
        id: `HIST-${Date.now()}-drv`,
        assignmentId: editingAssignment.id,
        timestamp: timestampStr,
        action: "Driver Changed",
        previousDriver: editingAssignment.driverName,
        newDriver: driverObj.name,
        reason: form.changeReason || "Operational driver rotation",
        officerName: "Officer Pitak",
      });
    }

    if (isVehicleChanged) {
      newHistoryEntries.push({
        id: `HIST-${Date.now()}-veh`,
        assignmentId: editingAssignment.id,
        timestamp: timestampStr,
        action: "Vehicle Changed",
        previousVehicle: editingAssignment.vehicleNumber,
        newVehicle: vehicleObj.number,
        reason: form.changeReason || "Vehicle reassigned by officer",
        officerName: "Officer Pitak",
      });
    }

    if (isStatusChanged) {
      newHistoryEntries.push({
        id: `HIST-${Date.now()}-sts`,
        assignmentId: editingAssignment.id,
        timestamp: timestampStr,
        action: "Status Updated",
        previousStatus: editingAssignment.status,
        newStatus: form.status,
        reason: form.changeReason || `Status shifted to ${form.status}`,
        officerName: "Officer Pitak",
      });
    }

    const updatedAssignment: VehicleAssignment = {
      ...editingAssignment,
      driverId: form.driverId,
      driverName: driverObj.name,
      driverEmployeeId: driverObj.employeeId,
      vehicleId: form.vehicleId,
      vehicleNumber: vehicleObj.number,
      department: form.department,
      status: form.status,
      notes: form.notes,
      updatedAt: timestampStr,
      history: newHistoryEntries,
      endTime: form.status === "Completed" && !editingAssignment.endTime ? now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : editingAssignment.endTime,
    };

    const updatedList = assignments.map((a) => (a.id === editingAssignment.id ? updatedAssignment : a));
    updateAssignmentsState(updatedList);

    setEditingAssignment(null);
    showToast(`Assignment ${editingAssignment.id} updated successfully.`);

    onLogTransaction?.(
      `Updated assignment ${editingAssignment.id}: ${driverObj.name} ➔ ${vehicleObj.number}`,
      editingAssignment.id,
      form.status
    );

    return { success: true };
  };

  // ==========================================
  // CANCEL ASSIGNMENT HANDLER
  // ==========================================
  const handleConfirmCancel = () => {
    if (!cancellingAssignment) return;

    if (!cancelReason.trim()) {
      showToast("Please provide a reason for cancelling this assignment.", "error");
      return;
    }

    const now = new Date();
    const timestampStr = now.toLocaleDateString("en-CA") + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const cancelHistory: AssignmentHistoryItem = {
      id: `HIST-${Date.now()}-cxl`,
      assignmentId: cancellingAssignment.id,
      timestamp: timestampStr,
      action: "Cancelled",
      previousStatus: cancellingAssignment.status,
      newStatus: "Cancelled",
      reason: cancelReason,
      officerName: "Officer Pitak",
    };

    const updatedAssignment: VehicleAssignment = {
      ...cancellingAssignment,
      status: "Cancelled",
      updatedAt: timestampStr,
      history: [...cancellingAssignment.history, cancelHistory],
    };

    const updatedList = assignments.map((a) => (a.id === cancellingAssignment.id ? updatedAssignment : a));
    updateAssignmentsState(updatedList);

    showToast(`Assignment ${cancellingAssignment.id} cancelled. Vehicle & driver released.`);
    onLogTransaction?.(
      `Cancelled vehicle assignment ${cancellingAssignment.id}`,
      cancellingAssignment.id,
      "Cancelled"
    );

    setCancellingAssignment(null);
    setCancelReason("");
  };

  return (
    <div className="officer-dashboard">
      {/* Toast notification */}
      {toastMessage && (
        <div
          className={`toast ${toastMessage.type === "error" ? "toast-error" : ""}`}
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 999,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: toastMessage.type === "error" ? "#7f1d1d" : "#0f172a",
            color: "#fff",
            padding: "12px 18px",
            borderRadius: 6,
            boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
            fontSize: 12,
            borderLeft: `4px solid ${toastMessage.type === "error" ? "#ef4444" : "#22c55e"}`,
          }}
        >
          {toastMessage.type === "error" ? (
            <AlertTriangle size={16} color="#fca5a5" />
          ) : (
            <CheckCircle2 size={16} color="#86efac" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Control Banner & Date Selector */}
      <div
        className="panel"
        style={{
          marginBottom: 16,
          padding: "14px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          background: "#fff",
          borderLeft: "4px solid var(--blue)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={18} style={{ color: "var(--blue)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1e3648" }}>
              Working Date:
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className="button secondary"
              style={{ padding: "6px 10px", fontSize: 11 }}
              onClick={() => shiftDate(-1)}
              title="Previous Working Day"
            >
              ◀ Prev Day
            </button>

            <input
              type="date"
              className="field"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              style={{ minHeight: 33, padding: "5px 10px", fontWeight: 700, color: "#006b98" }}
            />

            <button
              className="button secondary"
              style={{ padding: "6px 10px", fontSize: 11 }}
              onClick={() => shiftDate(1)}
              title="Next Working Day"
            >
              Next Day ▶
            </button>

            <button
              className={`button ${selectedDate === todayDateStr && !filterAllDates ? "" : "secondary"}`}
              style={{ padding: "6px 10px", fontSize: 11 }}
              onClick={() => handleDateChange(todayDateStr)}
            >
              Today
            </button>

            <button
              className={`button ${filterAllDates ? "" : "secondary"}`}
              style={{ padding: "6px 10px", fontSize: 11 }}
              onClick={() => setFilterAllDates(!filterAllDates)}
            >
              {filterAllDates ? "Filtered by Selected Date" : "Show All Dates"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              fontSize: 11,
              color: "#526875",
              background: "#f1f6f9",
              padding: "5px 10px",
              borderRadius: 4,
              border: "1px solid #d9e4ea",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ShieldCheck size={14} color="#087eaf" />
            <span>Officer View: <strong>Officer Pitak (Shift Leader)</strong></span>
          </div>

          {onNavigateToEmployees && (
            <button
              className="button secondary"
              onClick={onNavigateToEmployees}
              style={{ padding: "8px 12px", fontSize: 11 }}
              title="Open Employee Management"
            >
              <Users size={13} color="#087eaf" />
              Employee Roster ➔
            </button>
          )}

          {onNavigateToVehicles && (
            <button
              className="button secondary"
              onClick={onNavigateToVehicles}
              style={{ padding: "8px 12px", fontSize: 11 }}
              title="Open Vehicle Management"
            >
              <Truck size={13} color="#087eaf" />
              Vehicles ➔
            </button>
          )}

          <button
            className="button"
            onClick={() => setShowCreateModal(true)}
            style={{ padding: "8px 16px" }}
          >
            <Plus size={15} />
            + New Vehicle Assignment
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total Active Drivers</div>
          <div className="kpi-value">{summaryMetrics.totalDrivers}</div>
          <div className="kpi-note">Licensed Material Handling operators</div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Available Vehicles</div>
          <div className="kpi-value">{summaryMetrics.totalVehicles}</div>
          <div className="kpi-note">Tow tuggers, tractors & forklifts</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#16a34a" }}>
          <div className="kpi-label">Assigned Drivers ({filterAllDates ? "Total" : selectedDate})</div>
          <div className="kpi-value" style={{ color: "#15803d" }}>
            {summaryMetrics.assignedDrivers}
          </div>
          <div className="kpi-note">
            Unassigned: <strong>{summaryMetrics.unassignedDrivers}</strong> drivers available
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#0284c7" }}>
          <div className="kpi-label">Active Assignments ({filterAllDates ? "Total" : selectedDate})</div>
          <div className="kpi-value" style={{ color: "#0369a1" }}>
            {summaryMetrics.activeAssignments}
          </div>
          <div className="kpi-note">
            Completed: <strong>{summaryMetrics.completedAssignments}</strong> | Total: {summaryMetrics.dateCount}
          </div>
        </div>
      </div>

      {/* Main Table Panel */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              Daily Vehicle Assignment Log
              <span style={{ fontSize: 12, fontWeight: 400, color: "#647786", marginLeft: 8 }}>
                ({filterAllDates ? "All Dates" : `Date: ${selectedDate}`})
              </span>
            </div>
            <div className="panel-subtitle">
              Manage daily vehicle assignments, real-time driver dispatch, and audit change history
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="button secondary"
              onClick={() => window.print()}
              title="Print daily assignment sheet"
            >
              <Printer size={13} />
              Print Daily Sheet
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="filterbar">
          <div style={{ position: "relative", flex: 1, minWidth: 200, display: "flex", alignItems: "center" }}>
            <Search size={14} style={{ position: "absolute", left: 10, color: "#82919c" }} />
            <input
              className="field search-field"
              style={{ paddingLeft: 30 }}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="Search driver, vehicle (e.g. TT-01), ID, notes..."
              aria-label="Search assignments"
            />
          </div>

          {/* Driver filter */}
          <select
            className="field"
            value={filterDriver}
            onChange={(e) => setFilterDriver(e.target.value)}
            aria-label="Filter Driver"
            title="Filter by Driver"
          >
            <option value="All">All Drivers</option>
            {drivers.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name} ({d.employeeId})
              </option>
            ))}
          </select>

          {/* Vehicle filter */}
          <select
            className="field"
            value={filterVehicle}
            onChange={(e) => setFilterVehicle(e.target.value)}
            aria-label="Filter Vehicle"
            title="Filter by Vehicle"
          >
            <option value="All">All Vehicles</option>
            {vehicles.map((v) => (
              <option value={v.number} key={v.id}>
                {v.number} - {v.type}
              </option>
            ))}
          </select>

          {/* Department filter */}
          <select
            className="field"
            value={filterDepartment}
            onChange={(e) => setFilterDepartment(e.target.value)}
            aria-label="Filter Department"
            title="Filter by Department"
          >
            <option value="All">All Departments</option>
            {MASTER_DEPARTMENTS.map((dept) => (
              <option value={dept} key={dept}>
                {dept}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            className="field"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="Filter Status"
            title="Filter by Status"
          >
            <option value="All">All Statuses</option>
            <option value="Pending Assignment">Pending Assignment</option>
            <option value="Assigned">Assigned</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <button
            className="button secondary"
            onClick={() => {
              setSearchKeyword("");
              setFilterDriver("All");
              setFilterVehicle("All");
              setFilterDepartment("All");
              setFilterStatus("All");
            }}
            title="Reset all filters"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>

        {/* Assignments Data Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 45 }}>No.</th>
                <th>Working Date</th>
                <th>Driver Name</th>
                <th>Vehicle Number</th>
                <th>Department</th>
                <th>Status</th>
                <th>Shift / Time</th>
                <th>Last Updated</th>
                <th style={{ textAlign: "right", paddingRight: 20 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.map((assignment, index) => {
                const isCancelled = assignment.status === "Cancelled";
                return (
                  <tr
                    key={assignment.id}
                    style={{
                      opacity: isCancelled ? 0.65 : 1,
                      backgroundColor: isCancelled ? "#fafafa" : undefined,
                    }}
                  >
                    <td style={{ color: "#71818c", fontWeight: 700 }}>
                      {index + 1}
                    </td>

                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Calendar size={13} color="#647786" />
                        <span style={{ fontWeight: 600 }}>{assignment.workingDate}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#8a9ba8" }}>{assignment.id}</div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 700, color: "#1e3648" }}>
                        {assignment.driverName}
                      </div>
                      <div style={{ fontSize: 10, color: "#647786" }}>
                        ID: {assignment.driverEmployeeId}
                      </div>
                    </td>

                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="code" style={{ fontSize: 13 }}>
                          {assignment.vehicleNumber}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "#647786" }}>
                        {vehicles.find((v) => v.number === assignment.vehicleNumber)?.type || "Fleet Tugger"}
                      </div>
                    </td>

                    <td>
                      <span style={{ color: "#334155" }}>{assignment.department}</span>
                      {assignment.notes && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "#64748b",
                            maxWidth: 220,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={assignment.notes}
                        >
                          Note: {assignment.notes}
                        </div>
                      )}
                    </td>

                    <td>
                      <AssignmentStatusBadge status={assignment.status} />
                    </td>

                    <td>
                      <div style={{ fontSize: 11, color: "#334155" }}>
                        {assignment.shift ? assignment.shift.split(" ")[0] : "Day Shift"}
                      </div>
                      <div style={{ fontSize: 10, color: "#71818c" }}>
                        {assignment.startTime ? `Start: ${assignment.startTime}` : ""}
                        {assignment.endTime ? ` · End: ${assignment.endTime}` : ""}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: 11, color: "#475569" }}>
                        {assignment.updatedAt}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>
                        {assignment.history.length} audit {assignment.history.length === 1 ? "log" : "logs"}
                      </div>
                    </td>

                    <td style={{ textAlign: "right", paddingRight: 16 }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <button
                          className="button secondary"
                          style={{ padding: "5px 9px", fontSize: 11 }}
                          onClick={() => setEditingAssignment(assignment)}
                          title="Edit assignment details, change driver or vehicle"
                        >
                          <Edit3 size={12} />
                          Edit / Reassign
                        </button>

                        <button
                          className="button secondary"
                          style={{ padding: "5px 9px", fontSize: 11 }}
                          onClick={() => setHistoryAssignment(assignment)}
                          title="View change audit history"
                        >
                          <History size={12} />
                          History ({assignment.history.length})
                        </button>

                        {!isCancelled && assignment.status !== "Completed" && (
                          <button
                            className="button danger"
                            style={{ padding: "5px 9px", fontSize: 11 }}
                            onClick={() => {
                              setCancellingAssignment(assignment);
                              setCancelReason("");
                            }}
                            title="Cancel this vehicle assignment"
                          >
                            <Ban size={12} />
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredAssignments.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty" style={{ padding: "45px 20px" }}>
                      <AlertTriangle size={24} style={{ color: "#94a3b8", marginBottom: 8 }} />
                      <div style={{ fontWeight: 600, color: "#334155" }}>
                        No assignments found for the selected criteria
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                        {filterAllDates
                          ? "Try clearing filters to view all records."
                          : `No vehicle assignments exist for ${selectedDate}. Click "+ New Vehicle Assignment" above to assign a driver.`}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid #e7ecef",
            background: "#fafbfc",
            fontSize: 11,
            color: "#647786",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            Showing <strong>{filteredAssignments.length}</strong> of <strong>{assignments.length}</strong> total assignment records
            {" · "}
            Active locks strictly prevent overlapping driver and vehicle conflicts on the same date.
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            Operational Engine Phase 1 · Ready for Driver Mobile Interface Integration
          </div>
        </div>
      </section>

      {/* Operational Notice */}
      <div className="notice" style={{ marginTop: 14 }}>
        <Info size={16} style={{ flexShrink: 0 }} />
        <div>
          <strong>Assignment Validation Active:</strong> Drivers and vehicles cannot be assigned to multiple active duties simultaneously on the same working date. Reassignments and status updates automatically record audit timestamps and change reasons into the permanent assignment history without data loss.
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: CREATE NEW ASSIGNMENT */}
      {/* ======================================================== */}
      {showCreateModal && (
        <CreateAssignmentModal
          defaultDate={selectedDate}
          drivers={drivers}
          vehicles={vehicles}
          departments={MASTER_DEPARTMENTS}
          onClose={() => setShowCreateModal(false)}
          onSave={handleSaveNewAssignment}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL 2: EDIT / REASSIGN ASSIGNMENT */}
      {/* ======================================================== */}
      {editingAssignment && (
        <EditAssignmentModal
          assignment={editingAssignment}
          drivers={drivers}
          vehicles={vehicles}
          departments={MASTER_DEPARTMENTS}
          onClose={() => setEditingAssignment(null)}
          onSave={handleUpdateAssignment}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL 3: AUDIT HISTORY MODAL */}
      {/* ======================================================== */}
      {historyAssignment && (
        <AssignmentHistoryModal
          assignment={historyAssignment}
          onClose={() => setHistoryAssignment(null)}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL 4: CANCEL ASSIGNMENT CONFIRMATION */}
      {/* ======================================================== */}
      {cancellingAssignment && (
        <div className="modal-backdrop" onMouseDown={() => setCancellingAssignment(null)}>
          <div
            className="modal"
            style={{ maxWidth: 480 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="panel-header" style={{ borderBottomColor: "#fee2e2", background: "#fef2f2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={18} color="#b91c1c" />
                <div className="panel-title" style={{ color: "#991b1b" }}>
                  Confirm Assignment Cancellation
                </div>
              </div>
              <button
                style={{ background: "none", border: 0, cursor: "pointer", color: "#64748b" }}
                onClick={() => setCancellingAssignment(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.6 }}>
                You are about to cancel assignment <strong>{cancellingAssignment.id}</strong>:
                <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 4, margin: "10px 0", border: "1px solid #e2e8f0" }}>
                  <div>Driver: <strong>{cancellingAssignment.driverName}</strong></div>
                  <div>Vehicle: <strong>{cancellingAssignment.vehicleNumber}</strong></div>
                  <div>Date: <strong>{cancellingAssignment.workingDate}</strong></div>
                  <div>Current Status: <strong>{cancellingAssignment.status}</strong></div>
                </div>
                Cancelling will release both the vehicle and the driver for re-assignment. The cancellation reason will be permanently recorded in the audit history.
              </div>

              <label className="form-field">
                Cancellation Reason *
                <input
                  className="field"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Driver sickness, shift cancelled, vehicle maintenance required"
                  autoFocus
                  required
                />
              </label>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setCancellingAssignment(null)}
              >
                Keep Assignment
              </button>
              <button
                type="button"
                className="button danger"
                onClick={handleConfirmCancel}
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// STATUS BADGE COMPONENT
// ==========================================
function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  switch (status) {
    case "Pending Assignment":
      return (
        <span
          className="status"
          style={{
            background: "#fef9c3",
            color: "#854d0e",
            border: "1px solid #fde047",
          }}
        >
          <Clock size={11} />
          Pending Assignment
        </span>
      );
    case "Assigned":
      return (
        <span
          className="status"
          style={{
            background: "#e0f2fe",
            color: "#0369a1",
            border: "1px solid #bae6fd",
          }}
        >
          <CheckCircle2 size={11} />
          Assigned
        </span>
      );
    case "In Progress":
      return (
        <span
          className="status"
          style={{
            background: "#dcfce7",
            color: "#15803d",
            border: "1px solid #86efac",
          }}
        >
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
          In Progress
        </span>
      );
    case "Completed":
      return (
        <span
          className="status"
          style={{
            background: "#f1f5f9",
            color: "#334155",
            border: "1px solid #cbd5e1",
          }}
        >
          <CheckCircle2 size={11} />
          Completed
        </span>
      );
    case "Cancelled":
      return (
        <span
          className="status"
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            border: "1px solid #fca5a5",
          }}
        >
          <XCircle size={11} />
          Cancelled
        </span>
      );
    default:
      return <span className="status">{status}</span>;
  }
}

// ==========================================
// MODAL: CREATE ASSIGNMENT
// ==========================================
function CreateAssignmentModal({
  defaultDate,
  drivers,
  vehicles,
  departments,
  onClose,
  onSave,
}: {
  defaultDate: string;
  drivers: Driver[];
  vehicles: Vehicle[];
  departments: string[];
  onClose: () => void;
  onSave: (form: {
    workingDate: string;
    driverId: string;
    vehicleId: string;
    department: string;
    status: AssignmentStatus;
    shift: "Morning (08:00 - 17:00)" | "Night (20:00 - 05:00)" | "Overtime Shift";
    notes?: string;
  }) => { success: boolean; error?: string };
}) {
  const eligibleVehicles = useMemo(() => {
    return vehicles.filter(
      (v) =>
        v.activeStatus === "Active" &&
        v.operationalStatus !== "Maintenance" &&
        v.operationalStatus !== "Out of Service"
    );
  }, [vehicles]);

  const [workingDate, setWorkingDate] = useState<string>(defaultDate);
  const [driverId, setDriverId] = useState<string>(drivers[0]?.id || "");
  const [vehicleId, setVehicleId] = useState<string>(eligibleVehicles[0]?.id || vehicles[0]?.id || "");
  const [department, setDepartment] = useState<string>(departments[0] || "");
  const [status, setStatus] = useState<AssignmentStatus>("Assigned");
  const [shift, setShift] = useState<"Morning (08:00 - 17:00)" | "Night (20:00 - 05:00)" | "Overtime Shift">(
    "Morning (08:00 - 17:00)"
  );
  const [notes, setNotes] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedDriver = drivers.find((d) => d.id === driverId);
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!workingDate) {
      setErrorMessage("Please select a working date.");
      return;
    }
    if (!driverId) {
      setErrorMessage("Please select a driver from the master list.");
      return;
    }
    if (!vehicleId) {
      setErrorMessage("Please select a vehicle from the fleet list.");
      return;
    }

    const res = onSave({
      workingDate,
      driverId,
      vehicleId,
      department,
      status,
      shift,
      notes: notes.trim() || undefined,
    });

    if (!res.success && res.error) {
      setErrorMessage(res.error);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)" }}
      >
        <div className="panel-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Create Daily Vehicle Assignment</div>
            <div className="panel-subtitle">
              Assign driver to material handling vehicle for operational duty
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: "#64748b", cursor: "pointer", padding: 4 }}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && (
            <div className="modal-error">
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>Validation Conflict:</strong> {errorMessage}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Working Date *
              <input
                type="date"
                className="field"
                value={workingDate}
                onChange={(e) => setWorkingDate(e.target.value)}
                required
              />
            </label>

            <label className="form-field">
              Shift Schedule
              <select
                className="field"
                value={shift}
                onChange={(e) => setShift(e.target.value as any)}
              >
                <option value="Morning (08:00 - 17:00)">Morning (08:00 - 17:00)</option>
                <option value="Night (20:00 - 05:00)">Night (20:00 - 05:00)</option>
                <option value="Overtime Shift">Overtime Shift</option>
              </select>
            </label>
          </div>

          <label className="form-field">
            Driver Name *
            <select
              className="field"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              required
            >
              {drivers.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name} ({d.employeeId}) · {d.department}
                </option>
              ))}
            </select>
            {selectedDriver && (
              <div style={{ fontSize: 10, color: "#64748b", marginTop: -2 }}>
                License: {selectedDriver.licenseType} | Phone: {selectedDriver.phone || "N/A"}
              </div>
            )}
          </label>

          <label className="form-field">
            Vehicle Number *
            <select
              className="field"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              required
            >
              {eligibleVehicles.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.vehicleId || v.number} - {v.vehicleType} ({v.registrationNumber || "No Reg"}) - {v.description}
                </option>
              ))}
              {eligibleVehicles.length === 0 && (
                <option value="" disabled>
                  No eligible active vehicles available in fleet
                </option>
              )}
            </select>
            {selectedVehicle && (
              <div style={{ fontSize: 10, color: "#64748b", marginTop: -2 }}>
                Type: {selectedVehicle.vehicleType} | Reg: {selectedVehicle.registrationNumber || "N/A"} | Dept: {selectedVehicle.department} | Status: {selectedVehicle.operationalStatus}
              </div>
            )}
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
                {departments.map((dep) => (
                  <option value={dep} key={dep}>
                    {dep}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              Assignment Status *
              <select
                className="field"
                value={status}
                onChange={(e) => setStatus(e.target.value as AssignmentStatus)}
                required
              >
                <option value="Pending Assignment">Pending Assignment</option>
                <option value="Assigned">Assigned</option>
                <option value="In Progress">In Progress</option>
              </select>
            </label>
          </div>

          <label className="form-field">
            Operational Notes / Instructions (Optional)
            <textarea
              className="field"
              style={{ minHeight: 65, resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Coil Yard staging duty, check battery before route, transfer heavy coils from Line 1..."
            />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button">
            Save Assignment
          </button>
        </div>
      </form>
    </div>
  );
}

// ==========================================
// MODAL: EDIT / REASSIGN ASSIGNMENT
// ==========================================
function EditAssignmentModal({
  assignment,
  drivers,
  vehicles,
  departments,
  onClose,
  onSave,
}: {
  assignment: VehicleAssignment;
  drivers: Driver[];
  vehicles: Vehicle[];
  departments: string[];
  onClose: () => void;
  onSave: (form: {
    driverId: string;
    vehicleId: string;
    department: string;
    status: AssignmentStatus;
    notes?: string;
    changeReason?: string;
  }) => { success: boolean; error?: string };
}) {
  const [driverId, setDriverId] = useState<string>(assignment.driverId);
  const [vehicleId, setVehicleId] = useState<string>(assignment.vehicleId);
  const [department, setDepartment] = useState<string>(assignment.department);
  const [status, setStatus] = useState<AssignmentStatus>(assignment.status);
  const [notes, setNotes] = useState<string>(assignment.notes || "");
  const [changeReason, setChangeReason] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eligibleVehicles = useMemo(() => {
    return vehicles.filter(
      (v) =>
        (v.activeStatus === "Active" &&
          v.operationalStatus !== "Maintenance" &&
          v.operationalStatus !== "Out of Service") ||
        v.id === assignment.vehicleId ||
        v.vehicleId === assignment.vehicleNumber
    );
  }, [vehicles, assignment]);

  const selectableDrivers = useMemo(() => {
    const list = [...drivers];
    const currentAlreadyPresent = list.some(
      (d) => d.id === assignment.driverId || d.employeeId === assignment.driverEmployeeId
    );
    if (!currentAlreadyPresent) {
      list.unshift({
        id: assignment.driverId,
        name: `${assignment.driverName} (Assigned Driver)`,
        employeeId: assignment.driverEmployeeId,
        department: assignment.department,
        licenseType: "Assigned License",
        phone: "",
        status: "Active",
      });
    }
    return list;
  }, [drivers, assignment]);

  const hasDriverChanged = driverId !== assignment.driverId;
  const hasVehicleChanged = vehicleId !== assignment.vehicleId;
  const hasResourceChanged = hasDriverChanged || hasVehicleChanged;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (hasResourceChanged && !changeReason.trim()) {
      setErrorMessage("Please enter an official Change Reason to record in the assignment audit log.");
      return;
    }

    const res = onSave({
      driverId,
      vehicleId,
      department,
      status,
      notes: notes.trim() || undefined,
      changeReason: changeReason.trim() || undefined,
    });

    if (!res.success && res.error) {
      setErrorMessage(res.error);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)" }}
      >
        <div className="panel-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Edit / Reassign Assignment</div>
            <div className="panel-subtitle">
              ID: {assignment.id} · Date: {assignment.workingDate}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: "#64748b", cursor: "pointer", padding: 4 }}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && (
            <div className="modal-error">
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>Validation Conflict:</strong> {errorMessage}
              </div>
            </div>
          )}

          <div
            style={{
              background: "#f8fafc",
              padding: "10px 14px",
              borderRadius: 4,
              border: "1px solid #e2e8f0",
              fontSize: 11,
              color: "#475569",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            <div>Current Driver: <strong>{assignment.driverName}</strong></div>
            <div>Current Vehicle: <strong>{assignment.vehicleNumber}</strong></div>
            <div>Working Date: <strong>{assignment.workingDate}</strong></div>
            <div>Current Status: <strong>{assignment.status}</strong></div>
          </div>

          <label className="form-field">
            Assigned Driver
            <select
              className="field"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              required
            >
              {selectableDrivers.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name} ({d.employeeId}) · {d.department}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            Assigned Vehicle
            <select
              className="field"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              required
            >
              {eligibleVehicles.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.vehicleId || v.number} - {v.vehicleType} ({v.registrationNumber || "No Reg"}) - {v.description}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Department / Section
              <select
                className="field"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                required
              >
                {departments.map((dep) => (
                  <option value={dep} key={dep}>
                    {dep}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              Assignment Status
              <select
                className="field"
                value={status}
                onChange={(e) => setStatus(e.target.value as AssignmentStatus)}
                required
              >
                <option value="Pending Assignment">Pending Assignment</option>
                <option value="Assigned">Assigned</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </label>
          </div>

          {hasResourceChanged && (
            <div
              style={{
                background: "#fef9c3",
                border: "1px solid #fde047",
                padding: "10px 14px",
                borderRadius: 4,
              }}
            >
              <label className="form-field" style={{ color: "#713f12" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ArrowRightLeft size={14} />
                  Change Reason (Mandatory for Audit Trail) *
                </span>
                <input
                  className="field"
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="e.g. Vehicle battery flat, re-allocated to urgent coil transfer, driver shift swap"
                  required
                />
              </label>
            </div>
          )}

          <label className="form-field">
            Operational Notes / Instructions
            <textarea
              className="field"
              style={{ minHeight: 60, resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Operational notes for this assignment..."
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

// ==========================================
// MODAL: ASSIGNMENT AUDIT HISTORY
// ==========================================
function AssignmentHistoryModal({
  assignment,
  onClose,
}: {
  assignment: VehicleAssignment;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width: "min(640px, 100%)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Assignment History & Audit Trail</div>
            <div className="panel-subtitle">
              Record: {assignment.id} · Driver: {assignment.driverName} · Vehicle: {assignment.vehicleNumber}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: "#64748b", cursor: "pointer", padding: 4 }}
          >
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {assignment.history.map((log, index) => (
              <div
                key={log.id || index}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  padding: "12px 14px",
                  background: index === 0 ? "#f8fafc" : "#fff",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid #f1f5f9",
                    paddingBottom: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 3,
                        background:
                          log.action === "Created"
                            ? "#dcfce7"
                            : log.action === "Cancelled"
                            ? "#fee2e2"
                            : "#e0f2fe",
                        color:
                          log.action === "Created"
                            ? "#15803d"
                            : log.action === "Cancelled"
                            ? "#b91c1c"
                            : "#0369a1",
                      }}
                    >
                      {log.action}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>
                      by {log.officerName}
                    </span>
                  </div>

                  <span style={{ fontSize: 10, color: "#64748b" }}>
                    {log.timestamp}
                  </span>
                </div>

                <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
                  {log.previousDriver && log.newDriver && (
                    <div>
                      Driver Reassigned: <span style={{ textDecoration: "line-through", color: "#94a3b8" }}>{log.previousDriver}</span> ➔ <strong>{log.newDriver}</strong>
                    </div>
                  )}
                  {log.previousVehicle && log.newVehicle && (
                    <div>
                      Vehicle Reassigned: <span style={{ textDecoration: "line-through", color: "#94a3b8" }}>{log.previousVehicle}</span> ➔ <strong>{log.newVehicle}</strong>
                    </div>
                  )}
                  {log.previousStatus && log.newStatus && (
                    <div>
                      Status: {log.previousStatus} ➔ <strong>{log.newStatus}</strong>
                    </div>
                  )}
                  {log.reason && (
                    <div style={{ marginTop: 4, fontStyle: "italic", color: "#64748b" }}>
                      Reason: "{log.reason}"
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
