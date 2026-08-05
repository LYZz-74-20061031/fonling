# Role Rename, SSE Integrity, and Static PWA Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix role rename state continuity and SSE tail decoding, then install the supplied artwork as stable Chrome/PWA icons and rename the app to “智能剧情故事”.

**Architecture:** Keep the existing static HTML/CSS/JavaScript application. Add one focused role-renaming function and one shared SSE reader used by both send and regenerate flows. Replace the generated Blob manifest with a static manifest and two generated PNG assets.

**Tech Stack:** HTML, CSS, browser JavaScript, Fetch/ReadableStream/TextDecoder, Node.js built-in test runner, bundled Python Pillow for mechanical image resizing.

## Global Constraints

- Preserve the single-file application runtime architecture; only the manifest and icon images become separate static assets.
- Do not add runtime dependencies or a build step.
- Do not change DeepSeek configuration, storage schema, import/export behavior, rolling summary behavior, or accepted personal-use security trade-offs.
- Use `D:\个人信息\个人资料\games\ai剧情图标.png` as the icon source without AI regeneration or quality enhancement.
- Rename all user-facing app identity strings to “智能剧情故事”.
- Do not commit, stage, push, or open a pull request.

---

### Task 1: Preserve identity state when a role is renamed

**Files:**
- Create: `tests/role-rename.test.js`
- Modify: `index.html:1134-1173`
- Test: `tests/role-rename.test.js`

**Interfaces:**
- Consumes: global `state.roles`, `state.currentRole`, `state.messages`, `saveCurrentCharacter()`, `renderRoles()`, `renderMessages()`, and `updateIdentityBar()`.
- Produces: `renameRole(index, newName)`.

- [ ] **Step 1: Write failing regression tests**

Create a Node VM test that extracts `renameRole()` from `index.html` and verifies:

```js
test('renaming the selected role preserves selection and message identity', () => {
  const context = loadRenameRole({ currentRole: '阿宁' });
  context.renameRole(0, '宁姐');
  assert.equal(context.state.roles[0].name, '宁姐');
  assert.equal(context.state.currentRole, '宁姐');
  assert.equal(context.state.messages[0]._roleName, '宁姐');
  assert.deepEqual(context.calls, ['save', 'roles', 'messages', 'identity']);
});

test('renaming an unselected role does not change the selected role', () => {
  const context = loadRenameRole({ currentRole: '主控同伴' });
  context.renameRole(0, '宁姐');
  assert.equal(context.state.currentRole, '主控同伴');
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tests/role-rename.test.js`

Expected: FAIL because `renameRole()` does not exist.

- [ ] **Step 3: Implement the minimal role rename function**

In `index.html`, add `renameRole(index, newName)` that:

1. Returns when the indexed role does not exist.
2. Captures the old name before assigning `newName.trim()`.
3. Updates `state.currentRole` when it equals the old name.
4. Rewrites each message `_roleName` equal to the old name so historical bubble colors remain associated.
5. Saves and refreshes roles, messages, and the identity bar.

Replace the role name input's inline change handler with `renameRole(idx, this.value)` so the role cards are rebuilt and switch buttons capture the new name.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `node --test tests/role-rename.test.js`

Expected: 2 tests pass.

---

### Task 2: Share a complete SSE stream reader between send and regenerate

**Files:**
- Create: `tests/sse-stream.test.js`
- Modify: `index.html:609-761`
- Test: `tests/sse-stream.test.js`

**Interfaces:**
- Consumes: a Fetch `ReadableStream<Uint8Array>` and an optional `onDelta(delta, fullContent)` callback.
- Produces: `readSseContent(stream, onDelta): Promise<string>`.

- [ ] **Step 1: Write failing SSE regression tests**

Extract `readSseContent()` into a Node VM context and feed it a fake reader whose chunks split the UTF-8 bytes of Chinese text and an emoji. The last SSE frame must deliberately omit its trailing newline.

Assert that:

```js
assert.equal(await context.readSseContent(stream, onDelta), '你好🌇结尾');
assert.equal(deltas.join(''), '你好🌇结尾');
```

Also include `[DONE]`, a non-`data:` line, and a malformed JSON line, proving they do not corrupt valid content.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tests/sse-stream.test.js`

Expected: FAIL because `readSseContent()` does not exist.

- [ ] **Step 3: Implement the shared stream reader**

Add `readSseContent(stream, onDelta)` before `sendMessage()`:

- Create one reader, decoder, buffer, and full-content string.
- Decode chunks with `{ stream: true }`.
- Parse complete newline-delimited SSE lines as they arrive.
- After `done`, append `decoder.decode()` to flush decoder state.
- Parse every remaining line, including a final line without a newline.
- For each valid `choices[0].delta.content`, append it and call `onDelta(delta, fullContent)`.
- Return the full content.

Replace both duplicated read loops in `sendMessage()` and `regenerateMessage()` with calls to this helper, preserving their existing message updates and streaming bubble behavior.

- [ ] **Step 4: Run focused role and SSE tests**

Run: `node --test tests/role-rename.test.js tests/sse-stream.test.js`

Expected: all focused tests pass.

---

### Task 3: Install supplied static icons and rename the app

**Files:**
- Create: `manifest.webmanifest`
- Create: `icons/icon-192.png`
- Create: `icons/icon-512.png`
- Modify: `index.html:3-6,273-293,911-951,1031-1050`
- Test: `tests/pwa-metadata.test.js`

**Interfaces:**
- Consumes: `D:\个人信息\个人资料\games\ai剧情图标.png`.
- Produces: static manifest and fixed icon URLs referenced by `index.html`.

- [ ] **Step 1: Write a failing metadata test**

Create `tests/pwa-metadata.test.js` that asserts:

- `index.html` contains `<title>智能剧情故事</title>`.
- The login heading contains `智能剧情故事`.
- `<head>` links `manifest.webmanifest`, `icons/icon-192.png`, and `icons/icon-512.png` as appropriate.
- The runtime `setupPWA()` Blob generator is absent.
- `manifest.webmanifest` has `name` and `short_name` equal to `智能剧情故事` and icon entries for 192 and 512 pixels.

- [ ] **Step 2: Run the metadata test to verify RED**

Run: `node --test tests/pwa-metadata.test.js`

Expected: FAIL because static metadata and files do not exist.

- [ ] **Step 3: Generate PNG assets mechanically**

Use bundled Python Pillow to open the supplied square PNG and resize it with high-quality resampling to exactly 192×192 and 512×512. Save both under `icons/`. Do not alter the source file.

- [ ] **Step 4: Add static manifest and HTML links**

Create `manifest.webmanifest` with:

```json
{
  "name": "智能剧情故事",
  "short_name": "智能剧情故事",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0d0d0d",
  "theme_color": "#0d0d0d",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Add static `<link rel="manifest">`, favicon, Apple Touch Icon, and theme-color tags in `<head>`. Remove `setupPWA()` and its `init()` call. Update the HTML title, login heading, and script heading to “智能剧情故事”.

- [ ] **Step 5: Run the metadata test to verify GREEN**

Run: `node --test tests/pwa-metadata.test.js`

Expected: all metadata assertions pass.

---

### Task 4: Full verification and Chrome-oriented mobile QA

**Files:**
- Verify: `index.html`
- Verify: `manifest.webmanifest`
- Verify: `icons/icon-192.png`
- Verify: `icons/icon-512.png`
- Verify: `tests/*.test.js`

**Interfaces:**
- Consumes: outputs of Tasks 1–3.
- Produces: verification evidence and user guidance; no additional runtime API.

- [ ] **Step 1: Run all regression tests**

Run: `node --test tests/*.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Check embedded JavaScript syntax**

Read the embedded `<script>` with Node and compile it using `new vm.Script(...)`.

Expected: `Embedded JavaScript syntax: OK`.

- [ ] **Step 3: Verify generated image dimensions**

Read both icon files with Pillow and assert exact dimensions `(192, 192)` and `(512, 512)`.

- [ ] **Step 4: Run mobile browser QA**

Serve the repository locally, open `index.html` at a 390×844 viewport, and verify:

- Page title and login heading are “智能剧情故事”.
- Manifest and icon requests load successfully.
- Login/create flow renders without console errors.
- Settings role rename interaction preserves the selected identity.

- [ ] **Step 5: Review final diff and repository state**

Run: `git diff --check` and `git status --short`.

Expected: only planned source, asset, test, spec, and plan files are changed or untracked. Do not stage or commit them.
