// SPDX-License-Identifier: AGPL-3.0-only
import { mountCodexSkin } from './skin/runtime.ts';

const native = location.protocol === 'app:' && location.hostname === '-' && location.pathname === '/index.html';
const fixture = location.hostname === '127.0.0.1' && document.body.hasAttribute('data-codex-glass-fixture');
if (!native && !fixture) throw new Error('This skin can only run in the Codex main renderer or its explicit local validation fixture.');
(window as any).__CODEX_GLASS__?.dispose();
(window as any).__CODEX_GLASS__ = mountCodexSkin();
