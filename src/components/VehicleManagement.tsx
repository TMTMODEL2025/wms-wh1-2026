/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
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
  Box,
  Table2,
  Wrench,
  FileText,
} from "lucide-react";
import {
  Vehicle,
  VehicleType,
  VehicleActiveStatus,
  VehicleOperationalStatus,
  VehicleAssignment
} from "../types/officer";
import { MASTER_DEPARTMENTS } from "../data/officerData";
import {
  getVehicleSearchableText,
  getVehicleTypeDisplayLabel,
  isClampTruckVehicle,
  isElectricTractorVehicle,
  isForkliftVehicle,
  isStandardTractorVehicle,
  isTrailerVehicle,
  matchesVehicleTypeFilter,
  resolveVehicleType,
} from "../utils/vehicleHelpers";
import {
  MhMaintenanceRecord,
  subscribeForkliftCloudRealtimeMode,
  subscribeToMhMaintenance,
} from "../services/forkliftDataService";
import {
  VehicleParkingYard3D,
  isMaintenanceRecordOpen,
  resolveOpenRepairMeta,
} from "./fleet3d/VehicleParkingYard3D";

interface VehicleManagementProps {
  vehicles: Vehicle[];
  assignments: VehicleAssignment[];
  onUpdateVehicles: (updated: Vehicle[]) => void;
  onNavigateToAssignment?: () => void;
  onNavigateToFixFlush?: () => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
}

export function VehicleManagement({
  vehicles,
  assignments,
  onUpdateVehicles,
  onNavigateToAssignment,
  onNavigateToFixFlush,
  onLogTransaction,
}: VehicleManagementProps) {
  // View mode: Table vs 3D Parking Yard (defaults to 3D Parking Yard)
  const [viewMode, setViewMode] = useState<"table" | "yard3d">("yard3d");

  // Live Maintenance / Repair records from FixFlush (ระบบแจ้งซ่อม)
  const [maintenanceRecords, setMaintenanceRecords] = useState<MhMaintenanceRecord[]>([]);
  const [cloudRealtimeTick, setCloudRealtimeTick] = useState<number>(0);

  useEffect(() => {
    const unsubMode = subscribeForkliftCloudRealtimeMode(() => {
      setCloudRealtimeTick((prev) => prev + 1);
    });
    return unsubMode;
  }, []);

  useEffect(() => {
    const unsub = subscribeToMhMaintenance(
      (records) => {
        setMaintenanceRecords(records);
      },
      (err) => {
        console.warn("VehicleManagement: failed to subscribe to mh_maintenance", err);
      }
    );
    return () => {
      unsub();
    };
  }, [cloudRealtimeTick]);

  // Category Tab & Search & Filter state
  const [activeTab, setActiveTab] = useState<
    "all" | "tractor" | "ev_tractor" | "forklift" | "trailer" | "clamp_truck"
  >("all");
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

  // Map open maintenance tickets by normalized vehicle code
  const openRepairsByVehicle = useMemo(() => {
    const map = new Map<string, MhMaintenanceRecord[]>();
    maintenanceRecords.forEach((rec) => {
      if (!isMaintenanceRecordOpen(rec)) return;
      const keys = new Set<string>();
      const pushKey = (raw?: string) => {
        const clean = String(raw || "").trim().toUpperCase();
        if (!clean) return;
        keys.add(clean);
        const token = clean.split(/[\s(·|/]+/)[0];
        if (token) keys.add(token);
      };
      pushKey(rec.vehicleId);
      pushKey(rec.vehicleNumber);
      keys.forEach((k) => {
        const existing = map.get(k) || [];
        if (!existing.some((item) => item.id === rec.id)) {
          existing.push(rec);
          map.set(k, existing);
        }
      });
    });
    return map;
  }, [maintenanceRecords]);

  const openRepairVehicleCount = useMemo(() => {
    let count = 0;
    vehicles.forEach((v) => {
      const k1 = String(v.vehicleId || "").trim().toUpperCase();
      const k2 = String(v.number || "").trim().toUpperCase();
      const k3 = String(v.id || "").trim().toUpperCase();
      const list = openRepairsByVehicle.get(k1) || openRepairsByVehicle.get(k2) || openRepairsByVehicle.get(k3);
      if (list && list.length > 0) count++;
    });
    return count;
  }, [vehicles, openRepairsByVehicle]);

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
    let tractorCount = 0;
    let evTractorCount = 0;
    let forkliftCount = 0;
    let trailerCount = 0;
    let clampTruckCount = 0;

    vehicles.forEach((v) => {
      if (isClampTruckVehicle(v)) clampTruckCount++;
      else if (isElectricTractorVehicle(v)) evTractorCount++;
      else if (isTrailerVehicle(v)) trailerCount++;
      else if (isForkliftVehicle(v)) forkliftCount++;
      else if (isStandardTractorVehicle(v)) tractorCount++;

      const status = getResolvedOperationalStatus(v);
      if (status === "In Use") inUse++;
      else if (status === "Maintenance") maintenance++;
      else if (status === "Out of Service") outOfService++;
      else if (v.activeStatus === "Active") available++;
    });

    return {
      total,
      active,
      inactive,
      inUse,
      maintenance,
      outOfService,
      available,
      tractorCount,
      evTractorCount,
      forkliftCount,
      trailerCount,
      clampTruckCount,
    };
  }, [vehicles, vehicleAssignmentMap]);

  // Filtered vehicles
  const filteredVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => {
      if (activeTab === "tractor" && !isStandardTractorVehicle(vehicle)) return false;
      if (activeTab === "ev_tractor" && !isElectricTractorVehicle(vehicle)) return false;
      if (activeTab === "forklift" && !isForkliftVehicle(vehicle)) return false;
      if (activeTab === "trailer" && !isTrailerVehicle(vehicle)) return false;
      if (activeTab === "clamp_truck" && !isClampTruckVehicle(vehicle)) return false;

      if (searchKeyword.trim()) {
        const query = searchKeyword.trim().toLowerCase();
        if (!getVehicleSearchableText(vehicle).includes(query)) return false;
      }

      if (!matchesVehicleTypeFilter(vehicle, filterType)) {
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
  }, [vehicles, activeTab, searchKeyword, filterType, filterActiveStatus, filterOperationalStatus, vehicleAssignmentMap]);

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

    const resolvedVehicleType = resolveVehicleType({
      vehicleId: trimmedId,
      vehicleType: form.vehicleType,
      description: form.description.trim(),
      registrationNumber: form.registrationNumber.trim(),
    });
    const resolvedLabel =
      resolvedVehicleType === "ElectricTractor" ? "หัวลากไฟฟ้า" : resolvedVehicleType;

    const newVehicle: Vehicle = {
      id: trimmedId,
      vehicleId: trimmedId,
      number: trimmedId,
      vehicleType: resolvedVehicleType,
      type: `${resolvedLabel} ${form.capacityTon ? `${form.capacityTon}T` : ""}`.trim(),
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
    showToast(`Vehicle ${newVehicle.vehicleId} registered successfully and synced to Cloud.`);

    onLogTransaction?.(
      `Registered new vehicle ${newVehicle.vehicleId} (${getVehicleTypeDisplayLabel(newVehicle.vehicleType, newVehicle)})`,
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

    const resolvedVehicleType = resolveVehicleType({
      vehicleId: editingVehicle.vehicleId,
      number: editingVehicle.number,
      vehicleType: form.vehicleType,
      description: form.description.trim(),
      registrationNumber: form.registrationNumber.trim(),
    });
    const resolvedLabel =
      resolvedVehicleType === "ElectricTractor" ? "หัวลากไฟฟ้า" : resolvedVehicleType;

    const updatedVehicle: Vehicle = {
      ...editingVehicle,
      vehicleType: resolvedVehicleType,
      type: `${resolvedLabel} ${form.capacityTon ? `${form.capacityTon}T` : ""}`.trim(),
      description: form.description.trim(),
      registrationNumber: form.registrationNumber.trim(),
      department: form.department,
      capacityTon: form.capacityTon,
      operationalStatus: form.operationalStatus,
      status: form.operationalStatus === "Maintenance" ? "Maintenance" : editingVehicle.activeStatus === "Inactive" ? "Inactive" : "Available",
      updatedAt: timestampStr,
    };

    const updatedList = vehicles.map((v) =>
      v.vehicleId === editingVehicle.vehicleId || v.id === editingVehicle.id ? updatedVehicle : v
    );
    onUpdateVehicles(updatedList);
    setEditingVehicle(null);
    showToast(`Vehicle ${editingVehicle.vehicleId} information updated and synced to Cloud.`);

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

    const updatedList = vehicles.map((v) =>
      v.vehicleId === targetVehicle.vehicleId || v.id === targetVehicle.id ? updatedVehicle : v
    );
    onUpdateVehicles(updatedList);

    const actionText = newActiveStatus === "Active" ? "activated" : "deactivated";
    showToast(`Vehicle ${targetVehicle.vehicleId} has been ${actionText} and synced to Cloud.`);

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

      {/* KPI Summary Cards (Hidden in 3D Parking Yard mode so the 3D scene fits 100% on screen without scrolling) */}
      {viewMode !== "yard3d" && (
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total Fleet Size</div>
          <div className="kpi-value">{metrics.total}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            หัวลาก {metrics.tractorCount} · หัวลากไฟฟ้า {metrics.evTractorCount} · โฟล์คลิฟท์{" "}
            {metrics.forkliftCount} · หางลาก {metrics.trailerCount} · รถคีบ{" "}
            {metrics.clampTruckCount}
          </div>
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
      )}

      {/* Main Panel */}
      <section
        className={
          viewMode === "yard3d"
            ? "panel flex flex-col lg:h-[calc(100dvh-134px)] lg:min-h-[520px] lg:overflow-hidden"
            : "panel"
        }
      >
        <div
          className="panel-header shrink-0"
          style={{
            flexWrap: "wrap",
            gap: 10,
            padding: viewMode === "yard3d" ? "9px 14px" : undefined,
          }}
        >
          <div>
            <div className="panel-title">Fleet & Vehicle Management Registry</div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {/* View Mode Switcher: Table View vs 3D Parking Yard */}
            <div
              className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/80 p-0.5"
              role="group"
              aria-label="มุมมองการแสดงผลยานพาหนะ"
            >
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === "table"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Table2 size={14} />
                <span>มุมมองตาราง</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("yard3d")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === "yard3d"
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Box size={14} />
                <span>ลานจอดรถ 3D</span>
                {openRepairVehicleCount > 0 && (
                  <span
                    className={`ml-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      viewMode === "yard3d"
                        ? "bg-rose-500 text-white"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                    }`}
                    title={`มีรถแจ้งซ่อมค้าง ${openRepairVehicleCount} คัน`}
                  >
                    ซ่อม {openRepairVehicleCount}
                  </span>
                )}
              </button>
            </div>

            <button
              className="button"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={14} />
              {activeTab === "trailer"
                ? "+ เพิ่มหางลาก (TTL-)"
                : activeTab === "ev_tractor"
                ? "+ เพิ่มหัวลากไฟฟ้า (TTEV-)"
                : activeTab === "tractor"
                ? "+ เพิ่มรถหัวลาก (TT-)"
                : activeTab === "forklift"
                ? "+ เพิ่มรถโฟล์คลิฟท์ (FL-)"
                : activeTab === "clamp_truck"
                ? "+ เพิ่มรถคีบ (SC-)"
                : "+ Add Vehicle"}
            </button>
          </div>
        </div>

        {/* Category Tabs & Filter bar (Table View only; 3D Yard has built-in 5-zone switcher) */}
        {viewMode !== "yard3d" && (
          <>
        {/* Category Tabs: All | รถหัวลาก (TT-) | หัวลากไฟฟ้า (TTEV-) | รถโฟล์คลิฟท์ (FL-) | หางลาก (TTL-) | รถคีบ (SC-01) */}
        <div className="px-4 pt-3 pb-1 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
          {[
            { id: "all" as const, label: `ทั้งหมด (${metrics.total})` },
            { id: "tractor" as const, label: `รถหัวลาก TT- (${metrics.tractorCount})` },
            { id: "ev_tractor" as const, label: `หัวลากไฟฟ้า TTEV- (${metrics.evTractorCount})` },
            { id: "forklift" as const, label: `รถโฟล์คลิฟท์ FL- (${metrics.forkliftCount})` },
            { id: "trailer" as const, label: `หางลาก TTL- (${metrics.trailerCount})` },
            { id: "clamp_truck" as const, label: `รถคีบ SC-01 (${metrics.clampTruckCount})` },
          ].map((tab) => {
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap border ${
                  isTabActive
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-600 dark:text-white"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
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
              placeholder="ค้นหา Vehicle ID (TT-01, TTEV-19, FL-01, TTL-01, SC-01), รถคีบ, หัวลากไฟฟ้า, ทะเบียน..."
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
            <option value="Tractor">Tractor (รถหัวลาก · TT-)</option>
            <option value="ElectricTractor">หัวลากไฟฟ้า (Electric Tractor · TTEV-)</option>
            <option value="Tugger">Tugger (รถลากจูง · TT-)</option>
            <option value="Forklift">Forklift (รถโฟล์คลิฟท์ · FL-)</option>
            <option value="Trailer">Trailer (หางลาก · TTL-)</option>
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
          </>
        )}

        {/* Conditional View: Table vs 3D Parking Yard */}
        {viewMode === "yard3d" ? (
          <div className="flex-1 min-h-0 flex flex-col p-2 sm:p-2.5">
            <VehicleParkingYard3D
              vehicles={vehicles}
              maintenanceRecords={maintenanceRecords}
              vehicleAssignmentMap={vehicleAssignmentMap}
              onEditVehicle={(v) => setEditingVehicle(v)}
              onViewVehicleDetails={(v) => setViewingVehicle(v)}
              onNavigateToFixFlush={onNavigateToFixFlush}
            />
          </div>
        ) : (
          <>
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
                const vehicleOpenRepairs =
                  openRepairsByVehicle.get(String(vehicle.vehicleId || "").trim().toUpperCase()) ||
                  openRepairsByVehicle.get(String(vehicle.number || "").trim().toUpperCase()) ||
                  openRepairsByVehicle.get(String(vehicle.id || "").trim().toUpperCase()) ||
                  [];
                const primaryOpenRepairMeta =
                  vehicleOpenRepairs.length > 0 ? resolveOpenRepairMeta(vehicleOpenRepairs[0]) : null;

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
                        {getVehicleTypeDisplayLabel(vehicle.vehicleType, vehicle)}
                      </span>
                      {vehicle.capacityTon && (
                        <div className="table-sub-text" style={{ fontSize: 10, color: "#8a9ba8" }}>
                          Cap: {vehicle.capacityTon} TON
                        </div>
                      )}
                    </td>

                    <td>
                      <div className="table-item-name" style={{ fontWeight: 600 }}>
                        {vehicle.description || (isElectricTractorVehicle(vehicle) ? "หัวลากไฟฟ้า" : "-")}
                      </div>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#8a9ba8" }}>
                        {isElectricTractorVehicle(vehicle)
                          ? `ประเภท: หัวลากไฟฟ้า · Dept: ${vehicle.department}`
                          : `Dept: ${vehicle.department}`}
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
                      <div className="flex flex-col items-start gap-1">
                        <VehicleOperationalStatusBadge status={resolvedOpStatus} />
                        {primaryOpenRepairMeta && (
                          <button
                            type="button"
                            onClick={() => setViewMode("yard3d")}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 cursor-pointer"
                            title={`${primaryOpenRepairMeta.label} (${vehicleOpenRepairs.length} ใบงาน) · คลิกเพื่อดูในลานจอด 3D`}
                          >
                            <Wrench size={10} />
                            <span>
                              แจ้งซ่อม: {primaryOpenRepairMeta.shortLabel}
                              {vehicleOpenRepairs.length > 1 ? ` (${vehicleOpenRepairs.length})` : ""}
                            </span>
                          </button>
                        )}
                      </div>
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
          </>
        )}
      </section>

      {/* MODAL 1: ADD VEHICLE */}
      {showAddModal && (
        <AddVehicleModal
          departments={MASTER_DEPARTMENTS}
          defaultVehicleType={
            activeTab === "trailer"
              ? "Trailer"
              : activeTab === "ev_tractor"
              ? "ElectricTractor"
              : activeTab === "tractor"
              ? "Tractor"
              : activeTab === "forklift"
              ? "Forklift"
              : activeTab === "clamp_truck"
              ? "Other"
              : "Tugger"
          }
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
  defaultVehicleType = "Tugger",
  onClose,
  onSave,
}: {
  departments: string[];
  defaultVehicleType?: VehicleType;
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
  const initialPrefix =
    defaultVehicleType === "Trailer"
      ? "TTL-"
      : defaultVehicleType === "ElectricTractor"
      ? "TTEV-"
      : defaultVehicleType === "Tractor"
      ? "TT-"
      : defaultVehicleType === "Forklift"
      ? "FL-"
      : defaultVehicleType === "Other"
      ? "SC-"
      : "";
  const [vehicleId, setVehicleId] = useState<string>(initialPrefix);
  const [vehicleType, setVehicleType] = useState<VehicleType>(defaultVehicleType);
  const [description, setDescription] = useState<string>("");
  const [registrationNumber, setRegistrationNumber] = useState<string>("");
  const [department, setDepartment] = useState<string>(departments[0] || "Material Handling - Fleet");
  const [capacityTon, setCapacityTon] = useState<string>("");
  const [operationalStatus, setOperationalStatus] = useState<VehicleOperationalStatus>("Available");
  const [activeStatus, setActiveStatus] = useState<VehicleActiveStatus>("Active");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleVehicleTypeChange = (nextType: VehicleType) => {
    setVehicleType(nextType);
    const trimmed = vehicleId.trim().toUpperCase();
    if (
      !trimmed ||
      trimmed === "TT-" ||
      trimmed === "TTEV-" ||
      trimmed === "FL-" ||
      trimmed === "TTL-" ||
      trimmed === "SC-"
    ) {
      if (nextType === "Trailer") setVehicleId("TTL-");
      else if (nextType === "ElectricTractor") setVehicleId("TTEV-");
      else if (nextType === "Tractor" || nextType === "Tugger") setVehicleId("TT-");
      else if (nextType === "Forklift") setVehicleId("FL-");
      else if (nextType === "Other") setVehicleId("SC-");
      else setVehicleId("");
    }
  };

  const handleVehicleIdChange = (rawVal: string) => {
    setVehicleId(rawVal);
    const upper = rawVal.trim().toUpperCase();
    if (upper.startsWith("TTEV")) {
      setVehicleType("ElectricTractor");
    } else if (upper.startsWith("TTL-")) {
      setVehicleType("Trailer");
    } else if (upper.startsWith("FL-")) {
      setVehicleType("Forklift");
    } else if (upper.startsWith("SC-") || upper.startsWith("หแ")) {
      setVehicleType("Other");
    } else if (upper.startsWith("TT-") && vehicleType === "ElectricTractor") {
      setVehicleType("Tractor");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedId = vehicleId.trim().toUpperCase();
    if (!trimmedId || trimmedId === "TTL-" || trimmedId === "TT-" || trimmedId === "TTEV-" || trimmedId === "FL-") {
      setErrorMessage(
        vehicleType === "Trailer"
          ? "กรุณาระบุรหัสหางลากให้ครบถ้วน (เช่น TTL-01)"
          : "Please specify a unique Vehicle ID (e.g. TT-06, TTEV-19, FL-003, TTL-01)."
      );
      return;
    }
    if (vehicleType === "Trailer" && !trimmedId.startsWith("TTL-")) {
      setErrorMessage("รหัสหางลากต้องขึ้นต้นด้วย TTL- เท่านั้น (เช่น TTL-01)");
      return;
    }
    if (!description.trim()) {
      setErrorMessage("Please enter a vehicle description or model.");
      return;
    }

    const res = onSave({
      vehicleId: trimmedId,
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
            <div className="panel-title">
              {vehicleType === "Trailer"
                ? "เพิ่มข้อมูลหางลากใหม่ (Register Trailer)"
                : "Register New Fleet Vehicle"}
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
                <strong>Validation Error:</strong> {errorMessage}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className="form-field">
              {vehicleType === "Trailer" ? "รหัสหางลาก (ขึ้นต้นด้วย TTL-) *" : "Vehicle ID *"}
              <input
                className="field"
                value={vehicleId}
                onChange={(e) => handleVehicleIdChange(e.target.value)}
                placeholder={vehicleType === "Trailer" ? "e.g. TTL-01, TTL-02" : "e.g. TT-06, TTEV-19, FL-003, TTL-01"}
                required
                autoFocus
              />
            </label>

            <label className="form-field">
              Vehicle Type *
              <select
                className="field"
                value={vehicleType}
                onChange={(e) => handleVehicleTypeChange(e.target.value as VehicleType)}
                required
              >
                <option value="Tractor">Tractor (รถหัวลาก · TT-)</option>
                <option value="ElectricTractor">หัวลากไฟฟ้า (Electric Tractor · TTEV-)</option>
                <option value="Tugger">Tugger (รถลากจูง · TT-)</option>
                <option value="Forklift">Forklift (รถโฟล์คลิฟท์ · FL-)</option>
                <option value="Trailer">Trailer (หางลาก · TTL-)</option>
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
              placeholder={
                vehicleType === "Trailer"
                  ? "เช่น หางลากพื้นเรียบ 5 ตัน / รถพ่วงลากจูง"
                  : "e.g. Electric Tow Tugger 5.0T - Heavy Duty Battery"
              }
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
  const [vehicleType, setVehicleType] = useState<VehicleType>(() => resolveVehicleType(vehicle));
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
                <option value="Tractor">Tractor (รถหัวลาก · TT-)</option>
                <option value="ElectricTractor">หัวลากไฟฟ้า (Electric Tractor · TTEV-)</option>
                <option value="Tugger">Tugger (รถลากจูง · TT-)</option>
                <option value="Forklift">Forklift (รถโฟล์คลิฟท์ · FL-)</option>
                <option value="Trailer">Trailer (หางลาก · TTL-)</option>
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
              <strong>{getVehicleTypeDisplayLabel(vehicle.vehicleType, vehicle)}</strong>
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
