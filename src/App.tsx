import React, { useMemo, useState, useEffect } from "react";
import {
  LayoutDashboard,
  Truck,
  Layers,
  Sheet,
  Disc,
  Users,
  Package,
  Boxes,
  MapPin,
  Search,
  Plus,
  Printer,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  X,
  FileSpreadsheet,
  Info,
  ClipboardCheck,
  ClipboardList,
  Activity,
  ChevronDown,
  ChevronRight,
  UserCheck,
  FileText,
  Eye,
  Wrench,
  Fuel,
  Menu,
  ShieldCheck,
  Bell,
  LogOut,
  Settings,
  ArrowRight,
  ArrowRightLeft,
  ArrowDownRight,
  ArrowUpRight,
  Cpu,
  Sun,
  Moon,
} from "lucide-react";
import { VehicleManagement } from "./components/VehicleManagement";
import { EmployeeManagement } from "./components/EmployeeManagement";
import { TransportOperations } from "./components/TransportOperations";
import { FixFlushManagement } from "./components/FixFlushManagement";
import { FuelManagement } from "./components/FuelManagement";
import { PreStartInspection } from "./components/PreStartInspection";
import { SlitFilmManagement } from "./components/SlitFilmManagement";
import {
  loadStoredAssignments,
  saveStoredAssignments,
  loadStoredVehicles,
  saveStoredVehicles,
  loadStoredEmployees,
  saveStoredEmployees,
} from "./data/officerData";
import { Employee, Vehicle, VehicleAssignment } from "./types/officer";
import { LanguageProvider, useLanguage, Translations } from "./contexts/LanguageContext";

interface RecordItem {
  id: number;
  module: string;
  code: string;
  name: string;
  location: string;
  qty: number;
  unit: string;
  status: string;
  updatedAt?: string;
  notes?: string;
}

interface ColumnConfig {
  key: keyof RecordItem;
  label: string;
}

interface ModuleConfig {
  title: string;
  subtitle: string;
  columns: ColumnConfig[];
}

interface TransactionItem {
  id?: string;
  time: string;
  reference: string;
  module: string;
  activity: string;
  status: "Completed" | "Pending" | "Attention" | "Available" | string;
}

const getMaterialHandlingSubmenu = (t: (key: keyof Translations) => string) => [
  { id: "transport", label: t("transportOperation"), icon: Activity },
  { id: "fix-flush", label: t("fixFlushStatus"), icon: Wrench },
  { id: "pre-start", label: t("preStartInspection"), icon: ShieldCheck },
  { id: "vehicles", label: t("vehicleManagement"), icon: Truck },
  { id: "employees", label: t("employeeManagement"), icon: UserCheck },
  { id: "fuel", label: t("fuelManagement"), icon: Fuel },
];

const getWarehouseInventoryItems = (t: (key: keyof Translations) => string) => [
  { id: "slit", label: t("slitFilm"), icon: Layers },
  { id: "rm", label: t("rmSteelSheet"), icon: Sheet },
  { id: "coil", label: t("coilManagement"), icon: Disc },
];

const getAdministrationItems = (t: (key: keyof Translations) => string) => [
  { id: "admin", label: t("adminWorkforce"), icon: Users },
];

const STATUS_LABELS: Record<string, { th: string; en: string }> = {
  Available: { th: "พร้อมใช้งาน", en: "Available" },
  Completed: { th: "เสร็จสิ้น", en: "Completed" },
  Present: { th: "มาปฏิบัติงาน", en: "Present" },
  Pending: { th: "รอดำเนินการ", en: "Pending" },
  Overtime: { th: "ทำโอที (OT)", en: "Overtime" },
  "Check Stock": { th: "ต้องตรวจนับ", en: "Check Stock" },
  Attention: { th: "ต้องตรวจสอบ", en: "Attention" },
  Maintenance: { th: "ซ่อมบำรุง", en: "Maintenance" },
  "Out of Stock": { th: "สินค้าหมด", en: "Out of Stock" },
  "On Leave": { th: "ลาหยุด", en: "On Leave" },
  Dispatched: { th: "จ่ายออกแล้ว", en: "Dispatched" },
  Scheduled: { th: "ตามกำหนดการ", en: "Scheduled" },
  "In Transit": { th: "อยู่ระหว่างขนส่ง", en: "In Transit" },
  Approved: { th: "อนุมัติแล้ว", en: "Approved" },
  Issued: { th: "ออกเอกสารแล้ว", en: "Issued" },
  Normal: { th: "ปกติ", en: "Normal" },
  Warning: { th: "เตือน", en: "Warning" },
};

function getModuleInfo(t: (key: keyof Translations) => string): Record<string, ModuleConfig> {
  return {
    transport: {
      title: t("transportOperation"),
      subtitle: "",
      columns: [],
    },
    "fix-flush": {
      title: t("fixFlushStatus"),
      subtitle: t("fixFlushSubtitle"),
      columns: [
        { key: "code", label: t("colFleetId") },
        { key: "name", label: t("colMaintenanceAction") },
        { key: "location", label: t("colWorkshopBay") },
        { key: "qty", label: t("colOperatingHours") },
        { key: "unit", label: t("colUnit") },
        { key: "status", label: t("colStatus") },
      ],
    },
    "pre-start": {
      title: t("preStartInspection"),
      subtitle: t("preStartSubtitle"),
      columns: [],
    },
    vehicles: {
      title: t("vehicleManagement"),
      subtitle: t("vehiclesSubtitle"),
      columns: [],
    },
    employees: {
      title: t("employeeManagement"),
      subtitle: t("employeesSubtitle"),
      columns: [],
    },
    fuel: {
      title: t("fuelManagement"),
      subtitle: t("fuelSubtitle"),
      columns: [
        { key: "code", label: t("colVehicleId") },
        { key: "name", label: t("colVehicleDesc") },
        { key: "location", label: t("colDispenserStation") },
        { key: "qty", label: t("colFuelStockUsage") },
        { key: "unit", label: t("colUnit") },
        { key: "status", label: t("colStatus") },
      ],
    },
    slit: {
      title: t("slitFilm"),
      subtitle: t("slitSubtitle"),
      columns: [
        { key: "code", label: t("colMaterialCode") },
        { key: "name", label: t("colMaterialDesc") },
        { key: "location", label: t("colStorageLocation") },
        { key: "qty", label: t("colStockQty") },
        { key: "unit", label: t("colUom") },
        { key: "status", label: t("colStatus") },
      ],
    },
    rm: {
      title: t("rmSteelSheet"),
      subtitle: t("rmSubtitle"),
      columns: [
        { key: "code", label: t("colMaterialCode") },
        { key: "name", label: t("colMaterialDesc") },
        { key: "location", label: t("colStorageLocation") },
        { key: "qty", label: t("colStockQty") },
        { key: "unit", label: t("colUom") },
        { key: "status", label: t("colStatus") },
      ],
    },
    coil: {
      title: t("coilManagement"),
      subtitle: t("coilSubtitle"),
      columns: [
        { key: "code", label: t("colMaterialCode") },
        { key: "name", label: t("colMaterialDesc") },
        { key: "location", label: t("colStorageLocation") },
        { key: "qty", label: t("colStockQty") },
        { key: "unit", label: t("colUom") },
        { key: "status", label: t("colStatus") },
      ],
    },
    admin: {
      title: t("adminWorkforce"),
      subtitle: t("adminSubtitle"),
      columns: [
        { key: "code", label: t("colEmployeeId") },
        { key: "name", label: t("colEmployeeName") },
        { key: "location", label: t("colDepartment") },
        { key: "qty", label: t("colWorkingHours") },
        { key: "unit", label: t("colUnit") },
        { key: "status", label: t("colStatus") },
      ],
    },
  };
}

const SIDEBAR_IMAGES: Record<string, string> = {
  dashboard: "/assets/sidebar/bg_overview.png",
  materialHandling: "/assets/sidebar/bg_forklift.png",
  slit: "/assets/aistudio/header_banner_clean.png",
  rm: "/assets/sidebar/bg_sheet.png",
  coil: "/assets/sidebar/bg_coil.png",
  admin: "/assets/sidebar/bg_admin.png",
};

const HEADER_PRODUCTS = [
  {
    id: "coil",
    nameTh: "เหล็กม้วน (Steel Coil)",
    nameEn: "Steel Coil",
    image: "/assets/sidebar/bg_coil.png",
  },
  {
    id: "slit",
    nameTh: "เหล็กสลิต / ฟิล์ม (Slit Steel)",
    nameEn: "Slit Steel / Film",
    image: "/assets/aistudio/header_banner_clean.png",
  },
  {
    id: "sheet",
    nameTh: "เหล็กแผ่น RM (RM Steel Sheet)",
    nameEn: "RM Steel Sheet",
    image: "/assets/sidebar/bg_sheet.png",
  },
];

const HEADER_NAV_ITEMS = [
  {
    id: "coil",
    labelTh: "เหล็กม้วน",
    labelEn: "Steel Coil",
    icon: Disc,
  },
  {
    id: "slit",
    labelTh: "เหล็กสลิต",
    labelEn: "Slit Steel",
    icon: Layers,
  },
  {
    id: "rm",
    labelTh: "เหล็กแผ่น",
    labelEn: "Steel Sheet",
    icon: Sheet,
  },
  {
    id: "transport",
    labelTh: "รถโฟล์คลิฟท์",
    labelEn: "Forklift",
    icon: Truck,
  },
  {
    id: "admin",
    labelTh: "Admin",
    labelEn: "Admin",
    icon: Settings,
  },
];

const INITIAL_INVENTORY: RecordItem[] = [];

const INITIAL_FLEET: RecordItem[] = [];

const INITIAL_EMPLOYEES: RecordItem[] = [];

const INITIAL_TRANSACTIONS: TransactionItem[] = [];

const CSS = `
  :root {
    font-family: 'Noto Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #263746;
    background: #f4f6f8;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    --blue: #087eaf;
    --blue-dark: #075985;
    --border: #d9e0e5;
    --muted: #647786;
    --surface: #ffffff;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-width: 320px;
    background: #f4f6f8;
  }

  button, input, select {
    font: inherit;
  }

  button { cursor: pointer; }

  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid #087eaf;
    outline-offset: 2px;
  }

  .shell {
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .header-wrap {
    position: sticky;
    top: 0;
    z-index: 50;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    box-shadow: 0 4px 18px rgba(0, 210, 255, 0.35), 0 2px 10px rgba(0, 0, 0, 0.4);
  }

  .topbar-main {
    height: 68px;
    background: linear-gradient(135deg, #02122c 0%, #082245 100%);
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 16px;
    position: relative;
    width: 100%;
    z-index: 2;
    overflow: hidden;
  }

  .topbar-left-hamburger {
    background: rgba(10, 22, 40, 0.85);
    border: 1px solid rgba(0, 210, 255, 0.45);
    color: #00e1ff;
    width: 38px;
    height: 38px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(8px);
    flex-shrink: 0;
    margin-right: 14px;
    z-index: 20;
  }

  .topbar-left-hamburger:hover {
    background: rgba(0, 194, 255, 0.3);
    color: #ffffff;
    border-color: #00e1ff;
    box-shadow: 0 0 14px rgba(0, 225, 255, 0.6);
    transform: scale(1.05);
  }

  .topbar-left-hamburger:active {
    transform: scale(0.95);
  }

  /* Sub-bar underneath Header Bar */
  .topbar-sub {
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    gap: 12px;
    background: rgba(3, 10, 24, 0.92);
    border-top: 1px solid rgba(0, 210, 255, 0.28);
    border-bottom: 2px solid #00d2ff;
    backdrop-filter: blur(8px);
    position: relative;
    z-index: 2;
  }

  .topbar-sub-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .topbar-sub-tag {
    font-size: 10px;
    font-weight: 800;
    color: #00e1ff;
    background: rgba(0, 225, 255, 0.15);
    border: 1px solid rgba(0, 225, 255, 0.35);
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-shadow: 0 0 6px rgba(0, 225, 255, 0.5);
  }

  .topbar-sub-tag .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 6px #10b981;
    animation: pulseDot 2s infinite ease-in-out;
  }

  @keyframes pulseDot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }

  .topbar-sub-desc {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
    letter-spacing: 0.3px;
  }

  .topbar-sub-right {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }

  .topbar-utility-user-text {
    font-size: 11px;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
    background: rgba(15, 23, 42, 0.7);
    padding: 5px 12px;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    backdrop-filter: blur(8px);
    letter-spacing: 0.3px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  }

  .topbar-utility-user-text .user-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #38bdf8;
    box-shadow: 0 0 6px #38bdf8;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 100%;
    min-width: 0;
    position: relative;
    z-index: 10;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.2s ease;
  }

  .brand:hover {
    opacity: 0.95;
  }

  .brand-logo-frame {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 50px;
    width: auto;
    flex-shrink: 0;
    padding: 2px;
  }

  .brand-logo-img {
    height: 46px;
    max-height: 48px;
    width: auto;
    max-width: 70px;
    object-fit: contain;
    display: block;
    flex-shrink: 0;
    filter: drop-shadow(0 2px 8px rgba(0, 210, 255, 0.45));
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .brand:hover .brand-logo-img {
    transform: scale(1.06);
  }

  .brand-text-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
  }

  .brand-title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    line-height: 1;
    white-space: nowrap;
  }

  .brand-title-wms {
    font-size: 24px;
    font-weight: 900;
    letter-spacing: 1px;
    color: #ffffff;
    line-height: 1;
    text-shadow: 0 0 12px rgba(0, 225, 255, 0.55), 0 2px 4px rgba(0, 0, 0, 0.85);
    font-family: 'Noto Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .brand-divider {
    font-size: 20px;
    font-weight: 300;
    color: #00d2ff;
    opacity: 0.8;
    line-height: 1;
    text-shadow: 0 0 8px rgba(0, 210, 255, 0.8);
    margin: 0 1px;
  }

  .brand-title-wh {
    font-size: 17px;
    font-weight: 800;
    color: #38bdf8;
    letter-spacing: 0.5px;
    line-height: 1;
    text-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  }

  .brand-sub-row {
    display: flex;
    align-items: center;
    gap: 8px;
    line-height: 1;
    margin-top: 1px;
    white-space: nowrap;
  }

  .brand-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 700;
    color: #4ade80;
    letter-spacing: 0.6px;
    text-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
  }

  .brand-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px #22c55e;
    animation: pulseDot 2s infinite ease-in-out;
  }

  .brand-sub-tagline {
    font-size: 11px;
    font-weight: 500;
    color: #94a3b8;
    letter-spacing: 0.2px;
  }

  @media (max-width: 640px) {
    .brand-sub-tagline {
      display: none;
    }
    .brand-title-wms {
      font-size: 20px;
    }
    .brand-title-wh {
      font-size: 14px;
    }
    .brand-logo-img {
      height: 36px;
      max-height: 38px;
    }
    .topbar-main {
      height: 62px;
    }
  }

  .sidebar-toggle-btn {
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(0, 210, 255, 0.35);
    color: #38bdf8;
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(6px);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .sidebar-toggle-btn:hover {
    background: rgba(14, 165, 233, 0.25);
    color: #ffffff;
    border-color: #00e1ff;
    box-shadow: 0 0 10px rgba(0, 225, 255, 0.45);
    transform: translateY(-0.5px);
  }
  .sidebar-toggle-btn:active {
    transform: translateY(0.5px);
  }

  .theme-toggle-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(15, 23, 42, 0.7);
    color: #cbd5e1;
    font-size: 11px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    transition: all 0.2s ease;
    backdrop-filter: blur(6px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .theme-toggle-btn:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.45);
  }

  /* Center Navigation Tabs from the reference image */
  .header-nav-center {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: 1;
    margin: 0 16px;
  }

  .header-nav-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 16px;
    border-radius: 22px;
    border: 1.5px solid transparent;
    background: transparent;
    color: #d1e2f2;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    text-decoration: none;
  }

  .header-nav-pill:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(0, 164, 255, 0.35);
  }

  .header-nav-pill.active {
    background: linear-gradient(180deg, #176bb8 0%, #0d4a88 100%);
    border: 1.5px solid #00a4ff;
    color: #ffffff;
    box-shadow: 0 0 14px rgba(0, 164, 255, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.4);
    font-weight: 700;
  }

  .header-pill-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .header-nav-divider {
    width: 1px;
    height: 22px;
    background: rgba(255, 255, 255, 0.16);
    margin: 0 6px;
    flex-shrink: 0;
  }

  @media (max-width: 990px) {
    .header-nav-center {
      gap: 2px;
    }
    .header-nav-pill {
      padding: 6px 10px;
      font-size: 12px;
      gap: 6px;
    }
  }

  @media (max-width: 768px) {
    .header-nav-center {
      display: none;
    }
  }

  .lang-switcher {
    display: inline-flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 4px;
    padding: 1px;
    gap: 1px;
  }

  .lang-btn {
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
    line-height: 1.2;
  }

  .lang-btn:hover {
    color: #ffffff;
  }

  .lang-btn.active {
    background: #00a0f5;
    color: #ffffff;
    font-weight: 800;
  }

  .layout {
    display: grid;
    grid-template-columns: 248px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow: hidden;
    transition: grid-template-columns 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .layout.collapsed {
    grid-template-columns: 68px minmax(0, 1fr);
  }

  .sidebar-mobile-backdrop,
  .mobile-drawer-close-btn {
    display: none !important;
  }

  /* Hide all scrollbars on Sidebar in expanded & collapsed modes */
  .sidebar,
  .sidebar *,
  .sidebar.collapsed,
  .sidebar.collapsed * {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }

  .sidebar::-webkit-scrollbar,
  .sidebar *::-webkit-scrollbar,
  .sidebar.collapsed::-webkit-scrollbar,
  .sidebar.collapsed *::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    background: transparent !important;
  }

  /* Sleek custom scrollbars for main view and tables */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: rgba(8, 16, 28, 0.4);
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(56, 189, 248, 0.25);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(56, 189, 248, 0.6);
  }

  .sidebar {
    background: linear-gradient(180deg, #091322 0%, #0c182a 50%, #08101c 100%);
    border-right: 1px solid rgba(56, 189, 248, 0.18);
    padding: 16px 8px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 2px 0 16px rgba(0, 0, 0, 0.35);
  }

  .sidebar.collapsed {
    width: 68px;
    padding: 12px 4px;
    align-items: center;
  }

  .sidebar-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    width: 100%;
  }

  .sidebar.collapsed .sidebar-header-row {
    justify-content: center;
    margin-bottom: 8px;
    padding-bottom: 6px;
  }

  .sidebar.collapsed nav {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .nav-caption {
    color: #64748b;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    padding: 10px 8px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nav-caption::after {
    content: "";
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, rgba(56, 189, 248, 0.2), transparent);
  }

  /* Collapsible Group Header Button in Sidebar */
  .nav-caption-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    margin-top: 10px;
    margin-bottom: 5px;
    background: rgba(15, 23, 42, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: #94a3b8;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .nav-caption-btn:hover {
    background: rgba(30, 41, 59, 0.7);
    color: #f1f5f9;
    border-color: rgba(56, 189, 248, 0.4);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  .nav-caption-btn.active-group {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.55);
    background: rgba(14, 165, 233, 0.14);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.18);
  }
  .nav-arrow-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #7dd3fc;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Industrial Steel Menu Button Cards */
  .nav-card-btn {
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 11px;
    text-align: left;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    color: #e2e8f0;
    padding: 10px 12px;
    margin-bottom: 6px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  }

  /* Dark steel protective overlay */
  .nav-card-btn::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, rgba(11, 20, 36, 0.88) 0%, rgba(15, 28, 48, 0.8) 55%, rgba(11, 20, 36, 0.84) 100%);
    transition: all 0.22s ease;
    z-index: 1;
  }

  /* Metallic steel top specular sheen */
  .nav-card-btn::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.35), transparent);
    z-index: 2;
  }

  .nav-card-btn > * {
    position: relative;
    z-index: 3;
  }

  .nav-card-btn:hover {
    border-color: rgba(56, 189, 248, 0.65);
    box-shadow: 0 4px 14px rgba(14, 165, 233, 0.25), inset 0 0 10px rgba(56, 189, 248, 0.12);
    transform: translateY(-1px);
    color: #ffffff;
  }
  .nav-card-btn:hover::before {
    background: linear-gradient(105deg, rgba(11, 25, 45, 0.74) 0%, rgba(14, 38, 65, 0.64) 55%, rgba(11, 25, 45, 0.7) 100%);
  }

  .nav-card-btn.active,
  .nav-card-btn.active-parent {
    border-color: #38bdf8;
    color: #ffffff;
    font-weight: 700;
    box-shadow: 0 0 14px rgba(56, 189, 248, 0.38), inset 0 0 14px rgba(56, 189, 248, 0.16);
  }
  .nav-card-btn.active::before,
  .nav-card-btn.active-parent::before {
    background: linear-gradient(105deg, rgba(8, 30, 55, 0.82) 0%, rgba(12, 45, 80, 0.72) 55%, rgba(8, 30, 55, 0.78) 100%);
  }

  /* Glowing cyan active indicator strip on left */
  .nav-card-btn.active::after,
  .nav-card-btn.active-parent::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3.5px;
    height: 100%;
    background: #38bdf8;
    box-shadow: 0 0 10px #38bdf8;
    z-index: 4;
  }

  .nav-card-btn .nav-icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.25);
    display: grid;
    place-items: center;
    color: #93c5fd;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }
  .nav-card-btn:hover .nav-icon {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.6);
    background: rgba(14, 165, 233, 0.18);
    transform: scale(1.05);
  }
  .nav-card-btn.active .nav-icon,
  .nav-card-btn.active-parent .nav-icon {
    color: #38bdf8;
    border-color: #38bdf8;
    background: rgba(14, 165, 233, 0.3);
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.45);
  }

  /* Collapsed sidebar styling for cards and icons */
  .sidebar-divider {
    width: 100%;
    height: 1px;
    background: rgba(56, 189, 248, 0.16);
    margin: 8px 0;
  }

  .sidebar.collapsed .sidebar-divider {
    width: 32px;
    margin: 8px auto;
  }

  .sidebar-collapsed-icons {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    gap: 4px;
  }

  .sidebar-expanded-menu {
    width: 100%;
  }

  .sidebar.collapsed .nav-card-btn {
    width: 48px;
    height: 44px;
    padding: 0;
    justify-content: center;
    align-items: center;
    margin: 0 auto;
    border-radius: 8px;
    position: relative;
  }

  .sidebar.collapsed .nav-card-btn .nav-icon {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    margin: 0;
  }

  .sidebar.collapsed .nav-card-btn span:not(.nav-icon):not(.nav-icon *) {
    display: none !important;
  }

  .sidebar.collapsed .nav-arrow-icon {
    display: none !important;
  }

  /* Submenu */
  .nav-submenu {
    display: flex;
    flex-direction: column;
    padding-left: 8px;
    margin-left: 14px;
    border-left: 2px solid rgba(56, 189, 248, 0.3);
    margin-bottom: 8px;
    margin-top: 3px;
    gap: 3px;
  }

  .nav-sub-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    text-align: left;
    border: 1px solid transparent;
    background: rgba(15, 23, 42, 0.45);
    color: #94a3b8;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    transition: all 0.2s ease;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav-sub-btn span:last-child {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .nav-sub-btn:hover {
    background: rgba(30, 41, 59, 0.7);
    color: #f1f5f9;
    border-color: rgba(56, 189, 248, 0.35);
  }
  .nav-sub-btn.active {
    background: rgba(14, 165, 233, 0.18);
    color: #38bdf8;
    font-weight: 700;
    border-color: rgba(56, 189, 248, 0.55);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.22);
  }

  .sidebar.collapsed .nav-sub-btn {
    width: 40px;
    height: 40px;
    padding: 0;
    justify-content: center;
    align-items: center;
    margin: 0 auto 3px auto;
    border-radius: 6px;
  }

  .nav-icon {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .sidebar-footer {
    margin-top: 28px;
    border-top: 1px solid var(--border);
    padding: 16px 12px;
    color: #71818c;
    font-size: 10px;
    line-height: 1.8;
  }

  .main {
    min-width: 0;
    padding: 16px 24px;
    max-width: 1800px;
    width: 100%;
    margin: 0 auto;
    height: 100%;
    overflow-y: auto;
  }

  @media (max-width: 768px) {
    .main {
      padding: 12px 12px 76px 12px !important;
    }
  }

  .breadcrumbs {
    font-size: 11px;
    color: #72828e;
    margin-bottom: 8px;
  }

  .page-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .page-heading h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    color: #263b4a;
  }

  .page-subtitle {
    color: #71818c;
    margin-top: 4px;
    font-size: 12px;
  }

  .heading-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  @media (max-width: 640px) {
    .print-export-btn {
      display: none !important;
    }
  }

  .button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--blue);
    color: #fff;
    background: var(--blue);
    padding: 8px 14px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 700;
    transition: background 0.15s ease;
  }

  .button:hover {
    background: var(--blue-dark);
  }

  .button.secondary {
    background: #fff;
    color: var(--blue-dark);
    border-color: #b9c9d2;
  }

  .button.secondary:hover {
    background: #edf7fb;
    border-color: var(--blue);
  }

  .button.danger {
    background: #fff;
    color: #b91c1c;
    border-color: #fca5a5;
  }

  .button.danger:hover {
    background: #fee2e2;
    border-color: #ef4444;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .kpi {
    background: #fff;
    border: 1px solid var(--border);
    border-top: 3px solid var(--blue);
    padding: 12px 14px;
    border-radius: 2px;
    min-width: 0;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
  }

  .kpi-label {
    font-size: 11px;
    color: #617582;
    font-weight: 600;
  }

  .kpi-value {
    font-size: 24px;
    line-height: 1.2;
    font-weight: 800;
    margin-top: 4px;
    color: #203544;
  }

  .kpi-note {
    font-size: 10px;
    color: #7c8a95;
    margin-top: 4px;
  }

  .panel {
    background: #fff;
    border: 1px solid var(--border);
    margin-bottom: 14px;
    border-radius: 3px;
    min-width: 0;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
  }

  .panel-header {
    min-height: 42px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    background: #fafbfc;
  }

  .panel-title {
    font-size: 14px;
    font-weight: 700;
    color: #2b4050;
  }

  .panel-subtitle {
    color: #788894;
    font-size: 11px;
    margin-top: 3px;
  }

  .filterbar {
    display: flex;
    gap: 9px;
    align-items: center;
    padding: 12px 18px;
    flex-wrap: wrap;
    background: #fff;
    border-bottom: 1px solid #e8edf0;
  }

  .field {
    background: #fff;
    border: 1px solid #bccbd4;
    color: #314654;
    border-radius: 4px;
    padding: 7px 11px;
    font-size: 12px;
    min-height: 35px;
    transition: border-color 0.15s ease;
  }

  .field:focus {
    border-color: var(--blue);
  }

  .search-field {
    flex: 1;
    min-width: 220px;
  }

  .table-wrap {
    width: 100%;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    white-space: nowrap;
  }

  thead th {
    text-align: left;
    color: #455d6c;
    background: #f2f5f7;
    border-bottom: 1px solid #d6e0e5;
    font-weight: 700;
    padding: 11px 15px;
  }

  tbody td {
    padding: 12px 15px;
    border-bottom: 1px solid #e7ecef;
    color: #3c505e;
  }

  tbody tr:hover {
    background: #f0f8fb;
    cursor: pointer;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .sort-button {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
    text-align: left;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .code {
    color: #0076a8;
    font-weight: 700;
    font-family: 'Noto Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-variant-numeric: tabular-nums;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
  }

  .status::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .status.Available,
  .status.Completed,
  .status.Present {
    color: #15803d;
    background: #dcfce7;
  }

  .status.Pending,
  .status.Overtime,
  .status.Check-Stock {
    color: #a16207;
    background: #fef9c3;
  }

  .status.Attention,
  .status.Maintenance,
  .status.Out-of-Stock {
    color: #b91c1c;
    background: #fee2e2;
  }

  .status.On-Leave {
    color: #4338ca;
    background: #e0e7ff;
  }

  .empty {
    padding: 35px 15px;
    text-align: center;
    color: #71818c;
    font-size: 12px;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.95fr);
    gap: 18px;
    margin-bottom: 20px;
  }

  /* Overview Categories & Section Cards */
  .overview-category-header {
    margin-bottom: 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e2e8f0;
  }

  .overview-category-title {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.3px;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .overview-category-desc {
    font-size: 11px;
    color: #64748b;
    margin-top: 3px;
  }

  .overview-3col-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }

  .overview-2col-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }

  .overview-card {
    background: #ffffff;
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  }

  .overview-card:hover {
    border-color: #94a3b8;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  }

  .overview-card-header {
    padding: 11px 15px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .overview-card-title {
    font-size: 12.5px;
    font-weight: 700;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .overview-card-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.3px;
    background: #e2e8f0;
    color: #334155;
    white-space: nowrap;
  }

  .overview-card-body {
    padding: 13px 15px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .overview-metrics-row {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    background: #f1f5f9;
    padding: 9px 12px;
    border-radius: 4px;
    border: 1px solid #e2e8f0;
  }

  .overview-metric-item {
    display: flex;
    flex-direction: column;
  }

  .overview-metric-label {
    font-size: 10px;
    color: #64748b;
    font-weight: 600;
  }

  .overview-metric-val {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.25;
    margin-top: 2px;
  }

  .overview-progress-block {
    background: #fafbfc;
    padding: 9px 12px;
    border-radius: 4px;
    border: 1px solid #edf2f7;
  }

  .overview-progress-header {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    color: #334155;
    margin-bottom: 6px;
  }

  .overview-progress-sub {
    font-size: 10px;
    color: #64748b;
    margin-top: 5px;
    display: flex;
    justify-content: space-between;
  }

  .overview-section-label {
    font-size: 11px;
    font-weight: 700;
    color: #334155;
    margin-bottom: 6px;
  }

  .overview-row-label {
    color: #475569;
  }

  .overview-prestart-box {
    background: #f0fdf4;
    border: 1px solid #dcfce7;
    color: #15803d;
  }

  .overview-shift-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    color: #334155;
  }

  .overview-vehicle-name {
    font-weight: 600;
    color: #1e293b;
  }

  .overview-vehicle-desc {
    font-weight: 400;
    color: #64748b;
  }

  .overview-chip-badge {
    font-weight: 700;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .overview-chip-badge.avail {
    color: #15803d;
    background: rgba(22, 163, 74, 0.1);
  }

  .overview-chip-badge.maint {
    color: #dc2626;
    background: rgba(220, 38, 38, 0.1);
  }

  .overview-chip-badge.inuse {
    color: #1d4ed8;
    background: rgba(37, 99, 235, 0.1);
  }

  .overview-alert-box {
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .overview-alert-box.out-of-stock {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
  }

  .overview-alert-box.in-stock {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #166534;
  }

  .overview-status-chips-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .overview-vehicle-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    font-size: 11px;
  }

  .overview-card-footer {
    padding: 9px 15px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
  }

  .overview-jump-btn {
    font-size: 11px;
    font-weight: 600;
    color: #0284c7;
    background: transparent;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
  }

  .overview-jump-btn:hover {
    color: #0369a1;
    text-decoration: underline;
  }

  .module-row {
    display: grid;
    grid-template-columns: minmax(130px, 1fr) 2fr 50px;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    border-bottom: 1px solid #edf0f2;
    font-size: 12px;
  }

  .module-row:last-child {
    border-bottom: 0;
  }

  .progress {
    height: 8px;
    background: #e8eef1;
    border-radius: 4px;
    overflow: hidden;
  }

  .progress > div {
    height: 100%;
    background: #1687b5;
    border-radius: 4px;
  }

  .module-percent {
    text-align: right;
    font-weight: 700;
    color: #203746;
  }

  .transaction-item {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 13px 18px;
    border-bottom: 1px solid #edf0f2;
    font-size: 12px;
  }

  .transaction-item:last-child {
    border-bottom: 0;
  }

  .transaction-time {
    color: #71818c;
    font-weight: 600;
    font-size: 11px;
  }

  .transaction-name {
    font-weight: 600;
    color: #354b59;
  }

  .transaction-ref {
    color: #7d8d97;
    font-size: 11px;
    margin-top: 3px;
  }

  .notice {
    padding: 12px 16px;
    border: 1px solid #c9dfe9;
    background: #edf7fb;
    color: #2d5568;
    font-size: 12px;
    line-height: 1.6;
    margin-bottom: 20px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .footer {
    text-align: center;
    color: #82909a;
    font-size: 11px;
    padding: 20px;
    margin-top: auto;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(20 37 49 / 50%);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    padding: 16px;
    z-index: 50;
  }

  .modal {
    width: min(520px, 100%);
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .modal-container {
    background: #fff;
    border-radius: 12px;
    width: 100%;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }

  .modal-header-box {
    padding: 18px 24px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f8fafc;
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
  }

  .modal-footer-box {
    padding: 14px 24px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    background: #f8fafc;
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
  }

  .modal-title-text {
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
  }

  .modal-sub-text {
    font-size: 12px;
    color: #647786;
  }

  .modal-label-text {
    color: #647786;
    font-weight: 600;
  }

  .modal-val-text {
    color: #0f172a;
    font-weight: 700;
  }

  .modal-notes-box {
    background: #f8fafc;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
  }

  .modal-close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: #647786;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .modal-close-btn:hover {
    color: #0f172a;
  }

  .modal-body {
    padding: 20px;
    display: grid;
    gap: 14px;
    max-height: 75vh;
    overflow-y: auto;
  }

  .form-field {
    display: grid;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #485f6f;
  }

  .form-field input,
  .form-field select {
    width: 100%;
  }

  .modal-actions {
    padding: 14px 20px;
    border-top: 1px solid var(--border);
    background: #fafbfc;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .modal-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
    padding: 10px 14px;
    border-radius: 4px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1e293b;
    color: #fff;
    padding: 12px 18px;
    border-radius: 6px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 60;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 1050px) {
    .layout {
      grid-template-columns: 210px minmax(0, 1fr);
    }

    .main {
      padding: 18px 20px;
    }

    .kpi-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .overview-grid {
      grid-template-columns: 1fr;
    }

    .overview-3col-grid {
      grid-template-columns: 1fr;
    }

    .overview-2col-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .shell {
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .topbar-main {
      height: 48px;
      padding: 0 12px;
    }

    .topbar-sub {
      height: 36px;
      padding: 0 10px;
      justify-content: flex-end;
    }

    .topbar-sub-left {
      display: none;
    }

    .topbar-sub-right {
      gap: 6px;
      width: 100%;
      justify-content: flex-end;
    }

    .topbar-utility-user-text {
      font-size: 10px;
      padding: 3px 8px;
    }

    .layout {
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: calc(100vh - 50px);
      height: calc(100dvh - 50px);
      overflow: hidden;
    }

    .sidebar-mobile-backdrop {
      display: block !important;
      position: fixed !important;
      inset: 0 !important;
      background: rgba(0, 0, 0, 0.65) !important;
      backdrop-filter: blur(2px) !important;
      z-index: 95 !important;
      animation: fadeInBackdrop 0.2s ease;
    }

    @keyframes fadeInBackdrop {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .sidebar.collapsed {
      display: none !important;
      transform: translateX(-100%) !important;
      pointer-events: none !important;
    }

    .sidebar:not(.collapsed) {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 290px !important;
      max-width: 85vw !important;
      height: 100vh !important;
      height: 100dvh !important;
      padding: 16px 12px !important;
      border-right: 1px solid rgba(56, 189, 248, 0.3) !important;
      border-bottom: 0 !important;
      background: #091322 !important;
      flex-shrink: 0 !important;
      max-height: none !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      box-shadow: 10px 0 36px rgba(0, 0, 0, 0.75) !important;
      z-index: 100 !important;
      display: flex !important;
      flex-direction: column !important;
      transform: translateX(0) !important;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }

    .sidebar-header-row {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 0 4px 10px 4px !important;
      margin-bottom: 12px !important;
      border-bottom: 1px solid rgba(56, 189, 248, 0.2) !important;
    }

    .sidebar-header-title {
      font-size: 13px !important;
      font-weight: 700 !important;
      color: #38bdf8 !important;
      letter-spacing: 0.5px !important;
      margin: 0 !important;
    }

    .mobile-drawer-close-btn {
      display: grid !important;
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
      color: #cbd5e1 !important;
      width: 32px !important;
      height: 32px !important;
      border-radius: 6px !important;
      place-items: center !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
    }

    .mobile-drawer-close-btn:hover {
      background: rgba(239, 68, 68, 0.2) !important;
      border-color: #ef4444 !important;
      color: #ef4444 !important;
    }

    .nav-caption {
      display: block !important;
      color: #38bdf8 !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      margin: 0 !important;
    }

    .sidebar-footer {
      display: none;
    }

    .nav-submenu {
      display: flex !important;
      flex-direction: column !important;
      padding-left: 8px !important;
      margin-left: 10px !important;
      border-left: 2px solid rgba(56, 189, 248, 0.3) !important;
      margin-bottom: 8px !important;
      gap: 3px !important;
    }

    .nav-sub-btn {
      width: 100% !important;
      margin: 0 !important;
      padding: 8px 10px !important;
      border-left: 1px solid transparent !important;
      border-bottom: 1px solid transparent !important;
      border-radius: 6px !important;
      font-size: 11.5px !important;
    }

    .nav-sub-btn.active {
      border-left: 1px solid rgba(56, 189, 248, 0.55) !important;
      border-bottom: 1px solid transparent !important;
    }

    .main {
      flex: 1;
      min-height: 0;
      width: 100%;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 10px 8px;
      -webkit-overflow-scrolling: touch;
    }

    .page-heading {
      flex-direction: column;
      gap: 12px;
    }

    .page-heading h1 {
      font-size: 18px;
    }

    .page-subtitle,
    .panel-subtitle,
    .kpi-note {
      display: none !important;
    }

    .kpi-grid {
      gap: 8px !important;
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    .kpi {
      padding: 8px 10px !important;
    }

    .kpi-label {
      font-size: 10px !important;
    }

    .kpi-value {
      font-size: 18px !important;
      margin-top: 2px !important;
    }

    .overview-3col-grid,
    .overview-2col-grid {
      grid-template-columns: 1fr !important;
      gap: 10px !important;
      margin-bottom: 14px !important;
    }

    .overview-card-header {
      padding: 8px 10px !important;
    }

    .overview-card-title {
      font-size: 11.5px !important;
    }

    .overview-card-badge {
      font-size: 9px !important;
      padding: 1px 5px !important;
    }

    .overview-card-body {
      padding: 8px 10px !important;
      gap: 8px !important;
    }

    .overview-metrics-row {
      padding: 6px 8px !important;
      gap: 6px !important;
    }

    .overview-metric-label {
      font-size: 9.5px !important;
    }

    .overview-metric-val {
      font-size: 14px !important;
    }

    .overview-progress-block {
      padding: 6px 8px !important;
    }

    .overview-progress-header,
    .overview-progress-sub {
      font-size: 9.5px !important;
    }

    .overview-status-chips-list {
      gap: 4px !important;
    }

    .overview-vehicle-chip,
    .overview-status-row,
    .overview-alert-box {
      padding: 5px 8px !important;
      font-size: 10px !important;
    }

    .overview-card-footer {
      padding: 6px 10px !important;
    }
  }

  /* Media Queries for Slit Mode Switcher Bar: Hide on small screens (< 640px), show on desktop (>= 640px) */
  @media (max-width: 639px) {
    .slit-top-action-bar {
      display: none !important;
    }
  }

  @media (min-width: 640px) {
    .slit-top-action-bar {
      display: flex !important;
    }
  }

    .panel-header {
      padding: 10px 12px !important;
    }

    .filterbar {
      padding: 10px 12px !important;
    }

    .search-field {
      min-width: 100%;
    }

    table {
      font-size: 11px;
    }

    thead th, tbody td {
      padding: 8px 10px !important;
    }

    .modal {
      width: 95% !important;
      max-height: 92vh !important;
      margin: 0 auto;
    }
  }

  /* Theme Switcher Button */
  .theme-toggle-btn {
    background: rgba(3, 10, 24, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: #ffffff;
    padding: 5px 12px;
    border-radius: 20px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    line-height: 1.2;
    letter-spacing: 0.3px;
    backdrop-filter: blur(8px);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
  }
  .theme-toggle-btn:hover {
    background: rgba(0, 160, 245, 0.35);
    border-color: #38bdf8;
    color: #ffffff;
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.45);
  }
  .sun-icon {
    color: #facc15;
  }
  .moon-icon {
    color: #38bdf8;
  }

  /* =========================================================
     DARK MODE (Industrial Deep Blue / Charcoal #0b1329 & #111e38)
     ========================================================= */
  .shell.theme-dark {
    background-color: #0b1329;
    color: #f1f5f9;
  }
  .shell.theme-dark .main {
    background-color: #0b1329;
  }
  .shell.theme-dark .breadcrumbs {
    color: #94a3b8;
  }
  .shell.theme-dark .page-heading h1 {
    color: #f8fafc;
  }
  .shell.theme-dark .page-subtitle {
    color: #94a3b8;
  }
  .shell.theme-dark .kpi {
    background: #111e38;
    border-color: #1e3a5f;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  .shell.theme-dark .kpi-label {
    color: #94a3b8;
  }
  .shell.theme-dark .kpi-value {
    color: #ffffff;
  }
  .shell.theme-dark .kpi-note {
    color: #64748b;
  }
  .shell.theme-dark .panel {
    background: #111e38;
    border-color: #1e3a5f;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  .shell.theme-dark .panel-header {
    background: #0d1b33;
    border-bottom-color: #1e3a5f;
  }
  .shell.theme-dark .panel-title {
    color: #f8fafc;
  }
  .shell.theme-dark .panel-subtitle {
    color: #94a3b8;
  }
  .shell.theme-dark .filterbar {
    background: #111e38;
    border-bottom-color: #1e3a5f;
  }
  .shell.theme-dark .field {
    background: #0d1b33;
    border-color: #1e3a5f;
    color: #f1f5f9;
  }
  .shell.theme-dark .field:focus {
    border-color: #38bdf8;
    outline: 2px solid rgba(56, 189, 248, 0.3);
  }
  .shell.theme-dark thead th {
    background: #0c1930;
    border-bottom-color: #1e3a5f;
    color: #93c5fd;
  }
  .shell.theme-dark tbody td {
    color: #e2e8f0;
    border-bottom-color: #172b4d;
  }
  .shell.theme-dark tbody tr:hover {
    background: #152646;
  }
  .shell.theme-dark .code {
    color: #38bdf8;
  }
  .shell.theme-dark .button.secondary {
    background: #0d1b33;
    color: #38bdf8;
    border-color: #1e3a5f;
  }
  .shell.theme-dark .button.secondary:hover {
    background: #152b4f;
    border-color: #38bdf8;
  }
  .shell.theme-dark .transaction-item,
  .shell.theme-dark .module-row {
    border-bottom-color: #172b4d;
  }
  .shell.theme-dark .transaction-time,
  .shell.theme-dark .transaction-ref {
    color: #94a3b8;
  }
  .shell.theme-dark .transaction-name {
    color: #f1f5f9;
  }
  .shell.theme-dark .module-percent {
    color: #f8fafc;
  }
  .shell.theme-dark .progress {
    background: #1e293b;
  }
  .shell.theme-dark .notice {
    background: #0c1e38;
    border-color: #0284c7;
    color: #7dd3fc;
  }
  .shell.theme-dark .footer {
    color: #64748b;
  }
  .shell.theme-dark .modal {
    background: #111e38;
    border-color: #1e3a5f;
    color: #f8fafc;
  }
  .shell.theme-dark .modal-actions {
    background: #0d1b33;
    border-top-color: #1e3a5f;
  }
  .shell.theme-dark .form-field {
    color: #94a3b8;
  }

  /* Dark mode: 5 Overview Cards */
  .shell.theme-dark .overview-category-header {
    border-bottom-color: #1e3a5f;
  }
  .shell.theme-dark .overview-category-title {
    color: #f8fafc;
  }
  .shell.theme-dark .overview-category-desc {
    color: #94a3b8;
  }
  .shell.theme-dark .overview-card {
    background: #111e38;
    border-color: #1e3a5f;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  .shell.theme-dark .overview-card:hover {
    border-color: #38bdf8;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  }
  .shell.theme-dark .overview-card-header {
    background: #0d1b33;
    border-bottom-color: #1e3a5f;
  }
  .shell.theme-dark .overview-card-title {
    color: #f8fafc;
  }
  .shell.theme-dark .overview-metrics-row {
    background: #0c1830 !important;
    border-color: #1e3a5f !important;
  }
  .shell.theme-dark .overview-metric-label {
    color: #94a3b8 !important;
  }
  .shell.theme-dark .overview-metric-val {
    color: #f8fafc !important;
  }
  .shell.theme-dark .overview-progress-block {
    background: #0c1830 !important;
    border-color: #1e3a5f !important;
  }
  .shell.theme-dark .overview-progress-header {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .overview-progress-sub {
    color: #94a3b8 !important;
  }
  .shell.theme-dark .overview-section-label {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .overview-row-label {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .overview-status-row {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .overview-prestart-box {
    background: rgba(16, 185, 129, 0.15) !important;
    border-color: rgba(16, 185, 129, 0.35) !important;
    color: #f1f5f9 !important;
  }
  .shell.theme-dark .overview-prestart-box span,
  .shell.theme-dark .overview-prestart-box strong {
    color: #f1f5f9 !important;
  }
  .shell.theme-dark .overview-prestart-box svg {
    color: #34d399 !important;
  }
  .shell.theme-dark .overview-shift-box {
    background: #0c1830 !important;
    border-color: #1e3a5f !important;
    color: #f1f5f9 !important;
  }
  .shell.theme-dark .overview-shift-box span {
    color: #38bdf8 !important;
  }
  .shell.theme-dark .overview-vehicle-chip {
    background: #0c1830 !important;
    border-color: #1e3a5f !important;
  }
  .shell.theme-dark .overview-vehicle-name {
    color: #ffffff !important;
  }
  .shell.theme-dark .overview-vehicle-desc {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .overview-chip-badge.avail {
    color: #4ade80 !important;
    background: rgba(34, 197, 94, 0.22) !important;
  }
  .shell.theme-dark .overview-chip-badge.maint {
    color: #f87171 !important;
    background: rgba(239, 68, 68, 0.22) !important;
  }
  .shell.theme-dark .overview-chip-badge.inuse {
    color: #60a5fa !important;
    background: rgba(59, 130, 246, 0.22) !important;
  }
  .shell.theme-dark .overview-alert-box.out-of-stock {
    background: rgba(239, 68, 68, 0.15) !important;
    border-color: rgba(239, 68, 68, 0.35) !important;
    color: #fca5a5 !important;
  }
  .shell.theme-dark .overview-alert-box.in-stock {
    background: rgba(34, 197, 94, 0.15) !important;
    border-color: rgba(34, 197, 94, 0.35) !important;
    color: #86efac !important;
  }
  .shell.theme-dark .overview-card-footer {
    background: #0d1b33;
    border-top-color: #1e3a5f;
  }
  .shell.theme-dark .overview-jump-btn {
    color: #38bdf8;
  }
  .shell.theme-dark .overview-jump-btn:hover {
    color: #7dd3fc;
  }

  /* Status Badges in Dark Mode */
  .shell.theme-dark .status.Available,
  .shell.theme-dark .status.Completed,
  .shell.theme-dark .status.Present {
    color: #4ade80;
    background: rgba(34, 197, 94, 0.18);
  }
  .shell.theme-dark .status.Pending,
  .shell.theme-dark .status.Overtime,
  .shell.theme-dark .status.Check-Stock {
    color: #facc15;
    background: rgba(234, 179, 8, 0.18);
  }
  .shell.theme-dark .status.Attention,
  .shell.theme-dark .status.Maintenance,
  .shell.theme-dark .status.Out-of-Stock {
    color: #f87171;
    background: rgba(239, 68, 68, 0.18);
  }
  .shell.theme-dark .status.On-Leave {
    color: #818cf8;
    background: rgba(99, 102, 241, 0.18);
  }

  /* Dark mode overrides for submodules with inline whites */
  .shell.theme-dark .vehicle-management-module > div,
  .shell.theme-dark .panel > div[style*="background: #fff"],
  .shell.theme-dark .panel > div[style*="background:#fff"],
  .shell.theme-dark .main div[style*="background: #fff"],
  .shell.theme-dark .main div[style*="background:#fff"],
  .shell.theme-dark .main div[style*="background: rgb(255, 255, 255)"],
  .shell.theme-dark .main div[style*="background: #ffffff"],
  .shell.theme-dark .main div[style*="backgroundColor: #ffffff"],
  .shell.theme-dark .main div[style*="backgroundColor: #fff"] {
    background-color: #111e38 !important;
    border-color: #1e3a5f !important;
    color: #f1f5f9 !important;
  }
  /* Filterbar & Form Controls in Dark Mode */
  .shell.theme-dark .filterbar,
  .shell.theme-dark .transport-filterbar,
  .shell.theme-dark .fixflush-filterbar,
  .shell.theme-dark .fixflush-topbar {
    background: #0d1b33 !important;
    background-color: #0d1b33 !important;
    border-color: #1e3a5f !important;
  }

  .shell.theme-dark input[type="text"],
  .shell.theme-dark input[type="search"],
  .shell.theme-dark select,
  .shell.theme-dark .transport-input,
  .shell.theme-dark .transport-select,
  .shell.theme-dark .field {
    background-color: #0c1930 !important;
    border: 1px solid #1e3a5f !important;
    color: #f8fafc !important;
  }

  .shell.theme-dark input::placeholder,
  .shell.theme-dark select::placeholder,
  .shell.theme-dark .transport-input::placeholder,
  .shell.theme-dark .field::placeholder {
    color: #94a3b8 !important;
  }

  .shell.theme-dark input:focus,
  .shell.theme-dark select:focus,
  .shell.theme-dark .transport-input:focus,
  .shell.theme-dark .transport-select:focus,
  .shell.theme-dark .field:focus {
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25) !important;
    outline: none !important;
  }

  /* Modals & Transfer Manifest in Dark Mode */
  .shell.theme-dark .modal-backdrop {
    background: rgba(11, 19, 41, 0.75) !important;
  }

  .shell.theme-dark .modal,
  .shell.theme-dark .modal-container,
  .shell.theme-dark .transfer-modal-card {
    background-color: #111e38 !important;
    border: 1px solid #1e3a5f !important;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5) !important;
    color: #f8fafc !important;
  }

  .shell.theme-dark .modal-header-box,
  .shell.theme-dark .panel-header {
    background-color: #0d1b33 !important;
    border-bottom-color: #1e3a5f !important;
  }

  .shell.theme-dark .modal-footer-box,
  .shell.theme-dark .modal-actions {
    background-color: #0d1b33 !important;
    border-top-color: #1e3a5f !important;
  }

  .shell.theme-dark .modal-title-text,
  .shell.theme-dark .panel-title {
    color: #ffffff !important;
  }

  .shell.theme-dark .modal-sub-text,
  .shell.theme-dark .modal-label-text,
  .shell.theme-dark .panel-subtitle {
    color: #94a3b8 !important;
  }

  .shell.theme-dark .modal-val-text {
    color: #f8fafc !important;
  }

  .shell.theme-dark .modal-notes-box {
    background-color: #0c1930 !important;
    border-color: #1e3a5f !important;
    color: #f1f5f9 !important;
  }

  .shell.theme-dark .modal-close-btn {
    color: #94a3b8 !important;
  }
  .shell.theme-dark .modal-close-btn:hover {
    color: #ffffff !important;
  }

  /* =========================================================
     LIGHT MODE (Crisp Professional Industrial Clean #f8fafc & #ffffff)
     ========================================================= */
  .shell.theme-light {
    background-color: #f1f5f9;
    color: #0f172a;
  }
  .shell.theme-light .main {
    background-color: #f8fafc;
    color: #1e293b;
  }
  .shell.theme-light .breadcrumbs {
    color: #64748b;
  }
  .shell.theme-light .page-heading h1 {
    color: #0f172a;
  }
  .shell.theme-light .page-subtitle {
    color: #64748b;
  }
  .shell.theme-light .kpi {
    background: #ffffff;
    border-color: #cbd5e1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }
  .shell.theme-light .kpi-label {
    color: #64748b;
  }
  .shell.theme-light .kpi-value {
    color: #0f172a;
  }
  .shell.theme-light .kpi-note {
    color: #94a3b8;
  }
  .shell.theme-light .panel {
    background: #ffffff;
    border-color: #e2e8f0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }
  .shell.theme-light .panel-header {
    background: #f8fafc;
    border-bottom-color: #e2e8f0;
  }
  .shell.theme-light .panel-title {
    color: #0f172a;
  }
  .shell.theme-light .panel-subtitle {
    color: #64748b;
  }
  .shell.theme-light .filterbar,
  .shell.theme-light .transport-filterbar,
  .shell.theme-light .fixflush-filterbar,
  .shell.theme-light .fixflush-topbar {
    background: #ffffff !important;
    background-color: #ffffff !important;
    border-color: #e2e8f0 !important;
  }
  .shell.theme-light input[type="text"],
  .shell.theme-light input[type="search"],
  .shell.theme-light select,
  .shell.theme-light .transport-input,
  .shell.theme-light .transport-select,
  .shell.theme-light .field {
    background-color: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    color: #0f172a !important;
  }
  .shell.theme-light input::placeholder,
  .shell.theme-light select::placeholder,
  .shell.theme-light .transport-input::placeholder,
  .shell.theme-light .field::placeholder {
    color: #94a3b8 !important;
  }
  .shell.theme-light input:focus,
  .shell.theme-light select:focus,
  .shell.theme-light .transport-input:focus,
  .shell.theme-light .transport-select:focus,
  .shell.theme-light .field:focus {
    border-color: #0284c7 !important;
    box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.2) !important;
    outline: none !important;
  }
  .shell.theme-light thead th {
    background: #f1f5f9;
    border-bottom-color: #cbd5e1;
    color: #1e3a8a;
  }
  .shell.theme-light tbody td {
    color: #334155;
    border-bottom-color: #f1f5f9;
  }
  .shell.theme-light tbody tr:hover {
    background: #f8fafc;
  }
  .shell.theme-light .code {
    color: #0284c7;
  }
  .shell.theme-light .button.secondary {
    background: #ffffff;
    color: #0284c7;
    border-color: #cbd5e1;
  }
  .shell.theme-light .button.secondary:hover {
    background: #f0f9ff;
    border-color: #0284c7;
  }
  .shell.theme-light .transaction-item,
  .shell.theme-light .module-row {
    border-bottom-color: #e2e8f0;
  }
  .shell.theme-light .transaction-time,
  .shell.theme-light .transaction-ref {
    color: #64748b;
  }
  .shell.theme-light .transaction-name {
    color: #0f172a;
  }
  .shell.theme-light .module-percent {
    color: #0f172a;
  }
  .shell.theme-light .progress {
    background: #e2e8f0;
  }
  .shell.theme-light .notice {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1d4ed8;
  }
  .shell.theme-light .footer {
    color: #64748b;
  }
  .shell.theme-light .modal-backdrop {
    background: rgba(15, 23, 42, 0.5) !important;
  }
  .shell.theme-light .modal,
  .shell.theme-light .modal-container,
  .shell.theme-light .transfer-modal-card {
    background-color: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15) !important;
    color: #0f172a !important;
  }
  .shell.theme-light .modal-header-box,
  .shell.theme-light .panel-header {
    background-color: #f8fafc !important;
    border-bottom-color: #e2e8f0 !important;
  }
  .shell.theme-light .modal-footer-box,
  .shell.theme-light .modal-actions {
    background-color: #f8fafc !important;
    border-top-color: #e2e8f0 !important;
  }
  .shell.theme-light .modal-title-text,
  .shell.theme-light .panel-title {
    color: #0f172a !important;
  }
  .shell.theme-light .modal-sub-text,
  .shell.theme-light .modal-label-text,
  .shell.theme-light .panel-subtitle {
    color: #64748b !important;
  }
  .shell.theme-light .modal-val-text {
    color: #0f172a !important;
  }
  .shell.theme-light .modal-notes-box {
    background-color: #f8fafc !important;
    border-color: #cbd5e1 !important;
    color: #1e293b !important;
  }
  .shell.theme-light .modal-close-btn {
    color: #64748b !important;
  }
  .shell.theme-light .modal-close-btn:hover {
    color: #0f172a !important;
  }
  .shell.theme-light .form-field {
    color: #475569;
  }

  /* Light mode Overview Cards */
  .shell.theme-light .overview-category-header {
    border-bottom-color: #e2e8f0;
  }
  .shell.theme-light .overview-category-title {
    color: #0f172a;
  }
  .shell.theme-light .overview-category-desc {
    color: #64748b;
  }
  .shell.theme-light .overview-card {
    background: #ffffff;
    border-color: #e2e8f0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  .shell.theme-light .overview-card:hover {
    border-color: #0284c7;
    box-shadow: 0 4px 14px rgba(2, 132, 199, 0.15);
  }
  .shell.theme-light .overview-card-header {
    background: #f8fafc;
    border-bottom-color: #e2e8f0;
  }
  .shell.theme-light .overview-card-title {
    color: #0f172a;
  }
  .shell.theme-light .overview-metrics-row {
    background: #f8fafc !important;
    border-color: #e2e8f0 !important;
  }
  .shell.theme-light .overview-metric-label {
    color: #64748b !important;
  }
  .shell.theme-light .overview-metric-val {
    color: #0f172a !important;
  }
  .shell.theme-light .overview-progress-block {
    background: #f8fafc !important;
    border-color: #e2e8f0 !important;
  }
  .shell.theme-light .overview-progress-header {
    color: #334155 !important;
  }
  .shell.theme-light .overview-progress-sub {
    color: #64748b !important;
  }
  .shell.theme-light .overview-section-label {
    color: #334155 !important;
  }
  .shell.theme-light .overview-row-label {
    color: #475569 !important;
  }
  .shell.theme-light .overview-status-row {
    color: #334155 !important;
  }
  .shell.theme-light .overview-prestart-box {
    background: #f0fdf4 !important;
    border-color: #bbf7d0 !important;
    color: #166534 !important;
  }
  .shell.theme-light .overview-prestart-box span,
  .shell.theme-light .overview-prestart-box strong {
    color: #166534 !important;
  }
  .shell.theme-light .overview-prestart-box svg {
    color: #16a34a !important;
  }
  .shell.theme-light .overview-shift-box {
    background: #f8fafc !important;
    border-color: #e2e8f0 !important;
    color: #1e293b !important;
  }
  .shell.theme-light .overview-shift-box span {
    color: #0284c7 !important;
  }
  .shell.theme-light .overview-vehicle-chip {
    background: #f8fafc !important;
    border-color: #e2e8f0 !important;
  }
  .shell.theme-light .overview-vehicle-name {
    color: #0f172a !important;
  }
  .shell.theme-light .overview-vehicle-desc {
    color: #64748b !important;
  }
  .shell.theme-light .overview-chip-badge.avail {
    color: #15803d !important;
    background: rgba(34, 197, 94, 0.15) !important;
  }
  .shell.theme-light .overview-chip-badge.maint {
    color: #b91c1c !important;
    background: rgba(239, 68, 68, 0.15) !important;
  }
  .shell.theme-light .overview-chip-badge.inuse {
    color: #1d4ed8 !important;
    background: rgba(59, 130, 246, 0.15) !important;
  }
  .shell.theme-light .overview-card-footer {
    background: #f8fafc;
    border-top-color: #e2e8f0;
  }
  .shell.theme-light .overview-jump-btn {
    color: #0284c7;
  }
  .shell.theme-light .overview-jump-btn:hover {
    color: #0369a1;
  }



  /* Status Badges - Base / Light Mode */
  .status-active {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #86efac;
  }
  .status-inactive {
    background: #fff1f2;
    color: #be123c;
    border: 1px solid #fecdd3;
  }
  .status-available {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
  }
  .status-inuse {
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }
  .status-maintenance {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }
  .status-outofservice {
    background: #fff1f2;
    color: #be123c;
    border: 1px solid #fecdd3;
  }

  .status .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .status .dot-active {
    background: #22c55e;
  }
  .status .dot-inactive {
    background: #f43f5e;
  }
  .status .dot-inuse {
    background: #0284c7;
  }

  .vehicle-status-label {
    font-size: 11px;
    font-weight: 600;
    color: #475569;
  }
  .shell.theme-dark .vehicle-status-label {
    color: #cbd5e1 !important;
  }


  /* Employee Table Dark Theme Overrides */
  .emp-row-num {
    color: #64748b;
    font-weight: 700;
  }
  .shell.theme-dark .emp-row-num {
    color: #94a3b8 !important;
  }

  .emp-name {
    font-weight: 700;
    color: #1e3648;
  }
  .shell.theme-dark .emp-name {
    color: #ffffff !important;
  }

  .emp-dept {
    color: #334155;
    font-size: 12px;
  }
  .shell.theme-dark .emp-dept {
    color: #cbd5e1 !important;
  }

  .emp-pos {
    color: #22394a;
    font-weight: 600;
    font-size: 12px;
  }
  .shell.theme-dark .emp-pos {
    color: #cbd5e1 !important;
  }

  .emp-phone {
    font-size: 12px;
    color: #334155;
    font-family: 'Noto Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .shell.theme-dark .emp-phone {
    color: #cbd5e1 !important;
  }

  .status-officer {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
  }
  .status-manager {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }
  .shell.theme-dark .status-officer {
    background: rgba(147, 51, 234, 0.18) !important;
    color: #c084fc !important;
    border: 1px solid rgba(147, 51, 234, 0.35) !important;
  }
  .shell.theme-dark .status-manager {
    background: rgba(234, 179, 8, 0.18) !important;
    color: #facc15 !important;
    border: 1px solid rgba(234, 179, 8, 0.35) !important;
  }

  /* Vehicle Management Dark Theme Overrides */
  .shell.theme-dark .status-active {
    background: rgba(34, 197, 94, 0.18) !important;
    color: #4ade80 !important;
    border: 1px solid rgba(34, 197, 94, 0.35) !important;
  }
  .shell.theme-dark .status-inactive {
    background: rgba(244, 63, 94, 0.2) !important;
    color: #fca5a5 !important;
    border: 1px solid rgba(244, 63, 94, 0.4) !important;
  }
  .shell.theme-dark .status-inactive .dot-inactive {
    background: #f43f5e !important;
    box-shadow: 0 0 6px rgba(244, 63, 94, 0.8) !important;
  }
  .shell.theme-dark .status-available {
    background: rgba(16, 185, 129, 0.18) !important;
    color: #34d399 !important;
    border: 1px solid rgba(16, 185, 129, 0.35) !important;
  }
  .shell.theme-dark .status-inuse {
    background: rgba(56, 189, 248, 0.18) !important;
    color: #38bdf8 !important;
    border: 1px solid rgba(56, 189, 248, 0.35) !important;
  }
  .shell.theme-dark .status-maintenance {
    background: rgba(245, 158, 11, 0.18) !important;
    color: #fbbf24 !important;
    border: 1px solid rgba(245, 158, 11, 0.35) !important;
  }
  .shell.theme-dark .status-outofservice {
    background: rgba(244, 63, 94, 0.2) !important;
    color: #fca5a5 !important;
    border: 1px solid rgba(244, 63, 94, 0.4) !important;
  }

  .shell.theme-dark .vehicle-modal-card {
    background-color: #111e38 !important;
    border: 1px solid #1e3a5f !important;
    color: #f8fafc !important;
  }
  .shell.theme-dark .vehicle-modal-header {
    background-color: #0d1b33 !important;
    border-bottom-color: #1e3a5f !important;
  }
  .shell.theme-dark .vehicle-info-box {
    background-color: #0c1930 !important;
    border-color: #1e3a5f !important;
    color: #f8fafc !important;
  }
  .shell.theme-dark .vehicle-info-box div,
  .shell.theme-dark .vehicle-info-box span,
  .shell.theme-dark .vehicle-info-box strong {
    color: #f8fafc !important;
  }
  .shell.theme-dark .vehicle-spec-box {
    background-color: #0c1930 !important;
    border-color: #1e3a5f !important;
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .vehicle-spec-box strong {
    color: #f8fafc !important;
  }

  /* Pre-Start Inspection Dark Theme Overrides */
  .shell.theme-dark .prestart-header-card {
    background: #111e38 !important;
    border-color: #1e3a5f !important;
    color: #f8fafc !important;
  }
  .shell.theme-dark .prestart-filterbar {
    background: #0d1b33 !important;
    border-bottom-color: #1e3a5f !important;
  }
  .shell.theme-dark .prestart-filterbar input,
  .shell.theme-dark .prestart-filterbar select,
  .shell.theme-dark .prestart-form-input,
  .shell.theme-dark .prestart-form-select {
    background-color: #0c1930 !important;
    border: 1px solid #1e3a5f !important;
    color: #f8fafc !important;
  }
  .shell.theme-dark .prestart-filterbar input::placeholder,
  .shell.theme-dark .prestart-form-input::placeholder {
    color: #94a3b8 !important;
  }
  .shell.theme-dark .prestart-filterbar input:focus,
  .shell.theme-dark .prestart-filterbar select:focus,
  .shell.theme-dark .prestart-form-input:focus,
  .shell.theme-dark .prestart-form-select:focus {
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25) !important;
  }
  .shell.theme-dark .prestart-modal-backdrop {
    background: rgba(11, 19, 41, 0.8) !important;
  }
  .shell.theme-dark .prestart-modal-card {
    background-color: #111e38 !important;
    border: 1px solid #1e3a5f !important;
    color: #f8fafc !important;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5) !important;
  }
  .shell.theme-dark .prestart-modal-header {
    background-color: #0d1b33 !important;
    border-bottom-color: #1e3a5f !important;
  }
  .shell.theme-dark .prestart-modal-title {
    color: #ffffff !important;
  }
  .shell.theme-dark .prestart-modal-sub {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .prestart-modal-label {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .prestart-modal-val {
    color: #f8fafc !important;
  }
  .shell.theme-dark .prestart-modal-footer {
    background-color: #0d1b33 !important;
    border-top-color: #1e3a5f !important;
  }
  .shell.theme-dark .prestart-item-box {
    background-color: #0c1930 !important;
    border-color: #1e3a5f !important;
  }
  .shell.theme-dark .prestart-item-title {
    color: #f8fafc !important;
  }
  .shell.theme-dark .prestart-item-sub {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .prestart-item-remark {
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .prestart-table-header {
    background-color: #0c1930 !important;
    color: #93c5fd !important;
  }
  .shell.theme-dark .prestart-table-border {
    border-color: #1e3a5f !important;
  }
  .shell.theme-dark .prestart-table-row {
    border-bottom-color: #172b4d !important;
  }

  /* Fuel Management Dark Theme Overrides */
  .shell.theme-dark .fuel-filterbar {
    background: #0d1b33 !important;
    border-bottom-color: #1e3a5f !important;
  }
  .shell.theme-dark .fuel-input,
  .shell.theme-dark .fuel-select {
    background-color: #0c1930 !important;
    border: 1px solid #1e3a5f !important;
    color: #f8fafc !important;
  }
  .shell.theme-dark .fuel-input::placeholder {
    color: #94a3b8 !important;
  }
  .shell.theme-dark .fuel-input:focus,
  .shell.theme-dark .fuel-select:focus {
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25) !important;
  }
  .shell.theme-dark .fuel-modal-card {
    background-color: #111e38 !important;
    border: 1px solid #1e3a5f !important;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5) !important;
    color: #f8fafc !important;
  }
  .shell.theme-dark .fuel-modal-header {
    background-color: #0d1b33 !important;
    border-bottom-color: #1e3a5f !important;
  }
  .shell.theme-dark .fuel-modal-footer {
    background-color: #0d1b33 !important;
    border-top-color: #1e3a5f !important;
  }
  .shell.theme-dark .fuel-detail-box {
    background-color: #0c1930 !important;
    border-color: #1e3a5f !important;
    color: #f1f5f9 !important;
  }

  /* =========================================================
     GLOBAL DARK MODE TABLE CONTRAST & TEXT VISIBILITY
     ========================================================= */
  .shell.theme-dark table {
    background-color: #111e38 !important;
    color: #f1f5f9 !important;
  }
  .shell.theme-dark table thead th {
    background-color: #0c1930 !important;
    color: #93c5fd !important;
    border-bottom: 1px solid #1e3a5f !important;
    font-weight: 700 !important;
  }
  .shell.theme-dark table thead th button,
  .shell.theme-dark table thead .sort-button {
    color: #93c5fd !important;
  }
  .shell.theme-dark table tbody td {
    color: #e2e8f0 !important;
    border-bottom: 1px solid #1e3a5f !important;
  }
  .shell.theme-dark table tbody tr {
    border-bottom: 1px solid #1e3a5f !important;
  }
  .shell.theme-dark table tbody tr:hover {
    background-color: #152646 !important;
  }

  /* 1. ID / Code / Transfer ID / SKU / Vehicle ID */
  .shell.theme-dark td .code,
  .shell.theme-dark td span.code,
  .shell.theme-dark td code,
  .shell.theme-dark td .table-id,
  .shell.theme-dark td .table-code {
    color: #38bdf8 !important;
    font-weight: 700 !important;
  }

  /* 2. Item Name, Specs, Batch, Driver Name */
  .shell.theme-dark td .table-item-name,
  .shell.theme-dark td .emp-name,
  .shell.theme-dark td .emp-pos,
  .shell.theme-dark td div[style*="color: #1e3648"],
  .shell.theme-dark td div[style*="color:#1e3648"],
  .shell.theme-dark td div[style*="color: #334155"],
  .shell.theme-dark td div[style*="color:#334155"],
  .shell.theme-dark td div[style*="color: #0f172a"],
  .shell.theme-dark td div[style*="color:#0f172a"],
  .shell.theme-dark td div[style*="color: #1e293b"],
  .shell.theme-dark td div[style*="color:#1e293b"] {
    color: #f1f5f9 !important;
  }

  /* 3. Origin ➔ Destination Facilities */
  .shell.theme-dark td .origin-text,
  .shell.theme-dark td span[style*="color: #087eaf"],
  .shell.theme-dark td span[style*="color:#087eaf"],
  .shell.theme-dark td span[style*="color: rgb(8, 126, 175)"] {
    color: #38bdf8 !important;
    font-weight: 600 !important;
  }

  .shell.theme-dark td .destination-text,
  .shell.theme-dark td span[style*="color: #15803d"],
  .shell.theme-dark td span[style*="color:#15803d"],
  .shell.theme-dark td span[style*="color: rgb(21, 128, 61)"] {
    color: #34d399 !important;
    font-weight: 600 !important;
  }

  /* Assigned Driver / Vehicle Operator */
  .shell.theme-dark td div[style*="color: #0369a1"],
  .shell.theme-dark td div[style*="color:#0369a1"] {
    color: #38bdf8 !important;
    font-weight: 700 !important;
  }

  /* 4. Qty & Weight */
  .shell.theme-dark td .table-qty,
  .shell.theme-dark td .table-weight,
  .shell.theme-dark td strong {
    color: #f8fafc !important;
  }

  /* 5. Date & Timestamp & Muted Details */
  .shell.theme-dark td .table-timestamp,
  .shell.theme-dark td .table-date,
  .shell.theme-dark td .emp-row-num,
  .shell.theme-dark td div[style*="color: #647786"],
  .shell.theme-dark td div[style*="color:#647786"],
  .shell.theme-dark td div[style*="color: #8a9ba8"],
  .shell.theme-dark td div[style*="color:#8a9ba8"],
  .shell.theme-dark td span[style*="color: #647786"],
  .shell.theme-dark td span[style*="color:#647786"],
  .shell.theme-dark td span[style*="color: #8a9ba8"],
  .shell.theme-dark td span[style*="color:#8a9ba8"] {
    color: #cbd5e1 !important;
  }

  .shell.theme-dark td .table-timestamp,
  .shell.theme-dark td .table-date {
    color: #94a3b8 !important;
  }

  /* Table Summary Footer Bar */
  .shell.theme-dark .table-wrap + div,
  .shell.theme-dark table + div {
    background-color: #0d1b33 !important;
    border-top-color: #1e3a5f !important;
    color: #cbd5e1 !important;
  }
  .shell.theme-dark .table-wrap + div span,
  .shell.theme-dark table + div span {
    color: #cbd5e1 !important;
  }"

  /* =========================================================
     LIGHT MODE (Clean Crisp White / Gray #f4f7fa & #ffffff)
     ========================================================= */
  .shell.theme-light {
    background-color: #f4f7fa;
    color: #1e293b;
  }
  .shell.theme-light .main {
    background-color: #f4f7fa;
  }
  .shell.theme-light .breadcrumbs {
    color: #64748b;
  }
  .shell.theme-light .page-heading h1 {
    color: #1e293b;
  }
  .shell.theme-light .page-subtitle {
    color: #64748b;
  }
  .shell.theme-light .kpi {
    background: #ffffff;
    border-color: #d9e0e5;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .shell.theme-light .kpi-label {
    color: #617582;
  }
  .shell.theme-light .kpi-value {
    color: #0f172a;
  }
  .shell.theme-light .kpi-note {
    color: #7c8a95;
  }
  .shell.theme-light .panel {
    background: #ffffff;
    border-color: #d9e0e5;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .shell.theme-light .panel-header {
    background: #fafbfc;
    border-bottom-color: #e2e8f0;
  }
  .shell.theme-light .panel-title {
    color: #1e293b;
  }
  .shell.theme-light .panel-subtitle {
    color: #64748b;
  }
  .shell.theme-light .filterbar {
    background: #ffffff;
    border-bottom-color: #e8edf0;
  }
  .shell.theme-light .field {
    background: #ffffff;
    border-color: #bccbd4;
    color: #314654;
  }
  .shell.theme-light thead th {
    background: #f1f5f9;
    border-bottom-color: #d6e0e5;
    color: #455d6c;
  }
  .shell.theme-light tbody td {
    color: #3c505e;
    border-bottom-color: #e7ecef;
  }
  .shell.theme-light tbody tr:hover {
    background: #f0f8fb;
  }
  .shell.theme-light .code {
    color: #0076a8;
  }
  .shell.theme-light .button.secondary {
    background: #ffffff;
    color: #075985;
    border-color: #b9c9d2;
  }
  .shell.theme-light .button.secondary:hover {
    background: #edf7fb;
    border-color: #087eaf;
  }
  .shell.theme-light .overview-card {
    background: #ffffff;
    border-color: #e2e8f0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .shell.theme-light .overview-card-header {
    background: #f8fafc;
    border-bottom-color: #e2e8f0;
  }
  .shell.theme-light .overview-card-title {
    color: #0f172a;
  }
  .shell.theme-light .overview-metrics-row {
    background: #f1f5f9;
    border-color: #e2e8f0;
  }
  .shell.theme-light .overview-metric-val {
    color: #0f172a;
  }
  .shell.theme-light .overview-metric-label {
    color: #64748b;
  }
  .shell.theme-light .overview-progress-block {
    background: #fafbfc;
    border-color: #edf2f7;
  }
  .shell.theme-light .overview-progress-header {
    color: #334155;
  }
  .shell.theme-light .overview-progress-sub {
    color: #64748b;
  }
  .shell.theme-light .overview-vehicle-chip {
    background: #f8fafc;
    border-color: #e2e8f0;
  }
  .shell.theme-light .overview-card-footer {
    background: #f8fafc;
    border-top-color: #e2e8f0;
  }

  @media print {
    .topbar, .sidebar, .heading-actions, .filterbar, .notice, .footer, .button {
      display: none !important;
    }
    .layout {
      display: block !important;
    }
    .main {
      padding: 0 !important;
      max-width: 100% !important;
    }
    .panel {
      box-shadow: none !important;
      border: 1px solid #000 !important;
      break-inside: avoid;
    }
  }
`;

function StatusBadge({ value }: { value: string }) {
  const { language } = useLanguage();
  const className = value.replaceAll(" ", "-");
  const displayLabel = STATUS_LABELS[value]?.[language] || value;
  return <span className={`status ${className}`}>{displayLabel}</span>;
}

function KpiCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

function PanelHeaderComponent({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        <div className="panel-title">{title}</div>
        {subtitle && <div className="panel-subtitle">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function DataTable({
  columns,
  rows,
  onSelect,
}: {
  columns: ColumnConfig[];
  rows: RecordItem[];
  onSelect?: (item: RecordItem) => void;
}) {
  const { t } = useLanguage();
  const [sort, setSort] = useState<{
    key: keyof RecordItem;
    direction: "asc" | "desc";
  }>({
    key: "code",
    direction: "asc",
  });

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];

      const comparison =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""));

      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [rows, sort]);

  return (
    <>
      {/* Desktop Table View */}
      <div className="table-wrap hidden sm:block">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={String(column.key)}>
                  <button
                    className="sort-button"
                    onClick={() =>
                      setSort((current) => ({
                        key: column.key,
                        direction:
                          current.key === column.key && current.direction === "asc"
                            ? "desc"
                            : "asc",
                      }))
                    }
                  >
                    {column.label}
                    {sort.key === column.key ? (
                      sort.direction === "asc" ? " ↑" : " ↓"
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onSelect?.(row)}
                title="Click to view details"
              >
                {columns.map((column) => (
                  <td key={String(column.key)}>
                    {column.key === "code" ? (
                      <span className="code">{row[column.key]}</span>
                    ) : column.key === "status" ? (
                      <StatusBadge value={String(row[column.key])} />
                    ) : column.key === "qty" ? (
                      Number(row[column.key]).toLocaleString("en-US", {
                        maximumFractionDigits: 2,
                      })
                    ) : (
                      String(row[column.key] ?? "-")
                    )}
                  </td>
                ))}
              </tr>
            ))}

            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
                  <div className="empty">
                    {t("noMatchingRecords")}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List View (< 640px) */}
      <div className="block sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
        {sortedRows.map((row) => (
          <div
            key={row.id}
            onClick={() => onSelect?.(row)}
            className="p-3 hover:bg-slate-50 dark:hover:bg-[#142340] cursor-pointer transition-colors space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="code text-xs font-mono font-bold text-sky-600 dark:text-sky-400">{row.code}</span>
              <StatusBadge value={String(row.status)} />
            </div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">
              {row.name}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono pt-0.5">
              <span>📍 {row.location || "-"}</span>
              <span className="font-bold text-slate-900 dark:text-slate-100">
                {Number(row.qty || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} {row.unit || ""}
              </span>
            </div>
          </div>
        ))}
        {sortedRows.length === 0 && (
          <div className="empty p-4 text-center text-xs text-slate-400">
            {t("noMatchingRecords")}
          </div>
        )}
      </div>
    </>
  );
}

function TransactionsList({ items }: { items: TransactionItem[] }) {
  const { t } = useLanguage();
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((item, idx) => (
        <div className="transaction-item p-3 sm:p-3.5 flex flex-col sm:grid sm:grid-cols-[52px_1fr_auto] gap-2 sm:gap-3 items-start sm:items-center" key={item.reference + idx}>
          <div className="flex items-center justify-between w-full sm:w-auto">
            <span className="transaction-time text-xs font-mono text-slate-500 font-bold">{item.time}</span>
            <div className="sm:hidden">
              <StatusBadge value={item.status} />
            </div>
          </div>

          <div className="w-full min-w-0">
            <div className="transaction-name text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.activity}</div>
            <div className="transaction-ref text-[11px] text-slate-500 font-mono mt-0.5">
              {item.reference} · {item.module}
            </div>
          </div>

          <div className="hidden sm:block">
            <StatusBadge value={item.status} />
          </div>
        </div>
      ))}

      {items.length === 0 && (
        <div className="empty p-4 text-center text-xs text-slate-400">{t("noTransactionsRecorded")}</div>
      )}
    </div>
  );
}

function DashboardView({
  inventory,
  transactions,
  vehicles = [],
  employeeRoster = [],
  officerAssignments: _officerAssignments = [],
  onNavigate,
  onSelectRecord,
}: {
  inventory: RecordItem[];
  transactions: TransactionItem[];
  vehicles?: Vehicle[];
  employeeRoster?: Employee[];
  officerAssignments?: VehicleAssignment[];
  onNavigate: (module: string) => void;
  onSelectRecord: (item: RecordItem) => void;
}) {
  const { translations } = useLanguage();

  const pending = useMemo(
    () =>
      transactions.reduce(
        (count, item) => (item.status === "Pending" || item.status === "Attention" ? count + 1 : count),
        0
      ),
    [transactions]
  );

  // Consolidate all inventory-based KPI calculations (Top KPI, Coil, Slit, RM) into a single memoized pass
  const {
    stockRecords,
    totalStock,
    coilTotalQty,
    coilTotalCount,
    coilAvailableQty,
    coilAvailableCount,
    cl1Qty,
    cl2Qty,
    coilCapacity,
    coilPercent,
    slitTotalQty,
    slitTotalCount,
    slitAvailableQty,
    slitAvailableCount,
    slitCheckStockQty,
    slitCheckStockCount,
    slitCapacity,
    slitPercent,
    rmItems,
    rmTotalQty,
    ss400Qty,
    spccQty,
    outOfStockRm,
    rmCapacity,
    rmPercent,
  } = useMemo(() => {
    let totalStockAcc = 0;

    // 1. Coil accumulators
    let coilQtyAcc = 0;
    let coilCountAcc = 0;
    let coilAvailQtyAcc = 0;
    let coilAvailCountAcc = 0;
    let cl1QtyAcc = 0;
    let cl2QtyAcc = 0;

    // 2. Slit accumulators
    let slitQtyAcc = 0;
    let slitCountAcc = 0;
    let slitAvailQtyAcc = 0;
    let slitAvailCountAcc = 0;
    let slitCheckQtyAcc = 0;
    let slitCheckCountAcc = 0;

    // 3. RM accumulators
    const rmList: RecordItem[] = [];
    let rmQtyAcc = 0;
    let ss400QtyAcc = 0;
    let spccQtyAcc = 0;
    const outOfStockRmList: RecordItem[] = [];

    for (let i = 0; i < inventory.length; i++) {
      const item = inventory[i];
      const qty = Number(item.qty || 0);

      if (item.module === "coil") {
        totalStockAcc += qty;
        coilCountAcc++;
        coilQtyAcc += qty;
        if (item.status === "Available") {
          coilAvailCountAcc++;
          coilAvailQtyAcc += qty;
        }
        if (item.location?.includes("CL1")) {
          cl1QtyAcc += qty;
        }
        if (item.location?.includes("CL2")) {
          cl2QtyAcc += qty;
        }
      } else if (item.module === "slit") {
        totalStockAcc += qty;
        slitCountAcc++;
        slitQtyAcc += qty;
        if (item.status === "Available") {
          slitAvailCountAcc++;
          slitAvailQtyAcc += qty;
        }
        if (item.status === "Check Stock" || item.status === "Inspection") {
          slitCheckCountAcc++;
          slitCheckQtyAcc += qty;
        }
      } else if (item.module === "rm") {
        totalStockAcc += qty;
        rmList.push(item);
        rmQtyAcc += qty;
        const upperName = item.name?.toUpperCase() || "";
        const upperCode = item.code?.toUpperCase() || "";
        if (upperName.includes("SS400") || upperCode.includes("SS400")) {
          ss400QtyAcc += qty;
        }
        if (upperName.includes("SPCC") || upperCode.includes("SPCC")) {
          spccQtyAcc += qty;
        }
        if (qty === 0 || item.status === "Out of Stock") {
          outOfStockRmList.push(item);
        }
      }
    }

    const coilCap = 400; // Design capacity Bay CL1 (250T) + Bay CL2 (150T)
    const slitCap = 160; // Design capacity for Bay WH1-A
    const rmCap = 120; // Design capacity for Bay WH1-B

    return {
      stockRecords: inventory.length,
      totalStock: totalStockAcc,
      coilTotalQty: coilQtyAcc,
      coilTotalCount: coilCountAcc,
      coilAvailableQty: coilAvailQtyAcc,
      coilAvailableCount: coilAvailCountAcc,
      cl1Qty: cl1QtyAcc,
      cl2Qty: cl2QtyAcc,
      coilCapacity: coilCap,
      coilPercent: Math.min(100, Math.round((coilQtyAcc / coilCap) * 100)),
      slitTotalQty: slitQtyAcc,
      slitTotalCount: slitCountAcc,
      slitAvailableQty: slitAvailQtyAcc,
      slitAvailableCount: slitAvailCountAcc,
      slitCheckStockQty: slitCheckQtyAcc,
      slitCheckStockCount: slitCheckCountAcc,
      slitCapacity: slitCap,
      slitPercent: Math.min(100, Math.round((slitQtyAcc / slitCap) * 100)),
      rmItems: rmList,
      rmTotalQty: rmQtyAcc,
      ss400Qty: ss400QtyAcc,
      spccQty: spccQtyAcc,
      outOfStockRm: outOfStockRmList,
      rmCapacity: rmCap,
      rmPercent: Math.min(100, Math.round((rmQtyAcc / rmCap) * 100)),
    };
  }, [inventory]);

  // 4. Material Handling (Fleet Status) Calculations
  const {
    totalFleetCount,
    readyFleetCount,
    maintenanceVehicles,
    fleetReadyPercent,
    displayForklifts,
  } = useMemo(() => {
    const totalCount = vehicles.length;
    let readyCount = 0;
    const maintList: Vehicle[] = [];
    const forkliftList: Vehicle[] = [];

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.operationalStatus === "Available" || v.status === "Available") {
        readyCount++;
      }
      if (v.operationalStatus === "Maintenance" || v.status === "Maintenance") {
        maintList.push(v);
      }
      if (v.vehicleType === "Forklift" || v.vehicleId.startsWith("FL")) {
        forkliftList.push(v);
      }
    }

    return {
      totalFleetCount: totalCount,
      readyFleetCount: readyCount,
      maintenanceVehicles: maintList,
      fleetReadyPercent: totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0,
      displayForklifts: forkliftList.length > 0 ? forkliftList : vehicles.slice(0, 3),
    };
  }, [vehicles]);

  // 5. Admin & Workforce Calculations
  const {
    totalStaff,
    activeStaffCount,
    attendancePercent,
    allDrivers,
    activeDrivers,
    allWarehouseStaff,
    activeWarehouseStaff,
    allSupervisors,
    activeSupervisors,
  } = useMemo(() => {
    const totalCount = employeeRoster.length;
    let activeCount = 0;
    const driversAll: Employee[] = [];
    const driversActive: Employee[] = [];
    const whAll: Employee[] = [];
    const whActive: Employee[] = [];
    const supAll: Employee[] = [];
    const supActive: Employee[] = [];

    for (let i = 0; i < employeeRoster.length; i++) {
      const e = employeeRoster[i];
      const isActive = e.employmentStatus === "Active";
      if (isActive) {
        activeCount++;
      }
      if (e.role === "Driver") {
        driversAll.push(e);
        if (isActive) driversActive.push(e);
      } else if (e.role === "Operator" || e.role === "Inspector" || e.role === "Officer") {
        whAll.push(e);
        if (isActive) whActive.push(e);
      } else if (e.role === "Supervisor" || e.role === "Manager") {
        supAll.push(e);
        if (isActive) supActive.push(e);
      }
    }

    return {
      totalStaff: totalCount,
      activeStaffCount: activeCount,
      attendancePercent: totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0,
      allDrivers: driversAll,
      activeDrivers: driversActive,
      allWarehouseStaff: whAll,
      activeWarehouseStaff: whActive,
      allSupervisors: supAll,
      activeSupervisors: supActive,
    };
  }, [employeeRoster]);

  return (
    <>
      {/* 4 KPIs Top Bar */}
      <div className="kpi-grid">
        <KpiCard
          label={translations.kpiInventoryRecords}
          value={stockRecords}
        />
        <KpiCard
          label={translations.kpiRecordedSteelStock}
          value={totalStock.toLocaleString("en-US", {
            maximumFractionDigits: 2,
          })}
        />
        <KpiCard
          label={translations.kpiTransactionsToday}
          value={transactions.length}
        />
        <KpiCard
          label={translations.kpiPendingActions}
          value={pending}
        />
      </div>

      {/* 1. หมวดสินค้าคงคลังและพื้นที่จัดเก็บ (Inventory & Space Utilization) - 3 คอลัมน์/การ์ด */}
      <div className="overview-category-header">
        <div className="overview-category-title">
          <Layers size={15} style={{ color: "#0284c7" }} />
          <span>{translations.categoryInventorySpace}</span>
        </div>
      </div>

      <div className="overview-3col-grid">
        {/* Card 1: Coil Management (เหล็กม้วน) */}
        <div className="overview-card" style={{ borderTop: "3px solid #0284c7" }}>
          <div className="overview-card-header">
            <div className="overview-card-title">
              <Disc size={15} style={{ color: "#0284c7" }} />
              <span>{translations.cardCoilTitle}</span>
            </div>
            <span className="overview-card-badge" style={{ background: "#e0f2fe", color: "#0369a1" }}>
              Bay CL1 / CL2
            </span>
          </div>

          <div className="overview-card-body">
            {coilTotalCount === 0 ? (
              <div className="empty" style={{ padding: "16px 0" }}>{translations.noMatchingRecords}</div>
            ) : (
              <>
                <div className="overview-metrics-row">
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">{translations.totalStockTonLabel}</span>
                    <span className="overview-metric-val">
                      {coilTotalQty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>ตัน (TON)</span>
                    </span>
                  </div>
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">{translations.coilUnitsLabel}</span>
                    <span className="overview-metric-val">
                      {coilTotalCount}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>ม้วน (Coils)</span>
                    </span>
                  </div>
                </div>

                <div className="overview-progress-block">
                  <div className="overview-progress-header">
                    <span>{translations.spaceUtilizationLabel} (CL1/CL2)</span>
                    <span style={{ color: "#0284c7", fontWeight: 700 }}>{coilPercent}%</span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${coilPercent}%`, background: "#0284c7" }} />
                  </div>
                  <div className="overview-progress-sub">
                    <span>CL1: {cl1Qty.toFixed(1)} T | CL2: {cl2Qty.toFixed(1)} T</span>
                    <span>ความจุรวม: {coilCapacity} T</span>
                  </div>
                </div>

                <div className="overview-status-row">
                  <span className="overview-row-label">{translations.readyToDispatchLabel}:</span>
                  <span style={{ fontWeight: 700, color: "#059669" }}>
                    {coilAvailableQty.toFixed(1)} ตัน ({coilAvailableCount} ม้วน)
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="overview-card-footer">
            <button className="overview-jump-btn" onClick={() => onNavigate("coil")}>
              <span>{translations.viewModuleDetail}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Card 2: Slit / Film (เหล็กสลิต/ฟิล์ม) */}
        <div className="overview-card" style={{ borderTop: "3px solid #0d9488" }}>
          <div className="overview-card-header">
            <div className="overview-card-title">
              <Layers size={15} style={{ color: "#0d9488" }} />
              <span>{translations.cardSlitTitle}</span>
            </div>
            <span className="overview-card-badge" style={{ background: "#ccfbf1", color: "#0f766e" }}>
              Bay WH1-A
            </span>
          </div>

          <div className="overview-card-body">
            {slitTotalCount === 0 ? (
              <div className="empty" style={{ padding: "16px 0" }}>{translations.noMatchingRecords}</div>
            ) : (
              <>
                <div className="overview-metrics-row">
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">{translations.totalStockTonLabel}</span>
                    <span className="overview-metric-val">
                      {slitTotalQty.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>ตัน (TON)</span>
                    </span>
                  </div>
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">{translations.rollUnitsLabel}</span>
                    <span className="overview-metric-val">
                      {slitTotalCount}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>ม้วน/โรล</span>
                    </span>
                  </div>
                </div>

                <div className="overview-progress-block">
                  <div className="overview-progress-header">
                    <span>{translations.spaceUtilizationLabel} (WH1-A)</span>
                    <span style={{ color: "#0d9488", fontWeight: 700 }}>{slitPercent}%</span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${slitPercent}%`, background: "#0d9488" }} />
                  </div>
                  <div className="overview-progress-sub">
                    <span>สต็อกจริง: {slitTotalQty.toFixed(1)} T</span>
                    <span>ความจุรวม: {slitCapacity} T</span>
                  </div>
                </div>

                <div className="overview-status-chips-list">
                  <div className="overview-status-row">
                    <span className="overview-row-label">พร้อมใช้งาน (Available):</span>
                    <span style={{ fontWeight: 700, color: "#059669" }}>
                      {slitAvailableQty.toFixed(1)} T ({slitAvailableCount} รายการ)
                    </span>
                  </div>
                  <div className="overview-status-row">
                    <span className="overview-row-label">รอตรวจนับ (Check Stock):</span>
                    <span style={{ fontWeight: 700, color: slitCheckStockCount > 0 ? "#d97706" : "#64748b" }}>
                      {slitCheckStockQty.toFixed(1)} T ({slitCheckStockCount} รายการ)
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="overview-card-footer">
            <button className="overview-jump-btn" onClick={() => onNavigate("slit")}>
              <span>{translations.viewModuleDetail}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Card 3: RM - Steel Sheet (เหล็กแผ่น RM) */}
        <div className="overview-card" style={{ borderTop: "3px solid #f59e0b" }}>
          <div className="overview-card-header">
            <div className="overview-card-title">
              <Sheet size={15} style={{ color: "#f59e0b" }} />
              <span>{translations.cardRmTitle}</span>
            </div>
            <span className="overview-card-badge" style={{ background: "#fef3c7", color: "#b45309" }}>
              Bay WH1-B
            </span>
          </div>

          <div className="overview-card-body">
            {rmItems.length === 0 ? (
              <div className="empty" style={{ padding: "16px 0" }}>{translations.noMatchingRecords}</div>
            ) : (
              <>
                <div className="overview-metrics-row">
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">SS400 (Hot Rolled)</span>
                    <span className="overview-metric-val">
                      {ss400Qty.toFixed(1)}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>ตัน</span>
                    </span>
                  </div>
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">SPCC (Cold Rolled)</span>
                    <span className="overview-metric-val" style={{ color: spccQty === 0 ? "#dc2626" : "#0f172a" }}>
                      {spccQty.toFixed(1)}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>ตัน</span>
                    </span>
                  </div>
                </div>

                <div className="overview-progress-block">
                  <div className="overview-progress-header">
                    <span>{translations.spaceUtilizationLabel} (WH1-B)</span>
                    <span style={{ color: "#f59e0b", fontWeight: 700 }}>{rmPercent}%</span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${rmPercent}%`, background: "#f59e0b" }} />
                  </div>
                  <div className="overview-progress-sub">
                    <span>สต็อกจริง: {rmTotalQty.toFixed(1)} T</span>
                    <span>ความจุรวม: {rmCapacity} T</span>
                  </div>
                </div>

                {outOfStockRm.length > 0 ? (
                  <div className="overview-alert-box out-of-stock">
                    <AlertTriangle size={14} style={{ flexShrink: 0, color: "#dc2626" }} />
                    <span>
                      <strong>{translations.outOfStockWarning}:</strong>{" "}
                      {outOfStockRm.map((i) => (i.name.includes("SPCC") ? "SPCC (Cold Rolled)" : i.name)).join(", ")} (0 ตัน)
                    </span>
                  </div>
                ) : (
                  <div className="overview-alert-box in-stock">
                    <CheckCircle2 size={14} style={{ color: "#16a34a" }} />
                    <span>{translations.noOutOfStock}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="overview-card-footer">
            <button className="overview-jump-btn" onClick={() => onNavigate("rm")}>
              <span>{translations.viewModuleDetail}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. หมวดยานพาหนะและกำลังพล (Fleet & Workforce Operations) - 2 คอลัมน์/การ์ด */}
      <div className="overview-category-header">
        <div className="overview-category-title">
          <Truck size={15} style={{ color: "#0d9488" }} />
          <span>{translations.categoryFleetWorkforce}</span>
        </div>
      </div>

      <div className="overview-2col-grid">
        {/* Card 4: Material Handling (สถานะและความพร้อมของรถ) */}
        <div className="overview-card" style={{ borderTop: "3px solid #2563eb" }}>
          <div className="overview-card-header">
            <div className="overview-card-title">
              <Truck size={15} style={{ color: "#2563eb" }} />
              <span>{translations.cardMaterialHandlingTitle}</span>
            </div>
            <span className="overview-card-badge" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
              Fleet Hub
            </span>
          </div>

          <div className="overview-card-body">
            {totalFleetCount === 0 ? (
              <div className="empty" style={{ padding: "16px 0" }}>{translations.noMatchingRecords}</div>
            ) : (
              <>
                <div className="overview-metrics-row">
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">{translations.fleetReadyRateLabel}</span>
                    <span className="overview-metric-val" style={{ color: "#2563eb" }}>
                      {fleetReadyPercent}%
                    </span>
                  </div>
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">ความพร้อมใช้งาน (Ready / Total)</span>
                    <span className="overview-metric-val">
                      {readyFleetCount} / {totalFleetCount}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>คัน</span>
                    </span>
                  </div>
                </div>

                <div className="overview-status-row overview-prestart-box">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <ShieldCheck size={14} style={{ color: "#16a34a" }} />
                    <strong>{translations.dailyPrestartResultLabel}:</strong>
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    พร้อมใช้งาน {readyFleetCount} คัน {maintenanceVehicles.length > 0 && `(ซ่อมบำรุง ${maintenanceVehicles.length} คัน)`}
                  </span>
                </div>

                <div>
                  <div className="overview-section-label">
                    {translations.individualForkliftStatusLabel}
                  </div>
                  <div className="overview-status-chips-list">
                    {displayForklifts.map((veh) => {
                      const isAvail = veh.operationalStatus === "Available" || veh.status === "Available";
                      const isMaint = veh.operationalStatus === "Maintenance" || veh.status === "Maintenance";
                      const isInUse = veh.operationalStatus === "In Use";
                      return (
                        <div key={veh.id || veh.vehicleId} className="overview-vehicle-chip">
                          <span className="overview-vehicle-name">
                            {veh.vehicleId || veh.number} · <span className="overview-vehicle-desc">{veh.description || veh.type}</span>
                          </span>
                          {isAvail && (
                            <span className="overview-chip-badge avail">
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                              พร้อมใช้งาน
                            </span>
                          )}
                          {isMaint && (
                            <span className="overview-chip-badge maint">
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                              แจ้งซ่อม/ไฮดรอลิก
                            </span>
                          )}
                          {isInUse && (
                            <span className="overview-chip-badge inuse">
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                              อยู่ระหว่างใช้งาน
                            </span>
                          )}
                          {!isAvail && !isMaint && !isInUse && (
                            <span className="overview-chip-badge" style={{ color: "#64748b" }}>
                              {veh.operationalStatus || veh.status}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="overview-card-footer">
            <button className="overview-jump-btn" onClick={() => onNavigate("vehicles")}>
              <span>{translations.viewModuleDetail}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Card 5: Admin & Workforce (สถิติการมาทำงาน) */}
        <div className="overview-card" style={{ borderTop: "3px solid #7c3aed" }}>
          <div className="overview-card-header">
            <div className="overview-card-title">
              <Users size={15} style={{ color: "#7c3aed" }} />
              <span>{translations.cardAdminWorkforceTitle}</span>
            </div>
            <span className="overview-card-badge" style={{ background: "#f3e8ff", color: "#6b21a8" }}>
              Workforce
            </span>
          </div>

          <div className="overview-card-body">
            {totalStaff === 0 ? (
              <div className="empty" style={{ padding: "16px 0" }}>{translations.noMatchingRecords}</div>
            ) : (
              <>
                <div className="overview-metrics-row">
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">{translations.dailyAttendanceRateLabel}</span>
                    <span className="overview-metric-val" style={{ color: "#7c3aed" }}>
                      {attendancePercent}%
                    </span>
                  </div>
                  <div className="overview-metric-item">
                    <span className="overview-metric-label">เข้ากะจริง / ทั้งหมด</span>
                    <span className="overview-metric-val">
                      {activeStaffCount} / {totalStaff}
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginLeft: 4 }}>คน</span>
                    </span>
                  </div>
                </div>

                <div className="overview-status-row overview-shift-box">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Clock size={14} style={{ color: "#0284c7" }} />
                    <strong>{translations.currentShiftLabel}:</strong>
                  </span>
                  <span style={{ fontWeight: 700, color: "#0284c7" }}>
                    กะที่ 1 (Day Shift 08:00 - 16:00)
                  </span>
                </div>

                <div>
                  <div className="overview-section-label">
                    {translations.onDutyVsTargetLabel}
                  </div>
                  <div className="overview-status-chips-list">
                    <div className="overview-status-row">
                      <span className="overview-row-label">{translations.forkliftDriversLabel}</span>
                      <span style={{ fontWeight: 700, color: "#059669" }}>
                        {activeDrivers.length} / {allDrivers.length} คน ({allDrivers.length > 0 ? Math.round((activeDrivers.length / allDrivers.length) * 100) : 100}%)
                      </span>
                    </div>
                    <div className="overview-status-row">
                      <span className="overview-row-label">{translations.warehouseStaffLabel}</span>
                      <span style={{ fontWeight: 700, color: "#0284c7" }}>
                        {activeWarehouseStaff.length} / {allWarehouseStaff.length} คน
                      </span>
                    </div>
                    <div className="overview-status-row">
                      <span className="overview-row-label">{translations.supervisorsLabel}</span>
                      <span style={{ fontWeight: 700, color: "#7c3aed" }}>
                        {activeSupervisors.length} / {allSupervisors.length} คน
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="overview-card-footer">
            <button className="overview-jump-btn" onClick={() => onNavigate("employees")}>
              <span>{translations.viewModuleDetail}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>

      <section className="panel">
        <PanelHeaderComponent
          title={translations.recentTransactions}
        />

        <TransactionsList items={transactions} />
      </section>

      <section className="panel">
        <PanelHeaderComponent
          title={translations.inventorySnapshot}
        />

        <DataTable
          columns={[
            { key: "code", label: translations.colMaterialCode },
            { key: "name", label: translations.colMaterialDesc },
            { key: "location", label: translations.colStorageLocation },
            { key: "qty", label: translations.colStockQty },
            { key: "unit", label: translations.colUom },
            { key: "status", label: translations.colStatus },
          ]}
          rows={inventory.filter((item) =>
            ["slit", "rm", "coil"].includes(item.module)
          )}
          onSelect={onSelectRecord}
        />
      </section>
    </>
  );
}

function ModulePage({
  module,
  rows,
  onAdd,
  onSelect,
  onNavigate,
}: {
  module: string;
  rows: RecordItem[];
  onAdd: () => void;
  onSelect: (item: RecordItem) => void;
  onNavigate?: (module: string) => void;
}) {
  const { language, translations, t } = useLanguage();
  const info = useMemo(() => getModuleInfo(t)[module] || {
    title: module,
    subtitle: "",
    columns: [],
  }, [t, module]);

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const text = [row.code, row.name, row.location, row.status]
        .join(" ")
        .toLowerCase();

      const matchesKeyword = text.includes(keyword.toLowerCase());
      const matchesStatus =
        statusFilter === "All" || row.status === statusFilter;

      return matchesKeyword && matchesStatus;
    });
  }, [rows, keyword, statusFilter]);

  const availableStatuses = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.status)));
  }, [rows]);

  const availableCount = rows.filter((r) => r.status === "Available" || r.status === "Present").length;
  const attentionCount = rows.filter((r) =>
    ["Pending", "Attention", "Check Stock", "Maintenance", "On Leave"].includes(r.status)
  ).length;

  return (
    <>
      {(module === "material" || module === "fuel") && onNavigate && (
        <div
          className="panel"
          style={{
            padding: "12px 18px",
            marginBottom: 16,
            background: "#edf7fb",
            borderColor: "#c2e2f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ClipboardCheck size={20} color="#087eaf" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e3648" }}>
                {translations.dailyAssignmentTitle}
              </div>
              <div style={{ fontSize: 11, color: "#526875" }}>
                {translations.dailyAssignmentDesc}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="button secondary"
              onClick={() => onNavigate("employees")}
              style={{ padding: "7px 12px", fontSize: 11, background: "#ffffff" }}
            >
              <UserCheck size={13} color="#087eaf" />
              {translations.employeeRosterBtn}
            </button>
            <button
              className="button secondary"
              onClick={() => onNavigate("vehicles")}
              style={{ padding: "7px 12px", fontSize: 11, background: "#ffffff" }}
            >
              <Truck size={13} color="#087eaf" />
              {translations.fleetVehiclesBtn}
            </button>
            <button
              className="button"
              onClick={() => onNavigate("assignment")}
              style={{ padding: "7px 14px", fontSize: 11 }}
            >
              <ClipboardCheck size={13} />
              {translations.dailyAssignmentBtn}
            </button>
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard
          label={translations.kpiTotalRecords}
          value={rows.length}
          note={translations.kpiTotalRecordsModule}
        />

        <KpiCard
          label={translations.kpiAvailableActive}
          value={availableCount}
          note={translations.kpiReadyForOperations}
        />

        <KpiCard
          label={translations.kpiPendingAttention}
          value={attentionCount}
          note={translations.kpiRequiresAttention}
        />

        <KpiCard
          label={translations.kpiDisplayedRecords}
          value={filteredRows.length}
          note={translations.kpiFilteredMatchCount}
        />
      </div>

      <section className="panel">
        <PanelHeaderComponent
          title={translations.dataManagement}
          subtitle={`${info.title} · ${info.subtitle}`}
          action={
            <button className="button" onClick={onAdd}>
              <Plus size={14} />
              {translations.newEntry}
            </button>
          }
        />

        <div className="filterbar">
          <div style={{ position: "relative", flex: 1, minWidth: "220px", display: "flex", alignItems: "center" }}>
            <Search size={14} style={{ position: "absolute", left: 10, color: "#82919c" }} />
            <input
              className="field search-field"
              style={{ paddingLeft: 30 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={translations.searchPlaceholder}
              aria-label="Search records"
            />
          </div>

          <select
            className="field"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter status"
          >
            <option value="All">{translations.allStatuses}</option>
            {availableStatuses.map((status) => (
              <option value={status} key={status}>
                {STATUS_LABELS[status]?.[language] || status}
              </option>
            ))}
          </select>

          <button
            className="button secondary"
            onClick={() => {
              setKeyword("");
              setStatusFilter("All");
            }}
          >
            <RotateCcw size={13} />
            {translations.resetFilters}
          </button>
        </div>

        <DataTable
          columns={info.columns}
          rows={filteredRows}
          onSelect={onSelect}
        />

        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid #e7ecef",
            color: "#71818c",
            fontSize: 11,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            {t("showingRecords", { count: filteredRows.length, total: rows.length })}
          </span>
          <span style={{ fontSize: 10 }}>{translations.updatedRealtime}</span>
        </div>
      </section>

      <div className="notice">
        <Info size={16} />
        <div>
          <strong>{translations.operationalNotice}</strong> {translations.operationalNoticeBody}
        </div>
      </div>
    </>
  );
}

function EntryModal({
  module,
  onClose,
  onSave,
}: {
  module: string;
  onClose: () => void;
  onSave: (form: {
    code: string;
    name: string;
    location: string;
    qty: number;
    unit: string;
    status: string;
    module: string;
  }) => void;
}) {
  const { translations, t } = useLanguage();
  const defaultUnit = module === "admin" ? "HRS" : module === "material" ? "L" : "TON";
  const defaultStatus = module === "admin" ? "Present" : "Available";

  const [form, setForm] = useState({
    code: "",
    name: "",
    location: "",
    qty: "",
    unit: defaultUnit,
    status: defaultStatus,
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const info = useMemo(() => getModuleInfo(t)[module] || { title: module }, [t, module]);

  const update = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (errorMessage) setErrorMessage(null);
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!form.code.trim()) {
      setErrorMessage(translations.errorRequiredCode);
      return;
    }
    if (!form.name.trim()) {
      setErrorMessage(translations.errorRequiredName);
      return;
    }
    if (!form.location.trim()) {
      setErrorMessage(translations.errorRequiredLocation);
      return;
    }
    if (form.qty === "" || !Number.isFinite(Number(form.qty)) || Number(form.qty) < 0) {
      setErrorMessage(translations.errorRequiredQty);
      return;
    }

    onSave({
      ...form,
      qty: Number(form.qty),
      module,
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="panel-header" style={{ padding: "14px 20px" }}>
          <div>
            <div className="panel-title">{translations.createNewEntry}</div>
            <div className="panel-subtitle">{info.title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: "#64748b", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && (
            <div className="modal-error">
              <AlertTriangle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          <label className="form-field">
            {module === "material"
              ? "Vehicle ID / Code"
              : module === "admin"
              ? "Employee ID"
              : "Material Code (e.g. SL-003, RM-005)"}
            <input
              className="field"
              value={form.code}
              placeholder={module === "admin" ? "EMP-004" : module === "material" ? "FL-003" : "SL-003"}
              onChange={(e) => update("code", e.target.value)}
              required
            />
          </label>

          <label className="form-field">
            {module === "admin" ? "Employee Name & Title" : "Description / Specification"}
            <input
              className="field"
              value={form.name}
              placeholder={
                module === "admin"
                  ? "Narong Wittaya (Machine Operator)"
                  : module === "material"
                  ? "Nissan 2.5T Forklift"
                  : "Cold Rolled Coil 1.5mm x 400mm"
              }
              onChange={(e) => update("name", e.target.value)}
              required
            />
          </label>

          <label className="form-field">
            {module === "admin" ? "Department / Assigned Zone" : "Storage Location / Bay"}
            <input
              className="field"
              value={form.location}
              placeholder={module === "admin" ? "Warehouse 1 - Slitting Bay" : "WH1-C03"}
              onChange={(e) => update("location", e.target.value)}
              required
            />
          </label>

          <label className="form-field">
            {module === "admin" ? "Working Hours" : module === "material" ? "Fuel / Battery Level" : "Quantity"}
            <input
              className="field"
              type="number"
              min="0"
              step="any"
              value={form.qty}
              placeholder="0.00"
              onChange={(e) => update("qty", e.target.value)}
              required
            />
          </label>

          <label className="form-field">
            {translations.uomFieldLabel}
            <select
              className="field"
              value={form.unit}
              onChange={(e) => update("unit", e.target.value)}
            >
              <option value="TON">TON (ตัน)</option>
              <option value="KG">KG (กิโลกรัม)</option>
              <option value="PCS">PCS (ชิ้น)</option>
              <option value="L">L (ลิตร)</option>
              <option value="HRS">HRS (ชั่วโมง)</option>
              <option value="UNIT">UNIT (คัน/เครื่อง)</option>
            </select>
          </label>

          <label className="form-field">
            {translations.statusFieldLabel}
            <select
              className="field"
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
            >
              {module === "admin" ? (
                <>
                  <option value="Present">Present (มาปฏิบัติงาน)</option>
                  <option value="Overtime">Overtime (ทำโอที)</option>
                  <option value="On Leave">On Leave (ลาหยุด)</option>
                </>
              ) : module === "material" ? (
                <>
                  <option value="Available">Available (พร้อมใช้งาน)</option>
                  <option value="Maintenance">Maintenance (ซ่อมบำรุง)</option>
                  <option value="Attention">Attention (ต้องตรวจสอบ)</option>
                </>
              ) : (
                <>
                  <option value="Available">Available (พร้อมจ่าย/ขาย)</option>
                  <option value="Pending">Pending (รอดำเนินการ)</option>
                  <option value="Check Stock">Check Stock (ต้องตรวจนับ)</option>
                  <option value="Out of Stock">Out of Stock (สินค้าหมด)</option>
                </>
              )}
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {translations.cancel}
          </button>
          <button type="submit" className="button">
            {translations.saveEntry}
          </button>
        </div>
      </form>
    </div>
  );
}

function LiveClock() {
  const [currentTime, setCurrentTime] = useState(() => {
    const now = new Date();
    return now.toLocaleDateString("en-GB") + " " + now.toLocaleTimeString("en-GB");
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toLocaleDateString("en-GB") + " " + now.toLocaleTimeString("en-GB"));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="topbar-sub-desc hidden lg:inline font-mono text-[11px] opacity-80">
      • {currentTime}
    </span>
  );
}

function WmsApp() {
  const { language, setLanguage, t, translations } = useLanguage();
  const [active, setActive] = useState("dashboard");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem("tmt_wms_theme");
      if (saved === "light" || saved === "dark") {
        return saved;
      }
    } catch {
      // fallback
    }
    return "dark";
  });

  useEffect(() => {
    try {
      localStorage.setItem("tmt_wms_theme", theme);
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.body.style.backgroundColor = theme === "dark" ? "#0b1329" : "#f4f7fa";
    } catch {
      // fallback
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };
  const [materialHandlingExpanded, setMaterialHandlingExpanded] = useState<boolean>(false);
  const [warehouseInventoryExpanded, setWarehouseInventoryExpanded] = useState<boolean>(false);
  const [administrationExpanded, setAdministrationExpanded] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      if (typeof window.matchMedia === "function") {
        return window.matchMedia("(max-width: 768px)").matches;
      }
      return window.innerWidth <= 768;
    }
    return false;
  });
  const [slitMode, setSlitMode] = useState<"inbound" | "outbound" | "operator_receive" | "movement_history" | "relocate_layout" | "stock_balance" | "space_management" | "return_warehouse" | "daily_report" | "equipment_inspection" | "transfer_car_report">("inbound");

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 768px)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setSidebarCollapsed(true);
      }
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", handleMediaChange);
      return () => mql.removeEventListener("change", handleMediaChange);
    }
  }, []);
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => loadStoredVehicles());
  const [employeeRoster, setEmployeeRoster] = useState<Employee[]>(() => loadStoredEmployees());
  const [officerAssignments, setOfficerAssignments] = useState<VehicleAssignment[]>(() =>
    loadStoredAssignments()
  );

  const isMaterialHandlingActive = [
    "transport",
    "fix-flush",
    "pre-start",
    "vehicles",
    "employees",
    "fuel",
  ].includes(active);
  const isWarehouseInventoryActive = ["slit", "rm", "coil"].includes(active);
  const isAdministrationActive = ["admin"].includes(active);
  const [inventory, setInventory] = useState<RecordItem[]>(INITIAL_INVENTORY);
  const [fleet, setFleet] = useState<RecordItem[]>(INITIAL_FLEET);
  const [employees, setEmployees] = useState<RecordItem[]>(INITIAL_EMPLOYEES);
  const [transactions, setTransactions] = useState<TransactionItem[]>(INITIAL_TRANSACTIONS);
  const [showModal, setShowModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleUpdateVehicles = (updated: Vehicle[]) => {
    setVehicles(updated);
    saveStoredVehicles(updated);
  };

  const handleUpdateEmployeeRoster = (updated: Employee[]) => {
    setEmployeeRoster(updated);
    saveStoredEmployees(updated);
  };

  const handleUpdateOfficerAssignments = (updated: VehicleAssignment[]) => {
    setOfficerAssignments(updated);
    saveStoredAssignments(updated);
  };

  const showNotification = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const allRecords = useMemo(
    () => [...inventory, ...fleet, ...employees],
    [inventory, fleet, employees]
  );

  const moduleRows = useMemo(
    () =>
      allRecords.filter((row) => {
        if (active === "fuel") {
          return row.module === "fuel";
        }
        return row.module === active;
      }),
    [allRecords, active]
  );

  const moduleInfoMap = useMemo(() => getModuleInfo(t), [t]);
  const activeInfo = moduleInfoMap[active];
  const materialHandlingSubmenu = useMemo(() => getMaterialHandlingSubmenu(t), [t]);
  const warehouseInventoryItems = useMemo(() => getWarehouseInventoryItems(t), [t]);
  const administrationItems = useMemo(() => getAdministrationItems(t), [t]);

  const pageTitle =
    active === "dashboard"
      ? translations.executiveOverview
      : activeInfo?.title || translations.executiveOverview;

  function saveEntry(form: {
    code: string;
    name: string;
    location: string;
    qty: number;
    unit: string;
    status: string;
    module: string;
  }) {
    const id = Date.now();
    const timeStr = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const entry: RecordItem = {
      ...form,
      id,
      updatedAt: timeStr,
    };

    if (form.module === "admin") {
      setEmployees((current) => [entry, ...current]);
    } else {
      setInventory((current) => [entry, ...current]);
    }

    setTransactions((current) => [
      {
        time: timeStr,
        reference: form.code,
        module: activeInfo?.title || form.module,
        activity: `New record created: ${form.name}`,
        status: "Completed",
      },
      ...current,
    ]);

    setShowModal(false);
    showNotification(`${translations.recordCreatedToast} ${form.code} (${form.name})`);
  }

  function deleteRecord(recordToDelete: RecordItem) {
    if (recordToDelete.module === "material") {
      setFleet((cur) => cur.filter((item) => item.id !== recordToDelete.id));
    } else if (recordToDelete.module === "admin") {
      setEmployees((cur) => cur.filter((item) => item.id !== recordToDelete.id));
    } else {
      setInventory((cur) => cur.filter((item) => item.id !== recordToDelete.id));
    }

    setTransactions((current) => [
      {
        time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        reference: recordToDelete.code,
        module: recordToDelete.module.toUpperCase(),
        activity: `Item removed from registry: ${recordToDelete.code}`,
        status: "Completed",
      },
      ...current,
    ]);

    setSelectedRecord(null);
    showNotification(`${translations.recordRemovedToast} ${recordToDelete.code}`);
  }

  return (
    <>
      <style>{CSS}</style>

      <div className={`shell theme-${theme}`}>
        <header className="header-wrap">
          {/* Main Header Bar: Full Width Background Banner with Hamburger Button at Far Left Edge */}
          <div className="topbar-main">
            {/* Sidebar Collapse/Expand Toggle Button at Far Left Edge */}
            <button
              type="button"
              className="topbar-left-hamburger"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? translations.expandSidebar : translations.collapseSidebar}
              aria-label={sidebarCollapsed ? translations.expandSidebar : translations.collapseSidebar}
            >
              <Menu size={18} />
            </button>

            <div
              className="brand"
              onClick={() => setActive("dashboard")}
              role="button"
              tabIndex={0}
              title="WMS Warehouse 1"
            >
              <div className="brand-logo-frame">
                <img
                  src="/assets/aistudio/w_logo_clean.png"
                  alt="WMS Logo"
                  className="brand-logo-img"
                />
              </div>
              <div className="brand-text-col">
                <div className="brand-title-row">
                  <span className="brand-title-wms">WMS</span>
                  <span className="brand-divider">|</span>
                  <span className="brand-title-wh">Warehouse 1</span>
                </div>
                <div className="brand-sub-row">
                  <span className="brand-status-badge">
                    <span className="brand-live-dot" />
                    online
                  </span>
                  <span className="brand-sub-tagline">ระบบบริหารจัดการคลังสินค้า</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sub-bar underneath Header Bar: USER, Dark/Light Mode Switch, and Language Switcher */}
          <div className="topbar-sub">
            <div className="topbar-sub-left">
              <span className="topbar-sub-tag">
                <span className="live-dot" />
                SYSTEM ONLINE
              </span>
              <span className="topbar-sub-desc hidden md:inline">คลังสินค้า 1 (Warehouse 1) • กะการทำงานปกติ</span>
              <LiveClock />
            </div>

            <div className="topbar-sub-right">
              <span className="topbar-utility-user-text">
                <span className="user-dot" />
                USER: ADMIN (สมชาย)
              </span>

              <button
                type="button"
                className="theme-toggle-btn"
                onClick={toggleTheme}
                title={
                  theme === "dark"
                    ? (language === "th" ? "สลับเป็นโหมดสว่าง (Light Mode)" : "Switch to Light Mode")
                    : (language === "th" ? "สลับเป็นโหมดมืด (Dark Mode)" : "Switch to Dark Mode")
                }
              >
                {theme === "dark" ? (
                  <>
                    <Sun size={13} className="theme-icon sun-icon" />
                    <span>Light</span>
                  </>
                ) : (
                  <>
                    <Moon size={13} className="theme-icon moon-icon" />
                    <span>Dark</span>
                  </>
                )}
              </button>

              <div className="lang-switcher">
                <button
                  type="button"
                  className={`lang-btn ${language === "th" ? "active" : ""}`}
                  onClick={() => setLanguage("th")}
                  title={translations.switchToTh}
                >
                  TH
                </button>
                <button
                  type="button"
                  className={`lang-btn ${language === "en" ? "active" : ""}`}
                  onClick={() => setLanguage("en")}
                  title={translations.switchToEn}
                >
                  EN
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className={`layout ${sidebarCollapsed ? "collapsed" : ""}`}>
          {!sidebarCollapsed && (
            <div
              className="sidebar-mobile-backdrop"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Close sidebar backdrop"
            />
          )}
          <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
            {!sidebarCollapsed && (
              <div className="sidebar-header-row">
                <div className="nav-caption sidebar-header-title">{translations.wmsNavigation}</div>
                <button
                  type="button"
                  className="mobile-drawer-close-btn"
                  onClick={() => setSidebarCollapsed(true)}
                  title="Close Menu"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <div style={{ width: "100%" }}>
              <nav className="sidebar-nav">
                {sidebarCollapsed ? (
                  /* =========================================================
                     COLLAPSED SIDEBAR: ICONS ONLY WITH FULL TOOLTIPS
                     ========================================================= */
                  <div className="sidebar-collapsed-icons">
                    {/* 1. Executive Overview Icon */}
                    <button
                      type="button"
                      className={`nav-card-btn ${active === "dashboard" ? "active" : ""}`}
                      onClick={() => {
                        setActive("dashboard");
                        setSelectedRecord(null);
                      }}
                      title={translations.executiveOverview}
                    >
                      <span className="nav-icon">
                        <LayoutDashboard size={18} />
                      </span>
                    </button>

                    <div className="sidebar-divider" />

                    {/* 2. Material Handling Items (Icons only) */}
                    {materialHandlingSubmenu.map((item) => {
                      const Icon = item.icon;
                      const isActive = active === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`nav-card-btn ${isActive ? "active" : ""}`}
                          onClick={() => {
                            setActive(item.id);
                            setSelectedRecord(null);
                          }}
                          title={item.label}
                        >
                          <span className="nav-icon">
                            <Icon size={18} />
                          </span>
                        </button>
                      );
                    })}

                    <div className="sidebar-divider" />

                    {/* 3. Warehouse Inventory Items (Icons only) */}
                    {warehouseInventoryItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = active === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`nav-card-btn ${isActive ? "active" : ""}`}
                          onClick={() => {
                            setActive(item.id);
                            setSelectedRecord(null);
                          }}
                          title={item.label}
                        >
                          <span className="nav-icon">
                            <Icon size={18} />
                          </span>
                        </button>
                      );
                    })}

                    <div className="sidebar-divider" />

                    {/* 4. Administration Items (Icons only) */}
                    {administrationItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = active === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`nav-card-btn ${isActive ? "active" : ""}`}
                          onClick={() => {
                            setActive(item.id);
                            setSelectedRecord(null);
                          }}
                          title={item.label}
                        >
                          <span className="nav-icon">
                            <Icon size={18} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  /* =========================================================
                     EXPANDED SIDEBAR: ICONS AND MENU NAMES
                     ========================================================= */
                  <div className="sidebar-expanded-menu">
                    {/* 1. Executive Overview */}
                    <button
                      type="button"
                      className={`nav-card-btn ${active === "dashboard" ? "active" : ""}`}
                      style={{ backgroundImage: `url(${SIDEBAR_IMAGES.dashboard})` }}
                      onClick={() => {
                        setActive("dashboard");
                        setSelectedRecord(null);
                        if (typeof window !== "undefined" && window.innerWidth <= 768) {
                          setSidebarCollapsed(true);
                        }
                      }}
                      title={translations.executiveOverview}
                    >
                      <span className="nav-icon">
                        <LayoutDashboard size={16} />
                      </span>
                      <span>{translations.executiveOverview}</span>
                    </button>

                    {/* 2. Material Handling Parent Menu */}
                    <div style={{ marginTop: 8, marginBottom: 4 }}>
                      <button
                        type="button"
                        className={`nav-card-btn ${
                          isMaterialHandlingActive ? "active-parent" : ""
                        }`}
                        style={{ backgroundImage: `url(${SIDEBAR_IMAGES.materialHandling})` }}
                        onClick={() => {
                          setMaterialHandlingExpanded(!materialHandlingExpanded);
                          if (!isMaterialHandlingActive && !materialHandlingExpanded) {
                            setActive("transport");
                            setSelectedRecord(null);
                          }
                        }}
                        title={translations.materialHandling}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-start", width: "100%" }}>
                          <span className="nav-icon">
                            <Truck size={16} />
                          </span>
                          <span>{translations.materialHandling}</span>
                        </div>
                        <span
                          className="nav-arrow-icon"
                          style={{
                            transform: materialHandlingExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                          }}
                        >
                          <ChevronDown size={14} />
                        </span>
                      </button>

                      {/* Submenu under Material Handling */}
                      {materialHandlingExpanded && (
                        <div className="nav-submenu">
                          {materialHandlingSubmenu.map((item) => {
                            const Icon = item.icon;
                            const isItemActive = active === item.id;

                            return (
                              <button
                                key={item.id}
                                type="button"
                                className={`nav-sub-btn ${isItemActive ? "active" : ""}`}
                                onClick={() => {
                                  setActive(item.id);
                                  setSelectedRecord(null);
                                  if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                    setSidebarCollapsed(true);
                                  }
                                }}
                                title={item.label}
                              >
                                <span className="nav-icon" style={{ width: 16, height: 16 }}>
                                  <Icon size={14} />
                                </span>
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 3. Warehouse Inventory section */}
                    <div style={{ marginTop: 8, marginBottom: 4 }}>
                      <button
                        type="button"
                        className={`nav-caption-btn ${isWarehouseInventoryActive ? "active-group" : ""}`}
                        onClick={() => {
                          setWarehouseInventoryExpanded(!warehouseInventoryExpanded);
                        }}
                        title={translations.warehouseInventory}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <Package size={13} className={isWarehouseInventoryActive ? "text-cyan-400" : "text-slate-400"} />
                          <span>{translations.warehouseInventory}</span>
                        </div>
                        <span
                          className="nav-arrow-icon"
                          style={{
                            transform: warehouseInventoryExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                          }}
                        >
                          <ChevronDown size={14} />
                        </span>
                      </button>

                      {/* Submenu / Items under Warehouse Inventory */}
                      {warehouseInventoryExpanded && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                          {warehouseInventoryItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = active === item.id;
                            const bgImage = SIDEBAR_IMAGES[item.id] || SIDEBAR_IMAGES.slit;
                            const isSlit = item.id === "slit";

                            return (
                              <div key={item.id} style={{ marginBottom: isSlit && isActive ? 4 : 0 }}>
                                <button
                                  type="button"
                                  className={`nav-card-btn ${isActive ? "active" : ""}`}
                                  style={{ backgroundImage: `url(${bgImage})` }}
                                  onClick={() => {
                                    setActive(item.id);
                                    setSelectedRecord(null);
                                    if (!isSlit && typeof window !== "undefined" && window.innerWidth <= 768) {
                                      setSidebarCollapsed(true);
                                    }
                                  }}
                                  title={item.label}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                                    <span className="nav-icon">
                                      <Icon size={16} />
                                    </span>
                                    <span>{item.label}</span>
                                  </div>
                                  {isSlit && (
                                    <span
                                      className="nav-arrow-icon"
                                      style={{
                                        fontSize: 11,
                                        marginLeft: "auto",
                                        transform: isActive ? "rotate(0deg)" : "rotate(-90deg)",
                                      }}
                                    >
                                      <ChevronDown size={14} />
                                    </span>
                                  )}
                                </button>

                                 {/* Submenu for Slit / Film */}
                                 {isSlit && isActive && (
                                   <div className="nav-submenu">
                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${
                                         slitMode === "inbound" || slitMode === "outbound" || slitMode === "operator_receive" ? "active" : ""
                                       }`}
                                       onClick={() => {
                                         setActive("slit");
                                         if (slitMode !== "inbound" && slitMode !== "outbound" && slitMode !== "operator_receive") {
                                           setSlitMode("inbound");
                                         }
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title={translations.slitInboundOutbound}
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#38bdf8" }}>
                                         <ArrowRightLeft size={14} />
                                       </span>
                                       <span>{translations.slitInboundOutbound}</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "relocate_layout" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("relocate_layout");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title="ย้าย Layout"
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#f59e0b" }}>
                                         <ArrowRightLeft size={14} />
                                       </span>
                                       <span>ย้าย Layout</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "return_warehouse" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("return_warehouse");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title={language === "th" ? "คืนคลัง" : "Return to Warehouse"}
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#f97316" }}>
                                         <RotateCcw size={14} />
                                       </span>
                                       <span>{language === "th" ? "คืนคลัง" : "Return to Warehouse"}</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "stock_balance" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("stock_balance");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title={language === "th" ? "สต็อกคงคลัง" : "Stock Balance"}
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#10b981" }}>
                                         <Package size={14} />
                                       </span>
                                       <span>{language === "th" ? "สต็อกคงคลัง" : "Stock Balance"}</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "movement_history" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("movement_history");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title={translations.movementHistory}
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#c084fc" }}>
                                         <ClipboardList size={14} />
                                       </span>
                                       <span>{translations.movementHistory}</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "space_management" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("space_management");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title="พื้นที่"
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#06b6d4" }}>
                                         <Boxes size={14} />
                                       </span>
                                       <span>พื้นที่</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "daily_report" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("daily_report");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title={language === "th" ? "รายงาน" : "Reports"}
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#38bdf8" }}>
                                         <FileText size={14} />
                                       </span>
                                       <span>{language === "th" ? "รายงาน" : "Reports"}</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "transfer_car_report" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("transfer_car_report");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title={language === "th" ? "รายงาน Transfer Car" : "Transfer Car Report"}
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#f59e0b" }}>
                                         <Truck size={14} />
                                       </span>
                                       <span>{language === "th" ? "รายงาน Transfer Car" : "Transfer Car Report"}</span>
                                     </button>

                                     <button
                                       type="button"
                                       className={`nav-sub-btn ${slitMode === "equipment_inspection" ? "active" : ""}`}
                                       onClick={() => {
                                         setActive("slit");
                                         setSlitMode("equipment_inspection");
                                         setSelectedRecord(null);
                                         if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                           setSidebarCollapsed(true);
                                         }
                                       }}
                                       title={language === "th" ? "ตรวจสอบอุปกรณ์" : "Equipment Inspection"}
                                     >
                                       <span className="nav-icon" style={{ width: 16, height: 16, color: "#10b981" }}>
                                         <ShieldCheck size={14} />
                                       </span>
                                       <span>{language === "th" ? "ตรวจสอบอุปกรณ์" : "Equipment Inspection"}</span>
                                     </button>
                                   </div>
                                 )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 4. Administration section */}
                    <div style={{ marginTop: 8, marginBottom: 4 }}>
                      <button
                        type="button"
                        className={`nav-caption-btn ${isAdministrationActive ? "active-group" : ""}`}
                        onClick={() => {
                          setAdministrationExpanded(!administrationExpanded);
                        }}
                        title={translations.administration}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <Users size={13} className={isAdministrationActive ? "text-cyan-400" : "text-slate-400"} />
                          <span>{translations.administration}</span>
                        </div>
                        <span
                          className="nav-arrow-icon"
                          style={{
                            transform: administrationExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                          }}
                        >
                          <ChevronDown size={14} />
                        </span>
                      </button>

                      {/* Submenu / Items under Administration */}
                      {administrationExpanded && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                          {administrationItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = active === item.id;
                            const bgImage = SIDEBAR_IMAGES[item.id] || SIDEBAR_IMAGES.admin;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className={`nav-card-btn ${isActive ? "active" : ""}`}
                                style={{ backgroundImage: `url(${bgImage})` }}
                                onClick={() => {
                                  setActive(item.id);
                                  setSelectedRecord(null);
                                  if (typeof window !== "undefined" && window.innerWidth <= 768) {
                                    setSidebarCollapsed(true);
                                  }
                                }}
                                title={item.label}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                                  <span className="nav-icon">
                                    <Icon size={16} />
                                  </span>
                                  <span>{item.label}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </nav>
            </div>
          </aside>

          <main className="main">
            <div className={`page-heading ${active === "slit" ? "relative min-h-[36px]" : ""}`}>
              <div>
                <h1>{pageTitle}</h1>
                {active !== "slit" &&
                  active !== "dashboard" &&
                  active !== "pre-start" &&
                  active !== "vehicles" &&
                  active !== "employees" &&
                  active !== "fuel" &&
                  activeInfo?.subtitle && (
                    <div className="page-subtitle">
                      {activeInfo.subtitle}
                    </div>
                  )}
              </div>

              {active !== "dashboard" && active !== "pre-start" && active !== "vehicles" && active !== "employees" && active !== "fuel" && (
                <div className={active === "slit" ? "heading-actions absolute top-0 right-0 z-10 flex items-center gap-2" : "heading-actions"}>
                  {active !== "transport" && active !== "slit" && (
                    <button className="button secondary print-export-btn hidden sm:inline-flex" onClick={() => window.print()}>
                      <Printer size={13} />
                      <span>{translations.printExport}</span>
                    </button>
                  )}

                  {active !== "vehicles" && active !== "employees" && active !== "transport" && active !== "fuel" && active !== "slit" ? (
                    <button className="button" onClick={() => setShowModal(true)}>
                      <Plus size={14} />
                      {translations.newEntry}
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            {active === "dashboard" ? (
              <DashboardView
                inventory={inventory}
                transactions={transactions}
                vehicles={vehicles}
                employeeRoster={employeeRoster}
                officerAssignments={officerAssignments}
                onNavigate={(moduleKey) => {
                  setActive(moduleKey);
                  setSelectedRecord(null);
                }}
                onSelectRecord={setSelectedRecord}
              />
            ) : active === "vehicles" ? (
              <VehicleManagement
                vehicles={vehicles}
                assignments={officerAssignments}
                onUpdateVehicles={handleUpdateVehicles}
                onNavigateToAssignment={() => {
                  setActive("employees");
                  setSelectedRecord(null);
                }}
                onLogTransaction={(activity, reference, status) => {
                  setTransactions((current) => [
                    {
                      time: new Date().toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                      reference,
                      module: "Vehicle Management",
                      activity,
                      status,
                    },
                    ...current,
                  ]);
                }}
              />
            ) : active === "employees" ? (
              <EmployeeManagement
                employees={employeeRoster}
                vehicles={vehicles}
                assignments={officerAssignments}
                onUpdateEmployees={handleUpdateEmployeeRoster}
                onUpdateAssignments={handleUpdateOfficerAssignments}
                onNavigateToAssignment={() => {
                  setActive("vehicles");
                  setSelectedRecord(null);
                }}
                onNavigateToVehicles={() => {
                  setActive("vehicles");
                  setSelectedRecord(null);
                }}
                onLogTransaction={(activity, reference, status) => {
                  setTransactions((current) => [
                    {
                      time: new Date().toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                      reference,
                      module: "Employee Management",
                      activity,
                      status,
                    },
                    ...current,
                  ]);
                }}
              />
            ) : active === "fix-flush" ? (
              <FixFlushManagement vehicles={vehicles} />
            ) : active === "pre-start" ? (
              <PreStartInspection
                vehicles={vehicles}
                onNavigateToFixFlush={() => {
                  setActive("fix-flush");
                  setSelectedRecord(null);
                }}
              />
            ) : active === "fuel" ? (
              <FuelManagement vehicles={vehicles} />
            ) : active === "transport" ? (
              <TransportOperations
                vehicles={vehicles}
                assignments={officerAssignments}
                onNavigateToAssignments={() => {
                  setActive("employees");
                  setSelectedRecord(null);
                }}
                onNavigateToVehicles={() => {
                  setActive("vehicles");
                  setSelectedRecord(null);
                }}
              />
            ) : active === "slit" ? (
              <SlitFilmManagement
                activeMode={slitMode}
                onModeChange={setSlitMode}
                onLogTransaction={(activity, reference, status) => {
                  setTransactions((current) => [
                    {
                      time: new Date().toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                      reference,
                      module: "Slit / Film",
                      activity,
                      status,
                    },
                    ...current,
                  ]);
                }}
              />
            ) : (
              <ModulePage
                key={active}
                module={active}
                rows={moduleRows}
                onAdd={() => setShowModal(true)}
                onSelect={setSelectedRecord}
                onNavigate={(mod) => {
                  setActive(mod);
                  setSelectedRecord(null);
                }}
              />
            )}

            {selectedRecord && (
              <section className="panel" style={{ marginTop: 20 }}>
                <PanelHeaderComponent
                  title={translations.recordDetailsInspection}
                  subtitle={`Selected: ${selectedRecord.code} · ${selectedRecord.name}`}
                  action={
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="button danger"
                        onClick={() => deleteRecord(selectedRecord)}
                      >
                        {translations.deleteRecord}
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => setSelectedRecord(null)}
                      >
                        {translations.close}
                      </button>
                    </div>
                  }
                />

                <div className="table-wrap">
                  <table>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: 700, width: 220, background: "#fafbfc" }}>{translations.recordId}</td>
                        <td>{selectedRecord.id}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: "#fafbfc" }}>{translations.moduleLabel}</td>
                        <td style={{ textTransform: "capitalize" }}>{selectedRecord.module}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: "#fafbfc" }}>{translations.codeIdLabel}</td>
                        <td><span className="code">{selectedRecord.code}</span></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: "#fafbfc" }}>{translations.descriptionLabel}</td>
                        <td>{selectedRecord.name}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: "#fafbfc" }}>{translations.locationDeptLabel}</td>
                        <td>{selectedRecord.location}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: "#fafbfc" }}>{translations.qtyMeasuredLabel}</td>
                        <td>
                          <strong>{Number(selectedRecord.qty).toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong> {selectedRecord.unit}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, background: "#fafbfc" }}>{translations.statusLabel}</td>
                        <td><StatusBadge value={selectedRecord.status} /></td>
                      </tr>
                      {selectedRecord.updatedAt && (
                        <tr>
                          <td style={{ fontWeight: 700, background: "#fafbfc" }}>{translations.lastActivityTime}</td>
                          <td>{selectedRecord.updatedAt}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}


          </main>
        </div>

        {/* Mobile Bottom Navigation Bar (Fixed Bottom - Visible on Mobile <768px Only) */}
        <nav className="mobile-bottom-nav sm:hidden fixed bottom-0 left-0 right-0 h-14 z-40 bg-white/95 dark:bg-[#091322]/95 backdrop-blur-md border-t border-slate-200 dark:border-[#1e3a5f] shadow-[0_-4px_16px_rgba(0,0,0,0.12)] px-0.5 flex items-center justify-around">
          {[
            {
              id: "inbound" as const,
              labelTh: "+ รับเข้า",
              labelEn: "+ Inbound",
              icon: ArrowDownRight,
              activeClass: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800",
            },
            {
              id: "operator_receive" as const,
              labelTh: "จ่ายออก",
              labelEn: "Issue",
              icon: Cpu,
              activeClass: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800",
            },
            {
              id: "outbound" as const,
              labelTh: "- เตรียมเบิก",
              labelEn: "- Outbound",
              icon: ArrowUpRight,
              activeClass: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800",
            },
            {
              id: "relocate_layout" as const,
              labelTh: "ย้าย Layout",
              labelEn: "Relocate",
              icon: ArrowRightLeft,
              activeClass: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800",
            },
            {
              id: "stock_balance" as const,
              labelTh: "สต๊อก",
              labelEn: "Stock",
              icon: Package,
              activeClass: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800",
            },
          ].map((item) => {
            const Icon = item.icon;
            const isItemActive = active === "slit" && slitMode === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (active !== "slit") {
                    setActive("slit");
                  }
                  setSlitMode(item.id);
                  setSelectedRecord(null);
                }}
                className={`flex-1 h-full flex flex-col items-center justify-center gap-0.5 py-1 px-0.5 transition-all cursor-pointer select-none ${
                  isItemActive
                    ? "font-extrabold"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <div
                  className={`p-1 rounded-lg transition-all flex items-center justify-center ${
                    isItemActive
                      ? item.activeClass + " border shadow-xs"
                      : "bg-transparent"
                  }`}
                >
                  <Icon size={17} />
                </div>
                <span
                  className={`text-[10px] leading-none whitespace-nowrap truncate max-w-full overflow-hidden text-ellipsis font-bold ${
                    isItemActive
                      ? "text-slate-900 dark:text-slate-100 font-black"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                  style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
                >
                  {language === "th" ? item.labelTh : item.labelEn}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {showModal && (
        <EntryModal
          module={active === "dashboard" ? "slit" : active}
          onClose={() => setShowModal(false)}
          onSave={saveEntry}
        />
      )}

      {toast && (
        <div className="toast">
          <CheckCircle2 size={16} color="#4ade80" />
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <WmsApp />
    </LanguageProvider>
  );
}
