from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel
from zynk import command

from ..services.provider_oauth_manager import get_provider_oauth_manager


class ProviderOAuthId(BaseModel):
    provider: str


class StartProviderOAuthInput(BaseModel):
    provider: str
    enterpriseDomain: Optional[str] = None


class StartProviderOAuthResult(BaseModel):
    success: bool
    authUrl: Optional[str] = None
    instructions: Optional[str] = None
    status: Optional[Literal["none", "pending", "authenticated", "error"]] = None
    error: Optional[str] = None


@command
async def start_provider_oauth(
    body: StartProviderOAuthInput,
) -> StartProviderOAuthResult:
    try:
        result = await get_provider_oauth_manager().start_oauth(
            body.provider,
            options={"enterpriseDomain": body.enterpriseDomain},
        )
        return StartProviderOAuthResult(
            success=True,
            authUrl=result.get("authUrl"),
            instructions=result.get("instructions"),
            status=result.get("status"),
            error=result.get("error"),
        )
    except Exception as e:
        return StartProviderOAuthResult(success=False, error=str(e))


class ProviderOAuthStatusResult(BaseModel):
    status: Literal["none", "pending", "authenticated", "error"]
    hasTokens: bool = False
    authUrl: Optional[str] = None
    instructions: Optional[str] = None
    error: Optional[str] = None


@command
async def get_provider_oauth_status(body: ProviderOAuthId) -> ProviderOAuthStatusResult:
    result = get_provider_oauth_manager().get_oauth_status(body.provider)
    return ProviderOAuthStatusResult(
        status=result.get("status", "none"),
        hasTokens=result.get("hasTokens", False),
        authUrl=result.get("authUrl"),
        instructions=result.get("instructions"),
        error=result.get("error"),
    )


class ProviderOAuthCodeInput(BaseModel):
    provider: str
    code: str


class ProviderOAuthCodeResult(BaseModel):
    success: bool
    error: Optional[str] = None


@command
async def submit_provider_oauth_code(
    body: ProviderOAuthCodeInput,
) -> ProviderOAuthCodeResult:
    ok = get_provider_oauth_manager().submit_oauth_code(body.provider, body.code)
    return ProviderOAuthCodeResult(
        success=ok,
        error=None if ok else "No pending OAuth flow found for this provider",
    )


class RevokeProviderOAuthResult(BaseModel):
    success: bool
    error: Optional[str] = None


@command
async def revoke_provider_oauth(body: ProviderOAuthId) -> RevokeProviderOAuthResult:
    try:
        await get_provider_oauth_manager().revoke_oauth(body.provider)
        return RevokeProviderOAuthResult(success=True)
    except Exception as e:
        return RevokeProviderOAuthResult(success=False, error=str(e))
