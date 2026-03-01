from __future__ import annotations

import asyncio
from typing import Callable, Literal, Optional
from urllib.parse import parse_qs, urlparse

OAuthStatus = Literal["none", "pending", "authenticated", "error"]


def build_localhost_redirect_uri(port: int, path: str = "/oauth/callback") -> str:
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"http://localhost:{port}{normalized_path}"


def extract_state_from_auth_url(auth_url: str) -> Optional[str]:
    try:
        params = parse_qs(urlparse(auth_url).query)
        state = params.get("state", [None])[0]
        return state or None
    except Exception:
        return None


def parse_oauth_code_input(input_value: str) -> tuple[Optional[str], Optional[str]]:
    trimmed = input_value.strip()
    if not trimmed:
        return None, None

    code, state = _parse_url_params(trimmed)
    if code:
        return code, state

    if "#" in trimmed:
        code_part, state_part = trimmed.split("#", 1)
        return code_part or None, state_part or None

    code, state = _parse_query_params(trimmed)
    if code:
        return code, state

    return trimmed, None


def _parse_url_params(input_value: str) -> tuple[Optional[str], Optional[str]]:
    try:
        parsed = urlparse(input_value)
        if parsed.scheme and parsed.query:
            params = parse_qs(parsed.query)
            return params.get("code", [None])[0], params.get("state", [None])[0]
    except Exception:
        return None, None
    return None, None


def _parse_query_params(input_value: str) -> tuple[Optional[str], Optional[str]]:
    try:
        params = parse_qs(input_value)
        return params.get("code", [None])[0], params.get("state", [None])[0]
    except Exception:
        return None, None


def _current_loop() -> asyncio.AbstractEventLoop:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.get_event_loop()


def _set_future_result(
    future: asyncio.Future[tuple[str, Optional[str]]],
    result: tuple[str, Optional[str]],
) -> None:
    if not future.done():
        future.set_result(result)


def _set_future_exception(
    future: asyncio.Future[tuple[str, Optional[str]]],
    exc: Exception,
) -> None:
    if not future.done():
        future.set_exception(exc)


def _cancel_future(future: asyncio.Future[tuple[str, Optional[str]]]) -> None:
    if not future.done():
        future.cancel()


class PendingOAuthCallbacks:
    def __init__(
        self,
        *,
        error_factory: Callable[[str, Optional[str]], Exception] | None = None,
    ) -> None:
        self._pending: dict[
            str,
            tuple[asyncio.AbstractEventLoop, asyncio.Future[tuple[str, Optional[str]]]],
        ] = {}
        self._error_factory = error_factory or self._default_error

    def create(self, state: str) -> asyncio.Future[tuple[str, Optional[str]]]:
        loop = _current_loop()
        future: asyncio.Future[tuple[str, Optional[str]]] = loop.create_future()
        self._pending[state] = (loop, future)
        return future

    def complete(
        self,
        code: str,
        state: str,
        *,
        result_state: Optional[str] = None,
    ) -> bool:
        entry = self._pending.pop(state, None)
        if not entry:
            return False

        loop, future = entry
        if future.done():
            return False

        loop.call_soon_threadsafe(
            _set_future_result,
            future,
            (code, state if result_state is None else result_state),
        )
        return True

    def fail(self, state: str, error: str, description: Optional[str] = None) -> bool:
        entry = self._pending.pop(state, None)
        if not entry:
            return False

        loop, future = entry
        if future.done():
            return False

        exc = self._error_factory(error, description)
        loop.call_soon_threadsafe(_set_future_exception, future, exc)
        return True

    def cancel(self, state: str) -> None:
        entry = self._pending.pop(state, None)
        if not entry:
            return

        loop, future = entry
        if future.done():
            return
        loop.call_soon_threadsafe(_cancel_future, future)

    @staticmethod
    def _default_error(error: str, description: Optional[str]) -> Exception:
        return RuntimeError(f"{error}: {description}" if description else error)
