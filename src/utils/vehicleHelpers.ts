/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Vehicle, VehicleType } from "../types/officer";

export function isTrailerVehicle(
  v: Pick<Vehicle, "vehicleType" | "vehicleId" | "number">
): boolean {
  const id = (v.vehicleId || v.number || "").trim().toUpperCase();
  return v.vehicleType === "Trailer" || id.startsWith("TTL-");
}

export function isTractorVehicle(
  v: Pick<Vehicle, "vehicleType" | "vehicleId" | "number">
): boolean {
  if (isTrailerVehicle(v)) return false;
  const id = (v.vehicleId || v.number || "").trim().toUpperCase();
  return (
    v.vehicleType === "Tractor" ||
    v.vehicleType === "Tugger" ||
    id.startsWith("TT-")
  );
}

export function isForkliftVehicle(
  v: Pick<Vehicle, "vehicleType" | "vehicleId" | "number">
): boolean {
  if (isTrailerVehicle(v)) return false;
  const id = (v.vehicleId || v.number || "").trim().toUpperCase();
  return v.vehicleType === "Forklift" || id.startsWith("FL-");
}

export function getVehicleTypeDisplayLabel(vehicleType: VehicleType): string {
  switch (vehicleType) {
    case "Tractor":
      return "รถหัวลาก (Tractor)";
    case "Tugger":
      return "รถหัวลาก / Tugger";
    case "Forklift":
      return "รถโฟล์คลิฟท์ (Forklift)";
    case "Trailer":
      return "หางลาก (Trailer)";
    default:
      return "อื่นๆ (Other)";
  }
}
