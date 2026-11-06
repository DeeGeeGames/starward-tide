# Refined demo evidence

Captured from the production bundle on 2026-11-05 in Chromium with software WebGL. Screenshots show the implemented game, not mockups.

- [Title](title.png), [selected world](selected.png), [portrait](mobile.png), [short landscape](landscape.png), [after-action report](results.png).
- [Demo journey](browser-evidence.json): real-time opening capture, reviewed dispatch and cancellation, production, save/Continue, audio settings, compact layouts, and results/replay. Results used a validated completed save from the simulation described below.
- [Simulation](simulation-evidence.json): the authored operation reached blue victory with the rival active after 197.45 simulation seconds, using normal production and dispatch. This establishes reachability, not average duration or balance.
- The existing `scripts/playtest-command-horizon.cjs`, `scripts/playtest-polish.cjs`, and `scripts/playtest-sound.cjs` cover simulated controller input, pointer/touch gestures, responsive controls, and native Web Audio. Set `GAME_URL` to the production server and `PLAYWRIGHT_MODULE` to an installed Playwright module. Their check records are included here.

`bun run check` passed lint, 232 tests, strict typechecking, and the production build. Independent source review found and repaired guidance after cancelled launches, restored-result wording, guidance availability, and deliberate destination confirmation. The final review found no substantive remaining defects.

These checks do not establish physical controller/touch feel, hardware GPU performance, subjective audio quality, or Steam-client acceptance. Steam packaging and release were outside this change.
