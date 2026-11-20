'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

/** Handheld scanners type the code and press Enter; the camera works where the browser has BarcodeDetector. */
export function ScanInput({ initial }: { initial: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    setSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) return;
    const detector = new Ctor({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a'] });
    const tick = async () => {
      if (cancelled || !videoRef.current) return;
      try {
        const found = await detector.detect(videoRef.current);
        const value = found[0]?.rawValue?.trim();
        if (value) {
          setScanning(false);
          router.push(`/inventory/scan?code=${encodeURIComponent(value)}`);
          return;
        }
      } catch {
        // The frame was not ready yet; try the next one.
      }
      requestAnimationFrame(() => void tick());
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (media) => {
        stream = media;
        if (!videoRef.current) return;
        videoRef.current.srcObject = media;
        await videoRef.current.play();
        void tick();
      })
      .catch(() => {
        setCameraError('The camera could not be opened. Type or scan the code instead.');
        setScanning(false);
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scanning, router]);

  return (
    <div className="space-y-3">
      <form method="get" action="/inventory/scan" className="flex flex-wrap items-end gap-2">
        <label className="text-[13px]">
          <span className="font-semibold text-ink-700">Asset tag, serial, item code or batch</span>
          <input
            ref={inputRef}
            name="code"
            defaultValue={initial}
            autoComplete="off"
            className="mt-1 block w-72 border border-ink-300 px-2 py-1.5"
            data-testid="scan-input"
          />
        </label>
        <Button type="submit" variant="primary">
          Look up
        </Button>
        {supported ? (
          <Button type="button" onClick={() => setScanning((value) => !value)}>
            {scanning ? 'Stop camera' : 'Use camera'}
          </Button>
        ) : null}
      </form>
      {cameraError ? <p className="text-[13px] text-danger-700">{cameraError}</p> : null}
      {scanning ? <video ref={videoRef} className="w-full max-w-md border border-ink-200" muted playsInline /> : null}
    </div>
  );
}
