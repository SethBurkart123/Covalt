from __future__ import annotations

from typing import Optional

from agno.agent import Agent

from .. import db


def generate_title_for_chat(chat_id: str) -> Optional[str]:
    try:
        with db.db_session() as sess:
            settings = db.get_auto_title_settings(sess)

            if not settings.get("enabled", True):
                return None

            messages = db.get_chat_messages(sess, chat_id)
            if not messages:
                return None

            first_user_msg = None
            for msg in messages:
                if msg.get("role") == "user":
                    first_user_msg = msg
                    break

            if not first_user_msg:
                return None

            user_content = first_user_msg.get("content", "")
            if isinstance(user_content, list):
                import json

                user_content = json.dumps(user_content)

            prompt_template = settings.get(
                "prompt",
                "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else.",
            )
            model_mode = settings.get("model_mode", "current")

            if "{{ message }}" in prompt_template:
                prompt = prompt_template.replace("{{ message }}", user_content)
            else:
                prompt = f"{prompt_template}\n\nUser message: {user_content}"

            if model_mode == "current":
                config = db.get_chat_agent_config(sess, chat_id)
                if not config:
                    config = db.get_default_agent_config()
                provider = config.get("provider", "openai")
                model_id = config.get("model_id", "gpt-4o-mini")
            else:
                provider = settings.get("provider", "openai")
                model_id = settings.get("model_id", "gpt-4o-mini")

        from .model_factory import get_model

        model = get_model(provider, model_id)
        agent = Agent(model=model, instructions=[prompt], tools=[], stream=True)
        response_stream = agent.run(
            input=[],
            stream=True,
            stream_events=False,
            yield_run_output=True,
        )

        final_response = None
        streamed_text_parts: list[str] = []

        for chunk in response_stream:
            if hasattr(chunk, "messages"):
                final_response = chunk
                continue
            content = getattr(chunk, "content", None)
            if isinstance(content, str) and content:
                streamed_text_parts.append(content)

        title_raw: Optional[str] = None

        if final_response is not None and getattr(final_response, "messages", None):
            last_msg = final_response.messages[-1]
            if last_msg and hasattr(last_msg, "content"):
                title_raw = str(last_msg.content)

        if title_raw is None and streamed_text_parts:
            title_raw = "".join(streamed_text_parts)

        if not title_raw:
            return None

        title = title_raw.strip().strip("\"'").strip()

        if len(title) > 100:
            title = title[:100].strip()

        return title if title else None

    except Exception as e:
        print(f"[title_generator] Error: {e}")
        return None
