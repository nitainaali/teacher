import client from "./client";
import type { Recommendation, TopicSummary } from "../types";

export const getRecommendations = (courseId: string, limit = 5) =>
  client
    .get<Recommendation[]>("/api/learning/recommendations", {
      params: { course_id: courseId, limit },
    })
    .then((r) => r.data)
    .catch(() => [] as Recommendation[]);

export const getTopicSummaries = (courseId: string, topic?: string) => {
  const params: Record<string, string> = { course_id: courseId };
  if (topic) params.topic = topic;
  return client.get<TopicSummary[]>("/api/learning/topic-summaries", { params }).then((r) => r.data);
};

export const deleteTopicSummary = (id: string) =>
  client.delete(`/api/learning/topic-summaries/${id}`);

export const dismissRecommendation = (courseId: string, topic: string) =>
  client.delete("/api/learning/recommendations", { params: { course_id: courseId, topic } });
