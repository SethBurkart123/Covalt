from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from pydantic import AnyUrl

from mcp.client.auth import OAuthClientProvider, TokenStorage
from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthToken

from ..crypto import decrypt, encrypt
from ..db import db_session
from ..db.models import OAuthToken as OAuthTokenModel
from .oauth_shared import (
    OAuthStatus,
    PendingOAuthCallbacks,
    build_localhost_redirect_uri,
    extract_state_from_auth_url,
)

logger = logging.getLogger(__name__)

AuthHint = Literal["oauth", "token"]

OAUTH_CALLBACK_PORT = 3000
AUTH_URL_TIMEOUT_S = 30
CALLBACK_TIMEOUT_S = 300


class OAuthError(Exception):
    def __init__(self, error: str, description: str | None = None):
        self.error = error
        self.description = description
        super().__init__(f"{error}: {description}" if description else error)


_pending_callbacks = PendingOAuthCallbacks(
    error_factory=lambda error, description: OAuthError(error, description)
)


@dataclass
class OAuthFlowState:
    server_id: str
    toolset_id: str
    server_url: str
    status: OAuthStatus = "pending"
    error: str | None = None
    auth_url: str | None = None
    state: str | None = None
    callback_future: asyncio.Future[tuple[str, str | None]] | None = None


class DatabaseTokenStorage(TokenStorage):
    def __init__(self, server_id: str, toolset_id: str) -> None:
        self.server_id = server_id
        self.toolset_id = toolset_id

    async def get_tokens(self) -> OAuthToken | None:
        with db_session() as sess:
            row = (
                sess.query(OAuthTokenModel)
                .filter(OAuthTokenModel.server_id == self.server_id)
                .filter(OAuthTokenModel.toolset_id == self.toolset_id)
                .first()
            )

            if not row:
                return None

            try:
                access_token = decrypt(row.access_token)
                if not access_token:
                    return None

                refresh_token = (
                    decrypt(row.refresh_token) if row.refresh_token else None
                )

                return OAuthToken(
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_type=row.token_type or "Bearer",
                    expires_in=None,
                    scope=row.scope,
                )
            except Exception as e:
                logger.error(f"Failed to load tokens for {self.server_id}: {e}")
                return None

    async def set_tokens(self, tokens: OAuthToken) -> None:
        now = datetime.now().isoformat()
        expires_at = (
            (datetime.now() + timedelta(seconds=tokens.expires_in)).isoformat()
            if tokens.expires_in
            else None
        )

        with db_session() as sess:
            existing = (
                sess.query(OAuthTokenModel)
                .filter(OAuthTokenModel.server_id == self.server_id)
                .filter(OAuthTokenModel.toolset_id == self.toolset_id)
                .first()
            )

            if existing:
                existing.access_token = encrypt(tokens.access_token)
                existing.refresh_token = (
                    encrypt(tokens.refresh_token) if tokens.refresh_token else None
                )
                existing.token_type = tokens.token_type or "Bearer"
                existing.expires_at = expires_at
                existing.scope = tokens.scope
                existing.updated_at = now
            else:
                sess.add(
                    OAuthTokenModel(
                        id=str(uuid.uuid4()),
                        server_id=self.server_id,
                        toolset_id=self.toolset_id,
                        access_token=encrypt(tokens.access_token),
                        refresh_token=encrypt(tokens.refresh_token)
                        if tokens.refresh_token
                        else None,
                        token_type=tokens.token_type or "Bearer",
                        expires_at=expires_at,
                        scope=tokens.scope,
                        created_at=now,
                        updated_at=now,
                    )
                )

            sess.commit()

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        with db_session() as sess:
            row = (
                sess.query(OAuthTokenModel)
                .filter(OAuthTokenModel.server_id == self.server_id)
                .filter(OAuthTokenModel.toolset_id == self.toolset_id)
                .first()
            )

            if not row:
                return None

            try:
                if row.client_metadata:
                    return OAuthClientInformationFull.model_validate_json(
                        row.client_metadata
                    )

                if not row.client_id:
                    return None

                return OAuthClientInformationFull(
                    client_id=row.client_id,
                    client_secret=decrypt(row.client_secret)
                    if row.client_secret
                    else None,
                    redirect_uris=[
                        AnyUrl(build_localhost_redirect_uri(OAUTH_CALLBACK_PORT))
                    ],
                )
            except Exception as e:
                logger.error(f"Failed to load client info for {self.server_id}: {e}")
                return None

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        now = datetime.now().isoformat()
        metadata_json = client_info.model_dump_json()

        with db_session() as sess:
            existing = (
                sess.query(OAuthTokenModel)
                .filter(OAuthTokenModel.server_id == self.server_id)
                .filter(OAuthTokenModel.toolset_id == self.toolset_id)
                .first()
            )

            if existing:
                existing.client_id = client_info.client_id
                existing.client_secret = (
                    encrypt(client_info.client_secret)
                    if client_info.client_secret
                    else None
                )
                existing.client_metadata = metadata_json
                existing.updated_at = now
            else:
                sess.add(
                    OAuthTokenModel(
                        id=str(uuid.uuid4()),
                        server_id=self.server_id,
                        toolset_id=self.toolset_id,
                        access_token=encrypt(""),
                        client_id=client_info.client_id,
                        client_secret=encrypt(client_info.client_secret)
                        if client_info.client_secret
                        else None,
                        client_metadata=metadata_json,
                        created_at=now,
                        updated_at=now,
                    )
                )

            sess.commit()


def _extract_provider_name(url: str) -> str | None:
    host = urlparse(url).hostname or ""
    providers = {
        "notion": "Notion",
        "linear": "Linear",
        "github": "GitHub",
        "slack": "Slack",
        "google": "Google",
    }
    for key, name in providers.items():
        if key in host:
            return name
    parts = host.split(".")
    return parts[-2].title() if len(parts) >= 2 else None


async def _auth_hint(
    client: httpx.AsyncClient, server_url: str, www_auth: str
) -> AuthHint:
    match = re.search(r'resource_metadata="([^"]+)"', www_auth)
    resource_metadata_url = match.group(1) if match else None

    if not resource_metadata_url:
        parsed = urlparse(server_url)
        resource_metadata_url = (
            f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource"
        )

    try:
        resp = await client.get(resource_metadata_url, timeout=5.0)
        if resp.status_code != 200:
            return "token"
        resource_meta = resp.json()
        auth_servers = resource_meta.get("authorization_servers", [])
        if not auth_servers:
            return "token"

        auth_server_url = auth_servers[0].rstrip("/") + "/"
        as_metadata_url = f"{auth_server_url}.well-known/oauth-authorization-server"
        resp = await client.get(as_metadata_url, timeout=5.0)
        if resp.status_code != 200:
            as_metadata_url = f"{auth_server_url}.well-known/openid-configuration"
            resp = await client.get(as_metadata_url, timeout=5.0)
            if resp.status_code != 200:
                return "token"

        as_meta = resp.json()
        return "oauth" if as_meta.get("registration_endpoint") else "token"
    except Exception:
        return "token"


class OAuthManager:
    def __init__(self) -> None:
        self._active_flows: dict[str, OAuthFlowState] = {}

    async def probe_oauth_requirement(self, url: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(
                follow_redirects=False, timeout=10.0
            ) as client:
                response = await client.get(url)
                if response.status_code != 401:
                    return {"requiresOAuth": False, "statusCode": response.status_code}

                www_auth = response.headers.get("WWW-Authenticate", "")
                if "Bearer" not in www_auth:
                    return {"requiresOAuth": False, "statusCode": response.status_code}

                match = re.search(r'resource_metadata="([^"]+)"', www_auth)
                resource_metadata_url = match.group(1) if match else None

                return {
                    "requiresOAuth": True,
                    "providerName": _extract_provider_name(url),
                    "resourceMetadataUrl": resource_metadata_url,
                    "authHint": await _auth_hint(client, url, www_auth),
                }
        except Exception as e:
            logger.error(f"Error probing OAuth for {url}: {e}")
            return {"requiresOAuth": False, "error": str(e)}

    async def start_oauth_flow(
        self,
        server_key: str,
        server_id: str,
        toolset_id: str,
        server_url: str,
        callback_port: int = OAUTH_CALLBACK_PORT,
    ) -> dict[str, Any]:
        flow = OAuthFlowState(
            server_id=server_id,
            toolset_id=toolset_id,
            server_url=server_url,
            status="pending",
        )
        self._active_flows[server_key] = flow

        auth_url_ready = asyncio.Event()
        redirect_uri = build_localhost_redirect_uri(callback_port)
        storage = DatabaseTokenStorage(server_id, toolset_id)

        async def redirect_handler(auth_url: str) -> None:
            flow.auth_url = auth_url
            flow.state = extract_state_from_auth_url(auth_url)
            if not flow.state:
                flow.status = "error"
                flow.error = "Missing state"
                auth_url_ready.set()
                return
            flow.callback_future = _pending_callbacks.create(flow.state)
            auth_url_ready.set()

        async def callback_handler() -> tuple[str, str | None]:
            if not flow.callback_future:
                raise OAuthError("no_pending", "No pending callback")
            return await asyncio.wait_for(
                flow.callback_future, timeout=CALLBACK_TIMEOUT_S
            )

        oauth_provider = OAuthClientProvider(
            server_url=server_url,
            client_metadata=OAuthClientMetadata(
                client_name="Covalt Desktop",
                redirect_uris=[AnyUrl(redirect_uri)],
                grant_types=["authorization_code", "refresh_token"],
                response_types=["code"],
            ),
            storage=storage,
            redirect_handler=redirect_handler,
            callback_handler=callback_handler,
        )

        async def run() -> None:
            try:
                async with httpx.AsyncClient(
                    auth=oauth_provider, follow_redirects=True
                ) as client:
                    await client.get(server_url, timeout=600.0)
                flow.status = "authenticated"
            except Exception as e:
                flow.status = "error"
                flow.error = str(e)

        asyncio.create_task(run())

        await asyncio.wait_for(auth_url_ready.wait(), timeout=AUTH_URL_TIMEOUT_S)
        if not flow.auth_url:
            raise OAuthError("no_auth_url", flow.error or "Failed to generate auth URL")

        return {"authUrl": flow.auth_url, "state": flow.state}

    def get_oauth_status(
        self, server_key: str, server_id: str, toolset_id: str
    ) -> dict[str, Any]:
        flow = self._active_flows.get(server_key)
        if flow:
            has_tokens = self.has_valid_tokens(server_id, toolset_id)
            return {"status": flow.status, "hasTokens": has_tokens, "error": flow.error}
        has_tokens = self.has_valid_tokens(server_id, toolset_id)
        return {
            "status": "authenticated" if has_tokens else "none",
            "hasTokens": has_tokens,
        }

    async def revoke_oauth(
        self, server_key: str, server_id: str, toolset_id: str
    ) -> None:
        flow = self._active_flows.pop(server_key, None)
        if flow and flow.state:
            _pending_callbacks.cancel(flow.state)

        with db_session() as sess:
            sess.query(OAuthTokenModel).filter(
                OAuthTokenModel.server_id == server_id,
                OAuthTokenModel.toolset_id == toolset_id,
            ).delete()
            sess.commit()

    def has_valid_tokens(self, server_id: str, toolset_id: str) -> bool:
        with db_session() as sess:
            token = (
                sess.query(OAuthTokenModel)
                .filter(OAuthTokenModel.server_id == server_id)
                .filter(OAuthTokenModel.toolset_id == toolset_id)
                .first()
            )
            if not token or not token.access_token:
                return False

            try:
                if not decrypt(token.access_token):
                    return False
            except Exception:
                return False

            if token.expires_at:
                try:
                    if datetime.fromisoformat(token.expires_at) < datetime.now():
                        return False
                except Exception:
                    return False

            return True

    def create_oauth_provider(
        self, server_id: str, toolset_id: str, server_url: str
    ) -> OAuthClientProvider:
        storage = DatabaseTokenStorage(server_id, toolset_id)

        async def noop_redirect_handler(_: str) -> None:
            pass

        async def noop_callback_handler() -> tuple[str, str | None]:
            raise OAuthError("no_callback", "Callback handler should not be called")

        return OAuthClientProvider(
            server_url=server_url,
            client_metadata=OAuthClientMetadata(
                client_name="Covalt Desktop",
                redirect_uris=[
                    AnyUrl(build_localhost_redirect_uri(OAUTH_CALLBACK_PORT))
                ],
                grant_types=["authorization_code", "refresh_token"],
                response_types=["code"],
            ),
            storage=storage,
            redirect_handler=noop_redirect_handler,
            callback_handler=noop_callback_handler,
        )

    def complete_oauth_callback(self, code: str, state: str) -> bool:
        return _pending_callbacks.complete(code, state)

    def fail_oauth_callback(
        self, state: str, error: str, description: str | None = None
    ) -> bool:
        return _pending_callbacks.fail(state, error, description)


_oauth_manager: OAuthManager | None = None


def get_oauth_manager() -> OAuthManager:
    global _oauth_manager
    if _oauth_manager is None:
        _oauth_manager = OAuthManager()
    return _oauth_manager
