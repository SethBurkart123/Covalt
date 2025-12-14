from __future__ import annotations

# Simply import command modules to register them
from . import branches, chats, streaming, system

__all__ = ["system", "chats", "streaming", "branches"]
