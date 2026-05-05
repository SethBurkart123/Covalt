"""
Quiz tool for creating interactive quizzes with multiple question types.

Supports: multiple choice, multiple select, true/false, and fill-in-the-blank.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Discriminator, Field, Tag

from covalt_toolset import tool


class MultipleChoiceQuestion(BaseModel):
    type: Literal["multiple_choice"] = "multiple_choice"
    question: str = Field(description="The question text")
    answers: list[str] = Field(
        min_length=2,
        max_length=6,
        description="2-6 answer options",
    )
    correctIndex: int = Field(
        ge=0,
        description="Index of the correct answer",
    )


class MultipleSelectQuestion(BaseModel):
    type: Literal["multiple_select"] = "multiple_select"
    question: str = Field(description="The question text")
    answers: list[str] = Field(
        min_length=2,
        max_length=6,
        description="2-6 answer options",
    )
    correctIndices: list[int] = Field(
        min_length=1,
        description="Indices of all correct answers",
    )


class TrueFalseQuestion(BaseModel):
    type: Literal["true_false"] = "true_false"
    question: str = Field(description="The question text (a statement)")
    correctAnswer: bool = Field(description="Whether the statement is true or false")


class FillInBlankQuestion(BaseModel):
    type: Literal["fill_in_blank"] = "fill_in_blank"
    question: str = Field(
        description="The question text. Use ___ to indicate the blank."
    )
    acceptedAnswers: list[str] = Field(
        min_length=1,
        description="Accepted answers (case-insensitive matching)",
    )


QuizQuestion = Annotated[
    Union[
        Annotated[MultipleChoiceQuestion, Tag("multiple_choice")],
        Annotated[MultipleSelectQuestion, Tag("multiple_select")],
        Annotated[TrueFalseQuestion, Tag("true_false")],
        Annotated[FillInBlankQuestion, Tag("fill_in_blank")],
    ],
    Discriminator("type"),
]

_QUESTION_MODELS = {
    "multiple_choice": MultipleChoiceQuestion,
    "multiple_select": MultipleSelectQuestion,
    "true_false": TrueFalseQuestion,
    "fill_in_blank": FillInBlankQuestion,
}


class CreateQuizInput(BaseModel):
    title: str = Field(description="Title of the quiz")
    questions: list[QuizQuestion] = Field(
        description="Array of quiz questions, each with a 'type' discriminator"
    )


@tool(
    name="Create Quiz",
    description=(
        "Create an interactive quiz with multiple question types. Supports: "
        "multiple_choice (2-6 options, one correct), multiple_select (2-6 options, "
        "multiple correct), true_false (statement is true or false), and "
        "fill_in_blank (text input with accepted answers). Each question must have "
        "a 'type' field. The quiz is rendered as an interactive artifact."
    ),
    category="content",
)
def create_quiz(title: str, questions: list[QuizQuestion]) -> dict:
    """
    Create an interactive quiz.

    Args:
        title: Title of the quiz
        questions: Array of quiz questions, each with a 'type' field

    Returns:
        Dict with validated quiz data for the HTML renderer
    """
    if not title or not title.strip():
        raise ValueError("Quiz title is required")
    if not questions:
        raise ValueError("At least one question is required")

    validated = []
    for q in questions:
        if isinstance(q, BaseModel):
            validated.append(q)
            continue
        q_type = q.get("type", "multiple_choice")
        model_cls = _QUESTION_MODELS.get(q_type)
        if not model_cls:
            raise ValueError(f"Unknown question type: {q_type}")
        validated.append(model_cls.model_validate(q))

    return {
        "title": title.strip(),
        "questions": [q.model_dump() for q in validated],
        "questionCount": len(validated),
    }
