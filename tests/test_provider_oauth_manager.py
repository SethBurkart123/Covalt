from __future__ import annotations

import asyncio
import socket

import httpx
import pytest

from backend.services.provider_oauth_manager import (
    OAuthFlowState,
    ProviderOAuthManager,
    _build_callback_server_message,
)


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.mark.asyncio
async def test_submit_oauth_code_parses_callback_url() -> None:
    manager = ProviderOAuthManager()
    flow = OAuthFlowState(provider="openai_codex", state="expected-state")
    manager._active_flows[flow.provider] = flow
    manager._register_code_future(flow)

    ok = manager.submit_oauth_code(
        "openai_codex",
        "http://localhost:1455/auth/callback?code=test-code&state=expected-state",
    )

    assert ok is True
    assert flow.code_future is not None
    assert await asyncio.wait_for(flow.code_future, timeout=1.0) == (
        "test-code",
        "expected-state",
    )


@pytest.mark.asyncio
async def test_submit_oauth_code_parses_hash_format() -> None:
    manager = ProviderOAuthManager()
    flow = OAuthFlowState(provider="anthropic_oauth", state="manual-state")
    manager._active_flows[flow.provider] = flow
    manager._register_code_future(flow)

    ok = manager.submit_oauth_code("anthropic_oauth", "manual-code#manual-state")

    assert ok is True
    assert flow.code_future is not None
    assert await asyncio.wait_for(flow.code_future, timeout=1.0) == (
        "manual-code",
        "manual-state",
    )


@pytest.mark.asyncio
async def test_submit_oauth_code_rejects_state_mismatch() -> None:
    manager = ProviderOAuthManager()
    flow = OAuthFlowState(provider="openai_codex", state="expected-state")
    manager._active_flows[flow.provider] = flow
    manager._register_code_future(flow)

    ok = manager.submit_oauth_code(
        "openai_codex",
        "http://localhost:1455/auth/callback?code=test-code&state=wrong-state",
    )

    assert ok is False
    assert flow.status == "error"
    assert flow.error == "State mismatch"
    assert flow.code_future is not None
    with pytest.raises(RuntimeError, match="state_mismatch"):
        await asyncio.wait_for(flow.code_future, timeout=1.0)


def test_build_callback_server_message_returns_expected_text() -> None:
    assert _build_callback_server_message("success") == (
        b"Authentication successful. Return to the app."
    )
    assert _build_callback_server_message("failed") == (
        b"Authentication failed. Return to the app and try again."
    )


@pytest.mark.asyncio
async def test_callback_server_success_completes_pending_future() -> None:
    manager = ProviderOAuthManager()
    flow = OAuthFlowState(provider="google_gemini_cli", state="state-123")
    manager._active_flows[flow.provider] = flow
    manager._register_code_future(flow)

    port = _get_free_port()
    server = manager._start_callback_server(flow, port=port, path="/oauth2callback")

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(
                f"http://127.0.0.1:{port}/oauth2callback?code=cb-code&state=state-123"
            )

        assert response.status_code == 200
        assert response.text == "Authentication successful. Return to the app."
        assert flow.code_future is not None
        assert await asyncio.wait_for(flow.code_future, timeout=1.0) == (
            "cb-code",
            "state-123",
        )
    finally:
        server.stop()


@pytest.mark.asyncio
async def test_callback_server_state_mismatch_returns_failed_response() -> None:
    manager = ProviderOAuthManager()
    flow = OAuthFlowState(provider="google_gemini_cli", state="expected")
    manager._active_flows[flow.provider] = flow
    manager._register_code_future(flow)

    port = _get_free_port()
    server = manager._start_callback_server(flow, port=port, path="/oauth2callback")

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(
                f"http://127.0.0.1:{port}/oauth2callback?code=cb-code&state=wrong"
            )

        assert response.status_code == 400
        assert response.text == "Authentication failed. Return to the app and try again."
        assert flow.status == "error"
        assert flow.error == "state_mismatch"
        assert flow.code_future is not None
        with pytest.raises(RuntimeError, match="state_mismatch"):
            await asyncio.wait_for(flow.code_future, timeout=1.0)
    finally:
        server.stop()
