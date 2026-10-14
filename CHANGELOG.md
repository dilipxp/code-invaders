# Changelog

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
