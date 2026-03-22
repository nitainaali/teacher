import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  text: string;
}

export function HelpTooltip({ text }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const tooltipWidth = 288; // w-72
      setCoords({
        top: rect.bottom + 6,
        // align right edge of tooltip with right edge of button; clamp to viewport
        left: Math.max(8, rect.right - tooltipWidth),
      });
    }
    setOpen((p) => !p);
  };

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        onClick={handleClick}
        className="w-5 h-5 rounded-full bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600 text-xs font-bold flex items-center justify-center transition-colors"
        aria-label="help"
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 9999, width: "18rem" }}
            className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm text-gray-300 shadow-xl"
            dir="auto"
          >
            {text}
          </div>,
          document.body
        )}
    </div>
  );
}
