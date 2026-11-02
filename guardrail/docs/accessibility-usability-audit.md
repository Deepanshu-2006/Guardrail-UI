# Accessibility and Usability Review

**Date:** 2026-11-03  
**Scope:** Targeted keyboard and screen-reader usability review of the extension Staging dialog and dashboard navigation/decision confirmation. This is not a full accessibility conformance audit.

## Findings and changes

- **Dashboard navigation used ARIA menu roles without menu keyboard behavior.** It used `menubar`/`menuitem` roles but only implemented ordinary links and Tab navigation. Removed the roles so native navigation/list/link semantics match the actual behavior.
- **Mobile navigation state was not exposed.** The toggle always said “Toggle Navigation Menu” and omitted controlled-region/expanded state. It now names the action (“Open/Close navigation menu”), references the sidebar with `aria-controls`, and updates `aria-expanded` with the open state.
- **Decision confirmation was announced as a non-modal dialog but did not behave as one.** It is an inline confirmation, so it now uses a labelled group. Focus moves to its heading when opened and returns to the originating Approve or Reject button when cancelled. The two-step confirmation remains intact.
- **Decision consequences needed clearer text.** Both approval and rejection explanations now state that the dashboard records reviewer consent/denial only; it cannot inspect or change local browser state. Approval does not run the action; local extension checks and explicit user confirmation are still required for supported continuation.
- **Existing extension dialog behavior was retained and checked.** Staging and warning dialogs already have accessible names, focus entry/trapping/restoration, visible focus styles, and status announcements. Staging Escape dismisses the overlay without invoking continuation; a regression assertion now verifies that.

## Existing patterns retained

- Dashboard has a skip link, semantic regions, `aria-current` navigation, labelled filters, live status counts, error/status roles, keyboard-operable request cards, and global focus-visible outlines.
- Staging and warning dialogs use modal semantics, labels/descriptions, live announcements, focus trapping, focus restoration, and a safe initial focus target. Warning begins focused on Cancel.
- Dashboard approval and rejection still use a deliberate confirmation step. No authorization or continuation behavior was weakened.

## Files changed

- `dashboard/src/components/navigation.ts`
- `dashboard/src/shell.ts`
- `dashboard/src/components/detail.ts`
- `dashboard/src/tests/test-dashboard-shell.ts`
- `extension/src/staging/test-staging-ui.ts`

## Verification

Commands run:

```text
cd guardrail/dashboard && npm run test:shell
cd guardrail/extension && npm run test:staging-ui
```

- Dashboard shell: **PASS, 326/326**.
- Extension Staging UI: **PASS, 344/344** (including Escape does not invoke continuation).

These are Node/esbuild tests with mock DOMs. They verify component markup, keyboard state handling, and callback behavior, but do not validate actual assistive-technology output or browser focus behavior.

## Remaining verification

- No automated accessibility scanner or browser-based screen-reader/keyboard session is configured or was run.
- Warning dialog has focus/keyboard handling in implementation, but no dedicated warning-modal test suite is registered in the package scripts.
- Color contrast and text scaling were not measured systematically; this review makes no WCAG conformance claim.
- Mobile behavior was checked through component state/tests, not on a physical device or real browser viewport.
