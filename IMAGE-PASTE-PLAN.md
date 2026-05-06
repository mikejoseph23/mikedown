# Image Paste — Planning Document

## Summary

Add Ctrl/Cmd+V image paste support to the MikeDown WYSIWYG editor. When a user pastes an image (or drags an image file into the editor), MikeDown writes the image to a folder beside the document and inserts the corresponding markdown reference at the caret. Tracks GitHub issue [#1](https://github.com/mikejoseph23/mikedown/issues/1).

**Target version:** 1.6.0 (minor bump — new feature, not a hotfix).

## Why

Pasting screenshots is one of the highest-frequency actions in note-taking workflows. VS Code's built-in markdown editor already supports it; MikeDown's custom editor currently does not, which is a sharp regression for users coming from the default editor.

## Scope

In:
- Clipboard image paste (raster: png/jpg/gif/webp; vector: svg)
- Drag-and-drop of image files into the editor (same pipeline)
- Auto-creation of the target folder
- Configurable folder, filename pattern, path style, alt-text behavior

Out (deferred):
- Downloading remote image URLs from the clipboard (insert as-is for now)
- Format conversion or compression
- Image management UI (rename, replace, garbage-collect orphans)

## Configuration

All settings under `mikedown.imagePaste.*`. Defaults in **bold**.

| Setting | Type | Default | Notes |
|---|---|---|---|
| `enabled` | boolean | **`true`** | Master toggle; off = fall back to default paste behavior |
| `folder` | string | **`images`** | Target folder name/path |
| `folderRelativeTo` | `"document"` \| `"workspace"` | **`document`** | Resolves `folder` against doc dir or workspace root |
| `filenamePattern` | string | **`${docName}-${timestamp}`** | Tokens: `${docName}`, `${date}`, `${time}`, `${timestamp}`, `${hash}`, `${index}` |
| `pathStyle` | `"relative"` \| `"workspace-absolute"` | **`relative`** | Path written into the markdown link |
| `altText` | `"empty"` \| `"filename"` \| `"prompt"` | **`empty`** | `prompt` shows inline input |
| `maxSizeMB` | number | **`10`** | Reject larger pastes with a clear error |

Collision handling: if the resolved filename exists, append `-1`, `-2`, … (not configurable). When `${hash}` is in the pattern and the existing file's hash matches, reuse it instead of writing a duplicate.

## Edge cases

- **Untitled / unsaved buffer**: prompt user to save the document first; abort paste if they cancel. Keeps relative paths meaningful.
- **File outside any workspace**: ignore `folderRelativeTo: workspace`, fall back to document folder.
- **Pasted text/uri-list (http/https URL)**: insert the URL verbatim as `![](url)`. Do not download.
- **SVG paste**: treat as image, save with `.svg` extension. (Sanitization out of scope for v1 — same trust model as any other inserted markdown.)
- **Multiple images in one paste**: handle each, insert in order separated by a single newline.

## Implementation sketch

1. **Webview**: intercept `paste` and `drop` events on the ProseMirror root. If clipboard has image MIME, read as ArrayBuffer; postMessage to extension host with bytes + MIME + suggested name.
2. **Extension host**: resolve config → compute target folder + filename → ensure folder exists → write file → return resolved relative path to webview.
3. **Webview**: insert `![alt](path)` via a ProseMirror transaction at the current selection. (Per existing feedback memory: never mutate `editor.view.dom` outside a PM transaction.)
4. **Settings**: register all keys in `package.json` `contributes.configuration`.

## Open questions

- None blocking. Defaults above are the proposal; revisit after dogfooding.

## Acceptance criteria

- [ ] Paste a screenshot into a saved `.md` file → image lands in `<docDir>/images/`, markdown link inserted at caret, file appears on disk.
- [ ] Paste into an unsaved buffer → prompted to save; cancel aborts cleanly.
- [ ] Drag an image file into the editor → same result as paste.
- [ ] Paste an `https://…` image URL → inserted as `![](url)`, no file written.
- [ ] Paste a 50 MB image → rejected with a clear error, nothing written.
- [ ] Two pastes of the same image with `${hash}` in pattern → second reuses the first file.
- [ ] All seven config keys are documented in `README.md` and discoverable via VS Code Settings UI.
