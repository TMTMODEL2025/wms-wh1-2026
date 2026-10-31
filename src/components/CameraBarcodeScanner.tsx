import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, RefreshCw, Zap, ZapOff, AlertCircle } from "lucide-react";

export interface CameraBarcodeScannerProps {
  onScan: (scannedText: string) => void;
  onClose?: () => void;
  isThai?: boolean;
  placeholderText?: string;
}

// Supported 1D and 2D barcode formats for industrial warehouse usage
const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];

export const CameraBarcodeScanner: React.FC<CameraBarcodeScannerProps> = ({
  onScan,
  onClose,
  isThai = true,
  placeholderText,
}) => {
  const containerId = useRef(`barcode-reader-${Math.random().toString(36).substring(2, 9)}`).current;
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const lastScannedRef = useRef<{ text: string; time: number }>({ text: "", time: 0 });

  // Stop scanner safely
  const stopScanner = useCallback(async () => {
    if (html5QrCodeRef.current && isScanning) {
      try {
        await html5QrCodeRef.current.stop();
      } catch {
        // Ignore stop errors if already stopped
      }
    }
    setIsScanning(false);
  }, [isScanning]);

  // Start scanner with specific camera or facing mode
  const startScanner = useCallback(
    async (cameraId?: string) => {
      setErrorMessage(null);

      // Clean up previous instance if running
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
          await html5QrCodeRef.current.clear();
        } catch {
          // ignore
        }
      }

      try {
        const qrCode = new Html5Qrcode(containerId, {
          formatsToSupport: SUPPORTED_FORMATS,
          verbose: false,
        });
        html5QrCodeRef.current = qrCode;

        // Camera selection: use requested camera, or environment (back) camera
        const cameraConfig = cameraId
          ? cameraId
          : { facingMode: "environment" };

        const config = {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            // Industrial wide barcode target box
            return {
              width: Math.min(Math.floor(viewfinderWidth * 0.85), 320),
              height: Math.min(Math.floor(minEdge * 0.45), 180),
            };
          },
          aspectRatio: 1.777778, // 16:9
        };

        await qrCode.start(
          cameraConfig,
          config,
          (decodedText) => {
            const now = Date.now();
            // Debounce same barcode within 1.5s
            if (
              lastScannedRef.current.text === decodedText &&
              now - lastScannedRef.current.time < 1500
            ) {
              return;
            }
            lastScannedRef.current = { text: decodedText, time: now };

            // Vibrate if supported
            if (navigator.vibrate) {
              try {
                navigator.vibrate(50);
              } catch {}
            }

            onScan(decodedText);
          },
          () => {
            // Frame scanned with no code found - silent
          }
        );

        setIsScanning(true);

        // Check torch capabilities
        try {
          const videoTrack = (qrCode as unknown as { getRunningTrack?: () => MediaStreamTrack }).getRunningTrack?.();
          if (videoTrack) {
            const capabilities = videoTrack.getCapabilities?.() as { torch?: boolean } | undefined;
            setHasTorch(Boolean(capabilities?.torch));
          }
        } catch {
          setHasTorch(false);
        }
      } catch (err: unknown) {
        const errStr = err instanceof Error ? err.message : String(err);
        if (errStr.includes("NotAllowedError") || errStr.includes("Permission")) {
          setErrorMessage(
            isThai
              ? "เบราว์เซอร์ยังไม่ได้รับอนุญาตให้ใช้กล้อง กรุณากดอนุญาตการเข้าถึงกล้อง (Camera Permission) ในการตั้งค่าเบราว์เซอร์"
              : "Camera access was denied. Please allow camera access in your browser settings."
          );
        } else if (errStr.includes("NotFoundError") || errStr.includes("DevicesNotFoundError")) {
          setErrorMessage(
            isThai
              ? "ไม่พบอุปกรณ์กล้องบนอุปกรณ์นี้ หรือมีแอพอื่นกำลังใช้งานกล้องอยู่"
              : "No camera device detected on this device or camera is in use."
          );
        } else {
          setErrorMessage(
            isThai
              ? `ไม่สามารถเปิดกล้องได้: ${errStr}`
              : `Unable to open camera: ${errStr}`
          );
        }
        setIsScanning(false);
      }
    },
    [containerId, isThai, onScan]
  );

  // Initialize camera list and start initial scan
  useEffect(() => {
    let isMounted = true;

    Html5Qrcode.getCameras()
      .then((devices) => {
        if (!isMounted) return;
        if (devices && devices.length > 0) {
          setCameras(devices);
          // Prefer back/environment camera
          const backCam = devices.find((d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("rear") ||
            d.label.toLowerCase().includes("environment")
          );
          const initialCamId = backCam ? backCam.id : devices[0].id;
          setSelectedCameraId(initialCamId);
          startScanner(initialCamId);
        } else {
          startScanner();
        }
      })
      .catch(() => {
        if (isMounted) {
          startScanner();
        }
      });

    return () => {
      isMounted = false;
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().catch(() => {});
          }
          html5QrCodeRef.current.clear();
        } catch {}
      }
    };
  }, [startScanner]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!html5QrCodeRef.current) return;
    try {
      const nextState = !isTorchOn;
      const track = (html5QrCodeRef.current as unknown as { getRunningTrack?: () => MediaStreamTrack }).getRunningTrack?.();
      if (track) {
        await track.applyConstraints({
          advanced: [{ torch: nextState } as MediaTrackConstraintSet],
        });
        setIsTorchOn(nextState);
      }
    } catch {
      // Torch not supported on this track
    }
  };

  // Flip/Switch Camera
  const switchCamera = () => {
    if (cameras.length <= 1) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];
    setSelectedCameraId(nextCamera.id);
    startScanner(nextCamera.id);
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-700 shadow-2xl flex flex-col items-center">
      {/* Video Viewfinder Container */}
      <div className="relative w-full max-h-[340px] bg-black flex items-center justify-center overflow-hidden">
        <div id={containerId} className="w-full h-full min-h-[220px]" />

        {/* Overlay Aiming Frame */}
        {isScanning && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4">
            <div className="relative w-[85%] max-w-[320px] h-[140px] border-2 border-emerald-400 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              {/* Corner Accents */}
              <div className="absolute -top-1.5 -left-1.5 w-4 h-4 border-t-4 border-l-4 border-emerald-400 rounded-tl-sm" />
              <div className="absolute -top-1.5 -right-1.5 w-4 h-4 border-t-4 border-r-4 border-emerald-400 rounded-tr-sm" />
              <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 border-b-4 border-l-4 border-emerald-400 rounded-bl-sm" />
              <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 border-b-4 border-r-4 border-emerald-400 rounded-br-sm" />

              {/* Scanning Red Laser Line */}
              <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)] animate-pulse" />
            </div>

            <p className="mt-3 text-[11px] font-semibold text-emerald-300 bg-slate-900/80 px-3 py-1 rounded-full border border-emerald-500/30 backdrop-blur-xs">
              {placeholderText || (isThai ? "เล็งบาร์โค้ดให้อยู่ในกรอบเพื่อสแกนอัตโนมัติ" : "Align barcode within frame to scan")}
            </p>
          </div>
        )}

        {/* Error Fallback */}
        {errorMessage && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center text-rose-300">
            <AlertCircle size={36} className="text-rose-400 mb-2" />
            <p className="text-xs font-semibold max-w-sm">{errorMessage}</p>
            <button
              type="button"
              onClick={() => startScanner(selectedCameraId || undefined)}
              className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw size={14} />
              <span>{isThai ? "ลองใหม่อีกครั้ง" : "Try Again"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Camera Controls Bar */}
      <div className="w-full px-4 py-2.5 bg-slate-900/95 border-t border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {cameras.length > 1 && (
            <button
              type="button"
              onClick={switchCamera}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
              title={isThai ? "สลับกล้องหน้า/หลัง" : "Switch camera"}
            >
              <RefreshCw size={13} />
              <span>{isThai ? "สลับกล้อง" : "Flip Cam"}</span>
            </button>
          )}

          {hasTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all ${
                isTorchOn
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                  : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
              }`}
            >
              {isTorchOn ? <ZapOff size={13} /> : <Zap size={13} />}
              <span>{isThai ? (isTorchOn ? "ปิดไฟฉาย" : "เปิดไฟฉาย") : isTorchOn ? "Flash Off" : "Flash"}</span>
            </button>
          )}
        </div>

        {onClose && (
          <button
            type="button"
            onClick={() => {
              stopScanner().then(() => {
                onClose();
              });
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 cursor-pointer active:scale-95 transition-all"
          >
            {isThai ? "ปิดกล้อง" : "Close Camera"}
          </button>
        )}
      </div>
    </div>
  );
};
