# Flow Control Nodes — Specification

Comprehensive specifications for flow control nodes in a node-based flow editor, synthesized from research across n8n, Apache Airflow, Prefect, Node-RED, ComfyUI, and Unreal Blueprints.

## Table of Contents

1. [Architecture Decisions](#architecture-decisions)
2. [Socket Type System](#socket-type-system)
3. [Branching/Routing](#branchingrouting)
   - [If/Else](#ifelse-conditional)
   - [Switch/Case](#switchcase)
   - [Router](#router)
   - [Error Handler](#error-handler)
4. [Iteration](#iteration)
   - [Loop](#loop)
   - [For Each](#for-each)
   - [While](#while)
   - [Batch](#batch)
5. [Flow Control](#flow-control)
   - [Merge/Join](#mergejoin)
   - [Split](#split)
   - [Delay/Wait](#delaywait)
   - [Gate](#gate)
   - [Sub-flow](#sub-flow)
6. [State](#state)
   - [Set Variable](#set-variable)
   - [Get Variable](#get-variable)
7. [The Loop-in-a-DAG Problem](#the-loop-in-a-dag-problem)
8. [Execution Engine Implications](#execution-engine-implications)
9. [Chat Rendering](#chat-rendering)

---

## Architecture Decisions

### Execution Model

The executor uses **topological sort** to determine execution order. This works naturally for acyclic graphs but requires special handling for loops. After researching every major platform, the approach that balances power with predictability is:

- **Static graph is always a DAG** — the visual editor prevents back-edges
- **Loops are handled via dynamic graph expansion** — loop nodes internally "unroll" iterations, creating virtual sub-executions that preserve the DAG invariant (ComfyUI's approach)
- **Execution is depth-first within branches** — when a node has multiple outputs, branches execute sequentially top-to-bottom (n8n's model), not in parallel, unless explicitly using Split

### Data Model

Every edge carries a typed **payload**. The fundamental unit of data flowing between nodes is a `FlowValue`:

```typescript
type FlowValue =
  | { type: 'single'; value: any }           // One item
  | { type: 'collection'; items: any[] }     // List of items
  | { type: 'error'; error: FlowError }      // Error token
  | { type: 'skip'; reason: string }         // Dead-path signal
  | { type: 'control'; signal: ControlSignal } // Flow control
```

The `skip` type is critical — it implements **dead-path elimination**, preventing merge nodes from waiting forever on branches that were never activated (a lesson from BPEL and workflow pattern theory).

### Error Propagation

Errors follow Airflow's state-based model rather than n8n's "stop everything" default:

- Each node execution produces a **state**: `completed`, `failed`, `skipped`, or `upstream_failed`
- Downstream nodes check upstream states via **trigger rules** before executing
- Error tokens propagate through the graph as first-class values, not exceptions

---

## Socket Type System

Building on the existing agent/tools socket types, flow control introduces:

| Socket Type | Visual | Color | Carries |
|-------------|--------|-------|---------|
| `exec` | Diamond | White | Execution signal (when to run) |
| `data` | Circle | Blue | Any JSON value |
| `collection` | Circle+dots | Purple | Array of values |
| `bool` | Circle | Yellow | Boolean |
| `error` | Circle | Red | Error information |
| `agent` | Rounded | Green | Agent reference (existing) |
| `tools` | Square | Orange | Tool connections (existing) |

Sockets can be **required** or **optional**. Optional inputs that receive no connection use their configured default value.

---

## Branching/Routing

### If/Else (Conditional)

Route items to one of two outputs based on a condition.

**Platforms studied:** n8n If, Unreal Branch, Node-RED Switch (2-output), Airflow BranchPythonOperator

#### What it does
Evaluates a condition against each incoming item and sends it to either the `true` or `false` output. Does NOT transform data — pure routing.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Triggers evaluation |
| `input` | data | yes | The data to evaluate and route |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `true` | exec + data | Fires when condition is met |
| `false` | exec + data | Fires when condition is not met |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `conditions` | `Condition[]` | `[]` | List of conditions to evaluate |
| `combineMode` | `'and' \| 'or'` | `'and'` | How multiple conditions combine |
| `ignoreCase` | `boolean` | `false` | Case-insensitive string comparisons |
| `looseTypes` | `boolean` | `false` | Allow `"3"` to equal `3` |

```typescript
interface Condition {
  field: string          // JSONPath or expression to evaluate
  operator: ConditionOp  // 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' |
                         // 'contains' | 'startsWith' | 'endsWith' |
                         // 'matches' | 'isEmpty' | 'isNull' |
                         // 'isTrue' | 'isFalse' | 'exists'
  value?: any            // Comparison value (not needed for isEmpty, etc.)
  type?: DataType        // 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object'
}
```

#### Execution Semantics

1. Receive execution signal and input data
2. For each item in input (if collection) or the single item:
   - Evaluate all conditions
   - Combine with AND/OR logic
   - Route item to `true` or `false` output
3. If input is a collection, both outputs may fire with subsets
4. Outputs that receive zero items emit a `skip` token

#### Events

| Event | When | Data |
|-------|------|------|
| `node:start` | Evaluation begins | `{ itemCount }` |
| `node:route` | Each item routed | `{ branch: 'true'\|'false', index }` |
| `node:complete` | All items routed | `{ trueCount, falseCount }` |

#### Edge Cases
- **Empty input**: Both outputs emit `skip` tokens. Downstream merge nodes must handle this.
- **Collection input**: Items are evaluated individually. Output could be `true: [a,c]`, `false: [b]`. This is per-item routing, not all-or-nothing.
- **Missing fields**: `field` path that doesn't exist in the data. Behavior depends on operator — `exists` returns false, `isEmpty` returns true, others return false (item goes to `false` branch).
- **n8n lesson**: n8n evaluates conditions at the item level, not the collection level. This is the right default — it prevents the common mistake of routing an entire batch when only some items match.

---

### Switch/Case

Route to one of N output branches based on matching rules.

**Platforms studied:** n8n Switch, Unreal Switch on Int/String/Enum, Node-RED Switch, Airflow BranchPythonOperator (multi-return)

#### What it does
Evaluates a value or set of rules and routes execution to matching output branches. Generalizes If/Else to N branches.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Triggers evaluation |
| `input` | data | yes | The data to evaluate |

#### Outputs

Dynamic — one per configured case, plus fallback:

| Socket | Type | Description |
|--------|------|-------------|
| `case_0` | exec + data | First matching case |
| `case_1` | exec + data | Second matching case |
| `...` | exec + data | Additional cases |
| `fallback` | exec + data | No case matched (optional) |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `'rules' \| 'expression'` | `'rules'` | How routing is determined |
| `cases` | `SwitchCase[]` | `[]` | Case definitions (rules mode) |
| `expression` | `string` | `''` | Expression returning output name (expression mode) |
| `multiMatch` | `boolean` | `false` | Send to ALL matching outputs vs first match only |
| `hasFallback` | `boolean` | `true` | Whether unmatched items have an output |

```typescript
interface SwitchCase {
  name: string           // Display label for this output
  conditions: Condition[] // Same condition format as If/Else
  combineMode: 'and' | 'or'
}
```

#### Execution Semantics

1. Receive execution signal and input data
2. For each item:
   - **Rules mode**: Evaluate each case's conditions in order
     - `multiMatch=false`: Route to first matching case (short-circuit)
     - `multiMatch=true`: Route to ALL matching cases (item is cloned)
   - **Expression mode**: Evaluate expression, use return value as output name
3. Unmatched items go to `fallback` (or are dropped if no fallback)
4. Non-activated outputs emit `skip` tokens

#### Events

| Event | When | Data |
|-------|------|------|
| `node:start` | Evaluation begins | `{ itemCount, caseCount }` |
| `node:route` | Each item routed | `{ case: string, index }` |
| `node:complete` | All routed | `{ distribution: Record<string, number> }` |

#### Edge Cases
- **n8n limitation**: Max 10 rules per Switch node. Our implementation should have no arbitrary limit.
- **Expression mode ambiguity**: If expression returns a name that doesn't match any output, it goes to fallback. Expression returning `null`/`undefined` also goes to fallback.
- **Unreal insight**: Enum-based switches auto-generate cases from the enum. Consider supporting this for TypeScript enums.
- **multiMatch + collection**: Each item independently matches cases. With multiMatch, a single item could appear in multiple output streams — downstream nodes must handle duplicates.

---

### Router

Dynamic routing based on content analysis, rules, or AI classification.

**Platforms studied:** n8n Switch (expression mode), Node-RED Switch (JSONata), Airflow BranchPythonOperator (runtime logic)

#### What it does
A more powerful routing node that can use expressions, rule tables, or even LLM classification to determine which output branch each item should follow. Differs from Switch in that routing logic can be arbitrarily complex and output branches can be dynamically determined.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Triggers evaluation |
| `input` | data | yes | Data to route |

#### Outputs

Dynamic — determined by configuration:

| Socket | Type | Description |
|--------|------|-------------|
| `[dynamic]` | exec + data | Named outputs defined by routing rules |
| `fallback` | exec + data | Default when no route matches |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `routingMode` | `'expression' \| 'rules' \| 'content'` | `'rules'` | How routing is determined |
| `expression` | `string` | `''` | Expression returning output name |
| `rules` | `RoutingRule[]` | `[]` | Priority-ordered routing rules |
| `outputNames` | `string[]` | `[]` | Named outputs for content mode |
| `contentField` | `string` | `''` | Which field to analyze for content routing |

```typescript
interface RoutingRule {
  name: string        // Output branch name
  priority: number    // Lower = higher priority
  condition: string   // Expression that returns boolean
  transform?: string  // Optional expression to transform data before routing
}
```

#### Execution Semantics

1. **Expression mode**: Evaluate expression per item, return value is the output name
2. **Rules mode**: Evaluate rules in priority order, first match wins
3. **Content mode**: Use pattern matching or classification on a field value to determine output

#### Edge Cases
- **Dynamic outputs**: The set of possible outputs might not be known at graph design time. The node must communicate available outputs to the editor.
- **Airflow lesson**: BranchPythonOperator returns task IDs at runtime. This is powerful but makes static graph analysis impossible. Balance: allow dynamic routing but require output names to be pre-declared in the node config.

---

### Error Handler

Catch and handle errors from other nodes.

**Platforms studied:** n8n Error Trigger + Continue on Error Output, Node-RED Catch node, Airflow on_failure_callback, Prefect retry/error handling

#### What it does
Catches errors from specified nodes (or all nodes in a scope) and provides a fallback execution path. Can be scoped to specific nodes, a group of nodes, or an entire sub-flow.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `error` | error | yes | Receives error tokens from watched nodes |

Note: No `exec` input — this node is triggered BY errors, not by normal execution flow.

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `exec` | exec | Fires when an error is caught |
| `error` | data | The error object (message, stack, source node, original input) |
| `originalInput` | data | The input that caused the error |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `scope` | `'selected' \| 'group' \| 'all'` | `'selected'` | Which nodes to watch |
| `watchedNodes` | `string[]` | `[]` | Node IDs to watch (when scope='selected') |
| `errorTypes` | `string[]` | `['*']` | Which error types to catch (`*` = all) |
| `retry` | `RetryConfig \| null` | `null` | Auto-retry before entering error path |

```typescript
interface RetryConfig {
  maxRetries: number            // Max retry attempts
  delayMs: number               // Base delay between retries
  backoff: 'fixed' | 'exponential' // Backoff strategy
  maxDelayMs?: number           // Cap on backoff delay
  retryOn?: string[]            // Error types to retry on (default: all)
}

interface FlowError {
  message: string
  type: string                  // Error classification
  stack?: string
  sourceNodeId: string
  sourceNodeType: string
  timestamp: number
  retryCount: number            // How many times it was retried
  originalInput: any            // The input that caused failure
}
```

#### Execution Semantics

1. Monitor watched nodes for errors
2. When an error occurs:
   a. If retry is configured, attempt retry up to `maxRetries` times
   b. If all retries exhausted (or no retry configured), fire the error handler
3. The error handler's `exec` output starts a fallback execution path
4. Error data includes full context: what failed, why, and the original input
5. The fallback path can attempt recovery, log, alert, or produce a default value

#### Events

| Event | When | Data |
|-------|------|------|
| `node:error_caught` | Error received | `{ sourceNode, errorType, retryCount }` |
| `node:retry` | Retry attempt | `{ attempt, maxRetries, delay }` |
| `node:retry_exhausted` | All retries failed | `{ totalAttempts }` |
| `node:fallback_start` | Fallback path begins | `{ error }` |

#### Edge Cases
- **Error in error handler**: If the fallback path itself errors, it propagates to the parent scope's error handler (if any), or terminates the flow. Prevents infinite error loops.
- **Node-RED insight**: Errors are categorized as catchable (routable), log-only (not routable), and uncaught (crash). We should distinguish between recoverable errors (network timeouts) and fatal errors (invalid configuration).
- **Airflow insight**: `on_failure_callback` fires only AFTER all retries are exhausted, not on each intermediate failure. Each intermediate failure fires `on_retry_callback`. This distinction matters.
- **n8n insight**: Three error strategies per node — Stop Workflow, Continue On Fail (with error property), Continue Using Error Output. The third option is best because it gives errors their own execution path.
- **Scope inheritance**: If a node inside a sub-flow has no error handler, the error bubbles up to the sub-flow level, then to the parent flow. Same as Node-RED's subflow error propagation.

---

## Iteration

### The Fundamental Challenge

Loops create cycles. DAGs don't have cycles. Every platform handles this differently:

| Platform | Approach | Tradeoff |
|----------|----------|----------|
| n8n | True back-edges allowed | Requires careful termination; can hang |
| Airflow | Dynamic task mapping (no cycles) | Limited to map/reduce patterns |
| ComfyUI | Dynamic graph expansion / tail recursion | Complex but preserves DAG |
| Unreal | Macro nodes with internal loops | Single-frame execution; can freeze |
| Prefect | Just Python loops | No visual representation |
| Node-RED | Back-edges with delay nodes | Can stack-overflow without delay |

**Our approach**: Loop nodes are **virtual container nodes**. They encapsulate a sub-graph that executes iteratively. The outer graph remains a DAG. The inner sub-graph is executed repeatedly by the loop node itself, which manages iteration state internally. This is closest to ComfyUI's dynamic expansion but presented as an explicit container.

---

### Loop

Repeat a sub-flow N times or until a condition is met.

**Platforms studied:** Unreal WhileLoop/ForLoop, n8n Loop Over Items, ComfyUI WhileLoopOpen/Close

#### What it does
Executes a contained sub-flow repeatedly. Supports count-based iteration (repeat N times), condition-based iteration (repeat until condition), or both (repeat up to N times or until condition).

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Starts the loop |
| `input` | data | no | Initial data passed to first iteration |
| `maxIterations` | data (number) | no | Override configured max (optional) |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `body` | exec + data | Fires each iteration with current data |
| `done` | exec + data | Fires after loop completes with final data |
| `iteration` | data (number) | Current iteration index (0-based) |

The `body` output connects to nodes that form the loop body. Those nodes must eventually connect back to the loop node's implicit "continue" input (handled by the container system — see [Sub-flow](#sub-flow)).

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `'count' \| 'condition' \| 'both'` | `'count'` | When to stop |
| `count` | `number` | `10` | Number of iterations (count/both mode) |
| `condition` | `string` | `''` | Expression evaluated per iteration (condition/both mode) |
| `maxIterations` | `number` | `1000` | Safety limit to prevent infinite loops |
| `continueOnError` | `boolean` | `false` | Skip failed iterations instead of stopping |

#### Execution Semantics

1. Initialize iteration counter to 0
2. Check termination: `mode=count` → counter < count; `mode=condition` → condition is truthy; `mode=both` → both
3. If continuing: emit `body` with current data, wait for body to complete
4. Body output becomes input to next iteration
5. Increment counter
6. Goto 2
7. When terminated: emit `done` with final data

#### Events

| Event | When | Data |
|-------|------|------|
| `loop:start` | Loop begins | `{ mode, count }` |
| `loop:iteration` | Each iteration starts | `{ index, total? }` |
| `loop:iteration_complete` | Each iteration ends | `{ index, duration }` |
| `loop:break` | Early exit triggered | `{ index, reason }` |
| `loop:complete` | Loop finished | `{ totalIterations, duration }` |

#### Edge Cases
- **Infinite loop protection**: `maxIterations` is a hard safety limit. Even in `condition` mode, if the condition never becomes false, the loop stops at `maxIterations` and emits a warning. Unreal Blueprints will crash on infinite WhileLoops — we must not.
- **Break**: A special `Break` node can be placed inside the loop body. When executed, it immediately terminates the loop and fires `done`.
- **Continue**: A special `Continue` node skips the rest of the current iteration body and moves to the next iteration.
- **Nested loops**: Each loop manages its own state. Inner loops complete fully before the outer loop's iteration continues. This matches Unreal's ForEachLoop behavior.
- **ComfyUI lesson**: Loops implemented via tail recursion (dynamic graph expansion) preserve the DAG property. Each iteration is a fresh sub-graph. This prevents issues with stale cached values.

---

### For Each

Iterate over a collection, executing a sub-flow per item.

**Platforms studied:** Unreal ForEachLoop/ForEachLoopWithBreak, n8n Loop Over Items (batch=1), Prefect .map(), Airflow dynamic task mapping

#### What it does
Takes a collection and executes a sub-flow once per item, optionally collecting results back into a new collection.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Starts iteration |
| `collection` | collection | yes | The array to iterate over |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `body` | exec + data | Fires per item with current item |
| `done` | exec + collection | Fires when all items processed, with collected results |
| `item` | data | Current item |
| `index` | data (number) | Current index |
| `isFirst` | bool | True on first iteration |
| `isLast` | bool | True on last iteration |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `parallel` | `boolean` | `false` | Execute iterations in parallel |
| `maxParallel` | `number` | `5` | Max concurrent iterations (when parallel=true) |
| `collectResults` | `boolean` | `true` | Gather body outputs into result collection |
| `continueOnError` | `boolean` | `false` | Skip failed items instead of stopping |
| `emitProgress` | `boolean` | `true` | Emit progress events per item |

#### Execution Semantics

**Sequential mode** (`parallel=false`):
1. For each item in collection (in order):
   - Set `item`, `index`, `isFirst`, `isLast`
   - Fire `body` with item data
   - Wait for body sub-flow to complete
   - Collect body output if `collectResults=true`
2. Fire `done` with collected results

**Parallel mode** (`parallel=true`):
1. Create up to `maxParallel` concurrent executions
2. As each completes, start the next pending item
3. When all complete, fire `done` with results (in original order)

#### Events

| Event | When | Data |
|-------|------|------|
| `forEach:start` | Iteration begins | `{ itemCount, parallel }` |
| `forEach:item` | Each item starts | `{ index, total }` |
| `forEach:item_complete` | Each item ends | `{ index, total, duration }` |
| `forEach:complete` | All done | `{ processedCount, errorCount, duration }` |

#### Edge Cases
- **Empty collection**: `body` never fires. `done` fires immediately with empty results. No error.
- **Parallel + order**: Results in `done` are always in original collection order, regardless of completion order. This matches Prefect's `.map()` behavior.
- **Parallel + error**: With `continueOnError=false`, first error cancels pending items and fires error. With `continueOnError=true`, errors are collected and `done` includes partial results.
- **Unreal gotcha**: ForEachLoop executes all iterations in a single frame. For large arrays this freezes the game. Our async architecture avoids this, but we should still emit progress events so the UI can show a progress bar.
- **Nested ForEach**: Inner ForEach completes fully for each outer item. With `parallel=true` on both, this creates a matrix of concurrent executions bounded by the product of their `maxParallel` settings — needs a global concurrency limiter.

---

### While

Loop until a condition is met.

**Platforms studied:** Unreal WhileLoop, ComfyUI WhileLoopOpen/Close

#### What it does
A condition-first loop. Evaluates condition, if true executes body, repeats. This is syntactic sugar over Loop with `mode='condition'`, but ergonomically distinct because users expect it.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Starts the loop |
| `input` | data | no | Initial data |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `body` | exec + data | Fires each iteration |
| `done` | exec + data | Fires when condition becomes false |
| `iteration` | data (number) | Current iteration |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `condition` | `string` | `'true'` | Expression evaluated before each iteration |
| `conditionField` | `string` | `''` | Alternative: check a field on the data for truthiness |
| `maxIterations` | `number` | `1000` | Safety limit |
| `evaluateFirst` | `boolean` | `true` | Check condition before first iteration (while vs do-while) |

#### Execution Semantics

If `evaluateFirst=true` (while loop): check → body → check → body → ... → done
If `evaluateFirst=false` (do-while loop): body → check → body → check → ... → done

#### Edge Cases
- **Condition never changes**: Hits `maxIterations` and stops with a warning event. The output includes an `exhausted: true` flag.
- **ComfyUI lesson**: WhileLoopClose must connect back to WhileLoopOpen. In our container model, this is implicit — the body's output feeds back as the next iteration's input.

---

### Batch

Process items in chunks.

**Platforms studied:** n8n Loop Over Items (batch>1), Prefect .map() with chunking

#### What it does
Divides a collection into fixed-size chunks and processes each chunk through a sub-flow. Useful for rate-limited APIs, memory management, and progress reporting.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Starts batching |
| `collection` | collection | yes | Items to batch |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `batch` | exec + collection | Fires per batch with current chunk |
| `done` | exec + collection | Fires when all batches processed, with all results |
| `batchIndex` | data (number) | Current batch number (0-based) |
| `batchCount` | data (number) | Total number of batches |
| `progress` | data (number) | 0-1 progress ratio |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `batchSize` | `number` | `10` | Items per batch |
| `delayBetween` | `number` | `0` | Milliseconds to wait between batches |
| `continueOnError` | `boolean` | `false` | Skip failed batches |
| `collectResults` | `boolean` | `true` | Aggregate batch outputs |

#### Execution Semantics

1. Divide collection into chunks of `batchSize` (last chunk may be smaller)
2. For each chunk:
   - Fire `batch` with the chunk
   - Wait for batch sub-flow to complete
   - If `delayBetween > 0`, wait
   - Collect results
3. Fire `done` with all collected results

#### Events

| Event | When | Data |
|-------|------|------|
| `batch:start` | Batching begins | `{ totalItems, batchSize, batchCount }` |
| `batch:chunk` | Each batch starts | `{ batchIndex, batchCount, itemCount }` |
| `batch:chunk_complete` | Each batch ends | `{ batchIndex, duration }` |
| `batch:complete` | All done | `{ processedCount, errorCount, duration }` |

#### Edge Cases
- **n8n insight**: The "Reset" option on Loop Over Items treats each iteration's incoming data as fresh rather than accumulated. Useful for paginated APIs where you fetch the next page inside the loop. We support this via the `collectResults` flag.
- **Empty collection**: `batch` never fires, `done` fires immediately with empty results.
- **batchSize > collection.length**: Single batch containing all items.
- **Rate limiting**: `delayBetween` is a simple but effective rate limiter. For more sophisticated rate limiting (e.g., requests per minute), combine with the Delay node.

---

## Flow Control

### Merge/Join

Wait for multiple parallel branches before continuing.

**Platforms studied:** n8n Merge, Node-RED Join, Airflow trigger rules, workflow pattern theory (Structured Synchronizing Merge)

This is the **hardest node to get right**. Every platform has bugs and edge cases around merge behavior.

#### What it does
Collects data from multiple upstream branches and combines them before passing execution downstream. Acts as a barrier synchronization point.

#### Inputs

Dynamic — one per upstream branch:

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `input_0` | exec + data | yes | First branch |
| `input_1` | exec + data | yes | Second branch |
| `...` | exec + data | yes | Additional branches |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `exec` | exec | Fires when merge condition is satisfied |
| `merged` | data | Combined result |
| `results` | collection | Array of individual branch results |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | MergeMode | `'all'` | When to fire |
| `combineStrategy` | CombineStrategy | `'array'` | How to combine results |
| `timeout` | `number` | `30000` | Max ms to wait (0 = no timeout) |
| `triggerRule` | TriggerRule | `'all_success'` | State-based trigger condition |

```typescript
type MergeMode =
  | 'all'         // Wait for ALL inputs (barrier)
  | 'any'         // Fire as soon as ANY input arrives
  | 'count'       // Fire after N inputs arrive

type CombineStrategy =
  | 'array'       // Results as ordered array: [branch0Result, branch1Result]
  | 'merge'       // Deep merge objects (later branches override earlier)
  | 'append'      // Concatenate if collections
  | 'first'       // Use only the first arriving result
  | 'last'        // Use only the last arriving result
  | 'chooseBranch'// Output from a specific branch only (by index)

type TriggerRule =
  | 'all_success'               // All branches succeeded (default)
  | 'all_done'                  // All branches completed (success or fail)
  | 'none_failed_min_one_success' // No failures, at least one success
  | 'one_success'               // At least one succeeded (fire immediately)
  | 'one_failed'                // At least one failed (fire immediately)
```

#### Execution Semantics

1. Register expected inputs from the graph structure (know how many branches to wait for)
2. As each branch completes (or errors, or sends skip), record its state and result
3. Evaluate `triggerRule` against current states:
   - If satisfied → combine results per `combineStrategy` → fire output
   - If violated (e.g., all remaining could never satisfy) → emit error or skip
4. If `timeout` expires before trigger rule is satisfied → emit with partial data + timeout warning

**Dead-path elimination** (critical):
When an upstream branch is conditionally skipped (e.g., the `false` output of an If node that evaluates to `true`), a `skip` token flows to the merge. The merge counts this as "done" for that branch, not as "missing". This prevents the merge from waiting forever.

#### Events

| Event | When | Data |
|-------|------|------|
| `merge:waiting` | Merge created, waiting | `{ expectedCount }` |
| `merge:branch_arrived` | A branch completed | `{ branchIndex, state, arrivedCount, expectedCount }` |
| `merge:timeout` | Timeout expired | `{ arrivedCount, missingBranches }` |
| `merge:complete` | Trigger rule satisfied | `{ strategy, resultCount }` |

#### Edge Cases
- **CRITICAL — Branch never fires**: The #1 cause of hung workflows across all platforms. Solved by dead-path elimination: upstream routing nodes send `skip` tokens down non-taken branches. The merge MUST understand skip tokens.
- **n8n bug history**: Merge node in "Wait for Both" mode historically fired prematurely or produced empty output when one branch was conditionally skipped. Root cause: no dead-path elimination.
- **Airflow insight**: `none_failed_min_one_success` is the recommended trigger rule for merge points after branch operators. It means "run as long as at least one upstream succeeded and none failed." This handles skipped branches correctly because `skipped` ≠ `failed`.
- **Node-RED timeout approach**: Join node fires on timeout with partial data. This is a valid fallback but should be opt-in, not default.
- **One branch errors**: Under `all_success`, the merge marks itself as `upstream_failed` and does not fire. Under `all_done`, it fires with the error as part of the results. Under `none_failed_min_one_success`, it fires only if the error count is zero.
- **Repeated merge**: If the merge is inside a loop, it must reset its state each iteration. Clear arrival tracking on each new activation.

---

### Split

Fan out to multiple parallel branches.

**Platforms studied:** Node-RED Split, Unreal Sequence, n8n (multi-output connections)

#### What it does
Takes a single execution flow and fans it out to multiple parallel branches. Two modes: **broadcast** (same data to all branches) and **distribute** (divide a collection across branches).

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Triggers the split |
| `input` | data | yes | Data to distribute or broadcast |

#### Outputs

Dynamic — configurable number of branches:

| Socket | Type | Description |
|--------|------|-------------|
| `branch_0` | exec + data | First branch |
| `branch_1` | exec + data | Second branch |
| `...` | exec + data | Additional branches |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `'broadcast' \| 'distribute' \| 'roundRobin'` | `'broadcast'` | How data is split |
| `branchCount` | `number` | `2` | Number of output branches |
| `parallel` | `boolean` | `true` | Execute branches in parallel |
| `distributeField` | `string` | `''` | Field to distribute on (distribute mode) |

#### Execution Semantics

- **Broadcast**: Clone input data, send identical copy to each branch. All branches execute (parallel or sequential).
- **Distribute**: Divide a collection across branches. Items are assigned round-robin or by a partition key.
- **Round Robin**: Each activation sends to the next branch in sequence (stateful).

#### Events

| Event | When | Data |
|-------|------|------|
| `split:start` | Split triggered | `{ mode, branchCount }` |
| `split:branch_start` | Each branch begins | `{ branchIndex }` |
| `split:complete` | All branches launched | `{ branchCount }` |

#### Edge Cases
- **Unreal Sequence insight**: Sequence node fires outputs in order (Then 0 → Then 1 → ...) without delay. This is sequential split, not parallel. Important to clarify to users which behavior they're getting.
- **Broadcast + mutation**: If branch 0 modifies the data object, branch 1 should NOT see those changes. Each branch gets a deep clone.
- **Distribute empty collection**: All branches receive empty collections. No branches are skipped — they all fire with `[]`.

---

### Delay/Wait

Pause execution for a duration or until an event.

**Platforms studied:** Node-RED Delay, n8n Wait, Unreal Delay

#### What it does
Holds execution for a specified duration, until a specific time, or until an external event occurs.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Starts the wait |
| `input` | data | no | Data to pass through after waiting |
| `cancel` | exec | no | Cancels the wait immediately |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `exec` | exec | Fires when wait is over |
| `output` | data | Pass-through of input data |
| `cancelled` | exec | Fires if wait was cancelled |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `'duration' \| 'until' \| 'event'` | `'duration'` | What triggers continuation |
| `duration` | `number` | `1000` | Milliseconds to wait (duration mode) |
| `untilTime` | `string` | `''` | ISO timestamp or expression (until mode) |
| `eventName` | `string` | `''` | Event to wait for (event mode) |
| `dynamicDuration` | `string` | `''` | Expression to compute duration from input data |

#### Execution Semantics

1. Receive execution signal
2. Based on mode:
   - **Duration**: Set timer for `duration` ms (or evaluate `dynamicDuration` from input)
   - **Until**: Calculate time remaining until target, set timer
   - **Event**: Register listener for named event
3. Hold input data in memory
4. When timer expires or event received → pass through input data
5. If `cancel` input fires before completion → fire `cancelled` output instead

#### Events

| Event | When | Data |
|-------|------|------|
| `delay:start` | Wait begins | `{ mode, duration?, until?, event? }` |
| `delay:progress` | Periodic progress | `{ elapsed, remaining, percent }` |
| `delay:complete` | Wait finished | `{ actualDuration }` |
| `delay:cancelled` | Cancelled | `{ elapsed }` |

#### Edge Cases
- **Node-RED rate limiting**: Delay node can rate-limit messages (X per second). This is useful inside loops. Consider a `rateLimit` mode.
- **Delay in loop**: Each iteration's delay is independent. Total loop time = iterations × delay.
- **Cancel race condition**: If `cancel` fires at the exact moment the timer expires, `cancel` wins (cancelled output fires, not done).
- **Persistence**: If the flow executor restarts during a long wait, the remaining duration should be restored. Store the target timestamp, not the remaining duration.

---

### Gate

Block execution until opened.

**Platforms studied:** Unreal Gate/DoOnce/DoN/FlipFlop/MultiGate

#### What it does
A stateful valve that blocks or allows execution flow through. Can be opened, closed, and toggled by separate control signals. Unreal has 5 variants of this concept — we unify them.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `enter` | exec + data | yes | The execution to be gated |
| `open` | exec | no | Opens the gate |
| `close` | exec | no | Closes the gate |
| `toggle` | exec | no | Flips open/closed state |
| `reset` | exec | no | Resets counter and state |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `exit` | exec + data | Fires only when gate is open and `enter` is triggered |
| `blocked` | exec | Fires when `enter` is triggered but gate is closed |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startOpen` | `boolean` | `true` | Initial state |
| `mode` | GateMode | `'toggle'` | Behavioral variant |
| `maxPasses` | `number` | `0` | Max times gate allows through (0 = unlimited) |

```typescript
type GateMode =
  | 'toggle'      // Standard open/close gate (Unreal Gate)
  | 'once'        // Allow exactly one pass, then close (Unreal DoOnce)
  | 'n_times'     // Allow N passes, then close (Unreal DoN)
  | 'flipFlop'    // Alternate between two outputs (Unreal FlipFlop)
  | 'sequential'  // Route to outputs in sequence (Unreal MultiGate)
```

For `flipFlop` mode, `exit` alternates with an additional `exit_b` output.
For `sequential` mode, multiple outputs are created and activated in round-robin.

#### Execution Semantics

- **toggle mode**: `enter` passes through to `exit` when open, `blocked` when closed. `open`/`close`/`toggle` change state.
- **once mode**: First `enter` passes through, then auto-closes. `reset` re-enables.
- **n_times mode**: First N `enter` calls pass through, then auto-closes. `reset` resets counter.
- **flipFlop mode**: Each `enter` alternates between `exit` and `exit_b`.
- **sequential mode**: Each `enter` fires the next output in sequence (wrapping or stopping at end).

#### Edge Cases
- **Unreal insight**: Gate is extremely useful for preventing duplicate event handling. "DoOnce" prevents a pickup from being collected twice. "DoN" limits respawns.
- **Concurrent enter**: If multiple `enter` signals arrive simultaneously, they're processed in arrival order. For `once` mode, only the first passes.
- **Gate state during flow**: Gate state persists across the flow execution. If opened by one branch and entered by another, timing matters. Document this clearly.

---

### Sub-flow

Execute another flow graph as a single node.

**Platforms studied:** n8n Execute Workflow, Node-RED Subflow/Link Call, Airflow TaskGroup/SubDagOperator, ComfyUI Group Nodes

#### What it does
Encapsulates an entire flow graph (potentially a separate, reusable flow) as a single node. The sub-flow has its own inputs, outputs, and internal execution, but appears as one node in the parent graph.

#### Inputs

Configurable — defined by the sub-flow's interface:

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Starts the sub-flow |
| `[param_n]` | data | varies | Sub-flow input parameters |

#### Outputs

Configurable — defined by the sub-flow's interface:

| Socket | Type | Description |
|--------|------|-------------|
| `exec` | exec | Fires when sub-flow completes |
| `[output_n]` | data | Sub-flow output values |
| `error` | error | Fires if sub-flow fails |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `flowId` | `string` | `''` | Reference to the sub-flow definition |
| `inline` | `boolean` | `false` | If true, sub-flow is defined inline (not a reference) |
| `timeout` | `number` | `0` | Max execution time (0 = inherit from parent) |
| `errorBehavior` | `'propagate' \| 'catch' \| 'ignore'` | `'propagate'` | How sub-flow errors are handled |

#### Execution Semantics

1. Receive execution signal and input parameters
2. Instantiate the sub-flow with inputs mapped to its parameter nodes
3. Execute the sub-flow's graph using the same executor (recursive invocation)
4. Sub-flow runs to completion (or error/timeout)
5. Map sub-flow outputs to this node's outputs
6. Fire exec output

#### Events

| Event | When | Data |
|-------|------|------|
| `subflow:start` | Sub-flow begins | `{ flowId, inputCount }` |
| `subflow:progress` | Forwarded from inner nodes | `{ innerNodeId, event }` |
| `subflow:complete` | Sub-flow finished | `{ duration, outputCount }` |
| `subflow:error` | Sub-flow failed | `{ error, failedNodeId }` |

#### Edge Cases
- **Airflow lesson**: SubDagOperator was deprecated because it used its own executor (defaulting to SequentialExecutor) and caused deadlocks from pool/concurrency conflicts. TaskGroup replaced it by sharing the parent's executor. Our sub-flow MUST share the parent executor to avoid the same pitfall.
- **Node-RED insight**: Subflows have isolated context by default. Internal state doesn't leak to the parent. This is correct behavior.
- **Error propagation**: By default, errors propagate up. If the sub-flow has internal error handlers, they run first. Only unhandled errors reach the parent.
- **Recursive sub-flows**: A sub-flow that references itself creates infinite recursion. Must be detected at graph validation time (cycle detection on flow references) and at runtime (stack depth limit).
- **ComfyUI insight**: Group nodes / components use dynamic graph expansion — the sub-flow is "inlined" into the parent graph at execution time. This is more efficient (no overhead from sub-flow context) but loses encapsulation. Offer both modes: `inline=true` for performance, `inline=false` for isolation.

---

## State

### Set Variable

Store a value for later nodes.

**Platforms studied:** Node-RED Change node (context.set), n8n Set node, Unreal Set Variable

#### What it does
Stores a named value in a scoped variable store. The value persists across the current execution and can be read by downstream nodes via Get Variable.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | yes | Triggers the store |
| `value` | data | yes | The value to store |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `exec` | exec | Pass-through (fires immediately) |
| `value` | data | Echo of the stored value |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | `''` | Variable name |
| `scope` | `'flow' \| 'global'` | `'flow'` | Variable scope |
| `operation` | `'set' \| 'append' \| 'increment' \| 'merge'` | `'set'` | How to modify the variable |

```typescript
// Scope semantics:
// 'flow' — visible only within the current flow execution
// 'global' — visible across all flow executions in this session
```

#### Execution Semantics

1. Receive value and store it under `name` in the specified scope
2. Fire exec output immediately (non-blocking)
3. Value is available to any downstream Get Variable node

#### Edge Cases
- **Node-RED insight**: Three context scopes — node, flow, global. We simplify to two: flow (per-execution) and global (per-session).
- **Race conditions**: If two parallel branches Set the same variable, the last writer wins. This is by design but should be documented.
- **Append/Increment**: `append` adds to an array variable, `increment` adds to a numeric variable, `merge` deep-merges into an object variable. These are atomic operations.

---

### Get Variable

Retrieve a stored value.

#### What it does
Reads a named value from the variable store. Can be used inline (as a pure data node) or in the execution flow.

#### Inputs

| Socket | Type | Required | Description |
|--------|------|----------|-------------|
| `exec` | exec | no | Optional execution trigger |

#### Outputs

| Socket | Type | Description |
|--------|------|-------------|
| `exec` | exec | Pass-through (if exec input connected) |
| `value` | data | The retrieved value |
| `exists` | bool | Whether the variable exists |

#### Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | `''` | Variable name to read |
| `scope` | `'flow' \| 'global'` | `'flow'` | Which scope to read from |
| `defaultValue` | `any` | `null` | Value if variable doesn't exist |

#### Execution Semantics

**As a pure node** (no exec input connected):
- Evaluated lazily when a downstream node needs the value
- Re-evaluated each time it's read (like Unreal pure nodes)
- Returns current value at time of read

**As an impure node** (exec input connected):
- Evaluates once when triggered
- Caches the result for that activation

#### Edge Cases
- **Unreal pure/impure insight**: Pure nodes (no exec pins) re-evaluate every time their output is read. This means a Get Variable node without exec connection always returns the latest value. With exec connection, it snapshots the value at trigger time. This distinction matters for variables modified by parallel branches.
- **Variable doesn't exist**: Returns `defaultValue` and sets `exists=false`. Does not error.
- **Timing**: A Get Variable node can read a value that was Set by a node in a parallel branch, but only if that branch has already executed. With sequential execution (default), this is deterministic based on topological order. With parallel execution, it depends on race timing.

---

## The Loop-in-a-DAG Problem

This deserves its own section because it's the single hardest architectural decision.

### The Tension

- **DAGs enable**: Topological sort, deterministic execution order, cycle-free scheduling, caching, static analysis
- **Loops require**: Back-edges, repeated execution of the same nodes, mutable state between iterations

### Our Solution: Container Nodes with Internal Execution

Loop/ForEach/While/Batch nodes are **container nodes**. They contain a sub-graph (the loop body) but don't create cycles in the parent graph.

```
Parent Graph (DAG):
  [A] → [ForEach] → [B]
              ↓
         (contains)
              ↓
  Internal sub-graph (also a DAG):
    [BodyStart] → [Process] → [Transform] → [BodyEnd]
```

The ForEach node:
1. Appears as a single node in the parent DAG
2. Internally manages iteration by repeatedly executing its sub-graph
3. Sub-graph is a DAG (no cycles)
4. Each iteration is a fresh execution context (no stale state)
5. Outputs collected results when done

This matches ComfyUI's dynamic expansion model but with explicit visual containment rather than invisible graph rewriting.

### How It Interacts with Topological Sort

The topological sort of the parent graph treats the loop node as atomic — it has clear inputs and outputs with no back-edges. The executor:

1. Runs nodes before the loop (in topo order)
2. Reaches the loop node
3. Loop node takes over, executing its internal sub-graph repeatedly
4. When loop completes, executor resumes with nodes after the loop (in topo order)

### Nested Loops

Each loop has its own internal executor. Nesting is straightforward:

```
Parent Graph:
  [ForEach (outer)] → [Done]
       contains:
  [BodyStart] → [ForEach (inner)] → [BodyEnd]
                     contains:
                [InnerStart] → [Process] → [InnerEnd]
```

Inner loop completes fully before outer loop's iteration continues.

### Break/Continue

`Break` and `Continue` are special nodes valid only inside loop containers:
- **Break**: Signals the enclosing loop to stop iteration immediately
- **Continue**: Signals the enclosing loop to skip remaining body nodes and start next iteration

These are implemented as special control flow signals that propagate up to the nearest enclosing loop node.

---

## Execution Engine Implications

### Node State Machine

Every node goes through states during execution:

```
idle → pending → running → completed
                        ↘ failed
                        ↘ skipped
                        ↘ cancelled
```

State transitions emit events consumed by the UI.

### Trigger Rules (Borrowed from Airflow)

Each node has a configurable trigger rule that determines when it runs:

```typescript
interface NodeConfig {
  triggerRule: TriggerRule
  // ... other config
}
```

Default is `all_success`. For nodes after branching, use `none_failed_min_one_success`.

### Dead-Path Elimination

When a routing node (If/Switch/Router) doesn't activate a branch:

1. The routing node sends a `skip` token down the inactive branch
2. Skip tokens propagate through all nodes in that branch
3. Each node receiving a skip token transitions to `skipped` state
4. Merge nodes count `skipped` as "arrived but empty"

This prevents the #1 workflow engine bug: merge nodes waiting forever for branches that were never activated.

### Error Propagation

```
Node fails →
  1. Check for attached Error Handler → run it
  2. Check node's error mode:
     a. 'stop' → mark all downstream as 'upstream_failed', halt
     b. 'continue' → emit error token downstream, continue
     c. 'error_output' → route to error output socket
  3. Downstream nodes check trigger rules against upstream states
```

### Execution Order

Default: **Sequential, depth-first, top-to-bottom** (matching n8n v1.0+):
- When a node has multiple downstream connections, they execute sequentially
- The "top" branch (visually higher in the canvas) executes first
- This is predictable and debuggable

Optional: **Parallel branches** (via Split node):
- Explicitly opt-in to concurrent execution
- Merge/Join node synchronizes branches back together

---

## Chat Rendering

How flow execution appears in the chat interface as it runs.

### Progress Events → Chat Messages

Each flow execution produces a stream of events. The chat interface renders these as a collapsible execution trace:

```
🔄 Running flow "Data Pipeline"
  ✅ Fetch Data (0.3s)
  ✅ If: has_items → true (12 items)
  🔄 For Each (7/12 items)
     ✅ Process Item [1-6]
     🔄 Process Item [7] — calling API...
  ⏳ Merge — waiting for 1/2 branches
  ⬜ Generate Report — pending
```

### Event → UI Mapping

| Event | Chat Rendering |
|-------|---------------|
| `node:start` | Node name appears with spinner |
| `node:complete` | Spinner → checkmark, show duration |
| `node:failed` | Spinner → error icon, show error message |
| `node:skipped` | Dimmed with skip icon |
| `loop:iteration` | Progress bar (X/N) |
| `forEach:item` | Item counter |
| `merge:branch_arrived` | "Waiting for N/M branches" |
| `delay:progress` | Countdown timer |
| `subflow:start` | Nested collapsible section |

### Principles

1. **Progressive disclosure**: Show top-level node status by default. Click to expand details.
2. **Live updates**: Events stream in real-time via WebSocket. The trace updates as nodes execute.
3. **Error context**: When a node fails, show the error message, the input that caused it, and which retry attempt it was on.
4. **Loop compactness**: Don't show 1000 individual iteration events. Show a progress bar with the count. Expand to see individual items on click.
5. **Branch visualization**: When Split creates parallel branches, show them as indented parallel tracks. Merge collapses them back.
