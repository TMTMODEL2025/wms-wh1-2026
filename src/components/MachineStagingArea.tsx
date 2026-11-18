import React, { useState, useEffect, useMemo, useRef } from "react";
import Swal from "sweetalert2";
import {
  showToast,
  showSuccessAlert,
  showWarningAlert,
  showErrorAlert,
  showConfirmDialog,
} from "../utils/swalUtils";
import {
  Cpu,
  Layers,
  Plus,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Scale,
  Ruler,
  SlidersHorizontal,
  Hand
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import {
  MachineRackCoil,
  MachineRack,
  MachineStagingConfig,
  formatRackName,
  getStoredMachineStaging,
  saveStoredMachineStaging,
  resetAllMachineStagingToEmpty,
  fillAllMachineStagingToFull,
  ensureMachineStagingCloudSync,
  computeMachineStagingSummarySnapshot,
  STORAGE_KEY_MACHINE_STAGING,
  MACHINE_STAGING_UPDATED_EVENT
} from "../data/machineStagingStorage";
import {
  subscribeToSlitMachineStaging,
  saveSlitMachineStagingToCloud,
} from "../services/slitDataService";

export type { MachineRackCoil, MachineRack, MachineStagingConfig };
export {
  formatRackName,
  STORAGE_KEY_MACHINE_STAGING,
  MACHINE_STAGING_UPDATED_EVENT
};

export interface MachineStagingAreaProps {
  isThai?: boolean;
}

export const MachineStagingArea: React.FC<MachineStagingAreaProps> = ({ isThai: externalIsThai }) => {
  const { language } = useLanguage();
  const isThai = externalIsThai ?? (language === "th");

  // Load state from LocalStorage / Cloud Firestore or initialize default empty 18 machines
  const [machines, setMachines] = useState<MachineStagingConfig[]>(() => {
    return getStoredMachineStaging();
  });

  // Active Category: "pipe" (TM 1-14) vs "c_channel" (CF 1, 2, 4, 5)
  const [activeCategory, setActiveCategory] = useState<"pipe" | "c_channel">("pipe");

  // Active selected machine
  const [selectedMachineId, setSelectedMachineId] = useState<string>("TM01");
  const [isMachineStagingCloudLoaded, setIsMachineStagingCloudLoaded] = useState<boolean>(false);
  const lastSyncedStagingRef = useRef<string>("");

  // Real-time synchronization: listen to Cloud Firestore & storage updates
  useEffect(() => {
    const unsubCloud = subscribeToSlitMachineStaging((cloudDoc) => {
      setIsMachineStagingCloudLoaded(true);
      if (cloudDoc && Array.isArray(cloudDoc.machines) && cloudDoc.machines.length > 0) {
        const cloudFullInitKey = "tmt_wms_machine_staging_cloud_full_init_v1";
        if (!localStorage.getItem(cloudFullInitKey)) {
          localStorage.setItem(cloudFullInitKey, "true");
          const fullMachines = cloudDoc.machines.map((m) => ({
            ...m,
            racks: (m.racks || []).map((r) => {
              const maxMeters = Math.max(1, Math.round((r.maxCapacityMm || 2000) / 1000));
              if (r.status === "maintenance") return r;
              return {
                ...r,
                usedMeters: maxMeters,
                status: "full" as const,
              };
            }),
          }));
          saveStoredMachineStaging(fullMachines);
          setMachines(fullMachines);
          return;
        }
        saveStoredMachineStaging(cloudDoc.machines, { skipCloudWrite: true });
        setMachines((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(cloudDoc.machines)) return prev;
          return cloudDoc.machines;
        });
      }
    });

    const handleUpdate = () => {
      const fresh = getStoredMachineStaging();
      setMachines((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(fresh)) return prev;
        return fresh;
      });
    };
    window.addEventListener(MACHINE_STAGING_UPDATED_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      unsubCloud();
      window.removeEventListener(MACHINE_STAGING_UPDATED_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  // Save to LocalStorage and broadcast update whenever state changes
  useEffect(() => {
    saveStoredMachineStaging(machines);
  }, [machines]);

  // Keep selected machine aligned with category
  useEffect(() => {
    if (activeCategory === "pipe" && !selectedMachineId.startsWith("TM")) {
      setSelectedMachineId("TM01");
    } else if (activeCategory === "c_channel" && !selectedMachineId.startsWith("CF")) {
      setSelectedMachineId("CF01");
    }
  }, [activeCategory, selectedMachineId]);

  // List of machines in current category
  const categoryMachines = useMemo(() => {
    return machines.filter((m) => m.category === activeCategory);
  }, [machines, activeCategory]);

  // Selected Machine Data
  const currentMachine = useMemo(() => {
    return (
      machines.find((m) => m.machineId === selectedMachineId) ||
      categoryMachines[0] ||
      machines[0]
    );
  }, [machines, selectedMachineId, categoryMachines]);

  // Helper: Convert staging length in meters to weight in tons (1.20 m = 16 tons)
  const metersToTons = (meters: number): number => {
    return (meters / 1.2) * 16;
  };

  const formatTons = (tons: number): string => {
    return Number(tons.toFixed(2)).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  };

  // Statistics for Current Machine
  const machineStats = useMemo(() => {
    let totalRacks = currentMachine.racks.length;
    let availableRacks = 0;
    let occupiedRacks = 0;
    let fullRacks = 0;
    let maintenanceRacks = 0;
    let totalCapacityMeters = 0;
    let totalUsedMeters = 0;
    let totalRemainingMeters = 0;

    currentMachine.racks.forEach((rack) => {
      const maxM = Math.max(1, Math.round(rack.maxCapacityMm / 1000));
      const usedM = Math.min(maxM, Math.max(0, rack.usedMeters ?? 0));
      totalCapacityMeters += maxM;
      totalUsedMeters += usedM;

      if (rack.status === "maintenance") {
        maintenanceRacks++;
      } else {
        totalRemainingMeters += Math.max(0, maxM - usedM);
        if (usedM === 0) {
          availableRacks++;
        } else if (usedM >= maxM) {
          fullRacks++;
        } else {
          occupiedRacks++;
        }
      }
    });

    const overallPercent = totalCapacityMeters > 0
      ? Math.round((totalUsedMeters / totalCapacityMeters) * 100)
      : 0;

    return {
      totalRacks,
      availableRacks,
      occupiedRacks,
      fullRacks,
      maintenanceRacks,
      totalCapacityMeters,
      totalCapacityMm: totalCapacityMeters * 1000,
      totalCapacityTons: metersToTons(totalCapacityMeters),
      totalUsedMeters,
      totalUsedMm: totalUsedMeters * 1000,
      totalUsedTons: metersToTons(totalUsedMeters),
      totalRemainingMeters,
      totalRemainingTons: metersToTons(totalRemainingMeters),
      overallPercent
    };
  }, [currentMachine]);

  // Overall category summary metrics
  const categoryStats = useMemo(() => {
    let totalM = categoryMachines.length;
    let totalUsedM = 0;
    let totalCapM = 0;
    let usedRacks = 0;
    let allRacks = 0;

    categoryMachines.forEach((m) => {
      m.racks.forEach((r) => {
        allRacks++;
        const maxM = Math.max(1, Math.round(r.maxCapacityMm / 1000));
        const usedM = Math.min(maxM, Math.max(0, r.usedMeters ?? 0));
        totalCapM += maxM;
        totalUsedM += usedM;
        if (usedM > 0) usedRacks++;
      });
    });

    return {
      totalMachines: totalM,
      totalUsedMeters: totalUsedM,
      totalUsedTons: metersToTons(totalUsedM),
      totalCapacityMeters: totalCapM,
      totalCapacityTons: metersToTons(totalCapM),
      usedRacks,
      allRacks,
      rackUtilizationPercent: totalCapM > 0 ? Math.round((totalUsedM / totalCapM) * 100) : 0
    };
  }, [categoryMachines]);

  // Summary metrics separated by TM (pipe) and CF (c_channel) categories
  const allCategoriesSummary = useMemo(() => {
    const computeGroupStats = (cat: "pipe" | "c_channel") => {
      const groupMachines = machines.filter((m) => m.category === cat);
      let totalMachines = groupMachines.length;
      let totalRacks = 0;
      let totalCapacityMeters = 0;
      let usedRacks = 0;
      let occupiedRacks = 0;
      let fullRacks = 0;
      let usedMeters = 0;
      let availableRacks = 0;
      let availableMeters = 0;
      let maintenanceRacks = 0;
      let maintenanceMeters = 0;

      groupMachines.forEach((m) => {
        m.racks.forEach((r) => {
          const maxM = Math.max(1, Math.round(r.maxCapacityMm / 1000));
          const usedM = Math.min(maxM, Math.max(0, r.usedMeters ?? 0));
          totalRacks++;
          totalCapacityMeters += maxM;

          if (r.status === "maintenance") {
            maintenanceRacks++;
            maintenanceMeters += maxM;
            usedMeters += usedM;
          } else {
            usedMeters += usedM;
            availableMeters += Math.max(0, maxM - usedM);
            if (usedM > 0) {
              usedRacks++;
              if (usedM >= maxM) {
                fullRacks++;
              } else {
                occupiedRacks++;
              }
            } else {
              availableRacks++;
            }
          }
        });
      });

      const usagePercent =
        totalCapacityMeters > 0
          ? Math.round((usedMeters / totalCapacityMeters) * 100)
          : 0;

      return {
        category: cat,
        totalMachines,
        totalRacks,
        totalCapacityMeters,
        totalCapacityTons: metersToTons(totalCapacityMeters),
        usedRacks,
        occupiedRacks,
        fullRacks,
        usedMeters,
        usedTons: metersToTons(usedMeters),
        availableRacks,
        availableMeters,
        availableTons: metersToTons(availableMeters),
        maintenanceRacks,
        maintenanceMeters,
        maintenanceTons: metersToTons(maintenanceMeters),
        usagePercent
      };
    };

    const tm = computeGroupStats("pipe");
    const cf = computeGroupStats("c_channel");
    const totalMachines = tm.totalMachines + cf.totalMachines;
    const totalRacks = tm.totalRacks + cf.totalRacks;
    const totalCapacityMeters = tm.totalCapacityMeters + cf.totalCapacityMeters;
    const totalCapacityTons = metersToTons(totalCapacityMeters);
    const usedRacks = tm.usedRacks + cf.usedRacks;
    const occupiedRacks = tm.occupiedRacks + cf.occupiedRacks;
    const fullRacks = tm.fullRacks + cf.fullRacks;
    const usedMeters = tm.usedMeters + cf.usedMeters;
    const usedTons = metersToTons(usedMeters);
    const availableRacks = tm.availableRacks + cf.availableRacks;
    const availableMeters = tm.availableMeters + cf.availableMeters;
    const availableTons = metersToTons(availableMeters);
    const maintenanceRacks = tm.maintenanceRacks + cf.maintenanceRacks;
    const maintenanceMeters = tm.maintenanceMeters + cf.maintenanceMeters;
    const maintenanceTons = metersToTons(maintenanceMeters);
    const usagePercent =
      totalCapacityMeters > 0
        ? Math.round((usedMeters / totalCapacityMeters) * 100)
        : 0;

    return {
      tm,
      cf,
      all: {
        totalMachines,
        totalRacks,
        totalCapacityMeters,
        totalCapacityTons,
        usedRacks,
        occupiedRacks,
        fullRacks,
        usedMeters,
        usedTons,
        availableRacks,
        availableMeters,
        availableTons,
        maintenanceRacks,
        maintenanceMeters,
        maintenanceTons,
        usagePercent
      }
    };
  }, [machines]);

  // Keep real-time Machine Staging summary metrics & rack states synced in Cloud Firestore
  useEffect(() => {
    if (!isMachineStagingCloudLoaded) return;
    const summarySnapshot = computeMachineStagingSummarySnapshot(machines);
    const payloadStr = JSON.stringify({ machines, summarySnapshot });
    if (lastSyncedStagingRef.current === payloadStr) return;
    lastSyncedStagingRef.current = payloadStr;
    saveSlitMachineStagingToCloud({
      machines,
      summarySnapshot,
    }).catch(console.error);
  }, [isMachineStagingCloudLoaded, machines]);

  // Handler: Update Rack Used Meters (Manual control in 1-meter intervals)
  const handleUpdateUsedMeters = (rackId: string, meters: number) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.machineId !== currentMachine.machineId) return m;
        return {
          ...m,
          racks: m.racks.map((r) => {
            if (r.rackId !== rackId) return r;
            const maxMeters = Math.max(1, Math.round(r.maxCapacityMm / 1000));
            const clamped = Math.max(0, Math.min(maxMeters, Math.round(meters)));
            let status = r.status;
            if (status !== "maintenance") {
              if (clamped === 0) status = "available";
              else if (clamped >= maxMeters) status = "full";
              else status = "occupied";
            }
            return {
              ...r,
              usedMeters: clamped,
              status
            };
          })
        };
      })
    );
  };

  // Handler: Add New Rack to Current Machine
  const handleAddNewRack = () => {
    const existingNos = currentMachine.racks.map((r) => r.rackNo || 0);
    const maxRackNo = existingNos.length > 0 ? Math.max(...existingNos) : 0;
    const nextRackNo = maxRackNo + 1;

    let newRackId = `${currentMachine.machineId}-R${String(nextRackNo).padStart(2, "0")}`;
    let counter = nextRackNo;
    while (currentMachine.racks.some((r) => r.rackId === newRackId)) {
      counter++;
      newRackId = `${currentMachine.machineId}-R${String(counter).padStart(2, "0")}`;
    }
    const newRackName = formatRackName(nextRackNo, currentMachine);

    const newRack: MachineRack = {
      rackId: newRackId,
      rackNo: nextRackNo,
      rackNameTh: newRackName,
      maxCapacityMm: 2000,
      usedMeters: 2,
      status: "full",
      coils: []
    };

    setMachines((prev) =>
      prev.map((m) => {
        if (m.machineId !== currentMachine.machineId) return m;
        return {
          ...m,
          racks: [...m.racks, newRack]
        };
      })
    );

    showToast(`เพิ่มแคร่ ${newRackName} (เต็มพิกัดแคร่ 2 ม.) สำเร็จแล้ว`, "success");
  };

  // Handler: Adjust Rack Length (in meters)
  const handleUpdateRackLength = (rackId: string, newLengthMeters: number) => {
    const newMaxMeters = Math.max(1, Math.round(newLengthMeters));
    const newCapacityMm = newMaxMeters * 1000;
    setMachines((prev) =>
      prev.map((m) => {
        if (m.machineId !== currentMachine.machineId) return m;
        return {
          ...m,
          racks: m.racks.map((r) => {
            if (r.rackId !== rackId) return r;
            const currentUsed = r.usedMeters ?? 0;
            const clampedUsed = Math.min(newMaxMeters, currentUsed);
            let status = r.status;
            if (status !== "maintenance") {
              if (clampedUsed === 0) status = "available";
              else if (clampedUsed >= newMaxMeters) status = "full";
              else status = "occupied";
            }
            return {
              ...r,
              maxCapacityMm: newCapacityMm,
              usedMeters: clampedUsed,
              status
            };
          })
        };
      })
    );
  };

  // Handler: Toggle Rack Maintenance Status
  const handleToggleRackMaintenance = (rackId: string) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.machineId !== currentMachine.machineId) return m;
        return {
          ...m,
          racks: m.racks.map((r) => {
            if (r.rackId !== rackId) return r;
            const isMaint = r.status === "maintenance";
            const maxM = Math.max(1, Math.round(r.maxCapacityMm / 1000));
            const used = r.usedMeters ?? 0;
            let newStatus: MachineRack["status"] = "available";
            if (isMaint) {
              if (used === 0) newStatus = "available";
              else if (used >= maxM) newStatus = "full";
              else newStatus = "occupied";
            } else {
              newStatus = "maintenance";
            }
            return {
              ...r,
              status: newStatus
            };
          })
        };
      })
    );
  };

  // Handler: Delete Rack (Only if empty)
  const handleDeleteRack = async (rackId: string) => {
    const targetRack = currentMachine.racks.find((r) => r.rackId === rackId);
    if (!targetRack) return;

    if ((targetRack.usedMeters ?? 0) > 0) {
      showErrorAlert(
        "ไม่สามารถลบแคร่ได้",
        "แคร่นี้ยังมีปริมาณการใช้งานอยู่ กรุณาปรับเป็น 0 เมตรก่อนลบ"
      );
      return;
    }

    if (currentMachine.racks.length <= 1) {
      showWarningAlert(
        "ไม่อนุญาตให้ลบ",
        "แต่ละเครื่องจักรต้องมีแคร่วัตถุดิบอย่างน้อย 1 แคร่"
      );
      return;
    }

    const rackDisplayName = formatRackName(targetRack.rackNo, currentMachine);

    const confirmed = await showConfirmDialog({
      title: "ยืนยันลบแคร่นี้?",
      text: `ต้องการลบแคร่ ${rackDisplayName} ใช่หรือไม่?`,
      confirmButtonText: "ยืนยันการลบ",
      isDestructive: true,
    });

    if (confirmed) {
      setMachines((prev) =>
        prev.map((m) => {
          if (m.machineId !== currentMachine.machineId) return m;
          return {
            ...m,
            racks: m.racks.filter((r) => r.rackId !== rackId)
          };
        })
      );

      showToast("ลบแคร่สำเร็จ", "success");
    }
  };

  // Handler: Reset all racks on all machines to empty
  const handleResetAllRacksToEmpty = async () => {
    const confirmed = await showConfirmDialog({
      title: "ล้างข้อมูลแคร่ทั้งหมด?",
      text: "ต้องการปรับปริมาณการใช้งานแคร่ทุกเครื่องให้เป็น 0 เมตร (แคร่ว่าง) ใช่หรือไม่?",
      confirmButtonText: "ยืนยันล้างข้อมูล",
      isDestructive: true,
    });

    if (confirmed) {
      const emptyData = resetAllMachineStagingToEmpty();
      setMachines(emptyData);
      showSuccessAlert(
        "ล้างข้อมูลเรียบร้อย",
        "แคร่ทุกเครื่องว่างพร้อมรับงานแล้ว"
      );
    }
  };

  // Handler: Instantly fill all racks on current machine (and all machines) to full capacity in 1 tap
  const handleFillAllRacksToFull = () => {
    const fullData = fillAllMachineStagingToFull();
    setMachines(fullData);
    showToast(`ปรับแคร่ทั้งหมดเป็น เต็มพิกัดแคร่ (100%) ทันทีแล้ว`, "success");
  };

  // Helper: Status badge info
  const getRackStatusInfo = (status: MachineRack["status"], usedMeters: number, maxMeters: number) => {
    if (status === "maintenance") {
      return {
        label: "ปิดซ่อมบำรุง",
        color: "text-rose-600 dark:text-rose-400",
        border: "border-rose-400 dark:border-rose-800",
        bg: "bg-rose-50 dark:bg-rose-950/40"
      };
    }
    if (usedMeters === 0) {
      return {
        label: "แคร่ว่างพร้อมรับงาน",
        color: "text-emerald-600 dark:text-emerald-400",
        border: "border-emerald-300 dark:border-emerald-800",
        bg: "bg-emerald-50 dark:bg-emerald-950/40"
      };
    }
    if (usedMeters >= maxMeters) {
      return {
        label: "เต็มพิกัดแคร่",
        color: "text-rose-600 dark:text-rose-400",
        border: "border-rose-400 dark:border-rose-800",
        bg: "bg-rose-50 dark:bg-rose-950/40"
      };
    }
    return {
      label: `กำลังใช้งาน (${usedMeters}/${maxMeters} ม.)`,
      color: "text-sky-600 dark:text-sky-400",
      border: "border-sky-300 dark:border-sky-800",
      bg: "bg-sky-50 dark:bg-sky-950/40"
    };
  };

  return (
    <div className="w-full space-y-3 sm:space-y-6 pb-8 sm:pb-12 text-slate-800 dark:text-slate-100 font-sans">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-xl sm:rounded-2xl bg-gradient-to-r from-slate-900 via-sky-950 to-blue-900 p-3 sm:p-6 md:p-8 text-white shadow-xl border border-cyan-500/30">
        <div className="relative z-10 flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-start">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 shrink-0">
                <Cpu size={18} className="sm:w-[26px] sm:h-[26px]" />
              </div>
              <h1 className="text-sm sm:text-xl md:text-2xl font-black text-white flex items-center gap-1.5 sm:gap-2 min-w-0">
                <span className="truncate">แคร่วัตถุดิบหน้าเครื่อง</span>
              </h1>
            </div>
          </div>
        </div>

        {/* 5 Overall Summary Cards (All Machines: TM + CF) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-3 mt-2.5 sm:mt-6 pt-2.5 sm:pt-6 border-t border-white/10">
          {/* การ์ดที่ 1: พื้นที่จัดเก็บทั้งหมด (ตัน) */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-slate-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
                  พื้นที่จัดเก็บทั้งหมด (ตัน)
                </span>
                <span className="text-[10px] font-black font-mono tabular-nums text-cyan-300 bg-cyan-500/20 px-1.5 py-0.2 rounded border border-cyan-400/30 shrink-0">
                  100%
                </span>
              </div>
              <div className="text-xs sm:text-lg md:text-xl font-black text-white mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
                <span className="text-cyan-300">{formatTons(allCategoriesSummary.all.totalCapacityTons)}</span>{" "}
                <span className="font-sans text-[9.5px] sm:text-xs font-bold text-slate-200">ตัน</span>
              </div>
            </div>

            <div className="mt-2 space-y-0.5">
              <div className="flex justify-between items-center text-[9.5px] sm:text-[10px] font-bold text-cyan-300">
                <span>ความจุรวม</span>
                <span>100%</span>
              </div>
              <div className="w-full bg-white/20 h-1.5 sm:h-2 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-400 rounded-full transition-all duration-300 w-full" />
              </div>
            </div>
          </div>

          {/* การ์ดที่ 2: พื้นที่ใช้ไป (ตัน) */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-amber-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
                  พื้นที่ใช้ไป (ตัน)
                </span>
                <span className="text-[10px] font-black font-mono tabular-nums text-amber-300 bg-amber-500/20 px-1.5 py-0.2 rounded border border-amber-400/30 shrink-0">
                  {allCategoriesSummary.all.usagePercent}%
                </span>
              </div>
              <div className="text-xs sm:text-lg md:text-xl font-black text-amber-300 mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
                <span>{formatTons(allCategoriesSummary.all.usedTons)}</span>{" "}
                <span className="font-sans text-[9.5px] sm:text-xs font-bold text-slate-200">ตัน</span>
              </div>
            </div>

            <div className="mt-2 space-y-0.5">
              <div className="flex justify-between items-center text-[9.5px] sm:text-[10px] font-bold text-amber-300">
                <span>สัดส่วนใช้ไป</span>
                <span>{allCategoriesSummary.all.usagePercent}%</span>
              </div>
              <div className="w-full bg-white/20 h-1.5 sm:h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, allCategoriesSummary.all.usagePercent)}%` }}
                />
              </div>
            </div>
          </div>

          {/* การ์ดที่ 3: พื้นที่คงเหลือ (ตัน) */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-emerald-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
                  พื้นที่คงเหลือ (ตัน)
                </span>
                <span className="text-[10px] font-black font-mono tabular-nums text-emerald-300 bg-emerald-500/20 px-1.5 py-0.2 rounded border border-emerald-400/30 shrink-0">
                  {Math.max(0, 100 - allCategoriesSummary.all.usagePercent)}%
                </span>
              </div>
              <div className="text-xs sm:text-lg md:text-xl font-black text-emerald-400 mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
                <span>{formatTons(allCategoriesSummary.all.availableTons)}</span>{" "}
                <span className="font-sans text-[9.5px] sm:text-xs font-bold text-slate-200">ตัน</span>
              </div>
            </div>

            <div className="mt-2 space-y-0.5">
              <div className="flex justify-between items-center text-[9.5px] sm:text-[10px] font-bold text-emerald-300">
                <span>สัดส่วนคงเหลือ</span>
                <span>{Math.max(0, 100 - allCategoriesSummary.all.usagePercent)}%</span>
              </div>
              <div className="w-full bg-white/20 h-1.5 sm:h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, 100 - allCategoriesSummary.all.usagePercent))}%` }}
                />
              </div>
            </div>
          </div>

          {/* การ์ดที่ 4: จำนวนแคร่ทั้งหมด */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0 flex flex-col justify-between">
            {(() => {
              const rackUsagePercent = allCategoriesSummary.all.totalRacks > 0
                ? Math.round((allCategoriesSummary.all.usedRacks / allCategoriesSummary.all.totalRacks) * 100)
                : 0;
              return (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sky-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
                        จำนวนแคร่ทั้งหมด
                      </span>
                      <span className="text-[10px] font-black font-mono tabular-nums text-sky-300 bg-sky-500/20 px-1.5 py-0.2 rounded border border-sky-400/30 shrink-0">
                        {rackUsagePercent}%
                      </span>
                    </div>
                    <div className="text-xs sm:text-lg md:text-xl font-black text-sky-400 mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
                      <span>{allCategoriesSummary.all.totalRacks.toLocaleString()}</span>{" "}
                      <span className="font-sans text-[9.5px] sm:text-xs font-normal text-slate-300">แคร่</span>
                    </div>
                  </div>

                  <div className="mt-2 space-y-0.5">
                    <div className="flex justify-between items-center text-[9.5px] sm:text-[10px] font-bold text-sky-300">
                      <span>สัดส่วนใช้งานแคร่</span>
                      <span>{rackUsagePercent}%</span>
                    </div>
                    <div className="w-full bg-white/20 h-1.5 sm:h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-sky-400 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, rackUsagePercent)}%` }}
                      />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          {/* การ์ดที่ 5: จำนวนเมตรทั้งหมด */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0 col-span-2 sm:col-span-1 flex flex-col justify-between">
            {(() => {
              const meterUsagePercent = allCategoriesSummary.all.totalCapacityMeters > 0
                ? Math.round((allCategoriesSummary.all.usedMeters / allCategoriesSummary.all.totalCapacityMeters) * 100)
                : 0;
              return (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-indigo-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
                        จำนวนเมตรทั้งหมด
                      </span>
                      <span className="text-[10px] font-black font-mono tabular-nums text-indigo-300 bg-indigo-500/20 px-1.5 py-0.2 rounded border border-indigo-400/30 shrink-0">
                        {meterUsagePercent}%
                      </span>
                    </div>
                    <div className="text-xs sm:text-lg md:text-xl font-black text-indigo-300 mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
                      <span>{allCategoriesSummary.all.totalCapacityMeters.toLocaleString()}</span>{" "}
                      <span className="font-sans text-[9.5px] sm:text-xs font-normal text-slate-300">ม.</span>
                    </div>
                  </div>

                  <div className="mt-2 space-y-0.5">
                    <div className="flex justify-between items-center text-[9.5px] sm:text-[10px] font-bold text-indigo-300">
                      <span>สัดส่วนใช้งานเมตร</span>
                      <span>{meterUsagePercent}%</span>
                    </div>
                    <div className="w-full bg-white/20 h-1.5 sm:h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-400 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, meterUsagePercent)}%` }}
                      />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Category Summary Cards: TM Group (TM 01 - TM 14) & CF Group (CF 1, 2, 4, 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 sm:gap-4">
        {/* TM Group Summary Card */}
        <div
          onClick={() => setActiveCategory("pipe")}
          className={`rounded-xl sm:rounded-2xl p-3 sm:p-5 bg-white dark:bg-slate-900 shadow-md border-2 transition-all cursor-pointer ${
            activeCategory === "pipe"
              ? "border-cyan-500 dark:border-cyan-400 ring-2 ring-cyan-500/15"
              : "border-slate-200 dark:border-slate-800 hover:border-cyan-300 dark:hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-2 sm:pb-3.5 mb-2 sm:mb-3.5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
                <Cpu size={16} className="sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xs sm:text-sm md:text-base font-black text-slate-800 dark:text-white flex items-center gap-2 truncate">
                  <span className="truncate">กลุ่มเครื่องผลิตท่อ TM (TM 01 - TM 14)</span>
                </h2>
                <p className="text-[10.5px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                  รวม {allCategoriesSummary.tm.totalMachines} เครื่อง · รองรับ{" "}
                  <strong className="font-mono text-cyan-600 dark:text-cyan-400">
                    {formatTons(allCategoriesSummary.tm.totalCapacityTons)} ตัน
                  </strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {allCategoriesSummary.tm.maintenanceRacks > 0 && (
                <span className="hidden sm:inline-block px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                  ซ่อมบำรุง {allCategoriesSummary.tm.maintenanceRacks} แคร่ ({allCategoriesSummary.tm.maintenanceMeters} ม. / {formatTons(allCategoriesSummary.tm.maintenanceTons)} ตัน)
                </span>
              )}
              <span
                className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[10.5px] sm:text-xs font-black font-mono tabular-nums border ${
                  allCategoriesSummary.tm.usagePercent >= 85
                    ? "bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800"
                    : allCategoriesSummary.tm.usagePercent > 0
                    ? "bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                }`}
              >
                ใช้งาน {allCategoriesSummary.tm.usagePercent}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            {/* 1. มีแคร่ทั้งหมด */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 min-w-0 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">
                  มีแคร่ทั้งหมด
                </div>
                <div className="mt-0.5 sm:mt-1 text-xs sm:text-sm md:text-base font-black text-slate-800 dark:text-white font-mono tabular-nums leading-tight">
                  <span className="text-cyan-600 dark:text-cyan-400">{formatTons(allCategoriesSummary.tm.totalCapacityTons)}</span>{" "}
                  <span className="font-sans text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400">ตัน</span>{" "}
                  <span className="block sm:inline text-[9.5px] sm:text-xs font-bold text-slate-600 dark:text-slate-300 mt-0.5 sm:mt-0">
                    ({allCategoriesSummary.tm.totalRacks} แคร่ / {allCategoriesSummary.tm.totalCapacityMeters} ม.)
                  </span>
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  <span>สัดส่วนความจุ</span>
                  <span>100%</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 rounded-full transition-all duration-300 w-full" />
                </div>
              </div>
            </div>

            {/* 2. ใช้ไป */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60 min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-[11px] font-bold text-sky-700 dark:text-sky-300">
                    ใช้ไป
                  </span>
                  <span className="text-[9.5px] sm:text-[10px] font-black font-mono tabular-nums text-sky-600 dark:text-sky-400">
                    {allCategoriesSummary.tm.usagePercent}%
                  </span>
                </div>
                <div className="mt-0.5 sm:mt-1 text-xs sm:text-sm md:text-base font-black text-sky-700 dark:text-sky-300 font-mono tabular-nums leading-tight">
                  <span>{formatTons(allCategoriesSummary.tm.usedTons)}</span>{" "}
                  <span className="font-sans text-[10px] sm:text-xs font-bold text-sky-600/80 dark:text-sky-400/80">ตัน</span>{" "}
                  <span className="block sm:inline text-[9.5px] sm:text-xs font-bold text-sky-700/90 dark:text-sky-300/90 mt-0.5 sm:mt-0">
                    ({allCategoriesSummary.tm.usedRacks} แคร่ / {allCategoriesSummary.tm.usedMeters} ม.)
                  </span>
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold text-sky-700 dark:text-sky-300">
                  <span>สัดส่วนใช้ไป</span>
                  <span>{allCategoriesSummary.tm.usagePercent}%</span>
                </div>
                <div className="w-full bg-sky-200/60 dark:bg-sky-900/60 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, allCategoriesSummary.tm.usagePercent)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 3. คงเหลือ */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 min-w-0 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  คงเหลือ
                </div>
                <div className="mt-0.5 sm:mt-1 text-xs sm:text-sm md:text-base font-black text-emerald-700 dark:text-emerald-300 font-mono tabular-nums leading-tight">
                  <span>{formatTons(allCategoriesSummary.tm.availableTons)}</span>{" "}
                  <span className="font-sans text-[10px] sm:text-xs font-bold text-emerald-600/80 dark:text-emerald-400/80">ตัน</span>{" "}
                  <span className="block sm:inline text-[9.5px] sm:text-xs font-bold text-emerald-700/90 dark:text-emerald-300/90 mt-0.5 sm:mt-0">
                    ({allCategoriesSummary.tm.availableRacks} แคร่ / {allCategoriesSummary.tm.availableMeters} ม.)
                  </span>
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  <span>สัดส่วนคงเหลือ</span>
                  <span>{Math.max(0, 100 - allCategoriesSummary.tm.usagePercent)}%</span>
                </div>
                <div className="w-full bg-emerald-200/60 dark:bg-emerald-900/60 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, 100 - allCategoriesSummary.tm.usagePercent))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Utilization Bar */}
          <div className="mt-2.5 sm:mt-3.5">
            <div className="w-full h-1.5 sm:h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  allCategoriesSummary.tm.usagePercent >= 85
                    ? "bg-rose-500"
                    : allCategoriesSummary.tm.usagePercent > 0
                    ? "bg-sky-500"
                    : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, allCategoriesSummary.tm.usagePercent)}%` }}
              />
            </div>
          </div>
        </div>

        {/* CF Group Summary Card */}
        <div
          onClick={() => setActiveCategory("c_channel")}
          className={`rounded-xl sm:rounded-2xl p-3 sm:p-5 bg-white dark:bg-slate-900 shadow-md border-2 transition-all cursor-pointer ${
            activeCategory === "c_channel"
              ? "border-cyan-500 dark:border-cyan-400 ring-2 ring-cyan-500/15"
              : "border-slate-200 dark:border-slate-800 hover:border-cyan-300 dark:hover:border-slate-700"
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-2 sm:pb-3.5 mb-2 sm:mb-3.5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div className="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shrink-0">
                <Layers size={16} className="sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xs sm:text-sm md:text-base font-black text-slate-800 dark:text-white flex items-center gap-2 truncate">
                  <span className="truncate">กลุ่มเครื่องผลิตตัวซี CF (CF 1, CF 2, CF 4, CF 5)</span>
                </h2>
                <p className="text-[10.5px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                  รวม {allCategoriesSummary.cf.totalMachines} เครื่อง · รองรับ{" "}
                  <strong className="font-mono text-indigo-600 dark:text-indigo-400">
                    {formatTons(allCategoriesSummary.cf.totalCapacityTons)} ตัน
                  </strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {allCategoriesSummary.cf.maintenanceRacks > 0 && (
                <span className="hidden sm:inline-block px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                  ซ่อมบำรุง {allCategoriesSummary.cf.maintenanceRacks} แคร่ ({allCategoriesSummary.cf.maintenanceMeters} ม. / {formatTons(allCategoriesSummary.cf.maintenanceTons)} ตัน)
                </span>
              )}
              <span
                className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[10.5px] sm:text-xs font-black font-mono tabular-nums border ${
                  allCategoriesSummary.cf.usagePercent >= 85
                    ? "bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800"
                    : allCategoriesSummary.cf.usagePercent > 0
                    ? "bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                }`}
              >
                ใช้งาน {allCategoriesSummary.cf.usagePercent}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            {/* 1. มีแคร่ทั้งหมด */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 min-w-0 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">
                  มีแคร่ทั้งหมด
                </div>
                <div className="mt-0.5 sm:mt-1 text-xs sm:text-sm md:text-base font-black text-slate-800 dark:text-white font-mono tabular-nums leading-tight">
                  <span className="text-indigo-600 dark:text-indigo-400">{formatTons(allCategoriesSummary.cf.totalCapacityTons)}</span>{" "}
                  <span className="font-sans text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400">ตัน</span>{" "}
                  <span className="block sm:inline text-[9.5px] sm:text-xs font-bold text-slate-600 dark:text-slate-300 mt-0.5 sm:mt-0">
                    ({allCategoriesSummary.cf.totalRacks} แคร่ / {allCategoriesSummary.cf.totalCapacityMeters} ม.)
                  </span>
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  <span>สัดส่วนความจุ</span>
                  <span>100%</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full transition-all duration-300 w-full" />
                </div>
              </div>
            </div>

            {/* 2. ใช้ไป */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60 min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-[11px] font-bold text-sky-700 dark:text-sky-300">
                    ใช้ไป
                  </span>
                  <span className="text-[9.5px] sm:text-[10px] font-black font-mono tabular-nums text-sky-600 dark:text-sky-400">
                    {allCategoriesSummary.cf.usagePercent}%
                  </span>
                </div>
                <div className="mt-0.5 sm:mt-1 text-xs sm:text-sm md:text-base font-black text-sky-700 dark:text-sky-300 font-mono tabular-nums leading-tight">
                  <span>{formatTons(allCategoriesSummary.cf.usedTons)}</span>{" "}
                  <span className="font-sans text-[10px] sm:text-xs font-bold text-sky-600/80 dark:text-sky-400/80">ตัน</span>{" "}
                  <span className="block sm:inline text-[9.5px] sm:text-xs font-bold text-sky-700/90 dark:text-sky-300/90 mt-0.5 sm:mt-0">
                    ({allCategoriesSummary.cf.usedRacks} แคร่ / {allCategoriesSummary.cf.usedMeters} ม.)
                  </span>
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold text-sky-700 dark:text-sky-300">
                  <span>สัดส่วนใช้ไป</span>
                  <span>{allCategoriesSummary.cf.usagePercent}%</span>
                </div>
                <div className="w-full bg-sky-200/60 dark:bg-sky-900/60 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, allCategoriesSummary.cf.usagePercent)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 3. คงเหลือ */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 min-w-0 flex flex-col justify-between">
              <div>
                <div className="text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  คงเหลือ
                </div>
                <div className="mt-0.5 sm:mt-1 text-xs sm:text-sm md:text-base font-black text-emerald-700 dark:text-emerald-300 font-mono tabular-nums leading-tight">
                  <span>{formatTons(allCategoriesSummary.cf.availableTons)}</span>{" "}
                  <span className="font-sans text-[10px] sm:text-xs font-bold text-emerald-600/80 dark:text-emerald-400/80">ตัน</span>{" "}
                  <span className="block sm:inline text-[9.5px] sm:text-xs font-bold text-emerald-700/90 dark:text-emerald-300/90 mt-0.5 sm:mt-0">
                    ({allCategoriesSummary.cf.availableRacks} แคร่ / {allCategoriesSummary.cf.availableMeters} ม.)
                  </span>
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                <div className="flex justify-between items-center text-[9px] sm:text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  <span>สัดส่วนคงเหลือ</span>
                  <span>{Math.max(0, 100 - allCategoriesSummary.cf.usagePercent)}%</span>
                </div>
                <div className="w-full bg-emerald-200/60 dark:bg-emerald-900/60 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, 100 - allCategoriesSummary.cf.usagePercent))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Utilization Bar */}
          <div className="mt-2.5 sm:mt-3.5">
            <div className="w-full h-1.5 sm:h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  allCategoriesSummary.cf.usagePercent >= 85
                    ? "bg-rose-500"
                    : allCategoriesSummary.cf.usagePercent > 0
                    ? "bg-sky-500"
                    : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, allCategoriesSummary.cf.usagePercent)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Category Tabs: TM (Pipe) vs CF (C-Channel) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 shadow-md border border-slate-200 dark:border-slate-800 space-y-2.5 sm:space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2 sm:pb-2.5">
          <div className="grid grid-cols-2 sm:flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveCategory("pipe")}
              className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
                activeCategory === "pipe"
                  ? "bg-slate-900 dark:bg-cyan-500 text-white shadow-md"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <Cpu size={13} className="shrink-0 sm:w-[15px] sm:h-[15px]" />
              <span className="sm:hidden">TM 1 - TM 14 (14)</span>
              <span className="hidden sm:inline">เครื่องผลิตท่อ TM 1 - TM 14 (14 เครื่อง)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveCategory("c_channel")}
              className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap ${
                activeCategory === "c_channel"
                  ? "bg-slate-900 dark:bg-cyan-500 text-white shadow-md"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <Layers size={13} className="shrink-0 sm:w-[15px] sm:h-[15px]" />
              <span className="sm:hidden">CF 1, 2, 4, 5 (4)</span>
              <span className="hidden sm:inline">เครื่องผลิตตัวซี CF 1, CF 2, CF 4, CF 5 (4 เครื่อง)</span>
            </button>
          </div>
        </div>

        {/* Machine Selector Strip */}
        <div>
          <div className="hidden sm:flex text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 items-center justify-between">
            <span>คลิกเลือกเครื่องจักรเพื่อดูและจัดการแคร่วัตถุดิบหน้าเครื่อง:</span>
            <span className="text-slate-500 font-normal">
              กำลังแสดง {currentMachine.machineNameTh}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-1.5 sm:gap-2">
            {categoryMachines.map((m) => {
              const isSelected = m.machineId === selectedMachineId;
              const usedMeters = m.racks.reduce((acc, r) => acc + (r.usedMeters ?? 0), 0);
              const totalMeters = m.racks.reduce((acc, r) => acc + Math.max(1, Math.round(r.maxCapacityMm / 1000)), 0);
              const usedTons = metersToTons(usedMeters);
              const totalTons = metersToTons(totalMeters);

              return (
                <button
                  key={m.machineId}
                  type="button"
                  onClick={() => setSelectedMachineId(m.machineId)}
                  className={`p-2 sm:p-2.5 rounded-lg sm:rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between cursor-pointer ${
                    isSelected
                      ? "bg-cyan-50 dark:bg-cyan-950/50 border-cyan-500 shadow-sm ring-1 sm:ring-2 ring-cyan-500/20"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between w-full gap-1">
                    <span
                      className={`text-[11px] sm:text-xs font-black ${
                        isSelected ? "text-cyan-700 dark:text-cyan-300" : "text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {m.machineCode}
                    </span>
                    <span
                      className={`text-[9.5px] sm:text-[10px] font-bold px-1 sm:px-1.5 py-0.2 rounded whitespace-nowrap ${
                        usedMeters > 0
                          ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300/40"
                          : "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300/40"
                      }`}
                    >
                      {usedMeters}/{totalMeters} ม.
                    </span>
                  </div>

                  <div className="mt-1 sm:mt-2 text-[9.5px] sm:text-[10px] text-slate-500 dark:text-slate-400 flex justify-between items-center gap-1">
                    <span className="shrink-0">{m.racks.length} แคร่</span>
                    <span className="font-mono tabular-nums truncate">
                      {usedMeters === 0
                        ? `ว่าง (${formatTons(totalTons)}T)`
                        : `${formatTons(usedTons)}/${formatTons(totalTons)}T`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Racks List for Current Machine */}
      <div className="space-y-2.5 sm:space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <h2 className="text-xs sm:text-base font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="whitespace-nowrap">แคร่หน้าเครื่อง {currentMachine.machineCode}</span>
              <span className="sm:hidden text-[10.5px] font-normal text-slate-500 truncate">
                ({currentMachine.racks.length} แคร่ · {formatTons(machineStats.totalCapacityTons)}T)
              </span>
              <span className="hidden sm:inline text-xs font-normal text-slate-500">
                ({currentMachine.racks.length} แคร่ · รองรับน้ำหนักรวม {formatTons(machineStats.totalCapacityTons)} ตัน · เกณฑ์ 1.20 ม. = 16 ตัน)
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleFillAllRacksToFull}
              className="px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[9.5px] sm:text-[11px] leading-tight transition-colors flex items-center gap-0.5 sm:gap-1 shadow-2xs cursor-pointer whitespace-nowrap"
              title="ปรับแคร่ทุกแคร่ให้เต็มพิกัดแคร่ (100%) ทันที"
            >
              <Layers size={10} className="sm:w-3 sm:h-3 shrink-0" />
              <span>เต็มทุกแคร่</span>
            </button>
            <button
              type="button"
              onClick={handleResetAllRacksToEmpty}
              className="px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 font-semibold text-[9.5px] sm:text-[11px] leading-tight transition-colors flex items-center gap-0.5 sm:gap-1 border border-slate-200 dark:border-slate-700 shadow-2xs cursor-pointer whitespace-nowrap"
              title="ล้างข้อมูลแคร่ทุกเครื่องเป็น 0 เมตร"
            >
              <RotateCcw size={10} className="sm:w-3 sm:h-3 shrink-0" />
              <span className="sm:hidden">ล้างทั้งหมด</span>
              <span className="hidden sm:inline">ล้างข้อมูลแคร่ทั้งหมด</span>
            </button>
            <button
              type="button"
              onClick={handleAddNewRack}
              className="px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg bg-slate-900 dark:bg-cyan-500 hover:bg-slate-800 text-white font-semibold text-[9.5px] sm:text-[11px] leading-tight transition-colors flex items-center gap-0.5 sm:gap-1 shadow-2xs cursor-pointer whitespace-nowrap"
            >
              <Plus size={10} className="sm:w-3 sm:h-3 shrink-0" />
              <span className="sm:hidden">เพิ่มแคร่</span>
              <span className="hidden sm:inline">เพิ่มแคร่ใหม่</span>
            </button>
          </div>
        </div>

        {/* Rack Cards */}
        <div className="grid grid-cols-1 gap-2 sm:gap-3">
          {currentMachine.racks.map((rack, rIdx) => {
            const maxMeters = Math.max(1, Math.round(rack.maxCapacityMm / 1000));
            const usedMeters = Math.min(maxMeters, Math.max(0, rack.usedMeters ?? 0));
            const remainingMeters = Math.max(0, maxMeters - usedMeters);
            const maxTons = metersToTons(maxMeters);
            const usedTons = metersToTons(usedMeters);
            const percent = Math.min(100, Math.round((usedMeters / maxMeters) * 100));
            const isMaintenance = rack.status === "maintenance";
            const statusInfo = getRackStatusInfo(rack.status, usedMeters, maxMeters);

            return (
              <div
                key={`${rack.rackId}-${rIdx}`}
                className={`bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl px-2.5 py-2 sm:p-3.5 shadow-xs border space-y-1.5 sm:space-y-2 transition-all ${
                  isMaintenance
                    ? "border-rose-200 dark:border-rose-900/50 opacity-90"
                    : "border-slate-200/90 dark:border-slate-800"
                }`}
              >
                {/* Single-Line Compact Header Row (No +/- Stepper) */}
                <div className="flex items-center justify-between gap-1.5">
                  {/* Left: Rack Badge, Name & Status Pill */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg border flex items-center justify-center font-mono font-black text-[11px] sm:text-xs shrink-0 ${
                        isMaintenance
                          ? "bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400"
                          : usedMeters >= maxMeters
                          ? "bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400"
                          : usedMeters === 0
                          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          : "bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border-cyan-500/30 text-cyan-600 dark:text-cyan-400"
                      }`}
                    >
                      {String(rack.rackNo).padStart(2, "0")}
                    </div>
                    <h3 className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 whitespace-nowrap">
                      {formatRackName(rack.rackNo, currentMachine)}
                    </h3>
                    <span
                      className={`inline-block text-[10px] sm:text-[11px] font-bold px-1.5 py-0.5 rounded-md border whitespace-nowrap truncate ${statusInfo.bg} ${statusInfo.color} ${statusInfo.border}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>

                  {/* Right: Inline Summary & Desktop Rack Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-[10.5px] sm:text-xs font-mono tabular-nums flex items-center gap-1 text-slate-500 dark:text-slate-400">
                      <span className="hidden md:inline text-[11px] font-sans">
                        สถานะการใช้งานแคร่ปัจจุบัน:
                      </span>
                      <strong className="text-slate-800 dark:text-slate-100">
                        {usedMeters}/{maxMeters}ม.
                      </strong>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <strong className="text-cyan-600 dark:text-cyan-400">
                        {formatTons(usedTons)}/{formatTons(maxTons)}T
                      </strong>
                    </div>

                    {/* Desktop Rack Length & Maintenance Actions */}
                    <div className="hidden sm:flex items-center gap-1.5">
                      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                        <Ruler size={12} className="text-slate-400 shrink-0" />
                        <select
                          value={maxMeters}
                          disabled={isMaintenance}
                          onChange={(e) =>
                            handleUpdateRackLength(rack.rackId, parseInt(e.target.value, 10))
                          }
                          aria-label="ความยาวแคร่"
                          className="bg-transparent font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer text-[11px] disabled:opacity-50"
                        >
                          <option value={1} className="dark:bg-slate-900">1 ม. (13.3T)</option>
                          <option value={2} className="dark:bg-slate-900">2 ม. (26.7T)</option>
                          <option value={3} className="dark:bg-slate-900">3 ม. (40T)</option>
                          <option value={4} className="dark:bg-slate-900">4 ม. (53.3T)</option>
                          <option value={5} className="dark:bg-slate-900">5 ม. (66.7T)</option>
                          <option value={6} className="dark:bg-slate-900">6 ม. (80T)</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleRackMaintenance(rack.rackId)}
                        className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap ${
                          isMaintenance
                            ? "bg-rose-500 hover:bg-rose-600 text-white border-rose-600"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                        }`}
                        title={isMaintenance ? "เปิดใช้งานแคร่" : "ปิดปรับปรุงแคร่"}
                      >
                        <AlertTriangle
                          size={12}
                          className={isMaintenance ? "text-white" : "text-amber-500"}
                        />
                        <span>{isMaintenance ? "เปิดใช้" : "ซ่อมบำรุง"}</span>
                      </button>

                      {usedMeters === 0 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRack(rack.rackId)}
                          className="inline-flex p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
                          title="ลบแคร่ที่ว่างนี้"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Slim Mobile-First Touch Progress Bar + Quick Meter Pills */}
                <div className="space-y-1">
                  <div className="relative select-none py-0.5">
                    {/* Slim Track Container */}
                    <div
                      className={`relative w-full h-6 sm:h-7 rounded-lg border overflow-hidden transition-colors ${
                        isMaintenance
                          ? "bg-rose-950/10 border-rose-300 dark:bg-rose-950/30 dark:border-rose-800/60"
                          : usedMeters === 0
                          ? "bg-emerald-500/10 border-emerald-500/35 dark:bg-emerald-950/30 dark:border-emerald-700/50"
                          : "bg-slate-100 dark:bg-slate-950/90 border-slate-200/90 dark:border-slate-800"
                      }`}
                    >
                      {/* Segmented 1-Meter Grid Dividers */}
                      <div className="absolute inset-0 grid grid-flow-col auto-cols-fr pointer-events-none z-10">
                        {Array.from({ length: maxMeters }).map((_, segIdx) => (
                          <div
                            key={segIdx}
                            className={`h-full ${
                              segIdx > 0
                                ? "border-l border-dashed border-slate-400/35 dark:border-slate-600/40"
                                : ""
                            }`}
                          />
                        ))}
                      </div>

                      {/* Smooth Animated Progress Fill */}
                      <div
                        style={{ width: `${percent}%` }}
                        className={`h-full transition-all duration-200 ease-out relative ${
                          isMaintenance
                            ? "bg-gradient-to-r from-rose-500/60 to-rose-600/60"
                            : usedMeters >= maxMeters
                            ? "bg-gradient-to-r from-rose-500 via-red-500 to-rose-600 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
                            : "bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 shadow-[0_0_12px_rgba(14,165,233,0.35)]"
                        }`}
                      >
                        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/25 to-transparent" />
                      </div>

                      {/* Clean Single Status Readout inside Track (with safe horizontal padding so Thumb never overlaps) */}
                      <div className="absolute inset-0 z-15 flex items-center justify-between pl-6 pr-6 pointer-events-none text-[10.5px] sm:text-[11px] font-mono font-bold tabular-nums">
                        <span
                          className={`truncate drop-shadow-2xs ${
                            usedMeters > 0
                              ? "text-white"
                              : "text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {isMaintenance
                            ? "ปิดซ่อมบำรุง"
                            : usedMeters === 0
                            ? `ว่างพร้อมวาง (${maxMeters} ม. · ${formatTons(maxTons)}T)`
                            : `ใช้ ${usedMeters} ม. (${formatTons(usedTons)}T)`}
                        </span>

                        <span
                          className={`shrink-0 ml-2 text-[10px] sm:text-[10.5px] font-extrabold drop-shadow-2xs ${
                            usedMeters >= maxMeters
                              ? "text-white"
                              : usedMeters === 0
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-cyan-700 dark:text-cyan-200"
                          }`}
                        >
                          {usedMeters >= maxMeters
                            ? "เต็ม 100%"
                            : usedMeters === 0
                            ? "ว่าง 100%"
                            : `ว่าง ${remainingMeters} ม. (${percent}%)`}
                        </span>
                      </div>
                    </div>

                    {/* Compact Tactile Thumb Handle */}
                    {!isMaintenance && (
                      <div
                        style={{
                          left: `clamp(10px, ${(usedMeters / maxMeters) * 100}%, calc(100% - 10px))`,
                        }}
                        className="pointer-events-none absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 transition-all duration-200 ease-out"
                      >
                        <div
                          className={`h-4.5 w-4.5 sm:h-5 sm:w-5 rounded-full bg-white dark:bg-slate-100 border-2 shadow-[0_1px_6px_rgba(0,0,0,0.35)] flex items-center justify-center ${
                            usedMeters >= maxMeters
                              ? "border-rose-600"
                              : usedMeters === 0
                              ? "border-emerald-500"
                              : "border-cyan-500"
                          }`}
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${
                              usedMeters >= maxMeters
                                ? "bg-rose-600"
                                : usedMeters === 0
                                ? "bg-emerald-500"
                                : "bg-cyan-500"
                            }`}
                          />
                        </div>
                      </div>
                    )}

                    {/* Full-Surface Invisible Touch Range Input */}
                    <input
                      type="range"
                      min={0}
                      max={maxMeters}
                      step={1}
                      value={usedMeters}
                      disabled={isMaintenance}
                      onChange={(e) =>
                        handleUpdateUsedMeters(rack.rackId, parseInt(e.target.value, 10))
                      }
                      aria-label={`เลื่อนปรับสถานะการใช้งานแคร่ ${formatRackName(
                        rack.rackNo,
                        currentMachine
                      )}`}
                      className="absolute -inset-y-1 inset-x-0 w-full h-[calc(100%+8px)] opacity-0 cursor-ew-resize touch-pan-x z-30 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Compact One-Tap Meter Step Pills (0 ม. ... maxMeters ม.) */}
                  <div className="grid grid-flow-col auto-cols-fr gap-1">
                    {Array.from({ length: maxMeters + 1 }).map((_, mVal) => {
                      const isActive = usedMeters === mVal;
                      return (
                        <button
                          key={mVal}
                          type="button"
                          disabled={isMaintenance}
                          onClick={() => handleUpdateUsedMeters(rack.rackId, mVal)}
                          className={`h-6 sm:h-6.5 rounded-md font-mono text-[10px] sm:text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-0.5 active:scale-95 ${
                            isActive
                              ? mVal >= maxMeters
                                ? "bg-rose-600 text-white shadow-2xs"
                                : mVal === 0
                                ? "bg-emerald-600 text-white shadow-2xs"
                                : "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-2xs"
                              : "bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-slate-700/70"
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                          title={`แตะเพื่อตั้งค่าใช้แคร่ ${mVal} เมตร`}
                        >
                          <span>{mVal}</span>
                          <span className="text-[9px] opacity-85">ม.</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
