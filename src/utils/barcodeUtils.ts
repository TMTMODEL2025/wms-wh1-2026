/**
 * Barcode cleaning and parsing utilities for industrial warehouse scanners.
 * Handles:
 * - AIM symbology identifiers (e.g. ']C0', ']C1', ']A0', ']e0', ']d2')
 * - ASCII non-printable control characters (STX, ETX, GS, etc.)
 * - Zero-width spaces, Unicode BOM, and whitespace
 * - Framing asterisks (Code 39: *26SL00189A*)
 * - 10-character alphanumeric Batch extraction
 */

export function cleanBarcode(raw: string): string {
  if (!raw) return "";

  // 1. Remove non-printable control characters, null bytes, STX/ETX, GS, etc.
  let cleaned = raw.replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, "");

  // 2. Remove whitespace, carriage returns, line feeds, tabs
  cleaned = cleaned.replace(/[\r\n\t\s]+/g, "").trim().toUpperCase();

  // 3. Strip AIM symbology identifier if present at the start (e.g., "]C0", "]C1", "]A0", "]e0")
  cleaned = cleaned.replace(/^\][A-Z0-9]{2,3}/i, "");

  // 4. Strip surrounding Code 39 asterisks (e.g., *26SL00189A* -> 26SL00189A)
  if (cleaned.startsWith("*") && cleaned.endsWith("*") && cleaned.length > 2) {
    cleaned = cleaned.slice(1, -1);
  }

  // 5. If cleaned is already 10 characters alphanumeric, return it immediately
  if (/^[A-Za-z0-9]{10}$/.test(cleaned)) {
    return cleaned;
  }

  // 6. If the scanner included prefix or suffix text, look for a 10-char alphanumeric batch pattern
  const match10 = cleaned.match(/[A-Za-z0-9]{10}/);
  if (match10) {
    return match10[0];
  }

  return cleaned;
}

export function isValidBatchBarcode(code: string): boolean {
  return /^[A-Za-z0-9]{10}$/.test(code);
}
