import client from "./client";

export interface UnifiedHistoryItem {
  id: string;
  type: "general" | "homework" | "exam";
  title: string;
  created_at: string;
  metadata_?: {
    score_text?: string;
    chat_round_count?: number;
    reference_exam_name?: string;
    knowledge_mode?: string;
  } | null;
}

export const getUnifiedHistory = (courseId?: string, type?: string) => {
  const params: Record<string, string> = {};
  if (courseId) params.course_id = courseId;
  if (type && type !== "all") params.type = type;
  return client
    .get<UnifiedHistoryItem[]>("/api/unified/history", { params })
    .then((r) => r.data);
};

export const deleteUnifiedItem = (type: "general" | "homework" | "exam", id: string) => {
  if (type === "general") return client.delete(`/api/chat/sessions/${id}`);
  if (type === "homework") return client.delete(`/api/homework/history/${id}`);
  if (type === "exam") return client.delete(`/api/exams/analyses/${id}`);
  throw new Error("Unknown type");
};
