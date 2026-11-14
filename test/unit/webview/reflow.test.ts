import { describe, expect, it } from 'vitest';
import { reflow } from '../../../webview/reflow';

describe('reflow', () => {
  it('joins the hard-wrapped lines of a paragraph', () => {
    const body = [
      "Kubernetes auth. On login, k8sToken() reads the pod's ServiceAccount JWT",
      'fresh from disk (K8S_JWT_PATH) and POSTs {role, jwt} to K8S_URL/login.',
      '',
      'Generalized the AppRole token cache into a shared vaultLogin + cachedToken,',
      'reusing the existing retry logic.',
    ].join('\n');
    expect(reflow(body)).toBe(
      [
        "Kubernetes auth. On login, k8sToken() reads the pod's ServiceAccount JWT fresh from disk (K8S_JWT_PATH) and POSTs {role, jwt} to K8S_URL/login.",
        '',
        'Generalized the AppRole token cache into a shared vaultLogin + cachedToken, reusing the existing retry logic.',
      ].join('\n'),
    );
  });

  it('keeps a break after a short line, even inside a joined paragraph', () => {
    const body = [
      'This first line is long enough to have stopped at the wrap column here',
      'and ends here.',
      'A new line the author started on purpose.',
    ].join('\n');
    expect(reflow(body)).toBe(
      [
        'This first line is long enough to have stopped at the wrap column here and ends here.',
        'A new line the author started on purpose.',
      ].join('\n'),
    );
  });

  it('keeps lists, indented lines, fences and trailers as written', () => {
    const body = [
      '- a list item that is long enough to have been wrapped by the editor here',
      '  continued, indented',
      '- second item',
      '1. a numbered item that is also long enough to have been wrapped here',
      '',
      '```',
      'a code line that is long enough to pass the fifty character threshold',
      'next code line',
      '```',
      '',
      'Signed-off-by: Someone With A Long Name <someone.with.long.name@example.com>',
      'Co-authored-by: Another <another@example.com>',
    ].join('\n');
    expect(reflow(body)).toBe(body);
  });

  it('joins an unindented continuation onto a long list item', () => {
    expect(reflow('- a list item that is long enough to have been wrapped by the editor\nhere')).toBe(
      '- a list item that is long enough to have been wrapped by the editor here',
    );
  });

  it('leaves blank lines and leading indentation alone', () => {
    expect(reflow('line one\n\n  indented')).toBe('line one\n\n  indented');
  });
});
