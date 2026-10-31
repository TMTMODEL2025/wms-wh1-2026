/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Fuel,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Printer,
  Search,
  Filter,
  Plus,
  X,
  FileText,
  Truck,
  CheckCircle2,
  Droplets
} from "lucide-react";
import { Vehicle } from "../types/officer";

interface FuelTransaction {
  id: string;
  type: "Inbound Receipt (รับเข้า)" | "Outbound Withdrawal (เบิกออก)";
  fuelType: "Diesel (ดีเซล)" | "Gasoline (เบนซิน)";
  qty: number;
  meterStart: number;
  meterEnd: number;
  recorderName: string;
  referenceSource: string; // Supplier for inbound, Vehicle ID for outbound
  purposeOrNotes: string;
  workingDate: string;
  timestamp: string;
}

interface FuelManagementProps {
  vehicles: Vehicle[];
}

const INITIAL_FUEL_TRANSACTIONS: FuelTransaction[] = [];

export function FuelManagement({ vehicles }: FuelManagementProps) {
  const [transactions, setTransactions] = useState<FuelTransaction[]>(INITIAL_FUEL_TRANSACTIONS);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [fuelTypeFilter, setFuelTypeFilter] = useState("All");

  // Modals
  const [isInboundModalOpen, setIsInboundModalOpen] = useState(false);
  const [isOutboundModalOpen, setIsOutboundModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<FuelTransaction | null>(null);

  // Inbound Form State
  const [inFuelType, setInFuelType] = useState<"Diesel (ดีเซล)" | "Gasoline (เบนซิน)">("Diesel (ดีเซล)");
  const [inQty, setInQty] = useState<number>(0);
  const [inMeterStart, setInMeterStart] = useState<number>(0);
  const [inRecorder, setInRecorder] = useState("");
  const [inSupplier, setInSupplier] = useState("");
  const [inNotes, setInNotes] = useState("");
  const [inDate, setInDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Outbound Form State
  const [outFuelType, setOutFuelType] = useState<"Diesel (ดีเซล)" | "Gasoline (เบนซิน)">("Diesel (ดีเซล)");
  const [outVehicleId, setOutVehicleId] = useState(vehicles[0]?.vehicleId || "");
  const [outQty, setOutQty] = useState<number>(0);
  const [outMeterStart, setOutMeterStart] = useState<number>(0);
  const [outRecorder, setOutRecorder] = useState("");
  const [outPurpose, setOutPurpose] = useState("");
  const [outDate, setOutDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Calculate current tank stocks based on transactions
  const dieselStock = transactions.reduce((acc, t) => {
    if (t.fuelType === "Diesel (ดีเซล)") {
      return t.type.includes("Inbound") ? acc + t.qty : acc - t.qty;
    }
    return acc;
  }, 0);

  const gasolineStock = transactions.reduce((acc, t) => {
    if (t.fuelType === "Gasoline (เบนซิน)") {
      return t.type.includes("Inbound") ? acc + t.qty : acc - t.qty;
    }
    return acc;
  }, 0);

  const DIESEL_LOW_THRESHOLD = 4000;
  const GASOLINE_LOW_THRESHOLD = 2000;

  const handleInboundSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(inQty) || 0;
    const startNum = Number(inMeterStart) || 0;
    const endNum = startNum + qtyNum;

    const newTx: FuelTransaction = {
      id: `FUEL-2026-${String(transactions.length + 1).padStart(3, "0")}`,
      type: "Inbound Receipt (รับเข้า)",
      fuelType: inFuelType,
      qty: qtyNum,
      meterStart: startNum,
      meterEnd: endNum,
      recorderName: inRecorder.trim() || "WMS Storekeeper",
      referenceSource: inSupplier.trim() || "Direct Supplier",
      purposeOrNotes: inNotes.trim() || "Bulk fuel receipt into warehouse storage tank.",
      workingDate: inDate,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setTransactions([newTx, ...transactions]);
    setIsInboundModalOpen(false);
    setInNotes("");
  };

  const handleOutboundSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(outQty) || 0;
    const startNum = Number(outMeterStart) || 0;
    const endNum = Math.max(0, startNum - qtyNum);

    const targetVehicle = vehicles.find((v) => v.vehicleId === outVehicleId);
    const vehicleLabel = targetVehicle ? `${targetVehicle.vehicleId} - ${targetVehicle.vehicleType} (${targetVehicle.description || "Fleet"})` : `${outVehicleId} - Warehouse Fleet`;

    const newTx: FuelTransaction = {
      id: `FUEL-2026-${String(transactions.length + 1).padStart(3, "0")}`,
      type: "Outbound Withdrawal (เบิกออก)",
      fuelType: outFuelType,
      qty: qtyNum,
      meterStart: startNum,
      meterEnd: endNum,
      recorderName: outRecorder.trim() || "WMS Operator",
      referenceSource: vehicleLabel,
      purposeOrNotes: outPurpose.trim() || "Vehicle refueling dispatch.",
      workingDate: outDate,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setTransactions([newTx, ...transactions]);
    setIsOutboundModalOpen(false);
    setOutPurpose("");
  };

  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch =
      t.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.recorderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.referenceSource.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.purposeOrNotes.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = typeFilter === "All" || t.type.includes(typeFilter);
    const matchesFuelType = fuelTypeFilter === "All" || t.fuelType.includes(fuelTypeFilter);

    return matchesSearch && matchesType && matchesFuelType;
  });

  return (
    <div className="fuel-management">
      {/* Tank Level KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi" style={{ borderTopColor: dieselStock <= DIESEL_LOW_THRESHOLD ? "#ef4444" : "#087eaf" }}>
          <div className="kpi-label">Diesel Tank Stock (ถังน้ำมันดีเซล)</div>
          <div className="kpi-value" style={{ color: dieselStock <= DIESEL_LOW_THRESHOLD ? "#ef4444" : "#087eaf" }}>
            {dieselStock.toLocaleString()} <span style={{ fontSize: 14, fontWeight: 600 }}>Liters</span>
          </div>
          {dieselStock <= DIESEL_LOW_THRESHOLD && (
            <div className="kpi-note" style={{ marginTop: 4 }}>
              <span style={{ color: "#ef4444", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle size={12} /> Low Stock Alert!
              </span>
            </div>
          )}
        </div>

        <div className="kpi" style={{ borderTopColor: gasolineStock <= GASOLINE_LOW_THRESHOLD ? "#ef4444" : "#f59e0b" }}>
          <div className="kpi-label">Gasoline Tank Stock (ถังน้ำมันเบนซิน)</div>
          <div className="kpi-value" style={{ color: gasolineStock <= GASOLINE_LOW_THRESHOLD ? "#ef4444" : "#d97706" }}>
            {gasolineStock.toLocaleString()} <span style={{ fontSize: 14, fontWeight: 600 }}>Liters</span>
          </div>
          {gasolineStock <= GASOLINE_LOW_THRESHOLD && (
            <div className="kpi-note" style={{ marginTop: 4 }}>
              <span style={{ color: "#ef4444", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle size={12} /> Low Stock Alert!
              </span>
            </div>
          )}
        </div>

        <div className="kpi" style={{ borderTopColor: "#10b981" }}>
          <div className="kpi-label">Total Transactions Logged</div>
          <div className="kpi-value" style={{ color: "#10b981" }}>{transactions.length}</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#6366f1" }}>
          <div className="kpi-label">Dispenser Station Status</div>
          <div className="kpi-value" style={{ color: "#6366f1", fontSize: 20, paddingTop: 4 }}>Active (Online)</div>
        </div>
      </div>

      {/* Main Table Section */}
      <section className="panel">
        <div className="panel-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">Fuel Inbound & Outbound Movement Register</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="button primary" onClick={() => setIsInboundModalOpen(true)}>
              <Plus size={14} /> + Inbound Receipt (รับเข้าน้ำมัน)
            </button>
            <button className="button secondary" style={{ background: "#0284c7", color: "#ffffff", borderColor: "#0284c7" }} onClick={() => setIsOutboundModalOpen(true)}>
              <Plus size={14} /> + Outbound Withdrawal (เบิกออก)
            </button>
            <button className="button secondary" onClick={() => window.print()}>
              <Printer size={13} /> Print Log
            </button>
          </div>
        </div>

        {/* Toolbar & Filter */}
        <div className="filterbar fuel-filterbar" style={{ padding: "12px 18px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <Search size={14} className="modal-sub-text" style={{ position: "absolute", left: 10, top: 11 }} />
            <input
              type="text"
              placeholder="Search by ID, recorder name, supplier, vehicle, or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="field search-field fuel-input"
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
            <span className="modal-label-text" style={{ fontSize: 12, fontWeight: 600 }}>Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="field status-select fuel-select"
              style={{ padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
            >
              <option value="All">All Transactions</option>
              <option value="Inbound">Inbound Receipt (รับเข้า)</option>
              <option value="Outbound">Outbound Withdrawal (เบิกออก)</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="modal-label-text" style={{ fontSize: 12, fontWeight: 600 }}>Fuel Category:</span>
            <select
              value={fuelTypeFilter}
              onChange={(e) => setFuelTypeFilter(e.target.value)}
              className="field status-select fuel-select"
              style={{ padding: "7px 10px", borderRadius: 6, fontSize: 12 }}
            >
              <option value="All">All Categories</option>
              <option value="Diesel">Diesel (ดีเซล)</option>
              <option value="Gasoline">Gasoline (เบนซิน)</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Transaction ID & Date</th>
                <th>Movement Type</th>
                <th>Fuel Category</th>
                <th>Quantity (Liters)</th>
                <th>Meter Start ➔ End</th>
                <th>Source / Vehicle Ref</th>
                <th>Recorder Name</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 30, color: "#647786" }}>
                    No fuel transactions found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <span className="code" style={{ fontWeight: 700 }}>{tx.id}</span>
                      <div className="table-timestamp" style={{ fontSize: 10, marginTop: 2 }}>{tx.timestamp}</div>
                    </td>
                    <td>
                      <span
                        className="status"
                        style={{
                          background: tx.type.includes("Inbound") ? "#dcfce7" : "#e0f2fe",
                          color: tx.type.includes("Inbound") ? "#15803d" : "#0369a1",
                          border: `1px solid ${tx.type.includes("Inbound") ? "#86efac" : "#bae6fd"}`,
                        }}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td>
                      <div className="table-item-name" style={{ fontWeight: 700, color: tx.fuelType.includes("Diesel") ? "#0284c7" : "#d97706" }}>
                        {tx.fuelType}
                      </div>
                    </td>
                    <td>
                      <div className="table-qty" style={{ fontWeight: 800, fontSize: 13, color: tx.type.includes("Inbound") ? "#16a34a" : "#0284c7" }}>
                        {tx.type.includes("Inbound") ? "+" : "-"}{tx.qty.toLocaleString()} L
                      </div>
                    </td>
                    <td>
                      <div className="table-sub-text" style={{ fontFamily: "'Noto Sans Thai', sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 11 }}>
                        {tx.meterStart.toLocaleString()} ➔ {tx.meterEnd.toLocaleString()}
                      </div>
                    </td>
                    <td>
                      <div className="table-item-name" style={{ fontWeight: 600, maxWidth: 220, whiteSpace: "normal" }}>
                        {tx.referenceSource}
                      </div>
                      <div className="table-sub-text" style={{ fontSize: 10 }}>{tx.purposeOrNotes}</div>
                    </td>
                    <td>
                      <div className="table-sub-text" style={{ fontWeight: 600 }}>{tx.recorderName}</div>
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => setSelectedTx(tx)}
                      >
                        <FileText size={12} /> Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          className="fuel-filterbar"
          style={{
            padding: "12px 18px",
            borderTop: "1px solid #e7ecef",
            fontSize: 11,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span className="modal-sub-text">Showing {filteredTransactions.length} of {transactions.length} fuel transactions.</span>
          <span className="modal-sub-text">WMS Warehouse 1 - Fuel Management System</span>
        </div>
      </section>

      {/* Inbound Receipt Modal (รับเข้าน้ำมัน) */}
      {isInboundModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-container fuel-modal-card" style={{ maxWidth: 650 }}>
            <div className="modal-header-box fuel-modal-header" style={{ padding: "18px 24px" }}>
              <div>
                <div className="modal-title-text">Inbound Fuel Receipt (บันทึกรับเข้าน้ำมัน)</div>
                <div className="modal-sub-text" style={{ marginTop: 2 }}>Record bulk fuel delivery from supplier into warehouse storage tank.</div>
              </div>
              <button onClick={() => setIsInboundModalOpen(false)} className="modal-close-btn"><X size={20} /></button>
            </div>

            <form onSubmit={handleInboundSubmit} style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Fuel Category (ประเภทน้ำมัน) *</label>
                <select
                  value={inFuelType}
                  onChange={(e) => setInFuelType(e.target.value as any)}
                  className="field fuel-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  <option value="Diesel (ดีเซล)">Diesel (ดีเซล)</option>
                  <option value="Gasoline (เบนซิน)">Gasoline (เบนซิน)</option>
                </select>
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Quantity Received (ปริมาณ ลิตร) *</label>
                <input
                  type="number"
                  min={1}
                  value={inQty}
                  onChange={(e) => setInQty(Number(e.target.value))}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Tank Meter Reading Start (ลิตรก่อนรับเข้า) *</label>
                <input
                  type="number"
                  value={inMeterStart}
                  onChange={(e) => setInMeterStart(Number(e.target.value))}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Delivery Date *</label>
                <input
                  type="date"
                  value={inDate}
                  onChange={(e) => setInDate(e.target.value)}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Supplier & PO Reference (บริษัทผู้ส่ง / ใบส่งสินค้า) *</label>
                <input
                  type="text"
                  value={inSupplier}
                  onChange={(e) => setInSupplier(e.target.value)}
                  required
                  placeholder="e.g., PTT Oil & Retail Public Co., Ltd. (PO-98215)"
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Recorder Name (ผู้บันทึกรายการ) *</label>
                <input
                  type="text"
                  value={inRecorder}
                  onChange={(e) => setInRecorder(e.target.value)}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Remarks & Quality Inspection Notes</label>
                <textarea
                  value={inNotes}
                  onChange={(e) => setInNotes(e.target.value)}
                  rows={2}
                  placeholder="Temperature check, density, or sealant seal number..."
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" className="button secondary" onClick={() => setIsInboundModalOpen(false)}>Cancel</button>
                <button type="submit" className="button primary">Save Inbound Receipt</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Outbound Withdrawal Modal (เบิกจ่ายน้ำมัน) */}
      {isOutboundModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-container fuel-modal-card" style={{ maxWidth: 650 }}>
            <div className="modal-header-box fuel-modal-header" style={{ padding: "18px 24px" }}>
              <div>
                <div className="modal-title-text">Outbound Fuel Withdrawal (บันทึกเบิกจ่ายน้ำมัน)</div>
                <div className="modal-sub-text" style={{ marginTop: 2 }}>Withdraw fuel for forklift, tractor, or warehouse machinery.</div>
              </div>
              <button onClick={() => setIsOutboundModalOpen(false)} className="modal-close-btn"><X size={20} /></button>
            </div>

            <form onSubmit={handleOutboundSubmit} style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Fuel Category (ประเภทน้ำมัน) *</label>
                <select
                  value={outFuelType}
                  onChange={(e) => setOutFuelType(e.target.value as any)}
                  className="field fuel-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  <option value="Diesel (ดีเซล)">Diesel (ดีเซล)</option>
                  <option value="Gasoline (เบนซิน)">Gasoline (เบนซิน)</option>
                </select>
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Vehicle Requesting (รถที่ขอเบิก) *</label>
                <select
                  value={outVehicleId}
                  onChange={(e) => setOutVehicleId(e.target.value)}
                  className="field fuel-select"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                >
                  <option value="">-- เลือกรถ / Select Vehicle --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.vehicleId}>
                      {v.vehicleId} - {v.vehicleType} ({v.description || "Active Fleet"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Quantity Withdrawn (ปริมาณ ลิตร) *</label>
                <input
                  type="number"
                  min={1}
                  value={outQty}
                  onChange={(e) => setOutQty(Number(e.target.value))}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Dispenser Meter Start (เลขมาตรวัดก่อนเบิก) *</label>
                <input
                  type="number"
                  value={outMeterStart}
                  onChange={(e) => setOutMeterStart(Number(e.target.value))}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Withdrawal Date *</label>
                <input
                  type="date"
                  value={outDate}
                  onChange={(e) => setOutDate(e.target.value)}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Recorder Name (ผู้บันทึกรายการ) *</label>
                <input
                  type="text"
                  value={outRecorder}
                  onChange={(e) => setOutRecorder(e.target.value)}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Purpose / Operation Notes (วัตถุประสงค์การเบิก)</label>
                <input
                  type="text"
                  value={outPurpose}
                  onChange={(e) => setOutPurpose(e.target.value)}
                  placeholder="e.g., Shift 1 operational refueling for warehouse transport"
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" className="button secondary" onClick={() => setIsOutboundModalOpen(false)}>Cancel</button>
                <button type="submit" className="button primary">Save Outbound Withdrawal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction Details Modal - Fuel Transaction Voucher */}
      {selectedTx && (
        <div className="modal-backdrop">
          <div className="modal-container fuel-modal-card" style={{ maxWidth: 600 }}>
            <div className="modal-header-box fuel-modal-header" style={{ padding: "18px 24px" }}>
              <div>
                <div className="modal-title-text">
                  Fuel Transaction Voucher: <span className="code">{selectedTx.id}</span>
                </div>
                <div className="modal-sub-text" style={{ marginTop: 2 }}>
                  Logged on {selectedTx.timestamp} by {selectedTx.recorderName}
                </div>
              </div>
              <button onClick={() => setSelectedTx(null)} className="modal-close-btn">
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12 }}>
              <div>
                <div className="modal-label-text">Movement Type:</div>
                <div style={{ fontWeight: 700, color: "#087eaf", marginTop: 2 }}>{selectedTx.type}</div>
              </div>
              <div>
                <div className="modal-label-text">Fuel Category:</div>
                <div className="modal-val-text" style={{ fontWeight: 700, marginTop: 2 }}>{selectedTx.fuelType}</div>
              </div>

              <div className="fuel-detail-box modal-notes-box">
                <div className="modal-label-text">Fuel Amount / Liters:</div>
                <div className="modal-val-text" style={{ fontWeight: 800, fontSize: 15, marginTop: 2, color: selectedTx.type.includes("Inbound") ? "#16a34a" : "#0284c7" }}>
                  {selectedTx.qty.toLocaleString()} Liters
                </div>
              </div>
              <div className="fuel-detail-box modal-notes-box">
                <div className="modal-label-text">Working Date:</div>
                <div className="modal-val-text" style={{ fontWeight: 700, marginTop: 2 }}>{selectedTx.workingDate}</div>
              </div>

              <div>
                <div className="modal-label-text">Meter Start ➔ End:</div>
                <div className="modal-val-text" style={{ fontWeight: 700, marginTop: 2, fontFamily: "'Noto Sans Thai', sans-serif", fontVariantNumeric: "tabular-nums" }}>
                  {selectedTx.meterStart.toLocaleString()} ➔ {selectedTx.meterEnd.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="modal-label-text">Recorder Name:</div>
                <div className="modal-val-text" style={{ fontWeight: 700, marginTop: 2 }}>{selectedTx.recorderName}</div>
              </div>

              <div className="fuel-detail-box modal-notes-box" style={{ gridColumn: "span 2" }}>
                <div className="modal-label-text">Reference / Vehicle / Supplier:</div>
                <div className="modal-val-text" style={{ fontWeight: 700, marginTop: 2 }}>
                  {selectedTx.referenceSource}
                </div>
              </div>

              {selectedTx.purposeOrNotes && (
                <div className="fuel-detail-box modal-notes-box" style={{ gridColumn: "span 2" }}>
                  <div className="modal-label-text">Notes / Operational Purpose:</div>
                  <div className="modal-val-text" style={{ marginTop: 2, fontWeight: 500 }}>
                    {selectedTx.purposeOrNotes}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer-box fuel-modal-footer" style={{ padding: "14px 24px", display: "flex", justifyContent: "flex-end" }}>
              <button className="button primary" onClick={() => setSelectedTx(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
