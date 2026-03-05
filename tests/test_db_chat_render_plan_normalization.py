from backend.db.chats import _normalize_render_plan_blocks


def test_normalize_render_plan_blocks_strips_render_plan_for_failed_tool_call() -> None:
    blocks = [
        {
            "type": "tool_call",
            "id": "tool-1",
            "toolName": "file-tools:write_file",
            "failed": True,
            "renderPlan": {"renderer": "code", "config": {"file": "$args.path"}},
        }
    ]

    _normalize_render_plan_blocks(blocks)

    assert "renderPlan" not in blocks[0]


def test_normalize_render_plan_blocks_keeps_render_plan_for_successful_tool_call() -> None:
    blocks = [
        {
            "type": "tool_call",
            "id": "tool-2",
            "toolName": "file-tools:read_file",
            "failed": False,
            "renderPlan": {"renderer": "document", "config": {}},
        }
    ]

    _normalize_render_plan_blocks(blocks)

    assert blocks[0].get("renderPlan", {}).get("renderer") == "document"
