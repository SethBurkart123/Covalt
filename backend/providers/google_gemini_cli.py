"""Google Gemini CLI OAuth Provider - Cloud Code Assist."""

from typing import Any, Dict, List

from .google_code_assist import CloudCodeAssistModel
from ..services.models_dev import fetch_models_dev_provider
from ..services.provider_oauth_manager import get_provider_oauth_manager


def _get_gemini_cli_credentials() -> Dict[str, Any]:
    creds = get_provider_oauth_manager().get_valid_credentials(
        "google_gemini_cli",
        refresh_if_missing_expiry=True,
        allow_stale_on_refresh_failure=False,
    )
    if not creds:
        raise RuntimeError("Google Gemini CLI OAuth not connected in Settings.")
    return creds


def get_google_gemini_cli_model(
    model_id: str,
    provider_options: Dict[str, Any],
) -> CloudCodeAssistModel:
    creds = _get_gemini_cli_credentials()
    access_token = creds.get("access_token")
    extra = creds.get("extra") or {}
    project_id = extra.get("projectId") if isinstance(extra, dict) else None
    if not access_token or not project_id:
        raise RuntimeError("Google Gemini CLI OAuth credentials are incomplete.")

    return CloudCodeAssistModel(
        id=model_id,
        name="GoogleGeminiCLI",
        provider="google_gemini_cli",
        access_token=access_token,
        project_id=project_id,
        base_url="https://cloudcode-pa.googleapis.com",
        is_antigravity=False,
    )


async def fetch_models() -> List[Dict[str, str]]:
    try:
        _get_gemini_cli_credentials()
    except RuntimeError:
        return []
    return await fetch_models_dev_provider(
        "google",
        predicate=lambda model_id, info: info.get("tool_call") is True
        and model_id.startswith("gemini-"),
    )


async def test_connection() -> tuple[bool, str | None]:
    try:
        _get_gemini_cli_credentials()
    except RuntimeError:
        return False, "OAuth not connected"
    return True, None
