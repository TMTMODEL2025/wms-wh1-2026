/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import {
  Truck,
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
  FileText
} from "lucide-react";
import {
  Vehicle,
  VehicleType,
  VehicleActiveStatus,
  VehicleOperationalStatus,
  VehicleAssignment
} from "../types/officer";
import { MASTER_DEPARTMENTS } from "../data/officerData";

interface VehicleManagementProps {
  vehicles: Vehicle[];
  assignments: VehicleAssignment[];
  onUpdateVehicles: (updated: Vehicle[]) => void;
  onNavigateToAssignment?: () => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
}

export function VehicleManagement({
  vehicles,
  assignments,
  onUpdateVehicles,
  onNavigateToAssignment,
  onLogTransaction,
}: VehicleManagementProps) {
  // Search & Filter state
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("All");
  const [filterActiveStatus, setFilterActiveStatus] = useState<string>("All");
  const [filterOperationalStatus, setFilterOperationalStatus] = useState<string>("All");

  // Modals state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [viewingVehicle, setViewingVehicle] = useState<Vehicle | null>(null);

  // In-place confirmation state for Deactivation
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const todayDate = new Date().toISOString().slice(0, 10);

  // Compute live active assignment for each vehicle on today's date
  const vehicleAssignmentMap = useMemo(() => {
    const map = new Map<string, VehicleAssignment>();
    assignments.forEach((a) => {
      if (
        a.workingDate === todayDate &&
        (a.status === "Assigned" || a.status === "In Progress")
      ) {
        map.set(a.vehicleId, a);
        map.set(a.vehicleNumber, a);
      }
    });
    return map;
  }, [assignments, todayDate]);

  // Dynamic operational status resolver
  const getResolvedOperationalStatus = (vehicle: Vehicle): VehicleOperationalStatus => {
    if (vehicle.activeStatus === "Inactive") {
      return vehicle.operationalStatus === "Maintenance" ? "Maintenance" : "Out of Service";
    }
    if (vehicle.operationalStatus === "Maintenance") {
      return "Maintenance";
    }
    if (vehicle.operationalStatus === "Out of Service") {
      return "Out of Service";
    }
    const currentActiveAssignment = vehicleAssignmentMap.get(vehicle.vehicleId) || vehicleAssignmentMap.get(vehicle.id);
    if (currentActiveAssignment) {
      return "In Use";
    }
    return vehicle.operationalStatus;
  };

  // Fleet summary KPIs
  const metrics = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter((v) => v.activeStatus === "Active").length;
    const inactive = vehicles.filter((v) => v.activeStatus === "Inactive").length;

    let inUse = 0;
    let maintenance = 0;
    let outOfService = 0;
    let available = 0;

    vehicles.forEach((v) => {
      const status = getResolvedOperationalStatus(v);
      if (status === "In Use") inUse++;
      else if (status === "Maintenance") maintenance++;
      else if (status === "Out of Service") outOfService++;
      else if (v.activeStatus === "Active") available++;
    });

    return { total, active, inactive, inUse, maintenance, outOfService, available };
  }, [vehicles, vehicleAssignmentMap]);

  // Filtered vehicles
  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => {
      if (searchKeyword.trim()) {
        const query = searchKeyword.toLowerCase();
        const searchable = [
          vehicle.vehicleId,
          vehicle.number,
          vehicle.registrationNumber || "",
          vehicle.description,
          vehicle.vehicleType,
          vehicle.department,
        ]
          .join(" ")
          .toLowerCase();

        if (!searchable.includes(query)) return false;
      }

      if (filterType !== "All" && vehicle.vehicleType !== filterType) {
        return false;
      }

      if (filterActiveStatus !== "All" && vehicle.activeStatus !== filterActiveStatus) {
        return false;
      }

      if (filterOperationalStatus !== "All") {
        const resolved = getResolvedOperationalStatus(vehicle);
        if (resolved !== filterOperationalStatus) {
          return false;
        }
      }

      return true;
    });
  }, [vehicles, searchKeyword, filterType, filterActiveStatus, filterOperationalStatus, vehicleAssignmentMap]);

  // HANDLER: ADD VEHICLE
  const handleAddVehicle = (form: {
    vehicleId: string;
    vehicleType: VehicleType;
    description: string;
    registrationNumber: string;
    department: string;
    capacityTon?: number;
    operationalStatus: VehicleOperationalStatus;
    activeStatus: VehicleActiveStatus;
  }) => {
    const trimmedId = form.vehicleId.trim().toUpperCase();

    const exists = vehicles.some(
      (v) => v.vehicleId.toUpperCase() === trimmedId || v.number.toUpperCase() === trimmedId
    );

    if (exists) {
      return {
        success: false,
        error: `Vehicle ID "${trimmedId}" is already registered in the system. Vehicle ID must be unique.`,
      };
    }

    const now = new Date();
    const timestampStr =
      now.toLocaleDateString("en-CA") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const newVehicle: Vehicle = {
      id: `VEH-${String(vehicles.length + 1).padStart(3, "0")}`,
      vehicleId: trimmedId,
      number: trimmedId,
      vehicleType: form.vehicleType,
      type: `${form.vehicleType} ${form.capacityTon ? `${form.capacityTon}T` : ""}`.trim(),
      description: form.description.trim(),
      registrationNumber: form.registrationNumber.trim() || `TMT-${trimmedId}`,
      department: form.department,
      capacityTon: form.capacityTon,
      operationalStatus: form.operationalStatus,
      activeStatus: form.activeStatus,
      status: form.operationalStatus === "Maintenance" ? "Maintenance" : form.activeStatus === "Inactive" ? "Inactive" : "Available",
      createdAt: timestampStr,
      updatedAt: timestampStr,
    };

    const updatedList = [...vehicles, newVehicle];
    onUpdateVehicles(updatedList);
    setShowAddModal(false);
    showToast(`Vehicle ${newVehicle.vehicleId} registered successfully and added to fleet.`);

    onLogTransaction?.(
      `Registered new vehicle ${newVehicle.vehicleId} (${newVehicle.vehicleType})`,
      newVehicle.vehicleId,
      "Completed"
    );

    return { success: true };
  };

  // HANDLER: EDIT VEHICLE
  const handleEditVehicle = (form: {
    vehicleType: VehicleType;
    description: string;
    registrationNumber: string;
    department: string;
    capacityTon?: number;
    operationalStatus: VehicleOperationalStatus;
  }) => {
    if (!editingVehicle) return { success: false, error: "No vehicle selected" };

    const now = new Date();
    const timestampStr =
      now.toLocaleDateString("en-CA") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const updatedVehicle: Vehicle = {
      ...editingVehicle,
      vehicleType: form.vehicleType,
      type: `${form.vehicleType} ${form.capacityTon ? `${form.capacityTon}T` : ""}`.trim(),
      description: form.description.trim(),
      registrationNumber: form.registrationNumber.trim(),
      department: form.department,
      capacityTon: form.capacityTon,
      operationalStatus: form.operationalStatus,
      status: form.operationalStatus === "Maintenance" ? "Maintenance" : editingVehicle.activeStatus === "Inactive" ? "Inactive" : "Available",
      updatedAt: timestampStr,
    };

    const updatedList = vehicles.map((v) => (v.id === editingVehicle.id ? updatedVehicle : v));
    onUpdateVehicles(updatedList);
    setEditingVehicle(null);
    showToast(`Vehicle ${editingVehicle.vehicleId} information updated successfully.`);

    onLogTransaction?.(
      `Updated vehicle specification for ${editingVehicle.vehicleId}`,
      editingVehicle.vehicleId,
      "Completed"
    );

    return { success: true };
  };

  // HANDLER: IN-PLACE ACTIVATE / DEACTIVATE
  const handleDirectToggleActiveStatus = (targetVehicle: Vehicle) => {
    const newActiveStatus: VehicleActiveStatus =
      targetVehicle.activeStatus === "Active" ? "Inactive" : "Active";

    const now = new Date();
    const timestampStr =
      now.toLocaleDateString("en-CA") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const updatedVehicle: Vehicle = {
      ...targetVehicle,
      activeStatus: newActiveStatus,
      status: newActiveStatus === "Inactive" ? "Inactive" : targetVehicle.operationalStatus === "Maintenance" ? "Maintenance" : "Available",
      updatedAt: timestampStr,
    };

    const updatedList = vehicles.map((v) => (v.id === targetVehicle.id ? updatedVehicle : v));
    onUpdateVehicles(updatedList);

    const actionText = newActiveStatus === "Active" ? "activated" : "deactivated";
    showToast(`Vehicle ${targetVehicle.vehicleId} has been ${actionText}.`);

    onLogTransaction?.(
      `Vehicle ${targetVehicle.vehicleId} ${actionText}`,
      targetVehicle.vehicleId,
      newActiveStatus === "Active" ? "Completed" : "Attention"
    );

    setConfirmingDeactivateId(null);
  };

  return (
    <div className="vehicle-management-module">
      {/* Toast */}
      {toastMessage && (
        <div
          className="toast"
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

      {/* KPI Summary Cards */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total Fleet Size</div>
          <div className="kpi-value">{metrics.total}</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#15803d" }}>
          <div className="kpi-label">Active Fleet Available</div>
          <div className="kpi-value" style={{ color: "#15803d" }}>
            {metrics.available}
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#0284c7" }}>
          <div className="kpi-label">Currently In Use (Today)</div>
          <div className="kpi-value" style={{ color: "#0369a1" }}>
            {metrics.inUse}
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#d97706" }}>
          <div className="kpi-label">Maintenance & Standby</div>
          <div className="kpi-value" style={{ color: "#b45309" }}>
            {metrics.maintenance + metrics.outOfService}
          </div>
        </div>
      </div>

      {/* Main Panel */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Fleet & Vehicle Management Registry</div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              className="button"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={14} />
              + Add Vehicle
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="filterbar">
          <div style={{ position: "relative", flex: 1, minWidth: 200, display: "flex", alignItems: "center" }}>
            <Search size={14} style={{ position: "absolute", left: 10, color: "#82919c" }} />
            <input
              className="field search-field"
              style={{ paddingLeft: 30 }}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="Search Vehicle ID (e.g. TT-01), Registration, description..."
              aria-label="Search vehicles"
            />
          </div>

          {/* Type filter */}
          <select
            className="field"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filter by Vehicle Type"
            title="Filter by Vehicle Type"
          >
            <option value="All">All Vehicle Types</option>
            <option value="Tugger">Tugger</option>
            <option value="Forklift">Forklift</option>
            <option value="Tractor">Tractor</option>
            <option value="Other">Other</option>
          </select>

          {/* Active status filter */}
          <select
            className="field"
            value={filterActiveStatus}
            onChange={(e) => setFilterActiveStatus(e.target.value)}
            aria-label="Filter by Vehicle Status"
            title="Filter by Vehicle Status"
          >
            <option value="All">All Active Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          {/* Operational status filter */}
          <select
            className="field"
            value={filterOperationalStatus}
            onChange={(e) => setFilterOperationalStatus(e.target.value)}
            aria-label="Filter by Operational Status"
            title="Filter by Operational Status"
          >
            <option value="All">All Operational Statuses</option>
            <option value="Available">Available</option>
            <option value="In Use">In Use</option>
            <option value="Maintenance">Maintenance</option>
            <option value="Out of Service">Out of Service</option>
          </select>

          <button
            className="button secondary"
            onClick={() => {
              setSearchKeyword("");
              setFilterType("All");
              setFilterActiveStatus("All");
              setFilterOperationalStatus("All");
            }}
            title="Reset filters"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>

        {/* Vehicle Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Vehicle ID</th>
                <th>Vehicle Type</th>
                <th>Vehicle Description</th>
                <th>Registration No.</th>
                <th>Assigned Driver (Today)</th>
                <th>Vehicle Status</th>
                <th>Operational Status</th>
                <th>Last Updated</th>
                <th style={{ textAlign: "right", paddingRight: 20 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map((vehicle) => {
                const assignedToday =
                  vehicleAssignmentMap.get(vehicle.vehicleId) ||
                  vehicleAssignmentMap.get(vehicle.id);
                const resolvedOpStatus = getResolvedOperationalStatus(vehicle);
                const isInactive = vehicle.activeStatus === "Inactive";
                const isConfirming = confirmingDeactivateId === vehicle.id;

                return (
                  <tr
                    key={vehicle.id}
                    style={{
                      opacity: isInactive ? 0.6 : 1,
                    }}
                  >
                    <td>
                      <span className="code" style={{ fontSize: 13, fontWeight: 700 }}>
                        {vehicle.vehicleId}
                      </span>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#8a9ba8" }}>{vehicle.id}</div>
                    </td>

                    <td>
                      <span className="table-item-name"
                        style={{
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Truck size={13} color="#087eaf" />
                        {vehicle.vehicleType}
                      </span>
                      {vehicle.capacityTon && (
                        <div className="table-sub-text" style={{ fontSize: 10, color: "#8a9ba8" }}>
                          Cap: {vehicle.capacityTon} TON
                        </div>
                      )}
                    </td>

                    <td>
                      <div className="table-item-name" style={{ fontWeight: 600 }}>
                        {vehicle.description}
                      </div>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#8a9ba8" }}>
                        Dept: {vehicle.department}
                      </div>
                    </td>

                    <td>
                      <span className="code"
                        style={{
                          fontFamily: "'Noto Sans Thai', sans-serif",
                          fontVariantNumeric: "tabular-nums",
                          padding: "2px 6px",
                          borderRadius: 3,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {vehicle.registrationNumber || "N/A"}
                      </span>
                    </td>

                    <td>
                      {assignedToday ? (
                        <div>
                          <div className="table-item-name" style={{ fontWeight: 700, color: "#0369a1" }}>
                            {assignedToday.driverName}
                          </div>
                          <div className="table-sub-text" style={{ fontSize: 10, color: "#8a9ba8" }}>
                            {assignedToday.shift?.split(" ")[0] || "Shift"} · {assignedToday.status}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 11 }}>
                          Unassigned
                        </span>
                      )}
                    </td>

                    <td>
                      <VehicleActiveStatusBadge status={vehicle.activeStatus} />
                    </td>

                    <td>
                      <VehicleOperationalStatusBadge status={resolvedOpStatus} />
                    </td>

                    <td>
                      <div style={{ fontSize: 11 }}>
                        {vehicle.updatedAt}
                      </div>
                    </td>

                    <td style={{ textAlign: "right", paddingRight: 16 }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <button
                          className="button secondary"
                          style={{ padding: "5px 8px", fontSize: 11 }}
                          onClick={() => setViewingVehicle(vehicle)}
                          title="View detailed vehicle information and assignment history"
                        >
                          <Eye size={12} />
                          Details
                        </button>

                        <button
                          className="button secondary"
                          style={{ padding: "5px 8px", fontSize: 11 }}
                          onClick={() => setEditingVehicle(vehicle)}
                          title="Edit vehicle attributes and operational status"
                        >
                          <Edit3 size={12} />
                          Edit
                        </button>

                        {/* In-place Confirmation for Deactivation */}
                        <button
                          className={`button ${
                            isConfirming
                              ? "danger"
                              : vehicle.activeStatus === "Active"
                              ? "secondary"
                              : ""
                          }`}
                          style={{
                            padding: "5px 8px",
                            fontSize: 11,
                            color: isConfirming
                              ? "#fff"
                              : vehicle.activeStatus === "Active"
                              ? "#b91c1c"
                              : "#fff",
                            borderColor: isConfirming
                              ? "#dc2626"
                              : vehicle.activeStatus === "Active"
                              ? "#fca5a5"
                              : undefined,
                            background: isConfirming
                              ? "#dc2626"
                              : vehicle.activeStatus === "Active"
                              ? undefined
                              : "#15803d",
                          }}
                          onClick={() => {
                            if (vehicle.activeStatus === "Inactive") {
                              handleDirectToggleActiveStatus(vehicle);
                            } else {
                              if (isConfirming) {
                                handleDirectToggleActiveStatus(vehicle);
                              } else {
                                setConfirmingDeactivateId(vehicle.id);
                                setTimeout(() => setConfirmingDeactivateId((prev) => (prev === vehicle.id ? null : prev)), 4000);
                              }
                            }
                          }}
                          title={
                            vehicle.activeStatus === "Active"
                              ? "Deactivate vehicle"
                              : "Reactivate vehicle"
                          }
                        >
                          <Power size={12} />
                          {vehicle.activeStatus === "Inactive"
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

              {filteredVehicles.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty" style={{ padding: "45px 20px" }}>
                      <AlertTriangle size={24} style={{ color: "#94a3b8", marginBottom: 8 }} />
                      <div style={{ fontWeight: 600 }}>
                        No vehicles found matching current search or filter criteria
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
            fontSize: 11,
            color: "#647786",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            Showing <strong>{filteredVehicles.length}</strong> of <strong>{vehicles.length}</strong> total fleet assets
          </div>
        </div>
      </section>

      {/* MODAL 1: ADD VEHICLE */}
      {showAddModal && (
        <AddVehicleModal
          departments={MASTER_DEPARTMENTS}
          onClose={() => setShowAddModal(false)}
          onSave={handleAddVehicle}
        />
      )}

      {/* MODAL 2: EDIT VEHICLE */}
      {editingVehicle && (
        <EditVehicleModal
          vehicle={editingVehicle}
          departments={MASTER_DEPARTMENTS}
          onClose={() => setEditingVehicle(null)}
          onSave={handleEditVehicle}
        />
      )}

      {/* MODAL 3: VIEW VEHICLE DETAILS */}
      {viewingVehicle && (
        <VehicleDetailsModal
          vehicle={viewingVehicle}
          activeAssignment={
            vehicleAssignmentMap.get(viewingVehicle.vehicleId) ||
            vehicleAssignmentMap.get(viewingVehicle.id)
          }
          allAssignments={assignments.filter(
            (a) => a.vehicleId === viewingVehicle.id || a.vehicleNumber === viewingVehicle.vehicleId
          )}
          resolvedStatus={getResolvedOperationalStatus(viewingVehicle)}
          onClose={() => setViewingVehicle(null)}
          onEdit={() => {
            const v = viewingVehicle;
            setViewingVehicle(null);
            setEditingVehicle(v);
          }}
        />
      )}
    </div>
  );
}

// BADGE COMPONENTS
function VehicleActiveStatusBadge({ status }: { status: VehicleActiveStatus }) {
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

function VehicleOperationalStatusBadge({ status }: { status: VehicleOperationalStatus }) {
  switch (status) {
    case "Available":
      return (
        <span className="status status-available">
          <CheckCircle2 size={11} />
          Available
        </span>
      );
    case "In Use":
      return (
        <span className="status status-inuse">
          <span className="dot dot-inuse" />
          In Use
        </span>
      );
    case "Maintenance":
      return (
        <span className="status status-maintenance">
          <Clock size={11} />
          Maintenance
        </span>
      );
    case "Out of Service":
      return (
        <span className="status status-outofservice">
          <AlertTriangle size={11} />
          Out of Service
        </span>
      );
    default:
      return <span className="status">{status}</span>;
  }
}

// MODAL: ADD VEHICLE
function AddVehicleModal({
  departments,
  onClose,
  onSave,
}: {
  departments: string[];
  onClose: () => void;
  onSave: (form: {
    vehicleId: string;
    vehicleType: VehicleType;
    description: string;
    registrationNumber: string;
    department: string;
    capacityTon?: number;
    operationalStatus: VehicleOperationalStatus;
    activeStatus: VehicleActiveStatus;
  }) => { success: boolean; error?: string };
}) {
  const [vehicleId, setVehicleId] = useState<string>("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("Tugger");
  const [description, setDescription] = useState<string>("");
  const [registrationNumber, setRegistrationNumber] = useState<string>("");
  const [department, setDepartment] = useState<string>(departments[0] || "Material Handling - Fleet");
  const [capacityTon, setCapacityTon] = useState<string>("");
  const [operationalStatus, setOperationalStatus] = useState<VehicleOperationalStatus>("Available");
  const [activeStatus, setActiveStatus] = useState<VehicleActiveStatus>("Active");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!vehicleId.trim()) {
      setErrorMessage("Please specify a unique Vehicle ID (e.g. TT-06, FL-003).");
      return;
    }
    if (!description.trim()) {
      setErrorMessage("Please enter a vehicle description or model.");
      return;
    }

    const res = onSave({
      vehicleId: vehicleId.trim(),
      vehicleType,
      description: description.trim(),
      registrationNumber: registrationNumber.trim(),
      department,
      capacityTon: capacityTon ? parseFloat(capacityTon) : undefined,
      operationalStatus,
      activeStatus,
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
        style={{ width: "min(560px, 100%)" }}
      >
        <div className="panel-header vehicle-modal-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Register New Fleet Vehicle</div>
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
                <strong>Validation Error:</strong> {errorMessage}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Vehicle ID *
              <input
                className="field"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                placeholder="e.g. TT-06, FL-003, TR-003"
                required
                autoFocus
              />
            </label>

            <label className="form-field">
              Vehicle Type *
              <select
                className="field"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                required
              >
                <option value="Tugger">Tugger</option>
                <option value="Forklift">Forklift</option>
                <option value="Tractor">Tractor</option>
                <option value="Other">Other</option>
              </select>
            </label>
          </div>

          <label className="form-field">
            Vehicle Description / Model *
            <input
              className="field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Electric Tow Tugger 5.0T - Heavy Duty Battery"
              required
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Registration Number
              <input
                className="field"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="e.g. 1กก-4823 BKK or 70-3495 HY"
              />
            </label>

            <label className="form-field">
              Capacity Rating (TON)
              <input
                className="field"
                type="number"
                step="0.5"
                min="0"
                value={capacityTon}
                onChange={(e) => setCapacityTon(e.target.value)}
                placeholder="e.g. 5.0"
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Assigned Department / Section *
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
              Operational Status *
              <select
                className="field"
                value={operationalStatus}
                onChange={(e) => setOperationalStatus(e.target.value as VehicleOperationalStatus)}
                required
              >
                <option value="Available">Available (Ready for assignment)</option>
                <option value="Maintenance">Maintenance (Under repair)</option>
                <option value="Out of Service">Out of Service (Standby)</option>
              </select>
            </label>
          </div>

          <label className="form-field">
            Active Status *
            <select
              className="field"
              value={activeStatus}
              onChange={(e) => setActiveStatus(e.target.value as VehicleActiveStatus)}
              required
            >
              <option value="Active">Active (Eligible for operational assignments)</option>
              <option value="Inactive">Inactive (Decommissioned / Standby)</option>
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button">
            Save Vehicle
          </button>
        </div>
      </form>
    </div>
  );
}

// MODAL: EDIT VEHICLE
function EditVehicleModal({
  vehicle,
  departments,
  onClose,
  onSave,
}: {
  vehicle: Vehicle;
  departments: string[];
  onClose: () => void;
  onSave: (form: {
    vehicleType: VehicleType;
    description: string;
    registrationNumber: string;
    department: string;
    capacityTon?: number;
    operationalStatus: VehicleOperationalStatus;
  }) => { success: boolean; error?: string };
}) {
  const [vehicleType, setVehicleType] = useState<VehicleType>(vehicle.vehicleType);
  const [description, setDescription] = useState<string>(vehicle.description);
  const [registrationNumber, setRegistrationNumber] = useState<string>(vehicle.registrationNumber || "");
  const [department, setDepartment] = useState<string>(vehicle.department);
  const [capacityTon, setCapacityTon] = useState<string>(vehicle.capacityTon ? String(vehicle.capacityTon) : "");
  const [operationalStatus, setOperationalStatus] = useState<VehicleOperationalStatus>(vehicle.operationalStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!description.trim()) {
      setErrorMessage("Please provide a vehicle description.");
      return;
    }

    const res = onSave({
      vehicleType,
      description: description.trim(),
      registrationNumber: registrationNumber.trim(),
      department,
      capacityTon: capacityTon ? parseFloat(capacityTon) : undefined,
      operationalStatus,
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
        style={{ width: "min(560px, 100%)" }}
      >
        <div className="panel-header vehicle-modal-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Edit Vehicle: {vehicle.vehicleId}</div>
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
                <strong>Validation Error:</strong> {errorMessage}
              </div>
            </div>
          )}

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
              marginBottom: 12,
            }}
          >
            <div>Vehicle ID: <strong>{vehicle.vehicleId}</strong></div>
            <div>Asset Code: <strong>{vehicle.id}</strong></div>
            <div>Active Status: <strong>{vehicle.activeStatus}</strong></div>
            <div>Created Date: <strong>{vehicle.createdAt}</strong></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              Vehicle Type *
              <select
                className="field"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                required
              >
                <option value="Tugger">Tugger</option>
                <option value="Forklift">Forklift</option>
                <option value="Tractor">Tractor</option>
                <option value="Other">Other</option>
              </select>
            </label>

            <label className="form-field">
              Registration Number
              <input
                className="field"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="e.g. 1กก-4821 BKK"
              />
            </label>
          </div>

          <label className="form-field">
            Vehicle Description / Model *
            <input
              className="field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              Capacity Rating (TON)
              <input
                className="field"
                type="number"
                step="0.5"
                min="0"
                value={capacityTon}
                onChange={(e) => setCapacityTon(e.target.value)}
              />
            </label>
          </div>

          <label className="form-field">
            Operational Status *
            <select
              className="field"
              value={operationalStatus}
              onChange={(e) => setOperationalStatus(e.target.value as VehicleOperationalStatus)}
              required
            >
              <option value="Available">Available (Ready for assignment)</option>
              <option value="Maintenance">Maintenance (Under repair / servicing)</option>
              <option value="Out of Service">Out of Service (Standby / Inactive)</option>
            </select>
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

// MODAL: VEHICLE DETAILS & ASSIGNMENT HISTORY
function VehicleDetailsModal({
  vehicle,
  activeAssignment,
  allAssignments,
  resolvedStatus,
  onClose,
  onEdit,
}: {
  vehicle: Vehicle;
  activeAssignment?: VehicleAssignment;
  allAssignments: VehicleAssignment[];
  resolvedStatus: VehicleOperationalStatus;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal vehicle-modal-card"
        style={{ width: "min(680px, 100%)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel-header vehicle-modal-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="code" style={{ fontSize: 16 }}>{vehicle.vehicleId}</span>
              <span>· {vehicle.description}</span>
            </div>
            <div style={{ fontSize: 11, marginTop: 2 }}>
              Registration: {vehicle.registrationNumber || "Unregistered"} · Department: {vehicle.department}
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

        <div className="modal-body" style={{ maxHeight: "72vh", overflowY: "auto" }}>
          {/* Status highlight banner */}
          <div
            className="vehicle-info-box"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <div className="vehicle-status-label">Current Statuses</div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <VehicleActiveStatusBadge status={vehicle.activeStatus} />
                <VehicleOperationalStatusBadge status={resolvedStatus} />
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div className="vehicle-status-label">Rated Capacity</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                {vehicle.capacityTon ? `${vehicle.capacityTon} TON` : "Standard Fleet"}
              </div>
            </div>
          </div>

          {/* Current Assignment Section */}
          <div className="vehicle-info-box" style={{ border: "1px solid #dbeafe", borderRadius: 6, padding: "14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <Clock size={14} />
              Current Working Assignment (Today: 2026-10-12)
            </div>

            {activeAssignment ? (
              <div style={{ fontSize: 11, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  Assigned Driver: <strong>{activeAssignment.driverName}</strong> ({activeAssignment.driverEmployeeId})
                </div>
                <div>
                  Shift: <strong>{activeAssignment.shift || "Morning Shift"}</strong>
                </div>
                <div>
                  Assignment ID: <strong>{activeAssignment.id}</strong>
                </div>
                <div>
                  Status: <strong>{activeAssignment.status}</strong>
                </div>
                {activeAssignment.notes && (
                  <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
                    Operational Notes: <em>{activeAssignment.notes}</em>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 11 }}>
                No active assignment logged for today. Vehicle is currently available in the yard buffer.
              </div>
            )}
          </div>

          {/* Vehicle Specifications Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11 }}>
            <div className="vehicle-spec-box" style={{ padding: "8px 12px", border: "1px solid #f1f5f9", borderRadius: 4 }}>
              <span>Internal Asset ID: </span>
              <strong>{vehicle.id}</strong>
            </div>
            <div className="vehicle-spec-box" style={{ padding: "8px 12px", border: "1px solid #f1f5f9", borderRadius: 4 }}>
              <span>Vehicle Type: </span>
              <strong>{vehicle.vehicleType}</strong>
            </div>
            <div className="vehicle-spec-box" style={{ padding: "8px 12px", border: "1px solid #f1f5f9", borderRadius: 4 }}>
              <span>Registration License: </span>
              <strong>{vehicle.registrationNumber || "N/A"}</strong>
            </div>
            <div className="vehicle-spec-box" style={{ padding: "8px 12px", border: "1px solid #f1f5f9", borderRadius: 4 }}>
              <span>Registered Date: </span>
              <strong>{vehicle.createdAt}</strong>
            </div>
          </div>

          {/* Assignment History Timeline */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <FileText size={14} color="#087eaf" />
              Recent Assignment History ({allAssignments.length} records)
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {allAssignments.map((a) => (
                <div
                  key={a.id}
                  className="vehicle-spec-box"
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 4,
                    padding: "10px 12px",
                    fontSize: 11,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {a.driverName} ({a.driverEmployeeId}) · {a.workingDate}
                    </div>
                    <div style={{ fontSize: 10, marginTop: 2 }}>
                      Ref: {a.id} · Dept: {a.department} {a.notes ? `· "${a.notes}"` : ""}
                    </div>
                  </div>

                  <div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 3,
                        background:
                          a.status === "In Progress"
                            ? "#dcfce7"
                            : a.status === "Completed"
                            ? "#f1f5f9"
                            : "#fee2e2",
                        color:
                          a.status === "In Progress"
                            ? "#15803d"
                            : a.status === "Completed"
                            ? "#334155"
                            : "#b91c1c",
                      }}
                    >
                      {a.status}
                    </span>
                  </div>
                </div>
              ))}

              {allAssignments.length === 0 && (
                <div className="vehicle-spec-box" style={{ textAlign: "center", padding: "16px", fontSize: 11, border: "1px dashed #e2e8f0", borderRadius: 4 }}>
                  No historical assignments recorded yet for this vehicle.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            className="button secondary"
            onClick={onEdit}
          >
            Edit Vehicle
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
