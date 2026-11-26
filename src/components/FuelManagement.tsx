/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Fuel,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  X,
  FileText,
  Truck,
  CheckCircle2,
  Droplets,
  RefreshCw,
  Wifi,
  WifiOff,
  Trash2,
} from "lucide-react";
import { Vehicle } from "../types/officer";
import { getVehicleSearchableText, getVehicleTypeDisplayLabel } from "../utils/vehicleHelpers";
import {
  MhFuelStockRecord,
  subscribeToMhFuelStock,
  fetchMhFuelStockOnce,
  saveMhFuelTransactionToCloud,
  deleteMhFuelTransactionFromCloud,
  getForkliftCloudRealtimeEnabled,
  setForkliftCloudRealtimeEnabled,
  subscribeForkliftCloudRealtimeMode,
} from "../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../services/authWorkforceService";

type FuelTransaction = MhFuelStockRecord;

interface FuelManagementProps {
  vehicles: Vehicle[];
}

const INITIAL_FUEL_TRANSACTIONS: FuelTransaction[] = [];

export function FuelManagement({ vehicles }: FuelManagementProps) {
  const [transactions, setTransactions] = useState<FuelTransaction[]>(INITIAL_FUEL_TRANSACTIONS);
  const [cloudRealtime, setCloudRealtime] = useState<boolean>(() =>
    getForkliftCloudRealtimeEnabled()
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [headingPortalTarget, setHeadingPortalTarget] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("page-heading-actions") : null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [fuelTypeFilter, setFuelTypeFilter] = useState("All");

  // Modals
  const [isInboundModalOpen, setIsInboundModalOpen] = useState(false);
  const [isOutboundModalOpen, setIsOutboundModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<FuelTransaction | null>(null);

  useEffect(() => {
    setHeadingPortalTarget(document.getElementById("page-heading-actions"));
  }, []);

  // Subscribe to mh_fuel_stock ONLY when FuelManagement is mounted, and unsubscribe immediately on unmount
  useEffect(() => {
    const unsubMode = subscribeForkliftCloudRealtimeMode((enabled) => {
      setCloudRealtime(enabled);
    });
    return () => {
      unsubMode();
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeToMhFuelStock((cloudRecords) => {
      setTransactions(cloudRecords);
    });
    return () => {
      unsub();
    };
  }, [cloudRealtime]);

  const handleManualReload = async () => {
    setIsRefreshing(true);
    try {
      const latest = await fetchMhFuelStockOnce();
      setTransactions(latest);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Helper: Find latest Price per Liter from the newest Inbound Receipt (or any record) for a fuel category
  const getLatestPricePerLiter = (fuelCategory: "Diesel (ดีเซล)" | "Gasoline (เบนซิน)"): number => {
    const latestInboundWithPrice = transactions.find(
      (t) =>
        t.fuelType === fuelCategory &&
        t.type.includes("Inbound") &&
        typeof t.pricePerLiter === "number" &&
        t.pricePerLiter > 0
    );
    if (latestInboundWithPrice && typeof latestInboundWithPrice.pricePerLiter === "number") {
      return latestInboundWithPrice.pricePerLiter;
    }
    const anyWithPrice = transactions.find(
      (t) =>
        t.fuelType === fuelCategory &&
        typeof t.pricePerLiter === "number" &&
        t.pricePerLiter > 0
    );
    return anyWithPrice?.pricePerLiter ?? 0;
  };

  const latestDieselPrice = getLatestPricePerLiter("Diesel (ดีเซล)");
  const latestGasolinePrice = getLatestPricePerLiter("Gasoline (เบนซิน)");

  // Inbound Form State
  const [inFuelType, setInFuelType] = useState<"Diesel (ดีเซล)" | "Gasoline (เบนซิน)">("Diesel (ดีเซล)");
  const [inQty, setInQty] = useState<number>(0);
  const [inPricePerLiter, setInPricePerLiter] = useState<string>("");
  const [inRecorder, setInRecorder] = useState(() => getActiveRecorderDisplay("").employeeName);
  const [inNotes, setInNotes] = useState("");
  const [inDate, setInDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Outbound Form State
  const [outFuelType, setOutFuelType] = useState<"Diesel (ดีเซล)" | "Gasoline (เบนซิน)">("Diesel (ดีเซล)");
  const [outVehicleId, setOutVehicleId] = useState(vehicles[0]?.vehicleId || "");
  const [outQty, setOutQty] = useState<number>(0);
  const [outMeterStart, setOutMeterStart] = useState<number>(0);
  const [outRecorder, setOutRecorder] = useState(() => getActiveRecorderDisplay("").employeeName);
  const [outPurpose, setOutPurpose] = useState("");
  const [outDate, setOutDate] = useState(() => new Date().toISOString().slice(0, 10));

  const activeOutboundPricePerLiter = getLatestPricePerLiter(outFuelType);
  const activeOutboundTotalCost = Number(((Number(outQty) || 0) * activeOutboundPricePerLiter).toFixed(2));
  const activeInboundPriceNum = Math.max(0, Number(inPricePerLiter) || 0);
  const activeInboundTotalCost = Number(((Number(inQty) || 0) * activeInboundPriceNum).toFixed(2));

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

  const handleOpenInboundModal = () => {
    const latestPrice = getLatestPricePerLiter(inFuelType);
    setInPricePerLiter(latestPrice > 0 ? String(latestPrice) : "");
    setIsInboundModalOpen(true);
  };

  const handleInboundFuelTypeChange = (nextType: "Diesel (ดีเซล)" | "Gasoline (เบนซิน)") => {
    setInFuelType(nextType);
    const latestPrice = getLatestPricePerLiter(nextType);
    setInPricePerLiter(latestPrice > 0 ? String(latestPrice) : "");
  };

  const handleInboundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(inQty) || 0;
    const priceNum = Math.max(0, Number(inPricePerLiter) || 0);
    const totalCostNum = Number((qtyNum * priceNum).toFixed(2));
    const currentTankStock = inFuelType === "Diesel (ดีเซล)" ? dieselStock : gasolineStock;
    const startNum = Math.max(0, currentTankStock);
    const endNum = startNum + qtyNum;
    const txId = `FUEL-${new Date().getFullYear()}-${String(transactions.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-4)}`;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);

    const newTx: FuelTransaction = {
      id: txId,
      transactionNo: txId,
      type: "Inbound Receipt (รับเข้า)",
      fuelType: inFuelType,
      qty: qtyNum,
      pricePerLiter: priceNum,
      totalCost: totalCostNum,
      meterStart: startNum,
      meterEnd: endNum,
      recorderName: inRecorder.trim() || getActiveRecorderDisplay("WMS Storekeeper").label,
      referenceSource: "-",
      purposeOrNotes: inNotes.trim() || "Bulk fuel receipt into warehouse storage tank.",
      workingDate: inDate,
      timestamp: nowStr,
      updatedAt: nowStr,
    };

    setTransactions((prev) => [newTx, ...prev]);
    setIsInboundModalOpen(false);
    setInQty(0);
    setInPricePerLiter("");
    setInNotes("");
    await saveMhFuelTransactionToCloud(newTx);
    void appendWmsActivityLog({
      module: "Fuel Management",
      sectionId: "fleet_ops",
      reference: txId,
      activity: `รับเข้าน้ำมัน ${inFuelType} ปริมาณ ${qtyNum} ลิตร (ราคา ${priceNum.toFixed(2)} บาท/ลิตร รวม ${totalCostNum.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท)`,
      status: "Completed",
    });
  };

  const handleOutboundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(outQty) || 0;
    const startNum = Number(outMeterStart) || 0;
    const endNum = Math.max(0, startNum - qtyNum);
    const latestPrice = getLatestPricePerLiter(outFuelType);
    const totalCostNum = Number((qtyNum * latestPrice).toFixed(2));

    const targetVehicle = vehicles.find((v) => v.vehicleId === outVehicleId);
    const vehicleLabel = targetVehicle ? `${targetVehicle.vehicleId} - ${getVehicleTypeDisplayLabel(targetVehicle.vehicleType, targetVehicle)} (${targetVehicle.description || "Fleet"})` : `${outVehicleId} - Warehouse Fleet`;
    const txId = `FUEL-${new Date().getFullYear()}-${String(transactions.length + 1).padStart(3, "0")}-${Date.now().toString().slice(-4)}`;
    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);

    const newTx: FuelTransaction = {
      id: txId,
      transactionNo: txId,
      type: "Outbound Withdrawal (เบิกออก)",
      fuelType: outFuelType,
      qty: qtyNum,
      pricePerLiter: latestPrice,
      totalCost: totalCostNum,
      meterStart: startNum,
      meterEnd: endNum,
      recorderName: outRecorder.trim() || getActiveRecorderDisplay("WMS Operator").label,
      referenceSource: vehicleLabel,
      purposeOrNotes: outPurpose.trim() || "Vehicle refueling dispatch.",
      workingDate: outDate,
      timestamp: nowStr,
      updatedAt: nowStr,
    };

    setTransactions((prev) => [newTx, ...prev]);
    setIsOutboundModalOpen(false);
    setOutPurpose("");
    await saveMhFuelTransactionToCloud(newTx);
    void appendWmsActivityLog({
      module: "Fuel Management",
      sectionId: "fleet_ops",
      reference: txId,
      activity: `เบิกจ่ายน้ำมัน ${outFuelType} ปริมาณ ${qtyNum} ลิตร (${vehicleLabel}) ราคา ${latestPrice.toFixed(2)} บาท/ลิตร รวม ${totalCostNum.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
      status: "Completed",
    });
  };

  const handleDeleteFuelTx = async (id: string) => {
    setTransactions((prev) => prev.filter((item) => item.id !== id));
    if (selectedTx?.id === id) {
      setSelectedTx(null);
    }
    await deleteMhFuelTransactionFromCloud(id);
    void appendWmsActivityLog({
      module: "Fuel Management",
      sectionId: "fleet_ops",
      reference: id,
      activity: `ลบรายการน้ำมัน ${id}`,
      status: "Completed",
    });
  };

  const filteredTransactions = transactions.filter((t) => {
    const q = searchQuery.trim().toLowerCase();
    const matchedVeh = vehicles.find((v) => t.referenceSource.startsWith(v.vehicleId));
    const matchesSearch =
      !q ||
      t.id.toLowerCase().includes(q) ||
      t.recorderName.toLowerCase().includes(q) ||
      t.referenceSource.toLowerCase().includes(q) ||
      t.purposeOrNotes.toLowerCase().includes(q) ||
      (matchedVeh ? getVehicleSearchableText(matchedVeh).includes(q) : false);

    const matchesType = typeFilter === "All" || t.type.includes(typeFilter);
    const matchesFuelType = fuelTypeFilter === "All" || t.fuelType.includes(fuelTypeFilter);

    return matchesSearch && matchesType && matchesFuelType;
  });

  const cloudSyncControls = (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setForkliftCloudRealtimeEnabled(!cloudRealtime)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border transition-colors whitespace-nowrap shrink-0 ${
          cloudRealtime
            ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-700"
            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50 dark:bg-[#0d1b33] dark:text-slate-300 dark:border-[#1e3a5f]"
        }`}
        title="สลับโหมด Cloud Real-time เพื่อประหยัดโควต้าการอ่านข้อมูล"
      >
        {cloudRealtime ? <Wifi size={13} /> : <WifiOff size={13} />}
        <span>{cloudRealtime ? "Cloud Real-time: ON" : "Cloud Real-time: OFF"}</span>
      </button>

      {!cloudRealtime && (
        <button
          type="button"
          onClick={handleManualReload}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border border-slate-300 dark:border-[#1e3a5f] bg-white dark:bg-[#0d1b33] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#162744] whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
          <span>{isRefreshing ? "กำลังโหลด..." : "ดึงข้อมูลล่าสุด"}</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="fuel-management">
      {headingPortalTarget ? createPortal(cloudSyncControls, headingPortalTarget) : null}
      {/* Tank Level KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi" style={{ borderTopColor: dieselStock <= DIESEL_LOW_THRESHOLD ? "#ef4444" : "#087eaf" }}>
          <div className="kpi-label">Diesel Tank Stock (ถังน้ำมันดีเซล)</div>
          <div className="kpi-value" style={{ color: dieselStock <= DIESEL_LOW_THRESHOLD ? "#ef4444" : "#087eaf" }}>
            {dieselStock.toLocaleString()} <span style={{ fontSize: 14, fontWeight: 600 }}>Liters</span>
          </div>
          <div className="kpi-note" style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "#0284c7" }}>
            ราคาล่าสุด: {latestDieselPrice > 0 ? `฿${latestDieselPrice.toFixed(2)} / ลิตร` : "ยังไม่ระบุราคารับเข้า"}
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
          <div className="kpi-note" style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "#d97706" }}>
            ราคาล่าสุด: {latestGasolinePrice > 0 ? `฿${latestGasolinePrice.toFixed(2)} / ลิตร` : "ยังไม่ระบุราคารับเข้า"}
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
            {!headingPortalTarget && cloudSyncControls}
            <button className="button primary whitespace-nowrap shrink-0" onClick={handleOpenInboundModal}>
              <Plus size={14} /> + Inbound Receipt (รับเข้าน้ำมัน)
            </button>
            <button className="button secondary whitespace-nowrap shrink-0" style={{ background: "#0284c7", color: "#ffffff", borderColor: "#0284c7" }} onClick={() => setIsOutboundModalOpen(true)}>
              <Plus size={14} /> + Outbound Withdrawal (เบิกออก)
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
                <th>Price / Total Cost (ราคา/มูลค่า)</th>
                <th>Meter Start ➔ End</th>
                <th>Source / Vehicle Ref</th>
                <th>Recorder Name</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 30, color: "#647786" }}>
                    No fuel transactions found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const unitPrice =
                    typeof tx.pricePerLiter === "number" && tx.pricePerLiter > 0
                      ? tx.pricePerLiter
                      : getLatestPricePerLiter(tx.fuelType);
                  const computedTotal =
                    typeof tx.totalCost === "number" && tx.totalCost > 0
                      ? tx.totalCost
                      : unitPrice > 0
                      ? Number((tx.qty * unitPrice).toFixed(2))
                      : 0;
                  return (
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
                        {unitPrice > 0 ? (
                          <div>
                            <div className="table-item-name" style={{ fontWeight: 700, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                              ฿{computedTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="table-sub-text" style={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
                              ฿{unitPrice.toFixed(2)} / ลิตร
                            </div>
                          </div>
                        ) : (
                          <span className="table-sub-text" style={{ fontSize: 11 }}>-</span>
                        )}
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
                  );
                })
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
              <button type="button" onClick={() => setIsInboundModalOpen(false)} className="modal-close-btn"><X size={20} /></button>
            </div>

            <form onSubmit={handleInboundSubmit} style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Fuel Category (ประเภทน้ำมัน) *</label>
                <select
                  value={inFuelType}
                  onChange={(e) => handleInboundFuelTypeChange(e.target.value as any)}
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
                  step="any"
                  value={inQty}
                  onChange={(e) => setInQty(Number(e.target.value))}
                  required
                  className="field fuel-input"
                  style={{ width: "100%", padding: 9, borderRadius: 6, fontSize: 12 }}
                />
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Price per Liter (ราคาต่อลิตร - บาท/ลิตร) *</label>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  placeholder="เช่น 32.50"
                  value={inPricePerLiter}
                  onChange={(e) => setInPricePerLiter(e.target.value)}
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
                <div
                  className="fuel-detail-box modal-notes-box"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    padding: "10px 14px",
                    borderRadius: 8,
                  }}
                >
                  <div className="modal-label-text" style={{ fontSize: 12 }}>
                    คำนวณมูลค่ารับเข้า ({Number(inQty || 0).toLocaleString()} ลิตร × ฿{activeInboundPriceNum.toFixed(2)}/ลิตร):
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>
                    ฿{activeInboundTotalCost.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                  </div>
                </div>
              </div>

              <div style={{ gridColumn: "span 2" }}>
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
                      {v.vehicleId} - {getVehicleTypeDisplayLabel(v.vehicleType, v)} ({v.description || "Active Fleet"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="modal-label-text" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Quantity Withdrawn (ปริมาณ ลิตร) *</label>
                <input
                  type="number"
                  min={1}
                  step="any"
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

              <div style={{ gridColumn: "span 2" }}>
                <div
                  className="fuel-detail-box modal-notes-box"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <div className="modal-label-text" style={{ fontSize: 11 }}>
                      ราคาต่อลิตรล่าสุด ({outFuelType}):
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#0284c7", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {activeOutboundPricePerLiter > 0
                        ? `฿${activeOutboundPricePerLiter.toFixed(2)} / ลิตร`
                        : "ยังไม่มีประวัติราคารับเข้า (฿0.00)"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="modal-label-text" style={{ fontSize: 11 }}>
                      คำนวณมูลค่าการเบิกออก ({Number(outQty || 0).toLocaleString()} ลิตร):
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "#0284c7", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      ฿{activeOutboundTotalCost.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                    </div>
                  </div>
                </div>
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

              <div className="fuel-detail-box modal-notes-box">
                <div className="modal-label-text">Price per Liter (ราคาต่อลิตร):</div>
                <div className="modal-val-text" style={{ fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                  {(selectedTx.pricePerLiter ?? getLatestPricePerLiter(selectedTx.fuelType)) > 0
                    ? `฿${(selectedTx.pricePerLiter ?? getLatestPricePerLiter(selectedTx.fuelType)).toFixed(2)} / ลิตร`
                    : "-"}
                </div>
              </div>
              <div className="fuel-detail-box modal-notes-box">
                <div className="modal-label-text">Total Fuel Cost (มูลค่ารวม):</div>
                <div className="modal-val-text" style={{ fontWeight: 800, fontSize: 14, marginTop: 2, color: selectedTx.type.includes("Inbound") ? "#16a34a" : "#0284c7", fontVariantNumeric: "tabular-nums" }}>
                  {(() => {
                    const unitP = selectedTx.pricePerLiter ?? getLatestPricePerLiter(selectedTx.fuelType);
                    const tot = selectedTx.totalCost ?? (unitP > 0 ? Number((selectedTx.qty * unitP).toFixed(2)) : 0);
                    return tot > 0
                      ? `฿${tot.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`
                      : "-";
                  })()}
                </div>
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

            <div className="modal-footer-box fuel-modal-footer" style={{ padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className="button secondary"
                style={{ padding: "6px 10px", fontSize: 11, color: "#b91c1c", borderColor: "#fca5a5" }}
                onClick={() => handleDeleteFuelTx(selectedTx.id)}
              >
                <Trash2 size={12} /> Delete Record
              </button>
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
