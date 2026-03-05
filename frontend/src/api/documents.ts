import client from "./client";
import type { Document } from "../types";

export const getDocuments = (courseId?: string) => {
  const params = courseId ? { course_id: courseId } : {};
  return client.get<Document[]>("/api/documents/", { params }).then((r) => r.data);
};

export const getDocument = (id: string) =>
  client.get<Document>(`/api/documents/${id}`).then((r) => r.data);

export const uploadDocument = (file: File, courseId: string, docType: string) => {
  const form = new FormData();
  form.append("file", file);
  form.append("course_id", courseId);
  form.append("doc_type", docType);
  return client.post<Document>("/api/documents/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};

export const deleteDocument = (id: string) => client.delete(`/api/documents/${id}`);
