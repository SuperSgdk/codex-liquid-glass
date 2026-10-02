// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_FILES = new Set(['.gitignore', '.gitattributes', '.editorconfig', '.env.example',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
  'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'CODE_OF_CONDUCT.md', 'AGENTS.md']);
const EXTENSIONS = {
  src: new Set(['.ts', '.mjs', '.js', '.json', '.svg', '.md', '.txt']),
  scripts: new Set(['.mjs', '.js', '.ps1']),
  tests: new Set(['.mjs', '.js']),
  web: new Set(['.html', '.css', '.js', '.svg']),
  docs: new Set(['.md', '.json', '.txt']),
  '.github': new Set(['.yml', '.yaml', '.md']),
};
const PRIVATE_DIRECTORIES = /^(?:private|local|secrets|credentials|screenshots|recordings|backups|node_modules|dist|validation|\.git|\.cache|\.codex|\.dsh)$/i;
const KEY_EXTENSION = /\.(?:pem|key|p12|pfx|p8|jks|keystore)$/i;
const NOREPLY = /^(?:\d+\+)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\[bot\])?@users\.noreply\.github\.com$/i;
const SECRET_PATTERNS = [
  ['private_key', /-----BEGIN (?:[A-Z0-9]+ )*(?:PRIVATE KEY|PRIVATE KEY BLOCK)-----/g],
  ['openai_token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['credential_url', /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^/\s:@]+:[^@\s/]+@/gi],
  ['absolute_user_directory', /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+)/g],
];
const SECRET_LITERAL = /["']?\b(?:[a-z0-9_]+_)?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token)\b["']?\s*[:=]\s*(["'])([^"'\r\n]{8,})\1/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BYTES = 10 * 1024 * 1024;

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'invalid_png';
  let offset = 8; let imageData = false; let metadata = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return 'invalid_png';
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return 'invalid_png';
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) return 'invalid_png';
    if (type === 'IDAT') imageData = true;
    if (['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(type)) metadata = true;
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length || !imageData) return 'invalid_png';
      return metadata ? 'image_contains_hidden_metadata' : null;
    }
    offset = end;
  }
  return 'invalid_png';
}

/** Return a reason rather than echoing any filename contents in an error. */
export function classifyPublicPath(relativePath, approvedImages = new Set()) {
  if (typeof relativePath !== 'string' || !relativePath || /[\\\x00-\x1f\x7f]/.test(relativePath) ||
      path.posix.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) ||
      relativePath.split('/').some(segment => !segment || segment === '.' || segment === '..')) return 'unsafe_path';
  const segments = relativePath.split('/');
  const basename = segments.at(-1);
  if (segments.slice(0, -1).some(segment => PRIVATE_DIRECTORIES.test(segment)) || KEY_EXTENSION.test(basename) ||
      (basename.startsWith('.env') && relativePath !== '.env.example')) return 'private_path';
  if (segments.length === 1) return ROOT_FILES.has(relativePath) || basename.endsWith('.cmd') ? null : 'file_not_allowed';
  if (relativePath === '.github/CODEOWNERS') return null;
  if (/^docs\/assets\/[^/]+\.png$/.test(relativePath)) return approvedImages.has(relativePath) ? null : 'image_requires_review';
  return EXTENSIONS[segments[0]]?.has(path.posix.extname(basename)) ? null : 'file_not_allowed';
}

function isPlaceholder(value) {
  return /^(?:example|sample|dummy|placeholder|change[-_]?me|replace[-_]?me|your[-_](?:api[-_]?)?(?:key|token|password|secret)(?:[-_]here)?|<[A-Z0-9_-]+>)$/i.test(value) || value.includes('${');
}

/** Findings contain a category and a line number, never the matched value. */
export function auditText(text, relativePath) {
  const findings = [];
  const seen = new Set();
  const add = (kind, offset) => {
    const line = text.slice(0, offset).split('\n').length;
    const key = `${kind}:${line}`;
    if (!seen.has(key)) { seen.add(key); findings.push({ kind, line }); }
  };
  for (const [kind, expression] of SECRET_PATTERNS) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) add(kind, match.index);
  }
  SECRET_LITERAL.lastIndex = 0;
  for (const match of text.matchAll(SECRET_LITERAL)) if (!isPlaceholder(match[2])) add('credential_literal', match.index);
  EMAIL.lastIndex = 0;
  for (const match of text.matchAll(EMAIL)) {
    if (NOREPLY.test(match[0])) continue;
    if (relativePath === 'LICENSE' && /@(?:gnu|fsf)\.org$/i.test(match[0])) continue;
    add('personal_email', match.index);
  }
  return findings;
}

function git(repository, args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'buffer', shell: false,
    maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

function splitNull(buffer) { return buffer.toString('utf8').split('\0').filter(Boolean); }
function staysWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function runPublicAudit({ root = fileURLToPath(new URL('../', import.meta.url)), modes = ['worktree'], allowImages = [] } = {}) {
  if (!modes.length || modes.some(mode => !['worktree', 'staged', 'history'].includes(mode))) throw new Error('Invalid audit modes.');
  const approvedImages = new Set(allowImages);
  for (const image of approvedImages) if (!/^docs\/assets\/[^/]+\.png$/.test(image) || classifyPublicPath(image, approvedImages)) throw new Error('Invalid reviewed image path.');
  const repository = git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const realRoot = realpathSync(repository);
  const result = { ok: true, modes: [...new Set(modes)], filesScanned: 0, commitsScanned: 0,
    annotatedTagsScanned: 0, approvedImages: [...approvedImages], findings: [],
    limits: ['Pattern scanning cannot prove absence of every kind of personal information.',
      'Approved PNG files require prior human visual review; their pixels are not searched for private text.',
      'History covers commit file trees and annotated-tag metadata reachable from local refs, excluding reflogs and unreachable objects.'] };
  const add = (scope, relativePath, kind, line = null, object = undefined) => {
    result.findings.push({ scope, path: relativePath, kind, line, ...(object ? { object } : {}) });
  };
  function scan(scope, relativePath, load, mode = '100644', object) {
    const reason = classifyPublicPath(relativePath, approvedImages);
    if (reason) { add(scope, relativePath, reason, null, object); return; }
    if (!['100644', '100755'].includes(mode)) { add(scope, relativePath, 'non_regular_git_entry', null, object); return; }
    let bytes;
    try { bytes = load(); } catch { add(scope, relativePath, 'unreadable_file', null, object); return; }
    result.filesScanned++;
    if (bytes.length > MAX_BYTES) { add(scope, relativePath, 'file_too_large', null, object); return; }
    if (relativePath.endsWith('.png')) {
      const issue = inspectPng(bytes);
      if (issue) add(scope, relativePath, issue, null, object);
      return;
    }
    let text;
    try {
      if (bytes.includes(0)) throw new Error('Binary content.');
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch { add(scope, relativePath, 'binary_or_non_utf8_file', null, object); return; }
    for (const finding of auditText(text, relativePath)) add(scope, relativePath, finding.kind, finding.line, object);
  }
  for (const mode of result.modes) {
    if (mode === 'worktree') {
      const candidates = new Set(splitNull(git(repository, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])));
      const deleted = new Set(splitNull(git(repository, ['ls-files', '--deleted', '-z'])));
      for (const relativePath of candidates) {
        if (deleted.has(relativePath)) continue;
        scan(mode, relativePath, () => {
          const fullPath = path.resolve(repository, ...relativePath.split('/'));
          if (!staysWithin(repository, fullPath)) throw new Error('Outside repository.');
          const entry = lstatSync(fullPath);
          if (!entry.isFile() || entry.isSymbolicLink() || !staysWithin(realRoot, realpathSync(fullPath))) throw new Error('Not a repository-owned regular file.');
          return readFileSync(fullPath);
        });
      }
    } else if (mode === 'staged') {
      for (const role of ['AUTHOR', 'COMMITTER']) {
        const identity = git(repository, ['var', `GIT_${role}_IDENT`]).toString('utf8');
        const email = identity.match(/<([^<>]+)> \d+ [+-]\d{4}\s*$/)?.[1];
        if (!NOREPLY.test(email || '')) add(mode, '<next-commit-identity>', `non_noreply_pending_${role.toLowerCase()}_email`);
      }
      for (const entry of splitNull(git(repository, ['ls-files', '--stage', '-z']))) {
        const tab = entry.indexOf('\t');
        if (tab < 0) throw new Error('Invalid index record.');
        const [fileMode, object, stage] = entry.slice(0, tab).split(' ');
        const relativePath = entry.slice(tab + 1);
        if (stage !== '0') { add(mode, relativePath, 'unmerged_index'); continue; }
        scan(mode, relativePath, () => git(repository, ['cat-file', 'blob', object]), fileMode);
      }
    } else {
      const commits = git(repository, ['rev-list', '--all']).toString('utf8').trim().split('\n').filter(Boolean);
      const seen = new Set();
      for (const commit of commits) {
        result.commitsScanned++;
        const metadata = git(repository, ['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', commit]).toString('utf8').split('\0');
        for (const [index, kind] of [[1, 'non_noreply_author_email'], [3, 'non_noreply_committer_email']]) {
          if (!NOREPLY.test(metadata[index] || '')) add(mode, '<commit-metadata>', kind, null, commit);
        }
        for (const finding of auditText([metadata[0], metadata[2], metadata[4]].join('\n'), '<commit-message>')) add(mode, '<commit-message>', finding.kind, finding.line, commit);
        for (const entry of splitNull(git(repository, ['ls-tree', '-r', '-z', commit]))) {
          const tab = entry.indexOf('\t');
          if (tab < 0) throw new Error('Invalid history tree record.');
          const [fileMode, , object] = entry.slice(0, tab).split(' ');
          const relativePath = entry.slice(tab + 1);
          const key = `${object}:${relativePath}`;
          if (seen.has(key)) continue;
          seen.add(key);
          scan(mode, relativePath, () => git(repository, ['cat-file', 'blob', object]), fileMode, commit);
        }
      }
      const tags = git(repository, ['for-each-ref', '--format=%(objectname) %(objecttype)', 'refs/tags']).toString('utf8').trim().split('\n').filter(Boolean);
      const tagQueue = tags.filter(tag => tag.endsWith(' tag')).map(tag => tag.split(' ')[0]);
      const seenTags = new Set();
      while (tagQueue.length) {
        const object = tagQueue.pop();
        if (seenTags.has(object)) continue;
        seenTags.add(object);
        result.annotatedTagsScanned++;
        const text = git(repository, ['cat-file', 'tag', object]).toString('utf8');
        for (const finding of auditText(text, '<annotated-tag>')) add(mode, '<annotated-tag>', finding.kind, finding.line, object);
        const nested = text.match(/^object ([a-f0-9]+)\ntype tag\n/);
        if (nested) tagQueue.push(nested[1]);
      }
    }
  }
  result.ok = result.findings.length === 0;
  return result;
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node scripts/audit-public.mjs [--worktree] [--staged] [--history] [--allow-image docs/assets/reviewed.png]\nDefault: --worktree. --staged scans the complete index. --history scans all local refs.\nOnly add --allow-image after visually checking that PNG for private information. This command reads only.\n');
    return;
  }
  const modes = []; const allowImages = [];
  for (let index = 0; index < args.length; index++) {
    if (['--worktree', '--staged', '--history'].includes(args[index])) modes.push(args[index].slice(2));
    else if (args[index] === '--allow-image' && args[index + 1]) allowImages.push(args[++index]);
    else throw new Error('Invalid arguments.');
  }
  const result = runPublicAudit({ modes: modes.length ? modes : ['worktree'], allowImages });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch {
    process.stdout.write(`${JSON.stringify({ ok: false, findings: [{ kind: 'audit_could_not_complete', line: null }], instruction: 'Check arguments and local Git readability. No file or Git state was changed.' }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
