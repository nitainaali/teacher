import { useEffect, useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import {
  getDecks,
  getDeckCards,
  generateFlashcards,
  reviewFlashcard,
  updateFlashcard,
  deleteFlashcard,
  renameDeck,
  deleteDeck,
} from "../api/flashcards";
import type { FlashcardDeck } from "../api/flashcards";
import { MarkdownContent } from "../components/MarkdownContent";
import { RecommendationsPanel } from "../components/RecommendationsPanel";
import type { Flashcard } from "../types";
import { useGeneration, STORAGE_KEY } from "../context/GenerationContext";
import { predictIntervals } from "../utils/fsrsPredict";

type Mode = "config" | "mode_select" | "review";
type CountPreset = "short" | "medium" | "long";
type Difficulty = "easy" | "medium" | "hard";
type SessionMode = "anki" | "complete_first" | "mixed";

const ALL_CARD_TYPES = [
  "comprehension",
  "memorization",
  "tricks",
  "confusion",
] as const;
type CardType = (typeof ALL_CARD_TYPES)[number];

const COUNT_PRESETS: Record<CountPreset, number> = {
  short: 25,
  medium: 60,
  long: 100,
};

export function FlashcardsPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  const [mode, setMode] = useState<Mode>("config");
  const [activeDeck, setActiveDeck] = useState<FlashcardDeck | null>(null);

  // Session state
  const [sessionMode, setSessionMode] = useState<SessionMode | null>(null);
  const [sessionQueue, setSessionQueue] = useState<Flashcard[]>([]);
  const [hardQueue, setHardQueue] = useState<Flashcard[]>([]);
  const [inSecondPass, setInSecondPass] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [lastInterval, setLastInterval] = useState<number | null>(null);
  // pendingAdvance: quality rating waiting for 1.5s delay before advancing queue
  const [pendingAdvance, setPendingAdvance] = useState<number | null>(null);

  // Session stats: count of each grade (again/hard/good/easy) in the current session
  const [sessionStats, setSessionStats] = useState({ 0: 0, 1: 0, 2: 0, 3: 0 });

  // Edit card modal state
  const [editingCard, setEditingCard] = useState(false);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  // Delete card confirm state
  const [deletingCard, setDeletingCard] = useState(false);

  // Refs so performAdvance always reads current state inside setTimeout
  const sessionQueueRef = useRef<Flashcard[]>([]);
  const hardQueueRef = useRef<Flashcard[]>([]);
  const inSecondPassRef = useRef(false);
  const sessionModeRef = useRef<SessionMode | null>(null);

  sessionQueueRef.current = sessionQueue;
  hardQueueRef.current = hardQueue;
  inSecondPassRef.current = inSecondPass;
  sessionModeRef.current = sessionMode;

  // Deck list
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(false);
  // Version counter: prevents stale fetchDecks() responses from overwriting fresh data
  const fetchVersionRef = useRef(0);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Generation context — persists across navigation + F5
  const { isGenerating, courseId: genCourseId, startTime, genCount: ctxGenCount, startGeneration, endGeneration } = useGeneration();
  // isGenerating for THIS course (context may track a different course)
  const generating = isGenerating && genCourseId === courseId;

  // Generate config
  const [countPreset, setCountPreset] = useState<CountPreset>("medium");
  const [genCount, setGenCount] = useState(60);
  const [genDifficulty, setGenDifficulty] = useState<Difficulty>("medium");
  const [genCardTypes, setGenCardTypes] = useState<Set<CardType>>(new Set(ALL_CARD_TYPES));
  const [genTopic, setGenTopic] = useState("");
  const [genGuidance, setGenGuidance] = useState("");
  const [genError, setGenError] = useState<string | null>(null);

  // % progress: estimated from startTime + genCount
  const [genPct, setGenPct] = useState(0);

  // Predicted intervals for current card (used for button labels)
  const currentCard = sessionQueue[0] ?? null;
  const intervals = useMemo(
    () => (currentCard ? predictIntervals(currentCard) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentCard?.id],
  );

  const fetchDecks = () => {
    if (!courseId) return;
    const version = ++fetchVersionRef.current;
    setLoadingDecks(true);
    getDecks(courseId)
      .then((result) => { if (version === fetchVersionRef.current) setDecks(result); })
      .catch(() => {})
      .finally(() => { if (version === fetchVersionRef.current) setLoadingDecks(false); });
  };

  useEffect(() => {
    fetchDecks();
  }, [courseId]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // % progress while generating: recalculates every second based on startTime
  useEffect(() => {
    if (!generating) {
      setGenPct(0);
      return;
    }
    const tick = () => {
      if (!startTime) return;
      const elapsed = (Date.now() - startTime) / 1000;
      const estimatedSeconds = Math.max(60, (generating ? ctxGenCount : genCount) * 4);
      setGenPct(Math.min(Math.round((elapsed / estimatedSeconds) * 100), 98));
    };
    tick(); // immediate update on mount/re-mount
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [generating, startTime, ctxGenCount]);

  // Polling: when page mounts while generation is in progress (navigation or F5),
  // poll /decks every 5s and auto-refresh when new deck appears
  useEffect(() => {
    if (!generating || !courseId) return;

    // Capture startTime at poll start so we can detect new decks
    const pending = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
    })();
    const pollStart: number = pending?.startTime ?? (startTime ?? Date.now());

    const interval = setInterval(async () => {
      try {
        const freshDecks = await getDecks(courseId);
        const hasNewDeck = freshDecks.some(
          (d) => new Date(d.created_at).getTime() > pollStart
        );
        if (hasNewDeck) {
          endGeneration();
          setDecks(freshDecks);
        }
      } catch {
        // silently ignore poll errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [generating, courseId]);

  // After 1.5s from a rating, advance the queue
  useEffect(() => {
    if (pendingAdvance === null) return;
    const quality = pendingAdvance;
    const timer = setTimeout(() => {
      performAdvance(quality);
      setPendingAdvance(null);
      setLastInterval(null);
      setFlipped(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [pendingAdvance]);

  // Advance the session queue according to the active learning mode
  const performAdvance = (quality: number) => {
    const queue = sessionQueueRef.current;
    const hard = hardQueueRef.current;
    const isSecondPass = inSecondPassRef.current;
    const sm = sessionModeRef.current;

    const card = queue[0];
    const remaining = queue.slice(1);

    if (sm === "anki") {
      if (quality <= 1) {
        // Reinsert card 3 positions ahead
        const insertAt = Math.min(3, remaining.length);
        setSessionQueue([
          ...remaining.slice(0, insertAt),
          card,
          ...remaining.slice(insertAt),
        ]);
      } else {
        setSessionQueue(remaining);
      }
    } else if (sm === "complete_first") {
      if (!isSecondPass) {
        const newHard = quality <= 1 ? [...hard, card] : hard;
        if (remaining.length === 0) {
          // First pass done → start second pass
          setInSecondPass(true);
          setSessionQueue(newHard);
          setHardQueue([]);
        } else {
          setHardQueue(newHard);
          setSessionQueue(remaining);
        }
      } else {
        // Second pass: just advance
        setSessionQueue(remaining);
      }
    } else {
      // mixed: reinsert at random position
      if (quality <= 1) {
        const insertAt = Math.floor(Math.random() * (remaining.length + 1));
        setSessionQueue([
          ...remaining.slice(0, insertAt),
          card,
          ...remaining.slice(insertAt),
        ]);
      } else {
        setSessionQueue(remaining);
      }
    }
  };

  const handleSetPreset = (preset: CountPreset) => {
    setCountPreset(preset);
    setGenCount(COUNT_PRESETS[preset]);
  };

  const handleCountInput = (val: number) => {
    const clamped = Math.max(20, Math.min(150, val));
    setGenCount(clamped);
    if (clamped <= 40) setCountPreset("short");
    else if (clamped <= 80) setCountPreset("medium");
    else setCountPreset("long");
  };

  const toggleCardType = (type: CardType) => {
    setGenCardTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type) && next.size > 1) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!courseId) return;
    setGenError(null);
    startGeneration(courseId, genCount);
    try {
      const cardTypeParam =
        genCardTypes.size === 1 ? Array.from(genCardTypes)[0] : "mixed";
      await generateFlashcards(
        courseId,
        genCount,
        cardTypeParam as string,
        genDifficulty,
        genTopic.trim() || undefined,
        genGuidance.trim() || undefined,
        i18n.language,
      );
      fetchDecks(); // Fresh fetch from DB (always wins over stale mount fetch)
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setGenError(
        typeof detail === "string"
          ? detail
          : err instanceof Error
          ? err.message
          : t("common.error"),
      );
    } finally {
      endGeneration();
    }
  };

  const handleStartDeck = async (deck: FlashcardDeck) => {
    try {
      const deckCards = await getDeckCards(deck.id);
      setActiveDeck(deck);
      setSessionQueue(deckCards);
      setHardQueue([]);
      setInSecondPass(false);
      setFlipped(false);
      setLastInterval(null);
      setPendingAdvance(null);
      setSessionMode(null);
      setSessionStats({ 0: 0, 1: 0, 2: 0, 3: 0 });
      setMode("mode_select");
    } catch {
      /* silently fail */
    }
  };

  const handleModeSelect = (sm: SessionMode) => {
    setSessionMode(sm);
    if (sm === "mixed") {
      setSessionQueue((prev) => {
        const shuffled = [...prev];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      });
    }
    setMode("review");
  };

  const handleReview = async (quality: number) => {
    const current = sessionQueueRef.current[0];
    if (!current || pendingAdvance !== null) return;
    setSessionStats(prev => ({ ...prev, [quality]: prev[quality as keyof typeof prev] + 1 }));
    const updated = await reviewFlashcard(current.id, quality);
    setLastInterval(updated.interval_days);
    setPendingAdvance(quality);
  };

  // ── Edit / Delete card handlers ───────────────────────────────────────────────

  const handleEditOpen = () => {
    const card = sessionQueueRef.current[0];
    if (!card) return;
    setEditFront(card.front);
    setEditBack(card.back);
    setEditingCard(true);
  };

  const handleEditSave = async () => {
    const card = sessionQueueRef.current[0];
    if (!card) return;
    setEditSaving(true);
    try {
      const updated = await updateFlashcard(card.id, editFront, editBack);
      setSessionQueue((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingCard(false);
    } catch {
      /* silently fail */
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteCard = async () => {
    const card = sessionQueueRef.current[0];
    if (!card) return;
    try {
      await deleteFlashcard(card.id);
      setSessionQueue((prev) => prev.filter((c) => c.id !== card.id));
      setDeletingCard(false);
      setFlipped(false);
      setPendingAdvance(null);
    } catch {
      /* silently fail */
    }
  };

  // ── Rename / Delete deck handlers ─────────────────────────────────────────────

  const handleRenameStart = (deck: FlashcardDeck) => {
    setRenamingId(deck.id);
    setRenameValue(deck.name);
  };

  const handleRenameSave = async (deckId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      try {
        const updated = await renameDeck(deckId, trimmed);
        setDecks((prev) => prev.map((d) => (d.id === deckId ? updated : d)));
      } catch {
        /* silently fail */
      }
    }
    setRenamingId(null);
  };

  const handleDeleteDeck = async (deckId: string) => {
    try {
      await deleteDeck(deckId);
      setDecks((prev) => prev.filter((d) => d.id !== deckId));
    } catch {
      /* silently fail */
    }
  };

  const backToConfig = () => {
    setMode("config");
    setActiveDeck(null);
    setSessionQueue([]);
    setHardQueue([]);
    setInSecondPass(false);
    setFlipped(false);
    setLastInterval(null);
    setPendingAdvance(null);
    setSessionMode(null);
    setSessionStats({ 0: 0, 1: 0, 2: 0, 3: 0 });
  };

  // ── Mode select screen ────────────────────────────────────────────────────────
  if (mode === "mode_select") {
    return (
      <div className="max-w-xl mx-auto">
        <button
          onClick={backToConfig}
          className="text-sm text-gray-400 hover:text-white mb-4 flex items-center gap-1 transition-colors"
        >
          ← {t("common.back")}
        </button>

        {activeDeck && (
          <p className="text-xs text-gray-500 mb-4">
            {activeDeck.name} · {t("flashcards.deckCards", { n: activeDeck.card_count })}
          </p>
        )}

        <h2 className="text-lg font-semibold text-white mb-4">{t("flashcards.selectMode")}</h2>

        <div className="space-y-3">
          {([
            {
              key: "anki" as SessionMode,
              title: t("flashcards.modeAnki"),
              desc: t("flashcards.modeAnkiDesc"),
              icon: "🔁",
            },
            {
              key: "complete_first" as SessionMode,
              title: t("flashcards.modeComplete"),
              desc: t("flashcards.modeCompleteDesc"),
              icon: "✅",
            },
            {
              key: "mixed" as SessionMode,
              title: t("flashcards.modeMixed"),
              desc: t("flashcards.modeMixedDesc"),
              icon: "🔀",
            },
          ] as const).map(({ key, title, desc, icon }) => (
            <button
              key={key}
              onClick={() => handleModeSelect(key)}
              className="w-full text-left bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-blue-600 rounded-xl px-5 py-4 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{icon}</span>
                <div>
                  <p className="text-white font-medium group-hover:text-blue-300 transition-colors">
                    {title}
                  </p>
                  <p className="text-gray-400 text-sm mt-0.5">{desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Review mode ───────────────────────────────────────────────────────────────
  if (mode === "review") {
    const done =
      sessionMode === "complete_first"
        ? inSecondPass && sessionQueue.length === 0 && pendingAdvance === null
        : sessionQueue.length === 0 && pendingAdvance === null;
    const current = sessionQueue[0];

    return (
      <div className="max-w-xl mx-auto">
        <button
          onClick={backToConfig}
          className="text-sm text-gray-400 hover:text-white mb-4 flex items-center gap-1 transition-colors"
        >
          ← {t("common.back")}
        </button>

        {activeDeck && (
          <p className="text-xs text-gray-500 mb-1">
            {activeDeck.name} · {t("flashcards.deckCards", { n: activeDeck.card_count })}
          </p>
        )}

        {sessionMode === "complete_first" && inSecondPass && (
          <p className="text-xs text-yellow-400 mb-3">{t("flashcards.pass2")}</p>
        )}

        {done ? (
          <div className="text-center py-16">
            <p className="text-xl font-semibold mb-2">{t("flashcards.complete")}</p>
            <p className="text-gray-400 text-sm mb-4">{t("flashcards.completeSubtitle")}</p>
            {(sessionStats[0] + sessionStats[1] + sessionStats[2] + sessionStats[3]) > 0 && (
              <div className="flex justify-center gap-4 text-sm mb-6">
                {sessionStats[0] > 0 && <span className="text-red-400">{t("flashcards.quality.again")}: {sessionStats[0]}</span>}
                {sessionStats[1] > 0 && <span className="text-orange-400">{t("flashcards.quality.hard")}: {sessionStats[1]}</span>}
                {sessionStats[2] > 0 && <span className="text-green-400">{t("flashcards.quality.good")}: {sessionStats[2]}</span>}
                {sessionStats[3] > 0 && <span className="text-blue-400">{t("flashcards.quality.easy")}: {sessionStats[3]}</span>}
              </div>
            )}
            <button
              onClick={backToConfig}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              {t("common.back")}
            </button>
          </div>
        ) : (
          <div>
            {/* Session stats badge */}
            {(sessionStats[0] + sessionStats[1] + sessionStats[2] + sessionStats[3]) > 0 && (
              <div className="flex gap-3 text-xs mb-2">
                {sessionStats[0] > 0 && <span className="text-red-400">{t("flashcards.quality.again")}: {sessionStats[0]}</span>}
                {sessionStats[1] > 0 && <span className="text-orange-400">{t("flashcards.quality.hard")}: {sessionStats[1]}</span>}
                {sessionStats[2] > 0 && <span className="text-green-400">{t("flashcards.quality.good")}: {sessionStats[2]}</span>}
                {sessionStats[3] > 0 && <span className="text-blue-400">{t("flashcards.quality.easy")}: {sessionStats[3]}</span>}
              </div>
            )}

            <p className="text-sm text-gray-400 mb-4">
              {sessionQueue.length} {t("flashcards.remaining")}
              {current?.topic && (
                <span className="ml-2 text-blue-400">· {current.topic}</span>
              )}
            </p>

            {/* Card */}
            <div
              className="bg-gray-800 rounded-xl p-8 min-h-48 flex items-start justify-center cursor-pointer border border-gray-700 hover:border-gray-600 transition-colors relative"
              onClick={() => pendingAdvance === null && !editingCard && !deletingCard && setFlipped(!flipped)}
            >
              {/* Edit / Delete icons — visible only when flipped and not pending */}
              {flipped && pendingAdvance === null && (
                <div
                  className="absolute top-3 left-3 flex gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleEditOpen}
                    className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
                    title={t("flashcards.editCard")}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => setDeletingCard(true)}
                    className="p-1.5 text-gray-400 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-700"
                    title={t("flashcards.deleteCard")}
                  >
                    🗑️
                  </button>
                </div>
              )}

              <div className="w-full">
                {current && !flipped && (
                  <div className="flex items-center justify-center min-h-32">
                    <MarkdownContent content={current.front} />
                  </div>
                )}

                {current && flipped && (
                  <div className="w-full space-y-4">
                    {/* Question (dimmed) */}
                    <div className="opacity-60">
                      <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                        {t("flashcards.question")}
                      </p>
                      <MarkdownContent content={current.front} />
                    </div>
                    <hr className="border-gray-600" />
                    {/* Answer */}
                    <div>
                      <p className="text-xs uppercase tracking-wide text-blue-400 mb-2">
                        {t("flashcards.answer")}
                      </p>
                      <MarkdownContent content={current.back} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Next-review interval badge (shown after rating, before advancing) */}
            {lastInterval !== null && (
              <div className="mt-3 text-center">
                <span className="inline-block bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-full">
                  {t("flashcards.nextReview", { days: lastInterval })}
                </span>
              </div>
            )}

            {!flipped && pendingAdvance === null ? (
              <button
                onClick={() => setFlipped(true)}
                className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-lg text-sm transition-colors"
              >
                {t("flashcards.showAnswer")}
              </button>
            ) : pendingAdvance === null ? (
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[
                  { quality: 0, label: t("flashcards.quality.again"), color: "bg-red-700 hover:bg-red-600", interval: intervals?.again },
                  { quality: 1, label: t("flashcards.quality.hard"), color: "bg-orange-700 hover:bg-orange-600", interval: intervals?.hard },
                  { quality: 2, label: t("flashcards.quality.good"), color: "bg-green-700 hover:bg-green-600", interval: intervals?.good },
                  { quality: 3, label: t("flashcards.quality.easy"), color: "bg-blue-700 hover:bg-blue-600", interval: intervals?.easy },
                ].map(({ quality, label, color, interval }) => (
                  <button
                    key={quality}
                    onClick={() => handleReview(quality)}
                    className={`${color} text-white py-2.5 rounded-lg text-sm transition-colors flex flex-col items-center gap-0.5`}
                  >
                    <span>{label}</span>
                    {interval && (
                      <span className="text-xs opacity-70 font-normal">{interval}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* ── Edit Card Modal ── */}
        {editingCard && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg mx-4 space-y-4 shadow-xl">
              <h3 className="text-white font-semibold text-base">{t("flashcards.editCard")}</h3>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t("flashcards.cardFront")}</label>
                <textarea
                  value={editFront}
                  onChange={(e) => setEditFront(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t("flashcards.cardBack")}</label>
                <textarea
                  value={editBack}
                  onChange={(e) => setEditBack(e.target.value)}
                  rows={5}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditingCard(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors rounded-lg"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={editSaving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
                >
                  {t("flashcards.saveCard")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete Card Confirm Modal ── */}
        {deletingCard && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 space-y-4 shadow-xl">
              <p className="text-white">{t("flashcards.deleteConfirm")}</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeletingCard(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors rounded-lg"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleDeleteCard}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors"
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Config mode ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Recommendations */}
      {courseId && (
        <RecommendationsPanel
          courseId={courseId}
          onTopicSelect={(topic) => setGenTopic(topic)}
        />
      )}

      {/* Generate config card */}
      <div className="bg-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold">{t("flashcards.config.generateTitle")}</h2>

        {/* Count presets */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.config.count")}</p>
          <div className="flex gap-2 mb-2">
            {(["short", "medium", "long"] as CountPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSetPreset(preset)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  countPreset === preset
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {t(`flashcards.${preset}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{t("flashcards.exactCount")}:</span>
            <input
              type="number"
              min={20}
              max={150}
              value={genCount}
              onChange={(e) => handleCountInput(Number(e.target.value))}
              className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 text-center"
            />
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.difficulty")}</p>
          <div className="flex gap-2">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setGenDifficulty(d)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  genDifficulty === d
                    ? d === "easy"
                      ? "bg-green-700 text-white"
                      : d === "hard"
                      ? "bg-red-700 text-white"
                      : "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {t(`flashcards.${d}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Card types */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.config.cardType")}</p>
          <div className="flex flex-wrap gap-2">
            {ALL_CARD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleCardType(type)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  genCardTypes.has(type)
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {t(`flashcards.config.${type}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Topic */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("flashcards.config.topic")}</label>
          <input
            type="text"
            value={genTopic}
            onChange={(e) => setGenTopic(e.target.value)}
            placeholder={t("flashcards.config.topicPlaceholder")}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-gray-600"
          />
        </div>

        {/* Guidance */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("flashcards.config.guidance")}</label>
          <input
            type="text"
            value={genGuidance}
            onChange={(e) => setGenGuidance(e.target.value)}
            placeholder={t("flashcards.config.guidancePlaceholder")}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-gray-600"
          />
        </div>

        {genError && <p className="text-red-400 text-sm">{genError}</p>}

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {generating ? t("flashcards.config.generate") : t("flashcards.config.generate")}
        </button>

        {generating && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 text-center">
              {t("flashcards.generatingPct", { pct: genPct })}
            </p>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${genPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Deck History */}
      <div>
        <h2 className="text-base font-semibold mb-3">{t("flashcards.deckHistory")}</h2>
        {loadingDecks ? (
          <p className="text-sm text-gray-500">{t("common.loading")}</p>
        ) : decks.length === 0 ? (
          <p className="text-sm text-gray-500">{t("flashcards.empty")}</p>
        ) : (
          <div className="space-y-2">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="bg-gray-800 rounded-xl px-4 py-3 border border-gray-700 flex items-center gap-3 hover:border-gray-600 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  {renamingId === deck.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSave(deck.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSave(deck.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="bg-gray-700 text-white text-sm rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-blue-400 w-full"
                    />
                  ) : (
                    <p className="text-white text-sm font-medium truncate">{deck.name}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-gray-500">
                    <span>{t("flashcards.deckCards", { n: deck.card_count })}</span>
                    {deck.topic && <span>· {deck.topic}</span>}
                    <span>·</span>
                    <span
                      className={
                        deck.difficulty === "easy"
                          ? "text-green-500"
                          : deck.difficulty === "hard"
                          ? "text-red-400"
                          : "text-blue-400"
                      }
                    >
                      {t(`flashcards.${deck.difficulty}`)}
                    </span>
                    <span>· {new Date(deck.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleStartDeck(deck)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg font-medium transition-colors"
                  >
                    {t("flashcards.startDeck")}
                  </button>
                  <button
                    onClick={() => handleRenameStart(deck)}
                    className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
                    title={t("flashcards.renameDeck")}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDeleteDeck(deck.id)}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-700"
                    title={t("flashcards.deleteDeck")}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
