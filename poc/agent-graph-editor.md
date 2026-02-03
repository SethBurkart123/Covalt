# Agent Graph Editor

A visual node-based editor for creating advanced AI agents, inspired by Blender's node system.

## The Core Idea

**Everything is a tool.**

At its heart, an agent is just an LLM with access to tools. Those tools can be MCP servers, toolset functions, or... other agents. When you connect an agent as a tool to another agent, it becomes a sub-agent - callable just like any other tool. This simple mental model unlocks incredible compositional power.

Teams aren't a separate concept. A "team" is just an agent with sub-agents connected to it. The graph makes this relationship visual and intuitive.

## How It Fits Into Agno

Regular chats continue to work exactly as they do today - pick a model, start chatting. The agent graph editor is an optional power feature for users who want more control.

**The experience:**
1. You create agents in a dedicated Agents page (similar to Toolsets)
2. Each agent has a name, icon (custom image), and a node graph
3. Saved agents appear in the model selector as their own section
4. Select an agent instead of a model, and your chat uses that agent's entire graph

## The Graph Editor

### First Impressions

When you create a new agent, you're greeted with a dark canvas (Blender-style) with two nodes already placed:

```
┌─────────────┐              ┌─────────────┐
│ Chat Start  │──────────────│   Agent     │
│             │              │             │
└─────────────┘              └─────────────┘
```

The **Chat Start** node is where user messages enter. It connects to an **Agent** node - the LLM that will respond. This is the minimal viable agent: equivalent to just picking a model in a regular chat.

### Adding Tools

Drag an **MCP Server** node from the palette onto the canvas. A list appears - pick one of your configured MCP servers (or configure a new one inline). Connect it to the Agent's tools socket:

```
┌─────────────┐              ┌─────────────┐              ┌──────────────┐
│ Chat Start  │──────────────│   Agent     │◀─────────────│  filesystem  │
│             │              │             │              │   (MCP)      │
└─────────────┘              └─────────────┘              └──────────────┘
```

Now your agent has filesystem tools. Add more nodes - a **Toolset** node for web search, another MCP server for database access. Each connection gives your agent more capabilities.

### Creating Sub-Agents

Here's where it gets interesting. Add another **Agent** node and configure it differently - maybe a "Code Reviewer" with specific instructions. Connect it to your main agent's tools:

```
┌─────────────┐              ┌─────────────┐              ┌──────────────┐
│ Chat Start  │──────────────│ Main Agent  │◀─────────────│  filesystem  │
│             │              │             │              │   (MCP)      │
└─────────────┘              │             │              └──────────────┘
                             │             │◀─────────────┌──────────────┐
                             └─────────────┘              │ Code Review  │
                                                          │   (Agent)    │
                                                          └──────────────┘
```

The Code Review agent is now a tool. Your main agent can call it like any other tool - "Hey, review this code" - and the sub-agent runs, thinks, and returns its response. The sub-agent can have its own tools too. Nest as deep as you like.

### The Properties Panel

Click any node to configure it in the right sidebar. For an Agent node:

- **Model** - Provider and model selection
- **Name** - What this agent is called (used when it's a sub-agent tool)
- **Description** - Explains what this agent does (shown to parent agents)
- **Instructions** - System prompt / personality

For an MCP Server or Toolset node:

- **Tool Selection** - By default, all tools are exposed. Toggle individual tools on/off, or select specific ones to include.

### Socket Types

Nodes have sockets (connection points) on their left and right sides:

- **Left side** = receives connections
- **Right side** = provides connections

Two socket types exist:

1. **Agent socket** (rounded) - For the agent flow. Chat Start provides one, Agent receives one.
2. **Tools socket** (square) - For tool connections. Agent receives tools, tool sources provide them.

The clever bit: an Agent's right side has an agent socket that can connect to another agent's tools socket. This is how agents become sub-agents - the type "converts" at the connection point, just like certain Blender node sockets.

## User Flows

### Creating Your First Agent

1. Navigate to **Agents** page from sidebar
2. Click **New Agent**
3. You see the canvas with Chat Start → Agent already connected
4. Click the Agent node, configure model and instructions in the sidebar
5. Give it a name and upload an icon
6. Click **Save**

### Adding Capabilities

1. Open an existing agent
2. Drag an MCP Server node from the left palette
3. Select "Context7" from the server list
4. Connect it to the Agent's tools socket
5. (Optional) Click the node, toggle off tools you don't want exposed
6. Save

### Building a Team

1. Create a new agent called "Research Team"
2. Configure the main agent as a coordinator
3. Add a second Agent node, configure as "Web Researcher" with web search tools
4. Add a third Agent node, configure as "Analyst" with code execution tools  
5. Connect both to the main agent's tools
6. The coordinator can now delegate to specialists

### Using an Agent in Chat

1. Start a new chat
2. Open the model selector
3. Scroll to the **Agents** section
4. Select "Research Team"
5. Chat normally - you're now talking to your custom agent graph

## Design Philosophy

### Blender-Inspired

The editor takes cues from Blender's node editor:

- **Dark theme** with subtle grid background
- **Drag from palette** to add nodes
- **Click-drag between sockets** to connect
- **Properties panel on right** for selected node settings
- **Minimap** for navigation in complex graphs
- **Zoom and pan** with scroll/drag

### Progressive Complexity

- Simple use case: Chat Start → Agent (just like picking a model)
- Add tools: Connect MCP servers and toolsets
- Advanced: Sub-agents, nested teams, specialized workers

Users discover complexity as they need it. The default two-node setup works immediately.

### Validation Without Gatekeeping

We validate graphs to help users, not to restrict them:

- **Error**: No Chat Start node (graph won't work)
- **Error**: Chat Start not connected to an agent (nothing to talk to)
- **Warning**: Circular agent references (might cause issues)

We explicitly don't warn about:
- Agents with no tools (perfectly valid)
- "Unused" nodes (maybe they're experimenting)
- "Too many" connections (let them go wild)

## What This Enables

- **Specialized agents** - A coding agent with just the right tools
- **Research teams** - Coordinator + specialists working together  
- **Sandboxed tools** - Sub-agent with dangerous tools, supervised by main agent
- **Reusable components** - Build once, use across many chats
- **Shareable agents** - Export/import agent graphs (future)

The graph editor transforms agent building from "edit JSON and hope" to "visual composition with immediate feedback."
