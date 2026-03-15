import { createContext, useContext, useState, ReactNode } from "react";

export const STORAGE_KEY = "flashcard_pending_generation";

export interface GenerationState {
  isGenerating: boolean;
  courseId: string | null;
  startTime: number | null; // Date.now() ms
  genCount: number;
}

interface GenerationContextType extends GenerationState {
  startGeneration: (courseId: string, count: number) => void;
  endGeneration: () => void;
}

const GenerationContext = createContext<GenerationContextType>({
  isGenerating: false,
  courseId: null,
  startTime: null,
  genCount: 0,
  startGeneration: () => {},
  endGeneration: () => {},
});

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GenerationState>(() => {
    // On mount (including F5): restore from localStorage if there's a pending generation
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved?.courseId && saved?.startTime) {
        return {
          isGenerating: true,
          courseId: saved.courseId,
          startTime: saved.startTime,
          genCount: saved.genCount ?? 60,
        };
      }
    } catch {}
    return { isGenerating: false, courseId: null, startTime: null, genCount: 0 };
  });

  const startGeneration = (courseId: string, count: number) => {
    const next: GenerationState = {
      isGenerating: true,
      courseId,
      startTime: Date.now(),
      genCount: count,
    };
    setState(next);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          courseId: next.courseId,
          startTime: next.startTime,
          genCount: next.genCount,
        })
      );
    } catch {}
  };

  const endGeneration = () => {
    setState({ isGenerating: false, courseId: null, startTime: null, genCount: 0 });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  return (
    <GenerationContext.Provider value={{ ...state, startGeneration, endGeneration }}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration() {
  return useContext(GenerationContext);
}
