import * as vscode from 'vscode';

/** Webview shell. CSP is fixed by the project constraints; no inline script or style is allowed. */
export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string): string {
  const dist = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', file)).toString();
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Git History Plus</title>
<link rel="stylesheet" nonce="${nonce}" href="${dist('webview.css')}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${dist('webview.js')}"></script>
</body>
</html>`;
}
