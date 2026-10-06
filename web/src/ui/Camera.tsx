import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface CameraHandle {
  /** The current frame as a JPEG. */
  grab: () => Promise<Blob | null>;
}

/** Live camera preview with a framing guide. Uses the back camera on phones. */
export const Camera = forwardRef<CameraHandle, { onState?: (s: 'starting' | 'live' | 'blocked' | 'none') => void }>(function Camera(
  { onState },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'blocked' | 'none'>('starting');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let live = true;
    const set = (s: typeof state) => {
      setState(s);
      onState?.(s);
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      set('none');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (!live) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        set('live');
      })
      .catch((e: DOMException) => set(e.name === 'NotFoundError' ? 'none' : 'blocked'));
    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    grab: async () => {
      const v = video.current;
      if (!v || !v.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.9));
    },
  }));

  return (
    <div className={`camera camera--${state}`}>
      <video ref={video} playsInline muted />
      {state === 'live' && <div className="camera__guide" aria-hidden />}
      {state === 'starting' && <p className="camera__msg">Starting the camera…</p>}
      {state === 'blocked' && (
        <p className="camera__msg">
          Camera access is blocked. Allow it for this page in your browser’s site settings, or add a photo instead.
        </p>
      )}
      {state === 'none' && <p className="camera__msg">No camera here. Add a photo instead, or open Spotter on your phone.</p>}
    </div>
  );
});
