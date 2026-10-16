# Galaxy Conquest

A touch-first, single-player RTS feel prototype based on the [initial design](docs/game-design-v0.1.md). Bun serves and bundles the HTML/TypeScript/CSS directly; ECSpresso 0.24.1 owns planets, individual ships/transports, production, movement, combat, AI, and victory. No Vite or extra server framework.

```sh
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3000. `bun run check` runs strict TypeScript checks, simulation tests, and a production build into `dist/`.

GitHub Pages publishes the production build at https://david0178418.github.io/galaxy-conquest/. The [deployment workflow](.github/workflows/deploy.yml) runs checks, builds, and deploys on pushes to `main`; it can also be run manually from the Actions tab on `main`. Repository Settings → Pages must use **GitHub Actions** as the build source. Bundled asset URLs are relative, so the same build works under `/galaxy-conquest/` and at a domain root.

The star map fills the viewport. Drag to pan; scroll up to zoom in and down to zoom out around the pointer, or pinch to zoom on touchscreens. Horizontal scrolling pans sideways. Use the fullscreen toggle in the top bar to enter or leave fullscreen where supported. Focus the map and use arrow keys to pan with a keyboard. Selecting a planet opens a fixed command panel on the right (bottom on phones); rival and neutral worlds show their information. The field guide menu contains scenarios, pace, and help.

Tap or left-click a blue planet to select it. On touch, hold a destination for 500 ms to send 50% of the selected sources’ troops and ships; with a mouse, right-click the destination. A short tap or left click only changes selection. Dragging, pinching, or cancelling a touch cancels a pending hold. Change the send amount or choose ships/troops only in the command panel. Production buttons change the selected planets; guns never travel. Multi-select gathers several sources; finish selection before holding or right-clicking a destination. Tap a selected source again or use Clear selection to deselect. Tap your blue orbital presence over an enemy world to redirect blockading ships.

Troops capture surfaces. Ships and immobile guns fight in orbit. Ships also trade fire with hostile ships and transports within 48 units, then keep the same destination. Transports have no weapons: they take that damage and stay on their flight path. Garrison ships and guns that are not already fighting in orbit shoot hostile travelers inside the arrival ring (planet radius plus 22). That shot is not applied twice. A passer does not join the orbit, change a blockade, or block a landing. Automatic disposable transports carry up to 10 troops each and wait for hostile orbital resistance to clear before landing. Escorts absorb incoming fire first; exposed transports can die with their cargo. Orbital control alone never captures the surface. A dashed hostile ring means blockade, preventing surface departures while production continues. A solid ring marks hostile presence before complete control. Newly produced ships and guns immediately fight blockaders. Ground combat uses immediate numerical attrition; a surviving attacking troop is required to capture. Partial production is discarded when switching.

The **Prototype lab** contains a normal AI skirmish, an established blockade, and a defended invasion. Labs start with AI disabled; enable it when useful. Restart resets the scenario; pace changes persist. Pause freezes movement, production, combat, and AI while keeping map navigation, selection, orders, and production changes available. Orders allocate units immediately, so repeated sends use the remaining stock; movement and production progress continue on resume, without catching up paused time. Switching tabs pauses simulation automatically. Win by taking every rival planet.

Tune rates, capacity, costs, movement, and combat in [src/config.ts](src/config.ts). Map layout and repeatable scenario setups are in [src/game.ts](src/game.ts). Both sides use the same production and combat rules. Neutral worlds do not produce. The deterministic simulation uses a 0.05-second timestep. Each moving capital ship and transport is its own ECS entity; there is no fleet entity or transport inventory.

This pass uses a fixed eighteen-world map across a 1200 × 1320 world-unit area, basic AI, and instant ground attrition. Planet centers are at least 216 units apart. Both sides start with one world; the other sixteen are neutral. Pan and zoom to inspect the expanded map. There is no networking, controller support, audio, persistence, or mid-flight retargeting. The lab reports first player capture, player orders, total captures, and combined transport/cargo losses. Counts on surfaces are troops; ◆ counts are orbital ships and ✣ counts are guns (rounded up while damaged).

Simulation checks cover the opening capture, production switching, transport exposure and grace time, escorted invasions, blockade/reinforcement/redeployment, pause, multi-source sends, AI expansion, simultaneous combat, and victory. Physical-device touch comfort, combat readability, balance, and match feel require playtesting.
