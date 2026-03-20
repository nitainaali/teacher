import client from "./client";
import type { Flashcard, StudyMode, StudyIntent, StudySession, NextCardResponse } from "../types";

export interface FlashcardDeck {
  id: string;
  course_id: string;
  name: string;
  topic: string | null;
  difficulty: string;
  card_count: number;
  created_at: string;
}

export const getFlashcards = (courseId?: string, dueOnly = false, topic?: string, deckId?: string) => {
  const params: Record<string, string | boolean> = {};
  if (courseId) params.course_id = courseId;
  if (dueOnly) params.due_only = true;
  if (topic) params.topic = topic;
  if (deckId) params.deck_id = deckId;
  return client.get<Flashcard[]>("/api/flashcards/", { params }).then((r) => r.data);
};

export const generateFlashcards = (
  courseId: string,
  count = 60,
  cardType = "mixed",
  difficulty = "medium",
  topic?: string,
  guidance?: string,
  language = "en",
) => {
  const params: Record<string, string | number> = {
    course_id: courseId,
    count,
    card_type: cardType,
    difficulty,
    language,
  };
  if (topic) params.topic = topic;
  if (guidance) params.guidance = guidance;
  return client
    .post<FlashcardDeck>("/api/flashcards/generate", null, { params })
    .then((r) => r.data);
};

export const getDecks = (courseId: string) =>
  client.get<FlashcardDeck[]>("/api/flashcards/decks", { params: { course_id: courseId } }).then((r) => r.data);

export const getDeckCards = (deckId: string) =>
  client.get<Flashcard[]>(`/api/flashcards/decks/${deckId}/cards`).then((r) => r.data);

export const renameDeck = (deckId: string, name: string) =>
  client.put<FlashcardDeck>(`/api/flashcards/decks/${deckId}`, { name }).then((r) => r.data);

export const deleteDeck = (deckId: string) =>
  client.delete(`/api/flashcards/decks/${deckId}`);

export const resetDeck = (deckId: string) =>
  client.post<{ status: string; deck_id: string }>(`/api/flashcards/decks/${deckId}/reset`).then((r) => r.data);

/** Legacy single-card review (no session tracking) */
export const reviewFlashcard = (id: string, quality: number) =>
  client.post<Flashcard>(`/api/flashcards/${id}/review`, { quality }).then((r) => r.data);

export const updateFlashcard = (id: string, front: string, back: string) =>
  client.put<Flashcard>(`/api/flashcards/${id}`, { front, back }).then((r) => r.data);

export const deleteFlashcard = (id: string) =>
  client.delete(`/api/flashcards/${id}`);

// ── Session API ───────────────────────────────────────────────────────────────

export type SessionType = "normal" | "one_time_all" | "one_time_learning";

export const createSession = (
  courseId: string,
  deckId: string | null,
  mode: StudyMode,
  intent: StudyIntent,
  topicFilter?: string,
  sessionType: SessionType = "normal",
) =>
  client
    .post<StudySession>("/api/flashcards/sessions", {
      course_id: courseId,
      deck_id: deckId,
      topic_filter: topicFilter ?? null,
      mode,
      intent,
      session_type: sessionType,
    })
    .then((r) => r.data);

export const getNextCard = (sessionId: string) =>
  client.get<NextCardResponse>(`/api/flashcards/sessions/${sessionId}/next`).then((r) => r.data);

export const sessionReviewCard = (
  sessionId: string,
  cardId: string,
  quality: number,
  responseTimeMs?: number,
) =>
  client
    .post<Flashcard>(`/api/flashcards/sessions/${sessionId}/review`, {
      card_id: cardId,
      quality,
      response_time_ms: responseTimeMs ?? null,
    })
    .then((r) => r.data);

export const endSession = (sessionId: string) =>
  client.post<StudySession>(`/api/flashcards/sessions/${sessionId}/end`).then((r) => r.data);
