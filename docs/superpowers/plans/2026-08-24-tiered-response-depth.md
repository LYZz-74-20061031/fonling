# Tiered Response Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten ordinary roleplay replies while making explicit Air requests use larger relevant context, GLM dynamic thinking, and a temporary DeepSeek-style reasoning display.

**Architecture:** Keep model transport decisions in `model-gateway.js`, add a small response-policy module for prompt and context profiles, make memory context accept an explicit budget, and extend the streaming parser to separate reasoning from final content. A new in-memory reasoning UI controller renders transient thinking text without placing it in `state.messages` or persistent character data.

**Tech Stack:** Static HTML/CSS/JavaScript, GLM/OpenAI-compatible SSE, Node.js built-in test runner, VM-based integration harnesses.

**Repository rule:** Do not create Git commits; the user manages commits. Do not create or retain screenshots, generated images, comparison boards, or an `artifacts/` directory.

---

### Task 1: Define tier-specific model and response policies

**Files:**
- Create: `js/model/response-policy.js`
- Modify: `js/model/model-gateway.js`
- Modify: `index.html`
- Create: `tests/response-depth-policy.test.js`

- [ ] **Step 1: Write failing policy and gateway tests**

Create tests that load `model-config.js`, `model-gateway.js`, and the new policy module in a VM. Assert:

```js
const ordinary = Gateway.createPlan({ task: 'chat', provider: 'glm', config });
const air = Gateway.createPlan({ task: 'chat', tier: 'air', config });
assert.equal(ordinary.maxTokens, 2560);
assert.equal(ordinary.thinkingType, 'disabled');
assert.equal(air.maxTokens, 4096);
assert.equal(air.thinkingType, 'enabled');
assert.deepEqual(Policy.forPlan(ordinary).limits, {
  recentMessages: 14, narrativeCharacters: 6000, memoryCharacters: 8000,
});
assert.deepEqual(Policy.forPlan(air).limits, {
  recentMessages: 24, narrativeCharacters: 10000, memoryCharacters: 12000,
});
```

Also assert ordinary instructions mention concise output and reduced parenthetical narration, while Air instructions mention motivation, subtext, continuity, promises, conflict, foreshadowing, and consequences.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `node --test tests/response-depth-policy.test.js`

Expected: FAIL because `response-policy.js`, `thinkingType`, and tiered chat token limits do not exist.

- [ ] **Step 3: Implement immutable profiles**

Expose `FonlingModels.ResponsePolicy.forPlan(plan)` and return a fresh immutable profile with this shape:

```js
{
  depth: 'ordinary' | 'air',
  limits: { recentMessages, narrativeCharacters, memoryCharacters },
  instruction: '...'
}
```

The ordinary instruction must reduce overall verbosity and parenthetical action/psychology/environment narration to roughly 50%–67% of the prior default. The Air instruction must forbid repetitive padding while directing extra analysis toward character motivation, subtext, relationship changes, continuity, promises, conflicts, foreshadowing, and consequences.

- [ ] **Step 4: Implement tiered gateway parameters**

In `createPlan`, set chat values as follows:

```js
const maxTokens = task === 'analysis' ? 1400
  : task === 'summary' ? 1024
    : task === 'connection_test' ? 8
      : tier === 'air' ? 4096 : 2560;
const thinkingType = task === 'chat' && tier === 'air' ? 'enabled' : 'disabled';
```

Return `thinkingType` on the plan. In `buildRequestBody`, add `thinking: { type: plan.thinkingType }` only for GLM requests. Preserve existing summary, analysis, connection-test, retry, stream, and temperature behavior.

- [ ] **Step 5: Load the policy module and rerun focused tests**

Add `<script src="js/model/response-policy.js"></script>` after the existing model modules and before application code.

Run: `node --test tests/response-depth-policy.test.js`

Expected: PASS.

### Task 2: Apply different context budgets without changing persistence

**Files:**
- Modify: `js/memory/memory-context.js`
- Modify: `index.html`
- Create: `tests/memory-context.test.js`
- Modify: `tests/chapter-context.test.js`
- Modify: `tests/chapter-integration.test.js`

- [ ] **Step 1: Write failing explicit-budget tests**

Add memory-context tests proving `buildMemoryContextMessages({ ..., budget: 12000 })` can select relevant memories beyond the ordinary 8000-character ceiling while the default call still stops at 8000. Add an integration assertion that `buildApiMessages` passes profile values into both context builders and slices recent messages with the profile limit.

- [ ] **Step 2: Run context tests and verify red**

Run: `node --test tests/memory-context.test.js tests/chapter-context.test.js tests/chapter-integration.test.js`

Expected: FAIL because memory context ignores explicit budgets and `buildApiMessages` has no plan-aware profile.

- [ ] **Step 3: Add an optional memory budget**

Inside `selectMemoriesForContext`, calculate:

```js
const contextBudget = Number.isFinite(source.budget) && source.budget > 0
  ? Math.floor(source.budget)
  : MEMORY_CONTEXT_CHAR_BUDGET;
```

Use `contextBudget` for required-content validation and ranked-memory admission. Keep the pinned-memory hard limit at 4000 characters.

- [ ] **Step 4: Make API message construction plan-aware**

Change `buildApiMessages` to accept `{ userText, plan }`, obtain `ResponsePolicy.forPlan(plan)`, and:

```js
const recent = rawMessages.slice(-profile.limits.recentMessages);
buildMemoryContextMessages({
  memories: state.memories,
  currentScene: state.currentScene,
  userText,
  recentMessages: recent,
  budget: profile.limits.memoryCharacters,
});
buildNarrativeContext({
  chapters: state.chapters,
  activeChapterId: state.activeChapterId,
  summary: state.summary,
}, {
  userText,
  currentSceneText: formatScene(state.currentScene),
  recentMessages: recent,
  budget: profile.limits.narrativeCharacters,
});
```

Insert one system message containing `profile.instruction`, and append only `recent` raw messages. Pass the already-created model plan from ordinary send, Air send, free regenerate, Air regenerate, and failed-send retry paths.

- [ ] **Step 5: Run focused context tests**

Run: `node --test tests/memory-context.test.js tests/chapter-context.test.js tests/chapter-integration.test.js tests/latest-message-actions.test.js tests/response-depth-policy.test.js`

Expected: PASS.

### Task 3: Separate reasoning SSE from final reply content

**Files:**
- Modify: `js/model/model-gateway.js`
- Modify: `tests/response-depth-policy.test.js`

- [ ] **Step 1: Write a failing mixed-stream test**

Feed `readSseContent` a stream containing reasoning-only, content-only, and mixed chunks:

```js
data: {"choices":[{"delta":{"reasoning_content":"先核对人物关系。"}}]}
data: {"choices":[{"delta":{"reasoning_content":"再判断承诺。","content":"她抬眼。"}}]}
data: {"choices":[{"delta":{"content":"“我记得。”"}}]}
data: [DONE]
```

Assert the returned string is only `她抬眼。“我记得。”` and callback snapshots separately expose accumulated reasoning `先核对人物关系。再判断承诺。` and final content.

- [ ] **Step 2: Run the stream test and verify red**

Run: `node --test tests/response-depth-policy.test.js`

Expected: FAIL because the parser currently reads only `delta.content`.

- [ ] **Step 3: Implement structured deltas**

Make the SSE line parser return:

```js
{ reasoningDelta: string, contentDelta: string }
```

Accumulate reasoning and content independently. Call `onDelta` with:

```js
{ reasoningDelta, contentDelta, reasoning, content }
```

Continue returning only final `content` from `readSseContent` and `request`, so no reasoning can enter persisted message content by accident.

- [ ] **Step 4: Run the focused stream tests**

Run: `node --test tests/response-depth-policy.test.js`

Expected: PASS.

### Task 4: Add an in-memory, collapsible reasoning display

**Files:**
- Create: `js/model/reasoning-ui.js`
- Modify: `index.html`
- Create: `tests/reasoning-ui.test.js`
- Modify: `tests/latest-message-actions.test.js`

- [ ] **Step 1: Write failing reasoning-controller tests**

Test a controller with this public contract:

```js
const controller = ReasoningUI.createController();
controller.begin('assistant-1');
controller.update('assistant-1', '先核对关系。');
controller.complete('assistant-1');
assert.deepEqual(controller.snapshot('assistant-1'), {
  reasoning: '先核对关系。', status: 'complete', expanded: false,
});
controller.toggle('assistant-1');
assert.equal(controller.snapshot('assistant-1').expanded, true);
controller.clear();
assert.equal(controller.snapshot('assistant-1'), null);
```

Also assert snapshots contain no final answer text and are not serializable through character state.

- [ ] **Step 2: Run UI controller tests and verify red**

Run: `node --test tests/reasoning-ui.test.js tests/latest-message-actions.test.js`

Expected: FAIL because the controller and Air stream wiring do not exist.

- [ ] **Step 3: Implement the transient controller**

Create an in-memory `Map` keyed by assistant message ID with methods `begin`, `update`, `complete`, `toggle`, `remove`, `clear`, and `snapshot`. Do not accept or store `state`, message objects, final content, role data, chapter data, or storage handles.

- [ ] **Step 4: Render reasoning state with real text controls**

Load `reasoning-ui.js` before application code. Keep DOM rendering in focused `index.html` helpers that consume controller snapshots. During `renderMessages`, decorate only a matching assistant message with:

```html
<section class="reasoning-panel">
  <button type="button" class="reasoning-toggle" aria-expanded="false">查看思考过程</button>
  <div class="reasoning-content" hidden></div>
</section>
```

While reasoning is active, show `正在思考……` and keep the content expanded. When complete, default to collapsed. Use `textContent` exclusively for model-provided reasoning. Add compact inline CSS matching the existing chat palette, with no image or generated asset. Provide a standalone rendering helper keyed by `data-reasoning-id` for Air regeneration, because the original answer remains in `state.messages` until a valid replacement is ready; once replacement succeeds, rerender the same controller snapshot inside the new assistant message.

- [ ] **Step 5: Wire Air send and regeneration streams**

For Air requests, call `begin(messageId)` before requesting. Update reasoning from the structured stream callback and update final reply only from `snapshot.content`. On completion call `complete(messageId)`; on failure, rollback, role switch, backtrack, free/paid regeneration replacement, or character load call `remove` or `clear` as appropriate.

Ordinary requests must never call `begin`. Update regeneration to pass a stream callback so Air regeneration displays reasoning while preserving the original reply until a valid replacement is committed.

- [ ] **Step 6: Prove reasoning is temporary**

Add assertions that:

- `saveCurrentCharacter` receives messages containing only final `content`.
- `buildExportData` contains no reasoning text.
- calling controller `clear()` simulates reload/role switch and removes the view state.
- ordinary replies and free regeneration never create reasoning state.

- [ ] **Step 7: Run reasoning and action tests**

Run: `node --test tests/reasoning-ui.test.js tests/latest-message-actions.test.js tests/response-depth-policy.test.js`

Expected: PASS.

### Task 5: Full regression and cleanup

**Files:**
- Modify only files required to fix regressions found by the commands below.

- [ ] **Step 1: Run the complete suite**

Run: `node --test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run syntax and whitespace checks**

Run:

```powershell
node --check js/model/model-gateway.js
node --check js/model/response-policy.js
node --check js/model/reasoning-ui.js
git diff --check
```

Expected: all commands exit 0 with no output indicating errors.

- [ ] **Step 3: Verify the final changed-file list**

Run: `git status --short`

Expected: only product code, tests, the approved spec, and this plan are present. There must be no PNG/JPG files, generated images, comparison HTML, temporary logs, downloaded files, or `artifacts/` directory.

- [ ] **Step 4: Report for user testing**

Report ordinary/Air token limits, Thinking flags, context budgets, transient reasoning behavior, exact test count, and the changed-file list. Do not commit, merge, push, or create screenshots.
