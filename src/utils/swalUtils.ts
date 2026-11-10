/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SweetAlert2 helper utility with dark/light mode detection matching TMT WMS theme.
 * All alerts use 'Noto Sans Thai' typography and provide consistent confirm dialogs,
 * success summaries, and error/warning alerts across the warehouse application.
 */
import Swal, { SweetAlertOptions, SweetAlertResult } from "sweetalert2";

export function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function getBaseSwalOptions(): SweetAlertOptions {
  const dark = isDarkMode();
  return {
    background: dark ? "#0f172a" : "#ffffff",
    color: dark ? "#f8fafc" : "#0f172a",
    buttonsStyling: true,
    customClass: {
      popup: dark
        ? "border border-slate-700/80 shadow-2xl rounded-2xl font-sans"
        : "border border-slate-200 shadow-xl rounded-2xl font-sans",
      title: "font-black tracking-tight",
      htmlContainer: "text-sm",
      confirmButton:
        "px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2",
      cancelButton:
        "px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all focus:outline-none focus:ring-2",
    },
  };
}

export interface ToastOptions {
  title: string;
  icon?: "success" | "error" | "warning" | "info" | "question";
  timer?: number;
  position?: "top-end" | "top" | "top-start" | "bottom-end";
}

/**
 * Show a quick non-intrusive Toast notification.
 * Supports either (title, icon) or an options object.
 */
export function showToast(
  titleOrOptions: string | ToastOptions,
  maybeIcon: "success" | "error" | "warning" | "info" | "question" = "success"
) {
  const isObj = typeof titleOrOptions === "object";
  const title = isObj ? titleOrOptions.title : titleOrOptions;
  const icon = isObj ? (titleOrOptions.icon ?? "success") : maybeIcon;
  const timer = isObj ? (titleOrOptions.timer ?? 2000) : 2000;
  const position = isObj ? (titleOrOptions.position ?? "top-end") : "top-end";

  const dark = isDarkMode();
  return Swal.fire({
    ...getBaseSwalOptions(),
    toast: true,
    position,
    icon,
    title,
    showConfirmButton: false,
    timer,
    timerProgressBar: true,
    background: dark ? "#1e293b" : "#ffffff",
    didOpen: (toast) => {
      toast.addEventListener("mouseenter", Swal.stopTimer);
      toast.addEventListener("mouseleave", Swal.resumeTimer);
    },
  });
}

export interface AlertOptions {
  title: string;
  text?: string;
  html?: string;
  timer?: number;
  showConfirmButton?: boolean;
  confirmButtonText?: string;
}

/**
 * Show Success Popup Dialog.
 * Supports either (title, text/html) or an options object.
 */
export function showSuccessAlert(
  titleOrOptions: string | AlertOptions,
  maybeText?: string,
  isHtml = false
): Promise<SweetAlertResult> {
  const isObj = typeof titleOrOptions === "object";
  const title = isObj ? titleOrOptions.title : titleOrOptions;
  const text = isObj ? titleOrOptions.text : (isHtml ? undefined : maybeText);
  const html = isObj ? titleOrOptions.html : (isHtml ? maybeText : undefined);
  const timer = isObj ? titleOrOptions.timer : undefined;
  const showConfirmButton = isObj ? (titleOrOptions.showConfirmButton ?? true) : true;
  const confirmButtonText = isObj ? (titleOrOptions.confirmButtonText ?? "ตกลง") : "ตกลง";

  return Swal.fire({
    ...getBaseSwalOptions(),
    icon: "success",
    title,
    text,
    html,
    showConfirmButton,
    confirmButtonText,
    confirmButtonColor: "#0284c7",
    timer,
    timerProgressBar: Boolean(timer),
  });
}

/**
 * Show Warning Popup Dialog.
 * Supports either (title, text/html) or an options object.
 */
export function showWarningAlert(
  titleOrOptions: string | AlertOptions,
  maybeText?: string,
  isHtml = false
): Promise<SweetAlertResult> {
  const isObj = typeof titleOrOptions === "object";
  const title = isObj ? titleOrOptions.title : titleOrOptions;
  const text = isObj ? titleOrOptions.text : (isHtml ? undefined : maybeText);
  const html = isObj ? titleOrOptions.html : (isHtml ? maybeText : undefined);
  const confirmButtonText = isObj ? (titleOrOptions.confirmButtonText ?? "รับทราบ") : "รับทราบ";

  return Swal.fire({
    ...getBaseSwalOptions(),
    icon: "warning",
    title,
    text,
    html,
    confirmButtonText,
    confirmButtonColor: "#f59e0b",
  });
}

/**
 * Show Error Popup Dialog.
 * Supports either (title, text/html) or an options object.
 */
export function showErrorAlert(
  titleOrOptions: string | AlertOptions,
  maybeText?: string,
  isHtml = false
): Promise<SweetAlertResult> {
  const isObj = typeof titleOrOptions === "object";
  const title = isObj ? titleOrOptions.title : titleOrOptions;
  const text = isObj ? titleOrOptions.text : (isHtml ? undefined : maybeText);
  const html = isObj ? titleOrOptions.html : (isHtml ? maybeText : undefined);
  const confirmButtonText = isObj ? (titleOrOptions.confirmButtonText ?? "รับทราบ") : "รับทราบ";

  return Swal.fire({
    ...getBaseSwalOptions(),
    icon: "error",
    title,
    text,
    html,
    confirmButtonText,
    confirmButtonColor: "#ef4444",
  });
}

export interface ConfirmOptions {
  title: string;
  text?: string;
  html?: string;
  confirmButtonText?: string;
  cancelButtonText?: string;
  confirmButtonColor?: string;
  cancelButtonColor?: string;
  icon?: "warning" | "question" | "info";
  isDangerous?: boolean;
  isDestructive?: boolean;
}

/**
 * Show Confirmation Modal Dialog (resolves Promise<boolean>)
 */
export async function showConfirmDialog({
  title,
  text,
  html,
  confirmButtonText = "ยืนยัน",
  cancelButtonText = "ยกเลิก",
  confirmButtonColor,
  cancelButtonColor = "#64748b",
  icon = "warning",
  isDangerous = false,
  isDestructive = false,
}: ConfirmOptions): Promise<boolean> {
  const danger = isDangerous || isDestructive;
  const chosenConfirmColor =
    confirmButtonColor || (danger ? "#ef4444" : "#0284c7");

  const result = await Swal.fire({
    ...getBaseSwalOptions(),
    title,
    text,
    html,
    icon,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor: chosenConfirmColor,
    cancelButtonColor,
    focusCancel: danger,
    reverseButtons: true,
  });

  return Boolean(result.isConfirmed);
}

export default Swal;
