# Code Invaders

A retro space shooter where **the code you write becomes the enemy**. Run one command and your
current editor tab turns into an old-school arcade cabinet: every line, function, class, bracket,
comment and compiler error in the file descends on your ship — and keywords fight back with powers
that match what the code *means*.

![Title screen](media/screenshots/title.jpg)

![`==` destroys the nearest enemy on both sides](media/screenshots/equals.jpg)

## Features

- **Plays in the tab you're in.** The game takes over the active editor tab (same group, same position).
  Exit and your file comes back exactly where it was — cursor, selection and scroll position included.
- **Your code is the wave.** Enemies are generated from the active document, top to bottom:

  | Code | Enemy | Behaviour |
  | --- | --- | --- |
  | `==` / `===` comparisons | twin pods | extra enemy for every line that compares — see code powers |
  | Statements | `abc` saucer | sways while descending |
  | Functions / methods | `ƒ name()` fighter | tougher; shoots from level 2 |
  | Classes, interfaces, structs, enums | `◆ Name` mothership | mini-boss, 3-way spread shot, always drops a power-up |
  | `if` `for` `return` `throw` … | diamond dart | homes in on your ship |
  | Bracket-only lines `});` | spinning glyph | fast zig-zag |
  | Comments | ghost | slow, phases in and out |
  | String literals | capsule | — |
  | **Errors** (diagnostics) | red `BUG` beetle | aims at you; destroying it shows the error message |
  | **Warnings** | yellow `WARN` beetle | fires straight down |

- **Code powers — enemies do what their code means.** Destroy one of these and its effect fires
  (a blinking marker shows which enemies carry a power):

  | Destroy… | Effect |
  | --- | --- |
  | `if` (also `else`, `switch`, `case`) | **drops a power-up** (`if` always; the others take the "true branch" 60 % of the time) |
  | `for`, `while`, `do` | **loop shield** — you can't be hurt for 6 seconds |
  | `==`, `===` | **destroys the nearest enemy on the left *and* the right** — both sides of the comparison |
  | `throw`, `raise` | exception blast damages everything nearby |
  | `break` | freezes every enemy and enemy shot for 3 s |
  | `return`, `yield` | returns all enemy shots to sender |
  | `await` | slows time for 4 s |
  | `try`, `catch` | one-hit shield |
  | `import`, `require` | imports a spread shot for 8 s |

  Powers can chain (a `==` that hits a `return` triggers it too), up to two links deep.

- **Two themes.** *Retro* (default): chunky pixel-art sprites, a bitmap font, CRT scanlines, an arcade
  HUD and the classic four-note marching bass that speeds up as the wave closes in. *Neon*: glowing
  vector ships, particles and a synthwave grid. Press `T` to switch.
- **Longer / more complex lines are tougher** — hit points grow with line length and operator density.
- **Live updates while you code.** Code you type is diffed (debounced) and spawns as glowing `NEW`
  bonus enemies worth 1.5× points.
- Levels with growing quotas and speed, lives, combo multiplier, clean-build bonus, high score,
  power-ups (spread shot, rapid fire, `try/catch` shield, extra life), particle explosions where the
  enemy's own characters fly apart, screen shake, parallax starfield, synthwave grid and synthesized
  sound effects.

![Loop shield after destroying a for loop](media/screenshots/loop.jpg)

## Controls

| Key | Action |
| --- | --- |
| `←` `→` or `A` `D` | Move |
| `Space` (also `↑` / `W`) | Fire — hold for auto-fire, about 8 shots a second (15 with rapid fire) |
| `[` / `]` (or `-` / `+`) | Move speed slower / faster (1–10, saved to your settings) |
| `T` | Switch theme: retro ↔ neon (saved to your settings) |
| `Esc` | Pause · on the pause / game-over screen: exit to the editor |
| `E` (paused) | **Edit code, keep game** — bring your file back into the tab; the game waits paused |
| `R` (paused / game over) | Restart |
| `Enter` / `Space` (game over) | Play again |
| `M` | Mute / unmute |

Any shortcut with `Ctrl`, `Cmd` or `Alt` is left alone, so `Ctrl+P`, `Ctrl+Shift+P`, `Ctrl+Tab` and
friends keep working while you play.

## Starting the game

1. Open any text file.
2. Run **Code Invaders: Start Game** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), or
   click the 🚀 rocket in the editor title bar.
3. Press `Space` to launch.

No text editor active (e.g. an image preview or Settings is focused)? You get a message with
**Open File…** and **Play Demo Wave** options.

### Coding mid-game

Pause with `Esc`, press `E`. Your file returns to the same tab and a **Back to Code Invaders** button
appears in the status bar. Type some code, then click that button (or run *Start Game* again / click
the rocket) — the game takes the tab back and your new code attacks as `NEW` enemies.

Edits made in another split of the same file are streamed to the game live, too.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `codeInvaders.moveSensitivity` | `5` | Ship speed, 1 (slow, precise) – 10 (fast). Also `[` / `]` in the game |
| `codeInvaders.theme` | `retro` | `retro` or `neon`. Also `T` in the game |
| `codeInvaders.difficulty` | `normal` | `chill`, `normal` or `hardcore` (speed, enemy fire rate, wave size) |
| `codeInvaders.startingLives` | `3` | 1–9 |
| `codeInvaders.reducedEffects` | `false` | Fewer particles, no glow, no screen shake |
| `codeInvaders.showEditorTitleButton` | `true` | Show the rocket button in the editor title bar |

## Safety and permissions

- **Read-only.** The extension reads document text and diagnostics. It never edits, saves, deletes or
  formats your files. (The test suite asserts that no edit/save API is ever called.)
- **No activation cost.** It activates only when you run the command.
- **Locked-down webview:** CSP `default-src 'none'`, scripts only with a per-load nonce, no inline
  scripts or styles, no `eval`, command URIs and forms disabled, and the webview can only load files
  from the extension's own `media/` and `dist/` folders. No network access, no telemetry.
- The only stored data is your high score (VS Code global state), the mute toggle (webview state), and
  — when you change them in the game — the extension's own `moveSensitivity` and `theme` settings in
  your user settings. The host validates these and can write nothing else.
- Works in untrusted and virtual workspaces.

## Development

Requirements: Node.js 18+ and VS Code 1.85+.

```bash
npm install          # dev tools only: typescript, esbuild, @types/*, @vscode/vsce
npm run build        # bundle dist/extension.js and dist/webview.js
npm run typecheck    # strict tsc for the host and for the webview (DOM) code
npm test             # 74 unit + integration tests (node:test)
npm run check        # all three
npm run watch        # rebuild on change
```

### Debugging

Open the folder in VS Code and press **F5** (*Run Code Invaders*). A new Extension Development Host
window opens; open any file there and run **Code Invaders: Start Game**. Breakpoints in `src/*.ts`
work through source maps. To debug the game itself, run **Developer: Open Webview Developer Tools**
while the game tab is focused.

### Packaging and installing

```bash
npm run package                                  # → code-invaders-1.1.0.vsix
code --install-extension code-invaders-1.1.0.vsix
```

Or in VS Code: Extensions view → `…` menu → **Install from VSIX…**.

### Project layout

```
src/
  extension.ts        activate / deactivate, command registration
  gameSession.ts      the webview panel: same-tab take-over, restore, debounced document + diagnostics sync
  codeAnalyzer.ts     pure code → enemy conversion (no vscode import; unit tested)
  webviewHtml.ts      HTML shell with the Content Security Policy
  shared/protocol.ts  typed messages between extension host and webview
  webview/
    main.ts           bootstrap: input, requestAnimationFrame loop, HUD/overlays, settings, messaging
    game.ts           game state, physics and code powers (no DOM; unit tested headlessly)
    render.ts         neon Canvas 2D renderer
    renderRetro.ts    retro renderer: low-res pixel buffer, original pixel sprites, arcade HUD
    pixelFont.ts      3×5 bitmap font
    audio.ts          WebAudio sound effects (no audio files)
media/                game.css, icon, screenshots
test/                 analyzer, game-logic and extension-host tests (with an in-memory vscode fake)
```

## How the same-tab take-over works

1. The webview panel is created in the active editor's `ViewColumn`, which places it right after the
   current tab in the same group.
2. The original text-editor tab is then closed with `tabGroups.close`, so the game sits exactly where
   your file was.
3. On exit, the file is reopened in that group **before** the panel is disposed (so the group never
   empties and the layout doesn't jump), and the saved selections and visible range are restored.
4. Closing the game tab with its ✕ also restores your file.

## Known limitations

- **Unsaved files:** closing a tab with unsaved changes would make VS Code ask you to save, so for a
  dirty file the game opens as the next tab in the same group and your file stays open behind it
  (untouched). Everything else works the same.
- While the game fills the tab you can't type in that file — use **Pause → E** (or a split of the same
  file). When the file isn't open in any editor, the enemy pool is frozen at its last state, because
  language servers clear diagnostics for closed files.
- Large files: only the 3,000 lines around your cursor are analysed and at most 600 enemies are kept.
  Very long (minified) lines are only looked at up to 400 characters.
- Enemy classification uses lightweight, language-agnostic patterns rather than a real parser, so
  unusual syntax may be classified as a plain statement.
- The game keeps its state while hidden (`retainContextWhenHidden`) so the edit-code round trip doesn't
  lose your run; the animation loop and audio are stopped while it isn't visible.
- Sound starts after your first key press (browser autoplay rules).

## License

MIT
