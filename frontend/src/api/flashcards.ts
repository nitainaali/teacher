import client from "./client";
import type { Flashcard } from "../types";

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

export const reviewFlashcard = (id: string, quality: number) =>
  client.post<Flashcard>(`/api/flashcards/${id}/review`, { quality }).then((r) => r.data);
