"""Shared node type identifiers for backend services.

Keeping node type strings centralized avoids scattering hardcoded literals across
core service modules.
"""

from __future__ import annotations

CHAT_START_NODE_TYPE = "chat-start"
AGENT_NODE_TYPE = "agent"
WEBHOOK_TRIGGER_NODE_TYPE = "webhook-trigger"
WEBHOOK_END_NODE_TYPE = "webhook-end"
REROUTE_NODE_TYPE = "reroute"
