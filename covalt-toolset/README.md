# covalt-toolset

SDK for building Covalt toolsets.

## Installation

```bash
# From git (recommended during development)
pip install git+https://github.com/your-org/covalt-toolset.git

# With Pydantic support (for complex schemas)
pip install "git+https://github.com/your-org/covalt-toolset.git#egg=covalt-toolset[pydantic]"
```

## Quick Start

```python
from covalt_toolset import tool, get_context

@tool(name="Write File", description="Write content to a file in the workspace")
def write_file(path: str, content: str) -> dict:
    """
    Args:
        path: File path relative to workspace
        content: Content to write
    """
    ctx = get_context()
    target = ctx.workspace / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    return {"path": path, "size": len(content)}
```

## Using Pydantic for Complex Schemas

```python
from pydantic import BaseModel, Field
from covalt_toolset import tool

class QuizQuestion(BaseModel):
    question: str = Field(description="The question text")
    answers: list[str] = Field(min_length=4, max_length=4, description="Exactly 4 options")
    correct_index: int = Field(ge=0, le=3, alias="correctIndex")

@tool(name="Create Quiz", category="content")
def create_quiz(title: str, questions: list[QuizQuestion]) -> dict:
    """
    Args:
        title: Title of the quiz
        questions: Array of quiz questions
    """
    return {
        "title": title,
        "questions": [q.model_dump(by_alias=True) for q in questions],
    }
```

## Context

Tools can access execution context via `get_context()`:

```python
from covalt_toolset import tool, get_context

@tool(name="List Files")
def list_files(directory: str = "") -> dict:
    ctx = get_context()
    
    # Available context:
    # - ctx.workspace: Path to the chat's workspace directory
    # - ctx.chat_id: Current chat ID
    # - ctx.toolset_id: ID of this toolset
    
    target = ctx.workspace / directory
    files = [f.name for f in target.iterdir() if f.is_file()]
    return {"files": files}
```

## Decorator Options

```python
@tool(
    name="Delete File",           # Display name (default: function name)
    description="Delete a file",  # Description for LLM (default: first line of docstring)
    requires_confirmation=True,   # Require user approval before execution
    category="filesystem",        # Optional category for grouping
)
def delete_file(path: str) -> dict:
    ...
```
