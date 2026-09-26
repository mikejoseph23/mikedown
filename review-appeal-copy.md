# Review Appeal Copy

Draft of every user facing string for the review and support appeal (M1 in `review-appeal-planning.md`). Edit freely. M5, M6, and M8 use whatever is approved here verbatim.

Copy is in blockquotes. Each piece has a one line rationale and, where useful, one alternate.

## 1. Card title

> A note from Mike

Rationale: personal and quiet, reads like a handwritten note rather than a system prompt.

## 2. Card body

> Hi there! Thanks for downloading my markdown editor. I built MikeDown for myself because I wanted more of a word processor inside VS Code, instead of the split pane preview I'd used for years. Version 1 was half-decent. Since then I've kept adding features and fixing bugs, and I find it more useful than ever. Thanks too to everyone who has sent in feature requests.
>
> Problem is, the marketplace is crowded and it's hard to get noticed. I have a few hundred installs and only a handful of reviews, and reviews are what get an extension noticed. If you've found this extension useful, please help others find me by leaving me a review. If you have any ideas for new features or find any issues, feel free to contact me via GitHub!
>
> \- Mike

Rationale: Mike's own voice (rewritten by Mike 2026-09-26, lightly tightened). Origin story, then a plain ask for a review. No hardcoded counts so it does not go stale. About 95 words, signed "Mike"; check card fit at F5.

## 3. Button labels

> Leave a review

> Tell a colleague

> Open an issue

> Maybe later

> Don't ask again

Rationale: all under 18 characters and echo the letter ("a word to a colleague", "Open an issue"); approved by Mike 2026-09-26.

## 4. Copied confirmation (Tell a colleague)

> Copied. Paste it anywhere.

Rationale: confirms the action and tells the user the next step in four words.

## 5. Share message (clipboard)

> Check out MikeDown, a WYSIWYG markdown editor for VS Code: https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor

Rationale: neutral per Q7, reads naturally whether pasted into Slack, email, or a text. Alternate:

> MikeDown lets you edit markdown in VS Code like a document, no raw syntax: https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor

## 6. Entry point labels

Sidebar footer link:

> ♥ Support MikeDown

Dismiss × `aria-label` and tooltip:

> Hide this link

Post dismiss confirmation:

> Hidden. You can bring it back in Settings, Appearance.

Settings Appearance checkbox (`mikedown.support.showSidebarLink`):

> Show Support MikeDown link in sidebar

About tab section heading:

> Support MikeDown

About tab lead in:

> MikeDown is made by one person. A review or a word to a colleague goes a long way.

Command title (category `MikeDown`, title `Support MikeDown`):

> MikeDown: Support MikeDown

Rationale: one consistent name ("Support MikeDown") everywhere so users recognize it; the heart keeps the footer link soft; the dismiss confirmation says exactly where to undo it.

## 7. README section

> ## A note from the developer
>
> Hi there! Thanks for giving MikeDown a try. I built it for myself a few months ago. I'd used the popular Markdown Preview extension for years, and it's good, but I wanted more of a word processor inside VS Code instead of a split pane. Version 1 was half-decent. Since then I've kept adding features and fixing bugs, and it's now my everyday markdown editor. Thanks too to everyone who has sent in feature requests.
>
> Problem is, the marketplace is crowded and it's hard to get noticed. Reviews are what get an extension noticed, so if MikeDown has earned a spot in your workflow, please help others find it by [leaving me a review](https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details) or [passing it along to a colleague](https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor).
>
> Found a bug or have an idea? [Open an issue](https://github.com/mikejoseph23/mikedown/issues/new). I usually reply quickly.
>
> \- Mike

Rationale: longer version of the card letter in Mike's voice, with the Markdown Preview backstory and links for review, share, and issues. Approved by Mike 2026-09-26.

## 8. Fallback notice (`mikedown.support`, no MikeDown editor open)

> Open a markdown file in MikeDown to see how you can support the project.

Rationale: one sentence, 72 characters, tells the user what to do instead of failing silently.

Alternate (if M3 adds a "Leave a review" button to the notice so it is useful on its own):

> Thanks for thinking of MikeDown! A review on the Marketplace helps more than anything.
