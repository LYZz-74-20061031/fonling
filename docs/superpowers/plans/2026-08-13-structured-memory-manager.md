# Structured Memory Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a user-approved structured memory manager that migrates existing character data, supports manual and AI-suggested memories, maintains one modular current scene, and injects only pinned or relevant memories into DeepSeek story requests.

**Architecture:** Keep the existing no-build, GitHub Pages-compatible application and expose focused browser globals under `window.FonlingMemory`. Pure data, migration, selection, and analyzer helpers live in separate JavaScript files; a controller connects them to the existing character state and persistence functions; the UI module owns the prompt bar, approval sheet, and standalone memory center. Integrate in four independently testable stages so manual memory remains usable if AI analysis is unavailable.

**Tech Stack:** HTML5, CSS, browser JavaScript, `localStorage`, DeepSeek Chat Completions API, Node.js built-in test runner, `node:assert`, `node:vm`, Chrome mobile/PWA validation.

## Global Constraints

- Every AI-generated candidate requires explicit user confirmation before it can change formal memories or the current scene.
- Each candidate exposes exactly three primary actions: `确认记忆`, `修改`, and `不计入`.
- Memory types are `history_event` and `key_info`; there is exactly one structured `currentScene` per character.
- Candidate operations are `add`, `update`, `merge`, `resolve`, and `scene_patch`.
- `resolve` candidates require a compatible `resultStatus`: `archived`, `resolved`, or `invalidated`.
- Pinned-memory budget is `PINNED_MEMORY_CHAR_BUDGET = 4000`; total structured-memory context budget is `MEMORY_CONTEXT_CHAR_BUDGET = 8000` characters.
- Automatic analysis produces at most 3 candidates per turn and runs only after a completed, persisted story response.
- Existing API key, persona, reply style, user identity, roles, selected role, background, summary, and messages survive migration unchanged.
- New JSON exports remain one character per file, carry `schemaVersion`, and can be read by the new app; backward readability by the old app is not required.
- Clearing chat removes raw messages, rolling summary, pending candidates, analysis progress, and request-memory traces while preserving formal memories and the current scene.
- Use native JavaScript with no package install, framework, bundler, server database, or cloud sync.
- Preserve the app name `智能剧情故事`, Chrome-first mobile behavior, PWA metadata, and all existing regression tests.
- Do not push to GitHub unless the user separately authorizes it.

## File Map

- Create `js/memory/memory-model.js`: pure schema factories, normalization, migration, immutable-style operations, ID generation, scene patching, and clear-chat memory cleanup.
- Create `js/memory/memory-storage.js`: character snapshot serialization, staged import normalization, schema-version handling, storage-size estimation, and quota-error classification.
- Create `js/memory/memory-context.js`: memory text formatting, local relevance ranking, character-budget enforcement, and request trace creation.
- Create `js/memory/memory-analyzer.js`: local trigger rules, DeepSeek analysis prompt/body construction, JSON parsing/repair, candidate normalization, deduplication, and conflict classification.
- Create `js/memory/memory-ui.js`: memory prompt bar, bottom approval sheet, memory center rendering, edit forms, source display, and request-memory trace display.
- Create `js/memory/memory-controller.js`: orchestration, per-character analysis queue, stale-character protection, candidate decisions, manual management, and UI callbacks.
- Create `css/memory.css`: mobile-first memory UI styles and safe-area/keyboard behavior.
- Modify `index.html`: load modules, extend state/persistence/import/export, replace legacy memory editors, add memory entry points, assign message IDs, invoke analysis, inject selected memories, and update clear/backtrack/regenerate behavior.
- Create focused tests under `tests/` for every module and integration seam described below.

---

## Stage 1 — Data Foundation

### Task 1: Add Core Memory Schema and Stable IDs

**Files:**
- Create: `js/memory/memory-model.js`
- Create: `tests/memory-model.test.js`

**Interfaces:**
- Produces: `window.FonlingMemory.Model`.
- Produces: `MEMORY_SCHEMA_VERSION = 2`, `EMPTY_SCENE`, `createId(prefix)`, `ensureMessageIds(messages, createIdFn?)`, `createMemory(input, now?)`, `createCandidate(input, now?)`, `normalizeScene(value)`, `normalizeMemory(value)`, `normalizeCandidate(value)`, and `applyScenePatch(scene, patch, now?)`.
- IDs use `crypto.randomUUID()` when available and a time-plus-random fallback otherwise.
- No DOM, storage, fetch, or application `state` dependency.

- [ ] **Step 1: Write failing schema and ID tests**

Create `tests/memory-model.test.js` that loads `memory-model.js` into a `vm` context and proves:

```js
test('normalizes memories and assigns stable unique message ids', () => {
  const messages = [{ role: 'user', content: '一' }, { role: 'assistant', content: '二' }];
  Model.ensureMessageIds(messages, (() => {
    const ids = ['msg_1', 'msg_2'];
    return () => ids.shift();
  })());
  assert.deepEqual(messages.map(message => message.id), ['msg_1', 'msg_2']);
  Model.ensureMessageIds(messages, () => 'must_not_be_used');
  assert.deepEqual(messages.map(message => message.id), ['msg_1', 'msg_2']);

  const memory = Model.createMemory({ type: 'key_info', content: '  阿宁持有钥匙  ' }, '2026-08-13T00:00:00.000Z');
  assert.equal(memory.content, '阿宁持有钥匙');
  assert.equal(memory.status, 'active');
  assert.equal(memory.pinned, false);
});

test('applies a scene patch without clearing untouched fields', () => {
  const before = Model.normalizeScene({ time: '深夜', location: '码头', currentGoal: '逃离' });
  const after = Model.applyScenePatch(before, { location: '车站' }, '2026-08-13T00:00:00.000Z');
  assert.equal(after.time, '深夜');
  assert.equal(after.location, '车站');
  assert.equal(after.currentGoal, '逃离');
});
```

Also reject empty content, invalid memory types, invalid candidate operations, unknown scene keys, and incompatible `resolve` statuses.

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test tests/memory-model.test.js`

Expected: FAIL because `js/memory/memory-model.js` does not exist.

- [ ] **Step 3: Implement the minimal pure model**

Implement an IIFE with this public shape:

```js
(function(global) {
  'use strict';
  const MEMORY_SCHEMA_VERSION = 2;
  const MEMORY_TYPES = new Set(['history_event', 'key_info']);
  const CANDIDATE_OPERATIONS = new Set(['add', 'update', 'merge', 'resolve', 'scene_patch']);
  const SCENE_KEYS = ['time', 'location', 'presentCharacters', 'currentGoal', 'currentConflict', 'characterStates', 'environment', 'notes'];
  const EMPTY_SCENE = Object.freeze({
    time: '', location: '', presentCharacters: [], currentGoal: '',
    currentConflict: '', characterStates: '', environment: '', notes: '', updatedAt: ''
  });
  // Define and export the functions listed in Interfaces.
  global.FonlingMemory = global.FonlingMemory || {};
  global.FonlingMemory.Model = { /* exact exports */ };
})(typeof window !== 'undefined' ? window : globalThis);
```

Normalize arrays by copying them, trim user-visible strings, preserve existing valid IDs and timestamps, and return `null` for invalid memory/candidate objects.

- [ ] **Step 4: Run focused tests and syntax check**

Run:

```powershell
node --test tests/memory-model.test.js
node --check js/memory/memory-model.js
```

Expected: all focused tests PASS and syntax check exits 0.

- [ ] **Step 5: Commit the model**

```powershell
git add js/memory/memory-model.js tests/memory-model.test.js
git commit -m "feat: add structured memory model"
```

### Task 2: Migrate Existing Character Data Without Loss

**Files:**
- Create: `js/memory/memory-storage.js`
- Create: `tests/memory-migration.test.js`
- Modify: `index.html:311-394`

**Interfaces:**
- Consumes: `FonlingMemory.Model` from Task 1.
- Produces: `window.FonlingMemory.Storage` with `createEmptyMemoryState()`, `migrateCharacterData(settings, messages, options?)`, `serializeMemoryState(state)`, `estimateSerializedBytes(value)`, and `isQuotaExceededError(error)`.
- `migrateCharacterData` returns `{ settings, messages, changed, diagnostics }` and never mutates its inputs.
- Adds state fields: `memorySchemaVersion`, `memories`, `currentScene`, `memoryCandidates`, `memoryAnalysis`, and `memoryRequestTraces`.

- [ ] **Step 1: Write failing migration tests**

Create tests covering:

```js
test('migrates old string memories and currentState without changing existing settings', () => {
  const oldSettings = {
    apiKey: 'sk-test', systemPrompt: '人设', style: '风格', userIdentity: '身份',
    bgImage: 'data:image/png;base64,x', summary: '摘要',
    historyEvents: ['  黑塔被烧毁  '], keyInfo: ['阿宁害怕密闭空间'],
    currentState: '旧的自由文本状态', roles: [{ name: '阿宁' }], currentRole: '阿宁'
  };
  const result = Storage.migrateCharacterData(oldSettings, [{ role: 'user', content: '你好' }], {
    createId: (() => { const ids = ['memory_1', 'memory_2', 'msg_1']; return () => ids.shift(); })(),
    now: '2026-08-13T00:00:00.000Z'
  });
  assert.equal(result.settings.apiKey, 'sk-test');
  assert.equal(result.settings.memories[0].type, 'history_event');
  assert.equal(result.settings.memories[1].type, 'key_info');
  assert.equal(result.settings.currentScene.notes, '旧的自由文本状态');
  assert.equal(result.messages[0].id, 'msg_1');
});
```

Also prove that a version-2 snapshot is idempotent, malformed legacy entries are skipped with diagnostics, and one invalid memory does not discard valid settings or messages.

- [ ] **Step 2: Run migration tests and verify red**

Run: `node --test tests/memory-migration.test.js`

Expected: FAIL because storage migration is missing.

- [ ] **Step 3: Implement storage migration and state initialization**

Create `memory-storage.js`. `memoryAnalysis` defaults to:

```js
{
  analyzedTurnKeys: [],
  lastFailure: null,
  activeCharacter: null
}
```

`memoryRequestTraces` defaults to `{}` keyed by assistant message ID. Convert legacy strings only when `memorySchemaVersion < 2`; remove neither the old fields nor unrelated settings during the in-memory validation step. `serializeMemoryState(state)` emits only the new memory fields.

- [ ] **Step 4: Integrate load and save in `index.html`**

Add the six fields to the initial `state`. In `loadCharacterData(charName)`:

```js
var migrated = FonlingMemory.Storage.migrateCharacterData(d, loadedMessages);
state.messages = migrated.messages;
state.memorySchemaVersion = migrated.settings.memorySchemaVersion;
state.memories = migrated.settings.memories;
state.currentScene = migrated.settings.currentScene;
state.memoryCandidates = migrated.settings.memoryCandidates;
state.memoryAnalysis = migrated.settings.memoryAnalysis;
state.memoryRequestTraces = migrated.settings.memoryRequestTraces;
```

Preserve the existing legacy fields in runtime only until Task 7 removes the legacy editors. Merge `serializeMemoryState(state)` into the object saved by `saveCurrentCharacter()`. If `migrated.changed` is true, save after the entire character load succeeds; do not save from inside `migrateCharacterData`.

- [ ] **Step 5: Run migration, existing import, and full regression tests**

Run:

```powershell
node --test tests/memory-migration.test.js tests/import-data.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit migration integration**

```powershell
git add js/memory/memory-storage.js tests/memory-migration.test.js index.html
git commit -m "feat: migrate character memory data"
```

### Task 3: Versioned Export and Staged Import

**Files:**
- Create: `tests/memory-import-export.test.js`
- Modify: `index.html:789-852`
- Modify: `tests/import-data.test.js`

**Interfaces:**
- Consumes: `Storage.migrateCharacterData` and `Storage.serializeMemoryState`.
- Produces: `buildExportData(state, now?)`, `normalizeImportedCharacter(data)`, and a revised `importData(file)` that assigns state only after validation succeeds.
- Export root uses `schemaVersion: 2` while retaining `export_version: 2` for readable continuity.

- [ ] **Step 1: Write failing round-trip and atomic-import tests**

Add tests proving:

```js
test('new export round-trips structured memories, candidates, scene, and message ids', () => {
  const exported = buildExportData(sourceState, () => '2026-08-13T00:00:00.000Z');
  const imported = normalizeImportedCharacter(exported);
  assert.equal(exported.schemaVersion, 2);
  assert.deepEqual(imported.settings.memories, sourceState.memories);
  assert.deepEqual(imported.settings.currentScene, sourceState.currentScene);
  assert.deepEqual(imported.settings.memoryCandidates, sourceState.memoryCandidates);
  assert.deepEqual(imported.messages, sourceState.messages);
});
```

Also prove that legacy exports migrate, invalid JSON leaves the existing state byte-for-byte unchanged, and imports whose `messages` is not an array are rejected.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test tests/memory-import-export.test.js tests/import-data.test.js`

Expected: FAIL because export/import helpers and schema version 2 are missing.

- [ ] **Step 3: Extract export and staged-import helpers**

Implement `buildExportData` as a pure helper used by `exportAllData()`. Implement `normalizeImportedCharacter(data)` to clone, validate, and migrate into a temporary snapshot. In `importData`, assign every state field only after `normalizeImportedCharacter` returns successfully; call `saveCurrentCharacter()` exactly once.

- [ ] **Step 4: Preserve the one-file-per-character contract**

Keep the download behavior and filename form, but set:

```js
{
  schemaVersion: 2,
  export_version: 2,
  exported_at: now,
  settings: { /* existing settings plus memory fields */ },
  messages: state.messages
}
```

Do not export the character list or other characters.

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/memory-import-export.test.js tests/import-data.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit versioned backup support**

```powershell
git add index.html tests/import-data.test.js tests/memory-import-export.test.js
git commit -m "feat: version memory backups"
```

---

## Stage 2 — Manual Memory Center

### Task 4: Implement Formal Memory Operations and Pinned Budget

**Files:**
- Modify: `js/memory/memory-model.js`
- Modify: `tests/memory-model.test.js`

**Interfaces:**
- Produces: `PINNED_MEMORY_CHAR_BUDGET = 4000`, `addMemory(memories, input, options?)`, `updateMemory(memories, id, patch, options?)`, `removeMemory(memories, id)`, `setMemoryStatus(memories, id, status, now?)`, and `getPinnedCharacterCount(memories)`.
- All operations return `{ ok, memories, error? }`; failed operations return the original array unchanged.

- [ ] **Step 1: Write failing operation tests**

Cover manual add/edit/delete, history-event status validation, key-info status validation, restoring inactive memories, and pinned budget rejection:

```js
test('rejects a pinned update that exceeds 4000 characters without mutation', () => {
  const original = [Model.createMemory({ type: 'key_info', content: 'A'.repeat(3995), pinned: true })];
  const result = Model.addMemory(original, { type: 'key_info', content: 'B'.repeat(10), pinned: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'PINNED_BUDGET_EXCEEDED');
  assert.equal(result.memories, original);
});
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `node --test tests/memory-model.test.js`

Expected: FAIL because memory operations are missing.

- [ ] **Step 3: Implement operations without DOM dependencies**

Use type-compatible statuses only. Deletion permanently removes the object; status changes preserve ID, source metadata, and `createdAt`, and update `updatedAt`.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/memory-model.test.js`

Expected: PASS.

- [ ] **Step 5: Commit formal memory operations**

```powershell
git add js/memory/memory-model.js tests/memory-model.test.js
git commit -m "feat: manage formal story memories"
```

### Task 5: Build the Standalone Memory Center UI

**Files:**
- Create: `css/memory.css`
- Create: `js/memory/memory-ui.js`
- Create: `tests/memory-ui-structure.test.js`
- Modify: `index.html:3-294`

**Interfaces:**
- Produces: `window.FonlingMemory.UI.createMemoryUI(elements)`.
- Returned UI exposes `render(snapshot)`, `openCenter(tab?)`, `closeCenter()`, `openCandidateSheet()`, `closeCandidateSheet()`, `showAnalysisFailure(message)`, and `showStorageWarning(details)`.
- Emits callbacks registered through `on(action, handler)` for `add-memory`, `update-memory`, `delete-memory`, `set-status`, `toggle-pinned`, `patch-scene`, `clear-scene`, `manual-analyze`, `candidate-confirm`, `candidate-edit`, `candidate-dismiss`, `open-source`, and `open-trace`.

- [ ] **Step 1: Write failing structural tests**

Create a source-level DOM contract test that verifies `index.html` contains unique IDs for:

```text
memoryCenterBtn
memoryPromptBar
memoryPromptText
memoryCandidateSheet
memoryCenterOverlay
memoryCenterTabs
memoryHistoryPanel
memoryKeyInfoPanel
memoryScenePanel
memoryPendingPanel
memoryAnalyzeBtn
```

Verify script order is Model → Storage → Context → Analyzer → UI → Controller → existing inline app script, and `css/memory.css` is linked.

- [ ] **Step 2: Run the structural test and verify red**

Run: `node --test tests/memory-ui-structure.test.js`

Expected: FAIL because the memory UI shell and assets do not exist.

- [ ] **Step 3: Add accessible UI shells to `index.html`**

Add:

- A settings button labeled `记忆中心`.
- A hidden prompt bar above `#inputBar`, with `aria-live="polite"` and a count.
- A fixed bottom sheet with a drag handle, close button, scrollable candidate list, and link to the memory center.
- A full-height memory center overlay with four tabs: `历史事件`, `关键信息`, `当前场景`, `待确认`.
- Forms for manual memory entry and the eight scene fields.

Remove no legacy editor yet; hide it only after Task 7 migrates the UI bindings.

- [ ] **Step 4: Implement `memory.css` and UI renderer**

Use existing dark variables and enforce:

```css
#memoryPromptBar { flex-shrink: 0; }
.memory-sheet { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
.memory-sheet__body, .memory-center__body { overflow-y: auto; -webkit-overflow-scrolling: touch; }
.memory-action { min-height: 44px; }
@media (max-width: 480px) { .memory-candidate__actions { grid-template-columns: 1fr 1fr 1fr; } }
```

Render text using `textContent`, not `innerHTML`, for all memory and AI content.

- [ ] **Step 5: Run structural and syntax tests**

Run:

```powershell
node --test tests/memory-ui-structure.test.js
node --check js/memory/memory-ui.js
```

Expected: PASS.

- [ ] **Step 6: Commit the memory center shell**

```powershell
git add index.html css/memory.css js/memory/memory-ui.js tests/memory-ui-structure.test.js
git commit -m "feat: add memory center interface"
```

### Task 6: Connect Manual Memory and Scene Management

**Files:**
- Create: `js/memory/memory-controller.js`
- Create: `tests/memory-controller.test.js`
- Modify: `index.html:854-906, 1012-1074`

**Interfaces:**
- Produces: `window.FonlingMemory.Controller.createMemoryController(options)`.
- `options` requires `getState()`, `save()`, `getCharacterName()`, `ui`, and `now()`; analysis dependencies remain optional until Stage 4.
- Controller exposes `sync()`, `addMemory(input)`, `updateMemory(id, patch)`, `deleteMemory(id)`, `setMemoryStatus(id, status)`, `togglePinned(id)`, `patchScene(patch)`, and `clearScene()`.

- [ ] **Step 1: Write failing controller tests with a fake UI**

Prove that manual writes immediately persist and rerender, failed pinned writes do neither, scene patches preserve untouched fields, clearing the scene does not touch formal memories, and deletion requires the caller-confirmed action rather than being silently invoked.

- [ ] **Step 2: Run controller tests and verify red**

Run: `node --test tests/memory-controller.test.js`

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement manual controller actions**

Implement controller methods by calling Model operations, replacing only the relevant state arrays/objects, calling `save()`, then `ui.render()`. The UI owns the confirmation dialog text; the controller owns data validation.

- [ ] **Step 4: Wire UI callbacks and character lifecycle**

Initialize one controller in `init()`. Call `memoryController.sync()` after character load, creation, import, and role-independent settings sync. Opening the memory center always renders the current character snapshot.

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/memory-controller.test.js tests/memory-ui-structure.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit manual management**

```powershell
git add js/memory/memory-controller.js tests/memory-controller.test.js index.html
git commit -m "feat: connect manual memory management"
```

### Task 7: Retire Legacy Memory Editors Safely

**Files:**
- Create: `tests/legacy-memory-retirement.test.js`
- Modify: `index.html:225-250, 339-342, 854-906, 1031-1032, 1061`

**Interfaces:**
- Consumes: the memory center from Tasks 5–6.
- Removes runtime dependence on `state.historyEvents`, `state.keyInfo`, `state.currentState`, `renderHistoryEvents`, `renderKeyInfo`, `historyEventsContainer`, `currentStateInput`, `addEventBtn`, and `addKeyInfoBtn`.
- Keeps legacy property recognition only inside migration/import code.

- [ ] **Step 1: Write a failing retirement test**

Assert that the legacy setting labels/controls and legacy render functions no longer exist in `index.html`, while the migration tests still contain and successfully convert legacy property names.

- [ ] **Step 2: Run the test and verify red**

Run: `node --test tests/legacy-memory-retirement.test.js tests/memory-migration.test.js`

Expected: retirement test FAIL; migration test PASS.

- [ ] **Step 3: Remove legacy controls and bindings**

Replace the old history/key/current-state section with one concise description and the `记忆中心` button already added in Task 5. Remove obsolete DOM references, render functions, listeners, and runtime state fields. Keep migration and old JSON compatibility in `memory-storage.js`.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test tests/legacy-memory-retirement.test.js tests/memory-migration.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit legacy UI retirement**

```powershell
git add index.html tests/legacy-memory-retirement.test.js
git commit -m "refactor: retire legacy memory editors"
```

---

## Stage 3 — Candidate Approval

### Task 8: Implement Candidate Decisions as Pure Operations

**Files:**
- Modify: `js/memory/memory-model.js`
- Create: `tests/memory-candidates.test.js`

**Interfaces:**
- Produces: `confirmCandidate(snapshot, candidateId, editedCandidate?, options?)`, `dismissCandidate(snapshot, candidateId)`, and `dismissCandidateBatch(snapshot, candidateIds)`.
- Snapshot input/output is `{ memories, currentScene, memoryCandidates }`.
- Successful confirmation atomically updates formal data and removes the candidate; failure leaves the original snapshot unchanged.

- [ ] **Step 1: Write failing tests for every candidate operation**

Cover:

- `add` creates a formal memory.
- `update` preserves target ID and source history.
- `merge` removes target memories and creates one replacement.
- `resolve` applies only compatible status.
- `scene_patch` preserves untouched scene fields.
- Edited confirmation uses the edited type/content/pinned fields.
- Dismiss removes only the candidate.
- Invalid target or pinned-budget failure changes nothing.

- [ ] **Step 2: Run candidate tests and verify red**

Run: `node --test tests/memory-candidates.test.js`

Expected: FAIL because decision helpers are missing.

- [ ] **Step 3: Implement atomic candidate decisions**

Clone the three snapshot branches before applying an operation. Return `{ ok, snapshot, error? }`. Never partially remove targets or candidates on failure.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/memory-candidates.test.js`

Expected: PASS.

- [ ] **Step 5: Commit candidate operations**

```powershell
git add js/memory/memory-model.js tests/memory-candidates.test.js
git commit -m "feat: apply memory candidate decisions"
```

### Task 9: Wire Prompt Bar, Approval Sheet, and Candidate Editing

**Files:**
- Modify: `js/memory/memory-ui.js`
- Modify: `js/memory/memory-controller.js`
- Modify: `tests/memory-controller.test.js`
- Create: `tests/memory-approval-ui.test.js`

**Interfaces:**
- Controller adds `confirmCandidate(id, edited?)`, `dismissCandidate(id)`, and `dismissAllCandidates()`.
- UI renders pending candidates from `state.memoryCandidates`, updates prompt count, and opens the sheet without changing candidate status.

- [ ] **Step 1: Write failing approval behavior tests**

Prove that:

- Pending count `2` renders `TA 发现了 2 条新记忆`.
- Closing the sheet preserves both candidates.
- `不计入` removes one candidate and persists.
- Batch dismissal requires an explicit UI confirmation callback.
- `修改` can change type, content, pinned flag, target IDs, `resultStatus`, and scene patch.
- `保存并确认` applies the edited value.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test tests/memory-controller.test.js tests/memory-approval-ui.test.js`

Expected: FAIL because approval wiring is missing.

- [ ] **Step 3: Implement prompt and sheet state**

Show the prompt only when pending candidates exist. The prompt remains above `#inputBar`. Closing the sheet only toggles visibility. Render update/merge/conflict cards with old and proposed content; render scene patches as changed fields only.

- [ ] **Step 4: Implement candidate edit form and actions**

Use form controls appropriate to the operation. For `scene_patch`, display only the eight allowed scene fields and send an object containing fields the user kept non-empty or explicitly cleared. Use a dedicated “clear this field” checkbox to distinguish omission from intentional emptying.

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/memory-controller.test.js tests/memory-approval-ui.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit candidate approval UI**

```powershell
git add js/memory/memory-ui.js js/memory/memory-controller.js tests/memory-controller.test.js tests/memory-approval-ui.test.js
git commit -m "feat: approve suggested memories"
```

### Task 10: Align Clear, Backtrack, and Regenerate Semantics

**Files:**
- Modify: `index.html:717-764, 1083-1091, 1193-1200`
- Modify: `tests/clear-chat.test.js`
- Create: `tests/memory-conversation-lifecycle.test.js`

**Interfaces:**
- Produces: `clearConversationMemoryArtifacts(state)` in `memory-model.js`.
- Produces: `removeArtifactsAfterMessageIds(state, retainedMessageIds)` for backtrack/regenerate cleanup.
- Formal `memories` and `currentScene` must never be changed by either helper.

- [ ] **Step 1: Extend failing clear-chat regression coverage**

Add pending candidates, analysis metadata, and request traces to `tests/clear-chat.test.js`. Assert clear chat removes them while preserving formal memories and scene.

- [ ] **Step 2: Add failing backtrack/regenerate lifecycle tests**

Prove that removing messages also removes candidates sourced only from removed messages, analyzed-turn keys involving removed messages, and request traces for removed assistant messages. Formal memories remain unchanged even if their source messages are gone.

- [ ] **Step 3: Implement lifecycle helpers**

Place pure helpers in `memory-model.js`. Make `clearChatBtn`, `backtrackMessage`, and regeneration truncation call them before saving. Regenerating an answer must assign a new assistant message ID so it can be analyzed as a new turn after completion.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test tests/clear-chat.test.js tests/memory-conversation-lifecycle.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit conversation lifecycle behavior**

```powershell
git add index.html js/memory/memory-model.js tests/clear-chat.test.js tests/memory-conversation-lifecycle.test.js
git commit -m "fix: align memory with conversation lifecycle"
```

---

## Stage 4 — AI Analysis and Story Injection

### Task 11: Build Deterministic Memory Context Selection

**Files:**
- Create: `js/memory/memory-context.js`
- Create: `tests/memory-context.test.js`

**Interfaces:**
- Produces: `window.FonlingMemory.Context`.
- Produces: `PINNED_MEMORY_CHAR_BUDGET = 4000`, `MEMORY_CONTEXT_CHAR_BUDGET = 8000`, `selectMemoriesForContext(input)`, `formatScene(scene)`, `formatMemory(memory)`, and `buildMemoryContextMessages(input)`.
- `selectMemoriesForContext` returns `{ pinned, related, sceneText, usedCharacters, trace }`.
- Input includes `{ memories, currentScene, userText, recentMessages, now? }`.

- [ ] **Step 1: Write failing ranking and budget tests**

Cover:

- All valid pinned memories are selected.
- `resolved` and `invalidated` key info are excluded.
- Archived history is selectable only on a direct keyword hit.
- Current character/location/item keyword matches rank above merely recent memories.
- Current scene is complete and precedes ordinary memories.
- Final formatted structured-memory text is at most 8000 characters.
- Pinned data beyond 4000 is rejected by the model and never silently truncated here.
- Selection returns exact memory IDs for request tracing.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test tests/memory-context.test.js`

Expected: FAIL because the context module is missing.

- [ ] **Step 3: Implement local relevance scoring**

Tokenize Chinese text using overlapping 2-character grams plus intact ASCII words. Score each active ordinary memory by:

```text
+8 per exact entity/word hit in userText
+5 per hit in currentScene
+3 per hit in recentMessages
+2 if updated within the newest 20% of memories
+1 if it is one of the five newest history events
```

Sort descending by score, then `updatedAt`, then ID for deterministic tests. Include only positive-score ordinary memories unless capacity remains for the five newest active history events.

- [ ] **Step 4: Implement formatting and trace output**

Return separate system messages in the required order: current scene, pinned memories, related key info, related/recent history. Trace contains `{ pinnedMemoryIds, relatedMemoryIds, sceneUpdatedAt, usedSummary: false }`; `buildApiMessages` sets `usedSummary` based on actual summary inclusion.

- [ ] **Step 5: Run tests and syntax check**

Run:

```powershell
node --test tests/memory-context.test.js
node --check js/memory/memory-context.js
```

Expected: PASS.

- [ ] **Step 6: Commit deterministic selection**

```powershell
git add js/memory/memory-context.js tests/memory-context.test.js
git commit -m "feat: select relevant story memories"
```

### Task 12: Inject Structured Memories and Record Request Traces

**Files:**
- Modify: `index.html:508-559, 657-764`
- Create: `tests/memory-api-context.test.js`

**Interfaces:**
- Changes `buildApiMessages(options?)` to return `{ messages, memoryTrace }`.
- `options.userText` defaults to the newest user message.
- Successful assistant responses store `state.memoryRequestTraces[assistantMessageId] = memoryTrace` after setting `usedSummary` correctly.

- [ ] **Step 1: Write failing API-context tests**

Prove exact order:

```text
persona/world
user identity or selected role
style instruction
current scene
pinned memories
related key information
related/recent history
rolling summary
recent raw messages
```

Also prove inactive key info is absent and the trace is keyed to the final assistant message ID after send and regenerate.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test tests/memory-api-context.test.js`

Expected: FAIL because `buildApiMessages` still emits legacy strings and returns only an array.

- [ ] **Step 3: Replace legacy memory injection**

Call `FonlingMemory.Context.buildMemoryContextMessages`. Keep persona, identity/role, style, summary, and recent messages, but remove direct loops over legacy fields. Update send and regenerate callers to use `.messages`.

- [ ] **Step 4: Save request traces only after successful responses**

Assign user and assistant IDs before building the request. On success, save the trace under the assistant ID. On failed requests, remove the placeholder assistant and do not leave a trace. Bound trace storage to the newest 50 assistant entries.

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/memory-api-context.test.js tests/summary-memory.test.js tests/sse-stream.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit story injection**

```powershell
git add index.html tests/memory-api-context.test.js
git commit -m "feat: inject relevant memories into stories"
```

### Task 13: Implement Trigger Rules and DeepSeek Analysis Parsing

**Files:**
- Create: `js/memory/memory-analyzer.js`
- Create: `tests/memory-analyzer.test.js`

**Interfaces:**
- Produces: `window.FonlingMemory.Analyzer`.
- Produces: `shouldAnalyzeTurn(input)`, `buildAnalysisMessages(input)`, `buildAnalysisRequest(input)`, `parseAnalysisResponse(text)`, `deduplicateCandidates(input)`, and `analyzeTurn(input)`.
- `analyzeTurn` accepts injected `fetchImpl`, `apiUrl`, `apiKey`, and `model`; returns `{ ok, candidates, error? }` and never mutates formal data.

- [ ] **Step 1: Write failing trigger tests**

Positive cases include location/time change, entering/leaving characters, promise/command/task, secret/identity reveal, relationship shift, important-item transfer, injury/death/recovery, crisis creation/resolution, and a new world rule. Negative cases include short greetings, repeated atmosphere, empty answer, and turns already represented by an analyzed turn key.

- [ ] **Step 2: Write failing parser and prompt tests**

Prove:

- Request uses `stream: false` and asks for strict JSON.
- Prompt includes recent messages, summary, scene, active key info, recent/related history, and pending candidates.
- Output is capped at 3 valid candidates.
- Markdown fences are stripped once.
- One balanced-object extraction attempt is allowed after direct parse fails.
- Unknown types, empty content, unknown scene keys, incompatible resolve status, and nonexistent source IDs are filtered.

- [ ] **Step 3: Run analyzer tests and verify red**

Run: `node --test tests/memory-analyzer.test.js`

Expected: FAIL because the analyzer module is missing.

- [ ] **Step 4: Implement trigger, prompt, and parser**

Use explicit Chinese/ASCII keyword groups plus minimum content length. Build an instruction that forbids turning guesses into facts and requests `shouldSuggest` plus `candidates`. Use the same `DEEPSEEK_API` and `MODEL` values injected by the controller.

- [ ] **Step 5: Implement deterministic deduplication and conflicts**

Normalize text by whitespace/punctuation removal for exact duplicates. For semantic-like overlap, use 2-character-gram Jaccard similarity:

- `>= 0.92`: exact-equivalent duplicate, discard.
- `0.65–0.919`: convert to `update` or `merge` only when memory type and named entities overlap.
- Explicit negation/contradictory status with shared entities: mark candidate metadata `conflict: true` and preserve both old/new content for UI review.
- Ambiguous claims use `possibleConflict: true`; never auto-invalidate.

Also deduplicate against pending candidates.

- [ ] **Step 6: Run tests and syntax check**

Run:

```powershell
node --test tests/memory-analyzer.test.js
node --check js/memory/memory-analyzer.js
```

Expected: PASS.

- [ ] **Step 7: Commit the analyzer**

```powershell
git add js/memory/memory-analyzer.js tests/memory-analyzer.test.js
git commit -m "feat: analyze story memory changes"
```

### Task 14: Orchestrate Automatic and Manual Analysis Safely

**Files:**
- Modify: `js/memory/memory-controller.js`
- Modify: `index.html:657-764, 992-1010`
- Create: `tests/memory-analysis-controller.test.js`

**Interfaces:**
- Controller adds `considerTurn(turn)`, `analyzeRecent({ force })`, and `getTurnKey(userMessageId, assistantMessageId)`.
- Uses a per-character promise queue stored inside the controller.
- Captures `characterName` and a cloned analysis snapshot before requesting; applies results only to that character's persisted state through an injected `loadCharacterSnapshot(name)` / `saveCharacterSnapshot(name, snapshot)` pair.

- [ ] **Step 1: Write failing orchestration tests**

Prove:

- Ordinary greetings do not call fetch.
- A story-changing completed turn calls fetch once.
- Refresh does not repeat a successfully analyzed turn.
- Failed analysis is not marked successful and can be manually retried.
- Manual整理 bypasses `shouldAnalyzeTurn`.
- Automatic and manual requests for one character run serially.
- Switching from character A to B during analysis writes results only to A and does not rerender B with A's candidates.
- Invalid analysis does not change messages, formal memories, scene, or candidates.

- [ ] **Step 2: Run orchestration tests and verify red**

Run: `node --test tests/memory-analysis-controller.test.js`

Expected: FAIL because analysis orchestration is missing.

- [ ] **Step 3: Implement per-character queue and persistence adapters**

Do not reuse mutable global `state` after awaiting fetch. Capture the source character name, load its latest persisted snapshot on completion, deduplicate candidates against that snapshot, save it, and call UI render only when it is still the active character.

- [ ] **Step 4: Invoke analysis after successful send and regenerate**

After response content, message IDs, request trace, and character data are saved, call:

```js
memoryController.considerTurn({
  characterName: state.currentCharacter,
  userMessageId: userMsg.id,
  assistantMessageId: assistantMsg.id
});
```

Do not await this call in the chat send path. Ensure rejection is caught inside the controller.

- [ ] **Step 5: Wire manual `整理记忆` and failure display**

The memory-center button calls `analyzeRecent({ force: true })`. Store `lastFailure` with time, turn key, and a user-safe message; clear it after a successful retry.

- [ ] **Step 6: Run focused and full tests**

Run:

```powershell
node --test tests/memory-analysis-controller.test.js tests/memory-analyzer.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit analysis orchestration**

```powershell
git add js/memory/memory-controller.js index.html tests/memory-analysis-controller.test.js
git commit -m "feat: orchestrate memory analysis"
```

### Task 15: Add Memory Source and Request-Trace Inspection

**Files:**
- Modify: `js/memory/memory-ui.js`
- Modify: `index.html:408-487`
- Create: `tests/memory-trace-ui.test.js`

**Interfaces:**
- Produces: message action `查看本次使用的记忆` for assistant messages with a trace.
- Produces: `ui.openSource(messageId)` and `ui.openTrace(assistantMessageId)` behavior.
- Source resolution returns one of `message`, `compressed`, or `unavailable`.

- [ ] **Step 1: Write failing source and trace tests**

Prove that an existing source scrolls to its message, a missing source on a formal memory displays `来源对话已压缩`, a missing/unknown candidate source displays `来源不可定位`, and traces list pinned/related memory content plus scene and summary usage.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test tests/memory-trace-ui.test.js`

Expected: FAIL because trace/source UI is missing.

- [ ] **Step 3: Add stable DOM hooks to rendered messages**

Set `data-message-id` on each message wrapper. Add the trace action only when `state.memoryRequestTraces[msg.id]` exists. Source jump uses `scrollIntoView({ block: 'center' })` and a temporary highlight class.

- [ ] **Step 4: Render trace and source fallbacks**

Resolve IDs against current formal memories and messages at display time. Never copy stale memory content into the trace; IDs allow edited memory content to display accurately.

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/memory-trace-ui.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit observability UI**

```powershell
git add js/memory/memory-ui.js index.html tests/memory-trace-ui.test.js
git commit -m "feat: inspect memory sources and usage"
```

### Task 16: Add Storage Diagnostics and Graceful Module Failure

**Files:**
- Modify: `js/memory/memory-storage.js`
- Modify: `js/memory/memory-controller.js`
- Modify: `js/memory/memory-ui.js`
- Modify: `index.html:380-394, 992-1010`
- Create: `tests/memory-storage-failure.test.js`

**Interfaces:**
- `saveCurrentCharacter()` returns `true` on success and `false` on failure.
- `Storage.isQuotaExceededError(error)` recognizes browser variants.
- `Storage.estimateSerializedBytes(value)` returns UTF-8 bytes when `TextEncoder` exists and `JSON.stringify(value).length * 2` as fallback.

- [ ] **Step 1: Write failing storage-failure tests**

Prove quota failure surfaces an export-backup warning, a candidate remains pending when its confirmation cannot save, estimated size is shown when opening the center, and absence/failure of one memory module leaves send/login initialization available with a `记忆功能暂不可用` notice.

- [ ] **Step 2: Run tests and verify red**

Run: `node --test tests/memory-storage-failure.test.js`

Expected: FAIL because save status and rollback are missing.

- [ ] **Step 3: Make saves observable and candidate confirmation rollback-safe**

Return a boolean from save. Candidate/manual operations save a proposed snapshot first; if save fails, restore the previous in-memory snapshot and keep the candidate pending. Show a blocking backup warning for quota errors.

- [ ] **Step 4: Add initialization guards**

Before constructing the controller, verify required namespaces exist. If not, keep existing chat listeners and settings operational, hide memory entry points, and add one system notice after character login.

- [ ] **Step 5: Run focused and full tests**

Run:

```powershell
node --test tests/memory-storage-failure.test.js
node --test tests/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit failure recovery**

```powershell
git add js/memory/memory-storage.js js/memory/memory-controller.js js/memory/memory-ui.js index.html tests/memory-storage-failure.test.js
git commit -m "fix: recover safely from memory failures"
```

---

## Final Verification

### Task 17: Run Full Automated, Syntax, and Chrome Mobile Verification

**Files:**
- Modify only if verification exposes a defect in the files already listed.

**Interfaces:**
- No new feature interface; this task verifies the complete specification.

- [ ] **Step 1: Run all Node regression tests**

Run:

```powershell
node --test tests/*.test.js
```

Expected: every existing and new test passes, including clear chat, import, summary, role rename, SSE, PWA, migration, candidate approval, context selection, analyzer, orchestration, trace, and failure recovery.

- [ ] **Step 2: Check all JavaScript syntax**

Run:

```powershell
Get-ChildItem -Recurse -Filter *.js js | ForEach-Object { node --check $_.FullName }
@'
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('embedded script not found');
new vm.Script(script, { filename: 'index.html' });
console.log('Embedded JavaScript syntax: OK');
'@ | node
```

Expected: all checks exit 0.

- [ ] **Step 3: Check diff quality and scope**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only planned implementation, tests, and plan/spec files are changed. `.superpowers/` visual-companion artifacts remain untracked and are not staged.

- [ ] **Step 4: Serve the app locally and perform Chrome mobile QA**

Use the Browser plugin first, with a 390×844 viewport. Verify:

1. Existing character login and chat still work.
2. Memory prompt does not cover the newest message or composer.
3. Candidate sheet opens, scrolls, closes without dismissal, and exposes three 44px actions.
4. Edit-and-confirm works for memory and scene candidates.
5. Memory center tabs, manual CRUD, pinned toggle, statuses, source display, and scene fields work.
6. Refresh restores pending candidates and current scene.
7. Switching characters keeps data isolated.
8. The on-screen keyboard does not hide the active field or confirmation controls.
9. Clearing chat preserves formal memories/scene and clears candidates/traces.
10. Browser console contains no application errors.

- [ ] **Step 5: Run a final independent code review**

Use `superpowers:requesting-code-review`. Require review of spec compliance, data-loss risks, character isolation, prompt injection boundaries, context budgets, import atomicity, and mobile accessibility. Address all Critical and Important findings before continuing.

- [ ] **Step 6: Re-run the complete verification after review fixes**

Repeat Steps 1–4. Do not claim completion based on an earlier run.

- [ ] **Step 7: Commit final verification fixes if any**

```powershell
git add index.html css/memory.css js/memory tests
git commit -m "test: verify structured memory manager"
```

Skip this commit if verification required no changes. Do not push without explicit user authorization.
