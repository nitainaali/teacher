# AI Tutor App — CLAUDE.md

## Project Overview

Personal AI tutor web application for an electrical engineering student.
Multi-user with login (username only, no password). Single admin user can manage all users.

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
- **Output language**: every Claude call receives a `language` param ("en"/"he") injected into the system prompt as an explicit language instruction — AI always replies in the UI language
- **SSE buffer parser**: all frontend SSE readers use `buffer += decode(); lines = buffer.split("\n"); buffer = lines.pop()` to handle TCP-chunked events correctly
- **SSE corruption fix**: topic summary fetches final content from DB after stream ends (SSE chunks with embedded `\n` corrupt accumulated strings — DB is authoritative)
- **RTL/LTR**: `MarkdownContent` uses `dir="auto"` on all text elements so Hebrew paragraphs are RTL and English paragraphs are LTR within the same document
- **Embedding model**: `paraphrase-multilingual-MiniLM-L12-v2` (384-dim, 50+ languages, supports Hebrew+English)
- **scan_quality**: computed on every document upload — "good" (has Hebrew), "partial" (no Hebrew but >30 words), "poor" (≤30 words) — stored in `documents.metadata`
- **Multi-user auth**: username-only login; `X-User-Id` header set on every axios request via `setCurrentUserId()`; `get_current_user` / `get_admin_user` FastAPI deps read the header
- **User deletion cascade**: all FK columns referencing `users.id` use `ondelete="CASCADE"` at DB level; `User.courses` and `User.profile` relationships have `passive_deletes=True` so `db.delete(user)` lets the DB cascade without ORM interference
- **Document user-scoping**: `GET /api/documents/` always JOINs with `Course` and filters `Course.user_id == current_user.id` — prevents cross-user document leakage even if `course_id` param is missing
- **First-course flow**: new users see a "name your first course" screen after signup before entering the app — prevents the courseless empty state
- **HelpTooltip**: `components/HelpTooltip.tsx` renders tooltip via `createPortal` into `document.body` with `position:fixed` + `getBoundingClientRect()` — avoids clipping by sidebar `overflow-y:auto`

## Database — Key Tables

- `users`: username, is_admin flag; all other tables have `user_id` FK with `ondelete="CASCADE"`
- `courses`: organizes all content; `user_id` FK → user-scoped
- `documents` + `document_chunks`: PDFs processed via Claude Vision, chunked + embedded
  - `documents.metadata` JSONB: `{"scan_quality": "good"|"partial"|"poor", "word_count": N, "error": "..."}`
- `learning_events`: every interaction logged with topic + event_type, used to build student profile
  - event types include: `exam_topic` (from exam uploads), `document_topic` (from knowledge docs), `quiz_result`, `flashcard_review`, etc.
- `student_performance`: per-topic strength/weakness tracking (populated after every interaction)
- `chat_sessions` + `chat_messages`: full chat history
- `flashcards`: FSRS fields — `stability`, `difficulty_fsrs`, `fsrs_state` + legacy SM-2 fields kept
- `quiz_sessions` + `quiz_questions`: quizzes with MC + free text
- `exam_uploads`: reference exams + student submissions (used for topic importance + analysis)
- `student_profile`: field of study, institution, year, preferences, `teaching_style`, `style_notes`
- `topic_summaries`: saved topic summaries per course (id, course_id, topic, content, guidance, language, created_at)
- `exam_dates` + `planned_study_sessions`: Phase 2 (scaffold only)

## Implementation Status

### Fully Implemented

- Courses (create, list, detail, **edit name/color via pencil icon modal**, **delete course with confirmation**)
- Document upload + Claude Vision processing + RAG embeddings — **multi-file support** (drag-drop or picker, per-file status ⏳↑✓✗)
- Document classification: summaries/lectures = raw material; exams = topic importance signal
- **Document scan quality badge** — Knowledge page shows ⚠ "לא נסרק כראוי" for partial/poor scans; **retry button also shown for partial/poor scan docs** (not just error/pending)
- **Document topic extraction in Hebrew** — `_extract_document_topics()` and `_extract_exam_topics()` output Hebrew topic names
- Homework checker (**multi-file**: images + PDFs, knowledge mode toggle + streaming structured feedback)
- Chat (streaming SSE, RAG, full history persistence, MarkdownContent rendering)
- Flashcards — FSRS-4.5 spaced repetition, 5 card types (comprehension, memorization, application, tricks, confusion), count slider 20–150, topic filter, guidance param
- Quizzes — generator + grader, multi-select question types (MC / free-text / mixed), difficulty, topic filter
- Exam analysis — full streaming implementation via Claude Vision, per-topic breakdown table, student experience input, reference exam comparison, weak topics logged to learning_events; **retry on Anthropic 5xx errors**; friendly error display when API fails
- Topic summary — streaming, MarkdownContent, guidance param, **free-text topic input + suggested chips**, **history panel** (sidebar per topic, auto-saved to `topic_summaries` DB after each generation); **loads from DB after stream** (not from SSE accumulated string)
- Study recommendations engine — urgency = exam-topic importance × weakness, shown in Flashcards + Quizzes pages
- Exam document topic extraction — on upload, Claude Haiku extracts topics → logged as `exam_topic` events
- `student_intelligence.py` — unified learning context + teaching style injected into all Claude calls
- `BASE_SYSTEM_PROMPT` — accuracy rules: no fabrication, LaTeX for all math, source attribution
- Settings — student profile + teaching style selector (direct/balanced/supportive) + style_notes
- i18n (Hebrew/English toggle, RTL layout) — all strings in en.json + he.json
- **AI output language** — all AI endpoints accept `language` param; `build_system_prompt` injects explicit language instruction so Claude always responds in the active UI language
- **Startup recovery** — on server start, documents stuck in "processing" (e.g. from container crash) are auto-reset to "error" so user can delete + re-upload
- **CourseTabBar resilience** — retries `getCourses()` up to 3 times with 1.5s delay; shows `···` while loading (prevents blank tab bar after Docker rebuild)
- **Multi-user login** — username-only login page; user list with create; `X-User-Id` header on every request
- **First-course flow** — new users see "name your first course" screen after signup before entering the app
- **User deletion** — any user can delete their own account (🗑 in CourseTabBar); admin can delete any user via 👥 manage-users modal; cascades all courses + data
- **Delete course** — 🗑 button shown when tab is in inline-edit mode; confirmation modal
- **HelpTooltip** — ? button next to each page in the sidebar nav (ידע פנימי / לימוד / שאל את הצ'אט / אבחון מצב לימודי); portal-based to avoid sidebar overflow clipping
- **KnowledgePage layout** — 50/50 flex split between doc list (left) and upload+shared library (right)

### Scaffolded (UI exists, logic partially stubbed)

- Progress / Diagnosis page (stats shown, charts scaffold)
- Transcripts (upload UI ready, summarize stubbed)

### Placeholder (Phase 2 — not implemented)

- Schedule + calendar integration (Google Calendar API)
- Study plan generator

## Important Rules

- Always update BOTH `en.json` and `he.json` when adding any UI string
- Always inject `student_intelligence` context into every Claude API call
- Always pass `language: str = "en"` through every new AI endpoint → service → `claude.complete()`/`claude.stream()` → `build_system_prompt()`
- Always write to `learning_events` after every student interaction
- Always run `extract_topic_background()` after writing to `learning_events`
- Streaming responses use SSE (`EventSourceResponse`) — same pattern as homework checker / exam analysis
- Frontend SSE readers MUST use the buffer approach: `buffer += decoder.decode(value, {stream:true}); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""`
- **After streaming AI content: always load final content from DB**, not from accumulated SSE string (embedded `\n` in chunks corrupt the accumulation)
- All new DB tables need an Alembic migration
- Math: always use `$...$` (inline) or `$$...$$` (display) LaTeX — never plain text formulas
- `MarkdownContent` component must be used for all AI-generated text (chat, summaries, quiz feedback, exam analysis, homework)
- `MarkdownContent` elements use `dir="auto"` — do not remove this, it enables correct RTL/LTR per paragraph
- FSRS quality ratings: 0=Again, 1=Hard, 2=Good, 3=Easy (maps to FSRS grade 1–4 in backend)
- Topic extraction prompts (`_extract_document_topics`, `_extract_exam_topics`) must return Hebrew — always include `"Return a JSON array of strings in Hebrew (עברית)"` in the prompt
- RAG top_k=15 for topic summary (higher than chat/homework to improve recall for niche subtopics)
- **Document list endpoint must always filter by current user** — JOIN with Course + `Course.user_id == current_user.id`; never return documents across users
- **New tooltips/popovers that appear inside `overflow: auto` containers** must use `createPortal` + `position:fixed` (see `HelpTooltip.tsx`)

## Key Services

| File | Purpose |
|------|---------|
| `services/student_intelligence.py` | Builds per-course learning context + teaching style for every Claude call |
| `services/fsrs.py` | FSRS-4.5 spaced repetition algorithm (17 default weights) |
| `services/recommendations.py` | Study recommendations: urgency = importance × weakness |
| `services/exam_analyzer.py` | Streaming Claude Vision exam analysis + retry on 5xx |
| `services/flashcard_generator.py` | Generates 5 card types with topic/guidance/language params |
| `services/document_processor.py` | Claude Vision PDF processing + Hebrew topic extraction + scan_quality |
| `services/claude.py` | `BASE_SYSTEM_PROMPT` + shared Claude client; `build_system_prompt(db, course_id, language)` injects language instruction |
| `services/embeddings.py` | `paraphrase-multilingual-MiniLM-L12-v2` (384-dim) embedding + chunking (500 words, 50 overlap) |
| `services/rag.py` | Cosine similarity search via pgvector; filters by course_id + upload_source |
| `components/MarkdownContent.tsx` | KaTeX + react-markdown renderer + `dir="auto"` for RTL/LTR |
| `components/RecommendationsPanel.tsx` | Urgency-color-coded topic recommendations widget |
| `components/HelpTooltip.tsx` | Click-to-show ? help popup; uses `createPortal` + `position:fixed` to escape `overflow:auto` parents |
| `components/layout/CourseSidebar.tsx` | Course nav sidebar with HelpTooltip per item; `helpKey` field on NavItem drives tooltip text |
| `api/deps.py` | `get_current_user` (reads `X-User-Id` header) + `get_admin_user` (checks `is_admin`) FastAPI deps |

## API — User Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/users/` | GET | List all users (admin only) |
| `POST /api/users/` | POST | Create a new user |
| `DELETE /api/users/me` | DELETE | Delete the currently logged-in user + all their data (cascade) |
| `DELETE /api/users/{user_id}` | DELETE | Admin: delete any user by ID (cascade) |

## API — Learning Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/learning/topic-summary` | POST (SSE) | Stream topic summary (top_k=15); auto-saves to `topic_summaries` on completion |
| `/api/learning/topic-summaries` | GET | List saved summaries (`?course_id=&topic=`) |
| `/api/learning/topic-summaries/{id}` | DELETE | Delete a saved summary |

## One-time Migration Scripts (`backend/scripts/`)

| Script | Purpose |
|--------|---------|
| `backfill_hebrew_topics.py` | Delete English `document_topic` events → re-extract in Hebrew (run once after prompt change) |
| `update_scan_quality.py` | Backfill `scan_quality` in `documents.metadata` for pre-existing documents |
| `reprocess_garbled.py` | Re-run Claude Vision on documents with poor text extraction |
| `backfill_document_topics.py` | Re-extract topics for documents processed before topic extraction was added |
| `re_embed.py` | Re-embed all document chunks with the new multilingual embedding model |

## Running Locally

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY
docker compose up --build
# Open http://localhost:3000
```
