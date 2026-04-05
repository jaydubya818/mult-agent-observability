# Multi-Agent Observability System

Real-time monitoring and visualization for Claude Code agents through comprehensive hook event tracking. Watch the [latest deep dive on multi-agent orchestration with Opus 4.6 here](https://youtu.be/RpUTF_U4kiw). With Claude Opus 4.6 and multi-agent orchestration, you can now spin up teams of specialized agents that work in parallel, and this observability system lets you trace every tool call, task handoff, and agent lifecycle event across the entire swarm.

## 🎯 Overview

This system provides complete observability into Claude Code agent behavior by capturing, storing, and visualizing Claude Code [Hook events](https://docs.anthropic.com/en/docs/claude-code/hooks) in real-time. It enables monitoring of multiple concurrent agents with session tracking, event filtering, and live updates. 

<img src="images/app.png" alt="Multi-Agent Observability Dashboard" style="max-width: 800px; width: 100%;">

## 🏗️ Architecture

```
Claude Agents → Hook Scripts → HTTP POST → Bun Server → SQLite → WebSocket → Vue Client
```

![Agent Data Flow Animation](images/AgentDataFlowV2.gif)

## 📋 Setup Requirements

Before getting started, ensure you have the following installed:

- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI for Claude
- **[Astral uv](https://docs.astral.sh/uv/)** - Fast Python package manager (required for hook scripts)
- **[Bun](https://bun.sh/)** - For running the server (install via `curl -fsSL https://bun.sh/install | bash`)
- **[just](https://github.com/casey/just)** (optional) - Command runner for project recipes
- **Anthropic API Key** - Set as `ANTHROPIC_API_KEY` environment variable
- **OpenAI API Key** (optional) - For multi-model support with just-prompt MCP tool
- **ElevenLabs API Key** (optional) - For audio features
- **Firecrawl API Key** (optional) - For web scraping features

### Configure .claude Directory

To setup observability in your repo,we need to copy the .claude directory to your project root.

To integrate the observability hooks into your projects:

1. **Copy the entire `.claude` directory to your project root:**
   ```bash
   cp -R .claude /path/to/your/project/
   ```

2. **Update the `settings.json` configuration:**
   
   Open `.claude/settings.json` in your project and modify the `source-app` parameter to identify your project:
   
   ```json
   {
     "hooks": {
       "PreToolUse": [{
         "matcher": "",
         "hooks": [
           {
             "type": "command",
             "command": "uv run .claude/hooks/pre_tool_use.py"
           },
           {
             "type": "command",
             "command": "uv run .claude/hooks/send_event.py --source-app YOUR_PROJECT_NAME --event-type PreToolUse --summarize"
           }
         ]
       }],
       "PostToolUse": [{
         "matcher": "",
         "hooks": [
           {
             "type": "command",
             "command": "uv run .claude/hooks/post_tool_use.py"
           },
           {
             "type": "command",
             "command": "uv run .claude/hooks/send_event.py --source-app YOUR_PROJECT_NAME --event-type PostToolUse --summarize"
           }
         ]
       }],
       "UserPromptSubmit": [{
         "hooks": [
           {
             "type": "command",
             "command": "uv run .claude/hooks/user_prompt_submit.py --log-only"
           },
           {
             "type": "command",
             "command": "uv run .claude/hooks/send_event.py --source-app YOUR_PROJECT_NAME --event-type UserPromptSubmit --summarize"
           }
         ]
       }]
       // ... (similar patterns for all 12 hook events: Notification, Stop, SubagentStop,
      //      SubagentStart, PreCompact, SessionStart, SessionEnd, PermissionRequest, PostToolUseFailure)
     }
   }
   ```
   
   Replace `YOUR_PROJECT_NAME` with a unique identifier for your project (e.g., `my-api-server`, `react-app`, etc.).

3. **Ensure the observability server is running:**
   ```bash
   # From the observability project directory (this codebase)
   ./scripts/start-system.sh
   ```

Now your project will send events to the observability system whenever Claude Code performs actions.

## 🌍 System-Wide Setup (Recommended)

The per-project approach above only captures events when Claude Code is running inside that specific directory. For full observability across **every** Claude Code session — regardless of which project you're working in — set up global hooks and an auto-starting server.

### Global Hooks

Merge the observability hooks into your **global** `~/.claude/settings.json` so all sessions stream to the dashboard. Run this one-time script, replacing the path with wherever you cloned this repo:

```bash
HOOKS_DIR="$HOME/Multi-Agent-Observability/claude-code-hooks-multi-agent-observability/.claude/hooks"
UV="/Library/Frameworks/Python.framework/Versions/3.13/bin/uv"  # adjust if needed: $(which uv)

python3 << EOF
import json

hooks_dir = "$HOOKS_DIR"
uv = "$UV"
source_app = "cc-hook-multi-agent-obvs"

def obs_hook(event_type, extra=""):
    cmd = f"{uv} run {hooks_dir}/send_event.py --source-app {source_app} --event-type {event_type}"
    if extra: cmd += f" {extra}"
    return {"type": "command", "command": cmd, "timeout": 5}

obs = {
    "PreToolUse":         obs_hook("PreToolUse", "--summarize"),
    "PostToolUse":        obs_hook("PostToolUse", "--summarize"),
    "Notification":       obs_hook("Notification", "--summarize"),
    "Stop":               obs_hook("Stop", "--add-chat"),
    "SubagentStop":       obs_hook("SubagentStop"),
    "PreCompact":         obs_hook("PreCompact"),
    "UserPromptSubmit":   obs_hook("UserPromptSubmit", "--summarize"),
    "SessionStart":       obs_hook("SessionStart"),
    "SessionEnd":         obs_hook("SessionEnd"),
    "PermissionRequest":  obs_hook("PermissionRequest", "--summarize"),
    "PostToolUseFailure": obs_hook("PostToolUseFailure", "--summarize"),
    "SubagentStart":      obs_hook("SubagentStart"),
}

cfg_path = f"{__import__('os').path.expanduser('~')}/.claude/settings.json"
with open(cfg_path) as f: cfg = json.load(f)
hooks = cfg.setdefault("hooks", {})

for event_type, hook_cmd in obs.items():
    if event_type not in hooks:
        hooks[event_type] = [{"matcher": "", "hooks": [hook_cmd]}]
    else:
        already = any(
            h.get("command", "").startswith(f"{uv} run {hooks_dir}/send_event.py")
            for entry in hooks[event_type]
            for h in entry.get("hooks", [])
        )
        if not already:
            hooks[event_type].append({"matcher": "", "hooks": [hook_cmd]})

with open(cfg_path, "w") as f: json.dump(cfg, f, indent=2)
print("Done — observability hooks merged into ~/.claude/settings.json")
EOF
```

After running this, every new Claude Code session (in any project) will automatically send events to `http://localhost:4000/events`.

### Auto-Start Server (macOS launchd)

Rather than manually starting the server each time, register it as a launchd agent so it launches at login and restarts automatically if it crashes.

A ready-to-use plist is included at `deploy/com.jaywest.multi-agent-observability.plist`. Install it with:

```bash
# 1. Copy the plist (edit the paths inside if your username or repo location differs)
cp deploy/com.jaywest.multi-agent-observability.plist ~/Library/LaunchAgents/

# 2. Load it (starts immediately and on every future login)
launchctl load ~/Library/LaunchAgents/com.jaywest.multi-agent-observability.plist

# 3. Verify it's running
launchctl list | grep multi-agent-observability
# Should show a PID (first column) and exit code 0 (second column)

# 4. Check logs
tail -f ~/Library/Logs/multi-agent-observability.log
```

To stop or uninstall:
```bash
launchctl unload ~/Library/LaunchAgents/com.jaywest.multi-agent-observability.plist
```

The plist uses `KeepAlive: true`, so the server restarts automatically on crash. Logs go to `~/Library/Logs/multi-agent-observability.log` and `~/Library/Logs/multi-agent-observability-error.log`.

> **Note**: The `deploy/` plist file uses hardcoded paths for `jaywest`. If your username or repo location differs, edit the `WorkingDirectory`, `ProgramArguments`, `StandardOutPath`, and `StandardErrorPath` keys before loading.

## 🚀 Quick Start

You can quickly view how this works by running this repository's `.claude` setup.

```bash
# 1. Start both server and client
just start          # or: ./scripts/start-system.sh

# 2. Open http://localhost:5173 in your browser

# 3. Open Claude Code and run the following command:
Run git ls-files to understand the codebase.

# 4. Watch events stream in the client

# 5. Copy the .claude folder to other projects you want to emit events from.
cp -R .claude <directory of your codebase you want to emit events from>
```

### Using `just` (Recommended)

A `justfile` provides convenient recipes for common operations:

```bash
just              # List all available recipes
just start        # Start server + client
just stop         # Stop all processes
just restart      # Stop then start
just server       # Start server only (dev mode)
just client       # Start client only
just install      # Install all dependencies
just health       # Check server/client status
just test-event   # Send a test event
just db-reset     # Reset the database
just hooks        # List all hook scripts
just open         # Open dashboard in browser
```

## 📁 Project Structure

```
claude-code-hooks-multi-agent-observability/
│
├── apps/                    # Application components
│   ├── server/             # Bun TypeScript server
│   │   ├── src/
│   │   │   ├── index.ts    # Main server with HTTP/WebSocket endpoints
│   │   │   ├── db.ts       # SQLite database management & migrations
│   │   │   └── types.ts    # TypeScript interfaces
│   │   ├── package.json
│   │   └── events.db       # SQLite database (gitignored)
│   │
│   └── client/             # Vue 3 TypeScript client
│       ├── src/
│       │   ├── App.vue     # Main app with theme & WebSocket management
│       │   ├── components/
│       │   │   ├── EventTimeline.vue      # Event list with auto-scroll
│       │   │   ├── EventRow.vue           # Individual event display
│       │   │   ├── FilterPanel.vue        # Multi-select filters
│       │   │   ├── ChatTranscriptModal.vue # Chat history viewer
│       │   │   ├── StickScrollButton.vue  # Scroll control
│       │   │   └── LivePulseChart.vue     # Real-time activity chart
│       │   ├── composables/
│       │   │   ├── useWebSocket.ts        # WebSocket connection logic
│       │   │   ├── useEventColors.ts      # Color assignment system
│       │   │   ├── useChartData.ts        # Chart data aggregation
│       │   │   └── useEventEmojis.ts      # Event type emoji mapping
│       │   ├── utils/
│       │   │   └── chartRenderer.ts       # Canvas chart rendering
│       │   └── types.ts    # TypeScript interfaces
│       ├── .env.sample     # Environment configuration template
│       └── package.json
│
├── .claude/                # Claude Code integration
│   ├── hooks/             # Hook scripts (Python with uv)
│   │   ├── send_event.py          # Universal event sender (all 12 event types)
│   │   ├── pre_tool_use.py        # Tool validation, blocking & summarization
│   │   ├── post_tool_use.py       # Result logging with MCP tool detection
│   │   ├── post_tool_use_failure.py # Tool failure logging
│   │   ├── permission_request.py  # Permission request logging
│   │   ├── notification.py        # User interaction events (type-aware TTS)
│   │   ├── user_prompt_submit.py  # User prompt logging & validation
│   │   ├── stop.py               # Session completion (stop_hook_active guard)
│   │   ├── subagent_stop.py      # Subagent completion with transcript path
│   │   ├── subagent_start.py     # Subagent lifecycle start tracking
│   │   ├── pre_compact.py        # Context compaction with custom instructions
│   │   ├── session_start.py      # Session start with agent type & model
│   │   ├── session_end.py        # Session end with reason tracking
│   │   └── validators/           # Stop hook validators
│   │       ├── validate_new_file.py     # Validate file creation
│   │       └── validate_file_contains.py # Validate file content sections
│   │
│   ├── agents/team/       # Agent team definitions
│   │   ├── builder.md     # Engineering agent with linting hooks
│   │   └── validator.md   # Read-only validation agent
│   │
│   ├── commands/          # Custom slash commands
│   │   └── plan_w_team.md # Team-based planning command
│   │
│   ├── status_lines/      # Status line scripts
│   │   └── status_line_v6.py # Context window usage display
│   │
│   └── settings.json      # Hook configuration (all 12 events)
│
├── deploy/                # Deployment helpers
│   └── com.jaywest.multi-agent-observability.plist  # macOS launchd agent (auto-start server)
│
├── justfile               # Task runner recipes (just start, just stop, etc.)
│
├── scripts/               # Utility scripts
│   ├── start-system.sh   # Launch server & client
│   ├── reset-system.sh   # Stop all processes
│   └── test-system.sh    # System validation
│
└── logs/                 # Application logs (gitignored)
```

## 🔧 Component Details

### 1. Hook System (`.claude/hooks/`)

> If you want to master claude code hooks watch [this video](https://github.com/disler/claude-code-hooks-mastery)

The hook system intercepts Claude Code lifecycle events:

- **`send_event.py`**: Core script that sends event data to the observability server
  - Supports all 12 hook event types with event-specific field forwarding
  - Supports `--add-chat` flag for including conversation history
  - Forwards event-specific fields (`tool_name`, `tool_use_id`, `agent_id`, `notification_type`, etc.) as top-level properties for easier querying
  - Validates server connectivity before sending

- **Event-specific hooks** (12 total): Each implements validation and data extraction
  - `pre_tool_use.py`: Blocks dangerous commands, validates tool usage, summarizes tool inputs per tool type
  - `post_tool_use.py`: Captures execution results with MCP tool detection (`mcp_server`, `mcp_tool_name`)
  - `post_tool_use_failure.py`: Logs tool execution failures
  - `permission_request.py`: Logs permission request events
  - `notification.py`: Tracks user interactions with `notification_type`-aware TTS (permission_prompt, idle_prompt, etc.)
  - `user_prompt_submit.py`: Logs user prompts, supports validation with JSON `{"decision": "block"}` pattern
  - `stop.py`: Records session completion with `stop_hook_active` guard to prevent infinite loops
  - `subagent_stop.py`: Monitors subagent task completion with transcript path tracking
  - `subagent_start.py`: Tracks subagent lifecycle start events
  - `pre_compact.py`: Tracks context compaction with custom instructions in backup filenames
  - `session_start.py`: Logs session start with `agent_type`, `model`, and `source` fields
  - `session_end.py`: Logs session end with reason tracking (including `bypass_permissions_disabled`)

### 2. Server (`apps/server/`)

Bun-powered TypeScript server with real-time capabilities:

- **Database**: SQLite with WAL mode for concurrent access
- **Endpoints**:
  - `POST /events` - Receive events from agents
  - `GET /events/recent` - Paginated event retrieval with filtering
  - `GET /events/filter-options` - Available filter values
  - `WS /stream` - Real-time event broadcasting
- **Features**:
  - Automatic schema migrations
  - Event validation
  - WebSocket broadcast to all clients
  - Chat transcript storage

### 3. Client (`apps/client/`)

Vue 3 application with real-time visualization:

- **Visual Design**:
  - Dual-color system: App colors (left border) + Session colors (second border)
  - Gradient indicators for visual distinction
  - Dark/light theme support
  - Responsive layout with smooth animations

- **Features**:
  - Real-time WebSocket updates
  - Multi-criteria filtering (app, session, event type)
  - Live pulse chart with session-colored bars and event type indicators
  - Time range selection (1m, 3m, 5m) with appropriate data aggregation
  - Chat transcript viewer with syntax highlighting
  - Auto-scroll with manual override
  - Event limiting (configurable via `VITE_MAX_EVENTS_TO_DISPLAY`)

- **Tool Emoji System**:
  - Each tool type has a dedicated emoji (Bash: 💻, Read: 📖, Write: ✍️, Edit: ✏️, Task: 🤖, etc.)
  - Tool events show combo emojis: event emoji + tool emoji (e.g., 🔧💻 for PreToolUse:Bash)
  - MCP tools display with 🔌 prefix
  - Tool name badge displayed alongside event type in the timeline

- **Live Pulse Chart**:
  - Canvas-based real-time visualization
  - Session-specific colors for each bar
  - Event type + tool combo emojis displayed on bars
  - Smooth animations and glow effects
  - Responsive to filter changes

## 🔄 Data Flow

1. **Event Generation**: Claude Code executes an action (tool use, notification, etc.)
2. **Hook Activation**: Corresponding hook script runs based on `settings.json` configuration
3. **Data Collection**: Hook script gathers context (tool name, inputs, outputs, session ID)
4. **Transmission**: `send_event.py` sends JSON payload to server via HTTP POST
5. **Server Processing**:
   - Validates event structure
   - Stores in SQLite with timestamp
   - Broadcasts to WebSocket clients
6. **Client Update**: Vue app receives event and updates timeline in real-time

## 🎨 Event Types & Visualization

| Event Type         | Emoji | Purpose                | Color Coding  | Special Display                      |
| ------------------ | ----- | ---------------------- | ------------- | ------------------------------------ |
| PreToolUse         | 🔧     | Before tool execution  | Session-based | Tool name + tool emoji & details     |
| PostToolUse        | ✅     | After tool completion  | Session-based | Tool name + tool emoji & results     |
| PostToolUseFailure | ❌     | Tool execution failed  | Session-based | Error details & interrupt status     |
| PermissionRequest  | 🔐     | Permission requested   | Session-based | Tool name & permission suggestions   |
| Notification       | 🔔     | User interactions      | Session-based | Notification message & type          |
| Stop               | 🛑     | Response completion    | Session-based | Summary & chat transcript            |
| SubagentStart      | 🟢     | Subagent started       | Session-based | Agent ID & type                      |
| SubagentStop       | 👥     | Subagent finished      | Session-based | Agent details & transcript path      |
| PreCompact         | 📦     | Context compaction     | Session-based | Trigger & custom instructions        |
| UserPromptSubmit   | 💬     | User prompt submission | Session-based | Prompt: _"user message"_ (italic)    |
| SessionStart       | 🚀     | Session started        | Session-based | Source, model & agent type           |
| SessionEnd         | 🏁     | Session ended          | Session-based | End reason (clear/logout/exit/other) |

### UserPromptSubmit Event (v1.0.54+)

The `UserPromptSubmit` hook captures every user prompt before Claude processes it. In the UI:
- Displays as `Prompt: "user's message"` in italic text
- Shows the actual prompt content inline (truncated to 100 chars)
- Summary appears on the right side when AI summarization is enabled
- Useful for tracking user intentions and conversation flow

## 🔌 Integration

### For New Projects

1. Copy the event sender:
   ```bash
   cp .claude/hooks/send_event.py YOUR_PROJECT/.claude/hooks/
   ```

2. Add to your `.claude/settings.json`:
   ```json
   {
     "hooks": {
       "PreToolUse": [{
         "matcher": ".*",
         "hooks": [{
           "type": "command",
           "command": "uv run .claude/hooks/send_event.py --source-app YOUR_APP --event-type PreToolUse"
         }]
       }]
     }
   }
   ```

### For This Project

Already integrated! Hooks run both validation and observability:
```json
{
  "type": "command",
  "command": "uv run .claude/hooks/pre_tool_use.py"
},
{
  "type": "command",
  "command": "uv run .claude/hooks/send_event.py --source-app cc-hook-multi-agent-obvs --event-type PreToolUse"
}
```

## 🧪 Testing

```bash
# System validation
./scripts/test-system.sh

# Quick test event via just
just test-event

# Check server/client health
just health

# Manual event test
curl -X POST http://localhost:4000/events \
  -H "Content-Type: application/json" \
  -d '{
    "source_app": "test",
    "session_id": "test-123",
    "hook_event_type": "PreToolUse",
    "payload": {"tool_name": "Bash", "tool_input": {"command": "ls"}}
  }'

# Test a hook script directly
just hook-test pre_tool_use
```

## ⚙️ Configuration

### Environment Variables

Copy `.env.sample` to `.env` in the project root and fill in your API keys:

**Application Root** (`.env` file):
- `ANTHROPIC_API_KEY` – Anthropic Claude API key (required for LLM summarization)
- `ENGINEER_NAME` – Your name (for personalized TTS completion messages)
- `OPENAI_API_KEY` – OpenAI API key (optional, enables gpt-4.1-nano TTS + summaries)
- `ELEVENLABS_API_KEY` – ElevenLabs API key (optional, highest-priority TTS)
- `FIRECRAWL_API_KEY` – Firecrawl API key (optional, for web scraping)
- `E2B_API_KEY` – E2B cloud sandbox key (optional, required for [Agent Sandbox Skill](https://github.com/disler/agent-sandbox-skill))

**Hook behavior** (optional):
- `CLAUDE_HOOKS_ENABLE_CACHING=1` – Cache model extraction per session to reduce transcript re-reads (default: off)

**Orchestration local-process policy** (`ORCH_LP_*` env vars, all optional):
- `ORCH_LP_CMD_ALLOWLIST` – Comma-separated list of allowed command basenames (default: all allowed)
- `ORCH_LP_CMD_DENYLIST` – Extra commands to deny beyond built-in defaults (`curl`, `wget`, `ssh`, etc.)
- `ORCH_LP_MAX_MS` – Max runtime per task in ms (default: `300000`)
- `ORCH_LP_MAX_CONCURRENT` – Max concurrent subprocesses per team (default: `4`)
- `ORCH_LP_CWD_ALLOWLIST` – Comma-separated root paths agents may use as cwd
- `ORCH_LP_ALLOW_UNSPECIFIED_CWD` – Set to `0` to require agents to declare an explicit cwd (default: `1`)
- `ORCH_LP_ENV_ALLOWLIST` – Comma-separated env key prefixes agents may inject
- `ORCH_LP_MAX_OUTPUT_BYTES` – Max stdout+stderr bytes per run (default: `256000`)

**Client** (`.env` file in `apps/client/.env`):
- `VITE_MAX_EVENTS_TO_DISPLAY=300` – Maximum events shown in the timeline (oldest removed when exceeded)

### Server Ports

- Server: `4000` (HTTP/WebSocket)
- Client: `5173` (Vite dev server)

## 🤖 Agent Teams

This project supports Claude Code Agent Teams for orchestrating multi-agent workflows. Teams are enabled via the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` environment variable in `.claude/settings.json`.

### Team Agents

- **Builder** (`.claude/agents/team/builder.md`): Engineering agent that executes one task at a time. Includes PostToolUse hooks for `ruff` and `ty` validation on Write/Edit operations.
- **Validator** (`.claude/agents/team/validator.md`): Read-only validation agent that inspects work without modifying files. Cannot use Write, Edit, or NotebookEdit tools.

### Planning with Teams

Use the `/plan_w_team` slash command to create team-based implementation plans:

```bash
/plan_w_team "Add a new feature for X"
```

This generates a spec document in `specs/` with task breakdowns, team member assignments, dependencies, and acceptance criteria. Plans are validated by Stop hook validators that ensure required sections are present.

Execute a plan with:
```bash
/build specs/<plan-name>.md
```

## 🔭 Multi-Agent Orchestration & Observability

[![Multi-Agent Orchestration with Claude Code](images/claude-code-multi-agent-orchestration.png)](https://youtu.be/RpUTF_U4kiw)

The true constraint of agentic engineering is no longer what the models can do — it's our ability to prompt engineer and context engineer the outcomes we need, and build them into reusable systems. Multi-agent orchestration changes the game by letting you spin up teams of specialized agents that each focus on one task extraordinarily well, work in parallel, and shut down when done. See the official [Claude Code Agent Teams documentation](https://code.claude.com/docs/en/agent-teams) for the full reference.

### The Orchestration Workflow

The full multi-agent orchestration lifecycle follows this pattern:

1. **Create a team** — `TeamCreate` sets up the coordination layer
2. **Create tasks** — `TaskCreate` builds the centralized task list that drives all work
3. **Spawn agents** — `Task` deploys specialized agents (builder, validator, etc.) into their own Tmux panes with independent context windows
4. **Work in parallel** — Agents execute their assigned tasks simultaneously, communicating via `SendMessage`
5. **Shut down agents** — Completed agents are gracefully terminated
6. **Delete the team** — `TeamDelete` cleans up all coordination state

### Why Observability Matters

When you have multiple agents running in parallel — each with their own context window, session ID, and task assignments — you need visibility into what's happening across the swarm. Without observability, you're vibe coding at scale. With it, you can:

- **Trace every tool call** across all agents in real-time via the dashboard
- **Filter by agent swim lane** to inspect individual agent behavior
- **Track task lifecycle** — see TaskCreate, TaskUpdate, and SendMessage events flow between agents
- **Spot failures early** — PostToolUseFailure and PermissionRequest events surface issues before they cascade
- **Measure throughput** — the live pulse chart shows activity density across your agent fleet

This is what separates engineers from vibe coders: understanding what's happening underneath the hood so you can scale compute to scale impact with confidence.

### In-repo orchestration service (API + UI)

Beyond hook events, this codebase ships a **SQLite-backed orchestration layer** in the Bun server: teams, agents, tasks, execution policies, task runs, and an admin mutation audit log. The Vue client exposes an **Orchestration** view for boards, task detail, and live snapshot data.

| Topic | Where to read |
|--------|----------------|
| HTTP routes, snapshot shape, admin token | [Technical design — multi-agent orchestration](docs/technical-design-multi-agent-orchestration.md) |
| Retention / pruning (`ORCH_*` env vars) | Design doc §6.3 (startup prune + `POST /api/orchestration/admin/prune-history`) |
| Product / delivery context | [PRD](docs/PRD-multi-agent-orchestration.md), [implementation plan](docs/implementation-plan-multi-agent-orchestration.md) |

**Quick checks**

- Server tests (orchestration): `cd apps/server && bun test src/orchestration`
- **`ORCH_ADMIN_TOKEN`:** When set, **protected mode** — browser/client must send the same value as `x-orchestration-admin-token` or `Authorization: Bearer …` on gated routes. When unset, **open mode** (local default). Admin **read** routes: `GET /api/orchestration/admin-audit`, `GET /api/orchestration/admin/retention-config` (effective retention limits; does not run prune). See [technical design §6](docs/technical-design-multi-agent-orchestration.md).
- Optional **retention** env: `ORCH_ADMIN_AUDIT_*`, `ORCH_TASK_RUNS_*`, `ORCH_TASK_RUN_HISTORY_*` (live vs archived tables; per-field fallback for history — see design doc §6.3). Apply prune: startup + `POST /api/orchestration/admin/prune-history`.
- Optional **retry** env: `ORCH_TASK_MAX_ATTEMPTS` (default 1 = no retry), `ORCH_TASK_RETRY_BACKOFF_MS` (default 1000; exponential backoff before re-queue — see design doc §6.4)

Copy [`.env.sample`](.env.sample) for orchestration-related variables (`ORCH_ADMIN_TOKEN`, retention, retry, local-process policy).

## 🛡️ Security Features

- Blocks dangerous `rm` commands via `deny_tool()` JSON pattern — uses both regex and `shlex`-based token parsing to catch all flag permutations (`rm -rf`, `rm -r -f`, `rm -v -r path -f`, `rm --recursive --force`, etc.); allowed only in whitelisted directories
- Prevents access to sensitive files (`.env`, private keys)
- `stop_hook_active` guard in `stop.py` and `subagent_stop.py` prevents infinite hook loops
- Stop hook validators ensure plan files contain required sections before completion
- Local-process execution policies enforce command allow/denylists, cwd roots, and output byte caps for orchestrated agents
- Validates all inputs before execution

## 🤖 Multi-Agent Orchestration Support

The observability server automatically detects and tracks Claude Code's experimental agent teams feature. When you enable agent teams with:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
clio  # or claude
```

The server automatically ingests team lifecycle events and agent communication patterns in real-time.

### Auto-Ingested Team Lifecycle Events

The system tracks the complete multi-agent orchestration workflow:

- **`team_create`** → Creates a team record in the orchestration DB, setting up the coordination layer
- **`team_delete`** → Marks team as stopped, all agents completed
- **`task_create`** → Creates task record linked to the team, building the centralized task list
- **`task_update`** → Updates task status (maps Claude's status names to internal statuses)
- **`task_list`** / **`task_get`** → Query operations for task introspection
- **`send_message`** → Records inter-agent communication in message thread

These events are automatically tagged with `_agent_team_tool: true` and `_tool_category: 'agent_team'` for easy server-side identification.

### Per-Agent Context Tracking

Each agent spawned into its own Tmux pane has independent observability:

- **Model type** (Haiku / Sonnet / Opus) shown as colored badge
- **Context window %** shown as progress bar (red when > 90%)
- **Session ID** linked to agent card for tracing
- **Tool calls** traced with full PreToolUse → PostToolUse flow

### E2B Sandbox Tracking (Optional)

The server auto-detects E2B sandbox tool calls and tracks sandbox lifecycle:

- Sandbox creation, URLs, running status
- Which agent/session created each sandbox
- Dashboard at `/api/sandboxes` (with filter by `status`, `session_id`)

### Complete Multi-Agent Workflow

The full agent team workflow captured by the observability system:

```
1. Primary agent calls team_create
   → Team appears in UI with creation timestamp

2. Primary agent calls task_create (x N)
   → Tasks appear in TaskBoard with initial status

3. Primary agent spawns sub-agents (via tmux panes in Claude Code)
   → Each gets unique session_id, model, context window

4. Sub-agents execute tasks in parallel
   → Each tool call flows through PreToolUse/PostToolUse hooks
   → Context window % tracked per agent

5. Sub-agents communicate via send_message
   → Messages appear in Communication Timeline
   → Threaded by task_id and agent_id

6. Sub-agents call task_update (status: completed)
   → TaskBoard updates in real-time
   → Task run history recorded in orchestration_task_run_history

7. Primary agent calls team_delete
   → Team shows as stopped in UI
```

### New UI Panels & Visualizations

| Panel | Description |
|-------|-------------|
| **Agent Swimlanes** | Per-agent cards with model badge, context window %, session ID |
| **Parallel Activity Chart** | Time-aligned Gantt view of concurrent agent work |
| **Agent Communication Timeline** | send_message events rendered as threaded messages |
| **Sandbox Dashboard** | E2B sandbox lifecycle with URLs and status |
| **TaskBoard** | Orchestration task list with live status updates |

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCH_TASK_RUN_HISTORY_MAX_DAYS` | (inherits ORCH_TASK_RUNS_MAX_DAYS) | Retention days for task run history |
| `ORCH_TASK_RUN_HISTORY_MAX_ROWS` | (inherits ORCH_TASK_RUNS_MAX_ROWS) | Max rows in task run history table |

### New API Endpoints

- **`GET /api/sandboxes`** - List all tracked sandboxes (filter by `status`, `session_id`)
- **`GET /api/sandboxes/:id`** - Get specific sandbox details
- **`GET /api/orchestration/admin/retention-config`** - View effective retention limits
- **`POST /api/orchestration/admin/prune-history`** - Trigger data pruning

## 📊 Technical Stack

- **Server**: Bun, TypeScript, SQLite
- **Client**: Vue 3, TypeScript, Vite, Tailwind CSS
- **Hooks**: Python 3.11+, Astral uv, TTS (ElevenLabs or OpenAI), LLMs (Claude or OpenAI)
- **Communication**: HTTP REST, WebSocket

## Master AI **Agentic Coding**
> And prepare for the future of software engineering

Learn tactical agentic coding patterns with [Tactical Agentic Coding](https://agenticengineer.com/tactical-agentic-coding?y=opsorch)

Follow the [IndyDevDan YouTube channel](https://www.youtube.com/@indydevdan) to improve your agentic coding advantage.

