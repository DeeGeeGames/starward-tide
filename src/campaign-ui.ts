import { isActiveExpedition, expeditionArrival, canCancelExpedition, neutralClaimMinimum } from './campaign-state';
import type { CampaignState, ExpeditionOrder } from './campaign-state';
import type { CampaignEncounterSetup } from './campaign-setup';
import { availablePoints } from './campaign-points';
import { developmentMaximum } from './campaign-development';
import { campaignWinner } from './campaign-scenario';
import { campaignLayout } from './campaign-layout';
import { createMapInput } from './map-input';
import { createCampaignSetupView } from './campaign-setup-view';
import type { CampaignTransitionReport } from './campaign-report';

const node = function <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = text;
	if (className) element.className = className;
	return element;
};
const amount = function (value: number): string { return value.toLocaleString(undefined, { maximumFractionDigits: 1 }); };
const button = function (text: string, action: () => void, className?: string): HTMLButtonElement {
	const element = node('button', text, className); element.type = 'button'; element.addEventListener('click', action); return element;
};
const svg = function <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
	const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
	return element;
};
const factionLabel = function (owner: 'blue' | 'red' | null): string { return owner === 'blue' ? 'YOU' : owner === 'red' ? 'RIVAL' : 'UNCLAIMED'; };

export const createCampaignView = function (options: {
	order: (order: Omit<ExpeditionOrder, 'id' | 'factionId'>) => Promise<void>;
	cancelOrder: (id: string) => Promise<void>;
	endTurn: () => Promise<void>;
	setup: (setup: CampaignEncounterSetup) => Promise<void>;
	launch: (setup: CampaignEncounterSetup) => Promise<void>;
	exit: () => Promise<void>;
	save?: () => Promise<void>;
}): {
	root: HTMLElement;
	render: (state: CampaignState, setup: CampaignEncounterSetup | undefined) => void;
	showSystem: (systemId: string) => void;
	prepareEncounter: () => void;
	showReport: (report: CampaignTransitionReport) => void;
	reset: () => void;
	dispose: () => void;
} {
	const root = node('main', undefined, 'campaign-shell'); root.id = 'campaign'; root.hidden = true;
	root.addEventListener('contextmenu', function (event) { event.preventDefault(); });
	const galaxy = node('section', undefined, 'campaign-galaxy-view');
	const space = node('div', undefined, 'campaign-space'); space.tabIndex = 0; space.setAttribute('aria-label', 'Galaxy map. Drag to pan, scroll or pinch to zoom.');
	const world = node('div', undefined, 'campaign-world');
	space.append(world);
	const header = node('header', undefined, 'campaign-header');
	const hint = node('p', 'Tap to inspect · Hold or right-click another system to send', 'campaign-hint');
	const panel = node('aside', undefined, 'campaign-context'); panel.setAttribute('aria-label', 'System commands');
	const status = node('p', '', 'campaign-notice'); status.setAttribute('role', 'status'); status.hidden = true;
	const caption = node('p', 'GALAXY\nDrag to pan · Scroll to zoom', 'campaign-map-caption');
	galaxy.append(space, header, hint, panel, caption);
	const setupView = createCampaignSetupView({ persist: options.setup, launch: options.launch, exit: options.exit, ...(options.save ? { save: options.save } : {}) });
	root.append(galaxy, setupView.root, status); document.body.append(root);
	let state: CampaignState | undefined;
	let selectedSystem: string | undefined;
	let sourceSystem: string | undefined;
	let context: 'system' | 'orders' | 'menu' | 'report' | 'none' = 'system';
	let report: CampaignTransitionReport | undefined;
	let pending = false;
	let disposed = false;
	const drafts = new Map<string, Map<string, number>>();
	let camera = { x: 0, y: 0, scale: 1 };
	const transform = function (): void {
		world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
		const minimumMarkerScale = space.clientWidth <= 600 ? 0.4 : 0.65;
		world.style.setProperty('--marker-scale', String(Math.max(minimumMarkerScale, Math.min(1, camera.scale)) / camera.scale));
		world.classList.toggle('campaign-dense', camera.scale < 0.3);
		world.classList.toggle('campaign-overview', camera.scale < 0.65);
	};
	const notify = function (message: string): void { status.textContent = message; status.hidden = !message; };
	const localPlanets = function (systemId: string): CampaignState['planets'] {
		return state?.planets.filter(function (planet) { return planet.systemId === systemId; }) ?? [];
	};
	const draftFor = function (systemId: string): Map<string, number> {
		let draft = drafts.get(systemId);
		if (!draft) { draft = new Map(); drafts.set(systemId, draft); }
		for (const planet of localPlanets(systemId)) {
			if (planet.factionId !== 'blue' || planet.capturedTurn === state?.turn) { draft.delete(planet.id); continue; }
			const maximum = Math.floor(availablePoints(developmentMaximum(planet), planet.depletion));
			draft.set(planet.id, Math.min(maximum, draft.get(planet.id) ?? Math.min(10, maximum)));
		}
		return draft;
	};
	const run = async function (action: () => Promise<void>, success?: () => void): Promise<void> {
		if (pending || disposed) return;
		pending = true; root.inert = true;
		try {
			if (state?.encounter) await setupView.flush();
			await action();
			if (!disposed) { success?.(); notify('Saved locally · campaign slot'); renderGalaxy(); }
		} catch (error) { if (!disposed) notify(error instanceof Error ? error.message : 'Campaign action failed.'); }
		finally { pending = false; root.inert = false; }
	};
	const selectSystem = function (id: string): void {
		if (!state?.systems.some(function (system) { return system.id === id; })) return;
		selectedSystem = id;
		if (localPlanets(id).some(function (planet) { return planet.factionId === 'blue'; })) sourceSystem = id;
		context = 'system'; renderGalaxy();
	};
	const sendTo = function (id: string): void {
		if (!state || pending || state.phase !== 'planning' || state.readyFactions.includes('blue') || campaignWinner(state)) return;
		const source = state.systems.find(function (system) { return system.id === sourceSystem; });
		const destination = state.systems.find(function (system) { return system.id === id; });
		if (!source || !destination || source.id === id) { notify('Select a funding system, then send to another system.'); return; }
		const contributions = [...draftFor(source.id)].filter(function ([, points]) { return points > 0; })
			.map(function ([planetId, points]) { return { planetId, points }; });
		const total = contributions.reduce(function (sum, contribution) { return sum + contribution.points; }, 0);
		const target = localPlanets(id);
		const minimum = target.length > 0 && target.every(function (planet) { return planet.factionId === null; }) ? neutralClaimMinimum(state, id) : 1;
		if (total < minimum) { notify(`${destination.name} requires at least ${amount(minimum)} points. No points spent.`); return; }
		const sourceId = source.id;
		void run(function () { return options.order({ sourceSystemId: sourceId, destinationSystemId: id, contributions }); }, function () {
			const draft = drafts.get(sourceId); if (draft) for (const planetId of draft.keys()) draft.set(planetId, 0);
		});
	};
	const input = createMapInput({ board: space, events: window,
		getPlanetId: function (target) {
			if (!(target instanceof Element)) return undefined;
			const identity = target.closest('[data-system-index]')?.getAttribute('data-system-index');
			if (identity === null || identity === undefined) return undefined;
			const index = Number(identity); return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
		},
		selectPlanet: function (index) { const system = state?.systems[index]; if (system) selectSystem(system.id); },
		dispatchPlanet: function (index) { const system = state?.systems[index]; if (system) sendTo(system.id); },
		panBy: function (delta) { camera = { ...camera, x: camera.x + delta.x, y: camera.y + delta.y }; transform(); },
		zoomAt: function (anchor, factor) {
			const scale = Math.max(0.08, Math.min(2.5, camera.scale * factor));
			const ratio = scale / camera.scale;
			camera = { x: camera.x + (anchor.x - world.offsetLeft - camera.x) * (1 - ratio),
				y: camera.y + (anchor.y - world.offsetTop - camera.y) * (1 - ratio), scale }; transform();
		},
	});
	const heading = function (title: string): void {
		const row = node('div', undefined, 'campaign-context-title');
		const close = button('×', function () { context = 'none'; renderGalaxy(); }, 'campaign-close'); close.setAttribute('aria-label', 'Close panel');
		row.append(node('h2', title), close); panel.append(row);
	};
	const renderSystem = function (): void {
		if (!state) return;
		const system = state.systems.find(function (item) { return item.id === selectedSystem; }); if (!system) return;
		const local = localPlanets(system.id);
		const owned = local.filter(function (planet) { return planet.factionId === 'blue'; });
		const capturedThisTurn = local.some(function (planet) { return planet.capturedTurn === state?.turn; });
		const canOrder = state.phase === 'planning' && !capturedThisTurn && !state.readyFactions.includes('blue') && !campaignWinner(state);
		const unclaimed = local.every(function (planet) { return planet.factionId === null; });
		heading(system.name);
		const available = local.reduce(function (sum, planet) { return sum + availablePoints(developmentMaximum(planet), planet.depletion); }, 0);
		panel.append(node('p', `${local.length} planets · ${amount(available)} points available`, 'campaign-muted'));
		if (capturedThisTurn) panel.append(node('p', 'Conquered systems can issue orders next galaxy turn.', 'campaign-rule'));
		if (owned.length) {
			const draft = draftFor(system.id);
			const presets = node('div', undefined, 'campaign-presets');
			for (const percent of [25, 50, 100]) {
				const preset = button(`${percent}%`, function () {
				for (const planet of owned) draft.set(planet.id, Math.floor(availablePoints(developmentMaximum(planet), planet.depletion) * percent / 100));
				renderGalaxy();
				});
				preset.disabled = !canOrder; presets.append(preset);
			}
			panel.append(node('p', 'SEND AMOUNT · SOURCE POINTS', 'campaign-label'), presets,
				node('p', 'Hold or right-click another system to send immediately. Unclaimed systems require their listed minimum.', 'campaign-rule'));
			const details = node('details', undefined, 'campaign-contributions'); details.open = window.matchMedia('(min-width: 601px)').matches;
			details.append(node('summary', 'Planet contributions · send / available'));
			const summary = node('p', '', 'campaign-budget');
			const updateSummary = function (): void {
				const total = [...draft.values()].reduce(function (sum, value) { return sum + value; }, 0);
				const ownAvailable = owned.reduce(function (sum, planet) { return sum + availablePoints(developmentMaximum(planet), planet.depletion); }, 0);
				summary.textContent = `${amount(total)} points to send · ${amount(ownAvailable - total)} defense points remain`;
			};
			for (const planet of owned) {
				const maximum = Math.floor(availablePoints(developmentMaximum(planet), planet.depletion));
				const row = node('section', undefined, 'campaign-allocation-row');
				const label = node('label', planet.name); const field = node('input'); field.type = 'range'; field.min = '0'; field.max = String(maximum); field.step = '1';
				field.disabled = !canOrder;
				field.id = `campaign-contribution-${planet.id}`; label.htmlFor = field.id; field.setAttribute('aria-label', `${planet.name} contribution`);
				const output = node('output'); output.htmlFor = field.id;
				const rowTitle = node('div', undefined, 'campaign-allocation-label'); rowTitle.append(label, output);
				const minus = button('−', function () { change((draft.get(planet.id) ?? 0) - 1); });
				const plus = button('+', function () { change((draft.get(planet.id) ?? 0) + 1); });
				minus.setAttribute('aria-label', `Decrease ${planet.name} allocation by one point`); plus.setAttribute('aria-label', `Increase ${planet.name} allocation by one point`);
				const change = function (value: number): void {
					draft.set(planet.id, Math.max(0, Math.min(maximum, value))); field.value = String(draft.get(planet.id) ?? 0);
					output.textContent = `${field.value} / ${amount(availablePoints(developmentMaximum(planet), planet.depletion))}`;
					minus.disabled = !canOrder || Number(field.value) <= 0; plus.disabled = !canOrder || Number(field.value) >= maximum; updateSummary();
				};
				field.addEventListener('input', function () { change(field.valueAsNumber); });
				const controls = node('div', undefined, 'campaign-allocation-controls'); controls.append(minus, field, plus); row.append(rowTitle, controls); details.append(row); change(draft.get(planet.id) ?? 0);
			}
			panel.append(details, summary);
		}
		if (local.some(function (planet) { return planet.factionId === 'blue' && planet.capturedTurn === state?.turn; })) panel.append(node('p', 'Newly conquered planets can fund expeditions next turn.', 'campaign-rule'));
		for (const planet of local.filter(function (item) { return item.factionId !== 'blue' || item.capturedTurn === state?.turn; })) {
			const row = node('div', undefined, 'campaign-planet-row'); row.append(node('span', `${planet.name} · ${factionLabel(planet.factionId)}`),
				node('span', `${amount(availablePoints(developmentMaximum(planet), planet.depletion))} / ${amount(developmentMaximum(planet))}`)); panel.append(row);
		}
		const development = node('details', undefined, 'campaign-development'); development.append(node('summary', 'Development & recovery'),
			node('p', `Each completed held turn: +${amount(state.rules.development.growthFraction * 100)}% baseline capacity, capped at +${amount(state.rules.development.capFraction * 100)}%; then ${amount(state.rules.recovery.fractionOfMaximum * 100)}% recovery. Captures remove ${amount(state.rules.development.captureLossFraction * 100)}% of development. Depletion persists.`)); panel.append(development);
		if (unclaimed) panel.append(node('p', `Minimum ${amount(neutralClaimMinimum(state, system.id))} points. First qualifying arrival claims all ${local.length} planets without battle; committed points remain spent.`, 'campaign-rule'));
		else if (!owned.length) panel.append(node('p', 'Hostile arrivals start separate real-time encounters. The galaxy waits until each battle resolves.', 'campaign-rule'));
		if (sourceSystem && sourceSystem !== system.id) panel.append(node('p', `Hold or right-click here to send from ${state.systems.find(function (item) { return item.id === sourceSystem; })?.name ?? sourceSystem}.`, 'campaign-rule'));
	};
	let encounterSetup: CampaignEncounterSetup | undefined;
	let preparedEncounter: string | undefined;
	let fitPending = true;
	const fit = function (): void {
		if (!fitPending || galaxy.hidden || space.clientWidth === 0 || space.clientHeight === 0) return;
		const mobile = space.clientWidth <= 600;
		const width = Math.max(200, space.clientWidth - (mobile ? 0 : 300));
		const height = Math.max(220, space.clientHeight - (mobile ? 480 : 140));
		const { width: worldWidth, height: worldHeight } = galaxyBounds();
		const scale = Math.min(width / worldWidth, height / worldHeight, 1.3);
		camera = { x: (width - worldWidth * scale) / 2, y: 100 + (height - worldHeight * scale) / 2, scale };
		fitPending = false; transform();
	};
	const galaxyBounds = function (): ReturnType<typeof campaignLayout> {
		return campaignLayout(state?.systems ?? []);
	};
	const position = function (system: CampaignState['systems'][number]): { x: number; y: number } {
		const { minX, minY, scale } = galaxyBounds();
		return { x: 220 + (system.x - minX) * scale, y: 120 + (system.y - minY) * scale };
	};
	const renderOrders = function (): void {
		if (!state) return;
		heading('Orders');
		const active = state.expeditions.filter(isActiveExpedition);
		panel.append(node('p', `${active.length} active expeditions${state.phase === 'encounter' ? ' · galaxy frozen' : ''}`, 'campaign-muted'));
		if (!active.length) panel.append(node('p', 'No active expeditions. Select one of your systems to choose contributions.', 'campaign-rule'));
		for (const expedition of active) {
			const source = state.systems.find(function (item) { return item.id === expedition.sourceSystemId; });
			const destination = state.systems.find(function (item) { return item.id === expedition.destinationSystemId; });
			const row = node('section', undefined, 'campaign-order');
			row.append(node('strong', `${source?.name ?? expedition.sourceSystemId} ${expedition.status === 'returning' ? '←' : '→'} ${destination?.name ?? expedition.destinationSystemId}`),
				node('p', `${factionLabel(expedition.factionId)} · ${amount(expedition.points)} points · ${expedition.status === 'encounter' ? 'Arrived · resolving now' : `${expedition.status === 'returning' ? 'Returning · arrival' : 'arrival'} turn ${Math.ceil(expeditionArrival(expedition))}`}`, 'campaign-muted'),
				button(expedition.status === 'returning' ? 'Show source' : 'Show destination', function () { selectSystem(expedition.status === 'returning' ? expedition.sourceSystemId : expedition.destinationSystemId); }, 'campaign-wide'));
			if (expedition.factionId === 'blue') {
				const cancel = button(expedition.status === 'returning' ? 'Returning' : expedition.departureTurn === state.turn ? 'Cancel launch' : '↶ Recall', function () {
					void run(function () { return options.cancelOrder(expedition.id); });
				}, 'campaign-wide');
				cancel.disabled = !canCancelExpedition(state, expedition, 'blue') || Boolean(campaignWinner(state));
				cancel.setAttribute('aria-label', `${cancel.textContent}: ${source?.name ?? expedition.sourceSystemId} → ${destination?.name ?? expedition.destinationSystemId}`);
				row.append(cancel);
			}
			panel.append(row);
		}
		panel.append(node('p', 'Cancel this turn’s launch to refund its source points. Recall traveling expeditions to return points to their contributing planets after the elapsed outbound travel time. Only planets you still own are replenished; surplus is lost.', 'campaign-rule'));
		if (state.encounter) panel.append(button('Prepare encounter', prepare, 'campaign-wide campaign-primary'));
	};
	const prepare = function (): void {
		if (!state?.encounter || !encounterSetup) return;
		preparedEncounter = state.encounter.id;
		input.cancel(); galaxy.hidden = true; setupView.root.hidden = false;
		setupView.render(state, encounterSetup); notify('');
	};
	const renderReport = function (): void {
		if (!state || !report) return;
		const winner = campaignWinner(state);
		heading(report.outcome ? 'Battle resolved' : report.turnCompleted ? `Turn ${report.toTurn}` : 'Galaxy resolution');
		panel.append(node('p', state.encounter ? 'Galaxy frozen · another encounter is ready' : winner ?
			winner === 'blue' ? 'Campaign won · the rival has no planets or unresolved expeditions' : 'Campaign lost · your planets and expeditions are gone' :
			'Resolution complete · galaxy orders are available', 'campaign-muted'));
		if (report.outcome) panel.append(node('p', `${report.outcome.systemName} · ${report.outcome.winner === 'blue' ? 'Your victory' : 'Rival victory'}`, 'campaign-budget'));
		for (const resolved of report.resolvedExpeditions) {
			const system = state.systems.find(function (item) { return item.id === resolved.systemId; });
			const description = resolved.kind === 'return' ? 'returned to' : resolved.kind === 'claim' ? 'claimed' : resolved.kind === 'friendly' ? 'replenished' : resolved.kind === 'encounter' ? 'battle resolved at' : 'arrived at';
			panel.append(node('p', `${factionLabel(resolved.factionId)} ${description} ${system?.name ?? resolved.systemId} · ${amount(resolved.points)} committed points`, 'campaign-rule'));
		}
		const changes = report.planets.filter(function (change) {
			return change.before.factionId !== change.after.factionId || change.before.maximumPoints !== change.after.maximumPoints || change.before.availablePoints !== change.after.availablePoints;
		});
		for (const change of changes) {
			const row = node('section', undefined, 'campaign-order');
			row.append(node('strong', change.after.name), node('p', `${factionLabel(change.before.factionId)} → ${factionLabel(change.after.factionId)} · available ${amount(change.before.availablePoints)} → ${amount(change.after.availablePoints)} · capacity ${amount(change.before.maximumPoints)} → ${amount(change.after.maximumPoints)}`, 'campaign-rule'));
			panel.append(row);
		}
		if (state.encounter) panel.append(node('p', 'Later arrivals wait. No orders or turn recovery happen during combat.', 'campaign-rule'), button('Prepare encounter', prepare, 'campaign-wide campaign-primary'));
		else panel.append(button('Return to system', function () { context = 'system'; renderGalaxy(); }, 'campaign-wide'));
	};
	const renderGalaxy = function (): void {
		if (!state || disposed) return;
		header.replaceChildren(); world.replaceChildren(); panel.replaceChildren();
		const brand = node('span', 'Galaxy Conquest', 'campaign-brand');
		const score = node('div', undefined, 'campaign-score');
		score.append(node('span', `● ${state.planets.filter(function (planet) { return planet.factionId === 'blue'; }).length} YOU`, 'campaign-blue'),
			node('span', `Turn ${state.turn}${state.encounter ? ' · Frozen' : ''}`, 'campaign-turn'),
			node('span', `● ${state.planets.filter(function (planet) { return planet.factionId === 'red'; }).length} RIVAL`, 'campaign-red'));
		const actions = node('div', undefined, 'campaign-actions');
		if (options.save) actions.append(button('Save', function () { void run(async function () { await options.save?.(); }); }, 'campaign-save'));
		const orders = button(`Orders · ${state.expeditions.filter(isActiveExpedition).length}`, function () { context = context === 'orders' ? 'system' : 'orders'; renderGalaxy(); });
		orders.setAttribute('aria-expanded', String(context === 'orders'));
		const end = button(state.encounter ? 'Prepare encounter' : 'End turn', function () { if (state?.encounter) prepare(); else void run(options.endTurn); }, 'campaign-primary');
		end.disabled = !state.encounter && (state.phase !== 'planning' || state.readyFactions.includes('blue') || Boolean(campaignWinner(state)));
		const menu = button('☰', function () { context = context === 'menu' ? 'system' : 'menu'; renderGalaxy(); }, 'campaign-menu'); menu.setAttribute('aria-label', 'Campaign menu'); menu.setAttribute('aria-expanded', String(context === 'menu'));
		actions.append(orders, end, menu); header.append(brand, score, actions);
		const bounds = galaxyBounds();
		world.style.width = `${bounds.width}px`;
		world.style.height = `${bounds.height}px`;
		const routes = svg('svg', { viewBox: `0 0 ${bounds.width} ${bounds.height}`, 'aria-hidden': 'true', class: 'campaign-routes' });
		for (const expedition of state.expeditions.filter(isActiveExpedition)) {
			const source = state.systems.find(function (item) { return item.id === expedition.sourceSystemId; });
			const destination = state.systems.find(function (item) { return item.id === expedition.destinationSystemId; });
			if (!source || !destination) continue;
			const a = position(source); const b = position(destination);
			const line = svg('line', { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y), stroke: expedition.factionId === 'blue' ? '#60d9ff' : '#ff867e' });
			const label = svg('text', { x: String((a.x + b.x) / 2 + 12), y: String((a.y + b.y) / 2 - 12) }); label.textContent = `${expedition.status === 'returning' ? '↶ ' : ''}${amount(expedition.points)}`; routes.append(line, label);
		}
		world.append(routes);
		for (const [index, system] of state.systems.entries()) {
			const planets = localPlanets(system.id); const owners = new Set(planets.map(function (planet) { return planet.factionId; }));
			const owner = owners.size === 1 ? planets[0]?.factionId : undefined;
			const points = planets.reduce(function (sum, planet) { return sum + availablePoints(developmentMaximum(planet), planet.depletion); }, 0);
			const marker = node('button', undefined, `campaign-system${selectedSystem === system.id && context === 'system' ? ' selected' : ''}`); marker.type = 'button'; marker.dataset.systemIndex = String(index);
			const location = position(system); marker.style.left = `${location.x}px`; marker.style.top = `${location.y}px`;
			marker.style.setProperty('--owner', owner === 'blue' ? '#60d9ff' : owner === 'red' ? '#ff867e' : owner === null ? '#8e9cae' : '#cbbcf1');
			const minimum = owner === null ? neutralClaimMinimum(state, system.id) : undefined;
			const source = state.systems.find(function (item) { return item.id === sourceSystem; });
			const travel = source ? Math.ceil(Math.max(1, Math.hypot(system.x - source.x, system.y - source.y) / state.rules.travelSpeed)) : undefined;
			marker.title = `${system.name} · ${minimum !== undefined ? `Claim minimum ${amount(minimum)} points` : owner === undefined ? 'Mixed ownership' : factionLabel(owner)}${travel !== undefined && source?.id !== system.id ? ` · ${travel} turn travel` : ''}`;
			marker.setAttribute('aria-label', `${system.name}, ${owner === undefined ? 'mixed ownership' : factionLabel(owner)}, ${amount(points)} points${minimum !== undefined ? `, minimum claim ${amount(minimum)} points` : ''}`);
			const art = svg('svg', { viewBox: '0 0 100 80', class: 'campaign-system-art', 'aria-hidden': 'true' });
			for (const radius of [21, 34, 46]) art.append(svg('ellipse', { cx: '50', cy: '40', rx: String(radius), ry: String(radius * .55), transform: 'rotate(-25 50 40)', class: 'campaign-orbit' }));
			art.append(svg('circle', { cx: '50', cy: '40', r: '19', class: 'campaign-star-halo' }), svg('path', { d: 'M50 23V57M33 40H67M39 29L61 51M39 51L61 29', class: 'campaign-star-ray' }), svg('circle', { cx: '50', cy: '40', r: '6', class: 'campaign-star-core' }));
			for (const [planetIndex, planet] of planets.entries()) {
				const angle = planetIndex * 2.4; const radius = 20 + planetIndex * 10;
				art.append(svg('circle', { cx: String(50 + Math.cos(angle) * radius), cy: String(40 + Math.sin(angle) * radius * .6), r: '3.5', fill: planet.factionId === 'blue' ? '#60d9ff' : planet.factionId === 'red' ? '#ff867e' : '#8e9cae', class: 'campaign-world-dot' }));
			}
			const copy = node('span', undefined, 'campaign-system-copy'); copy.append(node('strong', system.name), node('span', `${amount(points)} points`, 'campaign-system-points'), node('small', minimum !== undefined ? `UNCLAIMED · min ${amount(minimum)} points` : `${owner === undefined ? 'MIXED' : factionLabel(owner)} · ${planets.length} planets`)); marker.append(art, copy); world.append(marker);
		}
		panel.hidden = context === 'none';
		if (context === 'system') renderSystem();
		if (context === 'orders') renderOrders();
		if (context === 'report') renderReport();
		if (context === 'menu') {
			heading('Game menu'); panel.append(node('p', 'Campaign preview · saved locally in a separate campaign slot', 'campaign-muted'),
				button('Return to galaxy', function () { context = 'system'; renderGalaxy(); }, 'campaign-wide'));
			if (options.save) panel.append(button('Save campaign', function () { void run(async function () { await options.save?.(); }); }, 'campaign-wide'));
			if (report) panel.append(button('Last resolution', function () { context = 'report'; renderGalaxy(); }, 'campaign-wide'));
			if (state.encounter) panel.append(button('Prepare encounter', prepare, 'campaign-wide campaign-primary'));
			panel.append(button('Save & menu', function () { void run(options.exit); }, 'campaign-wide'), node('p', 'Select a funding system. Adjust contributions, then hold or right-click a destination. End turn resolves committed expeditions for both factions.', 'campaign-rule'));
		}
		const winner = campaignWinner(state);
		hint.textContent = winner ? `${winner === 'blue' ? 'Campaign victory' : 'Campaign defeat'} · Open the menu to return` : state.encounter ? 'Galaxy frozen · Prepare the next encounter to continue' : 'Tap to inspect · Hold or right-click another system to send';
		caption.textContent = `GALAXY · ${state.systems.length} SYSTEMS\nDrag to pan · Scroll to zoom`;
		transform(); fit();
	};
	let viewportWidth = 0;
	let viewportHeight = 0;
	const resize = new ResizeObserver(function () {
		if (space.clientWidth === 0 || space.clientHeight === 0) return;
		if (space.clientWidth !== viewportWidth || space.clientHeight !== viewportHeight) {
			viewportWidth = space.clientWidth;
			viewportHeight = space.clientHeight;
			fitPending = true;
		}
		fit();
	});
	resize.observe(space);
	const render = function (nextState: CampaignState, setup: CampaignEncounterSetup | undefined): void {
		state = nextState; encounterSetup = setup;
		if (!selectedSystem || !state.systems.some(function (system) { return system.id === selectedSystem; })) selectedSystem = state.systems.find(function (system) { return localPlanets(system.id).some(function (planet) { return planet.factionId === 'blue'; }); })?.id ?? state.systems[0]?.id;
		if (!sourceSystem || !localPlanets(sourceSystem).some(function (planet) { return planet.factionId === 'blue'; })) sourceSystem = state.systems.find(function (system) { return localPlanets(system.id).some(function (planet) { return planet.factionId === 'blue'; }); })?.id;
		if (state.encounter && setup && preparedEncounter === state.encounter.id) { galaxy.hidden = true; setupView.root.hidden = false; setupView.render(state, setup); return; }
		galaxy.hidden = false; setupView.root.hidden = true;
		if (!state.encounter) preparedEncounter = undefined;
		renderGalaxy();
	};
	return { root, render,
		prepareEncounter: prepare,
		showSystem: function (systemId): void { selectSystem(systemId); },
		showReport: function (nextReport): void {
			report = nextReport; preparedEncounter = undefined; input.cancel(); setupView.root.hidden = true; galaxy.hidden = false;
			if (nextReport.focusSystemId) selectedSystem = nextReport.focusSystemId;
			context = 'report'; renderGalaxy();
		},
		reset: function (): void {
			setupView.reset();
			input.cancel(); drafts.clear(); state = undefined; selectedSystem = undefined; sourceSystem = undefined; report = undefined; encounterSetup = undefined; preparedEncounter = undefined;
			context = 'system'; fitPending = true; camera = { x: 0, y: 0, scale: 1 }; notify(''); setupView.root.hidden = true; galaxy.hidden = false;
		},
		dispose: function (): void { disposed = true; input.dispose(); resize.disconnect(); setupView.dispose(); root.remove(); },
	};
};
