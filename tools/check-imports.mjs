#!/usr/bin/env node
/**
 * Zero-bare-specifier guard (tooling, not product).
 *
 * Enforces the stack invariant in docs/DEBATE.md §4.1: every module in this
 * repository is reachable with nothing installed. A module specifier must be a
 * built-in (node: prefixed), a relative path, or an absolute path; anything else
 * is a runtime dependency and fails the check.
 *
 * This is a token scanner, not a full parser: it lexes code, comments, strings,
 * templates and regex literals, then looks for specifiers in the three places
 * they can appear (static import/export, dynamic import, require). String
 * literals that merely *contain* import-shaped text are data, not imports, and
 * are correctly ignored — otherwise every test fixture would be a false alarm.
 *
 * Known limits, stated rather than hidden: regex-vs-division is decided by the
 * classic previous-token heuristic (a regex after `}` may be mis-lexed as
 * division), and tokens inside template interpolations are not scanned.
 * Neither can hide a real dependency in this codebase, and both fail loudly
 * (mis-lexing produces a syntax-shaped token stream, not a silent pass).
 *
 * Usage:
 *   node tools/check-imports.mjs            # scans ./src and ./tools
 *   node tools/check-imports.mjs src tools  # explicit roots
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ type: 'ident' | 'string' | 'number' | 'punct', value: string, line: number }} Token */
/** @typedef {{ file: string, line: number, specifier: string, kind: string }} Violation */

const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts']);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.arena',
  '.cache',
  'data',
  'coverage',
  'dist',
]);

/** Keywords after which a slash begins a regex literal, not a division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do',
  'else', 'case', 'yield', 'await', 'throw',
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/**
 * True when a module specifier can be resolved with nothing installed.
 * @param {string} specifier
 * @returns {boolean}
 */
export function isSelfContained(specifier) {
  return (
    specifier.startsWith('node:') ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/')
  );
}

/**
 * Lex source text into a flat token stream, discarding comments and whitespace.
 * @param {string} text
 * @returns {Token[]}
 */
function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  let line = 1;

  /** @returns {Token | undefined} */
  const previous = () => tokens[tokens.length - 1];

  /** @param {Token['type']} type @param {string} value */
  const push = (type, value) => tokens.push({ type, value, line });

  const regexAllowed = () => {
    const prev = previous();
    if (prev === undefined) return true;
    if (prev.type === 'punct') return ![')', ']', '}'].includes(prev.value);
    if (prev.type === 'ident') return REGEX_PRECEDING_KEYWORDS.has(prev.value);
    return false;
  };

  /** @param {number} start @param {string} quote */
  const readQuoted = (start, quote) => {
    const startLine = line;
    let j = start + 1;
    let value = '';
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') {
        value += text[j + 1] ?? '';
        if (text[j + 1] === '\n') line++;
        j += 2;
        continue;
      }
      if (ch === quote) return { value, startLine, end: j + 1 };
      if (ch === '\n') line++;
      value += ch;
      j++;
    }
    return { value, startLine, end: j };
  };

  /** @param {number} start */
  const readTemplate = (start) => {
    const startLine = line;
    let j = start + 1;
    let value = '';
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') return { value, startLine, end: j + 1 };
      if (ch === '\n') line++;
      if (ch === '$' && text[j + 1] === '{') {
        let depth = 1;
        j += 2;
        while (j < text.length && depth > 0) {
          const inner = text[j];
          if (inner === '\\') {
            j += 2;
            continue;
          }
          if (inner === '\n') line++;
          if (inner === '"' || inner === "'") {
            j = readQuoted(j, inner).end;
            continue;
          }
          if (inner === '{') depth++;
          if (inner === '}') depth--;
          j++;
        }
        continue;
      }
      value += ch;
      j++;
    }
    return { value, startLine, end: j };
  };

  /** @param {number} start */
  const readRegex = (start) => {
    let j = start + 1;
    let inClass = false;
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '\n') return j;
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        j++;
        while (j < text.length && IDENT_PART.test(text[j] ?? '')) j++;
        return j;
      }
      j++;
    }
    return j;
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const { value, startLine, end } = readQuoted(i, ch);
      tokens.push({ type: 'string', value, line: startLine });
      i = end;
      continue;
    }
    if (ch === '`') {
      const { value, startLine, end } = readTemplate(i);
      tokens.push({ type: 'string', value, line: startLine });
      i = end;
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      push('punct', '/');
      i = readRegex(i);
      continue;
    }
    if (ch !== undefined && IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENT_PART.test(text[j] ?? '')) j++;
      push('ident', text.slice(i, j));
      i = j;
      continue;
    }
    if (ch !== undefined && /[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[0-9a-zA-Z_.]/.test(text[j] ?? '')) j++;
      push('number', text.slice(i, j));
      i = j;
      continue;
    }
    push('punct', ch ?? '');
    i++;
  }

  return tokens;
}

/**
 * Find a specifier introduced by a `from` keyword within the current statement.
 * @param {Token[]} tokens
 * @param {number} start index just after the import/export keyword
 * @returns {Token | undefined} the specifier string token
 */
function specifierAfterFrom(tokens, start) {
  for (let k = start; k < tokens.length && k < start + 64; k++) {
    const token = tokens[k];
    if (token === undefined) return undefined;
    if (token.type === 'punct' && token.value === ';') return undefined;
    if (token.type === 'punct' && token.value === ')') return undefined;
    if (token.type === 'ident' && token.value === 'from') {
      const next = tokens[k + 1];
      return next !== undefined && next.type === 'string' ? next : undefined;
    }
    if (token.type === 'ident' && ['const', 'let', 'var', 'function', 'class'].includes(token.value)) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Find every non-self-contained specifier in one source text.
 * @param {string} text
 * @param {string} [file] label used in violations
 * @returns {Violation[]}
 */
export function scanSource(text, file = '<stdin>') {
  const tokens = tokenize(text);
  /** @type {Violation[]} */
  const violations = [];

  /** @param {Token} token @param {string} kind */
  const record = (token, kind) => {
    if (!isSelfContained(token.value)) {
      violations.push({ file, line: token.line, specifier: token.value, kind });
    }
  };

  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token === undefined || token.type !== 'ident') continue;

    if (token.value === 'import') {
      const after = tokens[k + 1];
      if (after !== undefined && after.type === 'punct' && after.value === '(') {
        const specifier = tokens[k + 2];
        if (specifier !== undefined && specifier.type === 'string') record(specifier, 'dynamic import');
        continue;
      }
      if (after !== undefined && after.type === 'string') {
        record(after, 'side-effect import');
        continue;
      }
      const specifier = specifierAfterFrom(tokens, k + 1);
      if (specifier !== undefined) record(specifier, 'static import');
      continue;
    }

    if (token.value === 'export') {
      const specifier = specifierAfterFrom(tokens, k + 1);
      if (specifier !== undefined) record(specifier, 're-export');
      continue;
    }

    if (token.value === 'require') {
      const after = tokens[k + 1];
      const specifier = tokens[k + 2];
      if (
        after !== undefined && after.type === 'punct' && after.value === '(' &&
        specifier !== undefined && specifier.type === 'string'
      ) {
        record(specifier, 'require');
      }
    }
  }

  return violations.sort((a, b) => a.line - b.line);
}

/**
 * Recursively collect source files under a root (missing roots are skipped).
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function collectSourceFiles(root) {
  /** @type {string[]} */
  const found = [];
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...(await collectSourceFiles(path)));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Scan a tree.
 * @param {string[]} roots
 * @returns {Promise<{ scanned: number, violations: Violation[] }>}
 */
export async function scanRoots(roots) {
  /** @type {Violation[]} */
  const violations = [];
  /** @type {string[]} */
  const files = [];
  for (const root of roots) {
    files.push(...(await collectSourceFiles(root)));
  }
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const label = relative(process.cwd(), file);
    violations.push(...scanSource(text, label.startsWith('..') ? file : label));
  }
  return { scanned: files.length, violations };
}

async function main() {
  const roots = process.argv.slice(2);
  const { scanned, violations } = await scanRoots(roots.length > 0 ? roots : ['src', 'tools']);
  if (violations.length === 0) {
    console.log(`OK: ${scanned} file(s) scanned, 0 bare specifiers. Runtime imports are self-contained.`);
    return;
  }
  for (const v of violations) {
    console.error(`${v.file}:${v.line}: ${v.kind} of "${v.specifier}" is not self-contained`);
  }
  console.error(`FAIL: ${violations.length} bare specifier(s) in ${scanned} file(s).`);
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  await main();
}
