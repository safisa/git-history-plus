import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), 'utf8');

describe('third-party notices (bundled into the webview)', () => {
  it('ships THIRD_PARTY_NOTICES.md in the .vsix allow-list', () => {
    expect(existsSync(new URL('THIRD_PARTY_NOTICES.md', root))).toBe(true);
    expect(read('.vscodeignore').split(/\r?\n/)).toContain('!THIRD_PARTY_NOTICES.md');
  });

  it('carries the license and copyright line of every bundled package', () => {
    const notices = read('THIRD_PARTY_NOTICES.md');
    for (const pkg of [
      'react',
      'react-dom',
      'scheduler',
      '@tanstack/react-virtual',
      '@tanstack/virtual-core',
    ]) {
      const license = read(`node_modules/${pkg}/LICENSE`);
      const copyright = license
        .split(/\r?\n/)
        .find((l) => l.trim().startsWith('Copyright'))!
        .trim();
      expect(notices, pkg).toContain(`## ${pkg}`);
      expect(notices, pkg).toContain(copyright);
    }
    expect(notices).toContain('## @vscode/codicons');
    expect(notices).toContain('Creative Commons Attribution 4.0 International');
    expect(notices).toContain('Copyright (c) Microsoft Corporation.');
  });
});

describe('icons', () => {
  const pkg = JSON.parse(read('package.json')) as {
    contributes: { views: Record<string, { id: string; icon?: string }[]> };
  };
  const ignore = read('.vscodeignore').split(/\r?\n/);

  it('ships the history tab icons in the .vsix allow-list', () => {
    for (const f of ['images/history-light.svg', 'images/history-dark.svg']) {
      expect(existsSync(new URL(f, root)), f).toBe(true);
      expect(ignore).toContain(`!${f}`);
    }
  });

  it('gives every contributed view an icon that ships in the .vsix', () => {
    const views = Object.values(pkg.contributes.views).flat();
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.icon, v.id).toBeTruthy();
      expect(existsSync(new URL(v.icon!, root)), v.icon).toBe(true);
      expect(ignore, v.icon).toContain(`!${v.icon}`);
    }
  });
});
