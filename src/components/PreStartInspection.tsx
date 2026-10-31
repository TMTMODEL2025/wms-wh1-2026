/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  X,
  FileText,
  Truck,
  Wrench,
  Clock,
  Check
} from "lucide-react";
import { Vehicle } from "../types/officer";

interface ChecklistItem {
  id: string;
  categoryThai: string;
  categoryEnglish: string;
  status: "Pass" | "Fail" | "NA";
  remark?: string;
}

interface InspectionRecord {
  id: string;
  vehicleId: string;
  vehicleDescription: string;
  operatorName: string;
  shift: string;
  operatingHours: number;
  items: ChecklistItem[];
  overallResult: "Passed (พร้อมใช้งาน)" | "Grounded / Needs Repair (งดใช้ชั่วคราว)";
  inspectorSignature: string;
  inspectionDate: string;
  createdAt: string;
}

interface PreStartInspectionProps {
  vehicles: Vehicle[];
  onNavigateToFixFlush?: () => void;
}

const INITIAL_INSPECTIONS: InspectionRecord[] = [];

const DEFAULT_CHECKLIST_TEMPLATE = [
  { categoryThai: "ระบบเบรกและเบรกมือ", categoryEnglish: "Braking System & Parking Brake" },
  { categoryThai: "ระบบบังคับเลี้ยว", categoryEnglish: "Steering Control" },
  { categoryThai: "คันโยกและกระบอกไฮดรอลิก", categoryEnglish: "Hydraulic Lift Levers & Cylinders" },
  { categoryThai: "สภาพล้อ โครงยาง และน็อตล้อ", categoryEnglish: "Tires & Lug Nuts" },
  { categoryThai: "แตรสัญญาณถอย และไฟส่องสว่าง", categoryEnglish: "Horn, Backup Alarm & LED Lights" },
  { categoryThai: "ตรวจสอบการรั่วซึมของน้ำมัน", categoryEnglish: "Fluid Leaks Check" },
  { categoryThai: "ระดับน้ำมันเชื้อเพลิงและแบตเตอรี่", categoryEnglish: "Fuel & Battery Level" },
];

export function PreStartInspection({ vehicles }: PreStartInspectionProps) {
  const [inspections, setInspections] = useState<InspectionRecord[]>(INITIAL_INSPECTIONS);
  const [searchQuery, setSearchQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);

  // Form State
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.vehicleId || "");
  const [operatorName, setOperatorName] = useState("");
  const [shift, setShift] = useState("Shift 1 (08:00 - 16:00)");
  const [operatingHours, setOperatingHours] = useState(0);
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formItems, setFormItems] = useState<ChecklistItem[]>(
    DEFAULT_CHECKLIST_TEMPLATE.map((t, idx) => ({
      id: `item-${idx}`,
      categoryThai: t.categoryThai,
      categoryEnglish: t.categoryEnglish,
      status: "Pass",
    }))
  );

  const updateItemStatus = (index: number, status: "Pass" | "Fail" | "NA") => {
    const updated = [...formItems];
    updated[index].status = status;
    setFormItems(updated);
  };

  const updateItemRemark = (index: number, remark: string) => {
    const updated = [...formItems];
    updated[index].remark = remark;
    setFormItems(updated);
  };

  const hasAnyFail = formItems.some((item) => item.status === "Fail");
  const overallResult: "Passed (พร้อมใช้งาน)" | "Grounded / Needs Repair (งดใช้ชั่วคราว)" = hasAnyFail
    ? "Grounded / Needs Repair (งดใช้ชั่วคราว)"
    : "Passed (พร้อมใช้งาน)";

  const handleCreateInspection = (e: React.FormEvent) => {
    e.preventDefault();
    const targetVehicle = vehicles.find((v) => v.vehicleId === vehicleId);
    const vehicleDescription = targetVehicle ? `${targetVehicle.vehicleId} - ${targetVehicle.vehicleType} (${targetVehicle.description || "Fleet"})` : `${vehicleId} - Warehouse Fleet Unit`;

    const newRecord: InspectionRecord = {
      id: `INS-2026-${String(inspections.length + 1).padStart(3, "0")}`,
      vehicleId,
      vehicleDescription,
      operatorName: operatorName.trim() || "WMS Operator",
      shift,
      operatingHours: Number(operatingHours) || 0,
      items: formItems,
      overallResult,
      inspectorSignature: operatorName,
      inspectionDate,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setInspections([newRecord, ...inspections]);
    setIsModalOpen(false);
  };

  const passedCount = inspections.filter((i) => i.overallResult.includes("Passed")).length;
  const groundedCount = inspections.filter((i) => i.overallResult.includes("Grounded")).length;

  const filteredInspections = inspections.filter((i) => {
    const matchesSearch =
      i.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.vehicleId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.operatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.vehicleDescription.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesResult = resultFilter === "All" || i.overallResult.includes(resultFilter);
    return matchesSearch && matchesResult;
  });

  return (
    <div className="pre-start-inspection">
      {/* Top Header */}
      <div className="prestart-header-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, background: "#fff", padding: "12px 20px", borderRadius: 8, border: "1px solid #d9e0e5", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="prestart-modal-title" style={{ fontSize: 16, fontWeight: 700, color: "#1e3648" }}>
            Forklift Pre-Start Safety Inspection Checklist (แบบตรวจสอบก่อนใช้งาน)
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="button primary" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} /> + New Safety Checklist (ตรวจสภาพรถ)
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi" style={{ borderTopColor: "#10b981" }}>
          <div className="kpi-label">Passed Safety Inspection</div>
          <div className="kpi-value" style={{ color: "#10b981" }}>{passedCount}</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#ef4444" }}>
          <div className="kpi-label">Grounded / Needs Maintenance</div>
          <div className="kpi-value" style={{ color: "#ef4444" }}>{groundedCount}</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#f59e0b" }}>
          <div className="kpi-label">Service Interval Alert (250h/500h)</div>
          <div className="kpi-value" style={{ color: "#d97706" }}>{inspections.filter((i) => i.operatingHours >= 250).length} Units</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#087eaf" }}>
          <div className="kpi-label">Total Daily Checklists</div>
          <div className="kpi-value" style={{ color: "#087eaf" }}>{inspections.length}</div>
        </div>
      </div>

      {/* Main Table Section */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Pre-Start Inspection Records Register</div>
          </div>
        </div>

        {/* Toolbar & Filter */}
        <div className="prestart-filterbar" style={{ padding: "12px 18px", borderBottom: "1px solid #e7ecef", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", background: "#f8fafc" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#647786" }} />
            <input
              type="text"
              placeholder="Search by ID, vehicle, operator name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="prestart-form-input"
              style={{
                width: "100%",
                padding: "7px 10px 7px 32px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={14} color="#647786" />
            <span className="prestart-modal-label" style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Inspection Result:</span>
            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              className="prestart-form-select"
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
            >
              <option value="All">All Results</option>
              <option value="Passed">Passed (พร้อมใช้งาน)</option>
              <option value="Grounded">Grounded (งดใช้ชั่วคราว)</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Inspection ID & Date</th>
                <th>Vehicle & Operating Hours</th>
                <th>Operator & Shift</th>
                <th>Checklist Summary</th>
                <th>Overall Safety Clearance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInspections.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "#647786" }}>
                    No safety inspection records found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredInspections.map((ins) => (
                  <tr key={ins.id}>
                    <td>
                      <span className="code" style={{ fontWeight: 700 }}>{ins.id}</span>
                      <div className="prestart-modal-sub" style={{ fontSize: 10, color: "#647786", marginTop: 2 }}>{ins.inspectionDate}</div>
                    </td>
                    <td>
                      <div className="prestart-modal-val" style={{ fontWeight: 700, color: "#1e3648" }}>{ins.vehicleId}</div>
                      <div className="prestart-modal-sub" style={{ fontSize: 10, color: "#647786" }}>{ins.operatingHours} Operating Hours</div>
                    </td>
                    <td>
                      <div className="prestart-modal-val" style={{ fontWeight: 600, color: "#334155" }}>{ins.operatorName}</div>
                      <div className="prestart-modal-sub" style={{ fontSize: 10, color: "#647786" }}>{ins.shift}</div>
                    </td>
                    <td>
                      <div className="prestart-modal-val" style={{ fontSize: 11, color: "#0f172a", fontWeight: 600 }}>
                        {ins.items.filter((i) => i.status === "Pass").length} / {ins.items.length} items passed
                      </div>
                      {ins.items.some((i) => i.status === "Fail") && (
                        <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>⚠️ Has defect remarks</div>
                      )}
                    </td>
                    <td>
                      <span
                        className="status"
                        style={{
                          background: ins.overallResult.includes("Passed") ? "#dcfce7" : "#fee2e2",
                          color: ins.overallResult.includes("Passed") ? "#15803d" : "#b91c1c",
                          border: `1px solid ${ins.overallResult.includes("Passed") ? "#86efac" : "#fca5a5"}`,
                        }}
                      >
                        {ins.overallResult}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => setSelectedInspection(ins)}
                      >
                        <FileText size={12} /> View Checklist
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          className="prestart-filterbar"
          style={{
            padding: "10px 18px",
            borderTop: "1px solid #e7ecef",
            background: "#fafbfc",
            fontSize: 11,
            color: "#647786",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span className="prestart-modal-sub">Showing {filteredInspections.length} of {inspections.length} pre-start safety checklists.</span>
          <span className="prestart-modal-sub">WMS Material Handling - Pre-Start Inspection</span>
        </div>
      </section>

      {/* New Pre-Start Inspection Modal */}
      {isModalOpen && (
        <div className="prestart-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div className="prestart-modal-card" style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 800, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div className="prestart-modal-header" style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc", borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
              <div>
                <div className="prestart-modal-title" style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Forklift Pre-Start Safety Inspection Checklist</div>
              </div>
              <button onClick={() => setIsModalOpen(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#647786" }}><X size={20} /></button>
            </div>

            <form onSubmit={handleCreateInspection} style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label className="prestart-modal-label" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>Vehicle to Inspect (เลือกรถฟอร์คลิฟท์) *</label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="prestart-form-select"
                  style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
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
                <label className="prestart-modal-label" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>Operator Name (ชื่อผู้ตรวจสอบ / พนักงานขับรถ) *</label>
                <input
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  required
                  className="prestart-form-input"
                  style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              <div>
                <label className="prestart-modal-label" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>Operation Shift (กะการทำงาน) *</label>
                <select
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                  className="prestart-form-select"
                  style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  <option value="Shift 1 (08:00 - 16:00)">Shift 1 (08:00 - 16:00)</option>
                  <option value="Shift 2 (16:00 - 00:00)">Shift 2 (16:00 - 00:00)</option>
                  <option value="Shift 3 (00:00 - 08:00)">Shift 3 (00:00 - 08:00)</option>
                </select>
              </div>

              <div>
                <label className="prestart-modal-label" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>Operating Hours Meter (ชั่วโมงการทำงานปัจจุบัน) *</label>
                <input
                  type="number"
                  min={0}
                  value={operatingHours}
                  onChange={(e) => setOperatingHours(Number(e.target.value))}
                  required
                  className="prestart-form-input"
                  style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              <div>
                <label className="prestart-modal-label" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>Inspection Date *</label>
                <input
                  type="date"
                  value={inspectionDate}
                  onChange={(e) => setInspectionDate(e.target.value)}
                  required
                  className="prestart-form-input"
                  style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              {/* Checklist Items Table */}
              <div className="prestart-item-box" style={{ gridColumn: "span 2", background: "#f8fafc", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div className="prestart-modal-title" style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Pre-Start Inspection Items (รายการตรวจสอบความปลอดภัย)</div>

                <div style={{ display: "grid", gap: 10 }}>
                  {formItems.map((item, idx) => (
                    <div key={item.id} className="prestart-item-box" style={{ background: "#fff", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0", display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: 10, alignItems: "center" }}>
                      <div>
                        <div className="prestart-item-title" style={{ fontSize: 12, fontWeight: 700, color: "#1e3648" }}>{item.categoryThai}</div>
                        <div className="prestart-item-sub" style={{ fontSize: 10, color: "#647786" }}>{item.categoryEnglish}</div>
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className={`button ${item.status === "Pass" ? "primary" : "secondary"}`}
                          style={{ padding: "4px 10px", fontSize: 11, background: item.status === "Pass" ? "#15803d" : "#fff", color: item.status === "Pass" ? "#fff" : "#15803d", borderColor: "#86efac" }}
                          onClick={() => updateItemStatus(idx, "Pass")}
                        >
                          Pass (ปกติ)
                        </button>
                        <button
                          type="button"
                          className={`button ${item.status === "Fail" ? "primary" : "secondary"}`}
                          style={{ padding: "4px 10px", fontSize: 11, background: item.status === "Fail" ? "#b91c1c" : "#fff", color: item.status === "Fail" ? "#fff" : "#b91c1c", borderColor: "#fca5a5" }}
                          onClick={() => updateItemStatus(idx, "Fail")}
                        >
                          Fail (ชำรุด)
                        </button>
                      </div>

                      <input
                        type="text"
                        placeholder="Remark or defect description if failed..."
                        value={item.remark || ""}
                        onChange={(e) => updateItemRemark(idx, e.target.value)}
                        className="prestart-form-input"
                        style={{ padding: 6, borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", background: overallResult.includes("Passed") ? "#dcfce7" : "#fee2e2", padding: "10px 14px", borderRadius: 6, border: `1px solid ${overallResult.includes("Passed") ? "#86efac" : "#fca5a5"}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: overallResult.includes("Passed") ? "#15803d" : "#b91c1c" }}>
                    Overall Safety Clearance Status: {overallResult}
                  </div>
                  <div className="prestart-modal-sub" style={{ fontSize: 11, color: "#475569" }}>
                    {hasAnyFail ? "Vehicle is grounded until defect is resolved in Fix & Flush." : "Vehicle is fully cleared for warehouse operations."}
                  </div>
                </div>
              </div>

              <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" className="button secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="button primary">Submit Safety Checklist</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspection Details Modal ("Safety Checklist Report") */}
      {selectedInspection && (
        <div className="prestart-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div className="prestart-modal-card" style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 680, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div className="prestart-modal-header" style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc", borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
              <div>
                <div className="prestart-modal-title" style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                  Safety Checklist Report: <span className="code">{selectedInspection.id}</span>
                </div>
                <div className="prestart-modal-sub" style={{ fontSize: 12, color: "#647786", marginTop: 2 }}>
                  Inspected on {selectedInspection.inspectionDate} by {selectedInspection.operatorName}
                </div>
              </div>
              <button onClick={() => setSelectedInspection(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#647786" }}><X size={20} /></button>
            </div>

            <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12, overflowY: "auto", flex: 1 }}>
              <div>
                <div className="prestart-modal-label" style={{ color: "#647786", fontWeight: 600 }}>Vehicle:</div>
                <div className="prestart-modal-val" style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selectedInspection.vehicleDescription}</div>
              </div>
              <div>
                <div className="prestart-modal-label" style={{ color: "#647786", fontWeight: 600 }}>Safety Clearance:</div>
                <div style={{ fontWeight: 700, color: selectedInspection.overallResult.includes("Passed") ? "#15803d" : "#ef4444", marginTop: 2 }}>{selectedInspection.overallResult}</div>
              </div>

              <div>
                <div className="prestart-modal-label" style={{ color: "#647786", fontWeight: 600 }}>Operator & Shift:</div>
                <div className="prestart-modal-val" style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selectedInspection.operatorName} ({selectedInspection.shift})</div>
              </div>
              <div>
                <div className="prestart-modal-label" style={{ color: "#647786", fontWeight: 600 }}>Operating Hours:</div>
                <div className="prestart-modal-val" style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selectedInspection.operatingHours} HRS</div>
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <div className="prestart-modal-label" style={{ color: "#647786", fontWeight: 600, marginBottom: 6 }}>Pre-Start Checklist Details:</div>
                <div className="prestart-table-border" style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
                  <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="prestart-table-header" style={{ background: "#f1f5f9" }}>
                        <th style={{ padding: "8px 12px", textAlign: "left" }}>Inspection Item</th>
                        <th style={{ padding: "8px 12px", textAlign: "center" }}>Status</th>
                        <th style={{ padding: "8px 12px", textAlign: "left" }}>Defect Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInspection.items.map((item, idx) => (
                        <tr key={idx} className="prestart-table-row" style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={{ padding: "8px 12px" }}>
                            <div className="prestart-item-title" style={{ fontWeight: 700, color: "#1e3648" }}>{item.categoryThai}</div>
                            <div className="prestart-item-sub" style={{ fontSize: 10, color: "#647786" }}>{item.categoryEnglish}</div>
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            <span style={{ fontWeight: 700, color: item.status === "Pass" ? "#16a34a" : "#ef4444" }}>
                              {item.status === "Pass" ? "✓ Pass" : "✗ Fail"}
                            </span>
                          </td>
                          <td className="prestart-item-remark" style={{ padding: "8px 12px", color: "#334155" }}>{item.remark || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="prestart-modal-footer" style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 10, background: "#f8fafc", borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
              <button className="button primary" onClick={() => setSelectedInspection(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
