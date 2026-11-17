/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Employee, WmsSectionId } from "../types/officer";
import { useAuth } from "../contexts/AuthContext";
import {
  getSectionMeta,
  resolveEmployeeAllowedSections,
  WMS_SECTIONS,
} from "../utils/sectionPermissions";

interface LoginGateModalProps {
  employees: Employee[];
  onLoginSuccess?: (landingMenu: string) => void;
}

export function LoginGateModal({
  employees,
  onLoginSuccess,
}: LoginGateModalProps) {
  const {
    currentUser,
    hasActiveAdmin,
    isSwitchModalOpen,
    closeSwitchUserModal,
    loginWithEmployeeId,
    bootstrapFirstAdmin,
    grantInitialAdminAccess,
    logout,
  } = useAuth();

  const isVisible = !currentUser || isSwitchModalOpen;
  const isSwitchMode = Boolean(currentUser && isSwitchModalOpen);
  const isRosterEmptyBootstrap = !currentUser && employees.length === 0;

  const [selectedSection, setSelectedSection] = useState<WmsSectionId | "all">("all");
  const [employeeIdInput, setEmployeeIdInput] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initial Admin & HR setup state (only available when !hasActiveAdmin)
  const [showAdminSetupView, setShowAdminSetupView] = useState<boolean>(false);
  const [adminSetupTab, setAdminSetupTab] = useState<"create_new" | "promote_existing">("create_new");
  const [adminId, setAdminId] = useState<string>("ADM-001");
  const [adminName, setAdminName] = useState<string>("");
  const [adminPhone, setAdminPhone] = useState<string>("");
  const [promoteEmployeeId, setPromoteEmployeeId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.employmentStatus === "Active"),
    [employees]
  );

  useEffect(() => {
    if (isVisible) {
      setErrorMsg(null);
      setEmployeeIdInput("");
      setShowAdminSetupView(false);
      if (activeEmployees.length > 0 && !promoteEmployeeId) {
        setPromoteEmployeeId(activeEmployees[0].employeeId);
      }
      setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
    }
  }, [isVisible, isSwitchMode, activeEmployees, promoteEmployeeId]);

  useEffect(() => {
    if (hasActiveAdmin && showAdminSetupView) {
      setShowAdminSetupView(false);
    }
  }, [hasActiveAdmin, showAdminSetupView]);

  const activeEmployeesInSectionCount = useMemo(() => {
    if (selectedSection === "all") return activeEmployees.length;
    return activeEmployees.filter((e) =>
      resolveEmployeeAllowedSections(e).includes(selectedSection)
    ).length;
  }, [activeEmployees, selectedSection]);

  const liveMatchedEmployee = useMemo(() => {
    const norm = employeeIdInput.trim().toUpperCase();
    if (!norm) return null;
    return (
      employees.find((e) => e.employeeId.trim().toUpperCase() === norm) || null
    );
  }, [employees, employeeIdInput]);

  const liveMatchedSections = useMemo(() => {
    if (!liveMatchedEmployee) return [];
    return resolveEmployeeAllowedSections(liveMatchedEmployee);
  }, [liveMatchedEmployee]);

  const liveSectionAuthorized = useMemo(() => {
    if (!liveMatchedEmployee) return false;
    if (liveMatchedEmployee.employmentStatus !== "Active") return false;
    if (selectedSection === "all") return true;
    return liveMatchedSections.includes(selectedSection);
  }, [liveMatchedEmployee, liveMatchedSections, selectedSection]);

  if (!isVisible) return null;

  const isInSetupFlow = isRosterEmptyBootstrap || (!hasActiveAdmin && showAdminSetupView);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const res = loginWithEmployeeId(employeeIdInput, selectedSection);
    if (!res.success) {
      setErrorMsg(res.error || "ไม่สามารถเข้าสู่ระบบได้");
      inputRef.current?.focus();
      return;
    }

    setEmployeeIdInput("");
    if (res.landingMenu && onLoginSuccess) {
      onLoginSuccess(res.landingMenu);
    }
  };

  const handleBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await bootstrapFirstAdmin({
        employeeId: adminId,
        employeeName: adminName,
        phoneNumber: adminPhone,
      });
      if (!res.success) {
        setErrorMsg(res.error || "ไม่สามารถสร้างผู้ดูแลระบบได้");
        return;
      }
      setShowAdminSetupView(false);
      if (res.landingMenu && onLoginSuccess) {
        onLoginSuccess(res.landingMenu);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePromoteExistingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await grantInitialAdminAccess(promoteEmployeeId);
      if (!res.success) {
        setErrorMsg(res.error || "ไม่สามารถมอบสิทธิ์ Admin & HR ได้");
        return;
      }
      setShowAdminSetupView(false);
      if (res.landingMenu && onLoginSuccess) {
        onLoginSuccess(res.landingMenu);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={
        isSwitchMode
          ? "สลับผู้ใช้งานระบบ WMS"
          : "เข้าสู่ระบบคลังสินค้า TMT WMS"
      }
      onMouseDown={() => {
        if (isSwitchMode) closeSwitchUserModal();
      }}
    >
      <div
        className="w-full max-w-[460px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1e3a5f] dark:bg-[#0f172a]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Top Header Band */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-[#1e3a5f] dark:bg-[#0b1329]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
              {isInSetupFlow ? (
                <ShieldCheck size={20} />
              ) : (
                <KeyRound size={20} />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                {isInSetupFlow
                  ? "ตั้งค่าผู้ดูแลงานบริหารและกำลังพล (Admin & HR)"
                  : isSwitchMode
                  ? "สลับผู้ใช้งานตามส่วนงาน"
                  : "เข้าสู่ระบบ TMT WMS Warehouse 1"}
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {isInSetupFlow
                  ? "ปลดล็อกเมนูงานบริหารและกำลังพลเพื่อจัดการพนักงานทุกส่วนงาน"
                  : "ยืนยันตัวตนด้วยรหัสพนักงานจากฐานข้อมูลงานบริหารและกำลังพล"}
              </div>
            </div>
          </div>
          {isSwitchMode && (
            <button
              type="button"
              onClick={closeSwitchUserModal}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="ปิดหน้าต่าง"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Currently Logged-in Summary when in Switch User Mode */}
          {isSwitchMode && currentUser && !showAdminSetupView && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-[#1e3a5f] dark:bg-[#111e38]">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  ผู้ใช้งานปัจจุบัน
                </div>
                <div className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                  <span className="font-mono text-sky-600 dark:text-sky-400">
                    {currentUser.employeeId}
                  </span>{" "}
                  · {currentUser.employeeName}
                </div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {currentUser.department} · {currentUser.role}
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 dark:border-rose-800/70 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-900/60"
              >
                <LogOut size={13} />
                <span>ออกจากระบบ</span>
              </button>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
              <span className="font-medium leading-relaxed">{errorMsg}</span>
            </div>
          )}

          {isInSetupFlow ? (
            <div className="space-y-3.5">
              {!isRosterEmptyBootstrap && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setShowAdminSetupView(false);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:underline dark:text-sky-400"
                >
                  <ArrowLeft size={14} />
                  <span>กลับไปหน้าล็อกอินด้วยรหัสพนักงาน</span>
                </button>
              )}

              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
                {isRosterEmptyBootstrap ? (
                  <>
                    ยังไม่มีรายชื่อพนักงานในเมนู <strong>งานบริหารและกำลังพล</strong> กรุณาสร้างผู้ดูแลระบบคนแรกเพื่อเริ่มใช้งาน
                  </>
                ) : (
                  <>
                    ขณะนี้มีพนักงานเฉพาะส่วนงานปฏิบัติการ ({employees.length} คน) ยังไม่มีผู้ดูแลที่มีสิทธิ์เข้าเมนู{" "}
                    <strong>งานบริหารและกำลังพล (Admin & HR)</strong> กรุณาสร้างรหัสผู้ดูแลหรือมอบสิทธิ์ให้พนักงานที่มีอยู่
                  </>
                )}
              </div>

              {/* Choice Tabs when existing employees are already present */}
              {!isRosterEmptyBootstrap && activeEmployees.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1 dark:bg-[#0b1329]">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setAdminSetupTab("create_new");
                    }}
                    className={`rounded-md px-2.5 py-2 text-xs font-bold transition ${
                      adminSetupTab === "create_new"
                        ? "bg-white text-sky-700 shadow-xs dark:bg-[#162749] dark:text-sky-300"
                        : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    สร้างรหัส Admin ใหม่
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setAdminSetupTab("promote_existing");
                    }}
                    className={`rounded-md px-2.5 py-2 text-xs font-bold transition ${
                      adminSetupTab === "promote_existing"
                        ? "bg-white text-sky-700 shadow-xs dark:bg-[#162749] dark:text-sky-300"
                        : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    ใช้พนักงานที่มีอยู่แล้ว
                  </button>
                </div>
              )}

              {adminSetupTab === "promote_existing" && !isRosterEmptyBootstrap && activeEmployees.length > 0 ? (
                <form onSubmit={handlePromoteExistingSubmit} className="space-y-3.5">
                  <div>
                    <label
                      htmlFor="promote-admin-select"
                      className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      เลือกพนักงานที่จะได้รับสิทธิ์ Admin & HR (เข้าใช้ได้ทุกส่วนงาน) *
                    </label>
                    <select
                      id="promote-admin-select"
                      value={promoteEmployeeId}
                      onChange={(e) => setPromoteEmployeeId(e.target.value)}
                      required
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                    >
                      {activeEmployees.map((emp) => (
                        <option key={emp.employeeId} value={emp.employeeId}>
                          {emp.employeeId} · {emp.employeeName} ({emp.role} · {emp.department})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-60"
                  >
                    <ShieldCheck size={16} />
                    <span>
                      {isSubmitting
                        ? "กำลังอัปเดตสิทธิ์..."
                        : "มอบสิทธิ์ Admin & HR และเข้าหน้าจัดการพนักงาน"}
                    </span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleBootstrapSubmit} className="space-y-3.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      รหัสพนักงานผู้ดูแล (Employee ID) *
                    </label>
                    <input
                      ref={inputRef}
                      type="text"
                      value={adminId}
                      onChange={(e) => setAdminId(e.target.value.toUpperCase())}
                      placeholder="เช่น ADM-001"
                      required
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 font-mono text-sm font-bold uppercase text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      ชื่อ-นามสกุลผู้ดูแล (Full Name) *
                    </label>
                    <input
                      type="text"
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="เช่น สมชาย ใจดี (หัวหน้าคลัง)"
                      required
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      เบอร์โทรศัพท์ (ไม่บังคับ)
                    </label>
                    <input
                      type="text"
                      value={adminPhone}
                      onChange={(e) => setAdminPhone(e.target.value)}
                      placeholder="เช่น 081-234-5678"
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-60"
                  >
                    <ShieldCheck size={16} />
                    <span>
                      {isSubmitting
                        ? "กำลังบันทึกผู้ดูแลระบบ..."
                        : "สร้างผู้ดูแลและเปิดหน้างานบริหารและกำลังพล"}
                    </span>
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* Fast Employee ID + Section Filter Login Form */
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="login-section-select"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    เลือกส่วนงานที่เข้าปฏิบัติงาน
                  </label>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <Users size={12} />
                    พร้อมใช้งาน {activeEmployeesInSectionCount} คน
                  </span>
                </div>
                <select
                  id="login-section-select"
                  value={selectedSection}
                  onChange={(e) => {
                    setSelectedSection(e.target.value as WmsSectionId | "all");
                    setErrorMsg(null);
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                >
                  <option value="all">
                    เข้าสู่ระบบตามสิทธิ์ส่วนงานทั้งหมดของพนักงาน
                  </option>
                  {WMS_SECTIONS.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.labelTh}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="login-employee-id-input"
                  className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  รหัสพนักงาน (Employee ID) *
                </label>
                <input
                  id="login-employee-id-input"
                  ref={inputRef}
                  type="text"
                  value={employeeIdInput}
                  onChange={(e) => {
                    setEmployeeIdInput(e.target.value.toUpperCase());
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="พิมพ์หรือสแกนรหัสพนักงาน เช่น EMP-001"
                  autoComplete="off"
                  required
                  className="h-12 w-full rounded-lg border border-slate-300 bg-white px-4 font-mono text-base font-bold uppercase tracking-wider text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-[#1e3a5f] dark:bg-[#0b1329] dark:text-slate-100"
                />
              </div>

              {/* Instant Verification Preview Card */}
              {liveMatchedEmployee ? (
                <div
                  className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                    liveSectionAuthorized
                      ? "border-emerald-300 bg-emerald-50/70 text-emerald-950 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-100"
                      : "border-amber-300 bg-amber-50/70 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {liveSectionAuthorized ? (
                        <CheckCircle2
                          size={15}
                          className="shrink-0 text-emerald-600 dark:text-emerald-400"
                        />
                      ) : (
                        <AlertTriangle
                          size={15}
                          className="shrink-0 text-amber-600 dark:text-amber-400"
                        />
                      )}
                      <span className="truncate font-bold">
                        {liveMatchedEmployee.employeeName}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] font-semibold opacity-80">
                      {liveMatchedEmployee.role}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] opacity-80">
                    {liveMatchedEmployee.department} ·{" "}
                    {liveMatchedSections
                      .map((id) => getSectionMeta(id).shortLabelTh)
                      .join(", ")}
                  </div>
                  {liveMatchedEmployee.employmentStatus !== "Active" && (
                    <div className="mt-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                      สถานะพนักงาน: Inactive (ไม่อนุญาตให้เข้าใช้งาน)
                    </div>
                  )}
                  {liveMatchedEmployee.employmentStatus === "Active" &&
                    selectedSection !== "all" &&
                    !liveMatchedSections.includes(selectedSection) && (
                      <div className="mt-1 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                        รหัสพนักงานนี้ไม่ได้รับสิทธิ์ในส่วนงาน{" "}
                        {getSectionMeta(selectedSection).shortLabelTh}
                      </div>
                    )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-3.5 py-2 text-[11px] text-slate-500 dark:border-[#1e3a5f] dark:text-slate-400">
                  ดึงรายชื่อและสิทธิ์ส่วนงานจากฐานข้อมูลกลาง{" "}
                  <strong>งานบริหารและกำลังพล</strong> แบบ Real-time
                </div>
              )}

              {/* Recovery setup option ONLY when zero active employees have admin_hr permission */}
              {!hasActiveAdmin && (
                <div className="flex items-center justify-between gap-2.5 rounded-lg border border-amber-300 bg-amber-50/90 px-3.5 py-2.5 text-xs text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="min-w-0">
                    <div className="font-bold">
                      ยังไม่มีผู้ดูแลงานบริหารและกำลังพล (Admin & HR)
                    </div>
                    <div className="text-[11px] opacity-85">
                      ตั้งค่าผู้ดูแลคนแรกเพื่อปลดล็อกเมนูเพิ่มพนักงานทุกส่วนงาน
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setShowAdminSetupView(true);
                    }}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-amber-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-700"
                  >
                    <UserPlus size={13} />
                    <span>ตั้งค่า Admin</span>
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                {isSwitchMode && (
                  <button
                    type="button"
                    onClick={closeSwitchUserModal}
                    className="h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-[#1e3a5f] dark:bg-[#111e38] dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    ยกเลิก
                  </button>
                )}
                <button
                  type="submit"
                  className="flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-sky-600 px-4 text-sm font-bold text-white transition hover:bg-sky-700"
                >
                  <UserCheck size={16} />
                  <span>
                    {isSwitchMode ? "สลับผู้ใช้งาน" : "เข้าสู่ระบบ WMS"}
                  </span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
