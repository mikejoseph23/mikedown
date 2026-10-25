import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type PropType,
  type Ref,
  type ShallowRef,
} from 'vue';
import { bindMikeDownValue } from '@mikedown/core';
import type {
  BindingTheme,
  MikeDownBinding,
  MikeDownEditorHandle,
  MikeDownFeatures,
  MikeDownHost,
  MikeDownSettings,
} from '@mikedown/core';

export interface MikeDownEditorExposed {
  /** The underlying editor handle; null until mounted. */
  handle: MikeDownEditorHandle | null;
}

export const MikeDownEditor = defineComponent({
  name: 'MikeDownEditor',
  props: {
    modelValue: { type: String, default: '' },
    theme: { type: String as PropType<BindingTheme>, default: 'auto' },
    readOnly: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    /** Read once at mount. */
    placeholder: { type: String, default: undefined },
    /** Read once at mount. */
    features: { type: Object as PropType<Partial<MikeDownFeatures>>, default: undefined },
    /** Initial settings; later changes are pushed with `updateSettings`. */
    settings: { type: Object as PropType<Partial<MikeDownSettings>>, default: undefined },
    /** Optional host methods (image upload, wikilinks, ...). Read once at mount. `host.ai` goes to the core untouched. */
    host: { type: Object as PropType<Partial<MikeDownHost>>, default: undefined },
    /** CSS selector for `theme="auto"`: dark when an ancestor matches. */
    darkSelector: { type: String, default: undefined },
    /** `id` of the editable surface (a `<label for>` is looked up for its name). */
    id: { type: String, default: undefined },
    ariaLabel: { type: String, default: undefined },
    ariaLabelledby: { type: String, default: undefined },
  },
  emits: {
    'update:modelValue': (_value: string) => true,
    ready: (_handle: MikeDownEditorHandle) => true,
  },
  setup(props, { emit, expose }) {
    const container: Ref<HTMLElement | null> = ref(null);
    const handle: ShallowRef<MikeDownEditorHandle | null> = shallowRef(null);
    let binding: MikeDownBinding | null = null;

    expose({ handle });

    onMounted(() => {
      if (!container.value) {return;}
      const b = bindMikeDownValue(container.value, {
        initialValue: props.modelValue,
        theme: props.theme,
        readOnly: props.readOnly,
        disabled: props.disabled,
        placeholder: props.placeholder,
        features: props.features,
        settings: props.settings,
        host: props.host,
        darkSelector: props.darkSelector,
        id: props.id,
        ariaLabel: props.ariaLabel,
        ariaLabelledBy: props.ariaLabelledby,
        onValue: (markdown) => emit('update:modelValue', markdown),
      });
      binding = b;
      handle.value = b.handle;
      b.handle.on('ready', () => emit('ready', b.handle));
    });

    onBeforeUnmount(() => {
      binding?.destroy();
      binding = null;
      handle.value = null;
    });

    watch(
      () => props.modelValue,
      (value) => binding?.setValue(value),
    );
    watch(
      () => props.theme,
      (value) => binding?.setTheme(value),
    );
    watch(
      () => props.readOnly,
      (value) => binding?.setReadOnly(value),
    );
    watch(
      () => props.disabled,
      (value) => binding?.setDisabled(value),
    );
    watch(
      () => props.settings,
      (value) => {
        if (value) {binding?.handle.updateSettings(value);}
      },
      { deep: true },
    );

    return () => h('div', { ref: container });
  },
});
