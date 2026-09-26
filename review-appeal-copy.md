# Review Appeal Copy

Draft of every user facing string for the review and support appeal (M1 in `review-appeal-planning.md`). Edit freely. M5, M6, and M8 use whatever is approved here verbatim.

Copy is in blockquotes. Each piece has a one line rationale and, where useful, one alternate.

## 1. Card title

> A note from Mike

Rationale: personal and quiet, reads like a handwritten note rather than a system prompt.

## 2. Card body

> Hi, I'm Mike, and I build MikeDown on my own. It's one of the few truly WYSIWYG markdown editors in a sea of half baked ones, so it's a small miracle you found it. A good review helps it climb the Marketplace rankings, and that's what keeps it alive and improving. Telling a friend who uses VS Code helps just as much. And if something bugs you or you have an idea, open an issue. I read every one.

Rationale: covers a (solo), b (sea of editors, small miracle), c (reviews and rankings), e (tell a friend), d (listening) in five sentences, under 80 words, no guilt or urgency.

## 3. Button labels

> Leave a review

> Tell a friend

> Share feedback

> Maybe later

> Don't ask again

Rationale: plain verbs, all under 18 characters; "Share feedback" stays broad so it covers both bugs and feature ideas. Alternate for the tertiary button: "Suggest an idea" (if you want to lean into feature requests).

## 4. Copied confirmation (Tell a friend)

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

> MikeDown is made by one person. A review or a word to a friend goes a long way.

Command title (category `MikeDown`, title `Support MikeDown`):

> MikeDown: Support MikeDown

Rationale: one consistent name ("Support MikeDown") everywhere so users recognize it; the heart keeps the footer link soft; the dismiss confirmation says exactly where to undo it.

## 7. README section

> ## A note from the developer
>
> Hi, I'm Mike, and I build MikeDown on my own. There are a lot of markdown editors out there, most of them half baked and few of them truly WYSIWYG, so it's a small miracle you found this one at all.
>
> If MikeDown makes your writing easier, two things help more than anything else:
>
> * **[Leave a review](https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details)** on the Marketplace. Every positive review nudges MikeDown up the rankings, and that's the best way to keep it alive and improving.
> * **Tell a friend or colleague** who uses VS Code. Word of mouth might be the best support of all. Here's the link to share: [MikeDown on the Marketplace](https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor).
>
> I'm listening, too. If something bugs you or you have an idea for a feature, [open a GitHub issue](https://github.com/mikejoseph23/mikedown/issues/new). I read every one.

Rationale: same five points as the card with room for the three links; about 130 words; replaces the current "Enjoying MikeDown?" section (which has an em dash). M8 may switch the `*` bullets to `-` to match the rest of the README.

## 8. Fallback notice (`mikedown.support`, no MikeDown editor open)

> Open a markdown file in MikeDown to see how you can support the project.

Rationale: one sentence, 72 characters, tells the user what to do instead of failing silently.

Alternate (if M3 adds a "Leave a review" button to the notice so it is useful on its own):

> Thanks for thinking of MikeDown! A review on the Marketplace helps more than anything.
