---
name: docs-worker
description: Creates plugin authoring documentation with prose-first style, code extracts, and complete examples.
---

# Documentation Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve creating or updating developer documentation, especially:
- Plugin authoring guides
- API reference documentation
- Tutorial-style content with examples

## Work Procedure

1. **Read the feature description carefully.** Understand what topics must be covered, the writing style requirements, and example expectations.

2. **Investigate the codebase.** Before writing documentation, understand the actual implementation:
   - Read the plugin manifest format and types
   - Read the plugin registry code (both backend and frontend)
   - Read existing plugin examples (builtin plugin structure, any external plugins)
   - Read lifecycle hook types and registration
   - Read the actual API surfaces that plugin authors will use

3. **Study existing documentation style.** Read `README.md` and any docs in `docs/` to understand the project's documentation voice and style. The user specifically wants:
   - **Prose-first**: Written primarily in paragraphs, not bullet-point lists
   - **Code extracts**: Fenced code blocks demonstrating key concepts
   - **Complete examples**: At least 2 end-to-end examples (simple node, node with hooks)
   - **Custom component example**: How to provide custom React components
   - **Error handling section**: Common errors and debugging

4. **Draft the documentation.** Write the full document:
   - Use paragraphs as the primary structure
   - Use bullet points sparingly (for reference lists, not explanations)
   - Include fenced code blocks for every concept
   - Ensure code examples are syntactically valid and internally consistent
   - Cover ALL required topics: manifest format, definition files, executor files, lifecycle hooks, testing, installation, distribution
   - Write as if speaking to a competent developer who hasn't seen this system before

5. **Validate code examples.** For each code example:
   - Verify imports/paths are consistent with the actual codebase
   - Verify type names match actual type definitions
   - Verify API surface matches actual implementation
   - If possible, extract examples and run syntax checks

6. **Self-review.** Re-read the entire document and check:
   - Is it prose-first? (paragraphs > bullets)
   - Are there at least 2 complete examples?
   - Is there a custom component example?
   - Is there error handling guidance?
   - Would a developer be able to follow this to create a working plugin?

## Example Handoff

```json
{
  "salientSummary": "Created comprehensive plugin authoring documentation at docs/creating-plugins.md. Document is 2500 words, prose-first with 15 code extracts. Includes 3 complete examples: simple counter node, webhook-like trigger with hooks, and custom chart component. Covers all 7 required topics.",
  "whatWasImplemented": "Created docs/creating-plugins.md covering: plugin structure and manifest format, node definition files (TypeScript), node executor files (Python), lifecycle hooks (with registration examples), testing plugins locally, installation from GitHub/zip, and distribution. Includes error handling and debugging section with common failure modes.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "wc -w docs/creating-plugins.md", "exitCode": 0, "observation": "2547 words" },
      { "command": "rg '```' docs/creating-plugins.md | wc -l", "exitCode": 0, "observation": "30 lines (15 code blocks)" },
      { "command": "bun run lint", "exitCode": 0, "observation": "Lint passed (no TS issues in doc)" }
    ],
    "interactiveChecks": [
      { "action": "Reviewed prose-to-bullet ratio", "observed": "~80% prose paragraphs, ~20% lists/tables — well within prose-first requirement" },
      { "action": "Verified example 1 (simple counter node) against actual types", "observed": "NodeDefinition fields match _types.ts, executor protocol matches _types.py" },
      { "action": "Verified example 2 (trigger with hooks) against hook registry API", "observed": "Hook registration calls match actual API" },
      { "action": "Verified example 3 (custom component) against frontend registry", "observed": "Component registration pattern matches actual implementation" }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Plugin API types/interfaces haven't been implemented yet (can't write accurate docs)
- Feature description is unclear about target audience or scope
- Existing code contradicts the documented behavior
- The actual API surface is too unstable to document meaningfully
