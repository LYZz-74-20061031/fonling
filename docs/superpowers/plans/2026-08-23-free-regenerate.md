# Free Regenerate Implementation Plan

> **For agentic workers:** Execute inline in the explicitly authorized main workspace. Do not create a worktree, commit, or push.

**Goal:** Add a free GLM-4.7-Flash replacement action for the latest AI reply while preserving the paid Air replacement action and correct backtrack behavior.

**Architecture:** Parameterize the existing replacement pipeline by tier instead of duplicating it. Rendering selects actions from whether an assistant message is the final stored message; backtracking already re-renders the retained message as final.

**Tech Stack:** Static HTML, browser JavaScript, Node.js built-in `node:test` and `vm`.

---

### Task 1: Lock the message-action contract

**Files:**
- Create: `tests/latest-message-actions.test.js`

- [ ] Write a structural test asserting that the latest assistant exposes edit, free regenerate, Air regenerate, and optional trace, while older assistants expose backtrack and optional trace.
- [ ] Run `node --test tests/latest-message-actions.test.js` and confirm it fails because “重新回复” and a free regeneration route do not exist.

### Task 2: Parameterize reply replacement

**Files:**
- Modify: `index.html:947`
- Modify: `index.html:1438`
- Modify: `js/memory/memory-model.js:538`

- [ ] Add “重新回复” to the latest assistant actions and remove its “回溯” action.
- [ ] Change `regenerateMessage` to accept a tier/mode, forcing GLM free for ordinary regeneration and Air for deep regeneration.
- [ ] Keep both modes on the existing atomic replacement, cleanup, trace, persistence, and analysis path; use mode-specific failure text.
- [ ] Remove candidates unless all source messages remain, clear stale analysis status, and block edit/backtrack while generation is active.
- [ ] Run `node --test tests/latest-message-actions.test.js` and confirm all focused tests pass.

### Task 3: Verify regression safety

**Files:**
- Verify: `index.html`
- Verify: `js/model/*.js`

- [ ] Run the focused test plus syntax checks for the inline script and model modules.
- [ ] Run `git diff --check` and inspect `git diff -- index.html tests/latest-message-actions.test.js`.
- [ ] Confirm the working tree contains no API key and no unrelated changes.
