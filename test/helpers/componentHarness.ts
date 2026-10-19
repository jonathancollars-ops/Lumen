import assert from 'node:assert/strict';
import React from 'react';

// Run real component callbacks/effects, following agenda_edit_regressions.test.ts.
// This exercises persistence and state transitions, not native rendering.
export function harness(component: any, props: any, context?: any) {
  const slots: any[] = [];
  const cleanups = new Map<number, () => void>();
  let cursor = 0;
  let effects: (() => void)[] = [];
  let dirty = false;
  const dispatcher = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: any) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) dirty = true;
        slots[index] = value;
      }];
    },
    useMemo(factory: any) { return factory(); },
    useCallback(fn: any) { return fn; },
    useContext() { return context; },
    useRef(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect: any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) {
        effects.push(() => {
          cleanups.get(index)?.();
          const cleanup = effect();
          if (typeof cleanup === 'function') cleanups.set(index, cleanup);
          else cleanups.delete(index);
        });
      }
      slots[index] = deps;
    },
  };
  const render = (nextProps = props) => {
    props = nextProps;
    cursor = 0;
    effects = [];
    dirty = false;
    const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const previous = internals.H;
    internals.H = dispatcher;
    try { return component(props); } finally { internals.H = previous; }
  };
  return {
    render,
    setContext(next: any) { context = next; },
    setProps(next: any) { props = next; },
    async settle() {
      for (let i = 0; i < 15; i++) {
        const tree = render();
        effects.forEach(effect => effect());
        await new Promise(resolve => setImmediate(resolve));
        if (!dirty) return tree;
      }
      throw new Error('Component did not settle');
    },
    unmount() { cleanups.forEach(cleanup => cleanup()); },
  };
}

export function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
export function text(tree: any, value: string) {
  return find(tree, node => node.props?.children === value);
}
export function button(tree: any, label: string) {
  const result = find(tree, node => typeof node.props?.onPress === 'function' && text(node, label));
  assert.ok(result, `Button exists: ${label}`);
  return result.props.onPress;
}
