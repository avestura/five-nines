# Phase 1: Scaffold

- [x] `package.json`, `tsconfig.json`, `vite.config.ts` (base `./` so Pages works under any repo name)
- [x] `index.html` with a single canvas and a thin DOM layer for panels
- [x] `.github/workflows/deploy.yml`: build and publish `dist/` to Pages
- [x] `src/main.ts`: draws the blueprint grid, handles resize and DPR
- [x] `src/theme.ts`: palette tokens (paper, ink, blue pencil, red pencil, stamp green)
- [x] `.gitignore`, root `README.md`

Done when `npm run dev` shows graph paper and `npm run build` produces `dist/`.
