import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The binding itself is tested in core; here it is a spy so the wrapper's
// wiring (props in, events out, lifecycle) is what is under test.
const h_ = vi.hoisted(() => ({ calls: [] as any[], bindings: [] as any[] }));

vi.mock('@mikedown/core', () => ({
  bindMikeDownValue: (el: HTMLElement, options: any) => {
    const readyFns: Array<() => void> = [];
    const handle = {
      updateSettings: vi.fn(),
      on: vi.fn((ev: string, fn: () => void) => {
        if (ev === 'ready') {readyFns.push(fn);}
        return () => undefined;
      }),
    };
    const binding = {
      handle,
      options,
      el,
      readyFns,
      setValue: vi.fn(),
      setTheme: vi.fn(),
      setReadOnly: vi.fn(),
      setDisabled: vi.fn(),
      destroy: vi.fn(),
    };
    h_.bindings.push(binding);
    return binding;
  },
}));

import MikeDown, { MikeDownEditor } from '../src/index';

const last = () => h_.bindings[h_.bindings.length - 1];

beforeEach(() => {
  h_.bindings.length = 0;
});

describe('MikeDownEditor', () => {
  it('creates the binding on mount with the model value and forwards props', () => {
    const features = { toolbar: false } as any;
    mount(MikeDownEditor, {
      props: {
        modelValue: '# hi',
        theme: 'dark',
        readOnly: true,
        placeholder: 'Write',
        features,
        darkSelector: '.dark',
        id: 'doc',
        ariaLabel: 'Notes',
        ariaLabelledby: 'lbl',
      },
    });
    expect(h_.bindings).toHaveLength(1);
    expect(last().el).toBeInstanceOf(HTMLElement);
    expect(last().options).toMatchObject({
      initialValue: '# hi',
      theme: 'dark',
      readOnly: true,
      placeholder: 'Write',
      features,
      darkSelector: '.dark',
      id: 'doc',
      ariaLabel: 'Notes',
      ariaLabelledBy: 'lbl',
    });
  });

  it('does not put id or aria attributes on the wrapper element', () => {
    const w = mount(MikeDownEditor, { props: { id: 'doc', ariaLabel: 'Notes' } });
    expect(w.element.getAttribute('id')).toBeNull();
    expect(w.element.getAttribute('aria-label')).toBeNull();
  });

  it('emits update:modelValue when the binding reports a value', () => {
    const w = mount(MikeDownEditor, { props: { modelValue: '' } });
    last().options.onValue('typed');
    expect(w.emitted('update:modelValue')).toEqual([['typed']]);
  });

  it('pushes an external modelValue change into the binding', async () => {
    const w = mount(MikeDownEditor, { props: { modelValue: 'a' } });
    await w.setProps({ modelValue: 'b' });
    expect(last().setValue).toHaveBeenCalledWith('b');
  });

  it('works with v-model in both directions', async () => {
    const text = ref('start');
    const Parent = defineComponent({
      setup: () => () =>
        h(MikeDownEditor, {
          modelValue: text.value,
          'onUpdate:modelValue': (v: string) => (text.value = v),
        }),
    });
    mount(Parent);
    expect(last().options.initialValue).toBe('start');
    last().options.onValue('from editor');
    expect(text.value).toBe('from editor');
    text.value = 'from parent';
    await nextTick();
    expect(last().setValue).toHaveBeenCalledWith('from parent');
  });

  it('applies theme, readOnly and disabled prop changes', async () => {
    const w = mount(MikeDownEditor, { props: { theme: 'light' } });
    await w.setProps({ theme: 'dark', readOnly: true, disabled: true });
    expect(last().setTheme).toHaveBeenCalledWith('dark');
    expect(last().setReadOnly).toHaveBeenCalledWith(true);
    expect(last().setDisabled).toHaveBeenCalledWith(true);
  });

  it('pushes settings changes to the handle', async () => {
    const w = mount(MikeDownEditor, { props: { settings: { fontSize: 14 } as any } });
    await w.setProps({ settings: { fontSize: 18 } as any });
    expect(last().handle.updateSettings).toHaveBeenCalledWith({ fontSize: 18 });
  });

  it('emits ready with the handle', () => {
    const w = mount(MikeDownEditor);
    last().readyFns.forEach((fn: () => void) => fn());
    expect(w.emitted('ready')).toEqual([[last().handle]]);
  });

  it('exposes the handle', async () => {
    const w = mount(MikeDownEditor);
    await nextTick();
    expect((w.vm as any).handle).toBe(last().handle);
  });

  it('destroys the binding on unmount and clears the handle', () => {
    const w = mount(MikeDownEditor);
    const b = last();
    w.unmount();
    expect(b.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('plugin', () => {
  it('registers MikeDownEditor globally', () => {
    const app = createApp({});
    app.use(MikeDown);
    expect(app.component('MikeDownEditor')).toBe(MikeDownEditor);
  });
});

describe('MikeDownEditor host.ai', () => {
  it('passes the host, and the ai group inside it, to the binding as is', () => {
    const ai = { complete: vi.fn() };
    const host = { ai, onStats: vi.fn() };
    mount(MikeDownEditor, { props: { modelValue: '', host } });
    // Vue wraps props in reactive proxies, so compare what is inside.
    expect(last().options.host.ai.complete).toBe(ai.complete);
    expect(Object.keys(last().options.host).sort()).toEqual(['ai', 'onStats']);
  });
});
