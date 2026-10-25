import { useState } from 'react';
import { MikeDownEditor } from '@mikedown/react';
import '@mikedown/core/styles.css';
import { stubAiHost, stubAiSettings } from '../common/stub-ai';

// The demo's AI is a stub: it streams canned text and calls no server.
const host = { ai: stubAiHost };
const settings = { ai: stubAiSettings };

const starter = `# Release notes

Edit this text. The markdown value follows **as you type**.

- [x] Tables, task lists and code blocks
- [ ] Diagrams and math

| Framework | Package |
| --- | --- |
| React | @mikedown/react |

Type / for headings, callouts and more.
`;

type Props = { theme?: 'auto' | 'light' | 'dark'; readOnly?: boolean };

export function Demo({ theme = 'auto', readOnly = false }: Props) {
  const [markdown, setMarkdown] = useState(starter);

  return (
    <div className="demo">
      <MikeDownEditor
        className="demo__editor"
        value={markdown}
        onChange={setMarkdown}
        theme={theme}
        readOnly={readOnly}
        host={host}
        settings={settings}
        aria-label="Release notes"
      />
      <pre className="demo__value" tabIndex={0} aria-label="Markdown value">{markdown}</pre>
    </div>
  );
}
