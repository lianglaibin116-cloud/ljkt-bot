import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps internal helpers and constants out of Next route exports', () => {
  const allowed = new Set([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
    'runtime',
    'dynamic',
    'dynamicParams',
    'revalidate',
    'fetchCache',
    'preferredRegion',
    'maxDuration',
    'config',
    'generateStaticParams',
  ]);
  const violations: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (entry.name !== 'route.ts') continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const check = (name: string) => {
        if (!allowed.has(name)) violations.push(`${file}: ${name}`);
      };
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement)) {
          if (statement.isTypeOnly) continue;
          if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
            violations.push(`${file}: wildcard export`);
            continue;
          }
          statement.exportClause.elements
            .filter((element) => !element.isTypeOnly)
            .forEach((element) => check(element.name.text));
        } else if (
          ts.canHaveModifiers(statement) &&
          ts
            .getModifiers(statement)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          if (ts.isFunctionDeclaration(statement) && statement.name) check(statement.name.text);
          if (ts.isVariableStatement(statement))
            statement.declarationList.declarations.forEach((decl) =>
              check(decl.name.getText(source)),
            );
        }
      }
    }
  }
  visit(resolve('app/api'));
  expect(violations).toEqual([]);
});
