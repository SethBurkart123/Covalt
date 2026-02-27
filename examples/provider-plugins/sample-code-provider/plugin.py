from __future__ import annotations


def create_provider(provider_id: str, **_kwargs):
    async def fetch_models():
        return [
            {"id": "sample-code-1", "name": "Sample Code Model 1"},
            {"id": "sample-code-2", "name": "Sample Code Model 2"},
        ]

    def get_model(model_id: str, provider_options=None):
        return {
            "provider": provider_id,
            "model": model_id,
            "options": provider_options or {},
        }

    async def test_connection():
        return True, None

    return {
        "get_model": get_model,
        "fetch_models": fetch_models,
        "test_connection": test_connection,
    }
