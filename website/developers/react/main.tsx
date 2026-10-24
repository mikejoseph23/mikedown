// Page glue: mounts the sample (Demo.tsx) and passes it the stage's controls.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../common/stage.js';
import '../../shared/copy.js';
import { Demo } from './Demo';

type Controls = { theme: 'auto' | 'light' | 'dark'; readOnly: boolean };

const root = createRoot(document.getElementById('demo-root')!);
const render = ({ theme, readOnly }: Controls) =>
  root.render(
    <StrictMode>
      <Demo theme={theme} readOnly={readOnly} />
    </StrictMode>,
  );

render((window as unknown as { mikedownStage: { state: Controls } }).mikedownStage.state);
document.addEventListener('stage:controls', (e) => render((e as CustomEvent<Controls>).detail));
