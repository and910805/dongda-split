# Single-modal expense entry

## Scope

Replaces the three-stage mobile expense entry with the approved single-page demo layout. Desktop keeps the two-column composition: amount, description and payer on the left; participant selection and allocation on the right. Mobile presents the same mounted fields in one scrollable modal, with section shortcuts and an always-visible save dock.

Details and discard confirmation are inline regions in this same modal. No nested dialogs, next-step pages, demo scenario selectors or mock persistence are included in production code.

## Compatibility

- The POST/PATCH endpoints, payload fields, category values, ledger version checks, currency modules and submission helpers are retained.
- New entries still default to the current member only. Payers and participants remain independent.
- Equal, exact, hybrid and weighted splits, multiple payments, refunds, expense dates, quoted/custom rates, edits, unknown-result recovery and idempotency are retained.
- Hybrid roles explicitly say "Fixed amount" or "Share remainder". Valid data still uses the original fixedShares contract.
- All system labels and messages in this modal are English. User-entered descriptions, names and ledger names are preserved, not translated. Existing persisted category values are mapped to English labels.
- No database, API, package or lockfile changes. No automatic transfer or new real-money action is introduced.

## Visual review

Compared local component screenshots to the supplied desktop and mobile single-page reference. Matched the cream/sage palette, bordered amount card, two-column desktop divider, payer chips, visible 2x2 split controls, participant rows and green/gold save action. Adapted the former full-page shell to one modal; removed demo-only controls and changed system copy to English, so this is not a pixel-identical copy of the original Chinese full-page screenshot.

The reference has one participant list rather than a duplicate receipt sidebar. This implementation follows that layout and reveals the optional receipt inline. During review, inherited global footer color and navigation sizing were corrected in the scoped stylesheet.

## Validation

40 local Chromium component scenarios passed. Coverage includes all split modes, payment sums, refunds, quote/custom rates, currency precision, rounding ranges, empty and large member lists, invalid inputs, overflow-safe presentation, PATCH conflicts, duplicate submits, unknown responses, pending restoration, expiry, keyboard focus, inline discard/details and responsive viewports from 320 to 1440 pixels. A reduced-height viewport also checks that the save control remains visible.

Component verification uses the exact baseline React/financial runtime from the prior build and transpiles the changed JSX. API responses and session storage are simulated for these isolated browser scenarios. This is not a real backend integration or mobile-device test. The live website could not be loaded in the execution environment. CI runs the repository's existing unit tests and production build independently.

Additional node:test cases cover English presentation helpers and the preserved source contracts. They run under the existing `pnpm test` command with no new dependencies.

## Intentional safeguards

- Unsaved edits require an inline discard confirmation; a pristine close remains immediate.
- A "Fixed amount" row with no positive amount is not silently treated as an equal remainder row.
- Invalid or overflowing totals cannot crash amount rendering. Unsupported converted amounts are rejected before submission.
- Raw backend errors are not displayed; known service codes receive English guidance.
- The save button is guarded during an in-flight request; checking an uncertain request retains its original idempotency key and payload.

## Release

Review and merge the feature pull request after CI succeeds. This change does not itself deploy the live site. Verify the resulting deployment with a real account, existing entries, actual rate responses and iOS/Android keyboards before treating production validation as complete.

Suggested commit: `feat(expenses): match single-page demo in one English modal`
