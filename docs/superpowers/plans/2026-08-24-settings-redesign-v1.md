# Settings Redesign v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single crowded settings form with the selected warm, layered settings home, dedicated category pages, and a safe full-screen editor for long text.

**Architecture:** Keep all existing storage and feature controllers intact. Add a small framework-free settings UI module for derived overview text and navigation state, move presentation into a dedicated stylesheet, and reorganize the existing controls without changing their IDs or persistence semantics.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js built-in test runner.

---

### Task 1: Settings UI contract

**Files:**
- Create: `js/settings/settings-ui.js`
- Create: `tests/settings-ui.test.js`
- Modify: `index.html`

- [ ] Write failing Node tests for active-chapter text, pending-summary count, role count, navigation, and dirty-editor state.
- [ ] Run `node --test tests/settings-ui.test.js` and verify failure because the module is missing.
- [ ] Implement a UMD module exposing `getOverview()` and `createNavigator()`.
- [ ] Add the script to `index.html` and rerun the test to green.

### Task 2: Category-based settings layout

**Files:**
- Create: `css/settings.css`
- Modify: `index.html`
- Test: `tests/settings-markup.test.js`

- [ ] Write a failing structural test requiring a settings home, five category routes, preserved legacy control IDs, and the long-text editor shell.
- [ ] Run `node --test tests/settings-markup.test.js` and verify the missing structure causes failure.
- [ ] Replace the old flat settings body with a home view and five dedicated subviews while preserving all existing input/button IDs.
- [ ] Implement the selected warm charcoal/brown card hierarchy, readable typography, 44px targets, full-screen mobile behavior, and desktop side-sheet behavior in `css/settings.css`.
- [ ] Rerun structural and module tests.

### Task 3: Navigation and long-text editing

**Files:**
- Modify: `index.html`
- Test: `tests/settings-markup.test.js`

- [ ] Extend the failing structural test to require category navigation, overview synchronization, explicit editor Save/Cancel actions, and an unsaved-change confirmation path.
- [ ] Implement `openSettingsView`, `closeSettings`, overview rendering, long-editor open/save/cancel, back handling, Escape handling, and background-click protection.
- [ ] Change the three long fields (AI persona/world, reply style, user identity) to preview rows that open the full-screen editor; retain hidden source controls so existing state synchronization remains compatible.
- [ ] Save only on explicit editor Save and restore the original text on cancel or failed persistence.
- [ ] Run all Node tests and an inline-script syntax check.

### Task 4: Visual and interaction verification

**Files:**
- Create: `design-qa.md`
- Create: `artifacts/settings-mobile.png`

- [ ] Start a static server from the worktree.
- [ ] Open the page in the available in-app browser, seed a local demo character, and capture the settings home at 390 x 844.
- [ ] Test all five category entries, full-screen editor Save/Cancel, unsaved-change confirmation, chapter and memory launch buttons, and absence of horizontal overflow or console errors.
- [ ] Compare the rendered mobile capture with selected concept 1, fix P0/P1/P2 differences, repeat capture, and record the comparison in `design-qa.md` with `final result: passed` or `blocked`.
- [ ] Run `node --test tests/*.test.js`, JavaScript syntax checks, and `git diff --check`; leave the worktree uncommitted for user review.

