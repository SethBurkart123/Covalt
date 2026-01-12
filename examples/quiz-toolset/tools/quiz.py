"""
Quiz tool for creating interactive multiple-choice quizzes.

The model provides the questions; this tool validates them and returns
the data for the HTML artifact renderer.
"""

from pathlib import Path
from typing import Any


def create_quiz(workspace: Path, title: str, questions: list[dict[str, Any]]) -> dict:
    """
    Create an interactive multiple-choice quiz.

    Args:
        workspace: Path to the chat's workspace directory (unused for this tool)
        title: Title of the quiz
        questions: List of question objects, each with:
            - question: str - The question text
            - answers: list[str] - Exactly 4 answer options
            - correctIndex: int - Index (0-3) of the correct answer

    Returns:
        Dict with validated quiz data for the HTML renderer
    """
    if not title or not title.strip():
        raise ValueError("Quiz title is required")

    if not questions or len(questions) == 0:
        raise ValueError("At least one question is required")

    validated_questions = []

    for i, q in enumerate(questions):
        # Validate question text
        if not isinstance(q.get("question"), str) or not q["question"].strip():
            raise ValueError(f"Question {i + 1}: question text is required")

        # Validate answers
        answers = q.get("answers", [])
        if not isinstance(answers, list) or len(answers) != 4:
            raise ValueError(f"Question {i + 1}: exactly 4 answers are required")

        for j, ans in enumerate(answers):
            if not isinstance(ans, str) or not ans.strip():
                raise ValueError(
                    f"Question {i + 1}, answer {j + 1}: answer text is required"
                )

        # Validate correctIndex
        correct_index = q.get("correctIndex")
        if not isinstance(correct_index, int) or correct_index < 0 or correct_index > 3:
            raise ValueError(f"Question {i + 1}: correctIndex must be an integer 0-3")

        validated_questions.append(
            {
                "question": q["question"].strip(),
                "answers": [ans.strip() for ans in answers],
                "correctIndex": correct_index,
            }
        )

    return {
        "title": title.strip(),
        "questions": validated_questions,
        "questionCount": len(validated_questions),
    }
