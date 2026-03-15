import client from "./client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HomeworkSubmission {
  id: string;
  course_id: string | null;
  user_description: string | null;
  filenames: string[] | null;
  analysis_result: string;
  score_text: string | null;
  chat_messages: ChatMessage[] | null;
  created_at: string;
}

export const getHomeworkHistory = (courseId?: string) => {
  const params: Record<string, string> = {};
  if (courseId) params.course_id = courseId;
  return client
    .get<HomeworkSubmission[]>("/api/homework/history", { params })
    .then((r) => r.data);
};

export const getHomeworkSubmission = (id: string) =>
  client.get<HomeworkSubmission>(`/api/homework/history/${id}`).then((r) => r.data);

export const deleteHomeworkSubmission = (id: string) =>
  client.delete(`/api/homework/history/${id}`);

export const updateHomeworkChat = (id: string, chatMessages: ChatMessage[]) =>
  client
    .patch<HomeworkSubmission>(`/api/homework/history/${id}`, { chat_messages: chatMessages })
    .then((r) => r.data);
