# AI Tutor App — CLAUDE.md

## Project Overview

Personal AI tutor web application for an electrical engineering student.
Single-user personal tool (no auth system needed).

## Tech Stack

- Frontend: React + TypeScript + Tailwind CSS + react-i18next + KaTeX
- Backend: Python FastAPI
- Database: PostgreSQL + pgvector
- AI: Anthropic Claude API (claude-sonnet-4-20250514)
- Deployment: Docker Compose (local) + Railway (cloud)

## Project Structure

```
/teacher
├── frontend/        # React app (Vite)
├── backend/         # FastAPI app
├── docker-compose.yml
├── railway.toml
└── .env.example
```

## Key Design Decisions

- Dark mode UI: bg-gray-900, text-white, blue-500 accent, tab-based course layout
- i18n: Hebrew + English, react-i18next, RTL support for Hebrew, zero hardcoded strings
- Knowledge mode toggle throughout the app: "course materials only" (RAG) vs "general knowledge"
- All Claude calls include student profile + learning context from `student_intelligence.py`
- Teaching style: `teaching_style` (direct/balanced/supportive) + `style_notes` injected into every Claude call
- Topic extraction: after every interaction, Claude extracts the topic automatically
- Math rendering: KaTeX via react-markdown + remark-math + rehype-katex (MarkdownContent component)
- Spaced repetition: FSRS-4.5 algorithm (replaces SM-2)
- Study recommendations: urgency = exam-topic importance × (1 − student strength)

## Database — Key Tables

- `courses`: organizes all content
- `documents` + `document_chunks`: PDFs processed via Claude Vision, chunked + embedded
- `learning_events`: every interaction logged with topic + event_type, used to build student profile
  - event types include: `exam_topic` (from exam uploads), `quiz_result`, `flashcard_review`, etc.
- `student_performance`: per-topic strength/weakness tracking (populated after every interaction)
- `chat_sessions` + `chat_messages`: full chat history
- `flashcards`: FSRS fields — `stability`, `difficulty_fsrs`, `fsrs_state` + legacy SM-2 fields kept
- `quiz_sessions` + `quiz_questions`: quizzes with MC + free text
- `exam_uploads`: reference exams + student submissions (used for topic importance + analysis)
- `student_profile`: field of study, institution, year, preferences, `teaching_style`, `style_notes`
- `exam_dates` + `planned_study_sessions`: Phase 2 (scaffold only)

## Implementation Status

### Fully Implemented

- Courses (create, list, detail)
- Document upload + Claude Vision processing + RAG embeddings
- Document classification: summaries/lectures = raw material; exams = topic importance signal
- Homework checker (image/PDF + knowledge mode toggle + streaming structured feedback)
- Chat (streaming SSE, RAG, full history persistence, MarkdownContent rendering)
- Flashcards — FSRS-4.5 spaced repetition, 5 card types (comprehension, memorization, application, tricks, confusion), count slider 20–150, topic filter, guidance param
- Quizzes — generator + grader, multi-select question types (MC / free-text / mixed), difficulty, topic filter
- Exam analysis — full streaming implementation via Claude Vision, per-topic breakdown table, student experience input, reference exam comparison, weak topics logged to learning_events
- Topic summary (streaming, MarkdownContent, guidance param)
- Study recommendations engine — urgency = exam-topic importance × weakness, shown in Flashcards + Quizzes pages
- Exam document topic extraction — on upload, Claude Haiku extracts topics → logged as `exam_topic` events
- `student_intelligence.py` — unified learning context + teaching style injected into all Claude calls
- `BASE_SYSTEM_PROMPT` — accuracy rules: no fabrication, LaTeX for all math, source attribution
- Settings — student profile + teaching style selector (direct/balanced/supportive) + style_notes
- i18n (Hebrew/English toggle, RTL layout) — all strings in en.json + he.json

### Scaffolded (UI exists, logic partially stubbed)

- Progress / Diagnosis page (stats shown, charts scaffold)
- Transcripts (upload UI ready, summarize stubbed)

### Placeholder (Phase 2 — not implemented)

- Schedule + calendar integration (Google Calendar API)
- Study plan generator

## Important Rules

- Always update BOTH `en.json` and `he.json` when adding any UI string
- Always inject `student_intelligence` context into every Claude API call
- Always write to `learning_events` after every student interaction
- Always run `extract_topic_background()` after writing to `learning_events`
- Streaming responses use SSE (`EventSourceResponse`) — same pattern as homework checker / exam analysis
- All new DB tables need an Alembic migration
- Math: always use `$...$` (inline) or `$$...$$` (display) LaTeX — never plain text formulas
- `MarkdownContent` component must be used for all AI-generated text (chat, summaries, quiz feedback, exam analysis, homework)
- FSRS quality ratings: 0=Again, 1=Hard, 2=Good, 3=Easy (maps to FSRS grade 1–4 in backend)

## Key Services

| File | Purpose |
|------|---------|
| `services/student_intelligence.py` | Builds per-course learning context + teaching style for every Claude call |
| `services/fsrs.py` | FSRS-4.5 spaced repetition algorithm (17 default weights) |
| `services/recommendations.py` | Study recommendations: urgency = importance × weakness |
| `services/exam_analyzer.py` | Streaming Claude Vision exam analysis |
| `services/flashcard_generator.py` | Generates 5 card types with topic/guidance params |
| `services/document_processor.py` | Claude Vision PDF processing + exam topic extraction |
| `services/claude.py` | `BASE_SYSTEM_PROMPT` + shared Claude client |
| `components/MarkdownContent.tsx` | KaTeX + react-markdown renderer used everywhere |
| `components/RecommendationsPanel.tsx` | Urgency-color-coded topic recommendations widget |

## Running Locally

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY
docker compose up --build
# Open http://localhost:3000
```
