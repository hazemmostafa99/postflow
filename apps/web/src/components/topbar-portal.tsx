"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function TopbarPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let attempts = 0;

    function connect() {
      const element = document.getElementById("dashboard-topbar-actions");
      if (element) {
        setTarget(element);
        return;
      }
      attempts += 1;
      if (attempts < 10) frame = window.requestAnimationFrame(connect);
    }

    frame = window.requestAnimationFrame(connect);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return target ? createPortal(children, target) : null;
}
