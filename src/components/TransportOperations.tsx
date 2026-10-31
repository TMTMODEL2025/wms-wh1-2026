/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Truck,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  MapPin,
  Layers,
  ChevronRight,
  Plus,
  X,
  FileText,
  Calendar,
  User,
  Package,
  DollarSign,
  Info
} from "lucide-react";
import { Vehicle, VehicleAssignment } from "../types/officer";

interface TransportTransferRecord {
  id: string;
  originFacility: string;
  destinationFacility: string;
  sku: string;
  itemName: string;
  productCategory: string;
  batchNumber: string;
  palletId: string;
  quantity: number;
  unit: string;
  weightTon: number;
  recorderName: string;
  workingDate: string;
  status: "Pending" | "In Transit" | "Completed" | "Cancelled";
  priority: "Normal" | "Urgent" | "Express";
  vehicleNumber: string;
  driverName: string;
  transportCost?: number;
  notes?: string;
  createdAt: string;
}

interface TransportOperationsProps {
  vehicles: Vehicle[];
  assignments: VehicleAssignment[];
  onNavigateToAssignments?: () => void;
  onNavigateToVehicles?: () => void;
}

const INITIAL_TRANSFERS: TransportTransferRecord[] = [];

const FACILITIES_LIST = [
  "Factory A - Coil Yard CL1",
  "Factory A - Slitting Line 1",
  "Factory A - Packaging Bay P02",
  "Factory B - Slitting Line 2",
  "Factory B - Assembly Bay 2",
  "Warehouse 1 - Inbound Staging",
  "Warehouse 1 - Main Bay WH1-B",
  "Shipping Dock Outbound 4",
];

export function TransportOperations({
  vehicles,
  assignments,
  onNavigateToAssignments,
  onNavigateToVehicles,
}: TransportOperationsProps) {
  const [transfers, setTransfers] = useState<TransportTransferRecord[]>(INITIAL_TRANSFERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<TransportTransferRecord | null>(null);

  // New Form State
  const [originFacility, setOriginFacility] = useState(FACILITIES_LIST[0]);
  const [destinationFacility, setDestinationFacility] = useState(FACILITIES_LIST[3]);
  const [sku, setSku] = useState("");
  const [itemName, setItemName] = useState("");
  const [productCategory, setProductCategory] = useState("Raw Material Coils");
  const [batchNumber, setBatchNumber] = useState("");
  const [palletId, setPalletId] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [unit, setUnit] = useState("Coil");
  const [weightTon, setWeightTon] = useState<number>(0);
  const [recorderName, setRecorderName] = useState("");
  const [workingDate, setWorkingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<"Pending" | "In Transit" | "Completed" | "Cancelled">("Pending");
  const [priority, setPriority] = useState<"Normal" | "Urgent" | "Express">("Normal");
  const [vehicleNumber, setVehicleNumber] = useState(vehicles[0]?.vehicleId || "");
  const [driverName, setDriverName] = useState("");
  const [transportCost, setTransportCost] = useState<number>(0);
  const [notes, setNotes] = useState("");

  const todayDateStr = new Date().toISOString().slice(0, 10);
  const todayAssignments = assignments.filter((a) => a.workingDate === todayDateStr);
  const inProgressCount = transfers.filter((t) => t.status === "In Transit").length;
  const completedCount = transfers.filter((t) => t.status === "Completed").length;

  const handleCreateTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const newRecord: TransportTransferRecord = {
      id: `TRF-${new Date().getFullYear()}-${String(transfers.length + 1).padStart(3, "0")}`,
      originFacility,
      destinationFacility,
      sku: sku.trim() || "-",
      itemName: itemName.trim() || "-",
      productCategory,
      batchNumber: batchNumber.trim() || "-",
      palletId: palletId.trim() || "-",
      quantity: Number(quantity) || 0,
      unit,
      weightTon: Number(weightTon) || 0,
      recorderName: recorderName.trim() || "-",
      workingDate,
      status,
      priority,
      vehicleNumber: vehicleNumber || "-",
      driverName: driverName.trim() || "-",
      transportCost: Number(transportCost) || 0,
      notes,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setTransfers([newRecord, ...transfers]);
    setIsModalOpen(false);
    // Reset form defaults
    setNotes("");
  };

  const filteredTransfers = transfers.filter((t) => {
    const matchesSearch =
      t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.originFacility.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.destinationFacility.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.driverName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "All" || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="transport-operations">
      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total Transport Records</div>
          <div className="kpi-value">{transfers.length}</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#0284c7" }}>
          <div className="kpi-label">Transfers In Transit</div>
          <div className="kpi-value" style={{ color: "#0369a1" }}>
            {inProgressCount}
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#15803d" }}>
          <div className="kpi-label">Completed Transfers</div>
          <div className="kpi-value" style={{ color: "#15803d" }}>
            {completedCount}
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#087eaf" }}>
          <div className="kpi-label">Active Fleet Assigned</div>
          <div className="kpi-value">
            {vehicles.filter((v) => v.activeStatus === "Active").length}
          </div>
        </div>
      </div>

      {/* Main Section */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Transport Operation & Goods Movement Form</div>
          </div>

          <div>
            <button className="button primary" onClick={() => setIsModalOpen(true)}>
              <Plus size={14} />
              + New Transfer Record
            </button>
          </div>
        </div>

        {/* Toolbar & Search */}
        <div className="filterbar transport-filterbar" style={{ padding: "14px 18px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <Search size={14} className="modal-sub-text" style={{ position: "absolute", left: 10, top: 11 }} />
            <input
              type="text"
              className="field search-field transport-input"
              placeholder="Search by ID, item, SKU, origin/destination, driver..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px 8px 32px",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={14} className="modal-sub-text" />
            <span className="modal-sub-text" style={{ fontSize: 12, fontWeight: 600 }}>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="field status-select transport-select"
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <option value="All">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="In Transit">In Transit</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Transfer ID & Date</th>
                <th>Origin ➔ Destination</th>
                <th>Item, SKU & Batch</th>
                <th>Qty & Weight</th>
                <th>Priority</th>
                <th>Vehicle & Driver</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 30, color: "#647786" }}>
                    No transfer records match your search filter.
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((tr) => (
                  <tr key={tr.id}>
                    <td>
                      <span className="code" style={{ fontWeight: 700 }}>{tr.id}</span>
                      <div className="table-timestamp" style={{ fontSize: 10, color: "#647786", marginTop: 2 }}>{tr.workingDate}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 11 }}>
                        <span className="origin-text" style={{ color: "#087eaf" }}>{tr.originFacility}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, marginTop: 2 }}>
                        <ArrowRight size={12} className="destination-text" style={{ color: "#15803d" }} />
                        <span className="destination-text" style={{ fontWeight: 600, color: "#15803d" }}>{tr.destinationFacility}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-item-name" style={{ fontWeight: 600, color: "#1e3648" }}>{tr.itemName}</div>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#647786" }}>
                        SKU: <span className="code">{tr.sku}</span> | Batch: <span className="code">{tr.batchNumber}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-qty" style={{ fontWeight: 600 }}>{tr.quantity} {tr.unit}</div>
                      <div className="table-weight" style={{ fontSize: 10, color: "#647786" }}>{tr.weightTon} Tons</div>
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          background:
                            tr.priority === "Express"
                              ? "#fee2e2"
                              : tr.priority === "Urgent"
                              ? "#fef3c7"
                              : "#f1f5f9",
                          color:
                            tr.priority === "Express"
                              ? "#991b1b"
                              : tr.priority === "Urgent"
                              ? "#92400e"
                              : "#475569",
                        }}
                      >
                        {tr.priority}
                      </span>
                    </td>
                    <td>
                      <div className="table-item-name" style={{ fontWeight: 700, color: "#1e3648" }}>{tr.vehicleNumber}</div>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#647786" }}>{tr.driverName}</div>
                    </td>
                    <td>
                      <span
                        className="status"
                        style={{
                          background:
                            tr.status === "In Transit"
                              ? "#e0f2fe"
                              : tr.status === "Completed"
                              ? "#dcfce7"
                              : tr.status === "Pending"
                              ? "#fef9c3"
                              : "#fee2e2",
                          color:
                            tr.status === "In Transit"
                              ? "#0369a1"
                              : tr.status === "Completed"
                              ? "#15803d"
                              : tr.status === "Pending"
                              ? "#854d0e"
                              : "#991b1b",
                          border: `1px solid ${
                            tr.status === "In Transit"
                              ? "#bae6fd"
                              : tr.status === "Completed"
                              ? "#86efac"
                              : tr.status === "Pending"
                              ? "#fde047"
                              : "#fecaca"
                          }`,
                        }}
                      >
                        {tr.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => setSelectedRecord(tr)}
                      >
                        <FileText size={12} /> View Details
                      </button>
                    </td>
                  </tr>
                ))
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
          }}
        >
          <span>Showing {filteredTransfers.length} of {transfers.length} internal transport records.</span>
          <span>WMS Warehouse 1 - Transport Operation & Goods Movement</span>
        </div>
      </section>

      {/* New Transfer Record Modal */}
      {isModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-container transfer-modal-card" style={{ maxWidth: 760, maxHeight: "90vh", overflowY: "auto" }}>
            <div className="modal-header-box" style={{ padding: "18px 24px" }}>
              <div>
                <div className="modal-title-text">Create Transport Transfer Record</div>
                <div className="modal-sub-text" style={{ marginTop: 2 }}>
                  Record origin, destination, SKU, batch, vehicle and weights for internal factory movement.
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="modal-close-btn"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateTransfer} style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Origin Facility */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Origin Factory / Zone *
                </label>
                <select
                  value={originFacility}
                  onChange={(e) => setOriginFacility(e.target.value)}
                  className="field transport-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  {FACILITIES_LIST.map((fac) => (
                    <option key={fac} value={fac}>{fac}</option>
                  ))}
                </select>
              </div>

              {/* Destination Facility */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Destination Factory / Zone *
                </label>
                <select
                  value={destinationFacility}
                  onChange={(e) => setDestinationFacility(e.target.value)}
                  className="field transport-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  {FACILITIES_LIST.map((fac) => (
                    <option key={fac} value={fac}>{fac}</option>
                  ))}
                </select>
              </div>

              {/* SKU */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Item SKU Code *
                </label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  required
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Item Name */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Item Name / Description *
                </label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  required
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Product Category */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Product Category
                </label>
                <input
                  type="text"
                  value={productCategory}
                  onChange={(e) => setProductCategory(e.target.value)}
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Batch Number */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Batch Number
                </label>
                <input
                  type="text"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Pallet ID */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Pallet or Container ID
                </label>
                <input
                  type="text"
                  value={palletId}
                  onChange={(e) => setPalletId(e.target.value)}
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Quantity & Unit */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                    Quantity *
                  </label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    min={1}
                    required
                    className="field transport-input"
                    style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                    Unit
                  </label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="field transport-select"
                    style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                  >
                    <option value="Coil">Coil</option>
                    <option value="Pallets">Pallets</option>
                    <option value="Bundles">Bundles</option>
                    <option value="Pcs">Pcs</option>
                    <option value="Tons">Tons</option>
                  </select>
                </div>
              </div>

              {/* Weight in Tons */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Total Weight (Tons) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={weightTon}
                  onChange={(e) => setWeightTon(Number(e.target.value))}
                  required
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Working Date */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Transfer Date *
                </label>
                <input
                  type="date"
                  value={workingDate}
                  onChange={(e) => setWorkingDate(e.target.value)}
                  required
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Recorder Name */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Recorder Name *
                </label>
                <input
                  type="text"
                  value={recorderName}
                  onChange={(e) => setRecorderName(e.target.value)}
                  required
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Status */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Transfer Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="field transport-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  <option value="Pending">Pending</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Priority Level
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="field transport-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  <option value="Normal">Normal</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Express">Express</option>
                </select>
              </div>

              {/* Vehicle Number */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Vehicle Assignment
                </label>
                <select
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  className="field transport-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.vehicleId}>
                      {v.vehicleId} - {v.description || v.vehicleType}
                    </option>
                  ))}
                </select>
              </div>

              {/* Driver Name */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Driver Name
                </label>
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Transport Cost */}
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Transport Cost (THB)
                </label>
                <input
                  type="number"
                  value={transportCost}
                  onChange={(e) => setTransportCost(Number(e.target.value))}
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              {/* Notes */}
              <div style={{ gridColumn: "span 2" }}>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                  Transport Notes & Handling Instructions
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Enter any special handling notes, crane requirements, or safety remarks..."
                  className="field transport-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="button primary">
                  Save Transfer Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {selectedRecord && (
        <div className="modal-backdrop">
          <div className="modal-container transfer-modal-card" style={{ maxWidth: 600 }}>
            <div className="modal-header-box" style={{ padding: "18px 24px" }}>
              <div>
                <div className="modal-title-text">
                  Transfer Manifest: <span className="code">{selectedRecord.id}</span>
                </div>
                <div className="modal-sub-text" style={{ marginTop: 2 }}>
                  Recorded on {selectedRecord.createdAt} by {selectedRecord.recorderName}
                </div>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="modal-close-btn"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12 }}>
              <div>
                <div className="modal-label-text">Origin Facility:</div>
                <div style={{ fontWeight: 700, color: "#087eaf", marginTop: 2 }}>{selectedRecord.originFacility}</div>
              </div>
              <div>
                <div className="modal-label-text">Destination Facility:</div>
                <div style={{ fontWeight: 700, color: "#15803d", marginTop: 2 }}>{selectedRecord.destinationFacility}</div>
              </div>

              <div>
                <div className="modal-label-text">Item Name:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}>{selectedRecord.itemName}</div>
              </div>
              <div>
                <div className="modal-label-text">SKU & Batch:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}>
                  <span className="code">{selectedRecord.sku}</span> / <span className="code">{selectedRecord.batchNumber}</span>
                </div>
              </div>

              <div>
                <div className="modal-label-text">Product Category:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}>{selectedRecord.productCategory}</div>
              </div>
              <div>
                <div className="modal-label-text">Pallet / Container ID:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}><span className="code">{selectedRecord.palletId}</span></div>
              </div>

              <div>
                <div className="modal-label-text">Quantity & Weight:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}>
                  {selectedRecord.quantity} {selectedRecord.unit} ({selectedRecord.weightTon} Tons)
                </div>
              </div>
              <div>
                <div className="modal-label-text">Priority & Status:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}>
                  {selectedRecord.priority} | <span className={`status ${selectedRecord.status.replaceAll(" ", "-")}`}>{selectedRecord.status}</span>
                </div>
              </div>

              <div>
                <div className="modal-label-text">Vehicle & Driver:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}>
                  {selectedRecord.vehicleNumber} ({selectedRecord.driverName})
                </div>
              </div>
              <div>
                <div className="modal-label-text">Transport Cost:</div>
                <div className="modal-val-text" style={{ marginTop: 2 }}>
                  {selectedRecord.transportCost ? `${selectedRecord.transportCost.toLocaleString()} THB` : "Free / Internal"}
                </div>
              </div>

              {selectedRecord.notes && (
                <div className="modal-notes-box" style={{ gridColumn: "span 2" }}>
                  <div className="modal-label-text">Handling Notes:</div>
                  <div className="modal-val-text" style={{ marginTop: 2, fontWeight: 500 }}>{selectedRecord.notes}</div>
                </div>
              )}
            </div>

            <div className="modal-footer-box">
              <button
                className="button primary"
                onClick={() => setSelectedRecord(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
