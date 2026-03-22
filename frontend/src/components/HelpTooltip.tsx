import { useState, useRef, useEffect } from "react";

interface Props {
  text: string;
}

export function HelpTooltip({ text }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-5 h-5 rounded-full bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600 text-xs font-bold flex items-center justify-center transition-colors"
        aria-label="help"
      >
        ?
      </button>
      {open && (
        <div
          className="absolute top-full start-0 mt-1 w-72 bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm text-gray-300 z-50 shadow-xl"
          dir="auto"
        >
          {text}
        </div>
      )}
    </div>
  );
}
