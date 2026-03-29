---
title: API Reference
version: 2.1.0
---

# API Reference

The MikeDown extension exposes a lightweight API for programmatic control of the editor lifecycle.

## Getting Started

Install the package from npm and import the client:

```typescript
import { MikedownClient } from '@mikedown/sdk';

const client = new MikedownClient({
  theme: 'dark',
  fontSize: 15,
  spellcheck: true,
});

await client.open('docs/guide.md');
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `string` | `"auto"` | Editor color scheme: `auto`, `light`, or `dark` |
| `fontSize` | `number` | `15` | Font size in pixels (10--36) |
| `spellcheck` | `boolean` | `true` | Enable browser spellcheck |
| `toolbar` | `boolean` | `true` | Show the formatting toolbar |

## Supported Formats

MikeDown reads and writes standard **GitHub Flavored Markdown**, including:

- [x] Headings, paragraphs, and block quotes
- [x] Ordered and unordered lists
- [x] Tables with alignment
- [x] Fenced code blocks with syntax highlighting
- [ ] Math blocks (coming soon)

> **Note:** All output is fully compatible with GitHub, GitLab, and static site generators like Hugo and Jekyll.

## Links and References

For more details see the [Contributing Guide](CONTRIBUTING.md) or file an issue on [GitHub](https://github.com/mikejoseph23/mikedown/issues).

---

*Last updated: March 2026*
