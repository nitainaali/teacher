import client from "./client";
import type { ExamUpload } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "";

export const uploadExam = (
  file: File,
  courseId: string,
  examType: "reference" | "student_submission" = "student_submission",
  referenceExamId?: string,
) => {
  const form = new FormData();
  form.append("file", file);
  form.append("course_id", courseId);
  form.append("exam_type", examType);
  if (referenceExamId) form.append("reference_exam_id", referenceExamId);
  return client.post<ExamUpload>("/api/exams/upload", form).then((r) => r.data);
};

export const listExams = (courseId?: string) => {
  const params = courseId ? { course_id: courseId } : {};
  return client.get<ExamUpload[]>("/api/exams/", { params }).then((r) => r.data);
};

export async function* streamExamAnalysis(
  examId: string,
  opts: {
    guidance?: string;
    studentExperience?: string;
    referenceExamId?: string;
  } = {},
): AsyncGenerator<string> {
  const form = new FormData();
  if (opts.guidance) form.append("guidance", opts.guidance);
  if (opts.studentExperience) form.append("student_experience", opts.studentExperience);
  if (opts.referenceExamId) form.append("reference_exam_id", opts.referenceExamId);

  const response = await fetch(`${API_BASE}/api/exams/${examId}/analyze`, {
    method: "POST",
    body: form,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Analysis failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        const chunk = line.slice(6);
        if (chunk === "[DONE]") return;
        if (chunk.startsWith("[ERROR:")) {
          throw new Error(chunk.slice(7, -1));
        }
        yield chunk;
      }
    }
  }
}
