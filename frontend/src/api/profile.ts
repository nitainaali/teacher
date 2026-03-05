import client from "./client";
import type { StudentProfile } from "../types";

export const getProfile = () =>
  client.get<StudentProfile>("/api/profile/").then((r) => r.data);

export const upsertProfile = (data: Partial<StudentProfile>) =>
  client.put<StudentProfile>("/api/profile/", data).then((r) => r.data);
