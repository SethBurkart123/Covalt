from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Literal, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from ..db import db_session
from ..db.provider_oauth import (
    delete_provider_oauth,
    get_provider_oauth,
    save_provider_oauth,
)

OAuthStatus = Literal["none", "pending", "authenticated", "error"]

AUTH_TIMEOUT_S = 600
CALLBACK_TIMEOUT_S = 600


def _decode_base64(value: str) -> str:
    return base64.b64decode(value.encode()).decode()


def _base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _generate_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(32)
    challenge = _base64url_encode(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def _expires_at_from_seconds(expires_in: int) -> str:
    return (
        datetime.now() + timedelta(seconds=expires_in) - timedelta(minutes=5)
    ).isoformat()


def _is_expired(expires_at: Optional[str]) -> bool:
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(expires_at) < datetime.now()
    except Exception:
        return False


def _is_missing_expiry(expires_at: Optional[str]) -> bool:
    if expires_at is None:
        return True
    if isinstance(expires_at, str) and not expires_at.strip():
        return True
    return False


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def _parse_url_params(input_value: str) -> tuple[Optional[str], Optional[str]]:
    try:
        parsed = urlparse(input_value)
        if parsed.scheme and parsed.query:
            params = parse_qs(parsed.query)
            return params.get("code", [None])[0], params.get("state", [None])[0]
    except Exception:
        return None, None
    return None, None


def _normalize_provider(provider: str) -> str:
    return provider.lower().strip().replace("-", "_")


def _parse_code_state(input_value: str) -> tuple[Optional[str], Optional[str]]:
    trimmed = input_value.strip()
    if not trimmed:
        return None, None
    if "#" in trimmed:
        code, state = trimmed.split("#", 1)
        return code or None, state or None
    if "code=" in trimmed:
        params = parse_qs(trimmed)
        return params.get("code", [None])[0], params.get("state", [None])[0]
    return trimmed, None


def _decode_jwt_payload(token: str) -> Optional[Dict[str, Any]]:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1]
    padded = payload + "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode()).decode()
        return json.loads(decoded)
    except Exception:
        return None


class _CallbackServer:
    def __init__(
        self,
        *,
        port: int,
        path: str,
        expected_state: Optional[str],
        on_code: Callable[[str, str], None],
        on_error: Callable[[str], None],
    ) -> None:
        self._port = port
        self._path = path
        self._expected_state = expected_state
        self._on_code = on_code
        self._on_error = on_error
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        handler = self._build_handler()
        self._server = ThreadingHTTPServer(("127.0.0.1", self._port), handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        if self._thread:
            self._thread.join(timeout=1)

    def _build_handler(self) -> type[BaseHTTPRequestHandler]:
        expected_state = self._expected_state
        path = self._path
        on_code = self._on_code
        on_error = self._on_error

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return

            def do_GET(self) -> None:
                try:
                    parsed = urlparse(self.path)
                    if parsed.path != path:
                        self.send_response(404)
                        self.end_headers()
                        return
                    params = parse_qs(parsed.query)
                    code = params.get("code", [""])[0]
                    state = params.get("state", [""])[0]
                    error = params.get("error", [""])[0]
                    if error:
                        on_error(error)
                        self.send_response(400)
                        self.end_headers()
                        self.wfile.write(b"Authentication failed.")
                        return
                    if expected_state and state != expected_state:
                        on_error("state_mismatch")
                        self.send_response(400)
                        self.end_headers()
                        self.wfile.write(b"State mismatch.")
                        return
                    if not code:
                        on_error("missing_code")
                        self.send_response(400)
                        self.end_headers()
                        self.wfile.write(b"Missing authorization code.")
                        return
                    on_code(code, state)
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"Authentication successful. Return to the app.")
                except Exception:
                    self.send_response(500)
                    self.end_headers()

        return Handler


@dataclass
class OAuthFlowState:
    provider: str
    status: OAuthStatus = "pending"
    error: Optional[str] = None
    auth_url: Optional[str] = None
    instructions: Optional[str] = None
    verifier: Optional[str] = None
    state: Optional[str] = None
    code_future: asyncio.Future[Tuple[str, Optional[str]]] | None = None
    callback_server: Optional[_CallbackServer] = None
    flow_task: Optional[asyncio.Task[None]] = None
    extra: Dict[str, Any] = field(default_factory=dict)


class ProviderOAuthManager:
    def __init__(self) -> None:
        self._active_flows: Dict[str, OAuthFlowState] = {}
        # When true, attempt refresh for credentials missing expires_at.
        self._refresh_if_missing_expiry = _env_flag(
            "AGNO_OAUTH_REFRESH_IF_MISSING_EXPIRY", False
        )
        # When false, return None instead of stale credentials if refresh fails.
        self._allow_stale_on_refresh_failure = _env_flag(
            "AGNO_OAUTH_ALLOW_STALE_ON_REFRESH_FAILURE", True
        )

    async def start_oauth(
        self, provider: str, options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        provider = _normalize_provider(provider)
        options = options or {}
        if provider in self._active_flows:
            flow = self._active_flows[provider]
            return {
                "authUrl": flow.auth_url,
                "instructions": flow.instructions,
                "status": flow.status,
                "error": flow.error,
            }

        flow = OAuthFlowState(provider=provider)
        self._active_flows[provider] = flow

        if provider == "anthropic_oauth":
            await self._start_anthropic(flow)
        elif provider == "openai_codex":
            await self._start_openai_codex(flow)
        elif provider == "github_copilot":
            await self._start_github_copilot(flow, options)
        elif provider == "google_gemini_cli":
            await self._start_google_gemini(flow)
        else:
            flow.status = "error"
            flow.error = f"Unknown provider: {provider}"

        return {
            "authUrl": flow.auth_url,
            "instructions": flow.instructions,
            "status": flow.status,
            "error": flow.error,
        }

    def submit_oauth_code(self, provider: str, code_input: str) -> bool:
        provider = _normalize_provider(provider)
        flow = self._active_flows.get(provider)
        if not flow or not flow.code_future or flow.code_future.done():
            return False

        code, state = self._parse_manual_input(provider, code_input)
        if not code:
            flow.error = "Missing authorization code"
            flow.status = "error"
            return False
        if flow.state and state and state != flow.state:
            flow.error = "State mismatch"
            flow.status = "error"
            return False

        flow.code_future.set_result((code, state))
        return True

    def get_oauth_status(self, provider: str) -> Dict[str, Any]:
        provider = _normalize_provider(provider)
        flow = self._active_flows.get(provider)
        if flow:
            has_tokens = self.has_valid_tokens(provider)
            return {
                "status": flow.status,
                "hasTokens": has_tokens,
                "authUrl": flow.auth_url,
                "instructions": flow.instructions,
                "error": flow.error,
            }
        has_tokens = self.has_valid_tokens(provider)
        return {
            "status": "authenticated" if has_tokens else "none",
            "hasTokens": has_tokens,
        }

    async def revoke_oauth(self, provider: str) -> None:
        provider = _normalize_provider(provider)
        flow = self._active_flows.pop(provider, None)
        if flow and flow.callback_server:
            flow.callback_server.stop()
        if flow and flow.flow_task:
            flow.flow_task.cancel()
        with db_session() as sess:
            delete_provider_oauth(sess, provider)

    def has_valid_tokens(self, provider: str) -> bool:
        provider = _normalize_provider(provider)
        with db_session() as sess:
            data = get_provider_oauth(sess, provider)
        if not data or not data.get("access_token"):
            return False
        if _is_expired(data.get("expires_at")):
            return False
        return True

    def get_valid_credentials(
        self,
        provider: str,
        *,
        refresh_if_missing_expiry: Optional[bool] = None,
        allow_stale_on_refresh_failure: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        provider = _normalize_provider(provider)
        refresh_missing = (
            self._refresh_if_missing_expiry
            if refresh_if_missing_expiry is None
            else refresh_if_missing_expiry
        )
        allow_stale = (
            self._allow_stale_on_refresh_failure
            if allow_stale_on_refresh_failure is None
            else allow_stale_on_refresh_failure
        )
        with db_session() as sess:
            data = get_provider_oauth(sess, provider)
        if not data:
            return None
        expires_at = data.get("expires_at")
        expired = _is_expired(expires_at)
        missing_expiry = _is_missing_expiry(expires_at)

        if not expired and not (refresh_missing and missing_expiry):
            return data

        refreshed = self._refresh_credentials(provider, data)
        if refreshed:
            merged = dict(data)
            merged.update(refreshed)
            return merged

        if allow_stale:
            return data
        return None

    def _refresh_credentials(
        self, provider: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        refresh_token = data.get("refresh_token")
        if not refresh_token:
            return None
        if provider == "anthropic_oauth":
            return self._refresh_anthropic(refresh_token)
        if provider == "openai_codex":
            return self._refresh_openai_codex(refresh_token)
        if provider == "github_copilot":
            return self._refresh_github_copilot(refresh_token, data.get("extra"))
        if provider == "google_gemini_cli":
            return self._refresh_google_gemini(refresh_token, data.get("extra"))
        return None

    async def _start_anthropic(self, flow: OAuthFlowState) -> None:
        client_id = _decode_base64("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl")
        verifier, challenge = _generate_pkce()
        flow.verifier = verifier
        flow.state = verifier
        auth_params = {
            "code": "true",
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": "https://console.anthropic.com/oauth/code/callback",
            "scope": "org:create_api_key user:profile user:inference",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": verifier,
        }
        flow.auth_url = f"https://claude.ai/oauth/authorize?{urlencode(auth_params)}"
        flow.instructions = "Paste the authorization code"
        flow.code_future = asyncio.get_event_loop().create_future()
        flow.flow_task = asyncio.create_task(self._finish_anthropic(flow))

    async def _finish_anthropic(self, flow: OAuthFlowState) -> None:
        try:
            if not flow.code_future:
                raise ValueError("Missing authorization code")
            code_future = flow.code_future
            code, state = await asyncio.wait_for(code_future, timeout=AUTH_TIMEOUT_S)
            if flow.state and state and state != flow.state:
                raise ValueError("State mismatch")
            data = {
                "grant_type": "authorization_code",
                "client_id": _decode_base64(
                    "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl"
                ),
                "code": code,
                "state": state,
                "redirect_uri": "https://console.anthropic.com/oauth/code/callback",
                "code_verifier": flow.verifier,
            }
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    "https://console.anthropic.com/v1/oauth/token",
                    json=data,
                    headers={"Content-Type": "application/json"},
                )
            if resp.status_code != 200:
                raise ValueError(resp.text)
            payload = resp.json()
            access_token = payload.get("access_token")
            refresh_token = payload.get("refresh_token")
            expires_in = payload.get("expires_in")
            if not access_token or not refresh_token or not isinstance(expires_in, int):
                raise ValueError("Invalid token response")
            expires_at = _expires_at_from_seconds(expires_in)
            with db_session() as sess:
                save_provider_oauth(
                    sess,
                    provider=flow.provider,
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_type="Bearer",
                    expires_at=expires_at,
                )
            flow.status = "authenticated"
        except Exception as e:
            flow.status = "error"
            flow.error = str(e)

    async def _start_openai_codex(self, flow: OAuthFlowState) -> None:
        verifier, challenge = _generate_pkce()
        flow.verifier = verifier
        flow.state = secrets.token_hex(16)
        params = {
            "response_type": "code",
            "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
            "redirect_uri": "http://localhost:1455/auth/callback",
            "scope": "openid profile email offline_access",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": flow.state,
            "id_token_add_organizations": "true",
            "codex_cli_simplified_flow": "true",
            "originator": "agno",
        }
        flow.auth_url = f"https://auth.openai.com/oauth/authorize?{urlencode(params)}"
        flow.instructions = "Complete login in the browser, then return here"
        flow.code_future = asyncio.get_event_loop().create_future()
        flow.callback_server = self._start_callback_server(
            flow,
            port=1455,
            path="/auth/callback",
        )
        flow.flow_task = asyncio.create_task(self._finish_openai_codex(flow))

    async def _finish_openai_codex(self, flow: OAuthFlowState) -> None:
        try:
            if not flow.code_future:
                raise ValueError("Missing authorization code")
            code_future = flow.code_future
            code, state = await asyncio.wait_for(
                code_future, timeout=CALLBACK_TIMEOUT_S
            )
            if flow.state and state and state != flow.state:
                raise ValueError("State mismatch")
            data = {
                "grant_type": "authorization_code",
                "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
                "code": code,
                "code_verifier": flow.verifier,
                "redirect_uri": "http://localhost:1455/auth/callback",
            }
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    "https://auth.openai.com/oauth/token",
                    data=data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            if resp.status_code != 200:
                raise ValueError(resp.text)
            payload = resp.json()
            access_token = payload.get("access_token")
            refresh_token = payload.get("refresh_token")
            expires_in = payload.get("expires_in")
            if not access_token or not refresh_token or not isinstance(expires_in, int):
                raise ValueError("Invalid token response")
            account_id = self._get_openai_account_id(access_token)
            if not account_id:
                raise ValueError("Missing account id")
            expires_at = _expires_at_from_seconds(expires_in)
            with db_session() as sess:
                save_provider_oauth(
                    sess,
                    provider=flow.provider,
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_type="Bearer",
                    expires_at=expires_at,
                    extra={"accountId": account_id},
                )
            flow.status = "authenticated"
        except Exception as e:
            flow.status = "error"
            flow.error = str(e)
        finally:
            if flow.callback_server:
                flow.callback_server.stop()

    async def _start_github_copilot(
        self, flow: OAuthFlowState, options: Dict[str, Any]
    ) -> None:
        enterprise_domain = options.get("enterpriseDomain")
        if enterprise_domain:
            normalized = self._normalize_github_domain(enterprise_domain)
            if not normalized:
                flow.status = "error"
                flow.error = "Invalid GitHub Enterprise domain"
                return
            enterprise_domain = normalized
        flow.extra["enterpriseDomain"] = enterprise_domain
        domain = enterprise_domain or "github.com"
        device = await self._github_device_code(domain)
        flow.extra["deviceCode"] = device.get("device_code")
        flow.extra["interval"] = device.get("interval")
        flow.extra["expiresIn"] = device.get("expires_in")
        flow.auth_url = device.get("verification_uri")
        user_code = device.get("user_code")
        flow.instructions = f"Enter code: {user_code}" if user_code else None
        flow.flow_task = asyncio.create_task(self._finish_github_copilot(flow))

    async def _finish_github_copilot(self, flow: OAuthFlowState) -> None:
        try:
            domain = flow.extra.get("enterpriseDomain") or "github.com"
            device_code = flow.extra.get("deviceCode")
            interval = flow.extra.get("interval")
            expires_in = flow.extra.get("expiresIn")
            if not device_code or not interval or not expires_in:
                raise ValueError("Missing device flow details")
            access_token = await self._poll_github_access_token(
                domain,
                device_code,
                int(interval),
                int(expires_in),
            )
            token_payload = await self._fetch_copilot_token(domain, access_token)
            copilot_token = token_payload["token"]
            expires_at = datetime.fromtimestamp(token_payload["expires_at"]).isoformat()
            base_url = self._get_copilot_base_url(copilot_token, domain)
            with db_session() as sess:
                save_provider_oauth(
                    sess,
                    provider=flow.provider,
                    access_token=copilot_token,
                    refresh_token=access_token,
                    token_type="Bearer",
                    expires_at=expires_at,
                    extra={
                        "enterpriseDomain": flow.extra.get("enterpriseDomain"),
                        "baseUrl": base_url,
                    },
                )
            flow.status = "authenticated"
        except Exception as e:
            flow.status = "error"
            flow.error = str(e)

    async def _start_google_gemini(self, flow: OAuthFlowState) -> None:
        verifier, challenge = _generate_pkce()
        flow.verifier = verifier
        flow.state = verifier
        params = {
            "client_id": _decode_base64(
                "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t"
            ),
            "response_type": "code",
            "redirect_uri": "http://localhost:8085/oauth2callback",
            "scope": " ".join(
                [
                    "https://www.googleapis.com/auth/cloud-platform",
                    "https://www.googleapis.com/auth/userinfo.email",
                    "https://www.googleapis.com/auth/userinfo.profile",
                ]
            ),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": verifier,
            "access_type": "offline",
            "prompt": "consent",
        }
        flow.auth_url = (
            f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
        )
        flow.instructions = "Complete the sign-in in your browser"
        flow.code_future = asyncio.get_event_loop().create_future()
        flow.callback_server = self._start_callback_server(
            flow,
            port=8085,
            path="/oauth2callback",
        )
        flow.flow_task = asyncio.create_task(self._finish_google_gemini(flow))

    async def _finish_google_gemini(self, flow: OAuthFlowState) -> None:
        try:
            if not flow.code_future:
                raise ValueError("Missing authorization code")
            code_future = flow.code_future
            code, state = await asyncio.wait_for(
                code_future, timeout=CALLBACK_TIMEOUT_S
            )
            if flow.state and state and state != flow.state:
                raise ValueError("State mismatch")
            token = await self._exchange_google_token(
                code=code,
                verifier=flow.verifier,
                client_id=_decode_base64(
                    "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t"
                ),
                client_secret=_decode_base64(
                    "R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw="
                ),
                redirect_uri="http://localhost:8085/oauth2callback",
            )
            email = await self._get_google_user_email(token["access_token"])
            project_id = await self._discover_gemini_project(token["access_token"])
            expires_at = _expires_at_from_seconds(token["expires_in"])
            with db_session() as sess:
                save_provider_oauth(
                    sess,
                    provider=flow.provider,
                    access_token=token["access_token"],
                    refresh_token=token["refresh_token"],
                    token_type="Bearer",
                    expires_at=expires_at,
                    extra={"projectId": project_id, "email": email},
                )
            flow.status = "authenticated"
        except Exception as e:
            flow.status = "error"
            flow.error = str(e)
        finally:
            if flow.callback_server:
                flow.callback_server.stop()

    def _start_callback_server(
        self, flow: OAuthFlowState, *, port: int, path: str
    ) -> _CallbackServer:
        loop = asyncio.get_event_loop()

        def handle_code(code: str, state: str) -> None:
            if flow.code_future and not flow.code_future.done():
                loop.call_soon_threadsafe(flow.code_future.set_result, (code, state))

        def handle_error(error: str) -> None:
            flow.error = error
            flow.status = "error"

        server = _CallbackServer(
            port=port,
            path=path,
            expected_state=flow.state,
            on_code=handle_code,
            on_error=handle_error,
        )
        try:
            server.start()
        except Exception as e:
            flow.error = str(e)
            flow.status = "error"
        return server

    def _parse_manual_input(
        self, provider: str, input_value: str
    ) -> tuple[Optional[str], Optional[str]]:
        code, state = _parse_url_params(input_value)
        if code:
            return code, state
        if provider == "anthropic":
            return _parse_code_state(input_value)
        return _parse_code_state(input_value)

    def _get_openai_account_id(self, access_token: str) -> Optional[str]:
        payload = _decode_jwt_payload(access_token)
        if not payload:
            return None
        claim = payload.get("https://api.openai.com/auth")
        if isinstance(claim, dict):
            account_id = claim.get("chatgpt_account_id")
            if isinstance(account_id, str) and account_id:
                return account_id
        return None

    async def _exchange_google_token(
        self,
        *,
        code: str,
        verifier: Optional[str],
        client_id: str,
        client_secret: str,
        redirect_uri: str,
    ) -> Dict[str, Any]:
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code != 200:
            raise ValueError(resp.text)
        payload = resp.json()
        if not payload.get("refresh_token"):
            raise ValueError("No refresh token received")
        return payload

    async def _get_google_user_email(self, access_token: str) -> Optional[str]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        email = data.get("email")
        return email if isinstance(email, str) else None

    async def _discover_gemini_project(self, access_token: str) -> str:
        env_project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get(
            "GOOGLE_CLOUD_PROJECT_ID"
        )
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "gl-node/22.17.0",
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            load_resp = await client.post(
                "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
                headers=headers,
                json={
                    "cloudaicompanionProject": env_project,
                    "metadata": {
                        "ideType": "IDE_UNSPECIFIED",
                        "platform": "PLATFORM_UNSPECIFIED",
                        "pluginType": "GEMINI",
                        "duetProject": env_project,
                    },
                },
            )
        if load_resp.status_code == 200:
            data = load_resp.json()
        else:
            data = None

        current_tier = data.get("currentTier") if isinstance(data, dict) else None
        if current_tier:
            project = (
                data.get("cloudaicompanionProject") if isinstance(data, dict) else None
            )
            if project:
                return project
            if env_project:
                return env_project
            raise ValueError(
                "Missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID for this account"
            )

        allowed = data.get("allowedTiers") if isinstance(data, dict) else None
        tier_id = "legacy-tier"
        if isinstance(allowed, list):
            default_tier = next(
                (
                    tier
                    for tier in allowed
                    if isinstance(tier, dict) and tier.get("isDefault")
                ),
                None,
            )
            if default_tier and default_tier.get("id"):
                tier_id = default_tier["id"]

        if tier_id != "free-tier" and not env_project:
            raise ValueError(
                "Missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID for this account"
            )

        onboard_body: Dict[str, Any] = {
            "tierId": tier_id,
            "metadata": {
                "ideType": "IDE_UNSPECIFIED",
                "platform": "PLATFORM_UNSPECIFIED",
                "pluginType": "GEMINI",
            },
        }
        if tier_id != "free-tier" and env_project:
            onboard_body["cloudaicompanionProject"] = env_project
            onboard_body["metadata"]["duetProject"] = env_project

        async with httpx.AsyncClient(timeout=20.0) as client:
            onboard_resp = await client.post(
                "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
                headers=headers,
                json=onboard_body,
            )
            if onboard_resp.status_code != 200:
                raise ValueError(onboard_resp.text)
            lro = onboard_resp.json()
            if not lro.get("done") and lro.get("name"):
                lro = await self._poll_google_operation(lro["name"], headers)

        project = None
        if isinstance(lro, dict):
            response = lro.get("response")
            if isinstance(response, dict):
                project = response.get("cloudaicompanionProject", {}).get("id")
        if project:
            return project
        if env_project:
            return env_project
        raise ValueError("Could not provision a project")

    async def _poll_google_operation(
        self, name: str, headers: Dict[str, str]
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            while True:
                resp = await client.get(
                    f"https://cloudcode-pa.googleapis.com/v1internal/{name}",
                    headers=headers,
                )
                if resp.status_code != 200:
                    raise ValueError(resp.text)
                data = resp.json()
                if data.get("done"):
                    return data
                await asyncio.sleep(5)

    async def _github_device_code(self, domain: str) -> Dict[str, Any]:
        client_id = _decode_base64("SXYxLmI1MDdhMDhjODdlY2ZlOTg=")
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"https://{domain}/login/device/code",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": "GitHubCopilotChat/0.35.0",
                },
                json={"client_id": client_id, "scope": "read:user"},
            )
        if resp.status_code != 200:
            raise ValueError(resp.text)
        return resp.json()

    async def _poll_github_access_token(
        self, domain: str, device_code: str, interval: int, expires_in: int
    ) -> str:
        deadline = time.time() + expires_in
        interval_ms = max(1, interval)
        client_id = _decode_base64("SXYxLmI1MDdhMDhjODdlY2ZlOTg=")
        async with httpx.AsyncClient(timeout=20.0) as client:
            while time.time() < deadline:
                resp = await client.post(
                    f"https://{domain}/login/oauth/access_token",
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "User-Agent": "GitHubCopilotChat/0.35.0",
                    },
                    json={
                        "client_id": client_id,
                        "device_code": device_code,
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("access_token"):
                        return data["access_token"]
                    error = data.get("error")
                    if error == "authorization_pending":
                        await asyncio.sleep(interval_ms)
                        continue
                    if error == "slow_down":
                        interval_ms += 5
                        await asyncio.sleep(interval_ms)
                        continue
                    if error:
                        raise ValueError(error)
                await asyncio.sleep(interval_ms)
        raise ValueError("Device flow timed out")

    async def _fetch_copilot_token(
        self, domain: str, access_token: str
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"https://api.{domain}/copilot_internal/v2/token",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": "GitHubCopilotChat/0.35.0",
                    "Editor-Version": "vscode/1.107.0",
                    "Editor-Plugin-Version": "copilot-chat/0.35.0",
                    "Copilot-Integration-Id": "vscode-chat",
                },
            )
        if resp.status_code != 200:
            raise ValueError(resp.text)
        return resp.json()

    def _get_copilot_base_url(self, token: str, domain: str) -> str:
        match = None
        if "proxy-ep=" in token:
            parts = token.split(";")
            for part in parts:
                if part.startswith("proxy-ep="):
                    match = part.split("=", 1)[1]
                    break
        if match:
            return f"https://{match.replace('proxy.', 'api.', 1)}"
        if domain and domain != "github.com":
            return f"https://copilot-api.{domain}"
        return "https://api.individual.githubcopilot.com"

    def _normalize_github_domain(self, value: str) -> Optional[str]:
        trimmed = value.strip()
        if not trimmed:
            return None
        try:
            parsed = urlparse(trimmed if "://" in trimmed else f"https://{trimmed}")
            return parsed.hostname
        except Exception:
            return None

    def _refresh_anthropic(self, refresh_token: str) -> Optional[Dict[str, Any]]:
        payload = {
            "grant_type": "refresh_token",
            "client_id": _decode_base64(
                "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl"
            ),
            "refresh_token": refresh_token,
        }
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                "https://console.anthropic.com/v1/oauth/token",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        access_token = data.get("access_token")
        new_refresh = data.get("refresh_token") or refresh_token
        expires_in = data.get("expires_in")
        if not access_token or not isinstance(expires_in, int):
            return None
        expires_at = _expires_at_from_seconds(expires_in)
        with db_session() as sess:
            save_provider_oauth(
                sess,
                provider="anthropic_oauth",
                access_token=access_token,
                refresh_token=new_refresh,
                token_type="Bearer",
                expires_at=expires_at,
            )
        return {
            "access_token": access_token,
            "refresh_token": new_refresh,
            "expires_at": expires_at,
        }

    def _refresh_openai_codex(self, refresh_token: str) -> Optional[Dict[str, Any]]:
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
        }
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                "https://auth.openai.com/oauth/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code != 200:
            return None
        payload = resp.json()
        access_token = payload.get("access_token")
        new_refresh = payload.get("refresh_token") or refresh_token
        expires_in = payload.get("expires_in")
        if not access_token or not isinstance(expires_in, int):
            return None
        account_id = self._get_openai_account_id(access_token)
        if not account_id:
            return None
        expires_at = _expires_at_from_seconds(expires_in)
        with db_session() as sess:
            save_provider_oauth(
                sess,
                provider="openai_codex",
                access_token=access_token,
                refresh_token=new_refresh,
                token_type="Bearer",
                expires_at=expires_at,
                extra={"accountId": account_id},
            )
        return {
            "access_token": access_token,
            "refresh_token": new_refresh,
            "expires_at": expires_at,
            "extra": {"accountId": account_id},
        }

    def _refresh_github_copilot(
        self, refresh_token: str, extra: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        domain = None
        if isinstance(extra, dict):
            domain = extra.get("enterpriseDomain")
        domain = domain or "github.com"
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(
                f"https://api.{domain}/copilot_internal/v2/token",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {refresh_token}",
                    "User-Agent": "GitHubCopilotChat/0.35.0",
                    "Editor-Version": "vscode/1.107.0",
                    "Editor-Plugin-Version": "copilot-chat/0.35.0",
                    "Copilot-Integration-Id": "vscode-chat",
                },
            )
        if resp.status_code != 200:
            return None
        payload = resp.json()
        token = payload.get("token")
        expires_at_raw = payload.get("expires_at")
        if not token or not isinstance(expires_at_raw, int):
            return None
        expires_at = datetime.fromtimestamp(expires_at_raw).isoformat()
        base_url = self._get_copilot_base_url(token, domain)
        with db_session() as sess:
            save_provider_oauth(
                sess,
                provider="github_copilot",
                access_token=token,
                refresh_token=refresh_token,
                token_type="Bearer",
                expires_at=expires_at,
                extra={"enterpriseDomain": domain, "baseUrl": base_url},
            )
        return {
            "access_token": token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "extra": {"enterpriseDomain": domain, "baseUrl": base_url},
        }

    def _refresh_google_gemini(
        self, refresh_token: str, extra: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        project_id = extra.get("projectId") if isinstance(extra, dict) else None
        if not project_id:
            return None
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": _decode_base64(
                        "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t"
                    ),
                    "client_secret": _decode_base64(
                        "R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw="
                    ),
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code != 200:
            return None
        payload = resp.json()
        access_token = payload.get("access_token")
        expires_in = payload.get("expires_in")
        if not access_token or not isinstance(expires_in, int):
            return None
        expires_at = _expires_at_from_seconds(expires_in)
        with db_session() as sess:
            save_provider_oauth(
                sess,
                provider="google_gemini_cli",
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="Bearer",
                expires_at=expires_at,
                extra={"projectId": project_id},
            )
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "extra": {"projectId": project_id},
        }


_provider_oauth_manager: ProviderOAuthManager | None = None


def get_provider_oauth_manager() -> ProviderOAuthManager:
    global _provider_oauth_manager
    if _provider_oauth_manager is None:
        _provider_oauth_manager = ProviderOAuthManager()
    return _provider_oauth_manager
