# ADR 2 — CSS strategy: hand-written CSS with custom properties, Tailwind config removed

- **Status**: accepted
- **Date**: 2026-08-30

## Context

§15 decision 1, REQ-APP-5. boba ships with a Tailwind config. The rest of the family — the kernel, and now src/core/model/validate.ts (ADR 1) — is deliberately dependency-free, and REQ-DATA-7 permits exactly three network calls and no third-party assets. REQ-TEST-2 forbids a build step for the test run. This decision blocks every component file, so it had to be settled before the first one was written.

boba's BaseComponent renders into the light DOM and scopes CSS by rewriting `:host` to the tag name (REQ-APP-2). That scoping mechanism is independent of which CSS dialect is used, so it does not force the choice either way.

## Decision

Hand-written CSS with custom properties. Design tokens are declared once on `:root`; components use `:host` for their own box and plain class selectors within it, relying on boba's `:host` rewriting for scoping.

boba's Tailwind config is removed from the scaffold rather than left in place. An inert config is a standing invitation to reach for it, and a project with a mixed strategy has no strategy — REQ-APP-2 already forbids mixing shadow-DOM and light-DOM approaches for the same reason.

## Consequences

No build step for CSS, nothing third-party in the bundle, and the styling surface is auditable in the same way the validator is.

Cost: the design tokens, layout primitives and any dark-mode handling are written by hand, and there is no utility-class shorthand. This is real work in p0-scaffold-boba, which should establish the token set and one or two layout primitives rather than leaving each component to invent its own.

Follow-up: p0-scaffold-boba removes the Tailwind config and any Tailwind directives from boba's scaffold, and an architecture guard test should assert no Tailwind dependency reappears.
