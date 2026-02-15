# Trigger-Based Execution Model

## The Core Idea

A graph is just nodes connected by data. When something triggers it, data flows through from start to finish. Every node along the way does its thing — transforms data, calls an LLM, runs an agent — and passes the result downstream. Events from each node stream back to whoever triggered the flow.

That's it. No special "root agent" concept. No separate build phase. Just data flowing through nodes.

## Two Connection Systems

The graph has two types of connections, inspired by two different worlds.

**The data spine (n8n style)** is the main flow. A single generic "Data" connection runs through every node. Data in on the left, data out on the right. It carries JSON — whatever the node produced. This is how work moves through the graph.

**Typed side sockets (Blender style)** are optional overrides. A node like Agent has inline controls for model, temperature, instructions. But each of those controls also has a small typed socket. Wire a Model Selector node into the model socket and it overrides the dropdown. Wire a number node into the temperature socket and it overrides the slider. These are for power users who want to share configuration across nodes or compute values dynamically.

Users don't think about the distinction. They wire things together. The main data flow is obvious (the big "Data" connections). The side sockets are there when you need them.

## How Execution Works

The flow executor walks the graph topologically. Starting from the trigger node, it visits each node in order, calls `execute()`, collects the output, passes it to the next node.

When it reaches an Agent node, that agent is a black box. The flow executor just calls `execute()` like any other node. Inside, the Agent executor handles everything: it looks at what's connected to its tools socket (MCP servers, toolsets, other agents), builds itself into an Agno Agent or Team, runs with the input data, yields events as it streams, and returns the final output. The flow executor doesn't know or care about any of that internal complexity.

This is key: **structural composition happens inside the node, not in a separate phase.** The Agent builds itself on-demand when it executes. Sub-agents connected to its tools socket get built recursively. It's all encapsulated.

## Event Streaming

Every node yields events as it runs: started, progress (tokens streaming), completed, error. The flow executor collects these and forwards them to the trigger node.

The trigger node decides what to do with them. Chat Start translates events into WebSocket messages for the UI. A webhook trigger might POST them to an external service. An SSE trigger might stream them to a different client. The pattern is the same — trigger fires, flow executes, events stream back.

This means any agent in the graph has its events visible. Chain three agents in sequence? All three stream their tokens back. The UI shows the full execution, not just one "root" agent.

## Why the Current Model Is Wrong

Right now there's a separate `graph_executor.py` that does this:

1. Find Chat Start
2. Follow a special `agent` socket to find the "root agent"  
3. Recursively build that agent with all its tools and sub-agents
4. Return a monolithic Agent/Team object
5. Run it externally

The `agent` socket type exists solely for step 2 — it's a topology hint that says "this is the root." It carries no data. It's a workaround for the executor not understanding the graph.

This breaks down immediately when you want anything more complex. Two agents in sequence? Can't do it — there's only one root. Preprocessing before the agent? Nope — the root must be directly connected to Chat Start. The entire graph is subordinate to this one special agent.

The fix is simple: delete the `agent` socket type and let the graph execute normally. The first Agent node downstream from Chat Start runs first. If there's another Agent after it, that one runs next. No special cases.

## What Needs to Change

### Immediate: Remove the `agent` Socket Type

The `agent` socket is vestigial. Remove it from:
- Type system (`SocketTypeId`, `ParameterType`, `AgentParameter`)
- Socket registry (`SOCKET_TYPES`)
- Node definitions (Chat Start's agent output, Agent's agent input)
- Graph executor (temporarily adapt `_find_root_agent_id` to use data spine edges)
- Flow executor (`STRUCTURAL_HANDLE_TYPES` becomes just `{"tools"}`)
- Default graph template
- All tests

For sub-agent composition, Agent gets a `tools-out` output socket. Connect Agent B's `tools-out` to Agent A's `tools` input, and B becomes a sub-agent of A. The existing `_get_tool_sources()` already identifies sub-agents by checking `source["type"] == "agent"` — it just works.

Data spine sockets get labeled "Data" on both input and output (except for branching nodes like Conditional, which keep "True"/"False" labels for clarity).

### Future: Inline Structural Building

Move the agent-building logic from `graph_executor.py` into the Agent executor itself. When the flow executor reaches an Agent, it passes the structural context (what's connected to the tools socket). The Agent executor builds itself and runs. `build_agent_from_graph()` as a top-level entry point goes away.

### Future: Generalize Triggers

Abstract the trigger concept. Chat Start becomes one type of trigger (receives chat messages, streams to UI). Others could include webhook triggers, scheduled triggers, SSE triggers. They all follow the same pattern: receive an event, emit data onto the spine, consume the event stream, forward results.

## What This Enables

Chain agents in sequence — each receives the previous one's output, processes it, passes it on. Use `{{ ... }}` expressions in node parameters to preprocess the input. Put an LLM Completion after to summarize the response. Fork with a Conditional and run different agents on different branches.

The graph becomes genuinely flexible. The "root agent" constraint disappears. You can build whatever flow makes sense for your use case.
