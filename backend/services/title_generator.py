from __future__ import annotations

from typing import Optional
from pytauri import AppHandle
from agno.agent import Agent

from .. import db


def generate_title_for_chat(chat_id: str, app_handle: AppHandle) -> Optional[str]:
    """
    Generate a title for a chat based on its first user message.
    
    Args:
        chat_id: Chat identifier
        app_handle: Tauri app handle
        
    Returns:
        Generated title string or None if disabled/failed
    """
    try:
        with db.db_session(app_handle) as sess:
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
            
            prompt_template = settings.get("prompt", "Generate a brief, descriptive title (max 6 words) for this conversation based on the user's message: {{ message }}\n\nReturn only the title, nothing else.")
            model_mode = settings.get("model_mode", "current")
            
            # Replace {{ message }} placeholder with actual message
            if "{{ message }}" in prompt_template:
                prompt = prompt_template.replace("{{ message }}", user_content)
            else:
                # Fallback: if no placeholder, append message at the end
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
        model = get_model(provider, model_id, app_handle)
        
        agent = Agent(
            model=model,
            instructions=[prompt],
            tools=[],
            stream=False,
        )
        
        # Use empty input since prompt already contains the message
        response = agent.run(input=[])
        
        if not response or not response.messages:
            return None
        
        last_msg = response.messages[-1]
        if not last_msg or not hasattr(last_msg, 'content'):
            return None
        
        title = str(last_msg.content).strip()
        
        title = title.strip('"\'').strip()
        
        if len(title) > 100:
            title = title[:100].strip()
        
        return title if title else None
        
    except Exception as e:
        print(f"[title_generator] Error generating title: {e}")
        return None

