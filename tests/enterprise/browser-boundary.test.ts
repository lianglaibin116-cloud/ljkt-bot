import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { init, parse } from 'es-module-lexer';
import { describe, expect, it } from 'vitest';
import { isAbortError, changeOutlineType } from '@ljkt/generation/browser';

describe('generation browser entry', () => {
  it('retains actual pure helpers', () => {
    expect(isAbortError(new DOMException('cancelled', 'AbortError'))).toBe(true);
    expect(
      changeOutlineType(
        { id: 'one', type: 'slide', title: 'Lesson', description: '', keyPoints: [], order: 1 },
        'quiz',
      ).type,
    ).toBe('quiz');
  });

  it('has no transitive Node built-ins in its compiled local dependency graph', async () => {
    await init;
    const visited = new Set<string>();
    function visit(file: string) {
      if (visited.has(file)) return;
      visited.add(file);
      const [imports] = parse(readFileSync(file, 'utf8'));
      for (const entry of imports) {
        if (entry.d === -2) continue; // import.meta, not a dependency
        expect(entry.n, `computed import in ${file}`).toBeDefined();
        const name = entry.n!;
        expect(name, `Node-only import in ${file}`).not.toMatch(
          /^(node:|fs$|path$|url$|crypto$|child_process$)/,
        );
        if (name.startsWith('.')) visit(resolve(dirname(file), name));
        else expect(['jsonrepair']).toContain(name);
      }
    }
    visit(resolve('packages/@ljkt/generation/dist/browser.js'));
    expect(visited.size).toBeGreaterThan(5);
  });
});
