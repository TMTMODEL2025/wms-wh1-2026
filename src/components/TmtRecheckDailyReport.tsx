/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect } from "react";
import {
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Printer,
  Scale,
  Search,
  Share2,
  Truck,
  X,
} from "lucide-react";
import type { TmtRecheckVehicleGroup } from "./TmtRecheckView";
import { getActiveRecorderDisplay } from "../services/authWorkforceService";

interface TmtRecheckDailyReportProps {
  activeVehicles: TmtRecheckVehicleGroup[];
  completedReports: TmtRecheckVehicleGroup[];
  onOpenWeightTicket: (vehicleId?: string) => void;
  onViewPhotos: (group: TmtRecheckVehicleGroup) => void;
  onNavigateToInspector?: (vehicleId: string) => void;
}

function getLocalYmd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatThaiDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return ymd || "ทั้งหมด";
  const months = [
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
  const day = Number(m[3]);
  const month = months[Number(m[2]) - 1] || m[2];
  const buddhistYear = Number(m[1]) + 543;
  return `${day} ${month} ${buddhistYear}`;
}

function formatTimeHm(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    const match = /\d{2}:\d{2}/.exec(iso);
    return match ? `${match[0]} น.` : "-";
  }
  return `${d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.`;
}

function getVehicleDateYmd(v: TmtRecheckVehicleGroup): string {
  return v.completedDate || (v.completedAt ? v.completedAt.slice(0, 10) : "") || "ไม่ระบุวันที่";
}

function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => fallbackTextareaCopy(text));
  }
  return Promise.resolve(fallbackTextareaCopy(text));
}

function fallbackTextareaCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function TmtRecheckDailyReport({
  activeVehicles,
  completedReports,
  onOpenWeightTicket,
  onViewPhotos,
  onNavigateToInspector,
}: TmtRecheckDailyReportProps) {
  const todayYmd = getLocalYmd(0);
  const yesterdayYmd = getLocalYmd(-1);

  const [reportSearchQuery, setReportSearchQuery] = useState("");
  const [reportDateFilter, setReportDateFilter] = useState<string>(() => {
    const hasToday = completedReports.some((r) => getVehicleDateYmd(r) === getLocalYmd(0));
    return hasToday ? getLocalYmd(0) : "";
  });
  const [expandedVehicleIds, setExpandedVehicleIds] = useState<Record<string, boolean>>({});
  const [sectionView, setSectionView] = useState<"executive" | "details">("executive");

  // LINE Share Modal & Customization State
  const [isLineModalOpen, setIsLineModalOpen] = useState(false);
  const [includeVehicleDetails, setIncludeVehicleDetails] = useState(true);
  const [includeCustomerSummary, setIncludeCustomerSummary] = useState(true);
  const [includePendingQueue, setIncludePendingQueue] = useState(true);
  const [managerNote, setManagerNote] = useState("");
  const [reporterName, setReporterName] = useState(
    () => getActiveRecorderDisplay("เจ้าหน้าที่ TMT Recheck").employeeName
  );
  const [customLineText, setCustomLineText] = useState("");
  const [isTextManuallyEdited, setIsTextManuallyEdited] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [pngStatus, setPngStatus] = useState<string | null>(null);

  const filteredCompletedReports = useMemo(() => {
    return completedReports.filter((report) => {
      if (reportDateFilter && getVehicleDateYmd(report) !== reportDateFilter) return false;
      if (!reportSearchQuery.trim()) return true;
      const q = reportSearchQuery.toLowerCase();
      const matchVehicle = report.vehicleId.toLowerCase().includes(q);
      const matchCustomer = report.customerNames.some((c) => c.toLowerCase().includes(q));
      const matchDo = report.doNumbers.some((d) => d.toLowerCase().includes(q));
      const matchSo = report.soNumbers.some((s) => s.toLowerCase().includes(q));
      const matchBatch = report.items.some((i) => i.batch.toLowerCase().includes(q));
      return matchVehicle || matchCustomer || matchDo || matchSo || matchBatch;
    });
  }, [completedReports, reportDateFilter, reportSearchQuery]);

  // Analytics Summary
  const analytics = useMemo(() => {
    let totalWeightKg = 0;
    let totalItems = 0;
    let totalScannedCoils = 0;
    let totalScrapItems = 0;
    let totalPhotos = 0;
    const customerMap = new Map<
      string,
      { customerName: string; vehicleCount: number; itemCount: number; weightKg: number }
    >();
    const doSet = new Set<string>();

    filteredCompletedReports.forEach((v) => {
      totalWeightKg += v.totalGrossWeight || 0;
      totalItems += v.items.length;
      totalPhotos += v.photos?.length || 0;
      v.doNumbers.forEach((d) => d && doSet.add(d));

      v.items.forEach((item) => {
        if (item.requiresScan && item.scanned) totalScannedCoils += 1;
        if (!item.requiresScan) totalScrapItems += 1;
      });

      // Group weight by customer per item for accurate customer breakdown
      const seenCustForVehicle = new Set<string>();
      v.items.forEach((item) => {
        const cname = item.customerName || "ไม่ระบุชื่อลูกค้า";
        const cur = customerMap.get(cname) || {
          customerName: cname,
          vehicleCount: 0,
          itemCount: 0,
          weightKg: 0,
        };
        cur.itemCount += 1;
        cur.weightKg += item.grossWeight || 0;
        if (!seenCustForVehicle.has(cname)) {
          cur.vehicleCount += 1;
          seenCustForVehicle.add(cname);
        }
        customerMap.set(cname, cur);
      });
    });

    const customers = Array.from(customerMap.values()).sort((a, b) => b.weightKg - a.weightKg);
    const pendingWeightKg = activeVehicles.reduce((sum, v) => sum + (v.totalGrossWeight || 0), 0);

    return {
      totalVehicles: filteredCompletedReports.length,
      totalWeightKg,
      totalWeightTon: (totalWeightKg / 1000).toFixed(2),
      totalItems,
      totalScannedCoils,
      totalScrapItems,
      totalPhotos,
      totalDoCount: doSet.size,
      customers,
      pendingWeightKg,
    };
  }, [filteredCompletedReports, activeVehicles]);

  // Build LINE Executive Summary Message
  const generatedLineMessage = useMemo(() => {
    const reportPeriodLabel = reportDateFilter
      ? formatThaiDateLabel(reportDateFilter)
      : `รวมทุกวัน (${formatThaiDateLabel(todayYmd)})`;
    const nowTime = new Date().toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const lines: string[] = [
      `📊 สรุปรายงาน TMT Recheck ประจำวัน`,
      `📅 ประจำวันที่: ${reportPeriodLabel}`,
      `🕒 เวลาสรุปรายงาน: ${nowTime} น.`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `✅ ตรวจขึ้นสินค้าเสร็จสิ้น: ${analytics.totalVehicles} คัน (${analytics.totalDoCount} DO)`,
      `📦 รายการทั้งหมด: ${analytics.totalItems} รายการ (สแกน ${analytics.totalScannedCoils} ม้วน${
        analytics.totalScrapItems > 0 ? ` · เศษ ${analytics.totalScrapItems} รายการ` : ""
      })`,
      `⚖️ น้ำหนักรวมสุทธิ: ${analytics.totalWeightKg.toLocaleString()} กก. (${analytics.totalWeightTon} ตัน)`,
      `📸 รูปภาพหลักฐาน: ${analytics.totalPhotos} รูป`,
      `⏳ คิวรอตรวจคงเหลือ: ${activeVehicles.length} คัน (${analytics.pendingWeightKg.toLocaleString()} กก.)`,
    ];

    if (includeCustomerSummary && analytics.customers.length > 0) {
      lines.push(``);
      lines.push(`🏢 สรุปตามลูกค้า (${analytics.customers.length} ราย):`);
      analytics.customers.forEach((c, idx) => {
        lines.push(
          `${idx + 1}. ${c.customerName} — ${c.vehicleCount} คัน · ${c.weightKg.toLocaleString()} กก.`
        );
      });
    }

    if (includeVehicleDetails) {
      lines.push(``);
      if (filteredCompletedReports.length === 0) {
        lines.push(`🚛 รายการรถที่ตรวจปล่อยแล้ว: ยังไม่มีรายการในวันที่เลือก`);
      } else {
        lines.push(`🚛 รายละเอียดรถที่ตรวจปล่อยแล้ว (${filteredCompletedReports.length} คัน):`);
        filteredCompletedReports.forEach((v, idx) => {
          const scannedCount = v.items.filter((i) => i.requiresScan && i.scanned).length;
          const scrapCount = v.items.filter((i) => !i.requiresScan).length;
          const itemParts: string[] = [];
          if (scannedCount > 0) itemParts.push(`${scannedCount} ม้วน`);
          if (scrapCount > 0) itemParts.push(`เศษ ${scrapCount}`);
          const countText = itemParts.length > 0 ? itemParts.join("+") : `${v.items.length} รายการ`;
          const cust = v.customerNames.join(", ") || "-";
          const doTxt = v.doNumbers.join(", ") || "-";
          lines.push(
            `${idx + 1}. ${v.vehicleId} | ${cust}`,
            `   • น้ำหนัก ${v.totalGrossWeight.toLocaleString()} กก. (${countText}) · DO: ${doTxt} · เสร็จ ${formatTimeHm(
              v.completedAt
            )} (รูป ${v.photos?.length || 0})`
          );
        });
      }
    }

    if (includePendingQueue && activeVehicles.length > 0) {
      lines.push(``);
      lines.push(`⏳ คิวรถรอตรวจคงเหลือหน้างาน (${activeVehicles.length} คัน):`);
      activeVehicles.forEach((v, idx) => {
        const reqCount = v.items.filter((i) => i.requiresScan).length;
        const scannedCount = v.items.filter((i) => i.requiresScan && i.scanned).length;
        const statusLabel =
          v.status === "ready_to_inspect"
            ? "พร้อมตรวจสอบ"
            : v.status === "scanning"
            ? `กำลังสแกน ${scannedCount}/${reqCount}`
            : "รอตรวจสอบ";
        lines.push(
          `${idx + 1}. ${v.vehicleId} | ${v.customerNames.join(", ")} (${v.totalGrossWeight.toLocaleString()} กก.) [${statusLabel}]`
        );
      });
    }

    if (managerNote.trim()) {
      lines.push(``);
      lines.push(`📝 หมายเหตุ: ${managerNote.trim()}`);
    }

    lines.push(``);
    lines.push(`👤 ผู้สรุปรายงาน: ${reporterName.trim() || "เจ้าหน้าที่ TMT Recheck"}`);

    return lines.join("\n");
  }, [
    reportDateFilter,
    todayYmd,
    analytics,
    activeVehicles,
    includeCustomerSummary,
    includeVehicleDetails,
    includePendingQueue,
    filteredCompletedReports,
    managerNote,
    reporterName,
  ]);

  useEffect(() => {
    if (!isTextManuallyEdited) {
      setCustomLineText(generatedLineMessage);
    }
  }, [generatedLineMessage, isTextManuallyEdited]);

  const activeLineMessage = isTextManuallyEdited ? customLineText : generatedLineMessage;
  const lineShareHref = `https://line.me/R/share?text=${encodeURIComponent(activeLineMessage)}`;

  const handleOpenLineModal = () => {
    setIsTextManuallyEdited(false);
    setCustomLineText(generatedLineMessage);
    setCopyStatus("idle");
    setPngStatus(null);
    setIsLineModalOpen(true);
  };

  const handleCopyForLine = async () => {
    const ok = await copyTextWithFallback(activeLineMessage);
    setCopyStatus(ok ? "copied" : "error");
    if (ok) {
      setTimeout(() => setCopyStatus("idle"), 3500);
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `สรุปรายงาน TMT Recheck ${
            reportDateFilter ? formatThaiDateLabel(reportDateFilter) : formatThaiDateLabel(todayYmd)
          }`,
          text: activeLineMessage,
        });
      } catch {
        // User cancelled share dialog
      }
    }
  };

  const handleExportSummaryPng = () => {
    if (typeof document === "undefined") return;
    try {
      const rows = filteredCompletedReports.slice(0, 18);
      const rowHeight = 46;
      const baseHeight = 430 + Math.max(1, rows.length) * rowHeight + (activeVehicles.length > 0 ? 70 : 0);
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = Math.max(640, baseHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // White crisp card canvas
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header Banner
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, 132);
      ctx.fillStyle = "#06b6d4";
      ctx.fillRect(0, 126, canvas.width, 6);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 32px 'Noto Sans Thai', sans-serif";
      ctx.fillText("สรุปรายงาน TMT Recheck ประจำวัน (Executive Report)", 44, 58);

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "500 20px 'Noto Sans Thai', sans-serif";
      const dateTxt = reportDateFilter ? formatThaiDateLabel(reportDateFilter) : `ทุกวัน (ณ ${formatThaiDateLabel(todayYmd)})`;
      const nowTime = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
      ctx.fillText(`ประจำวันที่: ${dateTxt}   |   เวลาสรุป: ${nowTime} น.   |   ผู้สรุป: ${reporterName || "-"}`, 44, 98);

      // 4 KPI Cards
      const kpis = [
        { label: "ตรวจปล่อยแล้ว", val: `${analytics.totalVehicles} คัน`, sub: `${analytics.totalDoCount} DO`, color: "#0284c7" },
        { label: "น้ำหนักรวมสุทธิ", val: `${analytics.totalWeightTon} ตัน`, sub: `${analytics.totalWeightKg.toLocaleString()} กก.`, color: "#059669" },
        { label: "รายการ / Batch", val: `${analytics.totalItems} รายการ`, sub: `สแกน ${analytics.totalScannedCoils} ม้วน`, color: "#0891b2" },
        { label: "คิวรอตรวจหน้างาน", val: `${activeVehicles.length} คัน`, sub: `${analytics.pendingWeightKg.toLocaleString()} กก.`, color: "#d97706" },
      ];
      kpis.forEach((k, idx) => {
        const x = 44 + idx * 252;
        const y = 160;
        const w = 236;
        const h = 114;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 2;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = k.color;
        ctx.fillRect(x, y, w, 5);

        ctx.fillStyle = "#64748b";
        ctx.font = "600 16px 'Noto Sans Thai', sans-serif";
        ctx.fillText(k.label, x + 16, y + 34);

        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 28px 'Noto Sans Thai', sans-serif";
        ctx.fillText(k.val, x + 16, y + 72);

        ctx.fillStyle = "#64748b";
        ctx.font = "500 15px 'Noto Sans Thai', sans-serif";
        ctx.fillText(k.sub, x + 16, y + 98);
      });

      // Table Header
      const tableY = 304;
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 21px 'Noto Sans Thai', sans-serif";
      ctx.fillText(`รายละเอียดรถที่ตรวจปล่อยแล้ว (${filteredCompletedReports.length} คัน)`, 44, tableY);

      const headerY = tableY + 20;
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(44, headerY, 992, 42);
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 16px 'Noto Sans Thai', sans-serif";
      ctx.fillText("#", 58, headerY + 27);
      ctx.fillText("ทะเบียนรถ", 104, headerY + 27);
      ctx.fillText("ลูกค้า", 260, headerY + 27);
      ctx.fillText("DO", 620, headerY + 27);
      ctx.fillText("รายการ", 785, headerY + 27);
      ctx.fillText("น้ำหนัก (กก.)", 895, headerY + 27);

      if (rows.length === 0) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(44, headerY + 42, 992, rowHeight);
        ctx.fillStyle = "#64748b";
        ctx.font = "500 17px 'Noto Sans Thai', sans-serif";
        ctx.fillText("ยังไม่มีรถที่ตรวจสอบเสร็จสิ้นในวันที่เลือก", 350, headerY + 72);
      } else {
        rows.forEach((v, idx) => {
          const ry = headerY + 42 + idx * rowHeight;
          ctx.fillStyle = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
          ctx.fillRect(44, ry, 992, rowHeight);
          ctx.strokeStyle = "#e2e8f0";
          ctx.lineWidth = 1;
          ctx.strokeRect(44, ry, 992, rowHeight);

          ctx.fillStyle = "#475569";
          ctx.font = "500 16px 'Noto Sans Thai', sans-serif";
          ctx.fillText(String(idx + 1), 58, ry + 29);

          ctx.fillStyle = "#0369a1";
          ctx.font = "bold 17px 'Noto Sans Thai', sans-serif";
          ctx.fillText(v.vehicleId.slice(0, 14), 104, ry + 29);

          ctx.fillStyle = "#0f172a";
          ctx.font = "500 16px 'Noto Sans Thai', sans-serif";
          const cust = (v.customerNames.join(", ") || "-").slice(0, 28);
          ctx.fillText(cust, 260, ry + 29);

          ctx.fillStyle = "#334155";
          const doTxt = (v.doNumbers.join(", ") || "-").slice(0, 14);
          ctx.fillText(doTxt, 620, ry + 29);

          ctx.fillText(`${v.items.length} รายการ`, 785, ry + 29);

          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 17px 'Noto Sans Thai', sans-serif";
          ctx.fillText(v.totalGrossWeight.toLocaleString(), 895, ry + 29);
        });
      }

      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `TMT-Recheck-Report-${reportDateFilter || todayYmd}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setPngStatus("ดาวน์โหลดภาพสรุปรายงานสำเร็จ สามารถแนบรูปลงกลุ่ม LINE ได้ทันที");
    } catch {
      setPngStatus("ไม่สามารถสร้างไฟล์ภาพได้ กรุณาใช้ปุ่มคัดลอกข้อความแทน");
    }
  };

  const toggleExpandVehicle = (vehicleId: string) => {
    setExpandedVehicleIds((prev) => ({
      ...prev,
      [vehicleId]: !prev[vehicleId],
    }));
  };

  const expandAllVehicles = () => {
    const next: Record<string, boolean> = {};
    filteredCompletedReports.forEach((v) => {
      next[v.vehicleId] = true;
    });
    setExpandedVehicleIds(next);
  };

  const collapseAllVehicles = () => {
    setExpandedVehicleIds({});
  };

  return (
    <div className="space-y-3 w-full max-w-none">
      {/* Executive Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                รายงานสรุป TMT Recheck ประจำวัน
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>สรุปยอดตรวจปล่อยรถขึ้นสินค้าเข้ากลุ่ม LINE สำหรับผู้จัดการ</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                ช่วงข้อมูล: {reportDateFilter ? formatThaiDateLabel(reportDateFilter) : "ทุกวันทั้งหมด"}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {analytics.totalVehicles} คัน · {analytics.totalWeightTon} ตัน
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenLineModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-xs transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap"
              style={{ backgroundColor: "#06C755" }}
            >
              <MessageCircle size={15} />
              <span>แชร์เข้ากลุ่ม LINE</span>
            </button>

            <button
              type="button"
              onClick={handleExportSummaryPng}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 transition-colors whitespace-nowrap cursor-pointer"
              title="บันทึกเป็นรูปภาพเพื่อส่งลงกลุ่ม LINE"
            >
              <Download size={14} />
              <span>บันทึกรูปส่ง LINE</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenWeightTicket()}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 dark:text-amber-200 dark:border-amber-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Scale size={14} />
              <span>พิมพ์บัตรชั่ง</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Printer size={14} />
              <span>พิมพ์</span>
            </button>
          </div>
        </div>

        {pngStatus && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200 text-xs flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={14} />
              {pngStatus}
            </span>
            <button type="button" onClick={() => setPngStatus(null)} className="opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Filter Bar (Strict 35px / 12px / borderRadius 6px standard) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 sm:px-[18px] sm:py-3 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              size={14}
            />
            <input
              type="text"
              value={reportSearchQuery}
              onChange={(e) => setReportSearchQuery(e.target.value)}
              placeholder="ค้นหาทะเบียนรถ, ชื่อลูกค้า, DO, SO หรือ Batch..."
              className="field w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-normal focus:outline-none focus:border-cyan-500"
              style={{
                width: "100%",
                height: 35,
                minHeight: 35,
                padding: "7px 10px 7px 32px",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </div>

          <div className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setReportDateFilter(todayYmd)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                reportDateFilter === todayYmd
                  ? "bg-white dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              วันนี้
            </button>
            <button
              type="button"
              onClick={() => setReportDateFilter(yesterdayYmd)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                reportDateFilter === yesterdayYmd
                  ? "bg-white dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              เมื่อวาน
            </button>
            <button
              type="button"
              onClick={() => setReportDateFilter("")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                reportDateFilter === ""
                  ? "bg-white dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              ทั้งหมด
            </button>
          </div>

          <input
            type="date"
            value={reportDateFilter}
            onChange={(e) => setReportDateFilter(e.target.value)}
            className="field bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-normal dark:[color-scheme:dark] focus:outline-none focus:border-cyan-500"
            style={{
              height: 35,
              minHeight: 35,
              padding: "6px 8px",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => setSectionView("executive")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                sectionView === "executive"
                  ? "bg-white dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              สรุปผู้จัดการ
            </button>
            <button
              type="button"
              onClick={() => setSectionView("details")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                sectionView === "details"
                  ? "bg-white dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              รายละเอียดราย Batch
            </button>
          </div>

          <button
            type="button"
            onClick={expandAllVehicles}
            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-cyan-300 dark:border-slate-700 rounded-md text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <ChevronDown size={13} />
            <span>ขยายทั้งหมด</span>
          </button>
          <button
            type="button"
            onClick={collapseAllVehicles}
            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 rounded-md text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <ChevronUp size={13} />
            <span>ย่อทั้งหมด</span>
          </button>
        </div>
      </div>

      {/* 4-Column Executive KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            รถที่ตรวจปล่อยแล้ว
          </div>
          <div className="mt-1 text-2xl font-extrabold font-mono tabular-nums text-sky-700 dark:text-cyan-300">
            {analytics.totalVehicles}{" "}
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">คัน</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {analytics.totalDoCount} DO · ลูกค้า {analytics.customers.length} ราย
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            น้ำหนักรวมสุทธิ
          </div>
          <div className="mt-1 text-2xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {analytics.totalWeightTon}{" "}
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">ตัน</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {analytics.totalWeightKg.toLocaleString()} กก.
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            ปริมาณม้วน / รูปหลักฐาน
          </div>
          <div className="mt-1 text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {analytics.totalScannedCoils}{" "}
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              ม้วนสแกน
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            รวม {analytics.totalItems} รายการ · รูป {analytics.totalPhotos} รูป
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            คิวรอตรวจคงเหลือ (หน้างาน)
          </div>
          <div
            className={`mt-1 text-2xl font-extrabold font-mono tabular-nums ${
              activeVehicles.length > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-slate-700 dark:text-slate-300"
            }`}
          >
            {activeVehicles.length}{" "}
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">คัน</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            น้ำหนักค้างคิว {analytics.pendingWeightKg.toLocaleString()} กก.
          </div>
        </div>
      </div>

      {/* Executive Summary Tables (2-Column Balanced Split) */}
      {sectionView === "executive" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left: Manager Dispatch Summary Table */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={15} className="text-sky-600 dark:text-cyan-400" />
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                  สรุปรถที่ตรวจสอบเสร็จสิ้น ({filteredCompletedReports.length} คัน)
                </h4>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {reportDateFilter ? formatThaiDateLabel(reportDateFilter) : "ทุกวัน"}
              </span>
            </div>

            {filteredCompletedReports.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <FileText size={32} className="mx-auto text-slate-400 dark:text-slate-600" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ไม่พบรถที่ตรวจขึ้นสินค้าเสร็จสิ้นในช่วงที่เลือก
                </p>
                {reportDateFilter !== "" && completedReports.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setReportDateFilter("")}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800 cursor-pointer"
                  >
                    แสดงรายงานทั้งหมด ({completedReports.length} คัน)
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800 whitespace-nowrap">
                      <th className="py-2.5 px-3 text-center">#</th>
                      <th className="py-2.5 px-3">ทะเบียนรถ</th>
                      <th className="py-2.5 px-3">ลูกค้า</th>
                      <th className="py-2.5 px-3">DO</th>
                      <th className="py-2.5 px-3 text-center">รายการ</th>
                      <th className="py-2.5 px-3 text-right">น้ำหนัก (กก.)</th>
                      <th className="py-2.5 px-3 text-center">เวลาเสร็จ</th>
                      <th className="py-2.5 px-3 text-right">หลักฐาน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                    {filteredCompletedReports.map((v, idx) => {
                      const scanned = v.items.filter((i) => i.requiresScan && i.scanned).length;
                      return (
                        <tr
                          key={`${v.vehicleId}-${v.completedAt || idx}`}
                          onClick={() => {
                            setSectionView("details");
                            setExpandedVehicleIds((prev) => ({ ...prev, [v.vehicleId]: true }));
                          }}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                        >
                          <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-sky-700 dark:text-cyan-300 whitespace-nowrap">
                            {v.vehicleId}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100 max-w-[180px] truncate">
                            {v.customerNames.join(", ") || "-"}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {v.doNumbers.join(", ") || "-"}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            {scanned > 0 ? `${scanned} ม้วน` : `${v.items.length} รายการ`}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                            {v.totalGrossWeight.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {formatTimeHm(v.completedAt)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {v.photos.length > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewPhotos(v);
                                }}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 dark:text-cyan-400 dark:hover:text-cyan-300 underline cursor-pointer"
                              >
                                <ImageIcon size={12} />
                                {v.photos.length} รูป
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 dark:bg-slate-950 font-bold border-t border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white">
                      <td colSpan={4} className="py-2.5 px-3">
                        รวมทั้งหมด ({analytics.totalVehicles} คัน)
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                        {analytics.totalItems} รายการ
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {analytics.totalWeightKg.toLocaleString()} กก.
                      </td>
                      <td colSpan={2} className="py-2.5 px-3 text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                        ({analytics.totalWeightTon} ตัน)
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Right: Customer Breakdown & Pending Queue */}
          <div className="lg:col-span-5 space-y-4">
            {/* Customer Summary Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Building2 size={15} className="text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    สรุปยอดส่งแยกลูกค้า ({analytics.customers.length} ราย)
                  </h4>
                </div>
              </div>

              {analytics.customers.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-3 text-center">
                  ยังไม่มีข้อมูลลูกค้าในช่วงวันที่เลือก
                </p>
              ) : (
                <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
                  {analytics.customers.map((c) => {
                    const pct =
                      analytics.totalWeightKg > 0
                        ? Math.round((c.weightKg / analytics.totalWeightKg) * 100)
                        : 0;
                    return (
                      <div key={c.customerName} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {c.customerName}
                          </span>
                          <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white shrink-0">
                            {c.weightKg.toLocaleString()} กก.
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${Math.min(100, Math.max(4, pct))}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                            {c.vehicleCount} คัน · {pct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active / Pending Queue Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Clock size={15} className="text-amber-600 dark:text-amber-400" />
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                    คิวรถรอตรวจหน้างานปัจจุบัน ({activeVehicles.length} คัน)
                  </h4>
                </div>
              </div>

              {activeVehicles.length === 0 ? (
                <div className="py-3 text-center text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  ไม่มีรถค้างรอตรวจในคิวหน้างาน
                </div>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {activeVehicles.map((v) => {
                    const req = v.items.filter((i) => i.requiresScan).length;
                    const scanned = v.items.filter((i) => i.requiresScan && i.scanned).length;
                    return (
                      <div
                        key={v.vehicleId}
                        className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono font-bold text-sky-700 dark:text-cyan-300">
                              {v.vehicleId}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">·</span>
                            <span className="text-slate-700 dark:text-slate-200 truncate">
                              {v.customerNames.join(", ")}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                            {v.totalGrossWeight.toLocaleString()} กก. · สแกน {scanned}/{req} ·{" "}
                            {v.status === "ready_to_inspect"
                              ? "พร้อมตรวจสอบ"
                              : v.status === "scanning"
                              ? "กำลังสแกน"
                              : "รอตรวจสอบ"}
                          </div>
                        </div>
                        {onNavigateToInspector && (
                          <button
                            type="button"
                            onClick={() => onNavigateToInspector(v.vehicleId)}
                            className="shrink-0 px-2.5 py-1 rounded text-[11px] font-semibold bg-white hover:bg-slate-100 text-sky-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-cyan-300 dark:border-slate-700 cursor-pointer"
                          >
                            ตรวจคันนี้
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detailed Vehicle & Batch Accordions */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
            รายละเอียดรายการ Batch รายคัน ({filteredCompletedReports.length} คัน)
          </h4>
        </div>

        {filteredCompletedReports.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-2">
            <FileText size={32} className="mx-auto text-slate-400 dark:text-slate-600" />
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              ยังไม่มีรายงานการขึ้นสินค้าที่ตรวจสอบเสร็จสิ้นในช่วงที่เลือก
            </p>
          </div>
        ) : (
          filteredCompletedReports.map((v, vIdx) => {
            const dateStr = getVehicleDateYmd(v);
            const custName = v.customerNames.join(", ") || "ไม่ระบุชื่อลูกค้า";
            const isExpanded = Boolean(expandedVehicleIds[v.vehicleId]);

            return (
              <div
                key={`${v.vehicleId}-${v.completedAt || vIdx}`}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs"
              >
                <div
                  onClick={() => toggleExpandVehicle(v.vehicleId)}
                  className="bg-slate-50/80 dark:bg-slate-950 p-2.5 sm:px-4 border-b border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-900/90 transition-colors select-none"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-sky-700 dark:text-cyan-400 shrink-0">
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-cyan-300 font-semibold text-xs inline-flex items-center gap-1">
                      <Calendar size={12} className="text-sky-600 dark:text-cyan-400" />
                      {dateStr}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span className="font-mono font-extrabold text-slate-900 dark:text-white text-sm">
                      {v.vehicleId}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-medium truncate max-w-[180px] sm:max-w-[340px]">
                      {custName}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono tabular-nums text-[11px] shrink-0">
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold inline-flex items-center gap-1 font-sans">
                      <CheckCircle2 size={12} />
                      ตรวจเสร็จสิ้น ({formatTimeHm(v.completedAt)})
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenWeightTicket(v.vehicleId);
                      }}
                      className="hidden sm:inline-flex text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300 items-center gap-1 font-sans text-xs underline font-semibold cursor-pointer whitespace-nowrap"
                    >
                      <Scale size={13} />
                      บัตรชั่ง
                    </button>

                    {v.photos.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewPhotos(v);
                        }}
                        className="text-sky-700 hover:text-sky-900 dark:text-cyan-400 dark:hover:text-cyan-300 flex items-center gap-1 font-sans text-xs underline font-semibold cursor-pointer"
                      >
                        <ImageIcon size={13} />
                        รูปหลักฐาน ({v.photos.length})
                      </button>
                    )}

                    <strong className="text-slate-900 dark:text-slate-100 font-extrabold text-xs">
                      {v.totalGrossWeight.toLocaleString()} kg
                    </strong>
                  </div>
                </div>

                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] text-left text-slate-700 dark:text-slate-300">
                      <thead className="bg-slate-50 dark:bg-slate-900/90 text-slate-600 dark:text-slate-400 font-bold uppercase text-[10px] border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2 px-3 font-mono">BATCH</th>
                          <th className="py-2 px-3">DESCRIPTION</th>
                          <th className="py-2 px-3 text-right font-mono">น้ำหนัก (KG)</th>
                          <th className="py-2 px-3 font-mono">SO</th>
                          <th className="py-2 px-3 font-mono">DO</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60 bg-white dark:bg-slate-950/30">
                        {v.items.map((item, idx) => (
                          <tr
                            key={item.id || idx}
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-2 px-3 font-mono font-bold text-sky-700 dark:text-cyan-300 whitespace-nowrap">
                              {item.batch || (
                                <span className="text-amber-600 dark:text-amber-400 text-[10px] font-sans">
                                  (เศษ)
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-800 dark:text-slate-200">
                              {item.description}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {item.grossWeight.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {item.soNo}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {item.doNo}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* LINE GROUP SHARE MODAL */}
      {isLineModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: "#06C755" }}
                >
                  <MessageCircle size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    แชร์รายงาน TMT Recheck ประจำวันเข้ากลุ่ม LINE
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ตรวจสอบหรือปรับแก้ข้อความสรุปก่อนส่งให้ผู้จัดการในกลุ่ม LINE
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsLineModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Summary Toggle Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    ผู้สรุปรายงาน
                  </label>
                  <input
                    type="text"
                    value={reporterName}
                    onChange={(e) => {
                      setReporterName(e.target.value);
                      setIsTextManuallyEdited(false);
                    }}
                    className="field w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    style={{
                      height: 35,
                      minHeight: 35,
                      padding: "7px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 400,
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    หมายเหตุถึงผู้จัดการ (ถ้ามี)
                  </label>
                  <input
                    type="text"
                    value={managerNote}
                    onChange={(e) => {
                      setManagerNote(e.target.value);
                      setIsTextManuallyEdited(false);
                    }}
                    placeholder="เช่น ตรวจปล่อยรอบเช้าครบเรียบร้อย / รอบบ่ายรอเข้า 2 คัน"
                    className="field w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    style={{
                      height: 35,
                      minHeight: 35,
                      padding: "7px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 400,
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeCustomerSummary}
                    onChange={(e) => {
                      setIncludeCustomerSummary(e.target.checked);
                      setIsTextManuallyEdited(false);
                    }}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>รวมสรุปตามลูกค้า</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeVehicleDetails}
                    onChange={(e) => {
                      setIncludeVehicleDetails(e.target.checked);
                      setIsTextManuallyEdited(false);
                    }}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>รวมรายละเอียดรถรายคัน</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includePendingQueue}
                    onChange={(e) => {
                      setIncludePendingQueue(e.target.checked);
                      setIsTextManuallyEdited(false);
                    }}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>รวมคิวรถค้างรอตรวจ ({activeVehicles.length} คัน)</span>
                </label>
              </div>

              {/* Editable Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    ตัวอย่างข้อความที่จะส่งเข้ากลุ่ม LINE
                  </span>
                  {isTextManuallyEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsTextManuallyEdited(false);
                        setCustomLineText(generatedLineMessage);
                      }}
                      className="text-sky-700 dark:text-cyan-400 underline text-[11px] cursor-pointer"
                    >
                      รีเซ็ตข้อความอัตโนมัติ
                    </button>
                  )}
                </div>
                <textarea
                  rows={12}
                  value={activeLineMessage}
                  onChange={(e) => {
                    setCustomLineText(e.target.value);
                    setIsTextManuallyEdited(true);
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:border-emerald-500"
                />
              </div>

              {copyStatus === "copied" && (
                <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 font-medium">
                  <Check size={14} />
                  คัดลอกข้อความสำเร็จ! สามารถกดวาง (Paste) ในกลุ่ม LINE ผู้จัดการได้เลย
                </div>
              )}
              {copyStatus === "error" && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200 text-xs">
                  เบราว์เซอร์จำกัดการคัดลอกอัตโนมัติ กรุณากดเลือกข้อความด้านบนแล้วคัดลอกด้วยตนเอง (Ctrl+C)
                </div>
              )}
            </div>

            {/* Footer Action Buttons */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportSummaryPng}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  <Download size={14} />
                  <span>โหลดรูปภาพสรุป (.PNG)</span>
                </button>

                {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    <Share2 size={14} />
                    <span>แชร์ผ่านแอป</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyForLine}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-700 dark:hover:bg-slate-600 cursor-pointer"
                >
                  {copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copyStatus === "copied" ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}</span>
                </button>

                <a
                  href={lineShareHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-xs transition-opacity hover:opacity-95"
                  style={{ backgroundColor: "#06C755" }}
                >
                  <MessageCircle size={14} />
                  <span>เปิด LINE แชร์เข้ากลุ่ม</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
