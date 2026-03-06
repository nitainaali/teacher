import client from "./client";
import type { Flashcard } from "../types";

export const getFlashcards = (courseId?: string, dueOnly = false, topic?: string) => {
  const params: Record<string, string | boolean> = {};
  if (courseId) params.course_id = courseId;
  if (dueOnly) params.due_only = true;
  if (topic) params.topic = topic;
  return client.get<Flashcard[]>("/api/flashcards/", { params }).then((r) => r.data);
};

export const generateFlashcards = (
  documentId: string,
  courseId: string,
  count = 20,
  cardType = "mixed",
  topic?: string,
  guidance?: string,
) => {
  const params: Record<string, string | number> = {
    document_id: documentId,
    course_id: courseId,
    count,
    card_type: cardType,
  };
  if (topic) params.topic = topic;
  if (guidance) params.guidance = guidance;
  return client
    .post<Flashcard[]>("/api/flashcards/generate", null, { params })
    .then((r) => r.data);
};

export const reviewFlashcard = (id: string, quality: number) =>
  client.post<Flashcard>(`/api/flashcards/${id}/review`, { quality }).then((r) => r.data);
