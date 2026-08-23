# Settings Redesign Visual QA

- Source visual truth: `artifacts/settings-reference-option-1.png`
- Implementation screenshot: `artifacts/settings-mobile.png`
- Comparison board: `artifacts/settings-qa-compare.html`
- Viewport and state: settings home, 390 × 844 CSS px, mobile full-screen panel
- Source pixels: 852 × 1846, normalized to 390 × 844 for comparison
- Implementation pixels: 390 × 844 at device scale factor 1

## Full-view comparison evidence

The source and implementation were rendered together in `artifacts/settings-qa-compare.html` at equal 390 × 844 display dimensions. The comparison covered overall composition, header, current-character card, five category rows, bottom breathing room, and warm charcoal/brown palette.

## Focused-region evidence

No additional crop was required for the settings home because every primary label, secondary line, card edge, and action label is readable in the equal-size comparison. The long-text editor was inspected separately at the 390 × 844 mobile viewport, including its fixed Cancel/Save header, large scrolling textarea, dirty indicator, and footer note.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Typography: the implementation uses the project's Chinese system-font stack, matches the source's bold/light hierarchy, keeps body text at readable sizes, and does not truncate category labels.
- Spacing and layout: 390 px panel width, 16 px side gutters, 19–25 px radii, 44 px minimum controls, and five rows fit without horizontal overflow. The layout preserves more breathing room than the old flat form.
- Colors and tokens: warm charcoal surfaces, restrained gold actions, cream primary text, muted brown-gray secondary text, and coral pending-state dot match the selected direction with sufficient contrast.
- Image quality: no built-in character artwork is used. With no uploaded background the identity card remains a warm solid surface; once the user selects a background, the same source image is reused without creating a second bitmap.
- Copy: all five selected categories and their supporting descriptions are present. The active chapter and pending-summary copy is derived from live character state.
- Accessibility and interaction: semantic dialog/navigation/button structure is present; category routes, editor Save/Cancel, unsaved-change confirmation, Escape/back behavior, chapter manager, and memory center were exercised. Browser console reported no errors or warnings.

## Comparison history

### Iteration 1

- P2: Home title was centered while the selected source used a larger left-aligned title.
- P2: The implementation's panel background lacked some of the source's warm ambient depth.
- Fixes at that stage: changed the home title to left alignment while retaining centered subpage titles and added warmer surface depth.

### Iteration 2

- Post-fix comparison shows the same major hierarchy, proportions, warmth, and density as the selected source.
- The source's “雨夜” chapter and pending-summary dot are demo state; the implementation correctly shows “无” and no dot for a new character. These are expected dynamic-content differences rather than visual drift.

### Iteration 3

- Removed the generated fallback artwork after confirming that the role card must only use the current character's user-selected background.
- Added the separate card-focus editor and verified the empty-background solid state, portrait overflow controls, persisted position, and unchanged centered chat background.

## Primary interactions tested

- Open and close Settings.
- Navigate to all five category pages and return home.
- Open the AI persona full-screen editor, edit and save text, and verify the preview updates.
- Trigger the unsaved-change confirmation and verify dismissing it keeps the editor open.
- Open and close Chapter Manager and Memory Center.
- Confirm panel `clientWidth` and `scrollWidth` are both 390 px at the target viewport.
- Confirm no browser console errors or warnings.

## Background focus refinement

- Implementation screenshot: `artifacts/settings-background-focus-mobile.png`
- Viewport and state: card focus editor, 390 × 844 CSS px, portrait source image
- The preview keeps the selected 2:1 role-card ratio and uses a real raster image with a dark readability overlay.
- Portrait images expose vertical adjustment and disable the ineffective horizontal axis; landscape images use the corresponding horizontal overflow.
- Dragging and range inputs share the same normalized `x`/`y` focus model. Reset returns to `50% 35%`.
- Saving writes only the two coordinates into the current character record. Reload verification preserved the card position while the chat background remained centered.
- Uploading or resetting a background resets the card focus atomically; failed local persistence restores both the previous image and previous focus.
- The focus value is included in character export/import and excluded from global model settings.
- Browser console reported no errors or warnings during open, adjust, save, reload, and reopen checks.

## Final result

final result: passed
