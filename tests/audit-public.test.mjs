// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { auditText, classifyPublicPath, runPublicAudit } from '../scripts/audit-public.mjs';

const fakeToken = ['s', 'k', '-'].join('') + 'A'.repeat(32);
const privateEmail = ['owner', 'example.invalid'].join('@');
const privateDirectory = ['C:', 'Users', 'private-person', 'notes.txt'].join('\\');

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-public-audit-'));
  t.after(() => {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('codex-public-audit-')) throw new Error('Unsafe fixture cleanup target.');
    rmSync(resolved, { recursive: true, force: true });
  });
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'missing-global-config'),
    GIT_AUTHOR_NAME: 'PublicAudit', GIT_COMMITTER_NAME: 'PublicAudit',
    GIT_AUTHOR_EMAIL: '123+audit@users.noreply.github.com', GIT_COMMITTER_EMAIL: '123+audit@users.noreply.github.com' };
  const git = (args, options = {}) => execFileSync('git', ['-c', `core.hooksPath=${path.join(root, 'empty-hooks')}`,
    '-c', 'commit.gpgsign=false', ...args], { cwd: root, env: environment, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'PublicAudit']);
  git(['config', 'user.email', '123+audit@users.noreply.github.com']);
  const write = (relativePath, text) => { const destination = path.join(root, relativePath); mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, text); };
  const commit = (message = 'fixture snapshot') => { git(['add', '--all']); git(['commit', '--no-gpg-sign', '-m', message]); };
  return { root, git, write, commit, environment };
}

test('public audit allows source, JSON reports and ordinary license contacts without echoing private values', () => {
  assert.equal(classifyPublicPath('src/core/example.ts'), null);
  assert.equal(classifyPublicPath('docs/report.json'), null);
  const licenseContact = ['webmasters', 'gnu.org'].join('@');
  assert.deepEqual(auditText(`License: https://www.gnu.org/licenses/\nContact: ${licenseContact}`, 'LICENSE'), []);
  assert.deepEqual(auditText('Author: 123+audit@users.noreply.github.com', 'NOTICE'), []);
  const text = ['safe', fakeToken, ['-----BEGIN ', 'PRIVATE KEY-----'].join(''), privateDirectory, privateEmail].join('\n');
  const findings = auditText(text, 'docs/report.md');
  assert.deepEqual(findings.map(({ kind }) => kind).sort(), ['absolute_user_directory', 'openai_token', 'personal_email', 'private_key']);
  assert.equal(findings.find(({ kind }) => kind === 'openai_token').line, 2);
  const output = JSON.stringify(findings);
  for (const value of [fakeToken, privateDirectory, privateEmail]) assert.equal(output.includes(value), false);
});

test('public audit refuses private directories, key files, unknown artifacts and traversal paths', () => {
  for (const filename of ['private/report.json', 'docs/local/report.md', 'src/secrets/key.ts', 'credentials.json', '.env.local', 'docs/example.pfx']) {
    assert.notEqual(classifyPublicPath(filename), null);
  }
  for (const filename of ['../README.md', '/tmp/README.md', 'src/../../README.md', ['C:', 'Users', 'person', 'README.md'].join('/'), 'src\\example.ts']) {
    assert.equal(classifyPublicPath(filename), 'unsafe_path');
  }
  assert.equal(classifyPublicPath('docs/assets/reviewed.png'), 'image_requires_review');
  assert.equal(classifyPublicPath('docs/assets/reviewed.png', new Set(['docs/assets/reviewed.png'])), null);
  assert.notEqual(classifyPublicPath('docs/screenshots/private.png', new Set(['docs/screenshots/private.png'])), null);
});

test('staged audit reads the complete index snapshot independently of later working changes', t => {
  const env = fixture(t);
  env.write('README.md', 'Public project\n');
  env.write('src/example.ts', 'export const value = 1;\n');
  env.commit();
  env.write('src/example.ts', fakeToken);
  const before = [env.git(['status', '--porcelain=v1']), env.git(['rev-parse', 'HEAD'])];
  assert.equal(runPublicAudit({ root: env.root, modes: ['staged'] }).ok, true);
  assert.equal(runPublicAudit({ root: env.root, modes: ['worktree'] }).ok, false);
  assert.deepEqual([env.git(['status', '--porcelain=v1']), env.git(['rev-parse', 'HEAD'])], before, 'auditing must not change worktree, index or HEAD');
  env.git(['add', '--', 'src/example.ts']);
  env.write('src/example.ts', 'export const value = 2;\n');
  const staged = runPublicAudit({ root: env.root, modes: ['staged'] });
  assert.equal(staged.findings.some(finding => finding.kind === 'openai_token'), true);
  assert.equal(runPublicAudit({ root: env.root, modes: ['worktree'] }).ok, true);
  assert.equal(JSON.stringify(staged).includes(fakeToken), false);
});

test('history audit finds deleted secrets, commit message secrets and non-noreply identities', t => {
  const env = fixture(t);
  env.write('README.md', fakeToken);
  env.environment.GIT_AUTHOR_EMAIL = privateEmail;
  env.commit(`fixture ${fakeToken}`);
  env.environment.GIT_AUTHOR_EMAIL = '123+audit@users.noreply.github.com';
  env.write('README.md', 'Public project\n');
  env.commit();
  env.git(['tag', '--annotate', 'fixture-tag', '--message', fakeToken]);
  const result = runPublicAudit({ root: env.root, modes: ['history'] });
  assert.equal(result.commitsScanned, 2);
  assert.equal(result.findings.some(finding => finding.kind === 'openai_token' && finding.path === 'README.md'), true);
  assert.equal(result.findings.some(finding => finding.kind === 'openai_token' && finding.path === '<commit-message>'), true);
  assert.equal(result.findings.some(finding => finding.kind === 'non_noreply_author_email'), true);
  assert.equal(result.annotatedTagsScanned, 1);
  assert.equal(result.findings.some(finding => finding.kind === 'openai_token' && finding.path === '<annotated-tag>'), true);
  for (const value of [fakeToken, privateEmail]) assert.equal(JSON.stringify(result).includes(value), false);
});

test('tracked private files fail despite ignore rules and reviewed PNGs require valid signatures', t => {
  const env = fixture(t);
  env.write('.gitignore', '*.key\nprivate/\n');
  env.write('README.md', 'Public project\n');
  env.write('private/report.json', '{}');
  env.git(['add', '--', '.gitignore', 'README.md']);
  env.git(['add', '--force', '--', 'private/report.json']);
  assert.equal(runPublicAudit({ root: env.root, modes: ['staged'] }).findings.some(finding => finding.kind === 'private_path'), true);
  env.git(['reset']);
  const png = tinyPng();
  env.write('docs/assets/reviewed.png', png);
  assert.equal(runPublicAudit({ root: env.root, modes: ['worktree'] }).findings.some(finding => finding.kind === 'image_requires_review'), true);
  assert.equal(runPublicAudit({ root: env.root, modes: ['worktree'], allowImages: ['docs/assets/reviewed.png'] }).ok, true);
  env.write('docs/assets/reviewed.png', tinyPng({ metadata: true }));
  assert.equal(runPublicAudit({ root: env.root, modes: ['worktree'], allowImages: ['docs/assets/reviewed.png'] }).findings.some(finding => finding.kind === 'image_contains_hidden_metadata'), true);
  env.write('docs/assets/reviewed.png', Buffer.concat([png, Buffer.from('hidden trailing material')]));
  assert.equal(runPublicAudit({ root: env.root, modes: ['worktree'], allowImages: ['docs/assets/reviewed.png'] }).findings.some(finding => finding.kind === 'invalid_png'), true);
  env.write('docs/assets/reviewed.png', 'private image replacement');
  assert.equal(runPublicAudit({ root: env.root, modes: ['worktree'], allowImages: ['docs/assets/reviewed.png'] }).findings.some(finding => finding.kind === 'invalid_png'), true);
});

// Construct a real one-pixel PNG rather than treating its signature as an image.
function tinyPng({ metadata = false } = {}) {
  function chunk(type, data) {
    const contents = Buffer.concat([Buffer.from(type), data]);
    let checksum = 0xffffffff;
    for (const byte of contents) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(data.length);
    const suffix = Buffer.alloc(4); suffix.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, contents, suffix]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    ...(metadata ? [chunk('tEXt', Buffer.from('Comment\0hidden metadata'))] : []),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

test('staged audit refuses symbolic links without reading their targets', t => {
  const env = fixture(t);
  const object = env.git(['hash-object', '-w', '--stdin'], { input: '../outside-repository' }).trim();
  env.git(['update-index', '--add', '--cacheinfo', `120000,${object},src/link.ts`]);
  const result = runPublicAudit({ root: env.root, modes: ['staged'] });
  assert.equal(result.findings.some(finding => finding.path === 'src/link.ts' && finding.kind === 'non_regular_git_entry'), true);
});

test('staged audit refuses private next-commit identities without exposing their email', t => {
  const env = fixture(t);
  env.git(['config', 'user.email', privateEmail]);
  const result = runPublicAudit({ root: env.root, modes: ['staged'] });
  assert.equal(result.findings.some(finding => finding.kind === 'non_noreply_pending_author_email'), true);
  assert.equal(result.findings.some(finding => finding.kind === 'non_noreply_pending_committer_email'), true);
  assert.equal(JSON.stringify(result).includes(privateEmail), false);
});

test('public audit identifies literal credentials while accepting placeholder configuration', () => {
  const value = ['Example', 'Secret', '12345'].join('');
  assert.equal(auditText(`api_key = "${value}"`, '.env.example').some(finding => finding.kind === 'credential_literal'), true);
  assert.deepEqual(auditText('api_key = "replace-me"', '.env.example'), []);
});
