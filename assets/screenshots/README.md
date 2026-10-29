# Screenshots

These are the Marketplace listing and README images. The website keeps its own window-only copies in `website/vscode/`.

To retake them, use the `listing-screenshots` skill: `.claude/skills/listing-screenshots/SKILL.md`. It holds the shot list (file, theme, document, UI state, alt text), the capture script (`capture.sh`), the review step and how to update `README.md` and `website/vscode/index.html`.

New captures are staged in `_new/` (gitignored) and only replace these files when promoted. The images ship inside the `.vsix`, so the Marketplace listing changes with the next published version, not with a push.

The sample documents are in `assets/sample-docs/`.
