/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Employee,
  WmsActivityLogRecord,
  WmsSectionId,
  WmsSessionUser,
} from "../types/officer";
import {
  appendWmsActivityLog,
  formatLocalTimestamp,
  getActiveWmsSessionUser,
  LogActivityInput,
  saveWmsEmployeeToCloud,
  setActiveWmsSessionUser,
} from "../services/authWorkforceService";
import {
  ALL_WMS_SECTION_IDS,
  canAccessMenu,
  getDefaultMenuForSections,
  getSectionMeta,
  resolveEmployeeAllowedSections,
} from "../utils/sectionPermissions";

export interface LoginAttemptResult {
  success: boolean;
  error?: string;
  user?: WmsSessionUser;
  landingMenu?: string;
}

interface AuthContextValue {
  currentUser: WmsSessionUser | null;
  hasActiveAdmin: boolean;
  isSwitchModalOpen: boolean;
  openSwitchUserModal: () => void;
  closeSwitchUserModal: () => void;
  loginWithEmployeeId: (
    employeeIdInput: string,
    selectedSection?: WmsSectionId | "all"
  ) => LoginAttemptResult;
  bootstrapFirstAdmin: (params: {
    employeeId: string;
    employeeName: string;
    phoneNumber?: string;
  }) => Promise<LoginAttemptResult>;
  grantInitialAdminAccess: (employeeIdInput: string) => Promise<LoginAttemptResult>;
  logout: () => void;
  canAccessMenu: (menuId: string) => boolean;
  getDefaultMenu: (preferredSection?: WmsSectionId | "all") => string;
  recordActivity: (input: LogActivityInput) => Promise<WmsActivityLogRecord>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  employees: Employee[];
  onRegisterBootstrapEmployee: (emp: Employee) => void;
  onSessionNotice?: (msg: string) => void;
  children: React.ReactNode;
}

export function AuthProvider({
  employees,
  onRegisterBootstrapEmployee,
  onSessionNotice,
  children,
}: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<WmsSessionUser | null>(() =>
    getActiveWmsSessionUser()
  );
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState<boolean>(false);

  const hasActiveAdmin = useMemo(
    () =>
      employees.some(
        (e) =>
          e.employmentStatus === "Active" &&
          resolveEmployeeAllowedSections(e).includes("admin_hr")
      ),
    [employees]
  );

  // Sync active session against live employeeRoster changes (permission edits or deactivation)
  useEffect(() => {
    if (!currentUser) return;
    if (employees.length === 0) return;

    const matched = employees.find(
      (e) => e.employeeId.trim().toUpperCase() === currentUser.employeeId.trim().toUpperCase()
    );

    if (!matched) {
      return;
    }

    if (matched.employmentStatus !== "Active") {
      setActiveWmsSessionUser(null);
      setCurrentUser(null);
      setIsSwitchModalOpen(false);
      onSessionNotice?.(
        `บัญชีพนักงาน ${matched.employeeId} (${matched.employeeName}) ถูกระงับการใช้งาน`
      );
      return;
    }

    const latestSections = resolveEmployeeAllowedSections(matched);
    const sameSections =
      latestSections.length === currentUser.allowedSections.length &&
      latestSections.every((s, idx) => s === currentUser.allowedSections[idx]);

    if (
      !sameSections ||
      matched.employeeName !== currentUser.employeeName ||
      matched.department !== currentUser.department ||
      matched.jobPosition !== currentUser.jobPosition ||
      matched.role !== currentUser.role
    ) {
      const refreshed: WmsSessionUser = {
        ...currentUser,
        employeeName: matched.employeeName,
        department: matched.department,
        jobPosition: matched.jobPosition,
        role: matched.role,
        allowedSections: latestSections,
      };
      setActiveWmsSessionUser(refreshed);
      setCurrentUser(refreshed);
    }
  }, [employees, currentUser, onSessionNotice]);

  const loginWithEmployeeId = useCallback(
    (
      employeeIdInput: string,
      selectedSection: WmsSectionId | "all" = "all"
    ): LoginAttemptResult => {
      const normalizedId = employeeIdInput.trim().toUpperCase();
      if (!normalizedId) {
        return {
          success: false,
          error: "กรุณากรอกรหัสพนักงานก่อนเข้าสู่ระบบ",
        };
      }

      const matched = employees.find(
        (e) => e.employeeId.trim().toUpperCase() === normalizedId
      );

      if (!matched) {
        return {
          success: false,
          error: `ไม่พบรหัสพนักงาน "${normalizedId}" ในฐานข้อมูลงานบริหารและกำลังพล`,
        };
      }

      if (matched.employmentStatus !== "Active") {
        return {
          success: false,
          error: `พนักงาน ${matched.employeeId} (${matched.employeeName}) มีสถานะ Inactive ไม่สามารถเข้าใช้งานได้`,
        };
      }

      const allowedSections = resolveEmployeeAllowedSections(matched);
      if (
        selectedSection !== "all" &&
        !allowedSections.includes(selectedSection)
      ) {
        const targetMeta = getSectionMeta(selectedSection);
        return {
          success: false,
          error: `รหัสพนักงาน ${matched.employeeId} (${matched.employeeName}) ไม่มีสิทธิ์เข้าใช้งานส่วนงาน "${targetMeta.shortLabelTh}"`,
        };
      }

      const { timestamp } = formatLocalTimestamp();
      const sessionUser: WmsSessionUser = {
        employeeId: matched.employeeId.trim().toUpperCase(),
        employeeName: matched.employeeName.trim(),
        department: matched.department,
        jobPosition: matched.jobPosition,
        role: matched.role,
        allowedSections,
        loginSection: selectedSection,
        loggedInAt: timestamp,
      };

      setActiveWmsSessionUser(sessionUser);
      setCurrentUser(sessionUser);
      setIsSwitchModalOpen(false);

      const landingMenu = getDefaultMenuForSections(allowedSections, selectedSection);

      void appendWmsActivityLog({
        module: "System Auth",
        sectionId: selectedSection !== "all" ? selectedSection : allowedSections[0] || "overview",
        reference: sessionUser.employeeId,
        activity: `เข้าสู่ระบบ (${sessionUser.employeeName} · ${
          selectedSection === "all"
            ? "ทุกส่วนงานตามสิทธิ์"
            : getSectionMeta(selectedSection).shortLabelTh
        })`,
        status: "Completed",
        userOverride: sessionUser,
      });

      return {
        success: true,
        user: sessionUser,
        landingMenu,
      };
    },
    [employees]
  );

  const bootstrapFirstAdmin = useCallback(
    async (params: {
      employeeId: string;
      employeeName: string;
      phoneNumber?: string;
    }): Promise<LoginAttemptResult> => {
      if (hasActiveAdmin) {
        return {
          success: false,
          error:
            "ระบบมีผู้ดูแลงานบริหารและกำลังพลอยู่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผู้ดูแลที่มีอยู่",
        };
      }

      const normalizedId = params.employeeId.trim().toUpperCase();
      const trimmedName = params.employeeName.trim();

      if (!normalizedId || !trimmedName) {
        return {
          success: false,
          error: "กรุณากรอกทั้งรหัสพนักงานและชื่อ-นามสกุลผู้ดูแลระบบ",
        };
      }

      const duplicate = employees.some(
        (e) => e.employeeId.trim().toUpperCase() === normalizedId
      );
      if (duplicate) {
        return {
          success: false,
          error: `รหัสพนักงาน "${normalizedId}" มีอยู่ในระบบแล้ว กรุณาใช้รหัสใหม่ หรือเลือกมอบสิทธิ์ให้พนักงานที่มีอยู่`,
        };
      }

      const { timestamp } = formatLocalTimestamp();
      const newAdmin: Employee = {
        id: normalizedId,
        employeeId: normalizedId,
        employeeName: trimmedName,
        department: "Admin & Workforce",
        jobPosition: "System Administrator / HR Manager",
        role: "Manager",
        phoneNumber: params.phoneNumber?.trim() || "",
        employmentStatus: "Active",
        allowedSections: [...ALL_WMS_SECTION_IDS],
        notes: "Initial Admin & HR account created during setup",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      onRegisterBootstrapEmployee(newAdmin);
      await saveWmsEmployeeToCloud(newAdmin);

      const sessionUser: WmsSessionUser = {
        employeeId: newAdmin.employeeId,
        employeeName: newAdmin.employeeName,
        department: newAdmin.department,
        jobPosition: newAdmin.jobPosition,
        role: newAdmin.role,
        allowedSections: [...ALL_WMS_SECTION_IDS],
        loginSection: "all",
        loggedInAt: timestamp,
      };

      setActiveWmsSessionUser(sessionUser);
      setCurrentUser(sessionUser);
      setIsSwitchModalOpen(false);

      await appendWmsActivityLog({
        module: "Admin & Workforce",
        sectionId: "admin_hr",
        reference: newAdmin.employeeId,
        activity: `ลงทะเบียนผู้ดูแลระบบเริ่มต้น (${newAdmin.employeeName}) และเข้าสู่ระบบ`,
        status: "Completed",
        userOverride: sessionUser,
      });

      return {
        success: true,
        user: sessionUser,
        landingMenu: "admin",
      };
    },
    [employees, hasActiveAdmin, onRegisterBootstrapEmployee]
  );

  const grantInitialAdminAccess = useCallback(
    async (employeeIdInput: string): Promise<LoginAttemptResult> => {
      if (hasActiveAdmin) {
        return {
          success: false,
          error:
            "ระบบมีผู้ดูแลงานบริหารและกำลังพลอยู่แล้ว ไม่สามารถมอบสิทธิ์จากหน้าล็อกอินซ้ำได้",
        };
      }

      const normalizedId = employeeIdInput.trim().toUpperCase();
      if (!normalizedId) {
        return {
          success: false,
          error: "กรุณาเลือกหรือกรอกรหัสพนักงานที่ต้องการมอบสิทธิ์ Admin & HR",
        };
      }

      const matched = employees.find(
        (e) => e.employeeId.trim().toUpperCase() === normalizedId
      );
      if (!matched) {
        return {
          success: false,
          error: `ไม่พบรหัสพนักงาน "${normalizedId}" ในระบบ`,
        };
      }

      if (matched.employmentStatus !== "Active") {
        return {
          success: false,
          error: `พนักงาน ${matched.employeeId} (${matched.employeeName}) มีสถานะ Inactive ไม่สามารถตั้งเป็นผู้ดูแลระบบได้`,
        };
      }

      const { timestamp } = formatLocalTimestamp();
      const updatedEmp: Employee = {
        ...matched,
        allowedSections: [...ALL_WMS_SECTION_IDS],
        updatedAt: timestamp,
      };

      onRegisterBootstrapEmployee(updatedEmp);
      await saveWmsEmployeeToCloud(updatedEmp);

      const sessionUser: WmsSessionUser = {
        employeeId: updatedEmp.employeeId.trim().toUpperCase(),
        employeeName: updatedEmp.employeeName.trim(),
        department: updatedEmp.department,
        jobPosition: updatedEmp.jobPosition,
        role: updatedEmp.role,
        allowedSections: [...ALL_WMS_SECTION_IDS],
        loginSection: "all",
        loggedInAt: timestamp,
      };

      setActiveWmsSessionUser(sessionUser);
      setCurrentUser(sessionUser);
      setIsSwitchModalOpen(false);

      await appendWmsActivityLog({
        module: "Admin & Workforce",
        sectionId: "admin_hr",
        reference: sessionUser.employeeId,
        activity: `มอบสิทธิ์ผู้ดูแลงานบริหารและกำลังพลเริ่มต้นให้ ${sessionUser.employeeId} (${sessionUser.employeeName})`,
        status: "Completed",
        userOverride: sessionUser,
      });

      return {
        success: true,
        user: sessionUser,
        landingMenu: "admin",
      };
    },
    [employees, hasActiveAdmin, onRegisterBootstrapEmployee]
  );

  const logout = useCallback(() => {
    const prev = currentUser;
    if (prev) {
      void appendWmsActivityLog({
        module: "System Auth",
        sectionId: prev.allowedSections[0] || "overview",
        reference: prev.employeeId,
        activity: `ออกจากระบบ (${prev.employeeName})`,
        status: "Completed",
        userOverride: prev,
      });
    }
    setActiveWmsSessionUser(null);
    setCurrentUser(null);
    setIsSwitchModalOpen(false);
  }, [currentUser]);

  const checkMenuAccess = useCallback(
    (menuId: string): boolean => {
      if (!currentUser) return false;
      return canAccessMenu(currentUser.allowedSections, menuId);
    },
    [currentUser]
  );

  const getDefaultMenu = useCallback(
    (preferredSection?: WmsSectionId | "all"): string => {
      if (!currentUser) return "dashboard";
      return getDefaultMenuForSections(
        currentUser.allowedSections,
        preferredSection ?? currentUser.loginSection
      );
    },
    [currentUser]
  );

  const recordActivity = useCallback(
    (input: LogActivityInput) => {
      return appendWmsActivityLog(input);
    },
    []
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      hasActiveAdmin,
      isSwitchModalOpen,
      openSwitchUserModal: () => setIsSwitchModalOpen(true),
      closeSwitchUserModal: () => setIsSwitchModalOpen(false),
      loginWithEmployeeId,
      bootstrapFirstAdmin,
      grantInitialAdminAccess,
      logout,
      canAccessMenu: checkMenuAccess,
      getDefaultMenu,
      recordActivity,
    }),
    [
      currentUser,
      hasActiveAdmin,
      isSwitchModalOpen,
      loginWithEmployeeId,
      bootstrapFirstAdmin,
      grantInitialAdminAccess,
      logout,
      checkMenuAccess,
      getDefaultMenu,
      recordActivity,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
