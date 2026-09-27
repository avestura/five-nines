# Phase 8: Polish

- [x] Sandbox: all parts, traffic sliders, chaos buttons
- [x] WebAudio: a hum that rises with load, place/wire clicks, pager beeps on a hotfix, a stamp thunk on win (no per-request tick: too noisy at 300 req/s)
- [x] Settings: mute, vendor naming (Generic / Azure / AWS). Reduce motion follows the OS setting only.
- [x] Balance harness in CI: every level has a reference solution that wins,
      and the naive solution loses
- [x] Accessibility: dot types differ by shape as well as color

Not done yet: a reduce-motion toggle beyond the CSS media query. Also, CI runs the harness but not the headless Chrome smoke tests, since they need a local Chrome.
