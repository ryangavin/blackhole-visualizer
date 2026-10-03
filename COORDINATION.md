# BlackHole Visualizer

User scope: complete macOS Tauri/Butterchurn app using BlackHole. No tests; Ryan is the first hands-on tester. Compile checks and probes are allowed. No remote publishing or main updates.

Coordinator: `/Users/ryan/Code/ryangavin/blackhole-visualizer`, branch `work/coordinator`.
Saved initial checkout: sibling `.blackhole-visualizer-source`, branch `main`.
Immutable assignment base: `13bf593ea4f6846d67bebd54cf3fffefb55cdc89`.

| Owner | Scope | Worktree / branch | Status |
|---|---|---|---|
| Orchestrator | npm/Vite/TypeScript setup, launcher, app icon, docs, build and launch | coordinator / work/coordinator | Active |
| native_audio (Developer) | Rust Core Audio capture and Tauri shell | ../.blackhole-native / work/native-audio | Active |
| frontend (Developer) | src/** and index.html | ../.blackhole-frontend / work/frontend | Active |

Integration will preserve immutable source heads here before temporary worktree cleanup. No assignment owns a preview server. The coordinator owns the integrated app.
