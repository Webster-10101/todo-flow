import { useCallback, useEffect, useRef, useState } from "react";

export function useTransientFlag(durationMs: number) {
  const [on, setOn] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = useCallback(() => {
    if (!isMountedRef.current) return;
    setOn(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setOn(false);
      }
    }, durationMs);
  }, [durationMs]);

  return { on, trigger };
}


