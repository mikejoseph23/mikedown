# Welcome to MikeDown

MikeDown edits markdown the way it will look. What you type is saved as plain `.md` text that any other editor can open. This page is a cheat sheet: edit it, break it, it is your own copy. **Help > Welcome Guide** brings it back.

Shortcuts below say **Cmd**; on Windows read **Ctrl**.

## Formatting

| You want | Type it | Or press |
| --- | --- | --- |
| **Bold** | `**bold**` | Cmd+B |
| *Italic* | `*italic*` | Cmd+I |
| ~~Strikethrough~~ | `~~strike~~` | Cmd+Shift+X |
| ==Highlight== | `==highlight==` | Cmd+Shift+H |
| `Inline code` | `` `code` `` | Cmd+E |
| Heading 1 to 6 | `# ` to `###### ` at the start of a line | Cmd+Alt+1 to 6 |
| Link | `[text](https://example.com)` | Cmd+K |

Lists start themselves: type `- ` for bullets, `1. ` for numbers, `- [ ] ` for a task list.

- [x] Read the welcome guide
- [ ] Open a folder of notes
- [ ] Make MikeDown the default app for `.md` files (Settings > App)

## Slash commands

Type `/` at the start of a line (or after a space) for a menu of blocks. Keep typing to filter, Enter to insert:

- `/h1` to `/h6`, `/quote`, `/bullet`, `/numbered`, `/todo`
- `/table`, `/code`, `/mermaid`, `/math`, `/footnote`, `/divider`
- `/note`, `/tip`, `/important`, `/warning`, `/caution` for callouts
- `/link`, `/wikilink`, `/image`, `/emoji`, `/date`, `/datetime`

## Tables

| Column | Another | Right aligned |
| :--- | :---: | ---: |
| Tab moves to the next cell | Shift+Tab goes back | 42 |
| Tab in the last cell adds a row | Right-click for more | 7 |

Insert one with `/table` or **Format > Insert > Table**.

## Callouts

> [!NOTE]
> A callout is a blockquote with a type: NOTE, TIP, IMPORTANT, WARNING or CAUTION. GitHub renders them too.

> [!TIP]
> Type `/tip` to insert this one.

## Images

Paste or drag an image into a saved document. MikeDown writes the file to an `images` folder beside the document and inserts a relative link, like `![diagram](images/diagram.png)`. The folder and file name pattern are in **Settings > App**.

## Links between notes

Open a folder (**File > Open Folder…**) and link notes by name: `[[Meeting notes]]` becomes a wikilink. Cmd+click a link to follow it. Relative links such as `[plan](plan.md)` open in a new tab.

## Math and diagrams

Inline math is `$E = mc^2$`, display math sits between `$$` lines. A fenced code block tagged `mermaid` draws a diagram.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New file | Cmd+N |
| Open file | Cmd+O |
| Open folder | Cmd+Alt+O |
| Save / Save As | Cmd+S / Cmd+Shift+S |
| Close tab | Cmd+W |
| Find / Find in folder | Cmd+F / Cmd+Shift+F |
| Toggle source mode | Cmd+/ |
| Settings | Cmd+, |
| Split right / down | Cmd+\ / Cmd+Shift+\ |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Show the folder sidebar | Cmd+Shift+E |
| Zoom in / out / reset | Cmd+= / Cmd+- / Cmd+0 |

**Help > Keyboard Shortcuts** lists every one.

## Saving

MikeDown saves when you press Cmd+S; a dot on the tab means unsaved changes. If the app quits or crashes first, your unsaved text comes back the next time you open it.
