# Review Appeal Copy

Draft of every user facing string for the review and support appeal (M1 in `review-appeal-planning.md`). Edit freely. M5, M6, and M8 use whatever is approved here verbatim.

Copy is in blockquotes. Each piece has a one line rationale and, where useful, one alternate.

## 1. Card title

> A note from Mike

Rationale: personal and quiet, reads like a handwritten note rather than a system prompt.

## 2. Card body

> Thanks for using MikeDown.
>
> I built it for myself. I'd spent years in split pane previews and wanted markdown to feel like having a few Word documents open. It's been my main editor ever since, and nearly every feature came from using it daily. I'm accidentally proud of how it turned out.
>
> It's just me, and it's easy to miss on the Marketplace. A review, or a word to a colleague who uses VS Code, helps more than you'd think. Bug or idea? Open an issue. I reply fast.
>
> Mike

Rationale: a short letter from one colleague to another. Opens with thanks, tells the origin story (built for himself, dogfooded daily), then asks for a review or a word to a colleague and invites issues. Under 90 words, signed "Mike".

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
> Thanks for giving MikeDown a try.
>
> I built it for myself. I'd used the popular Markdown Preview extension for years, and it's great, but the split pane always felt like wasted space. I wanted editing docs and plans to feel like having a few Word documents open side by side. Version one already worked well, and it's been my everyday markdown editor since. Nearly every feature came from using it that way and thinking "I wish it did this." I'm accidentally proud of where it ended up.
>
> It's just me building it, and it's easy to miss among all the markdown editors on the Marketplace. If it's earned a spot in your workflow, [a review](https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details) or [a word to a colleague](https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor) is the best way to help it grow.
>
> I'm small enough to be quick. Bug or idea, [open an issue](https://github.com/mikejoseph23/mikedown/issues/new) and you'll likely hear back fast.
>
> Mike

Rationale: the longer version of the card letter, with the Markdown Preview backstory and links for review, share, and issues. About 165 words, a little over the 150 target, approved by Mike 2026-09-26.

Optional line (not included, Mike's call): "The whole design started as a conversation on a walk around my neighborhood."

## 8. Fallback notice (`mikedown.support`, no MikeDown editor open)

> Open a markdown file in MikeDown to see how you can support the project.

Rationale: one sentence, 72 characters, tells the user what to do instead of failing silently.

Alternate (if M3 adds a "Leave a review" button to the notice so it is useful on its own):

> Thanks for thinking of MikeDown! A review on the Marketplace helps more than anything.
