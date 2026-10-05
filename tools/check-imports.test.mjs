import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSelfContained, scanSource, scanRoots } from './check-imports.mjs';

const run = promisify(execFile);

test('accepts built-in, relative and absolute specifiers', () => {
  assert.equal(isSelfContained('node:sqlite'), true);
  assert.equal(isSelfContained('./lib/queue.mjs'), true);
  assert.equal(isSelfContained('../src/app.mjs'), true);
  assert.equal(isSelfContained('/abs/path.mjs'), true);
});

test('rejects bare specifiers', () => {
  assert.equal(isSelfContained('express'), false);
  assert.equal(isSelfContained('@scope/pkg/sub'), false);
  assert.equal(isSelfContained('left-pad'), false);
});

test('detects static, dynamic and require forms with line numbers', () => {
  const source = [
    'import { a } from "node:fs";',
    'import b from "express";',
    'export { c } from "../src/c.mjs";',
    'export * from "lodash";',
    'const d = await import("some-pkg");',
    'const e = require("another-pkg");',
  ].join('\n');
  const found = scanSource(source, 'fixture.mjs');
  assert.deepEqual(
    found.map((v) => [v.line, v.specifier, v.kind]),
    [
      [2, 'express', 'static import'],
      [4, 'lodash', 're-export'],
      [5, 'some-pkg', 'dynamic import'],
      [6, 'another-pkg', 'require'],
    ],
  );
});

test('detects a multi-line static import and a side-effect import without from', () => {
  const multiLine = 'import {\n  thing,\n  other,\n} from "big-lib";\n';
  assert.deepEqual(scanSource(multiLine).map((v) => v.specifier), ['big-lib']);

  const sideEffect = 'import "./setup.mjs";\nimport "polyfill-pkg";\n';
  assert.deepEqual(scanSource(sideEffect).map((v) => v.specifier), ['polyfill-pkg']);
});

test('ignores import-shaped text in strings, comments and templates', () => {
  const source = [
    '// import fake from "in-a-line-comment";',
    '/* import fake from "in-a-block-comment"; */',
    'const fixture = \'import x from "in-a-string";\';',
    'const other = `import y from "in-a-template";`;',
    'const re = /import\\s+z\\s+from\\s+["\\x27]\\w+["\\x27]/;',
    'const division = 10 / 2;',
    'console.log(fixture, other, re, division);',
  ].join('\n');
  assert.deepEqual(scanSource(source, 'fixture.mjs'), []);
});

test('does not treat import.meta or a dynamic import miss as a specifier', () => {
  const source = 'const url = import.meta.url;\nconst load = (specifier) => import(specifier);\n';
  assert.deepEqual(scanSource(source).map((v) => v.specifier), []);
});

test('this repository is self-contained everywhere', async () => {
  const { scanned, violations } = await scanRoots(['src', 'tools']);
  assert.equal(scanned >= 2, true, `expected to scan the tools, scanned ${scanned}`);
  assert.deepEqual(violations, []);
});

test('cli reports OK on this repository and fails loudly on a violating tree', async () => {
  const clean = await run(process.execPath, ['tools/check-imports.mjs', 'tools']);
  assert.match(clean.stdout, /^OK: \d+ file\(s\) scanned, 0 bare specifiers\./);

  const dir = await mkdtemp(join(tmpdir(), 'bare-spec-'));
  await writeFile(join(dir, 'bad.mjs'), 'import express from "express";\nrequire("dotenv").config();\n');

  await assert.rejects(run(process.execPath, ['tools/check-imports.mjs', dir]), (error) => {
    const failure = /** @type {{ code?: number, stderr?: string }} */ (error);
    assert.equal(failure.code, 1);
    assert.match(String(failure.stderr), /bad\.mjs:1: static import of "express" is not self-contained/);
    assert.match(String(failure.stderr), /bad\.mjs:2: require of "dotenv" is not self-contained/);
    assert.match(String(failure.stderr), /FAIL: 2 bare specifier\(s\)/);
    return true;
  });
});
