# AI Node Type Catalog

Research-backed catalog of node types for a hybrid flow editor that supports **structural agent composition** (wiring agents with tools) AND **runtime data flow** (n8n-style pipelines).

Sources: n8n AI nodes, LangGraph, Flowise, Dify, LangChain.

---

## New Socket Types Required

The current system has: `agent`, `tools`, `float`, `int`, `string`, `boolean`, `color`.

New socket types needed for data-flow mode:

| Socket Type | Color | Shape | Description |
|-------------|-------|-------|-------------|
| `messages` | `#6366f1` | circle | Chat message array (the primary data currency) |
| `embedding` | `#06b6d4` | diamond | Vector embedding (float array) |
| `documents` | `#8b5cf6` | square | Retrieved document chunks |
| `json` | `#f97316` | square | Arbitrary structured JSON |
| `image` | `#ec4899` | circle | Image data (base64/URL/binary) |
| `any` | `#a1a1aa` | circle | Wildcard - accepts any type |

Updated `SocketTypeId`:
```typescript
type SocketTypeId =
  | 'agent' | 'tools'                    // structural composition
  | 'messages' | 'string' | 'json'      // data flow
  | 'embedding' | 'documents' | 'image' // specialized data
  | 'float' | 'int' | 'boolean'         // primitives
  | 'color'                              // UI
  | 'any';                               // wildcard
```

---

## Node Category Expansion

Current: `core`, `tools`, `data`, `utility`.

Proposed:
```typescript
type NodeCategory =
  | 'core'       // Chat Start, Agent
  | 'ai'         // LLM, Embedding, Classifier, Structured Output, Vision
  | 'tools'      // MCP Server, Toolset
  | 'memory'     // Conversation Memory, Knowledge Retrieval
  | 'transform'  // Prompt Template, Code, Summarizer
  | 'flow'       // Router, Aggregator, Iterator
  | 'utility';   // HTTP Request, etc.
```

---

## 1. Agent Node

**What it does:** An LLM-powered agent that reasons about tasks, decides when to use tools, and loops until it produces a final answer. The core "thinking" unit. Corresponds to n8n's AI Agent, LangGraph's agent node, Flowise's Agent/Sequential Agent, Dify's Agent Node.

### Sockets

| ID | Type | Mode | Side | Multiple | Description |
|----|------|------|------|----------|-------------|
| `agent` | `agent` | input | left | no | Structural: parent agent connection (hub topology) |
| `tools` | `tools` | input | right | yes | Structural: tool providers (MCP, toolsets, sub-agents) |
| `messages_in` | `messages` | input | left | no | Flow mode: incoming message history |
| `messages_out` | `messages` | output | right | no | Flow mode: outgoing messages (with agent response appended) |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | model | - | LLM to use for reasoning |
| `name` | string | `""` | Agent name (used in multi-agent handoffs) |
| `description` | text-area | `""` | What this agent does (shown to parent agents for delegation) |
| `instructions` | text-area | `""` | System prompt / personality |
| `temperature` | float | `0.7` | Sampling temperature (0-2) |
| `maxIterations` | int | `10` | Max tool-use loops before forced stop |
| `enableStreaming` | boolean | `true` | Stream tokens as they generate |
| `returnIntermediateSteps` | boolean | `false` | Include tool call/response pairs in output |

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `agent:thinking` | Agent starts reasoning | `{ iteration: number }` |
| `agent:tool_call` | Agent decides to call a tool | `{ tool: string, args: object }` |
| `agent:tool_result` | Tool returns a result | `{ tool: string, result: any, duration_ms: number }` |
| `agent:token` | Each token generated | `{ token: string, role: 'assistant' }` |
| `agent:done` | Agent produces final answer | `{ response: Message, iterations: number, tokens_used: object }` |
| `agent:error` | Something went wrong | `{ error: string, iteration: number, recoverable: boolean }` |
| `agent:max_iterations` | Hit iteration limit | `{ lastResponse: string }` |

### Edge Cases
- **Streaming:** Tokens stream during each LLM call within the loop. Between tool calls, there's a gap. UI should show "Using tool X..." during gaps.
- **Token limits:** If context window fills mid-loop, agent must summarize history or bail. Configurable strategy: `truncate_oldest | summarize | error`.
- **Tool errors:** Configurable per-tool: `retry(n) | skip | abort`. Agent sees error message and can try a different approach.
- **Infinite loops:** `maxIterations` is the hard cap. Also consider a `maxTokenBudget` parameter.

### Dual Mode Behavior
- **Structural mode:** Receives tools via `tools` socket, receives delegation via `agent` socket. Self-contained reasoning loop.
- **Flow mode:** Receives `messages_in`, runs agent loop, produces `messages_out`. Can be chained: User Input -> Agent A -> Agent B -> Output.

---

## 2. LLM Completion Node

**What it does:** A single LLM call. No tool loop, no agent reasoning. Prompt in, text out. The workhorse for transforms, rewrites, and simple generation. Corresponds to n8n's Basic LLM Chain, LangGraph custom node with `llm.invoke()`, Flowise's LLM Chain, Dify's LLM Node.

### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `prompt` | `string` | input | left | The composed prompt text (can come from a Prompt Template node) |
| `messages_in` | `messages` | input | left | Alternative: pass full message history instead of a flat prompt |
| `context` | `documents` | input | left | Optional RAG context to inject |
| `output` | `string` | output | right | Generated text response |
| `messages_out` | `messages` | output | right | Full message history with response appended |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | model | - | LLM provider + model |
| `systemPrompt` | text-area | `""` | System message |
| `temperature` | float | `0.7` | Sampling temperature |
| `maxTokens` | int | `4096` | Max output tokens |
| `topP` | float | `1.0` | Nucleus sampling |
| `frequencyPenalty` | float | `0.0` | Repetition penalty |
| `enableStreaming` | boolean | `true` | Stream output |
| `memoryEnabled` | boolean | `false` | Include conversation history |
| `memoryWindowSize` | int | `10` | How many turns to include |

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `llm:start` | Request sent to provider | `{ model: string, prompt_tokens: number }` |
| `llm:token` | Each generated token | `{ token: string }` |
| `llm:done` | Generation complete | `{ text: string, usage: { prompt_tokens, completion_tokens, total_tokens } }` |
| `llm:error` | API error | `{ error: string, status: number, retryable: boolean }` |

### Edge Cases
- **Streaming:** Direct token passthrough. Simplest streaming case.
- **Token limits:** If `prompt_tokens + maxTokens > context_window`, truncate context or error. The node should report estimated token count before calling.
- **Rate limits:** Exponential backoff with configurable `maxRetries` (default: 3).
- **Empty input:** If prompt is empty/undefined, skip execution and output empty string (don't waste an API call).

### Dual Mode
- **Structural:** Not typically used in structural mode (use Agent for that). But could accept a `tools` socket to become a single-shot tool-calling LLM.
- **Flow:** The bread and butter. Chain: Prompt Template -> LLM Completion -> Output Parser.

---

## 3. Embedding Node

**What it does:** Converts text into a vector embedding. Used for similarity search, RAG pipelines, and classification. Corresponds to n8n's Embeddings nodes, LangChain Embeddings, Flowise Embeddings, Dify's implicit embedding in Knowledge Retrieval.

### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `text` | `string` | input | left | Text to embed |
| `documents` | `documents` | input | left | Alternative: batch embed document chunks |
| `embedding` | `embedding` | output | right | Vector output (float array) |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `provider` | enum | `openai` | `openai | cohere | google | ollama | voyage | huggingface` |
| `model` | string | `text-embedding-3-small` | Embedding model name |
| `dimensions` | int | - | Output dimensions (if model supports variable) |
| `batchSize` | int | `100` | Documents per API call |

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `embed:start` | Batch started | `{ count: number, model: string }` |
| `embed:progress` | Batch progress | `{ completed: number, total: number }` |
| `embed:done` | All embedded | `{ count: number, dimensions: number, duration_ms: number }` |
| `embed:error` | API error | `{ error: string }` |

### Edge Cases
- **No streaming** - embeddings are returned as a complete vector. No partial results.
- **Batch limits:** Providers cap batch size (OpenAI: 2048 inputs). Node should auto-chunk.
- **Dimension mismatch:** If connecting to a vector store that expects 1536-dim but model outputs 384-dim, the connection should warn.
- **Empty text:** Skip and output zero vector or null.

### Dual Mode
- **Structural:** Connects as a sub-component to a Memory/VectorStore node, providing the embedding function.
- **Flow:** Text -> Embedding -> Vector Store Insert. Or Text -> Embedding -> Cosine Similarity.

---

## 4. Classifier / Router Node

**What it does:** Classifies input into categories using an LLM, then routes execution to different output branches. Corresponds to n8n's Text Classifier, Dify's Question Classifier, Flowise's Condition Agent, LangGraph's conditional edges.

### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `input` | `string` | input | left | Text to classify |
| `messages_in` | `messages` | input | left | Or full message context |
| `branch_0..N` | `any` | output | right | One output per category (dynamic) |
| `other` | `any` | output | right | Fallback branch when no match |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | model | - | LLM for classification |
| `categories` | json | `[]` | Array of `{ name: string, description: string, keywords?: string[] }` |
| `instructions` | text-area | `""` | Additional classification guidance |
| `multiLabel` | boolean | `false` | Allow input to match multiple categories |
| `noMatchBehavior` | enum | `other` | `other | discard | error` - what to do when nothing matches |
| `includeConfidence` | boolean | `false` | Output confidence scores |

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `classify:start` | Classification begins | `{ input_preview: string }` |
| `classify:result` | Classification determined | `{ category: string, confidence?: number, all_scores?: object }` |
| `classify:routed` | Data sent to branch | `{ branch: string }` |
| `classify:no_match` | No category matched | `{ input_preview: string }` |

### Edge Cases
- **Ambiguous input:** Confidence threshold parameter (e.g., `minConfidence: 0.7`). Below threshold -> `other` branch.
- **Multi-label:** When `multiLabel=true`, data is fanned out to ALL matching branches (like LangGraph's `Send`).
- **Dynamic categories:** Categories should be configurable at runtime via an input socket, not just statically.
- **Token cost:** Classification uses the full LLM. For simple keyword routing, offer a `mode: 'llm' | 'keyword'` option.

### Dual Mode
- **Structural:** Not typically used structurally. Could route to different sub-agents based on query type.
- **Flow:** The primary branching mechanism. Input -> Classifier -> [Branch A: Agent] | [Branch B: HTTP Request] | [Branch C: Direct Response].

---

## 5. Summarizer Node

**What it does:** Specialized LLM call for summarization. Handles long documents by chunking, summarizing chunks, then combining. Corresponds to n8n's Summarization Chain, LangChain's map-reduce/refine summarization, Dify's LLM node with summarization prompt.

### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `input` | `string` | input | left | Text to summarize |
| `documents` | `documents` | input | left | Or document chunks to summarize |
| `summary` | `string` | output | right | Summarized text |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | model | - | LLM to use |
| `strategy` | enum | `map_reduce` | `stuff | map_reduce | refine` |
| `maxOutputLength` | int | `500` | Target summary length (tokens) |
| `instructions` | text-area | `""` | Custom summarization instructions (e.g., "focus on action items") |
| `chunkSize` | int | `4000` | Tokens per chunk (for map_reduce/refine) |
| `chunkOverlap` | int | `200` | Overlap between chunks |

**Strategy explanations:**
- `stuff`: Shove everything into one prompt. Fast but limited by context window.
- `map_reduce`: Summarize each chunk independently, then summarize the summaries. Parallel-friendly.
- `refine`: Sequentially refine a running summary with each chunk. Better coherence, slower.

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `summarize:start` | Process begins | `{ strategy: string, chunks: number, total_tokens: number }` |
| `summarize:chunk` | One chunk summarized | `{ chunk: number, total: number }` |
| `summarize:combine` | Combining chunk summaries | `{ summaries_count: number }` |
| `summarize:done` | Final summary ready | `{ summary_length: number, tokens_used: number }` |

### Edge Cases
- **Input fits in context:** Auto-detect and switch to `stuff` strategy regardless of setting.
- **Streaming:** Only the final combination step streams. Individual chunk summaries happen internally.
- **Empty input:** Output empty string, no API call.
- **Very long documents:** `map_reduce` can require multiple levels of reduction. Track depth.

### Dual Mode
- **Structural:** Could connect as a tool to an Agent (agent calls "summarize" tool).
- **Flow:** Document Loader -> Text Splitter -> Summarizer -> Output. Or RAG pipeline: Retrieved Docs -> Summarizer -> LLM context.

---

## 6. Structured Output Node

**What it does:** LLM call with enforced JSON schema output. Validates the response, optionally auto-fixes with a repair LLM call. Corresponds to n8n's Structured Output Parser + Auto-fixing Parser, LangChain's `with_structured_output()`, Flowise's Structured/Advanced Output Parser, Dify's Parameter Extractor and LLM Structured Output.

### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `input` | `string` | input | left | Text/prompt to extract from |
| `messages_in` | `messages` | input | left | Or message context |
| `output` | `json` | output | right | Validated JSON object |
| `raw` | `string` | output | right | Raw LLM response (before parsing) |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | model | - | LLM to use |
| `schema` | json | `{}` | JSON Schema defining expected output structure |
| `schemaMode` | enum | `json_schema` | `json_schema | json_example | fields` - how to define the schema |
| `instructions` | text-area | `""` | Additional extraction instructions |
| `enforcement` | enum | `provider` | `provider | prompt | tool_call` - how to enforce the schema |
| `autoFix` | boolean | `true` | Attempt auto-repair on validation failure |
| `autoFixModel` | model | - | Separate model for repair (often cheaper, temperature=0) |
| `maxRetries` | int | `2` | Retry attempts before failing |
| `strict` | boolean | `false` | Use provider's strict mode (OpenAI structured outputs) |

**Enforcement strategies:**
- `provider`: Use provider-native structured output API (most reliable). OpenAI, Anthropic, Gemini support this.
- `tool_call`: Simulate via tool/function calling. Works with any tool-capable model.
- `prompt`: Pure prompting with schema in system message. Least reliable, most universal.

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `structured:start` | Extraction begins | `{ schema_fields: string[] }` |
| `structured:raw_response` | LLM responded | `{ raw: string }` |
| `structured:validation` | Schema validation result | `{ valid: boolean, errors?: string[] }` |
| `structured:auto_fix` | Repair attempt started | `{ attempt: number, errors: string[] }` |
| `structured:done` | Valid output produced | `{ output: object, attempts: number }` |
| `structured:failed` | All retries exhausted | `{ lastErrors: string[], raw: string }` |

### Edge Cases
- **Provider doesn't support structured output:** Auto-fallback from `provider` -> `tool_call` -> `prompt`.
- **Schema too complex:** Deeply nested schemas may confuse the LLM. Warn when depth > 3.
- **Partial output:** If streaming, can't validate until complete. Buffer entire response.
- **Type coercion:** LLM returns `"42"` for an integer field. Auto-coerce common cases.
- **`$ref` in schema:** Not supported by most platforms. Flatten before sending.

### Dual Mode
- **Structural:** Wire as a tool to an Agent. The agent calls "extract_data" and gets structured JSON back.
- **Flow:** Input Text -> Structured Output -> [field1] -> Branch A, [field2] -> Branch B. Also: LLM Response -> Structured Output -> HTTP Request body.

---

## 7. Vision / Multimodal Node

**What it does:** Accepts images alongside text and sends them to a vision-capable LLM. Corresponds to n8n's multimodal workflows (community node + GPT-4o), LangChain's multimodal `HumanMessage`, Flowise's image upload, Dify's Vision toggle on LLM nodes.

### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `prompt` | `string` | input | left | Text prompt |
| `images` | `image` | input | left | One or more images (multiple=true) |
| `messages_in` | `messages` | input | left | Or full message history with images |
| `output` | `string` | output | right | Generated text response |
| `messages_out` | `messages` | output | right | Full history with response |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | model | - | Must be vision-capable (GPT-4o, Claude, Gemini) |
| `systemPrompt` | text-area | `""` | System message |
| `detail` | enum | `auto` | `auto | low | high` - image resolution (affects token cost) |
| `maxImages` | int | `5` | Maximum images per request |
| `temperature` | float | `0.7` | Sampling temperature |
| `maxTokens` | int | `4096` | Max output tokens |
| `enableStreaming` | boolean | `true` | Stream response |

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `vision:start` | Request prepared | `{ image_count: number, detail: string, estimated_tokens: number }` |
| `vision:token` | Token generated | `{ token: string }` |
| `vision:done` | Complete | `{ text: string, usage: object }` |
| `vision:error` | Error | `{ error: string }` |

### Edge Cases
- **Image too large:** Auto-resize before sending. Warn user about quality loss.
- **Model doesn't support vision:** Error at validation time (before execution), not at runtime.
- **Image formats:** Accept JPEG, PNG, GIF, WebP. Convert others.
- **Token cost:** `high` detail on a 2048x2048 image uses ~765 tokens (OpenAI). Show estimated cost.
- **Base64 vs URL:** Accept both. If URL, option to download and convert to base64 for reliability.
- **Multiple images:** Some models cap at N images. Enforce `maxImages` per model.

### Dual Mode
- **Structural:** Rare. Could wire as a vision tool to an Agent (agent decides when to "look" at images).
- **Flow:** Image Input -> Vision Node -> Structured Output (extract data from receipt/document).

---

## 8. Memory Node

**What it does:** Stores and retrieves conversation history or knowledge. Two sub-types: **Conversation Memory** (chat history) and **Knowledge Retrieval** (vector search over documents). Corresponds to n8n's Memory nodes (Buffer Window, Redis), LangGraph's checkpointer + Store, Flowise's Memory nodes, Dify's Knowledge Retrieval node.

### 8a. Conversation Memory Node

#### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `messages_in` | `messages` | input | left | New messages to store |
| `messages_out` | `messages` | output | right | Retrieved conversation history |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `backend` | enum | `buffer` | `buffer | redis | postgres | sqlite` |
| `windowSize` | int | `20` | Number of turns to retain |
| `strategy` | enum | `sliding_window` | `sliding_window | token_limit | summarize_oldest` |
| `tokenLimit` | int | `4000` | Max tokens in memory (for token_limit strategy) |
| `sessionId` | string | `""` | Isolate conversations (auto-generated if empty) |
| `connectionString` | string | `""` | For redis/postgres backends |

#### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `memory:load` | History retrieved | `{ messages_count: number, tokens: number }` |
| `memory:store` | New messages saved | `{ new_messages: number }` |
| `memory:trim` | Old messages removed | `{ removed: number, strategy: string }` |
| `memory:summarize` | History summarized | `{ original_tokens: number, summary_tokens: number }` |

### 8b. Knowledge Retrieval Node

#### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `query` | `string` | input | left | Search query |
| `query_embedding` | `embedding` | input | left | Or pre-computed query vector |
| `documents` | `documents` | output | right | Retrieved document chunks |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `knowledgeBase` | enum | - | Which knowledge base to search |
| `embeddingModel` | model | - | Model for query embedding (if not pre-computed) |
| `topK` | int | `5` | Number of results |
| `scoreThreshold` | float | `0.0` | Minimum similarity score (0-1) |
| `retrievalStrategy` | enum | `similarity` | `similarity | mmr | hybrid` |
| `rerank` | boolean | `false` | Apply reranking model |
| `rerankModel` | model | - | Reranking model |
| `metadataFilter` | json | `{}` | Filter by document metadata |

#### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `retrieval:start` | Search begins | `{ query_preview: string, top_k: number }` |
| `retrieval:embedded` | Query embedded | `{ dimensions: number }` |
| `retrieval:results` | Results found | `{ count: number, scores: number[] }` |
| `retrieval:reranked` | Reranking complete | `{ original_order: number[], new_order: number[] }` |
| `retrieval:done` | Output ready | `{ documents: number, total_tokens: number }` |

### Edge Cases
- **Empty history:** Return empty array, don't error.
- **Session conflicts:** Two concurrent requests to same session. Backend must handle locking.
- **Stale embeddings:** If embedding model changes, existing vectors are incompatible. Warn or re-embed.
- **No results above threshold:** Return empty docs, let downstream handle gracefully.

### Dual Mode
- **Structural:** Memory node connects to Agent as a sub-component (n8n-style). Agent automatically loads/saves history.
- **Flow:** Query -> Knowledge Retrieval -> Documents -> LLM Context. Or: Agent Output -> Memory Store.

---

## 9. Prompt Template Node

**What it does:** Combines variables into a formatted prompt string using template syntax. The glue between data sources and LLM calls. Corresponds to n8n's expression system, Dify's Template (Jinja2) node, LangChain's PromptTemplate, Flowise's Prompt nodes.

### Sockets

| ID | Type | Mode | Side | Description |
|----|------|------|------|-------------|
| `var_0..N` | `any` | input | left | Dynamic variable inputs (one per template variable) |
| `output` | `string` | output | right | Rendered prompt string |

### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `template` | text-area | `""` | Template with `{{variable}}` placeholders |
| `syntax` | enum | `mustache` | `mustache | jinja2` |
| `variables` | json | `[]` | Array of `{ name: string, type: string, default?: string }` |
| `validateOutput` | boolean | `false` | Error if any variable is undefined |

When the user edits the template, the node auto-detects `{{variable_name}}` patterns and creates corresponding input sockets dynamically.

### Execution Events

| Event | When | Payload |
|-------|------|---------|
| `template:render` | Template rendered | `{ variables_filled: number, output_length: number }` |
| `template:missing_var` | Variable undefined | `{ variable: string, used_default: boolean }` |

### Edge Cases
- **Missing variables:** Three options: use default value, insert empty string, or error.
- **XSS in templates:** If output goes to HTML artifact, sanitize. For LLM prompts, no sanitization needed.
- **Dynamic socket creation:** As user types `{{new_var}}` in the template, a new input socket appears. Deleting it removes the socket. Edges must be cleaned up.
- **Nested templates:** `{{#each items}}...{{/each}}` for Mustache. Full Jinja2 supports loops and filters.

### Dual Mode
- **Structural:** Not used in structural mode.
- **Flow:** The primary way to compose prompts. [User Input] + [RAG Context] + [Memory] -> Prompt Template -> LLM.

---

## 10. Additional Nodes Worth Considering

### 10a. Code / Transform Node

Like Dify's Code Node. Execute JavaScript/Python to transform data between nodes.

| Socket | Type | Mode | Description |
|--------|------|------|-------------|
| `input_0..N` | `any` | input | Named inputs |
| `output_0..N` | `any` | output | Named outputs |

Config: `language: 'javascript' | 'python'`, `code: string`, `inputSchema: json`, `outputSchema: json`.

### 10b. Conditional / IF-ELSE Node

Like Dify's IF/ELSE. Route data based on conditions.

| Socket | Type | Mode | Description |
|--------|------|------|-------------|
| `input` | `any` | input | Value to test |
| `true` | `any` | output | When condition met |
| `false` | `any` | output | When condition not met |

Config: `conditions: Array<{ field, operator, value }>`, `combineMode: 'and' | 'or'`.

### 10c. Variable Aggregator Node

Like Dify's Variable Aggregator. Merge outputs from parallel branches.

| Socket | Type | Mode | Description |
|--------|------|------|-------------|
| `input_0..N` | `any` | input | Multiple branch outputs |
| `output` | `any` | output | Merged result |

Config: `mergeStrategy: 'first_available' | 'concat' | 'array'`.

### 10d. Iterator / Loop Node

Like Dify's Iteration Node. Run a sub-flow for each item in an array.

| Socket | Type | Mode | Description |
|--------|------|------|-------------|
| `items` | `json` | input | Array to iterate |
| `item` | `any` | output | Current item (connects to sub-flow) |
| `results` | `json` | output | Collected results |

Config: `concurrency: int`, `errorHandling: 'skip' | 'abort'`.

### 10e. HTTP Request Node

External API calls. Like n8n's HTTP Request, Dify's HTTP Request.

| Socket | Type | Mode | Description |
|--------|------|------|-------------|
| `body` | `json` | input | Request body |
| `response` | `json` | output | Response body |
| `status` | `int` | output | HTTP status code |

Config: `url`, `method`, `headers`, `auth`, `timeout`.

---

## Execution Event Protocol

All nodes emit events through a unified protocol. Events are typed and follow a consistent shape:

```typescript
interface NodeEvent {
  nodeId: string;          // Which node instance
  nodeType: string;        // Node definition ID
  event: string;           // Event name (e.g., 'llm:token')
  timestamp: number;       // Unix ms
  data: Record<string, unknown>;
}

// Streaming transport
type StreamMode =
  | 'tokens'    // Just LLM tokens (for chat UI)
  | 'updates'   // Node state changes (for flow visualization)
  | 'events'    // All events (for debugging)
  | 'custom';   // User-defined signals
```

This mirrors LangGraph's streaming modes. The UI can subscribe to different modes:
- Chat panel subscribes to `tokens` mode
- Flow canvas subscribes to `updates` mode (animate node borders during execution)
- Debug panel subscribes to `events` mode

---

## Connection Compatibility Matrix

Which socket types can connect to which:

| Source | Compatible Targets |
|--------|-------------------|
| `agent` | `agent`, `tools` (agent-as-tool) |
| `tools` | `tools`, `agent` (tool-to-agent) |
| `messages` | `messages` |
| `string` | `string`, `any` |
| `json` | `json`, `any` |
| `embedding` | `embedding` |
| `documents` | `documents`, `string` (auto-serialize) |
| `image` | `image` |
| `float` | `float`, `int` (truncate), `any` |
| `int` | `int`, `float` (promote), `any` |
| `boolean` | `boolean`, `any` |
| `any` | `any` (accepts everything) |

Special implicit conversions:
- `documents` -> `string`: Join document contents with `\n\n---\n\n`
- `json` -> `string`: `JSON.stringify(value, null, 2)`
- `string` -> `messages`: Wrap as `[{ role: 'user', content: text }]`
- `int` -> `float`: Lossless promotion

---

## Minimum Viable Implementation Order

1. **LLM Completion** - simplest useful node, validates the whole pipeline
2. **Prompt Template** - needed to compose prompts for LLM
3. **Classifier/Router** - first branching node, proves flow routing works
4. **Structured Output** - high-value, every real pipeline needs JSON extraction
5. **Memory (Conversation)** - needed for multi-turn chat
6. **Knowledge Retrieval** - completes the RAG pipeline
7. **Embedding** - foundation for Knowledge Retrieval
8. **Summarizer** - specialized LLM use case
9. **Vision/Multimodal** - extends LLM node with image support
10. **Code/Transform** - escape hatch for custom logic
