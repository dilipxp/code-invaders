# Changelog

## 1.2.0

- **Your code's constructs are the enemies.** A syntax-aware JS/TS parser (with an indentation-based
  fallback for other languages) turns loops, conditionals, logic, arrow functions, functions,
  `const`/`let`, `while`, classes, `try/catch`, `async/await`, Promises, imports, `return`/`throw` and
  recursion into 17 data-driven enemy types in three tiers, each with an ability that matches what the
  code does. Related syntax is grouped (one Loop Commander per loop nest, one enemy per if-chain…).
- **Loop Commander**: a `for` loop arrives with its loop-variable escorts and signature; escorts
  intercept shots, destroying them exposes the core, killing the commander removes its escorts.
- **Five end-of-level bosses**: The Infinite Loop, The Recursive Hydra, The Class Overlord, The Async
  Phantom and The Runtime Error — with phases, health bars, intro and defeat sequences, level-clear
  summaries and a victory screen showing the final bug's signature.
- **Fairness**: telegraphed warnings before every dangerous attack, hard caps on escorts, clones,
  summons, reinforcements and projectiles, a capped difficulty curve, and waves normalised to a
  per-level budget (large files are sampled).
- Waves are planned once per level from the current code; typed code still arrives as `NEW` enemies.

## 1.1.0

- New default **retro arcade theme**: pixel-art sprites, bitmap font, CRT scanlines, arcade HUD,
  marching bass. The neon look is still available (`T` or `codeInvaders.theme`).
- **Code powers**: `if` drops a power-up, `for`/`while` give a 6 s loop shield, `==` destroys the
  nearest enemy on both sides, plus `throw`, `break`, `return`, `await`, `try` and `import` effects.
  Lines with `==`/`===` now spawn a twin-pod `==` enemy.
- **Move sensitivity** setting (`codeInvaders.moveSensitivity`, 1–10, `[` / `]` in game); calmer
  default speed and smoother acceleration.
- **Faster laser**: about 8 shots/s (was ~5), 15 with rapid fire; faster bolts.

## 1.0.0

- First release: same-tab space shooter built from the active document, live enemy updates while typing,
  diagnostics become bugs, power-ups, levels, high score, demo wave.
