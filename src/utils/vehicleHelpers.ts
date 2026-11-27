/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VehicleType } from "../types/officer";

export type VehicleTypeCandidate = {
  vehicleType?: string;
  type?: string;
  vehicleId?: string;
  number?: string;
  id?: string;
  description?: string;
  vehicleDescription?: string;
  registrationNumber?: string;
  department?: string;
  engineType?: string;
};

function getPrimaryVehicleCodeUpper(v: VehicleTypeCandidate): string {
  return String(v.vehicleId || v.number || v.id || "")
    .trim()
    .toUpperCase();
}

function startsWithTtevToken(value?: string): boolean {
  const clean = String(value || "").trim().toUpperCase();
  return clean.startsWith("TTEV");
}

/**
 * Returns true if the vehicle is an Electric Tractor ("หัวลากไฟฟ้า"),
 * matching any vehicle whose code/ID or name/description starts with "TTEV"
 * (e.g., TTEV-19 through TTEV-27) or whose vehicleType explicitly denotes ElectricTractor / หัวลากไฟฟ้า.
 */
export function isElectricTractorVehicle(v: VehicleTypeCandidate): boolean {
  const rawType = String(v.vehicleType || "").trim();
  const rawTypeLower = rawType.toLowerCase();
  const rawLegacyTypeLower = String(v.type || "").trim().toLowerCase();

  if (
    rawType === "ElectricTractor" ||
    rawType === "หัวลากไฟฟ้า" ||
    rawTypeLower === "electric tractor" ||
    rawTypeLower === "electrictractor" ||
    rawTypeLower.includes("หัวลากไฟฟ้า") ||
    rawLegacyTypeLower.includes("หัวลากไฟฟ้า") ||
    rawLegacyTypeLower.includes("electrictractor")
  ) {
    return true;
  }

  return (
    startsWithTtevToken(v.vehicleId) ||
    startsWithTtevToken(v.number) ||
    startsWithTtevToken(v.id) ||
    startsWithTtevToken(v.description) ||
    startsWithTtevToken(v.vehicleDescription) ||
    startsWithTtevToken(v.registrationNumber)
  );
}

export function isTrailerVehicle(v: VehicleTypeCandidate): boolean {
  if (isElectricTractorVehicle(v)) return false;
  const id = getPrimaryVehicleCodeUpper(v);
  return v.vehicleType === "Trailer" || v.vehicleType === "หางลาก" || id.startsWith("TTL-");
}

/**
 * Returns true for standard (non-EV) tractors / tuggers (e.g., TT-*).
 */
export function isStandardTractorVehicle(v: VehicleTypeCandidate): boolean {
  if (isTrailerVehicle(v) || isElectricTractorVehicle(v)) return false;
  const id = getPrimaryVehicleCodeUpper(v);
  return (
    v.vehicleType === "Tractor" ||
    v.vehicleType === "Tugger" ||
    id.startsWith("TT-")
  );
}

/**
 * Returns true for all tractor-class vehicles (both standard Tractor/Tugger and ElectricTractor TTEV-*).
 */
export function isTractorVehicle(v: VehicleTypeCandidate): boolean {
  return isElectricTractorVehicle(v) || isStandardTractorVehicle(v);
}

export function isClampTruckVehicle(v: VehicleTypeCandidate): boolean {
  const primaryUpper = getPrimaryVehicleCodeUpper(v);
  if (
    primaryUpper.startsWith("หแ") ||
    primaryUpper.startsWith("SC-") ||
    primaryUpper === "SC01" ||
    primaryUpper.startsWith("CLAMP")
  ) {
    return true;
  }

  const combined = [
    v.vehicleId,
    v.number,
    v.id,
    v.registrationNumber,
    v.description,
    v.vehicleDescription,
    v.vehicleType,
    v.type,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();

  return (
    combined.includes("หแ-01") ||
    combined.includes("หแ-") ||
    combined.includes("รถคีบ") ||
    combined.includes("xinyuan") ||
    combined.includes("clamp")
  );
}

export type PreStartVehicleCategoryKey =
  | "diesel_tractor"
  | "ev_tractor"
  | "trailer"
  | "forklift"
  | "clamp_truck";

/**
 * Classifies any fleet vehicle into the 5 Daily Pre-Start Inspection tabs:
 * - diesel_tractor: รถหัวลากดีเซล (TT- / Tractor / Tugger)
 * - ev_tractor: หัวลากไฟฟ้า EV (TTEV- / ElectricTractor)
 * - trailer: หางลาก (TTL- / Trailer)
 * - forklift: โฟล์คลิฟท์ (FL- / Forklift)
 * - clamp_truck: หแ-01 (รถคีบ)
 */
export function classifyPreStartVehicleCategory(
  v: VehicleTypeCandidate
): PreStartVehicleCategoryKey {
  if (isClampTruckVehicle(v)) return "clamp_truck";
  if (isElectricTractorVehicle(v)) return "ev_tractor";
  if (isTrailerVehicle(v)) return "trailer";
  if (isForkliftVehicle(v)) return "forklift";
  if (isStandardTractorVehicle(v)) return "diesel_tractor";

  const combined = [
    v.vehicleId,
    v.number,
    v.description,
    v.vehicleDescription,
    v.vehicleType,
    v.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (combined.includes("หางลาก") || combined.includes("trailer")) return "trailer";
  if (combined.includes("โฟล์คลิฟท์") || combined.includes("forklift")) return "forklift";
  if (combined.includes("ไฟฟ้า") || combined.includes("ttev") || combined.includes("byd")) {
    return "ev_tractor";
  }
  return "diesel_tractor";
}

export function isForkliftVehicle(v: VehicleTypeCandidate): boolean {
  if (isTrailerVehicle(v) || isElectricTractorVehicle(v) || isClampTruckVehicle(v)) return false;
  const id = getPrimaryVehicleCodeUpper(v);
  return v.vehicleType === "Forklift" || id.startsWith("FL-");
}

/**
 * Resolves the canonical VehicleType code using the system-wide rule:
 * TTEV* -> "ElectricTractor" ("หัวลากไฟฟ้า") takes priority over legacy Tractor/Forklift fields.
 */
export function resolveVehicleType(v: VehicleTypeCandidate): VehicleType {
  if (isElectricTractorVehicle(v)) return "ElectricTractor";
  if (isTrailerVehicle(v)) return "Trailer";
  if (isForkliftVehicle(v)) return "Forklift";
  if (v.vehicleType === "Tugger") return "Tugger";
  if (isStandardTractorVehicle(v)) return "Tractor";
  if (
    v.vehicleType === "Tractor" ||
    v.vehicleType === "Forklift" ||
    v.vehicleType === "Tugger" ||
    v.vehicleType === "Trailer" ||
    v.vehicleType === "Other"
  ) {
    return v.vehicleType;
  }
  return "Other";
}

/**
 * Returns the canonical display label for a vehicle type (e.g., "หัวลากไฟฟ้า").
 * Pass `vehicle` whenever available so TTEV-* records always display "หัวลากไฟฟ้า"
 * even if legacy stored records still carry an older `vehicleType`.
 */
export function getVehicleTypeDisplayLabel(
  vehicleType?: string,
  vehicle?: VehicleTypeCandidate
): string {
  const candidate: VehicleTypeCandidate = {
    ...(vehicle || {}),
    vehicleType: vehicle?.vehicleType ?? vehicleType,
  };

  if (isClampTruckVehicle(candidate)) {
    return "รถคีบ (หแ-01)";
  }

  if (isElectricTractorVehicle(candidate)) {
    return "หัวลากไฟฟ้า";
  }

  const resolved = resolveVehicleType(candidate);
  switch (resolved) {
    case "ElectricTractor":
      return "หัวลากไฟฟ้า";
    case "Tractor":
      return "รถหัวลาก (Tractor)";
    case "Tugger":
      return "รถหัวลาก / Tugger";
    case "Forklift":
      return "รถโฟล์คลิฟท์ (Forklift)";
    case "Trailer":
      return "หางลาก (Trailer)";
    default: {
      const raw = String(vehicleType || vehicle?.vehicleType || "").trim();
      if (raw && raw !== "Other") return raw;
      return "อื่นๆ (Other)";
    }
  }
}

/**
 * Returns normalized lowercase searchable text containing IDs, descriptions,
 * resolved Thai/English vehicle type labels, and keywords such as "หัวลากไฟฟ้า" / "TTEV".
 */
export function getVehicleSearchableText(v: VehicleTypeCandidate): string {
  const resolved = resolveVehicleType(v);
  const displayLabel = getVehicleTypeDisplayLabel(v.vehicleType, v);

  const extraKeywords = isClampTruckVehicle(v)
    ? "รถคีบ คีบ หแ-01 หแ clamp sc-01 xinyuan"
    : resolved === "ElectricTractor"
    ? "หัวลากไฟฟ้า electric tractor ttev หัวลาก"
    : resolved === "Trailer"
    ? "หางลาก trailer ttl"
    : resolved === "Forklift"
    ? "รถโฟล์คลิฟท์ โฟล์คลิฟท์ forklift fl"
    : resolved === "Tractor" || resolved === "Tugger"
    ? "รถหัวลาก หัวลาก รถลากจูง tractor tugger tt ดีเซล"
    : "";

  return [
    v.vehicleId,
    v.number,
    v.id,
    v.registrationNumber,
    v.description,
    v.vehicleDescription,
    v.vehicleType,
    v.type,
    v.department,
    v.engineType,
    resolved,
    displayLabel,
    extraKeywords,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Shared vehicle type filter matcher across Vehicle Management, PM Schedule, etc.
 */
export function matchesVehicleTypeFilter(
  v: VehicleTypeCandidate,
  filterValue: string
): boolean {
  const cleanFilter = String(filterValue || "").trim();
  if (!cleanFilter || cleanFilter === "All") return true;

  const resolved = resolveVehicleType(v);
  const filterLower = cleanFilter.toLowerCase();

  if (
    cleanFilter === "ElectricTractor" ||
    cleanFilter === "หัวลากไฟฟ้า" ||
    filterLower === "electric tractor" ||
    filterLower === "ttev"
  ) {
    return resolved === "ElectricTractor";
  }

  if (cleanFilter === "Tractor") return resolved === "Tractor";
  if (cleanFilter === "Tugger") return resolved === "Tugger";
  if (cleanFilter === "Forklift") return resolved === "Forklift";
  if (cleanFilter === "Trailer") return resolved === "Trailer";
  if (cleanFilter === "Other") return resolved === "Other";

  return (
    resolved.toLowerCase() === filterLower ||
    getVehicleTypeDisplayLabel(v.vehicleType, v).toLowerCase().includes(filterLower) ||
    String(v.vehicleType || "").toLowerCase() === filterLower
  );
}
