// Page glue: mounts the sample (Demo.vue) and passes it the stage's controls.
import { createApp, h, reactive } from 'vue';
import '../common/stage.js';
import '../../shared/copy.js';
import Demo from './Demo.vue';

const controls = reactive({ ...window.mikedownStage.state });
document.addEventListener('stage:controls', (e) => Object.assign(controls, e.detail));

createApp({ render: () => h(Demo, { theme: controls.theme, readOnly: controls.readOnly }) }).mount('#demo-root');
