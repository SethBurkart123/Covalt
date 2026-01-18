"""
Quiz tool for creating interactive multiple-choice quizzes.

Uses Pydantic for schema validation - the complex nested structure is
automatically inferred as JSON Schema by the @tool decorator.
"""

from pydantic import BaseModel, Field

from agno_toolset import tool


class QuizQuestion(BaseModel):
    """A single quiz question with multiple choice answers."""

    question: str = Field(description="The question text")
    answers: list[str] = Field(
        min_length=4,
        max_length=4,
        description="Exactly 4 answer options",
    )
    correct_index: int = Field(
        ge=0,
        le=3,
        alias="correctIndex",
        description="Index (0-3) of the correct answer",
    )


@tool(
    name="Create Quiz",
    description=(
        "Create an interactive multiple-choice quiz. The model provides the quiz "
        "title and an array of questions. Each question has a question text, exactly "
        "4 answer options, and a correctIndex (0-3) indicating which answer is correct. "
        "The quiz is rendered as an interactive HTML artifact where the user can take "
        "the quiz one question at a time with immediate feedback."
    ),
    category="content",
)
def create_quiz(title: str, questions: list[QuizQuestion]) -> dict:
    """
    Create an interactive multiple-choice quiz.

    Args:
        title: Title of the quiz
        questions: Array of quiz questions

    Returns:
        Dict with validated quiz data for the HTML renderer
    """
    if not title or not title.strip():
        raise ValueError("Quiz title is required")

    if not questions or len(questions) == 0:
        raise ValueError("At least one question is required")

    # LLM sends dicts, convert to Pydantic models for validation
    validated_questions = []
    for q in questions:
        if isinstance(q, dict):
            validated_questions.append(QuizQuestion.model_validate(q))
        else:
            validated_questions.append(q)

    return {
        "title": title.strip(),
        "questions": [q.model_dump(by_alias=True) for q in validated_questions],
        "questionCount": len(validated_questions),
    }
