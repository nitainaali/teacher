# AI Tutor App — CLAUDE.md

## Project Overview
Personal AI tutor web application for an electrical engineering student.
Single-user personal tool (no auth system needed).

## Tech Stack
- Frontend: React + TypeScript + Tailwind CSS + react-i18next
- Backend: Python FastAPI
- Database: PostgreSQL + pgvector
- AI: Anthropic Claude API (claude-sonnet-4-20250514)
- Deployment: Docker Compose (local) + Railway (cloud)

## Project Structure
/teacher
├── frontend/        # React app (Vite)
├── backend/         # FastAPI app
├── docker-compose.yml
├── railway.toml
└── .env.example

## Key Design Decisions
- Dark mode UI: bg-gray-900, text-white, blue-500 accent, sidebar nav
- i18n: Hebrew + English, react-i18next, RTL support for Hebrew, zero hardcoded strings
- Knowledge mode toggle throughout the app: "course materials only" (RAG) vs "general knowledge"
- All Claude calls include student profile + learning context from student_intelligence.py
- Topic extraction: after every interaction, Claude extracts the topic automatically

## Database — Key Tables
- courses: organizes all content
- documents + document_chunks: PDFs processed via Claude Vision, chunked + embedded
- learning_events: every interaction logged with topic, used to build student profile
- student_performance: per-topic strength/weakness tracking
- chat_sessions + chat_messages: full chat history
- flashcards: SM-2 spaced repetition fields
- quiz_sessions + quiz_questions: quizzes with MC + free text
- exam_uploads: reference exams + student submissions
- student_profile: field of study, institution, year, preferences
- exam_dates + planned_study_sessions: Phase 2 (scaffold only)

## Implementation Status

### Fully Implemented (Phase 1)
- Courses (create, list, detail)
- Document upload + Claude Vision processing + RAG embeddings
- Homework checker (image/PDF + knowledge mode toggle + structured feedback)
- Chat (streaming SSE, RAG, full history persistence)
- student_intelligence.py — unified learning context injected into all Claude calls
- i18n (Hebrew/English toggle in TopBar, RTL layout)

### Scaffolded (Phase 1 — UI exists, logic stubbed)
- Dashboard
- Flashcards (SM-2 algorithm ready, UI scaffold)
- Quizzes (generator + grader stubbed)
- Exams (upload + analysis stubbed)
- Transcripts (upload + summarize stubbed)
- Progress (charts scaffold)
- Settings (student profile form scaffold)

### Placeholder (Phase 2 — not implemented)
- Schedule + calendar integration (Google Calendar API)
- Study plan generator

## Important Rules
- Always update BOTH en.json and he.json when adding any UI string
- Always inject student_intelligence context into every Claude API call
- Always write to learning_events after every student interaction
- Always run topic extraction (extract_topic()) after writing to learning_events
- Streaming responses use SSE (EventSourceResponse) — same pattern as homework checker
- All new DB tables need an Alembic migration

## Running Locally
cp .env.example .env   # add ANTHROPIC_API_KEY
docker compose up --build
# Open http://localhost:3000
