import { beforeEach, describe, expect, it } from 'vitest';
import {
  handleInteractiveLayoutEditorMessage,
  useInteractiveLayoutEditor,
} from '@/lib/store/interactive-layout-editor';

beforeEach(() => {
  useInteractiveLayoutEditor.setState({ sceneId: null, initial: [], overrides: [] });
});

describe('interactive layout edit messages', () => {
  it('records a validated drag only for the scene currently being edited', () => {
    useInteractiveLayoutEditor.getState().start('scene-1', [{ selector: '#card', x: 0, y: 0 }]);
    const message = {
      __maicInteractive: true,
      kind: 'layout-change',
      mode: 'layout',
      override: { selector: '#card', x: 32, y: -16 },
    };

    expect(handleInteractiveLayoutEditorMessage('scene-2', message)).toBe(false);
    expect(handleInteractiveLayoutEditorMessage('scene-1', message)).toBe(true);
    expect(useInteractiveLayoutEditor.getState().overrides).toEqual([
      { selector: '#card', x: 32, y: -16 },
    ]);
  });

  it('rejects invalid selectors, missing mode markers, and out-of-range positions', () => {
    useInteractiveLayoutEditor.getState().start('scene-1', []);
    expect(
      handleInteractiveLayoutEditorMessage('scene-1', {
        __maicInteractive: true,
        kind: 'layout-change',
        mode: 'layout',
        override: { selector: '#card;body', x: 32, y: 0 },
      }),
    ).toBe(false);
    expect(
      handleInteractiveLayoutEditorMessage('scene-1', {
        __maicInteractive: true,
        kind: 'layout-change',
        override: { selector: '#card', x: 32, y: 0 },
      }),
    ).toBe(false);
    expect(useInteractiveLayoutEditor.getState().overrides).toEqual([]);
  });
});
