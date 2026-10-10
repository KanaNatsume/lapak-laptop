import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { X } from 'lucide-react';

export default function ProductCodeCamera({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const detectedRef = useRef(onDetected);
  const [error, setError] = useState('');

  useEffect(() => { detectedRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    let stopped = false;
    const reader = new BrowserMultiFormatReader();
    reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      videoRef.current,
      (result) => { if (result && !stopped) detectedRef.current(result.getText()); }
    ).then((controls) => {
      if (stopped) controls.stop();
      else controlsRef.current = controls;
    }).catch(() => setError('Kamera tidak tersedia atau izin kamera ditolak.'));
    return () => { stopped = true; controlsRef.current?.stop(); };
  }, []);

  return <div className="cashier-camera-panel"><video ref={videoRef} muted playsInline /><div className="cashier-camera-actions">{error && <span role="alert">{error}</span>}<button type="button" className="icon-button bordered" onClick={onClose} aria-label="Tutup scanner"><X size={15} /></button></div></div>;
}
