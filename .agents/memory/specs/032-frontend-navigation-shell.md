# Frontend navigation shell

## Objective
Create the first responsive navigation shell for Pyrite: a collapsible desktop rail and a compact mobile navigation that frames the dashboard without implementing domain screens.

## Scope
- In scope:
  - Shared navigation component for dashboard sections already defined by the product.
  - Collapsible desktop rail on the left with active dashboard state.
  - Compact mobile bottom navigation with access to secondary sections.
  - Responsive behavior for the 1280x720 desktop target and narrow PWA screens.
  - Empty dashboard placeholder content that makes the navigation testable.
- Out of scope:
  - Authentication, onboarding, startup audio, and first-run flows.
  - Domain data, API calls, persistence, and route implementations.
  - Radial gestures and imported third-party visual components.

## Approach
Use a client navigation shell with semantic links and local UI state only for the desktop rail. Keep navigation data in one module, use token-backed CSS, and use CSS media queries rather than device detection. The mobile bar exposes the primary destinations and a More control for the remaining areas; desktop shows the full rail and a compact mode.

## Acceptance criteria
- [ ] Desktop renders a left navigation rail that can collapse without losing labels for screen readers.
- [ ] Mobile renders a bottom navigation bar suitable for touch targets and exposes secondary destinations.
- [ ] Dashboard remains the main content surface and the shell works at desktop and mobile widths.
- [ ] Navigation has visible focus states and active state semantics.
- [ ] No backend, persistence, or domain data is introduced.
- [ ] TypeScript, build, and browser smoke checks pass.

## Verification
Run frontend TypeScript and build checks, then verify the dashboard shell at the current desktop preview and a narrow mobile viewport.

## Record
To be added in `docs/records/032-frontend-navigation-shell.md` when the implementation closes.

## Related
- `docs/VISUAL-IDENTITY.md`
- `.agents/memory/architecture.md`
- `.agents/memory/specs/002-frontend-skeleton.md`

## Notes
This spec is the technical record for the initial navigation shell. Future domain-specific navigation changes should use a new spec.

## Status

Implementation starts from the feature request to create the navigation shell.

## End

This file intentionally keeps the navigation shell small so domain screens can be added independently.
