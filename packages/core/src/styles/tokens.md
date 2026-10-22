# MikeDown theme tokens

The core CSS reads colors, fonts and corner radii only from `--mikedown-*` custom properties. There are 54 of them, listed below. `tokens.css` holds the light and dark defaults. The VS Code extension maps each token from the VS Code theme variable it replaced in `src/webview/vscode-theme.css`, and does not load `tokens.css`.

## How theming works

- **The editor root** is `.mikedown-root`. It carries `data-mikedown-theme="light" | "dark" | "auto"`, set from `options.theme`, `handle.setTheme()` and the `editorTheme` setting. `auto` follows the operating system through `prefers-color-scheme`.
- **Overlays** that must escape the editor box (menus, pickers, dialogs) live in one `.mikedown-portal` element on `<body>`. The editor mirrors its theme attribute and inline variables onto the portal, so overlays get the same tokens.
- **Scope.** Every core selector is scoped under `:is(.mikedown-root, .mikedown-portal)`, so the stylesheet cannot style anything else on the host page.
- **Defaults have zero specificity.** `tokens.css` wraps its rules in `:where()`. To re-theme, set tokens on `.mikedown-root` for light and on `.mikedown-root[data-mikedown-theme="dark"]` for dark. Set the same values on `.mikedown-portal` if the overlays should follow.
- **Size.** The root fills its container (`height: 100%`), so give the container a height.
- **Not tokens.** Content typography stays on the existing settings variables: `--mikedown-font-family`, `--mikedown-heading-font-family`, `--mikedown-font-size` and `--mikedown-content-width`. Callout accents and the `==highlight==` color are fixed palettes with a dark variant. `--mikedown-scheme` (`light` or `dark`) is read by the script to pick the Mermaid and source-view highlight themes.

## Token list

The "Also replaces" column lists the other VS Code variables the core CSS used for the same role. In VS Code those spots now follow the main source, which is a small, deliberate change for the few themes where the two differed.

| Token | Used for | VS Code source (`vscode-theme.css`) | Also replaces | Light default | Dark default |
| --- | --- | --- | --- | --- | --- |
| `--mikedown-font-ui` | UI chrome font (toolbar, menus, dialogs) | `--vscode-font-family` (fallback `system-ui, -apple-system, sans-serif`) | — | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| `--mikedown-font-mono` | Code font | `--vscode-editor-font-family` (fallback `monospace`) | — | `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` | `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` |
| `--mikedown-font-size-ui` | Base size of the editor chrome | `--vscode-editor-font-size` (fallback `14px`) | — | `14px` | `14px` |
| `--mikedown-radius-sm` | Small corners (buttons, inputs, chips) | literal `4px` | — | `6px` | `6px` |
| `--mikedown-radius` | Popover and menu corners | literal `6px` | — | `8px` | `8px` |
| `--mikedown-radius-lg` | Dialog corners | literal `8px` | — | `12px` | `12px` |
| `--mikedown-surface` | Editor page background | `--vscode-editor-background` (fallback `#1e1e1e`) | — | `#ffffff` | `#1f1f21` |
| `--mikedown-surface-raised` | Popovers, menus, dialogs, tooltips, toasts | `--vscode-editorWidget-background` (fallback `#252526`) | `--vscode-editorHoverWidget-background`, `--vscode-menu-background`, `--vscode-notifications-background` | `#ffffff` | `#2a2a2d` |
| `--mikedown-surface-toolbar` | Toolbar strip | `--vscode-editorGroupHeader-tabsBackground` (no fallback) | — | `#fbfbfa` | `#1b1b1d` |
| `--mikedown-input-bg` | Text inputs and selects | `--vscode-input-background` (fallback `#3c3c3c`) | — | `#ffffff` | `#26262a` |
| `--mikedown-code-bg` | Inline code and code blocks | `--vscode-textCodeBlock-background` (no fallback) | — | `#f6f6f4` | `rgba(255, 255, 255, 0.06)` |
| `--mikedown-quote-bg` | Blockquote fill | `--vscode-textBlockQuote-background` (no fallback) | — | `rgba(55, 53, 47, 0.03)` | `rgba(255, 255, 255, 0.03)` |
| `--mikedown-text` | Document text, caret | `--vscode-editor-foreground` (fallback `#d4d4d4`) | `--vscode-editorCursor-foreground`, `--vscode-textBlockQuote-foreground`, `--vscode-inputOption-activeForeground`, `--vscode-badge-foreground` | `#2b2b2b` | `#e4e4e6` |
| `--mikedown-text-ui` | Chrome text (menus, dialogs, inputs) | `--vscode-foreground` (fallback `#cccccc`) | `--vscode-editorWidget-foreground`, `--vscode-editorHoverWidget-foreground`, `--vscode-menu-foreground`, `--vscode-notifications-foreground`, `--vscode-input-foreground`, `--vscode-list-hoverForeground` | `#3a3a3d` | `#d6d6da` |
| `--mikedown-text-muted` | Hints, placeholders, line numbers, descriptions | `--vscode-descriptionForeground` (fallback `#a0a0a0`) | `--vscode-input-placeholderForeground`, `--vscode-editorGhostText-foreground`, `--vscode-editorLineNumber-foreground` | `#6f6f74` | `#9b9ba3` |
| `--mikedown-icon` | Toolbar icons | `--vscode-icon-foreground` (fallback `#c5c5c5`) | — | `#55555c` | `#c2c2c9` |
| `--mikedown-border` | Popover and widget outlines | `--vscode-editorWidget-border` (fallback `#454545`) | `--vscode-editorHoverWidget-border`, `--vscode-menu-border`, `--vscode-notifications-border`, `--vscode-widget-border`, `--vscode-editorRuler-foreground` | `rgba(15, 15, 20, 0.10)` | `rgba(255, 255, 255, 0.10)` |
| `--mikedown-divider` | Hairlines between regions (toolbar, sidebar, separators, hr) | `--vscode-editorGroup-border` (fallback `#444444`) | `--vscode-panel-border`, `--vscode-menu-separatorBackground` | `rgba(15, 15, 20, 0.08)` | `rgba(255, 255, 255, 0.07)` |
| `--mikedown-input-border` | Input outlines | `--vscode-input-border` (no fallback) | — | `rgba(15, 15, 20, 0.16)` | `rgba(255, 255, 255, 0.14)` |
| `--mikedown-button-border` | Button outlines | `--vscode-button-border` (no fallback) | — | `transparent` | `transparent` |
| `--mikedown-quote-border` | Blockquote bar | `--vscode-textBlockQuote-border` (no fallback) | — | `rgba(55, 53, 47, 0.22)` | `rgba(255, 255, 255, 0.22)` |
| `--mikedown-contrast-border` | High-contrast focus outline (transparent elsewhere) | `--vscode-contrastActiveBorder` (no fallback) | `--vscode-contrastBorder` | `transparent` | `transparent` |
| `--mikedown-hover` | Hover fill for buttons and rows | `--vscode-toolbar-hoverBackground` (no fallback) | `--vscode-list-hoverBackground` | `rgba(55, 53, 47, 0.06)` | `rgba(255, 255, 255, 0.06)` |
| `--mikedown-active` | Pressed or toggled-on fill | `--vscode-toolbar-activeBackground` (no fallback) | `--vscode-inputOption-activeBackground`, `--vscode-badge-background` | `rgba(55, 53, 47, 0.10)` | `rgba(255, 255, 255, 0.10)` |
| `--mikedown-selected-bg` | Selected row in menus and lists | `--vscode-list-activeSelectionBackground` (no fallback) | `--vscode-menu-selectionBackground` | `#e8eaf6` | `rgba(121, 134, 203, 0.26)` |
| `--mikedown-selected-text` | Text on selected-bg | `--vscode-list-activeSelectionForeground` (no fallback) | `--vscode-menu-selectionForeground` | `#1a237e` | `#eef0fb` |
| `--mikedown-line-highlight` | Source-mode active line | `--vscode-editor-lineHighlightBackground` (no fallback) | — | `rgba(55, 53, 47, 0.035)` | `rgba(255, 255, 255, 0.04)` |
| `--mikedown-selection` | Text selection | `--vscode-editor-selectionBackground` (fallback `#264f78`) | — | `rgba(63, 81, 181, 0.18)` | `rgba(121, 134, 203, 0.38)` |
| `--mikedown-focus-ring` | Focus outline and focused input border | `--vscode-focusBorder` (fallback `#007fd4`) | — | `rgba(63, 81, 181, 0.55)` | `rgba(140, 158, 255, 0.6)` |
| `--mikedown-accent` | Primary button | `--vscode-button-background` (fallback `#0e639c`) | — | `#3f51b5` | `#5c6bc0` |
| `--mikedown-accent-hover` | Primary button hover | `--vscode-button-hoverBackground` (no fallback) | — | `#3546a0` | `#6f7dd0` |
| `--mikedown-accent-text` | Text on accent | `--vscode-button-foreground` (fallback `#ffffff`) | — | `#ffffff` | `#ffffff` |
| `--mikedown-button-bg` | Secondary button | `--vscode-button-secondaryBackground` (no fallback) | — | `#f1f1ef` | `rgba(255, 255, 255, 0.08)` |
| `--mikedown-button-text` | Secondary button text | `--vscode-button-secondaryForeground` (no fallback) | — | `#2b2b2b` | `#e4e4e6` |
| `--mikedown-button-hover` | Secondary button hover | `--vscode-button-secondaryHoverBackground` (no fallback) | — | `#e7e7e4` | `rgba(255, 255, 255, 0.14)` |
| `--mikedown-link` | Links | `--vscode-textLink-foreground` (fallback `#3794ff`) | — | `#3949ab` | `#9fa8ff` |
| `--mikedown-link-hover` | Link hover | `--vscode-textLink-activeForeground` (fallback `#3794ff`) | — | `#283593` | `#c0c6ff` |
| `--mikedown-wikilink` | [[Wikilinks]] | `--vscode-charts-purple` (fallback `#b180d7`) | — | `#8e24aa` | `#d39ce0` |
| `--mikedown-success` | Success marks (copied tick) | `--vscode-charts-green` (fallback `#89d185`) | — | `#2e7d32` | `#81c784` |
| `--mikedown-danger` | Errors, destructive actions | `--vscode-errorForeground` (fallback `#f48771`) | — | `#c62828` | `#ef6b6b` |
| `--mikedown-warning` | Warnings, broken-link and missing-image marks | `--vscode-editorWarning-foreground` (fallback `#cca700`) | — | `#b26a00` | `#ffb74d` |
| `--mikedown-info` | Spelling squiggle | `--vscode-editorInfo-foreground` (fallback `#3794ff`) | — | `#1e70d6` | `#64b5f6` |
| `--mikedown-find-match` | Find matches | `--vscode-editor-findMatchHighlightBackground` (no fallback) | — | `rgba(255, 196, 0, 0.32)` | `rgba(255, 213, 79, 0.22)` |
| `--mikedown-find-current` | Current find match | `--vscode-editor-findMatchBackground` (no fallback) | — | `rgba(255, 152, 0, 0.45)` | `rgba(255, 160, 0, 0.42)` |
| `--mikedown-find-current-border` | Current find match outline | `--vscode-editor-findMatchBorder` (no fallback) | — | `rgba(230, 120, 0, 0.85)` | `rgba(255, 176, 64, 0.85)` |
| `--mikedown-scrollbar` | Scrollbar thumb | `--vscode-scrollbarSlider-background` (no fallback) | — | `rgba(15, 15, 20, 0.16)` | `rgba(255, 255, 255, 0.14)` |
| `--mikedown-scrollbar-hover` | Scrollbar thumb hover | `--vscode-scrollbarSlider-hoverBackground` (no fallback) | — | `rgba(15, 15, 20, 0.30)` | `rgba(255, 255, 255, 0.26)` |
| `--mikedown-shadow` | Popover shadow color | `--vscode-widget-shadow` (no fallback) | — | `rgba(15, 15, 20, 0.12)` | `rgba(0, 0, 0, 0.45)` |
| `--mikedown-syntax-keyword` | Code: keywords, tags | `--vscode-symbolIcon-keywordForeground` (fallback `#569cd6`) | — | `#cf222e` | `#ff7b72` |
| `--mikedown-syntax-string` | Code: strings, attributes | `--vscode-debugTokenExpression-string` (fallback `#ce9178`) | — | `#0a3069` | `#a5d6ff` |
| `--mikedown-syntax-number` | Code: numbers, literals | `--vscode-debugTokenExpression-number` (fallback `#b5cea8`) | — | `#0550ae` | `#79c0ff` |
| `--mikedown-syntax-type` | Code: types, classes | `--vscode-symbolIcon-classForeground` (fallback `#4ec9b0`) | — | `#953800` | `#ffa657` |
| `--mikedown-syntax-function` | Code: function names | `--vscode-symbolIcon-functionForeground` (fallback `#dcdcaa`) | — | `#8250df` | `#d2a8ff` |
| `--mikedown-syntax-variable` | Code: variables, params | `--vscode-symbolIcon-variableForeground` (fallback `#9cdcfe`) | — | `#24292f` | `#e6edf3` |

## Why more than 35 tokens

The plan aimed at roughly 25 to 35 names. Folding further would change how the three built-in VS Code themes look, for example by giving inputs a border in Dark+ or painting secondary buttons in the primary color. The six `syntax-*` tokens and the three radii could be dropped by hosts that do not care, since they have sensible defaults.
