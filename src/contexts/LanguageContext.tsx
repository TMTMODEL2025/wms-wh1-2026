/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Language = "th" | "en";

export interface Translations {
  // Brand & Topbar
  brandTitle: string;
  brandSubtitle: string;
  managerView: string;
  expandSidebar: string;
  collapseSidebar: string;
  switchToEn: string;
  switchToTh: string;

  // Navigation
  wmsNavigation: string;
  executiveOverview: string;
  materialHandling: string;
  warehouseInventory: string;
  administration: string;

  // Submenu
  transportOperation: string;
  fixFlushStatus: string;
  preStartInspection: string;
  vehicleManagement: string;
  employeeManagement: string;
  fuelManagement: string;

  // Inventory Submenu
  slitFilm: string;
  slitInboundOutbound: string;
  movementHistory: string;
  rmSteelSheet: string;
  coilManagement: string;
  adminWorkforce: string;

  // Subtitles
  transportSubtitle: string;
  fixFlushSubtitle: string;
  preStartSubtitle: string;
  vehiclesSubtitle: string;
  employeesSubtitle: string;
  fuelSubtitle: string;
  slitSubtitle: string;
  rmSubtitle: string;
  coilSubtitle: string;
  adminSubtitle: string;
  dashboardSubtitle: string;

  // Action Buttons
  printExport: string;
  quickAddMaterial: string;
  newEntry: string;
  resetFilters: string;
  searchPlaceholder: string;
  allStatuses: string;
  printLog: string;
  viewAllModules: string;
  close: string;
  deleteRecord: string;
  saveEntry: string;
  cancel: string;

  // Column Headers
  colMaterialCode: string;
  colMaterialDesc: string;
  colStorageLocation: string;
  colStockQty: string;
  colUom: string;
  colStatus: string;
  colFleetId: string;
  colMaintenanceAction: string;
  colWorkshopBay: string;
  colOperatingHours: string;
  colUnit: string;
  colVehicleId: string;
  colVehicleDesc: string;
  colDispenserStation: string;
  colFuelStockUsage: string;
  colEmployeeId: string;
  colEmployeeName: string;
  colDepartment: string;
  colWorkingHours: string;

  // KPI
  kpiInventoryRecords: string;
  kpiActiveWarehouseRecords: string;
  kpiRecordedSteelStock: string;
  kpiTonTotalInventory: string;
  kpiTransactionsToday: string;
  kpiMovementLogActivities: string;
  kpiPendingActions: string;
  kpiPendingAttentionRequired: string;
  kpiTotalRecords: string;
  kpiTotalRecordsModule: string;
  kpiAvailableActive: string;
  kpiReadyForOperations: string;
  kpiPendingAttention: string;
  kpiRequiresAttention: string;
  kpiDisplayedRecords: string;
  kpiFilteredMatchCount: string;

  // Overview Panels
  warehouseSectionOverview: string;
  operationalCapacityMetrics: string;
  interactiveOverviewNote: string;
  categoryInventorySpace: string;
  categoryInventorySpaceSub: string;
  categoryFleetWorkforce: string;
  categoryFleetWorkforceSub: string;
  cardCoilTitle: string;
  cardSlitTitle: string;
  cardRmTitle: string;
  cardMaterialHandlingTitle: string;
  cardAdminWorkforceTitle: string;
  totalStockTonLabel: string;
  coilUnitsLabel: string;
  rollUnitsLabel: string;
  spaceUtilizationLabel: string;
  readyToDispatchLabel: string;
  stockAuditStatusLabel: string;
  stockByGradeLabel: string;
  outOfStockWarning: string;
  noOutOfStock: string;
  fleetReadyRateLabel: string;
  dailyPrestartResultLabel: string;
  individualForkliftStatusLabel: string;
  dailyAttendanceRateLabel: string;
  onDutyVsTargetLabel: string;
  currentShiftLabel: string;
  forkliftDriversLabel: string;
  warehouseStaffLabel: string;
  supervisorsLabel: string;
  viewModuleDetail: string;
  actionRequired: string;
  itemsRequiringFollowup: string;
  recentTransactions: string;
  recentTransactionsSubtitle: string;
  inventorySnapshot: string;
  inventorySnapshotSubtitle: string;
  dataManagement: string;
  showingRecords: string;
  updatedRealtime: string;
  noMatchingRecords: string;
  noTransactionsRecorded: string;
  operationalNotice: string;
  operationalNoticeBody: string;

  // Modal & Details
  recordDetailsInspection: string;
  recordId: string;
  moduleLabel: string;
  codeIdLabel: string;
  descriptionLabel: string;
  locationDeptLabel: string;
  qtyMeasuredLabel: string;
  statusLabel: string;
  lastActivityTime: string;
  createNewEntry: string;
  codeFieldLabel: string;
  descFieldLabel: string;
  locationFieldLabel: string;
  qtyFieldLabel: string;
  uomFieldLabel: string;
  statusFieldLabel: string;
  errorRequiredCode: string;
  errorRequiredName: string;
  errorRequiredLocation: string;
  errorRequiredQty: string;
  recordCreatedToast: string;
  recordRemovedToast: string;
  footerText: string;

  // Material Handling Notice Banner
  dailyAssignmentTitle: string;
  dailyAssignmentDesc: string;
  employeeRosterBtn: string;
  fleetVehiclesBtn: string;
  dailyAssignmentBtn: string;
}

const TRANSLATIONS: Record<Language, Translations> = {
  th: {
    // Brand & Topbar
    brandTitle: "WMS",
    brandSubtitle: "คลังสินค้า 1",
    managerView: "มุมมองผู้จัดการ",
    expandSidebar: "ขยายแถบเมนู",
    collapseSidebar: "ย่อแถบเมนู",
    switchToEn: "Switch to English",
    switchToTh: "เปลี่ยนเป็นภาษาไทย",

    // Navigation
    wmsNavigation: "เมนูระบบ WMS",
    executiveOverview: "ภาพรวม",
    materialHandling: "การจัดการขนย้ายวัสดุ",
    warehouseInventory: "คลังสินค้าและวัตถุดิบ",
    administration: "การบริหารงานบุคคล",

    // Submenu
    transportOperation: "การปฏิบัติการขนย้าย",
    fixFlushStatus: "ระบบแจ้งซ่อม",
    preStartInspection: "ตรวจเช็ครถประจำวัน",
    vehicleManagement: "การจัดการยานพาหนะ",
    employeeManagement: "การจัดการพนักงาน",
    fuelManagement: "การจัดการน้ำมันเชื้อเพลิง",

    // Inventory Submenu
    slitFilm: "เหล็กสลิต / ฟิล์ม",
    slitInboundOutbound: "รับเข้า เบิกออก",
    movementHistory: "ประวัติการเคลื่อนไหว",
    rmSteelSheet: "เหล็กแผ่น RM",
    coilManagement: "การจัดการเหล็กม้วน",
    adminWorkforce: "งานบริหารและกำลังพล",

    // Subtitles
    transportSubtitle: "การเคลื่อนย้ายวัสดุภายใน ใบกำกับการเดินทาง และจุดตรวจเส้นทาง",
    fixFlushSubtitle: "ระบบแจ้งซ่อมบำรุง ติดตามสถานะงานซ่อม และประวัติการฟลัชชิ่งน้ำมัน",
    preStartSubtitle: "รายการตรวจเช็คสภาพรถยกและเครื่องจักรประจำวันก่อนเริ่มปฏิบัติงาน",
    vehiclesSubtitle: "ข้อมูลทะเบียนยานพาหนะ สถานะการทำงาน และการจัดสรรคนขับ",
    employeesSubtitle: "บัญชีรายชื่อกำลังพลฝ่ายขนย้าย บทบาทหน้าที่ และคุณสมบัติการจัดสรร",
    fuelSubtitle: "ประวัติการจ่ายน้ำมันดีเซลยานพาหนะ การติดตามสต็อกหัวจ่าย และอัตราสิ้นเปลือง",
    slitSubtitle: "สินค้าคงคลังเหล็กสลิตและประวัติการเคลื่อนไหว",
    rmSubtitle: "การจัดการคลังวัตถุดิบเหล็กแผ่น",
    coilSubtitle: "คลังเหล็กม้วนและการจ่ายเข้าสู่สายการผลิต",
    adminSubtitle: "การบันทึกเวลาปฏิบัติงาน การลา และการทำงานล่วงเวลา",
    dashboardSubtitle: "การปฏิบัติการคลังสินค้า ยอดสต็อกคงเหลือ และการติดตามอุปกรณ์",

    // Action Buttons
    printExport: "พิมพ์ / ส่งออก",
    quickAddMaterial: "+ เพิ่มวัสดุด่วน",
    newEntry: "+ สร้างรายการใหม่",
    resetFilters: "รีเซ็ตตัวกรอง",
    searchPlaceholder: "ค้นหารหัส, รายละเอียด, สถานที่...",
    allStatuses: "ทุกสถานะ",
    printLog: "พิมพ์ประวัติธุรกรรม",
    viewAllModules: "ดูทุกส่วนงาน →",
    close: "ปิด",
    deleteRecord: "ลบรายการ",
    saveEntry: "บันทึกข้อมูล",
    cancel: "ยกเลิก",

    // Column Headers
    colMaterialCode: "รหัสวัสดุ",
    colMaterialDesc: "รายละเอียดวัสดุ",
    colStorageLocation: "สถานที่จัดเก็บ",
    colStockQty: "ปริมาณสต็อก",
    colUom: "หน่วยนับ",
    colStatus: "สถานะ",
    colFleetId: "รหัสยานพาหนะ",
    colMaintenanceAction: "การบำรุงรักษาและฟลัช",
    colWorkshopBay: "ช่องซ่อมบำรุง",
    colOperatingHours: "ชั่วโมงการทำงาน",
    colUnit: "หน่วย",
    colVehicleId: "รหัสยานพาหนะ",
    colVehicleDesc: "รายละเอียดรถ",
    colDispenserStation: "ตู้จ่ายน้ำมัน",
    colFuelStockUsage: "สต็อกน้ำมัน / ปริมาณการใช้",
    colEmployeeId: "รหัสพนักงาน",
    colEmployeeName: "ชื่อพนักงาน",
    colDepartment: "แผนก",
    colWorkingHours: "ชั่วโมงการทำงาน",

    // KPI
    kpiInventoryRecords: "รายการสินค้าคงคลัง",
    kpiActiveWarehouseRecords: "รายการที่บันทึกในระบบ",
    kpiRecordedSteelStock: "ยอดสต็อกเหล็กรวม",
    kpiTonTotalInventory: "ตัน · ปริมาณสต็อกจริงรวม",
    kpiTransactionsToday: "ธุรกรรมวันนี้",
    kpiMovementLogActivities: "ประวัติการเคลื่อนย้ายและกิจกรรม",
    kpiPendingActions: "งานรอดำเนินการ",
    kpiPendingAttentionRequired: "รอดำเนินการและต้องตรวจสอบ",
    kpiTotalRecords: "รายการทั้งหมด",
    kpiTotalRecordsModule: "จำนวนรายการทั้งหมดในส่วนนี้",
    kpiAvailableActive: "พร้อมใช้งาน / ปฏิบัติงาน",
    kpiReadyForOperations: "พร้อมสำหรับการผลิตและการทำงาน",
    kpiPendingAttention: "รอดำเนินการ / ต้องตรวจสอบ",
    kpiRequiresAttention: "ต้องได้รับการตรวจสอบจากผู้ปฏิบัติงาน",
    kpiDisplayedRecords: "รายการที่แสดง",
    kpiFilteredMatchCount: "จำนวนรายการตามตัวกรอง",

    // Overview Panels
    warehouseSectionOverview: "ภาพรวมแต่ละส่วนงานคลังสินค้า",
    operationalCapacityMetrics: "สมรรถนะการปฏิบัติการและตัวชี้วัดหลัก",
    interactiveOverviewNote: "ส่วนภาพรวมแบบตอบสนอง: คลิกที่แถวของแต่ละส่วนงานเพื่อเข้าสู่หน้าโมดูลนั้นโดยตรง",
    categoryInventorySpace: "หมวดสินค้าคงคลังและพื้นที่จัดเก็บ (Inventory & Space Utilization)",
    categoryInventorySpaceSub: "สถานะสต็อก การใช้พื้นที่จัดเก็บ และความจุลานวางสินค้าคลัง 1",
    categoryFleetWorkforce: "หมวดยานพาหนะและกำลังพล (Fleet & Workforce Operations)",
    categoryFleetWorkforceSub: "ความพร้อมของรถโฟล์คลิฟท์ สถิติการเข้างาน และการจัดสรรกะปฏิบัติการ",
    cardCoilTitle: "Coil Management (เหล็กม้วน)",
    cardSlitTitle: "Slit / Film (เหล็กสลิต/ฟิล์ม)",
    cardRmTitle: "RM - Steel Sheet (เหล็กแผ่น RM)",
    cardMaterialHandlingTitle: "Material Handling (สถานะและความพร้อมของรถ)",
    cardAdminWorkforceTitle: "Admin & Workforce (สถิติการมาทำงาน)",
    totalStockTonLabel: "สต็อกรวม",
    coilUnitsLabel: "จำนวนม้วน",
    rollUnitsLabel: "จำนวนม้วน/โรล",
    spaceUtilizationLabel: "ความจุพื้นที่จัดเก็บ",
    readyToDispatchLabel: "พร้อมจ่าย",
    stockAuditStatusLabel: "สถานะการตรวจนับ",
    stockByGradeLabel: "สต็อกแยกตามเกรด",
    outOfStockWarning: "แจ้งเตือนสินค้าหมดสต็อก",
    noOutOfStock: "สต็อกปกติ (ไม่มีสินค้าหมด)",
    fleetReadyRateLabel: "อัตราความพร้อมของรถทั้งหมด",
    dailyPrestartResultLabel: "ผลตรวจเช็กประจำวัน",
    individualForkliftStatusLabel: "สถานะรถโฟล์คลิฟท์รายคัน",
    dailyAttendanceRateLabel: "อัตราการมาทำงานประจำวัน",
    onDutyVsTargetLabel: "ยอดพนักงานเข้ากะจริง / เป้าหมาย",
    currentShiftLabel: "สถานะกะปัจจุบัน",
    forkliftDriversLabel: "พนักงานขับโฟล์คลิฟท์ / รถยก",
    warehouseStaffLabel: "พนักงานคลังสินค้า / ตรวจนับ",
    supervisorsLabel: "หัวหน้างานและผู้จัดการ",
    viewModuleDetail: "ดูรายละเอียดส่วนงาน →",
    actionRequired: "รายการที่ต้องดำเนินการ",
    itemsRequiringFollowup: "รายการที่ต้องติดตามผลทันที",
    recentTransactions: "ธุรกรรมคลังสินค้าล่าสุด",
    recentTransactionsSubtitle: "บันทึกข้อมูลแบบเรียลไทม์ทั้งขาเข้า ขาออก และงานซ่อมบำรุง",
    inventorySnapshot: "ภาพรวมสถานะสินค้าคงคลัง",
    inventorySnapshotSubtitle: "ภาพรวมเหล็กสลิต วัตถุดิบ และเหล็กม้วนแบบเรียลไทม์",
    dataManagement: "การจัดการข้อมูล",
    showingRecords: "แสดง {count} จาก {total} รายการ · คลิกแถวเพื่อดูรายละเอียด",
    updatedRealtime: "อัปเดตแบบเรียลไทม์",
    noMatchingRecords: "ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา (No matching records found)",
    noTransactionsRecorded: "ยังไม่มีรายการธุรกรรม (No transactions recorded)",
    operationalNotice: "ข้อสังเกตการดำเนินงาน:",
    operationalNoticeBody: "ข้อมูลที่บันทึกในเซสชันนี้จะถูกจัดเก็บในหน่วยความจำและเชื่อมโยงกับแดชบอร์ดผู้บริหารและบันทึกธุรกรรมทันที",

    // Modal & Details
    recordDetailsInspection: "รายละเอียดและการตรวจสอบรายการ",
    recordId: "รหัสบันทึก (Record ID)",
    moduleLabel: "ส่วนงาน (Module)",
    codeIdLabel: "รหัส / ID (Code / ID)",
    descriptionLabel: "รายละเอียด / ชื่อรายการ",
    locationDeptLabel: "สถานที่จัดเก็บ / แผนก",
    qtyMeasuredLabel: "จำนวน / ปริมาณที่วัดได้",
    statusLabel: "สถานะ (Status)",
    lastActivityTime: "เวลาทำรายการล่าสุด",
    createNewEntry: "สร้างรายการใหม่",
    codeFieldLabel: "รหัสโค้ด / Code or ID",
    descFieldLabel: "คำอธิบาย / Name or Description",
    locationFieldLabel: "สถานที่จัดเก็บหรือแผนก / Location",
    qtyFieldLabel: "จำนวน / ปริมาณ (Quantity)",
    uomFieldLabel: "หน่วยนับ (Unit of Measure)",
    statusFieldLabel: "สถานะการปฏิบัติงาน (Status)",
    errorRequiredCode: "กรุณาระบุรหัสโค้ด / Code or ID",
    errorRequiredName: "กรุณาระบุคำอธิบาย / Name or Description",
    errorRequiredLocation: "กรุณาระบุสถานที่จัดเก็บหรือแผนก / Location",
    errorRequiredQty: "กรุณากรอกจำนวนตัวเลขที่ถูกต้อง (0 หรือมากกว่า)",
    recordCreatedToast: "บันทึกข้อมูลสำเร็จ:",
    recordRemovedToast: "ลบข้อมูลสำเร็จ:",
    footerText: "TMT WMS Prototype · Warehouse 1 Management System · Internal Design Review",

    // Material Handling Notice Banner
    dailyAssignmentTitle: "ระบบจัดสรรยานพาหนะและพนักงานขับรายวัน",
    dailyAssignmentDesc: "จัดสรรรถลากจูงและรถยกให้กับพนักงานขับที่ผ่านการรับรอง พร้อมการตรวจสอบความขัดแย้งและประวัติการทำงาน",
    employeeRosterBtn: "ทำเนียบพนักงาน ➔",
    fleetVehiclesBtn: "กองยานพาหนะ ➔",
    dailyAssignmentBtn: "การจัดสรรยานพาหนะรายวัน ➔",
  },
  en: {
    // Brand & Topbar
    brandTitle: "WMS",
    brandSubtitle: "WAREHOUSE 1",
    managerView: "Manager View",
    expandSidebar: "Expand Sidebar",
    collapseSidebar: "Collapse Sidebar",
    switchToEn: "Switch to English",
    switchToTh: "เปลี่ยนเป็นภาษาไทย",

    // Navigation
    wmsNavigation: "WMS NAVIGATION",
    executiveOverview: "Overview",
    materialHandling: "Material Handling",
    warehouseInventory: "WAREHOUSE INVENTORY",
    administration: "ADMINISTRATION",

    // Submenu
    transportOperation: "Transport Operation",
    fixFlushStatus: "Fix & Flush Status",
    preStartInspection: "Pre-Start Safety Inspection",
    vehicleManagement: "Vehicle Management",
    employeeManagement: "Employee Management",
    fuelManagement: "Fuel Management",

    // Inventory Submenu
    slitFilm: "Slit / Film",
    slitInboundOutbound: "Inbound / Outbound",
    movementHistory: "Movement History",
    rmSteelSheet: "RM - Steel Sheet",
    coilManagement: "Coil Management",
    adminWorkforce: "Admin & Workforce",

    // Subtitles
    transportSubtitle: "Internal material movements, trip manifests and route checkpoints",
    fixFlushSubtitle: "Fleet maintenance, hydraulic line flushing, overhaul schedules and inspection clearance",
    preStartSubtitle: "Daily forklift and heavy machinery safety checklists before operation",
    vehiclesSubtitle: "Fleet asset configuration, operational status and driver allocation",
    employeesSubtitle: "Material Handling workforce roster, operator roles and dispatch eligibility",
    fuelSubtitle: "Fleet diesel issue records, dispenser stock monitoring and fuel consumption",
    slitSubtitle: "Slit steel inventory and transactions",
    rmSubtitle: "Raw material inventory management",
    coilSubtitle: "Coil inventory and production supply",
    adminSubtitle: "Attendance, leave and overtime management",
    dashboardSubtitle: "Warehouse operations, stock holding and equipment monitoring",

    // Action Buttons
    printExport: "Print / Export",
    quickAddMaterial: "+ Quick Add Material",
    newEntry: "+ New Entry",
    resetFilters: "Reset Filters",
    searchPlaceholder: "Search code, description, location...",
    allStatuses: "All Statuses",
    printLog: "Print Log",
    viewAllModules: "View All Modules →",
    close: "Close",
    deleteRecord: "Delete Record",
    saveEntry: "Save Entry",
    cancel: "Cancel",

    // Column Headers
    colMaterialCode: "Material Code",
    colMaterialDesc: "Material Description",
    colStorageLocation: "Storage Location",
    colStockQty: "Stock Qty",
    colUom: "UOM",
    colStatus: "Status",
    colFleetId: "Fleet ID",
    colMaintenanceAction: "Maintenance & Flush Action",
    colWorkshopBay: "Workshop Bay",
    colOperatingHours: "Operating Hours",
    colUnit: "Unit",
    colVehicleId: "Vehicle ID",
    colVehicleDesc: "Vehicle Description",
    colDispenserStation: "Dispenser Station",
    colFuelStockUsage: "Fuel Stock / Usage",
    colEmployeeId: "Employee ID",
    colEmployeeName: "Employee Name",
    colDepartment: "Department",
    colWorkingHours: "Working Hours",

    // KPI
    kpiInventoryRecords: "Inventory Records",
    kpiActiveWarehouseRecords: "Active warehouse records",
    kpiRecordedSteelStock: "Recorded Steel Stock",
    kpiTonTotalInventory: "TON · Total physical inventory",
    kpiTransactionsToday: "Transactions (Today)",
    kpiMovementLogActivities: "Movement & log activities",
    kpiPendingActions: "Pending Actions",
    kpiPendingAttentionRequired: "Pending & Attention required",
    kpiTotalRecords: "Total Records",
    kpiTotalRecordsModule: "Total records in this module",
    kpiAvailableActive: "Available / Active",
    kpiReadyForOperations: "Ready for production & operations",
    kpiPendingAttention: "Pending / Attention",
    kpiRequiresAttention: "Requires operator attention",
    kpiDisplayedRecords: "Displayed Records",
    kpiFilteredMatchCount: "Filtered match count",

    // Overview Panels
    warehouseSectionOverview: "Warehouse Section Overview",
    operationalCapacityMetrics: "Operational capacity and key metrics",
    interactiveOverviewNote: "Interactive overview: Click any section row above to jump directly into the respective module.",
    categoryInventorySpace: "Inventory & Space Utilization",
    categoryInventorySpaceSub: "Stock volume, storage bay capacity & space utilization metrics for Warehouse 1",
    categoryFleetWorkforce: "Fleet & Workforce Operations",
    categoryFleetWorkforceSub: "Forklift fleet availability, workforce attendance & active shift tracking",
    cardCoilTitle: "Coil Management",
    cardSlitTitle: "Slit / Film",
    cardRmTitle: "RM - Steel Sheet",
    cardMaterialHandlingTitle: "Material Handling & Fleet",
    cardAdminWorkforceTitle: "Admin & Workforce",
    totalStockTonLabel: "Total Stock",
    coilUnitsLabel: "Coil Units",
    rollUnitsLabel: "Roll / Slit Units",
    spaceUtilizationLabel: "Bay Space Utilization",
    readyToDispatchLabel: "Ready to Dispatch",
    stockAuditStatusLabel: "Stock Audit Status",
    stockByGradeLabel: "Stock by Grade",
    outOfStockWarning: "Out of Stock Alert",
    noOutOfStock: "Normal Stock Level (No OOS)",
    fleetReadyRateLabel: "Fleet Readiness Rate",
    dailyPrestartResultLabel: "Daily Pre-Start Checks",
    individualForkliftStatusLabel: "Forklift Fleet Unit Status",
    dailyAttendanceRateLabel: "Daily Attendance Rate",
    onDutyVsTargetLabel: "On-Duty Actual / Shift Target",
    currentShiftLabel: "Current Shift",
    forkliftDriversLabel: "Forklift & Tugger Drivers",
    warehouseStaffLabel: "Warehouse & QA Operators",
    supervisorsLabel: "Supervisors & Managers",
    viewModuleDetail: "View Section Details →",
    actionRequired: "Action Required",
    itemsRequiringFollowup: "Items requiring immediate follow-up",
    recentTransactions: "Recent Warehouse Transactions",
    recentTransactionsSubtitle: "Real-time log across inbound, outbound and maintenance",
    inventorySnapshot: "Warehouse Inventory Snapshot",
    inventorySnapshotSubtitle: "Real-time overview of Slit, Raw Material, and Steel Coils",
    dataManagement: "Data Management",
    showingRecords: "Showing {count} of {total} records · Click any row to inspect details.",
    updatedRealtime: "Updated in real-time",
    noMatchingRecords: "No matching records found",
    noTransactionsRecorded: "No transactions recorded",
    operationalNotice: "Operational Notice:",
    operationalNoticeBody: "Items added during this session are retained in active session memory. Real-time updates reflect instantly across the executive dashboard and transactions log.",

    // Modal & Details
    recordDetailsInspection: "Record Details & Inspection",
    recordId: "Record ID",
    moduleLabel: "Module",
    codeIdLabel: "Code / ID",
    descriptionLabel: "Description / Item Name",
    locationDeptLabel: "Storage Location / Department",
    qtyMeasuredLabel: "Quantity / Measured Amount",
    statusLabel: "Status",
    lastActivityTime: "Last Activity Time",
    createNewEntry: "Create New Entry",
    codeFieldLabel: "Vehicle ID / Material Code / Employee ID",
    descFieldLabel: "Description / Specification",
    locationFieldLabel: "Storage Location / Department",
    qtyFieldLabel: "Quantity / Level / Hours",
    uomFieldLabel: "Unit of Measure (UOM)",
    statusFieldLabel: "Operational Status",
    errorRequiredCode: "Please specify Code or ID",
    errorRequiredName: "Please specify Name or Description",
    errorRequiredLocation: "Please specify Location",
    errorRequiredQty: "Please enter a valid number (0 or greater)",
    recordCreatedToast: "Recorded successfully:",
    recordRemovedToast: "Removed record:",
    footerText: "TMT WMS Prototype · Warehouse 1 Management System · Internal Design Review",

    // Material Handling Notice Banner
    dailyAssignmentTitle: "Daily Driver & Vehicle Assignment System",
    dailyAssignmentDesc: "Dispatch fleet tuggers and forklifts to licensed operators with conflict validation and audit tracking.",
    employeeRosterBtn: "Employee Roster ➔",
    fleetVehiclesBtn: "Fleet Vehicles ➔",
    dailyAssignmentBtn: "Daily Vehicle Assignment ➔",
  },
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: keyof Translations, params?: Record<string, string | number>) => string;
  translations: Translations;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "wms_app_language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "th") {
        return saved;
      }
    } catch {
      // Fallback
    }
    return "th"; // Default to Thai as requested
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage unavailable
    }
  };

  const toggleLanguage = () => {
    setLanguage(language === "th" ? "en" : "th");
  };

  const t = (key: keyof Translations, params?: Record<string, string | number>): string => {
    const currentTranslations = TRANSLATIONS[language] || TRANSLATIONS.th;
    let str = currentTranslations[key] || TRANSLATIONS.en[key] || String(key);
    if (params) {
      Object.entries(params).forEach(([paramKey, paramVal]) => {
        str = str.replace(`{${paramKey}}`, String(paramVal));
      });
    }
    return str;
  };

  const value: LanguageContextValue = {
    language,
    setLanguage,
    toggleLanguage,
    t,
    translations: TRANSLATIONS[language] || TRANSLATIONS.th,
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
