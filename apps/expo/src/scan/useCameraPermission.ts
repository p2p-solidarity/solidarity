/**
 * Camera permission helper for the QR scanner. Centralised so the
 * "request → check → guard" dance lives in one place; callers just
 * read `granted`.
 *
 * Vision Camera v5 exposes permission state through a hook. We keep the
 * consumer-facing `'pending' | 'granted' | 'denied'` contract and translate
 * at the edge so callers don't have to learn the camera library shape.
 */
import { useEffect, useState } from 'react';
import {
  useCameraPermission as useVisionCameraPermission,
} from 'react-native-vision-camera';

export type CameraPermissionState = 'pending' | 'granted' | 'denied';

/**
 * Persists ACROSS scanner mounts (module scope, not `useState`): once we have
 * auto-requested the OS permission exactly once and it did not result in a
 * grant, we must NOT auto-request again on every subsequent scanner mount
 * (R26 — the permission loop). The OS won't re-prompt after a denial anyway;
 * recovery is via the denied state's "Open Settings" CTA, not another
 * silent request. A later grant flips `hasPermission` true and we short-
 * circuit to 'granted' regardless of this flag.
 */
let hasAutoRequested = false;

export function useCameraPermission(): CameraPermissionState {
  const [state, setState] = useState<CameraPermissionState>('pending');
  const { hasPermission, requestPermission } = useVisionCameraPermission();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (hasPermission) {
        hasAutoRequested = true;
        if (!cancelled) setState('granted');
        return;
      }
      // Already asked once this session and still no permission → it's a
      // denial. Surface it WITHOUT re-requesting so the UI can offer
      // "Open Settings" instead of silently re-triggering the permission
      // machinery on every remount.
      if (hasAutoRequested) {
        if (!cancelled) setState('denied');
        return;
      }
      hasAutoRequested = true;
      const granted = await requestPermission().catch(() => false);
      if (cancelled) return;
      setState(granted ? 'granted' : 'denied');
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPermission, requestPermission]);

  return state;
}
