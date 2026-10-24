/**
 * Side-effect entry: `import '@mikedown/web-component/define'` registers
 * <mikedown-editor> (once; a second import or an earlier definition is left alone).
 */
import { defineMikeDownElement } from './index';

defineMikeDownElement();

export { MikeDownElement } from './element';
