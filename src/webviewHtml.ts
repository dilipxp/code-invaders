import * as vscode from 'vscode';

export function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/** Folders the webview may load from — nothing else in the workspace is exposed. */
export function localResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'dist')];
}

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'game.css'));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Code Invaders</title>
</head>
<body>
  <div id="stage">
    <canvas id="game" tabindex="0" aria-label="Code Invaders game"></canvas>

    <header id="hud" class="hidden" aria-live="off">
      <div class="hud-block"><span class="hud-label">Score</span><span id="hud-score" class="hud-value">0</span></div>
      <div class="hud-block"><span class="hud-label">Hi</span><span id="hud-hi" class="hud-value dim">0</span></div>
      <div class="hud-block"><span class="hud-label">Level</span><span id="hud-level" class="hud-value">1</span></div>
      <div class="hud-block"><span class="hud-label">Lives</span><span id="hud-lives" class="hud-value lives"></span></div>
      <div class="hud-block"><span class="hud-label">Enemies</span><span id="hud-enemies" class="hud-value">0</span></div>
      <div class="hud-block grow"><span class="hud-label">Source</span><span id="hud-file" class="hud-value file"></span></div>
    </header>
    <div id="hud-powerups"></div>
    <div id="hud-hint" class="hidden">Esc pause · M mute</div>
    <div id="toast" class="hidden"></div>
    <div id="crt" aria-hidden="true"></div>

    <section id="screen-title" class="overlay">
      <div class="panel">
        <h1 class="logo"><span>CODE</span><span>INVADERS</span></h1>
        <canvas id="logo-pixel" class="logo-pixel" aria-label="Code Invaders"></canvas>
        <p class="tagline">Your code has turned hostile. Defend the build.</p>
        <p id="title-stats" class="stats"></p>
        <div class="legend" id="legend"></div>
        <div class="powers" id="powers" aria-label="Code powers"></div>
        <div class="controls">
          <div><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> move</div>
          <div><kbd>Space</kbd> fire</div>
          <div><kbd>Esc</kbd> pause / exit</div>
        </div>
        <div class="settings-row" data-settings></div>
        <div class="actions">
          <button id="btn-start" class="primary">Launch <kbd>Space</kbd></button>
          <button id="btn-title-exit">Back to code <kbd>Esc</kbd></button>
        </div>
      </div>
    </section>

    <section id="screen-pause" class="overlay hidden">
      <div class="panel small">
        <h2>Paused</h2>
        <p id="pause-note" class="stats"></p>
        <div class="settings-row" data-settings></div>
        <div class="actions vertical">
          <button id="btn-resume" class="primary">Resume <kbd>Space</kbd></button>
          <button id="btn-edit">Edit code, keep game <kbd>E</kbd></button>
          <button id="btn-restart">Restart <kbd>R</kbd></button>
          <button id="btn-pause-exit">Exit to editor <kbd>Esc</kbd></button>
        </div>
      </div>
    </section>

    <section id="screen-over" class="overlay hidden">
      <div class="panel">
        <h2 class="danger">Build Failed</h2>
        <p class="stats big"><span id="over-score">0</span></p>
        <p id="over-best" class="stats"></p>
        <dl id="over-details" class="details"></dl>
        <div class="actions">
          <button id="btn-again" class="primary">Play again <kbd>Enter</kbd></button>
          <button id="btn-over-exit">Exit to editor <kbd>Esc</kbd></button>
        </div>
      </div>
    </section>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
