import { describe, expect, it } from 'bun:test';
import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';
import * as ts from 'typescript';

const APP_ROOT = new URL('../../app/', import.meta.url).pathname;
const COMPONENT_ROOT = new URL('../../src/components/', import.meta.url).pathname;

function sourceFiles(root: string): readonly string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(?:ts|tsx)$/u.test(name)) files.push(path);
    }
  };
  walk(root);
  return files;
}

function routeForFile(path: string): string | null {
  const file = basename(path);
  if (file === '_layout.tsx' || file === '_layout.ts') return null;
  let route = `/${relative(APP_ROOT, path)}`
    .replaceAll('\\', '/')
    .replace(/\.(?:ts|tsx)$/u, '')
    .replace(/\/index$/u, '');
  if (route === '') route = '/';
  return route;
}

function literalText(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function navigationTargets(path: string): readonly string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const targets: string[] = [];
  const record = (value: string | null): void => {
    if (!value || !value.startsWith('/')) return;
    targets.push(value.split(/[?#]/u, 1)[0] ?? value);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const isRouterCall =
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'router' &&
        ['push', 'replace', 'navigate'].includes(expression.name.text);
      const isSafeBack = ts.isIdentifier(expression) && expression.text === 'safeBack';
      if (isRouterCall || isSafeBack) {
        const first = node.arguments[0];
        record(literalText(first));
        if (first && ts.isObjectLiteralExpression(first)) {
          for (const property of first.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === 'pathname'
            ) {
              record(literalText(property.initializer));
            }
          }
        }
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'href') {
      if (node.initializer && ts.isStringLiteral(node.initializer)) record(node.initializer.text);
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'pathname'
    ) {
      record(literalText(node.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return targets;
}

function jsxAttribute(
  attributes: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function isNoopHandler(attribute: ts.JsxAttribute | undefined): boolean {
  if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer)) return false;
  const expression = attribute.initializer.expression;
  if (!expression || !ts.isArrowFunction(expression)) return false;
  if (ts.isIdentifier(expression.body)) return expression.body.text === 'undefined';
  if (!ts.isBlock(expression.body)) return false;
  if (expression.body.statements.length === 0) return true;
  if (expression.body.statements.length !== 1) return false;
  const statement = expression.body.statements[0];
  return statement !== undefined &&
    ts.isExpressionStatement(statement) &&
    ts.isIdentifier(statement.expression) &&
    statement.expression.text === 'undefined';
}

describe('route and enabled-action integrity', () => {
  it('keeps every literal in-app navigation target backed by a route file', () => {
    const appFiles = sourceFiles(APP_ROOT);
    const routes = new Set(appFiles.map(routeForFile).filter((route): route is string => route !== null));
    const allFiles = [...appFiles, ...sourceFiles(COMPONENT_ROOT)];
    const missing: string[] = [];

    for (const path of allFiles) {
      for (const target of navigationTargets(path)) {
        if (!routes.has(target)) missing.push(`${relative(APP_ROOT, path)} -> ${target}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('requires button-like JSX to have an action or an explicit disabled state', () => {
    const files = [...sourceFiles(APP_ROOT), ...sourceFiles(COMPONENT_ROOT)];
    const violations: string[] = [];
    const actionTags = new Set([
      'Button',
      'Pressable',
      'PressableScale',
      'ThemedButton',
      'TouchableHighlight',
      'TouchableOpacity',
    ]);

    for (const path of files) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source);
          const role = jsxAttribute(node.attributes, 'accessibilityRole');
          const isAccessibleButton =
            role?.initializer !== undefined &&
            ts.isStringLiteral(role.initializer) &&
            role.initializer.text === 'button';
          if (actionTags.has(tag) || isAccessibleButton) {
            const onPress = jsxAttribute(node.attributes, 'onPress');
            const disabled = jsxAttribute(node.attributes, 'disabled');
            if (!onPress && !disabled) {
              violations.push(`${relative(APP_ROOT, path)}:${source.getLineAndCharacterOfPosition(node.pos).line + 1} <${tag}>`);
            } else if (isAccessibleButton && isNoopHandler(onPress)) {
              violations.push(`${relative(APP_ROOT, path)}:${source.getLineAndCharacterOfPosition(node.pos).line + 1} <${tag}> no-op`);
            }
          }
          if (tag === 'Switch') {
            const onValueChange = jsxAttribute(node.attributes, 'onValueChange');
            const disabled = jsxAttribute(node.attributes, 'disabled');
            if (!onValueChange && !disabled) {
              violations.push(`${relative(APP_ROOT, path)}:${source.getLineAndCharacterOfPosition(node.pos).line + 1} <Switch>`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(violations).toEqual([]);
  });
});
