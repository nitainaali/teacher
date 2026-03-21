import client from "./client";

export interface SharedCourse {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
}

export interface SharedDocument {
  id: string;
  shared_course_id: string;
  filename: string;
  original_name: string;
  doc_type: string;
  processing_status: "pending" | "processing" | "done" | "error";
  created_at: string;
  metadata_: Record<string, unknown> | null;
}

export async function getSharedCourses(): Promise<SharedCourse[]> {
  const res = await client.get<SharedCourse[]>("/api/shared-knowledge/courses");
  return res.data;
}

export async function createSharedCourse(data: {
  name: string;
  description?: string;
  color?: string;
}): Promise<SharedCourse> {
  const res = await client.post<SharedCourse>("/api/shared-knowledge/courses", data);
  return res.data;
}

export async function deleteSharedCourse(courseId: string): Promise<void> {
  await client.delete(`/api/shared-knowledge/courses/${courseId}`);
}

export async function getSharedDocuments(courseId: string): Promise<SharedDocument[]> {
  const res = await client.get<SharedDocument[]>(
    `/api/shared-knowledge/courses/${courseId}/documents`
  );
  return res.data;
}

export async function uploadToSharedCourse(courseId: string, file: File): Promise<SharedDocument> {
  const form = new FormData();
  form.append("file", file);
  const res = await client.post<SharedDocument>(
    `/api/shared-knowledge/courses/${courseId}/documents`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return res.data;
}

export async function deleteSharedDocument(courseId: string, docId: string): Promise<void> {
  await client.delete(`/api/shared-knowledge/courses/${courseId}/documents/${docId}`);
}

export async function copyDocumentToSharedCourse(sharedCourseId: string, documentId: string): Promise<SharedDocument> {
  const res = await client.post<SharedDocument>(
    `/api/shared-knowledge/courses/${sharedCourseId}/copy-from-document`,
    { document_id: documentId }
  );
  return res.data;
}
