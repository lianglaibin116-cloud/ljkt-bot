import { create } from 'zustand';
import {
  countInteractiveLayoutChanges,
  normalizeInteractiveLayoutOverride,
  type InteractiveLayoutOverride,
} from '@/lib/interactive/layout-overrides';

interface InteractiveLayoutEditorState {
  readonly sceneId: string | null;
  readonly initial: readonly InteractiveLayoutOverride[];
  readonly overrides: readonly InteractiveLayoutOverride[];
  start: (sceneId: string, initial: readonly InteractiveLayoutOverride[]) => void;
  record: (sceneId: string, value: unknown) => boolean;
  cancel: (sceneId: string) => void;
  finish: (sceneId: string) => readonly InteractiveLayoutOverride[] | null;
}

export const useInteractiveLayoutEditor = create<InteractiveLayoutEditorState>((set, get) => ({
  sceneId: null,
  initial: [],
  overrides: [],

  start: (sceneId, initial) => set({ sceneId, initial: [...initial], overrides: [...initial] }),

  record: (sceneId, value) => {
    const state = get();
    const override = normalizeInteractiveLayoutOverride(value);
    if (!override || state.sceneId !== sceneId) return false;
    const overrides = new Map(state.overrides.map((item) => [item.selector, item]));
    overrides.set(override.selector, override);
    set({ overrides: [...overrides.values()] });
    return true;
  },

  cancel: (sceneId) => {
    if (get().sceneId !== sceneId) return;
    set({ sceneId: null, initial: [], overrides: [] });
  },

  finish: (sceneId) => {
    const state = get();
    if (state.sceneId !== sceneId) return null;
    set({ sceneId: null, initial: [], overrides: [] });
    return state.overrides;
  },
}));

export function handleInteractiveLayoutEditorMessage(sceneId: string, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const message = data as {
    __maicInteractive?: unknown;
    kind?: unknown;
    mode?: unknown;
    override?: unknown;
  };
  if (
    message.__maicInteractive !== true ||
    message.kind !== 'layout-change' ||
    message.mode !== 'layout'
  ) {
    return false;
  }
  return useInteractiveLayoutEditor.getState().record(sceneId, message.override);
}

export function countActiveInteractiveLayoutChanges(): number {
  const { initial, overrides } = useInteractiveLayoutEditor.getState();
  return countInteractiveLayoutChanges(initial, overrides);
}
