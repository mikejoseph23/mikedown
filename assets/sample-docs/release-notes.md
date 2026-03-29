# Release Notes — v3.2.0

**Release Date:** March 28, 2026

## Highlights

This release introduces **real-time collaboration**, a redesigned dashboard, and significant performance improvements across the platform.

> We've been working on real-time collaboration for the past six months, and we're thrilled to ship it today. Multiple users can now edit the same document simultaneously with cursor presence and conflict-free merging.

## What's New

### Real-Time Collaboration

- Live cursor presence showing collaborator positions
- Conflict-free replicated data types (CRDTs) for seamless merging
- Presence indicators in the sidebar showing who's online
- Works across all document types: notes, spreadsheets, and diagrams

### Redesigned Dashboard

- New card-based layout with drag-and-drop reordering
- Customizable widgets: recent files, team activity, storage usage
- Dark mode support with automatic system theme detection
- **50% faster** initial load time

### Performance

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Dashboard load | 2.4s | 1.1s | 54% faster |
| Document open | 800ms | 200ms | 75% faster |
| Search results | 1.2s | 350ms | 71% faster |
| File upload | 3.1s/MB | 1.8s/MB | 42% faster |

## Bug Fixes

- Fixed issue where **bold text** inside blockquotes lost formatting on save
- Fixed table column alignment resetting after undo/redo
- Fixed `code blocks` not preserving language hints in round-trip
- Fixed link autocomplete showing duplicate suggestions for files with spaces
- Fixed drag-and-drop of images creating duplicate entries

## Breaking Changes

None. This release is fully backward-compatible with v3.1.x configurations.

## Upgrade Guide

1. Back up your configuration directory
2. Pull the latest container image: `docker pull acme/platform:3.2.0`
3. Run the migration script: `./scripts/migrate.sh`
4. Restart all services: `kubectl rollout restart deployment --all`

---

*Full changelog available on [GitHub](https://github.com/acme/platform/releases/tag/v3.2.0)*
