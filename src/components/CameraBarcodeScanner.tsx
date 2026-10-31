import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, RefreshCw, Zap, ZapOff, AlertCircle, ZoomIn } from "lucide-react";
import { cleanBarcode } from "../utils/barcodeUtils";

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): {
        detect(image: CanvasImageSource): Promise<
          Array<{
            rawValue: string;
            format: string;
            cornerPoints?: Array<{ x: number; y: number }>;
          }>
        >;
      };
      getSupportedFormats?(): Promise<string[]>;
    };
  }
}

export interface CameraBarcodeScannerProps {
  onScan: (scannedText: string) => void;
  onClose?: () => void;
  isThai?: boolean;
  placeholderText?: string;
}

// 1D and 2D barcode formats strictly used in industrial warehouse operations
const WAREHOUSE_BARCODE_FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "ean_13",
  "itf",
  "qr_code",
];

const FALLBACK_HTML5_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE,
];

export const CameraBarcodeScanner: React.FC<CameraBarcodeScannerProps> = ({
  onScan,
  onClose,
  isThai = true,
  placeholderText,
}) => {
  const containerId = useRef(`barcode-reader-${Math.random().toString(36).substring(2, 9)}`).current;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentTrackRef = useRef<MediaStreamTrack | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const nativeDetectorRef = useRef<{
    detect(image: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>>;
  } | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const isScanningRef = useRef<boolean>(false);
  const isDecodingRef = useRef<boolean>(false);
  const lastScanTimeRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const lastScannedRef = useRef<{ text: string; time: number }>({ text: "", time: 0 });

  const [isScanning, setIsScanning] = useState(false);
  const [isNativeMode, setIsNativeMode] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [hasZoom, setHasZoom] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // Stop scanner and release all media resources immediately
  const stopScanner = useCallback(async () => {
    isScanningRef.current = false;
    isDecodingRef.current = false;

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Stop Native MediaStream tracks immediately
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    currentTrackRef.current = null;

    // Stop and clear Fallback Html5Qrcode if active
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch {}
    }

    setIsScanning(false);
    setIsTorchOn(false);
  }, []);

  // Safe handler when a barcode is detected (with cooldown & validation)
  const handleDetectedCode = useCallback(
    (raw: string) => {
      const cleaned = cleanBarcode(raw);
      if (!cleaned) return;

      const now = Date.now();
      // 1.5 second cooldown for the same barcode to prevent duplicate rapid fires
      if (
        lastScannedRef.current.text === cleaned &&
        now - lastScannedRef.current.time < 1500
      ) {
        return;
      }
      lastScannedRef.current = { text: cleaned, time: now };

      // Haptic vibration feedback if device supports
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch {}
      }

      onScan(cleaned);
    },
    [onScan]
  );

  // Frame processing loop for Native BarcodeDetector
  const detectNativeFrame = useCallback(async () => {
    if (!isScanningRef.current || isDecodingRef.current) return;
    const video = videoRef.current;
    const detector = nativeDetectorRef.current;
    if (!video || !detector || video.readyState < 2 || video.paused || video.ended) {
      return;
    }

    isDecodingRef.current = true;
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw > 0 && vh > 0) {
        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement("canvas");
        }
        const canvas = offscreenCanvasRef.current;

        // ROI (Region of Interest) Cropping:
        // Crop center 82% width and 45% height corresponding to viewfinder aiming box
        // This reduces pixel volume by ~63%, dramatically accelerating decoding
        const roiW = Math.round(vw * 0.82);
        const roiH = Math.round(vh * 0.45);
        const roiX = Math.round((vw - roiW) / 2);
        const roiY = Math.round((vh - roiH) / 2);

        if (canvas.width !== roiW || canvas.height !== roiH) {
          canvas.width = roiW;
          canvas.height = roiH;
        }

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
          const barcodes = await detector.detect(canvas);
          if (barcodes && barcodes.length > 0) {
            const raw = barcodes[0].rawValue;
            if (raw) {
              handleDetectedCode(raw);
            }
          }
        }
      }
    } catch {
      // Ignore transient decode errors on single frame
    } finally {
      isDecodingRef.current = false;
    }
  }, [handleDetectedCode]);

  // Main RAF scheduling loop throttled to ~12 FPS for decode to prevent main-thread lag
  const startNativeScanLoop = useCallback(() => {
    isScanningRef.current = true;
    const loop = () => {
      if (!isScanningRef.current) return;
      const now = Date.now();
      // Throttle decode frequency to ~12 FPS (every 85ms) while video plays smoothly at 30 FPS
      if (now - lastScanTimeRef.current >= 85) {
        lastScanTimeRef.current = now;
        detectNativeFrame();
      }
      rafIdRef.current = requestAnimationFrame(loop);
    };
    rafIdRef.current = requestAnimationFrame(loop);
  }, [detectNativeFrame]);

  // Start scanner: Primary Native BarcodeDetector with Fallback to Html5Qrcode
  const startScanner = useCallback(
    async (cameraId?: string) => {
      setErrorMessage(null);
      await stopScanner();

      const supportsNative =
        typeof window !== "undefined" &&
        "BarcodeDetector" in window &&
        typeof (window as any).BarcodeDetector === "function";

      if (supportsNative) {
        try {
          let activeFormats = WAREHOUSE_BARCODE_FORMATS;
          if (typeof (window as any).BarcodeDetector.getSupportedFormats === "function") {
            try {
              const supported: string[] = await (window as any).BarcodeDetector.getSupportedFormats();
              activeFormats = WAREHOUSE_BARCODE_FORMATS.filter((f) => supported.includes(f));
            } catch {}
          }
          if (activeFormats.length === 0) activeFormats = WAREHOUSE_BARCODE_FORMATS;

          nativeDetectorRef.current = new (window as any).BarcodeDetector({ formats: activeFormats });

          // High definition video constraints tuned for 1D industrial barcodes
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: cameraId ? { exact: cameraId } : undefined,
              facingMode: cameraId ? undefined : { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
          });

          streamRef.current = stream;
          const videoTrack = stream.getVideoTracks()[0];
          currentTrackRef.current = videoTrack;

          // Advanced camera constraints: Continuous Auto-Focus, Zoom & Torch
          const capabilities = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as any;
          const advancedConstraints: any = {};

          if (capabilities.focusMode && Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
            advancedConstraints.focusMode = "continuous";
          }
          if (capabilities.exposureMode && Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) {
            advancedConstraints.exposureMode = "continuous";
          }
          if (capabilities.zoom) {
            setHasZoom(true);
            const minZ = capabilities.zoom.min || 1;
            const maxZ = capabilities.zoom.max || 1;
            setMaxZoom(maxZ);
            // Default slight zoom to help reading smaller coil labels without macro-blur
            const initZoom = Math.min(Math.max(1.2, minZ), maxZ);
            setCurrentZoom(initZoom);
            if (initZoom > minZ) {
              advancedConstraints.zoom = initZoom;
            }
          } else {
            setHasZoom(false);
          }
          if (capabilities.torch) {
            setHasTorch(true);
          } else {
            setHasTorch(false);
          }

          if (Object.keys(advancedConstraints).length > 0) {
            try {
              await videoTrack.applyConstraints({ advanced: [advancedConstraints] });
            } catch {}
          }

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }

          setIsNativeMode(true);
          setIsScanning(true);
          startNativeScanLoop();
          return;
        } catch (nativeErr) {
          console.warn("Native BarcodeDetector init failed, falling back to Html5Qrcode:", nativeErr);
        }
      }

      // Fallback Mode: Html5Qrcode with restricted warehouse formats
      try {
        setIsNativeMode(false);
        const qrCode = new Html5Qrcode(containerId, {
          formatsToSupport: FALLBACK_HTML5_FORMATS,
          verbose: false,
        });
        html5QrCodeRef.current = qrCode;

        const cameraConfig = cameraId ? cameraId : { facingMode: "environment" };
        const config = {
          fps: 12,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
            width: Math.min(Math.floor(viewfinderWidth * 0.85), 300),
            height: Math.min(Math.floor(viewfinderHeight * 0.45), 140),
          }),
          videoConstraints: {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            facingMode: cameraId ? undefined : { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          aspectRatio: 1.6,
        };

        await qrCode.start(
          cameraConfig,
          config,
          (decoded) => handleDetectedCode(decoded),
          () => {}
        );

        setIsScanning(true);

        try {
          const track = (qrCode as unknown as { getRunningTrack?: () => MediaStreamTrack }).getRunningTrack?.();
          if (track) {
            currentTrackRef.current = track;
            const capabilities = track.getCapabilities?.() as any;
            setHasTorch(Boolean(capabilities?.torch));
            if (capabilities?.zoom) {
              setHasZoom(true);
              setMaxZoom(capabilities.zoom.max || 1);
            }
          }
        } catch {}
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
    [containerId, isThai, handleDetectedCode, startNativeScanLoop, stopScanner]
  );

  // Initial camera discovery and launch
  useEffect(() => {
    let isMounted = true;

    navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => {
        if (!isMounted) return;
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        if (videoDevices.length > 0) {
          const mapped = videoDevices.map((d, i) => ({
            id: d.deviceId,
            label: d.label || (isThai ? `กล้อง ${i + 1}` : `Camera ${i + 1}`),
          }));
          setCameras(mapped);

          // Select back/environment camera by default
          const backCam = videoDevices.find((d) => {
            const lbl = d.label.toLowerCase();
            return lbl.includes("back") || lbl.includes("rear") || lbl.includes("environment");
          });
          const initialId = backCam ? backCam.deviceId : videoDevices[0].deviceId;
          setSelectedCameraId(initialId);
          startScanner(initialId);
        } else {
          startScanner();
        }
      })
      .catch(() => {
        if (isMounted) startScanner();
      });

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [isThai, startScanner, stopScanner]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    const track = currentTrackRef.current;
    if (!track) return;
    try {
      const nextState = !isTorchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextState } as any],
      });
      setIsTorchOn(nextState);
    } catch {}
  };

  // Toggle Zoom Level (e.g. 1.2x -> 2.0x -> 1.0x)
  const toggleZoom = async () => {
    const track = currentTrackRef.current;
    if (!track) return;
    try {
      const nextZoom = currentZoom >= 1.8 ? 1.0 : Math.min(2.0, maxZoom);
      await track.applyConstraints({
        advanced: [{ zoom: nextZoom } as any],
      });
      setCurrentZoom(nextZoom);
    } catch {}
  };

  // Flip/Switch Camera
  const switchCamera = async () => {
    if (cameras.length <= 1) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];
    setSelectedCameraId(nextCamera.id);
    await startScanner(nextCamera.id);
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-[#0c1930] border border-slate-700/80 shadow-xl flex flex-col">
      {/* Suppress html5-qrcode internal shaded region border to prevent double-bracket clutter */}
      <style>{`
        #${containerId} #qr-shaded-region {
          border: none !important;
          box-shadow: none !important;
        }
        #${containerId} video {
          object-fit: cover !important;
          width: 100% !important;
          border-radius: 1rem 1rem 0 0 !important;
        }
      `}</style>

      {/* Video Viewfinder Container */}
      <div className="relative w-full h-[230px] sm:h-[260px] bg-black flex items-center justify-center overflow-hidden">
        {/* Hardware-accelerated Native Video Element */}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className={`w-full h-full object-cover ${isNativeMode ? "block" : "hidden"}`}
        />

        {/* Fallback Html5Qrcode Element */}
        <div
          id={containerId}
          className={`w-full h-full ${!isNativeMode ? "block" : "hidden"}`}
        />

        {/* Top-Right Compact Red Ghost Button: "ปิดกล้อง" */}
        {onClose && (
          <button
            type="button"
            onClick={() => {
              stopScanner().then(() => onClose());
            }}
            className="absolute top-2.5 right-2.5 z-20 px-2.5 py-1 rounded-lg text-xs font-medium text-rose-300 hover:text-white bg-black/50 hover:bg-rose-950/70 border border-rose-500/50 backdrop-blur-md flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all shadow-md"
          >
            <Camera size={13} className="text-rose-400" />
            <span>{isThai ? "ปิดกล้อง" : "Close Cam"}</span>
          </button>
        )}

        {/* Overlay Aiming Frame: Clean white corner bracket overlays and thin red horizontal laser line */}
        {isScanning && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4">
            <div className="relative w-[82%] max-w-[290px] h-[130px]">
              {/* Subtle Clean White Corner Brackets */}
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white rounded-tl" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white rounded-tr" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white rounded-bl" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white rounded-br" />

              {/* Thin Horizontal Red Aiming Laser Line */}
              <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-[1.5px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.95)] animate-pulse" />
            </div>

            {/* Bottom Dark Semi-Transparent Badge Overlay */}
            <div className="absolute bottom-2.5 inset-x-0 flex justify-center pointer-events-none">
              <span className="text-[11px] font-medium text-slate-100 bg-black/60 backdrop-blur-md px-3.5 py-1 rounded-full border border-white/15 shadow-md">
                {placeholderText || (isThai ? "เล็งกล้องไปที่บาร์โค้ด Batch 10 หลัก" : "Aim at the 10-digit Batch barcode")}
              </span>
            </div>
          </div>
        )}

        {/* Error Fallback */}
        {errorMessage && (
          <div className="absolute inset-0 bg-[#0a1526]/95 flex flex-col items-center justify-center p-5 text-center text-rose-300 z-10">
            <AlertCircle size={32} className="text-rose-400 mb-2" />
            <p className="text-xs font-medium max-w-xs">{errorMessage}</p>
            <button
              type="button"
              onClick={() => startScanner(selectedCameraId || undefined)}
              className="mt-3 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer flex items-center gap-1.5 active:scale-95"
            >
              <RefreshCw size={13} />
              <span>{isThai ? "ลองใหม่อีกครั้ง" : "Try Again"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Camera Action Buttons Bar: Directly underneath viewport on a single balanced row */}
      <div className="w-full px-3 py-2 bg-[#0a1526] border-t border-slate-800/80 flex items-center gap-2">
        <button
          type="button"
          onClick={switchCamera}
          className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-200 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
        >
          <RefreshCw size={13} className="text-slate-300" />
          <span>{isThai ? "🔄 สลับกล้อง" : "🔄 Switch"}</span>
        </button>

        {hasZoom && (
          <button
            type="button"
            onClick={toggleZoom}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700/70 bg-slate-800/80 text-cyan-300 hover:text-white flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
            title={isThai ? "สลับระดับซูม 1x / 2x" : "Toggle zoom"}
          >
            <ZoomIn size={13} />
            <span>{currentZoom >= 1.8 ? "2x" : "1.2x"}</span>
          </button>
        )}

        {hasTorch && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all ${
              isTorchOn
                ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                : "bg-slate-800/80 text-slate-300 border-slate-700/70 hover:bg-slate-700"
            }`}
            title={isThai ? (isTorchOn ? "ปิดไฟฉาย" : "เปิดไฟฉาย") : isTorchOn ? "Flash Off" : "Flash"}
          >
            {isTorchOn ? <ZapOff size={13} /> : <Zap size={13} />}
            <span>{isThai ? (isTorchOn ? "ปิดไฟ" : "ไฟฉาย") : isTorchOn ? "Off" : "On"}</span>
          </button>
        )}

        {onClose && (
          <button
            type="button"
            onClick={() => {
              stopScanner().then(() => onClose());
            }}
            className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium text-slate-200 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
          >
            <span>{isThai ? "ปิดกล้อง" : "Turn off Camera"}</span>
          </button>
        )}
      </div>
    </div>
  );
};
