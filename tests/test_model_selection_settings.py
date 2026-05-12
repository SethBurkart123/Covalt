from __future__ import annotations

import orjson
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.db.models import Base, UserSettings
from backend.db.settings import (
    get_model_selection_settings,
    get_model_selection_state,
    set_model_selection_settings,
    set_model_selection_state,
)
from backend.models.chat import ModelSelectionSettings, UpdateChatSelectionInput


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_model_selection_state_defaults_when_empty() -> None:
    with _session() as sess:
        assert get_model_selection_state(sess) == {
            "model_key": "",
            "model_options": {},
            "variables": {},
        }


def test_model_selection_state_saves_canonical_snapshot() -> None:
    with _session() as sess:
        set_model_selection_state(
            sess,
            {
                "model_key": "agent:assistant",
                "model_options": {"temperature": 0.2},
                "variables": {"tone": "direct"},
            },
        )

        raw_state = sess.get(UserSettings, "selected_model_state").value
        assert orjson.loads(raw_state) == {
            "model_key": "agent:assistant",
            "model_options": {"temperature": 0.2},
            "variables": {"tone": "direct"},
        }


def test_model_selection_settings_saves_fixed_selection() -> None:
    with _session() as sess:
        set_model_selection_settings(
            sess,
            {
                "mode": "fixed",
                "fixed_selection": {
                    "model_key": "openai:gpt-4.1",
                    "model_options": {"reasoning": "low"},
                    "variables": {},
                },
            },
        )

        assert get_model_selection_settings(sess) == {
            "mode": "fixed",
            "fixed_selection": {
                "model_key": "openai:gpt-4.1",
                "model_options": {"reasoning": "low"},
                "variables": {},
            },
        }


def test_model_selection_wire_models_use_snake_case_fields() -> None:
    selection = UpdateChatSelectionInput(
        chat_id="chat-1",
        model_key="agent:assistant",
        model_options={"temperature": 0.2},
        variables={"tone": "direct"},
    )
    settings = ModelSelectionSettings(
        mode="fixed",
        fixed_selection=selection,
    )

    assert selection.chat_id == "chat-1"
    assert selection.model_key == "agent:assistant"
    assert settings.fixed_selection.model_options == {"temperature": 0.2}
