/**
 * Side-effect import: bundle the AI UI into the importer's own bundle and
 * make it available synchronously, so the AI features never wait for a
 * chunk. The VS Code webview imports it (one script under a strict CSP).
 */

import { registerAiUi } from './ai-lite';
import * as aiUi from './ai-ui';

registerAiUi(aiUi);
