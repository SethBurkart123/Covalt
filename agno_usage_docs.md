# Agno Dynamic Agent System Documentation

## Overview

This documentation provides a comprehensive guide for implementing a desktop AI chat application using the Agno Python framework. The system supports dynamic agent creation, runtime tool toggling, multi-agent teams, and seamless model switching across providers.[1][2]

## Core Architecture

### System Components

The backend architecture consists of four primary components that work together to manage the AI workflow:[2][1]

1. **Agent Manager**: Handles dynamic agent creation and lifecycle
2. **Tool Registry**: Manages available tools and runtime activation/deactivation
3. **Session Manager**: Persists chat history, active tools, and model configurations
4. **Team Coordinator**: Orchestrates multi-agent collaborations

## Dynamic Agent Creation

### Basic Agent Instantiation

Agno agents are created dynamically using a declarative Python API. Each agent requires a model and can be configured with tools, memory, storage, and instructions:[1][2]

```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.models.anthropic import Claude
from agno.db.sqlite import SqliteDb

# Create agent with dynamic configuration
def create_agent(config):
    agent = Agent(
        name=config.get("name", "Assistant"),
        model=get_model(config["model_provider"], config["model_id"]),
        tools=load_tools(config.get("tool_ids", [])),
        db=SqliteDb(db_file="agents.db"),
        session_id=config["session_id"],
        instructions=config.get("instructions", []),
        description=config.get("personality", "You are a helpful assistant"),
        add_history_to_context=True,
        num_history_responses=config.get("context_window", 10),
        markdown=True,
        show_tool_calls=config.get("show_tools", True)
    )
    return agent
```

### Model Provider Abstraction

Create a model factory to support switching between providers dynamically:[3][4][1]

```python
from agno.models.openai import OpenAIChat
from agno.models.anthropic import Claude
from agno.models.groq import Groq
from agno.models.ollama import Ollama

def get_model(provider, model_id, **kwargs):
    """
    Factory function to instantiate models from different providers
    
    Args:
        provider: Model provider name (openai, anthropic, groq, ollama)
        model_id: Specific model identifier
        **kwargs: Additional model configuration
    
    Returns:
        Configured model instance
    """
    model_map = {
        "openai": lambda: OpenAIChat(id=model_id, **kwargs),
        "anthropic": lambda: Claude(id=model_id, **kwargs),
        "groq": lambda: Groq(id=model_id, **kwargs),
        "ollama": lambda: Ollama(id=model_id, **kwargs),
    }
    
    if provider not in model_map:
        raise ValueError(f"Unsupported provider: {provider}")
    
    return model_map[provider]()
```

### Custom Agent Personalities

Agent personalities are defined through instructions and descriptions:[5][2]

```python
def create_custom_agent(personality_config):
    """
    Create agent with custom personality
    
    personality_config structure:
    {
        "name": "Code Assistant",
        "description": "You are an expert Python developer",
        "instructions": [
            "Always provide code examples",
            "Explain your reasoning step by step",
            "Use markdown formatting for code blocks"
        ],
        "model": {"provider": "openai", "id": "gpt-4o"},
        "tools": ["python_executor", "file_reader"]
    }
    """
    
    # Dynamic instructions can also be functions
    def get_dynamic_instructions(agent: Agent) -> list:
        return [
            f"Your name is {agent.name}",
            *personality_config["instructions"]
        ]
    
    agent = Agent(
        name=personality_config["name"],
        description=personality_config["description"],
        instructions=get_dynamic_instructions,
        model=get_model(
            personality_config["model"]["provider"],
            personality_config["model"]["id"]
        ),
        tools=load_tools(personality_config["tools"]),
        markdown=True
    )
    return agent
```

## Dynamic Tool Management

### Tool Registry System

Implement a tool registry that maps tool IDs to Agno tool instances:[6][7][8]

```python
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.python import PythonTools
from agno.tools.file import FileTools
from agno.tools.tavily import TavilyTools
from agno.tools.mcp import MCPTools

class ToolRegistry:
    """
    Centralized registry for managing available tools
    """
    
    def __init__(self):
        self._tools = {}
        self._register_default_tools()
    
    def _register_default_tools(self):
        """Register built-in tools"""
        self._tools = {
            "web_search": lambda: DuckDuckGoTools(),
            "python": lambda: PythonTools(),
            "file_system": lambda: FileTools(),
            "advanced_search": lambda: TavilyTools(
                search=True,
                max_tokens=8000,
                search_depth="advanced"
            ),
            "docker_ubuntu": lambda: MCPTools(
                transport="docker",
                image="ubuntu:latest"
            ),
        }
    
    def register_custom_tool(self, tool_id, tool_factory):
        """
        Register a custom tool
        
        Args:
            tool_id: Unique identifier for the tool
            tool_factory: Callable that returns tool instance
        """
        self._tools[tool_id] = tool_factory
    
    def get_tools(self, tool_ids):
        """
        Get tool instances for given IDs
        
        Args:
            tool_ids: List of tool identifiers
            
        Returns:
            List of instantiated tool objects
        """
        return [self._tools[tid]() for tid in tool_ids if tid in self._tools]
    
    def list_available_tools(self):
        """Return all available tool IDs"""
        return list(self._tools.keys())

# Global tool registry
tool_registry = ToolRegistry()

def load_tools(tool_ids):
    """Load tools from registry"""
    return tool_registry.get_tools(tool_ids)
```

### Runtime Tool Toggling

Agno supports dynamic tool modification through `set_tools()` and `add_tool()` methods:[9][8]

```python
def update_agent_tools(agent, active_tool_ids, session_manager):
    """
    Update agent tools at runtime
    
    Args:
        agent: Agent instance to update
        active_tool_ids: List of tool IDs to activate
        session_manager: Session manager to persist state
    """
    # Get fresh tool instances
    new_tools = tool_registry.get_tools(active_tool_ids)
    
    # Replace all tools (use set_tools for complete replacement)
    agent.set_tools(new_tools)
    
    # Persist the change
    session_manager.update_active_tools(agent.session_id, active_tool_ids)
    
    return agent

def add_tool_to_agent(agent, tool_id, session_manager):
    """
    Add single tool to existing agent without removing others
    
    Args:
        agent: Agent instance
        tool_id: Tool identifier to add
        session_manager: Session manager to persist state
    """
    # Get tool instance
    tool_instance = tool_registry.get_tools([tool_id])[0]
    
    # Add to agent
    agent.add_tool(tool_instance)
    
    # Update session
    current_tools = session_manager.get_active_tools(agent.session_id)
    current_tools.append(tool_id)
    session_manager.update_active_tools(agent.session_id, current_tools)
    
    return agent
```

### Custom Tool Creation

Create custom tools using the `@tool` decorator:[7][8]

```python
from agno.tools import tool

@tool
def execute_in_docker(command: str, container_name: str = "ubuntu") -> str:
    """
    Execute command in Docker container
    
    Args:
        command: Shell command to execute
        container_name: Container identifier
        
    Returns:
        Command output
    """
    # Your Docker execution logic here
    import subprocess
    result = subprocess.run(
        ["docker", "exec", container_name, "bash", "-c", command],
        capture_output=True,
        text=True
    )
    return result.stdout

# Register custom tool
tool_registry.register_custom_tool(
    "docker_exec",
    lambda: execute_in_docker
)
```

## Session and Chat History Management

### Database Configuration

Agno supports multiple database backends for persistent storage:[10][11][1]

```python
from agno.db.sqlite import SqliteDb
from agno.db.postgres import PostgresDb

class DatabaseManager:
    """Manage database connections for agents"""
    
    @staticmethod
    def get_sqlite_db(db_file="chat_app.db"):
        """Get SQLite database instance"""
        return SqliteDb(db_file=db_file)
    
    @staticmethod
    def get_postgres_db(connection_string):
        """Get PostgreSQL database instance"""
        return PostgresDb(
            db_url=connection_string,
            session_table="agent_sessions"
        )
```

### Session Manager Implementation

Create a session manager to handle chat history and state persistence:[11][12][10]

```python
from datetime import datetime
import json

class SessionManager:
    """
    Manages agent sessions, chat history, and configuration
    """
    
    def __init__(self, db):
        self.db = db
        self._session_cache = {}
    
    def create_session(self, user_id, agent_config):
        """
        Create new chat session
        
        Args:
            user_id: User identifier
            agent_config: Agent configuration dict
            
        Returns:
            session_id: Unique session identifier
        """
        session_id = f"{user_id}_{datetime.now().timestamp()}"
        
        session_data = {
            "session_id": session_id,
            "user_id": user_id,
            "agent_config": agent_config,
            "active_tools": agent_config.get("tool_ids", []),
            "model_provider": agent_config["model_provider"],
            "model_id": agent_config["model_id"],
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        self._persist_session(session_data)
        return session_id
    
    def get_session(self, session_id):
        """Retrieve session configuration"""
        if session_id in self._session_cache:
            return self._session_cache[session_id]
        
        # Load from database
        session_data = self._load_session(session_id)
        self._session_cache[session_id] = session_data
        return session_data
    
    def update_active_tools(self, session_id, tool_ids):
        """Update tools for a session"""
        session = self.get_session(session_id)
        session["active_tools"] = tool_ids
        session["updated_at"] = datetime.now().isoformat()
        self._persist_session(session)
    
    def update_model(self, session_id, provider, model_id):
        """Update model for a session"""
        session = self.get_session(session_id)
        session["model_provider"] = provider
        session["model_id"] = model_id
        session["updated_at"] = datetime.now().isoformat()
        self._persist_session(session)
    
    def get_chat_history(self, session_id, limit=None):
        """
        Retrieve chat history for session
        
        Args:
            session_id: Session identifier
            limit: Optional limit on number of messages
            
        Returns:
            List of message dictionaries
        """
        # Agno stores history in the database automatically
        # Access through agent.get_chat_history()
        pass
    
    def get_all_sessions(self, user_id):
        """Get all sessions for a user"""
        # Use db.get_all_sessions() or custom query
        pass
    
    def _persist_session(self, session_data):
        """Persist session to database"""
        # Implement database write logic
        pass
    
    def _load_session(self, session_id):
        """Load session from database"""
        # Implement database read logic
        pass
```

### Chat History Retrieval

Access chat history through the agent's built-in methods:[12][13]

```python
def get_agent_messages(agent, limit=None):
    """
    Retrieve formatted chat history
    
    Args:
        agent: Agent instance
        limit: Optional message limit
        
    Returns:
        List of message objects
    """
    # Get full chat history
    history = agent.get_chat_history()
    
    # Format for frontend
    formatted_messages = []
    for msg in history[-limit:] if limit else history:
        formatted_messages.append({
            "role": msg.role,
            "content": msg.content,
            "timestamp": msg.created_at,
            "tool_calls": getattr(msg, "tool_calls", None)
        })
    
    return formatted_messages

def load_agent_with_history(session_id, session_manager, db):
    """
    Load agent with existing chat history
    
    Args:
        session_id: Session identifier
        session_manager: Session manager instance
        db: Database instance
        
    Returns:
        Agent instance with loaded history
    """
    session = session_manager.get_session(session_id)
    
    agent = Agent(
        model=get_model(
            session["model_provider"],
            session["model_id"]
        ),
        tools=load_tools(session["active_tools"]),
        db=db,
        session_id=session_id,
        add_history_to_context=True,  # Critical: loads previous messages
        num_history_responses=20,  # Number of messages to include
        markdown=True
    )
    
    return agent
```

## Multi-Agent Teams

### Team Creation and Orchestration

Agno supports multi-agent teams with different orchestration modes:[14][15][8]

```python
from agno.team.team import Team

def create_agent_team(team_config):
    """
    Create collaborative agent team
    
    team_config structure:
    {
        "name": "Research Team",
        "mode": "route",  # or "collaborative"
        "members": [
            {"name": "Web Researcher", "tools": ["web_search"], "role": "..."},
            {"name": "Data Analyst", "tools": ["python"], "role": "..."}
        ],
        "leader_model": {"provider": "openai", "id": "gpt-4o"}
    }
    """
    
    # Create member agents
    members = []
    for member_config in team_config["members"]:
        agent = Agent(
            name=member_config["name"],
            role=member_config.get("role", ""),
            model=get_model(
                member_config.get("model", {}).get("provider", "openai"),
                member_config.get("model", {}).get("id", "gpt-4o")
            ),
            tools=load_tools(member_config.get("tools", [])),
            instructions=member_config.get("instructions", []),
            show_tool_calls=True,
            markdown=True
        )
        members.append(agent)
    
    # Create team with leader
    team = Team(
        name=team_config["name"],
        mode=team_config.get("mode", "route"),  # route or collaborative
        model=get_model(
            team_config["leader_model"]["provider"],
            team_config["leader_model"]["id"]
        ),
        members=members,
        instructions=team_config.get("instructions", []),
        show_members_responses=True,  # Show individual agent reasoning
        markdown=True
    )
    
    return team
```

### Team Execution Modes

Agno supports different team orchestration patterns:[15][14]

```python
# ROUTE MODE: Leader delegates to most appropriate member
route_team = Team(
    name="Customer Service Team",
    mode="route",  # Leader routes query to best member
    model=OpenAIChat(id="gpt-4o"),
    members=[billing_agent, support_agent, technical_agent],
    instructions=["Route queries to the most appropriate specialist"]
)

# COLLABORATIVE MODE: All members contribute
collaborative_team = Team(
    name="Research Collective",
    mode="collaborative",  # All members work together
    model=OpenAIChat(id="gpt-4o"),
    members=[web_researcher, data_analyst, report_writer],
    instructions=["Collaborate to produce comprehensive research"]
)
```

### Dynamic Team Management

Support runtime team composition changes:

```python
def update_team_members(team, new_member_configs):
    """
    Update team membership dynamically
    
    Args:
        team: Team instance
        new_member_configs: List of member configurations
    """
    new_members = [
        Agent(
            name=config["name"],
            role=config["role"],
            model=get_model(config["model"]["provider"], config["model"]["id"]),
            tools=load_tools(config["tools"])
        )
        for config in new_member_configs
    ]
    
    # Replace members
    team.members = new_members
    
    return team

def add_team_member(team, member_config):
    """Add single member to existing team"""
    new_member = Agent(
        name=member_config["name"],
        role=member_config["role"],
        model=get_model(member_config["model"]["provider"], member_config["model"]["id"]),
        tools=load_tools(member_config["tools"])
    )
    
    team.members.append(new_member)
    return team
```

## Model Switching

### Runtime Model Changes

Switch models dynamically while preserving context:[16]

```python
def switch_agent_model(agent, new_provider, new_model_id, session_manager):
    """
    Switch agent's language model at runtime
    
    Args:
        agent: Agent instance
        new_provider: New model provider
        new_model_id: New model identifier
        session_manager: Session manager to persist change
        
    Returns:
        Updated agent instance
    """
    # Create new model instance
    new_model = get_model(new_provider, new_model_id)
    
    # Update agent's model
    agent.model = new_model
    
    # Persist the change
    session_manager.update_model(
        agent.session_id,
        new_provider,
        new_model_id
    )
    
    return agent
```

**Important**: Cross-provider model switching should preserve message history in your database, but be aware that different providers may handle message formats differently.[16]

## Complete Integration Example

### Backend API Structure

```python
from fastapi import FastAPI, HTTPException
from agno.os import AgentOS
from typing import List, Optional

class AgentBackend:
    """
    Complete backend for desktop AI chat application
    """
    
    def __init__(self, db_file="chat_app.db"):
        self.db = SqliteDb(db_file=db_file)
        self.tool_registry = ToolRegistry()
        self.session_manager = SessionManager(self.db)
        self.active_agents = {}  # session_id -> agent mapping
        self.active_teams = {}   # team_id -> team mapping
    
    def create_agent_session(self, user_id, config):
        """
        Create new agent session
        
        Args:
            user_id: User identifier
            config: Agent configuration
            
        Returns:
            session_id and agent instance
        """
        session_id = self.session_manager.create_session(user_id, config)
        
        agent = Agent(
            name=config.get("name", "Assistant"),
            model=get_model(config["model_provider"], config["model_id"]),
            tools=self.tool_registry.get_tools(config.get("tool_ids", [])),
            db=self.db,
            session_id=session_id,
            description=config.get("personality", ""),
            instructions=config.get("instructions", []),
            add_history_to_context=True,
            markdown=True
        )
        
        self.active_agents[session_id] = agent
        return session_id, agent
    
    def load_agent_session(self, session_id):
        """Load existing agent session"""
        if session_id in self.active_agents:
            return self.active_agents[session_id]
        
        session = self.session_manager.get_session(session_id)
        agent = load_agent_with_history(session_id, self.session_manager, self.db)
        self.active_agents[session_id] = agent
        
        return agent
    
    def send_message(self, session_id, message, stream=False):
        """
        Send message to agent
        
        Args:
            session_id: Session identifier
            message: User message
            stream: Whether to stream response
            
        Returns:
            Agent response (generator if stream=True)
        """
        agent = self.load_agent_session(session_id)
        
        if stream:
            return agent.run(message, stream=True)
        else:
            response = agent.run(message)
            return response.content
    
    def toggle_tools(self, session_id, tool_ids):
        """Toggle agent tools at runtime"""
        agent = self.load_agent_session(session_id)
        return update_agent_tools(agent, tool_ids, self.session_manager)
    
    def switch_model(self, session_id, provider, model_id):
        """Switch agent model at runtime"""
        agent = self.load_agent_session(session_id)
        return switch_agent_model(agent, provider, model_id, self.session_manager)
    
    def create_team(self, team_config):
        """Create agent team"""
        team = create_agent_team(team_config)
        team_id = f"team_{datetime.now().timestamp()}"
        self.active_teams[team_id] = team
        return team_id, team
    
    def send_team_message(self, team_id, message):
        """Send message to agent team"""
        team = self.active_teams.get(team_id)
        if not team:
            raise ValueError(f"Team {team_id} not found")
        
        response = team.run(message)
        return {
            "content": response.content,
            "member_responses": [
                {
                    "agent": member.name,
                    "response": member.get_chat_history()[-1].content
                }
                for member in team.members
            ]
        }

# FastAPI Integration
app = FastAPI()
backend = AgentBackend()

@app.post("/sessions/create")
async def create_session(user_id: str, config: dict):
    session_id, agent = backend.create_agent_session(user_id, config)
    return {"session_id": session_id}

@app.post("/sessions/{session_id}/message")
async def send_message(session_id: str, message: str):
    response = backend.send_message(session_id, message)
    return {"response": response}

@app.post("/sessions/{session_id}/tools")
async def update_tools(session_id: str, tool_ids: List[str]):
    backend.toggle_tools(session_id, tool_ids)
    return {"status": "updated"}

@app.post("/sessions/{session_id}/model")
async def switch_model(session_id: str, provider: str, model_id: str):
    backend.switch_model(session_id, provider, model_id)
    return {"status": "updated"}
```

## Key API Methods Reference

### Agent Methods

- `agent.run(message, stream=False)`: Execute agent with message[2][1]
- `agent.print_response(message, stream=False)`: Print response to console[3][1]
- `agent.get_chat_history()`: Retrieve conversation history[12]
- `agent.set_tools(tools)`: Replace all agent tools[8]
- `agent.add_tool(tool)`: Add single tool to agent[8]
- `agent.memory.messages`: Access message list directly[11]

### Team Methods

- `team.run(message)`: Execute team on message[15]
- `team.members`: Access team member agents[15]
- `team.set_tools(tools)`: Set tools available to entire team[8]

### Database Methods

- `db.get_all_sessions()`: Retrieve all sessions[10]
- `db.get_all_session_ids()`: Get session identifiers[10]

## Best Practices

### Memory Management

Configure appropriate history context windows to balance performance and context:[11]

```python
agent = Agent(
    add_history_to_context=True,
    num_history_responses=10,  # Last 10 exchanges
)
```

### Tool Security

Implement permission checks before tool activation, especially for Docker and file system access.[9]

### Session Isolation

Always use unique `session_id` values to prevent context mixing between users and conversations.[17][10]

### Error Handling

Wrap agent calls in try-except blocks to handle model failures gracefully:

```python
try:
    response = agent.run(message)
except Exception as e:
    # Fallback logic or error reporting
    pass
```

## Marketplace Integration

### Custom Agent Templates

Save agent configurations as templates for marketplace distribution:

```python
def save_agent_template(agent_config, metadata):
    """
    Save agent configuration as reusable template
    
    Args:
        agent_config: Agent configuration dict
        metadata: Template metadata (name, description, tags)
    """
    template = {
        "version": "1.0",
        "metadata": metadata,
        "config": agent_config
    }
    # Persist to marketplace database
    return template
```

### Tool Packaging

Package custom tools for distribution:

```python
def package_tool(tool_function, metadata):
    """
    Package custom tool for marketplace
    
    Args:
        tool_function: Tool implementation
        metadata: Tool metadata
    """
    return {
        "id": metadata["id"],
        "name": metadata["name"],
        "description": metadata["description"],
        "factory": tool_function,
        "version": metadata["version"]
    }
```


## Agent Instance Management: Per-Request Pattern

### Recommended Approach

**Always create a fresh agent instance for each incoming request**, even when using the same database and session. While this may seem counterintuitive, it's the pattern recommended by the Agno team and prevents potential state contamination issues.[9][10]

### Why Fresh Instances Per Request?

Agent instances maintain internal state beyond just message history, including `run_response`, `session_state`, and other runtime attributes. When reusing the same agent object across multiple requests—especially in concurrent environments—these attributes can leak between requests, leading to unpredictable behavior.[10][9]

The database handles persistence, not the agent object. When you create a new agent with the same `session_id`, it automatically loads the complete conversation history from the shared database, making instance creation effectively stateless from the user's perspective.[11]

### Performance Considerations

Creating agent instances is **lightweight and fast**. The overhead comes primarily from:

- Database connection (reused via connection pooling)
- Loading configuration from your session manager
- Instantiating model clients (minimal overhead)

This is negligible compared to the actual LLM inference time, which dominates request latency.[9]

### Implementation Pattern

#### ✅ Recommended: Fresh Instance Per Request

```python
class AgentBackend:
    def __init__(self, db_file="agents.db"):
        # Shared resources
        self.db = SqliteDb(db_file=db_file)
        self.tool_registry = ToolRegistry()
        self.session_manager = SessionManager(self.db)
        
        # NO agent instance cache
    
    def send_message(self, session_id, message):
        """Create fresh agent for each request"""
        # Load session configuration
        session = self.session_manager.get_session(session_id)
        
        # Create new agent instance
        agent = Agent(
            model=get_model(
                session["model_provider"],
                session["model_id"]
            ),
            tools=self.tool_registry.get_tools(session["active_tools"]),
            db=self.db,  # Shared database
            session_id=session_id,  # Unique per conversation
            add_history_to_context=True,  # Loads history automatically
            num_history_responses=20,
            markdown=True
        )
        
        # Execute and return
        response = agent.run(message)
        return response.content
```

### Concurrency Considerations

The per-request pattern is especially critical in multi-threaded environments. While message history remains properly isolated by `session_id`, session state attributes can mix when the same agent instance is accessed concurrently.[10]

**Safe concurrency patterns**:
- Create agent instance per request (recommended)
- Use multiprocessing instead of threading
- Ensure no shared agent instances across threads

===


This documentation provides the foundation for building a flexible, desktop-first AI chat application using Agno's Python APIs. The framework's declarative approach, combined with persistent storage and dynamic configuration, enables the unprecedented flexibility described in your vision.[18][1][2]

[1](https://github.com/agno-agi/agno)
[2](https://workos.com/blog/agno-the-agent-framework-for-python-teams)
[3](https://console.groq.com/docs/agno)
[4](https://docs.aimlapi.com/integrations/agno)
[5](https://docs.agno.com/examples/concepts/agent/context_management/instructions_via_function)
[6](https://docs.tavily.com/documentation/integrations/agno)
[7](https://docs.agno.com/examples/concepts/tools/others/custom_api)
[8](https://docs-v1.agno.com/tools/attaching-tools)
[9](https://github.com/agno-agi/agno/issues/4161)
[10](https://github.com/agno-agi/agno/discussions/3168)
[11](https://www.bitdoze.com/agno-get-start/)
[12](https://docs.agno.com/examples/concepts/agent/session/05_chat_history)
[13](https://docs.agno.com/examples/concepts/teams/session/chat_history)
[14](https://getstream.io/blog/xai-python-multi-agent/)
[15](https://github.com/agno-agi/phidata)
[16](https://docs.agno.com/faq/switching-models)
[17](https://github.com/agno-agi/agno/issues/3514)
[18](https://docs.agno.com)
[19](https://github.com/agno-agi)
[20](https://docs.agno.com/introduction/quickstart)
[21](https://docs.together.ai/docs/agno)
[22](https://www.agno.com)
[23](https://bestaiagents.ai/agent/agno)
[24](https://github.com/agno-agi/agno/issues/4024)
[25](https://pypi.org/project/agno/1.1.1/)
[26](https://pypi.org/project/agno/1.2.3/)
[27](https://www.linkedin.com/posts/rayan-ibrahim-benatallah-32848223b_feat-add-utility-function-to-dynamically-activity-7329279981086208000-ZlLF)
[28](https://surrealdb.com/blog/multi-tool-agent-with-surrealmcp-and-agno)
[29](https://www.elightwalk.com/blog/ollama-agno-ai-agent)
[30](https://docs.langtrace.ai/supported-integrations/llm-frameworks/agno)
[31](https://www.linkedin.com/pulse/working-example-how-i-built-multi-agent-ai-tool-seo-agno-thomsen-mgdre)
[32](https://www.youtube.com/watch?v=Vn3JO83owcM)
[33](https://www.marketcalls.in/python/building-a-multi-agent-financial-news-system-with-agno-and-agent-ui.html)
[34](https://www.linkedin.com/posts/ashpreetbedi_today-were-releasing-agno-20-and-sharing-activity-7371241593552392192-x4pH)
[35](https://pypi.org/project/agno/1.5.0/)
[36](https://www.youtube.com/watch?v=-lEvd6JYafY)
[37](https://www.zenml.io/blog/agno-vs-langgraph)