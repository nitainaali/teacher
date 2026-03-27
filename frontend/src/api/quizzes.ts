import client from "./client";
import type { QuizSession, QuizSessionDetail } from "../types";

export const getQuizzes = (courseId?: string) => {
  const params = courseId ? { course_id: courseId } : {};
  return client.get<QuizSession[]>("/api/quizzes/", { params }).then((r) => r.data);
};

export const generateQuiz = (data: {
  course_id: string;
  topic?: string;
  count?: number;
  knowledge_mode?: string;
  mode?: string;
  difficulty?: string;
  question_type?: string;
  language?: string;
}) => client.post<QuizSession>("/api/quizzes/generate", data).then((r) => r.data);

export const getQuiz = (id: string) =>
  client.get<QuizSessionDetail>(`/api/quizzes/${id}`).then((r) => r.data);

export const submitQuiz = (id: string, answers: Array<{ question_id: string; answer: string }>) =>
  client.post<QuizSessionDetail>(`/api/quizzes/${id}/submit`, { answers }).then((r) => r.data);

export const updateQuiz = (id: string, data: { topic?: string; difficulty?: string }) =>
  client.patch<QuizSession>(`/api/quizzes/${id}`, data).then((r) => r.data);

export const resetQuiz = (id: string) =>
  client.post<QuizSession>(`/api/quizzes/${id}/reset`).then((r) => r.data);

export const deleteQuiz = (id: string) => client.delete(`/api/quizzes/${id}`);
