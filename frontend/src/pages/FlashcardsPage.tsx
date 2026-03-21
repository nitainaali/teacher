import { useEffect, useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import {
  getDecks,
  generateFlashcards,
  updateFlashcard,
  deleteFlashcard,
  renameDeck,
  deleteDeck,
  resetDeck,
  getDeckCards,
  createSession,
  getNextCard,
  sessionReviewCard,
  endSession,
} from "../api/flashcards";
import type { FlashcardDeck, SessionType } from "../api/flashcards";
import { MarkdownContent } from "../components/MarkdownContent";
import { RecommendationsPanel } from "../components/RecommendationsPanel";
import type { Flashcard, StudyMode, SessionStats } from "../types";
import { useGeneration, STORAGE_KEY } from "../context/GenerationContext";
import { predictIntervals } from "../utils/fsrsPredict";

type Mode = "config" | "mode_select" | "review";
type CountPreset = "short" | "medium" | "long";
type Difficulty = "easy" | "medium" | "hard";

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

// Mode options for the mode select screen
const STUDY_MODES: { mode: StudyMode; icon: string; titleKey: string; descKey: string; recommended?: boolean }[] = [
  { mode: "HYBRID", icon: "⚖️", titleKey: "flashcards.modeHybrid", descKey: "flashcards.modeHybridDesc", recommended: true },
  { mode: "ANKI_LIKE", icon: "🔁", titleKey: "flashcards.modeAnkiLike", descKey: "flashcards.modeAnkiLikeDesc" },
  { mode: "COVERAGE_FIRST", icon: "📋", titleKey: "flashcards.modeCoverage", descKey: "flashcards.modeCoverageDesc" },
];

export function FlashcardsPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  const [mode, setMode] = useState<Mode>("config");
  const [activeDeck, setActiveDeck] = useState<FlashcardDeck | null>(null);

  // ── Session state (backend-driven) ────────────────────────────────────────
  const [selectedMode, setSelectedMode] = useState<StudyMode>("HYBRID");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentCard, setCurrentCard] = useState<Flashcard | null>(null);
  const [cardsRemaining, setCardsRemaining] = useState(0);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    cards_seen_count: 0,
    new_cards_seen_count: 0,
    review_cards_seen_count: 0,
    failed_cards_count: 0,
  });
  const [sessionDone, setSessionDone] = useState(false);

  // ── Card review UX state ──────────────────────────────────────────────────
  const [flipped, setFlipped] = useState(false);
  const [lastNextReviewAt, setLastNextReviewAt] = useState<string | null>(null);
  // pendingAdvance: rating given, waiting 1.5s before fetching next card
  const [pendingAdvance, setPendingAdvance] = useState<number | null>(null);
  // Track when the card was shown (for response_time_ms)
  const cardFlipTimeRef = useRef<number | null>(null);

  // Helper: compute human-readable relative time from an ISO timestamp
  const formatTimeUntil = (isoDate: string | null): string => {
    if (!isoDate) return t("flashcards.nextReviewSoon");
    const diffMs = new Date(isoDate).getTime() - Date.now();
    const diffMin = Math.round(diffMs / 60000);
    const diffHour = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);
    if (diffMin <= 0) return t("flashcards.nextReviewSoon");
    if (diffMin < 60) return t("flashcards.inMinutes", { n: diffMin });
    if (diffHour < 24) return t("flashcards.inHours", { n: diffHour });
    return t("flashcards.inDays", { n: diffDays });
  };

  // ── One-time session state ────────────────────────────────────────────────
  const [isOneTimeSession, setIsOneTimeSession] = useState(false);
  const [showOneTimeOptions, setShowOneTimeOptions] = useState(false);

  // ── Anki-style deck card counters (new / learning / review) ──────────────
  const [deckCardStats, setDeckCardStats] = useState({ new: 0, learning: 0, review: 0 });

  // ── Reset deck confirmation dialog ────────────────────────────────────────
  const [resetConfirmDeck, setResetConfirmDeck] = useState<FlashcardDeck | null>(null);

  // ── Edit card modal state ─────────────────────────────────────────────────
  const [editingCard, setEditingCard] = useState(false);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [deletingCard, setDeletingCard] = useState(false);

  // ── Deck list ─────────────────────────────────────────────────────────────
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const fetchVersionRef = useRef(0);

  // ── Inline rename ─────────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Generation context ────────────────────────────────────────────────────
  const { isGenerating, courseId: genCourseId, startTime, genCount: ctxGenCount, startGeneration, endGeneration } = useGeneration();
  const generating = isGenerating && genCourseId === courseId;

  // ── Generation config ─────────────────────────────────────────────────────
  const [countPreset, setCountPreset] = useState<CountPreset>("medium");
  const [genCount, setGenCount] = useState(60);
  const [genDifficulty, setGenDifficulty] = useState<Difficulty>("medium");
  const [genCardTypes, setGenCardTypes] = useState<Set<CardType>>(new Set(ALL_CARD_TYPES));
  const [genTopic, setGenTopic] = useState("");
  const [genGuidance, setGenGuidance] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
  const [genPct, setGenPct] = useState(0);

  // Predicted intervals for current card (for rating button labels)
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

  // Generation progress bar
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
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [generating, startTime, ctxGenCount]);

  // Poll for new deck while generating
  useEffect(() => {
    if (!generating || !courseId) return;
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
      } catch { /* silently ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [generating, courseId]);

  // After 1.5s delay, fetch the next card from backend
  useEffect(() => {
    if (pendingAdvance === null || sessionId === null) return;
    const timer = setTimeout(async () => {
      try {
        const resp = await getNextCard(sessionId);
        setSessionStats(resp.session_stats);
        setCardsRemaining(resp.cards_remaining_estimate);
        if (resp.card === null) {
          setSessionDone(true);
          setCurrentCard(null);
          await endSession(sessionId).catch(() => {});
        } else {
          setCurrentCard(resp.card);
        }
      } catch { /* ignore */ }
      setPendingAdvance(null);
      setLastNextReviewAt(null);
      setFlipped(false);
      cardFlipTimeRef.current = null;
    }, 1500);
    return () => clearTimeout(timer);
  }, [pendingAdvance, sessionId]);

  // ── Generation helpers ────────────────────────────────────────────────────

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
      fetchDecks();
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

  // ── Session management ────────────────────────────────────────────────────

  const handleStartDeck = async (deck: FlashcardDeck) => {
    setActiveDeck(deck);
    setSessionId(null);
    setCurrentCard(null);
    setCardsRemaining(0);
    setSessionDone(false);
    setFlipped(false);
    setLastNextReviewAt(null);
    setPendingAdvance(null);
    setSelectedMode("HYBRID");
    setIsOneTimeSession(false);
    setShowOneTimeOptions(false);
    setDeckCardStats({ new: 0, learning: 0, review: 0 });
    setSessionStats({ cards_seen_count: 0, new_cards_seen_count: 0, review_cards_seen_count: 0, failed_cards_count: 0 });
    setMode("mode_select");
    // Fetch deck cards to compute Anki-style counters (blue/orange/green)
    try {
      const cards = await getDeckCards(deck.id);
      const today = new Date().toISOString().split("T")[0];
      setDeckCardStats({
        new: cards.filter(c => c.fsrs_state === "new").length,
        learning: cards.filter(c => c.fsrs_state === "learning").length,
        review: cards.filter(
          c => (c.fsrs_state === "review" || c.fsrs_state === "relearning") && c.next_review_date <= today
        ).length,
      });
    } catch { /* silently ignore */ }
  };

  const handleStartSession = async (sessionType: SessionType = "normal") => {
    if (!activeDeck || !courseId) return;
    try {
      const sess = await createSession(courseId, activeDeck.id, selectedMode, "NORMAL_STUDY", undefined, sessionType);
      setIsOneTimeSession(sessionType !== "normal");
      setSessionId(sess.id);
      // Fetch the first card
      const resp = await getNextCard(sess.id);
      setSessionStats(resp.session_stats);
      setCardsRemaining(resp.cards_remaining_estimate);
      if (resp.card === null) {
        setSessionDone(true);
        setCurrentCard(null);
        await endSession(sess.id).catch(() => {});
      } else {
        setCurrentCard(resp.card);
      }
      setFlipped(false);
      setMode("review");
    } catch { /* silently fail */ }
  };

  const handleReview = async (quality: number) => {
    if (!currentCard || !sessionId || pendingAdvance !== null) return;
    const responseMs = cardFlipTimeRef.current
      ? Date.now() - cardFlipTimeRef.current
      : undefined;
    try {
      const updated = await sessionReviewCard(sessionId, currentCard.id, quality, responseMs);
      setLastNextReviewAt(updated.next_review_at ?? null);
    } catch {
      setLastNextReviewAt(null); // overlay will show "Review soon"
    }
    setPendingAdvance(quality); // always advance, even on API error
  };

  // ── Edit / Delete card handlers ───────────────────────────────────────────

  const handleEditOpen = () => {
    if (!currentCard) return;
    setEditFront(currentCard.front);
    setEditBack(currentCard.back);
    setEditingCard(true);
  };

  const handleEditSave = async () => {
    if (!currentCard) return;
    setEditSaving(true);
    try {
      const updated = await updateFlashcard(currentCard.id, editFront, editBack);
      setCurrentCard(updated);
      setEditingCard(false);
    } catch { /* silently fail */ }
    finally { setEditSaving(false); }
  };

  const handleDeleteCard = async () => {
    if (!currentCard || !sessionId) return;
    try {
      await deleteFlashcard(currentCard.id);
      setDeletingCard(false);
      setFlipped(false);
      // Fetch next card without counting a review
      const resp = await getNextCard(sessionId);
      setSessionStats(resp.session_stats);
      setCardsRemaining(resp.cards_remaining_estimate);
      if (resp.card === null) {
        setSessionDone(true);
        setCurrentCard(null);
        await endSession(sessionId).catch(() => {});
      } else {
        setCurrentCard(resp.card);
      }
    } catch { /* silently fail */ }
  };

  // ── Rename / Delete deck handlers ─────────────────────────────────────────

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
      } catch { /* silently fail */ }
    }
    setRenamingId(null);
  };

  const handleDeleteDeck = async (deckId: string) => {
    try {
      await deleteDeck(deckId);
      setDecks((prev) => prev.filter((d) => d.id !== deckId));
    } catch { /* silently fail */ }
  };

  const handleResetDeck = async (deck: FlashcardDeck) => {
    try {
      await resetDeck(deck.id);
      setResetConfirmDeck(null);
      fetchDecks();
    } catch { /* silently fail */ }
  };

  const backToConfig = () => {
    setMode("config");
    setActiveDeck(null);
    setSessionId(null);
    setCurrentCard(null);
    setCardsRemaining(0);
    setSessionDone(false);
    setFlipped(false);
    setLastNextReviewAt(null);
    setPendingAdvance(null);
    setIsOneTimeSession(false);
    setSessionStats({ cards_seen_count: 0, new_cards_seen_count: 0, review_cards_seen_count: 0, failed_cards_count: 0 });
  };

  // ── Mode select screen ────────────────────────────────────────────────────

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

        {/* Mode selection */}
        <div className="space-y-2 mb-6">
          {STUDY_MODES.map(({ mode: m, icon, titleKey, descKey, recommended }) => (
            <button
              key={m}
              onClick={() => setSelectedMode(m)}
              className={`w-full text-left rounded-xl px-5 py-4 transition-colors border group ${
                selectedMode === m
                  ? "bg-blue-900/40 border-blue-500"
                  : "bg-gray-800 hover:bg-gray-700 border-gray-700 hover:border-gray-600"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`font-medium transition-colors ${selectedMode === m ? "text-blue-300" : "text-white group-hover:text-blue-300"}`}>
                      {t(titleKey)}
                    </p>
                    {recommended && (
                      <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded-full border border-blue-700/50">
                        {t("flashcards.recommended")}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mt-0.5">{t(descKey)}</p>
                </div>
                {selectedMode === m && (
                  <span className="text-blue-400 text-lg shrink-0">✓</span>
                )}
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => handleStartSession("normal")}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition-colors"
        >
          {t("common.start")}
        </button>

        {/* One-time session (dry-run) — collapsible */}
        <div className="mt-4 pt-4 border-t border-gray-700">
          <button
            onClick={() => setShowOneTimeOptions(v => !v)}
            className="w-full py-2.5 px-4 bg-gray-700/60 hover:bg-gray-700 border border-amber-700/40 text-amber-400/80 hover:text-amber-300 text-sm rounded-lg transition-colors flex items-center justify-between"
          >
            <span>↻ {t("flashcards.oneTimeSession")}</span>
            <span className="text-xs opacity-60">{showOneTimeOptions ? "▲" : "▼"}</span>
          </button>
          {showOneTimeOptions && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => handleStartSession("one_time_all")}
                className="flex-1 py-2 px-3 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs rounded-lg border border-gray-600 transition-colors"
              >
                ↻ {t("flashcards.oneTimeAll")}
              </button>
              <button
                onClick={() => handleStartSession("one_time_learning")}
                className="flex-1 py-2 px-3 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs rounded-lg border border-gray-600 transition-colors"
              >
                ↻ {t("flashcards.onlyLearning")}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Review mode ───────────────────────────────────────────────────────────

  if (mode === "review") {
    const totalSeen = sessionStats.cards_seen_count;

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

        {/* One-time session banner */}
        {isOneTimeSession && (
          <div className="bg-yellow-900/40 border border-yellow-700/50 text-yellow-300 text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-2">
            <span>⚡</span>
            <span>{t("flashcards.oneTimeBanner")}</span>
          </div>
        )}

        {sessionDone ? (
          /* ── Session complete screen ── */
          <div className="text-center py-16">
            <p className="text-xl font-semibold mb-2">{t("flashcards.complete")}</p>
            <p className="text-gray-400 text-sm mb-4">{t("flashcards.completeSubtitle")}</p>
            {totalSeen > 0 && (
              <div className="flex justify-center gap-4 text-sm mb-6 flex-wrap">
                {sessionStats.new_cards_seen_count > 0 && (
                  <span className="text-blue-400">New: {sessionStats.new_cards_seen_count}</span>
                )}
                {sessionStats.review_cards_seen_count > 0 && (
                  <span className="text-green-400">Review: {sessionStats.review_cards_seen_count}</span>
                )}
                {sessionStats.failed_cards_count > 0 && (
                  <span className="text-red-400">{t("flashcards.quality.again")}: {sessionStats.failed_cards_count}</span>
                )}
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
            {/* Anki-style 3-category counters (blue=new, orange=learning, green=review) */}
            {(deckCardStats.new > 0 || deckCardStats.learning > 0 || deckCardStats.review > 0) && (
              <div className="flex gap-3 text-xs font-mono mb-2">
                <span className="text-blue-400">
                  {Math.max(0, deckCardStats.new - (sessionStats.new_cards_seen_count || 0))}
                </span>
                <span className="text-orange-400">{deckCardStats.learning}</span>
                <span className="text-green-400">
                  {Math.max(0, deckCardStats.review - (sessionStats.review_cards_seen_count || 0))}
                </span>
              </div>
            )}

            <p className="text-sm text-gray-400 mb-4">
              {isOneTimeSession
                ? t("flashcards.cardsReviewed", { seen: totalSeen, total: totalSeen + cardsRemaining })
                : t("flashcards.cardsRemaining", { n: cardsRemaining })}
              {currentCard?.topic && (
                <span className="ml-2 text-blue-400">· {currentCard.topic}</span>
              )}
            </p>

            {/* Card */}
            <div
              className="bg-gray-800 rounded-xl p-8 min-h-48 flex items-start justify-center cursor-pointer border border-gray-700 hover:border-gray-600 transition-colors relative"
              onClick={() => {
                if (pendingAdvance === null && !editingCard && !deletingCard) {
                  if (!flipped) {
                    cardFlipTimeRef.current = Date.now();
                    setFlipped(true);
                  }
                }
              }}
            >
              {/* Next-review overlay — shown after rating while waiting for next card */}
              {pendingAdvance !== null && (
                <div className="absolute inset-0 bg-gray-900/80 rounded-xl flex items-center justify-center z-10">
                  <div className="text-center">
                    <p className="text-4xl mb-3">
                      {lastNextReviewAt && (new Date(lastNextReviewAt).getTime() - Date.now()) < 3600000 ? "⏱" : "📅"}
                    </p>
                    <p className="text-white font-bold text-2xl">
                      {formatTimeUntil(lastNextReviewAt)}
                    </p>
                    <p className="text-gray-400 text-sm mt-1">{t("flashcards.nextReviewLabel")}</p>
                  </div>
                </div>
              )}
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
                {currentCard && !flipped && (
                  <div className="flex items-center justify-center min-h-32">
                    <MarkdownContent content={currentCard.front} />
                  </div>
                )}

                {currentCard && flipped && (
                  <div className="w-full space-y-4">
                    {/* Question (dimmed) */}
                    <div className="opacity-60">
                      <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                        {t("flashcards.question")}
                      </p>
                      <MarkdownContent content={currentCard.front} />
                    </div>
                    <hr className="border-gray-600" />
                    {/* Answer */}
                    <div>
                      <p className="text-xs uppercase tracking-wide text-blue-400 mb-2">
                        {t("flashcards.answer")}
                      </p>
                      <MarkdownContent content={currentCard.back} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!flipped && pendingAdvance === null ? (
              <button
                onClick={() => {
                  cardFlipTimeRef.current = Date.now();
                  setFlipped(true);
                }}
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
                    className={`${color} text-white py-3 rounded-lg transition-colors flex flex-col items-center gap-0.5`}
                  >
                    <span className="text-base font-bold leading-tight">{interval ?? "—"}</span>
                    <span className="text-xs opacity-80">{label}</span>
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

  // ── Config mode ───────────────────────────────────────────────────────────

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
          {t("flashcards.config.generate")}
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
                    onClick={() => setResetConfirmDeck(deck)}
                    className="p-1.5 text-gray-500 hover:text-yellow-400 transition-colors rounded-lg hover:bg-gray-700"
                    title={t("flashcards.resetCards")}
                  >
                    🔄
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

      {/* ── Reset Deck Confirm Modal ── */}
      {resetConfirmDeck && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 space-y-4 shadow-xl">
            <p className="text-white font-semibold text-sm">{t("flashcards.resetCards")}</p>
            <p className="text-gray-400 text-sm">{t("flashcards.resetCardsConfirm", { name: resetConfirmDeck.name })}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setResetConfirmDeck(null)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors rounded-lg"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => handleResetDeck(resetConfirmDeck)}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded-lg font-medium transition-colors"
              >
                {t("flashcards.resetCards")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
