import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { createMockWebview } from '../../mocks/vscode';
import { renderHtml } from '../../../src/history/html';

const NONCE = 'abc123_-NONCE';
const EXT = vscode.Uri.file('/ext');

function render() {
  const webview = createMockWebview();
  const html = renderHtml(webview as unknown as vscode.Webview, EXT, NONCE);
  return { html, webview };
}

describe('renderHtml', () => {
  it('has the exact CSP meta tag', () => {
    const { html, webview } = render();
    const csp = `default-src 'none'; script-src 'nonce-${NONCE}'; style-src ${webview.cspSource} 'nonce-${NONCE}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};`;
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  });
  it('contains no unsafe- anywhere', () => {
    expect(render().html).not.toContain('unsafe-');
  });
  it('every <script has the nonce and no inline code', () => {
    const tags = render().html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) {
      expect(t).toContain(`nonce="${NONCE}"`);
      expect(t).toMatch(/src="/);
      expect(t).toMatch(/<\/script>$/);
      expect(t.replace(/<script[^>]*>/, '').replace('</script>', '')).toBe('');
    }
  });
  it('script and style URLs come from asWebviewUri of dist/', () => {
    const { html } = render();
    expect(html).toContain('src="https://file+.vscode-resource.mock.net/ext/dist/webview.js"');
    expect(html).toContain('href="https://file+.vscode-resource.mock.net/ext/dist/webview.css"');
    expect(html).toMatch(
      /<link [^>]*nonce="abc123_-NONCE"[^>]*webview\.css|<link [^>]*webview\.css[^>]*nonce="abc123_-NONCE"/,
    );
  });
  it('has a single root div, no inline style or handlers', () => {
    const { html } = render();
    expect(html.match(/<div id="root"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});
