---
title: Engineering Handbook
audience: New engineers — read in your first week
last_reviewed: 2026-05-01
---

# Engineering Handbook

Welcome to the team. This handbook is the one place we keep the practices, tools, and conventions every engineer here is expected to know within their first week. Read it once end-to-end, then keep it open in a side pane while you're getting set up.

## Getting Started

### Your First Day

You'll get a laptop, a 1Password invite, and a calendar invite to a 30-minute orientation with your manager. Before that orientation:

- Log into the laptop and complete the first-boot setup (FileVault, Touch ID, iCloud sign-in skipped).
- Accept the 1Password invite and unlock the shared "Engineering" vault.
- Clone the `monorepo` and run `./bin/bootstrap` — it installs Homebrew, Volta, Docker Desktop, and the project toolchain.

### Tooling Checklist

By the end of day two you should have the following installed and signed in:

- **VS Code** with the recommended extensions (run *Show Recommended Extensions* in the workspace)
- **GitHub CLI** (`gh auth login`) — used by our PR scripts
- **AWS CLI** with the `dev` SSO profile configured
- **Tailscale** for accessing the staging environment

### Reading List

Skim these in order; don't worry about retaining every detail:

- The team's `/docs/architecture.md` — service map and data flow
- The most recent two RFCs in `/docs/rfcs/` — current direction
- Any RUNBOOK marked `severity: high` in `/docs/runbooks/`

## Daily Workflow

### Branching

We use trunk-based development. Branch from `main`, keep branches short-lived (under 48 hours where possible), and rebase rather than merge when integrating upstream changes. Long-running feature branches are a smell — split the work behind a feature flag instead.

### Commit Messages

Imperative mood, present tense, no trailing period. The first line is a ≤72-character summary. The body explains *why*, not *what* — the diff already shows *what*. If the change is non-trivial, link the related ticket or RFC in the trailer.

### Pull Requests

- Keep PRs under ~400 lines of diff where you reasonably can
- One logical change per PR; refactors get their own PRs
- Fill out the PR template — the "How was this tested?" section is not optional
- Request review from at least one domain expert and one generalist

### Code Review

You are expected to review PRs within one business day of being requested. If you can't, decline early so the author can find someone else. Reviews should be substantive: leave at least one comment, even if it's praise.

## Architecture

### Services

Our backend is a small fleet of Go services behind an Envoy-based API gateway. Each service owns its own Postgres schema. Cross-service writes go through a dedicated outbox + event bus — never direct cross-schema queries.

### Frontend

A single Next.js app served from Vercel. Server components by default, client components only when interactivity demands it. State management is colocated; reach for a global store only with reviewer agreement.

### Data Pipeline

Events flow from the bus into our warehouse via a managed CDC connector. Transformations live in dbt; dashboards live in Metabase. Anything that loops back into a product surface must go through a feature flag *and* be backed by a documented metric.

## Operations

### On-Call

You join the on-call rotation after your first 90 days. Rotations are one week, handed off at 10am Monday. The primary takes pages; the secondary is a backstop, not a vacation.

### Incident Response

When you page, follow the standard template: **Detect → Contain → Communicate → Recover → Document**. The post-incident review happens within five business days and is blameless. Action items get owners and due dates; otherwise they don't count.

### Deployment

Every merge to `main` triggers a deploy to staging. Promotion to production is gated by manual approval from anyone other than the PR author, plus a passing smoke-test suite. Roll back, don't roll forward, when in doubt.

## Culture

### Communication

Async first. Slack for ephemeral coordination, GitHub for anything decision-shaped, Notion for long-lived references. If a thread hits ten replies and no consensus, escalate to a 15-minute synchronous call and write the outcome back into the thread.

### Meetings

We protect maker time. Meetings need an agenda *and* an outcome. No-agenda meetings get declined automatically by the calendar bot. Recurring meetings are reviewed quarterly and killed if they've drifted from their original purpose.

### Feedback

We do quarterly 1:1 360s — peer, manager, direct reports. Feedback is direct, specific, and kind, in that order. If you have a problem with someone's work, the right place to raise it is in the 1:1, not in a Slack channel.

## Appendix

### Glossary

- **RFC** — Request for Comments. Our long-form proposal format
- **CDC** — Change Data Capture. How we stream Postgres changes to the warehouse
- **SLO** — Service Level Objective. Targets we commit to, e.g. 99.9% uptime

### Further Reading

- *Software Engineering at Google* — the Trunk-Based Development chapter especially
- *Designing Data-Intensive Applications* — the canonical reference for the data layer
- Our internal `/docs/postmortems/` archive — read at least three before you go on call
