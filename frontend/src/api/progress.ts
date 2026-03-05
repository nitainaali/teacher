import client from "./client";
import type { ProgressStats } from "../types";

export const getProgress = () =>
  client.get<ProgressStats>("/api/progress/").then((r) => r.data);

export const getTopicPerformance = () =>
  client
    .get<Array<{ topic: string; avg_score: number; event_count: number }>>("/api/progress/topics")
    .then((r) => r.data);
