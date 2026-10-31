// Machine Staging Area Data Store & Real-time Integration

export interface MachineRackCoil {
  id: string;
  batch: string;
  spec: string; // e.g. "7.00 x 75mm"
  grade: string; // e.g. "SS400"
  widthMm: number; // e.g. 75
  thicknessMm: number; // e.g. 7.0
  weightKg: number; // e.g. 850
  stagedAt: string;
  operator?: string;
  notes?: string;
}

export interface MachineRack {
  rackId: string; // e.g. "TM01-R01"
  rackNo: number; // 1, 2, 3...
  rackNameTh: string; // "01 TM 01"
  maxCapacityMm: number; // e.g. 2000 mm (2 meters)
  status: "available" | "occupied" | "full" | "maintenance";
  notes?: string;
  coils: MachineRackCoil[];
  usedMeters?: number; // Manual rack utilization in meters (step 1m)
}

export interface MachineStagingConfig {
  machineId: string; // "TM01" ... "TM14", "CF01", "CF02", "CF04", "CF05"
  machineCode: string; // "TM 01"
  machineNameTh: string;
  category: "pipe" | "c_channel";
  descriptionTh?: string;
  racks: MachineRack[];
}

export const STORAGE_KEY_MACHINE_STAGING = "tmt_wms_machine_staging_v2";
export const MACHINE_STAGING_UPDATED_EVENT = "machine-staging-updated";

// Definition of 18 machines: TM 1 to TM 14, and CF 1, CF 2, CF 4, CF 5
export const INITIAL_MACHINES: Array<{
  id: string;
  code: string;
  name: string;
  category: "pipe" | "c_channel";
  desc: string;
}> = [
  // 14 Pipe Forming Machines (TM 1 - TM 14)
  { id: "TM01", code: "TM 01", name: "เครื่องผลิตท่อ TM 01", category: "pipe", desc: "ท่อกลมและท่อสี่เหลี่ยมขนาดมาตรฐาน 1/2\" - 1\"" },
  { id: "TM02", code: "TM 02", name: "เครื่องผลิตท่อ TM 02", category: "pipe", desc: "ท่อกลมและท่อเหลี่ยมขนาด 1\" - 1.5\"" },
  { id: "TM03", code: "TM 03", name: "เครื่องผลิตท่อ TM 03", category: "pipe", desc: "ท่อโครงสร้างและท่อเฟอร์นิเจอร์ 1\" - 2\"" },
  { id: "TM04", code: "TM 04", name: "เครื่องผลิตท่อ TM 04", category: "pipe", desc: "ท่อเหล็กดำและท่อกัลวาไนซ์ 1.5\" - 2.5\"" },
  { id: "TM05", code: "TM 05", name: "เครื่องผลิตท่อ TM 05", category: "pipe", desc: "ท่อเหล็กสี่เหลี่ยมจัตุรัส 50x50 - 75x75 มม." },
  { id: "TM06", code: "TM 06", name: "เครื่องผลิตท่อ TM 06", category: "pipe", desc: "ท่อเหล็กสี่เหลี่ยมผืนผ้า 50x25 - 100x50 มม." },
  { id: "TM07", code: "TM 07", name: "เครื่องผลิตท่อ TM 07", category: "pipe", desc: "ท่อกลมและท่อเหลี่ยมโครงสร้างอาคาร 2\" - 3\"" },
  { id: "TM08", code: "TM 08", name: "เครื่องผลิตท่อ TM 08", category: "pipe", desc: "ท่อโครงสร้างขนาดใหญ่ 3\" - 4\"" },
  { id: "TM09", code: "TM 09", name: "เครื่องผลิตท่อ TM 09", category: "pipe", desc: "ท่อเหล็กหนาพิเศษ งานอุตสาหกรรม 2.5\" - 4\"" },
  { id: "TM10", code: "TM 10", name: "เครื่องผลิตท่อ TM 10", category: "pipe", desc: "ท่อเหล็กโครงสร้าง 100x100 - 125x125 มม." },
  { id: "TM11", code: "TM 11", name: "เครื่องผลิตท่อ TM 11", category: "pipe", desc: "ท่อกลมขนาดใหญ่ 4\" - 5\" งานชลประทาน" },
  { id: "TM12", code: "TM 12", name: "เครื่องผลิตท่อ TM 12", category: "pipe", desc: "ท่อโครงสร้าง 150x150 มม. งานสะพานและอาคาร" },
  { id: "TM13", code: "TM 13", name: "เครื่องผลิตท่อ TM 13", category: "pipe", desc: "ท่อเหล็กเหนียวความแม่นยำสูง (Precision Tube)" },
  { id: "TM14", code: "TM 14", name: "เครื่องผลิตท่อ TM 14", category: "pipe", desc: "ท่อเหล็กสเปกส่งออกและงานโครงสร้างขนาดใหญ่ 6\"" },

  // 4 C-Channel Forming Machines (CF 1, CF 2, CF 4, CF 5)
  { id: "CF01", code: "CF 1", name: "เครื่องผลิตตัวซี CF 1", category: "c_channel", desc: "เหล็กโครงสร้างรูปพรรณตัวซี ขนาด 75x45 - 100x50 มม." },
  { id: "CF02", code: "CF 2", name: "เครื่องผลิตตัวซี CF 2", category: "c_channel", desc: "เหล็กโครงสร้างรูปพรรณตัวซี ขนาด 125x50 - 150x50 มม." },
  { id: "CF04", code: "CF 4", name: "เครื่องผลิตตัวซี CF 4", category: "c_channel", desc: "เหล็กตัวซีหนาพิเศษ 150x65 - 200x75 มม." },
  { id: "CF05", code: "CF 5", name: "เครื่องผลิตตัวซี CF 5", category: "c_channel", desc: "เหล็กโครงสร้างตัวซี งานแปหลังคามาตรฐานสูง" },
];

// Helper: Calculate accumulated width in millimeters
export function calculateAccumulatedWidthMm(coils: MachineRackCoil[]): number {
  if (!coils || coils.length === 0) return 0;
  return coils.reduce((acc, c) => acc + (c.widthMm || 0), 0);
}

/**
 * Format rack display name: "01 TM 08", "02 TM 08", "01 CF 1"
 * Completely omits internal codes like R01, R02.
 */
export function formatRackName(rackNo: number, machine: { machineCode?: string; machineId?: string }): string {
  const rackPrefix = String(rackNo).padStart(2, "0");
  let mCode = machine.machineCode || "";

  if (!mCode && machine.machineId) {
    if (machine.machineId.startsWith("TM")) {
      const num = parseInt(machine.machineId.replace("TM", ""), 10);
      mCode = isNaN(num) ? machine.machineId : `TM ${String(num).padStart(2, "0")}`;
    } else if (machine.machineId.startsWith("CF")) {
      const num = parseInt(machine.machineId.replace("CF", ""), 10);
      mCode = isNaN(num) ? machine.machineId : `CF ${num}`;
    } else if (machine.machineId.startsWith("ML")) {
      const num = parseInt(machine.machineId.replace("ML", ""), 10);
      mCode = isNaN(num) ? machine.machineId : `ML ${String(num).padStart(2, "0")}`;
    } else if (machine.machineId.startsWith("ZF")) {
      const num = parseInt(machine.machineId.replace("ZF", ""), 10);
      mCode = isNaN(num) ? machine.machineId : `ZF ${String(num).padStart(2, "0")}`;
    } else {
      mCode = machine.machineId;
    }
  } else {
    const tmMatch = mCode.match(/^TM\s*(\d+)$/i);
    if (tmMatch) {
      const num = parseInt(tmMatch[1], 10);
      mCode = `TM ${String(num).padStart(2, "0")}`;
    }
  }

  return `${rackPrefix} ${mCode}`;
}

export function generateDefaultRacks(machineId: string, machineCode?: string): MachineRack[] {
  return [1, 2, 3].map((no) => ({
    rackId: `${machineId}-R${String(no).padStart(2, "0")}`,
    rackNo: no,
    rackNameTh: formatRackName(no, { machineId, machineCode }),
    maxCapacityMm: 2000,
    usedMeters: 0,
    status: "available",
    coils: []
  }));
}

export function buildInitialState(): MachineStagingConfig[] {
  return INITIAL_MACHINES.map((m) => {
    const racks = generateDefaultRacks(m.id, m.code);
    return {
      machineId: m.id,
      machineCode: m.code,
      machineNameTh: m.name,
      category: m.category,
      descriptionTh: m.desc,
      racks
    };
  });
}

export function resetAllMachineStagingToEmpty(): MachineStagingConfig[] {
  const current = getStoredMachineStaging();
  const clearedState: MachineStagingConfig[] = (current && current.length > 0 ? current : buildInitialState()).map((m) => ({
    ...m,
    racks: (m.racks || []).map((r) => ({
      ...r,
      coils: [],
      usedMeters: 0,
      status: (r.status === "maintenance" ? "maintenance" : "available") as MachineRack["status"]
    }))
  }));
  saveStoredMachineStaging(clearedState);
  return clearedState;
}

export function getStoredMachineStaging(): MachineStagingConfig[] {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      // Clear out older mock data key if present
      if (localStorage.getItem("tmt_wms_machine_staging_v1")) {
        localStorage.removeItem("tmt_wms_machine_staging_v1");
      }
    }
    const saved = typeof window !== "undefined" && window.localStorage ? localStorage.getItem(STORAGE_KEY_MACHINE_STAGING) : null;
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let hasDuplicates = false;
        const cleaned = parsed.map((m: MachineStagingConfig) => {
          const seenRackIds = new Set<string>();
          const dedupedRacks: MachineRack[] = [];

          (m.racks || []).forEach((r: MachineRack, idx: number) => {
            let uniqueRackId = r.rackId;
            let rackNo = r.rackNo || idx + 1;

            if (!uniqueRackId || seenRackIds.has(uniqueRackId)) {
              hasDuplicates = true;
              let counter = 1;
              while (seenRackIds.has(`${m.machineId}-R${String(counter).padStart(2, "0")}`)) {
                counter++;
              }
              uniqueRackId = `${m.machineId}-R${String(counter).padStart(2, "0")}`;
              rackNo = counter;
            }
            seenRackIds.add(uniqueRackId);
            dedupedRacks.push({
              ...r,
              rackId: uniqueRackId,
              rackNo,
              usedMeters: typeof r.usedMeters === "number" ? r.usedMeters : 0,
              rackNameTh: formatRackName(rackNo, m)
            });
          });

          return {
            ...m,
            racks: dedupedRacks
          };
        });

        if (hasDuplicates && typeof window !== "undefined" && window.localStorage) {
          try {
            localStorage.setItem(STORAGE_KEY_MACHINE_STAGING, JSON.stringify(cleaned));
          } catch (_) {}
        }

        return cleaned;
      }
    }
  } catch (e) {
    console.error("Failed to load machine staging from localStorage:", e);
  }
  const initialState = buildInitialState();
  saveStoredMachineStaging(initialState);
  return initialState;
}

export function saveStoredMachineStaging(data: MachineStagingConfig[]): void {
  try {
    const serialized = JSON.stringify(data);
    if (typeof window !== "undefined" && window.localStorage) {
      if (localStorage.getItem(STORAGE_KEY_MACHINE_STAGING) === serialized) {
        return;
      }
      localStorage.setItem(STORAGE_KEY_MACHINE_STAGING, serialized);
      window.dispatchEvent(new CustomEvent(MACHINE_STAGING_UPDATED_EVENT, { detail: data }));
    }
  } catch (e) {
    console.error("Failed to save machine staging to localStorage:", e);
  }
}

/**
 * Get all racks for a specific machine ID directly from actual staging area storage
 */
export function getRacksForMachine(machineId: string): MachineRack[] {
  if (!machineId) return [];
  const configs = getStoredMachineStaging();
  const cleanId = machineId.trim().toUpperCase();
  const machine = configs.find(
    (m) =>
      m.machineId.toUpperCase() === cleanId ||
      m.machineCode.replace(/\s+/g, "").toUpperCase() === cleanId
  );
  if (!machine) {
    return generateDefaultRacks(cleanId);
  }
  return machine.racks && machine.racks.length > 0
    ? machine.racks
    : generateDefaultRacks(machine.machineId, machine.machineCode);
}

/**
 * Add a coil directly to a specific machine & rack (from barcode scanning dispatch/receiving)
 */
export function addCoilToMachineRack(
  machineId: string,
  rackId: string,
  coilInput: {
    batch: string;
    widthMm: number;
    thicknessMm?: number;
    weightKg?: number;
    grade?: string;
    spec?: string;
    operator?: string;
    notes?: string;
  }
): { success: boolean; message: string; remainingMm: number; rackNameTh: string } {
  const configs = getStoredMachineStaging();
  const cleanId = machineId.trim().toUpperCase();
  let machineIdx = configs.findIndex(
    (m) =>
      m.machineId.toUpperCase() === cleanId ||
      m.machineCode.replace(/\s+/g, "").toUpperCase() === cleanId.replace(/\s+/g, "")
  );

  // Dynamically register new/custom machines if not yet in staging configs
  if (machineIdx === -1) {
    const newMachineConfig: MachineStagingConfig = {
      machineId: cleanId,
      machineCode: cleanId,
      machineNameTh: `เครื่อง ${cleanId}`,
      category: cleanId.startsWith("CF") ? "c_channel" : "pipe",
      descriptionTh: `เครื่องจักร ${cleanId}`,
      racks: generateDefaultRacks(cleanId),
    };
    configs.push(newMachineConfig);
    machineIdx = configs.length - 1;
  }

  const machine = configs[machineIdx];
  if (!machine.racks || machine.racks.length === 0) {
    machine.racks = generateDefaultRacks(machine.machineId, machine.machineCode);
  }

  let rackIdx = machine.racks.findIndex((r) => r.rackId === rackId);
  if (rackIdx === -1) {
    // Fallback to first available rack if rackId not matched
    rackIdx = machine.racks.findIndex((r) => r.status !== "maintenance");
    if (rackIdx === -1) rackIdx = 0;
  }

  const rack = machine.racks[rackIdx];
  if (rack.status === "maintenance") {
    return {
      success: false,
      message: `แคร่ ${rack.rackNameTh} อยู่ในสถานะปิดซ่อมบำรุง ไม่สามารถวางวัตถุดิบได้`,
      remainingMm: 0,
      rackNameTh: rack.rackNameTh
    };
  }

  const currentAccumulated = calculateAccumulatedWidthMm(rack.coils);
  const widthMm = coilInput.widthMm || 0;
  const newAccumulated = currentAccumulated + widthMm;
  const remainingMm = Math.max(0, rack.maxCapacityMm - newAccumulated);

  const newCoil: MachineRackCoil = {
    id: `COIL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    batch: coilInput.batch.trim().toUpperCase(),
    spec: coilInput.spec || (coilInput.thicknessMm || widthMm ? `${coilInput.thicknessMm || "-"} x ${widthMm || "-"}mm` : "-"),
    grade: coilInput.grade || "-",
    widthMm: widthMm,
    thicknessMm: coilInput.thicknessMm || 0,
    weightKg: coilInput.weightKg || 0,
    stagedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    operator: coilInput.operator || "-",
    notes: coilInput.notes || "-"
  };

  rack.coils.push(newCoil);
  const maxMeters = Math.max(1, Math.round(rack.maxCapacityMm / 1000));
  rack.usedMeters = Math.min(maxMeters, Math.max(rack.usedMeters || 0, Math.ceil(newAccumulated / 1000)));
  rack.status = newAccumulated >= rack.maxCapacityMm ? "full" : "occupied";

  configs[machineIdx] = machine;
  saveStoredMachineStaging(configs);

  return {
    success: true,
    message: `นำแถบเหล็ก Batch [${newCoil.batch}] วางลงแคร่ ${rack.rackNameTh} สำเร็จ`,
    remainingMm,
    rackNameTh: rack.rackNameTh
  };
}

/**
 * Remove a coil from a rack (e.g. when loaded to production mill)
 */
export function removeCoilFromRack(machineId: string, rackId: string, coilId: string): boolean {
  const configs = getStoredMachineStaging();
  const machineIdx = configs.findIndex(
    (m) =>
      m.machineId.toUpperCase() === machineId.toUpperCase() ||
      m.machineCode.replace(/\s+/g, "").toUpperCase() === machineId.replace(/\s+/g, "").toUpperCase()
  );
  if (machineIdx === -1) return false;

  const machine = configs[machineIdx];
  const rackIdx = machine.racks.findIndex((r) => r.rackId === rackId);
  if (rackIdx === -1) return false;

  const rack = machine.racks[rackIdx];
  rack.coils = rack.coils.filter((c) => c.id !== coilId);

  if (rack.status !== "maintenance") {
    const accMm = calculateAccumulatedWidthMm(rack.coils);
    const maxMeters = Math.max(1, Math.round(rack.maxCapacityMm / 1000));
    rack.usedMeters = rack.coils.length === 0 ? 0 : Math.min(maxMeters, Math.ceil(accMm / 1000));
    rack.status = rack.coils.length === 0 ? "available" : "occupied";
  }

  configs[machineIdx] = machine;
  saveStoredMachineStaging(configs);
  return true;
}

export interface StagedCoilWithMachine {
  machineId: string;
  machineCode: string;
  machineNameTh: string;
  rackId: string;
  rackNo: number;
  rackNameTh: string;
  coil: MachineRackCoil;
}

/**
 * Get all coils currently sitting on machine racks
 */
export function getAllStagedCoilsWithMachineInfo(): StagedCoilWithMachine[] {
  const configs = getStoredMachineStaging();
  const results: StagedCoilWithMachine[] = [];

  configs.forEach((m) => {
    (m.racks || []).forEach((r) => {
      (r.coils || []).forEach((c) => {
        results.push({
          machineId: m.machineId,
          machineCode: m.machineCode,
          machineNameTh: m.machineNameTh,
          rackId: r.rackId,
          rackNo: r.rackNo,
          rackNameTh: r.rackNameTh,
          coil: c,
        });
      });
    });
  });

  return results;
}

/**
 * Remove a coil from any machine rack by its Batch number (for warehouse return)
 */
export function removeCoilByBatch(
  batch: string,
  targetMachineId?: string
): { success: boolean; found: boolean; machineCode?: string; rackNameTh?: string } {
  const configs = getStoredMachineStaging();
  const cleanBatch = batch.trim().toUpperCase();
  let modified = false;
  let foundMachineCode = "";
  let foundRackName = "";

  for (let mIdx = 0; mIdx < configs.length; mIdx++) {
    const machine = configs[mIdx];
    if (
      targetMachineId &&
      machine.machineId.toUpperCase() !== targetMachineId.toUpperCase() &&
      machine.machineCode.replace(/\s+/g, "").toUpperCase() !== targetMachineId.replace(/\s+/g, "").toUpperCase()
    ) {
      continue;
    }

    for (let rIdx = 0; rIdx < (machine.racks || []).length; rIdx++) {
      const rack = machine.racks[rIdx];
      const initialLength = (rack.coils || []).length;
      rack.coils = (rack.coils || []).filter((c) => c.batch.trim().toUpperCase() !== cleanBatch);

      if (rack.coils.length !== initialLength) {
        modified = true;
        foundMachineCode = machine.machineCode;
        foundRackName = rack.rackNameTh;
        if (rack.status !== "maintenance") {
          const accMm = calculateAccumulatedWidthMm(rack.coils);
          const maxMeters = Math.max(1, Math.round(rack.maxCapacityMm / 1000));
          rack.usedMeters = rack.coils.length === 0 ? 0 : Math.min(maxMeters, Math.ceil(accMm / 1000));
          rack.status = rack.coils.length === 0 ? "available" : "occupied";
        }
      }
    }
  }

  if (modified) {
    saveStoredMachineStaging(configs);
    return { success: true, found: true, machineCode: foundMachineCode, rackNameTh: foundRackName };
  }

  return { success: false, found: false };
}
