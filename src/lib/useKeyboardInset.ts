"use client";

import { useEffect, useState } from "react";

// Height in px of the iOS on-screen keyboard overlapping the layout viewport.
// position:fixed elements anchor to the layout viewport, which iOS does NOT
// shrink when the keyboard opens — only visualViewport shrinks. Translate
// fixed bottom bars up by this amount so they stay visible while typing.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => {
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    onChange();
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    };
  }, []);

  return inset;
}
