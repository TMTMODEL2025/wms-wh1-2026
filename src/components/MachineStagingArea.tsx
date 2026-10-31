import React, { useState, useEffect, useMemo } from "react";
import Swal from "sweetalert2";
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
  STORAGE_KEY_MACHINE_STAGING,
  MACHINE_STAGING_UPDATED_EVENT
} from "../data/machineStagingStorage";

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

  // Load state from LocalStorage or initialize default empty 18 machines
  const [machines, setMachines] = useState<MachineStagingConfig[]>(() => {
    return getStoredMachineStaging();
  });

  // Active Category: "pipe" (TM 1-14) vs "c_channel" (CF 1, 2, 4, 5)
  const [activeCategory, setActiveCategory] = useState<"pipe" | "c_channel">("pipe");

  // Active selected machine
  const [selectedMachineId, setSelectedMachineId] = useState<string>("TM01");

  // Real-time synchronization: listen to storage updates
  useEffect(() => {
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
      usedMeters: 0,
      status: "available",
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

    Swal.fire({
      icon: "success",
      title: "เพิ่มแคร่ใหม่สำเร็จ",
      text: `เพิ่มแคร่ ${newRackName} ความยาว 2 เมตร สำเร็จแล้ว`,
      timer: 1500,
      showConfirmButton: false,
      toast: true,
      position: "top-end"
    });
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
  const handleDeleteRack = (rackId: string) => {
    const targetRack = currentMachine.racks.find((r) => r.rackId === rackId);
    if (!targetRack) return;

    if ((targetRack.usedMeters ?? 0) > 0) {
      Swal.fire({
        icon: "error",
        title: "ไม่สามารถลบแคร่ได้",
        text: "แคร่นี้ยังมีปริมาณการใช้งานอยู่ กรุณาปรับเป็น 0 เมตรก่อนลบ"
      });
      return;
    }

    if (currentMachine.racks.length <= 1) {
      Swal.fire({
        icon: "warning",
        title: "ไม่อนุญาตให้ลบ",
        text: "แต่ละเครื่องจักรต้องมีแคร่วัตถุดิบอย่างน้อย 1 แคร่"
      });
      return;
    }

    const rackDisplayName = formatRackName(targetRack.rackNo, currentMachine);

    Swal.fire({
      title: "ยืนยันลบแคร่นี้?",
      text: `ต้องการลบแคร่ ${rackDisplayName} ใช่หรือไม่?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: "ยืนยันการลบ",
      cancelButtonText: "ยกเลิก"
    }).then((result) => {
      if (result.isConfirmed) {
        setMachines((prev) =>
          prev.map((m) => {
            if (m.machineId !== currentMachine.machineId) return m;
            return {
              ...m,
              racks: m.racks.filter((r) => r.rackId !== rackId)
            };
          })
        );

        Swal.fire({
          icon: "success",
          title: "ลบแคร่สำเร็จ",
          timer: 1400,
          showConfirmButton: false,
          toast: true,
          position: "top-end"
        });
      }
    });
  };

  // Handler: Reset all racks on all machines to empty
  const handleResetAllRacksToEmpty = () => {
    Swal.fire({
      title: "ล้างข้อมูลแคร่ทั้งหมด?",
      text: "ต้องการปรับปริมาณการใช้งานแคร่ทุกเครื่องให้เป็น 0 เมตร (แคร่ว่าง) ใช่หรือไม่?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: "ยืนยันล้างข้อมูล",
      cancelButtonText: "ยกเลิก"
    }).then((result) => {
      if (result.isConfirmed) {
        const emptyData = resetAllMachineStagingToEmpty();
        setMachines(emptyData);
        Swal.fire({
          icon: "success",
          title: "ล้างข้อมูลเรียบร้อย",
          text: "แคร่ทุกเครื่องว่างพร้อมรับงานแล้ว",
          timer: 1600,
          showConfirmButton: false,
          toast: true,
          position: "top-end"
        });
      }
    });
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
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 shrink-0">
                <Cpu size={18} className="sm:w-[26px] sm:h-[26px]" />
              </div>
              <h1 className="text-sm sm:text-xl md:text-2xl font-black text-white flex items-center gap-1.5 sm:gap-2 min-w-0">
                <span className="truncate">แคร่วัตถุดิบหน้าเครื่อง</span>
                <span className="hidden sm:inline-block text-cyan-400 font-extrabold text-sm px-2.5 py-0.5 rounded-lg bg-cyan-950/90 border border-cyan-500/40 shrink-0">
                  {currentMachine.machineNameTh}
                </span>
              </h1>
            </div>
            <span className="sm:hidden text-cyan-300 font-extrabold text-[11px] px-2 py-0.5 rounded-md bg-cyan-950/90 border border-cyan-500/40 shrink-0">
              {currentMachine.machineNameTh}
            </span>
          </div>

          {/* Quick Overall Summary KPIs */}
          <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-2 sm:gap-3 bg-white/10 backdrop-blur-md px-2.5 sm:px-4 py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl border border-white/15">
            <div className="w-full sm:w-auto sm:text-right">
              <div className="hidden sm:block text-[11px] text-slate-300 font-medium">
                รวมทั้งหมดทุกกลุ่ม ({allCategoriesSummary.all.totalMachines} เครื่อง · TM 1-14 & CF 1, 2, 4, 5)
              </div>
              <div className="text-[11px] sm:text-sm font-bold text-white flex flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2">
                <span>
                  <span className="text-emerald-300 font-mono tabular-nums">
                    {formatTons(allCategoriesSummary.all.usedTons)} / {formatTons(allCategoriesSummary.all.totalCapacityTons)}
                  </span>{" "}
                  ตัน
                </span>
                <span className="text-white/40">·</span>
                <span>
                  <span className="text-cyan-300 font-mono tabular-nums">
                    {allCategoriesSummary.all.usedMeters} / {allCategoriesSummary.all.totalCapacityMeters}
                  </span>{" "}
                  เมตร
                </span>
                <span className="text-white/40">·</span>
                <span>
                  <span className="text-amber-300 font-mono tabular-nums">
                    {allCategoriesSummary.all.usagePercent}%
                  </span>{" "}
                  ใช้งาน
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 3 Overall Summary Cards (All Machines: TM + CF) */}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-3 mt-2.5 sm:mt-6 pt-2.5 sm:pt-6 border-t border-white/10">
          {/* การ์ดที่ 1: จำนวนแคร่หน้าเครื่อง */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0">
            <div className="text-slate-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
              จำนวนแคร่หน้าเครื่อง
            </div>
            <div className="text-xs sm:text-lg md:text-xl font-black text-white mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
              <span className="text-cyan-300">{formatTons(allCategoriesSummary.all.totalCapacityTons)}</span>{" "}
              <span className="font-sans text-[9.5px] sm:text-xs font-bold text-slate-200">ตัน</span>{" "}
              <span className="block sm:inline text-[9.5px] sm:text-sm md:text-base font-bold text-slate-200 mt-0.5 sm:mt-0">
                ({allCategoriesSummary.all.totalRacks}{" "}
                <span className="font-sans text-[9px] sm:text-xs font-normal text-slate-300">แคร่</span> /{" "}
                {allCategoriesSummary.all.totalCapacityMeters}{" "}
                <span className="font-sans text-[9px] sm:text-xs font-normal text-slate-300">ม.</span>)
              </span>
            </div>
            <div className="hidden sm:block text-[10px] text-cyan-300 mt-1">
              รวมทุกเครื่องทั้งกลุ่ม TM และ CF ({allCategoriesSummary.all.totalMachines} เครื่องจักร)
            </div>
          </div>

          {/* การ์ดที่ 2: ปริมาณที่ใช้งานแล้ว */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-sky-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
                ปริมาณที่ใช้งานแล้ว
              </span>
              <span className="hidden sm:inline-block text-[10px] font-black font-mono tabular-nums text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-400/30 shrink-0">
                {allCategoriesSummary.all.usagePercent}%
              </span>
            </div>
            <div className="text-xs sm:text-lg md:text-xl font-black text-sky-400 mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
              <span className="text-amber-300">{formatTons(allCategoriesSummary.all.usedTons)}</span>{" "}
              <span className="font-sans text-[9.5px] sm:text-xs font-bold text-slate-200">ตัน</span>{" "}
              <span className="block sm:inline text-[9.5px] sm:text-sm md:text-base font-bold text-sky-200 mt-0.5 sm:mt-0">
                ({allCategoriesSummary.all.usedRacks}{" "}
                <span className="font-sans text-[9px] sm:text-xs font-normal text-slate-300">แคร่</span> /{" "}
                {allCategoriesSummary.all.usedMeters}{" "}
                <span className="font-sans text-[9px] sm:text-xs font-normal text-slate-300">ม.</span>)
              </span>
            </div>
            <div className="hidden sm:block text-[10px] text-sky-200 mt-1">
              กำลังใช้งาน {allCategoriesSummary.all.occupiedRacks} แคร่ · เต็มพิกัด {allCategoriesSummary.all.fullRacks} แคร่
            </div>
          </div>

          {/* การ์ดที่ 3: แคร่ว่างพร้อมรับวัตถุดิบ */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3.5 border border-white/15 min-w-0">
            <div className="text-emerald-300 text-[9.5px] sm:text-xs font-semibold tracking-tight sm:tracking-normal truncate">
              แคร่ว่างพร้อมรับวัตถุดิบ
            </div>
            <div className="text-xs sm:text-lg md:text-xl font-black text-emerald-400 mt-0.5 sm:mt-1.5 font-mono tabular-nums leading-tight">
              <span>{formatTons(allCategoriesSummary.all.availableTons)}</span>{" "}
              <span className="font-sans text-[9.5px] sm:text-xs font-bold text-slate-200">ตัน</span>{" "}
              <span className="block sm:inline text-[9.5px] sm:text-sm md:text-base font-bold text-emerald-200 mt-0.5 sm:mt-0">
                ({allCategoriesSummary.all.availableRacks}{" "}
                <span className="font-sans text-[9px] sm:text-xs font-normal text-slate-300">แคร่</span> /{" "}
                {allCategoriesSummary.all.availableMeters}{" "}
                <span className="font-sans text-[9px] sm:text-xs font-normal text-slate-300">ม.</span>)
              </span>
            </div>
            <div className="hidden sm:block text-[10px] text-emerald-200 mt-1">
              พร้อมวางวัตถุดิบรวมทุกเครื่องทั้งกลุ่ม TM และ CF
            </div>
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
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 min-w-0">
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
              <div className="hidden sm:block mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                ความจุรวมทุกเครื่องในหมวด TM (80 ตัน/เครื่อง)
              </div>
            </div>

            {/* 2. ใช้ไป */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60 min-w-0">
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
              <div className="hidden sm:block mt-0.5 text-[10px] text-sky-600/80 dark:text-sky-400/70">
                กำลังใช้ {allCategoriesSummary.tm.occupiedRacks} · เต็มพิกัด {allCategoriesSummary.tm.fullRacks} แคร่
              </div>
            </div>

            {/* 3. คงเหลือ */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 min-w-0">
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
              <div className="hidden sm:block mt-0.5 text-[10px] text-emerald-600/80 dark:text-emerald-400/70">
                แคร่ว่างพร้อมรับงาน / น้ำหนักรองรับคงเหลือ
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
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 min-w-0">
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
              <div className="hidden sm:block mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                ความจุรวมทุกเครื่องในหมวด CF (80 ตัน/เครื่อง)
              </div>
            </div>

            {/* 2. ใช้ไป */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60 min-w-0">
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
              <div className="hidden sm:block mt-0.5 text-[10px] text-sky-600/80 dark:text-sky-400/70">
                กำลังใช้ {allCategoriesSummary.cf.occupiedRacks} · เต็มพิกัด {allCategoriesSummary.cf.fullRacks} แคร่
              </div>
            </div>

            {/* 3. คงเหลือ */}
            <div className="rounded-lg sm:rounded-xl p-2 sm:p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 min-w-0">
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
              <div className="hidden sm:block mt-0.5 text-[10px] text-emerald-600/80 dark:text-emerald-400/70">
                แคร่ว่างพร้อมรับงาน / น้ำหนักรองรับคงเหลือ
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

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={handleResetAllRacksToEmpty}
              className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 font-semibold text-[10.5px] sm:text-xs transition-colors flex items-center gap-1 sm:gap-1.5 border border-slate-200 dark:border-slate-700 shadow-2xs cursor-pointer whitespace-nowrap"
              title="ล้างข้อมูลแคร่ทุกเครื่องเป็น 0 เมตร"
            >
              <RotateCcw size={12} className="sm:w-[13px] sm:h-[13px]" />
              <span className="sm:hidden">ล้างทั้งหมด</span>
              <span className="hidden sm:inline">ล้างข้อมูลแคร่ทั้งหมด</span>
            </button>
            <button
              type="button"
              onClick={handleAddNewRack}
              className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-900 dark:bg-cyan-500 hover:bg-slate-800 text-white font-bold text-[10.5px] sm:text-xs transition-colors flex items-center gap-1 sm:gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            >
              <Plus size={13} className="sm:w-3.5 sm:h-3.5" />
              <span className="sm:hidden">เพิ่มแคร่</span>
              <span className="hidden sm:inline">เพิ่มแคร่ใหม่</span>
            </button>
          </div>
        </div>

        {/* Rack Cards */}
        <div className="grid grid-cols-1 gap-3 sm:gap-5">
          {currentMachine.racks.map((rack, rIdx) => {
            const maxMeters = Math.max(1, Math.round(rack.maxCapacityMm / 1000));
            const usedMeters = Math.min(maxMeters, Math.max(0, rack.usedMeters ?? 0));
            const remainingMeters = Math.max(0, maxMeters - usedMeters);
            const maxTons = metersToTons(maxMeters);
            const usedTons = metersToTons(usedMeters);
            const remainingTons = metersToTons(remainingMeters);
            const percent = Math.min(100, Math.round((usedMeters / maxMeters) * 100));
            const isMaintenance = rack.status === "maintenance";
            const statusInfo = getRackStatusInfo(rack.status, usedMeters, maxMeters);

            return (
              <div
                key={`${rack.rackId}-${rIdx}`}
                className={`bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-md border space-y-2.5 sm:space-y-4 transition-all ${
                  isMaintenance
                    ? "border-rose-200 dark:border-rose-900/50 opacity-90"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                {/* Rack Header (Desktop sm: and up) */}
                <div className="hidden sm:flex sm:flex-row sm:flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center justify-start w-auto gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center font-black text-cyan-600 dark:text-cyan-400 text-sm shrink-0">
                        {String(rack.rackNo).padStart(2, "0")}
                      </div>
                      <h3 className="text-base font-black text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        {formatRackName(rack.rackNo, currentMachine)}
                      </h3>
                    </div>
                    <span
                      className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-lg border whitespace-nowrap ${statusInfo.bg} ${statusInfo.color} ${statusInfo.border}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>

                  {/* Actions on this rack */}
                  <div className="flex items-center justify-end gap-2 w-auto">
                    {/* ฟังก์ชันปรับความยาวแคร่ */}
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs shadow-2xs">
                      <Ruler size={13} className="text-slate-400 shrink-0" />
                      <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">ความยาวแคร่:</span>
                      <select
                        value={maxMeters}
                        disabled={isMaintenance}
                        onChange={(e) => handleUpdateRackLength(rack.rackId, parseInt(e.target.value, 10))}
                        className="bg-transparent font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer text-xs disabled:opacity-50"
                      >
                        <option value={1} className="dark:bg-slate-900">1 เมตร (13.33 ตัน)</option>
                        <option value={2} className="dark:bg-slate-900">2 เมตร (26.67 ตัน - มาตรฐาน)</option>
                        <option value={3} className="dark:bg-slate-900">3 เมตร (40 ตัน)</option>
                        <option value={4} className="dark:bg-slate-900">4 เมตร (53.33 ตัน)</option>
                        <option value={5} className="dark:bg-slate-900">5 เมตร (66.67 ตัน)</option>
                        <option value={6} className="dark:bg-slate-900">6 เมตร (80 ตัน - สูงสุด)</option>
                      </select>
                    </div>

                    {/* ปุ่มปิดซ่อมบำรุง */}
                    <button
                      type="button"
                      onClick={() => handleToggleRackMaintenance(rack.rackId)}
                      className={`flex px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors items-center gap-1 shadow-2xs cursor-pointer shrink-0 whitespace-nowrap ${
                        isMaintenance
                          ? "bg-rose-500 hover:bg-rose-600 text-white border-rose-600"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                      title={isMaintenance ? "เปิดใช้งานแคร่" : "ปิดปรับปรุงแคร่"}
                    >
                      <AlertTriangle size={13} className={isMaintenance ? "text-white" : "text-amber-500"} />
                      <span>{isMaintenance ? "เปิดใช้งาน" : "ปิดซ่อมบำรุง"}</span>
                    </button>

                    {/* ปุ่มลบแคร่ (เมื่อไม่มีการใช้งาน) */}
                    {usedMeters === 0 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteRack(rack.rackId)}
                        className="inline-flex p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shadow-2xs cursor-pointer shrink-0"
                        title="ลบแคร่ที่ว่างนี้"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Manual Rack Utilization Section */}
                <div className="space-y-2 sm:space-y-3">
                  {/* Top Metric Bar & Numeric Input with 1-meter intervals */}
                  <div className="flex flex-row sm:flex-wrap items-center justify-between gap-2 sm:gap-3 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 sm:p-3 rounded-lg sm:rounded-xl border border-slate-200/80 dark:border-slate-800">
                    {/* Mobile: Rack Number & Machine Name inline with Numeric Input */}
                    <div className="flex sm:hidden items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center font-black text-cyan-600 dark:text-cyan-400 text-xs shrink-0">
                        {String(rack.rackNo).padStart(2, "0")}
                      </div>
                      <h3 className="text-xs font-black text-slate-800 dark:text-slate-100 whitespace-nowrap truncate">
                        {formatRackName(rack.rackNo, currentMachine)}
                      </h3>
                    </div>

                    {/* Desktop: Current Rack Utilization Status */}
                    <div className="hidden sm:flex items-center gap-2">
                      <Scale size={16} className="text-cyan-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex text-xs font-bold text-slate-800 dark:text-slate-100 items-center gap-1.5">
                          <span>สถานะการใช้งานแคร่ปัจจุบัน</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <span>ยาว: <strong className="text-slate-700 dark:text-slate-200 font-mono">{maxMeters} ม.</strong> (<strong className="text-slate-700 dark:text-slate-200 font-mono">{formatTons(maxTons)}T</strong>)</span>
                          <span>·</span>
                          <span>ใช้: <strong className="text-cyan-600 dark:text-cyan-400 font-mono">{usedMeters} ม.</strong> (<strong className="text-cyan-600 dark:text-cyan-400 font-mono">{formatTons(usedTons)}T</strong> · {percent}%)</span>
                          <span>·</span>
                          <span>คงเหลือ: <strong className={`font-mono ${remainingMeters === 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"}`}>{remainingMeters} ม. ({formatTons(remainingTons)}T)</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Numeric Input with 1-Meter Interval Controls */}
                    <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
                      <span className="hidden sm:inline text-xs font-semibold text-slate-600 dark:text-slate-300">
                        ปริมาณการใช้แคร่:
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className="inline-flex items-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg sm:rounded-xl overflow-hidden shadow-2xs">
                          {/* Minus 1 Meter Button */}
                          <button
                            type="button"
                            disabled={isMaintenance || usedMeters <= 0}
                            onClick={() => handleUpdateUsedMeters(rack.rackId, usedMeters - 1)}
                            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed font-bold text-sm sm:text-base transition-colors cursor-pointer"
                            title="ลดลง 1 เมตร"
                          >
                            -
                          </button>

                          {/* Number Input (Step = 1 meter) */}
                          <input
                            type="number"
                            min={0}
                            max={maxMeters}
                            step={1}
                            value={usedMeters}
                            disabled={isMaintenance}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              handleUpdateUsedMeters(rack.rackId, isNaN(val) ? 0 : val);
                            }}
                            className="w-10 sm:w-14 h-7 sm:h-8 text-center font-mono font-black text-xs sm:text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />

                          {/* Plus 1 Meter Button */}
                          <button
                            type="button"
                            disabled={isMaintenance || usedMeters >= maxMeters}
                            onClick={() => handleUpdateUsedMeters(rack.rackId, usedMeters + 1)}
                            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed font-bold text-sm sm:text-base transition-colors cursor-pointer"
                            title="เพิ่มขึ้น 1 เมตร"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-200">
                          เมตร
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Touch Draggable Status Tube (Interactive Range Slider Tube) */}
                  <div className="relative">
                    <div className="relative w-full h-11 sm:h-14 bg-slate-100 dark:bg-slate-950 rounded-xl sm:rounded-2xl border-2 border-slate-300 dark:border-slate-800 p-1 flex items-stretch overflow-hidden shadow-inner select-none">
                      {/* Rail Skid Metal Track Texture Line */}
                      <div className="absolute inset-x-0 bottom-0 h-1 sm:h-1.5 bg-slate-300 dark:bg-slate-800 pointer-events-none" />

                      {/* 1-Meter Interval Grid Line Markers across the tube */}
                      {Array.from({ length: maxMeters + 1 }).map((_, idx) => {
                        if (idx === 0 || idx === maxMeters) return null;
                        const leftPercent = (idx / maxMeters) * 100;
                        return (
                          <div
                            key={idx}
                            style={{ left: `${leftPercent}%` }}
                            className="absolute top-0 bottom-0 w-[1px] bg-slate-400/40 dark:bg-slate-600/50 z-10 pointer-events-none"
                          />
                        );
                      })}

                      {/* Active Used Segment */}
                      {usedMeters > 0 && (
                        <div
                          style={{ width: `${(usedMeters / maxMeters) * 100}%` }}
                          className={`h-full rounded-lg sm:rounded-xl transition-all duration-150 flex items-center justify-center text-white font-bold text-[10.5px] sm:text-xs shadow-md shrink-0 relative overflow-hidden ${
                            usedMeters >= maxMeters
                              ? "bg-gradient-to-r from-rose-600 via-rose-500 to-red-600"
                              : "bg-gradient-to-r from-cyan-600 via-sky-500 to-blue-600"
                          }`}
                        >
                          <span className="font-mono tabular-nums drop-shadow-xs px-1.5 sm:px-2 whitespace-nowrap truncate">
                            ใช้แล้ว {usedMeters} ม. ({formatTons(usedTons)}T)
                          </span>
                        </div>
                      )}

                      {/* Empty Segment */}
                      {remainingMeters > 0 && (
                        <div
                          style={{ width: `${(remainingMeters / maxMeters) * 100}%` }}
                          className={`h-full rounded-lg sm:rounded-xl flex items-center justify-center font-bold text-[10.5px] sm:text-xs shrink-0 transition-all duration-150 overflow-hidden ${
                            usedMeters === 0
                              ? "w-full bg-emerald-600 text-emerald-50 shadow-sm"
                              : "text-slate-500 dark:text-slate-400 bg-slate-200/50 dark:bg-slate-800/40"
                          }`}
                        >
                          <span className="font-mono tabular-nums whitespace-nowrap px-1.5 sm:px-2 truncate">
                            {usedMeters === 0
                              ? `แคร่ว่างพร้อมวาง (${maxMeters} ม. · ${formatTons(maxTons)} ตัน)`
                              : `ว่าง ${remainingMeters} ม. (${formatTons(remainingTons)}T)`}
                          </span>
                        </div>
                      )}

                      {/* Touch & Drag Range Slider Overlay */}
                      <input
                        type="range"
                        min={0}
                        max={maxMeters}
                        step={1}
                        value={usedMeters}
                        disabled={isMaintenance}
                        onChange={(e) => handleUpdateUsedMeters(rack.rackId, parseInt(e.target.value, 10))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize touch-pan-x z-20 disabled:cursor-not-allowed"
                        title="ใช้นิ้วหรือเมาส์เลื่อนแถบสถานะเพื่อปรับปริมาณการใช้งานแคร่ (แบ่งช่วงละ 1 เมตร)"
                      />

                      {/* Visual Thumb Indicator for Touch Dragging */}
                      {!isMaintenance && (
                        <div
                          style={{
                            left: `calc(${(usedMeters / maxMeters) * 100}% - 12px)`,
                            pointerEvents: "none"
                          }}
                          className="absolute top-1/2 -translate-y-1/2 w-6 h-8 sm:w-7 sm:h-10 rounded-md sm:rounded-lg bg-white dark:bg-slate-200 border-2 border-slate-700 dark:border-slate-900 shadow-lg flex items-center justify-center z-15 transition-all duration-150"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="w-2 sm:w-2.5 h-[2px] bg-slate-600 dark:bg-slate-700 rounded-full" />
                            <div className="w-2 sm:w-2.5 h-[2px] bg-slate-600 dark:bg-slate-700 rounded-full" />
                            <div className="w-2 sm:w-2.5 h-[2px] bg-slate-600 dark:bg-slate-700 rounded-full" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Quick 1-Meter Interval Selector Buttons / Ruler underneath */}
                    <div className="mt-2 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between text-[11px] text-slate-500 sm:px-1 gap-1.5 sm:gap-2">
                      <span className="hidden sm:flex text-[11px] font-medium text-slate-500 dark:text-slate-400 items-center gap-1.5">
                        <Hand size={12} className="text-cyan-500 shrink-0" />
                        <span>ใช้นิ้วเลื่อนแถบสถานะ หรือแตะเลือกระยะ (เมตร):</span>
                      </span>

                      <div className="grid grid-flow-col auto-cols-fr sm:flex items-center gap-1 sm:gap-1.5 w-full sm:w-auto">
                        {Array.from({ length: maxMeters + 1 }).map((_, mVal) => {
                          const isActive = usedMeters === mVal;
                          return (
                            <button
                              key={mVal}
                              type="button"
                              disabled={isMaintenance}
                              onClick={() => handleUpdateUsedMeters(rack.rackId, mVal)}
                              className={`px-1.5 sm:px-2 py-1 sm:py-0.5 rounded-lg sm:rounded-md font-mono text-[10.5px] sm:text-[11px] font-bold transition-all shadow-2xs cursor-pointer text-center ${
                                isActive
                                  ? mVal >= maxMeters
                                    ? "bg-rose-600 text-white shadow-xs"
                                    : mVal === 0
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "bg-cyan-600 text-white shadow-xs"
                                  : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={`กำหนดปริมาณใช้งานเป็น ${mVal} เมตร`}
                            >
                              {mVal} ม.
                            </button>
                          );
                        })}
                      </div>
                    </div>
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
