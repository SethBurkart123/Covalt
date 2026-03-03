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
- Primary command API (current default): `http://localhost:8000`
- Quick availability check: `curl -sf http://localhost:8000/openapi.json >/dev/null` (note: `/health` may return 404 on this surface)
- Node provider list check: `curl -s -X POST http://localhost:8000/command/list_node_provider_plugins -H 'Content-Type: application/json' -d '{}'`
- Legacy backend surface seen in some runs: `http://localhost:8899` (use only if explicitly running there)
- Webhook example (when webhook routes are enabled): `curl -X POST http://localhost:8000/webhooks/{hook_id} -H "Content-Type: application/json" -d '{}'`

### Tools Available
- agent-browser: at `/Users/sethburkart/.factory/bin/agent-browser` — for UI testing
- curl: for API endpoint testing
- vitest + pytest: for automated tests

### Known Quirks
- Frontend dev server uses Turbopack — hot reload is fast but sometimes needs a full page refresh
- Backend must be running for flow execution to work
- 7 Vitest suites in covalt-n8n-nodes fail due to bun:test imports — ignore these
- If port 3000 is occupied or serving a stale/broken build, start a fresh frontend dev server and use its printed local URL (commonly http://localhost:3003) for user testing
- For `POST /upload/import_node_provider_plugin` traversal-zip tests, multipart uploads may default to `application/octet-stream`; add `;type=application/zip` on the file part to exercise archive traversal validation rather than MIME validation

## Flow Validator Guidance: web-ui
Use only your assigned data namespace when creating flows, node names, hook IDs, or payload text. Prefix all created resources with your namespace so parallel validators cannot collide. Do not delete or modify flows that do not match your namespace prefix. Use agent-browser for all UI interactions and capture concrete evidence (observed node labels, form values, toast/errors, and screenshots if available). If the UI fails to load on port 3000, switch to the assigned app URL in your prompt and continue.

## Flow Validator Guidance: backend-api
Use only your assigned data namespace for webhook hook IDs, route payload markers, and any test artifacts written through API calls. Do not call destructive endpoints outside your own namespaced resources. Use curl against the provided backend URL and record full request/response details (status code, key body fields, and headers when relevant). If an assertion cannot be tested through public HTTP/API surface, mark it blocked with the exact missing surface or prerequisite.
