import { activePlayerExpeditions, expeditionArrival } from './campaign-state';
import { zoomCamera } from './camera';
import type { Camera } from './camera';
import { createMapInput } from './map-input';
import { campaignEntryEdge } from './campaign-encounter';
import type { CampaignEntryEdge } from './campaign-encounter';
import { isLastActiveBeachhead, validateCampaignEncounterSetup } from './campaign-setup';
import type { CampaignEncounterSetup } from './campaign-setup';
import type { CampaignState, EncounterPlanet } from './campaign-state';
import type { DefenseForces, InvasionForces } from './campaign-allocation';
import { createCampaignSetupWriter } from './campaign-setup-writer';

const node = function <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	element.textContent = text;
	element.className = className;
	return element;
};
const button = function (text: string, action: () => void, className = ''): HTMLButtonElement {
	const element = node('button', text, className);
	element.type = 'button';
	element.addEventListener('click', action);
	return element;
};
const amount = function (value: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: 1 }); };
type UnitKind = keyof DefenseForces;
type AllocationMode = 'invasion' | 'defense';
type Drawer = 'allocation' | 'orders' | 'menu' | 'none';
const costOf = function (forces: Readonly<InvasionForces> & Partial<Readonly<DefenseForces>>, setup: CampaignEncounterSetup): number {
	return forces.troops * setup.costs.troops + forces.ships * setup.costs.ships + (forces.guns ?? 0) * setup.costs.guns;
};

export interface CampaignSetupViewOptions {
	persist: (setup: CampaignEncounterSetup) => Promise<void>;
	launch: (setup: CampaignEncounterSetup) => Promise<void>;
	exit: () => Promise<void>;
	save?: () => Promise<void>;
}
export interface CampaignSetupView {
	root: HTMLElement;
	render: (state: CampaignState, setup: CampaignEncounterSetup) => void;
	setSaveStatus: (message: string) => void;
	flush: () => Promise<void>;
	reset: () => void;
	dispose: () => void;
}

export const createCampaignSetupView = function (options: CampaignSetupViewOptions): CampaignSetupView {
	const root = node('section', '', 'campaign-setup-view');
	root.hidden = true;
	root.setAttribute('aria-label', 'Campaign encounter setup');
	const board = node('div', '', 'csu-board');
	board.tabIndex = 0;
	board.setAttribute('aria-label', 'Encounter map. Select a planet; drag or use arrow keys to pan.');
	const world = node('div', '', 'csu-world');
	const routes = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	routes.classList.add('csu-routes');
	routes.setAttribute('aria-hidden', 'true');
	const entryLabel = node('div', '', 'csu-entry');
	const planetsLayer = node('div', '', 'csu-planets');
	world.append(routes, entryLabel, planetsLayer);
	board.append(world);
	const header = node('header', '', 'csu-hud');
	const brand = node('span', 'Galaxy Conquest', 'csu-brand');
	const score = node('div', '', 'csu-score');
	const blue = node('span', '', 'csu-blue');
	const turn = node('span', '', 'csu-turn');
	const red = node('span', '', 'csu-red');
	score.append(blue, turn, red);
	const saveStatus = node('span', 'Not saved', 'csu-save-status');
	saveStatus.setAttribute('role', 'status');
	saveStatus.setAttribute('aria-live', 'polite');
	const actions = node('div', '', 'csu-actions');
	const save = button('Save', function () { void run(async function () { await options.save?.(); status.textContent = 'Encounter saved locally'; }); }, 'csu-save');
	const orders = button('Orders', function () { openDrawer(drawer === 'orders' ? 'allocation' : 'orders'); });
	const launch = button('Launch encounter', function () { void run(async function () {
		const state = current;
		if (!state?.encounter || !draft) return;
		validateCampaignEncounterSetup(state.encounter, draft, { allowLegacyBeachheads: legacyBeachheads.size > 0 });
		await options.launch(structuredClone(draft));
	}); }, 'csu-primary');
	const menu = button('☰', function () { openDrawer(drawer === 'menu' ? 'allocation' : 'menu'); }, 'csu-menu');
	menu.setAttribute('aria-label', 'Encounter menu');
	actions.append(save, orders, launch, menu);
	header.append(brand, score, saveStatus, actions);
	const heading = node('p', '', 'csu-heading');
	const panel = node('aside', '', 'csu-panel');
	panel.id = 'campaign-setup-panel';
	panel.setAttribute('aria-label', 'Encounter allocations');
	orders.setAttribute('aria-controls', panel.id);
	menu.setAttribute('aria-controls', panel.id);
	const status = node('p', '', 'csu-status');
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	const caption = node('p', 'ENCOUNTER SETUP · GALAXY FROZEN\nDrag to pan · Scroll or pinch to zoom', 'csu-caption');
	root.append(board, header, heading, panel, status, caption);
	let current: CampaignState | undefined;
	let draft: CampaignEncounterSetup | undefined;
	let legacyBeachheads = new Set<string>();
	let encounterId: string | undefined;
	let selected: string | undefined;
	let drawer: Drawer = 'allocation';
	let entryEdge: CampaignEntryEdge = 'left';
	let pending = false;
	let disposed = false;
	let camera: Camera = { x: 0, y: 0, scale: 1 };
	let autoFit = true;
	const planetButtons = new Map<HTMLButtonElement, EncounterPlanet>();
	const planetViews = new Map<string, { button: HTMLButtonElement; troops: HTMLElement; orbit: HTMLElement; invasion: HTMLElement }>();
	let refreshControls = function (): void {};
	const showError = function (error: unknown): void {
		if (!disposed) status.textContent = error instanceof Error ? error.message : 'Could not save encounter allocation.';
	};
	let generation = 0;
	const makeWriter = function (): ReturnType<typeof createCampaignSetupWriter> {
		const sessionGeneration = generation;
		return createCampaignSetupWriter(options.persist, function (error) {
			if (disposed || sessionGeneration !== generation) return;
			if (error !== undefined) showError(error);
			else status.textContent = 'Allocation saved locally';
		});
	};
	let writer = makeWriter();
	const flush = async function (): Promise<void> {
		try {
			if (current?.encounter && draft)
				validateCampaignEncounterSetup(current.encounter, draft, { allowLegacyBeachheads: legacyBeachheads.size > 0 });
			await writer.flush();
		} catch (error) { showError(error); throw error; }
	};
	const run = async function (action: () => Promise<void>): Promise<void> {
		if (pending || disposed) return;
		pending = true;
		root.inert = true;
		status.textContent = 'Saving…';
		try { await flush(); await action(); }
		catch (error) { showError(error); }
		finally { pending = false; root.inert = false; }
	};
	const applyCamera = function (): void {
		world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
		world.style.setProperty('--csu-marker-scale', String(1 / camera.scale));
	};
	const fit = function (): void {
		const state = current;
		const system = state?.systems.find(function (item) { return item.id === state.encounter?.systemId; });
		if (!system || !autoFit || board.clientWidth === 0 || board.clientHeight === 0) return;
		const mobile = board.clientWidth < 700;
		const width = Math.max(80, board.clientWidth - (mobile ? 24 : 330));
		const height = Math.max(80, board.clientHeight - 132 - (mobile ? Math.min(430, board.clientHeight * 0.55) : 70));
		const scale = Math.min(width / system.map.width, height / system.map.height);
		camera = { scale, x: 12 + (width - system.map.width * scale) / 2, y: 132 + (height - system.map.height * scale) / 2 };
		applyCamera();
	};
	const input = createMapInput({ board, events: window,
		getPlanetId: function (target) {
			if (!(target instanceof Element)) return undefined;
			const candidate = target.closest('button');
			if (!(candidate instanceof HTMLButtonElement)) return undefined;
			const planet = planetButtons.get(candidate);
			return planet && current?.encounter?.planets.findIndex(function (item) { return item.planetId === planet.planetId; });
		},
		selectPlanet: function (index) {
			const planet = current?.encounter?.planets[index];
			if (!planet) return;
			selected = planet.planetId;
			drawer = 'allocation';
			renderPanel();
			updateMap();
		},
		dispatchPlanet: function () {},
		panBy: function (delta) {
			autoFit = false;
			camera = { ...camera, x: camera.x + delta.x, y: camera.y + delta.y };
			applyCamera();
		},
		zoomAt: function (anchor, factor) {
			autoFit = false;
			camera = zoomCamera(camera, anchor, factor, 0.05, 3);
			applyCamera();
		},
	});
	const resize = new ResizeObserver(fit);
	resize.observe(board);
	const attackSpent = function (): number {
		return draft?.beachheads.reduce(function (total, beachhead) { return total + costOf(beachhead, draftSetup()); }, 0) ?? 0;
	};
	const draftSetup = function (): CampaignEncounterSetup {
		if (!draft) throw new Error('Encounter allocation is missing');
		return draft;
	};
	const forcesFor = function (mode: AllocationMode): Readonly<DefenseForces> {
		const setup = draftSetup();
		if (mode === 'defense') return setup.defenders.find(function (item) { return item.planetId === selected; })?.forces ?? { troops: 0, ships: 0, guns: 0 };
		const forces = setup.beachheads.find(function (item) { return item.planetId === selected; });
		return { troops: forces?.troops ?? 0, ships: forces?.ships ?? 0, guns: 0 };
	};
	const remaining = function (mode: AllocationMode, planet: EncounterPlanet): number {
		return mode === 'invasion' ? (current?.encounter?.attackerPoints ?? 0) - attackSpent() : planet.points - costOf(forcesFor(mode), draftSetup());
	};
	const updateMap = function (): void {
		if (!draft || !current?.encounter) return;
		routes.replaceChildren();
		const localSystem = current.systems.find(function (system) { return system.id === current?.encounter?.systemId; });
		if (!localSystem) return;
		const active = current.encounter.attacker === 'blue'
			? draft.beachheads.filter(function (beachhead) { return beachhead.troops > 0 || beachhead.ships > 0; }) : [];
		for (const planet of current.encounter.planets) {
			const view = planetViews.get(planet.planetId);
			const forces = draft.defenders.find(function (item) { return item.planetId === planet.planetId; })?.forces;
			if (!view || !forces) continue;
			const invasion = active.find(function (item) { return item.planetId === planet.planetId; });
			const ownDefense = planet.factionId === 'blue';
			view.troops.textContent = ownDefense ? String(forces.troops) : '?';
			view.orbit.textContent = ownDefense ? `◆ ${forces.ships} · ✣ ${forces.guns}` : 'Defenses unknown';
			view.invasion.textContent = invasion ? `↳ ▥ ${invasion.troops} · ◆ ${invasion.ships}` : '';
			const defenseLabel = ownDefense
				? `${forces.troops} defending troops, ${forces.ships} ships, ${forces.guns} platforms` : 'defenses unknown';
			view.button.setAttribute('aria-label', `${planet.name}, ${planet.factionId === 'blue' ? 'your' : planet.factionId === 'red' ? 'rival' : 'neutral'} planet, ${defenseLabel}`);
			view.button.setAttribute('aria-pressed', String(selected === planet.planetId && drawer === 'allocation'));
			const beachheadIndex = active.findIndex(function (item) { return item.planetId === planet.planetId; });
			const seed = localSystem.map.planets.find(function (item) { return item[0] === planet.name; });
			if (beachheadIndex < 0 || !seed) continue;
			const fraction = (beachheadIndex + 1) / (active.length + 1);
			const x = entryEdge === 'left' ? -64 : entryEdge === 'right' ? localSystem.map.width + 64 : localSystem.map.width * fraction;
			const y = entryEdge === 'top' ? -64 : entryEdge === 'bottom' ? localSystem.map.height + 64 : localSystem.map.height * fraction;
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			line.setAttribute('x1', String(x)); line.setAttribute('y1', String(y));
			line.setAttribute('x2', String(seed[1])); line.setAttribute('y2', String(seed[2]));
			routes.append(line);
		}
		try {
			validateCampaignEncounterSetup(current.encounter, draft, { allowLegacyBeachheads: legacyBeachheads.size > 0 });
			launch.disabled = false;
		}
		catch { launch.disabled = true; }
	};
	const persist = function (): void {
		if (!draft || !current?.encounter) return;
		updateMap();
		try { validateCampaignEncounterSetup(current.encounter, draft, { allowLegacyBeachheads: legacyBeachheads.size > 0 }); }
		catch (error) { status.textContent = error instanceof Error ? error.message : 'Allocation is incomplete'; return; }
		status.textContent = 'Saving allocation…';
		writer.write(draft);
	};
	const change = function (mode: AllocationMode, kind: UnitKind, value: number, planet: EncounterPlanet): void {
		if (pending || !draft || !Number.isSafeInteger(value)) return;
		const encounter = current?.encounter;
		const targetable = planet.factionId !== null && planet.factionId !== encounter?.attacker;
		const legacy = legacyBeachheads.has(planet.planetId) && draft.beachheads.some(function (item) { return item.planetId === planet.planetId; });
		const editable = mode === 'invasion'
			? encounter?.attacker === 'blue' && (targetable || legacy)
			: planet.factionId === 'blue';
		if (!editable || (mode === 'invasion' && kind === 'guns')) return;
		const forces = forcesFor(mode);
		if (mode === 'invasion' && legacy && !targetable && value > forces[kind]) return;
		const maximum = forces[kind] + Math.floor(remaining(mode, planet) / draft.costs[kind]);
		const count = Math.max(0, Math.min(maximum, value));
		const lastLegacyBeachhead = mode === 'invasion' && legacy && !targetable && isLastActiveBeachhead(draft, planet.planetId);
		const otherForce = kind === 'troops' ? forces.ships : forces.troops;
		if (lastLegacyBeachhead && count === 0 && otherForce === 0) { refreshControls(); return; }
		if (mode === 'defense') draft = { ...draft, defenders: draft.defenders.map(function (item) {
			return item.planetId === planet.planetId ? { ...item, forces: { ...item.forces, [kind]: count } } : item;
		}) };
		else {
			const updated = { planetId: planet.planetId, troops: forces.troops, ships: forces.ships, [kind]: count };
			draft = { ...draft, beachheads: [...draft.beachheads.filter(function (item) { return item.planetId !== planet.planetId; }), updated]
				.filter(function (item) { return item.troops > 0 || item.ships > 0; }) };
		}
		refreshControls();
		persist();
	};
	const openDrawer = function (next: Drawer): void { drawer = next; renderPanel(); updateMap(); };
	const renderPanel = function (): void {
		const state = current;
		const encounter = state?.encounter;
		if (!encounter || !draft) return;
		panel.hidden = drawer === 'none';
		orders.setAttribute('aria-expanded', String(drawer === 'orders'));
		menu.setAttribute('aria-expanded', String(drawer === 'menu'));
		panel.replaceChildren();
		refreshControls = function (): void {};
		const title = node('div', '', 'csu-title');
		const titleText = node('h2');
		title.append(titleText, button('×', function () { openDrawer(drawer === 'allocation' ? 'none' : 'allocation'); }, 'csu-close'));
		const close = title.querySelector('button');
		close?.setAttribute('aria-label', 'Close panel');
		panel.append(title);
		if (drawer === 'orders') {
			titleText.textContent = 'Orders';
			panel.append(node('p', `Galaxy time ${amount(state.time)}s remains frozen`, 'csu-sub'));
			for (const expedition of activePlayerExpeditions(state)) {
				const from = state.systems.find(function (item) { return item.id === expedition.sourceSystemId; });
				const to = state.systems.find(function (item) { return item.id === expedition.destinationSystemId; });
				const row = node('div', '', 'csu-order');
				row.append(node('strong', `${from?.name ?? expedition.sourceSystemId} ${expedition.status === 'returning' ? '←' : '→'} ${to?.name ?? expedition.destinationSystemId} · ${amount(expedition.points)} points`),
					node('small', expedition.id === encounter.expeditionId ? 'Arrived · resolving now' : `${expedition.status === 'returning' ? 'Returning · arrival' : 'Arrival'} in ${amount(Math.max(0, expeditionArrival(expedition) - state.time))}s · waits for galaxy resolution`));
				panel.append(row);
			}
			panel.append(node('p', 'Later arrivals wait. Hostile arrivals start separate battles; friendly arrivals replenish points. No mid-battle reinforcements.', 'csu-rule'), button('Return to allocation', function () { openDrawer('allocation'); }, 'csu-wide'));
			return;
		}
		if (drawer === 'menu') {
			titleText.textContent = 'Game menu';
			panel.append(node('p', `Encounter setup · galaxy time ${amount(state.time)}s frozen`, 'csu-sub'), button('Return to allocation', function () { openDrawer('allocation'); }, 'csu-wide'));
			if (options.save) panel.append(button('Save campaign', function () { void run(async function () { await options.save?.(); status.textContent = 'Encounter saved locally'; }); }, 'csu-wide'));
			panel.append(button('Save & menu', function () { void run(options.exit); }, 'csu-wide'), node('p', 'Saving preserves this allocation. Continue returns to encounter setup.', 'csu-rule'));
			return;
		}
		const planet = encounter.planets.find(function (item) { return item.planetId === selected; });
		if (!planet) return;
		const hasOpposingOwnedPlanet = encounter.planets.some(function (item) {
			return item.factionId !== null && item.factionId !== encounter.attacker;
		});
		titleText.textContent = planet.name;
		const updates: Array<() => void> = [];
		const addAllocation = function (mode: AllocationMode): void {
			const targetable = planet.factionId !== null && planet.factionId !== encounter.attacker;
			const legacy = legacyBeachheads.has(planet.planetId) && draftSetup().beachheads.some(function (item) { return item.planetId === planet.planetId; });
			const lastLegacyBeachhead = mode === 'invasion' && legacy && !targetable && isLastActiveBeachhead(draftSetup(), planet.planetId);
			const editable = mode === 'invasion'
				? encounter.attacker === 'blue' && (targetable || legacy)
				: planet.factionId === 'blue';
			if (!editable) {
				const message = mode !== 'invasion' ? 'Defending forces are hidden until battle starts.'
					: encounter.attacker !== 'blue' ? 'Rival invasion forces and beachheads are hidden until battle starts.'
					: 'Beachheads must target planets owned by the opposing faction.';
				panel.append(node('p', message, 'csu-rule'));
				return;
			}
			const section = node('section', '', 'csu-allocation-section');
			section.append(node('p', mode === 'invasion' ? 'Your invasion beachhead · shared expedition budget' : 'Your planetary defense · local budget', 'csu-sub'));
			if (mode === 'invasion' && legacy && !targetable) section.append(node('p', lastLegacyBeachhead
				? hasOpposingOwnedPlanet ? 'Assign forces to an opposing-owned planet before removing this saved beachhead.'
					: 'This saved beachhead must keep at least one force because no opposing-owned planet is available.'
				: 'This saved beachhead can be reduced to remove it.', 'csu-rule'));
			const budget = node('p', '', 'csu-budget');
			section.append(budget);
			const kinds: readonly UnitKind[] = mode === 'invasion' ? ['troops', 'ships'] : ['troops', 'ships', 'guns'];
			for (const kind of kinds) {
				const row = node('div', '', 'csu-unit');
				const label = node('label', `${kind === 'troops' ? '▥ Troops' : kind === 'ships' ? '◆ Ships' : '✣ Platforms'} · ${draftSetup().costs[kind]} pt each`);
				const output = node('output');
				const controls = node('div', '', 'csu-unit-controls');
				const range = node('input');
				range.type = 'range'; range.min = '0'; range.step = '1';
				range.id = `campaign-setup-${mode}-${kind}`;
				label.htmlFor = range.id;
				range.setAttribute('aria-label', `${planet.name} ${mode} ${kind}`);
				output.htmlFor = range.id;
				const minus = button('−', function () { change(mode, kind, forcesFor(mode)[kind] - 1, planet); });
				const plus = button('+', function () { change(mode, kind, forcesFor(mode)[kind] + 1, planet); });
				minus.setAttribute('aria-label', `Decrease ${mode} ${kind} by one`);
				plus.setAttribute('aria-label', `Increase ${mode} ${kind} by one`);
				range.addEventListener('input', function () { change(mode, kind, range.valueAsNumber, planet); });
				controls.append(minus, range, plus);
				const labelRow = node('div', '', 'csu-unit-label'); labelRow.append(label, output);
				row.append(labelRow, controls); section.append(row);
				updates.push(function () {
					const forces = forcesFor(mode);
					const left = remaining(mode, planet);
					const otherKind = kind === 'troops' ? 'ships' : 'troops';
					const minimum = mode === 'invasion' && lastLegacyBeachhead && forces[otherKind] === 0 ? 1 : 0;
					range.max = String(Math.max(forces[kind], forces[kind] + Math.floor(left / draftSetup().costs[kind])));
					range.min = String(minimum);
					range.value = String(forces[kind]);
					output.value = String(forces[kind]);
					minus.disabled = forces[kind] <= minimum;
					plus.disabled = left < draftSetup().costs[kind] || (mode === 'invasion' && legacy && !targetable);
				});
			}
			updates.push(function () {
				const total = mode === 'invasion' ? encounter.attackerPoints : planet.points;
				const spent = mode === 'invasion' ? attackSpent() : costOf(forcesFor(mode), draftSetup());
				budget.textContent = `${amount(spent)} / ${amount(total)} points allocated · ${amount(total - spent)} unassigned${mode === 'invasion' ? ' across all beachheads' : ` on ${planet.name}`}`;
			});
			panel.append(section);
		};
		if (encounter.attacker === 'blue') { addAllocation('invasion'); addAllocation('defense'); }
		else { addAllocation('defense'); addAllocation('invasion'); }
		const consequence = node('p', '', 'csu-rule');
		panel.append(consequence);
		updates.push(function () {
			const setup = draftSetup();
			const left = encounter.attackerPoints - attackSpent();
			const troops = setup.beachheads.reduce(function (total, beachhead) { return total + beachhead.troops; }, 0);
			consequence.textContent = encounter.attacker === 'blue'
				? troops === 0 ? 'No invasion troops allocated. Ships alone cannot capture planets.'
					: left > 0 ? `${amount(left)} unassigned expedition points will be lost on launch.` : 'All expedition points assigned. Troops enter in transports; normal production continues in battle.'
				: 'Each planet funds its own starting forces. Unassigned points produce no starting units.';
		});
		refreshControls = function (): void { for (const update of updates) update(); };
		refreshControls();
	};
	const render = function (state: CampaignState, setup: CampaignEncounterSetup): void {
		const encounter = state.encounter;
		if (!encounter) { input.cancel(); root.hidden = true; return; }
		current = state;
		root.hidden = false;
		if (encounterId !== encounter.id) {
			encounterId = encounter.id;
			draft = structuredClone(setup);
			const targetable = new Set(encounter.planets.filter(function (planet) {
				return planet.factionId !== null && planet.factionId !== encounter.attacker;
			}).map(function (planet) { return planet.planetId; }));
			legacyBeachheads = new Set(setup.beachheads.filter(function (beachhead) {
				return !targetable.has(beachhead.planetId);
			}).map(function (beachhead) { return beachhead.planetId; }));
			selected = encounter.planets[0]?.planetId;
			drawer = 'allocation';
			autoFit = true;
			status.textContent = '';
			generation++;
			writer = makeWriter();
			const system = state.systems.find(function (item) { return item.id === encounter.systemId; });
			const expedition = state.expeditions.find(function (item) { return item.id === encounter.expeditionId; });
			const source = state.systems.find(function (item) { return item.id === expedition?.sourceSystemId; });
			if (!system || !source) throw new Error('Encounter system is missing');
			entryEdge = campaignEntryEdge(source, system);
			root.dataset.attacker = encounter.attacker;
			world.style.width = `${system.map.width}px`; world.style.height = `${system.map.height}px`;
			routes.setAttribute('viewBox', `0 0 ${system.map.width} ${system.map.height}`);
			entryLabel.textContent = `COMMON ${entryEdge.toUpperCase()}\nENTRY EDGE`;
			entryLabel.dataset.edge = entryEdge;
			planetButtons.clear(); planetViews.clear(); planetsLayer.replaceChildren();
			for (const planet of encounter.planets) {
				const seed = system.map.planets.find(function (item) { return item[0] === planet.name; });
				if (!seed) throw new Error('Encounter planet geometry is missing');
				const marker = node('button', '', 'csu-planet'); marker.type = 'button';
				marker.style.left = `${seed[1]}px`; marker.style.top = `${seed[2]}px`;
				marker.style.setProperty('--owner', planet.factionId === 'blue' ? '#60d9ff' : planet.factionId === 'red' ? '#ff867e' : '#8e9cae');
				const orbit = node('span', '', 'csu-orbit');
				const troops = node('span', '', 'csu-troops');
				const invasion = node('span', '', 'csu-beachhead');
				marker.append(node('span', '', 'csu-surface'), orbit, troops, node('span', 'troops', 'csu-word'), node('span', planet.name, 'csu-planet-name'), invasion);
				planetButtons.set(marker, planet); planetViews.set(planet.planetId, { button: marker, troops, orbit, invasion });
				planetsLayer.append(marker);
			}
		}
		const system = state.systems.find(function (item) { return item.id === encounter.systemId; });
		heading.textContent = `${system?.name ?? encounter.systemId} · ${encounter.attacker === 'blue' ? 'Your expedition has arrived' : 'Rival invasion incoming'} · Select a planet to allocate starting forces`;
		blue.textContent = `● ${encounter.planets.filter(function (planet) { return planet.factionId === 'blue'; }).length} YOU`;
		red.textContent = `● ${encounter.planets.filter(function (planet) { return planet.factionId === 'red'; }).length} RIVAL`;
		turn.textContent = `Galaxy ${amount(state.time)}s · Frozen`;
		orders.textContent = `Orders · ${activePlayerExpeditions(state).length}`;
		renderPanel(); updateMap(); fit();
	};
	const reset = function (): void {
		input.cancel();
		generation++;
		writer = makeWriter();
		current = undefined;
		draft = undefined;
		legacyBeachheads.clear();
		encounterId = undefined;
		selected = undefined;
		drawer = 'allocation';
		entryEdge = 'left';
		refreshControls = function (): void {};
		camera = { x: 0, y: 0, scale: 1 };
		autoFit = true;
		planetButtons.clear();
		planetViews.clear();
		planetsLayer.replaceChildren();
		routes.replaceChildren();
		panel.replaceChildren();
		status.textContent = '';
		root.hidden = true;
		applyCamera();
	};
	const setSaveStatus = function (message: string): void {
		const failed = /save failed|saving failed/i.test(message);
		saveStatus.textContent = message;
		saveStatus.title = message;
		saveStatus.dataset.state = failed ? 'error' : message === 'Saving…' ? 'saving' : 'saved';
	};
	return { root, render, setSaveStatus, flush, reset, dispose: function (): void { disposed = true; resize.disconnect(); input.dispose(); root.remove(); } };
};
