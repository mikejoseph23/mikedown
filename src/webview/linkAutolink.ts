import { Link } from '@tiptap/extension-link';

// prosemirror-markdown's default link serializer emits `<href>` autolink form
// only when link text equals href verbatim. That works for `<https://x.com>`
// but not for `<user@host>` — markdown-it parses the email autolink to a Link
// with href="mailto:user@host" and text="user@host", which the default then
// re-serializes as `[user@host](mailto:user@host)` and marks the file dirty.
// Override to also emit the `<…>` form when href is `mailto:` + text.
export const LinkWithAutolink = Link.extend({
  addStorage() {
    const isAutolink = (mark: any, parent: any, index: number): boolean => {
      if (mark.attrs.title) return false;
      const content = parent.child(index);
      if (!content.isText) return false;
      if (content.marks[content.marks.length - 1] !== mark) return false;
      if (index !== parent.childCount - 1 && mark.isInSet(parent.child(index + 1).marks)) return false;
      const href: string = mark.attrs.href || '';
      if (/^\w+:/.test(href) && content.text === href) return true;
      if (/^mailto:/i.test(href) && content.text === href.slice(7)) return true;
      return false;
    };
    return {
      markdown: {
        serialize: {
          open(state: any, mark: any, parent: any, index: number) {
            state.inAutolink = isAutolink(mark, parent, index);
            return state.inAutolink ? '<' : '[';
          },
          close(state: any, mark: any, parent: any, index: number) {
            const inAutolink = state.inAutolink;
            state.inAutolink = undefined;
            if (inAutolink) return '>';
            const title = mark.attrs.title ? ` "${mark.attrs.title.replace(/"/g, '\\"')}"` : '';
            return '](' + (mark.attrs.href || '').replace(/[\(\)"]/g, '\\$&') + title + ')';
          },
          mixable: true,
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
