export interface Course {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
  active_shared_course_ids: string[];
}

export interface Document {
  id: string;
  course_id: string;
  filename: string;
  original_name: string;
  doc_type: string;
  processing_status: "pending" | "processing" | "done" | "error";
  extracted_text: string | null;
  upload_source: string;
  created_at: string;
  metadata_: Record<string, unknown> | null;
}

export interface Flashcard {
  id: string;
  course_id: string;
  source_document_id: string | null;
  front: string;
  back: string;
  topic: string | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_date: string;
  last_reviewed_at: string | null;
  stability: number;
  difficulty_fsrs: number;
  fsrs_state: string;
  learning_step: number | null;
  next_review_at: string | null;
  // SRS session engine fields
  review_count: number;
  lapse_count: number;
  retrievability_estimate: number;
  last_rating: number | null;
  first_seen_at: string | null;
  created_at: string;
}

export type StudyMode = "ANKI_LIKE" | "COVERAGE_FIRST" | "HYBRID";
export type StudyIntent = "QUICK_REFRESH" | "NORMAL_STUDY" | "DEEP_MEMORIZATION";

export interface StudySession {
  id: string;
  course_id: string;
  deck_id: string | null;
  topic_filter: string | null;
  mode: StudyMode;
  intent: StudyIntent;
  started_at: string;
  ended_at: string | null;
  target_duration_minutes: number;
  cards_seen_count: number;
  new_cards_seen_count: number;
  review_cards_seen_count: number;
  failed_cards_count: number;
}

export interface SessionStats {
  cards_seen_count: number;
  new_cards_seen_count: number;
  review_cards_seen_count: number;
  failed_cards_count: number;
}

export interface NextCardResponse {
  card: Flashcard | null;
  cards_remaining_estimate: number;
  session_stats: SessionStats;
}

export interface QuizSession {
  id: string;
  course_id: string;
  mode: string;
  knowledge_mode: string;
  created_at: string;
  completed_at: string | null;
  score: number | null;
  total_questions: number;
  topic: string | null;
  difficulty: string | null;
}

export interface QuizQuestion {
  id: string;
  question_text: string;
  question_type: "multiple_choice" | "free_text";
  options: Array<{ label: string; value: string }> | null;
  correct_answer: string | null;
  student_answer: string | null;
  ai_feedback: string | null;
  points_possible: number;
  points_earned: number | null;
  topic: string | null;
}

export interface QuizSessionDetail extends QuizSession {
  questions: QuizQuestion[];
}

export interface ChatSession {
  id: string;
  course_id: string | null;
  knowledge_mode: string;
  created_at: string;
  updated_at: string;
  first_message?: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface StudentProfile {
  id: string;
  field_of_study: string | null;
  institution: string | null;
  year_of_study: number | null;
  preferences: Record<string, unknown> | null;
  teaching_style: string;
  style_notes: string | null;
  created_at: string;
}

export interface ProgressStats {
  total_documents: number;
  total_flashcards: number;
  due_flashcards: number;
  total_quizzes: number;
  average_quiz_score: number | null;
}

export interface ExamUpload {
  id: string;
  course_id: string;
  document_id: string;
  exam_type: string;
  reference_exam_id: string | null;
  analysis: Record<string, unknown> | null;
  created_at: string;
}

export interface HomeworkFeedback {
  overall_correct: boolean;
  final_answer_correct: boolean;
  score_estimate: string;
  errors: Array<{ step: string; description: string; correction: string }>;
  strengths: string[];
  suggestions: string[];
}

export interface Recommendation {
  topic: string;
  urgency: number;
  urgency_level: "high" | "medium" | "low";
  reason: string;
  strength: number;
  importance: number;
}

export interface DiagnosisStats {
  flashcards_studied: number;
  quizzes_completed: number;
  homework_submitted: number;
  exams_submitted: number;
}

export interface TopicKnowledge {
  topic: string;
  knowledge_level: number | null;
  has_sufficient_data: boolean;
  total_interactions: number;
}

export interface ExamTopicWeight {
  topic: string;
  exam_count: number;
  weight: number;
}

export interface DiagnosisData {
  stats: DiagnosisStats;
  topics: TopicKnowledge[];
  exam_topics: ExamTopicWeight[] | null;
  exam_doc_count: number;
}

export interface TopicSummary {
  id: string;
  course_id: string;
  topic: string;
  content: string;
  guidance: string | null;
  language: string;
  created_at: string;
}
