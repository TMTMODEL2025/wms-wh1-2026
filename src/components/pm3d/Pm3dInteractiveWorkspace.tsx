/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Edit2,
  FileWarning,
  Gauge,
  Hash,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Vehicle } from "../../types/officer";
import { getVehicleTypeDisplayLabel, resolveVehicleType } from "../../utils/vehicleHelpers";
import {
  MhMaintenanceRecord,
  MhPm3dModelType,
  MhPm3dSummary,
  MhPm3dZoneSnapshot,
  MhPmScheduleRecord,
  MhRepairPhotoItem,
  computeNextPmDate,
  fetchMhMaintenanceOnce,
  generateNextPmNo,
  generateNextRepairRequestNo,
  saveMhMaintenanceToCloud,
} from "../../services/forkliftDataService";
import {
  appendWmsActivityLog,
  getActiveRecorderDisplay,
} from "../../services/authWorkforceService";
import { useAuth } from "../../contexts/AuthContext";
import {
  CustomChecklistMap,
  DEFAULT_PM3D_ZONES,
  PM3D_MODELS,
  Pm3dChecklistTemplateItem,
  Pm3dItemStatus,
  Pm3dZoneDefinition,
  Pm3dZoneSessionData,
  compressPmPhotoFile,
  computeZoneAggregateStatus,
  getZoneChecklistItems,
  inferPm3dModelType,
  loadCustomPm3dChecklists,
  saveCustomPm3dChecklists,
} from "./pm3dChecklists";
import {
  COUPLED_TRAILER_OFFSET_Z,
  Pm3dRenderZone,
  Pm3dViewport,
} from "./Pm3dViewport";

interface Pm3dInteractiveWorkspaceProps {
  schedules: MhPmScheduleRecord[];
  vehicles: Vehicle[];
  selectedScheduleId: string | null;
  onSelectScheduleId: (scheduleId: string | null) => void;
  latestMileageByVehicle: Map<
    string,
    { mileageKm: number; inspectionDate: string; operatorName: string }
  >;
  onCompletePm3d: (payload: {
    schedule: MhPmScheduleRecord | null;
    vehicle: Vehicle | null;
    fallbackVehicleId: string;
    completedDate: string;
    performedBy: string;
    mileageKm?: number;
    operatingHours?: number;
    totalCost?: number;
    notes?: string;
    modelType: MhPm3dModelType;
    coupledTrailer: boolean;
    summary: MhPm3dSummary;
    linkedRepairNos: string[];
  }) => Promise<MhPmScheduleRecord>;
}

const CONTROL_STYLE: React.CSSProperties = {
  height: 35,
  minHeight: 35,
  fontSize: 12,
  fontWeight: 400,
  borderRadius: 6,
  padding: "6px 10px",
};

function getTodayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function createEmptyZoneSession(): Pm3dZoneSessionData {
  return {
    itemStatuses: {},
    notes: "",
    cost: "",
    photos: [],
  };
}

function formatShortVehicleCode(rawId: string | undefined, modelType: MhPm3dModelType): string {
  const defaultByModel: Record<MhPm3dModelType, string> = {
    diesel_tractor: "TT-01",
    ev_tractor: "EV-01",
    forklift: "FL-01",
    trailer: "TR-01",
  };
  const trimmed = String(rawId || "").trim();
  if (!trimmed || trimmed.toUpperCase() === "DEMO-MH-01") {
    return defaultByModel[modelType];
  }
  // Extract first compact registration token (e.g., "TT-01 (รถลากจูง)" -> "TT-01")
  const firstToken = trimmed.split(/[\s(·|/]+/)[0] || trimmed;
  const cleaned = firstToken.replace(/^[-:]+|[-:]+$/g, "").toUpperCase();
  if (!cleaned) return defaultByModel[modelType];
  return cleaned.slice(0, 10);
}

export function Pm3dInteractiveWorkspace({
  schedules,
  vehicles,
  selectedScheduleId,
  onSelectScheduleId,
  latestMileageByVehicle,
  onCompletePm3d,
}: Pm3dInteractiveWorkspaceProps) {
  const { currentUser } = useAuth();
  const todayYmd = getTodayYmd();

  // Active target selection (either a PM Schedule record OR a standalone fleet vehicle)
  const activeSchedule = useMemo(
    () => (selectedScheduleId ? schedules.find((s) => s.id === selectedScheduleId) || null : null),
    [schedules, selectedScheduleId]
  );

  const [standaloneVehicleId, setStandaloneVehicleId] = useState<string>(
    () => vehicles[0]?.vehicleId || ""
  );

  const activeVehicle = useMemo(() => {
    const vId = activeSchedule?.vehicleId || standaloneVehicleId;
    if (!vId) return null;
    return (
      vehicles.find((v) => v.vehicleId.trim().toUpperCase() === vId.trim().toUpperCase()) || null
    );
  }, [activeSchedule, standaloneVehicleId, vehicles]);

  const effectiveVehicleId =
    activeSchedule?.vehicleId || activeVehicle?.vehicleId || standaloneVehicleId || "DEMO-MH-01";

  // 3D Viewport States
  const [modelType, setModelType] = useState<MhPm3dModelType>(() =>
    inferPm3dModelType(
      activeSchedule?.vehicleType || activeVehicle?.vehicleType,
      activeSchedule?.vehicleDescription || activeVehicle?.description,
      effectiveVehicleId
    )
  );
  const [attachTrailer, setAttachTrailer] = useState<boolean>(false);
  const [isHoodOpen, setIsHoodOpen] = useState<boolean>(false);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  const shortVehicleCode = useMemo(
    () =>
      formatShortVehicleCode(
        activeSchedule?.vehicleId ||
          activeSchedule?.vehicleNumber ||
          activeVehicle?.vehicleId ||
          activeVehicle?.number ||
          standaloneVehicleId,
        modelType
      ),
    [activeSchedule, activeVehicle, standaloneVehicleId, modelType]
  );

  // Customizable checklists (persisted in localStorage)
  const [customChecklists, setCustomChecklists] = useState<CustomChecklistMap>(() =>
    loadCustomPm3dChecklists()
  );

  // Current 3D Inspection Session Data keyed by zoneId
  const [zoneSessions, setZoneSessions] = useState<Record<string, Pm3dZoneSessionData>>({});
  const [sessionMileageKm, setSessionMileageKm] = useState<string>("");
  const [sessionOperatingHours, setSessionOperatingHours] = useState<string>("");

  // Inline checklist add/edit states inside the hotspot modal
  const [newItemLabel, setNewItemLabel] = useState<string>("");
  const [newItemHint, setNewItemHint] = useState<string>("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState<string>("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState<boolean>(false);
  const [isCreatingRepair, setIsCreatingRepair] = useState<boolean>(false);

  // Complete PM 3D Summary Modal states
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState<boolean>(false);
  const [completeDate, setCompleteDate] = useState<string>(todayYmd);
  const [completePerformedBy, setCompletePerformedBy] = useState<string>(
    () => currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || "ทีมช่างซ่อมบำรุง"
  );
  const [completeNotes, setCompleteNotes] = useState<string>("");
  const [autoCreateRepairOnComplete, setAutoCreateRepairOnComplete] = useState<boolean>(true);
  const [isSubmittingComplete, setIsSubmittingComplete] = useState<boolean>(false);

  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Sync inferred model type & mileage/hours when selected schedule/vehicle changes
  useEffect(() => {
    const inferred = inferPm3dModelType(
      activeSchedule?.vehicleType || activeVehicle?.vehicleType,
      activeSchedule?.vehicleDescription || activeVehicle?.description,
      activeSchedule?.vehicleId || activeVehicle?.vehicleId || ""
    );
    setModelType(inferred);
    if (!PM3D_MODELS[inferred].supportsTrailerCoupling) {
      setAttachTrailer(false);
    }
    setActiveZoneId(null);
    setZoneSessions({});

    const vKey = String(activeSchedule?.vehicleId || activeVehicle?.vehicleId || "")
      .trim()
      .toUpperCase();
    const latestReading = latestMileageByVehicle.get(vKey);
    const initKm = latestReading?.mileageKm ?? activeSchedule?.currentMileageKm;
    setSessionMileageKm(initKm !== undefined ? String(initKm) : "");
    setSessionOperatingHours(
      activeSchedule?.currentHours !== undefined ? String(activeSchedule.currentHours) : ""
    );
    setCompletePerformedBy(
      currentUser?.employeeName ||
        getActiveRecorderDisplay("").employeeName ||
        activeSchedule?.responsibleTech ||
        "ทีมช่างซ่อมบำรุง"
    );
  }, [selectedScheduleId, standaloneVehicleId]);

  // Active zones list (Primary vehicle + coupled trailer zones if coupled!)
  const activeZones = useMemo<Pm3dRenderZone[]>(() => {
    const baseDefs: Array<{ def: Pm3dZoneDefinition; offsetZ: number }> = DEFAULT_PM3D_ZONES[
      modelType
    ].map((def) => ({ def, offsetZ: 0 }));

    const isCoupled = attachTrailer && PM3D_MODELS[modelType].supportsTrailerCoupling;
    if (isCoupled) {
      DEFAULT_PM3D_ZONES.trailer.forEach((def) => {
        baseDefs.push({ def, offsetZ: COUPLED_TRAILER_OFFSET_Z });
      });
    }

    return baseDefs.map(({ def, offsetZ }) => {
      const items = getZoneChecklistItems(def, customChecklists);
      const sess = zoneSessions[def.id];
      const status = computeZoneAggregateStatus(items, sess);
      const checkedCount = items.reduce((acc, it) => {
        const st = sess?.itemStatuses[it.id] || "pending";
        return acc + (st !== "pending" ? 1 : 0);
      }, 0);
      return {
        zone: def,
        status,
        worldOffsetZ: offsetZ,
        checkedCount,
        totalCount: items.length,
      };
    });
  }, [modelType, attachTrailer, customChecklists, zoneSessions]);

  // Aggregate metrics across all active zones
  const sessionStats = useMemo(() => {
    let checkedZones = 0;
    let okCount = 0;
    let issueCount = 0;
    let replacedCount = 0;
    let totalCost = 0;
    let totalPhotos = 0;
    const issueZoneIds: string[] = [];
    const unescalatedIssueZoneIds: string[] = [];

    for (const rz of activeZones) {
      const sess = zoneSessions[rz.zone.id];
      if (rz.status !== "pending") checkedZones += 1;
      if (rz.status === "ok") okCount += 1;
      if (rz.status === "replaced") replacedCount += 1;
      if (rz.status === "issue") {
        issueCount += 1;
        issueZoneIds.push(rz.zone.id);
        if (!sess?.linkedRepairNo) {
          unescalatedIssueZoneIds.push(rz.zone.id);
        }
      }
      const c = Number(sess?.cost || 0);
      if (!isNaN(c) && c > 0) totalCost += c;
      totalPhotos += sess?.photos?.length || 0;
    }

    return {
      totalZones: activeZones.length,
      checkedZones,
      okCount,
      issueCount,
      replacedCount,
      totalCost,
      totalPhotos,
      issueZoneIds,
      unescalatedIssueZoneIds,
    };
  }, [activeZones, zoneSessions]);

  const activeZoneRender = useMemo(
    () => (activeZoneId ? activeZones.find((z) => z.zone.id === activeZoneId) || null : null),
    [activeZones, activeZoneId]
  );

  const activeZoneItems = useMemo(
    () => (activeZoneRender ? getZoneChecklistItems(activeZoneRender.zone, customChecklists) : []),
    [activeZoneRender, customChecklists]
  );

  const activeZoneSession = activeZoneRender
    ? zoneSessions[activeZoneRender.zone.id] || createEmptyZoneSession()
    : createEmptyZoneSession();

  const updateZoneSession = (
    zoneId: string,
    updater: (prev: Pm3dZoneSessionData) => Pm3dZoneSessionData
  ) => {
    setZoneSessions((prev) => ({
      ...prev,
      [zoneId]: updater(prev[zoneId] || createEmptyZoneSession()),
    }));
  };

  const handleSelectZone = (zoneId: string) => {
    const target = activeZones.find((z) => z.zone.id === zoneId);
    if (!target) return;
    if (target.zone.requiresOpenHood && !isHoodOpen) {
      setIsHoodOpen(true);
    }
    setActiveZoneId(zoneId);
    setNewItemLabel("");
    setNewItemHint("");
    setEditingItemId(null);
  };

  const handleModelTypeChange = (nextType: MhPm3dModelType) => {
    setModelType(nextType);
    if (!PM3D_MODELS[nextType].supportsTrailerCoupling) {
      setAttachTrailer(false);
    }
    if (!PM3D_MODELS[nextType].supportsOpenHood) {
      setIsHoodOpen(false);
    }
    setActiveZoneId(null);
  };

  // Checklist Item Status Mutation
  const handleSetItemStatus = (zoneId: string, itemId: string, status: Pm3dItemStatus) => {
    updateZoneSession(zoneId, (prev) => {
      const current = prev.itemStatuses[itemId] || "pending";
      return {
        ...prev,
        itemStatuses: {
          ...prev.itemStatuses,
          [itemId]: current === status ? "pending" : status,
        },
      };
    });
  };

  const handleMarkAllZoneOk = (zoneId: string, items: Pm3dChecklistTemplateItem[]) => {
    updateZoneSession(zoneId, (prev) => {
      const nextStatuses = { ...prev.itemStatuses };
      for (const it of items) {
        nextStatuses[it.id] = "ok";
      }
      return { ...prev, itemStatuses: nextStatuses };
    });
  };

  // Custom Checklist Management (Add / Edit / Delete / Reset)
  const persistZoneChecklist = (zoneId: string, nextItems: Pm3dChecklistTemplateItem[]) => {
    const nextMap: CustomChecklistMap = {
      ...customChecklists,
      [zoneId]: nextItems,
    };
    setCustomChecklists(nextMap);
    saveCustomPm3dChecklists(nextMap);
  };

  const handleAddChecklistItem = () => {
    if (!activeZoneRender) return;
    const clean = newItemLabel.trim();
    if (!clean) return;
    const nextItem: Pm3dChecklistTemplateItem = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: clean,
      specHint: newItemHint.trim() || undefined,
    };
    persistZoneChecklist(activeZoneRender.zone.id, [...activeZoneItems, nextItem]);
    setNewItemLabel("");
    setNewItemHint("");
  };

  const handleSaveEditChecklistItem = (itemId: string) => {
    if (!activeZoneRender) return;
    const clean = editingItemText.trim();
    if (!clean) return;
    const updated = activeZoneItems.map((it) =>
      it.id === itemId ? { ...it, label: clean } : it
    );
    persistZoneChecklist(activeZoneRender.zone.id, updated);
    setEditingItemId(null);
    setEditingItemText("");
  };

  const handleDeleteChecklistItem = (itemId: string) => {
    if (!activeZoneRender) return;
    const updated = activeZoneItems.filter((it) => it.id !== itemId);
    persistZoneChecklist(activeZoneRender.zone.id, updated);
  };

  const handleResetZoneChecklistToDefault = () => {
    if (!activeZoneRender) return;
    const nextMap = { ...customChecklists };
    delete nextMap[activeZoneRender.zone.id];
    setCustomChecklists(nextMap);
    saveCustomPm3dChecklists(nextMap);
  };

  // Photo Attachment Upload (Compressed JPEG DataURL)
  const handlePhotoFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeZoneRender) return;
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;

    const currentCount = activeZoneSession.photos.length;
    const availableSlots = Math.max(0, 4 - currentCount);
    if (availableSlots <= 0) {
      void Swal.fire({
        icon: "info",
        title: "แนบรูปได้สูงสุด 4 รูปต่อจุดตรวจ",
        text: "กรุณาลบรูปเดิมบางส่วนหากต้องการเพิ่มรูปใหม่",
        confirmButtonColor: "#087eaf",
      });
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const compressed: MhRepairPhotoItem[] = [];
      for (const file of files.slice(0, availableSlots)) {
        if (!file.type.startsWith("image/")) continue;
        const item = await compressPmPhotoFile(file);
        compressed.push(item);
      }
      if (compressed.length > 0) {
        updateZoneSession(activeZoneRender.zone.id, (prev) => ({
          ...prev,
          photos: [...prev.photos, ...compressed].slice(0, 4),
        }));
      }
    } catch (err) {
      void Swal.fire({
        icon: "error",
        title: "อัปโหลดรูปไม่สำเร็จ",
        text: err instanceof Error ? err.message : "กรุณาลองใหม่อีกครั้ง",
        confirmButtonColor: "#087eaf",
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemoveZonePhoto = (zoneId: string, photoId: string) => {
    updateZoneSession(zoneId, (prev) => ({
      ...prev,
      photos: prev.photos.filter((p) => p.id !== photoId),
    }));
  };

  // Create real Repair Request (TMT-YYYY-MM-NNN) in mh_maintenance for failed PM zones
  const createRepairRequestForZones = async (targetZoneIds: string[]): Promise<string | null> => {
    const targetRzs = activeZones.filter((rz) => targetZoneIds.includes(rz.zone.id));
    if (targetRzs.length === 0) return null;

    setIsCreatingRepair(true);
    try {
      const existingMaintenance = await fetchMhMaintenanceOnce();
      const requestNo = generateNextRepairRequestNo(existingMaintenance, new Date());
      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 16);
      const recorderName =
        currentUser?.employeeName || getActiveRecorderDisplay("").employeeName || "ช่างซ่อมบำรุง PM";

      const detailLines: string[] = [];
      const collectedPhotos: MhRepairPhotoItem[] = [];
      let estCost = 0;

      for (const rz of targetRzs) {
        const items = getZoneChecklistItems(rz.zone, customChecklists);
        const sess = zoneSessions[rz.zone.id] || createEmptyZoneSession();
        const failedItems = items.filter((it) => sess.itemStatuses[it.id] === "issue");
        const itemNames =
          failedItems.length > 0
            ? failedItems.map((it) => it.label).join(", ")
            : "ตรวจพบความผิดปกติจากการตรวจ PM 3D";
        const noteSuffix = sess.notes.trim() ? ` [หมายเหตุ: ${sess.notes.trim()}]` : "";
        detailLines.push(`• ${rz.zone.label}: ${itemNames}${noteSuffix}`);

        const c = Number(sess.cost || 0);
        if (!isNaN(c) && c > 0) estCost += c;

        for (const ph of sess.photos || []) {
          if (collectedPhotos.length < 6) {
            collectedPhotos.push(ph);
          }
        }
      }

      const pmRefLabel = activeSchedule?.pmNo ? ` (จาก PM เลขที่ ${activeSchedule.pmNo})` : " (จากการตรวจ PM 3D)";
      const repairCategory =
        targetRzs.length === 1
          ? targetRzs[0].zone.repairCategory
          : "ซ่อมบำรุงจากผลตรวจ PM (Multiple Zones)";

      const vehicleDesc =
        activeSchedule?.vehicleDescription ||
        activeVehicle?.description ||
        PM3D_MODELS[modelType].label;

      const parsedHours = sessionOperatingHours.trim()
        ? Math.max(0, Number(sessionOperatingHours) || 0)
        : activeSchedule?.currentHours || 0;

      const newMaintenance: MhMaintenanceRecord = {
        id: requestNo,
        workOrderNo: requestNo,
        requesterName: recorderName,
        vehicleId: effectiveVehicleId,
        vehicleNumber: activeSchedule?.vehicleNumber || activeVehicle?.number || effectiveVehicleId,
        vehicleType: resolveVehicleType({
          vehicleType: activeSchedule?.vehicleType || activeVehicle?.vehicleType || PM3D_MODELS[modelType].shortLabel,
          vehicleId: effectiveVehicleId,
          description: vehicleDesc,
        }),
        vehicleDescription: `${effectiveVehicleId} - ${vehicleDesc}`,
        repairType: repairCategory,
        repairDescription: `[พบปัญหาจาก PM 3D${pmRefLabel}]\n${detailLines.join("\n")}`.slice(0, 990),
        workflowStage: "Submitted",
        status: "Pending Inspection",
        workingDate: todayYmd,
        spareParts: [],
        partsCost: 0,
        laborCost: 0,
        estimatedCost: estCost,
        technicianName: recorderName,
        workshopBay: "PM 3D Inspection Bay",
        operatingHours: parsedHours,
        createdAt: nowStr,
        supervisorStatus: "Pending",
        managerStatus: "Pending Manager Approval",
        progressStatus: "Awaiting Approval",
        photos: collectedPhotos,
        feedbackThread: [
          {
            id: `FB-${Date.now()}`,
            author: recorderName,
            role: "Requester",
            timestamp: nowStr,
            message: `ส่งเปิดใบแจ้งซ่อมอ้างอิงจากการตรวจ PM 3D${pmRefLabel} จำนวน ${targetRzs.length} จุดตรวจ`,
          },
        ],
        notes: `เชื่อมโยงจาก PM 3D${pmRefLabel}`,
      };

      await saveMhMaintenanceToCloud(newMaintenance);

      // Attach created repairNo to each escalated zone
      setZoneSessions((prev) => {
        const next = { ...prev };
        for (const zId of targetZoneIds) {
          const cur = next[zId] || createEmptyZoneSession();
          next[zId] = { ...cur, linkedRepairNo: requestNo };
        }
        return next;
      });

      void appendWmsActivityLog({
        module: "PM 3D -> Repair Request",
        sectionId: "fleet_ops",
        reference: requestNo,
        activity: `ส่งเปิดใบแจ้งซ่อม ${requestNo} สำหรับรถ ${effectiveVehicleId} จากผลตรวจ PM 3D (${targetRzs.map((z) => z.zone.shortLabel).join(", ")})`,
        status: "Submitted",
      });

      return requestNo;
    } finally {
      setIsCreatingRepair(false);
    }
  };

  const handleEscalateSingleZone = async (zoneId: string) => {
    const rz = activeZones.find((z) => z.zone.id === zoneId);
    if (!rz) return;
    const result = await Swal.fire({
      icon: "question",
      title: "ยืนยันส่งเปิดใบแจ้งซ่อม?",
      html: `ระบบจะสร้างใบแจ้งซ่อมใหม่เข้าสู่หน้า <b>ระบบแจ้งซ่อม</b> สำหรับรถ <b>${effectiveVehicleId}</b><br/>จุดที่พบปัญหา: <b>${rz.zone.label}</b>`,
      showCancelButton: true,
      confirmButtonText: "ยืนยันเปิดใบแจ้งซ่อม",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
    });
    if (!result.isConfirmed) return;

    const createdNo = await createRepairRequestForZones([zoneId]);
    if (createdNo) {
      await Swal.fire({
        icon: "success",
        title: "เปิดใบแจ้งซ่อมเรียบร้อยแล้ว",
        html: `เลขที่ใบแจ้งซ่อม: <b style="font-family:monospace;color:#087eaf">${createdNo}</b><br/>ส่งเข้าสู่คิวตรวจสอบของหัวหน้างานในหน้า <b>ระบบแจ้งซ่อม</b> แล้ว`,
        confirmButtonColor: "#087eaf",
      });
    }
  };

  const handleEscalateAllIssueZones = async () => {
    if (sessionStats.unescalatedIssueZoneIds.length === 0) return;
    const result = await Swal.fire({
      icon: "question",
      title: `ส่งเปิดใบแจ้งซ่อม (${sessionStats.unescalatedIssueZoneIds.length} จุดที่พบปัญหา)?`,
      text: `ระบบจะรวบรวมรายการที่พบปัญหาทั้งหมดของรถ ${effectiveVehicleId} พร้อมรูปถ่ายและหมายเหตุ ส่งเข้าสู่หน้า ระบบแจ้งซ่อม`,
      showCancelButton: true,
      confirmButtonText: "ยืนยันสร้างใบแจ้งซ่อม",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#64748b",
    });
    if (!result.isConfirmed) return;

    const createdNo = await createRepairRequestForZones(sessionStats.unescalatedIssueZoneIds);
    if (createdNo) {
      await Swal.fire({
        icon: "success",
        title: "สร้างใบแจ้งซ่อมอัตโนมัติสำเร็จ",
        html: `เลขที่ใบแจ้งซ่อม: <b style="font-family:monospace;color:#087eaf">${createdNo}</b>`,
        confirmButtonColor: "#087eaf",
      });
    }
  };

  // Finalize and Save 3D PM Session to PM Schedule
  const handleConfirmComplete3dPm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingComplete(true);
    try {
      const linkedNos = new Set<string>();
      for (const rz of activeZones) {
        const rn = zoneSessions[rz.zone.id]?.linkedRepairNo;
        if (rn) linkedNos.add(rn);
      }

      // Auto-create repair request for any remaining un-escalated issue zones if toggled
      if (autoCreateRepairOnComplete && sessionStats.unescalatedIssueZoneIds.length > 0) {
        const autoNo = await createRepairRequestForZones(sessionStats.unescalatedIssueZoneIds);
        if (autoNo) linkedNos.add(autoNo);
      }

      const zoneSnapshots: MhPm3dZoneSnapshot[] = activeZones.map((rz) => {
        const items = getZoneChecklistItems(rz.zone, customChecklists);
        const sess = zoneSessions[rz.zone.id] || createEmptyZoneSession();
        const failedNames = items
          .filter((it) => sess.itemStatuses[it.id] === "issue")
          .map((it) => `พบปัญหา:${it.label}`);
        const replacedNames = items
          .filter((it) => sess.itemStatuses[it.id] === "replaced")
          .map((it) => `เปลี่ยน:${it.label}`);
        const summaryParts = [...failedNames, ...replacedNames];
        const parsedZoneCost = Number(sess.cost || 0);
        return {
          zoneId: rz.zone.id,
          zoneLabel: rz.zone.shortLabel,
          status: rz.status,
          cost: !isNaN(parsedZoneCost) && parsedZoneCost > 0 ? parsedZoneCost : undefined,
          notes: sess.notes.trim() || undefined,
          photoCount: sess.photos.length > 0 ? sess.photos.length : undefined,
          itemsSummary:
            summaryParts.length > 0
              ? summaryParts.join(" · ").slice(0, 220)
              : rz.checkedCount > 0
              ? `ตรวจผ่าน ${rz.checkedCount}/${rz.totalCount} ข้อ`
              : undefined,
          linkedRepairNo: sess.linkedRepairNo,
        };
      });

      const pm3dSummary: MhPm3dSummary = {
        totalZones: sessionStats.totalZones,
        checkedZones: sessionStats.checkedZones,
        okCount: sessionStats.okCount,
        issueCount: sessionStats.issueCount,
        replacedCount: sessionStats.replacedCount,
        zoneSnapshots,
      };

      const parsedMileage = sessionMileageKm.trim()
        ? Math.max(0, Math.round(Number(sessionMileageKm) || 0))
        : undefined;
      const parsedHours = sessionOperatingHours.trim()
        ? Math.max(0, Number(sessionOperatingHours) || 0)
        : undefined;

      const autoNotesParts: string[] = [];
      if (completeNotes.trim()) autoNotesParts.push(completeNotes.trim());
      autoNotesParts.push(
        `[PM 3D ${PM3D_MODELS[modelType].shortLabel}${attachTrailer ? "+หางเทลเลอร์" : ""}: ตรวจ ${sessionStats.checkedZones}/${sessionStats.totalZones} จุด · ปกติ ${sessionStats.okCount} · เปลี่ยนอะไหล่ ${sessionStats.replacedCount} · พบปัญหา ${sessionStats.issueCount}]`
      );

      const savedSchedule = await onCompletePm3d({
        schedule: activeSchedule,
        vehicle: activeVehicle,
        fallbackVehicleId: effectiveVehicleId,
        completedDate: completeDate || todayYmd,
        performedBy: completePerformedBy.trim() || "ทีมช่างซ่อมบำรุง",
        mileageKm: parsedMileage,
        operatingHours: parsedHours,
        totalCost: sessionStats.totalCost > 0 ? sessionStats.totalCost : undefined,
        notes: autoNotesParts.join(" "),
        modelType,
        coupledTrailer: attachTrailer && PM3D_MODELS[modelType].supportsTrailerCoupling,
        summary: pm3dSummary,
        linkedRepairNos: Array.from(linkedNos),
      });

      setIsSummaryModalOpen(false);
      setZoneSessions({});
      setCompleteNotes("");
      setActiveZoneId(null);

      const linkedList = Array.from(linkedNos);
      await Swal.fire({
        icon: "success",
        title: "บันทึกผลตรวจ PM 3D เรียบร้อยแล้ว",
        html: `
          <div style="text-align:left;font-size:13px;line-height:1.6">
            <div><b>เลขที่ PM:</b> <span style="font-family:monospace;color:#087eaf">${savedSchedule.pmNo || "-"}</span></div>
            <div><b>รหัสรถ:</b> ${savedSchedule.vehicleId}</div>
            <div><b>ผลการตรวจ:</b> ${sessionStats.checkedZones}/${sessionStats.totalZones} จุด (ปกติ ${sessionStats.okCount} · เปลี่ยนอะไหล่ ${sessionStats.replacedCount} · พบปัญหา ${sessionStats.issueCount})</div>
            ${savedSchedule.nextPmDate ? `<div><b>ครบกำหนดรอบถัดไป:</b> ${savedSchedule.nextPmDate}</div>` : ""}
            ${savedSchedule.targetMileageKm ? `<div><b>รอบเลขไมล์ถัดไป:</b> ${savedSchedule.targetMileageKm.toLocaleString()} กม.</div>` : ""}
            ${linkedList.length > 0 ? `<div><b>ใบแจ้งซ่อมที่เชื่อมโยง:</b> <span style="font-family:monospace;color:#dc2626">${linkedList.join(", ")}</span></div>` : ""}
          </div>
        `,
        confirmButtonColor: "#087eaf",
      });
    } finally {
      setIsSubmittingComplete(false);
    }
  };

  // Previous / Next zone navigation inside modal
  const activeZoneIndex = activeZoneId
    ? activeZones.findIndex((z) => z.zone.id === activeZoneId)
    : -1;
  const handleStepZone = (delta: number) => {
    if (activeZones.length === 0 || activeZoneIndex < 0) return;
    const nextIdx = (activeZoneIndex + delta + activeZones.length) % activeZones.length;
    handleSelectZone(activeZones[nextIdx].zone.id);
  };

  const displayPmNo = useMemo(() => {
    if (activeSchedule?.pmNo) return activeSchedule.pmNo;
    return generateNextPmNo(schedules, new Date());
  }, [activeSchedule, schedules]);

  return (
    <div className="p-2.5 sm:p-3 flex-1 min-h-0 flex flex-col gap-2">
      {/* COMPACT TOP CONTEXT & PROGRESS BAR */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#1e3a5f]">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Schedule / Vehicle Selector */}
          <div className="flex items-center gap-2">
            <select
              value={activeSchedule ? `sch:${activeSchedule.id}` : `veh:${standaloneVehicleId}`}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith("sch:")) {
                  onSelectScheduleId(val.slice(4));
                } else {
                  onSelectScheduleId(null);
                  setStandaloneVehicleId(val.slice(4));
                }
              }}
              className="field min-w-[210px] max-w-[300px]"
              style={CONTROL_STYLE}
              aria-label="เลือกกำหนดการ PM หรือรถที่ต้องการตรวจ"
            >
              {schedules.length > 0 && (
                <optgroup label="กำหนดการ PM ในระบบ">
                  {schedules.map((sch) => (
                    <option key={sch.id} value={`sch:${sch.id}`}>
                      {sch.pmNo ? `${sch.pmNo} · ` : ""}
                      {sch.vehicleId} ({sch.pmCategory})
                    </option>
                  ))}
                </optgroup>
              )}
              {vehicles.length > 0 && (
                <optgroup label="รถในฟลีท (สร้างกำหนดการ PM ใหม่อัตโนมัติ)">
                  {vehicles.map((v) => (
                    <option key={v.id} value={`veh:${v.vehicleId}`}>
                      {v.vehicleId} · {getVehicleTypeDisplayLabel(v.vehicleType, v)} {v.description ? `(${v.description})` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Clean Unboxed Metadata Strip */}
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 flex-wrap">
            <span className="inline-flex items-center gap-1 font-mono tabular-nums font-bold text-[#087eaf] dark:text-sky-300">
              <Hash size={12} />
              {displayPmNo}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
            <span className="font-mono tabular-nums">
              ตรวจแล้ว <strong className="text-slate-900 dark:text-white">{sessionStats.checkedZones}/{sessionStats.totalZones}</strong> จุด
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
            <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
              ปกติ {sessionStats.okCount}
            </span>
            {sessionStats.replacedCount > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-300">
                  เปลี่ยนอะไหล่ {sessionStats.replacedCount}
                </span>
              </>
            )}
            {sessionStats.issueCount > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400">
                  พบปัญหา {sessionStats.issueCount}
                </span>
              </>
            )}
            {sessionStats.totalCost > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                  รวม ฿{sessionStats.totalCost.toLocaleString()}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right Primary Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {sessionStats.unescalatedIssueZoneIds.length > 0 && (
            <button
              type="button"
              disabled={isCreatingRepair}
              onClick={handleEscalateAllIssueZones}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              <FileWarning size={14} />
              {isCreatingRepair
                ? "กำลังเปิดใบแจ้งซ่อม..."
                : `ส่งเปิดใบแจ้งซ่อม (${sessionStats.unescalatedIssueZoneIds.length} จุด)`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsSummaryModalOpen(true)}
            className="button primary whitespace-nowrap"
          >
            <ClipboardCheck size={14} />
            สรุปและยืนยันบันทึกผล PM 3D
          </button>
        </div>
      </div>

      {/* 360-DEGREE INTERACTIVE THREE.JS VIEWPORT (Auto-fills remaining viewport height) */}
      <div className="flex-1 min-h-[380px] flex flex-col">
        <Pm3dViewport
          vehicleCode={shortVehicleCode}
          modelType={modelType}
          onModelTypeChange={handleModelTypeChange}
          attachTrailer={attachTrailer}
          onToggleAttachTrailer={() => setAttachTrailer((v) => !v)}
          isHoodOpen={isHoodOpen}
          onToggleHoodOpen={() => setIsHoodOpen((v) => !v)}
          zones={activeZones}
          activeZoneId={activeZoneId}
          onSelectZone={handleSelectZone}
        />
      </div>

      {/* ULTRA-COMPACT SINGLE-STRIP CLICKABLE ZONE BAR (Zero Viewport Scroll) */}
      <div className="shrink-0 flex items-center gap-2 overflow-x-auto pb-0.5">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
          จุดตรวจ ({activeZones.length}):
        </span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {activeZones.map(({ zone, status, checkedCount, totalCount }) => {
            const sess = zoneSessions[zone.id];
            const isSelected = activeZoneId === zone.id;
            const borderTone =
              status === "issue"
                ? "border-rose-300 bg-rose-50/80 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                : status === "replaced"
                ? "border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-200"
                : status === "ok"
                ? "border-emerald-300 bg-emerald-50/80 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-200"
                : "border-slate-200 bg-white text-slate-700 dark:border-[#1e3a5f] dark:bg-[#0c1a30] dark:text-slate-200";

            return (
              <button
                key={zone.id}
                type="button"
                onClick={() => handleSelectZone(zone.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${borderTone} ${
                  isSelected ? "ring-2 ring-[#087eaf] dark:ring-sky-400" : "hover:border-[#087eaf]"
                }`}
                title={`${zone.label} (${checkedCount}/${totalCount})`}
              >
                {status === "issue" ? (
                  <AlertTriangle size={11} className="text-rose-600 shrink-0" />
                ) : status === "replaced" ? (
                  <Wrench size={11} className="text-amber-600 shrink-0" />
                ) : status === "ok" ? (
                  <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                )}
                <span>{zone.shortLabel}</span>
                <span className="font-mono tabular-nums text-[10px] opacity-75">
                  {checkedCount}/{totalCount}
                </span>
                {sess?.linkedRepairNo && (
                  <span className="text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400">
                    ({sess.linkedRepairNo})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* HOTSPOT PART PM CHECKLIST MODAL */}
      {activeZoneRender && (
        <div className="modal-backdrop z-[130]! overflow-y-auto p-3! sm:p-5!">
          <div className="modal-container flex flex-col w-full max-w-[700px] max-h-[calc(100dvh-28px)] sm:max-h-[calc(100dvh-44px)] min-h-0 overflow-hidden">
            {/* Modal Header */}
            <div className="modal-header-box shrink-0 gap-3 px-5! py-3.5!">
              <div className="min-w-0">
                <div className="modal-title-text flex items-center gap-2 flex-wrap">
                  <Wrench size={16} className="text-[#087eaf] shrink-0" />
                  <span className="truncate">{activeZoneRender.zone.label}</span>
                </div>
                <div className="modal-sub-text mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{activeZoneRender.zone.englishLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{effectiveVehicleId}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[#087eaf] dark:text-sky-300">{displayPmNo}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveZoneId(null)}
                className="modal-close-btn shrink-0"
                aria-label="ปิดหน้าต่าง"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
              {/* Quick Actions Bar inside Modal */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  รายการตรวจเช็ค ({activeZoneRender.checkedCount}/{activeZoneItems.length} ข้อ)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleMarkAllZoneOk(activeZoneRender.zone.id, activeZoneItems)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 cursor-pointer whitespace-nowrap"
                  >
                    <CheckCircle2 size={12} />
                    ติ๊กปกติทั้งหมด
                  </button>
                  {customChecklists[activeZoneRender.zone.id] && (
                    <button
                      type="button"
                      onClick={handleResetZoneChecklistToDefault}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer whitespace-nowrap"
                      title="คืนค่ารายการตรวจมาตรฐานเริ่มต้น"
                    >
                      <RotateCcw size={11} />
                      คืนค่ามาตรฐาน
                    </button>
                  )}
                </div>
              </div>

              {/* Checklist Rows */}
              <div className="space-y-2">
                {activeZoneItems.length === 0 ? (
                  <div className="py-5 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-[#1e3a5f] rounded-lg">
                    ยังไม่มีหัวข้อตรวจในจุดนี้ กรุณาเพิ่มหัวข้อตรวจด้านล่าง
                  </div>
                ) : (
                  activeZoneItems.map((item, idx) => {
                    const st = activeZoneSession.itemStatuses[item.id] || "pending";
                    const isEditing = editingItemId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50/60 dark:bg-[#0d1c34] space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={editingItemText}
                                  onChange={(e) => setEditingItemText(e.target.value)}
                                  className="field flex-1"
                                  style={CONTROL_STYLE}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditChecklistItem(item.id)}
                                  className="px-2.5 py-1.5 rounded bg-[#087eaf] text-white text-xs font-semibold cursor-pointer"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingItemId(null)}
                                  className="px-2 py-1.5 rounded border border-slate-300 dark:border-[#1e3a5f] text-xs cursor-pointer"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-snug">
                                  {idx + 1}. {item.label}
                                </div>
                                {item.specHint && (
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    เกณฑ์มาตรฐาน: {item.specHint}
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {!isEditing && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingItemText(item.label);
                                }}
                                className="p-1 rounded text-slate-400 hover:text-[#087eaf] hover:bg-slate-200/60 dark:hover:bg-[#173056] cursor-pointer"
                                title="แก้ไขหัวข้อตรวจ"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteChecklistItem(item.id)}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                                title="ลบหัวข้อตรวจ"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Status Selector Buttons */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleSetItemStatus(activeZoneRender.zone.id, item.id, "ok")
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                              st === "ok"
                                ? "bg-emerald-600 text-white border-emerald-700"
                                : "bg-white text-slate-600 border-slate-300 hover:border-emerald-400 dark:bg-[#091528] dark:text-slate-300 dark:border-[#24436e]"
                            }`}
                          >
                            <CheckCircle2 size={12} />
                            ปกติ
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleSetItemStatus(activeZoneRender.zone.id, item.id, "replaced")
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                              st === "replaced"
                                ? "bg-amber-500 text-slate-950 border-amber-600"
                                : "bg-white text-slate-600 border-slate-300 hover:border-amber-400 dark:bg-[#091528] dark:text-slate-300 dark:border-[#24436e]"
                            }`}
                          >
                            <Wrench size={12} />
                            เปลี่ยนอะไหล่
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleSetItemStatus(activeZoneRender.zone.id, item.id, "issue")
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                              st === "issue"
                                ? "bg-rose-600 text-white border-rose-700"
                                : "bg-white text-slate-600 border-slate-300 hover:border-rose-400 dark:bg-[#091528] dark:text-slate-300 dark:border-[#24436e]"
                            }`}
                          >
                            <AlertTriangle size={12} />
                            พบปัญหา
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add New Custom Checklist Item */}
              <div className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-[#254572] bg-white dark:bg-[#0a172c] space-y-2">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  เพิ่มหัวข้อตรวจเองในจุดนี้ (บันทึกไว้ใช้ครั้งถัดไปอัตโนมัติ)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2">
                  <input
                    type="text"
                    placeholder="ชื่อหัวข้อตรวจใหม่ เช่น ตรวจน็อตยึดแท่น..."
                    value={newItemLabel}
                    onChange={(e) => setNewItemLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddChecklistItem();
                      }
                    }}
                    className="field w-full"
                    style={CONTROL_STYLE}
                  />
                  <input
                    type="text"
                    placeholder="เกณฑ์มาตรฐาน (ไม่บังคับ)"
                    value={newItemHint}
                    onChange={(e) => setNewItemHint(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddChecklistItem();
                      }
                    }}
                    className="field w-full"
                    style={CONTROL_STYLE}
                  />
                  <button
                    type="button"
                    onClick={handleAddChecklistItem}
                    disabled={!newItemLabel.trim()}
                    className="inline-flex items-center justify-center gap-1 px-3 rounded-md text-xs font-semibold bg-[#087eaf] text-white hover:bg-[#066a94] disabled:opacity-45 cursor-pointer whitespace-nowrap"
                    style={{ height: 35 }}
                  >
                    <Plus size={13} />
                    เพิ่มข้อ
                  </button>
                </div>
              </div>

              {/* Escalate to Repair System Banner if any item marked Issue */}
              {activeZoneRender.status === "issue" && (
                <div className="p-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-950/35 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                      <AlertTriangle size={14} />
                      พบความผิดปกติในจุดนี้
                    </div>
                    <div className="text-[11px] text-rose-600/90 dark:text-rose-300/80 mt-0.5">
                      {activeZoneSession.linkedRepairNo
                        ? `ส่งเปิดใบแจ้งซ่อมแล้ว เลขที่ ${activeZoneSession.linkedRepairNo}`
                        : "สามารถส่งเปิดใบแจ้งซ่อมเข้าสู่ระบบแจ้งซ่อมพร้อมรูปถ่ายและหมายเหตุได้ทันที"}
                    </div>
                  </div>
                  {activeZoneSession.linkedRepairNo ? (
                    <span className="px-2.5 py-1 rounded font-mono text-xs font-bold bg-white dark:bg-[#091528] text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
                      {activeZoneSession.linkedRepairNo}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isCreatingRepair}
                      onClick={() => handleEscalateSingleZone(activeZoneRender.zone.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 cursor-pointer whitespace-nowrap"
                    >
                      <Send size={12} />
                      {isCreatingRepair ? "กำลังส่ง..." : "ส่งเปิดใบแจ้งซ่อมจุดนี้"}
                    </button>
                  )}
                </div>
              )}

              {/* Notes, Cost, Mileage/Hours & Photo Attachment */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200 dark:border-[#1e3a5f]">
                <div className="sm:col-span-2">
                  <label className="modal-label-text block text-xs mb-1.5">
                    หมายเหตุ / รายละเอียดอะไหล่ที่เปลี่ยนหรืออาการที่พบ
                  </label>
                  <textarea
                    rows={2}
                    placeholder="บันทึกผลการตรวจ สภาพชิ้นส่วน หรือรายการอะไหล่ที่ใช้..."
                    value={activeZoneSession.notes}
                    onChange={(e) =>
                      updateZoneSession(activeZoneRender.zone.id, (prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    className="field w-full py-2 px-2.5 text-xs"
                  />
                </div>

                <div>
                  <label className="modal-label-text block text-xs mb-1.5">
                    ค่าใช้จ่ายอะไหล่ / ค่าแรงจุดนี้ (บาท)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={activeZoneSession.cost}
                    onChange={(e) =>
                      updateZoneSession(activeZoneRender.zone.id, (prev) => ({
                        ...prev,
                        cost: e.target.value,
                      }))
                    }
                    className="field w-full font-mono tabular-nums"
                    style={CONTROL_STYLE}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="modal-label-text block text-xs mb-1.5">
                      เลขไมล์รถ (กม.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="เช่น 1250"
                      value={sessionMileageKm}
                      onChange={(e) => setSessionMileageKm(e.target.value)}
                      className="field w-full font-mono tabular-nums"
                      style={CONTROL_STYLE}
                    />
                  </div>
                  <div>
                    <label className="modal-label-text block text-xs mb-1.5">
                      ชั่วโมงใช้งาน (ชม.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="เช่น 420"
                      value={sessionOperatingHours}
                      onChange={(e) => setSessionOperatingHours(e.target.value)}
                      className="field w-full font-mono tabular-nums"
                      style={CONTROL_STYLE}
                    />
                  </div>
                </div>

                {/* Photo Attachment Slot */}
                <div className="sm:col-span-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="modal-label-text text-xs">
                      รูปถ่ายหน้างาน ({activeZoneSession.photos.length}/4 รูป)
                    </label>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotoFilesSelected}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isUploadingPhoto || activeZoneSession.photos.length >= 4}
                      onClick={() => photoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 dark:border-[#24436e] bg-slate-50 dark:bg-[#10223f] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                    >
                      <Camera size={13} />
                      {isUploadingPhoto ? "กำลังบีบอัดรูป..." : "แนบรูปถ่าย / ถ่ายภาพ"}
                    </button>
                  </div>

                  {activeZoneSession.photos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {activeZoneSession.photos.map((ph) => (
                        <div
                          key={ph.id}
                          className="relative group rounded-md overflow-hidden border border-slate-200 dark:border-[#1e3a5f] aspect-video bg-slate-100 dark:bg-[#091528]"
                        >
                          <img
                            src={ph.dataUrl}
                            alt={ph.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveZonePhoto(activeZoneRender.zone.id, ph.id)
                            }
                            className="absolute top-1 right-1 p-1 rounded-full bg-slate-900/75 text-white hover:bg-rose-600 cursor-pointer"
                            title="ลบรูปภาพ"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer-box shrink-0 flex items-center justify-between gap-2 px-5! py-3!">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleStepZone(-1)}
                  className="button secondary px-2.5!"
                  title="จุดตรวจก่อนหน้า"
                >
                  <ChevronLeft size={14} />
                  จุดก่อนหน้า
                </button>
                <button
                  type="button"
                  onClick={() => handleStepZone(1)}
                  className="button secondary px-2.5!"
                  title="จุดตรวจถัดไป"
                >
                  จุดถัดไป
                  <ChevronRight size={14} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setActiveZoneId(null)}
                className="button primary"
              >
                <CheckCircle2 size={14} />
                บันทึกจุดนี้
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMPLETE 3D PM SUMMARY MODAL */}
      {isSummaryModalOpen && (
        <div className="modal-backdrop z-[130]! overflow-y-auto p-3! sm:p-5!">
          <div className="modal-container flex flex-col w-full max-w-[560px] max-h-[calc(100dvh-28px)] min-h-0 overflow-hidden">
            <div className="modal-header-box shrink-0 px-5! py-3.5!">
              <div>
                <div className="modal-title-text flex items-center gap-2">
                  <ClipboardCheck size={16} className="text-emerald-600" />
                  ยืนยันบันทึกผลการตรวจ PM 3D
                </div>
                <div className="modal-sub-text mt-0.5">
                  เลขที่ {displayPmNo} · รถ {effectiveVehicleId} ({PM3D_MODELS[modelType].shortLabel}
                  {attachTrailer && PM3D_MODELS[modelType].supportsTrailerCoupling
                    ? " + หางเทลเลอร์"
                    : ""}
                  )
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSummaryModalOpen(false)}
                className="modal-close-btn"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleConfirmComplete3dPm}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3.5">
                {/* Summary Strip */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1c34]">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">ตรวจแล้ว</div>
                    <div className="font-mono tabular-nums text-sm font-bold text-[#087eaf] dark:text-sky-300">
                      {sessionStats.checkedZones}/{sessionStats.totalZones}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30">
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-300">ปกติ</div>
                    <div className="font-mono tabular-nums text-sm font-bold text-emerald-700 dark:text-emerald-300">
                      {sessionStats.okCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30">
                    <div className="text-[10px] text-amber-700 dark:text-amber-300">เปลี่ยนอะไหล่</div>
                    <div className="font-mono tabular-nums text-sm font-bold text-amber-700 dark:text-amber-300">
                      {sessionStats.replacedCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/30">
                    <div className="text-[10px] text-rose-700 dark:text-rose-300">พบปัญหา</div>
                    <div className="font-mono tabular-nums text-sm font-bold text-rose-700 dark:text-rose-300">
                      {sessionStats.issueCount}
                    </div>
                  </div>
                </div>

                {/* Next Schedule Calculation Preview */}
                {activeSchedule && (activeSchedule.cycleDays || activeSchedule.cycleMileageKm) && (
                  <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 text-xs space-y-1">
                    <div className="font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                      <Gauge size={13} />
                      ระบบจะคำนวณรอบ PM ถัดไปให้อัตโนมัติ:
                    </div>
                    {activeSchedule.cycleDays && (
                      <div className="text-emerald-700 dark:text-emerald-300 font-mono tabular-nums">
                        • วันครบกำหนดใหม่:{" "}
                        {computeNextPmDate(completeDate || todayYmd, activeSchedule.cycleDays)}
                      </div>
                    )}
                    {activeSchedule.cycleMileageKm && (
                      <div className="text-emerald-700 dark:text-emerald-300 font-mono tabular-nums">
                        • รอบเลขไมล์ถัดไป:{" "}
                        {(
                          (Number(sessionMileageKm) ||
                            activeSchedule.targetMileageKm ||
                            activeSchedule.startMileageKm ||
                            0) + activeSchedule.cycleMileageKm
                        ).toLocaleString()}{" "}
                        กม.
                      </div>
                    )}
                  </div>
                )}

                {/* Auto-Create Repair Request Option if un-escalated issues exist */}
                {sessionStats.unescalatedIssueZoneIds.length > 0 && (
                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateRepairOnComplete}
                      onChange={(e) => setAutoCreateRepairOnComplete(e.target.checked)}
                      className="mt-0.5 rounded border-rose-400 text-rose-600"
                    />
                    <div className="text-xs">
                      <div className="font-bold text-rose-700 dark:text-rose-300">
                        สร้างใบแจ้งซ่อมอัตโนมัติ (TMT-...) สำหรับ {sessionStats.unescalatedIssueZoneIds.length} จุดที่พบปัญหา
                      </div>
                      <div className="text-[11px] text-rose-600/90 dark:text-rose-300/80 mt-0.5">
                        ส่งรายละเอียดอาการ ค่าใช้จ่ายประมาณการ และรูปถ่ายเข้าหน้า ระบบแจ้งซ่อม ทันที
                      </div>
                    </div>
                  </label>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="modal-label-text block text-xs mb-1.5">
                      วันที่ทำ PM เสร็จสิ้น *
                    </label>
                    <input
                      type="date"
                      value={completeDate}
                      onChange={(e) => setCompleteDate(e.target.value)}
                      className="field w-full dark:[color-scheme:dark]"
                      style={CONTROL_STYLE}
                      required
                    />
                  </div>

                  <div>
                    <label className="modal-label-text block text-xs mb-1.5">
                      ช่าง / ผู้ตรวจเช็ค PM *
                    </label>
                    <input
                      type="text"
                      value={completePerformedBy}
                      onChange={(e) => setCompletePerformedBy(e.target.value)}
                      className="field w-full"
                      style={CONTROL_STYLE}
                      required
                    />
                  </div>

                  <div>
                    <label className="modal-label-text block text-xs mb-1.5">
                      เลขไมล์รถล่าสุด (กม.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={sessionMileageKm}
                      onChange={(e) => setSessionMileageKm(e.target.value)}
                      className="field w-full font-mono tabular-nums"
                      style={CONTROL_STYLE}
                    />
                  </div>

                  <div>
                    <label className="modal-label-text block text-xs mb-1.5">
                      ชั่วโมงใช้งานรถ (ชม.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={sessionOperatingHours}
                      onChange={(e) => setSessionOperatingHours(e.target.value)}
                      className="field w-full font-mono tabular-nums"
                      style={CONTROL_STYLE}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="modal-label-text block text-xs mb-1.5">
                      ค่าใช้จ่ายรวมจากทุกจุด (บาท)
                    </label>
                    <div className="px-3 py-2 rounded-md border border-slate-200 dark:border-[#1e3a5f] bg-slate-50 dark:bg-[#0d1c34] font-mono tabular-nums text-sm font-bold text-slate-800 dark:text-slate-100">
                      ฿{sessionStats.totalCost.toLocaleString()}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="modal-label-text block text-xs mb-1.5">
                      หมายเหตุสรุปรวม (ถ้ามี)
                    </label>
                    <input
                      type="text"
                      placeholder="เช่น ทำ PM ครบทุกรายการ รถพร้อมใช้งาน..."
                      value={completeNotes}
                      onChange={(e) => setCompleteNotes(e.target.value)}
                      className="field w-full"
                      style={CONTROL_STYLE}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer-box shrink-0 flex justify-end gap-2 px-5! py-3!">
                <button
                  type="button"
                  onClick={() => setIsSummaryModalOpen(false)}
                  className="button secondary"
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSubmittingComplete} className="button primary">
                  <CheckCircle2 size={14} />
                  {isSubmittingComplete ? "กำลังบันทึก..." : "ยืนยันบันทึกผล PM 3D"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
