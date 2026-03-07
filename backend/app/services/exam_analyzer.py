"""
Full exam analysis service.
Analyzes a student's exam submission using Claude Vision (multimodal).
Optionally compares against a reference exam.
Streams per-topic feedback + optional exam experience feedback.
"""
from typing import Optional, AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from app.services import student_intelligence


async def analyze_exam_stream(
    db: AsyncSession,
    exam_images_b64: list[str],
    course_id: str,
    reference_images_b64: Optional[list[str]] = None,
    guidance: Optional[str] = None,
    student_experience: Optional[str] = None,
    language: str = "en",
) -> AsyncGenerator[str, None]:
    """
    Stream exam analysis as SSE text chunks.
    Writes weak topics to learning_events after analysis completes.
    """
    # Build multimodal content
    content: list[dict] = []

    content.append({"type": "text", "text": "## Student Exam Submission\nAnalyze the following exam pages:"})
    for i, img_b64 in enumerate(exam_images_b64):
        if img_b64.startswith("/9j"):
            media_type = "image/jpeg"
        else:
            media_type = "image/png"
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": img_b64},
        })
        content.append({"type": "text", "text": f"[Student exam — page {i + 1}]"})

    if reference_images_b64:
        content.append({"type": "text", "text": "\n## Reference Exam / Model Solutions"})
        for i, img_b64 in enumerate(reference_images_b64):
            if img_b64.startswith("/9j"):
                media_type = "image/jpeg"
            else:
                media_type = "image/png"
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": img_b64},
            })
            content.append({"type": "text", "text": f"[Reference — page {i + 1}]"})

    guidance_str = f"\n\nSpecial focus: {guidance}" if guidance else ""
    experience_section = ""
    if student_experience:
        if language == "he":
            experience_header = "## משוב על ניהול הזמן ואסטרטגיית מבחן"
        else:
            experience_header = "## Time Management and Exam Strategy Feedback"
        experience_section = (
            f"\n\n## Student Self-Report\n"
            f"The student described their exam experience as follows:\n{student_experience}\n"
            f"Please include a **{experience_header}** section based on this."
        )

    if language == "he":
        analysis_prompt = (
            "Analyze this student's exam in detail. Write your analysis in the following markdown structure:\n\n"
            "## ניתוח לפי נושאים\n"
            "Create a markdown table:\n"
            "| נושא | ביצוע | הערות |\n"
            "|------|-------|-------|\n"
            "For each topic in the exam: use ✅ for correct/good, ⚠️ for partial, ❌ for incorrect/missing.\n"
            "Include specific observations in the הערות column.\n\n"
            "## נקודות חוזקה\n"
            "Bullet list of what the student did well.\n\n"
            "## נקודות לשיפור\n"
            "Bullet list of specific topics/skills that need work.\n\n"
            "## שגיאות נפוצות\n"
            "Identify recurring error patterns (e.g., sign errors, unit mistakes, wrong formula choice).\n\n"
            + ("## משוב על ניהול הזמן ואסטרטגיית מבחן\n" if student_experience else "")
            + "Use LaTeX for all math: $...$ inline, $$...$$ for display equations.\n"
            + "Never fabricate analysis — only comment on what you can actually see in the exam."
            + guidance_str
            + experience_section
        )
    else:
        analysis_prompt = (
            "Analyze this student's exam in detail. Write your analysis in the following markdown structure:\n\n"
            "## Topic Analysis\n"
            "Create a markdown table:\n"
            "| Topic | Performance | Notes |\n"
            "|-------|-------------|-------|\n"
            "For each topic in the exam: use ✅ for correct/good, ⚠️ for partial, ❌ for incorrect/missing.\n"
            "Include specific observations in the Notes column.\n\n"
            "## Strengths\n"
            "Bullet list of what the student did well.\n\n"
            "## Areas for Improvement\n"
            "Bullet list of specific topics/skills that need work.\n\n"
            "## Common Errors\n"
            "Identify recurring error patterns (e.g., sign errors, unit mistakes, wrong formula choice).\n\n"
            + ("## Time Management and Exam Strategy Feedback\n" if student_experience else "")
            + "Use LaTeX for all math: $...$ inline, $$...$$ for display equations.\n"
            + "Never fabricate analysis — only comment on what you can actually see in the exam."
            + guidance_str
            + experience_section
        )

    content.append({"type": "text", "text": analysis_prompt})

    extra_system = (
        "You are analyzing a student's engineering exam with precision. "
        "Be specific and factual. Identify every topic and evaluate performance per topic. "
        "Never fabricate — only analyze what is visible."
    )

    collected_text: list[str] = []

    async def _stream_inner():
        import anthropic as _anth
        from app.core.config import settings
        from app.services.claude import build_system_prompt

        client = _anth.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
        system = await build_system_prompt(db, course_id, language=language)
        system = f"{system}\n\n{extra_system}"

        # Retry once on Anthropic 5xx errors
        last_exc = None
        for attempt in range(2):
            try:
                async with client.messages.stream(
                    model="claude-sonnet-4-6",
                    max_tokens=4000,
                    system=system,
                    messages=[{"role": "user", "content": content}],
                ) as stream_ctx:
                    async for text in stream_ctx.text_stream:
                        collected_text.append(text)
                        yield text
                return  # success
            except Exception as e:
                last_exc = e
                if attempt == 0:
                    collected_text.clear()
                    continue
                raise

    async for chunk in _stream_inner():
        yield chunk

    # After streaming: log weak topics as learning events
    full_text = "".join(collected_text)
    await _log_weak_topics(db, course_id, full_text)


async def _log_weak_topics(db: AsyncSession, course_id: str, analysis_text: str) -> None:
    """Parse markdown table from analysis and log weak topics as learning events."""
    lines = analysis_text.split("\n")
    for line in lines:
        if "|" not in line:
            continue
        if "❌" in line or "⚠️" in line:
            parts = [p.strip() for p in line.split("|")]
            # Table format: | topic | verdict | notes |
            if len(parts) >= 3:
                topic = parts[1].strip()
                if topic and topic not in ("נושא", "Topic", "---", ""):
                    event_type = "quiz_wrong" if "❌" in line else "homework_error"
                    try:
                        await student_intelligence.write_learning_event(
                            db=db,
                            event_type=event_type,
                            course_id=course_id,
                            topic=topic,
                            details={"source": "exam_analysis"},
                        )
                    except Exception:
                        pass
    try:
        await db.commit()
    except Exception:
        pass
