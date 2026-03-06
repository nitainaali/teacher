import client from "./client";
import type { Flashcard } from "../types";

export const getFlashcards = (courseId?: string, dueOnly = false) => {
  const params: Record<string, string | boolean> = {};
  if (courseId) params.course_id = courseId;
  if (dueOnly) params.due_only = true;
  return client.get<Flashcard[]>("/api/flashcards/", { params }).then((r) => r.data);
};

export const generateFlashcards = (
  documentId: string,
  courseId: string,
  count = 10,
  cardType = "mixed"
) =>
  client
    .post<Flashcard[]>("/api/flashcards/generate", null, {
      params: { document_id: documentId, course_id: courseId, count, card_type: cardType },
    })
    .then((r) => r.data);

export const reviewFlashcard = (id: string, quality: number) =>
  client.post<Flashcard>(`/api/flashcards/${id}/review`, { quality }).then((r) => r.data);
