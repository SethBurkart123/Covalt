# User Testing

Testing surface: tools, URLs, setup steps, isolation notes, known quirks.

**What belongs here:** How to manually test the application, entry points, tools, known UI quirks.

---

## Testing Surface

### Frontend (agent-browser)
- URL: http://localhost:3000
- Flow editor: main page, contains node palette (Add Node menu), canvas, properties panel
- Node palette: click "+" button or right-click canvas to open Add Node menu
- Node configuration: click a node to open its properties in the inspector panel
- Flow execution: click Run button to execute flow

### Backend (curl)
- Health: `curl http://localhost:8899/health`
- Webhook: `curl -X POST http://localhost:8899/webhooks/{hook_id} -H "Content-Type: application/json" -d '{}'`

### Tools Available
- agent-browser: at `/Users/sethburkart/.factory/bin/agent-browser` — for UI testing
- curl: for API endpoint testing
- vitest + pytest: for automated tests

### Known Quirks
- Frontend dev server uses Turbopack — hot reload is fast but sometimes needs a full page refresh
- Backend must be running for flow execution to work
- 7 Vitest suites in covalt-n8n-nodes fail due to bun:test imports — ignore these
