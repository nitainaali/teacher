from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime, date


# ── Courses ──────────────────────────────────────────────────────────────────

class CourseCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#3b82f6"


class CourseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


class CourseOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    color: Optional[str]
    sort_order: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class CourseReorderRequest(BaseModel):
    ids: List[str]  # ordered list of course IDs


# ── Documents ────────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    id: str
    course_id: str
    filename: str
    original_name: str
    doc_type: str
    processing_status: str
    extracted_text: Optional[str]
    upload_source: str = "knowledge"
    created_at: datetime
    metadata_: Optional[dict] = None

    model_config = {"from_attributes": True}


# ── Homework ─────────────────────────────────────────────────────────────────

class HomeworkCheckRequest(BaseModel):
    course_id: Optional[str] = None
    knowledge_mode: str = "general"  # course_only | general
    language: str = "en"


class HomeworkError(BaseModel):
    step: str
    description: str
    correction: str


class HomeworkFeedback(BaseModel):
    overall_correct: bool
    final_answer_correct: bool
    score_estimate: str
    errors: List[HomeworkError]
    strengths: List[str]
    suggestions: List[str]


# ── Flashcards ────────────────────────────────────────────────────────────────

class FlashcardOut(BaseModel):
    id: str
    course_id: str
    source_document_id: Optional[str]
    deck_id: Optional[str] = None
    front: str
    back: str
    topic: Optional[str]
    ease_factor: float
    interval_days: int
    repetitions: int
    next_review_date: date
    last_reviewed_at: Optional[datetime]
    stability: float = 0.0
    difficulty_fsrs: float = 0.3
    fsrs_state: str = "new"
    created_at: datetime

    model_config = {"from_attributes": True}


class FlashcardReviewRequest(BaseModel):
    quality: int  # 0=Again, 1=Hard, 2=Good, 3=Easy


class FlashcardDeckOut(BaseModel):
    id: str
    course_id: str
    name: str
    topic: Optional[str]
    difficulty: str
    card_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class FlashcardDeckRename(BaseModel):
    name: str


# ── Quizzes ───────────────────────────────────────────────────────────────────

class QuizGenerateRequest(BaseModel):
    course_id: str
    topic: Optional[str] = None
    count: int = 5
    knowledge_mode: str = "general"
    mode: str = "practice"
    difficulty: str = "medium"  # easy | medium | hard
    question_type: str = "mixed"  # multiple_choice | free_text | mixed
    language: str = "en"


class QuizQuestionOut(BaseModel):
    id: str
    question_text: str
    question_type: str
    options: Optional[List[Any]]
    correct_answer: Optional[str] = None  # hidden until submitted
    student_answer: Optional[str]
    ai_feedback: Optional[str]
    points_possible: float
    points_earned: Optional[float]
    topic: Optional[str]

    model_config = {"from_attributes": True}


class QuizSessionOut(BaseModel):
    id: str
    course_id: str
    mode: str
    knowledge_mode: str
    created_at: datetime
    completed_at: Optional[datetime]
    score: Optional[float]
    total_questions: int
    topic: Optional[str] = None
    difficulty: Optional[str] = None

    model_config = {"from_attributes": True}


class QuizSessionDetail(QuizSessionOut):
    questions: List[QuizQuestionOut]


class QuizSessionUpdate(BaseModel):
    topic: Optional[str] = None
    difficulty: Optional[str] = None


class QuizSubmitRequest(BaseModel):
    answers: List[dict]  # [{question_id, answer}]


# ── Exams ─────────────────────────────────────────────────────────────────────

class ExamUploadOut(BaseModel):
    id: str
    course_id: str
    document_id: str
    exam_type: str
    reference_exam_id: Optional[str]
    analysis: Optional[dict]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Progress ──────────────────────────────────────────────────────────────────

class ProgressStats(BaseModel):
    total_documents: int
    total_flashcards: int
    due_flashcards: int
    total_quizzes: int
    average_quiz_score: Optional[float]


class TopicPerformance(BaseModel):
    topic: str
    avg_score: float
    event_count: int


# ── Diagnosis ─────────────────────────────────────────────────────────────────

class DiagnosisStats(BaseModel):
    flashcards_studied: int
    quizzes_completed: int
    homework_submitted: int
    exams_submitted: int


class TopicKnowledge(BaseModel):
    topic: str
    knowledge_level: Optional[float]  # 0.0–1.0, None if insufficient data
    has_sufficient_data: bool
    total_interactions: int


class ExamTopicWeight(BaseModel):
    topic: str
    exam_count: int
    weight: float  # 0.0–1.0 normalized


class DiagnosisData(BaseModel):
    stats: DiagnosisStats
    topics: List[TopicKnowledge]
    exam_topics: Optional[List[ExamTopicWeight]]
    exam_doc_count: int


class RecommendationExplanationRequest(BaseModel):
    course_id: str
    topic: str
    strength: float
    importance: float
    urgency_level: str
    language: str = "en"


# ── Student Profile ───────────────────────────────────────────────────────────

class StudentProfileUpsert(BaseModel):
    field_of_study: Optional[str] = None
    institution: Optional[str] = None
    year_of_study: Optional[int] = None
    preferences: Optional[dict] = None
    teaching_style: Optional[str] = None  # direct|balanced|supportive
    style_notes: Optional[str] = None


class StudentProfileOut(BaseModel):
    id: str
    field_of_study: Optional[str]
    institution: Optional[str]
    year_of_study: Optional[int]
    preferences: Optional[dict]
    teaching_style: str = "balanced"
    style_notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatMessageRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    course_id: Optional[str] = None
    knowledge_mode: str = "general"
    language: str = "en"
    source: Optional[str] = None  # "homework_chat" → uses separate event_type
    images: Optional[List[str]] = None  # base64-encoded images (homework chat first message)


class TopicSummaryRequest(BaseModel):
    course_id: str
    topic: str
    guidance: Optional[str] = None
    language: str = "en"


class TopicSummaryOut(BaseModel):
    id: str
    course_id: str
    topic: str
    content: str
    guidance: Optional[str]
    language: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionOut(BaseModel):
    id: str
    course_id: Optional[str]
    knowledge_mode: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionWithFirstMessage(ChatSessionOut):
    first_message: Optional[str] = None


# ── Homework History ───────────────────────────────────────────────────────────

class HomeworkSubmissionOut(BaseModel):
    id: str
    course_id: Optional[str]
    user_description: Optional[str]
    filenames: Optional[List[Any]]
    analysis_result: str
    score_text: Optional[str]
    chat_messages: Optional[List[Any]] = None
    images_b64: Optional[List[str]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Exam Analysis History ──────────────────────────────────────────────────────

class ExamAnalysisRecordOut(BaseModel):
    id: str
    course_id: Optional[str]
    reference_exam_name: Optional[str]
    student_exam_name: Optional[str]
    analysis_result: str
    created_at: datetime

    model_config = {"from_attributes": True}
