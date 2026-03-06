import client from "./client";
import type { Recommendation } from "../types";

export const getRecommendations = (courseId: string, limit = 5) =>
  client
    .get<Recommendation[]>("/api/learning/recommendations", {
      params: { course_id: courseId, limit },
    })
    .then((r) => r.data)
    .catch(() => [] as Recommendation[]);
