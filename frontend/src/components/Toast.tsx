import { useEffect } from "react";

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ message, onDismiss, duration = 2000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-yellow-900/90 border border-yellow-700 rounded-xl px-4 py-3 text-sm text-yellow-200 shadow-lg animate-fade-in"
      onClick={onDismiss}
      style={{ cursor: "pointer" }}
    >
      <span>⚠</span>
      <span>{message}</span>
    </div>
  );
}
