from __future__ import annotations

import threading
from typing import Any, Callable, Dict, Optional
from agno.agent import Agent
from ..models.chat import ChatEvent

class ToolHookManager:
    """
    Manages tool metadata and provides pre/post hooks for enhancement.
    
    This is the magic layer that adds approval gates and custom renderers
    without tools needing to know about any of it.
    """
    
    def __init__(self):
        self._tool_metadata: Dict[str, Dict[str, Any]] = {}
        self._pending_approvals: Dict[str, Dict[str, Any]] = {}
        self._approval_events: Dict[str, threading.Event] = {}
        self._approval_responses: Dict[str, Dict[str, Any]] = {}
        self._tool_approval_info: Dict[str, Dict[str, str]] = {}  # tool_key -> {status, approval_id}
    
    def register_tool_metadata(
        self,
        tool_id: str,
        requires_approval: bool = False,
        allow_edit: bool = False,
        renderer: Optional[str] = None,
    ):
        """Register enhancement metadata for a tool."""
        self._tool_metadata[tool_id] = {
            "requires_approval": requires_approval,
            "allow_edit": allow_edit,
            "renderer": renderer,
        }
    
    def get_tool_metadata(self, tool_name: str) -> Dict[str, Any]:
        """Get metadata for a tool by its name."""
        return self._tool_metadata.get(tool_name, {})
    
    def create_pre_hook(self, channel=None, assistant_msg_id: str = None, app_handle=None):
        """
        Create a pre-hook that handles approval gates and renderer metadata.
        
        This hook runs BEFORE the tool executes. If the tool requires approval,
        it sends an event to the frontend and blocks until the user responds.
        It also stores renderer metadata for the streaming handler.
        """
        def pre_hook(
            agent: Agent,
            function_name: str,
            function_call: Callable,
            arguments: Dict[str, Any]
        ):
            metadata = self.get_tool_metadata(function_name)
            
            if metadata.get("requires_approval"):
                # Generate unique approval ID
                approval_id = f"{assistant_msg_id}-approval-{function_name}"
                tool_key = f"{function_name}:{str(arguments)}"
                
                # Create threading event for blocking
                approval_event = threading.Event()
                self._approval_events[approval_id] = approval_event
                
                # Store pending approval info
                self._pending_approvals[approval_id] = {
                    "function_name": function_name,
                    "arguments": arguments,
                    "allow_edit": metadata.get("allow_edit", False),
                    "tool_key": tool_key,
                }
                
                # Mark as pending
                self._tool_approval_info[tool_key] = {
                    "status": "pending",
                    "approval_id": approval_id
                }
                
                # Send approval request to frontend
                if channel:
                    channel.send_model(ChatEvent(
                        event="ToolApprovalRequired",
                        tool={
                            "approvalId": approval_id,
                            "toolName": function_name,
                            "toolArgs": arguments,
                            "allowEdit": metadata.get("allow_edit", False),
                        }
                    ))
                
                # Block and wait for approval (with timeout)
                approved = approval_event.wait(timeout=300)  # 5 minute timeout
                
                if not approved:
                    # Timeout - auto-deny
                    self._tool_approval_info[tool_key]["status"] = "denied"
                    self._cleanup_approval(approval_id)
                    return "The tool was denied by the user"
                
                # Get approval response
                response = self._approval_responses.get(approval_id, {})
                self._cleanup_approval(approval_id)
                
                if not response.get("approved"):
                    self._tool_approval_info[tool_key]["status"] = "denied"
                    return "The tool was denied by the user"
                
                # Approved!
                self._tool_approval_info[tool_key]["status"] = "approved"
                
                # If user edited arguments, use those instead
                edited_args = response.get("edited_args")
                if edited_args:
                    arguments = edited_args
            
            # Execute the tool
            result = function_call(**arguments)
            
            # Store renderer metadata for streaming handler to access
            if metadata.get("renderer"):
                tool_key = f"{function_name}:{str(arguments)}"
                if not hasattr(agent, "_tool_renderer_metadata"):
                    agent._tool_renderer_metadata = {}
                agent._tool_renderer_metadata[tool_key] = {
                    "renderer": metadata.get("renderer")
                }
            
            return result
        
        return pre_hook
    
    
    def set_approval_response(self, approval_id: str, approved: bool, edited_args: Optional[Dict] = None):
        """
        Set the approval response from the frontend.
        
        This unblocks the waiting pre-hook.
        """
        self._approval_responses[approval_id] = {
            "approved": approved,
            "edited_args": edited_args,
        }
        
        # Unblock the waiting thread
        event = self._approval_events.get(approval_id)
        if event:
            event.set()
    
    def _cleanup_approval(self, approval_id: str):
        """Clean up approval tracking data."""
        self._pending_approvals.pop(approval_id, None)
        self._approval_events.pop(approval_id, None)
        self._approval_responses.pop(approval_id, None)
    
    def get_tool_approval_info(self, tool_name: str, tool_args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get approval information for a tool if it required approval.
        Returns None if tool didn't require approval.
        """
        tool_key = f"{tool_name}:{str(tool_args)}"
        approval_info = self._tool_approval_info.get(tool_key)
        
        if not approval_info:
            return None
        
        return {
            "approvalStatus": approval_info["status"],
            "approvalId": approval_info["approval_id"],
            "requiresApproval": True
        }


# Global singleton
_hook_manager: Optional[ToolHookManager] = None


def get_hook_manager() -> ToolHookManager:
    """Get the global hook manager instance."""
    global _hook_manager
    if _hook_manager is None:
        _hook_manager = ToolHookManager()
    return _hook_manager

