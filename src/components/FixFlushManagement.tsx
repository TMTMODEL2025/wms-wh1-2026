/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import {
  Wrench,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Printer,
  Search,
  Filter,
  Plus,
  X,
  FileText,
  Truck,
  DollarSign,
  Package,
  ShieldCheck,
  Activity,
  MessageSquare,
  Send,
  UserCheck,
  HelpCircle,
  Check,
  Ban
} from "lucide-react";
import { Vehicle } from "../types/officer";

interface SparePartItem {
  partCode: string;
  partName: string;
  qty: number;
  unitCost: number;
}

interface FeedbackMessage {
  id: string;
  author: string;
  role: "Manager" | "Technician";
  queryType?: string;
  message: string;
  timestamp: string;
}

interface FixFlushRecord {
  id: string;
  repairType: string;
  vehicleId: string;
  vehicleDescription: string;
  workshopBay: string;
  repairDescription: string;
  status: "Pending Inspection" | "In Workshop" | "Testing" | "Approved" | "Completed";
  managerStatus: "Pending Manager Approval" | "More Info Requested" | "Approved" | "Rejected";
  operatingHours: number;
  technicianName: string;
  workingDate: string;
  spareParts: SparePartItem[];
  estimatedCost: number;
  feedbackThread: FeedbackMessage[];
  notes?: string;
  createdAt: string;
}

interface FixFlushManagementProps {
  vehicles: Vehicle[];
}

const REPAIR_TYPES = [
  "ถ่ายน้ำมันเครื่อง (Engine Oil Change)",
  "เปลี่ยนยาง (Tire Replacement)",
  "ซ่อมช่วงล่าง (Undercarriage Service)",
  "ฟลัชชิ่งระบบไฮดรอลิก (Hydraulic System Flush)",
  "ซ่อมระบบไฟฟ้า & แบตเตอรี่ (Electrical & Battery Repair)",
  "ตรวจเช็คตามรอบ 500 ชม. (500h Routine Maintenance)",
  "ซ่อมฉุกเฉิน / เบรก (Emergency Brake Repair)",
];

const WORKSHOP_BAYS = [
  "Workshop Bay 1 - Hydraulic & Service",
  "Workshop Bay 2 - Heavy Overhaul",
  "Workshop Bay 3 - Tire & Undercarriage",
  "Workshop Bay 4 - Electrical & Battery",
  "External Specialist Service Center",
];

const FEEDBACK_QUERY_TYPES = [
  "Spare parts price check and current market cost (ตรวจสอบราคาอะไหล่และต้นทุนตลาดปัจจุบัน)",
  "Labor hours and repair duration breakdown (รายละเอียดชั่วโมงแรงงานและระยะเวลาซ่อม)",
  "Alternative parts or vendor quotation (เสนอราคาอะไหล่ทดแทนหรือผู้ขายทางเลือก)",
  "Priority and urgency justification (เหตุผลความจำเป็นเร่งด่วนในการซ่อม)",
  "Other clarification / Custom question (คำถามหรือข้อมูลเพิ่มเติมอื่นๆ)",
];

const INITIAL_FIX_RECORDS: FixFlushRecord[] = [];

export function FixFlushManagement({ vehicles }: FixFlushManagementProps) {
  const [records, setRecords] = useState<FixFlushRecord[]>(INITIAL_FIX_RECORDS);
  const [activeTab, setActiveTab] = useState<"technician" | "manager">("technician");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [managerFilter, setManagerFilter] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<FixFlushRecord | null>(null);

  // Feedback Modal State (for Manager query or Technician reply)
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbackRecord, setFeedbackRecord] = useState<FixFlushRecord | null>(null);
  const [queryType, setQueryType] = useState(FEEDBACK_QUERY_TYPES[0]);
  const [feedbackMessageText, setFeedbackMessageText] = useState("");

  // Form State for New Work Order
  const [repairType, setRepairType] = useState(REPAIR_TYPES[0]);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.vehicleId || "");
  const [workshopBay, setWorkshopBay] = useState(WORKSHOP_BAYS[0]);
  const [repairDescription, setRepairDescription] = useState("");
  const [status, setStatus] = useState<"Pending Inspection" | "In Workshop" | "Testing" | "Approved" | "Completed">("Pending Inspection");
  const [operatingHours, setOperatingHours] = useState<number>(0);
  const [technicianName, setTechnicianName] = useState("");
  const [workingDate, setWorkingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const [spareParts, setSpareParts] = useState<SparePartItem[]>([]);

  const addSparePartRow = () => {
    setSpareParts([...spareParts, { partCode: "", partName: "", qty: 1, unitCost: 0 }]);
  };

  const updateSparePart = (index: number, field: keyof SparePartItem, value: any) => {
    const updated = [...spareParts];
    updated[index] = { ...updated[index], [field]: value };
    setSpareParts(updated);
  };

  const removeSparePart = (index: number) => {
    setSpareParts(spareParts.filter((_, idx) => idx !== index));
  };

  const calculatedEstimatedCost = spareParts.reduce((sum, p) => sum + (Number(p.qty) || 0) * (Number(p.unitCost) || 0), 0);

  const handleCreateRecord = (e: React.FormEvent) => {
    e.preventDefault();
    const targetVehicle = vehicles.find((v) => v.vehicleId === vehicleId);
    const vehicleDescription = targetVehicle ? `${targetVehicle.vehicleId} - ${targetVehicle.vehicleType} (${targetVehicle.description || "-"})` : (vehicleId || "-");

    const newRecord: FixFlushRecord = {
      id: `FIX-${new Date().getFullYear()}-${String(records.length + 1).padStart(3, "0")}`,
      repairType,
      vehicleId: vehicleId || "-",
      vehicleDescription,
      workshopBay,
      repairDescription: repairDescription.trim() || "-",
      status,
      managerStatus: "Pending Manager Approval",
      operatingHours: Number(operatingHours) || 0,
      technicianName: technicianName.trim() || "-",
      workingDate,
      spareParts,
      estimatedCost: calculatedEstimatedCost,
      feedbackThread: [],
      notes,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setRecords([newRecord, ...records]);
    setIsModalOpen(false);
    setRepairDescription("");
    setNotes("");
  };

  // Manager Actions
  const handleManagerApprove = (recordId: string) => {
    setRecords(records.map(r => r.id === recordId ? { ...r, managerStatus: "Approved", status: "In Workshop" } : r));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord({ ...selectedRecord, managerStatus: "Approved", status: "In Workshop" });
    }
  };

  const handleManagerReject = (recordId: string) => {
    setRecords(records.map(r => r.id === recordId ? { ...r, managerStatus: "Rejected" } : r));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord({ ...selectedRecord, managerStatus: "Rejected" });
    }
  };

  const handleSendManagerQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackRecord || !feedbackMessageText.trim()) return;

    const newMessage: FeedbackMessage = {
      id: `FB-${Date.now()}`,
      author: "Director Somchai (Manager)",
      role: "Manager",
      queryType,
      message: feedbackMessageText.trim(),
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setRecords(records.map(r => {
      if (r.id === feedbackRecord.id) {
        return {
          ...r,
          managerStatus: "More Info Requested",
          feedbackThread: [...r.feedbackThread, newMessage],
        };
      }
      return r;
    }));

    if (selectedRecord && selectedRecord.id === feedbackRecord.id) {
      setSelectedRecord({
        ...selectedRecord,
        managerStatus: "More Info Requested",
        feedbackThread: [...selectedRecord.feedbackThread, newMessage],
      });
    }

    setIsFeedbackModalOpen(false);
    setFeedbackRecord(null);
    setFeedbackMessageText("");
  };

  const handleTechnicianReply = (recordId: string, replyText: string) => {
    if (!replyText.trim()) return;

    const replyMsg: FeedbackMessage = {
      id: `FB-${Date.now()}`,
      author: "Technician / Requester",
      role: "Technician",
      message: replyText.trim(),
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
    };

    setRecords(records.map(r => {
      if (r.id === recordId) {
        return {
          ...r,
          managerStatus: "Pending Manager Approval", // Resubmitted for approval after reply
          feedbackThread: [...r.feedbackThread, replyMsg],
        };
      }
      return r;
    }));

    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord({
        ...selectedRecord,
        managerStatus: "Pending Manager Approval",
        feedbackThread: [...selectedRecord.feedbackThread, replyMsg],
      });
    }
  };

  const pendingManagerCount = records.filter((r) => r.managerStatus === "Pending Manager Approval").length;
  const moreInfoCount = records.filter((r) => r.managerStatus === "More Info Requested").length;
  const approvedManagerCount = records.filter((r) => r.managerStatus === "Approved").length;

  const filteredRecords = records.filter((r) => {
    const matchesSearch =
      r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.vehicleId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.repairType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.repairDescription.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.technicianName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.workshopBay.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    const matchesManager = managerFilter === "All" || r.managerStatus === managerFilter;
    return matchesSearch && matchesStatus && matchesManager;
  });

  return (
    <div className="fix-flush-management">
      {/* Role / View Switcher Header Bar */}
      <div className="fixflush-topbar bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg shadow-sm" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, padding: "12px 20px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => setActiveTab("technician")}
            className={`button ${activeTab === "technician" ? "primary" : "secondary"}`}
            style={{ fontSize: 12, padding: "8px 16px" }}
          >
            <Wrench size={14} /> Technician & Repair Log
          </button>
          <button
            onClick={() => setActiveTab("manager")}
            className={`button ${activeTab === "manager" ? "primary" : "secondary"}`}
            style={{ fontSize: 12, padding: "8px 16px", position: "relative" }}
          >
            <ShieldCheck size={14} /> Manager Approval Dashboard
            {pendingManagerCount > 0 && (
              <span style={{ background: "#ef4444", color: "#fff", borderRadius: "50%", padding: "1px 6px", fontSize: 10, marginLeft: 6, fontWeight: 700 }}>
                {pendingManagerCount}
              </span>
            )}
          </button>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="button primary" onClick={() => setIsModalOpen(true)}>
            <Plus size={14} />
            + New Maintenance Order
          </button>
          <button className="button secondary" onClick={() => window.print()}>
            <Printer size={13} />
            Print Log
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Pending Manager Approval</div>
          <div className="kpi-value" style={{ color: "#d97706" }}>{pendingManagerCount}</div>
          <div className="kpi-note">Awaiting executive review</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#9333ea" }}>
          <div className="kpi-label">More Info Requested (Feedback)</div>
          <div className="kpi-value" style={{ color: "#9333ea" }}>{moreInfoCount}</div>
          <div className="kpi-note">Waiting technician reply</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#0284c7" }}>
          <div className="kpi-label">Approved & In Workshop</div>
          <div className="kpi-value" style={{ color: "#0369a1" }}>{approvedManagerCount}</div>
          <div className="kpi-note">Active repair in bays</div>
        </div>

        <div className="kpi" style={{ borderTopColor: "#15803d" }}>
          <div className="kpi-label">Total Maintenance Orders</div>
          <div className="kpi-value" style={{ color: "#15803d" }}>{records.length}</div>
          <div className="kpi-note">All fleet records logged</div>
        </div>
      </div>

      {/* Main Panel */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              {activeTab === "manager" ? "Manager Approval Dashboard & Query Loop" : "Fix & Flush Status & Maintenance Work Orders"}
            </div>
            <div className="panel-subtitle">
              {activeTab === "manager"
                ? "Review repair orders, query technicians for cost estimates or parts quotation, and approve or reject."
                : "Fleet maintenance tracking, oil changes, tire replacement, hydraulic flushing, spare parts cost and feedback responses."}
            </div>
          </div>
        </div>

        {/* Toolbar & Filter */}
        <div
          className="filterbar fixflush-filterbar bg-slate-50 dark:bg-[#0d1b33] border-b border-slate-200 dark:border-[#1e3a5f]"
          style={{
            padding: "14px 18px",
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 11 }} className="text-slate-400 dark:text-slate-400" />
            <input
              type="text"
              placeholder="Search by ID, vehicle, repair type, description, technician..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="field search-field w-full pl-9 pr-3 py-2 text-xs rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-400 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
              style={{
                width: "100%",
                padding: "8px 10px 8px 32px",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={14} className="text-slate-400 dark:text-slate-400" />
            <span style={{ fontSize: 12, fontWeight: 600 }} className="text-slate-600 dark:text-slate-200">Manager Approval:</span>
            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
              className="field px-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
              style={{
                fontSize: 12,
              }}
            >
              <option value="All" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">All Manager Statuses</option>
              <option value="Pending Manager Approval" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">Pending Manager Approval</option>
              <option value="More Info Requested" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">More Info Requested</option>
              <option value="Approved" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">Approved</option>
              <option value="Rejected" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">Rejected</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }} className="text-slate-600 dark:text-slate-200">Workshop State:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="field px-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#0c1930] border border-slate-300 dark:border-[#1e3a5f] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
              style={{
                fontSize: 12,
              }}
            >
              <option value="All" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">All Workshop States</option>
              <option value="Pending Inspection" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">Pending Inspection</option>
              <option value="In Workshop" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">In Workshop</option>
              <option value="Testing" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">Testing</option>
              <option value="Approved" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">Approved</option>
              <option value="Completed" className="bg-white dark:bg-[#0c1930] text-slate-900 dark:text-slate-100">Completed</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Repair ID & Date</th>
                <th>Vehicle & Bay</th>
                <th>Repair Type & Scope</th>
                <th>Estimated Cost</th>
                <th>Manager Approval Status</th>
                <th>Feedback / Query Loop</th>
                <th>Workshop Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 30, color: "#647786" }}>
                    No maintenance records found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => (
                  <tr key={rec.id}>
                    <td>
                      <span className="code" style={{ fontWeight: 700 }}>{rec.id}</span>
                      <div className="table-timestamp" style={{ fontSize: 10, color: "#647786", marginTop: 2 }}>{rec.workingDate}</div>
                    </td>
                    <td>
                      <div className="table-item-name" style={{ fontWeight: 700, color: "#1e3648" }}>{rec.vehicleId}</div>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#647786" }}>{rec.workshopBay}</div>
                    </td>
                    <td>
                      <div className="table-item-name" style={{ fontWeight: 600, color: "#1e3648" }}>{rec.repairType}</div>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#647786", maxWidth: 220, whiteSpace: "normal" }}>
                        {rec.repairDescription}
                      </div>
                    </td>
                    <td>
                      <div className="table-qty" style={{ fontWeight: 700, color: "#0f172a" }}>
                        {rec.estimatedCost.toLocaleString()} THB
                      </div>
                      <div className="table-sub-text" style={{ fontSize: 10, color: "#647786" }}>{rec.spareParts.length} parts items</div>
                    </td>
                    <td>
                      <span
                        className="status"
                        style={{
                          background:
                            rec.managerStatus === "Approved"
                              ? "#dcfce7"
                              : rec.managerStatus === "More Info Requested"
                              ? "#f3e8ff"
                              : rec.managerStatus === "Rejected"
                              ? "#fee2e2"
                              : "#fef9c3",
                          color:
                            rec.managerStatus === "Approved"
                              ? "#15803d"
                              : rec.managerStatus === "More Info Requested"
                              ? "#7e22ce"
                              : rec.managerStatus === "Rejected"
                              ? "#b91c1c"
                              : "#854d0e",
                          border: `1px solid ${
                            rec.managerStatus === "Approved"
                              ? "#86efac"
                              : rec.managerStatus === "More Info Requested"
                              ? "#d8b4fe"
                              : rec.managerStatus === "Rejected"
                              ? "#fca5a5"
                              : "#fde047"
                          }`,
                        }}
                      >
                        {rec.managerStatus}
                      </span>
                    </td>
                    <td>
                      {rec.feedbackThread.length > 0 ? (
                        <button
                          className="button secondary"
                          style={{ padding: "3px 8px", fontSize: 11, background: "#f3e8ff", color: "#7e22ce", borderColor: "#d8b4fe" }}
                          onClick={() => setSelectedRecord(rec)}
                        >
                          <MessageSquare size={12} /> {rec.feedbackThread.length} Messages
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>No queries</span>
                      )}
                    </td>
                    <td>
                      <span
                        className="status"
                        style={{
                          background: rec.status === "Approved" || rec.status === "Completed" ? "#dcfce7" : "#e0f2fe",
                          color: rec.status === "Approved" || rec.status === "Completed" ? "#15803d" : "#0369a1",
                        }}
                      >
                        {rec.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="button secondary"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                          onClick={() => setSelectedRecord(rec)}
                        >
                          <FileText size={12} /> Inspect
                        </button>

                        {activeTab === "manager" && rec.managerStatus === "Pending Manager Approval" && (
                          <>
                            <button
                              className="button primary"
                              style={{ padding: "4px 8px", fontSize: 11, background: "#15803d", borderColor: "#15803d" }}
                              onClick={() => handleManagerApprove(rec.id)}
                              title="Approve Repair"
                            >
                              <Check size={12} /> Approve
                            </button>
                            <button
                              className="button secondary"
                              style={{ padding: "4px 8px", fontSize: 11, background: "#f3e8ff", color: "#7e22ce", borderColor: "#d8b4fe" }}
                              onClick={() => {
                                setFeedbackRecord(rec);
                                setIsFeedbackModalOpen(true);
                              }}
                              title="Request More Info"
                            >
                              <HelpCircle size={12} /> Query
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          className="border-t border-slate-200 dark:border-[#1e3a5f] bg-[#fafbfc] dark:bg-[#0d1b33] text-slate-500 dark:text-slate-400"
          style={{
            padding: "12px 18px",
            fontSize: 11,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Showing {filteredRecords.length} of {records.length} maintenance and repair work orders.</span>
          <span>WMS Warehouse 1 - Executive Manager Approval & Feedback Loop</span>
        </div>
      </section>

      {/* New Maintenance Order Modal */}
      {isModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              width: "100%",
              maxWidth: 800,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Create Fix & Flush Maintenance Work Order</div>
                <div style={{ fontSize: 12, color: "#647786", marginTop: 2 }}>
                  Submit repair order for executive manager approval and workshop dispatch.
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#647786" }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateRecord} style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Repair Type Dropdown */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Repair Type (ประเภทการซ่อม) *
                </label>
                <select
                  value={repairType}
                  onChange={(e) => setRepairType(e.target.value)}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  {REPAIR_TYPES.map((rt) => (
                    <option key={rt} value={rt}>{rt}</option>
                  ))}
                </select>
              </div>

              {/* Vehicle Selection Dropdown */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Vehicle to Repair (เลือกรถที่จะซ่อม) *
                </label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  <option value="">-- เลือกรถ / Select Vehicle --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.vehicleId}>
                      {v.vehicleId} - {v.vehicleType} ({v.description || "Active Fleet"})
                    </option>
                  ))}
                </select>
              </div>

              {/* Workshop Bay */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Workshop Bay (ช่องซ่อมบำรุง) *
                </label>
                <select
                  value={workshopBay}
                  onChange={(e) => setWorkshopBay(e.target.value)}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  {WORKSHOP_BAYS.map((bay) => (
                    <option key={bay} value={bay}>{bay}</option>
                  ))}
                </select>
              </div>

              {/* Status Workflow */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Initial Status Workflow *
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  <option value="Pending Inspection">Pending Inspection (รอตรวจสอบ)</option>
                  <option value="In Workshop">In Workshop (กำลังซ่อมในศูนย์)</option>
                  <option value="Testing">Testing (กำลังทดสอบระบบ)</option>
                </select>
              </div>

              {/* Operating Hours */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Operating Hours (ชั่วโมงการทำงานเครื่องจักร) *
                </label>
                <input
                  type="number"
                  value={operatingHours}
                  onChange={(e) => setOperatingHours(Number(e.target.value))}
                  min={0}
                  required
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              {/* Technician Name */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Assigned Technician / Mechanic *
                </label>
                <input
                  type="text"
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                  required
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              {/* Working Date */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Maintenance Date *
                </label>
                <input
                  type="date"
                  value={workingDate}
                  onChange={(e) => setWorkingDate(e.target.value)}
                  required
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              {/* Repair Description */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Repair Description & Scope (รายการที่ต้องซ่อม) *
                </label>
                <textarea
                  value={repairDescription}
                  onChange={(e) => setRepairDescription(e.target.value)}
                  rows={2}
                  required
                  placeholder="Describe details of the malfunction, oil flush steps, or parts replacement..."
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              {/* Spare Parts List & Estimated Cost Section */}
              <div style={{ gridColumn: "span 2", background: "#f8fafc", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Spare Parts & Materials Tracking</div>
                    <div style={{ fontSize: 11, color: "#647786" }}>Track required replacement spare parts, fluids, and estimated cost for manager review.</div>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={addSparePartRow}
                    style={{ padding: "5px 10px", fontSize: 11 }}
                  >
                    <Plus size={12} /> Add Spare Part
                  </button>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {spareParts.map((sp, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 0.6fr 1fr auto", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Part Code"
                        value={sp.partCode}
                        onChange={(e) => updateSparePart(idx, "partCode", e.target.value)}
                        style={{ padding: 7, borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                      />
                      <input
                        type="text"
                        placeholder="Part Name / Description"
                        value={sp.partName}
                        onChange={(e) => updateSparePart(idx, "partName", e.target.value)}
                        style={{ padding: 7, borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        min={1}
                        value={sp.qty}
                        onChange={(e) => updateSparePart(idx, "qty", Number(e.target.value))}
                        style={{ padding: 7, borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                      />
                      <input
                        type="number"
                        placeholder="Unit Cost (THB)"
                        min={0}
                        value={sp.unitCost}
                        onChange={(e) => updateSparePart(idx, "unitCost", Number(e.target.value))}
                        style={{ padding: 7, borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                      />
                      <button
                        type="button"
                        onClick={() => removeSparePart(idx)}
                        style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", padding: 4 }}
                        title="Remove part"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, fontSize: 13, fontWeight: 700, color: "#1e3648" }}>
                  Estimated Total Spare Parts Cost: <span style={{ color: "#087eaf", marginLeft: 8 }}>{calculatedEstimatedCost.toLocaleString()} THB</span>
                </div>
              </div>

              {/* Notes */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Additional Notes & Inspection Remarks
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Enter supervisor sign-off remarks or safety checks..."
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
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
                  Submit Work Order for Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manager Query Feedback Modal */}
      {isFeedbackModalOpen && feedbackRecord && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1050,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              width: "100%",
              maxWidth: 600,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                  Request More Info / Feedback: <span className="code">{feedbackRecord.id}</span>
                </div>
                <div style={{ fontSize: 11, color: "#647786" }}>Query technician for cost breakdown, alternative parts, or justification before approval.</div>
              </div>
              <button
                onClick={() => setIsFeedbackModalOpen(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#647786" }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSendManagerQuery} style={{ padding: 20, display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Query Category (ประเภทคำขอข้อมูลเพิ่มเติม) *
                </label>
                <select
                  value={queryType}
                  onChange={(e) => setQueryType(e.target.value)}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  {FEEDBACK_QUERY_TYPES.map((qt) => (
                    <option key={qt} value={qt}>{qt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Manager Query Message to Technician (ข้อความคำถามถึงผู้แจ้งซ่อม) *
                </label>
                <textarea
                  value={feedbackMessageText}
                  onChange={(e) => setFeedbackMessageText(e.target.value)}
                  rows={4}
                  required
                  placeholder="e.g., Please provide vendor quotation or check if alternative parts are available..."
                  style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setIsFeedbackModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="button primary" style={{ background: "#7e22ce", borderColor: "#7e22ce" }}>
                  <Send size={13} /> Send Query to Technician
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect / Details & Feedback Thread Modal */}
      {selectedRecord && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              width: "100%",
              maxWidth: 720,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                  Maintenance Work Order: <span className="code">{selectedRecord.id}</span>
                </div>
                <div style={{ fontSize: 12, color: "#647786", marginTop: 2 }}>
                  Recorded on {selectedRecord.createdAt} by {selectedRecord.technicianName}
                </div>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#647786" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12, overflowY: "auto", flex: 1 }}>
              <div>
                <div style={{ color: "#647786", fontWeight: 600 }}>Repair Type:</div>
                <div style={{ fontWeight: 700, color: "#087eaf", marginTop: 2 }}>{selectedRecord.repairType}</div>
              </div>
              <div>
                <div style={{ color: "#647786", fontWeight: 600 }}>Manager Approval Status:</div>
                <div style={{ fontWeight: 700, color: "#7e22ce", marginTop: 2 }}>{selectedRecord.managerStatus}</div>
              </div>

              <div>
                <div style={{ color: "#647786", fontWeight: 600 }}>Vehicle / Equipment:</div>
                <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selectedRecord.vehicleDescription}</div>
              </div>
              <div>
                <div style={{ color: "#647786", fontWeight: 600 }}>Workshop Bay:</div>
                <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selectedRecord.workshopBay}</div>
              </div>

              <div>
                <div style={{ color: "#647786", fontWeight: 600 }}>Operating Hours:</div>
                <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selectedRecord.operatingHours} HRS</div>
              </div>
              <div>
                <div style={{ color: "#647786", fontWeight: 600 }}>Assigned Technician:</div>
                <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{selectedRecord.technicianName}</div>
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <div style={{ color: "#647786", fontWeight: 600 }}>Repair Description:</div>
                <div style={{ fontWeight: 600, color: "#1e3648", marginTop: 2, background: "#f8fafc", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  {selectedRecord.repairDescription}
                </div>
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <div style={{ color: "#647786", fontWeight: 600, marginBottom: 6 }}>Spare Parts & Costs List:</div>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
                  <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={{ padding: "6px 10px", textAlign: "left" }}>Part Code</th>
                        <th style={{ padding: "6px 10px", textAlign: "left" }}>Description</th>
                        <th style={{ padding: "6px 10px", textAlign: "center" }}>Qty</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Unit Cost</th>
                        <th style={{ padding: "6px 10px", textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRecord.spareParts.map((sp, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={{ padding: "6px 10px" }}><span className="code">{sp.partCode}</span></td>
                          <td style={{ padding: "6px 10px" }}>{sp.partName}</td>
                          <td style={{ padding: "6px 10px", textAlign: "center" }}>{sp.qty}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right" }}>{sp.unitCost.toLocaleString()} THB</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>{(sp.qty * sp.unitCost).toLocaleString()} THB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, fontSize: 12, fontWeight: 700, color: "#0f172a" }}>
                  Total Estimated Cost: <span style={{ color: "#087eaf", marginLeft: 6 }}>{selectedRecord.estimatedCost.toLocaleString()} THB</span>
                </div>
              </div>

              {/* Feedback & Query Thread Section */}
              <div style={{ gridColumn: "span 2", background: "#faf5ff", padding: 14, borderRadius: 8, border: "1px solid #e9d5ff" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#6b21a8", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <MessageSquare size={14} /> Manager & Technician Feedback / Query Thread
                </div>

                {selectedRecord.feedbackThread.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>No questions or clarification requests logged yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
                    {selectedRecord.feedbackThread.map((fb) => (
                      <div
                        key={fb.id}
                        style={{
                          background: fb.role === "Manager" ? "#fff" : "#f0fdf4",
                          padding: 10,
                          borderRadius: 6,
                          border: `1px solid ${fb.role === "Manager" ? "#d8b4fe" : "#bbf7d0"}`,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: fb.role === "Manager" ? "#7e22ce" : "#15803d", marginBottom: 2 }}>
                          <span>{fb.author} ({fb.role})</span>
                          <span style={{ fontSize: 10, color: "#647786" }}>{fb.timestamp}</span>
                        </div>
                        {fb.queryType && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#4b5563", marginBottom: 4, fontStyle: "italic" }}>
                            Topic: {fb.queryType}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: "#1f2937" }}>{fb.message}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply box for Technician if More Info Requested */}
                {selectedRecord.managerStatus === "More Info Requested" && (
                  <div style={{ marginTop: 10, background: "#fff", padding: 10, borderRadius: 6, border: "1px solid #d8b4fe" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6b21a8", marginBottom: 6 }}>
                      Reply to Manager & Resubmit for Approval:
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const formElem = e.currentTarget;
                        const inputElem = formElem.elements.namedItem("replyText") as HTMLInputElement;
                        if (inputElem && inputElem.value) {
                          handleTechnicianReply(selectedRecord.id, inputElem.value);
                          inputElem.value = "";
                        }
                      }}
                      style={{ display: "flex", gap: 8 }}
                    >
                      <input
                        type="text"
                        name="replyText"
                        placeholder="Type your explanation, price check reply, or vendor quotation details..."
                        style={{ flex: 1, padding: 7, borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                        required
                      />
                      <button type="submit" className="button primary" style={{ background: "#7e22ce", borderColor: "#7e22ce", padding: "6px 12px", fontSize: 11 }}>
                        <Send size={12} /> Reply & Resubmit
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {selectedRecord.notes && (
                <div style={{ gridColumn: "span 2", background: "#f8fafc", padding: 10, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <div style={{ color: "#647786", fontWeight: 600 }}>Remarks & Notes:</div>
                  <div style={{ color: "#334155", marginTop: 2 }}>{selectedRecord.notes}</div>
                </div>
              )}
            </div>

            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                {selectedRecord.managerStatus === "Pending Manager Approval" && (
                  <>
                    <button
                      className="button primary"
                      style={{ padding: "6px 12px", fontSize: 12, background: "#15803d", borderColor: "#15803d" }}
                      onClick={() => handleManagerApprove(selectedRecord.id)}
                    >
                      <Check size={13} /> Approve Work Order
                    </button>
                    <button
                      className="button secondary"
                      style={{ padding: "6px 12px", fontSize: 12, background: "#f3e8ff", color: "#7e22ce", borderColor: "#d8b4fe" }}
                      onClick={() => {
                        setFeedbackRecord(selectedRecord);
                        setIsFeedbackModalOpen(true);
                      }}
                    >
                      <HelpCircle size={13} /> Request More Info (Query)
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="button secondary"
                  onClick={() => window.print()}
                >
                  <Printer size={13} /> Print
                </button>
                <button
                  className="button primary"
                  onClick={() => setSelectedRecord(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
