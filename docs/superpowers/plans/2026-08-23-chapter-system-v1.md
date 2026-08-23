# Fonling Chapter System v1 Implementation Plan

> **For agentic workers:** Use `executing-plans` task by task and `test-driven-development` for each behavior change.

**Goal:** Implement the approved optional chapter workflow, permanent chapter transcripts, confirmable free-model summaries, bounded narrative context, and complete narrative reset.

**Architecture:** Keep chapter behavior in UMD modules under `js/chapter/`; use `index.html` only for application coordination, persistence, model requests, and DOM wiring. Chapter metadata and archived raw text share the per-character settings record, while the recent chat window remains in the message record.

**Constraints:** Work only in `D:\github\fonling\.worktrees\chapter-system-v1-implementation`. Do not commit or merge before user review.

## Work items

1. **Domain model and storage**
   - Add chapter normalization, lifecycle transitions, immutable boundaries, summary draft/confirmation state, migration, serialization, and future-version rejection.
   - Tests: `chapter-model.test.js`, `chapter-storage.test.js`.

2. **Conversation integration**
   - Tag active-chapter messages, archive only complete saved turns, synchronize edit/free/Air replacement, and limit backtracking to the active chapter.
   - Extend save rollback snapshots to include chapters.
   - Tests: `chapter-controller.test.js`, `chapter-integration.test.js`, existing latest-message regressions.

3. **Rolling compaction and narrative context**
   - Group retired messages by chapter ownership; never mix chapter and nonchapter summaries.
   - Use active/unconfirmed transitions, latest confirmed chapter, nonchapter summary, and relevant older chapters within a 6000-character budget.
   - Extend request traces with chapter-summary usage.
   - Tests: `chapter-compaction.test.js`, `chapter-context.test.js`.

4. **Final chapter summaries**
   - Freeze and save the chapter boundary before a fixed free-GLM request.
   - Generate from rolling summary, uncompressed raw text, and captured current scene; enforce the 1200-character hard limit.
   - Guard results by character, chapter, revision, and epoch; support confirmation, manual confirmation, and regeneration while retaining old confirmed text.
   - Tests: `chapter-summary.test.js`.

5. **Chapter management UI**
   - Add the three-part status row, settings entry, current chapter controls, pending-summary prompt/list, ended chapter list, editable confirmed summary, and read-only original transcript.
   - Verify long names and long text at 390 × 844.
   - Tests: `chapter-ui.test.js` plus browser QA.

6. **Complete narrative reset**
   - Preserve character/persona/style/identity/roles/background/global model configuration.
   - Clear chat, every summary, chapters, structured memories, scene, candidates, analysis, traces, and async epochs; rollback the full prior state on save failure.
   - Tests: `clear-narrative-state.test.js`.

7. **Verification and review**
   - Run every Node test, syntax-check inline and module scripts, run `git diff --check`, and complete desktop/mobile browser QA.
   - Request independent pre-commit code review and resolve valid findings with tests first.
   - Leave the branch uncommitted in its worktree for user inspection.
