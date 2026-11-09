import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TeacherDemoModeButton } from '@/components/generation/teacher-demo-mode-button';

function renderButton(
  pressed: boolean,
  extraProps: Partial<ComponentProps<typeof TeacherDemoModeButton>> = {},
) {
  return renderToStaticMarkup(
    createElement(TeacherDemoModeButton, {
      pressed,
      label: '教师演示',
      onPressedChange: () => undefined,
      ...extraProps,
    }),
  );
}

describe('TeacherDemoModeButton markup contract', () => {
  it('shows a clear selected state', () => {
    const html = renderButton(true);

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-testid="teacher-demo-mode"');
    expect(html).toContain('border-violet-400 bg-violet-100 text-violet-900');
    expect(html).toContain('lucide-check');
  });

  it('shows the presentation action while unselected', () => {
    const html = renderButton(false);

    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('border-violet-500/70 bg-transparent text-violet-700');
    expect(html).toContain('lucide-presentation');
  });

  it('forwards tooltip attributes and classes', () => {
    const html = renderButton(false, {
      'aria-describedby': 'teacher-demo-hint',
      className: 'tooltip-trigger-class',
    });

    expect(html).toContain('aria-describedby="teacher-demo-hint"');
    expect(html).toContain('tooltip-trigger-class');
  });
});
