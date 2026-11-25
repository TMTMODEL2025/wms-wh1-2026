/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from "react";
import { toPng, toBlob } from "html-to-image";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Image as ImageIcon,
  MessageSquareText,
  Moon,
  Sun,
} from "lucide-react";
import { getActiveRecorderDisplay } from "../services/authWorkforceService";
import {
  SlitWorkforceAssignment,
  SlitWorkforceMachineGroup,
  SlitWorkforceShift,
  getAssignmentMachineGroups,
  inferMachineGroupFromCode,
} from "../services/slitWorkforceService";
import { addDaysToYmd, parseLocalYmd } from "../services/weeklyShiftScheduleService";
import type { Employee } from "../types/officer";

export interface InfographicWorkforceRow {
  rowKey: string;
  employee?: Employee;
  employeeId: string;
  employeeName: string;
  department: string;
  photoUrl?: string;
  assignment?: SlitWorkforceAssignment;
  effectiveShift: SlitWorkforceShift | "off" | "unassigned";
}

interface SlitWorkforceInfographicReportProps {
  isThai?: boolean;
  selectedDate: string;
  onChangeDate: (nextYmd: string) => void;
  rows: InfographicWorkforceRow[];
  onBackToTable: () => void;
  onLogTransaction?: (activity: string, reference: string, status: string) => void;
}

const MACHINE_GROUP_META: {
  key: SlitWorkforceMachineGroup;
  labelTh: string;
  labelEn: string;
  machines: string[];
  barColor: string;
}[] = [
  {
    key: "TM",
    labelTh: "เครื่องผลิตท่อ (TM)",
    labelEn: "Pipe Mill (TM)",
    machines: [
      "TM01",
      "TM02",
      "TM03",
      "TM04",
      "TM05",
      "TM06",
      "TM07",
      "TM08",
      "TM09",
      "TM10",
      "TM11",
      "TM12",
      "TM13",
      "TM14",
    ],
    barColor: "#0284c7",
  },
  {
    key: "CF",
    labelTh: "เครื่องตัวซี (CF)",
    labelEn: "C-Channel (CF)",
    machines: ["CF01", "CF02", "CF03", "CF04", "CF05"],
    barColor: "#0d9488",
  },
  {
    key: "ML",
    labelTh: "เครื่องมินิ (ML)",
    labelEn: "Mini Line (ML)",
    machines: ["ML01", "ML02"],
    barColor: "#d97706",
  },
  {
    key: "ZF",
    labelTh: "ตัวซีมีขอบ (ZF)",
    labelEn: "Lip Channel (ZF)",
    machines: ["ZF01", "ZF02"],
    barColor: "#4f46e5",
  },
];

const ALL_MACHINE_CODES = MACHINE_GROUP_META.flatMap((g) => g.machines);
const GROUP_TO_MACHINES: Record<SlitWorkforceMachineGroup, string[]> = {
  TM: MACHINE_GROUP_META[0].machines,
  CF: MACHINE_GROUP_META[1].machines,
  ML: MACHINE_GROUP_META[2].machines,
  ZF: MACHINE_GROUP_META[3].machines,
};

const THAI_DAYS = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
];

const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

function formatFullThaiDate(ymd: string): string {
  const d = parseLocalYmd(ymd);
  const dayName = THAI_DAYS[d.getDay()] || "";
  const dayNum = d.getDate();
  const monthName = THAI_MONTHS_SHORT[d.getMonth()] || "";
  const buddhistYear = d.getFullYear() + 543;
  return `วัน${dayName}ที่ ${dayNum} ${monthName} ${buddhistYear}`;
}

function formatCurrentTimeHM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function getInitials(name: string): string {
  const cleaned = (name || "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function getCoveredMachines(asn: SlitWorkforceAssignment | undefined): string[] {
  if (!asn) return [];
  const groups = getAssignmentMachineGroups(asn);
  const specific = Array.from(
    new Set((asn.machines || []).map((c) => c.trim().toUpperCase()).filter(Boolean))
  );
  const covered = new Set<string>(specific);
  groups.forEach((grp) => {
    const hasSpecificInGrp = specific.some((c) => inferMachineGroupFromCode(c) === grp);
    if (!hasSpecificInGrp) {
      GROUP_TO_MACHINES[grp].forEach((code) => covered.add(code));
    }
  });
  return Array.from(covered);
}

function formatMachinesForReport(
  asn: SlitWorkforceAssignment | undefined,
  isThai: boolean
): string {
  if (!asn) return isThai ? "ยังไม่ระบุเครื่อง" : "Unassigned";
  const groups = getAssignmentMachineGroups(asn);
  const specific = Array.from(
    new Set((asn.machines || []).map((c) => c.trim().toUpperCase()).filter(Boolean))
  );

  const isAllExplicit = ALL_MACHINE_CODES.every((c) => specific.includes(c));
  const isAllGroupsOnly = groups.length === 4 && specific.length === 0;
  if (isAllExplicit || isAllGroupsOnly) {
    return isThai ? `ทุกเครื่อง (${ALL_MACHINE_CODES.length} เครื่อง)` : `All (${ALL_MACHINE_CODES.length})`;
  }

  const parts: string[] = [];
  groups.forEach((grp) => {
    const grpCodes = specific.filter((c) => inferMachineGroupFromCode(c) === grp);
    if (grpCodes.length === 0) {
      parts.push(isThai ? `${grp} (ทั้งกลุ่ม)` : `${grp} (All)`);
    } else if (grpCodes.length === GROUP_TO_MACHINES[grp].length) {
      parts.push(isThai ? `${grp} (ครบ ${grpCodes.length})` : `${grp} (All ${grpCodes.length})`);
    } else {
      parts.push(grpCodes.join(", "));
    }
  });

  const extra = specific.filter((c) => !inferMachineGroupFromCode(c));
  if (extra.length > 0) parts.push(extra.join(", "));

  return parts.join(" · ") || groups.join(", ") || "-";
}

function getStatusThai(status?: string): string {
  if (status === "active") return "ปฏิบัติงาน";
  if (status === "standby") return "สแตนด์บาย";
  if (status === "completed") return "เสร็จสิ้น";
  return "รอมอบหมาย";
}

export function SlitWorkforceInfographicReport({
  isThai = true,
  selectedDate,
  onChangeDate,
  rows,
  onBackToTable,
  onLogTransaction,
}: SlitWorkforceInfographicReportProps) {
  const posterRef = useRef<HTMLDivElement | null>(null);

  const [reportShiftScope, setReportShiftScope] = useState<"all" | "day" | "night">("all");
  const [posterTheme, setPosterTheme] = useState<"light" | "dark">("light");
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isCopyingImage, setIsCopyingImage] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string>("");
  const [brokenPhotos, setBrokenPhotos] = useState<Record<string, boolean>>({});

  const recorder = useMemo(() => getActiveRecorderDisplay(), []);
  const generatedTime = useMemo(() => formatCurrentTimeHM(), [selectedDate, rows.length]);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    window.setTimeout(() => {
      setActionFeedback((curr) => (curr === msg ? "" : curr));
    }, 3200);
  };

  // Filtered rows by selected shift scope
  const scopedRows = useMemo(() => {
    if (reportShiftScope === "day") {
      return rows.filter((r) => r.effectiveShift === "day");
    }
    if (reportShiftScope === "night") {
      return rows.filter((r) => r.effectiveShift === "night");
    }
    return rows;
  }, [rows, reportShiftScope]);

  const dayRows = useMemo(
    () => scopedRows.filter((r) => r.effectiveShift === "day"),
    [scopedRows]
  );
  const nightRows = useMemo(
    () => scopedRows.filter((r) => r.effectiveShift === "night"),
    [scopedRows]
  );
  const unassignedShiftRows = useMemo(
    () => scopedRows.filter((r) => r.effectiveShift === "unassigned"),
    [scopedRows]
  );
  const offRows = useMemo(
    () => scopedRows.filter((r) => r.effectiveShift === "off"),
    [scopedRows]
  );

  // Analytics & Infographic Aggregations
  const stats = useMemo(() => {
    const workingRows = scopedRows.filter((r) => r.effectiveShift !== "off");
    const assignedRows = workingRows.filter((r) => Boolean(r.assignment));

    // Per machine code headcount map
    const machineStaffCount: Record<string, number> = {};
    ALL_MACHINE_CODES.forEach((code) => {
      machineStaffCount[code] = 0;
    });

    // Per group headcount
    const groupStaffCount: Record<SlitWorkforceMachineGroup, number> = {
      TM: 0,
      CF: 0,
      ML: 0,
      ZF: 0,
    };

    // Per area headcount
    const areaMap = new Map<string, number>();

    assignedRows.forEach((row) => {
      const asn = row.assignment;
      if (!asn) return;

      const groups = getAssignmentMachineGroups(asn);
      groups.forEach((g) => {
        groupStaffCount[g] = (groupStaffCount[g] || 0) + 1;
      });

      const covered = getCoveredMachines(asn);
      covered.forEach((code) => {
        if (machineStaffCount[code] !== undefined) {
          machineStaffCount[code] += 1;
        }
      });

      const areaName = asn.area && asn.area !== "-" ? asn.area.trim() : "ยังไม่ระบุพื้นที่";
      areaMap.set(areaName, (areaMap.get(areaName) || 0) + 1);
    });

    const coveredMachineCount = ALL_MACHINE_CODES.filter(
      (code) => (machineStaffCount[code] || 0) > 0
    ).length;

    const areaBreakdown = Array.from(areaMap.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area, "th"));

    const maxAreaCount = Math.max(1, ...areaBreakdown.map((a) => a.count));
    const maxGroupCount = Math.max(
      1,
      groupStaffCount.TM,
      groupStaffCount.CF,
      groupStaffCount.ML,
      groupStaffCount.ZF
    );

    const activeShiftTotal = dayRows.length + nightRows.length;
    const dayPct = activeShiftTotal > 0 ? Math.round((dayRows.length / activeShiftTotal) * 100) : 0;
    const nightPct = activeShiftTotal > 0 ? 100 - dayPct : 0;

    return {
      workingTotal: workingRows.length,
      assignedTotal: assignedRows.length,
      pendingTotal: Math.max(0, workingRows.length - assignedRows.length),
      dayCount: dayRows.length,
      nightCount: nightRows.length,
      offCount: offRows.length,
      unassignedShiftCount: unassignedShiftRows.length,
      dayPct,
      nightPct,
      machineStaffCount,
      coveredMachineCount,
      groupStaffCount,
      maxGroupCount,
      areaBreakdown,
      maxAreaCount,
    };
  }, [scopedRows, dayRows, nightRows, offRows, unassignedShiftRows]);

  // Capture helper with graceful fallback for external avatar images
  const renderPosterDataUrl = async (): Promise<string> => {
    const el = posterRef.current;
    if (!el) throw new Error("Poster ref unavailable");
    const bgColor = posterTheme === "dark" ? "#071426" : "#ffffff";
    const opts = {
      pixelRatio: 2.5,
      cacheBust: true,
      backgroundColor: bgColor,
      width: el.offsetWidth,
      height: el.offsetHeight,
      style: {
        margin: "0",
      },
    };
    try {
      return await toPng(el, opts);
    } catch {
      // Retry skipping external non-data images to guarantee export never fails from CORS
      return await toPng(el, {
        ...opts,
        filter: (node) => {
          if (node instanceof HTMLImageElement) {
            return node.src.startsWith("data:");
          }
          return true;
        },
      });
    }
  };

  const handleDownloadPng = async () => {
    if (!posterRef.current || isExportingPng) return;
    setIsExportingPng(true);
    try {
      const dataUrl = await renderPosterDataUrl();
      const link = document.createElement("a");
      const scopeSuffix =
        reportShiftScope === "day"
          ? "_DayShift"
          : reportShiftScope === "night"
          ? "_NightShift"
          : "";
      link.download = `Slit_Workforce_Report_${selectedDate}${scopeSuffix}.png`;
      link.href = dataUrl;
      link.click();
      showToast(
        isThai
          ? "ดาวน์โหลดภาพ Infographic PNG แล้ว — พร้อมส่งเข้า LINE ได้ทันที"
          : "Infographic PNG downloaded — ready to share on LINE"
      );
      onLogTransaction?.(
        `ดาวน์โหลดรายงาน Infographic กำลังพลสลิต/ฟิล์ม (${selectedDate})`,
        selectedDate,
        "Completed"
      );
    } catch (err) {
      console.error("Failed to export infographic PNG:", err);
      showToast(
        isThai ? "ไม่สามารถสร้างไฟล์ภาพได้ กรุณาลองใหม่อีกครั้ง" : "Export failed, please retry"
      );
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleCopyImageToClipboard = async () => {
    const el = posterRef.current;
    if (!el || isCopyingImage) return;
    setIsCopyingImage(true);
    try {
      const bgColor = posterTheme === "dark" ? "#071426" : "#ffffff";
      const captureOpts = {
        pixelRatio: 2.5,
        cacheBust: true,
        backgroundColor: bgColor,
        width: el.offsetWidth,
        height: el.offsetHeight,
        style: {
          margin: "0",
        },
      };
      let blob: Blob | null = null;
      try {
        blob = await toBlob(el, captureOpts);
      } catch {
        blob = await toBlob(el, {
          ...captureOpts,
          filter: (node) => !(node instanceof HTMLImageElement) || node.src.startsWith("data:"),
        });
      }

      if (
        blob &&
        typeof ClipboardItem !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === "function"
      ) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        showToast(
          isThai
            ? "คัดลอกภาพแล้ว! กดวาง (Ctrl+V) ในแชต LINE หัวหน้าได้ทันที"
            : "Image copied! Paste directly into LINE chat"
        );
      } else {
        await handleDownloadPng();
      }
    } catch (err) {
      console.error("Copy image fallback to download:", err);
      await handleDownloadPng();
    } finally {
      setIsCopyingImage(false);
    }
  };

  const buildLineSummaryText = () => {
    const scopeText =
      reportShiftScope === "day"
        ? "กะเช้า (08:00-20:00)"
        : reportShiftScope === "night"
        ? "กะดึก (20:00-08:00)"
        : "กะเช้า + กะดึก";

    const lines: string[] = [
      `รายงานการจัดกำลังพลประจำวัน — เหล็กสลิต / ฟิล์ม`,
      `วันที่: ${formatFullThaiDate(selectedDate)} (${selectedDate})`,
      `ขอบเขต: ${scopeText}`,
      `────────────────────────`,
      `สรุปภาพรวมกำลังพล:`,
      `• ปฏิบัติงานรวม: ${stats.workingTotal} คน (มอบหมายแล้ว ${stats.assignedTotal} คน)`,
      `• กะเช้า: ${stats.dayCount} คน | กะดึก: ${stats.nightCount} คน${
        stats.offCount > 0 ? ` | วันหยุด: ${stats.offCount} คน` : ""
      }`,
      `• กลุ่มเครื่องจักร: TM ${stats.groupStaffCount.TM} | CF ${stats.groupStaffCount.CF} | ML ${stats.groupStaffCount.ML} | ZF ${stats.groupStaffCount.ZF}`,
      `• ความครอบคลุมเครื่องจักร: ${stats.coveredMachineCount}/${ALL_MACHINE_CODES.length} เครื่อง`,
    ];

    const appendShiftBlock = (title: string, list: InfographicWorkforceRow[]) => {
      if (list.length === 0) return;
      lines.push(``);
      lines.push(`[${title} — ${list.length} คน]`);
      list.forEach((row, idx) => {
        const asn = row.assignment;
        const area = asn?.area && asn.area !== "-" ? asn.area : "-";
        const machines = formatMachinesForReport(asn, true);
        const duty = asn?.duty && asn.duty !== "-" ? asn.duty : "รอมอบหมาย";
        lines.push(`${idx + 1}. ${row.employeeName} | ${area} | ${machines} | ${duty}`);
      });
    };

    appendShiftBlock("กะเช้า 08:00-20:00", dayRows);
    appendShiftBlock("กะดึก 20:00-08:00", nightRows);
    appendShiftBlock("ยังไม่ระบุกะ", unassignedShiftRows);

    if (offRows.length > 0 && reportShiftScope === "all") {
      lines.push(``);
      lines.push(
        `วันหยุด (${offRows.length} คน): ${offRows.map((r) => r.employeeName).join(", ")}`
      );
    }

    lines.push(`────────────────────────`);
    lines.push(`ผู้รายงาน: ${recorder.label} (${generatedTime} น.)`);

    return lines.join("\n");
  };

  const handleCopyLineText = async () => {
    const text = buildLineSummaryText();
    try {
      await navigator.clipboard.writeText(text);
      showToast(
        isThai
          ? "คัดลอกข้อความสรุปสำหรับ LINE แล้ว — กดวางในแชตได้ทันที"
          : "LINE summary text copied to clipboard"
      );
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(
        isThai
          ? "คัดลอกข้อความสรุปสำหรับ LINE แล้ว"
          : "LINE summary text copied"
      );
    }
  };

  const isDarkPoster = posterTheme === "dark";

  const shiftScopeLabel =
    reportShiftScope === "day"
      ? isThai
        ? "กะเช้า (08:00 – 20:00)"
        : "Day Shift (08:00 – 20:00)"
      : reportShiftScope === "night"
      ? isThai
        ? "กะดึก (20:00 – 08:00)"
        : "Night Shift (20:00 – 08:00)"
      : isThai
      ? "ภาพรวมทุกกะ (กะเช้า + กะดึก)"
      : "Full Day (Day + Night Shifts)";

  const renderShiftRosterSection = (
    title: string,
    timeWindow: string,
    accentHex: string,
    list: InfographicWorkforceRow[]
  ) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-2.5">
        <div
          className={`flex items-center justify-between pb-1.5 border-b ${
            isDarkPoster ? "border-slate-700/80" : "border-slate-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-xs shrink-0"
              style={{ backgroundColor: accentHex }}
            />
            <h4
              className={`text-sm font-bold tracking-tight ${
                isDarkPoster ? "text-white" : "text-slate-900"
              }`}
            >
              {title}
            </h4>
            <span
              className={`text-xs font-mono tabular-nums ${
                isDarkPoster ? "text-slate-400" : "text-slate-500"
              }`}
            >
              {timeWindow}
            </span>
          </div>
          <span
            className={`text-xs font-mono font-bold tabular-nums ${
              isDarkPoster ? "text-sky-300" : "text-slate-700"
            }`}
          >
            {list.length} {isThai ? "คน" : "staff"}
          </span>
        </div>

        <div
          className={`rounded-lg border overflow-hidden ${
            isDarkPoster
              ? "border-slate-700/80 bg-[#0d1c36]"
              : "border-slate-200 bg-white"
          }`}
        >
          <table className="w-full table-fixed text-left border-collapse">
            <colgroup>
              <col className="w-[5%]" />
              <col className="w-[24%]" />
              <col className="w-[15%]" />
              <col className="w-[20%]" />
              <col className="w-[24%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr
                className={`text-[11px] font-semibold border-b ${
                  isDarkPoster
                    ? "bg-[#112445] text-slate-300 border-slate-700/80"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                }`}
              >
                <th className="py-2 pl-3 pr-1">#</th>
                <th className="py-2 px-2">{isThai ? "พนักงาน" : "Staff"}</th>
                <th className="py-2 px-2">{isThai ? "พื้นที่" : "Area"}</th>
                <th className="py-2 px-2">{isThai ? "เครื่องจักร" : "Machines"}</th>
                <th className="py-2 px-2">{isThai ? "หน้าที่รับผิดชอบ" : "Duty"}</th>
                <th className="py-2 pl-2 pr-3 text-right whitespace-nowrap">
                  {isThai ? "สถานะ" : "Status"}
                </th>
              </tr>
            </thead>
            <tbody
              className={`divide-y text-xs ${
                isDarkPoster ? "divide-slate-800/90" : "divide-slate-100"
              }`}
            >
              {list.map((row, idx) => {
                const asn = row.assignment;
                const area = asn?.area && asn.area !== "-" ? asn.area : "-";
                const duty = asn?.duty && asn.duty !== "-" ? asn.duty : "-";
                const machinesText = formatMachinesForReport(asn, isThai);
                const statusText = getStatusThai(asn?.status);
                const statusColor =
                  asn?.status === "active"
                    ? isDarkPoster
                      ? "text-emerald-400"
                      : "text-emerald-700"
                    : asn?.status === "standby"
                    ? isDarkPoster
                      ? "text-amber-400"
                      : "text-amber-700"
                    : isDarkPoster
                    ? "text-slate-400"
                    : "text-slate-500";
                const canShowImg = Boolean(row.photoUrl) && !brokenPhotos[row.rowKey];

                return (
                  <tr
                    key={row.rowKey}
                    className={
                      idx % 2 === 1
                        ? isDarkPoster
                          ? "bg-[#0a172e]/60"
                          : "bg-slate-50/50"
                        : ""
                    }
                  >
                    <td
                      className={`py-2 pl-3 pr-1 align-top font-mono tabular-nums text-[11px] ${
                        isDarkPoster ? "text-slate-500" : "text-slate-400"
                      }`}
                    >
                      {idx + 1}
                    </td>
                    <td className="py-2 px-2 align-top">
                      <div className="flex items-start gap-2 min-w-0">
                        {canShowImg ? (
                          <img
                            src={row.photoUrl}
                            alt={row.employeeName}
                            crossOrigin="anonymous"
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenPhotos((prev) => ({ ...prev, [row.rowKey]: true }))
                            }
                            className={`w-7 h-7 rounded-full object-cover shrink-0 border ${
                              isDarkPoster ? "border-slate-600" : "border-slate-200"
                            }`}
                          />
                        ) : (
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border ${
                              isDarkPoster
                                ? "bg-[#152a4e] border-slate-600 text-sky-200"
                                : "bg-slate-100 border-slate-200 text-slate-700"
                            }`}
                          >
                            {getInitials(row.employeeName)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div
                            className={`font-semibold leading-snug break-words ${
                              isDarkPoster ? "text-white" : "text-slate-900"
                            }`}
                          >
                            {row.employeeName}
                          </div>
                          {row.employeeId && (
                            <div
                              className={`text-[10px] font-mono break-all ${
                                isDarkPoster ? "text-slate-400" : "text-slate-500"
                              }`}
                            >
                              {row.employeeId}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td
                      className={`py-2 px-2 align-top font-medium leading-snug whitespace-normal break-words ${
                        isDarkPoster ? "text-slate-200" : "text-slate-700"
                      }`}
                    >
                      {area}
                    </td>
                    <td
                      className={`py-2 px-2 align-top font-mono text-[11px] font-semibold leading-snug whitespace-normal break-words ${
                        asn
                          ? isDarkPoster
                            ? "text-sky-300"
                            : "text-sky-700"
                          : isDarkPoster
                          ? "text-slate-500"
                          : "text-slate-400"
                      }`}
                    >
                      {machinesText}
                    </td>
                    <td
                      className={`py-2 px-2 align-top leading-snug whitespace-normal break-words ${
                        isDarkPoster ? "text-slate-200" : "text-slate-700"
                      }`}
                    >
                      {duty}
                      {asn?.notes && (
                        <div
                          className={`text-[10px] mt-0.5 leading-snug break-words ${
                            isDarkPoster ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          {asn.notes}
                        </div>
                      )}
                    </td>
                    <td
                      className={`py-2 pl-2 pr-3 align-top text-right text-[11px] font-semibold whitespace-nowrap ${statusColor}`}
                    >
                      {statusText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Action & Configuration Toolbar (Not included in exported PNG) */}
      <div className="bg-white dark:bg-[#0f1d36] border border-slate-200 dark:border-[#1e3a5f] rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackToTable}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#132544] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#193055] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeft size={14} />
              <span>{isThai ? "กลับหน้าตาราง" : "Back to Table"}</span>
            </button>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                {isThai
                  ? "รายงาน Infographic ประจำวัน (ส่ง LINE หัวหน้า)"
                  : "Daily Workforce Infographic Report (LINE Ready)"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {isThai
                  ? "ดาวน์โหลดเป็นภาพ PNG คมชัด หรือคัดลอกภาพ/ข้อความไปวางส่งในแชต LINE ได้ทันที"
                  : "Export as high-res PNG or copy directly to clipboard for LINE"}
              </p>
            </div>
          </div>

          {/* Primary Export Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyLineText}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-[#24426b] bg-white dark:bg-[#132544] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#193055] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <MessageSquareText size={14} />
              <span>{isThai ? "คัดลอกข้อความ LINE" : "Copy LINE Text"}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyImageToClipboard}
              disabled={isCopyingImage || isExportingPng}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-emerald-600/30 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-55 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Copy size={14} />
              <span>
                {isCopyingImage
                  ? isThai
                    ? "กำลังคัดลอกภาพ..."
                    : "Copying..."
                  : isThai
                  ? "คัดลอกภาพส่ง LINE"
                  : "Copy Image"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={isExportingPng || isCopyingImage}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-55 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download size={14} />
              <span>
                {isExportingPng
                  ? isThai
                    ? "กำลังสร้างภาพ..."
                    : "Exporting..."
                  : isThai
                  ? "ดาวน์โหลดภาพ PNG"
                  : "Download PNG"}
              </span>
            </button>
          </div>
        </div>

        {/* Report Scope & Theme Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100 dark:border-[#1a3154]">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Date Picker */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-[#24426b] bg-slate-50 dark:bg-[#0a1426] p-1">
              <button
                type="button"
                onClick={() => onChangeDate(addDaysToYmd(selectedDate, -1))}
                aria-label={isThai ? "วันก่อนหน้า" : "Previous day"}
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#193055] cursor-pointer"
              >
                <ChevronLeft size={14} />
              </button>
              <div className="flex items-center gap-1.5 px-1.5">
                <Calendar size={13} className="text-sky-600 dark:text-sky-400 shrink-0" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) onChangeDate(e.target.value);
                  }}
                  aria-label={isThai ? "วันที่รายงาน" : "Report date"}
                  className="bg-transparent text-xs font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none dark:[color-scheme:dark]"
                />
              </div>
              <button
                type="button"
                onClick={() => onChangeDate(addDaysToYmd(selectedDate, 1))}
                aria-label={isThai ? "วันถัดไป" : "Next day"}
                className="p-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#193055] cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Shift Scope */}
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0a1426] border border-slate-200 dark:border-[#1e3a5f]">
              {(
                [
                  { key: "all", label: isThai ? "ทั้งวัน (เช้า + ดึก)" : "Full Day" },
                  { key: "day", label: isThai ? "เฉพาะกะเช้า" : "Day Only" },
                  { key: "night", label: isThai ? "เฉพาะกะดึก" : "Night Only" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setReportShiftScope(tab.key)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    reportShiftScope === tab.key
                      ? "bg-white dark:bg-[#193055] text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Poster Visual Theme */}
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0a1426] border border-slate-200 dark:border-[#1e3a5f]">
              <button
                type="button"
                onClick={() => setPosterTheme("light")}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  posterTheme === "light"
                    ? "bg-white dark:bg-[#193055] text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Sun size={12} />
                <span>{isThai ? "โทนสว่าง" : "Light"}</span>
              </button>
              <button
                type="button"
                onClick={() => setPosterTheme("dark")}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  posterTheme === "dark"
                    ? "bg-white dark:bg-[#193055] text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Moon size={12} />
                <span>{isThai ? "โทนเข้ม" : "Dark"}</span>
              </button>
            </div>
          </div>

          {actionFeedback && (
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <Check size={14} />
              <span>{actionFeedback}</span>
            </div>
          )}
        </div>
      </div>

      {/* Centered Poster Preview Stage (Optimized for LINE Mobile & Desktop viewing) */}
      <div className="w-full overflow-x-auto pb-4">
        <div
          ref={posterRef}
          className={`mx-auto w-[820px] rounded-2xl border overflow-hidden shadow-lg ${
            isDarkPoster
              ? "bg-[#071426] border-slate-700/80 text-slate-100"
              : "bg-white border-slate-200 text-slate-900"
          }`}
        >
          {/* 1. Executive Poster Header Banner */}
          <div
            className="px-7 py-6 text-white"
            style={{
              background: isDarkPoster
                ? "linear-gradient(135deg, #0b1f3a 0%, #0f2c52 60%, #103766 100%)"
                : "linear-gradient(135deg, #0c2340 0%, #123663 60%, #0369a1 100%)",
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold tracking-wider text-sky-200/90">
                  DAILY WORKFORCE BRIEFING · ส่วนงานเหล็กสลิต / ฟิล์ม
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-white leading-snug">
                  {isThai
                    ? "รายงานสรุปการจัดกำลังพลประจำวัน"
                    : "Daily Slit / Film Workforce Summary"}
                </h1>
                <div className="text-xs text-sky-100/85">
                  {shiftScopeLabel}
                </div>
              </div>

              <div className="text-right shrink-0 border border-white/15 bg-white/10 rounded-xl px-4 py-2.5">
                <div className="text-[11px] text-sky-100/80 font-medium">
                  {isThai ? "วันที่ปฏิบัติงาน" : "Working Date"}
                </div>
                <div className="text-base font-bold text-white mt-0.5 whitespace-nowrap">
                  {formatFullThaiDate(selectedDate)}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-sky-200/90 mt-0.5">
                  {selectedDate}
                </div>
              </div>
            </div>
          </div>

          {/* Poster Body */}
          <div className="p-6 space-y-6">
            {/* 2. Top 4 KPI Summary Strip */}
            <div
              className={`grid grid-cols-4 divide-x rounded-xl border overflow-hidden ${
                isDarkPoster
                  ? "bg-[#0d1c36] border-slate-700/80 divide-slate-700/80"
                  : "bg-slate-50/70 border-slate-200 divide-slate-200"
              }`}
            >
              <div className="px-4 py-3.5">
                <div
                  className={`text-[11px] font-medium ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {isThai ? "กำลังพลปฏิบัติงาน" : "Active Staff"}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span
                    className={`text-3xl font-bold font-mono tabular-nums ${
                      isDarkPoster ? "text-white" : "text-slate-900"
                    }`}
                  >
                    {stats.workingTotal}
                  </span>
                  <span
                    className={`text-xs ${
                      isDarkPoster ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {isThai ? "คน" : "staff"}
                  </span>
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums mt-1 ${
                    isDarkPoster ? "text-emerald-400" : "text-emerald-700"
                  }`}
                >
                  {isThai
                    ? `มอบหมายแล้ว ${stats.assignedTotal} คน`
                    : `${stats.assignedTotal} assigned`}
                </div>
              </div>

              <div className="px-4 py-3.5">
                <div
                  className={`text-[11px] font-medium ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {isThai ? "กะเช้า (08:00–20:00)" : "Day Shift"}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold font-mono tabular-nums text-amber-500">
                    {stats.dayCount}
                  </span>
                  <span
                    className={`text-xs ${
                      isDarkPoster ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {isThai ? "คน" : "staff"}
                  </span>
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums mt-1 ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {stats.dayPct}% {isThai ? "ของกะทั้งหมด" : "of shifts"}
                </div>
              </div>

              <div className="px-4 py-3.5">
                <div
                  className={`text-[11px] font-medium ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {isThai ? "กะดึก (20:00–08:00)" : "Night Shift"}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span
                    className={`text-3xl font-bold font-mono tabular-nums ${
                      isDarkPoster ? "text-indigo-400" : "text-indigo-600"
                    }`}
                  >
                    {stats.nightCount}
                  </span>
                  <span
                    className={`text-xs ${
                      isDarkPoster ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {isThai ? "คน" : "staff"}
                  </span>
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums mt-1 ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {stats.nightPct}% {isThai ? "ของกะทั้งหมด" : "of shifts"}
                </div>
              </div>

              <div className="px-4 py-3.5">
                <div
                  className={`text-[11px] font-medium ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {isThai ? "ความครอบคลุมเครื่อง" : "Machine Coverage"}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span
                    className={`text-3xl font-bold font-mono tabular-nums ${
                      isDarkPoster ? "text-sky-400" : "text-sky-700"
                    }`}
                  >
                    {stats.coveredMachineCount}
                  </span>
                  <span
                    className={`text-sm font-mono tabular-nums ${
                      isDarkPoster ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    /{ALL_MACHINE_CODES.length}
                  </span>
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums mt-1 ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {Math.round((stats.coveredMachineCount / ALL_MACHINE_CODES.length) * 100)}%{" "}
                  {isThai ? "ของเครื่องทั้งหมด" : "covered"}
                </div>
              </div>
            </div>

            {/* 3. Visual Charts Row: Machine Group Bars + Area/Building Distribution */}
            <div className="grid grid-cols-2 gap-5">
              {/* Left Chart: Machine Group Staffing */}
              <div
                className={`rounded-xl border p-4 space-y-3 ${
                  isDarkPoster
                    ? "bg-[#0d1c36] border-slate-700/80"
                    : "bg-white border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3
                    className={`text-xs font-bold tracking-tight ${
                      isDarkPoster ? "text-white" : "text-slate-900"
                    }`}
                  >
                    {isThai
                      ? "กำลังพลแยกตามกลุ่มเครื่องจักร (TM · CF · ML · ZF)"
                      : "Staffing by Machine Group"}
                  </h3>
                  <span
                    className={`text-[11px] font-mono ${
                      isDarkPoster ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {isThai ? "คน / เครื่องที่ดูแล" : "Staff / Covered"}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {MACHINE_GROUP_META.map((grp) => {
                    const staffCount = stats.groupStaffCount[grp.key] || 0;
                    const coveredInGrp = grp.machines.filter(
                      (c) => (stats.machineStaffCount[c] || 0) > 0
                    ).length;
                    const widthPct =
                      staffCount > 0
                        ? Math.max(10, Math.round((staffCount / stats.maxGroupCount) * 100))
                        : 0;

                    return (
                      <div key={grp.key} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-xs shrink-0"
                              style={{ backgroundColor: grp.barColor }}
                            />
                            <span
                              className={`font-mono font-bold ${
                                isDarkPoster ? "text-white" : "text-slate-900"
                              }`}
                            >
                              {grp.key}
                            </span>
                            <span
                              className={`text-[11px] ${
                                isDarkPoster ? "text-slate-400" : "text-slate-500"
                              }`}
                            >
                              {isThai ? grp.labelTh.replace(/\s*\([^)]*\)/, "") : grp.labelEn}
                            </span>
                          </div>
                          <div className="font-mono tabular-nums text-[11px]">
                            <strong
                              className={isDarkPoster ? "text-white" : "text-slate-900"}
                            >
                              {staffCount} {isThai ? "คน" : ""}
                            </strong>
                            <span
                              className={`ml-1.5 ${
                                isDarkPoster ? "text-slate-400" : "text-slate-500"
                              }`}
                            >
                              · {coveredInGrp}/{grp.machines.length} เครื่อง
                            </span>
                          </div>
                        </div>
                        <div
                          className={`h-2.5 w-full rounded-sm overflow-hidden ${
                            isDarkPoster ? "bg-slate-800" : "bg-slate-100"
                          }`}
                        >
                          <div
                            className="h-full rounded-sm"
                            style={{
                              width: `${widthPct}%`,
                              backgroundColor: grp.barColor,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Chart: Area / Building Distribution + Shift Ratio Bar */}
              <div
                className={`rounded-xl border p-4 flex flex-col justify-between gap-3 ${
                  isDarkPoster
                    ? "bg-[#0d1c36] border-slate-700/80"
                    : "bg-white border-slate-200"
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3
                      className={`text-xs font-bold tracking-tight ${
                        isDarkPoster ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {isThai
                        ? "การกระจายกำลังพลตามพื้นที่ / อาคาร"
                        : "Deployment by Area / Building"}
                    </h3>
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        isDarkPoster ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {stats.areaBreakdown.length} {isThai ? "พื้นที่" : "areas"}
                    </span>
                  </div>

                  {stats.areaBreakdown.length === 0 ? (
                    <div
                      className={`py-6 text-center text-xs ${
                        isDarkPoster ? "text-slate-500" : "text-slate-400"
                      }`}
                    >
                      {isThai
                        ? "ยังไม่มีการกำหนดพื้นที่/อาคารในวันนี้"
                        : "No area assignments recorded yet"}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {stats.areaBreakdown.slice(0, 6).map((item) => {
                        const pct = Math.max(
                          12,
                          Math.round((item.count / stats.maxAreaCount) * 100)
                        );
                        return (
                          <div key={item.area} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span
                                className={`font-medium truncate pr-2 ${
                                  isDarkPoster ? "text-slate-200" : "text-slate-700"
                                }`}
                              >
                                {item.area}
                              </span>
                              <span
                                className={`font-mono font-bold tabular-nums shrink-0 ${
                                  isDarkPoster ? "text-sky-300" : "text-slate-900"
                                }`}
                              >
                                {item.count} {isThai ? "คน" : ""}
                              </span>
                            </div>
                            <div
                              className={`h-2 w-full rounded-sm overflow-hidden ${
                                isDarkPoster ? "bg-slate-800" : "bg-slate-100"
                              }`}
                            >
                              <div
                                className="h-full rounded-sm bg-sky-600"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Shift Split Ratio Bar */}
                <div
                  className={`pt-2.5 border-t space-y-1.5 ${
                    isDarkPoster ? "border-slate-700/80" : "border-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {isThai ? "กะเช้า" : "Day"} {stats.dayCount} ({stats.dayPct}%)
                    </span>
                    <span
                      className={`font-semibold ${
                        isDarkPoster ? "text-indigo-400" : "text-indigo-600"
                      }`}
                    >
                      {isThai ? "กะดึก" : "Night"} {stats.nightCount} ({stats.nightPct}%)
                    </span>
                  </div>
                  <div
                    className={`h-2.5 w-full rounded-sm overflow-hidden flex ${
                      isDarkPoster ? "bg-slate-800" : "bg-slate-100"
                    }`}
                  >
                    {stats.dayCount > 0 && (
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${stats.dayPct}%` }}
                      />
                    )}
                    {stats.nightCount > 0 && (
                      <div
                        className="h-full bg-indigo-500"
                        style={{ width: `${stats.nightPct}%` }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 4. 23-Machine Visual Coverage Matrix */}
            <div
              className={`rounded-xl border p-4 space-y-2.5 ${
                isDarkPoster
                  ? "bg-[#0d1c36] border-slate-700/80"
                  : "bg-slate-50/60 border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  className={`text-xs font-bold tracking-tight ${
                    isDarkPoster ? "text-white" : "text-slate-900"
                  }`}
                >
                  {isThai
                    ? "แผนผังการดูแลเครื่องจักรทั้ง 23 เครื่อง"
                    : "23-Machine Coverage Matrix"}
                </h3>
                <div
                  className={`flex items-center gap-3 text-[11px] ${
                    isDarkPoster ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-sky-600 inline-block" />
                    {isThai ? "มีผู้รับผิดชอบ" : "Covered"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`w-2.5 h-2.5 rounded-xs border inline-block ${
                        isDarkPoster
                          ? "bg-slate-800 border-slate-600"
                          : "bg-white border-slate-300"
                      }`}
                    />
                    {isThai ? "ยังไม่มีผู้รับผิดชอบ" : "Unassigned"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {MACHINE_GROUP_META.map((grp) => (
                  <div key={grp.key} className="flex items-start gap-2.5">
                    <div
                      className="w-9 pt-1 text-[11px] font-mono font-bold shrink-0"
                      style={{ color: grp.barColor }}
                    >
                      {grp.key}
                    </div>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {grp.machines.map((code) => {
                        const cnt = stats.machineStaffCount[code] || 0;
                        const active = cnt > 0;
                        return (
                          <div
                            key={code}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono font-semibold border ${
                              active
                                ? "text-white border-transparent"
                                : isDarkPoster
                                ? "bg-[#091529] border-slate-700/80 text-slate-500"
                                : "bg-white border-slate-200 text-slate-400"
                            }`}
                            style={active ? { backgroundColor: grp.barColor } : undefined}
                          >
                            <span>{code}</span>
                            {active && (
                              <span className="text-[10px] opacity-90 tabular-nums">
                                ×{cnt}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 5. Detailed Shift Roster Breakdown */}
            <div className="space-y-5">
              {renderShiftRosterSection(
                isThai ? "กำลังพลกะเช้า" : "Day Shift Roster",
                "08:00 – 20:00",
                "#f59e0b",
                dayRows
              )}
              {renderShiftRosterSection(
                isThai ? "กำลังพลกะดึก" : "Night Shift Roster",
                "20:00 – 08:00",
                "#6366f1",
                nightRows
              )}
              {renderShiftRosterSection(
                isThai ? "กำลังพลที่ยังไม่ระบุกะ" : "Unscheduled Shift",
                "—",
                "#64748b",
                unassignedShiftRows
              )}

              {dayRows.length === 0 &&
                nightRows.length === 0 &&
                unassignedShiftRows.length === 0 && (
                  <div
                    className={`rounded-xl border py-10 text-center text-xs ${
                      isDarkPoster
                        ? "border-slate-700/80 bg-[#0d1c36] text-slate-400"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  >
                    {isThai
                      ? "ไม่พบรายชื่อกำลังพลสำหรับกะและวันที่ที่เลือก"
                      : "No workforce records for the selected date and shift"}
                  </div>
                )}

              {/* Day Off Summary Footer Line */}
              {offRows.length > 0 && reportShiftScope === "all" && (
                <div
                  className={`rounded-lg border px-4 py-2.5 text-xs flex flex-wrap items-center gap-x-2 gap-y-1 ${
                    isDarkPoster
                      ? "bg-[#0d1c36] border-slate-700/80 text-slate-300"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                >
                  <strong className={isDarkPoster ? "text-slate-200" : "text-slate-800"}>
                    {isThai ? `วันหยุดตามตารางกะ (${offRows.length} คน):` : `Day Off (${offRows.length}):`}
                  </strong>
                  <span>{offRows.map((r) => r.employeeName).join(" · ")}</span>
                </div>
              )}
            </div>

            {/* 6. Poster Footer */}
            <div
              className={`pt-3.5 border-t flex items-center justify-between text-[11px] ${
                isDarkPoster
                  ? "border-slate-700/80 text-slate-400"
                  : "border-slate-200 text-slate-500"
              }`}
            >
              <div>
                {isThai ? "ผู้รายงาน:" : "Prepared by:"}{" "}
                <strong className={isDarkPoster ? "text-slate-200" : "text-slate-700"}>
                  {recorder.label}
                </strong>
                {" · "}
                {isThai ? `ออกรายงานเวลา ${generatedTime} น.` : `Generated ${generatedTime}`}
              </div>
              <div className="font-semibold">
                TMT Steel WMS · {isThai ? "ส่วนงานเหล็กสลิต / ฟิล์ม" : "Slit / Film Operations"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Subtle Helper Tip */}
      <div className="flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <ImageIcon size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
        <span>
          {isThai
            ? "เคล็ดลับ: กด \"คัดลอกภาพส่ง LINE\" แล้วกดวาง (Ctrl+V) ในห้องแชตหัวหน้า หรือกด \"ดาวน์โหลดภาพ PNG\" เพื่อส่งจากมือถือได้ทันที"
            : "Tip: Click Copy Image and paste directly in LINE Desktop, or Download PNG to share from mobile"}
        </span>
      </div>
    </div>
  );
}
