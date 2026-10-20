# Galaxy Conquest — current game design

This document describes implemented behavior as of 2026-10-18. Skirmish is the ordinary entry; the campaign remains an opt-in development preview (`?campaign=1`) pending owner acceptance of its loop and presentation. It supersedes the initial v0.1 concept. The [README](../README.md) covers running the game and operating its controls. Tuning values below are defaults, not promises about balance or existing saved campaigns, which retain their own campaign rules.

## Intent and boundaries

Preserve the speed and clarity of a Galcon-like game while adding production choices, vulnerable troop transport, orbital combat, and blockades. Decisions center on what to produce, where to produce it, and where to send it. Battles resolve automatically without manual targeting, formations, activated abilities, or individual-unit selection.

The player is blue; one computer rival is red; neutral planets are unclaimed. Tactical ships and transports are individual entities. A dispatch groups units for order tracking and recall, but does not create a separately managed fleet. Surface troops and fixed defense platforms are planetary counts. Campaign expeditions represent committed points between systems rather than persistent tactical ships.

There is no networking, controller support, audio, research, upgrades, diplomacy, construction queue, transport inventory, resource harvesting, account, cloud sync, or save export/import. Campaign points are a planetary readiness budget; they do not add a tactical currency or building economy.

## Skirmish

The core loop is to capture planets, increase production, specialize planets in troops/ships/defense platforms, and dispatch forces to reinforce, blockade, or invade. A skirmish ends when one faction owns no planets; its surviving ships and transports do not keep it alive. Neutral planets need not all be conquered.

New games preview a seeded, mirrored map and launch that exact layout. Restart replays the layout. Mirrored pairs have equal resources and at least 216 world units between centers.

| Size | Planets | Map width × height |
| --- | ---: | --- |
| Small | 12 | 1040 × 1080 |
| Medium | 18 | 1200 × 1320 |
| Large | 30 | 1560 × 1716 |

Each side starts with one planet, 44 troops, three ships, no platforms, troop production, and production rate 2.6. Other planets are neutral, with no ships or platforms, and do not produce until captured. Neutral tiers have 8/14/24 troops and production rates 1.7/2.2/3.4 respectively.

The Prototype lab uses a fixed eighteen-planet 1200 × 1320 map. Its skirmish starts with AI enabled. Blockade and invasion scenarios start with AI disabled: Sol has a red surface with 18 troops; the blockade adds four blue orbital ships, while the invasion adds two red platforms and a red ship there, plus five extra blue ships at Terra. Restart restores the chosen scenario; pace persists.

## Tactical rules

These rules apply to skirmishes and campaign encounters, except for their different starting forces and victory conditions.

### Production and forces

Owned planets produce one selected type continuously. Neutral planets do not produce. Production progress increases by `planet rate × 0.125` per simulation second; completing a unit consumes its cost. Switching types discards partial progress but preserves completed units. Capture resets progress and selects troops.

| Unit | Cost | Health | Damage per simulation second | Role |
| --- | ---: | ---: | ---: | --- |
| Troop | 1 | Numerical ground attrition | One defending troop per attacking troop | Hold or capture surfaces; travel only as cargo |
| Ship | 6 | 6 | 1.8 | Mobile orbital combat, escort, interception, blockade |
| Defense platform | 5 | 4 per platform | 2.4 per surviving platform | Planet-bound orbital defense |
| Transport | Free when troops dispatch | 2 | 0 | Carry up to 10 troops; consumed on landing |

Platforms may be fractionally damaged; their damage output scales with the remaining count. The interface rounds the count up and displays platform turrets on a slowly turning outer orbit. This motion follows simulation time and stops while paused. Ships and transports have individual health; troop cargo is lost when its transport is destroyed.

### Dispatch, movement, and orders

Select one or more sources and a destination planet. The default send amount is 50%, with 25% and 100% also available. Filters select combined forces, ships only, or troops only. For each source, ships round up and troops round down after applying the fraction. Platforms never depart. A friendly orbital presence above a hostile surface can be a ship-only source.

Orders reserve troops and ships immediately, including during pause, so repeated sends use the remaining stock. A paused launch can be cancelled before the next simulation step, restoring its reservation. Recall redirects surviving escorts and loaded transports from their current positions to each unit's original departure planet. Waiting invasion transports and their escorts remain recallable until landing completes. Returns follow normal arrival/combat rules if their source has changed hands. Returning orders cannot be recalled again. Initial campaign invasion units have no local departure planet/order to recall, but subsequent ordinary dispatches do.

Ships travel at **23.75** world units per simulation second; transports at **11.875** (half ship speed). Arrivals enter orbit within `planet radius + 22` units of the center. Escorts can arrive before their transports. There is no arbitrary mid-flight retargeting, path planning, or formation control.

### Interception, orbit, and landing

Traveling ships automatically target hostile travelers within **48** world units, preferring ships over transports, then nearest distance, then entity identity for ties. Ships stop moving while they have such a target and resume their destination afterward. Transports cannot shoot and continue moving while under fire. Orbiting ships, waiting transports, and platforms do not participate in passing combat. A passer does not join the orbit, establish a blockade, or prevent a landing.

At each planet, opposing ships and owner-aligned platforms deal orbital damage simultaneously from the pre-damage strengths. Damage reaches ships first, then the surface owner's platforms, then exposed transports. A newly arrived transport has **0.75 simulation seconds** of protection from orbital damage; this is not protection from transit fire. Hostile ships or enemy-owned platforms prevent landing until destroyed. Friendly reinforcement transports must also wait for hostile orbital resistance to clear.

Safe transports unload automatically and disappear. Friendly cargo adds troops to the surface. Hostile cargo subtracts defenders one for one; ownership changes only if an attacking troop survives. Equal troop counts leave the existing owner with zero troops. A capture resets production to troops and clears partial progress. Winning orbit alone cannot capture a surface.

A blockade exists when an owned planet has hostile orbital ships, no friendly orbital ships, and no remaining platforms. It prevents departures from the surface owner, while production continues. Newly produced ships and platforms immediately contest the blockaders; outside reinforcements can break the blockade. The attacker can redirect its own blockading ships. A dashed hostile ring marks blockade; a solid hostile ring indicates hostile presence before complete control.

### Time, AI, and information

The tactical simulation advances in fixed **0.05-second** steps at 0.5×, 1×, or 2× pace. Pause freezes movement, production, combat, and AI while leaving navigation, selection, production changes, dispatch, cancellation, and recall available. There is no catch-up for paused time. Hiding the tab pauses tactical play; returning resumes it only if it was running before hiding.

The rival evaluates tactical decisions every **2.8 simulation seconds**, using the same unit costs and combat rules. It favors nearby lightly defended targets, switches between troops and ships, builds ships under hostile orbital pressure, and sends ship-only attacks to clear resistance. It normally retains 25% of a source, increasing its troop commitment when necessary to exceed the current garrison. It can pool troops to finish an invasion and pool ships to relieve a blockade with more ships than the blockaders. Existing inbound cargo reduces additional troop demand. This heuristic is not a prediction of future production, interception, or survival along a route; it does not guarantee winning decisions.

The map distinguishes ownership, surface troops, orbital ships (◆), and platforms (✣). Orders shows routes involving the current selection; Show all preserves selection until it changes. Selecting a row highlights its route. The lab records first player capture time, player orders, total captures, and combined transport/cargo losses; production shares, blockade duration, average match length, and stalemate frequency are not currently collected.

## Campaign preview

### Galaxy and planetary readiness

A campaign adds a continuous-time galaxy map above the tactical game. Generated Small/Medium/Large galaxies contain 12/18/30 systems with three planets each, one starting system per faction, and all other systems unclaimed. Galaxy positions use the same mirrored, spaced generator as skirmish. Each tactical system uses a three-planet 1000 × 700 layout. Every planet starts with **100 baseline points**, zero development bonus, and zero depletion. Tactical units are created from encounter allocation, rather than the skirmish's free starting ships.

Each planet tracks ownership, baseline capacity, accumulated development bonus, absolute depletion, and galaxy timestamps. Available points are `max(0, baseline + development bonus − depletion)`. Committing whole points increases depletion immediately; fractional recovery remains on the contributing planet and cannot be pooled to fund a whole point elsewhere.

While galaxy time advances, owned planets gain **0.2% of baseline capacity per galaxy second**, capped at **+20% of baseline**. Depletion recovers continuously at **1% of current maximum per galaxy second**, including capacity growth during that interval. Neutral planets recover depletion too, but do not gain development. Every actual capture halves accumulated development bonus, including temporary captures and recaptures during an encounter. Baseline capacity is preserved; absolute depletion is preserved even if it exceeds the reduced maximum. New owners can issue orders immediately; growth and recovery proceed when galaxy time resumes.

The galaxy starts paused. Pause leaves camera navigation, inspection, contribution editing, and orders available. Pace is 0.5×/1×/2× through the game menu. Hiding the galaxy tab pauses it; returning does not resume it automatically. The galaxy clock displays elapsed MM:SS, independently of tactical battle time.

### Expeditions and arrivals

A selected system containing blue planets is the funding source. Selecting another system replaces that selection; inspecting a rival or unclaimed system clears the previous source. Selecting the current system again, closing its panel, or clearing selection removes the source. A mixed-ownership system can contribute only the player's planets.

Contributions use individual sliders/−/+ controls or 25%/50%/100% presets, defaulting to 50%. Presets floor each owned planet's share and recalculate from current balances at dispatch; manual edits clear the preset. Right-click or a 500 ms hold on another system commits immediately. An order cannot spend unavailable points or draw from multiple source systems.

Travel time is `max(10 seconds, distance / 10)` in galaxy time. Before any galaxy time advances after departure, Cancel launch refunds contributions immediately. Later Recall takes the elapsed outbound time to return, replenishing the original contributing planets still owned by that faction and discarding surplus. Returning orders cannot be recalled again. All galaxy orders and travel are frozen during encounters.

Arrivals resolve chronologically, with expedition identity breaking simultaneous ties:

- **Entirely unclaimed system:** any positive whole-point expedition can reduce its remaining capture resistance, initially combined planet value × the configured neutral claim rate, rounded up with a minimum of one. Progress persists across arrivals and saves, and either faction reduces the same resistance. Equality leaves it neutral at zero resistance. An arrival exceeding the remainder claims all planets without battle; its surplus becomes starting points, distributed by planet value without a cap. Later hostile arrivals encounter its new owner.
- **Entirely friendly system:** replenish the most depleted destination planets first, breaking ties by planet identity; discard surplus.
- **Hostile or mixed system:** freeze galaxy time and create an encounter using destination planets' available budgets and the arriving expedition's committed budget. Arrivals do not reinforce a battle already underway; each is resolved separately.

Every **10 galaxy seconds**, the rival considers routes to systems not wholly red, nearest first, and commits up to half the source's available points from its owned planets in whole-point contributions. Partial commitments can reduce unclaimed resistance. At most one expedition launches per decision. This is separate from the tactical AI.

Orders and its header count include only active player expeditions. Selecting a system scopes the list to routes with that source or destination; Show all retains selection and overrides filtering until selection changes. Rival expeditions remain part of simulation and map presentation. System details and the auxiliary Orders/menu/report panel have separate space. Escape closes Orders first; otherwise it clears selection and the auxiliary panel, while respecting text editing and native fullscreen behavior.

### Encounter setup and combat

Defenders have separate budgets for each planet; attackers share one expedition budget across distinct beachheads. Troops cost 1, ships 6, and defense platforms 5. Attackers buy troops and ships; neutral defenders can buy troops only. Each side commits its initial allocation without seeing the other's forces or beachhead targets. The player sees and edits only its own faction's allocations; opposing and neutral defenses and rival beachheads remain hidden until battle starts. Galaxy-map expedition visibility and tactical visibility after launch are unchanged. Unspent allocation does not refund the expedition commitment. A ship-only beachhead is permitted even though ships cannot capture surfaces.

Default defenses spend approximately 30% on ships, 20% on platforms, and the remainder on troops, rounding purchases down; neutral defenses allocate troops only. The default invasion spends approximately half on ships and the remainder on troops at the first planet outside attacker ownership. The owner can revise its allocations before starting combat.

The invasion enters from one offscreen edge selected by inter-system travel direction. All beachheads share that edge, without a local source planet or initial recall order. The ordinary tactical interface, production, AI, dispatch, and later recall rules apply. Galaxy development, recovery, expeditions, and the galaxy clock stay frozen throughout setup and battle.

An encounter faction remains viable while it owns a planet **or has a living loaded troop transport**. Once it has neither, it loses; its surviving ships and empty transports are removed as cleanup losses. This differs from skirmish victory. There is no withdrawal command or automatic battle time limit.

### Results, continuation, and campaign victory

After combat, the result panel shows final ownership and projected development, depletion, and available points at the frozen galaxy timestamp. Return to galaxy applies the result once and resolves other arrivals due at that timestamp. Reports summarize arrivals and planetary changes. The galaxy returns paused; any queued encounters keep it frozen until resolved.

Only ownership and the chronological capture events carry back from tactical combat. Tactical survivors, casualties, unused defensive allocations, and units produced in battle do not convert into campaign points. Expedition spending remains spent after defeat. Every capture event applies development loss, even if final ownership returns to the original faction.

A faction remains alive in the campaign while it owns any planet or has any unresolved expedition, including a returning expedition. Victory is evaluated on the galaxy after encounter/arrival resolution and requires the rival to have neither. Losing the last surface during a tactical encounter need not end the entire campaign if other systems or expeditions remain.

## Profiles, saves, and distribution

Up to ten local profiles share the browser/site's IndexedDB storage. First use creates a selected Player profile. Each profile has one skirmish slot and one independent campaign slot. Rename preserves saves; confirmed deletion removes the profile and its saves. Replacing one mode's save preserves the other. New-game replacement and destructive profile actions require confirmation.

Skirmish snapshots retain map, units, production, orders, match state, and pace; Continue restores paused. Campaign saves retain galaxy time/rules, planetary balances, expeditions, encounter phase, valid allocation drafts, and active tactical snapshots/capture history. Continued battles restore paused without reseeding or spending twice. Continuous-time campaign saves use schema version 2; the earlier turn-based preview is unsupported and requires a new campaign.

Manual save and a periodic 15-second autosave operate during play, including pause; relevant actions also schedule or persist saves. Campaign headers and menus show saving, saved, and failure status. Invalid snapshots cannot be continued and validation does not rewrite the stored data. Tactical safety limits include 100,000 troops/cargo, production rates up to 10,000, production progress below 10,000, map dimensions up to 10,000, positions within ±20,000, and planet radii up to 1,000; these are format safety limits, not balance limits.

Storage is browser- and origin-local, can be blocked/partitioned in embedded contexts, and can be lost through clearing or eviction. The production PWA caches build assets for offline play after an online caching visit; profiles and saves remain subject to those storage limits. Updates wait for all game windows to close. Development does not register a service worker. See the README for installation and deployment.

## Implementation references

| Area | Source |
| --- | --- |
| Tactical tuning, simulation, commands | [config.ts](../src/config.ts), [game.ts](../src/game.ts) |
| Movement, combat, tactical AI | [movement.ts](../src/movement.ts), [combat.ts](../src/combat.ts), [ai.ts](../src/ai.ts) |
| Maps and lab setup | [maps.ts](../src/maps.ts), [game-scenario.ts](../src/game-scenario.ts) |
| Campaign defaults, timing, arrivals, victory | [campaign-state.ts](../src/campaign-state.ts), [campaign-scenario.ts](../src/campaign-scenario.ts) |
| Capacity, depletion, spending | [campaign-development.ts](../src/campaign-development.ts), [campaign-points.ts](../src/campaign-points.ts) |
| Allocation and tactical bridge | [campaign-setup.ts](../src/campaign-setup.ts), [campaign-allocation.ts](../src/campaign-allocation.ts), [campaign-encounter.ts](../src/campaign-encounter.ts) |
| Screens, interaction, save lifecycle | [main.ts](../src/main.ts), [front-menu.ts](../src/front-menu.ts), [campaign-ui.ts](../src/campaign-ui.ts) |
| Persistence and validation | [profile-storage.ts](../src/profile-storage.ts), [save-state.ts](../src/save-state.ts), [campaign-save.ts](../src/campaign-save.ts) |
| Presentation and culling | [pixi-renderer.ts](../src/pixi-renderer.ts), [render-candidates.ts](../src/render-candidates.ts) |

## Playtest questions and acceptance limits

Implemented defaults above are settled behavior for this revision. Changing them remains a design/balance decision. Open questions concern whether the behavior works well for players:

- Can a new player expand, understand the two combat layers, and identify why an invasion failed?
- Do troops, ships, and platforms each create useful choices without repetitive production switching or defensive stalemates?
- Does half-speed troop transport make escorts and interception readable and useful without making expansion too slow?
- Are blockade-source selection, dispatch filters, multi-source orders, cancellation, and recall discoverable on touchscreens?
- Do campaign commitments, growth/recovery, capture losses, neutral claims, and separate tactical budgets produce useful strategic decisions?
- Does the campaign encounter/result/return loop communicate what persists and what is spent clearly enough for owner acceptance?

Automated simulation, persistence, geometry, and UI-state regressions support correctness. Recorded renderer/culling evidence uses automated Chromium with SwiftShader, not physical GPU or phone throughput. Physical touch comfort, combat readability, balance, match duration, and campaign feel still require playtesting. The renderer migration has recorded owner acceptance; that does not establish campaign acceptance. Performance evidence and its environment limits remain in the technical documents linked from the README.
