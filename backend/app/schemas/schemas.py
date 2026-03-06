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
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Documents ────────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    id: str
    course_id: str
    filename: str
    original_name: str
    doc_type: str
    processing_status: str
    extracted_text: Optional[str]
    created_at: datetime
    metadata_: Optional[dict] = None

    model_config = {"from_attributes": True}


# ── Homework ─────────────────────────────────────────────────────────────────

class HomeworkCheckRequest(BaseModel):
    course_id: Optional[str] = None
    knowledge_mode: str = "general"  # course_only | general


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
    front: str
    back: str
    topic: Optional[str]
    ease_factor: float
    interval_days: int
    repetitions: int
    next_review_date: date
    last_reviewed_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class FlashcardReviewRequest(BaseModel):
    quality: int  # 0-5 SM-2 quality


# ── Quizzes ───────────────────────────────────────────────────────────────────

class QuizGenerateRequest(BaseModel):
    course_id: str
    topic: Optional[str] = None
    count: int = 5
    knowledge_mode: str = "general"
    mode: str = "practice"
    difficulty: str = "medium"  # easy | medium | hard
    question_type: str = "mixed"  # multiple_choice | free_text | mixed


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

    model_config = {"from_attributes": True}


class QuizSessionDetail(QuizSessionOut):
    questions: List[QuizQuestionOut]


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


# ── Student Profile ───────────────────────────────────────────────────────────

class StudentProfileUpsert(BaseModel):
    field_of_study: Optional[str] = None
    institution: Optional[str] = None
    year_of_study: Optional[int] = None
    preferences: Optional[dict] = None


class StudentProfileOut(BaseModel):
    id: str
    field_of_study: Optional[str]
    institution: Optional[str]
    year_of_study: Optional[int]
    preferences: Optional[dict]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatMessageRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    course_id: Optional[str] = None
    knowledge_mode: str = "general"


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
