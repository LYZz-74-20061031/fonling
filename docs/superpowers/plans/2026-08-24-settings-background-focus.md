# Settings Background Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the settings character card use a saved crop position from the same user-selected background image without creating a second bitmap.

**Architecture:** Extend the existing settings UI module with pure focus and cover-layout calculations, persist one normalized `bgCardFocus` object with each character, and add a full-screen settings crop editor that renders the original `bgImage` in a clipped card-ratio frame. Keep the chat background unchanged and remove the generated fallback artwork.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Pointer Events, Node.js built-in test runner.

---

### Task 1: Focus model

**Files:**
- Modify: `tests/settings-ui.test.js`
- Modify: `js/settings/settings-ui.js`

- [ ] Add failing tests for default focus, invalid/overflow focus normalization, cover overflow metrics, portrait vertical dragging, and landscape horizontal dragging.
- [ ] Run `node --test tests/settings-ui.test.js` and verify failures are caused by missing focus APIs.
- [ ] Implement `normalizeBackgroundFocus`, `getCoverMetrics`, and `focusAfterDrag` as pure exported functions.
- [ ] Rerun the focused tests to green.

### Task 2: Character persistence

**Files:**
- Modify: `index.html`
- Modify: `tests/settings-markup.test.js`

- [ ] Add failing structural assertions for `bgCardFocus` in state initialization, character loading, current-character saving, analysis-snapshot saving, export, import, new-character defaults, background replacement reset, and background reset.
- [ ] Run the structural test and verify the persistence assertions fail.
- [ ] Add normalized focus handling to all listed state flows while preserving clear-chat behavior.
- [ ] Rerun tests to green.

### Task 3: Crop editor UI

**Files:**
- Modify: `index.html`
- Modify: `css/settings.css`
- Modify: `tests/settings-markup.test.js`
- Delete: `assets/settings-character-fallback.png`

- [ ] Add failing markup assertions for the crop button, full-screen crop editor, clipped preview, range controls, reset, cancel, and save actions, and for absence of the generated fallback asset reference.
- [ ] Add “调整卡片取景” beside the existing background controls and a full-screen editor inside the settings panel.
- [ ] Implement image-load measurement, pointer dragging, range-control fallback, dirty state, reset, cancel, and atomic save behavior.
- [ ] Apply the saved focus to the settings role card only; leave `applyBackground` chat positioning unchanged.
- [ ] Remove the generated raster asset and replace no-background treatment with the existing warm solid surface.
- [ ] Run all tests and syntax checks.

### Task 4: Browser and visual verification

**Files:**
- Modify: `design-qa.md`
- Create: `artifacts/settings-background-focus-mobile.png`

- [ ] Reload the local worktree preview and verify a role without a background has no generated artwork.
- [ ] Upload or seed a portrait demo background, open crop adjustment, drag vertically, save, reload, and verify the card position persists while the chat background position remains unchanged.
- [ ] Verify Cancel discards draft focus, Reset returns `50,35`, replacing/resetting background resets focus, and all controls remain visible at 390 × 844.
- [ ] Verify export contains `bgCardFocus` and imported normalized coordinates restore the card position.
- [ ] Check horizontal overflow and browser console logs, refresh `design-qa.md`, and run all tests, syntax checks, and `git diff --check`.
- [ ] Leave the worktree uncommitted and unmerged for user review.

