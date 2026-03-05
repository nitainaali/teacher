import client from "./client";
import type { Course } from "../types";

export const getCourses = () => client.get<Course[]>("/api/courses/").then((r) => r.data);

export const createCourse = (data: { name: string; description?: string; color?: string }) =>
  client.post<Course>("/api/courses/", data).then((r) => r.data);

export const updateCourse = (id: string, data: Partial<{ name: string; description: string; color: string }>) =>
  client.put<Course>(`/api/courses/${id}`, data).then((r) => r.data);

export const deleteCourse = (id: string) => client.delete(`/api/courses/${id}`);

export const getCourse = (id: string) => client.get<Course>(`/api/courses/${id}`).then((r) => r.data);
