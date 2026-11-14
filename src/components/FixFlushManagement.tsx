/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
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
  Ban,
  RefreshCw,
  Wifi,
  WifiOff,
  Trash2,
  Disc,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { Vehicle } from "../types/officer";
import {
  MhMaintenanceRecord,
  MhTireStockRecord,
  MhTireSize,
  subscribeToMhMaintenance,
  fetchMhMaintenanceOnce,
  saveMhMaintenanceToCloud,
  deleteMhMaintenanceFromCloud,
  subscribeToMhTireStock,
  fetchMhTireStockOnce,
  saveMhTireTransactionToCloud,
  deleteMhTireTransactionFromCloud,
  getForkliftCloudRealtimeEnabled,
  setForkliftCloudRealtimeEnabled,
  subscribeForkliftCloudRealtimeMode,
} from "../services/forkliftDataService";

interface SparePartItem {
  id?: string;
  partCode: string;
  partName: string;
  qty: number;
  unit?: string;
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

type FixFlushRecord = MhMaintenanceRecord;

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

const TIRE_SIZE_OPTIONS: MhTireSize[] = [
  "6.00-9 (ยางตันหน้า/หลัง 2.5T)",
  "7.00-12 (ยางตันหน้า 2.5T-3.0T)",
  "28x9-15 (ยางตันหน้า 3.0T-3.5T)",
  "6.50-10 (ยางตันหลัง 3.0T-3.5T)",
  "250-15 (ยางตันหน้า 4.0T-5.0T)",
  "300-15 (ยางตันหน้า 5.0T-7.0T)",
  "8.25-15 (ยางตันรถลากจูง/เทรลเลอร์)",
];

const WHEEL_POSITION_OPTIONS = [
  "ล้อหน้าซ้าย (FL)",
  "ล้อหน้าขวา (FR)",
  "ล้อหลังซ้าย (RL)",
  "ล้อหลังขวา (RR)",
  "คู่ล้อหน้า (Front Pair)",
  "คู่ล้อหลัง (Rear Pair)",
  "ครบชุด 4 ล้อ (Full Set)",
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
  const [tireRecords, setTireRecords] = useState<MhTireStockRecord[]>([]);
  const [cloudRealtime, setCloudRealtime] = useState<boolean>(() =>
    getForkliftCloudRealtimeEnabled()
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<"technician" | "manager" | "tire_stock">("technician");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [managerFilter, setManagerFilter] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<FixFlushRecord | null>(null);

  // Tire Stock Modal State
  const [isTireModalOpen, setIsTireModalOpen] = useState<boolean>(false);
  const [tireTxType, setTireTxType] = useState<"Inbound" | "Outbound">("Inbound");
  const [tireSize, setTireSize] = useState<string>(TIRE_SIZE_OPTIONS[1]);
  const [tireBrand, setTireBrand] = useState<string>("KOMACHI / PIO");
  const [tireQty, setTireQty] = useState<number>(2);
  const [tireUnitCost, setTireUnitCost] = useState<number>(3800);
  const [tireSupplierOrInvoice, setTireSupplierOrInvoice] = useState<string>("");
  const [tireVehicleId, setTireVehicleId] = useState<string>(vehicles[0]?.vehicleId || "");
  const [tireWheelPosition, setTireWheelPosition] = useState<string>(WHEEL_POSITION_OPTIONS[4]);
  const [tireOperatingHours, setTireOperatingHours] = useState<number>(0);
  const [tireTechnicianName, setTireTechnicianName] = useState<string>("");
  const [tireNotes, setTireNotes] = useState<string>("");
  const [tireSearchQuery, setTireSearchQuery] = useState<string>("");

  // Subscribe to mh_maintenance and mh_tire_stock ONLY while FixFlushManagement is mounted
  useEffect(() => {
    const unsubMode = subscribeForkliftCloudRealtimeMode((enabled) => {
      setCloudRealtime(enabled);
    });
    return () => {
      unsubMode();
    };
  }, []);

  useEffect(() => {
    const unsubMaint = subscribeToMhMaintenance((cloudMaint) => {
      setRecords(cloudMaint);
    });
    const unsubTires = subscribeToMhTireStock((cloudTires) => {
      setTireRecords(cloudTires);
    });
    return () => {
      unsubMaint();
      unsubTires();
    };
  }, [cloudRealtime]);

  const handleManualReload = async () => {
    setIsRefreshing(true);
    try {
      const [latestMaint, latestTires] = await Promise.all([
        fetchMhMaintenanceOnce(),
        fetchMhTireStockOnce(),
      ]);
      setRecords(latestMaint);
      setTireRecords(latestTires);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Compute Tire Stock balance per size
  const tireStockBySize = useMemo(() => {
    const map = new Map<string, { inbound: number; outbound: number; balance: number }>();
    TIRE_SIZE_OPTIONS.forEach((size) => {
      map.set(size, { inbound: 0, outbound: 0, balance: 0 });
    });
    tireRecords.forEach((tr) => {
      const key = tr.tireSize || TIRE_SIZE_OPTIONS[1];
      const current = map.get(key) || { inbound: 0, outbound: 0, balance: 0 };
      if (tr.transactionType === "Inbound") {
        current.inbound += Number(tr.qty) || 0;
      } else {
        current.outbound += Number(tr.qty) || 0;
      }
      current.balance = Math.max(0, current.inbound - current.outbound);
      map.set(key, current);
    });
    return map;
  }, [tireRecords]);

  const totalTiresInStock = useMemo(() => {
    let total = 0;
    tireStockBySize.forEach((v) => {
      total += v.balance;
    });
    return total;
  }, [tireStockBySize]);

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

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVehicle = vehicles.find((v) => v.vehicleId === vehicleId);
    const vehicleDescription = targetVehicle ? `${targetVehicle.vehicleId} - ${targetVehicle.vehicleType} (${targetVehicle.description || "-"})` : (vehicleId || "-");
    const recId = `FIX-${new Date().getFullYear()}-${String(records.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-4)}`;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);

    const newRecord: FixFlushRecord = {
      id: recId,
      workOrderNo: recId,
      repairType,
      vehicleId: vehicleId || "-",
      vehicleNumber: vehicleId || "-",
      vehicleType: targetVehicle?.vehicleType || "Forklift",
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
      createdAt: nowStr,
      updatedAt: nowStr,
    };

    setRecords((prev) => [newRecord, ...prev]);
    setIsModalOpen(false);
    setRepairDescription("");
    setNotes("");
    await saveMhMaintenanceToCloud(newRecord);

    // If repairType is Tire Replacement, also log an outbound tire movement to mh_tire_stock
    if (repairType.includes("เปลี่ยนยาง") || repairType.includes("Tire")) {
      const tireQtyFromParts = spareParts.reduce((s, p) => s + (Number(p.qty) || 0), 0) || 1;
      const tireCostFromParts = calculatedEstimatedCost > 0 ? calculatedEstimatedCost : 3800 * tireQtyFromParts;
      const tireTxId = `TIRE-WO-${Date.now()}`;
      const tireTx: MhTireStockRecord = {
        id: tireTxId,
        transactionNo: tireTxId,
        date: workingDate,
        time: nowStr.slice(11, 16) || "09:00",
        transactionType: "Outbound",
        tireSize: TIRE_SIZE_OPTIONS[1],
        brand: "KOMACHI / PIO",
        qty: tireQtyFromParts,
        unitCost: Math.round(tireCostFromParts / tireQtyFromParts),
        totalCost: tireCostFromParts,
        vehicleId: vehicleId || "-",
        vehicleNumber: vehicleId || "-",
        wheelPosition: "เปลี่ยนยางตามใบแจ้งซ่อม",
        operatingHours: Number(operatingHours) || 0,
        technicianOrReceiver: technicianName.trim() || "-",
        workOrderRef: recId,
        notes: repairDescription.trim() || notes || "เบิกเปลี่ยนยางจากใบแจ้งซ่อม",
        updatedAt: nowStr,
      };
      setTireRecords((prev) => [tireTx, ...prev]);
      await saveMhTireTransactionToCloud(tireTx);
    }
  };

  const handleCreateTireTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);
    const txId = `TIRE-${now.getFullYear()}-${String(tireRecords.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-4)}`;
    const safeQty = Math.max(1, Number(tireQty) || 1);
    const safeUnit = Math.max(0, Number(tireUnitCost) || 0);

    const newTireRecord: MhTireStockRecord = {
      id: txId,
      transactionNo: txId,
      date: dateStr,
      time: timeStr,
      transactionType: tireTxType,
      tireSize,
      brand: tireBrand.trim() || "KOMACHI / PIO",
      qty: safeQty,
      unitCost: safeUnit,
      totalCost: safeQty * safeUnit,
      supplierOrInvoice: tireTxType === "Inbound" ? tireSupplierOrInvoice.trim() || "-" : undefined,
      vehicleId: tireTxType === "Outbound" ? tireVehicleId || "-" : undefined,
      vehicleNumber: tireTxType === "Outbound" ? tireVehicleId || "-" : undefined,
      wheelPosition: tireTxType === "Outbound" ? tireWheelPosition : undefined,
      operatingHours: tireTxType === "Outbound" ? Number(tireOperatingHours) || 0 : undefined,
      technicianOrReceiver: tireTechnicianName.trim() || "-",
      notes: tireNotes.trim() || undefined,
      updatedAt: `${dateStr} ${timeStr}`,
    };

    setTireRecords((prev) => [newTireRecord, ...prev]);
    setIsTireModalOpen(false);
    setTireNotes("");
    await saveMhTireTransactionToCloud(newTireRecord);
  };

  const handleDeleteTireRecord = async (id: string) => {
    setTireRecords((prev) => prev.filter((item) => item.id !== id));
    await deleteMhTireTransactionFromCloud(id);
  };

  // Manager Actions
  const handleManagerApprove = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    const updated: FixFlushRecord = {
      ...target,
      managerStatus: "Approved",
      status: "In Workshop",
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 16),
    };
    setRecords((prev) => prev.map((r) => (r.id === recordId ? updated : r)));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updated);
    }
    await saveMhMaintenanceToCloud(updated);
  };

  const handleManagerReject = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    const updated: FixFlushRecord = {
      ...target,
      managerStatus: "Rejected",
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 16),
    };
    setRecords((prev) => prev.map((r) => (r.id === recordId ? updated : r)));
    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updated);
    }
    await saveMhMaintenanceToCloud(updated);
  };

  const handleSendManagerQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackRecord || !feedbackMessageText.trim()) return;

    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const newMessage: FeedbackMessage = {
      id: `FB-${Date.now()}`,
      author: "Director Somchai (Manager)",
      role: "Manager",
      queryType,
      message: feedbackMessageText.trim(),
      timestamp: nowStr,
    };

    const updatedRecord: FixFlushRecord = {
      ...feedbackRecord,
      managerStatus: "More Info Requested",
      feedbackThread: [...feedbackRecord.feedbackThread, newMessage],
      updatedAt: nowStr,
    };

    setRecords((prev) => prev.map((r) => (r.id === feedbackRecord.id ? updatedRecord : r)));

    if (selectedRecord && selectedRecord.id === feedbackRecord.id) {
      setSelectedRecord(updatedRecord);
    }

    setIsFeedbackModalOpen(false);
    setFeedbackRecord(null);
    setFeedbackMessageText("");
    await saveMhMaintenanceToCloud(updatedRecord);
  };

  const handleTechnicianReply = async (recordId: string, replyText: string) => {
    if (!replyText.trim()) return;
    const target = records.find((r) => r.id === recordId);
    if (!target) return;

    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);
    const replyMsg: FeedbackMessage = {
      id: `FB-${Date.now()}`,
      author: "Technician / Requester",
      role: "Technician",
      message: replyText.trim(),
      timestamp: nowStr,
    };

    const updatedRecord: FixFlushRecord = {
      ...target,
      managerStatus: "Pending Manager Approval",
      feedbackThread: [...target.feedbackThread, replyMsg],
      updatedAt: nowStr,
    };

    setRecords((prev) => prev.map((r) => (r.id === recordId ? updatedRecord : r)));

    if (selectedRecord && selectedRecord.id === recordId) {
      setSelectedRecord(updatedRecord);
    }
    await saveMhMaintenanceToCloud(updatedRecord);
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

  const filteredTireRecords = tireRecords.filter((tr) => {
    if (!tireSearchQuery.trim()) return true;
    const q = tireSearchQuery.toLowerCase();
    return (
      tr.transactionNo.toLowerCase().includes(q) ||
      tr.tireSize.toLowerCase().includes(q) ||
      tr.brand.toLowerCase().includes(q) ||
      (tr.vehicleId || "").toLowerCase().includes(q) ||
      tr.technicianOrReceiver.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fix-flush-management">
      {/* Role / View Switcher Header Bar */}
      <div className="fixflush-topbar bg-white dark:bg-[#111e38] border border-slate-200 dark:border-[#1e3a5f] rounded-lg shadow-sm" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, padding: "12px 20px", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
          <button
            onClick={() => setActiveTab("tire_stock")}
            className={`button ${activeTab === "tire_stock" ? "primary" : "secondary"}`}
            style={{ fontSize: 12, padding: "8px 16px" }}
          >
            <Disc size={14} /> สต๊อกยางโฟล์คลิฟท์ (Tire Stock: {totalTiresInStock} เส้น)
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="button secondary"
            onClick={() => setForkliftCloudRealtimeEnabled(!cloudRealtime)}
            style={{
              padding: "6px 10px",
              fontSize: 11,
              borderColor: cloudRealtime ? "#22c55e" : "#94a3b8",
              color: cloudRealtime ? "#15803d" : "#475569",
            }}
            title="สลับโหมด Cloud Real-time เพื่อประหยัดโควต้าการอ่านข้อมูล"
          >
            {cloudRealtime ? <Wifi size={13} /> : <WifiOff size={13} />}
            {cloudRealtime ? "Cloud Real-time: ON" : "Cloud Real-time: OFF"}
          </button>
          {!cloudRealtime && (
            <button
              type="button"
              className="button secondary"
              onClick={handleManualReload}
              disabled={isRefreshing}
              style={{ padding: "6px 10px", fontSize: 11 }}
            >
              <RefreshCw size={13} />
              {isRefreshing ? "กำลังโหลด..." : "ดึงข้อมูลล่าสุด"}
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => {
              setTireTxType("Inbound");
              setIsTireModalOpen(true);
            }}
          >
            <Disc size={14} />
            + บันทึกสต๊อกยาง
          </button>
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

      {/* Tire Stock Management Panel (mh_tire_stock) */}
      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Disc size={16} color="#087eaf" />
              สต๊อกยางโฟล์คลิฟท์และบันทึกการเบิกเปลี่ยนยาง (Tire Stock Management — mh_tire_stock)
            </div>
            <div className="panel-sub">
              คงเหลือรวมทั้งสิ้น {totalTiresInStock.toLocaleString()} เส้น · แยกฐานข้อมูลอิสระสำหรับงานโฟล์คลิฟท์
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="button primary"
              style={{ background: "#15803d", borderColor: "#15803d" }}
              onClick={() => {
                setTireTxType("Inbound");
                setIsTireModalOpen(true);
              }}
            >
              <ArrowDownLeft size={14} /> + รับเข้ายางใหม่ (Inbound)
            </button>
            <button
              type="button"
              className="button primary"
              style={{ background: "#0369a1", borderColor: "#0369a1" }}
              onClick={() => {
                setTireTxType("Outbound");
                setIsTireModalOpen(true);
              }}
            >
              <ArrowUpRight size={14} /> - เบิกเปลี่ยนยางโฟล์คลิฟท์ (Outbound)
            </button>
          </div>
        </div>

        {/* Tire Stock Balance by Size Grid */}
        <div
          style={{
            padding: "14px 18px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 10,
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          {Array.from(tireStockBySize.entries()).map(([sizeLabel, stats]) => (
            <div
              key={sizeLabel}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: stats.balance > 0 ? "#f8fafc" : "#fff",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1e3648" }}>{sizeLabel}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: stats.balance > 0 ? "#15803d" : "#64748b" }}>
                  {stats.balance} <span style={{ fontSize: 11, fontWeight: 600 }}>เส้น</span>
                </span>
                <span style={{ fontSize: 10, color: "#64748b" }}>
                  รับ +{stats.inbound} / เบิก -{stats.outbound}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Tire Transaction Filter Bar */}
        <div style={{ padding: "12px 18px", display: "flex", gap: 12, alignItems: "center", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#64748b" }} />
            <input
              type="text"
              className="field"
              placeholder="ค้นหาเลขที่รายการ, ขนาดยาง, ยี่ห้อ, รหัสรถโฟล์คลิฟท์, ช่างผู้เบิก..."
              value={tireSearchQuery}
              onChange={(e) => setTireSearchQuery(e.target.value)}
              style={{ width: "100%", padding: "7px 10px 7px 32px", fontSize: 12 }}
            />
          </div>
        </div>

        {/* Tire Stock Transactions Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>เลขที่รายการ & วัน-เวลา</th>
                <th>ประเภท</th>
                <th>ขนาดยาง & ยี่ห้อ</th>
                <th>จำนวน (เส้น)</th>
                <th>ราคา/หน่วย & รวม</th>
                <th>รถโฟล์คลิฟท์ / แหล่งที่มา</th>
                <th>ผู้รับผิดชอบ / หมายเหตุ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filteredTireRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 28, color: "#647786" }}>
                    ยังไม่มีประวัติรายการสต๊อกยางในฐานข้อมูล (mh_tire_stock)
                  </td>
                </tr>
              ) : (
                filteredTireRecords.map((tr) => (
                  <tr key={tr.id}>
                    <td>
                      <span className="code" style={{ fontWeight: 700 }}>{tr.transactionNo}</span>
                      <div style={{ fontSize: 10, color: "#647786", marginTop: 2 }}>
                        {tr.date} · {tr.time}
                      </div>
                    </td>
                    <td>
                      <span
                        className="status"
                        style={{
                          background: tr.transactionType === "Inbound" ? "#dcfce7" : "#e0f2fe",
                          color: tr.transactionType === "Inbound" ? "#15803d" : "#0369a1",
                          border: `1px solid ${tr.transactionType === "Inbound" ? "#86efac" : "#bae6fd"}`,
                        }}
                      >
                        {tr.transactionType === "Inbound" ? "+ รับเข้าสต๊อก" : "- เบิกเปลี่ยนยาง"}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3648" }}>{tr.tireSize}</div>
                      <div style={{ fontSize: 10, color: "#647786" }}>Brand: {tr.brand}</div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: 13,
                          color: tr.transactionType === "Inbound" ? "#15803d" : "#0369a1",
                        }}
                      >
                        {tr.transactionType === "Inbound" ? "+" : "-"}
                        {tr.qty} เส้น
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{tr.totalCost.toLocaleString()} THB</div>
                      <div style={{ fontSize: 10, color: "#647786" }}>@{tr.unitCost.toLocaleString()} THB</div>
                    </td>
                    <td>
                      {tr.transactionType === "Inbound" ? (
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11, color: "#15803d" }}>Supplier / PO</div>
                          <div style={{ fontSize: 11, color: "#334155" }}>{tr.supplierOrInvoice || "-"}</div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 12, color: "#0f172a" }}>{tr.vehicleId || "-"}</div>
                          <div style={{ fontSize: 10, color: "#647786" }}>
                            {tr.wheelPosition || "-"} {tr.operatingHours ? `· ${tr.operatingHours} HRS` : ""}
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 11 }}>{tr.technicianOrReceiver}</div>
                      {tr.notes && <div style={{ fontSize: 10, color: "#647786" }}>{tr.notes}</div>}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button secondary"
                        style={{ padding: "4px 8px", fontSize: 11, color: "#b91c1c", borderColor: "#fca5a5" }}
                        onClick={() => handleDeleteTireRecord(tr.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tire Stock Inbound/Outbound Modal */}
      {isTireModalOpen && (
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
              maxWidth: 620,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15)",
            }}
          >
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: tireTxType === "Inbound" ? "#f0fdf4" : "#f0f9ff",
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                  {tireTxType === "Inbound"
                    ? "+ รับเข้ายางรถโฟล์คลิฟท์ (Tire Stock Inbound)"
                    : "- เบิกเปลี่ยนยางรถโฟล์คลิฟท์ (Tire Stock Outbound)"}
                </div>
                <div style={{ fontSize: 11, color: "#647786", marginTop: 2 }}>
                  บันทึกลงฐานข้อมูลแยกอิสระ (mh_tire_stock)
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTireModalOpen(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#647786" }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateTireTransaction} style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ gridColumn: "span 2", display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`button ${tireTxType === "Inbound" ? "primary" : "secondary"}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setTireTxType("Inbound")}
                >
                  + รับเข้ายางใหม่ (Inbound)
                </button>
                <button
                  type="button"
                  className={`button ${tireTxType === "Outbound" ? "primary" : "secondary"}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setTireTxType("Outbound")}
                >
                  - เบิกเปลี่ยนยาง (Outbound)
                </button>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  ขนาดยาง (Tire Size) *
                </label>
                <select
                  value={tireSize}
                  onChange={(e) => setTireSize(e.target.value)}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                >
                  {TIRE_SIZE_OPTIONS.map((sz) => (
                    <option key={sz} value={sz}>{sz}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  ยี่ห้อ / รุ่นยาง (Brand) *
                </label>
                <input
                  type="text"
                  value={tireBrand}
                  onChange={(e) => setTireBrand(e.target.value)}
                  placeholder="เช่น KOMACHI, PIO, BRIDGESTONE, DUNLOP"
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  จำนวน (เส้น) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={tireQty}
                  onChange={(e) => setTireQty(Number(e.target.value))}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  ราคาต่อเส้น (THB) *
                </label>
                <input
                  type="number"
                  min={0}
                  value={tireUnitCost}
                  onChange={(e) => setTireUnitCost(Number(e.target.value))}
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                  required
                />
              </div>

              {tireTxType === "Inbound" ? (
                <div style={{ gridColumn: "span 2" }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                    ผู้จัดจำหน่าย / เลขที่ใบส่งของ (Supplier / Invoice No.) *
                  </label>
                  <input
                    type="text"
                    value={tireSupplierOrInvoice}
                    onChange={(e) => setTireSupplierOrInvoice(e.target.value)}
                    placeholder="เช่น บจก. สยามไทร์ / INV-2026-089"
                    style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                    required
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                      รถโฟล์คลิฟท์ที่เปลี่ยนยาง (Vehicle) *
                    </label>
                    <select
                      value={tireVehicleId}
                      onChange={(e) => setTireVehicleId(e.target.value)}
                      style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                    >
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.vehicleId}>
                          {v.vehicleId} - {v.vehicleType} ({v.description})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                      ตำแหน่งล้อที่เปลี่ยน (Wheel Position) *
                    </label>
                    <select
                      value={tireWheelPosition}
                      onChange={(e) => setTireWheelPosition(e.target.value)}
                      style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                    >
                      {WHEEL_POSITION_OPTIONS.map((pos) => (
                        <option key={pos} value={pos}>{pos}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  ผู้บันทึก / ช่างผู้เบิก (Technician / Receiver) *
                </label>
                <input
                  type="text"
                  value={tireTechnicianName}
                  onChange={(e) => setTireTechnicianName(e.target.value)}
                  placeholder="ระบุชื่อช่างหรือเจ้าหน้าที่คลังอะไหล่"
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  หมายเหตุ (Notes)
                </label>
                <input
                  type="text"
                  value={tireNotes}
                  onChange={(e) => setTireNotes(e.target.value)}
                  placeholder="รายละเอียดเพิ่มเติม..."
                  style={{ width: "100%", padding: 9, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                />
              </div>

              <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" className="button secondary" onClick={() => setIsTireModalOpen(false)}>
                  ยกเลิก
                </button>
                <button type="submit" className="button primary">
                  บันทึกรายการสต๊อกยาง
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
