---
date: 2026-04-09
topic: ergonomic-install-and-durable-setup
---

# Installation and Durable Setup Requirements

These are the retained product decisions from the original requirements discussion. Completed implementation sequencing, speculative architecture and migration instructions are omitted. The current operator contract is in [INSTALL.md](../../INSTALL.md).

## Installation

- Provide copyable human commands and agent instructions, with both published-package and repository-plugin paths. Document actual distribution availability rather than implying an unpublished package is usable.
- A human can start connection bootstrap without manually exporting variables; prompt only for missing connection values. Fully supplied inputs must support prompt-free automation.
- Verify the base URL and connection before saving. Bootstrap must not guess, enumerate, scan or select indexes; configure an index only after the operator explicitly names it.

## Durable Use

- Save one machine-level default profile and support additional named environments. Later threads must reuse saved configuration without repeating setup.
- Explicit connection overrides take precedence over saved profiles. Clear bootstrap-only connection variables before saved-profile startup.
- Preserve operator-authored catalogs and isolate named environments; replacement requires an explicit operator choice.

## Credentials and Local State

- Keep secrets separate from catalog and profile metadata, using the supported platform credential store on macOS, Windows and Linux.
- Explain unavailable or locked secret stores without silently storing plaintext credentials or making manual secret exports the normal human onboarding flow.
- Never put passwords in command arguments, client configuration, source catalogs or summaries.

## Boundaries

Human and agent installation must use the same setup behavior. OAuth/SSO, machine-to-machine profile synchronization, fleet management and a graphical setup application are outside this scope. Preserve advanced automation options without retaining a second argument parser or owner-only migration machinery.
