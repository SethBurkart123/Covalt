# Agno Integration Quickstart

## 1. Install Python Dependencies

```bash
cd src-tauri

# Create venv if it doesn't exist
python3 -m venv .venv

# Activate venv
source .venv/bin/activate  # macOS/Linux

# Install all dependencies (including agno, anthropic, groq)
pip install -e .
```

## 2. Configure API Keys

Create `.env` file in the project root:

```env
# OpenAI (required for default model)
OPENAI_API_KEY=sk-proj-...

# Optional: Add other providers as needed
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...

# Optional: Custom OpenAI-compatible API
# OPENAI_API_BASE_URL=https://api.example.com/v1

# Optional: Local Ollama (defaults to http://localhost:11434)
# OLLAMA_HOST=http://localhost:11434
```

## 3. Run the App

```bash
# From project root
npm run tauri dev
```

The app will:
- Auto-migrate database (add `agent_config` column)
- Regenerate TypeScript API client (`app/python/apiClient.ts`)
- Start with default config (OpenAI gpt-4o-mini, no tools)

## 4. Test Multi-Model Support

### Via Frontend (once UI is added):
- Open settings/model selector
- Choose provider: Anthropic
- Choose model: claude-3-5-sonnet-20241022
- Send a message - should use Claude

### Via Browser Console (immediate testing):
```javascript
// In browser dev console
import { updateChatModel } from '@/python/apiClient';

// Switch to Claude
await updateChatModel({
  chatId: "your-chat-id",  // Get from current chat
  provider: "anthropic",
  modelId: "claude-3-5-sonnet-20241022"
});

// Switch to Groq Llama
await updateChatModel({
  chatId: "your-chat-id",
  provider: "groq",
  modelId: "llama-3.1-70b-versatile"
});

// Back to OpenAI
await updateChatModel({
  chatId: "your-chat-id",
  provider: "openai",
  modelId: "gpt-4o"
});
```

## 5. Test Tool Activation

### Available Tools (by default):
- `calculator` - Basic math evaluation
- `echo` - Echo back input (for testing)
- `web_search` - DuckDuckGo search (if installed)

### Via Browser Console:
```javascript
import { toggleChatTools, getAvailableTools } from '@/python/apiClient';

// List available tools
const tools = await getAvailableTools();
console.log(tools);

// Activate calculator
await toggleChatTools({
  chatId: "your-chat-id",
  toolIds: ["calculator"]
});

// Now ask: "What is 15 * 23?"
// Should see ToolCall event in stream

// Activate multiple tools
await toggleChatTools({
  chatId: "your-chat-id",
  toolIds: ["calculator", "web_search"]
});
```

## 6. Monitor Streaming Events

Open browser dev console to see streaming events:

```
RunStarted { sessionId: "..." }
RunContent { content: "Let me calculate" }
ToolCall { tool: { name: "calculator", args: {...}, result: "..." } }
RunContent { content: " that for you..." }
RunCompleted {}
```

## 7. Add Custom Tools

Edit `src-tauri/python/tauri_app/services/tool_registry.py`:

```python
def _register_default_tools(self) -> None:
    # ... existing tools ...
    
    # Add custom tool
    self.register_tool(
        tool_id="my_custom_tool",
        tool_factory=self._create_my_tool,
        metadata={
            "name": "My Custom Tool",
            "description": "Does something cool",
            "category": "custom",
        }
    )

@staticmethod
def _create_my_tool() -> Any:
    from agno.tools import tool
    
    @tool
    def my_custom_tool(input: str) -> str:
        """
        Custom tool description for the AI.
        
        Args:
            input: Input parameter
            
        Returns:
            Result string
        """
        return f"Processed: {input}"
    
    return my_custom_tool
```

Restart the app and the tool will be available in `getAvailableTools()`.

## 8. Troubleshooting

### "Missing API key" errors
- Check `.env` file exists and has correct keys
- Make sure venv is activated when running

### "Module not found: agno"
- Reinstall: `pip install -e .` from `src-tauri/`
- Check venv is activated

### Streaming not working
- Check browser console for errors
- Check terminal for Python errors
- Verify database has `agent_config` column

### Tool calls not appearing
- Verify tools are activated: `getAvailableTools()` and `toggleChatTools()`
- Check that the model supports function calling (most modern models do)
- Look for `ToolCall` events in stream

## Next Steps

1. **Add UI Components** - Model selector, tool toggle panel
2. **Add More Tools** - File system, Python REPL, Docker containers
3. **Agent Teams** - Multi-agent collaboration (Phase 5+)
4. **Marketplace** - Share/install custom agents and tools (Phase 5+)

## Quick Reference

**Model Providers:**
- `openai` - GPT-4, GPT-4o, GPT-3.5, etc.
- `anthropic` - Claude 3 Opus, Sonnet, Haiku
- `groq` - Llama 3.1, Mixtral (fast inference)
- `ollama` - Local models (Llama, Mistral, etc.)

**API Commands:**
- `createChat(config)` - Create new chat with optional agent config
- `updateChatModel(chatId, provider, modelId)` - Switch model
- `toggleChatTools(chatId, toolIds)` - Activate/deactivate tools
- `getAvailableTools()` - List registered tools

**Environment Variables:**
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `GROQ_API_KEY` - Groq API key
- `OPENAI_API_BASE_URL` - Custom OpenAI-compatible endpoint
- `OLLAMA_HOST` - Ollama server URL (default: http://localhost:11434)

